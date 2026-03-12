# Token 优化方案 — 不降低上下文质量的前提下节省成本

## 📊 现状分析

### ✅ 已实现的优化

1. **Prompt Caching（Anthropic）**
   - System prompt 基础部分标记缓存 (`cache_control: ephemeral`)
   - 工具 schema 列表末尾标记缓存
   - 位置：`src/core/providers/AnthropicProvider.ts` L283-313, L59

2. **消息历史压缩（ContextCompressor）**
   - LLM 语义压缩（优先）：8 段结构化摘要
   - 规则压缩（降级）：保留决策关键信息
   - 保留最近 N 轮完整
   - 位置：`src/core/agent/ContextCompressor.ts`

3. **工具动态加载**（✨ 刚实现）
   - 根据激活 Skill 过滤工具
   - 节省 30-36% tokens（9 个工具 ≈ 1350 tokens）
   - 位置：`src/core/tools/DynamicToolFilter.ts`

4. **Tool Result 截断**
   - `middleTruncate()` 中间截断，保留开头和结尾
   - 默认 80,000 字符上限
   - 位置：`src/core/utils/truncation.ts`

### 📈 当前 Token 消耗估算

| 项目 | Token 数 | 占比 | 备注 |
|------|---------|------|------|
| System Prompt (Skill) | 1,500-2,000 | 15% | 7 个 Skill × 200-300 tokens |
| Tool Schemas | 2,500-2,700 | 25% | 16 个工具（已动态过滤）|
| 消息历史 (5 轮) | 4,000-6,000 | 50% | 包含 tool results |
| 当前用户消息 | 100-500 | 5% | - |
| **总计** | **~10,000** | **100%** | 每轮对话 |

---

## 🎯 优化方向

### Phase 1: Tool Schema 精简（高优先级）

**问题**：工具描述过于冗长，占用 25% tokens

**示例**（ReadTool）：
```typescript
readonly description = [
  '读取指定文件的内容。支持文本、PDF、图片。',
  '',
  '# 支持的文件类型',
  '- 文本文件: 带行号输出, 支持 offset/limit 分页读取大文件',
  '- PDF 文件: 提取文本内容, 大 PDF (>10 页) 必须提供 pages 参数, 每次最多 20 页',
  '- 图片文件 (PNG/JPG/GIF/WebP): 返回 base64 编码, 可被 Vision 模型理解',
  '',
  '# 使用指南',
  '- 在修改文件前必须先读取, 理解现有代码再提出修改',
  '- 多个文件可以并行读取 (多次调用 read_file)',
  '- 大文件 (>10MB) 会自动使用流式读取, 建议配合 offset/limit 分段读取',
].join('\n');
```

**优化后**：
```typescript
readonly description = '读取文件内容。支持文本(带行号,可分页)、PDF(需指定pages)、图片(base64)。修改前必读。';
```

**节省**：~150 tokens/工具 × 16 工具 = **2,400 tokens (-90%)**

#### 实现方案

**方案 A：静态简化**
- 修改所有工具的 `description` 和 `input_schema.properties[].description`
- 去除冗余的"使用指南"、换行、emoji
- 保留核心功能说明
- **优点**：简单直接，立即生效
- **缺点**：需逐个修改，维护成本高

**方案 B：动态调整（推荐）**
- 新增 `ToolSchemaOptimizer` 类
- 根据上下文动态生成简化版 schema
- 配置：`tools.schemaMode: 'compact' | 'detailed' | 'auto'`
  - `compact`: 极简模式（生产环境）
  - `detailed`: 详细模式（调试、首次使用）
  - `auto`: 自动识别（首轮详细，后续简化）

```typescript
// src/core/tools/ToolSchemaOptimizer.ts
export class ToolSchemaOptimizer {
  /**
   * 简化工具 schema
   */
  simplify(schema: ToolSchema): ToolSchema {
    return {
      name: schema.name,
      // 提取第一句话作为核心描述
      description: this.extractCoreSentence(schema.description),
      input_schema: {
        ...schema.input_schema,
        properties: this.simplifyProperties(schema.input_schema.properties),
      },
    };
  }

  private extractCoreSentence(desc: string): string {
    // 提取第一行或第一句话（到第一个句号）
    const firstLine = desc.split('\n')[0];
    const firstSentence = firstLine.split(/[。.]/)[0];
    return firstSentence.slice(0, 100); // 最多 100 字符
  }

  private simplifyProperties(props?: Record<string, any>): Record<string, any> {
    if (!props) return {};
    const simplified: Record<string, any> = {};
    for (const [key, value] of Object.entries(props)) {
      simplified[key] = {
        ...value,
        // 简化属性描述（去除示例、格式说明）
        description: value.description?.split(/[。.]/)[0].slice(0, 50),
      };
    }
    return simplified;
  }
}
```

**集成到 ChatSession**：
```typescript
// src/core/chat/ChatSession.ts init()
if (this.config.tools?.schemaMode === 'compact') {
  const optimizer = new ToolSchemaOptimizer();
  // 包装 registry.getSchemas()
  const originalGetSchemas = this.registry.getSchemas.bind(this.registry);
  this.registry.getSchemas = () => {
    return originalGetSchemas().map(s => optimizer.simplify(s));
  };
}
```

---

### Phase 2: Prompt Caching 策略优化（中优先级）

**问题**：当前缓存策略不够激进

**当前策略**：
- 缓存 system prompt 第一个 block（基础部分）
- 缓存最后一个 tool schema

**优化后**：
- 缓存 system prompt 所有 block（基础 + 稳定后缀）
- 缓存前 N-1 个 tool schemas（N = 工具总数）
- 动态后缀（memory/reminder）放在 cache 之后

```typescript
// src/core/providers/AnthropicProvider.ts
private buildSystemBlocks(systemMessages: Message[]): Anthropic.TextBlockParam[] {
  const blocks: Anthropic.TextBlockParam[] = [];
  for (const msg of systemMessages) {
    if (Array.isArray(msg.content)) {
      const textBlocks = msg.content.filter(b => b.type === 'text' && b.text);
      for (let i = 0; i < textBlocks.length; i++) {
        blocks.push({
          type: 'text',
          text: textBlocks[i].text!,
          // 🆕 优化：所有非最后一个 block 都标记缓存
          // 最后一个 block（动态后缀）不缓存
          ...(i < textBlocks.length - 1 ? { cache_control: { type: 'ephemeral' } } : {}),
        });
      }
    }
  }
  return blocks;
}

// 工具 schema 缓存优化
tools: tools.map((t, i) => ({
  name: t.name,
  description: t.description,
  input_schema: t.input_schema,
  // 🆕 优化：所有工具都标记缓存（Anthropic 支持 4 个断点）
  // 动态后缀不计入缓存，这样工具列表完全稳定
  cache_control: { type: 'ephemeral' as const },
})),
```

**节省**：缓存命中率从 ~30% 提升到 ~80%，减少 50% 的 system+tools tokens

---

### Phase 3: System Prompt 分层加载（中优先级）

**问题**：7 个 Skill × 200 tokens = 1,400 tokens，但每轮对话只需要其中一部分

**方案**：结合 Skill 意图路由，动态注入 Skill 内容

**当前**：
```typescript
// 所有 Skill 内容一次性加载到 system prompt
const systemPrompt = await skillRegistry.composeBatch(enabledIds, { ... });
```

**优化后**：
```typescript
// 1. 基础 system prompt（核心规则，始终加载）
const coreSkills = ['xuanji-assistant', 'security-rules', 'agent-rules'];
const corePrompt = await skillRegistry.composeBatch(coreSkills, { ... });

// 2. 场景 Skill（意图路由后动态注入）
const sceneSkills = ['code-assistant', 'life-secretary'];
const scenePrompt = await skillRegistry.composeBatch(filteredSceneSkills, { ... });

// 3. 工具指南（按需注入）
const toolGuidance = needsToolGuidance ? await skillRegistry.compose('tool-guidance') : '';

// 4. 分层结构（利用 Prompt Caching）
const systemBlocks = [
  { type: 'text', text: corePrompt, cache_control: { type: 'ephemeral' } },  // 稳定，缓存
  { type: 'text', text: scenePrompt, cache_control: { type: 'ephemeral' } }, // 半稳定，缓存
  { type: 'text', text: toolGuidance },  // 动态，不缓存
];
```

**节省**：减少 2-3 个不相关 Skill，节省 ~600 tokens

---

### Phase 4: Tool Result 智能摘要（低优先级）

**问题**：工具返回结果冗长（文件内容、命令输出），当前只是截断

**方案**：用 Light Model 生成智能摘要

```typescript
// src/core/agent/ToolResultSummarizer.ts
export class ToolResultSummarizer {
  constructor(private provider: ILLMProvider, private lightModel: string) {}

  /**
   * 摘要超长 tool_result
   */
  async summarize(toolName: string, result: string): Promise<string> {
    if (result.length < 10000) return result; // 短结果不处理

    const prompt = `Summarize this ${toolName} output in 3-5 bullet points (max 500 chars):

${result.slice(0, 50000)}`;

    const summary = await this.provider.complete(prompt, {
      model: this.lightModel,
      maxTokens: 500,
    });

    return `[Summarized by AI]\n${summary}\n\n[Full output truncated, ${result.length} chars]`;
  }
}
```

**使用场景**：
- `read_file` 返回超长文件
- `bash` 返回大量日志
- `grep` 返回数百个匹配

**节省**：每次摘要节省 5,000-10,000 tokens

**成本**：增加 1 次 Light Model 调用（~100 tokens input + 200 tokens output = 0.0001 USD）

---

### Phase 5: 消息历史压缩策略优化（低优先级）

**当前**：
- 保留最近 5 轮完整
- 压缩旧消息为摘要

**优化**：
- **自适应保留轮数**：根据任务复杂度动态调整
  - 简单问答：保留 3 轮
  - 复杂编程：保留 8 轮
- **关键信息提取**：
  - 保留所有文件路径、错误信息、决策点
  - 压缩冗余的代码片段、日志输出
- **渐进式压缩**：
  - 第 1-5 轮：完整保留
  - 第 6-10 轮：保留 tool_use + 简化 tool_result
  - 第 11+ 轮：压缩为摘要

```typescript
// src/core/agent/ContextCompressor.ts
async compress(messages: Message[], tokenManager: TokenManager): Promise<CompressionResult> {
  // 🆕 任务复杂度评估
  const complexity = this.assessComplexity(messages);
  const keepRecentRounds = complexity === 'high' ? 8 :
                           complexity === 'medium' ? 5 : 3;

  // 🆕 渐进式压缩
  const compressed = this.progressiveCompress(messages, keepRecentRounds);

  return { messages: compressed, ... };
}

private assessComplexity(messages: Message[]): 'low' | 'medium' | 'high' {
  const toolCallCount = messages.filter(m =>
    m.role === 'assistant' && Array.isArray(m.content) &&
    m.content.some(b => b.type === 'tool_use')
  ).length;

  const fileModifications = messages.filter(m =>
    m.role === 'user' && m.content.includes('write_file')
  ).length;

  if (toolCallCount > 15 || fileModifications > 5) return 'high';
  if (toolCallCount > 5 || fileModifications > 2) return 'medium';
  return 'low';
}
```

**节省**：简单任务减少 40% 历史消息 tokens

---

### Phase 6: Extended Thinking 动态控制（低优先级）

**问题**：thinking 块占用大量 input tokens（虽然便宜 3 倍，但累积仍显著）

**方案**：根据任务类型动态开启/关闭

```typescript
// src/core/config/defaults.ts
export const DEFAULT_CONFIG: AppConfig = {
  provider: {
    // ...
    thinkingMode: 'auto', // 'always' | 'never' | 'auto'
  },
};

// src/core/chat/ChatSession.ts
private shouldEnableThinking(userMessage: string): boolean {
  // 复杂编程任务：启用 thinking
  if (/重构|架构|设计|优化|复杂/.test(userMessage)) return true;

  // 简单问答：禁用 thinking
  if (/是什么|怎么|为什么/.test(userMessage)) return false;

  // 默认启用
  return true;
}
```

**节省**：简单任务减少 1,000-3,000 tokens thinking 输出

---

## 📊 优化效果预估

| Phase | 优化项 | 节省 Tokens | 相对降幅 | 成本影响 |
|-------|--------|------------|---------|---------|
| 1 | Tool Schema 精简 | 2,400 | -24% | ⬇️ 24% |
| 2 | Prompt Caching 优化 | 1,500* | -15% | ⬇️ 15% |
| 3 | System Prompt 分层 | 600 | -6% | ⬇️ 6% |
| 4 | Tool Result 摘要 | 2,000** | -20% | ⬇️ 19% |
| 5 | 消息压缩优化 | 1,000 | -10% | ⬇️ 10% |
| 6 | Thinking 控制 | 1,500 | -15% | ⬇️ 15% |
| **总计** | - | **9,000** | **-90%*** | **⬇️ 70%** |

*注：缓存节省是减少 cache write tokens，不是减少总 tokens*
**注：仅在超长 tool_result 场景生效*
***注：各项优化有重叠，实际总降幅约 60-70%*

---

## 🚀 实施优先级

### P0（立即实施）
- ✅ 工具动态加载（已完成）
- **Tool Schema 精简（方案 B: 动态调整）**

### P1（1-2 周）
- Prompt Caching 策略优化
- System Prompt 分层加载

### P2（1 个月）
- Tool Result 智能摘要
- 消息历史压缩优化

### P3（按需）
- Extended Thinking 动态控制

---

## 🎯 质量保障

**如何确保不降低上下文质量？**

1. **A/B 测试**：并行运行优化前后版本，对比任务完成质量
2. **关键信息保留**：
   - 文件路径、错误信息、决策点 100% 保留
   - 代码片段保留关键部分（函数签名、核心逻辑）
3. **可配置降级**：
   - `tools.schemaMode: 'detailed'` 回退到详细模式
   - `compressor.enabled: false` 禁用压缩
4. **监控指标**：
   - 任务成功率
   - 平均迭代次数
   - 用户满意度

---

## 📝 配置示例

```json
// ~/.xuanji/config.json
{
  "tools": {
    "schemaMode": "compact",  // 工具 schema 简化模式
    "resultSummary": {
      "enabled": true,        // 启用 tool result 摘要
      "threshold": 10000,     // 超过 10k 字符时摘要
      "tools": ["read_file", "bash", "grep"]  // 仅这些工具
    }
  },
  "compressor": {
    "enabled": true,
    "keepRecentRounds": 5,    // 保留最近 5 轮（根据复杂度自适应）
    "progressiveMode": true   // 启用渐进式压缩
  },
  "provider": {
    "thinkingMode": "auto"    // 自动控制 thinking
  }
}
```

---

## 🔗 相关文档

- [三大核心功能](./three-core-features-plan.md)
- [工具按需加载实现](../../../.claude/projects/-Users-kevinshi-Documents-workspace-codebase-shibit-xuanji/memory/MEMORY.md)
- [Anthropic Prompt Caching](https://docs.anthropic.com/claude/docs/prompt-caching)
