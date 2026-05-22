/**
 * LearnEngine — 自主学习引擎
 *
 * 搜索 + 提取 API 规格 + 生成 MCP/Skill。
 * 设计文档：docs/memory-system-part-8-self-learning.md §1–§5
 */

import { randomUUID } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'LearnEngine' });

export interface LearningResult {
  success: boolean;
  goal: string;
  depth: 'shallow' | 'moderate' | 'deep';
  searchResults: string[];
  apiSpec?: ApiSpec | null;
  mcpGenerated?: boolean;
  skillGenerated?: boolean;
  skillId?: string;
  errors: string[];
  duration: number;
}

export interface ApiSpec {
  name: string;
  description: string;
  baseUrl: string;
  endpoints: ApiEndpoint[];
}

export interface ApiEndpoint {
  method: string;
  path: string;
  description: string;
  parameters: Record<string, { type: string; description: string; required: boolean }>;
  returns: string;
}

export class LearnEngine {
  private installTool?: any;

  constructor(
    private cheapLLM?: any,
    private webSearchFn?: (query: string) => Promise<string[]>,
    private skillRegistry?: any,
    private toolRegistry?: any,
    private mcpManager?: any,
    private memoryManager?: any,
    private baseDir?: string,
  ) {}

  /** 注入 InstallTool 实例（供 autoInstallTool 委托） */
  setInstallTool(installTool: any): void {
    this.installTool = installTool;
  }

  /**
   * 检查缺失工具：对比 required 和已注册工具，返回缺失列表
   */
  async checkMissingTools(required: string[]): Promise<string[]> {
    if (!this.toolRegistry) return [];

    const available = new Set<string>();
    const allTools = this.toolRegistry.list?.() || [];
    for (const tool of allTools) {
      available.add(tool.name || tool);
    }
    // MCP 暴露的工具也在 ToolRegistry 中
    if (this.mcpManager) {
      for (const server of this.mcpManager.servers || []) {
        const tools = server.tools || [];
        for (const t of tools) {
          available.add(t.name);
        }
      }
    }
    return required.filter(t => !available.has(t));
  }

  /**
   * 根据学习目标和 API 规格推断所需工具
   */
  private inferRequiredTools(goal: string, apiSpec: ApiSpec | null): string[] {
    const tools: string[] = [];

    // 如果生成了 MCP，MCP 自动注册工具，不需要额外推断
    if (apiSpec) return tools;

    // 基于目标关键词推断可能需要的外部工具
    const keywords: [RegExp, string][] = [
      [/browser|网页|打开|导航|click|type/i, 'browser'],
      [/邮件|email|mail/i, 'email'],
      [/搜索|search|查询|搜/i, 'web_search'],
      [/下载|download|fetch|抓取/i, 'web_fetch'],
      [/文件|file|读|写/i, 'read_file'],
      [/终端|bash|shell|命令|执行/i, 'bash'],
    ];

    for (const [pattern, toolName] of keywords) {
      if (pattern.test(goal)) {
        tools.push(toolName);
      }
    }

    return Array.from(new Set(tools));
  }

  /**
   * 子主题分解：将复杂学习目标拆分为子主题列表
   */
  private async decomposeGoal(goal: string): Promise<string[]> {
    if (!this.cheapLLM) return [goal];

    const prompt = `将以下学习目标拆分为 2-5 个子主题（每个子主题是一个独立可搜索的关键词）。
目标: ${goal}

返回 JSON 数组: ["子主题1", "子主题2", ...]
如果目标已经足够简单，返回原始目标即可。`;

    try {
      const response = await this.cheapLLM.complete(prompt);
      const parsed = JSON.parse(response);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.filter((s: any) => typeof s === 'string' && s.length > 0);
      }
    } catch { /* LLM 不可用时降级 */ }
    return [goal];
  }

  /**
   * 尝试自动安装缺失工具（通过 InstallTool 或 MCP 搜索）
   */
  private async autoInstallTool(toolName: string): Promise<void> {
    log.info(`Auto-installing tool: ${toolName}`);

    // 优先委托 InstallTool
    if (this.installTool) {
      try {
        const result = await this.installTool.execute({ goal: toolName, type: 'auto' });
        if (result?.success !== false) {
          log.info(`InstallTool installed: ${toolName}`);
          return;
        }
      } catch (err) {
        log.warn(`InstallTool failed for "${toolName}":`, err);
      }
    }

    // 降级：通过 MCP 搜索查找可安装的 server
    if (this.mcpManager && typeof (this.mcpManager as any).addFromSearch === 'function') {
      await (this.mcpManager as any).addFromSearch(toolName);
      return;
    }

    // 如果没有自动安装能力，记录警告但不阻塞
    log.warn(`Cannot auto-install tool "${toolName}": no InstallTool or MCPManager available`);
  }

  async execute(goal: string, depth: 'shallow' | 'moderate' | 'deep'): Promise<LearningResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    const searchResults: string[] = [];

    log.info(`LearnEngine executing: goal="${goal}", depth=${depth}`);

    try {
      // Step 0: 子主题分解（深度模式时将复杂目标拆分为子主题）
      let subGoals: string[] = [goal];
      if ((depth === 'moderate' || depth === 'deep') && this.cheapLLM) {
        try {
          subGoals = await this.decomposeGoal(goal);
          if (subGoals.length > 1) {
            log.info(`Goal decomposed into ${subGoals.length} sub-topics: ${subGoals.join(', ')}`);
          }
        } catch (err) {
          log.warn('Sub-topic decomposition failed, using original goal:', err);
        }
      }

      // Step 1: 搜索 Web（合并所有子主题结果）
      for (const subGoal of subGoals) {
        try {
          const webResults = await this.searchWeb(subGoal);
          searchResults.push(...webResults);
        } catch (err) {
          errors.push(`Web search failed for "${subGoal}": ${err}`);
        }
      }
      // 合并子主题搜索结果后去重
      const uniqueResults = [...new Set(searchResults)];
      searchResults.length = 0;
      searchResults.push(...uniqueResults);

      // Step 2: 提取 API 规格
      let apiSpec: ApiSpec | null = null;
      try {
        apiSpec = await this.extractApiSpec(goal);
      } catch (err) {
        errors.push(`API spec extraction failed: ${err}`);
      }

      // Step 3: 深度学习时生成 MCP
      let mcpGenerated = false;
      if ((depth === 'moderate' || depth === 'deep') && apiSpec) {
        try {
          await this.generateMCP(apiSpec);
          mcpGenerated = true;
        } catch (err) {
          errors.push(`MCP generation failed: ${err}`);
        }
      }

      // Step 4: 生成 Skill
      let skillGenerated = false;
      let skillId: string | undefined;
      if (depth === 'deep' && searchResults.length > 0) {
        try {
          const skill = await this.generateSkill(goal, searchResults, apiSpec);
          if (skill && this.skillRegistry) {
            this.skillRegistry.register(skill);
            skillId = skill.id;
            skillGenerated = true;

            // 持久化到 learned/ 目录
            await this.persistSkill(skill);
          }
        } catch (err) {
          errors.push(`Skill generation failed: ${err}`);
        }
      }

      // Step 5: 检查缺失工具，尝试自动安装
      const requiredTools = this.inferRequiredTools(goal, apiSpec);
      const missing = await this.checkMissingTools(requiredTools);
      if (missing.length > 0) {
        log.info(`Missing tools detected: ${missing.join(', ')}. Attempting auto-install...`);
        for (const toolName of missing) {
          try {
            await this.autoInstallTool(toolName);
          } catch (err) {
            errors.push(`Auto-install failed for ${toolName}: ${err}`);
          }
        }
      }

      return {
        success: errors.length === 0,
        goal,
        depth,
        searchResults: searchResults.slice(0, 5),
        apiSpec,
        mcpGenerated,
        skillGenerated,
        skillId,
        errors,
        duration: Date.now() - startTime,
      };
    } catch (err) {
      log.error('LearnEngine execution failed:', err);
      return {
        success: false,
        goal,
        depth,
        searchResults,
        errors: [...errors, String(err)],
        duration: Date.now() - startTime,
      };
    }
  }

  private async searchWeb(goal: string): Promise<string[]> {
    if (!this.webSearchFn) {
      return [`Simulated search results for: ${goal}`];
    }
    return this.webSearchFn(goal);
  }

  private async extractApiSpec(goal: string): Promise<ApiSpec | null> {
    if (!this.cheapLLM) return null;

    const prompt = `从以下学习目标中提取 API 规格信息，返回 JSON：
{
  "name": "API 名称",
  "description": "一句话描述",
  "baseUrl": "基础 URL",
  "endpoints": [
    {
      "method": "GET|POST|PUT|DELETE",
      "path": "/api/...",
      "description": "端点描述",
      "parameters": { "paramName": { "type": "string|number|boolean", "description": "参数描述", "required": true|false } },
      "returns": "返回值描述"
    }
  ]
}

学习目标: ${goal}

如果目标不是 API 相关的，返回 null。`;

    try {
      const response = await this.cheapLLM.complete(prompt);
      const parsed = JSON.parse(response);
      return parsed && parsed.name ? parsed : null;
    } catch {
      return null;
    }
  }

  private async generateMCP(spec: ApiSpec): Promise<void> {
    if (!this.mcpManager || !this.baseDir) return;

    const dir = join(this.baseDir, 'mcps', `${spec.name}-mcp`);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    // 生成 MCP server.js
    const serverCode = this.buildMCPServerCode(spec);
    await writeFile(join(dir, 'server.js'), serverCode, 'utf-8');

    // 生成 package.json
    const pkgJson = {
      name: `${spec.name}-mcp`,
      version: '1.0.0',
      type: 'module',
      main: 'server.js',
      dependencies: { '@anthropic-ai/sdk': '^0.50.0' },
    };
    await writeFile(join(dir, 'package.json'), JSON.stringify(pkgJson, null, 2), 'utf-8');

    log.info(`MCP server generated: ${spec.name}-mcp`);
  }

  private buildMCPServerCode(spec: ApiSpec): string {
    const toolDefs = spec.endpoints.map((ep, i) => {
      const params = Object.entries(ep.parameters).map(([name, p]) =>
        `        ${name}: { type: '${p.type}', description: '${p.description}'${p.required ? ', required: true' : ''} }`
      ).join(',\n');
      return `  {
    name: '${spec.name}_${ep.method.toLowerCase()}_${ep.path.replace(/[\/{}]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')}',
    description: '${ep.description}',
    inputSchema: {
      type: 'object',
      properties: {
${params}
      },
    },
  }`;
    }).join(',\n');

    return `#!/usr/bin/env node
// Auto-generated MCP server: ${spec.name}
// Generated by Xuanji LearnEngine

import { Server } from '@anthropic-ai/sdk/mcp/server.js';
import { StdioServerTransport } from '@anthropic-ai/sdk/mcp/stdio.js';

const server = new Server({
  name: '${spec.name}-mcp',
  version: '1.0.0',
}, {
  capabilities: { tools: {} },
});

const tools = [
${toolDefs}
];

for (const tool of tools) {
  server.setRequestHandler('tools/call', async (request) => {
    const { name, arguments: args } = request.params;
    const matched = tools.find(t => t.name === name);
    if (!matched) throw new Error(\`Unknown tool: \${name}\`);

    try {
      const url = new URL(\`\${matched.path}\`, '${spec.baseUrl}');
      if (args) {
        for (const [key, value] of Object.entries(args)) {
          url.searchParams.set(key, String(value));
        }
      }
      const response = await fetch(url.toString());
      const data = await response.json();
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: \`Error: \${err.message}\` }], isError: true };
    }
  });
}

server.setRequestHandler('tools/list', async () => ({ tools }));

const transport = new StdioServerTransport();
await server.connect(transport);
`;
  }

  private async generateSkill(goal: string, searchResults: string[], apiSpec: ApiSpec | null): Promise<any | null> {
    if (!this.cheapLLM) return null;

    const prompt = `基于学习目标，生成一个 Skill（技能）YAML 定义：

学习目标: ${goal}
搜索结果摘要: ${searchResults.slice(0, 3).join('; ')}
${apiSpec ? `API 规格: ${JSON.stringify(apiSpec, null, 2)}` : ''}

以 JSON 格式返回 Skill 定义：
{
  "id": "learned-xxx",
  "name": "技能名称",
  "version": "1.0.0",
  "description": "技能描述",
  "category": "workflow",
  "tags": ["标签1", "标签2"],
  "requiredTools": ["需要的工具名"],
  "content": "技能的详细执行步骤..."
}`;

    try {
      const response = await this.cheapLLM.complete(prompt);
      const skill = JSON.parse(response);
      skill.id = `learned-${randomUUID().slice(0, 8)}`;
      skill.source = 'learn_tool';
      return skill;
    } catch {
      return null;
    }
  }

  private async persistSkill(skill: any): Promise<void> {
    if (!this.baseDir) return;
    const dir = join(this.baseDir, 'skills', 'learned');
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    // 输出符合 SkillMetadata + Skill 接口的标准 JSON
    // isZero→isValid ? 'isValidSkill()' 要求的字段 : id/name/version/description/category/tags
    const skillJson = {
      id: skill.id,
      name: skill.name,
      version: skill.version || '1.0.0',
      description: skill.description,
      category: (skill.category === 'workflow' || skill.category === 'action') ? skill.category : 'prompt',
      tags: Array.isArray(skill.tags) ? skill.tags : [],
      author: 'Xuanji LearnEngine',
      source: 'learned',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      content: skill.content || '',
      requiredTools: Array.isArray(skill.requiredTools) ? skill.requiredTools : [],
      enabled: true,
    };
    await writeFile(join(dir, `${skill.id}.json`), JSON.stringify(skillJson, null, 2), 'utf-8');
  }
}
