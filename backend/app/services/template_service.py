from app.models.schemas import StyleGuide


class TemplateService:
    def default_style_guide(self) -> StyleGuide:
        return StyleGuide(
            visual_style="政务蓝科技感，专业汇报风，白底微蓝渐变，圆角卡片体系，轻量数据流线，清晰分区。",
            color_palette=["#1D4ED8", "#0F2A5F", "#EAF2FF", "#38BDF8", "#64748B", "#F4F7FC", "#FFFFFF", "#F59E0B"],
            layout_rules=[
                "16:9 横版 PPT",
                "顶部标题区，中部核心内容区，底部结论或关键词区",
                "卡片式信息承载，保留安全边距",
            ],
            composition_rules=["左右分栏", "三栏卡片", "中心辐射", "时间轴", "流程图"],
            typography_rules=["中文黑体 / 思源黑体风格", "文字少量清晰", "每页 3-6 个核心信息点"],
            icon_rules=["线性图标", "蓝色科技图标", "政务办公、文档、流程、数据等抽象图形"],
            negative_rules=["不要资料来源", "不要官方网站", "不要 GitHub", "不要大段正文", "不要乱码错别字", "不要夸张卡通风"],
        )
