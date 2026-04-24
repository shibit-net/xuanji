# Prompt 分层职责划分

## 📊 加载规则

### 主 Agent (xuanji)
```
L0 (base-task-execution) - 基础任务执行原则
  + xuanji.systemPrompt - AI 管家角色定义
  + L2 (仅 complex 时) - 协调策略
    - l2-agent-rules.yaml (通用)
    - l2-planning.yaml (通用)
    - l2-team-coordination.yaml (通用)
    - l2-coding-coordination.yaml (场景匹配)
  + L3 (l3-project) - 项目上下文（动态更新）
```

### 子 Agent (software-engineer)
```
L0 (base-task-execution) - 基础任务执行原则
  + agent.systemPrompt - Agent 特性
  + L1 (scene 匹配) - 场景增强
    - l1-write-code.yaml
    - l1-debug.yaml
    - l1-refactor.yaml
    - ...
  + L3 (l3-project) - 项目上下文（动态更新）
```

---

## 📋 L0 层职责

**文件**: `l0-base-task-execution.yaml`

**目标受众**: 所有 Agent（主 agent 和子 agent）

**职责**: 基础任务执行原则

**内容**:
1. ✅ Pre-Execution Checklist - 执行前检查清单
   - 切换目录
   - 搜索 memory
   - 理解上下文
   - 规划方法
   - 验证假设

2. ✅ Code Quality Standards - 代码质量标准

3. ✅ Date Handling - 日期处理规则

4. ✅ Memory Storage - Memory 存储最佳实践

5. ✅ Tool Usage Best Practices - 工具使用最佳实践

**不包含**:
- ❌ Sub-Agent 委派相关内容（已移除，属于 L2）
- ❌ 场景特定的执行指导（属于 L1）
- ❌ 协调策略（属于 L2）

---

## 📋 L2 层职责

**目标受众**: 仅主 Agent（协调者）

**加载条件**: `complexity === 'complex'`

### L2-Agent-Rules (通用)

**文件**: `l2-agent-rules.yaml`

**职责**: Agent 协调的基本规则

**内容**:
1. ✅ 何时委派任务 - 决策树（直接回答 vs task vs agent_team）
2. ✅ 如何选择 Agent - list_agents + match_agent 流程
3. ✅ 上下文隔离规则 - 如何编写 description
4. ✅ Agent 层级关系 - 高层级 vs 执行级 vs 系统级
5. ✅ 与用户沟通的原则 - 不暴露技术细节
6. ✅ 何时不委派 - 边界条件
7. ✅ 决策流程 - 流程图

**不包含**:
- ❌ agent_team 的详细使用指导（见 l2-team-coordination）
- ❌ 规划工作流（见 l2-planning）
- ❌ 场景特定的协同策略（见 l2-coding-coordination）

---

### L2-Planning (通用)

**文件**: `l2-planning.yaml`

**职责**: 任务规划与用户确认

**内容**:
1. ✅ 何时需要规划 - 简单/中等/复杂任务的决策
2. ✅ 规划工作流 - 6 步骤（分析→分解→创建 todo→确认→执行→汇总）
3. ✅ 何时使用 plan_review - 多文件修改、批量操作、不可逆操作等
4. ✅ 何时使用 ask_user - 偏好选择、预算约束、需求不明确等
5. ✅ 直接执行的情况 - 只读操作、小修改、明确请求
6. ✅ 决策流程 - 流程图
7. ✅ 最佳实践 - 5 条原则

**不包含**:
- ❌ 如何选择 Agent（见 l2-agent-rules）
- ❌ agent_team 的使用（见 l2-team-coordination）

---

### L2-Team-Coordination (通用)

**文件**: `l2-team-coordination.yaml`

**职责**: agent_team 工具的详细使用指导

**内容**:
1. ✅ 何时使用 agent_team - 使用场景和反例
2. ✅ 任务分解策略 - 3 步骤（分析需求→匹配 Agent→定义职责）
3. ✅ 5 种协作策略 - Sequential/Parallel/Hierarchical/Debate/Pipeline
4. ✅ 最佳实践 - 6 条原则
5. ✅ 常见错误 - 6 种错误模式
6. ✅ 决策树 - 如何选择协作策略
7. ✅ Pre-Flight Checklist - 执行前检查清单

**不包含**:
- ❌ 场景特定的协同策略（见 l2-coding-coordination）

---

### L2-Coding-Coordination (场景化)

**文件**: `l2-coding-coordination.yaml`

**职责**: 编码场景的协同策略

**加载条件**: `complexity === 'complex' && scene in ['write_code', 'debug', 'refactor', 'test', 'review', 'explore', 'plan', 'deploy', 'monitor']`

**内容**:
1. ✅ 场景识别 - 9 种编码场景
2. ✅ 7 种场景化协同策略:
   - 功能开发（Sequential: 需求→设计→实现→测试→审查）
   - Bug 修复（Sequential: 定位→修复→验证）
   - 代码重构（Sequential: 分析→重构→验证）
   - 代码审查（Parallel: 质量+安全+性能）
   - 架构设计（Debate/Hierarchical）
   - 部署发布（Sequential: 准备→构建→部署→验证）
   - 代码探索（Parallel: 结构+依赖+技术栈）
3. ✅ 决策树 - 根据需求快速决定协同方式
4. ✅ 注意事项 - 4 条原则

**不包含**:
- ❌ 通用的 agent_team 使用指导（见 l2-team-coordination）

---

## 🎯 职责边界总结

### L0 vs L2 的区别

| 维度 | L0 | L2 |
|------|----|----|
| **受众** | 所有 Agent | 仅主 Agent |
| **职责** | 基础执行原则 | 协调策略 |
| **内容** | 如何执行任务 | 如何协调 Agent |
| **示例** | 代码质量标准、工具使用 | 何时委派、如何规划 |

### L2 内部的职责划分

| Prompt | 层次 | 职责 |
|--------|------|------|
| **l2-agent-rules** | 决策层 | 何时委派、如何选择、如何沟通 |
| **l2-planning** | 流程层 | 规划工作流、用户确认 |
| **l2-team-coordination** | 工具层 | agent_team 的详细使用指导 |
| **l2-coding-coordination** | 场景层 | 编码场景的协同方式 |

### 信息流向

```
用户请求
  ↓
主 Agent (L0 + L2)
  ├─ L2-agent-rules: 决定是否委派
  ├─ L2-planning: 规划任务、创建 todo
  ├─ L2-team-coordination: 选择协作策略
  └─ L2-coding-coordination: 应用场景化策略
  ↓
子 Agent (L0 + L1)
  ├─ L0: 基础执行原则
  └─ L1: 场景特定的执行指导
  ↓
执行结果
  ↓
主 Agent 汇总
  ↓
友好地回复用户
```

---

## ✅ 设计原则

1. **职责单一**: 每个 prompt 只负责一个方面
2. **层次清晰**: L0 基础、L2 协调、L1 执行
3. **避免重复**: 相同内容只在一个地方维护
4. **易于扩展**: 可以轻松添加新的场景化 L2 prompts
5. **用户友好**: 主 agent 不暴露内部协调细节

---

## 🔮 未来扩展

可以添加更多场景化 L2 prompts：

- `l2-writing-coordination.yaml` - 写作场景的协同策略
- `l2-analysis-coordination.yaml` - 数据分析场景的协同策略
- `l2-design-coordination.yaml` - UI/UX 设计场景的协同策略
- `l2-product-coordination.yaml` - 产品管理场景的协同策略

每个场景化 L2 prompt 都应该：
1. 指定 `scenes` 字段（包含该领域的所有 L1 场景）
2. 提供该领域的协同策略和最佳实践
3. 包含具体的成员配置示例
4. 提供决策树帮助快速决策

---

## 🔄 L3 动态更新机制

### 工作原理

L3 (Project Context) 采用**动态更新机制**，每次用户发送消息时都会重新加载项目上下文。

**更新流程**：
```
用户发送消息
  ↓
MainAgent.run()
  ↓
promptBuilder.build()
  ↓
selectComponents() → 选择 L3
  ↓
l3Project.render()
  ↓
new ProjectScanner() → 创建新实例
  ↓
scanner.scan(process.cwd()) → 扫描当前目录
  ↓
返回当前项目的上下文
```

### 关键特性

1. **每次消息都重新扫描**
   - 不使用跨消息的缓存
   - 确保项目信息始终是最新的

2. **自动跟踪目录切换**
   - 用户使用 `change_directory` 切换目录后
   - 下次消息时自动加载新项目的上下文

3. **智能判断是否是项目**
   - 如果不是项目（没有 git 且类型未知），返回空字符串
   - 避免在非项目目录浪费 token

4. **性能优化**
   - ProjectScanner 实例级别缓存（单次扫描内有效）
   - 扫描速度：<10ms
   - 文件索引：~900ms（99 文件）
   - 总开销：~1 秒（中等项目）

### 使用场景

**场景 1: 单个项目工作**
```
用户：分析这个项目的架构
主 agent：[加载项目 A 的 L3] → 分析项目 A ✅
```

**场景 2: 切换项目**
```
用户：cd /path/to/project-B
主 agent：[执行 change_directory]
用户：分析这个项目的架构
主 agent：[重新加载 L3，获取项目 B 的上下文] → 分析项目 B ✅
```

**场景 3: 非项目目录**
```
用户：cd /tmp
主 agent：[执行 change_directory]
用户：列出文件
主 agent：[L3 返回空，不浪费 token] → 列出文件 ✅
```

### 验证测试

已通过测试验证 L3 动态更新机制：
- ✅ 在不同目录下返回不同的项目上下文
- ✅ 切换目录后自动更新
- ✅ 非项目目录返回空字符串
- ✅ 可以多次切换并正确更新

### 注意事项

1. **性能开销**
   - 每次消息都会重新扫描和索引
   - 对于大型项目（1000+ 文件），可能需要 2-3 秒
   - 如果性能成为问题，可以考虑添加会话级缓存

2. **多项目支持**
   - 当前只能加载一个项目（当前工作目录）
   - 如果需要同时操作多个项目，需要手动切换目录

3. **缓存策略**
   - ProjectScanner 的缓存是实例级别的
   - 每次 render() 都创建新实例，不会跨消息缓存
   - 这确保了动态更新，但也意味着每次都要重新扫描
