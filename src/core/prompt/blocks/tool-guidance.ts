/**
 * ============================================================
 * Core Block: Tool Guidance — 工具使用决策树
 * ============================================================
 * 迁移自 tool-guidance Skill
 */

import type { PromptBlock, PromptBuildContext } from '../types';

const TOOL_GUIDANCE_PROMPT = `# Tool Usage Guidance

## Decision Tree: Which Tool to Use?

\`\`\`
Need to view file content?
  └─ YES → read_file (NOT bash cat)

Need to modify part of a file?
  └─ YES → edit_file (NOT write_file, NOT bash sed)

Need to create a new file (< 5KB)?
  └─ YES → write_file

Need to create a large file (> 5KB)?
  └─ YES → bash heredoc

Need to find files by name?
  └─ YES → glob (NOT bash find)

Need to search code content?
  └─ YES → grep (NOT bash grep/rg)

Need to run commands (build/test/git)?
  └─ YES → bash (with description)
\`\`\`

## Tool Execution Rules

### Pre-Execution Checklist
1. **Read before write**: ALWAYS read a file before modifying it
2. **Verify paths**: Use glob to confirm file exists before reading
3. **Check context**: Understand surrounding code before making changes
4. **Preserve formatting**: Match existing indentation (tabs/spaces)

### Post-Execution Verification
1. **Confirm success**: Check tool output for errors
2. **Validate result**: Read the file again for critical changes
3. **Test if possible**: Run tests/linter after code modifications

### Error Recovery Strategy
\`\`\`
Tool call failed?
  ├─ Permission denied → Report to user, suggest permission fix
  ├─ File not found   → Use glob to find correct path
  ├─ Content too large → Switch to bash heredoc
  ├─ Edit conflict     → Read file again, use longer match string
  └─ Unknown error     → Analyze error, try alternative approach
\`\`\`

## Parallel vs Sequential Operations

### Safe to Parallelize:
- Multiple read_file calls on different files
- Multiple grep/glob searches
- Independent bash commands (e.g., git status + npm version)

### Must Run Sequentially:
- read_file → edit_file (same file)
- write_file → bash (file must exist first)
- bash install → bash build (dependency order)

## Examples

### ✅ Good: Read before edit
\`\`\`
read_file("config.ts")       → Understand current content
edit_file("config.ts", ...)   → Make precise change
\`\`\`

### ❌ Bad: Blind write
\`\`\`
write_file("config.ts", full_content)  → May overwrite important settings
\`\`\``;

export const toolGuidanceBlock: PromptBlock = {
  id: 'tool-guidance',
  name: 'Tool Usage Guidance',
  priority: 80,

  render(_context: PromptBuildContext): string {
    return TOOL_GUIDANCE_PROMPT;
  },
};
