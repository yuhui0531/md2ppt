import json
import re
import shutil
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import HTTPException
from sqlmodel import Session, delete, select

from app.core.image_storage import project_image_dir
from app.models.job import JobRecord
from app.models.project import ParsedSectionRecord, ProjectRecord
from app.models.schemas import CreateProjectRequest, ParsedSection, ProjectData, ProjectSummary
from app.services.markdown_parser import MarkdownParserService


class ProjectService:
    def __init__(self, session: Session) -> None:
        self.session = session
        self.parser = MarkdownParserService()

    def create_project(self, request: CreateProjectRequest, user_id: int) -> ProjectData:
        if user_id <= 0:
            raise HTTPException(status_code=401, detail="未登录或登录已过期")
        project_id = f"proj_{uuid4().hex[:12]}"
        sections = self.parser.parse(request.source.content)
        title = self._resolve_title(
            filename=request.source.filename,
            sections=sections,
            fallback_text=request.source.content,
            brief_topic=None,
        )
        section_id_map = {section.id: f"{project_id}-{section.id}" for section in sections}
        for section in sections:
            section.id = section_id_map[section.id]
            if section.parent_id:
                section.parent_id = section_id_map.get(section.parent_id, section.parent_id)
        data = ProjectData(
            project_id=project_id,
            source={
                "filename": request.source.filename,
                "language": request.source.language,
                "source_role": "raw_material",
            },
            generation_options=request.generation_options,
            parsed_sections=sections,
            template={
                "content_template_id": request.generation_options.content_template_id,
                "visual_template_id": request.generation_options.visual_template_id,
                "visual_template_name": "政务蓝科技风汇报 PPT",
            },
            generation_state="parsed",
        )
        record = ProjectRecord(
            id=project_id,
            user_id=user_id,
            title=title,
            source_filename=request.source.filename,
            source_language=request.source.language,
            source_content=request.source.content,
            generation_state="parsed",
            data_json=data.model_dump_json(),
        )
        self.session.add(record)
        self._replace_sections(project_id, sections)
        self.session.commit()
        return data

    def get_project_data(self, project_id: str, user_id: int) -> ProjectData:
        record = self._get_owned_record(project_id, user_id)
        data = ProjectData.model_validate(json.loads(record.data_json))
        self._ensure_record_title(record, data)
        return data

    def list_projects(self, user_id: int) -> list[ProjectSummary]:
        if user_id <= 0:
            return []
        stmt = (
            select(ProjectRecord)
            .where(ProjectRecord.user_id == user_id)
            .order_by(ProjectRecord.updated_at.desc())
        )
        records = list(self.session.exec(stmt))
        summaries: list[ProjectSummary] = []
        for record in records:
            try:
                payload = json.loads(record.data_json) if record.data_json else {}
            except json.JSONDecodeError:
                payload = {}
            data = ProjectData.model_validate(payload) if payload else None
            if data:
                self._ensure_record_title(record, data)
            slides = payload.get("slides", [])
            summaries.append(
                ProjectSummary(
                    project_id=record.id,
                    title=record.title,
                    source_filename=record.source_filename,
                    source_language=record.source_language,
                    generation_state=record.generation_state,
                    slide_count=len(slides) if isinstance(slides, list) else 0,
                    created_at=record.created_at.isoformat(),
                    updated_at=record.updated_at.isoformat(),
                )
            )
        return summaries

    def save_project_data(self, data: ProjectData) -> None:
        """内部更新接口：调用方必须已经通过 _get_owned_record 等手段确认归属。"""
        record = self.session.get(ProjectRecord, data.project_id)
        if not record:
            raise HTTPException(status_code=404, detail="项目不存在")
        self._ensure_record_title(record, data)
        record.generation_state = data.generation_state
        record.data_json = data.model_dump_json()
        record.updated_at = datetime.now(timezone.utc)
        self.session.add(record)
        self.session.commit()

    def get_project_data_internal(self, project_id: str) -> ProjectData:
        """后台任务等已通过入口归属校验的内部场景使用，不再二次校验。"""
        record = self.session.get(ProjectRecord, project_id)
        if not record:
            raise HTTPException(status_code=404, detail="项目不存在")
        data = ProjectData.model_validate(json.loads(record.data_json))
        self._ensure_record_title(record, data)
        return data

    def rename_project(self, project_id: str, title: str, user_id: int) -> ProjectRecord:
        record = self._get_owned_record(project_id, user_id)
        normalized = title.strip()
        if not normalized:
            raise HTTPException(status_code=400, detail="项目名称不能为空")
        record.title = normalized
        record.updated_at = datetime.now(timezone.utc)
        self.session.add(record)
        self.session.commit()
        self.session.refresh(record)
        return record

    def delete_project(self, project_id: str, user_id: int) -> None:
        record = self._get_owned_record(project_id, user_id)
        self.session.exec(delete(ParsedSectionRecord).where(ParsedSectionRecord.project_id == project_id))
        self.session.exec(delete(JobRecord).where(JobRecord.project_id == project_id))
        self.session.delete(record)
        self.session.commit()
        # 删完 DB 再清盘上的图，DB 已是真值——即使清盘失败也不影响数据一致性。
        shutil.rmtree(project_image_dir(project_id), ignore_errors=True)

    def _get_owned_record(self, project_id: str, user_id: int) -> ProjectRecord:
        if user_id <= 0:
            raise HTTPException(status_code=401, detail="未登录或登录已过期")
        record = self.session.get(ProjectRecord, project_id)
        if not record or record.user_id != user_id:
            raise HTTPException(status_code=404, detail="项目不存在")
        return record

    def _replace_sections(self, project_id: str, sections: list[ParsedSection]) -> None:
        self.session.exec(delete(ParsedSectionRecord).where(ParsedSectionRecord.project_id == project_id))
        for section in sections:
            self.session.add(
                ParsedSectionRecord(
                    id=section.id,
                    project_id=project_id,
                    heading=section.heading,
                    level=section.level,
                    content=section.content,
                    order=section.order,
                    parent_id=section.parent_id,
                    metadata_json=json.dumps(section.metadata, ensure_ascii=False),
                )
            )

    def _ensure_record_title(self, record: ProjectRecord, data: ProjectData) -> None:
        if not self._is_placeholder_title(record.title):
            return
        resolved = self._resolve_title(
            filename=self._source_filename_from_data(data) or record.source_filename,
            sections=data.parsed_sections,
            fallback_text=record.source_content,
            brief_topic=data.deck_brief.topic if data.deck_brief else None,
        )
        if resolved != record.title:
            record.title = resolved
            record.updated_at = datetime.now(timezone.utc)
            self.session.add(record)
            self.session.commit()

    @staticmethod
    def _is_placeholder_title(title: str | None) -> bool:
        normalized = (title or "").strip().lower()
        return normalized in {"", "untitled", "untitled project", "未命名素材", "未命名项目"}

    @staticmethod
    def _source_filename_from_data(data: ProjectData) -> str | None:
        if isinstance(data.source, dict):
            filename = data.source.get("filename")
            return str(filename) if filename else None
        return None

    @staticmethod
    def _resolve_title(
        filename: str | None,
        sections: list[ParsedSection],
        fallback_text: str | None,
        brief_topic: str | None,
    ) -> str:
        if brief_topic and brief_topic.strip():
            return brief_topic.strip()[:120]
        if filename and filename.strip():
            stem = filename.rsplit(".", 1)[0].strip()
            if stem:
                return stem[:120]
        for section in sections:
            heading = (section.heading or "").strip()
            if heading and heading not in {"未命名素材", "untitled"}:
                return heading[:120]
        if fallback_text:
            for line in fallback_text.splitlines():
                cleaned = re.sub(r"^[#>\-\*\d\.\s]+", "", line).strip()
                if cleaned:
                    return cleaned[:120]
        return "未命名项目"
