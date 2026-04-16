# Agent 配置架构重构方案

## 当前问题

### 1. Provider 传递问题（已修复）
**问题：** SubAgentFactory 在创建临时 agent 时，回退到全局配置而不是复用父 provider

**修复：**
- SubAgentFactory 构造函数增加 `parentProvider` 参数
- 创建 provider 时的逻辑：
  ```typescript
  if (agent 有独立 provider 配置) {
    使用 agent 自己的 provider
  } else {
    复用父 provider  // ← 修复：不再回退到全局配置
  }
  ```

**修改文件：**
- `src/core/agent/SubAgentFactory.ts` - 增加 parentProvider 参数和逻辑
- `src/core/agent/team/TeamManager.ts` - 传递 mainProvider
- `src/core/tools/TaskTool.ts` - 传递 parentProvider
- `src/core/chat/ChatSession.ts` - 传递 this.provider

### 2. 配置架构混乱（待重构）
**问题：**
- 存在"全局配置"、"项目配置"、"内置配置"等多层概念
- AgentRegistry 有优先级处理逻辑（project > global > builtin）
- 配置回退逻辑复杂且容易出错

**用户要求：**
> 去掉所有所谓的全局、局部、项目 agent 配置的概念，每个 agent 的配置都是独立的

## 新的配置架构

### 核心原则
1. **每个 agent 都是独立的** - 有完整的配置文件
2. **不再有配置优先级** - AgentRegistry 只负责加载和管理
3. **不再有全局配置回退** - agent 必须有完整配置或复用父 provider

### Agent 分类

#### 1. 预置 Agent（Preset Agent）
- **定义：** 在 AgentRegistry 中注册的 agent
- **配置文件位置：**
  - `src/core/agent/builtin/*.json5` - 内置 agent
  - `~/.xuanji/agents/*.json5` - 用户自定义 agent
  - `.xuanji/agents/*.json5` - 项目专用 agent
- **特点：**
  - 有完整的配置文件
  - 包含独立的 `provider` 配置（apiKey、baseURL、adapter）
  - 可以被其他 agent 引用

#### 2. 临时 Agent（Temporary Agent）
- **定义：** 动态创建的 agent，没有配置文件
- **创建方式：**
  - 父 agent 通过 `task` 工具创建
  - 父 agent 通过 `agent_team` 工具创建
- **特点：**
  - 没有配置文件
  - 复用父 agent 的 provider
  - 父 agent 可以注入 system prompt 和工具列表

### Provider 选择策略

```typescript
function selectProvider(agentConfig, parentProvider) {
  // 1. 检查 agent 是否有独立 provider 配置
  const hasIndependentProvider = 
    agentConfig.provider?.apiKey ||
    agentConfig.provider?.baseURL ||
    agentConfig.provider?.adapter;

  if (hasIndependentProvider) {
    // 预置 Agent：使用自己的 provider 配置
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

### AgentRegistry 简化

**移除：**
- ❌ 配置优先级处理（project > global > builtin）
- ❌ 配置覆盖逻辑
- ❌ `metadata.source` 字段

**保留：**
- ✅ 扫描多个目录加载配置
- ✅ 配置验证
- ✅ 热重载（文件监听）
- ✅ `get(id)` 查询接口

**新逻辑：**
```typescript
// 如果多个目录有同名 agent，后加载的覆盖前加载的（简单覆盖，不区分优先级）
// 加载顺序：builtin → global → project
```

## 重构步骤

### Phase 1: 清理 AgentRegistry（高优先级）
1. 移除 `metadata.source` 和优先级处理逻辑
2. 简化 `register()` 方法 - 直接覆盖，不判断优先级
3. 移除 `getSource()` 方法
4. 更新日志输出

### Phase 2: 清理 SubAgentFactory（高优先级）
1. ✅ 已完成：增加 `parentProvider` 参数
2. ✅ 已完成：修改 provider 选择逻辑
3. 移除 `resolveAgentConfig` 中的降级逻辑（不再降级到 general-purpose）
4. 如果找不到 agent 配置，直接报错

### Phase 3: 清理全局配置相关代码（中优先级）
1. 检查所有使用 `globalConfig.provider` 的地方
2. 确保不再有"回退到全局配置"的逻辑
3. 更新文档和注释

### Phase 4: 更新测试和文档（低优先级）
1. 更新测试用例
2. 更新 README 和配置文档
3. 添加迁移指南（如果需要）

## 测试验证

### 测试场景 1：预置 Agent
```
使用 agent_team 创建团队，成员使用预置 agent（如 coder、doc-writer）
```
**预期：** 每个成员使用自己配置文件中的 provider

### 测试场景 2：临时 Agent
```
使用 task 工具创建临时 agent，不指定 agent ID
```
**预期：** 临时 agent 复用父 agent 的 provider

### 测试场景 3：混合场景
```
主 agent 创建 agent_team，团队中有预置 agent 和临时 agent
```
**预期：**
- 预置 agent 使用自己的 provider
- 临时 agent 复用主 agent 的 provider

## 当前状态

- ✅ Phase 1 部分完成：parentProvider 传递逻辑已实现
- ⏳ Phase 2 待完成：清理 AgentRegistry
- ⏳ Phase 3 待完成：清理全局配置回退逻辑
- ⏳ Phase 4 待完成：测试和文档

## 下一步

1. 测试当前修复是否解决了 API Key 丢失问题
2. 如果测试通过，继续 Phase 2 重构
3. 如果测试失败，添加更多调试日志定位问题
