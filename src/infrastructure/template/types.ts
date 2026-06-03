/**
 * 模板系统 - 类型定义
 *
 * TemplateRepo 管理 MCP Prompts，提供模板查询、渲染、参数替换功能
 */

/**
 * 模板参数定义
 */
export interface TemplateArgument {
  /** 参数名称 */
  name: string;
  /** 参数描述 */
  description?: string;
  /** 是否必填 */
  required?: boolean;
}

/**
 * 模板定义
 */
export interface Template {
  /** 模板 ID（格式：serverName:promptName） */
  id: string;
  /** Prompt 名称 */
  name: string;
  /** 所属 MCP 服务器名称 */
  serverName: string;
  /** 模板描述 */
  description?: string;
  /** 参数定义 */
  arguments?: TemplateArgument[];
}

/**
 * 渲染后的模板消息
 */
export interface TemplateMessage {
  /** 消息角色 */
  role: 'user' | 'assistant';
  /** 消息内容 */
  content: string;
}

/**
 * 渲染后的模板
 */
export interface RenderedTemplate {
  /** 模板信息 */
  template: Template;
  /** 渲染后的消息列表 */
  messages: TemplateMessage[];
  /** 模板描述（来自 prompts/get 响应） */
  description?: string;
}
