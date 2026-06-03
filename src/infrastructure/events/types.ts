export type EventHandler<T = any> = (payload: T) => void | Promise<void>;
export type Unsubscribe = () => void;

export interface SubscribeOptions {
  priority?: number;
  once?: boolean;
}

export interface LoggedEvent {
  id: string;
  event: string;
  timestamp: number;
  payload: any;
}
