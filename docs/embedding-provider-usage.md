# EmbeddingProvider 使用指南

## 概述

`EmbeddingProvider` 是 Xuanji 项目中向量模型的统一抽象层，为各个场景提供一致的 embedding 生成接口。

## 核心特性

- **单例模式**：全局共享一个实例，避免重复加载模型
- **配置驱动**：支持项目配置、环境变量、默认值三层配置
- **批量处理**：支持单个和批量文本向量化
- **相似度计算**：内置余弦相似度计算和最相似项查找
- **缓存机制**：自动缓存 embedding 结果，提升性能

## 基础使用

### 1. 获取实例

```typescript
import { getEmbeddingProvider } from '@/embedding';

// 使用默认配置
const provider = getEmbeddingProvider();

// 或指定配置
const provider = getEmbeddingProvider({
  model: 'Xenova/all-MiniLM-L6-v2',
  dimensions: 384,
  cacheEnabled: true,
});
```

### 2. 生成单个 embedding

```typescript
const text = '这是一段需要向量化的文本';
const vector = await provider.embed(text);
// vector: number[] (长度为 384)
```

### 3. 批量生成 embeddings

```typescript
const texts = ['文本1', '文本2', '文本3'];
const result = await provider.embedBatch(texts);

console.log(result.vectors);     // number[][] - 向量数组
console.log(result.model);        // 使用的模型 ID
console.log(result.dimensions);   // 向量维度
```

### 4. 计算相似度

```typescript
// 计算两个向量的余弦相似度
const similarity = provider.cosineSimilarity(vector1, vector2);
// similarity: number [0, 1]

// 计算文本与向量的相似度
const result = await provider.computeSimilarity(
  '查询文本',
  targetVector
);
console.log(result.similarity);  // 相似度分数
console.log(result.vector1);     // 查询文本的向量
console.log(result.vector2);     // 目标向量
```

### 5. 查找最相似项

```typescript
const query = '用户查询';
const candidates = [
  { id: '1', text: '候选项1' },
  { id: '2', text: '候选项2' },
  { id: '3', vector: precomputedVector },  // 也可以直接提供向量
];

const results = await provider.findMostSimilar(query, candidates, 3);
// results: [{ id: '1', similarity: 0.85, index: 0 }, ...]
```

## 实际应用场景

### 场景1：意图识别（IntentAnalyzer）

```typescript
import { getEmbeddingProvider } from '@/embedding';

export class IntentAnalyzer {
  private embeddingProvider = getEmbeddingProvider();
  private sceneEmbeddings = new Map<string, number[]>();

  async init(scenes: Array<{ id: string; description: string }>) {
    // 预计算所有场景的 embeddings
    for (const scene of scenes) {
      const embedding = await this.embeddingProvider.embed(scene.description);
      this.sceneEmbeddings.set(scene.id, embedding);
    }
  }

  async matchScene(userInput: string): Promise<string> {
    const userVector = await this.embeddingProvider.embed(userInput);
    
    let bestMatch = { sceneId: '', similarity: 0 };
    for (const [sceneId, sceneVector] of this.sceneEmbeddings) {
      const similarity = this.embeddingProvider.cosineSimilarity(
        userVector,
        sceneVector
      );
      if (similarity > bestMatch.similarity) {
        bestMatch = { sceneId, similarity };
      }
    }
    
    return bestMatch.sceneId;
  }
}
```

### 场景2：Agent 推荐（MatchAgentTool）

```typescript
import { getEmbeddingProvider } from '@/embedding';

export class MatchAgentTool {
  private embeddingProvider = getEmbeddingProvider();

  async findBestAgent(taskDescription: string, agents: Agent[]) {
    const candidates = agents.map(agent => ({
      id: agent.id,
      text: `${agent.name} ${agent.description} ${agent.capabilities.join(' ')}`,
    }));

    const results = await this.embeddingProvider.findMostSimilar(
      taskDescription,
      candidates,
      3
    );

    return results.map(r => ({
      agentId: r.id,
      score: r.similarity,
    }));
  }
}
```

### 场景3：记忆检索（VectorStore）

```typescript
import { getEmbeddingProvider } from '@/embedding';

export class MemoryRetriever {
  private embeddingProvider = getEmbeddingProvider();

  async searchSimilarMemories(
    query: string,
    memories: Array<{ id: string; content: string; vector?: number[] }>
  ) {
    // 如果记忆已有向量，直接使用；否则实时生成
    const candidates = memories.map(m => ({
      id: m.id,
      text: m.vector ? undefined : m.content,
      vector: m.vector,
    }));

    return await this.embeddingProvider.findMostSimilar(query, candidates, 5);
  }
}
```

## 配置管理

### 项目配置（推荐）

在 `.xuanji/config.json` 中配置：

```json
{
  "embedding": {
    "model": "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
    "dimensions": 384,
    "cacheEnabled": true,
    "cacheMaxSize": 100,
    "hfMirror": "https://hf-mirror.com"
  }
}
```

### 环境变量

```bash
export XUANJI_EMBEDDING_MODEL="Xenova/all-MiniLM-L6-v2"
export XUANJI_EMBEDDING_DIMENSIONS=384
export XUANJI_EMBEDDING_CACHE_ENABLED=true
export XUANJI_EMBEDDING_HF_MIRROR="https://hf-mirror.com"
```

### 运行时更新

```typescript
const provider = getEmbeddingProvider();

// 更新配置（会重置模型）
provider.updateConfig({
  model: 'Xenova/all-MiniLM-L6-v2',
  dimensions: 384,
});
```

## GUI 配置

在 Xuanji Desktop 应用中：

1. 点击左侧边栏的"设置"按钮
2. 选择"向量配置"标签
3. 修改配置项：
   - Embedding 模型
   - 向量维度
   - HuggingFace 镜像地址
   - 缓存设置
4. 点击"保存配置"

配置会自动保存到项目的 `.xuanji/config.json` 文件。

## 最佳实践

### 1. 使用单例

```typescript
// ✅ 推荐：使用全局单例
const provider = getEmbeddingProvider();

// ❌ 避免：重复创建实例
const provider1 = new EmbeddingProvider();
const provider2 = new EmbeddingProvider();
```

### 2. 预计算 embeddings

```typescript
// ✅ 推荐：初始化时预计算
async init() {
  this.sceneVectors = await this.provider.embedBatch(sceneDescriptions);
}

// ❌ 避免：每次查询时重复计算
async match(query: string) {
  for (const scene of scenes) {
    const sceneVector = await this.provider.embed(scene.description); // 重复计算
    // ...
  }
}
```

### 3. 批量处理

```typescript
// ✅ 推荐：批量处理
const results = await provider.embedBatch(texts);

// ❌ 避免：循环单个处理
for (const text of texts) {
  const vector = await provider.embed(text);
}
```

### 4. 使用内置相似度计算

```typescript
// ✅ 推荐：使用内置方法
const similarity = provider.cosineSimilarity(vec1, vec2);

// ❌ 避免：手动实现
const dotProduct = vec1.reduce((sum, val, i) => sum + val * vec2[i], 0);
const mag1 = Math.sqrt(vec1.reduce((sum, val) => sum + val * val, 0));
const mag2 = Math.sqrt(vec2.reduce((sum, val) => sum + val * val, 0));
const similarity = dotProduct / (mag1 * mag2);
```

## 性能优化

### 缓存机制

EmbeddingProvider 内置缓存，相同文本不会重复计算：

```typescript
// 第一次调用：计算并缓存
const vec1 = await provider.embed('hello world');

// 第二次调用：直接从缓存返回
const vec2 = await provider.embed('hello world');
```

### 模型选择

不同模型的性能和精度权衡：

| 模型 | 维度 | 速度 | 精度 | 适用场景 |
|------|------|------|------|----------|
| `all-MiniLM-L6-v2` | 384 | 快 | 中 | 通用场景 |
| `paraphrase-multilingual-MiniLM-L12-v2` | 384 | 中 | 高 | 多语言场景 |
| `bge-small-zh-v1.5` | 512 | 中 | 高 | 中文场景 |

## 故障排查

### 模型加载失败

```typescript
try {
  await provider.init();
} catch (err) {
  console.error('模型加载失败:', err);
  // 检查：
  // 1. 网络连接（HuggingFace 镜像是否可用）
  // 2. 磁盘空间（~/.cache/huggingface/）
  // 3. 模型 ID 是否正确
}
```

### 向量维度不匹配

```typescript
// 确保配置的维度与模型实际维度一致
const dimensions = provider.getDimensions();
console.log('当前向量维度:', dimensions);
```

### 缓存占用过多内存

```typescript
// 调整缓存大小
provider.updateConfig({
  cacheMaxSize: 50,  // 减少缓存条数
});

// 或禁用缓存
provider.updateConfig({
  cacheEnabled: false,
});
```

## API 参考

### EmbeddingProvider

#### 方法

- `getInstance(config?)`: 获取全局单例
- `reset()`: 重置单例
- `init()`: 初始化模型
- `embed(text)`: 生成单个 embedding
- `embedBatch(texts)`: 批量生成 embeddings
- `cosineSimilarity(vec1, vec2)`: 计算余弦相似度
- `computeSimilarity(text, targetVector)`: 计算文本与向量的相似度
- `findMostSimilar(query, candidates, topK)`: 查找最相似项
- `getModelId()`: 获取当前模型 ID
- `getDimensions()`: 获取向量维度
- `updateConfig(config)`: 更新配置

### 类型定义

```typescript
interface EmbeddingConfig {
  model: string;
  dimensions: number;
  cacheEnabled: boolean;
  cacheMaxSize: number;
  hfMirror?: string;
}

interface SimilarityResult {
  similarity: number;
  vector1: number[];
  vector2: number[];
}

interface BatchEmbeddingResult {
  vectors: number[][];
  texts: string[];
  model: string;
  dimensions: number;
}
```

## 相关文档

- [Embedding 配置说明](./embedding-config.md)
- [向量检索最佳实践](./vector-search-best-practices.md)
- [模型选择指南](./model-selection-guide.md)
