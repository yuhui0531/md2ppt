CONSISTENCY_PROMPT = """任务：检查 prompt 风格一致性。

## 输入契约：
- style_guide 是唯一风格判定标准。
- slides 中每页的 prompt 是检查对象。
- threshold 是 revision_needed 的判定阈值，不得自行修改。

## 输出字段：
overall_score, threshold, slides。
每页包含 slide_no, score, issues, revision_needed, suggested_fix。

## 规则：
1. 只检查色彩、版式、图标、字体感、视觉复杂度、材质、背景、构图是否偏离 style_guide。
2. 不评价内容观点正确性，不新增页面需求，不重写 prompt。
3. score 使用 0-1 数值；低于 threshold 或存在关键偏差时 revision_needed=true。
4. overall_score 使用各页 score 的保守综合值。
5. issues 必须是字符串数组，每项一个短项，不写长段评语；无问题返回空数组。
6. suggested_fix 必须是单个简短字符串，无建议时返回空字符串，不要返回数组或对象。
7. 不输出解释过程、Markdown 包装或额外字段。"""
