// ============================================================
// chatStore - 工具函数 + 类型重导出
// 流式处理与编排逻辑已迁移到 messageStore.ts
// ============================================================

// ── 工具函数 ──────────────────────────────────────

/** 格式化场景标签：去除 l{n}- 前缀，展示纯场景名 */
export function formatSceneLabel(raw: string): string {
  return raw.replace(/^l\d+-/, '').slice(0, 20);
}

/** 提取可读的模型名（去除 file: 前缀、路径和扩展名） */
export function formatModelName(rawModel: string): string {
  if (!rawModel) return 'unknown';
  const cleaned = rawModel
    .replace(/^file:.*\//, '')
    .replace(/\.gguf$/, '')
    .replace(/^hf:/, '');
  return cleaned || rawModel;
}

// ── 类型重导出 ────────────────────────────────────

export type {
  Message,
  ToolCall,
  ChatStatus,
  SubAgentReference,
  ContentBlock,
} from './messageStore';

// ── Store 别名（向后兼容） ─────────────────────────

export { useMessageStore as useChatStore } from './messageStore';
