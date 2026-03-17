# System Prompt 管理界面实现报告

## 实施日期
2026-03-16

## 概述
完成 System Prompt 管理界面优化，包括改名、Prompt 组件可编辑、工具关联到场景三大功能。

---

## 实施内容

### 1. 改名：Prompt 管理 → System Prompt ✅

#### 1.1 Sidebar.tsx

**文件**: `desktop/renderer/components/Sidebar.tsx`

**修改**: 第 215-220 行

```typescript
<button
  onClick={onOpenSystemPrompt}
  className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-bg-tertiary transition-colors text-sm"
>
  <FileText size={16} className="text-text-secondary" />
  <span>System Prompt</span>
</button>
```

**说明**: 按钮文字已改为 "System Prompt"，回调名 `onOpenSystemPrompt` 已更新。

#### 1.2 App.tsx

**文件**: `desktop/renderer/App.tsx`

**修改**:
- 第 27 行：ViewMode 类型包含 `'system-prompt'`
- 第 82 行：`onOpenSystemPrompt={() => setViewMode(viewMode === 'system-prompt' ? 'chat' : 'system-prompt')}`
- 第 98-99 行：viewMode 分支 `viewMode === 'system-prompt'`

```typescript
type ViewMode = 'chat' | 'settings' | 'agents' | 'skills' | 'tools' | 'mcp' | 'system-prompt' | 'memory';

{viewMode === 'system-prompt' ? (
  <PromptManager onClose={() => setViewMode('chat')} />
) : ...}
```

**说明**: ViewMode 已从 `'prompt-manager'` 改为 `'system-prompt'`。

#### 1.3 PromptManager.tsx

**文件**: `desktop/renderer/components/PromptManager.tsx`

**修改**: 第 163 行

```typescript
<h2 className="text-xl font-semibold">System Prompt</h2>
<p className="text-sm text-text-secondary mt-1">配置场景匹配规则、加载矩阵、Prompt 组件和 L3 上下文</p>
```

**说明**: 标题已改为 "System Prompt"。

---

### 2. 类型扩展：PromptConfig 新增 components 字段 ✅

#### 2.1 global.d.ts

**文件**: `desktop/renderer/global.d.ts`

**新增类型**（第 178-188 行）:

```typescript
export interface PromptComponentConfig {
  content: string;
  requiredTools?: string[];
}

export interface PromptConfig {
  sceneRules: SceneMatchRule[];
  loadMatrix: LoadMatrixConfig;
  l3Config: L3Config;
  components?: Record<string, PromptComponentConfig>;
}
```

**说明**:
- `PromptComponentConfig`: 包含 prompt 内容和可选的 requiredTools 字段
- `PromptConfig.components`: 可选字段，存储用户自定义的 prompt 组件内容

---

### 3. 后端默认值：handlePromptGetConfig 返回 components ✅

#### 3.1 DEFAULT_PROMPT_COMPONENTS 常量

**文件**: `desktop/main/agent-bridge.ts`

**位置**: 第 1115-1308 行

**包含组件**:
- `l0-identity` (Core Identity, ~400 tokens)
- `l0-safety` (Security Baseline, ~200 tokens)
- `l1-coding` (Coding Guide, ~800 tokens, requiredTools 包含 read_file/write_file/edit_file/bash/grep/glob/multi_edit 等)
- `l1-life` (Life Secretary Guide, ~700 tokens, requiredTools 包含 memory_search/memory_store/reminder_set/reminder_check 等)
- `l2-planning` (Planning & Confirmation, ~400 tokens)
- `l2-agent-rules` (Agent Behavior Rules, ~300 tokens)
- `l2-safety` (Extended Security Rules, ~200 tokens)

**示例**:

```typescript
const DEFAULT_PROMPT_COMPONENTS: Record<string, { content: string; requiredTools?: string[] }> = {
  'l0-identity': {
    content: `You are Xuanji (璇玑), an AI butler who truly knows the user...`,
  },
  'l1-coding': {
    content: `# Code Assistant — Programming Domain Expert...`,
    requiredTools: [
      'read_file', 'write_file', 'edit_file', 'multi_edit', 'bash',
      'grep', 'glob', 'task', 'compact', 'checkpoint_create', 'checkpoint_rewind',
    ],
  },
  'l1-life': {
    content: `# Life Secretary — Memory-Driven Personal Assistant...`,
    requiredTools: [
      'memory_search', 'memory_store', 'reminder_set', 'reminder_check',
      'web_search', 'web_fetch', 'read_file', 'write_file', 'bash',
    ],
  },
  // ...其他组件
};
```

#### 3.2 handlePromptGetConfig 逻辑

**位置**: 第 1310-1366 行

**核心逻辑**:

```typescript
async function handlePromptGetConfig(requestId: string) {
  try {
    const configPath = join(homedir(), '.xuanji', 'prompt-config.json');

    // 1. 尝试读取配置文件
    let config: any = null;
    try {
      const content = await fs.readFile(configPath, 'utf-8');
      config = JSON.parse(content);
    } catch {
      // 文件不存在，返回默认配置（sceneRules / loadMatrix / l3Config）
      config = { ... };
    }

    // 2. 确保 components 字段存在（合并默认值）
    if (!config.components) {
      config.components = {};
    }
    for (const [id, defaults] of Object.entries(DEFAULT_PROMPT_COMPONENTS)) {
      if (!config.components[id]) {
        config.components[id] = defaults;
      }
    }

    // 3. 返回完整配置
    process.send?.({ requestId, data: { success: true, config } });
  } catch (err) {
    process.send?.({ requestId, data: { success: false, error: err.message } });
  }
}
```

**特点**:
- 配置文件不存在时，返回默认 sceneRules/loadMatrix/l3Config
- 无论文件是否存在，都会合并 DEFAULT_PROMPT_COMPONENTS 作为 components 默认值
- 用户自定义的组件内容会保留，未自定义的使用默认值

#### 3.3 handlePromptSaveConfig 逻辑

**位置**: 第 1368-1387 行

**核心逻辑**:

```typescript
async function handlePromptSaveConfig(requestId: string, data: any) {
  try {
    const configDir = join(homedir(), '.xuanji');
    const configPath = join(configDir, 'prompt-config.json');

    // 确保目录存在
    await fs.mkdir(configDir, { recursive: true });

    // 写入配置（包含 sceneRules / loadMatrix / l3Config / components）
    await fs.writeFile(configPath, JSON.stringify(data, null, 2), 'utf-8');

    process.send?.({ requestId, data: { success: true } });
  } catch (err) {
    process.send?.({ requestId, data: { success: false, error: err.message } });
  }
}
```

**配置文件路径**: `~/.xuanji/prompt-config.json`

**配置格式**:

```json
{
  "sceneRules": [
    {
      "scene": "coding",
      "keywords": "代码|编程|...",
      "description": "编程领域专家 — ..."
    },
    {
      "scene": "life",
      "keywords": "约会|餐厅|...",
      "description": "生活秘书 — ..."
    }
  ],
  "loadMatrix": {
    "simple": ["L0"],
    "standard": ["L0", "L1"],
    "complex": ["L0", "L1", "L2"]
  },
  "l3Config": {
    "enabled": true,
    "maxFiles": 100,
    "maxSymbols": 20,
    "directories": ["src"]
  },
  "components": {
    "l0-identity": {
      "content": "自定义内容（如果用户修改了）"
    },
    "l1-coding": {
      "content": "自定义内容",
      "requiredTools": ["read_file", "write_file", "edit_file", "bash"]
    }
  }
}
```

---

### 4. PromptManager.tsx 组件编辑功能 ✅

#### 4.1 Tab 结构

**文件**: `desktop/renderer/components/PromptManager.tsx`

**4 个 Tab**:
1. **场景匹配规则** (SceneMatchTab, 第 252 行)
2. **加载矩阵** (LoadMatrixTab, 第 254 行)
3. **Prompt 组件** (ComponentsTab, 第 257 行) ← **新增核心功能**
4. **L3 配置** (L3ConfigTab, 第 267 行)

#### 4.2 ComponentsTab 实现

**位置**: 第 432-589 行

**UI 结构**:

```
┌────────────────────────────────────────────────────────────────┐
│  [Prompt 组件 Tab]                                             │
├────────────┬───────────────────────────────────────────────────┤
│  组件列表   │  组件编辑区                                        │
│            │                                                    │
│ L0         │  ┌─ Core Identity ──────────────────────────────┐ │
│ - Identity │  │  璇玑核心人设                      ~400 tokens │ │
│ - Safety   │  │                                               │ │
│            │  │  [Prompt 内容编辑器（Markdown）]              │ │
│ L1         │  │  ┌───────────────────────────────────────┐   │ │
│ - Coding   │  │  │ You are Xuanji (璇玑), an AI butler... │   │ │
│ - Life     │  │  │                                        │   │ │
│            │  │  │ # Core Principles                      │   │ │
│ L2         │  │  │ - **Tools First**: ...                 │   │ │
│ - Planning │  │  │ ...                                    │   │ │
│ - Agent    │  │  └───────────────────────────────────────┘   │ │
│ - Safety   │  │                                               │ │
│            │  │  关联工具（requiredTools）— L1 场景激活时加载  │ │
│ L3         │  │  ┌───────────────────────────────────────┐   │ │
│ - Project  │  │  │ [read_file] [write_file] [edit_file]  │   │ │
│            │  │  │ [multi_edit] [bash] [grep] [glob]     │   │ │
│            │  │  │ [task] [compact] [checkpoint_create]  │   │ │
│            │  │  └───────────────────────────────────────┘   │ │
│            │  │                                               │ │
│            │  │  [重置为默认]                                 │ │
│            │  └───────────────────────────────────────────────┘ │
└────────────┴───────────────────────────────────────────────────┘
```

**核心功能**:

##### A. 组件列表 (左侧)

**数据源**: `componentList` 数组（第 78-87 行）

```typescript
const componentList: ComponentInfo[] = [
  { id: 'l0-identity', name: 'Core Identity', layer: 'L0', editable: true, estimatedTokens: 400, description: '璇玑核心人设' },
  { id: 'l0-safety', name: 'Security Baseline', layer: 'L0', editable: true, estimatedTokens: 200, description: '安全底线' },
  { id: 'l1-coding', name: 'Coding Guide', layer: 'L1', editable: true, estimatedTokens: 800, description: '编程场景指南' },
  { id: 'l1-life', name: 'Life Secretary Guide', layer: 'L1', editable: true, estimatedTokens: 700, description: '生活秘书指南' },
  { id: 'l2-planning', name: 'Planning & Confirmation', layer: 'L2', editable: true, estimatedTokens: 400, description: '计划与确认' },
  { id: 'l2-agent-rules', name: 'Agent Behavior Rules', layer: 'L2', editable: true, estimatedTokens: 300, description: 'Agent 行为规则' },
  { id: 'l2-safety', name: 'Extended Security Rules', layer: 'L2', editable: true, estimatedTokens: 200, description: '完整安全规则' },
  { id: 'l3-project', name: 'Project Context', layer: 'L3', editable: false, estimatedTokens: '动态', description: '项目上下文（动态生成）' },
];
```

**渲染逻辑** (第 470-489 行):
- 显示 Layer 标签（L0/L1/L2/L3）
- 显示组件名称
- 显示描述
- 点击选中，高亮显示

##### B. 编辑区 (右侧)

**L3 组件 - 不可编辑** (第 509-519 行):

```typescript
{!selected.editable ? (
  <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 flex items-start gap-3">
    <AlertCircle size={20} className="text-yellow-500 flex-shrink-0 mt-0.5" />
    <div className="text-sm">
      <p className="font-medium text-yellow-500 mb-1">动态生成，不可编辑</p>
      <p className="text-text-secondary">
        L3 组件根据项目上下文动态生成，包括 XUANJI.md、规则文件、文件索引等。可在 "L3 配置" tab 中调整参数。
      </p>
    </div>
  </div>
) : ...}
```

**L0/L1/L2 组件 - 可编辑** (第 521-582 行):

1. **Prompt 内容编辑器** (第 523-532 行):
   ```typescript
   <textarea
     value={componentData?.content || ''}
     onChange={(e) => handleContentChange(e.target.value)}
     className="w-full bg-bg-primary border border-bg-tertiary rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-primary transition-colors resize-y"
     rows={16}
     placeholder="输入 prompt 内容..."
   />
   ```
   - 16 行高度，可调整大小
   - Markdown 格式
   - 实时 token 估算（字符数 / 4）

2. **L1 组件的 requiredTools 选择器** (第 535-565 行):
   ```typescript
   {selected.layer === 'L1' && (
     <div>
       <label className="block text-sm font-medium mb-2">
         关联工具（requiredTools）
         <span className="text-text-secondary font-normal ml-2">— 该场景激活时加载的工具</span>
       </label>
       <div className="bg-bg-secondary rounded-lg p-3">
         <div className="flex flex-wrap gap-2">
           {allTools.map((tool) => {
             const isSelected = componentData?.requiredTools?.includes(tool) ?? false;
             return (
               <button
                 key={tool}
                 onClick={() => handleToolToggle(tool)}
                 className={`px-2 py-1 text-xs font-mono rounded transition-colors ${
                   isSelected
                     ? 'bg-primary/20 text-primary border border-primary/30'
                     : 'bg-bg-primary text-text-secondary border border-bg-tertiary hover:border-primary/30'
                 }`}
               >
                 {tool}
               </button>
             );
           })}
         </div>
       </div>
     </div>
   )}
   ```
   - 工具列表从 `window.electron.toolsList()` 获取（第 120-129 行）
   - 多选框，点击切换选中状态
   - 已选工具高亮显示（蓝色背景）
   - 仅 L1 组件显示

3. **重置为默认按钮** (第 568-581 行):
   ```typescript
   <button
     onClick={() => {
       if (!confirm(`确定要将 ${selected.name} 重置为默认内容吗？`)) return;
       const updated = { ...components };
       delete updated[selectedId];
       onChange(updated);
     }}
     className="px-3 py-1.5 text-sm text-yellow-500 hover:bg-yellow-500/10 rounded transition-colors"
   >
     <RefreshCw size={14} className="inline mr-1" />
     重置为默认
   </button>
   ```
   - 删除用户自定义内容，恢复默认值
   - 需要确认

##### C. 状态管理

**State** (第 74-76 行):
```typescript
const [components, setComponents] = useState<Record<string, PromptComponentConfig>>({});
const [selectedComponentId, setSelectedComponentId] = useState<string>('l0-identity');
const [allTools, setAllTools] = useState<string[]>([]);
```

**加载配置** (第 98-118 行):
```typescript
useEffect(() => {
  loadConfig();  // 从后端加载配置
  loadTools();   // 加载工具列表
}, []);

const loadConfig = async () => {
  setLoading(true);
  try {
    const result = await window.electron.promptGetConfig();
    if (result.success && result.config) {
      setComponents(result.config.components || {});
      // ...
    }
  } finally {
    setLoading(false);
  }
};

const loadTools = async () => {
  try {
    const result = await window.electron.toolsList();
    if (result.success && result.tools) {
      setAllTools(result.tools.map((t) => t.name));
    }
  } catch (err) {
    console.error('Failed to load tools:', err);
  }
};
```

**保存配置** (第 131-151 行):
```typescript
const handleSave = async () => {
  setSaveStatus('saving');
  try {
    const result = await window.electron.promptSaveConfig({
      sceneRules,
      loadMatrix,
      l3Config,
      components,  // 包含用户编辑的组件内容
    });
    if (result.success) {
      setSaveStatus('success');
    } else {
      setSaveStatus('error');
    }
    setTimeout(() => setSaveStatus('idle'), 2000);
  } catch (err) {
    console.error('Failed to save prompt config:', err);
    setSaveStatus('error');
    setTimeout(() => setSaveStatus('idle'), 2000);
  }
};
```

---

## 技术细节

### 数据流

#### 1. 加载配置

```
用户打开 System Prompt 面板
  ↓
ComponentsTab 挂载，useEffect 触发
  ↓
loadConfig() + loadTools()
  ↓ IPC: prompt:get-config
  ↓ agent-bridge: handlePromptGetConfig()
  ├── 读取 ~/.xuanji/prompt-config.json
  ├── 合并 DEFAULT_PROMPT_COMPONENTS 默认值
  └── 返回 { success: true, config: { sceneRules, loadMatrix, l3Config, components } }
  ↓
setComponents(config.components)
  ↓
渲染组件列表和编辑区
```

#### 2. 编辑 Prompt 内容

```
用户在 textarea 中修改内容
  ↓
onChange 触发 handleContentChange(content)
  ↓
setComponents({
  ...components,
  [selectedId]: { ...componentData, content }
})
  ↓
实时更新 token 估算（字符数 / 4）
```

#### 3. 切换 requiredTools（仅 L1 组件）

```
用户点击工具按钮
  ↓
handleToolToggle(tool)
  ↓
const updated = current.includes(tool)
  ? current.filter((t) => t !== tool)
  : [...current, tool];
  ↓
setComponents({
  ...components,
  [selectedId]: { ...componentData, requiredTools: updated }
})
```

#### 4. 保存配置

```
用户点击 "保存" 按钮
  ↓
handleSave()
  ↓ IPC: prompt:save-config
  ↓ agent-bridge: handlePromptSaveConfig(data)
  ├── 写入 ~/.xuanji/prompt-config.json
  └── 返回 { success: true }
  ↓
setSaveStatus('success')
  ↓
2 秒后恢复 'idle'
```

#### 5. 重置为默认

```
用户点击 "重置为默认" 按钮
  ↓
确认对话框
  ↓
delete components[selectedId]
  ↓
setComponents({ ...components })
  ↓
点击 "保存" 后，该组件不会出现在配置文件中
  ↓
下次加载时，handlePromptGetConfig 会自动合并默认值
```

---

## 代码统计

| 项目 | 代码量 |
|------|----------|
| Sidebar.tsx 修改 | 已完成（改名） |
| App.tsx 修改 | 已完成（viewMode 改名） |
| PromptManager.tsx 修改 | 已完成（标题改名 + ComponentsTab 已实现） |
| global.d.ts 扩展 | +10 行（PromptComponentConfig + components 字段） |
| agent-bridge.ts 扩展 | +200 行（DEFAULT_PROMPT_COMPONENTS + handlePromptGetConfig/Save 逻辑） |
| **总计** | **~210 行新增** |

---

## 用户工作流

### 场景 1：自定义 L1 场景 Prompt

```
1. 打开 System Prompt 面板
2. 切换到 "Prompt 组件" tab
3. 点击左侧 "Coding Guide"（L1 组件）
4. 在右侧编辑区修改 prompt 内容（例如：添加新的代码风格指南）
5. 调整 requiredTools（例如：新增 web_search 工具）
6. 点击 "保存"
7. 重启会话，新配置生效
```

### 场景 2：恢复默认 Prompt

```
1. 打开 System Prompt 面板 → Prompt 组件 tab
2. 选择已自定义的组件（如 "Life Secretary Guide"）
3. 点击 "重置为默认" 按钮
4. 确认操作
5. 点击 "保存"
6. 下次加载时，该组件恢复为 DEFAULT_PROMPT_COMPONENTS 中的默认值
```

### 场景 3：查看 L3 组件说明

```
1. 打开 System Prompt 面板 → Prompt 组件 tab
2. 点击 "Project Context"（L3 组件）
3. 右侧显示黄色提示："动态生成，不可编辑"
4. 切换到 "L3 配置" tab，可调整 maxFiles/maxSymbols/directories 参数
```

---

## 测试验证

### 1. 类型检查

```bash
cd desktop && npx tsc --noEmit
```

**结果**:
- ✅ 无 PromptManager、PromptConfig、PromptComponentConfig 相关的类型错误
- ⚠️ 存在其他模块路径错误（与本次实现无关，不影响功能）

### 2. 手动测试建议

#### 测试 1：加载默认配置

```bash
# 1. 删除配置文件（如果存在）
rm ~/.xuanji/prompt-config.json

# 2. 启动 GUI
cd desktop && npm run dev:electron

# 3. 打开 System Prompt 面板 → Prompt 组件 tab
# 4. 验证左侧显示 8 个组件（L0/L1/L2/L3）
# 5. 点击 "Core Identity"，验证右侧显示默认内容
# 6. 点击 "Coding Guide"，验证显示 requiredTools 工具列表
```

#### 测试 2：编辑并保存

```bash
# 1. 选择 "Core Identity"
# 2. 在 textarea 中修改内容（例如：添加一行 "# Test"）
# 3. 验证实时 token 估算更新
# 4. 点击 "保存"
# 5. 验证显示 "✓ 已保存" 提示
# 6. 检查配置文件
cat ~/.xuanji/prompt-config.json | jq '.components."l0-identity".content'
# 验证内容包含 "# Test"
```

#### 测试 3：requiredTools 编辑（L1 组件）

```bash
# 1. 选择 "Coding Guide"
# 2. 验证显示 requiredTools 工具列表
# 3. 取消勾选 "bash"，勾选 "web_search"
# 4. 点击 "保存"
# 5. 检查配置文件
cat ~/.xuanji/prompt-config.json | jq '.components."l1-coding".requiredTools'
# 验证不包含 "bash"，包含 "web_search"
```

#### 测试 4：重置为默认

```bash
# 1. 选择已自定义的组件（如 "Core Identity"）
# 2. 点击 "重置为默认"
# 3. 确认操作
# 4. 点击 "保存"
# 5. 检查配置文件
cat ~/.xuanji/prompt-config.json | jq '.components."l0-identity"'
# 验证该字段不存在（已删除）
# 6. 重新打开 System Prompt 面板
# 7. 验证显示默认内容（从 DEFAULT_PROMPT_COMPONENTS 加载）
```

#### 测试 5：L3 组件不可编辑

```bash
# 1. 选择 "Project Context"（L3 组件）
# 2. 验证右侧显示黄色提示："动态生成，不可编辑"
# 3. 验证无 textarea 编辑器
# 4. 验证无 requiredTools 选择器
# 5. 验证无 "重置为默认" 按钮
```

---

## 已知限制

### 限制 1：配置需要重启会话生效

- **现象**: 修改 prompt 内容后，当前会话不会立即生效
- **原因**: LayeredPromptBuilder 在会话初始化时加载配置
- **解决方案**: 提示用户重启会话（点击 "新建会话"）
- **改进方向**: 实现配置热更新（重新初始化 PromptBuilder）

### 限制 2：工具列表不支持分组

- **现象**: requiredTools 选择器显示扁平工具列表，无 CORE/META/SCENE 分组
- **原因**: 未实现分组 UI
- **改进方向**: 按 ToolCategories.ts 分组显示，提升选择体验

### 限制 3：Prompt 编辑器无 Markdown 预览

- **现象**: 只能编辑 Markdown 源码，无法预览渲染效果
- **原因**: 未实现预览功能
- **改进方向**: 添加 "预览" tab，使用 react-markdown 渲染

---

## 总结

### ✅ 已完成功能

1. **改名**
   - Sidebar、App、PromptManager 中 "Prompt 管理" 改为 "System Prompt"
   - ViewMode 从 'prompt-manager' 改为 'system-prompt'

2. **类型扩展**
   - global.d.ts 新增 PromptComponentConfig 和 PromptConfig.components 字段

3. **后端默认值**
   - agent-bridge.ts 定义 DEFAULT_PROMPT_COMPONENTS（7 个组件）
   - handlePromptGetConfig 自动合并默认值
   - handlePromptSaveConfig 持久化到 ~/.xuanji/prompt-config.json

4. **前端编辑功能**
   - PromptManager 新增 "Prompt 组件" tab
   - 左侧组件列表（8 个组件，包含 L3）
   - 右侧编辑区（L0/L1/L2 可编辑，L3 只读）
   - Prompt 内容编辑器（Markdown，16 行）
   - L1 组件 requiredTools 工具选择器（多选）
   - 实时 token 估算（字符数 / 4）
   - 重置为默认按钮

### 🎯 核心价值

- ✅ **可视化 Prompt 管理**：用户可通过 GUI 查看和编辑所有 prompt 组件
- ✅ **工具场景关联**：L1 组件的 requiredTools 可在 GUI 中配置，工具加载与场景自动关联
- ✅ **灵活性与安全性**：支持自定义编辑和重置为默认，L3 动态生成不可编辑

### 📈 用户体验提升

```
之前：
- Prompt 内容硬编码在代码中，修改需编辑源码
- 工具分类硬编码在 ToolCategories.ts，无法动态调整
- 用户无法自定义场景 prompt

现在：
- GUI 可视化编辑，实时 token 估算
- L1 组件 requiredTools 可视化配置
- 配置持久化到文件，支持重置为默认
- 清晰的 L0/L1/L2/L3 层次结构
```

---

## 下一步改进方向（可选）

### 优先级 1：配置热更新

- 保存配置后立即重新加载 LayeredPromptBuilder
- 无需重启会话即可生效
- 显示 "配置已生效" 提示

### 优先级 2：工具分组显示

- 按 CORE/META/SCENE 分组显示工具列表
- 可折叠分组，提升选择体验

### 优先级 3：Markdown 预览

- 添加 "编辑" 和 "预览" 双 tab
- 使用 react-markdown 实时渲染 Markdown
- 支持代码高亮（SyntaxHighlighter）

### 优先级 4：Prompt 模板市场

- 内置多个 prompt 模板（编程风格：TypeScript/Python/Java）
- 一键导入模板
- 支持导出和分享自定义 prompt

---

## 附录：文件清单

| 文件路径 | 修改类型 | 说明 |
|---------|---------|------|
| `desktop/renderer/components/Sidebar.tsx` | ✅ 已完成 | "System Prompt" 按钮 |
| `desktop/renderer/App.tsx` | ✅ 已完成 | viewMode 改名 |
| `desktop/renderer/components/PromptManager.tsx` | ✅ 已完成 | 标题改名 + ComponentsTab |
| `desktop/renderer/global.d.ts` | ✅ 已完成 | PromptComponentConfig + components 字段 |
| `desktop/main/agent-bridge.ts` | ✅ 已完成 | DEFAULT_PROMPT_COMPONENTS + Get/Save 逻辑 |
| `~/.xuanji/prompt-config.json` | 新建（用户操作后） | 配置持久化文件 |

---

## 相关文档

- 计划文档: `/Users/kevinshi/.claude/plans/happy-twirling-perlis.md`
- 记忆系统 GUI 实现: `doc/prd/xuanji/memory-gui-pending-completion.md`
- Prompt 系统设计: `doc/prd/xuanji/system-prompt-refactor.md`
