# Logger System — 日志系统

璇玑统一日志系统，支持分级输出、颜色区分、文件持久化。

## 特性

- ✅ **日志分级**: debug / info / warn / error
- ✅ **按级别分文件**: `~/.xuanji/logs/{debug,info,warn,error}.log`
- ✅ **颜色区分**: 
  - debug: 灰色
  - info: 蓝色
  - warn: 黄色
  - error: 红色
- ✅ **双输出**: 同时输出到控制台和文件
- ✅ **命名空间**: 支持模块级 Logger（如 `xuanji:AgentLoop`）
- ✅ **环境适配**: 开发环境用 debug 包，生产环境用 consola

## 快速开始

```typescript
import { logger } from '@/core/logger';

// 创建模块级 Logger
const log = logger.child({ module: 'MyModule' });

// 使用
log.debug('调试信息', { data: 123 });
log.info('操作成功');
log.warn('警告信息');
log.error('错误信息', error);
```

## 环境变量

```bash
# 日志级别（debug/info/warn/error）
XUANJI_LOG_LEVEL=info

# 日志目录（默认: ~/.xuanji/logs）
XUANJI_LOG_DIR=/path/to/logs

# 强制使用特定实现（debug/consola）
XUANJI_LOGGER_TYPE=consola

# 开发环境：控制 debug 包的命名空间过滤
DEBUG=xuanji:*              # 所有模块
DEBUG=xuanji:AgentLoop:*    # 仅 AgentLoop 模块
```

## 日志文件

日志按级别分文件存储在 `~/.xuanji/logs/`：

```
~/.xuanji/logs/
├── debug.log    # 调试日志
├── info.log     # 信息日志
├── warn.log     # 警告日志
└── error.log    # 错误日志
```

每个文件格式：

```
[2026-04-12T10:30:45.123Z] [INFO ] [xuanji:AgentLoop] 开始执行任务
[2026-04-12T10:30:46.456Z] [ERROR] [xuanji:ToolRegistry] 工具执行失败 {"tool":"ReadTool","error":"文件不存在"}
```

## 实现原理

### 开发环境（DebugLogger）

- 使用 `debug` 包（轻量，24.4 kB）
- 自动为不同命名空间分配颜色
- 通过 `DEBUG` 环境变量过滤输出
- 输出到 stderr（不干扰 stdout）

### 生产环境（ConsolaLogger）

- 使用 `consola` 包（UnJS 生态）
- CLI 友好的格式化输出
- 支持日志级别过滤
- 自动颜色区分

### 文件持久化（FileWriter）

- 异步追加写入，不阻塞主流程
- 按日志级别分文件
- 所有 Logger 实例共享文件句柄
- 写入失败静默处理

## 最佳实践

### 1. 模块级 Logger

每个模块创建自己的 Logger：

```typescript
// src/core/agent/AgentLoop.ts
import { logger } from '@/core/logger';

const log = logger.child({ module: 'AgentLoop' });

export class AgentLoop {
  async run() {
    log.info('开始执行');
    log.debug('当前状态', { iteration: 1 });
  }
}
```

### 2. 日志级别选择

- **debug**: 详细的调试信息（开发时使用）
- **info**: 重要的业务流程（如任务开始/结束）
- **warn**: 警告信息（如配置缺失、降级处理）
- **error**: 错误信息（如异常、失败）

### 3. 结构化日志

传递对象作为额外参数：

```typescript
log.info('工具执行完成', {
  tool: 'ReadTool',
  duration: 123,
  success: true,
});
```

### 4. 错误日志

记录错误时传递 Error 对象：

```typescript
try {
  await doSomething();
} catch (error) {
  log.error('操作失败', error);
}
```

## 迁移指南

### 从 console.log 迁移

**之前：**
```typescript
console.log('开始执行');
console.error('错误:', error);
```

**之后：**
```typescript
import { logger } from '@/core/logger';
const log = logger.child({ module: 'MyModule' });

log.info('开始执行');
log.error('错误:', error);
```

### 批量替换

使用提供的脚本：

```bash
# 预览
npx tsx scripts/replace-console-logs.ts --dry-run

# 应用更改
npx tsx scripts/replace-console-logs.ts
```

## 进程退出时清理

在应用退出时关闭文件句柄：

```typescript
import { closeFileWriter } from '@/core/logger';

process.on('beforeExit', async () => {
  await closeFileWriter();
});
```

## 测试

在测试中禁用文件输出：

```typescript
import { createLogger } from '@/core/logger';

const log = createLogger({
  enableFile: false,  // 禁用文件输出
  enableConsole: true,
});
```

## 架构

```
src/core/logger/
├── index.ts                    # 主导出 + 全局实例
├── factory.ts                  # Logger 工厂
├── types.ts                    # 类型定义
├── implementations/
│   ├── DebugLogger.ts          # debug 包实现
│   ├── ConsolaLogger.ts        # consola 包实现
│   ├── FileWriter.ts           # 文件写入器
│   └── index.ts                # 实现导出
└── README.md                   # 本文档
```

## 常见问题

### Q: 为什么日志没有输出到控制台？

A: 检查环境变量：
- 开发环境：确保 `DEBUG=xuanji:*` 或未设置（自动启用）
- 生产环境：确保 `XUANJI_LOG_LEVEL` 不高于你的日志级别

### Q: 如何只看特定模块的日志？

A: 使用 DEBUG 环境变量过滤：
```bash
DEBUG=xuanji:AgentLoop:* npm run dev
```

### Q: 日志文件太大怎么办？

A: 可以定期清理或使用日志轮转工具（如 logrotate）。未来版本会内置日志轮转功能。

### Q: 如何在生产环境禁用 debug 日志？

A: 设置环境变量：
```bash
XUANJI_LOG_LEVEL=info
```

## 未来计划

- [ ] 日志轮转（按大小/时间）
- [ ] 远程日志上报
- [ ] 日志查询 CLI
- [ ] 性能监控集成
