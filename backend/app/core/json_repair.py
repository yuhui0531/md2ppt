import json
import re
from typing import Any

_JSON_BLOCK_RE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL)


def loads_json_with_repair(text: str) -> dict[str, Any]:
    text = text.strip()
    candidates = [text]
    block = _JSON_BLOCK_RE.search(text)
    if block:
        candidates.insert(0, block.group(1).strip())
    first = text.find("{")
    last = text.rfind("}")
    if first >= 0 and last > first:
        candidates.append(text[first : last + 1])
    for candidate in candidates:
        try:
            payload = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            return payload
    raise ValueError("模型未返回合法 JSON")
