/**
 * Builders for the events suite.
 *
 * Deliberately thin: these construct `NewEvent` inputs and nothing else. A
 * helper that also decided who may read something would be a second
 * implementation of the ladder, and the tests would then be checking the helper
 * against itself.
 */

import type { PrincipalId } from '../../src/core/types.js';
import type { AudienceAdmission, NewEvent } from '../../src/events/index.js';

export function pid(name: string): PrincipalId {
  return name as PrincipalId;
}

interface Common {
  readonly tick: number;
  readonly kind?: string;
  readonly actor?: PrincipalId | null;
  readonly family?: string;
  readonly payload?: Readonly<Record<string, unknown>>;
}

function base(c: Common): Omit<NewEvent, 'visibility' | 'audience' | 'isPublic' | 'publicAt' | 'declassifyAt'> {
  return {
    tick: c.tick,
    kind: c.kind ?? 'TEST',
    rulesVersion: 1,
    actorPrincipalId: c.actor === undefined ? pid('actor') : c.actor,
    onBehalfOfPrincipalId: null,
    grantId: null,
    eventFamilyId: c.family ?? 'fam',
    parentEventId: null,
    provenanceClass: 'FACT',
    actedOnStateVersion: null,
    decisionSource: 'LIVE',
    payload: c.payload ?? { note: 'x' },
  };
}

/** Movement on a public lane: the map's motion, visible to anyone. */
export function publicEvent(c: Common): NewEvent {
  return {
    ...base(c),
    visibility: 'PUBLIC',
    isPublic: true,
    publicAt: c.tick,
    declassifyAt: c.tick,
    audience: [],
  };
}

/** A hosted negotiation message: the parties now, everyone at settlement. */
export function partiesEvent(c: Common & { readonly parties: readonly PrincipalId[]; readonly settlesAtTick: number }): NewEvent {
  return {
    ...base(c),
    visibility: 'PARTIES',
    isPublic: false,
    publicAt: c.settlesAtTick,
    declassifyAt: c.settlesAtTick,
    audience: c.parties.map((p): AudienceAdmission => ({ principal: p, basis: 'PARTY' })),
  };
}

/** Cargo contents: whoever has a hand in range or bought the intel. */
export function sensedEvent(
  c: Common & { readonly inRange: readonly PrincipalId[]; readonly declassifyAtTick: number },
): NewEvent {
  return {
    ...base(c),
    visibility: 'SENSED',
    isPublic: false,
    publicAt: c.declassifyAtTick,
    declassifyAt: c.declassifyAtTick,
    audience: c.inRange.map((p): AudienceAdmission => ({ principal: p, basis: 'IN_RANGE' })),
  };
}

/**
 * A seal. The intent is the thing that must never reach a live feed; `sealId`
 * and `reckoningIndex` are the flag.
 */
export function sealedEvent(
  c: Common & { readonly revealsAtTick: number; readonly intent: Readonly<Record<string, unknown>> },
): NewEvent {
  return {
    ...base({
      ...c,
      payload: { sealId: 'seal-1', reckoningIndex: 3, intent: c.intent },
    }),
    visibility: 'SEALED',
    isPublic: false,
    publicAt: null,
    declassifyAt: c.revealsAtTick,
    audience: [],
    flagKeys: ['sealId', 'reckoningIndex'],
  };
}

/**
 * A principal's own reasoning. Never anyone else, ever — including its OWNER,
 * which is why the field here is `principal`: §3 reserves OWNER for the human.
 */
export function privateEvent(c: Common & { readonly principal: PrincipalId }): NewEvent {
  return {
    ...base({ ...c, actor: c.principal }),
    visibility: 'PRIVATE',
    isPublic: false,
    publicAt: null,
    declassifyAt: null,
    audience: [{ principal: c.principal, basis: 'SELF' }],
  };
}
