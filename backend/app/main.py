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


# 启动第一件事：装好 loguru，并把 stdlib（uvicorn/httpx/...）全部接管
setup_logging()


class SuppressJobPollingAccessLogs(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        try:
            message = record.getMessage()
        except Exception:
            return True
        return not (
            '"GET /api/jobs/' in message
            and 'HTTP/1.1" 200' in message
        )


logging.getLogger("uvicorn.access").addFilter(SuppressJobPollingAccessLogs())


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    init_db()
    logger.info("md2ppt startup complete")
    yield


app = FastAPI(title="MD2PPT", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(model_config_router)
app.include_router(projects_router)
app.include_router(generation_router)
app.include_router(export_router)
app.include_router(sso_router)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
