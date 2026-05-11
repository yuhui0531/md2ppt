import type { JobResponse } from '../types/api';
import { jobStatusLabel } from '../utils/projectPresentation';

interface JobProgressProps {
  job?: JobResponse | null;
}

export function JobProgress({ job }: JobProgressProps) {
  if (!job) return null;
  const progress = Math.round((job.progress ?? 0) * 100);
  return (
    <div className="job-progress">
      <div className="progress-header">
        <strong>{job.message || '正在生成'}</strong>
        <span>{progress}%</span>
      </div>
      <div className="progress-track">
        <div className={`progress-bar ${job.status === 'running' ? 'running' : ''}`} style={{ width: `${progress}%` }} />
      </div>
      <small>阶段：{stageLabel(job.stage)} · 状态：{jobStatusLabel(job.status)}</small>
      {job.error ? <pre className="error-box">{job.error}</pre> : null}
    </div>
  );
}

function stageLabel(stage?: string | null): string {
  const labels: Record<string, string> = {
    queued: '任务已创建',
    brief_generating: '理解素材',
    slide_count_recommending: '推荐页数',
    outline_generating: '生成大纲',
    style_guide_generating: '生成视觉规范',
    prompts_generating: '生成逐页 Prompt',
    consistency_checking: '检查一致性',
    consistency_checked: '完成',
    failed: '失败',
    cancelled: '已取消',
  };
  return labels[stage ?? ''] ?? stage ?? '未知';
}
