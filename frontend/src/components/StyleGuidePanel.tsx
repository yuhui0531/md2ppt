import React from 'react';
import { Typography, Space, Tag, Empty } from 'antd';
import type { StyleGuide } from '../types/api';

const { Text, Paragraph } = Typography;

interface StyleGuidePanelProps {
  styleGuide?: StyleGuide | null;
}

export function StyleGuidePanel({ styleGuide }: StyleGuidePanelProps) {
  if (!styleGuide) {
    return <Empty description="尚未生成统一视觉规范" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }
  
  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Paragraph style={{ fontSize: 15, background: '#f8fafc', padding: 16, borderRadius: 8, margin: 0 }}>
        {styleGuide.visual_style}
      </Paragraph>
      
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 24 }}>
        <TagList title="配色" items={styleGuide.color_palette} color="blue" />
        <TagList title="版式" items={styleGuide.layout_rules} color="purple" />
        <TagList title="字体" items={styleGuide.typography_rules} color="cyan" />
        <TagList title="图标" items={styleGuide.icon_rules} color="geekblue" />
        <TagList title="避免项" items={styleGuide.negative_rules} color="volcano" />
      </div>
    </Space>
  );
}

function TagList({ title, items, color }: { title: string; items: string[]; color: string }) {
  if (!items || items.length === 0) return null;
  
  return (
    <div>
      <Text type="secondary" strong style={{ display: 'block', marginBottom: 12 }}>{title}</Text>
      <Space wrap size={[0, 8]}>
        {items.map((item) => (
          <Tag key={item} color={color} style={{ margin: '0 8px 0 0', padding: '2px 8px', fontSize: 13, borderRadius: 4 }}>
            {item}
          </Tag>
        ))}
      </Space>
    </div>
  );
}
