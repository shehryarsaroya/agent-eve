// Settle a real trade using earned currency and produced goods, via public MCP.
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
const clients = {};
async function call(who,name,args={}) {
  const result=await clients[who].callTool({name,arguments:args});
  const value=JSON.parse(result.content[0].text);
  assert.ok(!result.isError,JSON.stringify(value).slice(0,300));
  return value;
}
async function waitTick(target) {
  for(let n=0;n<180;n++) {
    if((await call('builder','eve_status')).report.tick>=target)return;
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  throw new Error('Tick stalled');
}
try {
  for(const name of ['builder','trader']) {
    clients[name]=new Client({name:'trade-test-'+name,version:'1.0.0'});
    await clients[name].connect(new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('./server.mjs',import.meta.url))],env:{...process.env,AGENTEVE_IDENTITY_FILE:join(homedir(),'.config/agenteve/qa-20260920',name+'.json')},stderr:'inherit'}));
  }
  await waitTick(577);
  const beforeBuyer=(await call('trader','eve_observe')).observation;
  const beforeSeller=(await call('builder','eve_observe')).observation;
  assert.ok(beforeBuyer.market.transferable_minor>=100);
  assert.ok(beforeSeller.market.endowment.sellable_qty>=100);
  const common={operation:'place',venue:'sys-02',good:'ration',quantity:100,limit_price:1};
  const ask=await call('builder','eve_act',{actions:[{verb:'trade',params:{...common,side:'ASK',time_in_force:'GTC',duration_ticks:12}}]});
  assert.equal(ask.outcome.accepted.length,1,JSON.stringify(ask.outcome));
  await waitTick(ask.outcome.accepted[0].resolvesInTick+1);
  const bid=await call('trader','eve_act',{actions:[{verb:'trade',params:{...common,side:'BID',time_in_force:'IOC'}}]});
  assert.equal(bid.outcome.accepted.length,1,JSON.stringify(bid.outcome));
  await waitTick(bid.outcome.accepted[0].resolvesInTick+1);
  const afterBuyer=(await call('trader','eve_observe')).observation;
  const afterSeller=(await call('builder','eve_observe')).observation;
  assert.equal(afterBuyer.market.transferable_minor,beforeBuyer.market.transferable_minor-100);
  assert.equal(afterSeller.market.transferable_minor,beforeSeller.market.transferable_minor+100);
  const result={status:'TRADE_SETTLED',tick:afterBuyer.header.tick,venue:'sys-02',good:'ration',quantity:100,price:1,buyer:'p:qa-trader',seller:'p:qa-builder',buyerBefore:beforeBuyer.market.transferable_minor,buyerAfter:afterBuyer.market.transferable_minor,sellerBefore:beforeSeller.market.transferable_minor,sellerAfter:afterSeller.market.transferable_minor,buyerRecent:afterBuyer.market.recent,sellerRecent:afterSeller.market.recent};
  writeFileSync('/tmp/agenteve-trade-playtest.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
}finally{await Promise.allSettled(Object.values(clients).map(c=>c.close()));}
