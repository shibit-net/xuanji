# 意图路由系统设计方案

## 背景

当前 `IntentRouter` 是一个硬编码占位桩，所有消息无论内容一律路由到 `xuanji` agent。项目已存在 `scene-classifier` agent 配置（意图分析机器人，使用本地小模型），但未被集成使用。同时 `agent:analyze-intent` IPC 链路只有主进程端 handler，子进程端（agent-bridge.ts）缺失对应实现，是一条断链。

## 目标

实现三级意图路由，根据用户输入自动选择最合适的 **前台 agent** 执行：

1. **L1 — LLM 意图分析**：调用大模型分析用户意图，输出 `{ scene, agent, complexity }`
2. **L2 — 向量 + 能力匹配**：LLM 不可用时降级，基于 keyword + capability 双维度评分匹配
3. **L3 — xuanji 兜底**：无合适 agent、极其复杂的任务、或符合 xuanji 能力范围时，默认路由到 xuanji

**重要边界**：IntentRouter **仅负责前台 agent 的路由选择**。子 agent（task/team）由父 agent 通过 `TaskOrchestrator` / `TeamTool` 内部调度，不经过 IntentRouter。

## 最终结果约束

无论走哪一级路由，最终的 `IntentRoute` 必须满足以下约束：

| 字段 | 约束 | L1 来源 | L2 来源 | L3 来源 |
|------|------|---------|---------|---------|
| `agentId` | 必须在 `AgentRegistry` 中**真实存在** | SceneClassifier 校验后返回，或 complex 任务强制 xuanji | `EmbeddingMatcher` 从 `agentRegistry.getEnabled()` 中匹配，天然合法 | 硬编码 `'xuanji'`，始终合法 |
| `scene` | 必须来自 `LayeredPromptBuilder.getAvailableScenes()`，可为空字符串（表示无场景），可逗号分隔多个 | SceneClassifier 经 `validateScene()` 过滤，编造的 scene 被丢弃 | 显式设为 `''`（关键词匹配无法推断场景） | 显式设为 `''` |
| `complexity` | `'simple'` 或 `'complex'` | SceneClassifier 返回，L1 阶段 `complex` 任务强制路由到 xuanji | 显式设为 `'simple'` | 显式设为 `'simple'` |

**反幻觉机制**：SceneClassifier 的分类 prompt 中注入的 `{{SCENE_LIST}}` 和 `{{AGENT_LIST}}` 由 `LayeredPromptBuilder.getAvailableScenes()` 和 `AgentRegistry.getAgentListForClassifier()` **动态生成**，不硬编码。即使 LLM 编造了不存在的 scene，也会在 `validateScene()` 中被过滤掉。编造的 agent 导致 `AgentRegistry.get()` 返回 null 时，降级到 L2。

---

## 路由决策流程

```
用户消息（始终路由到前台 agent，子 agent 不经过此流程）
  │
  ▼
IntentRouter.route(message, onProgress?)
  │  onProgress 回调 → IPC 'agent:intent-route:progress' → 渲染进程 RouteStage 展示
  │
  ├─ L1: LLM 意图分析 (SceneClassifier)
  │    ├─ 成功 + complexity === "complex"
  │    │    → 强制路由到 xuanji（多步骤需要协调能力）
  │    │    → { agentId: 'xuanji', scene: validatedScene, complexity: 'complex', method: 'llm' }
  │    ├─ 成功 + complexity !== "complex" + agent 存在于 Registry
  │    │    → { agentId: result.agent, scene: validatedScene, complexity: 'simple', method: 'llm' }
  │    ├─ 成功但 agent 不在 Registry（LLM 幻觉）
  │    │    → 降级到 L2
  │    └─ 调用失败 / 超时 / 解析错误 / 无有效结果
  │         → 降级到 L2
  │
  ├─ L2: 能力匹配 (EmbeddingMatcher)
  │    ├─ 最高分 >= 0.5 → 路由到该 agent
  │    │    → { agentId, scene: '', complexity: 'simple', method: 'keyword' }
  │    └─ 无匹配 / agent 不存在 → 降级到 L3
  │
  └─ L3: xuanji 兜底
       └─ { agentId: 'xuanji', scene: '', complexity: 'simple', method: 'default' }
```

---

## 关键设计决策

### 决策 1：LLM 意图分析走直接 API 调用，不走完整 AgentLoop

scene-classifier 配置：
- `maxIterations: 1` — 只需一轮
- `tools: []` — 无工具调用
- `streaming: false` — 不需要流式
- `temperature: 0.3` — 低温度保证输出稳定

这本质就是一次 LLM completion。直接通过 ProviderPool 发一次非流式请求即可，不需要启动完整的 AgentLoop。延迟控制在 1-2 秒内。

### 决策 2：模板变量在运行时动态注入

scene-classifier 的 systemPrompt 中有两个模板占位符：

- `{{SCENE_LIST}}` — 需要替换为所有可用场景列表
- `{{AGENT_LIST}}` — 需要替换为所有可用 agent 列表

这两个变量当前**未被替换**。需要在 SceneClassifier 初始化时动态注入：

```
{{AGENT_LIST}}
  → AgentRegistry.getAgentListForClassifier()
  → 输出格式：id / name / description / capabilities / tags
  → 过滤 system agent（不暴露给分类器自身）

{{SCENE_LIST}}
  → LayeredPromptBuilder.getAvailableScenes()
  → 输出格式：scene / name / description / keywords
```

### 决策 3：complex 任务强制走 xuanji

当 LLM 返回 `complexity: "complex"` 时，无论匹配到的 agent 是什么，都路由到 xuanji。原因：

- complex 任务需要多 agent 协调（task / agent_team 工具）
- complex 任务需要多轮 ReAct 规划（xuanji 有 `.inf` maxIterations）
- 只有 xuanji 具备任务分解和委派能力（`task` / `agent_team` 工具动态注册）

### 决策 4：L2 先用 keyword + capability 匹配

当前 `EmbeddingProvider` 接口存在但无实现。L2 阶段直接复用 `MatchAgentTool` 中已有的 keyword + capability 双维度评分逻辑（代码已验证可用），后续可接入本地 embedding 模型提升语义匹配准确率。

### 决策 5：Scene / Agent 列表动态注入，拒绝 LLM 幻觉

SceneClassifier 的 prompt 中 `{{SCENE_LIST}}` 和 `{{AGENT_LIST}}` **不硬编码**，而是在初始化时动态注入：

- **Scene 列表来源**：`LayeredPromptBuilder.getAvailableScenes()` → 从已注册的 L1 prompt 组件中提取所有 scene 值
- **Agent 列表来源**：`AgentRegistry.getAgentListForClassifier()` → 过滤 system agent 和 main agent，只暴露可选的专业 agent
- **注入时机**：`agent-bridge.ts` 创建 IntentRouter 前，先调用 `sceneClassifier.setSceneList(scenes)` 再 `initialize()`

**反幻觉校验**（`SceneClassifier.validateScene()`）：
1. LLM 返回的 scene 按逗号分割为多个值
2. 逐一检查是否在 `validScenes` 集合中
3. 编造的 scene 被丢弃，全非法时返回空字符串
4. LLM 返回的 agent 在 `IntentRouter` 中二次校验：`agentRegistry.get(agent)` 不存在则降级 L2

### 决策 6：IntentRouter 为全局单例，仅处理前台 agent

- IntentRouter 由 SessionFactory 创建 session 时初始化一次，全局单例
- **仅负责前台 agent 的路由选择**。子 agent（task/team）由父 agent 通过 `TaskOrchestrator` / `TeamTool` 内部调度，不经过 IntentRouter
- `IntentRouter.route()` 的返回结果传递给 `ChatSession.switchForegroundAgent()`，用于动态替换 AgentLoop 配置

### 决策 7：L2/L3 路由结果显式归一化

L1 路径通过 SceneClassifier 返回 scene 和 complexity。L2（关键词匹配）和 L3（默认兜底）无法推断场景信息，但为保持 `IntentRoute` 数据结构一致性，显式设：

- `scene: ''` — 表示无场景信息（下游 `LayeredPromptBuilder.build()` 对此走 `getDefaultComponents()` 只加载 L0+L3）
- `complexity: 'simple'` — 关键词匹配和默认路由均视为简单任务

这确保了 `RightPanel.tsx` 的意图分析面板在任何路由路径下都能正确展示三要素（agent 必有值，scene 可为空，complexity 必为 simple/complex）。

---

## 降级策略汇总

| 场景 | 触发条件 | 行为 |
|------|---------|------|
| LLM 调用失败 | 网络错误、超时、provider 不可用 | 降级到 L2 |
| LLM 返回无效 JSON | JSON.parse 失败 | 降级到 L2 |
| LLM 返回 complex | complexity === 'complex' | 强制路由到 xuanji |
| LLM 返回不存在的 agent | agentId 不在 AgentRegistry 中 | 降级到 L2 |
| 向量匹配无结果 | 所有 agent score < 0.5 | 降级到 L3 (xuanji) |
| AgentRegistry 为空 | 无可用 agent | 降级到 L3 (xuanji) |
| scene-classifier 配置缺失 | agent config 未找到 | 直接降级到 L2 |
| scene-classifier 超时 | 15s 超时 | 降级到 L2 |

---

## 新增/修改文件

### 新增文件

#### `src/core/routing/types.ts`

路由相关类型定义：

```typescript
interface IntentRoute {
  agentId: string;
  confidence: number;
  method: 'llm' | 'vector' | 'keyword' | 'default';
  scene?: string;
  complexity?: 'simple' | 'complex';
  reason?: string;
}

interface ClassifyResult {
  scene: string;
  agent: string;
  complexity: 'simple' | 'complex';
  confidence: number;
}

interface MatchResult {
  agentId: string;
  score: number;
  reason: string;
}
```

#### `src/core/routing/SceneClassifier.ts`

职责：调用 LLM 做意图分类。

```
class SceneClassifier
  依赖:
    - agentRegistry: AgentRegistry
    - globalConfig: AppConfig（用于创建 ProviderManager）

  方法:
    setSceneList(scenes: SceneInfo[]): void
      - [NEW] 从 LayeredPromptBuilder 注入动态场景列表
      - 更新 validScenes 集合和 sceneDescriptions 映射
      - 必须在 initialize() 之前调用

    initialize(): Promise<void>
      - 读取 scene-classifier agent config
      - 注入 {{AGENT_LIST}} / {{SCENE_LIST}} 生成最终 systemPrompt
      - 创建 LLM provider 实例

    classify(message: string): Promise<ClassifyResult | null>
      - 构建 messages: [system, user(message)]
      - 流式调用 LLM，15s 超时
      - 提取 JSON（3 级容错：直接解析 → ```json 代码块 → 正则匹配 { }）
      - validateScene() 过滤不存在的 scene（支持逗号分隔多值）
      - 校验 agent 是否在 AgentRegistry 中存在
      - 失败/超时/幻觉返回 null

    // 内部方法
    validateScene(rawScene: string | undefined): string
      - 逗号分割 → 逐一校验 ∈ validScenes
      - 过滤掉 LLM 编造的 scene，全非法时返回 ''
    buildSceneList(): string
      - 从 validScenes 动态生成 prompt 模板变量（非硬编码）
```

**LLM 调用细节：**

- 使用 scene-classifier 的 provider 配置（`local-llama` adapter + `qwen2.5-1.5b-q4`）
- 如果 local-llama 不可用，可降级为使用任一可用 provider（如 openai adapter + 轻量模型）
- maxTokens: 256，temperature: 0.3
- 超时: 15 秒
- 非流式请求

**JSON 解析容错：**

```
1. 尝试直接 JSON.parse
2. 失败则尝试提取 ```json ... ``` 代码块
3. 失败则尝试正则匹配 { ... }
4. 都失败返回 null
```

#### `src/core/routing/EmbeddingMatcher.ts`

职责：基于 keyword + capability 双维度评分，找到最佳 agent。

```
class EmbeddingMatcher
  依赖:
    - agentRegistry: AgentRegistry

  方法:
    match(message: string, topK: number = 3): Promise<MatchResult[]>
      - 获取所有启用的非 system 非 main agent（getTargetAgents）
      - 对每个 agent 计算:
        1. Capability 匹配分 (权重 0.5): 任务词与 capability 文本的双向重叠
        2. Keyword 匹配分 (权重 0.5): 任务词与 agent name/description 的匹配
      - 按总分排序，过滤 score >= 0.3（内部宽松阈值），返回 topK
      - IntentRouter 层二次过滤 score >= 0.5（路由级严格阈值）
```

评分逻辑完全复用 `MatchAgentTool.scoreAgents()` 中已验证的算法，但不依赖 `EmbeddingProvider`。

**双层阈值设计**：`EmbeddingMatcher` 内部 0.3（宽松，尽可能返回候选），`IntentRouter` 层 0.5（严格，只接受高置信度匹配）。这允许 `onProgress` 回调如实报告"有匹配但分数不够"的情况。

---

### 修改文件

#### `src/core/routing/IntentRouter.ts` — 重写

```typescript
export class IntentRouter {
  private sceneClassifier: SceneClassifier;
  private embeddingMatcher: EmbeddingMatcher;
  private agentRegistry: AgentRegistry;
  readonly defaultAgentId = 'xuanji';

  constructor(deps: {
    sceneClassifier: SceneClassifier;
    embeddingMatcher: EmbeddingMatcher;
    agentRegistry: AgentRegistry;
  }) { ... }

  async route(message: string, onProgress?: (progress: RouteProgress) => void): Promise<IntentRoute> {
    // L1: LLM 意图分析
    const l1Start = Date.now();
    onProgress?.({ level: 'L1', status: 'start', method: 'llm', durationMs: 0, success: false });
    try {
      const result = await this.sceneClassifier.classify(message);
      const l1Duration = Date.now() - l1Start;
      if (result) {
        // complex 任务强制走 xuanji（需要多 agent 协调能力）
        if (result.complexity === 'complex') {
          onProgress?.({ level: 'L1', status: 'done', method: 'llm', durationMs: l1Duration, success: true,
            agentId: this.defaultAgentId, scene: result.scene, complexity: 'complex', confidence: 1.0 });
          return { agentId: this.defaultAgentId, confidence: 1.0, method: 'llm',
            scene: result.scene, complexity: 'complex', reason: 'LLM判定为complex任务，需要xuanji协调能力' };
        }
        // 校验 agent 真实存在（反幻觉）
        if (this.agentRegistry.get(result.agent)) {
          onProgress?.({ level: 'L1', status: 'done', method: 'llm', durationMs: l1Duration, success: true,
            agentId: result.agent, scene: result.scene, complexity: result.complexity, confidence: result.confidence });
          return { agentId: result.agent, confidence: result.confidence, method: 'llm',
            scene: result.scene, complexity: result.complexity };
        }
        onProgress?.({ level: 'L1', status: 'done', method: 'llm', durationMs: l1Duration, success: false,
          agentId: result.agent, scene: result.scene, reason: `Agent "${result.agent}" 不存在` });
      } else {
        onProgress?.({ level: 'L1', status: 'done', method: 'llm', durationMs: l1Duration, success: false,
          reason: 'LLM 未返回有效结果' });
      }
    } catch (err) {
      onProgress?.({ level: 'L1', status: 'done', method: 'llm', durationMs: Date.now() - l1Start, success: false,
        reason: err instanceof Error ? err.message : 'LLM 调用异常' });
    }

    // L2: 能力匹配
    const l2Start = Date.now();
    onProgress?.({ level: 'L2', status: 'start', method: 'keyword', durationMs: 0, success: false });
    try {
      const matches = await this.embeddingMatcher.match(message);
      const l2Duration = Date.now() - l2Start;
      if (matches.length > 0 && matches[0].score >= 0.5) {
        // 防御性校验：agent 必须在 Registry 中存在
        if (this.agentRegistry.get(matches[0].agentId)) {
          onProgress?.({ level: 'L2', status: 'done', method: 'keyword', durationMs: l2Duration, success: true,
            agentId: matches[0].agentId, confidence: matches[0].score, matchCount: matches.length });
          return { agentId: matches[0].agentId, confidence: matches[0].score, method: 'keyword',
            scene: '', complexity: 'simple', reason: matches[0].reason };
        }
      }
      onProgress?.({ level: 'L2', status: 'done', method: 'keyword', durationMs: l2Duration, success: false,
        matchCount: matches.length, reason: matches.length > 0 ? '最高分低于阈值' : '无匹配结果' });
    } catch (err) {
      onProgress?.({ level: 'L2', status: 'done', method: 'keyword', durationMs: Date.now() - l2Start, success: false,
        reason: err instanceof Error ? err.message : '关键词匹配异常' });
    }

    // L3: xuanji 兜底（scene/complexity 显式归一化）
    onProgress?.({ level: 'L3', status: 'start', method: 'default', durationMs: 0, success: false });
    onProgress?.({ level: 'L3', status: 'done', method: 'default', durationMs: 0, success: true,
      agentId: this.defaultAgentId, confidence: 1.0, reason: '默认路由' });
    return { agentId: this.defaultAgentId, confidence: 1.0, method: 'default',
      scene: '', complexity: 'simple', reason: '默认路由' };
  }
}
```

#### `src/core/agent/AgentRegistry.ts` — 新增方法

```typescript
/** 生成用于 scene-classifier prompt 的 agent 列表 */
getAgentListForClassifier(): string {
  const agents = this.getEnabled()
    .filter(a => a.metadata?.category !== 'system')  // 排除 system agent
    .filter(a => !a.metadata?.isMainAgent);            // 排除 xuanji 自身

  return agents.map(a => {
    const caps = (a.capabilities || []).join(', ');
    const tags = (a.tags || []).join(', ');
    return [
      `Agent ID: ${a.id}`,
      `Name: ${a.name}`,
      `Description: ${a.description}`,
      caps ? `Capabilities: ${caps}` : '',
      tags ? `Tags: ${tags}` : '',
    ].filter(Boolean).join('\n');
  }).join('\n\n---\n\n');
}
```

#### `desktop/main/agent-bridge.ts` — 接入 IntentRouter

**改动 1：handleUserAction 使用单例 IntentRouter**

```typescript
// 模块级变量，SessionFactory 创建 session 时初始化
let intentRouter: IntentRouter | null = null;
let routedAgentId = 'xuanji';

// 暴露给 session init 后调用
function setIntentRouter(router: IntentRouter) {
  intentRouter = router;
}
```

修改 `handleUserAction`：
```typescript
async function handleUserAction(data: { type: string; message?: string }) {
  if (!session) return;

  if (data.type === 'SEND_MESSAGE' && data.message) {
    if (intentRouter) {
      const route = await intentRouter.route(data.message);
      routedAgentId = route.agentId;
      session.setCurrentAgent(route.agentId);
      channel.send('agent:intent-route', {
        agentId: route.agentId,
        confidence: route.confidence,
        method: route.method,
        scene: route.scene,
      });
    } else {
      // IntentRouter 未初始化时降级
      session.setCurrentAgent('xuanji');
    }
  }
  await session.userAction(data);
}
```

**改动 2：新增 analyze-intent handler**

```typescript
channel.handle('analyze-intent', async (prompt) => {
  if (!intentRouter) {
    return { success: false, error: 'IntentRouter 未初始化' };
  }
  try {
    const route = await intentRouter.route(prompt);
    return { success: true, route };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});
```

**改动 3：SessionFactory 创建 IntentRouter**

在 `desktop/main/agent-bridge.ts` 的 init handler 中，session 创建完成后：

```typescript
const agentRegistry = session.getAgentRegistry();
const promptRegistry = session.getPromptRegistry();
const providerPool = session.getProviderPool();

const sceneClassifier = new SceneClassifier({ providerPool, agentRegistry, promptRegistry });
await sceneClassifier.initialize();

const embeddingMatcher = new EmbeddingMatcher({ agentRegistry });

const router = new IntentRouter({ sceneClassifier, embeddingMatcher, agentRegistry });
setIntentRouter(router);
```

#### `src/core/chat/SessionFactory.ts` — 暴露依赖

SessionFactory 需要暴露 ProviderPool、AgentRegistry、PromptComponentRegistry 的 getter 方法，供 agent-bridge.ts 在 session 创建后获取依赖。

#### `desktop/renderer/services/EventAdapter.ts` — 处理 intent-route 事件

新增：

```typescript
messageBus.on('agent:intent-route', (data: {
  agentId: string;
  confidence: number;
  method: string;
  scene?: string;
}) => {
  useConversationStore.getState().setRoutingInfo({
    agentId: data.agentId,
    confidence: data.confidence,
    method: data.method,
    scene: data.scene,
  });
});
```

#### `desktop/renderer/stores/ConversationStore.ts` — 新增路由状态

```typescript
interface RoutingInfo {
  agentId: string;
  confidence: number;
  method: string;
  scene?: string;
}

// 在 state 中新增：
routingInfo: null as RoutingInfo | null,
setRoutingInfo: (info: RoutingInfo | null) => set({ routingInfo: info }),
```

---

## 验证方法

### 端到端测试用例

| 用户输入 | 预期路由 | 预期方法 |
|---------|---------|---------|
| "修复这个登录页面的 bug" | software-engineer | llm |
| "设计一个用户注册页面" | ui-designer | llm |
| "分析用户的核心需求" | product-manager | llm |
| "重构整个认证模块并添加完整测试" | xuanji (complex) | llm |
| "你好，今天天气怎么样" | xuanji (general) | llm |
| "分析比亚迪最近走势" | stock-analyst | llm |
| 任意消息（LLM 不可用时） | 最佳匹配 agent 或 xuanji | keyword |
| 任意消息（所有匹配失败时） | xuanji | default |

### 验证步骤

1. 启动应用，发送不同类型的消息，在 DevTools Console 查看 `agent:intent-route` 事件
2. 确认路由结果与预期一致
3. 断开 local-llama 或网络，验证降级到 L2 再降级到 L3
4. 检查渲染进程 ConversationStore 中 routingInfo 是否正确更新
5. 检查 `agent:analyze-intent` IPC 调用能否独立工作（通过 DevTools 直接调用 `window.electron.analyzeIntent('测试消息')`）

---

## 文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/core/routing/types.ts` | 新建 | 路由类型定义 |
| `src/core/routing/SceneClassifier.ts` | 新建 | LLM 意图分类服务 |
| `src/core/routing/EmbeddingMatcher.ts` | 新建 | keyword+capability 匹配服务 |
| `src/core/routing/IntentRouter.ts` | 重写 | 三级路由核心编排 |
| `src/core/agent/AgentRegistry.ts` | 修改 | 新增 `getAgentListForClassifier()` |
| `desktop/main/agent-bridge.ts` | 修改 | 接入 IntentRouter 单例 + analyze-intent handler |
| `src/core/chat/SessionFactory.ts` | 修改 | 暴露 ProviderPool/AgentRegistry getter |
| `desktop/renderer/services/EventAdapter.ts` | 修改 | 处理 `agent:intent-route` 事件 |
| `desktop/renderer/stores/ConversationStore.ts` | 修改 | 新增 routingInfo 状态 |
