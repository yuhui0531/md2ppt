# Markdown to PPT App (md2ppt)

[English](README.md) | 中文

一个本地运行的 Web 应用，可将 Markdown 原始素材转换为 PPT 风格的幻灯片。基于 LLM 进行大纲拆分与逐页图像 Prompt 生成，调用可配置的图像生成网关渲染每一页幻灯片，并支持导出为 Markdown 资料包或 `.pptx` 文件。

## 功能特性

- **Markdown → 幻灯片大纲**：解析上传的 Markdown，并由 LLM 生成结构化的幻灯片大纲。
- **逐页 Prompt 生成**：为每一页幻灯片生成图像 Prompt，并可选地结合 Style Guide 约束统一风格。
- **一致性检查**：对全部幻灯片的 Prompt 做一致性审查，并自动修订风格不一致的 Prompt。
- **批量图像生成**：调用图像生成网关批量渲染幻灯片，支持进度跟踪与应用内灯箱预览。
- **重试与微调**：每页幻灯片提供可调整大小的重试输入区，可对单页 Prompt 进行重生成；大纲与 Prompt 均可随时再生。
- **导出**：将项目导出为 Markdown 归档或 `.pptx` 演示文稿。
- **可配置模型**：在管理界面切换文本与图像模型供应商；密钥与 Base URL 本地保存。
- **任务轮询**：长耗时的生成任务以后台 Job 方式运行，通过 `/api/jobs/{id}` 轮询状态。

## 项目结构

```
split_prompts/
├── backend/                 FastAPI + SQLModel（SQLite）
│   └── app/
│       ├── api/             HTTP 路由（projects / generation / export / model_config）
│       ├── services/        Markdown 解析、生成、图像生成、导出、Job 等服务
│       ├── models/          SQLModel ORM 与 Pydantic Schema
│       ├── core/            通用工具
│       ├── templates/       Prompt 模板
│       ├── storage/         SQLite 数据库、uploads/、exports/（已被 gitignore）
│       ├── config.py        配置项（APP_* 环境变量）
│       └── main.py          FastAPI 应用入口
└── frontend/                React + TypeScript + Vite + Ant Design + Zustand
    └── src/
        ├── routes/          页面：Projects、Upload、Workspace、ImageGeneration、ReviewExport、ModelConfig
        ├── components/      AdminLayout、JobProgress、ImageLightbox、MarkdownPreview…
        ├── api/             API 客户端
        ├── store/           Zustand 状态
        └── types/           共用 TypeScript 类型
```

### 技术栈

| 模块     | 技术                                                                          |
|----------|-------------------------------------------------------------------------------|
| 后端     | Python 3.11+、FastAPI、Uvicorn、SQLModel、Pydantic v2、httpx、python-pptx     |
| 前端     | React、TypeScript、Vite、Ant Design 6、Zustand、react-router-dom、react-markdown |
| 存储     | SQLite（位于 `backend/app/storage/` 下的本地文件）                            |

## 快速开始

### 环境要求

- Python 3.11+
- Node.js 18+
- 推荐使用 [`uv`](https://docs.astral.sh/uv/) 管理 Python 依赖，亦可使用 `pip`

### 1. 后端

```bash
cd backend
uv sync                            # 或：pip install -e .
uv run uvicorn app.main:app --reload --port 8000
```

API 默认监听 `http://localhost:8000`。首次运行会在 `backend/app/storage/app.db` 自动创建 SQLite 数据库。

### 2. 前端

```bash
cd frontend
npm install
npm run dev
```

前端在 `http://localhost:5173` 提供服务，已在后端 CORS 白名单中。

### 3. 配置模型

进入 UI 中的 **Model Config** 页面，分别填写：

- 文本生成网关：兼容 OpenAI 风格的 Base URL、API Key 和模型名。
- 图像生成网关：兼容 OpenAI 风格的 Base URL、API Key 和模型名。

可使用内置的 “Test” 按钮先做连通性验证。

## 配置项

后端通过环境变量（前缀 `APP_`）或 `backend/.env` 文件读取配置：

| 变量名                            | 默认值                                           | 说明                                            |
|-----------------------------------|--------------------------------------------------|-------------------------------------------------|
| `APP_STORAGE_DIR`                 | `backend/app/storage`                            | SQLite、上传与导出文件目录。                    |
| `APP_DATABASE_URL`                | `sqlite:///<storage_dir>/app.db`                 | SQLModel 数据库 URL。                           |
| `APP_ALLOW_LOCAL_GATEWAY_URLS`    | `false`                                          | 是否允许 `localhost` / 内网 IP 作为网关地址。   |
| `APP_GATEWAY_TIMEOUT_SECONDS`     | `180`                                            | 调用模型网关的 HTTP 超时时间（秒）。            |
| `APP_MAX_GATEWAY_RESPONSE_BYTES`  | `4000000`                                        | 网关返回内容的最大字节数。                      |

## 典型使用流程

1. **Projects**：新建项目。
2. **Upload**：粘贴或上传 Markdown 素材。
3. **Workspace**：生成/再生大纲与逐页 Prompt，必要时运行一致性检查并修订不一致项。
4. **Image Generation**：发起批量图像生成，跟踪进度，灯箱预览，对个别页使用调整后的 Prompt 重试。
5. **Review & Export**：导出 Markdown 资料包或 `.pptx` 演示文稿。

## API 一览

所有接口位于 `http://localhost:8000`。

| 方法   | 路径                                                | 用途                              |
|--------|-----------------------------------------------------|-----------------------------------|
| GET    | `/api/health`                                       | 健康检查                          |
| GET/POST/PATCH/DELETE | `/api/projects`、`/api/projects/{id}` | 项目 CRUD                         |
| POST   | `/api/projects/{id}/generate`                       | 启动大纲 + Prompt 生成            |
| POST   | `/api/projects/{id}/regenerate-outline`             | 重新生成大纲                      |
| POST   | `/api/projects/{id}/regenerate-prompts`             | 重新生成所有 Prompt               |
| POST   | `/api/projects/{id}/check-consistency`              | 一致性检查                        |
| POST   | `/api/projects/{id}/revise-inconsistent-prompts`    | 修订不一致的 Prompt               |
| POST   | `/api/projects/{id}/generate-images`                | 启动批量图像生成                  |
| GET    | `/api/jobs/{job_id}`                                | 轮询任务状态                      |
| POST   | `/api/jobs/{job_id}/cancel`                         | 取消正在执行的任务                |
| POST   | `/api/projects/{id}/export`                         | 导出 Markdown 资料包              |
| POST   | `/api/projects/{id}/export-pptx`                    | 导出 `.pptx`                      |
| GET    | `/api/exports/{file}/download`                      | 下载导出文件                      |
| GET/POST | `/api/model-config`、`/api/model-config/image`    | 读取/保存文本/图像模型配置        |
| POST   | `/api/model-config/models`                          | 从网关拉取可用模型列表            |
| POST   | `/api/model-config/generation-test`                 | 文本生成连通性测试                |
| POST   | `/api/model-config/image-generation-test`           | 图像生成连通性测试                |

后端运行后可访问 `http://localhost:8000/docs` 查看交互式 API 文档。

## 开发提示

- 为了让日志更清晰，`/api/jobs/...` 的轮询访问日志已被过滤（见 `app/main.py`）。
- 所有生成产物保存在 `backend/app/storage/`，已被 gitignore。
- 前端直接访问 `http://localhost:8000`；若更换前端开发端口，请同步修改 `app/main.py` 中的 CORS 配置。

## 许可证

基于 [MIT License](LICENSE) 发布。
