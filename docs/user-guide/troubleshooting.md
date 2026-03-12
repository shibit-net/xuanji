# 故障排查

> 最后更新：2026-03-10

本文档提供常见问题的诊断和解决方案。

---

## 启动问题

### 报错：API Key 未设置

**错误信息**：
```
Error: 未找到 API Key，请设置环境变量 XUANJI_API_KEY
```

**解决方案**：

1. 设置环境变量：
```bash
export XUANJI_API_KEY="sk-ant-your-key-here"
```

2. 或写入配置文件：
```bash
xuanji config set provider.apiKey "sk-ant-your-key-here"
```

3. 检查是否生效：
```bash
echo $XUANJI_API_KEY
```

---

### 报错：模型不支持

**错误信息**：
```
Error: 不支持的模型: claude-opus-5
```

**解决方案**：

查看支持的模型列表：
```bash
xuanji models
```

切换到支持的模型：
```bash
/model claude-opus-4
```

---

### 启动后无响应

**现象**：运行 `xuanji` 后光标闪烁，但没有 UI 显示。

**可能原因**：
1. 终端不兼容
2. Node.js 版本过低
3. 依赖包未安装完整

**解决方案**：

1. 检查 Node.js 版本（需 >= 20）：
```bash
node --version
```

2. 重新安装依赖：
```bash
npm install
```

3. 尝试其他终端（推荐 iTerm2、Windows Terminal）

4. 查看日志：
```bash
tail -f ~/.xuanji/logs/error.log
```

---

## 网络问题

### 连接超时

**错误信息**：
```
Error: Request timed out after 120000ms
```

**解决方案**：

1. 检查网络连接：
```bash
ping anthropic.com
```

2. 设置代理（如在国内）：
```bash
export HTTP_PROXY=http://proxy.example.com:8080
export HTTPS_PROXY=http://proxy.example.com:8080
```

3. 调整超时时间（配置文件）：
```json
{
  "provider": {
    "timeout": 180000
  }
}
```

---

### 速率限制（429 错误）

**错误信息**：
```
Error: Rate limit exceeded (429)
```

**解决方案**：

1. 等待几分钟后重试

2. 检查是否短时间发送大量请求

3. 升级 API 套餐（如需要更高速率）

4. 切换到轻量模型降低请求频率：
```bash
/model claude-haiku-4
```

---

## 权限问题

### 文件操作被拒绝

**现象**：Agent 尝试读写文件时被阻止。

**解决方案**：

1. 临时允许：在确认对话框选择 `Y` 或 `A`（Always）

2. 修改权限配置（自动允许项目内写入）：
```bash
/config set permission.confirmWrite auto
```

3. 查看权限策略：
```bash
cat ~/.xuanji/config.json | jq .tools.permissions
```

4. 检查审计日志：
```bash
cat ~/.xuanji/logs/audit.log
```

---

### Bash 命令被阻止

**现象**：Agent 执行命令时显示"权限被拒绝"。

**解决方案**：

1. 检查是否在黑名单中：
```json
{
  "tools": {
    "permissions": {
      "bashExec": ["rm -rf", "sudo", "curl | bash"]
    }
  }
}
```

2. 修改黑名单（谨慎操作）：
```bash
/config set tools.permissions.bashExec '[]'
```

3. 使用白名单模式（更安全）：
```json
{
  "tools": {
    "permissions": {
      "bashExecWhitelist": ["npm", "git", "ls", "cat"]
    }
  }
}
```

---

## 性能问题

### 响应速度慢

**可能原因**：
1. 网络延迟
2. 上下文过长
3. 使用了较慢的模型

**解决方案**：

1. 检查网络延迟：
```bash
curl -o /dev/null -s -w "Time: %{time_total}s\n" https://api.anthropic.com
```

2. 压缩上下文：
```bash
/compact
```

3. 清空会话（重新开始）：
```bash
/clear
```

4. 切换到更快的模型：
```bash
/model claude-haiku-4
```

---

### 内存占用高

**现象**：Xuanji 进程占用大量内存。

**解决方案**：

1. 清空会话：
```bash
/clear
```

2. 禁用记忆系统（如不需要）：
```bash
/config set memory.enabled false
```

3. 减少缓存大小：
```json
{
  "memory": {
    "longTermMaxEntries": 500
  }
}
```

4. 重启 Xuanji

---

## 工具执行问题

### 工具调用失败

**错误信息**：
```
Tool execution failed: read
Error: ENOENT: no such file or directory
```

**解决方案**：

1. 检查文件路径是否正确（使用绝对路径）

2. 检查文件权限：
```bash
ls -la /path/to/file
```

3. 查看工具执行日志：
```bash
tail -f ~/.xuanji/logs/info.log | grep "Tool:"
```

---

### MCP Server 无法启动

**错误信息**：
```
Failed to initialize MCP server: filesystem
```

**解决方案**：

1. 检查 MCP 配置：
```bash
cat ~/.xuanji/mcp.json
```

2. 测试 Server 命令是否有效：
```bash
npx -y @modelcontextprotocol/server-filesystem /path/to/allowed
```

3. 查看 MCP 日志：
```bash
tail -f ~/.xuanji/logs/mcp.log
```

4. 禁用有问题的 Server：
```json
{
  "mcp": {
    "servers": [
      {
        "name": "filesystem",
        "enabled": false
      }
    ]
  }
}
```

---

## 记忆系统问题

### 记忆未保存

**现象**：对话结束后，Agent 无法记住之前的偏好。

**解决方案**：

1. 检查记忆系统是否启用：
```bash
/config get memory.enabled
```

2. 手动触发记忆保存（测试）：
```bash
/memory save
```

3. 查看记忆文件：
```bash
ls -la ~/.xuanji/memory/
```

4. 检查记忆日志：
```bash
tail -f ~/.xuanji/logs/memory.log
```

---

### 记忆检索不准确

**现象**：Agent 检索到不相关的记忆。

**解决方案**：

1. 调整检索参数：
```json
{
  "memory": {
    "retrieveMaxResults": 5,
    "decayHalfLifeDays": 14
  }
}
```

2. 查看当前记忆：
```bash
/memory
```

3. 清理过期记忆：
```bash
/memory compact
```

---

## 日志分析

### 日志文件位置

| 日志类型 | 路径 |
|---------|------|
| 普通日志 | `~/.xuanji/logs/info.log` |
| 错误日志 | `~/.xuanji/logs/error.log` |
| 审计日志 | `~/.xuanji/logs/audit.log` |
| 会话日志 | `~/.xuanji/logs/sessions.jsonl` |
| MCP 日志 | `~/.xuanji/logs/mcp.log` |

### 查看实时日志

```bash
# 所有日志
tail -f ~/.xuanji/logs/info.log

# 仅错误
tail -f ~/.xuanji/logs/error.log

# 搜索关键词
grep "Tool execution" ~/.xuanji/logs/info.log
```

### 日志清理

日志会自动轮转（每天 / 10MB），保留 14 天。

手动清理旧日志：

```bash
rm ~/.xuanji/logs/*.log.*.gz
```

---

## 数据恢复

### 恢复已删除的会话

会话文件在 `/rewind` 时会自动备份到 `.backup` 文件：

```bash
ls ~/.xuanji/sessions/*.backup.jsonl
```

恢复备份：

```bash
cp ~/.xuanji/sessions/my-session.backup.jsonl ~/.xuanji/sessions/recovered-session.jsonl
/resume recovered-session
```

---

### 恢复损坏的配置

配置文件损坏时，Xuanji 会使用默认配置。

手动恢复：

```bash
# 备份当前配置
mv ~/.xuanji/config.json ~/.xuanji/config.json.backup

# 重新生成默认配置
xuanji config reset
```

---

## 获取帮助

如果以上方案无法解决问题：

1. 查看完整文档：`docs/user-guide/`
2. 搜索已知问题：https://github.com/your-org/xuanji/issues
3. 提交 Bug 报告：https://github.com/your-org/xuanji/issues/new
4. 加入讨论区：https://github.com/your-org/xuanji/discussions

**提交 Bug 时请包含**：
- Xuanji 版本（`xuanji --version`）
- Node.js 版本（`node --version`）
- 操作系统
- 复现步骤
- 错误日志（`~/.xuanji/logs/error.log`）
