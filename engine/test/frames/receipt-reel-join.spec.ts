/**
 * ★ THE RECEIPT REEL, ASSEMBLED — §14's five artifacts on one strip, from one published frame.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * §14: *"the grant, the accepted warning, the seal, the deed and the negotiation text on one strip."*
 * `test/frames/receipt-reel.spec.ts` proves the **negotiation** reaches the segment. This file proves
 * the **join** — the part that did not exist.
 *
 * Measured before this landed: `grep GrantId src/frames/contract.ts` → **zero hits**. `AuthorityLine`
 * was keyed `(grantor, delegate)` and `RundownSegment` named a venture, so a renderer holding a
 * `SNAPPED_BLACK` segment had **no key** on which to find the authority that permitted the deed. Two
 * agents may hold several grants at once and may hold none by the time a default settles, so the pair
 * is neither unique nor sufficient. §14's strip could not be assembled from a published artifact at
 * all — which by A13 means the signature artifact of this whole design does not exist.
 *
 * The other half is subtler and is why the fix is not one field: a grant lives 592–1,959 ticks and the
 * deed it authorised settles at a Reckoning, so **38 of the 41 grants ever drawn on in seed `g01` had
 * expired before any frame was written**. Publishing the id without retaining the line it points at
 * would have produced a *dangling pointer* — a strip that still cannot be assembled, now with a
 * plausible-looking key on it. Both halves are asserted here.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { TICKS_PER_RECKONING, setSpeed } from '../../src/core/time.js';
import { Runtime } from '../../src/sim/runtime.js';
import { commonsSystems } from '../../src/world/index.js';
import { FrameBudgetError, assertFrameBudgets, type ReckoningFrame } from '../../src/frames/contract.js';
import type { GrantId, PrincipalId, SystemId, VentureId } from '../../src/core/types.js';

const SETTLE_TICK = TICKS_PER_RECKONING - 1;

interface World {
  readonly rt: Runtime;
  readonly grantor: PrincipalId;
  readonly delegate: PrincipalId;
  readonly fillers: readonly PrincipalId[];
  readonly stage: SystemId;
}

/** The same shape `test/grant/delegated-attribution.spec.ts` drives, because it is the shape A6 is. */
function world(seed: string): World {
  setSpeed('instant');
  const rt = new Runtime({ seed });
  const stage = commonsSystems(rt.world.map)[0];
  if (stage === undefined) throw new Error('the launch map has no Commons system');
  const grantor = 'p:rr-grantor' as PrincipalId;
  const delegate = 'p:rr-delegate' as PrincipalId;
  const fillers = ['p:rr-f1', 'p:rr-f2', 'p:rr-f3', 'p:rr-f4'] as PrincipalId[];
  for (const [i, p] of [grantor, delegate, ...fillers].entries()) {
    rt.seat(p, `rr${String(i)}`, stage);
    rt.standing.open(p);
  }
  return { rt, grantor, delegate, fillers, stage };
}

function submit(w: World, principal: PrincipalId, verb: string, params: Readonly<Record<string, unknown>>, seq = 0): void {
  const out = w.rt.engine.submit({ principal, verb, params, clientSequence: seq, arrivalMs: seq, decisionSource: 'LIVE' });
  if (!out.ok) throw new Error(`submit ${verb}: ${out.invariant} ${out.hint}`);
}

function runTick(w: World): void {
  const r = w.rt.runTick();
  if (r.halted) throw new Error(`halted at ${String(r.tick)}: ${r.violations.map((v) => `${v.id} ${v.message}`).join(' | ')}`);
}

function act(w: World, principal: PrincipalId, verb: string, params: Readonly<Record<string, unknown>>): void {
  submit(w, principal, verb, params);
  runTick(w);
  const correction = w.rt.takeCorrections(principal)[0];
  if (correction !== undefined) throw new Error(`${verb} was corrected: ${JSON.stringify(correction)}`);
}

function idleHand(w: World, p: PrincipalId): string {
  const hand = [...w.rt.world.hands.values()].find((h) => h.principal === p && h.state === 'IDLE');
  if (hand === undefined) throw new Error(`${p} has no idle hand`);
  return hand.id;
}

/**
 * Grant, delegated-create, fill, sign, and run to settlement with nobody electing anything.
 *
 * `expires_tick` is set to land **before** the settlement on purpose in the second test: that is the
 * case that matters, and it is the case the frame could not show.
 */
function betray(seed: string, expiresBeforeSettlement: boolean): { w: World; grant: GrantId; venture: VentureId } {
  const w = world(seed);
  const before = new Set(w.rt.grants.forGrantor(w.grantor).map((g) => g.id));
  act(w, w.grantor, 'grant', {
    delegate: w.delegate,
    template: 'steward',
    max_direct_loss: 5_000_000,
    max_contingent_liability: 5_000_000,
    // The two cases this file separates. A grant that outlives its deed was always renderable; one
    // that does not is 38 of 41 in the measured world.
    expires_tick: expiresBeforeSettlement ? 40 : SETTLE_TICK + 20,
  });
  const grant = w.rt.grants.forGrantor(w.grantor).find((g) => !before.has(g.id))?.id;
  if (grant === undefined) throw new Error('the grant did not land');

  act(w, w.delegate, 'create', { on_behalf_of: w.grantor, stage: w.stage, kind: 'HAUL', value: 8_000 });
  const v = w.rt.ventures.forPrincipal(w.grantor)[0];
  if (v === undefined) throw new Error('the delegated create did not land');
  // NON-VACUITY: without these two the whole file is about an ordinary venture and proves nothing
  // about A6 at all.
  expect(v.actedBy, 'the delegate must be recorded as the actor').toBe(w.delegate);
  expect(v.boundByGrant, 'the venture must be bound by the grant').toBe(grant);

  const others = w.fillers.slice(0, v.roles.length);
  for (const [i, filler] of others.entries()) {
    submit(w, filler, 'fill_role', { venture: v.id, role: i, hand: idleHand(w, filler) }, i);
  }
  runTick(w);
  const hash = w.rt.ventures.require(v.id).termsHash;
  if (hash === null) throw new Error('no terms_hash');
  // The creator does NOT sign: the grant stood in for its countersignature (`GRANT_IS_CONSENT`).
  for (const [i, p] of others.entries()) submit(w, p, 'sign', { venture: v.id, terms_hash: hash }, i);
  runTick(w);
  runTick(w);
  expect(w.rt.ventures.require(v.id).state).toBe('LIVE');
  while (w.rt.engine.tick <= SETTLE_TICK) runTick(w);
  return { w, grant, venture: v.id };
}

function segmentFor(frame: ReckoningFrame, venture: VentureId): ReckoningFrame['rundown'][number] {
  const seg = frame.rundown.find((s) => String(s.venture) === String(venture));
  if (seg === undefined) {
    throw new Error(
      `the venture is not on the published rundown; segments: ${frame.rundown.map((s) => s.subject).join(', ')}`,
    );
  }
  return seg;
}

describe('★ §14 — the grant sits beside the deed on ONE published frame', () => {
  it('a delegated default publishes the grant id, the actor, and an authority line that resolves it', () => {
    const { w, grant, venture } = betray('rr-live', false);
    const frame = w.rt.reckoningFrame();
    expect(frame, 'a Reckoning must have settled').not.toBeNull();
    if (frame === null) return;

    const seg = segmentFor(frame, venture);
    // ── ARTIFACT 4: THE DEED, and the two names the record used to get wrong ──
    expect(seg.glyph?.state, 'the promise must have broken, or there is no reel to assemble').toBe('SNAPPED_BLACK');
    expect(seg.actedBy, 'the delegate that actually acted').toBe(w.delegate);
    expect(seg.onBehalfOf, 'the principal whose money was riding on it').toBe(w.grantor);

    // ── ★ ARTIFACT 1: THE GRANT, as a KEY rather than as prose ────────────────
    expect(seg.grant, 'the segment must name the grant that authorised the deed').toBe(grant);

    // ── ★ THE JOIN. This is the assertion the whole file exists for ───────────
    const line = frame.authorityLines.find((l) => l.grant === seg.grant);
    expect(
      line,
      `no authority line on this frame carries grant ${String(seg.grant)}; the strip cannot be ` +
        `assembled. Lines present: ${frame.authorityLines.map((l) => String(l.grant)).join(', ')}`,
    ).toBeDefined();
    expect(line?.grantor).toBe(w.grantor);
    expect(line?.delegate).toBe(w.delegate);

    // ── ARTIFACT 2: THE ACCEPTED WARNING — the LIMITS shown before signing ────
    expect(line?.granted, 'max_direct_loss, which is the worst case the grantor was shown').toBe(5_000_000);
    expect(line?.grantedContingent, 'max_contingent_liability, the other half').toBe(5_000_000);
    // And the draw the delegate actually made in its grantor's name, which is what makes the warning
    // a story rather than a number: `boundVentures` counts the compacts the grantor never signed.
    expect(line?.boundVentures, 'the count of compacts bound in the grantor\'s name').toBeGreaterThan(0);
    expect((line?.spent ?? 0) + (line?.spentContingent ?? 0), 'a delegated create draws on the LIMITS').toBeGreaterThan(0);

    // ── ARTIFACT 3: THE SEAL — the verdict only, never the content (§11.2) ────
    // Null here because nobody sealed; the FIELD is what the strip joins on, and `assertFrameBudgets`
    // refuses seal content on a nightly frame outright.
    expect('sealVerdict' in seg).toBe(true);

    // ── ★ AND THE LINK, so the strip has geometry (A13's second and third) ────
    const snapped = frame.compactLinks.find((l) => String(l.venture) === String(venture));
    expect(snapped, 'a defaulted compact must draw a SNAPPED link').toBeDefined();
    expect(snapped?.snapped).toBe(true);
    expect(snapped?.grant, 'and the link carries the same key, so the geometry joins too').toBe(grant);
  }, 300_000);

  it('★ assembles even when the GRANT EXPIRED before the deed settled — 38 of 41 in the measured world', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // MUTATION: change `if (expired && !retain.has(g.id)) continue;` in `frames/authority.ts` back to
    // `if (expired) continue;`. RED here — and `assertFrameBudgets` then refuses the frame outright,
    // because the referential-integrity check catches the dangling pointer this would create.
    // ══════════════════════════════════════════════════════════════════════════
    const { w, grant, venture } = betray('rr-expired', true);
    const frame = w.rt.reckoningFrame();
    if (frame === null) throw new Error('no frame');

    // NON-VACUITY: the grant really has to be dead, or this test is the previous one again.
    const row = w.rt.grants.all().find((g) => g.id === grant);
    expect(row?.expiresTick ?? Number.MAX_SAFE_INTEGER, 'the grant must have expired before settlement').toBeLessThan(
      frame.tick,
    );
    expect(w.rt.grants.isLive(grant, frame.tick), 'and the book must agree it is not live').toBe(false);

    const seg = segmentFor(frame, venture);
    expect(seg.grant).toBe(grant);
    const line = frame.authorityLines.find((l) => l.grant === grant);
    expect(
      line,
      'the grant expired before the deed settled and the frame dropped it, so §14\'s strip points at ' +
        'nothing. This is the case the nightly frame could never show',
    ).toBeDefined();
    // ★ `EXPIRED`, not `UNUSED`: it holds no standing power, and a line that said UNUSED would draw a
    // fence around authority that no longer exists AND deny the draw the journal records.
    expect(line?.state).toBe('EXPIRED');
    expect(line?.granted, 'the accepted warning survives the expiry, because the record does').toBe(5_000_000);
  }, 300_000);

  it('refuses a frame whose segment names a grant no line resolves', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // MUTATION: delete the referential-integrity block from `assertFrameBudgets`. RED.
    //
    // Built by taking a REAL frame and deleting the line the segment points at, so this is the exact
    // shape the bug produced rather than a hand-rolled fixture. A published pointer into nothing is a
    // strip a renderer cannot assemble, and it would look like a renderer bug forever.
    // ══════════════════════════════════════════════════════════════════════════
    const { w, venture } = betray('rr-refuse', false);
    const frame = w.rt.reckoningFrame();
    if (frame === null) throw new Error('no frame');
    const seg = segmentFor(frame, venture);
    expect(seg.grant, 'non-vacuity: the segment must name a grant for the guard to have a subject').not.toBeNull();

    // The healthy frame passes. If it did not, the assertion below would prove nothing.
    expect(() => {
      assertFrameBudgets(frame);
    }).not.toThrow();

    const broken: ReckoningFrame = { ...frame, authorityLines: frame.authorityLines.filter((l) => l.grant !== seg.grant) };
    expect(broken.authorityLines.length, 'the mutation must actually remove a line').toBeLessThan(
      frame.authorityLines.length,
    );
    expect(() => {
      assertFrameBudgets(broken);
    }).toThrow(FrameBudgetError);
    expect(() => {
      assertFrameBudgets(broken);
    }).toThrow(/receipt reel puts the grant beside the deed/);
  }, 300_000);
});
