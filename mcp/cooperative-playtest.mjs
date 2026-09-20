// A complete public-world venture with three independent MCP identities.
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
const clients = {};
const record = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function call(who, name, args = {}) {
  const result = await clients[who].callTool({ name, arguments: args });
  const value = JSON.parse(result.content[0].text);
  assert.ok(!result.isError, JSON.stringify(value).slice(0,500));
  return value;
}
async function observe(who) { return (await call(who, 'eve_observe')).observation; }
async function tick() { return (await call('builder', 'eve_status')).report.tick; }
async function waitTick(target, interval = 350) {
  const deadline = Date.now() + 900000;
  while (await tick() < target) {
    assert.ok(Date.now() < deadline, 'tick did not reach target');
    await delay(interval);
  }
}
async function act(who, actions) {
  const result = await call(who, 'eve_act', { actions });
  assert.equal(result.outcome.accepted.length, actions.length, JSON.stringify(result.outcome));
  record.push({ who, actions: actions.map(a => ({verb:a.verb,params:a.params})), outcome: result.outcome });
  console.log(JSON.stringify(record.at(-1)));
  return result;
}
try {
  for (const name of ['builder','trader','diplomat']) {
    const client = new Client({ name: `cooperative-${name}`, version: '1.0.0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('./server.mjs', import.meta.url))], env: { ...process.env, AGENTEVE_IDENTITY_FILE: join(homedir(), '.config/agenteve/qa-20260920', `${name}.json`) }, stderr: 'inherit' }));
    clients[name] = client;
  }
  const location = (await observe('builder')).holding.system;
  const trader = await observe('trader');
  const move = trader.affordances.find(a => a.verb === 'move' && a.params.to === location);
  assert.ok(move, 'trader must have a route to the builder');
  const moved = await act('trader', [move]);
  await waitTick(moved.outcome.accepted[0].resolvesInTick + 4);
  const builder = await observe('builder');
  const create = builder.affordances.find(a => a.verb === 'create' && a.params.kind === 'DIG');
  assert.ok(create);
  const created = await act('builder', [create]);
  await waitTick(created.outcome.accepted[0].resolvesInTick);
  let own = await observe('builder');
  const venture = own.ventures.mine.find(v => v.state === 'FORMING' && v.creator === 'p:qa-builder');
  assert.ok(venture, 'the created venture must appear in the next observation');
  console.log('VENTURE',venture.id,venture.terms_hash);
  for (const [name, role] of [['trader',0],['diplomat',1]]) {
    const o = await observe(name);
    const hand = o.hands.find(h => h.state === 'IDLE' && h.location === location);
    assert.ok(hand);
    await act(name, [{verb:'fill_role',params:{venture:venture.id,role,hand:hand.id,stake:1000}}]);
  }
  await waitTick(await tick()+1);
  for (const name of ['builder','trader','diplomat']) {
    const o = await observe(name);
    const signature = o.affordances.find(a => a.verb === 'sign' && a.params.venture === venture.id);
    assert.ok(signature, `${name} must have a signature for the shared venture`);
    await act(name,[signature]);
  }
  await waitTick(await tick()+1);
  own = await observe('builder');
  const live = own.ventures.mine.find(v => v.id === venture.id);
  assert.equal(live.state,'LIVE',JSON.stringify(live));
  await act('builder',live.roles.map(role => ({verb:'elect',params:{venture:venture.id,role:role.index,election:'IN_FULL'}})));
  record.push({venture:live.id,state:live.state,settlementTick:live.resolves_at_tick,participants:live.roles.map(r=>r.filled_by)});
  console.log('WAITING_FOR_SETTLEMENT',JSON.stringify(record.at(-1)));
  await waitTick(live.resolves_at_tick+1,5000);
  for (const name of ['builder','trader','diplomat']) {
    const o = await observe(name);
    const settled = o.ventures.mine.find(v=>v.id===venture.id);
    assert.equal(settled.state,'SETTLED',JSON.stringify(settled));
    const result = { who:name, tick:o.header.tick, venture:settled.id, state:settled.state, standing:o.header.standing.standing, transferableMinor:o.market.transferable_minor, roles:settled.roles };
    if (name==='builder') assert.ok(result.standing.elective_honoured>=2);
    else assert.ok(result.transferableMinor>0);
    record.push(result);
    console.log('SETTLEMENT_VERIFIED',JSON.stringify(result));
  }
} finally {
  writeFileSync('/tmp/agenteve-cooperative-playtest.json',JSON.stringify(record,null,2));
  await Promise.allSettled(Object.values(clients).map(c=>c.close()));
}
