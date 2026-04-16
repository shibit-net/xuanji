# 移除全局配置依赖 - 实施方案

## 目标

完全移除全局配置的使用，强制每个 agent 使用独立的 provider 配置。

## 当前问题

### 1. ProviderManager 依赖全局配置作为回退

**位置：** `src/core/providers/ProviderManager.ts:145-204`

当 agent 没有配置 provider 时，会静默回退到全局配置，导致：
- 配置错误不易发现
- agent 之间可能意外共享同一个 API Key
- 难以追踪哪个 agent 使用了哪个配置

## 实施步骤

### Step 1: 验证所有 builtin agent 配置

检查所有 builtin agent 是否有完整的 provider 配置。

### Step 2: 修改 ProviderManager - 强制要求 agent 配置

不再回退到全局配置，agent 必须提供完整的 provider 配置。

### Step 3: 为主 Agent 使用 xuanji 配置

ChatSession 使用 `xuanji` agent 的配置创建 Provider。

### Step 4: 添加配置验证

在 AgentRegistry 加载配置时验证必需字段。

### Step 5: 更新文档

更新开发文档，说明每个 agent 必须配置独立的 provider。

## 优势

1. **配置明确**：每个 agent 的配置一目了然
2. **错误提前发现**：启动时就能发现配置缺失
3. **易于调试**：清楚知道每个 agent 使用哪个 API Key
4. **隔离性好**：agent 之间完全独立，不会互相影响
