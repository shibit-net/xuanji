# Skill 系统重构计划：分离 System Prompt 与真正的 Skill

## 问题

当前 8 个 Prompt Skill 中，6 个是 System Prompt 基础设施，2 个是场景模板，只有 2 个 Workflow Skill 才是真正的"技能"。概念混淆导致：
- 意图路由（VectorSkillMatcher）在匹配 System Prompt 片段，而不是匹配技能
- DynamicToolFilter 基于 Skill 过滤工具，但大部分 Skill 只是 prompt 文本
- 无法兼容 OpenClaw 的 Skill 定义（具体技能 + 工具/脚本）

## 重构目标

```
重构前:
  SkillRegistry (10 个 Skill)
    ├── 6 个 Core Prompt Skill (system prompt 片段)
    ├── 2 个 Scene Prompt Skill (场景模板)
    └── 2 个 Workflow Skill (真正的技能)

重构后:
  SystemPromptBuilder (新模块，管理 prompt 组装)
    ├── Core Blocks: identity, rules, memory, tool-guidance, security, agent
    └── Scene Templates: coding, life

  SkillRegistry (只管理真正的技能)
    ├── commit (Git 提交)
    ├── review-pr (PR 审查)
    └── ... (未来: 用户自定义 + OpenClaw 兼容)
```

## 分步实施

### Phase 1: 新建 SystemPromptBuilder（纯新增，不改旧代码）

**新建文件：**
- `src/core/prompt/SystemPromptBuilder.ts` — 核心组装器
- `src/core/prompt/types.ts` — PromptBlock / SceneTemplate 类型
- `src/core/prompt/index.ts` — 导出
- `src/core/prompt/blocks/` — 6 个 Core Block（从现有 Skill render 迁移）
  - `identity.ts` ← xuanji-assistant 的 SYSTEM_PROMPT + project-rules 逻辑
  - `memory.ts` ← memory-context（占位，运行时注入）
  - `tool-guidance.ts` ← tool-guidance 的 TOOL_GUIDANCE_PROMPT
  - `security.ts` ← security-rules 的 SECURITY_RULES_PROMPT
  - `agent-rules.ts` ← agent-rules 的 AGENT_RULES_PROMPT
- `src/core/prompt/scenes/` — 2 个场景模板
  - `coding.ts` ← code-assistant 的 CODE_ASSISTANT_PROMPT + requiredTools
  - `life.ts` ← life-secretary 的 LIFE_SECRETARY_PROMPT + requiredTools

**SystemPromptBuilder 接口：**
```typescript
class SystemPromptBuilder {
  // 构建完整 system prompt
  async build(options: { scene?: 'coding' | 'life' | 'auto', language?: string }): Promise<string>
  // 获取当前场景的工具需求（给 DynamicToolFilter 用）
  getRequiredTools(): string[]
  // 获取 thinking 配置
  getThinkingConfig(): ThinkingConfig | undefined
}
```

### Phase 2: 切换 ChatSession 使用 SystemPromptBuilder

**修改文件：**
- `src/core/chat/SessionInitializer.ts`
  - `buildSystemPrompt()` 改为调用 `SystemPromptBuilder.build()` 而非 `composeBatch()`
- `src/core/chat/ChatSession.ts`
  - 新增 `promptBuilder: SystemPromptBuilder` 成员
  - `runSingleAgent()` 中的意图路由逻辑：
    - 场景选择：VectorSkillMatcher → 选择 scene（coding/life）
    - 工具过滤：从 `promptBuilder.getRequiredTools()` 获取
    - thinking：从 `promptBuilder.getThinkingConfig()` 获取
  - 删除对 `composeBatch()` 的调用（prompt 组装不再经过 SkillRegistry）

### Phase 3: 清理 SkillRegistry，只保留真正的 Skill

**修改文件：**
- `src/core/skills/types.ts`
  - 删除 `CORE_SKILL_IDS`
  - `category` 类型改为 `'action' | 'workflow'`（去掉 `'prompt'`）
- `src/core/skills/registry.ts`
  - 删除 `composeBatch()` 方法
  - 删除 `filterByIntent()` 方法
  - 保留 `register/unregister/get/list/render/executeWorkflow/getWorkflowCommands`
- `src/core/skills/builtin/init.ts`
  - 只注册 commit + review-pr（删除 8 个 prompt Skill 的注册）
- 删除 `src/core/skills/builtin/prompts/` 目录下 6 个文件（内容已迁移到 prompt/blocks/）
  - 保留 `code-assistant.ts` 和 `life-secretary.ts` 的 prompt 常量（迁移到 scenes/）
- `src/core/skills/VectorSkillMatcher.ts`
  - 重构为 `SceneMatcher`：匹配场景（coding/life）而非 Skill
  - 或移到 `src/core/prompt/SceneMatcher.ts`
- `src/core/config/defaults.ts`
  - 删除 `skills.enabled` 中的 prompt Skill ID
  - 新增 `prompt.scene: 'auto'` 配置

### Phase 4: 更新 DynamicToolFilter

**修改文件：**
- `src/core/tools/DynamicToolFilter.ts`
  - `setActiveSkills()` → `setScene(scene: 'coding' | 'life')`
  - 工具分类不再依赖 Skill 对象，直接基于 scene
- `src/core/tools/ToolCategories.ts`
  - 场景工具映射从 Skill ID 改为 Scene 名称

## 影响范围

| 文件 | 变更类型 |
|------|---------|
| `src/core/prompt/` (新目录) | 新增 ~10 个文件 |
| `src/core/chat/ChatSession.ts` | 修改（切换到 SystemPromptBuilder） |
| `src/core/chat/SessionInitializer.ts` | 修改（buildSystemPrompt 重写） |
| `src/core/skills/types.ts` | 修改（删除 CORE_SKILL_IDS，改 category） |
| `src/core/skills/registry.ts` | 修改（删除 composeBatch/filterByIntent） |
| `src/core/skills/builtin/init.ts` | 修改（只注册 2 个 Workflow Skill） |
| `src/core/skills/builtin/prompts/*.ts` | 删除/迁移 |
| `src/core/skills/VectorSkillMatcher.ts` | 迁移到 prompt/SceneMatcher.ts |
| `src/core/tools/DynamicToolFilter.ts` | 修改（基于 scene 而非 Skill） |
| `src/core/tools/ToolCategories.ts` | 修改（scene 映射） |
| `src/core/config/defaults.ts` | 修改（新增 prompt 配置） |
| `desktop/main/agent-bridge.ts` | 可能需要适配 |
| `test/unit/skills/*.test.ts` | 更新测试 |

## 不变的部分

- AgentLoop / MessageManager — 只消费 systemPrompt 字符串，不关心来源
- AnthropicProvider — Prompt Caching 逻辑不变
- Workflow Skill（commit, review-pr）— 保持不变
- IntentRouter（src/core/intent/）— 暂不动，后续单独处理
- 记忆系统 — 仍通过 setSystemPromptSuffix 注入

## 原则

- 每个 Phase 完成后代码可运行
- Phase 1 纯新增，零风险
- Phase 2-3 是核心切换，需要仔细验证
- Phase 4 是优化，可以和 Phase 3 合并
