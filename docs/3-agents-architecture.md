# 3个应用级Agent架构总结

## 架构概览

```
┌─────────────────────────────────────────────────────────┐
│              Main Agent (Xuanji)                        │
│              智能协作系统 - 调度和协调                    │
└─────────────────────────────────────────────────────────┘
                          ↓
        ┌─────────────────┼─────────────────┐
        ↓                 ↓                 ↓
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│   Software   │  │   Product    │  │  UI Designer │
│   Engineer   │  │   Manager    │  │              │
│      🚀      │  │      📋      │  │      🎨      │
└──────────────┘  └──────────────┘  └──────────────┘
```

## 3个应用级Agent

### 1. Software Engineer 🚀 (Code Architect)

**定位**：全栈工程师 + DevOps

**职责**：
- 架构设计和技术选型
- 前后端代码开发
- 数据库设计和优化
- 代码调试和修复
- 代码重构和优化
- 测试编写和执行
- 代码审查和评估
- 容器化和编排
- CI/CD流程配置
- 部署和发布
- 系统监控和告警
- 性能分析和优化
- 故障排查和修复

**场景（Scenes）**：
- `l1-explore` - 代码探索
- `l1-plan` - 架构设计
- `l1-write-code` - 代码编写
- `l1-debug` - 代码调试
- `l1-test` - 测试编写
- `l1-refactor` - 代码重构
- `l1-review` - 代码审查
- `l1-deploy` - 部署配置 ✨
- `l1-monitor` - 监控运维 ✨

**配置文件**：`.xuanji/users/*/agents/software-engineer.yaml`

### 2. Product Manager 📋 (Product Strategist)

**定位**：产品经理

**职责**：
- 用户需求分析
- 用户研究和访谈
- 竞品分析
- 产品规划和路线图
- 功能优先级排序
- 用户故事编写
- 需求文档撰写
- 数据分析和决策
- 产品迭代规划

**场景（Scenes）**：
- `l1-requirement` - 需求分析 ✨
- `l1-user-research` - 用户研究 ✨
- `l1-product-plan` - 产品规划 ✨

**配置文件**：`.xuanji/users/*/agents/product-manager.yaml`

### 3. UI Designer 🎨 (Design Wizard)

**定位**：UI/UX设计师

**职责**：
- 信息架构设计
- 交互流程设计
- 界面布局设计
- 视觉设计和配色
- 组件设计
- 设计系统构建
- 原型制作
- 设计规范制定
- 响应式设计
- 无障碍设计

**场景（Scenes）**：
- `l1-interaction` - 交互设计 ✨
- `l1-ui-design` - UI设计 ✨
- `l1-design-system` - 设计系统 ✨

**配置文件**：`.xuanji/users/*/agents/ui-designer.yaml`

## Prompt组合机制

### 完整的Prompt结构

```
最终 System Prompt = L0 + L1 + L2 + L3 + Agent
```

### 各层说明

| 层次 | 名称 | 职责 | 适用范围 |
|------|------|------|----------|
| **L0** | 全局基础层 | 系统身份、核心原则、响应风格 | 所有Agent |
| **L1** | 场景指导层 | 场景化的思维框架和工作流程 | 特定场景 |
| **L2** | 复杂任务层 | Agent协作规则、规划策略 | 复杂任务 |
| **L3** | 项目上下文层 | 项目元数据、代码结构、依赖 | 项目环境 |
| **Agent** | 角色定义层 | Agent的身份、能力、原则 | 特定Agent |

### 示例：开发一个登录功能

```
Step 1: Product Manager (requirement scene)
  Prompt = L0 + L1(requirement) + L3 + Agent(PM)
  输出：需求文档

Step 2: UI Designer (interaction scene)
  Prompt = L0 + L1(interaction) + L3 + Agent(Designer)
  输出：交互原型

Step 3: UI Designer (ui-design scene)
  Prompt = L0 + L1(ui-design) + L3 + Agent(Designer)
  输出：UI设计稿

Step 4: Software Engineer (plan scene)
  Prompt = L0 + L1(plan) + L3 + Agent(Engineer)
  输出：技术方案

Step 5: Software Engineer (write-code scene)
  Prompt = L0 + L1(write-code) + L3 + Agent(Engineer)
  输出：代码实现

Step 6: Software Engineer (test scene)
  Prompt = L0 + L1(test) + L3 + Agent(Engineer)
  输出：测试用例

Step 7: Software Engineer (deploy scene)
  Prompt = L0 + L1(deploy) + L3 + Agent(Engineer)
  输出：部署配置
```

## 场景清单

### Software Engineer的场景（9个）

| Scene ID | 名称 | 用途 |
|----------|------|------|
| `l1-explore` | 代码探索 | 理解项目结构、定位关键文件 |
| `l1-plan` | 架构设计 | 设计技术方案、技术选型 |
| `l1-write-code` | 代码编写 | 实现功能、编写代码 |
| `l1-debug` | 代码调试 | 修复bug、排查问题 |
| `l1-test` | 测试编写 | 编写测试用例 |
| `l1-refactor` | 代码重构 | 改进代码结构 |
| `l1-review` | 代码审查 | 评估代码质量 |
| `l1-deploy` | 部署配置 | 配置部署流程、容器化 |
| `l1-monitor` | 监控运维 | 配置监控、分析性能 |

### Product Manager的场景（3个）

| Scene ID | 名称 | 用途 |
|----------|------|------|
| `l1-requirement` | 需求分析 | 分析用户需求、编写需求文档 |
| `l1-user-research` | 用户研究 | 用户访谈、竞品分析 |
| `l1-product-plan` | 产品规划 | 制定路线图、迭代计划 |

### UI Designer的场景（3个）

| Scene ID | 名称 | 用途 |
|----------|------|------|
| `l1-interaction` | 交互设计 | 设计用户流程、交互细节 |
| `l1-ui-design` | UI设计 | 设计界面布局、视觉风格 |
| `l1-design-system` | 设计系统 | 构建设计规范、组件库 |

## 已删除的场景

- ❌ `l1-coding` - 与 write-code 重复
- ❌ `l1-explain` - 不是核心场景
- ❌ `l1-life` - 不属于软件开发范畴

## 架构优势

### 1. 职责清晰
- **Engineer**：负责"怎么做"（技术实现）
- **Product Manager**：负责"做什么"（需求和规划）
- **UI Designer**：负责"长什么样"（界面和交互）

### 2. 符合团队结构
- 对应真实的软件团队角色
- 每个Agent都是独立的专业角色
- 可以灵活组合完成复杂项目

### 3. 灵活组合
- 每个Agent通过加载不同Scene适应不同场景
- 可以单独使用一个Agent
- 可以组合多个Agent协作

### 4. 可扩展
- 新增场景：只需添加L1配置
- 新增能力：在Agent的capabilities中添加
- 未来支持Skill：预留了接口

## 协作模式

### 模式1：单Agent单场景（简单任务）
```
用户："修复登录bug"
  ↓
Software Engineer + debug scene
  ↓
输出：修复方案和代码
```

### 模式2：单Agent多场景（中等任务）
```
用户："实现用户注册功能"
  ↓
Software Engineer:
  1. plan scene → 设计方案
  2. write-code scene → 编写代码
  3. test scene → 编写测试
  ↓
输出：完整实现
```

### 模式3：多Agent协作（复杂任务）
```
用户："开发一个用户管理系统"
  ↓
Product Manager:
  1. requirement scene → 需求分析
  2. product-plan scene → 产品规划
  ↓
UI Designer:
  1. interaction scene → 交互设计
  2. ui-design scene → UI设计
  ↓
Software Engineer:
  1. plan scene → 架构设计
  2. write-code scene → 代码实现
  3. test scene → 测试
  4. deploy scene → 部署
  5. monitor scene → 监控
  ↓
输出：完整的产品
```

## 文件结构

```
.xuanji/users/{userId}/
├── agents/
│   ├── software-engineer.yaml    # Software Engineer配置
│   ├── product-manager.yaml      # Product Manager配置
│   └── ui-designer.yaml          # UI Designer配置
│
└── prompts/
    ├── l0-base-identity.yaml           # L0: 系统身份
    ├── l0-base-task-execution.yaml     # L0: 任务执行
    ├── l0-base-memory-guide.yaml       # L0: 记忆管理
    ├── l0-safety.yaml                  # L0: 安全规则
    │
    ├── l1-explore.yaml                 # L1: 代码探索
    ├── l1-plan.yaml                    # L1: 架构设计
    ├── l1-write-code.yaml              # L1: 代码编写
    ├── l1-debug.yaml                   # L1: 代码调试
    ├── l1-test.yaml                    # L1: 测试编写
    ├── l1-refactor.yaml                # L1: 代码重构
    ├── l1-review.yaml                  # L1: 代码审查
    ├── l1-deploy.yaml                  # L1: 部署配置 ✨
    ├── l1-monitor.yaml                 # L1: 监控运维 ✨
    ├── l1-requirement.yaml             # L1: 需求分析 ✨
    ├── l1-user-research.yaml           # L1: 用户研究 ✨
    ├── l1-product-plan.yaml            # L1: 产品规划 ✨
    ├── l1-interaction.yaml             # L1: 交互设计 ✨
    ├── l1-ui-design.yaml               # L1: UI设计 ✨
    ├── l1-design-system.yaml           # L1: 设计系统 ✨
    │
    ├── l2-agent-rules.yaml             # L2: Agent协作
    ├── l2-planning.yaml                # L2: 任务规划
    └── l2-team-coordination.yaml       # L2: 团队协调
```

## 总结

这个架构实现了：

✅ **3个应用级Agent**：Software Engineer、Product Manager、UI Designer  
✅ **15个场景**：覆盖软件开发全流程  
✅ **清晰的职责分离**：Agent定义角色，Scene提供指导  
✅ **灵活的组合**：可以自由组合完成复杂任务  
✅ **完整的Prompt层次**：L0 + L1 + L2 + L3 + Agent  
✅ **优化的L0基础层**：适配智能协作系统  
✅ **预留Skill扩展**：未来支持可复用的任务模板  

通过这个架构，Xuanji可以协调3个专业Agent，完成从需求分析、产品设计、UI设计到代码开发、测试、部署、运维的完整软件开发流程！

---

**创建日期**：2026-04-23  
**版本**：v2.0  
**状态**：已实现
