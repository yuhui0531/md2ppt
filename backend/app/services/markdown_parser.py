import re

from app.models.schemas import ParsedSection

_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$")
_IMAGE_RE = re.compile(r"!\[([^\]]*)\]\(([^)]+)\)")
_LINK_RE = re.compile(r"(?<!!)\[([^\]]+)\]\(([^)]+)\)")


class MarkdownParserService:
    def parse(self, content: str) -> list[ParsedSection]:
        lines = content.splitlines()
        sections: list[ParsedSection] = []
        current_heading = "未命名素材"
        current_level = 1
        current_lines: list[str] = []
        order = 1
        parent_stack: list[tuple[int, str]] = []
        in_code_block = False
        current_has_mermaid = False
        current_has_code_block = False

        def flush() -> None:
            nonlocal order, current_has_mermaid, current_has_code_block, parent_stack
            body = "\n".join(current_lines).strip()
            if not body and not sections:
                return
            section_id = f"section-{order}"
            parent_id = None
            for level, stack_id in reversed(parent_stack):
                if level < current_level:
                    parent_id = stack_id
                    break
            metadata = {
                "has_table": "|" in body,
                "has_code_block": current_has_code_block,
                "has_mermaid": current_has_mermaid,
                "links": [{"text": text, "href": href} for text, href in _LINK_RE.findall(body)],
                "images": [{"alt": alt, "src": src} for alt, src in _IMAGE_RE.findall(body)],
            }
            sections.append(
                ParsedSection(
                    id=section_id,
                    heading=current_heading,
                    level=current_level,
                    content=body,
                    order=order,
                    parent_id=parent_id,
                    metadata=metadata,
                )
            )
            parent_stack = [(level, stack_id) for level, stack_id in parent_stack if level < current_level]
            parent_stack.append((current_level, section_id))
            order += 1
            current_has_mermaid = False
            current_has_code_block = False

        for line in lines:
            stripped = line.strip()
            if stripped.startswith("```"):
                current_has_code_block = True
                if stripped.lower().startswith("```mermaid"):
                    current_has_mermaid = True
                in_code_block = not in_code_block
                current_lines.append(line)
                continue
            heading_match = _HEADING_RE.match(line) if not in_code_block else None
            if heading_match:
                flush()
                level = len(heading_match.group(1))
                parent_stack = [(stack_level, stack_id) for stack_level, stack_id in parent_stack if stack_level < level]
                current_heading = heading_match.group(2).strip()
                current_level = level
                current_lines = []
                continue
            current_lines.append(line)

        flush()
        return sections
