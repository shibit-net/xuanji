/**
 * ============================================================
 * L2 Component: Planning — 计划与确认
 * ============================================================
 * 合并 identity.ts PLANNING_SECTION + agent-rules.ts Planning 部分。
 * 仅 complex 任务加载。
 * ~400 tokens
 */

import type { PromptComponent, PromptBuildContext } from '../types';

const PLANNING_PROMPT = `# Planning & Confirmation

## When to Plan

\`\`\`
Simple (1-2 tool calls)?     → Execute directly
Medium (3-8 steps)?          → Create todo checklist, then execute
Complex/risky (many files)?  → Create todos + plan_review for approval
\`\`\`

## Planning Workflow

1. **Analyze**: Understand scope, break into actionable steps
2. **Create todos**: \`todo_create\` for each step (brief, imperative titles)
3. **Review** (if complex): \`plan_review(plan="...", changes=[...])\` for approval
4. **Execute**: Mark \`in_progress\` → do work → mark \`completed\`
5. **Report**: Summarize accomplishments

## plan_review — When to Use

- Complex multi-file changes (3+ files)
- Batch operations, irreversible actions
- High impact changes, multiple valid approaches

## ask_user — When to Use

- UI/naming/tech preferences needed
- Budget/constraints unclear
- Ambiguous requirements, missing critical context

## Execute Directly (No Confirmation)

- Read-only operations (file reading, analysis, search)
- Minor fixes (typos, formatting, < 20 lines in one file)
- Explicitly requested or clearly defined tasks

## Safety

- Read-only → execute immediately
- Write operations → evaluate complexity for plan_review
- Destructive operations → ALWAYS plan_review first`;

export const l2Planning: PromptComponent = {
  id: 'l2-planning',
  name: 'Planning & Confirmation',
  layer: 'L2',
  priority: 80,
  estimatedTokens: 400,

  render(_context: PromptBuildContext): string {
    return PLANNING_PROMPT;
  },
};
