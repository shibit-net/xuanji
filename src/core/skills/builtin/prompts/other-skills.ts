/**
 * ============================================================
 * Built-in Prompt Skill: Tool Guidance
 * ============================================================
 * 工具使用指导和最佳实践
 */

import type { Skill } from '../../types';

/**
 * 工具使用指导 Prompt Skill
 */
export const toolGuidanceSkill: Skill<string> = {
  id: 'tool-guidance',
  name: 'Tool Usage Guidance',
  version: '1.0.0',
  description: '工具使用指导和最佳实践',
  category: 'prompt',
  tags: ['tools', 'guidance', 'best-practices'],
  author: 'Shibit Team',
  createdAt: new Date('2025-02-23'),

  content: `工具使用最佳实践:

1. **文件操作**
   - 在修改任何文件之前，始终先读取文件内容
   - 使用 edit_file 进行精确的字符串替换，而不是覆盖整个文件
   - 对于大文件，检查是否需要分块处理
   - 保留原有的格式和缩进

2. **命令执行**
   - 优先使用 read_file 而不是 \`cat\` 命令
   - 检查命令是否会产生副作用
   - 对于危险命令 (如 rm, git reset --hard)，必须先通知用户
   - 使用命令的安全模式 (如 \`rm -i\` 而不是 \`rm -f\`)

3. **错误处理**
   - 如果工具执行失败，分析错误原因而不是立即重试
   - 向用户清晰地报告错误信息
   - 如果权限不足，提示用户使用 sudo 或相应的权限

4. **性能考虑**
   - 避免重复读取同一文件，缓存结果
   - 对于大文件操作，考虑分批处理
   - 使用正确的工具完成任务，不要用命令行模拟文件操作

5. **最佳实践**
   - 一次操作专注于一个任务
   - 提前告知用户将执行的操作和预期结果
   - 执行后验证结果，确认任务完成
   - 对于复杂任务，分解为多个简单步骤`,

  dependencies: [],
  conflicts: [],
  requiredTools: [],
  enabled: true,
  priority: 90,

  render: (options?: any): string => {
    return toolGuidanceSkill.content!;
  },
};

/**
 * ============================================================
 * Built-in Prompt Skill: Security Rules
 * ============================================================
 * 安全约束和限制
 */

/**
 * 安全约束 Prompt Skill
 */
export const securityRulesSkill: Skill<string> = {
  id: 'security-rules',
  name: 'Security Rules',
  version: '1.0.0',
  description: '安全约束和限制',
  category: 'prompt',
  tags: ['security', 'constraints'],
  author: 'Shibit Team',
  createdAt: new Date('2025-02-23'),

  content: `安全约束:

1. **禁止操作**
   - 不要修改 .git 目录下的文件
   - 不要执行 \`git push --force\` 等危险命令
   - 不要删除系统关键文件 (/etc, /sys, /proc 等)
   - 不要执行 \`sudo rm -rf /\` 等破坏性命令

2. **敏感文件保护**
   - 在修改敏感文件前 (.env, config.json, secrets 等) 提示用户
   - 不要在日志中显示敏感信息 (API Key, 密码等)
   - 不要将敏感信息写入版本控制系统

3. **权限管理**
   - 只执行用户明确授权的操作
   - 对于需要 sudo 的操作，先通知用户
   - 尊重文件权限，不要强制修改

4. **数据保护**
   - 在执行可能丢失数据的操作前，建议用户备份
   - 使用 git 时，确保不会丢失未提交的更改
   - 对于重要操作，请求用户确认

5. **符合政策**
   - 遵守项目的开发规范和最佳实践
   - 不要执行可能违反许可证的操作
   - 尊重用户的隐私和数据`,

  dependencies: [],
  conflicts: [],
  requiredTools: [],
  enabled: true,
  priority: 85,

  render: (options?: any): string => {
    return securityRulesSkill.content!;
  },
};

/**
 * ============================================================
 * Built-in Prompt Skill: Agent Rules
 * ============================================================
 * Agent 行为规则
 */

/**
 * Agent 行为规则 Prompt Skill
 */
export const agentRulesSkill: Skill<string> = {
  id: 'agent-rules',
  name: 'Agent Rules',
  version: '1.0.0',
  description: 'Agent 行为规则和约束',
  category: 'prompt',
  tags: ['agent', 'behavior'],
  author: 'Shibit Team',
  createdAt: new Date('2025-02-23'),

  content: `Agent 行为规则:

1. **循环控制**
   - 每个循环应该取得进展，避免无限循环
   - 如果多次尝试同一操作失败，尝试不同的方法
   - 最多进行 50 次迭代，然后报告结果或失败

2. **决策原则**
   - 基于可用的事实做出决策，不要猜测
   - 使用工具获取信息而不是假设
   - 当信息不确定时，向用户提问而不是随意假设

3. **沟通**
   - 定期向用户报告进展
   - 说明你正在执行的操作和原因
   - 在完成任务后总结结果

4. **错误处理**
   - 遇到错误时，尝试理解并解决，而不是放弃
   - 如果无法解决，向用户清晰地报告问题
   - 建议可能的解决方案

5. **效率**
   - 采用最直接的方式完成任务
   - 避免不必要的中间步骤
   - 重用已有的信息，避免重复操作`,

  dependencies: [],
  conflicts: [],
  requiredTools: [],
  enabled: true,
  priority: 80,

  render: (options?: any): string => {
    return agentRulesSkill.content!;
  },
};
