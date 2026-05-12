# Batch Image Generation Design

## Summary

在项目工作台新增"批量生图"页面，使用已配置的生图模型对每页 slide 的 prompt 进行并发生图（信号量控制，最多 3 并发），生成结果按页码顺序展示，支持实时进度、缩略图预览和大图 lightbox。

## Data Model

`Slide` schema 增加字段：
```python
image_url: str | None = None
```

图片 URL 直接存在项目 JSON 的 slide 数据里，不新建表。

## Backend API

### POST /api/projects/{project_id}/generate-images

Request:
```json
{
  "slide_numbers": null  // null = 全部，或 [1, 3, 5] 指定页
}
```

逻辑：
1. 读取 image model config（kind="image"），未配置则 400
2. 创建 job，启动后台任务
3. 用 `asyncio.Semaphore(3)` 控制并发
4. 对每个 slide 调用 `GatewayClient.image_generation(model, slide.prompt, size, quality)`
5. 每完成一张立即更新 `slide.image_url` 并保存项目数据
6. Job progress = 已完成数 / 总数，message = "已完成 X/Y 张"
7. 单页失败不中断其他页，失败的 slide image_url 保持 None
8. 全部完成后 job status = completed，如有失败页则 error 记录页码

Response: JobResponse（同现有 generate 接口）

## Frontend

### 新增路由

`/workspace/:projectId/images` → `ImageGenerationPage.tsx`

### 页面结构

- 顶部：项目标题 + "开始批量生图"按钮 + JobProgress
- 主体：网格布局，每个 slide 一张卡片，按页码排列
  - 未生成：页码 + prompt 摘要 + 灰色占位
  - 生图中：loading spinner
  - 已完成：缩略图
  - 失败：错误标记 + 重试按钮
- 点击缩略图 → lightbox 大图预览（modal，ESC/点击关闭）

### WorkspacePage 入口

顶部 actions 加"批量生图" Link 按钮 → `/workspace/:projectId/images`

### 交互

- 生图过程中轮询 job + 定期刷新项目数据获取最新 image_url
- 页面刷新后已有 image_url 的 slide 直接展示
- "开始批量生图"覆盖所有页重新生成
- 单页重试：调用同一 API 传 slide_numbers=[N]

## Out of Scope

- 图片本地存储/缓存（直接用生图 API 返回的 URL）
- 图片编辑/裁剪
- 导出时嵌入图片
