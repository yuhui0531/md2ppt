from datetime import datetime

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel

from app.models.time import utc_now


class ModelConfigRecord(SQLModel, table=True):
    # 每个用户的 text/image 模型配置相互独立：用 (user_id, kind) 作为业务唯一键，
    # 替代原先把 kind 设为全局唯一的写法（那样所有人共用一份配置和 API Key）。
    __table_args__ = (UniqueConstraint("user_id", "kind", name="uq_modelconfig_user_kind"),)

    id: int | None = Field(default=None, primary_key=True)
    # 哨兵 -1 = 迁移自旧版的全局共享行，正常登录用户 (user_id > 0) 读不到也写不进。
    user_id: int = Field(index=True, default=-1)
    kind: str = Field(index=True)
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
