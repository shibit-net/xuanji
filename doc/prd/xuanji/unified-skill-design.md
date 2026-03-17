# 统一 Skill 系统设计

## 问题

**当前设计过于复杂**：
- Prompt Skill：返回 prompt 文本
- Workflow Skill：调用 LLM 处理
- Executable Skill：执行代码逻辑

三种类型，理解成本高，边界模糊。

## 设计原则

### 1. 本质抽象

**Skill 的本质**：给定输入，产生输出

```
输入（用户意图 + 上下文）→ Skill 执行 → 输出（结果）
```

无论内部实现如何，对外都是统一接口。

### 2. 参考业界

- **LangChain Tool**：统一的 `call()` 方法
- **AutoGPT Skill**：就是 Python 函数
- **Unix Philosophy**：一切皆文件，统一接口

### 3. 奥卡姆剃刀

如无必要，勿增实体。能用一个接口表达的，不要拆分成多个。

## 统一设计

### 核心接口（唯一）

```typescript
// src/core/skills/types.ts

/**
 * Skill：可执行的技能单元
 *
 * 所有 Skill 都实现这个接口，内部实现可以不同
 */
interface Skill {
  // ========== 元数据 ==========
  id: string;
  name: string;
  description: string;
  version?: string;
  author?: string;
  tags?: string[];

  // ========== 核心方法 ==========
  /**
   * 执行 Skill
   * @param context 执行上下文
   * @returns 执行结果
   */
  execute(context: SkillContext): Promise<SkillResult>;

  // ========== 可选配置 ==========
  config?: {
    /** 是否自动应用（无需用户触发） */
    autoApply?: boolean;

    /** 触发条件（用于自动应用） */
    triggers?: SkillTrigger[];

    /** 优先级（数字越大越优先） */
    priority?: number;

    /** 依赖的工具 */
    requiredTools?: string[];

    /** 来源（内置 | 用户自定义 | 从教训生成） */
    source?: 'builtin' | 'custom' | 'lesson';

    /** 关联的教训 ID（如果从教训生成） */
    lessonId?: string;
  };
}

/**
 * Skill 执行上下文
 */
interface SkillContext {
  /** 用户输入 */
  userInput: string;

  /** 当前任务描述 */
  task?: string;

  /** 工作目录 */
  cwd: string;

  /** 涉及的文件 */
  files?: string[];

  /** 可用的工具注册表 */
  tools?: ToolRegistry;

  /** 消息历史 */
  messageHistory?: Message[];

  /** 额外参数 */
  params?: Record<string, any>;
}

/**
 * Skill 执行结果（统一）
 */
interface SkillResult {
  /** 结果类型 */
  type: 'prompt' | 'action' | 'hybrid';

  /** 是否成功 */
  success: boolean;

  /** 输出内容 */
  output?: string;

  /** 错误信息 */
  error?: string;

  /** 是否需要 LLM 处理（type=prompt 时为 true） */
  needsLLM?: boolean;

  /** 是否需要用户确认 */
  needsConfirmation?: boolean;

  /** 元数据 */
  metadata?: Record<string, any>;
}

/**
 * 触发条件
 */
interface SkillTrigger {
  /** 触发类型 */
  type: 'keyword' | 'pattern' | 'context' | 'tool-failure';

  /** 匹配规则 */
  match: string | RegExp | ((context: SkillContext) => boolean | Promise<boolean>);

  /** 优先级 */
  priority?: number;
}
```

### 三种实现模式

虽然接口统一，但 Skill 内部实现可以有不同模式：

#### 模式 1：Prompt Mode（知识增强）

**用途**：为 LLM 提供额外的知识、指导、上下文

**实现**：
```typescript
const memoryContextSkill: Skill = {
  id: 'memory-context',
  name: '记忆上下文',
  description: '从记忆系统中检索相关信息，增强 LLM 上下文',

  async execute(context: SkillContext): Promise<SkillResult> {
    // 检索相关记忆
    const memories = await memoryStore.retrieve(context.userInput);

    // 格式化为 prompt
    const prompt = `## 相关记忆\n\n${memories.map(m => m.content).join('\n')}`;

    return {
      type: 'prompt',
      success: true,
      output: prompt,
      needsLLM: true, // 标记需要 LLM 处理
    };
  },
};
```

**特点**：
- `type: 'prompt'`
- `needsLLM: true`
- 输出会被添加到 LLM 的上下文中

#### 模式 2：Action Mode（直接执行）

**用途**：直接执行代码逻辑，不需要 LLM

**实现**：
```typescript
const npmInstallSkill: Skill = {
  id: 'npm-install',
  name: 'NPM 安装',
  description: '使用 npm install 安装依赖',

  config: {
    autoApply: true,
    triggers: [
      {
        type: 'keyword',
        match: /安装依赖|install/i,
        priority: 10,
      },
    ],
    source: 'lesson',
    lessonId: 'lesson-001',
  },

  async execute(context: SkillContext): Promise<SkillResult> {
    try {
      // 直接执行命令
      const tool = context.tools?.get('bash');
      const result = await tool.execute({ command: 'npm install' });

      return {
        type: 'action',
        success: true,
        output: `✓ 依赖安装成功\n\n${result}`,
        needsLLM: false, // 不需要 LLM
      };
    } catch (err) {
      return {
        type: 'action',
        success: false,
        error: err.message,
        needsLLM: false,
      };
    }
  },
};
```

**特点**：
- `type: 'action'`
- `needsLLM: false`
- 输出直接返回给用户

#### 模式 3：Hybrid Mode（混合）

**用途**：先执行代码获取信息，再交给 LLM 处理

**实现**：
```typescript
const gitCommitSkill: Skill = {
  id: 'git-commit',
  name: 'Git 提交',
  description: '分析 git diff 并生成提交信息',

  async execute(context: SkillContext): Promise<SkillResult> {
    // 1. 获取 git diff（Action 部分）
    const { execSync } = await import('node:child_process');
    const diff = execSync('git diff --staged', { encoding: 'utf-8' });

    if (!diff) {
      return {
        type: 'action',
        success: false,
        error: '没有已暂存的更改',
        needsLLM: false,
      };
    }

    // 2. 构建 prompt 让 LLM 生成提交信息（Prompt 部分）
    const prompt = `请根据以下 diff 生成 Conventional Commits 格式的提交信息：\n\n\`\`\`diff\n${diff}\n\`\`\``;

    return {
      type: 'hybrid',
      success: true,
      output: prompt,
      needsLLM: true, // 需要 LLM 继续处理
      metadata: { diff },
    };
  },
};
```

**特点**：
- `type: 'hybrid'`
- `needsLLM: true`
- 结合了代码执行和 LLM 处理

### AgentLoop 集成（统一处理）

```typescript
// src/core/agent/AgentLoop.ts

async run(userMessage: string): Promise<void> {
  // 1. 构建执行上下文
  const context: SkillContext = {
    userInput: userMessage,
    task: this.task,
    cwd: process.cwd(),
    files: this.contextBuilder.getRelevantFiles(),
    tools: this.toolRegistry,
    messageHistory: this.messages,
  };

  // 2. 匹配可自动应用的 Skill
  const matchedSkills = await this.skillRegistry.matchSkills(context);

  // 3. 执行 Skill
  for (const skill of matchedSkills) {
    const result = await skill.execute(context);

    // 处理结果（统一逻辑）
    if (!result.success) {
      // 执行失败，记录日志，继续下一个
      this.log.warn(`Skill ${skill.id} 执行失败: ${result.error}`);
      continue;
    }

    // 根据类型处理
    switch (result.type) {
      case 'prompt':
        // Prompt 模式：添加到 LLM 上下文
        this.systemPromptAppend(result.output!);
        break;

      case 'action':
        // Action 模式：直接返回结果给用户
        this.emit('text', result.output!);
        this.emit('end', this.getState());
        return; // 任务完成，不需要调用 LLM

      case 'hybrid':
        // Hybrid 模式：添加到用户消息
        this.messages.push({
          role: 'user',
          content: [{ type: 'text', text: result.output! }],
        });
        break;
    }

    // 如果需要用户确认，等待用户响应
    if (result.needsConfirmation) {
      await this.waitForUserConfirmation(result);
    }
  }

  // 4. 继续正常的 LLM 调用流程
  // ...
}
```

### 从教训生成 Skill（统一接口）

```typescript
// src/learning/LessonToSkillConverter.ts

class LessonToSkillConverter {
  /**
   * 从教训生成 Skill（统一返回 Skill 接口）
   */
  async convert(lesson: LessonEvent): Promise<Skill | null> {
    if (!this.canConvert(lesson)) return null;

    const rule = lesson.applicationRule!;

    return {
      id: `lesson-${lesson.id}`,
      name: lesson.experience.title,
      description: lesson.experience.description,

      config: {
        autoApply: rule.autoApply,
        triggers: this.generateTriggers(rule),
        priority: this.calculatePriority(lesson),
        source: 'lesson',
        lessonId: lesson.id,
      },

      // 统一的 execute 方法
      execute: async (context: SkillContext): Promise<SkillResult> => {
        return this.executeApplicationRule(rule, lesson, context);
      },
    };
  }

  /**
   * 执行应用规则（根据类型返回不同的 SkillResult）
   */
  private async executeApplicationRule(
    rule: ApplicationRule,
    lesson: LessonEvent,
    context: SkillContext
  ): Promise<SkillResult> {
    switch (rule.application.type) {
      case 'alternative_tool':
        // Action 模式：直接执行工具
        return this.executeAlternativeTool(rule, context);

      case 'parameter_adjustment':
        // Prompt 模式：建议调整参数
        return {
          type: 'prompt',
          success: true,
          output: `根据经验教训"${lesson.experience.title}"，建议调整参数：\n${JSON.stringify(rule.application.action.adjustments, null, 2)}`,
          needsLLM: true,
          needsConfirmation: true,
        };

      case 'pre_validation':
        // Hybrid 模式：先检查，再决定
        const checks = await this.runPreValidation(rule, context);
        if (checks.allPassed) {
          return {
            type: 'action',
            success: true,
            output: '✓ 预验证通过，可以继续执行',
            needsLLM: false,
          };
        } else {
          return {
            type: 'prompt',
            success: true,
            output: `预验证失败，建议先解决以下问题：\n${checks.failures.join('\n')}`,
            needsLLM: true,
          };
        }

      default:
        return { type: 'action', success: false, error: '未知的应用类型' };
    }
  }
}
```

## 对比：简化前 vs 简化后

### 简化前（3 种类型）

```typescript
// 类型定义复杂
interface PromptSkill { render(): string; }
interface WorkflowSkill { execute(): WorkflowResult; }
interface ExecutableSkill { execute(): ExecutionResult; precondition?: ...; }

// 使用时需要判断类型
if (skill.category === 'prompt') {
  const text = await skill.render();
  // ...
} else if (skill.category === 'workflow') {
  const result = await skill.execute();
  // ...
} else if (skill.category === 'executable') {
  if (skill.precondition) {
    const canRun = await skill.precondition(context);
    // ...
  }
  const result = await skill.execute();
  // ...
}
```

### 简化后（1 种接口）

```typescript
// 统一接口
interface Skill {
  execute(context: SkillContext): Promise<SkillResult>;
}

// 使用时统一处理
const result = await skill.execute(context);

// 根据结果类型处理
switch (result.type) {
  case 'prompt': /* 添加到 LLM 上下文 */; break;
  case 'action': /* 直接返回用户 */; break;
  case 'hybrid': /* 混合处理 */; break;
}
```

## 优势

### 1. 认知负担低

- ✅ 只有一个 `Skill` 接口
- ✅ 只有一个 `execute()` 方法
- ✅ 通过 `SkillResult.type` 区分行为

### 2. 扩展性强

- ✅ 新增 Skill 只需实现 `execute()`
- ✅ 新增结果类型只需扩展 `SkillResult.type`
- ✅ 不需要修改核心接口

### 3. 组合灵活

- ✅ 可以在 `execute()` 内部调用其他 Skill
- ✅ 可以根据运行时条件决定返回哪种类型
- ✅ 支持复杂的执行逻辑

### 4. 测试简单

```typescript
// 统一的测试模式
describe('Skill', () => {
  it('should execute successfully', async () => {
    const context = { userInput: 'test', cwd: '/tmp' };
    const result = await skill.execute(context);

    expect(result.success).toBe(true);
    expect(result.type).toBe('action');
  });
});
```

## 迁移方案

### Phase 1: 定义统一接口（1天）

- [ ] 定义 `Skill`、`SkillContext`、`SkillResult`
- [ ] 定义 `SkillTrigger`
- [ ] 更新 `src/core/skills/types.ts`

### Phase 2: 迁移现有 Skill（1天）

- [ ] 迁移所有 Prompt Skill（实现 `execute()`，返回 `type: 'prompt'`）
- [ ] 迁移 Workflow Skill（CommitSkill、ReviewPRSkill）
- [ ] 删除旧的类型定义

### Phase 3: 更新 SkillRegistry（0.5天）

- [ ] 简化 `register()` 方法（只处理一种接口）
- [ ] 简化 `matchSkills()` 方法
- [ ] 删除类型判断逻辑

### Phase 4: 更新 AgentLoop（0.5天）

- [ ] 统一 Skill 执行逻辑
- [ ] 根据 `result.type` 分发处理
- [ ] 删除旧的分支逻辑

### Phase 5: 实现 LessonToSkill（2天）

- [ ] 实现 `LessonToSkillConverter`
- [ ] 从教训生成统一接口的 Skill
- [ ] 单元测试

### Phase 6: 文档和示例（1天）

- [ ] 更新 Skill 开发指南
- [ ] 创建 3-5 个示例 Skill
- [ ] 用户手册

**总计：6天**

## 示例：三种模式的 Skill

### 1. Prompt Mode Skill

```typescript
export const projectRulesSkill: Skill = {
  id: 'project-rules',
  name: '项目规则',
  description: '加载项目级配置和规则',

  async execute(context: SkillContext): Promise<SkillResult> {
    const rules = await loadProjectRules(context.cwd);

    return {
      type: 'prompt',
      success: true,
      output: `## 项目规则\n\n${rules}`,
      needsLLM: true,
    };
  },
};
```

### 2. Action Mode Skill

```typescript
export const formatCodeSkill: Skill = {
  id: 'format-code',
  name: '代码格式化',
  description: '使用 Prettier 格式化代码',

  config: {
    autoApply: true,
    triggers: [{ type: 'keyword', match: /格式化|format/i }],
  },

  async execute(context: SkillContext): Promise<SkillResult> {
    const tool = context.tools?.get('bash');
    const result = await tool.execute({ command: 'npm run format' });

    return {
      type: 'action',
      success: true,
      output: `✓ 代码已格式化\n\n${result}`,
      needsLLM: false,
    };
  },
};
```

### 3. Hybrid Mode Skill

```typescript
export const debugErrorSkill: Skill = {
  id: 'debug-error',
  name: '错误调试助手',
  description: '分析错误日志并提供调试建议',

  async execute(context: SkillContext): Promise<SkillResult> {
    // 1. 读取错误日志（Action 部分）
    const logs = await readErrorLogs(context.cwd);

    if (!logs) {
      return {
        type: 'action',
        success: false,
        error: '未找到错误日志',
        needsLLM: false,
      };
    }

    // 2. 检索相关教训
    const lessons = await lessonStore.search({ query: logs, type: 'failure' });

    // 3. 构建 prompt 让 LLM 分析（Prompt 部分）
    const prompt = `## 错误日志\n\n\`\`\`\n${logs}\n\`\`\`\n\n## 相关经验\n\n${lessons.map(l => l.experience.title).join('\n')}\n\n请分析错误原因并提供解决方案。`;

    return {
      type: 'hybrid',
      success: true,
      output: prompt,
      needsLLM: true,
      metadata: { logs, lessons },
    };
  },
};
```

## 总结

### 核心思想

> **一个接口，三种模式**

- **接口**：所有 Skill 都实现 `execute(context) → SkillResult`
- **模式**：通过 `result.type` 区分行为（`prompt` | `action` | `hybrid`）

### 收益

- ✅ **简单**：只需理解一个接口
- ✅ **灵活**：内部实现完全自由
- ✅ **统一**：处理逻辑一致
- ✅ **可扩展**：新增模式只需扩展 `type`

---

**设计完成时间**：2026-03-15
**设计者**：Claude（Anthropic）+ 用户协作
**项目**：Shibit Xuanji 璇玑
