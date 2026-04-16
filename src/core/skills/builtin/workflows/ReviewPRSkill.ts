/**
 * ============================================================
 * Workflow Skill: /review-pr — PR 代码审查
 * ============================================================
 *
 * 获取 GitHub PR 的 diff，返回给 LLM 进行代码审查分析。
 * 需要 gh CLI 工具已安装并认证。
 */

import type { Skill, WorkflowResult } from '@/core/skills/types';
import { execSync } from 'node:child_process';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'ReviewPRSkill' });

export const reviewPRSkill: Skill = {
  id: 'review-pr',
  name: 'PR Code Review',
  version: '1.0.0',
  description: '分析 GitHub PR 并生成代码审查报告。需要 gh CLI 已安装并认证。',
  category: 'workflow',
  tags: ['git', 'github', 'pr', 'review', 'workflow'],
  slashCommand: '/review-pr',
  priority: 10,
  moduleType: 'skill',
  intentMeta: {
    type: 'coding.pr-review',
    domain: 'coding',
    name: 'PR 代码审查',
    description: '获取 GitHub PR diff 并生成代码审查报告',
    trainingExamples: [
      '帮我 review 这个 PR',
      '审查一下这个 pull request',
      '看看这个 PR 有没有问题',
      'review PR #123',
      '代码审查',
      '帮我看看这次提交的代码质量',
      'review my pull request',
      'check this PR for issues',
      'code review for PR',
      'analyze pull request changes',
    ],
    priority: 80,
  },
  requiredTools: ['bash'],

  async execute(params?: Record<string, any>): Promise<WorkflowResult> {
    try {
      const prNumber = params?.pr_number || params?.args;

      // 1. 检查 gh CLI 是否可用
      try {
        execSync('gh --version', { stdio: 'ignore' });
      } catch {
        return {
          success: false,
          error: '未安装 gh CLI。请运行 `brew install gh` (macOS) 或参考 https://cli.github.com/ 安装。',
        };
      }

      // 2. 检查是否在 Git 仓库中
      try {
        execSync('git rev-parse --is-inside-work-tree', { stdio: 'ignore' });
      } catch {
        return { success: false, error: '当前目录不是 Git 仓库' };
      }

      // 3. 如果未指定 PR 号，列出最近的 PR
      if (!prNumber) {
        try {
          const prList = execSync(
            'gh pr list --limit 5 --json number,title,author,state --template "{{range .}}#{{.number}} {{.title}} (@{{.author.login}}) [{{.state}}]\n{{end}}"',
            { encoding: 'utf-8' },
          ).trim();

          if (!prList) {
            return { success: false, error: '当前仓库没有开放的 PR' };
          }

          return {
            success: true,
            output: `最近的 PR:\n${prList}\n\n请指定 PR 号码，如: /review-pr 123`,
            metadata: { needsPRNumber: true },
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { success: false, error: `获取 PR 列表失败: ${msg}` };
        }
      }

      // 4. 获取 PR 信息
      let prInfo: string;
      try {
        prInfo = execSync(
          `gh pr view ${prNumber} --json title,body,files,commits,additions,deletions,changedFiles`,
          { encoding: 'utf-8' },
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, error: `获取 PR #${prNumber} 信息失败: ${msg}` };
      }

      const pr = JSON.parse(prInfo);

      // 5. 获取 PR diff
      let diff: string;
      try {
        diff = execSync(`gh pr diff ${prNumber}`, { encoding: 'utf-8' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, error: `获取 PR #${prNumber} diff 失败: ${msg}` };
      }

      // 截断过长的 diff
      const maxDiffLength = 15000;
      const truncatedDiff = diff.length > maxDiffLength
        ? diff.substring(0, maxDiffLength) + '\n\n... (diff 已截断，完整 diff 共 ' + diff.length + ' 字符)'
        : diff;

      // 6. 构建审查上下文
      const fileList = pr.files?.map((f: any) => `- ${f.path} (+${f.additions} -${f.deletions})`).join('\n') ?? '';

      const reviewContext = [
        `# PR #${prNumber} 代码审查`,
        '',
        `**标题**: ${pr.title}`,
        `**变更**: +${pr.additions} -${pr.deletions}，${pr.changedFiles} 个文件`,
        '',
        pr.body ? `**描述**:\n${pr.body}\n` : '',
        `**变更文件**:\n${fileList}`,
        '',
        '**Diff**:',
        '```diff',
        truncatedDiff,
        '```',
        '',
        '请作为代码审查者分析以上 PR:',
        '1. 代码质量评分 (1-10)',
        '2. 潜在问题（bug、性能、安全）',
        '3. 改进建议',
        '4. 是否建议合并',
      ].join('\n');

      return {
        success: true,
        output: reviewContext,
        metadata: {
          prNumber: Number(prNumber),
          title: pr.title,
          additions: pr.additions,
          deletions: pr.deletions,
          changedFiles: pr.changedFiles,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error('Review PR workflow failed:', err);
      return { success: false, error: `PR 审查工作流失败: ${message}` };
    }
  },
};
