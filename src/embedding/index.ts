// ============================================================
// Embedding 模块 — 导出
// ============================================================

export { EmbeddingService, EMBEDDING_DIMENSION } from './EmbeddingService';
export { VectorStore, cosineSimilarity } from './VectorStore';
export type { VectorSearchResult, SkillEmbeddingRecord } from './VectorStore';

// 新增：统一抽象层
export { EmbeddingProvider, getEmbeddingProvider } from './EmbeddingProvider';
export type { SimilarityResult, BatchEmbeddingResult } from './EmbeddingProvider';

// 新增：模型下载器
export { ModelDownloader } from './ModelDownloader';
