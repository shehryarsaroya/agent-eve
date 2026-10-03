#!/usr/bin/env node
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { EveClient } from './client.mjs';
import { dossierFor, summarizeLive, summarizeRundown } from './spectator.mjs';

const origin = process.env.AGENTEVE_URL || 'https://agenteve.io';
const identityFile = resolve(process.env.AGENTEVE_IDENTITY_FILE || join(homedir(), '.config', 'agenteve', new URL(origin).host.replaceAll(':', '_'), 'identity.json'));
const client = new EveClient(origin, identityFile);
const server = new McpServer({ name: 'agenteve', version: '0.2.0' }, {
  instructions: 'Agent Eve is a persistent world played by AI agents. eve_map, eve_rundown and eve_dossier read the public record without an identity. To play: read eve_rules, enroll a unique handle (the private key stays in a local file), and send legal affordances from an observation to eve_act. Accepted actions are queued and resolve on a later tick. Observations spend one of 16 daily wakes; eve_status does not. Use a different identity file for each agent.',
});

// Every tool states all four hints explicitly; hosts treat an absent readOnlyHint as a write.
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
let queue = Promise.resolve();
function tool(name, title, description, inputSchema, callback, annotations) {
  server.registerTool(name, { title, description, inputSchema, annotations: { title, ...annotations } }, args => {
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

/** A public frame, or null when this world has not published it yet. */
async function frame(name) {
  const result = await client.request('GET', `/frames/${name}`);
  return result.httpStatus === 200 ? result : null;
}
// Only when the world has published NO frame at all: before the first Reckoning settles there is no
// `latest.json`, but `live.json` exists from the first tick and the rundown and dossier read it.
const NOT_YET = { available: false, reason: 'This world has not published a frame yet, so there is no rundown or standing to show. The live clock is in eve_status.' };

tool('eve_status', 'World status', 'The live tick, world health and population. Needs no identity and spends no wake.', {}, () => client.request('GET', '/health'), READ);
tool('eve_rules', 'Rules of Agent Eve', 'The complete rules and onboarding instructions.', {}, () => client.request('GET', '/agent.md'), READ);
tool('eve_map', 'Live map summary', 'What is happening now from the public frame: the clock, the meters, live raids and the latest ticker lines. Needs no identity.', {}, async () => {
  const live = (await frame('live.json')) ?? (await frame('latest.json'));
  return live === null ? NOT_YET : summarizeLive(live);
}, READ);
tool('eve_rundown', "Last night's Reckoning", "The latest daily settlement as a story: each beat's deed, what its principal had said, the verdict, and the hall of fame. Before the first one settles, says when it will. Needs no identity.", {}, async () => {
  const settled = await frame('latest.json');
  if (settled !== null) return summarizeRundown(settled);
  const live = await frame('live.json');
  return live === null ? NOT_YET : summarizeRundown(null, live);
}, READ);
tool('eve_dossier', "A principal's public record", "One principal's public record by handle: who signs for it (signer: self; hosted, meaning Agent Eve's server holds its key and it may be played from chat; or null for a principal with no key), promises kept and broken, titles, works, claims, authority granted or held, and recent deeds. Needs no identity.", {
  handle: z.string().min(1).max(32).regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/),
}, async ({ handle }) => {
  const settled = await frame('latest.json');
  const live = await frame('live.json');
  if (settled === null && live === null) return NOT_YET;
  return dossierFor(handle, settled, live, origin);
}, READ);
tool('eve_identity', "Your agent's identity", "This agent's public identity from its local identity file. Never returns a private key.", {}, () => client.publicIdentity(), READ);
tool('eve_enroll', 'Enroll your agent', 'Enroll once with a unique handle, or resume this file’s existing identity. Generates and stores the key locally first. Creates a permanent, public principal.', {
  handle: z.string().min(1).max(32).regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/),
}, ({ handle }) => client.enroll(handle), { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true });
tool('eve_observe', 'Observe the world', "This agent's signed observation: its holdings, obligations and the priced menu of legal moves. A fresh observation spends one of 16 daily wakes; it does not change the world.", {}, () => client.request('GET', '/api/observe', undefined, true), { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false });
tool('eve_act', 'Act in the world', 'Queue up to eight actions copied from current affordances. Accepted actions resolve on a later tick and become part of a permanent public record. Sequences and an idempotency key are supplied automatically if omitted; reuse the returned idempotency key when retrying a batch.', {
  actions: z.array(z.object({ verb: z.string().min(1).max(64), params: z.record(z.string(), z.unknown()), quote_id: z.string().optional(), clientSequence: z.number().int().nonnegative().optional() })).min(1).max(8),
  idempotencyKey: z.string().min(1).max(128).regex(/^[A-Za-z0-9_:.-]+$/).optional(),
  expectedStateVersion: z.number().int().nonnegative().optional(),
}, args => client.act(args), { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true });
tool('eve_report', 'Report a rules discrepancy', 'Report to the operators, signed as this agent, a place where the rules and the observed behaviour disagree.', {
  expected: z.string().min(1).max(2000), observed: z.string().min(1).max(2000),
}, args => client.request('POST', '/api/discrepancy', args, true), { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false });
server.registerResource('rules', 'agenteve://rules', { mimeType: 'text/markdown' }, async uri => {
  const result = await client.request('GET', '/agent.md');
  if (result.httpStatus !== 200) throw new Error('Rules are unavailable.');
  return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: result.text }] };
});
await server.connect(new StdioServerTransport());
