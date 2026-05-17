import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { exportProject } from '../api/export';
import { getProject } from '../api/projects';
import { StyleGuidePanel } from '../components/StyleGuidePanel';
import { MarkdownPreview } from '../components/MarkdownPreview';
import { useProjectStore } from '../store/projectStore';
import type { ExportFormat, ConsistencySlideReport } from '../types/api';

import { Card, Col, Row, Typography, Button, Space, Alert, Spin, Tag, Tooltip, Modal } from 'antd';
import { DownloadOutlined, LeftOutlined, UnorderedListOutlined, FileZipOutlined, FileMarkdownOutlined, CodeOutlined, DownOutlined, UpOutlined, CheckCircleFilled, WarningFilled } from '@ant-design/icons';

const { Title, Text, Paragraph } = Typography;

const expandSymbol = (expanded: boolean) => (
  <span style={{ marginLeft: 4, color: '#1677ff' }}>
    {expanded ? <UpOutlined style={{ fontSize: 12 }} /> : <DownOutlined style={{ fontSize: 12 }} />}
  </span>
);

function extractPromptTitle(prompt: string): string {
  const lines = prompt.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const heading = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (heading) return heading[1].trim();
    return line.replace(/^[*_`>\-]+\s*/, '').trim();
  }
  return '';
}

export function ReviewExportPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { project, setProject } = useProjectStore();
  const [message, setMessage] = useState<{ kind: 'info' | 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [previewSlideNo, setPreviewSlideNo] = useState<number | null>(null);

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

  const consistencyByNo = new Map<number, ConsistencySlideReport>(
    (project.consistency_report?.slides ?? []).map((s) => [s.slide_no, s])
  );
  const overallScore = project.consistency_report?.overall_score;
  const threshold = project.consistency_report?.threshold;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 1440, margin: '0 auto', paddingBottom: 40 }}>
      <Card bordered={false} style={{ borderRadius: 0, boxShadow: '0 1px 2px rgba(15,23,42,0.04)', position: 'sticky', top: -24, zIndex: 10 }}>
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
        <Col xs={24} md={17}>
          <Card
            title="总体规划"
            bordered={false}
            style={{ borderRadius: 0, boxShadow: '0 1px 2px rgba(15,23,42,0.04)', height: '100%' }}
          >
            {project.deck_brief ? (
              <Paragraph style={{ fontSize: 15 }}>{project.deck_brief.narrative}</Paragraph>
            ) : (
              <Alert type="info" message="暂无 brief" showIcon style={{ marginBottom: 16 }} />
            )}

            {project.slide_count_plan && (
              <div style={{ background: '#f8fafc', padding: '16px 20px', borderRadius: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <Text type="secondary" style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>推荐页数</Text>
                  <Title level={3} style={{ margin: 0, color: '#1677ff' }}>{project.slide_count_plan.accepted_slide_count}</Title>
                </div>
                <Text type="secondary" style={{ flex: 1, marginLeft: 24, fontSize: 13 }}>{project.slide_count_plan.coverage_summary}</Text>
              </div>
            )}
          </Card>
        </Col>

        <Col xs={24} md={7}>
          <Card 
            title="导出" 
            bordered={false} 
            style={{ borderRadius: 0, boxShadow: '0 1px 2px rgba(15,23,42,0.04)', height: '100%' }}
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
                type="primary" 
                icon={<FileZipOutlined />} 
                onClick={() => handleExport('prompt_zip')} 
                loading={busy === 'prompt_zip'}
                disabled={busy !== null}
              >
                批量导出提示词
              </Button>
            </Space>
            <Text type="secondary" style={{ display: 'block', marginTop: 16, fontSize: 13, textAlign: 'center' }}>
              导出内容会过滤 API Key，只包含项目结构和 prompt 结果。
            </Text>
          </Card>
        </Col>
      </Row>
      <Card
        title={
          <Space size="small" wrap>
            <span>逐页 Prompt</span>
            <Tag color="blue">共 {project.slides.length} 页</Tag>
            {typeof overallScore === 'number' && (
              <Tag color={threshold !== undefined && overallScore >= threshold ? 'green' : 'orange'}>
                一致性 {overallScore.toFixed(2)}{threshold !== undefined ? ` / 阈值 ${threshold.toFixed(2)}` : ''}
              </Tag>
            )}
          </Space>
        }
        bordered={false}
        style={{ borderRadius: 0, boxShadow: '0 1px 2px rgba(15,23,42,0.04)' }}
        bodyStyle={{ maxHeight: 640, overflowY: 'auto' }}
      >
        <Row gutter={[16, 16]}>
          {project.slides.map((slide) => {
            const consistency = consistencyByNo.get(slide.slide_no);
            const needsRevision = consistency?.revision_needed ?? false;
            return (
              <Col key={slide.slide_no} xs={24} sm={12} lg={8} xxl={6}>
                <Card
                  size="small"
                  bordered
                  style={{
                    borderRadius: 0,
                    height: '100%',
                    borderColor: needsRevision ? '#ffccc7' : undefined,
                    background: needsRevision ? '#fff7f6' : undefined,
                  }}
                  headStyle={{ whiteSpace: 'normal' }}
                  title={
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '4px 0' }}>
                      <Text strong style={{ fontSize: 13, flex: 1, minWidth: 0, whiteSpace: 'normal', lineHeight: 1.5 }}>
                        第 {slide.slide_no} 页：{slide.title}
                      </Text>
                      {consistency && (
                        <Tooltip title={needsRevision ? '建议修订' : '风格一致'}>
                          <Tag
                            color={needsRevision ? 'error' : 'success'}
                            icon={needsRevision ? <WarningFilled /> : <CheckCircleFilled />}
                            style={{ margin: 0, flexShrink: 0 }}
                          >
                            {consistency.score.toFixed(2)}
                          </Tag>
                        </Tooltip>
                      )}
                    </div>
                  }
                >
                  <Paragraph
                    style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 500, color: 'rgba(0,0,0,0.85)' }}
                    ellipsis={{ rows: 3, tooltip: extractPromptTitle(slide.prompt) || slide.title }}
                  >
                    {extractPromptTitle(slide.prompt) || slide.title}
                  </Paragraph>
                  <Button
                    type="link"
                    size="small"
                    onClick={() => setPreviewSlideNo(slide.slide_no)}
                    style={{ paddingLeft: 0 }}
                    icon={<DownOutlined style={{ fontSize: 12 }} />}
                  >
                    展开全文
                  </Button>

                  {consistency && consistency.issues.length > 0 && (
                    <div style={{ marginTop: 12, padding: '8px 12px', background: '#fff2f0', border: '1px solid #ffd6d2', borderRadius: 0 }}>
                      <Text strong style={{ fontSize: 12, color: '#cf1322', display: 'block', marginBottom: 4 }}>
                        一致性问题
                      </Text>
                      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#7a1f1f' }}>
                        {consistency.issues.map((issue) => (
                          <li key={issue}>{issue}</li>
                        ))}
                      </ul>
                      {consistency.suggested_fix && (
                        <Paragraph
                          style={{ margin: '6px 0 0', fontSize: 12, color: '#7a1f1f' }}
                          ellipsis={{ rows: 2, expandable: 'collapsible', symbol: expandSymbol }}
                        >
                          建议：{consistency.suggested_fix}
                        </Paragraph>
                      )}
                    </div>
                  )}
                </Card>
              </Col>
            );
          })}
        </Row>
      </Card>
      <Row gutter={[24, 24]}>
        <Col xs={24}>
          <Card
            title="统一视觉规范"
            bordered={false}
            style={{ borderRadius: 0, boxShadow: '0 1px 2px rgba(15,23,42,0.04)' }}
          >
            <StyleGuidePanel styleGuide={project.style_guide} />
          </Card>
        </Col>
      </Row>

      <Modal
        open={previewSlideNo !== null}
        onCancel={() => setPreviewSlideNo(null)}
        footer={null}
        width="80vw"
        centered
        style={{ maxWidth: 1200 }}
        title={
          previewSlideNo !== null && (() => {
            const slide = project.slides.find((s) => s.slide_no === previewSlideNo);
            return slide ? `第 ${slide.slide_no} 页：${slide.title}` : null;
          })()
        }
      >
        {previewSlideNo !== null && (() => {
          const slide = project.slides.find((s) => s.slide_no === previewSlideNo);
          if (!slide) return null;
          return (
            <div style={{ maxHeight: '60vh', overflowY: 'auto', background: '#f8fafc', padding: 16, borderRadius: 0 }}>
              <MarkdownPreview content={slide.prompt} />
            </div>
          );
        })()}
      </Modal>

    </div>
  );
}
