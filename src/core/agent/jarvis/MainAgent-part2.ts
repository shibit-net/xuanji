7. planner - 方案设计（结构化、中温度、架构清晰）
8. refactorer - 代码重构（改进、中温度、保持功能）

执行策略选择：
- sequential（串行）：任务有依赖关系，前一个的输出是后一个的输入
- parallel（并行）：任务独立，可同时执行（如多文件分析）
- hierarchical（层级）：复杂任务，需要planner规划后，workers执行
- debate（辩论）：需要多角度评估（如架构选型、技术方案）
- pipeline（流水线）：数据流式处理（如代码生成→审查→测试）

异常处理：
- 子Agent执行失败：重试1次，仍失败则提示用户
- 任务拆分失败：降级为单一任务，直接调用通用Agent
- 超时：提示用户任务复杂度高，建议拆分或延长超时`;

/**
 * MainAgent - 主调度Agent
 */
export class MainAgent {
  private provider: ILLMProvider;
  private registry: IToolRegistry;
  private config: AgentConfig;
  private hookRegistry: HookRegistry | null;
  private memoryStore: IMemoryStore | null;
  private teamManager: TeamManager;
  private intentParser: IntentParser;
  private taskPlanner: TaskPlanner;
  private resultAggregator: ResultAggregator;
  private promptStore: PromptStore;

  constructor(
    provider: ILLMProvider,
    registry: IToolRegistry,
    config: AgentConfig,
    teamManager: TeamManager,
    hookRegistry?: HookRegistry | null,
    memoryStore?: IMemoryStore | null,
  ) {
    this.provider = provider;
    this.registry = registry;
    this.config = {
      ...config,
      systemPrompt: MAIN_AGENT_SYSTEM_PROMPT,  // 固定Prompt
    };
    this.hookRegistry = hookRegistry ?? null;
    this.memoryStore = memoryStore ?? null;
    this.teamManager = teamManager;

    // 初始化辅助模块
    this.intentParser = new IntentParser(provider);
    this.taskPlanner = new TaskPlanner(provider);
    this.resultAggregator = new ResultAggregator(provider);
    this.promptStore = new PromptStore();
  }

  /**
   * 执行用户请求
   *
   * 流程：
   * 1. 需求解析（轻量LLM + 规则引擎）
   * 2. 任务拆分（如果是复杂任务）
   * 3. 调度子Agent执行（使用TeamManager）
   * 4. 结果汇总（统一口吻）
   */
  async execute(userInput: string, signal?: AbortSignal): Promise<string> {
    log.info(`[MainAgent] Received user input: ${userInput.substring(0, 100)}...`);

    try {
      // 1. 需求解析
      const intent = await this.intentParser.parse(userInput);
      log.info(`[MainAgent] Parsed intent: type=${intent.type}, intentType=${intent.intentType}, confidence=${intent.confidence}`);

      // 2. 任务规划
      const plan = await this.taskPlanner.plan(intent, userInput);
      log.info(`[MainAgent] Task plan: strategy=${plan.strategy}, tasks=${plan.tasks.length}`);

      // 3. 执行任务
      let result: TeamExecutionResult;

      if (plan.strategy === 'single') {
        // 简单任务：直接调用单个子Agent
        result = await this.executeSingleTask(plan.tasks[0], userInput, signal);
      } else {
        // 复杂任务：使用TeamManager协调执行
        result = await this.executeTeamTasks(plan, userInput, signal);
      }

      // 4. 结果汇总
      const finalOutput = await this.resultAggregator.aggregate(result, userInput);
      log.info(`[MainAgent] Task completed successfully`);

      return finalOutput;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      log.error(`[MainAgent] Execution failed: ${errMsg}`);
      return `任务执行失败：${errMsg}`;
    }
  }

  /**
   * 执行单个任务
   */
  private async executeSingleTask(
    task: import('./TaskPlanner').SubTask,
    userInput: string,
    signal?: AbortSignal
  ): Promise<TeamExecutionResult> {
    // 创建单成员团队
    const teamConfig: TeamConfig = {
      name: 'single-task',
      strategy: 'sequential',
      members: [{
        id: task.id,
        agentId: task.agentId,
        systemPrompt: this.promptStore.getPromptForScene(task.scene),
        capabilities: [task.scene],
      }],
    };

    await this.teamManager.createTeam(teamConfig);
    return this.teamManager.execute(userInput, signal);
  }

  /**
   * 执行团队任务（复用xuanji的TeamManager）
   */
  private async executeTeamTasks(
    plan: TaskPlan,
    userInput: string,
    signal?: AbortSignal
  ): Promise<TeamExecutionResult> {
    const teamConfig: TeamConfig = {
      name: 'complex-task',
      strategy: plan.strategy as any,
      members: plan.tasks.map(task => ({
        id: task.id,
        agentId: task.agentId,
        systemPrompt: task.systemPrompt || this.promptStore.getPromptForScene(task.scene),
        capabilities: [task.scene],
        priority: task.priority,
      })),
    };

    await this.teamManager.createTeam(teamConfig);
    return this.teamManager.execute(userInput, signal);
  }
}
