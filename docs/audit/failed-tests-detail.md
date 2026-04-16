# 失败测试详细清单

> **生成时间**: 2025-03-24  
> **测试总数**: 1290 (1242 passed, 45 failed, 3 skipped)  
> **失败率**: 3.5%

---

## 🔴 P0 - 阻塞性问题（15 项）

### 1. Electron 集成测试（13 failures）

**文件**: `test/integration/electron-integration.test.ts`

#### 1.1 Chat IPC Handlers (7 failures)

```
❌ Electron IPC Handlers > chat:init > 应初始化会话并返回配置
❌ Electron IPC Handlers > chat:init > 无参数也能初始化成功
❌ Electron IPC Handlers > chat:run > 未初始化时应返回错误
❌ Electron IPC Handlers > chat:run > 初始化后应能运行对话
❌ Electron IPC Handlers > chat:stop > 应能停止运行
❌ Electron IPC Handlers > chat:reset > 应能重置会话
❌ Electron IPC Handlers > chat:state > 初始化后应返回状态
```

**根本原因**:
- `electron` 模块的 `ipcMain` 未正确 mock
- `ChatSession` 在测试环境中初始化失败
- IPC handler 注册逻辑与实际 Electron 环境不一致

**影响范围**:
- 桌面端适配器完全不可用
- 无法验证 Electron 应用核心功能

**修复建议**:
```typescript
// test/integration/electron-integration.test.ts
import { vi } from 'vitest';

// 正确 mock electron 模块
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel, handler) => {
      // 存储 handler 供测试调用
    }),
    removeHandler: vi.fn()
  },
  app: {
    getPath: vi.fn(() => '/tmp/test')
  }
}));

// Mock ChatSession
vi.mock('../../src/core/chat/ChatSession', () => ({
  ChatSession: vi.fn().mockImplementation(() => ({
    init: vi.fn().mockResolvedValue(undefined),
    run: vi.fn().mockResolvedValue(undefined),
    // ... 其他方法
  }))
}));
```

**估计工时**: 4 小时

---

#### 1.2 Bot Management (4 failures)

```
❌ Electron IPC Handlers > bot:start / bot:stop > 应能启动钉钉机器人
❌ Electron IPC Handlers > bot:start / bot:stop > 应能停止已启动的机器人
❌ Electron IPC Handlers > bot:start / bot:stop > 停止未运行的机器人应返回错误
❌ Electron IPC Handlers > bot:start / bot:stop > 不支持的机器人类型应返回错误
```

**根本原因**:
- `DingTalkBot` 和 `LarkBot` 类未 mock
- 机器人启动需要真实网络连接
- 机器人管理状态未隔离

**修复建议**:
```typescript
// Mock IM Adapters
vi.mock('../../src/adapters/im/DingTalkBot', () => ({
  DingTalkBot: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    isRunning: vi.fn().mockReturnValue(false)
  }))
}));
```

**估计工时**: 2 小时

---

#### 1.3 Preload Script (2 failures)

```
❌ Preload Script > 应通过 contextBridge 暴露 API
❌ Preload Script > chat.onText 应注册事件监听器并返回清理函数
```

**根本原因**:
- `contextBridge.exposeInMainWorld` 未 mock
- `ipcRenderer` 未正确模拟

**修复建议**:
```typescript
vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: vi.fn()
  },
  ipcRenderer: {
    invoke: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn()
  }
}));
```

**估计工时**: 1 小时

---

### 2. 配置验证系统（2 failures）

**文件**: 
- `test/unit/config/ConfigValidator.test.ts`
- `test/unit/config/GlobalConfig.test.ts`

```
❌ ConfigValidator > validate() > 应检测缺失的必填字段 provider.apiKey
❌ GlobalConfig > resolveEnvConfig() 应映射环境变量
```

**根本原因**:
- 环境变量解析逻辑重构后，测试断言未更新
- `ConfigValidator` 错误信息格式变更

**实际行为 vs 预期行为**:
```typescript
// 预期
errors = [{ path: 'provider.apiKey', message: '缺失必填字段' }]

// 实际
errors = [{ 
  path: 'provider.apiKey', 
  message: '缺失必填字段（可通过环境变量 XUANJI_API_KEY 设置）' 
}]
```

**修复建议**:
```typescript
// 更新测试断言
expect(errors[0].message).toContain('缺失必填字段');
// 而不是精确匹配
```

**估计工时**: 1 小时

---

## 🟡 P1 - 高优先级问题（18 项）

### 3. 遥测统计模块（2 failures）

**文件**: `test/unit/telemetry/DailyUsageStats.test.ts`

```
❌ DailyUsageStats > should return cost trend
❌ DailyUsageStats > should fill missing dates with zero cost
```

**根本原因**:
- 日期填充逻辑在时区切换时出错
- 成本计算公式变更（tokens × rate）

**失败日志**:
```
Expected: [
  { date: '2025-03-20', cost: 0 },
  { date: '2025-03-21', cost: 0.05 },
  { date: '2025-03-22', cost: 0 }
]
Actual: [
  { date: '2025-03-21', cost: 0.05 }
]
```

**修复建议**:
```typescript
// src/core/telemetry/DailyUsageStats.ts
export function fillMissingDates(data: CostData[], startDate: Date, endDate: Date) {
  const result: CostData[] = [];
  const dataMap = new Map(data.map(d => [d.date, d.cost]));
  
  let current = new Date(startDate);
  while (current <= endDate) {
    const dateStr = current.toISOString().split('T')[0];
    result.push({
      date: dateStr,
      cost: dataMap.get(dateStr) || 0
    });
    current.setDate(current.getDate() + 1);
  }
  
  return result;
}
```

**估计工时**: 2 小时

---

### 4. 会话记忆集成（4 failures）

**文件**: 
- `test/integration/session-memory-integration.test.ts`
- `test/unit/memory/MemoryManager.test.ts`

```
❌ Memory System > 格式化为 Prompt 片段
❌ MemoryManager > should format memories for prompt (×2)
❌ MemoryManager > should truncate formatted prompt to max length
```

**根本原因**:
- `MemoryManager.formatForPrompt()` 输出格式从 JSON 改为 Markdown
- 截断逻辑使用字符数而非 token 数

**实际行为 vs 预期行为**:
```typescript
// 旧格式（测试预期）
{
  "recent_context": [...],
  "relevant_memories": [...]
}

// 新格式（实际输出）
## 📝 Relevant Past Context

### 👤 User Facts
- Prefers TypeScript over JavaScript
- ...
```

**修复建议**:
```typescript
// 选项 1：更新测试用例匹配新格式
expect(prompt).toContain('## 📝 Relevant Past Context');
expect(prompt).toContain('### 👤 User Facts');

// 选项 2：保留旧格式作为可选项
formatForPrompt({ format: 'json' | 'markdown' })
```

**估计工时**: 3 小时

---

### 5. ChatSession 核心模块（4 failures）

**文件**: `test/unit/chat/ChatSession.test.ts`

```
❌ ChatSession > init() 使用注入的组件应成功初始化
❌ ChatSession > init() 重复调用应幂等
❌ ChatSession > 缺少 apiKey 应抛出异常
❌ ChatSession > run() 应成功执行对话
```

**根本原因**:
- 构造函数参数从配置对象改为依赖注入
- 初始化流程变为异步（需要加载 skills）

**修复建议**:
```typescript
// test/unit/chat/ChatSession.test.ts
describe('ChatSession', () => {
  let session: ChatSession;
  let mockProvider: ILLMProvider;
  let mockMemory: IMemoryStore;
  // ... 其他 mock

  beforeEach(async () => {
    // 创建所有 mock
    mockProvider = createMockProvider();
    mockMemory = createMockMemory();
    
    // 使用依赖注入
    session = new ChatSession({
      provider: mockProvider,
      memory: mockMemory,
      tools: mockToolRegistry,
      // ...
    });
    
    // 等待初始化完成
    await session.init();
  });

  it('应成功执行对话', async () => {
    const result = await session.run('Hello');
    expect(result).toBeDefined();
  });
});
```

**估计工时**: 4 小时

---

### 6. 工作流技能测试（3 failures）

**文件**: `test/unit/skills/WorkflowSkills.test.ts`

```
❌ WorkflowSkills > pipeline > should execute sequential pipeline
❌ WorkflowSkills > orchestrate > should coordinate team workflow
❌ WorkflowSkills > quick_team > should use predefined template
```

**根本原因**:
- 多 Agent 协作超时（默认 120s）
- Mock Agent 未正确返回结果

**修复建议**:
- 使用 `vi.useFakeTimers()` 加速测试
- 确保 mock Agent 立即返回

**估计工时**: 2 小时

---

### 7. MCP 适配器测试（2 failures）

**文件**: `test/unit/mcp/tool-adapter.test.ts`

```
❌ MCPToolAdapter > should handle tool call errors gracefully
❌ MCPToolAdapter > should validate tool parameters
```

**根本原因**:
- MCP 服务器错误响应格式变更
- 参数验证使用新的 JSON Schema validator

**估计工时**: 2 小时

---

### 8. 其他测试（3 failures）

```
❌ test/unit/config/GlobalConfig.test.ts > getEnvMappings() 应返回环境变量映射表
❌ test/unit/memory/MemoryManager.test.ts > should format memories for prompt
❌ test/integration/session-memory-integration.test.ts > Memory System > 格式化为 Prompt 片段
```

**估计工时**: 2 小时

---

## 🟢 P2 - 中优先级问题（12 项）

### 9. HttpTransport 超时（1 critical error）

**文件**: `test/unit/mcp/HttpTransport.test.ts`

**错误日志**:
```
Error: Timeout - Async callback was not invoked within the 5000 ms timeout specified by jest.setTimeout.
  at listOnTimeout (node:internal/timers:581:17)
```

**根本原因**:
- `setTimeout` 未在测试结束时清理
- Promise 未正确 reject

**修复建议**:
```typescript
describe('HttpTransport', () => {
  let transport: HttpTransport;
  let timeoutId: NodeJS.Timeout;

  afterEach(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    transport.close();
  });

  it('应在超时后拒绝请求', async () => {
    const promise = transport.request({
      method: 'slow_method',
      params: {},
      timeout: 100
    });

    await expect(promise).rejects.toThrow('Request timeout');
  });
});
```

**估计工时**: 1 小时

---

### 10. 其他零散失败（11 failures）

包括：
- BashTool 参数转义测试
- PersistentShell 状态保持测试
- SkillRegistry 异步依赖测试
- ...

**共性问题**:
- Mock 不完整
- 异步清理缺失
- 断言过期

**估计工时**: 6 小时（平均每个 30 分钟）

---

## 📊 修复优先级矩阵

| 优先级 | 失败数 | 影响范围 | 估计工时 | 建议完成时间 |
|--------|--------|----------|----------|--------------|
| P0 | 15 | Electron 适配器 + 配置系统 | 8h | 本周内 |
| P1 | 18 | 核心模块稳定性 | 15h | 2 周内 |
| P2 | 12 | 边缘功能 + 清理 | 7h | 1 月内 |

**总计**: 45 个失败测试，预计 30 小时修复工作量

---

## 🛠️ 批量修复脚本

### 快速定位失败测试

```bash
# 运行特定模块测试
npx vitest run test/integration/electron-integration.test.ts

# 仅运行失败的测试
npx vitest run --reporter=verbose 2>&1 | grep "❌" > failed.txt

# 按优先级分类
grep "electron-integration" failed.txt > p0.txt
grep "ChatSession\|MemoryManager\|DailyUsageStats" failed.txt > p1.txt
```

### 自动生成修复 PR

```bash
# 创建修复分支
git checkout -b fix/test-failures-round3

# 批量修复 P0
npx vitest run test/integration/electron-integration.test.ts --reporter=verbose

# 提交
git add test/integration/electron-integration.test.ts
git commit -m "fix(test): 修复 Electron 集成测试（P0）"
```

---

## 📎 参考资料

- [Vitest Mocking Guide](https://vitest.dev/guide/mocking.html)
- [Electron Testing Best Practices](https://www.electronjs.org/docs/latest/tutorial/testing)
- [项目测试规范](../../.xuanji/rules.md#测试要求)

---

**报告结束**  
*下一步：执行修复计划并更新此文档*
