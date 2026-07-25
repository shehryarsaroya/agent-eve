/**
 * INV-24, INV-25, INV-26 — the clock and the crowd.
 *
 * INV-25 is the one TESTING.md §3 singles out: *"the anti-quiet invariant, and the
 * one most likely to quietly stop being true as features are added."* It is the
 * executable form of A14 — drama runs on a clock, never on agents choosing
 * conflict — and the reason the Levy exists at all (SPEC §5.2: without it "an agent
 * that forms no ventures and stays in the Commons is never on the docket, never
 * penalised, never even visible as a problem"). If this check ever passes because
 * the docket is empty and so is the principal list, the design has quietly lost its
 * forcing function. So the check refuses an empty principal set.
 */

import type { CanonicalValue } from '../core/canonical.js';
import type {
  ConstellationId,
  InvariantViolation,
  PrincipalId,
} from '../core/types.js';
import type { Minor } from '../core/units.js';
import { halt } from './registry.js';

// ── INV-24: the Levy ────────────────────────────────────────────────────────

/**
 * One principal's share of a constellation's Levy total.
 *
 * `newcomerFloored` is recorded rather than derived, because SPEC §5.2's floor is a
 * *protection* and the record has to show it was applied: inverse-EXPOSURE
 * weighting hands the minute-60 newcomer the maximum assessment, so a floor that
 * silently failed to apply looks like an ordinary hard first night.
 */
export interface LevyAssessment {
  readonly principal: PrincipalId;
  readonly constellation: ConstellationId;
  readonly amount: Minor;
  readonly newcomerFloored: boolean;
}

export interface Inv24Inputs {
  /** The total each constellation assessed. Fixed by rule and cannot be dodged. */
  readonly totals: ReadonlyMap<ConstellationId, Minor>;
  readonly assessments: readonly LevyAssessment[];
  /** Principals below the tenure-and-capital threshold (SPEC §5.2). */
  readonly floorEligible: ReadonlySet<PrincipalId>;
  /** The nominal rate a floored principal is assessed at. */
  readonly nominalRate: Minor;
  /** This Reckoning's seizure queue. A floored principal is never in it. */
  readonly seizureQueue: readonly PrincipalId[];
}

/**
 * INV-24 — Σ Levy assessments equals the constellation total, exactly, and the
 * newcomer floor is applied to every eligible principal.
 *
 * "Exactly" is the word that matters. The Levy is paid in delivered goods and its
 * shortfall drives a seizure ballot, so an allocation that sums to one minor unit
 * more than the total puts a principal in a seizure queue for a debt the rule never
 * created.
 */
export function checkInv24(inputs: Inv24Inputs, tick: number): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  const summed = new Map<ConstellationId, number>();
  /**
   * Assessed-already, per constellation.
   *
   * A nested map rather than a joined string key. The joined-key idiom needs a
   * separator that cannot occur in an id, the usual choice is a NUL, and a source
   * file containing a real NUL byte is reported by `file(1)` as `data` and skipped
   * entirely by grep — which silently switches off every grep-based guard in this
   * repo, including SEC-9's outbound secret scan, while tsc, eslint and vitest all
   * stay green. Wave 1 shipped nine of those. Two structures cost nothing.
   */
  const seen = new Map<ConstellationId, Set<PrincipalId>>();
  const queued = new Set<PrincipalId>(inputs.seizureQueue);

  for (const a of [...inputs.assessments].sort(
    (x, y) => cmp(x.constellation, y.constellation) || cmp(x.principal, y.principal),
  )) {
    let assessed = seen.get(a.constellation);
    if (assessed === undefined) {
      assessed = new Set<PrincipalId>();
      seen.set(a.constellation, assessed);
    }
    if (assessed.has(a.principal)) {
      out.push(
        halt(
          'INV-24',
          tick,
          `${a.principal} is assessed twice in ${a.constellation}; a double assessment is a debt the rule ` +
            'never created',
        ),
      );
    }
    assessed.add(a.principal);
    if (a.amount < 0) {
      out.push(halt('INV-24', tick, `${a.principal} is assessed ${a.amount} in ${a.constellation}`));
    }
    if (!inputs.totals.has(a.constellation)) {
      out.push(
        halt(
          'INV-24',
          tick,
          `${a.principal} is assessed in ${a.constellation}, which declared no total`,
        ),
      );
    }
    summed.set(a.constellation, (summed.get(a.constellation) ?? 0) + a.amount);

    const eligible = inputs.floorEligible.has(a.principal);
    if (eligible && a.amount > inputs.nominalRate) {
      out.push(
        halt(
          'INV-24',
          tick,
          `${a.principal} is inside the newcomer floor but is assessed ${a.amount}, above the nominal rate ` +
            `of ${inputs.nominalRate}`,
        ),
      );
    }
    if (eligible && !a.newcomerFloored) {
      out.push(
        halt(
          'INV-24',
          tick,
          `${a.principal} is inside the newcomer floor but its assessment does not record the floor being ` +
            'applied; the protection must be visible in the record',
        ),
      );
    }
    if (!eligible && a.newcomerFloored) {
      out.push(
        halt(
          'INV-24',
          tick,
          `${a.principal} is not inside the newcomer floor but its assessment claims the floor`,
        ),
      );
    }
    if (eligible && queued.has(a.principal)) {
      out.push(
        halt(
          'INV-24',
          tick,
          `${a.principal} is inside the newcomer floor and is in the seizure queue; SPEC §5.2 says never`,
        ),
      );
    }
  }

  for (const [constellation, total] of [...inputs.totals.entries()].sort((a, b) => cmp(a[0], b[0]))) {
    const got = summed.get(constellation) ?? 0;
    if (got !== total) {
      out.push(
        halt(
          'INV-24',
          tick,
          `${constellation} assessed a total of ${total} but its assessments sum to ${got}`,
        ),
      );
    }
  }

  return out;
}

// ── INV-25: the docket ──────────────────────────────────────────────────────

/**
 * One line of the Reckoning's docket. Names every principal it puts on screen.
 *
 * `kind` is free-form on purpose: the docket is a projection, and constraining its
 * row kinds here would make this module a second home for the Reckoning's agenda.
 */
export interface DocketRow {
  readonly reckoningIndex: number;
  readonly kind: string;
  readonly principals: readonly PrincipalId[];
}

/**
 * INV-25 — every principal appears in >=1 docket row per Reckoning.
 *
 * Refuses an empty principal list, because the failure mode this invariant guards
 * is *silence*, and a check that passes on an empty world is a check that will pass
 * on the exact night everything went quiet.
 */
export function checkInv25(
  principals: readonly PrincipalId[],
  docket: readonly DocketRow[],
  atReckoning: number,
  tick: number,
): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  if (principals.length === 0) {
    out.push(
      halt(
        'INV-25',
        tick,
        'the anti-quiet invariant was asked about zero principals; an empty world satisfies it vacuously and ' +
          'that is exactly the night it must not',
      ),
    );
    return out;
  }

  const enrolled = new Set<PrincipalId>(principals);
  const onDocket = new Set<PrincipalId>();
  for (const row of docket) {
    if (row.reckoningIndex !== atReckoning) continue;
    for (const p of row.principals) {
      if (!enrolled.has(p)) {
        out.push(
          halt(
            'INV-25',
            tick,
            `docket row ${row.kind} for Reckoning ${atReckoning} names ${p}, who is not enrolled`,
          ),
        );
        continue;
      }
      onDocket.add(p);
    }
  }

  for (const p of [...enrolled].sort(cmp)) {
    if (!onDocket.has(p)) {
      out.push(
        halt(
          'INV-25',
          tick,
          `${p} appears in no docket row for Reckoning ${atReckoning}; abstention must be impossible (A14)`,
        ),
      );
    }
  }
  return out;
}

// ── INV-26: declared caps ───────────────────────────────────────────────────

/**
 * A declared bound on one array, by path.
 *
 * Paths are dotted, with `*` matching any single segment — array indices and
 * unknown keys alike. `hands.*.cargo` bounds the cargo array of every hand.
 */
export interface ArrayCap {
  readonly path: string;
  readonly max: number;
}

/** How deep the walker goes before refusing. Deeper than the canonicaliser needs. */
const MAX_WALK_DEPTH = 24;

/**
 * INV-26 — every array in every serialized structure is within its declared cap.
 *
 * **An array with no declared cap is itself a violation.** Scar #3 was an unbounded
 * array that became an OOM and a disk DoS, and the lesson is not "cap the arrays we
 * remembered" — it is that a structure going out over the wire with an
 * undeclared-length field is the bug, before anyone has filled it. So the default is
 * refusal, and adding a structure means adding its caps.
 *
 * Scoped to what it is handed: nothing yet enumerates every serialized structure in
 * the engine, and pretending otherwise is the flattering version of this check.
 */
export function checkInv26(
  root: CanonicalValue,
  caps: readonly ArrayCap[],
  tick: number,
  label = 'structure',
): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  const compiled = caps.map((c) => ({ segments: c.path.split('.'), max: c.max, path: c.path }));

  const walk = (value: CanonicalValue, path: readonly string[], depth: number): void => {
    if (depth > MAX_WALK_DEPTH) {
      out.push(
        halt(
          'INV-26',
          tick,
          `${label}: ${path.join('.')} is nested deeper than ${MAX_WALK_DEPTH}; the cap walker cannot ` +
            'see the bottom, so no cap can be claimed for it',
        ),
      );
      return;
    }
    if (Array.isArray(value)) {
      // `Array.isArray` narrows to `any[]`, which would let an unchecked element
      // through the recursion. Re-typed explicitly rather than suppressed.
      const items: readonly CanonicalValue[] = value as readonly CanonicalValue[];
      const here = path.join('.');
      const cap = compiled.find((c) => matches(c.segments, path));
      if (cap === undefined) {
        out.push(
          halt(
            'INV-26',
            tick,
            `${label}: array at ${here === '' ? '(root)' : here} has ${items.length} entries and no declared ` +
              'cap; an undeclared array is scar #3 waiting for a busy night',
          ),
        );
      } else if (items.length > cap.max) {
        out.push(
          halt(
            'INV-26',
            tick,
            `${label}: array at ${here === '' ? '(root)' : here} has ${items.length} entries, over its ` +
              `declared cap of ${cap.max} (${cap.path})`,
          ),
        );
      }
      for (const [i, v] of items.entries()) walk(v, [...path, String(i)], depth + 1);
      return;
    }
    if (value !== null && typeof value === 'object') {
      for (const key of Object.keys(value).sort(cmp)) {
        const child = (value as { readonly [k: string]: CanonicalValue })[key];
        if (child === undefined) continue;
        walk(child, [...path, key], depth + 1);
      }
    }
  };

  walk(root, [], 0);
  return out;
}

/** `*` matches one segment. Lengths must agree, so a cap cannot bind a whole subtree. */
function matches(segments: readonly string[], path: readonly string[]): boolean {
  if (segments.length !== path.length) return false;
  for (const [i, seg] of segments.entries()) {
    if (seg === '*') continue;
    if (seg !== path[i]) return false;
  }
  return true;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
