from fastapi import HTTPException, Request

from app.config import settings
from app.core.jwt_token import decode_token


def get_current_user_id(request: Request) -> int:
    raw = request.cookies.get(settings.jwt_cookie_name)
    identity = decode_token(raw)
    if not identity:
        raise HTTPException(status_code=401, detail="未登录或登录已过期")
    return identity.user_id
