import { describe, it, expect } from 'vitest';
import { SkillRegistry } from '@/core/skills/registry';
import { initializeBuiltinSkills } from '@/core/skills/builtin/init';

describe('Built-in Skills', () => {
  describe('initializeBuiltinSkills', () => {
    it('should register workflow skills only', () => {
      const registry = new SkillRegistry();
      initializeBuiltinSkills(registry);

      expect(registry.has('commit')).toBe(true);
      expect(registry.has('review-pr')).toBe(true);
    });

    it('should register correct number of skills', () => {
      const registry = new SkillRegistry();
      initializeBuiltinSkills(registry);

      const stats = registry.getStats();
      expect(stats.totalSkills).toBe(2);
      expect(stats.byCategory.workflow).toBe(2);
    });

    it('should not register any prompt skills', () => {
      const registry = new SkillRegistry();
      initializeBuiltinSkills(registry);

      // 旧的 prompt skills 不应存在
      expect(registry.has('xuanji-assistant')).toBe(false);
      expect(registry.has('code-assistant')).toBe(false);
      expect(registry.has('tool-guidance')).toBe(false);
      expect(registry.has('security-rules')).toBe(false);
      expect(registry.has('agent-rules')).toBe(false);
      expect(registry.has('life-secretary')).toBe(false);
    });
  });

  describe('workflow skills', () => {
    it('commit skill should have correct metadata', () => {
      const registry = new SkillRegistry();
      initializeBuiltinSkills(registry);

      const commit = registry.get('commit');
      expect(commit).toBeDefined();
      expect(commit!.category).toBe('workflow');
      expect(commit!.slashCommand).toBeDefined();
    });

    it('review-pr skill should have correct metadata', () => {
      const registry = new SkillRegistry();
      initializeBuiltinSkills(registry);

      const reviewPr = registry.get('review-pr');
      expect(reviewPr).toBeDefined();
      expect(reviewPr!.category).toBe('workflow');
    });

    it('getWorkflowCommands should return slash commands', () => {
      const registry = new SkillRegistry();
      initializeBuiltinSkills(registry);

      const commands = registry.getWorkflowCommands();
      expect(commands.length).toBeGreaterThan(0);
      expect(commands.some(c => c.skillId === 'commit')).toBe(true);
    });
  });
});
