# Prompt 组合机制详解

## 完整的 Prompt 层次结构

```
最终 System Prompt = L0 + L1 + L2 + L3 + Agent
```

### 各层职责

| 层次 | 名称 | 职责 | 加载条件 | Token 估算 |
|------|------|------|----------|-----------|
| **L0** | 全局基础层 | 身份定义、任务执行规范、安全规则 | 始终加载 | ~600 |
| **L1** | 场景指导层 | 场景化的思维框架和工作流程 | 根据场景加载 | ~300-900 |
| **L2** | 复杂任务层 | Agent 协作规则、规划策略 | 复杂任务时加载 | ~1000 |
| **L3** | 项目上下文层 | 项目元数据、代码结构、依赖关系 | 项目环境时加载 | 动态 |
| **Agent** | 角色定义层 | Agent 的身份、能力、工作原则 | 始终加载 | ~200-500 |

## 详细说明

### L0 层：全局基础（Always）

**配置文件**：
- `l0-base-identity.yaml` - 身份定义
- `l0-base-task-execution.yaml` - 任务执行规范
- `l0-safety.yaml` - 安全规则

**内容示例**：
```yaml
# l0-base-identity.yaml
content: |
  你是 Xuanji，一个智能协作系统。
  
  核心原则：
  - 准确理解用户意图
  - 提供高质量输出
  - 保持专业和友好
```

**作用**：
- 定义系统的基础身份
- 提供通用的工作原则
- 设置安全边界

### L1 层：场景指导（Scene-based）

**配置文件**：
- `l1-explore.yaml` - 代码探索场景
- `l1-plan.yaml` - 架构设计场景
- `l1-write-code.yaml` - 代码编写场景
- `l1-debug.yaml` - 代码调试场景
- `l1-test.yaml` - 测试编写场景
- `l1-refactor.yaml` - 代码重构场景
- `l1-review.yaml` - 代码审查场景
- `l1-explain.yaml` - 技术讲解场景

**内容示例**：
```yaml
# l1-write-code.yaml
content: |
  # 代码编写场景
  
  ## 核心原则
  - 代码质量：可直接运行，无语法错误
  - 简洁明了：不闲聊、不抒情
  - 最佳实践：遵循语言规范
  
  ## 工作流程
  1. 理解需求
  2. 设计接口
  3. 编写实现
  4. 添加注释
  5. 提供示例
```

**作用**：
- 提供场景化的思维框架
- 定义特定场景的工作流程
- 规范输出格式

**加载逻辑**：
- 主 Agent 根据任务类型选择场景
- 通过 `scene` 参数传递给子 Agent
- 一个任务可以组合多个场景

### L2 层：复杂任务协调（Complex Tasks）

**配置文件**：
- `l2-agent-rules.yaml` - Agent 协作规则
- `l2-planning.yaml` - 任务规划策略
- `l2-team-coordination.yaml` - 团队协调机制

**内容示例**：
```yaml
# l2-team-coordination.yaml
content: |
  # 多 Agent 协作指南
  
  ## 协作策略
  - Sequential: 线性流程
  - Parallel: 并行执行
  - Hierarchical: 层级协调
  - Debate: 讨论评估
  - Pipeline: 数据流水线
  
  ## 协调原则
  - 明确分工
  - 清晰接口
  - 结果汇总
```

**作用**：
- 指导多 Agent 协作
- 提供任务分解策略
- 定义协调机制

**加载逻辑**：
- 仅在复杂任务时加载
- 主 Agent 使用 `agent_team` 工具时需要

### L3 层：项目上下文（Project Context）

**实现文件**：`src/core/prompt/components/l3-project.ts`

**动态生成内容**：

```markdown
# Project Context

## Project Metadata
- Type: typescript
- Root: /path/to/project
- Git: Yes
- Branch: main

## Project Rules (from CLAUDE.md)
[项目特定的规则和约定]

## Code Structure
**Total Files**: 150
**Total Symbols**: 450
**Top 20 Files**:
- `src/core/agent/AgentLoop.ts` — AgentLoop, AgentConfig
- `src/core/tools/ToolRegistry.ts` — ToolRegistry, createDefaultRegistry
- ...

## Dependencies
**Runtime**: 25 packages
- react: ^18.2.0
- typescript: ^5.0.0
- ...

**Dev**: 15 packages
- vite: ^5.0.0
- vitest: ^1.0.0
- ...
```

**作用**：
- 提供项目的上下文信息
- 帮助 Agent 理解项目结构
- 遵循项目特定的规则和约定

**加载逻辑**：
- 检测到项目环境时自动加载
- 如果不是项目（无 git 且类型未知），跳过
- 动态扫描，每次构建时更新

### Agent 层：角色定义（Agent Identity）

**配置文件**：
- `agents/software-engineer.yaml` - Code Architect
- `agents/xuanji.yaml` - 主 Agent

**内容示例**：
```yaml
# software-engineer.yaml
systemPrompt: |
  你是一位经验丰富的全栈软件工程师。
  
  ## 核心原则
  - 代码质量优先
  - 简洁清晰
  - 最佳实践
  - 安全意识
  
  ## 工作方式
  你会根据不同的任务场景，采用不同的思维方式：
  - 探索场景：理解代码库结构
  - 规划场景：设计架构方案
  - 编码场景：编写高质量代码
  - ...
  
  具体的场景指导会通过 Scene 动态加载。
```

**作用**：
- 定义 Agent 的角色身份
- 声明 Agent 的能力范围
- 提供基础的工作原则

**加载逻辑**：
- 创建 Agent 时加载
- 与 L0-L3 层组合形成完整 prompt

## Prompt 组合示例

### 示例 1：简单代码编写任务

```
用户："实现一个用户登录功能"
  ↓
主 Agent 分析：
  - 场景：write-code
  - 复杂度：standard
  ↓
Prompt 组合：
  L0（全局基础）
  + L1（write-code 场景）
  + L3（项目上下文）
  + Agent（Code Architect）
  ↓
最终 Prompt：
  """
  你是 Xuanji，一个智能协作系统。[L0]
  
  # 代码编写场景 [L1]
  ## 核心原则
  - 代码质量：可直接运行
  - 简洁明了：不闲聊
  ...
  
  # Project Context [L3]
  ## Project Metadata
  - Type: typescript
  - Root: /path/to/project
  ...
  
  你是一位经验丰富的全栈软件工程师。[Agent]
  ## 核心原则
  - 代码质量优先
  ...
  """
```

### 示例 2：复杂重构任务

```
用户："重构用户认证模块"
  ↓
主 Agent 分析：
  - 场景：refactor
  - 复杂度：complex（需要多步骤）
  ↓
Prompt 组合：
  L0（全局基础）
  + L1（explore → plan → refactor → test）
  + L2（任务规划）
  + L3（项目上下文）
  + Agent（Code Architect）
  ↓
执行流程：
  Step 1: L0 + L1(explore) + L3 + Agent
  Step 2: L0 + L1(plan) + L3 + Agent
  Step 3: L0 + L1(refactor) + L3 + Agent
  Step 4: L0 + L1(test) + L3 + Agent
```

## 动态加载机制

### 复杂度判断

```typescript
// LayeredPromptBuilder 根据复杂度加载不同层次
switch (complexity) {
  case 'simple':
    // L0 only (~600 tokens)
    layers = ['L0'];
    break;
  case 'standard':
    // L0 + L1 (~1,400 tokens)
    layers = ['L0', 'L1'];
    break;
  case 'complex':
    // L0 + L1 + L2 (~2,400 tokens)
    layers = ['L0', 'L1', 'L2'];
    break;
}

// L3 始终尝试加载（如果是项目环境）
if (isProjectEnvironment) {
  layers.push('L3');
}
```

### 场景切换

```typescript
// 主 Agent 可以动态切换场景
await agent.loadScene('explore');  // 加载探索场景
// ... 执行探索任务

await agent.loadScene('write-code');  // 切换到编码场景
// ... 执行编码任务
```

## Token 优化策略

### 1. 按需加载
- 简单任务只加载 L0
- 标准任务加载 L0 + L1
- 复杂任务加载 L0 + L1 + L2

### 2. 项目上下文优化
- 限制文件索引数量（maxFiles: 100）
- 只展示 Top N 文件（topN: 20）
- 依赖信息摘要化

### 3. 场景组件优化
- 每个 L1 场景控制在 300-900 tokens
- 避免重复内容
- 使用简洁的 Markdown 格式

## 配置优先级

当多个来源提供相同配置时：

```
项目配置 > 用户配置 > 模板配置
```

**示例**：
1. `.xuanji/prompts/l1-write-code.yaml`（项目级）
2. `.xuanji/users/{userId}/prompts/l1-write-code.yaml`（用户级）
3. `src/core/templates/prompts/l1-write-code.yaml`（模板级）

## 总结

完整的 Prompt 组合机制：

```
┌─────────────────────────────────────────┐
│  L0: 全局基础（身份、规范、安全）        │  ~600 tokens
├─────────────────────────────────────────┤
│  L1: 场景指导（思维框架、工作流程）      │  ~300-900 tokens
├─────────────────────────────────────────┤
│  L2: 复杂任务（协作规则、规划策略）      │  ~1000 tokens
├─────────────────────────────────────────┤
│  L3: 项目上下文（元数据、结构、依赖）    │  动态
├─────────────────────────────────────────┤
│  Agent: 角色定义（身份、能力、原则）     │  ~200-500 tokens
└─────────────────────────────────────────┘
                    ↓
            最终 System Prompt
```

这个分层设计实现了：
- ✅ **灵活性**：按需加载，节省 tokens
- ✅ **可维护性**：各层职责清晰，易于更新
- ✅ **可扩展性**：新增场景只需添加 L1 配置
- ✅ **上下文感知**：自动加载项目信息
- ✅ **角色分离**：Agent 定义与场景指导分离

---

**创建日期**：2026-04-23  
**版本**：v1.0  
**状态**：已实现
