import type { IntentResult } from '@/core/conversation/types';
import type { TaskPlan, TaskStep } from './types';

export class TaskPlanner {
  plan(intent: IntentResult, _userId: string, _workingDir: string, _parentTaskId?: string): TaskPlan {
    const steps: TaskStep[] = [];
    const now = Date.now();

    switch (intent.complexity) {
      case 'simple':
        steps.push({
          id: `step-${now}-0`,
          type: 'sub_agent',
          agentId: intent.agent ?? 'general-purpose',
          scene: intent.scene ?? 'coding',
          description: 'Execute directly',
          input: '',
          dependencies: [],
          status: 'pending',
        });
        break;

      case 'complex':
        steps.push(
          {
            id: `step-${now}-0`, type: 'main_agent', agentId: 'main',
            scene: intent.scene ?? 'coding', description: 'Plan and coordinate',
            input: '', dependencies: [], status: 'pending',
          },
          {
            id: `step-${now}-1`, type: 'synthesis', agentId: 'main',
            scene: intent.scene ?? 'coding', description: 'Synthesize results',
            input: '', dependencies: [`step-${now}-0`], status: 'pending',
          },
        );
        break;

      default:
        steps.push({
          id: `step-${now}-0`, type: 'main_agent', agentId: 'main',
          scene: intent.scene ?? 'coding', description: 'Process request',
          input: '', dependencies: [], status: 'pending',
        });
        break;
    }

    return { steps, estimatedDuration: steps.length * 30_000, complexity: intent.complexity };
  }

  estimateDuration(steps: TaskStep[]): number {
    return steps.length * 30_000;
  }
}
