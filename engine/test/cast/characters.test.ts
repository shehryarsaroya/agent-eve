/**
 * The cast are characters, and the same seed produces the same cast.
 *
 * Two claims, and they pull in opposite directions on purpose:
 *
 *   - A **fixed** table, so `kestrel` is the patient raider in every world. That is what
 *     makes it a character a viewer can follow rather than a roll.
 *   - A **seeded** stance, so two seeds are not the same show and a balance sweep that
 *     changes the seed genuinely re-rolls the cast's edges.
 *
 * The third claim is the vocabulary one, and it is a rules-surface test rather than a
 * style test (HARD RULE 4): the word *disposition* is already `PEACEFUL | HOSTILE` in
 * `src/world/commons.ts`, so it may not name a character trait as well.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { setSpeed } from '../../src/core/time.js';
import {
  CAST_NAMES,
  CAST_ROLES,
  CAST_STANCES,
  charactersFor,
  HeuristicCast,
  MAX_CAST,
  roleForName,
  STANCE_CREED,
} from '../../src/cast/index.js';
import { Runtime } from '../../src/sim/runtime.js';

function roster(seed: string, size = MAX_CAST): ReturnType<HeuristicCast['seat']> {
  setSpeed('instant');
  const runtime = new Runtime({ seed });
  const cast = new HeuristicCast(runtime, { size });
  return cast.seat(seed);
}

describe('the character table', () => {
  it('has exactly one row per name, and every row matches its seat’s role', () => {
    const members = roster('table');
    const characters = charactersFor(members, 'table');
    expect(characters.size).toBe(members.length);
    for (const member of members) {
      const character = characters.get(member.handle);
      expect(character).toBeDefined();
      // The role is derived from `heuristic.ts`'s own cycle, never restated. A raider
      // handed a hauler's creed would spend every wake wanting what its seat forbids.
      expect(character?.role).toBe(member.role);
      expect(character?.role).toBe(roleForName(member.handle));
      expect(character?.role).toBe(CAST_ROLES[CAST_NAMES.indexOf(member.handle) % CAST_ROLES.length]);
    }
  });

  it('gives every member a distinct title and a non-trivial creed', () => {
    const characters = [...charactersFor(roster('distinct'), 'distinct').values()];
    expect(characters.length).toBe(MAX_CAST);
    expect(new Set(characters.map((c) => c.title)).size).toBe(characters.length);
    expect(new Set(characters.map((c) => c.creed)).size).toBe(characters.length);
    for (const character of characters) {
      // Long enough to be a character and short enough to pay for on every wake.
      expect(character.creed.length).toBeGreaterThan(80);
      expect(character.creed.length).toBeLessThan(400);
      expect(character.title.length).toBeGreaterThan(3);
    }
  });

  it('every stance has a creed of its own', () => {
    for (const stance of CAST_STANCES) {
      expect(STANCE_CREED[stance].length).toBeGreaterThan(40);
    }
    expect(new Set(Object.values(STANCE_CREED)).size).toBe(CAST_STANCES.length);
  });
});

describe('stances are deterministic from the seed', () => {
  it('the same seed produces the same stance for every member, twice', () => {
    const a = charactersFor(roster('stance-det'), 'stance-det');
    const b = charactersFor(roster('stance-det'), 'stance-det');
    expect(a.size).toBe(b.size);
    for (const [handle, character] of a) {
      expect(b.get(handle)?.stance).toBe(character.stance);
    }
  });

  it('a different seed moves at least one stance', () => {
    // The other half of determinism and the one people forget: a seeded draw whose seed
    // does nothing is deterministic and useless.
    const a = charactersFor(roster('seed-a'), 'seed-a');
    const b = charactersFor(roster('seed-b'), 'seed-b');
    const moved = [...a].filter(([handle, c]) => b.get(handle)?.stance !== c.stance);
    expect(moved.length).toBeGreaterThan(0);
  });

  it('each member draws from its own sub-stream, so adding a name moves nobody', () => {
    // The rule `heuristic.ts` states for its own draws. If stances came from one shared
    // shuffle, seating a thirteenth member would re-deal the first twelve — and every
    // golden file would move for a reason that reads like a balance regression.
    const small = charactersFor(roster('substream', 4), 'substream');
    const large = charactersFor(roster('substream', MAX_CAST), 'substream');
    for (const [handle, character] of small) {
      expect(large.get(handle)?.stance).toBe(character.stance);
    }
  });

  it('uses only stances from the published set', () => {
    for (const character of charactersFor(roster('set'), 'set').values()) {
      expect(CAST_STANCES).toContain(character.stance);
    }
  });
});

describe('the vocabulary canon holds (HARD RULE 4)', () => {
  it('does not name a character trait "disposition" — that word is already taken', () => {
    // `src/world/commons.ts` exports `Disposition = 'PEACEFUL' | 'HOSTILE'`, the Commons
    // floor's classification of an act. One word, one concept, everywhere — including in
    // field names, which is where the drift actually happens.
    const source = readFileSync(new URL('../../src/cast/characters.ts', import.meta.url), 'utf8');
    const code = source
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('*') && !line.trimStart().startsWith('/*'))
      .join('\n');
    expect(/disposition/i.test(code)).toBe(false);
  });
});
