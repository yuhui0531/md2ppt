import sqlite3
from collections.abc import Generator

from sqlmodel import Session, SQLModel, create_engine

from app.config import settings

engine = create_engine(settings.database_url, connect_args={"check_same_thread": False})


def _needs_migration() -> bool:
    db_path = settings.storage_dir / "app.db"
    if not db_path.exists():
        return False
    conn = sqlite3.connect(str(db_path))
    try:
        cursor = conn.execute("PRAGMA table_info(modelconfigrecord)")
        columns = {row[1]: row[2] for row in cursor.fetchall()}
        if "kind" not in columns:
            return True
        return False
    finally:
        conn.close()


def init_db() -> None:
    settings.storage_dir.mkdir(parents=True, exist_ok=True)
    (settings.storage_dir / "uploads").mkdir(parents=True, exist_ok=True)
    (settings.storage_dir / "exports").mkdir(parents=True, exist_ok=True)

    if _needs_migration():
        db_path = settings.storage_dir / "app.db"
        conn = sqlite3.connect(str(db_path))
        try:
            conn.execute("DROP TABLE IF EXISTS modelconfigrecord")
            conn.commit()
        finally:
            conn.close()

    SQLModel.metadata.create_all(engine)


def get_session() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session
