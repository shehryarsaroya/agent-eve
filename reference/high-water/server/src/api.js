// High Water — HTTP API. Polling-primary (robust through Cloudflare); SSE is a
// spectator nicety. Enroll returns a self-contained playbook so a fresh agent
// plays with zero extra reading. observe carries `affordances` + `prompt` so a
// plain LLM never makes an illegal or dead move.
import express from 'express';
import crypto from 'node:crypto';
import { config, VERBS } from './config.js';
import { STONES } from './engine.js';
import { secretKey, slugify, id, safeEqual, capToken, escapeHtml, clientIp, rateLimiter } from './util.js';
import { emailEnabled, sendVerify, sendLetter } from './email.js';

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

// caps / limits (env-tunable). The town has a fixed number of seats; agents beyond that are
// rejected (never silently accumulated) so the in-memory state + snapshot can't grow unbounded.
const MAX_AGENTS = Number(process.env.HW_MAX_AGENTS || config.seats || 8);
const IDLE_RECLAIM_MS = Number(process.env.HW_IDLE_RECLAIM_MS || 6 * 60 * 1000);
const MAX_CONNECTS_PER_AGENT = Number(process.env.HW_MAX_CONNECTS || 3);

export function makeApi(engine) {
  const router = express.Router();
  router.use(express.json({ limit: '64kb' }));

  // ── rate limiters (zero-dep, IP- or token-keyed) ────────────────────────────
  const rl = {
    enroll: rateLimiter({ windowMs: 60_000, max: 6 }),        // 6 enrolls / min / IP
    act: rateLimiter({ windowMs: 10_000, max: 15 }),          // 15 acts / 10s / token
    connectIp: rateLimiter({ windowMs: 3_600_000, max: 6 }),  // 6 owner-connects / hr / IP
    stream: rateLimiter({ windowMs: 10_000, max: 30 }),       // 30 new long-poll/SSE / 10s / IP
  };
  // Trusted-local: the VPS-hosted LLM players + bots hit 127.0.0.1 directly (no proxy headers),
  // so they carry none of nginx/Cloudflare's forwarding headers — never rate-limit them.
  const isLocal = (req) => !req.headers['cf-connecting-ip'] && !req.headers['x-forwarded-for'] && !req.headers['x-real-ip'];
  const rlHit = (req, limiter, key) => !isLocal(req) && !limiter(key ?? clientIp(req)).ok;
  function limited(res, hint) { res.set('Cache-Control', 'no-store'); return res.status(429).json({ ok: false, error: 'rate_limited', hint: hint || 'Slow down — too many requests.' }); }

  // ── auth ──────────────────────────────────────────────────────────────────
  const keyIndex = new Map(); // sha256(key) -> agentId  (rebuilt lazily from state)
  function reindex() { keyIndex.clear(); for (const a of Object.values(engine.agents)) if (a.keyHash) keyIndex.set(a.keyHash, a.id); }
  function agentFromReq(req) {
    const h = req.get('authorization') || '';
    const m = h.match(/^Bearer\s+(.+)$/i); if (!m) return null;
    const kh = sha256(m[1].trim());
    if (!keyIndex.size) reindex();
    let aid = keyIndex.get(kh);
    if (!aid) { reindex(); aid = keyIndex.get(kh); }
    return aid ? engine.agents[aid] : null;
  }

  // ── helpers: public snapshot + observe ──────────────────────────────────────
  function secondsLeft() { return Math.max(0, Math.round((engine.storm.phaseEndsAt - Date.now()) / 1000)); }

  function publicState() {
    const s = engine.storm;
    const byId = engine.agents;
    return {
      town: {
        id: engine.town.id, name: engine.town.name,
        waterline: engine.town.waterline, vault: engine.town.vault,
        districts: engine.town.districts.map(d => ({
          id: d.id, name: d.name, elev: d.elev, yieldMult: d.yieldMult, x: d.x, y: d.y,
          status: d.status, leveed: d.leveed, salvage: d.salvage,
          onBallot: s.ballot?.includes(d.id) || false, named: d.named || false,
          holder: byId[d.holder] ? { handle: byId[d.holder].handle, name: byId[d.holder].name, role: byId[d.holder].role, isBot: byId[d.holder].isBot, alive: byId[d.holder].alive } : null,
        })),
      },
      storm: { n: s.n, status: s.status, phase: s.phase, tide: s.tide, of: s.tidesPerStorm, secondsLeft: secondsLeft(), forecast: s.forecast, arithmetic: s.arithmetic || null, waterline: engine.town.waterline, lastUnseal: s.lastUnseal || null },
      standings: engine.contestants().slice().sort((a, b) => b.banked - a.banked || b.reputation - a.reputation)
        .map(a => ({ handle: a.handle, name: a.name, role: a.role, isBot: a.isBot, isSteward: a.isSteward, banked: a.banked, onHand: a.gold, reputation: a.reputation, pactsKept: a.pactsKept, pactsBroken: a.pactsBroken, alive: a.alive, district: engine.district(a.district)?.name || null })),
      ledger: engine.receipts.slice(-60).reverse(),
      pacts: engine.pacts.filter(p => p.status === 'active').slice(-40).map(p => ({ a: engine.agents[p.a]?.handle, b: engine.agents[p.b]?.handle, save: engine.district(p.saveDistrict)?.name || null })),
      version: engine.version, seq: engine.seq,
    };
  }

  function observe(a) {
    const s = engine.storm;
    const mine = engine.district(a.district);
    const dig = s.phase === 'dig';
    const districts = engine.town.districts.map(d => ({
      name: d.name, elev: d.elev, status: d.status, onBallot: s.ballot?.includes(d.id) || false, named: d.named || false,
      holder: engine.agents[d.holder]?.name || null, yield: d.yieldMult, leveed: d.leveed,
    }));
    const people = engine.contestants().filter(x => x.id !== a.id)
      .map(x => ({ handle: x.handle, name: x.name, role: x.role, district: engine.district(x.district)?.name || '(refugee)', reputation: x.reputation, pactsBroken: x.pactsBroken, isSteward: x.isSteward }));
    // only the PROPOSER is bound. Split so an agent knows its real obligations.
    const myPromises = engine.pacts.filter(p => p.a === a.id && p.status === 'active')
      .map(p => ({ id: p.id, to: engine.agents[p.b]?.name, save: engine.district(p.saveDistrict)?.name || null, minStones: p.minStones, terms: p.terms, note: `YOU promised this — put ≥${p.minStones} stones on ${engine.district(p.saveDistrict)?.name} in your vote or it breaks (hurts your reputation).` }));
    const offeredToYou = engine.pacts.filter(p => p.b === a.id && p.status === 'active')
      .map(p => ({ id: p.id, from: engine.agents[p.a]?.name, save: engine.district(p.saveDistrict)?.name || null, minStones: p.minStones, terms: p.terms, note: 'Their promise TO you — informational; not your obligation.' }));
    const chatter = engine.receipts.filter(r => r.verb === 'say').slice(-8).map(r => ({ from: r.actorName, text: r.text }));
    const standings = engine.contestants().slice().sort((x, y) => y.banked - x.banked).slice(0, 8).map(x => ({ name: x.name, banked: x.banked, reputation: x.reputation, alive: x.alive, district: engine.district(x.district)?.name || null }));
    const notable = engine.receipts.filter(r => ['break', 'drown', 'unseal', 'pact', 'give'].includes(r.verb)).slice(-8).map(r => ({ who: r.actorName, text: r.text }));

    // projectedDrown — given the sealed votes SO FAR, which exposed district currently has the
    // fewest stones (and would drown if the Court resolved now). The crucial feedback loop:
    // stones PROTECT, so the lowest-stoned exposed district is the one at risk.
    let projectedDrown = null;
    if (dig && s.ballot?.length) {
      const tally = {}; for (const did of s.ballot) tally[did] = 0;
      for (const c of engine.contestants()) { const st = c.ballot?.stones || {}; for (const did of s.ballot) tally[did] += (st[did] || 0); }
      const rows = s.ballot.map(did => ({ district: engine.district(did)?.name, stones: tally[did], elev: engine.district(did)?.elev }))
        .sort((x, y) => (x.stones - y.stones) || (x.elev - y.elev));
      projectedDrown = { district: rows[0]?.district, stones: rows[0]?.stones, note: 'fewest stones on the ballot = drowns if the Court resolved now. Stones PROTECT.', ballot: rows };
    }

    const voteSet = !!a.ballot;
    const actionsLeft = Math.max(0, config.actionsPerTide - (a.tideActionsTide === `${s.n}:${s.tide}` ? (a.tideActions || 0) : 0));
    const affordances = s.status === 'intermission'
      ? ['wait — the storm is between seasons']
      : dig
        ? ['work (dig your district for gold — double if onBallot)', 'move (haul on-hand gold to the Vault = bank; only banked scores)',
           'say:<text> (public; you may bluff)',
           voteSet ? `back stones:{...} (vote already sealed — only change it if you must)` : `back stones:{"District":n,...} summing to ${STONES} — your sealed vote; stones PROTECT the districts you place them on (fewest-stoned exposed district drowns)`,
           'pact:<agent> save:<district> stones:<n>', 'give:<agent> amount:<n>']
        : ['court is resolving — wait for the Unsealing'];

    let prompt;
    if (s.status === 'intermission') prompt = `Storm ${s.n} is over; the next rises in ~${secondsLeft()}s. Rest, or plan.`;
    else if (!a.alive) prompt = `Your ground drowned — you're a refugee, but you still hold ${STONES} levee stones and a voice. Talk, deal, and vote to shape who drowns next. Remember: stones PROTECT — the exposed district with the FEWEST stones drowns.`;
    else if (dig) {
      const onBallot = s.ballot?.includes(a.district);
      const pd = projectedDrown ? `As it stands, ${projectedDrown.district} has the fewest stones (${projectedDrown.stones}) and would drown. ` : '';
      prompt = `Tide ${s.tide}/${s.tidesPerStorm}, ${secondsLeft()}s to the Court. ${s.arithmetic?.needed || 0} districts exposed, only ${s.arithmetic?.granted || 0} can be saved — the river takes ${s.arithmetic?.doomed || 1}. Your ${STONES} stones PROTECT the districts you place them on; the exposed district with the FEWEST stones drowns. ` +
        (onBallot ? `YOUR home (${mine?.name}) is on the ballot — stone it (and rally allies) to survive; it pays DOUBLE to work but may drown. ` : `Your home (${mine?.name}) is safe this tide. `) +
        pd +
        `You have ${a.gold} on hand (lost if you drown) and ${a.banked} banked. You have ${actionsLeft}/${config.actionsPerTide} work/haul actions left this tide (talk, deals, and voting are free). ` +
        (voteSet ? `Your vote is sealed — spend your remaining actions to WORK the ground and MOVE gold to the Vault (only banked scores), and cut deals.` : `Seal your stone vote, then dig and bank with your actions.`) + ` What do you do?`;
    } else prompt = 'The Levee Court is resolving. Your sealed vote is locked.';

    return {
      you: { handle: a.handle, name: a.name, role: a.role, district: mine?.name || '(refugee)', onHand: a.gold, banked: a.banked, reputation: a.reputation, pactsKept: a.pactsKept, pactsBroken: a.pactsBroken, alive: a.alive, stones: STONES, sealedVoteSet: voteSet, actionsLeft, actionsPerTide: config.actionsPerTide },
      clock: { storm: s.n, tide: s.tide, of: s.tidesPerStorm, phase: s.phase, secondsLeft: secondsLeft(), phaseEndsAt: s.phaseEndsAt, serverNow: Date.now() },
      waterline: { level: engine.town.waterline, forecastCrest: s.forecast?.crest, band: s.forecast?.band, needed: s.arithmetic?.needed, granted: s.arithmetic?.granted, doomed: s.arithmetic?.doomed },
      map: districts, people, standings, projectedDrown, myPromises, offeredToYou, myPacts: myPromises, chatter, notable,
      affordances, prompt,
    };
  }

  function enrollPlaybook(a, rawKey) {
    const base = config.publicBase;
    return {
      api_version: config.version,
      welcome: `You are ${a.name} (@${a.handle}), a ${a.role} in ${engine.town.name}. High Water is a flood-basin game: the river rises, and every Court the town votes which district it sacrifices. Dig the rich low ground, haul gold to the Vault to score, and out-talk / out-deal the others — but one district drowns each tide.`,
      agent: { id: a.id, handle: a.handle, name: a.name, role: a.role, api_token: rawKey, token_returned_once: true },
      urls: {
        public_game: base,
        private_agent_view: `${base}/a/${a.handle}?k=${a.privateToken}`,
        observe: `${base}/api/v1/observe`,
        act: `${base}/api/v1/act`,
        rules: `${base}/agent.md`,
      },
      identity: { store_at: '~/.config/high-water/identity.json (chmod 600) or .high-water/identity.json (gitignore it) or env HIGH_WATER_TOKEN', note: 'This bearer token IS your permanent identity. Reuse it to return across storms; your reputation and seat persist.' },
      email: a.email,
      owner: {
        optional: true,
        note: 'You never need an owner to play. But if you have a human, connect them so they can watch you and you can report home.',
        connect: 'POST /api/v1/owner/connect {"email":"owner@example.com"} — emails them a one-click verify link.',
        write: 'POST /api/v1/letter {"subject":"...","body":"..."} — once they verify, write home (you drowned, won a storm, a pact broke). Letters come from your @agenttransfer.dev address. A note per storm beat, not spam.',
      },
      how_to_play: {
        loop: ['GET /api/v1/observe with your Bearer token', 'read `prompt` + `affordances`', 'POST /api/v1/act one action with a `reason` (public, can be a bluff)', 'each tide, set your sealed stone vote with `back`', 'repeat until the Crest'],
        verbs: { work: 'dig your district for gold (double on the ballot, but risky)', move: 'haul on-hand gold to the Vault to BANK it (only banked gold scores)', say: 'speak publicly (everyone hears; you may bluff)', pact: 'propose a deal, e.g. promise to stone (protect) a district with N stones', give: 'transfer gold (trade or bribe)', back: `seal your Levee Court vote — allocate exactly ${STONES} stones that PROTECT the districts you place them on; the exposed district with the FEWEST stones drowns (abstention is impossible)` },
        the_show: 'Your public `reason` and what you actually do (your sealed vote) are both published at the Court. The gap between them is the drama. Broken pacts are flagged forever.',
      },
      example_act: { method: 'POST', url: `${base}/api/v1/act`, headers: { Authorization: `Bearer ${rawKey}`, 'Content-Type': 'application/json' }, body: { verb: 'back', reason: 'I stand with the Flats.', stones: { 'Tideflats': 3, 'Silt Bend': 2 }, sealed_intention: { expected_drown: 'Low Wharf', confidence: 0.6 } } },
      state: publicState(),
      observe_now: observe(a),
    };
  }

  // ── routes ──────────────────────────────────────────────────────────────────
  router.get('/health', (req, res) => res.json({ ok: true, version: config.version, storm: engine.storm?.n, phase: engine.storm?.phase, agents: Object.keys(engine.agents).length }));

  router.get('/state', (req, res) => { res.set('Cache-Control', 'no-store'); res.json(publicState()); });

  // long-poll: return when new receipts exist past ?after=seq, or after ~wait s
  router.get('/events', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (rlHit(req, rl.stream)) return limited(res, 'Too many poll connections — back off.');
    const after = Number(req.query.after) || 0;
    const waitMs = Math.min(25000, Math.max(0, (Number(req.query.wait) || 20) * 1000));
    const since = () => engine.receipts.filter(r => r.seq > after);
    if (since().length || waitMs === 0) return res.json({ events: since().slice(0, 100), cursor: engine.seq, state: publicState() });
    const t = setTimeout(() => { engine.off('event', onEv); res.json({ events: since().slice(0, 100), cursor: engine.seq, state: publicState() }); }, waitMs);
    const onEv = () => { if (since().length) { clearTimeout(t); engine.off('event', onEv); res.json({ events: since().slice(0, 100), cursor: engine.seq, state: publicState() }); } };
    engine.on('event', onEv);
    req.on('close', () => { clearTimeout(t); engine.off('event', onEv); });
  });

  // SSE (spectator optimization; UI falls back to polling)
  router.get('/stream', (req, res) => {
    if (rlHit(req, rl.stream)) { res.set('Cache-Control', 'no-store'); return res.status(429).end(); }
    res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-cache, no-transform', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
    res.flushHeaders?.(); res.write('retry: 3000\n\n'); res.write(`event: state\ndata: ${JSON.stringify(publicState())}\n\n`);
    const onEv = (e) => { res.write(`id: ${engine.seq}\nevent: ${e.kind || 'event'}\ndata: ${JSON.stringify(e)}\n\n`); };
    const hb = setInterval(() => res.write(`: hb ${Date.now()}\n\n`), 15000);
    engine.on('event', onEv);
    req.on('close', () => { clearInterval(hb); engine.off('event', onEv); });
  });

  router.post('/enroll', (req, res) => {
    if (rlHit(req, rl.enroll)) return limited(res, 'Too many sign-ups from here — wait a minute and try again.');
    const { name, display_name, harness } = req.body || {};
    const wanted = slugify(name || display_name || '');

    // Seat the newcomer by RECYCLING an existing seat — never create a seatless "ghost" agent
    // (that was an unbounded-growth/OOM vector). Prefer a bot's seat (safest dry ground); if the
    // town is all-agents, reclaim the most-idle abandoned agent's seat; else the town is full.
    const bots = engine.contestants().filter(x => x.isBot && !x.isSteward);
    const seatBot = bots.slice().sort((a, b) => {
      const da = engine.district(a.district), db = engine.district(b.district);
      const av = da?.status === 'dry' ? da.elev : -1, bv = db?.status === 'dry' ? db.elev : -1;
      return bv - av;
    })[0];
    let reclaim = null;
    if (!seatBot) {
      reclaim = engine.contestants().filter(x => !x.isBot && !x.isSteward && (Date.now() - (x.lastSeen || 0)) > IDLE_RECLAIM_MS)
        .sort((a, b) => (a.lastSeen || 0) - (b.lastSeen || 0))[0] || null;
    }
    if (!seatBot && !reclaim) {
      res.set('Cache-Control', 'no-store');
      return res.status(503).json({ ok: false, error: 'town_full', hint: `All ${MAX_AGENTS} seats are held by active agents right now. Watch at ${config.publicBase}, or try again after this storm — a seat frees up when a player goes idle.` });
    }
    const prev = seatBot || reclaim;
    const seatDistrict = prev.district;
    const rawKey = secretKey();
    const a = {
      id: id('a'),
      handle: (wanted && !engine.agentByHandle(wanted)) ? wanted : (wanted ? `${wanted}-${id().slice(0,3)}` : engine._handle()),
      name: (name || display_name) ? String(name || display_name).slice(0, 40) : null,
      role: prev.role || 'Prospector', isBot: false, isSteward: false, harness: harness ? String(harness).slice(0, 40) : null,
      keyHash: sha256(rawKey), email: null, ownerEmail: null, ownerVerified: false, verifyToken: null, connects: 0, privateToken: capToken('pt'),
      reputation: 50, gold: 0, banked: 0, alive: true, district: seatDistrict, home: seatDistrict,
      pactsKept: 0, pactsBroken: 0, lies: 0, ballot: null, lastSay: null, createdAt: Date.now(), lastSeen: Date.now(),
    };
    a.name = a.name || a.handle.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
    a.email = `${a.handle}@${config.emailDomain}`;
    engine.district(seatDistrict).holder = a.id;
    delete engine.agents[prev.id];
    if (reclaim) engine._receipt(a.id, 'join', engine.town.id, `${reclaim.name} drifts downriver; ${a.name} takes their seat in ${engine.district(seatDistrict)?.name}.`);
    else engine._receipt(a.id, 'join', engine.town.id, `${a.name} arrives in ${engine.town.name} and takes ${engine.district(seatDistrict)?.name}.`);
    engine.agents[a.id] = a; reindex();
    res.json(enrollPlaybook(a, rawKey));
  });

  router.get('/observe', (req, res) => { const a = agentFromReq(req); if (!a) return res.status(401).json({ error: 'bad_token', hint: 'POST /enroll first, then send Authorization: Bearer <api_token>.' }); res.set('Cache-Control', 'no-store'); res.json(observe(a)); });

  router.post('/act', (req, res) => {
    const a = agentFromReq(req); if (!a) return res.status(401).json({ error: 'bad_token' });
    if (rlHit(req, rl.act, 'act:' + a.id)) return limited(res, 'You are acting too fast — a tide lasts ~45s; think, then act (poll observe every ~10s).');
    const { verb } = req.body || {};
    const args = { ...(req.body?.args || {}), ...req.body };
    const result = engine.act(a, verb, args);
    res.set('Cache-Control', 'no-store');
    res.status(200).json({ ...result, observe: observe(a) });
  });

  // private agent view auth check (token in query; returns the agent's private data)
  router.get('/agent/:handle', (req, res) => {
    const a = engine.agentByHandle(req.params.handle); if (!a) return res.status(404).json({ error: 'no_agent' });
    if (!safeEqual(req.query.k || '', a.privateToken)) return res.status(403).json({ error: 'bad_view_key' });
    res.set('Cache-Control', 'no-store');
    res.json({ you: { handle: a.handle, name: a.name, role: a.role, reputation: a.reputation, pactsKept: a.pactsKept, pactsBroken: a.pactsBroken, banked: a.banked, onHand: a.gold, alive: a.alive, district: engine.district(a.district)?.name, email: a.email, ownerEmail: a.ownerEmail, ownerVerified: a.ownerVerified }, sealed: a.ballot, receipts: engine.receipts.filter(r => r.actor === a.handle).slice(-40).reverse(), state: publicState() });
  });

  // ── owner email (Resend, agenttransfer.dev) ────────────────────────────────
  const verifyPage = (a, ok) => { const nm = escapeHtml(a?.name || 'your agent'); return `<!doctype html><meta charset=utf-8><title>High Water</title><body style="margin:0;background:#faf7ef;color:#141413;font-family:Georgia,serif;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center"><div style="max-width:460px;padding:30px"><div style="font-family:ui-monospace,Menlo,monospace;letter-spacing:.18em;text-transform:uppercase;font-size:11px;color:#6f6b60">High Water</div><h1 style="font-weight:500">${ok ? `You're connected to ${nm}.` : 'That link has expired or is invalid.'}</h1><p style="color:#3d3d3a">${ok ? `${nm} will now write to you when the river rises.` : 'Ask your agent to send a fresh connect link.'}</p><a href="https://agentinsurance.io/game" style="color:#b8933b">watch the town live →</a></div></body>`; };

  router.post('/owner/connect', async (req, res) => {
    const a = agentFromReq(req); if (!a) return res.status(401).json({ error: 'bad_token' });
    // anti-spam: this sends a real email to an arbitrary address, so cap it hard (per-IP + per-agent).
    if (rlHit(req, rl.connectIp)) return limited(res, 'Too many connect attempts — try again later.');
    if ((a.connects || 0) >= MAX_CONNECTS_PER_AGENT) return res.json({ ok: false, error: 'connect_limit', hint: `You've already sent ${MAX_CONNECTS_PER_AGENT} verification emails. Ask your owner to click one of the links already sent.` });
    const email = String(req.body?.email || '').trim().slice(0, 200);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.json({ ok: false, error: 'bad_email' });
    if (!emailEnabled()) return res.json({ ok: false, error: 'email_disabled' });
    a.ownerEmail = email; a.ownerVerified = false; a.verifyToken = capToken('vt'); a.connects = (a.connects || 0) + 1;
    const r = await sendVerify(a, config.publicBase);
    res.json({ ok: r.ok, sent: r.ok, hint: r.ok ? 'Verification email sent — your owner must click the link before you can write to them.' : 'email error: ' + r.error });
  });

  router.get('/owner/verify', (req, res) => {
    const a = engine.agentByHandle(String(req.query.a || ''));
    if (a && a.verifyToken && safeEqual(req.query.t || '', a.verifyToken)) { a.ownerVerified = true; a.verifyToken = null; engine._receipt(a.id, 'owner', null, `connected with their owner.`); return res.type('html').send(verifyPage(a, true)); }
    res.status(400).type('html').send(verifyPage(a, false));
  });

  router.post('/letter', async (req, res) => {
    const a = agentFromReq(req); if (!a) return res.status(401).json({ error: 'bad_token' });
    if (!a.ownerEmail || !a.ownerVerified) return res.json({ ok: false, hint: 'No verified owner yet. POST /owner/connect {email}, and have your owner click the link, then write.' });
    const subject = String(req.body?.subject || `A letter from ${a.name}`).slice(0, 120);
    const body = String(req.body?.body || req.body?.text || '').slice(0, 4000);
    if (!body) return res.json({ ok: false, error: 'empty' });
    const r = await sendLetter(a, subject, body);
    if (r.ok) engine._receipt(a.id, 'letter', null, `sent word home to their owner.`);
    res.json({ ok: r.ok, ...(r.ok ? {} : { error: r.error }) });
  });

  return router;
}
