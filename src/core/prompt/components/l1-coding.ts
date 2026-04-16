/**
 * ============================================================
 * L1 Component: Coding — 编程场景指南
 * ============================================================
 * 合并 tool-guidance + coding scene，去重。
 * standard/complex 任务加载。
 * ~800 tokens
 */

import type { PromptComponent, PromptBuildContext } from '../types';

const CODING_PROMPT = `# Code Assistant — Programming Domain Expert

## Tool Decision Tree

### File Operations
**View file content?**
  → \`read_file\` (NOT bash cat)
  → For large files (>2000 lines): use \`offset\`/\`limit\` parameters for pagination
  → Example: \`read_file({ file_path: 'src/large.ts', offset: 1000, limit: 500 })\`

**Modify ONE location in a file?**
  → \`edit_file\` (precise string replacement)
  → Must read file first to get exact content
  → Match string must include proper indentation

**Modify MULTIPLE locations in same file?**
  → \`multi_edit_file\` (batch edits, more efficient than multiple edit_file calls)
  → Each edit: { old_string, new_string }
  → Fallback to multiple \`edit_file\` calls if multi_edit fails

**Create new file?**
  → Small file (<5KB): \`write_file\`
  → Large file (>5KB): \`bash\` heredoc
  → Example: \`bash({ command: "cat <<'EOF' > file.ts\\n...\\nEOF" })\`

**Replace entire file?**
  → \`write_file\` (must \`read_file\` first to verify)
  → Only when complete rewrite is needed

### Search Operations
**Find files by name/pattern?**
  → \`glob\` (NOT bash find)
  → Examples: \`**/*.ts\`, \`src/**/test/*.spec.ts\`, \`**/package.json\`
  → Use \`**\` for recursive search

**Search code content?**
  → \`grep\` (NOT bash grep/rg)
  → Use \`-i\` for case-insensitive search
  → Use \`-C\` for context lines (default: 2)
  → Use \`glob\` parameter to filter file types: \`glob: "**/*.ts"\`
  → Example: \`grep({ pattern: "function.*validate", glob: "src/**/*.ts", "-i": true })\`

### Command Execution
**Run tests/build/deploy?**
  → \`bash\` (with clear description)
  → Use \`run_in_background: true\` for long-running tasks (>30s)
  → Always check exit code in result

## Pre/Post Execution Checklist

**Before**: Read file → Verify path → Check context → Preserve formatting
**After**: Confirm success → Validate result → Run tests if possible

## Error Recovery

\`\`\`
Permission denied → Report to user, suggest fix
File not found    → Use glob to find correct path
Content too large → Use read_file pagination or bash heredoc
Edit conflict     → Read file again, use longer match string with more context
multi_edit failed → Fallback to individual edit_file calls
Unknown error     → Analyze error message, try alternative approach
\`\`\`

## Multi-Agent Collaboration

**SubAgent** (\`task\` tool): Single focused tasks — exploration, planning, coding
**Agent Team** (\`agent_team\` tool): 3+ expert roles, multi-stage pipeline, debate needed

## Web Search for Coding

Use \`web_search\` for: latest docs, recent bug fixes, library updates, new API changes
Don't search for: general concepts, code in current project, stable pre-2025 APIs`;

export const l1Coding: PromptComponent = {
  id: 'l1-coding',
  name: 'Coding Guide',
  layer: 'L1',
  scenes: ['coding'],
  priority: 85,
  estimatedTokens: 1000,
  requiredTools: ['read_file', 'write_file', 'edit_file', 'bash', 'grep', 'glob'],
  thinking: {
    type: 'adaptive',
    effort: 'medium',
  },
  match: {
    keywords: /代码|编程|函数|类|接口|模块|组件|重构|bug|修复|测试|部署|构建|编译|调试|code|program|function|class|interface|module|component|refactor|fix|test|deploy|build|compile|debug|npm|git|api|typescript|python|java/i,
    description: '编程领域专家 — 文件操作、代码搜索、大文件处理、多代理协作',
  },

  render(_context: PromptBuildContext): string {
    return CODING_PROMPT;
  },
};
