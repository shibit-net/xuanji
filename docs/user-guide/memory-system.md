# 记忆系统

> 最后更新：2026-03-10

## 概述

Xuanji 的记忆系统让 Agent 能够：
- 记住用户偏好和习惯
- 回忆历史决策和解决方案
- 理解项目特定的知识和约定
- 跨会话保持连续性

---

## 记忆类型

### 1. 短期记忆（Short-Term Memory）

**作用域**：当前会话
**存储位置**：内存
**生命周期**：会话结束时丢弃

**内容**：
- 当前对话上下文
- 工具执行结果
- 临时决策

**示例**：

```
用户: 我喜欢用 TypeScript
Agent: 好的，我会用 TypeScript 编写代码（记录到短期记忆）

[10 分钟后]
用户: 帮我创建一个工具函数
Agent: 好的，我会用 TypeScript 编写（从短期记忆获取偏好）
```

---

### 2. 长期记忆（Long-Term Memory）

**作用域**：全局（跨会话）
**存储位置**：`~/.xuanji/memory/global.jsonl`
**生命周期**：永久（除非手动删除或压缩）

**内容**：
- 用户偏好
- 通用知识
- 重要决策

**示例**：

```
用户: 请记住，我总是用 2 空格缩进
Agent: 好的，已保存到长期记忆

[第二天新会话]
用户: 帮我写个函数
Agent: 好的，我会用 2 空格缩进（从长期记忆获取偏好）
```

---

### 3. 项目记忆（Project Memory）

**作用域**：当前项目
**存储位置**：`~/.xuanji/memory/projects/{project-hash}.jsonl`
**生命周期**：项目级永久

**内容**：
- 项目架构
- 编码规范
- 模块依赖
- 常见问题解决方案

**示例**：

```
用户: 这个项目用 Vite 构建
Agent: 已记录到项目记忆

[第二天在同一项目]
用户: 添加一个新依赖
Agent: 我会用 npm install 安装，然后更新 Vite 配置（从项目记忆获取构建工具）
```

---

## 记忆提取机制

### 自动提取（规则 + LLM）

**触发时机**：会话结束时自动提取

**提取规则**：
- 用户明确说"请记住"
- 决策性对话（选择技术栈、架构方案）
- 错误解决方案
- 工具使用模式
- 偏好声明（"我喜欢..."、"我习惯..."）

**LLM 增强**：
- 自动识别隐含的偏好（如多次使用相同工具）
- 提取关键决策（如"最终选择了 React"）
- 总结复杂对话（如长时间的调试过程）

---

### 手动保存

使用记忆工具（Agent 调用）：

```typescript
{
  "name": "memory_store",
  "input": {
    "content": "用户喜欢使用 TypeScript 和 2 空格缩进",
    "type": "user_preference",
    "scope": "global"
  }
}
```

---

## 记忆检索机制

### 混合检索（Vector + Keyword）

**向量检索**（主）：
- 使用 Embedding 计算语义相似度
- 模型：`Xenova/all-MiniLM-L6-v2`（384 维）
- 存储：SQLite + `sqlite-vec` 扩展

**关键词检索**（辅）：
- 基于 TF-IDF 匹配关键词
- 降级方案（向量系统不可用时）

**混合评分**：
- 向量相似度：50%
- 关键词匹配：20%
- 时效性：20%（越新越高分）
- 访问频次：10%（越常用越高分）

---

### 检索示例

```
用户: 帮我创建一个 React 组件

Agent 内部：
1. 向量检索："React 组件" →
   - "用户喜欢用函数式组件"（相似度 0.85）
   - "项目使用 TypeScript"（相似度 0.72）
2. 关键词检索："React" →
   - "项目依赖 React 18"
3. 混合排序 → 选取 Top 3
4. 注入到 system prompt
```

---

## 记忆管理

### 查看记忆

```bash
/memory
```

输出示例：

```
📝 记忆统计

全局记忆: 15 条
项目记忆: 8 条
总计: 23 条

最近记忆 (Top 5):
1. [偏好] 用户喜欢 TypeScript 和 2 空格缩进
2. [决策] 项目选择 Vite 作为构建工具
3. [事实] 项目使用 React 18
4. [模式] 常用 Git 提交格式: "feat: xxx"
5. [错误] 修复 CORS 问题需配置 proxy
```

---

### 压缩记忆

长期记忆会逐渐增长，定期压缩可节省存储和提升检索速度：

```bash
/memory compact
```

**压缩策略**：
- 合并相似记忆（如"用户喜欢 TS" + "用户偏好 TypeScript"）
- 删除过期记忆（访问频次 < 2 且超过 90 天）
- 删除矛盾记忆（如"用户喜欢 Tabs" vs "用户喜欢 2 空格"）

---

### 删除记忆

手动删除特定记忆：

```bash
# 编辑 JSONL 文件
vim ~/.xuanji/memory/global.jsonl

# 删除整个项目的记忆
rm ~/.xuanji/memory/projects/{project-hash}.jsonl
```

---

### 迁移记忆

记忆文件是纯文本 JSONL 格式，可以直接复制到其他机器：

```bash
# 备份全局记忆
cp ~/.xuanji/memory/global.jsonl ~/backup/

# 复制到另一台机器
scp ~/.xuanji/memory/global.jsonl user@remote:~/.xuanji/memory/
```

---

## 记忆配置

### 启用/禁用

```bash
/config set memory.enabled true
```

或编辑配置文件：

```json
{
  "memory": {
    "enabled": true
  }
}
```

---

### 调整参数

```json
{
  "memory": {
    "enabled": true,
    "retrieveMaxResults": 5,           // 每次检索最多返回 5 条
    "decayHalfLifeDays": 14,           // 14 天后时效性衰减 50%
    "compactionThreshold": 1000,       // 超过 1000 条自动触发压缩
    "longTermMaxEntries": 500          // 长期记忆最多保留 500 条（压缩后）
  }
}
```

---

## 向量系统

### 初始化

向量系统在首次启动时自动初始化（不阻塞启动）：

```
✨ 记忆系统初始化: 150 条记忆已加载
✨ 向量系统就绪 (使用 all-MiniLM-L6-v2 模型)
```

---

### 迁移

将已有的 JSONL 记忆迁移到向量数据库：

```bash
xuanji memory migrate
```

**增量迁移**：
- 只处理未向量化的记忆
- 自动跳过已处理的条目
- 支持断点续传

---

### 降级

如果向量系统不可用（如模型下载失败），自动降级到关键词检索：

```
⚠️  向量系统不可用，使用关键词降级方案
```

**影响**：
- 语义匹配能力下降
- 检索准确性降低（但仍可用）

---

## 数据格式

### JSONL 格式

每条记忆一行 JSON：

```jsonl
{"id":"mem_123","content":"用户喜欢 TypeScript","type":"user_preference","scope":"global","timestamp":"2026-03-10T14:00:00Z","accessCount":5,"lastAccessedAt":"2026-03-10T15:30:00Z"}
{"id":"mem_124","content":"项目使用 Vite 构建","type":"project_fact","scope":"project","projectPath":"/path/to/project","timestamp":"2026-03-10T14:05:00Z","accessCount":3,"lastAccessedAt":"2026-03-10T15:00:00Z"}
```

**字段说明**：
- `id`：唯一标识符
- `content`：记忆内容（纯文本）
- `type`：记忆类型（见下）
- `scope`：作用域（`global` / `project`）
- `projectPath`：项目路径（仅项目记忆）
- `timestamp`：创建时间
- `accessCount`：访问次数
- `lastAccessedAt`：最后访问时间

---

### 记忆类型

| 类型 | 说明 | 示例 |
|------|------|------|
| `user_preference` | 用户偏好 | "用户喜欢 2 空格缩进" |
| `decision` | 决策记录 | "选择 React 作为前端框架" |
| `tool_pattern` | 工具使用模式 | "常用 Git 提交格式: feat:" |
| `error_resolution` | 错误解决方案 | "修复 CORS 需配置 proxy" |
| `project_fact` | 项目事实 | "项目使用 Vite 构建" |
| `session_summary` | 会话摘要 | "实现了用户认证功能" |

---

## 最佳实践

1. **明确声明偏好**：直接告诉 Agent "请记住..."
2. **定期压缩**：每月执行一次 `/memory compact`
3. **项目分离**：不同项目的记忆自动隔离，无需手动管理
4. **备份重要记忆**：定期备份 `~/.xuanji/memory/` 目录
5. **隐私保护**：避免在记忆中存储敏感信息（API Key、密码等）

---

## 相关文档

- [配置参考](./configuration.md#记忆配置)
- [常见问题](./faq.md#记忆问题)
- [故障排查](./troubleshooting.md#记忆系统问题)
