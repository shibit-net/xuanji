# Skills 使用指南

> 最后更新：2026-03-10

## 什么是 Skill

Skill 是预定义的 system prompt 片段，用于指导 LLM 的行为和能力。每个 Skill 定义了特定场景下的行为规则、工具使用指引和响应模式。

## 内置 Skills

### 1. xuanji-assistant

**核心助手 Skill**，定义 Xuanji 的基本行为：
- 角色定位：AI 编程助手
- 核心原则：安全、高效、用户友好
- 工具使用指引
- 记忆与提醒管理

**激活条件**：默认启用

### 2. code-assistant

**编程场景 Skill**，专注于代码相关任务：
- 代码编写与重构
- Bug 修复
- 代码审查
- 测试编写
- Web 搜索（技术文档、Stack Overflow）

**激活条件**：项目中存在代码文件

### 3. life-secretary

**生活助手 Skill**，处理非编程任务：
- 日程管理
- 提醒设置
- 信息整理
- 知识问答

**激活条件**：用户请求生活相关任务

### 4. project-rules

**项目规则 Skill**，加载项目特定规则：
- 读取 `CLAUDE.md` / `XUANJI.md`
- 项目架构说明
- 编码规范
- 工作流程

**激活条件**：项目中存在规则文件

### 5. memory-context

**记忆上下文 Skill**，注入相关记忆：
- 用户偏好
- 历史对话摘要
- 项目知识
- 决策记录

**激活条件**：记忆系统启用

### 6. security-rules

**安全规则 Skill**，强化安全意识：
- 敏感文件保护
- 危险命令阻止
- 数据脱敏
- 安全最佳实践

**激活条件**：默认启用

### 7. agent-rules

**Agent 协作 Skill**，指导多 Agent 使用：
- SubAgent 使用场景
- Team 协作策略
- 任务分解原则

**激活条件**：使用 task / agent_team 工具时

## Skill 组合

多个 Skills 可以同时生效，优先级：
1. security-rules（最高优先级）
2. project-rules
3. xuanji-assistant
4. code-assistant / life-secretary
5. memory-context
6. agent-rules

## 自定义 Skill

### 创建 Skill

在项目中创建 `.xuanji/skills/` 目录，添加 Skill 文件：

```typescript
// .xuanji/skills/my-skill.ts
export default {
  id: 'my-custom-skill',
  name: '我的自定义 Skill',
  type: 'prompt',
  intent: /(我的规则|custom rules)/i,
  requiredTools: [],
  render: () => `
你是一个自定义助手。

## 特殊规则
- 规则 1
- 规则 2
  `,
};
```

### 加载自定义 Skill

Xuanji 会自动扫描并加载 `.xuanji/skills/` 目录下的 Skill 文件。

### Skill 模板

```typescript
interface Skill {
  id: string;                    // 唯一标识
  name: string;                  // 显示名称
  type: 'prompt' | 'workflow';   // 类型
  intent?: RegExp;               // 意图匹配（可选）
  requiredTools?: string[];      // 依赖的工具
  render: (options?: any) => string | Promise<string>; // 渲染函数
}
```

## 查看 Skills

使用 `/skills` 命令查看当前激活的 Skills：

```bash
/skills
```

输出示例：
```
🧩 当前激活的 Skills (5 个)

xuanji-assistant  核心助手
code-assistant    编程助手
project-rules     项目规则
memory-context    记忆上下文
security-rules    安全规则
```

## 最佳实践

1. **按需激活**：只在需要时激活 Skill，避免 prompt 过长
2. **规则清晰**：编写简洁明确的规则说明
3. **避免冲突**：多个 Skills 的规则不应相互矛盾
4. **定期更新**：项目规则随项目演进及时更新
5. **版本控制**：将项目 Skills 纳入版本控制

## 相关文档

- [配置参考](./configuration.md#skills-配置)
- [MCP 集成](./mcp-integration.md#mcp-skills)
