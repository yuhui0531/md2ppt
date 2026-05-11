import { getJob } from '../api/generation';
import type { JobResponse } from '../types/api';

export async function pollJobUntilFinished(
  jobId: string,
  onUpdate?: (job: JobResponse) => void,
): Promise<JobResponse> {
  while (true) {
    await new Promise((resolve) => window.setTimeout(resolve, 1200));
    const latest = await getJob(jobId);
    onUpdate?.(latest);
    if (latest.status === 'completed') {
      return latest;
    }
    if (latest.status === 'failed') {
      throw new Error(latest.error || latest.message || '生成失败');
    }
    if (latest.status === 'cancelled') {
      throw new Error('任务已取消');
    }
  }
}
