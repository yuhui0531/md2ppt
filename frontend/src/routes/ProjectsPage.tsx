import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getModelConfig } from '../api/modelConfig';
import { deleteProject, listProjects, renameProject } from '../api/projects';
import { StatusMessage } from '../components/StatusMessage';
import type { ProjectSummary } from '../types/api';
import { projectStateLabel } from '../utils/projectPresentation';

import { Card, Col, Row, Typography, Button, Space, Statistic, List, Tag, Popconfirm, Input, Alert, Empty } from 'antd';
import { EditOutlined, DeleteOutlined, RightOutlined, ExportOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;

export function ProjectsPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [busy, setBusy] = useState(true);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'info' | 'success' | 'error'; text: string } | null>(null);
  const [configured, setConfigured] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');

  useEffect(() => {
    loadPage();
  }, []);

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

  const stats = useMemo(() => {
    const total = projects.length;
    const completed = projects.filter((item) => ['consistency_checked', 'revised'].includes(item.generation_state)).length;
    const inProgress = total - completed;
    const slides = projects.reduce((sum, item) => sum + item.slide_count, 0);
    return { total, completed, inProgress, slides };
  }, [projects]);

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
    <Space direction="vertical" size="large" style={{ display: 'flex', maxWidth: 1440, margin: '0 auto' }}>
      <div style={{ marginBottom: 16 }}>
        <Text type="secondary" style={{ letterSpacing: 1, fontSize: 12, fontWeight: 600, textTransform: 'uppercase' }}>Control Room</Text>
        <Title level={2} style={{ margin: '4px 0 8px' }}>项目管理</Title>
        <Text type="secondary" style={{ fontSize: 15 }}>从历史记录进入任意项目，继续生成、回看大纲、校验一致性，或者直接导出。</Text>
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
          <Card bordered={false} style={{ borderRadius: 16, boxShadow: '0 1px 2px rgba(15,23,42,0.04)' }}>
            <Statistic title="项目总数" value={stats.total} />
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>历史项目与当前项目统一管理</Text>
          </Card>
        </Col>
        <Col xs={12} sm={12} md={6}>
          <Card bordered={false} style={{ borderRadius: 16, boxShadow: '0 1px 2px rgba(15,23,42,0.04)' }}>
            <Statistic title="进行中" value={stats.inProgress} />
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>仍可继续生成或调整</Text>
          </Card>
        </Col>
        <Col xs={12} sm={12} md={6}>
          <Card bordered={false} style={{ borderRadius: 16, boxShadow: '0 1px 2px rgba(15,23,42,0.04)' }}>
            <Statistic title="已完成审核" value={stats.completed} />
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>可直接进入审核与导出</Text>
          </Card>
        </Col>
        <Col xs={12} sm={12} md={6}>
          <Card bordered={false} style={{ borderRadius: 16, boxShadow: '0 1px 2px rgba(15,23,42,0.04)' }}>
            <Statistic title="累计页数" value={stats.slides} />
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>已生成页面总量</Text>
          </Card>
        </Col>
      </Row>

      <Card bordered={false} style={{ borderRadius: 16, boxShadow: '0 1px 2px rgba(15,23,42,0.04)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <Title level={4} style={{ margin: 0 }}>历史项目</Title>
            <Text type="secondary">按最近更新时间排序，直接从这里进入工作台或审核页。</Text>
          </div>
          <Tag color="blue" style={{ borderRadius: 12, padding: '4px 12px', border: 0, background: '#e6f4ff', color: '#1677ff' }}>
            {projects.length} 个项目
          </Tag>
        </div>

        <List
          loading={busy}
          dataSource={projects}
          locale={{ emptyText: <Empty description="还没有项目记录" ><Button type="primary" onClick={() => navigate('/projects/new')}>去新建项目</Button></Empty> }}
          renderItem={(project) => (
            <List.Item
              style={{ background: '#fff', border: '1px solid #f0f0f0', borderRadius: 12, marginBottom: 16, padding: '20px 24px', transition: 'all 0.3s' }}
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
                <Button onClick={() => navigate(`/workspace/${project.project_id}`)}>工作台 <RightOutlined /></Button>,
                <Button type="primary" ghost onClick={() => navigate(`/review/${project.project_id}`)}>审核导出 <ExportOutlined /></Button>
              ]}
            >
              <div style={{ width: '100%', maxWidth: '50%' }}>
                {editingProjectId === project.project_id ? (
                  <Space.Compact style={{ width: '100%' }}>
                    <Input value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} placeholder="输入项目名称" onPressEnter={() => handleRename(project.project_id)} />
                    <Button type="primary" onClick={() => handleRename(project.project_id)} loading={actionBusy === `rename:${project.project_id}`}>保存</Button>
                    <Button onClick={cancelRename}>取消</Button>
                  </Space.Compact>
                ) : (
                  <Title level={5} style={{ margin: '0 0 8px 0' }}>{project.title}</Title>
                )}
                <Space size={[8, 8]} wrap>
                  <Tag bordered={false}>{projectStateLabel(project.generation_state)}</Tag>
                  <Text type="secondary" style={{ fontSize: 13 }}>{project.slide_count} 页</Text>
                  <Text type="secondary" style={{ fontSize: 13 }}>更新于 {formatDateTime(project.updated_at)}</Text>
                </Space>
              </div>
            </List.Item>
          )}
        />
      </Card>
    </Space>
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
