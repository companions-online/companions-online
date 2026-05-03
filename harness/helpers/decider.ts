import type { ChatMessage, TokenUsage } from './openrouter.js';
import { OpenRouterClient } from './openrouter.js';
import type { OpenAITool } from './dispatcher.js';

export interface DecideInput {
  messages: ChatMessage[];
  tools: OpenAITool[];
}

export interface DecideResult {
  message: ChatMessage;
  usage?: TokenUsage;
}

export interface Decider {
  decide(input: DecideInput): Promise<DecideResult>;
}

export class OpenRouterDecider implements Decider {
  constructor(private readonly client: OpenRouterClient, private readonly modelBody: Record<string, unknown>) {}

  async decide({ messages, tools }: DecideInput): Promise<DecideResult> {
    const resp = await this.client.chat({
      ...this.modelBody,
      model: this.modelBody.model as string,
      messages,
      tools,
      // After the spread so a stray `usage` in the model JSON can't shadow it.
      usage: { include: true },
    });
    const choice = resp.choices?.[0];
    if (!choice) throw new Error('OpenRouter returned no choices');
    return { message: choice.message, usage: resp.usage };
  }
}
