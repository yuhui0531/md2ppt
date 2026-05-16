import { api } from './client';
import type { JobResponse } from '../types/api';

export interface ImportPromptsResponse {
  project_id: string;
  generation_state: string;
  job: JobResponse;
}

export async function importPrompts(files: File[]): Promise<ImportPromptsResponse> {
  const form = new FormData();
  for (const file of files) {
    form.append('files', file, file.name);
  }
  return api<ImportPromptsResponse>('/api/projects/import-prompts', {
    method: 'POST',
    body: form,
  });
}
