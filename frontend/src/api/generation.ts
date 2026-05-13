import { api } from './client';
import type { JobResponse, ProjectData, RequestedSlideRange } from '../types/api';

export function generateProject(projectId: string, mode: 'auto' | 'restart' = 'auto'): Promise<JobResponse> {
  return api(`/api/projects/${projectId}/generate`, {
    method: 'POST',
    body: JSON.stringify({ mode }),
  });
}

export function getJob(jobId: string): Promise<JobResponse> {
  return api(`/api/jobs/${jobId}`);
}

export function getActiveJob(projectId: string): Promise<JobResponse | null> {
  return api<JobResponse | null>(`/api/projects/${projectId}/active-job`);
}

export function cancelJob(jobId: string): Promise<JobResponse> {
  return api(`/api/jobs/${jobId}/cancel`, { method: 'POST' });
}

export async function regenerateOutline(
  projectId: string,
  payload: { slide_count_mode: 'auto' | 'fixed' | 'range'; requested_slide_count?: number | null; requested_slide_range?: RequestedSlideRange | null },
): Promise<ProjectData> {
  const response = await api<{ project: ProjectData }>(`/api/projects/${projectId}/regenerate-outline`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return response.project;
}

export async function regeneratePrompts(projectId: string, slideNumbers?: number[]): Promise<ProjectData> {
  const response = await api<{ project: ProjectData }>(`/api/projects/${projectId}/regenerate-prompts`, {
    method: 'POST',
    body: JSON.stringify({ slide_numbers: slideNumbers ?? null, use_current_outline: true, use_current_style_guide: true }),
  });
  return response.project;
}

export async function checkConsistency(projectId: string, threshold: number): Promise<ProjectData> {
  const response = await api<{ project: ProjectData }>(`/api/projects/${projectId}/check-consistency`, {
    method: 'POST',
    body: JSON.stringify({ slide_numbers: null, threshold }),
  });
  return response.project;
}

export async function reviseInconsistentPrompts(projectId: string, threshold: number): Promise<ProjectData> {
  const response = await api<{ project: ProjectData }>(`/api/projects/${projectId}/revise-inconsistent-prompts`, {
    method: 'POST',
    body: JSON.stringify({ threshold, max_rounds: 2 }),
  });
  return response.project;
}
