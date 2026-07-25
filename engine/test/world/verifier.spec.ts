/**
 * Adversarial verification of `src/world/**`. Everything here was written by
 * reading the module against the canon and trying to break it, not by reading its
 * own tests. Four defects are pinned:
 *
 *   1. **`classifyAction` was not total** — `Object.prototype` keys reached the
 *      table (fixed in `commons.ts`; this file is the regression).
 *   2. **`HoldingState.STANDING` and `Protection.EXPOSED` were §3 collisions** — now FIXED to
 *      `INTACT` and `ASSAILABLE`;
 *      recorded here the way `test/core/vocabulary.test.ts` records
 *      `DecisionSource.STANDING`, because §3 is a rules surface and the existing
 *      detector cannot see a union declared outside `core/types.ts`.
 *   3. **`map.spec.ts`'s "no room for an inter-constellation gate" case throws for
 *      a different reason than its name claims**, and the branch it names is
 *      unreachable.
 *   4. **`beginTransit` does not require PRESENT**, so "an arrival cannot act until
 *      T+1" holds for movement only because VALIDATE precedes MOVE — and
 *      `MOVE_PHASE_MUST_PRECEDE` deliberately does not name VALIDATE, so nothing in
 *      this module asserts the half the guarantee actually rests on.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import type { PrincipalId, SystemId } from '../../src/core/types.js';
import { Rng } from '../../src/core/rng.js';
import {
  assertVerbsClassified,
  beginTransit,
  checkWorldInvariants,
  classifyAction,
  commonsFloorRejection,
  commonsSystems,
  createWorld,
  enroll,
  generateMap,
  handsAt,
  handsOf,
  isPresent,
  LAUNCH_PLAN,
  launchMap,
  loseHand,
  MOVE_PHASE_MUST_PRECEDE,
  moveHand,
  resolveMovement,
  systemOf,
  tierOf,
  VERB_CLASS,
  worldHash,
  type Disposition,
  type HoldingState,
  type LaneKind,
  type Protection,
  type VerbClass,
  type WorldMap,
} from '../../src/world/index.js';

const SPEC = readFileSync(new URL('../../../docs/design/SPEC.md', import.meta.url), 'utf8');

// ── 1. classification totality ──────────────────────────────────────────────

/**
 * Keys every JS object answers to for free. An agent can put any of these in the
 * `verb` field of an unauthenticated enrolment request.
 */
const PROTOTYPE_KEYS = [
  'constructor',
  'toString',
  'valueOf',
  'hasOwnProperty',
  '__proto__',
  'isPrototypeOf',
  'toLocaleString',
  'propertyIsEnumerable',
] as const;

describe('DEFECT(world/commons): the verb table was reached through Object.prototype', () => {
  it('classifies a prototype key as HOSTILE, not as a function', () => {
    // Before the fix `classifyAction('constructor')` returned the *Object
    // constructor*: not `undefined`, not `'CONTEXTUAL'`, so it fell straight
    // through `return declared`. `commonsFloorRejection` happened to survive
    // because it compares `=== 'PEACEFUL'`, but the exported return type is
    // `Disposition` and the handoff note points the predation module at this
    // function. A raid module spelled `=== 'HOSTILE'` would have walked into the
    // Commons through eight verbs nobody had to invent.
    for (const key of PROTOTYPE_KEYS) {
      const verdict: Disposition = classifyAction(key);
      expect(verdict, key).toBe('HOSTILE');
      expect(typeof verdict, key).toBe('string');
    }
  });

  it('still rejects a prototype-key act aimed at the Commons', () => {
    const map = launchMap();
    const state = createWorld(map);
    const commons = commonsSystems(map)[0]!;
    enroll(state, 'p-victim' as PrincipalId, 'Vaunt', 0, commons);
    const hand = handsOf(state, 'p-victim' as PrincipalId)[0]!;
    for (const key of PROTOTYPE_KEYS) {
      expect(commonsFloorRejection(state, key, { hand_id: hand.id }), key).not.toBeNull();
    }
  });

  it('the CI totality check sees a prototype-named verb too', () => {
    // `assertVerbsClassified` had the same bare-index lookup, so if SPEC §12.2 ever
    // grew a verb named `constructor` the guard that exists to fail loudly would
    // have passed silently — the fail-safe default becoming the silent one, which
    // is the exact thing rule 1 in `commons.ts` promises not to allow.
    for (const key of PROTOTYPE_KEYS) {
      expect(() => assertVerbsClassified([...Object.keys(VERB_CLASS), key]), key).toThrow(
        /does not classify/,
      );
    }
  });
});

// ── 2. §3 vocabulary collisions in the world module ─────────────────────────

/** The §3 vocabulary table's Term column, parsed the same way core's test does. */
function specTerms(): string[] {
  const section = SPEC.split('## 3. Vocabulary')[1]?.split('\n## 4.')[0];
  if (section === undefined) throw new Error('SPEC §3 not found');
  const terms: string[] = [];
  for (const m of section.matchAll(/^\| \*\*(.+?)\*\* \| (.+?) \| (.+?) \|$/gm)) {
    for (const part of m[1]!.split(/[·/]/)) terms.push(part.trim());
  }
  return terms;
}

type Covers<Union, List extends readonly Union[]> = [Exclude<Union, List[number]>] extends [never]
  ? true
  : { missing: Exclude<Union, List[number]> };

const HOLDING_STATE = ['INTACT', 'FALLEN'] as const;
const PROTECTION = ['PROTECTED', 'ASSAILABLE', 'UNKNOWN'] as const;
const DISPOSITION = ['PEACEFUL', 'HOSTILE'] as const;
const VERB_CLASS_MEMBERS = ['PEACEFUL', 'HOSTILE', 'CONTEXTUAL'] as const;
const LANE_KIND = ['INTRA', 'INTER'] as const;

const _holdingStateComplete: Covers<HoldingState, typeof HOLDING_STATE> = true;
const _protectionComplete: Covers<Protection, typeof PROTECTION> = true;
const _dispositionComplete: Covers<Disposition, typeof DISPOSITION> = true;
const _verbClassComplete: Covers<VerbClass, typeof VERB_CLASS_MEMBERS> = true;
const _laneKindComplete: Covers<LaneKind, typeof LANE_KIND> = true;

/**
 * Every string union `src/world/**` declares. `test/core/vocabulary.test.ts` walks
 * only `core/types.ts`, so none of these were ever checked against §3 — the
 * module that most loudly calls §3 a rules surface is the one the detector cannot
 * see into.
 */
const WORLD_ENUMS: readonly (readonly [string, readonly string[]])[] = [
  ['HoldingState', HOLDING_STATE],
  ['Protection', PROTECTION],
  ['Disposition', DISPOSITION],
  ['VerbClass', VERB_CLASS_MEMBERS],
  ['LaneKind', LANE_KIND],
];

/**
 * Collisions against §3, matched by **stem** rather than by exact spelling.
 *
 * Exact matching is what let this through: core's detector compares union members
 * to the Term column verbatim, so `EXPOSED` never trips against `EXPOSURE`. But §3
 * is about *concepts*, and its preamble names `exposure` as one of the eleven v2.0
 * collisions the table was written to kill — a rule that only catches the noun form
 * is a rule an inflection walks around.
 */
function worldCollisions(): string[] {
  // §3's own sanctioned dual uses, same allowance core's test makes.
  const sanctioned = new Set(['RAID', 'LEVY']);
  const terms = specTerms();
  const out: string[] = [];
  for (const [name, members] of WORLD_ENUMS) {
    for (const m of members) {
      if (sanctioned.has(m)) continue;
      for (const term of terms) {
        const shared = term.length >= 5 && m.length >= 5 && m.slice(0, 5) === term.slice(0, 5);
        if (m === term || shared) out.push(`${name}.${m} (§3 ${term})`);
      }
    }
  }
  return out.sort((a, b) => (a < b ? -1 : 1));
}

describe('DEFECT reports against src/world/** — §3 collisions', () => {
  it('the compile-time coverage proofs are live', () => {
    expect([
      _holdingStateComplete,
      _protectionComplete,
      _dispositionComplete,
      _verbClassComplete,
      _laneKindComplete,
    ]).toEqual(new Array<boolean>(5).fill(true));
  });

  it('FIXED: no world enum reuses a §3 canon term for a second concept', () => {
    // Was two live scar #1 collisions, both found by the wave-1 verifier and both
    // fixed rather than pinned:
    //
    //   HoldingState.STANDING → INTACT.  §3 gives STANDING to "the public factual
    //   vectors". Both meanings landed in the SAME observation — an agent would read
    //   `holdings[].state: "STANDING"` beside its own `standing` vectors with nothing
    //   to tell it they were unrelated. That is scar #1's exact shape, and it is
    //   worse than a docs-only collision because the value ships on the wire.
    //
    //   Protection.EXPOSED → ASSAILABLE.  §3's Never-means column for EXPOSURE reads
    //   literally "peril scope", and Protection.EXPOSED meant peril scope exactly.
    //   src/ledger already uses EXPOSURE strictly per canon, so both spellings were
    //   live in one engine.
    //
    // This assertion is the standing guard, derived from SPEC §3 itself rather than
    // from a memory of it, so a future addition cannot reintroduce the class.
    expect(worldCollisions()).toEqual([]);
  });

  it('the canon sentences this guard depends on are still in SPEC §3', () => {
    // If someone edits §3, they must do it deliberately — the guard above is only
    // meaningful while these rows exist.
    expect(SPEC).toContain('peril scope');
    expect(SPEC.includes('| **EXPOSURE** |')).toBe(true);
    expect(SPEC.includes('| **STANDING** | the public factual vectors')).toBe(true);
    expect(HOLDING_STATE).toContain('INTACT');
    expect(PROTECTION).toContain('ASSAILABLE');
    expect(PROTECTION as readonly string[]).not.toContain('EXPOSED');
  });
});

// ── 3. a test whose name overstates what it covers ──────────────────────────

describe('DEFECT(test/world/map): the all-COMMONS gate branch is unreachable and untested', () => {
  it('the plan that claims to have "no room for an inter-constellation gate" is rejected for the size bound instead', () => {
    // `map.spec.ts`:231 asserts only `.toThrow(MapError)`, so it passes on any
    // rejection. The rejection it actually gets is the §4.2 size bound — the same
    // one the test above it already covers — and `pickGate`'s "entirely COMMONS"
    // message is never produced.
    let message = '';
    try {
      generateMap('x', {
        ...LAUNCH_PLAN,
        commonsSystems: 4,
        systemsPerConstellation: { min: 4, max: 4 },
      });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/outside SPEC §4\.2's 5-8 range/);
    expect(message).not.toMatch(/entirely COMMONS/);
  });

  it('no legal plan can reach the branch at all: the civic name list caps it out first', () => {
    // Reaching `pickGate`'s throw needs commonsSystems >= the constellation size,
    // and the size floor is 5 — but only 4 civic names exist, so the name guard
    // always fires first. The branch is dead code with a test pointing at it.
    let message = '';
    try {
      generateMap('x', {
        ...LAUNCH_PLAN,
        commonsSystems: 5,
        systemsPerConstellation: { min: 5, max: 5 },
      });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/only 4 civic names exist/);
  });
});

// ── 4. the half of the arrival rule nothing asserts ─────────────────────────

function marchesTriple(map: WorldMap): [SystemId, SystemId, SystemId] {
  for (const a of map.systemOrder) {
    if (tierOf(map, a) !== 'MARCHES') continue;
    for (const b of systemOf(map, a).lanes) {
      if (tierOf(map, b) !== 'MARCHES') continue;
      for (const c of systemOf(map, b).lanes) {
        if (c !== a && tierOf(map, c) === 'MARCHES') return [a, b, c];
      }
    }
  }
  throw new Error('no adjacent MARCHES triple in the launch map');
}

describe('DEFECT(world/hands): a hand that is not PRESENT can still depart', () => {
  it('accepts a move on the arrival tick, so the ETA rule is enforced by phase order alone', () => {
    const map = launchMap();
    const state = createWorld(map);
    const [a, b, c] = marchesTriple(map);
    enroll(state, 'p-a' as PrincipalId, 'Ashford', 0, a);
    const hand = handsOf(state, 'p-a' as PrincipalId)[0]!;

    beginTransit(map, hand, b, 10);
    const eta = hand.freeAtTick!;
    resolveMovement(state, eta, () => false);
    expect(isPresent(hand, eta)).toBe(false);

    // Not present — and yet it departs, on the tick it landed.
    const again = moveHand(state, hand.id, c, eta);
    expect(again.ok).toBe(true);
    expect(hand.departedAtTick).toBe(eta);

    // The only thing standing between that and "chain a move every tick and no
    // predator can ever reach you" — the failure `hands.ts` says would delete §9 —
    // is that §15.2 puts VALIDATE+LOCK *before* MOVE, so a real tick loop never
    // validates a move after resolving that hand's arrival. `MOVE_PHASE_MUST_PRECEDE`
    // is the module's executable statement of its own ordering needs, and it
    // deliberately omits VALIDATE, so this half of the rule is asserted nowhere.
    expect(MOVE_PHASE_MUST_PRECEDE).not.toContain('VALIDATE');
    expect(MOVE_PHASE_MUST_PRECEDE).not.toContain('VALIDATE+LOCK');
  });

  it("the 1,000-tick soak runs MOVE before its own action phase, which is the opposite of §15.2's order", () => {
    // See also the phase-order note above; this pins the harness itself.
    // `test/world/harness.ts` calls `resolveMovement` at the top of each tick and
    // then applies actions, so the soak validates a machine in which a hand may be
    // commanded on the tick it arrives. The real loop cannot reach that state. The
    // determinism the soak proves is therefore the determinism of a different phase
    // order — worth knowing before it is cited as DET-1 for the tick loop.
    const harness = readFileSync(new URL('./harness.ts', import.meta.url), 'utf8');
    const movePos = harness.indexOf('resolveMovement(state, tick');
    const actionPos = harness.indexOf('const roll = rng.int(100)');
    expect(movePos).toBeGreaterThan(0);
    expect(actionPos).toBeGreaterThan(0);
    expect(movePos).toBeLessThan(actionPos);
  });
});

// ── 5. what the ASSERT set does not bound ───────────────────────────────────

describe('GAP(world/invariants): neither field the module added to Hand is bounded', () => {
  /**
   * `HandRecord` adds `ordinal`, `departedAtTick` and `presentSinceTick`, and
   * INV-8/9/10 check the two transit fields against `state`. Nothing checks that a
   * hand is *somewhere real*, and nothing bounds `presentSinceTick` — so the two
   * states below run in production forever with a green ASSERT phase.
   */
  function brokenWorld(): { violations: ReturnType<typeof checkWorldInvariants> } {
    const map = launchMap();
    const state = createWorld(map);
    enroll(state, 'p-a' as PrincipalId, 'Ashford', 0, map.systemOrder[0]);
    const [lost, stalled] = handsOf(state, 'p-a' as PrincipalId);

    // `loseHand`'s `recoverAt` is never validated against the map, so a predation
    // module that passes the wrong id — or any id — parks a hand off-map. §4.2 makes
    // place IDs permanent precisely because the ledger references them.
    loseHand(lost!, 5, Rng.fromSeed('s'), 'sys-99-nowhere' as SystemId);

    // A `presentSinceTick` that never arrives is permanent capacity loss wearing
    // time's clothes — the exact thing INV-8's "loss is time, never capacity" exists
    // to forbid, expressed in the one field INV-8 does not read.
    stalled!.presentSinceTick = 10_000;

    return { violations: checkWorldInvariants(state, 6) };
  }

  it.fails(
    'DEFECT: a hand parked at a system the map does not contain passes INV-8, INV-9 and INV-10',
    () => {
      expect(brokenWorld().violations).not.toEqual([]);
    },
  );

  it('records the gap: the broken world asserts clean, and still hashes', () => {
    const { violations } = brokenWorld();
    expect(violations).toEqual([]);
    // Both states are also invisible to the snapshot: `worldCanonical` writes
    // `location` and `presentSinceTick` straight through, so a replay reproduces the
    // broken world byte-for-byte and DET-1 reads as healthy.
    const map = launchMap();
    const state = createWorld(map);
    enroll(state, 'p-b' as PrincipalId, 'Brine', 0, map.systemOrder[0]);
    loseHand(handsOf(state, 'p-b' as PrincipalId)[0]!, 5, Rng.fromSeed('s'), 'sys-99-nowhere' as SystemId);
    expect(worldHash(state)).toMatch(/^[0-9a-f]{64}$/);
    expect(handsAt(state, 'sys-99-nowhere' as SystemId)).toHaveLength(1);
  });
});
