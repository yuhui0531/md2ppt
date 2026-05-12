import React, { useEffect, useMemo, useState } from 'react';
import { StatusMessage } from '../components/StatusMessage';
import { getModelConfig, getImageModelConfig, listModels, saveModelConfig, saveImageModelConfig, testGeneration, testImageGeneration } from '../api/modelConfig';
import type { ModelInfo } from '../types/api';

import { Card, Col, Row, Typography, Input, InputNumber, Select, Button, Space, Form, Alert } from 'antd';
import { ApiOutlined, PictureOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;

export function ModelConfigPage() {
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [temperature, setTemperature] = useState(0.4);
  const [maxTokens, setMaxTokens] = useState(8192);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [tested, setTested] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'info' | 'success' | 'error'; text: string } | null>(null);

  const canFetchModels = useMemo(() => baseUrl.trim() && apiKey.trim(), [baseUrl, apiKey]);
  const canTest = useMemo(() => canFetchModels && selectedModel, [canFetchModels, selectedModel]);
  const canSave = useMemo(() => canTest && tested, [canTest, tested]);

  // Image config state
  const [imgBaseUrl, setImgBaseUrl] = useState('');
  const [imgApiKey, setImgApiKey] = useState('');
  const [imgSelectedModel, setImgSelectedModel] = useState('');
  const [imgSize, setImgSize] = useState('2048x1152');
  const [imgQuality, setImgQuality] = useState('hd');
  const [imgModels, setImgModels] = useState<ModelInfo[]>([]);
  const [imgTested, setImgTested] = useState(false);
  const [imgBusy, setImgBusy] = useState<string | null>(null);
  const [imgMessage, setImgMessage] = useState<{ kind: 'info' | 'success' | 'error'; text: string } | null>(null);

  const canFetchImgModels = useMemo(() => imgBaseUrl.trim() && imgApiKey.trim(), [imgBaseUrl, imgApiKey]);
  const canTestImg = useMemo(() => canFetchImgModels && imgSelectedModel, [canFetchImgModels, imgSelectedModel]);
  const canSaveImg = useMemo(() => canTestImg && imgTested, [canTestImg, imgTested]);

  useEffect(() => {
    getModelConfig()
      .then((config) => {
        if (!config.configured) return;
        setBaseUrl(config.base_url ?? '');
        setSelectedModel(config.selected_model ?? '');
        setTemperature(config.temperature ?? 0.4);
        setMaxTokens(config.max_tokens ?? 8192);
        setMessage({ kind: 'info', text: '已加载现有模型配置；如需修改，请重新填写 API Key 并测试。' });
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    getImageModelConfig()
      .then((config) => {
        if (!config.configured) return;
        setImgBaseUrl(config.base_url ?? '');
        setImgSelectedModel(config.selected_model ?? '');
        setImgSize(config.image_size ?? '2048x1152');
        setImgQuality(config.image_quality ?? 'hd');
        setImgMessage({ kind: 'info', text: '已加载现有生图模型配置；如需修改，请重新填写 API Key 并测试。' });
      })
      .catch(() => undefined);
  }, []);

  async function handleListModels() {
    setBusy('models');
    setMessage(null);
    setTested(false);
    try {
      const result = await listModels({ base_url: baseUrl.trim(), api_key: apiKey.trim(), models_endpoint: '/v1/models' });
      setModels(result);
      setSelectedModel(result[0]?.id ?? '');
      setMessage({ kind: 'success', text: `获取到 ${result.length} 个模型。` });
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : '获取模型列表失败' });
    } finally {
      setBusy(null);
    }
  }

  async function handleTestGeneration() {
    setBusy('test');
    setMessage(null);
    setTested(false);
    try {
      await testGeneration({
        base_url: baseUrl.trim(),
        api_key: apiKey.trim(),
        model: selectedModel,
        generation_endpoint_type: 'chat_completions',
      });
      setTested(true);
      setMessage({ kind: 'success', text: '最小生成测试通过，可以保存配置。' });
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : '生成测试失败' });
    } finally {
      setBusy(null);
    }
  }

  async function handleSave() {
    setBusy('save');
    setMessage(null);
    try {
      await saveModelConfig({
        base_url: baseUrl.trim(),
        api_key: apiKey.trim(),
        selected_model: selectedModel,
        temperature,
        max_tokens: maxTokens,
        generation_endpoint_type: 'chat_completions',
      });
      setMessage({ kind: 'success', text: '模型配置已保存，后续新项目会自动复用这套配置。' });
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : '保存配置失败' });
    } finally {
      setBusy(null);
    }
  }

  async function handleListImgModels() {
    setImgBusy('models');
    setImgMessage(null);
    setImgTested(false);
    try {
      const result = await listModels({ base_url: imgBaseUrl.trim(), api_key: imgApiKey.trim(), models_endpoint: '/v1/models' });
      setImgModels(result);
      setImgSelectedModel(result[0]?.id ?? '');
      setImgMessage({ kind: 'success', text: `获取到 ${result.length} 个模型。` });
    } catch (error) {
      setImgMessage({ kind: 'error', text: error instanceof Error ? error.message : '获取模型列表失败' });
    } finally {
      setImgBusy(null);
    }
  }

  async function handleTestImageGeneration() {
    setImgBusy('test');
    setImgMessage(null);
    setImgTested(false);
    try {
      await testImageGeneration({
        base_url: imgBaseUrl.trim(),
        api_key: imgApiKey.trim(),
        model: imgSelectedModel,
        image_size: imgSize,
        image_quality: imgQuality,
      });
      setImgTested(true);
      setImgMessage({ kind: 'success', text: '生图测试通过，可以保存配置。' });
    } catch (error) {
      setImgMessage({ kind: 'error', text: error instanceof Error ? error.message : '生图测试失败' });
    } finally {
      setImgBusy(null);
    }
  }

  async function handleSaveImageConfig() {
    setImgBusy('save');
    setImgMessage(null);
    try {
      await saveImageModelConfig({
        base_url: imgBaseUrl.trim(),
        api_key: imgApiKey.trim(),
        selected_model: imgSelectedModel,
        image_size: imgSize,
        image_quality: imgQuality,
      });
      setImgMessage({ kind: 'success', text: '生图模型配置已保存。' });
    } catch (error) {
      setImgMessage({ kind: 'error', text: error instanceof Error ? error.message : '保存配置失败' });
    } finally {
      setImgBusy(null);
    }
  }

  return (
    <Space direction="vertical" size="large" style={{ display: 'flex', maxWidth: 1440, margin: '0 auto' }}>
      <div style={{ marginBottom: 16 }}>
        <Text type="secondary" style={{ letterSpacing: 1, fontSize: 12, fontWeight: 600, textTransform: 'uppercase' }}>Gateway Settings</Text>
        <Title level={3} style={{ margin: '4px 0 8px' }}>模型配置</Title>
        <Text type="secondary" style={{ fontSize: 15 }}>只需要配置一次。保存后会作为默认生成网关与模型，在后续项目里持续复用。</Text>
      </div>

      <Row gutter={24}>
        <Col xs={24} lg={12}>
      <Card
        title={<><ApiOutlined /> OpenAI-compatible 文本生成配置</>}
        bordered={false}
        style={{ borderRadius: 16, boxShadow: '0 1px 2px rgba(15,23,42,0.04)', height: '100%' }}
      >
        <div style={{ marginBottom: 16 }}>
          <Text type="secondary">先获取模型列表，再做一次最小 JSON 生成测试，最后保存为默认配置。</Text>
        </div>

        {message && (
          <Alert message={message.text} type={message.kind === 'error' ? 'error' : (message.kind === 'success' ? 'success' : 'info')} showIcon style={{ marginBottom: 24 }} />
        )}

        <Form layout="vertical">
          <Form.Item label="Base URL" extra="例如：https://your-gateway.example.com。默认会拒绝 localhost、内网和 metadata 地址。">
            <Input value={baseUrl} onChange={(e) => { setBaseUrl(e.target.value); setTested(false); }} placeholder="https://..." />
          </Form.Item>

          <Form.Item label="API Key" extra="API Key 只发送给后端，不会进入导出文件。">
            <Input.Password value={apiKey} onChange={(e) => { setApiKey(e.target.value); setTested(false); }} placeholder="sk-..." />
          </Form.Item>

          <Form.Item>
            <Button onClick={handleListModels} disabled={!canFetchModels || busy !== null} loading={busy === 'models'}>
              {busy === 'models' ? '获取中...' : '获取模型列表'}
            </Button>
          </Form.Item>

          <Form.Item label="默认模型">
            <Select value={selectedModel} onChange={(value) => { setSelectedModel(value); setTested(false); }} placeholder="请选择模型">
              {selectedModel && !models.some((model) => model.id === selectedModel) && (
                <Select.Option value={selectedModel}>{selectedModel}</Select.Option>
              )}
              {models.map((model) => (
                <Select.Option key={model.id} value={model.id}>{model.id}</Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="Temperature">
                <InputNumber min={0} max={2} step={0.1} value={temperature} onChange={(val) => setTemperature(val || 0)} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Max Tokens">
                <InputNumber min={1} value={maxTokens} onChange={(val) => setMaxTokens(val || 8192)} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
            <Button onClick={handleTestGeneration} disabled={!canTest || busy !== null} loading={busy === 'test'}>
              {busy === 'test' ? '测试中...' : '测试生成'}
            </Button>
            <Button type="primary" onClick={handleSave} disabled={!canSave || busy !== null} loading={busy === 'save'}>
              {busy === 'save' ? '保存中...' : '保存配置'}
            </Button>
          </div>
        </Form>
      </Card>
        </Col>

        <Col xs={24} lg={12}>
      <Card
        title={<><PictureOutlined /> 生图模型配置</>}
        bordered={false}
        style={{ borderRadius: 16, boxShadow: '0 1px 2px rgba(15,23,42,0.04)', height: '100%' }}
      >
        <div style={{ marginBottom: 16 }}>
          <Text type="secondary">配置 OpenAI-compatible 生图网关。填写 URL 和 Key 后获取模型列表，测试通过后保存。</Text>
        </div>

        {imgMessage && (
          <Alert message={imgMessage.text} type={imgMessage.kind === 'error' ? 'error' : (imgMessage.kind === 'success' ? 'success' : 'info')} showIcon style={{ marginBottom: 24 }} />
        )}

        <Form layout="vertical">
          <Form.Item label="Base URL" extra="生图服务的 API 地址，例如：https://api.openai.com">
            <Input value={imgBaseUrl} onChange={(e) => { setImgBaseUrl(e.target.value); setImgTested(false); }} placeholder="https://..." />
          </Form.Item>

          <Form.Item label="API Key" extra="生图服务的 API Key。">
            <Input.Password value={imgApiKey} onChange={(e) => { setImgApiKey(e.target.value); setImgTested(false); }} placeholder="sk-..." />
          </Form.Item>

          <Form.Item>
            <Button onClick={handleListImgModels} disabled={!canFetchImgModels || imgBusy !== null} loading={imgBusy === 'models'}>
              {imgBusy === 'models' ? '获取中...' : '获取模型列表'}
            </Button>
          </Form.Item>

          <Form.Item label="生图模型">
            <Select value={imgSelectedModel} onChange={(value) => { setImgSelectedModel(value); setImgTested(false); }} placeholder="请选择模型">
              {imgSelectedModel && !imgModels.some((model) => model.id === imgSelectedModel) && (
                <Select.Option value={imgSelectedModel}>{imgSelectedModel}</Select.Option>
              )}
              {imgModels.map((model) => (
                <Select.Option key={model.id} value={model.id}>{model.id}</Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="默认尺寸">
                <Select value={imgSize} onChange={setImgSize}>
                  <Select.Option value="2048x1152">2048x1152 (16:9)</Select.Option>
                  <Select.Option value="1024x1024">1024x1024 (1:1)</Select.Option>
                  <Select.Option value="1792x1024">1792x1024</Select.Option>
                  <Select.Option value="1024x1792">1024x1792</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="质量">
                <Select value={imgQuality} onChange={setImgQuality}>
                  <Select.Option value="hd">hd</Select.Option>
                  <Select.Option value="standard">standard</Select.Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
            <Button onClick={handleTestImageGeneration} disabled={!canTestImg || imgBusy !== null} loading={imgBusy === 'test'}>
              {imgBusy === 'test' ? '测试中...' : '测试生图'}
            </Button>
            <Button type="primary" onClick={handleSaveImageConfig} disabled={!canSaveImg || imgBusy !== null} loading={imgBusy === 'save'}>
              {imgBusy === 'save' ? '保存中...' : '保存配置'}
            </Button>
          </div>
        </Form>
      </Card>
        </Col>
      </Row>
    </Space>
  );
}
