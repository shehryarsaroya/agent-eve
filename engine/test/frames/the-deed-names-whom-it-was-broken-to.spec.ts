/**
 * ★ **THE RUNDOWN NAMED THE WRONG VICTIM** — and frames are archived and emailed (A5′).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * A blind playtest's frame, `v:932`: `s1blind-bo`'s own DIG. Filler `varrow` was elected 100 of 169
 * due — shorted 69 — and filler `severin` was paid in full (its 56 is the rest of the 225). The deed:
 *
 *     "s1blind-bo's 225 was riding on severin's dig. s1blind-bo walked away from 69 of the 225 it had
 *      promised."
 *
 * `headlineFor` named `parties.find(p => p !== creator)` — the first role-holder in id order — so the
 * accusation's AMOUNT was right (the `withheld` fix) and its OBJECT was an agent who was paid every
 * unit. The beat's `cast` was `[severin, varrow]`: the payer whose promise broke had no chip at all,
 * because `parties` are role-holders. And the same frame's compact link drew the snap to varrow, by a
 * different rule (largest pinned elective) — two parts of one frame naming two agents.
 *
 * Measured on seed `s1` before the fix (12 principals, 900 ticks): the old link rule was ALSO wrong on
 * four of the seven defaults — it drew the snap to the filler with the biggest pinned stake, who had
 * been paid in full, while the deed named a third party by id order.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The fix carries each payee's elective half (due · paid · shortfall) into `SettledView.payees`, and the
 * deed and the link both read `motion.ts:counterpartiesOf` — most shorted first, then most due, then id.
 */

import { describe, expect, it } from 'vitest';
import { minor } from '../../src/core/units.js';
import type { Handle, PrincipalId, SystemId, VentureId } from '../../src/core/types.js';
import { TICKS_PER_RECKONING, setSpeed } from '../../src/core/time.js';
import { HeuristicCast } from '../../src/cast/index.js';
import { Runtime } from '../../src/sim/runtime.js';
import { renderFrame, type FrameSource, type SettledView } from '../../src/frames/render.js';
import { compactLinksFor, payeesOf, type SettledPayee } from '../../src/frames/motion.js';
import { compareIds } from '../../src/ledger/order.js';

const P = (h: string): PrincipalId => `p:${h}` as PrincipalId;
const HANDLES = new Map<PrincipalId, Handle>([
  [P('bo'), 's1blind-bo' as Handle],
  [P('varrow'), 'varrow' as Handle],
  [P('severin'), 'severin' as Handle],
  [P('ferren'), 'ferren' as Handle],
  [P('halcyon'), 'halcyon' as Handle],
]);

const payee = (who: string, due: number, paid: number): SettledPayee => ({
  principal: P(who),
  electiveDue: minor(due),
  electivePaid: minor(paid),
  electiveShortfall: minor(due - paid),
});

/** `v:932`, with the playtest's own figures. */
function v932(over: Partial<SettledView> = {}): SettledView {
  return {
    venture: 'v:932' as VentureId,
    kind: 'DIG',
    stage: 'sys-05',
    creator: P('bo'),
    rolesFilled: 2,
    rolesTotal: 2,
    electiveBps: 4_000,
    atStake: minor(225),
    withheld: minor(69),
    payees: [payee('severin', 56, 56), payee('varrow', 169, 100)],
    defaulted: true,
    deferred: false,
    parties: [P('severin'), P('varrow')],
    publicLine: null,
    sealVerdict: null,
    messages: [],
    ...over,
  };
}

function beatOf(view: SettledView): ReturnType<typeof renderFrame>['rundown'][number] {
  const src: FrameSource = {
    reckoning: 3,
    tick: 1151,
    stateHash: 'x'.repeat(64),
    settled: [view],
    meters: { levyShort: minor(0), onAPromise: minor(0), keptRecent: 0, brokenRecent: 0 },
    handles: HANDLES,
    ticker: [],
    tomorrow: [],
  };
  const beat = renderFrame(src).rundown[0];
  if (beat === undefined) throw new Error('one settled view must produce one beat');
  return beat;
}

describe('★ the deed names the agent the promise was broken TO (A5′)', () => {
  it('★ THE DEFECT, with the playtest\'s numbers: v:932 names varrow, never severin', () => {
    // MUTATION: put `const other = v.parties.find((p) => p !== v.creator)` back as the only branch of
    // `headlineFor` and this reads "riding on severin's dig" — RED.
    const deed = beatOf(v932()).deed;
    expect(deed).toBe(
      "s1blind-bo's 225 was riding on varrow's dig. s1blind-bo walked away from 69 of the 225 it had promised.",
    );
    expect(deed, 'severin was paid every unit it was due').not.toContain('severin');
  });

  it('a caller that carries no payees still gets the sentence it always got, rather than an invented split', () => {
    // The fallback is the pre-fix sentence, verbatim: fixtures and older sources say nothing about the
    // split, so the renderer says nothing about it either. Every production caller carries payees.
    const unmeasured: SettledView = { ...v932() };
    delete (unmeasured as { payees?: unknown }).payees;
    expect(beatOf(unmeasured).deed).toBe(
      "s1blind-bo's 225 was riding on severin's dig. s1blind-bo walked away from 69 of the 225 it had promised.",
    );
  });

  it('★ the payer is in its own cast, FIRST, then whom the deed names, then the rest', () => {
    // MUTATION: put `cast: chipsFor(src, v.parties)` back on the settlement beat — the chips read
    // `[severin, varrow]` and the agent the sentence is about has no chip, no line, no crest. RED.
    const cast = beatOf(v932()).cast.map((c) => String(c.handle));
    expect(cast).toEqual(['s1blind-bo', 'varrow', 'severin']);
  });

  it('★ the snap and the sentence name ONE agent, even when the paid filler had the bigger stake', () => {
    // The playtest frame's link happened to agree because varrow also had the larger pinned elective.
    // Here severin's pinned stake is the larger, so the old link rule (largest `terms.elective`) draws
    // the snap to the filler who was paid in full.
    // MUTATION: ignore `payees` in `compactLinksFor` (read `v.filled` only) — `b` is severin. RED.
    const holdingAt = (p: PrincipalId): SystemId => `sys-${String(p).slice(2)}` as SystemId;
    const venture = {
      venture: 'v:932' as VentureId,
      kind: 'DIG',
      stage: 'sys-05' as SystemId,
      creator: P('bo'),
      filled: [
        { principal: P('severin'), elective: minor(500) },
        { principal: P('varrow'), elective: minor(169) },
      ],
      electiveBps: 4_000,
      grant: null,
    };
    const settledLink = compactLinksFor({
      ventures: [{ ...venture, state: 'DEFAULTED', payees: [payee('severin', 500, 500), payee('varrow', 169, 100)] }],
      holdingAt,
    })[0];
    expect(settledLink?.b).toBe(P('varrow'));
    expect(settledLink?.snapped).toBe(true);
    const deed = beatOf(v932({ payees: [payee('severin', 500, 500), payee('varrow', 169, 100)], atStake: minor(669) })).deed;
    expect(deed).toContain("riding on varrow's dig");
    // While it is live nobody has been shorted, so the link keeps the rule it always had: most riding.
    const liveLink = compactLinksFor({ ventures: [{ ...venture, state: 'LIVE' }], holdingAt })[0];
    expect(liveLink?.b).toBe(P('severin'));
  });

  it('two shorted parties are both named, the more shorted first', () => {
    const deed = beatOf(
      v932({ payees: [payee('severin', 56, 6), payee('varrow', 169, 100)], withheld: minor(119) }),
    ).deed;
    expect(deed).toBe(
      "s1blind-bo's 225 was riding on varrow and severin's dig. s1blind-bo walked away from 119 of the 225 it had promised.",
    );
  });

  it('★ "paid X it could have kept" does not count what the payer paid a role it filled itself', () => {
    // Seed `s1`, Reckoning 0, `v:4:667a5aa3`: ferren filled a role in its own BUILD and the frame said
    // "ferren paid 44K it could have kept" — 18K of which it paid itself. Standing already refuses it
    // (`venture/settlement.ts` `selfDealt`); the sentence now agrees.
    // MUTATION: count the payer's own row in `deedSplit` — the deed reads 44K. RED.
    const deed = beatOf({
      ...v932(),
      kind: 'BUILD',
      creator: P('ferren'),
      parties: [P('ferren'), P('halcyon')],
      payees: [payee('ferren', 18_000, 18_000), payee('halcyon', 26_000, 26_000)],
      atStake: minor(44_000),
      withheld: minor(0),
      defaulted: false,
    }).deed;
    expect(deed).toBe("ferren's 26K was riding on halcyon's build. ferren paid 26K it could have kept.");
  });

  it('a default whose whole shortfall was on the payer\'s own role is not reported as a betrayal', () => {
    // The engine records it as a default (the glyph snaps) and moves no standing for it. A sentence
    // saying "walked away from" would accuse it of breaking a promise to someone who was paid in full.
    const deed = beatOf({
      ...v932(),
      creator: P('ferren'),
      parties: [P('ferren'), P('halcyon')],
      payees: [payee('ferren', 30, 0), payee('halcyon', 200, 200)],
      atStake: minor(230),
      withheld: minor(30),
    }).deed;
    expect(deed).toBe(
      "ferren's 200 was riding on halcyon's dig. ferren paid every counterparty in full and withheld 30 from a role it filled itself.",
    );
    expect(deed).not.toContain('walked away');
  });

  it('payeesOf folds per principal, drops an unfilled role, and keeps id order', () => {
    const rows = payeesOf([
      { holder: P('varrow'), electiveDue: minor(100), electivePaid: minor(40), electiveShortfall: minor(60) },
      { holder: null, electiveDue: minor(0), electivePaid: minor(0), electiveShortfall: minor(0) },
      { holder: P('halcyon'), electiveDue: minor(10), electivePaid: minor(10), electiveShortfall: minor(0) },
      { holder: P('varrow'), electiveDue: minor(50), electivePaid: minor(50), electiveShortfall: minor(0) },
    ]);
    expect(rows).toEqual([payee('halcyon', 10, 10), payee('varrow', 150, 90)]);
  });
});

describe('★ in a real world, every default names a party it shorted, and the snap agrees', () => {
  it('seed s1: deed, cast and compact link on every settled default, against the settlement itself', () => {
    setSpeed('instant');
    const seed = 's1';
    const rt = new Runtime({ seed });
    const cast = new HeuristicCast(rt, { size: 12 });
    cast.seat(seed);
    let defaults = 0;
    let discriminating = 0;
    for (let i = 0; i < 3 * TICKS_PER_RECKONING; i += 1) {
      for (const a of cast.decide(rt.engine.tick + 1, seed)) rt.engine.submit(a);
      const report = rt.runTick();
      if (report.halted) throw new Error(`halted at ${String(report.tick)}`);
      if (!report.clock.isSettlementTick) continue;
      const outcome = rt.lastReckoning;
      const frame = rt.reckoningFrame();
      if (outcome === null || frame === null) continue;
      for (const st of outcome.settlements) {
        if (st.terminalState !== 'DEFAULTED') continue;
        const venture = rt.ventures.get(st.venture);
        if (venture === undefined) continue;
        const shorted = payeesOf(st.payouts)
          .filter((p) => p.principal !== venture.creator && p.electiveShortfall > 0)
          .sort((a, b) => b.electiveShortfall - a.electiveShortfall || compareIds(a.principal, b.principal));
        const victim = shorted[0];
        if (victim === undefined) continue; // a default on the payer's own role names nobody
        defaults += 1;
        // The OLD rule: the first role-holder other than the creator, in id order.
        const oldPick = [...new Set(st.payouts.map((p) => p.holder))]
          .filter((p): p is PrincipalId => p !== null && p !== venture.creator)
          .sort(compareIds)[0];
        if (oldPick !== victim.principal) discriminating += 1;
        // The frame prints a principal by its holding's name (`Runtime.frameHandles`).
        const named = [...rt.world.holdings.values()].find((h) => h.principal === victim.principal);
        const handle = String(named?.name ?? victim.principal);
        const beat = frame.rundown.find((b) => b.venture === st.venture);
        if (beat !== undefined) {
          expect(beat.deed, `${String(st.venture)}: the deed must name a party it shorted`).toContain(`riding on ${handle}`);
          expect(beat.cast[0]?.principal, `${String(st.venture)}: the payer leads its own cast`).toBe(venture.creator);
        }
        const link = frame.compactLinks.find((l) => l.venture === st.venture);
        if (link !== undefined && link.b !== null) {
          expect(link.b, `${String(st.venture)}: the snap is drawn to the party the deed names`).toBe(victim.principal);
        }
      }
    }
    // NON-VACUITY: a world with no default, or none where the old rule picked differently, proves nothing.
    expect(defaults, 'seed s1 settled no default with a shorted counterparty').toBeGreaterThan(0);
    expect(discriminating, 'no default where id order and the shortfall disagree — the case is not exercised').toBeGreaterThan(0);
    console.log('seed s1 defaults with a shorted counterparty:', defaults, '| where the old id-order rule named someone else:', discriminating);
  }, 120_000);
});
