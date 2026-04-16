// ============================================================
// Sidebar - 左侧边栏组件（导航入口）
// ============================================================
// 🆕 连续会话模式：移除会话列表，仅保留导航入口

import { Settings, HelpCircle, Bot, Wrench, FileText, Package, Server, Brain, MessageSquare } from 'lucide-react';

interface SidebarProps {
  onToggle: () => void;
  onOpenSettings: () => void;
  onOpenAgents: () => void;
  onOpenSkills: () => void;
  onOpenTools: () => void;
  onOpenMCP: () => void;
  onOpenSystemPrompt: () => void;
  onOpenMemory: () => void;
}

export default function Sidebar({ onToggle: _onToggle, onOpenSettings, onOpenAgents, onOpenSkills, onOpenTools, onOpenMCP, onOpenSystemPrompt, onOpenMemory }: SidebarProps) {
  return (
    <div className="w-56 bg-bg-secondary flex flex-col border-r border-bg-tertiary">
      {/* 顶部：当前对话 */}
      <div className="p-4 border-b border-bg-tertiary">
        <button className="w-full flex items-center gap-3 px-3 py-2 rounded bg-primary/10 border border-primary/30 hover:bg-primary/20 transition-colors">
          <MessageSquare size={18} className="text-primary" />
          <span className="text-sm font-medium text-primary">Xuanji</span>
        </button>
      </div>

      {/* 间隔 */}
      <div className="flex-1"></div>

      {/* 底部快捷入口 */}
      <div className="border-t border-bg-tertiary p-2 space-y-1">
        <button
          onClick={onOpenAgents}
          className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-bg-tertiary transition-colors text-sm"
        >
          <Bot size={16} className="text-text-secondary" />
          <span>Agents</span>
        </button>

        <button
          onClick={onOpenSkills}
          className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-bg-tertiary transition-colors text-sm"
        >
          <Package size={16} className="text-text-secondary" />
          <span>Skills</span>
        </button>

        <button
          onClick={onOpenTools}
          className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-bg-tertiary transition-colors text-sm"
        >
          <Wrench size={16} className="text-text-secondary" />
          <span>Tools</span>
        </button>

        <button
          onClick={onOpenMCP}
          className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-bg-tertiary transition-colors text-sm"
        >
          <Server size={16} className="text-text-secondary" />
          <span>MCP</span>
        </button>

        <button
          onClick={onOpenSystemPrompt}
          className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-bg-tertiary transition-colors text-sm"
        >
          <FileText size={16} className="text-text-secondary" />
          <span>System Prompt</span>
        </button>

        <button
          onClick={onOpenMemory}
          className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-bg-tertiary transition-colors text-sm"
        >
          <Brain size={16} className="text-text-secondary" />
          <span>Memory</span>
        </button>

        <button
          onClick={onOpenSettings}
          className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-bg-tertiary transition-colors text-sm"
        >
          <Settings size={16} className="text-text-secondary" />
          <span>设置</span>
        </button>

        <button
          onClick={() => window.open('https://github.com/shibit/xuanji', '_blank')}
          className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-bg-tertiary transition-colors text-sm"
        >
          <HelpCircle size={16} className="text-text-secondary" />
          <span>帮助</span>
        </button>
      </div>
    </div>
  );
}
