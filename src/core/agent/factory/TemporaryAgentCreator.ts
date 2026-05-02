import { logger } from '@/core/logger';
import { getConfigManager } from '@/core/config/ConfigManager';
import type { AgentConfig } from '@/core/config/ConfigManager';

const log = logger.child({ module: 'TemporaryAgentCreator' });

export interface TempAgentOptions {
  role: string;
  capabilities?: string[];
  taskDescription: string;
  parentConfig?: any;
}

export class TemporaryAgentCreator {
  createTemporaryAgent(options: TempAgentOptions): AgentConfig {
    const cfgMgr = getConfigManager();
    const id = `temp-${options.role.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`;

    const agentCfg: AgentConfig = {
      id,
      name: options.role,
      type: 'agent',
      enabled: true,
      model: {
        primary: cfgMgr.getSettings()?.defaultModel ?? 'claude-sonnet-4-6',
        temperature: 0.7,
      },
      systemPrompt: options.taskDescription,
      tools: [],
      execution: { timeout: 300_000, maxIterations: 20 },
      metadata: {
        isTemporary: true,
        capabilities: options.capabilities ?? [],
        source: 'dynamic',
      },
    };

    // Inherit provider from parent if available
    if (options.parentConfig?.provider) {
      agentCfg.provider = {
        apiKey: options.parentConfig.provider.apiKey,
        baseURL: options.parentConfig.provider.baseURL,
        adapter: options.parentConfig.provider.adapter,
      };
    }

    log.info(`Created temporary agent: ${id}`);
    return agentCfg;
  }

  cleanupTemporaryAgent(agentId: string): void {
    log.debug(`Cleaned up temporary agent: ${agentId}`);
  }
}
