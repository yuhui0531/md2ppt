import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getProject } from '../api/projects';
import { generateImages, exportPptx } from '../api/imageGeneration';
import { getJob } from '../api/generation';
import { ImageLightbox } from '../components/ImageLightbox';
import type { GalleryImage } from '../components/ImageLightbox';
import { JobProgress } from '../components/JobProgress';
import { StatusMessage } from '../components/StatusMessage';
import { useProjectStore } from '../store/projectStore';
import type { JobResponse } from '../types/api';

export function ImageGenerationPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { project, setProject } = useProjectStore();
  const [busy, setBusy] = useState(false);
  const [generatingSlides, setGeneratingSlides] = useState<number[]>([]);
  const [retryingSlide, setRetryingSlide] = useState<number | null>(null);
  const [job, setJob] = useState<JobResponse | null>(null);
  const [message, setMessage] = useState<{ kind: 'info' | 'success' | 'error'; text: string } | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [retryPrompt, setRetryPrompt] = useState('');

  useEffect(() => {
    if (!projectId) return;
    getProject(projectId).then(setProject).catch((error) => setMessage({ kind: 'error', text: error instanceof Error ? error.message : '加载项目失败' }));
  }, [projectId, setProject]);

  async function handleGenerateAll() {
    if (!project) return;
    setBusy(true);
    setGeneratingSlides(project.slides.map((s) => s.slide_no));
    setMessage(null);
    setJob(null);
    try {
      const createdJob = await generateImages(project.project_id, { slide_numbers: null });
      setJob(createdJob);
      await pollAndRefresh(createdJob.job_id);
      setMessage({ kind: 'success', text: '批量生图完成' });
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : '批量生图失败' });
    } finally {
      setBusy(false);
      setGeneratingSlides([]);
    }
  }

  async function handleRetrySlide(slideNo: number) {
    if (!project) return;
    setBusy(true);
    setGeneratingSlides([slideNo]);
    setMessage(null);
    setJob(null);
    try {
      const createdJob = await generateImages(project.project_id, {
        slide_numbers: [slideNo],
        extra_prompt: retryPrompt.trim() || null,
      });
      setJob(createdJob);
      await pollAndRefresh(createdJob.job_id);
      setMessage({ kind: 'success', text: `第${slideNo}页重新生图完成` });
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : '重试失败' });
    } finally {
      setBusy(false);
      setGeneratingSlides([]);
      setRetryingSlide(null);
      setRetryPrompt('');
    }
  }

  async function handleExportPptx() {
    if (!project) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await exportPptx(project.project_id);
      window.location.href = result.download_url;
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'PPT 导出失败' });
    } finally {
      setBusy(false);
    }
  }

  async function pollAndRefresh(jobId: string) {
    while (true) {
      await new Promise((resolve) => window.setTimeout(resolve, 2000));
      const latest = await getJob(jobId);
      setJob(latest);
      if (project) {
        const updated = await getProject(project.project_id);
        setProject(updated);
      }
      if (latest.status === 'completed') return;
      if (latest.status === 'failed') throw new Error(latest.error || '生图失败');
      if (latest.status === 'cancelled') throw new Error('任务已取消');
    }
  }

  if (!project || project.project_id !== projectId) {
    return <main className="admin-page"><StatusMessage>正在加载项目...</StatusMessage></main>;
  }

  const hasAnyPrompt = project.slides.some((s) => s.prompt);

  const galleryImages: GalleryImage[] = project.slides
    .filter((s) => s.image_url)
    .map((s) => ({ src: s.image_url!, alt: `第${s.slide_no}页：${s.title}` }));

  return (
    <main className="admin-page stack">
      <section className="card header-card">
        <div>
          <h1>批量生图</h1>
          <p className="muted">使用生图模型为每页 Slide 的 Prompt 生成图片</p>
        </div>
        <div className="actions">
          <button type="button" onClick={handleGenerateAll} disabled={busy || !hasAnyPrompt}>
            {busy ? '生成中...' : project.slides.some((s) => s.image_url) ? '重新批量生成' : '开始批量生图'}
          </button>
          <button type="button" className="secondary" onClick={handleExportPptx} disabled={busy || !project.slides.some((s) => s.image_url)}>
            下载 PPT
          </button>
          <Link className="button secondary" to={`/workspace/${project.project_id}`}>返回工作台</Link>
        </div>
      </section>

      {message ? <StatusMessage kind={message.kind}>{message.text}</StatusMessage> : null}
      <JobProgress job={job} />

      <section className="card stack">
        <div className="image-grid">
          {project.slides.map((slide) => (
            <div className="image-card" key={slide.slide_no}>
              <div className="image-card-header">
                <strong>第{slide.slide_no}页</strong>
                <span className="muted">{slide.title}</span>
              </div>
              <div className="image-card-body">
                {slide.image_url && !generatingSlides.includes(slide.slide_no) ? (
                  <img
                    src={slide.image_url}
                    alt={`第${slide.slide_no}页`}
                    className="image-thumbnail"
                    onClick={() => { const idx = galleryImages.findIndex((g) => g.src === slide.image_url); setLightboxIndex(idx >= 0 ? idx : 0); }}
                  />
                ) : generatingSlides.includes(slide.slide_no) ? (
                  <div className="image-placeholder generating" />
                ) : (
                  <div className="image-placeholder">
                    <span className="muted">{slide.prompt ? '待生成' : '无 Prompt'}</span>
                  </div>
                )}
              </div>
              <div className="image-card-footer">
                <p className="image-prompt-preview">{slide.prompt ? `${slide.prompt.slice(0, 80)}...` : '—'}</p>
                {!busy && slide.prompt ? (
                  retryingSlide === slide.slide_no ? (
                    <div className="retry-input-row">
                      <input
                        type="text"
                        className="retry-input"
                        placeholder="输入改进要求（可选）"
                        value={retryPrompt}
                        onChange={(e) => setRetryPrompt(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleRetrySlide(slide.slide_no); }}
                      />
                      <button type="button" className="small" onClick={() => handleRetrySlide(slide.slide_no)}>确认</button>
                      <button type="button" className="secondary small" onClick={() => { setRetryingSlide(null); setRetryPrompt(''); }}>取消</button>
                    </div>
                  ) : (
                    <button type="button" className="secondary small" onClick={() => setRetryingSlide(slide.slide_no)}>
                      {slide.image_url ? '重新生成' : '生成'}
                    </button>
                  )
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </section>

      {lightboxIndex !== null ? (
        <ImageLightbox images={galleryImages} initialIndex={lightboxIndex} onClose={() => setLightboxIndex(null)} />
      ) : null}
    </main>
  );
}
