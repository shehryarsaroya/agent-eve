/**
 * INV-22 HAS A REAL SUBJECT NOW: A6 COMPLETES END TO END.
 *
 * This file replaces `inv22-is-vacuous.test.ts`, which asserted the opposite and said in its own
 * failure message that the day it failed it should be inverted. It failed on 2026-07-26. Recording the
 * sequence because the shape is reusable:
 *
 *   1. `authorityLines: 0` on the live frame for eight Reckonings, read as *the cast chooses not to
 *      delegate.* It was a missing `grant` branch — the heuristic emitted eight verbs and that was not
 *      one of them, and heuristics are ~83% of production decisions.
 *   2. With grants issued, every one was `UNUSED`/`spent: 0`. I claimed no verb could spend one. **That
 *      was wrong**, from grepping `grantBook.spend` when the method is `recordSpend` — `create` had
 *      supported delegated action all along via `on_behalf_of` + `liveGrantBetween`.
 *   3. The real gap was narrower: two verbs accepted a mandate and **no cast ever passed one.** A
 *      capability that exists and is never exercised reads, in every report and on the frame, exactly
 *      like one that is missing.
 *   4. `elect` learned the same inferred pattern, the cast learned to use a mandate it holds, and a
 *      plain 900-tick world now produces **31 grants and 23 draws.**
 *
 * The lesson worth keeping: an invariant whose subject cannot occur is indistinguishable from one that
 * is holding. `aggregate.ts` skips INV-22's concurrency clause only when `grantSpends` is *undefined*,
 * and `Runtime` always supplies `grantBook.allSpends()` — so for the whole life of the project it was
 * *supplied and empty*, counted as CHECKED, and told nobody. That is the unfalsifiable-witness class,
 * and the fix was never to the invariant.
 */

import { describe, expect, it } from 'vitest';
import { HeuristicCast } from '../../src/cast/index.js';
import { setSpeed } from '../../src/core/time.js';
import type { EventId, Grant, PrincipalId } from '../../src/core/types.js';
import { minor } from '../../src/core/units.js';
import { checkInv22, type GrantSpend } from '../../src/invariants/authority.js';
import { Runtime } from '../../src/sim/runtime.js';

describe('a world nobody steers now draws on the authority it hands out', () => {
  it('issues grants AND draws against them, so the core loop closes without a human', () => {
    setSpeed('instant');
    const seed = 'inv22-live';
    const rt = new Runtime({ seed });
    const cast = new HeuristicCast(rt, { size: 8 });
    cast.seat(seed);
    for (let i = 0; i < 900; i += 1) {
      for (const a of cast.decide(rt.engine.tick + 1, seed)) rt.engine.submit(a);
      if (rt.runTick().halted) break;
    }

    expect(rt.grants.all().length, 'authority must be handed out at all').toBeGreaterThan(0);
    const draws = rt.grants.allSpends();
    expect(
      draws.length,
      'no draw occurred, so INV-22 is auditing an empty journal again and A6 stops at "granted"',
    ).toBeGreaterThan(0);

    // Every draw must be attributable, which is the whole point of the journal: the betrayal replay
    // needs to name who acted, under whose mandate, and when.
    for (const d of draws) {
      expect(d.delegate, 'a draw with no delegate names nobody').toBeTruthy();
      expect(rt.grants.get(d.grant), 'a draw must point at a real grant').toBeDefined();
      expect(d.direct + d.contingent, 'a draw of nothing is not a draw').toBeGreaterThan(0);
    }

    // And the world stayed sound while doing it — INV-22 runs at every tick close, so a draw that
    // overran a LIMIT would have halted the run above rather than reaching here.
    expect(rt.runTick().violations).toEqual([]);
  }, 180_000);

  /**
   * A grant whose caches AGREE with the spend list it is checked against.
   *
   * The unit cases below used a real grant from a real world and a hand-made spend list, and INV-22
   * flagged them for the wrong reason: its concurrency clause compares the journal's sum against the
   * row cache ("concurrent delegates race a counter; they cannot race a journal"), and a synthetic list
   * never matches a cache built from real draws. The overrun test therefore passed on a cache mismatch
   * and the at-the-limit control failed — a confounded fixture producing a right answer and a wrong one
   * from the same mistake.
   *
   * Synthetic on both sides, so the only clause that can fire is the one under test. No world needed.
   */
  function grantWith(spentDirect: number, spentContingent: number): Grant {
    return {
      id: 'g:1:testtest' as unknown as Grant['id'],
      grantor: 'p:grantor' as unknown as PrincipalId,
      delegate: 'p:delegate' as unknown as PrincipalId,
      template: 'treasury-hand',
      maxDirectLoss: minor(1_000),
      maxContingentLiability: minor(1_000),
      spentDirect: minor(spentDirect),
      spentContingent: minor(spentContingent),
      verbs: ['create', 'elect'],
      clearance: [],
      expiresTick: 500,
      revokedAtTick: null,
    };
  }

  function drawOf(grant: Grant, direct: number, contingent: number, delegate?: PrincipalId): GrantSpend {
    return {
      grant: grant.id,
      delegate: delegate ?? grant.delegate,
      tick: 100,
      eventId: 'test:draw' as unknown as EventId,
      direct: minor(direct),
      contingent: minor(contingent),
      verb: 'create',
    };
  }

  it('REJECTS a draw that exceeds the grant, and passes one exactly AT the limit', () => {
    // The half that had never been shown: that the check bites. Asserted directly rather than by
    // contriving a world, because the engine refuses an over-limit draw before recording it
    // (`recordSpend`'s caller checks headroom first — INV-22 is the net, not the gate), so a world
    // producing one would already be a bug.
    const over = grantWith(1_001, 0);
    const violations = checkInv22([over], [drawOf(over, 1_001, 0)], 100);
    expect(violations.length, 'a draw past max_direct_loss must be a violation').toBeGreaterThan(0);
    expect(violations[0]?.id).toBe('INV-22');
    expect(
      violations.map((v) => v.message).join(' '),
      'the violation must be about the LIMIT, not about timing, identity or a cache mismatch',
    ).toMatch(/exceed|headroom|LIMIT|max_direct|over/i);

    // And AT the limit is legal, or the check is merely "any draw is bad" and would halt the honest
    // world in the first test.
    const at = grantWith(1_000, 0);
    expect(checkInv22([at], [drawOf(at, 1_000, 0)], 100), 'a draw AT the limit is legal').toEqual([]);
  });

  it('a draw by someone the grant does not name is a violation, not a rounding detail', () => {
    // INV-22's identity clause. The journal is the audit trail a betrayal replay is read from, so a row
    // whose delegate disagrees with its grant would let the record blame the wrong agent — A5′, and
    // worse than a crash because it is permanent and public.
    const g = grantWith(0, 1);
    const violations = checkInv22([g], [drawOf(g, 0, 1, 'p:somebody-else' as unknown as PrincipalId)], 100);
    expect(violations.length, 'a draw by a principal the grant does not name must halt').toBeGreaterThan(0);
    expect(
      violations.map((v) => v.message).join(' '),
      'and it must be about WHO drew',
    ).toMatch(/was made by|names/i);
  });
});
