import time
from dataclasses import dataclass

import jwt

from app.config import settings


@dataclass(frozen=True)
class SsoIdentity:
    user_id: int


def issue_token(user_id: int) -> str:
    now = int(time.time())
    payload = {
        "sub": str(user_id),
        "iss": settings.jwt_issuer,
        "iat": now,
        "exp": now + settings.jwt_ttl_seconds,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(raw: str | None) -> SsoIdentity | None:
    if not raw:
        return None
    try:
        payload = jwt.decode(
            raw,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
            issuer=settings.jwt_issuer,
            options={"require": ["exp", "iat", "sub", "iss"]},
        )
    except jwt.PyJWTError:
        return None
    try:
        user_id = int(payload["sub"])
    except (KeyError, TypeError, ValueError):
        return None
    if user_id <= 0:
        return None
    return SsoIdentity(user_id=user_id)
