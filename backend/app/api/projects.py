from fastapi import APIRouter, Depends
from sqlmodel import Session

from app.core.auth import get_current_user_id
from app.models.db import get_session
from app.models.schemas import (
    CreateProjectRequest,
    CreateProjectResponse,
    ProjectListResponse,
    ProjectResponse,
    RenameProjectRequest,
    RenameProjectResponse,
    SuggestTitleResponse,
)
from app.services.generation_service import GenerationService
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
