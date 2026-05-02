import { eventBus } from '@/core/events/EventBus';
import { XuanjiEvent } from '@/core/events/events';

export class ResponseDispatcher {
  dispatchText(text: string): void {
    eventBus.emit(XuanjiEvent.AGENT_TEXT_DELTA, { text });
  }

  dispatchThinking(thinking: string): void {
    eventBus.emit(XuanjiEvent.AGENT_THINKING_DELTA, { thinking });
  }

  dispatchToolStart(tool: { id: string; name: string; input: Record<string, unknown> }): void {
    eventBus.emit(XuanjiEvent.AGENT_TOOL_START, tool);
  }

  dispatchToolEnd(result: { id: string; name: string; output: string; isError: boolean }): void {
    eventBus.emit(XuanjiEvent.AGENT_TOOL_END, result);
  }

  dispatchError(error: Error): void {
    eventBus.emit(XuanjiEvent.AGENT_ERROR, { error: error.message });
  }
}
