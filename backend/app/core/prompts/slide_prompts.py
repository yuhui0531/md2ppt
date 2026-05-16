SLIDE_PROMPTS_PROMPT = """任务：为每页生成最终生图 prompt。

## 输入契约：
- style_guide 是所有页面共享的全局视觉约束，必须落实到每页 prompt。
- slides 是已确定的大纲数据，只允许基于原字段补全 prompt，不改变页面意图、顺序和信息重点。
- target_image_tool 只用于调整生图描述表达，不得覆盖 style_guide。

## 输出字段：
slides。
- 每个 slide 必须保留输入中的 slide_no, title, page_type, page_role, core_message, modules, layout, visual_elements, color_rules, text_hierarchy, page_text, source_refs。
- 每个 slide 的 prompt 字段必须是一份 Markdown 字符串，并使用固定骨架：
1. 页面目标
2. 版式
3. 主视觉
4. 页面文案
5. 风格约束
6. 避免项

## 规则：
1. 所有页面共享同一个 style_guide，不要逐页重复长篇复述。
2. 各节只写必要信息，短句、中文、可读，避免泛泛而谈。
3. 保留页面标题、定位、核心表达、模块、版式、主视觉、配色、文字层级中的关键信息。
4. 版式与风格约束必须继承 style_guide 中的标题区、字号、安全边距、配色、图标和负面规则。
5. 顶部标题区必须左对齐，标题不得居中、右对齐、贴边或使用超出 style_guide 的字号。
6. 不输出资料来源、官网、GitHub、解释或额外包装。"""
