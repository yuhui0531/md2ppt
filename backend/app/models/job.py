from datetime import datetime

from sqlmodel import Field, SQLModel

from app.models.time import utc_now


class JobRecord(SQLModel, table=True):
    id: str = Field(primary_key=True)
    project_id: str = Field(index=True)
    # "generation" = PPT 文本/大纲生成；"image_generation" = 批量生图。
    # 同一项目同时只允许一个 running 任务（save_project_data 会相互覆盖），
    # 但前端要按 kind 决定在哪个页面显示进度条。
    kind: str = Field(default="generation", index=True)
    status: str = "running"
    stage: str = "uploaded"
    progress: float = 0.0
    message: str = ""
    error: str | None = None
    cancel_requested: bool = False
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
