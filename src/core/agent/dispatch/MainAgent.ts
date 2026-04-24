/**
 * MainAgent - 主调度 Agent（基于 AgentLoop）
 *
 * 通过 system prompt 描述调度职责，
 * 使用 agent_team / task 工具委派具体工作给子 Agent。
 * 支持多轮对话、流式输出、工具调用。
 */

import type { AgentConfig, ILLMProvider, IToolRegistry } from '@/core/types';
import type { HookRegistry } from '@/hooks/HookRegistry';
import type { AgentCallbacks } from '@/core/agent/AgentLoop';
import type { LayeredPromptBuilder } from '@/core/prompt/LayeredPromptBuilder';
import type { AgentRegistry } from '@/core/agent/AgentRegistry';
import { AgentLoop } from '@/core/agent/AgentLoop';
import { IntentClassifier } from './IntentClassifier';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'MainAgent' });

const MAIN_AGENT_SYSTEM_PROMPT = `你是 Xuanji，一个通用的智能协作系统。

## 核心能力

你可以协调多个专业 Agent 完成各种领域的复杂任务（编程、金融、法律、生活等）。

## 工作流程

### 1. 接收意图分析结果

系统会自动分析用户输入，并在消息末尾提供 [意图分析结果]，包含：
- **场景 (scene)**：任务所属的场景类型（如 explore、write_code、debug 等）
- **推荐 Agent (agent)**：最适合处理该任务的 Agent
- **任务复杂度 (complexity)**：simple（简单）或 complex（复杂）

### 2. 根据意图分析结果决策

#### 情况 A：简单任务 + 推荐了专业 Agent

**特征**：complexity = simple，agent ≠ general

**处理方式**：立即委托，不要犹豫

你会看到类似这样的指令：
\`\`\`
[决策指令] 这是一个简单的专业任务，你必须立即委托给 coder agent，不要自己处理。

立即使用 task 工具：
task({
  description: "分析 package.json 代码",
  subagent_type: "coder",
  scene: "explore"
})
\`\`\`

**你应该做的**：
1. 不要分析、不要解释、不要自己回答
2. 直接复制上面的 task 工具调用
3. 立即执行

**错误示例**：
❌ "让我先看看 package.json 的内容..."（不要自己处理）
❌ "我来分析一下这个文件..."（不要自己处理）
❌ "这个任务需要..."（不要分析，直接委托）

**正确示例**：
✅ 直接调用 task 工具（无需任何解释）

#### 情况 B：简单任务 + 通用处理

**特征**：complexity = simple，agent = general

**处理方式**：直接回答

这是通用问题（如问候、闲聊、简单问答），你应该直接用文字回答，不要使用任何工具。

#### 情况 C：复杂任务

**特征**：complexity = complex

**处理方式**：分析、规划、协作

1. 分析任务需要哪些能力
2. 使用 match_agent 找到合适的 Agent
3. 规划协作方式（sequential、parallel、hierarchical 等）
4. 使用 agent_team 或多次 task 执行

### 3. 理解任务（仅复杂任务需要）
- 分析用户的目标和需求
- 识别任务所属的领域
- 判断需要哪些专业能力

### 4. 决策处理方式（传统流程，仅在没有意图分析时使用）

**直接回答**：简单问题、解释说明、闲聊
- 直接用文字回答，不需要调用工具

**快速委派**：单一明确的任务
- 使用 \`match_agent\` 找到最合适的 Agent
- 使用 \`task\` 工具委派执行

**智能规划**：复杂任务需要多步骤或多 Agent 协作
- 分析任务需要哪些能力
- 发现可用的 Agent
- 规划协作方式
- 使用 \`agent_team\` 或多次 \`task\` 执行

### 5. 发现可用的 Agent 和 Scene

**重要**：不要假设有哪些 Agent 和 Scene，而是动态查询

- **list_agents**：列出所有可用的 Agent 及其能力
- **list_scenes**：列出所有可用的 Scene 及其用途
- **match_agent**：根据任务描述推荐最合适的 Agent

### 6. 分析能力需求（复杂任务）

当任务复杂时，思考需要哪些能力：
- 将任务分解为具体步骤
- 识别每个步骤需要的能力
- 不要假设需要哪些能力，而是根据任务本身分析

**示例**：
- 编程任务可能需要：代码探索、方案规划、代码实现、测试编写
- 金融任务可能需要：数据收集、财务分析、风险评估、报告生成
- 法律任务可能需要：案例检索、法律分析、文书起草、合规审查
- 生活任务可能需要：信息搜索、选项对比、计划制定、执行跟踪

### 7. 匹配 Agent

对每个需要的能力：
1. 使用 \`match_agent\` 查找最合适的 Agent
2. 如果 score >= 0.5，使用推荐的 Agent
3. 如果 score < 0.5，说明没有合适的 Agent

### 8. 补充缺失能力

如果某个能力没有合适的 Agent：
- 使用 \`general-purpose\` 作为基础
- 通过 \`systemPrompt\` 定义临时 Agent 的行为
- 为临时 Agent 分配合适的 scene

**示例**：
\`\`\`
{
  id: "temp-analyst",
  agentId: "general-purpose",
  scene: "analyze",
  systemPrompt: "你是数据分析师。职责：1. 分析数据趋势 2. 生成可视化图表 3. 提供洞察建议"
}
\`\`\`

### 9. 规划协作方式

根据任务特点选择策略：
- **sequential**：线性流程（步骤 A → B → C）
- **parallel**：并行执行（多个独立任务同时进行）
- **hierarchical**：有领导者协调其他成员
- **debate**：需要讨论和评估不同观点
- **pipeline**：数据流水线（前一个的输出是下一个的输入）

### 8. 分配 Scene

**重要**：不要假设有哪些 Scene，先用 \`list_scenes\` 查询

为每个 Agent 分配合适的 scene：
1. 使用 \`list_scenes\` 查看所有可用的场景
2. 根据 Agent 的职责和任务需求，选择最匹配的 scene
3. 参考 scene 的 description、keywords 和 collaborationHint
4. Scene 决定了 Agent 会加载哪些场景化的 prompt 指导

**示例**：
- 代码编写任务 → 选择 "write-code" scene
- 代码调试任务 → 选择 "debug" scene
- 数据分析任务 → 选择 "analyze" scene
- 文档编写任务 → 选择 "write-doc" scene

## 原则

1. **不要假设**：不要假设有哪些 Agent 和 Scene，先用 \`list_agents\` 和 \`list_scenes\` 查询
2. **动态适应**：根据实际可用的 Agent 和 Scene 调整计划
3. **灵活补充**：缺少能力时，动态创建临时 Agent
4. **领域无关**：同样的流程适用于任何领域
5. **保持简洁**：简单问题直接回答，不要过度调用工具
6. **统一回复**：汇总子 Agent 的结果，用统一的口吻回复用户

## 工具和能力层次

- **Tools**：原子操作（read, write, bash, grep等）
- **Scenes**：场景指导（提供思维框架和最佳实践）
- **Agents**：角色定义（拥有特定能力的执行者）
- **Skills**：能力单元（未来支持，可复用的任务模板和工作流程）`;

export interface MainAgentOptions {
  provider: ILLMProvider;
  registry: IToolRegistry;
  config: AgentConfig;
  agentRegistry: AgentRegistry;
  hookRegistry?: HookRegistry;
  promptBuilder?: LayeredPromptBuilder;
}

export class MainAgent {
  private agentLoop: AgentLoop;
  private intentClassifier: IntentClassifier;
  private classifierInitialized: boolean = false;
  private hookRegistry?: HookRegistry;
  private promptBuilder?: LayeredPromptBuilder;

  constructor(options: MainAgentOptions) {
    // 主agent的systemPrompt会在run时通过LayeredPromptBuilder动态构建
    // 这里只设置一个占位符，避免AgentLoop初始化时报错
    const config: AgentConfig = {
      ...options.config,
      systemPrompt: MAIN_AGENT_SYSTEM_PROMPT, // 占位符，会被动态prompt覆盖
    };

    this.agentLoop = new AgentLoop(
      options.provider,
      options.registry,
      config,
    );

    if (options.hookRegistry) {
      this.hookRegistry = options.hookRegistry;
      this.agentLoop.setHookRegistry(options.hookRegistry);
    }

    if (options.promptBuilder) {
      this.promptBuilder = options.promptBuilder;
    }

    // 创建 IntentClassifier 实例（封装3层降级策略）
    this.intentClassifier = new IntentClassifier({
      agentRegistry: options.agentRegistry,
      intentAnalyzer: this.promptBuilder?.['intentAnalyzer'],
      hookRegistry: this.hookRegistry,
    });

    // 记录 LLM 决策：直接回答 vs 工具调用
    let _textReceived = false;
    let _toolsCalled: string[] = [];
    this.agentLoop.on({
      onText: () => { _textReceived = true; },
      onToolStart: (id, name) => { _toolsCalled.push(name); },
      onEnd: (state) => {
        if (_toolsCalled.length > 0) {
          log.info(`[MainAgent] 决策=工具调用 tools=[${_toolsCalled.join(', ')}] iterations=${state.currentIteration}`);
        } else if (_textReceived) {
          log.info(`[MainAgent] 决策=直接回答 iterations=${state.currentIteration}`);
        }
        _textReceived = false;
        _toolsCalled = [];
      },
    });

    log.info('MainAgent initialized (prompt will be built dynamically per request)');
  }

  /**
   * 从 ModelClassifier 的 scene 推断 prompt complexity
   * ModelClassifier 输出的 complexity 用于决策路径（simple/complex）
   * 这里将其映射到 IntentAnalyzer 的 complexity（simple/standard/complex）用于 prompt 构建
   */
  private mapToPromptComplexity(complexity: 'simple' | 'complex'): import('@/core/prompt/types').IntentComplexity {
    // simple → simple
    if (complexity === 'simple') return 'simple';
    // complex → complex
    if (complexity === 'complex') return 'complex';
    // 默认 standard
    return 'standard';
  }

  on(callbacks: AgentCallbacks): void {
    this.agentLoop.on(callbacks);
  }

  async run(userMessage: string): Promise<void> {
    log.info(`[MainAgent] run start: "${userMessage.substring(0, 100)}"`);
    const start = Date.now();

    // 一次意图分析，结果分两路用：
    //   1. scene + complexity → 控制 prompt 组装（选哪些组件）
    //   2. agent → 注入 hint 辅助 LLM 决策
    let scene: string | undefined;
    let complexity: import('@/core/prompt/types').IntentComplexity | undefined;
    let classification: import('./IntentClassifier').ClassificationResult | null = null;

    // 首次运行时懒加载 IntentClassifier（失败不影响主流程）
    log.info(`[MainAgent] classifierInitialized=${this.classifierInitialized}`);
    if (!this.classifierInitialized) {
      this.classifierInitialized = true;
      log.info('[MainAgent] Initializing IntentClassifier for the first time...');
      await this.intentClassifier.init().then(() => {
        if (this.intentClassifier.isAvailable()) {
          log.info(`[MainAgent] IntentClassifier ready: ${this.intentClassifier.getCurrentModel()}`);
        } else {
          log.info('[MainAgent] IntentClassifier not available (model not loaded)');
        }
      }).catch((err) => {
        log.warn('[MainAgent] IntentClassifier init failed, will use default:', err);
      });
    } else {
      // 已初始化，但仍然调用 init() 来检测配置变化（不会重复初始化）
      log.info('[MainAgent] IntentClassifier already initialized, checking for config changes...');
      await this.intentClassifier.init().catch((err) => {
        log.warn('[MainAgent] IntentClassifier config check failed:', err);
      });
      log.info('[MainAgent] Config check completed');
    }

    // 使用 IntentClassifier（封装3层降级策略）
    try {
      const classifyStart = Date.now();
      classification = await this.intentClassifier.classify(userMessage);
      const classifyMs = Date.now() - classifyStart;

      log.info(`[MainAgent] 意图分类: scene=${classification.scene} agent=${classification.agent} complexity=${classification.complexity} (${classifyMs}ms)`);
      scene = classification.scene;
      complexity = this.mapToPromptComplexity(classification.complexity);
    } catch (err) {
      log.warn('[MainAgent] 意图分类失败，使用默认配置:', err);
      // 使用默认配置
      scene = 'general';
      complexity = 'simple';
    }

    // 构建 system prompt，传入已分析的 scene + complexity + agent
    if (this.promptBuilder) {
      try {
        const buildResult = await this.promptBuilder.build({
          userMessage,
          ...(scene && { scene }),
          ...(complexity && { complexity }),
          ...(classification?.agent && { agent: classification.agent }),
        });

        // 组合prompt：L0(全局) + 主agent自身的prompt
        const messageManager = this.agentLoop.getMessageManager();
        const finalPrompt = buildResult.prompt + '\n\n---\n# 主Agent职责\n' + MAIN_AGENT_SYSTEM_PROMPT;
        (messageManager as any).systemPrompt = finalPrompt;

        log.info(`[MainAgent] prompt built: scene=${buildResult.scene} complexity=${buildResult.complexity} components=${buildResult.components.length} ~${buildResult.estimatedTokens} tokens`);

        // 🔍 调试日志：打印加载的组件列表和是否包含 l2-team-coordination
        const componentIds = buildResult.components.map((c: any) => c.id).join(', ');
        const hasTeamCoordination = buildResult.components.some((c: any) => c.id === 'l2-team-coordination');
        log.debug(`[MainAgent] 📋 Loaded components: [${componentIds}]`);
        log.debug(`[MainAgent] 🔍 Contains l2-team-coordination: ${hasTeamCoordination}`);

        // 🔍 调试日志：打印完整的 system prompt（仅在 debug 模式下）
        if (process.env.DEBUG_PROMPT === 'true') {
          log.debug(`[MainAgent] 📝 Full system prompt:\n${'='.repeat(80)}\n${finalPrompt}\n${'='.repeat(80)}`);
        }
      } catch (err) {
        log.warn('[MainAgent] Failed to build system prompt, using default:', err);
      }
    }

    // 注入决策提示（根据 complexity 和 scene）
    if (classification) {
      let hint = `\n\n[意图分析结果]\n- 场景: ${classification.scene}\n- 推荐Agent: ${classification.agent}\n- 任务复杂度: ${classification.complexity}`;

      // 如果是复杂任务，加载 scene 的 collaborationHint
      if (classification.complexity === 'complex' && this.promptBuilder) {
        try {
          const sceneComponent = await this.promptBuilder.getSceneComponent(classification.scene);
          if (sceneComponent?.collaborationHint) {
            hint += `\n\n[协作建议]\n${sceneComponent.collaborationHint}`;
          }
        } catch (err) {
          log.warn('[MainAgent] Failed to load collaborationHint:', err);
        }
      }

      // 根据 complexity 添加决策指导
      if (classification.complexity === 'simple') {
        if (classification.agent === 'general') {
          // general 表示主 agent 自己处理，不需要委派
          hint += `\n\n[决策指令] 这是一个通用问题，你应该直接回复，不要使用任何工具。`;
        } else {
          // 需要委派给专业 agent
          hint += `\n\n[决策指令] 这是一个简单的专业任务，你必须立即委托给 ${classification.agent} agent，不要自己处理。`;
          hint += `\n\n立即使用 task 工具：`;
          hint += `\n\`\`\``;
          hint += `\ntask({`;
          hint += `\n  description: "${userMessage}",`;
          hint += `\n  subagent_type: "${classification.agent}",`;
          hint += `\n  scene: "${classification.scene}"`;
          hint += `\n})`;
          hint += `\n\`\`\``;
          hint += `\n\n不要分析、不要解释、不要自己回答，直接调用上面的 task 工具。`;
        }
      } else {
        hint += `\n\n[决策建议] 这是一个复杂任务，建议先分析任务结构，可能需要多个 agent 协作完成。参考上面的协作建议。`;
        hint += `\n\n[重要] 使用 agent_team 时，为每个成员指定合适的 scene：`;
        hint += `\n- 探索代码的成员：scene: "explore"`;
        hint += `\n- 规划方案的成员：scene: "plan"`;
        hint += `\n- 编写代码的成员：scene: "write_code" 或 "refactor" 或 "debug"`;
        hint += `\n- 编写测试的成员：scene: "test"`;
        hint += `\n- 代码审查的成员：scene: "review"`;
        hint += `\n\n示例：`;
        hint += `\n  agent_team({`;
        hint += `\n    members: [`;
        hint += `\n      { id: "m1", agentId: "explore", scene: "explore", ... },`;
        hint += `\n      { id: "m2", agentId: "coder", scene: "refactor", ... },`;
        hint += `\n      { id: "m3", agentId: "test-writer", scene: "test", ... }`;
        hint += `\n    ]`;
        hint += `\n  })`;
      }

      this.agentLoop.getMessageManager().setSystemPromptSuffix(hint, 'intent-hint');
    }

    try {
      await this.agentLoop.run(userMessage);
      log.info(`[MainAgent] run complete in ${Date.now() - start}ms`);
    } catch (err) {
      log.error(`[MainAgent] run failed after ${Date.now() - start}ms:`, err);
      throw err;
    }
  }

  stop(): void {
    this.agentLoop.stop();
  }

  interrupt(message: string): void {
    this.agentLoop.interrupt(message);
  }

  reset(): void {
    this.agentLoop.reset();
  }

  getAgentLoop(): AgentLoop {
    return this.agentLoop;
  }

  getState() {
    return this.agentLoop.getState();
  }
}
