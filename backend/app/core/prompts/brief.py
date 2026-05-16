BRIEF_PROMPT = """任务：输出抽取型汇报摘要。

## 输入契约：
- generation_options 只提供受众和汇报场景默认值。
- parsed_sections 是唯一内容来源，只能抽取其中能确认的信息。
- 不得根据常识、行业经验或标题自由补写事实。

## 输出字段：
topic, audience, goal, report_scenario, narrative, main_issues, key_arguments, risks, recommendations, source_refs。
- narrative：1-2 段短摘要。
- main_issues, key_arguments, risks, recommendations：各 3-5 条字符串。
- source_refs：引用输入中可定位的章节、标题或要点，字符串数组。

## 规则：
1. 只抽取输入里能确认的信息；缺失字段返回空字符串或空数组。
2. audience 和 report_scenario 可沿用 generation_options，但不得发散成新场景。
3. 不机械改写标题，不大段复制原文，不输出长篇解释。
4. 不新增输入中没有的风险、建议、结论、数据或专有名词。
5. 只输出约定 JSON 字段，不输出资料来源、Markdown 包装或额外说明。"""
