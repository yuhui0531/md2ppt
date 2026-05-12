import { Link, useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { getProject } from '../api/projects';
import { checkConsistency, generateProject, regeneratePrompts, reviseInconsistentPrompts } from '../api/generation';
import { ConsistencyReportView } from '../components/ConsistencyReportView';
import { JobProgress } from '../components/JobProgress';
import { MarkdownPreview } from '../components/MarkdownPreview';
import { StatusMessage } from '../components/StatusMessage';
import { StyleGuidePanel } from '../components/StyleGuidePanel';
import { useProjectStore } from '../store/projectStore';
import type { JobResponse, ProjectData } from '../types/api';
import { pollJobUntilFinished } from '../utils/jobPolling';
import { projectStateLabel } from '../utils/projectPresentation';

export function WorkspacePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { project, setProject } = useProjectStore();
  const [activeSlide, setActiveSlide] = useState(0);
  const [detailView, setDetailView] = useState<'prompt' | 'preview'>('prompt');
  const [busy, setBusy] = useState<string | null>(null);
  const [job, setJob] = useState<JobResponse | null>(null);
  const [message, setMessage] = useState<{ kind: 'info' | 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!projectId) return;
    getProject(projectId).then(setProject).catch((error) => setMessage({ kind: 'error', text: error instanceof Error ? error.message : '加载项目失败' }));
  }, [projectId, setProject]);

  async function refreshWith(action: () => Promise<ProjectData>, success: string) {
    setBusy(success);
    setMessage(null);
    try {
      const updated = await action();
      setProject(updated);
      setMessage({ kind: 'success', text: success });
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : '操作失败' });
    } finally {
      setBusy(null);
    }
  }

  async function resumeGeneration() {
    if (!project) return;
    setBusy('继续生成');
    setMessage(null);
    setJob(null);
    try {
      const createdJob = await generateProject(project.project_id, 'auto');
      setJob(createdJob);
      await pollJobUntilFinished(createdJob.job_id, (latest) => setJob(latest));
      const updated = await getProject(project.project_id);
      setProject(updated);
      setMessage({ kind: 'success', text: '已继续完成生成' });
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : '继续生成失败' });
    } finally {
      setBusy(null);
    }
  }

  if (!project || project.project_id !== projectId) {
    return <main className="admin-page"><StatusMessage>正在加载项目...</StatusMessage></main>;
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
    <main className="admin-page stack">
      <section className="card header-card">
        <div>
          <h1>项目工作台</h1>
          <p className="muted">状态：{projectStateLabel(project.generation_state)}</p>
        </div>
        <div className="actions">
          {canResume ? <button type="button" className="secondary" disabled={busy !== null} onClick={resumeGeneration}>继续生成</button> : null}
          <Link className="button secondary" to={`/workspace/${project.project_id}/images`}>批量生图</Link>
          <Link className="button" to={`/review/${project.project_id}`}>审核与导出</Link>
        </div>
      </section>

      {message ? <StatusMessage kind={message.kind}>{message.text}</StatusMessage> : null}
      <JobProgress job={job} />

      <section className="card stack material-card">
        <div className="workspace-section-head">
          <h2>素材结构</h2>
          <span className="section-count">共 {project.parsed_sections.length} 段</span>
        </div>
        <div className="material-grid">
          {project.parsed_sections.map((section) => (
            <article className="material-block" key={section.id}>
              <div className="material-block-head">
                <span className="material-level">L{section.level}</span>
                <strong>{section.heading}</strong>
              </div>
              <p>{section.content.slice(0, 140)}{section.content.length > 140 ? '...' : ''}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="workspace-main">
        <div className="card stack outline-card">
          <div className="outline-card-header">
            <h2>页数与大纲</h2>
            <span className="section-count">共 {project.slides.length} 页</span>
          </div>
          {project.slide_count_plan ? (
            <div className="outline-summary">
              <div className="outline-summary-top">
                <div className="outline-summary-copy">
                  <span>推荐页数</span>
                  <strong>{project.slide_count_plan.accepted_slide_count} 页</strong>
                </div>
              </div>
              <small>{project.slide_count_plan.coverage_summary || project.slide_count_plan.reason}</small>
            </div>
          ) : null}
          <div className="slide-list outline-list tall-list">
            {project.slides.map((item, index) => (
              <button type="button" className={index === activeSlide ? 'active' : ''} key={item.slide_no} onClick={() => setActiveSlide(index)}>
                <span className="outline-item-copy">
                  <span className="outline-item-main">
                    <span className="outline-item-title">{getSlideLabel(item)}</span>
                  </span>
                  <span className="outline-item-summary">{getSlideSummary(item)}</span>
                </span>
                <small>{item.page_type}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="workspace-detail stack">
          <section className="card stack current-slide-card">
            <div className="header-card compact-row">
              <div className="current-slide-heading">
                <h2 className="current-slide-title">{slide ? getCurrentSlideHeading(slide) : '当前页详情'}</h2>
              </div>
              <div className="actions">
                <button type="button" className="secondary" disabled={!slide || busy !== null} onClick={() => refreshWith(() => regeneratePrompts(project.project_id, [slide!.slide_no]), '已重新生成当前页 prompt')}>重生成当前页</button>
              </div>
            </div>

            {slide ? (
              <>
                {slideMetaItems.length ? (
                  <div className="slide-meta-grid">
                    {slideMetaItems.map((item) => (
                      <div className="metric" key={item.label}>
                        <span>{item.label}</span>
                        <strong className="metric-label">{item.value}</strong>
                      </div>
                    ))}
                  </div>
                ) : null}

                {hasSlideSummary ? (
                  <div className="slide-summary-card">
                    {hasText(slide.core_message) ? (
                      <>
                        <h3>核心信息</h3>
                        <p className="slide-core-message">{slide.core_message}</p>
                      </>
                    ) : null}
                    <div className="slide-summary-grid">
                      <DetailList title="模块" items={slideModules} />
                      <DetailList title="视觉元素" items={slideVisualElements} />
                      <DetailList title="文字层级" items={slideTextHierarchy} />
                    </div>
                  </div>
                ) : null}

                {slidePageText.length ? (
                  <div className="slide-summary-card">
                    <h3>页面文案</h3>
                    <div className="text-snippets">
                      {slidePageText.map((text) => (
                        <p key={text}>{text}</p>
                      ))}
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}
          </section>

          <section className="card stack detail-workbench">
            <div className="detail-workbench-head">
              <div>
                <h2>Prompt 工作区</h2>
                <p className="muted">当前页内容与预览切换查看。</p>
              </div>
              <div className="tabs">
                <button type="button" className={detailView === 'prompt' ? 'active' : ''} onClick={() => setDetailView('prompt')}>Prompt</button>
                <button type="button" className={detailView === 'preview' ? 'active' : ''} onClick={() => setDetailView('preview')}>预览</button>
              </div>
            </div>

            {detailView === 'prompt' ? (
              <textarea className="editor prompt workspace-prompt" readOnly value={slide?.prompt ?? ''} />
            ) : (
              <MarkdownPreview content={slide?.prompt ?? ''} />
            )}
          </section>
        </div>

        <aside className="card stack consistency-card">
          <div className="workspace-section-head">
            <h2>风格一致性</h2>
          </div>
          <div className="actions wrap consistency-actions">
            <button type="button" className="secondary" disabled={busy !== null} onClick={() => refreshWith(() => checkConsistency(project.project_id, project.generation_options.consistency_threshold), '一致性检查已完成')}>检查一致性</button>
            <button type="button" disabled={busy !== null} onClick={() => refreshWith(() => reviseInconsistentPrompts(project.project_id, project.generation_options.consistency_threshold), '不一致页面已修正')}>修正不一致</button>
          </div>
          <ConsistencyReportView report={project.consistency_report} />
        </aside>
      </section>

      <section className="card stack style-guide-card">
        <div className="workspace-section-head">
          <h2>统一视觉规范</h2>
        </div>
        <StyleGuidePanel styleGuide={project.style_guide} />
      </section>
    </main>
  );
}

function DetailList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) {
    return null;
  }

  return (
    <div className="detail-list">
      <h3>{title}</h3>
      <div className="tags neutral">
        {items.map((item) => (
          <span className="tag" key={item}>{item}</span>
        ))}
      </div>
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
    return hasText(slide.page_role) ? slide.page_role : '待补充当前页内容摘要';
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
