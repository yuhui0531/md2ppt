REVISE_PROMPT = """任务：最小化修正不一致页面的 prompt。\n输出字段：slides。\n规则：只改不一致页面的 prompt 字段；不要改变页面标题、核心表达、页面类型、source_refs；优先修偏差项，不整页重写；输出仍是一份 Markdown 格式的最终生图 prompt。"""
