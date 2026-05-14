from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlmodel import Session

from app.core.auth import get_current_user_id
from app.core.image_storage import URL_PREFIX, resolve_local_path
from app.models.db import get_session
from app.services.project_service import ProjectService

router = APIRouter(prefix="/api/images", tags=["images"])


@router.get("/{bucket}/{project_id}/{filename}")
def serve_image(
    bucket: str,
    project_id: str,
    filename: str,
    session: Session = Depends(get_session),
    user_id: int = Depends(get_current_user_id),
) -> FileResponse:
    # 必须是项目所有者；同时校验 bucket/project_id 哈希一致防路径穿越。
    ProjectService(session)._get_owned_record(project_id, user_id)
    path = resolve_local_path(f"{URL_PREFIX}{bucket}/{project_id}/{filename}")
    if not path or not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="图片不存在")
    return FileResponse(path)
