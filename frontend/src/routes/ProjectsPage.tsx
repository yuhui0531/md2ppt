import { Link } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { getModelConfig } from '../api/modelConfig';
import { deleteProject, listProjects, renameProject } from '../api/projects';
import { StatusMessage } from '../components/StatusMessage';
import type { ProjectSummary } from '../types/api';
import { projectStateLabel } from '../utils/projectPresentation';

export function ProjectsPage() {
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
    if (!window.confirm(`确认删除项目“${project.title}”吗？此操作不可恢复。`)) {
      return;
    }
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
    <main className="admin-page stack">
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">Control Room</p>
          <h2>项目管理</h2>
          <p>从历史记录进入任意项目，继续生成、回看大纲、校验一致性，或者直接导出。</p>
        </div>
      </section>

      {!configured ? (
        <StatusMessage kind="info">当前还没有可用模型配置。你仍然可以查看历史项目，但新生成前需要先完成模型配置。</StatusMessage>
      ) : null}
      {message ? <StatusMessage kind={message.kind}>{message.text}</StatusMessage> : null}

      <section className="stats-grid">
        <article className="stat-card">
          <span>项目总数</span>
          <strong>{stats.total}</strong>
          <small>历史项目与当前项目统一管理</small>
        </article>
        <article className="stat-card">
          <span>进行中</span>
          <strong>{stats.inProgress}</strong>
          <small>仍可继续生成或调整</small>
        </article>
        <article className="stat-card">
          <span>已完成审核</span>
          <strong>{stats.completed}</strong>
          <small>可直接进入审核与导出</small>
        </article>
        <article className="stat-card">
          <span>累计页数</span>
          <strong>{stats.slides}</strong>
          <small>已生成页面总量</small>
        </article>
      </section>

      <section className="card stack">
        <div className="section-head">
          <div>
            <h2>历史项目</h2>
            <p className="muted">按最近更新时间排序，直接从这里进入工作台或审核页。</p>
          </div>
          <div className="pill">{projects.length} 个项目</div>
        </div>

        {busy ? <StatusMessage>正在加载项目列表...</StatusMessage> : null}
        {!busy && projects.length === 0 ? (
          <div className="empty-state">
            <h3>还没有项目记录</h3>
            <p>从“新建项目”上传 Markdown 素材后，这里会自动出现历史条目。</p>
            <Link className="button" to="/projects/new">去新建项目</Link>
          </div>
        ) : null}

        {!busy ? (
          <div className="project-table">
            {projects.map((project) => (
              <article className="project-row" key={project.project_id}>
                <div className="project-row-main">
                  <div className="project-title-block">
                    {editingProjectId === project.project_id ? (
                      <div className="rename-row">
                        <input
                          value={draftTitle}
                          onChange={(event) => setDraftTitle(event.target.value)}
                          placeholder="输入项目名称"
                        />
                        <div className="inline-actions">
                          <button
                            type="button"
                            onClick={() => handleRename(project.project_id)}
                            disabled={actionBusy !== null}
                          >
                            保存
                          </button>
                          <button
                            type="button"
                            className="secondary"
                            onClick={cancelRename}
                            disabled={actionBusy !== null}
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <h3>{project.title}</h3>
                      </>
                    )}
                  </div>
                  <div className="project-meta">
                    <span className="state-chip">{projectStateLabel(project.generation_state)}</span>
                    <span>{project.slide_count} 页</span>
                    <span>更新于 {formatDateTime(project.updated_at)}</span>
                  </div>
                </div>
                <div className="project-row-actions">
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => startRename(project)}
                    disabled={actionBusy !== null}
                  >
                    重命名
                  </button>
                  <button
                    type="button"
                    className="ghost-button danger"
                    onClick={() => handleDelete(project)}
                    disabled={actionBusy !== null}
                  >
                    删除
                  </button>
                  <Link className="button secondary" to={`/workspace/${project.project_id}`}>进入工作台</Link>
                  <Link className="button" to={`/review/${project.project_id}`}>审核导出</Link>
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </section>
    </main>
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
