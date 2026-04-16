/**
 * Token usage statistics types
 */

export interface DailyStats {
  date: string; // YYYY-MM-DD
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  toolUsage: ToolUsage[];
}

export interface ToolUsage {
  tool: string;
  count: number;
  tokens: number;
}

export interface UsageRecord {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  toolName?: string;
  timestamp: number;
}

export interface MonthlyStatsData {
  daily: Record<string, DailyStats>;
}

export interface ITokenStatsCollector {
  recordUsage(params: {
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    toolName?: string;
  }): Promise<void>;
  
  getDailyStats(date: Date): Promise<DailyStats | null>;
  getTopTools(limit: number, date?: Date): Promise<ToolUsage[]>;
  getRangeStats(startDate: Date, endDate: Date): Promise<DailyStats[]>;
}

export interface IStatsStorage {
  saveRecord(record: UsageRecord): Promise<void>;
  getDailyRecords(date: Date): Promise<UsageRecord[]>;
  getRangeRecords(startDate: Date, endDate: Date): Promise<UsageRecord[]>;
}
