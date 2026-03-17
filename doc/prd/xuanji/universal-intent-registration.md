# 通用意图注册机制

## 设计目标

**核心理念**：任何模块都可以通过声明元数据字段来实现向量识别的自动发现和注册。

**支持的模块类型**：
- ✅ Skill
- ✅ System Prompt Component
- ✅ MCP Tool
- ✅ Agent（子代理）
- ✅ Custom Module（用户自定义）

**用户体验**：
```typescript
// 任何模块只需实现 IntentRegistrable 接口
export class MyModule implements IntentRegistrable {
  intentMeta = {
    type: 'custom.my-feature',
    domain: 'general',
    trainingExamples: [
      "做某件事",
      "执行某功能"
    ]
  };
  // ...
}

// 重启 → 自动注册到向量系统 ✅
```

---

## 核心架构

### 1. 统一接口设计

```typescript
// src/core/intent/types.ts

/**
 * 意图元数据（通用）
 */
export interface IntentMetadata {
  /** 意图类型（唯一标识） */
  type: string;

  /** 所属领域 */
  domain: 'coding' | 'life' | 'finance' | 'learning' | 'health' | 'general';

  /** 训练样本（5-10 个） */
  trainingExamples: string[];

  /** 意图描述（可选） */
  description?: string;

  /** 意图名称（可选，用于显示） */
  name?: string;

  /** 是否启用意图识别（默认 true） */
  enabled?: boolean;

  /** 优先级（默认 50，数值越大优先级越高） */
  priority?: number;
}

/**
 * 可注册接口（任何模块实现此接口即可被自动发现）
 */
export interface IntentRegistrable {
  /** 意图元数据 */
  intentMeta: IntentMetadata;

  /** 模块类型（用于区分不同模块） */
  moduleType: 'skill' | 'prompt-component' | 'mcp-tool' | 'agent' | 'custom';

  /** 模块 ID */
  id: string;
}

/**
 * 注册回调（当意图被识别时调用）
 */
export type IntentCallback = (context: IntentContext) => Promise<void> | void;

/**
 * 意图上下文
 */
export interface IntentContext {
  /** 用户输入 */
  userInput: string;

  /** 识别到的意图 */
  intent: Intent;

  /** 历史消息 */
  messageHistory: Message[];

  /** 其他上下文 */
  [key: string]: any;
}
```

### 2. 各模块实现示例

#### Skill

```typescript
// src/core/skills/builtin/StockAnalyzerSkill.ts

export class StockAnalyzerSkill implements Skill, IntentRegistrable {
  // IntentRegistrable 接口
  moduleType = 'skill' as const;
  id = 'stock-analyzer';

  intentMeta: IntentMetadata = {
    type: 'finance.stock-analysis',
    domain: 'finance',
    name: '股票分析',
    description: '分析股票行情和走势',
    trainingExamples: [
      '分析茅台股票',
      '腾讯股价怎么样',
      '看看苹果公司走势',
      '这只股票值得买吗',
      '查询股市行情',
    ],
    priority: 80, // 高优先级
  };

  // Skill 接口
  config = {
    autoApply: false,
    triggers: [
      {
        type: 'intent' as const,
        intentTypes: ['finance.stock-analysis'],
      },
    ],
  };

  async execute(context: SkillContext): Promise<SkillResult> {
    // 实现逻辑
  }
}
```

#### System Prompt Component

```typescript
// src/core/prompt/components/FinanceAdvisorComponent.ts

export class FinanceAdvisorComponent implements PromptComponent, IntentRegistrable {
  // IntentRegistrable 接口
  moduleType = 'prompt-component' as const;
  id = 'finance-advisor-identity';

  intentMeta: IntentMetadata = {
    type: 'finance.general',
    domain: 'finance',
    name: '金融顾问身份',
    description: '激活金融顾问的专业身份和能力',
    trainingExamples: [
      '帮我分析投资组合',
      '理财规划建议',
      '如何做资产配置',
      '评估我的财务状况',
      '投资风险分析',
    ],
    priority: 90, // System Prompt 优先级更高
  };

  // PromptComponent 接口
  priority = 100;
  enabled = true;

  async render(context: PromptContext): Promise<string> {
    return `# Xuanji - 金融顾问

你是用户的个人金融顾问，提供专业的投资分析和理财建议。

## 核心能力
- 投资组合分析
- 风险评估
- 理财规划
- 市场分析

## 专业原则
- 数据驱动，理性分析
- 风险提示，不做保证
- 长期视角，价值投资
- 遵守法规，保护隐私`;
  }
}
```

#### MCP Tool

```typescript
// src/mcp/tools/WebSearchTool.ts

export class WebSearchTool implements MCPTool, IntentRegistrable {
  // IntentRegistrable 接口
  moduleType = 'mcp-tool' as const;
  id = 'web-search';

  intentMeta: IntentMetadata = {
    type: 'general.web-search',
    domain: 'general',
    name: '网络搜索',
    description: '在互联网上搜索信息',
    trainingExamples: [
      '搜索最新的新闻',
      '查找相关资料',
      '在网上找找',
      '帮我搜一下',
      '网络查询',
    ],
    priority: 60,
  };

  // MCPTool 接口
  name = 'web_search';
  description = '在互联网上搜索信息';

  async execute(params: WebSearchParams): Promise<WebSearchResult> {
    // 实现逻辑
  }
}
```

#### Agent（子代理）

```typescript
// src/core/agents/CodeReviewAgent.ts

export class CodeReviewAgent implements Agent, IntentRegistrable {
  // IntentRegistrable 接口
  moduleType = 'agent' as const;
  id = 'code-review-agent';

  intentMeta: IntentMetadata = {
    type: 'coding.code-review',
    domain: 'coding',
    name: '代码审查',
    description: '深度审查代码质量、安全性和最佳实践',
    trainingExamples: [
      '审查这段代码',
      '帮我 review 这个 PR',
      '检查代码质量',
      '代码评审',
      '看看这里有没有问题',
    ],
    priority: 70,
  };

  // Agent 接口
  async run(task: string): Promise<AgentResult> {
    // 实现逻辑
  }
}
```

#### Custom Module

```typescript
// ~/.xuanji/modules/CustomGreeter.ts

export class CustomGreeter implements IntentRegistrable {
  moduleType = 'custom' as const;
  id = 'custom-greeter';

  intentMeta: IntentMetadata = {
    type: 'custom.greeting',
    domain: 'general',
    name: '自定义问候',
    description: '识别用户的问候并友好回应',
    trainingExamples: [
      '你好',
      'hello',
      '早上好',
      '嗨',
      '在吗',
    ],
    priority: 40,
  };

  // 自定义处理逻辑
  async handle(context: IntentContext): Promise<string> {
    const hour = new Date().getHours();
    if (hour < 12) return '早上好！';
    if (hour < 18) return '下午好！';
    return '晚上好！';
  }
}
```

---

## 核心组件

### 1. UniversalIntentScanner（通用意图扫描器）

```typescript
// src/core/intent/UniversalIntentScanner.ts

import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { IntentRegistrable, IntentMetadata } from './types.js';

/**
 * 扫描结果
 */
export interface ScanResult {
  /** 意图元数据 */
  intentMeta: IntentMetadata;

  /** 模块实例 */
  module: IntentRegistrable;

  /** 模块类型 */
  moduleType: string;

  /** 模块 ID */
  moduleId: string;

  /** 文件路径 */
  filePath: string;
}

/**
 * 通用意图扫描器
 */
export class UniversalIntentScanner {
  private scanPaths: string[] = [];

  constructor() {
    this.initScanPaths();
  }

  /**
   * 初始化扫描路径
   */
  private initScanPaths(): void {
    this.scanPaths = [
      // 1. Skills
      path.join(__dirname, '../skills/builtin'),
      path.join(os.homedir(), '.xuanji/skills'),
      path.join(process.cwd(), '.xuanji/skills'),

      // 2. System Prompt Components
      path.join(__dirname, '../prompt/components'),
      path.join(os.homedir(), '.xuanji/prompts'),

      // 3. MCP Tools
      path.join(__dirname, '../../mcp/tools'),
      path.join(os.homedir(), '.xuanji/mcp/tools'),

      // 4. Agents
      path.join(__dirname, '../agents'),
      path.join(os.homedir(), '.xuanji/agents'),

      // 5. Custom Modules
      path.join(os.homedir(), '.xuanji/modules'),
      path.join(process.cwd(), '.xuanji/modules'),
    ];
  }

  /**
   * 扫描所有模块
   */
  async scanAll(): Promise<ScanResult[]> {
    const allResults: ScanResult[] = [];

    for (const scanPath of this.scanPaths) {
      const results = await this.scanDirectory(scanPath);
      allResults.push(...results);
    }

    console.log(`✓ 扫描到 ${allResults.length} 个可注册模块`);
    this.logScanSummary(allResults);

    return allResults;
  }

  /**
   * 扫描单个目录
   */
  private async scanDirectory(dirPath: string): Promise<ScanResult[]> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      const results: ScanResult[] = [];

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isFile()) {
          // TypeScript/JavaScript 模块
          if (entry.name.endsWith('.ts') || entry.name.endsWith('.js')) {
            const moduleResults = await this.loadTypeScriptModule(fullPath);
            results.push(...moduleResults);
          }

          // Markdown 模块（OpenClaw 格式）
          if (entry.name === 'skill.md') {
            const result = await this.loadMarkdownModule(fullPath);
            if (result) results.push(result);
          }
        } else if (entry.isDirectory()) {
          // 递归扫描子目录
          const subResults = await this.scanDirectory(fullPath);
          results.push(...subResults);
        }
      }

      return results;
    } catch (err) {
      // 目录不存在，忽略
      return [];
    }
  }

  /**
   * 加载 TypeScript 模块
   */
  private async loadTypeScriptModule(filePath: string): Promise<ScanResult[]> {
    try {
      const fileUrl = pathToFileURL(filePath).href;
      const module = await import(fileUrl);

      const results: ScanResult[] = [];

      // 检查所有导出
      for (const key of Object.keys(module)) {
        const exported = module[key];

        // 跳过非类导出
        if (typeof exported !== 'function') continue;

        // 尝试实例化
        let instance: any;
        try {
          instance = new exported();
        } catch {
          continue; // 不是构造函数
        }

        // 检查是否实现了 IntentRegistrable
        if (this.isIntentRegistrable(instance)) {
          results.push({
            intentMeta: instance.intentMeta,
            module: instance,
            moduleType: instance.moduleType,
            moduleId: instance.id,
            filePath,
          });
        }
      }

      return results;
    } catch (err) {
      console.warn(`⚠️  加载模块 ${filePath} 失败:`, err);
      return [];
    }
  }

  /**
   * 加载 Markdown 模块（OpenClaw 格式）
   */
  private async loadMarkdownModule(filePath: string): Promise<ScanResult | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const { frontmatter } = this.parseMarkdown(content);

      // 提取意图元数据
      if (!frontmatter.intentType || !frontmatter.trainingExamples) {
        return null; // 没有意图配置
      }

      const intentMeta: IntentMetadata = {
        type: frontmatter.intentType,
        domain: frontmatter.domain || 'general',
        name: frontmatter.name,
        description: frontmatter.description,
        trainingExamples: frontmatter.trainingExamples,
        enabled: frontmatter.enabled !== false,
        priority: frontmatter.priority || 50,
      };

      // 创建伪实例（只包含元数据）
      const instance: IntentRegistrable = {
        moduleType: frontmatter.moduleType || 'skill',
        id: frontmatter.id || path.basename(path.dirname(filePath)),
        intentMeta,
      };

      return {
        intentMeta,
        module: instance,
        moduleType: instance.moduleType,
        moduleId: instance.id,
        filePath,
      };
    } catch (err) {
      console.warn(`⚠️  加载 Markdown 模块 ${filePath} 失败:`, err);
      return null;
    }
  }

  /**
   * 判断是否实现了 IntentRegistrable
   */
  private isIntentRegistrable(obj: any): obj is IntentRegistrable {
    return (
      obj &&
      typeof obj === 'object' &&
      'intentMeta' in obj &&
      'moduleType' in obj &&
      'id' in obj &&
      this.isValidIntentMetadata(obj.intentMeta)
    );
  }

  /**
   * 验证意图元数据有效性
   */
  private isValidIntentMetadata(meta: any): meta is IntentMetadata {
    return (
      meta &&
      typeof meta === 'object' &&
      typeof meta.type === 'string' &&
      typeof meta.domain === 'string' &&
      Array.isArray(meta.trainingExamples) &&
      meta.trainingExamples.length >= 3 // 至少 3 个训练样本
    );
  }

  /**
   * 输出扫描摘要
   */
  private logScanSummary(results: ScanResult[]): void {
    const byType = new Map<string, number>();

    for (const result of results) {
      const count = byType.get(result.moduleType) || 0;
      byType.set(result.moduleType, count + 1);
    }

    console.log('模块类型分布:');
    for (const [type, count] of byType.entries()) {
      console.log(`  - ${type}: ${count} 个`);
    }
  }

  /**
   * 解析 Markdown（提取 YAML frontmatter）
   */
  private parseMarkdown(content: string): { frontmatter: any; markdown: string } {
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) {
      return { frontmatter: {}, markdown: content };
    }

    const yaml = require('yaml');
    const frontmatter = yaml.parse(match[1]);
    const markdown = match[2];

    return { frontmatter, markdown };
  }
}
```

### 2. IntentRegistry（意图注册表）

```typescript
// src/core/intent/IntentRegistry.ts

import type { IntentMetadata, IntentRegistrable, IntentCallback } from './types.js';
import type { ScanResult } from './UniversalIntentScanner.js';

/**
 * 注册项
 */
interface RegistryEntry {
  /** 意图元数据 */
  intentMeta: IntentMetadata;

  /** 模块实例 */
  module: IntentRegistrable;

  /** 回调函数（可选） */
  callback?: IntentCallback;
}

/**
 * 意图注册表
 */
export class IntentRegistry {
  // 按 IntentType 索引
  private byIntentType = new Map<string, RegistryEntry[]>();

  // 按 ModuleId 索引
  private byModuleId = new Map<string, RegistryEntry>();

  // 按 ModuleType 索引
  private byModuleType = new Map<string, RegistryEntry[]>();

  /**
   * 批量注册（从扫描结果）
   */
  registerBatch(scanResults: ScanResult[]): void {
    for (const result of scanResults) {
      this.register(result.intentMeta, result.module);
    }

    console.log(`✓ 注册 ${this.byIntentType.size} 个意图类型`);
  }

  /**
   * 注册单个模块
   */
  register(
    intentMeta: IntentMetadata,
    module: IntentRegistrable,
    callback?: IntentCallback
  ): void {
    // 跳过禁用的意图
    if (intentMeta.enabled === false) return;

    const entry: RegistryEntry = { intentMeta, module, callback };

    // 按 IntentType 索引（支持多个模块注册同一个 IntentType）
    const existing = this.byIntentType.get(intentMeta.type) || [];
    existing.push(entry);
    this.byIntentType.set(intentMeta.type, existing);

    // 按 ModuleId 索引
    this.byModuleId.set(module.id, entry);

    // 按 ModuleType 索引
    const byType = this.byModuleType.get(module.moduleType) || [];
    byType.push(entry);
    this.byModuleType.set(module.moduleType, byType);
  }

  /**
   * 获取意图定义列表（用于生成向量）
   */
  getIntentDefinitions(): IntentDefinition[] {
    const intentDefMap = new Map<string, IntentDefinition>();

    for (const [intentType, entries] of this.byIntentType.entries()) {
      // 合并同一 IntentType 的所有训练样本
      const allExamples: string[] = [];
      let firstEntry: RegistryEntry | null = null;

      for (const entry of entries) {
        allExamples.push(...entry.intentMeta.trainingExamples);
        if (!firstEntry) firstEntry = entry;
      }

      // 创建意图定义
      const intentDef: IntentDefinition = {
        type: intentType,
        domain: firstEntry!.intentMeta.domain,
        name: firstEntry!.intentMeta.name || intentType,
        description: firstEntry!.intentMeta.description || '',
        examples: [...new Set(allExamples)], // 去重
      };

      intentDefMap.set(intentType, intentDef);
    }

    return Array.from(intentDefMap.values());
  }

  /**
   * 根据 IntentType 查找模块
   */
  findByIntentType(intentType: string): RegistryEntry[] {
    return this.byIntentType.get(intentType) || [];
  }

  /**
   * 根据 ModuleId 查找模块
   */
  findByModuleId(moduleId: string): RegistryEntry | undefined {
    return this.byModuleId.get(moduleId);
  }

  /**
   * 根据 ModuleType 查找模块
   */
  findByModuleType(moduleType: string): RegistryEntry[] {
    return this.byModuleType.get(moduleType) || [];
  }

  /**
   * 触发意图回调
   */
  async trigger(intentType: string, context: IntentContext): Promise<void> {
    const entries = this.findByIntentType(intentType);

    // 按优先级排序
    const sorted = entries.sort(
      (a, b) => (b.intentMeta.priority || 50) - (a.intentMeta.priority || 50)
    );

    // 执行所有回调
    for (const entry of sorted) {
      if (entry.callback) {
        await entry.callback(context);
      }
    }
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      totalIntentTypes: this.byIntentType.size,
      totalModules: this.byModuleId.size,
      byModuleType: Object.fromEntries(
        Array.from(this.byModuleType.entries()).map(([type, entries]) => [
          type,
          entries.length,
        ])
      ),
    };
  }
}
```

### 3. IntentRouter 集成

```typescript
// src/core/intent/IntentRouter.ts

import { UniversalIntentScanner } from './UniversalIntentScanner.js';
import { IntentRegistry } from './IntentRegistry.js';
import { VectorIntentMatcher } from './VectorIntentMatcher.js';

export class IntentRouter {
  private scanner: UniversalIntentScanner;
  private registry: IntentRegistry;
  private vectorMatcher: VectorIntentMatcher;
  private ruleBasedMatcher: RuleBasedMatcher;

  constructor() {
    this.scanner = new UniversalIntentScanner();
    this.registry = new IntentRegistry();
    this.vectorMatcher = new VectorIntentMatcher();
    this.ruleBasedMatcher = new RuleBasedMatcher();
  }

  /**
   * 初始化（自动发现和注册）
   */
  async init(): Promise<void> {
    console.log('⏳ 初始化意图路由器...');

    // 1. 扫描所有可注册模块
    const scanResults = await this.scanner.scanAll();

    // 2. 批量注册到注册表
    this.registry.registerBatch(scanResults);

    // 3. 获取意图定义列表
    const intentDefinitions = this.registry.getIntentDefinitions();

    // 4. 初始化向量匹配器（自动生成向量）
    await this.vectorMatcher.init(intentDefinitions);

    // 5. 初始化规则匹配器
    await this.ruleBasedMatcher.init(intentDefinitions);

    // 6. 输出统计信息
    const stats = this.registry.getStats();
    console.log('✓ 意图路由器初始化完成:');
    console.log(`  - 意图类型: ${stats.totalIntentTypes}`);
    console.log(`  - 注册模块: ${stats.totalModules}`);
    console.log('  - 模块分布:', stats.byModuleType);
  }

  /**
   * 获取注册表（供其他组件使用）
   */
  getRegistry(): IntentRegistry {
    return this.registry;
  }

  /**
   * 路由用户输入
   */
  async route(userInput: string): Promise<Intent[]> {
    // ... 与之前相同
  }
}
```

### 4. CapabilityAssembler 集成

```typescript
// src/core/intent/CapabilityAssembler.ts

export class CapabilityAssembler {
  private intentRegistry: IntentRegistry;

  constructor(intentRegistry: IntentRegistry) {
    this.intentRegistry = intentRegistry;
  }

  /**
   * 组装能力
   */
  async assemble(intents: Intent[]): Promise<ExecutionPlan> {
    // 1. 提取所有涉及的领域
    const domains = [...new Set(intents.map((i) => i.domain))];

    // 2. 组装 System Prompt（从注册表查找）
    const systemPromptComponents = this.assembleSystemPrompt(intents, domains);

    // 3. 组装 Skills（从注册表查找）
    const activeSkills = this.assembleSkills(intents, domains);

    // 4. 组装 Tools（从注册表查找 MCP Tools）
    const availableTools = this.assembleTools(intents, domains);

    // 5. 合并 Memory Scopes
    const memoryScopes = this.assembleMemoryScopes(domains);

    // 6. 选择 Model
    const modelConfig = this.selectModel(intents, domains);

    return {
      systemPromptComponents,
      activeSkills,
      availableTools,
      memoryScopes,
      modelConfig,
      metadata: {
        intents,
        domains,
        estimatedComplexity: this.estimateComplexity(intents),
      },
    };
  }

  /**
   * 组装 System Prompt（从注册表）
   */
  private assembleSystemPrompt(intents: Intent[], domains: string[]): PromptComponent[] {
    const components: PromptComponent[] = [];

    // 1. 核心组件（始终加载）
    components.push(...this.getCoreComponents());

    // 2. 根据意图类型加载
    for (const intent of intents) {
      const entries = this.intentRegistry.findByIntentType(intent.type);

      for (const entry of entries) {
        if (entry.module.moduleType === 'prompt-component') {
          const component = entry.module as any; // PromptComponent
          if (!components.includes(component)) {
            components.push(component);
          }
        }
      }
    }

    // 3. 按优先级排序
    return components.sort((a, b) => b.priority - a.priority);
  }

  /**
   * 组装 Skills（从注册表）
   */
  private assembleSkills(intents: Intent[], domains: string[]): Skill[] {
    const skills: Skill[] = [];

    // 根据意图类型查找 Skills
    for (const intent of intents) {
      const entries = this.intentRegistry.findByIntentType(intent.type);

      for (const entry of entries) {
        if (entry.module.moduleType === 'skill') {
          const skill = entry.module as any; // Skill
          if (!skills.includes(skill)) {
            skills.push(skill);
          }
        }
      }
    }

    return skills;
  }

  /**
   * 组装 Tools（从注册表）
   */
  private assembleTools(intents: Intent[], domains: string[]): Tool[] {
    const tools: Tool[] = [];

    // 1. 核心工具（始终加载）
    tools.push(...this.getCoreTools());

    // 2. 根据意图类型加载 MCP Tools
    for (const intent of intents) {
      const entries = this.intentRegistry.findByIntentType(intent.type);

      for (const entry of entries) {
        if (entry.module.moduleType === 'mcp-tool') {
          const tool = entry.module as any; // MCPTool
          if (!tools.includes(tool)) {
            tools.push(tool);
          }
        }
      }
    }

    return tools;
  }

  // ... 其他方法
}
```

---

## 完整流程示例

### 场景：新增健康管理功能

#### Step 1: 创建 Skill

```typescript
// src/core/skills/builtin/WorkoutTrackerSkill.ts

export class WorkoutTrackerSkill implements Skill, IntentRegistrable {
  moduleType = 'skill' as const;
  id = 'workout-tracker';

  intentMeta: IntentMetadata = {
    type: 'health.workout-log',
    domain: 'health',
    name: '运动记录',
    description: '记录运动和健身数据',
    trainingExamples: [
      '记录今天跑步 5 公里',
      '今天健身 1 小时',
      '运动打卡',
      '跑了 30 分钟',
      '做了 50 个俯卧撑',
    ],
  };

  async execute(context: SkillContext): Promise<SkillResult> {
    // 实现逻辑
  }
}
```

#### Step 2: 创建 System Prompt Component

```typescript
// src/core/prompt/components/HealthCoachComponent.ts

export class HealthCoachComponent implements PromptComponent, IntentRegistrable {
  moduleType = 'prompt-component' as const;
  id = 'health-coach-identity';

  intentMeta: IntentMetadata = {
    type: 'health.general',
    domain: 'health',
    name: '健康教练身份',
    description: '激活健康管理和运动指导能力',
    trainingExamples: [
      '健身计划',
      '运动建议',
      '健康管理',
      '饮食指导',
      '体重管理',
    ],
    priority: 90,
  };

  priority = 100;
  enabled = true;

  async render(context: PromptContext): Promise<string> {
    return `# Xuanji - 健康教练

你是用户的健康教练，帮助管理运动、饮食和健康。

## 核心能力
- 运动记录和分析
- 健身计划制定
- 饮食建议
- 健康习惯培养`;
  }
}
```

#### Step 3: 创建 MCP Tool（可选）

```typescript
// src/mcp/tools/HealthDataTool.ts

export class HealthDataTool implements MCPTool, IntentRegistrable {
  moduleType = 'mcp-tool' as const;
  id = 'health-data';

  intentMeta: IntentMetadata = {
    type: 'health.data-sync',
    domain: 'health',
    name: '健康数据同步',
    description: '同步健康数据（如 Apple Health）',
    trainingExamples: [
      '同步健康数据',
      '导入运动数据',
      '更新体重数据',
    ],
  };

  name = 'health_data_sync';

  async execute(params: any): Promise<any> {
    // 实现逻辑
  }
}
```

#### Step 4: 重启系统

```bash
npm run dev
```

**系统日志**：
```
⏳ 初始化意图路由器...
✓ 扫描到 18 个可注册模块
模块类型分布:
  - skill: 10 个
  - prompt-component: 5 个
  - mcp-tool: 3 个
✓ 注册 15 个意图类型
⏳ 首次启动，正在构建意图向量库...
  构建向量: 运动记录 (5 个样本)
  构建向量: 健康教练身份 (5 个样本)
  构建向量: 健康数据同步 (3 个样本)
  ...
✓ 意图向量库构建完成（15 个意图）
✓ 意图路由器初始化完成:
  - 意图类型: 15
  - 注册模块: 18
  - 模块分布: { skill: 10, prompt-component: 5, mcp-tool: 3 }
```

#### Step 5: 测试

```bash
> 记录今天跑步 5 公里

# 系统识别过程：
# 1. IntentRouter 识别到 health.workout-log (0.92)
# 2. CapabilityAssembler 查询注册表:
#    - Skill: WorkoutTrackerSkill ✅
#    - System Prompt: HealthCoachComponent ✅
#    - MCP Tool: HealthDataTool ✅
# 3. 组装执行计划并执行

✓ 已记录运动数据:
  - 类型: 跑步
  - 距离: 5 km
  - 用时: 30 分钟
  - 消耗: 350 卡路里
```

---

## CLI 命令

```bash
# 查看所有注册的模块
xuanji intent registry list

# 输出:
# 意图注册表统计:
#   - 意图类型: 15
#   - 注册模块: 18
#
# 模块分布:
#   - skill: 10
#   - prompt-component: 5
#   - mcp-tool: 3
#
# 意图列表:
#   finance.stock-analysis
#     - [skill] stock-analyzer
#   health.workout-log
#     - [skill] workout-tracker
#   health.general
#     - [prompt-component] health-coach-identity
#   health.data-sync
#     - [mcp-tool] health-data
#   ...

# 查看特定意图
xuanji intent registry show health.workout-log

# 输出:
# 意图类型: health.workout-log
# 领域: health
# 训练样本: 5 个
# 注册模块: 1 个
#   - [skill] workout-tracker
#     文件: src/core/skills/builtin/WorkoutTrackerSkill.ts
#     优先级: 50
#     状态: 已启用

# 重新扫描（热加载）
xuanji intent registry rescan
```

---

## 优势总结

### 通用性

| 模块类型 | 之前 | 现在 |
|---------|------|------|
| Skill | 手动配置 | 自动注册 ✅ |
| System Prompt | 硬编码 | 自动注册 ✅ |
| MCP Tool | 独立系统 | 自动注册 ✅ |
| Agent | 不支持 | 自动注册 ✅ |
| Custom | 不支持 | 自动注册 ✅ |

### 核心优势

1. **完全通用**：任何模块都可以声明意图元数据
2. **自动发现**：系统启动时自动扫描所有模块
3. **统一接口**：`IntentRegistrable` 接口简单明了
4. **动态映射**：IntentType → Module 自动建立
5. **优先级支持**：多个模块注册同一意图时按优先级处理
6. **类型安全**：TypeScript 接口保证正确性
7. **扩展友好**：用户可以创建自定义模块

---

## 实施计划

### Phase 1: 核心接口（1天）

- [ ] 定义 `IntentMetadata` 接口
- [ ] 定义 `IntentRegistrable` 接口
- [ ] 实现 `UniversalIntentScanner`
- [ ] 实现 `IntentRegistry`
- [ ] 单元测试

### Phase 2: 集成（1.5天）

- [ ] 集成到 `IntentRouter`
- [ ] 集成到 `CapabilityAssembler`
- [ ] 实现回调机制
- [ ] 集成测试

### Phase 3: 迁移（1.5天）

- [ ] 迁移 Skill 添加 `intentMeta`
- [ ] 迁移 System Prompt Components
- [ ] MCP Tools 集成
- [ ] 回归测试

### Phase 4: CLI 命令（0.5天）

- [ ] `xuanji intent registry list`
- [ ] `xuanji intent registry show`
- [ ] `xuanji intent registry rescan`
- [ ] 文档

### Phase 5: 文档和示例（0.5天）

- [ ] 模块开发指南
- [ ] 意图元数据最佳实践
- [ ] 自定义模块教程

**总计：5天**

---

## 总结

### 核心价值

**通用意图注册机制** = 任何模块 + 声明元数据 + 自动注册

- ✅ **零配置文件**：不需要手动配置 `intent-definitions.json`
- ✅ **代码即配置**：模块自包含所有信息
- ✅ **完全通用**：Skill、Prompt、Tool、Agent 统一机制
- ✅ **自动同步**：新增/修改模块 = 自动更新向量系统
- ✅ **扩展友好**：用户可创建自定义模块并自动集成

### 最简使用

```typescript
// 1. 实现 IntentRegistrable 接口
export class MyModule implements IntentRegistrable {
  moduleType = 'custom';
  id = 'my-feature';
  intentMeta = {
    type: 'custom.my-feature',
    domain: 'general',
    trainingExamples: ["做某事", "执行某功能"]
  };
}

// 2. 重启 → 自动注册 ✅
```

这才是真正的 **Jarvis 体验**！🎉
