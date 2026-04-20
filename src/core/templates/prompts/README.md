# Prompt 组件模板

这个目录包含内置的 prompt 组件模板。

## 目录结构

```
src/core/templates/prompts/     # 内置模板（git 追踪）
└── README.md                   # 本文件

.xuanji/users/{userId}/prompts/ # 用户自定义组件（不被 git 追踪）
├── custom-coding-example.json5 # 示例：自定义编程场景
└── custom-rules-example.json5  # 示例：自定义规则
```

## 用户自定义组件

用户可以在 `.xuanji/users/{userId}/prompts/` 目录下创建自己的 prompt 组件。

### 文件格式

支持 JSON5、YAML、JSON 格式。推荐使用 JSON5（支持注释）。

### 配置示例

```json5
{
  // 唯一标识（必填）
  id: 'my-custom-coding',
  
  // 人类可读名称（必填）
  name: 'My Custom Coding Guide',
  
  // 所属层级（必填）：L0 | L1 | L2 | L3
  layer: 'L1',
  
  // 适用场景（L1 组件必填）
  scenes: ['coding'],
  
  // 优先级（必填）：数字越大越优先
  // 建议范围：L0: 90-100, L1: 70-80, L2: 80-90, L3: 60-70
  priority: 75,
  
  // 预估 token 数（必填）
  estimatedTokens: 500,
  
  // 是否启用（可选，默认 true）
  enabled: true,
  
  // 场景匹配配置（L1 组件可选）
  match: {
    // 关键词正则表达式（字符串格式）
    keywords: '编程|代码|开发|bug|测试',
    // 场景描述（用于 embedding 匹配）
    description: '自定义编程场景指南，包含代码规范和工具偏好'
  },
  
  // 需要的工具列表（可选）
  requiredTools: ['read_file', 'write_file', 'edit_file'],
  
  // Extended Thinking 配置（可选）
  thinking: {
    type: 'adaptive',  // 'enabled' | 'adaptive'
    effort: 'medium',  // 'low' | 'medium' | 'high'
    budgetTokens: 2000
  },
  
  // Prompt 内容（必填，Markdown 格式）
  content: `# My Custom Coding Guide

## 代码规范

- 使用 4 空格缩进
- 函数名使用 camelCase
- 类名使用 PascalCase
- 常量使用 UPPER_SNAKE_CASE

## 工具偏好

- 优先使用 pnpm 而不是 npm
- 测试框架使用 Vitest
- 代码格式化使用 Prettier

## 自定义规则

- 在修改配置文件前，先备份
- 在执行危险操作前，先询问用户
- 在提交代码前，先运行测试
`
}
```

### 层级说明

- **L0 核心层**：始终加载，包含核心身份、安全底线
- **L1 能力层**：standard/complex 加载，根据场景选择（coding/life 等）
- **L2 行为层**：仅 complex 加载，包含计划、循环控制等
- **L3 上下文层**：始终加载，动态生成项目上下文

### 优先级规则

同一层级内，优先级高的组件会先被渲染。

- 如果你想覆盖内置组件，设置更高的优先级
- 如果你想补充内置组件，设置较低的优先级

### 场景匹配

L1 组件需要定义 `scenes` 和 `match` 配置：

- `scenes`: 场景名称列表（如 `['coding']`）
- `match.keywords`: 关键词正则表达式（用于快速匹配）
- `match.description`: 场景描述（用于 embedding 语义匹配）

### 热重载

修改配置文件后，会自动重新加载，无需重启 xuanji。

## 常见用例

### 1. 自定义编程规范

```json5
{
  id: 'my-coding-style',
  name: 'My Coding Style',
  layer: 'L1',
  scenes: ['coding'],
  priority: 76,  // 比内置 l1-coding (75) 高一点
  estimatedTokens: 300,
  content: `# My Coding Style

- 使用 TypeScript strict 模式
- 所有函数必须有 JSDoc 注释
- 禁止使用 any 类型
- 优先使用函数式编程
`
}
```

### 2. 添加新场景

```json5
{
  id: 'research-assistant',
  name: 'Research Assistant',
  layer: 'L1',
  scenes: ['research'],
  priority: 70,
  estimatedTokens: 600,
  match: {
    keywords: '研究|调研|分析|报告|论文',
    description: '学术研究、市场调研、数据分析、报告撰写'
  },
  content: `# Research Assistant

## Research Workflow
1. Define research question
2. Search for relevant sources
3. Analyze and synthesize
4. Present findings with citations
`
}
```

### 3. 自定义 L2 规则

```json5
{
  id: 'my-safety-rules',
  name: 'My Safety Rules',
  layer: 'L2',
  priority: 85,
  estimatedTokens: 200,
  content: `# My Safety Rules

- 在删除文件前，必须先备份
- 在修改数据库前，必须先创建快照
- 在执行 rm -rf 前，必须二次确认
`
}
```

### 4. 禁用内置组件

如果你想完全替换内置组件，可以创建同名组件并设置更高优先级，或者在内置组件的基础上扩展。

注意：无法直接禁用内置组件，但可以通过更高优先级的自定义组件来覆盖。

## 调试

查看加载的组件：

```bash
# 查看日志
tail -f .xuanji/users/{userId}/logs/xuanji-*.log | grep PromptComponentRegistry
```

日志会显示：
- 加载了哪些用户自定义组件
- 组件的 ID、名称、层级
- 是否有加载错误

## 最佳实践

1. **保持简洁**：每个组件专注于一个主题
2. **合理分层**：根据使用频率选择层级
3. **明确优先级**：避免组件之间冲突
4. **使用注释**：JSON5 支持注释，充分利用
5. **版本控制**：重要的自定义组件可以备份到 Git
6. **测试验证**：修改后测试效果，确保符合预期

## 故障排除

### 组件没有加载

1. 检查文件格式是否正确（JSON5/YAML/JSON）
2. 检查必填字段是否完整
3. 检查 `enabled` 字段是否为 `false`
4. 查看日志中的错误信息

### 组件没有生效

1. 检查 `layer` 和 `scenes` 是否匹配当前场景
2. 检查 `priority` 是否足够高
3. 检查 `content` 是否为空
4. 使用 `DEBUG_FULL_REQUEST=1` 查看最终的 system prompt

### 热重载不工作

1. 确保文件保存成功
2. 检查文件权限
3. 重启 xuanji
