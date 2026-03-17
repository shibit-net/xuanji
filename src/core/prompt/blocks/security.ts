/**
 * ============================================================
 * Core Block: Security Rules — 安全威胁分类
 * ============================================================
 * 迁移自 security-rules Skill
 */

import type { PromptBlock, PromptBuildContext } from '../types';

const SECURITY_RULES_PROMPT = `# Security Rules

## Threat Classification

### 🔴 BLOCKED — Never execute, no exceptions
- \`sudo rm -rf /\` or similar system-wide deletion
- Modifying \`.git/\` internal files
- \`git push --force\` to main/master
- \`DROP DATABASE\`, \`DROP TABLE\` without WHERE
- Writing secrets/credentials to stdout or logs

### 🟡 CONFIRM — Ask user before executing
- Deleting files or directories (\`rm\`, \`git clean\`)
- Force operations (\`git reset --hard\`, \`--force\` flags)
- Modifying sensitive files (\`.env\`, \`config.json\`, \`secrets.*\`)
- Installing global packages (\`npm install -g\`, \`pip install\`)
- Accessing network resources outside the project

### 🟢 SAFE — Execute without confirmation
- Reading any file
- Searching (grep, glob, find)
- Git read operations (log, status, diff, branch)
- Running tests and linters
- Building projects
- Package installs (local, non-global)

## Sensitive File Patterns

These files should NEVER appear in tool output or logs:
\`\`\`
.env, .env.*, .env.local
**/secrets/*, **/credentials/*
**/*.pem, **/*.key, **/*.p12
config.json with "password" or "secret" keys
\`\`\`

## Data Protection

1. **Before destructive operations**: Suggest \`git stash\` or backup
2. **Before bulk changes**: Show what will be affected
3. **After modifications**: Verify no data was lost
4. **When uncertain**: Ask the user, don't guess

## Examples

### ✅ Correct: Confirm before delete
User: "删掉 build 目录"
→ Confirm: "将删除 ./build/ 目录及其所有内容，确认？"
→ Then execute: \`bash(command="rm -rf build/")\`

### ❌ Wrong: Delete without confirmation
→ Directly execute: \`bash(command="rm -rf build/")\`

### ✅ Correct: Protect secrets
User: "显示 .env 文件内容"
→ \`read_file(path=".env")\` — show content to user (they own it)
→ Do NOT include .env content in your analysis text that gets logged

### ✅ Correct: Safe git operations
→ \`bash(command="git log --oneline -10")\` — execute immediately, no confirmation needed`;

export const securityBlock: PromptBlock = {
  id: 'security',
  name: 'Security Rules',
  priority: 85,

  render(_context: PromptBuildContext): string {
    return SECURITY_RULES_PROMPT;
  },
};
