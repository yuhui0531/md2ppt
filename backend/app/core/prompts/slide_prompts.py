SLIDE_PROMPTS_PROMPT = """任务：为单页生成最终生图 prompt。

## 输入契约：
- style_guide 是该项目的统一视觉规范，每页生图都必须独立携带其硬规则——下游生图模型只看 slide.prompt，看不到 style_guide，所以必须把规则原文复述到本页 prompt 里。
- slides 数组在本任务里只含 1 页（按页并发调用），仅基于该 slide 的字段补全 prompt，不改变页面意图、顺序、信息重点、slide_no。
- target_image_tool 只用于在表达层面适配下游模型，不得覆盖、削弱、概括 style_guide。

## 输出字段：
slides。
- 必须返回与输入完全相同的 slide_no, title, page_type, page_role, core_message, modules, layout, visual_elements, color_rules, text_hierarchy, page_text, source_refs。
- prompt 字段必须是一份 Markdown 字符串，并使用固定 6 段骨架：
1. 页面目标
2. 版式
3. 主视觉
4. 页面文案
5. 风格约束
6. 避免项

## 段内规则（每条都是硬约束，违反即返工）：

### 1. 页面目标
- 一段短句，说明本页要传达的核心信息（基于 core_message / page_role）。

### 2. 版式
- 必须从 style_guide.composition_rules 中选 1 条与本页 page_type 匹配的版式，原文写入（例如：三栏卡片 / 左右分栏 / 中心辐射 / 时间轴 / 流程图）。
- 必须把 style_guide.layout_rules 中所有含 "%"、"pt"、"px" 数值的条目逐条原文复述（包括但不限于：标题左缘距画布左侧不小于 6%、距顶部不小于 5%、顶部标题区高度控制在画布高度的 12%-16%、卡片内边距约 40px、左右安全边距不小于 6%、上下安全边距不小于 5%）。
- 必须把 style_guide.typography_rules 中关于标题字号字重的条目逐条原文复述（标题字号 32-40pt、字重中粗或粗体）。
- 页面标题必须左对齐，不得居中、右对齐、贴边、使用超出 32-40pt 的字号。

### 3. 主视觉
- 必须把 style_guide.color_palette 全部 hex 值逐个列出，并明确：深蓝（#1D4ED8、#0F2A5F）仅用于标题、强调线、小面积点缀；背景以 #FFFFFF、#F4F7FC、#EAF2FF 为主；其它颜色（如 #38BDF8、#64748B、#F59E0B）用于次级信息、注释或状态。
- 必须把 style_guide.icon_rules 全部条目逐条原文复述（线性图标 / 蓝色科技图标 / 政务办公、文档、流程、数据等抽象图形）。
- 必须把 style_guide.layout_rules 中关于风格调性的条目逐条原文复述（白底浅色风格、白色卡片背景、白底微蓝渐变、轻量数据流线、清爽留白等）。
- 视觉元素按本页 visual_elements 字段展开，但必须落在上述配色与图标规则之内。

### 4. 页面文案
- 基于本页 page_text / modules / core_message 写出每个模块的具体文字内容。
- 文字内容要具体、不空泛；保留每页 3-6 个核心信息点的密度（typography_rules 已约束）。

### 5. 风格约束
- 必须把 style_guide.typography_rules 全部条目（含字体家族、标题字号、副标题字号、正文字号、注释字号、字重）逐条原文复述。
- 必须把 style_guide.layout_rules 中含数值/百分比、且未在「版式」段复述过的条目继续原文复述（例如：16:9 横版 PPT、卡片白底、内容容器留白等）。
- 不允许只写"保持简约"、"政务蓝风格"、"按 style_guide 处理"、"详见统一规范"这类抽象、委托、兜底短语——生图模型看不到 style_guide，必须自包含。

### 6. 避免项
- 必须把 style_guide.negative_rules **全部条目**逐条原文复述，一条不少（包括但不限于：不要资料来源、不要官方网站、不要 GitHub、不要大段正文、不要乱码错别字、不要夸张卡通风、不要居中或右对齐任何页面标题、不要使用超出规范的标题字号、不要深色风格、不要暗黑背景、不要大面积深蓝底色）。

## 反改写守卫（违反即返工）：
1. 禁止把含 hex / pt / px / % 的具体值改写、合并、缩写成"保留安全边距"、"标题加粗突出"、"政务蓝风格"、"卡片化布局"这类泛化表达。
2. style_guide.composition_rules、icon_rules、negative_rules 的关键词必须保留原词，不得近义替换。
3. 不允许输出"详见统一规范"、"按 style_guide 处理"、"参考视觉模板"等委托式短语——所有规则必须在本页 prompt 内出现。
4. 不允许为了篇幅删减硬约束条目；篇幅长是必要代价。
5. 不输出资料来源、官网、GitHub、解释、代码块包装或额外字段。"""
