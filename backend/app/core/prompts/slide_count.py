SLIDE_COUNT_PROMPT = """任务：决定最终采用的 PPT 页数。

## 输入契约：
- 只根据输入 JSON 的结构化约束决策，不重新理解原始材料。
- generation_options 是用户显式页数要求。
- source_slide_count_constraint 是从原始材料抽取的页数要求。
- deck_brief 与 parsed_section_count 只用于估计内容合适页数。

## 输出字段：
mode, recommended_slide_count, accepted_slide_count, count_includes_cover, count_includes_agenda, count_includes_closing, reason, coverage_summary, confidence。

## 决策优先级：
fixed 用户要求 > range 用户要求 > source fixed > source range > 自由推荐。

## 规则：
1. accepted_slide_count 必须严格服从最高优先级约束。
2. recommended_slide_count 表示内容上合适的页数；若与约束冲突，仍以 accepted_slide_count 服从约束。
3. mode 必须对应最终采用的约束来源或 auto，不要自造枚举值。
4. reason 用一句话说明采用了哪级约束。
5. coverage_summary 用一句话概括覆盖面。
6. confidence 使用 0-1 数值；证据越明确越高，约束缺失时保守。
7. 不输出输入外假设、解释过程、Markdown 包装或额外字段。"""
