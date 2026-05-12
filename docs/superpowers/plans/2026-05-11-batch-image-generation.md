# Batch Image Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a batch image generation page that uses configured image model to generate images for all slides concurrently (max 3), with real-time progress and lightbox preview.

**Architecture:** Backend adds a generate-images endpoint that spawns an async task with semaphore-controlled concurrency. Frontend adds a new route with grid view showing per-slide status and a lightbox for completed images.

**Tech Stack:** FastAPI, asyncio, SQLModel, React/TypeScript, Vite, zustand

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `backend/app/models/schemas.py` | Add `image_url` to Slide, add `GenerateImagesRequest` |
| Modify | `backend/app/api/generation.py` | Add generate-images endpoint |
| Create | `backend/app/services/image_generation_service.py` | Batch image generation logic with semaphore |
| Modify | `frontend/src/types/api.ts` | Add `image_url` to Slide interface |
| Create | `frontend/src/api/imageGeneration.ts` | API call for generate-images |
| Create | `frontend/src/routes/ImageGenerationPage.tsx` | Batch image generation page |
| Create | `frontend/src/components/ImageLightbox.tsx` | Lightbox modal component |
| Modify | `frontend/src/routes/WorkspacePage.tsx` | Add "批量生图" button |
| Modify | `frontend/src/App.tsx` | Register new route |

---

### Task 1: Add image_url to Slide schema and GenerateImagesRequest

**Files:**
- Modify: `backend/app/models/schemas.py`

- [ ] **Step 1: Add image_url field to Slide class**

In `backend/app/models/schemas.py`, find the `Slide` class. Add after `revision_needed: bool = False`:

```python
    image_url: str | None = None
```

- [ ] **Step 2: Add GenerateImagesRequest schema**

Add after the `ReviseInconsistentPromptsRequest` class (before `ExportRequest`):

```python
class GenerateImagesRequest(BaseModel):
    slide_numbers: list[int] | None = None
```

- [ ] **Step 3: Verify import**

Run: `cd /Users/ronny/vscprojects/split_prompts/backend && .venv/bin/python -c "from app.models.schemas import Slide, GenerateImagesRequest; s = Slide(slide_no=1, title='t', page_type='cover'); print(s.image_url); print('OK')"`

Expected: `None` then `OK`

---

### Task 2: Create image generation service

**Files:**
- Create: `backend/app/services/image_generation_service.py`

- [ ] **Step 1: Create the service file**

Create `backend/app/services/image_generation_service.py`:

```python
import asyncio

from fastapi import HTTPException
from sqlmodel import Session, select

from app.core.gateway_client import GatewayClient, GatewayError
from app.models.job import JobRecord
from app.models.model_config import ModelConfigRecord
from app.models.schemas import ProjectData
from app.services.job_service import JobService
from app.services.project_service import ProjectService

MAX_CONCURRENCY = 3


class ImageGenerationService:
    def __init__(self, session: Session) -> None:
        self.session = session
        self.project_service = ProjectService(session)

    def get_image_config(self) -> ModelConfigRecord:
        statement = select(ModelConfigRecord).where(ModelConfigRecord.kind == "image")
        config = self.session.exec(statement).first()
        if not config or not config.configured:
            raise HTTPException(status_code=400, detail="请先完成生图模型配置")
        return config

    async def run_batch_generation(
        self,
        project_id: str,
        slide_numbers: list[int] | None,
        job_service: JobService,
        job: JobRecord,
    ) -> None:
        config = self.get_image_config()
        data = self.project_service.get_project_data(project_id)

        if not data.slides:
            job_service.update(job, stage="completed", progress=1.0, message="没有可生成的页面", status="completed")
            return

        target_slides = data.slides if slide_numbers is None else [s for s in data.slides if s.slide_no in slide_numbers]

        if not target_slides:
            job_service.update(job, stage="completed", progress=1.0, message="没有匹配的页面", status="completed")
            return

        total = len(target_slides)
        completed = 0
        failed_pages: list[int] = []
        semaphore = asyncio.Semaphore(MAX_CONCURRENCY)

        async def generate_one(slide_index: int, slide_no: int, prompt: str) -> None:
            nonlocal completed
            async with semaphore:
                client = GatewayClient(config.base_url, config.api_key_encrypted)
                try:
                    image_url = await client.image_generation(
                        model=config.selected_model,
                        prompt=prompt,
                        size=config.image_size or "2048x1152",
                        quality=config.image_quality or "hd",
                    )
                    data.slides[slide_index].image_url = image_url
                except (ValueError, GatewayError) as exc:
                    failed_pages.append(slide_no)
                    print(f"[image-gen] slide {slide_no} failed: {exc}", flush=True)

                completed += 1
                self.project_service.save_project_data(data)
                job_service.update(
                    job,
                    stage="generating",
                    progress=completed / total,
                    message=f"已完成 {completed}/{total} 张",
                    status="running",
                )

        tasks = []
        for slide in target_slides:
            idx = next(i for i, s in enumerate(data.slides) if s.slide_no == slide.slide_no)
            prompt = slide.prompt or f"slide {slide.slide_no}"
            tasks.append(generate_one(idx, slide.slide_no, prompt))

        await asyncio.gather(*tasks)

        if failed_pages:
            error_msg = f"以下页面生图失败：{failed_pages}"
            job_service.update(job, stage="completed", progress=1.0, message=f"完成 {completed}/{total} 张", status="completed", error=error_msg)
        else:
            job_service.update(job, stage="completed", progress=1.0, message=f"全部 {total} 张生图完成", status="completed")
```

- [ ] **Step 2: Verify import**

Run: `cd /Users/ronny/vscprojects/split_prompts/backend && .venv/bin/python -c "from app.services.image_generation_service import ImageGenerationService; print('OK')"`

---

### Task 3: Add generate-images endpoint

**Files:**
- Modify: `backend/app/api/generation.py`

- [ ] **Step 1: Add import for new schemas and service**

Add to the imports in `backend/app/api/generation.py`:

After `from app.models.schemas import (`:
```python
    GenerateImagesRequest,
```

After `from app.services.generation_service import GenerationService`:
```python
from app.services.image_generation_service import ImageGenerationService
```

- [ ] **Step 2: Add the endpoint and background task**

Add at the end of the file (after the existing `_run_generation_job` function and other endpoints):

```python
@router.post("/api/projects/{project_id}/generate-images", response_model=JobResponse)
async def generate_images(
    project_id: str,
    request: GenerateImagesRequest,
    session: Session = Depends(get_session),
) -> JobResponse:
    ImageGenerationService(session).get_image_config()
    job_service = JobService(session)
    if job_service.has_active_job(project_id):
        raise HTTPException(status_code=409, detail="当前项目已有正在执行的任务")
    job = job_service.create_job(project_id)
    job_service.update(job, stage="queued", progress=0.0, message="批量生图任务已创建", status="running")
    asyncio.create_task(_run_image_generation_job(job.id, project_id, request.slide_numbers))
    return JobResponse(
        job_id=job.id,
        project_id=job.project_id,
        status=job.status,
        stage=job.stage,
        progress=job.progress,
        message=job.message,
        error=job.error,
    )


async def _run_image_generation_job(job_id: str, project_id: str, slide_numbers: list[int] | None) -> None:
    with Session(engine) as session:
        job_service = JobService(session)
        job = job_service.get_job(job_id)
        try:
            await ImageGenerationService(session).run_batch_generation(
                project_id, slide_numbers, job_service, job
            )
        except Exception as exc:
            job_service.update(job, stage="failed", progress=job.progress, message=str(exc), status="failed", error=str(exc))
```

- [ ] **Step 3: Verify backend starts**

Run: `cd /Users/ronny/vscprojects/split_prompts/backend && .venv/bin/python -c "from app.api.generation import router; print([r.path for r in router.routes])"`

Should include `/api/projects/{project_id}/generate-images`.

---

### Task 4: Update frontend Slide type

**Files:**
- Modify: `frontend/src/types/api.ts`

- [ ] **Step 1: Add image_url to Slide interface**

In `frontend/src/types/api.ts`, find the `Slide` interface. Add after `revision_needed: boolean;`:

```typescript
  image_url?: string | null;
```

---

### Task 5: Add frontend API for image generation

**Files:**
- Create: `frontend/src/api/imageGeneration.ts`

- [ ] **Step 1: Create the API file**

Create `frontend/src/api/imageGeneration.ts`:

```typescript
import { api } from './client';
import type { JobResponse } from '../types/api';

export interface GenerateImagesPayload {
  slide_numbers: number[] | null;
}

export function generateImages(projectId: string, payload: GenerateImagesPayload): Promise<JobResponse> {
  return api(`/api/projects/${projectId}/generate-images`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
```

---

### Task 6: Create ImageLightbox component

**Files:**
- Create: `frontend/src/components/ImageLightbox.tsx`

- [ ] **Step 1: Create the lightbox component**

Create `frontend/src/components/ImageLightbox.tsx`:

```tsx
import { useEffect } from 'react';

interface ImageLightboxProps {
  src: string;
  alt: string;
  onClose: () => void;
}

export function ImageLightbox({ src, alt, onClose }: ImageLightboxProps) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="lightbox-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label={alt}>
      <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
        <img src={src} alt={alt} className="lightbox-image" />
        <button type="button" className="lightbox-close" onClick={onClose} aria-label="关闭预览">&times;</button>
      </div>
    </div>
  );
}
```

---

### Task 7: Create ImageGenerationPage

**Files:**
- Create: `frontend/src/routes/ImageGenerationPage.tsx`

- [ ] **Step 1: Create the page component**

Create `frontend/src/routes/ImageGenerationPage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getProject } from '../api/projects';
import { generateImages } from '../api/imageGeneration';
import { getJob } from '../api/generation';
import { ImageLightbox } from '../components/ImageLightbox';
import { JobProgress } from '../components/JobProgress';
import { StatusMessage } from '../components/StatusMessage';
import { useProjectStore } from '../store/projectStore';
import type { JobResponse } from '../types/api';

export function ImageGenerationPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { project, setProject } = useProjectStore();
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<JobResponse | null>(null);
  const [message, setMessage] = useState<{ kind: 'info' | 'success' | 'error'; text: string } | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [lightboxAlt, setLightboxAlt] = useState('');

  useEffect(() => {
    if (!projectId) return;
    getProject(projectId).then(setProject).catch((error) => setMessage({ kind: 'error', text: error instanceof Error ? error.message : '加载项目失败' }));
  }, [projectId, setProject]);

  async function handleGenerateAll() {
    if (!project) return;
    setBusy(true);
    setMessage(null);
    setJob(null);
    try {
      const createdJob = await generateImages(project.project_id, { slide_numbers: null });
      setJob(createdJob);
      await pollAndRefresh(createdJob.job_id);
      setMessage({ kind: 'success', text: '批量生图完成' });
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : '批量生图失败' });
    } finally {
      setBusy(false);
    }
  }

  async function handleRetrySlide(slideNo: number) {
    if (!project) return;
    setBusy(true);
    setMessage(null);
    setJob(null);
    try {
      const createdJob = await generateImages(project.project_id, { slide_numbers: [slideNo] });
      setJob(createdJob);
      await pollAndRefresh(createdJob.job_id);
      setMessage({ kind: 'success', text: `第${slideNo}页重新生图完成` });
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : '重试失败' });
    } finally {
      setBusy(false);
    }
  }

  async function pollAndRefresh(jobId: string) {
    while (true) {
      await new Promise((resolve) => window.setTimeout(resolve, 2000));
      const latest = await getJob(jobId);
      setJob(latest);
      if (project) {
        const updated = await getProject(project.project_id);
        setProject(updated);
      }
      if (latest.status === 'completed') return;
      if (latest.status === 'failed') throw new Error(latest.error || '生图失败');
      if (latest.status === 'cancelled') throw new Error('任务已取消');
    }
  }

  if (!project || project.project_id !== projectId) {
    return <main className="admin-page"><StatusMessage>正在加载项目...</StatusMessage></main>;
  }

  const hasAnyPrompt = project.slides.some((s) => s.prompt);

  return (
    <main className="admin-page stack">
      <section className="card header-card">
        <div>
          <h1>批量生图</h1>
          <p className="muted">使用生图模型为每页 Slide 的 Prompt 生成图片</p>
        </div>
        <div className="actions">
          <button type="button" onClick={handleGenerateAll} disabled={busy || !hasAnyPrompt}>
            {busy ? '生成中...' : '开始批量生图'}
          </button>
          <Link className="button secondary" to={`/workspace/${project.project_id}`}>返回工作台</Link>
        </div>
      </section>

      {message ? <StatusMessage kind={message.kind}>{message.text}</StatusMessage> : null}
      <JobProgress job={job} />

      <section className="card stack">
        <div className="image-grid">
          {project.slides.map((slide) => (
            <div className="image-card" key={slide.slide_no}>
              <div className="image-card-header">
                <strong>第{slide.slide_no}页</strong>
                <span className="muted">{slide.title}</span>
              </div>
              <div className="image-card-body">
                {slide.image_url ? (
                  <img
                    src={slide.image_url}
                    alt={`第${slide.slide_no}页`}
                    className="image-thumbnail"
                    onClick={() => { setLightboxSrc(slide.image_url!); setLightboxAlt(`第${slide.slide_no}页：${slide.title}`); }}
                  />
                ) : busy ? (
                  <div className="image-placeholder generating">
                    <span className="spinner" />
                    <span>生成中...</span>
                  </div>
                ) : (
                  <div className="image-placeholder">
                    <span className="muted">{slide.prompt ? '待生成' : '无 Prompt'}</span>
                    {slide.prompt && !busy ? (
                      <button type="button" className="secondary small" onClick={() => handleRetrySlide(slide.slide_no)}>生成</button>
                    ) : null}
                  </div>
                )}
              </div>
              <div className="image-card-footer">
                <p className="image-prompt-preview">{slide.prompt ? `${slide.prompt.slice(0, 80)}...` : '—'}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {lightboxSrc ? (
        <ImageLightbox src={lightboxSrc} alt={lightboxAlt} onClose={() => setLightboxSrc(null)} />
      ) : null}
    </main>
  );
}
```

---

### Task 8: Add CSS for image grid and lightbox

**Files:**
- Modify: `frontend/src/styles.css`

- [ ] **Step 1: Add image grid and lightbox styles**

Append to the end of `frontend/src/styles.css`:

```css
/* Image Generation Grid */
.image-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 1rem;
}

.image-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.image-card-header {
  padding: 0.75rem 1rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  border-bottom: 1px solid var(--border);
}

.image-card-body {
  aspect-ratio: 16 / 9;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface-alt, #f5f5f5);
  cursor: pointer;
}

.image-thumbnail {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.image-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 1rem;
}

.image-placeholder.generating .spinner {
  width: 24px;
  height: 24px;
  border: 3px solid var(--border);
  border-top-color: var(--accent, #3b82f6);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.image-card-footer {
  padding: 0.5rem 1rem;
  border-top: 1px solid var(--border);
}

.image-prompt-preview {
  font-size: 0.75rem;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

button.small {
  font-size: 0.75rem;
  padding: 0.25rem 0.5rem;
}

/* Lightbox */
.lightbox-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  cursor: pointer;
}

.lightbox-content {
  position: relative;
  max-width: 90vw;
  max-height: 90vh;
  cursor: default;
}

.lightbox-image {
  max-width: 90vw;
  max-height: 90vh;
  object-fit: contain;
  border-radius: 4px;
}

.lightbox-close {
  position: absolute;
  top: -2rem;
  right: -2rem;
  background: none;
  border: none;
  color: white;
  font-size: 2rem;
  cursor: pointer;
  line-height: 1;
}
```

---

### Task 9: Register route and add workspace entry

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/routes/WorkspacePage.tsx`

- [ ] **Step 1: Add route to App.tsx**

In `frontend/src/App.tsx`, add the import:

```typescript
import { ImageGenerationPage } from './routes/ImageGenerationPage';
```

Add the route after the workspace route (after line `<Route path="workspace/:projectId" element={<WorkspacePage />} />`):

```tsx
        <Route path="workspace/:projectId/images" element={<ImageGenerationPage />} />
```

- [ ] **Step 2: Add entry button to WorkspacePage**

In `frontend/src/routes/WorkspacePage.tsx`, find the actions div in the header card (around line 87-89):

```tsx
        <div className="actions">
          {canResume ? <button type="button" className="secondary" disabled={busy !== null} onClick={resumeGeneration}>继续生成</button> : null}
          <Link className="button" to={`/review/${project.project_id}`}>审核与导出</Link>
        </div>
```

Replace with:

```tsx
        <div className="actions">
          {canResume ? <button type="button" className="secondary" disabled={busy !== null} onClick={resumeGeneration}>继续生成</button> : null}
          <Link className="button secondary" to={`/workspace/${project.project_id}/images`}>批量生图</Link>
          <Link className="button" to={`/review/${project.project_id}`}>审核与导出</Link>
        </div>
```

- [ ] **Step 3: Verify frontend builds**

Run: `cd /Users/ronny/vscprojects/split_prompts/frontend && npm run build`

---

### Task 10: End-to-end verification

- [ ] **Step 1: Start backend**

Run: `cd /Users/ronny/vscprojects/split_prompts/backend && .venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000`

- [ ] **Step 2: Start frontend dev server**

Run: `cd /Users/ronny/vscprojects/split_prompts/frontend && npm run dev`

- [ ] **Step 3: Manual test in browser**

1. Open http://localhost:5173 → open an existing project workspace
2. Verify "批量生图" button appears in workspace header
3. Click it → navigate to image generation page
4. Verify slide grid shows all slides with prompt previews
5. Click "开始批量生图" → verify progress updates
6. After completion, verify thumbnails appear
7. Click a thumbnail → verify lightbox opens with full image
8. Press ESC → verify lightbox closes

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add batch image generation page

- Add generate-images endpoint with semaphore-controlled concurrency (max 3)
- Add ImageGenerationPage with grid view and real-time progress
- Add lightbox preview for completed images
- Add retry for individual failed slides
- Add entry button from WorkspacePage

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```
