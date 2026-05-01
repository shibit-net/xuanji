// ============================================================
// LLMProvider - LLM 提供者抽象接口
// ============================================================

export interface GenerateOptions {
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  /** 无状态模式：每次调用使用全新会话，不保留聊天历史。适用于分类器等不需要上下文的场景 */
  stateless?: boolean;
}

export interface LLMProvider {
  /**
   * 初始化 provider
   */
  init(): Promise<void>;

  /**
   * 生成文本
   */
  generate(prompt: string, options?: GenerateOptions): Promise<string>;

  /**
   * 检查是否可用
   */
  isAvailable(): boolean;

  /**
   * 获取模型标识
   */
  getModelId(): string;

  /**
   * 清理资源
   */
  dispose(): Promise<void>;
}
