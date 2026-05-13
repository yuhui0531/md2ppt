from typing import Any, Callable

import json
import time

import httpx
from loguru import logger

from app.config import settings
from app.core.security import validate_gateway_base_url


def _gateway_timeout() -> httpx.Timeout:
    read = settings.gateway_timeout_seconds
    return httpx.Timeout(connect=15.0, read=read, write=30.0, pool=30.0)


def _log_response(tag: str, response: httpx.Response, **extra: Any) -> None:
    elapsed = response.elapsed.total_seconds()
    parts = [
        f"[gateway] {tag}",
        f"status={response.status_code}",
        f"elapsed={elapsed:.2f}s",
        f"bytes={len(response.content)}",
    ]
    parts.extend(f"{k}={v}" for k, v in extra.items())
    logger.info(" ".join(parts))


class GatewayError(Exception):
    pass


class GatewayClient:
    def __init__(self, base_url: str, api_key: str) -> None:
        self.base_url = validate_gateway_base_url(base_url)
        self.api_key = api_key

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}

    async def list_models(self, models_endpoint: str = "/v1/models") -> list[dict[str, Any]]:
        endpoint = models_endpoint if models_endpoint.startswith("/") else f"/{models_endpoint}"
        url = f"{self.base_url}{endpoint}"
        async with httpx.AsyncClient(
            timeout=_gateway_timeout(),
            follow_redirects=False,
        ) as client:
            try:
                response = await client.get(url, headers=self._headers())
            except httpx.HTTPError as exc:
                raise GatewayError(f"模型列表请求失败：{exc.__class__.__name__}") from exc
        _log_response("list_models", response)
        if response.is_redirect:
            raise GatewayError("模型网关返回重定向，已拒绝跟随")
        if response.status_code == 401:
            raise GatewayError("API Key 无效或未授权")
        if response.status_code >= 400:
            raise GatewayError(f"模型列表请求失败：HTTP {response.status_code}")
        if len(response.content) > settings.max_gateway_response_bytes:
            raise GatewayError("模型列表响应过大")
        try:
            payload = response.json()
        except ValueError as exc:
            raise GatewayError("模型列表响应不是合法 JSON") from exc
        data = payload.get("data")
        if not isinstance(data, list):
            raise GatewayError("模型列表响应格式不兼容，缺少 data 数组")
        return [item for item in data if isinstance(item, dict) and item.get("id")]

    async def chat_completion_json(self, model: str, messages: list[dict[str, str]], temperature: float = 0.0, max_tokens: int = 512) -> str:
        url = f"{self.base_url}/v1/chat/completions"
        payload = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "response_format": {"type": "json_object"},
        }
        async with httpx.AsyncClient(
            timeout=_gateway_timeout(),
            follow_redirects=False,
        ) as client:
            try:
                response = await client.post(url, headers=self._headers(), json=payload)
            except httpx.HTTPError as exc:
                logger.error("[gateway] chat_completion FAILED model={} error={}: {}", model, exc.__class__.__name__, exc)
                raise GatewayError(f"生成请求失败：{exc.__class__.__name__}") from exc
        _log_response("chat_completion", response, model=model, max_tokens=max_tokens)
        if response.is_redirect:
            raise GatewayError("模型网关返回重定向，已拒绝跟随")
        if response.status_code == 401:
            raise GatewayError("API Key 无效或未授权")
        if response.status_code >= 400:
            raise GatewayError(f"生成请求失败：HTTP {response.status_code} {response.text[:200]}")
        if len(response.content) > settings.max_gateway_response_bytes:
            raise GatewayError("生成响应过大")
        try:
            payload = response.json()
        except ValueError as exc:
            raise GatewayError("生成响应不是合法 JSON") from exc
        choices = payload.get("choices") or []
        if not choices:
            raise GatewayError("生成响应缺少 choices")
        content = choices[0].get("message", {}).get("content")
        if not isinstance(content, str):
            raise GatewayError("生成响应缺少 message.content")
        return content

    async def chat_completion_stream(
        self,
        model: str,
        messages: list[dict[str, str]],
        temperature: float = 0.0,
        max_tokens: int = 512,
        on_partial: Callable[[str], None] | None = None,
    ) -> str:
        """Streaming chat completion. Accumulates delta.content into a buffer and
        invokes on_partial(buffer) whenever a delta closes one or more JSON objects
        (i.e. contains '}'), so callers can do incremental parsing. Returns the
        final concatenated content string."""
        url = f"{self.base_url}/v1/chat/completions"
        payload = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "response_format": {"type": "json_object"},
            "stream": True,
        }
        buffer = ""
        chunk_count = 0
        started = time.monotonic()
        async with httpx.AsyncClient(
            timeout=_gateway_timeout(),
            follow_redirects=False,
        ) as client:
            try:
                async with client.stream("POST", url, headers=self._headers(), json=payload) as response:
                    if response.status_code == 401:
                        raise GatewayError("API Key 无效或未授权")
                    if response.status_code >= 400:
                        body = await response.aread()
                        raise GatewayError(
                            f"流式生成请求失败：HTTP {response.status_code} {body[:200].decode('utf-8', 'replace')}"
                        )
                    async for line in response.aiter_lines():
                        if not line or not line.startswith("data:"):
                            continue
                        data_str = line[5:].strip()
                        if data_str == "[DONE]":
                            break
                        try:
                            event = json.loads(data_str)
                        except json.JSONDecodeError:
                            continue
                        choices = event.get("choices") or []
                        if not choices:
                            continue
                        delta = choices[0].get("delta") or {}
                        delta_content = delta.get("content")
                        if not isinstance(delta_content, str) or not delta_content:
                            continue
                        buffer += delta_content
                        chunk_count += 1
                        if on_partial is not None and "}" in delta_content:
                            try:
                                on_partial(buffer)
                            except Exception as cb_exc:
                                logger.error("[gateway] chat_completion_stream on_partial raised {}: {}", cb_exc.__class__.__name__, cb_exc)
                                raise
                        if len(buffer) > settings.max_gateway_response_bytes:
                            raise GatewayError("流式生成响应过大")
                logger.info(
                    "[gateway] chat_completion_stream model={} max_tokens={} chunks={} bytes={} elapsed={:.2f}s",
                    model, max_tokens, chunk_count, len(buffer), time.monotonic() - started,
                )
            except httpx.HTTPError as exc:
                logger.error(
                    "[gateway] chat_completion_stream FAILED model={} chunks={} bytes={} elapsed={:.2f}s error={}: {}",
                    model, chunk_count, len(buffer), time.monotonic() - started, exc.__class__.__name__, exc,
                )
                raise GatewayError(f"流式生成请求失败：{exc.__class__.__name__}") from exc
        if not buffer:
            raise GatewayError("流式生成响应为空")
        return buffer

    async def image_generation(self, model: str, prompt: str, size: str = "2048x1152", quality: str = "hd") -> str:
        url = f"{self.base_url}/v1/images/generations"
        payload = {
            "model": model,
            "prompt": prompt,
            "n": 1,
            "size": size,
            "quality": quality,
            "response_format": "url",
        }
        async with httpx.AsyncClient(
            timeout=_gateway_timeout(),
            follow_redirects=False,
        ) as client:
            try:
                response = await client.post(url, headers=self._headers(), json=payload)
            except httpx.HTTPError as exc:
                logger.error("[gateway] image_generation FAILED model={} error={}: {}", model, exc.__class__.__name__, exc)
                raise GatewayError(f"生图请求失败：{exc.__class__.__name__}") from exc
        _log_response("image_generation", response, model=model)
        if response.is_redirect:
            raise GatewayError("模型网关返回重定向，已拒绝跟随")
        if response.status_code == 401:
            raise GatewayError("API Key 无效或未授权")
        if response.status_code >= 400:
            raise GatewayError(f"生图请求失败：HTTP {response.status_code} {response.text[:200]}")
        if len(response.content) > settings.max_gateway_response_bytes:
            raise GatewayError("生图响应过大")
        try:
            result = response.json()
        except ValueError as exc:
            raise GatewayError("生图响应不是合法 JSON") from exc
        data = result.get("data")
        if not isinstance(data, list) or not data:
            raise GatewayError("生图响应缺少 data 数组")
        first = data[0]
        image_url = first.get("url") or first.get("b64_json")
        if not image_url:
            raise GatewayError("生图响应缺少图片 URL")
        return image_url
