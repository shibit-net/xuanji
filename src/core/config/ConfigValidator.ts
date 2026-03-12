// ============================================================
// M9 配置管理 — 配置校验器（手写 JSON Schema 校验）
// ============================================================
//
// 不引入外部依赖（如 ajv），基于 config.schema.json 定义手写校验逻辑。
// 支持类型、必填、枚举、范围、正则等基本约束校验。
//

import configSchema from './config.schema.json';
import { getByPath } from './GlobalConfig';

// ============================================================
// 类型定义
// ============================================================

/**
 * 校验错误
 */
export interface ValidationError {
  /** 字段路径（如 "provider.model"） */
  path: string;
  /** 错误信息 */
  message: string;
  /** 实际值 */
  value?: unknown;
  /** 期望值或约束 */
  expected?: string;
}

/**
 * 校验结果
 */
export interface ValidationResult {
  /** 是否通过校验 */
  valid: boolean;
  /** 错误列表 */
  errors: ValidationError[];
  /** 警告列表（非致命问题） */
  warnings: ValidationError[];
}

/**
 * Schema 属性定义
 */
interface SchemaProperty {
  type?: string;
  description?: string;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  default?: unknown;
  required?: string[];
  properties?: Record<string, SchemaProperty>;
  items?: SchemaProperty;
}

// ============================================================
// 环境变量提示映射
// ============================================================

const ENV_HINTS: Record<string, string> = {
  'provider.apiKey': 'XUANJI_API_KEY',
  'provider.model': 'XUANJI_MODEL',
  'provider.baseURL': 'XUANJI_BASE_URL',
  'provider.maxTokens': 'XUANJI_MAX_TOKENS',
  'provider.temperature': 'XUANJI_TEMPERATURE',
  'ui.language': 'XUANJI_LANGUAGE',
  'ui.theme': 'XUANJI_THEME',
};

// ============================================================
// ConfigValidator 类
// ============================================================

/**
 * 配置校验器
 *
 * 基于 config.schema.json 的定义，对配置对象进行校验。
 * 所有方法均为静态方法，无需实例化。
 */
export class ConfigValidator {
  private static schema: Record<string, unknown> = configSchema as Record<string, unknown>;

  /**
   * 校验完整配置
   *
   * @param config 待校验的配置对象
   * @returns 校验结果（包含错误和警告）
   */
  static validate(config: unknown): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];

    if (!config || typeof config !== 'object') {
      errors.push({
        path: '',
        message: '配置必须是一个对象',
        value: config,
        expected: 'object',
      });
      return { valid: false, errors, warnings };
    }

    const properties = (ConfigValidator.schema as SchemaProperty).properties;
    if (!properties) {
      return { valid: true, errors: [], warnings: [] };
    }

    // 递归校验所有属性
    ConfigValidator.validateObject(
      config as Record<string, unknown>,
      properties,
      '',
      errors,
      warnings,
    );

    // 检查 required 字段（在 provider 级别）
    ConfigValidator.checkRequired(config as Record<string, unknown>, errors);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * 校验单个字段
   *
   * @param path 字段点号路径（如 "provider.model"）
   * @param value 字段值
   * @returns 错误列表
   */
  static validateField(path: string, value: unknown): ValidationError[] {
    const errors: ValidationError[] = [];
    const schemaProp = ConfigValidator.getSchemaProperty(path);

    if (!schemaProp) {
      // 未知字段，不报错（允许扩展字段）
      return [];
    }

    ConfigValidator.validateValue(value, schemaProp, path, errors, []);
    return errors;
  }

  /**
   * 格式化错误信息（供 CLI 展示）
   */
  static formatErrors(errors: ValidationError[]): string {
    if (errors.length === 0) {
      return '配置校验通过';
    }

    const lines: string[] = [];
    lines.push(`配置校验失败 (${errors.length} 个错误):`);
    lines.push('');

    for (const error of errors) {
      lines.push(`  \u2717 ${error.path || '(root)'}`);
      lines.push(`    ${error.message}`);

      if (error.value !== undefined) {
        const valueStr = typeof error.value === 'string'
          ? `"${error.value}"`
          : String(error.value);
        lines.push(`    当前值: ${valueStr}`);
      }

      if (error.expected) {
        lines.push(`    期望: ${error.expected}`);
      }

      // 添加环境变量提示
      const envHint = ENV_HINTS[error.path];
      if (envHint) {
        lines.push(`    提示: 可通过环境变量 ${envHint} 设置`);
      }

      lines.push('');
    }

    lines.push('建议: 运行 /config set <path> <value> 修改配置');
    return lines.join('\n');
  }

  /**
   * 获取字段的默认值
   */
  static getDefault(path: string): unknown {
    const schemaProp = ConfigValidator.getSchemaProperty(path);
    return schemaProp?.default;
  }

  /**
   * 获取字段的 schema 定义（用于自动补全等）
   */
  static getFieldSchema(path: string): SchemaProperty | undefined {
    return ConfigValidator.getSchemaProperty(path);
  }

  // ============================================================
  // 内部方法
  // ============================================================

  /**
   * 递归校验对象的所有属性
   */
  private static validateObject(
    obj: Record<string, unknown>,
    schemaProps: Record<string, SchemaProperty>,
    prefix: string,
    errors: ValidationError[],
    warnings: ValidationError[],
  ): void {
    for (const [key, value] of Object.entries(obj)) {
      // 跳过注释字段
      if (key.startsWith('//')) continue;

      const fullPath = prefix ? `${prefix}.${key}` : key;
      const schemaProp = schemaProps[key];

      if (!schemaProp) {
        // 未在 schema 中定义的字段 — 警告而非错误（允许扩展）
        continue;
      }

      ConfigValidator.validateValue(value, schemaProp, fullPath, errors, warnings);
    }
  }

  /**
   * 校验单个值
   */
  private static validateValue(
    value: unknown,
    schema: SchemaProperty,
    path: string,
    errors: ValidationError[],
    warnings: ValidationError[],
  ): void {
    if (value === undefined || value === null) return;

    // 类型校验
    if (schema.type) {
      if (!ConfigValidator.checkType(value, schema.type)) {
        errors.push({
          path,
          message: `类型错误，期望 ${schema.type}，实际为 ${ConfigValidator.getTypeName(value)}`,
          value,
          expected: schema.type,
        });
        return; // 类型错误后不继续其他校验
      }
    }

    // 枚举校验
    if (schema.enum && !schema.enum.includes(value)) {
      errors.push({
        path,
        message: `值 "${String(value)}" 不在允许范围内`,
        value,
        expected: schema.enum.map(String).join(' | '),
      });
      return;
    }

    // 数值范围校验
    if (typeof value === 'number') {
      if (schema.minimum !== undefined && value < schema.minimum) {
        errors.push({
          path,
          message: `值 ${value} 小于最小值 ${schema.minimum}`,
          value,
          expected: `>= ${schema.minimum}`,
        });
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        errors.push({
          path,
          message: `值 ${value} 超出最大值 ${schema.maximum}`,
          value,
          expected: `<= ${schema.maximum}`,
        });
      }
    }

    // 字符串长度校验
    if (typeof value === 'string') {
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        errors.push({
          path,
          message: `字符串长度 ${value.length} 小于最小长度 ${schema.minLength}`,
          value,
          expected: `长度 >= ${schema.minLength}`,
        });
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        errors.push({
          path,
          message: `字符串长度 ${value.length} 超出最大长度 ${schema.maxLength}`,
          value,
          expected: `长度 <= ${schema.maxLength}`,
        });
      }
    }

    // 正则校验
    if (schema.pattern && typeof value === 'string') {
      const regex = new RegExp(schema.pattern);
      if (!regex.test(value)) {
        errors.push({
          path,
          message: `格式不正确`,
          value,
          expected: `匹配 ${schema.pattern}`,
        });
      }
    }

    // 递归校验嵌套对象
    if (schema.type === 'object' && schema.properties && typeof value === 'object' && value !== null) {
      ConfigValidator.validateObject(
        value as Record<string, unknown>,
        schema.properties,
        path,
        errors,
        warnings,
      );

      // 检查嵌套 required
      if (schema.required) {
        for (const reqField of schema.required) {
          const fieldValue = (value as Record<string, unknown>)[reqField];
          if (fieldValue === undefined || fieldValue === null || fieldValue === '') {
            const fullPath = `${path}.${reqField}`;
            const envHint = ENV_HINTS[fullPath];
            const envMsg = envHint ? `，请设置 ${envHint} 环境变量或在配置文件中指定` : '';
            errors.push({
              path: fullPath,
              message: `必填字段缺失${envMsg}`,
              expected: '必填',
            });
          }
        }
      }
    }

    // 数组校验
    if (schema.type === 'array' && Array.isArray(value) && schema.items) {
      for (let i = 0; i < value.length; i++) {
        ConfigValidator.validateValue(
          value[i],
          schema.items,
          `${path}[${i}]`,
          errors,
          warnings,
        );
      }
    }
  }

  /**
   * 检查顶层 required 字段
   *
   * provider.model 和 provider.apiKey 标记为必填，
   * 但校验策略是 warn 而非 error（不阻塞启动）
   */
  private static checkRequired(
    config: Record<string, unknown>,
    errors: ValidationError[],
  ): void {
    const providerSchema = (ConfigValidator.schema as SchemaProperty).properties?.provider;
    if (!providerSchema?.required) return;

    const provider = config.provider as Record<string, unknown> | undefined;
    if (!provider) {
      // provider 整个不存在，报所有必填字段
      for (const field of providerSchema.required) {
        const fullPath = `provider.${field}`;
        const envHint = ENV_HINTS[fullPath];
        const envMsg = envHint ? `，请设置 ${envHint} 环境变量或在配置文件中指定` : '';
        errors.push({
          path: fullPath,
          message: `必填字段缺失${envMsg}`,
          expected: '必填',
        });
      }
      return;
    }

    for (const field of providerSchema.required) {
      const value = provider[field];
      if (value === undefined || value === null || value === '') {
        const fullPath = `provider.${field}`;
        // 检查是否已在嵌套校验中添加过
        const alreadyReported = errors.some(e => e.path === fullPath);
        if (!alreadyReported) {
          const envHint = ENV_HINTS[fullPath];
          const envMsg = envHint ? `，请设置 ${envHint} 环境变量或在配置文件中指定` : '';
          errors.push({
            path: fullPath,
            message: `必填字段缺失${envMsg}`,
            expected: '必填',
          });
        }
      }
    }
  }

  /**
   * 类型检查
   */
  private static checkType(value: unknown, expectedType: string): boolean {
    switch (expectedType) {
      case 'string': return typeof value === 'string';
      case 'number': return typeof value === 'number' && !isNaN(value);
      case 'integer': return typeof value === 'number' && Number.isInteger(value);
      case 'boolean': return typeof value === 'boolean';
      case 'object': return typeof value === 'object' && value !== null && !Array.isArray(value);
      case 'array': return Array.isArray(value);
      default: return true;
    }
  }

  /**
   * 获取值的类型名称（中文）
   */
  private static getTypeName(value: unknown): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (Array.isArray(value)) return 'array';
    if (typeof value === 'number' && Number.isInteger(value)) return 'integer';
    return typeof value;
  }

  /**
   * 根据点号路径获取 schema 属性定义
   */
  private static getSchemaProperty(path: string): SchemaProperty | undefined {
    const keys = path.split('.');
    let current: SchemaProperty | undefined = ConfigValidator.schema as SchemaProperty;

    for (const key of keys) {
      if (!current?.properties) return undefined;
      current = current.properties[key];
      if (!current) return undefined;
    }

    return current;
  }
}
