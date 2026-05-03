import type { OpenAITool, ToolCall } from './dispatcher.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
  reasoning?: string;
  reasoning_details?: unknown;
}

export interface ChatChoice {
  message: ChatMessage;
  finish_reason?: string;
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  /** USD spent on this call. Populated when the request body sets `usage: { include: true }`; not all providers report it. */
  cost?: number;
}

export interface ChatResponse {
  id?: string;
  choices: ChatChoice[];
  usage?: TokenUsage;
}

export interface OpenRouterClientOpts {
  apiKey: string;
  baseUrl?: string;
}

export class OpenRouterClient {
  private readonly baseUrl: string;
  constructor(private readonly opts: OpenRouterClientOpts) {
    this.baseUrl = opts.baseUrl ?? 'https://openrouter.ai/api/v1';
  }

  async chat(body: {
    model: string;
    messages: ChatMessage[];
    tools?: OpenAITool[];
    [k: string]: unknown;
  }): Promise<ChatResponse> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.opts.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`OpenRouter ${res.status}: ${text}`);
    }
    return await res.json() as ChatResponse;
  }
}
