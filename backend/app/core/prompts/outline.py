OUTLINE_PROMPT = """任务：生成结构化 PPT 大纲。

## 输入契约：
- deck_brief、content_template、parsed_sections 是内容边界，不得引入输入外事实。
- slide_count_plan.accepted_slide_count 是最终页数；必须严格生成对应数量的 slides。
- generation_options 只用于受众、场景和页数要求，不得改变内容事实。

## 输出字段：
slides。
每页包含 slide_no, title, page_type, page_role, core_message, modules, layout, visual_elements, color_rules, text_hierarchy, page_text, source_refs。

## 规则：
1. slide_no 从 1 开始连续递增，slides 数量必须等于 accepted_slide_count。
2. 每页只表达一个核心观点，页面之间避免重复承担同一功能。
3. page_type、layout、modules 要服务于内容模板和汇报逻辑，不自由添加无关页面。
4. page_type 必须是 2-6 个汉字的中文短语，概括页面功能（例如"封面"、"目标"、"能力矩阵"、"产品介绍"、"概念阐释"、"时间线"、"对比分析"），禁止输出英文、拼音或下划线命名（不要写 "capability_matrix"、"process" 之类）。
5. modules、page_text、visual_elements 保持精炼；不要大段复制原文。
6. source_refs 只引用输入中存在的章节、标题或要点，不编造来源。
7. 这是大纲，不是逐页生图 prompt 草稿；prompt 字段保持空字符串或不额外展开。
8. 只输出约定 JSON 字段，不输出解释、资料来源或 Markdown 包装。"""
