/**
 * LayerLoader — 分层 Prompt 加载器
 *
 * 从指定目录加载 Prompt 组件（L0/L1/L2/L3），支持项目级和用户级覆盖。
 */
import { logger } from '@/infrastructure/logger';
import type { PromptComponent } from './types';

const log = logger.child({ module: 'LayerLoader' });

export class LayerLoader {
  async loadComponentsFromConfig(components: PromptComponent[]): Promise<PromptComponent[]> {
    return components.filter(c => c.enabled !== false);
  }

  async resolveLayerForComponent(component: PromptComponent): Promise<string> {
    switch (component.layer) {
      case 'L0': return 'core';
      case 'L1': return 'capability';
      case 'L2': return 'behavior';
      case 'L3': return 'context';
      default: return 'unknown';
    }
  }

  async loadBuiltinComponents(): Promise<PromptComponent[]> {
    // Builtin components are registered via PromptComponentRegistry
    log.debug('Builtin components loaded via registry');
    return [];
  }
}
