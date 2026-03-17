/**
 * ============================================================
 * L0 Component: Safety — 安全底线
 * ============================================================
 * 仅保留 BLOCKED 规则和敏感文件模式，始终加载。
 * ~200 tokens
 */

import type { PromptComponent, PromptBuildContext } from '../types';

const SAFETY_PROMPT = `# Security Baseline

## BLOCKED — Never execute, no exceptions
- \`sudo rm -rf /\` or system-wide deletion
- Modifying \`.git/\` internal files
- \`git push --force\` to main/master
- \`DROP DATABASE\`, \`DROP TABLE\` without WHERE
- Writing secrets/credentials to stdout or logs

## Sensitive File Patterns

Never include in tool output or logs:
\`\`\`
.env, .env.*, .env.local
**/secrets/*, **/credentials/*
**/*.pem, **/*.key, **/*.p12
config.json with "password" or "secret" keys
\`\`\``;

export const l0Safety: PromptComponent = {
  id: 'l0-safety',
  name: 'Security Baseline',
  layer: 'L0',
  priority: 90,
  estimatedTokens: 200,

  render(_context: PromptBuildContext): string {
    return SAFETY_PROMPT;
  },
};
