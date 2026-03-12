# AgentLoop 执行日志系统

## 概述

AgentLoop 执行日志系统为 xuanji 提供了完善的调试和监控能力，记录 Agent 执行过程中的所有关键事件。

## 特性

### 1. 全面的事件记录

- ✅ **迭代日志**：每次迭代的开始和结束
- ✅ **消息管理**：用户追加消息、上下文压缩
- ✅ **LLM 交互**：请求参数、响应统计、重试记录
- ✅ **工具执行**：分组策略、执行状态、结果统计
- ✅ **异常处理**：错误捕获、堆栈跟踪、恢复策略
- ✅ **会话统计**：Token 使用、成本计算、性能指标

### 2. 结构化日志

- **格式**：JSONL（每行一个 JSON 对象）
- **位置**：`~/.xuanji/logs/agent-loop.log`
- **字段**：时间戳、事件类型、会话 ID、迭代次数、详细数据

### 3. 敏感数据脱敏

- 自动截断长文本（最大 500 字符）
- 保留关键信息用于调试
- 避免泄露敏感输入

## 日志事件类型

### 迭代生命周期

```typescript
// 迭代开始
{
  "eventType": "iteration_start",
  "iteration": 1,
  "maxIterations": 100,
  "messageCount": 5,
  "hasPendingAppend": false
}

// 迭代结束
{
  "eventType": "iteration_end",
  "iteration": 1,
  "stopReason": "tool_use",
  "toolCallCount": 2,
  "durationMs": 1523
}
```

### 消息处理

```typescript
// 用户追加消息
{
  "eventType": "message_append",
  "message": "用英文回复",
  "interrupted": true,
  "delayMs": 100
}

// 上下文压缩
{
  "eventType": "context_compress",
  "originalTokens": 15000,
  "compressedTokens": 8000,
  "compressionRatio": 0.47,
  "durationMs": 2341
}
```

### LLM 调用

```typescript
// LLM 请求
{
  "eventType": "llm_request",
  "messageCount": 10,
  "toolCount": 19,
  "estimatedInputTokens": 8234,
  "maxTokens": 64000,
  "requestParams": {
    "temperature": 1.0,
    "hasThinking": false
  }
}

// LLM 响应
{
  "eventType": "llm_response",
  "stopReason": "tool_use",
  "contentBlockCount": 2,
  "toolCallCount": 1,
  "usage": {
    "input": 8234,
    "output": 156,
    "cacheRead": 5123,
    "cacheWrite": 3111
  },
  "durationMs": 3456
}

// LLM 重试
{
  "eventType": "llm_retry",
  "retryCount": 1,
  "reason": "rate_limit_error",
  "errorType": "RateLimitError",
  "errorMessage": "模型服务请求频率超限",
  "delayMs": 5000
}
```

### 工具执行

```typescript
// 工具分组
{
  "eventType": "tool_group",
  "parallelIds": ["tool-001", "tool-002"],
  "serialIds": ["tool-003"],
  "totalTools": 3
}

// 工具执行
{
  "eventType": "tool_execute",
  "toolCallId": "tool-001",
  "toolName": "read_file",
  "input": {
    "file_path": "/path/to/file.ts"
  },
  "isParallel": true
}

// 工具结果
{
  "eventType": "tool_result",
  "toolCallId": "tool-001",
  "toolName": "read_file",
  "success": true,
  "resultLength": 1234,
  "durationMs": 45
}
```

### 异常处理

```typescript
// 异常捕获
{
  "eventType": "error_caught",
  "errorName": "Error",
  "errorMessage": "API request failed",
  "errorStack": "Error: API request failed\n    at...",
  "context": {
    "running": true,
    "messageCount": 10,
    "pendingAppend": false,
    "interrupted": false
  },
  "recoverable": true
}

// 用户中断
{
  "eventType": "interrupt",
  "reason": "user_interrupt",
  "appendMessage": "用英文",
  "streamActive": true,
  "activeTools": []
}
```

### 会话完成

```typescript
{
  "eventType": "session_complete",
  "totalIterations": 5,
  "totalDurationMs": 12345,
  "totalUsage": {
    "input": 25000,
    "output": 3000,
    "cacheRead": 15000,
    "cacheWrite": 10000
  },
  "totalCost": 0.15,
  "toolStats": [
    {
      "name": "read_file",
      "count": 3,
      "totalDurationMs": 120,
      "errorCount": 0
    },
    {
      "name": "edit_file",
      "count": 2,
      "totalDurationMs": 850,
      "errorCount": 0
    }
  ],
  "status": "completed"
}
```

## 查询和分析

### 基本查询

```typescript
import { AgentLoopLogger } from '@/core/telemetry';

// 查询特定会话的所有日志
const logs = await AgentLoopLogger.query({
  sessionId: 'session-1234567890',
});

// 查询特定事件类型
const errorLogs = await AgentLoopLogger.query({
  eventType: ['error_caught', 'llm_retry'],
  limit: 100,
});

// 查询错误日志
const errors = await AgentLoopLogger.query({
  errorsOnly: true,
  timeRange: {
    start: '2026-03-06T00:00:00Z',
    end: '2026-03-06T23:59:59Z',
  },
});

// 查询特定迭代范围
const iterationLogs = await AgentLoopLogger.query({
  sessionId: 'session-1234567890',
  iterationRange: { min: 5, max: 10 },
});
```

### 会话摘要

```typescript
// 获取会话统计摘要
const summary = await AgentLoopLogger.getSessionSummary('session-1234567890');

console.log(summary);
// 输出:
// {
//   sessionId: 'session-1234567890',
//   totalIterations: 8,
//   totalDurationMs: 23456,
//   totalTokens: 28000,
//   totalCost: 0.15,
//   errorCount: 1,
//   toolCallCount: 12,
//   events: {
//     iteration_start: 8,
//     iteration_end: 8,
//     llm_request: 8,
//     llm_response: 8,
//     tool_group: 5,
//     tool_execute: 12,
//     tool_result: 12,
//     error_caught: 1,
//     session_complete: 1
//   }
// }
```

### 命令行工具（未来扩展）

```bash
# 查看最近的会话
xuanji logs --recent 10

# 查看特定会话
xuanji logs --session session-1234567890

# 只显示错误
xuanji logs --errors-only

# 导出为 JSON
xuanji logs --session session-1234567890 --export session.json

# 实时监控（类似 tail -f）
xuanji logs --follow
```

## 调试技巧

### 1. 排查频率限制问题

```typescript
// 查找所有重试事件
const retries = await AgentLoopLogger.query({
  eventType: 'llm_retry',
  sessionId: 'your-session-id',
});

// 分析重试原因
retries.forEach((log) => {
  console.log(`Iteration ${log.iteration}: ${log.reason} (retry ${log.retryCount})`);
});
```

### 2. 分析性能瓶颈

```typescript
// 查找耗时最长的迭代
const logs = await AgentLoopLogger.query({
  eventType: 'iteration_end',
  sessionId: 'your-session-id',
});

logs.sort((a, b) => b.durationMs - a.durationMs);
console.log('最慢的 5 次迭代:', logs.slice(0, 5));
```

### 3. 检查工具执行失败

```typescript
// 查找工具执行错误
const toolErrors = await AgentLoopLogger.query({
  eventType: 'tool_result',
  sessionId: 'your-session-id',
});

const failed = toolErrors.filter((log) => !log.success);
console.log(`失败的工具调用: ${failed.length}`, failed);
```

### 4. 追踪上下文压缩

```typescript
// 查看压缩历史
const compressions = await AgentLoopLogger.query({
  eventType: 'context_compress',
  sessionId: 'your-session-id',
});

compressions.forEach((log) => {
  console.log(
    `Iteration ${log.iteration}: ${log.originalTokens} → ${log.compressedTokens} (${(log.compressionRatio * 100).toFixed(1)}%)`
  );
});
```

## 性能影响

- **异步写入**：日志写入不阻塞主流程
- **自动脱敏**：长文本自动截断到 500 字符
- **按需查询**：只在需要时读取日志文件
- **JSONL 格式**：高效追加和解析

## 日志文件管理

### 日志文件位置

```
~/.xuanji/logs/agent-loop.log
```

### 日志轮转（未来扩展）

- 按日期轮转：`agent-loop-2026-03-06.log`
- 自动压缩旧日志：`agent-loop-2026-03-05.log.gz`
- 保留最近 30 天

### 清理日志

```bash
# 手动清理
rm ~/.xuanji/logs/agent-loop.log

# 保留最近 N 天（未来扩展）
xuanji logs --clean --keep-days 30
```

## 最佳实践

1. **定期检查错误日志**：使用 `errorsOnly: true` 过滤器快速定位问题
2. **会话完成后查看摘要**：使用 `getSessionSummary()` 了解整体执行情况
3. **性能调优**：分析 `iteration_end` 和 `tool_result` 的耗时数据
4. **成本监控**：关注 `session_complete` 的 `totalCost` 字段
5. **重试分析**：查看 `llm_retry` 事件，优化重试策略

## 未来扩展

- [ ] 日志轮转和自动清理
- [ ] 实时日志监控 Web 界面
- [ ] 日志聚合和可视化
- [ ] 性能分析报告生成
- [ ] 告警和通知（错误率、成本超限）
- [ ] 导出到外部监控系统（Prometheus、Grafana）
