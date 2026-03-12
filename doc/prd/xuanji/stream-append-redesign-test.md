# 补充输入流式输出交互测试计划

## 改进内容

优化了用户在 Agent 流式输出期间补充输入时的展示逻辑，解决以下问题：
1. ✅ 已输出内容不再丢失（立即归档到 Static）
2. ✅ 缓冲模式正确重置（新输出重新计算行数）
3. ✅ 视觉连续性好（分段清晰，无闪烁）
4. ✅ 内容完整展示（无截断）

## 核心改动

### 1. 立即归档策略

**修改文件**：`src/adapters/cli/App.tsx`

**修改位置**：`handleSubmit` 中的执行期间分支

**改动前**：
```typescript
if (status !== 'idle') {
  setPendingUserInput({ content: input, timestamp: Date.now() });
  agentLoop.appendMessage(input);
  return;
}
```

**改动后**：
```typescript
if (status !== 'idle') {
  // [1] 立即归档当前流式文本
  if (streamTextUpdaterRef.current) {
    streamTextUpdaterRef.current.flush();
  }
  archiveStreamText();

  // [2] 保存补充输入（显示绿色提示）
  setPendingUserInput({ content: input, timestamp: Date.now() });

  // [3] 触发新响应
  agentLoop.appendMessage(input);
  return;
}
```

### 2. UI 演变流程

#### 阶段 1：初始响应

```
[Static 区域]
  ...之前的对话历史

[动态区域]
  🤔 正在思考...

  Hello, I'm Claude. I can help you with...
  [流式输出继续]

  Let me explain how AI works...
  [假设输出了 100 行，触发缓冲模式]

  🔄 生成中... (150 行)
```

#### 阶段 2：用户补充输入

用户输入："请用更简洁的语言"并按 Enter

```
[Static 区域]
  ...之前的对话历史

  🤖 Hello, I'm Claude. I can help you with...
     Let me explain how AI works...
     [第一轮完整内容，已归档到 Static]

[动态区域]
  ✓ 已收到补充：请用更简洁的语言  (绿色提示)

  🤔 正在思考...
```

#### 阶段 3：新响应输出

```
[Static 区域]
  ...之前的对话历史

  🤖 Hello, I'm Claude. I can help you with...
     Let me explain how AI works...
     [第一轮完整内容]

[动态区域]
  ✓ 已收到补充：请用更简洁的语言  (绿色提示)

  Sure! Let me simplify...
  [第二轮流式输出]
```

#### 阶段 4：完成

```
[Static 区域]
  ...之前的对话历史

  🤖 Hello, I'm Claude. I can help you with...
     Let me explain how AI works...
     [第一轮完整内容]

  👤 请用更简洁的语言
  💬 追加消息

  🤖 Sure! Let me simplify...
     [第二轮完整内容]
```

## 测试场景

### 场景 1：短响应 + 补充输入

**目标**：验证基本流程

**步骤**：
1. 启动 xuanji：`npm run dev`
2. 输入问题："介绍一下 TypeScript"
3. 等待 Agent 输出约 10 行后，输入："请简化"并按 Enter
4. 观察 UI 变化

**预期结果**：
- ✅ 第一轮 10 行内容归档到 Static，保持可见
- ✅ 动态区域显示绿色提示："✓ 已收到补充：请简化"
- ✅ Thinking spinner 出现
- ✅ 第二轮内容流式输出
- ✅ 完成后，补充输入添加到历史（位置在第一轮和第二轮之间）
- ✅ 绿色提示消失

### 场景 2：长响应 + 缓冲模式 + 补充输入

**目标**：验证缓冲模式重置

**步骤**：
1. 启动 xuanji
2. 输入问题："写一篇关于 AI 发展历史的长文，至少 500 行"
3. 等待输出超过 50 行，触发缓冲模式（显示 "🔄 生成中... (150 行)"）
4. 在缓冲模式下输入："停止，太长了"并按 Enter
5. 观察 UI 变化

**预期结果**：
- ✅ 第一轮内容（150+ 行）归档到 Static
- ✅ 缓冲模式进度提示消失
- ✅ 动态区域显示绿色提示："✓ 已收到补充：停止，太长了"
- ✅ 第二轮输出重新开始计算行数
- ✅ 如果第二轮也超过 50 行，重新触发缓冲模式
- ✅ 完成后，所有内容完整展示在 Static

### 场景 3：工具调用期间补充输入

**目标**：验证工具执行不受影响

**步骤**：
1. 启动 xuanji
2. 输入问题："读取 package.json 文件并分析依赖"
3. 在 Agent 调用 Read 工具时，输入："只关注 devDependencies"
4. 观察 UI 变化

**预期结果**：
- ✅ 第一轮文本归档
- ✅ 工具调用结果正常显示（Read 工具的输出）
- ✅ 绿色提示出现
- ✅ 第二轮输出基于补充内容调整（只分析 devDependencies）

### 场景 4：多次补充输入（当前限制）

**目标**：验证单个 pending 限制

**步骤**：
1. 启动 xuanji
2. 输入问题："解释递归"
3. 快速连续输入：
   - "请举例"（立即按 Enter）
   - "用 Python"（立即按 Enter）
4. 观察 UI 变化

**预期结果**：
- ⚠️ 只有最后一次补充生效（"用 Python"）
- ⚠️ 第一次补充（"请举例"）被覆盖
- ✅ 提示显示最后一次补充内容

**说明**：这是当前设计的已知限制，未来可扩展为数组支持多次补充。

### 场景 5：Ctrl+C 中断 + 补充输入

**目标**：验证中断场景的 pending 处理

**步骤**：
1. 启动 xuanji
2. 输入问题："写一篇长文"
3. 等待输出约 20 行后，输入："简化一下"
4. 立即按 Ctrl+C 中断
5. 观察 UI 变化

**预期结果**：
- ✅ 第一轮内容（20 行）归档到 Static
- ✅ 补充输入添加到历史："👤 简化一下"
- ✅ 中断提示："⏸️ 会话已中断"
- ✅ 绿色提示消失
- ✅ 所有内容按顺序展示：第一轮 → 补充输入 → 中断提示

### 场景 6：缓冲模式完成后补充

**目标**：验证缓冲模式完成后的交互

**步骤**：
1. 启动 xuanji
2. 输入问题："列举 100 个常见的编程术语并解释"
3. 等待输出超过 50 行，进入缓冲模式
4. 等待缓冲模式自然完成（显示完整内容到 Static）
5. 在完成前的最后时刻输入："停止"
6. 观察 UI 变化

**预期结果**：
- ✅ 缓冲模式完成，第一轮内容一次性归档到 Static
- ✅ 如果补充输入发生在 `onEnd` 前，触发新一轮响应
- ✅ 如果补充输入发生在 `onEnd` 后（status = 'idle'），作为新问题处理

### 场景 7：空流式文本 + 补充输入

**目标**：验证边界情况（工具调用前补充）

**步骤**：
1. 启动 xuanji
2. 输入问题："读取文件 test.txt"
3. 在 Thinking spinner 显示时（还没有流式文本），输入："改为读取 data.txt"
4. 观察 UI 变化

**预期结果**：
- ✅ `archiveStreamText()` 检测到 `streamTextRef.current` 为空，不归档
- ✅ 绿色提示正常显示
- ✅ 新响应基于补充内容调整（读取 data.txt）

### 场景 8：长补充内容

**目标**：验证长补充内容的展示

**步骤**：
1. 启动 xuanji
2. 输入问题："介绍 React"
3. 输入很长的补充内容（超过 60 字符）：
   ```
   请详细说明 React 的 Hooks 机制，包括 useState、useEffect、useContext、useReducer、useMemo、useCallback 等常用 Hooks 的用法和最佳实践
   ```
4. 观察 UI 变化

**预期结果**：
- ✅ 绿色提示截断显示："✓ 已收到补充：请详细说明 React 的 Hooks 机制，包括 useState、useEffect、..."
- ✅ 完成后，Static 中显示完整补充内容（不截断）

## 回归测试

### 基础功能
- [ ] 正常对话流程（无补充输入）
- [ ] 斜杠命令
- [ ] 工具调用
- [ ] 权限对话框
- [ ] Plan Review
- [ ] AskUser
- [ ] TODO 进度
- [ ] 会话保存与恢复

### 流式输出
- [ ] 正常流式输出
- [ ] Thinking spinner
- [ ] 缓冲模式（超过 50 行）
- [ ] Markdown 渲染
- [ ] Token 统计
- [ ] 成本计算

### 中断机制
- [ ] Ctrl+C 中断
- [ ] /stop 命令
- [ ] handleInterrupt 归档
- [ ] Pending 对话框清理

## 性能检查

### 内存
- [ ] 长对话后内存占用正常（< 500MB）
- [ ] 多次归档后无内存泄漏

### 渲染
- [ ] 归档时无明显闪烁（< 100ms）
- [ ] 缓冲模式切换流畅
- [ ] 静态区域滚动性能正常

## 已知问题与限制

### 1. 单个 Pending 限制

**现象**：多次快速补充输入，只保留最后一次

**原因**：`pendingUserInput` 是单个对象，后续补充会覆盖

**影响**：用户需要等待上一次补充生效后再输入下一次

**未来优化**：改为数组，支持队列

### 2. 缓冲模式归档延迟

**现象**：缓冲模式下补充输入，归档大文本到 Static 可能有短暂卡顿（50-100ms）

**原因**：Ink Static 组件渲染大量行数时性能瓶颈

**缓解**：已使用 throttled updater 减少渲染频率

**未来优化**：虚拟滚动（需要 Ink 支持或切换到其他终端 UI 框架）

### 3. 历史消息顺序

**现象**：补充输入消息在 `onEnd` 时才添加到历史，中间可能有时间差

**原因**：设计选择，确保补充消息位置正确（第一轮和第二轮之间）

**影响**：无，timestamp 记录的是用户输入时间，不是添加到历史的时间

## 文档更新

- ✅ 设计文档：`doc/prd/xuanji/stream-append-redesign.md`
- ✅ 测试计划：本文档
- ⏳ 用户手册：添加"补充输入"使用说明（待更新）
- ⏳ 项目记忆：更新到 `MEMORY.md`（待更新）

## 验证清单

- [ ] 类型检查通过：`npm run typecheck`
- [ ] 构建成功：`npm run build`
- [ ] 所有测试场景通过（1-8）
- [ ] 回归测试通过
- [ ] 性能检查正常
- [ ] 文档已更新
