# 意图自动发现和注册机制

## 设计目标

**用户体验**：
```typescript
// 1. 创建新 Skill（声明意图元数据）
export class StockAnalyzerSkill implements Skill {
  meta = {
    id: 'stock-analyzer',
    intentType: 'finance.stock-analysis',
    domain: 'finance',
    trainingExamples: [
      "分析茅台股票",
      "腾讯股价怎么样"
    ]
  }
  // ...
}

// 2. 重启系统 → 自动完成所有工作 ✅
//    - 自动扫描新 Skill
//    - 自动生成意图定义
//    - 自动生成向量
//    - 自动建立映射
```

**核心原则**：
- ✅ Skill/Agent 自描述：意图元数据写在代码中
- ✅ 系统自动发现：启动时扫描所有 Skill/Agent
- ✅ 自动注册：无需手动配置文件
- ✅ 动态映射：IntentType ↔ SkillId 自动建立

---

## 架构设计

### 整体流程

```
系统启动
    ↓
┌──────────────────────────────────────┐
│ SkillScanner（Skill 扫描器）          │
│ ├── 扫描 src/core/skills/*.ts        │
│ ├── 扫描 ~/.xuanji/skills/*.ts       │
│ ├── 扫描 .xuanji/skills/*.md         │
│ └── 提取 Skill 元数据                │
└──────────────────────────────────────┘
    ↓ SkillMetadata[]
┌──────────────────────────────────────┐
│ IntentDefinitionGenerator            │
│ └── 从 Skill 元数据生成意图定义       │
└──────────────────────────────────────┘
    ↓ IntentDefinition[]
┌──────────────────────────────────────┐
│ VectorIntentMatcher                  │
│ ├── 加载 Embedding 模型               │
│ ├── 为每个意图生成向量                │
│ └── 保存到缓存                        │
└──────────────────────────────────────┘
    ↓
向量库就绪 ✅
```

---

## 核心组件

### 1. Skill 元数据接口

```typescript
// src/core/skills/types.ts

/**
 * Skill 意图元数据
 */
export interface SkillIntentMetadata {
  /** Skill ID */
  id: string;

  /** 意图类型（用于向量匹配） */
  intentType: string;

  /** 所属领域 */
  domain: 'coding' | 'life' | 'finance' | 'learning' | 'health' | 'general';

  /** 训练样本（5-10 个） */
  trainingExamples: string[];

  /** 意图描述（可选） */
  description?: string;

  /** 是否启用意图识别（默认 true） */
  enableIntentRecognition?: boolean;
}

/**
 * Skill 接口（扩展）
 */
export interface Skill {
  /** Skill 元数据（新增） */
  meta: SkillIntentMetadata;

  /** Skill 配置 */
  config?: SkillConfig;

  /** 执行方法 */
  execute(context: SkillContext): Promise<SkillResult>;
}
```

### 2. Skill 实现示例

```typescript
// src/core/skills/builtin/StockAnalyzerSkill.ts

import type { Skill, SkillIntentMetadata, SkillContext, SkillResult } from '../types.js';

export class StockAnalyzerSkill implements Skill {
  /**
   * Skill 元数据（自描述）
   */
  meta: SkillIntentMetadata = {
    id: 'stock-analyzer',
    intentType: 'finance.stock-analysis',
    domain: 'finance',
    description: '分析股票行情和走势',

    // 训练样本（系统自动用于生成向量）
    trainingExamples: [
      '分析茅台股票',
      '腾讯股价怎么样',
      '看看苹果公司最近走势',
      '帮我评估特斯拉',
      '这只股票值得买吗',
      '查询最近的股市行情',
      '股市今天涨了吗',
      '大盘怎么样',
    ],
  };

  /**
   * Skill 配置
   */
  config = {
    autoApply: false,
    triggers: [
      {
        type: 'intent' as const,
        intentTypes: ['finance.stock-analysis'],
      },
    ],
  };

  /**
   * 执行逻辑
   */
  async execute(context: SkillContext): Promise<SkillResult> {
    // 提取股票代码/名称
    const stockSymbol = this.extractStockSymbol(context.userInput);

    // 调用 API 获取数据
    const stockData = await this.fetchStockData(stockSymbol);

    // 返回分析结果
    return {
      type: 'hybrid',
      success: true,
      output: this.formatStockAnalysis(stockData),
      needsLLM: true, // 需要 LLM 生成自然语言分析
      metadata: { stockData },
    };
  }

  // ... 其他方法
}
```

### 3. SkillScanner（Skill 扫描器）

```typescript
// src/core/skills/SkillScanner.ts

import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Skill, SkillIntentMetadata } from './types.js';

/**
 * Skill 扫描器：自动发现和加载 Skills
 */
export class SkillScanner {
  private scanPaths: string[] = [];

  constructor() {
    this.initScanPaths();
  }

  /**
   * 初始化扫描路径
   */
  private initScanPaths(): void {
    this.scanPaths = [
      // 1. 内置 Skills
      path.join(__dirname, 'builtin'),

      // 2. 用户全局 Skills
      path.join(os.homedir(), '.xuanji/skills'),

      // 3. 项目级 Skills
      path.join(process.cwd(), '.xuanji/skills'),
    ];
  }

  /**
   * 扫描所有 Skills
   */
  async scanAll(): Promise<SkillIntentMetadata[]> {
    const allMetadata: SkillIntentMetadata[] = [];

    for (const scanPath of this.scanPaths) {
      const metadata = await this.scanDirectory(scanPath);
      allMetadata.push(...metadata);
    }

    console.log(`✓ 扫描到 ${allMetadata.length} 个 Skills`);
    return allMetadata;
  }

  /**
   * 扫描单个目录
   */
  private async scanDirectory(dirPath: string): Promise<SkillIntentMetadata[]> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      const metadata: SkillIntentMetadata[] = [];

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isFile()) {
          // TypeScript/JavaScript Skill
          if (entry.name.endsWith('.ts') || entry.name.endsWith('.js')) {
            const skillMeta = await this.loadTypeScriptSkill(fullPath);
            if (skillMeta) metadata.push(skillMeta);
          }

          // OpenClaw Skill (Markdown)
          if (entry.name === 'skill.md') {
            const skillMeta = await this.loadOpenClawSkill(fullPath);
            if (skillMeta) metadata.push(skillMeta);
          }
        }
      }

      return metadata;
    } catch (err) {
      // 目录不存在，忽略
      return [];
    }
  }

  /**
   * 加载 TypeScript Skill
   */
  private async loadTypeScriptSkill(filePath: string): Promise<SkillIntentMetadata | null> {
    try {
      // 动态导入
      const fileUrl = pathToFileURL(filePath).href;
      const module = await import(fileUrl);

      // 查找导出的 Skill 类
      const SkillClass = this.findSkillClass(module);
      if (!SkillClass) return null;

      // 实例化
      const skill: Skill = new SkillClass();

      // 验证元数据
      if (!skill.meta || !this.isValidMetadata(skill.meta)) {
        console.warn(`⚠️  Skill ${filePath} 元数据无效，跳过`);
        return null;
      }

      // 返回元数据
      return skill.meta;
    } catch (err) {
      console.warn(`⚠️  加载 Skill ${filePath} 失败:`, err);
      return null;
    }
  }

  /**
   * 加载 OpenClaw Skill
   */
  private async loadOpenClawSkill(filePath: string): Promise<SkillIntentMetadata | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');

      // 解析 YAML frontmatter
      const { frontmatter } = this.parseMarkdown(content);

      // 提取意图元数据
      const meta: SkillIntentMetadata = {
        id: frontmatter.id || path.basename(path.dirname(filePath)),
        intentType: frontmatter.intentType || 'general.unknown',
        domain: frontmatter.domain || 'general',
        description: frontmatter.description,
        trainingExamples: frontmatter.trainingExamples || [],
        enableIntentRecognition: frontmatter.enableIntentRecognition !== false,
      };

      // 验证
      if (!this.isValidMetadata(meta)) {
        console.warn(`⚠️  OpenClaw Skill ${filePath} 元数据无效，跳过`);
        return null;
      }

      return meta;
    } catch (err) {
      console.warn(`⚠️  加载 OpenClaw Skill ${filePath} 失败:`, err);
      return null;
    }
  }

  /**
   * 查找导出的 Skill 类
   */
  private findSkillClass(module: any): any {
    // 1. 默认导出
    if (module.default && this.isSkillClass(module.default)) {
      return module.default;
    }

    // 2. 命名导出（查找实现了 Skill 接口的类）
    for (const key of Object.keys(module)) {
      const exported = module[key];
      if (this.isSkillClass(exported)) {
        return exported;
      }
    }

    return null;
  }

  /**
   * 判断是否为 Skill 类
   */
  private isSkillClass(obj: any): boolean {
    // 必须是类（构造函数）
    if (typeof obj !== 'function') return false;

    // 尝试实例化
    try {
      const instance = new obj();
      return typeof instance.execute === 'function' && 'meta' in instance;
    } catch {
      return false;
    }
  }

  /**
   * 验证元数据有效性
   */
  private isValidMetadata(meta: SkillIntentMetadata): boolean {
    return (
      !!meta.id &&
      !!meta.intentType &&
      !!meta.domain &&
      Array.isArray(meta.trainingExamples) &&
      meta.trainingExamples.length >= 3 // 至少 3 个训练样本
    );
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

### 4. IntentDefinitionGenerator（意图定义生成器）

```typescript
// src/core/intent/IntentDefinitionGenerator.ts

import type { SkillIntentMetadata } from '../skills/types.js';
import type { IntentDefinition } from './types.js';

/**
 * 意图定义生成器：从 Skill 元数据生成意图定义
 */
export class IntentDefinitionGenerator {
  /**
   * 从 Skill 元数据生成意图定义
   */
  generate(skillMetadataList: SkillIntentMetadata[]): IntentDefinition[] {
    const intentMap = new Map<string, IntentDefinition>();

    for (const meta of skillMetadataList) {
      // 跳过禁用意图识别的 Skill
      if (meta.enableIntentRecognition === false) continue;

      // 检查是否已存在（多个 Skill 可能共享同一个 IntentType）
      if (intentMap.has(meta.intentType)) {
        // 合并训练样本
        const existing = intentMap.get(meta.intentType)!;
        existing.examples.push(...meta.trainingExamples);
        continue;
      }

      // 创建新的意图定义
      const intentDef: IntentDefinition = {
        type: meta.intentType,
        domain: meta.domain,
        name: meta.description || this.generateName(meta.intentType),
        description: meta.description || '',
        examples: [...meta.trainingExamples],
      };

      intentMap.set(meta.intentType, intentDef);
    }

    // 去重训练样本
    for (const intentDef of intentMap.values()) {
      intentDef.examples = [...new Set(intentDef.examples)];
    }

    console.log(`✓ 生成 ${intentMap.size} 个意图定义`);
    return Array.from(intentMap.values());
  }

  /**
   * 从 IntentType 生成名称
   */
  private generateName(intentType: string): string {
    // 'finance.stock-analysis' → '股票分析'
    const parts = intentType.split('.');
    const name = parts[parts.length - 1];
    return name
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
}
```

### 5. IntentRouter 集成

```typescript
// src/core/intent/IntentRouter.ts

import { SkillScanner } from '../skills/SkillScanner.js';
import { IntentDefinitionGenerator } from './IntentDefinitionGenerator.js';
import { VectorIntentMatcher } from './VectorIntentMatcher.js';

export class IntentRouter {
  private skillScanner: SkillScanner;
  private intentGenerator: IntentDefinitionGenerator;
  private vectorMatcher: VectorIntentMatcher;
  private ruleBasedMatcher: RuleBasedMatcher;

  constructor() {
    this.skillScanner = new SkillScanner();
    this.intentGenerator = new IntentDefinitionGenerator();
    this.vectorMatcher = new VectorIntentMatcher();
    this.ruleBasedMatcher = new RuleBasedMatcher();
  }

  /**
   * 初始化（自动发现和注册）
   */
  async init(): Promise<void> {
    console.log('⏳ 初始化意图路由器...');

    // 1. 扫描所有 Skills
    const skillMetadataList = await this.skillScanner.scanAll();

    // 2. 生成意图定义
    const intentDefinitions = this.intentGenerator.generate(skillMetadataList);

    // 3. 初始化向量匹配器（自动生成向量）
    await this.vectorMatcher.init(intentDefinitions);

    // 4. 初始化规则匹配器
    await this.ruleBasedMatcher.init(intentDefinitions);

    console.log('✓ 意图路由器初始化完成');
  }

  /**
   * 路由用户输入
   */
  async route(userInput: string): Promise<Intent[]> {
    const intents: Intent[] = [];

    // 1. 规则匹配（快速）
    const ruleIntents = this.ruleBasedMatcher.match(userInput);
    intents.push(...ruleIntents);

    // 2. 向量匹配（语义）
    const vectorIntents = await this.vectorMatcher.match(userInput);
    intents.push(...vectorIntents);

    // 3. LLM 分类（备用）
    if (this.needsLLMClassification(userInput, intents)) {
      const llmIntents = await this.matchByLLM(userInput);
      intents.push(...llmIntents);
    }

    // 4. 去重、排序
    return this.deduplicate(intents).sort((a, b) => b.confidence - a.confidence);
  }

  // ... 其他方法
}
```

### 6. CapabilityAssembler 动态映射

```typescript
// src/core/intent/CapabilityAssembler.ts

export class CapabilityAssembler {
  private intentToSkillMap = new Map<string, string>();

  /**
   * 初始化（自动建立映射）
   */
  async init(skillMetadataList: SkillIntentMetadata[]): Promise<void> {
    // 自动建立 IntentType → SkillId 映射
    for (const meta of skillMetadataList) {
      this.intentToSkillMap.set(meta.intentType, meta.id);
    }

    console.log(`✓ 建立 ${this.intentToSkillMap.size} 个意图映射`);
  }

  /**
   * 组装 Skills（使用动态映射）
   */
  private assembleSkills(intents: Intent[], domains: string[]): Skill[] {
    const skills: Skill[] = [];

    // 1. 根据意图精确匹配（使用动态映射）
    for (const intent of intents) {
      const skillId = this.intentToSkillMap.get(intent.type);
      if (skillId) {
        const skill = this.skillRegistry.get(skillId);
        if (skill) skills.push(skill);
      }
    }

    // 2. 加载领域相关的 Skills
    // ...

    return skills;
  }

  // ... 其他方法
}
```

---

## OpenClaw Skill 示例

```markdown
<!-- ~/.xuanji/skills/health/workout-tracker/skill.md -->

---
id: workout-tracker
intentType: health.workout-log
domain: health
description: 记录运动和健身数据
enableIntentRecognition: true
trainingExamples:
  - 记录今天跑步 5 公里
  - 今天健身 1 小时
  - 运动打卡
  - 跑了 30 分钟
  - 做了 50 个俯卧撑
  - 记录锻炼
---

# 运动跟踪 Skill

## 功能

记录用户的运动数据，包括：
- 跑步距离和时间
- 健身类型和时长
- 运动强度和消耗

## 使用

```bash
> 记录今天跑步 5 公里
✓ 已记录：跑步 5km，用时 30 分钟，消耗 350 卡路里
```

## 脚本

```typescript
// scripts/log-workout.ts
export async function logWorkout(data: WorkoutData) {
  // ...
}
```
```

---

## 完整流程示例

### 场景：新增股票分析 Skill

#### Step 1: 创建 Skill 文件

```typescript
// src/core/skills/builtin/StockAnalyzerSkill.ts

export class StockAnalyzerSkill implements Skill {
  meta = {
    id: 'stock-analyzer',
    intentType: 'finance.stock-analysis',
    domain: 'finance',
    trainingExamples: [
      '分析茅台股票',
      '腾讯股价怎么样',
      '看看苹果公司走势',
      '这只股票值得买吗',
      '查询股市行情',
    ],
  };

  config = {
    autoApply: false,
    triggers: [{ type: 'intent', intentTypes: ['finance.stock-analysis'] }],
  };

  async execute(context: SkillContext): Promise<SkillResult> {
    // 实现逻辑
  }
}
```

#### Step 2: 重启系统

```bash
npm run dev
```

**系统启动日志**：
```
⏳ 初始化意图路由器...
✓ 扫描到 12 个 Skills
✓ 生成 12 个意图定义
⏳ 首次启动，正在构建意图向量库...
  构建向量: 股票分析 (5 个样本)
  构建向量: 代码提交 (7 个样本)
  ...
✓ 意图向量库构建完成（12 个意图）
✓ 建立 12 个意图映射
✓ 意图路由器初始化完成
```

#### Step 3: 测试

```bash
> 分析一下茅台股票

# 系统日志：
# IntentRouter: 识别到意图 finance.stock-analysis (0.92)
# CapabilityAssembler: 激活 Skill stock-analyzer
# 执行 StockAnalyzerSkill...

✓ 茅台（600519）当前价格: ¥1,850.00
  涨跌幅: +2.5%
  市值: ¥2.3 万亿
  ...
```

#### Step 4: 查看向量缓存

```bash
cat ~/.xuanji/cache/intent-vectors.json
```

```json
{
  "version": "1.0.0",
  "generatedAt": 1710489600000,
  "vectors": {
    "finance.stock-analysis": {
      "type": "finance.stock-analysis",
      "domain": "finance",
      "vector": [0.23, -0.45, 0.67, ...],
      "exampleVectors": [
        [0.21, -0.43, 0.69, ...],
        [0.25, -0.47, 0.65, ...],
        ...
      ],
      "lastUpdated": 1710489600000
    },
    // ... 其他意图
  }
}
```

---

## 优势总结

### 对比：手动 vs 自动

| 维度 | 手动配置 | 自动发现 |
|------|---------|---------|
| **配置文件** | 需要编辑 `intent-definitions.json` | 不需要 ✅ |
| **映射关系** | 需要配置 `intentTypeToSkillId()` | 自动建立 ✅ |
| **新增 Skill** | 3 个文件（Skill + 意图定义 + 映射） | 1 个文件（Skill）✅ |
| **容易出错** | 手动同步，容易忘记 | 自动同步 ✅ |
| **OpenClaw** | 需要手动转换 | 自动兼容 ✅ |

### 核心优势

1. **零配置**：Skill 自描述，无需额外配置文件
2. **自动同步**：代码即配置，添加 Skill = 自动注册意图
3. **类型安全**：TypeScript 接口强制要求元数据
4. **扩展友好**：用户/项目级 Skills 自动发现
5. **OpenClaw 兼容**：Markdown Skill 无缝集成

---

## 实施计划

### Phase 1: 核心机制（2天）

- [ ] 定义 `SkillIntentMetadata` 接口
- [ ] 实现 `SkillScanner`（TypeScript + OpenClaw）
- [ ] 实现 `IntentDefinitionGenerator`
- [ ] 单元测试

### Phase 2: 集成（1天）

- [ ] 集成到 `IntentRouter.init()`
- [ ] 集成到 `CapabilityAssembler.init()`
- [ ] 动态映射机制
- [ ] 集成测试

### Phase 3: 迁移（1天）

- [ ] 迁移现有 Skill 添加 `meta` 字段
- [ ] 删除 `intent-definitions.json`
- [ ] 删除 `intentTypeToSkillId()` 硬编码
- [ ] 回归测试

### Phase 4: 文档（0.5天）

- [ ] Skill 开发指南
- [ ] 意图元数据最佳实践
- [ ] OpenClaw Skill 转换指南

**总计：4.5天**

---

## 总结

### 用户体验

**之前**（手动配置）：
```typescript
// 1. 创建 Skill
export class StockAnalyzerSkill { ... }

// 2. 编辑 intent-definitions.json
{
  "type": "finance.stock-analysis",
  "examples": [...]
}

// 3. 编辑 CapabilityAssembler.ts
'finance.stock-analysis': 'stock-analyzer'
```

**现在**（自动发现）：
```typescript
// 1. 创建 Skill（包含元数据）
export class StockAnalyzerSkill implements Skill {
  meta = {
    id: 'stock-analyzer',
    intentType: 'finance.stock-analysis',
    domain: 'finance',
    trainingExamples: [...]
  };
  // ...
}

// 2. 重启 → 完成 ✅
```

### 核心价值

- ✅ **真正的零配置**：Skill 自包含所有信息
- ✅ **代码即配置**：单一信息源，避免不同步
- ✅ **自动扩展**：新增 Skill = 自动获得意图识别
- ✅ **开发友好**：专注于 Skill 逻辑，无需关心配置

**设计完成**：2026-03-15
