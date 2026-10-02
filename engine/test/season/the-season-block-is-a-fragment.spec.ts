/**
 * ★ **`header.season` IS WORLD-WIDE CONTENT, SO IT IS A FRAGMENT** (Season 1 merge).
 *
 * The scale lane's rule for an observation: world-wide content in shared fragments, serialized once a
 * read epoch, and each reader's own content in its envelope (`api/fragments.ts`). The season lane's
 * block is world-wide except for one field — a grand candidate's `your_crew_staked`, which only that
 * candidate's own parties see. So every reader party to no candidate is served the ONE public block,
 * and a party gets its own; and both are byte-identical to the reference build that shares nothing.
 * Played in a FINALE with a candidate formed, so both kinds of reader exist.
 */

import { describe, expect, it } from 'vitest';
import { buildObservation, type ObserveInput } from '../../src/api/observe.js';
import { observationBody, referenceObservationBody } from '../../src/api/fragments.js';
import type { PrincipalId } from '../../src/core/types.js';
import { finaleWorld, formCandidate, tick } from './fixture.js';

const CREW = ['p:wright', 'p:ashby', 'p:corran', 'p:dellow'] as PrincipalId[];
const BYSTANDER = 'p:bystander' as PrincipalId;

function input(runtime: ReturnType<typeof finaleWorld>['runtime'], principal: PrincipalId): ObserveInput {
  return {
    runtime,
    principal,
    serverNowMs: 1_700_000_000_000,
    fresh: true,
    wakesRemaining: 9,
    stale: false,
    corrections: [],
    correctionsDropped: 0,
    actionsRemaining: 3,
  };
}

describe('★ header.season is one shared fragment for every reader outside a crew', () => {
  it('a bystander reads the public block itself, a crew member its own, and every body equals the reference', () => {
    const w = finaleWorld('season-fragment', [...CREW, BYSTANDER]);
    const id = formCandidate(w, { creator: CREW[0] as PrincipalId, crew: CREW });
    tick(w.runtime);
    const rt = w.runtime;
    expect(rt.ventures.require(id).state, 'non-vacuity: a LIVE candidate, so a crew exists').toBe('LIVE');

    const now = rt.engine.tick;
    const shared = rt.seasonBlock(now, null);
    const seenBy = (p: PrincipalId): unknown => buildObservation(input(rt, p)).header.season;
    expect(seenBy(BYSTANDER), 'the bystander is served the public block, the same object').toBe(shared);
    expect(rt.isSharedView(shared), 'and it is a registered shared view — a fragment').toBe(true);
    const crewBlock = seenBy(CREW[1] as PrincipalId) as { grand: { candidates: { your_crew_staked?: number }[] } };
    expect(crewBlock, 'a crew member gets its own block').not.toBe(shared);
    expect(crewBlock.grand.candidates.some((c) => c.your_crew_staked !== undefined), 'with its own stake on it').toBe(true);

    for (const p of [...CREW, BYSTANDER]) {
      expect(observationBody(input(rt, p)), `${p}: spliced bytes equal the reference build`).toBe(
        referenceObservationBody(input(rt, p)),
      );
    }
  });
});
