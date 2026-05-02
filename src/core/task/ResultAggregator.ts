import type { TaskStepResult } from './types';

export class ResultAggregator {
  aggregate(completedSteps: TaskStepResult[]): TaskStepResult {
    return {
      success: completedSteps.every(s => s.success),
      output: completedSteps.map(s => s.output ?? '').join('\n'),
      tokenUsage: completedSteps.reduce(
        (acc, s) => ({ input: acc.input + (s.tokenUsage?.input ?? 0), output: acc.output + (s.tokenUsage?.output ?? 0) }),
        { input: 0, output: 0 },
      ),
      duration: completedSteps.reduce((acc, s) => acc + (s.duration ?? 0), 0),
    };
  }
}
