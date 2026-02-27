import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SkillRegistry, resetSkillRegistry } from '@/core/skills/registry';
import type { Skill, WorkflowResult } from '@/core/skills/types';

describe('Workflow Skill 框架', () => {
  let registry: SkillRegistry;

  beforeEach(() => {
    resetSkillRegistry();
    registry = new SkillRegistry();
  });

  function createWorkflowSkill(
    overrides?: Partial<Skill>,
  ): Skill {
    return {
      id: 'test-workflow',
      name: 'Test Workflow',
      version: '1.0.0',
      description: 'A test workflow',
      category: 'workflow',
      tags: ['test'],
      slashCommand: '/test',
      execute: async () => ({ success: true, output: 'Workflow executed' }),
      ...overrides,
    };
  }

  describe('executeWorkflow()', () => {
    it('应成功执行 workflow skill', async () => {
      const skill = createWorkflowSkill();
      registry.register(skill);

      const result = await registry.executeWorkflow('test-workflow');
      expect(result.success).toBe(true);
      expect(result.output).toBe('Workflow executed');
    });

    it('应传递参数给 execute()', async () => {
      const executeMock = vi.fn(async (params?: Record<string, any>) => ({
        success: true,
        output: `Got: ${params?.message}`,
      }));

      registry.register(createWorkflowSkill({ execute: executeMock }));

      const result = await registry.executeWorkflow('test-workflow', { message: 'hello' });
      expect(result.success).toBe(true);
      expect(result.output).toBe('Got: hello');
      expect(executeMock).toHaveBeenCalledWith({ message: 'hello' });
    });

    it('skill 不存在时应返回错误', async () => {
      const result = await registry.executeWorkflow('nonexistent');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('非 workflow 类型应返回错误', async () => {
      registry.register({
        id: 'prompt-skill',
        name: 'Prompt Skill',
        version: '1.0.0',
        description: 'A prompt skill',
        category: 'prompt',
        tags: ['test'],
        content: 'Some prompt',
      });

      const result = await registry.executeWorkflow('prompt-skill');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not a workflow');
    });

    it('无 execute 方法时应返回错误', async () => {
      registry.register(createWorkflowSkill({ execute: undefined }));

      const result = await registry.executeWorkflow('test-workflow');
      expect(result.success).toBe(false);
      expect(result.error).toContain('no execute method');
    });

    it('execute 抛出异常时应返回错误', async () => {
      registry.register(createWorkflowSkill({
        execute: async () => { throw new Error('Something went wrong'); },
      }));

      const result = await registry.executeWorkflow('test-workflow');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Something went wrong');
    });

    it('execute 返回非 WorkflowResult 格式时应包装为成功', async () => {
      registry.register(createWorkflowSkill({
        execute: async () => 'plain text result',
      }));

      const result = await registry.executeWorkflow('test-workflow');
      expect(result.success).toBe(true);
      expect(result.output).toBe('plain text result');
    });
  });

  describe('getWorkflowCommands()', () => {
    it('应返回所有有斜杠命令的 workflow skill', () => {
      registry.register(createWorkflowSkill({
        id: 'commit',
        slashCommand: '/commit',
        description: 'Git commit',
      }));
      registry.register(createWorkflowSkill({
        id: 'review-pr',
        slashCommand: '/review-pr',
        description: 'Review PR',
      }));
      registry.register(createWorkflowSkill({
        id: 'no-command',
        slashCommand: undefined,
        description: 'No command',
      }));

      const commands = registry.getWorkflowCommands();
      expect(commands).toHaveLength(2);
      expect(commands[0].command).toBe('/commit');
      expect(commands[1].command).toBe('/review-pr');
    });

    it('应忽略非 workflow skill', () => {
      registry.register({
        id: 'prompt-skill',
        name: 'Prompt',
        version: '1.0.0',
        description: 'A prompt',
        category: 'prompt',
        tags: [],
      });

      const commands = registry.getWorkflowCommands();
      expect(commands).toHaveLength(0);
    });
  });

  describe('slashCommand 字段', () => {
    it('Skill 应支持 slashCommand 字段', () => {
      const skill = createWorkflowSkill({ slashCommand: '/deploy' });
      registry.register(skill);

      const retrieved = registry.get('test-workflow');
      expect(retrieved?.slashCommand).toBe('/deploy');
    });
  });
});
