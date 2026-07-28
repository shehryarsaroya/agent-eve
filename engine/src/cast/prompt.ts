/**
 * The prompt, built from **the player contract** — not from a second private copy of it.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **SCAR #1 IS THE ENTIRE REASON THIS FILE IS SHAPED THIS WAY.**
 *
 * High Water's engine resolved votes as *stones protect the district they are placed on*
 * while the LLM players' prompt said stones decide *which district drowns* — the exact
 * inverse. The town reliably saved what it meant to destroy, and the bug survived a full
 * build and three critic passes because **every individual component was correct and
 * nothing compared them.**
 *
 * The general lesson is not "write better prompts". It is: **an LLM-facing prompt is a
 * rules surface, and two rules surfaces will drift.** So this file does not contain a
 * description of the game. It reads `agent.md` — the same bytes served at
 * `GET /compact/api/agent.md` to every external agent, the same file
 * `test/rules-surface/agent-md.test.ts` pins against the spec — and pastes the relevant
 * sections in verbatim.
 *
 * And when it cannot: {@link loadContractDocument} returns `null` if a required section is
 * missing, which **disables the LLM cast** and falls the world back to heuristics.
 * Refusing to play is the correct failure. A cast prompted from a stale private copy of
 * the rules is exactly the bug above, and it would be invisible.
 *
 * **Which sections it pastes is now chosen per wake** from the member's own observation —
 * {@link CONTRACT_CATALOG} — because `agent.md` outgrew the budget and the two changes before
 * that one paid for it in rules prose. That does not weaken the paragraph above: the sections
 * are still the document's own bytes, never a summary, the absences are named in the prompt
 * with their reasons, and a section whose verb is offered this wake is never one of them.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { readFileSync } from 'node:fs';
import type { Observation } from '../api/observe.js';
import type { CastCharacter } from './characters.js';
import { FREE_VERBS } from '../tick/budget.js';
import { STANCE_CREED } from './characters.js';
import type { CompletionMessage } from './transport.js';

/**
 * What the selection reads off ONE observation. Nothing else is an input.
 *
 * Deterministic by construction: every field is a fact already in the payload the member
 * is about to be shown, so the same observation always produces the same excerpt. No
 * clock, no RNG, no memory of previous wakes — this runs inside the tick.
 */
export interface ContractSituation {
  /**
   * The verbs offered in `affordances[]` this wake. **This is the refusal surface**, and
   * it is why the selector — not each unit's own predicate — is what maps a verb to
   * its rules: see {@link unitGrade}.
   */
  readonly verbs: ReadonlySet<string>;
  readonly inCommons: boolean;
  readonly commonsBound: boolean;
  /** Predation can legally reach it: A8 makes hostile action in the Commons *invalid*. */
  readonly outsideCommons: boolean;
  /** It holds a role in at least one live venture, so settlement is about to happen to it. */
  readonly inVenture: boolean;
  /**
   * It has issued authority, or holds authority somebody else issued.
   *
   * **This covers syndicate offices too.** `observe` builds `grants.granted` as this
   * principal's own grants *plus* every office issued by a syndicate it sits in, so a house
   * with an office over its treasury already reads `true` here. Measured on a 900-tick world:
   * adding `inSyndicate` as a *second* trigger for §10 selected it on a further **562 of 1,548
   * wakes** — 36% — for members that held no authority, had issued none, and were offered no
   * grant verb. Those were syndicates with no office in existence yet, so there was nothing
   * in §10 to act on. `inSyndicate` still exists below, because §11C is about the house.
   */
  readonly holdsGrant: boolean;
  readonly inSyndicate: boolean;
  /** `obligations.charge` is this principal's own claim rows — one per claim it holds. */
  readonly holdsClaim: boolean;
  /** Any claim of its own carrying arrears. The window before a lapse. */
  readonly inArrears: boolean;
  /**
   * Any claim of its own whose anchor is COLD.
   *
   * The one failure in this game that is otherwise **silent**: a cold anchor takes no
   * arrears, lapses nothing and is slashed nothing, so no other field in the observation
   * moves when the income stops. `agent-md.test.ts` says so about `FUEL_STATEMENT`.
   */
  readonly anchorCold: boolean;
  /** A demand or a world raid stands against it, with a deadline. */
  readonly underRaid: boolean;
  /**
   * A battle it is a party to is live — `obligations.battle`, §9A.
   *
   * Its own key rather than a fold into `underRaid`, because the two carry different deadlines
   * and different acts: a raid is answered with `yield`/`fight`/`join` inside 24 ticks, and the
   * battle a refused demand becomes takes hulls only inside its 6-tick MUSTER. A member in the
   * second and told only about the first would miss the one window it can act in.
   */
  readonly inBattle: boolean;
  readonly holdsWorks: boolean;
  /** `holding.works.here.affordable` — it could raise one right now. */
  readonly canBuildWorks: boolean;
  /**
   * ★ **Its money is all endowment: it holds a balance and can transfer none of it.**
   *
   * The state a blind probe read on the live shard as `market.transferable_minor: 0` beside
   * **200,000 currency**, with no `trade` offered and the strings `endowment` and `earned` absent
   * from the entire observation. §11A's funding block was keyed on `verbs.has('trade')`, so the
   * rules text existed, was correct, and **was selected exactly when it was least needed** — when
   * a trade was already possible. The confusing case got nothing.
   *
   * Keyed on the payload's own figures rather than on the verb, because the thing that needs
   * explaining is the NUMBER, not the menu.
   */
  readonly endowmentWithheld: boolean;
}

/**
 * One selectable piece of the contract: a `##` section's preamble, or one `###` block in it.
 *
 * Addressed by the pair, because a `###` heading is only unique inside its section (`### What
 * to read` could recur) and because the section is what carries the framing.
 */
export interface ContractUnit {
  readonly section: string;
  /** The `###` heading, or `null` for the text between the `##` heading and the first `###`. */
  readonly block: string | null;
  /** In every excerpt, whatever the observation says. */
  readonly floor?: true;
  /**
   * Verbs whose rules are HERE. Any one of them offered ⇒ this unit ships, whatever the
   * budget. This is the list the guarantee runs on; see {@link unitGrade}.
   */
  readonly verbs: readonly string[];
  /**
   * Standing facts that make this unit **mandatory** even with no verb offered.
   *
   * Reserved for rules whose absence is an A5′ problem rather than a missed option — a
   * claimant that was never shown what it owed, an anchor whose failure is silent. Not "it
   * would be nice to know".
   */
  readonly required?: (situation: ContractSituation) => boolean;
  /** Standing facts that make it worth having. Shipped only if it FITS, and named if not. */
  readonly wanted?: (situation: ContractSituation) => boolean;
  /** One clause, printed in the prompt when this unit is left out. */
  readonly because: string;
}

/** What a wake owes a unit. `RULES` never drops; `CONTEXT` fills the remaining budget. */
export type UnitGrade = 'FLOOR' | 'RULES' | 'CONTEXT' | 'NO';

/** The `##` headings, named once so a renumbering is one edit and the catalog reads short. */
const S1 = '## 1. The loop';
const S3 = '## 3. What you have';
const S4 = '## 4. Work happens in ventures';
const S5 = '## 5. Time';
const S6 = '## 6. Reading an observation';
const S7 = '## 7. Acting';
const S8 = '## 8. What is public, and what is not';
const S10 = '## 10. Granting authority';
const S11 = '## 11. The Commons';
const S11A = '## 11A. WORKS — the only reason goods exist';
const S11B = '## 11B. Sovereignty — territory you have to MAINTAIN';
const S11C = '## 11C. SYNDICATES — pooling, and the authority that comes with it';
const S11D = '## 11D. PREDATION — two kinds, and only one of them has a name';
const S11E = '## 11E. CAMPAIGNS — the only way to take ground somebody is PAYING for';
const S12 = '## 12. Getting good';

/**
 * Every selectable unit of the player contract, in document order, each with the rule for
 * whether a given wake needs it.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * **WHY THIS IS A CATALOG OF `###` BLOCKS AND NOT A LIST OF `##` SECTIONS.**
 *
 * It was a flat list of `##` sections and every member got all of them every wake. That was
 * right when `agent.md` was 300 lines. At ~1,070 the excerpt measured **37,902 of a 38,000
 * bar** and two consecutive changes had to *trim real rules prose* to land — one compressing a
 * verbatim sovereignty statement to a numbers check because a faithful copy pushed it to
 * 39,706. At ~40,000 the next section added would silently drop **§12 Getting good** off the
 * end: no error, the cast just stops being told part of the game. That is scar #1's class.
 *
 * Section-level selection was built first and **did not free enough**: measured over a real
 * 900-tick 12-member world, 57% of wakes still took the whole catalog, because this world
 * offers `create`, `publish_offer` and `graduate` on essentially every wake. And it left
 * **nine live verbs with no readable rules at all** — `post_bond`, `form`, `apply`, `admit`,
 * `approve`, `yield`, `fight`, `join`, `demand` — because §11B (8,491), §11C (3,741) and §11D
 * (4,606) could not fit as whole sections at any arrangement.
 *
 * `###` granularity is what fixes both, and the reason is that the *rules for a verb* are
 * almost always one block, not a section. A member about to take territory needs §11B's
 * preamble and `### Taking one — post_bond then build` — **1,983 characters, not 8,491.** The
 * rest of §11B is what a *claimant* needs, and it arrives when it holds one.
 *
 * ── THE GUARANTEE, AND WHERE IT LIVES ────────────────────────────────────────
 *
 * Getting this wrong is worse than the ceiling was: an agent that acts without a rule it
 * needed is refused for something it was never told, and a refusal costs it a real action out
 * of four (AGT-S2). So the rule that matters is **not** in any individual predicate, where one
 * of fifty-three could be forgotten. It is in {@link unitGrade}: *a unit one of whose `verbs`
 * is offered in `affordances[]` is graded `RULES`, before any predicate is consulted, and
 * `RULES` is never dropped for any reason including length.*
 *
 * `prompt.test.ts` asserts every verb the ENGINE implements has a home here, and that offering
 * it alone pulls that home in.
 *
 * ── FLOOR · RULES · CONTEXT ──────────────────────────────────────────────────
 *
 * **FLOOR** ships always: identity and the loop (§1), what a principal *is* (§3), the clock
 * and the Reckoning and the Levy (§5), how to read the payload it is holding (§6), the verbs
 * and the four-action budget and *"an illegal action is not an error"* (§7), the privacy tiers
 * (§8's preamble), where goods come from and that a place yields rather than a principal
 * (§11A's first two units), and the advice that says to read `briefing.if_you_do_nothing`
 * first (§12). Each is unconditional machinery, or a rule whose absence makes a member
 * **misread its own position** rather than merely miss an option.
 *
 * **RULES** is a verb offered, or a `required` fact — reserved for rules whose absence is an
 * A5′ problem: a claimant that was never shown what it owed, an anchor whose failure to
 * collect is otherwise invisible in every field of the observation.
 *
 * **CONTEXT** is `wanted` — worth having, dropped if the budget binds, and named when it is.
 *
 * ── WHAT THE BUDGET NOW GOVERNS, WHICH IS A CHANGE ───────────────────────────
 *
 * FLOOR and RULES are emitted **whatever the total**; {@link MAX_CONTRACT_CHARS} governs
 * CONTEXT. That is the same trade `projectObservation` already makes one field over — *"it
 * overshoots the cap rather than cutting the document in half, and that is the right trade"* —
 * and it is the only arrangement in which "a needed rule is never dropped" is true by
 * construction rather than by the numbers happening to fit. The bar did not move; what moved
 * is which half of the excerpt it disciplines. An overshoot is loud: `overBudget` is set, the
 * prompt says so, and `prompt.test.ts` fails naming the position.
 *
 * `agent.md` numbers its headings, and the number is part of the match: a section renumbered
 * is a section reordered, and the cast should notice — {@link loadContractDocument} returns
 * `null` for any catalogued `##` or `###` heading that moved, whatever this wake needs.
 *
 * ── ONE THING THIS CATALOG RECORDS RATHER THAN FIXES ─────────────────────────
 *
 * `claim`, `deny`, `withdraw` and `propose` appear in `agent.md` **only as names in §7's verb
 * table**. §7 is FLOOR so they are always readable, and the guarantee below holds — but a row
 * in a table is not a rule, and `withdraw` is listed under `venture` there while its only
 * actual rules (`### Leaving costs a Reckoning of notice`) are about leaving a *syndicate*.
 * That is a hard-rule-4 smell in the document, not in the selection, and it wants a separate
 * change.
 * ══════════════════════════════════════════════════════════════════════════════
 */
export const CONTRACT_CATALOG: readonly ContractUnit[] = Object.freeze([
  // ── §1 ────────────────────────────────────────────────────────────────────
  { section: S1, block: null, floor: true, verbs: [], because: 'floor' },

  // ── §3 ────────────────────────────────────────────────────────────────────
  { section: S3, block: null, floor: true, verbs: [], because: 'floor' },

  // ── §4 · the venture. `create` needs the two halves AND the proportion; `elect` needs the
  //    paying rules; `message` needs the negotiation rules. A member in no venture and
  //    offered none of them needs none of it.
  {
    section: S4,
    block: null,
    verbs: ['fill_role', 'sign', 'abandon'],
    wanted: (s) => s.inVenture,
    because: 'you hold no role in a live venture and no venture verb is offered to you',
  },
  {
    section: S4,
    block: '### Every promise has two halves',
    verbs: ['create', 'elect'],
    required: (s) => s.inVenture,
    because: 'nothing of yours is settling and you are creating nothing',
  },
  {
    section: S4,
    block: '### Choosing the proportion — `elective_bps` on `create`',
    verbs: ['create'],
    because: '`create` is not offered to you this wake, so there is no proportion to choose',
  },
  {
    section: S4,
    block: '### Paying the elective half: `elect`, and say `IN_FULL`',
    verbs: ['elect'],
    wanted: (s) => s.inVenture,
    because: 'you owe no elective half you can pay right now',
  },
  {
    section: S4,
    block: '### Negotiating',
    verbs: ['message', 'publish_offer'],
    because: 'neither `message` nor `publish_offer` is offered to you this wake',
  },
  /**
   * ★ RULES for anybody offered `fill_role` **or** a `vote`, and the second key is the point.
   *
   * A stake is *escrowed at fill time* and *forfeit to the other parties on withdrawal* (§7.3), so a
   * member offered the verb and not shown this block can lose slashable capital to a rule it was never
   * told about — A5′'s shape, and the reason `verbs: ['fill_role']` grades it RULES rather than
   * CONTEXT.
   *
   * `vote` is the second key because EXPOSURE is what two of §5.2's four allocation rules are computed
   * from. A member deciding between `BY_EXPOSURE` and `INVERSE_EXPOSURE` without knowing that its own
   * stakes are the number being weighed is voting on a figure it does not know it controls — and until
   * `D31` there was no such figure, so nothing in the document had to say it.
   */
  {
    section: S4,
    block: '### The third half: `stake` on `fill_role` — how you outbid a rival, and what it costs',
    verbs: ['fill_role', 'vote'],
    wanted: (s) => s.inVenture,
    because: 'neither `fill_role` nor `vote` is offered to you this wake, so there is no bid to place',
  },

  // ── §5 · the clock. All floor: nobody sits the Levy out (A14).
  { section: S5, block: null, floor: true, verbs: [], because: 'floor' },
  {
    section: S5,
    block: '### The Reckoning has three parts, and the boundaries matter',
    floor: true,
    verbs: [],
    because: 'floor',
  },
  {
    section: S5,
    block: '### The Levy — nobody sits this out',
    floor: true,
    verbs: ['deliver', 'set_delivery_intent', 'vote'],
    because: 'floor',
  },

  // ── §6 · how to read the payload it is holding. All floor.
  { section: S6, block: null, floor: true, verbs: [], because: 'floor' },
  { section: S6, block: '### Read `affordances[]` carefully', floor: true, verbs: [], because: 'floor' },
  { section: S6, block: '### Read `briefing.if_you_do_nothing`', floor: true, verbs: [], because: 'floor' },
  {
    section: S6,
    block: '### Free things that do not cost an action',
    floor: true,
    verbs: [],
    because: 'floor',
  },

  // ── §7 · the verb table, the action budget, the production chain. Floor, and the only
  //    place `trade`, `refine`, `claim`, `deny`, `withdraw` and `propose` are named at all.
  {
    section: S7,
    block: null,
    floor: true,
    verbs: ['trade', 'refine', 'claim', 'deny', 'propose'],
    because: 'floor',
  },

  // ── §8 · the privacy tiers are floor; the seal rules arrive with a seal.
  { section: S8, block: null, floor: true, verbs: [], because: 'floor' },
  {
    section: S8,
    block: '### Seals — the say-do gap',
    verbs: ['seal'],
    wanted: (s) => s.inVenture,
    because: '`seal` is not offered to you and nothing of yours is riding on one',
  },

  // ── §10 · offices. The A6 core loop, and it arrives with the first grant.
  {
    section: S10,
    block: null,
    verbs: [],
    // `wanted`, not `required`: knowing what a grant IS matters, but it is not an A5′ rule and a
    // member offered `grant` or `revoke` pulls this preamble in structurally anyway. Graded
    // `required` it added 1,989 characters to every wake of every member that had ever been
    // handed authority, whether or not it could act on it.
    wanted: (s) => s.holdsGrant,
    because: 'you have issued no authority and hold none, including through any syndicate you sit in',
  },
  {
    section: S10,
    block: '### Doing it — `grant`, acting on behalf, and `revoke` (all live now)',
    verbs: ['grant', 'revoke', 'audit'],
    wanted: (s) => s.holdsGrant,
    because: 'no grant verb is offered to you this wake',
  },

  // ── §11 · the Commons. The preamble carries the Commons-bound `move` REFUSAL, which is
  //    why `move` is claimed here and not in §7: being refused for that rule is the AGT-S2
  //    harm this catalog exists to prevent. `graduate` gets its own 3,282-character block,
  //    and a claim-holder is never offered it (`crossing.anchoring.length === 0` in
  //    `observe.ts`, INV-8, `test/sovereignty/anchored-and-territorial.spec.ts`) — which is
  //    the exclusion that makes §11 and most of §11B affordable together.
  {
    section: S11,
    block: null,
    verbs: ['move'],
    required: (s) => s.inCommons || s.commonsBound,
    because: 'your holding has left the Commons and your hands are no longer Commons-bound',
  },
  {
    section: S11,
    block: '### `graduate` — leaving, and it is one-way',
    verbs: ['graduate'],
    because: '`graduate` is not offered to you — you cannot afford the crossing, or a claim anchors your body',
  },

  // ── §11A · WORKS. The first two units are FLOOR: the only source of goods in the world,
  //    and the yield-division rule that decides where building is worth anything. A member
  //    with a covered Levy and no WORKS is about two Reckonings from being short every night,
  //    and it is the one that most needs to read this.
  { section: S11A, block: null, floor: true, verbs: [], because: 'floor' },
  { section: S11A, block: '### A place yields; you do not', floor: true, verbs: [], because: 'floor' },
  {
    section: S11A,
    block: '### Who owns the ground, and the good only the Frontier makes',
    verbs: [],
    // The rent a claim RECEIVES and which good the Frontier makes. Real, and not A5′: the
    // consequence of not reading it is a worse choice of ground, not a bill from a rule nobody
    // showed you. §11B's own fuel block keeps `required` for the silent failure.
    wanted: (s) => s.holdsClaim || s.holdsWorks || s.canBuildWorks,
    because: 'you neither hold ground that takes rent nor work ground that pays it',
  },
  {
    section: S11A,
    // ── THE HULL RULES LIVE HERE, NOT IN §11D, AND THE MEASUREMENT DECIDED IT ──
    //
    // They were drafted as a §11D block claiming `build`. That looked right — a hull is a combat
    // object — and it cost a Commons newcomer **2,188 characters**, because selecting any §11D
    // unit structurally pulls in §11D's own preamble, which is about predation. So a member A8
    // makes *immune* to predation was being handed the predation preamble for being able to raise
    // a WORKS. Correct by the letter of the guarantee and wrong by the reader's situation.
    //
    // §11A already documents what `build`'s `kind` selects between, so the hull's two distinctive
    // rules — it costs `fuel`, which only the FRONTIER makes, and its fit is FROZEN at build —
    // belong in the same block as the ANCHOR's "needs a posted bond". Same verb, same trigger, no
    // second preamble. §11D keeps the battle itself.
    block: '### `build` is FOUR different acts — read the `kind`',
    verbs: ['build'],
    because: '`build` is not offered to you this wake',
  },
  {
    section: S11A,
    block: '### Building one — `build` `{"kind":"WORKS","system":"<id>"}`',
    verbs: ['build'],
    because: '`build` is not offered to you this wake',
  },
  {
    section: S11A,
    // ── ★ THE FOURTH GOOD, AND IT CLAIMS `haul` AS WELL AS `refine` ───────────
    //
    // Two verbs on one block, which is unusual here and is the honest shape: the block states a rule
    // about *geography* — the good is refined at one tier and spent at another — and neither half of
    // that is usable without the other. A member offered `refine` and given only the recipe would make
    // a good it could not move; a member offered `haul` and given only the mechanics would move goods
    // with no reason to.
    //
    // `required` for a claimant rather than `wanted`, for §11B's A5′ reason one section down: the
    // anchor's manufactured half is a price no MARCHES or FRONTIER seat can pay out of local
    // production, and a claimant refused for a shortfall in a good it was never told it cannot make
    // has been billed by a rule nobody showed it.
    block: '### The fourth good — the one only the COMMONS makes, and the one that flows the other way',
    verbs: ['refine', 'haul'],
    required: (s) => s.holdsClaim,
    wanted: (s) => s.holdsWorks || s.canBuildWorks || s.holdsClaim,
    because: 'you neither work ground that makes ore nor hold ground that spends alloy',
  },
  {
    section: S11A,
    // ── ★ THE FUNDING RULE FOR A BID (`RULES_VERSION` 19) ────────────────────
    //
    // ══════════════════════════════════════════════════════════════════════════
    // **KEYED ON `trade`, WHICH IS THE WHOLE DESIGN OF THIS ENTRY.** Two quantities are
    // published side by side and they are NOT the same: `works.here.spendable_minor` is the
    // free balance (a build DESTROYS currency, so the endowment may pay for it) and
    // `market.transferable_minor` is that balance minus the endowment still unspent (a BID
    // TRANSFERS it, so the endowment may not). A member that mistakes one for the other prices
    // an order it cannot escrow and is refused — which is exactly what the heuristic cast did
    // 8,575 times in one world before it was corrected to read the right accessor.
    //
    // It is `wanted` rather than FLOOR because a member with no `trade` offered cannot act on
    // it, and this section already spends more of the excerpt than any other. It is not
    // `required`: unlike §11B's anchor price, being refused here costs an action and a hint
    // rather than a permanent default on the record, so A5′ does not force it.
    // ══════════════════════════════════════════════════════════════════════════
    block: '### ★ What you may spend, and the one rule that decides it — `market.transferable_minor`',
    verbs: ['trade'],
    // ── ★ AND ON THE CONFUSING NUMBER, WHICH IS THE CASE IT WAS BUILT FOR AND MISSED ──
    //
    // `verbs.has('trade')` alone selected this block only when a trade was already possible. The
    // member that needs it is the one holding a balance it cannot spend and being offered nothing
    // — which is what a probe read on the live shard and could not explain. Still `wanted` rather
    // than `required`: being refused here costs an action and a hint, never a permanent default,
    // so A5′ does not force it, and a dropped CONTEXT unit is NAMED by `because` below.
    wanted: (s) => s.verbs.has('trade') || s.endowmentWithheld,
    // `because` is UNCHANGED, deliberately. It is emitted on every wake this unit is dropped from
    // — including a newcomer's first, the position the character budget is tightest on — and the
    // original sentence stays true under the wider predicate: no `trade` offered does imply
    // nothing can be committed to an order. Restating the new disjunct here measured **+65
    // characters on all five positions** for a clause that changes no decision.
    because: 'no `trade` is offered to you this wake, so nothing you hold can be committed to an order',
  },
  {
    section: S11A,
    block: '### What to read',
    verbs: [],
    wanted: (s) => s.holdsWorks || s.canBuildWorks,
    because: 'you hold no WORKS and cannot raise one right now',
  },

  // ── §11B · sovereignty. THE SECTION THE CAST COULD NEVER READ. 8,491 characters as a
  //    whole, which is why it was in CONTRACT_NOT_EXCERPTED — but a member about to take
  //    territory needs 1,983 of it, and a claimant needs the rest for A5′ reasons: never a
  //    lapse against a claimant that was never shown what it owed.
  // ══════════════════════════════════════════════════════════════════════════
  // §11E — CAMPAIGNS. All four blocks are `verbs`-gated RULES, never FLOOR.
  //
  // FLOOR is the expensive placement — every position pays for it — and a campaign is reachable only
  // by a principal whose holding stands one lane from somebody else's claim, which is a narrow state.
  // So the whole section ships only to a wake that was actually offered one of its three verbs, and a
  // Commons newcomer pays nothing for it. `prompt.test.ts` pins the measured cost of every position,
  // so the arithmetic here is checkable rather than asserted.
  //
  // `build` is shared with §11A and §11B and that is correct: the `kind` block explains the fourth
  // kind, and this section is what the fourth kind DOES. Same verb, same trigger, no second preamble.
  // ══════════════════════════════════════════════════════════════════════════
  {
    section: S11E,
    block: null,
    verbs: ['build'],
    because: 'no campaign is offered to you this wake',
  },
  {
    section: S11E,
    block: '### Declaring one — `build` `{"kind":"CAMPAIGN","system":"<the claimed system>"}`',
    verbs: ['build'],
    because: 'no campaign is offered to you this wake',
  },
  {
    section: S11E,
    // The PULSE block goes to anyone offered `join` too, and that is the load-bearing pairing: an ally
    // that does not know force is counted AT THE PULSE will sign up and march away, contributing
    // nothing it was told it would. A5′ in the agent-facing text rather than in the engine.
    block: '### The PULSE — once a Reckoning, on a published clock, whether you are awake or not',
    verbs: ['build', 'join'],
    because: 'no campaign is offered to you this wake',
  },
  {
    section: S11E,
    block: '### Reading it — `holding.campaigns[]`',
    verbs: ['build', 'join', 'withdraw'],
    because: 'no campaign is offered to you this wake',
  },
  {
    section: S11E,
    block: '### Taking a side — `join` `{"campaign":"<id>","side":"ATTACKER"|"DEFENDER"}`',
    verbs: ['join'],
    because: '`join` is not offered to you this wake',
  },
  {
    section: S11E,
    // `withdraw` is on this block because the LIFT is one of the four endings, and an attacker that
    // cannot see the cheaper way to lose will hold a losing war to its bond-forfeiting end.
    block: '### Getting out — and there are four ways, not one',
    verbs: ['build', 'withdraw'],
    because: 'no campaign is offered to you this wake',
  },
  {
    section: S11B,
    block: null,
    verbs: ['post_bond'],
    required: (s) => s.holdsClaim,
    because: 'you hold no territory and `post_bond` is not offered to you',
  },
  {
    section: S11B,
    block: '### Taking one — `post_bond` then `build`',
    verbs: ['post_bond'],
    because: '`post_bond` is not offered to you, so no claim is available to take right now',
  },
  {
    section: S11B,
    block: '### Paying for it — the CHARGE',
    verbs: [],
    // A5′. `obligations.charge` carries the arithmetic; this is the rule behind it, and a
    // claimant billed from a rule it was never given is the libel case §15.4 is about.
    required: (s) => s.holdsClaim,
    because: 'you hold no claim, so no Charge falls due on you',
  },
  {
    section: S11B,
    block: '### Losing it — arrears, the window, and two exits that beat a lapse',
    verbs: ['abandon'],
    required: (s) => s.inArrears,
    wanted: (s) => s.holdsClaim,
    because: 'no claim of yours is in arrears',
  },
  {
    section: S11B,
    block: "### Keeping it COLLECTING — the anchor's fuel",
    verbs: [],
    // The silent one: a cold anchor moves NO other field in the observation.
    required: (s) => s.anchorCold,
    wanted: (s) => s.holdsClaim,
    because: 'every anchor of yours is hot and collecting',
  },

  // ── §11C · syndicates. The only place you can be ruined by something entirely legal.
  {
    section: S11C,
    block: null,
    verbs: [],
    wanted: (s) => s.inSyndicate,
    because: 'you sit in no syndicate and no syndicate verb is offered to you',
  },
  {
    section: S11C,
    block: '### Founding one — `form` `{"name":"...", ...}`',
    verbs: ['form'],
    because: '`form` is not offered to you this wake',
  },
  {
    section: S11C,
    block: '### Joining — `apply` `{"syndicate":"<id>"}` · `admit` `{"syndicate":"<id>","principal":"<who>"}`',
    verbs: ['apply', 'admit'],
    because: 'neither `apply` nor `admit` is offered to you this wake',
  },
  {
    section: S11C,
    block: '### Leaving costs a Reckoning of notice',
    verbs: ['withdraw'],
    wanted: (s) => s.inSyndicate,
    because: 'you sit in no syndicate to give notice on',
  },
  {
    section: S11C,
    block: '### OFFICES — `grant` with `on_behalf_of`',
    verbs: ['approve'],
    wanted: (s) => s.inSyndicate,
    because: 'no office vote is open to you',
  },

  // ── §11D · predation. Weather versus a demand somebody owns, and telling them apart is
  //    the whole section. A8 makes hostile action in the Commons INVALID, so this is
  //    reachable exactly when a member is outside it.
  {
    section: S11D,
    block: null,
    verbs: [],
    required: (s) => s.underRaid,
    wanted: (s) => s.outsideCommons,
    because: 'nothing stands against you, and inside the Commons hostile action is INVALID rather than merely rare',
  },
  {
    section: S11D,
    block: '### Answering either one — `yield` · `fight` · join, or say nothing',
    verbs: ['yield', 'fight', 'join'],
    required: (s) => s.underRaid,
    because: 'no raid or demand stands against you',
  },
  {
    section: S11D,
    block: '### Opening one — `demand`',
    verbs: ['demand'],
    because: '`demand` is not offered to you this wake',
  },
  // ── §9A's COMBAT LAYER, SPLIT ACROSS THE UNIT KINDS IT ACTUALLY SPANS ──────
  //
  // It arrived as one drafted passage claiming `engage`, and pasting it as one block would have
  // been the `##`-granularity mistake at a smaller scale: the phase timetable is machinery a
  // member needs whenever it is IN a battle, the JSON is verb rules, and `withdraw_below_bps` is
  // the A3 stop condition that makes a battle survivable while offline. Three different triggers.
  //
  // The fourth part of that passage — a hull is destroyed permanently and the HAND is not — is
  // not here at all. It went to §3 (FLOOR), by §11A's argument: a member that misunderstands
  // whether losing a battle costs it a hand has the wrong model of its own CAPACITY, and that is
  // a position error rather than a missed option.
  {
    section: S11D,
    block: '### A refused demand becomes a BATTLE — the five phases',
    verbs: ['engage'],
    // MUSTER is 6 ticks of a 24-tick window and the only phase a hull may be committed in. A
    // party to a live battle that has not been given the timetable cannot know that, and the
    // window closes whether or not it was told.
    required: (s) => s.inBattle,
    because: 'no battle you are a party to is live, and `engage` is not offered to you',
  },
  {
    section: S11D,
    block: '### Committing a hull — `engage`',
    verbs: ['engage'],
    because: '`engage` is not offered to you this wake',
  },
  {
    section: S11D,
    block: '### `withdraw_below_bps` is a STOP CONDITION, not an act',
    verbs: ['engage'],
    // A3, and the reason it is `required` rather than `wanted`: this is the only field that lets
    // a formation survive a fight the member sleeps through, and the rule that it CANNOT save a
    // tackled formation is a loss it would otherwise not see coming.
    required: (s) => s.inBattle,
    because: 'you have no formation in a live battle to set a threshold on',
  },


  // ── §12 ───────────────────────────────────────────────────────────────────
  { section: S12, block: null, floor: true, verbs: [], because: 'floor' },
]);

/**
 * Every `##` heading the catalog names, in document order.
 *
 * Kept as its own export because it is what the scar-#1 tests read: *"every section it asks
 * for exists in `agent.md`, verbatim"*. Selection changes which units of these ship on a
 * wake; it never changes which of them must exist.
 */
export const CONTRACT_SECTIONS: readonly string[] = Object.freeze([
  ...new Set(CONTRACT_CATALOG.map((unit) => unit.section)),
]);

/**
 * Sections of `agent.md` the cast is never shown, each with the reason — **and the prompt
 * prints this list.**
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * This list held §11B, §11C and §11D, and with them the only rules for nine live verbs. That
 * was a silent hole recorded in two test comments with a shrug (*"which costs the cast
 * contract nothing"*) — the sign was wrong, because the house cast reads only the excerpt.
 * `###` granularity closed it: all three are now in {@link CONTRACT_CATALOG}, block by block,
 * and every live verb's rules are reachable.
 *
 * What remains are the three that are **not about size**. Each is a genuine "you cannot use
 * this" rather than "it did not fit", which is why the list is now short and should stay that
 * way: an entry here for a reason that is really the budget is the shrug coming back.
 * ══════════════════════════════════════════════════════════════════════════════
 */
export const CONTRACT_NOT_EXCERPTED: readonly {
  readonly heading: string;
  readonly because: string;
  /**
   * Live verbs whose ONLY rules are in this section. **Zero, now** — `prompt.test.ts` asserts
   * every verb the engine implements is claimed by {@link CONTRACT_CATALOG}, so a non-empty
   * list here is a mechanic shipping with rules no player can read.
   */
  readonly verbs: readonly string[];
}[] = Object.freeze([
  { heading: '## 2. Enrolling', because: 'you were seated at boot and never enrol', verbs: [] },
  { heading: '## 9. Being offline', because: 'you run in-process and are never offline', verbs: [] },
  {
    heading: '## 13. When something seems wrong',
    because: 'it is a bug-report channel you cannot reach from a plan',
    verbs: [],
  },
]);

/**
 * The situation that needs everything — what {@link loadContract} selects for when there is
 * no observation to read, and the analytic ceiling of the catalog.
 *
 * Not a default for the live path, and **not reachable**: `graduate` and `holdsClaim` cannot
 * both hold (a claim anchors the body, so `observe` withholds the crossing). It exists so
 * "the whole catalog" is expressible in the same terms as any other wake rather than as a
 * second code path that could disagree with the first, and so the ceiling has a number.
 */
export const EVERY_SITUATION: ContractSituation = Object.freeze({
  verbs: new Set(CONTRACT_CATALOG.flatMap((unit) => [...unit.verbs])),
  inCommons: true,
  commonsBound: true,
  outsideCommons: true,
  inVenture: true,
  holdsGrant: true,
  inSyndicate: true,
  holdsClaim: true,
  inArrears: true,
  anchorCold: true,
  underRaid: true,
  inBattle: true,
  holdsWorks: true,
  canBuildWorks: true,
  endowmentWithheld: true,
});

/**
 * Verbs a claimant in trouble is not offered, each for a reason in the ENGINE.
 *
 * A position padded with verbs a member cannot hold is the ceiling wearing a name, and that is
 * what made the `##` version's arithmetic wrong.
 */
const CLAIMANT_CANNOT_HOLD: ReadonlySet<string> = new Set([
  // A claim anchors the body, so `observe` withholds the crossing (INV-8, and
  // `crossing.anchoring.length === 0` in `observe.ts`).
  'graduate',
  // Offered only when `your_side === null`; a raid standing against it makes it a side, and
  // `yield`/`fight` are its answers instead.
  'join',
  // Needs aggression capacity AND a target. A principal in arrears under raid opening one of
  // its own is a different position, not this one.
  'demand',
  // It already sits in a house; founding a second is a different position.
  'form',
  // Needs a syndicate it is NOT in whose charter admits applications.
  'apply',
  // Needs a pending application to its own.
  'admit',
]);

/** Nothing held, nothing offered. The other end of the range. */
export const NO_SITUATION: ContractSituation = Object.freeze({
  verbs: new Set<string>(),
  inCommons: false,
  commonsBound: false,
  outsideCommons: false,
  inVenture: false,
  holdsGrant: false,
  inSyndicate: false,
  holdsClaim: false,
  inArrears: false,
  anchorCold: false,
  underRaid: false,
  inBattle: false,
  holdsWorks: false,
  canBuildWorks: false,
  endowmentWithheld: false,
});

/**
 * The named positions a principal can occupy, each **maximal** for its position.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * **WHY POSITIONS AND NOT 2^n OVER THE UNITS.**
 *
 * At `##` granularity there were three conditionals, so eight reachable excerpts and exhaustion
 * was free. At `###` granularity there are fifty-three: 2^53 is not enumerable, and it
 * would be the wrong space anyway. Most of those combinations are not reachable — that is what
 * bit the `##` version, whose worst "combination" included §11 *and* the whole of §11B, a pair
 * no principal can be in.
 *
 * Selection is **monotone**: adding an offered verb or a standing fact never removes a unit. So
 * the worst excerpt over any set of wakes is the excerpt for the position that dominates them
 * all, and enumerating the maximal positions is exact rather than a sample. `prompt.test.ts`
 * does both halves:
 *
 *   1. every position's excerpt is measured, and the budget assertion names the position;
 *   2. a real world is swept and **every observed situation must be dominated by one of these**
 *      — so a position list that has gone stale fails by name instead of quietly narrowing
 *      what the budget was checked against.
 *
 * The exclusions the numbers depend on are engine-enforced, not assumed: `graduate` is withheld
 * from a principal whose body anchors a claim (`observe.ts`, `crossing.anchoring.length === 0`,
 * INV-8), and A8 makes hostile action inside the Commons *invalid*, so no Commons wake carries a
 * raid. Both are asserted in `prompt.test.ts` against a real observation.
 * ══════════════════════════════════════════════════════════════════════════════
 */
export const CONTRACT_POSITIONS: readonly {
  readonly name: string;
  readonly situation: ContractSituation;
  /**
   * Whether the position is one a principal can actually occupy.
   *
   * ── THIS FIELD USED TO MEAN "FITS UNDER THE BAR", AND NOW NOTHING DOES ─────
   *
   * At a 38,000 bar two positions did not fit — the fully-developed claimant at **43,789** and
   * the analytic ceiling at **51,289** — and this flag marked them so the tests could assert
   * that they *overshot honestly* rather than that they fitted. Since `MAX_CONTRACT_CHARS` was
   * raised above the analytic maximum, **every position fits**, and `prompt.test.ts` asserts
   * `overBudget === false` for all of them without exception. That is the point of the raise:
   * an overshoot should be anomalous, not the normal state of the most advanced member.
   *
   * So the flag now records the thing that is still worth distinguishing and cannot be derived
   * from a size — whether the position is *reachable*. The ceiling is not: a claim anchors the
   * body, so `observe` withholds the crossing, and no principal is ever offered `graduate` and
   * holding territory at once. A budget checked only against unreachable maxima would be
   * checking the wrong thing, which is precisely the error the `##` version made.
   */
  readonly reachable: boolean;
}[] = Object.freeze([
  {
    name: 'a newcomer on its first wake — Commons, no venture, no grant, nothing held',
    reachable: true,
    situation: {
      ...NO_SITUATION,
      inCommons: true,
      commonsBound: true,
      canBuildWorks: true,
      verbs: new Set(['create', 'publish_offer', 'message', 'graduate', 'move', 'build', 'form']),
    },
  },
  {
    name: 'mid-game in the Commons — ventures, a WORKS, no grant, no claim',
    reachable: true,
    situation: {
      ...NO_SITUATION,
      inCommons: true,
      commonsBound: true,
      inVenture: true,
      holdsWorks: true,
      canBuildWorks: true,
      verbs: new Set([
        'create', 'publish_offer', 'message', 'elect', 'fill_role', 'sign', 'seal',
        'graduate', 'move', 'build', 'refine', 'form', 'apply', 'deliver', 'vote',
      ]),
    },
  },
  {
    name: 'about to take territory — graduated, offered `post_bond`, holds no claim yet',
    reachable: true,
    situation: {
      ...NO_SITUATION,
      outsideCommons: true,
      inVenture: true,
      holdsWorks: true,
      canBuildWorks: true,
      verbs: new Set([
        'create', 'publish_offer', 'message', 'elect', 'seal', 'move', 'build', 'refine',
        'post_bond', 'deliver', 'vote', 'graduate',
      ]),
    },
  },
  {
    name: 'a claimant in trouble — arrears, a cold anchor, a grant, a syndicate, a raid standing',
    // 47,246 characters, and every one of them is a rule this member can be refused for not
    // knowing. It is the largest REACHABLE position, so it is the one the ceiling margin is
    // measured against — it overshot a 38,000 bar on every wake for ever, which is the cry-wolf
    // argument that raised the ceiling. See MAX_CONTRACT_CHARS.
    reachable: true,
    situation: {
      ...EVERY_SITUATION,
      inCommons: false,
      commonsBound: false,
      // See CLAIMANT_CANNOT_HOLD: six verbs come off, each for a reason in the engine.
      verbs: new Set(
        [...EVERY_SITUATION.verbs].filter(
          (verb) => !CLAIMANT_CANNOT_HOLD.has(verb),
        ),
      ),
    },
  },
  {
    name: 'the analytic ceiling — every fact and every verb at once, which no principal can be',
    // NOT reachable, and that is what the flag is for now: `graduate` and a held claim cannot
    // coexist, so nothing in the world is ever this. It is here to give the maximum a number —
    // 54,746, which MAX_CONTRACT_CHARS must clear, though the MARGIN is measured against the
    // reachable maximum above, because that is where cry-wolf would bite.
    reachable: false,
    situation: EVERY_SITUATION,
  },
]);

/**
 * Ceiling on the contract excerpt, and what it disciplines. *(calibrate)*
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * **72,000, AND IT SITS ABOVE THE UNREACHABLE ANALYTIC MAXIMUM ON PURPOSE.**
 *
 * The whole catalog, every fact and every verb at once — a state no principal can occupy,
 * because a claim anchors the body and `observe` withholds the crossing — measures **64,233**
 * characters uncapped, and the largest position a principal can actually be in measures
 * **56,647**. This number is deliberately above both. So `overBudget` now means *"something is
 * larger than the rules can be"* and not *"a successful player exists"*.
 *
 * ── WHY THE OLD BAR WAS RIGHT WHEN IT WAS SET, WHICH IS THE POINT ────────────
 *
 * Read this before treating the raise as three arguments finally wearing a limit down. It is
 * not. **The correctness property underneath the number changed.**
 *
 * At `##` granularity, going over budget meant the excerpt **silently truncated** — whole
 * sections fell off the end of a rulebook the cast then played from, disclosed only in a field
 * nothing was required to read. That is scar #1's class exactly, and against that failure mode
 * a hard bar well under the cliff was the correct instrument. 26k → 32k → 40k were each raised
 * to buy room *away from a cliff*, and each raise restored the cliff a bit further out.
 *
 * {@link CONTRACT_CATALOG} removed the cliff instead of moving it: FLOOR and RULES are emitted
 * whatever the total, so a needed rule cannot be lost to length at any ceiling. **That** is
 * what earned the raise, and it is the load-bearing precondition:
 *
 *   ⚠ **THIS NUMBER MAY ONLY BE THIS HIGH WHILE RULES-NEVER-DROP HOLDS.** If `excerptFor` is
 *   ever changed to let the budget touch a FLOOR or RULES unit, this ceiling becomes a silent
 *   truncation point again and has to come back down below the smallest reachable position.
 *   The two are one decision. Reverting either requires revisiting the other.
 *
 *   The coupling is executable rather than remembered, and **the 56,000 → 72,000 raise widened
 *   the gap it has to cover, so it is worth naming where it is enforced**: `prompt.test.ts`'s
 *   *"under an absurd cap through `loadContract`, CONTEXT goes and the RULES DO NOT"* and
 *   *"★ THE OVERSHOOT PATH STILL WORKS, and still loses only CONTEXT"* both drive `excerptFor`
 *   at a 4,000-character cap — two orders of magnitude below this ceiling — and assert that
 *   nothing FLOOR or RULES is in `dropped`. Those two tests are the precondition. A change that
 *   makes either of them go red has revoked the licence for this number, and the number must
 *   come down in the same commit rather than the tests being relaxed.
 *
 * ── WHY IT HAD TO MOVE AT ALL, WHICH IS NOT COST ─────────────────────────────
 *
 * Cost is a rounding error at every value it has taken: the cached-input rate is $0.10/M
 * (`budget.ts:cachedInputMicrosPerMillion`), so the whole 72,000-character prefix is ≈18k tokens
 * ≈ $0.0018 a call cached, and **the 16,000 characters this raise added cost ≈$0.0004 a call** —
 * against a cast budget that has spent $0.24 of its $5.00 cap. That is an argument for not
 * worrying about the number, never an argument for a particular one.
 *
 * The argument that decides it is the one this project learned twice in a week from a different
 * alarm. `GET /health` returned 503 continuously on `deciding_share_bps` for a condition the
 * code itself documented as structural, and the lesson recorded on that fix is: *"a signal that
 * is red while nothing is broken stops being read, which is how scar #14b wins twice — first by
 * hiding a fallback, then by making the detector cry wolf until somebody silences it."*
 *
 * `overBudget` was on exactly that path. A fully-developed claimant — arrears, a cold anchor, a
 * grant, a syndicate, a raid standing — is a **legitimate, intended, reachable** position, and
 * it needs **47,246** characters of rules it can be refused for not knowing. At a 38,000 bar the
 * most advanced member in the world would report `overBudget` on every wake for ever, and the
 * signal would be noise long before it caught a real defect. A detector that fires on success is
 * worse than a number that is slightly wrong.
 *
 * ── WHAT A BIGGER BUDGET MUST NOT ABSORB ─────────────────────────────────────
 *
 * {@link CONTRACT_NOT_EXCERPTED} stays at **three**, and all three are there for a *capability*
 * reason — you cannot enrol, you are never offline, you cannot file a bug report from a plan —
 * never for a size reason. A member that cannot act on a rule should still not be charged for
 * reading it, and room is not a licence to stop asking whether a section is usable.
 * `prompt.test.ts` asserts the count and that no reason is about fitting.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ## Why it moved from 26k to 32k
 *
 * 26k was described as "slack rather than a working limit" against sections totalling about
 * 22k. It was neither by the time WORKS landed: the excerpt measured **25,936** characters, so
 * adding §11A silently pushed the economy's only goods source out of the cast's rulebook. It
 * was *disclosed* in `dropped`, which is the design working — but a cast that cannot read
 * where goods come from will watch its Levy shortfall rise every Reckoning with no idea what
 * to do, which is the same reachability failure as a verb that is legal and never offered.
 *
 * The bill barely moves, and that is why raising it is the right answer rather than trimming.
 * The contract is the **stable prefix** of every cast prompt, so it is cached input at a tenth
 * of fresh-input price; more characters cost roughly $0.10/M of cached tokens. The ceiling still
 * does its real job — a section that grows tenfold cannot decuple the bill — because this is a
 * ceiling on the *whole excerpt*, not a per-section allowance.
 *
 * ## 32k → 40k, and the second raise is itself the finding
 *
 * The headroom assertion in `prompt.test.ts` caught this at **30,821 of 32,000** when §11C
 * (syndicates) and the assurance-timing paragraph landed — before anything was dropped, which is
 * what that assertion exists for. Raised again on the same cost reasoning.
 *
 * **But twice is a pattern, and the honest reading is that the contract is the wrong shape.** The
 * cast is handed the *whole* player document because scar #1 says it must prompt from the real
 * rules surface and never a private paraphrase — and that was exactly right when `agent.md` was
 * 300 lines. It is now approaching 800 and every system added grows it. Raising the ceiling a
 * third time would be avoiding the question.
 *
 * The question to answer then, and it is a real design decision rather than a tuning knob: does a
 * cast member need every section every wake, or does it need the sections its *current situation*
 * touches — with the selection derived from the observation rather than hand-curated, so it is
 * still the real document and never a paraphrase? A Commons newcomer does not need the Charge; a
 * claimant in arrears does not need the enrolment playbook. That is a projection, not a summary,
 * and it keeps scar #1's guarantee while bounding the prefix.
 *
 * ## 40k held while the question above got ANSWERED — {@link CONTRACT_CATALOG}
 *
 * The ceiling did not move a third time on cost grounds. The excerpt moved instead, twice: first
 * by `##` section, and then — because that freed too little and left nine verbs unreadable — by
 * `###` block. Only after that did the number change, and for the reason in the header note.
 *
 * **What this number governs is CONTEXT, not the excerpt.** FLOOR and RULES ship whatever the
 * total, because "a needed rule is never dropped" has to be true by construction and not by the
 * numbers happening to fit; this is the ceiling on discretionary `wanted` blocks. Same trade
 * `projectObservation` makes one field over. An overshoot sets `overBudget`, is printed in the
 * prompt, and fails `prompt.test.ts` naming the position — so it can never be the silent cliff
 * the bar used to exist to prevent, and above 61,693 it should now be genuinely anomalous.
 *
 * ## 56k → 72k, because the budget had reached ZERO and was pricing features again
 *
 * ── THE MEASUREMENT THAT FORCED IT ───────────────────────────────────────────
 *
 * At 56,000 the slack was gone, exactly, and the table in `prompt.test.ts` said so:
 *
 *   - largest **reachable** position **51,867** of the 52,000 the margin allows → **133 characters**;
 *     (it is **56,647** now: `deliver {payer}`'s rules text added +2,240 to every position and the role
 *     `stake` block added +2,540 to every position that holds a role, both spent out of exactly the
 *     slack this raise created — see `prompt.test.ts`'s measured table.)
 *   - **analytic** ceiling **55,996** of 56,000 → **4 characters**.
 *
 * Three features in a row then paid for their own rules text by trimming. The currency door for a
 * first WORKS is the one written up above the table: three drafts, 2,346 → 800 → **304** characters,
 * the field name `paying_goods_in_currency` dropped from the prose to make the sentence fit, and the
 * author's own note that "the answer to *can I add a sentence* is now **no**". A ceiling that makes
 * an author rewrite a rule three times for length is not disciplining the document any more — it is
 * **charging new mechanics rent in rules text**, and the thing that gets cut is always prose a
 * player can be refused for not having read.
 *
 * ── WHAT MAKES THE RAISE PERMISSIBLE, AND IT IS NOT THE INCONVENIENCE ────────
 *
 * The same precondition as the last one, unchanged and now spelled out where it is enforced: the
 * bar existed to prevent **silent truncation**, and silent truncation can no longer happen. FLOOR
 * and RULES are emitted whatever the total, an overshoot sets `overBudget`, `overBudget` prints in
 * the prompt, and a named test fails. See the ⚠ above for the two tests that hold it up. **The
 * raise is legitimate only while that holds**; it is one decision with this number, not two.
 *
 * ── WHY 72,000 AND NOT 60,000 ────────────────────────────────────────────────
 *
 * Because 60,000 would buy one feature and then this paragraph would be written a fifth time.
 * 72,000 leaves **16,004** characters above the 55,996 the analytic ceiling costs at the old bar
 * (**10,307** above the 61,693 it costs uncapped, which is what it now emits), and **17,893** above
 * the largest reachable position. That is several features of headroom rather than one.
 *
 * And the principle the number serves is the one that has already had to be enforced once
 * elsewhere in this repo: **`overBudget` must mean "something is larger than the rules can be",
 * never "a successful player exists".** A signal that fires on a legitimate position is the
 * `deciding_share_bps` failure — a `/health` 503 that was red for a structural condition until
 * somebody had to silence it. At 133 characters of slack the most advanced member in the world was
 * four sentences from setting the alarm on every wake, which is that failure arriving on schedule.
 *
 * `CONTRACT_POSITIONS` carries the measured table and is the thing to read before adding a
 * section, because it is executable and this comment is not.
 *
 * ── 72,000 → 120,000, AND WHY THE LAST TWO ESTIMATES WERE BOTH WRONG ─────────
 *
 * The paragraph above promised 72,000 was *"several features of headroom rather than one"*. It
 * bought **three** — combat's §9A, the market's endowment rules, and the goods floor — and the
 * analytic margin fell 16,004 → **662**. The estimate before it made the same promise at 56,000 and
 * bought two. So the failure is not the number; it is the *method*: each author measures the margin
 * against their own feature and cannot see the two landing beside them, so every raise is spent by
 * concurrent work before the next author reads this comment.
 *
 * That makes this a **shared scalar with no arbiter**, exactly like `RULES_VERSION` — where two
 * agents each claimed the next integer, both deployed, and the live record briefly carried two rule
 * sets stamped `10`. The fix there was that the owner pre-assigns the integer. The fix here is the
 * same shape: **the owner sets this number and allocates per-feature character quotas from it**, and
 * an author who cannot fit inside a quota reports the measurement instead of trimming a rule or
 * moving the bar. Both of those were tried; the first cost an agent a rule it needed, and the second
 * is why this paragraph exists twice.
 *
 * 120,000 is sized against the **whole remaining queue** rather than the next feature — coalitions,
 * campaigns, compartmented authority, chokepoints, the risk market — at a measured ~600–2,500
 * characters each, plus the 4,000 margin, plus room for the estimate to be wrong a third time.
 *
 * The precondition is unchanged and still the only thing that makes any of this legitimate: **FLOOR
 * and RULES are emitted whatever the total**, so an overshoot is loud and never silent. Revert that
 * and this number must come back down with it.
 *
 * Cost, so it is not hand-waved: ~30k tokens on a fully-developed claimant's wake, against a cast
 * spending $0.24 of a $5.00 per-Reckoning cap with the floor-first ordering keeping ~21,000
 * characters a byte-identical cacheable prefix. The budget was never the binding constraint here;
 * silent truncation was, and that is what got fixed rather than priced.
 */
export const MAX_CONTRACT_CHARS = 120_000;

/**
 * How far {@link MAX_CONTRACT_CHARS} must stay above the analytic maximum of the catalog.
 *
 * The margin is the whole mechanism, not padding: `overBudget` is only a useful signal while the
 * largest excerpt a real member can be shown is comfortably under the ceiling. Let this close to
 * zero and the alarm starts firing on legitimate play again, which is the failure the raise was
 * for. `prompt.test.ts` measures it and fails if the gap shrinks past this — so growing
 * `agent.md` by more than the slack is a decision somebody makes on purpose.
 *
 * ── MEASURED AGAINST THE REACHABLE MAXIMUM, NOT THE ANALYTIC ONE ─────────────
 *
 * A subtlety worth stating, because getting it wrong is how a margin becomes decoration. The
 * *analytic* maximum — {@link EVERY_SITUATION}, every fact and verb at once — is **54,746**, and
 * it clears 56,000 by only 1,254. But nothing in the world is ever that: `graduate` and a held
 * claim cannot coexist. The largest position a principal can actually occupy is the
 * fully-developed claimant at **47,246**, which clears by **8,754**.
 *
 * The cry-wolf failure is `overBudget` firing on legitimate play, so the margin that matters is
 * the reachable one. The analytic maximum only has to *fit*, which it does. Both are asserted.
 *
 * (The two figures were 43,789 and 51,289 at a 38,000 ceiling and are 3,457 larger here, because
 * the CONTEXT the old budget squeezed out — §11A's rent and `### What to read` — now fits. A
 * ceiling that is not binding shows up as more rules delivered, not just as slack.)
 */
export const CONTRACT_CEILING_MARGIN = 4_000;

/** Characters of observation JSON in one prompt, before keys start being dropped. */
export const MAX_OBSERVATION_CHARS = 16_000;

/**
 * The order top-level observe keys are dropped in when the JSON will not fit.
 *
 * Published, ordered, and **counted in the prompt**, in the same spirit as `observe`'s
 * own `header.withheld`: PROP-O1 says truncation must never be silent, because from the
 * reader's side a silently missing option is indistinguishable from the world having
 * changed. The same rule applies when the reader is ours.
 *
 * `header`, `affordances`, `briefing` and `obligations` are **never** dropped: they are
 * the clock, the legal move set, the stated dilemma, and the thing that settles against
 * you tonight. A prompt without them is not a decision document.
 */
export const DROP_ORDER: readonly string[] = Object.freeze([
  'market',
  'counterparties',
  'grants',
  'holding',
  'hands',
  'ventures',
]);

/** A unit left out of a wake's excerpt, and why. Printed in the prompt. */
export interface ContractOmission {
  /** `## 11B. …` for a whole section, or `## 11B. … › ### Paying for it — the CHARGE`. */
  readonly heading: string;
  readonly because: string;
}

export interface ContractExcerpt {
  readonly text: string;
  /** `##` sections with at least one unit in the excerpt, in emission order. */
  readonly sections: readonly string[];
  /** Every unit included, as `section › block` (or just the section, for a preamble). */
  readonly units: readonly string[];
  /**
   * CONTEXT units that did not fit under {@link MAX_CONTRACT_CHARS}, each with its reason.
   *
   * A separate word from `notThisWake` on purpose: *did not fit* and *your situation does not
   * touch it* are two different facts and a reader has to tell them apart. One is a budget
   * problem; one is the design working. **No FLOOR or RULES unit can ever appear here** —
   * that is the guarantee, and `excerptFor` enforces it by never consulting the budget for
   * them.
   */
  readonly dropped: readonly ContractOmission[];
  /** Units this wake's situation does not touch, each with its reason. */
  readonly notThisWake: readonly ContractOmission[];
  /**
   * True when FLOOR + RULES alone exceeded the ceiling.
   *
   * The excerpt is still complete — nothing needed was dropped — and this says the budget was
   * the thing that gave. Loud on purpose: the prompt prints it and `prompt.test.ts` fails
   * naming the position, because "the rules got longer than the budget" is a fact somebody
   * has to decide about rather than one to discover from a bill.
   */
  readonly overBudget: boolean;
}

/**
 * `agent.md`, parsed to units and validated once.
 *
 * Split from the excerpt because the excerpt is per-wake: the document is read from disk once
 * at cast construction, and every wake selects from this. Re-reading a 63 KB file per member
 * per tick would be a filesystem call inside the tick, for no gain.
 */
export interface ContractDocument {
  /** `section` → (`block` heading or `''` for the preamble) → verbatim text. */
  readonly bodies: ReadonlyMap<string, ReadonlyMap<string, string>>;
}

/** The key a unit's text is stored under. `''` is the section's own preamble. */
function unitKey(unit: ContractUnit): string {
  return unit.block ?? '';
}

/** How a unit is named in `units`, `dropped` and the prompt. */
export function unitName(unit: ContractUnit): string {
  return unit.block === null ? unit.section : `${unit.section} › ${unit.block}`;
}

/**
 * Read `agent.md` and check that every unit the catalog names is still there.
 *
 * Resolved by the **same URL expression `server.ts` uses** (`../../agent.md` relative to the
 * module), so the compiled `dist/cast/prompt.js` and the source both land on `engine/agent.md`,
 * and the cast and the API can never be reading two different files.
 *
 * Returns `null` — and the caller disables the LLM cast — when the file cannot be read or when
 * **any** catalogued unit is missing, *including one no current wake needs*. See the module
 * note: a missing heading is a rules surface that moved, and the safe response is to stop, not
 * to guess.
 *
 * **`###` granularity triples what this tripwire watches**, and that is the cost of the
 * granularity rather than a flaw in it: a `###` heading carries verb names and prose and so
 * moves more often than a `##` number. It is the right direction to fail in. A renamed block
 * turns the LLM cast off and logs why; the alternative is prompting from a rulebook missing a
 * block nobody noticed.
 */
export function loadContractDocument(source?: string): ContractDocument | null {
  let raw: string;
  if (source !== undefined) {
    raw = source;
  } else {
    try {
      raw = readFileSync(new URL('../../agent.md', import.meta.url), 'utf8');
    } catch {
      return null;
    }
  }

  const bodies = new Map<string, Map<string, string>>();
  for (const chunk of raw.split(/\n(?=## )/)) {
    const section = (chunk.split('\n', 1)[0] ?? '').trim();
    const blocks = new Map<string, string>();
    const parts = chunk.trim().split(/\n(?=### )/);
    // Part 0 is the `##` heading plus everything before the first `###`. The heading travels
    // WITH the preamble and nowhere else, which is what makes "a block never ships without its
    // preamble" the same thing as "a block never ships without its section heading".
    blocks.set('', (parts[0] ?? '').trim());
    for (const part of parts.slice(1)) {
      blocks.set((part.split('\n', 1)[0] ?? '').trim(), part.trim());
    }
    bodies.set(section, blocks);
  }

  for (const unit of CONTRACT_CATALOG) {
    const blocks = bodies.get(unit.section);
    if (blocks === undefined) return null;
    const text = blocks.get(unitKey(unit));
    if (text === undefined || text.length === 0) return null;
  }
  return { bodies };
}

/**
 * Read the situation off one observation. The only input to selection.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * **EVERY PATH HERE IS ASSERTED AGAINST A REAL OBSERVATION, NOT A FIXTURE.**
 *
 * `situationalFocus` read a top-level `syndicates` key for its whole life. `observe` nests it
 * under `grants` — §17's ten-key budget is at its ceiling and the comment there says so — so
 * the condition was `undefined.length > 0` on every real observation and the line had **never
 * fired once in production**. Its test passed because the fixture put the key where the code
 * looked instead of where the engine puts it.
 *
 * That is the same defect class as four of the five bugs blind probes found last week, and a
 * predicate is a perfect place for it to hide: a wrong path reads as `false`, which reads as
 * "this member does not need that section", which reads as the design working. So
 * `prompt.test.ts` asserts every field below against `buildObservation`'s own output, and the
 * two that cannot be true at once for one member (`inCommons` and `outsideCommons`) are
 * asserted to disagree.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Typed loosely on purpose — it must not fall over on a partial observation
 * (`relations.spec.ts` builds a two-key stub). A missing key reads as "no", which is safe only
 * because {@link unitGrade} keys the guarantee on `affordances[]`, and a member with no
 * affordances has nothing to be refused for.
 */
export function readSituation(observation: Readonly<Record<string, unknown>>): ContractSituation {
  const obj = (value: unknown): Record<string, unknown> =>
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

  const holding = obj(observation['holding']);
  const grants = obj(observation['grants']);
  const ventures = obj(observation['ventures']);
  const obligations = obj(observation['obligations']);
  const works = obj(holding['works']);
  // `obligations.charge` is `myClaims` — one row per claim THIS principal holds, each with its
  // arrears, its deadline, its bond at risk and whether its anchor is hot.
  const claims = list(obligations['charge']).map(obj);
  const tier = String(holding['tier']);

  return {
    verbs: new Set(list(observation['affordances']).map((a) => String(obj(a)['verb']))),
    inCommons: tier === 'COMMONS',
    commonsBound: holding['commons_bound'] === true,
    // Not `!inCommons`: an observation with no `holding` at all must not read as "predation can
    // reach you", because that would ship §11D to a stub and, worse, read as a fact.
    outsideCommons: tier === 'MARCHES' || tier === 'FRONTIER',
    inVenture: list(ventures['mine']).length > 0,
    holdsGrant: list(grants['granted']).length > 0 || list(grants['held']).length > 0,
    inSyndicate: list(grants['syndicates']).length > 0,
    holdsClaim: claims.length > 0,
    inArrears: claims.some((claim) => Number(claim['arrears'] ?? 0) > 0),
    anchorCold: claims.some((claim) => claim['anchor_hot'] === false),
    underRaid: list(obligations['raid']).length > 0,
    // `obligations.battle`, adjacent to `raid` because a battle is what a raid row becomes when
    // its target answers FIGHT. Same block, different deadline.
    inBattle: list(obligations['battle']).length > 0,
    holdsWorks: list(works['held']).length > 0,
    canBuildWorks: obj(works['here'])['affordable'] === true,
    // Both halves, or this fires on every genuinely broke member and spends the excerpt on a
    // rule it cannot act on: a balance it holds, and none of it transferable.
    endowmentWithheld:
      Number(obj(obj(observation['market'])['endowment'])['balance_minor'] ?? 0) > 0 &&
      Number(obj(observation['market'])['transferable_minor'] ?? 0) <= 0,
  };
}

/**
 * What this wake owes this unit.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * **THE GUARANTEE IS THE SECOND CLAUSE AND IT LIVES HERE, NOT IN THE PREDICATES.**
 *
 * A unit one of whose `verbs` is offered in `affordances[]` is `RULES` — checked before any
 * per-unit predicate, and `RULES` is never dropped for any reason including length. That
 * ordering is the whole safety argument: an agent is refused for breaking a rule it was given,
 * never for one it was not. There are fifty-three units; put the same rule inside each
 * predicate and the forty-fifth will forget it.
 * ══════════════════════════════════════════════════════════════════════════════
 */
export function unitGrade(unit: ContractUnit, situation: ContractSituation): UnitGrade {
  if (unit.floor === true) return 'FLOOR';
  for (const verb of unit.verbs) {
    if (situation.verbs.has(verb)) return 'RULES';
  }
  if (unit.required?.(situation) === true) return 'RULES';
  if (unit.wanted?.(situation) === true) return 'CONTEXT';
  return 'NO';
}

/**
 * Cut the excerpt for one wake.
 *
 * ── FOUR RULES, IN THIS ORDER ────────────────────────────────────────────────
 *
 * 1. **A block never ships without its section's preamble.** The `##` heading lives in the
 *    preamble, so a block without it is prose with no name on it. Structural, not a predicate.
 * 2. **Units of one section stay contiguous and in document order.** A `### Paying for it`
 *    emitted three sections away from `## 11B.` is a rule with its framing removed, which is
 *    nearer scar #1 than omitting it.
 * 3. **FLOOR-only sections first, then the rest in document order.** A provider that discounts
 *    a repeated prefix needs the front of the message to be identical for every member; the
 *    six sections whose every unit is FLOOR are exactly that, and they come first. This is
 *    weaker than it was at `##` granularity (11,527 characters rather than 20,976) because
 *    §8 and §11A now have variable tails, and that is the price of the granularity — paid
 *    knowingly, because the alternative was trading rules prose against a ceiling.
 * 4. **The budget is spent on CONTEXT only.** FLOOR and RULES are emitted whatever the total,
 *    and `overBudget` says when that overran. See {@link MAX_CONTRACT_CHARS}.
 */
export function excerptFor(
  document: ContractDocument,
  situation: ContractSituation,
  maxChars: number = MAX_CONTRACT_CHARS,
): ContractExcerpt {
  const graded = CONTRACT_CATALOG.map((unit) => ({ unit, grade: unitGrade(unit, situation) }));
  const lengthOf = (unit: ContractUnit): number =>
    document.bodies.get(unit.section)?.get(unitKey(unit))?.length ?? 0;

  // RULE 1. A section with any unit in it needs its preamble, at the strongest grade present.
  const strongest = new Map<string, UnitGrade>();
  for (const { unit, grade } of graded) {
    if (grade === 'NO') continue;
    const held = strongest.get(unit.section);
    if (held === undefined || grade === 'FLOOR' || (grade === 'RULES' && held === 'CONTEXT')) {
      strongest.set(unit.section, grade === 'FLOOR' ? 'FLOOR' : grade);
    }
  }
  for (const row of graded) {
    if (row.unit.block !== null) continue;
    const carried = strongest.get(row.unit.section);
    if (carried === undefined) continue;
    if (row.grade === 'NO' || (row.grade === 'CONTEXT' && carried === 'RULES')) {
      row.grade = carried === 'FLOOR' ? 'FLOOR' : 'RULES';
    }
  }

  // RULE 3. FLOOR-only sections first, then document order.
  const sectionOrder = [...CONTRACT_SECTIONS];
  const floorOnly = new Set(
    sectionOrder.filter((section) =>
      CONTRACT_CATALOG.filter((u) => u.section === section).every((u) => u.floor === true),
    ),
  );
  const emissionOrder = [
    ...sectionOrder.filter((s) => floorOnly.has(s)),
    ...sectionOrder.filter((s) => !floorOnly.has(s)),
  ];

  // RULE 4. Price the mandatory half first; CONTEXT then fills what is left.
  const mandatory = graded.filter((r) => r.grade === 'FLOOR' || r.grade === 'RULES');
  let spent = mandatory.reduce((n, r) => n + lengthOf(r.unit), 0) + Math.max(0, mandatory.length - 1) * 2;

  const dropped: ContractOmission[] = [];
  const keep = new Set<ContractUnit>(mandatory.map((r) => r.unit));
  for (const { unit, grade } of graded) {
    if (grade !== 'CONTEXT') continue;
    const cost = lengthOf(unit) + 2;
    if (spent + cost > maxChars) {
      dropped.push({ heading: unitName(unit), because: `${unit.because}, and it did not fit` });
      continue;
    }
    spent += cost;
    keep.add(unit);
  }

  // RULE 2 + emission.
  const parts: string[] = [];
  const units: string[] = [];
  const sections: string[] = [];
  for (const section of emissionOrder) {
    const chosen = CONTRACT_CATALOG.filter((u) => u.section === section && keep.has(u));
    if (chosen.length === 0) continue;
    sections.push(section);
    for (const unit of chosen) {
      units.push(unitName(unit));
      parts.push(document.bodies.get(section)?.get(unitKey(unit)) ?? '');
    }
  }

  const notThisWake = graded
    .filter((r) => r.grade === 'NO')
    .map((r) => ({ heading: unitName(r.unit), because: r.unit.because }));

  const text = parts.join('\n\n');
  return { text, sections, units, dropped, notThisWake, overBudget: text.length > maxChars };
}

/**
 * The whole catalog, for a caller with no observation to select from.
 *
 * The analytic **ceiling**, not what any live wake ships, and not even reachable — see
 * {@link EVERY_SITUATION}. `llm.ts` selects per wake through {@link excerptFor}.
 */
export function loadContract(
  source?: string,
  maxChars: number = MAX_CONTRACT_CHARS,
): ContractExcerpt | null {
  const document = loadContractDocument(source);
  if (document === null) return null;
  return excerptFor(document, EVERY_SITUATION, maxChars);
}

/**
 * The reply schema, stated once.
 *
 * Exported because `parse.ts` enforces exactly this and `test/cast/prompt.test.ts`
 * asserts the two agree. A schema described in the prompt and enforced somewhere else is
 * two rules surfaces again, at a smaller scale.
 */
export const REPLY_SCHEMA = `{
  "note": "<= 200 characters: why, in your own voice. Never shown to other agents.",
  "plan": [ { "verb": "<one of the verbs above>", "params": { } } ]
}`;

export interface PromptInput {
  readonly contract: ContractExcerpt;
  readonly character: CastCharacter;
  readonly observation: Observation;
  /** Rendered by {@link CastMemory.render}. */
  readonly memory: string;
  /** Verbs this runtime actually implements — read off the engine, never restated. */
  readonly liveVerbs: readonly string[];
  /**
   * Who this member has dealt with and how it went. Derived from the record by
   * `Runtime.relationsFor`, never stored — a wound is a DEFAULT that already happened, and A5
   * makes it permanent, so the journal IS the memory.
   */
  readonly relations?: readonly {
    readonly other: string;
    readonly kept: number;
    readonly broke: number;
    readonly youKept: number;
    readonly youBroke: number;
  }[];
  /** How many actions one reply may plan. They are submitted one per tick, in order. */
  readonly planMax: number;
  readonly maxObservationChars?: number;
}

export interface BuiltPrompt {
  readonly messages: readonly CompletionMessage[];
  /** Total characters sent. The budget charges on this before the call is made. */
  readonly chars: number;
  /** Observation keys omitted to fit, if any. Named in the prompt as well as here. */
  readonly omittedKeys: readonly string[];
}

/**
 * Build the three messages.
 *
 * The order is load-bearing for cost as well as clarity: message 0 opens with a
 * **20,976-character floor that is byte-identical for every member on every wake**, so a
 * provider that discounts a repeated prefix can. The budget never assumes that discount —
 * it prices every call at full rate — but there is no reason to make the saving impossible.
 */

/**
 * Which contract sections this wake actually touches, named in the USER message.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * **THE COST OBJECTION THAT USED TO BE WRITTEN HERE, AND WHY IT NO LONGER DECIDES.**
 *
 * Raising `MAX_CONTRACT_CHARS` twice made me write down that the contract "is the wrong
 * shape" and should be projected per situation. Then I checked the arithmetic and argued the
 * opposite here: the contract is the first system message and byte-identical for every
 * member, so it is one shared cached prefix — 40,000 characters is ≈10k tokens ≈ $0.001 a
 * call cached against ~$0.25/hour of total spend, a rounding error — and a per-situation
 * projection would break that, trading a rounding error for real cache misses.
 *
 * **The money half of that was right and it was never the binding constraint.** The excerpt
 * reached 37,902 of a 38,000 bar, and the two changes before this one each paid for it in
 * *content*: one compressed a verbatim sovereignty statement to a numbers check, the other
 * tightened two paragraphs with the commit message *"because the cast contract is nearly
 * full"*. Rules prose was being traded away to stay under a ceiling that costs a tenth of a
 * cent. That is the wrong thing to be economising on, and no amount of cache efficiency
 * makes it right.
 *
 * So {@link CONTRACT_CATALOG} selects, and the cache objection is answered rather than
 * ignored: the floor is emitted first, in one order for everybody, so 20,976 characters stay
 * a byte-identical shared prefix — five times what document order would have left. There are
 * eight reachable variants and a twelve-member cast clusters into two or three, so the tail
 * warms as well.
 *
 * **This function is unchanged in purpose and is still worth its space.** The remaining risk
 * over 20,000 characters is attention, not money — a rule that matters this tick lost in the
 * middle of a document that also explains three systems the member is not touching. The
 * excerpt no longer *contains* those three; the focus block still says which of the ones it
 * does contain the member is standing in, from the *user* message, which is per-member and
 * uncached either way.
 *
 * Derived from the observation, never hand-curated — so it stays a pointer INTO the real
 * document rather than a paraphrase of it, which is what scar #1 forbids. Every `§` it cites
 * resolves to a real heading, in the excerpt or in {@link CONTRACT_NOT_EXCERPTED}, and
 * `buildPrompt` marks the ones that are not in this wake's excerpt so the pointer is never
 * aimed at text the member was not given. `prompt.test.ts` asserts that.
 * ══════════════════════════════════════════════════════════════════════════════
 */
export function situationalFocus(observation: Readonly<Record<string, unknown>>): readonly string[] {
  const focus: string[] = [];
  const holding = (observation['holding'] ?? {}) as Record<string, unknown>;
  const obligations = (observation['obligations'] ?? {}) as Record<string, unknown>;
  const affordances = (observation['affordances'] ?? []) as Record<string, unknown>[];
  const has = (verb: string, kind?: string): boolean =>
    affordances.some(
      (a) => a['verb'] === verb && (kind === undefined || (a['params'] as Record<string, unknown>)?.['kind'] === kind),
    );

  if (String(holding['tier']) === 'COMMONS') focus.push('§11 The Commons — you are still inside it, and leaving is one-way');
  if (has('graduate')) focus.push('§11 `graduate` — the crossing is affordable to you right now');
  if (has('build', 'WORKS') || ((holding['works'] as Record<string, unknown>)?.['held'] as unknown[])?.length)
    focus.push('§11A WORKS — the only source of goods in this world');
  // ── A SECOND PATH THAT SAID SOMETHING FALSE, FOUND BY CHECKING THEM ALL ────
  //
  // This line was `holding['sovereignty'] !== null`, and it told the member it HELD TERRITORY.
  // `sovereigntyStatementFor` does not mean that: it serves whichever of four statements applies
  // to what the member can do *next*, and its last branch returns `SOVEREIGNTY_STATEMENT` — how
  // to TAKE a claim — to any principal outside the Commons holding nothing at all. So every
  // graduated member with no territory was being told it had territory to maintain.
  //
  // Worse than the `grants.syndicates` path-bug in the same function, which was merely silent:
  // this one asserted a fact about the reader's own position that was not true, on a surface
  // A5′ says must never be wrong. The claim rows are the fact — `obligations.charge` is
  // `myClaims`, one row per claim held — so both branches now read those.
  const claims = (obligations['charge'] ?? []) as unknown[];
  if (claims.length > 0) {
    focus.push('§11B Sovereignty — you hold territory that has to be MAINTAINED');
    focus.push('§11B The Charge — a bill falls due on your claim this Reckoning');
  } else if (holding['sovereignty'] !== null && holding['sovereignty'] !== undefined) {
    focus.push('§11B Sovereignty — you hold NO territory; this is what taking some would cost');
  }
  // `grants.syndicates`, not a top-level key. Read from the top level this condition was
  // `undefined.length > 0` on every real observation, so the line had never once fired in
  // production — a pointer that existed and reached nobody, checked green by a test whose
  // fixture put the key where the code looked instead of where `observe` puts it.
  if (((observation['grants'] as Record<string, unknown> | undefined)?.['syndicates'] as unknown[] | undefined ?? []).length > 0)
    focus.push('§11C Syndicates — you are inside one, and its charter cannot change');
  // The assurance, and it is listed LAST on purpose: it is free, so it should be the thing an
  // agent does in addition to its plan rather than instead of it.
  if (has('message'))
    focus.push('§4 Negotiating — you owe an elective half and can say so BEFORE it settles, for free');
  return focus;
}

/**
 * `## 11A. WORKS — …` → `11A`. The token a focus line cites with `§`.
 *
 * Data rather than string matching where it counts: the numbers come off the headings the
 * catalog already names, so a renumbered section cannot leave the marker below pointing at
 * a heading that no longer exists.
 */
function sectionNumber(heading: string): string {
  return (/^##\s+([^.\s]+)\./.exec(heading)?.[1] ?? heading).trim();
}

/** The `§<number>` a focus line opens with, or `null` if it cites none. */
export function citedSection(focusLine: string): string | null {
  return /^§(\S+)/.exec(focusLine)?.[1] ?? null;
}

/**
 * ONE LINE saying what is not in this excerpt and why, with where the rest of it lives.
 *
 * PROP-O1's discipline, applied to the rules surface rather than to the affordance list: a
 * silently shortened rulebook is indistinguishable, from the reader's side, from a game that
 * does not have those rules. A rulebook that says *"§10 is omitted because you hold no grant"*
 * costs almost nothing and is honest — and it tells a member reading its own affordances that
 * an absence is about its situation, not about the world.
 *
 * Three kinds of absence, told apart because they mean different things: **not needed this
 * wake** (the design working), **did not fit** (discretionary CONTEXT the budget squeezed out —
 * never a rule for a verb offered to you), and **never excerpted** (a standing decision, listed
 * with its reason in {@link CONTRACT_NOT_EXCERPTED}).
 *
 * **A partial section is named unit by unit**, which is the price of `###` granularity and the
 * thing that keeps it honest: a `## 11B.` shipped with two of its five blocks *looks* complete,
 * and that is nearer scar #1 than omitting §11B outright — unless the excerpt says which three
 * are missing and why. So it does.
 */
function absenceNotice(contract: ContractExcerpt): string {
  // ── GROUPED BY SECTION, WHICH IS SHORTER *AND* CLEARER ─────────────────────
  //
  // Flat, this line repeated `## 11B. Sovereignty — territory you have to MAINTAIN` five times
  // and ran to ~2,300 characters for a newcomer — and this is the ONE per-member part of
  // message 0, so it is the part that is never cached. Grouping halves it. It also says the
  // thing the reader actually needs, which the flat form only implied: whether a section is
  // absent entirely or **present with blocks missing**.
  const present = new Set(contract.sections);
  const bySection = new Map<string, { readonly heading: string; readonly because: string }[]>();
  for (const omission of [...contract.notThisWake, ...contract.dropped]) {
    const [section = omission.heading, block] = omission.heading.split(' › ');
    const rows = bySection.get(section) ?? [];
    rows.push({ heading: block ?? '(the whole section)', because: omission.because });
    bySection.set(section, rows);
  }

  const clauses: string[] = [];
  for (const [section, rows] of bySection) {
    if (!present.has(section)) {
      // Absent entirely: the preamble's own reason is the section's reason.
      const whole = rows.find((r) => r.heading === '(the whole section)') ?? rows[0];
      clauses.push(`${section} — ${whole?.because ?? 'your situation does not touch it'}`);
      continue;
    }
    clauses.push(
      `${section} is here WITHOUT ${String(rows.length)} of its blocks — ` +
        rows.map((r) => `${r.heading} (${r.because})`).join('; '),
    );
  }
  for (const outside of CONTRACT_NOT_EXCERPTED) clauses.push(`${outside.heading} — ${outside.because}`);

  if (clauses.length === 0) return '';
  return (
    '(NOT IN THIS EXCERPT, and why. Every rule for every verb offered to you in `affordances[]` ' +
    `IS above; these are not: ${clauses.join('. ')}. Nothing above is paraphrased and nothing ` +
    'is hidden — every block is verbatim, and the complete document is `agent.md`, served at ' +
    'GET /compact/api/agent.md.)'
  );
}

export function buildPrompt(input: PromptInput): BuiltPrompt {
  const projected = projectObservation(
    input.observation,
    input.maxObservationChars ?? MAX_OBSERVATION_CHARS,
  );

  const contract: CompletionMessage = {
    role: 'system',
    content: [
      'You are an autonomous agent playing THE COMPACT, a persistent world where every promise',
      'kept or broken is public and permanent. What follows is the player contract, served',
      'verbatim from the same document every other agent in this world reads. It is the only',
      'rules surface. Where it and anything else in this prompt disagree, IT WINS.',
      '',
      'It carries what every principal needs, then the parts YOUR position touches — which is why',
      'the § numbers restart once. They are the document’s own numbers and headings. Where a',
      'section appears with only some of its `###` blocks, the missing ones are named at the end',
      'with the reason. Every rule for every verb in your `affordances[]` is here.',
      '',
      '--- BEGIN PLAYER CONTRACT ---',
      input.contract.text,
      '--- END PLAYER CONTRACT ---',
      // ── LAST, NOT FIRST, AND THAT IS ABOUT COST ─────────────────────────────
      // This line is the only part of message 0 that differs between members, so putting it
      // ahead of the contract would end the shared cached prefix at character ~400 and undo
      // the reason the floor is emitted first. Here it costs nothing: everything above it is
      // identical for every member who agrees about its situation, and the floor is identical
      // for all of them.
      absenceNotice(input.contract),
    ]
      .filter((line) => line !== '')
      .join('\n'),
  };

  const who: CompletionMessage = {
    role: 'system',
    content: [
      `You are ${input.character.handle} — ${input.character.title}.`,
      '',
      input.character.creed,
      STANCE_CREED[input.character.stance],
      '',
      'That is who you are, not what you must do. Nobody is grading you against it and no',
      'rule enforces it. It is your appetite; the strategy is yours to find. You may change,',
      'and a change anyone can see the reason for is more interesting than consistency.',
      '',
      'HOW TO REPLY — read this twice.',
      '',
      'Reply with ONE JSON object and nothing else. No prose before it, no prose after it, no',
      'markdown fences. Its shape:',
      '',
      REPLY_SCHEMA,
      '',
      `- "plan" holds 1 to ${String(input.planMax)} actions. They are submitted ONE PER TICK, in order,`,
      '  over the ticks that follow. The world moves between them, so a long plan is a bet.',
      '- "verb" must be one of these, exactly, lower case:',
      `  ${input.liveVerbs.join(' · ')}`,
      '- "params" must be a flat object. Every value is a string, an INTEGER, a boolean, null,',
      '  or an array of those. Never a decimal: money is integer minor units, shares are integer',
      '  basis points. Never a nested object.',
      '- The safest plan is built from entries in `affordances[]`: copy a `verb` and its `params`',
      '  exactly. Those are known legal right now, and each one already tells you its',
      '  `max_direct_loss` and what it forecloses.',
      '',
      '',
      'GOODS COME FROM ONE PLACE, AND IT IS NOT THE FAUCET.',
      '',
      '  Your ENDOWMENT is the only goods you will ever be given, and it covers about two',
      '  Reckonings of Levy. After that you are short every night unless you are EXTRACTING.',
      '  A WORKS is the only thing in the game that makes goods.',
      '',
      '  A system yields a fixed amount per tick and every WORKS on it DIVIDES that amount. So',
      '  where you build decides what you earn: read `holding.works.here.share_per_tick`, which',
      '  already counts your own arrival, and remember it falls again when the next one arrives.',
      '  An empty frontier system is worth several times a crowded Commons one.',
      '',
      '  You pay for it out of your UNLOCKED balance, and your starter stake counts toward that. The',
      '  money is destroyed in the build rather than paid to anyone, so raising a WORKS out of your',
      '  endowment is legal — and it is usually the best thing you will ever do with it.',
      '',
      '  It extracts nothing while it spins up, so the time to build is well BEFORE you need it, not',
      '  the night the Levy comes due. Read `holding.works.here.affordable`: if it is true, you can',
      '  build right now, whatever your earnings are.',
      '',
      '',
      'TALK IS FREE, AND NOTHING ELSE IN THIS GAME IS.',
      '',
      `  ${[...FREE_VERBS].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).join(' · ')} cost NO action budget.`,
      '  Every other verb spends one of your few material actions per tick. So a plan that talks',
      '  and then acts costs the same as a plan that only acts.',
      '',
      '  Why it is worth spending words on: a promise is worth more when the counterparty believes',
      '  it, and belief is built by saying what you intend BEFORE the outcome is known. The channel',
      '  is private to the parties while it is live and becomes public at settlement — so what you',
      '  say is remembered, and it will be read next to what you actually did.',
      '',
      '  Nobody is telling you to be honest, or to talk at all. Silence is legal and sometimes',
      '  correct. But a counterparty who has never heard from you prices you as a stranger.',
      '',
      '  A `message` carries an ACT, and the act is not decoration:',
      '    offer · counter · accept · decline — the moves of a negotiation.',
      '    assure — a REASSURANCE. "I will pay in full", "your cargo is safe with me".',
      '',
      '  `assure` is the one that is quoted back at you. When a promise on that venture breaks,',
      '  the settled record puts your assurances next to what you actually did, side by side,',
      '  and that pairing is what a watching human reads. An assurance you kept is the strongest',
      '  evidence you are worth dealing with; one you broke is the most damaging sentence in the',
      '  game, and it is damaging in YOUR words rather than ours.',
      '',
      '',
      '  TIMING IS THE WHOLE VALUE. An assurance is only worth something BEFORE the outcome is known.',
      '  Said while the deal is live it is a promise, and the record prints it beside what you did.',
      '  Said after the venture has settled it is worth NOTHING to anyone: the result is already in',
      '  the record, nobody relied on your words, and no reader will ever see them next to a deed.',
      '  Measured on the live world: 40 of 41 assurances were spoken about deals that had ALREADY',
      '  RESOLVED. That is not caution, it is words with nothing at stake.',
      '',
      '  So the moment to say it is when you still owe something. `affordances[]` offers you the',
      '  assurance exactly then, on exactly the ventures where you still owe an elective half — take',
      '  it from there and the timing takes care of itself.',
      '',
      '  So say it if you mean it, and understand what you are staking if you do not.',
      '',
      'IF YOUR REPLY IS NOT VALID JSON, names a verb outside that list, carries a decimal number,',
      'or nests an object, THE WHOLE REPLY IS DISCARDED, a heuristic acts in your place, and you',
      'are not told. Malformed output is not corrected; it is thrown away.',
    ].join('\n'),
  };

  const now: CompletionMessage = {
    role: 'user',
    content: [
      'YOUR OBSERVATION — this is the same payload `GET /observe` returns to any agent, with',
      'nothing added and nothing privileged. Read `briefing`, then `affordances[]`.',
      projected.omitted.length === 0
        ? ''
        : `(${String(projected.omitted.length)} key(s) omitted to fit: ${projected.omitted.join(', ')}. They exist; they did not fit.)`,
      '',
      projected.json,
      '',
      ...(() => {
        const focus = situationalFocus(input.observation as unknown as Readonly<Record<string, unknown>>);
        if (focus.length === 0) return [];
        // Which § numbers the member was actually given, so a pointer is never aimed at text
        // it does not have. Before this the focus block cited §11B and §11C flatly, and
        // neither has ever been in the excerpt — the exact shape of "a capability that exists
        // and reaches nobody", in the one place whose whole job is to point at the rules.
        const present = new Set(input.contract.sections.map(sectionNumber));
        return [
          'THE PARTS OF THE CONTRACT THIS TICK ACTUALLY TOUCHES. Everything you were given still',
          'applies — these are the sections your situation is standing in right now:',
          ...focus.map((f) => {
            const cited = citedSection(f);
            const given = cited === null || present.has(cited);
            return given ? `  · ${f}` : `  · ${f} [NOT IN THIS EXCERPT — the contract names why]`;
          }),
          '',
        ];
      })(),
      ...(() => {
        const rel = input.relations ?? [];
        if (rel.length === 0) return [];
        return [
          'WHO YOU HAVE DEALT WITH, AND WHAT PASSED BETWEEN YOU. Not a scoreboard — this is what you',
          'know about them and what they know about you. Every line of it is public and permanent, so',
          'they can read your half exactly as you are reading theirs:',
          ...rel.map((r) => {
            const them =
              r.broke > 0
                ? `${String(r.broke)} promise(s) to you BROKEN${r.kept > 0 ? `, ${String(r.kept)} kept` : ''}`
                : r.kept > 0
                  ? `${String(r.kept)} promise(s) to you kept, none broken`
                  : 'nothing has settled between you yet';
            const you =
              r.youBroke > 0
                ? ` — and you broke ${String(r.youBroke)} to them`
                : r.youKept > 0
                  ? ` — you have kept ${String(r.youKept)} to them`
                  : '';
            return `  · ${r.other}: ${them}${you}`;
          }),
          '',
          'Nobody is telling you to forgive or to retaliate. But dealing again with somebody who broke',
          'a promise to you is a choice you are making with information, and so is refusing to.',
          '',
        ];
      })(),
      'WHAT YOU DID AND WHAT WAS DONE TO YOU, most recent last:',
      input.memory,
      '',
      'Decide. Reply with the JSON object and nothing else.',
    ]
      .filter((line) => line !== '')
      .join('\n'),
  };

  const messages = [contract, who, now];
  return {
    messages,
    chars: messages.reduce((n, m) => n + m.content.length, 0),
    omittedKeys: projected.omitted,
  };
}

/**
 * Serialise the observation, dropping whole keys in {@link DROP_ORDER} until it fits.
 *
 * Whole keys, never a byte-truncation: a JSON document cut in half is not a smaller
 * document, it is an invalid one, and a model handed invalid JSON will invent the rest.
 * If every droppable key is gone and it still will not fit, `affordances[]` is trimmed
 * from the end — the last resort, and counted like everything else.
 */
export function projectObservation(
  observation: Observation,
  maxChars: number,
): { readonly json: string; readonly omitted: readonly string[] } {
  const working: Record<string, unknown> = { ...observation };
  const omitted: string[] = [];

  let json = JSON.stringify(working);
  for (const key of DROP_ORDER) {
    if (json.length <= maxChars) break;
    if (!(key in working)) continue;
    delete working[key];
    omitted.push(key);
    json = JSON.stringify(working);
  }

  if (json.length > maxChars && Array.isArray(working['affordances'])) {
    const list = [...(working['affordances'] as unknown[])];
    while (list.length > 1 && json.length > maxChars) {
      list.pop();
      working['affordances'] = list;
      json = JSON.stringify(working);
    }
    const lost = observation.affordances.length - list.length;
    if (lost > 0) omitted.push(`${String(lost)} of affordances[]`);
  }

  return { json, omitted };
}
