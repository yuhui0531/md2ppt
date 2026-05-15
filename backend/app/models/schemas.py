from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator


class ErrorResponse(BaseModel):
    detail: str


class ModelListRequest(BaseModel):
    base_url: str
    api_key: str = Field(min_length=1)
    models_endpoint: str = "/v1/models"


class ModelInfo(BaseModel):
    id: str
    owned_by: str | None = None


class ModelListResponse(BaseModel):
    models: list[ModelInfo]


class GenerationTestRequest(BaseModel):
    base_url: str
    api_key: str = Field(min_length=1)
    model: str = Field(min_length=1)
    generation_endpoint_type: Literal["chat_completions"] = "chat_completions"


class GenerationTestResponse(BaseModel):
    ok: bool
    supports_json: bool = False
    message: str


class SaveModelConfigRequest(BaseModel):
    base_url: str
    api_key: str = Field(min_length=1)
    selected_model: str = Field(min_length=1)
    temperature: float = Field(default=0.4, ge=0.0, le=2.0)
    max_tokens: int = Field(default=81920, ge=1)
    generation_endpoint_type: Literal["chat_completions"] = "chat_completions"


class SaveModelConfigResponse(BaseModel):
    config_id: str
    selected_model: str
    configured: bool


class ModelConfigStatusResponse(BaseModel):
    configured: bool
    base_url: str | None = None
    selected_model: str | None = None
    temperature: float | None = None
    max_tokens: int | None = None
    generation_endpoint_type: str | None = None


class ImageModelConfigStatusResponse(BaseModel):
    configured: bool
    base_url: str | None = None
    selected_model: str | None = None
    image_size: str | None = None
    image_quality: str | None = None


class ImageGenerationTestRequest(BaseModel):
    base_url: str
    api_key: str = Field(min_length=1)
    model: str = Field(min_length=1)
    image_size: str = "2048x1152"
    image_quality: str = "hd"


class ImageGenerationTestResponse(BaseModel):
    ok: bool
    message: str


class SaveImageModelConfigRequest(BaseModel):
    base_url: str
    api_key: str = Field(min_length=1)
    selected_model: str = Field(min_length=1)
    image_size: str = "2048x1152"
    image_quality: str = "hd"


class SourceInput(BaseModel):
    filename: str | None = None
    content: str
    content_format: Literal["markdown"] = "markdown"
    language: str = "zh-CN"


class RequestedSlideRange(BaseModel):
    min: int = Field(ge=1)
    max: int = Field(ge=1)

    @model_validator(mode="after")
    def validate_range(self) -> "RequestedSlideRange":
        if self.max < self.min:
            raise ValueError("页数范围最大值不能小于最小值")
        return self


class GenerationOptions(BaseModel):
    audience: str = "领导汇报"
    report_scenario: str = "内部研讨"
    slide_count_mode: Literal["auto", "fixed", "range"] = "auto"
    requested_slide_count: int | None = Field(default=None, ge=1)
    requested_slide_range: RequestedSlideRange | None = None
    content_template_id: str = "product-issue-report"
    visual_template_id: str = "gov-blue-tech-report"
    target_image_tool: str = "generic"
    prompt_output_format: Literal["markdown"] = "markdown"
    consistency_threshold: float = Field(default=0.85, ge=0.0, le=1.0)

    @model_validator(mode="after")
    def validate_slide_count_mode(self) -> "GenerationOptions":
        if self.slide_count_mode == "fixed" and self.requested_slide_count is None:
            raise ValueError("固定页数模式必须填写 requested_slide_count")
        if self.slide_count_mode == "range" and self.requested_slide_range is None:
            raise ValueError("页数范围模式必须填写 requested_slide_range")
        return self


class CreateProjectRequest(BaseModel):
    source: SourceInput
    generation_options: GenerationOptions


class CreateProjectResponse(BaseModel):
    project_id: str
    generation_state: str


class ProjectSummary(BaseModel):
    project_id: str
    title: str
    source_filename: str | None = None
    source_language: str = "zh-CN"
    generation_state: str
    slide_count: int = 0
    created_at: str
    updated_at: str


class ProjectListResponse(BaseModel):
    projects: list[ProjectSummary]


class RenameProjectRequest(BaseModel):
    title: str = Field(min_length=1, max_length=120)


class RenameProjectResponse(BaseModel):
    project_id: str
    title: str


class SuggestTitleResponse(BaseModel):
    title: str


class ParsedSection(BaseModel):
    id: str
    heading: str
    level: int
    content: str
    order: int
    parent_id: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class DeckBrief(BaseModel):
    topic: str = ""
    audience: str = ""
    goal: str = ""
    report_scenario: str = ""
    narrative: str = ""
    main_issues: list[str] = Field(default_factory=list)
    key_arguments: list[str] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)
    recommendations: list[str] = Field(default_factory=list)
    source_refs: list[str] = Field(default_factory=list)


class SourceSlideCountConstraint(BaseModel):
    kind: Literal["none", "fixed", "range"] = "none"
    fixed_count: int | None = Field(default=None, ge=1)
    min_count: int | None = Field(default=None, ge=1)
    max_count: int | None = Field(default=None, ge=1)
    evidence: str = ""
    reason: str = ""
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)

    @model_validator(mode="after")
    def validate_counts(self) -> "SourceSlideCountConstraint":
        if self.kind == "none":
            return self
        if self.kind == "fixed":
            if self.fixed_count is None:
                raise ValueError("fixed 类型必须提供 fixed_count")
            return self
        if self.min_count is None or self.max_count is None:
            raise ValueError("range 类型必须提供 min_count 和 max_count")
        if self.max_count < self.min_count:
            raise ValueError("range 类型的 max_count 不能小于 min_count")
        return self


class SlideCountPlan(BaseModel):
    mode: str = "auto"
    recommended_slide_count: int = 0
    accepted_slide_count: int = 0
    count_includes_cover: bool = True
    count_includes_agenda: bool = False
    count_includes_closing: bool = True
    reason: str = ""
    coverage_summary: str = ""
    confidence: float = 0.0


class StyleGuide(BaseModel):
    visual_style: str = ""
    color_palette: list[str] = Field(default_factory=list)
    layout_rules: list[str] = Field(default_factory=list)
    composition_rules: list[str] = Field(default_factory=list)
    typography_rules: list[str] = Field(default_factory=list)
    icon_rules: list[str] = Field(default_factory=list)
    negative_rules: list[str] = Field(default_factory=list)


class Slide(BaseModel):
    slide_no: int
    title: str
    page_type: str
    page_role: str = ""
    core_message: str = ""
    modules: list[str] = Field(default_factory=list)
    layout: str = ""
    visual_elements: list[str] = Field(default_factory=list)
    color_rules: str = ""
    text_hierarchy: str = ""
    page_text: list[str] = Field(default_factory=list)
    source_refs: list[str] = Field(default_factory=list)
    prompt: str = ""
    style_consistency_score: float | None = None
    style_issues: list[str] = Field(default_factory=list)
    revision_needed: bool = False
    image_url: str | None = None


class ConsistencySlideReport(BaseModel):
    slide_no: int
    score: float
    issues: list[str] = Field(default_factory=list)
    revision_needed: bool = False
    suggested_fix: str = ""


class ConsistencyReport(BaseModel):
    overall_score: float = 0.0
    threshold: float = 0.85
    slides: list[ConsistencySlideReport] = Field(default_factory=list)


class ProjectData(BaseModel):
    schema_version: str = "1.0"
    project_id: str
    source: dict[str, Any]
    generation_options: GenerationOptions
    parsed_sections: list[ParsedSection] = Field(default_factory=list)
    deck_brief: DeckBrief | None = None
    source_slide_count_constraint: SourceSlideCountConstraint | None = None
    slide_count_plan: SlideCountPlan | None = None
    template: dict[str, Any] = Field(default_factory=dict)
    style_guide: StyleGuide | None = None
    slides: list[Slide] = Field(default_factory=list)
    consistency_report: ConsistencyReport | None = None
    generation_state: str = "uploaded"


class ProjectResponse(BaseModel):
    project: ProjectData


class GenerateProjectRequest(BaseModel):
    mode: Literal["auto", "restart"] = "auto"


class JobResponse(BaseModel):
    job_id: str
    project_id: str
    kind: str = "generation"
    status: str
    stage: str | None = None
    progress: float | None = None
    message: str | None = None
    error: str | None = None


class RegenerateOutlineRequest(BaseModel):
    slide_count_mode: Literal["auto", "fixed", "range"] = "auto"
    requested_slide_count: int | None = None
    requested_slide_range: RequestedSlideRange | None = None


class RegeneratePromptsRequest(BaseModel):
    slide_numbers: list[int] | None = None
    use_current_outline: bool = True
    use_current_style_guide: bool = True


class CheckConsistencyRequest(BaseModel):
    slide_numbers: list[int] | None = None
    threshold: float = Field(default=0.85, ge=0.0, le=1.0)


class ReviseInconsistentPromptsRequest(BaseModel):
    threshold: float = Field(default=0.85, ge=0.0, le=1.0)
    max_rounds: int = Field(default=2, ge=1, le=3)


class GenerateImagesRequest(BaseModel):
    slide_numbers: list[int] | None = None
    extra_prompt: str | None = None


class ExportRequest(BaseModel):
    format: Literal["json", "markdown", "prompt_zip"]
    include_index: bool = True


class ExportResponse(BaseModel):
    filename: str
    content_type: str
    download_url: str
