/**
 * `E2E-21` — the Commons floor: **hostile action is invalid, not merely
 * punished.** "Fuzz every verb x every hostile parameterisation against a Commons
 * target and assert `{ok:false}` with a hint every time, never a punished
 * success."
 *
 * Two things this file asserts that a hand-written case list would not:
 *
 *   1. **Classification is total against the spec.** The verb list is parsed out
 *      of SPEC §12.2 rather than copied, so adding a verb to the canon without
 *      classifying it here fails the build. The engine and the canon disagreeing
 *      about the vocabulary is scar #1, and §3 is a rules surface.
 *   2. **Rejection has no side effects.** "Invalid, not punished" means the world
 *      is byte-identical afterwards, so the state hash is compared across every
 *      rejected attempt.
 */

import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { PrincipalId, SystemId } from '../../src/core/types.js';
import {
  ARRIVAL_IS_PRESENT_SAME_TICK,
  assertVerbsClassified,
  beginTransit,
  classifyAction,
  commonsFloorRejection,
  commonsSystems,
  createWorld,
  DEFENDER_SIDE,
  enroll,
  handsOf,
  holdingOf,
  laneIsProtected,
  launchMap,
  protectionOf,
  SEIZURE_BALLOT,
  systemOf,
  TARGET_KEYS,
  targetsOf,
  tierOf,
  VERB_CLASS,
  worldHash,
  type ActionParams,
  type WorldMap,
  type WorldState,
} from '../../src/world/index.js';

// ── the verb list, read from the canon ──────────────────────────────────────

/**
 * Parses SPEC §12.2's act block the same way `scripts/budget-audit.mjs` does: a
 * group label, then verbs separated by `·`, with an optional trailing prose
 * clause after an em dash.
 */
function specVerbs(): string[] {
  const spec = readFileSync(new URL('../../../docs/design/SPEC.md', import.meta.url), 'utf8');
  const block = /### 12\.2 act\n\n```text\n([\s\S]*?)```/.exec(spec);
  if (block === null) throw new Error('could not find SPEC §12.2 act block');
  const body = block[1] ?? '';
  const verbs: string[] = [];
  for (const line of body.split('\n')) {
    if (!line.trim() || line.startsWith(' ')) continue;
    const rest = line.slice(line.indexOf(' ')).trim();
    const head = rest.split('—')[0] ?? '';
    verbs.push(...head.split('·').map((v) => v.trim()).filter(Boolean));
  }
  return verbs;
}

const VERBS = specVerbs();

// ── fixture ─────────────────────────────────────────────────────────────────

const VICTIM = 'p-victim' as PrincipalId;
const RAIDER = 'p-raider' as PrincipalId;

interface Fixture {
  readonly state: WorldState;
  readonly map: WorldMap;
  readonly commons: SystemId;
  readonly marches: SystemId;
}

function fixture(): Fixture {
  const map = launchMap();
  const state = createWorld(map);
  const commons = commonsSystems(map)[0]!;
  const marches = map.systemOrder.find((id) => tierOf(map, id) === 'MARCHES')!;
  enroll(state, VICTIM, 'Vaunt', 0, commons);
  enroll(state, RAIDER, 'Rook', 0, marches);
  return { state, map, commons, marches };
}

/** Every way of naming a target that sits in the Commons. */
function commonsTargets(f: Fixture): ActionParams[] {
  const hand = handsOf(f.state, VICTIM)[0]!;
  const holding = holdingOf(f.state, VICTIM);
  const shapes: ActionParams[] = [];
  for (const key of TARGET_KEYS.system) shapes.push({ [key]: f.commons });
  for (const key of TARGET_KEYS.hand) shapes.push({ [key]: hand.id });
  for (const key of TARGET_KEYS.holding) shapes.push({ [key]: holding.id });
  for (const key of TARGET_KEYS.principal) shapes.push({ [key]: VICTIM });
  for (const key of TARGET_KEYS.ambiguous) {
    shapes.push({ [key]: hand.id }, { [key]: holding.id }, { [key]: VICTIM }, { [key]: f.commons });
  }
  return shapes;
}

/** Parameter shapes that make a contextual verb hostile. */
const HOSTILE_MODIFIERS: ActionParams[] = [
  {},
  { kind: 'RAID' },
  { kind: 'SIEGE' },
  { kind: 'raid' },
  { kind: 'SiEgE' },
  { ballot: SEIZURE_BALLOT },
  { ballot: 'seizure' },
  { side: 'RAIDER' },
  { side: 'defender' },
  { verb: 'demand' },
  // The self-referential payload: `approve` an `approve`. Without a depth bound
  // this recurses until the stack dies, which is a one-request denial of service.
  { verb: 'approve' },
];

function merge(a: ActionParams, b: ActionParams): ActionParams {
  return { ...a, ...b };
}

describe('the verb classification is total against SPEC §12.2', () => {
  it('classifies every verb the canon declares, and declares no verb the canon lacks', () => {
    expect(VERBS.length).toBe(38);
    expect(() => assertVerbsClassified(VERBS)).not.toThrow();
    expect(Object.keys(VERB_CLASS)).toHaveLength(VERBS.length);
  });

  it('fires when a verb is added to the canon without being classified', () => {
    expect(() => assertVerbsClassified([...VERBS, 'immolate'])).toThrow(/does not classify/);
  });

  it('treats an unknown verb as hostile, so a new verb cannot open a hole in the floor', () => {
    expect(classifyAction('immolate')).toBe('HOSTILE');
    expect(classifyAction('')).toBe('HOSTILE');
  });

  it('names exactly the verbs that can ever be hostile', () => {
    const hostile = new Set<string>();
    for (const verb of VERBS) {
      for (const modifier of HOSTILE_MODIFIERS) {
        if (classifyAction(verb, modifier) === 'HOSTILE') hostile.add(verb);
      }
    }
    // Written out so a reclassification is a visible, reviewable change rather
    // than a silent widening or narrowing of the safe floor.
    expect([...hostile].sort((a, b) => (a < b ? -1 : 1))).toEqual([
      'approve',
      'create',
      'demand',
      'fight',
      'fill_role',
      'join',
      'sign',
      'vote',
    ]);
  });
});

describe('E2E-21 — every verb x every hostile parameterisation against a Commons target', () => {
  it('is invalid, with a hint, and changes nothing', () => {
    const f = fixture();
    const before = worldHash(f.state);
    let hostileAttempts = 0;

    for (const verb of [...VERBS, 'immolate', 'raid_the_commons']) {
      for (const modifier of HOSTILE_MODIFIERS) {
        for (const target of commonsTargets(f)) {
          const params = merge(target, modifier);
          const rejection = commonsFloorRejection(f.state, verb, params);
          if (classifyAction(verb, params) === 'PEACEFUL') {
            // A peaceful verb aimed at the Commons is simply legal; the floor has
            // nothing to say about a haul into a safe system.
            expect(rejection).toBeNull();
            continue;
          }
          hostileAttempts += 1;
          expect(rejection).not.toBeNull();
          expect(rejection?.ok).toBe(false);
          expect(rejection?.invariant).toBe('A8');
          expect((rejection?.hint ?? '').length).toBeGreaterThan(20);
        }
      }
    }

    expect(hostileAttempts).toBeGreaterThan(500);
    // "Invalid, not merely punished": nothing happened.
    expect(worldHash(f.state)).toBe(before);
  });

  it('tells the agent the target can never be made legal, not that it costs more', () => {
    const f = fixture();
    const rejection = commonsFloorRejection(f.state, 'demand', { target: VICTIM });
    expect(rejection?.hint).toMatch(/invalid rather than punished/);
    expect(rejection?.hint).toMatch(/nothing you do will make this one legal/);
    // And it names where to go instead — an agent that gets a hint corrects itself.
    expect(rejection?.hint).toMatch(/Marches and the Frontier/);
  });

  it('permits the same act against a target outside the Commons', () => {
    const f = fixture();
    const raiderHand = handsOf(f.state, RAIDER)[0]!;
    expect(commonsFloorRejection(f.state, 'demand', { hand_id: raiderHand.id })).toBeNull();
    expect(commonsFloorRejection(f.state, 'create', { kind: 'RAID', system: f.marches })).toBeNull();
    expect(
      commonsFloorRejection(f.state, 'vote', { ballot: SEIZURE_BALLOT, principal: RAIDER }),
    ).toBeNull();
  });

  it('lets the Levy and syndicate ballots name a principal in the Commons — the Levy applies there', () => {
    const f = fixture();
    expect(commonsFloorRejection(f.state, 'vote', { ballot: 'LEVY', principal: VICTIM })).toBeNull();
    expect(
      commonsFloorRejection(f.state, 'vote', { ballot: 'SYNDICATE', principal: VICTIM }),
    ).toBeNull();
    expect(commonsFloorRejection(f.state, 'deliver', { to: f.commons })).toBeNull();
  });

  it('lets a defender join a standoff, and refuses everyone else', () => {
    const f = fixture();
    expect(classifyAction('join', { side: DEFENDER_SIDE })).toBe('PEACEFUL');
    expect(commonsFloorRejection(f.state, 'join', { side: DEFENDER_SIDE, principal: VICTIM })).toBeNull();
    expect(commonsFloorRejection(f.state, 'join', { side: 'RAIDER', principal: VICTIM })).not.toBeNull();
    expect(commonsFloorRejection(f.state, 'join', { principal: VICTIM })).not.toBeNull();
  });

  it('is not fooled by casing on a venture kind or a ballot', () => {
    const f = fixture();
    for (const kind of ['raid', 'Raid', 'rAiD', 'SIEGE', 'siege']) {
      expect(commonsFloorRejection(f.state, 'create', { kind, system: f.commons })).not.toBeNull();
    }
    for (const ballot of ['seizure', 'Seizure', 'SEIZURE']) {
      expect(commonsFloorRejection(f.state, 'vote', { ballot, principal: VICTIM })).not.toBeNull();
    }
  });

  it('terminates on a self-referential approval instead of recursing to death', () => {
    const f = fixture();
    // DET-9's rule applied to validation: fixed rounds, never a loop to
    // convergence. An agent can send this in one request.
    expect(classifyAction('approve', { verb: 'approve' })).toBe('PEACEFUL');
    expect(classifyAction('approve', { act: 'approve', verb: 'approve' })).toBe('PEACEFUL');
    expect(commonsFloorRejection(f.state, 'approve', { verb: 'approve', principal: VICTIM })).toBeNull();
    // And an approval that names a real attack is still caught.
    expect(
      commonsFloorRejection(f.state, 'approve', { verb: 'demand', principal: VICTIM }),
    ).not.toBeNull();
  });

  it('demands an exact spelling before granting safety, and folds case to find hostility', () => {
    const f = fixture();
    // Folding widens what counts as an attack, which is safe.
    expect(classifyAction('create', { kind: 'raid' })).toBe('HOSTILE');
    expect(classifyAction('vote', { ballot: 'seizure' })).toBe('HOSTILE');
    // Folding the peaceful side would let a spelling this module accepts but the
    // ventures or ballot module reads differently slip past the floor.
    expect(classifyAction('create', { kind: 'haul' })).toBe('HOSTILE');
    expect(classifyAction('create', { kind: 'HAUL' })).toBe('PEACEFUL');
    expect(classifyAction('vote', { ballot: 'levy' })).toBe('HOSTILE');
    expect(classifyAction('vote', { ballot: 'LEVY' })).toBe('PEACEFUL');
    expect(classifyAction('join', { side: 'defender' })).toBe('HOSTILE');
    expect(commonsFloorRejection(f.state, 'create', { kind: 'haul', system: f.commons })).not.toBeNull();
  });

  it('fails closed on an unrecognised venture kind at creation', () => {
    const f = fixture();
    // A typo must not be a way past the floor. The cost of being wrong here is one
    // rejected action and a hint; the cost of being wrong the other way is A8.
    expect(commonsFloorRejection(f.state, 'create', { kind: 'RAIDD', system: f.commons })).not.toBeNull();
    expect(commonsFloorRejection(f.state, 'create', { kind: 'HAUL', system: f.commons })).toBeNull();
  });

  it('fails closed when a hostile act names no target, or one the world cannot find', () => {
    const f = fixture();
    expect(commonsFloorRejection(f.state, 'demand', {})?.hint).toMatch(/must name the hand/);
    expect(commonsFloorRejection(f.state, 'demand', { hand_id: 'p-ghost:h1' })?.hint).toMatch(
      /cannot locate/,
    );
  });

  it('never throws, whatever an agent sends', () => {
    const f = fixture();
    fc.assert(
      fc.property(
        fc.string({ maxLength: 24 }),
        fc.dictionary(fc.string({ maxLength: 12 }), fc.oneof(fc.string(), fc.integer(), fc.boolean())),
        (verb, params) => {
          // Malformed input is the first thing an external agent sends (scar #11):
          // it must produce a rejection, never a 500.
          const rejection = commonsFloorRejection(f.state, verb, params);
          if (rejection !== null) {
            expect(rejection.ok).toBe(false);
            expect(rejection.hint.length).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('what counts as being in the Commons', () => {
  it('protects a lane only when both ends are Commons', () => {
    const f = fixture();
    const commonsNeighbour = systemOf(f.map, f.commons).lanes.find(
      (id) => tierOf(f.map, id) === 'COMMONS',
    );
    const outward = systemOf(f.map, f.commons).lanes.find((id) => tierOf(f.map, id) !== 'COMMONS');
    if (commonsNeighbour !== undefined) {
      expect(laneIsProtected(f.state, f.commons, commonsNeighbour)).toBe(true);
    }
    if (outward !== undefined) {
      expect(laneIsProtected(f.state, f.commons, outward)).toBe(false);
    }
  });

  it('protects a hand travelling inside the Commons, and exposes one on the way out', () => {
    const f = fixture();
    const hand = handsOf(f.state, VICTIM)[0]!;
    const inward = systemOf(f.map, f.commons).lanes.find((id) => tierOf(f.map, id) === 'COMMONS');
    if (inward !== undefined) {
      beginTransit(f.map, hand, inward, 1);
      expect(protectionOf(f.state, { kind: 'HAND', id: hand.id })).toBe('PROTECTED');
      expect(commonsFloorRejection(f.state, 'demand', { hand_id: hand.id })).not.toBeNull();
    }

    const raiderHand = handsOf(f.state, RAIDER)[0]!;
    const away = systemOf(f.map, f.marches).lanes[0]!;
    beginTransit(f.map, raiderHand, away, 1);
    expect(protectionOf(f.state, { kind: 'HAND', id: raiderHand.id })).toBe('ASSAILABLE');
  });

  it('resolves an ambiguous target by looking it up, and reports what it cannot place', () => {
    const f = fixture();
    const hand = handsOf(f.state, VICTIM)[0]!;
    expect(targetsOf(f.state, { target: hand.id })[0]?.kind).toBe('HAND');
    expect(targetsOf(f.state, { target: VICTIM })[0]?.kind).toBe('PRINCIPAL');
    expect(targetsOf(f.state, { target: f.commons })[0]?.kind).toBe('SYSTEM');
    expect(targetsOf(f.state, { target: 'nothing-like-this' })[0]?.kind).toBe('UNRESOLVED');
    expect(protectionOf(f.state, { kind: 'UNRESOLVED', id: 'x' })).toBe('UNKNOWN');
  });

  it('does not protect a hand merely because it arrived this tick', () => {
    // The arrival decision is about what a hand can *do*, never about what can be
    // done to it — otherwise chaining moves would make interception impossible and
    // §9 would quietly die.
    expect(ARRIVAL_IS_PRESENT_SAME_TICK).toBe(false);
    const f = fixture();
    const raiderHand = handsOf(f.state, RAIDER)[0]!;
    expect(commonsFloorRejection(f.state, 'demand', { hand_id: raiderHand.id })).toBeNull();
  });
});
