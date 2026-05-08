// ============================================================
// AgentDetail - Agent 详情展示组件
// ============================================================

import { useState } from 'react';
import { Edit, Trash2, Play, Info, Copy, ChevronDown, ChevronRight, Power, PowerOff } from 'lucide-react';

interface AgentDetailProps {
  agent: any;
  onEdit: () => void;
  onDelete: () => void;
  onCopy: () => void;
  onTest: () => void;
  onToggleEnabled?: (enabled: boolean) => void;
}

export default function AgentDetail({ agent, onEdit, onDelete, onCopy, onTest, onToggleEnabled }: AgentDetailProps) {
  const category = agent.metadata?.category || 'custom';
  const canEdit = true;
  const canDelete = category === 'custom';
  const isMainAgent = agent.metadata?.isMainAgent === true;
  const canToggleEnabled = !isMainAgent; // 主agent不能被禁用
  const [showConfig, setShowConfig] = useState(false);

  const configJson = JSON.stringify(agent, null, 2);

  // Agent 类型标识
  const getAgentTypeInfo = () => {
    if (agent.metadata?.isMainAgent) {
      return {
        type: '主 Agent',
        icon: '⭐',
        color: 'text-yellow-400',
        bgColor: 'bg-yellow-500/20',
        description: '主 Agent，负责所有用户交互和任务执行',
      };
    }
    if (category === 'system') {
      return {
        type: '系统 Agent',
        icon: '⚙️',
        color: 'text-gray-400',
        bgColor: 'bg-gray-500/20',
        description: '系统内置 Agent，由框架自动调用',
      };
    }
    if (category === 'app') {
      return {
        type: '应用 Agent',
        icon: '🤖',
        color: 'text-blue-500',
        bgColor: 'bg-blue-500/20',
        description: '执行特定任务的应用 Agent',
      };
    }
    return {
      type: '自定义 Agent',
      icon: '📝',
      color: 'text-purple-500',
      bgColor: 'bg-purple-500/20',
      description: '用户自定义 Agent',
    };
  };

  // System Prompt 构建方式
  const getSystemPromptMode = () => {
    const { systemPrompt } = agent;

    if (systemPrompt === null || systemPrompt === undefined) {
      return {
        mode: '动态构建',
        icon: '🔄',
        color: 'text-green-500',
        bgColor: 'bg-green-500/20',
        description: '使用 LayeredPromptBuilder 根据场景和复杂度动态生成（L0-L3 分层组件）',
        layers: null,
      };
    }

    return {
      mode: '固定字符串',
      icon: '📌',
      color: 'text-orange-500',
      bgColor: 'bg-orange-500/20',
      description: category === 'system'
        ? '系统 Agent，使用配置中定义的固定 system prompt'
        : '使用配置中定义的固定 system prompt',
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
          <div
            className={`w-16 h-16 rounded-lg flex items-center justify-center ${
              agent.color ? `bg-gradient-to-br ${agent.color}` : 'bg-primary/20'
            }`}
          >
            <span className="text-3xl">{agent.avatar || '🤖'}</span>
          </div>
          <div>
            <h3 className="text-2xl font-bold mb-1">{agent.name}</h3>
            <p className="text-sm text-text-secondary">{agent.id}</p>
            {category && (
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs bg-bg-tertiary px-2 py-1 rounded">
                  {category === 'system' ? '⚙️ 系统' :
                   category === 'app' ? '🤖 应用' : '📝 自定义'}
                </span>
                {!agent.enabled && (
                  <span className="text-xs bg-red-500/20 text-red-500 px-2 py-1 rounded">
                    已禁用
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
              title={agent.enabled === false ? '启用 Agent' : '禁用 Agent'}
            >
              {agent.enabled === false ? <Power size={16} /> : <PowerOff size={16} />}
              {agent.enabled === false ? '启用' : '禁用'}
            </button>
          )}
          <button
            onClick={onCopy}
            className="px-4 py-2 border border-bg-tertiary rounded hover:bg-bg-tertiary transition-colors text-sm flex items-center gap-2"
            title="复制为新 Agent"
          >
            <Copy size={16} />
            复制
          </button>
          {canEdit && (
            <button
              onClick={onEdit}
              className="px-4 py-2 border border-bg-tertiary rounded hover:bg-bg-tertiary transition-colors text-sm flex items-center gap-2"
            >
              <Edit size={16} />
              编辑
            </button>
          )}
          {canDelete && (
            <button
              onClick={onDelete}
              className="px-4 py-2 border border-red-500/20 text-red-500 rounded hover:bg-red-500/10 transition-colors text-sm flex items-center gap-2"
            >
              <Trash2 size={16} />
              删除
            </button>
          )}
          <button
            onClick={onTest}
            className="px-4 py-2 bg-primary text-white rounded hover:bg-primary/90 transition-colors text-sm flex items-center gap-2"
          >
            <Play size={16} />
            测试
          </button>
        </div>
      </div>

      {/* 描述 */}
      <div className="bg-bg-secondary rounded-lg p-4 mb-6">
        <h4 className="font-medium mb-2 flex items-center gap-2">
          <Info size={16} className="text-primary" />
          描述
        </h4>
        <p className="text-text-secondary whitespace-pre-wrap">{agent.description}</p>
      </div>

      {/* 类型与特性 */}
      <div className="bg-bg-secondary rounded-lg p-4 mb-6">
        <h4 className="font-medium mb-3">🎯 类型与特性</h4>
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
                <p className="text-xs font-medium text-text-primary">Prompt 组成层级：</p>
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
                <span className="font-medium">工具配置</span>
              </div>
              <div className="space-y-2">
                <p className="text-xs text-text-secondary">
                  共 {agent.tools.length} 个工具
                  {agent.tools.filter((t: any) => t.enabled !== false).length > 0 && (
                    <span className="ml-2">
                      (已启用: {agent.tools.filter((t: any) => t.enabled !== false).length} 个)
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
                            ? '已禁用'
                            : toolRequired
                            ? '必备工具'
                            : '可选工具'
                        }
                      >
                        {toolName}
                        {toolRequired && ' *'}
                        {!toolEnabled && ' (禁用)'}
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
                <span className="font-medium">执行配置</span>
              </div>
              <div className="space-y-1">
                {agent.execution.mode && (
                  <p className="text-xs text-text-secondary">
                    模式: {agent.execution.mode.toUpperCase()}
                  </p>
                )}
                {agent.execution.maxIterations !== undefined && (
                  <p className="text-xs text-text-secondary">
                    最大迭代: {agent.execution.maxIterations === Infinity ? '∞ 不限' : agent.execution.maxIterations}
                  </p>
                )}
                {agent.execution.timeout !== undefined && (
                  <p className="text-xs text-text-secondary">
                    超时: {(agent.execution.timeout / 1000).toFixed(0)}s
                  </p>
                )}
                {agent.execution.streaming !== undefined && (
                  <p className="text-xs text-text-secondary">
                    流式输出: {agent.execution.streaming ? '✓ 启用' : '✗ 禁用'}
                  </p>
                )}
                {agent.execution.parallelTools !== undefined && (
                  <p className="text-xs text-text-secondary">
                    并行工具: {agent.execution.parallelTools ? '✓ 支持' : '✗ 不支持'}
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
                <span className="font-medium">权限配置</span>
              </div>
              <div className="space-y-1">
                {agent.permissions.fileRead && (
                  <p className="text-xs text-text-secondary">
                    文件读取: {agent.permissions.fileRead === 'always' ? '✓ 始终允许' : agent.permissions.fileRead === 'ask' ? '? 询问' : '✗ 禁止'}
                  </p>
                )}
                {agent.permissions.fileWrite && (
                  <p className="text-xs text-text-secondary">
                    文件写入: {agent.permissions.fileWrite === 'always' ? '✓ 始终允许' : agent.permissions.fileWrite === 'ask' ? '? 询问' : '✗ 禁止'}
                  </p>
                )}
                {agent.permissions.bashExec && (
                  <p className="text-xs text-text-secondary">
                    Bash执行: {agent.permissions.bashExec === 'always' ? '✓ 始终允许' : agent.permissions.bashExec === 'ask' ? '? 询问' : '✗ 禁止'}
                  </p>
                )}
                {agent.permissions.network && (
                  <p className="text-xs text-text-secondary">
                    网络访问: {agent.permissions.network === 'always' ? '✓ 始终允许' : agent.permissions.network === 'ask' ? '? 询问' : '✗ 禁止'}
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
                <span className="font-medium">模型配置</span>
              </div>
              <div className="space-y-1">
                {agent.model.primary && (
                  <p className="text-xs text-text-secondary truncate" title={agent.model.primary}>
                    主模型: {agent.model.primary.replace('[CC]', '')}
                  </p>
                )}
                {agent.model.maxTokens !== undefined && (
                  <p className="text-xs text-text-secondary">
                    最大 Token: {agent.model.maxTokens.toLocaleString()}
                  </p>
                )}
                {agent.model.temperature !== undefined && (
                  <p className="text-xs text-text-secondary">
                    温度: {agent.model.temperature}
                  </p>
                )}
                {agent.model.thinking && (
                  <p className="text-xs text-text-secondary">
                    思考模式: {agent.model.thinking.type} ({agent.model.thinking.effort})
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
                <span className="font-medium">Provider 配置</span>
              </div>
              <div className="space-y-1">
                {agent.provider.adapter && (
                  <p className="text-xs text-text-secondary">
                    适配器: {agent.provider.adapter}
                  </p>
                )}
                {agent.provider.baseURL && (
                  <p className="text-xs text-text-secondary truncate" title={agent.provider.baseURL}>
                    Base URL: {agent.provider.baseURL}
                  </p>
                )}
                {agent.provider.apiKey && (
                  <p className="text-xs text-text-secondary">
                    API Key: {agent.provider.apiKey.substring(0, 8)}...
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
          <h4 className="font-medium mb-3">💪 能力清单</h4>
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
            <span className="text-xs bg-blue-500/20 text-blue-500 px-2 py-0.5 rounded">未来支持</span>
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
      {agent.systemPrompt && (
        <div className="bg-bg-secondary rounded-lg p-4 mb-6">
          <h4 className="font-medium mb-3 flex items-center gap-2">
            <span>📝</span>
            <span>System Prompt</span>
          </h4>
          <div className="bg-bg-primary rounded p-3 max-h-64 overflow-y-auto">
            <pre className="text-xs text-text-secondary whitespace-pre-wrap font-mono">
              {agent.systemPrompt}
            </pre>
          </div>
        </div>
      )}

      {/* 完整配置（可折叠） */}
      <div className="bg-bg-secondary rounded-lg p-4 mb-6">
        <button
          onClick={() => setShowConfig(!showConfig)}
          className="w-full flex items-center justify-between hover:opacity-80 transition-opacity"
        >
          <h4 className="font-medium flex items-center gap-2">
            {showConfig ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            📋 完整配置 (JSON)
          </h4>
        </button>
        {showConfig && (
          <pre className="mt-3 bg-black/20 p-4 rounded overflow-auto text-xs font-mono max-h-96">
            {configJson}
          </pre>
        )}
      </div>

      {/* 元数据 */}
      {category === 'system' && (
        <div className="bg-gray-500/10 border border-gray-500/20 rounded-lg p-4">
          <p className="text-sm text-gray-400">
            ℹ️ 系统 Agent 可配置模型和 Provider，但不可修改 Prompt/工具，也不可删除。
          </p>
        </div>
      )}
    </div>
  );
}
