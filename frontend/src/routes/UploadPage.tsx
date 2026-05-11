import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createProject } from '../api/projects';
import { generateProject } from '../api/generation';
import { FormField } from '../components/FormField';
import { JobProgress } from '../components/JobProgress';
import { MarkdownPreview } from '../components/MarkdownPreview';
import { StatusMessage } from '../components/StatusMessage';
import type { GenerationOptions, JobResponse, SlideCountMode } from '../types/api';
import { pollJobUntilFinished } from '../utils/jobPolling';

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
  const [view, setView] = useState<'source' | 'preview'>('source');
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<JobResponse | null>(null);
  const [message, setMessage] = useState<{ kind: 'info' | 'success' | 'error'; text: string } | null>(null);
  const [resumableProjectId, setResumableProjectId] = useState<string | null>(null);

  const canSubmit = useMemo(() => content.trim().length > 0 && !busy, [content, busy]);

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFilename(file.name);
    setContent(await file.text());
  }

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
    setMessage(null);
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
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : '创建项目或生成失败' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="admin-page stack">
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">New Project</p>
          <h2>新建项目</h2>
          <p>上传 Markdown 原始素材，生成结构化 PPT Prompt 项目，并直接衔接到工作台继续处理。</p>
        </div>
      </section>

      <section className="card stack panel-shell">
        <div className="section-head">
          <div>
            <h2>上传 Markdown 原始素材</h2>
            <p className="muted">Markdown 会作为待分析素材处理，不会被机械按标题拆成 PPT 页面。</p>
          </div>
        </div>
        {message ? <StatusMessage kind={message.kind}>{message.text}</StatusMessage> : null}
        <JobProgress job={job} />
        <div className="grid two">
          <FormField label="Markdown 文件">
            <input type="file" accept=".md,.markdown,text/markdown,text/plain" onChange={handleFile} />
          </FormField>
          <FormField label="目标语言">
            <select value={language} onChange={(event) => setLanguage(event.target.value)}>
              <option value="zh-CN">中文</option>
              <option value="en-US">English</option>
            </select>
          </FormField>
        </div>
      </section>

      <section className="grid two stretch">
        <div className="card stack panel-shell">
          <div className="tabs">
            <button type="button" className={view === 'source' ? 'active' : ''} onClick={() => setView('source')}>源码</button>
            <button type="button" className={view === 'preview' ? 'active' : ''} onClick={() => setView('preview')}>预览</button>
          </div>
          {view === 'source' ? (
            <textarea className="editor tall" value={content} onChange={(event) => setContent(event.target.value)} placeholder="# 粘贴 Markdown 原始素材..." />
          ) : (
            <MarkdownPreview content={content} />
          )}
        </div>

        <div className="card stack panel-shell">
          <FormField label="受众类型">
            <input value={audience} onChange={(event) => setAudience(event.target.value)} />
          </FormField>
          <FormField label="演示场景">
            <input value={reportScenario} onChange={(event) => setReportScenario(event.target.value)} />
          </FormField>
          <FormField label="目标生图工具">
            <select value={targetImageTool} onChange={(event) => setTargetImageTool(event.target.value)}>
              <option value="generic">通用提示词</option>
              <option value="midjourney">Midjourney</option>
              <option value="sdxl-flux">SDXL / Flux</option>
              <option value="gpt-image">DALL·E / GPT Image</option>
              <option value="chinese-tools">即梦 / 通义万相 / 可灵</option>
            </select>
          </FormField>
          <FormField label="页数模式">
            <select value={slideCountMode} onChange={(event) => setSlideCountMode(event.target.value as SlideCountMode)}>
              <option value="auto">自动推荐</option>
              <option value="fixed">固定页数</option>
              <option value="range">页数范围</option>
            </select>
          </FormField>
          {slideCountMode === 'fixed' ? (
            <FormField label="固定页数">
              <input type="number" min="1" value={requestedSlideCount} onChange={(event) => setRequestedSlideCount(Number(event.target.value))} />
            </FormField>
          ) : null}
          {slideCountMode === 'range' ? (
            <div className="grid two">
              <FormField label="最少页数">
                <input type="number" min="1" value={rangeMin} onChange={(event) => setRangeMin(Number(event.target.value))} />
              </FormField>
              <FormField label="最多页数">
                <input type="number" min="1" value={rangeMax} onChange={(event) => setRangeMax(Number(event.target.value))} />
              </FormField>
            </div>
          ) : null}
          <div className="actions">
            <button type="button" onClick={handleSubmit} disabled={!canSubmit}>{busy ? '生成中...' : '开始生成'}</button>
            {resumableProjectId ? (
              <button type="button" className="secondary" onClick={() => navigate(`/workspace/${resumableProjectId}`)}>
                前往工作台继续生成
              </button>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}
