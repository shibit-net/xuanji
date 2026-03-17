# 向量意图识别原理详解

## 什么是向量（Embedding）

### 基本概念

**向量**：将文本转换为一串数字，表示文本的**语义**。

```typescript
// 文本
"提醒我明天 9 点开会"

// 转换为向量（384维，简化展示）
[0.23, -0.45, 0.67, 0.12, -0.89, 0.34, ...]
  ↑      ↑      ↑      ↑      ↑      ↑
 时间   提醒   会议   明天   行动   日程
```

### 核心原理

**相似的意思 → 相似的向量**

```
"提醒我明天 9 点开会"    → [0.23, -0.45, 0.67, ...]
"明天 9 点设置闹钟"      → [0.21, -0.43, 0.69, ...]  ← 向量接近
"帮我提交代码"          → [0.87, 0.34, -0.12, ...] ← 向量远离
```

**数学上**：
- 相似度 = 向量的余弦相似度（Cosine Similarity）
- 范围：-1 到 1（越接近 1 越相似）

```typescript
// 计算相似度
similarity("提醒我明天 9 点开会", "明天 9 点设置闹钟") = 0.92  ← 很相似
similarity("提醒我明天 9 点开会", "帮我提交代码") = 0.12      ← 不相似
```

---

## 如何构建意图向量库

### 步骤 1: 定义意图类型

```typescript
// src/core/intent/IntentDefinitions.ts

const intentDefinitions = [
  {
    type: 'schedule.reminder',
    domain: 'life',
    name: '设置提醒',

    // 训练样本（用于生成向量）
    examples: [
      '提醒我明天 9 点开会',
      '明天早上 8 点叫我起床',
      '设置一个闹钟',
      '提醒我下午 3 点给客户打电话',
      '别忘了提醒我交报告',
      '帮我记住明天要买牛奶',
    ]
  },

  {
    type: 'coding.git-commit',
    domain: 'coding',
    name: '提交代码',

    examples: [
      '提交今天的代码',
      '提交这些修改',
      'git commit',
      '把代码提交到仓库',
      '创建一个 commit',
      '保存并提交代码',
    ]
  },

  {
    type: 'coding.review-pr',
    domain: 'coding',
    name: '代码审查',

    examples: [
      '审查这个 PR',
      'review pull request',
      '帮我看看这段代码',
      '检查代码质量',
      '代码评审',
    ]
  },

  {
    type: 'finance.expense-record',
    domain: 'finance',
    name: '记录支出',

    examples: [
      '记录支出 50 元',
      '午餐花了 30 块',
      '记账：买书 100',
      '今天消费 200',
      '记录一笔花费',
    ]
  },

  // ... 更多意图
];
```

### 步骤 2: 生成向量索引

```typescript
// src/core/intent/VectorIntentMatcher.ts

import { pipeline } from '@xenova/transformers';

class VectorIntentMatcher {
  private embedModel: any;
  private intentVectors: Map<string, IntentVector>;

  async init() {
    // 1. 加载 Embedding 模型（本地运行，不需要 API）
    this.embedModel = await pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2'  // 384 维，速度快
    );

    // 2. 为每个意图生成向量
    this.intentVectors = new Map();

    for (const intentDef of intentDefinitions) {
      // 为每个样本生成向量
      const exampleVectors = await Promise.all(
        intentDef.examples.map(text => this.encode(text))
      );

      // 计算平均向量（代表这个意图的"中心"）
      const centroidVector = this.computeCentroid(exampleVectors);

      this.intentVectors.set(intentDef.type, {
        type: intentDef.type,
        domain: intentDef.domain,
        vector: centroidVector,
        exampleVectors: exampleVectors,
      });
    }

    console.log(`✓ 已加载 ${this.intentVectors.size} 个意图向量`);
  }

  /**
   * 将文本转换为向量
   */
  private async encode(text: string): Promise<number[]> {
    const output = await this.embedModel(text, {
      pooling: 'mean',
      normalize: true,
    });

    // 转换为 JavaScript 数组
    return Array.from(output.data);
  }

  /**
   * 计算向量质心（平均）
   */
  private computeCentroid(vectors: number[][]): number[] {
    const dim = vectors[0].length;
    const centroid = new Array(dim).fill(0);

    for (const vector of vectors) {
      for (let i = 0; i < dim; i++) {
        centroid[i] += vector[i];
      }
    }

    for (let i = 0; i < dim; i++) {
      centroid[i] /= vectors.length;
    }

    return centroid;
  }
}
```

### 步骤 3: 意图向量库示例

```typescript
// 初始化后的向量库
intentVectors = Map {
  'schedule.reminder' => {
    type: 'schedule.reminder',
    domain: 'life',
    vector: [0.23, -0.45, 0.67, 0.12, -0.89, ...],  // 384 维
    exampleVectors: [
      [0.21, -0.43, 0.69, ...],  // "提醒我明天 9 点开会"
      [0.25, -0.47, 0.65, ...],  // "明天早上 8 点叫我起床"
      // ... 更多样本向量
    ]
  },

  'coding.git-commit' => {
    type: 'coding.git-commit',
    domain: 'coding',
    vector: [0.87, 0.34, -0.12, 0.56, 0.23, ...],
    exampleVectors: [...]
  },

  'finance.expense-record' => {
    type: 'finance.expense-record',
    domain: 'finance',
    vector: [-0.34, 0.78, 0.23, -0.56, 0.12, ...],
    exampleVectors: [...]
  },

  // ... 更多意图
}
```

---

## 意图匹配流程

### 完整示例

**用户输入**：`"明天 10 点提醒我打电话"`

#### 第 1 步：用户输入转向量

```typescript
const userInput = "明天 10 点提醒我打电话";

// 转换为向量
const userVector = await this.encode(userInput);
// userVector = [0.22, -0.44, 0.68, 0.11, -0.88, ...]
```

#### 第 2 步：计算与所有意图的相似度

```typescript
const similarities = [];

for (const [intentType, intentVector] of this.intentVectors) {
  // 计算余弦相似度
  const similarity = this.cosineSimilarity(userVector, intentVector.vector);

  similarities.push({
    type: intentType,
    domain: intentVector.domain,
    similarity: similarity,
  });
}

// 结果：
similarities = [
  {
    type: 'schedule.reminder',
    domain: 'life',
    similarity: 0.91  ← 最相似！
  },
  {
    type: 'coding.git-commit',
    domain: 'coding',
    similarity: 0.23
  },
  {
    type: 'finance.expense-record',
    domain: 'finance',
    similarity: 0.18
  },
  {
    type: 'coding.review-pr',
    domain: 'coding',
    similarity: 0.15
  },
  // ...
]
```

**余弦相似度计算**：
```typescript
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  // 点积
  let dotProduct = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
  }

  // 模长
  let normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  // 余弦相似度
  return dotProduct / (normA * normB);
}
```

#### 第 3 步：过滤和排序

```typescript
// 只保留相似度 > 0.7 的意图（阈值）
const matched = similarities.filter(s => s.similarity > 0.7);

// 按相似度排序
matched.sort((a, b) => b.similarity - a.similarity);

// 结果：
matched = [
  {
    type: 'schedule.reminder',
    domain: 'life',
    similarity: 0.91  ← 唯一匹配
  }
]
```

#### 第 4 步：返回识别的意图

```typescript
return matched.map(m => ({
  type: m.type,
  domain: m.domain,
  confidence: m.similarity,  // 相似度作为置信度
}));

// 输出：
[
  {
    type: 'schedule.reminder',
    domain: 'life',
    confidence: 0.91
  }
]
```

---

## 向量识别的优势

### 1. 语义理解

**规则匹配**（关键词）：
```typescript
// 只能匹配固定关键词
if (input.includes('提醒')) {
  return 'schedule.reminder';
}

// 无法识别：
"明天别忘了叫我" ❌  // 没有"提醒"关键词
"记得提醒我" ✓      // 有"提醒"关键词
```

**向量匹配**（语义）：
```typescript
// 理解语义，不依赖关键词
"明天别忘了叫我" → similarity = 0.87 ✓  // 语义相似
"记得提醒我" → similarity = 0.89 ✓      // 语义相似
"打电话给我妈妈" → similarity = 0.15 ❌  // 语义不同
```

### 2. 同义词处理

```typescript
// 向量自动理解同义词
"提醒我" → [0.23, -0.45, ...]
"叫我" → [0.22, -0.44, ...]    ← 向量接近
"别忘了" → [0.24, -0.46, ...]  ← 向量接近
"记得" → [0.23, -0.45, ...]    ← 向量接近

// 不需要手动维护同义词词典
```

### 3. 跨语言

```typescript
// 多语言模型可以理解不同语言
"提醒我明天开会" (中文) → [0.23, -0.45, ...]
"remind me tomorrow meeting" (英文) → [0.22, -0.44, ...]  ← 向量接近

// 自动支持多语言，不需要翻译
```

### 4. 泛化能力

```typescript
// 训练样本：
examples = [
  "提醒我明天 9 点开会",
  "设置一个闹钟"
]

// 但可以识别从未见过的表达：
"明天 10 点叫我起床" → similarity = 0.88 ✓  // 泛化能力
"后天提醒我交报告" → similarity = 0.86 ✓
```

---

## 完整实现代码

```typescript
// src/core/intent/VectorIntentMatcher.ts

import { pipeline } from '@xenova/transformers';

interface IntentVector {
  type: string;
  domain: string;
  vector: number[];
  exampleVectors: number[][];
}

export class VectorIntentMatcher {
  private embedModel: any;
  private intentVectors = new Map<string, IntentVector>();

  /**
   * 初始化（加载模型和向量索引）
   */
  async init() {
    console.log('⏳ 加载 Embedding 模型...');

    // 加载本地模型（第一次会下载，之后缓存）
    this.embedModel = await pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2',
      { quantized: true }  // 使用量化模型，更快
    );

    console.log('✓ Embedding 模型加载完成');

    // 构建意图向量索引
    await this.buildIntentIndex();
  }

  /**
   * 构建意图向量索引
   */
  private async buildIntentIndex() {
    const intentDefs = await this.loadIntentDefinitions();

    for (const intentDef of intentDefs) {
      // 为每个样本生成向量
      const exampleVectors = await Promise.all(
        intentDef.examples.map(text => this.encode(text))
      );

      // 计算质心向量
      const centroidVector = this.computeCentroid(exampleVectors);

      this.intentVectors.set(intentDef.type, {
        type: intentDef.type,
        domain: intentDef.domain,
        vector: centroidVector,
        exampleVectors: exampleVectors,
      });
    }

    console.log(`✓ 意图向量索引构建完成（${this.intentVectors.size} 个意图）`);
  }

  /**
   * 匹配意图
   */
  async match(userInput: string, options?: {
    threshold?: number;
    topK?: number;
  }): Promise<Intent[]> {
    const threshold = options?.threshold || 0.7;
    const topK = options?.topK || 3;

    // 1. 用户输入转向量
    const userVector = await this.encode(userInput);

    // 2. 计算与所有意图的相似度
    const similarities: Array<{
      type: string;
      domain: string;
      similarity: number;
    }> = [];

    for (const [intentType, intentVector] of this.intentVectors) {
      const similarity = this.cosineSimilarity(userVector, intentVector.vector);

      similarities.push({
        type: intentType,
        domain: intentVector.domain,
        similarity: similarity,
      });
    }

    // 3. 过滤和排序
    const matched = similarities
      .filter(s => s.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);

    // 4. 转换为 Intent 对象
    return matched.map((m, index) => ({
      id: `intent-vector-${index}`,
      type: m.type,
      domain: m.domain as any,
      confidence: m.similarity,
      text: userInput,
    }));
  }

  /**
   * 编码文本为向量
   */
  private async encode(text: string): Promise<number[]> {
    const output = await this.embedModel(text, {
      pooling: 'mean',
      normalize: true,
    });

    return Array.from(output.data);
  }

  /**
   * 计算余弦相似度
   */
  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    return dotProduct / (normA * normB);
  }

  /**
   * 计算向量质心
   */
  private computeCentroid(vectors: number[][]): number[] {
    if (vectors.length === 0) return [];

    const dim = vectors[0].length;
    const centroid = new Array(dim).fill(0);

    for (const vector of vectors) {
      for (let i = 0; i < dim; i++) {
        centroid[i] += vector[i];
      }
    }

    for (let i = 0; i < dim; i++) {
      centroid[i] /= vectors.length;
    }

    return centroid;
  }

  /**
   * 加载意图定义
   */
  private async loadIntentDefinitions() {
    // 从配置文件或数据库加载
    return intentDefinitions;
  }
}
```

---

## 性能和优化

### 性能数据

| 操作 | 耗时 | 说明 |
|------|------|------|
| 模型加载 | 200-500ms | 第一次启动，之后缓存 |
| 文本编码 | 10-30ms | 单次编码 |
| 相似度计算 | <1ms | 纯数学运算 |
| 完整匹配 | 30-50ms | 包含编码 + 计算 |

### 优化策略

1. **模型选择**
   ```typescript
   // 小模型（快）
   'Xenova/all-MiniLM-L6-v2'  // 384 维，30ms

   // 大模型（准）
   'Xenova/paraphrase-multilingual-mpnet-base-v2'  // 768 维，80ms
   ```

2. **向量缓存**
   ```typescript
   // 缓存用户输入的向量（避免重复编码）
   private userVectorCache = new Map<string, number[]>();

   async encode(text: string): Promise<number[]> {
     if (this.userVectorCache.has(text)) {
       return this.userVectorCache.get(text)!;
     }

     const vector = await this._encode(text);
     this.userVectorCache.set(text, vector);
     return vector;
   }
   ```

3. **批量编码**
   ```typescript
   // 批量处理样本，更快
   const vectors = await this.embedModel(
     intentDef.examples,  // 数组
     { pooling: 'mean', normalize: true }
   );
   ```

---

## 向量 vs 其他方法对比

| 方法 | 优势 | 劣势 | 适用场景 |
|------|------|------|---------|
| **规则匹配** | 快速（<1ms）<br>精确控制 | 无法理解语义<br>需要维护规则 | 固定关键词 |
| **向量匹配** | 语义理解<br>泛化能力强 | 较慢（30-50ms）<br>不够精确 | 多样化表达 |
| **LLM 分类** | 最准确<br>理解复杂语义 | 很慢（1-2s）<br>成本高 | 复杂/模糊输入 |

### 最佳实践：三层结合

```typescript
async route(userInput: string): Promise<Intent[]> {
  // 1. 先尝试规则匹配（最快）
  const ruleIntents = this.matchByRules(userInput);
  if (ruleIntents.length > 0 && ruleIntents[0].confidence > 0.9) {
    return ruleIntents;  // 高置信度，直接返回
  }

  // 2. 尝试向量匹配（中等速度）
  const vectorIntents = await this.matchByVector(userInput);
  if (vectorIntents.length > 0 && vectorIntents[0].confidence > 0.8) {
    return vectorIntents;  // 较高置信度，返回
  }

  // 3. 使用 LLM 分类（最慢但最准）
  return await this.matchByLLM(userInput);
}
```

---

## 实际案例

### 案例 1: 多样化表达

**训练样本**：
```
"提醒我明天 9 点开会"
"设置一个闹钟"
```

**用户输入**（从未见过）：
```typescript
// 测试 1
"明天别忘了叫我起床" → similarity = 0.88 ✓
// 识别为：schedule.reminder

// 测试 2
"后天 10 点提醒我打电话" → similarity = 0.86 ✓
// 识别为：schedule.reminder

// 测试 3
"记得明天去医院" → similarity = 0.79 ✓
// 识别为：schedule.reminder

// 测试 4
"帮我提交代码" → similarity = 0.23 ❌
// 不是 schedule.reminder，是 coding.git-commit
```

### 案例 2: 同义词

```typescript
// 向量自动理解同义词
"记录支出 50 元" → finance.expense-record (0.91)
"花了 50 块" → finance.expense-record (0.87)
"消费 50" → finance.expense-record (0.84)
"买东西花了 50" → finance.expense-record (0.82)
```

### 案例 3: 跨语言

```typescript
// 多语言模型
"提醒我明天开会" (中文) → schedule.reminder (0.91)
"remind me tomorrow meeting" (英文) → schedule.reminder (0.89)
"明日リマインド" (日文) → schedule.reminder (0.85)
```

---

## 总结

### 向量识别的本质

**将语义相似性问题转换为数学问题**：

```
文本 → 向量 → 数学空间中的点

相似的意思 → 相似的向量 → 空间中距离近的点

计算距离 → 余弦相似度 → 识别意图
```

### 核心价值

1. ✅ **语义理解**：不依赖关键词，理解真正的意思
2. ✅ **泛化能力**：可以识别从未见过的表达
3. ✅ **同义词处理**：自动理解同义词
4. ✅ **多语言支持**：一个模型支持多种语言

### 在 Xuanji 中的作用

```
用户输入 → 三层识别
            ├── 规则匹配（快，精确）
            ├── 向量匹配（中，泛化）← 这一层！
            └── LLM 分类（慢，准确）
```

向量匹配是**速度和准确性的最佳平衡点**，是智能意图路由的核心技术。
