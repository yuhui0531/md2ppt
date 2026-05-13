from urllib.parse import urlencode, urlparse

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse
from loguru import logger

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
    client_ip = request.client.host if request.client else "-"
    origin = request.headers.get("origin")
    referer = request.headers.get("referer")
    user_agent = request.headers.get("user-agent")
    token_preview = (ssoToken[:8] + "...") if ssoToken else None
    logger.info(
        "sso login received ip={} origin={} referer={} ua={} ssoToken_present={} ssoToken_preview={}",
        client_ip,
        origin,
        referer,
        user_agent,
        bool(ssoToken),
        token_preview,
    )

    # ① 已登录短路
    existing = decode_token(request.cookies.get(settings.jwt_cookie_name))
    if existing:
        logger.info("sso login short-circuited (already logged in) user_id={} ip={}", existing.user_id, client_ip)
        return _home_redirect()

    # ② Login CSRF 兜底
    # if not _is_trusted_origin(request):
    #     logger.warning(
    #         "sso login rejected UNTRUSTED_ORIGIN ip={} origin={} referer={} trusted={}",
    #         client_ip,
    #         origin,
    #         referer,
    #         settings.sso_trusted_origins,
    #     )
    #     return _failed_redirect("UNTRUSTED_ORIGIN")

    try:
        user_id = await verify_sso_token(ssoToken or "")
    except SsoError as exc:
        logger.warning(
            "sso login failed ip={} code={} message={} ssoToken_preview={}",
            client_ip,
            exc.code,
            exc.message,
            token_preview,
        )
        return _failed_redirect(exc.code)

    token = issue_token(user_id)
    logger.info(
        "sso login success user_id={} ip={} jwt_ttl={}s cookie_secure={}",
        user_id,
        client_ip,
        settings.jwt_ttl_seconds,
        settings.jwt_cookie_secure,
    )
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
        logger.info("whoami unauthenticated cookie_present={}", bool(raw))
        raise HTTPException(status_code=401, detail="未登录或登录已过期")
    logger.debug("whoami ok user_id={}", identity.user_id)
    return {"user_id": identity.user_id}


@router.post("/logout")
def sso_logout(request: Request) -> JSONResponse:
    raw = request.cookies.get(settings.jwt_cookie_name)
    identity = decode_token(raw) if raw else None
    logger.info(
        "sso logout user_id={} cookie_present={}",
        identity.user_id if identity else None,
        bool(raw),
    )
    response = JSONResponse({"ok": True})
    response.delete_cookie(settings.jwt_cookie_name, path="/")
    return response
