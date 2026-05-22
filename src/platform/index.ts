/**
 * 平台消息接入模块 — 主导出
 *
 * 使用方式：
 *
 *   import { PlatformRouter, buildSessionKey } from '@/platform';
 *
 *   const router = new PlatformRouter(db);
 *   router.setAgent(agentGateway);
 *   router.configure(config);
 *   router.registerAdapter(feishuAdapter);
 *   router.registerAdapter(wecomAdapter);
 *   await router.start();
 */

export { PlatformRouter } from './PlatformRouter.js';
export { SessionRouter, buildSessionKey, parseSessionKey } from './SessionRouter.js';
export { CredentialManager } from './auth/CredentialManager.js';
export { PersistentMessageQueue, AgentWorkerPool } from './MessageQueue.js';
export type { WorkerReplyHandler } from './MessageQueue.js';
export { PlatformCircuitBreaker } from './PlatformCircuitBreaker.js';
export { WebhookServer, webhookOk, webhookError } from './http/WebhookServer.js';
export type { WebhookHandler, WebhookRequest, WebhookResponse } from './http/WebhookServer.js';
export { WecomAdapter } from './adapters/WecomAdapter.js';
export { FeishuAdapter } from './adapters/FeishuAdapter.js';
export { DingTalkAdapter } from './adapters/DingTalkAdapter.js';
export { WechatAdapter } from './adapters/WechatAdapter.js';
export type {
  PlatformMessage,
  Attachment,
  PlatformReply,
  PlatformAdapter,
  PlatformConfig,
  FeishuConfig,
  DingTalkConfig,
  WecomConfig,
  WechatConfig,
  PlatformsConfig,
  RemoteSession,
  AgentReply,
  AgentGateway,
  PlatformHealth,
} from './types.js';
