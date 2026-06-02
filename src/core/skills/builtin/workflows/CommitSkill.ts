/**
 * ============================================================
 * Workflow Skill: /commit — 智能 Git 提交
 * ============================================================
 *
 * 自动分析 git diff，调用 LLM 生成符合 Conventional Commits 规范的提交信息，
 * 经用户确认后创建 Git commit。
 */

import type { Skill, WorkflowResult } from '@/core/skills/types';
import { execSync, execFileSync } from 'node:child_process';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'CommitSkill' });

export const commitSkill: Skill = {
  id: 'commit',
  name: 'Smart Commit',
  version: '1.0.0',
  description: '自动生成提交信息并创建 Git commit。分析 git diff，生成符合 Conventional Commits 规范的提交信息。',
  category: 'workflow',
  tags: ['git', 'commit'],
  slashCommand: '/commit',
  priority: 10,
  moduleType: 'skill',
  intentMeta: {
    type: 'coding.git-commit',
    domain: 'coding',
    name: '智能 Git 提交',
    description: '自动分析变更生成规范的 Git commit 信息',
    trainingExamples: [
      '帮我提交代码',
      '生成 commit 信息',
      '我想提交这些改动',
      'git commit 一下',
      '帮我写提交信息',
      '提交当前更改',
      'commit my changes',
      'create a git commit',
      'generate commit message',
      'submit my code changes',
    ],
    priority: 80,
  },
  requiredTools: ['bash'],

  async render(options?: any): Promise<string> {
    const result = await (this as any).execute(options?.params);
    return result.output ?? result.error ?? '';
  },

  async execute(params?: Record<string, any>): Promise<WorkflowResult> {
    try {
      // 1. 检查 git 是否可用
      try {
        execSync('git rev-parse --is-inside-work-tree', { stdio: 'ignore' });
      } catch {
        return { success: false, error: '当前目录不是 Git 仓库' };
      }

      // 2. 获取 git status
      const status = execSync('git status --porcelain', { encoding: 'utf-8' }).trim();
      if (!status) {
        return { success: false, error: '没有待提交的更改' };
      }

      // 3. 获取 staged changes
      const stagedDiff = execSync('git diff --staged', { encoding: 'utf-8' }).trim();
      const unstagedDiff = execSync('git diff', { encoding: 'utf-8' }).trim();

      // 如果没有 staged changes，提示用户先 git add
      if (!stagedDiff && unstagedDiff) {
        return {
          success: false,
          error: '没有已暂存的更改。请先运行 `git add` 暂存文件，然后再使用 /commit。\n\n' +
                 `当前未暂存的更改:\n${status}`,
        };
      }

      if (!stagedDiff && !unstagedDiff) {
        return { success: false, error: '没有已暂存的更改' };
      }

      // 4. 如果用户提供了 message，直接使用
      if (params?.message) {
        try {
          // 使用 execFileSync 避免 shell 命令注入
          execFileSync('git', ['commit', '-m', params.message], {
            encoding: 'utf-8',
            stdio: 'pipe',
          });
          return {
            success: true,
            output: `提交成功\n\n${params.message}`,
            metadata: { commitMessage: params.message },
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { success: false, error: `Git commit 失败: ${msg}` };
        }
      }

      // 5. 返回 diff 信息让 LLM 生成提交消息
      // （实际的 LLM 调用由 ChatSession 处理，Workflow 返回 diff 上下文）
      const diffSummary = stagedDiff.length > 5000
        ? stagedDiff.substring(0, 5000) + '\n\n... (diff 已截断)'
        : stagedDiff;

      return {
        success: true,
        output: `已暂存的更改:\n\`\`\`\n${status}\n\`\`\`\n\nDiff 摘要:\n\`\`\`diff\n${diffSummary}\n\`\`\`\n\n` +
                `请根据以上 diff 生成一条符合 Conventional Commits 规范的提交信息，然后调用 bash 工具执行 git commit。`,
        metadata: {
          status,
          stagedDiffLength: stagedDiff.length,
          needsLLMMessage: true,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error('Commit workflow failed:', err);
      return { success: false, error: `提交工作流失败: ${message}` };
    }
  },
};
