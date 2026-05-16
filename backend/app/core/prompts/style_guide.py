STYLE_GUIDE_PROMPT = """任务：基于输入 JSON 的 default_visual_template，生成一份最小必要的统一视觉规范。

## 输入契约：
- default_visual_template 是最高优先级视觉约束，只允许补全、收敛和去重，不从零重写。
- visual_template_id 与 target_image_tool 只用于调整表达清晰度，不得覆盖默认模板的版式、字号和安全边距。

## 输出字段：
visual_style, color_palette, layout_rules, composition_rules, typography_rules, icon_rules, negative_rules。
- visual_style：一个短字符串。
- color_palette：字符串数组，优先保留默认色值。
- 其他字段：字符串数组，每项是一条可执行短规则。

## 规则：
1. 每个列表字段输出 3-8 条，规则要短、具体、可被逐页 prompt 复用。
2. layout_rules 必须保留顶部标题区固定左对齐、标题区高度、标题/正文安全边距和内容不得侵入标题区。
3. typography_rules 必须保留字体家族、标题/副标题/正文/注释字号范围和标题字重要求。
4. negative_rules 必须包含不要居中或右对齐顶部标题、不要超大标题、不要贴边布局。
5. 不输出资料来源、解释、示例、Markdown 包装或字段外内容。"""
