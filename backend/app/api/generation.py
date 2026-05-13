import asyncio

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

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
        raise HTTPException(status_code=409, detail="当前项目已有正在执行的任务")
    job = job_service.create_job(project_id)
    job_service.update(job, stage="queued", progress=0.02, message="生成任务已创建", status="running")
    asyncio.create_task(_run_generation_job(job.id, project_id, request.mode))
    return JobResponse(
        job_id=job.id,
        project_id=job.project_id,
        status=job.status,
        stage=job.stage,
        progress=job.progress,
        message=job.message,
        error=job.error,
    )


async def _run_generation_job(job_id: str, project_id: str, mode: str) -> None:
    with Session(engine) as session:
        job_service = JobService(session)
        job = job_service.get_job(job_id)
        try:
            await GenerationService(session).run_generation(project_id, mode=mode, job_service=job_service, job=job)
            if job.status != "cancelled":
                job_service.update(job, stage="consistency_checked", progress=1.0, message="生成完成", status="completed")
        except HTTPException as exc:
            if exc.status_code == 499:
                session.refresh(job)
                if job.status != "cancelled":
                    job_service.update(job, stage="cancelled", progress=job.progress, message="任务已取消", status="cancelled")
                return
            detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
            job_service.update(job, stage="failed", progress=job.progress, message="生成失败", status="failed", error=detail)
        except Exception as exc:
            job_service.update(job, stage="failed", progress=job.progress, message="生成失败", status="failed", error=str(exc))


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
    return JobResponse(job_id=job.id, project_id=job.project_id, status=job.status, stage=job.stage, progress=job.progress, message=job.message, error=job.error)


@router.post("/api/projects/{project_id}/regenerate-outline", response_model=ProjectResponse)
async def regenerate_outline(
    project_id: str,
    request: RegenerateOutlineRequest,
    session: Session = Depends(get_session),
    user_id: int = Depends(get_current_user_id),
) -> ProjectResponse:
    _assert_project_owner(session, project_id, user_id)
    data = GenerationService(session).project_service.get_project_data_internal(project_id)
    data.generation_options.slide_count_mode = request.slide_count_mode
    data.generation_options.requested_slide_count = request.requested_slide_count
    data.generation_options.requested_slide_range = request.requested_slide_range
    service = GenerationService(session)
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
    updated = await GenerationService(session).regenerate_prompts(project_id, request.slide_numbers)
    return ProjectResponse(project=updated)


@router.post("/api/projects/{project_id}/check-consistency", response_model=ProjectResponse)
async def check_consistency(
    project_id: str,
    request: CheckConsistencyRequest,
    session: Session = Depends(get_session),
    user_id: int = Depends(get_current_user_id),
) -> ProjectResponse:
    _assert_project_owner(session, project_id, user_id)
    updated = await GenerationService(session).check_consistency_for_project(project_id, request.threshold)
    return ProjectResponse(project=updated)


@router.post("/api/projects/{project_id}/revise-inconsistent-prompts", response_model=ProjectResponse)
async def revise_inconsistent_prompts(
    project_id: str,
    request: ReviseInconsistentPromptsRequest,
    session: Session = Depends(get_session),
    user_id: int = Depends(get_current_user_id),
) -> ProjectResponse:
    _assert_project_owner(session, project_id, user_id)
    updated = await GenerationService(session).revise_inconsistent_prompts(project_id, request.threshold)
    return ProjectResponse(project=updated)


@router.post("/api/projects/{project_id}/generate-images", response_model=JobResponse)
async def generate_images(
    project_id: str,
    request: GenerateImagesRequest,
    session: Session = Depends(get_session),
    user_id: int = Depends(get_current_user_id),
) -> JobResponse:
    _assert_project_owner(session, project_id, user_id)
    ImageGenerationService(session).get_image_config()
    job_service = JobService(session)
    if job_service.has_active_job(project_id):
        raise HTTPException(status_code=409, detail="当前项目已有正在执行的任务")
    job = job_service.create_job(project_id)
    job_service.update(job, stage="queued", progress=0.0, message="批量生图任务已创建", status="running")
    asyncio.create_task(_run_image_generation_job(job.id, project_id, request.slide_numbers, request.extra_prompt))
    return JobResponse(
        job_id=job.id,
        project_id=job.project_id,
        status=job.status,
        stage=job.stage,
        progress=job.progress,
        message=job.message,
        error=job.error,
    )


async def _run_image_generation_job(job_id: str, project_id: str, slide_numbers: list[int] | None, extra_prompt: str | None = None) -> None:
    with Session(engine) as session:
        job_service = JobService(session)
        job = job_service.get_job(job_id)
        try:
            await ImageGenerationService(session).run_batch_generation(
                project_id, slide_numbers, job_service, job, extra_prompt=extra_prompt
            )
        except Exception as exc:
            job_service.update(job, stage="failed", progress=job.progress, message=str(exc), status="failed", error=str(exc))
