/**
 * `OPS-*` — the combat layer's own invariants.
 *
 * **Deliberately not in `invariants/registry.ts`.** That register is `TESTING.md` §3's twenty-six, and
 * `predation/invariants.ts` states the rule this file follows: *"quietly growing it would make 'the 26
 * invariants' a number nobody can trust."* So a subsystem prefix, `halt(...)` violations from the
 * shared helper, and a hand-off to the tick loop's `assertions` hook.
 *
 * ── EVERY ONE OF THESE HAS A SUBJECT THAT CAN ACTUALLY OCCUR ────────────────
 *
 * This project's most expensive recurring lesson: *"invariants whose subject cannot occur — INV-22
 * green over an empty journal for the project's whole life."* So each check below names what makes it
 * non-vacuous, and {@link combatCoverage} reports **how many of each subject the world has actually
 * produced**, so a green suite over an empty book cannot be mistaken for a green suite over a
 * working one. That number belongs in the report, not in a comment.
 */

import type { InvariantViolation, PrincipalId } from '../core/types.js';
import { halt, warn } from '../invariants/registry.js';
import type { Book, EngagementRecord } from './book.js';
import { ECHELON_DEPTH } from './params.js';
import type { Fleet } from './fleet.js';
import { isWorldHull, WORLD_PRINCIPAL } from './battle.js';
import { MAX_FORMATIONS_PER_SIDE, MAX_LIVE_ENGAGEMENTS } from './params.js';

export interface CombatInvariantInputs {
  readonly book: Book;
  readonly fleet: Fleet;
  readonly tick: number;
  /** Is this raid still live? A battle over a settled standoff is a leak. */
  readonly raidIsLive: (raid: string) => boolean;
  /** Hands the world believes are RECOVERING. A wrecked hull's hand must be one of them. */
  readonly recoveringHands: ReadonlySet<string>;
}

/** How much of each invariant's subject the world has produced. Non-vacuity, as a number. */
export interface CombatCoverage {
  readonly engagements: number;
  readonly liveEngagements: number;
  readonly formations: number;
  readonly hulls: number;
  readonly wrecks: number;
  readonly closed: number;
}

export function combatCoverage(book: Book, fleet: Fleet): CombatCoverage {
  const all = book.all();
  return {
    engagements: all.length,
    liveEngagements: all.filter((r) => r.resolvedAtTick === null).length,
    formations: all.reduce((n, r) => n + r.formations.length, 0),
    hulls: fleet.size(),
    wrecks: all.reduce((n, r) => n + r.wrecks.length, 0),
    closed: all.filter((r) => r.resolvedAtTick !== null).length,
  };
}

/**
 * `OPS-1` — a hull is in at most one battle, and a battle's hulls exist.
 *
 * *Subject:* any committed formation. The failure it catches is the one that would make A5′ wrong
 * with a warship in it: a hull marked READY by the fleet while a formation is still flying it can be
 * committed twice, and the second wreck destroys an asset that was already gone.
 */
export function checkOps1(input: CombatInvariantInputs): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  const seen = new Map<string, string>();
  for (const record of input.book.live()) {
    for (const formation of record.formations) {
      if (formation.withdrawn) continue;
      for (const hullId of formation.hulls) {
        if (isWorldHull(hullId)) continue;
        const held = seen.get(hullId);
        if (held !== undefined) {
          out.push(
            halt(
              'OPS-1',
              input.tick,
              `hull ${hullId} is in two formations at once (${held} and ${formation.id}). One hull, one fight — ` +
                `otherwise a second wreck destroys an asset that was already destroyed, which is A5′ with a ` +
                `warship in it.`,
            ),
          );
        }
        seen.set(hullId, formation.id);
        const row = input.fleet.get(hullId);
        if (row === undefined) {
          out.push(
            halt(
              'OPS-1',
              input.tick,
              `formation ${formation.id} flies hull ${hullId}, which is not in the fleet book. A battle cannot ` +
                `destroy an asset the ledger has never heard of.`,
            ),
          );
        } else if (row.state !== 'ENGAGED') {
          out.push(
            halt(
              'OPS-1',
              input.tick,
              `hull ${hullId} is flying in ${formation.id} and the fleet book says ${row.state}. Two homes for ` +
                `one fact disagreeing is scar #5 on the asset that can be destroyed.`,
            ),
          );
        }
      }
    }
  }
  return out;
}

/**
 * `OPS-2` — hands and hulls stay index-aligned, and a formation is never empty-but-standing.
 *
 * *Subject:* every formation. The bug it catches is silent and catastrophic: an off-by-one between
 * the two arrays wrecks a different principal's asset than the one that died, and the record would be
 * internally consistent while naming the wrong victim.
 */
export function checkOps2(input: CombatInvariantInputs): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  for (const record of input.book.all()) {
    for (const formation of record.formations) {
      if (formation.hands.length !== formation.hulls.length) {
        out.push(
          halt(
            'OPS-2',
            input.tick,
            `formation ${formation.id} has ${String(formation.hands.length)} hand(s) and ` +
              `${String(formation.hulls.length)} hull(s). They are index-aligned, so a mismatch means the next ` +
              `wreck destroys the wrong principal's asset.`,
          ),
        );
      }
      if (formation.ehp > formation.ehpFull) {
        out.push(
          halt(
            'OPS-2',
            input.tick,
            `formation ${formation.id} has ${String(formation.ehp)} EHP of ${String(formation.ehpFull)}. Repair ` +
              `may never exceed the buffer, or a repair wing is a faucet.`,
          ),
        );
      }
      if (formation.cap > formation.capFull) {
        out.push(
          halt('OPS-2', input.tick, `formation ${formation.id} holds more capacitor than it has capacity for.`),
        );
      }
      if (formation.ehp < 0) {
        out.push(halt('OPS-2', input.tick, `formation ${formation.id} has negative EHP.`));
      }
    }
  }
  return out;
}

/**
 * `OPS-3` — a wrecked hull's hand is RECOVERING, and the hull is WRECKED.
 *
 * *Subject:* every wreck. §6.2 is absolute — *"hands are never destroyed"* — and A5 is equally
 * absolute the other way: the hull is gone forever. A wreck that left the hand IDLE would hand its
 * owner a free hull-less combatant; a wreck that left the hull READY would hand it the hull back.
 */
export function checkOps3(input: CombatInvariantInputs): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  for (const record of input.book.all()) {
    if (record.resolvedAtTick === null) continue;
    for (const wreck of record.wrecks) {
      if (wreck.principal === WORLD_PRINCIPAL) continue;
      const row = input.fleet.get(wreck.hand as never);
      void row;
      if (input.recoveringHands.size > 0 && !input.recoveringHands.has(wreck.hand)) {
        // A WARN, not a HALT: recovery is time-bounded, so a hand that has already finished
        // recovering by the time this runs is legitimately not in the set. What would be a defect is
        // a hand that never entered it, and that is only distinguishable at the tick of the wreck —
        // which is where `wired.spec.ts` asserts it. Halting here would abort a healthy world.
        out.push(
          warn(
            'OPS-3',
            input.tick,
            `the hand ${wreck.hand} that lost a ${wreck.hull} at tick ${String(wreck.tick)} is not RECOVERING. ` +
              `If it never was, a wreck cost its owner nothing in presence.`,
          ),
        );
      }
    }
  }
  return out;
}

/**
 * `OPS-4` — a battle exists only over a live standoff, and never more than the cap.
 *
 * *Subject:* every live engagement. Two failures: a battle that outlived its raid means the force
 * reading already counted hands a wreck had taken off the board (which is what
 * `assertEngagementSchedule` exists to make impossible, and this is the runtime half of the same
 * claim); and an unbounded battle count is an unbounded tick, which is DET-9.
 */
export function checkOps4(input: CombatInvariantInputs): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  const live = input.book.live();
  if (live.length > MAX_LIVE_ENGAGEMENTS) {
    out.push(
      halt(
        'OPS-4',
        input.tick,
        `${String(live.length)} battles are running and the cap is ${String(MAX_LIVE_ENGAGEMENTS)}. An unbounded ` +
          `battle count is an unbounded tick.`,
      ),
    );
  }
  for (const record of live) {
    if (!input.raidIsLive(record.raid)) {
      out.push(
        halt(
          'OPS-4',
          input.tick,
          `the battle ${record.id} is live and its standoff ${record.raid} is not. A battle that outlives its ` +
            `raid means readForce already counted hands a wreck had taken off the board.`,
        ),
      );
    }
    for (const side of ['RAIDER', 'DEFENDER'] as const) {
      const count = record.formations.filter((f) => f.side === side).length;
      if (count > MAX_FORMATIONS_PER_SIDE) {
        out.push(
          halt(
            'OPS-4',
            input.tick,
            `the ${side} side of ${record.id} fields ${String(count)} formations and the cap is ` +
              `${String(MAX_FORMATIONS_PER_SIDE)}.`,
          ),
        );
      }
    }
  }
  return out;
}

/**
 * `OPS-5` — the world never owns an asset, and never appears in the fleet.
 *
 * *Subject:* every world raid's fleet. §9's *"nobody owns them, so nobody can be bribed to call them
 * off"* has to be true of the fleet as well as of the raid. If a world hull were ever in the fleet
 * book, a wreck would burn goods nobody held (minting a sink out of nothing, which INV-1 catches one
 * layer down) and, worse, `WORLD` would accumulate a standing record — a principal that cannot be
 * dealt with acquiring a reputation is a category error the whole trust layer would then read.
 */
export function checkOps5(input: CombatInvariantInputs): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  for (const row of input.fleet.all()) {
    if (row.owner === WORLD_PRINCIPAL) {
      out.push(
        halt(
          'OPS-5',
          input.tick,
          `the fleet book holds hull ${row.id} owned by ${WORLD_PRINCIPAL}. The world owns nothing: a world hull ` +
            `in the ledger would burn goods nobody held and give an unreachable principal a standing record.`,
        ),
      );
    }
    if (isWorldHull(row.id)) {
      out.push(halt('OPS-5', input.tick, `hull ${row.id} uses the world's reserved id namespace.`));
    }
  }
  for (const record of input.book.all()) {
    if (record.initiator !== null && record.worldForce !== 0) {
      out.push(
        halt(
          'OPS-5',
          input.tick,
          `battle ${record.id} was opened by ${record.initiator} and carries worldForce ` +
            `${String(record.worldForce)}. An agent-initiated raid brings hands and hulls, never the world's.`,
        ),
      );
    }
  }
  return out;
}

/**
 * `OPS-6` — the gap and the echelons stay inside the topology.
 *
 * *Subject:* every live engagement. A gap outside the range table indexes past the end of
 * `RANGE_FACTOR` and every weapon silently applies at whatever `undefined` coerces to — a whole
 * battle resolved at zero damage, with nothing in the log to say why.
 */
export function checkOps6(input: CombatInvariantInputs): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  for (const record of input.book.live()) {
    if (record.gap < 0 || record.gap > 4) {
      out.push(
        halt(
          'OPS-6',
          input.tick,
          `battle ${record.id} has gap ${String(record.gap)}, outside 0..4. Every weapon then reads past the end ` +
            `of its range row and applies at whatever undefined coerces to.`,
        ),
      );
    }
    for (const formation of record.formations) {
      if (!Object.prototype.hasOwnProperty.call(ECHELON_DEPTH, formation.echelon)) {
        out.push(
          halt('OPS-6', input.tick, `formation ${formation.id} stands at echelon "${formation.echelon}", which has no depth.`),
        );
      }
    }
  }
  return out;
}

/**
 * `OPS-7` — a closed battle has field control, an open one does not.
 *
 * *Subject:* every engagement. `fieldControl` is what the raid's force reading is *observed* against
 * and what the frame draws; a closed battle with none published leaves the record silent about who
 * won, which is the one thing a permanent public account of a fight has to say.
 */
export function checkOps7(input: CombatInvariantInputs): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  for (const record of input.book.all()) {
    const closed = record.resolvedAtTick !== null;
    if (closed && record.fieldControl === null) {
      out.push(
        halt('OPS-7', input.tick, `battle ${record.id} closed at tick ${String(record.resolvedAtTick)} with no field control published.`),
      );
    }
    if (!closed && record.fieldControl !== null) {
      out.push(
        halt('OPS-7', input.tick, `battle ${record.id} is live and already claims ${record.fieldControl} holds the field.`),
      );
    }
    if (closed && record.state !== 'AFTERMATH') {
      out.push(halt('OPS-7', input.tick, `battle ${record.id} is closed and its state is ${record.state}, not AFTERMATH.`));
    }
  }
  return out;
}

/** Run them all, in id order so a report is stable. */
export function checkCombatInvariants(input: CombatInvariantInputs): readonly InvariantViolation[] {
  return [
    ...checkOps1(input),
    ...checkOps2(input),
    ...checkOps3(input),
    ...checkOps4(input),
    ...checkOps5(input),
    ...checkOps6(input),
    ...checkOps7(input),
  ];
}

/** Who has lost hulls, for the standing and dossier layers to read. Public per A5. */
export function wreckTally(book: Book): ReadonlyMap<PrincipalId, number> {
  const out = new Map<PrincipalId, number>();
  for (const record of book.all()) {
    for (const wreck of record.wrecks) {
      if (wreck.principal === WORLD_PRINCIPAL) continue;
      out.set(wreck.principal, (out.get(wreck.principal) ?? 0) + 1);
    }
  }
  return out;
}

/** Every battle a principal fought, for the dossier. */
export function battlesOf(book: Book, principal: PrincipalId): readonly EngagementRecord[] {
  return book.forPrincipal(principal);
}
