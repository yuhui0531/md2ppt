import json
import re
import zipfile
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException
from sqlmodel import Session

from app.config import settings
from app.models.project import ProjectRecord
from app.models.schemas import ExportResponse, ProjectData
from app.services.project_service import ProjectService


class ExportService:
    def __init__(self, session: Session) -> None:
        self.session = session
        self.project_service = ProjectService(session)
        self.export_dir = settings.storage_dir / "exports"

    def export_project(self, project_id: str, export_format: str, include_index: bool = True) -> ExportResponse:
        data = self.project_service.get_project_data_internal(project_id)
        project_record = self.session.get(ProjectRecord, project_id)
        self.export_dir.mkdir(parents=True, exist_ok=True)
        export_id = uuid4().hex[:12]
        stem = f"{project_id}__{export_id}"

        project_title = project_record.title if project_record else self._project_title(data)

        if export_format == "json":
            filename = f"{self._safe_filename(project_title)}-ppt-prompts.json"
            path = self.export_dir / f"{stem}.json"
            path.write_text(self._json_content(data), encoding="utf-8")
            content_type = "application/json"
        elif export_format == "markdown":
            filename = f"{self._safe_filename(project_title)}-ppt-prompts.md"
            path = self.export_dir / f"{stem}.md"
            path.write_text(self._markdown_content(data), encoding="utf-8")
            content_type = "text/markdown"
        elif export_format == "prompt_zip":
            filename = f"{self._safe_filename(project_title)}-slide-prompts.zip"
            path = self.export_dir / f"{stem}.zip"
            path.write_bytes(self._prompt_zip_content(data, include_index))
            content_type = "application/zip"
        else:
            raise ValueError("不支持的导出格式")

        return ExportResponse(
            filename=filename,
            content_type=content_type,
            download_url=f"/api/exports/{path.name}/download?filename={filename}",
        )

    def resolve_export_path(self, export_file: str, user_id: int) -> Path:
        path = (self.export_dir / export_file).resolve()
        if not path.is_relative_to(self.export_dir.resolve()) or not path.exists() or not path.is_file():
            raise FileNotFoundError
        project_id = self._extract_project_id(path.name)
        if project_id is None:
            raise FileNotFoundError
        record = self.session.get(ProjectRecord, project_id)
        if not record or record.user_id != user_id:
            raise FileNotFoundError
        return path

    @staticmethod
    def _extract_project_id(filename: str) -> str | None:
        # 期望格式：{project_id}__{export_id}.{ext}
        stem = filename.rsplit(".", 1)[0]
        if "__" not in stem:
            return None
        project_id, _, _ = stem.partition("__")
        if not project_id.startswith("proj_"):
            return None
        return project_id

    def _json_content(self, data: ProjectData) -> str:
        return json.dumps(data.model_dump(mode="json"), ensure_ascii=False, indent=2)

    def _markdown_content(self, data: ProjectData) -> str:
        parts: list[str] = ["# PPT 总体规划", ""]
        if data.slide_count_plan:
            parts.extend(
                [
                    f"建议总页数：{data.slide_count_plan.accepted_slide_count} 页",
                    "",
                    "## 推荐理由",
                    data.slide_count_plan.reason,
                    "",
                    "## 覆盖范围",
                    data.slide_count_plan.coverage_summary,
                    "",
                ]
            )
        if data.deck_brief:
            parts.extend(
                [
                    "## 整体汇报逻辑",
                    data.deck_brief.narrative,
                    "",
                ]
            )
        if data.slides:
            parts.extend(["## 页面规划", "", "| 页码 | 页面标题 | 页面类型 | 核心表达 |", "|---|---|---|---|"])
            for slide in data.slides:
                parts.append(f"| {slide.slide_no} | {slide.title} | {slide.page_type} | {slide.core_message} |")
            parts.append("")
        if data.style_guide:
            parts.extend(
                [
                    "---",
                    "",
                    "# 统一视觉规范",
                    "",
                    "## 整体风格",
                    data.style_guide.visual_style,
                    "",
                    "## 配色体系",
                    self._markdown_list(data.style_guide.color_palette),
                    "",
                    "## 版式规则",
                    self._markdown_list(data.style_guide.layout_rules),
                    "",
                    "## 字体规则",
                    self._markdown_list(data.style_guide.typography_rules),
                    "",
                    "## 图标规则",
                    self._markdown_list(data.style_guide.icon_rules),
                    "",
                    "## 避免项",
                    self._markdown_list(data.style_guide.negative_rules),
                    "",
                ]
            )
        for slide in data.slides:
            parts.extend(["---", "", slide.prompt or self._fallback_slide_prompt(slide), ""])
        return "\n".join(parts).strip() + "\n"

    def _prompt_zip_content(self, data: ProjectData, include_index: bool) -> bytes:
        buffer = BytesIO()
        with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            if include_index:
                archive.writestr("index.md", self._zip_index(data))
            width = max(2, len(str(len(data.slides))))
            for slide in data.slides:
                title = self._safe_filename(slide.title or slide.page_type or f"slide-{slide.slide_no}")
                filename = f"{slide.slide_no:0{width}d}-{title}.md"
                archive.writestr(filename, (slide.prompt or self._fallback_slide_prompt(slide)).strip() + "\n")
        return buffer.getvalue()

    def _zip_index(self, data: ProjectData) -> str:
        parts = ["# 逐页提示词索引", "", "| 页码 | 页面标题 | 页面类型 | 核心表达 |", "|---|---|---|---|"]
        for slide in data.slides:
            parts.append(f"| {slide.slide_no} | {slide.title} | {slide.page_type} | {slide.core_message} |")
        return "\n".join(parts) + "\n"

    @staticmethod
    def _project_title(data: ProjectData) -> str:
        filename = data.source.get("filename") if isinstance(data.source, dict) else None
        if filename:
            return str(filename).rsplit(".", 1)[0] or "material"
        if data.deck_brief and data.deck_brief.topic:
            return data.deck_brief.topic
        return f"material-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"

    @staticmethod
    def _safe_filename(value: str) -> str:
        cleaned = re.sub(r"[\\/:*?\"<>|\s]+", "-", value.strip())
        cleaned = re.sub(r"-+", "-", cleaned).strip("-.")
        return cleaned[:80] or "material"

    @staticmethod
    def _markdown_list(items: list[str]) -> str:
        return "\n".join(f"- {item}" for item in items) if items else "- 无"

    @staticmethod
    def _fallback_slide_prompt(slide: object) -> str:
        return f"# 第 {slide.slide_no} 页：{slide.title}\n\n## 核心表达\n{slide.core_message}"
