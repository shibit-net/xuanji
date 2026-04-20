# Embedding 详解

## 📚 什么是 Embedding？

**Embedding（嵌入/向量化）** 是将文本转换为数字向量的技术，让计算机能够"理解"文本的语义。

### 简单类比

```
文本："写一个用户登录接口"
  ↓ Embedding
向量：[0.23, -0.45, 0.67, 0.12, ..., 0.89]  // 通常是 768 或 1536 维
```

就像把文字翻译成计算机能理解的"数字语言"。

---

## 🎯 核心概念

### 1. 向量表示

```typescript
// 原始文本
const text1 = "写一个登录接口";
const text2 = "实现用户登录功能";
const text3 = "今天天气真好";

// Embedding 后（简化为 3 维）
const vector1 = [0.8, 0.6, 0.1];  // 登录相关
const vector2 = [0.7, 0.5, 0.2];  // 登录相关（相似）
const vector3 = [0.1, 0.2, 0.9];  // 天气相关（不相似）
```

### 2. 语义相似度

**关键特性：** 语义相似的文本，向量也相似

```typescript
// 计算余弦相似度
similarity(vector1, vector2) = 0.95  // 很相似
similarity(vector1, vector3) = 0.12  // 不相似
```

---

## 🔍 Embedding 的工作原理

### 流程图

```
文本输入
  ↓
分词（Tokenization）
  "写一个登录接口" → ["写", "一个", "登录", "接口"]
  ↓
Embedding 模型（神经网络）
  - BERT
  - Sentence-BERT
  - OpenAI text-embedding-ada-002
  - BGE（中文优化）
  ↓
向量输出
  [0.23, -0.45, 0.67, ..., 0.89]  // 768 维或 1536 维
```

### 示例代码

```typescript
// 使用 OpenAI Embedding API
async function getEmbedding(text: string): Promise<number[]> {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'text-embedding-ada-002',
      input: text,
    }),
  });

  const data = await response.json();
  return data.data[0].embedding; // [0.23, -0.45, ..., 0.89]
}

// 使用
const vector1 = await getEmbedding("写一个登录接口");
const vector2 = await getEmbedding("实现用户登录功能");

// 计算相似度
const similarity = cosineSimilarity(vector1, vector2);
console.log(similarity); // 0.95（很相似）
```

---

## 📊 Embedding 在 xuanji 中的应用

### 当前使用场景

#### 1. 场景识别（IntentAnalyzer）

```typescript
// src/core/prompt/IntentAnalyzer.ts

// 初始化时：预计算场景的 Embedding
async init(): Promise<void> {
  for (const [scene, config] of this.sceneConfigs) {
    const embedding = await this.embeddingService.embed(config.description);
    this.sceneEmbeddings.set(scene, embedding);
  }
}

// 运行时：计算用户输入的 Embedding，找最相似的场景
async matchScene(userMessage: string): Promise<SceneType | null> {
  // 1. 规则匹配（优先）
  for (const [scene, config] of this.sceneConfigs) {
    if (config.keywords.test(userMessage)) {
      return scene; // 规则匹配成功，直接返回
    }
  }

  // 2. Embedding 匹配（降级）
  if (this.embeddingService) {
    const queryEmbedding = await this.embeddingService.embed(userMessage);
    
    let bestMatch = null;
    for (const [scene, sceneEmb] of this.sceneEmbeddings) {
      const similarity = cosineSimilarity(queryEmbedding, sceneEmb);
      if (similarity >= 0.3 && (!bestMatch || similarity > bestMatch.similarity)) {
        bestMatch = { scene, similarity };
      }
    }
    
    if (bestMatch) return bestMatch.scene;
  }

  // 3. 默认场景
  return 'coding';
}
```

#### 2. 意图识别（IntentRouter）

```typescript
// src/core/intent/VectorIntentMatcher.ts

// 向量匹配意图
async match(userInput: string): Promise<Intent[]> {
  // 1. 计算用户输入的 Embedding
  const queryEmbedding = await this.embeddingService.embed(userInput);

  // 2. 与所有意图的 Embedding 计算相似度
  const matches = [];
  for (const [intentType, intentEmbedding] of this.intentEmbeddings) {
    const similarity = cosineSimilarity(queryEmbedding, intentEmbedding);
    if (similarity >= 0.7) {
      matches.push({ type: intentType, confidence: similarity });
    }
  }

  // 3. 按相似度排序
  return matches.sort((a, b) => b.confidence - a.confidence);
}
```

---

## 🔧 Embedding 模型对比

### 常用模型

| 模型 | 维度 | 速度 | 准确率 | 语言 | 成本 |
|------|------|------|--------|------|------|
| **OpenAI text-embedding-ada-002** | 1536 | 快 | 高 | 多语言 | 付费 |
| **BGE-large-zh** | 1024 | 中 | 高 | 中文优化 | 免费 |
| **Sentence-BERT** | 768 | 快 | 中 | 英文 | 免费 |
| **M3E-base** | 768 | 快 | 中 | 中文 | 免费 |

### 推荐方案

#### 方案1：OpenAI Embedding（云端，付费）

```typescript
// 优势：准确率高、速度快、多语言
// 劣势：付费、需要网络

const embeddingService = new OpenAIEmbeddingService(apiKey);
const vector = await embeddingService.embed("写一个登录接口");
```

#### 方案2：BGE-large-zh（本地，免费）

```typescript
// 优势：免费、中文优化、隐私保护
// 劣势：需要本地部署

// 1. 安装模型
// pip install sentence-transformers
// python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('BAAI/bge-large-zh-v1.5')"

// 2. 启动服务
// python embedding_server.py

// 3. 调用
const embeddingService = new LocalEmbeddingService('http://localhost:8001');
const vector = await embeddingService.embed("写一个登录接口");
```

---

## 💡 Embedding vs 其他方案

### 对比表

| 方案 | 原理 | 速度 | 准确率 | 泛化能力 | 成本 |
|------|------|------|--------|---------|------|
| **规则匹配** | 正则表达式 | <1ms | 80% | 弱 | 免费 |
| **Embedding** | 向量相似度 | ~10ms | 85% | 中 | 免费/付费 |
| **GLM 模型** | 语言模型 | ~50ms | 95% | 强 | 免费/付费 |

### 使用场景

```
规则匹配：
  ✅ 常见场景（"写代码"、"修复bug"）
  ✅ 需要极快响应
  ❌ 复杂语义

Embedding：
  ✅ 语义相似度匹配
  ✅ 多语言支持
  ❌ 需要预计算

GLM 模型：
  ✅ 复杂语义理解
  ✅ 上下文理解
  ❌ 速度较慢
```

---

## 🎯 xuanji 中的 Embedding 架构

### 当前架构

```
用户输入："写一个登录接口"
  ↓
┌─────────────────────────────────────┐
│ Step 1: 规则匹配（<1ms）             │
│ 检查：/^(写|实现).*(接口)/i          │
│ ✅ 匹配成功 → scene='write_code'     │
└─────────────────────────────────────┘
  ↓ 如果未匹配
┌─────────────────────────────────────┐
│ Step 2: Embedding 匹配（~10ms）      │
│ 1. 计算用户输入的 Embedding          │
│ 2. 与场景 Embedding 计算相似度       │
│ 3. 选择最相似的场景（阈值 >= 0.3）   │
└─────────────────────────────────────┘
  ↓ 如果未匹配
┌─────────────────────────────────────┐
│ Step 3: 默认场景                     │
│ scene='coding'                       │
└─────────────────────────────────────┘
```

### 优化建议

```
规则匹配（80%场景，<1ms）
  ↓ 未匹配
GLM 模型（15%场景，~50ms）  ← 推荐替代 Embedding
  ↓ 未匹配
默认场景（5%场景，<1ms）
```

**为什么推荐 GLM 替代 Embedding？**
- ✅ 准确率更高（95% vs 85%）
- ✅ 理解能力更强（上下文、语义）
- ✅ 不需要预计算
- ⚠️ 速度稍慢（50ms vs 10ms）

---

## 🔍 余弦相似度（Cosine Similarity）

### 计算公式

```
similarity = (A · B) / (||A|| × ||B||)

其中：
- A · B：向量点积
- ||A||：向量 A 的模长
- ||B||：向量 B 的模长
```

### 代码实现

```typescript
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// 使用
const vector1 = [0.8, 0.6, 0.1];
const vector2 = [0.7, 0.5, 0.2];
const similarity = cosineSimilarity(vector1, vector2);
console.log(similarity); // 0.95（很相似）
```

### 相似度范围

```
1.0  = 完全相同
0.9+ = 非常相似
0.7+ = 相似
0.5+ = 有些相似
0.3+ = 略微相似
0.0  = 不相关
-1.0 = 完全相反
```

---

## 📝 实际示例

### 场景识别示例

```typescript
// 场景描述（预计算 Embedding）
const sceneDescriptions = {
  'write_code': '编写代码、实现功能',
  'debug': '排查问题、修复bug、调试代码',
  'review': '代码审查、优化建议、质量评估',
};

// 预计算场景 Embedding
const sceneEmbeddings = {
  'write_code': [0.8, 0.6, 0.1, ...],
  'debug': [0.2, 0.7, 0.5, ...],
  'review': [0.3, 0.4, 0.8, ...],
};

// 用户输入
const userInput = "帮我写一个用户注册接口";

// 计算用户输入的 Embedding
const queryEmbedding = await embed(userInput);
// [0.75, 0.55, 0.15, ...]

// 计算相似度
const similarities = {
  'write_code': cosineSimilarity(queryEmbedding, sceneEmbeddings['write_code']),
  // 0.92（很相似）
  'debug': cosineSimilarity(queryEmbedding, sceneEmbeddings['debug']),
  // 0.25（不相似）
  'review': cosineSimilarity(queryEmbedding, sceneEmbeddings['review']),
  // 0.31（略微相似）
};

// 选择最相似的场景
const bestMatch = 'write_code'; // similarity = 0.92
```

---

## 🎉 总结

### Embedding 是什么？
- 将文本转换为数字向量
- 让计算机理解文本语义
- 通过向量相似度判断文本相似度

### 在 xuanji 中的作用
- 场景识别（IntentAnalyzer）
- 意图识别（IntentRouter）
- 作为规则匹配的降级方案

### 优势
- ✅ 理解语义（不只是关键词）
- ✅ 多语言支持
- ✅ 泛化能力强

### 劣势
- ⚠️ 速度较慢（~10ms）
- ⚠️ 需要模型服务
- ⚠️ 准确率不如 GLM（85% vs 95%）

### 推荐方案
```
规则匹配（80%，<1ms）
  ↓
GLM 模型（15%，~50ms）  ← 推荐
  ↓
默认场景（5%，<1ms）
```

**Embedding 是一个很有用的技术，但在 xuanji 中，我们推荐用 GLM 模型替代它！** 🚀
