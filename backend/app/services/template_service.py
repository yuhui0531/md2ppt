from app.models.schemas import StyleGuide


class TemplateService:
    _CONFLICTING_VISUAL_STYLE_TERMS = ("深色", "暗黑", "黑色背景", "深蓝背景", "大面积深蓝")

    @staticmethod
    def default_style_guide() -> StyleGuide:
        return StyleGuide(
            visual_style="政务蓝科技感，专业汇报风，白底浅色风格，白底微蓝渐变，圆角卡片体系，轻量数据流线，清晰分区。",
            color_palette=["#1D4ED8", "#0F2A5F", "#EAF2FF", "#38BDF8", "#64748B", "#F4F7FC", "#FFFFFF", "#F59E0B"],
            layout_rules=[
                "16:9 横版 PPT",
                "整体必须采用白底浅色风格，页面背景以 #FFFFFF、#F4F7FC、#EAF2FF 为主，深蓝只用于标题、强调线和小面积点缀",
                "标题优先使用 34pt 深蓝中粗或粗体，落在页面左上安全区内，并与正文网格左缘对齐",
                "内容容器优先使用白色卡片背景，卡片内边距约 40px，并保持清爽留白",
                "内容页优先采用三栏卡片布局；封面页、章节页、流程页等按 composition_rules 选择更合适的版式",
                "每页标题必须左对齐，所有封面页、目录页、章节页、内容页和结尾页的标题均不得居中或右对齐",
                "每页标题区必须遵守安全边距：标题左缘距画布左侧不小于 6%，距顶部不小于 5%，不得贴边或侵入正文内容区",
                "顶部标题区固定左对齐，标题左缘与正文网格对齐，距画布左侧不小于 6%、距顶部不小于 5%",
                "顶部标题区高度控制在画布高度的 12%-16%，标题最多两行，不居中、不贴边、不使用超大艺术字",
                "中部核心内容区，底部结论或关键词区（需白底微蓝渐变）",
                "卡片式信息承载，左右安全边距不小于 6%，上下安全边距不小于 5%，内容不得侵入标题区",
            ],
            composition_rules=["左右分栏", "三栏卡片", "中心辐射", "时间轴", "流程图"],
            typography_rules=[
                "中文黑体 / 思源黑体风格，标题使用中粗或粗字重",
                "每页标题必须使用 32-40pt 字号，标题字重为中粗或粗体，超长标题最多两行并保持左对齐",
                "标题字号控制在 32-40pt，副标题 18-24pt，正文 16-20pt，注释 12-14pt",
                "文字少量清晰，每页 3-6 个核心信息点",
            ],
            icon_rules=["线性图标", "蓝色科技图标", "政务办公、文档、流程、数据等抽象图形"],
            negative_rules=["不要资料来源", "不要官方网站", "不要 GitHub", "不要大段正文", "不要乱码错别字",
                            "不要夸张卡通风", "不要居中或右对齐任何页面标题", "不要使用超出规范的标题字号",
                            "不要深色风格、暗黑背景或大面积深蓝底色"],
        )

    @classmethod
    def enforce_style_guide_constraints(cls, style_guide: StyleGuide | None) -> StyleGuide:
        default = cls.default_style_guide()
        if style_guide is None:
            return default

        return style_guide.model_copy(update={
            "visual_style": cls._merge_visual_style(style_guide.visual_style, default.visual_style),
            "color_palette": cls._prepend_required(style_guide.color_palette, default.color_palette),
            "layout_rules": cls._prepend_required(style_guide.layout_rules, default.layout_rules),
            "composition_rules": cls._prepend_required(style_guide.composition_rules, default.composition_rules),
            "typography_rules": cls._prepend_required(style_guide.typography_rules, default.typography_rules),
            "icon_rules": cls._prepend_required(style_guide.icon_rules, default.icon_rules),
            "negative_rules": cls._prepend_required(style_guide.negative_rules, default.negative_rules),
        })

    @staticmethod
    def _merge_visual_style(existing: str, default: str) -> str:
        cleaned = existing.strip()
        if not cleaned or any(term in cleaned for term in TemplateService._CONFLICTING_VISUAL_STYLE_TERMS):
            return default
        if cleaned == default or cleaned in default:
            return default
        if default in cleaned:
            return cleaned
        return f"{default} {cleaned}"

    @staticmethod
    def _prepend_required(
        existing: list[str],
        required: list[str],
    ) -> list[str]:
        normalized_required = {item.strip() for item in required if item.strip()}
        merged = [item for item in required if item.strip()]
        for item in existing:
            cleaned = item.strip()
            if not cleaned or cleaned in normalized_required:
                continue
            merged.append(cleaned)
        return merged
