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
  /**
   * ★ **The specific ACTS offered this wake, for the verbs that mean more than one thing.**
   *
   * ══════════════════════════════════════════════════════════════════════════════
   * ★ **VERB GATING IS ONLY AS SHARP AS THE VERB.** That is the lesson, and it is deliberately
   * *not* "verb gating is broken" — the distinction is load-bearing and it has a control case.
   *
   * `RULES_VERSION` 23's clearance block went into this same catalog through the same verb gate
   * and cost a newcomer **74 characters**: one observation-key line it can actually read. §11E's
   * campaign block went in the same way and cost **3,360**. The difference is not the mechanism.
   * It is that `grant`, `revoke` and `audit` each mean exactly one thing, while `build` means
   * four. So the ~30 verbs that mean one thing keep their verb gate untouched, and what is added
   * here is a **discriminator for the six that have grown a second meaning** —
   * {@link CONTRACT_MULTI_MEANING_VERBS} names them and the five deliberately left alone.
   *
   * The shape has cost this catalog three times, and all three are multi-meaning verbs:
   *
   *   1. §11A's funding rules were keyed on `verbs.has('trade')`, so the text explaining *why
   *      you cannot trade* was selected exactly when you already could. The confusing case got
   *      nothing. (Fixed by reading the NUMBER — `endowmentWithheld` below.)
   *   2. §11D's hull rules claimed `build`, costing a Commons newcomer 2,188 characters of
   *      predation preamble for a hull it could not build. Moved to §11A by hand.
   *   3. §11E's campaign rules claimed `build` — and `build` now means at least four acts
   *      (`WORKS`, `ANCHOR`, `HULL`, `CAMPAIGN`) and is offered to essentially every principal.
   *      Every position paid **3,360 characters** identically, including a newcomer on its
   *      first wake, which cannot declare a campaign for many Reckonings: a campaign needs a
   *      lane-adjacent CLAIMED system, twice a claim bond, and a depot §16.6 MUST-1 forbids in
   *      the Commons outright.
   *
   * So a unit may now name the ACT it documents instead of the verb — {@link ContractUnit.acts} —
   * and this is the set it is matched against. Nothing else about the selector changes.
   *
   * ── THE VOCABULARY IS CLOSED, AND THAT IS THE SAFETY PROPERTY ────────────────
   *
   * Only tokens in {@link CONTRACT_ACTS} appear here, and `prompt.test.ts` pins that set against
   * the catalog **both ways**: every act a unit gates on is in the vocabulary, and every token in
   * the vocabulary is gated on by some unit. A typo in a unit's `acts` therefore fails loudly
   * instead of silently never matching — which is the failure direction that would drop a rule.
   * ══════════════════════════════════════════════════════════════════════════════
   */
  readonly acts: ReadonlySet<string>;
  readonly inCommons: boolean;
  readonly commonsBound: boolean;
  /** Predation can legally reach it: A8 makes hostile action in the Commons *invalid*. */
  readonly outsideCommons: boolean;
  /** It holds a role in at least one live venture, so settlement is about to happen to it. */
  readonly inVenture: boolean;
  /**
   * ★ A campaign it is a **party to** is running — `holding.campaigns[]` with a `your_side`.
   *
   * The situation half of the §11E fix. The act tokens say *"a campaign is declarable, or a lift
   * is available"*; this says *"one is already running against you or for you"*, which is the
   * state a campaign's rules are needed in and no verb announces. A campaign pulses **once a
   * Reckoning on a published clock whether or not you are awake**, and a starved pulse walks the
   * bond — so a defender that was never given the timetable loses ground to a rule nothing showed
   * it. Same shape as `inBattle`, one clock out.
   */
  readonly inCampaign: boolean;
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
  /**
   * A demand or a world raid stands against **it**, with a deadline — `your_side === 'TARGET'`.
   *
   * Not the length of `obligations.raid[]`, and `readSituation` carries what that cost: at
   * `RULES_VERSION` 24 the list started including standoffs a hand could WALK to, so a length test
   * made every bystander a target and shipped it `yield`/`fight` rules it may not use.
   */
  readonly underRaid: boolean;
  /**
   * ★ A live standoff somebody **else** is in, and this principal could still reach it.
   *
   * §9's escort market, as the reader sees it. `raidViewsFor` returns a non-party row only when this
   * principal has an IDLE hand at the stage or one that could march there before the window shuts, so
   * the row's existence *is* the reachability — and `your_side === null` is the party test.
   *
   * Its own field rather than a verb gate, for {@link inCampaign}'s reason: **no verb announces it.**
   * A bystander already standing at the stage is offered `join{RAID}`; one two lanes off is offered
   * `move`, which every principal is offered for every hand it owns. Gating the coalition rules on
   * `move` would make them free to the whole world (§11E's defect) and gating them on `join{RAID}`
   * alone would hide them from the reader who still has to walk.
   */
  readonly nearStandoff: boolean;
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
   *
   * Use this when the rules really are **verb-wide** — §11A's `### \`build\` is FOUR different
   * acts` documents every kind, so it claims `build` and should. Use {@link acts} when they
   * belong to one kind of a verb that means several things.
   */
  readonly verbs: readonly string[];
  /**
   * ★ Specific ACTS whose rules are HERE, when the verb alone is the wrong key.
   *
   * Same guarantee and same precedence as {@link verbs} — checked in {@link unitGrade} *before*
   * any predicate, never dropped for length. It is an **additional discriminator, not a
   * replacement**: the two lists are both consulted, so a unit may name a verb-wide rule and an
   * act-specific one at once, and the property that a rule an agent can act on this wake is
   * never dropped is unchanged.
   *
   * Every token must be in {@link CONTRACT_ACTS}. A unit that gates on one act should normally
   * take that verb OFF `verbs` — leaving both is what made §11E free for a newcomer.
   */
  readonly acts?: readonly string[];
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
const S11F = "## 11F. THE FRONT, and COVER — insuring somebody else's loss";
// ★ 33 takes 11G, not 11F: master's risk market landed 11F first and it is already published in
// `agent.md`, the SPEC canon rows and `test/cast/prompt.test.ts`. Renumbering a section an agent has
// already read is a rules-surface edit for a cosmetic ordering gain.
const S11G = '## 11G. THE MAP HAS BORDERS — STRAITS, and how far your force reaches';
const S12 = '## 12. Getting good';

/**
 * How an affordance names WHICH act it is, read straight off `params`.
 *
 * Two shapes, because the engine uses two and neither is negotiable from here:
 *
 *   · **A value key** — `build {kind:"WORKS"}`, `deliver {obligation:"CHARGE"}`,
 *     `vote {ballot:"LEVY"}`. The token takes the value.
 *   · **A subject key** — `join {raid:…}` versus `join {campaign:…}`, `withdraw {venture:…}`
 *     versus `withdraw {campaign:…}`, `abandon {claim:…}` versus `abandon {venture:…}`. There is
 *     no `kind` on these; the discriminator is *which key is present at all*, so the token takes
 *     the KEY NAME, upper-cased.
 *
 * Ordered, so the token for one affordance is deterministic. Nothing here invents a default: an
 * affordance that names no discriminator produces **no** act token, only its verb. `refine
 * {system}` is the ration recipe and the engine spells it by omission — writing
 * `refine{RATION}` here would be this file asserting a value the payload does not carry, which
 * is the class of thing A2 forbids and `situationalFocus` has already been caught doing twice.
 */
const ACT_VALUE_KEYS: readonly string[] = Object.freeze(['kind', 'obligation', 'ballot']);
/**
 * `cover` is the fifth and `to` the sixth. Both arrived in the same merge, from two features that
 * each believed itself to be adding the last one — which is why this list is a single frozen array
 * with both notes above it rather than two declarations that a union would silently duplicate.
 *
 * `to` is the PARLEY discriminator (`RULES_VERSION` 31).
 *
 * `message` selects its object by parameter — `{venture}` is a MESSAGE, `{to, dossier}` hands a
 * DOSSIER, `{to, act, text}` sends a PARLEY — and `venture` was already here, so the new object needed
 * a token or its rules would have had to hang off the bare verb. That is the `build` defect exactly:
 * `message` is offered to essentially everybody (every principal owing an elective half gets an
 * `assure` row), so a verb gate would have charged **every position** for the parley rules.
 *
 * It matches the DOSSIER offer too, and that is correct rather than sloppy: a delegate holding a
 * clearance is reachable through its grant, so anybody offered `{to, dossier}` can also `{to, act}`.
 * One token for "you may address a principal directly" is one concept.
 */
const ACT_SUBJECT_KEYS: readonly string[] = Object.freeze([
  'campaign',
  'raid',
  'venture',
  'claim',
  // Phase 3. `sign` and `elect` each have two meanings and neither carries a `kind`: a venture's is
  // discriminated by `venture`, a COVER's by `cover`. Same shape as `join {raid}` vs `join {campaign}`.
  'cover',
  'to',
]);

/**
 * ★ **The closed vocabulary of act tokens the catalog gates on.**
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * Sixteen tokens, and the list is short **on purpose**: a token nothing gates on would be this
 * project's signature defect in the mechanism built to fix it — *a capability that exists and is
 * never exercised is indistinguishable from one that is missing.* So `prompt.test.ts` pins this
 * set against {@link CONTRACT_CATALOG} in both directions:
 *
 *   · every act any unit names is in here — so a typo in a unit's `acts` fails LOUDLY instead of
 *     silently never matching, which is the direction that would drop a needed rule;
 *   · every token in here is named by some unit — so the vocabulary cannot grow decoration.
 *
 * {@link readSituation} filters to this set, which is what keeps a position's declared `acts`
 * writable: the engine publishes `create {kind:"HAUL"}`, `elect {venture:…}`, `trade {side:"BID"}`
 * and a dozen more discriminated affordances whose rules are genuinely verb-wide, and none of
 * them needs to appear in a fixture.
 *
 * **Which verbs are discriminated here and which are deliberately not is the audit**, and it is
 * recorded as data in {@link CONTRACT_MULTI_MEANING_VERBS} rather than in a comment, because the
 * comment version of this table was wrong about `build` for two features.
 * ══════════════════════════════════════════════════════════════════════════════
 */
export const CONTRACT_ACTS: ReadonlySet<string> = Object.freeze(
  new Set([
    // `build` — four acts. WORKS has its own block; ANCHOR and HULL are documented by the
    // verb-wide `### \`build\` is FOUR different acts` block, so they need no token.
    'build{WORKS}',
    'build{CAMPAIGN}',
    // `refine` — the ALLOY fork. The ration recipe carries no `kind` and is §7's FLOOR chain.
    'refine{ALLOY}',
    // `join` — a raid side and a campaign side are different sections.
    'join{RAID}',
    'join{CAMPAIGN}',
    // `withdraw` — a campaign LIFT and a venture exit. Neither is the syndicate notice the
    // §11C block that used to claim this verb documents; see that entry.
    'withdraw{CAMPAIGN}',
    'withdraw{VENTURE}',
    // `abandon` — ceding a claim and quitting a role.
    'abandon{CLAIM}',
    'abandon{VENTURE}',
    // `vote` — two ballots, and only one of them is allocated by EXPOSURE.
    'vote{LEVY}',
    'vote{CHARGE}',
    // `deliver` — the Charge is goods standing at a claimed system; the Levy is §5's FLOOR block.
    'deliver{CHARGE}',
    // Phase 3's risk market. Three verbs, three second meanings, one section (§11F) — and the gate
    // matters here for §11E's measured reason: `sign` and `elect` are offered to essentially every
    // principal with a live venture, so gating §11F on the bare verbs would charge every position
    // ~3,800 characters for a mechanic most of them are not in.
    'publish_offer{COVER}',
    'sign{COVER}',
    'elect{COVER}',
    // `message` — a PARLEY (and a DOSSIER hand) address a PRINCIPAL; a MESSAGE addresses a venture.
    // §4's `### Talking to somebody you share no venture with` is the only home of the reach rule
    // and the entitlement, and both are refusable, so it is RULES for whoever is offered the act and
    // nothing at all for the far larger population offered only `message {venture, act: "assure"}`.
    'message{TO}',
  ]),
);

/**
 * ★ **THE AUDIT: every verb that means more than one thing, and where each meaning's rules live.**
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * This exists because the same defect landed three times and each time the reasoning happened in
 * a comment nobody re-checked. A verb that grows a second meaning is a *rules-surface* event: the
 * unit gated on it silently starts shipping to a population that cannot perform the act it
 * documents. So the ledger is data, and two tests read it —
 *
 *   1. every verb listed as `ACT_GATED` really has a unit gating one of its acts, and every verb
 *      listed as `VERB_GATED` really has none (so a row cannot go stale in either direction);
 *   2. a **real world is swept** and a verb whose offers DISAGREE about their discriminator while
 *      this table has no row for it fails, naming the verb and the values — which is how the
 *      fourth instance gets caught before it costs a newcomer 3,360 characters.
 *
 * `VERB_GATED` is a real answer, not a to-do list, and five rows carry it. The interesting ones:
 * `deliver`'s Levy half lives in a FLOOR block, so gating it more finely would change nothing at
 * all; `create`'s five venture kinds share one set of promise rules, which is the case the whole
 * mechanism must NOT be applied to; and `grant` is the control case that decided the shape of this
 * change — one meaning, one gate, 74 characters.
 * ══════════════════════════════════════════════════════════════════════════════
 */
export const CONTRACT_MULTI_MEANING_VERBS: readonly {
  readonly verb: string;
  /**
   * The distinct meanings the engine can offer — in {@link discriminatorsOf}'s spelling where the
   * affordance carries a discriminator this file reads, and in words where it does not.
   *
   * `publish_offer {cede}` and `grant {on_behalf_of}` are the second kind: real second meanings
   * that turn on a key nothing here discriminates on. They are in the ledger because the ledger is
   * the AUDIT — *which verbs mean more than one thing* — and it would be a worse document if it
   * only listed the ones that happen to be machine-detectable.
   */
  readonly acts: readonly string[];
  readonly gate: 'ACT_GATED' | 'VERB_GATED';
  readonly because: string;
}[] = Object.freeze([
  {
    verb: 'build',
    acts: ['build{WORKS}', 'build{ANCHOR}', 'build{CAMPAIGN}', 'build{HULL}'],
    gate: 'ACT_GATED',
    because:
      'the third instance and the expensive one: §11E cost EVERY position +3,543 characters off a ' +
      'verb offered to essentially everybody. WORKS and CAMPAIGN carry tokens; ANCHOR and HULL are ' +
      'documented by the verb-wide `### `build` is FOUR different acts` block, which claims `build`.',
  },
  {
    verb: 'refine',
    acts: ['refine{ALLOY}', 'refine (no kind — the ration recipe)'],
    gate: 'ACT_GATED',
    because:
      '§11A `### The fourth good` is the ALLOY recipe and the geography that makes it worth ' +
      'refining, so it is gated on `refine{ALLOY}` and on `haul`. Measured cost of the fix: ZERO ' +
      'characters on all five positions, because the block is also `wanted` for anybody working ' +
      'ground and the engine offers both recipes off the same ore (1,122 of 1,122 swept ' +
      'observations carried both). Fixed anyway — a gate that is right for the wrong reason ' +
      'stops being right the day the rates diverge.',
  },
  {
    verb: 'join',
    acts: ['join{RAID}', 'join{CAMPAIGN}'],
    gate: 'ACT_GATED',
    because:
      'both directions were wrong: a bystander to a raid was shipped §11E, and a campaign ally was ' +
      'shipped §11D — a section A8 makes unreachable for half the world. `side` is NOT the ' +
      'discriminator; a side exists on both.',
  },
  {
    verb: 'withdraw',
    acts: ['withdraw{CAMPAIGN}', 'withdraw{VENTURE}'],
    gate: 'ACT_GATED',
    because:
      'the worst variant found: §11C `### Leaving costs a Reckoning of notice` claimed `withdraw`, ' +
      'and the engine’s `withdraw` **cannot leave a syndicate at all** (`SyndicateBook.giveNotice` ' +
      'has no caller). So every venture exit and every campaign lift shipped the syndicate notice ' +
      'rules, and the act that block documents could never select it. `withdraw{VENTURE}` now ' +
      'selects §4’s `stake` block, which is where the forfeit it actually costs is written down.',
  },
  {
    verb: 'abandon',
    acts: ['abandon{CLAIM}', 'abandon{VENTURE}'],
    gate: 'ACT_GATED',
    because:
      'quitting a venture role pulled §11B’s preamble plus `### Losing it` — 2,962 characters of ' +
      'sovereignty for a member that holds no ground.',
  },
  {
    verb: 'vote',
    acts: ['vote{LEVY}', 'vote{CHARGE}'],
    gate: 'ACT_GATED',
    because:
      'the Levy ballot picks between BY_STORES, BY_EXPOSURE, EVEN and INVERSE_EXPOSURE; the Charge ' +
      'ballot picks between EVEN, BY_CLAIMS and BY_TIER and reads no EXPOSURE at all. §4’s 4,462-' +
      'character `stake` block is EXPOSURE’s rules, so a claimant voting on the Charge was being ' +
      'charged for a quantity its ballot does not read.',
  },
  {
    verb: 'deliver',
    acts: ['deliver{LEVY}', 'deliver{CHARGE}', 'deliver{LEVY} with `payer`'],
    gate: 'ACT_GATED',
    because:
      'three meanings, and the split is asymmetric on purpose. §5’s Levy block is FLOOR — every ' +
      'position pays for it every wake whatever the gate — so `deliver{LEVY}` and the `payer` ' +
      'carry need no token and get none. `deliver{CHARGE}` is act-gated onto §11B’s CHARGE block, ' +
      'which is where the Charge and its ballot are both written down.',
  },
  {
    verb: 'create',
    acts: ['create{HAUL}', 'create{ESCORT}', 'create{SURVEY}', 'create{DIG}', 'create{BUILD}'],
    gate: 'VERB_GATED',
    because:
      '★ THE CASE THE MECHANISM MUST NOT BE APPLIED TO. Five venture kinds, ONE set of promise ' +
      'rules: the two halves, the proportion and the negotiation channel are identical whichever ' +
      'kind is created. Splitting this would ship five copies of one rule and select none of them ' +
      'for a sixth kind.',
  },
  {
    verb: 'publish_offer',
    acts: ['publish_offer{text}', 'publish_offer{cede}', 'publish_offer{COVER}'],
    gate: 'ACT_GATED',
    because:
      'THREE shapes now, and the third is what moved this row from VERB_GATED. The `cede` shape sells ' +
      'a claim and its rules are in §11B `### Losing it`, already reached by `abandon{CLAIM}`, ' +
      '`inArrears` and `holdsClaim`; the `text` shape is what §4 `### Negotiating` documents; and ' +
      '`kind:"COVER"` writes insurance, whose rules are §11F. That third meaning DOES carry a key this ' +
      'file discriminates on, so it is gated — and measured at **zero characters on four of seven ' +
      'positions** because a principal offered only the prose shape never sees §11F.',
  },
  {
    verb: 'sign',
    acts: ['sign (a venture’s terms)', 'sign{COVER}'],
    gate: 'ACT_GATED',
    because:
      '§4’s promise rules are the FLOOR block every position pays for, and they are right for a ' +
      'venture. A COVER’s rules are §11F — a different clock, a different subject, and a ' +
      '`terms_hash` echoed off an offer rather than off a role — so `sign{COVER}` selects that ' +
      'section and a venture signature does not.',
  },
  {
    verb: 'elect',
    acts: ['elect (a venture role)', 'elect{COVER}'],
    gate: 'ACT_GATED',
    because:
      '★ the case the mechanism was BUILT for, arriving on schedule. `elect` is offered to almost ' +
      'every principal with a live venture, so §11F gated on the bare verb would have charged every ' +
      'one of them 3,826 characters of insurance — §11E’s +3,543 defect exactly. The election ITSELF ' +
      'is one concept (§4’s `IN_FULL` paragraph covers both), but what is being elected on is not.',
  },
  {
    verb: 'trade',
    acts: ['trade{BID}', 'trade{ASK}'],
    gate: 'VERB_GATED',
    because:
      'one block documents both sides, and the rule that decides what may be committed — ' +
      '`market.transferable_minor` — binds a BID and an ASK identically.',
  },
  {
    verb: 'grant',
    acts: ['grant (own)', 'grant with `on_behalf_of` (an office)'],
    gate: 'VERB_GATED',
    because:
      '★ THE CONTROL CASE FOR THE WHOLE MECHANISM. `grant` means ONE thing however it is ' +
      'parameterised, so its verb gate is already as sharp as an act gate: `RULES_VERSION` 23 put ' +
      '§10’s `### CLEARANCE and the DOSSIER` behind `grant`/`revoke`/`audit` plus `holdsGrant` and ' +
      'it cost a newcomer **74 characters** against §11E’s 3,360, through the same catalog and the ' +
      'same mechanism. That is why verb gating is not replaced here — it is only as sharp as the ' +
      'verb, and for thirty-odd verbs the verb is sharp enough.',
  },
  {
    verb: 'set_delivery_intent',
    acts: ['set_delivery_intent{LEVY}'],
    gate: 'VERB_GATED',
    because: 'one obligation is offered today, and its only home is §5’s Levy block, which is FLOOR.',
  },
  {
    verb: 'message',
    acts: ['message{VENTURE}', 'message{TO} — a PARLEY, or a DOSSIER hand'],
    gate: 'ACT_GATED',
    because:
      '★ the fifth instance, and the shape `build` taught. `message {venture, act:"assure"}` is offered ' +
      'to every principal that owes an elective half — which is nearly everybody that has ever created ' +
      'a venture — so a verb gate on §4’s parley block would have charged EVERY position 2,555 ' +
      'characters of reach rules and an entitlement, for an act most of them cannot take. `to` is the ' +
      'discriminator and it is the honest one: it is present exactly when the address is a PRINCIPAL. ' +
      '§4’s `### Negotiating` keeps the bare verb, because the typed acts and the settlement ' +
      'declassify rule bind every shape of `message` alike.',
  },
]);

/**
 * Every act one affordance could be named by, **before** the vocabulary filter.
 *
 * Exported separately from {@link actTokensOf} because the unfiltered list is what the *tripwire*
 * needs: `build` grew from two kinds to four across three features and nothing noticed, because a
 * new `kind` is a new param VALUE and no test was watching params. `prompt.test.ts` sweeps a real
 * world through this function and fails when a verb's offers disagree about their discriminator
 * while {@link CONTRACT_MULTI_MEANING_VERBS} has no row for it.
 *
 * Deterministic and total: unknown params, missing params and a partial observation all produce
 * the empty list.
 */
export function discriminatorsOf(verb: string, params: unknown): readonly string[] {
  const bag = typeof params === 'object' && params !== null ? (params as Record<string, unknown>) : {};
  const tokens: string[] = [];
  for (const key of ACT_VALUE_KEYS) {
    const value = bag[key];
    if (typeof value === 'string' && value.length > 0) tokens.push(`${verb}{${value}}`);
  }
  for (const key of ACT_SUBJECT_KEYS) {
    const value = bag[key];
    if (value !== undefined && value !== null) tokens.push(`${verb}{${key.toUpperCase()}}`);
  }
  return tokens;
}

/**
 * Which acts one affordance names, **as the catalog spells them**. The only producer of
 * {@link ContractSituation.acts}.
 *
 * Filtered to {@link CONTRACT_ACTS}, so the situation carries exactly the vocabulary the catalog
 * reads and no more — which is what keeps a declared position writable and stops a token nothing
 * gates on from existing. A filtered-out discriminator reads as "no act", which is safe because
 * {@link unitGrade} still has the verb list and the predicates.
 */
export function actTokensOf(verb: string, params: unknown): readonly string[] {
  return discriminatorsOf(verb, params).filter((token) => CONTRACT_ACTS.has(token));
}

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
 * of sixty-four could be forgotten. It is in {@link unitGrade}: *a unit one of whose `verbs`
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
 * ── ★ A UNIT MAY GATE ON AN ACT, NOT ONLY A VERB ─────────────────────────────
 *
 * {@link ContractUnit.acts} and {@link CONTRACT_ACTS}. Read the note on
 * {@link ContractSituation.acts} for why: three units in a row were gated on a verb that had
 * grown a second meaning, and the third one — §11E on `build` — put a **campaign section in a
 * newcomer's first wake**. `verbs` is still right for a rule that is genuinely verb-wide;
 * `acts` is for a rule that belongs to one KIND of a verb. Both are checked before any
 * predicate, so the guarantee below is unchanged in strength and only sharper in aim.
 *
 * ── ONE THING THIS CATALOG RECORDS RATHER THAN FIXES ─────────────────────────
 *
 * `claim`, `deny` and `propose` appear in `agent.md` **only as names in §7's verb table**. §7 is
 * FLOOR so they are always readable, and the guarantee below holds — but a row in a table is not
 * a rule, and those three still want a block each.
 *
 * `withdraw` used to be the fourth name on that list, for a reason that turned out to be a
 * *defect* rather than a documentation gap: its rules were in §11C, about leaving a syndicate,
 * which is not a thing the verb does. `withdraw{VENTURE}` now selects §4's `stake` block — where
 * the forfeit it costs is stated — and `withdraw{CAMPAIGN}` selects §11E's exits. What remains
 * open is in the *engine*, not here: `SyndicateBook.giveNotice` has no caller, so §11C documents
 * an exit no agent can take. Recorded in {@link CONTRACT_MULTI_MEANING_VERBS}.
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
    verbs: ['fill_role', 'sign'],
    // `abandon` means TWO things and only one of them is a venture: `abandon {venture, role_index}`
    // quits a role, `abandon {claim}` cedes territory. Gated on the verb, a claimant ceding ground
    // pulled this preamble; gated here, quitting a role no longer pulls §11B's.
    acts: ['abandon{VENTURE}', 'withdraw{VENTURE}'],
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
   * ★ The PARLEY, gated on the ACT and never on the verb (`RULES_VERSION` 31).
   *
   * RULES rather than CONTEXT, and the test is the one this file applies throughout: **can the member
   * be refused for not knowing it?** Three ways, all of them costing a wake to discover —
   *
   *   · it addresses somebody the world does not stand it beside (`A15`, reach);
   *   · it has never honoured an elective half and has been paid nothing, so it may open no
   *     conversation at all (`A15`, entitlement) — and the *fix* for that is a fact about ventures
   *     that appears nowhere else in the document;
   *   · it banks its allowance across a Reckoning boundary and finds it gone.
   *
   * And one more that is worse than a refusal: a member that does not know a parley **publishes four
   * ticks later** will say something in what it believes is confidence. That is A5′-adjacent — not the
   * record being wrong, but the member being wrong about the record, which §11's say-do gap then prints
   * under its name for ever.
   *
   * `wanted` is deliberately absent. There is no standing fact that makes this worth having: a
   * principal with no reachable recipient and no allowance has nothing to do with it, and the engine
   * says so in `header.parley.rule` for free.
   */
  {
    section: S4,
    block: '### Talking to somebody you share no venture with: the PARLEY',
    verbs: [],
    acts: ['message{TO}'],
    because:
      'no principal is reachable for you to address directly this wake — `header.parley` carries the ' +
      'count and the reason, and a MESSAGE inside a venture you already share needs none of it',
  },
  /**
   * ★ RULES for anybody offered `fill_role` **or** a `vote`, and the second key is the point.
   *
   * A stake is *escrowed at fill time* and *forfeit to the other parties on withdrawal* (§7.3), so a
   * member offered the verb and not shown this block can lose slashable capital to a rule it was never
   * told about — A5′'s shape, and the reason `verbs: ['fill_role']` grades it RULES rather than
   * CONTEXT.
   *
   * `vote{LEVY}` is the second key because EXPOSURE is what two of §5.2's four allocation rules are
   * computed from. A member deciding between `BY_EXPOSURE` and `INVERSE_EXPOSURE` without knowing that
   * its own stakes are the number being weighed is voting on a figure it does not know it controls —
   * and until `D31` there was no such figure, so nothing in the document had to say it.
   *
   * ── ★ `vote`, NOT `vote{LEVY}`, WAS THE SECOND INSTANCE OF THE `build` DEFECT ──
   *
   * There are two ballots. The Levy's picks between `BY_STORES`, `BY_EXPOSURE`, `EVEN` and
   * `INVERSE_EXPOSURE`; the **Charge's** picks between `EVEN`, `BY_CLAIMS` and `BY_TIER` and reads no
   * EXPOSURE at all. This block is 4,462 characters of EXPOSURE, so a claimant with an open Charge
   * ballot and no venture role was being charged for the rules of a quantity its ballot does not read.
   * §11B's own CHARGE block is where `vote{CHARGE}` belongs and it now claims it.
   *
   * ── AND `withdraw{VENTURE}`, WHICH HAD ITS RULES IN THE WRONG SECTION ENTIRELY ──
   *
   * *"`withdraw` from a venture you have staked in and the stake is **forfeit to the other
   * parties**"* is in this block, and it is the only place the document says so. Until now
   * `withdraw` selected §11C's *syndicate* notice rules instead — the wrong rules, for an act the
   * engine cannot perform. Being handed the wrong rule is worse than being handed none.
   */
  {
    section: S4,
    block: '### The third half: `stake` on `fill_role` — how you outbid a rival, and what it costs',
    verbs: ['fill_role'],
    acts: ['vote{LEVY}', 'withdraw{VENTURE}'],
    wanted: (s) => s.inVenture,
    because: 'neither `fill_role` nor the Levy ballot is offered to you this wake, so there is no bid to place',
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
  // ── ★ THE CLEARANCE (`RULES_VERSION` 23), AND WHY IT IS `required` RATHER THAN `wanted` ──
  //
  // Every other §10 block is `wanted`: knowing what a grant IS matters and is not an A5′ rule.
  // This one is different, and the difference is the whole reason the mechanic needs a section.
  //
  // A loss LIMIT is recoverable — it expires, it is bounded, and the number was on the affordance.
  // A CLEARANCE is not: a cleared delegate can cut a DOSSIER, the copy is permanent, it travels to
  // any principal, and **revoking the grant takes back nothing already taken.** A grantor that
  // signs a clearance without knowing that has accepted an unbounded, irreversible exposure on the
  // strength of a preview it did not understand — which is A7 failing at the one axis with no
  // upper bound in currency. And a DELEGATE holding a clearance is holding somebody else's secret
  // with no rule telling it what the act costs.
  //
  // So it is `required` for anyone on either side of a grant, and it is claimed by the same three
  // verbs: a member offered `grant` needs it before it signs, and a member offered `audit` cannot
  // price the action without it.
  {
    section: S10,
    block: '### CLEARANCE and the DOSSIER — the part `revoke` cannot undo',
    verbs: ['grant', 'revoke', 'audit'],
    required: (s) => s.holdsGrant,
    because: 'you are neither party to a grant nor offered one, so no clearance can exist',
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
    // The block is named for one kind, so it is gated on one kind. Measured on a swept 900-tick
    // world: `build {kind:"HULL"}` was offered in 133 observations and `build {kind:"WORKS"}` in 46,
    // so a shipwright with no affordable WORKS was reading how to raise one. The kind block above
    // still reaches it — that is the one that documents all four.
    block: '### Building one — `build` `{"kind":"WORKS","system":"<id>"}`',
    verbs: [],
    acts: ['build{WORKS}'],
    because: 'no WORKS is offered to you this wake — you cannot afford one where you stand',
  },
  {
    section: S11A,
    // ── ★ RAZING, AND THE GATE IS `outsideCommons` RATHER THAN A VERB ──────────
    //
    // Three rules in one block and all three are A5′-shaped for a WORKS holder: your structure can be
    // destroyed, the margin that decides it, and the fact that rebuilding gets NO discount. A member
    // that lost a WORKS and expected the 25,000 currency door to reopen has been billed by a rule
    // nobody showed it, which is exactly the class this catalog exists to prevent.
    //
    // **`wanted` on `holdsWorks || canBuildWorks`, not on a verb**, because the population that needs
    // it is *people with production to lose* and no verb identifies that. `fight` and `join` are the
    // counterplay, but they are only offered when a standoff is already live — a member reading this
    // for the first time inside a 24-tick window has already chosen wrong. So it ships with the WORKS
    // rules, to whoever holds or can raise one.
    //
    // **And `outsideCommons`, which is the same call `join{RAID}`'s row records:** A8 makes a Commons
    // WORKS unrazable, so for a Commons-seated member every rule here reads as a threat that cannot
    // reach it. That is not a saving of characters, it is a saving of a *wrong impression* — the block
    // still states the Commons exemption for anybody who does get it, so a member that graduates out
    // reads it on the wake it becomes true.
    block: '### It can be DESTROYED — and rebuilding costs full price',
    verbs: [],
    wanted: (s) => s.outsideCommons && (s.holdsWorks || s.canBuildWorks),
    because: 'you are inside A8\'s floor, where a WORKS cannot be razed, and hold none besides',
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
    // ── ★ `refine{ALLOY}`, NOT `refine`, AND THE FIX COSTS ZERO CHARACTERS ────
    //
    // `refine` means two recipes: `{system}` makes the ration every obligation is payable in, and
    // `{kind:"ALLOY", …}` makes the good that buys ground. This block is the second one, so it is
    // gated on the second one. Measured cost of the change: **0 on all five positions**, because
    // `wanted` already covers everybody who works ground and the engine offers both recipes off the
    // same lot (1,122 of 1,122 swept observations carried both). Changed anyway — a gate that is
    // right only because two populations coincide stops being right the day the rates diverge, and
    // the rates are `ALLOY_IN_BY_TIER`, which is per-tier already.
    block: '### The fourth good — the one the COMMONS makes CHEAPEST, and the one that flows the other way',
    verbs: ['haul'],
    acts: ['refine{ALLOY}'],
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
  // §11E — CAMPAIGNS. All six blocks are gated RULES, never FLOOR.
  //
  // FLOOR is the expensive placement — every position pays for it — and a campaign is reachable only
  // by a principal whose holding stands one lane from somebody else's claim, which is a narrow state.
  //
  // ── ★ THIS SECTION WAS GATED ON `build`, AND THAT WAS NOT A GATE AT ALL ───
  //
  // ══════════════════════════════════════════════════════════════════════════
  // The comment that used to sit here said *"`build` is shared with §11A and §11B and that is
  // correct: the `kind` block explains the fourth kind, and this section is what the fourth kind
  // DOES. Same verb, same trigger, no second preamble."* Every clause of that is true and the
  // conclusion was still wrong, because **`build` is offered to essentially every principal** — it
  // also raises a WORKS. Measured:
  //
  //   newcomer's first wake      39,489 → 43,032   (+3,543)
  //   mid-game in the Commons    47,877 → 51,420   (+3,543)
  //   about to take territory    48,750 → 52,293   (+3,543)
  //   largest reachable          65,323 → 68,866   (+3,543)
  //
  // Identical on every position, including a newcomer on its first wake — 8% of its excerpt for a
  // mechanic it cannot reach for many Reckonings, since a campaign needs a lane-adjacent CLAIMED
  // system and twice a claim bond. That is the most cost-sensitive reader in the game paying for
  // the one section it provably cannot use.
  //
  // So the gate is the ACT: `build{CAMPAIGN}` is what the affordance list actually publishes when a
  // campaign is declarable, and it is checked with exactly the precedence the verb had — before any
  // predicate, never dropped for length. The situation half is `inCampaign`, for the party to a
  // running one that is offered no verb this wake and still owes the clock a decision.
  // ══════════════════════════════════════════════════════════════════════════
  {
    section: S11E,
    block: null,
    verbs: [],
    acts: ['build{CAMPAIGN}', 'join{CAMPAIGN}', 'withdraw{CAMPAIGN}'],
    wanted: (s) => s.inCampaign,
    because: 'no campaign is offered to you this wake and you are party to none',
  },
  {
    section: S11E,
    block: '### Declaring one — `build` `{"kind":"CAMPAIGN","system":"<the claimed system>"}`',
    verbs: [],
    acts: ['build{CAMPAIGN}'],
    because: 'no campaign is offered to you this wake',
  },
  {
    section: S11E,
    // The PULSE block goes to anyone offered a campaign `join` too, and that is the load-bearing
    // pairing: an ally that does not know force is counted AT THE PULSE will sign up and march away,
    // contributing nothing it was told it would. A5′ in the agent-facing text rather than in the
    // engine.
    //
    // `required` for a party to a live one, and this is the §9A `inBattle` argument one clock out: a
    // campaign pulses once a Reckoning **whether or not you are awake**, force is counted at that
    // instant, and a starved pulse walks toward forfeiting the whole bond. A defender that was never
    // given the timetable loses ground to a rule nothing showed it.
    block: '### The PULSE — once a Reckoning, on a published clock, whether you are awake or not',
    verbs: [],
    acts: ['build{CAMPAIGN}', 'join{CAMPAIGN}'],
    required: (s) => s.inCampaign,
    because: 'no campaign is offered to you this wake and you are party to none',
  },
  {
    section: S11E,
    block: '### Reading it — `holding.campaigns[]`',
    verbs: [],
    acts: ['build{CAMPAIGN}', 'join{CAMPAIGN}', 'withdraw{CAMPAIGN}'],
    wanted: (s) => s.inCampaign,
    because: 'no campaign is offered to you this wake and you are party to none',
  },
  // ══════════════════════════════════════════════════════════════════════════
  // §11F · PHASE 3's RISK MARKET — and the gate is `acts`, for §11E's measured reason.
  //
  // `sign` and `elect` are offered to essentially every principal that holds a venture role, so
  // gating this section on the bare verbs would ship ~3,800 characters of insurance to every position
  // in the game — which is §11E's +3,543 defect with a different section number. The tokens are
  // `publish_offer{COVER}`, `sign{COVER}` and `elect{COVER}`, and the split below is asymmetric on
  // purpose: the FRONT's preamble reaches anybody offered any of the three (a front is weather and
  // everybody standing in the cone needs its clock), while the writing and deciding blocks are gated
  // on the act that performs them.
  // ══════════════════════════════════════════════════════════════════════════
  {
    section: S11F,
    block: null,
    verbs: [],
    acts: ['publish_offer{COVER}', 'sign{COVER}', 'elect{COVER}'],
    because: 'no COVER act is offered to you this wake, so no FRONT is close enough to price',
  },
  {
    section: S11F,
    block: '### Buying COVER — `sign` `{"cover":"<id>","terms_hash":"<hash>"}`',
    verbs: [],
    acts: ['sign{COVER}'],
    because: 'you are offered no COVER to buy this wake',
  },
  {
    section: S11F,
    block:
      '### Writing COVER — `publish_offer` ' +
      '`{"kind":"COVER","system":…,"good":…,"limit":N,"premium":N}`',
    verbs: [],
    acts: ['publish_offer{COVER}'],
    because: 'you are not offered the act of writing cover this wake',
  },
  {
    section: S11F,
    // ★ `required` for a payer with an INDEMNITY due, and that is A5′ in the agent-facing text: an
    // election is a decision with a deadline, silence is a refusal, and a payer that was never shown
    // the rule is a payer the record calls a defaulter for not reading its mind. Same argument the
    // PULSE block above makes one clock out.
    block: '### The decision — `elect` `{"cover":"<id>","election":"IN_FULL"}`',
    verbs: [],
    acts: ['elect{COVER}'],
    because: 'nothing is due from you on a COVER this wake',
  },
  {
    section: S11E,
    // `join{CAMPAIGN}`, not `join`. A raid's `join {raid, side}` and a campaign's
    // `join {campaign, side, system}` are different sections of the document, and `side` exists on
    // both — so the discriminator is which SUBJECT the affordance names, never the side.
    block: '### Taking a side — `join` `{"campaign":"<id>","side":"ATTACKER"|"DEFENDER"}`',
    verbs: [],
    acts: ['join{CAMPAIGN}'],
    because: 'no campaign side is open to you this wake',
  },
  {
    section: S11E,
    // `withdraw{CAMPAIGN}` is on this block because the LIFT is one of the four endings, and an
    // attacker that cannot see the cheaper way to lose will hold a losing war to its bond-forfeiting
    // end. `wanted` on `inCampaign` covers the attacker whose lift is refused this particular wake.
    block: '### Getting out — and there are four ways, not one',
    verbs: [],
    acts: ['build{CAMPAIGN}', 'withdraw{CAMPAIGN}'],
    wanted: (s) => s.inCampaign,
    because: 'no campaign is offered to you this wake and you are party to none',
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
    // ★ The two acts this block documents, by name: `deliver {obligation:"CHARGE", system}` and
    // `vote {ballot:"CHARGE", rule}`. Both were already covered by `required: holdsClaim` — the
    // engine only offers either to a claimant — and they are named anyway, because `vote{CHARGE}`
    // came OFF §4's EXPOSURE block in this change and a ballot whose rules are claimed by no unit
    // is how a verb ends up with rules nobody can read.
    acts: ['deliver{CHARGE}', 'vote{CHARGE}'],
    // A5′. `obligations.charge` carries the arithmetic; this is the rule behind it, and a
    // claimant billed from a rule it was never given is the libel case §15.4 is about.
    required: (s) => s.holdsClaim,
    because: 'you hold no claim, so no Charge falls due on you',
  },
  {
    section: S11B,
    block: '### Losing it — arrears, the window, and two exits that beat a lapse',
    // `abandon{CLAIM}`, not `abandon`. Quitting a venture role is the same verb, and gated on it
    // this block plus §11B's preamble cost a mid-game member with no territory 2,962 characters of
    // sovereignty. `publish_offer {cede}` is the other exit here and stays verb-free: it is reached
    // by `inArrears` and `holdsClaim`, which is every principal that has one to sell.
    verbs: [],
    acts: ['abandon{CLAIM}'],
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
    // ── ★ THIS CLAIMED `withdraw`, AND IT IS THE WORST VARIANT OF THE DEFECT ──
    //
    // ══════════════════════════════════════════════════════════════════════════
    // The engine's `withdraw` takes `{campaign}` (a campaign LIFT) or `{venture, role_index}` (a
    // role exit) and **nothing else**: `SyndicateBook.giveNotice` has no caller, so no verb in this
    // world leaves a syndicate at all. So the gate was inverted twice over — every venture exit and
    // every campaign lift pulled this block plus §11C's preamble, and the act the block documents
    // could never select it, because that act does not exist.
    //
    // The other two instances shipped rules to a reader that could not use them. This one shipped
    // **the wrong rules to a reader that had a real decision to make**: a member quitting a staked
    // role was handed "you stay a sitting member until your notice expires" instead of §4's *"the
    // stake is forfeit to the other parties"*, which is the sentence that act actually costs it.
    // `withdraw{VENTURE}` now selects that block.
    //
    // Kept in the catalog on `inSyndicate` alone rather than moved to CONTRACT_NOT_EXCERPTED: the
    // rule is still a TRUE fact about a house a member sits in — it is why nobody can drain the
    // pool the moment a vote goes against them — and that is worth reading whether or not the exit
    // is buildable. That the exit has no verb is a gap in the syndicate module, not in the
    // selection, and it is recorded in CONTRACT_MULTI_MEANING_VERBS so it is looked at on purpose.
    // ══════════════════════════════════════════════════════════════════════════
    block: '### Leaving costs a Reckoning of notice',
    verbs: [],
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
    // `join{RAID}`, not `join`. A campaign ally is offered `join {campaign, side, system}` and was
    // being handed §11D's preamble plus this block — predation rules, to a member whose standoff is
    // a campaign and whose Commons neighbours A8 makes unreachable. The mirror of §11E getting
    // `join` from a raid bystander: one verb, two sections, and it was wrong in both directions.
    verbs: ['yield', 'fight'],
    acts: ['join{RAID}'],
    required: (s) => s.underRaid,
    because: 'no raid or demand stands against you',
  },
  // ── ★ THE COALITION, AND IT IS AN ORPHAN HEADING'S FIX ────────────────────
  //
  // ══════════════════════════════════════════════════════════════════════════
  // **THE SECTION SHIPPED WITHOUT A UNIT AND THE CAST COULD NEVER HAVE READ IT.** `RULES_VERSION`
  // 24 added 3,263 characters to §11D — `join`'s price, the `march` block with its ETA, the party
  // and formation caps, why paying early buys nothing — and claimed none of it. So the mechanic the
  // whole wave existed to open had rules no member could be shown: the fourth DEPTH of this
  // project's recurring defect, and the one the merge caught automatically rather than a reviewer.
  //
  // Three depths already recorded: a verb with no affordance, an affordance nothing selects, an
  // invariant whose subject cannot occur. This is **a published slot nothing fills** — and it is the
  // same shape as `join{RAID}` itself, which master found *"wrong in both directions"*.
  //
  // ── WHY THIS GATE, AND WHY NOT `move` ────────────────────────────────────
  //
  // `acts: ['join{RAID}']` covers the reader already standing at the stage. `nearStandoff` covers
  // the one that still has to walk, and it is not a convenience: a marching bystander is offered
  // `move` and NOT `join`, because a `join` affordance for a hand that is not there is a move the
  // handler refuses (AGT-S2). Gating on `move` instead would ship this to every principal alive for
  // every hand it owns, which is §11E's +3,543 defect with a different section number.
  //
  // `wanted`, not `required`: taking a side is an option with a clock, not an A5′ problem. A member
  // that is never shown it loses an opportunity; the `required` rows in this section are the ones
  // where silence costs goods or a hull.
  // ══════════════════════════════════════════════════════════════════════════
  {
    section: S11D,
    block: '### Standing with somebody else — `join`, and the coalition it makes',
    verbs: [],
    acts: ['join{RAID}'],
    wanted: (s) => s.nearStandoff,
    because:
      'no standoff you are not already a side of is within reach of a hand — `join` costs no ' +
      'aggression capacity, so this is the one act in §9 whose price is entirely presence',
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

  // ── §11G · ★ §16.12 #1: STRAITS AND SWAY ──────────────────────────────────
  //
  // ══════════════════════════════════════════════════════════════════════════
  // **ACT-GATED, AND THE GATE IS THE WHOLE REASON THIS SECTION IS AFFORDABLE.** Every verb that
  // reads sway — `demand`, `join`, `build` — is offered broadly, and `build` is offered on
  // essentially every wake. §11E's own note records what gating on the bare verb cost once: a
  // **campaign section in a newcomer's first wake, +3,543 characters** for a mechanic it could not
  // reach. So these gate on the kind-qualified tokens and nothing else.
  //
  // Deliberately **not** `required` on any predicate, and that is the honest call rather than the
  // cheap one. A reach limit is discovered by refusal — which is the shape `demand.ts` calls out
  // about §9's aggression capacity, *"an agent learned the resource existed by exhausting it"* — but
  // the refusal itself carries `SWAY_STATEMENT` verbatim, `holding.sway` publishes the standing
  // figure to every principal on every wake regardless of this catalog, and the affordance's own
  // `what_it_forecloses` states the reading. So a member that never sees this section is never
  // refused for a rule it had no way to read; it is shown the rule at the moment it applies. What
  // this section buys is planning it can do *before* walking, which is CONTEXT, not A5′.
  // ══════════════════════════════════════════════════════════════════════════
  {
    section: S11G,
    block: null,
    // `verbs: ['demand']` and not an act token: `demand` means exactly ONE thing however it is
    // parameterised, so its verb gate is already as sharp as an act gate — `grant`'s row in
    // CONTRACT_MULTI_MEANING_VERBS is the control case for exactly this, and `principal` is not an
    // ACT_SUBJECT_KEY, so `demand{...}` is a token nothing could ever produce. `join` and `build`
    // each carry a second meaning and are act-gated.
    verbs: ['demand'],
    acts: ['join{RAID}', 'join{CAMPAIGN}', 'build{CAMPAIGN}'],
    because:
      'no act of yours reads SWAY this wake — `holding.sway` still carries your reach and its rule ' +
      'on every wake, so nothing here is a rule you could be refused for not knowing',
  },
  {
    section: S11G,
    // On the CAMPAIGN acts as well as the raid ones, and that pairing is load-bearing: a campaign's
    // DEPOT is one lane from its OBJECTIVE, so whether that lane is a STRAIT is the difference
    // between a war an attacker can reinforce and one it must fight alone.
    block: '### STRAITS — the lanes the region cannot route around',
    // `verbs: ['demand']` and not an act token: `demand` means exactly ONE thing however it is
    // parameterised, so its verb gate is already as sharp as an act gate — `grant`'s row in
    // CONTRACT_MULTI_MEANING_VERBS is the control case for exactly this, and `principal` is not an
    // ACT_SUBJECT_KEY, so `demand{...}` is a token nothing could ever produce. `join` and `build`
    // each carry a second meaning and are act-gated.
    verbs: ['demand'],
    acts: ['join{RAID}', 'join{CAMPAIGN}', 'build{CAMPAIGN}'],
    because: 'no act of yours reads a STRAIT this wake',
  },
  {
    section: S11G,
    // The statement block. It carries `SWAY_STATEMENT`'s own words, so the document and the engine's
    // refusal say the same thing — the surface scar #1 is about.
    block: '### SWAY — how many hands count as force, and where',
    // `verbs: ['demand']` and not an act token: `demand` means exactly ONE thing however it is
    // parameterised, so its verb gate is already as sharp as an act gate — `grant`'s row in
    // CONTRACT_MULTI_MEANING_VERBS is the control case for exactly this, and `principal` is not an
    // ACT_SUBJECT_KEY, so `demand{...}` is a token nothing could ever produce. `join` and `build`
    // each carry a second meaning and are act-gated.
    verbs: ['demand'],
    acts: ['join{RAID}', 'join{CAMPAIGN}', 'build{CAMPAIGN}'],
    because: 'no act of yours is capped by SWAY this wake',
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
  // Derived from the catalog for the same reason `verbs` is: the ceiling has to be *the whole
  // catalog*, and a hand-typed act list would silently stop being that the next time a unit is
  // added. `CONTRACT_ACTS` is pinned against this in `prompt.test.ts`, both directions.
  acts: new Set(CONTRACT_CATALOG.flatMap((unit) => [...(unit.acts ?? [])])),
  inCommons: true,
  commonsBound: true,
  outsideCommons: true,
  inVenture: true,
  inCampaign: true,
  holdsGrant: true,
  inSyndicate: true,
  holdsClaim: true,
  inArrears: true,
  anchorCold: true,
  underRaid: true,
  nearStandoff: true,
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

/**
 * Verbs and acts a **Commons** holding is never offered, each for a reason in the engine.
 *
 * A8 is the big one and it is asserted against a real observation in `prompt.test.ts`: hostile
 * action inside the Commons is *invalid*, not merely rare, so nothing stands against a Commons
 * holding and it answers nothing. Territory is the other: a claim cannot exist on Commons ground,
 * so the bond, the two exits and the Charge's own ballot are all unreachable. And §16.6 MUST-1
 * forbids a campaign DEPOT in the Commons — *"the one place nobody may attack cannot also be the
 * staging ground for attacking everywhere else"* — which is why `build{CAMPAIGN}` is here and
 * `join{CAMPAIGN}` is **not**: a Commons principal really is offered both sides of a distant war.
 */
const COMMONS_CANNOT_HOLD: ReadonlySet<string> = new Set([
  // A8.
  'yield', 'fight', 'demand', 'engage', 'join{RAID}',
  // Territory is outside the Commons.
  'post_bond', 'abandon{CLAIM}', 'deliver{CHARGE}', 'vote{CHARGE}',
  // §16.6 MUST-1, and only an attacker lifts its own war.
  'build{CAMPAIGN}', 'withdraw{CAMPAIGN}',
  // ★ AND `join{CAMPAIGN}`, WHICH THIS SET KEPT AND THE ENGINE NOW REFUSES.
  //
  // 24's own open findings named it: *"`join {campaign, side}` has no tier gate — a Commons-seated
  // principal is offered both sides of a war two tiers away, and its hands are Commons-bound so it
  // can never reach the objective."* `campaign/roster.ts` refuses it outright as of `RULES_VERSION`
  // 28, so keeping the token here would make this fixture assert something the engine cannot
  // produce — the exact fault the docblock on `offeredExcept` warns about one screen down.
  //
  // The character consequence is the same one measured at 24 and it is the reason to check rather
  // than assume: with the token still here, the Commons row grew a whole section of §11G for an
  // act A8 and A15 jointly make impossible. That is §11E's defect, for the third time, inside the
  // fixture built to measure §11E's defect.
  'join{CAMPAIGN}',
]);

/** Verbs and acts a **landless** holding is never offered: there is no claim to bill or cede. */
const LANDLESS_CANNOT_HOLD: ReadonlySet<string> = new Set([
  'abandon{CLAIM}', 'deliver{CHARGE}', 'vote{CHARGE}',
]);

/**
 * {@link EVERY_SITUATION}'s verbs and acts minus one exclusion set. Derived, never typed out.
 *
 * The alternative was a second hand-written list per position, and a fixture that keeps
 * `join{RAID}` while dropping `join` is asserting something the engine cannot produce — which is
 * exactly how the `##` version's arithmetic went wrong. One set covers both, because an act token
 * is excluded either by name or by its verb being excluded.
 */
function offeredExcept(cannotHold: ReadonlySet<string>): {
  readonly verbs: Set<string>;
  readonly acts: Set<string>;
} {
  return {
    verbs: new Set([...EVERY_SITUATION.verbs].filter((verb) => !cannotHold.has(verb))),
    acts: new Set(
      [...EVERY_SITUATION.acts].filter(
        (act) => !cannotHold.has(act) && !cannotHold.has(act.slice(0, act.indexOf('{'))),
      ),
    ),
  };
}

/** Nothing held, nothing offered. The other end of the range. */
export const NO_SITUATION: ContractSituation = Object.freeze({
  verbs: new Set<string>(),
  acts: new Set<string>(),
  inCommons: false,
  commonsBound: false,
  outsideCommons: false,
  inVenture: false,
  inCampaign: false,
  holdsGrant: false,
  inSyndicate: false,
  holdsClaim: false,
  inArrears: false,
  anchorCold: false,
  underRaid: false,
  nearStandoff: false,
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
 * was free. At `###` granularity there are sixty-four: 2^55 is not enumerable, and it
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
      // ── ★ `build{WORKS}`, AND *NOT* `build{CAMPAIGN}` — MEASURED, NOT ASSUMED ──
      //
      // ══════════════════════════════════════════════════════════════════════════
      // This is the row the whole `acts` mechanism exists for. Gated on the VERB, §11E cost this
      // position **+3,543 characters — 8% of its excerpt — for a mechanic it cannot reach**: a
      // campaign needs a lane-adjacent CLAIMED system, twice a claim bond, and a depot, and §16.6
      // MUST-1 makes a Commons depot INVALID rather than merely refused. `observe.ts`'s own
      // withheld reason says so in as many words: *"a campaign's DEPOT may never be there (§16.6
      // MUST-1)"*.
      //
      // So `build{CAMPAIGN}` and `withdraw{CAMPAIGN}` are provably unreachable from the Commons —
      // the first needs the depot, the second is the attacker's own lift — and this row does not
      // declare them.
      // ══════════════════════════════════════════════════════════════════════════
      acts: new Set(['build{WORKS}']),
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
        // A role in a LIVE venture is offered both exits unconditionally (R5), and this row is
        // the maximal one that holds a role. Neither verb gates any unit any more — that is the
        // point — but a position that omits an offered verb is a ceiling checked against the
        // wrong thing.
        'withdraw', 'abandon',
      ]),
      acts: new Set(['build{WORKS}', 'refine{ALLOY}', 'vote{LEVY}', 'withdraw{VENTURE}', 'abandon{VENTURE}']),
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
      // A graduated holding CAN stage a campaign — the depot rule is what excludes the Commons,
      // not the lack of a claim — so this row keeps `build{CAMPAIGN}` and pays for §11E. It does
      // not keep `withdraw{CAMPAIGN}`: only the attacker of a LIVE campaign may lift one, and
      // that principal is `at war` below.
      acts: new Set(['build{WORKS}', 'refine{ALLOY}', 'vote{LEVY}', 'build{CAMPAIGN}']),
    },
  },
  {
    // ── ★ THE SIXTH POSITION, AND IT IS WHERE §11E's BILL BELONGS ─────────────
    //
    // Added with the `acts` gate, because the four rows above were each paying for the campaign
    // section and none of them was the principal that uses it. This one is: party to a live
    // campaign, offered all three of its acts, outside the Commons.
    //
    // ★ AND IT IS THE ROW THAT RECORDS AN ENGINE FINDING. `join {campaign, side}` has **no tier
    // gate at all** — `campaign/roster.ts:joinRefusal` asks for a seated holding and, for the
    // ATTACKER side, free capital — and `campaignViewsFor` returns every LIVE campaign to every
    // principal. Measured directly against the campaign fixture: a principal seated in the
    // COMMONS is offered both sides of a war two tiers away. So `join{CAMPAIGN}` is reachable
    // from anywhere, which is why the Commons rows above would legitimately grow §11E's
    // `join`-gated half the day a campaign exists — and why the two blocks they no longer carry
    // are the two that are gated on the acts a Commons holding provably cannot be offered.
    // ⚑ **THIS ROW IS ARGUED, NOT SWEPT, AND THE NEXT AUTHOR SHOULD KNOW WHICH.**
    //
    // The coverage test drives a heuristic world, and that world has never declared a campaign — a
    // 900-tick 8-member sweep offered `build {kind:"HULL"}` 133 times and `build {kind:"CAMPAIGN"}`
    // **zero**. So every other row here is checked against observations the engine really produced,
    // and the campaign acts on this one are checked against `campaign/roster.ts` and the campaign
    // fixture instead. Removing an act from a row that some *other* reachable row still dominates
    // is therefore invisible to the sweep — mutation-verified, and it changes no character, because
    // the units it would drop are `wanted` for the same population anyway.
    //
    // The day the cast declares a campaign unaided, re-run the sweep and this row earns its numbers.
    name: 'at war — party to a live campaign, offered every campaign act',
    reachable: true,
    situation: {
      ...NO_SITUATION,
      outsideCommons: true,
      inCampaign: true,
      inVenture: true,
      holdsWorks: true,
      canBuildWorks: true,
      verbs: new Set([
        'create', 'publish_offer', 'message', 'elect', 'seal', 'move', 'build', 'refine',
        'post_bond', 'deliver', 'vote', 'graduate', 'join', 'withdraw', 'haul',
      ]),
      acts: new Set([
        'build{WORKS}', 'refine{ALLOY}', 'vote{LEVY}',
        'build{CAMPAIGN}', 'join{CAMPAIGN}', 'withdraw{CAMPAIGN}',
        // ★ `message{TO}` at 31, and this row is the one the PARLEY exists for. A party to a live
        // campaign reaches its attacker, its defender, its roster and every holder in the
        // objective's constellation, so `api/observe.ts` offers it `message {to}` — and without
        // this token the fixture would have measured **zero** cost for the section written to fix
        // its own defect. Argued rather than swept, like the campaign acts above and for the same
        // reason: the heuristic cast has never declared a campaign.
        'message{TO}',
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
      // See CLAIMANT_CANNOT_HOLD: six verbs come off, each for a reason in the engine, and their
      // acts come off with them — see `offeredExcept`.
      ...offeredExcept(CLAIMANT_CANNOT_HOLD),
    },
  },
  // ══════════════════════════════════════════════════════════════════════════════
  // ★ THE TWO ROWS BELOW EXIST BECAUSE THE COVERAGE TEST WAS **VACUOUS**.
  //
  // *"★ THE POSITIONS DOMINATE A REAL WORLD — swept, not assumed"* asks whether some declared
  // position dominates every situation a live world produces, and it could never fail: the
  // analytic ceiling has **every fact true and every verb offered**, so it dominates anything by
  // construction. The assertion was therefore a tautology dressed as coverage — this project's
  // signature defect (an invariant whose subject cannot occur) inside the guard written to stop the
  // position list going stale.
  //
  // It had gone stale, and not slightly. Requiring a **reachable** position to dominate, and
  // sweeping the same 6-member 240-tick world the test already drives, **120 of 120 observations
  // escaped** — every single one. So the unreachable ceiling row was doing 100% of the coverage and
  // the four rows the budget is quoted by covered *nothing the world actually produces*.
  //
  // The fact every escape carried is `endowmentWithheld`, which is true of essentially every member
  // of every world this repo has run (D7) and which no reachable row declared. Also missing: a
  // Commons member inside a syndicate, and a graduated landless member with a raid standing.
  //
  // The five named rows above are deliberately NOT widened to fix that — they are quoted in
  // reports and changing what they mean would make every historical number incomparable. These two
  // are the maximal rows for the two landless tiers, so the guard has something real to hold, and
  // each is derived by SUBTRACTION from the analytic ceiling with the engine's own reason per
  // exclusion. `prompt.test.ts` now requires domination by a reachable row and names the escape.
  // ══════════════════════════════════════════════════════════════════════════════
  {
    name: 'the Commons at its fullest — every fact and act A8 and §11B leave reachable inside it',
    reachable: true,
    situation: {
      ...EVERY_SITUATION,
      outsideCommons: false,
      holdsClaim: false,
      inArrears: false,
      anchorCold: false,
      // A8 makes hostile action here INVALID, so nothing stands against it and no battle is live.
      underRaid: false,
      inBattle: false,
      // ★ And nothing is NEAR it either, which is one clause further than it looks. `nearStandoff`
      // is *"a live standoff somebody else is in, that a hand of mine could reach"* — and a
      // Commons-bound principal's hands may not leave the Commons at all (`commonsBoundRejection`),
      // while A8 forbids a raid inside it. So both ends are closed and `marchTo` returns null for
      // this principal against every stage in the galaxy.
      //
      // Measured before this line: the row inherited `true` from `EVERY_SITUATION` and grew **890
      // characters** of coalition rules for an act it can never perform — §11E's defect, in the
      // fixture that exists to measure §11E's defect.
      nearStandoff: false,
      ...offeredExcept(COMMONS_CANNOT_HOLD),
    },
  },
  {
    name: 'outside the Commons and landless, at its fullest — a raid standing, no ground to bill',
    reachable: true,
    situation: {
      ...EVERY_SITUATION,
      inCommons: false,
      commonsBound: false,
      holdsClaim: false,
      inArrears: false,
      anchorCold: false,
      ...offeredExcept(LANDLESS_CANNOT_HOLD),
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
 *
 * ★ **`risk` (§12.1's eleventh key) is droppable, and it is placed by RECOVERABILITY.** The order
 * is *how much of this key survives in the keys that stay*: `market`'s prices are re-derivable from
 * the `trade` affordances, `counterparties`' standing rows are on `header.standing` and in the
 * `message` affordances, `grants`' acts are all on the menu. `risk` sits after those and before
 * `holding` for a stated reason rather than a feel: its three verbs — `publish_offer {kind:"COVER"}`,
 * `sign {cover}`, `elect {cover}` — arrive in `affordances[]` with exact `max_direct_loss` and
 * `expires_tick`, so a dropped `risk` still leaves every risk *act* priced and reachable. What is
 * genuinely lost is the forecast, which is why it is not first to go.
 *
 * **A key added and left out of this list would silently join the never-dropped set**, which is the
 * kind of widening nobody would notice for a year. Hence it is here rather than only in
 * `OBSERVE_KEYS`.
 */
export const DROP_ORDER: readonly string[] = Object.freeze([
  'market',
  'counterparties',
  'grants',
  'risk',
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
  const affordances = list(observation['affordances']).map(obj);

  return {
    verbs: new Set(affordances.map((a) => String(a['verb']))),
    // ★ The act half, from the SAME rows, by the same rule for every verb. Not a second source of
    // truth: one pass over `affordances[]` produces both, so a verb can never be present without
    // its acts or an act without its verb.
    acts: new Set(affordances.flatMap((a) => actTokensOf(String(a['verb']), a['params']))),
    inCommons: tier === 'COMMONS',
    commonsBound: holding['commons_bound'] === true,
    // Not `!inCommons`: an observation with no `holding` at all must not read as "predation can
    // reach you", because that would ship §11D to a stub and, worse, read as a fact.
    outsideCommons: tier === 'MARCHES' || tier === 'FRONTIER',
    inVenture: list(ventures['mine']).length > 0,
    // `holding.campaigns[]` is every campaign this principal can SEE — §12.1's siege-clock slot — so
    // the party test is `your_side`, never the row's existence. Reading it as `length > 0` would make
    // every principal in the galaxy a party to every war, which is the `holding.sovereignty !== null`
    // mistake `situationalFocus` was caught making one function down.
    inCampaign: list(holding['campaigns']).some((row) => obj(row)['your_side'] !== null),
    holdsGrant: list(grants['granted']).length > 0 || list(grants['held']).length > 0,
    inSyndicate: list(grants['syndicates']).length > 0,
    holdsClaim: claims.length > 0,
    inArrears: claims.some((claim) => Number(claim['arrears'] ?? 0) > 0),
    anchorCold: claims.some((claim) => claim['anchor_hot'] === false),
    // ── ★ `your_side`, NOT `length` — AND THE COALITION WAVE IS WHY ───────────
    //
    // ══════════════════════════════════════════════════════════════════════════
    // This read `length > 0`, which was true of `obligations.raid[]` for as long as that list held
    // only standoffs the reader was a party to. `RULES_VERSION` 24 widened `raidViewsFor` to include
    // **a live standoff a hand could still walk to**, so the list now carries rows about other
    // principals — and `length > 0` silently turned every bystander into a target.
    //
    // What that ships: §11D's preamble and `### Answering either one` are both `required` on this
    // field, and they document `yield` and `fight`, which only the TARGET may send. So a member
    // nothing stands against would be handed the deadline rules for somebody else's deadline. That
    // is §11E's defect exactly — a rules surface reaching a population that cannot perform the act —
    // and it is `inCampaign`'s mistake verbatim: *"reading it as `length > 0` would make every
    // principal in the galaxy a party to every war."* Two waves, one predicate, same error.
    //
    // The field's own doc says *"a demand or a world raid stands against **it**"*, so `length` was
    // already the wrong reading of a correct sentence.
    // ══════════════════════════════════════════════════════════════════════════
    underRaid: list(obligations['raid']).some((row) => obj(row)['your_side'] === 'TARGET'),
    // ★ The other half of the same split: a standoff somebody ELSE is in, close enough to reach.
    //
    // `your_side === null` is *"in the list and not in the fight"*, and the list is already the
    // reachable set — `raidViewsFor` returns a non-party row only when this principal has an IDLE
    // hand at the stage or one that could march there before the window shuts. So this is exactly
    // §9's escort-market demand side as the reader sees it, and it needs its own field for
    // `inCampaign`'s reason: **no verb announces it.** A bystander standing at the stage is offered
    // `join`; a bystander two lanes off is offered `move`, which every principal alive is offered
    // for every hand it owns — so gating the coalition rules on the verb would make them either free
    // to everybody or invisible to the reader who is walking.
    nearStandoff: list(obligations['raid']).some((row) => obj(row)['your_side'] === null),
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
 * A unit one of whose `verbs` — **or one of whose `acts`** — is offered in `affordances[]` is
 * `RULES`: checked before any per-unit predicate, and `RULES` is never dropped for any reason
 * including length. That ordering is the whole safety argument: an agent is refused for breaking
 * a rule it was given, never for one it was not. There are sixty-four units; put the same rule
 * inside each predicate and the forty-fifth will forget it.
 *
 * ── ★ `acts` IS A SECOND DISCRIMINATOR AT THE SAME PRECEDENCE, NOT A WEAKER ONE ──
 *
 * The two loops are adjacent and both sit above `required`/`wanted`, so the property does not
 * change shape when a unit moves from a verb gate to an act gate: **whatever is offered, its
 * rules ship.** What changes is only the aim — `build` matched four acts and now matches the
 * ones a unit says it documents. `prompt.test.ts` walks every verb AND every act of every unit
 * and asserts that offering it alone pulls that unit in at `RULES`, and asserts the walk is
 * non-vacuous (a unit whose lists have both been emptied is caught by the pinned map, because an
 * empty list means the loop body never runs and an exhaustive test over it proves nothing).
 * ══════════════════════════════════════════════════════════════════════════════
 */
export function unitGrade(unit: ContractUnit, situation: ContractSituation): UnitGrade {
  if (unit.floor === true) return 'FLOOR';
  for (const verb of unit.verbs) {
    if (situation.verbs.has(verb)) return 'RULES';
  }
  for (const act of unit.acts ?? []) {
    if (situation.acts.has(act)) return 'RULES';
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
