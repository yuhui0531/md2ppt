from typing import Any

import httpx

from app.config import settings
from app.core.security import validate_gateway_base_url


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
            timeout=settings.gateway_timeout_seconds,
            follow_redirects=False,
        ) as client:
            try:
                response = await client.get(url, headers=self._headers())
            except httpx.HTTPError as exc:
                raise GatewayError(f"模型列表请求失败：{exc.__class__.__name__}") from exc
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
            timeout=settings.gateway_timeout_seconds,
            follow_redirects=False,
        ) as client:
            try:
                response = await client.post(url, headers=self._headers(), json=payload)
            except httpx.HTTPError as exc:
                raise GatewayError(f"生成请求失败：{exc.__class__.__name__}") from exc
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
            timeout=settings.gateway_timeout_seconds,
            follow_redirects=False,
        ) as client:
            try:
                response = await client.post(url, headers=self._headers(), json=payload)
            except httpx.HTTPError as exc:
                raise GatewayError(f"生图请求失败：{exc.__class__.__name__}") from exc
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
