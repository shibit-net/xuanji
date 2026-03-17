# GUI 无响应问题诊断

## 🔍 问题描述

用户发送消息"你好"后，GUI 一直没有回复内容。

## 📊 当前状态分析

### 会话状态
```json
{
  "usage": {
    "input": 0,
    "output": 0,
    "cost": 0
  },
  "historyMessages": [
    {
      "role": "user",
      "content": "你好",
      "timestamp": 1773680066464  // 00:54:26
    }
  ]
}
```

**发现**:
- ✅ 用户消息已保存到 state.json
- ❌ Token 使用为 0（说明 API 调用未执行）
- ❌ 没有 assistant 回复
- ❌ messages.jsonl 为空（消息未归档）

### 日志分析
- ✅ 没有找到 `max_tokens: 128000` 错误（配置问题已解决）
- ✅ ChatSession 初始化成功
- ✅ onResumeNotification 被调用
- ⚠️ GUI 启动 7 秒后就关闭了

## 🐛 可能的原因

### 1. 前端消息未发送到后端
**症状**: 用户点击发送，但后端没有收到消息

**诊断方法**:
- 打开浏览器开发者工具（GUI 窗口中按 Cmd+Option+I）
- 查看 Console 是否有错误
- 查看 Network 选项卡是否有 IPC 调用

### 2. 后端 AgentLoop 未启动
**症状**: 消息到达后端，但 AgentLoop.run() 未被调用

**诊断方法**:
检查日志中是否有 `agent:send-message` 相关的日志

### 3. API Key 未配置或无效
**症状**: AgentLoop 启动但 API 调用失败

**诊断方法**:
```bash
# 检查 API Key
grep -A 5 "apiKey" ~/.xuanji/config.json
```

### 4. 网络问题
**症状**: 无法连接到 API 服务器

**诊断方法**:
```bash
# 测试网络连接
curl -I https://shibit.net
```

## 🔧 诊断步骤

### 步骤 1: 检查开发者工具
1. 启动 GUI
2. 按 `Cmd+Option+I` 打开开发者工具
3. 切换到 Console 选项卡
4. 发送消息"你好"
5. 观察是否有错误信息

**预期**:
- 应该看到 `[Agent] Sending message...` 之类的日志
- 不应该有红色的错误信息

### 步骤 2: 检查后端日志
```bash
# 实时查看日志
tail -f /tmp/xuanji-debug-*.log | grep -E "send-message|agent:text|Error|error"
```

**预期**:
- 发送消息后应该看到 `send-message` 日志
- 应该看到 `agent:text` 流式输出

### 步骤 3: 检查 API Key
```bash
# 查看配置
cat ~/.xuanji/config.json | grep -A 2 "apiKey"
```

**预期**:
- 应该有有效的 API Key
- 格式: `"apiKey": "sk-..."`

### 步骤 4: 手动测试 API
```bash
# 测试 API 连接
curl -X POST https://shibit.net/v1/messages \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{
    "model": "claude-sonnet-4-5-20250929",
    "max_tokens": 64000,
    "messages": [{"role": "user", "content": "你好"}]
  }'
```

## 🎯 快速修复尝试

### 修复 1: 重置 ChatStore
可能前端状态出问题了，尝试硬刷新：

1. 在 GUI 中按 `Cmd+R` 刷新界面
2. 或者重启 GUI

### 修复 2: 检查 IPC 桥接
agent-bridge.ts 可能没有正确处理消息：

```bash
# 查看 agent-bridge 进程
ps aux | grep agent-bridge

# 检查是否有错误
grep "agent-bridge" /tmp/xuanji-debug-*.log
```

### 修复 3: 清除缓存重新初始化
```bash
# 停止 GUI
pkill -f "npm run dev:gui"

# 删除会话缓存
rm -rf ~/.xuanji/sessions/*

# 重新启动
npm run dev:gui
```

## 📝 详细日志收集

如果问题仍然存在，请收集以下信息：

1. **开发者工具 Console 日志**（截图）
2. **后端启动日志**:
   ```bash
   cat /tmp/xuanji-debug-*.log
   ```
3. **会话文件**:
   ```bash
   cat ~/.xuanji/sessions/*/state.json
   ```
4. **配置文件**（隐藏 API Key）:
   ```bash
   cat ~/.xuanji/config.json | sed 's/"sk-[^"]*"/"sk-***"/g'
   ```

## 🆘 紧急回退

如果问题无法解决，可以回退到旧的非连续会话模式：

```bash
# 1. 停止 GUI
pkill -f "npm run dev:gui"

# 2. 恢复旧会话
rm -rf ~/.xuanji/sessions
mv ~/.xuanji/sessions.backup_20260317_002057 ~/.xuanji/sessions

# 3. 禁用自动恢复
# 编辑 ~/.xuanji/config.json，添加：
{
  "session": {
    "autoResumeLastSession": false
  }
}

# 4. 重新启动
npm run dev:gui
```

---

**当前状态**: 🟡 **GUI 已重新启动，等待诊断**
**日志文件**: `/tmp/xuanji-debug-*.log`
**下一步**: 打开开发者工具，发送消息，观察 Console 输出
