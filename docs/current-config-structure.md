# 当前配置结构总结

## Agent 配置（.xuanji/users/{userId}/agents/）

### 系统级 Agent（1个）
- **xuanji.yaml** - 主 Agent，负责任务分析和 Agent 调度

### 应用级 Agent（3个）
1. **software-engineer.yaml** - Code Architect 🚀
   - 全栈软件工程师 + DevOps
   - 能力：代码开发、测试、部署、运维
   - 场景：explore, plan, write-code, debug, test, refactor, review, deploy, monitor

2. **product-manager.yaml** - Product Strategist 📋
   - 产品经理
   - 能力：需求分析、用户研究、产品规划
   - 场景：requirement, user-research, product-plan

3. **ui-designer.yaml** - Design Wizard 🎨
   - UI/UX 设计师
   - 能力：交互设计、UI设计、设计系统
   - 场景：interaction, ui-design, design-system

### 工具级 Agent（1个）
- **scene-classifier.yaml** - 场景分类器（使用本地小模型）

## Prompt 配置（.xuanji/users/{userId}/prompts/）

### L0 层：全局基础层（4个）
- **l0-base-identity.yaml** - 系统身份定义
- **l0-base-task-execution.yaml** - 任务执行规范
- **l0-base-memory-guide.yaml** - 记忆管理指南
- **l0-safety.yaml** - 安全规则

### L1 层：场景指导层（15个）

#### Software Engineer 场景（9个）
1. **l1-explore.yaml** - 代码探索
2. **l1-plan.yaml** - 架构设计
3. **l1-write-code.yaml** - 代码编写
4. **l1-debug.yaml** - 代码调试
5. **l1-test.yaml** - 测试编写
6. **l1-refactor.yaml** - 代码重构
7. **l1-review.yaml** - 代码审查
8. **l1-deploy.yaml** - 部署配置 ✨
9. **l1-monitor.yaml** - 监控运维 ✨

#### Product Manager 场景（3个）
10. **l1-requirement.yaml** - 需求分析 ✨
11. **l1-user-research.yaml** - 用户研究 ✨
12. **l1-product-plan.yaml** - 产品规划 ✨

#### UI Designer 场景（3个）
13. **l1-interaction.yaml** - 交互设计 ✨
14. **l1-ui-design.yaml** - UI设计 ✨
15. **l1-design-system.yaml** - 设计系统 ✨

### L2 层：复杂任务层（3个）
- **l2-agent-rules.yaml** - Agent 协作规则
- **l2-planning.yaml** - 任务规划策略
- **l2-team-coordination.yaml** - 团队协调机制

### L3 层：项目上下文层
- 动态生成（通过 `src/core/prompt/components/l3-project.ts`）
- 包含：项目元数据、代码结构、依赖关系

## 已删除的配置

### 已删除的场景
- ❌ `l1-coding.yaml` - 与 write-code 重复
- ❌ `l1-explain.yaml` - 不是核心场景
- ❌ `l1-life.yaml` - 不属于软件开发范畴

### 已删除的旧文件
- ❌ `base-identity.yaml` - 已改为 l0-base-identity.yaml
- ❌ `base-task-execution.yaml` - 已改为 l0-base-task-execution.yaml

## Prompt 组合机制

```
最终 System Prompt = L0 + L1 + L2 + L3 + Agent
```

### 加载规则
- **L0**：始终加载（所有 Agent）
- **L1**：根据场景动态加载
- **L2**：复杂任务时加载
- **L3**：项目环境时自动加载
- **Agent**：Agent 的角色定义

### 示例：Software Engineer 执行代码编写任务

```
System Prompt = 
  L0 (base-identity + base-task-execution + safety)
  + L1 (write-code)
  + L3 (project context)
  + Agent (software-engineer)
```

## 配置文件格式

### Agent 配置格式
```yaml
id: software-engineer
name: Code Architect
description: 全栈软件工程师
avatar: 🚀
color: from-purple-500 to-pink-600

capabilities:
  - 代码编写和实现
  - 代码调试和修复
  - ...

skills: []

model:
  primary: claude-sonnet-4-6
  maxTokens: 8000
  temperature: 0.3
  thinking:
    type: adaptive
    effort: medium

provider:
  adapter: anthropic

systemPrompt: |
  你是一位经验丰富的全栈软件工程师。
  ...

tools:
  - name: read_file
    enabled: true
  - name: write_file
    enabled: true
  - name: bash
    enabled: true
  ...

execution:
  mode: react
  maxIterations: 30
  timeout: 300000
  streaming: true
  parallelTools: true

permissions:
  fileRead: always
  fileWrite: ask
  bashExec: ask
  network: never

enabled: true

metadata:
  category: app
  useLightModel: false
```

### Scene 配置格式
```yaml
id: l1-write-code
name: Write Code Scene
layer: L1
scenes:
  - write_code
priority: 90
estimatedTokens: 600
match:
  keywords: "^(实现|编写|创建|添加|开发).*(功能|代码|模块|组件|接口|API)"
  description: "代码编写、功能实现"
suitableFor:
  - "实现新功能"
  - "编写代码"
  - "创建模块"
requiredCapabilities:
  - "代码编写和实现"
content: |
  # 代码编写场景
  
  ## 核心原则
  - 代码质量：可直接运行，无语法错误
  - 简洁明了：不闲聊、不抒情
  ...
```

## 统计

- **Agent 总数**：5个（1个系统级 + 3个应用级 + 1个工具级）
- **Prompt 组件总数**：22个（4个L0 + 15个L1 + 3个L2）
- **场景总数**：15个
- **支持的工作流程**：需求分析 → 产品设计 → UI设计 → 代码开发 → 测试 → 部署 → 运维

---

**更新日期**：2026-04-23  
**版本**：v2.0  
**状态**：已同步
