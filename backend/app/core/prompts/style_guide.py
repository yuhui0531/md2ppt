STYLE_GUIDE_PROMPT = """任务：基于输入 JSON 的 default_visual_template，生成一份最小必要的统一视觉规范。

## 输入契约：
- default_visual_template 是最高优先级视觉约束，只允许补全、收敛和去重，不从零重写。
- 必须逐条原文保留 default_visual_template 中的 layout_rules、typography_rules、negative_rules，不得合并、概括、缩写或改写。
- visual_style 必须以 default_visual_template.visual_style 为基础；可追加不冲突的浅色/政务/专业表达，但服务端会丢弃深色、暗黑、大面积深蓝背景等冲突描述。
- visual_template_id 与 target_image_tool 只用于调整表达清晰度，不得覆盖默认模板的版式、字号、安全边距和白底浅色风格。

## 输出字段：
visual_style, color_palette, layout_rules, composition_rules, typography_rules, icon_rules, negative_rules。
- visual_style：一个短字符串。
- color_palette：字符串数组，优先保留默认色值。
- 其他字段：字符串数组，每项是一条可执行短规则。

## 规则：
1. 优先复制 default_visual_template 的字段内容；需要补充时只能追加在对应数组末尾，不得替换默认规则。
2. 必须先完整保留 default_visual_template 的默认规则；条数上限只约束模型新增项，不得为了满足上限删除、合并或改写默认规则。
3. layout_rules、typography_rules、negative_rules 属于硬约束字段，默认规则可超过 8 条；非硬约束字段补充后最多 8 条。
4. layout_rules 必须原文包含默认模板中的每页标题必须左对齐、每页标题区安全边距、顶部标题区固定左对齐、标题区高度、标题/正文安全边距和内容不得侵入标题区规则。
5. typography_rules 必须原文包含默认模板中的字体家族、每页标题字号、标题/副标题/正文/注释字号范围和标题字重要求。
6. layout_rules 必须原文包含默认模板中的白底浅色风格规则；不得生成深色风格、暗黑背景或大面积深蓝底色。
7. negative_rules 必须原文包含默认模板中的不要居中或右对齐任何页面标题、不要使用超出规范的标题字号、不要深色风格等禁止项。
8. 禁止把“距画布左侧不小于 6%、距顶部不小于 5%”“标题字号控制在 32-40pt”“白底浅色风格”等规则改写成“保留安全边距”“标题加粗突出”“政务蓝风格”这类泛化表达。
9. 不输出资料来源、解释、示例、Markdown 包装或字段外内容。"""
