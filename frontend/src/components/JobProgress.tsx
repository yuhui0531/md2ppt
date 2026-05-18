import React from 'react';
import { Progress, Typography, Alert, Space, Card, Button } from 'antd';
import { LoadingOutlined, CheckCircleFilled, CloseCircleFilled, ExclamationCircleFilled } from '@ant-design/icons';
import type { JobResponse } from '../types/api';
import { jobStatusLabel } from '../utils/projectPresentation';

const { Text } = Typography;

interface JobProgressProps {
  job?: JobResponse | null;
  onCancel?: () => void;
}

export function JobProgress({ job, onCancel }: JobProgressProps) {
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
      style={{ borderRadius: 0, background: '#f8fafc', marginBottom: 24, border: '1px solid #e2e8f0' }}
      bodyStyle={{ padding: 20 }}
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
          <Space size={10} align="center">
            {statusIcon}
            <Text strong style={{ fontSize: 16 }}>{job.message || '正在生成'}</Text>
          </Space>
          <Space size={12} align="center">
            <Text type="secondary" style={{ fontSize: 13 }}>
              阶段：{stageLabel(job.stage)} · 状态：{jobStatusLabel(job.status)}
            </Text>
            {onCancel && isRunning && (
              <Button size="small" danger onClick={onCancel}>取消任务</Button>
            )}
          </Space>
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
    checking_initial: '初始一致性检查',
    no_inconsistent: '无需修正',
    revising_round_1: '第 1 轮修正 prompt',
    checking_round_1: '第 1 轮重新评分',
    round_1_done: '第 1 轮完成',
    revising_round_2: '第 2 轮修正 prompt',
    checking_round_2: '第 2 轮重新评分',
    round_2_done: '第 2 轮完成',
    revising_round_3: '第 3 轮修正 prompt',
    checking_round_3: '第 3 轮重新评分',
    round_3_done: '第 3 轮完成',
    // 生图前的自动修正阶段：复用 revise 流程，加 preflight_ 前缀区分来源，
    // 让用户在生图进度条上看到「生图前自动修正 prompt」而非干巴巴的「第 N 轮」。
    preflight_checking_initial: '生图前检查一致性',
    preflight_no_inconsistent: '生图前检查·prompt 一致',
    preflight_revising_round_1: '生图前自动修正 prompt（第 1 轮）',
    preflight_checking_round_1: '生图前重新评分（第 1 轮）',
    preflight_round_1_done: '生图前修正完成',
    revising_prompts: '生图前修正 prompt',
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
