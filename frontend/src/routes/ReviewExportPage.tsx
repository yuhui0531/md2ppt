import { Link, useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { exportProject } from '../api/export';
import { getProject } from '../api/projects';
import { ConsistencyReportView } from '../components/ConsistencyReportView';
import { MarkdownPreview } from '../components/MarkdownPreview';
import { StatusMessage } from '../components/StatusMessage';
import { StyleGuidePanel } from '../components/StyleGuidePanel';
import { useProjectStore } from '../store/projectStore';
import type { ExportFormat } from '../types/api';

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
    return <main className="admin-page"><StatusMessage>正在加载项目...</StatusMessage></main>;
  }

  return (
    <main className="admin-page stack">
      <section className="card header-card">
        <div>
          <p className="eyebrow">Export Center</p>
          <h1>审核与导出</h1>
          <p className="muted">检查总体规划、统一视觉规范和每页 Markdown 生图 prompt。</p>
        </div>
        <div className="actions">
          <Link className="button secondary" to="/projects">项目管理</Link>
          <Link className="button secondary" to={`/workspace/${project.project_id}`}>返回工作台</Link>
        </div>
      </section>

      {message ? <StatusMessage kind={message.kind}>{message.text}</StatusMessage> : null}

      <section className="grid two">
        <div className="card stack">
          <h2>总体规划</h2>
          {project.deck_brief ? <p>{project.deck_brief.narrative}</p> : <p className="muted">暂无 brief。</p>}
          {project.slide_count_plan ? (
            <div className="metric">
              <span>页数</span>
              <strong>{project.slide_count_plan.accepted_slide_count}</strong>
              <small>{project.slide_count_plan.coverage_summary}</small>
            </div>
          ) : null}
        </div>
        <div className="card stack">
          <h2>导出</h2>
          <div className="actions wrap">
            <button type="button" onClick={() => handleExport('json')} disabled={busy !== null}>{busy === 'json' ? '导出中...' : '导出 JSON'}</button>
            <button type="button" onClick={() => handleExport('markdown')} disabled={busy !== null}>{busy === 'markdown' ? '导出中...' : '导出单文件 Markdown'}</button>
            <button type="button" onClick={() => handleExport('prompt_zip')} disabled={busy !== null}>{busy === 'prompt_zip' ? '导出中...' : '导出逐页 Prompt ZIP'}</button>
          </div>
          <p className="muted">导出内容会过滤 API Key，只包含项目结构和 prompt 结果。</p>
        </div>
      </section>

      <section className="grid two">
        <div className="card stack">
          <h2>统一视觉规范</h2>
          <StyleGuidePanel styleGuide={project.style_guide} />
        </div>
        <div className="card stack">
          <h2>一致性报告</h2>
          <ConsistencyReportView report={project.consistency_report} />
        </div>
      </section>

      <section className="card stack">
        <h2>逐页 Prompt</h2>
        {project.slides.map((slide) => (
          <details className="slide-detail" key={slide.slide_no}>
            <summary>第 {slide.slide_no} 页：{slide.title}</summary>
            <MarkdownPreview content={slide.prompt} />
          </details>
        ))}
      </section>
    </main>
  );
}
