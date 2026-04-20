# MessageBus 重构进度

## 已完成

### 1. 核心系统
- ✅ 创建 MessageBus.ts - 完整的消息总线系统
- ✅ 删除旧的 message-channel.ts 和 child-message-channel.ts
- ✅ 创建完整的使用指南文档

### 2. 主进程重构
- ✅ agent/index.ts - 使用 MessageBus 替代旧的 messageChannel
  - 创建 agent 通道
  - 绑定子进程
  - 注册事件监听
  - 转发消息到渲染进程
  - 清理时删除通道

### 3. 子进程重构（部分完成）
- ✅ agent-bridge.ts - 使用 ChildMessageChannel
  - 创建子进程通道
  - 注册所有消息处理器（使用 handle 方法）
  - 删除旧的 switch-case 代码
  - 修改 handleInit 函数返回结果
  - 修改 handleAgentList 函数返回结果

## 待完成

### 1. 子进程 Handler 函数重构

需要修改所有 handler 函数，从：
```typescript
async function handleXxx(requestId: string, data?: any) {
  safeSend({ requestId, data: { success: true, result } });
}
```

改为：
```typescript
async function handleXxx(data?: any) {
  return { success: true, result };
}
```

**需要修改的函数列表：**

#### 会话管理
- [ ] handleSessionSave
- [ ] handleSessionResume
- [ ] handleSessionList
- [ ] handleSessionDelete
- [ ] handleCheckpointCreate
- [ ] handleCheckpointList
- [ ] handleCheckpointRewind

#### 记忆管理
- [ ] handleMemoryRetrieve
- [ ] handleMemoryStats
- [ ] handleGetMemoryConfig
- [ ] handleSaveMemoryConfig
- [ ] handleManualMemoryFlush
- [ ] handleExtractTopics
- [ ] handleGetMemoryList

#### 核心规则
- [ ] handleCoreRulesGetAll
- [ ] handleCoreRulesUpdate
- [ ] handleCoreRulesDelete

#### 工具统计
- [ ] handleGetUsageStats

#### Agent 管理
- [x] handleAgentList（已完成）
- [ ] handleAgentGet
- [ ] handleAgentCreate
- [ ] handleAgentUpdate
- [ ] handleAgentDelete

#### Skills / Tools / MCP
- [ ] handleSkillsList
- [ ] handleToolsList
- [ ] handleMcpList

#### 高级功能
- [ ] handleCompact
- [ ] handleGetDiagnostics

#### Prompt 配置
- [ ] handleGetPromptConfig
- [ ] handleSavePromptConfig

#### 权限管理
- [ ] handlePermissionList
- [ ] handlePermissionDelete
- [ ] handlePermissionClear

#### Todo 管理
- [ ] handleTodoArchiveCompleted
- [ ] handleTodoGetArchivedCount

#### 其他
- [ ] handleTriggerStartup
- [ ] handleSendMessage
- [ ] handleInterrupt
- [ ] handleReset
- [ ] handleGetState
- [ ] handleGetConfig
- [ ] handleGetFullConfig
- [ ] handleUpdateConfig

### 2. 测试和验证
- [ ] 测试 agent-list 功能
- [ ] 测试消息发送和接收
- [ ] 测试请求响应
- [ ] 测试错误处理
- [ ] 测试重试机制
- [ ] 测试超时控制

### 3. 文档更新
- [ ] 更新 README
- [ ] 添加迁移指南
- [ ] 添加故障排查指南

## 重构策略

### 方案 1：手动逐个修改（当前方案）
- 优点：精确控制，可以逐步测试
- 缺点：耗时较长

### 方案 2：批量脚本修改
创建脚本批量修改所有 handler 函数：
```bash
# 查找所有 handler 函数
grep -n "async function handle" agent-bridge.ts

# 批量替换模式
sed -i '' 's/async function handle\([A-Za-z]*\)(requestId: string, data\?: any)/async function handle\1(data?: any)/g'
sed -i '' 's/async function handle\([A-Za-z]*\)(requestId: string)/async function handle\1()/g'
```

### 方案 3：分阶段重构
1. 第一阶段：核心功能（init, agent-list, send-message）
2. 第二阶段：会话和记忆管理
3. 第三阶段：其他功能

## 建议

**推荐使用方案 3（分阶段重构）+ 方案 2（脚本辅助）**

1. 先完成核心功能的重构和测试
2. 使用脚本批量修改其他函数
3. 逐个测试验证

## 下一步

1. 完成核心 handler 函数的重构（init, agent-list, send-message）
2. 测试基本功能是否正常
3. 使用脚本批量修改剩余函数
4. 全面测试

## 注意事项

1. **向后兼容**：新的 MessageBus 完全向后兼容，可以逐步迁移
2. **错误处理**：所有 handler 函数都应该返回 `{ success: boolean, error?: string }` 格式
3. **事件通知**：某些操作需要同时发送事件通知（如 init-complete）
4. **日志**：保留关键的业务日志，删除调试日志
