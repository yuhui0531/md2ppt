IMPORT_SLIDE_STRUCTURE_PROMPT = """任务：从一份"已经写好的逐页生图 prompt"中**抽取**结构化信息，不要重写 prompt。

## 输入契约：
- slide_no、existing_title、existing_filename 是定位上下文。
- prompt 是用户提供的逐页生图提示词正文，可能是 Markdown，可能很长。
- 该 prompt 是用户的核心资产，**任何字段都不得改写、缩写、翻译或润色 prompt 正文**。

## 输出字段（所有字段都从 prompt 中抽取或概括，不得新增 prompt 中没有的事实）：
- title：本页的页面标题（短句，10-30 个汉字内），优先取 prompt 中的明显标题；若没有，按 prompt 核心主题概括，不要回填 existing_title 当作万能兜底；保留中文/英文与原 prompt 一致的语言。
- page_type：2-6 个汉字的中文短语，概括页面功能（例如"封面"、"目标"、"产品介绍"、"对比分析"、"流程图"、"结尾"）。禁止英文/拼音/下划线命名。
- page_role：本页在汇报中的角色（如"开场"、"问题陈述"、"方案说明"、"数据支撑"、"结论"等短语），可为空字符串。
- core_message：1-2 句话概括本页要传达的核心观点。
- modules：本页包含的内容模块名称数组（例如"产品概览卡片"、"三栏对比"、"指标看板"），3-6 项内，每项短语；没有可为空数组。
- layout：本页推荐版式描述（例如"封面型主视觉"、"左文右图"、"三栏卡片"、"中心辐射"），短句。
- visual_elements：页面上的视觉元素数组（例如"折线图"、"政务蓝渐变"、"线性图标"），短语数组，3-6 项内。
- color_rules：本页配色策略概述（例如"政务蓝主色 + 暖色点缀"、"白底浅色 + 深蓝标题"），单字符串，可为空字符串。
- text_hierarchy：本页的文字层级关系简述（例如"大标题 + 三条子要点 + 注释"），单字符串。
- page_text：页面上预计出现的文案数组（标题、要点、按钮文案等），短句数组，6 项内；没有把握时返回空数组。

## 规则：
1. 不输出 prompt 字段。
2. 缺失字段返回空字符串或空数组，不要编造。
3. 所有字段语言与输入 prompt 保持一致（中文输入 → 中文输出）。
4. 只输出约定 JSON 字段，不输出解释、Markdown 包装或额外说明。"""


IMPORT_DECK_BRIEF_PROMPT = """任务：基于已经抽取出的每页结构化信息，汇总整套 PPT 的整体大纲（DeckBrief）。

## 输入契约：
- slides 是逐页的结构化摘要数组，每项含 slide_no, title, page_type, page_role, core_message。
- 不得引入 slides 之外的事实。

## 输出字段：
- topic：整套 PPT 的主题，10-30 个汉字。
- audience：受众，可空字符串。
- goal：整套汇报的目标，一句话。
- report_scenario：汇报场景，可空字符串。
- narrative：1-2 段短摘要，整体叙事线。
- main_issues, key_arguments, risks, recommendations：各 0-5 条字符串。
- source_refs：可引用 slides 中可定位的页码或标题。

## 规则：
1. 只从 slides 抽取概括，不要新增内容。
2. 缺失字段返回空字符串或空数组。
3. 只输出约定 JSON 字段，不输出 Markdown 包装或解释。"""
