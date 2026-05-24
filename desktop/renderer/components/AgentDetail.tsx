// ============================================================
// AgentDetail - Agent 详情展示组件
// ============================================================

import { useState } from 'react';
import { Edit, Trash2, Play, Info, ChevronDown, ChevronRight, Power, PowerOff } from 'lucide-react';
import { Avatar } from './Avatar';
import agentAvatar from '../assets/logos/01bff9e8a394133b79cf6911056f3bff.png';
import { t } from '@/core/i18n';

const PROVIDER_NAMES: Record<string, string> = {
  anthropic: 'Anthropic Claude',
  openai: 'OpenAI',
  'openai-response': 'OpenAI Responses',
  gemini: 'Google Gemini',
  deepseek: 'DeepSeek',
  zai: '智谱 GLM (Z.ai)',
  alibaba: '阿里 DashScope (Qwen)',
  moonshot: 'Moonshot (Kimi)',
  xai: 'xAI (Grok)',
  nvidia: 'NVIDIA NIM',
  minimax: 'MiniMax',
  hunyuan: '腾讯混元',
  baidu: '百度文心',
  openrouter: 'OpenRouter',
  together: 'Together AI',
  fireworks: 'Fireworks AI',
  groq: 'Groq',
  perplexity: 'Perplexity',
  mistral: 'Mistral AI',
  cohere: 'Cohere',
  huggingface: 'Hugging Face',
  ollama: 'Ollama',
  vllm: 'vLLM',
  lmstudio: 'LM Studio',
  'local-llama': 'Local LLM',
  'openai-image': 'OpenAI Image',
  'ark': '火山引擎豆包 (Seedream)',
};

function getProviderName(adapter: string): string {
  return PROVIDER_NAMES[adapter] || adapter;
}

interface AgentDetailProps {
  agent: any;
  onEdit: () => void;
  onDelete: () => void;
  onTest: () => void;
  onToggleEnabled?: (enabled: boolean) => void;
}

const NEVER_DISABLE_AGENTS = ['xuanji', 'memory-manager', 'context-compressor'];

export default function AgentDetail({ agent, onEdit, onDelete, onTest, onToggleEnabled }: AgentDetailProps) {
  const category = agent.metadata?.category || 'custom';
  const canEdit = true;
  const canDelete = category === 'custom';
  const isMainAgent = agent.metadata?.isMainAgent === true;
  const canToggleEnabled = !isMainAgent && !NEVER_DISABLE_AGENTS.includes(agent.id);
  const [showConfig, setShowConfig] = useState(false);

  const configJson = JSON.stringify(agent, null, 2);

  // Agent 类型标识
  const getAgentTypeInfo = () => {
    if (agent.metadata?.isMainAgent) {
      return {
        type: t('agent.detail.type.main'),
        icon: '⭐',
        color: 'text-yellow-400',
        bgColor: 'bg-yellow-500/20',
        description: t('agent.detail.desc.main'),
      };
    }
    if (category === 'system') {
      return {
        type: t('agent.detail.type.system'),
        icon: '⚙️',
        color: 'text-gray-400',
        bgColor: 'bg-gray-500/20',
        description: t('agent.detail.desc.system'),
      };
    }
    if (category === 'app') {
      return {
        type: t('agent.detail.type.app'),
        icon: '🤖',
        color: 'text-blue-500',
        bgColor: 'bg-blue-500/20',
        description: t('agent.detail.desc.app'),
      };
    }
    return {
      type: t('agent.detail.type.custom'),
      icon: '📝',
      color: 'text-purple-500',
      bgColor: 'bg-purple-500/20',
      description: t('agent.detail.desc.custom'),
    };
  };

  // System Prompt 构建方式
  const getSystemPromptMode = () => {
    const { systemPrompt } = agent;

    if (systemPrompt === null || systemPrompt === undefined) {
      return {
        mode: t('agent.detail.prompt.dynamic'),
        icon: '🔄',
        color: 'text-green-500',
        bgColor: 'bg-green-500/20',
        description: t('agent.detail.prompt.dynamic_desc'),
        layers: null,
      };
    }

    return {
      mode: t('agent.detail.prompt.fixed'),
      icon: '📌',
      color: 'text-orange-500',
      bgColor: 'bg-orange-500/20',
      description: category === 'system'
        ? t('agent.detail.prompt.fixed_desc_system')
        : t('agent.detail.prompt.fixed_desc_generic'),
      layers: null,
    };
  };

  const typeInfo = getAgentTypeInfo();
  const promptMode = getSystemPromptMode();

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* 头部 */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-start gap-4">
          {/* Avatar */}
          <div className="w-16 h-16 rounded-lg flex items-center justify-center overflow-hidden">
            {agent.id === 'xuanji' || agent.name === 'Xuanji' ? (
              <img src={agentAvatar} alt={agent.name} className="w-full h-full object-cover" />
            ) : (
              <Avatar seed={agent.name || agent.id} size={64} className="w-16 h-16" />
            )}
          </div>
          <div>
            <h3 className="text-2xl font-bold mb-1">{agent.name}</h3>
            <p className="text-sm text-text-secondary">{agent.id}</p>
            {category && (
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs bg-bg-tertiary px-2 py-1 rounded">
                  {category === 'system' ? t('agent.detail.badge.system') :
                   category === 'app' ? t('agent.detail.badge.app') : t('agent.detail.badge.custom')}
                </span>
                {!agent.enabled && (
                  <span className="text-xs bg-red-500/20 text-red-500 px-2 py-1 rounded">
                    {t('agent.detail.badge.disabled')}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-2">
          {canToggleEnabled && onToggleEnabled && (
            <button
              onClick={() => onToggleEnabled(!agent.enabled)}
              className={`px-4 py-2 border rounded transition-colors text-sm flex items-center gap-2 ${
                agent.enabled === false
                  ? 'border-green-500/20 text-green-500 hover:bg-green-500/10'
                  : 'border-orange-500/20 text-orange-500 hover:bg-orange-500/10'
              }`}
              title={agent.enabled === false ? t('agent.detail.btn.enable_title') : t('agent.detail.btn.disable_title')}
            >
              {agent.enabled === false ? <Power size={16} /> : <PowerOff size={16} />}
              {agent.enabled === false ? t('agent.detail.btn.enable') : t('agent.detail.btn.disable')}
            </button>
          )}
          {canEdit && (
            <button
              onClick={onEdit}
              className="px-4 py-2 border border-bg-tertiary rounded hover:bg-bg-tertiary transition-colors text-sm flex items-center gap-2"
            >
              <Edit size={16} />
              {t('agent.detail.btn.edit')}
            </button>
          )}
          {canDelete && (
            <button
              onClick={onDelete}
              className="px-4 py-2 border border-red-500/20 text-red-500 rounded hover:bg-red-500/10 transition-colors text-sm flex items-center gap-2"
            >
              <Trash2 size={16} />
              {t('agent.detail.btn.delete')}
            </button>
          )}
          <button
            onClick={onTest}
            className="px-4 py-2 bg-primary text-white rounded hover:bg-primary/90 transition-colors text-sm flex items-center gap-2"
          >
            <Play size={16} />
            {t('agent.detail.btn.test')}
          </button>
        </div>
      </div>

      {/* 描述 */}
      <div className="bg-bg-secondary rounded-lg p-4 mb-6">
        <h4 className="font-medium mb-2 flex items-center gap-2">
          <Info size={16} className="text-primary" />
          {t('agent.detail.section.description')}
        </h4>
        <p className="text-text-secondary whitespace-pre-wrap">{agent.description}</p>
      </div>

      {/* 类型与特性 */}
      <div className="bg-bg-secondary rounded-lg p-4 mb-6">
        <h4 className="font-medium mb-3">{t('agent.detail.section.type_features')}</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Agent 类型 */}
          <div className={`p-3 rounded-lg ${typeInfo.bgColor}`}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xl">{typeInfo.icon}</span>
              <div className="flex items-center gap-2 flex-1">
                <span className={`font-medium ${typeInfo.color}`}>{typeInfo.type}</span>
                {(typeInfo as any).subType && (
                  <span className="text-xs px-1.5 py-0.5 bg-bg-primary rounded">
                    {(typeInfo as any).subType}
                  </span>
                )}
              </div>
            </div>
            <p className="text-xs text-text-secondary">{typeInfo.description}</p>
          </div>

          {/* System Prompt 构建方式 */}
          <div className={`p-3 rounded-lg ${promptMode.bgColor} ${promptMode.layers ? 'col-span-2' : ''}`}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xl">{promptMode.icon}</span>
              <span className={`font-medium ${promptMode.color}`}>{promptMode.mode}</span>
            </div>
            <p className="text-xs text-text-secondary mb-2">{promptMode.description}</p>
            {promptMode.layers && (
              <div className="mt-3 space-y-1.5">
                <p className="text-xs font-medium text-text-primary">{t('agent.detail.section.prompt_layers')}</p>
                {(promptMode.layers as string[])?.map((layer: string, idx: number) => (
                  <div key={idx} className="flex items-start gap-2 text-xs text-text-secondary">
                    <span className="text-primary mt-0.5">▸</span>
                    <span>{layer}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 工具配置 */}
          {agent.tools && agent.tools.length > 0 && (
            <div className="p-3 rounded-lg bg-bg-primary col-span-2">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xl">🔧</span>
                <span className="font-medium">{t('agent.detail.section.tools')}</span>
              </div>
              <div className="space-y-2">
                <p className="text-xs text-text-secondary">
                  {t('agent.detail.tools.count', { count: agent.tools.length })}
                  {agent.tools.filter((t: any) => t.enabled !== false).length > 0 && (
                    <span className="ml-2">
                      {t('agent.detail.tools.enabled_count', { count: agent.tools.filter((t: any) => t.enabled !== false).length })}
                    </span>
                  )}
                </p>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {agent.tools.map((tool: any) => {
                    const toolName = typeof tool === 'string' ? tool : tool.name;
                    const toolEnabled = typeof tool === 'string' ? true : tool.enabled !== false;
                    const toolRequired = typeof tool === 'string' ? false : tool.required === true;

                    return (
                      <span
                        key={toolName}
                        className={`text-xs px-2 py-1 rounded ${
                          !toolEnabled
                            ? 'bg-gray-500/20 text-gray-500 line-through'
                            : toolRequired
                            ? 'bg-primary/20 text-primary'
                            : 'bg-bg-tertiary text-text-secondary'
                        }`}
                        title={
                          !toolEnabled
                            ? t('agent.detail.tools.title.disabled')
                            : toolRequired
                            ? t('agent.detail.tools.title.required')
                            : t('agent.detail.tools.title.optional')
                        }
                      >
                        {toolName}
                        {toolRequired && ' *'}
                        {!toolEnabled && t('agent.detail.tools.disabled_suffix')}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* 执行配置 */}
          {agent.execution && (
            <div className="p-3 rounded-lg bg-bg-primary">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xl">⚡</span>
                <span className="font-medium">{t('agent.detail.section.execution')}</span>
              </div>
              <div className="space-y-1">
                {agent.execution.mode && (
                  <p className="text-xs text-text-secondary">
                    {t('agent.detail.execution.mode', { mode: agent.execution.mode.toUpperCase() })}
                  </p>
                )}
                {agent.execution.maxIterations !== undefined && (
                  <p className="text-xs text-text-secondary">
                    {agent.execution.maxIterations === Infinity
                      ? t('agent.detail.execution.max_iterations_unlimited')
                      : t('agent.detail.execution.max_iterations', { count: agent.execution.maxIterations })}
                  </p>
                )}
                {agent.execution.timeout !== undefined && (
                  <p className="text-xs text-text-secondary">
                    {t('agent.detail.execution.timeout', { timeout: (agent.execution.timeout / 1000).toFixed(0) })}
                  </p>
                )}
                {agent.execution.streaming !== undefined && (
                  <p className="text-xs text-text-secondary">
                    {t('agent.detail.execution.streaming', {
                      status: agent.execution.streaming
                        ? t('agent.detail.execution.streaming_enabled')
                        : t('agent.detail.execution.streaming_disabled')
                    })}
                  </p>
                )}
                {agent.execution.parallelTools !== undefined && (
                  <p className="text-xs text-text-secondary">
                    {t('agent.detail.execution.parallel_tools', {
                      status: agent.execution.parallelTools
                        ? t('agent.detail.execution.parallel_supported')
                        : t('agent.detail.execution.parallel_unsupported')
                    })}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* 权限配置 */}
          {agent.permissions && (
            <div className="p-3 rounded-lg bg-bg-primary">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xl">🔒</span>
                <span className="font-medium">{t('agent.detail.section.permissions')}</span>
              </div>
              <div className="space-y-1">
                {agent.permissions.fileRead && (
                  <p className="text-xs text-text-secondary">
                    {t('agent.detail.permission.file_read', {
                      status: agent.permissions.fileRead === 'always'
                        ? t('agent.detail.permission.always')
                        : agent.permissions.fileRead === 'ask'
                        ? t('agent.detail.permission.ask')
                        : t('agent.detail.permission.denied')
                    })}
                  </p>
                )}
                {agent.permissions.fileWrite && (
                  <p className="text-xs text-text-secondary">
                    {t('agent.detail.permission.file_write', {
                      status: agent.permissions.fileWrite === 'always'
                        ? t('agent.detail.permission.always')
                        : agent.permissions.fileWrite === 'ask'
                        ? t('agent.detail.permission.ask')
                        : t('agent.detail.permission.denied')
                    })}
                  </p>
                )}
                {agent.permissions.bashExec && (
                  <p className="text-xs text-text-secondary">
                    {t('agent.detail.permission.bash_exec', {
                      status: agent.permissions.bashExec === 'always'
                        ? t('agent.detail.permission.always')
                        : agent.permissions.bashExec === 'ask'
                        ? t('agent.detail.permission.ask')
                        : t('agent.detail.permission.denied')
                    })}
                  </p>
                )}
                {agent.permissions.network && (
                  <p className="text-xs text-text-secondary">
                    {t('agent.detail.permission.network', {
                      status: agent.permissions.network === 'always'
                        ? t('agent.detail.permission.always')
                        : agent.permissions.network === 'ask'
                        ? t('agent.detail.permission.ask')
                        : t('agent.detail.permission.denied')
                    })}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* 模型配置 */}
          {agent.model && (
            <div className="p-3 rounded-lg bg-bg-primary">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xl">🧠</span>
                <span className="font-medium">{t('agent.detail.section.model')}</span>
              </div>
              <div className="space-y-1">
                {agent.model.primary && (
                  <p className="text-xs text-text-secondary truncate" title={agent.model.primary}>
                    {t('agent.detail.model.primary', { model: agent.model.primary.replace('[CC]', '') })}
                  </p>
                )}
                {agent.model.maxTokens !== undefined && (
                  <p className="text-xs text-text-secondary">
                    {t('agent.detail.model.max_tokens', { count: agent.model.maxTokens.toLocaleString() })}
                  </p>
                )}
                {agent.model.temperature !== undefined && (
                  <p className="text-xs text-text-secondary">
                    {t('agent.detail.model.temperature', { value: agent.model.temperature })}
                  </p>
                )}
                {agent.model.thinking && (
                  <p className="text-xs text-text-secondary">
                    {t('agent.detail.model.thinking', { type: agent.model.thinking.type, effort: agent.model.thinking.effort })}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Provider 配置 */}
          {agent.provider && (
            <div className="p-3 rounded-lg bg-bg-primary">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xl">🔌</span>
                <span className="font-medium">{t('agent.detail.section.provider')}</span>
              </div>
              <div className="space-y-1">
                {agent.provider.adapter && (
                  <p className="text-xs text-text-secondary">
                    {t('agent.detail.provider.adapter', { adapter: getProviderName(agent.provider.adapter) })}
                  </p>
                )}
                {agent.provider.baseURL && (
                  <p className="text-xs text-text-secondary truncate" title={agent.provider.baseURL}>
                    {t('agent.detail.provider.base_url', { url: agent.provider.baseURL })}
                  </p>
                )}
                {agent.provider.apiKey && (
                  <p className="text-xs text-text-secondary">
                    {t('agent.detail.provider.api_key', { key: agent.provider.apiKey.substring(0, 8) + '...' })}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 标签 */}
      {/* Capabilities（能力） */}
      {agent.capabilities && agent.capabilities.length > 0 && (
        <div className="bg-bg-secondary rounded-lg p-4 mb-6">
          <h4 className="font-medium mb-3">{t('agent.detail.section.capabilities')}</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {agent.capabilities.map((capability: string, idx: number) => (
              <div key={idx} className="flex items-start gap-2 text-sm">
                <span className="text-primary mt-0.5">✓</span>
                <span className="text-text-secondary">{capability}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Skills（未来支持） */}
      {agent.skills && agent.skills.length > 0 && (
        <div className="bg-bg-secondary rounded-lg p-4 mb-6">
          <h4 className="font-medium mb-3 flex items-center gap-2">
            <span>🎯</span>
            <span>Skills</span>
            <span className="text-xs bg-blue-500/20 text-blue-500 px-2 py-0.5 rounded">{t('agent.detail.section.skills_future')}</span>
          </h4>
          <div className="flex gap-2 flex-wrap">
            {agent.skills.map((skill: string) => (
              <span key={skill} className="bg-blue-500/20 text-blue-500 px-3 py-1 rounded-full text-sm">
                {skill}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* System Prompt */}
      {agent.systemPrompt && category !== 'system' && (
        <div className="bg-bg-secondary rounded-lg p-4 mb-6">
          <h4 className="font-medium mb-3 flex items-center gap-2">
            <span>📝</span>
            <span>{t('agent.detail.section.system_prompt')}</span>
          </h4>
          <div className="bg-bg-primary rounded p-3 max-h-64 overflow-y-auto">
            <pre className="text-xs text-text-secondary whitespace-pre-wrap font-mono">
              {agent.systemPrompt}
            </pre>
          </div>
        </div>
      )}

      {/* 完整配置（可折叠） */}
      {category !== 'system' && (<div className="bg-bg-secondary rounded-lg p-4 mb-6">
        <button
          onClick={() => setShowConfig(!showConfig)}
          className="w-full flex items-center justify-between hover:opacity-80 transition-opacity"
        >
          <h4 className="font-medium flex items-center gap-2">
            {showConfig ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            {t('agent.detail.section.full_config')}
          </h4>
        </button>
        {showConfig && (
          <pre className="mt-3 bg-black/20 p-4 rounded overflow-auto text-xs font-mono max-h-96">
            {configJson}
          </pre>
        )}
      </div>)}

      {/* 分类可编辑提示 */}
      {category === 'system' && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
          <p className="text-sm text-red-400">
            {t('agent.detail.hint.system')}
          </p>
        </div>
      )}
      {category === 'app' && (
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
          <p className="text-sm text-yellow-400">
            {t('agent.detail.hint.app')}
          </p>
        </div>
      )}
      {category === 'custom' && (
        <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
          <p className="text-sm text-green-400">
            {t('agent.detail.hint.custom')}
          </p>
        </div>
      )}
    </div>
  );
}
