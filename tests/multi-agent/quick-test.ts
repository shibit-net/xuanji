/**
 * 快速测试 Multi-Agent 功能
 * 
 * 运行最关键的测试用例来快速验证功能
 */

import { OrchestrateTool } from '@/core/tools/OrchestrateTool';
import { PipelineTool } from '@/core/tools/PipelineTool';
import { QuickTeamTool } from '@/core/tools/QuickTeamTool';
import { ProviderManager } from '@/core/providers/ProviderManager';
import { AgentRegistry } from '@/core/agent/AgentRegistry';
import { loadConfig } from '@/core/config';
import { getToolRegistry } from '@/core/tools';

async function quickTest() {
  console.log('🚀 Quick Multi-Agent Test\n');

  // Initialize
  const config = await loadConfig();
  const agentConfig = {
    provider: config.provider || 'anthropic',
    model: config.model || 'claude-3-7-sonnet-20250219',
  };

  const providerManager = new ProviderManager(config);
  const agentRegistry = new AgentRegistry();
  await agentRegistry.initialize();
  const registry = getToolRegistry();

  const orchestrateTool = new OrchestrateTool();
  orchestrateTool.setDependencies({
    providerManager,
    agentRegistry,
    registry,
    agentConfig,
    depth: 0,
  });

  const pipelineTool = new PipelineTool();
  pipelineTool.setDependencies({
    providerManager,
    agentRegistry,
    registry,
    agentConfig,
    depth: 0,
  });

  const mainProvider = providerManager.getProvider(agentConfig);
  const lightProvider = providerManager.getLightProvider();

  const quickTeamTool = new QuickTeamTool();
  quickTeamTool.setDependencies({
    provider: mainProvider,
    lightProvider,
    registry,
    agentConfig,
    depth: 0,
  });

  // Test 1: Orchestrate Sequential
  console.log('\n' + '='.repeat(60));
  console.log('Test 1: Orchestrate Sequential Strategy');
  console.log('='.repeat(60) + '\n');

  const test1Start = Date.now();
  try {
    const result1 = await orchestrateTool.execute({
      team_name: 'Quick Code Review',
      goal: 'Review src/core/tools/OrchestrateTool.ts for basic code quality',
      strategy: 'sequential',
      members: [
        {
          id: 'reviewer1',
          role: 'explore',
          capabilities: ['code review'],
          system_prompt: 'Review code structure and patterns briefly.',
        },
        {
          id: 'reviewer2',
          role: 'explore',
          capabilities: ['error handling'],
          system_prompt: 'Check error handling briefly.',
        },
      ],
      max_rounds: 3,
      timeout: 120000,
    });

    const duration1 = Date.now() - test1Start;
    console.log(result1.isError ? '❌' : '✅', 'Sequential test:', (duration1 / 1000).toFixed(1) + 's');
    if (result1.metadata?.totalTokens) {
      console.log('Tokens:', result1.metadata.totalTokens.input + result1.metadata.totalTokens.output);
    }
  } catch (err) {
    console.log('❌ Test 1 failed:', err);
  }

  // Test 2: Pipeline
  console.log('\n' + '='.repeat(60));
  console.log('Test 2: Pipeline Basic Flow');
  console.log('='.repeat(60) + '\n');

  const test2Start = Date.now();
  try {
    const result2 = await pipelineTool.execute({
      chain: [
        {
          agent_id: 'explore',
          task_template: 'List the exported classes in src/core/tools/PipelineTool.ts',
          description: 'Extract',
        },
        {
          agent_id: 'plan',
          task_template: 'From: {{previous_output}}\n\nSummarize the main class and its purpose',
          description: 'Summarize',
        },
      ],
    });

    const duration2 = Date.now() - test2Start;
    console.log(result2.isError ? '❌' : '✅', 'Pipeline test:', (duration2 / 1000).toFixed(1) + 's');
  } catch (err) {
    console.log('❌ Test 2 failed:', err);
  }

  // Test 3: Quick Team
  console.log('\n' + '='.repeat(60));
  console.log('Test 3: QuickTeam Template');
  console.log('='.repeat(60) + '\n');

  const test3Start = Date.now();
  try {
    const result3 = await quickTeamTool.execute({
      template: 'code-review',
      goal: 'Quick review of QuickTeamTool.ts',
      target: 'src/core/tools/QuickTeamTool.ts',
      timeout: 120000,
    });

    const duration3 = Date.now() - test3Start;
    console.log(result3.isError ? '❌' : '✅', 'QuickTeam test:', (duration3 / 1000).toFixed(1) + 's');
    if (result3.metadata?.totalTokens) {
      console.log('Tokens:', result3.metadata.totalTokens.input + result3.metadata.totalTokens.output);
    }
  } catch (err) {
    console.log('❌ Test 3 failed:', err);
  }

  console.log('\n✅ Quick test complete\n');
}

if (require.main === module) {
  quickTest().catch(console.error);
}

export { quickTest };
