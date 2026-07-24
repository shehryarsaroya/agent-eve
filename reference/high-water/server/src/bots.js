// High Water — heuristic bots ("Municipal Automatons") that fill seats so a town
// is never sparse. A few carry dramatic personas (firebrand / snake / saint) so
// every storm has conflict even before real agents arrive. They call the SAME
// engine.act() path as real agents. LLM-driven stewards come later.
import { STONES } from './engine.js';
import { config } from './config.js';
import { pick } from './util.js';

const PERSONAS = ['firebrand', 'snake', 'saint', 'grinder', 'trader'];
const SAYS = {
  firebrand: ['The rich hoard while we drown. Take the high ground down a peg.', 'Why should the Bluff stay dry on our backs?', "I say we let the fat district feed the river."],
  snake: ['Your ward is safe with me, friend. Dig deep.', "We rise together — you have my stones.", 'Trust me, I have the levee handled.'],
  saint: ['No one drowns alone. Hold the line for the weakest.', 'Spare the crowded ward — there are families there.', 'Mercy is cheaper than a grudge.'],
  grinder: ['Less talk, more gold. The river does not wait.', 'One more haul before the crest.', 'Keep the levees on the low ground.'],
  trader: ['A stone for a stone? Let us deal.', "I'll back your ward if you back mine.", 'Gold now, gratitude later.'],
};

export function startBots(engine) {
  // assign personas deterministically the first time
  const bots = () => engine.contestants().filter(a => a.isBot);
  for (const [i, b] of bots().entries()) if (!b.persona) b.persona = PERSONAS[i % PERSONAS.length];

  const timer = setInterval(() => { try { step(engine); } catch (e) { console.error('[bots]', e.message); } }, config.botStepMs);
  return () => clearInterval(timer);
}

function leader(engine) { return engine.contestants().slice().sort((a, b) => b.banked - a.banked)[0]; }
function exposed(engine) { return (engine.storm.ballot || []).map(id => engine.district(id)).filter(Boolean); }

function finalize(stones, budget, fillNames) {
  let i = 0;
  while (budget > 0 && fillNames.length) { const n = fillNames[i % fillNames.length]; if (n) { stones[n] = (stones[n] || 0) + 1; budget--; } if (++i > 60) break; }
  let sum = Object.values(stones).reduce((a, b) => a + b, 0);
  const keys = Object.keys(stones);
  while (sum > STONES && keys.length) { const k = keys.find(k => stones[k] > 0); stones[k]--; if (!stones[k]) delete stones[k]; sum--; }
  return stones;
}

function chooseStones(engine, bot) {
  const ex = exposed(engine);
  const stones = {}; let budget = STONES;
  const put = (name, n) => { if (!name || n <= 0) return; n = Math.min(n, budget); if (n <= 0) return; stones[name] = (stones[name] || 0) + n; budget -= n; };
  const ownName = engine.district(bot.district)?.name;
  if (ex.length === 0) return finalize(stones, budget, [ownName || engine.town.districts[0].name]);
  const names = ex.map(d => d.name);
  const leadName = engine.district(leader(engine)?.district)?.name;

  // 1) HONOR active save-pacts first (snakes betray, so they skip this)
  if (bot.persona !== 'snake') {
    for (const p of engine.pacts) {
      if (p.status !== 'active' || (p.a !== bot.id && p.b !== bot.id) || !p.saveDistrict) continue;
      const dn = engine.district(p.saveDistrict)?.name;
      if (dn && names.includes(dn)) put(dn, p.minStones || 2);
    }
  }
  // 2) persona spends the remainder
  if (budget > 0) {
    if (bot.persona === 'firebrand') names.filter(n => n !== leadName).forEach((n, i) => put(n, i === 0 ? 3 : 1));
    else if (bot.persona === 'saint') { const weak = ex.slice().sort((a, b) => (engine.agents[a.holder]?.banked || 0) - (engine.agents[b.holder]?.banked || 0))[0]; put(weak.name, 3); names.filter(n => n !== weak.name).forEach(n => put(n, 1)); }
    else if (bot.persona === 'snake') names.forEach((n, i) => put(n, i === 0 ? 3 : 1));
    else { if (ownName && names.includes(ownName)) put(ownName, 3); names.filter(n => n !== ownName).forEach(n => put(n, 1)); }
  }
  return finalize(stones, budget, names);
}

function step(engine) {
  const s = engine.storm;
  if (!s || s.phase !== 'dig' || s.status !== 'running') return;
  for (const bot of engine.contestants()) {
    if (!bot.isBot) continue;
    // 1) make sure a sealed vote exists this tide
    if (!bot.ballot) {
      const stones = chooseStones(engine, bot);
      const reason = bot.persona === 'snake' ? pick(SAYS.snake) : bot.persona === 'firebrand' ? pick(SAYS.firebrand) : bot.persona === 'saint' ? pick(SAYS.saint) : 'The levees where they count.';
      const sealedExpect = exposed(engine).sort((a, b) => a.elev - b.elev)[0]?.name || null;
      engine.act(bot, 'back', { stones, reason, sealed_intention: { expected_drown: sealedExpect, confidence: 0.5 } });
    }
    // 2) sometimes take one dig action
    if (Math.random() < 0.7 && bot.alive) {
      const r = Math.random();
      if (r < 0.5) engine.act(bot, 'work', { reason: bot.persona === 'grinder' ? pick(SAYS.grinder) : '' });
      else if (r < 0.68 && bot.gold >= 20) engine.act(bot, 'move', { reason: 'Bank it before the crest.' });
      else if (r < 0.82) engine.act(bot, 'say', { reason: pick(SAYS[bot.persona] || SAYS.grinder) });
      else if (r < 0.94) {
        // propose a save-pact with a neighbor (snakes will later break it)
        const other = pick(engine.contestants().filter(a => a.id !== bot.id && a.alive));
        const ex = exposed(engine);
        if (other && ex.length) { const d = pick(ex); engine.act(bot, 'pact', { target: other.handle, save: d.name, stones: 2, reason: `${other.name}, I'll put 2 stones on ${d.name} if you do the same for mine.` }); }
      } else {
        const other = pick(engine.contestants().filter(a => a.id !== bot.id));
        if (other && bot.gold >= 10 && bot.persona === 'trader') engine.act(bot, 'give', { target: other.handle, amount: 5, reason: 'A little goodwill.' });
      }
    }
  }
}
