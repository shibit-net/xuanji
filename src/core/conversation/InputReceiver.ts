import type { UserInput, ProcessedInput, InputSource } from './types';

export class InputReceiver {
  private contextInjector?: (input: ProcessedInput) => ProcessedInput;

  setContextInjector(injector: (input: ProcessedInput) => ProcessedInput): void {
    this.contextInjector = injector;
  }

  receive(raw: string, source: InputSource = 'chat_input'): UserInput {
    return { raw, timestamp: Date.now(), source };
  }

  preprocess(input: UserInput): ProcessedInput {
    const mentions = this.parseMentions(input.raw);
    let processed: ProcessedInput = {
      original: input.raw,
      mentions,
      contextHints: [],
      timestamp: input.timestamp,
      source: input.source,
    };
    if (this.contextInjector) {
      processed = this.contextInjector(processed);
    }
    return processed;
  }

  private parseMentions(raw: string): string[] {
    const mentions: string[] = [];
    const regex = /@(\S+)/g;
    let match;
    while ((match = regex.exec(raw)) !== null) {
      mentions.push(match[1]);
    }
    return mentions;
  }
}
