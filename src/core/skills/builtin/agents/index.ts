/**
 * ============================================================
 * Built-in Agent Skills
 * ============================================================
 * Agent 配置和策略
 *
 * 说明：Agent Skills (category: 'agent') 与 Prompt Skills 不同：
 * - Prompt Skills → 组合到 system prompt 文本中
 * - Agent Skills → 提供 AgentConfig 配置（model, maxTokens 等）
 * - Agent 行为指导在 'agent-rules' Prompt Skill 中
 */

import type { Skill } from '../../types';
import type { AgentConfig } from '../../../types';

/**
 * ReAct 循环 Prompt — 作为 Agent Skill 的附加指导
 * 当使用 render() 时返回 ReAct 模式说明
 */
const REACT_LOOP_PROMPT = `# ReAct Loop Protocol

## Thinking Pattern

For each user request, follow this cycle:

\`\`\`
THINK → What information do I need? What tools are available?
  ↓
ACT   → Call the appropriate tool(s)
  ↓
OBSERVE → Analyze tool results
  ↓
DECIDE → Need more info? → back to THINK
         Task complete?  → Respond to user
\`\`\`

## Tool Call Format

When calling tools, follow these patterns:

### Single Tool Call
Analyze → Call → Present results

### Parallel Tool Calls (read-only operations)
Multiple independent reads/searches can execute simultaneously:
- read_file("a.ts") + read_file("b.ts") → parallel
- grep("pattern1") + glob("*.ts") → parallel

### Sequential Tool Calls (write operations)
Write operations that depend on each other must be sequential:
- read_file → edit_file (must read before edit)
- write_file → bash test (must write before test)

## Iteration Budget

| Task Complexity | Target Iterations | Max Iterations |
|----------------|-------------------|----------------|
| Simple (read/answer) | 1-3 | 5 |
| Medium (edit/debug) | 3-10 | 20 |
| Complex (refactor/implement) | 10-30 | 50 |

If approaching the max, summarize progress and ask the user how to proceed.`;

/**
 * 默认 ReAct 循环配置 Skill
 */
export const reactLoopDefaultSkill: Skill<any> = {
  id: 'react-loop-default',
  name: 'Default ReAct Loop',
  version: '2.0.0',
  description: 'ReAct 循环的默认配置 + 思考链协议',
  category: 'agent',
  tags: ['agent', 'react', 'default'],
  author: 'Shibit Team',
  createdAt: new Date('2025-02-23'),

  content: {
    model: 'claude-sonnet-4-20250514',
    maxTokens: 4096,
    temperature: 0.7,
    maxIterations: 50,
  } as AgentConfig,

  parameters: {
    model: {
      name: 'model',
      type: 'string',
      description: 'LLM 模型名称',
      default: 'claude-sonnet-4-20250514',
      required: false,
    },
    maxTokens: {
      name: 'maxTokens',
      type: 'number',
      description: '最大 token 数',
      default: 4096,
      required: false,
    },
    temperature: {
      name: 'temperature',
      type: 'number',
      description: '温度参数 (0-2)',
      default: 0.7,
      required: false,
    },
    maxIterations: {
      name: 'maxIterations',
      type: 'number',
      description: '最大迭代次数',
      default: 50,
      required: false,
    },
  },

  dependencies: [],
  conflicts: [],
  requiredTools: [],
  enabled: true,
  priority: 100,

  render: (options?: any): string => {
    const params = options?.params || {};
    const config = { ...reactLoopDefaultSkill.content };

    // 应用参数覆盖
    if (params.model) config.model = params.model;
    if (params.maxTokens) config.maxTokens = params.maxTokens;
    if (params.temperature !== undefined) config.temperature = params.temperature;
    if (params.maxIterations) config.maxIterations = params.maxIterations;

    // 返回 ReAct Prompt + 配置
    return `${REACT_LOOP_PROMPT}\n\n## Current Configuration\n\n\`\`\`json\n${JSON.stringify(config, null, 2)}\n\`\`\``;
  },

  execute: async (params?: Record<string, any>): Promise<AgentConfig> => {
    const config = { ...reactLoopDefaultSkill.content };

    // 应用参数覆盖
    if (params) {
      if (params.model) config.model = params.model;
      if (params.maxTokens) config.maxTokens = params.maxTokens;
      if (params.temperature !== undefined) config.temperature = params.temperature;
      if (params.maxIterations) config.maxIterations = params.maxIterations;
    }

    return config;
  },
};

/**
 * 多轮对话处理 Skill
 */
export const multiTurnHandlingSkill: Skill<any> = {
  id: 'multi-turn-handling',
  name: 'Multi-turn Conversation Handling',
  version: '2.0.0',
  description: '多轮对话的配置、上下文管理和连续性策略',
  category: 'agent',
  tags: ['agent', 'multi-turn', 'conversation'],
  author: 'Shibit Team',
  createdAt: new Date('2025-02-23'),

  content: {
    model: 'claude-sonnet-4-20250514',
    maxTokens: 8192,
    temperature: 0.5,
    maxIterations: 100,
  } as AgentConfig,

  parameters: {
    contextWindow: {
      name: 'contextWindow',
      type: 'number',
      description: '上下文窗口大小 (messages 数)',
      default: 20,
      required: false,
    },
    summarizeAfter: {
      name: 'summarizeAfter',
      type: 'number',
      description: '在多少 messages 后进行摘要',
      default: 10,
      required: false,
    },
  },

  dependencies: ['react-loop-default'],
  conflicts: [],
  requiredTools: [],
  enabled: true,
  priority: 90,

  render: (options?: any): string => {
    const params = options?.params || {};
    const config = { ...multiTurnHandlingSkill.content };

    if (params.model) config.model = params.model;
    if (params.maxTokens) config.maxTokens = params.maxTokens;
    if (params.temperature !== undefined) config.temperature = params.temperature;
    if (params.maxIterations) config.maxIterations = params.maxIterations;

    return `# Multi-Turn Conversation Protocol

## Context Continuity Rules

1. **Reference previous context**: Use information from earlier in the conversation
2. **Track modifications**: Remember which files were read/modified in this session
3. **Maintain intent**: Keep the user's original goal in mind across multiple turns
4. **Avoid redundancy**: Don't re-read files or re-execute commands already done

## When Context Gets Long

- Summarize earlier turns mentally before responding
- Focus on the most recent user request
- Reference earlier work by outcome, not process

## Configuration

\`\`\`json
${JSON.stringify(config, null, 2)}
\`\`\``;
  },
};
