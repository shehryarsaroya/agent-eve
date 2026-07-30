/**
 * ★ A WORLD HOLDING A COVER CAN BE PUT BACK — capture, restore, and the hash that could not see them.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ## The measurement this file was written from
 *
 * ```
 * RESTORE THREW: Error: risk.covers[0].offerExpiresTick: expected a safe integer
 * ```
 *
 * `restore()` read `offerExpiresTick` through a bare `readInt` — correctly, because it is a
 * `readonly number` that is never null — and `capture()` never wrote the key. So **any world holding a
 * single COVER could not be restored**, and `risk` is in `CHECKPOINT_REQUIRED_TABLES`. That is the
 * class of failure that cost this project a ninety-minute production outage from a boot that could not
 * replay, at the cost of one key.
 *
 * `test/durability/books-in-the-hash.test.ts` round-trips `risk` and **passed**, because its fixture
 * stops at tick 287 — before the first front, with a cast that never writes cover. A round-trip test
 * over an empty table is this repo's signature defect wearing a green tick: *the guard exists, and its
 * subject cannot occur.* That fixture now holds a real bound COVER with a real INDEMNITY.
 *
 * ## And three things sitting behind it, each worse than the throw
 *
 *   1. **A field absent from `capture` is absent from `state_hash`.** Two replicas whose offers stood
 *      until different ticks agreed to the byte. A hash that cannot see a field cannot detect a
 *      divergence in it (§15.5).
 *   2. **`restore` rebuilt the pinned valuation as `pinnedAt(DEFAULT_VALUATION_RULE, offeredTick)`, and
 *      `pinnedAt` returns `marks: []`.** So a restored COVER carried **no pinned mark**, and
 *      `pinnedMark` *throws* rather than defaulting — inside `openPrimary`, inside `strikeFront`,
 *      inside the `HAZARD` phase. An adopted world would have halted on its first covered landfall, and
 *      the pinned mark is §15.4's third defence: *"the single most important one here."*
 *   3. **`rulesVersion` came back as a hard-coded `0`** and `boundByGrant` / `actedBy` as hard-coded
 *      `null` — the fields a `RiskDefault` row uses to name *who* acted. Nothing delegates a COVER yet,
 *      so restoring null was lossless *today*; it is the shape that silently loses a delegate's name
 *      the day one exists, which is A6's own subject.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { TICKS_PER_RECKONING } from '../../src/core/time.js';
import type { PrincipalId } from '../../src/core/types.js';
import { LEVY_GOOD } from '../../src/levy/index.js';
import {
  COVER_ELECTIVE_BPS_CEILING,
  pinnedMark,
  RiskBook,
  riskSubjects,
  type CoverId,
} from '../../src/risk/index.js';
import type { Runtime } from '../../src/sim/runtime.js';
import {
  FIRST_ANNOUNCE_TICK,
  FIRST_FRONT_RECKONING,
  FIRST_LANDFALL_TICK,
  act,
  fund,
  riskWorld,
  runTo,
  seatsFor,
  stockAt,
  tick,
} from './fixture.js';

const SETTLE_TICK = FIRST_FRONT_RECKONING * TICKS_PER_RECKONING + TICKS_PER_RECKONING - 1;

interface Bound {
  readonly runtime: Runtime;
  readonly holder: PrincipalId;
  readonly payer: PrincipalId;
  readonly cover: CoverId;
  readonly system: string;
}

function boundCover(seed: string): Bound {
  const world = riskWorld(seed, 5, 'MARCHES');
  const { runtime } = world;
  const [holder, payer, b1, b2] = seatsFor(world, 0, 1, 2, 3);
  fund(runtime, b1, payer, 200_000);
  fund(runtime, b2, holder, 200_000);
  runTo(runtime, FIRST_ANNOUNCE_TICK);
  const front = runtime.risk.allFronts()[0];
  if (front === undefined) throw new Error('unreachable');
  const cell = [...front.swath].sort((a, b) => b.intensityBps - a.intensityBps)[0];
  if (cell === undefined) throw new Error('unreachable');
  stockAt(runtime, holder, cell.system, 400_000, LEVY_GOOD);
  const offered = act(runtime, payer, 'publish_offer', {
    kind: 'COVER',
    system: cell.system,
    good: LEVY_GOOD,
    limit: 60_000,
    premium: 1_000,
    elective_bps: COVER_ELECTIVE_BPS_CEILING,
  });
  expect(offered, `publish_offer refused: ${offered?.hint ?? ''}`).toBeNull();
  const cover = runtime.risk.coversBy(payer)[0]?.id;
  if (cover === undefined) throw new Error('unreachable');
  const signed = act(runtime, holder, 'sign', {
    cover,
    terms_hash: runtime.risk.requireCover(cover).termsHash ?? '',
  });
  expect(signed, `sign refused: ${signed?.hint ?? ''}`).toBeNull();
  return { runtime, holder, payer, cover, system: cell.system };
}

describe('★ the risk book survives a round trip', () => {
  it('is not vacuous: the book being captured really holds a bound COVER', () => {
    const b = boundCover('dur-subject');
    const subjects = riskSubjects(b.runtime.risk);
    // ★ THE DENOMINATOR. A round-trip test over an empty `risk` table is exactly what passed while the
    // restore was broken, and it is why `books-in-the-hash.test.ts`'s tick-287 fixture never saw this.
    expect(subjects.covers, 'one cover in the book, or this file is a round trip over nothing').toBe(1);
    expect(subjects.boundCovers, 'and it is bound, so it carries every nullable field populated').toBe(1);
  });

  it('★ capture → restore does not throw, and the ONE missing key was the whole failure', () => {
    const b = boundCover('dur-round');
    const captured = b.runtime.risk.capture() as unknown as Record<string, Record<string, unknown>[]>;
    const row = captured['covers']?.[0];
    expect(row, 'the capture holds the cover').toBeDefined();
    // MUTATION: delete `offerExpiresTick` from `capture()` and this file goes red on the restore below
    // with the exact message a boot printed:
    //   `risk.covers[0].offerExpiresTick: expected a safe integer`
    expect(Object.keys(row ?? {}), 'the key that was missing').toContain('offerExpiresTick');

    const fresh = new RiskBook();
    expect(() => {
      fresh.restore(b.runtime.risk.capture());
    }, 'a world holding one COVER can be put back').not.toThrow();
    expect(riskSubjects(fresh).covers, 'and the cover came back').toBe(1);
  });

  it('★ every field a settlement or a strike reads comes back EQUAL, not merely present', () => {
    const b = boundCover('dur-fields');
    const live = b.runtime.risk.requireCover(b.cover);
    const fresh = new RiskBook();
    fresh.restore(b.runtime.risk.capture());
    const back = fresh.requireCover(b.cover);

    expect(back.offerExpiresTick, 'the offer clock').toBe(live.offerExpiresTick);
    expect(back.expiresTick, 'the term clock — a DIFFERENT clock, and that is the module’s scar').toBe(
      live.expiresTick,
    );
    expect(back.offerExpiresTick, 'and the two are genuinely different values here').not.toBe(
      live.expiresTick,
    );
    expect(back.termsHash, '§15.4’s third defence').toBe(live.termsHash);
    expect(back.actedOnStateVersion, '§15.4’s second').toBe(live.actedOnStateVersion);
    // MUTATION: restore `rulesVersion: 0` and this goes red. A row whose rules version is wrong is a
    // row an operator reading a `RULES_VERSION_MISMATCH` cannot place.
    expect(back.rulesVersion, 'the rules version it was written under').toBe(live.rulesVersion);
    expect(back.escrow, 'and the escrow account holding A7’s certain half').toBe(live.escrow);
  });

  it('★★ a restored COVER still has its PINNED MARK, so a landfall does not throw', () => {
    const b = boundCover('dur-marks');
    const live = b.runtime.risk.requireCover(b.cover);
    expect(live.valuation.marks.length, 'the live cover pinned a mark at offer time').toBe(1);

    const fresh = new RiskBook();
    fresh.restore(b.runtime.risk.capture());
    const back = fresh.requireCover(b.cover);

    // MUTATION: restore `valuation: pinnedAt(DEFAULT_VALUATION_RULE, offeredTick)` — which is what it
    // used to do — and every assertion here goes red. `pinnedAt` returns `marks: []`.
    expect(back.valuation.marks.length, 'and so does the restored one').toBe(1);
    expect(back.valuation.asOfTick, 'with the same as-of tick, which is inside terms_hash').toBe(
      live.valuation.asOfTick,
    );
    expect(back.valuation.rule.haircutBps, 'and the same valuation rule').toBe(
      live.valuation.rule.haircutBps,
    );
    // ★ THE FAILURE THAT WOULD HAVE HALTED AN ADOPTED WORLD. `pinnedMark` throws rather than defaulting
    // to zero, deliberately — *"silently valuing that loss at zero would pay a struck payee nothing
    // while its cover reads as honoured"* — so an empty marks array is a halt inside HAZARD, not a
    // quiet mispayment. Either way the boot was broken; this is the one that would have been loud.
    expect(() => pinnedMark(back, LEVY_GOOD), 'and the mark is readable').not.toThrow();
    expect(pinnedMark(back, LEVY_GOOD), 'at the value the parties agreed').toBe(
      pinnedMark(live, LEVY_GOOD),
    );
  });

  it('★ an INDEMNITY comes back with §15.4’s two landfall captures intact', () => {
    const b = boundCover('dur-indemnity');
    runTo(b.runtime, FIRST_LANDFALL_TICK);
    tick(b.runtime);
    const live = b.runtime.risk.indemnityForCover(b.cover);
    expect(live, 'the cohort opened, so there is an INDEMNITY to round-trip').toBeDefined();
    if (live === undefined) throw new Error('unreachable');
    expect(live.pinnedStateVersion, 'and it captured the version at landfall').not.toBeNull();
    expect(live.pinnedTermsHash, 'and the terms hash').not.toBeNull();

    const fresh = new RiskBook();
    fresh.restore(b.runtime.risk.capture());
    const back = fresh.indemnity(live.id);
    expect(back, 'the indemnity came back').toBeDefined();
    // MUTATION: drop either key from `capture()` and `guardIndemnity` halts the settlement on
    // *"carries no acted_on_state_version from the tick its loss was valued"* — which is the honest
    // failure, and strictly better than the tautology it replaced.
    expect(back?.pinnedStateVersion, 'with the version it pinned').toBe(live.pinnedStateVersion);
    expect(back?.pinnedTermsHash, 'and the hash it pinned').toBe(live.pinnedTermsHash);
    expect(back?.state, 'and its state').toBe(live.state);
  });

  it('★ and a restored book pays: the round trip is not just structurally equal', () => {
    const b = boundCover('dur-pays');
    runTo(b.runtime, FIRST_LANDFALL_TICK);
    tick(b.runtime);

    // Push the live book through `capture → restore` **via the registered state table**, which is the
    // adoption path itself rather than an imitation of it: `riskStateTable`'s `restore` builds a fresh
    // `RiskBook` and swaps the runtime's reference, exactly as a checkpoint boot does. *"A wrong boot
    // that passes its own integrity check is worse than a slow one"* is why this is asserted end to end
    // and not field by field.
    const table = b.runtime.engine.stateTables.find((t) => t.name === 'risk');
    expect(table, '`risk` is a registered state table').toBeDefined();
    expect(
      typeof table?.restore,
      'and it has a restore — a capture without one is worse than neither',
    ).toBe('function');
    table?.restore?.(table.capture());
    expect(riskSubjects(b.runtime.risk).covers, 'the swapped-in book holds the cover').toBe(1);

    act(b.runtime, b.payer, 'elect', { cover: b.cover, election: 'IN_FULL' });
    runTo(b.runtime, SETTLE_TICK);
    tick(b.runtime);

    const ind = b.runtime.risk.indemnityForCover(b.cover);
    expect(ind?.state, 'the restored promise settled, and it PAID').toBe('PAID');
    expect(ind?.escrowedPaid ?? 0, 'A7’s certain half executed out of the restored escrow').toBeGreaterThan(
      0,
    );
    expect(ind?.electivePaid ?? 0, 'and the elected half was kept').toBeGreaterThan(0);
  });
});
