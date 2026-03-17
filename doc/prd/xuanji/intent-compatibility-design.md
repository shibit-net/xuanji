# 意图识别兼容性设计

## 问题

当前设计要求所有模块必须实现 `IntentRegistrable` 接口并提供 `intentMeta` 字段，这会导致：

1. ❌ 无法兼容 OpenClaw Skills（它们没有 intentMeta）
2. ❌ 无法兼容第三方 Skill/MCP（它们不知道这个接口）
3. ❌ 强制性太强，破坏现有生态

## 解决方案：可选意图增强 + 适配器模式

### 核心思路

**`intentMeta` 是可选的增强功能，不是强制要求**

- ✅ 有 `intentMeta` → 自动注册到意图系统
- ✅ 没有 `intentMeta` → 仍然可用，只是不参与意图识别
- ✅ 第三方模块 → 通过适配器手动配置意图

---

## 1. 修改接口设计

### 修改前（强制）

```typescript
// ❌ 强制要求
export interface Skill extends SkillMetadata {
  intentMeta: IntentMetadata;  // 必需
  moduleType: ModuleType;      // 必需
  // ...
}
```

### 修改后（可选）

```typescript
// ✅ 可选增强
export interface Skill extends SkillMetadata {
  /** 意图元数据（可选，提供后将自动注册到意图系统） */
  intentMeta?: IntentMetadata;

  /** 模块类型（可选，用于意图系统分类） */
  moduleType?: ModuleType;

  // ... 其他字段保持不变
}

// ✅ 单独的接口用于类型守卫
export interface IntentRegistrable {
  intentMeta: IntentMetadata;
  moduleType: ModuleType;
  id: string;
}
```

---

## 2. UniversalIntentScanner 兼容处理

```typescript
export class UniversalIntentScanner {
  /**
   * 加载 TypeScript 模块（兼容有无 intentMeta）
   */
  private async loadTypeScriptModule(filePath: string): Promise<ScanResult[]> {
    const module = await import(fileUrl);
    const results: ScanResult[] = [];

    for (const key of Object.keys(module)) {
      const exported = module[key];
      if (typeof exported !== 'function') continue;

      let instance: any;
      try {
        instance = new exported();
      } catch {
        continue;
      }

      // ✅ 只注册有 intentMeta 的模块
      if (this.hasIntentMeta(instance)) {
        results.push({
          intentMeta: instance.intentMeta,
          module: instance,
          moduleType: instance.moduleType || this.inferModuleType(instance),
          moduleId: instance.id,
          filePath,
        });
      }
      // ✅ 没有 intentMeta 的模块被跳过（不影响其正常使用）
    }

    return results;
  }

  /**
   * 检查是否有 intentMeta（类型守卫）
   */
  private hasIntentMeta(obj: any): obj is IntentRegistrable {
    return (
      obj &&
      typeof obj === 'object' &&
      'intentMeta' in obj &&
      this.isValidIntentMetadata(obj.intentMeta)
    );
  }

  /**
   * 推断模块类型（基于接口特征）
   */
  private inferModuleType(obj: any): ModuleType {
    if ('render' in obj && typeof obj.render === 'function') {
      return 'prompt-component';
    }
    if ('execute' in obj && typeof obj.execute === 'function') {
      return 'skill';
    }
    if ('name' in obj && 'execute' in obj) {
      return 'mcp-tool';
    }
    return 'custom';
  }
}
```

---

## 3. OpenClaw Skill 兼容

### 方式 1: Markdown Frontmatter（推荐）

```markdown
<!-- skill.md -->
---
id: my-openclaw-skill
name: My OpenClaw Skill
description: A skill description

# ✅ 可选的意图配置（如果提供，自动注册到意图系统）
intentType: coding.custom-feature
domain: coding
trainingExamples:
  - 执行某功能
  - 做某事
  - 运行某操作
---

# Skill Content

...
```

**解析逻辑**：

```typescript
private async loadMarkdownModule(filePath: string): Promise<ScanResult | null> {
  const { frontmatter } = this.parseMarkdown(content);

  // ✅ 如果没有意图配置，返回 null（不注册到意图系统）
  if (!frontmatter.intentType || !frontmatter.trainingExamples) {
    return null;
  }

  // ✅ 有意图配置，注册到意图系统
  const intentMeta: IntentMetadata = {
    type: frontmatter.intentType,
    domain: frontmatter.domain || 'general',
    trainingExamples: frontmatter.trainingExamples,
    // ...
  };

  return {
    intentMeta,
    module: { intentMeta, moduleType: 'skill', id: frontmatter.id },
    moduleType: 'skill',
    moduleId: frontmatter.id,
    filePath,
  };
}
```

### 方式 2: 外部配置文件（适用于无法修改源码的第三方 Skill）

```json
// ~/.xuanji/intent-adapters.json
{
  "adapters": [
    {
      "targetModule": "third-party-skill-id",
      "intentMeta": {
        "type": "custom.third-party",
        "domain": "general",
        "trainingExamples": [
          "使用第三方功能",
          "调用外部 Skill"
        ]
      }
    }
  ]
}
```

**适配器加载**：

```typescript
export class IntentAdapterLoader {
  /**
   * 加载意图适配器配置
   */
  async load(): Promise<Map<string, IntentMetadata>> {
    const configPath = path.join(os.homedir(), '.xuanji/intent-adapters.json');
    const content = await fs.readFile(configPath, 'utf-8');
    const data = JSON.parse(content);

    const adapters = new Map<string, IntentMetadata>();

    for (const adapter of data.adapters) {
      adapters.set(adapter.targetModule, adapter.intentMeta);
    }

    return adapters;
  }
}
```

**在 IntentRegistry 中应用**：

```typescript
export class IntentRegistry {
  private adapters = new Map<string, IntentMetadata>();

  async init() {
    // 加载适配器配置
    const loader = new IntentAdapterLoader();
    this.adapters = await loader.load();
  }

  /**
   * 注册模块（支持适配器）
   */
  register(module: any): void {
    // 1. 优先使用模块自带的 intentMeta
    if (this.hasIntentMeta(module)) {
      this.doRegister(module.intentMeta, module);
      return;
    }

    // 2. 检查是否有适配器配置
    const adapterMeta = this.adapters.get(module.id);
    if (adapterMeta) {
      this.doRegister(adapterMeta, module);
      return;
    }

    // 3. 没有意图配置，跳过（不影响模块正常使用）
  }
}
```

---

## 4. MCP Tool 兼容

### MCP 协议扩展（可选）

```json
// MCP Tool Definition (符合 MCP 协议)
{
  "name": "web_search",
  "description": "Search the web",
  "inputSchema": { ... },

  // ✅ 扩展字段（可选，不破坏 MCP 协议）
  "x-xuanji-intent": {
    "type": "general.web-search",
    "domain": "general",
    "trainingExamples": [
      "搜索网络",
      "查找资料",
      "在线搜索"
    ]
  }
}
```

**MCP Tool 适配器**：

```typescript
export class MCPToolAdapter {
  /**
   * 将 MCP Tool 转换为 IntentRegistrable
   */
  adapt(mcpTool: MCPTool): IntentRegistrable | null {
    // 检查是否有 Xuanji 扩展
    const xuanjiIntent = (mcpTool as any)['x-xuanji-intent'];

    if (!xuanjiIntent) {
      return null; // 没有意图配置
    }

    return {
      intentMeta: {
        type: xuanjiIntent.type,
        domain: xuanjiIntent.domain,
        trainingExamples: xuanjiIntent.trainingExamples,
      },
      moduleType: 'mcp-tool',
      id: mcpTool.name,
    };
  }
}
```

---

## 5. 完整的兼容性架构

```
┌─────────────────────────────────────────────────────┐
│ 模块来源                                             │
├─────────────────────────────────────────────────────┤
│                                                      │
│  1. 内置 Skill (有 intentMeta)    → 直接注册 ✅     │
│  2. 内置 Skill (无 intentMeta)    → 跳过 ✅         │
│  3. OpenClaw Skill (Markdown)     → 可选配置 ✅     │
│  4. 第三方 Skill (无 intentMeta)  → 适配器 ✅       │
│  5. MCP Tool (标准协议)           → 扩展字段 ✅     │
│  6. MCP Tool (第三方)             → 适配器 ✅       │
│                                                      │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│ UniversalIntentScanner                              │
│ ├── 扫描所有模块                                     │
│ ├── 检查 intentMeta（可选）                          │
│ ├── 加载适配器配置                                   │
│ └── 只注册有意图配置的模块                           │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│ IntentRegistry                                       │
│ └── 注册到意图系统                                   │
└─────────────────────────────────────────────────────┘
                    ↓
         意图识别可用 ✅
```

---

## 6. 使用示例

### 示例 1: 内置 Skill（自带 intentMeta）

```typescript
export class StockAnalyzerSkill implements Skill {
  id = 'stock-analyzer';
  name = 'Stock Analyzer';
  description = 'Analyze stock data';

  // ✅ 可选的意图元数据
  intentMeta = {
    type: 'finance.stock-analysis',
    domain: 'finance',
    trainingExamples: ['分析股票', '查询股价'],
  };

  moduleType = 'skill';

  async execute(params: any) {
    // ...
  }
}
```

### 示例 2: OpenClaw Skill（Markdown 配置）

```markdown
---
id: my-skill
name: My Skill

# ✅ 可选的意图配置
intentType: coding.my-feature
domain: coding
trainingExamples:
  - 执行功能
  - 做某事
---

# Content
```

### 示例 3: 第三方 Skill（适配器）

```typescript
// 第三方 Skill（无法修改源码）
export class ThirdPartySkill {
  id = 'third-party-skill';
  async execute() { /* ... */ }
}
```

```json
// ~/.xuanji/intent-adapters.json
{
  "adapters": [
    {
      "targetModule": "third-party-skill",
      "intentMeta": {
        "type": "custom.third-party",
        "domain": "general",
        "trainingExamples": ["使用第三方", "调用外部功能"]
      }
    }
  ]
}
```

### 示例 4: 传统 Skill（无意图识别）

```typescript
export class LegacySkill implements Skill {
  id = 'legacy-skill';
  name = 'Legacy Skill';

  // ❌ 没有 intentMeta → 不参与意图识别

  async render() {
    return 'legacy content';
  }
}
```

**行为**：
- ✅ 仍然可以正常加载和使用
- ❌ 不会被自动识别（需要手动调用）
- ✅ 可以通过适配器添加意图识别

---

## 7. 优势总结

| 特性 | 实现方式 |
|------|---------|
| **向后兼容** | intentMeta 可选，不影响现有 Skill |
| **OpenClaw 兼容** | Markdown frontmatter 可选配置 |
| **第三方兼容** | 适配器模式 |
| **MCP 兼容** | 扩展字段（不破坏协议） |
| **渐进增强** | 有意图配置 → 更智能；无配置 → 仍可用 |
| **生态友好** | 不强制要求，开发者自由选择 |

---

## 8. 实施修改

### 文件修改清单

1. `src/core/skills/types.ts` - 将 `intentMeta` 和 `moduleType` 改为可选
2. `src/core/intent/UniversalIntentScanner.ts` - 添加 `hasIntentMeta()` 类型守卫
3. `src/core/intent/IntentRegistry.ts` - 支持适配器模式
4. 新增 `src/core/intent/IntentAdapterLoader.ts` - 加载适配器配置
5. 新增 `src/core/intent/MCPToolAdapter.ts` - MCP Tool 适配器

### 配置文件示例

创建 `~/.xuanji/intent-adapters.json`：
```json
{
  "version": "1.0.0",
  "adapters": [
    {
      "targetModule": "third-party-skill",
      "intentMeta": {
        "type": "custom.feature",
        "domain": "general",
        "trainingExamples": ["使用功能"]
      }
    }
  ]
}
```

---

## 总结

**核心原则**：**可选增强，不破坏兼容性**

- ✅ 有 `intentMeta` → 享受智能意图识别
- ✅ 没有 `intentMeta` → 仍然正常工作
- ✅ 第三方模块 → 适配器模式
- ✅ 完全向后兼容 → 不影响现有生态

这样既实现了智能意图路由的 Jarvis 体验，又保持了与 OpenClaw 和第三方 Skill/MCP 的完全兼容！
