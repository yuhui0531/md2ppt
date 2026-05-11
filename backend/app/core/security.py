import ipaddress
import socket
from urllib.parse import urlparse

from app.config import settings

_BLOCKED_HOSTS = {"localhost", "0.0.0.0"}


def _is_blocked_ip(ip: str) -> bool:
    address = ipaddress.ip_address(ip)
    return any(
        [
            address.is_loopback,
            address.is_private,
            address.is_link_local,
            address.is_multicast,
            address.is_reserved,
            address.is_unspecified,
        ]
    )


def _looks_like_ip(value: str) -> bool:
    try:
        ipaddress.ip_address(value)
    except ValueError:
        return False
    return True


def validate_gateway_base_url(base_url: str) -> str:
    parsed = urlparse(base_url)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("模型网关地址只允许 http 或 https 协议")
    if not parsed.netloc or parsed.username or parsed.password:
        raise ValueError("模型网关地址格式不合法")

    host = parsed.hostname
    if not host:
        raise ValueError("模型网关地址缺少 host")

    normalized_host = host.lower()
    if not settings.allow_local_gateway_urls:
        if normalized_host in _BLOCKED_HOSTS or normalized_host.endswith(".localhost"):
            raise ValueError("默认不允许使用 localhost 或内网模型网关地址")
        if _looks_like_ip(normalized_host) and _is_blocked_ip(normalized_host):
            raise ValueError("默认不允许使用内网、回环或保留 IP 作为模型网关地址")

        try:
            resolved = socket.getaddrinfo(normalized_host, None)
        except socket.gaierror as exc:
            raise ValueError("模型网关地址无法解析") from exc
        for result in resolved:
            ip = result[4][0]
            if _is_blocked_ip(ip):
                raise ValueError("模型网关地址解析到了内网、回环或保留 IP")

    return base_url.rstrip("/")


def mask_secret(secret: str) -> str:
    if len(secret) <= 8:
        return "*" * len(secret)
    return f"{secret[:4]}...{secret[-4:]}"
