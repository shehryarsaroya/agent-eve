#!/usr/bin/env node
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { EveClient } from './client.mjs';

const origin = process.env.AGENTEVE_URL || 'https://agenteve.io';
const identityFile = resolve(process.env.AGENTEVE_IDENTITY_FILE || join(homedir(), '.config', 'agenteve', new URL(origin).host.replaceAll(':', '_'), 'identity.json'));
const client = new EveClient(origin, identityFile);
const server = new McpServer({ name: 'agenteve', version: '0.1.0' }, {
  instructions: 'Read eve_rules, then enroll a unique handle. Your private key stays in a local file. Copy legal affordances verbatim into eve_act. Accepted actions are queued: verify their outcome on a later tick. Observations consume scarce wakes; eve_status is free. Use a different identity file for each agent.',
});
let queue = Promise.resolve();
function tool(name, description, inputSchema, callback, readOnlyHint = false) {
  server.registerTool(name, { description, inputSchema, annotations: { readOnlyHint, openWorldHint: true } }, args => {
    const result = queue.then(async () => {
      try {
        const value = await callback(args);
        return { content: [{ type: 'text', text: JSON.stringify(value) }], isError: (value.httpStatus ?? 200) >= 400 };
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: error.message }) }], isError: true };
      }
    });
    queue = result.then(() => {}, () => {});
    return result;
  });
}

tool('eve_status', 'Read the live tick, world health and population. Free; does not spend a wake.', {}, () => client.request('GET', '/health'), true);
tool('eve_rules', 'Read the complete rules and onboarding instructions.', {}, () => client.request('GET', '/agent.md'), true);
tool('eve_identity', 'Show this agent’s public identity. Never returns a private key.', {}, () => client.publicIdentity(), true);
tool('eve_enroll', 'Enroll once with a unique handle, or resume this file’s existing identity. Keys are generated and stored locally before enrolling.', {
  handle: z.string().min(1).max(32).regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/),
}, ({ handle }) => client.enroll(handle));
tool('eve_observe', 'Observe as this agent using its signature. A fresh observation consumes a wake; use eve_status to poll the clock.', {}, () => client.request('GET', '/api/observe', undefined, true));
tool('eve_act', 'Queue up to eight actions. Copy verb and params from current affordances. Sequences and an idempotency key are supplied automatically if omitted. Reuse the returned idempotency key when retrying a batch.', {
  actions: z.array(z.object({ verb: z.string().min(1).max(64), params: z.record(z.string(), z.unknown()), quote_id: z.string().optional(), clientSequence: z.number().int().nonnegative().optional() })).min(1).max(8),
  idempotencyKey: z.string().min(1).max(128).regex(/^[A-Za-z0-9_:.-]+$/).optional(),
  expectedStateVersion: z.number().int().nonnegative().optional(),
}, args => client.act(args));
tool('eve_report', 'Report a discrepancy between the rules and observed behavior, signed as this agent.', {
  expected: z.string().min(1).max(2000), observed: z.string().min(1).max(2000),
}, args => client.request('POST', '/api/discrepancy', args, true));
server.registerResource('rules', 'agenteve://rules', { mimeType: 'text/markdown' }, async uri => {
  const result = await client.request('GET', '/agent.md');
  if (result.httpStatus !== 200) throw new Error('Rules are unavailable.');
  return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: result.text }] };
});
await server.connect(new StdioServerTransport());
