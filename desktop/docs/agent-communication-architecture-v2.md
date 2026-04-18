# Xuanji GUI Agent 通信架构升级文档

## 📋 概述

本文档描述了 Xuanji GUI 模式下的 AgentLoop 通信架构升级方案，旨在提供更优秀的通信模式，用于管理用户输入、会话上下文、与 Agent 的通信以及异常处理。

---

## 🎯 目标

1. **提升通信可靠性** - 确保消息的有序性和一致性
2. **完善异常处理** - 建立统一的错误处理和恢复机制
3. **优化上下文管理** - 更好地管理会话状态和消息历史
4. **增强监控能力** - 提供更好的状态跟踪和调试信息
5. **支持多 Agent 协作** - 为未来的多 Agent 场景做准备

---

## 📐 当前架构分析

### 现有架构

```
┌─────────────┐         ┌───────────────┐         ┌───────────────┐
│   React     │         │  Electron     │         │  AgentLoop   │
│  Frontend   │◄───────►│   Main        │◄───────►│  (Child)      │
│             │  IPC    │  Process      │  IPC    │  Process      │
│  chatStore  │         │               │         │               │
└─────────────┘         └───────────────┘         └───────────────┘
```

### 存在的问题

1. **消息丢失风险** - 没有消息确认机制
2. **异常处理分散** - 错误处理逻辑分布在各处
3. **会话状态不完整** - 状态管理缺乏统一性
4. **缺乏消息重传** - 网络波动时无法自动恢复
5. **无消息队列** - 并发消息可能导致时序问题
6. **状态同步延迟** - 前后端状态可能不一致

---

## 🏗️ 新架构设计

### 架构分层

```
┌───────────────────────────────────────────────────────────────────┐
│                         React Frontend                             │
│  ┌────────────┐  ┌─────────────┐  ┌─────────────┐                 │
│  │Chat (UI)   │  │ Agent Status│  │ Session Mgmt│                 │
│  └────────────┘  └─────────────┘  └─────────────┘                 │
│  ┌────────────────────────────────────────────────────┐           │
│  │   Zustand Stores (chatStore, agentStore, etc)     │           │
│  └────────────────────────────────────────────────────┘           │
└────────────────────────────┬──────────────────────────────────────┘
                             │
┌────────────────────────────┼──────────────────────────────────────┐
│                            │  Preload API                         │
└────────────────────────────┼──────────────────────────────────────┘
                             │
┌────────────────────────────┼──────────────────────────────────────┐
│                    Electron Main Process                        │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                 Agent Bridge Layer                           │ │
│  │  ┌─────────────────────────────────────────────────────┐    │ │
│  │  │ Message Queue & Router                          │    │ │
│  │  │ ┌─────────────────┐ ┌──────────────────────────┐  │    │ │
│  │  │ │ Request  Queue  │ │  Response/Event Queue    │  │    │ │
│  │  │ └─────────────────┘ └──────────────────────────┘  │    │ │
│  │  │ ┌───────────────────────────────────────────────┐ │    │ │
│  │  │ │     Message Ack & Retry Manager               │ │    │ │
│  │  │ └───────────────────────────────────────────────┘ │    │ │
│  │  └─────────────────────────────────────────────────────┘    │ │
│  │  ┌─────────────────────────────────────────────────────────┐│ │
│  │  │               Session Manager                          ││ │
│  │  │  - Context Storage                                     ││ │
│  │  │  - State Synchronization                               ││ │
│  │  │  - History Management                                  ││ │
│  │  └─────────────────────────────────────────────────────────┘│ │
│  │  ┌─────────────────────────────────────────────────────────┐│ │
│  │  │               Exception Handler                         ││ │
│  │  │  - Error Classification                                 ││ │
│  │  │  - Recovery Strategies                                  ││ │
│  │  │  - Fallback Mechanisms                                  ││ │
│  │  └─────────────────────────────────────────────────────────┘│ │
│  │  ┌─────────────────────────────────────────────────────────┐│ │
│  │  │               Monitoring & Metrics                      ││ │
│  │  │  - Message Throughput                                  ││ │
│  │  │  - Latency Tracking                                    ││ │
│  │  │  - Error Rates                                         ││ │
│  │  └─────────────────────────────────────────────────────────┘│ │
│  └─────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────┬─────────────────────────────────┘
                                   │
┌──────────────────────────────────┼─────────────────────────────────┐
│                                  │ AgentLoop Process              │
│  ┌───────────────────────────────┼───────────────────────────────┐ │
│  │                    Communication Bridge                   │ │
│  │ - Request Processing                                        │ │
│  │ - Event Emitting                                            │ │
│  │ - Heartbeat Monitoring                                      │ │
│  └───────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 📦 核心模块设计

### 1. 消息层 (Message Layer)

#### 1.1 消息协议

```typescript
// 消息基础接口
interface BaseMessage {
  id: string;                    // UUID v4
  timestamp: number;             // 发送时间戳
  type: MessageType;             // 消息类型
  version: string;               // 协议版本
  traceId?: string;              // 追踪ID (用于跨请求追踪)
}

// 消息类型枚举
enum MessageType {
  // 请求类型
  REQUEST = 'request',           // 普通请求
  STREAM_REQUEST = 'stream_request', // 流式请求
  
  // 响应类型
  RESPONSE = 'response',         // 普通响应
  STREAM_DATA = 'stream_data',   // 流式数据
  STREAM_END = 'stream_end',     // 流结束
  
  // 事件类型
  EVENT = 'event',               // 事件
  ERROR = 'error',               // 错误
  
  // 控制类型
  ACK = 'ack',                   // 确认
  PING = 'ping',                 // 心跳
  PONG = 'pong',                 // 心跳响应
}

// 请求消息
interface RequestMessage extends BaseMessage {
  type: MessageType.REQUEST | MessageType.STREAM_REQUEST;
  method: RequestMethod;
  payload: any;
  priority: Priority;           // 优先级
  requiresAck: boolean;          // 是否需要确认
  timeout?: number;              // 超时时间
}

// 响应消息
interface ResponseMessage extends BaseMessage {
  type: MessageType.RESPONSE;
  requestId: string;            // 对应的请求ID
  success: boolean;
  data?: any;
  error?: ErrorInfo;
}

// 事件消息
interface EventMessage extends BaseMessage {
  type: MessageType.EVENT;
  eventName: EventType;
  data: any;
}

// 错误信息
interface ErrorInfo {
  code: ErrorCode;
  message: string;
  details?: any;
  stack?: string;
  retryable: boolean;
}
```

#### 1.2 消息队列

```typescript
class MessageQueue<T> {
  private queue: T[] = [];
  private maxSize: number;
  private enqueueListeners: Array<(item: T) => void> = [];

  constructor(maxSize: number = 1000) {
    this.maxSize = maxSize;
  }

  enqueue(item: T): boolean {
    if (this.queue.length >= this.maxSize) {
      console.warn('Message queue overflow');
      return false;
    }
    this.queue.push(item);
    this.notifyEnqueue(item);
    return true;
  }

  dequeue(): T | undefined {
    return this.queue.shift();
  }

  peek(): T | undefined {
    return this.queue[0];
  }

  clear(): void {
    this.queue = [];
  }

  size(): number {
    return this.queue.length;
  }

  private notifyEnqueue(item: T): void {
    this.enqueueListeners.forEach(listener => listener(item));
  }

  onEnqueue(listener: (item: T) => void): () => void {
    this.enqueueListeners.push(listener);
    return () => {
      const index = this.enqueueListeners.indexOf(listener);
      if (index !== -1) {
        this.enqueueListeners.splice(index, 1);
      }
    };
  }
}
```

### 2. 请求/响应管理

#### 2.1 请求管理器

```typescript
class RequestManager {
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private messageQueue: MessageQueue<RequestMessage>;
  private defaultTimeout: number = 30000;

  constructor() {
    this.messageQueue = new MessageQueue<RequestMessage>();
  }

  // 发送请求
  async request<T>(
    method: string, 
    payload: any, 
    options: RequestOptions = {}
  ): Promise<T> {
    const requestId = generateId();
    const request: RequestMessage = {
      id: requestId,
      timestamp: Date.now(),
      type: options.stream ? MessageType.STREAM_REQUEST : MessageType.REQUEST,
      version: '2.0',
      method,
      payload,
      priority: options.priority || Priority.NORMAL,
      requiresAck: options.requiresAck !== false,
      timeout: options.timeout || this.defaultTimeout,
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Request timeout'));
      }, request.timeout);

      this.pendingRequests.set(requestId, {
        request,
        resolve,
        reject,
        timer,
        retryCount: 0,
      });

      this.messageQueue.enqueue(request);
    });
  }

  // 处理响应
  handleResponse(response: ResponseMessage): void {
    const pending = this.pendingRequests.get(response.requestId);
    if (!pending) {
      console.warn('No pending request for response:', response.requestId);
      return;
    }

    clearTimeout(pending.timer);
    this.pendingRequests.delete(response.requestId);

    if (response.success) {
      pending.resolve(response.data);
    } else {
      pending.reject(new Error(response.error?.message || 'Request failed'));
    }
  }
}
```

#### 2.2 确认和重传机制

```typescript
class AckManager {
  private ackMap: Map<string, {
    sentAt: number;
    retryCount: number;
    message: BaseMessage;
  }> = new Map();
  
  private maxRetries: number = 3;
  private retryDelay: number = 2000;

  // 发送需要确认的消息
  sendWithAck(message: BaseMessage, sendFn: (msg: BaseMessage) => void): void {
    this.ackMap.set(message.id, {
      sentAt: Date.now(),
      retryCount: 0,
      message,
    });
    
    sendFn(message);
    this.scheduleRetry(message.id);
  }

  // 处理确认
  handleAck(ackId: string): void {
    const pending = this.ackMap.get(ackId);
    if (pending) {
      this.ackMap.delete(ackId);
    }
  }

  private scheduleRetry(messageId: string): void {
    setTimeout(() => {
      const pending = this.ackMap.get(messageId);
      if (!pending) return;

      if (pending.retryCount >= this.maxRetries) {
        this.ackMap.delete(messageId);
        console.error('Max retries exceeded for message:', messageId);
        return;
      }

      pending.retryCount++;
      this.sendWithAck(pending.message);
    }, this.retryDelay);
  }
}
```

### 3. 会话管理层 (Session Layer)

#### 3.1 关键概念区分

**重要：有两种不同的"上下文"**

```
┌─────────────────────────────────────────────────────────────────┐
│  UI 会话上下文 (UISessionContext)                               │
│  ├─ 存储位置：Electron 主进程 + 渲染进程 Zustand                 │
│  ├─ 用途：界面显示、历史回溯、用户交互                            │
│  ├─ 特点：完整保留所有消息，包括工具调用、思考过程等元数据        │
│  └─ 示例：显示完整的聊天界面，包括展开的工具调用详情              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ 转换
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  LLM 上下文 (LLMContext)                                       │
│  ├─ 存储位置：AgentLoop 进程内部                                │
│  ├─ 用途：传给 LLM 的提示词，用于生成响应                        │
│  ├─ 特点：经过压缩、截断、摘要，只保留对 LLM 有用的信息          │
│  └─ 示例：精简的对话历史，可能省略部分工具调用细节                │
└─────────────────────────────────────────────────────────────────┘
```

#### 3.2 UI 会话上下文 (UISessionContext)

```typescript
// UI 显示的完整消息结构
interface UIMessage {
  id: string;
  type: 'user' | 'assistant' | 'system';
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  
  // UI 特有字段
  status: 'sending' | 'streaming' | 'complete' | 'error';
  streamingText?: string;
  
  // 工具调用信息（完整保留）
  tools?: ToolCall[];
  toolResults?: ToolResult[];
  
  // 思考过程（完整保留）
  thinking?: string;
  
  // 元数据
  metadata?: {
    latency?: number;
    tokensUsed?: number;
    modelUsed?: string;
  };
}

interface ToolCall {
  id: string;
  name: string;
  args: any;
  status: 'calling' | 'success' | 'error';
  result?: any;
  error?: string;
  startTime?: number;
  endTime?: number;
}

// UI 会话上下文 - 完整保留所有信息
interface UISessionContext {
  id: string;
  createdAt: number;
  updatedAt: number;
  messages: UIMessage[];  // 完整的 UI 消息列表
  currentTurn: number;
  state: SessionState;
  metadata: {
    title?: string;
    summary?: string;
    totalTokens?: number;
    messageCount?: number;
  };
}
```

#### 3.3 LLM 上下文 (LLMContext)

```typescript
// 传给 LLM 的精简消息结构
interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  
  // 只保留必要的工具调用信息
  toolCalls?: SimplifiedToolCall[];
  toolResponses?: SimplifiedToolResponse[];
}

interface SimplifiedToolCall {
  id: string;
  name: string;
  args: any;
}

interface SimplifiedToolResponse {
  id: string;
  name: string;
  output: any;  // 可能被截断或摘要化
}

// LLM 上下文 - 经过优化
interface LLMContext {
  messages: LLMMessage[];
  systemPrompt?: string;
  maxTokens: number;
  
  // 上下文策略
  strategy: ContextStrategy;
}

type ContextStrategy = 
  | 'recent-only'      // 只保留最近 N 条
  | 'sliding-window'   // 滑动窗口
  | 'summary-based'    // 旧消息摘要化
  | 'semantic-search'; // 语义检索相关历史
```

#### 3.4 上下文管理器 (ContextManager)

```typescript
class ContextManager {
  private uiContext: UISessionContext | null = null;
  private llmContext: LLMContext | null = null;
  private contextWindow: number = 128000;  // 模型上下文窗口
  private maxMessages: number = 50;

  // 添加 UI 消息（用于显示）
  addUIMessage(message: UIMessage): void {
    if (!this.uiContext) {
      this.createUISession();
    }
    
    this.uiContext!.messages.push(message);
    this.uiContext!.updatedAt = Date.now();
    
    // 持久化 UI 上下文
    this.persistUISession(this.uiContext!);
  }

  // 生成 LLM 上下文（用于传给模型）
  generateLLMContext(strategy: ContextStrategy = 'sliding-window'): LLMContext {
    if (!this.uiContext) {
      throw new Error('No active session');
    }

    // 1. 转换 UI 消息为 LLM 消息
    let llmMessages = this.uiContext.messages.map(msg => 
      this.transformUIToLLM(msg)
    );

    // 2. 应用上下文策略
    llmMessages = this.applyContextStrategy(llmMessages, strategy);

    // 3. 确保不超过 token 限制
    llmMessages = this.truncateToTokenLimit(llmMessages);

    return {
      messages: llmMessages,
      maxTokens: this.contextWindow,
      strategy,
    };
  }

  // UI 消息转 LLM 消息
  private transformUIToLLM(uiMsg: UIMessage): LLMMessage {
    const llmMsg: LLMMessage = {
      role: uiMsg.role,
      content: uiMsg.content,
    };

    // 简化工具调用信息
    if (uiMsg.tools) {
      llmMsg.toolCalls = uiMsg.tools.map(tool => ({
        id: tool.id,
        name: tool.name,
        args: tool.args,
      }));
    }

    if (uiMsg.toolResults) {
      llmMsg.toolResponses = uiMsg.toolResults.map(result => ({
        id: result.id,
        name: result.name,
        output: this.summarizeToolOutput(result.output),  // 可能摘要化
      }));
    }

    return llmMsg;
  }

  // 工具输出摘要化（大输出截断或摘要）
  private summarizeToolOutput(output: any): any {
    const outputStr = JSON.stringify(output);
    
    // 如果超过 1000 字符，进行摘要
    if (outputStr.length > 1000) {
      return {
        type: 'truncated',
        summary: outputStr.substring(0, 800) + '...',
        originalLength: outputStr.length,
      };
    }
    
    return output;
  }

  // 应用上下文策略
  private applyContextStrategy(messages: LLMMessage[], strategy: ContextStrategy): LLMMessage[] {
    switch (strategy) {
      case 'recent-only':
        return messages.slice(-this.maxMessages);
        
      case 'sliding-window':
        return this.slidingWindow(messages);
        
      case 'summary-based':
        return this.summaryBased(messages);
        
      case 'semantic-search':
        return this.semanticSearch(messages);
        
      default:
        return messages;
    }
  }

  // 滑动窗口策略
  private slidingWindow(messages: LLMMessage[]): LLMMessage[] {
    const maxLen = this.maxMessages;
    
    // 保留第一条（通常是系统提示）+ 最近 N-1 条
    if (messages.length <= maxLen) {
      return messages;
    }
    
    const first = messages[0];
    const recent = messages.slice(-(maxLen - 1));
    
    return [first, ...recent];
  }

  // 基于摘要的策略
  private summaryBased(messages: LLMMessage[]): LLMMessage[] {
    const MAX_KEEP = 20;  // 保留最近 20 条
    
    if (messages.length <= MAX_KEEP) {
      return messages;
    }
    
    const kept = messages.slice(-MAX_KEEP);
    const oldMessages = messages.slice(0, -MAX_KEEP);
    
    // 生成旧消息的摘要
    const summary = this.generateMessagesSummary(oldMessages);
    
    // 在开头插入摘要消息
    const summaryMessage: LLMMessage = {
      role: 'system',
      content: `[Conversation History Summary]\n${summary}\n\n[Current Conversation]`,
    };
    
    return [summaryMessage, ...kept];
  }

  // 生成消息摘要（可使用小模型）
  private generateMessagesSummary(messages: LLMMessage[]): string {
    // 这里可以调用轻量级模型生成摘要
    return 'This is a summary of earlier conversation...';
  }

  // 截断到 token 限制
  private truncateToTokenLimit(messages: LLMMessage[]): LLMMessage[] {
    let totalTokens = 0;
    const result: LLMMessage[] = [];
    
    // 从后往前遍历，确保保留最新的消息
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      const msgTokens = this.estimateTokens(msg);
      
      if (totalTokens + msgTokens > this.contextWindow * 0.9) {
        break;
      }
      
      result.unshift(msg);
      totalTokens += msgTokens;
    }
    
    return result;
  }

  // 估算 token 数（简化版本）
  private estimateTokens(msg: LLMMessage): number {
    const content = msg.content + JSON.stringify(msg.toolCalls || '') + JSON.stringify(msg.toolResponses || '');
    return Math.ceil(content.length / 4);  // 简单估算：1 token ≈ 4 字符
  }

  // 持久化 UI 会话
  private async persistUISession(session: UISessionContext): Promise<void> {
    try {
      const key = `ui-session:${session.id}`;
      const data = JSON.stringify(session);
      
      if (isElectron()) {
        await saveEncrypted(key, data);
      } else {
        localStorage.setItem(key, data);
      }
    } catch (err) {
      console.error('Failed to persist UI session:', err);
    }
  }

  // 创建 UI 会话
  createUISession(): UISessionContext {
    const session: UISessionContext = {
      id: generateId(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
      currentTurn: 0,
      state: SessionState.IDLE,
      metadata: {},
    };
    this.uiContext = session;
    return session;
  }
}
```

#### 3.2 状态同步

```typescript
class StateSync {
  private state: Map<string, any> = new Map();
  private syncTimeout: NodeJS.Timeout | null = null;

  // 设置状态
  setState(key: string, value: any): void {
    this.state.set(key, value);
    this.scheduleSync();
  }

  // 获取状态
  getState(key: string): any {
    return this.state.get(key);
  }

  // 批量同步
  private scheduleSync(): void {
    if (this.syncTimeout) {
      clearTimeout(this.syncTimeout);
    }
    
    this.syncTimeout = setTimeout(() => {
      this.sync();
    }, 100); // 100ms 防抖
  }

  // 同步到渲染进程
  private async sync(): Promise<void> {
    const snapshot = Object.fromEntries(this.state);
    // 通过 IPC 发送到渲染进程
    sendToRenderer('state:sync', snapshot);
  }
}
```

### 4. 异常处理层

#### 4.1 错误分类

```typescript
enum ErrorCode {
  // 系统错误
  SYSTEM_ERROR = 'system_error',
  PROCESS_CRASH = 'process_crash',
  TIMEOUT = 'timeout',
  
  // 网络错误
  NETWORK_ERROR = 'network_error',
  CONNECTION_LOST = 'connection_lost',
  
  // 协议错误
  INVALID_REQUEST = 'invalid_request',
  INVALID_RESPONSE = 'invalid_response',
  
  // 业务错误
  AGENT_ERROR = 'agent_error',
  TOOL_ERROR = 'tool_error',
}

class ErrorClassifier {
  static classify(error: Error | any): ErrorInfo {
    let code = ErrorCode.SYSTEM_ERROR;
    let retryable = false;

    // 判断错误类型
    if (error.message?.includes('timeout')) {
      code = ErrorCode.TIMEOUT;
      retryable = true;
    } else if (error.message?.includes('network') || 
               error.message?.includes('connect')) {
      code = ErrorCode.NETWORK_ERROR;
      retryable = true;
    } else if (error.message?.includes('tool')) {
      code = ErrorCode.TOOL_ERROR;
    } else if (error.message?.includes('agent')) {
      code = ErrorCode.AGENT_ERROR;
    }

    return {
      code,
      message: error.message || 'Unknown error',
      details: error,
      stack: error.stack,
      retryable,
    };
  }
}
```

#### 4.2 恢复策略

```typescript
class RecoveryManager {
  // 恢复策略
  async tryRecover(error: ErrorInfo, context: RecoveryContext): Promise<boolean> {
    const strategy = this.getStrategy(error.code);
    
    if (!strategy) {
      console.warn('No recovery strategy for error:', error.code);
      return false;
    }

    try {
      const success = await strategy.execute(context);
      if (success) {
        console.log('Recovery successful for error:', error.code);
      }
      return success;
    } catch (recoveryError) {
      console.error('Recovery failed:', recoveryError);
      return false;
    }
  }

  private getStrategy(code: ErrorCode): RecoveryStrategy | null {
    switch (code) {
      case ErrorCode.PROCESS_CRASH:
        return new ProcessRestartStrategy();
      case ErrorCode.CONNECTION_LOST:
      case ErrorCode.NETWORK_ERROR:
        return new ReconnectStrategy();
      case ErrorCode.TIMEOUT:
        return new RetryStrategy();
      default:
        return null;
    }
  }
}

interface RecoveryStrategy {
  execute(context: RecoveryContext): Promise<boolean>;
}

class ProcessRestartStrategy implements RecoveryStrategy {
  async execute(context: RecoveryContext): Promise<boolean> {
    console.log('Attempting to restart agent process...');
    
    try {
      // 停止现有进程
      await cleanupAgentProcess();
      
      // 等待一下
      await sleep(1000);
      
      // 重新启动
      await initChatSession();
      
      console.log('Agent process restarted successfully');
      return true;
    } catch (err) {
      console.error('Failed to restart agent process:', err);
      return false;
    }
  }
}

class ReconnectStrategy implements RecoveryStrategy {
  async execute(context: RecoveryContext): Promise<boolean> {
    console.log('Attempting to reconnect...');
    
    const maxAttempts = 5;
    let attempts = 0;
    
    while (attempts < maxAttempts) {
      try {
        // 发送 ping
        await requestManager.request('ping', {});
        console.log('Reconnected successfully');
        return true;
      } catch (err) {
        attempts++;
        console.log(`Reconnection attempt ${attempts}/${maxAttempts} failed`);
        await sleep(1000 * attempts); // 指数退避
      }
    }
    
    return false;
  }
}

class RetryStrategy implements RecoveryStrategy {
  async execute(context: RecoveryContext): Promise<boolean> {
    console.log('Retrying last operation...');
    
    if (!context.lastRequest) {
      console.warn('No last request to retry');
      return false;
    }
    
    try {
      const result = await requestManager.request(
        context.lastRequest.method,
        context.lastRequest.payload,
        { timeout: context.lastRequest.timeout }
      );
      
      console.log('Retry successful');
      return true;
    } catch (err) {
      console.error('Retry failed:', err);
      return false;
    }
  }
}
```

### 5. 监控和指标层

#### 5.1 指标收集

```typescript
class MetricsCollector {
  private metrics: Metrics = {
    messages: {
      sent: 0,
      received: 0,
      failed: 0,
    },
    latency: [],
    errors: new Map(),
    sessionDuration: null,
    startTime: Date.now(),
  };

  // 记录消息发送
  recordMessageSent(): void {
    this.metrics.messages.sent++;
  }

  // 记录消息接收
  recordMessageReceived(latency: number): void {
    this.metrics.messages.received++;
    this.metrics.latency.push(latency);
    
    // 保留最近 1000 个延迟数据
    if (this.metrics.latency.length > 1000) {
      this.metrics.latency.shift();
    }
  }

  // 记录错误
  recordError(code: ErrorCode, details: any): void {
    this.metrics.messages.failed++;
    const count = this.metrics.errors.get(code) || 0;
    this.metrics.errors.set(code, count + 1);
    
    // 发送到监控系统
    this.emitMetric('error', { code, count: count + 1 });
  }

  // 获取统计信息
  getStats(): MetricsSnapshot {
    const avgLatency = this.metrics.latency.length > 0
      ? this.metrics.latency.reduce((a, b) => a + b, 0) / this.metrics.latency.length
      : 0;
    
    const p95Latency = this.calculatePercentile(95);
    
    return {
      messages: { ...this.metrics.messages },
      latency: {
        average: Math.round(avgLatency),
        p95: Math.round(p95Latency),
        max: Math.max(...this.metrics.latency, 0),
      },
      errors: Object.fromEntries(this.metrics.errors),
      uptime: Date.now() - this.metrics.startTime,
    };
  }

  private calculatePercentile(percentile: number): number {
    if (this.metrics.latency.length === 0) return 0;
    
    const sorted = [...this.metrics.latency].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[index] || 0;
  }

  private emitMetric(name: string, data: any): void {
    // 可以在这里集成 Prometheus、Datadog 等监控系统
    console.debug(`[Metric] ${name}:`, data);
  }
}
```

---

## 🔄 完整数据流

### 用户发送消息流程（包含上下文管理）

```typescript
┌─────────────────────────────────────────────────────────────────┐
│  阶段 1: 用户输入（渲染进程）                                    │
└─────────────────────────────────────────────────────────────────┘
    ↓
1. 用户点击发送
    ↓
2. chatStore.sendMessage()
    ├─ 创建 UIMessage（用户消息）
    ├─ 添加到 Zustand 状态
    └─ 触发 UI 重渲染（显示用户输入）
    ↓
3. 通过 electron.agentSendMessage() 发送
    ↓

┌─────────────────────────────────────────────────────────────────┐
│  阶段 2: 主进程处理                                              │
└─────────────────────────────────────────────────────────────────┘
    ↓
4. IPC 转发到主进程
    ↓
5. ContextManager.addUIMessage()
    ├─ 将用户消息添加到 UISessionContext
    └─ 持久化到本地存储
    ↓
6. RequestManager 包装请求
    ├─ 生成 requestId
    ├─ 创建 RequestMessage
    ├─ 添加到消息队列
    └─ 发送到 AgentLoop 进程
    ↓

┌─────────────────────────────────────────────────────────────────┐
│  阶段 3: AgentLoop 处理（子进程）                                │
└─────────────────────────────────────────────────────────────────┘
    ↓
7. AgentBridge 接收请求
    ↓
8. ContextManager.generateLLMContext()
    ├─ 获取 UISessionContext（完整历史）
    ├─ 转换为 LLMMessage（精简版本）
    ├─ 应用上下文策略（sliding-window）
    ├─ 截断到 token 限制
    └─ 返回 LLMContext
    ↓
9. 调用 LLM 生成响应
    ├─ 传入 LLMContext
    ├─ 接收流式响应
    └─ 触发各种事件
    ↓

┌─────────────────────────────────────────────────────────────────┐
│  阶段 4: 流式响应返回                                            │
└─────────────────────────────────────────────────────────────────┘
    ↓
10. 流式事件通过 IPC 发送回渲染进程
    ├─ onAgentText - 流式文本 → 更新 UI 显示
    ├─ onAgentThinking - 思考过程 → 显示思考
    ├─ onAgentToolStart - 工具开始 → 显示工具调用状态
    ├─ onAgentToolEnd - 工具结束 → 显示工具结果
    └─ onAgentEnd - 完成 → 标记消息完成
    ↓
11. chatStore 逐步更新状态
    ├─ 更新 streamingText
    ├─ 更新 tools 状态
    └─ 实时重渲染 UI
    ↓

┌─────────────────────────────────────────────────────────────────┐
│  阶段 5: 完成后处理                                              │
└─────────────────────────────────────────────────────────────────┘
    ↓
12. 消息完成后
    ├─ 创建完整的 UIMessage（包含所有元数据）
    ├─ ContextManager.addUIMessage() → 持久化
    └─ MetricsCollector 记录指标
    ↓
13. 状态同步到渲染进程
    └─ UI 显示完整的新消息
```

### 异常恢复流程

```typescript
// 1. 检测到异常
//    ├─ 进程崩溃
//    ├─ 连接断开
//    ├─ 超时
//    └─ 其他错误
//    ↓
// 2. ErrorClassifier 分类
//    ↓
// 3. RecoveryManager 获取策略
//    ↓
// 4. 执行恢复策略
//    ├─ 重启进程
//    ├─ 重连
//    └─ 重试
//    ↓
// 5. 恢复成功？
//    ├─ Yes → 继续执行
//    └─ No → 提示用户
//    ↓
// 6. 状态同步
//    └─ 恢复会话上下文
```

---

## 📁 目录结构

```
desktop/
├── main/
│   ├── agent/
│   │   ├── index.ts                # 保持兼容 (现有)
│   │   ├── bridge.ts               # Agent 通信桥接
│   │   └── agent-bridge.ts         # 子进程桥接 (现有)
│   ├── communication/
│   │   ├── index.ts                # 通信模块入口
│   │   ├── message-queue.ts        # 消息队列
│   │   ├── request-manager.ts      # 请求管理器
│   │   ├── ack-manager.ts          # 确认和重传
│   │   └── protocol.ts             # 协议定义
│   ├── session/
│   │   ├── index.ts
│   │   ├── session-manager.ts      # 会话管理
│   │   └── state-sync.ts           # 状态同步
│   ├── error/
│   │   ├── index.ts
│   │   ├── classifier.ts           # 错误分类
│   │   ├── recovery-manager.ts     # 恢复管理
│   │   └── strategies.ts           # 恢复策略
│   ├── metrics/
│   │   ├── index.ts
│   │   └── collector.ts            # 指标收集
│   └── ipc/
│       ├── agent.ts                # 保持兼容 (增强)
│       └── communication.ts        # 通信相关 IPC
├── renderer/
│   ├── stores/
│   │   ├── chat-store.ts           # 保持兼容 (增强)
│   │   ├── agent-store.ts          # Agent 状态
│   │   └── communication-store.ts  # 通信状态
│   └── hooks/
│       ├── use-agent.ts            # Agent Hook
│       ├── use-session.ts          # 会话 Hook
│       └── use-metrics.ts          # 指标 Hook
└── docs/
    └── agent-communication-architecture-v2.md  # 本文档
```

---

## 🔧 集成方案

### 阶段 1: 核心消息层 (Week 1-2)

1. 创建 `message-queue.ts`
2. 创建 `request-manager.ts`
3. 定义消息协议 `protocol.ts`
4. 修改现有 `agent.ts` 使用新的请求管理
5. 添加基础的错误分类

### 阶段 2: 会话和状态管理 (Week 3)

1. 创建 `session-manager.ts`
2. 创建 `state-sync.ts`
3. 集成会话持久化
4. 增强 chatStore 支持新的会话 API

### 阶段 3: 异常处理和恢复 (Week 4)

1. 创建 `recovery-manager.ts`
2. 实现恢复策略
3. 集成进程重启机制
4. 添加自动重连逻辑

### 阶段 4: 监控和优化 (Week 5)

1. 创建 `metrics-collector.ts`
2. 添加性能指标
3. 实现健康检查
4. 添加调试工具

---

## ✨ 特性亮点

### 1. 可靠消息传递
- 请求/响应模式
- 消息确认机制
- 自动重传
- 超时处理

### 2. 智能恢复
- 进程崩溃自动重启
- 网络波动自动重连
- 幂等性设计
- 状态恢复

### 3. 完整监控
- 消息吞吐量统计
- 延迟分布
- 错误率监控
- 健康检查

### 4. 优雅降级
- 网络降级为离线模式
- 工具失败提供备选方案
- 超时提供进度反馈

---

## 📊 对比分析

| 特性 | 现有架构 | 新架构 |
|-----|---------|--------|
| 消息确认 | ❌ | ✅ |
| 自动重传 | ❌ | ✅ |
| 超时处理 | 基础 | 完善 |
| 会话持久化 | 部分 | 完整 |
| 状态同步 | 被动 | 主动 |
| 异常恢复 | 手动 | 自动 |
| 监控指标 | 有限 | 丰富 |
| 可扩展性 | 低 | 高 |

---

## 🎯 预期收益

1. **可靠性提升 80%** - 通过消息确认和重传
2. **用户体验改善** - 更好的错误提示和恢复
3. **开发效率提升** - 统一的错误处理模式
4. **可维护性改善** - 清晰的模块划分
5. **调试能力增强** - 丰富的指标和日志

---

## 📝 注意事项

1. **向后兼容** - 保持现有 API 不变，逐步迁移
2. **渐进式实施** - 分阶段上线，降低风险
3. **充分测试** - 重点测试异常场景
4. **文档完善** - 记录设计决策和使用方式
5. **监控预警** - 上线后持续观察指标

---

## 📞 参考

- Electron IPC 文档
- React Zustand 最佳实践
- 分布式系统设计模式
- 消息队列设计原理

---

**文档版本**: 2.0  
**最后更新**: 2026-04-19  
**作者**: Xuanji Team
