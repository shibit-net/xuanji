import type { Message, TokenUsage } from '@/core/types';

export interface SessionConfig {
  name: string;
  agentId?: string;
  workingDir?: string;
  metadata?: Record<string, any>;
}

export interface Session {
  id: string;
  name: string;
  agentId: string;
  status: 'active' | 'paused' | 'archived';
  messages: Message[];
  tokenUsage: TokenUsage;
  createdAt: number;
  updatedAt: number;
  workingDir?: string;
  metadata?: Record<string, any>;
}

export interface SessionSummary {
  id: string;
  name: string;
  status: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
}
