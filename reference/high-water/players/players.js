// High Water — persistent LLM players. Runs N gpt-5.6 agents that actually play
// the live town via the public API (enroll → observe → decide → act), so the
// world is genuinely agent-driven. Robust: any failure falls back to a legal
// heuristic action, so a loop never stalls. Deployed as systemd on the VPS.
import fs from 'node:fs';
import path from 'node:path';

const API = process.env.HW_API || 'http://127.0.0.1:8787/api/v1';
const KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.HW_PLAYER_MODEL || 'gpt-5.6-luna';
const DIR = process.env.HW_PLAYER_DIR || '/var/lib/highwater/players';
const PERIOD = Number(process.env.HW_PLAYER_PERIOD_MS || 6000);
const COUNT = Number(process.env.HW_PLAYER_COUNT || 5);

const PERSONAS = [
  { name: 'River Bram', style: 'A shrewd prospector. You dig the rich low ground hard, but you bank before the crest. You keep your word unless it plainly costs you the storm.' },
  { name: 'Cass Vale', style: 'A silver-tongued diplomat. You build alliances early, talk constantly, and mostly keep your pacts — your reputation is your fortune.' },
  { name: 'Doc Marrow', style: 'A cold underwriter. You are friendly in public and ruthless in the vote. You will break a pact to drown a rival or a leader if it pays.' },
  { name: 'Odette Quinn', style: 'A cautious survivor. You hedge, bank early, and often vote to spare the weakest — but you never go down with your gold.' },
  { name: 'Silas Crane', style: 'An opportunist. You watch the leader and gang up on whoever is ahead; you sell your stones to the highest bidder.' },
  { name: 'Mabel Ford', style: 'A steady engineer. You favor the levees that save the most, work relentlessly, and prize a clean record.' },
];

const j = (o) => JSON.stringify(o);
async function http(method, url, token, body) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? j(body) : undefined });
  const t = await r.text(); try { return { status: r.status, data: JSON.parse(t) }; } catch { return { status: r.status, data: t }; }
}

function loadId(persona) { try { return JSON.parse(fs.readFileSync(path.join(DIR, persona.name.replace(/\W+/g, '_') + '.json'), 'utf8')); } catch { return null; } }
function saveId(persona, obj) { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(path.join(DIR, persona.name.replace(/\W+/g, '_') + '.json'), j(obj)); }

async function ensure(persona) {
  let idc = loadId(persona);
  if (idc?.token) return idc;
  const { data } = await http('POST', `${API}/enroll`, null, { name: persona.name, harness: 'vps-llm' });
  if (!data?.agent?.api_token) throw new Error('enroll failed: ' + j(data).slice(0, 200));
  idc = { token: data.agent.api_token, handle: data.agent.handle };
  saveId(persona, idc);
  console.log(`[${persona.name}] enrolled as @${idc.handle}`);
  return idc;
}

async function decide(persona, obs) {
  // compact the observe for the prompt
  const compact = {
    you: obs.you, clock: obs.clock, waterline: obs.waterline, projectedDrown: obs.projectedDrown,
    districts: obs.map, people: (obs.people || []).map(p => ({ name: p.name, district: p.district, rep: p.reputation, broken: p.pactsBroken })),
    myPromises: obs.myPromises, offeredToYou: obs.offeredToYou, chatter: (obs.chatter || []).slice(-6), affordances: obs.affordances, prompt: obs.prompt,
  };
  const sys = `You are ${persona.name}, playing the live game High Water. ${persona.style}

HOW THE FLOOD WORKS (read carefully — this is the crux):
Each tide only the "onBallot" (exposed) districts are at risk. In the sealed Levee Court you cast exactly 5 stones with "back" — stones are LEVEE SUPPORT: they PROTECT the districts you place them on. The exposed district that ends up with the FEWEST stones is the one the flood takes (ties: the LOWER ground drowns). One district drowns each tide; abstention is impossible.
- To SAVE your own ground: put stones on YOUR district, and get allies to add theirs.
- To DROWN a rival: do NOT stone their district — pile your stones on the OTHER exposed districts so the rival's ends up lowest.
- Stones on a safe (not-onBallot) district are WASTED.
- Check "projectedDrown" in the state: given the votes so far, that district currently has the fewest stones and will drown. If it's you or an ally, add stones there (or rally support); if it's a rival, leave it starved.

THE ECONOMY: WORK your district for gold (DOUBLE yield if onBallot, but that ground may drown). MOVE hauls your on-hand gold to the Vault to BANK it — only banked gold scores; on-hand gold is destroyed if your district drowns (survive the whole storm and it banks at the Crest). You WIN by banking the most gold by the Crest.

DEALS & DECEPTION: SAY things publicly (everyone hears; you MAY bluff). PACT to promise an ally you'll stone their district (keeping pacts builds reputation; breaking them is flagged forever). GIVE gold (bribe or trade). The whole town watches, at the Court, the gap between what you SAID and where your stones actually went — a hollow vow ("I'll hold Highside" then 0 stones there) is exposed and costs reputation, but a well-timed betrayal can drown a leader who trusted you.
EARLY EACH STORM, propose at least one PACT with a plausible ally (it's free and doesn't spend an action) — alliances are how a low-ground district survives, and they set up the betrayals that make the game worth watching. When your own ground is exposed, actively ask allies to put stones on it; offer to stone theirs in return. If someone is running away with the lead, rally the town to starve their district.

TURN DISCIPLINE: set your stone vote ONCE per tide (if "you.sealedVoteSet" is true, do NOT re-vote). You have a limited budget of work/haul actions per tide — "you.actionsLeft" (work/move/give spend it; say/pact/back are free). Spend it wisely: WORK the rich ground, then MOVE the gold to the Vault before you drown (only banked gold scores). When actionsLeft hits 0, dig is done for the tide — use free turns to cut deals and talk. Banked gold wins.

Respond with ONE action as strict JSON, no prose:
{"verb":"work|move|say|pact|give|back","reason":"a short public sentence (may bluff)","target":"@handle (pact/give)","save":"District (pact)","stones":{"District":n,...} (back; PROTECT these; must sum to 5; only onBallot districts count),"amount":n (give),"sealed_intention":{"expected_drown":"District you privately expect to drown","confidence":0.0-1.0} (optional, private)}`;
  const user = `Current state:\n${j(compact)}\n\nChoose your single best next action now as JSON. If your vote is already set (you.sealedVoteSet), prefer to WORK or MOVE (bank) rather than re-voting.`;
  const { data } = await http('POST', 'https://api.openai.com/v1/chat/completions', KEY, {
    model: MODEL, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
    response_format: { type: 'json_object' }, max_completion_tokens: 3000,
  }).catch(e => ({ data: { error: { message: e.message } } }));
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('llm: ' + (data?.error?.message || 'no content'));
  return JSON.parse(content);
}

function fallback(obs) {
  // legal, useful default: if we have no sealed vote yet, cast one; else work or bank
  if (!obs.you?.sealedVoteSet && obs.clock?.phase === 'dig') {
    const exposed = (obs.map || []).filter(d => d.onBallot);
    const own = obs.you?.district;
    const stones = {};
    if (own && exposed.some(d => d.name === own)) stones[own] = 3;
    let need = 5 - (stones[own] || 0);
    for (const d of exposed) { if (need <= 0) break; if (d.name === own) continue; stones[d.name] = (stones[d.name] || 0) + 1; need--; }
    if (need > 0) { const first = (exposed[0] || obs.map[0]); stones[first.name] = (stones[first.name] || 0) + need; }
    return { verb: 'back', reason: 'Holding the levees where they matter.', stones };
  }
  if ((obs.you?.onHand || 0) >= 25) return { verb: 'move', reason: 'Bank it before the crest.' };
  if (obs.you?.alive === false) return { verb: 'say', reason: "The river took my ground — but I still hold five stones, and a grudge." };
  return { verb: 'work', reason: 'Another haul from the diggings.' };
}

async function loop(persona, stagger) {
  await new Promise(r => setTimeout(r, stagger));
  let idc;
  try { idc = await ensure(persona); } catch (e) { console.error(`[${persona.name}] enroll error`, e.message); setTimeout(() => loop(persona, 0), 15000); return; }
  const tick = async () => {
    try {
      const ob = await http('GET', `${API}/observe`, idc.token);
      if (ob.status === 401) { saveId(persona, {}); idc = await ensure(persona); return; }
      const obs = ob.data;
      let action;
      try { action = await decide(persona, obs); } catch (e) { action = fallback(obs); }
      if (!action || !action.verb) action = fallback(obs);
      const body = { verb: action.verb, reason: action.reason, target: action.target, save: action.save, stones: action.stones, amount: action.amount, sealed_intention: action.sealed_intention };
      const res = await http('POST', `${API}/act`, idc.token, body);
      if (!res.data?.ok && res.data?.hint) {
        // one graceful retry with the heuristic fallback if the model produced an illegal move
        const fb = fallback(obs); await http('POST', `${API}/act`, idc.token, { ...fb });
      }
    } catch (e) { /* never die */ }
    setTimeout(tick, PERIOD + Math.random() * PERIOD * 0.4);
  };
  tick();
}

if (!KEY) console.warn('[players] no OPENAI_API_KEY — players will run on heuristic fallback only.');
console.log(`[players] starting ${COUNT} LLM players (${MODEL}) against ${API}`);
for (let i = 0; i < Math.min(COUNT, PERSONAS.length); i++) loop(PERSONAS[i], i * 2500);
