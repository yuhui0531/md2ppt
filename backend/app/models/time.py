from datetime import datetime, timezone


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def ensure_utc(dt: datetime) -> datetime:
    """SQLite + SQLModel 读回来的 datetime 会丢失 tzinfo。
    所有写入都走 utc_now()，所以读回来直接按 UTC 复活 tzinfo 即可。"""
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
