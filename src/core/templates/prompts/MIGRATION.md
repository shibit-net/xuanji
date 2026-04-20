# Prompt 组件迁移说明

## 迁移完成 ✅

所有内置 prompt 组件已从 TypeScript 文件迁移到 JSON5 配置文件。

### 迁移前（旧架构）
```
src/core/prompt/components/
├── base-identity.ts          # TypeScript 组件
├── base-memory-guide.ts
├── base-task-execution.ts
├── l0-identity.ts
├── l0-safety.ts
├── l1-coding.ts
├── l1-life.ts
├── l2-planning.ts
├── l2-agent-rules.ts
├── l2-safety.ts
├── l2-team-coordination.ts
└── l3-project.ts
```

### 迁移后（新架构）
```
src/core/templates/prompts/     # 模板目录（git 追踪）
├── README.md                   # 使用文档
├── MIGRATION.md                # 本文件
├── l0-safety.json5             # JSON5 配置
├── l1-coding.json5
├── l1-life.json5
├── l2-planning.json5
├── l2-agent-rules.json5
├── l2-safety.json5
└── l2-team-coordination.json5

.xuanji/users/{userId}/prompts/ # 用户目录（不被 git 追踪）
├── l0-safety.json5             # 首次启动时从模板复制
├── l1-coding.json5
├── l1-life.json5
├── l2-planning.json5
├── l2-agent-rules.json5
├── l2-safety.json5
└── l2-team-coordination.json5
```

## 未迁移的组件

以下组件因特殊原因未迁移，保留为 TypeScript 文件：

### 1. base-* 组件
- `base-identity.ts` - 动态生成（依赖 PersonaConfig）
- `base-memory-guide.ts` - 复杂逻辑
- `base-task-execution.ts` - 复杂逻辑

这些组件包含动态逻辑，不适合转换为静态 JSON5 配置。

### 2. l0-identity.ts
- 组合 base-* 组件的包装器
- 保留用于向后兼容

### 3. l3-project.ts
- 动态生成项目上下文
- 调用 ProjectScanner、RulesLoader 等
- 不适合静态配置

## 工作流程

### 首次启动
1. 用户启动 xuanji
2. `PromptComponentRegistry.init()` 检查用户目录
3. 如果为空，从 `src/core/templates/prompts/` 复制所有 `.json5` 文件
4. 到 `.xuanji/users/{userId}/prompts/`
5. 用户可以自由修改这些文件

### 后续启动
1. `PromptComponentRegistry` 加载用户目录中的所有 `.json5` 文件
2. 验证配置格式
3. 转换为 `PromptComponent` 对象
4. 注册到 `LayeredPromptBuilder`

### 热重载
- 修改 `.xuanji/users/{userId}/prompts/` 中的文件
- 文件监听器自动检测变化
- 重新加载组件
- 无需重启 xuanji

## 优势

1. **用户完全控制**：所有 prompt 组件都在用户目录，可以自由修改
2. **版本控制友好**：用户配置不在 git 中，但可以自行备份
3. **易于扩展**：添加新场景只需创建新的 JSON5 文件
4. **热重载**：修改即生效，开发体验好
5. **类型安全**：配置验证，避免错误

## 后续清理

可以安全删除以下文件（已迁移到 JSON5）：
- ~~`src/core/prompt/components/l0-safety.ts`~~
- ~~`src/core/prompt/components/l1-coding.ts`~~
- ~~`src/core/prompt/components/l1-life.ts`~~
- ~~`src/core/prompt/components/l2-planning.ts`~~
- ~~`src/core/prompt/components/l2-agent-rules.ts`~~
- ~~`src/core/prompt/components/l2-safety.ts`~~
- ~~`src/core/prompt/components/l2-team-coordination.ts`~~

保留以下文件（未迁移）：
- `src/core/prompt/components/base-identity.ts`
- `src/core/prompt/components/base-memory-guide.ts`
- `src/core/prompt/components/base-task-execution.ts`
- `src/core/prompt/components/l0-identity.ts`
- `src/core/prompt/components/l3-project.ts`
- `src/core/prompt/components/index.ts`

## 测试

启动 xuanji 后，检查：
1. `.xuanji/users/{userId}/prompts/` 目录是否自动创建
2. 是否包含所有模板文件
3. 修改文件后是否自动重新加载
4. 日志中是否有加载成功的信息

```bash
# 查看日志
tail -f .xuanji/users/{userId}/logs/xuanji-*.log | grep PromptComponentRegistry
```

预期输出：
```
[PromptComponentRegistry] 初始化 PromptComponentRegistry (user: {userId})...
[PromptComponentRegistry] 从模板复制 7 个 Prompt 组件...
[PromptComponentRegistry] 复制: l0-safety.json5
[PromptComponentRegistry] 复制: l1-coding.json5
...
[PromptComponentRegistry] PromptComponentRegistry 初始化完成，已加载 7 个自定义组件
```
