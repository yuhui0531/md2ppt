"""生图结果在本地的落盘约定。

之前网关把图片以 data:image/png;base64,... 的 data URI 形式返给我们，
我们又原样塞进 projectrecord.data_json，单项目能膨胀到几十 MB。
现在统一：拿到 data URI 立刻解码落盘到
    storage/images/{sha256(project_id)[:2]}/{project_id}/slide-{n}.{ext}
DB 只保存 `/api/images/...` 这种相对路径，前端 <img> 同源加载即可。

分桶：取 project_id 的 sha256 前 2 字节当一级桶（256 个），避免所有项目
直接挤在 images/ 同一层下；单项目自己的目录里只有那几十张 slide。
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import re
from pathlib import Path

from app.config import settings

# data:image/png;base64,xxx     或     data:image/jpeg;base64,xxx
# DOTALL 是因为 b64 部分可能换行
_DATA_URI_RE = re.compile(
    r"^data:image/(?P<ext>[a-zA-Z0-9.+-]+);base64,(?P<b64>.+)$",
    re.DOTALL,
)

_VALID_EXTS = {"png", "jpg", "jpeg", "webp", "gif"}

URL_PREFIX = "/api/images/"


def images_root() -> Path:
    return settings.storage_dir / "images"


def _bucket_for(project_id: str) -> str:
    return hashlib.sha256(project_id.encode("utf-8")).hexdigest()[:2]


def project_image_dir(project_id: str) -> Path:
    return images_root() / _bucket_for(project_id) / project_id


def _normalize_ext(raw: str) -> str:
    ext = raw.lower().split("+", 1)[0]
    if ext == "jpeg":
        ext = "jpg"
    return ext if ext in _VALID_EXTS else "png"


def save_data_uri(project_id: str, slide_no: int, data_uri: str) -> str | None:
    """data URI → 磁盘文件，成功返回 `/api/images/...` 路径，输入不是 data URI 返回 None。
    base64 解码失败时返回 None（让调用方退回到原值，免得丢图）。"""
    m = _DATA_URI_RE.match(data_uri)
    if not m:
        return None
    ext = _normalize_ext(m.group("ext"))
    raw_b64 = m.group("b64")
    # data URI 里允许换行/空白，标准 base64 解码也允许但显式清掉更稳。
    cleaned = raw_b64.translate(str.maketrans("", "", " \n\r\t"))
    try:
        image_bytes = base64.b64decode(cleaned, validate=False)
    except (ValueError, binascii.Error):
        return None
    if not image_bytes:
        return None
    project_dir = project_image_dir(project_id)
    project_dir.mkdir(parents=True, exist_ok=True)
    out = project_dir / f"slide-{slide_no}.{ext}"
    out.write_bytes(image_bytes)
    return f"{URL_PREFIX}{_bucket_for(project_id)}/{project_id}/{out.name}"


def resolve_local_path(image_url: str) -> Path | None:
    """`/api/images/{bucket}/{project_id}/{filename}` → 本地文件路径。
    校验 bucket 与 project_id 的哈希一致，拒绝任何路径穿越尝试。
    非本地 URL（http/data:）返回 None。"""
    if not image_url.startswith(URL_PREFIX):
        return None
    rest = image_url[len(URL_PREFIX):]
    parts = rest.split("/")
    if len(parts) != 3:
        return None
    bucket, project_id, filename = parts
    # 防止 `..` 或路径分隔符注入
    for piece in (bucket, project_id, filename):
        if not piece or "/" in piece or "\\" in piece or ".." in piece or piece.startswith("."):
            return None
    if _bucket_for(project_id) != bucket:
        return None
    return images_root() / bucket / project_id / filename
