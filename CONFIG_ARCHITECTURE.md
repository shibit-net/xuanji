# Xuanji 配置架构说明

## 配置来源

### 1. 模板配置 (`src/core/templates/`)

**作用：**
- 提供初始配置值（首次使用）
- 提供目录结构

**文件：**
```
src/core/templates/
├── config.json              # 完整的初始配置
├── mcp.json                 # MCP 初始配置
├── agents/                  # Agent 配置模板
│   ├── xuanji.json5         # 主 Agent
│   ├── coder.json5
│   └── ...
└── protocols/               # 协议模板
```

**特点：**
- Git 追踪，版本控制
- 所有用户共享
- 提供合理的默认值

---

### 2. 用户配置 (`.xuanji/users/{userId}/`)

**作用：**
- 存储用户的个性化配置
- 本地持久化

**文件：**
```
.xuanji/users/{userId}/
├── config.json              # 用户配置（从模板复制）
├── mcp.json                 # MCP 配置
├── agents/                  # Agent 配置
│   ├── xuanji.json5         # 可自定义
│   └── ...
├── memory/                  # 记忆数据
├── sessions/                # 会话历史
└── permissions/             # 权限决策
```

**特点：**
- Git 忽略，不提交
- 每个用户独立
- 用户可修改

---

## 配置加载流程

### 首次登录

```
用户首次登录 (userId)
  ↓
UserConfigInitializer.initialize()
  ├─ 检查 .xuanji/users/{userId}/config.json 是否存在
  ├─ 如果不存在：
  │   ├─ 从模板复制配置文件
  │   │   src/core/templates/config.json
  │   │     → .xuanji/users/{userId}/config.json
  │   ├─ 从模板复制 agents 目录
  │   │   src/core/templates/agents/*.json5
  │   │     → .xuanji/users/{userId}/agents/*.json5
  │   └─ 更新 userId 和时间戳
  └─ 如果存在：跳过初始化
  ↓
配置初始化完成
```

### 后续启动

```
用户登录 (userId)
  ↓
SessionFactory(userId, agentId='xuanji')
  ↓
ConfigLoader(userId, agentId).load()
  ↓
1. 加载用户配置
   读取 .xuanji/users/{userId}/config.json
   包含：ui, permission, tools, retry, skills, memory, session 等
  ↓
2. 加载 Agent 配置 ⭐
   读取 .xuanji/users/{userId}/agents/{agentId}.json5
   提取：provider (apiKey, baseURL, adapter)
         model (primary, maxTokens, temperature, thinking)
   转换为 AppConfig.provider 格式
   覆盖用户配置中的 provider 字段
  ↓
3. 加载 MCP 配置
   读取 .xuanji/users/{userId}/mcp.json
  ↓
最终配置 = 用户配置 + Agent provider
  ↓
创建 Provider (使用 Agent 配置)
```

---

## 配置优先级

```
模板配置 (初始值)
  ↓
用户配置 (可修改)
  ↓
Agent 配置 (覆盖 provider) ⭐
  ↓
运行时配置 (动态修改)
```

**关键点：**
- Agent 配置的 `provider` 字段会**完全覆盖**用户配置中的 `provider`
- 这样每个 Agent 可以使用不同的 LLM 服务

---

## 配置修改

### 修改用户配置

**方式 1：通过 GUI 设置页面**
```typescript
// desktop/main/agent-bridge.ts
handleUpdateConfig(data) {
  // 读取用户配置文件
  const configPath = getUserConfigPath(userId);
  const userConfigFile = JSON.parse(readFile(configPath));
  
  // 更新配置
  userConfigFile.config.ui = data.ui;
  userConfigFile.updatedAt = new Date().toISOString();
  
  // 保存到文件
  writeFile(configPath, JSON.stringify(userConfigFile, null, 2));
}
```

**方式 2：直接编辑文件**
```bash
# 编辑用户配置
vim .xuanji/users/{userId}/config.json

# 编辑 Agent 配置
vim .xuanji/users/{userId}/agents/xuanji.json5
```

### 修改 Agent 配置

**编辑 Agent 配置文件：**
```json5
// .xuanji/users/{userId}/agents/xuanji.json5
{
  id: 'xuanji',
  name: 'Xuanji',
  
  model: {
    primary: 'claude-sonnet-4-6',
    maxTokens: 64000,
    temperature: 0.7,
  },
  
  provider: {
    adapter: 'anthropic',
    apiKey: 'sk-xxx',                    // 自定义 API Key
    baseURL: 'https://aicoding.2233.ai', // 自定义 BaseURL
  }
}
```

**重启应用生效**

---

## 配置字段说明

### 用户配置 (`config.json`)

```json
{
  "version": "1.0",
  "userId": "177164660076560204",
  "isTemplate": false,
  "createdAt": "2026-04-19T00:47:31.683Z",
  "updatedAt": "2026-04-19T23:10:00.000Z",
  "config": {
    "ui": {
      "theme": "auto",
      "language": "en",
      "showTokenUsage": true,
      "showCost": true,
      "showThinking": false
    },
    "permission": { ... },
    "tools": { ... },
    "retry": { ... },
    "skills": { ... },
    "memory": { ... },
    "session": { ... },
    "features": { ... }
  }
}
```

### Agent 配置 (`agents/xuanji.json5`)

```json5
{
  id: 'xuanji',
  name: 'Xuanji',
  description: 'Your AI assistant',
  
  // 模型配置
  model: {
    primary: 'claude-sonnet-4-6',      // 模型名称
    maxTokens: 64000,                  // 最大 token 数
    temperature: 0.7,                  // 温度（可选）
    thinking: {                        // Extended Thinking（可选）
      type: 'adaptive',
      effort: 'medium'
    }
  },
  
  // Provider 配置 ⭐ 关键
  provider: {
    adapter: 'anthropic',              // 适配器类型
    apiKey: 'sk-xxx',                  // API Key
    baseURL: 'https://xxx.com',        // BaseURL
  },
  
  // 工具列表
  tools: [
    { name: 'read_file', required: true },
    { name: 'write_file', required: true },
    // ...
  ]
}
```

---

## 常见问题

### Q1: 为什么删除了 `DEFAULT_CONFIG`？

**A:** 
- 代码中的硬编码配置难以维护和更新
- 模板文件更灵活，可以随时修改
- 用户配置和模板配置分离，职责更清晰

### Q2: 模板配置和用户配置的区别？

**A:**
- **模板配置**：提供初始值，所有用户共享，Git 追踪
- **用户配置**：用户个性化配置，每个用户独立，Git 忽略

### Q3: 如何切换不同的 Agent？

**A:**
```typescript
// 创建 SessionFactory 时指定 agentId
const factory = new SessionFactory(userId, 'coder');
const session = await factory.create();

// 或者在 create 时指定
const factory = new SessionFactory(userId);
const session = await factory.create({ agentId: 'coder' });
```

### Q4: Agent 配置中的 provider 会覆盖用户配置吗？

**A:** 
是的，Agent 配置中的 `provider` 字段会**完全覆盖**用户配置中的 `provider`。
这样每个 Agent 可以使用不同的 LLM 服务（不同的 API Key、BaseURL 等）。

### Q5: 如何为不同场景创建不同的 Agent？

**A:**
1. 复制 `xuanji.json5` 为新文件，如 `coder.json5`
2. 修改 `id`、`name`、`provider` 等字段
3. 使用时指定 `agentId: 'coder'`

---

## 最佳实践

### 1. 模板配置

- 提供合理的默认值
- 定期更新以适应新功能
- 保持向后兼容

### 2. 用户配置

- 不要手动修改 `version`、`userId`、`createdAt` 字段
- 通过 GUI 设置页面修改，确保格式正确
- 定期备份重要配置

### 3. Agent 配置

- 为不同场景创建不同的 Agent
- 使用有意义的 `id` 和 `name`
- 妥善保管 `apiKey`，不要提交到 Git

### 4. 安全性

- `.xuanji/users/` 目录已在 `.gitignore` 中
- 不要将包含 API Key 的配置文件提交到版本控制
- 定期更换 API Key

---

## 配置迁移

如果需要迁移配置到新机器：

```bash
# 1. 备份用户配置
tar -czf xuanji-config-backup.tar.gz .xuanji/users/{userId}/

# 2. 在新机器上解压
tar -xzf xuanji-config-backup.tar.gz

# 3. 重启应用
```

---

## 总结

**配置架构的核心思想：**
1. ✅ **模板提供初始值**（首次使用）
2. ✅ **用户配置本地存储**（可修改）
3. ✅ **Agent 配置控制 provider**（灵活切换）
4. ✅ **没有代码中的硬编码配置**（易于维护）

这样的设计使得配置管理更加灵活、清晰、易于维护。
