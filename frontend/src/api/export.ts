import { api } from './client';
import type { ExportFormat, ExportResponse } from '../types/api';

export function exportProject(projectId: string, format: ExportFormat, includeIndex = true): Promise<ExportResponse> {
  return api(`/api/projects/${projectId}/export`, {
    method: 'POST',
    body: JSON.stringify({ format, include_index: includeIndex }),
  });
}
