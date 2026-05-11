from pathlib import Path
from urllib.parse import unquote

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlmodel import Session

from app.models.db import get_session
from app.models.schemas import ExportRequest, ExportResponse
from app.services.export_service import ExportService

router = APIRouter(tags=["export"])


@router.post("/api/projects/{project_id}/export", response_model=ExportResponse)
def export_project(project_id: str, request: ExportRequest, session: Session = Depends(get_session)) -> ExportResponse:
    try:
        return ExportService(session).export_project(project_id, request.format, request.include_index)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/api/exports/{export_file}/download")
def download_export(
    export_file: str,
    filename: str = Query(...),
    session: Session = Depends(get_session),
) -> FileResponse:
    try:
        path = ExportService(session).resolve_export_path(export_file)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="导出文件不存在") from exc
    return FileResponse(
        path=path,
        media_type=_media_type(path),
        filename=Path(unquote(filename)).name,
    )


def _media_type(path: Path) -> str:
    if path.suffix == ".json":
        return "application/json"
    if path.suffix == ".md":
        return "text/markdown"
    if path.suffix == ".zip":
        return "application/zip"
    return "application/octet-stream"
