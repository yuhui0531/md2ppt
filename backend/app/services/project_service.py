import json
import re
import shutil
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import HTTPException
from sqlmodel import Session, delete, select

from app.core.image_storage import project_image_dir, resolve_local_path
from app.models.job import JobRecord
from app.models.project import ParsedSectionRecord, ProjectRecord
from app.models.schemas import CreateProjectRequest, JobResponse, ParsedSection, ProjectData, ProjectSummary, Slide
from app.services.markdown_parser import MarkdownParserService
from app.services.template_service import TemplateService


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
        raw = json.loads(record.data_json)
        data = ProjectData.model_validate(raw)
        self._ensure_record_title(record, data)
        if self._backfill_slide_ids(data, raw):
            self.save_project_data(data)
        return self._with_enforced_style_guide(data)

    def list_projects(self, user_id: int) -> list[ProjectSummary]:
        if user_id <= 0:
            return []
        stmt = (
            select(ProjectRecord)
            .where(ProjectRecord.user_id == user_id)
            .order_by(ProjectRecord.updated_at.desc())
        )
        records = list(self.session.exec(stmt))
        if not records:
            return []
        # 一次性查所有运行中 job，按 project_id 分组取最新一条。同一 project_id
        # 不会同时有两条 running（API 层 _assert_no_active_job 守住），按更新时间
        # 倒序遍历用 setdefault 保住「最新」语义。避免 N+1 单查。
        project_ids = [record.id for record in records]
        job_stmt = (
            select(JobRecord)
            .where(JobRecord.project_id.in_(project_ids))
            .where(JobRecord.status == "running")
            .order_by(JobRecord.updated_at.desc())
        )
        active_by_project: dict[str, JobRecord] = {}
        for job in self.session.exec(job_stmt):
            active_by_project.setdefault(job.project_id, job)

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
            slide_count = len(slides) if isinstance(slides, list) else 0
            # images_ready：所有 slide 都有非空 image_url 才算生图完成。前端 Steps
            # 据此点亮「生图」步的 finish 终态；为空项目（slide_count=0）显式不算
            # 完成，避免误显「全部完成」给空骨架。
            images_ready = (
                slide_count > 0
                and isinstance(slides, list)
                and all(isinstance(s, dict) and s.get("image_url") for s in slides)
            )
            # consistency_passed：跑过检查 + 当前快照下无任何 slide 仍需修正。
            # 用 payload 里的 consistency_report.slides 而不是 record.generation_state——
            # 导入型项目 state 永远停在 import_structure_generated（避免污染生命周期标签），
            # 但用户跑过修正后理应在列表页看到「一致性」步打勾。也不用 slide 自身的
            # revision_needed 字段：那条字段只在 check_consistency 里被同步写入，
            # consistency_report.slides[*].revision_needed 才是单一真相来源（revise
            # 路径 generation_service.py:325-332 已基于当前 threshold 归一化过）。
            report = payload.get("consistency_report") if isinstance(payload, dict) else None
            report_slides = report.get("slides") if isinstance(report, dict) else None
            consistency_passed = (
                isinstance(report_slides, list)
                and len(report_slides) > 0
                and not any(
                    isinstance(s, dict) and s.get("revision_needed") for s in report_slides
                )
            )
            active_job_record = active_by_project.get(record.id)
            active_job = JobResponse.from_record(active_job_record) if active_job_record else None
            summaries.append(
                ProjectSummary(
                    project_id=record.id,
                    title=record.title,
                    source_filename=record.source_filename,
                    source_language=record.source_language,
                    generation_state=record.generation_state,
                    slide_count=slide_count,
                    project_origin=record.project_origin or "generated_markdown",
                    created_at=record.created_at.isoformat(),
                    updated_at=record.updated_at.isoformat(),
                    active_job=active_job,
                    images_ready=images_ready,
                    consistency_passed=consistency_passed,
                )
            )
        return summaries

    def save_project_data(self, data: ProjectData) -> None:
        """内部更新接口：调用方必须已经通过 _get_owned_record 等手段确认归属。"""
        record = self.session.get(ProjectRecord, data.project_id)
        if not record:
            raise HTTPException(status_code=404, detail="项目不存在")
        data = self._with_enforced_style_guide(data)
        self._ensure_record_title(record, data)
        record.generation_state = data.generation_state
        record.data_json = data.model_dump_json()
        record.updated_at = datetime.now(timezone.utc)
        self.session.add(record)
        self.session.commit()

    def persist_streaming_slide(self, project_id: str, phase: str, slide_payload: dict) -> None:
        """流式阶段中途落盘单页。供 generation_service 的 _make_slide_progress_callback
        每解析出一个完整 slide 对象时调用，让前端在轮询周期里就能看到行级增长。

        phase 语义：
        - "outline": LLM 流出一个新 slide 对象 → 按 slide_no upsert 到 data.slides。
          已存在的 slide_no 复用 id（避免 sld_xxx 漂移）；新 slide_no 用 default_factory 生成。
        - "prompts": LLM 流出某页的新 prompt → 仅覆盖 prompt 字段；其它结构化字段保持
          上一次 outline 阶段写入的内容。找不到对应 slide_no 时 silently skip（防御：
          LLM 偶尔返回多余 slide_no，避免幽灵页污染 slides[]）。

        slide_payload 期望调用方已经走过 GenerationService._normalize_slide，否则
        LLM 偶发的 list-of-dict / dict-of-string 等非常规形态可能让 Slide.model_validate
        抛错。本方法对此容错（try/except 跳过），但前置 normalize 能减少噪音。

        与阶段末尾 save_project_data 的关系：阶段末尾仍会用完整 LLM 输出整批覆盖
        data.slides——本方法只为「中途可见性」服务，最终一致性由阶段末次保存兜底。

        Worker 与 API GET /projects/{id} 各自独立 session、独立 transaction；
        SQLite/Postgres 的读写不阻塞，前端轮询期间能看到本方法 commit 后的最新状态。

        **并发安全契约**：本方法在 generate_slide_prompts 的 asyncio.gather 下会被
        多个 coroutine 调用，且 ProjectService 实例与外层 worker 共享同一个 Session。
        安全前提是：本方法**全程同步、无 await**——asyncio 在没有 await 点时不会切换
        coroutine，因此 read → modify → commit 序列对 asyncio 而言是原子的。若未来给
        本方法加 await（例如改成 async 调用 LLM 校验），必须重新审视：要么加锁，要么
        改成 collect-in-memory + 单点写盘。同款契约也适用于 revise_inconsistent_prompts
        路径下的 job_service.update 调用。"""
        slide_no = slide_payload.get("slide_no")
        if not isinstance(slide_no, int) or slide_no < 1:
            # LLM 偶发漏 slide_no 或返回浮点数：忽略此条，等下一个 token 重试。
            return
        record = self.session.get(ProjectRecord, project_id)
        if not record:
            return
        try:
            data = ProjectData.model_validate(json.loads(record.data_json))
        except (ValueError, json.JSONDecodeError):
            return

        existing_by_no = {slide.slide_no: slide for slide in data.slides}
        if phase == "outline":
            existing = existing_by_no.get(slide_no)
            try:
                if existing is None:
                    payload = {**slide_payload, "slide_no": slide_no}
                    payload.setdefault("title", "")
                    payload.setdefault("page_type", "")
                    new_slide = Slide.model_validate(payload)
                    data.slides.append(new_slide)
                else:
                    # 保留原 id：前端 SlideRow 与一致性 report 都按 id/slide_no 锚定。
                    payload = {**slide_payload, "slide_no": slide_no, "id": existing.id}
                    payload.setdefault("title", "")
                    payload.setdefault("page_type", "")
                    updated_slide = Slide.model_validate(payload)
                    data.slides[data.slides.index(existing)] = updated_slide
            except Exception:
                # 单页 schema 验证失败不阻塞整批：阶段末次保存会用完整 LLM 输出兜底。
                return
            # outline 阶段 slide 应按 slide_no 自然递增；流式 callback 是按 LLM 输出
            # 顺序触发的，append 顺序与 slide_no 顺序一致。若 LLM 乱序输出，按 slide_no
            # 排序保证 UI 上行序与 slide_no 顺序一致。
            data.slides.sort(key=lambda s: s.slide_no)
        elif phase == "prompts":
            existing = existing_by_no.get(slide_no)
            if existing is None:
                return
            new_prompt = slide_payload.get("prompt")
            if not isinstance(new_prompt, str):
                return
            existing.prompt = new_prompt
        elif phase == "speech_scripts":
            existing = existing_by_no.get(slide_no)
            if existing is None:
                return
            new_script = slide_payload.get("speech_script")
            if not isinstance(new_script, str):
                return
            existing.speech_script = new_script
        else:
            return

        data = self._with_enforced_style_guide(data)
        record.data_json = data.model_dump_json()
        record.updated_at = datetime.now(timezone.utc)
        self.session.add(record)
        self.session.commit()

    def revert_import_structure_state(self, project_id: str) -> None:
        """把导入型项目的 generation_state 从 'import_structure_generating' 回退到
        'prompts_imported'。供 worker 失败/取消分支与 JobService timeout sweep 共用：
        否则 worker 进程被 kill / OOM 走 sweep 路径时，项目状态永远卡在
        'import_structure_generating'，前端标签长期误显示「正在补全结构」。

        幂等：仅当项目状态确实是 import_structure_generating 且没有活跃 job 时才动。
        """
        record = self.session.get(ProjectRecord, project_id)
        if not record or record.generation_state != "import_structure_generating":
            return
        # 这里不查 has_active_job 是因为 sweep 路径在调用此方法之前已经把超时 job
        # 标 failed；worker 路径自己已经把 job 写 failed。所以调用方语义就是
        # "现在确实没有 worker 在动这个项目了"。
        try:
            data = self.get_project_data_internal(project_id)
        except HTTPException:
            return
        if data.generation_state != "import_structure_generating":
            return
        data.generation_state = "prompts_imported"
        self.save_project_data(data)

    def get_project_data_internal(self, project_id: str) -> ProjectData:
        """后台任务等已通过入口归属校验的内部场景使用，不再二次校验。"""
        record = self.session.get(ProjectRecord, project_id)
        if not record:
            raise HTTPException(status_code=404, detail="项目不存在")
        raw = json.loads(record.data_json)
        data = ProjectData.model_validate(raw)
        self._ensure_record_title(record, data)
        if self._backfill_slide_ids(data, raw):
            self.save_project_data(data)
        return self._with_enforced_style_guide(data)

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
    def _with_enforced_style_guide(data: ProjectData) -> ProjectData:
        if data.style_guide is not None:
            data.style_guide = TemplateService.enforce_style_guide_constraints(data.style_guide)
        return data

    @staticmethod
    def _backfill_slide_ids(data: ProjectData, raw: dict) -> bool:
        """老数据没有 Slide.id。Pydantic 在 model_validate 时已经用 default_factory
        生成了 id，但这意味着我们无法从 data 上区分"真的有 id"和"被 factory 补的"。
        用 raw dict 判断每条 slide 是否原本就带 id；缺失视为脏，调用方决定持久化。"""
        raw_slides = raw.get("slides") if isinstance(raw, dict) else None
        if not isinstance(raw_slides, list):
            return False
        dirty = False
        for slide, raw_slide in zip(data.slides, raw_slides):
            if isinstance(raw_slide, dict) and not raw_slide.get("id"):
                dirty = True
                break
        return dirty

    @staticmethod
    def _renumber_slides(slides: list[Slide]) -> None:
        for index, slide in enumerate(slides, start=1):
            slide.slide_no = index

    def insert_slide(self, project_id: str, after_slide_id: str | None, prompt: str) -> tuple[ProjectData, str]:
        """插入新 slide：after_slide_id 为空插在开头，否则插在该 id 的后面。
        返回更新后的 ProjectData 和新 slide 的 id，便于前端定位选中。"""
        data = self.get_project_data_internal(project_id)
        if after_slide_id is None:
            position = 0
        else:
            position = next((i for i, s in enumerate(data.slides) if s.id == after_slide_id), -1)
            if position < 0:
                raise HTTPException(status_code=404, detail="未找到指定的页面")
            position += 1
        new_slide = Slide(slide_no=0, title="", page_type="", prompt=prompt)
        data.slides.insert(position, new_slide)
        self._renumber_slides(data.slides)
        data.consistency_report = None
        self.save_project_data(data)
        return data, new_slide.id

    def update_slide_prompt(self, project_id: str, slide_id: str, prompt: str) -> ProjectData:
        data = self.get_project_data_internal(project_id)
        slide = next((s for s in data.slides if s.id == slide_id), None)
        if slide is None:
            raise HTTPException(status_code=404, detail="未找到指定的页面")
        slide.prompt = prompt
        data.consistency_report = None
        self.save_project_data(data)
        return data

    def update_slide_speech_script(self, project_id: str, slide_id: str, speech_script: str) -> ProjectData:
        data = self.get_project_data_internal(project_id)
        slide = next((s for s in data.slides if s.id == slide_id), None)
        if slide is None:
            raise HTTPException(status_code=404, detail="未找到指定的页面")
        slide.speech_script = speech_script
        self.save_project_data(data)
        return data

    def delete_slide(self, project_id: str, slide_id: str) -> ProjectData:
        data = self.get_project_data_internal(project_id)
        index = next((i for i, s in enumerate(data.slides) if s.id == slide_id), -1)
        if index < 0:
            raise HTTPException(status_code=404, detail="未找到指定的页面")
        target = data.slides[index]
        if target.image_url:
            local_path = resolve_local_path(target.image_url)
            if local_path is not None:
                local_path.unlink(missing_ok=True)
        data.slides.pop(index)
        self._renumber_slides(data.slides)
        data.consistency_report = None
        self.save_project_data(data)
        return data

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
