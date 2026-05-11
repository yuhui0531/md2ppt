# Image Model Config Design

## Summary

在现有模型配置体系中增加"生图模型配置"，复用 `ModelConfigRecord` 表，通过 `kind` 字段区分文本 (`text`) 和图像 (`image`) 两类配置。前端在 ModelConfigPage 新增第二张卡片，交互流程与文本配置一致（填 URL → 拉模型列表 → 选模型 → 测试生图 → 保存）。

## Decisions

| 决策 | 选择 | 原因 |
|------|------|------|
| 表结构 | 复用 ModelConfigRecord，加 kind 列 | 用户要求不单独建表 |
| PK | int autoincrement | 用户要求数字 ID |
| 文本/图像关系 | 完全独立（各自 base_url + api_key） | 可能用不同提供商 |
| 选模型交互 | 复用"获取模型列表"按钮 | 和文本配置一致 |
| 测试 | 真实调用 /v1/images/generations | 确保配置可用 |
| 默认 size | 1920x1080 | 16:9 高清 |
| 默认 quality | hd | 用户要求高清 |

## Data Model

```python
class ModelConfigRecord(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    kind: str = Field(index=True, unique=True)  # "text" | "image"
    base_url: str
    api_key_encrypted: str
    selected_model: str
    configured: bool = False
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    # text-only
    temperature: float | None = None
    max_tokens: int | None = None
    generation_endpoint_type: str | None = None

    # image-only
    image_size: str | None = None       # "1920x1080"
    image_quality: str | None = None    # "hd" | "standard"
```

Migration: `init_db()` 检测旧 schema（PK 为 str "default"）时删表重建。用户需重新填写文本配置一次。

## API Changes

### GET /api/model-config?kind=text|image

返回对应 kind 的配置状态。默认 `kind=text`（向后兼容）。

Response (image):
```json
{
  "configured": true,
  "base_url": "https://...",
  "selected_model": "dall-e-3",
  "image_size": "1920x1080",
  "image_quality": "hd"
}
```

### POST /api/model-config/models

不变。复用现有逻辑拉模型列表。

### POST /api/model-config/image-generation-test

Request:
```json
{
  "base_url": "https://...",
  "api_key": "sk-...",
  "model": "dall-e-3",
  "image_size": "1920x1080",
  "image_quality": "hd"
}
```

后端调用 `POST {base_url}/v1/images/generations`，body:
```json
{
  "model": "dall-e-3",
  "prompt": "a white square on white background",
  "n": 1,
  "size": "1920x1080",
  "quality": "hd",
  "response_format": "url"
}
```

成功返回 `{"ok": true, "message": "image generation test passed"}`。

### POST /api/model-config

Request 增加 `kind` 字段：
```json
{
  "kind": "image",
  "base_url": "...",
  "api_key": "...",
  "selected_model": "dall-e-3",
  "image_size": "1920x1080",
  "image_quality": "hd"
}
```

后端按 `kind` upsert 对应行。

## Frontend Changes

`ModelConfigPage.tsx` 在现有"OpenAI-compatible 配置"卡片下方新增第二张卡片：

- 标题："生图模型配置"
- 副标题："配置 OpenAI-compatible 生图网关。填写 URL 和 Key 后获取模型列表，测试通过后保存。"
- 字段：Base URL / API Key / 获取模型列表按钮 / 模型下拉 / 默认尺寸下拉 / 质量下拉
- 按钮：测试生图 / 保存配置
- 复用 FormField / StatusMessage / card / actions 等现有组件和 CSS class

尺寸下拉选项：`1920x1080`（默认）/ `1024x1024` / `1792x1024` / `1024x1792`

质量下拉选项：`hd`（默认）/ `standard`

## Out of Scope

- 真正用生图配置去生成 PPT 图片（后续功能）
- 非 OpenAI-compatible 协议（即梦/通义/Gemini）
- 多套同类配置（当前每种 kind 只存一行）
