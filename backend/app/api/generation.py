import asyncio

from app.core.auth import get_current_user_id
from app.models.db import engine, get_session
from app.models.job import JobRecord
from app.models.project import ProjectRecord
from app.models.schemas import (
    CheckConsistencyRequest,
    GenerateImagesRequest,
    GenerateProjectRequest,
    JobResponse,
    ProjectResponse,
    RegenerateOutlineRequest,
    RegeneratePromptsRequest,
    ReviseInconsistentPromptsRequest,
)
from app.services.generation_service import GenerationService
from app.services.image_generation_service import ImageGenerationService
from app.services.job_service import JobService
from app.services.project_service import ProjectService
from fastapi import APIRouter, Depends, HTTPException
from loguru import logger
from sqlmodel import Session

router = APIRouter(tags=["generation"])


def _assert_project_owner(session: Session, project_id: str, user_id: int) -> None:
    ProjectService(session)._get_owned_record(project_id, user_id)


def _assert_job_owner(session: Session, job_id: str, user_id: int) -> JobRecord:
    job = session.get(JobRecord, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="任务不存在")
    record = session.get(ProjectRecord, job.project_id)
    if not record or record.user_id != user_id:
        raise HTTPException(status_code=404, detail="任务不存在")
    return job


@router.post("/api/projects/{project_id}/generate", response_model=JobResponse)
async def generate_project(
    project_id: str,
    request: GenerateProjectRequest,
    session: Session = Depends(get_session),
    user_id: int = Depends(get_current_user_id),
) -> JobResponse:
    _assert_project_owner(session, project_id, user_id)
    job_service = JobService(session)
    if job_service.has_active_job(project_id):
        logger.warning("[generation-job] create rejected project_id={} user_id={} reason=active_job", project_id, user_id)
        raise HTTPException(status_code=409, detail="当前项目已有正在执行的任务")
    job = job_service.create_job(project_id, kind="generation")
    logger.info("[generation-job] created job_id={} project_id={} user_id={} mode={}", job.id, project_id, user_id, request.mode)
    job_service.update(job, stage="queued", progress=0.02, message="生成任务已创建", status="running")
    asyncio.create_task(_run_generation_job(job.id, project_id, request.mode, user_id))
    return JobResponse(
        job_id=job.id,
        project_id=job.project_id,
        kind=job.kind,
        status=job.status,
        stage=job.stage,
        progress=job.progress,
        message=job.message,
        error=job.error,
    )


async def _run_generation_job(job_id: str, project_id: str, mode: str, user_id: int) -> None:
    # user_id 由调用方在请求线程内从 JWT 取出后透传进来：
    # 后台任务自己没有 request/cookie，必须显式带上才能找到该用户的模型配置。
    with Session(engine) as session:
        job_service = JobService(session)
        job = job_service.get_job(job_id)
        try:
            await GenerationService(session, user_id).run_generation(project_id, mode=mode, job_service=job_service, job=job)
            if job.status != "cancelled":
                job_service.update(job, stage="consistency_checked", progress=1.0, message="生成完成", status="completed")
        except HTTPException as exc:
            if exc.status_code == 499:
                logger.info("[generation-job] cancelled job_id={} project_id={} user_id={}", job_id, project_id, user_id)
                session.refresh(job)
                if job.status != "cancelled":
                    job_service.update(job, stage="cancelled", progress=job.progress, message="任务已取消", status="cancelled")
                return
            detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
            logger.exception(
                "[generation-job] failed job_id={} project_id={} user_id={} stage={} status_code={} detail={}",
                job_id,
                project_id,
                user_id,
                job.stage,
                exc.status_code,
                detail,
            )
            job_service.update(job, stage="failed", progress=job.progress, message="生成失败", status="failed", error=detail)
        except Exception as exc:
            logger.exception(
                "[generation-job] failed job_id={} project_id={} user_id={} stage={} error={}",
                job_id,
                project_id,
                user_id,
                job.stage,
                exc,
            )
            job_service.update(job, stage="failed", progress=job.progress, message="生成失败", status="failed", error=str(exc))


@router.get("/api/projects/{project_id}/active-job", response_model=JobResponse | None)
def get_active_job_for_project(
    project_id: str,
    session: Session = Depends(get_session),
    user_id: int = Depends(get_current_user_id),
) -> JobResponse | None:
    """工作台进入时用这个轻量端点探测是否已有任务在跑：
    有就让前端直接挂上去显示进度条 + 轮询，没有就返回 null。
    顺带由 JobService 把僵尸任务标记 failed，避免前端永远卡进度。"""
    _assert_project_owner(session, project_id, user_id)
    job = JobService(session).get_active_job(project_id)
    if not job:
        return None
    return JobResponse(
        job_id=job.id,
        project_id=job.project_id,
        kind=job.kind,
        status=job.status,
        stage=job.stage,
        progress=job.progress,
        message=job.message,
        error=job.error,
    )


@router.get("/api/jobs/{job_id}", response_model=JobResponse)
def get_job(
    job_id: str,
    session: Session = Depends(get_session),
    user_id: int = Depends(get_current_user_id),
) -> JobResponse:
    job = _assert_job_owner(session, job_id, user_id)
    return JobResponse(
        job_id=job.id,
        project_id=job.project_id,
        kind=job.kind,
        status=job.status,
        stage=job.stage,
        progress=job.progress,
        message=job.message,
        error=job.error,
    )


@router.post("/api/jobs/{job_id}/cancel", response_model=JobResponse)
def cancel_job(
    job_id: str,
    session: Session = Depends(get_session),
    user_id: int = Depends(get_current_user_id),
) -> JobResponse:
    _assert_job_owner(session, job_id, user_id)
    job = JobService(session).cancel(job_id)
    return JobResponse(job_id=job.id, project_id=job.project_id, kind=job.kind, status=job.status, stage=job.stage, progress=job.progress, message=job.message, error=job.error)


@router.post("/api/projects/{project_id}/regenerate-outline", response_model=ProjectResponse)
async def regenerate_outline(
    project_id: str,
    request: RegenerateOutlineRequest,
    session: Session = Depends(get_session),
    user_id: int = Depends(get_current_user_id),
) -> ProjectResponse:
    _assert_project_owner(session, project_id, user_id)
    data = GenerationService(session, user_id).project_service.get_project_data_internal(project_id)
    data.generation_options.slide_count_mode = request.slide_count_mode
    data.generation_options.requested_slide_count = request.requested_slide_count
    data.generation_options.requested_slide_range = request.requested_slide_range
    service = GenerationService(session, user_id)
    updated = await service.regenerate_outline(project_id, data.generation_options)
    return ProjectResponse(project=updated)


@router.post("/api/projects/{project_id}/regenerate-prompts", response_model=ProjectResponse)
async def regenerate_prompts(
    project_id: str,
    request: RegeneratePromptsRequest,
    session: Session = Depends(get_session),
    user_id: int = Depends(get_current_user_id),
) -> ProjectResponse:
    _assert_project_owner(session, project_id, user_id)
    updated = await GenerationService(session, user_id).regenerate_prompts(project_id, request.slide_numbers)
    return ProjectResponse(project=updated)


@router.post("/api/projects/{project_id}/check-consistency", response_model=ProjectResponse)
async def check_consistency(
    project_id: str,
    request: CheckConsistencyRequest,
    session: Session = Depends(get_session),
    user_id: int = Depends(get_current_user_id),
) -> ProjectResponse:
    _assert_project_owner(session, project_id, user_id)
    updated = await GenerationService(session, user_id).check_consistency_for_project(project_id, request.threshold)
    return ProjectResponse(project=updated)


@router.post("/api/projects/{project_id}/revise-inconsistent-prompts", response_model=ProjectResponse)
async def revise_inconsistent_prompts(
    project_id: str,
    request: ReviseInconsistentPromptsRequest,
    session: Session = Depends(get_session),
    user_id: int = Depends(get_current_user_id),
) -> ProjectResponse:
    _assert_project_owner(session, project_id, user_id)
    updated = await GenerationService(session, user_id).revise_inconsistent_prompts(project_id, request.threshold)
    return ProjectResponse(project=updated)


@router.post("/api/projects/{project_id}/generate-images", response_model=JobResponse)
async def generate_images(
    project_id: str,
    request: GenerateImagesRequest,
    session: Session = Depends(get_session),
    user_id: int = Depends(get_current_user_id),
) -> JobResponse:
    _assert_project_owner(session, project_id, user_id)
    ImageGenerationService(session, user_id).get_image_config()
    job_service = JobService(session)
    if job_service.has_active_job(project_id):
        logger.warning("[image-job] create rejected project_id={} user_id={} reason=active_job", project_id, user_id)
        raise HTTPException(status_code=409, detail="当前项目已有正在执行的任务")
    job = job_service.create_job(project_id, kind="image_generation")
    logger.info(
        "[image-job] created job_id={} project_id={} user_id={} slide_numbers={} extra_prompt_present={}",
        job.id,
        project_id,
        user_id,
        request.slide_numbers,
        bool(request.extra_prompt),
    )
    job_service.update(job, stage="queued", progress=0.0, message="批量生图任务已创建", status="running")
    asyncio.create_task(_run_image_generation_job(job.id, project_id, request.slide_numbers, request.extra_prompt, user_id))
    return JobResponse(
        job_id=job.id,
        project_id=job.project_id,
        kind=job.kind,
        status=job.status,
        stage=job.stage,
        progress=job.progress,
        message=job.message,
        error=job.error,
    )


async def _run_image_generation_job(job_id: str, project_id: str, slide_numbers: list[int] | None, extra_prompt: str | None = None, user_id: int = -1) -> None:
    # 同 _run_generation_job：user_id 用于在后台任务里定位调用者的生图模型配置。
    # 默认 -1 仅是签名兜底；正常路径下 API 入口一定会传真实 user_id 进来。
    with Session(engine) as session:
        job_service = JobService(session)
        job = job_service.get_job(job_id)
        try:
            await ImageGenerationService(session, user_id).run_batch_generation(
                project_id, slide_numbers, job_service, job, extra_prompt=extra_prompt
            )
        except Exception as exc:
            logger.exception(
                "[image-job] failed job_id={} project_id={} user_id={} stage={} error={}",
                job_id,
                project_id,
                user_id,
                job.stage,
                exc,
            )
            job_service.update(job, stage="failed", progress=job.progress, message=str(exc), status="failed", error=str(exc))
