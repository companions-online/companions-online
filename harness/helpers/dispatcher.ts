import type { McpTool, ReconnectingMcpClient } from './mcp-client.js';
import type { HarnessTool } from './harness-tools.js';

export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: unknown;
  };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/**
 * Flatten MCP content blocks into a single string for a `role: "tool"` message.
 * Text blocks are concatenated; non-text blocks are JSON-stringified with a tag.
 */
export function flattenMcpContent(content: unknown[]): string {
  const parts: string[] = [];
  for (const block of content) {
    const b = block as { type?: string; text?: string };
    if (b?.type === 'text' && typeof b.text === 'string') parts.push(b.text);
    else parts.push(`[${b?.type ?? 'unknown'}] ${JSON.stringify(block)}`);
  }
  return parts.join('\n');
}

/**
 * Translate an MCP tool's inputSchema into an OpenAI-compatible tool entry.
 * MCP inputSchema is already JSON Schema, so we pass it through.
 */
export function mcpToOpenAI(tool: McpTool): OpenAITool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema ?? { type: 'object', properties: {} },
    },
  };
}

export function harnessToOpenAI(tool: HarnessTool): OpenAITool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

export interface DispatchResult {
  text: string;
  raw: unknown;
  isError?: boolean;
  kind: 'mcp' | 'harness';
}

export interface ToolDispatcher {
  buildOpenAITools(): OpenAITool[];
  dispatch(call: ToolCall): Promise<DispatchResult>;
}

export function createDispatcher(
  mcp: ReconnectingMcpClient,
  harnessTools: HarnessTool[],
): ToolDispatcher {
  const harnessByName = new Map(harnessTools.map(t => [t.name, t]));
  return {
    buildOpenAITools() {
      const out: OpenAITool[] = harnessTools.map(harnessToOpenAI);
      for (const t of mcp.getTools()) out.push(mcpToOpenAI(t));
      return out;
    },
    async dispatch(call) {
      let args: Record<string, unknown> = {};
      try { args = call.function.arguments ? JSON.parse(call.function.arguments) : {}; }
      catch { /* leave empty */ }

      const harnessTool = harnessByName.get(call.function.name);
      if (harnessTool) {
        const r = await harnessTool.handler(args);
        return { text: r.text, raw: r.raw ?? r.text, isError: r.isError, kind: 'harness' };
      }
      const r = await mcp.callTool(call.function.name, args);
      return { text: flattenMcpContent(r.content), raw: r.content, isError: r.isError, kind: 'mcp' };
    },
  };
}
