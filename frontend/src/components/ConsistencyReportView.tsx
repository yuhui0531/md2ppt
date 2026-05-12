import React from 'react';
import { Space, Typography, Alert, Card, Empty, Statistic } from 'antd';
import type { ConsistencyReport } from '../types/api';

const { Text } = Typography;

interface ConsistencyReportViewProps {
  report?: ConsistencyReport | null;
}

export function ConsistencyReportView({ report }: ConsistencyReportViewProps) {
  if (!report) {
    return <Empty description="尚未执行一致性检查" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }
  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Card bordered={false} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8 }} bodyStyle={{ padding: 16 }}>
        <Statistic 
          title="整体评分" 
          value={report.overall_score} 
          precision={2} 
          suffix={`/ 阈值 ${report.threshold.toFixed(2)}`}
          valueStyle={{ color: '#1677ff' }}
        />
      </Card>
      
      {report.slides.map((slide) => (
        <Alert
          key={slide.slide_no}
          type={slide.revision_needed ? 'error' : 'success'}
          showIcon
          message={<Text strong>第 {slide.slide_no} 页：{slide.score.toFixed(2)}</Text>}
          description={
            slide.issues.length ? (
              <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
                {slide.issues.map((issue) => <li key={issue}>{issue}</li>)}
              </ul>
            ) : (
              <Text>风格一致。</Text>
            )
          }
          style={{ borderRadius: 8 }}
        />
      ))}
    </Space>
  );
}
