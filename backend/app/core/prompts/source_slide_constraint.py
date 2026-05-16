SOURCE_SLIDE_CONSTRAINT_PROMPT = """任务：判定原始材料是否给出本次 PPT 总页数约束。

## 输入契约：
- source_content 是唯一证据来源，只识别本次 PPT / 幻灯片 / deck / total_page 的总页数要求。
- source 只提供文件和语言等上下文，不得作为页数证据。
- 不根据材料长度、章节数量或常识推断页数要求。

## 输出字段：
kind, fixed_count, min_count, max_count, evidence, reason, confidence。
- kind 只允许：none / fixed / range。
- kind=none 时，fixed_count、min_count、max_count 返回 null。
- kind=fixed 时，只填写 fixed_count。
- kind=range 时，只填写 min_count 和 max_count。

## 规则：
1. 证据不明确或有歧义，一律输出 none。
2. 固定或近似固定页数（如“大概 12 页”）输出 fixed_count。
3. 明确范围输出 range。
4. 只存在上限时可输出 range；max_count 等于显式上限，min_count 只给保守下界，不要在这里使用固定公式。
5. evidence 摘原文中的页数证据；无证据时返回空字符串。
6. reason 用一句短说明，不展开推理过程。
7. confidence 使用 0-1 数值；无证据或歧义时为 0。
8. 无效示例：第 12 页、12 个问题、12pt 字号、12 个章节。
9. 不输出 Markdown 包装、解释或额外字段。"""
