/**
 * RAZING — the unit half. **What ends a WORKS, what refuses to, and what a ruin says afterwards.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * The defect being closed: `Book.raze` existed, was captured, was restored, and had **no caller
 * anywhere in `src/`** for the project's whole life. So the three `razed` filters in `book.ts` were
 * no-ops and every one of them was an untested branch the moment the flag could be set.
 *
 * Every guard below carries its MUTATION — the edit that must turn it red — because a guard that has
 * never been seen to fail is a guard nobody has tested, only written. And the first test in each
 * describe asserts **non-vacuity** before anything else: an assertion over an empty set is green and
 * means nothing, which is exactly how INV-22 and INV-23 reported healthy over subjects that could
 * not occur.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import type { CanonicalValue } from '../../src/core/canonical.js';
import { reckoningIndex, TICKS_PER_RECKONING } from '../../src/core/time.js';
import type { ClaimState, HandId, PrincipalId, SystemId } from '../../src/core/types.js';
import { minor, qty } from '../../src/core/units.js';
import { Book as WorksBook, worksId, type WorksId } from '../../src/works/book.js';
import { checkRuinsAreCoherent, checkRentBoundedByMap } from '../../src/works/invariants.js';
import { RAZE_FORCE_MARGIN, forceToSaveWorks, razeVerdict, worksAtRisk } from '../../src/works/raze.js';
import { WORKS_SPINUP_TICKS, YIELD_PER_TICK } from '../../src/works/params.js';
import { FORCE_BY_TIER, FORCE_PER_HAND } from '../../src/predation/params.js';
import { resolvePulse, type PulsePort } from '../../src/campaign/pulse.js';
import { campaignIdFor, type CampaignRecord } from '../../src/campaign/book.js';
import { CAMPAIGN_PULSES, PULSE_MATERIEL_QTY } from '../../src/campaign/params.js';
import { ruinsFor } from '../../src/frames/memory.js';
import { launchMap } from '../../src/world/map.js';

const SYS = 'sys-01' as SystemId;
const HOLDER = 'p:tenant' as PrincipalId;
const RAIDER = 'p:raider' as PrincipalId;

function candidate(over: { readonly holder?: PrincipalId; readonly extracted?: number } = {}) {
  const holder = over.holder ?? HOLDER;
  return {
    id: worksId(SYS, 10, holder),
    system: SYS,
    holder,
    extracted: over.extracted ?? 23_040,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  THE MARGIN
// ═══════════════════════════════════════════════════════════════════════════

describe('a rout ends a structure; a win only takes goods', () => {
  it('is not vacuous: a large enough margin actually razes something', () => {
    // Asserted FIRST, and asserted about a `falls` that is non-null. Every refusal test below is a
    // negative, and a suite of negatives passes identically against a function that can never raze
    // at all — which is the shape of the defect this whole file exists to close.
    const verdict = razeVerdict({
      tier: 'MARCHES',
      system: SYS,
      standing: [candidate()],
      attackerForce: 9,
      defenderForce: 1,
    });
    expect(verdict.falls, 'a rout must be able to end a WORKS at all').not.toBeNull();
    expect(verdict.falls?.id).toBe(worksId(SYS, 10, HOLDER));
    expect(verdict.margin).toBe(8);
    expect(verdict.why).toContain('RAZED');
  });

  it('★ REFUSES ANYTHING SHORT OF A ROUT — losing narrowly costs goods, never capital', () => {
    // MUTATION: change `margin < RAZE_FORCE_MARGIN` to `margin <= 0` (or `margin < 1`) in
    // `razeVerdict`. This goes red immediately, and the mechanic it would have shipped is the one the
    // module argues against at length: a razing on every won standoff, three times a Reckoning, at
    // 65,000 of capital a time.
    expect(RAZE_FORCE_MARGIN, 'the constant this test is about').toBe(4);
    for (const margin of [1, 2, 3]) {
      const near = razeVerdict({
        tier: 'MARCHES',
        system: SYS,
        standing: [candidate()],
        attackerForce: 2 + margin,
        defenderForce: 2,
      });
      expect(near.falls, `won by ${String(margin)}: the goods move and the structure stands`).toBeNull();
      expect(near.margin).toBe(margin);
      expect(near.why, 'and the record says which number refused it').toContain('the structures stand');
    }
    // And the exact boundary razes, so it is asserted from both sides rather than only the safe one.
    const met = razeVerdict({
      tier: 'MARCHES',
      system: SYS,
      standing: [candidate()],
      attackerForce: 2 + RAZE_FORCE_MARGIN,
      defenderForce: 2,
    });
    expect(met.falls, 'won by the margin exactly: the structure falls').not.toBeNull();
  });

  it('★ THE TIER TABLE: two hands keep a structure on EVERY tier, against EVERY draw', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // **THE PROPERTY A MARGIN OF 2 DID NOT HAVE, AND THE REASON THE CONSTANT MOVED.**
    // `FORCE_BY_TIER.FRONTIER` is 0 — the Frontier is not policed — so at margin 2 the drawn
    // `RAID_FORCE` band (2–5) met the bar on **every** draw against an undefended Frontier target,
    // and the gate did not exist on the deepest ground in the game. `test/combat/the-cast-goes-to-war`
    // is what found it: `p:brannock` lost its Frontier WORKS and combat's two-sided battle line went
    // to zero.
    //
    // MUTATION: set `RAZE_FORCE_MARGIN` back to 2. The FRONTIER/undefended row flips to `true` at
    // force 2 and 3, and the two-hands row flips at 4 and 5 — the exact hole.
    // ══════════════════════════════════════════════════════════════════════════
    expect(FORCE_BY_TIER.FRONTIER, 'unpoliced: no terrain at all').toBe(0);
    expect(FORCE_BY_TIER.MARCHES, 'policed: one of terrain').toBe(1);

    const razes = (tier: 'MARCHES' | 'FRONTIER', hands: number, raidForce: number): boolean =>
      razeVerdict({
        tier,
        system: SYS,
        standing: [candidate()],
        attackerForce: raidForce,
        defenderForce: hands * FORCE_PER_HAND + (FORCE_BY_TIER[tier] ?? 0),
      }).falls !== null;

    // Undefended on the FRONTIER: the top half of the band still takes the structure, so unpoliced
    // ground is genuinely dangerous. That half is the mechanic; without it nothing is ever razed.
    expect([2, 3, 4, 5].map((f) => razes('FRONTIER', 0, f))).toEqual([false, false, true, true]);
    // One hand narrows it to the top of the band alone.
    expect([2, 3, 4, 5].map((f) => razes('FRONTIER', 1, f))).toEqual([false, false, false, true]);
    // ★ TWO of a principal's three hands (INV-8) is safety against every draw, on both tiers. This is
    // the row that makes the loss a CHOICE rather than weather, and it is what margin 2 did not give.
    for (const tier of ['FRONTIER', 'MARCHES'] as const) {
      expect([2, 3, 4, 5].map((f) => razes(tier, 2, f)), `${tier}, two hands`).toEqual([
        false,
        false,
        false,
        false,
      ]);
    }
    // And the policed zone is strictly safer than the unpoliced one at every strength, which is what
    // "the Marches are policed" has to mean if the tier table means anything.
    for (const f of [2, 3, 4, 5]) {
      if (razes('MARCHES', 0, f)) {
        expect(razes('FRONTIER', 0, f), `force ${String(f)}: the Frontier can be no safer`).toBe(true);
      }
    }
  });

  it('a defender that loses the goods can still save the works, and is told the price', () => {
    // ── THE COUNTERPLAY, AS ARITHMETIC (A2) ──────────────────────────────────
    //
    // This is what the margin BUYS: a reason to bring hands to a standoff you already know you cannot
    // win. Without it, a defender facing a stronger raid has no move between paying and losing
    // everything, and `join`'s demand side — §9's escort market — has no price in anything but pride.
    const attacker = 6;
    const alone = { tier: 'MARCHES' as const, system: SYS, standing: [candidate()], attackerForce: attacker };

    const need = forceToSaveWorks({ tier: 'MARCHES', attackerForce: attacker, defenderForce: 1 });
    expect(need, 'force 1 against 6 needs to reach 3, so two more hands').toBe(2);

    expect(razeVerdict({ ...alone, defenderForce: 1 }).falls, 'undefended: the works falls').not.toBeNull();
    expect(
      razeVerdict({ ...alone, defenderForce: 1 + need }).falls,
      'mustered to the published number: the works stands, and the goods are still lost',
    ).toBeNull();
    // One short must NOT be enough, or the published number is wrong by one and an agent that paid
    // for it was misled — scar #1's shape, in a number rather than a word.
    expect(
      razeVerdict({ ...alone, defenderForce: need }).falls,
      'one hand short of the published number is not enough',
    ).not.toBeNull();
  });

  it('worksAtRisk is the SAME call the resolver makes, not a second arithmetic', () => {
    // MUTATION: reimplement `worksAtRisk` with its own margin comparison. Nothing goes red today,
    // which is exactly why this asserts the identity over a SWEEP rather than one case: scar #1
    // shipped because two individually-correct surfaces disagreed, and the only structural defence is
    // that the preview and the decision are one function.
    for (const attackerForce of [0, 1, 2, 3, 5, 8, 13]) {
      for (const defenderForce of [0, 1, 2, 4, 7]) {
        const args = { tier: 'FRONTIER' as const, system: SYS, standing: [candidate()], attackerForce, defenderForce };
        expect(worksAtRisk(args), `preview must equal decision at ${String(attackerForce)}v${String(defenderForce)}`)
          .toEqual(razeVerdict(args).falls);
      }
    }
  });

  it('names the three different reasons nothing was razed, and never collapses them', () => {
    // A5: a record that answered "no razing" with an absent field would lie by omission about the
    // most expensive thing an assault can do. Three causes, three sentences.
    const commons = razeVerdict({
      tier: 'COMMONS',
      system: SYS,
      standing: [candidate()],
      attackerForce: 99,
      defenderForce: 0,
    });
    const short = razeVerdict({
      tier: 'MARCHES',
      system: SYS,
      standing: [candidate()],
      attackerForce: 1,
      defenderForce: 1,
    });
    const empty = razeVerdict({
      tier: 'MARCHES',
      system: SYS,
      standing: [],
      attackerForce: 99,
      defenderForce: 0,
    });
    expect(commons.why).toContain('A8');
    expect(short.why).toContain('the structures stand');
    expect(empty.why).toContain('no WORKS of the losing side standing there');
    // The three must be genuinely distinct strings, or a reader cannot tell which happened.
    expect(new Set([commons.why, short.why, empty.why]).size).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  A8 — THE COMMONS FLOOR
// ═══════════════════════════════════════════════════════════════════════════

describe('A8: a WORKS in the Commons is unrazable, and the refusal SAYS so', () => {
  it('★ REFUSES AT ANY FORCE, AND NAMES THE AXIOM RATHER THAN MERELY FAILING', () => {
    // MUTATION: delete the `tier === 'COMMONS'` branch from `razeVerdict`. Every case below goes red.
    //
    // A8 is *"hostile action is INVALID, not merely punished"* and *"never expires"*. The `why` naming
    // A8 is not decoration: a refusal that only failed would leave an agent unable to tell "safe by
    // rule" from "safe by luck", and A8 is a floor a newcomer is supposed to be able to PLAN on.
    for (const attackerForce of [2, 10, 100, 10_000]) {
      const verdict = razeVerdict({
        tier: 'COMMONS',
        system: SYS,
        standing: [candidate()],
        attackerForce,
        defenderForce: 0,
      });
      expect(verdict.falls, `force ${String(attackerForce)} in the Commons must raze nothing`).toBeNull();
      expect(verdict.why, 'and it must say WHY, naming the axiom').toContain('A8');
      expect(verdict.why).toContain('INVALID');
    }
  });

  it('the Commons branch precedes the margin, so it cannot be reached round', () => {
    // Order matters and is asserted, not assumed. If the margin ran first, a Commons WORKS would be
    // safe only because no force reading happened to exceed it — which is safety by arithmetic rather
    // than by rule, and the arithmetic is calibratable.
    const verdict = razeVerdict({
      tier: 'COMMONS',
      system: SYS,
      standing: [candidate()],
      attackerForce: 500,
      defenderForce: 0,
    });
    expect(verdict.why, 'the COMMONS sentence, not the margin sentence').toContain('COMMONS');
    expect(verdict.why).not.toContain('the structures stand');
    // And nothing needs saving there, ever.
    expect(forceToSaveWorks({ tier: 'COMMONS', attackerForce: 500, defenderForce: 0 })).toBe(0);
  });

  it('the launch map really has COMMONS systems, so the branch is reachable rather than theoretical', () => {
    // Non-vacuity for A8 itself: a Commons guard on a map with no Commons is a guard over an empty
    // set. This is the same class of check as asserting a razing happens at all.
    const map = launchMap();
    const commons = [...map.systems.values()].filter((s) => s.tier === 'COMMONS');
    expect(commons.length, 'A8 needs somewhere to hold').toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  THE BOOK, AND THE A15 DOOR
// ═══════════════════════════════════════════════════════════════════════════

describe('the book keeps a ruin, and keeps every number that was ever true about it', () => {
  it('drops out of every live accessor and out of none of the historical ones', () => {
    const book = new WorksBook();
    const row = book.raise({ system: SYS, holder: HOLDER, tick: 0 });
    const at = WORKS_SPINUP_TICKS + 10;
    book.credit(row.id, qty(1_000));

    expect(book.liveAt(SYS).length).toBe(1);
    expect(book.ofPrincipal(HOLDER).length).toBe(1);
    expect(book.liveInOrder().length).toBe(1);
    expect(book.ruinsInOrder().length, 'nothing has fallen yet').toBe(0);

    book.raze({ id: row.id, tick: at, reckoning: reckoningIndex(at), by: RAIDER });

    // The three `razed` filters, each asserted: they were no-ops for the project's whole life.
    expect(book.liveAt(SYS).length, 'liveAt filters razed').toBe(0);
    expect(book.ofPrincipal(HOLDER).length, 'ofPrincipal filters razed').toBe(0);
    expect(book.liveInOrder().length, 'liveInOrder filters razed').toBe(0);
    expect(book.workedSystems().length, 'and so does workedSystems, transitively').toBe(0);
    expect(book.sharesAt(SYS, 'COMMONS', at).size, 'a ruin takes no share').toBe(0);

    // And the historical ones keep it.
    expect(book.everInOrder().length, 'everInOrder keeps it — A5 has no opt-out').toBe(1);
    expect(book.everHeldBy(HOLDER), 'everHeldBy keeps it — this is the A15 gate').toBe(true);
    expect(book.ruinsInOrder().length).toBe(1);
    expect(book.size, 'size counts ruins').toBe(1);
    expect(book.liveSize, 'liveSize does not — the pair is why both exist').toBe(0);

    // The counters survive. Zeroing them would delete a landlord's public take with its tenant's
    // structure, and INV-W4 walks `everInOrder()` precisely so a ruin's rent history is checkable.
    expect(book.at(row.id)?.extracted, 'what the place handed over is still true').toBe(1_000);
    expect(book.at(row.id)?.fellAtReckoning).toBe(reckoningIndex(at));
    expect(book.at(row.id)?.razedBy).toBe(RAIDER);
  });

  it('★ REFUSES TO CREDIT A RUIN — extraction, rent and fuel all', () => {
    // MUTATION: delete any one of the three `if (row.razed) throw` guards. This goes red on that one.
    //
    // Unreachable today: every caller's id set comes from `sharesAt`, which filters `razed`. That is a
    // guarantee held by the CALLERS, which is the kind that stops holding when somebody adds a fourth
    // one — and a ruin that kept extracting would make INV-W1's cap true about a set the ledger no
    // longer matches.
    const book = new WorksBook();
    const row = book.raise({ system: SYS, holder: HOLDER, tick: 0 });
    book.raze({ id: row.id, tick: 100, reckoning: 0, by: null });
    expect(() => book.credit(row.id, qty(1))).toThrow(/razed/);
    expect(() => book.creditRent(row.id, qty(1), 0, RAIDER)).toThrow(/razed/);
    expect(() => book.creditFuel(row.id, qty(1))).toThrow(/razed/);
  });

  it('★ REFUSES TO RE-AUTHOR A RAZING', () => {
    // MUTATION: delete the `if (row.razed) throw` from `raze`. This goes red.
    //
    // The two callers resolve on two different clocks (`RAID_SPAWN_PHASES` and
    // `CAMPAIGN_PULSE_PHASE`) that can both come due in one Reckoning, so a second razing of one row
    // is reachable — and it would silently rewrite who destroyed whose capital, permanently and
    // publicly (A5′).
    const book = new WorksBook();
    const row = book.raise({ system: SYS, holder: HOLDER, tick: 0 });
    book.raze({ id: row.id, tick: 100, reckoning: 0, by: RAIDER });
    expect(() => book.raze({ id: row.id, tick: 200, reckoning: 0, by: HOLDER })).toThrow(/already razed/);
    expect(book.at(row.id)?.razedBy, 'and the first author stands').toBe(RAIDER);
    expect(book.at(row.id)?.razedAtTick).toBe(100);
  });

  it('a ruin frees the per-system capacity slot, so the holder can rebuild in place', () => {
    // ★ THE REPLACEMENT DEMAND, AT THE BOOK LEVEL. `WORKS_PER_PRINCIPAL_PER_SYSTEM` is 1 and
    // `atCapacity` reads `liveAt`, so a razed row must NOT keep occupying the slot — otherwise the
    // loss is permanent, nothing is ever rebuilt, and the mechanic has added a loss and no economy.
    const book = new WorksBook();
    const first = book.raise({ system: SYS, holder: HOLDER, tick: 0 });
    expect(book.atCapacity(HOLDER, SYS), 'one is the cap').toBe(true);
    book.raze({ id: first.id, tick: 100, reckoning: 0, by: null });
    expect(book.atCapacity(HOLDER, SYS), 'and a ruin does not hold the slot').toBe(false);
    const second = book.raise({ system: SYS, holder: HOLDER, tick: 200 });
    expect(second.id).not.toBe(first.id);
    expect(book.liveInOrder().length, 'rebuilt').toBe(1);
    expect(book.everInOrder().length, 'and the ruin is still on the record beside it').toBe(2);
  });

  it('survives capture and restore, labels and all', () => {
    const book = new WorksBook();
    const row = book.raise({ system: SYS, holder: HOLDER, tick: 0 });
    book.credit(row.id, qty(500));
    book.raze({ id: row.id, tick: 300, reckoning: 1, by: RAIDER });

    const fresh = new WorksBook();
    fresh.restore(book.capture());
    const restored = fresh.at(row.id);
    expect(restored?.razed).toBe(true);
    expect(restored?.razedAtTick).toBe(300);
    expect(restored?.fellAtReckoning, 'in the hash, so two worlds cannot disagree about it').toBe(1);
    expect(restored?.razedBy).toBe(RAIDER);
    expect(restored?.extracted).toBe(500);
  });

  it('restores a PRE-RAZE snapshot, because no snapshot in this world can contain a ruin', () => {
    // The tolerance in `restore`, asserted rather than assumed. Nothing could raze a WORKS before
    // `RULES_VERSION` 30, so a row without the two labels is a structure that never fell and `null` is
    // its true history — strictness here would refuse to restore the live world across one deploy.
    const book = new WorksBook();
    const row = book.raise({ system: SYS, holder: HOLDER, tick: 0 });
    const captured = book.capture() as unknown as { works: Record<string, unknown>[] };
    for (const w of captured.works) {
      delete w['fellAtReckoning'];
      delete w['razedBy'];
    }
    const fresh = new WorksBook();
    expect(() => fresh.restore(captured as unknown as CanonicalValue)).not.toThrow();
    expect(fresh.at(row.id)?.fellAtReckoning).toBeNull();
    expect(fresh.at(row.id)?.razedBy).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  INV-W7 AND INV-W5
// ═══════════════════════════════════════════════════════════════════════════

describe('INV-W7: a ruin cannot lie about when it fell or who ended it', () => {
  const map = launchMap();
  const anySystem = [...map.systems.keys()][0] as SystemId;

  function bookWithRuin(): { readonly book: WorksBook; readonly id: WorksId } {
    const book = new WorksBook();
    const row = book.raise({ system: anySystem, holder: HOLDER, tick: 0 });
    book.raze({ id: row.id, tick: TICKS_PER_RECKONING + 5, reckoning: 1, by: RAIDER });
    return { book, id: row.id };
  }

  it('is not vacuous: it runs over a real ruin and passes', () => {
    // The subject of this invariant could not occur before razing existed. INV-22 was green over an
    // empty journal for the project's whole life and INV-23 before it, so non-vacuity is asserted
    // FIRST and asserted about a book that genuinely contains one.
    const { book } = bookWithRuin();
    expect(book.ruinsInOrder().length, 'there must BE a ruin to check').toBe(1);
    expect(checkRuinsAreCoherent({ book, map, tick: 400 })).toEqual([]);
  });

  it('★ HALTS on a razed row whose Reckoning disagrees with its tick', () => {
    // MUTATION: in `checkRuinsAreCoherent`, delete the `fellAtReckoning !== expected` clause. Red.
    //
    // `fellAtReckoning` is stored rather than derived, which makes it a second spelling of one fact
    // (scar #5). The two are therefore checked against each other rather than trusted.
    const { book, id } = bookWithRuin();
    const row = book.at(id);
    expect(row).not.toBeNull();
    if (row === null) return;
    (row as { fellAtReckoning: number | null }).fellAtReckoning = 99;
    const out = checkRuinsAreCoherent({ book, map, tick: 400 });
    expect(out.map((v) => v.id)).toContain('INV-W7');
    expect(out[0]?.message).toContain('two spellings of one fact');
  });

  it('★ HALTS on a razed row with no Reckoning at all', () => {
    // MUTATION: delete the incomplete-labels clause. Red. THE RUIN reads this field to draw its
    // legend, and `ruinsFor` SKIPS a row without it — so without this check the loss would silently
    // stop rendering, which is the direction that hides.
    const { book, id } = bookWithRuin();
    const row = book.at(id);
    if (row === null) return;
    (row as { fellAtReckoning: number | null }).fellAtReckoning = null;
    expect(checkRuinsAreCoherent({ book, map, tick: 400 }).map((v) => v.id)).toContain('INV-W7');
  });

  it('★ HALTS on a STANDING works wearing a ruin\'s labels', () => {
    // MUTATION: delete the `!works.razed` branch. Red. The inverse error renders a ruin over a
    // structure that is still extracting — a wrong public fact in the other direction.
    const book = new WorksBook();
    const row = book.raise({ system: anySystem, holder: HOLDER, tick: 0 });
    (book.at(row.id) as { fellAtReckoning: number | null }).fellAtReckoning = 3;
    const out = checkRuinsAreCoherent({ book, map, tick: 400 });
    expect(out.map((v) => v.id)).toContain('INV-W7');
    expect(out[0]?.message).toContain('still extracting');
  });

  it('★ HALTS on a ruin dated before its own construction', () => {
    // MUTATION: delete the `razedAtTick < raisedAtTick` clause. Red. This is the exact artifact a
    // mis-threaded `tick` produces, and it is a permanent public claim that never happened (A5′).
    const book = new WorksBook();
    const row = book.raise({ system: anySystem, holder: HOLDER, tick: 500 });
    book.raze({ id: row.id, tick: 100, reckoning: reckoningIndex(100), by: null });
    const out = checkRuinsAreCoherent({ book, map, tick: 600 });
    expect(out.map((v) => v.id)).toContain('INV-W7');
    expect(out.some((v) => v.message.includes('before it existed'))).toBe(true);
  });
});

describe('INV-W5 keeps checking a system whose production was destroyed', () => {
  const map = launchMap();
  // A COMMONS system, so the ceiling is the smallest the map offers and the overage is easy to reach.
  const commons = [...map.systems.values()].find((s) => s.tier === 'COMMONS');

  it('★ STILL HALTS after the last WORKS at the system is razed — the blind spot', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // **MUTATION: revert INV-W5's subject set to `input.book.workedSystems()`. This goes red, and it
    // is the whole reason `rentTalliedSystems` exists.**
    //
    // `workedSystems()` filters `razed`; the rent tally does not, because it survives its subject
    // ending on purpose. So razing the last WORKS at a system mid-Reckoning dropped that system out of
    // the ONE invariant that catches double rent collection, silently, with every test green. A no-op
    // for the project's whole life, reachable in the same commit as the feature that reached it.
    // ══════════════════════════════════════════════════════════════════════════
    expect(commons, 'the map must have a COMMONS system').toBeDefined();
    if (commons === undefined) return;
    const system = commons.id;

    const book = new WorksBook();
    const row = book.raise({ system, holder: HOLDER, tick: 0 });
    const at = WORKS_SPINUP_TICKS + 10;
    // A rent far above anything the map can support: the invariant's whole subject.
    book.credit(row.id, qty(10_000_000));
    book.creditRent(row.id, qty(10_000_000), reckoningIndex(at), RAIDER);

    // Non-vacuity first: it must halt while the WORKS is still standing, or the test below proves
    // nothing about the union.
    const standing = checkRentBoundedByMap({ book, map, tick: at, rentCeilingBps: 10_000 });
    expect(standing.map((v) => v.id), 'it must halt with the works standing').toContain('INV-W5');

    book.raze({ id: row.id, tick: at, reckoning: reckoningIndex(at), by: RAIDER });
    expect(book.workedSystems(), 'the system has left the live set entirely').toEqual([]);
    expect(book.rentTalliedSystems(reckoningIndex(at)), 'but the tally still stands').toEqual([system]);

    const razedOut = checkRentBoundedByMap({ book, map, tick: at, rentCeilingBps: 10_000 });
    expect(
      razedOut.map((v) => v.id),
      'and the check must still run there. If this is empty, razing has opened a hole in the one ' +
        'invariant that catches double rent collection.',
    ).toContain('INV-W5');
  });

  it('stays quiet on a razed system whose rent was within the map', () => {
    // The other direction, and it matters as much: an invariant that halted a world merely because
    // something was razed would make razing unshippable. A5′ cuts both ways — never accuse a world of
    // arithmetic it did not do.
    expect(commons).toBeDefined();
    if (commons === undefined) return;
    const book = new WorksBook();
    const row = book.raise({ system: commons.id, holder: HOLDER, tick: 0 });
    const at = WORKS_SPINUP_TICKS + 10;
    book.credit(row.id, qty(YIELD_PER_TICK.COMMONS));
    book.creditRent(row.id, qty(10), reckoningIndex(at), RAIDER);
    book.raze({ id: row.id, tick: at, reckoning: reckoningIndex(at), by: RAIDER });
    expect(checkRentBoundedByMap({ book, map, tick: at, rentCeilingBps: 2_000 })).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  THE RUIN — the pixel signature
// ═══════════════════════════════════════════════════════════════════════════

describe('THE RUIN: a razed WORKS leaves a mark, because a vanished mark is no mark', () => {
  const handles = new Map([[HOLDER, 'tenant' as never], [RAIDER, 'raider' as never]]);

  function ruinBook(): WorksBook {
    const book = new WorksBook();
    const a = book.raise({ system: SYS, holder: HOLDER, tick: 0 });
    book.credit(a.id, qty(4_242));
    book.raze({ id: a.id, tick: 300, reckoning: 1, by: RAIDER });
    return book;
  }

  it('is not vacuous, and carries everything a renderer needs to label the loss', () => {
    // A13's actual test: not "does a field exist" but "can a viewer read what happened from it".
    const ruins = ruinsFor(ruinBook().ruinsInOrder(), handles, 8);
    expect(ruins.length, 'a razing must produce a mark at all').toBe(1);
    const ruin = ruins[0];
    expect(ruin?.system, 'where').toBe(SYS);
    expect(ruin?.handle, 'who built it').toBe('tenant');
    expect(ruin?.razedByHandle, 'who ended it').toBe('raider');
    expect(ruin?.fellAtReckoning, 'and when — §16 asks for the Reckoning by name').toBe(1);
    expect(ruin?.extracted, 'the epitaph, as a number').toBe(4_242);
    expect(ruin?.legend).toBe('RUIN · fell R1 to raider');
  });

  it('★ SAYS "the world" rather than inventing an author for a world-spawned raid', () => {
    // MUTATION: change `byHandle ?? 'the world'` to name the holder, or default the razer to any
    // principal. Red. A world raid has no principal behind it, and putting a real agent's handle on a
    // destruction it did not order is the libel A5′ forbids — in the one field a ruin carries forever.
    const book = new WorksBook();
    const row = book.raise({ system: SYS, holder: HOLDER, tick: 0 });
    book.raze({ id: row.id, tick: 300, reckoning: 1, by: null });
    const ruin = ruinsFor(book.ruinsInOrder(), handles, 8)[0];
    expect(ruin?.razedBy).toBeNull();
    expect(ruin?.razedByHandle, 'null, so a renderer never prints a handle nobody owns').toBeNull();
    expect(ruin?.legend).toBe('RUIN · fell R1 to the world');
  });

  it('★ ORDERS NEWEST FIRST AND DROPS THE OLDEST, because a ruin is news', () => {
    // MUTATION: reverse the sort, or slice from the other end. Red.
    //
    // The cap's direction is not a preference. `ruins` exists so a viewer can see what just happened;
    // a cap that dropped the newest would hide exactly the event the field is for, which is the
    // failure direction this repo has already shipped three times.
    const book = new WorksBook();
    for (let i = 0; i < 5; i += 1) {
      const row = book.raise({ system: `sys-0${String(i + 1)}` as SystemId, holder: HOLDER, tick: i });
      book.raze({ id: row.id, tick: 100 + i * 10, reckoning: i, by: RAIDER });
    }
    const ruins = ruinsFor(book.ruinsInOrder(), handles, 2);
    expect(ruins.length, 'the cap binds').toBe(2);
    expect(ruins[0]?.fellAtTick, 'newest first').toBe(140);
    expect(ruins[1]?.fellAtTick).toBe(130);
  });

  it('is deterministic when two WORKS fall in one tick', () => {
    // A campaign pulse and a raid can land on the same tick, so the tie is reachable — and Map
    // iteration order is a determinism killer this repo bans by name.
    const book = new WorksBook();
    const zzz = book.raise({ system: SYS, holder: 'p:zzz' as PrincipalId, tick: 0 });
    const aaa = book.raise({ system: SYS, holder: 'p:aaa' as PrincipalId, tick: 0 });
    book.raze({ id: zzz.id, tick: 300, reckoning: 1, by: null });
    book.raze({ id: aaa.id, tick: 300, reckoning: 1, by: null });
    const first = ruinsFor(book.ruinsInOrder(), handles, 8).map((r) => r.works);
    const again = ruinsFor([...book.ruinsInOrder()].reverse(), handles, 8).map((r) => r.works);
    expect(first, 'argument order may not move the answer').toEqual(again);
  });

  it('skips a row it cannot date rather than inventing a Reckoning for it', () => {
    // INV-W7 halts a world carrying such a row, so reaching here is a bug — and printing `R0` for it
    // would put a Reckoning this world never had on a permanent public mark. The invariant reports it;
    // the renderer does not guess.
    const book = new WorksBook();
    const row = book.raise({ system: SYS, holder: HOLDER, tick: 0 });
    book.raze({ id: row.id, tick: 300, reckoning: 1, by: null });
    (book.at(row.id) as { fellAtReckoning: number | null }).fellAtReckoning = null;
    expect(ruinsFor(book.ruinsInOrder(), handles, 8)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  THE CAMPAIGN CALLER
// ═══════════════════════════════════════════════════════════════════════════

describe('a campaign BREACH razes the defender\'s production, and a REBUFF never does', () => {
  const ATTACKER = 'p:attacker' as PrincipalId;
  const DEFENDER = 'p:defender' as PrincipalId;

  function campaign(): CampaignRecord {
    return {
      id: campaignIdFor(0, 0),
      attacker: ATTACKER,
      defender: DEFENDER,
      objective: SYS,
      depot: 'sys-02' as SystemId,
      declaredAtTick: 0,
      declaredAtReckoning: 0,
      firstPulseTick: 216,
      state: 'PRESSING',
      bond: minor(100_000),
      bondEncumbranceId: null,
      breachesNeeded: 3,
      rebuffsNeeded: 3,
      breaches: 0,
      rebuffs: 0,
      starves: 0,
      pulses: [],
      parties: [],
      endedAtTick: null,
      endedAtReckoning: null,
      forfeited: minor(0),
      returned: minor(0),
    } as CampaignRecord;
  }

  function port(over: {
    readonly attackerHands?: number;
    readonly defenderHands?: number;
    readonly works?: boolean;
    readonly tier?: 'COMMONS' | 'MARCHES' | 'FRONTIER';
  }): PulsePort {
    const hands = (n: number, tag: string): readonly HandId[] =>
      Array.from({ length: n }, (_, i) => `${tag}:${String(i)}` as HandId);
    return {
      tierOf: () => over.tier ?? 'MARCHES',
      claimAt: () => ({ claimant: DEFENDER, state: 'SUPPLIED' as ClaimState }),
      handsAt: (principal) =>
        principal === ATTACKER ? hands(over.attackerHands ?? 0, 'a') : hands(over.defenderHands ?? 0, 'd'),
      materielLotsAt: () => [{ id: 'lot:1', qty: PULSE_MATERIEL_QTY }],
      worksAt: (principal) =>
        over.works === true && principal === DEFENDER ? [candidate({ holder: DEFENDER })] : [],
    };
  }

  it('is not vacuous: a pressed pulse with production at the objective razes it', () => {
    // At the MARCHES `FORCE_BY_TIER` is 1, so three attacking hands against an empty objective reads
    // 3 v 1 — a BREACH with a margin of exactly 2, which is the razing threshold.
    expect(FORCE_BY_TIER.MARCHES).toBe(1);
    // Five hands against an empty MARCHES objective reads 5 v 1 — a BREACH with a margin of
    // exactly `RAZE_FORCE_MARGIN`, which is the razing threshold.
    const plan = resolvePulse(port({ attackerHands: 5, works: true }), campaign(), 216);
    expect(plan.row?.outcome, 'it must actually breach').toBe('BREACH');
    expect(plan.razes, 'and the breach must end the works').not.toBeNull();
    expect(plan.razes?.holder).toBe(DEFENDER);
    expect(plan.razeWhy).toContain('RAZED');
  });

  it('★ A BREACH SHORT OF A ROUT TAKES THE GROUND AND LEAVES THE FACTORY STANDING', () => {
    // MUTATION: raze on `outcome === 'BREACH'` instead of on the margin. Red.
    //
    // Two hands against an empty MARCHES objective is 2 v 1 — a BREACH, margin 1. The claim advances
    // and the production survives, which is the whole difference between "a war took the ground" and
    // "a war destroyed the industry". Razing on the outcome rather than the margin would make every
    // breach a razing and delete the distinction.
    const plan = resolvePulse(port({ attackerHands: 2, works: true }), campaign(), 216);
    expect(plan.row?.outcome).toBe('BREACH');
    expect(plan.razes, 'breached by one: the anchor is closer to falling, the works still runs').toBeNull();
    expect(plan.razeWhy).toContain('the structures stand');
  });

  it('★ A REBUFF NEVER RAZES, and the reason is recorded rather than inferred', () => {
    // MUTATION: drop the margin check so any force reading razes. Red — a rebuffed attacker would be
    // burning the defender's works while losing, which is a free hit for showing up.
    const plan = resolvePulse(port({ attackerHands: 1, defenderHands: 3, works: true }), campaign(), 216);
    expect(plan.row?.outcome).toBe('REBUFF');
    expect(plan.razes).toBeNull();
    expect(plan.razeWhy, 'and "the defender held" is a fact worth recording').toContain('the structures stand');
  });

  it('razes nothing when the defender holds no production at its own objective', () => {
    // The common case, and it must be honest rather than silent: a claimant's income is RENT on other
    // principals' works, so a landlord with no works of its own loses ground and nothing else.
    const plan = resolvePulse(port({ attackerHands: 5, works: false }), campaign(), 216);
    expect(plan.row?.outcome).toBe('BREACH');
    expect(plan.razes).toBeNull();
    expect(plan.razeWhy).toContain('no WORKS of the losing side standing there');
  });

  it('★ A8 HOLDS ON THE CAMPAIGN PATH TOO, even though declare.ts should make it unreachable', () => {
    // MUTATION: delete the Commons branch in `razeVerdict`. Red here as well as on the raid path,
    // which is the point of one shared predicate.
    //
    // `declare.ts` refuses a COMMONS objective as INVALID and `claim.ts` refuses a COMMONS claim, so
    // there should be no campaign to pulse. Both of those are one edit away from being wrong, in files
    // whose authors have no reason to think about structures. A8 is a floor; a floor that depended on
    // two other files continuing to agree with it is not one.
    const plan = resolvePulse(port({ attackerHands: 9, works: true, tier: 'COMMONS' }), campaign(), 216);
    expect(plan.razes, 'no force reading reaches a Commons works').toBeNull();
    expect(plan.razeWhy).toContain('A8');
  });

  it('a starved pulse reads no force and razes nothing', () => {
    // `razeVerdict` is only reached after supply is spent, so a starved pulse cannot raze — and the
    // plan says `null` for the reason rather than a sentence about a force nobody read.
    const starved: PulsePort = { ...port({ attackerHands: 9, works: true }), materielLotsAt: () => [] };
    const plan = resolvePulse(starved, campaign(), 216);
    expect(plan.row?.outcome).toBe('STARVED');
    expect(plan.razes).toBeNull();
    expect(plan.razeWhy, 'nothing was read, so nothing is claimed').toBeNull();
  });

  it('the campaign clock is the Charge clock, so razing rides a schedule nobody controls (A14)', () => {
    // A14: never ship a mechanic whose drama depends on agents CHOOSING conflict. The declaration is
    // a choice; the pulses that follow are not, and a razing lands on one of them. Asserted as a
    // property of the numbers rather than a comment: a campaign has a fixed, published number of
    // resolutions and every one of them can raze.
    expect(CAMPAIGN_PULSES, 'a bounded number of scheduled resolutions').toBeGreaterThan(0);
    const first = resolvePulse(port({ attackerHands: 5, works: true }), campaign(), 216);
    const later = resolvePulse(
      port({ attackerHands: 5, works: true }),
      { ...campaign(), breaches: 1, pulses: [] },
      216 + TICKS_PER_RECKONING,
    );
    expect(first.razes, 'the first pulse can raze').not.toBeNull();
    expect(later.razes, 'and so can a later one — the clock, not the outcome, is what gates it').not.toBeNull();
  });
});
