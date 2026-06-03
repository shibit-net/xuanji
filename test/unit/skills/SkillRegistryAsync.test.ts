import { describe, it, expect } from 'vitest';
import { SkillRegistry } from '@/skills/registry';
import type { Skill } from '@/skills/types';

describe('SkillRegistry Async', () => {
  it('should render a sync skill', async () => {
    const registry = new SkillRegistry();
    const skill: Skill = {
      id: 'sync-skill',
      name: 'Sync Skill',
      version: '1.0.0',
      description: 'A sync skill',
      category: 'prompt',
      tags: [],
      render: () => 'sync content',
    };
    registry.register(skill);

    const result = await registry.render('sync-skill');
    expect(result).toBe('sync content');
  });

  it('should render an async skill', async () => {
    const registry = new SkillRegistry();
    const skill: Skill = {
      id: 'async-skill',
      name: 'Async Skill',
      version: '1.0.0',
      description: 'An async skill',
      category: 'prompt',
      tags: [],
      render: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return 'async content';
      },
    };
    registry.register(skill);

    const result = await registry.render('async-skill');
    expect(result).toBe('async content');
  });

  it('should render a skill with string content (no render method)', async () => {
    const registry = new SkillRegistry();
    const skill: Skill = {
      id: 'content-skill',
      name: 'Content Skill',
      version: '1.0.0',
      description: 'A content skill',
      category: 'prompt',
      tags: [],
      content: 'Hello {{name}}!',
    };
    registry.register(skill);

    const result = await registry.render('content-skill', {
      params: { name: 'World' },
    });
    expect(result).toBe('Hello World!');
  });

  it('should throw for missing skill', async () => {
    const registry = new SkillRegistry();
    await expect(registry.render('nonexistent')).rejects.toThrow('not found');
  });

  it('should cache rendered results', async () => {
    const registry = new SkillRegistry();
    let callCount = 0;
    const skill: Skill = {
      id: 'cacheable',
      name: 'Cacheable',
      version: '1.0.0',
      description: 'test',
      category: 'prompt',
      tags: [],
      render: () => {
        callCount++;
        return 'cached content';
      },
    };
    registry.register(skill);

    await registry.render('cacheable');
    await registry.render('cacheable');

    expect(callCount).toBe(1);
  });

  it('should handle async dependencies', async () => {
    const registry = new SkillRegistry();

    const depSkill: Skill = {
      id: 'dep',
      name: 'Dependency',
      version: '1.0.0',
      description: 'dep',
      category: 'prompt',
      tags: [],
      render: async () => 'dependency content',
    };

    const mainSkill: Skill = {
      id: 'main',
      name: 'Main',
      version: '1.0.0',
      description: 'main',
      category: 'prompt',
      tags: [],
      dependencies: ['dep'],
      render: (options?: any) => {
        const depContent = options?.params?.dependencies?.dep || '';
        return `main + ${depContent}`;
      },
    };

    registry.register(depSkill);
    registry.register(mainSkill);

    const result = await registry.render('main');
    expect(result).toBe('main + dependency content');
  });

  it('should gracefully handle failed async dependency', async () => {
    const registry = new SkillRegistry();

    const failingDep: Skill = {
      id: 'failing-dep',
      name: 'Failing',
      version: '1.0.0',
      description: 'fails',
      category: 'prompt',
      tags: [],
      render: async () => {
        throw new Error('Dependency failed');
      },
    };

    const mainSkill: Skill = {
      id: 'resilient',
      name: 'Resilient',
      version: '1.0.0',
      description: 'resilient',
      category: 'prompt',
      tags: [],
      dependencies: ['failing-dep'],
      render: (options?: any) => {
        const deps = options?.params?.dependencies;
        const depContent = deps && 'failing-dep' in deps ? deps['failing-dep'] : 'no-injection';
        return `main with [${depContent}]`;
      },
    };

    registry.register(failingDep);
    registry.register(mainSkill);

    const result = await registry.render('resilient');
    // 依赖失败时注入空字符串
    expect(result).toBe('main with []');
  });
});
