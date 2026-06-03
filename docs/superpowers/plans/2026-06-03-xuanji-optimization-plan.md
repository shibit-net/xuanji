# xuanji 1.0 架构优化实现计划

> **面向 AI 代理的工作者：** 使用 superpowers:subagent-driven-development 或 superpowers:executing-plans 逐任务实现此计划。步骤使用 `- [ ]` 语法跟踪进度。

**目标：** 在不影响业务逻辑的前提下，降低 xuanji 代码复杂度、提升运行时性能、统一交互展示

**架构：** 热点驱动优化——先诊断定位热点，再按组件拆分→性能优化→状态精简→交互优化顺序推进，每阶段有独立可验证的成功指标

**技术栈：** Electron + React 18 + TypeScript 5 + Zustand 4 + Tailwind 3 + Vite 5

**设计文档：** `docs/superpowers/specs/2026-06-03-xuanji-optimization-design.md`

---

## 阶段一：诊断与度量体系

> **目标：** 产出 `OPTIMIZATION_DIAGNOSIS.md` 诊断报告，量化复杂度/性能/bundle/状态管理四维度基线

### 任务 1.1：代码复杂度扫描

**文件：**
- 创建：无（仅运行分析命令）

- [ ] **步骤 1：统计文件行数分布**

运行：
```bash
cd desktop && find renderer -name "*.tsx" -o -name "*.ts" | xargs wc -l | sort -rn | head -30
cd .. && find src -name "*.ts" | xargs wc -l | sort -rn | head -20
```

- [ ] **步骤 2：汇总到诊断报告**

创建 `docs/superpowers/specs/OPTIMIZATION_DIAGNOSIS.md`，写入行数 Top 10 文件列表。

### 任务 1.2：运行时性能采集

- [ ] **步骤 1：启动 dev 环境并录制 Profile**

运行：
```bash
cd desktop && npm run dev
```

在 Electron 窗口中打开 React DevTools Profiler，执行以下操作并录制：
1. 切换到 MemoryPage，滚动记忆列表
2. 切换到 AgentEditor，打开一个 Agent 编辑
3. 发送一条消息，观察 Agent 响应过程
4. 打开 SkillsMCPPage，浏览市场列表

- [ ] **步骤 2：提取渲染耗时数据**

从 Profiler 火焰图中提取单次渲染 >16ms 的组件名称和耗时，追加到诊断报告。

### 任务 1.3：Bundle 分析

- [ ] **步骤 1：安装并配置 rollup-plugin-visualizer**

```bash
cd desktop && npm install --save-dev rollup-plugin-visualizer
```

修改 `desktop/vite.config.ts`：

```typescript
import { visualizer } from 'rollup-plugin-visualizer';

// 在 build 配置中添加
build: {
  rollupOptions: {
    plugins: [visualizer({ open: true, filename: 'dist/stats.html' })],
  },
}
```

- [ ] **步骤 2：运行构建并分析**

```bash
cd desktop && npm run build:pre
```

分析 `dist/stats.html`，记录 >100KB 的 chunk，追加到诊断报告。

- [ ] **步骤 3：回退 visualizer 配置**

从 vite.config.ts 移除 visualizer 插件（仅诊断用，不提交）。

### 任务 1.4：Store 依赖图分析

- [ ] **步骤 1：列出所有 store 文件及其 import 关系**

```bash
cd desktop/renderer/stores
for f in *.ts; do
  echo "=== $f ==="
  grep "^import.*from" "$f" | grep -v node_modules
  echo ""
done
```

- [ ] **步骤 2：绘制依赖图**

手动整理 store 间的 import 关系，标记：
- 相互引用的 store 对
- 总是同时被同一组件订阅的 store 组
- 内容高度重叠的 store

写入诊断报告。

---

## 阶段二：组件拆分

> **目标：** 8 个巨型组件拆分为 40-50 个子组件，每个 ≤300 行

### 任务 2.1：拆分 AgentEditor.tsx（1865 行 → 11 个文件）

**创建：**
- `desktop/renderer/components/agent-editor/AgentEditor.tsx` — 主容器
- `desktop/renderer/components/agent-editor/AgentBasicInfo.tsx`
- `desktop/renderer/components/agent-editor/AgentModelConfig.tsx`
- `desktop/renderer/components/agent-editor/AgentSystemPrompt.tsx`
- `desktop/renderer/components/agent-editor/AgentToolSelector.tsx`
- `desktop/renderer/components/agent-editor/AgentSkillList.tsx`
- `desktop/renderer/components/agent-editor/AgentMcpConfig.tsx`
- `desktop/renderer/components/agent-editor/AgentSubAgentList.tsx`
- `desktop/renderer/components/agent-editor/AgentScheduleConfig.tsx`
- `desktop/renderer/components/agent-editor/shared/ConfigSection.tsx`
- `desktop/renderer/components/agent-editor/shared/ConfigToggle.tsx`

**修改：**
- `desktop/renderer/components/AgentEditor.tsx` — 改为 re-export 新路径

- [ ] **步骤 1：创建目录结构**

```bash
mkdir -p desktop/renderer/components/agent-editor/shared
```

- [ ] **步骤 2：提取 shared 组件**

创建 `desktop/renderer/components/agent-editor/shared/ConfigSection.tsx`：

```typescript
import { type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface ConfigSectionProps {
  title: string;
  icon: ReactNode;
  defaultExpanded?: boolean;
  children: ReactNode;
  actions?: ReactNode;
}

export default function ConfigSection({
  title,
  icon,
  defaultExpanded = true,
  children,
  actions,
}: ConfigSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-4 py-3 bg-secondary/50 hover:bg-secondary/70 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
        {icon}
        <span className="font-medium text-sm">{title}</span>
        <div className="flex-1" />
        {actions}
      </button>
      {expanded && <div className="p-4 border-t border-border">{children}</div>}
    </div>
  );
}
```

- [ ] **步骤 3：提取 AgentBasicInfo**

创建 `desktop/renderer/components/agent-editor/AgentBasicInfo.tsx`：

```typescript
interface AgentBasicInfoProps {
  name: string;
  description: string;
  category: string;
  onChange: (field: string, value: string) => void;
  readOnly?: boolean;
}

export default function AgentBasicInfo({ name, description, category, onChange, readOnly }: AgentBasicInfoProps) {
  return (
    <ConfigSection title="基本信息" icon={<User className="w-4 h-4" />}>
      {/* 从 AgentEditor.tsx 中提取 name/description/category 表单 */}
      {/* 完整代码见原 AgentEditor.tsx 对应部分 */}
    </ConfigSection>
  );
}
```

- [ ] **步骤 4-10：依次提取其余子组件**

按相同模式提取：AgentModelConfig、AgentSystemPrompt、AgentToolSelector、AgentSkillList、AgentMcpConfig、AgentSubAgentList、AgentScheduleConfig。每个从原文件中截取对应的 JSX 和逻辑。

- [ ] **步骤 11：重写主容器 AgentEditor.tsx**

```typescript
import AgentBasicInfo from './agent-editor/AgentBasicInfo';
import AgentModelConfig from './agent-editor/AgentModelConfig';
import AgentSystemPrompt from './agent-editor/AgentSystemPrompt';
import AgentToolSelector from './agent-editor/AgentToolSelector';
import AgentSkillList from './agent-editor/AgentSkillList';
import AgentMcpConfig from './agent-editor/AgentMcpConfig';
import AgentSubAgentList from './agent-editor/AgentSubAgentList';
import AgentScheduleConfig from './agent-editor/AgentScheduleConfig';

// 主容器仅保留 tabs 路由和全局状态协调，≤150 行
export default function AgentEditor(props: AgentEditorProps) {
  const [activeTab, setActiveTab] = useState('basic');
  // ... 状态管理和 tab 路由
  return (
    <div className="flex flex-col h-full">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        {/* tab 切换 */}
      </Tabs>
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {activeTab === 'basic' && <AgentBasicInfo {...basicProps} />}
        {activeTab === 'model' && <AgentModelConfig {...modelProps} />}
        {/* ... 其余 tab */}
      </div>
    </div>
  );
}
```

- [ ] **步骤 12：更新旧文件的引用**

修改 `desktop/renderer/components/AgentEditor.tsx`：

```typescript
// 向后兼容重导出
export { default } from './agent-editor/AgentEditor';
```

- [ ] **步骤 13：类型检查**

```bash
cd desktop && npx tsc --noEmit --skipLibCheck
```

- [ ] **步骤 14：Commit**

```bash
git add desktop/renderer/components/agent-editor/ desktop/renderer/components/AgentEditor.tsx
git commit -m "refactor: 拆分 AgentEditor 为 9 个子组件 + 2 个 shared 组件"
```

### 任务 2.2：拆分 MemoryPage.tsx（1909 行 → 8 个文件）

**创建：**
- `desktop/renderer/pages/memory/MemoryPage.tsx` — 主容器
- `desktop/renderer/pages/memory/MemoryList.tsx`
- `desktop/renderer/pages/memory/MemoryCard.tsx`
- `desktop/renderer/pages/memory/MemoryDetailPanel.tsx`
- `desktop/renderer/pages/memory/MemoryImportDialog.tsx`
- `desktop/renderer/pages/memory/MemoryExportDialog.tsx`
- `desktop/renderer/pages/memory/MemorySearchBar.tsx`
- `desktop/renderer/pages/memory/MemoryStatsPanel.tsx`
- `desktop/renderer/pages/memory/MemoryTypeConfig.tsx`

**修改：**
- `desktop/renderer/pages/MemoryPage.tsx` — 改为 re-export

- [ ] **步骤 1：创建目录**

```bash
mkdir -p desktop/renderer/pages/memory
```

- [ ] **步骤 2：提取 MemorySearchBar**

```typescript
// desktop/renderer/pages/memory/MemorySearchBar.tsx
interface MemorySearchBarProps {
  query: string;
  onQueryChange: (q: string) => void;
  typeFilter: string;
  onTypeFilterChange: (t: string) => void;
  memoryTypes: string[];
}

export default function MemorySearchBar({ query, onQueryChange, typeFilter, onTypeFilterChange, memoryTypes }: MemorySearchBarProps) {
  return (
    <div className="flex items-center gap-3">
      <Search className="w-4 h-4 text-muted-foreground" />
      <input
        className="flex-1 bg-transparent outline-none text-sm"
        placeholder="搜索记忆..."
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
      />
      <select
        className="bg-secondary rounded-lg px-2 py-1 text-xs"
        value={typeFilter}
        onChange={(e) => onTypeFilterChange(e.target.value)}
      >
        <option value="">全部类型</option>
        {memoryTypes.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
    </div>
  );
}
```

- [ ] **步骤 3-9：依次提取其余子组件**

MemoryCard、MemoryList、MemoryDetailPanel、MemoryImportDialog、MemoryExportDialog、MemoryStatsPanel、MemoryTypeConfig。

- [ ] **步骤 10：重写 MemoryPage 主容器**

```typescript
// desktop/renderer/pages/memory/MemoryPage.tsx
import MemorySearchBar from './MemorySearchBar';
import MemoryList from './MemoryList';
import MemoryDetailPanel from './MemoryDetailPanel';
// ... 其余 import

export default function MemoryPage({ onClose }: { onClose?: () => void }) {
  // 仅保留状态管理和子组件编排
  return (
    <div className="flex h-full">
      <div className="flex-1 flex flex-col">
        <MemorySearchBar {...searchProps} />
        <MemoryList {...listProps} />
      </div>
      {selectedMemory && <MemoryDetailPanel {...detailProps} />}
      {/* 对话框 */}
      {showImport && <MemoryImportDialog {...importProps} />}
      {showExport && <MemoryExportDialog {...exportProps} />}
    </div>
  );
}
```

- [ ] **步骤 11：更新旧文件引用**

- [ ] **步骤 12：类型检查**

```bash
cd desktop && npx tsc --noEmit --skipLibCheck
```

- [ ] **步骤 13：Commit**

### 任务 2.3：拆分 SystemPromptManager.tsx（1208 行 → 6 个文件）

**创建：**
- `desktop/renderer/components/system-prompt/SystemPromptManager.tsx`
- `desktop/renderer/components/system-prompt/TemplateList.tsx`
- `desktop/renderer/components/system-prompt/TemplateEditor.tsx`
- `desktop/renderer/components/system-prompt/VariablePanel.tsx`
- `desktop/renderer/components/system-prompt/TemplatePreview.tsx`
- `desktop/renderer/components/system-prompt/ImportExportDialog.tsx`

**修改：** `SystemPromptManager.tsx` → re-export

- [ ] **步骤 1-6：按拆分维度提取 → 重写主容器 → 类型检查 → Commit**

### 任务 2.4：拆分 SettingsPage.tsx（1152 行 → 7 个文件）

**创建：**
- `desktop/renderer/pages/settings/SettingsPage.tsx`
- `desktop/renderer/pages/settings/GeneralSettings.tsx`
- `desktop/renderer/pages/settings/AppearanceSettings.tsx`
- `desktop/renderer/pages/settings/ShortcutSettings.tsx`
- `desktop/renderer/pages/settings/NetworkSettings.tsx`
- `desktop/renderer/pages/settings/StorageSettings.tsx`
- `desktop/renderer/pages/settings/PrivacySettings.tsx`
- `desktop/renderer/pages/settings/AboutPanel.tsx`

**修改：** `SettingsPage.tsx` → re-export

- [ ] **步骤 1-6：按拆分维度提取 → 重写主容器 → 类型检查 → Commit**

### 任务 2.5：拆分 SkillsMCPPage.tsx（1059 行 → 5 个文件）

**创建：**
- `desktop/renderer/pages/skills-mcp/SkillsMCPPage.tsx`
- `desktop/renderer/pages/skills-mcp/SkillsListPanel.tsx`
- `desktop/renderer/pages/skills-mcp/MCPServerListPanel.tsx`
- `desktop/renderer/pages/skills-mcp/MarketBrowser.tsx`
- `desktop/renderer/pages/skills-mcp/InstallWizard.tsx`

**修改：** `SkillsMCPPage.tsx` → re-export

- [ ] **步骤 1-6：按拆分维度提取 → 重写主容器 → 类型检查 → Commit**

### 任务 2.6：拆分 InputArea.tsx（1049 行 → 5 个文件）

**创建：**
- `desktop/renderer/components/input-area/InputArea.tsx`
- `desktop/renderer/components/input-area/InputToolbar.tsx`
- `desktop/renderer/components/input-area/MentionPanel.tsx`
- `desktop/renderer/components/input-area/FileAttachments.tsx`
- `desktop/renderer/components/input-area/SendButton.tsx`

**修改：** `InputArea.tsx` → re-export

- [ ] **步骤 1-6：按拆分维度提取 → 重写主容器 → 类型检查 → Commit**

### 任务 2.7：拆分 MessageBubble.tsx（959 行 → 6 个文件）

**创建：**
- `desktop/renderer/components/message-bubble/MessageBubble.tsx`
- `desktop/renderer/components/message-bubble/TextContent.tsx`
- `desktop/renderer/components/message-bubble/CodeBlock.tsx`
- `desktop/renderer/components/message-bubble/ToolCallCard.tsx`
- `desktop/renderer/components/message-bubble/MediaContent.tsx`
- `desktop/renderer/components/message-bubble/MessageActions.tsx`

**修改：** `MessageBubble.tsx` → re-export

- [ ] **步骤 1-6：按拆分维度提取 → 重写主容器 → 类型检查 → Commit**

### 任务 2.8：拆分 ExecutionFlow.tsx（960 行 → 5 个文件）

**创建：**
- `desktop/renderer/components/execution-flow/ExecutionFlow.tsx`
- `desktop/renderer/components/execution-flow/FlowCanvas.tsx`
- `desktop/renderer/components/execution-flow/NodeCard.tsx`
- `desktop/renderer/components/execution-flow/EdgeRenderer.tsx`
- `desktop/renderer/components/execution-flow/ExecutionToolbar.tsx`

**修改：** `ExecutionFlow.tsx` → re-export

- [ ] **步骤 1-6：按拆分维度提取 → 重写主容器 → 类型检查 → Commit**

### 任务 2.9：i18n 拆分（540 行 → 按模块拆分）

**修改：** `desktop/renderer/i18n.ts` — 保持入口文件，内容拆到子模块

**创建：**
- `desktop/renderer/i18n/common.ts` — 通用 UI 文案
- `desktop/renderer/i18n/chat.ts` — 聊天相关
- `desktop/renderer/i18n/agent.ts` — Agent 管理
- `desktop/renderer/i18n/settings.ts` — 设置页
- `desktop/renderer/i18n/memory.ts` — 记忆管理
- `desktop/renderer/i18n/skills.ts` — 技能/MCP

```typescript
// desktop/renderer/i18n.ts — 入口
export { t, setLocale, getLocale } from '@/core/i18n';
export * from './i18n/common';
export * from './i18n/chat';
// ...
```

- [ ] **步骤 1-3：拆分 → 验证引用完整 → Commit**

---

## 阶段三：性能优化专项

> **目标：** 路由级 lazy loading、虚拟滚动接入、memo 策略、CSS tree-shaking、重型依赖按需加载

### 任务 3.1：重型依赖动态 import

**修改：**
- `desktop/renderer/components/MilkdownEditor.tsx` — 动态 import @milkdown/kit
- `desktop/renderer/components/ExecutionFlow.tsx` — 动态 import cytoscape
- `desktop/renderer/components/ExecutionFlowV2.tsx` — 同上

- [ ] **步骤 1：MilkdownEditor 懒加载**

修改 `MilkdownEditor.tsx`，将顶层 import 改为组件内的动态 import + Suspense：

```typescript
// 创建 desktop/renderer/components/MilkdownEditor.lazy.tsx
import { lazy, Suspense } from 'react';

const MilkdownEditorInner = lazy(() => import('./MilkdownEditor'));

export default function MilkdownEditor(props: any) {
  return (
    <Suspense fallback={<div className="animate-pulse bg-secondary rounded-lg h-40" />}>
      <MilkdownEditorInner {...props} />
    </Suspense>
  );
}
```

然后将 MilkdownEditor 的顶层 @milkdown/kit import 延后（原文件已在动态 import 路径内部，无需改动）。

- [ ] **步骤 2：cytoscape 懒加载**

在 ExecutionFlow.tsx 和 ExecutionFlowV2.tsx 中，将 cytoscape 的 import 移到组件内部：

```typescript
// 在组件函数内
const cytoscapeModule = await import('cytoscape');
```

或创建 wrapper：

```typescript
// desktop/renderer/components/ExecutionFlow.lazy.tsx
import { lazy, Suspense } from 'react';
const ExecutionFlow = lazy(() => import('./execution-flow/ExecutionFlow'));
export default function ExecutionFlowLazy(props: any) {
  return <Suspense fallback={<FlowSkeleton />}><ExecutionFlow {...props} /></Suspense>;
}
```

- [ ] **步骤 3：mermaid 懒加载**

修改 MessageBubble 中渲染 mermaid 图表的代码，仅在检测到 mermaid 代码块时动态 import：

```typescript
// 在 CodeBlock 子组件中
const [mermaidReady, setMermaidReady] = useState(false);
useEffect(() => {
  if (language === 'mermaid') {
    import('mermaid').then(() => setMermaidReady(true));
  }
}, [language]);
```

- [ ] **步骤 4：katex 懒加载**

在 MilkdownEditor 或 Markdown 渲染中，仅在含数学公式时才 import katex。

- [ ] **步骤 5：类型检查**

```bash
cd desktop && npx tsc --noEmit --skipLibCheck
```

- [ ] **步骤 6：验证运行时无白屏**

```bash
cd desktop && npm run dev
# 手动验证：打开含 mermaid 图的消息、打开 Milkdown 编辑器、打开 ExecutionFlow
```

- [ ] **步骤 7：Commit**

### 任务 3.2：虚拟滚动接入

**修改：**
- `desktop/renderer/pages/memory/MemoryList.tsx` — 接入 useVirtualizer
- `desktop/renderer/components/ChatArea.tsx` — 消息列表虚拟化
- `desktop/renderer/components/AgentManager.tsx` — Agent 卡片列表虚拟化

- [ ] **步骤 1：MemoryList 虚拟滚动**

```typescript
// desktop/renderer/pages/memory/MemoryList.tsx
import { useVirtualizer } from '@tanstack/react-virtual';

export default function MemoryList({ memories }: { memories: Memory[] }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: memories.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80,
    overscan: 5,
  });

  return (
    <div ref={parentRef} className="flex-1 overflow-auto">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((virtualItem) => (
          <div
            key={virtualItem.key}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: virtualItem.size,
              transform: `translateY(${virtualItem.start}px)`,
            }}
          >
            <MemoryCard memory={memories[virtualItem.index]} />
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **步骤 2：ChatArea 消息列表虚拟化**

同样接入 useVirtualizer，行高预估 120px（含工具调用卡片）。

```typescript
// 在 ChatArea.tsx 的消息列表容器中
const virtualizer = useVirtualizer({
  count: messages.length,
  getScrollElement: () => scrollRef.current,
  estimateSize: (index) => {
    const msg = messages[index];
    if (msg.toolCalls?.length) return 200;
    if (msg.contentBlocks?.length) return 250;
    return 100;
  },
  overscan: 3,
});
```

- [ ] **步骤 3：AgentManager 卡片列表虚拟化**

卡片行高固定 60px（列表模式），接入 useVirtualizer。

- [ ] **步骤 4：类型检查**

- [ ] **步骤 5：手动验证滚动性能**

用 React DevTools Profiler 录制列表滚动，确认渲染帧率 >50fps。

- [ ] **步骤 6：Commit**

### 任务 3.3：Memo 策略推广

**修改：** 拆分后的所有子组件

- [ ] **步骤 1：为页面级组件加 React.memo**

```typescript
// 在每个页面子组件中
export default React.memo(function MemoryCard({ memory }: Props) {
  // ...
});
```

- [ ] **步骤 2：回调函数加 useCallback**

在父组件中，传递给子组件的回调函数用 useCallback 包裹：

```typescript
const handleSelect = useCallback((id: string) => {
  setSelected(id);
}, []);
```

- [ ] **步骤 3：计算值加 useMemo**

```typescript
const filteredMemories = useMemo(
  () => memories.filter(m => m.type === typeFilter),
  [memories, typeFilter]
);
```

- [ ] **步骤 4：Store selector 精确化**

确保所有组件使用 zustand selector 模式：

```typescript
// ✅ 正确 — 精确订阅
const messages = useMessageStore(s => s.messages);
const sendMessage = useMessageStore(s => s.sendMessage);

// ❌ 错误 — 全量订阅
const store = useMessageStore();
```

- [ ] **步骤 5：类型检查 + Commit**

### 任务 3.4：CSS 清理

**修改：** `desktop/renderer/index.css`

- [ ] **步骤 1：Chrome Coverage 检测未使用 CSS**

```bash
cd desktop && npm run dev
```

在 Electron DevTools → Coverage 面板录制页面切换操作，导出未使用 CSS 列表。

- [ ] **步骤 2：分类处理自定义 CSS**

570 行自定义 CSS 分三类：

1. **保留在 :root** — CSS 变量定义（design tokens）、@layer base 规则
2. **移入组件** — 组件专属样式移入对应组件的 `style` 标签或用 Tailwind class 替代
3. **删除** — Coverage 报告为 0% 使用的样式

- [ ] **步骤 3：Tailwind content 路径精确化**

修改 `tailwind.config.js`：

```javascript
content: [
  './renderer/**/*.{ts,tsx}',
  './renderer/index.html',
],
```

- [ ] **步骤 4：验证视觉一致性**

在 dev 环境下逐页对比优化前后视觉效果。

- [ ] **步骤 5：Commit**

---

## 阶段四：状态管理精简

> **目标：** 合并/删除 3-5 个 store，推广 selector 模式，标准化数据流

### 任务 4.1：移除 conversationHub（功能并入 chatStore）

**修改：**
- `desktop/renderer/stores/conversationHub.ts` — 删除
- `desktop/renderer/stores/chatStore.ts` — 吸收 conversationHub 中的 activeId 管理
- 所有引用 conversationHub 的组件

- [ ] **步骤 1：定位所有引用**

```bash
cd desktop && grep -r "conversationHub" renderer/ --include="*.ts" --include="*.tsx" -l
```

- [ ] **步骤 2：在 chatStore 中添加替代功能**

chatStore 已经是 messageStore 的别名，在 messageStore 中添加 conversationHub 功能的实现：

```typescript
// 在 messageStore 接口中添加
interface MessageStoreState {
  // ... 现有字段
  activeConversationId: string | null;
  conversationIds: string[];
  setActiveConversation: (id: string) => void;
  addConversation: (id: string) => void;
  removeConversation: (id: string) => void;
}
```

- [ ] **步骤 3：逐个替换引用**

将所有 `import { useConversationHub } from ...` 替换为 `import { useChatStore } from ...`，并更新调用方式。

- [ ] **步骤 4：删除 conversationHub.ts**

```bash
rm desktop/renderer/stores/conversationHub.ts
```

- [ ] **步骤 5：更新 stores/index.ts 移除导出**

- [ ] **步骤 6：类型检查 + Commit**

### 任务 4.2：合并 sessionStore + sessionInitStore

**修改：**
- `desktop/renderer/stores/sessionStore.ts` — 吸收 sessionInitStore 逻辑
- `desktop/renderer/stores/SessionInitStore.ts` — 删除
- 所有引用 SessionInitStore 的组件

- [ ] **步骤 1：定位引用**

```bash
grep -r "SessionInitStore\|useSessionInitStore" desktop/renderer/ --include="*.ts" --include="*.tsx" -l
```

- [ ] **步骤 2：迁移逻辑到 sessionStore**

将 SessionInitStore 中的初始化逻辑（createSession、initSession、warmupModels 等）迁移到 sessionStore。

- [ ] **步骤 3：替换所有引用**

- [ ] **步骤 4：删除 SessionInitStore.ts**

- [ ] **步骤 5：类型检查 + Commit**

### 任务 4.3：推广 selector hooks 模式

**修改：** 所有 10 个 store 文件

- [ ] **步骤 1：为每个 store 添加 selector hook**

```typescript
// 在每个 store 文件底部
export const useMessages = () => useMessageStore(s => s.messages);
export const useSendStatus = () => useMessageStore(s => s.sendStatus);
export const useActiveConversationId = () => useMessageStore(s => s.activeConversationId);
```

- [ ] **步骤 2：更新主页面组件使用 selector hooks**

优先更新被频繁渲染的组件：ChatArea、InputArea、MessageBubble 列表项。

- [ ] **步骤 3：类型检查 + Commit**

### 任务 4.4：数据流标准化 — 禁止跨 store 直接读

- [ ] **步骤 1：检查跨 store 引用**

```bash
cd desktop/renderer/stores && grep "getState()" *.ts
```

- [ ] **步骤 2：重构跨 store 引用**

对于确实需要跨 store 通信的场景，通过组件层协调：

```typescript
// ❌ 禁止
function someAction() {
  const runtimeStore = useRuntimeStore.getState();
  runtimeStore.doSomething();
}

// ✅ 正确：在 Page 层协调
function PageComponent() {
  const chatAction = useChatStore(s => s.someAction);
  const runtimeAction = useRuntimeStore(s => s.doSomething);
  const handleClick = () => {
    chatAction();
    runtimeAction();
  };
}
```

- [ ] **步骤 3：Commit**

---

## 阶段五：交互展示优化

> **目标：** 统一空状态/加载态、过渡动画、键盘导航、设计 token 统一

### 任务 5.1：统一骨架屏组件

**创建：** `desktop/renderer/components/Skeleton.tsx`

- [ ] **步骤 1：创建 Skeleton 组件**

```typescript
// desktop/renderer/components/Skeleton.tsx
interface SkeletonProps {
  className?: string;
  lines?: number;
}

export function SkeletonLine({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse bg-secondary rounded', className || 'h-4 w-full')} />;
}

export function SkeletonCard() {
  return (
    <div className="space-y-3 p-4 border border-border rounded-xl">
      <SkeletonLine className="h-5 w-1/3" />
      <SkeletonLine className="h-4 w-full" />
      <SkeletonLine className="h-4 w-2/3" />
    </div>
  );
}

export function SkeletonList({ count = 3 }: { count?: number }) {
  return <div className="space-y-3">{Array.from({ length: count }, (_, i) => <SkeletonCard key={i} />)}</div>;
}
```

- [ ] **步骤 2：替换各页面的 LoadingScreen**

将各页面的简单 spinner 替换为 SkeletonList/SkeletonCard。

- [ ] **步骤 3：Commit**

### 任务 5.2：统一空状态组件

**创建：** `desktop/renderer/components/EmptyState.tsx`

- [ ] **步骤 1：创建 EmptyState**

```typescript
// desktop/renderer/components/EmptyState.tsx
import { LucideIcon, Inbox } from 'lucide-react';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

export default function EmptyState({ icon: Icon = Inbox, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <Icon className="w-12 h-12 text-muted-foreground mb-4" />
      <h3 className="text-lg font-medium text-foreground mb-2">{title}</h3>
      {description && <p className="text-sm text-muted-foreground max-w-md">{description}</p>}
      {action && (
        <button onClick={action.onClick} className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm">
          {action.label}
        </button>
      )}
    </div>
  );
}
```

- [ ] **步骤 2：替换各页面的空状态占位**

覆盖场景：无会话、无记忆、无工具、无 MCP 服务器、无调度任务。

- [ ] **步骤 3：Commit**

### 任务 5.3：路由切换过渡动画

**修改：** `desktop/renderer/App.tsx`

- [ ] **步骤 1：添加 AnimatePresence**

```typescript
import { AnimatePresence, motion } from 'framer-motion';

// 包装 Routes
<AnimatePresence mode="wait">
  <Routes location={location} key={location.pathname}>
    {/* ... */}
  </Routes>
</AnimatePresence>

// 页面组件增加 motion.div wrapper
<motion.div
  initial={{ opacity: 0 }}
  animate={{ opacity: 1 }}
  exit={{ opacity: 0 }}
  transition={{ duration: 0.15 }}
>
  {/* page content */}
</motion.div>
```

- [ ] **步骤 2：验证动画不卡顿**

```bash
cd desktop && npm run dev
```

- [ ] **步骤 3：Commit**

### 任务 5.4：键盘导航增强

**修改：** 各页面主容器

- [ ] **步骤 1：全局命令面板增强**

在现有的 Ctrl+K 命令面板中补全命令：
- 新建会话
- 切换 Agent
- 打开设置
- 打开记忆

- [ ] **步骤 2：快捷键注册**

```typescript
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
      e.preventDefault();
      createNewSession();
    }
    if (e.key === 'Escape') {
      closeActiveDialog();
    }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, []);
```

- [ ] **步骤 3：Commit**

### 任务 5.5：硬编码色值 → CSS 变量替换

- [ ] **步骤 1：搜索硬编码色值**

```bash
cd desktop/renderer && grep -rn "#[0-9a-fA-F]\{3,6\}\|rgba\?([0-9, ]\+)" --include="*.tsx" --include="*.ts" | grep -v node_modules | grep -v "index.css" > hardcoded_colors.txt
```

- [ ] **步骤 2：逐个替换为 CSS 变量**

| 硬编码 | 替换为 |
|--------|--------|
| `#f0f0f0` | `hsl(var(--muted))` |
| `rgba(0,0,0,0.05)` | `hsl(var(--accent))` |
| `#3b82f6` | `hsl(var(--primary))` |
| `#ef4444` | `hsl(var(--destructive))` |

- [ ] **步骤 3：视觉回归验证**

逐页对比替换前后视觉效果。

- [ ] **步骤 4：Commit**

### 任务 5.6：Toast 统一 + 操作反馈优化

- [ ] **步骤 1：审查现有 Toast 调用**

```bash
grep -r "toast\|useToast" desktop/renderer/ --include="*.tsx" -l
```

- [ ] **步骤 2：统一 Toast 参数**

确保所有 Toast：
- duration: 3000 (3秒)
- position: bottom-right
- 成功用默认样式、错误用 variant="destructive"

- [ ] **步骤 3：Commit**

---

## 验证清单

每个阶段完成后运行：

```bash
# 类型检查
cd desktop && npx tsc --noEmit --skipLibCheck

# 构建验证
cd desktop && npm run build:pre

# 视觉回归（手动）
npm run dev  # 逐页检查 UI 无变化

# 功能回归（手动）
# - 创建/编辑 Agent
# - 发送消息 → Agent 响应
# - 工具调用展示
# - 记忆 CRUD
# - MCP/技能管理
# - 设置页各项
# - 调度器
# - 权限管理
```

---

## 执行顺序与依赖

```
阶段一（诊断）
  ↓
阶段二（组件拆分）── 无依赖，可按任务顺序执行
  ↓
阶段三（性能优化）── 依赖阶段二的拆分结果
  ↓
阶段四（状态精简）── 可与阶段三并行
  ↓
阶段五（交互优化）── 依赖阶段二、三的组件结构
```
