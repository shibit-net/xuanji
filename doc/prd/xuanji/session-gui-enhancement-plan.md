# 基于现有 GUI 的记忆驱动会话管理增强方案

## 设计日期
2026-03-16

## 概述

基于璇玑现有的 GUI 架构（TitleBar + Sidebar + 中间区 + RightPanel + StatusBar），渐进式增强会话管理功能，实现记忆驱动的会话保存、恢复和检索。

---

## 一、现有架构分析

### 1.1 当前布局

```
┌─ TitleBar ──────────────────────────────────────────┐
│ 璇玑 Xuanji        [压缩] [统计] [诊断] [右侧栏]    │
├──────────┬────────────────────────┬──────────────────┤
│ Sidebar  │  中间内容区             │  RightPanel      │
│          │                        │  (可选)          │
│ - 搜索   │  [ViewMode 切换]       │                  │
│ - 新建   │  - chat: ChatArea +    │  - 当前会话信息  │
│ - 会话   │    InputArea           │  - 工具调用      │
│   列表   │  - settings: Settings  │  - 统计数据      │
│ - 导航   │  - memory: Memory      │                  │
│   按钮   │  - agents: Agents      │                  │
│          │  - ...                 │                  │
│ 220px    │                        │  280px           │
├──────────┴────────────────────────┴──────────────────┤
│ StatusBar - 模型/Token/成本统计                      │
└──────────────────────────────────────────────────────┘
```

### 1.2 已有功能

✅ **Sidebar（会话列表）**:
- 搜索会话（简单文本匹配）
- 新建会话
- 按日期分组（今天/昨天/日期）
- 恢复会话（加载历史消息）
- 删除会话

✅ **ViewMode 系统**:
- chat, settings, agents, skills, tools, mcp, system-prompt, memory
- 切换不同管理面板

✅ **ChatArea**:
- 消息气泡展示
- 自动滚动
- 空状态提示

✅ **chatStore**:
- 消息管理
- 流式输出
- 工具调用状态
- 权限交互

### 1.3 缺失功能（需增强）

❌ 会话摘要和分类
❌ 语义搜索
❌ 会话-记忆关联
❌ 会话详情视图
❌ 智能保存流程
❌ 上下文预览

---

## 二、增强方案（渐进式）

### Phase 1: Sidebar 会话列表增强

#### 目标
在现有 Sidebar 基础上，添加会话分类、摘要预览、语义搜索。

#### 实现

**文件**: `desktop/renderer/components/Sidebar.tsx`（修改）

```tsx
// 1. 新增分组模式切换
type GroupMode = 'time' | 'category' | 'tags';

const [groupMode, setGroupMode] = useState<GroupMode>('time');

// 2. 按分类分组（新）
const groupByCategory = (sessions: SessionListItem[]) => {
  const groups: Record<string, SessionListItem[]> = {
    '💻 编程': [],
    '🐛 调试': [],
    '📚 学习': [],
    '🌍 生活': [],
    '📋 规划': [],
    '💬 其他': [],
  };

  sessions.forEach(session => {
    const category = session.category || 'other';
    const key = CATEGORY_LABELS[category] || '💬 其他';
    groups[key].push(session);
  });

  return groups;
};

// 3. 会话卡片增强（显示摘要和分类）
<div className="session-card">
  {/* 分类图标 */}
  <div className="category-icon">{CATEGORY_ICONS[session.category]}</div>

  {/* 会话名称 */}
  <div className="font-medium">{session.name}</div>

  {/* 摘要预览（悬停展开） */}
  {session.preview && (
    <div className="text-xs text-text-secondary truncate">
      {session.preview}
    </div>
  )}

  {/* 标签 */}
  {session.tags && (
    <div className="flex gap-1 mt-1">
      {session.tags.slice(0, 2).map(tag => (
        <span className="tag">{tag}</span>
      ))}
    </div>
  )}

  {/* 统计信息 */}
  <div className="text-xs text-text-tertiary mt-1">
    💬 {session.messageCount} 条 • {timeAgo}
  </div>
</div>
```

**视觉效果**:

```
┌─ Sidebar ──────────────────────────┐
│ 🔍 [搜索会话...]                   │
├────────────────────────────────────┤
│ [+ 新建会话]                       │
├────────────────────────────────────┤
│ 分组: [时间▼] [分类] [标签]       │ ← 新增
├────────────────────────────────────┤
│                                    │
│ ▼ 💻 编程 (12)                     │ ← 按分类分组
│                                    │
│ ┌────────────────────────────┐   │
│ │ 🐛 修复用户登录 403 错误    │   │
│ │ 排查 JWT 验证逻辑...       │   │ ← 摘要预览
│ │ 🏷️ bug-fix auth             │   │ ← 标签
│ │ 💬 42 条 • 2h 前           │   │
│ └────────────────────────────┘   │
│                                    │
│ ┌────────────────────────────┐   │
│ │ 💻 实现用户偏好设置功能     │   │
│ │ 添加前端配置界面...        │   │
│ │ 🏷️ feature ui              │   │
│ │ 💬 28 条 • 3h 前           │   │
│ └────────────────────────────┘   │
│                                    │
│ ▶ 🐛 调试 (8)                      │
│ ▶ 📚 学习 (6)                      │
│                                    │
└────────────────────────────────────┘
```

---

### Phase 2: 新增 SessionPanel 视图

#### 目标
添加专门的会话管理视图（类似 MemoryManager），支持网格展示、详情查看、语义搜索。

#### 实现

**文件**: `desktop/renderer/components/SessionManager.tsx`（新建）

```tsx
// SessionManager.tsx
export default function SessionManager({ onClose }: { onClose: () => void }) {
  const [viewMode, setViewMode] = useState<'list' | 'grid' | 'graph'>('grid');
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <div className="flex flex-col h-full bg-bg-primary">
      {/* 顶部工具栏 */}
      <div className="flex items-center justify-between p-4 border-b">
        <h2 className="text-xl font-bold">会话管理</h2>
        <div className="flex gap-2">
          {/* 视图切换 */}
          <button onClick={() => setViewMode('list')}>列表</button>
          <button onClick={() => setViewMode('grid')}>网格</button>
          <button onClick={() => setViewMode('graph')}>图谱</button>
          <button onClick={onClose}>关闭</button>
        </div>
      </div>

      {/* 搜索和筛选 */}
      <div className="p-4 border-b">
        <input
          placeholder="语义搜索会话..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <div className="flex gap-2 mt-2">
          <select>{/* 分类筛选 */}</select>
          <select>{/* 标签筛选 */}</select>
          <select>{/* 时间筛选 */}</select>
        </div>
      </div>

      {/* 主内容区 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧：会话列表/网格 */}
        <div className="flex-1 overflow-auto p-4">
          {viewMode === 'grid' ? (
            <SessionGrid sessions={sessions} onSelect={setSelectedSession} />
          ) : viewMode === 'list' ? (
            <SessionList sessions={sessions} onSelect={setSelectedSession} />
          ) : (
            <SessionGraph sessions={sessions} onSelect={setSelectedSession} />
          )}
        </div>

        {/* 右侧：会话详情 */}
        {selectedSession && (
          <div className="w-80 border-l overflow-auto">
            <SessionDetail sessionId={selectedSession} onClose={() => setSelectedSession(null)} />
          </div>
        )}
      </div>
    </div>
  );
}
```

**网格视图**:

```
┌─ 会话管理 ────────────────────────────────────────┐
│ 会话管理               [列表] [网格✓] [图谱] [✕]  │
├────────────────────────────────────────────────────┤
│ 🔍 [语义搜索...]   [分类▼] [标签▼] [时间▼]       │
├────────────────────────────────────────────────────┤
│                                                    │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│ │🐛 修复   │ │💻 实现   │ │📚 学习   │          │
│ │登录 bug  │ │用户设置  │ │Hooks     │          │
│ │          │ │          │ │          │          │
│ │42 条消息 │ │28 条消息 │ │15 条消息 │          │
│ │2h 前     │ │3h 前     │ │5h 前     │          │
│ │✓ 已完成  │ │⏸ 进行中 │ │✓ 已完成  │          │
│ │          │ │60%       │ │          │          │
│ │$0.15     │ │$0.08     │ │$0.03     │          │
│ └──────────┘ └──────────┘ └──────────┘          │
│                                                    │
│ ┌──────────┐ ┌──────────┐                        │
│ │...       │ │...       │                        │
│ └──────────┘ └──────────┘                        │
│                                                    │
└────────────────────────────────────────────────────┘
```

---

### Phase 3: 增强 RightPanel（会话上下文）

#### 目标
在对话模式下，右侧面板显示当前会话的摘要、关键点、记忆引用。

#### 实现

**文件**: `desktop/renderer/components/RightPanel.tsx`（修改）

```tsx
export default function RightPanel({ onToggle }: RightPanelProps) {
  const [activeTab, setActiveTab] = useState<'context' | 'tools' | 'stats'>('context');
  const currentSession = useCurrentSession(); // 新增 hook

  return (
    <div className="w-80 border-l flex flex-col">
      {/* Tab 切换 */}
      <div className="flex border-b">
        <button onClick={() => setActiveTab('context')}>
          上下文
        </button>
        <button onClick={() => setActiveTab('tools')}>
          工具
        </button>
        <button onClick={() => setActiveTab('stats')}>
          统计
        </button>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-auto p-4">
        {activeTab === 'context' && currentSession && (
          <SessionContext session={currentSession} />
        )}
        {activeTab === 'tools' && <ToolCallsList />}
        {activeTab === 'stats' && <StatsPanel />}
      </div>
    </div>
  );
}

// 新增：会话上下文组件
function SessionContext({ session }: { session: SessionMetadata }) {
  return (
    <div className="space-y-4">
      {/* 会话摘要 */}
      {session.summary && (
        <div>
          <h3 className="font-bold mb-2">📝 会话摘要</h3>
          <div className="text-sm">
            <p><strong>目标:</strong> {session.summary.goal}</p>
            <p><strong>结果:</strong> {session.summary.outcome}</p>
          </div>
        </div>
      )}

      {/* 关键点 */}
      {session.keyPoints && session.keyPoints.length > 0 && (
        <div>
          <h3 className="font-bold mb-2">🔑 关键点 ({session.keyPoints.length})</h3>
          <ul className="text-sm space-y-1">
            {session.keyPoints.map((point, i) => (
              <li key={i}>
                <span className={`type-${point.type}`}>[{point.type}]</span>
                {point.content}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 生成的记忆 */}
      {session.memoryRefs && session.memoryRefs.length > 0 && (
        <div>
          <h3 className="font-bold mb-2">🧠 生成记忆 ({session.memoryRefs.length})</h3>
          <MemoryRefsList memoryIds={session.memoryRefs} />
        </div>
      )}

      {/* 相关会话 */}
      <div>
        <h3 className="font-bold mb-2">🔗 相关会话</h3>
        <RelatedSessionsList sessionId={session.id} />
      </div>
    </div>
  );
}
```

**视觉效果**:

```
┌─ RightPanel ───────────────────────┐
│ [上下文✓] [工具] [统计]            │
├────────────────────────────────────┤
│                                    │
│ 📝 会话摘要                        │
│ ┌────────────────────────────┐   │
│ │ 目标: 排查并修复登录 403   │   │
│ │ 结果: ✓ 已解决             │   │
│ └────────────────────────────┘   │
│                                    │
│ 🔑 关键点 (3)                      │
│ • [决策] JWT 过期时间改为 24h     │
│ • [发现] 老客户端兼容性问题       │
│ • [错误] UserService 空指针       │
│                                    │
│ 🧠 生成记忆 (3)                    │
│ • JWT 配置最佳实践 (Fact)         │
│ • 登录错误排查步骤 (Resolution)   │
│ • 会话摘要 (Timeline)             │
│                                    │
│ 🔗 相关会话 (2)                    │
│ • 实现 JWT 认证中间件             │
│ • 用户权限系统重构                │
│                                    │
└────────────────────────────────────┘
```

---

### Phase 4: 智能保存流程

#### 目标
保存会话时弹出确认对话框，展示 AI 生成的摘要和关键点，允许用户编辑。

#### 实现

**文件**: `desktop/renderer/components/SessionSaveDialog.tsx`（新建）

```tsx
export default function SessionSaveDialog({ onClose, onSave }: Props) {
  const [loading, setLoading] = useState(true);
  const [sessionData, setSessionData] = useState<SessionDraft | null>(null);

  useEffect(() => {
    // 调用后端生成摘要
    generateSummary().then(data => {
      setSessionData(data);
      setLoading(false);
    });
  }, []);

  return (
    <div className="dialog-overlay">
      <div className="dialog w-[600px]">
        <h2>保存会话</h2>

        {loading ? (
          <div className="loading">
            ⏳ AI 正在分析会话内容...
            <progress value={progress} max={100} />
          </div>
        ) : (
          <div className="space-y-4">
            {/* 会话名称 */}
            <input
              placeholder="会话名称"
              value={sessionData.name}
              onChange={(e) => setSessionData({...sessionData, name: e.target.value})}
            />

            {/* 分类 */}
            <select value={sessionData.category}>
              <option value="coding">💻 编程</option>
              <option value="debugging">🐛 调试</option>
              {/* ... */}
            </select>

            {/* 标签 */}
            <TagInput tags={sessionData.tags} onChange={...} />

            {/* AI 生成的摘要（可编辑） */}
            <div>
              <label>📝 摘要 <button>编辑</button></label>
              <textarea value={sessionData.summary.goal} />
            </div>

            {/* 关键点（可勾选） */}
            <div>
              <label>🔑 关键点（将生成记忆）</label>
              {sessionData.keyPoints.map(point => (
                <div key={point.id}>
                  <input
                    type="checkbox"
                    checked={point.selected}
                    onChange={...}
                  />
                  <span>[{point.type}] {point.content}</span>
                </div>
              ))}
            </div>

            {/* 选项 */}
            <div>
              <label>
                <input type="checkbox" checked={true} />
                只保存最近 10 条消息（推荐，节省 65% tokens）
              </label>
            </div>

            {/* 统计预览 */}
            <div className="stats-preview">
              将生成 {selectedKeyPoints.length} 条记忆
              • Token 节省: 65%
              • 存储空间: 2.3 KB
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose}>取消</button>
          <button onClick={handleSave} disabled={loading}>
            保存会话
          </button>
        </div>
      </div>
    </div>
  );
}
```

**调用方式**:

在 `TitleBar` 或 `InputArea` 添加"保存会话"按钮/快捷键（Ctrl+S）。

---

### Phase 5: 智能恢复流程

#### 目标
恢复会话时显示预览弹窗，展示摘要和将要加载的记忆。

#### 实现

**文件**: `desktop/renderer/components/SessionResumeDialog.tsx`（新建）

```tsx
export default function SessionResumeDialog({ sessionId, onClose, onConfirm }: Props) {
  const [preview, setPreview] = useState<SessionPreview | null>(null);

  useEffect(() => {
    loadSessionPreview(sessionId).then(setPreview);
  }, [sessionId]);

  if (!preview) return <LoadingSpinner />;

  return (
    <div className="dialog-overlay">
      <div className="dialog w-[500px]">
        <h2>恢复会话</h2>

        <div className="space-y-4">
          {/* 会话基本信息 */}
          <div>
            <h3>{preview.name}</h3>
            <div className="text-sm text-text-secondary">
              {preview.category} • {preview.messageCount} 条消息 • {timeAgo}
            </div>
          </div>

          {/* 摘要 */}
          <div>
            <h4>📝 会话摘要</h4>
            <p>{preview.summary?.goal}</p>
            <p><strong>结果:</strong> {preview.summary?.outcome}</p>
          </div>

          {/* 关键点 */}
          <div>
            <h4>🔑 {preview.keyPoints.length} 个关键点</h4>
            <ul>
              {preview.keyPoints.slice(0, 3).map(point => (
                <li key={point.id}>• {point.content}</li>
              ))}
            </ul>
          </div>

          {/* 记忆预览 */}
          <div>
            <h4>🧠 将加载 {preview.relatedMemories.length} 条相关记忆</h4>
            <ul className="text-sm">
              {preview.relatedMemories.slice(0, 3).map(m => (
                <li key={m.id}>• {m.content.slice(0, 50)}...</li>
              ))}
            </ul>
          </div>

          {/* Token 节省提示 */}
          <div className="bg-green-50 p-3 rounded">
            💡 将恢复最近 10 条消息（共 {preview.messageCount} 条）
            <br />
            Token 节省: <strong>{preview.tokenSavings}%</strong>
          </div>

          {/* 选项 */}
          <div>
            <label>
              <input type="checkbox" defaultChecked />
              加载相关记忆（推荐）
            </label>
            <label>
              <input type="checkbox" />
              加载完整历史（{preview.messageCount} 条，不推荐）
            </label>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose}>取消</button>
          <button onClick={handleConfirm} className="btn-primary">
            恢复会话
          </button>
        </div>
      </div>
    </div>
  );
}
```

**调用方式**:

在 Sidebar 会话列表中点击会话时，弹出预览对话框。

---

## 三、数据流设计

### 3.1 Store 扩展

**文件**: `desktop/renderer/stores/sessionStore.ts`（新建）

```tsx
import { create } from 'zustand';

interface SessionStore {
  // 当前会话元数据
  currentSession: SessionMetadata | null;

  // 会话列表（带缓存）
  sessions: SessionListItem[];
  sessionsLoading: boolean;

  // 语义搜索结果
  searchResults: SessionListItem[];

  // 操作
  setCurrentSession: (session: SessionMetadata) => void;
  loadSessions: () => Promise<void>;
  searchSessions: (query: string) => Promise<void>;
  saveSession: (data: SessionDraft) => Promise<string>;
  resumeSession: (id: string, options: ResumeOptions) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  currentSession: null,
  sessions: [],
  sessionsLoading: false,
  searchResults: [],

  setCurrentSession: (session) => set({ currentSession: session }),

  loadSessions: async () => {
    set({ sessionsLoading: true });
    const sessions = await window.electron.listSessions();
    set({ sessions, sessionsLoading: false });
  },

  searchSessions: async (query) => {
    const results = await window.electron.searchSessions(query);
    set({ searchResults: results });
  },

  saveSession: async (data) => {
    const sessionId = await window.electron.saveSession(data);
    await get().loadSessions(); // 刷新列表
    return sessionId;
  },

  resumeSession: async (id, options) => {
    const context = await window.electron.resumeSession(id, options);
    // 恢复消息到 chatStore
    const { reset, addMessage } = useChatStore.getState();
    await reset();
    context.historyMessages.forEach(msg => addMessage(msg));
    // 设置当前会话
    set({ currentSession: context.metadata });
  },

  deleteSession: async (id) => {
    await window.electron.deleteSession(id);
    await get().loadSessions();
  },
}));
```

### 3.2 IPC 接口扩展

**文件**: `desktop/main/agent-bridge.ts`（修改）

```ts
// 新增会话管理 IPC 接口
case 'session:list':
  handleSessionList(msg.requestId);
  break;
case 'session:search':
  handleSessionSearch(msg.requestId, msg.data.query);
  break;
case 'session:save':
  handleSessionSave(msg.requestId, msg.data);
  break;
case 'session:resume':
  handleSessionResume(msg.requestId, msg.data.sessionId, msg.data.options);
  break;
case 'session:delete':
  handleSessionDelete(msg.requestId, msg.data.sessionId);
  break;
case 'session:generate-summary':
  handleGenerateSummary(msg.requestId, msg.data.messages);
  break;

// 实现
async function handleSessionSave(requestId: string, data: SessionDraft) {
  const sessionId = await sessionManager.save(
    data.messages,
    data.name,
    {
      usage: data.usage,
      historyMessages: data.historyMessages,
      memoryRefs: data.memoryRefs,
    }
  );

  process.send?.({
    type: 'session:save-result',
    requestId,
    data: { sessionId },
  });
}

async function handleGenerateSummary(requestId: string, messages: Message[]) {
  const summarizer = new SessionSummarizer({ provider, config });
  const summary = await summarizer.summarize(messages);

  process.send?.({
    type: 'session:summary-result',
    requestId,
    data: summary,
  });
}
```

---

## 四、UI 组件清单

### 新增组件

| 组件 | 文件 | 说明 |
|------|------|------|
| SessionManager | `SessionManager.tsx` | 会话管理主视图 |
| SessionGrid | `SessionGrid.tsx` | 网格视图组件 |
| SessionList | `SessionList.tsx` | 列表视图组件 |
| SessionGraph | `SessionGraph.tsx` | 图谱视图组件 |
| SessionDetail | `SessionDetail.tsx` | 会话详情面板 |
| SessionSaveDialog | `SessionSaveDialog.tsx` | 保存会话对话框 |
| SessionResumeDialog | `SessionResumeDialog.tsx` | 恢复会话对话框 |
| SessionContext | `SessionContext.tsx` | 会话上下文组件（RightPanel） |
| MemoryRefsList | `MemoryRefsList.tsx` | 记忆引用列表 |
| RelatedSessionsList | `RelatedSessionsList.tsx` | 相关会话列表 |
| TagInput | `TagInput.tsx` | 标签输入组件 |

### 修改组件

| 组件 | 修改内容 |
|------|----------|
| App.tsx | 新增 `sessions` ViewMode |
| Sidebar.tsx | 增加分类分组、摘要预览 |
| RightPanel.tsx | 新增"上下文" Tab，显示会话摘要 |
| TitleBar.tsx | 新增"保存会话"按钮 |
| InputArea.tsx | 新增 Ctrl+S 快捷键 |

---

## 五、实施优先级

### Phase 1: 基础增强（1 周）

**目标**: 在现有基础上添加最小可用功能

- [ ] Sidebar 会话卡片增强（显示分类、标签、摘要）
- [ ] Sidebar 分组模式切换（时间/分类/标签）
- [ ] sessionStore 创建（基础状态管理）
- [ ] IPC 接口扩展（list/save/resume/delete）

**预期效果**: 用户可以看到会话的分类和标签，按分类浏览会话。

### Phase 2: 智能保存（1 周）

**目标**: 实现 AI 驱动的会话保存流程

- [ ] SessionSaveDialog 组件
- [ ] 后端摘要生成集成
- [ ] 关键点提取和记忆生成
- [ ] 保存成功反馈

**预期效果**: 用户保存会话时，AI 自动生成摘要和关键点，可编辑确认。

### Phase 3: 智能恢复（1 周）

**目标**: 实现上下文预览和智能恢复

- [ ] SessionResumeDialog 组件
- [ ] RightPanel 会话上下文 Tab
- [ ] 记忆检索集成
- [ ] 恢复横幅提示

**预期效果**: 用户恢复会话时，看到摘要和记忆预览，恢复后显示上下文。

### Phase 4: 会话管理视图（1 周）

**目标**: 添加专门的会话管理面板

- [ ] SessionManager 主组件
- [ ] SessionGrid 网格视图
- [ ] SessionDetail 详情面板
- [ ] 语义搜索接口

**预期效果**: 用户可以在专门的管理界面浏览所有会话，语义搜索。

### Phase 5: 高级功能（可选）

- [ ] SessionGraph 图谱视图
- [ ] 会话统计分析
- [ ] 批量操作（归档/导出）
- [ ] 会话模板

---

## 六、用户流程示例

### 流程 1: 保存会话

```
1. 用户完成对话
   ↓
2. 按 Ctrl+S 或点击 TitleBar "保存"按钮
   ↓
3. 弹出 SessionSaveDialog
   - 显示加载动画（AI 分析中...）
   - 3-5 秒后显示摘要和关键点
   ↓
4. 用户编辑会话名称、标签
   - 确认/修改摘要
   - 勾选要生成记忆的关键点
   ↓
5. 点击"保存会话"
   ↓
6. 显示成功提示
   - 生成了 3 条记忆
   - Token 节省 65%
   ↓
7. Sidebar 会话列表更新
   - 新会话出现在顶部
```

### 流程 2: 恢复会话

```
1. 用户在 Sidebar 点击会话卡片
   ↓
2. 弹出 SessionResumeDialog
   - 显示会话摘要
   - 显示关键点列表
   - 显示将要加载的记忆（5 条）
   - 显示 Token 节省百分比
   ↓
3. 用户确认选项
   ☑ 加载相关记忆
   ☑ 恢复最近 10 条消息
   ↓
4. 点击"恢复会话"
   ↓
5. 对话区顶部显示上下文横幅
   ╔═══════════════════════╗
   ║ 📚 上下文已加载        ║
   ║ 摘要: 修复登录 bug     ║
   ║ 记忆: 5 条            ║
   ╚═══════════════════════╝
   ↓
6. RightPanel 显示会话上下文
   - 摘要
   - 关键点
   - 生成的记忆
   - 相关会话
```

### 流程 3: 搜索会话

```
1. 用户在 Sidebar 搜索框输入"修复登录"
   ↓
2. 实时显示匹配结果（文本匹配）
   - 修复用户登录 403 错误
   - 实现登录重试机制
   ↓
3. 用户点击"高级搜索"（进入 SessionManager）
   ↓
4. 切换到网格视图
   - 按相似度排序
   - 显示相似度百分比
   ↓
5. 点击会话卡片
   - 右侧显示详情
   - 可直接恢复
```

---

## 七、关键技术点

### 7.1 组件复用

```
现有组件复用:
- MemoryManager → SessionManager（参考结构）
- MemoryBrowser → SessionGrid（参考布局）
- MessageBubble → SessionCard（参考气泡样式）
```

### 7.2 状态同步

```
chatStore ←→ sessionStore
   ↓           ↓
messages    currentSession
status      sessions
stats       searchResults
```

### 7.3 样式一致性

```
使用现有 Tailwind 类:
- bg-bg-primary/secondary
- text-text-primary/secondary/tertiary
- border colors
- spacing scale
```

---

## 八、总结

### ✅ 关键优势

1. **渐进式增强**
   - 基于现有架构，逐步添加功能
   - 不破坏现有用户体验
   - 向后兼容

2. **组件复用**
   - 参考 MemoryManager 的成熟模式
   - 保持 UI 一致性
   - 减少开发工作量

3. **用户友好**
   - 保存/恢复流程清晰
   - 上下文预览降低认知负担
   - Token 节省直观展示

4. **技术可行**
   - 后端架构已完备
   - IPC 接口易于扩展
   - Store 模式成熟

### 📈 预期效果

**Phase 1 完成后**:
- 用户可按分类浏览会话
- 会话卡片显示摘要和标签

**Phase 2 完成后**:
- 用户保存会话时看到 AI 生成的摘要
- 可选择生成哪些记忆

**Phase 3 完成后**:
- 用户恢复会话时看到上下文预览
- Token 节省 60%+

**Phase 4 完成后**:
- 用户有专门的会话管理界面
- 支持语义搜索

完整增强方案已设计！基于现有架构，渐进式实现记忆驱动会话管理。
