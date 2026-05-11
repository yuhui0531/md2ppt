from fastapi import APIRouter, Depends
from sqlmodel import Session

from app.models.db import get_session
from app.models.schemas import (
    CreateProjectRequest,
    CreateProjectResponse,
    ProjectListResponse,
    ProjectResponse,
    RenameProjectRequest,
    RenameProjectResponse,
)
from app.services.project_service import ProjectService

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.get("", response_model=ProjectListResponse)
def list_projects(session: Session = Depends(get_session)) -> ProjectListResponse:
    projects = ProjectService(session).list_projects()
    return ProjectListResponse(projects=projects)


@router.post("", response_model=CreateProjectResponse)
def create_project(
    request: CreateProjectRequest,
    session: Session = Depends(get_session),
) -> CreateProjectResponse:
    project = ProjectService(session).create_project(request)
    return CreateProjectResponse(project_id=project.project_id, generation_state=project.generation_state)


@router.get("/{project_id}", response_model=ProjectResponse)
def get_project(project_id: str, session: Session = Depends(get_session)) -> ProjectResponse:
    project = ProjectService(session).get_project_data(project_id)
    return ProjectResponse(project=project)


@router.patch("/{project_id}", response_model=RenameProjectResponse)
def rename_project(
    project_id: str,
    request: RenameProjectRequest,
    session: Session = Depends(get_session),
) -> RenameProjectResponse:
    record = ProjectService(session).rename_project(project_id, request.title)
    return RenameProjectResponse(project_id=record.id, title=record.title)


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: str, session: Session = Depends(get_session)) -> None:
    ProjectService(session).delete_project(project_id)
