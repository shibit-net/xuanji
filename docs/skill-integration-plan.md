# Skill 系统集成计划

## 概述

本文档描述了未来将 Skill 系统（如 clawHub）集成到 Xuanji 架构中的设计方案。

**当前状态**：架构已预留扩展点，暂未实现  
**目标**：支持可复用的任务模板和工作流程，增强 Agent 的能力

## 架构层次

```
┌─────────────────────────────────────────┐
│         Layer 3: Agent (角色)            │
│  定义"我是谁" - coder, analyst, tester   │
│  拥有: capabilities + skills             │
└─────────────────────────────────────────┘
              ↓ 加载
┌─────────────────────────────────────────┐
│        Layer 2: Scene (思维指导)         │
│  定义"如何思考" - design, coding, debug  │
│  提供: 原则、策略、最佳实践              │
└─────────────────────────────────────────┘
              ↓ 指导
┌─────────────────────────────────────────┐
│        Layer 1.5: Skill (能力单元)       │
│  定义"如何执行" - implement, debug, test │
│  类型: tool-based / workflow / agent     │
└─────────────────────────────────────────┘
              ↓ 调用
┌─────────────────────────────────────────┐
│         Layer 1: Tool (原子操作)         │
│  read, write, bash, grep...              │
└─────────────────────────────────────────┘
```

## 核心概念

| 层次 | 定位 | 作用 | 示例 |
|------|------|------|------|
| **Agent** | 角色 | 定义"我是谁"、"我能做什么" | coder, tester, analyst |
| **Scene** | 思维框架 | 定义"如何思考"、提供指导原则 | coding, debugging, planning |
| **Skill** | 能力单元 | 定义"如何执行"、封装执行逻辑 | implement_feature, debug_code |
| **Tool** | 原子操作 | 最基础的能力 | read, write, bash |

## Skill 的三种类型

### 1. Tool-based Skill（工具型）
直接封装 Tool 调用，提供更高级的接口

```typescript
class ReadCodeSkill extends BaseSkill {
  async execute(params: { filePath: string }) {
    // 智能读取：自动处理大文件、语法高亮、AST分析
    const content = await this.tool('read_file').execute(params);
    const ast = await this.analyzeAST(content);
    return { content, ast, summary: this.summarize(ast) };
  }
}
```

### 2. Workflow-based Skill（流程型）
预定义的标准化工作流程

```yaml
id: implement_feature
name: Feature Implementation
type: workflow
steps:
  - name: explore
    scene: explore
    action: analyze_codebase
    output: structure
  
  - name: design
    scene: plan
    action: design_solution
    input: [structure, feature_requirement]
    output: design
  
  - name: implement
    scene: write-code
    action: write_code
    input: [design]
    output: code
  
  - name: test
    scene: test
    action: write_tests
    input: [code]
```

### 3. Agent-based Skill（委派型）
委派给专门的子 Agent 执行

```typescript
class DebugCodeSkill extends BaseSkill {
  async execute(params: { error: string, context: string }) {
    // 委派给专门的debug agent
    return await this.subAgent({
      agentId: 'debugger',
      scene: 'debug',
      task: params.error,
      context: params.context
    });
  }
}
```

## 配置文件结构

```
.xuanji/
├── agents/           # Agent配置
│   ├── coder.yaml
│   ├── tester.yaml
│   └── analyst.yaml
│
├── prompts/          # Scene配置（已实现）
│   ├── l1-explore.yaml
│   ├── l1-plan.yaml
│   └── l1-write-code.yaml
│
└── skills/           # Skill配置（未来实现）
    ├── implement_feature.yaml
    ├── debug_code.yaml
    ├── refactor_module.yaml
    └── write_tests.yaml
```

## Agent 配置示例

```yaml
# Agent配置
id: coder
name: Code Engineer
description: 全栈代码工程师，可以完成从设计到测试的完整开发流程

capabilities:
  - 代码编写
  - 代码调试
  - 代码重构
  - 架构设计
  - 测试编写

# Agent拥有的Skills（未来支持）
skills:
  - implement_feature      # 实现功能
  - debug_code            # 调试代码
  - write_tests           # 编写测试
  - refactor_module       # 重构模块
```

## 已预留的扩展点

### 1. 类型定义

**文件**: `src/core/agent/types.ts`

```typescript
// CustomSkill 接口已定义（176-190行）
export interface CustomSkill {
  id: string;
  name: string;
  category: 'prompt' | 'workflow';
  priority?: number;
  content: string;
  dependencies?: string[];
}

// ConfigurableAgentConfig 中已添加 skills 字段
export interface ConfigurableAgentConfig {
  // ...
  skills?: string[];  // Skill IDs
  // ...
}
```

### 2. Agent 状态

**文件**: `src/shared/types/agent.ts`

```typescript
// AgentState 中已有 currentSkill 字段（132-135行）
export interface AgentState {
  // ...
  currentSkill?: {
    name: string;
    icon?: string;
  };
}
```

### 3. SubAgentFactory

**文件**: `src/core/agent/SubAgentFactory.ts`

已在注释中标注未来需要加载 Skills：
```typescript
/**
 * 5. 【未来扩展】Skill 加载：创建 Agent 时加载其关联的 Skills
 */
```

### 4. MainAgent Prompt

**文件**: `src/core/agent/dispatch/MainAgent.ts`

已在 prompt 中说明工具和能力层次：
```
## 工具和能力层次

- **Tools**：原子操作（read, write, bash, grep等）
- **Scenes**：场景指导（提供思维框架和最佳实践）
- **Agents**：角色定义（拥有特定能力的执行者）
- **Skills**：能力单元（未来支持，可复用的任务模板和工作流程）
```

## 实现计划（未来）

### Phase 1: 基础设施
- [ ] 创建 `SkillRegistry` 类（类似 AgentRegistry）
- [ ] 定义 Skill 配置格式（YAML）
- [ ] 实现 Skill 加载和验证
- [ ] 创建 `BaseSkill` 抽象类

### Phase 2: Tool-based Skills
- [ ] 实现 tool-based skill 类型
- [ ] 支持 Skill 调用 Tool
- [ ] 添加 Skill 执行日志

### Phase 3: Workflow-based Skills
- [ ] 实现 workflow-based skill 类型
- [ ] 支持多步骤流程定义
- [ ] 支持 Scene 切换
- [ ] 支持步骤间数据传递

### Phase 4: Agent-based Skills
- [ ] 实现 agent-based skill 类型
- [ ] 支持 Skill 委派给子 Agent
- [ ] 支持 Skill 组合

### Phase 5: clawHub 集成
- [ ] 研究 clawHub Skill 格式
- [ ] 实现 clawHub Skill 适配器
- [ ] 支持从 clawHub 导入 Skills
- [ ] 支持 Skill 版本管理

## 关键设计决策

### 1. Agent 可以自行执行 vs 调用 Skill

**自行执行**（适合简单任务）：
```typescript
agent.loadScene('write-code');
agent.call('write_file', { path, content });
```

**调用 Skill**（适合复杂/标准化任务）：
```typescript
agent.loadScene('write-code');
agent.executeSkill('implement_feature', { requirement });
```

### 2. Skill 的可组合性

Skill 可以调用其他 Skill：

```yaml
id: implement_feature
steps:
  - skill: explore_codebase
  - skill: design_solution
  - skill: write_code
  - skill: write_tests
```

### 3. 主 Agent 的决策逻辑

```typescript
if (task.isSimple) {
  // 简单任务：直接委派给Agent
  agent.execute(task);
} else if (task.hasStandardWorkflow) {
  // 标准化任务：使用Skill
  agent.executeSkill(matchedSkill, task);
} else {
  // 复杂任务：组合多个Agent/Skill
  team.execute([
    { agent: 'coder', skill: 'explore' },
    { agent: 'architect', skill: 'design' },
    { agent: 'coder', skill: 'implement' },
    { agent: 'tester', skill: 'test' }
  ]);
}
```

## 兼容性考虑

### clawHub Skill 格式

需要研究 clawHub 的 Skill 定义格式，并实现适配器：

```typescript
class ClawHubSkillAdapter {
  /**
   * 将 clawHub Skill 转换为 Xuanji Skill
   */
  adapt(clawHubSkill: ClawHubSkill): XuanjiSkill {
    // 转换逻辑
  }
}
```

### 向后兼容

- 保持现有 Agent 配置格式不变
- `skills` 字段为可选，不影响现有 Agent
- 逐步迁移，不强制使用 Skill

## 参考资料

- [clawHub 文档](https://github.com/claw-hub) （待补充）
- [Skill 系统设计讨论](./skill-design-discussion.md) （待创建）

---

**最后更新**: 2026-04-23  
**状态**: 架构设计完成，等待实现
