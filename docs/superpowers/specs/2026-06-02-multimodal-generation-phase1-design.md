# 多模态生成能力 Phase 1 — 设计规格书

> 日期: 2026-06-02
> 状态: 设计完成，待实现
> 范围: Phase 1 — 豆包生图 + 图片编辑

## 1. 目标

为 xuanji 增加多模态生成能力，Phase 1 支持：

- **文生图**（`generate_image`）：LLM 根据文本描述调用豆包 API 生成图片，结果通过 `contentBlocks` 在前端渲染
- **图片编辑**（`edit_image`）：LLM 对已有图片进行局部重绘（repaint），使用 mask 指定编辑区域

核心理念：**对话 LLM 和生图 API 完全解耦** —— Agent 用 DeepSeek 对话，但生图走火山引擎豆包，各自有独立的 API Key 和模型配置。

## 2. 架构

```
Agent 对话 (LLM)
  │ tool_use("generate_image", { prompt: "一只猫", size: "2K" })
  ▼
GenerateImageTool.execute(input)
  ├─ AbstractMediaGenTool.validateInput(input)  ← 校验 prompt 非空
  ├─ ToolConfigManager.getConfig("generate_image") ← 读取配置
  ├─ AdapterFactory.getAdapter(cfg.provider)       ← 选择平台适配器
  ├─ adapter.generateImage(input, cfg)              ← 调用 API
  └─ 返回 ToolResult { contentBlocks: [...] }       ← 前端渲染
```

**分层原则**：
- **Tool 层**：不关心平台，只关心接口
- **Adapter 层**：所有平台差异封装在 `PlatformAdapter` 接口后面
- **配置层**：`ToolConfigManager` 从 Agent YAML 加载配置，全局单例

## 3. 文件结构

```
src/core/tools/
├── adapters/
│   ├── PlatformAdapter.ts      # PlatformAdapter 接口 + ContentBlockResult + MediaGenInput
│   ├── AdapterFactory.ts       # provider → adapter 映射
│   ├── adapter-utils.ts        # apiPost / parseB64Images / resolveSize
│   └── ArkAdapter.ts           # 火山引擎豆包适配器
├── AbstractMediaGenTool.ts     # 基类（校验 + config + 错误处理）
├── GenerateImageTool.ts        # 文生图工具
├── EditImageTool.ts            # 图片编辑工具（repaint）
└── ToolConfigManager.ts        # 配置管理单例
```

## 4. 核心接口

### 4.1 PlatformAdapter

```typescript
export interface ContentBlockResult {
  type: 'image';
  mimeType: string;
  data: string;        // base64 编码数据，过大时为空字符串
  url?: string;        // 远程 URL，前端直接渲染
}

export interface MediaGenInput {
  prompt: string;
  model?: string;
  size?: string;               // "1K" | "2K" | "4K"
  n?: number;                  // 生成数量 (1-4)
  reference_images?: string[]; // 参考图 (最多2张)
  output_format?: string;      // "png" | "jpg" | "webp"
  source_image?: string;       // 编辑源图
  mask?: string;               // 编辑蒙版
}

export interface PlatformAdapter {
  readonly name: string;
  readonly defaultBaseURL: string;
  generateImage(input: MediaGenInput, cfg: ToolMediaGenConfig): Promise<ContentBlockResult[]>;
  editImage(input: MediaGenInput, cfg: ToolMediaGenConfig, operation: string): Promise<ContentBlockResult[]>;
}
```

### 4.2 ToolMediaGenConfig

```typescript
export interface ToolMediaGenConfig {
  provider: string;       // "ark"
  model: string;          // "doubao-seedream-5-0-260128"
  apiKey: string;
  baseURL?: string;       // 默认: https://ark.cn-beijing.volces.com/api/v3
  defaultSize?: string;   // "2K"
  watermark?: boolean;    // false
}
```

### 4.3 AdapterFactory

```typescript
const adapters: Record<string, PlatformAdapter> = {
  ark: new ArkAdapter(),
  // Phase 2: bailian: new BailianAdapter(),
};

export function getAdapter(provider: string): PlatformAdapter {
  const adapter = adapters[provider];
  if (!adapter) throw new Error(`未知平台: ${provider}。目前支持: ${Object.keys(adapters).join(', ')}`);
  return adapter;
}
```

## 5. ArkAdapter（火山引擎豆包）

豆包生图走 OpenAI 兼容的 `/images/generations` 端点。

### 5.1 generateImage

- **端点**: `POST {baseURL}/images/generations`
- **请求体**: model, prompt, size, n, response_format="b64_json", extra_body (watermark, output_format, reference_images)
- **响应**: `{ data: [{ b64_json: "..." | url: "..." }, ...] }`
- **支持**: 参考图（最多2张）、多图生成（最多4张，sequential 模式）

### 5.2 editImage

- **复用**: 同一端点 `/images/generations`，extra_body 中传入 `image` + `mask`
- **限制**: 仅支持 `repaint` 操作。background/expand/erase/style 需要千问平台（Phase 2）
- **错误提示**: 调用非 repaint 操作时返回明确引导：「豆包仅支持 repaint 操作。如需其他编辑操作，请配置千问平台。」

## 6. AbstractMediaGenTool 基类

```typescript
export abstract class AbstractMediaGenTool extends BaseTool {
  abstract readonly toolConfigName: string;   // "generate_image" | "edit_image"
  abstract readonly mediaType: 'image';
  abstract readonly displayUnit: string;      // "张"

  readonly readonly = true;  // 无副作用，可并行
  public configManager?: ToolConfigManager;

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    // 1. 通用校验 → 2. 配置校验 → 3. 委托 doExecute()
  }

  protected validateInput(input): ToolResult | null { /* prompt 非空 */ }
  protected abstract doExecute(input, cfg: ToolMediaGenConfig): Promise<ToolResult>;
}
```

**BaseTool 改动**：新增 `toolConfig?: Record<string, unknown>`（向后兼容，不传不影响现有工具）。

## 7. 两个工具

### 7.1 GenerateImageTool

| 字段 | 值 |
|------|-----|
| name | `generate_image` |
| 必填参数 | `prompt` |
| 可选参数 | `size`, `n`, `reference_images`, `output_format`, `model` |
| 说明 | LLM 传入 prompt → 工具调豆包 API → 返回 contentBlocks |

### 7.2 EditImageTool

| 字段 | 值 |
|------|-----|
| name | `edit_image` |
| 必填参数 | `prompt`, `source_image` |
| 可选参数 | `mask`, `operation`(当前仅 `repaint`), `model` |
| 说明 | LLM 传入原图+描述+蒙版 → 工具调豆包 API → 返回编辑后的图片 |

## 8. ToolConfigManager 配置管理

**模式**: 单例。Agent 初始化时从 YAML 加载，工具执行时按需读取。

```typescript
export class ToolConfigManager {
  private static instance: ToolConfigManager;
  private configs = new Map<string, ToolMediaGenConfig>();

  static getInstance(): ToolConfigManager { /* ... */ }

  loadFromAgentConfig(tools: Array<{ name: string; config?: Record<string, unknown> }>): void {
    for (const t of tools) {
      if (t.config) this.configs.set(t.name, t.config as ToolMediaGenConfig);
    }
  }

  getConfig(toolName: string): ToolMediaGenConfig | undefined {
    return this.configs.get(toolName);
  }
}
```

### Agent YAML 配置示例

```yaml
tools:
  - name: generate_image
    enabled: true
    config:
      provider: ark
      model: doubao-seedream-5-0-260128
      apiKey: "your-volc-key"
      defaultSize: 2K
      watermark: false

  - name: edit_image
    enabled: true
    config:
      provider: ark
      model: doubao-seedream-5-0-260128
      apiKey: "your-volc-key"
      watermark: false
```

## 9. 现有代码改动

| 文件 | 改动 | 量 |
|------|------|----|
| `src/core/tools/BaseTool.ts` | 新增 `config?: Record<string, unknown>` | +3 |
| `src/core/tools/ToolRegistry.ts` | `createDefaultRegistry()` 注册 2 个工具 | +4 |
| `src/shared/types/config.ts` | 新增 `ToolMediaGenConfig` 类型 | +12 |
| 新增 8 个文件 | adapters/ 目录 + 基类 + 工具 + 配置管理 | ~280 |
| **合计** | **11 文件，~300 行增量** | |

**不碰的文件**：
- FilteredToolRegistry — 不改，配置不经过此处注入
- Agent YAML 解析 — `tools[].config` 已是通用字段
- MessageBubble 前端 — `contentBlocks.image` 渲染已就绪
- Provider / Session / Permission 层 — 完全无关

**唯一初始化入口**：Agent 初始化时调用 `ToolConfigManager.getInstance().loadFromAgentConfig(agentTools)`。

## 10. 共享工具函数（adapter-utils.ts）

| 函数 | 功能 |
|------|------|
| `apiPost(url, cfg, body, timeout?)` | 带超时 + Bearer auth 的 POST，自动解析错误消息 |
| `apiGet(url, cfg, timeout?)` | 带超时 + Bearer auth 的 GET（Phase 2 视频轮询用） |
| `waitForAsyncTask(api, cfg)` | 异步任务轮询器（Phase 2 视频用） |
| `parseB64Images(data)` | 从 `data.data[].b64_json / url` 提取 ContentBlockResult[] |
| `resolveSize(input?, default?)` | "1K"/"2K"/"4K" → 具体分辨率 |

## 11. 错误处理

| 场景 | 行为 |
|------|------|
| prompt 为空 | `validateInput` 拦截，返回「prompt 参数不能为空」 |
| 无配置 | `configManager.getConfig` 返回 undefined → 「请在 Agent 配置中添加工具」 |
| 无 API Key | `cfg.apiKey` 为空 → 「缺少 API Key」 |
| API 调用失败 | `apiPost` 自动解析错误 → 「图片生成失败: {message}」 |
| 响应格式异常 | `parseB64Images` 检测 → 「API 响应格式异常 / 返回了空的生成结果」 |
| 非 repaint 操作 | ArkAdapter 抛错 → 「豆包仅支持 repaint。如需其他操作，请配置千问平台。」 |

## 12. 测试策略

| 层级 | 测试内容 | 工具 |
|------|---------|------|
| 单元 | `parseB64Images`、`resolveSize`、`ToolConfigManager` | vitest |
| 单元 | `AbstractMediaGenTool.validateInput`、错误分支 | vitest |
| 集成 | `ArkAdapter.generateImage` 调真实 API（需 API Key） | 手动 / vitest |
| E2E | LLM 理解用户意图 → 调 generate_image → 前端渲染 | 手动 |

## 13. 限制与已知约束

1. **豆包仅支持 repaint 编辑** — 其他编辑操作需等 Phase 2 千问适配器
2. **base64 传输** — 图片以 base64 编码在 contentBlocks 中传输，超大幅图片可能有性能压力
3. **无缓存** — 相同 prompt 重复调用会重新生成，无去重
4. **无进度反馈** — 生图是同步 HTTP 请求，无中间进度（Phase 2 视频会涉及异步轮询）

## 14. Phase 2 展望

- **BailianAdapter（千问）**：支持完整的图片编辑操作（repaint/background/expand/erase/style）+ CosyVoice TTS 音频生成
- **GenerateVideoTool**：文生视频 / 图生视频，异步任务 + 轮询，结果通过 `send_file_to_user` 投递
- **GenerateAudioTool**：TTS 文本转语音，base64 或 URL 返回
- **前端 UI**：Agent Editor 中为媒体工具提供配置表单（provider 下拉、model 输入框、API Key 输入框）
