import asyncio

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from loguru import logger
from sqlmodel import Session

from app.core.auth import get_current_user_id
from app.models.db import get_session
from app.models.schemas import (
    CreateProjectRequest,
    CreateProjectResponse,
    ImportPromptsResponse,
    JobResponse,
    ProjectListResponse,
    ProjectResponse,
    RenameProjectRequest,
    RenameProjectResponse,
    SuggestTitleResponse,
)
from app.services.generation_service import GenerationService
from app.services.import_job_runner import run_import_structure_job
from app.services.import_service import ImportService
from app.services.job_service import JobService
from app.services.project_service import ProjectService

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.get("", response_model=ProjectListResponse)
def list_projects(
    session: Session = Depends(get_session),
    user_id: int = Depends(get_current_user_id),
) -> ProjectListResponse:
    projects = ProjectService(session).list_projects(user_id=user_id)
    return ProjectListResponse(projects=projects)


@router.post("", response_model=CreateProjectResponse)
def create_project(
    request: CreateProjectRequest,
    session: Session = Depends(get_session),
    user_id: int = Depends(get_current_user_id),
) -> CreateProjectResponse:
    project = ProjectService(session).create_project(request, user_id=user_id)
    return CreateProjectResponse(project_id=project.project_id, generation_state=project.generation_state)


@router.post("/import-prompts", response_model=ImportPromptsResponse)
async def import_prompts(
    files: list[UploadFile] = File(...),
    session: Session = Depends(get_session),
    user_id: int = Depends(get_current_user_id),
) -> ImportPromptsResponse:
    """multipart 导入入口：接收 ZIP 或多个 .md，落地一个 imported_prompts 项目，
    并立即触发后台结构补全任务。前端拿到 project_id 后跳转工作台，挂上进度条。"""
    if not files:
        raise HTTPException(status_code=400, detail="请上传 ZIP 或至少一个 .md 文件")
    data, _record = await ImportService(session).create_imported_project(files, user_id=user_id)

    job_service = JobService(session)
    job = job_service.create_job(data.project_id, kind="import_structure_generation")
    job_service.update(job, stage="queued", progress=0.02, message="结构补全任务已创建", status="running")
    logger.info(
        "[import-job] created job_id={} project_id={} user_id={} slide_count={}",
        job.id, data.project_id, user_id, len(data.slides),
    )
    asyncio.create_task(run_import_structure_job(job.id, data.project_id, user_id))
    return ImportPromptsResponse(
        project_id=data.project_id,
        generation_state=data.generation_state,
        job=JobResponse(
            job_id=job.id,
            project_id=job.project_id,
            kind=job.kind,
            status=job.status,
            stage=job.stage,
            progress=job.progress,
            message=job.message,
            error=job.error,
        ),
    )


@router.get("/{project_id}", response_model=ProjectResponse)
def get_project(
    project_id: str,
    session: Session = Depends(get_session),
    user_id: int = Depends(get_current_user_id),
) -> ProjectResponse:
    project = ProjectService(session).get_project_data(project_id, user_id=user_id)
    return ProjectResponse(project=project)


@router.patch("/{project_id}", response_model=RenameProjectResponse)
def rename_project(
    project_id: str,
    request: RenameProjectRequest,
    session: Session = Depends(get_session),
    user_id: int = Depends(get_current_user_id),
) -> RenameProjectResponse:
    record = ProjectService(session).rename_project(project_id, request.title, user_id=user_id)
    return RenameProjectResponse(project_id=record.id, title=record.title)


@router.post("/{project_id}/suggest-title", response_model=SuggestTitleResponse)
async def suggest_project_title(
    project_id: str,
    session: Session = Depends(get_session),
    user_id: int = Depends(get_current_user_id),
) -> SuggestTitleResponse:
    # 先校验归属，再让 GenerationService 拿用户自己的文本模型生成标题。
    ProjectService(session)._get_owned_record(project_id, user_id)
    title = await GenerationService(session, user_id).suggest_title(project_id)
    return SuggestTitleResponse(title=title)


@router.delete("/{project_id}", status_code=204)
def delete_project(
    project_id: str,
    session: Session = Depends(get_session),
    user_id: int = Depends(get_current_user_id),
) -> None:
    ProjectService(session).delete_project(project_id, user_id=user_id)
