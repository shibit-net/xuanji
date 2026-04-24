# 编程 Agent 架构说明

## 核心理念

**一个通用 Agent + 多个场景 Scene + 未来的 Skills = 完整的编程能力**

## 架构组成

### 1. Code Architect Agent 🚀

**定位**：通用的全栈软件工程师

**职责**：
- 定义"我是谁"：一位经验丰富的软件工程师
- 定义"我能做什么"：拥有完整的编程能力
- 提供基础的工作原则和方法论

**能力清单**：
- 代码探索和分析
- 架构设计和规划
- 代码编写和实现
- 代码调试和修复
- 代码重构和优化
- 代码审查和评估
- 测试编写和执行
- 技术文档编写

**配置文件**：`.xuanji/users/*/agents/software-engineer.yaml`

### 2. 场景 Scenes（L1 层）

**定位**：场景化的思维指导

**职责**：
- 提供特定场景下的思维框架
- 定义工作流程和策略
- 规范输出格式

**不包含**：
- ❌ 角色定义（"你是XXX专家"）
- ❌ 具体的执行逻辑
- ❌ 工具调用

**现有场景**：

| Scene ID | 名称 | 适用场景 | 关键策略 |
|----------|------|----------|----------|
| `l1-explore` | 代码探索 | 理解项目结构、定位关键文件 | 自顶向下、关键路径、依赖关系 |
| `l1-plan` | 架构设计 | 方案设计、技术选型 | 结构清晰、可扩展、可维护 |
| `l1-write-code` | 代码编写 | 实现新功能、编写代码 | 质量优先、简洁清晰、最佳实践 |
| `l1-debug` | 代码调试 | 修复bug、排查问题 | 先分析、再修复、后验证 |
| `l1-test` | 测试编写 | 编写测试用例 | 全面覆盖、独立性、可读性 |
| `l1-refactor` | 代码重构 | 改进代码结构 | 保持功能、改进结构、小步迭代 |
| `l1-review` | 代码审查 | 评估代码质量 | 质量、性能、安全、最佳实践 |
| `l1-explain` | 技术讲解 | 解释原理、说明机制 | 通俗易懂、循序渐进、结合实例 |

### 3. Skills（未来支持）

**定位**：可复用的任务模板和工作流程

**类型**：
- **Tool-based**：封装工具调用
- **Workflow-based**：预定义的多步骤流程
- **Agent-based**：委派给子 Agent

**示例**（未来）：
```yaml
# implement_feature skill
steps:
  - scene: explore      # 探索代码库
  - scene: plan         # 设计方案
  - scene: write-code   # 编写代码
  - scene: test         # 编写测试
```

## 工作流程

### 简单任务（单场景）

```
用户："帮我实现一个用户登录功能"
  ↓
主 Agent 分析：
  - 任务类型：代码编写
  - 复杂度：中等
  ↓
主 Agent 决策：
  - 使用 software-engineer agent
  - 加载 write-code scene
  ↓
Code Architect 执行：
  - 应用 write-code 场景的思维指导
  - 调用工具（read, write, edit）
  - 输出高质量代码
```

### 复杂任务（多场景组合）

```
用户："重构用户认证模块"
  ↓
主 Agent 分析：
  - 任务类型：代码重构
  - 复杂度：高
  - 需要多个步骤
  ↓
主 Agent 规划：
  1. 探索现有代码（explore scene）
  2. 设计重构方案（plan scene）
  3. 执行重构（refactor scene）
  4. 编写测试（test scene）
  ↓
Code Architect 执行：
  Step 1: 加载 explore scene
    - 分析现有认证模块结构
    - 识别问题和改进点
  
  Step 2: 加载 plan scene
    - 设计重构方案
    - 制定实施计划
  
  Step 3: 加载 refactor scene
    - 执行重构
    - 保持功能不变
  
  Step 4: 加载 test scene
    - 编写测试用例
    - 验证重构结果
```

### 未来：使用 Skill（自动化流程）

```
用户："实现一个新功能"
  ↓
主 Agent 决策：
  - 使用 software-engineer agent
  - 调用 implement_feature skill
  ↓
Skill 自动执行：
  1. 加载 explore scene → 探索代码库
  2. 加载 plan scene → 设计方案
  3. 加载 write-code scene → 编写代码
  4. 加载 test scene → 编写测试
  ↓
自动完成整个流程
```

## 职责分离

### Agent 的职责
- ✅ 定义角色身份（"我是一位软件工程师"）
- ✅ 定义能力范围（capabilities）
- ✅ 提供基础原则（代码质量、安全意识等）
- ✅ 配置工具和权限
- ❌ 不定义具体场景的工作流程

### Scene 的职责
- ✅ 提供场景化的思维指导
- ✅ 定义工作流程和策略
- ✅ 规范输出格式
- ❌ 不定义角色身份
- ❌ 不包含具体的执行逻辑

### Skill 的职责（未来）
- ✅ 封装可复用的任务模板
- ✅ 定义多步骤工作流程
- ✅ 自动化场景切换
- ❌ 不定义角色身份
- ❌ 不提供思维指导

## 优势

### 1. 灵活性
- 一个 Agent 可以适应多种场景
- 场景可以自由组合
- 不需要为每个场景创建专门的 Agent

### 2. 可维护性
- Agent 配置简洁，只定义角色和能力
- Scene 配置独立，易于更新和优化
- 职责清晰，不会混淆

### 3. 可扩展性
- 新增场景：只需添加新的 Scene 配置
- 新增能力：在 Agent 的 capabilities 中添加
- 未来支持 Skill：预留了接口

### 4. 一致性
- 所有编程任务使用同一个 Agent
- 保持一致的代码风格和质量标准
- 统一的工作原则和方法论

## 配置示例

### Agent 配置（简化）
```yaml
id: software-engineer
name: Code Architect
capabilities:
  - 代码探索和分析
  - 架构设计和规划
  - 代码编写和实现
  # ... 更多能力

systemPrompt: |
  你是一位经验丰富的全栈软件工程师。
  
  核心原则：
  - 代码质量优先
  - 简洁清晰
  - 最佳实践
  - 安全意识
  
  具体的场景指导会通过 Scene 动态加载。
```

### Scene 配置（简化）
```yaml
id: l1-write-code
name: Write Code Scene
suitableFor:
  - 实现新功能
  - 创建新组件
requiredCapabilities:
  - 代码编写
  - 语言规范理解

content: |
  # 代码编写场景
  
  ## 核心原则
  - 代码质量：可直接运行
  - 简洁明了：不闲聊
  - 最佳实践：遵循规范
  
  ## 工作流程
  1. 理解需求
  2. 设计接口
  3. 编写实现
  4. 添加注释
  5. 提供示例
```

## 使用示例

### 主 Agent 调用
```typescript
// 主 Agent 决策
const result = await mainAgent.delegate({
  agentId: 'software-engineer',
  scene: 'write-code',
  task: '实现用户登录功能'
});
```

### 多场景组合
```typescript
// 主 Agent 规划
const team = await mainAgent.createTeam({
  strategy: 'sequential',
  members: [
    { agentId: 'software-engineer', scene: 'explore', task: '分析现有代码' },
    { agentId: 'software-engineer', scene: 'plan', task: '设计重构方案' },
    { agentId: 'software-engineer', scene: 'refactor', task: '执行重构' },
    { agentId: 'software-engineer', scene: 'test', task: '编写测试' }
  ]
});
```

## 总结

这个架构实现了：
- ✅ **一个 Agent**：Code Architect，通用的软件工程师
- ✅ **多个 Scene**：8个编程场景，覆盖完整开发流程
- ✅ **清晰的职责分离**：Agent 定义角色，Scene 提供指导
- ✅ **灵活的组合**：可以自由组合场景完成复杂任务
- ✅ **未来的扩展**：预留了 Skill 接入点

通过场景组合，一个 Agent 就能完成从架构设计到测试的所有编程任务！

---

**创建日期**：2026-04-23  
**版本**：v1.0  
**状态**：已实现并优化
