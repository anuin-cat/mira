import { useEffect, useState } from 'react'
import type { AiProviderSettings } from '../../domain/ai'
import {
  AI_PROVIDER_PRESETS,
  getAiProviderPreset,
  normalizeAiSettings,
} from '../../services/aiSettingsService'

interface Props {
  initialSettings: AiProviderSettings
  onClose: () => void
  onSave: (settings: AiProviderSettings) => void
}

/** AI 设置弹层：编辑 provider、key、模型和提示词 */
export function AiSettingsDialog({ initialSettings, onClose, onSave }: Props) {
  const [draftSettings, setDraftSettings] = useState<AiProviderSettings>(initialSettings)
  const [isApiKeyVisible, setIsApiKeyVisible] = useState(false)

  useEffect(() => {
    setDraftSettings(initialSettings)
  }, [initialSettings])

  /** 更新任意一个设置字段 */
  function patchDraftSettings(patch: Partial<AiProviderSettings>) {
    // 1. 基于当前草稿合并 patch，保持单一数据来源
    const nextSettings = normalizeAiSettings({
      ...draftSettings,
      ...patch,
    })

    // 2. 写回本地 state，驱动表单重渲染
    setDraftSettings(nextSettings)
  }

  /** 切换 provider 时自动带出对应预设 */
  function handleProviderChange(providerId: AiProviderSettings['providerId']) {
    // 1. 读取新老 provider 预设，用于判断是否应该顺带替换默认值
    const previousPreset = getAiProviderPreset(draftSettings.providerId)
    const nextPreset = getAiProviderPreset(providerId)
    const shouldReplaceBaseUrl = draftSettings.baseURL === previousPreset.defaultBaseUrl
    const shouldReplaceModel =
      !draftSettings.model || draftSettings.model === previousPreset.defaultModel

    // 2. 切 provider 时优先保留用户手改过的内容，只覆盖仍等于旧预设的字段
    patchDraftSettings({
      providerId,
      baseURL: shouldReplaceBaseUrl ? nextPreset.defaultBaseUrl : draftSettings.baseURL,
      model: shouldReplaceModel ? nextPreset.defaultModel : draftSettings.model,
    })
  }

  /** 提交设置并关闭弹层 */
  function handleSubmit() {
    onSave(normalizeAiSettings(draftSettings))
  }

  return (
    <div className="ai-dialog-backdrop" onClick={onClose}>
      <div className="ai-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="ai-dialog-header">
          <div>
            <h2>AI 设置</h2>
            <p>配置 OpenAI 兼容接口，设置仅保存在当前设备。</p>
          </div>
          <button type="button" className="ai-ghost-button" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="ai-form-grid">
          <label className="ai-form-field">
            <span>提供商</span>
            <select
              value={draftSettings.providerId}
              onChange={(event) =>
                handleProviderChange(event.target.value as AiProviderSettings['providerId'])
              }
            >
              {AI_PROVIDER_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>

          <label className="ai-form-field">
            <span>模型</span>
            <input
              value={draftSettings.model}
              onChange={(event) => patchDraftSettings({ model: event.target.value })}
              placeholder="例如：deepseek-chat"
            />
          </label>

          <label className="ai-form-field ai-form-field-wide">
            <span>Base URL</span>
            <input
              value={draftSettings.baseURL}
              onChange={(event) => patchDraftSettings({ baseURL: event.target.value })}
              placeholder="https://api.example.com/v1"
            />
          </label>

          <label className="ai-form-field ai-form-field-wide">
            <span>API Key</span>
            <div className="ai-inline-input">
              <input
                type={isApiKeyVisible ? 'text' : 'password'}
                value={draftSettings.apiKey}
                onChange={(event) => patchDraftSettings({ apiKey: event.target.value })}
                placeholder={getAiProviderPreset(draftSettings.providerId).apiKeyPlaceholder}
              />
              <button
                type="button"
                className="ai-ghost-button"
                onClick={() => setIsApiKeyVisible((value) => !value)}
              >
                {isApiKeyVisible ? '隐藏' : '显示'}
              </button>
            </div>
          </label>

          <label className="ai-form-field ai-form-field-wide">
            <span>系统提示词</span>
            <textarea
              value={draftSettings.systemPrompt}
              onChange={(event) => patchDraftSettings({ systemPrompt: event.target.value })}
              rows={5}
            />
          </label>

          <label className="ai-form-field">
            <span>温度</span>
            <input
              type="number"
              min="0"
              max="1.5"
              step="0.1"
              value={draftSettings.temperature}
              onChange={(event) =>
                patchDraftSettings({ temperature: Number(event.target.value || 0) })
              }
            />
          </label>
        </div>

        <div className="ai-dialog-footer">
          <button type="button" className="ai-secondary-button" onClick={onClose}>
            取消
          </button>
          <button type="button" className="ai-primary-button" onClick={handleSubmit}>
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
