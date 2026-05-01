# 架构升级总结

## 升级目标

将 Xuanji 从硬编码的编程助手升级为通用的智能协作系统，支持动态发现和组合 Agent 与 Scene。

## 完成的工作

### 1. 核心架构升级 ✓

#### 1.1 主 Agent 通用化
- **文件**: `src/core/agent/dispatch/MainAgent.ts`
- **改动**: 将 system prompt 从"智能编程助手"改为"通用的智能协作系统"
- **效果**: 主 Agent 不再局限于编程领域，可以处理金融、法律、生活等各种领域的任务

#### 1.2 动态发现机制
- **新增工具**: `ListAgentsTool` 和 `ListScenesTool`
- **文件**: 
  - `src/core/tools/ListAgentsTool.ts`
  - `src/core/tools/ListScenesTool.ts`
- **效果**: 主 Agent 可以动态查询系统中所有可用的 Agent 和 Scene，不再依赖硬编码

#### 1.3 Agent 与 Scene 解耦
- **改动**: 
  - 移除 Agent 配置中的 `tags` 字段（保留向后兼容）
  - 降低 `tags` 在匹配中的权重（从 20% 降到 10%）
  - 提高 `capabilities` 的权重（从 10% 提高到 40%）
- **文件**:
  - `.xuanji/users/*/agents/*.yaml`
  - `src/core/tools/MatchAgentTool.ts`
- **效果**: Agent 不再绑定到特定 Scene，Scene 的分配由主 Agent 动态决定

#### 1.4 Scene 元数据增强
- **新增字段**:
  - `suitableFor`: 适用任务类型
  - `requiredCapabilities`: 需要的能力
  - `collaborationHint`: 协作建议（已有）
- **文件**: 
  - `src/core/prompt/PromptComponentRegistry.ts`
  - `.xuanji/users/*/prompts/l1-*.yaml`
- **效果**: Scene 配置更加丰富，主 Agent 可以更智能地选择和分配 Scene

### 2. 工作流程优化 ✓

#### 2.1 主 Agent 决策流程
```
用户请求
  ↓
1. 理解任务（分析目标、领域、复杂度）
  ↓
2. 决策处理方式（直接回答 / 快速委派 / 智能规划）
  ↓
3. 发现可用资源（list_agents / list_scenes）
  ↓
4. 分析能力需求（任务分解 → 能力识别）
  ↓
5. 匹配 Agent（match_agent，score >= 0.5）
  ↓
6. 补充缺失能力（创建临时 Agent）
  ↓
7. 规划协作方式（sequential / parallel / hierarchical / debate / pipeline）
  ↓
8. 分配 Scene（根据任务需求动态选择）
  ↓
执行并汇总结果
```

#### 2.2 IntentClassifier 三层降级
- **文件**: `src/core/agent/dispatch/IntentClassifier.ts`
- **策略**:
  1. Layer 1: 本地 LLM（快速）
  2. Layer 2: 向量分析（中等）
  3. Layer 3: 关键词匹配（兜底）
- **效果**: 提高意图识别的准确性和鲁棒性

### 3. 未来扩展准备 ✓

#### 3.1 Skill 系统接入点
- **类型定义**: `src/core/agent/types.ts`
  - `CustomSkill` 接口（已有）
  - `ConfigurableAgentConfig.skills` 字段（新增）
  - `AgentState.currentSkill` 字段（已有）
- **注释标注**: `src/core/agent/SubAgentFactory.ts`
  - 标注未来需要加载 Skills
- **文档**: `docs/skill-integration-plan.md`
  - 详细的 Skill 集成计划
  - 三种 Skill 类型设计
  - clawHub 兼容性考虑

#### 3.2 主 Agent Prompt 说明
- **文件**: `src/core/agent/dispatch/MainAgent.ts`
- **新增章节**: "工具和能力层次"
  - Tools: 原子操作
  - Scenes: 场景指导
  - Agents: 角色定义
  - Skills: 能力单元（未来支持）

## 架构对比

### 升级前
```
Main Agent (硬编码编程助手)
  ↓
预定义的 Agent + Scene 绑定
  ↓
Tool (原子操作)
```

**问题**:
- 主 Agent 只能处理编程任务
- Agent 和 Scene 硬绑定，不灵活
- 无法动态发现和组合资源

### 升级后
```
Main Agent (通用智能协作系统)
  ↓ 动态查询
list_agents / list_scenes
  ↓ 动态组合
Agent (capabilities) + Scene (guidance)
  ↓ 调用
Tool (原子操作)
  ↓ 未来扩展
Skill (能力单元)
```

**优势**:
- ✅ 领域无关，支持任何领域的任务
- ✅ 动态发现，不依赖硬编码
- ✅ 灵活组合，Agent 和 Scene 解耦
- ✅ 可扩展，预留 Skill 接入点

## 配置文件变化

### Agent 配置
```yaml
# 移除（可选保留）
tags:
  - coding
  - debugging

# 保留并强化
capabilities:
  - 代码编写
  - 代码调试
  - 代码重构

# 新增（未来使用）
skills: []
```

### Scene 配置
```yaml
# 新增字段
suitableFor:
  - "实现新功能"
  - "创建新组件/模块"

requiredCapabilities:
  - "代码编写"
  - "语言规范理解"
  - "设计模式应用"

# 已有字段
collaborationHint: |
  如果任务复杂，建议的协作流程：
  1. 使用 explorer 探索现有代码结构
  2. 使用 planner 规划实现方案
  3. 使用 coder 实现代码
  4. 使用 tester 编写测试用例
```

## 工具变化

### 新增工具
1. **list_scenes**: 列出所有可用的 Scene
   - 返回: id, name, description, suitableFor, requiredCapabilities, keywords, collaborationHint

### 更新工具
1. **list_agents**: 更新描述，不再强调 tags
2. **match_agent**: 调整权重
   - capabilities: 10% → 40%
   - tags: 20% → 10%

## 测试建议

### 1. 基础功能测试
- [ ] 主 Agent 能否正确调用 list_agents
- [ ] 主 Agent 能否正确调用 list_scenes
- [ ] match_agent 是否优先匹配 capabilities

### 2. 场景测试
- [ ] 编程任务：能否正确选择 coder + write-code scene
- [ ] 调试任务：能否正确选择 debugger + debug scene
- [ ] 非编程任务：能否处理生活、金融等领域的任务

### 3. 复杂任务测试
- [ ] 多步骤任务：能否正确分解和规划
- [ ] 多 Agent 协作：能否正确组织 agent_team
- [ ] 临时 Agent 创建：缺少能力时能否创建临时 Agent

## 后续工作

### 短期（可选）
- [ ] 完善更多 Scene 配置的元数据
- [ ] 添加更多内置 Agent
- [ ] 优化 IntentClassifier 的准确性

### 中期（未来）
- [ ] 实现 Skill 系统基础设施
- [ ] 支持 tool-based 和 workflow-based Skills
- [ ] 集成 clawHub Skill

### 长期（规划）
- [ ] 支持 Agent 学习和进化
- [ ] 支持多模态任务（图像、音频）
- [ ] 支持分布式 Agent 协作

## 文档更新

- [x] `docs/skill-integration-plan.md` - Skill 集成计划
- [x] `docs/architecture-upgrade-summary.md` - 本文档
- [ ] `docs/main-agent-prompt-flow.md` - 需要更新（如果存在）
- [ ] `README.md` - 需要更新架构说明

## 总结

本次架构升级成功将 Xuanji 从一个硬编码的编程助手升级为一个通用的智能协作系统。核心改进包括：

1. **通用化**: 不再局限于编程领域
2. **动态化**: 支持动态发现和组合资源
3. **解耦化**: Agent 和 Scene 完全解耦
4. **可扩展**: 预留 Skill 接入点

系统现在可以处理任何领域的任务，并且为未来的 Skill 系统集成做好了准备。

---

**完成日期**: 2026-04-23  
**版本**: v2.0  
**状态**: 架构升级完成，等待测试和优化
