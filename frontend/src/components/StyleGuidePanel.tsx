import type { StyleGuide } from '../types/api';

interface StyleGuidePanelProps {
  styleGuide?: StyleGuide | null;
}

export function StyleGuidePanel({ styleGuide }: StyleGuidePanelProps) {
  if (!styleGuide) {
    return <p className="muted">尚未生成统一视觉规范。</p>;
  }
  return (
    <div className="stack compact">
      <p>{styleGuide.visual_style}</p>
      <TagList title="配色" items={styleGuide.color_palette} />
      <TagList title="版式" items={styleGuide.layout_rules} />
      <TagList title="字体" items={styleGuide.typography_rules} />
      <TagList title="图标" items={styleGuide.icon_rules} />
      <TagList title="避免项" items={styleGuide.negative_rules} />
    </div>
  );
}

function TagList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3>{title}</h3>
      <div className="tags">
        {items.map((item) => <span className="tag" key={item}>{item}</span>)}
      </div>
    </div>
  );
}
