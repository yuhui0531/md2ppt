export function projectStateLabel(state?: string | null): string {
  const labels: Record<string, string> = {
    parsed: '已解析',
    brief_generated: '已完成内容理解',
    slide_count_recommended: '已推荐页数',
    outline_generated: '已生成大纲',
    style_guide_generated: '已生成视觉规范',
    prompts_generated: '已生成提示词',
    consistency_checked: '已检查一致性',
    revised: '已修正',
  };
  return labels[state ?? ''] ?? '处理中';
}

export function jobStatusLabel(status?: string | null): string {
  const labels: Record<string, string> = {
    running: '进行中',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
  };
  return labels[status ?? ''] ?? '未知';
}

// page_type 是模型自由生成的英文 slug，不在固定枚举里。这里维护一份常见值
// 到中文的映射，未命中的原样返回，便于在新类型出现时能直接看出来。
export function pageTypeLabel(type?: string | null): string {
  const raw = (type ?? '').trim();
  if (!raw) return '';
  const labels: Record<string, string> = {
    cover: '封面',
    agenda: '目录',
    introduction: '引言',
    background: '背景',
    objective: '目标',
    scope: '范围',
    methodology: '方法',
    problem_statement: '问题陈述',
    competitive_landscape: '竞争格局',
    capability_gap: '能力差距',
    platform_assessment: '平台评估',
    swot: 'SWOT 分析',
    analysis: '分析',
    comparison: '对比',
    case_study: '案例',
    data: '数据',
    solution: '解决方案',
    strategy: '战略',
    roadmap: '路线图',
    timeline: '时间线',
    milestone: '里程碑',
    risk: '风险',
    risk_matrix: '风险矩阵',
    recommendation: '建议',
    closing_recommendation: '收尾建议',
    closing: '收尾',
    conclusion: '结论',
    summary: '总结',
    transition: '过渡',
    appendix: '附录',
    qa: '问答',
    thanks: '致谢',
  };
  return labels[raw.toLowerCase()] ?? raw;
}
