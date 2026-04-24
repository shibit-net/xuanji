/**
 * WorkspaceStore - 管理 MainAgent 执行流程的可视化状态
 */

import { messageBus } from '../utils/MessageBus';

export interface WorkspaceEvent {
  eventType: string;
  timestamp: number;
  data: any;
}

export interface WorkspacePhase {
  name: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  startTime?: number;
  endTime?: number;
  data?: any;
}

export interface IntentAnalysisResult {
  scene?: string;
  agent?: string;
  complexity?: string;
  model?: string;
}

export interface PromptBuildResult {
  scene?: string;
  complexity?: string;
  components?: string[];
  estimatedTokens?: number;
}

export class WorkspaceStore {
  private events: WorkspaceEvent[] = [];
  private phases: Map<string, WorkspacePhase> = new Map();
  private currentSessionId: string | null = null;
  private listeners: Set<() => void> = new Set();
  private listenersSetup = false;
  private intentAnalysisResult: IntentAnalysisResult | null = null;
  private promptBuildResult: PromptBuildResult | null = null;

  constructor() {
    this.initPhases();
    // 延迟设置事件监听器，确保 messageBus 已经可用
    if (typeof window !== 'undefined') {
      // 使用 setTimeout 确保在下一个事件循环中执行
      setTimeout(() => this.setupEventListeners(), 0);
    }
  }

  /**
   * 初始化阶段
   */
  private initPhases() {
    this.phases.set('intent-analysis', {
      name: '意图分析',
      status: 'pending',
    });
    this.phases.set('task-planning', {
      name: '任务规划',
      status: 'pending',
    });
    this.phases.set('task-execution', {
      name: '任务执行',
      status: 'pending',
    });
    this.phases.set('result-aggregation', {
      name: '结果汇总',
      status: 'pending',
    });
  }

  /**
   * 设置事件监听器
   */
  private setupEventListeners() {
    // 防止重复设置
    if (this.listenersSetup) {
      console.log('[WorkspaceStore] Event listeners already set up, skipping');
      return;
    }

    console.log('[WorkspaceStore] Setting up event listeners via messageBus');
    this.listenersSetup = true;

    // 意图分析
    messageBus.on('workspace:intent-analysis-start', (data: any) => {
      console.log('[WorkspaceStore] IntentAnalysisStart received:', data);
      this.handleEvent({
        eventType: 'IntentAnalysisStart',
        timestamp: data.timestamp || Date.now(),
        data,
      });
      this.updatePhase('intent-analysis', 'running', data.timestamp || Date.now());
    });

    messageBus.on('workspace:intent-analysis-end', (data: any) => {
      this.handleEvent({
        eventType: 'IntentAnalysisEnd',
        timestamp: data.timestamp || Date.now(),
        data,
      });
      this.updatePhase('intent-analysis', 'completed', data.timestamp || Date.now(), data);
    });

    // ModelClassifier 结束（意图分析结果）
    messageBus.on('workspace:model-classifier-end', (data: any) => {
      this.intentAnalysisResult = {
        scene: data.scene,
        agent: data.agent,
        complexity: data.complexity,
        model: data.model,
      };
      this.notifyListeners();
    });

    // Prompt 构建事件
    messageBus.on('prompt:build-event', (data: any) => {
      if (data.type === 'intent:analyzed') {
        // 更新意图分析结果
        this.intentAnalysisResult = {
          scene: data.data?.scene,
          agent: data.data?.agent,
          complexity: data.data?.complexity,
          model: this.intentAnalysisResult?.model, // 保留之前的 model 信息
        };
        console.log('[WorkspaceStore] Intent analyzed:', this.intentAnalysisResult);
        this.notifyListeners();
      } else if (data.type === 'build:complete') {
        this.promptBuildResult = {
          scene: data.data?.scene,
          complexity: data.data?.complexity,
          components: data.data?.layers?.flatMap((layer: any) =>
            layer.components?.map((c: any) => c.name) || []
          ),
          estimatedTokens: data.data?.estimatedTokens,
        };
        this.notifyListeners();
      }
    });

    // 任务规划
    messageBus.on('workspace:task-planning-start', (data: any) => {
      this.handleEvent({
        eventType: 'TaskPlanningStart',
        timestamp: data.timestamp || Date.now(),
        data,
      });
      this.updatePhase('task-planning', 'running', data.timestamp || Date.now());
    });

    messageBus.on('workspace:task-planning-end', (data: any) => {
      this.handleEvent({
        eventType: 'TaskPlanningEnd',
        timestamp: data.timestamp || Date.now(),
        data,
      });
      this.updatePhase('task-planning', 'completed', data.timestamp || Date.now());
    });

    // 任务执行
    messageBus.on('workspace:task-execution-start', (data: any) => {
      this.handleEvent({
        eventType: 'TaskExecutionStart',
        timestamp: data.timestamp || Date.now(),
        data,
      });
      this.updatePhase('task-execution', 'running', data.timestamp || Date.now());
    });

    messageBus.on('workspace:task-execution-end', (data: any) => {
      this.handleEvent({
        eventType: 'TaskExecutionEnd',
        timestamp: data.timestamp || Date.now(),
        data,
      });
      this.updatePhase('task-execution', 'completed', data.timestamp || Date.now());
    });

    // 结果聚合
    messageBus.on('workspace:result-aggregation-start', (data: any) => {
      this.handleEvent({
        eventType: 'ResultAggregationStart',
        timestamp: data.timestamp || Date.now(),
        data,
      });
      this.updatePhase('result-aggregation', 'running', data.timestamp || Date.now());
    });

    messageBus.on('workspace:result-aggregation-end', (data: any) => {
      this.handleEvent({
        eventType: 'ResultAggregationEnd',
        timestamp: data.timestamp || Date.now(),
        data,
      });
      this.updatePhase('result-aggregation', 'completed', data.timestamp || Date.now());
    });
  }

  /**
   * 处理事件
   */
  private handleEvent(event: WorkspaceEvent) {
        eventType: 'ResultAggregationEnd',
        timestamp: data.timestamp,
        data,
      });
      this.updatePhase('result-aggregation', 'completed', data.timestamp, data);
    });
  }

  /**
   * 处理事件
   */
  private handleEvent(event: WorkspaceEvent) {
    this.events.push(event);

    // 更新 sessionId
    if (event.data.sessionId) {
      this.currentSessionId = event.data.sessionId;
    }

    // 通知监听器
    this.notifyListeners();
  }

  /**
   * 更新阶段状态
   */
  private updatePhase(
    phaseKey: string,
    status: WorkspacePhase['status'],
    timestamp: number,
    data?: any
  ) {
    console.log(`[WorkspaceStore] updatePhase: ${phaseKey} -> ${status}`, { timestamp, data });
    const phase = this.phases.get(phaseKey);
    if (!phase) return;

    phase.status = status;

    if (status === 'running') {
      phase.startTime = timestamp;
    } else if (status === 'completed' || status === 'error') {
      phase.endTime = timestamp;
      phase.data = data;
    }

    this.notifyListeners();
  }

  /**
   * 通知监听器
   */
  private notifyListeners() {
    this.listeners.forEach(listener => listener());
  }

  /**
   * 订阅状态变化
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 获取所有事件
   */
  getEvents(): WorkspaceEvent[] {
    return [...this.events];
  }

  /**
   * 获取所有阶段
   */
  getPhases(): WorkspacePhase[] {
    return Array.from(this.phases.values());
  }

  /**
   * 获取当前阶段
   */
  getCurrentPhase(): WorkspacePhase | null {
    for (const phase of this.phases.values()) {
      if (phase.status === 'running') {
        return phase;
      }
    }
    return null;
  }

  /**
   * 获取当前 sessionId
   */
  getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }

  /**
   * 重置状态（新会话开始时）
   */
  reset() {
    this.events = [];
    this.currentSessionId = null;
    this.intentAnalysisResult = null;
    this.promptBuildResult = null;
    this.initPhases();
    this.notifyListeners();
  }

  /**
   * 获取意图分析结果
   */
  getIntentAnalysisResult(): IntentAnalysisResult | null {
    return this.intentAnalysisResult;
  }

  /**
   * 获取 Prompt 构建结果
   */
  getPromptBuildResult(): PromptBuildResult | null {
    return this.promptBuildResult;
  }

  /**
   * 获取阶段详情
   */
  getPhaseDetails(phaseKey: string): WorkspacePhase | undefined {
    return this.phases.get(phaseKey);
  }

  /**
   * 获取时间线数据
   */
  getTimeline(): Array<{ time: number; event: string; data: any }> {
    return this.events.map(e => ({
      time: e.timestamp,
      event: e.eventType,
      data: e.data,
    }));
  }
}

// 单例
export const workspaceStore = new WorkspaceStore();
