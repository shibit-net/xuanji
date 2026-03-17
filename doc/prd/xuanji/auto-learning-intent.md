# 自动学习意图识别机制

## 核心理念

**零配置 + 自动学习 + 渐进增强**

- ✅ 新增模块不需要预先配置意图元数据
- ✅ 第一次使用时，LLM 分析并生成意图
- ✅ 自动将用户输入作为训练样本生成向量
- ✅ 下次自动通过向量匹配命中
- ✅ 使用越多，识别越准确

---

## 完整流程

### 第一次使用（LLM 分析 + 学习）

```
用户输入: "帮我分析茅台股票"
    ↓
┌──────────────────────────────────────┐
│ Step 1: 向量匹配（尝试）              │
│ └── 未命中（向量库为空或无匹配）      │
└──────────────────────────────────────┘
    ↓
┌──────────────────────────────────────┐
│ Step 2: LLM 意图分析                  │
│ ├── 输入：用户输入 + 可用模块列表     │
│ ├── LLM：分析意图，选择模块           │
│ └── 输出：StockAnalyzerSkill (0.95)  │
└──────────────────────────────────────┘
    ↓
┌──────────────────────────────────────┐
│ Step 3: 自动学习（后台异步）          │
│ ├── 创建意图定义                      │
│ │   type: 'skill.stock-analyzer'    │
│ │   domain: 'finance'               │
│ │   trainingExamples: [             │
│ │     "帮我分析茅台股票"              │
│ │   ]                               │
│ ├── 生成向量                          │
│ └── 保存到向量库                      │
└──────────────────────────────────────┘
    ↓
┌──────────────────────────────────────┐
│ Step 4: 执行 StockAnalyzerSkill       │
│ └── 返回股票分析结果                  │
└──────────────────────────────────────┘
```

### 第二次使用（向量匹配 + 自动增强）

```
用户输入: "看看腾讯股票怎么样"
    ↓
┌──────────────────────────────────────┐
│ Step 1: 向量匹配                      │
│ └── 命中：skill.stock-analyzer (0.85)│
└──────────────────────────────────────┘
    ↓
┌──────────────────────────────────────┐
│ Step 2: 直接执行 StockAnalyzerSkill   │
│ └── 返回股票分析结果                  │
└──────────────────────────────────────┘
    ↓
┌──────────────────────────────────────┐
│ Step 3: 增强样本（后台异步）          │
│ ├── 添加新样本：                      │
│ │   "看看腾讯股票怎么样"              │
│ ├── 重新生成向量（质心更新）          │
│ └── 保存到向量库                      │
└──────────────────────────────────────┘
```

### 第 N 次使用（持续优化）

- ✅ 训练样本越来越多
- ✅ 向量越来越准确
- ✅ 识别速度越来越快（向量匹配代替 LLM）
- ✅ 完全自动化，无需人工干预

---

## 核心组件

### 1. LLMIntentClassifier（基于 LLM 的意图分类器）

```typescript
// src/core/intent/LLMIntentClassifier.ts

import type { Intent } from './types.js';
import type { LLMProvider } from '../providers/types.js';

/**
 * 可用模块信息
 */
export interface AvailableModule {
  /** 模块 ID */
  id: string;

  /** 模块名称 */
  name: string;

  /** 模块描述 */
  description: string;

  /** 模块类型 */
  type: 'skill' | 'mcp-tool' | 'agent';

  /** 所属领域（可选） */
  domain?: string;
}

/**
 * LLM 意图分类器
 */
export class LLMIntentClassifier {
  constructor(private llmProvider: LLMProvider) {}

  /**
   * 分析用户输入，选择最合适的模块
   */
  async classify(
    userInput: string,
    availableModules: AvailableModule[]
  ): Promise<Intent[]> {
    // 构建 Prompt
    const prompt = this.buildClassificationPrompt(userInput, availableModules);

    // 调用 LLM
    const response = await this.llmProvider.chat({
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.1, // 低温度，更确定性
      maxTokens: 1000,
    });

    // 解析 LLM 响应
    const intents = this.parseClassificationResult(response.content, availableModules);

    return intents;
  }

  /**
   * 构建分类 Prompt
   */
  private buildClassificationPrompt(
    userInput: string,
    modules: AvailableModule[]
  ): string {
    return `你是一个智能助手的意图识别系统。根据用户输入，选择最合适的模块来处理。

## 用户输入

${userInput}

## 可用模块

${modules
  .map(
    (m, i) => `${i + 1}. **${m.name}** (${m.id})
   - 类型: ${m.type}
   - 描述: ${m.description}
   ${m.domain ? `- 领域: ${m.domain}` : ''}`
  )
  .join('\n\n')}

## 任务

分析用户输入，选择 1-3 个最合适的模块（按优先级排序）。

返回 JSON 格式：
\`\`\`json
[
  {
    "moduleId": "模块 ID",
    "confidence": 0.95,
    "reason": "选择原因（简短）"
  }
]
\`\`\`

要求：
1. confidence 范围 0-1
2. 只返回真正相关的模块
3. 如果没有合适的模块，返回空数组 []
4. reason 用中文，简短说明`;
  }

  /**
   * 解析 LLM 分类结果
   */
  private parseClassificationResult(
    content: string,
    modules: AvailableModule[]
  ): Intent[] {
    try {
      // 提取 JSON（支持 markdown 代码块）
      const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) ||
                        content.match(/\[[\s\S]*\]/);

      if (!jsonMatch) {
        console.warn('LLM 返回格式不正确，无法解析 JSON');
        return [];
      }

      const jsonText = jsonMatch[1] || jsonMatch[0];
      const results = JSON.parse(jsonText);

      // 转换为 Intent 对象
      return results.map((r: any, index: number) => {
        const module = modules.find((m) => m.id === r.moduleId);

        return {
          id: `intent-llm-${index}`,
          type: `${module?.type || 'custom'}.${r.moduleId}`,
          domain: (module?.domain || 'general') as any,
          confidence: r.confidence,
          text: r.reason,
          source: 'llm' as const,
          params: {
            moduleId: r.moduleId,
            reason: r.reason,
          },
        };
      });
    } catch (err) {
      console.error('解析 LLM 分类结果失败:', err);
      return [];
    }
  }
}
```

---

### 2. IntentLearner（意图学习器）

```typescript
// src/core/intent/IntentLearner.ts

import type { Intent, IntentDefinition, IntentDomain } from './types.js';
import type { VectorIntentMatcher } from './VectorIntentMatcher.js';
import type { IntentRegistry } from './IntentRegistry.js';

/**
 * 学习记录
 */
export interface LearningRecord {
  /** 意图类型 */
  intentType: string;

  /** 用户输入（作为训练样本） */
  userInput: string;

  /** 置信度 */
  confidence: number;

  /** 学习时间 */
  learnedAt: number;

  /** 来源（llm/vector） */
  source: 'llm' | 'vector';
}

/**
 * 意图学习器
 *
 * 从用户实际使用中自动学习意图，生成和更新向量
 */
export class IntentLearner {
  private learningHistory: LearningRecord[] = [];
  private learningThreshold = 0.7; // 置信度阈值，高于此值才学习

  constructor(
    private vectorMatcher: VectorIntentMatcher,
    private registry: IntentRegistry
  ) {}

  /**
   * 从 LLM 分类结果中学习（第一次使用）
   */
  async learnFromLLM(
    userInput: string,
    intent: Intent,
    moduleInfo: { id: string; name: string; domain?: string; type: string }
  ): Promise<void> {
    // 只学习高置信度的结果
    if (intent.confidence < this.learningThreshold) {
      console.log(`⚠️  置信度过低 (${intent.confidence})，跳过学习`);
      return;
    }

    const intentType = intent.type;

    console.log(`📚 学习新意图: ${intentType}`);
    console.log(`   样本: "${userInput}"`);
    console.log(`   置信度: ${intent.confidence}`);

    // 1. 检查是否已存在此意图
    const existingDef = this.findIntentDefinition(intentType);

    if (existingDef) {
      // 意图已存在，增强样本
      await this.enhanceIntent(intentType, userInput);
    } else {
      // 创建新意图
      await this.createIntent(intentType, userInput, moduleInfo);
    }

    // 2. 记录学习历史
    this.learningHistory.push({
      intentType,
      userInput,
      confidence: intent.confidence,
      learnedAt: Date.now(),
      source: 'llm',
    });
  }

  /**
   * 从向量匹配中学习（后续使用，增强样本）
   */
  async learnFromVector(userInput: string, intent: Intent): Promise<void> {
    // 只学习高置信度的结果
    if (intent.confidence < this.learningThreshold) {
      return;
    }

    // 增强现有意图
    await this.enhanceIntent(intent.type, userInput);

    // 记录学习历史
    this.learningHistory.push({
      intentType: intent.type,
      userInput,
      confidence: intent.confidence,
      learnedAt: Date.now(),
      source: 'vector',
    });
  }

  /**
   * 创建新意图
   */
  private async createIntent(
    intentType: string,
    userInput: string,
    moduleInfo: { id: string; name: string; domain?: string; type: string }
  ): Promise<void> {
    const intentDef: IntentDefinition = {
      type: intentType,
      domain: (moduleInfo.domain || 'general') as IntentDomain,
      name: moduleInfo.name,
      description: `自动学习: ${moduleInfo.name}`,
      examples: [userInput], // 第一个训练样本
    };

    // 生成向量
    await this.vectorMatcher.buildIntentVector(intentDef);

    console.log(`✓ 创建新意图: ${intentType}`);
  }

  /**
   * 增强现有意图（添加新样本）
   */
  private async enhanceIntent(intentType: string, newSample: string): Promise<void> {
    const intentDef = this.findIntentDefinition(intentType);

    if (!intentDef) {
      console.warn(`⚠️  意图 ${intentType} 不存在，无法增强`);
      return;
    }

    // 检查样本是否已存在（去重）
    if (intentDef.examples.includes(newSample)) {
      return; // 已存在，跳过
    }

    // 添加新样本
    intentDef.examples.push(newSample);

    // 重新生成向量（包含新样本）
    await this.vectorMatcher.buildIntentVector(intentDef);

    console.log(`✓ 增强意图 ${intentType}，新增样本: "${newSample}"`);
    console.log(`  当前样本数: ${intentDef.examples.length}`);
  }

  /**
   * 查找意图定义
   */
  private findIntentDefinition(intentType: string): IntentDefinition | undefined {
    const allDefs = this.registry.getIntentDefinitions();
    return allDefs.find((d) => d.type === intentType);
  }

  /**
   * 获取学习统计
   */
  getStats() {
    return {
      totalLearned: this.learningHistory.length,
      fromLLM: this.learningHistory.filter((r) => r.source === 'llm').length,
      fromVector: this.learningHistory.filter((r) => r.source === 'vector').length,
      uniqueIntents: new Set(this.learningHistory.map((r) => r.intentType)).size,
    };
  }

  /**
   * 获取学习历史
   */
  getHistory(limit: number = 10): LearningRecord[] {
    return this.learningHistory.slice(-limit).reverse();
  }
}
```

---

### 3. IntentRouter 集成自动学习

```typescript
// src/core/intent/IntentRouter.ts

import { UniversalIntentScanner } from './UniversalIntentScanner.js';
import { IntentRegistry } from './IntentRegistry.js';
import { VectorIntentMatcher } from './VectorIntentMatcher.js';
import { LLMIntentClassifier } from './LLMIntentClassifier.js';
import { IntentLearner } from './IntentLearner.js';
import type { Intent, IntentMatchOptions } from './types.js';
import type { LLMProvider } from '../providers/types.js';

export class IntentRouter {
  private scanner: UniversalIntentScanner;
  private registry: IntentRegistry;
  private vectorMatcher: VectorIntentMatcher;
  private llmClassifier: LLMIntentClassifier;
  private learner: IntentLearner;
  private initialized = false;

  constructor(private llmProvider: LLMProvider) {
    this.scanner = new UniversalIntentScanner();
    this.registry = new IntentRegistry();
    this.vectorMatcher = new VectorIntentMatcher();
    this.llmClassifier = new LLMIntentClassifier(llmProvider);
    this.learner = new IntentLearner(this.vectorMatcher, this.registry);
  }

  /**
   * 初始化
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    console.log('⏳ 初始化意图路由器...');

    // 1. 扫描所有可注册模块（有 intentMeta 的）
    const { results: scanResults } = await this.scanner.scanAll();

    // 2. 批量注册
    this.registry.registerBatch(scanResults);

    // 3. 获取意图定义列表
    const intentDefinitions = this.registry.getIntentDefinitions();

    // 4. 初始化向量匹配器
    await this.vectorMatcher.init(intentDefinitions);

    console.log('✓ 意图路由器初始化完成');
    this.initialized = true;
  }

  /**
   * 路由用户输入（自动学习版）
   */
  async route(
    userInput: string,
    availableModules: Array<{ id: string; name: string; description: string; type: string; domain?: string }>,
    options?: IntentMatchOptions
  ): Promise<Intent[]> {
    if (!this.initialized) {
      throw new Error('IntentRouter 未初始化');
    }

    const threshold = options?.threshold || 0.7;

    // ========================================
    // Step 1: 向量匹配（快速）
    // ========================================
    const vectorIntents = await this.vectorMatcher.match(userInput, {
      threshold,
      topK: 3,
    });

    if (vectorIntents.length > 0) {
      console.log(`✓ 向量匹配命中: ${vectorIntents[0].type} (${vectorIntents[0].confidence})`);

      // 异步学习（增强样本）
      this.learner
        .learnFromVector(userInput, vectorIntents[0])
        .catch((err) => console.error('向量学习失败:', err));

      return vectorIntents;
    }

    // ========================================
    // Step 2: LLM 分类（未命中时）
    // ========================================
    console.log('⚠️  向量未命中，使用 LLM 分析...');

    const llmIntents = await this.llmClassifier.classify(userInput, availableModules);

    if (llmIntents.length === 0) {
      console.log('⚠️  LLM 也未识别到意图');
      return [];
    }

    console.log(`✓ LLM 识别: ${llmIntents[0].type} (${llmIntents[0].confidence})`);

    // 异步学习（创建新意图或增强现有意图）
    const topIntent = llmIntents[0];
    const moduleInfo = availableModules.find((m) => m.id === topIntent.params?.moduleId);

    if (moduleInfo) {
      this.learner
        .learnFromLLM(userInput, topIntent, moduleInfo)
        .catch((err) => console.error('LLM 学习失败:', err));
    }

    return llmIntents;
  }

  /**
   * 获取学习统计
   */
  getLearningStats() {
    return this.learner.getStats();
  }

  /**
   * 获取学习历史
   */
  getLearningHistory(limit?: number) {
    return this.learner.getHistory(limit);
  }

  /**
   * 获取注册表
   */
  getRegistry(): IntentRegistry {
    return this.registry;
  }
}
```

---

## 使用示例

### 场景：新增股票分析 Skill（无 intentMeta）

#### Step 1: 创建 Skill（无需配置意图）

```typescript
// src/core/skills/builtin/StockAnalyzerSkill.ts

export class StockAnalyzerSkill implements Skill {
  id = 'stock-analyzer';
  name = '股票分析';
  description = '分析股票数据和走势';
  category = 'workflow';
  version = '1.0.0';
  tags = ['finance', 'stock'];

  // ❌ 不需要 intentMeta！

  async execute(params: any) {
    // 股票分析逻辑
    const symbol = params.symbol || '茅台';
    return `${symbol} 股票分析结果...`;
  }
}
```

#### Step 2: 用户第一次使用

```typescript
// 用户输入
const userInput = "帮我分析茅台股票";

// 系统日志：
// ⚠️  向量未命中，使用 LLM 分析...
// ✓ LLM 识别: skill.stock-analyzer (0.95)
// 📚 学习新意图: skill.stock-analyzer
//    样本: "帮我分析茅台股票"
//    置信度: 0.95
// ✓ 创建新意图: skill.stock-analyzer
//   构建向量: 股票分析 (1 个样本)
// ✓ 执行 StockAnalyzerSkill
```

#### Step 3: 用户第二次使用

```typescript
// 用户输入
const userInput = "看看腾讯股票怎么样";

// 系统日志：
// ✓ 向量匹配命中: skill.stock-analyzer (0.85)
// ✓ 增强意图 skill.stock-analyzer，新增样本: "看看腾讯股票怎么样"
//   当前样本数: 2
// ✓ 执行 StockAnalyzerSkill
```

#### Step 4: 用户第 N 次使用

```typescript
// 用户输入
const userInput = "分析一下苹果公司";

// 系统日志：
// ✓ 向量匹配命中: skill.stock-analyzer (0.88)
// ✓ 执行 StockAnalyzerSkill

// 训练样本已积累到 10+ 个
// 向量识别准确率 > 95%
// 完全不需要 LLM 了！
```

---

## 优势总结

| 特性 | 手动配置 | 适配器 | **自动学习** |
|------|---------|--------|-------------|
| 零配置 | ❌ | ❌ | ✅ |
| 自动优化 | ❌ | ❌ | ✅ |
| 第一次速度 | 快 | 快 | 慢（LLM） |
| 后续速度 | 快 | 快 | **很快（向量）** |
| 准确率 | 固定 | 固定 | **渐进提升** |
| 三方兼容 | ❌ | ✅ | ✅ |
| 维护成本 | 高 | 中 | **低** |

### 核心优势

1. **完全零配置** - 新增任何模块都不需要配置
2. **自动学习** - 从用户实际使用中学习
3. **渐进增强** - 使用越多越准确
4. **完全兼容** - OpenClaw、MCP、第三方都支持
5. **智能降级** - 向量 → LLM，保证可用性

---

## 持久化

### 学习数据保存

```json
// ~/.xuanji/learned-intents.json
{
  "version": "1.0.0",
  "intents": {
    "skill.stock-analyzer": {
      "type": "skill.stock-analyzer",
      "domain": "finance",
      "name": "股票分析",
      "description": "自动学习: 股票分析",
      "examples": [
        "帮我分析茅台股票",
        "看看腾讯股票怎么样",
        "分析一下苹果公司",
        "查询贵州茅台",
        "股价走势分析"
      ],
      "learnedFrom": "llm",
      "createdAt": 1710489600000,
      "lastUpdated": 1710576000000,
      "usageCount": 15
    }
  }
}
```

### 与向量缓存合并

```json
// ~/.xuanji/cache/intent-vectors.json
{
  "version": "1.0.0",
  "generatedAt": 1710576000000,
  "vectors": {
    "skill.stock-analyzer": {
      "type": "skill.stock-analyzer",
      "domain": "finance",
      "vector": [0.23, -0.45, ...],
      "exampleVectors": [...],
      "lastUpdated": 1710576000000,
      "source": "learned"  // 标记为自动学习
    }
  }
}
```

---

## 总结

### 工作流程

```
新增 Skill（无 intentMeta）
    ↓
用户首次使用
    ↓
向量未命中 → LLM 分析
    ↓
自动学习（生成意图 + 向量）
    ↓
用户再次使用
    ↓
向量命中 ✅（快速）
    ↓
持续增强样本
    ↓
识别越来越准确！
```

### 核心价值

**真正的零配置 + 自动优化 + Jarvis 体验**

- ✅ 开发者：专注功能开发，不管意图识别
- ✅ 系统：自动学习，自动优化
- ✅ 用户：无感知，越用越好

这才是真正的智能！🎉
