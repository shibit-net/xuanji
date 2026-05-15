/**
 * Agent 字段编辑权限 — 与后端 AgentConfigManager.getEditableFields() 保持一致
 *
 * 编辑规则：
 * - system: 仅 provider.* + model.* + enabled
 * - app:    system 字段 + systemPrompt + tools
 * - custom: 全部字段（编辑时 id 不可改）
 */

export type AgentCategory = 'system' | 'app' | 'custom';

/** 返回各分类可编辑的字段路径列表 */
export function getEditableFieldList(category: AgentCategory | undefined): string[] {
  if (!category) return ['*'];

  if (category === 'system') {
    return [
      'provider.adapter', 'provider.apiKey', 'provider.baseURL', 'provider.model',
      'model.primary', 'model.maxTokens', 'model.temperature', 'model.contextSize',
      'enabled',
    ];
  }

  if (category === 'app') {
    return [
      'provider.adapter', 'provider.apiKey', 'provider.baseURL', 'provider.model',
      'model.primary', 'model.maxTokens', 'model.temperature', 'model.contextSize',
      'enabled',
      'systemPrompt',
      'tools',
    ];
  }

  // custom — 完全控制
  return ['*'];
}

/** 判断指定字段在给定分类下是否可编辑 */
export function isFieldEditable(
  fieldPath: string,
  category: AgentCategory | undefined,
  isCreating: boolean,
): boolean {
  // 创建模式下全部可编辑
  if (isCreating) return true;

  const editableList = getEditableFieldList(category);

  // '*' 表示全部可编辑（custom），但 id 永远不可改
  if (editableList.includes('*')) {
    return fieldPath !== 'id';
  }

  return editableList.some(
    (f) => fieldPath === f || fieldPath.startsWith(f + '.'),
  );
}
