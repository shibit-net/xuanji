# Agent 配置架构重构完成报告

## 重构目标

去掉所有"全局/局部/项目 agent 配置"的概念，每个 agent 的配置都是独立的。

## 已完成的修改

### 1. AgentRegistry 简化

**文件：** `src/core/agent/AgentRegistry.ts`

**修改内容：**
- ✅ 移除配置优先级处理逻辑（project > global > builtin）
- ✅ 移除 `getSource()` 方法
- ✅ 简化 `register()` 方法 - 直接覆盖，不判断优先级
- ✅ 简化 `loadAgentConfig()` - 移除 source 字段
- ✅ 更新 `saveToFile()` - 参数改为 `targetDir: 'user' | 'project'`
- ✅ 更新 `deleteFile()` - 通过文件路径判断是否为内置 agent
- ✅ 更新注释和文档

**新逻辑：**
```typescript
// 加载顺序：builtin → user → project
// 后加载的同名 agent 会覆盖先加载的（简单覆盖）
```

### 2. Agent 类型定义清理

**文件：** `src/core/agent/types.ts`

**修改内容：**
- ✅ 移除 `metadata.source` 字段
- ✅ 移除 `metadata.createdAt` 和 `metadata.updatedAt` 字段
- ✅ 移除 `metadata.builtin`、`metadata.isSubAgent`、`metadata.isMainAgent` 字段
- ✅ 保留 `metadata.internal` 字段（用于标识系统内部 agent）
- ✅ 保留 `metadata.filePath` 和 `metadata.loadedAt` 字段

**新定义：**
```typescript
metadata?: {
  filePath?: string;      // 配置文件路径
  loadedAt?: string;      // 加载时间
  internal?: boolean;     // 是否为系统内部 agent
  [key: string]: any;     // 额外元数据
}
```

### 3. SubAgentFactory 清理

**文件：** `src/core/agent/SubAgentFactory.ts`

**修改内容：**
- ✅ 增加 `parentProvider` 参数（修复 provider 传递问题）
- ✅ 移除降级到 `general-purpose` 的逻辑
- ✅ 简化 `resolveAgentConfig()` - 找不到配置直接报错
- ✅ 优化 provider 选择逻辑：
  ```typescript
  if (agent 有独立 provider 配置) {
    使用 agent 自己的 provider
  } else if (parentProvider 存在) {
    复用父 provider
  } else {
    报错
  }
  ```

### 4. ListAgentsTool 更新

**文件：** `src/core/tools/ListAgentsTool.ts`

**修改内容：**
- ✅ 移除 `metadata.source` 的引用
- ✅ 通过文件路径判断是否为内置 agent
- ✅ 使用 `metadata.internal` 判断是否为系统内部 agent

### 5. Provider 传递修复

**修改文件：**
- ✅ `src/core/agent/SubAgentFactory.ts` - 增加 parentProvider 参数
- ✅ `src/core/agent/team/TeamManager.ts` - 传递 mainProvider
- ✅ `src/core/tools/TaskTool.ts` - 传递 parentProvider
- ✅ `src/core/chat/ChatSession.ts` - 传递 this.provider

## 新的配置架构

### Agent 分类

#### 1. 预置 Agent（Preset Agent）
- 在 AgentRegistry 中注册
- 有完整的配置文件
- 包含独立的 `provider` 配置
- 配置文件位置：
  - `src/core/agent/builtin/*.json5` - 内置 agent
  - `~/.xuanji/agents/*.json5` - 用户自定义 agent
  - `.xuanji/agents/*.json5` - 项目专用 agent

#### 2. 临时 Agent（Temporary Agent）
- 动态创建，没有配置文件
- 复用父 agent 的 provider
- 父 agent 可以注入 system prompt 和工具列表

### Provider 选择策略

```typescript
function selectProvider(agentConfig, parentProvider) {
  const hasIndependentProvider = 
    agentConfig.provider?.apiKey ||
    agentConfig.provider?.baseURL ||
    agentConfig.provider?.adapter;

  if (hasIndependentProvider) {
    // 预置 Agent：使用自己的 provider
    return providerManager.getProvider(agentConfig);
  } else if (parentProvider) {
    // 临时 Agent：复用父 provider
    return parentProvider;
  } else {
    // 错误：既没有独立配置，也没有父 provider
    throw new Error(`Agent ${agentConfig.id} has no provider config and no parent provider`);
  }
}
```

## 构建验证

```bash
npm run build
```

✅ 构建成功，无错误

## 测试建议

### 测试场景 1：预置 Agent
```
使用 agent_team 创建团队，成员使用预置 agent（如 general-purpose、coder）
```
**预期：** 每个成员使用自己配置文件中的 provider

### 测试场景 2：临时 Agent
```
使用 task 工具创建临时 agent，不指定 agent ID
```
**预期：** 临时 agent 复用父 agent 的 provider

### 测试场景 3：混合场景
```
主 agent 创建 agent_team，团队中有预置 agent
```
**预期：**
- 预置 agent 使用自己的 provider
- 不再有"回退到全局配置"的情况

## 后续工作

### 可选优化
1. 更新用户文档，说明新的配置架构
2. 添加配置迁移工具（如果有用户使用旧的配置格式）
3. 添加更多调试日志，帮助排查 provider 配置问题

### 已知限制
1. 如果 agent 配置文件中没有 provider 配置，且没有父 provider，会报错
2. 内置 agent 必须有完整的 provider 配置

## 总结

本次重构成功简化了 agent 配置架构：
- ✅ 移除了复杂的优先级处理逻辑
- ✅ 统一了 agent 配置的概念
- ✅ 修复了 provider 传递问题
- ✅ 代码更清晰、更易维护

所有 agent 现在都是独立的，不再有"全局/局部/项目"的区分，只是存储位置不同。
