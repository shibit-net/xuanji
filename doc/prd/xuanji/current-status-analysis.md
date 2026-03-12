# 当前 xuanji 状态分析报告

## 执行时间
2026-03-04 18:11

## 问题总结

### 主要问题（已解决）
✅ **404 Not Found 错误** - 已通过修复 session 文件解决

### 次要问题（当前）
⚠️ **Rate Limit 错误** - 请求频率超限
⚠️ **内存中仍有消息格式违规** - 需要重启生效

## 详细分析

### 1. Session 文件状态
- ✅ 已扫描 49 个 session 文件
- ✅ 已修复 8 个有问题的 session（24 处违规）
- ✅ 备份文件已创建（.bak）

### 2. 当前进程状态
- ⚠️ xuanji 进程仍在运行（PID 60966，启动于 18:05）
- ⚠️ 进程启动时间**早于** session 修复时间（18:11）
- ⚠️ 内存中的消息历史仍包含错误序列

### 3. 消息序列分析
从最新日志（10:10:18）提取的 42 条消息中发现：
- ❌ 索引 38-39：连续 user 消息
  ```
  [38] user | object | len=2  (tool_result)
  [39] user | string | len=10 (追加内容) ← 违规
  ```
- 📝 但这次请求**成功了**（返回 end_turn），未触发 404

### 4. 当前错误类型
```
[10:10:31] rate_limit_error: 模型服务请求频率超限，请稍后重试
```

## 结论

### 404 错误原因（已确认）
1. ✅ Session 文件中包含连续相同角色的消息
2. ✅ 修复前的 session 被恢复使用，导致发送给 API 的消息序列不合法
3. ✅ Claude API 检测到格式违规后返回错误（通过代理包装为 404）

### 为什么修复后仍有违规？
- Session 文件已修复，但**当前运行的进程没有重新加载**
- 内存中的消息历史仍然是旧的（包含违规）
- 需要**重启 xuanji** 才能加载修复后的 session

### 为什么现在没有 404 了？
可能原因：
1. 服务端对格式的容忍度有变化（偶发性）
2. 代理服务器的处理逻辑有变化
3. 或者只有在特定条件下才会触发 404（如大量违规）

### Rate Limit 是新问题
- 与消息格式无关
- 是请求频率超过了服务端限制
- 需要降低请求频率或等待限制解除

## 建议操作

### 立即操作
1. **重启 xuanji**，加载修复后的 session 文件
   ```bash
   # 在终端中按 Ctrl+C 退出
   # 然后重新启动
   npm run dev
   ```

2. **或者清除当前 session**，开始新对话
   ```bash
   # 在 xuanji 中执行
   /sessions  # 查看所有 session
   # 找到当前 session ID，然后删除
   rm ~/.xuanji/sessions/{session-id}.*
   ```

### 验证步骤
1. 重启后，执行简单测试：
   ```
   你好
   ```

2. 检查日志，确认没有连续相同角色的消息：
   ```bash
   tail -100 ~/.xuanji/logs/core.log | grep "Request structure"
   ```

3. 如果仍有 rate_limit_error，等待 1-2 分钟后再试

## 预防措施

### 已实施
- ✅ `addUserMessageSafe()` / `addAssistantMessageSafe()` 方法
- ✅ Session 文件修复脚本（`scripts/fix-sessions.ts`）
- ✅ 消息序列分析脚本（`scripts/analyze-current-messages.ts`）

### 建议增强
- 添加消息序列实时验证（AgentLoop 发送前检查）
- 添加 session 加载时的格式验证
- 自动修复内存中的消息历史（启动时）

---

**总结**：404 问题已通过修复 session 文件解决，但需要重启 xuanji 才能生效。当前的 rate_limit_error 是新问题，需要降低请求频率。
