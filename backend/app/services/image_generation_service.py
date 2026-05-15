import asyncio
import time

import httpx
from fastapi import HTTPException
from loguru import logger
from sqlmodel import Session, select

from app.config import settings
from app.core.gateway_client import (
    GatewayClient,
    GatewayError,
    build_gateway_async_client,
    gateway_timeout,
)
from app.core.image_storage import save_data_uri
from app.models.job import JobRecord
from app.models.model_config import ModelConfigRecord
from app.services.job_service import JobService
from app.services.project_service import ProjectService


def _failed_pages_error(failed_pages: list[int]) -> str:
    # 前端会从这个固定格式里提取失败页号，驱动“仅重试失败页”操作。
    return f"以下页面生图失败：{sorted(failed_pages)}"


class ImageGenerationService:
    def __init__(self, session: Session, user_id: int) -> None:
        self.session = session
        self.user_id = user_id
        self.project_service = ProjectService(session)

    def get_image_config(self) -> ModelConfigRecord:
        statement = select(ModelConfigRecord).where(
            ModelConfigRecord.kind == "image",
            ModelConfigRecord.user_id == self.user_id,
        )
        config = self.session.exec(statement).first()
        if not config or not config.configured:
            raise HTTPException(status_code=400, detail="请先完成生图模型配置")
        return config

    async def run_batch_generation(
        self,
        project_id: str,
        slide_numbers: list[int] | None,
        job_service: JobService,
        job: JobRecord,
        extra_prompt: str | None = None,
    ) -> None:
        config = self.get_image_config()
        data = self.project_service.get_project_data_internal(project_id)

        if not data.slides:
            job_service.update(job, stage="completed", progress=1.0, message="没有可生成的页面", status="completed")
            return

        target_slides = data.slides if slide_numbers is None else [s for s in data.slides if s.slide_no in slide_numbers]

        if not target_slides:
            job_service.update(job, stage="completed", progress=1.0, message="没有匹配的页面", status="completed")
            return

        total = len(target_slides)
        logger.info(
            "[image-gen] batch start job_id={} project_id={} total={} model={} extra_prompt_present={}",
            job.id,
            project_id,
            total,
            config.selected_model,
            bool(extra_prompt),
        )
        completed = 0
        failed_pages: list[int] = []
        slide_indexes = {slide.slide_no: index for index, slide in enumerate(data.slides)}
        semaphore = asyncio.Semaphore(settings.image_generation_concurrency)
        flush_interval = settings.image_progress_flush_interval_seconds
        flush_state = {"last_flush_at": 0.0, "last_completed": -1}

        def flush_progress(force: bool = False) -> None:
            now = time.monotonic()
            if force and flush_state["last_completed"] == completed:
                return
            if not force and completed < total and now - flush_state["last_flush_at"] < flush_interval:
                return
            self.project_service.save_project_data(data)
            job_service.update(
                job,
                stage="generating",
                progress=completed / total,
                message=f"已完成 {completed}/{total} 张",
                status="running",
            )
            flush_state["last_flush_at"] = now
            flush_state["last_completed"] = completed

        async with build_gateway_async_client() as async_client:
            client = GatewayClient(config.base_url, config.api_key_encrypted, async_client=async_client)

            async def generate_one(slide_index: int, slide_no: int, prompt: str) -> None:
                nonlocal completed
                async with semaphore:
                    try:
                        image_url = await client.image_generation(
                            model=config.selected_model,
                            prompt=prompt,
                            size=config.image_size or "2048x1152",
                            quality=config.image_quality or "hd",
                        )
                        saved = save_data_uri(project_id, slide_no, image_url)
                        data.slides[slide_index].image_url = saved or image_url
                    except (ValueError, GatewayError) as exc:
                        failed_pages.append(slide_no)
                        logger.warning(
                            "[image-gen] slide failed job_id={} project_id={} slide_no={} error={}",
                            job.id,
                            project_id,
                            slide_no,
                            exc,
                        )

                    completed += 1
                    flush_progress(force=False)

            tasks = []
            for slide in target_slides:
                idx = slide_indexes[slide.slide_no]
                prompt = slide.prompt or f"slide {slide.slide_no}"
                if extra_prompt:
                    prompt = f"{prompt}\n\n{extra_prompt}"
                tasks.append(generate_one(idx, slide.slide_no, prompt))

            await asyncio.gather(*tasks)

        flush_progress(force=True)

        if failed_pages:
            error_msg = _failed_pages_error(failed_pages)
            succeeded = total - len(failed_pages)
            if succeeded == 0:
                logger.warning("[image-gen] batch failed job_id={} project_id={} total={} failed_pages={}", job.id, project_id, total, failed_pages)
                job_service.update(
                    job,
                    stage="failed",
                    progress=1.0,
                    message=f"全部 {total} 张生图失败",
                    status="failed",
                    error=error_msg,
                )
            else:
                logger.warning(
                    "[image-gen] batch partial job_id={} project_id={} succeeded={} total={} failed_pages={}",
                    job.id,
                    project_id,
                    succeeded,
                    total,
                    failed_pages,
                )
                job_service.update(
                    job,
                    stage="completed",
                    progress=1.0,
                    message=f"成功 {succeeded}/{total} 张，{len(failed_pages)} 张失败",
                    status="completed",
                    error=error_msg,
                )
        else:
            logger.info("[image-gen] batch completed job_id={} project_id={} total={}", job.id, project_id, total)
            job_service.update(job, stage="completed", progress=1.0, message=f"全部 {total} 张生图完成", status="completed")
