// ============================================================
// Xuanji Desktop - Sidebar 组件（新架构）
// ============================================================
// 三级导航结构：
// - 💬 对话（会话列表、新建会话、Checkpoint）
// - ⚙️ 配置（系统设置、Agents、Skills、Tools）
// - 📊 监控（切换 Inspector Panel 的 Tab）
// - 🔧 工具（压缩、统计、诊断）
// ============================================================

import React from 'react';
import {
  MessageSquare,
  Plus,
  Clock,
  Settings,
  Bot,
  Sparkles,
  Wrench,
  BarChart3,
  Activity,
  Stethoscope,
  Shrink,
  Eye,
  FileCode,
  Database,
  FileText,
  ChevronRight,
  Brain,
} from 'lucide-react';

interface SidebarProps {
  currentView: string;
  onNavigate: (view: string) => void;
  onShowInspectorTab?: (tab: string) => void;
  onCompact?: () => void;
  onShowStats?: () => void;
  onShowDiagnostics?: () => void;
}

type NavSection = 'conversation' | 'config' | 'monitor' | 'utility';

interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  action: () => void;
  badge?: string | number;
}

export default function Sidebar({
  currentView,
  onNavigate,
  onShowInspectorTab,
  onCompact,
  onShowStats,
  onShowDiagnostics,
}: SidebarProps) {
  const [expandedSection, setExpandedSection] = React.useState<NavSection | null>('conversation');

  // ========== 对话域 ==========
  const conversationItems: NavItem[] = [
    {
      id: 'chat',
      label: '对话',
      icon: <MessageSquare size={16} />,
      action: () => onNavigate('chat'),
    },
    {
      id: 'new-chat',
      label: '新建会话',
      icon: <Plus size={16} />,
      action: () => {
        // TODO: 实现新建会话逻辑
        onNavigate('chat');
      },
    },
    {
      id: 'checkpoint',
      label: 'Checkpoint',
      icon: <Clock size={16} />,
      action: () => {
        // 切换到 Inspector Panel 的 Checkpoint Tab
        onShowInspectorTab?.('checkpoint');
      },
    },
  ];

  // ========== 配置域 ==========
  const configItems: NavItem[] = [
    {
      id: 'settings',
      label: '系统设置',
      icon: <Settings size={16} />,
      action: () => onNavigate('settings'),
    },
    {
      id: 'agents',
      label: 'Agents',
      icon: <Bot size={16} />,
      action: () => onNavigate('agents'),
    },
    {
      id: 'skills',
      label: 'Skills',
      icon: <Sparkles size={16} />,
      action: () => onNavigate('skills'),
    },
    {
      id: 'tools',
      label: 'Tools',
      icon: <Wrench size={16} />,
      action: () => onNavigate('tools'),
    },
    {
      id: 'memory',
      label: '记忆浏览器',
      icon: <Brain size={16} />,
      action: () => onNavigate('memory'),
    },
    {
      id: 'lessons',
      label: '经验教训',
      icon: <Sparkles size={16} />,
      action: () => onNavigate('lessons'),
    },
  ];

  // ========== 监控域 ==========
  const monitorItems: NavItem[] = [
    {
      id: 'agent-monitor',
      label: 'Agent 状态',
      icon: <Eye size={16} />,
      action: () => onShowInspectorTab?.('agent'),
    },
    {
      id: 'tool-monitor',
      label: '工具调用',
      icon: <BarChart3 size={16} />,
      action: () => onShowInspectorTab?.('tool'),
    },
    {
      id: 'context-view',
      label: '上下文',
      icon: <FileCode size={16} />,
      action: () => onShowInspectorTab?.('context'),
    },
    {
      id: 'memory-view',
      label: '记忆库',
      icon: <Database size={16} />,
      action: () => onShowInspectorTab?.('memory'),
    },
    {
      id: 'logs-view',
      label: '日志',
      icon: <FileText size={16} />,
      action: () => onShowInspectorTab?.('logs'),
    },
  ];

  // ========== 工具域 ==========
  const utilityItems: NavItem[] = [
    {
      id: 'compact',
      label: '压缩上下文',
      icon: <Shrink size={16} />,
      action: () => onCompact?.(),
    },
    {
      id: 'stats',
      label: '使用统计',
      icon: <Activity size={16} />,
      action: () => onShowStats?.(),
    },
    {
      id: 'diagnostics',
      label: '系统诊断',
      icon: <Stethoscope size={16} />,
      action: () => onShowDiagnostics?.(),
    },
  ];

  const toggleSection = (section: NavSection) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  const renderSection = (
    section: NavSection,
    title: string,
    icon: React.ReactNode,
    items: NavItem[]
  ) => {
    const isExpanded = expandedSection === section;

    return (
      <div className="mb-2">
        {/* 分组标题 */}
        <button
          onClick={() => toggleSection(section)}
          className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-text-secondary hover:bg-bg-tertiary rounded transition-colors"
        >
          <div className="flex items-center gap-2">
            {icon}
            <span>{title}</span>
          </div>
          <ChevronRight
            size={14}
            className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}
          />
        </button>

        {/* 子项 */}
        {isExpanded && (
          <div className="mt-1 space-y-0.5">
            {items.map((item) => (
              <button
                key={item.id}
                onClick={item.action}
                className={`w-full flex items-center justify-between gap-2 pl-8 pr-3 py-2 text-sm rounded transition-colors ${
                  currentView === item.id
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-text-primary hover:bg-bg-tertiary'
                }`}
              >
                <div className="flex items-center gap-2">
                  {item.icon}
                  <span>{item.label}</span>
                </div>
                {item.badge && (
                  <span className="text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded">
                    {item.badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-full bg-bg-secondary flex flex-col border-r border-bg-tertiary">
      {/* Logo */}
      <div className="p-4 border-b border-bg-tertiary">
        <div className="flex items-center gap-2">
          <span className="text-2xl">⭐</span>
          <div>
            <div className="font-bold text-primary">Xuanji</div>
            <div className="text-xs text-text-secondary">璇玑</div>
          </div>
        </div>
      </div>

      {/* 导航区域 */}
      <div className="flex-1 overflow-y-auto p-2">
        {renderSection(
          'conversation',
          '对话',
          <MessageSquare size={16} />,
          conversationItems
        )}

        {renderSection(
          'config',
          '配置',
          <Settings size={16} />,
          configItems
        )}

        {renderSection(
          'monitor',
          '监控',
          <BarChart3 size={16} />,
          monitorItems
        )}

        {renderSection(
          'utility',
          '工具',
          <Wrench size={16} />,
          utilityItems
        )}
      </div>

      {/* 底部用户区域 */}
      <div className="p-3 border-t border-bg-tertiary">
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <div className="w-8 h-8 bg-primary/20 rounded-full flex items-center justify-center text-primary font-bold">
            U
          </div>
          <div className="flex-1">
            <div className="text-text-primary font-medium">用户</div>
            <div className="text-xs">本地模式</div>
          </div>
        </div>
      </div>
    </div>
  );
}
