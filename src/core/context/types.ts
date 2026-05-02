export type CompressionStrategy = 'summarize_early' | 'aggressive' | 'selective';

export type BudgetStatus =
  | { level: 'green'; usagePercent: number }
  | { level: 'yellow'; usagePercent: number; suggestion: string }
  | { level: 'red'; usagePercent: number; requiredAction: 'compress' | 'truncate' };
