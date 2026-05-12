import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createProject } from '../api/projects';
import { generateProject } from '../api/generation';
import { JobProgress } from '../components/JobProgress';
import { MarkdownPreview } from '../components/MarkdownPreview';
import type { GenerationOptions, JobResponse, SlideCountMode } from '../types/api';
import { pollJobUntilFinished } from '../utils/jobPolling';

import { Card, Col, Row, Typography, Input, Select, Button, Tabs, Form, Upload, message, Space, Alert } from 'antd';
import { InboxOutlined } from '@ant-design/icons';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;
const { Dragger } = Upload;

export function UploadPage() {
  const navigate = useNavigate();
  const [filename, setFilename] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [language, setLanguage] = useState('zh-CN');
  const [audience, setAudience] = useState('领导汇报');
  const [reportScenario, setReportScenario] = useState('内部研讨');
  const [slideCountMode, setSlideCountMode] = useState<SlideCountMode>('auto');
  const [requestedSlideCount, setRequestedSlideCount] = useState(8);
  const [rangeMin, setRangeMin] = useState(8);
  const [rangeMax, setRangeMax] = useState(12);
  const [targetImageTool, setTargetImageTool] = useState('generic');
  const [activeTab, setActiveTab] = useState('source');
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<JobResponse | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ kind: 'info' | 'success' | 'error'; text: string } | null>(null);
  const [resumableProjectId, setResumableProjectId] = useState<string | null>(null);

  const canSubmit = useMemo(() => content.trim().length > 0 && !busy, [content, busy]);

  function generationOptions(): GenerationOptions {
    return {
      audience,
      report_scenario: reportScenario,
      slide_count_mode: slideCountMode,
      requested_slide_count: slideCountMode === 'fixed' ? requestedSlideCount : null,
      requested_slide_range: slideCountMode === 'range' ? { min: rangeMin, max: rangeMax } : null,
      content_template_id: 'product-issue-report',
      visual_template_id: 'gov-blue-tech-report',
      target_image_tool: targetImageTool,
      prompt_output_format: 'markdown',
      consistency_threshold: 0.85,
    };
  }

  async function handleSubmit() {
    setBusy(true);
    setStatusMsg(null);
    setJob(null);
    setResumableProjectId(null);
    try {
      const created = await createProject({
        source: {
          filename,
          content,
          content_format: 'markdown',
          language,
        },
        generation_options: generationOptions(),
      });
      setResumableProjectId(created.project_id);
      const createdJob = await generateProject(created.project_id, 'auto');
      setJob(createdJob);
      await pollJobUntilFinished(createdJob.job_id, (latest) => setJob(latest));
      navigate(`/workspace/${created.project_id}`);
    } catch (error) {
      setStatusMsg({ kind: 'error', text: error instanceof Error ? error.message : '创建项目或生成失败' });
    } finally {
      setBusy(false);
    }
  }

  const handleUpload = (file: File) => {
    setFilename(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      setContent(e.target?.result as string);
      message.success(`${file.name} 解析成功`);
    };
    reader.readAsText(file);
    return false; // Prevent auto upload
  };

  return (
    <Space direction="vertical" size="large" style={{ display: 'flex', maxWidth: 1440, margin: '0 auto' }}>
      <div style={{ marginBottom: 16 }}>
        <Text type="secondary" style={{ letterSpacing: 1, fontSize: 12, fontWeight: 600, textTransform: 'uppercase' }}>New Project</Text>
        <Title level={2} style={{ margin: '4px 0 8px' }}>新建项目</Title>
        <Text type="secondary" style={{ fontSize: 15 }}>上传 Markdown 原始素材，生成结构化 PPT Prompt 项目，并直接衔接到工作台继续处理。</Text>
      </div>

      <Card bordered={false} style={{ borderRadius: 16, boxShadow: '0 1px 2px rgba(15,23,42,0.04)' }}>
        <div style={{ marginBottom: 16 }}>
          <Title level={4} style={{ margin: 0 }}>上传 Markdown 原始素材</Title>
          <Text type="secondary">Markdown 会作为待分析素材处理，不会被机械按标题拆成 PPT 页面。</Text>
        </div>
        
        {statusMsg && <div style={{ marginBottom: 16 }}><Alert type={statusMsg.kind === 'error' ? 'error' : (statusMsg.kind === 'success' ? 'success' : 'info')} message={statusMsg.text} showIcon /></div>}
        <div style={{ marginBottom: job ? 16 : 0 }}>
          <JobProgress job={job} />
        </div>

        <Row gutter={24}>
          <Col xs={24} md={16}>
            <Form.Item label="Markdown 文件" layout="vertical" style={{ marginBottom: 0 }}>
              <Dragger 
                accept=".md,.markdown,text/markdown,text/plain" 
                beforeUpload={handleUpload} 
                showUploadList={false}
                style={{ background: '#fafafa' }}
              >
                <p className="ant-upload-drag-icon">
                  <InboxOutlined style={{ color: '#1677ff' }} />
                </p>
                <p className="ant-upload-text">{filename ? `已选择：${filename}` : '点击或拖拽文件到此区域'}</p>
              </Dragger>
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item label="目标语言" layout="vertical" style={{ marginBottom: 0 }}>
              <Select value={language} onChange={setLanguage} style={{ width: '100%' }}>
                <Select.Option value="zh-CN">中文</Select.Option>
                <Select.Option value="en-US">English</Select.Option>
              </Select>
            </Form.Item>
          </Col>
        </Row>
      </Card>

      <Row gutter={24} align="stretch">
        <Col xs={24} lg={14} style={{ display: 'flex' }}>
          <Card 
            bordered={false} 
            style={{ borderRadius: 16, width: '100%', display: 'flex', flexDirection: 'column', boxShadow: '0 1px 2px rgba(15,23,42,0.04)' }}
            bodyStyle={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '24px' }}
          >
            <Tabs 
              activeKey={activeTab} 
              onChange={setActiveTab} 
              items={[
                { key: 'source', label: '源码' },
                { key: 'preview', label: '预览' }
              ]} 
              style={{ marginBottom: 16 }}
            />
            {activeTab === 'source' ? (
              <TextArea 
                value={content} 
                onChange={(e) => setContent(e.target.value)} 
                placeholder="# 粘贴 Markdown 原始素材..." 
                style={{ flex: 1, minHeight: 400, fontFamily: 'monospace' }} 
              />
            ) : (
              <div style={{ flex: 1, minHeight: 400, border: '1px solid #d9d9d9', borderRadius: 8, padding: 16, overflow: 'auto', background: '#fafafa' }}>
                <MarkdownPreview content={content} />
              </div>
            )}
          </Card>
        </Col>

        <Col xs={24} lg={10} style={{ display: 'flex' }}>
          <Card 
            bordered={false} 
            style={{ borderRadius: 16, width: '100%', display: 'flex', flexDirection: 'column', boxShadow: '0 1px 2px rgba(15,23,42,0.04)' }}
            bodyStyle={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '24px' }}
          >
            <Form layout="vertical" style={{ flex: 1 }}>
              <Form.Item label="受众类型">
                <Input value={audience} onChange={(e) => setAudience(e.target.value)} />
              </Form.Item>
              <Form.Item label="演示场景">
                <Input value={reportScenario} onChange={(e) => setReportScenario(e.target.value)} />
              </Form.Item>
              <Form.Item label="目标生图工具">
                <Select value={targetImageTool} onChange={setTargetImageTool}>
                  <Select.Option value="generic">通用提示词</Select.Option>
                  <Select.Option value="midjourney">Midjourney</Select.Option>
                  <Select.Option value="sdxl-flux">SDXL / Flux</Select.Option>
                  <Select.Option value="gpt-image">DALL·E / GPT Image</Select.Option>
                  <Select.Option value="chinese-tools">即梦 / 通义万相 / 可灵</Select.Option>
                </Select>
              </Form.Item>
              <Form.Item label="页数模式">
                <Select value={slideCountMode} onChange={(val) => setSlideCountMode(val as SlideCountMode)}>
                  <Select.Option value="auto">自动推荐</Select.Option>
                  <Select.Option value="fixed">固定页数</Select.Option>
                  <Select.Option value="range">页数范围</Select.Option>
                </Select>
              </Form.Item>
              
              {slideCountMode === 'fixed' && (
                <Form.Item label="固定页数">
                  <Input type="number" min={1} value={requestedSlideCount} onChange={(e) => setRequestedSlideCount(Number(e.target.value))} />
                </Form.Item>
              )}
              
              {slideCountMode === 'range' && (
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Item label="最少页数">
                      <Input type="number" min={1} value={rangeMin} onChange={(e) => setRangeMin(Number(e.target.value))} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item label="最多页数">
                      <Input type="number" min={1} value={rangeMax} onChange={(e) => setRangeMax(Number(e.target.value))} />
                    </Form.Item>
                  </Col>
                </Row>
              )}
            </Form>
            
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 16 }}>
              {resumableProjectId && (
                <Button onClick={() => navigate(`/workspace/${resumableProjectId}`)}>
                  前往工作台继续生成
                </Button>
              )}
              <Button type="primary" onClick={handleSubmit} disabled={!canSubmit} loading={busy}>
                {busy ? '生成中...' : '开始生成'}
              </Button>
            </div>
          </Card>
        </Col>
      </Row>
    </Space>
  );
}
