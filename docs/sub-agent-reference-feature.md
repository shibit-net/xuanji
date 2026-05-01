# 子 Agent 引用功能实现文档

## 功能概述

当主 agent 使用多个子 agent 协作完成任务时，主 agent 会总结各个子 agent 的输出。为了让用户能够查看子 agent 的原始输出，我们实现了"引用原文"功能。

## 实现方案

### 1. 主 agent 插入引用标记

**修改文件**：`src/core/agent/dispatch/MainAgent.ts`

在主 agent 的 system prompt 中添加指导，告诉它在总结时插入引用标记：

```markdown
**重要：插入引用标记**

当你总结子 agent 的输出时，在相关段落后插入引用标记，格式为：

\`\`\`
[查看详情: <子agent名称>]
\`\`\`

**示例**：
\`\`\`
## 代码分析
探索 Agent 分析了现有代码结构，发现了以下问题：
- auth.ts 中的函数过于复杂，职责不清
- 缺少输入验证

[查看详情: 探索 Agent]
\`\`\`
```

### 2. 后端保存子 agent 的原始输出

**修改文件**：`src/core/tools/TaskTool.ts`

在 `formatResult` 方法中，将子 agent 的原始输出保存到 metadata 中：

```typescript
return this.success(content, {
  subAgent: true,
  duration: result.duration,
  tokensUsed: result.tokensUsed,
  timedOut: result.timedOut,
  iterations: result.iterations,
  // 🔧 保存原始输出，用于"引用原文"功能
  originalOutput: result.result,
});
```

### 3. 前端数据结构

**修改文件**：`desktop/renderer/stores/chatStore.ts`

添加 `SubAgentReference` 类型和 `subAgentReferences` 字段：

```typescript
export interface SubAgentReference {
  agentId: string;
  agentName: string;
  originalOutput: string;
  duration: number;
  tokensUsed: {
    input: number;
    output: number;
  };
}

export interface Message {
  // ... 其他字段
  subAgentReferences?: SubAgentReference[];
}
```

### 4. 前端解析引用标记

**新建文件**：`desktop/renderer/utils/remarkSubAgentReference.ts`

创建一个 remark 插件，解析 `[查看详情: <名称>]` 标记：

```typescript
export function remarkSubAgentReference() {
  return (tree: Root) => {
    visit(tree, 'paragraph', (node: Paragraph, index, parent) => {
      // 匹配引用标记：[查看详情: <名称>]
      const match = /^\[查看详情:\s*(.+?)\]$/.exec(text.trim());
      if (!match) return;

      const agentName = match[1].trim();

      // 创建自定义节点
      const referenceNode: SubAgentReferenceNode = {
        type: 'subAgentReference',
        data: {
          hName: 'sub-agent-reference',
          hProperties: { agentName },
        },
        children: [],
      };

      // 替换原节点
      parent.children[index] = referenceNode;
    });
  };
}
```

### 5. 前端渲染引用按钮

**修改文件**：`desktop/renderer/components/MessageBubble.tsx`

在 ReactMarkdown 的 components 中添加自定义渲染：

```typescript
<ReactMarkdown
  remarkPlugins={[remarkGfm, remarkSubAgentReference]}
  components={{
    'sub-agent-reference': ({ agentName }: any) => {
      const reference = getSubAgentReference(agentName);
      const isExpanded = expandedReferences.has(agentName);

      return (
        <div className="my-3 border border-border-primary rounded-lg">
          {/* 引用头部 - 可点击展开/收起 */}
          <button onClick={() => toggleReference(agentName)}>
            <Bot size={14} />
            <span>{reference.agentName}</span>
            <span>{(reference.duration / 1000).toFixed(1)}s</span>
            {isExpanded ? <ChevronUp /> : <ChevronDown />}
          </button>

          {/* 引用内容 - 展开时显示 */}
          {isExpanded && (
            <div className="p-4">
              {reference.originalOutput}
            </div>
          )}
        </div>
      );
    },
  }}
>
  {message.content}
</ReactMarkdown>
```

### 6. 收集子 agent 引用

**修改文件**：`desktop/renderer/stores/chatStore.ts`

在 `_handleAgentToolEnd` 中，当工具是 `task` 时，提取子 agent 的信息并保存：

```typescript
if (toolCall.name === 'task' && !data.isError) {
  // 解析工具输出，提取 metadata
  const outputMatch = /Duration: ([\d.]+)s.*?Tokens: (\d+) in \/ (\d+) out/s.exec(data.result);
  
  if (outputMatch) {
    const reference: SubAgentReference = {
      agentId: data.id,
      agentName: toolCall.input?.subagent_type as string,
      originalOutput: extractOriginalOutput(data.result),
      duration: parseFloat(outputMatch[1]) * 1000,
      tokensUsed: {
        input: parseInt(outputMatch[2], 10),
        output: parseInt(outputMatch[3], 10),
      },
    };

    set((state) => ({
      _subAgentReferences: [...state._subAgentReferences, reference],
    }));
  }
}
```

在 `_handleAgentEnd` 中，将收集的引用添加到最后一条消息：

```typescript
_handleAgentEnd: (state) => {
  const { _subAgentReferences, currentStreamingId } = get();

  set((prevState) => ({
    messages: prevState.messages.map((msg) => {
      if (msg.id === currentStreamingId) {
        return {
          ...msg,
          subAgentReferences: _subAgentReferences,
        };
      }
      return msg;
    }),
    _subAgentReferences: [], // 清空引用列表
  }));
},
```

## 用户体验

### 场景：重构认证模块

**用户输入**：
```
重构认证模块并添加测试
```

**主 agent 的输出**：
```markdown
已完成认证模块重构，主要修改如下：

## 代码分析
探索 Agent 分析了现有代码结构，发现了以下问题：
- auth.ts 中的函数过于复杂，职责不清
- 缺少输入验证
- 错误处理不完善

[查看详情: 探索 Agent]

## 重构实现
编码 Agent 完成了以下重构：
- 将 auth.ts 拆分为 3 个独立模块
- 添加了输入验证中间件
- 统一了错误处理机制

[查看详情: 编码 Agent]

## 测试覆盖
测试 Agent 编写了 15 个单元测试：
- 认证流程测试：8 个
- 错误处理测试：5 个
- 边界情况测试：2 个
覆盖率达到 95%

[查看详情: 测试 Agent]
```

**UI 渲染效果**：

每个 `[查看详情: xxx]` 标记会被渲染为一个可折叠的卡片：

```
┌─────────────────────────────────────────┐
│ 🤖 探索 Agent    2.3s    1234 tokens  ▼│
├─────────────────────────────────────────┤
│ [展开后显示原始输出]                     │
│                                         │
│ 我分析了 auth.ts 文件，发现以下问题：    │
│ 1. authenticate() 函数有 150 行代码...  │
│ 2. 缺少对用户输入的验证...              │
│ ...                                     │
└─────────────────────────────────────────┘
```

点击卡片头部可以展开/收起原始输出。

## 优势

1. **位置精确**：引用出现在相关总结的段落后，用户可以立即查看详情
2. **按需展开**：默认收起，不影响阅读流畅性
3. **信息完整**：保留了子 agent 的完整输出，包括执行时间和 token 使用量
4. **实现简单**：通过标记语法实现，主 agent 只需插入简单的文本标记

## 待完成的工作

1. ✅ 修改主 agent 的 system prompt
2. ✅ 修改 TaskTool 保存原始输出
3. ✅ 添加前端数据结构
4. ✅ 创建 remark 插件
5. ✅ 修改 MessageBubble 组件
6. ⏳ 在 `_handleAgentToolEnd` 中收集引用
7. ⏳ 在 `_handleAgentEnd` 中添加引用到消息
8. ⏳ 测试完整流程

## 注意事项

1. **标记格式必须严格**：`[查看详情: <名称>]` 必须独立成行，前后不能有其他内容
2. **名称匹配**：引用标记中的名称必须与 `subagent_type` 匹配
3. **性能考虑**：原始输出可能很长，需要考虑是否需要截断或分页
4. **错误处理**：如果找不到对应的引用，显示占位符而不是报错
