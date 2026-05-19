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
    # 大纲/逐页 prompt 流式阶段的逐页计数，供前端在「页数与大纲」面板上实时展示
    # 「生成中 N/total 页」。非流式阶段保持 None，前端会回落到 project.slides.length。
    completed_slides: int | None = None
    total_slides: int | None = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
