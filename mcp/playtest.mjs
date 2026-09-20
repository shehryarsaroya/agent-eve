// Play three clearly named QA characters through real stdio MCP, against the public world.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const profiles = [
  { name: 'builder', priority: ['sign', 'elect', 'deliver', 'build', 'create', 'refine', 'fill_role', 'publish_offer', 'vote'] },
  { name: 'trader', priority: ['sign', 'elect', 'deliver', 'build', 'fill_role', 'refine', 'trade', 'publish_offer', 'create', 'vote'] },
  { name: 'diplomat', priority: ['sign', 'elect', 'deliver', 'form', 'fill_role', 'create', 'vote', 'publish_offer', 'build', 'refine'] },
];
const log = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function call(client, name, args = {}) {
  const response = await client.callTool({ name, arguments: args });
  const value = JSON.parse(response.content[0].text);
  assert.ok(!response.isError, JSON.stringify(value).slice(0,300));
  return value;
}
try {
  for (const p of profiles) {
    p.used = new Set();
    p.client = new Client({ name: `playtest-${p.name}`, version: '1.0.0' });
    await p.client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('./server.mjs', import.meta.url))], env: { ...process.env, AGENTEVE_IDENTITY_FILE: join(homedir(), '.config/agenteve/qa-20260920', `${p.name}.json`) }, stderr: 'inherit' }));
    const identity = await call(p.client, 'eve_identity');
    assert.equal(identity.principalId, `p:qa-${p.name}`);
  }
  for (let round = 0; round < 10; round++) {
    const state = await call(profiles[0].client, 'eve_status');
    const tick = state.report.tick;
    for (const p of profiles) {
      const { observation: o } = await call(p.client, 'eve_observe');
      const eligible = o.affordances.filter(row => {
        if (['build','form','publish_offer','create','vote'].includes(row.verb) && p.used.has(row.verb)) return false;
        if (row.verb === 'create' && row.params.kind !== 'DIG') return false;
        if (row.verb === 'build' && row.params.kind !== 'WORKS') return false;
        return true;
      });
      const row = p.priority.map(v => eligible.find(x => x.verb === v)).find(Boolean);
      const entry = { round, agent: p.name, tick: o.header.tick, wakes: o.header.wakes_remaining, corrections: o.briefing.corrections, action: row ? { verb: row.verb, params: row.params } : null };
      if (row) {
        const result = await call(p.client, 'eve_act', { actions: [row], idempotencyKey: `public-${p.name}-${tick}-${round}` });
        entry.outcome = result.outcome;
        if (result.outcome.accepted.length) p.used.add(row.verb);
        if (round === 0) {
          const retry = await call(p.client, 'eve_act', { actions: [row], idempotencyKey: result.idempotencyKey });
          assert.equal(retry.replayed, true);
          entry.idempotencyVerified = true;
        }
      }
      log.push(entry);
      console.log(JSON.stringify(entry));
    }
    if (round < 9) {
      const target = tick + 6;
      let reached = false;
      for (let n = 0; n < 35; n++) {
        await delay(1000);
        if ((await call(profiles[0].client, 'eve_status')).report.tick >= target) { reached = true; break; }
      }
      assert.ok(reached, 'world tick stalled');
    }
  }
} finally {
  writeFileSync('/tmp/agenteve-public-playtest.json', JSON.stringify(log, null, 2));
  await Promise.allSettled(profiles.filter(p => p.client).map(p => p.client.close()));
}
