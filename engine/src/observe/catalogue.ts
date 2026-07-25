/**
 * The affordance catalogue — **server-side eligibility filtering** (SPEC §12.1).
 *
 * Every option an agent could legally take right now is generated here, priced
 * here, and either published or **counted withheld with its ground**. Nothing is
 * sliced: see `withheld.ts` for why truncation is unrepresentable in this module.
 *
 * ## Eligibility is composed from the owning module's own predicates
 *
 * The one thing this file must never do is *re-derive* a rule. A second
 * implementation of "can this hand fill this role" is scar #1 with an affordance
 * attached: the agent is shown an option the engine then refuses, which from the
 * agent's side is indistinguishable from a counterparty taking the slot. So:
 *
 * | Question | Answered by |
 * |---|---|
 * | may this hand act at all | `world/hands.ts:isPresent` |
 * | is there a lane, and may it be flown | `world/map.ts:laneBetween`, `world/movement.ts:commonsBoundRejection` |
 * | is a hostile act legal here | `world/commons.ts:commonsFloorRejection` |
 * | is this venture fillable now | `venture/venture.ts:windowContains`, `openIndices`, `roleOfPrincipal` |
 * | is this hand already committed | `world/hands.ts` hand state — a committed hand is not `IDLE`, and INV-9 asserts hand state and the role table agree |
 * | what is a role owed | `venture/settlement.ts:computeClaims` |
 * | what does an act cost | `tick/budget.ts:costOf` |
 *
 * `test/observe/catalogue.test.ts` closes the remaining gap the table cannot: for
 * every `fill_role` this file publishes, it calls the **real** `fillRole` and asserts
 * it is accepted. A condition added to `fillRole` and not to the composition here
 * fails that test, which is the only protection that survives a future edit.
 *
 * ## Nineteen of the thirty-eight verbs are deliberately absent
 *
 * `attest · verify_owner · post_bond · offer_surety · extract · refine · build ·
 * haul · apply · admit · approve · audit · yield · flee · fight · join · form ·
 * charter · propose` have no state table to decide eligibility against yet — bond,
 * office, production and predation are later waves. An affordance for a verb whose
 * engine does not exist is not an option, it is a promise, and `agent.md` §6 says
 * this list is "everything you can legally do right now". So they are absent, not
 * stubbed, and not counted as withheld either: a withheld count means *an option
 * existed and you are not seeing it*, which would be equally untrue.
 *
 * ## Why `max_direct_loss` is sometimes a reason to withhold
 *
 * `agent.md` §12: *"Check `max_direct_loss` on every affordance before acting. **It
 * is exact, not an estimate.**"* When the worst case genuinely cannot be computed —
 * cargo whose good the book is too thin to price — the option is withheld under
 * `NO_PRICE` rather than published with a plausible number. A worst case that is
 * *nearly* right is scar #1 with a reassuring figure attached.
 */

import { canonicalHash } from '../core/canonical.js';
import { inFreeze, ticksUntilReckoning } from '../core/time.js';
import type { CanonicalScalar, GoodId, HandId, PrincipalId, SystemId, VentureId } from '../core/types.js';
import { minor, type Minor } from '../core/units.js';
import { compareIds } from '../ledger/index.js';
import { isRevokedAt } from '../identity/index.js';
import {
  VENTURE_KINDS,
  escrowRequired,
  isLive,
  minRoles,
  openIndices,
  partiesOf,
  principalsRequired,
  roleAt,
  roleOfPrincipal,
  signatoriesRequired,
  windowContains,
  type VentureRecord,
} from '../venture/index.js';
import {
  commonsBoundRejection,
  commonsFloorRejection,
  handsOf,
  isPresent,
  laneBetween,
  laneIsProtected,
  systemOf,
  type HandRecord,
} from '../world/index.js';
import {
  actionCostOf,
  type Affordance,
  type AffordanceParams,
  type Candidate,
  type Verb,
} from './affordance.js';
import { QuoteBook, QUOTE_TTL_TICKS } from './quote.js';
import { canSense } from './sensing.js';
import { roleSealKey, type ObserveSources } from './sources.js';
import { phrase } from './tokens.js';
import { WithheldTally } from './withheld.js';

/** Where a candidate is being generated for, and where its omissions are counted. */
export interface CatalogueContext {
  readonly sources: ObserveSources;
  readonly principal: PrincipalId;
  readonly quotes: QuoteBook;
  readonly tally: WithheldTally;
  /**
   * Hands already promised to a candidate in this pass, so two `fill_role`
   * candidates cannot both claim the same hand. Presence is the tightest constraint
   * in the game (§6.2) and an affordance list that double-books it is a list of
   * options only one of which is real.
   */
  readonly claimed: Set<HandId>;
}

export interface Catalogue {
  /** Everything published, in canonical order. */
  readonly candidates: readonly Candidate[];
  /** Everything the world offered, published or not. PROP-O1's denominator. */
  readonly considered: number;
}

interface Spec {
  readonly verb: Verb;
  readonly params: AffordanceParams;
  readonly maxDirectLoss: Minor;
  readonly maxContingentLiability: Minor;
  readonly forecloses: readonly string[];
  /** Option-specific expiry. The published one is the earlier of this and the quote's. */
  readonly expiresTick: number;
  readonly mandatory?: boolean;
  readonly weight?: Minor;
  readonly usesFreeAllowance?: boolean;
  /** World facts the quote pins, beyond tick and state version. */
  readonly inputs?: Readonly<Record<string, CanonicalScalar>>;
}

/**
 * Build one affordance and its quote, or refuse it because it has already died.
 *
 * `expires_tick` is the **earlier** of the option's own death and the quote's TTL,
 * which is the honest answer to "when does the option die": a quote that outlived
 * the thing it quotes would publish a pinned price for a slot that is gone.
 *
 * The expiry-in-the-past refusal is central rather than per-generator, and it was put
 * here because a property test found the case the generators missed: a live venture
 * whose `resolvesAtTick` has passed but which has not been settled yet published a
 * `message` option that expired **before** the observation's own tick. `agent.md` §6
 * says this list is "everything you can legally do right now", so an option that is
 * already dead is not a small inaccuracy — it is the list meaning something else. One
 * guard in one place cannot be forgotten by the next generator somebody adds.
 */
function build(ctx: CatalogueContext, spec: Spec): Candidate | null {
  const { sources } = ctx;
  const expires = Math.min(spec.expiresTick, sources.tick + QUOTE_TTL_TICKS);
  if (expires < sources.tick) return null;
  const quote = ctx.quotes.issue({
    tick: sources.tick,
    principal: ctx.principal,
    verb: spec.verb,
    params: spec.params,
    rulesVersion: sources.rulesVersion,
    maxSpend: spec.maxDirectLoss,
    inputsHash: canonicalHash({
      state_version: sources.stateVersion,
      tick: sources.tick,
      ...(spec.inputs ?? {}),
    }),
  });
  const affordance: Affordance = Object.freeze({
    verb: spec.verb,
    params: Object.freeze({ ...spec.params }),
    cost: actionCostOf(spec.verb, spec.usesFreeAllowance ?? false),
    max_direct_loss: spec.maxDirectLoss,
    max_contingent_liability: spec.maxContingentLiability,
    what_it_forecloses: Object.freeze(spec.forecloses.map(phrase)),
    expires_tick: expires,
    quote_id: quote.id,
  });
  return {
    affordance,
    mandatory: spec.mandatory ?? false,
    weight: spec.weight ?? minor(0),
    usesFreeAllowance: spec.usesFreeAllowance ?? false,
  };
}

/**
 * Build and publish, or count the refusal. The only way a candidate reaches the list.
 *
 * `WINDOW_SHUT` is the ground for a dead option, because that is what an agent needs
 * to know: the thing you are looking at is over, not that we ran out of room.
 */
function offer(ctx: CatalogueContext, out: Candidate[], spec: Spec): void {
  const candidate = build(ctx, spec);
  if (candidate === null) {
    ctx.tally.add('affordances', 'WINDOW_SHUT');
    return;
  }
  out.push(candidate);
}

/** The horizon an option with no natural death gets: the quote's own TTL. */
function quoteHorizon(tick: number): number {
  return tick + QUOTE_TTL_TICKS;
}

/**
 * When an option on a live venture dies: at the venture's resolution, or — if that
 * tick has already passed and the venture is still awaiting its Reckoning — at the
 * settlement that will actually resolve it.
 *
 * A venture whose `resolvesAtTick` is behind us but whose state is still `LIVE` is a
 * real and ordinary state: resolution happens in the Reckoning batch, not on the tick
 * the row names. Treating the named tick as the death of every option on it published
 * expired affordances for up to a whole Reckoning.
 */
function resolutionHorizon(venture: VentureRecord, tick: number): number {
  if (venture.resolvesAtTick >= tick) return venture.resolvesAtTick;
  return tick + Math.max(0, ticksUntilReckoning(tick) - 1);
}

/**
 * Generate the whole catalogue for one principal at one tick.
 *
 * Order of the generators is the order of SPEC §12.2's groups, so a reader can
 * check the coverage against the canon by scrolling. The final sort is
 * `compareCandidates`, never generation order.
 */
export function buildCatalogue(ctx: CatalogueContext): Catalogue {
  const out: Candidate[] = [];
  let considered = 0;

  considered += sealAffordances(ctx, out);
  considered += worldAffordances(ctx, out);
  considered += ventureAffordances(ctx, out);
  considered += authorityAffordances(ctx, out);
  considered += marketAffordances(ctx, out);
  considered += levyAffordances(ctx, out);
  considered += ballotAffordances(ctx, out);
  considered += sayAffordances(ctx, out);

  // The action budget is applied **last and in one place**. Applying it inside each
  // generator would give every generator a chance to forget it, and forgetting it
  // publishes an option the engine will refuse for A4 — which reads to an agent as
  // the engine changing its mind.
  const affordable: Candidate[] = [];
  for (const candidate of out) {
    if (candidate.affordance.cost > ctx.sources.actionsRemaining) {
      ctx.tally.add('affordances', 'ACTS_SPENT');
      continue;
    }
    affordable.push(candidate);
  }

  return { candidates: affordable, considered };
}

// ── identity: seal ───────────────────────────────────────────────────────────

/**
 * §11.1: "**Sealing is required for every role you hold**, and it must be committed
 * **before the freeze**." So an unsealed role is a *mandatory* affordance, and it
 * stops being an affordance at the freeze because after that there is nothing an
 * agent can do about it (INV-18: nothing may touch the settlement set).
 *
 * The free allowance is one per role held (§17), so each unsealed role produces
 * exactly one candidate at `cost: 0` — see `actionCostOf` for the gap that leaves on
 * the charge path.
 */
function sealAffordances(ctx: CatalogueContext, out: Candidate[]): number {
  const { sources } = ctx;
  let considered = 0;
  for (const venture of myVentures(ctx)) {
    const role = roleOfPrincipal(venture, ctx.principal);
    if (role === null || !isLive(venture)) continue;
    if (sources.sealedRoles.has(roleSealKey(venture.id, role.index))) continue;
    considered += 1;
    if (inFreeze(sources.tick)) {
      // Named FROZEN rather than WINDOW_SHUT: the agent needs to know it missed a
      // deadline that is about to be judged, not that a window closed.
      ctx.tally.add('affordances', 'FROZEN');
      continue;
    }
    offer(ctx, out, {
      verb: 'seal',
      params: { venture: venture.id, role_index: role.index },
      maxDirectLoss: minor(0),
      maxContingentLiability: minor(0),
      forecloses: [
        phrase('nothing you can spend'),
        phrase(`a contradicted seal adds 1 to your public count`),
      ],
      // The last tick before the freeze. A seal committed after that is not a
      // pre-commitment (§11.1) and the engine will not judge it.
      expiresTick: sources.tick + Math.max(0, ticksUntilReckoning(sources.tick) - 2),
      mandatory: true,
      usesFreeAllowance: true,
      weight: minor(role.terms.elective),
      inputs: { terms_hash: venture.termsHash },
    });
  }
  return considered;
}

// ── world: move, scan ────────────────────────────────────────────────────────

function worldAffordances(ctx: CatalogueContext, out: Candidate[]): number {
  const { sources } = ctx;
  let considered = 0;

  for (const hand of handsOf(sources.world, ctx.principal)) {
    // A hand in transit or recovering has no move to offer: `beginTransit` refuses
    // both, and offering it anyway would be an option the engine rejects.
    if (hand.state === 'IN_TRANSIT' || hand.state === 'RECOVERING') continue;
    const system = systemOf(sources.world.map, hand.location);

    for (const destination of [...system.lanes].sort((a, b) => compareIds(a, b))) {
      considered += 1;
      const lane = laneBetween(sources.world.map, hand.location, destination);
      if (lane === null) {
        // The map's adjacency and its lane table disagreeing is our bug, not the
        // agent's, and it must not be published as an option.
        ctx.tally.add('affordances', 'NO_RECORD');
        continue;
      }
      if (commonsBoundRejection(sources.world, hand, destination) !== null) {
        ctx.tally.add('affordances', 'COMMONS_BOUND');
        continue;
      }
      const risk = cargoRisk(ctx, hand, destination);
      if (risk === null) {
        ctx.tally.add('affordances', 'NO_PRICE');
        continue;
      }
      offer(ctx, out, {
        verb: 'move',
        params: { hand: hand.id, to: destination },
        maxDirectLoss: risk,
        maxContingentLiability: minor(0),
        forecloses: [
          phrase(`hand ${hand.ordinal} until tick ${String(sources.tick + lane.transitTicks)}`),
          phrase(`any role needing it at ${hand.location}`),
        ],
        expiresTick: quoteHorizon(sources.tick),
        weight: risk,
        inputs: { lane: lane.key, transit_ticks: lane.transitTicks },
      });
    }

    // `scan` is information and it is **not** free: unmetered information is
    // throughput becoming power (A4, and `tick/budget.ts` says so explicitly).
    if (isPresent(hand, sources.tick)) {
      considered += 1;
      offer(ctx, out, {
        verb: 'scan',
        params: { hand: hand.id, at: hand.location },
        maxDirectLoss: minor(0),
        maxContingentLiability: minor(0),
        forecloses: [phrase('one of this tick’s material actions')],
        expiresTick: quoteHorizon(sources.tick),
      });
    }
  }
  return considered;
}

/**
 * What a move can cost, exactly, or `null` when it cannot be priced.
 *
 * Zero on a protected lane and that is not an approximation: A8 makes hostile
 * action against a Commons target **invalid**, so a Commons-to-Commons crossing
 * genuinely cannot lose the cargo. Off a protected lane the cargo is at risk in
 * full, valued at the ledger's mark — and an unpriceable good means the option is
 * withheld rather than quoted.
 */
function cargoRisk(ctx: CatalogueContext, hand: HandRecord, destination: SystemId): Minor | null {
  if (laneIsProtected(ctx.sources.world, hand.location, destination)) return minor(0);
  let total = 0;
  for (const [good, amount] of orderedCargo(hand.cargo)) {
    const unit = ctx.sources.markPriceOf(good);
    if (unit === null) return null;
    total += unit * amount;
  }
  return minor(total);
}

function orderedCargo(cargo: ReadonlyMap<GoodId, number>): readonly (readonly [GoodId, number])[] {
  return [...cargo.entries()].sort((a, b) => compareIds(a[0], b[0]));
}

// ── venture: create, publish_offer, message, fill_role, sign, withdraw, abandon ─

function ventureAffordances(ctx: CatalogueContext, out: Candidate[]): number {
  const { sources } = ctx;
  let considered = 0;

  // `create` — one candidate per kind. Nothing binds until countersignature (§7.3),
  // so creating risks nothing; the numbers become real at `sign`.
  for (const kind of VENTURE_KINDS) {
    considered += 1;
    const floor = commonsFloorRejection(sources.world, 'create', {
      kind,
      // A `create` names no target of its own, so the floor is checked against this
      // principal's own seat — which is where a RAID or SIEGE would be staged from.
      principal: ctx.principal,
    });
    if (floor !== null) {
      ctx.tally.add('affordances', 'COMMONS_FLOOR');
      continue;
    }
    offer(ctx, out, {
      verb: 'create',
      params: { kind },
      maxDirectLoss: minor(0),
      maxContingentLiability: minor(0),
      forecloses: [
        phrase(`needs ${String(principalsRequired(kind))} distinct principals`),
        phrase(`${String(minRoles(kind))} roles live in one window`),
      ],
      expiresTick: quoteHorizon(sources.tick),
    });
  }

  considered += 1;
  offer(ctx, out, {
    verb: 'publish_offer',
    params: {},
    maxDirectLoss: minor(0),
    maxContingentLiability: minor(0),
    forecloses: [phrase('nothing; an offer binds nobody until countersigned')],
    expiresTick: quoteHorizon(sources.tick),
  });

  for (const venture of sortedVentures(sources.ventures)) {
    const mine = roleOfPrincipal(venture, ctx.principal);
    const isCreator = venture.creator === ctx.principal;

    // `sign` — mandatory when a venture is waiting on this principal. §7.3: nothing
    // binds until every party countersigns the same terms_hash.
    if (
      isLive(venture) &&
      signatoriesRequired(venture).includes(ctx.principal) &&
      !venture.countersigned.has(ctx.principal)
    ) {
      considered += 1;
      const escrow = isCreator ? escrowRequired(venture) : minor(0);
      const contingent = isCreator ? electiveTotal(venture) : minor(0);
      if (isCreator && sources.stores.freeMinor(ctx.principal) < escrow) {
        // A signature the signer cannot fund is an unfunded signature, which
        // settlement halts on rather than turning into a recorded loss. Better to
        // withhold it and say why.
        ctx.tally.add('affordances', 'SHORT_FUNDS');
      } else {
        offer(ctx, out, {
          verb: 'sign',
          params: { venture: venture.id, terms_hash: venture.termsHash },
          maxDirectLoss: escrow,
          maxContingentLiability: contingent,
          forecloses: [
            phrase(isCreator ? `${String(escrow)} into escrow at signing` : 'withdrawal without forfeit'),
            phrase(`resolves at tick ${String(venture.resolvesAtTick)}`),
          ],
          expiresTick: Math.min(venture.windowClosesTick, quoteHorizon(sources.tick)),
          // Mandatory only when somebody else is actually waiting on this signature.
          //
          // A venture nobody has joined is a draft, and §7.3 is explicit that nothing
          // binds until the parties countersign — so there is no obligation yet.
          // Marking every unsigned draft mandatory also handed an agent a lever on its
          // own payload: a mandatory affordance survives every narrowing rung, so
          // creating thirty drafts would push its own observation past the token
          // budget. Small harm, but it is throughput buying something, and A4 says
          // nothing may.
          mandatory: partiesOf(venture).length > 0,
          weight: contingent,
          inputs: { terms_hash: venture.termsHash },
        });
      }
    }

    // `message` — free, and it never wakes anybody (agent.md §4).
    //
    // Offered on any venture in formation (that is where a role gets negotiated) **and
    // on any live venture this principal is party to**. The second half matters: §7.3's
    // channel is "PARTIES-visible while live and declassifies at settlement", so the
    // conversation that the receipt reel is made of happens *after* signing, while the
    // elective half is still a choice. Cutting the channel at activation would delete
    // the best artifact in the design (§14).
    if (venture.state === 'FORMING' || (isLive(venture) && (mine !== null || isCreator))) {
      considered += 1;
      offer(ctx, out, {
        verb: 'message',
        params: { venture: venture.id },
        maxDirectLoss: minor(0),
        maxContingentLiability: minor(0),
        forecloses: [phrase('nothing; words are not a deal')],
        expiresTick: Math.min(resolutionHorizon(venture, sources.tick), quoteHorizon(sources.tick)),
      });
    }

    // `fill_role` — one candidate per (open role x free present hand at the stage).
    if (venture.state === 'FORMING') {
      considered += fillCandidates(ctx, venture, out);
    }

    // `withdraw` / `abandon` — R5's unconditional right, so they are never gated on
    // anything but holding the role. `withdraw` forfeits the stake (§7.3).
    if (mine !== null && isLive(venture)) {
      const staked =
        mine.stakeEncumbranceId === null
          ? minor(0)
          : (sources.stores.lockedMinor(mine.stakeEncumbranceId) ?? minor(0));
      for (const verb of ['withdraw', 'abandon'] as const) {
        considered += 1;
        offer(ctx, out, {
          verb,
          params: { venture: venture.id, role_index: mine.index },
          maxDirectLoss: staked,
          maxContingentLiability: minor(0),
          forecloses: [
            phrase(`your ${mine.label} claim of ${String(mine.terms.elective)} elective`),
            phrase(staked > 0 ? `${String(staked)} staked, forfeit to the others` : 'no stake to forfeit'),
          ],
          expiresTick: Math.min(resolutionHorizon(venture, sources.tick), quoteHorizon(sources.tick)),
          weight: staked,
          inputs: { terms_hash: venture.termsHash, role_index: mine.index },
        });
      }
    }
  }
  return considered;
}

/**
 * Candidates for the open roles of one forming venture.
 *
 * The eligibility here is `fillRole`'s own set of conditions, composed from the
 * venture module's exported predicates rather than restated: the window contains the
 * tick, the role is open, this principal holds no other role in this venture
 * (PROP-V6 clause 2), and the hand is PRESENT. `test/observe/catalogue.test.ts`
 * asserts every candidate this produces is one the real `fillRole` accepts.
 */
function fillCandidates(ctx: CatalogueContext, venture: VentureRecord, out: Candidate[]): number {
  const { sources } = ctx;
  let considered = 0;
  const open = openIndices(venture);
  if (open.length === 0) return 0;

  // One principal fills at most one role in a venture. Offering a second is offering
  // an act the engine refuses, and it would also imply the arithmetic that forces
  // cooperation is negotiable.
  if (roleOfPrincipal(venture, ctx.principal) !== null) {
    // Every open role was still a candidate the world offered, so every one of them is
    // counted. Counting them as one would understate the omission, and PROP-O1's
    // arithmetic is exact or it is decoration.
    considered += open.length;
    ctx.tally.add('affordances', 'NO_HAND_FREE', open.length);
    return considered;
  }

  const free = handsOf(sources.world, ctx.principal).filter(
    (hand) =>
      isPresent(hand, sources.tick) &&
      hand.state === 'IDLE' &&
      !ctx.claimed.has(hand.id) &&
      hand.location === venture.stage,
  );
  /**
   * How many hands could fill *any one* of these slots, before `free.shift()` starts
   * consuming them.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **"WE NEVER TRUNCATE THIS LIST" WAS FALSE HERE, BY ONE PER SLOT.**
   *
   * `free[0]` offers one hand per slot and the others were never counted, so a principal
   * with three idle hands at the stage saw one of three legal acts and a `withheld` ledger
   * that did not mention the other two. `agent.md` §6 names this exact case as a
   * must-report — "if you ever suspect an affordance was silently dropped, report it" —
   * and two Gate-3 probes proved the omission was of *legal* acts by filling with a hand
   * the payload never offered.
   *
   * Counted under `PAGED`, which is the ground that means **eligible**, and added to
   * `considered` in the same breath so PROP-O1's `candidates === shown + Σ withheld`
   * still balances. Measured against this snapshot rather than the shrinking `free`, so
   * the denominator does not depend on which slot happens to be visited first.
   * ══════════════════════════════════════════════════════════════════════════
   */
  const pool = free.length;

  for (const index of open) {
    considered += 1;
    if (!windowContains(venture, sources.tick)) {
      ctx.tally.add('affordances', 'WINDOW_SHUT');
      continue;
    }
    // Every hand beyond the one offered is an act the world allows and this payload omits.
    if (pool > 1) {
      considered += pool - 1;
      ctx.tally.add('affordances', 'PAGED', pool - 1);
    }
    const hand = free[0];
    if (hand === undefined) {
      // Two different reasons, and they need different corrective action: no hand at
      // all versus a hand that is somewhere else.
      const anywhere = handsOf(sources.world, ctx.principal).some(
        (h) => isPresent(h, sources.tick) && h.state === 'IDLE' && !ctx.claimed.has(h.id),
      );
      ctx.tally.add('affordances', anywhere ? 'OUT_OF_REACH' : 'NO_HAND_FREE');
      continue;
    }
    const role = roleAt(venture, index);
    ctx.claimed.add(hand.id);
    offer(ctx, out, {
      verb: 'fill_role',
      params: {
        venture: venture.id,
        role_index: index,
        hand: hand.id,
        // The quoted stake is zero — the minimum §7.3 allows — so the published
        // worst case is exact. An agent that wants to outbid a rival names its own
        // stake in `act`, which departs from this quote and gets a fresh preview
        // (§12.3, PROP-W3). Quoting a stake the agent never chose would be a worst
        // case it never agreed to.
        stake: 0,
      },
      maxDirectLoss: minor(0),
      maxContingentLiability: minor(0),
      forecloses: [
        phrase(`hand ${hand.ordinal} until tick ${String(venture.resolvesAtTick)}`),
        phrase(`any other role in ${venture.id}`),
      ],
      expiresTick: Math.min(venture.windowClosesTick, quoteHorizon(sources.tick)),
      weight: minor(role.terms.escrowed + role.terms.elective),
      inputs: { terms_hash: venture.termsHash, role_index: index },
    });
    // Consumed: the same hand cannot be offered for two slots in one payload.
    free.shift();
  }
  return considered;
}

function electiveTotal(venture: VentureRecord): Minor {
  let total = 0;
  for (const role of venture.roles) total += role.terms.elective;
  return minor(total);
}

// ── office: grant, revoke ────────────────────────────────────────────────────

function authorityAffordances(ctx: CatalogueContext, out: Candidate[]): number {
  const { sources } = ctx;
  let considered = 0;

  for (const template of sources.grantTemplates) {
    considered += 1;
    offer(ctx, out, {
      verb: 'grant',
      params: { template: template.template },
      // §10 of agent.md: "Before you sign, you are shown max_direct_loss and
      // max_contingent_liability. Read them." These are those numbers.
      maxDirectLoss: template.max_direct_loss,
      maxContingentLiability: template.max_contingent_liability,
      forecloses: [
        phrase(`${String(template.max_direct_loss)} of your value, at a delegate’s choosing`),
        phrase('cannot be widened while you are dark'),
      ],
      expiresTick: Math.min(template.expires_tick, quoteHorizon(sources.tick)),
      weight: template.max_direct_loss,
      inputs: { template: template.template },
    });
  }

  for (const grant of [...sources.grants].sort((a, b) => compareIds(a.id, b.id))) {
    if (grant.grantor !== ctx.principal) continue;
    considered += 1;
    if (isRevokedAt(grant.revokedAtTick, sources.tick) || grant.expiresTick < sources.tick) {
      ctx.tally.add('affordances', 'LIMITS_SPENT');
      continue;
    }
    const headroom = minor(Math.max(0, grant.maxDirectLoss - grant.spentDirect));
    offer(ctx, out, {
      verb: 'revoke',
      params: { grant: grant.id },
      maxDirectLoss: minor(0),
      maxContingentLiability: minor(0),
      forecloses: [
        phrase(`${grant.delegate}'s remaining ${String(headroom)} of headroom`),
        phrase('in-flight acts resolve under the published rule'),
      ],
      expiresTick: Math.min(grant.expiresTick, quoteHorizon(sources.tick)),
      weight: headroom,
      inputs: { grant: grant.id },
    });
  }
  return considered;
}

// ── market: trade ────────────────────────────────────────────────────────────

/**
 * A `trade` needs a hand where the book is. That is not a convenience rule: §12.1
 * says "local book only", and an agent that could trade a book it has nobody
 * standing in would be reading a `SENSED` fact and acting on it from orbit.
 */
function marketAffordances(ctx: CatalogueContext, out: Candidate[]): number {
  const { sources } = ctx;
  let considered = 0;
  for (const row of [...sources.market].sort(
    (a, b) => compareIds(a.system, b.system) || compareIds(a.good, b.good),
  )) {
    considered += 1;
    if (!canSense(sources.sensing, ctx.principal, row.system, row.system)) {
      ctx.tally.add('affordances', 'UNSENSED');
      continue;
    }
    const band = row.depth[0];
    const ask = band?.ask ?? row.best_ask;
    if (band === undefined || ask === null) {
      ctx.tally.add('affordances', 'NO_PRICE');
      continue;
    }
    const spend = minor(ask * band.qty);
    if (sources.stores.freeMinor(ctx.principal) < spend) {
      ctx.tally.add('affordances', 'SHORT_FUNDS');
      continue;
    }
    offer(ctx, out, {
      verb: 'trade',
      params: { at: row.system, good: row.good, qty: band.qty, unit_price: ask, side: 'BUY' },
      maxDirectLoss: spend,
      maxContingentLiability: minor(0),
      forecloses: [phrase(`${String(spend)} of free stores`)],
      expiresTick: quoteHorizon(sources.tick),
      weight: spend,
      inputs: { good: row.good, unit_price: ask, qty: band.qty },
    });
  }
  return considered;
}

// ── levy: deliver, set_delivery_intent ───────────────────────────────────────

/**
 * A14: the Levy cannot be dodged, so its affordances are **mandatory**.
 *
 * `deliver` needs a hand at the named place, because §5.2's stated share "must be
 * carried by one of your hands — you cannot buy your way out of being present".
 * `set_delivery_intent` has no such requirement and is what makes the Levy payable
 * while offline (agent.md §9, PROP-LV5), so it is offered even when `deliver` is
 * out of reach — otherwise going dark would cost an agent the one obligation the
 * design promises it can meet from bed.
 */
function levyAffordances(ctx: CatalogueContext, out: Candidate[]): number {
  const { sources } = ctx;
  const levy = sources.levy;
  if (levy === null) return 0;
  const owed = minor(Math.max(0, levy.my_assessment - levy.paid));
  if (owed === 0) return 0;

  const present = handsOf(sources.world, ctx.principal).filter(
    (hand) => isPresent(hand, sources.tick) && hand.location === levy.deliverable_to,
  );
  const carrier = present[0];
  if (carrier === undefined) {
    ctx.tally.add('affordances', 'OUT_OF_REACH');
  } else {
    offer(ctx, out, {
      verb: 'deliver',
      params: { to: levy.deliverable_to, hand: carrier.id, amount: owed },
      maxDirectLoss: owed,
      maxContingentLiability: minor(0),
      forecloses: [
        phrase(`${String(owed)} of goods, delivered`),
        phrase(`hand ${carrier.ordinal} this tick`),
      ],
      expiresTick: sources.tick + Math.max(0, ticksUntilReckoning(sources.tick) - 1),
      mandatory: true,
      weight: owed,
      inputs: { deliverable_to: levy.deliverable_to, owed },
    });
  }

  offer(ctx, out, {
    verb: 'set_delivery_intent',
    params: { to: levy.deliverable_to, amount: owed },
    maxDirectLoss: owed,
    maxContingentLiability: minor(0),
    forecloses: [
      phrase(`${String(owed)} of goods when the intent fires`),
      phrase('one hand at delivery time'),
    ],
    expiresTick: sources.tick + Math.max(0, ticksUntilReckoning(sources.tick) - 1),
    mandatory: true,
    weight: owed,
    inputs: { deliverable_to: levy.deliverable_to, owed },
  });
  // Two candidates considered: the delivery and the standing intent.
  return 2;
}

// ── ballot: vote ─────────────────────────────────────────────────────────────

function ballotAffordances(ctx: CatalogueContext, out: Candidate[]): number {
  const { sources } = ctx;
  let considered = 0;
  for (const ballot of [...sources.ballots].sort((a, b) => compareIds(a.id, b.id))) {
    if (ballot.voted || ballot.closes_tick < sources.tick) continue;
    considered += 1;
    // The floor holds on a vote exactly as firmly as on a raid: a seizure ballot is
    // a hostile act (`world/commons.ts` classifies it so), and one with no resolvable
    // target fails closed there. Passing the target through is what lets that rule
    // decide instead of this file guessing.
    const params: AffordanceParams = { ballot: ballot.kind, ballot_id: ballot.id };
    const floor = commonsFloorRejection(sources.world, 'vote', {
      ...params,
      ...(ballot.target === null ? {} : { target_principal: ballot.target }),
    });
    if (floor !== null) {
      ctx.tally.add('affordances', 'COMMONS_FLOOR');
      continue;
    }
    offer(ctx, out, {
      verb: 'vote',
      params,
      maxDirectLoss: minor(0),
      maxContingentLiability: minor(0),
      forecloses: [phrase('nothing; a ballot is free and cannot be priced out')],
      expiresTick: Math.min(ballot.closes_tick, quoteHorizon(sources.tick)),
      mandatory: true,
      inputs: { ballot: ballot.id },
    });
  }
  return considered;
}

// ── say: claim, deny ─────────────────────────────────────────────────────────

/**
 * §11.1's layer 1. Free, capped at 140 characters, and allowed to lie — which is
 * why neither is ever an input to a verdict (PROP-D1, scars #7 and #8).
 */
function sayAffordances(ctx: CatalogueContext, out: Candidate[]): number {
  for (const verb of ['claim', 'deny'] as const) {
    offer(ctx, out, {
      verb,
      params: {},
      maxDirectLoss: minor(0),
      maxContingentLiability: minor(0),
      forecloses: [phrase('nothing; words never bind and never harm')],
      expiresTick: quoteHorizon(ctx.sources.tick),
    });
  }
  return 2;
}

// ── shared ───────────────────────────────────────────────────────────────────

/** Ventures this principal is party to — creator or role-holder. In id order. */
export function myVentures(ctx: CatalogueContext): readonly VentureRecord[] {
  return sortedVentures(ctx.sources.ventures).filter(
    (venture) => venture.creator === ctx.principal || roleOfPrincipal(venture, ctx.principal) !== null,
  );
}

export function sortedVentures(ventures: readonly VentureRecord[]): readonly VentureRecord[] {
  return [...ventures].sort((a, b) => compareIds(a.id, b.id));
}

/** Every principal a venture names, for the counterparty list. */
export function partiesNamed(venture: VentureRecord): readonly PrincipalId[] {
  const seen = new Set<PrincipalId>([venture.creator]);
  for (const role of venture.roles) {
    if (role.filledByPrincipal !== null) seen.add(role.filledByPrincipal);
  }
  return [...seen].sort((a, b) => compareIds(a, b));
}

/** The venture ids this principal is party to. For `what_resolves` and the briefing. */
export function ventureIdsOf(ventures: readonly VentureRecord[]): readonly VentureId[] {
  return ventures.map((v) => v.id);
}
