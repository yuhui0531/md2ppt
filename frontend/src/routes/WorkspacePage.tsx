import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  cancelJob,
  checkConsistency,
  deleteSlide,
  generateProject,
  getActiveJob,
  insertSlide,
  regenerateAllPromptsJob,
  regenerateAllSpeechScriptsJob,
  regenerateImportStructure,
  regenerateOneSpeechScriptJob,
  regenerateOutline,
  regeneratePrompts,
  reviseInconsistentPrompts,
  updateSlidePrompt,
  updateSlideSpeechScript,
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
  regenerateImportStructure: 'regenerate-import-structure',
  regenerateAllPrompts: 'regenerate-all-prompts',
  regenerateAllSpeechScripts: 'regenerate-all-speech-scripts',
  regenerateCurrent: 'regenerate-current',
  regenerateCurrentSpeechScript: 'regenerate-current-speech-script',
  checkConsistency: 'check-consistency',
  reviseInconsistent: 'revise-inconsistent',
  reviseInconsistentAll: 'revise-inconsistent-all',
  savePrompt: 'save-prompt',
  saveSpeechScript: 'save-speech-script',
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
  const [draftSpeechScript, setDraftSpeechScript] = useState<string>('');
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
      // 但只有 generation / import_structure_generation 的成功/失败提示才会在这页显示，
      // image_generation 的提示交给生图页处理。
      try {
        // mid-job 周期刷 project：流式阶段后端会逐页落盘，前端轮询 onUpdate 里
        // 每 3 次（~3.6s）拉一次 /projects/{id}，让左侧「页数与大纲」列表行级增长。
        // 计数器放在闭包里，避开改 jobPolling 的签名。
        // in-flight 守卫：pollJobUntilFinished 没 await onUpdate 的返回 Promise，
        // 多次拉的请求可能乱序到达，旧响应覆盖新响应会让 slides 列表往回缩。
        // 如果上一次 getProject 还没回来，本轮直接跳过；下一次 tick 会自然补上。
        let pollCount = 0;
        let refreshInFlight = false;
        const finalJob = await pollJobUntilFinished(active.job_id, async (latest) => {
          if (cancelled) return;
          setJob(latest);
          pollCount += 1;
          if (pollCount % 3 !== 0 || refreshInFlight) return;
          refreshInFlight = true;
          try {
            const fresh = await getProject(projectId);
            if (!cancelled) setProject(fresh);
          } catch {
            // 静默：下一次 poll 还会重试，避免一次网络抖动就在 UI 上弹错误条。
          } finally {
            refreshInFlight = false;
          }
        });
        if (cancelled) return;
        const updated = await getProject(projectId);
        if (cancelled) return;
        setProject(updated);
        if ((active.kind === 'generation' || active.kind === 'import_structure_generation') && !finalJob.error) {
          setMessage({ kind: 'success', text: '已自动接续完成进行中的任务' });
        }
      } catch (error) {
        if (cancelled) return;
        if (active.kind === 'generation' || active.kind === 'import_structure_generation') {
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
  // 当前页只接管工作台内触发的任务进度展示；image_generation 在生图页展示。
  const displayJob = job && (
    job.kind === 'generation'
    || job.kind === 'import_structure_generation'
    || job.kind === 'revise_inconsistent'
    || job.kind === 'prompts_regeneration'
    || job.kind === 'speech_scripts_regeneration'
  ) ? job : null;

  // 选中页变化 / 外部更新该页 prompt 时同步草稿。注意此 effect 必须放在 early return 之前。
  // mount 时自动接续的任务轮询、resumeGeneration 等会在 actionsLocked 之外
  // 落 setProject(updated) —— 若同时用户在编辑当前 slide 的 prompt，不能盖掉 draft。
  // 用 userEditedRef 显式追踪"用户是否输入过"，比"draft !== slide.prompt"可靠
  // （后者在外部 prompt 变化的渲染瞬间会误判为 dirty）。
  const activeSlideObj = project?.slides[activeSlide];
  const userEditedRef = useRef(false);
  const userEditedScriptRef = useRef(false);
  const prevSlideIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const newPrompt = activeSlideObj?.prompt ?? '';
    const newScript = activeSlideObj?.speech_script ?? '';
    const newId = activeSlideObj?.id;
    const switchedSlide = newId !== prevSlideIdRef.current;
    prevSlideIdRef.current = newId;
    if (switchedSlide) {
      // 切 slide：trySwitchActiveSlide 已处理脏稿确认，这里无条件同步。
      setDraftPrompt(newPrompt);
      setDraftSpeechScript(newScript);
      userEditedRef.current = false;
      userEditedScriptRef.current = false;
      return;
    }
    if (!userEditedRef.current) {
      setDraftPrompt(newPrompt);
    }
    if (!userEditedScriptRef.current) {
      setDraftSpeechScript(newScript);
    }
    // 否则同一 slide + 用户已编辑 → 保留 draft，外部更新被静默吞掉。
  }, [activeSlideObj?.id, activeSlideObj?.prompt, activeSlideObj?.speech_script]);

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

  // 修正不一致已转 job：拿到 JobResponse 后挂进度条 + 轮询，完成后拉一次 project。
  // 失败 / 取消的消息按 final job 状态分支，避免轮询里抛错盖掉真实结果。
  async function runReviseJob(slideNumbers: number[] | undefined, busyKey: string, successText: string) {
    if (!project) return;
    const startedFor = project.project_id;
    setBusy(busyKey);
    setMessage(null);
    setJob(null);
    try {
      const createdJob = await reviseInconsistentPrompts(
        startedFor,
        project.generation_options.consistency_threshold,
        slideNumbers,
      );
      if (!stillScoped(startedFor)) return;
      setJob(createdJob);
      const finalJob = await pollJobUntilFinished(createdJob.job_id, (latest) => {
        if (stillScoped(startedFor)) setJob(latest);
      });
      if (!stillScoped(startedFor)) return;
      const updated = await getProject(startedFor);
      if (!stillScoped(startedFor)) return;
      setProject(updated);
      if (finalJob.status === 'cancelled') {
        setMessage({
          kind: 'info',
          text: '已取消修正；已完成轮次的 prompt 修改已保留，但一致性报告可能未刷新到最新状态。',
        });
      } else if (finalJob.status === 'failed') {
        setMessage({ kind: 'error', text: finalJob.error || '修正失败' });
      } else if ((finalJob.stage ?? '').endsWith('no_inconsistent')) {
        // 短路 return：service emit 「全部页面已达标，无需修正」。前端单独走分支
        // 避免显示用户传入的「已尝试修正 N 个不一致页」——race 下 N 来自陈旧的快照。
        // 用 endsWith 兼容 preflight stage_prefix 变体。
        setMessage({ kind: 'info', text: '全部页面已达标，无需修正。' });
      } else {
        setMessage({ kind: 'success', text: successText });
      }
    } catch (error) {
      if (!stillScoped(startedFor)) return;
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : '修正失败' });
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
      let pollCount = 0;
      let refreshInFlight = false;
      await pollJobUntilFinished(createdJob.job_id, async (latest) => {
        if (!stillScoped(startedFor)) return;
        setJob(latest);
        pollCount += 1;
        if (pollCount % 3 !== 0 || refreshInFlight) return;
        refreshInFlight = true;
        try {
          const fresh = await getProject(startedFor);
          if (stillScoped(startedFor)) setProject(fresh);
        } catch {
          // 同 mount effect：静默单次失败。
        } finally {
          refreshInFlight = false;
        }
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
  const isImported = project.project_origin === 'imported_prompts';
  const canResume = !isImported && !['consistency_checked', 'revised'].includes(project.generation_state);
  const isPromptDirty = slide ? draftPrompt !== slide.prompt : false;
  const isScriptDirty = slide ? draftSpeechScript !== (slide.speech_script ?? '') : false;
  const currentDraftDirty = detailView === 'speech_script' ? isScriptDirty : isPromptDirty;
  const isDirty = isPromptDirty || isScriptDirty;
  const importJobRunning = jobRunning && job?.kind === 'import_structure_generation';
  const promptsRegenJobRunning = jobRunning && job?.kind === 'prompts_regeneration';
  const speechScriptsRegenJobRunning = jobRunning && job?.kind === 'speech_scripts_regeneration';
  // 任意 job 在跑都禁止写 ProjectData——update_slide_prompt 是"读整份→改一项→整包写"，
  // 与 worker 整包写之间会发生 lost update。在做到细粒度更新前，所有 mutation 都收紧。
  const mutationDisabled = busy !== null || jobRunning;
  // 任何会切换/重写 slide 的操作都不能在脏稿态下进行——否则 useEffect 重置
  // draftPrompt 会让用户的编辑无声丢失。检查一致性仅打分不动 prompt，例外。
  const actionsLocked = mutationDisabled || isDirty;
  // 当前页是否仍在一致性报告里被标为需要修正。未跑过检查、当前页已达标都返回 false，
  // 据此禁用「修正当前页」按钮，避免空转 LLM 调用。
  // 阈值用项目当前设置而非报告快照，与「修正不一致」调用时传给后端的 threshold
  // 保持一致——避免用户改阈值后前端 disabled 判断与后端实际过滤集合错位。
  const consistencyThreshold = project.generation_options.consistency_threshold;
  const currentSlideReport = slide && project.consistency_report
    ? project.consistency_report.slides.find((item) => item.slide_no === slide.slide_no)
    : undefined;
  const currentSlideNeedsRevision = currentSlideReport
    ? currentSlideReport.revision_needed || currentSlideReport.score < consistencyThreshold
    : false;
  // 全部待修正页数：批量按钮的 disabled 与 Popconfirm 文案都依赖它。
  const inconsistentSlideCount = project.consistency_report
    ? project.consistency_report.slides.filter(
        (item) => item.revision_needed || item.score < consistencyThreshold,
      ).length
    : 0;

  function trySwitchActiveSlide(nextIndex: number) {
    if (nextIndex === activeSlide) return;
    if (!isDirty) {
      setActiveSlide(nextIndex);
      return;
    }
    Modal.confirm({
      title: '当前页有未保存的修改',
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

  async function handleSaveSpeechScript() {
    if (!project || !slide) return;
    const targetSlideId = slide.id;
    await refreshWith(async () => {
      const updated = await updateSlideSpeechScript(project.project_id, targetSlideId, draftSpeechScript);
      const idx = updated.slides.findIndex((s) => s.id === targetSlideId);
      if (idx >= 0) setActiveSlide(idx);
      userEditedScriptRef.current = false;
      return updated;
    }, BUSY.saveSpeechScript, '已保存讲解稿');
  }

  function handleSaveCurrentDraft() {
    if (detailView === 'speech_script') {
      void handleSaveSpeechScript();
      return;
    }
    void handleSavePrompt();
  }

  function handleDiscardDraft() {
    if (detailView === 'speech_script') {
      setDraftSpeechScript(slide?.speech_script ?? '');
      userEditedScriptRef.current = false;
      return;
    }
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
    // 与 handleRegenerateImportStructure 同款 job-poll：service 内部逐页落盘
    // （persist_streaming_slide），所以每 3 次 tick 回拉一次 project 让 prompt
    // 文本流式出现；最后再拉一次拿最终 generation_state。
    if (jobRunning) return;
    const startedFor = project.project_id;
    setBusy(BUSY.regenerateAllPrompts);
    setMessage(null);
    setJob(null);
    try {
      const createdJob = await regenerateAllPromptsJob(startedFor);
      if (!stillScoped(startedFor)) return;
      setJob(createdJob);
      let pollCount = 0;
      let refreshInFlight = false;
      await pollJobUntilFinished(createdJob.job_id, async (latest) => {
        if (!stillScoped(startedFor)) return;
        setJob(latest);
        pollCount += 1;
        if (pollCount % 3 !== 0 || refreshInFlight) return;
        refreshInFlight = true;
        try {
          const fresh = await getProject(startedFor);
          if (stillScoped(startedFor)) setProject(fresh);
        } catch {
          // 与 mount effect 一致：静默单次失败。
        } finally {
          refreshInFlight = false;
        }
      });
      if (!stillScoped(startedFor)) return;
      const updated = await getProject(startedFor);
      if (!stillScoped(startedFor)) return;
      setProject(updated);
      setMessage({ kind: 'success', text: '已重新生成全部 prompt' });
    } catch (error) {
      if (!stillScoped(startedFor)) return;
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : '重新生成失败' });
    } finally {
      if (stillScoped(startedFor)) setBusy(null);
    }
  }

  async function runSpeechScriptJob(createJob: () => Promise<JobResponse>, busyKey: string, successText: string) {
    if (!project) return;
    if (jobRunning) return;
    const startedFor = project.project_id;
    setBusy(busyKey);
    setMessage(null);
    setJob(null);
    try {
      const createdJob = await createJob();
      if (!stillScoped(startedFor)) return;
      setJob(createdJob);
      let pollCount = 0;
      let refreshInFlight = false;
      await pollJobUntilFinished(createdJob.job_id, async (latest) => {
        if (!stillScoped(startedFor)) return;
        setJob(latest);
        pollCount += 1;
        if (pollCount % 3 !== 0 || refreshInFlight) return;
        refreshInFlight = true;
        try {
          const fresh = await getProject(startedFor);
          if (stillScoped(startedFor)) setProject(fresh);
        } catch {
          // 与 prompt 重生成一致：静默单次失败。
        } finally {
          refreshInFlight = false;
        }
      });
      if (!stillScoped(startedFor)) return;
      const updated = await getProject(startedFor);
      if (!stillScoped(startedFor)) return;
      setProject(updated);
      userEditedScriptRef.current = false;
      setMessage({ kind: 'success', text: successText });
    } catch (error) {
      if (!stillScoped(startedFor)) return;
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : '讲解稿重生成失败' });
    } finally {
      if (stillScoped(startedFor)) setBusy(null);
    }
  }

  function handleRegenerateCurrentSpeechScript() {
    if (!project || !slide) return;
    const slideNo = slide.slide_no;
    void runSpeechScriptJob(
      () => regenerateOneSpeechScriptJob(project.project_id, slideNo),
      BUSY.regenerateCurrentSpeechScript,
      `第 ${slideNo} 页讲解稿已重新生成`,
    );
  }

  function handleRegenerateAllSpeechScripts() {
    if (!project) return;
    void runSpeechScriptJob(
      () => regenerateAllSpeechScriptsJob(project.project_id),
      BUSY.regenerateAllSpeechScripts,
      '已重新生成全部讲解稿',
    );
  }

  async function handleRegenerateImportStructure() {
    if (!project) return;
    if (jobRunning) return;
    const startedFor = project.project_id;
    setBusy(BUSY.regenerateImportStructure);
    setMessage(null);
    setJob(null);
    try {
      const createdJob = await regenerateImportStructure(startedFor);
      if (!stillScoped(startedFor)) return;
      setJob(createdJob);
      let pollCount = 0;
      let refreshInFlight = false;
      await pollJobUntilFinished(createdJob.job_id, async (latest) => {
        if (!stillScoped(startedFor)) return;
        setJob(latest);
        pollCount += 1;
        if (pollCount % 3 !== 0 || refreshInFlight) return;
        refreshInFlight = true;
        try {
          const fresh = await getProject(startedFor);
          if (stillScoped(startedFor)) setProject(fresh);
        } catch {
          // 同 mount effect：静默单次失败。
        } finally {
          refreshInFlight = false;
        }
      });
      if (!stillScoped(startedFor)) return;
      const updated = await getProject(startedFor);
      if (!stillScoped(startedFor)) return;
      setProject(updated);
      setMessage({ kind: 'success', text: '页面结构已重新解析' });
    } catch (error) {
      if (!stillScoped(startedFor)) return;
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : '重新解析页面结构失败' });
    } finally {
      if (stillScoped(startedFor)) setBusy(null);
    }
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
      <Card bordered={false} style={{ borderRadius: 0, boxShadow: '0 1px 2px rgba(15,23,42,0.04)', position: 'sticky', top: -24, zIndex: 10 }}>
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
            {isImported ? (
              <Popconfirm
                title="重新解析页面结构"
                description="会基于当前 prompt 重新提取结构化字段（页面类型、版式建议、核心信息等），不会改写 prompt 正文。已有的一致性检查报告会被清空，下次进入生图前会重新检查。"
                okText="确定重新解析"
                cancelText="取消"
                // 不能直接传 async handler：Popconfirm 看到 onConfirm 返回 Promise
                // 会 await 才关弹窗，期间持续显示「确定」按钮的转圈，与底部进度
                // 条/loading 视觉重复。包一层让 onConfirm 立即返回 void。
                onConfirm={() => { void handleRegenerateImportStructure(); }}
                disabled={actionsLocked}
              >
                <Button
                  icon={<ReloadOutlined />}
                  disabled={actionsLocked}
                  loading={busy === BUSY.regenerateImportStructure || importJobRunning}
                >
                  {importJobRunning ? '结构补全中…' : '重新解析页面结构'}
                </Button>
              </Popconfirm>
            ) : (
              <>
                <Popconfirm
                  title="重新生成整份大纲"
                  description="会按推荐页数让大模型重写所有页，丢弃当前的手动编辑（含新增/删除）。确定继续？"
                  okText="确定重生成"
                  cancelText="取消"
                  // 同 866：onConfirm 返回 Promise 会让弹框等到 handler 跑完才关。
                  onConfirm={() => { void handleRegenerateOutline(); }}
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
                  // 同 866：onConfirm 返回 Promise 会让弹框转圈直到 handler 跑完。
                  onConfirm={() => { void handleRegenerateAllPrompts(); }}
                  disabled={actionsLocked}
                >
                  <Button
                    icon={<SyncOutlined />}
                    disabled={actionsLocked}
                    loading={busy === BUSY.regenerateAllPrompts || promptsRegenJobRunning}
                  >
                    {promptsRegenJobRunning ? '重生成中…' : '重新生成全部 prompt'}
                  </Button>
                </Popconfirm>
                <Popconfirm
                  title="重新生成全部讲解稿"
                  description="会按当前大纲重写所有页的讲解稿，覆盖你手动编辑过的讲解稿。确定继续？"
                  okText="确定重生成"
                  cancelText="取消"
                  onConfirm={handleRegenerateAllSpeechScripts}
                  disabled={actionsLocked}
                >
                  <Button
                    icon={<SyncOutlined />}
                    disabled={actionsLocked}
                    loading={busy === BUSY.regenerateAllSpeechScripts || speechScriptsRegenJobRunning}
                  >
                    {speechScriptsRegenJobRunning ? '讲解稿重生成中…' : '重新生成全部讲解稿'}
                  </Button>
                </Popconfirm>
              </>
            )}
            {(() => {
              const hasImages = project.slides.some((s) => s.image_url);
              const navDisabled = busy !== null || jobRunning;
              // 只要 image_generation job 在跑就允许回生图页，不再要求 hasImages：
              // 旧逻辑下用户在生图刚启动还没出第一张图时回工作台会被锁住，
              // 但这正是用户最需要回去看进度的时机。
              const imageJobRunning = jobRunning && job?.kind === 'image_generation';
              // 脏稿态下离开当前页会卸载组件让 draft 丢失，封死导航。
              const imagesNavDisabled = (navDisabled && !imageJobRunning) || isDirty;
              const exportNavDisabled = navDisabled || isDirty;
              const imagesLabel = imageJobRunning
                ? '查看生图进度'
                : hasImages
                  ? '查看图片'
                  : '下一步：准备生图';
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
      {/* Prompt / speech script regeneration jobs are cancelable; generation/import stay non-cancelable here. */}
      <JobProgress
        job={displayJob}
        onCancel={
          displayJob?.status === 'running'
          && ['revise_inconsistent', 'prompts_regeneration', 'speech_scripts_regeneration'].includes(displayJob.kind)
            ? async () => {
                try {
                  await cancelJob(displayJob.job_id);
                } catch (error) {
                  // 取消请求失败不阻断轮询——下次拉到真实 status 会反映出来。
                  // 仅给用户一个提示，避免「点了没反应」的困惑。
                  setMessage({
                    kind: 'error',
                    text: error instanceof Error ? error.message : '取消请求失败，请稍后再试',
                  });
                }
              }
            : undefined
        }
      />
      {isImported && importJobRunning && (
        <Alert
          type="info"
          showIcon
          message="正在根据导入提示词补全页面结构与大纲信息，完成后即可使用完整精调能力。"
          description="任务进行中工作台为只读：prompt 编辑、新增/删除页、一致性检查等会写数据的操作都需等任务结束后再用。任务通常 1 分钟内完成。"
        />
      )}

      {/* 素材结构 - collapsible, shows ALL sections when expanded */}
      {!isImported && project.parsed_sections.length > 0 && (
        <Collapse
        bordered={false}
        style={{ borderRadius: 0, boxShadow: '0 1px 2px rgba(15,23,42,0.04)', background: '#fff' }}
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
                  <div style={{ background: '#f8fafc', padding: 12, borderRadius: 0, border: '1px solid #e2e8f0', height: '100%' }}>
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
      )}

      {/* Main work area: page list | details/prompt | consistency, aligned at top */}
      <Row gutter={[24, 24]} align="stretch">
        <Col xs={24} lg={7} style={{ display: 'flex' }}>
          <Card
            title={<><span style={{ marginRight: 8 }}>页数与大纲</span>{renderSlideCountTag(project.slides.length, displayJob)}</>}
            bordered={false}
            style={{ borderRadius: 0, boxShadow: '0 1px 2px rgba(15,23,42,0.04)', width: '100%', display: 'flex', flexDirection: 'column' }}
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
                  onDelete={() => { void handleDeleteSlide(item.id); }}
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
            style={{ borderRadius: 0, boxShadow: '0 1px 2px rgba(15,23,42,0.04)', width: '100%', display: 'flex', flexDirection: 'column' }}
            bodyStyle={{ padding: 24, display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 180px)', overflow: 'hidden' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12 }}>
              <Title level={4} style={{ margin: 0 }}>{slide ? getCurrentSlideHeading(slide) : '当前页详情'}</Title>
              <Space>
                {currentDraftDirty && (
                  <>
                    <Button
                      type="primary"
                      disabled={!slide || mutationDisabled}
                      loading={busy === (detailView === 'speech_script' ? BUSY.saveSpeechScript : BUSY.savePrompt)}
                      onClick={handleSaveCurrentDraft}
                    >
                      {detailView === 'speech_script' ? '保存讲解稿' : '保存修改'}
                    </Button>
                    <Button
                      disabled={!slide || busy !== null}
                      onClick={handleDiscardDraft}
                    >
                      撤销修改
                    </Button>
                  </>
                )}
                {!isImported && detailView === 'speech_script' ? (
                  <Button
                    icon={<SyncOutlined />}
                    disabled={!slide || mutationDisabled || isDirty}
                    loading={busy === BUSY.regenerateCurrentSpeechScript || speechScriptsRegenJobRunning}
                    onClick={handleRegenerateCurrentSpeechScript}
                  >
                    重生成讲解稿
                  </Button>
                ) : !isImported && (
                  <Button
                    icon={<SyncOutlined />}
                    disabled={!slide || mutationDisabled || isDirty}
                    loading={busy === BUSY.regenerateCurrent}
                    onClick={() => refreshWith(() => regeneratePrompts(project.project_id, [slide!.slide_no]), BUSY.regenerateCurrent, '已重新生成当前页 prompt')}
                  >
                    重生成当前页
                  </Button>
                )}
              </Space>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <Title level={5} style={{ margin: 0 }}>当前页工作区</Title>
                <Text type="secondary" style={{ fontSize: 12 }}>Prompt、讲解稿与预览切换查看</Text>
              </div>
              <Tabs
                activeKey={detailView}
                onChange={setDetailView}
                items={[
                  { key: 'prompt', label: 'Prompt' },
                  { key: 'speech_script', label: '讲解稿' },
                  { key: 'preview', label: '预览' },
                ]}
                style={{ marginBottom: 0 }}
              />
            </div>

            <div style={{ flex: 1, minHeight: 520, background: '#f8fafc', borderRadius: 0, border: '1px solid #e2e8f0', padding: detailView === 'prompt' || detailView === 'speech_script' ? 0 : 16, overflow: 'auto' }}>
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
              {detailView === 'speech_script' && (
                <TextArea
                  value={draftSpeechScript}
                  onChange={(e) => {
                    const value = e.target.value;
                    setDraftSpeechScript(value);
                    userEditedScriptRef.current = value !== (slide?.speech_script ?? '');
                  }}
                  disabled={!slide || mutationDisabled}
                  placeholder="讲解稿生成中…"
                  style={{
                    height: '100%',
                    minHeight: 520,
                    resize: 'none',
                    border: 'none',
                    background: 'transparent',
                    padding: 16,
                    fontFamily: 'inherit',
                    fontSize: 14,
                    lineHeight: 1.8,
                  }}
                />
              )}
              {detailView === 'preview' && <MarkdownPreview content={draftPrompt} />}
              {detailView === 'detail' && slide && (
                <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                  {slideMetaItems.length > 0 && (
                    <Row gutter={[12, 12]}>
                      {slideMetaItems.map((item) => (
                        <Col key={item.label} xs={12} sm={8}>
                          <div style={{ background: '#fff', padding: '8px 12px', borderRadius: 0, border: '1px solid #e2e8f0' }}>
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
            style={{ borderRadius: 0, boxShadow: '0 1px 2px rgba(15,23,42,0.04)', width: '100%', display: 'flex', flexDirection: 'column' }}
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
                disabled={actionsLocked || !slide || !currentSlideNeedsRevision}
                loading={busy === BUSY.reviseInconsistent}
                onClick={() => runReviseJob(
                  [slide!.slide_no],
                  BUSY.reviseInconsistent,
                  `第 ${slide!.slide_no} 页已修正`,
                )}
              >
                修正当前页
              </Button>
              <Popconfirm
                title="修正全部不一致页"
                description={`将对 ${inconsistentSlideCount} 个不达标页调用 LLM 改写 prompt，耗时可能较长。`}
                okText="确定修正"
                cancelText="取消"
                disabled={actionsLocked || inconsistentSlideCount === 0}
                onConfirm={() => {
                  // 不能 return runReviseJob 的 Promise：antd Popconfirm 看到
                  // onConfirm 返回 Promise 会 await 它才关弹窗，而 runReviseJob
                  // 要轮询整个 job 完成（几十秒）。fire-and-forget 让弹窗立即关，
                  // 进度由 JobProgress 接管。
                  void runReviseJob(
                    undefined,
                    BUSY.reviseInconsistentAll,
                    `已尝试修正 ${inconsistentSlideCount} 个不一致页，结果以一致性报告为准`,
                  );
                }}
              >
                <Button
                  block
                  type="primary"
                  ghost
                  disabled={actionsLocked || inconsistentSlideCount === 0}
                  loading={busy === BUSY.reviseInconsistentAll}
                >
                  修正全部不一致{inconsistentSlideCount > 0 ? `（${inconsistentSlideCount}）` : ''}
                </Button>
              </Popconfirm>
            </Space>

            <ConsistencyReportView report={project.consistency_report} />
          </Card>
        </Col>
      </Row>

      {/* Bottom Area: Style Guide */}
      <Card
        title="统一视觉规范"
        bordered={false}
        style={{ borderRadius: 0, boxShadow: '0 1px 2px rgba(15,23,42,0.04)', marginTop: 8 }}
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

// 流式阶段：generation / import_structure_generation 在跑且后端写了 total_slides 时，
// 显示「生成中 N/total 页」让用户感知逐页落盘的节奏。
// revise_inconsistent 不参与（不改变 slide 数量），其它 kind 兜底走静态计数。
function renderSlideCountTag(slideCount: number, displayJob: JobResponse | null) {
  const streamingKind = displayJob?.kind === 'generation'
    || displayJob?.kind === 'import_structure_generation'
    || displayJob?.kind === 'prompts_regeneration'
    || displayJob?.kind === 'speech_scripts_regeneration';
  const isRunning = displayJob?.status === 'running';
  const total = displayJob?.total_slides;
  if (streamingKind && isRunning && typeof total === 'number' && total > 0) {
    const done = displayJob?.completed_slides ?? 0;
    return <Tag bordered={false} color="processing">生成中 {done}/{total} 页</Tag>;
  }
  return <Tag bordered={false}>共 {slideCount} 页</Tag>;
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
