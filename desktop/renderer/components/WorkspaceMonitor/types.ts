// ============================================================
// Workspace Monitor - 类型定义
// ============================================================

export interface Point {
  x: number;
  y: number;
}

export interface Circle {
  x: number;
  y: number;
  radius: number;
  scale?: number;
}

export interface Path {
  start: Point;
  control: Point;
  end: Point;
}

export type AgentState = 'idle' | 'thinking' | 'executing' | 'waiting' | 'error' | 'done';
export type SubAgentState = 'idle' | 'running' | 'success' | 'error';
export type CollaborationType = 'task' | 'data';

export interface MainAgentData {
  id: string;
  name: string;
  status: AgentState;
  currentThought?: string;
  currentTool?: string;
}

export interface SubAgentData {
  id: string;
  name: string;
  type: 'tool' | 'agent';
  status: SubAgentState;
  task?: string;
  duration?: number;
  tokenUsage?: number;
  progress?: number;
}

export interface Collaboration {
  from: string;
  to: string;
  type: CollaborationType;
  active: boolean;
}

export interface WorkspaceStats {
  totalTokens: number;
  currentTokenDelta: number;
  duration: number;
  iteration: number;
}

export interface WorkspaceState {
  mainAgent: MainAgentData;
  subAgents: SubAgentData[];
  collaborations: Collaboration[];
  stats: WorkspaceStats;
}

export interface Particle {
  x: number;
  y: number;
  progress: number;
  opacity?: number;
}

export interface Animation {
  id: string;
  startTime: number;
  duration: number;
  update: (progress: number, deltaTime: number) => void;
  draw?: (ctx: CanvasRenderingContext2D) => void;
  isComplete: () => boolean;
}

export interface LayoutConfig {
  centerX: number;
  centerY: number;
  mainRadius: number;
  subRadius: number;
  orbitRadius: number;
  canvasWidth: number;
  canvasHeight: number;
}
