import React from 'react';
import { Progress, Typography, Alert, Space, Card } from 'antd';
import type { JobResponse } from '../types/api';
import { jobStatusLabel } from '../utils/projectPresentation';

const { Text } = Typography;

interface JobProgressProps {
  job?: JobResponse | null;
}

export function JobProgress({ job }: JobProgressProps) {
  if (!job) return null;
  const progress = Math.round((job.progress ?? 0) * 100);
  
  const getStatus = () => {
    if (job.status === 'completed') return 'success';
    if (job.status === 'failed') return 'exception';
    if (job.status === 'running') return 'active';
    return 'normal';
  };

  return (
    <Card bordered={false} style={{ borderRadius: 12, background: '#f8fafc', marginBottom: 24, border: '1px solid #e2e8f0' }} bodyStyle={{ padding: 20 }}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text strong style={{ fontSize: 16 }}>{job.message || '正在生成'}</Text>
          <Text type="secondary" style={{ fontSize: 13 }}>
            阶段：{stageLabel(job.stage)} · 状态：{jobStatusLabel(job.status)}
          </Text>
        </div>
        
        <Progress 
          percent={progress} 
          status={getStatus()} 
          strokeColor={job.status === 'running' ? '#1677ff' : undefined}
        />
        
        {job.error && (
          <Alert message={job.error} type="error" showIcon style={{ marginTop: 8 }} />
        )}
      </Space>
    </Card>
  );
}

function stageLabel(stage?: string | null): string {
  const labels: Record<string, string> = {
    queued: '任务已创建',
    brief_generating: '理解素材',
    slide_count_recommending: '推荐页数',
    outline_generating: '生成大纲',
    style_guide_generating: '生成视觉规范',
    prompts_generating: '生成逐页 Prompt',
    consistency_checking: '检查一致性',
    consistency_checked: '完成',
    failed: '失败',
    cancelled: '已取消',
  };
  return labels[stage ?? ''] ?? stage ?? '未知';
}
