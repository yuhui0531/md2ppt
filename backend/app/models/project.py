from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel

from app.models.time import utc_now


class ProjectRecord(SQLModel, table=True):
    id: str = Field(primary_key=True)
    user_id: int = Field(index=True, default=-1)
    title: str
    source_filename: str | None = None
    source_language: str = "zh-CN"
    source_content: str
    generation_state: str = "uploaded"
    project_origin: str = Field(default="generated_markdown", index=True)
    data_json: str = Field(default="{}")
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class ParsedSectionRecord(SQLModel, table=True):
    id: str = Field(primary_key=True)
    project_id: str = Field(index=True)
    heading: str
    level: int
    content: str
    order: int
    parent_id: Optional[str] = None
    metadata_json: str = Field(default="{}")
