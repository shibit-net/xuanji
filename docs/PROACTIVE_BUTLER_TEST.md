# ProactiveButler 测试计划

## 单元测试

### 1. ProactiveButler 核心逻辑

**文件**: `test/unit/butler/ProactiveButler.test.ts`

测试用例：
- ✅ 初始化和依赖注入
- ✅ 上下文收集（reminders + memories）
- ✅ 快速筛选（shouldSkipDecision）
  - 无待处理事项 → 跳过
  - 静默时段 + 无紧急 → 跳过
  - 最近推送过 → 跳过
- ✅ LLM 决策调用和解析
- ✅ 降级决策（LLM 失败时）
- ✅ 推送执行和记录
- ✅ 用户反馈记录

### 2. 定时任务调度

测试用例：
- ✅ scheduleDaily 正确计算延迟
- ✅ 定时器触发执行 check()
- ✅ 兜底轮询定时器
- ✅ stopDaemon 清理所有定时器

### 3. 推送历史管理

测试用例：
- ✅ 推送记录持久化
- ✅ 推送历史加载
- ✅ 重复推送检测

## 集成测试

### 1. ChatSession 集成

**文件**: `test/integration/butler-chatsession.test.ts`

测试用例：
- ✅ initProactiveButler 正确初始化
- ✅ 注册 ButlerDaemonTool
- ✅ 工具调用启动/停止管家

### 2. 端到端推送流程

**文件**: `test/integration/butler-e2e.test.ts`

测试用例：
- ✅ 完整决策流程（上下文 → 决策 → 推送）
- ✅ OVERDUE 提醒强制推送
- ✅ 关系维护建议推送
- ✅ 静默时段过滤

## Mock 策略

### LLM Provider Mock

```typescript
const mockLLMProvider = {
  generateText: jest.fn(async ({ prompt }) => {
    // 根据 prompt 内容返回不同决策
    if (prompt.includes('OVERDUE')) {
      return {
        text: JSON.stringify({
          shouldPush: true,
          reason: 'OVERDUE reminder detected',
          notification: {
            title: '⚠️ 过期提醒',
            body: '你有过期提醒',
            priority: 'high',
            channel: 'system',
          },
        }),
      };
    }
    return {
      text: JSON.stringify({
        shouldPush: false,
        reason: 'No urgent items',
      }),
    };
  }),
};
```

### Pusher Mock

```typescript
const mockPusher = {
  init: jest.fn(async () => {}),
  push: jest.fn(async (notification) => {
    console.log('Mock push:', notification);
  }),
  isAvailable: jest.fn(() => true),
};
```

## 测试数据准备

### 提醒数据

```typescript
const testReminders = [
  {
    id: 'rem_001',
    content: 'Alice 的生日',
    triggerDate: '2026-03-04', // 过期
    recurring: 'yearly',
    status: 'active',
    source: 'user_explicit',
    createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'rem_002',
    content: '提交周报',
    triggerDate: '2026-03-06', // 今日
    recurring: 'weekly',
    status: 'active',
    source: 'auto_extracted',
    createdAt: '2026-02-01T00:00:00Z',
  },
];
```

### 记忆数据

```typescript
const testMemories = [
  {
    id: 'mem_001',
    type: 'relationship',
    content: 'Alice 喜欢日料和文艺片',
    keywords: ['Alice', 'japanese', 'movies'],
    confidence: 0.9,
    createdAt: '2026-01-01T00:00:00Z',
    lastAccessedAt: '2026-01-01T00:00:00Z',
    accessCount: 1,
    source: 'chat',
  },
];
```

## 手动测试清单

### 1. 基础功能

- [ ] 启动管家服务（`butler_daemon start`）
- [ ] 手动触发检查（`butler_daemon check`）
- [ ] 查看状态（`butler_daemon status`）
- [ ] 停止管家服务（`butler_daemon stop`）

### 2. 决策准确性

- [ ] OVERDUE 提醒触发高优先级推送
- [ ] 今日提醒触发正常推送
- [ ] 关系维护建议（60天+未联系）
- [ ] 静默时段过滤（22:00-08:00）
- [ ] 频率限制（1小时内不重复推送）

### 3. 推送渠道

- [ ] macOS 系统通知显示正常
- [ ] 飞书机器人推送（需配置）
- [ ] 推送内容友好、可读

### 4. 边界情况

- [ ] LLM 决策失败时降级处理
- [ ] 无待处理事项时跳过
- [ ] 推送历史持久化
- [ ] 重启后管家状态恢复

## 性能测试

### 指标

- ✅ 决策耗时 < 5s（LLM 调用）
- ✅ 上下文收集 < 1s
- ✅ 推送执行 < 2s
- ✅ 内存占用 < 100MB（后台服务）

### 压力测试

- 模拟 100+ 提醒同时到期
- 模拟 1000+ 记忆条目检索
- 长时间运行（24小时）稳定性

## 回归测试

每次修改后验证：
1. 现有提醒系统（ReminderEngine）未受影响
2. ChatSession 初始化流程正常
3. CLI 工具注册和调用正常
4. 配置加载和默认值正确

## CI/CD 集成

```yaml
# .github/workflows/test.yml
jobs:
  test:
    steps:
      - name: Run Butler Tests
        run: npm run test:butler
      
      - name: Check Coverage
        run: npm run test:coverage -- src/butler
```

## 覆盖率目标

- 核心逻辑（ProactiveButler.ts）: > 80%
- 工具集成（ButlerDaemonTool.ts）: > 70%
- 类型定义（types.ts）: 100%（类型检查）

## 测试优先级

1. **P0（必须）**：决策逻辑、推送执行、频率限制
2. **P1（重要）**：定时调度、降级处理、用户反馈
3. **P2（可选）**：性能测试、压力测试、长时间稳定性
