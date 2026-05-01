# 主 Agent System Prompt 结构说明

## 概述

主 agent (Xuanji) 的 system prompt 由三部分组成，按照以下顺序拼接：

```
┌─────────────────────────────────────────────────────┐
│ 1. 动态 Prompt（LayeredPromptBuilder）              │
│    - L0 层：全局基础能力                             │
│    - L1 层：场景专用指导（根据 scene 动态加载）       │
│    - L2 层：协作模式（根据 complexity 动态加载）      │
├─────────────────────────────────────────────────────┤
│ 2. Xuanji 人格与沟通风格（用户可编辑）               │
│    - 来源：xuanji.yaml 的 systemPrompt              │
│    - 定义：角色定位、沟通风格、工作方式              │
├─────────────────────────────────────────────────────┤
│ 3. 主 Agent 调度职责（系统内置，不可编辑）           │
│    - 来源：MainAgent.ts 的 MAIN_AGENT_SYSTEM_PROMPT │
│    - 定义：调度逻辑、工具使用、决策流程              │
└─────────────────────────────────────────────────────┘
```

## 职责划分

### 1. 动态 Prompt（LayeredPromptBuilder）

**来源**：`src/core/prompt/components/` 目录下的 YAML 文件

**职责**：
- **L0 层**：所有 agent 共享的基础能力
  - `base-identity.md`：基础身份定义
  - `base-task-execution.md`：任务执行规范
  - `base-tool-usage.md`：工具使用指南
  - `project-context`：项目上下文（XUANJI.md）

- **L1 层**：特定场景的专业指导（根据用户输入动态加载）
  - `l1-write-code.md`：代码编写场景
  - `l1-debug.md`：调试场景
  - `l1-explore.md`：代码探索场景
  - `l1-test.md`：测试场景
  - 等等...

- **L2 层**：复杂任务的协作策略（根据任务复杂度动态加载）
  - `l2-team-coordination.md`：团队协作指导

**特点**：
- ✅ 动态加载，根据场景和复杂度自动选择
- ✅ 模块化，易于维护和扩展
- ✅ 可配置，用户可以添加自定义场景

### 2. Xuanji 人格与沟通风格（用户可编辑）

**来源**：`src/core/templates/agents/xuanji.yaml` 的 `systemPrompt` 字段

**职责**：
- 角色定位："你是 Xuanji，一个智能 AI 管家"
- 能力范围：编程、写作、设计、数据分析、学习辅导、生活管理等
- 沟通风格：友好自然、简洁高效、主动思考、诚实可靠
- 工作方式：理解需求、评估复杂度、执行任务、反馈结果
- 重要原则：对用户透明、结果导向、统一口吻、效率优先

**特点**：
- ✅ **用户可编辑**：用户可以修改这个文件来定制 Xuanji 的人格
- ✅ 面向用户体验：定义"是什么"和"怎么说"
- ✅ 通用性：适用于所有场景和任务

**如何修改**：
1. 打开 `src/core/templates/agents/xuanji.yaml`
2. 修改 `systemPrompt` 字段
3. 重启应用即可生效

### 3. 主 Agent 调度职责（系统内置，不可编辑）

**来源**：`src/core/agent/dispatch/MainAgent.ts` 的 `MAIN_AGENT_SYSTEM_PROMPT` 常量

**职责**：
- 核心能力：协调多个专业 Agent
- 工作流程：
  1. 接收意图分析结果
  2. 根据结果决策（简单任务 vs 复杂任务）
  3. 发现可用的 Agent 和 Scene
  4. 规划协作方式
  5. 分配 Scene
- 决策原则：不要假设、动态适应、灵活补充、领域无关、保持简洁
- **子 Agent 输出处理原则**：
  - 单个子 agent：使用 `stream_to_user: true`，直接输出给用户
  - 多个子 agent：需要总结整合
- 工具和能力层次：Tools、Scenes、Agents、Skills

**特点**：
- ❌ **不可编辑**：硬编码在代码中，由系统维护
- ✅ 面向技术实现：定义"怎么做"和"如何调度"
- ✅ 技术性：包含具体的工具使用指南和决策逻辑

**如何修改**：
1. 打开 `src/core/agent/dispatch/MainAgent.ts`
2. 修改 `MAIN_AGENT_SYSTEM_PROMPT` 常量
3. 重新编译代码

## 组合逻辑

在 `MainAgent.ts` 的 `run()` 方法中（第388-420行）：

```typescript
// 1. LayeredPromptBuilder 构建动态 prompt
const buildResult = await this.promptBuilder.build({
  userMessage,
  scene,
  complexity,
  agent,
});

// 2. 加载 xuanji.yaml 的配置
const xuanjiConfig = this.agentRegistry.get('xuanji');
const userEditablePrompt = xuanjiConfig?.systemPrompt || '';

// 3. 组合三部分
const finalPrompt = [
  buildResult.prompt,                                    // 动态 prompt
  userEditablePrompt ? `---\n# Xuanji 人格与沟通风格\n${userEditablePrompt}` : '',  // 用户可编辑
  `---\n# 主Agent职责（系统内置）\n${MAIN_AGENT_SYSTEM_PROMPT}`,  // 系统内置
].filter(Boolean).join('\n\n');

// 4. 设置到 AgentLoop
messageManager.systemPrompt = finalPrompt;
```

## 示例

假设用户输入："帮我重构认证模块"

**最终的 system prompt 结构**：

```markdown
# ============================================================
# 动态 Prompt（LayeredPromptBuilder）
# ============================================================

## L0 - 基础身份
你是一个智能 AI 助手...

## L0 - 任务执行规范
执行任务时，你应该...

## L0 - 工具使用指南
使用工具时，注意...

## L0 - 项目上下文
当前项目：Xuanji
项目描述：...

## L1 - 代码重构场景（根据意图分析加载）
重构代码时，你应该：
1. 先分析现有代码结构
2. 识别代码异味
3. 设计重构方案
...

## L2 - 团队协作（复杂任务，加载协作指导）
当任务需要多个 agent 协作时：
- 使用 agent_team 工具
- 选择合适的协作策略
...

---
# Xuanji 人格与沟通风格（用户可编辑）

你是 Xuanji（璇玑），一个智能 AI 管家...

## 你的角色
你是用户的私人管家...

## 沟通风格
- 友好自然
- 简洁高效
...

---
# 主Agent职责（系统内置，不可编辑）

你是 Xuanji，一个通用的智能协作系统。

## 核心能力
你可以协调多个专业 Agent...

## 工作流程
1. 接收意图分析结果
2. 根据结果决策
...

## 子 Agent 输出处理原则
### 单个子 Agent 完成独立任务
使用 stream_to_user: true...
```

## 优势

1. **职责清晰**：
   - 动态 prompt：场景适应
   - 用户可编辑：人格定制
   - 系统内置：技术保障

2. **灵活性**：
   - 用户可以定制 Xuanji 的人格和沟通风格
   - 系统可以根据场景动态加载专业指导
   - 技术实现由系统维护，保证稳定性

3. **可维护性**：
   - 三部分独立管理
   - 修改互不影响
   - 易于扩展和更新

4. **用户友好**：
   - 用户只需修改 YAML 文件
   - 不需要修改代码
   - 修改后立即生效

## 注意事项

1. **不要在 xuanji.yaml 中定义技术细节**：
   - ❌ 不要写"使用 task 工具委派任务"
   - ❌ 不要写"调用 match_agent 找到合适的 Agent"
   - ✅ 只写用户体验相关的内容

2. **不要在 MAIN_AGENT_SYSTEM_PROMPT 中定义人格**：
   - ❌ 不要写"你是一个友好的助手"
   - ❌ 不要写"你应该简洁高效地回答"
   - ✅ 只写技术实现和调度逻辑

3. **保持一致性**：
   - 两部分的内容不应该冲突
   - 如果有冲突，系统内置的优先级更高（因为在后面）

## 相关文件

- `src/core/agent/dispatch/MainAgent.ts`：主 agent 实现
- `src/core/templates/agents/xuanji.yaml`：Xuanji 配置文件
- `src/core/prompt/LayeredPromptBuilder.ts`：动态 prompt 构建器
- `src/core/prompt/components/`：prompt 组件目录
