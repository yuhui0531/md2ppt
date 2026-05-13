from typing import Any

import httpx
from loguru import logger

from app.config import settings


class SsoError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


async def verify_sso_token(sso_token: str) -> int:
    """调用第三方 SSO 校验接口，成功返回 userId；失败统一抛 SsoError。
    网络层抖动重试 1 次；业务错误（status != 200）不重试。"""
    if not sso_token or not sso_token.strip():
        logger.info("sso verify aborted: empty ssoToken")
        raise SsoError("TOKEN_MISSING", "ssoToken 缺失")

    payload = {
        "clientId": settings.sso_client_id,
        "clientSecret": settings.sso_client_secret,
        "ssoToken": sso_token,
    }
    token_preview = sso_token[:8] + "..."
    logger.info(
        "sso verify request url={} clientId={} ssoToken_preview={}",
        settings.sso_verify_url,
        settings.sso_client_id,
        token_preview,
    )

    last_exc: Exception | None = None
    response: httpx.Response | None = None
    for attempt in range(2):
        try:
            async with httpx.AsyncClient(timeout=settings.sso_timeout_seconds) as client:
                response = await client.post(settings.sso_verify_url, json=payload)
            break
        except httpx.TimeoutException as exc:
            last_exc = exc
            logger.warning("sso verify timeout attempt={}", attempt + 1)
        except httpx.HTTPError as exc:
            last_exc = exc
            logger.warning("sso verify http error attempt={} cls={}", attempt + 1, exc.__class__.__name__)

    if response is None:
        if isinstance(last_exc, httpx.TimeoutException):
            raise SsoError("SSO_TIMEOUT", "SSO 校验超时") from last_exc
        raise SsoError("SSO_UNREACHABLE", "SSO 校验失败") from last_exc

    logger.info(
        "sso verify raw response status_code={} content_type={} body_text={}",
        response.status_code,
        response.headers.get("content-type"),
        response.text,
    )

    try:
        body: dict[str, Any] = response.json()
    except ValueError as exc:
        logger.warning("sso verify non-json response status={}", response.status_code)
        raise SsoError("SSO_BAD_RESPONSE", "SSO 返回不是合法 JSON") from exc

    logger.info("sso verify parsed body={}", body)

    status = body.get("status")
    if status is not None and status != 200:
        logger.info(
            "sso verify rejected status={} code={} message={}",
            status,
            body.get("error_code"),
            body.get("message"),
        )
        raise SsoError(
            str(body.get("error_code") or "SSO_REJECTED"),
            str(body.get("message") or "SSO 校验未通过"),
        )

    user_id = body.get("userId")
    if not isinstance(user_id, int) or user_id <= 0:
        logger.warning("sso verify invalid userId in payload body={}", body)
        raise SsoError("SSO_NO_USER_ID", "SSO 校验通过但缺少有效 userId")

    logger.info("sso verify ok userId={} body={}", user_id, body)
    return user_id
