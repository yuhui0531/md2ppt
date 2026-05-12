import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getProject } from '../api/projects';
import { generateImages, exportPptx } from '../api/imageGeneration';
import { getJob } from '../api/generation';
import { ImageLightbox } from '../components/ImageLightbox';
import type { GalleryImage } from '../components/ImageLightbox';
import { JobProgress } from '../components/JobProgress';
import { MarkdownPreview } from '../components/MarkdownPreview';
import { useProjectStore } from '../store/projectStore';
import type { JobResponse } from '../types/api';

import { Card, Col, Row, Typography, Button, Space, Spin, Input, Alert, Modal } from 'antd';
import { PictureOutlined, DownloadOutlined, LeftOutlined, SyncOutlined, EyeOutlined } from '@ant-design/icons';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

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
  const [viewPromptSlide, setViewPromptSlide] = useState<number | null>(null);

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
      const finalJob = await pollAndRefresh(createdJob.job_id);
      if (finalJob.error) {
        setMessage({ kind: 'error', text: `批量生图存在失败：${finalJob.error}` });
      } else {
        setMessage({ kind: 'success', text: '批量生图完成' });
      }
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
      const finalJob = await pollAndRefresh(createdJob.job_id);
      if (finalJob.error) {
        setMessage({ kind: 'error', text: `第${slideNo}页重试失败：${finalJob.error}` });
      } else {
        setMessage({ kind: 'success', text: `第${slideNo}页重新生图完成` });
      }
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

  async function pollAndRefresh(jobId: string): Promise<JobResponse> {
    while (true) {
      await new Promise((resolve) => window.setTimeout(resolve, 2000));
      const latest = await getJob(jobId);
      setJob(latest);
      if (project) {
        const updated = await getProject(project.project_id);
        setProject(updated);
      }
      if (latest.status === 'completed') return latest;
      if (latest.status === 'failed') throw new Error(latest.error || '生图失败');
      if (latest.status === 'cancelled') throw new Error('任务已取消');
    }
  }

  if (!project || project.project_id !== projectId) {
    return <main className="admin-page" style={{ padding: 24, textAlign: 'center' }}><Spin size="large" tip="正在加载项目..." /></main>;
  }

  const hasAnyPrompt = project.slides.some((s) => s.prompt);

  const galleryImages: GalleryImage[] = project.slides
    .filter((s) => s.image_url)
    .map((s) => ({ src: s.image_url!, alt: `第${s.slide_no}页：${s.title}` }));

  return (
    <Space direction="vertical" size="large" style={{ display: 'flex', maxWidth: 1440, margin: '0 auto' }}>
      <Card bordered={false} style={{ borderRadius: 16, boxShadow: '0 1px 2px rgba(15,23,42,0.04)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <Title level={3} style={{ margin: '0 0 8px' }}>批量生图</Title>
            <Text type="secondary">使用生图模型为每页 Slide 的 Prompt 生成图片</Text>
          </div>
          <Space wrap>
            <Button type="primary" icon={<PictureOutlined />} onClick={handleGenerateAll} disabled={busy || !hasAnyPrompt} loading={busy && generatingSlides.length > 1}>
              {project.slides.some((s) => s.image_url) ? '重新批量生成' : '开始批量生图'}
            </Button>
            <Button icon={<DownloadOutlined />} onClick={handleExportPptx} disabled={busy || !project.slides.some((s) => s.image_url)}>
              下载 PPT
            </Button>
            <Link to={`/workspace/${project.project_id}`}>
              <Button icon={<LeftOutlined />}>返回工作台</Button>
            </Link>
          </Space>
        </div>
      </Card>

      {message && (
        <Alert message={message.text} type={message.kind === 'error' ? 'error' : (message.kind === 'success' ? 'success' : 'info')} showIcon />
      )}
      <JobProgress job={job} />

      <Row gutter={[24, 24]}>
        {project.slides.map((slide) => (
          <Col xs={24} sm={12} lg={8} xl={6} key={slide.slide_no}>
            <Card 
              bordered={true} 
              hoverable
              style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
              bodyStyle={{ padding: 16, flex: 1, display: 'flex', flexDirection: 'column' }}
              className="image-card"
            >
              <div style={{ marginBottom: 12 }}>
                <Text strong style={{ fontSize: 16 }}>第{slide.slide_no}页</Text>
                <br />
                <Text type="secondary" ellipsis={{ tooltip: slide.title }}>{slide.title}</Text>
              </div>
              
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#f5f5f5', borderRadius: 8, overflow: 'hidden', minHeight: 200, marginBottom: 16, position: 'relative' }}>
                {slide.image_url && !generatingSlides.includes(slide.slide_no) ? (
                  <img
                    src={slide.image_url}
                    alt={`第${slide.slide_no}页`}
                    style={{ width: '100%', height: '100%', objectFit: 'contain', cursor: 'pointer' }}
                    onClick={() => { const idx = galleryImages.findIndex((g) => g.src === slide.image_url); setLightboxIndex(idx >= 0 ? idx : 0); }}
                  />
                ) : generatingSlides.includes(slide.slide_no) ? (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', background: 'rgba(255,255,255,0.8)' }}>
                    <Spin size="large" />
                    <Text type="secondary" style={{ marginTop: 12 }}>正在生成...</Text>
                  </div>
                ) : (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                    <Text type="secondary">{slide.prompt ? '待生成' : '无 Prompt'}</Text>
                  </div>
                )}
              </div>
              
              <div style={{ marginTop: 'auto' }}>
                <div style={{ marginBottom: 12, minHeight: 40 }}>
                  <Paragraph type="secondary" ellipsis={{ rows: 2 }} style={{ fontSize: 13, margin: 0 }}>
                    {slide.prompt || '—'}
                  </Paragraph>
                  {slide.prompt && (
                    <Button type="link" size="small" style={{ padding: 0, fontSize: 12 }} icon={<EyeOutlined />} onClick={() => setViewPromptSlide(slide.slide_no)}>查看完整提示词</Button>
                  )}
                </div>
                
                {!busy && slide.prompt ? (
                  retryingSlide === slide.slide_no ? (
                    <Space.Compact style={{ width: '100%' }}>
                      <TextArea
                        autoSize={{ minRows: 1, maxRows: 3 }}
                        placeholder="输入改进要求（可选）"
                        value={retryPrompt}
                        onChange={(e) => setRetryPrompt(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleRetrySlide(slide.slide_no); } }}
                        style={{ fontSize: 13 }}
                      />
                      <Button type="primary" onClick={() => handleRetrySlide(slide.slide_no)}>确认</Button>
                      <Button onClick={() => { setRetryingSlide(null); setRetryPrompt(''); }}>取消</Button>
                    </Space.Compact>
                  ) : (
                    <Button 
                      type="default" 
                      size="small" 
                      icon={<SyncOutlined />} 
                      onClick={() => setRetryingSlide(slide.slide_no)}
                      style={{ width: '100%' }}
                    >
                      {slide.image_url ? '重新生成' : '生成'}
                    </Button>
                  )
                ) : null}
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      {lightboxIndex !== null && (
        <ImageLightbox images={galleryImages} initialIndex={lightboxIndex} onClose={() => setLightboxIndex(null)} />
      )}

      {viewPromptSlide !== null && (
        <Modal
          title={`第${viewPromptSlide}页 提示词`}
          open={true}
          onCancel={() => setViewPromptSlide(null)}
          footer={null}
          width={800}
        >
          <div style={{ maxHeight: '65vh', overflow: 'auto', padding: '16px 0' }}>
            <MarkdownPreview content={project.slides.find(s => s.slide_no === viewPromptSlide)?.prompt || ''} />
          </div>
        </Modal>
      )}
    </Space>
  );
}
