# Xuanji GUI - 消息管理与通信架构

## 📋 概述

本文档描述从用户输入框到 Agent 子进程的完整消息通信流程，以及优化后的架构设计。

---

## 🔄 当前完整流程分析

### 完整流程图

```
┌─────────────────────────────────────────────────────────────────┐
│  1. 输入层 - InputArea.tsx                                      │
│     - 用户在 textarea 输入                                        │
│     - Enter 触发 handleSubmit()                                   │
│     - 检查 isRunning 状态                                         │
│     ─────────────────────────────────────────────────────────────┐
│     ▼                                                              │
│  2. 状态层 - chatStore.ts                                         │
│     - sendMessage(content) 被调用                                  │
│     - 创建用户消息对象并添加到 messages[]                          │
│     - 更新 runtimeStore 状态                                      │
│     - 调用 window.electron.agentSendMessage(content)             │
│     ─────────────────────────────────────────────────────────────┐
│     ▼                                                              │
│  3. Preload IPC 层 - preload.ts                                   │
│     - agentSendMessage() 调用 ipcRenderer.invoke()              │
│     - 发送到 'agent:send-message' 通道                            │
│     ─────────────────────────────────────────────────────────────┐
│     ▼                                                              │
│  4. 主进程 IPC 层 - ipc/agent.ts                                   │
│     - registerAgentIpcHandlers() 接收 'agent:send-message'       │
│     - 检查 isSessionReady() 和 agentProcess                       │
│     - 通过 agentProcess.send() 转发到子进程                        │
│     ─────────────────────────────────────────────────────────────┐
│     ▼                                                              │
│  5. 子进程桥接层 - agent-bridge.ts                                  │
│     - process.on('message') 接收                                   │
│     - handleSendMessage() 处理                                     │
│     - 调用 session.run(message)                                     │
│     ─────────────────────────────────────────────────────────────┐
│     ▼                                                              │
│  6. AgentLoop 执行层                                               │
│     - 执行 LLM 调用和工具                                           │
│     - 通过注册的回调发送流式事件                                   │
│     ─────────────────────────────────────────────────────────────┐
│     ▼                                                              │
│  7. 事件回传层（逆向流程）                                          │
│     - agent-bridge.ts safeSend() 回传给主进程                       │
│     - agent/index.ts 监听消息并转发给渲染进程                       │
│     - chatStore.ts 监听事件并更新 UI                               │
└─────────────────────────────────────────────────────────────────┘
```

### 当前存在的问题

1. **消息没有唯一追踪ID**：难以追踪一条消息的完整生命周期
2. **状态同步可能延迟**：多个 Store（chatStore, runtimeStore, activeAgentStore）需要手动同步
3. **没有消息队列管理**：快速发送多条消息时可能导致竞态条件
4. **没有重试和超时机制**：IPC 通信失败时没有自动恢复
5. **Agent 选择能力缺失**：所有消息都发送给默认 Agent，无法选择特定 Agent
6. **缺少消息状态管理**：用户不知道自己发送的消息在哪个处理阶段

---

## 🏗️ 优化后的架构设计

### 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│  输入层 + UI 状态管理                                             │
│  ┌──────────────────────┐  ┌──────────────────────────────┐    │
│  │  InputArea.tsx       │  │  AgentSelector.tsx（新增）    │    │
│  │  - 用户输入处理      │  │  - 选择发送给哪个 Agent      │    │
│  │  - 输入法组合状态    │  │  - 显示可用 Agent 列表       │    │
│  └──────────┬───────────┘  └───────────────┬──────────────┘    │
│             │                             │                     │
│             └───────────────┬─────────────┘                     │
│                             ▼                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  unifiedChatStore.ts（新增）                              │  │
│  │  - 统一管理所有消息状态                                   │  │
│  │  - 消息生命周期追踪                                       │  │
│  │  - Agent 选择集成                                         │  │
│  │  - 自动状态同步                                           │  │
│  └───────────────────────────┬──────────────────────────────┘  │
└───────────────────────────────┼──────────────────────────────────┘
                                │
┌───────────────────────────────┼──────────────────────────────────┐
│  消息发送层                   ▼                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  messageSender.ts（新增）                                  │  │
│  │  - 生成唯一 MessageId                                      │  │
│  │  - 消息队列管理（FIFO）                                     │  │
│  │  - 发送优先级处理                                           │  │
│  │  - 重试和超时控制                                           │  │
│  └───────────────────────────┬──────────────────────────────┘  │
└───────────────────────────────┼──────────────────────────────────┘
                                │
┌───────────────────────────────┼──────────────────────────────────┐
│  IPC 通信层                   ▼                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  ipcChannel.ts（重构）                                    │  │
│  │  - 统一的 IPC 通道管理                                     │  │
│  │  - 消息确认机制（ACK/NACK）                                │  │
│  │  - 心跳检测                                                │  │
│  │  - 自动重连                                                │  │
│  └───────────────────────────┬──────────────────────────────┘  │
└───────────────────────────────┼──────────────────────────────────┘
                                │
┌───────────────────────────────┼──────────────────────────────────┐
│  主进程路由层                 ▼                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  messageRouter.ts（新增）                                 │  │
│  │  - 根据 AgentId 路由消息                                   │  │
│  │  - 多 Agent 实例管理                                       │  │
│  │  - Provider 配置隔离                                       │  │
│  └───────────────────────────┬──────────────────────────────┘  │
└───────────────────────────────┼──────────────────────────────────┘
                                │
┌───────────────────────────────┼──────────────────────────────────┐
│  子进程执行层                 ▼                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  （现有）AgentLoop                                         │  │
│  └──────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────┘
```

---

## 📦 核心模块设计

### 1. 统一聊天状态管理 - unifiedChatStore.ts

```typescript
// ============================================================
// 统一聊天状态管理
// ============================================================

import { create } from 'zustand';
import { produce } from 'immer';

export type MessageStatus = 
  | 'queued'       // 排队中
  | 'sending'      // 发送中
  | 'processing'   // 处理中（Agent 已接收）
  | 'streaming'    // 流式输出中
  | 'completed'    // 完成
  | 'error'        // 错误
  | 'interrupted'; // 被中断

export interface ChatMessage {
  id: string;              // 唯一 ID
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  status: MessageStatus;
  agentId?: string;        // 目标 Agent ID
  metadata?: {
    tokenUsage?: { input: number; output: number };
    cost?: number;
    duration?: number;
    error?: string;
    tools?: Array<{ id: string; name: string; status: string }>;
  };
}

export interface AgentInfo {
  id: string;
  name: string;
  description: string;
  avatar?: string;
  enabled: boolean;
}

interface UnifiedChatState {
  // ===== 消息管理 =====
  messages: ChatMessage[];
  currentStreamingId: string | null;
  isSending: boolean;
  
  // ===== Agent 选择 =====
  selectedAgentId: string;
  availableAgents: AgentInfo[];
  
  // ===== 会话状态 =====
  isRunning: boolean;
  canSend: boolean;
  
  // ===== 操作方法 =====
  actions: {
    sendMessage: (
      content: string,
      options?: { agentId?: string; priority?: number }
    ) => Promise<string>;
    interrupt: (messageId?: string) => Promise<void>;
    resend: (messageId: string) => Promise<void>;
    deleteMessage: (messageId: string) => Promise<void>;
    selectAgent: (agentId: string) => void;
    loadAgents: () => Promise<void>;
    clearAll: () => void;
  };
  
  // ===== 内部方法（事件处理） =====
  _internal: {
    onMessageStatusUpdate: (messageId: string, status: MessageStatus) => void;
    onStreamingText: (messageId: string, text: string) => void;
    onToolStart: (messageId: string, data: any) => void;
    onToolEnd: (messageId: string, data: any) => void;
    onMessageComplete: (messageId: string, metadata: any) => void;
    onMessageError: (messageId: string, error: string) => void;
  };
}

function generateId(prefix: string = 'msg'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export const useUnifiedChatStore = create<UnifiedChatState>((set, get) => ({
  messages: [],
  currentStreamingId: null,
  isSending: false,
  selectedAgentId: 'default',
  availableAgents: [],
  isRunning: false,
  canSend: true,

  actions: {
    sendMessage: async (content, options = {}) => {
      const { selectedAgentId, canSend } = get();
      const agentId = options.agentId || selectedAgentId;
      
      if (!canSend || !content.trim()) {
        throw new Error('无法发送消息');
      }

      const messageId = generateId('user');
      const userMessage: ChatMessage = {
        id: messageId,
        role: 'user',
        content,
        timestamp: Date.now(),
        status: 'queued',
        agentId,
      };

      set(
        produce((draft) => {
          draft.messages.push(userMessage);
          draft.isSending = true;
          draft.canSend = false;
        })
      );

      try {
        // 发送消息
        set(
          produce((draft) => {
            const idx = draft.messages.findIndex((m) => m.id === messageId);
            if (idx !== -1) draft.messages[idx].status = 'sending';
          })
        );

        // 调用消息发送模块
        const result = await messageSender.send({
          messageId,
          content,
          agentId,
        });

        return messageId;
      } catch (error) {
        set(
          produce((draft) => {
            const idx = draft.messages.findIndex((m) => m.id === messageId);
            if (idx !== -1) {
              draft.messages[idx].status = 'error';
              draft.messages[idx].metadata = {
                error: error instanceof Error ? error.message : String(error),
              };
            }
            draft.isSending = false;
            draft.canSend = true;
          })
        );
        throw error;
      }
    },

    interrupt: async (messageId) => {
      // 中断逻辑
    },

    resend: async (messageId) => {
      // 重发逻辑
    },

    deleteMessage: async (messageId) => {
      set(
        produce((draft) => {
          draft.messages = draft.messages.filter((m) => m.id !== messageId);
        })
      );
    },

    selectAgent: (agentId) => {
      set({ selectedAgentId: agentId });
    },

    loadAgents: async () => {
      const agents = await window.electron.agentList();
      if (agents.success) {
        set({ availableAgents: agents.agents || [] });
      }
    },

    clearAll: () => {
      set({
        messages: [],
        currentStreamingId: null,
        isSending: false,
        canSend: true,
      });
    },
  },

  _internal: {
    onMessageStatusUpdate: (messageId, status) => {
      set(
        produce((draft) => {
          const idx = draft.messages.findIndex((m) => m.id === messageId);
          if (idx !== -1) {
            draft.messages[idx].status = status;
          }
        })
      );
    },

    onStreamingText: (messageId, text) => {
      set(
        produce((draft) => {
          let assistantMsg = draft.messages.find(
            (m) => m.id === messageId || m.id === draft.currentStreamingId
          );

          if (!assistantMsg) {
            // 创建新的 Assistant 消息
            const newMessage: ChatMessage = {
              id: messageId,
              role: 'assistant',
              content: text,
              timestamp: Date.now(),
              status: 'streaming',
            };
            draft.messages.push(newMessage);
            draft.currentStreamingId = messageId;
          } else {
            assistantMsg.content += text;
          }
        })
      );
    },

    onToolStart: (messageId, data) => {
      set(
        produce((draft) => {
          const msg = draft.messages.find((m) => m.id === messageId || m.id === draft.currentStreamingId);
          if (msg) {
            if (!msg.metadata) msg.metadata = {};
            if (!msg.metadata.tools) msg.metadata.tools = [];
            msg.metadata.tools.push({
              id: data.id,
              name: data.name,
              status: 'running',
            });
          }
        })
      );
    },

    onToolEnd: (messageId, data) => {
      set(
        produce((draft) => {
          const msg = draft.messages.find((m) => m.id === messageId || m.id === draft.currentStreamingId);
          if (msg && msg.metadata?.tools) {
            const toolIdx = msg.metadata.tools.findIndex((t) => t.id === data.id);
            if (toolIdx !== -1) {
              msg.metadata.tools[toolIdx].status = data.isError ? 'error' : 'success';
            }
          }
        })
      );
    },

    onMessageComplete: (messageId, metadata) => {
      set(
        produce((draft) => {
          const msg = draft.messages.find(
            (m) => m.id === messageId || m.id === draft.currentStreamingId
          );
          if (msg) {
            msg.status = 'completed';
            msg.metadata = { ...msg.metadata, ...metadata };
          }
          draft.isSending = false;
          draft.canSend = true;
          draft.currentStreamingId = null;
        })
      );
    },

    onMessageError: (messageId, error) => {
      set(
        produce((draft) => {
          const msg = draft.messages.find(
            (m) => m.id === messageId || m.id === draft.currentStreamingId
          );
          if (msg) {
            msg.status = 'error';
            msg.metadata = { ...msg.metadata, error };
          }
          draft.isSending = false;
          draft.canSend = true;
          draft.currentStreamingId = null;
        })
      );
    },
  },
}));
```

### 2. 消息发送器 - messageSender.ts

```typescript
// ============================================================
// 消息发送器 - 管理消息队列和发送逻辑
// ============================================================

export interface SendOptions {
  messageId: string;
  content: string;
  agentId?: string;
  priority?: number; // 0-100, 越高越优先
  retries?: number;  // 重试次数
  timeout?: number;  // 超时时间
}

export interface QueuedMessage extends SendOptions {
  enqueueTime: number;
  attempts: number;
}

class MessageSender {
  private queue: QueuedMessage[] = [];
  private isProcessing = false;
  private currentMessageId: string | null = null;
  private maxRetries = 3;
  private defaultTimeout = 30000;

  // ============ 队列操作 ============
  send(options: SendOptions): Promise<string> {
    const queuedMessage: QueuedMessage = {
      ...options,
      enqueueTime: Date.now(),
      attempts: 0,
    };

    return new Promise((resolve, reject) => {
      // 插入队列（根据优先级排序）
      this.enqueue(queuedMessage);
      
      // 绑定回调
      this.messageCallbacks.set(options.messageId, { resolve, reject });
      
      // 开始处理队列
      this.processQueue();
    });
  }

  private enqueue(message: QueuedMessage) {
    this.queue.push(message);
    this.sortQueue();
  }

  private sortQueue() {
    this.queue.sort((a, b) => {
      // 先按优先级排序（高的在前）
      const priorityDiff = (b.priority || 50) - (a.priority || 50);
      if (priorityDiff !== 0) return priorityDiff;
      // 同优先级按时间排序（早的在前）
      return a.enqueueTime - b.enqueueTime;
    });
  }

  private async processQueue() {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.queue.length > 0) {
      const message = this.queue.shift()!;
      this.currentMessageId = message.messageId;

      try {
        await this.attemptSend(message);
      } catch (error) {
        this.handleSendError(message, error);
      }
    }

    this.isProcessing = false;
    this.currentMessageId = null;
  }

  private async attemptSend(message: QueuedMessage): Promise<void> {
    const callbacks = this.messageCallbacks.get(message.messageId);
    if (!callbacks) return;

    const maxAttempts = message.retries || this.maxRetries;
    const timeout = message.timeout || this.defaultTimeout;

    while (message.attempts < maxAttempts) {
      try {
        // 更新状态
        this.notifyStatus(message.messageId, 'sending');

        // 发送消息（带超时）
        const result = await this.sendWithTimeout(message, timeout);

        // 成功
        callbacks.resolve(message.messageId);
        return;
      } catch (error) {
        message.attempts++;

        if (message.attempts >= maxAttempts) {
          // 超过最大重试次数，失败
          throw error;
        }

        // 指数退避重试
        const backoffTime = Math.min(1000 * Math.pow(2, message.attempts - 1), 10000);
        console.log(`消息 ${message.messageId} 发送失败，${backoffTime}ms 后重试 (${message.attempts}/${maxAttempts})`);
        await this.sleep(backoffTime);
      }
    }
  }

  private async sendWithTimeout(
    message: QueuedMessage,
    timeout: number
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('发送超时'));
      }, timeout);

      window.electron.agentSendMessage(message.content)
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  private handleSendError(message: QueuedMessage, error: any) {
    const callbacks = this.messageCallbacks.get(message.messageId);
    if (callbacks) {
      this.notifyStatus(message.messageId, 'error');
      callbacks.reject(error);
      this.messageCallbacks.delete(message.messageId);
    }
  }

  // ============ 消息回调管理 ============
  private messageCallbacks = new Map<string, {
    resolve: (messageId: string) => void;
    reject: (error: any) => void;
  }>();

  // ============ 状态通知 ============
  private notifyStatus(messageId: string, status: MessageStatus) {
    const { _internal } = useUnifiedChatStore.getState();
    _internal.onMessageStatusUpdate(messageId, status);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const messageSender = new MessageSender();
```

### 3. 重构后的 IPC 通信层 - ipcChannel.ts

```typescript
// ============================================================
// IPC 通信通道 - 统一管理与主进程的通信
// ============================================================

interface IpcMessage {
  id: string;
  type: string;
  data?: any;
  timestamp: number;
}

interface PendingRequest {
  id: string;
  timer: NodeJS.Timeout;
  resolve: (data: any) => void;
  reject: (error: any) => void;
}

class IpcChannel {
  private pendingRequests = new Map<string, PendingRequest>();
  private messageIdCounter = 0;
  private defaultTimeout = 30000;
  
  // 心跳相关
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private lastHeartbeatAck: number = 0;
  private heartbeatIntervalMs = 5000;
  private heartbeatTimeoutMs = 10000;
  private isConnected = true;

  // ============ 请求-响应模式 ============
  request(
    channel: string,
    data?: any,
    options?: { timeout?: number }
  ): Promise<any> {
    const requestId = `req-${++this.messageIdCounter}-${Date.now()}`;
    const timeout = options?.timeout || this.defaultTimeout;

    return new Promise((resolve, reject) => {
      // 设置超时
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`请求超时: ${channel}`));
      }, timeout);

      // 注册回调
      this.pendingRequests.set(requestId, {
        id: requestId,
        timer,
        resolve,
        reject,
      });

      // 发送请求
      const message: IpcMessage = {
        id: requestId,
        type: channel,
        data,
        timestamp: Date.now(),
      };
      window.electron.sendWithAck?.(message) || 
        (window.electron as any).sendToMain?.('ipc:request', message);
    });
  }

  // ============ 响应处理（由主进程调用）===========
  onResponse(response: IpcMessage) {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) {
      console.warn('收到未知响应:', response.id);
      return;
    }

    clearTimeout(pending.timer);
    this.pendingRequests.delete(response.id);

    if (response.type === 'ipc:ack') {
      // 确认消息，不 resolve/reject
      console.debug('收到 ACK:', response.id);
    } else if (response.type === 'ipc:nack') {
      pending.reject(new Error(response.data?.error || '请求被拒绝'));
    } else {
      pending.resolve(response.data);
    }
  }

  // ============ 心跳机制 ============
  startHeartbeat() {
    if (this.heartbeatInterval) {
      return; // 已启动
    }

    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, this.heartbeatIntervalMs);

    this.lastHeartbeatAck = Date.now();
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private sendHeartbeat() {
    const now = Date.now();
    
    if (now - this.lastHeartbeatAck > this.heartbeatTimeoutMs) {
      // 心跳超时
      this.handleDisconnect();
      return;
    }

    // 发送心跳
    this.request('ipc:heartbeat', { timestamp: now }, { timeout: 5000 })
      .then(() => {
        this.lastHeartbeatAck = Date.now();
        if (!this.isConnected) {
          this.handleReconnect();
        }
      })
      .catch(() => {
        // 心跳失败，可能断开连接
        if (this.isConnected) {
          console.warn('心跳失败');
        }
      });
  }

  private handleDisconnect() {
    this.isConnected = false;
    console.warn('IPC 连接断开');
    // 触发 UI 显示断开连接提示
  }

  private handleReconnect() {
    this.isConnected = true;
    console.log('IPC 连接恢复');
    // 触发 UI 更新
  }

  // ============ 事件监听 ============
  on(channel: string, callback: (...args: any[]) => void) {
    window.electron.on(channel, callback);
  }

  off(channel: string, callback: (...args: any[]) => void) {
    window.electron.off(channel, callback);
  }
}

export const ipcChannel = new IpcChannel();
```

### 4. Agent 选择器组件 - AgentSelector.tsx

```typescript
// ============================================================
// Agent 选择器组件
// ============================================================

import React, { useEffect } from 'react';
import { Bot, ChevronDown } from 'lucide-react';
import { useUnifiedChatStore } from '../stores/unifiedChatStore';

interface AgentSelectorProps {
  className?: string;
}

export default function AgentSelector({ className = '' }: AgentSelectorProps) {
  const { selectedAgentId, availableAgents, actions } = useUnifiedChatStore();
  const [isOpen, setIsOpen] = React.useState(false);
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    actions.loadAgents();
  }, []);

  useEffect(() => {
    // 点击外部关闭
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedAgent = availableAgents.find(a => a.id === selectedAgentId);

  return (
    <div ref={dropdownRef} className={`relative ${className}`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 bg-bg-primary border border-bg-tertiary rounded-lg hover:bg-bg-tertiary transition-colors"
      >
        <Bot size={16} />
        <span className="text-sm">{selectedAgent?.name || '默认 Agent'}</span>
        <ChevronDown size={14} className="text-text-secondary" />
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-0 mb-2 w-64 bg-bg-primary border border-bg-tertiary rounded-lg shadow-lg overflow-hidden z-50">
          <div className="p-2">
            {availableAgents.length === 0 ? (
              <div className="p-4 text-center text-text-secondary text-sm">
                暂无可用 Agent
              </div>
            ) : (
              availableAgents.map((agent) => (
                <button
                  key={agent.id}
                  onClick={() => {
                    actions.selectAgent(agent.id);
                    setIsOpen(false);
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-left transition-colors ${
                    selectedAgentId === agent.id
                      ? 'bg-primary/10 text-primary'
                      : 'hover:bg-bg-tertiary'
                  }`}
                >
                  <div className="w-8 h-8 rounded-full bg-bg-tertiary flex items-center justify-center">
                    {agent.avatar ? (
                      <img src={agent.avatar} alt={agent.name} className="w-full h-full rounded-full" />
                    ) : (
                      <Bot size={16} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{agent.name}</div>
                    <div className="text-xs text-text-secondary truncate">{agent.description}</div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

---

## 📁 更新后的目录结构

```
desktop/renderer/
├── components/
│   ├── InputArea.tsx              # 更新（集成 Agent 选择）
│   ├── ChatArea.tsx               # 更新（使用新 Store）
│   ├── AgentSelector.tsx          # 新增
│   ├── MessageBubble.tsx          # 更新（显示消息状态）
│   └── ...
├── stores/
│   ├── unifiedChatStore.ts        # 新增（统一聊天状态）
│   ├── chatStore.ts               # 保持兼容（标记为 deprecated）
│   ├── runtimeStore.ts            # 保留但简化
│   ├── activeAgentStore.ts        # 保留但简化
│   └── ...
├── services/
│   ├── messageSender.ts           # 新增
│   └── ipcChannel.ts              # 新增
└── ...

desktop/main/
├── ipc/
│   ├── agent.ts                   # 重构
│   └── messageRouter.ts           # 新增
└── ...
```

---

## 🔄 优化后的完整数据流

```
1. 用户输入
   ↓
2. InputArea 组件获取输入内容和选中的 Agent
   ↓
3. unifiedChatStore.actions.sendMessage()
   - 创建用户消息对象
   - 设置状态为 'queued'
   - 调用 messageSender.send()
   ↓
4. messageSender
   - 加入发送队列
   - 按优先级排序
   - 取出第一条消息处理
   ↓
5. ipcChannel.request()
   - 生成 RequestId
   - 发送到主进程
   - 等待 ACK/响应
   ↓
6. 主进程 messageRouter（新增）
   - 根据 AgentId 路由到正确的 Agent 实例
   - 管理多 Agent 隔离
   ↓
7. 子进程处理并流式返回
   ↓
8. unifiedChatStore._internal 处理事件
   - 更新消息状态
   - 显示流式输出
   - 显示工具执行
   - 完成/错误处理
```

---

## 🎯 核心改进点

| 改进项 | 之前 | 现在 |
|--------|------|------|
| **消息追踪** | 无 | 每个消息有唯一 ID 和完整生命周期状态 |
| **Agent 选择** | 只能用默认 | 用户可以选择特定 Agent |
| **消息队列** | 无 | FIFO + 优先级队列 |
| **重试机制** | 无 | 自动重试 + 指数退避 |
| **超时处理** | 无 | 可配置超时 |
| **心跳检测** | 无 | 自动检测连接状态 |
| **状态同步** | 手动跨 Store 同步 | 统一 Store，自动同步 |
| **错误提示** | 基础 | 详细错误信息 + 重试选项 |

---

## 📊 消息状态机

```
queued (排队中)
  ↓
sending (发送中)
  ↓
processing (Agent 处理中)
  ↓
streaming (流式输出)
  ↓
completed (完成)

可能的错误分支：
queued → sending → error
processing → error
streaming → interrupted → error
```

---

这个架构设计应该能很好地解决你提到的问题！你觉得如何？需要我详细展开某个部分吗？
