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
