import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { checkConsistency, generateProject, getActiveJob, regeneratePrompts, reviseInconsistentPrompts } from '../api/generation';
import { getProject } from '../api/projects';
import { ConsistencyReportView } from '../components/ConsistencyReportView';
import { JobProgress } from '../components/JobProgress';
import { MarkdownPreview } from '../components/MarkdownPreview';
import { StyleGuidePanel } from '../components/StyleGuidePanel';
import { useProjectStore } from '../store/projectStore';
import type { JobResponse, ProjectData } from '../types/api';
import { pollJobUntilFinished } from '../utils/jobPolling';
import { projectStateLabel } from '../utils/projectPresentation';

import { CheckCircleOutlined, DownOutlined, ExportOutlined, PictureOutlined, PlayCircleOutlined, SyncOutlined, UpOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Col, Collapse, Input, Row, Space, Spin, Tabs, Tag, Typography } from 'antd';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

const expandSymbol = (expanded: boolean) => (
  <span style={{ marginLeft: 4, color: '#1677ff' }}>
    {expanded ? <UpOutlined style={{ fontSize: 12 }} /> : <DownOutlined style={{ fontSize: 12 }} />}
  </span>
);

export function WorkspacePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { project, setProject } = useProjectStore();
  const [activeSlide, setActiveSlide] = useState(0);
  const [detailView, setDetailView] = useState('prompt');
  const [busy, setBusy] = useState<string | null>(null);
  const [job, setJob] = useState<JobResponse | null>(null);
  const [message, setMessage] = useState<{ kind: 'info' | 'success' | 'error'; text: string } | null>(null);

  // 路由 param 切换时同一 component 实例会复用，旧的 click handler 还在
  // 跑 await 链路；它们必须能知道用户已经离开了原项目，否则会把旧项目的
  // getProject 结果 setProject 写进全局 store。每次 setState 后 await 前
  // 都用这个 ref 复查一次"我们还在原项目页吗"。
  const activeProjectIdRef = useRef(projectId);
  useEffect(() => {
    activeProjectIdRef.current = projectId;
  }, [projectId]);
  const stillScoped = (startedFor: string) => activeProjectIdRef.current === startedFor;

  useEffect(() => {
    if (!projectId) return;
    // 同一组件实例切换 projectId（路由 param 变化）时 React 会保留 state。
    // 必须在新 effect 启动前清掉上一个项目残留的 job/busy/message，
    // 否则 attach 还没找到新项目的任务，旧项目的进度条会闪在新项目页面上。
    setJob(null);
    setBusy(null);
    setMessage(null);
    let cancelled = false;
    (async () => {
      // Phase 1: 加载项目 + 探测进行中的任务（任意 kind，因为 409 规则与 kind 无关）。
      let active;
      try {
        const proj = await getProject(projectId);
        if (cancelled) return;
        setProject(proj);
        active = await getActiveJob(projectId);
      } catch (error) {
        if (cancelled) return;
        setMessage({ kind: 'error', text: error instanceof Error ? error.message : '加载项目失败' });
        return;
      }
      if (cancelled || !active) return;
      setJob(active);

      // Phase 2: 等任务结束。不管是哪种 kind 都要等（解锁按钮），
      // 但只有 generation 类的成功/失败提示才会在这页显示，
      // image_generation 的提示交给生图页处理。
      try {
        const finalJob = await pollJobUntilFinished(active.job_id, (latest) => {
          if (!cancelled) setJob(latest);
        });
        if (cancelled) return;
        const updated = await getProject(projectId);
        if (cancelled) return;
        setProject(updated);
        if (active.kind === 'generation' && !finalJob.error) {
          setMessage({ kind: 'success', text: '已自动接续完成进行中的任务' });
        }
      } catch (error) {
        if (cancelled) return;
        if (active.kind === 'generation') {
          setMessage({ kind: 'error', text: error instanceof Error ? error.message : '接续任务失败' });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, setProject]);

  // 任务是否在跑（任意类型）：用于禁用所有会和后台并发写 ProjectData 的按钮。
  const jobRunning = job?.status === 'running';
  // 当前页只接管 PPT 生成进度的展示；其它类型的任务在自己的页面显示。
  const displayJob = job?.kind === 'generation' ? job : null;

  async function refreshWith(action: () => Promise<ProjectData>, success: string) {
    if (!project) return;
    const startedFor = project.project_id;
    setBusy(success);
    setMessage(null);
    try {
      const updated = await action();
      if (!stillScoped(startedFor)) return;
      setProject(updated);
      setMessage({ kind: 'success', text: success });
    } catch (error) {
      if (!stillScoped(startedFor)) return;
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : '操作失败' });
    } finally {
      if (stillScoped(startedFor)) setBusy(null);
    }
  }

  async function resumeGeneration() {
    if (!project) return;
    // 已经有任务在跑（可能是首屏 useEffect 接续的，也可能是刚点过一次还没轮询完），
    // 不要再发 POST 触发 409；按钮 disabled/loading 已经覆盖这条路径，这里是双保险。
    if (jobRunning) return;
    const startedFor = project.project_id;
    setBusy('继续生成');
    setMessage(null);
    setJob(null);
    try {
      const createdJob = await generateProject(startedFor, 'auto');
      if (!stillScoped(startedFor)) return;
      setJob(createdJob);
      await pollJobUntilFinished(createdJob.job_id, (latest) => {
        if (stillScoped(startedFor)) setJob(latest);
      });
      if (!stillScoped(startedFor)) return;
      const updated = await getProject(startedFor);
      if (!stillScoped(startedFor)) return;
      setProject(updated);
      setMessage({ kind: 'success', text: '已继续完成生成' });
    } catch (error) {
      if (!stillScoped(startedFor)) return;
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : '继续生成失败' });
    } finally {
      if (stillScoped(startedFor)) setBusy(null);
    }
  }

  if (!project || project.project_id !== projectId) {
    return <main className="admin-page" style={{ padding: 24, textAlign: 'center' }}><Spin size="large" tip="正在加载项目..." /></main>;
  }

  const slide = project.slides[activeSlide];
  const canResume = !['consistency_checked', 'revised'].includes(project.generation_state);
  const slideMetaItems = slide ? [
    { label: '页面类型', value: slide.page_type },
    { label: '页面角色', value: slide.page_role },
    { label: '版式建议', value: slide.layout },
  ].filter((item) => hasText(item.value)) : [];
  const slideModules = slide?.modules.filter(hasText) ?? [];
  const slideVisualElements = slide?.visual_elements.filter(hasText) ?? [];
  const slideTextHierarchy = hasText(slide?.text_hierarchy) ? [slide!.text_hierarchy] : [];
  const slidePageText = slide?.page_text.filter(hasText) ?? [];
  const hasSlideSummary = hasText(slide?.core_message) || slideModules.length > 0 || slideVisualElements.length > 0 || slideTextHierarchy.length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 1600, margin: '0 auto', paddingBottom: 40 }}>
      <Card bordered={false} style={{ borderRadius: 16, boxShadow: '0 1px 2px rgba(15,23,42,0.04)', position: 'sticky', top: -24, zIndex: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <Title level={3} style={{ margin: '0 0 8px' }}>项目工作台</Title>
            <Text type="secondary">状态：<Tag bordered={false} color="blue">{projectStateLabel(project.generation_state)}</Tag></Text>
          </div>
          <Space wrap>
            {canResume && (
              <Button
                icon={<PlayCircleOutlined />}
                onClick={resumeGeneration}
                disabled={busy !== null || jobRunning}
                loading={busy === '继续生成' || jobRunning}
              >
                {jobRunning ? '任务执行中…' : '继续生成'}
              </Button>
            )}
            <Link to={`/workspace/${project.project_id}/images`}>
              <Button type="primary" icon={<PictureOutlined />}>下一步：准备生图</Button>
            </Link>
            <Link to={`/review/${project.project_id}`}>
              <Button icon={<ExportOutlined />}>批量导出提示词</Button>
            </Link>
          </Space>
        </div>
      </Card>

      {message && (
        <Alert message={message.text} type={message.kind === 'error' ? 'error' : (message.kind === 'success' ? 'success' : 'info')} showIcon />
      )}
      <JobProgress job={displayJob} />

      {/* 素材结构 - collapsible, shows ALL sections when expanded */}
      <Collapse
        bordered={false}
        style={{ borderRadius: 16, boxShadow: '0 1px 2px rgba(15,23,42,0.04)', background: '#fff' }}
        items={[{
          key: 'parsed-sections',
          label: (
            <Space size={8}>
              <Text strong>素材结构</Text>
              <Tag bordered={false}>共 {project.parsed_sections.length} 段</Tag>
            </Space>
          ),
          children: (
            <Row gutter={[12, 12]}>
              {project.parsed_sections.map((section) => (
                <Col key={section.id} xs={24} sm={12} md={8} lg={6}>
                  <div style={{ background: '#f8fafc', padding: 12, borderRadius: 8, border: '1px solid #e2e8f0', height: '100%' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <Tag color="cyan" style={{ margin: 0 }}>L{section.level}</Tag>
                      <Text strong ellipsis>{section.heading}</Text>
                    </div>
                    <Paragraph type="secondary" style={{ margin: 0, fontSize: 13 }} ellipsis={{ rows: 3, expandable: 'collapsible', symbol: expandSymbol }}>
                      {section.content}
                    </Paragraph>
                  </div>
                </Col>
              ))}
            </Row>
          ),
        }]}
      />

      {/* Main work area: page list | details/prompt | consistency, aligned at top */}
      <Row gutter={[24, 24]} align="stretch">
        <Col xs={24} lg={7} style={{ display: 'flex' }}>
          <Card
            title={<><span style={{ marginRight: 8 }}>页数与大纲</span><Tag bordered={false}>共 {project.slides.length} 页</Tag></>}
            bordered={false}
            style={{ borderRadius: 16, boxShadow: '0 1px 2px rgba(15,23,42,0.04)', width: '100%', display: 'flex', flexDirection: 'column' }}
            bodyStyle={{ padding: 0, display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 180px)', overflow: 'hidden' }}
          >
            {project.slide_count_plan && (
              <div style={{ padding: '16px 24px', borderBottom: '1px solid #f0f0f0', background: '#fdfdfd' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <Text type="secondary">推荐页数</Text>
                  <Text strong>{project.slide_count_plan.accepted_slide_count} 页</Text>
                </div>
                <Paragraph type="secondary" style={{ margin: 0, fontSize: 12 }} ellipsis={{ rows: 3, expandable: 'collapsible', symbol: expandSymbol }}>
                  {project.slide_count_plan.coverage_summary || project.slide_count_plan.reason}
                </Paragraph>
              </div>
            )}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {project.slides.map((item, index) => (
                <div
                  key={item.slide_no}
                  onClick={() => setActiveSlide(index)}
                  style={{
                    padding: '14px 24px',
                    cursor: 'pointer',
                    borderBottom: '1px solid #f0f0f0',
                    background: index === activeSlide ? '#e6f4ff' : 'transparent',
                    borderLeft: index === activeSlide ? '3px solid #1677ff' : '3px solid transparent',
                    transition: 'all 0.2s'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <Text strong style={{ color: index === activeSlide ? '#1677ff' : 'inherit' }}>{getSlideLabel(item)}</Text>
                    <Tag bordered={false} color={index === activeSlide ? 'blue' : 'default'} style={{ margin: 0, fontSize: 11 }}>{item.page_type}</Tag>
                  </div>
                  <Text type="secondary" style={{ fontSize: 13, display: 'block' }}>{getSlideSummary(item)}</Text>
                </div>
              ))}
            </div>
          </Card>
        </Col>

        <Col xs={24} lg={11} style={{ display: 'flex' }}>
          <Card
            bordered={false}
            style={{ borderRadius: 16, boxShadow: '0 1px 2px rgba(15,23,42,0.04)', width: '100%', display: 'flex', flexDirection: 'column' }}
            bodyStyle={{ padding: 24, display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 180px)', overflow: 'hidden' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12 }}>
              <Title level={4} style={{ margin: 0 }}>{slide ? getCurrentSlideHeading(slide) : '当前页详情'}</Title>
              <Button
                icon={<SyncOutlined />}
                disabled={!slide || busy !== null || jobRunning}
                loading={busy === '已重新生成当前页 prompt'}
                onClick={() => refreshWith(() => regeneratePrompts(project.project_id, [slide!.slide_no]), '已重新生成当前页 prompt')}
              >
                重生成当前页
              </Button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <Title level={5} style={{ margin: 0 }}>Prompt 工作区</Title>
                <Text type="secondary" style={{ fontSize: 12 }}>当前页内容与预览切换查看</Text>
              </div>
              <Tabs
                activeKey={detailView}
                onChange={setDetailView}
                items={[
                  { key: 'prompt', label: 'Prompt' },
                  { key: 'preview', label: '预览' },
                ]}
                style={{ marginBottom: 0 }}
              />
            </div>

            <div style={{ flex: 1, minHeight: 520, background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0', padding: detailView === 'prompt' ? 0 : 16, overflow: 'auto' }}>
              {detailView === 'prompt' && (
                <TextArea
                  readOnly
                  value={slide?.prompt ?? ''}
                  style={{ height: '100%', minHeight: 520, resize: 'none', border: 'none', background: 'transparent', padding: 16, fontFamily: 'monospace' }}
                />
              )}
              {detailView === 'preview' && <MarkdownPreview content={slide?.prompt ?? ''} />}
              {detailView === 'detail' && slide && (
                <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                  {slideMetaItems.length > 0 && (
                    <Row gutter={[12, 12]}>
                      {slideMetaItems.map((item) => (
                        <Col key={item.label} xs={12} sm={8}>
                          <div style={{ background: '#fff', padding: '8px 12px', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                            <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>{item.label}</Text>
                            <Text strong style={{ fontSize: 13 }}>{item.value}</Text>
                          </div>
                        </Col>
                      ))}
                    </Row>
                  )}

                  {hasText(slide.core_message) && (
                    <div>
                      <Text type="secondary" style={{ fontSize: 12, fontWeight: 600 }}>核心信息</Text>
                      <Paragraph style={{ margin: '4px 0 0', fontSize: 14 }}>{slide.core_message}</Paragraph>
                    </div>
                  )}

                  {hasSlideSummary && (
                    <Row gutter={[16, 16]}>
                      <Col xs={24} sm={8}><DetailList title="模块" items={slideModules} /></Col>
                      <Col xs={24} sm={8}><DetailList title="视觉元素" items={slideVisualElements} /></Col>
                      <Col xs={24} sm={8}><DetailList title="文字层级" items={slideTextHierarchy} /></Col>
                    </Row>
                  )}

                  {slidePageText.length > 0 && (
                    <div>
                      <Text type="secondary" style={{ fontSize: 12, fontWeight: 600 }}>页面文案</Text>
                      <div style={{ marginTop: 8 }}>
                        {slidePageText.map((text, i) => (
                          <Paragraph key={i} style={{ marginBottom: i === slidePageText.length - 1 ? 0 : 8 }}>{text}</Paragraph>
                        ))}
                      </div>
                    </div>
                  )}

                  {!hasSlideSummary && slidePageText.length === 0 && slideMetaItems.length === 0 && !hasText(slide.core_message) && (
                    <Text type="secondary">当前页暂无结构化详情。</Text>
                  )}
                </Space>
              )}
              {detailView === 'detail' && !slide && (
                <Text type="secondary">尚未选中页面。</Text>
              )}
            </div>
          </Card>
        </Col>

        <Col xs={24} lg={6} style={{ display: 'flex' }}>
          <Card
            title="风格一致性"
            bordered={false}
            style={{ borderRadius: 16, boxShadow: '0 1px 2px rgba(15,23,42,0.04)', width: '100%', display: 'flex', flexDirection: 'column' }}
            bodyStyle={{ padding: 24, display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 180px)', overflowY: 'auto' }}
          >
            <Space direction="vertical" style={{ width: '100%', marginBottom: 24 }}>
              <Button
                block
                icon={<CheckCircleOutlined />}
                disabled={busy !== null || jobRunning}
                loading={busy === '一致性检查已完成'}
                onClick={() => refreshWith(() => checkConsistency(project.project_id, project.generation_options.consistency_threshold), '一致性检查已完成')}
              >
                检查一致性
              </Button>
              <Button
                block
                type="primary"
                ghost
                disabled={busy !== null || jobRunning}
                loading={busy === '不一致页面已修正'}
                onClick={() => refreshWith(() => reviseInconsistentPrompts(project.project_id, project.generation_options.consistency_threshold), '不一致页面已修正')}
              >
                修正不一致
              </Button>
            </Space>

            <ConsistencyReportView report={project.consistency_report} />
          </Card>
        </Col>
      </Row>

      {/* Bottom Area: Style Guide */}
      <Card
        title="统一视觉规范"
        bordered={false}
        style={{ borderRadius: 16, boxShadow: '0 1px 2px rgba(15,23,42,0.04)', marginTop: 8 }}
      >
        <StyleGuidePanel styleGuide={project.style_guide} />
      </Card>
    </div>
  );
}

function DetailList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) {
    return null;
  }

  return (
    <div>
      <Text type="secondary" style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 8 }}>{title}</Text>
      <Space wrap size={[0, 8]}>
        {items.map((item) => (
          <Tag key={item} bordered={false} style={{ background: '#e2e8f0', color: '#334155', margin: '0 8px 0 0' }}>{item}</Tag>
        ))}
      </Space>
    </div>
  );
}

function hasText(value?: string | null): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function getSlideSummary(slide: ProjectData['slides'][number]): string {
  const summary = [
    slide.core_message,
    ...slide.modules,
    ...slide.page_text,
    ...slide.visual_elements,
  ].find(hasText);

  if (!summary) {
    return hasText(slide.page_role) ? slide.page_role : '';
  }

  const normalized = summary.replace(/\s+/g, ' ').trim();
  return normalized.length > 64 ? `${normalized.slice(0, 64)}...` : normalized;
}

function getSlideLabel(slide: ProjectData['slides'][number]): string {
  return `第${slide.slide_no}页`;
}

function getCurrentSlideHeading(slide: ProjectData['slides'][number]): string {
  const title = slide.title?.trim();
  return title ? `${getSlideLabel(slide)}：${title}` : getSlideLabel(slide);
}
