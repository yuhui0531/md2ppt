from urllib.parse import urlencode, urlparse

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse

from app.config import settings
from app.core.jwt_token import decode_token, issue_token
from app.services.sso_service import SsoError, verify_sso_token

router = APIRouter(prefix="/api/md2ppt/sso", tags=["sso"])

_NO_CACHE_HEADERS = {
    "Cache-Control": "no-store, no-cache, must-revalidate, private",
    "Pragma": "no-cache",
}


def _failed_redirect(reason: str) -> RedirectResponse:
    target = f"{settings.frontend_failed_path}?{urlencode({'reason': reason})}"
    return RedirectResponse(url=target, status_code=302, headers=_NO_CACHE_HEADERS)


def _home_redirect() -> RedirectResponse:
    return RedirectResponse(url=settings.frontend_home_path, status_code=302, headers=_NO_CACHE_HEADERS)


def _is_trusted_origin(request: Request) -> bool:
    candidates = []
    origin = request.headers.get("origin")
    referer = request.headers.get("referer")
    if origin:
        candidates.append(origin)
    if referer:
        candidates.append(referer)
    if not candidates:
        return False
    trusted_hosts = set(settings.sso_trusted_origins)
    self_host = request.url.hostname or ""
    if self_host:
        trusted_hosts.add(self_host)
    for raw in candidates:
        host = urlparse(raw).hostname
        if host and host in trusted_hosts:
            return True
    return False


@router.get("/login")
async def sso_login(request: Request, ssoToken: str | None = None) -> RedirectResponse:
    # ① 已登录短路
    existing = decode_token(request.cookies.get(settings.jwt_cookie_name))
    if existing:
        return _home_redirect()

    # ② Login CSRF 兜底
    if not _is_trusted_origin(request):
        return _failed_redirect("UNTRUSTED_ORIGIN")

    try:
        user_id = await verify_sso_token(ssoToken or "")
    except SsoError as exc:
        return _failed_redirect(exc.code)

    token = issue_token(user_id)
    response = _home_redirect()
    response.set_cookie(
        key=settings.jwt_cookie_name,
        value=token,
        max_age=settings.jwt_ttl_seconds,
        httponly=True,
        secure=settings.jwt_cookie_secure,
        samesite="lax",
        path="/",
    )
    return response


@router.get("/whoami")
def whoami(request: Request) -> dict:
    raw = request.cookies.get(settings.jwt_cookie_name)
    identity = decode_token(raw)
    if not identity:
        raise HTTPException(status_code=401, detail="未登录或登录已过期")
    return {"user_id": identity.user_id}


@router.post("/logout")
def sso_logout() -> JSONResponse:
    response = JSONResponse({"ok": True})
    response.delete_cookie(settings.jwt_cookie_name, path="/")
    return response
