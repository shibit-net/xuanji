# 会话管理

> 最后更新：2026-03-10

## 概述

Xuanji 支持保存和恢复对话会话，允许你：
- 跨会话保留上下文
- 回溯到历史检查点
- 多个项目并行工作

## 会话保存

### 自动保存

Xuanji 会自动保存当前会话到临时文件：

```bash
~/.xuanji/sessions/temp-{timestamp}.jsonl
```

### 手动保存

使用 `/save` 命令：

```bash
/save                    # 保存到默认名称（自动生成）
/save my-project-work    # 保存到指定名称
```

保存的会话文件：

```bash
~/.xuanji/sessions/my-project-work-{timestamp}.jsonl
```

## 会话恢复

### 查看会话列表

```bash
/sessions
```

输出示例：

```
📋 已保存的会话 (3 个)

1. my-project-work (2026-03-10 14:30)
   - 12 条消息
   - 模型: claude-opus-4
   - 项目: /Users/kevin/xuanji

2. debug-session (2026-03-09 10:15)
   - 8 条消息
   - 模型: claude-sonnet-4
   - 项目: /Users/kevin/my-app

3. temp-session (2026-03-08 16:45)
   - 5 条消息
   - 模型: gpt-4o
   - 项目: 无
```

### 恢复会话

```bash
/resume <session-id>
```

示例：

```bash
/resume my-project-work-20260310-143000
```

恢复后，所有历史消息和上下文会重新加载。

## 检查点管理

### 创建检查点

在对话过程中，创建检查点以便回溯：

```bash
/checkpoint                  # 创建检查点（自动命名）
/checkpoint before-refactor  # 创建检查点（指定名称）
```

### 查看检查点

```bash
/checkpoints
```

输出示例：

```
🔖 当前会话的检查点 (2 个)

1. checkpoint-0 (2026-03-10 14:35)
   - 位置: 消息 #5
   - 自动创建

2. before-refactor (2026-03-10 14:40)
   - 位置: 消息 #8
   - 手动创建
```

### 回溯到检查点

```bash
/rewind <checkpoint-id>
```

示例：

```bash
/rewind before-refactor
```

回溯后，检查点之后的所有消息会被丢弃（但会备份到 `.backup` 文件）。

## 会话文件格式

会话文件使用 JSONL (JSON Lines) 格式：

```jsonl
{"type":"message","role":"user","content":"你好"}
{"type":"message","role":"assistant","content":"你好！有什么可以帮助你的？"}
{"type":"tool_use","name":"read","input":{"path":"README.md"}}
{"type":"tool_result","tool_use_id":"toolu_123","content":"# Project..."}
{"type":"checkpoint","name":"checkpoint-0","index":2}
```

你可以直接编辑 JSONL 文件来修改会话内容。

## 会话存储位置

| 类型 | 路径 |
|------|------|
| 临时会话 | `~/.xuanji/sessions/temp-*.jsonl` |
| 保存会话 | `~/.xuanji/sessions/{name}-{timestamp}.jsonl` |
| 备份会话 | `~/.xuanji/sessions/{name}-{timestamp}.backup.jsonl` |

## 会话清理

### 清空当前会话

```bash
/clear
```

这会清空内存中的消息历史，但不会删除已保存的会话文件。

### 删除会话文件

手动删除不需要的会话：

```bash
rm ~/.xuanji/sessions/old-session-*.jsonl
```

或使用清理脚本（计划中）：

```bash
xuanji cleanup --sessions --older-than 30d
```

## 最佳实践

1. **及时保存**：完成一个阶段性工作后，使用 `/save` 保存会话
2. **检查点策略**：在执行危险操作前（如大规模重构），创建检查点
3. **命名规范**：使用有意义的会话名称，如 `fix-auth-bug`、`add-user-feature`
4. **定期清理**：删除不再需要的旧会话文件，节省磁盘空间
5. **备份重要会话**：将关键会话文件备份到版本控制或云存储

## 会话迁移

### 导出会话

会话文件是纯文本 JSONL 格式，可以直接复制到其他机器：

```bash
# 复制到远程机器
scp ~/.xuanji/sessions/my-work-*.jsonl user@remote:~/.xuanji/sessions/
```

### 导入会话

将 JSONL 文件放到 `~/.xuanji/sessions/` 目录，然后使用 `/resume` 恢复。

## 相关文档

- [配置参考](./configuration.md#会话配置)
- [常见问题](./faq.md#会话问题)
