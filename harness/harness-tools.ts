import type { MemoryFile } from './memory-file.js';

export interface HarnessToolResult {
  text: string;
  raw?: unknown;
  isError?: boolean;
}

export interface HarnessTool {
  name: string;
  description?: string;
  parameters: unknown;
  handler: (args: Record<string, unknown>) => Promise<HarnessToolResult>;
}

export function buildHarnessTools(memory: MemoryFile): HarnessTool[] {
  return [
    {
      name: 'memory_update',
      description:
        'Replace your entire session memory with the provided content. The memory block is injected into your next prompt verbatim, so use it to record anything you need to remember across turns (goals, notes, facts about the world). Markdown is recommended.',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'New full memory content (markdown).' },
        },
        required: ['content'],
        additionalProperties: false,
      },
      handler: async (args) => {
        const content = typeof args.content === 'string' ? args.content : '';
        memory.update(content);
        return { text: `memory updated (${content.length} chars)` };
      },
    },
  ];
}
