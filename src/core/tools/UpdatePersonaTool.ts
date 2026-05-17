/**
 * UpdatePersonaTool — 保存机器人拟人化配置
 *
 * 在 onboarding 对话中，AI 通过此工具将用户的偏好写入全局配置。
 * 同时将 onboardingDone 标记为 true。
 */

import type { Tool, ToolResult } from '@/core/types';
import type { PersonaConfig } from '@/shared/types/config';

export interface UpdatePersonaInput {
  name?: string;
  userNickname?: string;
  personality?: string[];
  talkStyle?: 'formal' | 'casual' | 'cute' | 'cool' | 'balanced';
  customDescription?: string;
}

export class UpdatePersonaTool implements Tool {
  name = 'update_persona';
  description = 'Save the bot persona configuration based on user preferences. Call this after the user expresses their preferences during onboarding, or when they want to update the persona. This also marks onboarding as complete.';

  input_schema = {
    type: 'object' as const,
    properties: {
      name: {
        type: 'string',
        description: 'The name the user wants to call the bot (e.g. 小玑, 璇玑)',
      },
      userNickname: {
        type: 'string',
        description: 'How the bot should address the user (e.g. 主人, 老板, their actual name)',
      },
      personality: {
        type: 'array',
        items: { type: 'string', enum: ['warm', 'humorous', 'serious', 'gentle', 'energetic', 'calm'] },
        description: 'Personality traits selected by the user',
      },
      talkStyle: {
        type: 'string',
        enum: ['formal', 'casual', 'cute', 'cool', 'balanced'],
        description: 'The preferred talking style',
      },
      customDescription: {
        type: 'string',
        description: 'Any additional persona description the user provided',
      },
    },
  };

  private onUpdate: ((persona: PersonaConfig) => Promise<void>) | null = null;

  constructor(onUpdate?: (persona: PersonaConfig) => Promise<void>) {
    if (onUpdate) this.onUpdate = onUpdate;
  }

  setOnUpdate(callback: (persona: PersonaConfig) => Promise<void>): void {
    this.onUpdate = callback;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    try {
      const typed = input as UpdatePersonaInput;
      const persona: PersonaConfig = {};
      if (typed.name) persona.name = typed.name;
      if (typed.userNickname) persona.userNickname = typed.userNickname;
      if (typed.personality?.length) persona.personality = typed.personality as PersonaConfig['personality'];
      if (typed.talkStyle) persona.talkStyle = typed.talkStyle;
      if (typed.customDescription) persona.customDescription = typed.customDescription;

      if (!this.onUpdate) {
        return {
          content: 'Persona update callback not configured. Please restart the session.',
          isError: true,
        };
      }
      await this.onUpdate(persona);

      return {
        content: 'Persona configuration saved successfully.',
        isError: false,
      };
    } catch (err) {
      return {
        content: `Failed to save persona: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  }
}
