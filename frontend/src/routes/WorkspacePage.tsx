import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  checkConsistency,
  deleteSlide,
  generateProject,
  getActiveJob,
  insertSlide,
  regenerateOutline,
  regeneratePrompts,
  reviseInconsistentPrompts,
  updateSlidePrompt,
} from '../api/generation';
import { getProject } from '../api/projects';
import { ConsistencyReportView } from '../components/ConsistencyReportView';
import { JobProgress } from '../components/JobProgress';
import { MarkdownPreview } from '../components/MarkdownPreview';
import { StyleGuidePanel } from '../components/StyleGuidePanel';
import { useProjectStore } from '../store/projectStore';
import type { JobResponse, ProjectData } from '../types/api';
import { pollJobUntilFinished } from '../utils/jobPolling';
import { projectStateLabel } from '../utils/projectPresentation';

import {
  CheckCircleOutlined,
  DeleteOutlined,
  DownOutlined,
  ExportOutlined,
  PictureOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  SyncOutlined,
  UpOutlined,
} from '@ant-design/icons';
import { Alert, Button, Card, Col, Collapse, Input, Modal, Popconfirm, Row, Space, Spin, Tabs, Tag, Typography } from 'antd';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

const expandSymbol = (expanded: boolean) => (
  <span style={{ marginLeft: 4, color: '#1677ff' }}>
    {expanded ? <UpOutlined style={{ fontSize: 12 }} /> : <DownOutlined style={{ fontSize: 12 }} />}
  </span>
);

// 用稳定 key 而非 success 文案做 busy 标签，避免 loading 指示靠"两处文案字符串相等"维持。
const BUSY = {
  resume: 'resume',
  regenerateOutline: 'regenerate-outline',
  regenerateAllPrompts: 'regenerate-all-prompts',
  regenerateCurrent: 'regenerate-current',
  checkConsistency: 'check-consistency',
  reviseInconsistent: 'revise-inconsistent',
  savePrompt: 'save-prompt',
  insertSlide: 'insert-slide',
  deleteSlide: 'delete-slide',
} as const;

type InsertModalState = {
  open: boolean;
  mode: 'first' | 'append' | 'after';
  anchorSlideId: string | null;
  anchorLabel: string;
  prompt: string;
};

export function WorkspacePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { project, setProject } = useProjectStore();
  const [activeSlide, setActiveSlide] = useState(0);
  const [detailView, setDetailView] = useState('prompt');
  const [busy, setBusy] = useState<string | null>(null);
  const [job, setJob] = useState<JobResponse | null>(null);
  const [message, setMessage] = useState<{ kind: 'info' | 'success' | 'error'; text: string } | null>(null);
  // 中栏 prompt 编辑草稿：和当前选中 slide 解耦，切换 slide 或外部更新 prompt 时同步。
  const [draftPrompt, setDraftPrompt] = useState<string>('');
  // 插入新页的模态框：mode 区分"在某页之后"/"末尾追加"/"空白项目首页"，
  // 避免靠 anchorLabel 字符串拼出"在末尾之后"这种语病。
  const [insertModal, setInsertModal] = useState<InsertModalState>(
    { open: false, mode: 'first', anchorSlideId: null, anchorLabel: '', prompt: '' },
  );

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

  // 选中页变化 / 外部更新该页 prompt 时同步草稿。注意此 effect 必须放在 early return 之前。
  // mount 时自动接续的任务轮询、resumeGeneration 等会在 actionsLocked 之外
  // 落 setProject(updated) —— 若同时用户在编辑当前 slide 的 prompt，不能盖掉 draft。
  // 用 userEditedRef 显式追踪"用户是否输入过"，比"draft !== slide.prompt"可靠
  // （后者在外部 prompt 变化的渲染瞬间会误判为 dirty）。
  const activeSlideObj = project?.slides[activeSlide];
  const userEditedRef = useRef(false);
  const prevSlideIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const newPrompt = activeSlideObj?.prompt ?? '';
    const newId = activeSlideObj?.id;
    const switchedSlide = newId !== prevSlideIdRef.current;
    prevSlideIdRef.current = newId;
    if (switchedSlide) {
      // 切 slide：trySwitchActiveSlide 已处理脏稿确认，这里无条件同步。
      setDraftPrompt(newPrompt);
      userEditedRef.current = false;
      return;
    }
    if (!userEditedRef.current) {
      setDraftPrompt(newPrompt);
    }
    // 否则同一 slide + 用户已编辑 → 保留 draft，外部 prompt 更新被静默吞掉。
  }, [activeSlideObj?.id, activeSlideObj?.prompt]);

  async function refreshWith(action: () => Promise<ProjectData>, key: string, successText: string) {
    if (!project) return;
    const startedFor = project.project_id;
    setBusy(key);
    setMessage(null);
    try {
      const updated = await action();
      if (!stillScoped(startedFor)) return;
      setProject(updated);
      setMessage({ kind: 'success', text: successText });
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
    setBusy(BUSY.resume);
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
  const isDirty = slide ? draftPrompt !== slide.prompt : false;
  const mutationDisabled = busy !== null || jobRunning;
  // 任何会切换/重写 slide 的操作都不能在脏稿态下进行——否则 useEffect 重置
  // draftPrompt 会让用户的编辑无声丢失。检查一致性仅打分不动 prompt，例外。
  const actionsLocked = mutationDisabled || isDirty;

  function trySwitchActiveSlide(nextIndex: number) {
    if (nextIndex === activeSlide) return;
    if (!isDirty) {
      setActiveSlide(nextIndex);
      return;
    }
    Modal.confirm({
      title: '当前页 prompt 有未保存的修改',
      content: '切换到其它页将放弃这些修改，是否继续？',
      okText: '放弃修改并切换',
      cancelText: '留在本页',
      onOk: () => setActiveSlide(nextIndex),
    });
  }

  async function handleSavePrompt() {
    if (!project || !slide) return;
    const targetSlideId = slide.id;
    await refreshWith(async () => {
      const updated = await updateSlidePrompt(project.project_id, targetSlideId, draftPrompt);
      const idx = updated.slides.findIndex((s) => s.id === targetSlideId);
      if (idx >= 0) setActiveSlide(idx);
      userEditedRef.current = false;
      return updated;
    }, BUSY.savePrompt, '已保存修改');
  }

  function handleDiscardDraft() {
    setDraftPrompt(slide?.prompt ?? '');
    userEditedRef.current = false;
  }

  function openInsertModal(opts: { mode: 'first' | 'append' | 'after'; anchorSlideId: string | null; anchorLabel: string }) {
    setInsertModal({ open: true, ...opts, prompt: '' });
  }

  async function confirmInsertSlide() {
    if (!project) return;
    const { anchorSlideId, prompt } = insertModal;
    setInsertModal((prev) => ({ ...prev, open: false }));
    await refreshWith(async () => {
      const { project: updated, newSlideId } = await insertSlide(project.project_id, anchorSlideId, prompt);
      const idx = updated.slides.findIndex((s) => s.id === newSlideId);
      if (idx >= 0) setActiveSlide(idx);
      return updated;
    }, BUSY.insertSlide, '已新增页面');
  }

  async function handleDeleteSlide(slideId: string) {
    if (!project) return;
    await refreshWith(async () => {
      const updated = await deleteSlide(project.project_id, slideId);
      if (activeSlide >= updated.slides.length) {
        setActiveSlide(Math.max(0, updated.slides.length - 1));
      }
      return updated;
    }, BUSY.deleteSlide, '已删除页面');
  }

  async function handleRegenerateOutline() {
    if (!project) return;
    await refreshWith(
      () => regenerateOutline(project.project_id, {
        slide_count_mode: project.generation_options.slide_count_mode,
        requested_slide_count: project.generation_options.requested_slide_count,
        requested_slide_range: project.generation_options.requested_slide_range,
      }),
      BUSY.regenerateOutline,
      '已重新生成大纲',
    );
  }

  async function handleRegenerateAllPrompts() {
    if (!project) return;
    await refreshWith(() => regeneratePrompts(project.project_id), BUSY.regenerateAllPrompts, '已重新生成全部 prompt');
  }

  const insertModalTitle = insertModal.mode === 'first'
    ? '新增第一页'
    : insertModal.mode === 'append'
      ? '在末尾新增页面'
      : `在${insertModal.anchorLabel}之后新增页面`;
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
                disabled={actionsLocked}
                loading={busy === BUSY.resume || jobRunning}
              >
                {jobRunning ? '任务执行中…' : '继续生成'}
              </Button>
            )}
            <Popconfirm
              title="重新生成整份大纲"
              description="会按推荐页数让大模型重写所有页，丢弃当前的手动编辑（含新增/删除）。确定继续？"
              okText="确定重生成"
              cancelText="取消"
              onConfirm={handleRegenerateOutline}
              disabled={actionsLocked}
            >
              <Button
                icon={<ReloadOutlined />}
                disabled={actionsLocked}
                loading={busy === BUSY.regenerateOutline}
              >
                重新生成大纲
              </Button>
            </Popconfirm>
            <Popconfirm
              title="重新生成全部 prompt"
              description="会让大模型按当前大纲重写所有页的 prompt，覆盖你手动编辑过的 prompt。确定继续？"
              okText="确定重生成"
              cancelText="取消"
              onConfirm={handleRegenerateAllPrompts}
              disabled={actionsLocked}
            >
              <Button
                icon={<SyncOutlined />}
                disabled={actionsLocked}
                loading={busy === BUSY.regenerateAllPrompts}
              >
                重新生成全部 prompt
              </Button>
            </Popconfirm>
            {(() => {
              const hasImages = project.slides.some((s) => s.image_url);
              const navDisabled = busy !== null || jobRunning;
              const canOpenImagesWhileGenerating = hasImages && job?.kind === 'image_generation' && jobRunning;
              // 脏稿态下离开当前页会卸载组件让 draftPrompt 丢失，封死导航。
              const imagesNavDisabled = (navDisabled && !canOpenImagesWhileGenerating) || isDirty;
              const exportNavDisabled = navDisabled || isDirty;
              const imagesLabel = hasImages ? '查看图片' : '下一步：准备生图';
              const imagesBtn = <Button type="primary" icon={<PictureOutlined />} disabled={imagesNavDisabled}>{imagesLabel}</Button>;
              const exportBtn = <Button icon={<ExportOutlined />} disabled={exportNavDisabled}>批量导出提示词</Button>;
              return (
                <>
                  {imagesNavDisabled ? imagesBtn : <Link to={`/workspace/${project.project_id}/images`}>{imagesBtn}</Link>}
                  {exportNavDisabled ? exportBtn : <Link to={`/review/${project.project_id}`}>{exportBtn}</Link>}
                </>
              );
            })()}
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
                <SlideRow
                  key={item.id}
                  item={item}
                  index={index}
                  active={index === activeSlide}
                  hasImage={!!item.image_url}
                  disabled={actionsLocked}
                  onSelect={() => trySwitchActiveSlide(index)}
                  onInsertAfter={() => openInsertModal({ mode: 'after', anchorSlideId: item.id, anchorLabel: getSlideLabel(item) })}
                  onDelete={() => handleDeleteSlide(item.id)}
                />
              ))}
              <div style={{ padding: '12px 24px', borderTop: project.slides.length ? '1px solid #f0f0f0' : 'none' }}>
                <Button
                  block
                  icon={<PlusOutlined />}
                  disabled={actionsLocked}
                  onClick={() => {
                    if (project.slides.length === 0) {
                      openInsertModal({ mode: 'first', anchorSlideId: null, anchorLabel: '' });
                    } else {
                      const lastId = project.slides[project.slides.length - 1].id;
                      openInsertModal({ mode: 'append', anchorSlideId: lastId, anchorLabel: '' });
                    }
                  }}
                >
                  {project.slides.length === 0 ? '新增第一页' : '在末尾新增页面'}
                </Button>
              </div>
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
              <Space>
                {isDirty && (
                  <>
                    <Button
                      type="primary"
                      disabled={!slide || mutationDisabled}
                      loading={busy === BUSY.savePrompt}
                      onClick={handleSavePrompt}
                    >
                      保存修改
                    </Button>
                    <Button
                      disabled={!slide || mutationDisabled}
                      onClick={handleDiscardDraft}
                    >
                      撤销修改
                    </Button>
                  </>
                )}
                <Button
                  icon={<SyncOutlined />}
                  disabled={!slide || mutationDisabled || isDirty}
                  loading={busy === BUSY.regenerateCurrent}
                  onClick={() => refreshWith(() => regeneratePrompts(project.project_id, [slide!.slide_no]), BUSY.regenerateCurrent, '已重新生成当前页 prompt')}
                >
                  重生成当前页
                </Button>
              </Space>
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
                  value={draftPrompt}
                  onChange={(e) => {
                    const value = e.target.value;
                    setDraftPrompt(value);
                    // 不能 sticky-true：用户敲完又删回 slide.prompt 时 ref 必须落回 false，
                    // 否则后续外部 setProject 落地时 sync effect 会拒绝同步，
                    // 等外部 prompt 改成第三个值时 isDirty 借尸还魂、按钮回来、
                    // 用户一保存就会用陈旧 draft 覆盖掉外部更新。
                    userEditedRef.current = value !== (slide?.prompt ?? '');
                  }}
                  disabled={!slide || mutationDisabled}
                  style={{ height: '100%', minHeight: 520, resize: 'none', border: 'none', background: 'transparent', padding: 16, fontFamily: 'monospace' }}
                />
              )}
              {detailView === 'preview' && <MarkdownPreview content={draftPrompt} />}
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
                disabled={mutationDisabled}
                loading={busy === BUSY.checkConsistency}
                onClick={() => refreshWith(() => checkConsistency(project.project_id, project.generation_options.consistency_threshold), BUSY.checkConsistency, '一致性检查已完成')}
              >
                检查一致性
              </Button>
              <Button
                block
                type="primary"
                ghost
                disabled={actionsLocked}
                loading={busy === BUSY.reviseInconsistent}
                onClick={() => refreshWith(() => reviseInconsistentPrompts(project.project_id, project.generation_options.consistency_threshold), BUSY.reviseInconsistent, '不一致页面已修正')}
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

      <Modal
        title={insertModalTitle}
        open={insertModal.open}
        onOk={confirmInsertSlide}
        onCancel={() => setInsertModal((prev) => ({ ...prev, open: false }))}
        okText="确认新增"
        cancelText="取消"
        confirmLoading={busy === BUSY.insertSlide}
        destroyOnClose
        width={640}
      >
        <div style={{ marginBottom: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>新页的 prompt 内容（其它结构化字段保持为空，可后续点"重生成当前页"由模型补全）</Text>
        </div>
        <TextArea
          autoSize={{ minRows: 8, maxRows: 16 }}
          value={insertModal.prompt}
          onChange={(e) => setInsertModal((prev) => ({ ...prev, prompt: e.target.value }))}
          placeholder="留空也可创建一张空白页，稍后再编辑"
        />
      </Modal>
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

interface SlideRowProps {
  item: ProjectData['slides'][number];
  index: number;
  active: boolean;
  hasImage: boolean;
  disabled: boolean;
  onSelect: () => void;
  onInsertAfter: () => void;
  onDelete: () => void;
}

function SlideRow({ item, active, hasImage, disabled, onSelect, onInsertAfter, onDelete }: SlideRowProps) {
  const [hover, setHover] = useState(false);
  const actionsVisible = hover || active;
  return (
    <div
      onClick={onSelect}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: '14px 24px',
        cursor: 'pointer',
        borderBottom: '1px solid #f0f0f0',
        background: active ? '#e6f4ff' : 'transparent',
        borderLeft: active ? '3px solid #1677ff' : '3px solid transparent',
        transition: 'all 0.2s',
        position: 'relative',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, alignItems: 'center', gap: 8 }}>
        <Text strong style={{ color: active ? '#1677ff' : 'inherit' }}>{getSlideLabel(item)}</Text>
        <Space size={4} style={{ opacity: actionsVisible ? 1 : 0, transition: 'opacity 0.15s' }} onClick={(e) => e.stopPropagation()}>
          <Button
            type="text"
            size="small"
            icon={<PlusOutlined />}
            title="在此后插入新页"
            disabled={disabled}
            onClick={onInsertAfter}
          />
          <Popconfirm
            title="删除该页？"
            description={hasImage ? '该页已生成图片，删除后图片将一并清除。' : '一致性报告会被清空。'}
            okText="删除"
            okType="danger"
            cancelText="取消"
            onConfirm={onDelete}
            disabled={disabled}
          >
            <Button
              type="text"
              size="small"
              danger
              icon={<DeleteOutlined />}
              title="删除该页"
              disabled={disabled}
            />
          </Popconfirm>
          <Tag bordered={false} color={active ? 'blue' : 'default'} style={{ margin: 0, fontSize: 11 }}>{item.page_type || '未分类'}</Tag>
        </Space>
      </div>
      <Text type="secondary" style={{ fontSize: 13, display: 'block' }}>{getSlideSummary(item)}</Text>
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
