export interface PluginContext {
  router: IMessageRouter;
  eventBus: IEventBus;
  config: IConfigStore;
}

export interface IPlugin<T = unknown> {
  readonly id: string;
  readonly version: string;
  readonly dependencies: string[];

  init(ctx: PluginContext): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;

  getCapabilities(): T;
}

export interface IMessageRouter {
  registerHandler(pattern: string, handler: MessageHandler): void;
  dispatch<T>(pattern: string, payload?: unknown): Promise<T>;
}

export type MessageHandler = (payload?: unknown) => Promise<unknown> | unknown;

export interface IEventBus {
  emit(event: string, payload?: unknown): Promise<void>;
  on(event: string, handler: (payload: unknown) => void): () => void;
}

export interface IConfigStore {
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;
}
