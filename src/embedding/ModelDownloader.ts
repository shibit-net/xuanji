// ============================================================
// Embedding Model Downloader - 使用 DownloadManager 下载模型
// ============================================================

import { DownloadManager } from '@/core/download/DownloadManager.js';
import { logger } from '@/core/logger/index.js';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const log = logger.child({ module: 'ModelDownloader' });

// 向上查找 xuanji 项目根目录（包含 package.json 且 name 为 xuanji）
function findProjectRoot(startDir: string): string {
  let current = startDir;
  while (current !== path.dirname(current)) {
    const pkgPath = path.join(current, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.name === 'xuanji') {
          return current;
        }
      } catch {}
    }
    current = path.dirname(current);
  }
  // 回退方案：使用 process.cwd()
  return process.cwd();
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = findProjectRoot(__dirname);
const EMBEDDING_MODEL_DIR = path.join(PROJECT_ROOT, '.xuanji', 'embedding-models');

/**
 * Embedding 模型下载器
 *
 * 使用 xuanji 的 DownloadManager 下载 HuggingFace 模型文件
 */
export class ModelDownloader {
  private downloadManager: DownloadManager;

  constructor() {
    this.downloadManager = DownloadManager.getInstance();
  }

  /**
   * 下载 embedding 模型（发起下载任务，不等待完成）
   *
   * @param modelId - 模型 ID，如 "Xenova/paraphrase-multilingual-MiniLM-L12-v2"
   * @param hfMirror - HuggingFace 镜像地址，默认 "https://hf-mirror.com"
   */
  async downloadModel(modelId: string, hfMirror: string = 'https://hf-mirror.com'): Promise<void> {
    log.info(`Creating download tasks for embedding model: ${modelId}`);

    const modelDir = path.join(EMBEDDING_MODEL_DIR, modelId);

    // 检查模型是否已存在
    if (fs.existsSync(modelDir)) {
      log.info(`Model already exists: ${modelDir}`);
      return;
    }

    // 创建模型目录
    fs.mkdirSync(modelDir, { recursive: true });

    // HuggingFace 模型需要下载的文件列表
    const files = [
      'config.json',
      'tokenizer.json',
      'tokenizer_config.json',
      'special_tokens_map.json',
      'onnx/model.onnx', // 使用标准的 model.onnx，而不是 model_quantized.onnx
    ];

    const baseUrl = `${hfMirror}/${modelId}/resolve/main`;

    // 发起所有文件的下载任务（不等待完成）
    for (const file of files) {
      const url = `${baseUrl}/${file}`;
      const dest = path.join(modelDir, file);

      log.info(`Creating download task: ${file}`);

      await this.downloadManager.download({
        url,
        dest,
        name: `Embedding: ${modelId}/${file}`,
        category: 'model',
      });
    }

    log.info(`Download tasks created for model: ${modelId}`);
  }
}
