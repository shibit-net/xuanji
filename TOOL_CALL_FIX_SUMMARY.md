# 璇玑工具调用修复总结

## 🎯 问题描述

xuanji 无法正常执行工具调用，导致：
- LLM 无法识别应该何时调用工具
- 多轮对话中工具结果无法正确传递
- Agent 循环无法正常工作

## 🔍 根本原因

### 问题 1: AnthropicProvider 消息格式转换缺陷 (最关键)

**文件**: `src/core/providers/AnthropicProvider.ts`

**缺陷**: 第 44-47 行直接强制转换消息内容为字符串
```typescript
// ❌ 错误代码
messages: chatMessages.map((m) => ({
  role: m.role as 'user' | 'assistant',
  content: m.content as string,  // 无法处理 ContentBlock[]
})),
```

**影响**:
- 当消息内容是 `ContentBlock[]` 时（包含工具调用和工具结果），无法正确转换
- JavaScript 将对象转为 `[object Object]` 字符串，导致 LLM 收到无效内容
- LLM 无法理解工具结果，所以不知道应该继续推理

### 问题 2: System Prompt 不够明确

**文件**: `src/core/agent/MessageManager.ts`

**缺陷**: 系统提示词没有明确告诉 LLM：
- 何时应该使用工具
- 工具调用的完整流程
- 不应该假设而应该使用工具

## ✅ 解决方案

### 修复 1: 添加 ContentBlock 格式转换

**修改文件**: `src/core/providers/AnthropicProvider.ts`

1. **导入 ContentBlock 类型** (第 6 行)
```typescript
import type { ..., ContentBlock } from '@/core/types';
```

2. **修改消息映射** (第 44-47 行)
```typescript
// ✅ 正确代码
messages: chatMessages.map((m) => ({
  role: m.role as 'user' | 'assistant',
  content: this.formatMessageContent(m.content),
})),
```

3. **添加格式化方法** (类的最后)
```typescript
private formatMessageContent(
  content: string | ContentBlock[],
): string | Anthropic.MessageParam['content'] {
  if (typeof content === 'string') {
    return content;
  }

  // 转换 ContentBlock[] 为 Anthropic API 格式
  return content.map((block) => {
    switch (block.type) {
      case 'text':
        return { type: 'text' as const, text: block.text || '' };

      case 'thinking':
        return { type: 'text' as const, text: `[思考]: ${block.thinking}` };

      case 'tool_use':
        return {
          type: 'tool_use' as const,
          id: block.id || '',
          name: block.name || '',
          input: block.input || {},
        };

      case 'tool_result':
        return {
          type: 'tool_result' as const,
          tool_use_id: block.tool_use_id || '',
          content: block.content || '',
          is_error: block.is_error || false,
        };

      default:
        return { type: 'text' as const, text: '' };
    }
  });
}
```

### 修复 2: 改进 System Prompt

**修改文件**: `src/core/agent/MessageManager.ts`

新增明确的工具使用指导：
- "必须使用工具操作文件，不要假设"
- "修改文件前先读取"
- "工具调用的完整流程说明"
- "危险操作需确认"

完整 system prompt 见 `MessageManager.ts` 第 86-102 行。

## 📊 验证结果

### 类型检查
```bash
npm run typecheck
# ✅ 无错误
```

### 测试结果
```
Test Files  1 failed | 26 passed (27)
      Tests  2 failed | 251 passed (253)
```

**关键测试通过** ✅:
- `test/integration/react-loop.test.ts` — 所有 6 个测试通过
  - ✅ 简单对话 (无工具调用)
  - ✅ 完整 ReAct 循环 (文本 → 工具 → 文本)
  - ✅ 多轮工具调用
  - ✅ 错误处理
  - ✅ 循环停止
  - ✅ 其他边界情况

**失败的测试无关** (国际化和 Electron 既有问题):
- Electron IPC 机器人类型错误消息
- mainWindow.isDestroyed 方法问题

## 🔄 修复前后对比

### 修复前 ❌

```
用户: "读取 config.json"
  ↓
LLM 收到消息格式: { role: 'user', content: '读取 config.json' }
LLM 生成: "我假设 config.json 的内容是..." （无工具调用）
  ↓
Agent 无法执行工具，对话失败
```

### 修复后 ✅

```
用户: "读取 config.json"
  ↓
第 1 轮:
  LLM 收到: system prompt + user message + 工具 schema
  LLM 生成: 调用 read_file 工具，参数: { path: 'config.json' }
  ↓
第 2 轮:
  MessageManager 添加工具结果到历史
  LLM 收到:
    - system prompt
    - user message
    - assistant message (包含 tool_use 块)
    - tool_result message (包含文件内容)
  LLM 生成: "文件内容是..." （正确解析工具结果）
  ↓
Agent 成功执行，对话完成 ✅
```

## 🧪 测试覆盖

| 场景 | 测试文件 | 状态 |
|------|---------|------|
| 消息管理 | `test/unit/agent/MessageManager.test.ts` | ✅ 8/8 通过 |
| 流处理 | `test/unit/agent/StreamProcessor.test.ts` | ✅ 8/8 通过 |
| 工具调度 | `test/unit/agent/ToolDispatcher.test.ts` | ✅ 4/4 通过 |
| ReAct 循环 | `test/integration/react-loop.test.ts` | ✅ 6/6 通过 |

## 📝 关键改进

1. **类型安全**: 正确处理 `string | ContentBlock[]` 的消息内容
2. **API 兼容**: 确保 Anthropic API 的期望格式
3. **流程清晰**: System prompt 明确指导 LLM 何时调用工具
4. **完整性**: 支持工具调用、工具结果、思考过程等完整 ReAct 循环

## 🚀 后续工作

- [ ] 为 OpenAI Provider 补充类似的转换逻辑 (参考 code)
- [ ] 添加 Ollama Provider 支持 (P3)
- [ ] 增加错误恢复和重试机制 (P1)
- [ ] 实现 Token 窗口管理 (P2)
- [ ] 添加权限控制和命令守卫 (P1)

## 📖 相关文档

- 修复计划: `/Users/kevinshi/.claude/plans/xuanji-tool-call-fix.md`
- P0 架构: `doc/tad/xuanji/01-p0-architecture.md`
- 开发规划: `doc/prd/xuanji/development-plan.md`
- CLAUDE.md: 项目约定和架构原则
