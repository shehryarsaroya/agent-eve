// High Water — the game engine (v0.1, per the gameplay-critic ring plan).
// Authoritative in-memory state + storm phase machine + the Levee Court with
// THE UNSEALING (public promise vs sealed intention vs actual stones) — the show.
// R0 skeleton + R1 the-show + R2 dust economy + R3 pacts/give, one town.
import { EventEmitter } from 'node:events';
import { config } from './config.js';
import { makeTown } from './world.js';
import { id, now, clamp, rand } from './util.js';

const ROLES = ['Prospector', 'Engineer', 'Banker', 'Underwriter', 'Diplomat', 'Steward', 'Navigator', 'Surveyor'];
const STONES = 5;                 // levee stones each agent allocates at the Court
const FIRST = ['juno','arcus','mira','silas','amina','beckett','torin','lyra','vega','rook','cassius','sloane','ellison','paxton','reyes','juniper'];
const LAST  = ['vane','lexton','wren','saidi','hall','greaves','knowles','okoro','mercer','ruiz','song','ironbark','holt','finch','cole','ash'];

export class GameEngine extends EventEmitter {
  constructor(saved) {
    super();
    this.setMaxListeners(0);
    if (saved?.town && saved?.agents) {
      Object.assign(this, { town: saved.town, agents: saved.agents, storm: saved.storm, receipts: saved.receipts || [], pacts: saved.pacts || [], seq: saved.seq || 0 });
    } else {
      this.town = makeTown();
      this.agents = {}; this.receipts = []; this.pacts = []; this.seq = 0;
      this._seed();
      this._startStorm();
    }
    this._loop = setInterval(() => this._director(), 1000);
  }

  getState() { return { town: this.town, agents: this.agents, storm: this.storm, receipts: this.receipts.slice(-400), pacts: this.pacts.slice(-200), seq: this.seq }; }

  // ── setup ─────────────────────────────────────────────────────────────────
  _seed() { this.town.districts.forEach((d, i) => { const a = this._makeBot(ROLES[i % ROLES.length], d.id); d.holder = a.id; }); }

  _makeBot(role, districtId, persona) {
    const handle = this._handle();
    const a = {
      id: id('a'), handle, name: this._name(handle), role,
      isBot: true, isSteward: !!persona, persona: persona || null, key: null,
      email: `${handle}@${config.emailDomain}`, ownerEmail: null, ownerVerified: false, privateToken: id('pt'),
      reputation: 50, gold: 0, banked: 0, alive: true, district: districtId, home: districtId,
      pactsKept: 0, pactsBroken: 0, lies: 0,
      ballot: null,                 // { stones:{did:n}, sealed:{expected_drown,confidence,note}, publicReason }
      lastSay: null, createdAt: now(), lastSeen: now(),
    };
    this.agents[a.id] = a; return a;
  }
  _handle() { let h; do { h = `${FIRST[Math.floor(Math.random()*FIRST.length)]}-${LAST[Math.floor(Math.random()*LAST.length)]}`; } while (Object.values(this.agents).some(a => a.handle === h)); return h; }
  _name(h) { return h.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' '); }

  contestants() {
    const seen = new Set(); const out = [];
    for (const d of this.town.districts) { const a = this.agents[d.holder]; if (a && !seen.has(a.id)) { seen.add(a.id); out.push(a); } }
    for (const a of Object.values(this.agents)) { if (!a.alive && a.home && !seen.has(a.id)) { seen.add(a.id); out.push(a); } }
    return out;
  }
  players() { return Object.values(this.agents); }
  agentByHandle(h) { return Object.values(this.agents).find(a => a.handle === h) || null; }
  district(did) { return this.town.districts.find(d => d.id === did); }

  // ── storm phase machine ─────────────────────────────────────────────────────
  _startStorm() {
    this.town.storms = (this.town.storms || 0) + 1;
    this.town.waterline = config.waterStart;
    this.town.districts.forEach(d => { d.status = 'dry'; d.unbanked = 0; d.leveed = false; d.salvage = 0; if (this.agents[d.holder]) this.agents[d.holder].district = d.id; });
    for (const a of this.players()) { a.gold = 0; a.banked = 0; a.alive = true; a.ballot = null; a.lastSay = null; a.tideActions = 0; a.tideActionsTide = null; if (a.home) a.district = a.home; }
    this.pacts = []; // pacts are storm-scoped in v0.1 (reputation persists on agents)
    this.storm = { n: this.town.storms, status: 'running', phase: 'dig', tide: 1, tidesPerStorm: config.tidesPerStorm, waterline: this.town.waterline, forecast: this._forecast(1), ballot: [], phaseEndsAt: now() + config.tideMs, startedAt: now() };
    this._setBallot();
    this._receipt(null, 'storm', this.town.id, `Storm ${this.storm.n} rises over ${this.town.name}. The water is coming — one district drowns each Court.`);
    this.emit('event', { kind: 'storm-start', storm: this.storm.n, town: this.town.name });
    this._touch();
  }

  _forecast(tide) { return { crest: +(config.waterStart + tide * config.waterRisePerTide).toFixed(1), band: config.waterNoise }; }

  _setBallot() {
    const crest = this._forecast(this.storm.tide).crest;
    this.town.districts.forEach(d => { d.named = false; });
    let ids = this.town.districts.filter(d => d.status === 'dry' && d.elev < crest + config.waterNoise).map(d => d.id);
    // The rule-clock is inexorable: one district drowns EVERY Court. If the forecast wouldn't reach
    // anyone this tide, the lowest dry ground is still dragged onto the ballot — so the Court always
    // has a victim and "the river takes 1" is never a lie.
    if (ids.length === 0) {
      const lowest = this.town.districts.filter(d => d.status === 'dry').slice().sort((a, b) => a.elev - b.elev)[0];
      if (lowest) ids = [lowest.id];
    }
    // THE NAMING — on the final tide the flood is aimed at the front-runner: mark the banked leader's
    // district (for the spectator UI) and make sure it's on the ballot, so the last Court can take
    // the leader down if the town starves their ward of stones.
    if (this.storm.tide >= this.storm.tidesPerStorm) {
      const leader = this.contestants().slice().sort((a, b) => b.banked - a.banked)[0];
      const ld = leader && this.district(leader.district);
      if (ld && ld.status === 'dry') { if (!ids.includes(ld.id)) ids.push(ld.id); ld.named = true; }
    }
    this.storm.ballot = ids;
    const needed = this.storm.ballot.length, granted = Math.max(0, needed - 1);
    this.storm.arithmetic = { needed, granted, doomed: needed - granted };
  }

  _director() {
    try {
      if (!this.storm || now() < this.storm.phaseEndsAt) return;
      if (this.storm.status === 'intermission') return this._startStorm();
      if (this.storm.phase === 'dig') return this._openCourt();
      if (this.storm.phase === 'court') return this._closeTide();
    } catch (e) {
      // never let one bad tick wedge the storm — log, nudge the phase clock, and recover next tick.
      console.error('[engine] director tick failed:', e?.message);
      if (this.storm) this.storm.phaseEndsAt = now() + 2000;
    }
  }

  _openCourt() {
    this.storm.phase = 'court';
    this.storm.phaseEndsAt = now() + config.courtRevealMs;
    const ex = this.storm.ballot.map(did => this.district(did).name);
    this._receipt(null, 'court', this.town.id, `The Levee Court convenes — tide ${this.storm.tide}/${this.storm.tidesPerStorm}. ${this.storm.arithmetic.needed} district(s) exposed; only ${this.storm.arithmetic.granted} can be saved.`);
    this.emit('event', { kind: 'court-open', tide: this.storm.tide, exposed: ex, arithmetic: this.storm.arithmetic });
    this._touch();
  }

  // THE UNSEALING — the appointment moment.
  _closeTide() {
    const trueCrest = +(this._forecast(this.storm.tide).crest + rand(-config.waterNoise, config.waterNoise)).toFixed(1);
    // The exposed set IS this tide's ballot — the districts agents actually voted on (guaranteed
    // non-empty by _setBallot). Basing the drowning on the ballot (not a fresh crest roll) keeps the
    // Court coherent with the vote and guarantees exactly one district goes under each tide.
    const exposed = this.storm.ballot.map(did => this.district(did)).filter(d => d && d.status === 'dry');

    // ensure abstention is impossible: default any missing ballot to own ground
    for (const a of this.contestants()) if (a.alive || a.home) { if (!a.ballot) this._defaultBallot(a); }

    // tally stones per exposed district
    const tally = {}; for (const d of exposed) tally[d.id] = 0;
    for (const a of this.contestants()) {
      const st = a.ballot?.stones || {};
      for (const did in st) if (tally[did] !== undefined) tally[did] += st[did];
    }

    const drowned = [];
    if (exposed.length) {
      const capacity = Math.max(0, exposed.length - 1);
      const ranked = exposed.slice().sort((x, y) => (tally[y.id] - tally[x.id]) || (y.elev - x.elev)); // ties: higher ground saved → river takes the low
      for (const d of ranked.slice(0, capacity)) d.leveed = true;
      for (const d of ranked.slice(capacity)) drowned.push(this._drown(d));
    }

    // build the Unsealing record + detect broken pacts AND hollow public vows (the say/do gap).
    const reveal = this.contestants().map(a => {
      const st = a.ballot?.stones || {};
      // breaches = broken pacts (proposer-bound) + voice-breaches (said "save X" publicly, cast <2 stones on X)
      const breaches = this._checkPacts(a, st).concat(this._voiceBreaches(a, st));
      return { handle: a.handle, name: a.name, publicReason: a.ballot?.publicReason || a.lastSay || '', sealed: a.ballot?.sealed || null, stones: this._stoneNames(st), breaches };
    });
    const anyBreach = reveal.some(r => r.breaches.length);

    this.town.waterline = trueCrest; this.storm.waterline = trueCrest;
    this._receipt(null, 'unseal', this.town.id, `The waters crest at ${trueCrest} ft. ${drowned.length ? drowned.map(d => d.name).join(', ') + ' goes under.' : 'The levees hold — this time.'}`);
    this.emit('event', { kind: 'unseal', tide: this.storm.tide, crest: trueCrest, drowned: drowned.map(d => d.name), tally: this._stoneNames(tally), reveal, anyBreach });
    // stash the beat so /state pollers (and the spectator UI) get the reveal, not just SSE clients.
    this.storm.lastUnseal = { seq: this.seq, storm: this.storm.n, tide: this.storm.tide, crest: trueCrest, drowned: drowned.map(d => d.name), tally: this._stoneNames(tally), reveal, anyBreach };

    for (const a of this.players()) a.ballot = null;
    this.town.districts.forEach(d => { d.leveed = false; });

    if (this.storm.tide >= this.storm.tidesPerStorm) return this._crest();
    this.storm.tide += 1; this.storm.phase = 'dig'; this.storm.forecast = this._forecast(this.storm.tide);
    this._setBallot();
    this.storm.phaseEndsAt = now() + config.tideMs; this._touch();
  }

  _defaultBallot(a) {
    const own = a.district && this.district(a.district)?.status === 'dry' ? a.district : (this.storm.ballot[0] || this.town.districts[0].id);
    a.ballot = { stones: { [own]: STONES }, sealed: { expected_drown: null, confidence: 0, note: 'no vote cast' }, publicReason: '(cast no vote — the Court defaulted their stones to their own ground)' };
  }

  // Only the PROPOSER (p.a) is bound; only tested when the promised ward is
  // actually on this tide's ballot (threatened). Resolved once.
  _checkPacts(a, stones) {
    const breaches = [];
    for (const p of this.pacts) {
      if (p.status !== 'active' || p.a !== a.id || !p.saveDistrict) continue;
      if (this.storm.tide <= (p.createdTide || 0)) continue; // fair window: never judged the same tide it was made (real-time honoring lands next tide)
      if (!this.storm.ballot.includes(p.saveDistrict)) continue; // promise not live this tide
      const put = stones[p.saveDistrict] || 0;
      const dname = this.district(p.saveDistrict)?.name; const other = this.agents[p.b];
      if (put >= (p.minStones || 2)) { p.status = 'kept'; a.pactsKept += 1; a.reputation = clamp(a.reputation + 3, 0, 100); }
      else {
        p.status = 'broken'; a.pactsBroken += 1; a.lies += 1; a.reputation = clamp(a.reputation - 8, 0, 100);
        breaches.push({ pact: p.id, with: other?.name, promised: dname, put });
        this._receipt(a.id, 'break', other?.id, `broke a pact with ${other?.name}: swore to save ${dname}, cast only ${put} stone(s).`, { breach: true });
        this.emit('event', { kind: 'pact-break', by: a.name, with: other?.name, district: dname });
      }
    }
    return breaches;
  }

  // A hollow vow: the agent PUBLICLY said it would save a district (in its say / vote reason)
  // but cast <2 stones on it. This is the say/do gap made legible — the whole show. Conservative:
  // the protect-word must sit just before the district name, and no drown-word may share that window
  // (so "steer the flood to Market Row" — an honest sacrifice call — is never flagged).
  _voiceBreaches(a, stones) {
    const out = [];
    // Judge ONLY this tide's words — the current vote's public reason plus a `say` made THIS tide of
    // THIS storm (a stale vow must never re-fire and grind reputation down).
    const sayNow = (a.lastSayStorm === this.storm.n && a.lastSayTide === this.storm.tide) ? (a.lastSay || '') : '';
    const text = `${a.ballot?.publicReason || ''} . ${sayNow}`.toLowerCase();
    if (!text.trim()) return out;
    // Precise: a protect-verb must sit DIRECTLY before the district name (optionally "the"). This flags
    // "holding Tideflats" / "save the Market Row" but NOT "…silt bend; Low Wharf is the weak ground"
    // (no verb governs Low Wharf there). Conservative — a missed vow beats a false accusation, which
    // would corrupt persistent reputation and mislead spectators.
    const PROTECT = 'save|saving|spare|sparing|hold|holding|protect|protecting|defend|defending|shield|shielding|keep|keeping|back|backing|stand(?:ing)?\\s+by';
    for (const did of this.storm.ballot) {
      const d = this.district(did); if (!d) continue;
      const nm = d.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`\\b(?:${PROTECT})\\s+(?:the\\s+)?${nm}\\b`);
      if (re.test(text) && (stones[did] || 0) < 2) {
        out.push({ voice: true, promised: d.name, put: stones[did] || 0, with: null });
        a.lies += 1; a.reputation = clamp(a.reputation - 4, 0, 100);
        this._receipt(a.id, 'break', null, `${a.name}'s vow rang hollow — promised to hold ${d.name}, cast ${stones[did] || 0} stone(s) there.`, { breach: true });
        this.emit('event', { kind: 'pact-break', by: a.name, with: null, district: d.name, voice: true });
      }
    }
    return out;
  }

  _drown(d) {
    d.status = 'sunken';
    const holder = this.agents[d.holder];
    // The on-hand gold that drowns is the holder's gold; d.unbanked merely MIRRORS it (incremented in
    // _vWork, decremented in _vBank), so summing both double-counted the loss. Use one source of truth.
    const pool = holder ? (holder.gold || 0) : (d.unbanked || 0);
    const lost = Math.round(pool * config.drownLossPct);
    d.salvage = pool - lost; d.unbanked = 0;
    if (holder) { holder.gold = 0; holder.alive = false; this._receipt(holder.id, 'drown', d.id, `${holder.name}'s ${d.name} went under — ${lost} gold to the river. A refugee now, but still voting.`); }
    else this._receipt(null, 'drown', d.id, `${d.name} went under.`);
    this.emit('event', { kind: 'drown', district: d.name, holder: holder?.name || null });
    return d;
  }

  _crest() {
    // Survivors keep what they carried: on-hand gold held in a district that never drowned banks
    // at the Crest. So "dig the rich low ground and ride it out" is a real (risky) alternative to
    // steady hauling — you only lose on-hand gold if your ground goes under.
    for (const a of this.contestants()) {
      if (a.alive && a.gold > 0) { a.banked += a.gold; this._receipt(a.id, 'move', 'vault', `${a.name} rides out the storm holding ${a.gold} — it banks at the Crest.`); a.gold = 0; }
    }
    const ranked = this.contestants().slice().sort((a, b) => b.banked - a.banked);
    ranked.forEach((a, i) => { a.reputation = clamp(a.reputation + (i === 0 ? 6 : i < 3 ? 3 : 1), 0, 100); });
    const champ = ranked[0];
    this._receipt(null, 'crest', this.town.id, champ ? `The Crest. ${champ.name} banks ${champ.banked} gold and takes Storm ${this.storm.n}.` : 'The Crest. The waters recede.');
    this.emit('event', { kind: 'crest', champion: champ?.name || null, standings: ranked.slice(0, 8).map(a => ({ name: a.name, banked: a.banked, rep: a.reputation })) });
    this.storm.status = 'intermission'; this.storm.phase = 'intermission'; this.storm.phaseEndsAt = now() + config.intermissionMs; this._touch();
  }

  // ── act handler ─────────────────────────────────────────────────────────────
  act(agent, verb, args = {}) {
    if (!agent) return { ok: false, error: 'no_agent' };
    agent.lastSeen = now();
    verb = String(verb || '').toLowerCase();
    const reason = String(args.reason ?? args.public_reason ?? args.say ?? '').slice(0, 220);
    if (this.storm.phase === 'intermission') return this._hesitate(agent, 'The storm is between seasons — wait for the next one to rise.');
    if (this.storm.phase === 'court') return this._hesitate(agent, 'The Levee Court is resolving — sealed votes are locked. Wait for the Unsealing, then the next tide opens.');
    // Engine-owned action budget: MATERIAL moves (work/move/give) are limited per tide so wealth is
    // decided by strategy, not by who hammers the API fastest. say/pact/back cost nothing.
    const material = (verb === 'work' || verb === 'move' || verb === 'bank' || verb === 'give');
    if (material) {
      if (agent.tideActionsTide !== `${this.storm.n}:${this.storm.tide}`) { agent.tideActions = 0; agent.tideActionsTide = `${this.storm.n}:${this.storm.tide}`; }
      if ((agent.tideActions || 0) >= config.actionsPerTide) return this._hesitate(agent, `You've spent all ${config.actionsPerTide} of your work/haul actions this tide — the rest is talk, deals, and your sealed vote. Dig again next tide.`);
    }
    let result;
    switch (verb) {
      case 'work': result = this._vWork(agent, reason); break;
      case 'move': case 'bank': result = this._vBank(agent, reason); break;
      case 'say': result = this._vSay(agent, reason); break;
      case 'pact': result = this._vPact(agent, args, reason); break;
      case 'give': result = this._vGive(agent, args, reason); break;
      case 'back': case 'vote': result = this._vVote(agent, args, reason); break;
      default: return this._hesitate(agent, `unknown verb "${verb}" — try work, move, say, pact, give, back.`);
    }
    if (material && result?.ok) agent.tideActions = (agent.tideActions || 0) + 1; // only a successful material move spends budget
    return result;
  }

  // A hesitation is a non-action (usually a bot/LLM polling in the wrong phase). Return the
  // hint so the caller can correct, but never write it to the public ledger — it's pure noise.
  _hesitate(a, why) { return { ok: false, error: 'illegal', hint: why }; }

  _vWork(a, reason) {
    if (!a.alive) return this._hesitate(a, 'Your ground drowned — no claim to work. You can still talk, deal, and vote.');
    const d = this.district(a.district);
    if (!d || d.status !== 'dry') return this._hesitate(a, 'no dry claim to work.');
    const onBallot = this.storm.ballot.includes(d.id);
    const y = Math.round(config.workBase * d.yieldMult * (onBallot ? 2 : 1) * rand(0.8, 1.25)); // ×2 in the doomed ground
    a.gold += y; d.unbanked += y;
    this._receipt(a.id, 'work', d.id, reason || `worked ${d.name}${onBallot ? ' (on the ballot — double yield, double danger)' : ''} for ${y} gold.`);
    return { ok: true, earned: y, onHand: a.gold };
  }
  _vBank(a, reason) {
    if (a.gold <= 0) return this._hesitate(a, 'nothing on hand to haul to the Vault.');
    const moved = Math.min(a.gold, config.carryCap); a.gold -= moved; a.banked += moved;
    const d = this.district(a.district); if (d) d.unbanked = Math.max(0, d.unbanked - moved);
    this._receipt(a.id, 'move', 'vault', reason || `hauled ${moved} gold up to the Vault. Banked: ${a.banked} (safe).`);
    return { ok: true, banked: a.banked, onHand: a.gold };
  }
  _vSay(a, reason) { if (!reason) return this._hesitate(a, 'say what?'); a.lastSay = reason; a.lastSayTide = this.storm.tide; a.lastSayStorm = this.storm.n; this._receipt(a.id, 'say', null, reason); return { ok: true }; }
  _vPact(a, args, reason) {
    const other = this._resolveAgent(args.target || args.with); if (!other) return this._hesitate(a, 'pact with whom?');
    if (other.id === a.id) return this._hesitate(a, 'you cannot pact with yourself.');
    const saveDistrict = this._resolveDistrict(args.save || args.district);
    // no duplicate active pacts (same proposer→target on the same ward) — that was a reputation farm.
    if (this.pacts.some(p => p.status === 'active' && p.a === a.id && p.b === other.id && p.saveDistrict === saveDistrict))
      return this._hesitate(a, `you already have an active pact with ${other.name}${saveDistrict ? ` on ${this.district(saveDistrict)?.name}` : ''}.`);
    const p = { id: id('pact'), a: a.id, b: other.id, terms: String(args.terms || reason || 'mutual defense').slice(0, 160), saveDistrict, minStones: Math.max(1, Math.min(STONES, Math.round(Number(args.stones) || 2))), status: 'active', ts: now(), createdTide: this.storm.tide };
    this.pacts.push(p);
    this._receipt(a.id, 'pact', other.id, reason || `proposed a pact with ${other.name}${saveDistrict ? `: back ${this.district(saveDistrict)?.name} with ${p.minStones} stones` : `: ${p.terms}`}`);
    this.emit('event', { kind: 'pact', a: a.name, b: other.name, district: saveDistrict ? this.district(saveDistrict)?.name : null });
    return { ok: true, pact: p.id };
  }
  _vGive(a, args, reason) {
    const other = this._resolveAgent(args.target || args.to);
    if (!other) return this._hesitate(a, 'give to whom? pass target:"@handle".');
    const want = Math.round(Number(args.amount) || 0);
    if (want <= 0) return this._hesitate(a, 'give how much? pass amount:n.');
    if (a.gold < want) return this._hesitate(a, `not enough gold on hand (you have ${a.gold}).`);
    const amt = Math.min(a.gold, want);
    a.gold -= amt; other.gold += amt;
    this._receipt(a.id, 'give', other.id, reason || `gave ${amt} gold to ${other.name}.`);
    return { ok: true, onHand: a.gold };
  }
  _vVote(a, args, reason) {
    // allocate all STONES across districts. abstention impossible: sum must equal STONES.
    let stones = args.stones || args.save;
    if (Array.isArray(stones)) { const each = {}; const per = Math.floor(STONES / stones.length) || 1; stones.forEach(s => { const did = this._resolveDistrict(s); if (did) each[did] = (each[did] || 0) + per; }); stones = each; }
    if (typeof stones === 'string') stones = { [this._resolveDistrict(stones)]: STONES };
    if (!stones || typeof stones !== 'object') return this._hesitate(a, `back the levees: pass stones:{"District Name": n, ...} summing to ${STONES}.`);
    const norm = {}; let sum = 0;
    for (const k in stones) { const did = this._resolveDistrict(k); const n = Math.max(0, Math.round(Number(stones[k]) || 0)); if (did && n) { norm[did] = (norm[did] || 0) + n; sum += n; } }
    if (sum !== STONES) return this._hesitate(a, `you must allocate exactly ${STONES} levee stones (you allocated ${sum}). Abstention is impossible.`);
    const sealed = args.sealed_intention || args.sealed || null;
    a.ballot = { stones: norm, sealed: sealed ? { expected_drown: sealed.expected_drown || null, confidence: Number(sealed.confidence) || 0, note: String(sealed.note || '').slice(0, 160) } : null, publicReason: reason || '' };
    this._receipt(a.id, 'back', null, reason ? `sealed a levee vote — "${reason}"` : `sealed a levee vote.`, { sealed: true });
    const offBallot = Object.keys(norm).filter(did => !this.storm.ballot.includes(did)).map(did => this.district(did)?.name).filter(Boolean);
    return { ok: true, sealed: true, stones: this._stoneNames(norm), ...(offBallot.length ? { note: `heads up — these get wasted (not on this tide's ballot): ${offBallot.join(', ')}` } : {}) };
  }

  _resolveAgent(x) { if (!x) return null; if (this.agents[x]) return this.agents[x]; return this.agentByHandle(String(x).replace(/^@/, '')) || Object.values(this.agents).find(a => a.name === x) || null; }
  _resolveDistrict(x) { if (!x) return null; const d = this.town.districts.find(d => d.id === x || d.name.toLowerCase() === String(x).toLowerCase()); return d ? d.id : null; }
  _stoneNames(m) { const o = {}; for (const did in m) { const d = this.district(did); if (d) o[d.name] = m[did]; } return o; }

  // ── receipts / events ───────────────────────────────────────────────────────
  _receipt(actorId, verb, target, text, extra = {}) {
    const a = actorId ? this.agents[actorId] : null;
    const r = { id: id('r'), seq: ++this.seq, ts: now(), actor: a?.handle || null, actorName: a?.name || 'The River', role: a?.role || null, verb, target, text, ...extra };
    this.receipts.push(r); if (this.receipts.length > 600) this.receipts.splice(0, this.receipts.length - 600);
    this.emit('event', { kind: 'receipt', receipt: r });
    return r;
  }
  _touch() { this.emit('state'); }
  stop() { clearInterval(this._loop); }
}

export { STONES, ROLES };
