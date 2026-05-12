import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { exportProject } from '../api/export';
import { getProject } from '../api/projects';
import { ConsistencyReportView } from '../components/ConsistencyReportView';
import { MarkdownPreview } from '../components/MarkdownPreview';
import { StyleGuidePanel } from '../components/StyleGuidePanel';
import { useProjectStore } from '../store/projectStore';
import type { ExportFormat } from '../types/api';

import { Card, Col, Row, Typography, Button, Space, Alert, Spin, Collapse, Tag } from 'antd';
import { DownloadOutlined, LeftOutlined, UnorderedListOutlined, FileZipOutlined, FileMarkdownOutlined, CodeOutlined } from '@ant-design/icons';

const { Title, Text, Paragraph } = Typography;
const { Panel } = Collapse;

export function ReviewExportPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { project, setProject } = useProjectStore();
  const [message, setMessage] = useState<{ kind: 'info' | 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<ExportFormat | null>(null);

  useEffect(() => {
    if (!projectId) return;
    getProject(projectId).then(setProject).catch((error) => setMessage({ kind: 'error', text: error instanceof Error ? error.message : '加载项目失败' }));
  }, [projectId, setProject]);

  async function handleExport(format: ExportFormat) {
    if (!project) return;
    setBusy(format);
    setMessage(null);
    try {
      const result = await exportProject(project.project_id, format, true);
      window.location.href = result.download_url;
      setMessage({ kind: 'success', text: `已生成导出文件：${result.filename}` });
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : '导出失败' });
    } finally {
      setBusy(null);
    }
  }

  if (!project || project.project_id !== projectId) {
    return <main className="admin-page" style={{ padding: 24, textAlign: 'center' }}><Spin size="large" tip="正在加载项目..." /></main>;
  }

  return (
    <Space direction="vertical" size="large" style={{ display: 'flex', maxWidth: 1200, margin: '0 auto', paddingBottom: 40 }}>
      <Card bordered={false} style={{ borderRadius: 16, boxShadow: '0 1px 2px rgba(15,23,42,0.04)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <Text type="secondary" style={{ textTransform: 'uppercase', fontSize: 12, fontWeight: 600, letterSpacing: 1 }}>Export Center</Text>
            <Title level={3} style={{ margin: '4px 0 8px' }}>审核与导出</Title>
            <Text type="secondary">检查总体规划、统一视觉规范和每页 Markdown 生图 prompt。</Text>
          </div>
          <Space wrap>
            <Link to={`/workspace/${project.project_id}`}>
              <Button icon={<LeftOutlined />}>返回工作台</Button>
            </Link>
            <Link to="/projects">
              <Button icon={<UnorderedListOutlined />}>项目管理</Button>
            </Link>
          </Space>
        </div>
      </Card>

      {message && (
        <Alert message={message.text} type={message.kind === 'error' ? 'error' : (message.kind === 'success' ? 'success' : 'info')} showIcon />
      )}

      <Row gutter={[24, 24]}>
        <Col xs={24} md={12}>
          <Card 
            title="总体规划" 
            bordered={false} 
            style={{ borderRadius: 16, boxShadow: '0 1px 2px rgba(15,23,42,0.04)', height: '100%' }}
          >
            {project.deck_brief ? (
              <Paragraph style={{ fontSize: 15 }}>{project.deck_brief.narrative}</Paragraph>
            ) : (
              <Alert type="info" message="暂无 brief" showIcon style={{ marginBottom: 16 }} />
            )}
            
            {project.slide_count_plan && (
              <div style={{ background: '#f8fafc', padding: '16px 20px', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <Text type="secondary" style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>推荐页数</Text>
                  <Title level={3} style={{ margin: 0, color: '#1677ff' }}>{project.slide_count_plan.accepted_slide_count}</Title>
                </div>
                <Text type="secondary" style={{ flex: 1, marginLeft: 24, fontSize: 13 }}>{project.slide_count_plan.coverage_summary}</Text>
              </div>
            )}
          </Card>
        </Col>
        
        <Col xs={24} md={12}>
          <Card 
            title="导出" 
            bordered={false} 
            style={{ borderRadius: 16, boxShadow: '0 1px 2px rgba(15,23,42,0.04)', height: '100%' }}
          >
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <Button 
                block 
                size="large" 
                icon={<CodeOutlined />} 
                onClick={() => handleExport('json')} 
                loading={busy === 'json'}
                disabled={busy !== null}
              >
                导出 JSON
              </Button>
              <Button 
                block 
                size="large" 
                icon={<FileMarkdownOutlined />} 
                onClick={() => handleExport('markdown')} 
                loading={busy === 'markdown'}
                disabled={busy !== null}
              >
                导出单文件 Markdown
              </Button>
              <Button 
                block 
                size="large" 
                type="primary" 
                icon={<FileZipOutlined />} 
                onClick={() => handleExport('prompt_zip')} 
                loading={busy === 'prompt_zip'}
                disabled={busy !== null}
              >
                导出逐页 Prompt ZIP
              </Button>
            </Space>
            <Text type="secondary" style={{ display: 'block', marginTop: 16, fontSize: 13, textAlign: 'center' }}>
              导出内容会过滤 API Key，只包含项目结构和 prompt 结果。
            </Text>
          </Card>
        </Col>
      </Row>

      <Row gutter={[24, 24]}>
        <Col xs={24} md={12}>
          <Card 
            title="统一视觉规范" 
            bordered={false} 
            style={{ borderRadius: 16, boxShadow: '0 1px 2px rgba(15,23,42,0.04)', height: '100%' }}
          >
            <StyleGuidePanel styleGuide={project.style_guide} />
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card 
            title="一致性报告" 
            bordered={false} 
            style={{ borderRadius: 16, boxShadow: '0 1px 2px rgba(15,23,42,0.04)', height: '100%' }}
          >
            <ConsistencyReportView report={project.consistency_report} />
          </Card>
        </Col>
      </Row>

      <Card 
        title={<><span style={{ marginRight: 8 }}>逐页 Prompt</span><Tag color="blue">共 {project.slides.length} 页</Tag></>} 
        bordered={false} 
        style={{ borderRadius: 16, boxShadow: '0 1px 2px rgba(15,23,42,0.04)' }}
        bodyStyle={{ padding: 0 }}
      >
        <Collapse ghost expandIconPosition="end">
          {project.slides.map((slide) => (
            <Panel 
              header={<Text strong>第 {slide.slide_no} 页：{slide.title}</Text>} 
              key={slide.slide_no.toString()}
              style={{ borderBottom: '1px solid #f0f0f0' }}
            >
              <div style={{ background: '#f8fafc', padding: 24, borderRadius: 8 }}>
                <MarkdownPreview content={slide.prompt} />
              </div>
            </Panel>
          ))}
        </Collapse>
      </Card>
    </Space>
  );
}
