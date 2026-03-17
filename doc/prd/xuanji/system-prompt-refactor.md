# System Prompt 和 Skills 分离重构

## 问题

**当前设计混淆了两个概念**：

1. **System Prompt Components**（系统 Prompt 组件）：
   - 定义 Agent 的身份、行为准则、上下文
   - 应该始终加载，作为 System Prompt 的一部分
   - 例如：`xuanji-assistant`、`project-rules`、`memory-context`

2. **Skills**（可执行技能）：
   - 提供具体的功能模块
   - 用户可以安装/卸载/启用/禁用
   - 例如：`git-commit`、`todoist-cli`、从经验教训生成的 Skill

## 重构目标

### 明确分层

```
┌─────────────────────────────────────────┐
│  System Prompt (系统提示词)              │
│  ├── Core Identity (核心身份)            │
│  ├── Project Rules (项目规则)            │
│  ├── Memory Context (记忆上下文)         │
│  ├── Tool Guidance (工具指导)            │
│  └── Security Rules (安全规则)           │
└─────────────────────────────────────────┘
              ↓ 始终加载
┌─────────────────────────────────────────┐
│  LLM (Claude / GPT)                     │
└─────────────────────────────────────────┘
              ↓ 按需调用
┌─────────────────────────────────────────┐
│  Skills (可执行技能)                     │
│  ├── Xuanji Skills                      │
│  │   ├── git-commit                     │
│  │   ├── review-pr                      │
│  │   └── format-code (from lessons)     │
│  └── OpenClaw Skills                    │
│      ├── todoist-cli                    │
│      └── database-query                 │
└─────────────────────────────────────────┘
```

## 新架构设计

### 1. SystemPromptBuilder（系统 Prompt 构建器）

```typescript
// src/core/prompt/SystemPromptBuilder.ts

import type { Message } from '@/core/types';

/**
 * System Prompt 组件
 */
interface PromptComponent {
  id: string;
  name: string;
  priority: number; // 数字越大越靠前
  enabled: boolean;

  /**
   * 渲染组件内容
   */
  render(context: PromptContext): Promise<string> | string;
}

/**
 * Prompt 上下文
 */
interface PromptContext {
  cwd: string;
  projectType?: string;
  messageHistory?: Message[];
  relevantMemories?: any[];
  [key: string]: any;
}

/**
 * System Prompt 构建器
 */
export class SystemPromptBuilder {
  private components = new Map<string, PromptComponent>();

  /**
   * 注册组件
   */
  register(component: PromptComponent): void {
    this.components.set(component.id, component);
  }

  /**
   * 构建完整的 System Prompt
   */
  async build(context: PromptContext): Promise<string> {
    const enabledComponents = Array.from(this.components.values())
      .filter((c) => c.enabled)
      .sort((a, b) => b.priority - a.priority); // 按优先级排序

    const parts: string[] = [];

    for (const component of enabledComponents) {
      const content = await component.render(context);
      if (content) {
        parts.push(content);
      }
    }

    return parts.join('\n\n---\n\n');
  }

  /**
   * 启用/禁用组件
   */
  setEnabled(componentId: string, enabled: boolean): void {
    const component = this.components.get(componentId);
    if (component) {
      component.enabled = enabled;
    }
  }

  /**
   * 获取所有组件
   */
  getComponents(): PromptComponent[] {
    return Array.from(this.components.values());
  }
}
```

### 2. 内置 Prompt 组件

#### 核心身份组件

```typescript
// src/core/prompt/components/CoreIdentity.ts

import type { PromptComponent, PromptContext } from '../SystemPromptBuilder';

export const coreIdentityComponent: PromptComponent = {
  id: 'core-identity',
  name: 'Core Identity',
  priority: 100, // 最高优先级
  enabled: true,

  render(): string {
    return `# Xuanji (璇玑) - AI 编程助手

你是 Xuanji（璇玑），Shibit 开发的 AI 编程助手。你的核心能力：

1. **代码理解与生成**：深入理解代码逻辑，生成高质量代码
2. **项目感知**：理解项目结构、技术栈、约定
3. **工具使用**：熟练使用各种工具完成任务
4. **持续学习**：从经验教训中学习，不断改进

## 核心原则

- **准确性优先**：不确定时明确告知，不编造信息
- **上下文感知**：充分利用项目规则、记忆、历史对话
- **工具优先**：能用工具完成的任务，优先使用工具
- **渐进式**：复杂任务分步骤完成，每步确认
- **学习导向**：从成功和失败中学习，积累经验`;
  },
};
```

#### 项目规则组件

```typescript
// src/core/prompt/components/ProjectRules.ts

export const projectRulesComponent: PromptComponent = {
  id: 'project-rules',
  name: 'Project Rules',
  priority: 90,
  enabled: true,

  async render(context: PromptContext): Promise<string> {
    const rules = await loadProjectRules(context.cwd);

    if (!rules || rules.length === 0) {
      return '';
    }

    return `## 项目规则

${rules.join('\n\n')}`;
  },
};
```

#### 记忆上下文组件

```typescript
// src/core/prompt/components/MemoryContext.ts

export const memoryContextComponent: PromptComponent = {
  id: 'memory-context',
  name: 'Memory Context',
  priority: 80,
  enabled: true,

  async render(context: PromptContext): Promise<string> {
    if (!context.relevantMemories || context.relevantMemories.length === 0) {
      return '';
    }

    const memories = context.relevantMemories
      .map((m) => `- ${m.content}`)
      .join('\n');

    return `## 相关记忆

${memories}`;
  },
};
```

#### 工具指导组件

```typescript
// src/core/prompt/components/ToolGuidance.ts

export const toolGuidanceComponent: PromptComponent = {
  id: 'tool-guidance',
  name: 'Tool Guidance',
  priority: 70,
  enabled: true,

  render(): string {
    return `## 工具使用指导

- **Read**：读取文件内容，优先使用而非 bash cat
- **Write**：写入新文件，已存在文件会被覆盖
- **Edit**：精确编辑文件，通过 old_string/new_string 替换
- **Bash**：执行命令，注意安全性
- **Grep**：搜索代码，支持正则表达式
- **Glob**：查找文件，支持 glob 模式`;
  },
};
```

### 3. Skill 系统（重新定义）

```typescript
// src/core/skills/types.ts

/**
 * Skill：可执行的功能模块
 *
 * 注意：Skill 和 System Prompt Component 是不同的概念
 * - Skill：提供具体功能，用户可安装/卸载
 * - System Prompt Component：定义系统行为，始终加载
 */
export interface Skill {
  id: string;
  name: string;
  description: string;
  version?: string;
  author?: string;
  tags?: string[];

  /**
   * 执行 Skill
   */
  execute(context: SkillContext): Promise<SkillResult>;

  /**
   * 配置
   */
  config?: {
    /** 是否自动应用 */
    autoApply?: boolean;

    /** 触发条件 */
    triggers?: SkillTrigger[];

    /** 优先级 */
    priority?: number;

    /** 来源 */
    source?: 'builtin' | 'custom' | 'lesson' | 'openclaw';

    /** 斜杠命令 */
    slashCommand?: string;
  };
}

/**
 * Skill 执行结果
 */
export interface SkillResult {
  type: 'prompt' | 'action' | 'hybrid';
  success: boolean;
  output?: string;
  error?: string;
  needsLLM?: boolean;
  needsConfirmation?: boolean;
  metadata?: Record<string, any>;
}
```

### 4. AgentLoop 集成

```typescript
// src/core/agent/AgentLoop.ts

export class AgentLoop {
  private systemPromptBuilder: SystemPromptBuilder;
  private skillRegistry: SkillRegistry;

  constructor() {
    // 初始化 System Prompt Builder
    this.systemPromptBuilder = new SystemPromptBuilder();
    this.initSystemPrompt();

    // 初始化 Skill Registry
    this.skillRegistry = new SkillRegistry();
  }

  /**
   * 初始化 System Prompt 组件
   */
  private initSystemPrompt(): void {
    this.systemPromptBuilder.register(coreIdentityComponent);
    this.systemPromptBuilder.register(projectRulesComponent);
    this.systemPromptBuilder.register(memoryContextComponent);
    this.systemPromptBuilder.register(toolGuidanceComponent);
    this.systemPromptBuilder.register(securityRulesComponent);
  }

  /**
   * 运行 Agent 循环
   */
  async run(userMessage: string): Promise<void> {
    // 1. 构建 System Prompt
    const systemPrompt = await this.systemPromptBuilder.build({
      cwd: process.cwd(),
      messageHistory: this.messages,
      relevantMemories: await this.memoryStore.retrieve(userMessage),
    });

    // 2. 检查是否有可自动应用的 Skill
    const matchedSkills = await this.skillRegistry.matchSkills({
      userInput: userMessage,
      cwd: process.cwd(),
      tools: this.toolRegistry,
      messageHistory: this.messages,
    });

    for (const skill of matchedSkills) {
      const result = await skill.execute(context);

      // 根据结果类型处理
      if (result.type === 'action' && result.success) {
        this.emit('text', result.output!);
        return;
      }

      if (result.type === 'prompt' || result.type === 'hybrid') {
        // 将 Skill 输出追加到 System Prompt
        systemPrompt += `\n\n## Skill Output\n\n${result.output}`;
      }
    }

    // 3. 构建消息
    this.messages.push({
      role: 'user',
      content: [{ type: 'text', text: userMessage }],
    });

    // 4. 调用 LLM
    const response = await this.provider.chat({
      model: this.config.model,
      messages: [
        { role: 'system', content: systemPrompt }, // System Prompt
        ...this.messages,
      ],
      tools: this.tools,
    });

    // ... 处理响应
  }
}
```

## 对比：重构前 vs 重构后

### 重构前（混乱）

```typescript
// 所有东西都叫 Skill
SkillRegistry {
  skills: {
    'xuanji-assistant',    // 系统 prompt
    'project-rules',       // 系统 prompt
    'memory-context',      // 系统 prompt
    'git-commit',          // 真正的 Skill
    'todoist-cli',         // OpenClaw Skill
  }
}

// 用户看到 /skill list 会很困惑
```

### 重构后（清晰）

```typescript
// 分离两个系统
SystemPromptBuilder {
  components: {
    'core-identity',       // 始终加载
    'project-rules',       // 始终加载
    'memory-context',      // 始终加载
  }
}

SkillRegistry {
  skills: {
    'git-commit',          // 可安装的 Skill
    'todoist-cli',         // OpenClaw Skill
    'npm-install',         // 从经验教训生成
  }
}

// 用户 /skill list 只看到真正的 Skill
```

## 用户界面变化

### 命令行

```bash
# 之前：所有东西混在一起
/skill list
# - xuanji-assistant (???)
# - project-rules (???)
# - git-commit (这是 Skill)

# 之后：清晰分离
/prompt list         # 查看 System Prompt 组件
# - core-identity (enabled)
# - project-rules (enabled)
# - memory-context (enabled)

/skill list          # 查看可执行 Skill
# - git-commit (builtin)
# - todoist-cli (openclaw)
# - npm-install (from lesson-001)
```

### GUI

**System Prompt 配置页**：
- 查看各个组件的内容
- 启用/禁用组件
- 调整优先级

**Skill 管理页**：
- 浏览、安装、卸载 Skill
- 查看 Skill 来源（内置/OpenClaw/教训）
- 启用/禁用自动应用

## 迁移计划

### Phase 1: 创建 SystemPromptBuilder（1天）

- [ ] 定义 `PromptComponent` 接口
- [ ] 实现 `SystemPromptBuilder`
- [ ] 创建 5 个内置组件
- [ ] 单元测试

### Phase 2: 重构 AgentLoop（0.5天）

- [ ] 集成 `SystemPromptBuilder`
- [ ] 移除旧的 Skill 调用逻辑（针对 prompt 类型）
- [ ] 测试 System Prompt 构建

### Phase 3: 清理 SkillRegistry（0.5天）

- [ ] 移除所有 prompt 类型的"伪 Skill"
- [ ] 只保留真正的可执行 Skill
- [ ] 更新文档

### Phase 4: 更新命令和 GUI（1天）

- [ ] 新增 `/prompt` 命令
- [ ] 更新 `/skill` 命令
- [ ] GUI 新增 System Prompt 配置页
- [ ] 更新 Skill 管理页

### Phase 5: 文档更新（0.5天）

- [ ] 更新架构文档
- [ ] 更新用户手册
- [ ] 更新开发指南

**总计：3.5天**

## 优势

### 1. 概念清晰

- ✅ System Prompt = 系统配置
- ✅ Skill = 可执行功能
- ✅ 用户不再困惑

### 2. 管理简单

- ✅ System Prompt 始终加载，无需过滤
- ✅ Skill 按需加载，可灵活管理
- ✅ 两者独立配置

### 3. 性能优化

- ✅ System Prompt 只构建一次
- ✅ Skill 按需执行
- ✅ 减少不必要的判断

### 4. 扩展性强

- ✅ 新增 System Prompt 组件：注册到 Builder
- ✅ 新增 Skill：注册到 Registry
- ✅ 互不影响

## 总结

### 核心改变

> **分离关注点**：System Prompt Components ≠ Skills

- **System Prompt Components**：定义"我是谁"、"我知道什么"
- **Skills**：定义"我能做什么"

### 收益

- ✅ **概念一致**：和 OpenClaw Skill 概念对齐
- ✅ **用户友好**：清晰的分类和管理
- ✅ **开发简单**：职责明确，易于扩展
- ✅ **性能更好**：减少不必要的逻辑

---

**设计完成时间**：2026-03-15
**设计者**：Claude（Anthropic）+ 用户协作
**项目**：Shibit Xuanji 璇玑
