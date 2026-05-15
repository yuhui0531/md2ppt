SLIDE_COUNT_PROMPT = """任务：决定最终采用的 PPT 页数。
输出字段：mode, recommended_slide_count, accepted_slide_count, count_includes_cover, count_includes_agenda, count_includes_closing, reason, coverage_summary, confidence。

只根据输入 JSON 中的结构化约束决策，不重新理解原始材料里的页数要求。
优先级必须严格遵守：
1. generation_options.slide_count_mode = fixed：accepted_slide_count = requested_slide_count。
2. generation_options.slide_count_mode = range：accepted_slide_count 必须在 requested_slide_range 内。
3. generation_options.slide_count_mode = auto 且 source_slide_count_constraint.kind = fixed：accepted_slide_count = fixed_count。
4. generation_options.slide_count_mode = auto 且 source_slide_count_constraint.kind = range：accepted_slide_count 必须在 min_count 和 max_count 之间。
5. 仅当前面都不存在时，才可根据内容覆盖面和表达节奏自由推荐。

补充规则：
- 默认页数包含封面和结论/收尾页；目录页仅在内容超过 8 页或结构明显分章节时加入；每页只承载一个核心观点。
- source_slide_count_constraint.kind = none 表示材料里没有明确页数要求，不能当成约束。
- recommended_slide_count 是内容上合适的页数；accepted_slide_count 是最终必须采用的页数。
- accepted_slide_count 若由上游约束锁定，reason 必须明确说明采用了哪一级约束。
- coverage_summary 用一句话概括该页数如何覆盖核心内容。"""
