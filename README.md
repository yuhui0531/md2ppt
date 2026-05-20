# Markdown to PPT App (md2ppt)

English | [中文](README.zh-CN.md)

A local web application that turns Markdown raw materials into PPT-style slide decks. It uses LLM-driven outlining and prompt generation to produce per-slide image prompts, generates slide images via a configurable image model gateway, and exports the result as a Markdown bundle or a `.pptx` file.

## Features

- **Markdown → slide outline**: Parses uploaded Markdown and asks an LLM to produce a structured slide outline.
- **Import existing prompts**: Support for importing existing prompts from a ZIP archive or multiple `.md` files, skipping the initial generation phase.
- **Per-slide prompt generation**: Generates image prompts for each slide with optional style-guide constraints.
- **Consistency checking**: Reviews prompts across slides and revises inconsistent ones to keep a cohesive visual style.
- **Batch image generation**: Calls an image generation gateway to render each slide, with progress tracking and an in-app lightbox preview.
- **Retry & refine**: Resizable retry textarea for re-prompting individual slides; regenerate outline or prompts at any time.
- **SSO Integration**: Secure login and session management via SSO.
- **Export**: Download the project as a Markdown archive or a `.pptx` deck.
- **Configurable models**: Switch between text and image model providers from the admin UI; credentials and base URLs are stored locally.
- **Job polling**: Long-running generation tasks run as background jobs with a `/api/jobs/{id}` poll endpoint.

## Architecture

```
md2ppt/
├── backend/                 FastAPI + SQLModel (SQLite)
│   └── app/
│       ├── api/             HTTP routers (projects, generation, export, model_config, sso, images)
│       ├── services/        Markdown parsing, generation, image generation, export, jobs, import
│       ├── models/          SQLModel ORM + Pydantic schemas
│       ├── core/            Shared utilities (auth, security, gateway_client)
│       ├── templates/       Prompt templates
│       ├── storage/         SQLite db, uploads/, exports/, images/ (gitignored)
│       ├── config.py        Settings (APP_* env vars)
│       └── main.py          FastAPI app entrypoint
└── frontend/                React + TypeScript + Vite + Ant Design + Zustand
    └── src/
        ├── routes/          Pages: Projects, Upload, Workspace, ImageGeneration, ReviewExport, ModelConfig
        ├── components/      AdminLayout, JobProgress, ImageLightbox, MarkdownPreview, …
        ├── api/             API client
        ├── store/           Zustand stores
        └── types/           Shared TypeScript types
```

### Tech stack

| Layer    | Stack                                                                       |
|----------|-----------------------------------------------------------------------------|
| Backend  | Python 3.11+, FastAPI, Uvicorn, SQLModel, Pydantic v2, httpx, python-pptx   |
| Frontend | React, TypeScript, Vite, Ant Design 6, Zustand, react-router-dom, react-markdown |
| Storage  | SQLite (local file under `backend/app/storage/`)                            |

## Getting started

### Prerequisites

- Python 3.11+
- Node.js 18+
- [`uv`](https://docs.astral.sh/uv/) (recommended) or `pip` for Python dependency management

### 1. Backend

```bash
cd backend
uv sync                            # or: pip install -e .
uv run uvicorn app.main:app --reload --port 8000
```

The API serves at `http://localhost:8000`. A SQLite database is created automatically at `backend/app/storage/app.db` on first run.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

The UI is served at `http://localhost:5173` and is pre-configured in CORS as an allowed origin.

### 3. Configure models

Open the **Model Config** page in the UI and provide:

- A text-generation gateway (OpenAI-compatible base URL + API key + model name).
- An image-generation gateway (OpenAI-compatible base URL + API key + model name).

Use the built-in "Test" buttons to verify connectivity before running a project.

## Configuration

Backend settings are read from environment variables (prefix `APP_`) or a `.env` file in `backend/`:

| Variable                         | Default                                          | Description                                          |
|----------------------------------|--------------------------------------------------|------------------------------------------------------|
| `APP_STORAGE_DIR`                | `backend/app/storage`                            | Directory for SQLite db, uploads, and exports.       |
| `APP_DATABASE_URL`               | `sqlite:///<storage_dir>/app.db`                 | SQLModel database URL.                               |
| `APP_ALLOW_LOCAL_GATEWAY_URLS`   | `false`                                          | Allow `localhost` / private IPs as gateway base URLs.|
| `APP_GATEWAY_TIMEOUT_SECONDS`    | `180`                                            | Outbound HTTP timeout to model gateways.             |
| `APP_MAX_GATEWAY_RESPONSE_BYTES` | `4000000`                                        | Maximum response size accepted from gateways.        |

## Typical workflow

1. **Projects** → Create a new project or **Import** existing prompts.
2. **Upload/Import** → Paste Markdown or upload/import `.md`/ZIP files.
3. **Workspace** → Generate/Refine the slide outline and prompts. Run consistency checks and revise as needed.
4. **Image Generation** → Trigger batch image generation; monitor progress; preview slides; retry with refined prompts.
5. **Review & Export** → Download the project as a Markdown bundle or `.pptx`.

## API overview

All endpoints are under `http://localhost:8000`.

| Method | Path                                                | Purpose                              |
|--------|-----------------------------------------------------|--------------------------------------|
| GET    | `/api/health`                                       | Health check                         |
| GET/POST/PATCH/DELETE | `/api/projects`, `/api/projects/{id}` | Project CRUD                         |
| POST   | `/api/projects/import-prompts`                      | Import ZIP or multiple .md files     |
| GET    | `/api/projects/{id}/active-job`                     | Get active job for project           |
| POST   | `/api/projects/{id}/generate`                       | Start outline + prompt generation    |
| POST   | `/api/projects/{id}/regenerate-outline`             | Regenerate slide outline             |
| POST   | `/api/projects/{id}/regenerate-prompts`             | Regenerate individual slide prompts  |
| POST   | `/api/projects/{id}/regenerate-prompts-job`         | Regenerate all prompts as a job      |
| POST   | `/api/projects/{id}/regenerate-import-structure`    | Re-run structure extraction          |
| POST   | `/api/projects/{id}/check-consistency`              | Run consistency review               |
| POST   | `/api/projects/{id}/revise-inconsistent-prompts`    | Revise flagged prompts               |
| POST   | `/api/projects/{id}/generate-images`                | Start batch image generation         |
| GET    | `/api/jobs/{job_id}`                                | Poll job status                      |
| POST   | `/api/jobs/{job_id}/cancel`                         | Cancel a running job                 |
| POST   | `/api/projects/{id}/slides`                         | Create a new slide                   |
| PATCH  | `/api/projects/{id}/slides/{slide_id}`              | Update a slide's prompt              |
| DELETE | `/api/projects/{id}/slides/{slide_id}`              | Delete a slide                       |
| POST   | `/api/projects/{id}/export`                         | Export as Markdown bundle            |
| POST   | `/api/projects/{id}/export-pptx`                    | Export as `.pptx`                    |
| GET    | `/api/exports/{file}/download`                      | Download a generated export          |
| GET/POST | `/api/model-config`, `/api/model-config/image`    | Read/save text/image model configs   |
| POST   | `/api/model-config/models`                          | List models from a gateway           |
| POST   | `/api/model-config/generation-test`                 | Smoke-test text generation           |
| POST   | `/api/model-config/image-generation-test`           | Smoke-test image generation          |
| POST   | `/api/md2ppt/sso/login`                             | SSO login                            |
| GET    | `/api/md2ppt/sso/whoami`                            | Get current user profile             |
| POST   | `/api/md2ppt/sso/logout`                            | SSO logout                           |

Interactive docs are available at `http://localhost:8000/docs` once the backend is running.

## Development notes

- Uvicorn access logs for `/api/jobs/...` and `/api/projects/{id}` polling are filtered out to keep logs readable (see `app/main.py`).
- Generated artifacts live under `backend/app/storage/` and are gitignored.
- The frontend talks directly to `http://localhost:8000`; update CORS in `app/main.py` if you change the dev origin.

## License

Released under the [MIT License](LICENSE).
