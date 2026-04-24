# 渐进式迁移 - 步骤1完成

## 已完成的工作

### ✅ 迁移 agent:text 事件

**分支**: `feat/messagebus-step1-agent-text`

**改动**：
1. 添加 MessageBus 基础设施
   - `EventTypes.ts` - 事件类型定义
   - `EnhancedMessageBus.ts` - 增强的MessageBus
   - `GlobalMessageBus.ts` - 全局MessageBus管理
   - `RendererMessageBus.ts` - Renderer端MessageBus

2. 修改 `chatStore.ts`
   - 导入 `messageBus`
   - 使用 `messageBus.on('agent:text', ...)` 订阅事件
   - 保留旧的 `window.electron.onAgentText` 作为fallback
   - 添加详细日志用于验证

## 测试计划

### 测试步骤
1. 启动应用
2. 发送消息给agent
3. 查看控制台日志，确认：
   - `[chatStore] messageBus 收到 agent:text` - 新方式工作
   - `[chatStore] window.electron 收到 agent:text (fallback)` - 旧方式仍然触发
4. 验证文本正常显示在聊天界面

### 预期结果
- ✅ 新的messageBus方式正常工作
- ✅ 文本正常显示
- ✅ 没有重复显示（因为fallback中注释掉了处理）

## 下一步

### 步骤2：迁移更多事件

一旦步骤1验证成功，继续迁移其他事件：

**优先级1（简单事件）**：
- `agent:thinking`
- `agent:usage`
- `agent:error`
- `agent:end`

**优先级2（工具事件）**：
- `agent:tool-start`
- `agent:tool-end`

**优先级3（复杂事件）**：
- `agent:team-start`
- `agent:team-member-start`
- `agent:team-member-end`
- `agent:subagent-start`
- `agent:subagent-end`

**优先级4（其他事件）**：
- `workspace:*` 事件
- `permission:*` 事件
- `plan-*` 事件

### 步骤3：清理旧代码

当所有事件迁移完成后：
1. 删除 `window.electron.onAgentText` 等专用方法
2. 删除 `removeAllListeners` 调用
3. 删除 `agent/index.ts` 中的手动转发逻辑
4. 更新文档

## 回滚计划

如果出现问题，可以快速回滚：

```bash
# 回滚到master
git checkout master

# 或者只回滚chatStore.ts的改动
git checkout master -- desktop/renderer/stores/chatStore.ts
```

## 优势

渐进式迁移的优势：
1. **风险可控** - 每次只迁移一个事件
2. **易于测试** - 可以充分测试每一步
3. **可回滚** - 出问题可以快速回滚
4. **保持稳定** - 不影响主分支的稳定性
5. **逐步完善** - 可以在迁移过程中发现和解决问题

---

创建时间：2026-04-24
分支：feat/messagebus-step1-agent-text
状态：已完成，待测试
