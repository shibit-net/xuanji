# 可执行 Skill 系统设计

## 背景

### 当前问题

**Skill 只是 Prompt 指导**：
- 现有 Skill 主要通过 `render()` 返回 prompt 文本给 LLM
- Workflow Skill 虽然有 `execute()` 方法，但仍然依赖 LLM 处理
- 缺少真正的可执行逻辑（如直接调用 API、执行脚本等）

**经验教训无法转化为技能**：
- LessonStore 只是记录经验，没有应用机制
- 无法从经验教训中提炼出可复用的 Skill
- 缺少自动化应用的能力

### 参考：OpenClaw Skill 设计

根据调研（[OpenClaw Skills](https://docs.openclaw.ai/tools/skills), [DigitalOcean Guide](https://www.digitalocean.com/resources/articles/what-are-openclaw-skills)），OpenClaw 的 Skill 系统有以下特点：

1. **可执行性**：Skill 不仅仅是 prompt，而是包含实际的执行代码和规则
2. **结构化**：每个 Skill 是一个目录，包含 `skill.md`（YAML frontmatter + 指令）+ 可选的可执行脚本
3. **幂等性**：确保任务每次执行结果一致
4. **模块化**：可以打包特定功能（API 调用、数据库查询、工作流等）
5. **层级加载**：workspace > ~/.openclaw > bundled（本地覆盖）
6. **生态系统**：ClawHub 有 2,857+ 可下载的 Skill

## 目标

### 核心能力

1. **真正可执行的 Skill**：
   - 不依赖 LLM，直接执行代码逻辑
   - 支持 TypeScript/JavaScript 脚本
   - 支持系统命令调用
   - 支持 API 调用

2. **从经验教训生成 Skill**：
   - 自动分析 LessonEvent
   - 提取可复用的模式
   - 生成 Skill 模板
   - 用户确认后保存

3. **自动化应用**：
   - 在特定场景下自动触发 Skill
   - 基于上下文匹配（向量检索）
   - 支持前置条件检查
   - 支持后置验证

4. **Skill 生态**：
   - 支持自定义 Skill 开发
   - 支持 Skill 导入/导出
   - 支持 Skill 版本管理
   - 支持 Skill 依赖管理

## 设计方案

### 1. Skill 类型扩展

#### 1.1 新增 ExecutableSkill 类型

```typescript
// src/core/skills/types.ts

export interface ExecutableSkill extends Skill {
  category: 'executable';

  /** 执行函数（必需） */
  execute: (context: ExecutionContext) => Promise<ExecutionResult>;

  /** 前置条件检查（可选） */
  precondition?: (context: ExecutionContext) => boolean | Promise<boolean>;

  /** 后置验证（可选） */
  postcondition?: (result: ExecutionResult) => boolean | Promise<boolean>;

  /** 触发条件（可选，用于自动应用） */
  triggers?: SkillTrigger[];

  /** 来源（手动创建 | 从经验教训生成） */
  source?: 'manual' | 'lesson';

  /** 关联的教训 ID（如果是从教训生成的） */
  lessonId?: string;
}

/** 执行上下文 */
export interface ExecutionContext {
  /** 用户输入 */
  userInput: string;

  /** 当前任务 */
  task?: string;

  /** 工作目录 */
  cwd: string;

  /** 涉及的文件 */
  files?: string[];

  /** 工具注册表（可调用工具） */
  tools?: ToolRegistry;

  /** 额外参数 */
  params?: Record<string, any>;

  /** 消息历史 */
  messageHistory?: Message[];
}

/** 执行结果 */
export interface ExecutionResult {
  /** 是否成功 */
  success: boolean;

  /** 输出（显示给用户） */
  output?: string;

  /** 错误信息 */
  error?: string;

  /** 元数据 */
  metadata?: Record<string, any>;

  /** 是否需要用户确认 */
  requiresConfirmation?: boolean;
}

/** 触发条件 */
export interface SkillTrigger {
  /** 触发类型 */
  type: 'keyword' | 'pattern' | 'context' | 'tool-failure';

  /** 触发规则 */
  rule: string | RegExp | ((context: ExecutionContext) => boolean);

  /** 优先级 */
  priority?: number;
}
```

#### 1.2 Skill 分类更新

```typescript
export type SkillCategory =
  | 'prompt'      // Prompt Skill：只返回文本
  | 'workflow'    // Workflow Skill：调用 LLM 处理复杂任务
  | 'executable'; // Executable Skill：直接执行代码逻辑
```

### 2. LessonToSkill 转换器

#### 2.1 转换逻辑

```typescript
// src/learning/LessonToSkillConverter.ts

import type { LessonEvent, ApplicationRule } from '@/learning/types';
import type { ExecutableSkill, ExecutionContext, ExecutionResult } from '@/core/skills/types';

export class LessonToSkillConverter {
  /**
   * 从经验教训生成可执行 Skill
   */
  async convertLessonToSkill(lesson: LessonEvent): Promise<ExecutableSkill | null> {
    // 只转换已验证且有应用规则的教训
    if (!lesson.verification.verified || !lesson.applicationRule) {
      return null;
    }

    // 只转换成功经验和最佳实践
    if (lesson.type !== 'success' && lesson.type !== 'best_practice') {
      return null;
    }

    const rule = lesson.applicationRule;

    return {
      id: `lesson-${lesson.id}`,
      name: lesson.experience.title,
      version: '1.0.0',
      description: lesson.experience.description,
      category: 'executable',
      tags: [lesson.domain, lesson.type, 'auto-generated'],
      source: 'lesson',
      lessonId: lesson.id,
      enabled: true,
      priority: this.calculatePriority(lesson),

      // 触发条件
      triggers: this.generateTriggers(rule),

      // 前置条件
      precondition: async (context: ExecutionContext) => {
        return this.checkTriggerCondition(rule.trigger, context);
      },

      // 执行逻辑
      execute: async (context: ExecutionContext) => {
        return this.generateExecuteFunction(rule, lesson)(context);
      },

      // 后置验证
      postcondition: async (result: ExecutionResult) => {
        // 检查是否符合预期结果
        return result.success;
      },
    };
  }

  /**
   * 生成触发条件
   */
  private generateTriggers(rule: ApplicationRule): SkillTrigger[] {
    const triggers: SkillTrigger[] = [];

    // 关键词触发
    if (rule.trigger.keywords && rule.trigger.keywords.length > 0) {
      triggers.push({
        type: 'keyword',
        rule: new RegExp(rule.trigger.keywords.join('|'), 'i'),
        priority: 1,
      });
    }

    // 工具失败触发
    if (rule.trigger.toolName) {
      triggers.push({
        type: 'tool-failure',
        rule: (context) => {
          // 检查最近的工具调用是否失败
          const lastTool = context.messageHistory
            ?.filter((m) => m.role === 'assistant' && m.toolCalls)
            .pop()?.toolCalls?.pop();
          return lastTool?.name === rule.trigger.toolName && lastTool?.status === 'error';
        },
        priority: 2,
      });
    }

    return triggers;
  }

  /**
   * 生成执行函数
   */
  private generateExecuteFunction(
    rule: ApplicationRule,
    lesson: LessonEvent
  ): (context: ExecutionContext) => Promise<ExecutionResult> {
    return async (context: ExecutionContext) => {
      try {
        // 根据应用方式生成执行逻辑
        switch (rule.application.type) {
          case 'alternative_tool':
            return this.executeAlternativeTool(rule, context);

          case 'parameter_adjustment':
            return this.executeParameterAdjustment(rule, context);

          case 'pre_validation':
            return this.executePreValidation(rule, context);

          case 'workflow_change':
            return this.executeWorkflowChange(rule, context);

          default:
            return {
              success: false,
              error: `未知的应用方式: ${rule.application.type}`,
            };
        }
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    };
  }

  /**
   * 执行：使用替代工具
   */
  private async executeAlternativeTool(
    rule: ApplicationRule,
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    const { recommendedTool, params } = rule.application.action;

    if (!context.tools) {
      return { success: false, error: '工具注册表不可用' };
    }

    try {
      // 调用推荐的工具
      const tool = context.tools.get(recommendedTool);
      if (!tool) {
        return { success: false, error: `工具 ${recommendedTool} 不存在` };
      }

      const result = await tool.execute(params || context.params || {});

      return {
        success: true,
        output: `已使用推荐工具 ${recommendedTool} 替代，执行成功。\n\n${result}`,
        metadata: { tool: recommendedTool, originalParams: context.params },
      };
    } catch (err) {
      return {
        success: false,
        error: `工具执行失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * 执行：参数调整
   */
  private async executeParameterAdjustment(
    rule: ApplicationRule,
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    const { adjustments } = rule.application.action;

    return {
      success: true,
      output: `建议调整参数:\n${JSON.stringify(adjustments, null, 2)}`,
      metadata: { adjustments },
      requiresConfirmation: true,
    };
  }

  /**
   * 执行：预验证
   */
  private async executePreValidation(
    rule: ApplicationRule,
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    const { checks } = rule.application.action;

    const results = [];
    for (const check of checks) {
      // 执行验证逻辑（可以是命令、文件检查等）
      const passed = await this.runCheck(check, context);
      results.push({ check, passed });
    }

    const allPassed = results.every((r) => r.passed);

    return {
      success: allPassed,
      output: allPassed
        ? '所有预验证通过，可以继续执行。'
        : `预验证失败:\n${results.filter((r) => !r.passed).map((r) => `- ${r.check}`).join('\n')}`,
      metadata: { checks: results },
    };
  }

  /**
   * 执行：工作流变更
   */
  private async executeWorkflowChange(
    rule: ApplicationRule,
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    const { newWorkflow } = rule.application.action;

    return {
      success: true,
      output: `建议使用新工作流:\n${newWorkflow}`,
      metadata: { workflow: newWorkflow },
      requiresConfirmation: true,
    };
  }

  /**
   * 运行检查
   */
  private async runCheck(check: string, context: ExecutionContext): Promise<boolean> {
    // 简单实现：支持文件存在性检查、命令执行等
    if (check.startsWith('file:')) {
      const filePath = check.substring(5);
      const fs = await import('node:fs/promises');
      try {
        await fs.access(filePath);
        return true;
      } catch {
        return false;
      }
    }

    if (check.startsWith('command:')) {
      const command = check.substring(8);
      const { execSync } = await import('node:child_process');
      try {
        execSync(command, { stdio: 'ignore' });
        return true;
      } catch {
        return false;
      }
    }

    return true;
  }

  /**
   * 检查触发条件
   */
  private checkTriggerCondition(
    trigger: ApplicationRule['trigger'],
    context: ExecutionContext
  ): boolean {
    // 检查关键词
    if (trigger.keywords && trigger.keywords.length > 0) {
      const hasKeyword = trigger.keywords.some((kw) =>
        context.userInput.toLowerCase().includes(kw.toLowerCase())
      );
      if (!hasKeyword) return false;
    }

    // 检查工具名称
    if (trigger.toolName) {
      const hasToolFailure = context.messageHistory
        ?.filter((m) => m.role === 'assistant' && m.toolCalls)
        .some((m) =>
          m.toolCalls?.some((tc) => tc.name === trigger.toolName && tc.status === 'error')
        );
      if (!hasToolFailure) return false;
    }

    // 检查上下文
    if (trigger.context) {
      const contextMatch = Object.entries(trigger.context).every(([key, value]) => {
        const contextValue = (context as any)[key];
        if (Array.isArray(value)) {
          return value.includes(contextValue);
        }
        return contextValue === value;
      });
      if (!contextMatch) return false;
    }

    return true;
  }

  /**
   * 计算优先级
   */
  private calculatePriority(lesson: LessonEvent): number {
    let priority = 5; // 基础优先级

    // 影响程度
    if (lesson.experience.impact === 'critical') priority += 5;
    if (lesson.experience.impact === 'major') priority += 3;
    if (lesson.experience.impact === 'minor') priority += 1;

    // 应用次数
    priority += Math.min(lesson.verification.applicationCount, 5);

    // 成功率
    if (lesson.verification.applicationCount > 0) {
      const successRate = lesson.verification.successCount / lesson.verification.applicationCount;
      priority += Math.floor(successRate * 5);
    }

    return priority;
  }
}
```

#### 2.2 ApplicationRule 类型定义（补充）

```typescript
// src/learning/types.ts

/** 应用规则 */
export interface ApplicationRule {
  /** 触发条件 */
  trigger: {
    /** 关键词 */
    keywords?: string[];

    /** 工具名称 */
    toolName?: string;

    /** 上下文条件 */
    context?: Record<string, any>;
  };

  /** 应用方式 */
  application: {
    /** 应用类型 */
    type: 'alternative_tool' | 'parameter_adjustment' | 'pre_validation' | 'workflow_change';

    /** 具体行为 */
    action: {
      /** 推荐工具（alternative_tool） */
      recommendedTool?: string;

      /** 参数（alternative_tool） */
      params?: Record<string, any>;

      /** 参数调整（parameter_adjustment） */
      adjustments?: Record<string, any>;

      /** 验证检查（pre_validation） */
      checks?: string[];

      /** 新工作流（workflow_change） */
      newWorkflow?: string;
    };
  };

  /** 置信度 */
  confidence: number;

  /** 自动应用 */
  autoApply: boolean;
}
```

### 3. SkillRegistry 增强

#### 3.1 支持 ExecutableSkill 加载

```typescript
// src/core/skills/registry.ts

export class SkillRegistry {
  // 现有代码...

  /**
   * 从经验教训加载 Skill
   */
  async loadSkillsFromLessons(lessonStore: LessonStore): Promise<void> {
    const converter = new LessonToSkillConverter();

    // 获取所有已验证且有应用规则的教训
    const lessons = await lessonStore.search({
      verified: true,
      hasApplicationRule: true,
    });

    let loadedCount = 0;
    for (const lesson of lessons) {
      const skill = await converter.convertLessonToSkill(lesson);
      if (skill) {
        this.register(skill);
        loadedCount++;
      }
    }

    this.log.info(`从经验教训加载了 ${loadedCount} 个 Skill`);
  }

  /**
   * 根据上下文匹配可应用的 ExecutableSkill
   */
  async matchExecutableSkills(context: ExecutionContext): Promise<ExecutableSkill[]> {
    const executableSkills = Array.from(this.skills.values()).filter(
      (s): s is ExecutableSkill => s.category === 'executable' && s.enabled === true
    );

    const matched: Array<{ skill: ExecutableSkill; priority: number }> = [];

    for (const skill of executableSkills) {
      if (!skill.triggers || skill.triggers.length === 0) continue;

      for (const trigger of skill.triggers) {
        const isMatch = await this.checkTrigger(trigger, context);
        if (isMatch) {
          matched.push({ skill, priority: trigger.priority || skill.priority || 0 });
          break;
        }
      }
    }

    // 按优先级排序
    matched.sort((a, b) => b.priority - a.priority);

    return matched.map((m) => m.skill);
  }

  /**
   * 检查触发条件
   */
  private async checkTrigger(trigger: SkillTrigger, context: ExecutionContext): Promise<boolean> {
    if (typeof trigger.rule === 'function') {
      return trigger.rule(context);
    }

    if (trigger.rule instanceof RegExp) {
      return trigger.rule.test(context.userInput);
    }

    if (typeof trigger.rule === 'string') {
      return context.userInput.toLowerCase().includes(trigger.rule.toLowerCase());
    }

    return false;
  }
}
```

### 4. AgentLoop 集成

#### 4.1 自动应用 ExecutableSkill

```typescript
// src/core/agent/AgentLoop.ts

export class AgentLoop {
  // 现有代码...

  async run(userMessage: string): Promise<void> {
    // ... 现有逻辑 ...

    // === 🆕 在调用 LLM 前，检查是否有可自动应用的 Skill ===
    const context: ExecutionContext = {
      userInput: userMessage,
      task: this.task,
      cwd: process.cwd(),
      files: this.contextBuilder.getRelevantFiles(),
      tools: this.toolRegistry,
      messageHistory: this.messages,
    };

    const matchedSkills = await this.skillRegistry.matchExecutableSkills(context);

    for (const skill of matchedSkills) {
      // 检查前置条件
      if (skill.precondition) {
        const canExecute = await skill.precondition(context);
        if (!canExecute) continue;
      }

      // 执行 Skill
      this.emit('skill:start', { id: skill.id, name: skill.name });

      const result = await skill.execute!(context);

      this.emit('skill:end', { id: skill.id, name: skill.name, result });

      // 检查后置条件
      if (skill.postcondition) {
        const isValid = await skill.postcondition(result);
        if (!isValid) {
          this.log.warn(`Skill ${skill.id} 后置验证失败`);
          continue;
        }
      }

      // 如果执行成功且不需要确认，直接返回结果
      if (result.success && !result.requiresConfirmation) {
        this.emit('text', result.output || '');
        this.emit('end', this.getState());
        return;
      }

      // 如果需要确认，将结果添加到上下文中，继续交给 LLM 处理
      if (result.requiresConfirmation) {
        this.messages.push({
          role: 'user',
          content: [
            {
              type: 'text',
              text: `[Skill ${skill.name} 建议]\n\n${result.output}\n\n是否采纳？`,
            },
          ],
        });
        // 继续执行 LLM 流程
        break;
      }
    }

    // ... 继续现有的 LLM 调用逻辑 ...
  }
}
```

### 5. 用户交互

#### 5.1 CLI 命令

```bash
# 查看可用的 ExecutableSkill
/skills executable

# 查看从教训生成的 Skill
/skills from-lessons

# 手动触发某个 Skill
/skill apply <skill-id>

# 从教训生成 Skill（需要用户确认）
/skill generate <lesson-id>

# 禁用/启用自动应用
/skill auto-apply <skill-id> on|off
```

#### 5.2 GUI 界面

**Skill 管理页面**（新增）：
- 列表显示所有 ExecutableSkill
- 筛选：手动创建 | 从教训生成
- 操作：启用/禁用、编辑、删除、导出
- 详情：查看触发条件、执行逻辑、应用历史

**经验教训页面**（增强）：
- 为已验证的教训添加"生成 Skill"按钮
- 预览生成的 Skill 内容
- 用户确认后保存

## 实现步骤

### Phase 1: 类型定义和基础架构（1 天）

- [ ] 扩展 Skill 类型（ExecutableSkill）
- [ ] 定义 ExecutionContext、ExecutionResult
- [ ] 定义 SkillTrigger
- [ ] 补充 ApplicationRule 类型

### Phase 2: LessonToSkill 转换器（2 天）

- [ ] 实现 LessonToSkillConverter
- [ ] 实现 generateTriggers
- [ ] 实现 generateExecuteFunction
- [ ] 实现 4 种应用方式的执行逻辑
- [ ] 单元测试

### Phase 3: SkillRegistry 增强（1 天）

- [ ] 实现 loadSkillsFromLessons
- [ ] 实现 matchExecutableSkills
- [ ] 实现 checkTrigger
- [ ] 集成测试

### Phase 4: AgentLoop 集成（1 天）

- [ ] 在 run() 中集成 ExecutableSkill 检查
- [ ] 实现 skill:start 和 skill:end 事件
- [ ] 处理 requiresConfirmation 逻辑
- [ ] 端到端测试

### Phase 5: 用户交互（2 天）

- [ ] CLI 命令实现
- [ ] GUI Skill 管理页面
- [ ] 经验教训页面增强"生成 Skill"按钮
- [ ] 用户手册

### Phase 6: 示例 Skill（1 天）

- [ ] 创建 3-5 个示例 ExecutableSkill
- [ ] 文档和教程

## 示例：从教训生成 Skill

### 示例教训

```json
{
  "id": "lesson-001",
  "type": "success",
  "domain": "coding",
  "experience": {
    "title": "使用 npm 而非 yarn 安装依赖",
    "description": "在此项目中，应使用 npm 而非 yarn 安装依赖",
    "impact": "minor",
    "discoveredBy": "user_feedback"
  },
  "context": {
    "task": "安装依赖",
    "userInput": "不是用 yarn，应该用 npm",
    "myAction": "使用 yarn install",
    "files": ["package.json"],
    "toolsUsed": ["bash"],
    "cwd": "/project"
  },
  "applicationRule": {
    "trigger": {
      "keywords": ["安装", "依赖", "install"],
      "toolName": "bash"
    },
    "application": {
      "type": "alternative_tool",
      "action": {
        "recommendedTool": "bash",
        "params": {
          "command": "npm install"
        }
      }
    },
    "confidence": 0.9,
    "autoApply": true
  },
  "verification": {
    "applied": true,
    "verified": true,
    "applicationCount": 3,
    "successCount": 3
  }
}
```

### 生成的 ExecutableSkill

```typescript
{
  id: 'lesson-lesson-001',
  name: '使用 npm 而非 yarn 安装依赖',
  version: '1.0.0',
  description: '在此项目中，应使用 npm 而非 yarn 安装依赖',
  category: 'executable',
  tags: ['coding', 'success', 'auto-generated'],
  source: 'lesson',
  lessonId: 'lesson-001',
  enabled: true,
  priority: 11, // 基础5 + minor1 + 应用次数3 + 成功率5/5

  triggers: [
    {
      type: 'keyword',
      rule: /安装|依赖|install/i,
      priority: 1,
    },
    {
      type: 'tool-failure',
      rule: (context) => {
        const lastTool = context.messageHistory
          ?.filter((m) => m.role === 'assistant' && m.toolCalls)
          .pop()?.toolCalls?.pop();
        return lastTool?.name === 'bash' && lastTool?.status === 'error';
      },
      priority: 2,
    },
  ],

  precondition: async (context) => {
    // 检查是否包含关键词
    return /安装|依赖|install/i.test(context.userInput);
  },

  execute: async (context) => {
    try {
      const tool = context.tools?.get('bash');
      if (!tool) {
        return { success: false, error: '工具 bash 不存在' };
      }

      const result = await tool.execute({ command: 'npm install' });

      return {
        success: true,
        output: `已使用推荐工具 bash 替代，执行成功。\n\n${result}`,
        metadata: { tool: 'bash', originalParams: context.params },
      };
    } catch (err) {
      return {
        success: false,
        error: `工具执行失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },

  postcondition: async (result) => {
    return result.success;
  },
}
```

### 自动应用流程

```
用户输入："安装项目依赖"
    ↓
AgentLoop.run()
    ↓
matchExecutableSkills(context)
    ↓
匹配到 lesson-lesson-001（关键词"安装"）
    ↓
检查 precondition → true
    ↓
执行 skill.execute()
    ↓
调用 bash 工具执行 "npm install"
    ↓
检查 postcondition → true
    ↓
返回结果给用户："已使用推荐工具 bash 替代，执行成功。"
```

## 总结

### 核心改进

1. **Skill 从 Prompt 升级为可执行代码**：真正的技能，而非仅仅是指导
2. **经验教训自动转化为 Skill**：形成闭环，从经验中学习并应用
3. **自动化应用**：在特定场景下自动触发，无需用户干预
4. **生态建设**：支持自定义 Skill 开发和分享

### 价值

1. **效率提升**：重复任务自动化，减少手动操作
2. **质量保证**：基于验证的经验，减少错误
3. **知识复用**：经验教训转化为可复用的技能
4. **持续改进**：Skill 应用效果反馈到经验教训，形成正向循环

---

**参考资料**：
- [OpenClaw Skills Documentation](https://docs.openclaw.ai/tools/skills)
- [What are OpenClaw Skills? A 2026 Developer's Guide](https://www.digitalocean.com/resources/articles/what-are-openclaw-skills)
- [The Top 100+ Agent Skills For OpenClaw](https://www.datacamp.com/blog/top-agent-skills)
- [GitHub - openclaw/openclaw](https://github.com/openclaw/openclaw)

**设计完成时间**：2026-03-15
**设计者**：Claude（Anthropic）+ 用户协作
**项目**：Shibit Xuanji 璇玑
