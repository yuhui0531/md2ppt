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

export function reviseInconsistentPrompts(
  projectId: string,
  threshold: number,
  slideNumbers?: number[],
): Promise<JobResponse> {
  return api(`/api/projects/${projectId}/revise-inconsistent-prompts`, {
    method: 'POST',
    body: JSON.stringify({ threshold, max_rounds: 2, slide_numbers: slideNumbers ?? null }),
  });
}

export async function insertSlide(
  projectId: string,
  afterSlideId: string | null,
  prompt: string,
): Promise<{ project: ProjectData; newSlideId: string }> {
  const response = await api<{ project: ProjectData; new_slide_id: string }>(`/api/projects/${projectId}/slides`, {
    method: 'POST',
    body: JSON.stringify({ after_slide_id: afterSlideId, prompt }),
  });
  return { project: response.project, newSlideId: response.new_slide_id };
}

export async function updateSlidePrompt(projectId: string, slideId: string, prompt: string): Promise<ProjectData> {
  const response = await api<{ project: ProjectData }>(`/api/projects/${projectId}/slides/${slideId}`, {
    method: 'PATCH',
    body: JSON.stringify({ prompt }),
  });
  return response.project;
}

export async function deleteSlide(projectId: string, slideId: string): Promise<ProjectData> {
  const response = await api<{ project: ProjectData }>(`/api/projects/${projectId}/slides/${slideId}`, {
    method: 'DELETE',
  });
  return response.project;
}

export function regenerateImportStructure(projectId: string): Promise<JobResponse> {
  return api(`/api/projects/${projectId}/regenerate-import-structure`, {
    method: 'POST',
  });
}
