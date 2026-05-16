from app.models.schemas import StyleGuide


class TemplateService:
    @staticmethod
    def default_style_guide() -> StyleGuide:
        return StyleGuide(
            visual_style="政务蓝科技感，专业汇报风，白底微蓝渐变，圆角卡片体系，轻量数据流线，清晰分区。",
            color_palette=["#1D4ED8", "#0F2A5F", "#EAF2FF", "#38BDF8", "#64748B", "#F4F7FC", "#FFFFFF", "#F59E0B"],
            layout_rules=[
                "16:9 横版 PPT",
                "顶部标题区固定左对齐，标题左缘与正文网格对齐，距画布左侧不小于 6%、距顶部不小于 5%",
                "顶部标题区高度控制在画布高度的 12%-16%，标题最多两行，不居中、不贴边、不使用超大艺术字",
                "中部核心内容区，底部结论或关键词区（需白底微蓝渐变）",
                "卡片式信息承载，左右安全边距不小于 6%，上下安全边距不小于 5%，内容不得侵入标题区",
            ],
            composition_rules=["左右分栏", "三栏卡片", "中心辐射", "时间轴", "流程图"],
            typography_rules=[
                "中文黑体 / 思源黑体风格，标题使用中粗或粗字重",
                "标题字号控制在 32-40pt，副标题 18-24pt，正文 16-20pt，注释 12-14pt",
                "文字少量清晰，每页 3-6 个核心信息点",
            ],
            icon_rules=["线性图标", "蓝色科技图标", "政务办公、文档、流程、数据等抽象图形"],
            negative_rules=["不要资料来源", "不要官方网站", "不要 GitHub", "不要大段正文", "不要乱码错别字",
                            "不要夸张卡通风", "不要居中或右对齐顶部标题", "不要使用超出规范的标题字号"],
        )
