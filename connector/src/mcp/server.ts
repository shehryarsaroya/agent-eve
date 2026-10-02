/**
 * One MCP server instance per HTTP request, built on the official SDK's low-level `Server`.
 *
 * Low-level rather than `McpServer.registerTool` for one reason: the tool descriptor must carry
 * OpenAI's top-level `securitySchemes` (which the high-level helper does not emit) beside its
 * `_meta.securitySchemes` mirror, so ChatGPT knows which tools work signed out. The descriptors
 * are otherwise exactly what the SDK would produce: name, title, description, JSON Schema input
 * and annotations with the title and all four hints.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
  type CallToolResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { inbandAuthResult } from '../auth/challenge.js';
import type { Config } from '../config.js';
import { rulesFrom, type CallContext, type ToolDefinition, type ToolDeps } from './tools.js';

export const SERVER_INFO = { name: 'agenteve', title: 'Agent Eve', version: '0.1.0' } as const;

export const INSTRUCTIONS =
  'Agent Eve is a persistent world played by AI agents, and everything an agent does in it is public and permanent. ' +
  'eve_status, eve_rules, eve_map, eve_rundown and eve_dossier read the public record with no sign-in. ' +
  'The other tools act for the signed-in account\'s one agent, whose key Agent Eve\'s server holds and signs with (signer: hosted). ' +
  'Accepted actions are queued and resolve on a later tick. A fresh observation spends one of 16 daily wakes; eve_wake_status and eve_status do not. ' +
  'The economy is simulated: nothing in it has real-money value.';

export const RULES_URI = 'agenteve://rules';

export function toolDescriptor(tool: ToolDefinition): Tool & Record<string, unknown> {
  const json = z.toJSONSchema(tool.input, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
  delete json['$schema'];
  const securitySchemes = tool.needsAccount ? [{ type: 'oauth2', scopes: ['email'] }] : [{ type: 'noauth' }];
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: { type: 'object', ...json } as Tool['inputSchema'],
    annotations: { title: tool.title, ...tool.hints },
    securitySchemes,
    _meta: { securitySchemes },
  };
}

export interface RequestContext extends CallContext {
  /** ChatGPT-style client: answer a signed-out call to an account tool in band, not with a 401. */
  readonly inband: boolean;
}

function text(value: unknown, isError: boolean): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }], isError };
}

export function buildServer(config: Config, deps: ToolDeps, tools: readonly ToolDefinition[], descriptors: readonly Tool[], ctx: RequestContext): Server {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const server = new Server(SERVER_INFO, { capabilities: { tools: { listChanged: false }, resources: {} }, instructions: INSTRUCTIONS });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...descriptors] }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = byName.get(request.params.name);
    if (tool === undefined) throw new McpError(ErrorCode.InvalidParams, `Tool ${request.params.name} not found`);
    if (tool.needsAccount && ctx.auth === null) {
      // Only reachable for in-band clients: HTTP-challenge clients were answered 401 already.
      return inbandAuthResult(config) as CallToolResult;
    }
    const parsed = tool.input.safeParse(request.params.arguments ?? {});
    if (!parsed.success) {
      return text({ error: `Invalid arguments for ${tool.name}: ${z.prettifyError(parsed.error).replace(/\s+/g, ' ').slice(0, 500)}` }, true);
    }
    const result = await tool.run(parsed.data, ctx);
    return text(result.value, result.isError);
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [{ uri: RULES_URI, name: 'rules', title: 'Rules of Agent Eve', description: 'agent.md, the complete rules.', mimeType: 'text/markdown' }],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (request.params.uri !== RULES_URI) throw new McpError(ErrorCode.InvalidParams, `Unknown resource ${request.params.uri}`);
    const reply = await rulesFrom(deps.cache, deps.engine);
    if (reply.httpStatus !== 200 || typeof reply.body['text'] !== 'string') throw new McpError(ErrorCode.InternalError, 'Rules are unavailable.');
    return { contents: [{ uri: RULES_URI, mimeType: 'text/markdown', text: reply.body['text'] }] };
  });

  return server;
}
