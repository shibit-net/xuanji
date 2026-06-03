/**
 * PromptComposer — Prompt 动态组合模块
 *
 * 职责：根据 scene + complexity + agentId 动态组合分层 system prompt。
 * 最终组成 = Agent.systemPrompt + L0 + L1 + L2 + L3(项目 Prompt)
 *
 * 组件优先级：项目级 > 用户级 > 应用级
 */

import { logger } from '@/infrastructure/logger';
import type { PromptComponent, IntentAnalysis, PromptBuildContext, SceneType } from '@/infrastructure/prompt/types';

const log = logger.child({ module: 'PromptComposer' });

export interface ComposedPrompt {
  systemPrompt: string;
  components: string[];
  estimatedTokens: number;
  scene: string;
  complexity: string;
}

export interface ComposeContext {
  userMessage: string;
  scene: string;
  complexity: 'simple' | 'standard' | 'complex';
  agent: string;
  intentHint?: string;
}

export interface SubAgentComposeContext {
  agentId: string;
  scene: string;
  taskDescription: string;
  depth: number;
}

export interface StepComposeContext {
  stepId: string;
  stepName: string;
  taskDescription: string;
}

export class PromptComposer {
  private components = new Map<string, PromptComponent>();
  private l0Components: PromptComponent[] = [];
  private l1Components: PromptComponent[] = [];
  private l2Components: PromptComponent[] = [];
  private l3Components: PromptComponent[] = [];

  constructor() {}

  registerComponent(component: PromptComponent): void {
    this.components.set(component.id, component);
    switch (component.layer) {
      case 'L0': this.l0Components.push(component); break;
      case 'L1': this.l1Components.push(component); break;
      case 'L2': this.l2Components.push(component); break;
      case 'L3': this.l3Components.push(component); break;
    }
    // 按优先级排序
    const sort = (a: PromptComponent, b: PromptComponent) => b.priority - a.priority;
    this.l0Components.sort(sort);
    this.l1Components.sort(sort);
    this.l2Components.sort(sort);
    this.l3Components.sort(sort);
  }

  async composeForMainAgent(ctx: ComposeContext): Promise<ComposedPrompt> {
    const loaded: string[] = [];
    const parts: string[] = [];

    // L0：基础调度规则（始终加载）
    for (const c of this.l0Components) {
      parts.push(await Promise.resolve(c.render({})));
      loaded.push(c.id);
    }

    // L1：按 scene 匹配（standard+ 加载）
    if (ctx.complexity !== 'simple') {
      for (const c of this.l1Components) {
        if (!c.scenes || c.scenes.includes(ctx.scene)) {
          parts.push(await c.render({}));
          loaded.push(c.id);
        }
      }
    }

    // L2：团队协作（仅 complex 加载）
    if (ctx.complexity === 'complex') {
      for (const c of this.l2Components) {
        parts.push(await c.render({}));
        loaded.push(c.id);
      }
    }

    // L3：项目 Prompt（始终加载）
    for (const c of this.l3Components) {
      parts.push(await c.render({}));
      loaded.push(c.id);
    }

    const prompt = parts.join('\n\n');
    return {
      systemPrompt: prompt,
      components: loaded,
      estimatedTokens: this.estimateTokens(prompt),
      scene: ctx.scene,
      complexity: ctx.complexity,
    };
  }

  async composeForSubAgent(ctx: SubAgentComposeContext): Promise<ComposedPrompt> {
    // 子 Agent 组合：L0(排除main-agent) + L1(场景匹配) + L3
    const loaded: string[] = [];
    const parts: string[] = [];

    for (const c of this.l0Components) {
      // 主 agent 独有的调度规则对子 agent 没有意义
      if (c.id === 'main-agent') continue;
      parts.push(await c.render({ agentId: ctx.agentId, taskDescription: ctx.taskDescription, depth: ctx.depth }));
      loaded.push(c.id);
    }

    // 子 Agent 也加载 L1 scene prompt，获得场景心智模型
    // scene 由主 Agent 通过 task 工具的 scene 参数传递
    if (ctx.scene && ctx.scene !== 'general') {
      for (const c of this.l1Components) {
        if (c.scenes && c.scenes.includes(ctx.scene)) {
          parts.push(await c.render({}));
          loaded.push(c.id);
        }
      }
    }

    for (const c of this.l3Components) {
      parts.push(await c.render(ctx));
      loaded.push(c.id);
    }

    const prompt = parts.join('\n\n');
    return {
      systemPrompt: prompt,
      components: loaded,
      estimatedTokens: this.estimateTokens(prompt),
      scene: ctx.scene,
      complexity: 'standard',
    };
  }

  composeForIntentAnalysis(userMessage: string): string {
    return `Analyze the following user message and determine: scene, complexity, and suggested agent.\n\nUser message: ${userMessage}\n\nRespond with JSON: { "scene": "...", "complexity": "simple|standard|complex", "agent": "...", "confidence": 0.0 }`;
  }

  composeForResultSynthesis(tasks: Array<{ description: string; result: string }>): string {
    const taskList = tasks.map((t, i) => `${i + 1}. ${t.description}\n   Result: ${t.result.slice(0, 500)}`).join('\n\n');
    return `Synthesize the following async task results into a coherent response:\n\n${taskList}`;
  }

  composeForStep(step: StepComposeContext): ComposedPrompt {
    const prompt = `Step: ${step.stepName}\nTask: ${step.taskDescription}`;
    return {
      systemPrompt: prompt,
      components: [],
      estimatedTokens: this.estimateTokens(prompt),
      scene: 'custom',
      complexity: 'standard',
    };
  }

  estimateTokens(prompt: string): number {
    let cjk = 0;
    let ascii = 0;
    for (const char of prompt) {
      const code = char.codePointAt(0)!;
      if (
        (code >= 0x4E00 && code <= 0x9FFF) ||
        (code >= 0x3400 && code <= 0x4DBF) ||
        (code >= 0x3000 && code <= 0x303F) ||
        (code >= 0xFF00 && code <= 0xFFEF) ||
        (code >= 0x3040 && code <= 0x309F) ||
        (code >= 0x30A0 && code <= 0x30FF) ||
        (code >= 0xAC00 && code <= 0xD7AF)
      ) {
        cjk++;
      } else {
        ascii++;
      }
    }
    return Math.ceil(cjk * 1.5 + ascii / 4);
  }
}
