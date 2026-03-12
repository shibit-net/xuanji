# 常见问题（FAQ）

> 最后更新：2026-03-10

## 一般问题

### Q: Xuanji（璇玑）是什么？

Xuanji 是一个开源的 AI 编程助手，类似 Claude Code，基于 Anthropic Claude 和 OpenAI 模型构建。主要特性包括：
- 终端 UI 交互
- 完整的工具系统（文件读写、命令执行、代码搜索）
- 权限控制和安全防护
- 记忆系统和会话管理
- MCP 协议支持
- Web 搜索和内容抓取

### Q: Xuanji 和 Claude Code 有什么区别？

**相同点**：
- 都基于 Claude API
- 都提供终端 UI
- 都支持文件操作和命令执行

**不同点**：
- Xuanji 是开源项目（Claude Code 闭源）
- 支持多种 LLM（Claude + OpenAI + Ollama）
- 完整的中文支持
- 更灵活的权限控制
- MCP 协议集成
- Web 能力（搜索、抓取）

### Q: 支持哪些 LLM 模型？

**Anthropic Claude**（推荐）：
- claude-opus-4
- claude-sonnet-4
- claude-haiku-4

**OpenAI**：
- gpt-4o
- gpt-4-turbo
- gpt-3.5-turbo

**本地模型**（通过 Ollama）：
- qwen2.5
- deepseek
- 其他兼容模型

### Q: 如何切换模型？

**临时切换**（当前会话）：
```bash
/model claude-opus-4
```

**永久切换**（修改配置）：
```bash
/config set provider.model claude-opus-4
```

或编辑 `~/.xuanji/config.json`：
```json
{
  "config": {
    "provider": {
      "model": "claude-opus-4"
    }
  }
}
```

### Q: 费用如何计算？

费用基于 token 使用量和模型定价：

**Claude Sonnet 4**（推荐）：
- 输入：$3.00 / 1M tokens
- 输出：$15.00 / 1M tokens
- 缓存读：$0.30 / 1M tokens
- 缓存写：$3.75 / 1M tokens

查看使用统计：
```bash
/stats          # 今日统计
/stats week     # 本周趋势
/stats month    # 本月趋势
```

---

## 配置问题

### Q: 如何设置代理？

**方法 1：环境变量**
```bash
export HTTP_PROXY=http://proxy.example.com:8080
export HTTPS_PROXY=http://proxy.example.com:8080
export NO_PROXY=localhost,127.0.0.1
```

**方法 2：配置文件**
```json
{
  "config": {
    "provider": {
      "proxy": "http://proxy.example.com:8080"
    }
  }
}
```

### Q: 如何禁用某个工具？

编辑 `~/.xuanji/config.json`：
```json
{
  "config": {
    "tools": {
      "disabled": ["bash", "web_search"]
    }
  }
}
```

或使用权限配置阻止特定工具：
```json
{
  "config": {
    "permission": {
      "bashExec": []  // 空数组 = 拒绝所有 bash 命令
    }
  }
}
```

### Q: 如何自定义 Skill？

参见 [Skills 使用指南](./skills-guide.md#自定义-skill)。

### Q: 如何修改 UI 主题和语言？

```bash
# 修改主题
/config set ui.theme dark    # 或 light、auto

# 修改语言
/config set ui.locale zh     # 或 en
```

---

## 功能问题

### Q: 如何让 Agent 记住我的偏好？

Xuanji 会自动记忆对话中的关键信息。你也可以明确告诉它：

```
请记住：我喜欢使用 TypeScript 和 2 空格缩进
```

查看记忆：
```bash
/memory
```

### Q: 如何使用 SubAgent？

SubAgent 用于处理子任务：

```
请创建一个 SubAgent 来分析 src/core/ 目录的架构
```

或使用 `task` 工具（Xuanji 会自动调用）：
```typescript
{
  "description": "分析 src/core/ 架构",
  "prompt": "分析这个目录的模块结构和依赖关系"
}
```

### Q: 如何集成 MCP Server？

1. 编辑 `~/.xuanji/mcp.json`：
```json
{
  "servers": [
    {
      "name": "filesystem",
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed"]
    }
  ]
}
```

2. 重启 Xuanji，MCP 工具会自动加载

详见 [MCP 集成指南](./mcp-integration.md)。

### Q: 如何保存和恢复会话？

**保存会话**：
```bash
/save my-project-work
```

**查看会话列表**：
```bash
/sessions
```

**恢复会话**：
```bash
/resume <session-id>
```

详见 [会话管理](./session-management.md)。

---

## 错误处理

### Q: 报错"API Key 无效"怎么办？

1. 检查环境变量是否设置：
```bash
echo $ANTHROPIC_API_KEY
```

2. 检查 API Key 格式（应以 `sk-ant-` 开头）

3. 重新设置：
```bash
export ANTHROPIC_API_KEY="sk-ant-your-key"
```

4. 或写入配置文件：
```bash
/config set provider.apiKey sk-ant-your-key
```

### Q: 报错"Rate limit exceeded (429)"怎么办？

这是 API 速率限制错误：

1. 等待几分钟后重试
2. 检查是否短时间内发送了大量请求
3. 升级 API 套餐（如果需要更高速率）
4. 使用轻量模型（Haiku）降低 token 消耗

### Q: 权限被拒绝怎么办？

Xuanji 默认会拦截危险操作。如果确认安全，可以：

1. **临时允许**：在确认对话框中选择 `Y` 或 `A`（Always）

2. **修改权限配置**：
```bash
/config set permission.confirmWrite auto  # 自动允许项目内写入
```

3. **查看审计日志**：
```bash
cat ~/.xuanji/logs/audit.log
```

### Q: 如何查看日志？

**应用日志**：
```bash
tail -f ~/.xuanji/logs/info.log      # 普通日志
tail -f ~/.xuanji/logs/error.log     # 错误日志
```

**会话日志**：
```bash
tail -f ~/.xuanji/logs/sessions.jsonl
```

**审计日志**：
```bash
tail -f ~/.xuanji/logs/audit.log
```

---

## 性能问题

### Q: 响应很慢怎么办？

可能原因和解决方案：

1. **网络问题**：
   - 检查网络连接
   - 设置代理（如在国内）

2. **Token 过多**：
   - 使用 `/compact` 压缩上下文
   - 使用 `/clear` 清空会话
   - 减少一次性传入的代码量

3. **模型选择**：
   - 切换到 Haiku（更快但能力较弱）
   ```bash
   /model claude-haiku-4
   ```

### Q: 内存占用高怎么办？

1. **清理会话**：
```bash
/clear
```

2. **禁用记忆系统**（如果不需要）：
```bash
/config set memory.enabled false
```

3. **重启 Xuanji**

---

## 其他问题

### Q: 如何更新 Xuanji？

```bash
npm update -g xuanji
```

或从源码更新：
```bash
cd xuanji
git pull
npm install
npm run build
```

### Q: 如何贡献代码？

1. Fork 项目：https://github.com/your-org/xuanji
2. 创建分支：`git checkout -b feature/my-feature`
3. 提交代码：遵循项目编码规范
4. 创建 Pull Request

### Q: 如何报告 Bug？

在 GitHub 创建 Issue：https://github.com/your-org/xuanji/issues

包含以下信息：
- Xuanji 版本（`xuanji --version`）
- Node.js 版本（`node --version`）
- 操作系统
- 复现步骤
- 错误日志

### Q: 哪里可以获得帮助？

- 文档：[docs/user-guide/](./README.md)
- GitHub Issues：https://github.com/your-org/xuanji/issues
- 讨论区：https://github.com/your-org/xuanji/discussions

---

## 相关文档

- [快速开始](./getting-started.md)
- [配置参考](./configuration.md)
- [故障排查](./troubleshooting.md)
