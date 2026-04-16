// ============================================================
// AgentDetail - Agent 详情展示组件
// ============================================================

import { useState } from 'react';
import { Edit, Trash2, Play, Info, Copy, ChevronDown, ChevronRight } from 'lucide-react';

interface AgentDetailProps {
  agent: any;
  onEdit: () => void;
  onDelete: () => void;
  onCopy: () => void;
  onTest: () => void;
}

export default function AgentDetail({ agent, onEdit, onDelete, onCopy, onTest }: AgentDetailProps) {
  const isBuiltin = agent.metadata?.source === 'builtin';
  const [showConfig, setShowConfig] = useState(false);

  const configJson = JSON.stringify(agent, null, 2);

  // Agent 类型标识
  const getAgentTypeInfo = () => {
    const metadata = agent.metadata || {};

    // 主 Agent
    if (metadata.isMainAgent) {
      return {
        type: '主 Agent',
        icon: '⭐',
        color: 'text-yellow-500',
        bgColor: 'bg-yellow-500/20',
        description: '用户直接交互的主 Agent，处理所有用户输入',
      };
    }

    // 子 Agent（包括 SubAgent 和 SystemAgent）
    if (metadata.isSubAgent || metadata.isSystemAgent) {
      const isSystem = metadata.isSystemAgent;
      return {
        type: '子 Agent',
        icon: isSystem ? '⚙️' : '🤖',
        color: 'text-blue-500',
        bgColor: 'bg-blue-500/20',
        description: isSystem
          ? '系统内部专用子代理（上下文压缩、意图分析等），由框架自动调用'
          : '执行特定任务的专业子代理，由主 Agent 或其他 Agent 调用',
        subType: isSystem ? '系统' : '通用',
      };
    }

    // 自定义 Agent
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
    const isMainAgent = agent.metadata?.isMainAgent;
    const isSubAgent = agent.metadata?.isSubAgent;
    const isSystemAgent = agent.metadata?.isSystemAgent;

    if (systemPrompt === null || systemPrompt === undefined) {
      return {
        mode: '动态构建',
        icon: '🔄',
        color: 'text-green-500',
        bgColor: 'bg-green-500/20',
        description: '使用 LayeredPromptBuilder 根据场景和复杂度动态生成（L0-L3 分层组件）',
        layers: isMainAgent
          ? ['L0 基础层 (base-identity + base-memory-guide + base-task-execution)', 'L1 场景层 (coding/life)', 'L2 复杂任务层 (agent-rules/planning)', 'L3 项目层 (project context)']
          : null,
      };
    }

    // 子 Agent 使用统一基础层 + 角色专用 prompt
    if (isSubAgent && !isSystemAgent) {
      return {
        mode: '统一基础层 + 角色专用',
        icon: '🧩',
        color: 'text-blue-500',
        bgColor: 'bg-blue-500/20',
        description: '加载 L0 基础层（记忆/任务执行指导）+ 角色专用 prompt',
        layers: [
          'L0 基础层 (base-identity + base-memory-guide + base-task-execution)',
          '角色专用 prompt (配置文件中定义)',
          'L3 项目层 (可选)',
        ],
      };
    }

    // 系统内部 Agent 使用固定 prompt
    if (isSystemAgent) {
      return {
        mode: '固定字符串',
        icon: '📌',
        color: 'text-orange-500',
        bgColor: 'bg-orange-500/20',
        description: '系统内部 Agent，使用配置中定义的固定 system prompt',
        layers: null,
      };
    }

    return {
      mode: '固定字符串',
      icon: '📌',
      color: 'text-orange-500',
      bgColor: 'bg-orange-500/20',
      description: '使用配置中定义的固定 system prompt',
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
          <div className="w-16 h-16 bg-primary/20 rounded-lg flex items-center justify-center">
            <span className="text-3xl">🤖</span>
          </div>
          <div>
            <h3 className="text-2xl font-bold mb-1">{agent.name}</h3>
            <p className="text-sm text-text-secondary">{agent.id}</p>
            {agent.metadata?.source && (
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs bg-bg-tertiary px-2 py-1 rounded">
                  {agent.metadata.source === 'builtin' ? '📦 内置' :
                   agent.metadata.source === 'global' ? '🌐 全局' : '📁 项目'}
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
          <button
            onClick={onCopy}
            className="px-4 py-2 border border-bg-tertiary rounded hover:bg-bg-tertiary transition-colors text-sm flex items-center gap-2"
            title="复制为新 Agent"
          >
            <Copy size={16} />
            复制
          </button>
          {!isBuiltin && (
            <>
              <button
                onClick={onEdit}
                className="px-4 py-2 border border-bg-tertiary rounded hover:bg-bg-tertiary transition-colors text-sm flex items-center gap-2"
              >
                <Edit size={16} />
                编辑
              </button>
              <button
                onClick={onDelete}
                className="px-4 py-2 border border-red-500/20 text-red-500 rounded hover:bg-red-500/10 transition-colors text-sm flex items-center gap-2"
              >
                <Trash2 size={16} />
                删除
              </button>
            </>
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
                {typeInfo.subType && (
                  <span className="text-xs px-1.5 py-0.5 bg-bg-primary rounded">
                    {typeInfo.subType}
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
                {promptMode.layers.map((layer: string, idx: number) => (
                  <div key={idx} className="flex items-start gap-2 text-xs text-text-secondary">
                    <span className="text-primary mt-0.5">▸</span>
                    <span>{layer}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 工具配置 */}
          {agent.tools && (
            <div className="p-3 rounded-lg bg-bg-primary col-span-2">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xl">🔧</span>
                <span className="font-medium">工具配置</span>
              </div>
              <div className="space-y-2">
                <p className="text-xs text-text-secondary">
                  共 {agent.tools.length} 个工具
                  {agent.tools.filter((t: any) => t.required).length > 0 && (
                    <span className="ml-2">
                      (必备: {agent.tools.filter((t: any) => t.required).length} 个)
                    </span>
                  )}
                </p>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {agent.tools.map((tool: any) => (
                    <span
                      key={tool.name}
                      className={`text-xs px-2 py-1 rounded ${
                        tool.required
                          ? 'bg-primary/20 text-primary'
                          : 'bg-bg-tertiary text-text-secondary'
                      }`}
                      title={tool.required ? '必备工具' : '可选工具'}
                    >
                      {tool.name}
                      {tool.required && ' *'}
                    </span>
                  ))}
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
                    最大迭代: {agent.execution.maxIterations === Infinity ? '∞' : agent.execution.maxIterations}
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

          {/* 权限模式 */}
          {agent.permissions && (
            <div className="p-3 rounded-lg bg-bg-primary">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xl">🔒</span>
                <span className="font-medium">权限模式</span>
              </div>
              <div className="space-y-1">
                {agent.permissions.fileRead && (
                  <p className="text-xs text-text-secondary">
                    文件读: {agent.permissions.fileRead === 'always' ? '✓ 总是允许' : agent.permissions.fileRead}
                  </p>
                )}
                {agent.permissions.fileWrite && (
                  <p className="text-xs text-text-secondary">
                    文件写: {agent.permissions.fileWrite === 'deny' ? '✗ 禁止' : agent.permissions.fileWrite}
                  </p>
                )}
                {agent.permissions.bashExec && (
                  <p className="text-xs text-text-secondary">
                    命令执行: {agent.permissions.bashExec === 'deny' ? '✗ 禁止' : agent.permissions.bashExec}
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
      {agent.tags && agent.tags.length > 0 && (
        <div className="bg-bg-secondary rounded-lg p-4 mb-6">
          <h4 className="font-medium mb-3">🏷️ 标签</h4>
          <div className="flex gap-2 flex-wrap">
            {agent.tags.map((tag: string) => (
              <span key={tag} className="bg-primary/20 text-primary px-3 py-1 rounded-full text-sm">
                {tag}
              </span>
            ))}
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
      {isBuiltin && (
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
          <p className="text-sm text-blue-400">
            ℹ️ 内置 Agent 不可编辑或删除，但可以通过"复制"按钮创建副本后修改。
          </p>
        </div>
      )}
    </div>
  );
}
