/**
 * 文件解析器类型定义
 */

export interface FileParserResult {
  /** 格式化的 Markdown 文本 */
  content: string;
  /** 元数据（页数、行数、sheet 数等） */
  metadata?: Record<string, unknown>;
}

export type FileParser = (filePath: string) => Promise<FileParserResult>;
