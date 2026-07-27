/**
 * PRD-1 … PRD-6 — what must be true about predation at every tick close, forever.
 *
 * These are **not** new entries in `invariants/registry.ts`, for the reason
 * `market/invariants.ts` gives: that register is TESTING.md §3's twenty-six,
 * cross-checked against the document, and quietly growing it would make "the 26
 * invariants" a number nobody can trust. So predation's clauses carry their own prefix
 * and are supplied through the tick loop's `assertions` hook, which merges them into the
 * same ASSERT pass and halts the tick on the same terms.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE TWO THAT CARRY THE AXIOMS.**
 *
 * `PRD-1` is A8 as an assertion rather than as care: *in the Commons hostile action is
 * invalid, not punished*. Target selection already refuses a Commons stage, and the
 * verb layer already runs `commonsFloorRejection`, and this checks the **result** anyway
 * — because a floor held up by two callers behaving well is not a floor, and A8 is the
 * one promise a newcomer is given before it has learned anything else.
 *
 * `PRD-3` is A5′: the record must never be wrong. It recomputes every recorded loss from
 * the posting log by a second road, so a raid that wrote down a figure the ledger did not
 * move aborts the tick instead of becoming a permanent public lie about a real agent.
 * ══════════════════════════════════════════════════════════════════════════
 */

import type { InvariantViolation, PrincipalId, SystemId, ZoneTier } from '../core/types.js';
import { halt } from '../invariants/registry.js';
import { compareIds } from '../ledger/order.js';
import type { Book, RaidRecord } from './book.js';
import { DEMAND_WINDOW_TICKS, MAX_LIVE_RAIDS, MAX_RAID_PARTIES, MAX_RAID_ROWS } from './params.js';

export interface PredationInvariantInputs {
  readonly book: Book;
  readonly tick: number;
  readonly tierOf: (system: SystemId) => ZoneTier;
  /**
   * The quantity of `good` the record says was destroyed or relocated **because of this
   * raid**, recomputed from the posting log rather than from the raid row.
   *
   * The second road for PRD-3. Supplied by the runtime because only it can read the
   * ledger, and returning `null` means "this world has no ledger attached", which skips
   * the clause rather than halting a fixture.
   */
  readonly movedForRaid: (raid: RaidRecord) => number | null;
  /** Principals with a default recorded at this tick. PRD-5's input. */
  readonly defaultsThisTick: ReadonlySet<PrincipalId>;
}

/** Every predation clause, in id order. The one call the ASSERT hook makes. */
export function checkPredationInvariants(
  input: PredationInvariantInputs,
): readonly InvariantViolation[] {
  return [
    ...checkPrd1(input),
    ...checkPrd2(input),
    ...checkPrd3(input),
    ...checkPrd4(input),
    ...checkPrd5(input),
    ...checkPrd6(input),
    ...checkPrd7(input),
  ];
}

/**
 * **PRD-1** — no raid, live or historical, has a Commons stage.
 *
 * A8, and it is checked against the *record* rather than against the selection code. The
 * historical half matters as much as the live half: a Commons raid that resolved last
 * Reckoning is a permanent public fact that the floor was breached, and the world should
 * stop rather than carry it.
 */
export function checkPrd1(input: PredationInvariantInputs): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  for (const raid of input.book.all()) {
    if (input.tierOf(raid.stage) !== 'COMMONS') continue;
    out.push(
      halt(
        'PRD-1',
        input.tick,
        `raid ${raid.id} stands at ${raid.stage}, which is COMMONS. A8: hostile action in the Commons is ` +
          `invalid, not punished — a raid there must never have been created, let alone resolved.`,
      ),
    );
  }
  return out;
}

/**
 * **PRD-2** — the book stays inside its declared bounds (INV-26, scar #3).
 *
 * Every array in this repo has a bound and the bound is asserted, because scar #3 was an
 * unbounded array that became an OOM and a disk DoS. A raid row is serialised into
 * `state_hash` every tick and into every observation of its parties.
 */
export function checkPrd2(input: PredationInvariantInputs): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  const live = input.book.liveCount();
  if (live > MAX_LIVE_RAIDS) {
    out.push(halt('PRD-2', input.tick, `${String(live)} raids are live; the declared cap is ${String(MAX_LIVE_RAIDS)}`));
  }
  if (input.book.size() > MAX_RAID_ROWS) {
    out.push(
      halt(
        'PRD-2',
        input.tick,
        `the raid book holds ${String(input.book.size())} rows; the declared cap is ${String(MAX_RAID_ROWS)}`,
      ),
    );
  }
  for (const raid of input.book.all()) {
    if (raid.parties.length > MAX_RAID_PARTIES) {
      out.push(
        halt(
          'PRD-2',
          input.tick,
          `raid ${raid.id} has ${String(raid.parties.length)} parties; the declared cap is ${String(MAX_RAID_PARTIES)}`,
        ),
      );
    }
    const seen = new Set<PrincipalId>();
    for (const party of raid.parties) {
      if (seen.has(party.principal)) {
        out.push(halt('PRD-2', input.tick, `${party.principal} appears twice in raid ${raid.id}`));
      }
      seen.add(party.principal);
    }
    // Canonical order is part of the capture, so a book out of order hashes differently
    // on two hosts that did the same thing (DET-1/DET-2).
    const ordered = [...raid.parties].sort((a, b) => compareIds(a.principal, b.principal));
    if (raid.parties.some((p, i) => p.principal !== ordered[i]?.principal)) {
      out.push(halt('PRD-2', input.tick, `raid ${raid.id} holds its parties out of canonical order`));
    }
  }
  return out;
}

/**
 * **PRD-3** — every recorded loss is exactly what the ledger moved. **A5′.**
 *
 * The raid row says a principal lost N units. This recomputes N from the postings the
 * raid's own events produced and halts on any difference *in either direction*. Too high
 * is the libel — the record accusing the world of having taken more than it did, from a
 * named agent, permanently. Too low is a quieter version of the same defect: the goods
 * are gone and the record says they are not, so INV-2's supply arithmetic and the raid's
 * own story disagree.
 *
 * Skipped, not failed, when `movedForRaid` returns null — a fixture with no ledger has
 * nothing to check against, and halting there would make this clause untestable in
 * isolation, which is how a clause quietly stops running.
 */
export function checkPrd3(input: PredationInvariantInputs): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  for (const raid of input.book.all()) {
    if (raid.state === 'DEMANDED') {
      if (raid.lostQty !== 0) {
        out.push(
          halt('PRD-3', input.tick, `raid ${raid.id} is still open and already records a loss of ${String(raid.lostQty)}`),
        );
      }
      continue;
    }
    const moved = input.movedForRaid(raid);
    if (moved === null) continue;
    if (moved !== raid.lostQty) {
      out.push(
        halt(
          'PRD-3',
          input.tick,
          `raid ${raid.id} records ${String(raid.lostQty)} of ${raid.good} lost by ${raid.target}, but the ` +
            `posting log moved ${String(moved)}. A5′: a loss recorded against a principal that did not suffer ` +
            `it is a permanent public libel and is worse than a crash.`,
        ),
      );
    }
  }
  return out;
}

/**
 * **PRD-4** — no raid resolved before its published window had run.
 *
 * The other half of A5′: a loss taken from a principal that was never given the window
 * the rules promise it is a loss it was never shown. `windowWasHonest` gates the
 * resolver; this asserts the *outcome*, so a second resolution path added later cannot
 * quietly skip the gate.
 */
export function checkPrd4(input: PredationInvariantInputs): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  for (const raid of input.book.all()) {
    if (raid.resolvedAtTick === null) continue;
    // `PAID` is the exception and it is the target's own act: an agent that chooses to
    // pay early has been shown the demand by definition, and making it wait would be
    // the engine refusing a decision the window exists to offer.
    if (raid.state === 'PAID') continue;
    const window = raid.resolvedAtTick - raid.spawnedAtTick;
    if (window < DEMAND_WINDOW_TICKS) {
      out.push(
        halt(
          'PRD-4',
          input.tick,
          `raid ${raid.id} resolved ${String(window)} ticks after it spawned; the published window is ` +
            `${String(DEMAND_WINDOW_TICKS)}. Taking from a principal before its window has run takes from one ` +
            `that was never shown the demand.`,
        ),
      );
    }
  }
  return out;
}

/**
 * **PRD-5** — a raid never produces a default.
 *
 * *"Never record a default for failing to pay a demand it was never shown"* — and the
 * strongest form of that promise is that a raid cannot record a default **at all**,
 * shown or not. Nobody promised the world anything, so there is no promise to break:
 * non-payment of a demand is a loss, not a breach, and standing does not move (INV-21
 * permits it to move only on an elective-honoured settlement, a default, a contradicted
 * seal, or scheduled decay — and none of those is a raid).
 *
 * Checked as "no principal that resolved a raid this tick also acquired a default this
 * tick", which is coarse on purpose: it would fire on a coincidence, and a coincidence
 * between a raid and a default is exactly the case a human needs to look at, because
 * §15.4's named nightmare is a raid draining an account and the settlement calling the
 * result a broken promise.
 */
export function checkPrd5(input: PredationInvariantInputs): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  if (input.defaultsThisTick.size === 0) return out;
  for (const raid of input.book.all()) {
    if (raid.resolvedAtTick !== input.tick) continue;
    if (!input.defaultsThisTick.has(raid.target)) continue;
    out.push(
      halt(
        'PRD-5',
        input.tick,
        `${raid.target} was raided (${raid.id}, ${raid.state}) and acquired a default in the same tick. ` +
          `§15.4: "my convoy is raided and X is drained; my default is your bug, permanently attached to my ` +
          `name". Predation records losses, never defaults — read the attribution before resuming.`,
      ),
    );
  }
  return out;
}

/**
 * **PRD-6** — a resolved raid's arithmetic is internally consistent.
 *
 * Cheap, and it catches the class of bug where a branch writes the right number into the
 * wrong field: a `REPULSED` raid that took goods, a `PAID` raid that forfeited stakes, a
 * `PLUNDERED` raid whose recorded forces say the defender won.
 */
export function checkPrd6(input: PredationInvariantInputs): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  for (const raid of input.book.all()) {
    const problems = raidArithmeticProblems(raid);
    for (const problem of problems) {
      out.push(halt('PRD-6', input.tick, `raid ${raid.id}: ${problem}`));
    }
  }
  return out;
}

/** The per-raid consistency rules, as a list, so a test can name the one it broke. */
export function raidArithmeticProblems(raid: RaidRecord): readonly string[] {
  const problems: string[] = [];
  if (raid.lostQty < 0) problems.push(`records a negative loss of ${String(raid.lostQty)}`);
  if (raid.forfeited < 0) problems.push(`records a negative forfeit of ${String(raid.forfeited)}`);
  if (raid.demandQty <= 0) problems.push('was issued with a demand of zero, which is not a demand');
  if (raid.resolvesAtTick <= raid.spawnedAtTick) {
    problems.push('resolves at or before it spawned, so its window never existed');
  }
  switch (raid.state) {
    case 'DEMANDED':
      if (raid.resolvedAtTick !== null) problems.push('is open and carries a resolution tick');
      break;
    case 'REPULSED':
      if (raid.lostQty > 0) problems.push(`was repulsed and still took ${String(raid.lostQty)} of goods`);
      if (raid.defenderForce < raid.raiderForce) {
        problems.push(
          `was repulsed with ${String(raid.defenderForce)} against ${String(raid.raiderForce)}; higher force wins`,
        );
      }
      break;
    case 'PLUNDERED':
      if (raid.lostQty <= 0) problems.push('is PLUNDERED and took nothing; that outcome is MISSED');
      if (raid.forfeited > 0) problems.push('is PLUNDERED and forfeited raider stakes, which only a repulse does');
      if (raid.defenderForce >= raid.raiderForce) {
        problems.push(
          `plundered with ${String(raid.defenderForce)} against ${String(raid.raiderForce)}; ties go to the defender`,
        );
      }
      break;
    case 'PAID':
      if (raid.forfeited > 0) problems.push('was paid and forfeited raider stakes, which only a repulse does');
      if (raid.lostQty > raid.demandQty) {
        problems.push(`was paid ${String(raid.lostQty)} against a demand of ${String(raid.demandQty)}`);
      }
      break;
    case 'MISSED':
      if (raid.lostQty > 0) problems.push(`missed and still took ${String(raid.lostQty)} of goods`);
      break;
  }
  return problems;
}
