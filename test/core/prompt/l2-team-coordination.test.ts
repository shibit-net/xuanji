/**
 * l2-team-coordination 组件测试
 */

import { describe, it, expect } from 'vitest';
import { l2TeamCoordination } from '@/core/prompt/components/l2-team-coordination';

describe('l2TeamCoordination', () => {
  it('should have correct metadata', () => {
    expect(l2TeamCoordination.id).toBe('l2-team-coordination');
    expect(l2TeamCoordination.layer).toBe('L2');
    expect(l2TeamCoordination.priority).toBe(74);
    expect(l2TeamCoordination.estimatedTokens).toBe(600);
  });

  it('should render team coordination guidance', () => {
    const context = { language: 'zh' as const, toolList: [] };
    const rendered = l2TeamCoordination.render(context);

    // 验证关键内容
    expect(rendered).toContain('Multi-Agent Team Coordination');
    expect(rendered).toContain('When to Use agent_team');
    expect(rendered).toContain('Team Creation Workflow');
    expect(rendered).toContain('match_agent');
    expect(rendered).toContain('Configuration Best Practices');
    expect(rendered).toContain('Timeout Configuration');
    expect(rendered).toContain('System Prompt Guidelines');
    expect(rendered).toContain('Goal Self-Containment');
    expect(rendered).toContain('Strategy Selection Guide');
    expect(rendered).toContain('sequential');
    expect(rendered).toContain('parallel');
    expect(rendered).toContain('hierarchical');
    expect(rendered).toContain('debate');
    expect(rendered).toContain('pipeline');
    expect(rendered).toContain('Common Mistakes to Avoid');
    expect(rendered).toContain('Success Checklist');
  });

  it('should emphasize mandatory workflow', () => {
    const context = { language: 'zh' as const, toolList: [] };
    const rendered = l2TeamCoordination.render(context);

    // 验证强调的关键点
    expect(rendered).toContain('MANDATORY');
    expect(rendered).toContain('CRITICAL');
    expect(rendered).toContain('NEVER invent or guess agent IDs');
    expect(rendered).toContain('Always follow this workflow');
  });

  it('should provide clear examples', () => {
    const context = { language: 'zh' as const, toolList: [] };
    const rendered = l2TeamCoordination.render(context);

    // 验证示例代码
    expect(rendered).toContain('match_agent({');
    expect(rendered).toContain('agent_team({');
    expect(rendered).toContain('team_name:');
    expect(rendered).toContain('goal:');
    expect(rendered).toContain('strategy:');
    expect(rendered).toContain('members:');
  });

  it('should warn about common mistakes', () => {
    const context = { language: 'zh' as const, toolList: [] };
    const rendered = l2TeamCoordination.render(context);

    // 验证常见错误警告
    expect(rendered).toContain('DO NOT set member.timeout');
    expect(rendered).toContain('DO NOT embed large data');
    expect(rendered).toContain('Inventing agent IDs');
    expect(rendered).toContain('Setting member.timeout');
    expect(rendered).toContain('Embedding data in system_prompt');
  });

  it('should provide timeout recommendations', () => {
    const context = { language: 'zh' as const, toolList: [] };
    const rendered = l2TeamCoordination.render(context);

    // 验证超时建议
    expect(rendered).toContain('300000ms');
    expect(rendered).toContain('600000ms');
    expect(rendered).toContain('5 min');
    expect(rendered).toContain('10 min');
  });
});
