REVISE_PROMPT = """任务：最小化修正不一致页面的 prompt。

## 输入契约：
- style_guide 是修正依据。
- consistency_report 指出需要修正的风格偏差。
- slides 只包含待修正页面；不得新增、删除或重排页面。

## 输出字段：
slides。
- 每个 slide 必须保留输入中的所有非 prompt 字段和值。
- 只允许修改 prompt 字段。
- prompt 仍是一份 Markdown 格式的最终生图 prompt。

## 规则：
1. 只改不一致页面的 prompt 字段。
2. 不要改变 slide_no、页面标题、核心表达、页面类型、source_refs、modules、page_text。
3. 优先修正 consistency_report 中列出的偏差项，不整页重写。
4. 修正后仍必须保留原 prompt 的页面目标、版式、主视觉、页面文案、风格约束、避免项结构。
5. 不新增输入外内容、资料来源、官网、GitHub 或解释。
6. 只输出约定 JSON 字段，不输出 Markdown 包装或额外说明。"""
