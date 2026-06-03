/**
 * Team Templates 测试
 */

import { describe, it, expect } from 'vitest';
import {
  getTeamTemplate,
  getAvailableTemplates,
  recommendTemplate,
  TEAM_TEMPLATES,
} from '@/agent/team/templates';

describe('Team Templates', () => {
  describe('getTeamTemplate', () => {
    it('应返回已注册的模板', () => {
      const template = getTeamTemplate('code-review');
      expect(template).toBeDefined();
      expect(template?.id).toBe('code-review');
      expect(template?.name).toBe('Code Review Team');
    });

    it('应返回所有 5 个预定义模板', () => {
      const templates = ['code-review', 'research', 'architecture-debate', 'data-pipeline', 'feature-development'];
      
      for (const templateId of templates) {
        const template = getTeamTemplate(templateId);
        expect(template).toBeDefined();
        expect(template?.id).toBe(templateId);
      }
    });

    it('未知模板应返回 undefined', () => {
      const template = getTeamTemplate('unknown-template');
      expect(template).toBeUndefined();
    });
  });

  describe('getAvailableTemplates', () => {
    it('应返回所有 5 个模板 ID', () => {
      const templates = getAvailableTemplates();
      expect(templates).toHaveLength(5);
      expect(templates).toContain('code-review');
      expect(templates).toContain('research');
      expect(templates).toContain('architecture-debate');
      expect(templates).toContain('data-pipeline');
      expect(templates).toContain('feature-development');
    });
  });

  describe('recommendTemplate', () => {
    describe('code-review 推荐', () => {
      it('"review" 关键词应推荐 code-review', () => {
        expect(recommendTemplate('review this code')).toBe('code-review');
        expect(recommendTemplate('code review needed')).toBe('code-review');
        expect(recommendTemplate('审查代码质量')).toBe('code-review');
      });

      it('"quality" 关键词应推荐 code-review', () => {
        expect(recommendTemplate('check code quality')).toBe('code-review');
      });
    });

    describe('research 推荐', () => {
      it('"research" 关键词应推荐 research', () => {
        expect(recommendTemplate('research best practices')).toBe('research');
        expect(recommendTemplate('需要调研技术方案')).toBe('research');
      });

      it('"搜索" 关键词应推荐 research', () => {
        expect(recommendTemplate('搜索相关文档')).toBe('research');
      });

      it('"gather" 关键词应推荐 research', () => {
        expect(recommendTemplate('gather information')).toBe('research');
      });
    });

    describe('architecture-debate 推荐', () => {
      it('"debate design" 应推荐 architecture-debate', () => {
        expect(recommendTemplate('debate the design')).toBe('architecture-debate');
        // 中文需要同时包含"设计"和"辩论"/"讨论"
        expect(recommendTemplate('辩论架构设计')).toBe('architecture-debate');
      });

      it('"evaluate architecture" 应推荐 architecture-debate', () => {
        expect(recommendTemplate('evaluate architecture options')).toBe('architecture-debate');
      });
    });

    describe('data-pipeline 推荐', () => {
      it('"process data" 应推荐 data-pipeline', () => {
        expect(recommendTemplate('process log data')).toBe('data-pipeline');
        expect(recommendTemplate('处理数据')).toBe('data-pipeline');
      });

      it('"extract" 关键词应推荐 data-pipeline', () => {
        expect(recommendTemplate('extract and analyze data')).toBe('data-pipeline');
      });

      it('"pipeline" 关键词应推荐 data-pipeline', () => {
        expect(recommendTemplate('data pipeline needed')).toBe('data-pipeline');
      });
    });

    describe('feature-development 推荐', () => {
      it('"implement feature" 应推荐 feature-development', () => {
        expect(recommendTemplate('implement new feature')).toBe('feature-development');
        expect(recommendTemplate('功能开发')).toBe('feature-development');
      });

      it('"develop" 关键词应推荐 feature-development', () => {
        expect(recommendTemplate('develop authentication')).toBe('feature-development');
      });
    });

    it('无匹配应返回 null', () => {
      expect(recommendTemplate('random text')).toBeNull();
      expect(recommendTemplate('xyz')).toBeNull();
      expect(recommendTemplate('')).toBeNull();
    });

    it('应支持大小写不敏感', () => {
      expect(recommendTemplate('REVIEW CODE')).toBe('code-review');
      expect(recommendTemplate('Research API')).toBe('research');
    });
  });

  describe('Template Configurations', () => {
    describe('code-review 模板', () => {
      it('应有正确的基本配置', () => {
        const template = TEAM_TEMPLATES['code-review'];
        expect(template.id).toBe('code-review');
        expect(template.name).toBe('Code Review Team');
        expect(template.recommendedStrategy).toBe('sequential');
        expect(template.description).toContain('Sequential code review');
      });

      it('应包含 3 个成员: architect, security, performance', () => {
        const template = TEAM_TEMPLATES['code-review'];
        const members = template.members();
        
        expect(members).toHaveLength(3);
        expect(members[0].id).toBe('architect');
        expect(members[1].id).toBe('security');
        expect(members[2].id).toBe('performance');
      });

      it('成员应有合理的角色和能力', () => {
        const template = TEAM_TEMPLATES['code-review'];
        const members = template.members();

        // Architect
        expect(members[0].agentId).toBe('plan');
        expect(members[0].capabilities).toContain('architecture analysis');
        expect(members[0].priority).toBe(3);

        // Security
        expect(members[1].agentId).toBe('explore');
        expect(members[1].capabilities).toContain('security analysis');
        expect(members[1].priority).toBe(2);

        // Performance
        expect(members[2].agentId).toBe('explore');
        expect(members[2].capabilities).toContain('performance analysis');
        expect(members[2].priority).toBe(1);
      });

      it('成员应有详细的 systemPrompt', () => {
        const template = TEAM_TEMPLATES['code-review'];
        const members = template.members();
        
        expect(members[0].systemPrompt).toContain('architecture');
        expect(members[1].systemPrompt).toContain('security');
        expect(members[2].systemPrompt).toContain('performance');
      });

      it('应列出适用场景', () => {
        const template = TEAM_TEMPLATES['code-review'];
        expect(template.useCases.length).toBeGreaterThan(0);
        expect(template.useCases.some(uc => uc.includes('Review'))).toBe(true);
      });
    });

    describe('research 模板', () => {
      it('应有正确的基本配置', () => {
        const template = TEAM_TEMPLATES['research'];
        expect(template.id).toBe('research');
        expect(template.recommendedStrategy).toBe('parallel');
      });

      it('应包含 3 个研究者成员', () => {
        const template = TEAM_TEMPLATES['research'];
        const members = template.members();
        
        expect(members).toHaveLength(3);
        expect(members[0].id).toBe('docs-researcher');
        expect(members[1].id).toBe('code-researcher');
        expect(members[2].id).toBe('community-researcher');
      });

      it('成员应都是 explore 角色', () => {
        const template = TEAM_TEMPLATES['research'];
        const members = template.members();

        expect(members.every(m => m.agentId === 'explore')).toBe(true);
      });

      it('成员应有不同的研究方向', () => {
        const template = TEAM_TEMPLATES['research'];
        const members = template.members();
        
        expect(members[0].capabilities).toContain('official docs');
        expect(members[1].capabilities).toContain('code search');
        expect(members[2].capabilities).toContain('blog posts');
      });
    });

    describe('architecture-debate 模板', () => {
      it('应有正确的基本配置', () => {
        const template = TEAM_TEMPLATES['architecture-debate'];
        expect(template.id).toBe('architecture-debate');
        expect(template.recommendedStrategy).toBe('debate');
      });

      it('应包含 3 个辩论者成员', () => {
        const template = TEAM_TEMPLATES['architecture-debate'];
        const members = template.members();
        
        expect(members).toHaveLength(3);
        expect(members[0].id).toBe('simplicity-advocate');
        expect(members[1].id).toBe('scalability-expert');
        expect(members[2].id).toBe('pragmatist');
      });

      it('成员应都是 plan 角色', () => {
        const template = TEAM_TEMPLATES['architecture-debate'];
        const members = template.members();

        expect(members.every(m => m.agentId === 'plan')).toBe(true);
      });

      it('成员应代表不同的设计理念', () => {
        const template = TEAM_TEMPLATES['architecture-debate'];
        const members = template.members();
        
        expect(members[0].capabilities).toContain('simple solutions');
        expect(members[1].capabilities).toContain('scalability');
        expect(members[2].capabilities).toContain('practical solutions');
      });
    });

    describe('data-pipeline 模板', () => {
      it('应有正确的基本配置', () => {
        const template = TEAM_TEMPLATES['data-pipeline'];
        expect(template.id).toBe('data-pipeline');
        expect(template.recommendedStrategy).toBe('pipeline');
      });

      it('应包含 4 个流水线步骤成员', () => {
        const template = TEAM_TEMPLATES['data-pipeline'];
        const members = template.members();
        
        expect(members).toHaveLength(4);
        expect(members[0].id).toBe('extractor');
        expect(members[1].id).toBe('cleaner');
        expect(members[2].id).toBe('analyzer');
        expect(members[3].id).toBe('reporter');
      });

      it('成员应有正确的优先级（pipeline 顺序）', () => {
        const template = TEAM_TEMPLATES['data-pipeline'];
        const members = template.members();
        
        expect(members[0].priority).toBe(4); // extractor first
        expect(members[1].priority).toBe(3); // cleaner second
        expect(members[2].priority).toBe(2); // analyzer third
        expect(members[3].priority).toBe(1); // reporter last
      });

      it('成员应有合理的角色分配', () => {
        const template = TEAM_TEMPLATES['data-pipeline'];
        const members = template.members();

        expect(members[0].agentId).toBe('explore'); // extractor
        expect(members[1].agentId).toBe('general-purpose'); // cleaner
        expect(members[2].agentId).toBe('general-purpose'); // analyzer
        expect(members[3].agentId).toBe('general-purpose'); // reporter
      });
    });

    describe('feature-development 模板', () => {
      it('应有正确的基本配置', () => {
        const template = TEAM_TEMPLATES['feature-development'];
        expect(template.id).toBe('feature-development');
        expect(template.recommendedStrategy).toBe('hierarchical');
      });

      it('应包含 4 个开发团队成员', () => {
        const template = TEAM_TEMPLATES['feature-development'];
        const members = template.members();
        
        expect(members).toHaveLength(4);
        expect(members[0].id).toBe('tech-lead');
        expect(members[1].id).toBe('backend-dev');
        expect(members[2].id).toBe('frontend-dev');
        expect(members[3].id).toBe('qa');
      });

      it('tech-lead 应有最高优先级', () => {
        const template = TEAM_TEMPLATES['feature-development'];
        const members = template.members();

        expect(members[0].priority).toBe(10);
        expect(members[0].agentId).toBe('plan');
      });

      it('开发人员应是 coder 角色', () => {
        const template = TEAM_TEMPLATES['feature-development'];
        const members = template.members();

        expect(members[1].agentId).toBe('coder'); // backend
        expect(members[2].agentId).toBe('coder'); // frontend
        expect(members[3].agentId).toBe('coder'); // qa
      });

      it('成员应有明确的职责分工', () => {
        const template = TEAM_TEMPLATES['feature-development'];
        const members = template.members();
        
        expect(members[0].capabilities).toContain('system design');
        expect(members[1].capabilities).toContain('backend development');
        expect(members[2].capabilities).toContain('frontend development');
        expect(members[3].capabilities).toContain('testing');
      });
    });
  });

  describe('Template Member Generation', () => {
    it('应支持动态 target 参数', () => {
      const template = TEAM_TEMPLATES['code-review'];
      const membersWithTarget = template.members({ target: 'src/auth.ts' });
      const membersWithoutTarget = template.members();
      
      // 目前模板不使用 target，但应该不报错
      expect(membersWithTarget).toHaveLength(membersWithoutTarget.length);
    });

    it('成员生成应是纯函数（可重复调用）', () => {
      const template = TEAM_TEMPLATES['research'];
      const members1 = template.members();
      const members2 = template.members();
      
      expect(members1).toEqual(members2);
    });
  });

  describe('Template Metadata', () => {
    it('所有模板应有完整的元数据', () => {
      const templateIds = getAvailableTemplates();
      
      for (const templateId of templateIds) {
        const template = TEAM_TEMPLATES[templateId];
        
        expect(template.id).toBeDefined();
        expect(template.name).toBeDefined();
        expect(template.description).toBeDefined();
        expect(template.recommendedStrategy).toBeDefined();
        expect(template.members).toBeInstanceOf(Function);
        expect(template.useCases).toBeInstanceOf(Array);
        expect(template.useCases.length).toBeGreaterThan(0);
      }
    });

    it('所有模板应有唯一的 ID', () => {
      const templateIds = getAvailableTemplates();
      const uniqueIds = new Set(templateIds);
      
      expect(uniqueIds.size).toBe(templateIds.length);
    });

    it('所有模板策略应在允许范围内', () => {
      const validStrategies = ['sequential', 'parallel', 'hierarchical', 'debate', 'pipeline'];
      const templateIds = getAvailableTemplates();
      
      for (const templateId of templateIds) {
        const template = TEAM_TEMPLATES[templateId];
        expect(validStrategies).toContain(template.recommendedStrategy);
      }
    });
  });
});
