import { describe, it, expect } from 'vitest';
import { SkillRegistry } from '@/core/skills/registry';
import {
  xuanjiAssistantSkill,
  codeAssistantSkill,
  toolGuidanceSkill,
  securityRulesSkill,
  agentRulesSkill,
  projectRulesSkill,
  memoryContextSkill,
  lifeSecretarySkill,
} from '@/core/skills/builtin/prompts';
import { initializeBuiltinSkills } from '@/core/skills/builtin/init';

describe('Built-in Skills', () => {
  // ============================================================
  // Skill 注册
  // ============================================================

  describe('initializeBuiltinSkills', () => {
    it('should register all built-in skills', () => {
      const registry = new SkillRegistry();
      initializeBuiltinSkills(registry);

      expect(registry.has('xuanji-assistant')).toBe(true);
      expect(registry.has('code-assistant')).toBe(true);
      expect(registry.has('tool-guidance')).toBe(true);
      expect(registry.has('security-rules')).toBe(true);
      expect(registry.has('agent-rules')).toBe(true);
      expect(registry.has('project-rules')).toBe(true);
      expect(registry.has('memory-context')).toBe(true);
      expect(registry.has('life-secretary')).toBe(true);
    });

    it('should register correct number of skills', () => {
      const registry = new SkillRegistry();
      initializeBuiltinSkills(registry);

      const stats = registry.getStats();
      expect(stats.totalSkills).toBe(10);
    });
  });

  // ============================================================
  // xuanji-assistant (通用助手)
  // ============================================================

  describe('xuanji-assistant', () => {
    it('should have correct metadata', () => {
      expect(xuanjiAssistantSkill.id).toBe('xuanji-assistant');
      expect(xuanjiAssistantSkill.category).toBe('prompt');
      expect(xuanjiAssistantSkill.priority).toBe(100);
      expect(xuanjiAssistantSkill.version).toBe('4.0.0');
    });

    it('should be positioned as an AI butler (v4.0.0)', () => {
      const content = xuanjiAssistantSkill.content!;
      expect(content).toContain('AI butler');
      expect(content).toContain('Life Assistant Behavior');
      expect(content).toContain('Memory-Driven Personalization');
    });

    it('should NOT mention "coding agent" in content', () => {
      const content = xuanjiAssistantSkill.content!;
      expect(content).not.toContain('coding agent');
      expect(content).not.toContain('AI coding');
    });

    it('should be positioned as a general AI assistant', () => {
      const content = xuanjiAssistantSkill.content!;
      expect(content).toContain('AI butler');
      expect(content).toContain('both work and life tasks');
    });

    it('should mention Skill composition', () => {
      const content = xuanjiAssistantSkill.content!;
      expect(content).toContain('Skill Composition');
      expect(content).toContain('domain-specific skills');
    });

    it('should render without dependencies', () => {
      const result = xuanjiAssistantSkill.render!();
      expect(typeof result).toBe('string');
      expect(result).toContain('Xuanji');
    });

    it('should include project-rules when dependency is provided', () => {
      const result = xuanjiAssistantSkill.render!({
        params: {
          dependencies: {
            'project-rules': '## Project Context\nThis is a TypeScript project.',
          },
        },
      });
      expect(result).toContain('Project Context');
      expect(result).toContain('TypeScript project');
    });
  });

  // ============================================================
  // code-assistant (编程领域)
  // ============================================================

  describe('code-assistant', () => {
    it('should have correct metadata', () => {
      expect(codeAssistantSkill.id).toBe('code-assistant');
      expect(codeAssistantSkill.category).toBe('prompt');
      expect(codeAssistantSkill.priority).toBe(85);
    });

    it('should include tool usage guidelines for all key tools', () => {
      const content = codeAssistantSkill.content!;
      expect(content).toContain('read_file');
      expect(content).toContain('write_file');
      expect(content).toContain('edit_file');
      expect(content).toContain('grep');
      expect(content).toContain('glob');
      expect(content).toContain('bash');
    });

    it('should include DO/DON\'T examples', () => {
      const content = codeAssistantSkill.content!;
      expect(content).toContain('✅ DO');
      expect(content).toContain('❌ DON\'T');
    });

    it('should mention large file strategy', () => {
      const content = codeAssistantSkill.content!;
      expect(content).toContain('Large File Strategy');
      expect(content).toContain('heredoc');
      expect(content).toContain('5KB');
    });

    it('should declare required tools', () => {
      expect(codeAssistantSkill.requiredTools).toContain('read_file');
      expect(codeAssistantSkill.requiredTools).toContain('edit_file');
      expect(codeAssistantSkill.requiredTools).toContain('bash');
    });

    it('should render as string', () => {
      const result = codeAssistantSkill.render!();
      expect(typeof result).toBe('string');
      expect(result).toContain('Code Assistant');
    });
  });

  // ============================================================
  // tool-guidance (工具决策树)
  // ============================================================

  describe('tool-guidance', () => {
    it('should include decision tree', () => {
      const content = toolGuidanceSkill.content!;
      expect(content).toContain('Decision Tree');
    });

    it('should include error recovery strategy', () => {
      const content = toolGuidanceSkill.content!;
      expect(content).toContain('Error Recovery');
      expect(content).toContain('Permission denied');
      expect(content).toContain('File not found');
    });

    it('should include parallel vs sequential guidance', () => {
      const content = toolGuidanceSkill.content!;
      expect(content).toContain('Safe to Parallelize');
      expect(content).toContain('Must Run Sequentially');
    });
  });

  // ============================================================
  // security-rules (安全分级)
  // ============================================================

  describe('security-rules', () => {
    it('should have threat classification levels', () => {
      const content = securityRulesSkill.content!;
      expect(content).toContain('BLOCKED');
      expect(content).toContain('CONFIRM');
      expect(content).toContain('SAFE');
    });

    it('should list sensitive file patterns', () => {
      const content = securityRulesSkill.content!;
      expect(content).toContain('.env');
      expect(content).toContain('*.pem');
      expect(content).toContain('*.key');
    });

    it('should include examples', () => {
      const content = securityRulesSkill.content!;
      expect(content).toContain('Correct');
      expect(content).toContain('Wrong');
    });
  });

  // ============================================================
  // agent-rules (循环控制)
  // ============================================================

  describe('agent-rules', () => {
    it('should include loop control', () => {
      const content = agentRulesSkill.content!;
      expect(content).toContain('Loop Control');
      expect(content).toContain('Iteration Budget');
    });

    it('should include stuck detection', () => {
      const content = agentRulesSkill.content!;
      expect(content).toContain('Stuck Detection');
    });

    it('should include decision making rules', () => {
      const content = agentRulesSkill.content!;
      expect(content).toContain('Decision Making');
      expect(content).toContain('When to Ask');
    });
  });

  // ============================================================
  // life-secretary (生活秘书)
  // ============================================================

  describe('life-secretary', () => {
    it('should have correct metadata', () => {
      expect(lifeSecretarySkill.id).toBe('life-secretary');
      expect(lifeSecretarySkill.category).toBe('prompt');
      expect(lifeSecretarySkill.priority).toBe(90);
      expect(lifeSecretarySkill.version).toBe('2.0.0');
    });

    it('should have no skill dependencies (tools are self-contained)', () => {
      expect(lifeSecretarySkill.dependencies).toEqual([]);
    });

    it('should include date planning guidance', () => {
      const content = lifeSecretarySkill.content!;
      expect(content).toContain('Date Planning');
      expect(content).toContain('Always search memories first');
    });

    it('should include restaurant recommendation guidance', () => {
      const content = lifeSecretarySkill.content!;
      expect(content).toContain('Restaurant Recommendations');
      expect(content).toContain('allergies');
    });

    it('should include example workflows', () => {
      const content = lifeSecretarySkill.content!;
      expect(content).toContain('Example 1: Date Planning');
      expect(content).toContain('Example 2: Restaurant Recommendation');
      expect(content).toContain('Example 3: Birthday Reminder');
    });

    it('should render without dependencies', () => {
      const result = lifeSecretarySkill.render!();
      expect(typeof result).toBe('string');
      expect(result).toContain('life planning');
    });
  });

  // ============================================================
  // composeBatch — Skill 组合
  // ============================================================

  describe('composeBatch (Skill 组合)', () => {
    it('should compose multiple prompt skills by priority', async () => {
      const registry = new SkillRegistry();
      initializeBuiltinSkills(registry);

      const result = await registry.composeBatch([
        'xuanji-assistant',
        'code-assistant',
        'tool-guidance',
      ]);

      // 应包含所有三个 Skill 的内容
      expect(result).toContain('Xuanji');
      expect(result).toContain('Code Assistant');
      expect(result).toContain('Decision Tree');
    });

    it('should include project-rules as dependency of xuanji-assistant', async () => {
      const registry = new SkillRegistry();

      // 注册一个简单的 project-rules mock
      registry.register({
        id: 'project-rules',
        name: 'Project Rules',
        version: '1.0.0',
        description: 'Mock',
        category: 'prompt',
        tags: [],
        content: '## Mock Project Context',
        render: () => '## Mock Project Context',
      });
      registry.register(xuanjiAssistantSkill);

      const result = await registry.composeBatch(['xuanji-assistant']);

      // project-rules 作为依赖应被包含
      expect(result).toContain('Mock Project Context');
      expect(result).toContain('Xuanji');
    });

    it('should filter only prompt skills from enabled list', () => {
      const registry = new SkillRegistry();
      initializeBuiltinSkills(registry);

      const allEnabled = [
        'xuanji-assistant',
        'code-assistant',
        'tool-guidance',
        'security-rules',
        'agent-rules',
      ];

      // 模拟 ChatSession 的过滤逻辑
      const promptSkillIds = allEnabled.filter((id) => {
        const skill = registry.get(id);
        return skill && skill.category === 'prompt' && (skill.enabled ?? true);
      });

      expect(promptSkillIds).toContain('xuanji-assistant');
      expect(promptSkillIds).toContain('code-assistant');
      expect(promptSkillIds).toContain('tool-guidance');
      expect(promptSkillIds).toContain('security-rules');
      expect(promptSkillIds).toContain('agent-rules');
    });
  });
});
