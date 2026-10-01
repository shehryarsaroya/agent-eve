/**
 * The recap: one principal's night, told from published frames — and never wrong about it.
 *
 * Two kinds of check. Synthetic frames pin each rule exactly (a default leads, a negative
 * difference prints nothing, old news is not repeated, agent free text never reaches mail).
 * A real simulated world then proves the rules hold on frames the engine actually wrote, for
 * every principal in it: every count the recap prints equals the difference between two
 * published STANDING rows, and nothing else (A5′).
 */

import { describe, expect, it, beforeAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PrincipalId } from '../../src/core/types.js';
import type { ReckoningFrame, RundownSegment } from '../../src/frames/contract.js';
import { DEFAULT_ARGS, runSim } from '../../src/sim/cli.js';
import { frameFileName, LATEST } from '../../src/frames/write.js';
import { buildRecap, composeRecap, fmt, followLinks, readPublishedFrame, MAX_RECAP_EVENTS } from '../../src/api/follow/index.js';
import { frame, standing } from './helpers.js';

const P = (h: string): PrincipalId => `p:${h}` as PrincipalId;

function beat(over: Partial<RundownSegment>): RundownSegment {
  return {
    order: 1,
    kind: 'SETTLEMENT',
    subject: 'v-1',
    venture: 'v-1' as never,
    cast: [],
    publicLine: null,
    sealVerdict: null,
    deed: "orison's 4K was riding on vale's haul.",
    glyph: { venture: 'v-1', stage: 'sys-1', rolesFilled: 1, rolesTotal: 1, electiveBps: 5000, state: 'CLOSED_GOLD' },
    consequence: '',
    receiptReel: null,
    grant: null,
    actedBy: null,
    onBehalfOf: null,
    ...over,
  } as RundownSegment;
}

describe('the lead says what the STANDING difference says, and nothing more', () => {
  it('a default leads, in exact numbers, and stays the headline even beside kept promises', () => {
    const prev = frame(4, { standings: [standing('vale', { electiveHonoured: 5, defaults: 1, distinctCounterparties: 3 })] });
    const now = frame(5, {
      standings: [standing('vale', { electiveHonoured: 7, electiveHonouredValue: 1200 as never, defaults: 2, distinctCounterparties: 4, lastDefaultTick: 5 * 288 + 287 })],
    });
    const r = buildRecap({ frame: now, previous: prev, handle: 'vale' });
    expect(r.tone).toBe('broke');
    expect(r.subject).toBe('vale broke a promise · Reckoning 5');
    expect(r.lead).toContain('vale defaulted on an elective promise in Reckoning 5');
    expect(r.lead).toContain('It kept 2 others');
    expect(r.record).toContain('7 elective promises kept, worth 1,200, across 4 counterparties; 2 defaults, the last in Reckoning 5');
    expect(r.record).toContain('Since the last Reckoning: 2 more kept, 1 new default and 1 new counterparty.');
  });

  it('kept promises lead when none broke, with the value kept tonight', () => {
    const prev = frame(1, { standings: [standing('vale', { electiveHonoured: 1, electiveHonouredValue: 100 as never })] });
    const now = frame(2, { standings: [standing('vale', { electiveHonoured: 4, electiveHonouredValue: 13_100 as never })] });
    const r = buildRecap({ frame: now, previous: prev, handle: 'vale' });
    expect(r.tone).toBe('kept');
    expect(r.subject).toBe('vale kept 3 promises · Reckoning 2');
    expect(r.lead).toBe('vale kept its word in Reckoning 2: it honoured 3 elective promises, worth 13,000, and broke none.');
  });

  it('a night with no change and no news is called quiet, honestly', () => {
    const row = standing('vale', { electiveHonoured: 2 });
    const r = buildRecap({ frame: frame(3, { standings: [row] }), previous: frame(2, { standings: [row] }), handle: 'vale' });
    expect(r.tone).toBe('quiet');
    expect(r.events).toEqual([]);
    expect(r.record).toContain('None of it moved this Reckoning.');
  });

  it('a principal with no row has no record yet — never a row of fabricated zeros', () => {
    const r = buildRecap({ frame: frame(3, { standings: [standing('orison')] }), previous: frame(2), handle: 'vale' });
    expect(r.tone).toBe('new');
    expect(r.record).toBe('');
    expect(r.lead).toContain('vale has no public record yet');
  });

  it('Reckoning 0 is compared against genesis, which is exact: everything on the row happened tonight', () => {
    const r = buildRecap({ frame: frame(0, { standings: [standing('vale', { electiveHonoured: 2 })] }), previous: null, handle: 'vale' });
    expect(r.tone).toBe('kept');
    expect(r.lead).toContain('honoured 2 elective promises');
  });
});

describe('A5′ — a difference that cannot be honest is never printed', () => {
  const now = frame(9, { standings: [standing('vale', { electiveHonoured: 3, defaults: 0 })] });

  it('no previous frame: the record is stated, no count of tonight is claimed', () => {
    const r = buildRecap({ frame: now, previous: null, handle: 'vale' });
    expect(r.tone).toBe('unknown');
    expect(r.record).not.toContain('Since the last Reckoning');
    expect(r.lead).not.toMatch(/kept|defaulted/);
  });

  it('a previous frame that is not the night before is refused (a re-seeded archive)', () => {
    const stale = frame(40, { standings: [standing('vale', { electiveHonoured: 0 })] });
    expect(buildRecap({ frame: now, previous: stale, handle: 'vale' }).tone).toBe('unknown');
    const gap = frame(7, { standings: [standing('vale')] });
    expect(buildRecap({ frame: now, previous: gap, handle: 'vale' }).tone).toBe('unknown');
  });

  it('a vector that FELL means two histories, and no figure is derived from them', () => {
    const forked = frame(8, { standings: [standing('vale', { electiveHonoured: 10, defaults: 0 })] });
    const r = buildRecap({ frame: now, previous: forked, handle: 'vale' });
    expect(r.tone).toBe('unknown');
    expect(r.record).not.toContain('Since the last Reckoning');
  });
});

describe('the night’s events', () => {
  it('a settlement beat is quoted from the frame’s own deed, for a role-holder AND for the payer', () => {
    // The creator who pays holds no role, so it is not in `cast` — measured on a real frame.
    const deed = "sable's 2K was riding on varrow's dig. sable walked away from 382 of the 2K it had promised.";
    const seg = beat({ deed, cast: [{ principal: P('varrow'), handle: 'varrow' as never, line: '', modelBadge: null }], glyph: { venture: 'v-1', stage: 'sys-1', rolesFilled: 1, rolesTotal: 1, electiveBps: 1, state: 'SNAPPED_BLACK' } as never });
    const f = frame(2, { standings: [standing('sable'), standing('varrow')], rundown: [seg] });
    const prev = frame(1, { standings: [standing('sable'), standing('varrow')] });
    expect(buildRecap({ frame: f, previous: prev, handle: 'varrow' }).events).toContain(deed);
    expect(buildRecap({ frame: f, previous: prev, handle: 'sable' }).events).toContain(deed);
    // A handle that is a PREFIX of the payer's is not the payer.
    expect(buildRecap({ frame: f, previous: prev, handle: 'sab' }).events).toEqual([]);
  });

  it('the principal’s OWN broken promise leads, ahead of a partner’s', () => {
    const snappedGlyph = { venture: 'v-1', stage: 'sys-1', rolesFilled: 1, rolesTotal: 1, electiveBps: 1, state: 'SNAPPED_BLACK' } as never;
    const partners = beat({
      order: 1,
      subject: 'v-1',
      venture: 'v-1' as never,
      deed: "sable's 2K was riding on vex's dig. sable walked away from 382 of the 2K it had promised.",
      cast: [{ principal: P('vex'), handle: 'vex' as never, line: '', modelBadge: null }],
      glyph: snappedGlyph,
    });
    const own = beat({
      order: 2,
      subject: 'v-2',
      venture: 'v-2' as never,
      deed: "vex's 3K was riding on sable's escort. vex walked away from 123 of the 3K it had promised.",
      cast: [{ principal: P('sable'), handle: 'sable' as never, line: '', modelBadge: null }],
      glyph: snappedGlyph,
    });
    const f = frame(2, { standings: [standing('vex'), standing('sable')], rundown: [partners, own] });
    const r = buildRecap({ frame: f, previous: frame(1, { standings: [standing('vex'), standing('sable')] }), handle: 'vex' });
    expect(r.events[0]).toContain('vex walked away');
    expect(r.events[1]).toContain('sable walked away');
  });

  it('the payer is also found through the compact link for the same venture', () => {
    const seg = beat({ deed: 'a sentence that does not start with a handle.' });
    const f = frame(2, {
      standings: [standing('vale')],
      rundown: [seg],
      compactLinks: [{ venture: 'v-1', kind: 'HAUL', stage: 'sys-1', state: 'SETTLED', a: P('vale'), aAt: 'sys-1', b: null, bAt: null, parties: 1, electiveBps: 0, atStake: 0, snapped: false, grant: null, legend: '' }] as never,
    });
    expect(buildRecap({ frame: f, previous: frame(1, { standings: [standing('vale')] }), handle: 'vale' }).events).toEqual([
      'a sentence that does not start with a handle.',
    ]);
  });

  it('a delegated deed names who acted, in whose name, under a grant', () => {
    const seg = beat({ actedBy: P('quill'), onBehalfOf: P('vale'), deed: "vale's 5K was riding on orison's haul." });
    const f = frame(2, { standings: [standing('vale'), standing('quill')], rundown: [seg] });
    const r = buildRecap({ frame: f, previous: frame(1), handle: 'quill' });
    expect(r.events[0]).toContain("quill did it in vale's name, under a grant.");
  });

  it('a broken promise outranks every other line, and the list is capped', () => {
    const lines = Array.from({ length: 10 }, (_, i) => ({
      raid: `r-${String(i)}`, stage: 'sys-1', target: P('vale'), initiator: null, demand: 10, state: 'REPULSED', lost: 0, raiderForce: 1, defenderForce: 2, ticksLeft: 0, defenders: [], raiders: [],
    }));
    const snapped = beat({ deed: "vale's 1K was riding on orison's haul. vale walked away from all 1000 it had promised.", glyph: { venture: 'v-1', stage: 'sys-1', rolesFilled: 1, rolesTotal: 1, electiveBps: 1, state: 'SNAPPED_BLACK' } as never });
    const f = frame(2, { standings: [standing('vale')], raidLines: lines as never, rundown: [snapped] });
    const r = buildRecap({ frame: f, previous: frame(1, { standings: [standing('vale')] }), handle: 'vale' });
    expect(r.events.length).toBe(MAX_RECAP_EVENTS);
    expect(r.events[0]).toContain('walked away');
  });

  it('a raid already resolved the same way last night is old news and is not repeated', () => {
    const paid = { raid: 'r-1', stage: 'sys-1', target: P('vale'), initiator: null, demand: 700, state: 'PAID', lost: 0, raiderForce: 1, defenderForce: 0, ticksLeft: 0, defenders: [], raiders: [] };
    const map = [{ id: 'sys-1', name: 'Nettle', tier: 'COMMONS', constellation: 'con-1', lanes: [], straits: [], yieldPerTick: 0, fuelPerTick: 0, richnessBps: 0 }];
    const tonight = frame(3, { standings: [standing('vale')], raidLines: [paid] as never, map: map as never });
    const first = buildRecap({ frame: tonight, previous: frame(2, { standings: [standing('vale')] }), handle: 'vale' });
    expect(first.events).toEqual(['vale paid 700 units to a raid at Nettle, and the raid left.']);
    const again = buildRecap({ frame: tonight, previous: frame(2, { standings: [standing('vale')], raidLines: [paid] as never }), handle: 'vale' });
    expect(again.events).toEqual([]);
    // A live standoff is ALWAYS news: it is the cliffhanger.
    const live = { ...paid, state: 'DEMANDED', ticksLeft: 4 };
    const both = frame(3, { standings: [standing('vale')], raidLines: [live] as never, map: map as never });
    expect(buildRecap({ frame: both, previous: frame(2, { standings: [standing('vale')], raidLines: [live] as never }), handle: 'vale' }).events[0]).toContain('is demanding 700 units from vale');
  });

  it('a lapse is reported the night it happens and not on the nights after', () => {
    const lapsed = { claim: 'c-1', system: 'sys-1', claimant: P('vale'), state: 'LAPSED', legend: '', arrears: 2, arrearsOf: 2, due: 1, owed: 1, deadlineTick: 1, bondAtRisk: 0, slashed: 5000, forSale: null, contestable: false, rentBps: 0, rentTaken: 0, tenants: 0, anchorHot: true, fuelDue: 0 };
    const f = frame(3, { standings: [standing('vale')], claimLines: [lapsed] as never });
    expect(buildRecap({ frame: f, previous: frame(2, { standings: [standing('vale')] }), handle: 'vale' }).events[0]).toBe(
      "vale's claim on sys-1 lapsed: it missed the Charge 2 times, and 5,000 of its bond was slashed.",
    );
    expect(buildRecap({ frame: f, previous: frame(2, { standings: [standing('vale')], claimLines: [lapsed] as never }), handle: 'vale' }).events).toEqual([]);
  });

  it('standing authority is reported as CHANGE — a draw, a binding, an ending — not repeated nightly', () => {
    const grant = { grant: 'g-1', grantor: P('orison'), delegate: P('vale'), granted: 10_000, spent: 0, grantedContingent: 2_000, spentContingent: 0, boundVentures: 0, clearance: [], dossiers: [], state: 'UNUSED' };
    const base = { standings: [standing('vale'), standing('orison')] };
    const unchanged = buildRecap({ frame: frame(3, { ...base, authorityLines: [grant] as never }), previous: frame(2, { ...base, authorityLines: [grant] as never }), handle: 'vale' });
    expect(unchanged.events).toEqual([]);
    const drawn = { ...grant, spent: 1_500, boundVentures: 2, state: 'DRAWN' };
    const r = buildRecap({ frame: frame(3, { ...base, authorityLines: [drawn] as never }), previous: frame(2, { ...base, authorityLines: [grant] as never }), handle: 'orison' });
    expect(r.events[0]).toBe("vale drew 1,500 more on orison's grant and vale bound orison to 2 more ventures in its name.");
    // Absent last night is NOT proof it is new — the list is capped — so no "tonight" is claimed.
    const fresh = buildRecap({ frame: frame(3, { ...base, authorityLines: [grant] as never }), previous: frame(2, base), handle: 'vale' });
    expect(fresh.events[0]).toBe('orison has given vale authority to act in its name, up to 10,000 of direct loss and 2,000 of contingent liability; 0 drawn so far.');
  });

  it('tomorrow’s docket, when it names this principal', () => {
    const card = { venture: 'v-9', headline: "vale's 3K is riding on orison.", tension: 'These two have never dealt with each other before.', atStake: 3000, electiveBps: 5000, cast: [{ principal: P('vale'), handle: 'vale', line: '', modelBadge: null }], grant: null };
    const r = buildRecap({ frame: frame(3, { standings: [standing('vale')], nextDocket: [card] as never }), previous: frame(2), handle: 'vale' });
    expect(r.ahead).toEqual(["vale's 3K is riding on orison. These two have never dealt with each other before."]);
  });
});

describe('agent-authored free text never reaches an email (scar #12 by a longer route)', () => {
  it('drops publicLine, the receipt reel and syndicate names, wherever they sit on the frame', () => {
    const SPAM = 'BUY-CHEAP-COINS-AT-scam.example';
    const seg = beat({
      cast: [{ principal: P('vale'), handle: 'vale' as never, line: 'kept 1', modelBadge: null }],
      publicLine: SPAM,
      receiptReel: [{ tick: 1, from: 'vale' as never, text: SPAM }],
      glyph: { venture: 'v-1', stage: 'sys-1', rolesFilled: 1, rolesTotal: 1, electiveBps: 1, state: 'SNAPPED_BLACK' } as never,
    });
    const f = frame(2, {
      standings: [standing('vale')],
      rundown: [seg],
      syndicateLines: [{ syndicate: 's-1', name: SPAM, founder: P('vale'), members: 3, admission: '', decision: '', treasuryOffices: false, treasuryMinor: 0, officeHolders: 0, legend: SPAM }] as never,
      ticker: [SPAM],
    });
    const recap = buildRecap({ frame: f, previous: frame(1, { standings: [standing('vale')] }), handle: 'vale' });
    const links = followLinks('https://agenteve.io');
    const mail = composeRecap(recap, { recordUrl: links.record('vale'), unsubscribeUrl: links.unsubscribe('U'.repeat(43)) });
    expect(mail.text).not.toContain(SPAM);
    expect(mail.html).not.toContain(SPAM);
    expect(mail.subject).not.toContain(SPAM);
  });
});

describe('fmt — thousands separators without toLocaleString (DET-4)', () => {
  it.each([
    [0, '0'],
    [999, '999'],
    [1000, '1,000'],
    [1234567, '1,234,567'],
    [-4500, '-4,500'],
    [12.6, '13'],
    [Number.NaN, '0'],
  ])('%s → %s', (n, s) => {
    expect(fmt(n)).toBe(s);
  });
});

// ── On frames the engine actually wrote ─────────────────────────────────────

describe('on a real simulated world, every recap agrees with the published standings', () => {
  let dir = '';
  let latest: ReckoningFrame | null = null;
  let previous: ReckoningFrame | null = null;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'follow-recap-'));
    // Two Reckonings, so tonight has a published night before it to be compared against.
    runSim({ ...DEFAULT_ARGS, seed: 'follow-recap-1', ticks: 2 * 288 + 5, principals: 12, framesDir: dir, quiet: true });
    latest = readPublishedFrame(dir, LATEST);
    previous = latest === null ? null : readPublishedFrame(dir, frameFileName(latest.reckoningIndex - 1));
    return () => {
      rmSync(dir, { recursive: true, force: true });
    };
  }, 600_000);

  it('reads both nights back off disk, as a spectator would', () => {
    expect(latest?.reckoningIndex).toBe(1);
    expect(previous?.reckoningIndex).toBe(0);
    expect(latest?.standings.length).toBeGreaterThan(5);
  });

  it('for every principal: kept and broken tonight are exactly the published difference', () => {
    if (latest === null || previous === null) throw new Error('no frames');
    let toldSomething = 0;
    for (const row of latest.standings) {
      const before = previous.standings.find((s) => s.principal === row.principal);
      const kept = row.electiveHonoured - (before?.electiveHonoured ?? 0);
      const broke = row.defaults - (before?.defaults ?? 0);
      const r = buildRecap({ frame: latest, previous, handle: row.handle });
      if (broke > 0) {
        expect(r.tone, row.handle).toBe('broke');
        expect(r.lead).toContain(broke === 1 ? 'defaulted on an elective promise' : `defaulted on ${fmt(broke)} elective promises`);
      } else if (kept > 0) {
        expect(r.tone, row.handle).toBe('kept');
        expect(r.lead).toContain(`honoured ${fmt(kept)} elective`);
      } else {
        expect(['steady', 'quiet'], row.handle).toContain(r.tone);
      }
      expect(r.record).toContain(`${fmt(row.electiveHonoured)} elective`);
      expect(r.events.length).toBeLessThanOrEqual(MAX_RECAP_EVENTS);
      if (r.events.length > 0) toldSomething += 1;
    }
    // Not vacuous: the night had stories, and the recaps told them.
    expect(toldSomething).toBeGreaterThan(0);
  });

  it('every settlement sentence it prints is a deed the frame itself published', () => {
    if (latest === null || previous === null) throw new Error('no frames');
    const deeds = new Set(latest.rundown.map((s) => s.deed));
    for (const row of latest.standings) {
      for (const e of buildRecap({ frame: latest, previous, handle: row.handle }).events) {
        if (/was riding on/.test(e)) expect([...deeds].some((d) => e.startsWith(d)), e).toBe(true);
      }
    }
  });
});
