/**
 * ConversationStore — 合并 messageStore.status + _conversationState + runtimeStore.processing。
 *
 * 单一数据源，从后端 SessionStateMachine 状态派生。Phase 4 时与 sessionStore 合并。
 */

import { create } from 'zustand';

export type ChatStatus = 'idle' | 'thinking' | 'executing';
export type ConvState = 'idle' | 'executing' | 'outputting' | 'waiting_async';

export interface RoutingInfo {
  agentId: string;
  confidence: number;
  method: string;
  scene?: string;
}

interface ConversationStoreState {
  status: ChatStatus;
  conversationState: ConvState;
  processing: boolean;
  iteration: number;
  currentAgentId: string | null;
  activeSkill: { name: string; icon?: string } | null;
  contextInfo: any;
  routingInfo: RoutingInfo | null;

  onAgentStarted: (data?: { model?: string }) => void;
  onAgentCompleted: () => void;
  setConversationState: (state: ConvState) => void;
  setProcessing: (v: boolean) => void;
  setIteration: (v: number) => void;
  setCurrentAgentId: (id: string | null) => void;
  setActiveSkill: (skill: { name: string; icon?: string } | null) => void;
  setContextInfo: (info: any) => void;
  setRoutingInfo: (info: RoutingInfo | null) => void;

  isRunning: () => boolean;
}

export const useConversationStore = create<ConversationStoreState>((set, get) => ({
  status: 'idle',
  conversationState: 'idle',
  processing: false,
  iteration: 0,
  currentAgentId: null,
  activeSkill: null,
  contextInfo: null,
  routingInfo: null,

  onAgentStarted: () => {
    set({
      status: 'thinking',
      conversationState: 'executing',
      processing: true,
      iteration: get().iteration + 1,
    });
  },

  onAgentCompleted: () => {
    set({ status: 'idle', processing: false });
  },

  setConversationState: (conversationState) => set({ conversationState }),
  setProcessing: (processing) => set({ processing }),
  setIteration: (iteration) => set({ iteration }),
  setCurrentAgentId: (currentAgentId) => set({ currentAgentId }),
  setActiveSkill: (activeSkill) => set({ activeSkill }),
  setContextInfo: (contextInfo) => set({ contextInfo }),
  setRoutingInfo: (routingInfo) => set({ routingInfo }),

  isRunning: () => ['executing', 'outputting'].includes(get().conversationState),
}));
