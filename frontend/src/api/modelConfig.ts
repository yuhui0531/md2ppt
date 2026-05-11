import { api } from './client';
import type { ImageModelConfigStatus, ModelConfigStatus, ModelInfo } from '../types/api';

export interface ModelListPayload {
  base_url: string;
  api_key: string;
  models_endpoint?: string;
}

export interface GenerationTestPayload {
  base_url: string;
  api_key: string;
  model: string;
  generation_endpoint_type: 'chat_completions';
}

export interface SaveModelConfigPayload {
  base_url: string;
  api_key: string;
  selected_model: string;
  temperature: number;
  max_tokens: number;
  generation_endpoint_type: 'chat_completions';
}

export function getModelConfig(): Promise<ModelConfigStatus> {
  return api<ModelConfigStatus>('/api/model-config');
}

export async function listModels(payload: ModelListPayload): Promise<ModelInfo[]> {
  const response = await api<{ models: ModelInfo[] }>('/api/model-config/models', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return response.models;
}

export function testGeneration(payload: GenerationTestPayload): Promise<{ ok: boolean; supports_json: boolean; message: string }> {
  return api('/api/model-config/generation-test', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function saveModelConfig(payload: SaveModelConfigPayload): Promise<{ config_id: string; selected_model: string; configured: boolean }> {
  return api('/api/model-config', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export interface ImageGenerationTestPayload {
  base_url: string;
  api_key: string;
  model: string;
  image_size: string;
  image_quality: string;
}

export interface SaveImageModelConfigPayload {
  base_url: string;
  api_key: string;
  selected_model: string;
  image_size: string;
  image_quality: string;
}

export function getImageModelConfig(): Promise<ImageModelConfigStatus> {
  return api<ImageModelConfigStatus>('/api/model-config?kind=image');
}

export function testImageGeneration(payload: ImageGenerationTestPayload): Promise<{ ok: boolean; message: string }> {
  return api('/api/model-config/image-generation-test', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function saveImageModelConfig(payload: SaveImageModelConfigPayload): Promise<{ config_id: string; selected_model: string; configured: boolean }> {
  return api('/api/model-config/image', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
