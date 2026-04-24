# AskUser 工具并发控制机制

## 概述

当多个子 agent 同时使用 `ask_user` 工具时，系统会自动排队处理，避免用户混乱。

## 核心特性

### 1. 自动队列机制

多个 agent 同时调用 `ask_user` 时，问题会自动排队：

```typescript
// 子 agent A
await ask_user({ question: "问题 A" });

// 子 agent B（同时执行）
await ask_user({ question: "问题 B" });

// 结果：问题 A 先显示，用户回答后，问题 B 再显示
```

### 2. 优先级控制

可以设置问题优先级（1-10，默认 5）：

```typescript
// 高优先级问题（会插队）
await ask_user({
  question: "这是紧急问题",
  priority: 9
});

// 普通优先级问题
await ask_user({
  question: "这是普通问题",
  priority: 5
});
```

**优先级规则**：
- 数值越大，优先级越高
- 优先级相同时，按提问时间排序（先到先得）
- 高优先级问题会插队到队列前面

### 3. 超时控制

可以设置问题超时时间（毫秒）：

```typescript
// 设置 1 分钟超时
await ask_user({
  question: "请快速回答",
  timeout: 60000  // 60 秒
});

// 默认超时 5 分钟
await ask_user({
  question: "这个问题有 5 分钟回答时间"
});
```

**超时行为**：
- 超时后自动返回错误
- 队列继续处理下一个问题
- 不会阻塞其他 agent

### 4. Agent 上下文显示

UI 会显示问题来源（哪个 agent 提问）：

```
┌─────────────────────────────────┐
│ 来自 coder agent                │
│                                 │
│ 需要选择数据库类型吗？          │
│ ○ MySQL                         │
│ ○ PostgreSQL                    │
│ ○ MongoDB                       │
│                                 │
│ [确定] [取消]                   │
└─────────────────────────────────┘
```

---

## 使用示例

### 示例 1: 基本用法

```typescript
// Agent 配置
{
  tools: [
    { name: 'ask_user', required: true }
  ]
}

// Agent 代码
const answer = await ask_user({
  question: "请选择编程语言",
  options: ["TypeScript", "Python", "Go"],
  multiSelect: false
});
```

### 示例 2: 高优先级问题

```typescript
// 紧急问题（会插队）
const confirm = await ask_user({
  question: "检测到安全风险，是否继续？",
  options: ["继续", "取消"],
  priority: 10  // 最高优先级
});
```

### 示例 3: 带超时的问题

```typescript
// 快速决策问题
const choice = await ask_user({
  question: "是否使用默认配置？",
  options: ["是", "否"],
  default: "是",
  timeout: 30000,  // 30 秒超时
  priority: 7      // 较高优先级
});
```

### 示例 4: 并行 Agent 场景

```typescript
// TaskPlanner 返回并行任务
{
  strategy: 'parallel',
  tasks: [
    {
      id: 'task-1',
      agentId: 'coder',
      description: '实现用户注册'
    },
    {
      id: 'task-2',
      agentId: 'coder',
      description: '实现用户登录'
    }
  ]
}

// 两个 agent 可能同时提问
// task-1: "需要邮箱验证吗？"
// task-2: "需要记住登录状态吗？"

// 结果：问题自动排队，用户逐个回答
```

---

## 队列处理流程

```
子 agent A 调用 ask_user (priority: 5)
  ↓
加入队列 [A]
  ↓
开始处理 A

同时...

子 agent B 调用 ask_user (priority: 8)
  ↓
加入队列 [A, B]
  ↓
按优先级排序 [B, A]  // B 优先级更高
  ↓
等待 A 完成

A 完成后
  ↓
处理 B
  ↓
显示问题 B
  ↓
等待用户回复
  ↓
返回给 agent B
```

---

## 配置说明

### Agent 配置

在 agent 配置文件中声明 `ask_user` 工具：

```json5
// coder.json5
{
  id: 'coder',
  name: 'Coder Agent',
  
  tools: [
    { name: 'ask_user', required: true },  // ✅ 必须声明
    // ... 其他工具
  ]
}
```

### 工具参数

```typescript
interface AskUserInput {
  /** 问题文本（必填） */
  question: string;
  
  /** 选项列表（可选） */
  options?: string[];
  
  /** 是否多选（可选，默认 false） */
  multiSelect?: boolean;
  
  /** 默认值（可选） */
  default?: string;
  
  /** 优先级（可选，1-10，默认 5） */
  priority?: number;
  
  /** 超时时间（可选，毫秒，默认 300000） */
  timeout?: number;
}
```

---

## 前端集成

### 接收问题请求

```typescript
// desktop/renderer/stores/chatStore.ts

ipcRenderer.on('ask-user:request', (event, data) => {
  const { id, question, options, multiSelect, context } = data;
  
  // 显示问题对话框
  showAskUserDialog({
    id,
    question,
    options,
    multiSelect,
    // 🆕 显示来源
    agentName: context?.agentName || 'Agent',
    priority: context?.priority || 5,
    timeout: context?.timeout || 300000
  });
});
```

### 发送用户回复

```typescript
// 用户回答后
ipcRenderer.send('ask-user:response', {
  id: 'ask-123',
  answer: '用户的回答'
});
```

### UI 显示建议

```tsx
// AskUserDialog.tsx

function AskUserDialog({ request }) {
  return (
    <Dialog>
      {/* 显示来源 */}
      <Badge color="blue">
        来自 {request.context?.agentName || 'Agent'}
      </Badge>
      
      {/* 显示优先级 */}
      {request.context?.priority > 7 && (
        <Badge color="red">重要</Badge>
      )}
      
      {/* 问题内容 */}
      <h3>{request.question}</h3>
      
      {/* 选项 */}
      {request.options && (
        <RadioGroup
          options={request.options}
          multiSelect={request.multiSelect}
        />
      )}
      
      {/* 超时倒计时 */}
      {request.context?.timeout && (
        <Countdown
          duration={request.context.timeout}
          onTimeout={() => handleTimeout(request.id)}
        />
      )}
      
      {/* 按钮 */}
      <Button onClick={handleSubmit}>确定</Button>
      <Button onClick={handleCancel}>取消</Button>
    </Dialog>
  );
}
```

---

## 最佳实践

### 1. 合理使用优先级

```typescript
// ✅ 好的做法
// 安全确认 - 高优先级
await ask_user({
  question: "检测到危险操作，是否继续？",
  priority: 10
});

// 普通选择 - 默认优先级
await ask_user({
  question: "选择数据库类型",
  priority: 5  // 可省略
});

// ❌ 不好的做法
// 所有问题都设置高优先级
await ask_user({
  question: "选择颜色",
  priority: 10  // 不必要
});
```

### 2. 设置合理的超时

```typescript
// ✅ 好的做法
// 快速决策 - 短超时
await ask_user({
  question: "使用默认配置？",
  timeout: 30000  // 30 秒
});

// 复杂选择 - 长超时
await ask_user({
  question: "请仔细阅读并选择许可协议",
  timeout: 600000  // 10 分钟
});

// ❌ 不好的做法
// 所有问题都设置很短的超时
await ask_user({
  question: "复杂的技术选型问题",
  timeout: 5000  // 5 秒太短
});
```

### 3. 避免不必要的提问

```typescript
// ✅ 好的做法
// 只在必要时提问
if (!hasDefaultConfig) {
  const config = await ask_user({
    question: "请选择配置"
  });
}

// ❌ 不好的做法
// 过度提问
await ask_user({ question: "开始工作吗？" });  // 不必要
await ask_user({ question: "确定吗？" });      // 不必要
await ask_user({ question: "真的确定吗？" });  // 不必要
```

### 4. 优先使用 Sequential 策略

```typescript
// ✅ 好的做法
// 需要用户交互的任务使用串行策略
{
  strategy: 'sequential',
  tasks: [
    { agentId: 'coder', description: '配置数据库' },  // 可能提问
    { agentId: 'coder', description: '配置缓存' }     // 可能提问
  ]
}

// ⚠️ 谨慎使用
// 并行策略可能导致多个问题同时排队
{
  strategy: 'parallel',
  tasks: [
    { agentId: 'coder', description: '配置数据库' },
    { agentId: 'coder', description: '配置缓存' }
  ]
}
```

---

## 故障排查

### 问题 1: 问题没有显示

**可能原因**：
- Agent 配置中未声明 `ask_user` 工具
- UI 层未正确处理 `ask-user:request` 事件

**解决方法**：
```json5
// 检查 agent 配置
{
  tools: [
    { name: 'ask_user', required: true }  // ✅ 确保声明
  ]
}
```

### 问题 2: 问题超时

**可能原因**：
- 超时时间设置过短
- 用户未及时回复

**解决方法**：
```typescript
// 增加超时时间
await ask_user({
  question: "...",
  timeout: 600000  // 10 分钟
});
```

### 问题 3: 队列阻塞

**可能原因**：
- 某个问题一直未回复
- 超时未正确处理

**解决方法**：
- 确保所有问题都设置了超时
- UI 提供"跳过"按钮

---

## 技术实现

### 核心代码

```typescript
// src/core/tools/AskUserTool.ts

export class AskUserTool extends BaseTool {
  private queue: QueueItem[] = [];
  private processing = false;

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    // 构建请求
    const request: AskUserRequest = {
      question: input.question as string,
      context: {
        agentId: (input as any)._agentId,
        agentName: (input as any)._agentName,
        priority: (input.priority as number) ?? 5,
        timeout: (input.timeout as number) ?? 300000,
      },
    };

    // 加入队列
    return new Promise<ToolResult>((resolve) => {
      this.queue.push({ request, resolve, timestamp: Date.now() });
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;

    // 按优先级排序
    this.queue.sort((a, b) => {
      const priorityA = a.request.context?.priority ?? 5;
      const priorityB = b.request.context?.priority ?? 5;
      if (priorityA !== priorityB) {
        return priorityB - priorityA;
      }
      return a.timestamp - b.timestamp;
    });

    this.processing = true;
    const item = this.queue.shift()!;

    try {
      // 设置超时
      const timeout = item.request.context?.timeout ?? 300000;
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('超时')), timeout);
      });

      // 等待回复
      const answer = await Promise.race([
        this.handler!(item.request),
        timeoutPromise,
      ]);

      item.resolve(this.success(answer));
    } catch (err) {
      item.resolve(this.error(err.message));
    } finally {
      this.processing = false;
      this.processQueue();  // 处理下一个
    }
  }
}
```

---

## 总结

**核心优势**：
- ✅ 自动队列，避免并发混乱
- ✅ 优先级控制，重要问题优先
- ✅ 超时保护，避免死锁
- ✅ 上下文显示，用户知道来源

**使用建议**：
- 合理设置优先级（1-10）
- 设置合理的超时时间
- 避免不必要的提问
- 优先使用串行策略

**前端集成**：
- 显示问题来源（agent 名称）
- 显示优先级标识
- 显示超时倒计时
- 提供跳过/取消按钮
