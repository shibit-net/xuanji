import { describe, it, expect } from 'vitest';
import { ConfigValidator } from '@/core/config/ConfigValidator';
import type { AppConfig } from '@/core/types';

describe('ConfigValidator', () => {
  // ============================================================
  // validate() - 完整配置校验
  // ============================================================

  describe('validate()', () => {
    it('应通过合法的完整配置', () => {
      const config: Partial<AppConfig> = {
        provider: {
          model: 'claude-sonnet-4',
          apiKey: 'sk-ant-xxx',
          maxTokens: 8000,
          temperature: 0.7,
        } as any,
        ui: {
          theme: 'dark',
          language: 'zh',
          showTokenUsage: true,
        } as any,
      };

      const result = ConfigValidator.validate(config);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('应拒绝非对象配置', () => {
      const result = ConfigValidator.validate('not-an-object');
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('必须是一个对象');
    });

    it('应检测缺失的必填字段 provider.model', () => {
      const config = {
        provider: {
          apiKey: 'sk-ant-xxx',
        },
      };

      const result = ConfigValidator.validate(config);
      expect(result.valid).toBe(false);
      const modelError = result.errors.find(e => e.path === 'provider.model');
      expect(modelError).toBeDefined();
      expect(modelError?.message).toContain('必填字段缺失');
    });

    it('应检测缺失的必填字段 provider.apiKey', () => {
      const config = {
        provider: {
          model: 'claude-sonnet-4',
        },
      };

      const result = ConfigValidator.validate(config);
      expect(result.valid).toBe(false);
      const apiKeyError = result.errors.find(e => e.path === 'provider.apiKey');
      expect(apiKeyError).toBeDefined();
      expect(apiKeyError?.message).toContain('必填字段缺失');
      expect(apiKeyError?.message).toContain('ANTHROPIC_API_KEY');
    });

    it('应检测 provider 整体缺失', () => {
      const config = {
        ui: { theme: 'dark' },
      };

      const result = ConfigValidator.validate(config);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      const modelError = result.errors.find(e => e.path === 'provider.model');
      expect(modelError).toBeDefined();
    });

    it('应允许可选字段缺失', () => {
      const config = {
        provider: {
          model: 'claude-sonnet-4',
          apiKey: 'sk-ant-xxx',
          // maxTokens, temperature 等可选
        },
      };

      const result = ConfigValidator.validate(config);
      expect(result.valid).toBe(true);
    });
  });

  // ============================================================
  // validateField() - 单字段校验
  // ============================================================

  describe('validateField()', () => {
    it('应校验枚举值约束 (ui.theme)', () => {
      const errors = ConfigValidator.validateField('ui.theme', 'invalid-theme');
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('不在允许范围内');
      expect(errors[0].expected).toContain('light');
      expect(errors[0].expected).toContain('dark');
      expect(errors[0].expected).toContain('auto');
    });

    it('应通过合法的枚举值', () => {
      const errors1 = ConfigValidator.validateField('ui.theme', 'dark');
      expect(errors1).toHaveLength(0);

      const errors2 = ConfigValidator.validateField('ui.language', 'zh');
      expect(errors2).toHaveLength(0);
    });

    it('应校验数值范围 (provider.maxTokens)', () => {
      const errors = ConfigValidator.validateField('provider.maxTokens', 0);
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('小于最小值');
    });

    it('应通过合法的数值范围', () => {
      const errors = ConfigValidator.validateField('provider.maxTokens', 8000);
      expect(errors).toHaveLength(0);
    });

    it('应校验 temperature 范围 (0-2)', () => {
      const errorsMin = ConfigValidator.validateField('provider.temperature', -0.1);
      expect(errorsMin).toHaveLength(1);
      expect(errorsMin[0].message).toContain('小于最小值');

      const errorsMax = ConfigValidator.validateField('provider.temperature', 2.1);
      expect(errorsMax).toHaveLength(1);
      expect(errorsMax[0].message).toContain('超出最大值');

      const valid = ConfigValidator.validateField('provider.temperature', 0.7);
      expect(valid).toHaveLength(0);
    });

    it('应校验字符串最小长度 (provider.model)', () => {
      const errors = ConfigValidator.validateField('provider.model', '');
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('长度');
    });

    it('应校验 URL 格式 (provider.baseURL)', () => {
      const errors = ConfigValidator.validateField('provider.baseURL', 'not-a-url');
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('格式不正确');

      const valid = ConfigValidator.validateField('provider.baseURL', 'https://api.example.com');
      expect(valid).toHaveLength(0);
    });

    it('应允许未知字段（不报错）', () => {
      const errors = ConfigValidator.validateField('custom.unknown.field', 'value');
      expect(errors).toHaveLength(0);
    });
  });

  // ============================================================
  // 类型校验
  // ============================================================

  describe('类型校验', () => {
    it('应拒绝类型不匹配的值 (string vs number)', () => {
      const config = {
        provider: {
          model: 'claude-sonnet-4',
          apiKey: 'sk-ant-xxx',
          maxTokens: 'not-a-number', // 应该是 number
        },
      };

      const result = ConfigValidator.validate(config);
      expect(result.valid).toBe(false);
      const error = result.errors.find(e => e.path === 'provider.maxTokens');
      expect(error?.message).toContain('类型错误');
      expect(error?.message).toContain('integer');
    });

    it('应拒绝 boolean 字段的非布尔值', () => {
      const config = {
        provider: { model: 'test', apiKey: 'test' },
        ui: {
          showTokenUsage: 'yes', // 应该是 boolean
        },
      };

      const result = ConfigValidator.validate(config);
      expect(result.valid).toBe(false);
      const error = result.errors.find(e => e.path === 'ui.showTokenUsage');
      expect(error?.message).toContain('类型错误');
    });

    it('应接受正确类型的值', () => {
      const config = {
        provider: {
          model: 'claude-sonnet-4',
          apiKey: 'sk-ant-xxx',
          maxTokens: 8000,
          temperature: 0.7,
        },
        ui: {
          theme: 'dark',
          language: 'zh',
          showTokenUsage: true,
          showCost: false,
        },
      };

      const result = ConfigValidator.validate(config);
      expect(result.valid).toBe(true);
    });
  });

  // ============================================================
  // formatErrors() - 错误格式化
  // ============================================================

  describe('formatErrors()', () => {
    it('应格式化空错误列表', () => {
      const formatted = ConfigValidator.formatErrors([]);
      expect(formatted).toBe('配置校验通过');
    });

    it('应格式化单个错误', () => {
      const errors = [
        {
          path: 'provider.model',
          message: '必填字段缺失',
          expected: '必填',
        },
      ];

      const formatted = ConfigValidator.formatErrors(errors);
      expect(formatted).toContain('配置校验失败');
      expect(formatted).toContain('provider.model');
      expect(formatted).toContain('必填字段缺失');
      expect(formatted).toContain('/config set');
    });

    it('应格式化多个错误', () => {
      const errors = [
        {
          path: 'provider.model',
          message: '必填字段缺失',
        },
        {
          path: 'provider.apiKey',
          message: '必填字段缺失',
        },
      ];

      const formatted = ConfigValidator.formatErrors(errors);
      expect(formatted).toContain('2 个错误');
      expect(formatted).toContain('provider.model');
      expect(formatted).toContain('provider.apiKey');
    });

    it('应包含环境变量提示', () => {
      const errors = [
        {
          path: 'provider.apiKey',
          message: '必填字段缺失',
        },
      ];

      const formatted = ConfigValidator.formatErrors(errors);
      expect(formatted).toContain('ANTHROPIC_API_KEY');
      expect(formatted).toContain('环境变量');
    });

    it('应显示当前值和期望值', () => {
      const errors = [
        {
          path: 'ui.theme',
          message: '值不在允许范围内',
          value: 'invalid',
          expected: 'light | dark | auto',
        },
      ];

      const formatted = ConfigValidator.formatErrors(errors);
      expect(formatted).toContain('当前值: "invalid"');
      expect(formatted).toContain('期望: light | dark | auto');
    });
  });

  // ============================================================
  // getDefault() - 获取默认值
  // ============================================================

  describe('getDefault()', () => {
    it('应返回字段的默认值', () => {
      expect(ConfigValidator.getDefault('ui.theme')).toBe('auto');
      expect(ConfigValidator.getDefault('ui.language')).toBe('en');
      expect(ConfigValidator.getDefault('retry.maxRetries')).toBe(3);
    });

    it('应对无默认值的字段返回 undefined', () => {
      expect(ConfigValidator.getDefault('provider.model')).toBeUndefined();
      expect(ConfigValidator.getDefault('provider.apiKey')).toBeUndefined();
    });

    it('应对未知字段返回 undefined', () => {
      expect(ConfigValidator.getDefault('unknown.field')).toBeUndefined();
    });
  });

  // ============================================================
  // getFieldSchema() - 获取字段 Schema
  // ============================================================

  describe('getFieldSchema()', () => {
    it('应返回字段的 schema 定义', () => {
      const schema = ConfigValidator.getFieldSchema('ui.theme');
      expect(schema).toBeDefined();
      expect(schema?.type).toBe('string');
      expect(schema?.enum).toContain('light');
      expect(schema?.enum).toContain('dark');
      expect(schema?.enum).toContain('auto');
    });

    it('应对未知字段返回 undefined', () => {
      const schema = ConfigValidator.getFieldSchema('unknown.field');
      expect(schema).toBeUndefined();
    });
  });

  // ============================================================
  // 嵌套对象校验
  // ============================================================

  describe('嵌套对象校验', () => {
    it('应递归校验嵌套对象', () => {
      const config = {
        provider: {
          model: 'claude-sonnet-4',
          apiKey: 'sk-ant-xxx',
        },
        tools: {
          permissions: {
            fileWrite: 'invalid-permission', // 应该是 always | ask | never
          },
        },
      };

      const result = ConfigValidator.validate(config);
      expect(result.valid).toBe(false);
      const error = result.errors.find(e => e.path === 'tools.permissions.fileWrite');
      expect(error?.message).toContain('不在允许范围内');
    });

    it('应校验深度嵌套的枚举值', () => {
      const config = {
        provider: { model: 'test', apiKey: 'test' },
        tools: {
          permissions: {
            warnLevel: 'invalid', // 应该是 auto-allow | ask
          },
        },
      };

      const result = ConfigValidator.validate(config);
      expect(result.valid).toBe(false);
      const error = result.errors.find(e => e.path === 'tools.permissions.warnLevel');
      expect(error).toBeDefined();
    });
  });

  // ============================================================
  // 数组校验
  // ============================================================

  describe('数组校验', () => {
    it('应校验数组元素类型', () => {
      const config = {
        provider: { model: 'test', apiKey: 'test' },
        tools: {
          enabled: ['tool1', 123, 'tool2'], // 应该全是 string
        },
      };

      const result = ConfigValidator.validate(config);
      expect(result.valid).toBe(false);
      const error = result.errors.find(e => e.path.includes('tools.enabled'));
      expect(error).toBeDefined();
    });

    it('应通过合法的数组', () => {
      const config = {
        provider: { model: 'test', apiKey: 'test' },
        tools: {
          enabled: ['read_file', 'write_file', 'bash'],
          permissions: {
            allowedCommands: ['^git ', '^npm '],
          },
        },
      };

      const result = ConfigValidator.validate(config);
      expect(result.valid).toBe(true);
    });
  });

  // ============================================================
  // 边界情况
  // ============================================================

  describe('边界情况', () => {
    it('应跳过注释字段（以 // 开头）', () => {
      const config = {
        '// comment': 'This is a comment',
        provider: {
          model: 'test',
          apiKey: 'test',
          '// note': 'Some note',
        },
      };

      const result = ConfigValidator.validate(config);
      expect(result.valid).toBe(true);
    });

    it('应处理空配置对象', () => {
      const result = ConfigValidator.validate({});
      expect(result.valid).toBe(false); // 缺少必填字段
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('应处理 null 值', () => {
      const config = {
        provider: {
          model: 'test',
          apiKey: 'test',
          temperature: null, // null 应该被跳过（不校验）
        },
      };

      const result = ConfigValidator.validate(config);
      expect(result.valid).toBe(true);
    });

    it('应处理 undefined 值', () => {
      const config = {
        provider: {
          model: 'test',
          apiKey: 'test',
          maxTokens: undefined, // undefined 应该被跳过
        },
      };

      const result = ConfigValidator.validate(config);
      expect(result.valid).toBe(true);
    });
  });
});
