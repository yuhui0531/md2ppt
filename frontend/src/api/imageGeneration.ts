import { api } from './client';
import type { JobResponse } from '../types/api';

export interface GenerateImagesPayload {
  slide_numbers: number[] | null;
  extra_prompt?: string | null;
}

export function generateImages(projectId: string, payload: GenerateImagesPayload): Promise<JobResponse> {
  return api(`/api/projects/${projectId}/generate-images`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function exportPptx(projectId: string): Promise<{ filename: string; content_type: string; download_url: string }> {
  return api('/api/projects/' + projectId + '/export-pptx', {
    method: 'POST',
  });
}
