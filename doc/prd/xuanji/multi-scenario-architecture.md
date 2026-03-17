# Xuanji 多场景扩展架构设计

## 问题分析

### 当前状态

**Xuanji = 编程助手**：
- System Prompt：专注编程场景
- Skills：git-commit、review-pr
- Tools：Read、Write、Edit、Bash
- Memory：项目代码、技术知识

### 未来需求

**Xuanji = 多场景 AI 助手平台**：
- 🖥️ 编程助手：代码、调试、项目管理
- 🏠 生活助理：日程、提醒、笔记
- 💰 金融顾问：记账、投资分析、理财规划
- 📚 学习伙伴：知识管理、学习计划
- 🏥 健康管家：运动、饮食、睡眠
- ...

### 挑战

1. **System Prompt 冲突**：
   - 编程场景：专业、技术导向
   - 生活场景：友好、生活化

2. **Skills 差异**：
   - 编程：git-commit、code-review
   - 金融：stock-analysis、budget-tracker

3. **Memory 隔离**：
   - 编程记忆：项目代码、技术栈
   - 生活记忆：日程、习惯、偏好

4. **Context 切换**：
   - 用户可能频繁在场景间切换
   - 需要保持上下文连贯性

## 解决方案：Agent Profile 系统

### 核心概念

```
Agent Profile = 完整的 Agent 配置
├── System Prompt Components (系统身份和行为)
├── Skills (可用技能)
├── Tools (可用工具)
├── Memory Scope (记忆范围)
└── Model Config (模型配置)
```

### 架构设计

```
┌─────────────────────────────────────────────────────────┐
│  Profile Manager (配置管理器)                            │
│  ├── coding (默认)                                       │
│  ├── life-assistant                                      │
│  ├── finance-advisor                                     │
│  ├── learning-partner                                    │
│  └── custom-profile-1                                    │
└─────────────────────────────────────────────────────────┘
              ↓ 用户切换 Profile
┌─────────────────────────────────────────────────────────┐
│  Active Profile: coding                                  │
│  ├── System Prompt: coding-identity + project-rules     │
│  ├── Skills: git-commit, review-pr, format-code         │
│  ├── Tools: Read, Write, Edit, Bash, Grep, Glob         │
│  └── Memory: project-memories (isolated)                │
└─────────────────────────────────────────────────────────┘
              ↓ 加载到 AgentLoop
┌─────────────────────────────────────────────────────────┐
│  AgentLoop                                               │
│  └── LLM (Claude / GPT)                                 │
└─────────────────────────────────────────────────────────┘
```

## 实现设计

### 1. AgentProfile 接口

```typescript
// src/core/profile/types.ts

/**
 * Agent Profile：完整的 Agent 配置
 */
export interface AgentProfile {
  /** Profile ID */
  id: string;

  /** Profile 名称 */
  name: string;

  /** 描述 */
  description: string;

  /** 场景类型 */
  scenario: 'coding' | 'life' | 'finance' | 'learning' | 'health' | 'custom';

  /** 图标 */
  icon?: string;

  /** 标签 */
  tags?: string[];

  /** System Prompt 配置 */
  systemPrompt: {
    /** 启用的组件 ID */
    enabledComponents: string[];

    /** 自定义组件 */
    customComponents?: PromptComponent[];
  };

  /** Skill 配置 */
  skills: {
    /** 启用的 Skill ID */
    enabled: string[];

    /** 禁用的 Skill ID */
    disabled: string[];

    /** 自动应用策略 */
    autoApplyMode?: 'always' | 'ask' | 'never';
  };

  /** Tool 配置 */
  tools: {
    /** 启用的工具 */
    enabled: string[];

    /** 受限的工具 */
    restricted: string[];
  };

  /** Memory 配置 */
  memory: {
    /** 记忆作用域（隔离不同 Profile 的记忆） */
    scope: string;

    /** 是否启用长期记忆 */
    enableLongTerm: boolean;

    /** 是否启用经验教训 */
    enableLessons: boolean;
  };

  /** Model 配置 */
  model: {
    /** 模型名称 */
    name: string;

    /** Temperature */
    temperature?: number;

    /** Max tokens */
    maxTokens?: number;

    /** Extended Thinking */
    thinking?: ThinkingConfig;
  };

  /** 创建时间 */
  createdAt: Date;

  /** 更新时间 */
  updatedAt: Date;

  /** 是否为默认 Profile */
  isDefault?: boolean;
}
```

### 2. ProfileManager

```typescript
// src/core/profile/ProfileManager.ts

import type { AgentProfile } from './types';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

/**
 * Profile 管理器
 */
export class ProfileManager {
  private profiles = new Map<string, AgentProfile>();
  private activeProfileId: string | null = null;
  private profilesDir: string;

  constructor() {
    this.profilesDir = path.join(os.homedir(), '.xuanji/profiles');
  }

  /**
   * 初始化（加载所有 Profile）
   */
  async init(): Promise<void> {
    // 加载内置 Profiles
    await this.loadBuiltinProfiles();

    // 加载用户自定义 Profiles
    await this.loadCustomProfiles();

    // 设置默认 Profile
    const defaultProfile = this.findDefault() || this.profiles.get('coding');
    if (defaultProfile) {
      this.activeProfileId = defaultProfile.id;
    }
  }

  /**
   * 加载内置 Profiles
   */
  private async loadBuiltinProfiles(): Promise<void> {
    const builtinProfiles = [
      codingProfile,
      lifeAssistantProfile,
      financeAdvisorProfile,
      learningPartnerProfile,
    ];

    for (const profile of builtinProfiles) {
      this.profiles.set(profile.id, profile);
    }
  }

  /**
   * 加载用户自定义 Profiles
   */
  private async loadCustomProfiles(): Promise<void> {
    try {
      const files = await readdir(this.profilesDir);

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const filePath = path.join(this.profilesDir, file);
        const content = await readFile(filePath, 'utf-8');
        const profile = JSON.parse(content) as AgentProfile;

        this.profiles.set(profile.id, profile);
      }
    } catch (err) {
      // 目录不存在或其他错误，忽略
    }
  }

  /**
   * 切换 Profile
   */
  async switch(profileId: string): Promise<AgentProfile> {
    const profile = this.profiles.get(profileId);

    if (!profile) {
      throw new Error(`Profile ${profileId} 不存在`);
    }

    this.activeProfileId = profileId;

    return profile;
  }

  /**
   * 获取当前激活的 Profile
   */
  getActive(): AgentProfile | null {
    if (!this.activeProfileId) return null;
    return this.profiles.get(this.activeProfileId) || null;
  }

  /**
   * 获取所有 Profiles
   */
  getAll(): AgentProfile[] {
    return Array.from(this.profiles.values());
  }

  /**
   * 创建自定义 Profile
   */
  async create(profile: AgentProfile): Promise<void> {
    this.profiles.set(profile.id, profile);

    // 保存到文件
    const filePath = path.join(this.profilesDir, `${profile.id}.json`);
    await mkdir(this.profilesDir, { recursive: true });
    await writeFile(filePath, JSON.stringify(profile, null, 2), 'utf-8');
  }

  /**
   * 更新 Profile
   */
  async update(profileId: string, updates: Partial<AgentProfile>): Promise<void> {
    const profile = this.profiles.get(profileId);

    if (!profile) {
      throw new Error(`Profile ${profileId} 不存在`);
    }

    const updated = { ...profile, ...updates, updatedAt: new Date() };
    this.profiles.set(profileId, updated);

    // 如果是自定义 Profile，保存到文件
    if (profile.scenario === 'custom') {
      const filePath = path.join(this.profilesDir, `${profileId}.json`);
      await writeFile(filePath, JSON.stringify(updated, null, 2), 'utf-8');
    }
  }

  /**
   * 删除自定义 Profile
   */
  async delete(profileId: string): Promise<void> {
    const profile = this.profiles.get(profileId);

    if (!profile) {
      throw new Error(`Profile ${profileId} 不存在`);
    }

    if (profile.scenario !== 'custom') {
      throw new Error('不能删除内置 Profile');
    }

    this.profiles.delete(profileId);

    // 删除文件
    const filePath = path.join(this.profilesDir, `${profileId}.json`);
    await unlink(filePath);
  }

  /**
   * 查找默认 Profile
   */
  private findDefault(): AgentProfile | undefined {
    return Array.from(this.profiles.values()).find((p) => p.isDefault);
  }
}
```

### 3. 内置 Profiles

#### Coding Profile

```typescript
// src/core/profile/builtin/CodingProfile.ts

export const codingProfile: AgentProfile = {
  id: 'coding',
  name: '编程助手',
  description: '专注于代码开发、调试、项目管理',
  scenario: 'coding',
  icon: '🖥️',
  tags: ['programming', 'development'],
  isDefault: true,

  systemPrompt: {
    enabledComponents: [
      'core-identity',
      'project-rules',
      'memory-context',
      'tool-guidance',
      'security-rules',
    ],
    customComponents: [
      {
        id: 'coding-expertise',
        name: 'Coding Expertise',
        priority: 85,
        enabled: true,
        render: () => `## 编程专长

- **语言**：TypeScript, Python, JavaScript, Go, Rust
- **框架**：React, Vue, Node.js, Django, FastAPI
- **工具**：Git, Docker, VS Code, Vim
- **最佳实践**：Clean Code, SOLID, DRY, KISS`,
      },
    ],
  },

  skills: {
    enabled: [
      'git-commit',
      'review-pr',
      'format-code',
      'run-tests',
    ],
    disabled: [],
    autoApplyMode: 'ask',
  },

  tools: {
    enabled: ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob'],
    restricted: [],
  },

  memory: {
    scope: 'coding',
    enableLongTerm: true,
    enableLessons: true,
  },

  model: {
    name: 'claude-sonnet-4.5',
    temperature: 0.2,
    maxTokens: 8000,
    thinking: { type: 'enabled', budget_tokens: 5000 },
  },

  createdAt: new Date(),
  updatedAt: new Date(),
};
```

#### Life Assistant Profile

```typescript
// src/core/profile/builtin/LifeAssistantProfile.ts

export const lifeAssistantProfile: AgentProfile = {
  id: 'life-assistant',
  name: '生活助理',
  description: '日程管理、提醒、笔记、生活建议',
  scenario: 'life',
  icon: '🏠',
  tags: ['lifestyle', 'personal'],

  systemPrompt: {
    enabledComponents: [
      'core-identity',
      'memory-context',
      'tool-guidance',
    ],
    customComponents: [
      {
        id: 'life-assistant-identity',
        name: 'Life Assistant Identity',
        priority: 100,
        enabled: true,
        render: () => `# Xuanji - 生活助理

你是用户的生活助理，帮助管理日程、提醒事项、记录笔记。

## 核心职责

- **日程管理**：安排和提醒日程
- **任务跟踪**：TODO 管理和进度跟踪
- **笔记整理**：记录和整理想法、笔记
- **生活建议**：提供健康、习惯、效率建议

## 沟通风格

- 友好、温暖、贴心
- 主动提醒和关怀
- 理解用户的生活习惯和偏好`,
      },
    ],
  },

  skills: {
    enabled: [
      'todo-add',
      'todo-list',
      'calendar-add',
      'reminder-set',
      'note-create',
    ],
    disabled: [],
    autoApplyMode: 'always',
  },

  tools: {
    enabled: ['Read', 'Write', 'Bash'], // 受限的工具集
    restricted: ['Edit', 'Grep'], // 不需要代码编辑工具
  },

  memory: {
    scope: 'life',
    enableLongTerm: true,
    enableLessons: false, // 生活场景不需要经验教训
  },

  model: {
    name: 'claude-haiku-4.5', // 使用更快的模型
    temperature: 0.7, // 更高的创造性
    maxTokens: 4000,
  },

  createdAt: new Date(),
  updatedAt: new Date(),
};
```

#### Finance Advisor Profile

```typescript
// src/core/profile/builtin/FinanceAdvisorProfile.ts

export const financeAdvisorProfile: AgentProfile = {
  id: 'finance-advisor',
  name: '金融顾问',
  description: '记账、投资分析、理财规划',
  scenario: 'finance',
  icon: '💰',
  tags: ['finance', 'investment'],

  systemPrompt: {
    enabledComponents: [
      'core-identity',
      'memory-context',
      'tool-guidance',
    ],
    customComponents: [
      {
        id: 'finance-advisor-identity',
        name: 'Finance Advisor Identity',
        priority: 100,
        enabled: true,
        render: () => `# Xuanji - 金融顾问

你是用户的个人金融顾问，提供投资分析和理财建议。

## 核心能力

- **记账跟踪**：收入、支出、分类统计
- **投资分析**：股票、基金、债券分析
- **理财规划**：预算制定、财务目标
- **风险评估**：投资组合风险分析

## 专业原则

- 数据驱动，理性分析
- 风险提示，不做保证
- 长期视角，价值投资
- 遵守法规，保护隐私

## 重要声明

⚠️ 所有建议仅供参考，不构成投资建议。投资有风险，决策需谨慎。`,
      },
    ],
  },

  skills: {
    enabled: [
      'expense-record',
      'budget-analyze',
      'stock-query',
      'portfolio-analyze',
    ],
    disabled: [],
    autoApplyMode: 'ask',
  },

  tools: {
    enabled: ['Read', 'Write', 'Bash'], // 可以调用金融 API
    restricted: ['Edit', 'Grep', 'Glob'],
  },

  memory: {
    scope: 'finance',
    enableLongTerm: true,
    enableLessons: true, // 从投资经验中学习
  },

  model: {
    name: 'claude-opus-4.5', // 使用最强模型
    temperature: 0.1, // 低温度，更准确
    maxTokens: 8000,
    thinking: { type: 'enabled', budget_tokens: 10000 }, // 深度思考
  },

  createdAt: new Date(),
  updatedAt: new Date(),
};
```

### 4. AgentLoop 集成

```typescript
// src/core/agent/AgentLoop.ts

export class AgentLoop {
  private profileManager: ProfileManager;
  private systemPromptBuilder: SystemPromptBuilder;
  private skillRegistry: SkillRegistry;
  private toolRegistry: ToolRegistry;
  private memoryStore: MemoryStore;

  constructor() {
    this.profileManager = new ProfileManager();
  }

  /**
   * 初始化（基于 Profile 配置）
   */
  async init(): Promise<void> {
    await this.profileManager.init();

    // 获取当前激活的 Profile
    const profile = this.profileManager.getActive();

    if (!profile) {
      throw new Error('没有激活的 Profile');
    }

    // 根据 Profile 配置初始化各个组件
    await this.initFromProfile(profile);
  }

  /**
   * 根据 Profile 初始化
   */
  private async initFromProfile(profile: AgentProfile): Promise<void> {
    // 1. 初始化 System Prompt Builder
    this.systemPromptBuilder = new SystemPromptBuilder();

    // 加载启用的组件
    for (const componentId of profile.systemPrompt.enabledComponents) {
      const component = this.findBuiltinComponent(componentId);
      if (component) {
        this.systemPromptBuilder.register(component);
      }
    }

    // 加载自定义组件
    if (profile.systemPrompt.customComponents) {
      for (const component of profile.systemPrompt.customComponents) {
        this.systemPromptBuilder.register(component);
      }
    }

    // 2. 初始化 Skill Registry
    this.skillRegistry = new SkillRegistry();
    await this.skillRegistry.init();

    // 启用/禁用 Skills
    for (const skillId of profile.skills.enabled) {
      this.skillRegistry.enable(skillId);
    }

    for (const skillId of profile.skills.disabled) {
      this.skillRegistry.disable(skillId);
    }

    // 3. 初始化 Tool Registry
    this.toolRegistry = new ToolRegistry();

    // 只注册启用的工具
    for (const toolName of profile.tools.enabled) {
      const tool = this.findBuiltinTool(toolName);
      if (tool) {
        this.toolRegistry.register(tool);
      }
    }

    // 4. 初始化 Memory Store（基于 scope）
    this.memoryStore = new MemoryStore({
      scope: profile.memory.scope,
      enableLongTerm: profile.memory.enableLongTerm,
    });

    // 5. 初始化 Lesson Store
    if (profile.memory.enableLessons) {
      this.lessonStore = new LessonStore({
        scope: profile.memory.scope,
      });
    }

    // 6. 配置 Model
    this.config.model = profile.model.name;
    this.config.temperature = profile.model.temperature;
    this.config.maxTokens = profile.model.maxTokens;
    this.config.thinking = profile.model.thinking;
  }

  /**
   * 切换 Profile
   */
  async switchProfile(profileId: string): Promise<void> {
    const profile = await this.profileManager.switch(profileId);

    // 重新初始化
    await this.initFromProfile(profile);

    this.log.info(`已切换到 Profile: ${profile.name}`);
  }

  // ... 其他方法
}
```

### 5. 用户交互

#### CLI 命令

```bash
# 查看所有 Profiles
/profile list
# - 🖥️  coding (active) - 编程助手
# - 🏠 life-assistant - 生活助理
# - 💰 finance-advisor - 金融顾问
# - 📚 learning-partner - 学习伙伴

# 切换 Profile
/profile switch life-assistant
# ✓ 已切换到：生活助理

# 创建自定义 Profile
/profile create my-writer --based-on=life-assistant
# ✓ 创建成功：my-writer (基于 life-assistant)

# 查看当前 Profile 配置
/profile show
# Profile: coding
# - System Prompt: 5 components
# - Skills: 8 enabled
# - Tools: 6 enabled
# - Memory: scope=coding

# 配置当前 Profile
/profile config skills.autoApplyMode=always
```

#### GUI

**Profile 选择器**（顶部栏）：
```
[🖥️ 编程助手 ▼]  [新建会话]  [设置]
  └── 下拉菜单：
      - 🖥️ 编程助手 ✓
      - 🏠 生活助理
      - 💰 金融顾问
      - 📚 学习伙伴
      - ➕ 创建自定义 Profile
```

**Profile 配置页**（设置界面）：
- 基本信息：名称、描述、图标
- System Prompt：启用/禁用组件
- Skills：启用/禁用技能
- Tools：工具权限
- Memory：记忆作用域
- Model：模型配置

## 使用场景

### 场景 1: 工作日编程

```bash
# 早上打开 Xuanji
xuanji  # 默认 Profile: coding

> 帮我 review 这个 PR
# (使用 coding Profile 的 review-pr Skill)

> 提交代码
# (使用 coding Profile 的 git-commit Skill)
```

### 场景 2: 晚上切换生活助理

```bash
# 下班后切换
/profile switch life-assistant

> 提醒我明天 9 点开会
# (使用 life-assistant Profile 的 reminder-set Skill)

> 记录今天的想法：今天解决了一个难题...
# (使用 life-assistant Profile 的 note-create Skill)
```

### 场景 3: 周末理财规划

```bash
# 周末切换
/profile switch finance-advisor

> 分析一下我的投资组合
# (使用 finance-advisor Profile 的 portfolio-analyze Skill)

> 记录支出：午餐 50 元
# (使用 finance-advisor Profile 的 expense-record Skill)
```

### 场景 4: 创建自定义 Profile

```bash
# 创建写作助手 Profile
/profile create writing-assistant --based-on=life-assistant

# 配置
/profile config systemPrompt.customComponents=[...]
/profile config skills.enabled=['grammar-check', 'style-improve']
/profile config model.name=claude-opus-4.5
```

## 技术亮点

### 1. 完全隔离

- ✅ **Memory 隔离**：不同 Profile 的记忆互不干扰
- ✅ **Skill 隔离**：每个 Profile 只加载需要的 Skills
- ✅ **Tool 隔离**：每个 Profile 只能使用允许的工具

### 2. 灵活配置

- ✅ **内置 + 自定义**：预置常用 Profile，支持自定义
- ✅ **继承机制**：可以基于现有 Profile 创建新 Profile
- ✅ **热切换**：运行时切换 Profile，无需重启

### 3. 性能优化

- ✅ **按需加载**：只加载当前 Profile 需要的组件
- ✅ **配置缓存**：Profile 配置缓存，快速切换
- ✅ **渐进式初始化**：延迟加载非核心组件

### 4. 用户体验

- ✅ **视觉区分**：每个 Profile 有独立图标和颜色
- ✅ **快速切换**：GUI 顶部快速切换菜单
- ✅ **上下文保持**：切换时保留会话历史

## 扩展示例

### 新增健康管家 Profile

```typescript
export const healthManagerProfile: AgentProfile = {
  id: 'health-manager',
  name: '健康管家',
  description: '运动、饮食、睡眠跟踪和健康建议',
  scenario: 'health',
  icon: '🏥',

  systemPrompt: {
    enabledComponents: ['core-identity', 'memory-context'],
    customComponents: [
      {
        id: 'health-manager-identity',
        name: 'Health Manager Identity',
        priority: 100,
        enabled: true,
        render: () => `# Xuanji - 健康管家

你是用户的健康管家，帮助跟踪运动、饮食、睡眠。

## 核心职责
- 运动记录和分析
- 饮食营养跟踪
- 睡眠质量监测
- 健康建议和提醒`,
      },
    ],
  },

  skills: {
    enabled: [
      'workout-log',
      'meal-record',
      'sleep-analyze',
      'health-report',
    ],
    autoApplyMode: 'always',
  },

  tools: {
    enabled: ['Read', 'Write', 'Bash'],
    restricted: [],
  },

  memory: {
    scope: 'health',
    enableLongTerm: true,
    enableLessons: false,
  },

  model: {
    name: 'claude-haiku-4.5',
    temperature: 0.5,
  },

  createdAt: new Date(),
  updatedAt: new Date(),
};
```

### 新增学习伙伴 Profile

```typescript
export const learningPartnerProfile: AgentProfile = {
  id: 'learning-partner',
  name: '学习伙伴',
  description: '知识管理、学习计划、笔记整理',
  scenario: 'learning',
  icon: '📚',

  systemPrompt: {
    enabledComponents: ['core-identity', 'memory-context'],
    customComponents: [
      {
        id: 'learning-partner-identity',
        name: 'Learning Partner Identity',
        priority: 100,
        enabled: true,
        render: () => `# Xuanji - 学习伙伴

你是用户的学习伙伴，帮助制定学习计划、管理知识。

## 核心职责
- 学习计划制定
- 知识笔记整理
- 复习提醒
- 学习进度跟踪

## 方法论
- 费曼学习法
- 间隔重复
- 主动回忆
- 知识图谱`,
      },
    ],
  },

  skills: {
    enabled: [
      'flashcard-create',
      'knowledge-graph',
      'study-plan',
      'spaced-repetition',
    ],
    autoApplyMode: 'ask',
  },

  memory: {
    scope: 'learning',
    enableLongTerm: true,
    enableLessons: true, // 从学习过程中积累经验
  },

  model: {
    name: 'claude-sonnet-4.5',
    temperature: 0.3,
    thinking: { type: 'enabled', budget_tokens: 5000 },
  },

  createdAt: new Date(),
  updatedAt: new Date(),
};
```

## 实施计划

### Phase 1: Profile 系统基础（2天）

- [ ] 定义 `AgentProfile` 接口
- [ ] 实现 `ProfileManager`
- [ ] 创建 4 个内置 Profiles
- [ ] 单元测试

### Phase 2: AgentLoop 集成（1天）

- [ ] 实现 `initFromProfile()`
- [ ] 实现 `switchProfile()`
- [ ] Memory/Lesson 作用域隔离
- [ ] 集成测试

### Phase 3: CLI 命令（0.5天）

- [ ] `/profile list`
- [ ] `/profile switch`
- [ ] `/profile show`
- [ ] `/profile create`

### Phase 4: GUI 界面（1.5天）

- [ ] Profile 选择器（顶部栏）
- [ ] Profile 配置页
- [ ] Profile 创建向导
- [ ] 视觉优化

### Phase 5: 场景 Skills 开发（3天）

- [ ] 生活助理 Skills（2个）
- [ ] 金融顾问 Skills（2个）
- [ ] 学习伙伴 Skills（2个）
- [ ] OpenClaw Skill 集成

### Phase 6: 文档和示例（1天）

- [ ] Profile 创建指南
- [ ] 场景扩展教程
- [ ] 最佳实践文档

**总计：9天**

## 总结

### 核心优势

1. ✅ **场景隔离**：每个场景独立配置，互不干扰
2. ✅ **灵活扩展**：新增场景只需添加 Profile
3. ✅ **用户友好**：快速切换，上下文保持
4. ✅ **开发简单**：Profile 配置化，无需修改核心代码

### 架构价值

- **单一入口**：Xuanji 作为统一平台
- **多场景支持**：编程、生活、金融、学习...
- **模块复用**：Skills、Tools、Memory 跨场景复用
- **生态整合**：OpenClaw Skills 可用于所有场景

---

**设计完成时间**：2026-03-15
**设计者**：Claude（Anthropic）+ 用户协作
**项目**：Shibit Xuanji 璇玑
