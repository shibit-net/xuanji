# 事件清单

## Agent 事件

### 基础事件
- `agent:text` - Agent 输出文本
- `agent:thinking` - Agent 思考内容
- `agent:thinking-start` - Agent 开始思考
- `agent:tool-start` - 工具调用开始
- `agent:tool-end` - 工具调用结束
- `agent:file-changes` - 文件变更通知
- `agent:usage` - Token 使用统计
- `agent:error` - Agent 错误
- `agent:end` - Agent 执行结束

### SubAgent 事件
- `agent:subagent-start` - 子 Agent 启动
- `agent:subagent-end` - 子 Agent 结束

### Team 事件
- `agent:team-start` - 团队启动
- `agent:team-member-start` - 团队成员启动
- `agent:team-member-end` - 团队成员结束
- `agent:team-member-text` - 团队成员输出文本
- `agent:team-member-thinking` - 团队成员思考
- `agent:team-end` - 团队结束

### 其他 Agent 事件
- `agent:compress-start` - 压缩开始
- `agent:compress-end` - 压缩结束
- `agent:memory-read` - Memory 读取
- `agent:memory-write` - Memory 写入
- `agent:skill-start` - Skill 开始
- `agent:skill-end` - Skill 结束

## Workspace 事件

- `workspace:intent-analysis-start` - 意图分析开始
- `workspace:intent-analysis-end` - 意图分析结束
- `workspace:model-classifier-start` - 模型分类开始
- `workspace:model-classifier-end` - 模型分类结束
- `workspace:task-planning-start` - 任务规划开始
- `workspace:task-planning-end` - 任务规划结束
- `workspace:task-execution-start` - 任务执行开始
- `workspace:task-execution-end` - 任务执行结束
- `workspace:result-aggregation-start` - 结果聚合开始
- `workspace:result-aggregation-end` - 结果聚合结束

## 权限事件

- `permission:request` - 权限请求
- `permission:response` - 权限响应

## Plan 事件

- `plan-review:request` - Plan 审查请求
- `plan-review:response` - Plan 审查响应
- `plan-mode:enter` - 进入 Plan 模式
- `plan-mode:exit` - 退出 Plan 模式

## Session 事件

- `session:messages-restored` - 消息恢复
- `session:resume-notification` - 恢复通知
- `session:archive-notification` - 归档通知
- `session:boot-thinking` - 启动思考
- `session:boot-guide` - 启动引导

## 其他事件

- `ask-user:request` - 询问用户请求
- `ask-user:response` - 询问用户响应
- `prompt:build-event` - Prompt 构建事件
- `project:info` - 项目信息
- `download:event` - 下载事件
- `child-ready` - 子进程就绪
- `config-result` - 配置结果
- `state-result` - 状态结果
- `update-config-result` - 更新配置结果

## 事件流向

```
agent-bridge.ts (子进程)
  ↓ safeSend / channel.send
agent/index.ts (主进程)
  ↓ forwardToRenderer (手动转发)
renderer (前端)
  ↓ window.electron.on
chatStore.ts / 其他 stores
```

## 需要迁移的监听器

### chatStore.ts
- agent:text
- agent:thinking
- agent:tool-start
- agent:tool-end
- agent:file-changes
- agent:usage
- agent:error
- agent:end
- agent:team-start
- agent:team-member-start
- agent:team-member-end
- agent:subagent-start
- agent:subagent-end
- permission:request
- plan-review:request
- plan-mode:enter
- plan-mode:exit
- ask-user:request
- session:messages-restored
- session:resume-notification
- session:archive-notification
- prompt:build-event
- project:info

### workspaceStore.ts
- workspace:intent-analysis-start
- workspace:intent-analysis-end
- workspace:model-classifier-start
- workspace:model-classifier-end
- workspace:task-planning-start
- workspace:task-planning-end
- workspace:task-execution-start
- workspace:task-execution-end
- workspace:result-aggregation-start
- workspace:result-aggregation-end

### DownloadQueue.tsx
- download:event
