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


def _needs_user_id_migration() -> bool:
    db_path = settings.storage_dir / "app.db"
    if not db_path.exists():
        return False
    conn = sqlite3.connect(str(db_path))
    try:
        cursor = conn.execute("PRAGMA table_info(projectrecord)")
        columns = {row[1] for row in cursor.fetchall()}
        if not columns:
            return False
        return "user_id" not in columns
    finally:
        conn.close()


def _apply_user_id_migration() -> None:
    db_path = settings.storage_dir / "app.db"
    conn = sqlite3.connect(str(db_path))
    try:
        # 历史孤儿哨兵 -1：service 层显式拒绝 user_id <= 0
        conn.execute("ALTER TABLE projectrecord ADD COLUMN user_id INTEGER NOT NULL DEFAULT -1")
        conn.execute("CREATE INDEX IF NOT EXISTS ix_projectrecord_user_id ON projectrecord(user_id)")
        conn.commit()
    finally:
        conn.close()


def _needs_model_config_user_id_migration() -> bool:
    db_path = settings.storage_dir / "app.db"
    if not db_path.exists():
        return False
    conn = sqlite3.connect(str(db_path))
    try:
        cursor = conn.execute("PRAGMA table_info(modelconfigrecord)")
        columns = {row[1] for row in cursor.fetchall()}
        if not columns:
            return False
        return "user_id" not in columns
    finally:
        conn.close()


def _apply_model_config_user_id_migration() -> None:
    """把 modelconfigrecord 从「kind 全局唯一」改成「(user_id, kind) 唯一」。

    背景：旧版每条 kind 全局只能存一行，所有用户共用一份模型配置/API Key。
    现在每个用户需要独立配置，约束语义必须改。

    做法：SQLite 不支持 ALTER TABLE 删除已有 UNIQUE，所以走标准的「新建表 →
    拷贝数据 → 删旧表 → 改名」流程。旧的全局行没法准确归属到某个用户，
    统一打上哨兵 user_id=-1，让正常登录用户 (user_id > 0) 自然读不到；
    管理员后续若想"认领"某条旧配置可手工 UPDATE user_id。"""
    db_path = settings.storage_dir / "app.db"
    conn = sqlite3.connect(str(db_path))
    try:
        conn.execute(
            """
            CREATE TABLE modelconfigrecord_new (
                id INTEGER PRIMARY KEY,
                user_id INTEGER NOT NULL DEFAULT -1,
                kind VARCHAR NOT NULL,
                base_url VARCHAR NOT NULL,
                api_key_encrypted VARCHAR NOT NULL,
                selected_model VARCHAR NOT NULL,
                configured BOOLEAN NOT NULL DEFAULT 0,
                created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL,
                temperature FLOAT,
                max_tokens INTEGER,
                generation_endpoint_type VARCHAR,
                image_size VARCHAR,
                image_quality VARCHAR,
                UNIQUE(user_id, kind)
            )
            """
        )
        # 旧行没有归属，统一标记为孤儿 (-1)；登录用户的过滤条件会自动绕开它们。
        conn.execute(
            """
            INSERT INTO modelconfigrecord_new (
                id, user_id, kind, base_url, api_key_encrypted, selected_model,
                configured, created_at, updated_at, temperature, max_tokens,
                generation_endpoint_type, image_size, image_quality
            )
            SELECT
                id, -1, kind, base_url, api_key_encrypted, selected_model,
                configured, created_at, updated_at, temperature, max_tokens,
                generation_endpoint_type, image_size, image_quality
            FROM modelconfigrecord
            """
        )
        conn.execute("DROP TABLE modelconfigrecord")
        conn.execute("ALTER TABLE modelconfigrecord_new RENAME TO modelconfigrecord")
        # 重建索引：SQLModel 用 `index=True` 声明的索引在 create_all 时按名字创建，
        # 这里手动补一份，避免 create_all 因为同名索引已存在而出现差异。
        conn.execute("CREATE INDEX IF NOT EXISTS ix_modelconfigrecord_kind ON modelconfigrecord(kind)")
        conn.execute("CREATE INDEX IF NOT EXISTS ix_modelconfigrecord_user_id ON modelconfigrecord(user_id)")
        conn.commit()
    finally:
        conn.close()


def _needs_job_kind_migration() -> bool:
    db_path = settings.storage_dir / "app.db"
    if not db_path.exists():
        return False
    conn = sqlite3.connect(str(db_path))
    try:
        cursor = conn.execute("PRAGMA table_info(jobrecord)")
        columns = {row[1] for row in cursor.fetchall()}
        if not columns:
            return False
        return "kind" not in columns
    finally:
        conn.close()


def _needs_project_origin_migration() -> bool:
    db_path = settings.storage_dir / "app.db"
    if not db_path.exists():
        return False
    conn = sqlite3.connect(str(db_path))
    try:
        cursor = conn.execute("PRAGMA table_info(projectrecord)")
        columns = {row[1] for row in cursor.fetchall()}
        if not columns:
            return False
        return "project_origin" not in columns
    finally:
        conn.close()


def _apply_project_origin_migration() -> None:
    """给 projectrecord 加 project_origin 列，区分 Markdown 生成型 vs 导入型项目。
    历史行一律按 'generated_markdown' 处理：导入型项目在加这列之前还没上线。"""
    db_path = settings.storage_dir / "app.db"
    conn = sqlite3.connect(str(db_path))
    try:
        conn.execute(
            "ALTER TABLE projectrecord ADD COLUMN project_origin VARCHAR NOT NULL DEFAULT 'generated_markdown'"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS ix_projectrecord_project_origin ON projectrecord(project_origin)"
        )
        conn.commit()
    finally:
        conn.close()


def _apply_job_kind_migration() -> None:
    """给 jobrecord 加 kind 列，区分 PPT 生成 vs 批量生图。
    历史行一律按 "generation" 处理：旧库里能跑的都是 PPT 生成，
    生图任务在加 kind 前还没上线。"""
    db_path = settings.storage_dir / "app.db"
    conn = sqlite3.connect(str(db_path))
    try:
        conn.execute("ALTER TABLE jobrecord ADD COLUMN kind VARCHAR NOT NULL DEFAULT 'generation'")
        conn.execute("CREATE INDEX IF NOT EXISTS ix_jobrecord_kind ON jobrecord(kind)")
        conn.commit()
    finally:
        conn.close()


def _needs_job_slide_counters_migration() -> bool:
    db_path = settings.storage_dir / "app.db"
    if not db_path.exists():
        return False
    conn = sqlite3.connect(str(db_path))
    try:
        cursor = conn.execute("PRAGMA table_info(jobrecord)")
        columns = {row[1] for row in cursor.fetchall()}
        if not columns:
            return False
        return "completed_slides" not in columns or "total_slides" not in columns
    finally:
        conn.close()


def _apply_job_slide_counters_migration() -> None:
    """给 jobrecord 加 completed_slides / total_slides 两列：流式阶段的逐页计数。
    历史行没有这两个字段，保持 NULL；前端在 None 时回落到 project.slides.length。"""
    db_path = settings.storage_dir / "app.db"
    conn = sqlite3.connect(str(db_path))
    try:
        cursor = conn.execute("PRAGMA table_info(jobrecord)")
        existing = {row[1] for row in cursor.fetchall()}
        if "completed_slides" not in existing:
            conn.execute("ALTER TABLE jobrecord ADD COLUMN completed_slides INTEGER")
        if "total_slides" not in existing:
            conn.execute("ALTER TABLE jobrecord ADD COLUMN total_slides INTEGER")
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    settings.storage_dir.mkdir(parents=True, exist_ok=True)
    (settings.storage_dir / "uploads").mkdir(parents=True, exist_ok=True)
    (settings.storage_dir / "exports").mkdir(parents=True, exist_ok=True)
    (settings.storage_dir / "images").mkdir(parents=True, exist_ok=True)

    if _needs_migration():
        db_path = settings.storage_dir / "app.db"
        conn = sqlite3.connect(str(db_path))
        try:
            conn.execute("DROP TABLE IF EXISTS modelconfigrecord")
            conn.commit()
        finally:
            conn.close()

    if _needs_user_id_migration():
        _apply_user_id_migration()

    if _needs_model_config_user_id_migration():
        _apply_model_config_user_id_migration()

    if _needs_job_kind_migration():
        _apply_job_kind_migration()

    if _needs_job_slide_counters_migration():
        _apply_job_slide_counters_migration()

    if _needs_project_origin_migration():
        _apply_project_origin_migration()

    SQLModel.metadata.create_all(engine)


def get_session() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session
