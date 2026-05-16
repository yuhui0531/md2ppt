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
    prompts_imported: '已导入提示词',
    import_structure_generating: '正在补全结构',
    import_structure_generated: '结构已补全',
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
