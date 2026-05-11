from datetime import datetime

from sqlmodel import Field, SQLModel

from app.models.time import utc_now


class JobRecord(SQLModel, table=True):
    id: str = Field(primary_key=True)
    project_id: str = Field(index=True)
    status: str = "running"
    stage: str = "uploaded"
    progress: float = 0.0
    message: str = ""
    error: str | None = None
    cancel_requested: bool = False
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
