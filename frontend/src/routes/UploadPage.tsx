import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { createProject } from '../api/projects';
import { generateProject } from '../api/generation';
import { importPrompts } from '../api/imports';
import { JobProgress } from '../components/JobProgress';
import { MarkdownPreview } from '../components/MarkdownPreview';
import type { GenerationOptions, JobResponse, SlideCountMode } from '../types/api';
import { pollJobUntilFinished } from '../utils/jobPolling';

import { Card, Col, Row, Typography, Input, Select, Button, Tabs, Form, Upload, message, Space, Alert, List, Tag } from 'antd';
import { InboxOutlined, FileMarkdownOutlined, FileZipOutlined, DeleteOutlined } from '@ant-design/icons';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;
const { Dragger } = Upload;

type EntryMode = 'markdown' | 'import';

export function UploadPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialMode: EntryMode = searchParams.get('mode') === 'import' ? 'import' : 'markdown';
  const [entryMode, setEntryMode] = useState<EntryMode>(initialMode);
  // URL 来源是真值：用户切 tab 时反向写回 URL，便于复制链接锚定。
  // 依赖只保留 entryMode，避免把 searchParams 自己也列为依赖造成 setState→re-render→effect 循环。
  useEffect(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (entryMode === 'import') next.set('mode', 'import');
      else next.delete('mode');
      return next;
    }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryMode]);

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
    return false;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 1440, margin: '0 auto' }}>
      <div style={{ position: 'sticky', top: -24, zIndex: 10, background: '#f5f7fa', padding: '16px 0', marginTop: -16 }}>
        <Text type="secondary" style={{ letterSpacing: 1, fontSize: 12, fontWeight: 600, textTransform: 'uppercase' }}>New Project</Text>
        <Title level={3} style={{ margin: '4px 0 8px' }}>新建项目</Title>
        <Text type="secondary" style={{ fontSize: 15 }}>选择「上传原始 Markdown」让大模型从头生成，或选择「导入已有提示词」跳过生成直接进入工作台精调。</Text>
        <Tabs
          activeKey={entryMode}
          onChange={(key) => setEntryMode(key as EntryMode)}
          items={[
            { key: 'markdown', label: '上传原始 Markdown' },
            { key: 'import', label: '导入已有提示词' },
          ]}
          style={{ marginTop: 16, marginBottom: -16 }}
        />
      </div>

      {entryMode === 'import' ? (
        <ImportPromptsPanel />
      ) : (
        <MarkdownEntryPanel
          filename={filename}
          setFilename={setFilename}
          content={content}
          setContent={setContent}
          language={language}
          setLanguage={setLanguage}
          audience={audience}
          setAudience={setAudience}
          reportScenario={reportScenario}
          setReportScenario={setReportScenario}
          slideCountMode={slideCountMode}
          setSlideCountMode={setSlideCountMode}
          requestedSlideCount={requestedSlideCount}
          setRequestedSlideCount={setRequestedSlideCount}
          rangeMin={rangeMin}
          setRangeMin={setRangeMin}
          rangeMax={rangeMax}
          setRangeMax={setRangeMax}
          targetImageTool={targetImageTool}
          setTargetImageTool={setTargetImageTool}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          busy={busy}
          job={job}
          statusMsg={statusMsg}
          resumableProjectId={resumableProjectId}
          canSubmit={canSubmit}
          handleSubmit={handleSubmit}
          handleUpload={handleUpload}
          navigate={navigate}
        />
      )}
    </div>
  );
}

interface MarkdownEntryPanelProps {
  filename: string | null;
  setFilename: (v: string | null) => void;
  content: string;
  setContent: (v: string) => void;
  language: string;
  setLanguage: (v: string) => void;
  audience: string;
  setAudience: (v: string) => void;
  reportScenario: string;
  setReportScenario: (v: string) => void;
  slideCountMode: SlideCountMode;
  setSlideCountMode: (v: SlideCountMode) => void;
  requestedSlideCount: number;
  setRequestedSlideCount: (v: number) => void;
  rangeMin: number;
  setRangeMin: (v: number) => void;
  rangeMax: number;
  setRangeMax: (v: number) => void;
  targetImageTool: string;
  setTargetImageTool: (v: string) => void;
  activeTab: string;
  setActiveTab: (v: string) => void;
  busy: boolean;
  job: JobResponse | null;
  statusMsg: { kind: 'info' | 'success' | 'error'; text: string } | null;
  resumableProjectId: string | null;
  canSubmit: boolean;
  handleSubmit: () => void | Promise<void>;
  handleUpload: (file: File) => boolean;
  navigate: ReturnType<typeof useNavigate>;
}

function MarkdownEntryPanel(props: MarkdownEntryPanelProps) {
  const {
    filename, content, setContent, language, setLanguage,
    audience, setAudience, reportScenario, setReportScenario,
    slideCountMode, setSlideCountMode, requestedSlideCount, setRequestedSlideCount,
    rangeMin, setRangeMin, rangeMax, setRangeMax,
    targetImageTool, setTargetImageTool, activeTab, setActiveTab,
    busy, job, statusMsg, resumableProjectId, canSubmit,
    handleSubmit, handleUpload, navigate,
  } = props;
  return (
    <>
      {statusMsg && (
        <Alert
          type={statusMsg.kind === 'error' ? 'error' : (statusMsg.kind === 'success' ? 'success' : 'info')}
          message={statusMsg.text}
          showIcon
        />
      )}
      {job && <JobProgress job={job} />}

      <Row gutter={24}>
        <Col xs={24} lg={14}>
          <Space direction="vertical" size="large" style={{ display: 'flex' }}>
            <Card
              bordered={false}
              style={{ borderRadius: 16, boxShadow: '0 1px 2px rgba(15,23,42,0.04)' }}
              bodyStyle={{ padding: 24 }}
            >
              <div style={{ marginBottom: 16 }}>
                <Title level={4} style={{ margin: 0 }}>上传 Markdown 原始素材</Title>
                <Text type="secondary">Markdown 会作为待分析素材处理，不会被机械按标题拆成 PPT 页面。</Text>
              </div>
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
            </Card>

            <Card
              bordered={false}
              style={{ borderRadius: 16, boxShadow: '0 1px 2px rgba(15,23,42,0.04)' }}
              bodyStyle={{ padding: 24, display: 'flex', flexDirection: 'column' }}
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
                  style={{ minHeight: 400, fontFamily: 'monospace' }}
                  autoSize={{ minRows: 16 }}
                />
              ) : (
                <div style={{ minHeight: 400, border: '1px solid #d9d9d9', borderRadius: 8, padding: 16, overflow: 'auto', background: '#fafafa' }}>
                  <MarkdownPreview content={content} />
                </div>
              )}
            </Card>
          </Space>
        </Col>

        <Col xs={24} lg={10}>
          <Card
            bordered={false}
            style={{ borderRadius: 16, boxShadow: '0 1px 2px rgba(15,23,42,0.04)', position: 'sticky', top: 24 }}
            bodyStyle={{ padding: 24 }}
          >
            <div style={{ marginBottom: 16 }}>
              <Title level={4} style={{ margin: 0 }}>生成配置</Title>
              <Text type="secondary">设定语言、受众与页数策略，决定 Prompt 生成的整体方向。</Text>
            </div>

            <Form layout="vertical">
              <Form.Item label="目标语言">
                <Select value={language} onChange={setLanguage}>
                  <Select.Option value="zh-CN">中文</Select.Option>
                  <Select.Option value="en-US">English</Select.Option>
                </Select>
              </Form.Item>
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
              <Form.Item label="页数模式" style={{ marginBottom: slideCountMode === 'auto' ? 0 : undefined }}>
                <Select value={slideCountMode} onChange={(val) => setSlideCountMode(val as SlideCountMode)}>
                  <Select.Option value="auto">自动推荐</Select.Option>
                  <Select.Option value="fixed">固定页数</Select.Option>
                  <Select.Option value="range">页数范围</Select.Option>
                </Select>
              </Form.Item>

              {slideCountMode === 'fixed' && (
                <Form.Item label="固定页数" style={{ marginBottom: 0 }}>
                  <Input type="number" min={1} value={requestedSlideCount} onChange={(e) => setRequestedSlideCount(Number(e.target.value))} />
                </Form.Item>
              )}

              {slideCountMode === 'range' && (
                <Row gutter={16} style={{ marginBottom: 0 }}>
                  <Col span={12}>
                    <Form.Item label="最少页数" style={{ marginBottom: 0 }}>
                      <Input type="number" min={1} value={rangeMin} onChange={(e) => setRangeMin(Number(e.target.value))} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item label="最多页数" style={{ marginBottom: 0 }}>
                      <Input type="number" min={1} value={rangeMax} onChange={(e) => setRangeMax(Number(e.target.value))} />
                    </Form.Item>
                  </Col>
                </Row>
              )}
            </Form>

            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 24, paddingTop: 16, borderTop: '1px solid #f0f0f0' }}>
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
    </>
  );
}

function ImportPromptsPanel() {
  const navigate = useNavigate();
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ kind: 'info' | 'success' | 'error'; text: string } | null>(null);

  // 把 ZIP/.md 互斥 + 单 ZIP 校验汇成一个对象，避免散落 bool 让 disabled / 提示文案条件不同步。
  const validation = useMemo<{ mode: 'zip' | 'md' | 'empty'; error: string | null }>(() => {
    if (!files.length) return { mode: 'empty', error: null };
    const zipCount = files.filter((f) => /\.zip$/i.test(f.name)).length;
    const mdCount = files.filter((f) => /\.md$/i.test(f.name)).length;
    if (zipCount && mdCount) return { mode: 'zip', error: 'ZIP 与 .md 不能混传，请二选一' };
    if (zipCount > 1) return { mode: 'zip', error: '一次只能上传一个 ZIP 文件' };
    return { mode: zipCount ? 'zip' : 'md', error: null };
  }, [files]);

  function addFiles(incoming: File[]) {
    setStatusMsg(null);
    // setter 之外完成 warning 与初步过滤：React 18 StrictMode 会双调用 updater，
    // 把 message.warning 放进去会让每个不支持文件弹两条 toast。
    const filtered: File[] = [];
    for (const f of incoming) {
      const lower = f.name.toLowerCase();
      if (!lower.endsWith('.md') && !lower.endsWith('.zip')) {
        message.warning(`忽略不支持的文件：${f.name}`);
        continue;
      }
      filtered.push(f);
    }
    if (!filtered.length) return;
    // 函数式 setter：连续两次 dragger 投放可能在同一 render 周期到达，
    // 闭包里的 files 还是上次 render 的快照，去重会漏掉前一批刚加入的同名文件。
    setFiles((prev) => {
      const accepted: File[] = [];
      for (const f of filtered) {
        if (prev.some((existing) => existing.name === f.name && existing.size === f.size)) continue;
        if (accepted.some((existing) => existing.name === f.name && existing.size === f.size)) continue;
        accepted.push(f);
      }
      return accepted.length ? [...prev, ...accepted] : prev;
    });
  }

  function removeFile(target: File) {
    setFiles((prev) => prev.filter((f) => f !== target));
  }

  async function handleSubmit() {
    if (!files.length) {
      setStatusMsg({ kind: 'error', text: '请先选择 ZIP 或至少一个 .md 文件' });
      return;
    }
    if (validation.error) {
      setStatusMsg({ kind: 'error', text: validation.error });
      return;
    }
    setBusy(true);
    setStatusMsg(null);
    try {
      const result = await importPrompts(files);
      // 不在这里轮询：WorkspacePage mount 时会自己探测 active-job 接管。
      navigate(`/workspace/${result.project_id}`);
    } catch (error) {
      setStatusMsg({ kind: 'error', text: error instanceof Error ? error.message : '导入失败' });
      setBusy(false);
    }
  }

  return (
    <Row gutter={24}>
      <Col xs={24} lg={14}>
        <Card
          bordered={false}
          style={{ borderRadius: 16, boxShadow: '0 1px 2px rgba(15,23,42,0.04)' }}
          bodyStyle={{ padding: 24 }}
        >
          <div style={{ marginBottom: 16 }}>
            <Title level={4} style={{ margin: 0 }}>导入逐页提示词</Title>
            <Text type="secondary">
              支持上传一个 ZIP 或同时选择多个 .md 文件。系统会忽略 index.md、隐藏文件、目录与非 .md 文件，
              ZIP 与多个 .md 不能混传。
            </Text>
          </div>
          <Dragger
            multiple
            accept=".md,.zip"
            beforeUpload={(file, fileList) => {
              // antd 对每个文件单独调一次 beforeUpload；我们一次性接管：
              // 第一次拿到完整 fileList 时入队，之后 batch 内的同事直接 return false 跳过。
              if (fileList && fileList.length && fileList[0] === file) {
                addFiles(fileList as File[]);
              }
              return false;
            }}
            showUploadList={false}
            style={{ background: '#fafafa' }}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined style={{ color: '#1677ff' }} />
            </p>
            <p className="ant-upload-text">点击或拖拽文件到此区域</p>
            <p className="ant-upload-hint">可选：一个 .zip 或多个 .md（互斥）</p>
          </Dragger>

          {files.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <Space style={{ marginBottom: 8 }} wrap>
                <Tag color="blue">已选择 {files.length} 个文件</Tag>
                {!validation.error && validation.mode === 'zip' && <Tag color="purple">ZIP 模式</Tag>}
                {!validation.error && validation.mode === 'md' && <Tag color="green">多文件模式</Tag>}
                {validation.error && <Tag color="red">{validation.error}</Tag>}
              </Space>
              <List
                size="small"
                bordered
                dataSource={files}
                renderItem={(file) => (
                  <List.Item
                    actions={[
                      <Button
                        key="remove"
                        type="text"
                        size="small"
                        icon={<DeleteOutlined />}
                        onClick={() => removeFile(file)}
                      />,
                    ]}
                  >
                    {file.name.toLowerCase().endsWith('.zip')
                      ? <FileZipOutlined style={{ marginRight: 8, color: '#722ed1' }} />
                      : <FileMarkdownOutlined style={{ marginRight: 8, color: '#1677ff' }} />}
                    <Text style={{ flex: 1 }}>{file.name}</Text>
                    <Text type="secondary" style={{ fontSize: 12, marginLeft: 12 }}>
                      {formatBytes(file.size)}
                    </Text>
                  </List.Item>
                )}
              />
            </div>
          )}
        </Card>
      </Col>

      <Col xs={24} lg={10}>
        <Card
          bordered={false}
          style={{ borderRadius: 16, boxShadow: '0 1px 2px rgba(15,23,42,0.04)', position: 'sticky', top: 24 }}
          bodyStyle={{ padding: 24 }}
        >
          <Title level={4} style={{ margin: '0 0 8px' }}>导入后会发生什么</Title>
          <Paragraph type="secondary" style={{ fontSize: 13 }}>
            1. 立即创建一个「导入型」项目，每个 .md 文件直接落到对应 slide 的 prompt 字段。
          </Paragraph>
          <Paragraph type="secondary" style={{ fontSize: 13 }}>
            2. 后台自动跑「结构补全 / 大纲提取」任务，补出 page_type、core_message、版式建议等。
            <br />
            过程中<strong>不会改写 prompt 正文</strong>。
          </Paragraph>
          <Paragraph type="secondary" style={{ fontSize: 13 }}>
            3. 立即跳转到工作台，顶部能看到结构补全任务的进度条。任务进行中工作台为只读，通常 1 分钟内完成；之后即可逐页精修 prompt、新增删除页、一致性检查并出图。
          </Paragraph>

          {statusMsg && (
            <Alert
              type={statusMsg.kind === 'error' ? 'error' : (statusMsg.kind === 'success' ? 'success' : 'info')}
              message={statusMsg.text}
              showIcon
              style={{ marginTop: 12 }}
            />
          )}

          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 24, paddingTop: 16, borderTop: '1px solid #f0f0f0' }}>
            <Button
              type="primary"
              onClick={handleSubmit}
              loading={busy}
              disabled={busy || !files.length || !!validation.error}
            >
              {busy ? '导入中...' : '开始导入'}
            </Button>
          </div>
        </Card>
      </Col>
    </Row>
  );
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(2)} MB`;
}
