# Image Model Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add image generation model configuration alongside existing text model config, with independent base_url/api_key/model and a test-generation button.

**Architecture:** Extend `ModelConfigRecord` with `kind` column (unique) and image-specific fields. Migrate PK from str to int. Add image-generation-test endpoint. Frontend adds a second card on ModelConfigPage.

**Tech Stack:** FastAPI, SQLModel/SQLite, React/TypeScript, Vite

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `backend/app/models/model_config.py` | Add `kind`, `image_size`, `image_quality`; change PK to int |
| Modify | `backend/app/models/db.py` | Add migration logic for old schema |
| Modify | `backend/app/models/schemas.py` | Add image config request/response schemas |
| Modify | `backend/app/api/model_config.py` | Add `kind` query param to GET; add image-generation-test endpoint; update save logic |
| Modify | `backend/app/core/gateway_client.py` | Add `image_generation` method |
| Modify | `backend/app/services/generation_service.py:443` | Change lookup from `session.get(ModelConfigRecord, "default")` to query by kind |
| Modify | `frontend/src/types/api.ts` | Add `ImageModelConfigStatus` interface |
| Modify | `frontend/src/api/modelConfig.ts` | Add image config API functions |
| Modify | `frontend/src/routes/ModelConfigPage.tsx` | Add image config card section |

---

### Task 1: Modify ModelConfigRecord schema

**Files:**
- Modify: `backend/app/models/model_config.py`

- [ ] **Step 1: Rewrite ModelConfigRecord with new schema**

```python
from datetime import datetime
from typing import Optional

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
```

- [ ] **Step 2: Verify the file is saved correctly**

Run: `python3 -c "from app.models.model_config import ModelConfigRecord; print(ModelConfigRecord.__fields__.keys())"`
(from backend directory)

---

### Task 2: Add migration logic in db.py

**Files:**
- Modify: `backend/app/models/db.py`

- [ ] **Step 1: Add schema migration to init_db**

Replace `init_db()` with:

```python
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
```

- [ ] **Step 2: Verify migration logic**

Run: `python3 -c "from app.models.db import init_db; init_db(); print('OK')"`
(from backend directory)

---

### Task 3: Add image-related schemas

**Files:**
- Modify: `backend/app/models/schemas.py`

- [ ] **Step 1: Add new schemas after existing ModelConfigStatusResponse**

Add these classes after line 59 (after `ModelConfigStatusResponse`):

```python
class ImageModelConfigStatusResponse(BaseModel):
    configured: bool
    base_url: str | None = None
    selected_model: str | None = None
    image_size: str | None = None
    image_quality: str | None = None


class ImageGenerationTestRequest(BaseModel):
    base_url: str
    api_key: str = Field(min_length=1)
    model: str = Field(min_length=1)
    image_size: str = "1920x1080"
    image_quality: str = "hd"


class ImageGenerationTestResponse(BaseModel):
    ok: bool
    message: str


class SaveImageModelConfigRequest(BaseModel):
    base_url: str
    api_key: str = Field(min_length=1)
    selected_model: str = Field(min_length=1)
    image_size: str = "1920x1080"
    image_quality: str = "hd"
```

- [ ] **Step 2: Verify import**

Run: `python3 -c "from app.models.schemas import ImageGenerationTestRequest; print('OK')"`

---

### Task 4: Add image_generation method to GatewayClient

**Files:**
- Modify: `backend/app/core/gateway_client.py`

- [ ] **Step 1: Add image_generation method**

Add this method to the `GatewayClient` class after `chat_completion_json`:

```python
    async def image_generation(self, model: str, prompt: str, size: str = "1920x1080", quality: str = "hd") -> str:
        url = f"{self.base_url}/v1/images/generations"
        payload = {
            "model": model,
            "prompt": prompt,
            "n": 1,
            "size": size,
            "quality": quality,
            "response_format": "url",
        }
        async with httpx.AsyncClient(
            timeout=settings.gateway_timeout_seconds,
            follow_redirects=False,
        ) as client:
            try:
                response = await client.post(url, headers=self._headers(), json=payload)
            except httpx.HTTPError as exc:
                raise GatewayError(f"生图请求失败：{exc.__class__.__name__}") from exc
        if response.is_redirect:
            raise GatewayError("模型网关返回重定向，已拒绝跟随")
        if response.status_code == 401:
            raise GatewayError("API Key 无效或未授权")
        if response.status_code >= 400:
            raise GatewayError(f"生图请求失败：HTTP {response.status_code} {response.text[:200]}")
        if len(response.content) > settings.max_gateway_response_bytes:
            raise GatewayError("生图响应过大")
        try:
            result = response.json()
        except ValueError as exc:
            raise GatewayError("生图响应不是合法 JSON") from exc
        data = result.get("data")
        if not isinstance(data, list) or not data:
            raise GatewayError("生图响应缺少 data 数组")
        first = data[0]
        image_url = first.get("url") or first.get("b64_json")
        if not image_url:
            raise GatewayError("生图响应缺少图片 URL")
        return image_url
```

- [ ] **Step 2: Verify import**

Run: `python3 -c "from app.core.gateway_client import GatewayClient; print('OK')"`

---

### Task 5: Update API router for image config

**Files:**
- Modify: `backend/app/api/model_config.py`

- [ ] **Step 1: Update imports**

Replace the imports from `app.models.schemas` with:

```python
from app.models.schemas import (
    GenerationTestRequest,
    GenerationTestResponse,
    ImageGenerationTestRequest,
    ImageGenerationTestResponse,
    ImageModelConfigStatusResponse,
    ModelConfigStatusResponse,
    ModelInfo,
    ModelListRequest,
    ModelListResponse,
    SaveImageModelConfigRequest,
    SaveModelConfigRequest,
    SaveModelConfigResponse,
)
```

- [ ] **Step 2: Update GET endpoint to support kind parameter**

Replace the `get_model_config` function:

```python
from sqlmodel import select

@router.get("", response_model=ModelConfigStatusResponse | ImageModelConfigStatusResponse)
def get_model_config(kind: str = "text", session: Session = Depends(get_session)):
    statement = select(ModelConfigRecord).where(ModelConfigRecord.kind == kind)
    record = session.exec(statement).first()
    if kind == "image":
        if not record or not record.configured:
            return ImageModelConfigStatusResponse(configured=False)
        return ImageModelConfigStatusResponse(
            configured=True,
            base_url=record.base_url,
            selected_model=record.selected_model,
            image_size=record.image_size,
            image_quality=record.image_quality,
        )
    if not record or not record.configured:
        return ModelConfigStatusResponse(configured=False)
    return ModelConfigStatusResponse(
        configured=True,
        base_url=record.base_url,
        selected_model=record.selected_model,
        temperature=record.temperature,
        max_tokens=record.max_tokens,
        generation_endpoint_type=record.generation_endpoint_type,
    )
```

- [ ] **Step 3: Add image-generation-test endpoint**

Add after the existing `generation_test` function:

```python
@router.post("/image-generation-test", response_model=ImageGenerationTestResponse)
async def image_generation_test(request: ImageGenerationTestRequest) -> ImageGenerationTestResponse:
    try:
        client = GatewayClient(request.base_url, request.api_key)
        await client.image_generation(
            request.model,
            "a white square on white background",
            size=request.image_size,
            quality=request.image_quality,
        )
    except (ValueError, GatewayError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ImageGenerationTestResponse(ok=True, message="image generation test passed")
```

- [ ] **Step 4: Update save endpoint to support kind**

Replace the `save_model_config` function:

```python
@router.post("", response_model=SaveModelConfigResponse)
def save_model_config(
    request: SaveModelConfigRequest | SaveImageModelConfigRequest,
    session: Session = Depends(get_session),
) -> SaveModelConfigResponse:
    is_image = isinstance(request, SaveImageModelConfigRequest)
    kind = "image" if is_image else "text"

    try:
        base_url = validate_gateway_base_url(request.base_url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    statement = select(ModelConfigRecord).where(ModelConfigRecord.kind == kind)
    record = session.exec(statement).first()
    now = datetime.now(timezone.utc)

    if record:
        record.base_url = base_url
        record.api_key_encrypted = request.api_key
        record.selected_model = request.selected_model
        record.configured = True
        record.updated_at = now
        if is_image:
            record.image_size = request.image_size
            record.image_quality = request.image_quality
        else:
            record.temperature = request.temperature
            record.max_tokens = request.max_tokens
            record.generation_endpoint_type = request.generation_endpoint_type
    else:
        fields = {
            "kind": kind,
            "base_url": base_url,
            "api_key_encrypted": request.api_key,
            "selected_model": request.selected_model,
            "configured": True,
            "updated_at": now,
        }
        if is_image:
            fields["image_size"] = request.image_size
            fields["image_quality"] = request.image_quality
        else:
            fields["temperature"] = request.temperature
            fields["max_tokens"] = request.max_tokens
            fields["generation_endpoint_type"] = request.generation_endpoint_type
        record = ModelConfigRecord(**fields)

    session.add(record)
    session.commit()
    return SaveModelConfigResponse(config_id=str(record.id), selected_model=request.selected_model, configured=True)
```

Note: FastAPI cannot discriminate `Union` request bodies automatically. We need to use separate endpoints instead. Change the save to two endpoints:

Actually, cleaner approach — add a dedicated image save endpoint:

```python
@router.post("/image", response_model=SaveModelConfigResponse)
def save_image_model_config(
    request: SaveImageModelConfigRequest,
    session: Session = Depends(get_session),
) -> SaveModelConfigResponse:
    try:
        base_url = validate_gateway_base_url(request.base_url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    statement = select(ModelConfigRecord).where(ModelConfigRecord.kind == "image")
    record = session.exec(statement).first()
    now = datetime.now(timezone.utc)

    if record:
        record.base_url = base_url
        record.api_key_encrypted = request.api_key
        record.selected_model = request.selected_model
        record.image_size = request.image_size
        record.image_quality = request.image_quality
        record.configured = True
        record.updated_at = now
    else:
        record = ModelConfigRecord(
            kind="image",
            base_url=base_url,
            api_key_encrypted=request.api_key,
            selected_model=request.selected_model,
            image_size=request.image_size,
            image_quality=request.image_quality,
            configured=True,
            updated_at=now,
        )

    session.add(record)
    session.commit()
    return SaveModelConfigResponse(config_id=str(record.id), selected_model=request.selected_model, configured=True)
```

- [ ] **Step 5: Update existing save_model_config to use kind="text" lookup**

Replace the existing `save_model_config` body to query by `kind="text"` instead of `session.get(ModelConfigRecord, "default")`:

```python
@router.post("", response_model=SaveModelConfigResponse)
def save_model_config(
    request: SaveModelConfigRequest,
    session: Session = Depends(get_session),
) -> SaveModelConfigResponse:
    try:
        base_url = validate_gateway_base_url(request.base_url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    statement = select(ModelConfigRecord).where(ModelConfigRecord.kind == "text")
    record = session.exec(statement).first()
    now = datetime.now(timezone.utc)

    if record:
        record.base_url = base_url
        record.api_key_encrypted = request.api_key
        record.selected_model = request.selected_model
        record.temperature = request.temperature
        record.max_tokens = request.max_tokens
        record.generation_endpoint_type = request.generation_endpoint_type
        record.configured = True
        record.updated_at = now
    else:
        record = ModelConfigRecord(
            kind="text",
            base_url=base_url,
            api_key_encrypted=request.api_key,
            selected_model=request.selected_model,
            temperature=request.temperature,
            max_tokens=request.max_tokens,
            generation_endpoint_type=request.generation_endpoint_type,
            configured=True,
            updated_at=now,
        )

    session.add(record)
    session.commit()
    return SaveModelConfigResponse(config_id=str(record.id), selected_model=request.selected_model, configured=True)
```

- [ ] **Step 6: Add `select` import at top of file**

Add `from sqlmodel import Session, select` (replace existing `from sqlmodel import Session`).

- [ ] **Step 7: Verify backend starts**

Run: `cd /Users/ronny/vscprojects/split_prompts/backend && python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000 &` then `curl http://localhost:8000/api/model-config?kind=image`

---

### Task 6: Update generation_service.py to use kind-based lookup

**Files:**
- Modify: `backend/app/services/generation_service.py:442-443`

- [ ] **Step 1: Add select import and update _require_model_config**

Add `from sqlmodel import select` to imports (line 7 area).

Replace `_require_model_config` method:

```python
    def _require_model_config(self) -> ModelConfigRecord:
        statement = select(ModelConfigRecord).where(ModelConfigRecord.kind == "text")
        config = self.session.exec(statement).first()
        if not config or not config.configured:
            raise HTTPException(status_code=400, detail="请先完成模型配置")
        return config
```

---

### Task 7: Update frontend types

**Files:**
- Modify: `frontend/src/types/api.ts`

- [ ] **Step 1: Add ImageModelConfigStatus interface**

Add after `ModelConfigStatus` (after line 16):

```typescript
export interface ImageModelConfigStatus {
  configured: boolean;
  base_url?: string | null;
  selected_model?: string | null;
  image_size?: string | null;
  image_quality?: string | null;
}
```

---

### Task 8: Update frontend API layer

**Files:**
- Modify: `frontend/src/api/modelConfig.ts`

- [ ] **Step 1: Add image config API functions**

Add the import of `ImageModelConfigStatus` and add these functions/types at the end of the file:

```typescript
import type { ImageModelConfigStatus, ModelConfigStatus, ModelInfo } from '../types/api';
```

(Replace the existing import line.)

Add these types and functions:

```typescript
export interface ImageGenerationTestPayload {
  base_url: string;
  api_key: string;
  model: string;
  image_size: string;
  image_quality: string;
}

export interface SaveImageModelConfigPayload {
  base_url: string;
  api_key: string;
  selected_model: string;
  image_size: string;
  image_quality: string;
}

export function getImageModelConfig(): Promise<ImageModelConfigStatus> {
  return api<ImageModelConfigStatus>('/api/model-config?kind=image');
}

export function testImageGeneration(payload: ImageGenerationTestPayload): Promise<{ ok: boolean; message: string }> {
  return api('/api/model-config/image-generation-test', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function saveImageModelConfig(payload: SaveImageModelConfigPayload): Promise<{ config_id: string; selected_model: string; configured: boolean }> {
  return api('/api/model-config/image', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
```

---

### Task 9: Add image config card to ModelConfigPage

**Files:**
- Modify: `frontend/src/routes/ModelConfigPage.tsx`

- [ ] **Step 1: Add image config state and handlers**

Add imports at top:

```typescript
import { getModelConfig, getImageModelConfig, listModels, saveModelConfig, saveImageModelConfig, testGeneration, testImageGeneration } from '../api/modelConfig';
import type { ImageModelConfigStatus, ModelInfo } from '../types/api';
```

(Replace existing imports from `'../api/modelConfig'` and `'../types/api'`.)

Add state variables inside the component (after existing state):

```typescript
  // Image config state
  const [imgBaseUrl, setImgBaseUrl] = useState('');
  const [imgApiKey, setImgApiKey] = useState('');
  const [imgSelectedModel, setImgSelectedModel] = useState('');
  const [imgSize, setImgSize] = useState('1920x1080');
  const [imgQuality, setImgQuality] = useState('hd');
  const [imgModels, setImgModels] = useState<ModelInfo[]>([]);
  const [imgTested, setImgTested] = useState(false);
  const [imgBusy, setImgBusy] = useState<string | null>(null);
  const [imgMessage, setImgMessage] = useState<{ kind: 'info' | 'success' | 'error'; text: string } | null>(null);

  const canFetchImgModels = useMemo(() => imgBaseUrl.trim() && imgApiKey.trim(), [imgBaseUrl, imgApiKey]);
  const canTestImg = useMemo(() => canFetchImgModels && imgSelectedModel, [canFetchImgModels, imgSelectedModel]);
  const canSaveImg = useMemo(() => canTestImg && imgTested, [canTestImg, imgTested]);
```

- [ ] **Step 2: Add useEffect to load existing image config**

Add after the existing `useEffect`:

```typescript
  useEffect(() => {
    getImageModelConfig()
      .then((config) => {
        if (!config.configured) return;
        setImgBaseUrl(config.base_url ?? '');
        setImgSelectedModel(config.selected_model ?? '');
        setImgSize(config.image_size ?? '1920x1080');
        setImgQuality(config.image_quality ?? 'hd');
        setImgMessage({ kind: 'info', text: '已加载现有生图模型配置；如需修改，请重新填写 API Key 并测试。' });
      })
      .catch(() => undefined);
  }, []);
```

- [ ] **Step 3: Add image config handler functions**

Add after existing `handleSave`:

```typescript
  async function handleListImgModels() {
    setImgBusy('models');
    setImgMessage(null);
    setImgTested(false);
    try {
      const result = await listModels({ base_url: imgBaseUrl.trim(), api_key: imgApiKey.trim(), models_endpoint: '/v1/models' });
      setImgModels(result);
      setImgSelectedModel(result[0]?.id ?? '');
      setImgMessage({ kind: 'success', text: `获取到 ${result.length} 个模型。` });
    } catch (error) {
      setImgMessage({ kind: 'error', text: error instanceof Error ? error.message : '获取模型列表失败' });
    } finally {
      setImgBusy(null);
    }
  }

  async function handleTestImageGeneration() {
    setImgBusy('test');
    setImgMessage(null);
    setImgTested(false);
    try {
      await testImageGeneration({
        base_url: imgBaseUrl.trim(),
        api_key: imgApiKey.trim(),
        model: imgSelectedModel,
        image_size: imgSize,
        image_quality: imgQuality,
      });
      setImgTested(true);
      setImgMessage({ kind: 'success', text: '生图测试通过，可以保存配置。' });
    } catch (error) {
      setImgMessage({ kind: 'error', text: error instanceof Error ? error.message : '生图测试失败' });
    } finally {
      setImgBusy(null);
    }
  }

  async function handleSaveImageConfig() {
    setImgBusy('save');
    setImgMessage(null);
    try {
      await saveImageModelConfig({
        base_url: imgBaseUrl.trim(),
        api_key: imgApiKey.trim(),
        selected_model: imgSelectedModel,
        image_size: imgSize,
        image_quality: imgQuality,
      });
      setImgMessage({ kind: 'success', text: '生图模型配置已保存。' });
    } catch (error) {
      setImgMessage({ kind: 'error', text: error instanceof Error ? error.message : '保存配置失败' });
    } finally {
      setImgBusy(null);
    }
  }
```

- [ ] **Step 4: Add image config card JSX**

Add this section after the closing `</section>` of the existing text config card (before `</main>`):

```tsx
      <section className="card stack panel-shell">
        <div className="section-head">
          <div>
            <h2>生图模型配置</h2>
            <p className="muted">配置 OpenAI-compatible 生图网关。填写 URL 和 Key 后获取模型列表，测试通过后保存。</p>
          </div>
        </div>

        {imgMessage ? <StatusMessage kind={imgMessage.kind}>{imgMessage.text}</StatusMessage> : null}

        <FormField label="Base URL" hint="生图服务的 API 地址，例如：https://api.openai.com">
          <input value={imgBaseUrl} onChange={(event) => { setImgBaseUrl(event.target.value); setImgTested(false); }} placeholder="https://..." />
        </FormField>

        <FormField label="API Key" hint="生图服务的 API Key。">
          <input value={imgApiKey} onChange={(event) => { setImgApiKey(event.target.value); setImgTested(false); }} placeholder="sk-..." type="password" />
        </FormField>

        <div className="actions">
          <button type="button" onClick={handleListImgModels} disabled={!canFetchImgModels || imgBusy !== null}>
            {imgBusy === 'models' ? '获取中...' : '获取模型列表'}
          </button>
        </div>

        <FormField label="生图模型">
          <select value={imgSelectedModel} onChange={(event) => { setImgSelectedModel(event.target.value); setImgTested(false); }}>
            {imgSelectedModel && !imgModels.some((model) => model.id === imgSelectedModel) ? <option value={imgSelectedModel}>{imgSelectedModel}</option> : null}
            <option value="">请选择模型</option>
            {imgModels.map((model) => (
              <option key={model.id} value={model.id}>{model.id}</option>
            ))}
          </select>
        </FormField>

        <div className="grid two">
          <FormField label="默认尺寸">
            <select value={imgSize} onChange={(event) => setImgSize(event.target.value)}>
              <option value="1920x1080">1920x1080 (16:9)</option>
              <option value="1024x1024">1024x1024 (1:1)</option>
              <option value="1792x1024">1792x1024</option>
              <option value="1024x1792">1024x1792</option>
            </select>
          </FormField>
          <FormField label="质量">
            <select value={imgQuality} onChange={(event) => setImgQuality(event.target.value)}>
              <option value="hd">hd</option>
              <option value="standard">standard</option>
            </select>
          </FormField>
        </div>

        <div className="actions">
          <button type="button" className="secondary" onClick={handleTestImageGeneration} disabled={!canTestImg || imgBusy !== null}>
            {imgBusy === 'test' ? '测试中...' : '测试生图'}
          </button>
          <button type="button" onClick={handleSaveImageConfig} disabled={!canSaveImg || imgBusy !== null}>
            {imgBusy === 'save' ? '保存中...' : '保存配置'}
          </button>
        </div>
      </section>
```

- [ ] **Step 5: Verify frontend builds**

Run: `cd /Users/ronny/vscprojects/split_prompts/frontend && npm run build`

---

### Task 10: End-to-end verification

- [ ] **Step 1: Start backend**

Run: `cd /Users/ronny/vscprojects/split_prompts/backend && python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000`

- [ ] **Step 2: Start frontend dev server**

Run: `cd /Users/ronny/vscprojects/split_prompts/frontend && npm run dev`

- [ ] **Step 3: Manual test in browser**

1. Open http://localhost:5173 → navigate to model config page
2. Verify existing text config card still works (fill URL/key → list models → test → save)
3. Verify new image config card appears below
4. Fill image config (URL/key → list models → select model → pick size/quality → test → save)
5. Refresh page → verify both configs load correctly

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add image generation model config

Add independent image model configuration alongside existing text model config.
- Extend ModelConfigRecord with kind column (text/image) and image-specific fields
- Migrate PK from str to int autoincrement
- Add /api/model-config/image-generation-test endpoint
- Add /api/model-config/image save endpoint
- Add image config card on ModelConfigPage with test-before-save flow

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```
