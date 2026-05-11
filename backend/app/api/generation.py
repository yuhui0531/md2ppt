import asyncio

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from app.models.db import engine, get_session
from app.models.schemas import (
    CheckConsistencyRequest,
    GenerateProjectRequest,
    JobResponse,
    ProjectResponse,
    RegenerateOutlineRequest,
    RegeneratePromptsRequest,
    ReviseInconsistentPromptsRequest,
)
from app.services.generation_service import GenerationService
from app.services.job_service import JobService

router = APIRouter(tags=["generation"])


@router.post("/api/projects/{project_id}/generate", response_model=JobResponse)
async def generate_project(
    project_id: str,
    request: GenerateProjectRequest,
    session: Session = Depends(get_session),
) -> JobResponse:
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
def get_job(job_id: str, session: Session = Depends(get_session)) -> JobResponse:
    job = JobService(session).get_job(job_id)
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
def cancel_job(job_id: str, session: Session = Depends(get_session)) -> JobResponse:
    job = JobService(session).cancel(job_id)
    return JobResponse(job_id=job.id, project_id=job.project_id, status=job.status, stage=job.stage, progress=job.progress, message=job.message, error=job.error)


@router.post("/api/projects/{project_id}/regenerate-outline", response_model=ProjectResponse)
async def regenerate_outline(project_id: str, request: RegenerateOutlineRequest, session: Session = Depends(get_session)) -> ProjectResponse:
    data = GenerationService(session).project_service.get_project_data(project_id)
    data.generation_options.slide_count_mode = request.slide_count_mode
    data.generation_options.requested_slide_count = request.requested_slide_count
    data.generation_options.requested_slide_range = request.requested_slide_range
    service = GenerationService(session)
    updated = await service.regenerate_outline(project_id, data.generation_options)
    return ProjectResponse(project=updated)


@router.post("/api/projects/{project_id}/regenerate-prompts", response_model=ProjectResponse)
async def regenerate_prompts(project_id: str, request: RegeneratePromptsRequest, session: Session = Depends(get_session)) -> ProjectResponse:
    updated = await GenerationService(session).regenerate_prompts(project_id, request.slide_numbers)
    return ProjectResponse(project=updated)


@router.post("/api/projects/{project_id}/check-consistency", response_model=ProjectResponse)
async def check_consistency(project_id: str, request: CheckConsistencyRequest, session: Session = Depends(get_session)) -> ProjectResponse:
    updated = await GenerationService(session).check_consistency_for_project(project_id, request.threshold)
    return ProjectResponse(project=updated)


@router.post("/api/projects/{project_id}/revise-inconsistent-prompts", response_model=ProjectResponse)
async def revise_inconsistent_prompts(project_id: str, request: ReviseInconsistentPromptsRequest, session: Session = Depends(get_session)) -> ProjectResponse:
    updated = await GenerationService(session).revise_inconsistent_prompts(project_id, request.threshold)
    return ProjectResponse(project=updated)
