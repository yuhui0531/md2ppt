import { api } from './client';
import type { GenerationOptions, ProjectData, ProjectSummary } from '../types/api';

export interface CreateProjectPayload {
  source: {
    filename?: string | null;
    content: string;
    content_format: 'markdown';
    language: string;
  };
  generation_options: GenerationOptions;
}

export async function createProject(payload: CreateProjectPayload): Promise<{ project_id: string; generation_state: string }> {
  return api('/api/projects', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const response = await api<{ projects: ProjectSummary[] }>('/api/projects');
  return response.projects;
}

export async function renameProject(projectId: string, title: string): Promise<{ project_id: string; title: string }> {
  return api(`/api/projects/${projectId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  });
}

export async function suggestProjectTitle(projectId: string): Promise<{ title: string }> {
  return api(`/api/projects/${projectId}/suggest-title`, {
    method: 'POST',
  });
}

export async function deleteProject(projectId: string): Promise<void> {
  await api(`/api/projects/${projectId}`, {
    method: 'DELETE',
  });
}

export async function getProject(projectId: string): Promise<ProjectData> {
  const response = await api<{ project: ProjectData }>(`/api/projects/${projectId}`);
  return response.project;
}
