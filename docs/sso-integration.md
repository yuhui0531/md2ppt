# md2ppt 第三方 SSO 接入方案

> 基于约束：不引入本地用户表/用户映射表，使用 **JWT（HttpOnly Cookie 承载）** 作为本地可信身份凭据，把第三方 `userId` 透传到后续业务接口。

---

## 0. 全局日志规范（loguru）

**全项目禁止使用 `print` 打印日志，统一使用 `loguru`。**

- 新增依赖：`loguru>=0.7.2`（在 `backend/pyproject.toml` 的 dependencies 加入 `"loguru>=0.7.2"`）。
- 业务代码统一 `from loguru import logger`，调用 `logger.debug/info/warning/error/exception`。
- 第三方库（uvicorn / httpx / sqlalchemy 等）使用的是 stdlib `logging`，通过 `InterceptHandler` 全部转发到 loguru，保证一条管道。
- 已有代码里的 `print(..., flush=True)`（典型在 `backend/app/core/gateway_client.py`）需要一并替换为 `logger.info/...`。这是上线 SSO 前必须清理的一项技术债。
- 敏感字段（`ssoToken`、`clientSecret`、`username`、第三方完整响应体）禁止写入任何日志；统一在 `InterceptHandler.emit` 里做一次 `ssoToken=...` 的兜底脱敏，即便上游打错也不会泄露。
- 日志级别由 `APP_LOG_LEVEL`（默认 `INFO`）控制。

### 0.1 统一配置（`backend/app/core/logging_setup.py`）

```python
import logging
import re
import sys

from loguru import logger

from app.config import settings

_SSO_TOKEN_PATTERN = re.compile(r"(ssoToken=)[^&\"\s]+")


def _redact(message: str) -> str:
    return _SSO_TOKEN_PATTERN.sub(r"\1REDACTED", message)


class InterceptHandler(logging.Handler):
    """把 stdlib logging 记录转发到 loguru。"""

    def emit(self, record: logging.LogRecord) -> None:
        try:
            level = logger.level(record.levelname).name
        except ValueError:
            level = record.levelno
        frame, depth = logging.currentframe(), 2
        while frame and frame.f_code.co_filename == logging.__file__:
            frame = frame.f_back
            depth += 1
        logger.opt(depth=depth, exception=record.exc_info).log(
            level, _redact(record.getMessage())
        )


def setup_logging() -> None:
    logger.remove()
    logger.add(
        sys.stdout,
        level=settings.log_level,
        format=(
            "<green>{time:YYYY-MM-DD HH:mm:ss.SSS}</green> | "
            "<level>{level: <8}</level> | "
            "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - "
            "<level>{message}</level>"
        ),
        backtrace=False,
        diagnose=False,    # 生产关 diagnose，避免把变量值写进日志
    )
    # 接管 stdlib：所有 logger 一律转发到 loguru
    logging.basicConfig(handlers=[InterceptHandler()], level=0, force=True)
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access", "fastapi", "httpx", "sqlalchemy"):
        lg = logging.getLogger(name)
        lg.handlers = [InterceptHandler()]
        lg.propagate = False
```

在 `backend/app/config.py` 增加：

```python
    log_level: str = "INFO"   # APP_LOG_LEVEL 控制
```

`backend/app/main.py` 启动时**第一件事**就是调用 `setup_logging()`（在 `init_db()` 之前），确保 import 阶段产生的日志也走 loguru。

### 0.2 SSO 相关日志只允许打这些字段

| 字段 | 可打 | 不可打 |
|---|---|---|
| `userId` | ✅ | — |
| `error_code` / 自定义 status | ✅ | — |
| `elapsed` / `attempt` | ✅ | — |
| `ssoToken` | — | ❌ |
| `clientSecret` | — | ❌ |
| `username` / `displayName` / `role` | — | ❌ |
| 第三方完整响应体 | — | ❌ |

---

## 1. 整体实现方案

```
浏览器
  │  ① GET /api/md2ppt/sso/login?ssoToken=xxx
  ▼
后端 /api/md2ppt/sso/login
  │  ② POST {clientId, clientSecret, ssoToken}
  ▼
第三方 /api/sso/verify
  │  ③ 200 {userId, username, ...}  /  非200失败
  ▼
后端
  │  ④ Set-Cookie: md2ppt_token=<JWT>; HttpOnly; SameSite=Lax
  │  ⑤ 302 Location: /projects
  ▼
浏览器 → /projects
  │  ⑥ 业务接口（携带 cookie）
  ▼
后端依赖 get_current_user_id()
  ⇒ 解码并验证 JWT，得到 userId，注入到查询/写入条件
```

要点：
- **不建用户表**：`userId` 只放在 JWT payload 里，业务表里只存 `user_id` 列做归属与过滤。
- **凭据**：标准 JWT（HS256），payload 仅含 `sub`（userId）+ `exp` + `iat`，不存 role/username 等敏感字段。
- **ssoToken 一次性**：只在 `/api/md2ppt/sso/login` 这一次使用，校验完立即 302，前端 URL 里不再保留 `ssoToken`。
- **JWT 仅放 HttpOnly Cookie**：不暴露到前端 JS / localStorage，避免 XSS 偷 token。
- **第三方密钥**：`clientId/clientSecret` 通过 `.env` 注入到后端 settings，永远不暴露到前端。

---

## 2. 前后端交互流程

| 阶段 | 触发方 | 动作 |
|---|---|---|
| 入口 | 浏览器 | 访问 `http://localhost:5173/api/md2ppt/sso/login?ssoToken=xxx`，Vite proxy 转发到后端 8008 |
| SSO 校验 | 后端 | 调第三方 `/api/sso/verify`，超时 5s |
| 失败 | 后端 | 302 跳到 `/sso/failed?reason=xxx`（前端展示错误页，**不**进入首页） |
| 成功 | 后端 | 签发 JWT，写 HttpOnly Cookie `md2ppt_token`，302 跳到 `/projects` |
| 业务调用 | 前端 | 所有 `/api/*` 请求自动带 cookie；后端 `Depends(get_current_user_id)` 解码 JWT 后注入 `user_id` |
| 401 | 后端 | 业务接口若 cookie 缺失/JWT 过期/签名错，返回 401；前端拦截后跳 `/sso/failed?reason=unauthorized` |

---

## 3. 数据表改动

`backend/app/models/project.py`

```python
from datetime import datetime
from typing import Optional
from sqlmodel import Field, SQLModel
from app.models.time import utc_now


class ProjectRecord(SQLModel, table=True):
    id: str = Field(primary_key=True)
    user_id: int = Field(index=True)            # 新增：第三方 SSO 返回的 userId
    title: str
    source_filename: str | None = None
    source_language: str = "zh-CN"
    source_content: str
    generation_state: str = "uploaded"
    data_json: str = Field(default="{}")
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
```

`backend/app/models/db.py` 增量迁移（沿用现有 sqlite3 手动迁移风格）：

```python
def _needs_user_id_migration() -> bool:
    db_path = settings.storage_dir / "app.db"
    if not db_path.exists():
        return False
    conn = sqlite3.connect(str(db_path))
    try:
        cursor = conn.execute("PRAGMA table_info(projectrecord)")
        columns = {row[1] for row in cursor.fetchall()}
        return "user_id" not in columns
    finally:
        conn.close()


def _apply_user_id_migration() -> None:
    db_path = settings.storage_dir / "app.db"
    conn = sqlite3.connect(str(db_path))
    try:
        # 用 -1 作为历史孤儿哨兵：service 层显式拒绝 user_id <= 0，
        # 避免将来真出现 userId=0 / userId=-1 时误伤历史数据
        conn.execute("ALTER TABLE projectrecord ADD COLUMN user_id INTEGER NOT NULL DEFAULT -1")
        conn.execute("CREATE INDEX IF NOT EXISTS ix_projectrecord_user_id ON projectrecord(user_id)")
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    settings.storage_dir.mkdir(parents=True, exist_ok=True)
    (settings.storage_dir / "uploads").mkdir(parents=True, exist_ok=True)
    (settings.storage_dir / "exports").mkdir(parents=True, exist_ok=True)

    if _needs_migration():
        # 已有的 modelconfig 迁移
        ...
    if _needs_user_id_migration():
        _apply_user_id_migration()

    SQLModel.metadata.create_all(engine)
```

> 存量项目的 `user_id` 会被填 `-1`。可以选择：① 视作历史孤儿，所有人看不到（service 层拒绝 `user_id <= 0`）；② 单独脚本把它们划归某个 admin userId。**默认按 ① 处理**。

---

## 4. 配置项

> 新增依赖：`PyJWT>=2.8.0`、`loguru>=0.7.2`（在 `backend/pyproject.toml` 的 dependencies 加入 `"pyjwt>=2.8.0"` 与 `"loguru>=0.7.2"`）。

`backend/app/config.py`

```python
class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="APP_", env_file=".env", extra="ignore")

    storage_dir: Path = _DEFAULT_STORAGE_DIR
    database_url: str = f"sqlite:///{_DEFAULT_STORAGE_DIR / 'app.db'}"
    allow_local_gateway_urls: bool = False
    gateway_timeout_seconds: float = 600.0
    max_gateway_response_bytes: int = 4_000_000

    # ---- SSO ----
    sso_verify_url: str = "http://127.0.0.1:9000/api/sso/verify"
    sso_client_id: str = "dev-client"
    sso_client_secret: str = "dev-secret-PLACEHOLDER"
    sso_timeout_seconds: float = 5.0

    # ---- 本地凭据（JWT，仅承载 userId）----
    jwt_cookie_name: str = "md2ppt_token"
    jwt_secret: str = "REPLACE_ME_WITH_LONG_RANDOM"
    jwt_algorithm: str = "HS256"
    jwt_issuer: str = "md2ppt"
    jwt_ttl_seconds: int = 60 * 60          # 1 小时，到期重新走 SSO（不发 refresh token）
    jwt_cookie_secure: bool = False         # 生产环境置 True

    # ---- 前端跳转 ----
    frontend_home_path: str = "/projects"
    frontend_failed_path: str = "/sso/failed"

    # ---- 日志 ----
    log_level: str = "INFO"   # APP_LOG_LEVEL；loguru 与 stdlib 共用
```

对应 `.env`（**每个环境单独生成 `JWT_SECRET`，dev/staging/prod 严禁共用**）：

```env
APP_SSO_VERIFY_URL=https://third-party.example.com/api/sso/verify
APP_SSO_CLIENT_ID=dev-client
APP_SSO_CLIENT_SECRET=dev-secret-xxxx
APP_JWT_SECRET=<openssl rand -hex 32>
```

---

## 5. 后端核心代码

### 5.1 JWT 工具（`backend/app/core/jwt_token.py`）

```python
import time
from dataclasses import dataclass

import jwt  # PyJWT

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
            algorithms=[settings.jwt_algorithm],   # 显式白名单，防止 alg=none 攻击
            issuer=settings.jwt_issuer,
            options={"require": ["exp", "iat", "sub", "iss"]},
        )
    except jwt.PyJWTError:
        return None
    try:
        return SsoIdentity(user_id=int(payload["sub"]))
    except (KeyError, TypeError, ValueError):
        return None
```

### 5.2 SSO 校验客户端（`backend/app/services/sso_service.py`）

```python
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
    网络层抖动做一次幂等重试；业务错误（status != 200）不重试。"""
    if not sso_token or not sso_token.strip():
        raise SsoError("TOKEN_MISSING", "ssoToken 缺失")

    payload = {
        "clientId": settings.sso_client_id,
        "clientSecret": settings.sso_client_secret,
        "ssoToken": sso_token,
    }

    last_exc: Exception | None = None
    response: httpx.Response | None = None
    for attempt in range(2):  # 仅针对网络异常重试一次
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

    try:
        body: dict[str, Any] = response.json()
    except ValueError as exc:
        logger.warning("sso verify non-json response status={}", response.status_code)
        raise SsoError("SSO_BAD_RESPONSE", "SSO 返回不是合法 JSON") from exc

    # 失败：包含 status 字段且不为 200
    status = body.get("status")
    if status is not None and status != 200:
        logger.info("sso verify rejected status={} code={}", status, body.get("error_code"))
        raise SsoError(
            str(body.get("error_code") or "SSO_REJECTED"),
            str(body.get("message") or "SSO 校验未通过"),
        )

    user_id = body.get("userId")
    if not isinstance(user_id, int) or user_id <= 0:
        # 拒绝 userId<=0：与历史孤儿哨兵冲突
        logger.warning("sso verify invalid userId in payload")
        raise SsoError("SSO_NO_USER_ID", "SSO 校验通过但缺少有效 userId")

    # 仅记录 userId；username/displayName 严禁入日志
    logger.info("sso verify ok userId={}", user_id)
    return user_id
```

### 5.3 SSO 路由（`backend/app/api/sso.py`）

```python
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


@router.get("/login")
async def sso_login(request: Request, ssoToken: str | None = None) -> RedirectResponse:
    # ---- ① 已登录短路：避免重复消耗 ssoToken（F5/回退/Login CSRF 防护一部分）----
    existing = decode_token(request.cookies.get(settings.jwt_cookie_name))
    if existing:
        return _home_redirect()

    # ---- ② Login CSRF 兜底：只接受第三方/同域跳转过来的请求 ----
    # 没有 Referer/Origin 的请求（curl、img 标签等）一律拒绝
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


def _is_trusted_origin(request: Request) -> bool:
    """允许：Referer/Origin 来自第三方 SSO 域，或来自本系统自身域。
    缺失 Referer/Origin（curl、<img>）直接拒绝。"""
    candidates = []
    origin = request.headers.get("origin")
    referer = request.headers.get("referer")
    if origin:
        candidates.append(origin)
    if referer:
        candidates.append(referer)
    if not candidates:
        return False
    trusted_hosts = set(settings.sso_trusted_origins)  # 见 config，下方补充
    self_host = request.url.hostname or ""
    if self_host:
        trusted_hosts.add(self_host)
    for raw in candidates:
        host = urlparse(raw).hostname
        if host and host in trusted_hosts:
            return True
    return False


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
```

> Cookie 短路只能保护**已经登录**的用户被攻击者重新覆盖；纯白板用户首次点击攻击链接仍会被绑定到攻击者的 `userId`，这是 Login CSRF 的固有残余风险。Origin/Referer 校验是兜底，真正干净的方案是第三方 SSO 支持 `state` 参数。

`backend/app/config.py` 补一行（与 `_is_trusted_origin` 配套）：

```python
    sso_trusted_origins: list[str] = ["third-party.example.com"]  # 第三方 SSO 域名列表
```

### 5.4 身份依赖（`backend/app/core/auth.py`）

```python
from fastapi import HTTPException, Request

from app.config import settings
from app.core.jwt_token import decode_token


def get_current_user_id(request: Request) -> int:
    raw = request.cookies.get(settings.jwt_cookie_name)
    identity = decode_token(raw)
    if not identity:
        raise HTTPException(status_code=401, detail="未登录或登录已过期")
    return identity.user_id
```

### 5.5 注册路由 + 启动日志（`backend/app/main.py`）

```python
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from app.api.export import router as export_router
from app.api.generation import router as generation_router
from app.api.model_config import router as model_config_router
from app.api.projects import router as projects_router
from app.api.sso import router as sso_router
from app.core.logging_setup import setup_logging
from app.models.db import init_db


# 入口第一件事：装好 loguru，并把 stdlib（uvicorn/httpx/...）全部接管
setup_logging()


class SuppressJobPollingAccessLogs(logging.Filter):
    """保留原有的轮询接口噪声过滤。filter 仍挂在 stdlib logger 上，
    在 InterceptHandler.emit 之前生效。"""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            message = record.getMessage()
        except Exception:
            return True
        return not ('"GET /api/jobs/' in message and 'HTTP/1.1" 200' in message)


logging.getLogger("uvicorn.access").addFilter(SuppressJobPollingAccessLogs())


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    init_db()
    logger.info("md2ppt startup complete")
    yield


app = FastAPI(title="MD2PPT", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, ...)  # 见 §9 hardening

app.include_router(model_config_router)
app.include_router(projects_router)
app.include_router(generation_router)
app.include_router(export_router)
app.include_router(sso_router)
```

> `ssoToken=` 的脱敏由 `InterceptHandler._redact` 统一处理（见 §0.1）。`uvicorn.access` 打出来的访问日志会先被 `SuppressJobPollingAccessLogs` 过滤，再经 InterceptHandler 脱敏后送进 loguru sink，**不再单独写一个 stdlib 过滤器**。

### 5.6 现有 `print` 的清理

落地 SSO 之前，把以下文件里的 `print(...)` 全部换成 `logger.info/warning/error`：

- `backend/app/core/gateway_client.py`（多处 `print(f"[gateway] ..."`）
- 任何 `print(..., flush=True)` 调试输出

替换示例：

```python
# 旧
print(f"[gateway] chat_completion FAILED model={model} error={exc.__class__.__name__}: {exc}", flush=True)

# 新
from loguru import logger
logger.error("gateway chat_completion failed model={} error={} detail={}",
             model, exc.__class__.__name__, exc)
```

代码评审时**任何新增 `print` 不予合入**。

---

## 6. 项目接口接入身份

### 6.1 路由（`backend/app/api/projects.py`）

```python
from fastapi import APIRouter, Depends
from sqlmodel import Session

from app.core.auth import get_current_user_id
from app.models.db import get_session
from app.models.schemas import (
    CreateProjectRequest, CreateProjectResponse,
    ProjectListResponse, ProjectResponse,
    RenameProjectRequest, RenameProjectResponse,
)
from app.services.project_service import ProjectService

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.get("", response_model=ProjectListResponse)
def list_projects(
    session: Session = Depends(get_session),
    user_id: int = Depends(get_current_user_id),
) -> ProjectListResponse:
    projects = ProjectService(session).list_projects(user_id=user_id)
    return ProjectListResponse(projects=projects)


@router.post("", response_model=CreateProjectResponse)
def create_project(
    request: CreateProjectRequest,
    session: Session = Depends(get_session),
    user_id: int = Depends(get_current_user_id),
) -> CreateProjectResponse:
    project = ProjectService(session).create_project(request, user_id=user_id)
    return CreateProjectResponse(project_id=project.project_id, generation_state=project.generation_state)


@router.get("/{project_id}", response_model=ProjectResponse)
def get_project(
    project_id: str,
    session: Session = Depends(get_session),
    user_id: int = Depends(get_current_user_id),
) -> ProjectResponse:
    project = ProjectService(session).get_project_data(project_id, user_id=user_id)
    return ProjectResponse(project=project)


@router.patch("/{project_id}", response_model=RenameProjectResponse)
def rename_project(
    project_id: str,
    request: RenameProjectRequest,
    session: Session = Depends(get_session),
    user_id: int = Depends(get_current_user_id),
) -> RenameProjectResponse:
    record = ProjectService(session).rename_project(project_id, request.title, user_id=user_id)
    return RenameProjectResponse(project_id=record.id, title=record.title)


@router.delete("/{project_id}", status_code=204)
def delete_project(
    project_id: str,
    session: Session = Depends(get_session),
    user_id: int = Depends(get_current_user_id),
) -> None:
    ProjectService(session).delete_project(project_id, user_id=user_id)
```

### 6.2 服务层（`backend/app/services/project_service.py` 关键 diff）

```python
# create_project
def create_project(self, request: CreateProjectRequest, user_id: int) -> ProjectData:
    project_id = f"proj_{uuid4().hex[:12]}"
    sections = self.parser.parse(request.source.content)
    title = self._resolve_title(...)
    ...
    record = ProjectRecord(
        id=project_id,
        user_id=user_id,                 # ← 归属落库
        title=title,
        ...
    )
    ...

# list_projects：仅查自己
def list_projects(self, user_id: int) -> list[ProjectSummary]:
    stmt = (
        select(ProjectRecord)
        .where(ProjectRecord.user_id == user_id)
        .order_by(ProjectRecord.updated_at.desc())
    )
    records = list(self.session.exec(stmt))
    ...

# 单条访问：必须校验归属
def _get_owned_record(self, project_id: str, user_id: int) -> ProjectRecord:
    record = self.session.get(ProjectRecord, project_id)
    if not record or record.user_id != user_id:
        # 一律 404，不泄露其他用户的项目存在性
        raise HTTPException(status_code=404, detail="项目不存在")
    return record

def get_project_data(self, project_id: str, user_id: int) -> ProjectData:
    record = self._get_owned_record(project_id, user_id)
    data = ProjectData.model_validate(json.loads(record.data_json))
    self._ensure_record_title(record, data)
    return data

def rename_project(self, project_id: str, title: str, user_id: int) -> ProjectRecord:
    record = self._get_owned_record(project_id, user_id)
    normalized = title.strip()
    if not normalized:
        raise HTTPException(status_code=400, detail="项目名称不能为空")
    record.title = normalized
    record.updated_at = datetime.now(timezone.utc)
    self.session.add(record)
    self.session.commit()
    self.session.refresh(record)
    return record

def delete_project(self, project_id: str, user_id: int) -> None:
    record = self._get_owned_record(project_id, user_id)
    self.session.exec(delete(ParsedSectionRecord).where(ParsedSectionRecord.project_id == project_id))
    self.session.exec(delete(JobRecord).where(JobRecord.project_id == project_id))
    self.session.delete(record)
    self.session.commit()

# save_project_data：内部用，调用方必须先做归属校验
def save_project_data(self, data: ProjectData, user_id: int) -> None:
    record = self._get_owned_record(data.project_id, user_id)
    self._ensure_record_title(record, data)
    record.generation_state = data.generation_state
    record.data_json = data.model_dump_json()
    record.updated_at = datetime.now(timezone.utc)
    self.session.add(record)
    self.session.commit()
```

### 6.3 其他业务路由的归属审计清单

凡是 `project_id` 进入的接口，都加 `user_id = Depends(get_current_user_id)`，再交给 service 做归属校验。最简单的复用方式：

```python
from app.services.project_service import ProjectService

def assert_project_owner(session: Session, project_id: str, user_id: int) -> None:
    ProjectService(session)._get_owned_record(project_id, user_id)  # 命中即放行，否则 404
```

落地时**逐个**接口走过下表，缺一不可：

| 文件 | 接口 | 改造内容 |
|---|---|---|
| `api/generation.py` | `POST /api/projects/{pid}/generate` 等所有生成端点 | 入口 `Depends(get_current_user_id)` + `assert_project_owner` |
| `api/generation.py` | `GET /api/jobs/{job_id}` | 取 JobRecord → 用 `project_id` 反查 → `assert_project_owner` |
| `api/export.py` | `POST /api/projects/{pid}/export` + 下载端点 | 同上；下载链接也要校验归属，避免 export_id/路径被猜中后泄露 |
| `api/image_generation.py` | 所有 `project_id` 入参 | 同上 |
| `api/model_config.py` | 全部 | 仅加 `Depends(get_current_user_id)` 保证未登录不可访问；模型配置作为全局配置不做用户隔离 |
| `api/sso.py` | `/whoami`、`/logout` | 不加依赖（自身就是身份接口）|

> **`save_project_data` 等内部 helper** 全部要求传入 `user_id` 并先调 `_get_owned_record`，杜绝"忘记加过滤"导致越权。

---

## 7. 前端处理逻辑

### 7.1 路由（`frontend/src/App.tsx`）

```tsx
import { SsoFailedPage } from './routes/SsoFailedPage';

<Routes>
  <Route path="/sso/failed" element={<SsoFailedPage />} />
  <Route path="/" element={<AdminLayout />}>
    <Route index element={<Navigate to="/projects" replace />} />
    ...
  </Route>
</Routes>
```

### 7.2 全局 401 拦截（`frontend/src/api/client.ts`）

```ts
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(path, {
    credentials: 'same-origin', // 同域，cookie 自动携带
    ...init,
    headers,
  });
  if (response.status === 401) {
    window.location.replace('/sso/failed?reason=unauthorized');
    throw new ApiError('未登录或登录已过期', 401);
  }
  if (!response.ok) {
    throw new ApiError(await errorMessage(response), response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
```

### 7.3 入口地址栏清理（`frontend/src/main.tsx` 或 `AdminLayout.tsx`）

后端 302 已经把 `ssoToken` 从 URL 里去掉了。但为了兜底（用户手动把 SSO 完整 URL 收藏成 `/projects?ssoToken=xxx`），在 `AdminLayout` 首次挂载做一次清理：

```tsx
useEffect(() => {
  const url = new URL(window.location.href);
  if (url.searchParams.has('ssoToken')) {
    url.searchParams.delete('ssoToken');
    window.history.replaceState({}, '', url.toString());
  }
}, []);
```

### 7.4 失败页（`frontend/src/routes/SsoFailedPage.tsx`）

```tsx
import { useSearchParams } from 'react-router-dom';
import { Result } from 'antd';

const REASON_TEXT: Record<string, string> = {
  TOKEN_MISSING: '缺少 SSO Token，请通过统一入口进入。',
  TOKEN_CONSUMED: 'SSO Token 已被使用或失效，请重新发起登录。',
  SSO_TIMEOUT: 'SSO 校验超时，请稍后再试。',
  SSO_UNREACHABLE: 'SSO 服务暂不可用。',
  SSO_BAD_RESPONSE: 'SSO 返回数据异常。',
  SSO_NO_USER_ID: '无法获取用户身份。',
  UNTRUSTED_ORIGIN: '请通过 SSO 统一入口进入系统。',
  unauthorized: '登录已过期，请重新发起 SSO 登录。',
};

export function SsoFailedPage() {
  const [params] = useSearchParams();
  const reason = params.get('reason') || 'unauthorized';
  return (
    <Result
      status="403"
      title="无法进入系统"
      subTitle={REASON_TEXT[reason] || `SSO 校验未通过：${reason}`}
    />
  );
}
```

---

## 8. 错误处理矩阵

| 场景 | 检查位置 | 响应 |
|---|---|---|
| `ssoToken` 缺失/空 | `verify_sso_token` 起点 | `SsoError(TOKEN_MISSING)` → 302 `/sso/failed?reason=TOKEN_MISSING` |
| 第三方网络异常/连接失败 | `httpx.HTTPError`（重试 1 次后仍失败） | `SSO_UNREACHABLE` → 302 |
| 第三方超时 | `httpx.TimeoutException`（重试 1 次后仍失败） | `SSO_TIMEOUT` → 302 |
| 第三方非 JSON | `response.json()` 失败 | `SSO_BAD_RESPONSE` → 302 |
| `status != 200` | 解析后判断 | 透传 `error_code` → 302 |
| 缺 `userId` 或 `userId<=0` | 解析后判断 | `SSO_NO_USER_ID` → 302 |
| 请求来源不可信（无 Referer/Origin 或不在白名单）| `_is_trusted_origin` | `UNTRUSTED_ORIGIN` → 302 |
| 已登录用户重复点击登录链接 | `/login` 入口 cookie 短路 | 不消耗 ssoToken，直接 302 `/projects` |
| Cookie 缺失/篡改/过期/`alg=none` 伪造 | `get_current_user_id` | 401 → 前端跳 `/sso/failed?reason=unauthorized` |
| 访问别人项目 | service `_get_owned_record` | 404（不泄露存在性） |

所有失败路径都通过统一日志输出（不包含 `ssoToken`、`clientSecret`、`username`、`displayName` 与第三方完整响应体），仅记录 `userId`、`error_code`、`status`、`elapsed`。

---

## 9. 安全要点落实

| 要求 | 落实 |
|---|---|
| `clientSecret` 仅后端 | 放在 `settings`，由 `.env` 注入，未在任何前端代码中出现 |
| 前端不直连第三方 | 前端唯一入口是 `/api/md2ppt/sso/login`（同域） |
| `ssoToken` 一次性 | 校验完立刻 302；URL 中不再保留；AdminLayout 兜底清理；access log 脱敏过滤 |
| Login CSRF 防护 | ① 已登录 cookie 短路，不消耗 ssoToken；② Referer/Origin 白名单校验，无来源或来源不可信直接拒绝 |
| 调用超时控制 | `httpx.AsyncClient(timeout=5s)`，网络层失败重试 1 次（业务错误不重试） |
| 日志脱敏 | 全项目禁用 `print`；统一 `loguru`；stdlib（uvicorn 等）经 `InterceptHandler` 路由到 loguru，并在 `emit` 时统一 `ssoToken=...` → `REDACTED`。SSO 服务只打 `userId`/`error_code`/`status`/`elapsed`，不打 `ssoToken`、`clientSecret`、`username`、第三方完整响应体 |
| 不泄露敏感字段 | JWT payload 只放 `sub/iss/iat/exp`，不放 username/role；前端 `/whoami` 只回 `user_id` |
| JWT 算法白名单 | `jwt.decode(..., algorithms=["HS256"])` 显式指定，防止 `alg=none` 攻击 |
| JWT 必填字段 | `options={"require": ["exp", "iat", "sub", "iss"]}` 确保关键字段不缺失 |
| JWT TTL | 默认 1 小时；过期重新走 SSO，不发 refresh token，避免无界续期 |
| JWT secret 隔离 | dev / staging / prod 必须使用不同 `APP_JWT_SECRET`，禁止共用 |
| Cookie 安全 | `HttpOnly`（防 XSS 窃取）+ `SameSite=Lax`（防大部分 CSRF）；生产开启 `Secure` |
| 302 不缓存 | 所有 `/login` 重定向响应带 `Cache-Control: no-store` + `Pragma: no-cache`，避免中间代理缓存 |
| 哨兵冲突 | 历史 `user_id` 默认 `-1`；service 层显式拒绝 `user_id <= 0`，避免与真实 `userId=0` 撞车 |

### 上线前必做的 hardening

1. **CORS 收紧**：`backend/app/main.py` 当前 `allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"]` 是 dev-only。上生产改为生产域名列表；`allow_credentials=True` 时**绝不**配 `allow_origins=["*"]`。
2. **Cookie `Secure=True`**：生产 `APP_JWT_COOKIE_SECURE=true`。
3. **`sso_trusted_origins` 配齐**：把第三方 SSO 的生产域名加入白名单，否则所有 Login 都会被 `UNTRUSTED_ORIGIN` 拦掉。
4. **CSP 响应头**（防 XSS 兜底）：建议加全局中间件输出
   ```
   Content-Security-Policy: default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; frame-ancestors 'none'
   ```
   并在 `MarkdownPreview` 渲染处确认走的是 sanitizer（如 `rehype-sanitize`），不要直接 `dangerouslySetInnerHTML` 未过滤内容。
5. **HTTPS 强制**：反向代理层强制 HTTPS；后端可加 `Strict-Transport-Security: max-age=31536000`。
6. **第三方 SSO TLS**：`sso_verify_url` 必须是 HTTPS 域；`httpx` 默认校验证书，不要禁用。

---

## 10. 测试 checklist

1. 直接打开 `http://localhost:5173/projects` —— 应被 401 拦截，跳 `/sso/failed?reason=unauthorized`。
2. 用合法 `ssoToken` 打开 `/api/md2ppt/sso/login?ssoToken=valid` —— 跳 `/projects`，列表只显示自己 `userId` 的项目。
3. 同样的 `ssoToken` 再访问一次（未登录状态）—— 第三方返回 `TOKEN_CONSUMED`，跳 `/sso/failed?reason=TOKEN_CONSUMED`。
4. **已登录用户**再访问 `/api/md2ppt/sso/login?ssoToken=anything` —— cookie 短路命中，不打第三方，直接 302 `/projects`。
5. `curl http://localhost:8008/api/md2ppt/sso/login?ssoToken=valid`（无 Referer/Origin）—— 跳 `/sso/failed?reason=UNTRUSTED_ORIGIN`，ssoToken 未被消耗。
6. 模拟外站 `<img src=".../sso/login?ssoToken=ATTACKER">` —— Referer 不在白名单，被 `UNTRUSTED_ORIGIN` 拦掉。
7. 关闭第三方 SSO —— 跳 `/sso/failed?reason=SSO_UNREACHABLE`（应能看到日志里有一次重试）。
8. 用 A 用户登录后，手动构造 `/api/projects/{B 的 project_id}` 以及 `/api/jobs/{B 的 job_id}` —— 均返回 404。
9. 新建项目后，`select user_id from projectrecord` —— 应等于当前 SSO `userId`；老数据 `user_id` 为 `-1`，列表查询不会返回。
10. JWT 过期后调用 `/api/projects` —— 401，前端跳失败页。
11. 篡改 cookie 中的 JWT（改任意字符）—— `jwt.decode` 抛 `InvalidSignatureError`，返回 401。
12. 用 `jwt.io` 构造 `alg=none` 的伪造 token —— 因 `algorithms=["HS256"]` 白名单，解码失败 → 401。
13. 查看 uvicorn access log —— 含 `ssoToken=` 的行应显示 `ssoToken=REDACTED`（脱敏在 `InterceptHandler.emit` 中完成）。
14. `/api/md2ppt/sso/login` 的响应头 —— 应包含 `Cache-Control: no-store`。
15. `grep -nR "print(" backend/app` —— 应无业务代码中的 `print` 调用（测试/脚本除外）。

---

## 11. 关于 JWT 的取舍说明

选用 JWT（HS256）作为本地凭据，原因：
- **标准化**：`sub/iss/iat/exp` 是 RFC 7519 标准字段，工具链成熟；
- **库成熟**：`PyJWT` 久经考验，已自动防御 `alg=none`、过期、签名错误等常见攻击；
- **无状态**：服务端零状态，水平扩展无需 sticky session 或共享 store；
- **HttpOnly Cookie 承载**：避免前端 JS 接触 token，降低 XSS 风险。

显式**不做**的事（保持简单）：
- 不签发 refresh token，token 过期就重新走 SSO；
- 不维护 token 黑名单 / 撤销表（避免引入 Redis 或新表），用短 TTL（1h）控制风险窗口；
- payload 不放 `role / username`，业务接口只信任 `userId`，鉴权由业务逻辑自决；
- 不引入完整的 OAuth2 / `fastapi-users` 框架。

### 已知残余风险（可接受）

1. **Login CSRF 不能 100% 消除**：纯白板用户（无 cookie）首次点击攻击者构造的 `/login?ssoToken=ATTACKER_TOKEN`，仍会被绑定到攻击者的 `userId`。当前用"cookie 短路 + Referer/Origin 白名单"做了两层兜底，但真正干净的方案需要第三方 SSO 支持 `state` 参数。如果后续第三方支持，再加一层 state nonce 校验。
2. **强制下线**：JWT 一旦签发，到 `exp` 之前都有效；轮换 `JWT_SECRET` 会让全员重登。需要单点撤销时，再叠加一层基于 `jti` 的撤销表。
3. **TTL 内的状态滞后**：第三方禁用某用户后，本地最长 1 小时（默认 TTL）内仍可用。短 TTL 是当前妥协。
