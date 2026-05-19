CONSISTENCY_PROMPT = """任务：检查 prompt 风格一致性。

## 输入契约：
- style_guide 是唯一风格判定标准。
- slides 中每页的 prompt 是检查对象（同一批可能只含部分页，按 slide_no 锚定）。
- threshold 是 revision_needed 的判定阈值，不参与 score 取档；不得自行修改。

## 输出字段：
overall_score, threshold, slides。
每页包含 slide_no, score, issues, revision_needed, suggested_fix。

## 规则：
1. 仅依据以下 8 个维度对每页相对 style_guide 的偏离做判断：色彩、版式、图标、字体感、视觉复杂度、材质、背景、构图。
2. 不评价内容观点正确性，不新增页面需求，不重写 prompt。
3. score 必须从 {0.3, 0.5, 0.7, 0.9} 四档中精确选择一档，禁止输出其它数值：
   - 0.9：完全对齐 style_guide，仅可能存在不影响整体观感的极细微差异；issues 应为空数组。
   - 0.7：基本一致，存在 1 处非关键细节偏差；issues 必须列出该偏差。
   - 0.5：存在 1-2 处明显偏差；issues 必须逐项列出，文案要具体（指明维度与差异内容，避免空话）。
   - 0.3：多处或严重偏离 style_guide；issues 必须详细列出问题。
4. revision_needed：score < threshold 时为 true；score ≥ threshold 时为 false。
5. 输出 slides 数组的 slide_no 集合必须严格等于输入 slides 的 slide_no 集合，不得遗漏或新增任何页；按输入顺序输出。
6. issues 必须是字符串数组，每项一个短项，不写长段评语；score=0.9 时返回空数组。
7. suggested_fix 必须是单个简短字符串，无建议时返回空字符串，不要返回数组或对象。
8. overall_score 仅作占位（后端会忽略并重算），可填 0；不要花精力计算。
9. 单页评分时只对照 style_guide 判断，不与同批其它页互相比较。
10. 不输出解释过程、Markdown 包装或额外字段。"""
