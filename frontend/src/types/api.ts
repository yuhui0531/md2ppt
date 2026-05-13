export type SlideCountMode = 'auto' | 'fixed' | 'range';
export type ExportFormat = 'json' | 'markdown' | 'prompt_zip';

export interface ModelInfo {
  id: string;
  owned_by?: string | null;
}

export interface ModelConfigStatus {
  configured: boolean;
  base_url?: string | null;
  selected_model?: string | null;
  temperature?: number | null;
  max_tokens?: number | null;
  generation_endpoint_type?: string | null;
}

export interface ImageModelConfigStatus {
  configured: boolean;
  base_url?: string | null;
  selected_model?: string | null;
  image_size?: string | null;
  image_quality?: string | null;
}

export interface RequestedSlideRange {
  min: number;
  max: number;
}

export interface GenerationOptions {
  audience: string;
  report_scenario: string;
  slide_count_mode: SlideCountMode;
  requested_slide_count?: number | null;
  requested_slide_range?: RequestedSlideRange | null;
  content_template_id: string;
  visual_template_id: string;
  target_image_tool: string;
  prompt_output_format: 'markdown';
  consistency_threshold: number;
}

export interface ParsedSection {
  id: string;
  heading: string;
  level: number;
  content: string;
  order: number;
  parent_id?: string | null;
  metadata: Record<string, unknown>;
}

export interface DeckBrief {
  topic: string;
  audience: string;
  goal: string;
  report_scenario: string;
  narrative: string;
  main_issues: string[];
  key_arguments: string[];
  risks: string[];
  recommendations: string[];
  source_refs: string[];
}

export interface SlideCountPlan {
  mode: string;
  recommended_slide_count: number;
  accepted_slide_count: number;
  count_includes_cover: boolean;
  count_includes_agenda: boolean;
  count_includes_closing: boolean;
  reason: string;
  coverage_summary: string;
  confidence: number;
}

export interface StyleGuide {
  visual_style: string;
  color_palette: string[];
  layout_rules: string[];
  composition_rules: string[];
  typography_rules: string[];
  icon_rules: string[];
  negative_rules: string[];
}

export interface Slide {
  slide_no: number;
  title: string;
  page_type: string;
  page_role: string;
  core_message: string;
  modules: string[];
  layout: string;
  visual_elements: string[];
  color_rules: string;
  text_hierarchy: string;
  page_text: string[];
  source_refs: string[];
  prompt: string;
  style_consistency_score?: number | null;
  style_issues: string[];
  revision_needed: boolean;
  image_url?: string | null;
}

export interface ConsistencySlideReport {
  slide_no: number;
  score: number;
  issues: string[];
  revision_needed: boolean;
  suggested_fix: string;
}

export interface ConsistencyReport {
  overall_score: number;
  threshold: number;
  slides: ConsistencySlideReport[];
}

export interface ProjectData {
  schema_version: string;
  project_id: string;
  source: Record<string, unknown>;
  generation_options: GenerationOptions;
  parsed_sections: ParsedSection[];
  deck_brief?: DeckBrief | null;
  slide_count_plan?: SlideCountPlan | null;
  template: Record<string, unknown>;
  style_guide?: StyleGuide | null;
  slides: Slide[];
  consistency_report?: ConsistencyReport | null;
  generation_state: string;
}

export interface ProjectSummary {
  project_id: string;
  title: string;
  source_filename?: string | null;
  source_language: string;
  generation_state: string;
  slide_count: number;
  created_at: string;
  updated_at: string;
}

export interface JobResponse {
  job_id: string;
  project_id: string;
  kind: string;
  status: string;
  stage?: string | null;
  progress?: number | null;
  message?: string | null;
  error?: string | null;
}

export interface ExportResponse {
  filename: string;
  content_type: string;
  download_url: string;
}
