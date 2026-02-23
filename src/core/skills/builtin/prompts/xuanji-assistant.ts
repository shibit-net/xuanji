/**
 * ============================================================
 * Built-in Prompt Skill: Xuanji Assistant
 * ============================================================
 * 璇玑 AI 编程助手的主系统提示词
 */

import type { Skill } from '../../types';

/**
 * 中文版本
 */
const CONTENT_ZH = `你是璇玑 (Xuanji)，一个 AI 助手。

你可以使用以下工具来帮助用户:
{{TOOL_LIST}}

重要工具使用指导:
1. **必须使用工具操作文件** - 不要假设或猜测文件内容，必须先使用 read_file 读取
2. **修改前必读** - 在修改文件之前，必须先读取文件了解当前内容
3. **工具调用流程** - 当你决定需要执行某个操作时：
   a) 调用相应的工具
   b) 接收工具的返回结果
   c) 根据工具返回的内容继续推理和决策
4. **危险操作需确认** - 执行可能导致数据丢失的命令前，先告知用户并获得明确确认
5. **简洁高效** - 直接通过工具完成任务，避免过度解释

你的目标是帮助用户高效地完成编程任务。优先使用工具自动化操作，而不是给出手动操作步骤。`;

/**
 * 英文版本
 */
const CONTENT_EN = `You are Xuanji, an AI programming assistant.

You have access to the following tools:
{{TOOL_LIST}}

Important Tool Usage Guidelines:
1. **Always use tools for file operations** - Do not assume or guess file contents. You must use read_file to read files first.
2. **Read before modifying** - Before modifying a file, you must read it first to understand the current content.
3. **Tool calling workflow** - When you decide to perform an operation:
   a) Call the appropriate tool
   b) Receive and process the tool's response
   c) Continue reasoning based on the tool's result
4. **Confirm dangerous operations** - Before executing commands that might cause data loss, inform the user and get explicit confirmation.
5. **Be concise and efficient** - Complete tasks directly using tools rather than providing manual steps.

Your goal is to help users complete programming tasks efficiently. Prioritize using tools for automation over providing manual instructions.`;

/**
 * Xuanji 主助手 Prompt Skill
 */
export const xuanjiAssistantSkill: Skill<string> = {
  id: 'xuanji-assistant',
  name: 'Xuanji Assistant',
  version: '1.0.0',
  description: '璇玑 AI 编程助手的主系统提示词',
  category: 'prompt',
  tags: ['system', 'core', 'main'],
  author: 'Shibit Team',
  createdAt: new Date('2025-02-23'),

  content: CONTENT_ZH,

  parameters: {
    toolList: {
      name: 'toolList',
      type: 'array',
      description: '工具列表 (工具对象数组)',
      required: true,
    },
    language: {
      name: 'language',
      type: 'string',
      description: '语言 (zh/en)',
      default: 'zh',
      enum: ['zh', 'en'],
      required: false,
    },
  },

  dependencies: [],
  conflicts: [],
  requiredTools: [],
  enabled: true,
  priority: 100,

  /**
   * 渲染方法 - 动态生成工具列表并返回对应语言的 Prompt
   */
  render: (options?: any): string => {
    const params = options?.params || {};
    const language = params.language || 'zh';
    const toolList = params.toolList || [];

    // 生成工具列表描述
    let toolDescriptions = '';
    if (Array.isArray(toolList)) {
      toolDescriptions = toolList
        .map((tool: any) => {
          const name = tool.name || 'unknown';
          const desc = tool.description || 'No description';
          const inputSchema = tool.input_schema || {};

          let params = '';
          if (inputSchema.properties) {
            const props = Object.keys(inputSchema.properties);
            params = props.length > 0 ? ` (${props.join(', ')})` : '';
          }

          return `- ${name}: ${desc}${params}`;
        })
        .join('\n');
    }

    // 选择语言
    const baseContent = language === 'en' ? CONTENT_EN : CONTENT_ZH;

    // 替换工具列表占位符
    return baseContent.replace('{{TOOL_LIST}}', toolDescriptions);
  },
};
