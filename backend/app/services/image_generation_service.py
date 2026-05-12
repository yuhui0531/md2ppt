import asyncio

from fastapi import HTTPException
from sqlmodel import Session, select

from app.core.gateway_client import GatewayClient, GatewayError
from app.models.job import JobRecord
from app.models.model_config import ModelConfigRecord
from app.models.schemas import ProjectData
from app.services.job_service import JobService
from app.services.project_service import ProjectService

MAX_CONCURRENCY = 3


class ImageGenerationService:
    def __init__(self, session: Session) -> None:
        self.session = session
        self.project_service = ProjectService(session)

    def get_image_config(self) -> ModelConfigRecord:
        statement = select(ModelConfigRecord).where(ModelConfigRecord.kind == "image")
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
        data = self.project_service.get_project_data(project_id)

        if not data.slides:
            job_service.update(job, stage="completed", progress=1.0, message="没有可生成的页面", status="completed")
            return

        target_slides = data.slides if slide_numbers is None else [s for s in data.slides if s.slide_no in slide_numbers]

        if not target_slides:
            job_service.update(job, stage="completed", progress=1.0, message="没有匹配的页面", status="completed")
            return

        total = len(target_slides)
        completed = 0
        failed_pages: list[int] = []
        semaphore = asyncio.Semaphore(MAX_CONCURRENCY)

        async def generate_one(slide_index: int, slide_no: int, prompt: str) -> None:
            nonlocal completed
            async with semaphore:
                client = GatewayClient(config.base_url, config.api_key_encrypted)
                try:
                    image_url = await client.image_generation(
                        model=config.selected_model,
                        prompt=prompt,
                        size=config.image_size or "2048x1152",
                        quality=config.image_quality or "hd",
                    )
                    data.slides[slide_index].image_url = image_url
                except (ValueError, GatewayError) as exc:
                    failed_pages.append(slide_no)
                    print(f"[image-gen] slide {slide_no} failed: {exc}", flush=True)

                completed += 1
                self.project_service.save_project_data(data)
                job_service.update(
                    job,
                    stage="generating",
                    progress=completed / total,
                    message=f"已完成 {completed}/{total} 张",
                    status="running",
                )

        tasks = []
        for slide in target_slides:
            idx = next(i for i, s in enumerate(data.slides) if s.slide_no == slide.slide_no)
            prompt = slide.prompt or f"slide {slide.slide_no}"
            if extra_prompt:
                prompt = f"{prompt}\n\n{extra_prompt}"
            tasks.append(generate_one(idx, slide.slide_no, prompt))

        await asyncio.gather(*tasks)

        if failed_pages:
            error_msg = f"以下页面生图失败：{failed_pages}"
            succeeded = total - len(failed_pages)
            if succeeded == 0:
                job_service.update(
                    job,
                    stage="failed",
                    progress=1.0,
                    message=f"全部 {total} 张生图失败",
                    status="failed",
                    error=error_msg,
                )
            else:
                job_service.update(
                    job,
                    stage="completed",
                    progress=1.0,
                    message=f"成功 {succeeded}/{total} 张，{len(failed_pages)} 张失败",
                    status="completed",
                    error=error_msg,
                )
        else:
            job_service.update(job, stage="completed", progress=1.0, message=f"全部 {total} 张生图完成", status="completed")
