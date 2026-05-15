SLIDE_PROMPTS_PROMPT = """任务：为每页生成生图 prompt。
输出字段：slides。
要求：每页的 prompt 字段写入一份 Markdown 格式的最终生图 prompt，不拆分 image_prompt / negative_prompt，不加额外展示包装。
prompt 至少包含：页面标题、页面定位、核心表达、页面核心模块、版式结构、主视觉元素、配色要求、文字层级、页面文字内容、生图要求、避免项。
所有页面共享同一个 style guide；页面文字必须少量、中文、短句、可读；不要生成资料来源、官网、GitHub 等无关文字。"""
