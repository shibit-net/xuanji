# 配置参考

> 最后更新：2026-03-10

本文档详细介绍 Xuanji 的所有配置项、配置文件位置、优先级规则和示例。

---

## 目录

- [配置文件位置](#配置文件位置)
- [配置优先级](#配置优先级)
- [完整配置示例](#完整配置示例)
- [配置项详解](#配置项详解)
  - [Provider 配置](#provider-配置)
  - [UI 配置](#ui-配置)
  - [工具配置](#工具配置)
  - [权限配置](#权限配置)
  - [Skill 配置](#skill-配置)
  - [记忆配置](#记忆配置)
  - [会话配置](#会话配置)
  - [Web 搜索配置](#web-搜索配置)
  - [MCP 配置](#mcp-配置)
  - [功能特性配置](#功能特性配置)
- [环境变量列表](#环境变量列表)
- [CLI 配置命令](#cli-配置命令)

---

## 配置文件位置

Xuanji 支持两级配置：

### 1. 全局配置

- **路径**：`~/.xuanji/config.json`
- **作用范围**：影响所有项目
- **适用场景**：API Key、默认模型、UI 偏好等

### 2. 项目配置

- **路径**：`.xuanji/config.json`（项目根目录）
- **作用范围**：仅影响当前项目
- **适用场景**：项目特定的权限规则、自定义 Skill 等

---

## 配置优先级

配置来源按以下优先级合并（高优先级覆盖低优先级）：

```
环境变量 > 项目配置 > 全局配置 > 默认值
```

**示例**：

- 环境变量 `ANTHROPIC_API_KEY` 优先于配置文件中的 `provider.apiKey`
- 项目配置 `.xuanji/config.json` 优先于全局配置 `~/.xuanji/config.json`

---

## 完整配置示例

以下是一个完整的配置文件示例（`~/.xuanji/config.json`）：

```json
{
  "version": "1.0",
  "config": {
    "provider": {
      "adapter": "anthropic",
      "apiKey": "sk-ant-api03-xxxxx",
      "model": "[CC]claude-sonnet-4-5-20250929",
      "lightModel": "[CC]claude-haiku-4-5-20251001",
      "maxTokens": 64000,
      "temperature": 0.7,
      "baseURL": "https://shibit.net",
      "thinking": {
        "type": "adaptive",
        "effort": "medium"
      }
    },
    "ui": {
      "theme": "auto",
      "language": "zh",
      "showTokenUsage": true,
      "showCost": true,
      "showThinking": false
    },
    "tools": {
      "enabled": [],
      "schemaMode": "compact",
      "permissions": {
        "fileRead": "always",
        "fileWrite": "ask",
        "bashExec": "ask",
        "warnLevel": "ask",
        "confirmWrite": "plan-only",
        "allowedPaths": ["src/**", "docs/**"],
        "deniedPaths": ["/etc/**", "~/.ssh/**"],
        "deniedCommands": ["rm -rf /", "sudo *"]
      }
    },
    "skills": {
      "enabled": [
        "xuanji-assistant",
        "code-assistant",
        "life-secretary",
        "memory-context",
        "security-rules",
        "agent-rules"
      ],
      "loadCustom": true,
      "customPath": ".xuanji/skills"
    },
    "memory": {
      "enabled": true,
      "shortTermMaxEntries": 100,
      "longTermMaxEntries": 1000,
      "retrieveMaxResults": 10
    },
    "session": {
      "autoSave": true,
      "autoSaveInterval": 1,
      "maxSessions": 50,
      "maxMessages": 100
    },
    "webSearch": {
      "defaultProvider": "tavily",
      "fallbackProviders": ["serper", "brave", "duckduckgo"],
      "apiKeys": {
        "tavily": "tvly-xxxxx"
      },
      "maxResults": 5
    },
    "features": {
      "dynamicToolLoading": true,
      "proactiveButler": false,
      "smartMemoryV2": false
    }
  }
}
```

---

## 配置项详解

### Provider 配置

LLM Provider 相关配置。

```typescript
{
  "provider": {
    "adapter": "anthropic" | "openai" | "ollama",
    "apiKey": "string",
    "model": "string",
    "lightModel": "string",
    "maxTokens": number,
    "temperature": number,
    "baseURL": "string",
    "thinking": {
      "type": "adaptive" | "enabled" | "disabled",
      "effort": "low" | "medium" | "high"
    }
  }
}
```

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `adapter` | string | `"anthropic"` | Provider 类型：anthropic/openai/ollama |
| `apiKey` | string | - | API Key（推荐使用环境变量） |
| `model` | string | `"[CC]claude-sonnet-4-5-20250929"` | 主模型名称 |
| `lightModel` | string | `"[CC]claude-haiku-4-5-20251001"` | 轻量模型（用于上下文压缩、摘要等） |
| `maxTokens` | number | `64000` | 最大输出 token 数 |
| `temperature` | number | `undefined` | 生成温度（0-1，undefined = 使用模型默认值） |
| `baseURL` | string | `"https://shibit.net"` | API 基础 URL |
| `thinking.type` | string | `"adaptive"` | Extended Thinking 模式 |
| `thinking.effort` | string | `"medium"` | 思考深度 |

**常用模型名称**：

- **Anthropic**：
  - `[CC]claude-sonnet-4-5-20250929` — Claude Sonnet 4.5（主模型）
  - `[CC]claude-haiku-4-5-20251001` — Claude Haiku 4.5（轻量模型）
  - `claude-opus-4-20250514` — Claude Opus 4（最强模型）
- **OpenAI**：
  - `gpt-4o` — GPT-4 Omni（主模型）
  - `gpt-4o-mini` — GPT-4 Omni Mini（轻量模型）
  - `o1` — O1（推理模型）

**环境变量**：

- `ANTHROPIC_API_KEY` — Anthropic API Key
- `OPENAI_API_KEY` — OpenAI API Key
- `XUANJI_PROVIDER_ADAPTER` — Provider 类型
- `XUANJI_PROVIDER_MODEL` — 主模型名称
- `XUANJI_PROVIDER_BASE_URL` — API 基础 URL

---

### UI 配置

终端 UI 相关配置。

```typescript
{
  "ui": {
    "theme": "light" | "dark" | "auto",
    "language": "zh" | "en",
    "showTokenUsage": boolean,
    "showCost": boolean,
    "showThinking": boolean
  }
}
```

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `theme` | string | `"auto"` | 主题（light/dark/auto 跟随系统） |
| `language` | string | `"en"` | 界面语言（zh/en） |
| `showTokenUsage` | boolean | `true` | 是否显示 Token 用量 |
| `showCost` | boolean | `true` | 是否显示费用统计 |
| `showThinking` | boolean | `false` | 是否显示 Extended Thinking 内容 |

---

### 工具配置

工具执行相关配置。

```typescript
{
  "tools": {
    "enabled": string[],
    "schemaMode": "compact" | "detailed" | "auto",
    "permissions": { /* 见权限配置 */ },
    "timeouts": {
      "bash": number,
      "webFetch": number,
      "default": number,
      "backgroundTask": number
    },
    "concurrency": {
      "maxParallel": number,
      "maxBackgroundTasks": number
    },
    "outputLimits": {
      "toolOutput": number,
      "toolResult": number
    }
  }
}
```

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enabled` | string[] | `[]` | 启用的工具列表（空 = 全部启用） |
| `schemaMode` | string | `"compact"` | Schema 模式（compact/detailed/auto） |
| `timeouts.bash` | number | `120000` | Bash 命令超时（ms） |
| `timeouts.webFetch` | number | `30000` | WebFetch 超时（ms） |
| `timeouts.default` | number | `300000` | 工具默认超时（ms） |
| `concurrency.maxParallel` | number | `5` | 最大并行工具数 |
| `outputLimits.toolOutput` | number | `30000` | 单个工具输出最大长度（字符） |

---

### 权限配置

文件操作和命令执行权限控制。

```typescript
{
  "tools": {
    "permissions": {
      "fileRead": "always" | "ask" | "never",
      "fileWrite": "always" | "ask" | "never",
      "bashExec": "always" | "ask" | "never",
      "warnLevel": "ask" | "auto-allow",
      "confirmWrite": "ask" | "auto" | "plan-only",
      "allowedPaths": string[],
      "deniedPaths": string[],
      "allowedCommands": string[],
      "deniedCommands": string[],
      "persistDecisions": boolean,
      "decisionsFile": string
    }
  }
}
```

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `fileRead` | string | `"always"` | 文件读取权限 |
| `fileWrite` | string | `"ask"` | 文件写入权限 |
| `bashExec` | string | `"ask"` | 命令执行权限 |
| `warnLevel` | string | `"ask"` | Warn 级别操作策略 |
| `confirmWrite` | string | `"plan-only"` | 写入确认策略 |
| `allowedPaths` | string[] | `[]` | 允许操作的路径（glob 模式） |
| `deniedPaths` | string[] | `[]` | 禁止操作的路径（glob 模式） |
| `allowedCommands` | string[] | `[]` | 允许的命令白名单 |
| `deniedCommands` | string[] | `[]` | 禁止的命令黑名单 |
| `persistDecisions` | boolean | `true` | 是否持久化决策 |
| `decisionsFile` | string | `".xuanji/permission-decisions.json"` | 决策存储文件 |

**确认策略说明**：

- `ask` — 每次写入都需要确认（保守）
- `auto` — 项目内写入自动放行（激进）
- `plan-only` — 依赖 LLM 通过 `plan_review` 主动确认（平衡，推荐）

详见 [权限系统](./permission-system.md)。

---

### Skill 配置

Skill 系统配置。

```typescript
{
  "skills": {
    "enabled": string[],
    "disabled": string[],
    "loadCustom": boolean,
    "customPath": string,
    "agent": {
      "skillId": string
    }
  }
}
```

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enabled` | string[] | `[...]` | 启用的 Skill ID 列表 |
| `disabled` | string[] | `[]` | 禁用的 Skill ID 列表 |
| `loadCustom` | boolean | `true` | 是否加载自定义 Skill |
| `customPath` | string | `".xuanji/skills"` | 自定义 Skill 路径 |
| `agent.skillId` | string | `"react-loop-default"` | Agent Skill ID |

**内置 Skill**：

- `xuanji-assistant` — 核心助手规则
- `code-assistant` — 编程助手
- `life-secretary` — 生活秘书
- `memory-context` — 记忆上下文
- `security-rules` — 安全规则
- `agent-rules` — Agent 行为规则
- `tool-guidance` — 工具使用指南

详见 [Skills 使用指南](./skills-guide.md)。

---

### 记忆配置

记忆系统配置。

```typescript
{
  "memory": {
    "enabled": boolean,
    "shortTermMaxEntries": number,
    "longTermMaxEntries": number,
    "retrieveMaxResults": number,
    "maxEntryLength": number,
    "compactionThreshold": number,
    "decayHalfLifeDays": number
  }
}
```

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enabled` | boolean | `true` | 是否启用记忆系统 |
| `shortTermMaxEntries` | number | `100` | 短期记忆最大条目数 |
| `longTermMaxEntries` | number | `1000` | 长期记忆最大条目数 |
| `retrieveMaxResults` | number | `10` | 检索最大结果数 |
| `maxEntryLength` | number | `500` | 单条记忆最大长度 |
| `compactionThreshold` | number | `500` | 压缩阈值 |
| `decayHalfLifeDays` | number | `30` | 衰减半衰期（天） |

详见 [记忆系统](./memory-system.md)。

---

### 会话配置

会话管理配置。

```typescript
{
  "session": {
    "autoSave": boolean,
    "autoSaveInterval": number,
    "maxSessions": number,
    "maxMessages": number
  }
}
```

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `autoSave` | boolean | `true` | 是否启用自动保存 |
| `autoSaveInterval` | number | `1` | 保存间隔（轮数，0 = 仅退出时保存） |
| `maxSessions` | number | `50` | 最大保留会话数 |
| `maxMessages` | number | `100` | 单个会话最大消息数（0 = 不限制） |

详见 [会话管理](./session-management.md)。

---

### Web 搜索配置

Web 搜索功能配置。

```typescript
{
  "webSearch": {
    "defaultProvider": "tavily" | "serper" | "brave" | "duckduckgo",
    "fallbackProviders": string[],
    "apiKeys": {
      "tavily": string,
      "serper": string,
      "brave": string
    },
    "maxResults": number,
    "cacheTTL": number
  }
}
```

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `defaultProvider` | string | `"tavily"` | 默认搜索引擎 |
| `fallbackProviders` | string[] | `[...]` | 降级引擎列表 |
| `apiKeys.tavily` | string | - | Tavily API Key（或使用环境变量 `TAVILY_API_KEY`） |
| `apiKeys.serper` | string | - | Serper API Key（或使用环境变量 `SERPER_API_KEY`） |
| `apiKeys.brave` | string | - | Brave API Key（或使用环境变量 `BRAVE_SEARCH_API_KEY`） |
| `maxResults` | number | `5` | 每次搜索最大结果数 |
| `cacheTTL` | number | `900000` | 缓存 TTL（ms，15 分钟） |

详见 [Web 能力](./web-capabilities.md)。

---

### MCP 配置

MCP（Model Context Protocol）配置。

```typescript
{
  "mcp": {
    "servers": {
      "server-name": {
        "command": string,
        "args": string[],
        "env": Record<string, string>,
        "url": string,
        "headers": Record<string, string>
      }
    }
  }
}
```

**示例**：

```json
{
  "mcp": {
    "servers": {
      "filesystem": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
      },
      "github": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-github"],
        "env": {
          "GITHUB_TOKEN": "ghp_xxxxx"
        }
      }
    }
  }
}
```

详见 [MCP 集成指南](./mcp-integration.md)。

---

### 功能特性配置

实验性功能开关。

```typescript
{
  "features": {
    "dynamicToolLoading": boolean,
    "proactiveButler": boolean,
    "smartMemoryV2": boolean
  }
}
```

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `dynamicToolLoading` | boolean | `true` | 工具按需加载（节省 token） |
| `proactiveButler` | boolean | `false` | 主动管家服务 |
| `smartMemoryV2` | boolean | `false` | 智能记忆 V2 |

---

## 环境变量列表

所有环境变量以 `XUANJI_` 开头（除 API Key 外）。

### Provider 相关

| 环境变量 | 配置路径 | 说明 |
|----------|----------|------|
| `ANTHROPIC_API_KEY` | `provider.apiKey` | Anthropic API Key |
| `OPENAI_API_KEY` | `provider.apiKey` | OpenAI API Key |
| `XUANJI_PROVIDER_ADAPTER` | `provider.adapter` | Provider 类型 |
| `XUANJI_PROVIDER_MODEL` | `provider.model` | 主模型名称 |
| `XUANJI_PROVIDER_LIGHT_MODEL` | `provider.lightModel` | 轻量模型名称 |
| `XUANJI_PROVIDER_BASE_URL` | `provider.baseURL` | API 基础 URL |

### Web 搜索相关

| 环境变量 | 配置路径 | 说明 |
|----------|----------|------|
| `TAVILY_API_KEY` | `webSearch.apiKeys.tavily` | Tavily API Key |
| `SERPER_API_KEY` | `webSearch.apiKeys.serper` | Serper API Key |
| `BRAVE_SEARCH_API_KEY` | `webSearch.apiKeys.brave` | Brave API Key |

### MCP 相关

| 环境变量 | 配置路径 | 说明 |
|----------|----------|------|
| `GITHUB_TOKEN` | `mcp.servers.github.env.GITHUB_TOKEN` | GitHub Token（MCP Server） |

---

## CLI 配置命令

Xuanji 提供以下命令管理配置：

### 查看配置

```bash
# 查看所有配置
/config list

# 查看特定配置项
/config get provider.model
/config get ui.theme
```

### 设置配置

```bash
# 设置配置项
/config set ui.theme dark
/config set provider.temperature 0.8
```

### 重置配置

```bash
# 重置特定配置项
/config reset ui.theme

# 重置所有配置
/config reset --all
```

---

## 下一步

- [工具参考](./tools-reference.md) — 所有内置工具的使用说明
- [权限系统](./permission-system.md) — 权限控制详解
- [Skills 使用指南](./skills-guide.md) — Skill 配置和自定义

---

[← 返回文档首页](./README.md) | [下一步：工具参考 →](./tools-reference.md)
