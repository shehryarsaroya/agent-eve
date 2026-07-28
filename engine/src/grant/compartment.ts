/**
 * COMPARTMENTS and CLEARANCE — the *sight* half of a grant's LIMITS (SPEC §8, §11.2;
 * `PASS-TERRITORY-POLITICS` §16.7 MUST-5, §16.12 #3).
 *
 * ── THE HOLE THIS FILLS ─────────────────────────────────────────────────────
 *
 * A grant was **one dial**: how much can this delegate lose me. Two numbers, both about
 * money. So every grant handed over the same shape of authority and §16.12 #3's target —
 * *"organizations gain power only by taking a visible trust risk"* — had nothing to grade:
 * a treasurer was automatically a quartermaster, and a delegate that could *act* on your
 * stores could also *see* all of them, forever, for free.
 *
 * Two dimensions are added here and neither is a new verb (A6 is explicit: no `betray()`):
 *
 *   1. **The verb fence.** A grant carries the closed set of verbs it delegates. This is
 *      SPEC §8's own definition — *"a grant specifies **verbs** × resource selector ×
 *      limits × interval × approvals × delegation depth × revocation"* — and it was the
 *      one clause of that sentence with no field. {@link DELEGABLE_VERBS} is the set an
 *      `on_behalf_of` can name today, so the fence binds on the tick it lands rather than
 *      waiting for a mechanic that does not exist.
 *
 *   2. **The clearance.** A grant carries the set of COMPARTMENTS the delegate may read.
 *      Default **empty**: authority to act is not authority to see. A delegate with no
 *      clearance is not blocked from working — `factor` below is exactly that office —
 *      it simply cannot read the figures, and `observe` says so with a ground rather than
 *      omitting the section (PROP-O1).
 *
 * ── WHY EXACTLY TWO COMPARTMENTS, AND WHY NOT A THIRD ───────────────────────
 *
 * §11.2 assigns tiers to *information types*, and it names exactly two classes of private
 * fact about a principal that another principal could act on:
 *
 *   `SENSED`  — "cargo contents and hold values, exact hand disposition off public lanes"
 *   `PRIVATE` — "a principal's own strategy notes and reasoning"
 *
 * {@link STORES_COMPARTMENT} is the first half of that `SENSED` line (hold values) and
 * {@link HANDS_COMPARTMENT} is the second (disposition and what each hand carries). The
 * `PRIVATE` row is **not** a compartment and must never become one: §11.2 says it is
 * "never published to anyone — including its owner", so a grant that opened it would be a
 * clearance over a tier defined as unreadable.
 *
 * Three things were considered and rejected, because a compartment over a fact that is
 * already public cannot bind and would be decoration on a rules surface:
 *
 *   - **EXPOSURE** (Σ open `max_direct_loss`) — §11.2 D9a makes a grant's LIMITS, parties
 *     and renewal chain `PUBLIC`, so a mole learns nothing by being cleared for it.
 *   - **CLAIMS / WORKS** — `claimLines` and `worksLines` are `PUBLIC` frame fields.
 *   - **SEALS** — PROP-D2 is the one prohibition with no exceptions: agents receive
 *     `HONOURED | CONTRADICTED` and nothing else, at any tier, on any delay. A seal
 *     compartment would be that prohibition with a price on it.
 *
 * So two, and the count is a finding rather than a budget.
 */

import type { PrincipalId } from '../core/types.js';

/**
 * One named division of a principal's private facts that a GRANT may open to its delegate.
 *
 * Both members reuse a §3 canon term **in its canon sense**, which is the only reuse §3
 * permits: `AccountKind.STORES` is the account that *holds* assets, inventory and
 * balances, and `Compartment.STORES` is the *sight* of that same thing. Likewise a HAND is
 * "one unit of simultaneous physical presence" and `HANDS` is the sight of where a
 * principal's units of presence are. Both pairs are registered in
 * `test/core/vocabulary-repo.test.ts` with that reason, because an unregistered dual use
 * is the collision §3 exists to prevent.
 */
export type Compartment = 'STORES' | 'HANDS';

export const STORES_COMPARTMENT: Extract<Compartment, 'STORES'> = 'STORES';
export const HANDS_COMPARTMENT: Extract<Compartment, 'HANDS'> = 'HANDS';

/** Canonical order. Every list of compartments anywhere sorts to this, so nothing hashed drifts. */
export const COMPARTMENTS: readonly Compartment[] = Object.freeze([
  STORES_COMPARTMENT,
  HANDS_COMPARTMENT,
]);

export function isCompartment(value: string): value is Compartment {
  return (COMPARTMENTS as readonly string[]).includes(value);
}

/**
 * Sort and de-duplicate a compartment list into canonical order.
 *
 * Not `[...set].sort()`: a bare `.sort()` on strings is fine, but the ORDER it produces is
 * alphabetical rather than the canon's, and the canon's order is what `state_hash`,
 * the credential and the pixel signature all read. One order, declared once.
 */
export function canonicalClearance(raw: readonly string[]): readonly Compartment[] {
  const seen = new Set(raw);
  return COMPARTMENTS.filter((c) => seen.has(c));
}

/**
 * The verbs an `on_behalf_of` can actually name today, in canonical order.
 *
 * **This list is the fence's teeth and it is deliberately not "every verb".** Two verbs in
 * the engine accept `on_behalf_of` and draw on a grant's LIMITS: `create` (escrow against
 * DIRECT, the elective tail against CONTINGENT) and `elect` (the elective payment). A
 * fence that admitted verbs no delegate can use would be a rules surface promising a
 * scope that does nothing — this project's signature defect, and the reason `template`
 * needed teeth in the first place (six named offices, zero enforced difference).
 *
 * When a third verb takes `on_behalf_of`, it is added here and every existing grant keeps
 * the narrower fence it was signed with, which is the correct direction for a limit.
 */
export const DELEGABLE_VERBS: readonly string[] = Object.freeze(['create', 'elect']);

export function isDelegableVerb(verb: string): boolean {
  return DELEGABLE_VERBS.includes(verb);
}

/** Sort and de-duplicate a verb list into {@link DELEGABLE_VERBS} order. */
export function canonicalVerbs(raw: readonly string[]): readonly string[] {
  const seen = new Set(raw);
  return DELEGABLE_VERBS.filter((v) => seen.has(v));
}

/**
 * A named office: what it may DO and what it may SEE.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **`template` WAS A LABEL WITH NO TEETH, AND THAT IS SCAR #1's SHAPE.**
 *
 * `GRANT_TEMPLATES` shipped six office names — `treasury-hand · quartermaster ·
 * escort-captain · factor · steward · custom` — and `agent.md` §10 said of them: *"It is a
 * label on the receipt; you still set the limits."* Six words that an agent reads as six
 * different powers, and the engine treated all six identically. The receipt said
 * `quartermaster` and the authority was a steward's.
 *
 * A template now *is* a fence: it fixes the verbs and the default clearance, and
 * `custom` is the one that makes you say both out loud. The limits are still yours to set;
 * what changed is that the word on the receipt is now enforced.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `factor` is the interesting row and it is deliberate: **full authority, zero sight.** It
 * is the office §16.12 #3 asks for — a delegate that can act on something without being
 * able to see everything — and it exists so that "a delegate needs clearance to be useful"
 * is a claim the engine can refute.
 */
export interface OfficeShape {
  readonly verbs: readonly string[];
  readonly clearance: readonly Compartment[];
  /** One line an agent reads before it signs. Never a synonym of another row. */
  readonly reads: string;
}

export const OFFICE_SHAPES: Readonly<Record<string, OfficeShape>> = Object.freeze({
  'treasury-hand': Object.freeze({
    verbs: Object.freeze(['elect']),
    clearance: Object.freeze([STORES_COMPARTMENT]),
    reads: 'pays your elective halves and sees your balance; cannot sign you into anything new',
  }),
  quartermaster: Object.freeze({
    verbs: Object.freeze(['create']),
    clearance: Object.freeze([STORES_COMPARTMENT]),
    reads: 'signs you into ventures and sees your stores; cannot decide what you pay at the Reckoning',
  }),
  'escort-captain': Object.freeze({
    verbs: Object.freeze(['create']),
    clearance: Object.freeze([HANDS_COMPARTMENT]),
    reads: 'signs you into ventures and sees where your hands are; never sees your balance',
  }),
  factor: Object.freeze({
    verbs: Object.freeze(['create', 'elect']),
    clearance: Object.freeze([]),
    reads: 'acts on everything and sees nothing — full authority, no clearance',
  }),
  steward: Object.freeze({
    verbs: Object.freeze(['create', 'elect']),
    clearance: Object.freeze([STORES_COMPARTMENT, HANDS_COMPARTMENT]),
    reads: 'runs your house: every delegable verb and every compartment',
  }),
  custom: Object.freeze({
    // Empty on both axes on purpose: `custom` is the escape hatch, so it grants
    // NOTHING unless the grantor names it. A default that quietly granted everything
    // would make the safest-looking template the widest one.
    verbs: Object.freeze([]),
    clearance: Object.freeze([]),
    reads: 'exactly the verbs and compartments you name, and nothing else',
  }),
});

/** The template names, in the order `GRANT_TEMPLATES` publishes them. */
export const OFFICE_NAMES: readonly string[] = Object.freeze(Object.keys(OFFICE_SHAPES));

export function officeShape(template: string): OfficeShape | undefined {
  return Object.prototype.hasOwnProperty.call(OFFICE_SHAPES, template)
    ? OFFICE_SHAPES[template]
    : undefined;
}

// ── The figures a compartment holds ─────────────────────────────────────────

/**
 * What the engine must be able to read to cut a DOSSIER, as a port.
 *
 * A port rather than a `Runtime` reference for `works/refine.ts`'s reason (D21): the
 * digest is the one thing in this feature that is hashed and handed to a third party, so
 * it has to be testable against a hand-built world without standing up a runtime — and
 * a function that takes only what it reads cannot accidentally read something else.
 */
export interface CompartmentPort {
  /** Free and encumbered currency in the subject's STORES account. */
  readonly purse: (subject: PrincipalId) => { readonly free: number; readonly encumbered: number };
  /** Goods on hand, `[good, qty]`, in canonical good order. */
  readonly goods: (subject: PrincipalId) => readonly (readonly [string, number])[];
  /** Each hand: id, where it is, its state, and where it is bound (or null). */
  readonly hands: (
    subject: PrincipalId,
  ) => readonly {
    readonly id: string;
    readonly at: string;
    readonly state: string;
    readonly boundFor: string | null;
  }[];
}

/**
 * Bound on a dossier's digest (INV-26, scar #3).
 *
 * A digest is state: it is captured into `state_hash`, replayed, and read back by an agent
 * that may have been handed it months later. An unbounded one is a buffer an agent fills
 * for free by acquiring goods — the growth is *legitimate play*, which is the worst kind of
 * unbounded, because nothing looks wrong until a capture is enormous.
 */
export const MAX_DIGEST_CHARS = 480;

/**
 * The figures, as one canonical line.
 *
 * **Integers only, no floats, sorted keys** — this string is hashed (DET). It is also the
 * thing that makes a DOSSIER *evidence* rather than prose: the recipient does not get the
 * cutter's word for what the subject holds, it gets the server's, stamped with the tick it
 * was read. §16.7 MUST-3's whole point is that a claim and a piece of evidence are
 * different types, and §16.7 MUST-8's is that the transferable path is the signed one.
 *
 * Truncation is a **refusal upstream**, never a silent slice: {@link MAX_DIGEST_CHARS} is
 * checked by the caller so an over-long digest becomes a rejection an agent can read,
 * rather than a half-figure it would treat as the whole truth.
 */
export function compartmentDigest(
  port: CompartmentPort,
  subject: PrincipalId,
  compartment: Compartment,
  tick: number,
): string {
  const head = `${compartment}@${String(tick)}`;
  if (compartment === STORES_COMPARTMENT) {
    const purse = port.purse(subject);
    const goods = port.goods(subject).map(([good, q]) => `${good}=${String(q)}`);
    return [head, `free=${String(purse.free)}`, `encumbered=${String(purse.encumbered)}`, ...goods].join(
      ' ',
    );
  }
  const hands = port
    .hands(subject)
    .map((h) => `${h.id}@${h.at}/${h.state}${h.boundFor === null ? '' : `>${h.boundFor}`}`);
  return [head, ...hands].join(' ');
}
