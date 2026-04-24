# System Prompt 管理页面实施文档

## 已完成

### 1. 前端组件
- ✅ `desktop/renderer/pages/SystemPromptPage.tsx` - 页面入口
- ✅ `desktop/renderer/components/SystemPromptManager.tsx` - 主管理组件
- ✅ `desktop/renderer/App.tsx` - 添加路由
- ✅ `desktop/renderer/layouts/MainLayout.tsx` - 添加回调
- ✅ `desktop/renderer/components/Sidebar.tsx` - 已有入口按钮

## 待实施

### 2. 后端 IPC 接口

#### 2.1 在 `desktop/main/agent-bridge.ts` 中添加处理函数

在文件末尾（`// ============ Todo 管理 ============` 之前）添加：

```typescript
// ============================================================
// Prompt 组件管理
// ============================================================

/**
 * 获取所有 Prompt 组件
 */
async function handlePromptGetComponents() {
  if (!session) {
    return { success: true, components: [] };
  }
  try {
    const layeredPromptBuilder = session.getLayeredPromptBuilder();
    if (!layeredPromptBuilder) {
      return { success: true, components: [] };
    }

    // 获取所有组件
    const components = layeredPromptBuilder.getAllComponents();
    
    return { success: true, components };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 切换组件启用/禁用
 */
async function handlePromptToggleComponent(data: { id: string; enabled: boolean }) {
  if (!session) {
    return { success: false, error: '会话未初始化' };
  }
  try {
    const layeredPromptBuilder = session.getLayeredPromptBuilder();
    if (!layeredPromptBuilder) {
      return { success: false, error: 'LayeredPromptBuilder 未初始化' };
    }

    await layeredPromptBuilder.toggleComponent(data.id, data.enabled);
    
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 更新组件内容
 */
async function handlePromptUpdateComponent(data: { id: string; content: string }) {
  if (!session) {
    return { success: false, error: '会话未初始化' };
  }
  try {
    const layeredPromptBuilder = session.getLayeredPromptBuilder();
    if (!layeredPromptBuilder) {
      return { success: false, error: 'LayeredPromptBuilder 未初始化' };
    }

    await layeredPromptBuilder.updateComponent(data.id, data.content);
    
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 预览完整 Prompt
 */
async function handlePromptPreview(data: { scene?: string; complexity?: string }) {
  if (!session) {
    return { success: false, error: '会话未初始化' };
  }
  try {
    const layeredPromptBuilder = session.getLayeredPromptBuilder();
    if (!layeredPromptBuilder) {
      return { success: false, error: 'LayeredPromptBuilder 未初始化' };
    }

    const result = await layeredPromptBuilder.build({
      scene: data.scene || 'coding',
      complexity: data.complexity || 'standard',
    });
    
    return { success: true, prompt: result.prompt };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// 🔥 保留原有的 handleGetPromptConfig 和 handleSavePromptConfig
async function handleGetPromptConfig() {
  // TODO: 实现获取 Prompt 配置
  return { success: true, config: {} };
}

async function handleSavePromptConfig(data: any) {
  // TODO: 实现保存 Prompt 配置
  return { success: true };
}
```

#### 2.2 在 `desktop/main/agent-bridge.ts` 注册 IPC 处理器

在 `// ============ Prompt 配置管理 ============` 部分修改为：

```typescript
// ============ Prompt 配置管理 ============
channel.handle('prompt-get-components', () => handlePromptGetComponents());
channel.handle('prompt-toggle-component', (data) => handlePromptToggleComponent(data));
channel.handle('prompt-update-component', (data) => handlePromptUpdateComponent(data));
channel.handle('prompt-preview', (data) => handlePromptPreview(data));
channel.handle('get-prompt-config', () => handleGetPromptConfig());
channel.handle('save-prompt-config', (data) => handleSavePromptConfig(data));
```

#### 2.3 在 `desktop/main/preload.ts` 中暴露接口

在 `contextBridge.exposeInMainWorld('electron', {` 中添加：

```typescript
// Prompt 管理
promptGetComponents: () => ipcRenderer.invoke('prompt-get-components'),
promptToggleComponent: (data: { id: string; enabled: boolean }) => 
  ipcRenderer.invoke('prompt-toggle-component', data),
promptUpdateComponent: (data: { id: string; content: string }) => 
  ipcRenderer.invoke('prompt-update-component', data),
promptPreview: (data: { scene?: string; complexity?: string }) => 
  ipcRenderer.invoke('prompt-preview', data),
```

#### 2.4 添加 TypeScript 类型定义

在 `desktop/renderer/types/electron.d.ts` 中添加：

```typescript
interface Window {
  electron: {
    // ... 现有接口
    
    // Prompt 管理
    promptGetComponents: () => Promise<{
      success: boolean;
      components?: Array<{
        id: string;
        name: string;
        layer: string;
        priority: number;
        estimatedTokens: number;
        enabled: boolean;
        scenes?: string[];
        complexity?: string[];
        content: string;
        dynamic?: boolean;
      }>;
      error?: string;
    }>;
    promptToggleComponent: (data: { id: string; enabled: boolean }) => Promise<{
      success: boolean;
      error?: string;
    }>;
    promptUpdateComponent: (data: { id: string; content: string }) => Promise<{
      success: boolean;
      error?: string;
    }>;
    promptPreview: (data: { scene?: string; complexity?: string }) => Promise<{
      success: boolean;
      prompt?: string;
      error?: string;
    }>;
  };
}
```

### 3. 后端核心逻辑

#### 3.1 在 `src/core/prompt/LayeredPromptBuilder.ts` 中添加方法

```typescript
/**
 * 获取所有组件（用于 GUI 管理）
 */
getAllComponents(): PromptComponent[] {
  return Array.from(this.components.values());
}

/**
 * 切换组件启用/禁用
 */
async toggleComponent(id: string, enabled: boolean): Promise<void> {
  const component = this.components.get(id);
  if (!component) {
    throw new Error(`Component not found: ${id}`);
  }
  
  component.enabled = enabled;
  
  // 如果是用户自定义组件，保存到文件
  if (this.userRegistry) {
    await this.userRegistry.saveComponent(component);
  }
}

/**
 * 更新组件内容
 */
async updateComponent(id: string, content: string): Promise<void> {
  const component = this.components.get(id);
  if (!component) {
    throw new Error(`Component not found: ${id}`);
  }
  
  component.content = content;
  
  // 如果是用户自定义组件，保存到文件
  if (this.userRegistry) {
    await this.userRegistry.saveComponent(component);
  }
}
```

#### 3.2 在 `src/core/prompt/PromptComponentRegistry.ts` 中添加方法

```typescript
/**
 * 保存组件到文件
 */
async saveComponent(component: PromptComponent): Promise<void> {
  const filePath = path.join(this.userPromptsDir, `${component.id}.json5`);
  const content = JSON5.stringify(component, null, 2);
  await fs.writeFile(filePath, content, 'utf-8');
  log.info(`Component saved: ${component.id}`);
}
```

#### 3.3 在 `src/core/chat/ChatSession.ts` 中暴露方法

```typescript
/**
 * 获取 LayeredPromptBuilder（用于 GUI 管理）
 */
getLayeredPromptBuilder(): LayeredPromptBuilder | null {
  return this.layeredPromptBuilder || null;
}
```

## 功能说明

### 用户级管理
- 所有 Prompt 组件配置存储在 `~/.xuanji/users/{userId}/prompts/` 目录
- 用户可以：
  - 查看所有 Prompt 组件（L0/L1/L2/L3）
  - 启用/禁用组件
  - 编辑用户自定义组件内容
  - 预览完整组合后的 System Prompt
- 内置组件（来自 `src/core/templates/prompts/`）只能查看和启用/禁用，不能编辑内容
- 动态组件（如 `l2-available-agents`）不能编辑，因为内容是运行时生成的

### 分层显示
- **L0**：核心身份和基础规则（~600 tokens）
- **L1**：场景特定规则（coding/life/learning 等）
- **L2**：复杂任务规则（agent-rules, team-coordination, available-agents）
- **L3**：项目上下文（CLAUDE.md）

### 预览功能
- 可以选择场景（coding/life/learning）和复杂度（simple/standard/complex）
- 实时预览组合后的完整 System Prompt
- 显示总 token 数估算

## 测试步骤

1. 启动应用，登录
2. 点击左侧 "System Prompt" 按钮
3. 查看组件列表，按层级筛选
4. 展开组件查看内容
5. 切换组件启用/禁用
6. 编辑用户自定义组件
7. 点击"预览完整 Prompt"查看效果

## 注意事项

1. **用户隔离**：每个用户有独立的 prompts 目录
2. **文件监听**：修改文件后自动重新加载（通过 PromptComponentRegistry 的 watch 机制）
3. **权限控制**：内置组件不可编辑，只能启用/禁用
4. **动态组件**：运行时生成内容，不可编辑
5. **备份建议**：修改前建议备份 `~/.xuanji/users/{userId}/prompts/` 目录
