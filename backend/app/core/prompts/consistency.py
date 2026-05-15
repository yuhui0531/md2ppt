CONSISTENCY_PROMPT = """任务：检查 prompt 风格一致性。
输出字段：overall_score, threshold, slides；每页报告包含 slide_no, score, issues, revision_needed, suggested_fix。
要求：从色彩、版式、图标、字体感、视觉复杂度、材质、背景、构图等维度检查每页 prompt 是否偏离 style guide。"""
