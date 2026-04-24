/**
 * ============================================================
 * CreateTemporaryAgentTool - 创建临时 Agent 工具
 * ============================================================
 *
 * 当 match_agent 无法找到合适的 Agent 时（score < 0.5），
 * 主 Agent 可以使用此工具创建临时 Agent。
 */

import type { Tool, ToolExecuteOptions } from '@/core/types';
import type { AgentRegistry } from '@/core/agent/AgentRegistry';
import type { TemporaryAgentOptions } from '@/core/agent/TemporaryAgentFactory';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'CreateTemporaryAgentTool' });

export interface CreateTemporaryAgentInput {
  /** 角色名称（如 "Technical Writer", "Data Analyst"） */
  role: string;
  /** 需要的能力列表 */
  capabilities: string[];
  /** 任务描述 */
  taskDescription: string;
  /** 关联的场景 ID（可选） */
  scene?: string;
}

export class CreateTemporaryAgentTool implements Tool {
  name = 'create_temporary_agent';
  description = `创建临时 Agent 来完成特定任务。

使用场景：
- 当 match_agent 无法找到合适的 Agent 时（score < 0.5）
- 需要一个具有特定能力的专业 Agent，但系统中没有预定义的

参数：
- role: 角色名称（如 "Technical Writer", "Data Analyst"）
- capabilities: 需要的能力列表（如 ["技术文档编写", "API文档"]）
- taskDescription: 任务描述
- scene: 关联的场景 ID（可选）

返回：
- 临时 Agent 的 ID，可以用于后续的 task 或 agent_team 调用

示例：
\`\`\`json
{
  "role": "Technical Writer",
  "capabilities": ["技术文档编写", "API文档", "用户指南"],
  "taskDescription": "编写用户登录功能的API文档"
}
\`\`\`

注意：
- 临时 Agent 在任务完成后会自动清理
- 不会保存到配置文件
- 使用通用的 systemPrompt 模板`;

  parameters = {
    type: 'object',
    properties: {
      role: {
        type: 'string',
        description: '角色名称（如 "Technical Writer", "Data Analyst"）',
      },
      capabilities: {
        type: 'array',
        items: { type: 'string' },
        description: '需要的能力列表',
      },
      taskDescription: {
        type: 'string',
        description: '任务描述',
      },
      scene: {
        type: 'string',
        description: '关联的场景 ID（可选）',
      },
    },
    required: ['role', 'capabilities', 'taskDescription'],
  };

  private agentRegistry?: AgentRegistry;

  setAgentRegistry(registry: AgentRegistry): void {
    this.agentRegistry = registry;
  }

  async execute(
    input: CreateTemporaryAgentInput,
    options?: ToolExecuteOptions
  ): Promise<string> {
    if (!this.agentRegistry) {
      throw new Error('AgentRegistry 未设置');
    }

    const { role, capabilities, taskDescription, scene } = input;

    log.info(`创建临时 Agent: ${role}`);
    log.debug('能力:', capabilities);
    log.debug('任务:', taskDescription);

    // 创建临时 Agent
    const factory = this.agentRegistry.getTemporaryAgentFactory();
    const tempAgent = factory.createTemporaryAgent({
      role,
      capabilities,
      taskDescription,
      scene,
    });

    // 如果没有指定场景，创建临时场景
    let sceneId = scene;
    if (!sceneId) {
      const tempScene = factory.createTemporaryScene(role, capabilities);
      sceneId = tempScene.id;
      log.info(`创建临时 Scene: ${sceneId}`);
    }

    const result = {
      success: true,
      agentId: tempAgent.id,
      agentName: tempAgent.name,
      sceneId,
      message: `已创建临时 Agent: ${tempAgent.name} (${tempAgent.id})`,
    };

    log.info('临时 Agent 创建成功:', result);

    return JSON.stringify(result, null, 2);
  }
}
