// ============================================================
// 媒体生成工具 — 抽象基类
// ============================================================

import type { ToolResult } from '@/shared/types/tools';
import { BaseTool } from './BaseTool';
import { ToolConfigManager } from './ToolConfigManager';
import { getAdapter } from './adapters/AdapterFactory';
import type { ToolMediaGenConfig } from '@/shared/types/config';

/**
 * 媒体生成工具基类
 *
 * 提供通用逻辑：输入校验、配置读取、错误格式化。
 * 子类只需实现 doExecute()，不关心平台细节。
 */
export abstract class AbstractMediaGenTool extends BaseTool {
  /** 配置键名，与 Agent YAML tools[].name 一致 */
  abstract readonly toolConfigName: string;
  /** 媒体类型 */
  abstract readonly mediaType: 'image' | 'video' | 'audio';
  /** 数量单位（如 "张"、"个"、"段"） */
  abstract readonly displayUnit: string;

  readonly readonly = true;

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    // 1. 输入校验
    const err = this.validateInput(input);
    if (err) return err;

    // 2. 配置校验
    const cfg = ToolConfigManager.getInstance().getConfig(this.toolConfigName);
    if (!cfg) {
      return this.error(
        `请在 Agent 配置中为 ${this.displayName} 工具添加配置（tools[].config）。`,
      );
    }
    if (!cfg.apiKey) {
      return this.error(`${this.displayName} 工具缺少 API Key，请在 Agent 配置中设置。`);
    }

    // 3. 委托子类
    try {
      return await this.doExecute(input, cfg);
    } catch (err: any) {
      return this.error(`${this.displayName} 生成失败: ${err.message}`);
    }
  }

  protected get displayName(): string {
    const map: Record<string, string> = {
      image: '图片',
      video: '视频',
      audio: '音频',
    };
    return map[this.mediaType] || '文件';
  }

  /**
   * 输入校验（子类可覆写）
   * @returns null 表示校验通过，否则返回错误结果
   */
  protected validateInput(input: Record<string, unknown>): ToolResult | null {
    if (
      !input.prompt ||
      typeof input.prompt !== 'string' ||
      !input.prompt.trim()
    ) {
      return this.error('prompt 参数不能为空。');
    }
    return null;
  }

  /**
   * 具体生成逻辑（子类实现）
   */
  protected abstract doExecute(
    input: Record<string, unknown>,
    cfg: ToolMediaGenConfig,
  ): Promise<ToolResult>;
}
