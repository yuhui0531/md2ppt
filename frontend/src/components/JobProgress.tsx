import React from 'react';
import { Progress, Typography, Alert, Space, Card } from 'antd';
import { LoadingOutlined, CheckCircleFilled, CloseCircleFilled, ExclamationCircleFilled } from '@ant-design/icons';
import type { JobResponse } from '../types/api';
import { jobStatusLabel } from '../utils/projectPresentation';

const { Text } = Typography;

interface JobProgressProps {
  job?: JobResponse | null;
}

export function JobProgress({ job }: JobProgressProps) {
  if (!job) return null;
  const progress = Math.round((job.progress ?? 0) * 100);
  const isRunning = job.status === 'running';
  const completedWithErrors = job.status === 'completed' && Boolean(job.error);

  const getStatus = () => {
    if (job.status === 'completed' && !completedWithErrors) return 'success';
    if (job.status === 'failed' || completedWithErrors) return 'exception';
    if (isRunning) return 'active';
    return 'normal';
  };

  const statusIcon = isRunning
    ? <LoadingOutlined spin style={{ color: '#1677ff', fontSize: 18 }} />
    : job.status === 'failed'
      ? <CloseCircleFilled style={{ color: '#ff4d4f', fontSize: 18 }} />
      : completedWithErrors
        ? <ExclamationCircleFilled style={{ color: '#faad14', fontSize: 18 }} />
        : job.status === 'completed'
          ? <CheckCircleFilled style={{ color: '#52c41a', fontSize: 18 }} />
          : null;

  return (
    <Card
      bordered={false}
      className={`job-progress-card ${isRunning ? 'is-running' : ''}`}
      style={{ borderRadius: 12, background: '#f8fafc', marginBottom: 24, border: '1px solid #e2e8f0' }}
      bodyStyle={{ padding: 20 }}
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
          <Space size={10} align="center">
            {statusIcon}
            <Text strong style={{ fontSize: 16 }}>{job.message || '正在生成'}</Text>
          </Space>
          <Text type="secondary" style={{ fontSize: 13 }}>
            阶段：{stageLabel(job.stage)} · 状态：{jobStatusLabel(job.status)}
          </Text>
        </div>

        <Progress
          percent={progress}
          status={getStatus()}
          strokeWidth={12}
          strokeColor={isRunning ? { from: '#1677ff', to: '#69b1ff' } : undefined}
          showInfo
        />

        {job.error && (
          <Alert
            message={job.error}
            type={completedWithErrors ? 'warning' : 'error'}
            showIcon
            style={{ marginTop: 8 }}
          />
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
    import_scanning: '扫描导入文件',
    import_outline_extracting: '提取页面结构',
    import_brief_generating: '汇总整体大纲',
    import_structure_saving: '保存结构化结果',
    completed: '完成',
    failed: '失败',
    cancelled: '已取消',
  };
  return labels[stage ?? ''] ?? stage ?? '未知';
}
