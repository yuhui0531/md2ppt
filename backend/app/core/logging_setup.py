import logging
import re
import sys

from loguru import logger

from app.config import settings

_SSO_TOKEN_PATTERN = re.compile(r"(ssoToken=)[^&\"\s]+")


def _redact(message: str) -> str:
    return _SSO_TOKEN_PATTERN.sub(r"\1REDACTED", message)


class InterceptHandler(logging.Handler):
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
        diagnose=False,
    )
    logging.basicConfig(handlers=[InterceptHandler()], level=0, force=True)
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access", "fastapi", "httpx", "sqlalchemy"):
        lg = logging.getLogger(name)
        lg.handlers = [InterceptHandler()]
        lg.propagate = False
