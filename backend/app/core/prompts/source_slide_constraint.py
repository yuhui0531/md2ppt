SOURCE_SLIDE_CONSTRAINT_PROMPT = """任务：从原始材料中抽取本次 PPT 总页数约束。
输出字段：kind, fixed_count, min_count, max_count, evidence, reason, confidence。

判定边界：
- 只关心本次 PPT / 幻灯片 / deck / total_page 的总页数约束。
- 不推荐页数，不总结内容，不推测用户偏好。

kind 语义：
- none：没有明确页数要求，或存在歧义，无法确定是在说 PPT 总页数。
- fixed：明确固定页数或近似固定页数，如“大概 12 页”“12 页左右”，统一归一为 fixed_count=12。
- range：明确页数范围，如“12-16 页”“控制在 12 到 16 页”“12 <= total_page <= 16”。

关键示例：
- 有效：`大概 12 页`、`控制在 12-16 页`、`12 <= total_page <= 16`
- 无效：`第 12 页展示架构图`、`12 个问题`、`12pt 字号`

规则：
1. 只有证据明确指向本次 PPT 总页数时，才能输出 fixed 或 range。
2. 只要存在歧义，就输出 none。
3. evidence 必须摘录触发判断的原文片段；reason 简洁说明判定依据。
4. 单边上限约束也可输出 range，但必须收紧范围：如“不超过 15 页”“最多 15 页”“total_page <= 15”归一为 min_count=12, max_count=15；一般按 max_count 的 80%-100% 归一，下界用 ceil(max_count*0.8)。
5. 单边下限约束若无法稳定归一成合理范围，优先输出 none。
6. 不要因内容长短、章节多少、信息密度而脑补页数要求。"""
