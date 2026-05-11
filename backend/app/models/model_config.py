from datetime import datetime

from sqlmodel import Field, SQLModel

from app.models.time import utc_now


class ModelConfigRecord(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    kind: str = Field(index=True, sa_column_kwargs={"unique": True})
    base_url: str
    api_key_encrypted: str
    selected_model: str
    configured: bool = False
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    # text-only fields
    temperature: float | None = None
    max_tokens: int | None = None
    generation_endpoint_type: str | None = None

    # image-only fields
    image_size: str | None = None
    image_quality: str | None = None
