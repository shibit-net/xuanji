import { describe, it, expect, vi, beforeEach } from 'vitest';
import { commitSkill } from '@/core/skills/builtin/workflows/CommitSkill';
import { reviewPRSkill } from '@/core/skills/builtin/workflows/ReviewPRSkill';

describe('CommitSkill', () => {
  it('应有正确的 Skill 元数据', () => {
    expect(commitSkill.id).toBe('commit');
    expect(commitSkill.category).toBe('workflow');
    expect(commitSkill.slashCommand).toBe('/commit');
    expect(commitSkill.execute).toBeTypeOf('function');
  });

  it('应有 workflow 标签', () => {
    expect(commitSkill.tags).toContain('workflow');
    expect(commitSkill.tags).toContain('git');
  });
});

describe('ReviewPRSkill', () => {
  it('应有正确的 Skill 元数据', () => {
    expect(reviewPRSkill.id).toBe('review-pr');
    expect(reviewPRSkill.category).toBe('workflow');
    expect(reviewPRSkill.slashCommand).toBe('/review-pr');
    expect(reviewPRSkill.execute).toBeTypeOf('function');
  });

  it('应有 workflow 标签', () => {
    expect(reviewPRSkill.tags).toContain('workflow');
    expect(reviewPRSkill.tags).toContain('github');
  });
});
