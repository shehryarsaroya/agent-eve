/**
 * ★ **THE GOOD EVERY OBLIGATION IS PRICED IN BECOMES SELLABLE, AND THE ALLOTMENT STILL CANNOT
 * BE SOLD.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * `the-buy-side-is-funded.spec.ts` is this file's model and its subject was the currency floor:
 * a static `STARTER_STAKE` that made `freeCash` identically zero and the market's buy side
 * unreachable. **The goods floor was the same defect one field over and it shipped at 19
 * untouched.** `ENDOWMENT_GOOD_FLOOR_QTY` was a static `LEVY_STARTER_ALLOTMENT` (50,000)
 * charged per `(principal, venue)`, while the allotment itself is *destroyed* over four
 * Reckonings — so past the window it withheld 50,000 units that were provably not endowment.
 *
 * Measured before the change, eight seeded worlds, nine Reckonings, one observation per
 * `(seed, Reckoning, member)` at the settlement tick (`scripts/d7-sellable-probe.ts`):
 *
 *     observations ............... 576
 *     hold `ration`, sell NONE ... 123  (21.4%)
 *     median held ................ 66,791   against a 50,000 floor
 *
 * and on the live shard `p:probe-scout-01` holds 40,116 with no production, so its sellable
 * quantity was 0 **permanently** — a static floor above a static holding never opens.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ## The theorem, and it is the twin of 19's
 *
 *     held(p)           =  ALLOTMENT + produced(p) + received(p) − sent(p) − destroyed(p)
 *     remainingGoods(p) =  max(0, ALLOTMENT − destroyed(p))
 *     ⟹  held(p) − remainingGoods(p)
 *            =  produced(p) + received(p) − sent(p) − max(0, destroyed(p) − ALLOTMENT)
 *
 * **The allotment cancels out.** What a principal may sell is exactly what it produced or was
 * paid, less what it has already parted with, less anything it destroyed *beyond* the allotment —
 * and a fresh identity has produced nothing and been paid nothing. That is a stronger statement
 * than the static floor could make, and it is measured over every principal of eight worlds
 * rather than asserted.
 *
 * The last term is not an escape hatch. The first draft of this file *excluded* the principals it
 * applies to and asserted the clean form on the rest; at three Reckonings **one principal in 64
 * had already destroyed more than its whole allotment**, so the exclusion was silently dropping
 * exactly the case where the clamp at zero does the work. The correction term is carried instead,
 * and the count of principals that need it is asserted non-zero.
 *
 * ## A note on the instrument, because its twin lied once already
 *
 * `the-buy-side-is-funded.spec.ts` read the roster as `m.principalId` where `CastMember` says
 * `principal`, so every lookup hit a non-account and the whole A15 column read a confident and
 * meaningless `0`. **A witness with its own copy of the subject can be wrong in exactly the
 * direction that hides.** Every non-vacuity assertion below is there for that reason: the flows
 * are recomputed from the posting log, the allotment leg is identified and checked against
 * `LEVY_STARTER_ALLOTMENT`, and the identity has to be exercised at NON-ZERO before it counts.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HeuristicCast } from '../../src/cast/index.js';
import { setSpeed, TICKS_PER_RECKONING } from '../../src/core/time.js';
import type { GoodId, PrincipalId, SystemId } from '../../src/core/types.js';
import { ENDOWMENT_GOOD, ENDOWMENT_GOOD_FLOOR_QTY } from '../../src/ledger/endowment.js';
import { postingLedger } from '../../src/ledger/batch.js';
import { storesAccount } from '../../src/ledger/index.js';
import type { Ledger } from '../../src/ledger/ledger.js';
import { LEVY_STARTER_ALLOTMENT } from '../../src/levy/index.js';
import { ENDOWMENT_GOODS_RULE, sellableGoods } from '../../src/market/index.js';
import { Runtime } from '../../src/sim/runtime.js';
import { commonsSystems } from '../../src/world/index.js';
import {
  REFINE_IN_QTY,
  REFINE_OUT_QTY,
  WORKS_BUILD_QTY,
  WORKS_SPINUP_TICKS,
  WORKS_YIELD_GOOD,
} from '../../src/works/params.js';

const SEEDS = ['g01', 'g02', 'g03', 'g04', 'g05', 'g06', 'g07', 'g08'] as const;

interface Played {
  readonly runtime: Runtime;
  readonly roster: readonly PrincipalId[];
}

/** Worlds are expensive; each seed/horizon pair is played once for the whole file. */
const PLAYED = new Map<string, Played>();

/** Run one seeded world through the heuristic cast. Nobody is funded by hand. */
function play(seed: string, reckonings: number, members = 8): Played {
  const key = `${seed}/${String(reckonings)}/${String(members)}`;
  const hit = PLAYED.get(key);
  if (hit !== undefined) return hit;

  setSpeed('instant');
  const runtime = new Runtime({ seed });
  const cast = new HeuristicCast(runtime, { size: members });
  // ★ `principal`, which is what `CastMember` calls it. See the header.
  const roster = cast.seat(seed).map((m) => m.principal);
  for (const who of roster) {
    if (runtime.ledger.account(storesAccount(who)) === undefined) {
      throw new Error(`the roster is not readable: ${String(who)} has no STORES account`);
    }
  }
  for (let i = 0; i < reckonings * TICKS_PER_RECKONING; i += 1) {
    const next = runtime.engine.tick + 1;
    for (const action of cast.decide(next, seed)) runtime.engine.submit(action);
    const report = runtime.runTick();
    expect(report.halted, `${seed} halted at ${String(report.tick)}`).toBe(false);
  }
  const out: Played = { runtime, roster };
  PLAYED.set(key, out);
  return out;
}

/**
 * Units of {@link ENDOWMENT_GOOD} into and out of a principal's STORES, recomputed from the
 * posting log — **a second road**, sharing no code with `sellableGoods` or `EndowmentBook`.
 *
 * `produced` deliberately excludes the enrolment allotment, because the allotment is the very
 * thing under test. It cannot be excluded by FAUCET the way the currency twin excludes
 * `CURRENCY_FAUCET.STARTER_STAKE` — the allotment and real production both post through
 * `GOODS_FAUCET.PRODUCTION` — so it is identified by the engine's own event id, `enrol.goods:<p>`,
 * and {@link allotmentOf} checks that exactly one such batch exists and that it is
 * `LEVY_STARTER_ALLOTMENT` units. A silent mis-identification here would move the whole
 * measurement, so it is asserted rather than trusted.
 *
 * `sent` is everything that left by TRANSFER, which includes a move into the principal's own
 * market escrow. That is the same convention the currency twin uses for a transfer into a
 * venture escrow, and it is what makes the identity hold over `held in STORES`.
 */
function goodsFlows(
  ledger: Ledger,
  who: PrincipalId,
  good: GoodId = ENDOWMENT_GOOD,
): { allotment: number; produced: number; received: number; sent: number; destroyed: number } {
  const account = storesAccount(who);
  let allotment = 0;
  let produced = 0;
  let received = 0;
  let sent = 0;
  let destroyed = 0;
  for (const batch of ledger.allBatches()) {
    for (const p of batch.postings) {
      if (p.account !== account || postingLedger(p) !== 'GOODS') continue;
      if (p.good !== good || p.amountQty === null) continue;
      const isAllotment = String(batch.eventId) === `enrol.goods:${String(who)}`;
      if (batch.supply?.direction === 'RETIRE') destroyed += 0 - Number(p.amountQty);
      else if (isAllotment) allotment += Number(p.amountQty);
      else if (batch.supply?.direction === 'ISSUE') produced += Number(p.amountQty);
      else if (p.amountQty > 0) received += Number(p.amountQty);
      else sent += 0 - Number(p.amountQty);
    }
  }
  return { allotment, produced, received, sent, destroyed };
}

/** Total units of `good` this principal holds in STORES, wherever and whatever state. */
function heldIn(ledger: Ledger, who: PrincipalId, good: GoodId = ENDOWMENT_GOOD): number {
  const account = storesAccount(who);
  if (ledger.account(account) === undefined) return 0;
  return ledger
    .lotsInAccount(account)
    .filter((lot) => lot.good === good)
    .reduce((n, lot) => n + lot.qty, 0);
}

/** Everything this principal could ASK, over every venue it holds the good at. */
function sellableEverywhere(ledger: Ledger, who: PrincipalId, good: GoodId = ENDOWMENT_GOOD): number {
  const account = storesAccount(who);
  if (ledger.account(account) === undefined) return 0;
  const venues = new Set<SystemId>();
  for (const lot of ledger.lotsInAccount(account)) if (lot.good === good) venues.add(lot.location);
  let total = 0;
  for (const venue of venues) total += sellableGoods(ledger, who, good, venue);
  return total;
}

describe('★ A15, the GOODS half: what a principal may sell is exactly what it PRODUCED', () => {
  it('held − remainingGoods == produced + received − sent, over every principal of eight worlds', () => {
    // ══════════════════════════════════════════════════════════════════════
    // THE THEOREM, MEASURED. The allotment cancels out of the identity entirely, which is why
    // moving the floor cannot have widened the Sybil surface: what a principal may sell never
    // mentions the grant, only the flows. A fresh identity has `produced = received = 0` and
    // therefore nothing to sell, at every N, forever.
    //
    // Stated as an EQUALITY on the holding side and an INEQUALITY on the `sellableGoods` side,
    // exactly as its currency twin is: `sellableGoods` excludes pledged and `IN_TRANSIT` lots,
    // both of which legitimately hold sellable units down, and clamping is the safe direction.
    //
    // MUTATION: any change that lets `remainingGoods` rise, or that decrements it on a TRANSFER
    // rather than a destruction, breaks the equality on the first principal that has delivered.
    // ══════════════════════════════════════════════════════════════════════
    let checked = 0;
    let withProduction = 0;
    let withDeliveries = 0;
    let overSpent = 0;
    for (const seed of SEEDS) {
      const { runtime, roster } = play(seed, 3);
      for (const who of roster) {
        const flow = goodsFlows(runtime.ledger, who);
        // Non-vacuity on the exclusion itself: the allotment leg must be exactly one batch of
        // exactly the granted size, or `produced` is silently carrying the grant.
        expect(
          flow.allotment,
          `${seed}/${who}: the enrolment allotment leg must be identifiable and whole`,
        ).toBe(Number(LEVY_STARTER_ALLOTMENT));

        const held = heldIn(runtime.ledger, who);
        const remaining = Number(runtime.ledger.endowments.remainingGoods(who));
        const beyond = Math.max(0, flow.destroyed - Number(LEVY_STARTER_ALLOTMENT));
        if (beyond > 0) overSpent += 1;

        expect(
          held - remaining,
          `${seed}/${who}: held ${String(held)} − remaining ${String(remaining)} must be ` +
            `produced ${String(flow.produced)} + received ${String(flow.received)} − sent ` +
            `${String(flow.sent)} − destroyed-beyond-the-allotment ${String(beyond)}`,
        ).toBe(flow.produced + flow.received - flow.sent - beyond);
        expect(sellableEverywhere(runtime.ledger, who)).toBeLessThanOrEqual(
          Math.max(0, flow.produced + flow.received - flow.sent),
        );
        checked += 1;
        if (flow.produced + flow.received > 0) withProduction += 1;
        if (flow.destroyed > 0) withDeliveries += 1;
      }
    }
    expect(checked, 'non-vacuity: some principals must have been examined').toBeGreaterThan(50);
    // ...and the identity must be exercised where it can actually FAIL: at non-zero production,
    // on principals that have really spent allotment, and on at least one that has spent PAST it
    // so the clamp at zero is exercised rather than assumed. At 0 = 0 it proves nothing, which is
    // the shape the currency twin's own non-vacuity guard exists to catch.
    expect(withProduction, 'the identity must be exercised at NON-ZERO production').toBeGreaterThan(
      10,
    );
    expect(withDeliveries, 'and on principals that have really delivered').toBeGreaterThan(50);
    expect(
      overSpent,
      'and on at least one that destroyed PAST its allotment, or the clamp is never checked',
    ).toBeGreaterThan(0);
  });

  it('★ A SOCK PUPPET enrolled into a live economy holds nothing sellable', () => {
    // The Sybil statement in its purest form, on the goods side. The puppet is enrolled into the
    // running world exactly as an attacker's would be: free, at any time, with a full allotment
    // and no history. It never acts.
    const { runtime } = play('g01', 3);
    const sock = 'p:sock-puppet-goods' as PrincipalId;
    runtime.seat(sock, 'sock-puppet-goods', undefined);

    // Non-vacuity: the puppet is real and HOLDS the good — unheld would be an unremarkable
    // empty store, and held-and-unsellable is the whole claim.
    expect(heldIn(runtime.ledger, sock)).toBe(Number(LEVY_STARTER_ALLOTMENT));
    expect(Number(runtime.ledger.endowments.remainingGoods(sock))).toBe(ENDOWMENT_GOOD_FLOOR_QTY);
    const flow = goodsFlows(runtime.ledger, sock);
    expect(flow.produced + flow.received, 'nobody has paid it and it has made nothing').toBe(0);
    expect(
      sellableEverywhere(runtime.ledger, sock),
      'and therefore it can put not one unit on a book',
    ).toBe(0);

    // Sixteen of them concentrate sixteen times nothing.
    let fleet = 0;
    for (let i = 0; i < 16; i += 1) {
      const p = `p:sock-goods-${String(i)}` as PrincipalId;
      runtime.seat(p, `sock-goods-${String(i)}`, undefined);
      fleet += sellableEverywhere(runtime.ledger, p);
    }
    expect(fleet, 'a fleet of free identities yields zero sellable goods').toBe(0);
  });

  it('★ N IDENTITIES AT ONE SYSTEM PUT NO MORE ON A BOOK THAN ONE DOES — N = 1, 4, 16', () => {
    // ══════════════════════════════════════════════════════════════════════
    // **THE A15 MEASUREMENT, AND IT IS THE ONE THAT COULD SAY THE DECISION IS WRONG.**
    //
    // `market/escrow.ts` names the exposure in its own words — *"selling it is the other half of
    // the sock-puppet extraction"* — so making the floor movable has to be answered by
    // measurement rather than by argument. The question: can N free identities put more sellable
    // `ration` on a book than one identity can?
    //
    // The answer is bounded by the MAP, not by the population, and this is the run that shows it.
    // Every identity is seated at ONE Commons system and raises a WORKS there;
    // `WORKS_PER_PRINCIPAL_PER_SYSTEM` is 1 and `Book.sharesAt` DIVIDES the tier yield among the
    // WORKS standing at a system, so Σ `ore` is a property of the ground and is identical at
    // every N. `refine` converts ore to rations at a fixed ratio, so Σ sellable `ration` is
    // identical too — and it is the SAME total however many keypairs it is spread across.
    //
    // Both figures are printed by the assertion messages, so a future change that breaks the
    // property fails with the numbers in hand rather than with a boolean.
    // ══════════════════════════════════════════════════════════════════════
    const readings: { n: number; ore: number; sellable: number; held: number }[] = [];
    for (const n of [1, 4, 16]) {
      setSpeed('instant');
      const runtime = new Runtime({ seed: `sybil-${String(n)}` });
      const system = commonsSystems(runtime.world.map)[0];
      if (system === undefined) throw new Error('the launch map has no Commons system');

      const fleet: PrincipalId[] = [];
      for (let i = 0; i < n; i += 1) {
        const who = `p:puppet-${String(n)}-${String(i)}` as PrincipalId;
        runtime.seat(who, `puppet-${String(n)}-${String(i)}`, system);
        runtime.standing.open(who);
        fleet.push(who);
      }
      // Every puppet raises its WORKS at the SAME system — the whole point. Paid out of the
      // allotment, which is the cheapest route a puppet farm has and which this change does not
      // make cheaper (see `works/params.ts`'s A15 argument).
      for (const who of fleet) {
        const outcome = runtime.engine.submit({
          principal: who,
          verb: 'build',
          params: { kind: 'WORKS', system },
          clientSequence: 0,
          arrivalMs: 0,
          decisionSource: 'LIVE',
        });
        expect(outcome.ok, `${who} could not raise a WORKS: ${JSON.stringify(outcome)}`).toBe(true);
      }
      // Spin-up, then long enough for a meaningful yield. `refine` is submitted every tick it
      // could possibly succeed; a refusal is expected on most of them and is not an error, so
      // the outcome is ignored — the measurement is what the LEDGER holds at the end.
      const horizon = WORKS_SPINUP_TICKS + 2 * TICKS_PER_RECKONING;
      for (let t = 0; t < horizon; t += 1) {
        for (const [i, who] of fleet.entries()) {
          if (heldIn(runtime.ledger, who, WORKS_YIELD_GOOD) < Number(REFINE_IN_QTY)) continue;
          runtime.engine.submit({
            principal: who,
            verb: 'refine',
            params: { kind: 'RATION', system },
            clientSequence: i + 1,
            arrivalMs: i + 1,
            decisionSource: 'LIVE',
          });
        }
        const report = runtime.runTick();
        expect(report.halted, `N=${String(n)} halted at ${String(report.tick)}`).toBe(false);
      }

      let ore = 0;
      let sellable = 0;
      let held = 0;
      for (const who of fleet) {
        ore += goodsFlows(runtime.ledger, who, WORKS_YIELD_GOOD).produced;
        sellable += sellableEverywhere(runtime.ledger, who);
        held += heldIn(runtime.ledger, who);
      }
      readings.push({ n, ore, sellable, held });
    }

    const one = readings[0];
    if (one === undefined) throw new Error('unreachable');
    // Non-vacuity FIRST, and it is the assertion that makes the rest mean anything: the fleets
    // really did produce, really are holding the good, and really can sell some of it. A run
    // where nothing was extracted would report the Sybil property proved over an empty set —
    // which is exactly how the currency twin's first draft passed while measuring nothing.
    expect(one.ore, 'non-vacuity: the WORKS must actually have extracted ore').toBeGreaterThan(0);
    expect(one.held, 'and the fleet must be holding the endowment good').toBeGreaterThan(
      Number(LEVY_STARTER_ALLOTMENT) - Number(WORKS_BUILD_QTY),
    );
    expect(
      one.sellable,
      'and ONE identity must be able to sell something, or "no more than one" is a floor of zero',
    ).toBeGreaterThan(0);
    expect(Number(REFINE_OUT_QTY), 'the ratio the sellable total is denominated in').toBeGreaterThan(0);

    for (const r of readings) {
      // ★ THE PROPERTY. World output is Σ over systems of the tier yield, and the tier yield is
      // divided rather than multiplied, so N keypairs at one system extract exactly what one
      // extracts and can therefore sell exactly what one can sell.
      expect(
        r.ore,
        `N=${String(r.n)}: Σ ore is a property of the ground — ${String(r.ore)} against ${String(one.ore)} at N=1`,
      ).toBe(one.ore);
      expect(
        r.sellable,
        `N=${String(r.n)}: Σ sellable ${ENDOWMENT_GOOD} must not grow with the population — ` +
          `${String(r.sellable)} against ${String(one.sellable)} at N=1`,
      ).toBe(one.sellable);
      // And the ALLOTMENTS grow linearly while the sellable total does not, which is the
      // difference the counter exists to make. Without this line the test above would also pass
      // in a world where nobody was granted anything.
      expect(
        r.held,
        `N=${String(r.n)}: the fleet HOLDS N allotments, which is what makes the line above a claim`,
      ).toBeGreaterThan(r.n * (Number(LEVY_STARTER_ALLOTMENT) - Number(WORKS_BUILD_QTY)) - 1);
    }
  });
});

describe('the rules surface says the same thing the engine does (scar #1)', () => {
  it('★ THE PUBLISHED GOODS RULE NO LONGER CLAIMS THE FLOOR NEVER FALLS', () => {
    // ══════════════════════════════════════════════════════════════════════
    // `market.endowment.goods_rule` said *"Unlike the currency floor this one NEVER FALLS, so a
    // principal that paid its whole allotment to the Levy is still treated as holding it"*. That
    // was an accurate description of a defect, and the engine no longer behaves that way — so the
    // sentence had to move in the same commit. A rules surface describing the old behaviour is
    // scar #1, and this one is published to every agent in the world.
    //
    // MUTATION: leave the old sentence in place. RED on the first assertion.
    // ══════════════════════════════════════════════════════════════════════
    expect(ENDOWMENT_GOODS_RULE, 'the false claim must be gone').not.toMatch(/NEVER FALLS/i);
    expect(ENDOWMENT_GOODS_RULE, 'and the true one stated').toMatch(/FALLS/);
    // The three things an agent gets wrong, in the order it forms them.
    expect(ENDOWMENT_GOODS_RULE, '1. what the number is').toContain('floor_qty');
    expect(ENDOWMENT_GOODS_RULE, '2. delivering it frees nothing').toContain('unlocks nothing');
    expect(ENDOWMENT_GOODS_RULE, '3. producing does').toContain('PRODUCING');
    // And the latent defect, named, because an agent that split its goods used to be refused at
    // both venues and had no way to learn why.
    expect(ENDOWMENT_GOODS_RULE, 'and that it is charged once').toContain('PER PRINCIPAL');
  });

  it('agent.md states the goods rule, in the engine own field names', () => {
    // Pinned against the field names rather than retyped prose, so a rename cannot leave the
    // agent-facing text describing a field that no longer exists — and pinned NEGATIVELY against
    // the sentence that is now false, which is the half a "contains" test cannot do.
    const md = readFileSync(fileURLToPath(new URL('../../agent.md', import.meta.url)), 'utf8');
    for (const wanted of [
      'market.endowment.floor_qty',
      'market.endowment.sellable_qty',
      'per PRINCIPAL, not per venue',
    ]) {
      expect(md, `agent.md must say: ${wanted}`).toContain(wanted);
    }
    expect(md, 'agent.md must not still say the goods floor never falls').not.toMatch(
      /it \*\*never falls\*\*/,
    );
  });
});
