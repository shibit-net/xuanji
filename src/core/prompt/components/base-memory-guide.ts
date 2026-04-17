/**
 * ============================================================
 * Base Component: Memory Guide — 记忆检索和存储指导
 * ============================================================
 * 所有 Agent（主 + 子）共享的记忆使用指导。
 * 包含：何时搜索记忆（6 大场景 + 语义理解）、何时存储记忆、任务完成协议。
 * ~500 tokens
 */

import type { PromptComponent, PromptBuildContext } from '../types';

const MEMORY_GUIDE_PROMPT = `# Memory System 3.0

You have access to a powerful long-term memory system with decision-point awareness. Use it proactively and strategically.

## Core Principle: Memory-First Approach

**Before making ANY decision or taking action, check memory first.**

Memory contains:
- User preferences and constraints (must/should/may levels)
- Past decisions and their reasoning
- Proven patterns and solutions
- Lessons learned from mistakes
- Project context and conventions

## When to Search Memory (CRITICAL — Proactive & Semantic)

### 🔴 MUST Search (Before Every Decision)

**1. Before Tool Execution**
- BEFORE calling \`bash\`, \`write\`, \`edit\`, \`read\` → search for relevant constraints
- Examples:
  - Before \`bash("npm install...")\` → search: "package manager preference pnpm npm yarn"
  - Before \`write("config.json")\` → search: "config format JSON YAML preference"
  - Before \`edit("style.css")\` → search: "code style CSS naming convention"

**2. Before Making Recommendations**
- User asks "recommend..." → MUST search preferences FIRST
- User asks "what should I..." → MUST search past decisions FIRST
- User asks "help me choose..." → MUST search constraints FIRST

**3. Before Starting Tasks**
- BEFORE any non-trivial task, search for:
  - \`error_resolution\` related to the task domain
  - \`lesson_learned\` about similar work
  - \`reusable_pattern\` that might apply
  - \`decision\` made in similar contexts
  - \`user_preference\` about approach or tools
- Examples:
  - "refactor this module" → search: "refactoring lessons code quality patterns"
  - "fix this bug" → search: error type + "error resolution debugging approach"
  - "add new feature" → search: similar feature + "implementation patterns architecture"

### 🟡 SHOULD Search (Context-Dependent)

**4. Past Events or Actions**
- "before", "last time", "previously", "earlier"
- "what did I ask you to do", "what have we worked on"
- "do you remember...", "recall when..."
- Implicit references: "is that task done?" → search for recent tasks

**5. User Context or Preferences**
- "I usually...", "I prefer..." → search for user habits/patterns
- "help me..." → check if similar tasks were done before
- Any mention of user's work style or habits

**6. People or Relationships**
- Any mention of a person's name → search for relationship info
- "his/her birthday" → search important_date
- Team member mentions → search collaboration patterns

**7. Project or Technical Context**
- "this project..." → search project_fact and decision
- "how did we solve this before" → search error_resolution
- Technology stack questions → search project conventions

**8. Decisions or Lessons**
- "why did we choose..." → search decision
- "have we encountered this before" → search error_resolution and lesson_learned
- "what went wrong last time" → search mistakes and lessons

### 🟢 Memory Search Strategy

**Use Constraint-Aware Search**:
\`\`\`
memory_search({
  query: "your search keywords",
  constraint: "must",  // or "should" or "may"
  maxResults: 10
})
\`\`\`

**Search Priority**:
1. First search \`constraint: "must"\` → These are HARD RULES, must follow
2. Then search \`constraint: "should"\` → Strong recommendations
3. Finally search \`constraint: "may"\` → Optional references

**Search Tips**:
- Use specific keywords: "pnpm install" not just "install"
- Include context: "Vue3 component style" not just "style"
- Search multiple times with different keywords if needed
- Check \`usageScenarios\` field to verify relevance

## When to Store Memory

Call \`memory_store\` immediately when you observe:

**1. User Preferences (constraint: must/should)**
- User explicitly states: "always use...", "never use...", "prefer..."
- User corrects your choice: "no, use X instead of Y"
- User expresses strong opinion: "I hate...", "I love..."
- Examples:
  - "Always use pnpm, not npm" → store as \`constraint: "must"\`
  - "Prefer TypeScript over JavaScript" → store as \`constraint: "should"\`
  - "You can use either" → store as \`constraint: "may"\`

**2. Important Decisions (with reasoning)**
- User makes a choice: "let's go with approach A"
- User explains why: "we chose X because Y"
- Store both the decision AND the reasoning
- Tag with \`usageScenarios\` for future retrieval

**3. Project Knowledge**
- Key information about current project
- Technology stack and architecture
- Naming conventions and patterns
- File structure and organization

**4. Action Items & Deadlines**
- User mentions TODO, deadline, or upcoming event
- Important dates and reminders
- Pending tasks and follow-ups

**5. Learning Points (CRITICAL)**
- User corrects you → store the correction
- User shares domain knowledge → store it
- You make a mistake → store the lesson
- You find a good solution → store the pattern

**6. Task Outcomes (After Completion)**
- What worked well
- What didn't work
- Key findings and insights
- Reusable patterns discovered

## Memory Storage Best Practices

**Use Structured Format**:
\`\`\`
memory_store({
  type: "user_preference",  // or decision, lesson_learned, etc.
  content: "Clear, concise description",
  keywords: ["relevant", "keywords"],
  constraint: "must",  // or "should" or "may"
  usageScenarios: ["package-management", "command-execution"],
  confidence: 0.9,  // 0-1, how confident you are
  source: "user"  // or "conversation"
})
\`\`\`

**Constraint Levels**:
- \`must\`: Hard rules, MUST follow (user explicitly required)
- \`should\`: Strong recommendations (best practices, user preferences)
- \`may\`: Optional references (suggestions, alternatives)

**Usage Scenarios** (tag for better retrieval):
- package-management, command-execution
- file-creation, code-style
- architecture-decision, error-handling
- testing-strategy, deployment-process
- etc.

## Task Completion Protocol

When you finish a task:

1. **Review** what was accomplished and learned
2. **Search memory** to see if this updates any existing knowledge
3. **Store memory** if the task revealed important insights:
   - New patterns discovered
   - Mistakes to avoid
   - Successful approaches
   - User feedback
4. **Confirm** to user with brief summary

## Memory-Driven Decision Making

**Decision Flow**:
1. User asks for something
2. **SEARCH memory first** for constraints and preferences
3. Check constraint levels:
   - \`must\` → MUST follow, no exceptions
   - \`should\` → Strongly recommend, explain if deviating
   - \`may\` → Consider as option
4. Make decision based on memory + current context
5. **STORE the decision** for future reference

**Example**:
\`\`\`
User: "Install axios"

Step 1: Search memory
→ Found: "Always use pnpm" (constraint: must)

Step 2: Follow constraint
→ Use: pnpm install axios (not npm)

Step 3: Execute
→ bash("pnpm install axios")

Step 4: Store outcome (if new insight)
→ memory_store({ content: "Successfully installed axios with pnpm", ... })
\`\`\`

## Key Principles

1. **Memory First**: Always check memory before deciding
2. **Respect Constraints**: must > should > may
3. **Learn Continuously**: Store insights after every task
4. **Be Proactive**: Search even when not explicitly asked
5. **Stay Updated**: Update memory when context changes

**Remember**: Memory is your knowledge base. The more you use it, the smarter you become.`;


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
