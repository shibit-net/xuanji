# 全局变量使用审计报告

生成时间: 2026-04-19

## 概述

本报告记录了 Xuanji 项目中所有使用全局变量的位置，并评估其合理性。

## 1. Window 对象使用 (浏览器环境)

### 1.1 Desktop Renderer - 类型定义
**文件**: `desktop/renderer/global.d.ts`
**用途**: TypeScript 类型声明，扩展 `Window` 接口
**状态**: ✅ 合理 - 这是 Electron 应用的标准做法

```typescript
declare global {
  interface Window {
    electron: ElectronAPI;
  }
}
```

**说明**: 
- 用于定义 Electron preload 脚本注入的 API
- 这是 Electron 应用的标准模式，无需重构

### 1.2 Desktop Renderer - 意图分析器
**文件**: `desktop/renderer/services/messageIntentAnalyzer.ts:147`
**用途**: 调用 Electron IPC API

```typescript
const result = await (window as any).electron.analyzeIntent?.(prompt);
```

**状态**: ⚠️ 需要改进
**建议**: 
- 移除 `as any` 类型断言
- 使用已定义的类型: `window.electron.analyzeIntent`
- 如果 `analyzeIntent` 是可选的，应在 `global.d.ts` 中标记为可选方法

## 2. Global 对象使用 (Node.js 环境)

### 2.1 测试文件中的全局变量
**文件**: 
- `src/memory/__tests__/performance.test.ts`
- `test/unit/mcp/HttpTransport.test.ts`
- `test/unit/mcp/EnhancedWebSearchTool.test.ts`

**状态**: ✅ 合理 - 测试环境中的 mock 和 setup
**说明**: 测试文件中使用全局变量进行环境配置是常见做法

### 2.2 ChatStore 中的全局变量
**文件**: `desktop/renderer/stores/chatStore.ts`
**用途**: 未发现直接使用全局变量，但使用了 `setTimeout` 等全局函数
**状态**: ✅ 合理 - 标准 Web API

## 3. ISO 时间戳使用情况

### 3.1 已优化的文件
- ✅ `src/adapters/cli/utils/LogSystem.ts` - 已使用 `formatShortTime()`
- ✅ `src/core/logging/UnifiedLogManager.ts` - 已使用 `formatLogTimestamp()`

### 3.2 待优化的文件 (使用 `new Date().toISOString()`)

以下文件仍在使用 ISO 8601 格式，需要评估是否需要优化：

1. **核心日志系统** (50+ 文件)
   - `src/core/agent/AgentLoop.ts`
   - `src/core/telemetry/AgentLoopLogger.ts`
   - `src/core/telemetry/AuditLogger.ts`
   - `src/core/telemetry/DailyUsageStats.ts`
   - 等等...

**评估**:
- 这些文件中的 ISO 时间戳主要用于**数据存储和传输**
- ISO 8601 格式是国际标准，适合存储和 API 传输
- **建议**: 保持存储层使用 ISO 格式，仅在**展示层**使用友好格式

## 4. 时间格式化策略

### 4.1 新增工具函数
**文件**: `src/shared/utils/time/formatters.ts`

提供以下函数:
- `formatLogTimestamp()` - 日志格式: "04-19 23:08:58"
- `formatFullTimestamp()` - 完整格式: "2026-04-19 23:08:58"
- `formatShortTime()` - 简短格式: "23:08:58"
- `getCurrentLogTimestamp()` - 获取当前时间的日志格式
- `getCurrentFullTimestamp()` - 获取当前时间的完整格式

### 4.2 使用原则

**存储层** (数据库、文件、API):
```typescript
// ✅ 使用 ISO 8601 格式
timestamp: new Date().toISOString()
```

**展示层** (日志输出、UI 显示):
```typescript
// ✅ 使用友好格式
import { formatLogTimestamp } from '@/shared/utils/time/formatters';
console.log(formatLogTimestamp(record.timestamp));
```

## 5. 需要重构的问题

### 5.1 高优先级
1. ⚠️ `messageIntentAnalyzer.ts:147` - 移除 `as any` 类型断言

### 5.2 低优先级
1. 考虑为其他日志输出点添加时间格式化（如需要）

## 6. 总结

### 全局变量使用情况
- **Window 对象**: 仅在 Electron Renderer 进程中使用，符合架构设计 ✅
- **Global 对象**: 未发现不当使用 ✅
- **测试环境**: 全局变量使用合理 ✅

### 时间格式优化
- ✅ 已创建统一的时间格式化工具
- ✅ 已优化 CLI 日志系统
- ✅ 已优化统一日志管理器
- ℹ️ 其他文件保持 ISO 格式用于存储（符合最佳实践）

### 建议
1. 修复 `messageIntentAnalyzer.ts` 中的类型断言问题
2. 在需要展示日志的地方使用新的格式化工具
3. 保持存储层使用 ISO 8601 标准格式
4. 无需大规模重构全局变量使用，当前架构合理
