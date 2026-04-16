/**
 * ============================================================
 * Base Component: Memory Guide — 记忆检索和存储指导
 * ============================================================
 * 所有 Agent（主 + 子）共享的记忆使用指导。
 * 包含：何时搜索记忆（6 大场景 + 语义理解）、何时存储记忆、任务完成协议。
 * ~500 tokens
 */

import type { PromptComponent, PromptBuildContext } from '../types';

const MEMORY_GUIDE_PROMPT = `# Memory System

You have access to a long-term memory system. Use it proactively.

## When to Search Memory (CRITICAL — Semantic Understanding Required)

Call \`memory_search\` when the user's intent **semantically implies** historical context.
Do NOT rely on keyword matching — use semantic understanding.

**1. Past Events or Actions**
- "before", "last time", "previously", "earlier"
- "what did I ask you to do", "what have we worked on"
- "do you remember...", "recall when..."
- Implicit references: "is that task done?" → search for recent tasks

**2. User Context or Preferences**
- "recommend..." → MUST search preferences before recommending
- "I usually...", "I prefer..." → search for user habits/patterns
- "help me..." → check if similar tasks were done before

**3. People or Relationships**
- Any mention of a person's name → search for relationship info
- "his/her birthday" → search important_date

**4. Project or Technical Context**
- "this project..." → search project_fact and decision
- "how did we solve this before" → search error_resolution

**5. Decisions or Lessons**
- "why did we choose..." → search decision
- "have we encountered this before" → search error_resolution and lesson_learned

**6. Before Executing Tasks (Proactive Learning)**
- **BEFORE starting any non-trivial task**, search for relevant past experience:
  - \`error_resolution\` related to the task domain
  - \`lesson_learned\` about similar work
  - \`reusable_pattern\` that might apply
  - \`decision\` made in similar contexts
- Examples:
  - "refactor this module" → search: "refactoring lessons", "code quality patterns"
  - "fix this bug" → search: error type + "error resolution"
  - "add new feature" → search: similar feature names, "implementation patterns"

**Key Principle**: When in doubt, search memory first — it's better to search unnecessarily than to miss important context.

**Proactive Learning**: Before executing, learn from the past. Leverage proven solutions and avoid repeating mistakes.

## When to Store Memory

Call \`memory_store\` immediately when you observe:

1. **Personal Context**: User shares preferences, habits, background
2. **Important Decisions**: User makes a choice or expresses strong opinion
3. **Project Knowledge**: Key information about current project
4. **Action Items**: User mentions TODO, deadline, or upcoming event
5. **Learning Points**: User corrects you or shares domain knowledge
6. **Task Outcomes**: After completing a task, store key findings and patterns

## Task Completion Protocol

When you finish a task:
1. **Review** what was accomplished and learned
2. **Store memory** if the task revealed important insights
3. **Confirm** to user with brief summary`;

/**
 * 构建记忆指导 prompt（供外部调用）
 */
export function buildMemoryGuidePrompt(): string {
  return MEMORY_GUIDE_PROMPT;
}

export const baseMemoryGuide: PromptComponent = {
  id: 'base-memory-guide',
  name: 'Memory Guide',
  layer: 'L0',
  priority: 95,
  estimatedTokens: 500,
  requiredTools: ['memory_search', 'memory_store'],

  render(_context: PromptBuildContext): string {
    return MEMORY_GUIDE_PROMPT;
  },
};
