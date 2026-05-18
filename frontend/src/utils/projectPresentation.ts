import type { ProjectSummary } from '../types/api';

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

export type StepStatus = 'wait' | 'process' | 'finish';
export type ProjectStepKey = 'outline' | 'prompts' | 'consistency' | 'images';

export interface ProjectStep {
  key: ProjectStepKey;
  title: string;
  status: StepStatus;
  description?: string;
}

// 各 generation_state 已走完到哪一步（0 ~ 3）：
// 0=outline 未完成；1=outline 完成；2=prompts 完成；3=consistency 完成。
// 「生图」步没有完成态信号（list API 不返回 image 覆盖率），所以最多到 3。
const GENERATION_STATE_COMPLETION: Record<string, number> = {
  parsed: 0,
  brief_generated: 0,
  slide_count_recommended: 0,
  outline_generated: 1,
  style_guide_generated: 1,
  prompts_generated: 2,
  consistency_checked: 3,
  revised: 3,
  prompts_imported: 0,
  import_structure_generating: 0,
  // imported 项目走完结构补全 ≈ outline + prompts 两步同时完成（结构与 prompt 一起就绪）。
  import_structure_generated: 2,
};

const STEPS: { key: ProjectStepKey; title: string; completedAt: number }[] = [
  { key: 'outline', title: '大纲', completedAt: 1 },
  { key: 'prompts', title: '提示词', completedAt: 2 },
  { key: 'consistency', title: '一致性', completedAt: 3 },
  { key: 'images', title: '生图', completedAt: 4 },
];

export function projectProgress(project: ProjectSummary): ProjectStep[] {
  const completionLevel = GENERATION_STATE_COMPLETION[project.generation_state] ?? 0;
  const job = project.active_job;

  // 决定哪一步处于 process：active_job 是真值；否则只有 finish/wait。
  let processingIndex: number | null = null;
  let processingDescription: string | undefined;
  if (job && job.status === 'running') {
    const desc = [job.stage, job.message].filter(Boolean).join(' · ');
    processingDescription = desc || undefined;
    if (job.kind === 'image_generation') {
      processingIndex = 3;
    } else if (job.kind === 'import_structure_generation') {
      // imported 项目「补全结构」对应第 1 步（大纲）。补全完成后会同时点亮 prompts。
      processingIndex = 0;
    } else {
      // generation kind：用 stage 字符串前缀判断当前阶段。后端 stage 命名见
      // generation_service.run_generation：brief_/slide_count_/outline_/
      // style_guide_/prompts_/consistency_/revising_。
      const stage = job.stage ?? '';
      if (stage.startsWith('consistency') || stage.startsWith('revising')) processingIndex = 2;
      else if (stage.startsWith('prompts') || stage.startsWith('style_guide')) processingIndex = 1;
      else processingIndex = 0;
    }
  }

  return STEPS.map((step, index) => {
    let status: StepStatus;
    if (processingIndex === index) status = 'process';
    else if (completionLevel >= step.completedAt) status = 'finish';
    // 「生图」步没有对应 generation_state，靠后端 images_ready 字段点亮 finish，
    // 否则 image_generation job 跑完后 active_job 变 None 会让生图步又回 wait。
    else if (step.key === 'images' && project.images_ready) status = 'finish';
    else status = 'wait';
    return {
      key: step.key,
      title: step.title,
      status,
      description: status === 'process' ? processingDescription : undefined,
    };
  });
}

export function projectHasActiveJob(project: ProjectSummary): boolean {
  return project.active_job?.status === 'running';
}
