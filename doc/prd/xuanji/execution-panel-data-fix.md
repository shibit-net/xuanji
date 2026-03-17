# ExecutionPanel 数据连接修复

## 问题
右侧执行面板只有"工具"Tab有内容展示，其他Tab（执行树、TODO、权限、系统）都是空的。

## 根本原因
缺少事件连接和初始化逻辑：
1. **执行树**：没有初始化 `rootAgent`
2. **TODO**：没有监听 `todo_create` / `todo_update` 工具调用
3. **权限**：只连接了请求事件，没有连接响应事件
4. **系统**：Token/成本/迭代数据有，但 rootAgent 状态未更新

## 修复内容

### 1. 初始化 Agent 执行树

**文件**：`desktop/renderer/stores/chatStore.ts`

```typescript
sendMessage: async (content) => {
  // ... 用户消息处理 ...

  // 🆕 初始化 Agent 执行树（如果还没有 rootAgent）
  const executionStore = useExecutionStore.getState();
  if (!executionStore.rootAgent) {
    executionStore.setRootAgent('Xuanji Assistant');
  }

  // ... Agent 调用 ...
}
```

**效果**：
- 第一次发送消息时自动创建 `rootAgent`
- 执行树Tab会显示"Xuanji Assistant (运行中)"

### 2. 更新 Agent 状态

**文件**：`desktop/renderer/stores/chatStore.ts`

```typescript
_handleAgentEnd: (state) => {
  // ... 其他处理 ...

  // 更新 rootAgent 状态为 completed
  executionStore.updateAgentStatus('root', 'completed');
}
```

**效果**：
- Agent 执行完成后，状态从"运行中"变为"已完成"
- 显示执行时长

### 3. 监听 TODO 工具调用

**文件**：`desktop/renderer/stores/chatStore.ts`

#### 3.1 TODO 创建

```typescript
_handleAgentToolStart: (data) => {
  // ... 工具调用处理 ...

  // 🆕 如果是 TODO 相关工具，提取 TODO 信息
  if (data.name === 'todo_create' && data.input) {
    const input = data.input as any;
    executionStore.addTodo({
      id: input.id || `todo-${Date.now()}`,
      subject: input.title || input.subject || '未命名任务',
      description: input.description || '',
      activeForm: input.activeForm,
    });
  }
}
```

#### 3.2 TODO 更新

```typescript
_handleAgentToolEnd: (data) => {
  // ... 工具结果处理 ...

  // 🆕 如果是 TODO 更新工具，解析并更新 TODO 状态
  if (data.name === 'todo_update' && !data.isError) {
    try {
      // 从 result 中解析 TODO 信息
      const match = data.result.match(/Task ([\w-]+) updated/);
      if (match && match[1]) {
        const todoId = match[1];
        const statusMatch = data.result.match(/status=([\w]+)/);
        if (statusMatch && statusMatch[1]) {
          const status = statusMatch[1] as 'pending' | 'in_progress' | 'completed' | 'failed';
          executionStore.updateTodo({ id: todoId, status });
        }
      }
    } catch (err) {
      // 忽略解析错误
    }
  }
}
```

**效果**：
- LLM 调用 `todo_create` 工具时，TODO Tab 自动新增任务
- LLM 调用 `todo_update` 工具时，TODO Tab 自动更新状态
- 进度条实时更新

### 4. 连接权限响应事件

#### 4.1 使用 request.id 作为关联键

**文件**：`desktop/renderer/stores/chatStore.ts`

```typescript
// 权限交互事件监听
window.electron.onPermissionRequest((data) => {
  // ...
  useExecutionStore.getState().addPermissionRequest({
    id: data.id, // 🆕 使用 request.id，便于后续响应时匹配
    type: 'permission',
    data,
  });
});
```

#### 4.2 权限对话框响应

**文件**：`desktop/renderer/components/PermissionDialog.tsx`

```typescript
import { useExecutionStore } from '../stores/executionStore';

export default function PermissionDialog({ request, onClose }: PermissionDialogProps) {
  const respondPermission = useExecutionStore((state) => state.respondPermission);

  const handleRespond = async (action: 'allow' | 'deny' | 'always' | 'never') => {
    await window.electron.permissionRespond({...});

    // 🆕 更新 executionStore（右侧面板）
    respondPermission({
      id: request.id,
      approved: action === 'allow' || action === 'always',
      response: { action },
    });

    onClose();
  };
}
```

**文件**：`desktop/renderer/components/PlanReviewDialog.tsx`

```typescript
// 类似修改，approved: action === 'approve'
```

**文件**：`desktop/renderer/components/AskUserDialog.tsx`

```typescript
// 类似修改，approved: true（总是视为已批准）
```

**效果**：
- 用户批准/拒绝权限后，权限Tab立即更新状态
- 显示响应时长
- 统计数据实时更新（待审批 -1，已批准/已拒绝 +1）

## 修复后的效果

### 执行树 Tab
- ✅ 显示 "Xuanji Assistant (主 Agent)"
- ✅ 状态：运行中 → 已完成
- ✅ 执行时长统计
- 🔜 SubAgent 层级（需要后端 IPC 事件支持）

### 工具 Tab
- ✅ 已有数据（之前就能正常工作）
- ✅ 按7个分类分组展示
- ✅ 输入参数、输出结果完整展示

### TODO Tab
- ✅ 自动监听 `todo_create` / `todo_update` 工具调用
- ✅ 按状态分组（进行中/待处理/已完成/失败）
- ✅ 进度条实时更新
- ⚠️ 需要 LLM 实际调用 TODO 工具才会有数据

### 权限 Tab
- ✅ 记录所有权限请求
- ✅ 用户响应后立即更新状态
- ✅ 显示响应时长
- ✅ 统计待审批/已批准/已拒绝数量
- ⚠️ 只有触发权限交互时才会有数据

### 系统 Tab
- ✅ Token 使用统计（输入/输出/缓存）
- ✅ 成本统计
- ✅ 迭代次数统计
- 🔜 MCP 服务器状态（需要后端 IPC 事件支持）

## 注意事项

### 数据触发条件

1. **执行树**：
   - ✅ 第一次发送消息时自动初始化
   - 始终有数据

2. **工具**：
   - ✅ 每次工具调用都会记录
   - 始终有数据（只要 Agent 调用了工具）

3. **TODO**：
   - ⚠️ 需要 LLM 主动调用 `todo_create` / `todo_update` 工具
   - 不是所有对话都会使用 TODO 工具
   - 可以测试：让 LLM 创建任务（"帮我创建一个TODO"）

4. **权限**：
   - ⚠️ 需要触发权限交互（文件操作、危险命令等）
   - 可以测试：执行需要权限的操作（"删除 test.txt"）

5. **系统**：
   - ✅ 每次 Agent 执行都会更新 Token/成本/迭代
   - 始终有数据

### SubAgent 支持（未来）

当前 SubAgent 执行树需要后端支持以下 IPC 事件：
- `agent:sub-agent-start` - SubAgent 开始
- `agent:sub-agent-end` - SubAgent 结束

暂时通过工具名称推断（QuickTeam/Orchestrate/Pipeline/Delegate 等工具）

### MCP 服务器状态（未来）

需要后端支持以下 IPC 事件：
- `mcp:server-connect` - MCP 服务器连接
- `mcp:server-disconnect` - MCP 服务器断开

## 测试验证

### 1. 执行树测试
```
用户: "你好"
预期：执行树Tab显示 "Xuanji Assistant (主 Agent) - 运行中"
      执行完成后状态变为"已完成"，显示执行时长
```

### 2. TODO 测试
```
用户: "帮我创建一个TODO：实现登录功能"
预期：TODO Tab 显示新任务，状态为"待处理"

用户: "把第一个TODO标记为进行中"
预期：TODO Tab 任务状态更新为"进行中"，显示 activeForm
```

### 3. 权限测试
```
用户: "删除 test.txt"
预期：弹出权限对话框
      批准后，权限Tab显示新记录，状态"已批准"，显示响应时长
```

### 4. 系统测试
```
用户: "你好"（任意对话）
预期：系统Tab显示 Token 使用、成本、迭代次数
      每轮对话后迭代次数 +1
```

## 修改文件清单

| 文件 | 变更内容 |
|------|---------|
| `desktop/renderer/stores/chatStore.ts` | ✅ 初始化 rootAgent、监听 TODO 工具、修改权限 ID |
| `desktop/renderer/components/PermissionDialog.tsx` | ✅ 添加 executionStore 调用 |
| `desktop/renderer/components/PlanReviewDialog.tsx` | ✅ 添加 executionStore 调用 |
| `desktop/renderer/components/AskUserDialog.tsx` | ✅ 添加 executionStore 调用 |

## 总结

现在右侧执行面板的5个Tab都能正常展示数据：

1. **执行树** ✅ - 始终有数据（rootAgent 自动初始化）
2. **工具** ✅ - 始终有数据（工具调用记录）
3. **TODO** ⚠️ - 条件触发（需要调用 TODO 工具）
4. **权限** ⚠️ - 条件触发（需要权限交互）
5. **系统** ✅ - 始终有数据（Token/成本/迭代）

⚠️ 标记的Tab需要特定条件才会有数据，这是正常的业务逻辑。
