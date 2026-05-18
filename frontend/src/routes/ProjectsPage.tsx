import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getModelConfig } from '../api/modelConfig';
import { deleteProject, listProjects, renameProject, suggestProjectTitle } from '../api/projects';
import { StatusMessage } from '../components/StatusMessage';
import type { ProjectSummary } from '../types/api';
import { projectHasActiveJob, projectProgress, projectStateLabel } from '../utils/projectPresentation';

import { Card, Col, Row, Typography, Button, Space, Statistic, List, Tag, Popconfirm, Input, Alert, Empty, Segmented, Steps } from 'antd';
import { EditOutlined, DeleteOutlined, RightOutlined, ExportOutlined, ThunderboltOutlined, LoadingOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;

type OriginFilter = 'all' | 'generated_markdown' | 'imported_prompts';

export function ProjectsPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [busy, setBusy] = useState(true);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'info' | 'success' | 'error'; text: string } | null>(null);
  const [configured, setConfigured] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [originFilter, setOriginFilter] = useState<OriginFilter>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    loadPage();
  }, []);

  // 任意项目有活跃 job 时每 5s 静默 reload 一次列表；无 job 时停止轮询。
  // 用 silentReload 而非 loadPage：避免触发 busy=true 让 <List loading> 闪烁。
  useEffect(() => {
    const hasActive = projects.some(projectHasActiveJob);
    if (!hasActive) return;
    const timer = setInterval(() => { silentReload(); }, 5000);
    return () => clearInterval(timer);
  }, [projects]);

  async function loadPage() {
    setBusy(true);
    try {
      const [items, config] = await Promise.all([listProjects(), getModelConfig()]);
      setProjects(items);
      setConfigured(Boolean(config.configured));
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : '加载项目列表失败' });
    } finally {
      setBusy(false);
    }
  }

  async function silentReload() {
    try {
      const items = await listProjects();
      setProjects(items);
    } catch {
      // 静默：轮询失败不打扰用户，下次轮询会再试。
    }
  }

  const stats = useMemo(() => {
    const total = projects.length;
    // 导入型项目走完结构补全就算"已完成"；生成型项目走完一致性检查或修正才算。
    const COMPLETED_STATES = new Set(['consistency_checked', 'revised', 'import_structure_generated']);
    const completed = projects.filter((item) => COMPLETED_STATES.has(item.generation_state)).length;
    const inProgress = total - completed;
    const slides = projects.reduce((sum, item) => sum + item.slide_count, 0);
    const imported = projects.filter((item) => item.project_origin === 'imported_prompts').length;
    return { total, completed, inProgress, slides, imported };
  }, [projects]);

  const filteredProjects = useMemo(() => {
    if (originFilter === 'all') return projects;
    return projects.filter((item) => (item.project_origin ?? 'generated_markdown') === originFilter);
  }, [projects, originFilter]);

  useEffect(() => {
    setCurrentPage(1);
  }, [originFilter]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(filteredProjects.length / pageSize));
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [filteredProjects.length, pageSize, currentPage]);

  function startRename(project: ProjectSummary) {
    setEditingProjectId(project.project_id);
    setDraftTitle(project.title);
    setMessage(null);
  }

  function cancelRename() {
    setEditingProjectId(null);
    setDraftTitle('');
  }

  async function handleRename(projectId: string) {
    setActionBusy(`rename:${projectId}`);
    setMessage(null);
    try {
      const result = await renameProject(projectId, draftTitle);
      setProjects((current) =>
        current.map((item) =>
          item.project_id === projectId ? { ...item, title: result.title } : item,
        ),
      );
      setEditingProjectId(null);
      setDraftTitle('');
      setMessage({ kind: 'success', text: '项目名称已更新。' });
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : '重命名失败' });
    } finally {
      setActionBusy(null);
    }
  }

  async function handleSuggestTitle(projectId: string) {
    setActionBusy(`suggest:${projectId}`);
    setMessage(null);
    try {
      const { title } = await suggestProjectTitle(projectId);
      // 只填进输入框，不直接落库——让用户看一眼再决定是否保存。
      setDraftTitle(title);
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'AI 生成标题失败' });
    } finally {
      setActionBusy(null);
    }
  }

  async function handleDelete(project: ProjectSummary) {
    setActionBusy(`delete:${project.project_id}`);
    setMessage(null);
    try {
      await deleteProject(project.project_id);
      setProjects((current) => current.filter((item) => item.project_id !== project.project_id));
      if (editingProjectId === project.project_id) {
        cancelRename();
      }
      setMessage({ kind: 'success', text: '项目已删除。' });
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : '删除失败' });
    } finally {
      setActionBusy(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 1440, margin: '0 auto' }}>
      <div style={{ position: 'sticky', top: -24, zIndex: 10, background: '#f5f7fa', padding: '16px 0', marginTop: -16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16 }}>
        <div>
          <Text type="secondary" style={{ letterSpacing: 1, fontSize: 12, fontWeight: 600, textTransform: 'uppercase' }}>Control Room</Text>
          <Title level={3} style={{ margin: '4px 0 8px' }}>项目管理</Title>
          <Text type="secondary" style={{ fontSize: 15 }}>从历史记录进入任意项目，继续生成、回看大纲、校验一致性，或者直接导出。</Text>
        </div>
        <Space>
          <Button onClick={() => navigate('/projects/new')} type="primary">新建素材项目</Button>
          <Button onClick={() => navigate('/projects/new?mode=import')}>导入提示词</Button>
        </Space>
      </div>

      {!configured && (
        <Alert
          message="当前还没有可用模型配置。你仍然可以查看历史项目，但新生成前需要先完成模型配置。"
          type="info"
          showIcon
        />
      )}

      {message && (
        <Alert message={message.text} type={message.kind === 'error' ? 'error' : 'success'} showIcon />
      )}

      <Row gutter={[16, 16]}>
        <Col xs={12} sm={12} md={6}>
          <Card bordered={false} style={{ borderRadius: 0, boxShadow: '0 1px 2px rgba(15,23,42,0.04)' }}>
            <Statistic title="项目总数" value={stats.total} />
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>历史项目与当前项目统一管理</Text>
          </Card>
        </Col>
        <Col xs={12} sm={12} md={6}>
          <Card bordered={false} style={{ borderRadius: 0, boxShadow: '0 1px 2px rgba(15,23,42,0.04)' }}>
            <Statistic title="进行中" value={stats.inProgress} />
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>仍可继续生成或调整</Text>
          </Card>
        </Col>
        <Col xs={12} sm={12} md={6}>
          <Card bordered={false} style={{ borderRadius: 0, boxShadow: '0 1px 2px rgba(15,23,42,0.04)' }}>
            <Statistic title="已完成审核" value={stats.completed} />
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>可直接进入审核与导出</Text>
          </Card>
        </Col>
        <Col xs={12} sm={12} md={6}>
          <Card bordered={false} style={{ borderRadius: 0, boxShadow: '0 1px 2px rgba(15,23,42,0.04)' }}>
            <Statistic title="累计页数" value={stats.slides} />
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>已生成页面总量</Text>
          </Card>
        </Col>
      </Row>

      <Card bordered={false} style={{ borderRadius: 0, boxShadow: '0 1px 2px rgba(15,23,42,0.04)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, gap: 16, flexWrap: 'wrap' }}>
          <div>
            <Title level={4} style={{ margin: 0 }}>历史项目</Title>
            <Text type="secondary">按最近更新时间排序，直接从这里进入工作台或审核页。</Text>
          </div>
          <Space wrap>
            <Segmented
              value={originFilter}
              onChange={(value) => setOriginFilter(value as OriginFilter)}
              options={[
                { label: `全部 (${stats.total})`, value: 'all' },
                { label: `生成型 (${stats.total - stats.imported})`, value: 'generated_markdown' },
                { label: `导入型 (${stats.imported})`, value: 'imported_prompts' },
              ]}
            />
            <Tag color="blue" style={{ borderRadius: 0, padding: '4px 12px', border: 0, background: '#e6f4ff', color: '#1677ff' }}>
              {filteredProjects.length} 个项目
            </Tag>
          </Space>
        </div>

        <List
          loading={busy}
          dataSource={filteredProjects}
          pagination={
            filteredProjects.length > 0
              ? {
                  current: currentPage,
                  pageSize,
                  total: filteredProjects.length,
                  showSizeChanger: false,
                  showTotal: (total, range) => `第 ${range[0]}-${range[1]} 条 / 共 ${total} 个项目`,
                  onChange: (page, size) => {
                    setCurrentPage(page);
                    setPageSize(size);
                  },
                  align: 'end',
                }
              : false
          }
          locale={{
            emptyText: (
              <Empty description={originFilter === 'all' ? '还没有项目记录' : '此筛选下没有项目'}>
                {originFilter === 'imported_prompts' ? (
                  <Button type="primary" onClick={() => navigate('/projects/new?mode=import')}>去导入提示词</Button>
                ) : (
                  <Button type="primary" onClick={() => navigate('/projects/new')}>去新建项目</Button>
                )}
              </Empty>
            ),
          }}
          renderItem={(project) => (
            <List.Item
              style={{ background: '#fff', border: '1px solid #f0f0f0', borderRadius: 0, marginBottom: 16, padding: '20px 24px', transition: 'all 0.3s' }}
              className="project-list-item"
              actions={[
                <Button type="text" icon={<EditOutlined />} onClick={() => startRename(project)} disabled={actionBusy !== null}>重命名</Button>,
                <Popconfirm
                  title="确认删除该项目？"
                  description="此操作不可恢复。"
                  onConfirm={() => handleDelete(project)}
                  okText="确定"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                >
                  <Button type="text" danger icon={<DeleteOutlined />} disabled={actionBusy !== null}>删除</Button>
                </Popconfirm>,
                <Button onClick={() => navigate(`/workspace/${project.project_id}`)} type='primary'>进入工作台</Button>,
              ]}
            >
              <div style={{ width: '100%', maxWidth: '60%' }}>
                {editingProjectId === project.project_id ? (
                  <Space.Compact style={{ width: '100%' }}>
                    <Input value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} placeholder="输入项目名称" onPressEnter={() => handleRename(project.project_id)} />
                    <Button
                      icon={<ThunderboltOutlined />}
                      onClick={() => handleSuggestTitle(project.project_id)}
                      loading={actionBusy === `suggest:${project.project_id}`}
                      disabled={actionBusy !== null && actionBusy !== `suggest:${project.project_id}`}
                      title="让 AI 根据上传素材生成项目名"
                    >
                      AI 生成
                    </Button>
                    <Button type="primary" onClick={() => handleRename(project.project_id)} loading={actionBusy === `rename:${project.project_id}`}>保存</Button>
                    <Button onClick={cancelRename}>取消</Button>
                  </Space.Compact>
                ) : (
                  <Title level={5} style={{ margin: '0 0 12px 0' }}>{project.title}</Title>
                )}
                <Steps
                  size="small"
                  current={-1}
                  items={projectProgress(project).map((step) => ({
                    title: step.title,
                    status: step.status,
                    description: step.description,
                    icon: step.status === 'process' ? <LoadingOutlined /> : undefined,
                  }))}
                  style={{ marginBottom: 12 }}
                />
                <Space size={[8, 8]} wrap>
                  {project.project_origin === 'imported_prompts' && (
                    <Tag bordered={false} color="purple">导入型</Tag>
                  )}
                  <Tag bordered={false}>{projectStateLabel(project.generation_state)}</Tag>
                  <Text type="secondary" style={{ fontSize: 13 }}>{project.slide_count} 页</Text>
                  <Text type="secondary" style={{ fontSize: 13 }}>更新于 {formatDateTime(project.updated_at)}</Text>
                </Space>
              </div>
            </List.Item>
          )}
        />
      </Card>
    </div>
  );
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
