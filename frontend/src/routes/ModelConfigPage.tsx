import { useEffect, useMemo, useState } from 'react';
import { FormField } from '../components/FormField';
import { StatusMessage } from '../components/StatusMessage';
import { getModelConfig, getImageModelConfig, listModels, saveModelConfig, saveImageModelConfig, testGeneration, testImageGeneration } from '../api/modelConfig';
import type { ModelInfo } from '../types/api';

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
    <main className="admin-page stack">
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">Gateway Settings</p>
          <h2>模型配置</h2>
          <p>只需要配置一次。保存后会作为默认生成网关与模型，在后续项目里持续复用。</p>
        </div>
      </section>

      <section className="card stack panel-shell">
        <div className="section-head">
          <div>
            <h2>OpenAI-compatible 配置</h2>
            <p className="muted">先获取模型列表，再做一次最小 JSON 生成测试，最后保存为默认配置。</p>
          </div>
        </div>

        {message ? <StatusMessage kind={message.kind}>{message.text}</StatusMessage> : null}

        <FormField label="Base URL" hint="例如：https://your-gateway.example.com。默认会拒绝 localhost、内网和 metadata 地址。">
          <input value={baseUrl} onChange={(event) => { setBaseUrl(event.target.value); setTested(false); }} placeholder="https://..." />
        </FormField>

        <FormField label="API Key" hint="API Key 只发送给后端，不会进入导出文件。">
          <input value={apiKey} onChange={(event) => { setApiKey(event.target.value); setTested(false); }} placeholder="sk-..." type="password" />
        </FormField>

        <div className="actions">
          <button type="button" onClick={handleListModels} disabled={!canFetchModels || busy !== null}>
            {busy === 'models' ? '获取中...' : '获取模型列表'}
          </button>
        </div>

        <FormField label="默认模型">
          <select value={selectedModel} onChange={(event) => { setSelectedModel(event.target.value); setTested(false); }}>
            {selectedModel && !models.some((model) => model.id === selectedModel) ? <option value={selectedModel}>{selectedModel}</option> : null}
            <option value="">请选择模型</option>
            {models.map((model) => (
              <option key={model.id} value={model.id}>{model.id}</option>
            ))}
          </select>
        </FormField>

        <div className="grid two">
          <FormField label="Temperature">
            <input type="number" min="0" max="2" step="0.1" value={temperature} onChange={(event) => setTemperature(Number(event.target.value))} />
          </FormField>
          <FormField label="Max Tokens">
            <input type="number" min="1" value={maxTokens} onChange={(event) => setMaxTokens(Number(event.target.value))} />
          </FormField>
        </div>

        <div className="actions">
          <button type="button" className="secondary" onClick={handleTestGeneration} disabled={!canTest || busy !== null}>
            {busy === 'test' ? '测试中...' : '测试生成'}
          </button>
          <button type="button" onClick={handleSave} disabled={!canSave || busy !== null}>
            {busy === 'save' ? '保存中...' : '保存配置'}
          </button>
        </div>
      </section>

      <section className="card stack panel-shell">
        <div className="section-head">
          <div>
            <h2>生图模型配置</h2>
            <p className="muted">配置 OpenAI-compatible 生图网关。填写 URL 和 Key 后获取模型列表，测试通过后保存。</p>
          </div>
        </div>

        {imgMessage ? <StatusMessage kind={imgMessage.kind}>{imgMessage.text}</StatusMessage> : null}

        <FormField label="Base URL" hint="生图服务的 API 地址，例如：https://api.openai.com">
          <input value={imgBaseUrl} onChange={(event) => { setImgBaseUrl(event.target.value); setImgTested(false); }} placeholder="https://..." />
        </FormField>

        <FormField label="API Key" hint="生图服务的 API Key。">
          <input value={imgApiKey} onChange={(event) => { setImgApiKey(event.target.value); setImgTested(false); }} placeholder="sk-..." type="password" />
        </FormField>

        <div className="actions">
          <button type="button" onClick={handleListImgModels} disabled={!canFetchImgModels || imgBusy !== null}>
            {imgBusy === 'models' ? '获取中...' : '获取模型列表'}
          </button>
        </div>

        <FormField label="生图模型">
          <select value={imgSelectedModel} onChange={(event) => { setImgSelectedModel(event.target.value); setImgTested(false); }}>
            {imgSelectedModel && !imgModels.some((model) => model.id === imgSelectedModel) ? <option value={imgSelectedModel}>{imgSelectedModel}</option> : null}
            <option value="">请选择模型</option>
            {imgModels.map((model) => (
              <option key={model.id} value={model.id}>{model.id}</option>
            ))}
          </select>
        </FormField>

        <div className="grid two">
          <FormField label="默认尺寸">
            <select value={imgSize} onChange={(event) => setImgSize(event.target.value)}>
              <option value="2048x1152">2048x1152 (16:9)</option>
              <option value="1024x1024">1024x1024 (1:1)</option>
              <option value="1792x1024">1792x1024</option>
              <option value="1024x1792">1024x1792</option>
            </select>
          </FormField>
          <FormField label="质量">
            <select value={imgQuality} onChange={(event) => setImgQuality(event.target.value)}>
              <option value="hd">hd</option>
              <option value="standard">standard</option>
            </select>
          </FormField>
        </div>

        <div className="actions">
          <button type="button" className="secondary" onClick={handleTestImageGeneration} disabled={!canTestImg || imgBusy !== null}>
            {imgBusy === 'test' ? '测试中...' : '测试生图'}
          </button>
          <button type="button" onClick={handleSaveImageConfig} disabled={!canSaveImg || imgBusy !== null}>
            {imgBusy === 'save' ? '保存中...' : '保存配置'}
          </button>
        </div>
      </section>
    </main>
  );
}
