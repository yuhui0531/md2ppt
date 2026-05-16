"""导入已有逐页 prompt：解析 ZIP / 多 .md，落地为带默认 style_guide 的 imported_prompts 项目。
prompt 正文整文写入 slide.prompt；结构补全交给 GenerationService。"""

import re
import zipfile
from datetime import datetime, timezone
from io import BytesIO
from uuid import uuid4

from fastapi import HTTPException, UploadFile
from loguru import logger
from sqlmodel import Session

from app.models.project import ProjectRecord
from app.models.schemas import GenerationOptions, ProjectData, Slide
from app.services.template_service import TemplateService


_HEADING_RE = re.compile(r"^#{1,6}\s+(.+?)\s*$")
_LEADING_DIGITS_RE = re.compile(r"^(\d+)")
_MAX_TITLE_LEN = 120


class ParsedPrompt:
    __slots__ = ("filename", "stem", "content")

    def __init__(self, filename: str, content: str) -> None:
        self.filename = filename
        self.stem = filename.rsplit(".", 1)[0]
        self.content = content


class ImportService:
    def __init__(self, session: Session) -> None:
        self.session = session

    async def create_imported_project(self, files: list[UploadFile], user_id: int) -> tuple[ProjectData, ProjectRecord]:
        if user_id <= 0:
            raise HTTPException(status_code=401, detail="未登录或登录已过期")
        parsed = await self._collect_prompts(files)
        if not parsed:
            raise HTTPException(status_code=400, detail="未发现可导入的 .md 文件")
        parsed = self._sort_prompts(parsed)

        project_id = f"proj_{uuid4().hex[:12]}"
        slides: list[Slide] = []
        for index, item in enumerate(parsed, start=1):
            slides.append(
                Slide(
                    slide_no=index,
                    title=self._resolve_initial_title(item.content, item.stem),
                    page_type="",
                    prompt=item.content,
                )
            )

        options = GenerationOptions()
        data = ProjectData(
            project_id=project_id,
            project_origin="imported_prompts",
            source={
                "filename": None,
                "language": "zh-CN",
                "source_role": "imported_prompts",
                "import_count": len(parsed),
                "import_filenames": [item.filename for item in parsed],
            },
            generation_options=options,
            parsed_sections=[],
            deck_brief=None,
            slide_count_plan=None,
            template={
                "content_template_id": options.content_template_id,
                "visual_template_id": options.visual_template_id,
                "visual_template_name": "政务蓝科技风汇报 PPT",
            },
            style_guide=TemplateService.default_style_guide(),
            slides=slides,
            generation_state="prompts_imported",
        )

        title = self._resolve_project_title(parsed, slides)
        record = ProjectRecord(
            id=project_id,
            user_id=user_id,
            title=title,
            source_filename=None,
            source_language="zh-CN",
            # source_content NOT NULL：导入项目没有原始 Markdown 素材，用元信息占位。
            # 这条文本不进 LLM 调用——结构补全只读 slide.prompt。
            source_content=f"[imported_prompts] 共导入 {len(parsed)} 份提示词，于 {datetime.now(timezone.utc).isoformat()} 创建。",
            generation_state="prompts_imported",
            project_origin="imported_prompts",
            data_json=data.model_dump_json(),
        )
        self.session.add(record)
        self.session.commit()
        self.session.refresh(record)
        logger.info(
            "[import] created project_id={} user_id={} slide_count={} sample_filenames={}",
            project_id,
            user_id,
            len(parsed),
            [item.filename for item in parsed[:3]],
        )
        return data, record

    async def _collect_prompts(self, files: list[UploadFile]) -> list[ParsedPrompt]:
        if not files:
            raise HTTPException(status_code=400, detail="请上传 ZIP 或至少一个 .md 文件")

        zip_inputs = [f for f in files if (f.filename or "").lower().endswith(".zip")]
        md_inputs = [f for f in files if (f.filename or "").lower().endswith(".md")]
        # 显式拒绝非 .md / .zip，避免静默丢导致用户以为导入成功。
        other_inputs = [f for f in files if f not in zip_inputs and f not in md_inputs]
        if other_inputs:
            names = ", ".join((f.filename or "未命名") for f in other_inputs[:5])
            raise HTTPException(status_code=400, detail=f"仅支持 .md 或单个 .zip，不支持：{names}")

        if zip_inputs and md_inputs:
            raise HTTPException(status_code=400, detail="ZIP 与多个 .md 不能混传，请二选一")
        if len(zip_inputs) > 1:
            raise HTTPException(status_code=400, detail="只允许上传一个 ZIP 文件")

        if zip_inputs:
            return await self._read_zip(zip_inputs[0])
        return await self._read_md_files(md_inputs)

    async def _read_md_files(self, files: list[UploadFile]) -> list[ParsedPrompt]:
        parsed: list[ParsedPrompt] = []
        for upload in files:
            name = upload.filename or ""
            if not self._is_acceptable_md_name(name):
                continue
            raw = await upload.read()
            content = self._decode(raw)
            if not content.strip():
                continue
            parsed.append(ParsedPrompt(filename=self._basename(name), content=content))
        return parsed

    async def _read_zip(self, upload: UploadFile) -> list[ParsedPrompt]:
        raw = await upload.read()
        if not raw:
            raise HTTPException(status_code=400, detail="ZIP 文件为空")
        try:
            archive = zipfile.ZipFile(BytesIO(raw))
        except zipfile.BadZipFile as exc:
            raise HTTPException(status_code=400, detail=f"ZIP 解析失败：{exc}") from exc

        parsed: list[ParsedPrompt] = []
        for info in archive.infolist():
            if info.is_dir():
                continue
            inner = info.filename
            if not self._is_acceptable_md_name(inner):
                continue
            try:
                payload = archive.read(info)
            except Exception as exc:
                logger.warning("[import] skip zip entry path={} error={}", inner, exc)
                continue
            content = self._decode(payload)
            if not content.strip():
                continue
            parsed.append(ParsedPrompt(filename=self._basename(inner), content=content))
        return parsed

    @staticmethod
    def _is_acceptable_md_name(path: str) -> bool:
        if not path:
            return False
        normalized = path.replace("\\", "/")
        if normalized.endswith("/"):
            return False
        # __MACOSX/ 是 macOS 打包附带的资源叉副本，里面也是 .md 但都是垃圾。
        if normalized.startswith("__MACOSX/") or "/__MACOSX/" in normalized:
            return False
        parts = normalized.split("/")
        for part in parts:
            if part.startswith(".") and part not in {".", ".."}:
                return False
        basename = parts[-1]
        if basename.lower() == "index.md":
            return False
        return basename.lower().endswith(".md")

    @staticmethod
    def _basename(path: str) -> str:
        return path.replace("\\", "/").rsplit("/", 1)[-1]

    @staticmethod
    def _decode(raw: bytes) -> str:
        # utf-8-sig 必须放第一位：纯 utf-8 解码 BOM 字节会"成功"但保留 ﻿ 在首字符，
        # 让首行 "# 标题" 变成 "﻿# 标题"——heading 正则匹不上、prompt 正文也带垃圾。
        # utf-8-sig 对无 BOM 文件等价于 utf-8，无副作用。
        # gbk 兜中文 Windows 编辑器。
        for encoding in ("utf-8-sig", "utf-8", "gbk"):
            try:
                return raw.decode(encoding)
            except UnicodeDecodeError:
                continue
        return raw.decode("utf-8", errors="replace")

    @staticmethod
    def _sort_prompts(prompts: list[ParsedPrompt]) -> list[ParsedPrompt]:
        def key(item: ParsedPrompt) -> tuple[int, int, str]:
            match = _LEADING_DIGITS_RE.match(item.stem)
            if match:
                # 数字前缀优先：(0, 数值, stem) 保证 "10-x" 排在 "2-y" 后面而不是按字典序。
                return (0, int(match.group(1)), item.stem)
            return (1, 0, item.stem)

        return sorted(prompts, key=key)

    @staticmethod
    def _resolve_initial_title(content: str, fallback_stem: str) -> str:
        first_non_empty: str | None = None
        for raw_line in content.splitlines():
            line = raw_line.strip()
            if not line:
                continue
            heading = _HEADING_RE.match(line)
            if heading:
                return heading.group(1).strip()[:_MAX_TITLE_LEN]
            if first_non_empty is None:
                # 去掉 markdown 列表/引用前缀，避免 "- 某条" 直接当标题。
                cleaned = re.sub(r"^[>\-\*\d\.\s]+", "", line).strip()
                first_non_empty = cleaned or line
        if first_non_empty:
            return first_non_empty[:_MAX_TITLE_LEN]
        stem = fallback_stem.strip()
        # 文件名 "01-cover" 去掉前导数字与分隔符更接近人能识别的标题。
        cleaned_stem = re.sub(r"^\d+[\s\-_\.]*", "", stem).strip()
        return (cleaned_stem or stem or "未命名页")[:_MAX_TITLE_LEN]

    @staticmethod
    def _resolve_project_title(parsed: list[ParsedPrompt], slides: list[Slide]) -> str:
        for slide in slides:
            title = (slide.title or "").strip()
            if title and title != "未命名页":
                return title[:_MAX_TITLE_LEN]
        if parsed:
            stem = parsed[0].stem.strip()
            cleaned = re.sub(r"^\d+[\s\-_\.]*", "", stem).strip()
            if cleaned:
                return cleaned[:_MAX_TITLE_LEN]
        return f"导入提示词项目 {datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}"
