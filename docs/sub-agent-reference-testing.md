# 子 Agent 引用功能测试指南

## 测试准备

1. 启动 Xuanji desktop 应用
2. 确保已经编译最新的代码

## 测试场景

### 场景1：单个子 agent（不应该有引用）

**输入**：
```
解读《出师表》
```

**预期行为**：
1. 主 agent 调用 task 工具，设置 `stream_to_user: true`
2. 子 agent 的输出直接流式展示给用户
3. 主 agent 不再输出（或只输出简短确认）
4. **不应该有引用标记**

### 场景2：多个子 agent 协作（应该有引用）

**输入**：
```
重构 src/core/agent/MainAgent.ts 文件，提取出 prompt 构建逻辑到单独的类，并添加单元测试
```

**预期行为**：
1. 主 agent 调用 agent_team 或多次 task
2. 多个子 agent 执行任务
3. 主 agent 总结输出，**应该包含引用标记**

**预期输出示例**：
```markdown
已完成 MainAgent.ts 的重构和测试，主要修改如下：

## 代码分析
探索 Agent 分析了 MainAgent.ts 的结构，发现以下问题：
- prompt 构建逻辑与主 agent 逻辑耦合
- 缺少单元测试
- 代码可读性较差

[查看详情: explore]

## 重构实现
编码 Agent 完成了以下重构：
- 创建了 PromptBuilder 类
- 将 prompt 构建逻辑迁移到新类
- 更新了 MainAgent 的调用方式

[查看详情: coder]

## 测试覆盖
测试 Agent 编写了 12 个单元测试：
- PromptBuilder 基础功能：5 个
- 边界情况测试：4 个
- 集成测试：3 个
覆盖率达到 92%

[查看详情: test-writer]
```

4. 点击 `[查看详情: explore]` 应该展开显示探索 Agent 的原始输出
5. 展开的内容应该包含：
   - Agent 名称
   - 执行时间
   - Token 使用量
   - 完整的原始输出

## 验证点

### 1. 后端验证

**检查 TaskTool 的输出**：

在 `src/core/tools/TaskTool.ts` 的 `formatResult` 方法中添加日志：

```typescript
console.log('[TaskTool] formatResult:', {
  streamToUser,
  hasMetadataMarker: content.includes('SUB_AGENT_METADATA'),
});
```

**预期**：
- 当 `streamToUser=false` 时，输出应该包含 `<!-- SUB_AGENT_METADATA: {...} -->` 标记

### 2. 前端验证

**检查 chatStore 的日志**：

在浏览器控制台中查看：

```
[chatStore] 提取到子 agent 引用: {
  agentId: "tool-xxx",
  agentName: "explore",
  originalOutput: "...",
  duration: 2300,
  tokensUsed: { input: 1234, output: 567 }
}
```

**检查消息的 subAgentReferences**：

在浏览器控制台中执行：

```javascript
useChatStore.getState().messages.forEach(msg => {
  if (msg.subAgentReferences) {
    console.log('Message with references:', msg.id, msg.subAgentReferences);
  }
});
```

### 3. UI 验证

**检查引用按钮的渲染**：

1. 在消息中应该看到可折叠的引用卡片
2. 卡片头部显示：
   - Agent 图标
   - Agent 名称
   - 执行时间
   - Token 使用量
   - 展开/收起图标
3. 点击卡片头部应该展开/收起
4. 展开后显示完整的原始输出

## 调试技巧

### 1. 如果引用标记没有被解析

**检查**：
- 主 agent 的输出中是否包含 `[查看详情: xxx]` 标记
- 标记格式是否正确（独立成行，前后没有其他内容）
- remarkSubAgentReference 插件是否正确加载

**调试**：
在 `remarkSubAgentReference.ts` 中添加日志：

```typescript
console.log('[remarkSubAgentReference] Processing paragraph:', text);
if (match) {
  console.log('[remarkSubAgentReference] Found reference:', agentName);
}
```

### 2. 如果引用数据没有被收集

**检查**：
- TaskTool 的输出中是否包含 `SUB_AGENT_METADATA` 标记
- `_handleAgentToolEnd` 中的正则是否匹配成功

**调试**：
在 `_handleAgentToolEnd` 中添加日志：

```typescript
console.log('[chatStore] Tool result:', data.result);
console.log('[chatStore] Metadata match:', metadataMatch);
```

### 3. 如果引用按钮不显示

**检查**：
- 消息的 `subAgentReferences` 字段是否有数据
- `getSubAgentReference` 函数是否能找到对应的引用
- 自定义组件 `sub-agent-reference` 是否正确渲染

**调试**：
在 MessageBubble 组件中添加日志：

```typescript
console.log('[MessageBubble] Message:', message);
console.log('[MessageBubble] SubAgentReferences:', message.subAgentReferences);
```

## 常见问题

### Q1: 引用标记被当作普通文本显示

**原因**：remarkSubAgentReference 插件没有正确加载或执行

**解决**：
1. 检查 `remarkPlugins={[remarkGfm, remarkSubAgentReference]}` 是否正确
2. 确保插件返回的是一个函数
3. 检查插件的 visit 逻辑是否正确

### Q2: 点击引用按钮没有反应

**原因**：状态管理或事件处理有问题

**解决**：
1. 检查 `expandedReferences` 状态是否正确更新
2. 检查 `toggleReference` 函数是否被调用
3. 使用 React DevTools 查看组件状态

### Q3: 引用内容为空或不正确

**原因**：metadata 解析失败或数据丢失

**解决**：
1. 检查 TaskTool 输出的 metadata 格式是否正确
2. 检查 JSON.parse 是否成功
3. 检查 `originalOutput` 字段是否被正确提取

## 成功标准

✅ 单个子 agent 任务不显示引用标记
✅ 多个子 agent 任务显示引用标记
✅ 引用标记被正确解析为可点击的按钮
✅ 点击按钮可以展开/收起原始输出
✅ 原始输出内容完整且格式正确
✅ 显示正确的执行时间和 token 使用量
