// ============================================================
// ExecutionPanel - Agent 执行面板组件（右侧执行过程展示）
// ============================================================
// 显示：
// - Agent 执行树（team/sub agent 层级）
// - 工具调用实时状态（按分类展示）
// - TODO 列表和进度
// - 权限交互状态
// - 系统状态（Token/成本/迭代）
// ============================================================

import React, { useState } from 'react';
import {
  GitBranch,
  Wrench,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Circle,
  PlayCircle,
  Shield,
  Activity,
  FileText,
  Terminal,
  Brain,
  Users,
  HelpCircle,
} from 'lucide-react';
import { useExecutionStore, type AgentExecutionNode, type ToolExecution, type TodoItem, type PermissionInteraction } from '../stores/executionStore';

export default function ExecutionPanel() {
  const [activeSection, setActiveSection] = useState<'agents' | 'tools' | 'todos' | 'permissions' | 'system'>('agents');

  return (
    <div className="h-full flex flex-col">
      {/* 切换按钮 */}
      <div className="flex border-b border-bg-tertiary overflow-x-auto">
        <TabButton
          icon={<GitBranch size={14} />}
          label="执行树"
          active={activeSection === 'agents'}
          onClick={() => setActiveSection('agents')}
        />
        <TabButton
          icon={<Wrench size={14} />}
          label="工具"
          active={activeSection === 'tools'}
          onClick={() => setActiveSection('tools')}
        />
        <TabButton
          icon={<CheckSquare size={14} />}
          label="TODO"
          active={activeSection === 'todos'}
          onClick={() => setActiveSection('todos')}
        />
        <TabButton
          icon={<Shield size={14} />}
          label="权限"
          active={activeSection === 'permissions'}
          onClick={() => setActiveSection('permissions')}
        />
        <TabButton
          icon={<Activity size={14} />}
          label="系统"
          active={activeSection === 'system'}
          onClick={() => setActiveSection('system')}
        />
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeSection === 'agents' && <AgentTreeSection />}
        {activeSection === 'tools' && <ToolsSection />}
        {activeSection === 'todos' && <TodosSection />}
        {activeSection === 'permissions' && <PermissionsSection />}
        {activeSection === 'system' && <SystemSection />}
      </div>
    </div>
  );
}

// ========== Tab 按钮组件 ==========
function TabButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 text-sm transition-colors whitespace-nowrap ${
        active
          ? 'bg-bg-primary text-primary border-b-2 border-primary'
          : 'text-text-secondary hover:bg-bg-tertiary'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

// ========== Agent 执行树 ==========
function AgentTreeSection() {
  const rootAgent = useExecutionStore((state) => state.rootAgent);

  if (!rootAgent) {
    return (
      <div className="text-center text-sm text-text-secondary py-8">
        暂无执行中的任务
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="text-sm font-semibold mb-3">🌳 Agent 执行层级</div>
      <AgentTreeNode node={rootAgent} />
    </div>
  );
}

function AgentTreeNode({ node }: { node: AgentExecutionNode }) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;

  const getIcon = () => {
    switch (node.status) {
      case 'running':
        return <Loader2 size={14} className="animate-spin text-primary" />;
      case 'completed':
        return <CheckCircle2 size={14} className="text-green-500" />;
      case 'failed':
        return <XCircle size={14} className="text-red-500" />;
      default:
        return <Circle size={14} className="text-text-secondary" />;
    }
  };

  const getTypeLabel = () => {
    switch (node.type) {
      case 'main':
        return '主 Agent';
      case 'team':
        return 'Agent Team';
      case 'sub-agent':
        return 'Sub Agent';
      default:
        return 'Agent';
    }
  };

  const getDuration = () => {
    if (!node.startTime) return null;
    const end = node.endTime || Date.now();
    const duration = end - node.startTime;
    return `${(duration / 1000).toFixed(1)}s`;
  };

  return (
    <div style={{ marginLeft: node.depth > 0 ? '16px' : '0' }}>
      <div
        className={`flex items-center gap-2 p-2 rounded ${
          node.status === 'running' ? 'bg-primary/10' : 'bg-bg-primary'
        }`}
      >
        {/* 展开/折叠 */}
        {hasChildren ? (
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex-shrink-0 hover:bg-bg-tertiary rounded p-0.5 transition-colors"
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <div className="w-[22px]" />
        )}

        {/* 状态图标 */}
        {getIcon()}

        {/* Agent 信息 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{node.name}</span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-bg-secondary text-text-secondary">
              {getTypeLabel()}
            </span>
          </div>
          {node.currentTask && (
            <div className="text-xs text-text-secondary truncate mt-0.5">
              {node.currentTask}
            </div>
          )}
        </div>

        {/* 耗时 */}
        {getDuration() && (
          <div className="text-xs text-text-secondary flex items-center gap-1">
            <Clock size={12} />
            <span>{getDuration()}</span>
          </div>
        )}
      </div>

      {/* 子节点 */}
      {hasChildren && expanded && (
        <div className="mt-1 space-y-1">
          {node.children.map((child) => (
            <AgentTreeNode key={child.id} node={child} />
          ))}
        </div>
      )}
    </div>
  );
}

// ========== 工具调用列表（按分类展示）==========
function ToolsSection() {
  const toolExecutions = useExecutionStore((state) => state.toolExecutions);
  const activeTools = useExecutionStore((state) => state.activeTools);

  // 按时间倒序
  const sortedTools = [...toolExecutions].sort((a, b) => b.startTime - a.startTime);

  // 按分类分组
  const toolsByCategory = sortedTools.reduce((acc, tool) => {
    const category = tool.category || 'other';
    if (!acc[category]) acc[category] = [];
    acc[category].push(tool);
    return acc;
  }, {} as Record<string, ToolExecution[]>);

  // 统计
  const activeCount = activeTools.size;
  const successCount = toolExecutions.filter((t) => t.status === 'success').length;
  const errorCount = toolExecutions.filter((t) => t.status === 'error').length;

  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold mb-2">🔧 工具调用</div>

      {/* 统计 */}
      <div className="flex gap-2 text-xs flex-wrap">
        <div className="px-2 py-1 bg-primary/10 text-primary rounded">
          执行中: {activeCount}
        </div>
        <div className="px-2 py-1 bg-green-500/10 text-green-500 rounded">
          成功: {successCount}
        </div>
        <div className="px-2 py-1 bg-red-500/10 text-red-500 rounded">
          失败: {errorCount}
        </div>
      </div>

      {/* 工具列表 */}
      {sortedTools.length === 0 ? (
        <div className="text-center text-sm text-text-secondary py-8">
          暂无工具调用记录
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(toolsByCategory).map(([category, tools]) => (
            <ToolCategoryGroup key={category} category={category as ToolExecution['category']} tools={tools} />
          ))}
        </div>
      )}
    </div>
  );
}

function ToolCategoryGroup({ category, tools }: { category: ToolExecution['category']; tools: ToolExecution[] }) {
  const [expanded, setExpanded] = useState(true);

  const getCategoryInfo = () => {
    switch (category) {
      case 'file':
        return { icon: <FileText size={14} />, label: '文件操作', color: 'text-blue-500' };
      case 'bash':
        return { icon: <Terminal size={14} />, label: 'Shell命令', color: 'text-green-500' };
      case 'memory':
        return { icon: <Brain size={14} />, label: '记忆管理', color: 'text-purple-500' };
      case 'session':
        return { icon: <GitBranch size={14} />, label: '会话管理', color: 'text-orange-500' };
      case 'permission':
        return { icon: <Shield size={14} />, label: '权限交互', color: 'text-yellow-500' };
      case 'agent':
        return { icon: <Users size={14} />, label: 'Agent管理', color: 'text-indigo-500' };
      default:
        return { icon: <HelpCircle size={14} />, label: '其他工具', color: 'text-gray-500' };
    }
  };

  const info = getCategoryInfo();

  return (
    <div className="space-y-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-xs font-semibold text-text-secondary hover:text-text-primary transition-colors w-full"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className={info.color}>{info.icon}</span>
        <span>{info.label}</span>
        <span className="text-xs text-text-secondary">({tools.length})</span>
      </button>
      {expanded && (
        <div className="space-y-2 ml-4">
          {tools.map((tool) => (
            <ToolExecutionItem key={tool.id} tool={tool} />
          ))}
        </div>
      )}
    </div>
  );
}

function ToolExecutionItem({ tool }: { tool: ToolExecution }) {
  const [expanded, setExpanded] = useState(false);

  const getStatusIcon = () => {
    switch (tool.status) {
      case 'running':
        return <Loader2 size={14} className="animate-spin text-primary" />;
      case 'success':
        return <CheckCircle2 size={14} className="text-green-500" />;
      case 'error':
        return <XCircle size={14} className="text-red-500" />;
      default:
        return <Clock size={14} className="text-text-secondary" />;
    }
  };

  return (
    <div className="p-2 bg-bg-primary rounded">
      <div
        className="flex items-center gap-2 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        {getStatusIcon()}
        <span className="text-sm font-mono flex-1">{tool.name}</span>
        {tool.duration && (
          <span className="text-xs text-text-secondary">{tool.duration}ms</span>
        )}
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </div>

      {expanded && (
        <div className="mt-2 pl-6 space-y-1 text-xs text-text-secondary">
          <div>Agent: {tool.agentName}</div>
          {tool.duration && <div>耗时: {tool.duration}ms</div>}
          {tool.input && Object.keys(tool.input).length > 0 && (
            <div className="mt-2">
              <div className="font-semibold mb-1">输入参数:</div>
              <div className="p-2 bg-bg-secondary rounded font-mono text-xs max-h-32 overflow-y-auto">
                {JSON.stringify(tool.input, null, 2)}
              </div>
            </div>
          )}
          {tool.result && (
            <div className="mt-2">
              <div className="font-semibold mb-1">输出结果:</div>
              <div className="p-2 bg-bg-secondary rounded font-mono text-xs max-h-96 overflow-y-auto whitespace-pre-wrap">
                {/* 编辑类工具显示完整 diff，其他工具截断到 500 字符 */}
                {['edit_file', 'write_file', 'multi_edit'].includes(tool.name) 
                  ? tool.result 
                  : tool.result.slice(0, 500)}
                {!['edit_file', 'write_file', 'multi_edit'].includes(tool.name) && tool.result.length > 500 && '...'}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ========== TODO 列表 ==========
function TodosSection() {
  const todos = useExecutionStore((state) => state.todos);

  // 按状态分组
  const pendingTodos = todos.filter((t) => t.status === 'pending');
  const inProgressTodos = todos.filter((t) => t.status === 'in_progress');
  const completedTodos = todos.filter((t) => t.status === 'completed');
  const failedTodos = todos.filter((t) => t.status === 'failed');

  // 统计
  const totalCount = todos.length;
  const completedCount = completedTodos.length + failedTodos.length;
  const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold mb-2">✅ TODO 列表</div>

      {/* 进度条 */}
      {totalCount > 0 && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-text-secondary">
            <span>进度</span>
            <span>
              {completedCount} / {totalCount} ({progress.toFixed(0)}%)
            </span>
          </div>
          <div className="h-2 bg-bg-secondary rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* TODO 列表 */}
      {todos.length === 0 ? (
        <div className="text-center text-sm text-text-secondary py-8">
          暂无 TODO 项
        </div>
      ) : (
        <div className="space-y-3">
          {inProgressTodos.length > 0 && (
            <TodoGroup title="🔄 进行中" todos={inProgressTodos} />
          )}
          {pendingTodos.length > 0 && (
            <TodoGroup title="⏳ 待处理" todos={pendingTodos} />
          )}
          {completedTodos.length > 0 && (
            <TodoGroup title="✅ 已完成" todos={completedTodos} />
          )}
          {failedTodos.length > 0 && (
            <TodoGroup title="❌ 失败" todos={failedTodos} />
          )}
        </div>
      )}
    </div>
  );
}

function TodoGroup({ title, todos }: { title: string; todos: TodoItem[] }) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold text-text-secondary">{title}</div>
      {todos.map((todo) => (
        <TodoItemComponent key={todo.id} todo={todo} />
      ))}
    </div>
  );
}

function TodoItemComponent({ todo }: { todo: TodoItem }) {
  const [expanded, setExpanded] = useState(false);

  const getIcon = () => {
    switch (todo.status) {
      case 'in_progress':
        return <PlayCircle size={14} className="text-primary" />;
      case 'completed':
        return <CheckCircle2 size={14} className="text-green-500" />;
      case 'failed':
        return <XCircle size={14} className="text-red-500" />;
      default:
        return <Circle size={14} className="text-text-secondary" />;
    }
  };

  const getDuration = () => {
    if (!todo.startedAt) return null;
    const end = todo.completedAt || Date.now();
    const duration = end - todo.startedAt;
    return `${(duration / 1000).toFixed(1)}s`;
  };

  return (
    <div className="p-2 bg-bg-primary rounded">
      <div
        className="flex items-start gap-2 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        {getIcon()}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{todo.subject}</div>
          {todo.status === 'in_progress' && todo.activeForm && (
            <div className="text-xs text-primary mt-1">
              {todo.activeForm}
            </div>
          )}
        </div>
        {getDuration() && (
          <div className="text-xs text-text-secondary">{getDuration()}</div>
        )}
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </div>

      {expanded && todo.description && (
        <div className="mt-2 pl-6 text-xs text-text-secondary">
          {todo.description}
        </div>
      )}
    </div>
  );
}

// ========== 权限交互 ==========
function PermissionsSection() {
  const permissionInteractions = useExecutionStore((state) => state.permissionInteractions);
  const pendingPermissions = useExecutionStore((state) => state.pendingPermissions);

  // 按时间倒序
  const sortedPermissions = [...permissionInteractions].sort((a, b) => b.requestTime - a.requestTime);

  // 统计
  const approvedCount = permissionInteractions.filter((p) => p.status === 'approved').length;
  const rejectedCount = permissionInteractions.filter((p) => p.status === 'rejected').length;

  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold mb-2">🛡️ 权限交互</div>

      {/* 统计 */}
      <div className="flex gap-2 text-xs flex-wrap">
        <div className="px-2 py-1 bg-yellow-500/10 text-yellow-500 rounded">
          待审批: {pendingPermissions.length}
        </div>
        <div className="px-2 py-1 bg-green-500/10 text-green-500 rounded">
          已批准: {approvedCount}
        </div>
        <div className="px-2 py-1 bg-red-500/10 text-red-500 rounded">
          已拒绝: {rejectedCount}
        </div>
      </div>

      {/* 权限列表 */}
      {sortedPermissions.length === 0 ? (
        <div className="text-center text-sm text-text-secondary py-8">
          暂无权限交互记录
        </div>
      ) : (
        <div className="space-y-2">
          {sortedPermissions.map((permission) => (
            <PermissionItem key={permission.id} permission={permission} />
          ))}
        </div>
      )}
    </div>
  );
}

function PermissionItem({ permission }: { permission: PermissionInteraction }) {
  const [expanded, setExpanded] = useState(false);

  const getTypeLabel = () => {
    switch (permission.type) {
      case 'permission':
        return '文件/命令权限';
      case 'plan-review':
        return 'Plan审查';
      case 'ask-user':
        return '用户问答';
      default:
        return '未知类型';
    }
  };

  const getStatusIcon = () => {
    switch (permission.status) {
      case 'pending':
        return <Clock size={14} className="text-yellow-500" />;
      case 'approved':
        return <CheckCircle2 size={14} className="text-green-500" />;
      case 'rejected':
        return <XCircle size={14} className="text-red-500" />;
    }
  };

  const getDuration = () => {
    if (!permission.respondTime) return null;
    const duration = permission.respondTime - permission.requestTime;
    return `${(duration / 1000).toFixed(1)}s`;
  };

  return (
    <div className="p-2 bg-bg-primary rounded">
      <div
        className="flex items-center gap-2 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        {getStatusIcon()}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">{getTypeLabel()}</div>
          <div className="text-xs text-text-secondary">
            {new Date(permission.requestTime).toLocaleTimeString()}
          </div>
        </div>
        {getDuration() && (
          <div className="text-xs text-text-secondary">{getDuration()}</div>
        )}
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </div>

      {expanded && (
        <div className="mt-2 pl-6 space-y-1 text-xs text-text-secondary">
          <div className="p-2 bg-bg-secondary rounded max-h-32 overflow-y-auto">
            {JSON.stringify(permission.data, null, 2)}
          </div>
        </div>
      )}
    </div>
  );
}

// ========== 系统状态 ==========
function SystemSection() {
  const systemStatus = useExecutionStore((state) => state.systemStatus);

  return (
    <div className="space-y-4">
      <div className="text-sm font-semibold mb-2">📊 系统状态</div>

      {/* Token 使用 */}
      <div className="space-y-2">
        <div className="text-xs font-semibold text-text-secondary">Token 使用</div>
        <div className="grid grid-cols-3 gap-2">
          <div className="p-2 bg-bg-primary rounded">
            <div className="text-xs text-text-secondary">输入</div>
            <div className="text-lg font-semibold">{systemStatus.tokenUsage.input.toLocaleString()}</div>
          </div>
          <div className="p-2 bg-bg-primary rounded">
            <div className="text-xs text-text-secondary">输出</div>
            <div className="text-lg font-semibold">{systemStatus.tokenUsage.output.toLocaleString()}</div>
          </div>
          <div className="p-2 bg-bg-primary rounded">
            <div className="text-xs text-text-secondary">缓存</div>
            <div className="text-lg font-semibold">{systemStatus.tokenUsage.cached.toLocaleString()}</div>
          </div>
        </div>
      </div>

      {/* 成本 */}
      <div className="space-y-2">
        <div className="text-xs font-semibold text-text-secondary">成本</div>
        <div className="p-2 bg-bg-primary rounded">
          <div className="text-2xl font-semibold">
            ${systemStatus.cost.toFixed(4)}
          </div>
        </div>
      </div>

      {/* 迭代次数 */}
      <div className="space-y-2">
        <div className="text-xs font-semibold text-text-secondary">当前迭代</div>
        <div className="p-2 bg-bg-primary rounded">
          <div className="text-2xl font-semibold">
            {systemStatus.currentIteration}
          </div>
        </div>
      </div>

      {/* MCP 服务器 */}
      {systemStatus.mcpServers.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-semibold text-text-secondary">MCP 服务器</div>
          <div className="space-y-1">
            {systemStatus.mcpServers.map((server, index) => (
              <div key={index} className="p-2 bg-bg-primary rounded flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">{server.name}</div>
                  <div className="text-xs text-text-secondary">{server.toolsCount} 个工具</div>
                </div>
                <div
                  className={`text-xs px-2 py-1 rounded ${
                    server.status === 'connected'
                      ? 'bg-green-500/10 text-green-500'
                      : 'bg-red-500/10 text-red-500'
                  }`}
                >
                  {server.status === 'connected' ? '已连接' : '已断开'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
