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
   * it is why the selector — not each section's own predicate — is what maps a verb to
   * its rules: see {@link sectionIsNeeded}.
   */
  readonly verbs: ReadonlySet<string>;
  readonly inCommons: boolean;
  readonly commonsBound: boolean;
  /** It holds a role in at least one live venture, so settlement is about to happen to it. */
  readonly inVenture: boolean;
  /**
   * It has issued authority, or holds authority somebody else issued.
   *
   * **This covers syndicate offices too, and that is why there is no separate
   * `inSyndicate`.** `observe` builds `grants.granted` as this principal's own grants *plus*
   * every office issued by a syndicate it sits in, so a house with an office over its
   * treasury already reads `true` here. Measured on a 900-tick world: adding `inSyndicate`
   * as its own trigger selected §10 on a further **562 of 1,548 wakes** — 36% — for members
   * that held no authority, had issued none, and were offered no grant verb. Those were
   * syndicates with no office in existence yet, so there was nothing in §10 to act on.
   */
  readonly holdsGrant: boolean;
}

/** One section of the player contract, with the rule for whether THIS wake needs it. */
export type ContractSection =
  | {
      readonly heading: string;
      /** In every excerpt, whatever the observation says. See {@link CONTRACT_CATALOG}. */
      readonly floor: true;
      readonly verbs: readonly string[];
    }
  | {
      readonly heading: string;
      readonly floor: false;
      readonly verbs: readonly string[];
      /** Facts other than an offered verb that make this section needed. */
      readonly standing: (situation: ContractSituation) => boolean;
      /** One clause, printed in the prompt when the section is left out. */
      readonly because: string;
    };

/**
 * The `agent.md` sections the cast plays from, in document order, each with the rule for
 * whether a given wake needs it.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * **WHY THIS IS A CATALOG WITH PREDICATES AND NOT A LIST.**
 *
 * It was a flat list, and every member got every section every wake. That was right when
 * `agent.md` was 300 lines. At ~1,070 the excerpt measured **37,902 of a 38,000 bar** — about
 * a hundred characters of room — and the two changes before this one each had to *trim real
 * rules prose* to land, one of them compressing a verbatim sovereignty statement down to a
 * numbers check because a faithful copy pushed the excerpt to 39,706. At ~40,000 the next
 * section added would silently drop **§12 Getting good** off the end: no error, the cast just
 * stops being told part of the game. That is scar #1's class exactly.
 *
 * So the fix is not a bigger ceiling, it is not shipping rules a member cannot use this wake.
 * A member with no venture does not need §4's formation rules; one that has never been
 * granted authority does not need §10's office rules yet; one whose holding has left the
 * Commons does not need §11. The observation already says which of those are true.
 *
 * ── THE GUARANTEE, AND WHERE IT LIVES ────────────────────────────────────────
 *
 * Getting this wrong is worse than the ceiling was: an agent that acts without a rule it
 * needed is refused for something it was never told, and a refusal costs it a real action
 * out of four (AGT-S2). So the rule that matters is **not** in any individual predicate,
 * where one could be forgotten. It is in {@link sectionIsNeeded}: *a section whose verb is
 * offered in `affordances[]` is always included.* `verbs` below is that map, and
 * `prompt.test.ts` asserts every verb the ENGINE implements has a home — in the catalog or
 * in {@link CONTRACT_NOT_EXCERPTED} — so a verb can never be silently rules-less.
 *
 * ── WHY THESE EIGHT ARE FLOOR ────────────────────────────────────────────────
 *
 * Identity and the loop (§1), what a principal *is* — hands, holding, standing (§3), the
 * clock and the Reckoning and the Levy (§5), how to read the payload it is holding (§6),
 * the verbs and the four-actions budget and *"an illegal action is not an error"* (§7), the
 * five privacy tiers (§8), where goods come from (§11A), and the standing advice that tells
 * it to read `briefing.if_you_do_nothing` first (§12).
 *
 * Each is either unconditional machinery or a rule whose absence makes a member **misread
 * its own position** rather than merely miss an option. §11A is floor for a reason worth
 * naming: it is the only source of goods in the world, the endowment covers about two
 * Reckonings of Levy, and a member with a covered Levy and no WORKS is the one most in need
 * of it. It was dropped once, disclosed, and the cast watched its shortfall climb with no
 * idea what to do — the same reachability failure as a verb that is legal and never offered.
 *
 * ── WHAT IS STILL DELIBERATELY OUTSIDE ──────────────────────────────────────
 *
 * {@link CONTRACT_NOT_EXCERPTED}, and it is now NAMED IN THE PROMPT rather than left to
 * silence.
 *
 * `agent.md` numbers its headings, and the number is part of the match: a section
 * renumbered is a section reordered, and the cast should notice — {@link loadContractDocument}
 * returns `null` for a heading that moved, whatever this wake needs.
 * ══════════════════════════════════════════════════════════════════════════════
 */
export const CONTRACT_CATALOG: readonly ContractSection[] = Object.freeze([
  { heading: '## 1. The loop', floor: true, verbs: [] },
  { heading: '## 3. What you have', floor: true, verbs: [] },
  {
    heading: '## 4. Work happens in ventures',
    floor: false,
    // The venture row of §7's verb table, whole. §4 is where every one of them is explained.
    verbs: ['create', 'publish_offer', 'message', 'fill_role', 'sign', 'elect', 'withdraw', 'abandon'],
    standing: (s) => s.inVenture,
    because: 'you hold no role in a live venture and no venture verb is offered to you this wake',
  },
  // The Levy and the ballot live here, so `deliver`, `set_delivery_intent` and `vote` do.
  { heading: '## 5. Time', floor: true, verbs: ['deliver', 'set_delivery_intent', 'vote'] },
  { heading: '## 6. Reading an observation', floor: true, verbs: [] },
  // §7 is the verb table itself and the production chain, and it is the only place `trade`
  // is documented at all. Floor, so the market is never a verb with no rules.
  { heading: '## 7. Acting', floor: true, verbs: ['trade'] },
  // Seals and the say-do gap are §8's second half, so `seal`, `claim` and `deny` are its verbs.
  { heading: '## 8. What is public, and what is not', floor: true, verbs: ['seal', 'claim', 'deny'] },
  {
    heading: '## 10. Granting authority',
    floor: false,
    // §10 covers `grant`/`revoke`/`audit` and says in as many words that the rest of the
    // office row needs syndicates and *"lands in a section of its own"* — §11C, which is in
    // CONTRACT_NOT_EXCERPTED. So those verbs are not claimed here.
    verbs: ['grant', 'revoke', 'audit'],
    standing: (s) => s.holdsGrant,
    because: 'you have issued no authority and hold none, including through any syndicate you sit in',
  },
  {
    heading: '## 11. The Commons',
    floor: false,
    // `move` is claimed here because §11 is where its REFUSAL rule lives — *"your hands may
    // only move between COMMONS systems"*. The refusal only applies inside the Commons,
    // which is exactly when this section is selected, so a graduated member loses nothing.
    verbs: ['graduate', 'move'],
    standing: (s) => s.inCommons || s.commonsBound,
    because: 'your holding has left the Commons and the crossing is behind you',
  },
  // The only source of goods in the game. Floor — see the note above.
  { heading: '## 11A. WORKS — the only reason goods exist', floor: true, verbs: ['build', 'refine', 'extract'] },
  { heading: '## 12. Getting good', floor: true, verbs: [] },
]);

/**
 * Every heading the catalog names, in document order.
 *
 * Kept as its own export because it is what the scar-#1 tests read: *"every section it asks
 * for exists in `agent.md`, verbatim"*. Selection changes which of these ship on a wake; it
 * never changes which of them must exist.
 */
export const CONTRACT_SECTIONS: readonly string[] = Object.freeze(
  CONTRACT_CATALOG.map((section) => section.heading),
);

/**
 * Sections of `agent.md` the cast is never shown, each with the reason — **and the prompt
 * prints this list.**
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * Three of these were a silent hole until now, and two test comments recorded it with a
 * shrug (*"which costs the cast contract nothing because `CONTRACT_SECTIONS` excerpts §11
 * and §11A and not §11B"*). The cost is not nothing: `post_bond` lives only in §11B,
 * `yield`/`fight`/`join`/`demand` only in §11D, and `admit`/`form`/`apply`/`approve` only in
 * §11C. A member offered `yield` tonight has never been given the rules for it.
 *
 * They stay out because they do not fit, and the arithmetic is worth writing down so the
 * next person does not have to rediscover it. Against a 38,000 bar and a 20,976-character
 * floor: §11D is 4,606 and is only ever needed *outside* the Commons, so it trades against
 * §11's 4,070 — a maximal member lands at **38,418**, over by 418. §11C is 3,741 and trades
 * against nothing. §11B is **8,491** and cannot fit at any arrangement of `##` sections.
 *
 * Closing the hole therefore needs a decision this change is not the place for: select at
 * `###` granularity (§4's 7,600 becomes 3,656 for a member offered only `create`; §11's
 * 4,070 becomes 786 for one that cannot graduate yet), or shorten §4 and §11A, or raise the
 * ceiling on cost grounds. What this change does is make the hole **legible**: every wake's
 * prompt names these sections, and `prompt.test.ts` fails if a live verb's only home is one
 * of them without this list saying so.
 * ══════════════════════════════════════════════════════════════════════════════
 */
export const CONTRACT_NOT_EXCERPTED: readonly {
  readonly heading: string;
  readonly because: string;
  /**
   * Live verbs whose ONLY rules are in this section. **Nine of them, and that is the size of
   * the hole**, counted rather than described: `prompt.test.ts` asserts every verb the engine
   * implements is claimed either by {@link CONTRACT_CATALOG} or here, so the number can never
   * grow quietly.
   */
  readonly verbs: readonly string[];
}[] = Object.freeze([
  { heading: '## 2. Enrolling', because: 'you were seated at boot and never enrol', verbs: [] },
  { heading: '## 9. Being offline', because: 'you run in-process and are never offline', verbs: [] },
  {
    heading: '## 11B. Sovereignty — territory you have to MAINTAIN',
    because: 'it does not fit; `holding.sovereignty` carries the one statement that applies to you, verbatim',
    verbs: ['post_bond'],
  },
  {
    heading: '## 11C. SYNDICATES — pooling, and the authority that comes with it',
    because: 'it does not fit; `grants.syndicates` carries your houses and their charters',
    verbs: ['form', 'apply', 'admit', 'approve'],
  },
  {
    heading: '## 11D. PREDATION — two kinds, and only one of them has a name',
    because: 'it does not fit; `obligations.raid` carries each demand with its deadline and the cost of every branch',
    // ── `engage` JOINS THE FOUR, AND IT HAS NO SECTION AT ALL YET ──────────────
    //
    // §9A's combat layer landed after this table did, and its rules text is **not in
    // `agent.md`** — it was written and deliberately not committed there, because §11D is
    // already over the excerpt bar and the `###`-granularity work that will make room for it
    // owns that file. So `engage` is claimed here rather than in the catalog: the honest
    // statement is that its rules live nowhere a member can read yet, and the guard exists
    // precisely so that cannot be silent.
    //
    // What stands in for the section meanwhile is the affordance itself. `combat/view.ts`
    // builds `what_it_forecloses` as a **paragraph**, naming the hull's EHP, its alpha, its
    // role tags, its capacitor endurance, the hostile hull count, the withdrawal threshold and
    // the fact that a committed hull can be destroyed permanently. That is more than §11D
    // gives the four verbs above it, and it arrives on every wake where the act is legal.
    verbs: ['yield', 'fight', 'join', 'demand', 'engage'],
  },
  {
    heading: '## 13. When something seems wrong',
    because: 'it is a bug-report channel you cannot reach from a plan',
    verbs: [],
  },
]);

/**
 * The situation that needs everything — what {@link loadContract} selects for when there is
 * no observation to read.
 *
 * Not a default for the live path. It exists so "the whole catalog" is expressible in the
 * same terms as any other wake, rather than as a second code path that could disagree with
 * the first one.
 */
export const EVERY_SITUATION: ContractSituation = Object.freeze({
  verbs: new Set(CONTRACT_CATALOG.flatMap((section) => [...section.verbs])),
  inCommons: true,
  commonsBound: true,
  inVenture: true,
  holdsGrant: true,
});

/**
 * Hard ceiling on the contract excerpt. *(calibrate)*
 *
 * Overflow drops whole sections from the **end** of {@link CONTRACT_SECTIONS} and says which,
 * in the prompt, so the model is never quietly playing from a truncated rulebook.
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
 * ## 40k stays, and the question above is now ANSWERED — {@link CONTRACT_CATALOG}
 *
 * The ceiling did not move a third time. The excerpt did: a wake now carries the floor plus the
 * sections the *observation* says the member is standing in, and nothing else. Measured against
 * the same 38,000 bar the previous two raises were caught by:
 *
 * | a wake | of 38,000 |
 * |---|---|
 * | newcomer, Commons, no venture, no grant | **25,062** (66%) |
 * | mid-game, Commons, in ventures, no grant | **32,666** (86%) |
 * | claim-holding, out of the Commons, in ventures, holds a grant | **33,832** (89%) |
 * | every conditional at once — the ceiling of the catalog | **37,902** (99.7%) |
 *
 * **Read the last row before adding a section.** Selection bounds the *typical* excerpt; it
 * cannot bound the maximum, because the maximum is the catalog and always will be. So the
 * headroom this buys is conditional headroom: a section needed only by claimants costs a
 * Commons newcomer nothing, and `prompt.test.ts` enumerates **all eight** combinations of the
 * conditionals and fails on the one that breaks the bar, naming it. That is a far better
 * instrument than one number over one blob — a failure now tells you which situation to make
 * the new section conditional on, instead of only that you are out of room.
 *
 * The next 8,000 characters, if they are needed, are at `###` granularity: §4's 7,600 is 3,656
 * for a member offered only `create`, and §11's 4,070 is 786 for one that cannot graduate yet.
 * That is left undone on purpose — a `##` section shipped without one of its `###` blocks looks
 * complete and is not, which is nearer scar #1 than omitting the section outright.
 */
export const MAX_CONTRACT_CHARS = 40_000;

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

/** A section left out of a wake's excerpt, and why. Printed in the prompt. */
export interface ContractOmission {
  readonly heading: string;
  readonly because: string;
}

export interface ContractExcerpt {
  readonly text: string;
  /** Sections actually included, in order. */
  readonly sections: readonly string[];
  /** Sections that did not fit under {@link MAX_CONTRACT_CHARS}. Usually empty. */
  readonly dropped: readonly string[];
  /**
   * Sections this wake's situation does not touch, each with its reason.
   *
   * A separate word from `dropped` on purpose: *did not fit* and *not needed here* are two
   * different facts about the world and a reader has to be able to tell them apart. One is
   * a budget problem and one is the design working.
   */
  readonly notThisWake: readonly ContractOmission[];
}

/**
 * `agent.md`, parsed and validated once.
 *
 * Split from the excerpt because the excerpt is now per-wake: the document is read from
 * disk once at cast construction, and every wake selects from this. Re-reading a 63 KB file
 * per member per tick would be a filesystem call inside the tick, for no gain.
 */
export interface ContractDocument {
  readonly bodies: ReadonlyMap<string, string>;
}

/**
 * Read `agent.md` and check that every section the catalog names is still there.
 *
 * Resolved by the **same URL expression `server.ts` uses** (`../../agent.md` relative to
 * the module), so the compiled `dist/cast/prompt.js` and the source both land on
 * `engine/agent.md`, and the cast and the API can never be reading two different files.
 *
 * Returns `null` — and the caller disables the LLM cast — when the file cannot be read
 * or when **any** catalogued section is missing, *including one no current wake needs*.
 * See the module note: a missing section is a rules surface that moved, and the safe
 * response to that is to stop, not to guess.
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

  const bodies = new Map<string, string>();
  for (const chunk of raw.split(/\n(?=## )/)) {
    const heading = (chunk.split('\n', 1)[0] ?? '').trim();
    bodies.set(heading, chunk.trim());
  }

  // The scar-#1 tripwire, and it fires on the whole catalog rather than on this wake's
  // selection: a heading that moved is a rules surface that moved either way, and a
  // selection that happens not to want it this tick must not hide that.
  for (const section of CONTRACT_CATALOG) {
    if (!bodies.has(section.heading)) return null;
  }
  return { bodies };
}

/**
 * Read the situation off one observation. The only input to selection.
 *
 * Typed loosely on purpose — it is handed the same `Observation` the member is about to be
 * shown, and it must not fall over on a partial one (`relations.spec.ts` builds a two-key
 * stub). A missing key reads as "no", which is the safe direction only because
 * {@link sectionIsNeeded} keys the guarantee on `affordances[]`, and a member with no
 * affordances has nothing to be refused for.
 */
export function readSituation(observation: Readonly<Record<string, unknown>>): ContractSituation {
  const obj = (value: unknown): Record<string, unknown> =>
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

  const holding = obj(observation['holding']);
  const grants = obj(observation['grants']);
  const ventures = obj(observation['ventures']);

  return {
    verbs: new Set(list(observation['affordances']).map((a) => String(obj(a)['verb']))),
    inCommons: String(holding['tier']) === 'COMMONS',
    commonsBound: holding['commons_bound'] === true,
    inVenture: list(ventures['mine']).length > 0,
    holdsGrant: list(grants['granted']).length > 0 || list(grants['held']).length > 0,
  };
}

/**
 * Does this wake need this section?
 *
 * **THE GUARANTEE IS THE SECOND CLAUSE AND IT LIVES HERE, NOT IN THE PREDICATES.**
 *
 * A section whose verb is offered in `affordances[]` is included, always, before any
 * per-section predicate is consulted. That ordering is the whole safety argument: an
 * agent is refused for breaking a rule it was given, never for one it was not. Put the
 * same rule inside eleven separate predicates and the twelfth will forget it.
 */
export function sectionIsNeeded(section: ContractSection, situation: ContractSituation): boolean {
  if (section.floor) return true;
  for (const verb of section.verbs) {
    if (situation.verbs.has(verb)) return true;
  }
  return section.standing(situation);
}

/**
 * Cut the excerpt for one wake.
 *
 * ── WHY THE FLOOR COMES FIRST AND NOT DOCUMENT ORDER ─────────────────────────
 *
 * The contract is the first system message, so a provider that discounts a repeated prefix
 * does — measured live at 6,498 of 6,543 prompt tokens cached. Selection puts that at risk,
 * because two members in different situations no longer share a byte-identical message. In
 * document order the first conditional (§4) starts at character 1,530, so the shared prefix
 * would collapse to 1,530 characters for any two members who disagree about it.
 *
 * Floor first, in one fixed order for everybody, keeps a **20,976-character prefix identical
 * for every member on every wake** — and members who agree on their conditionals share more.
 * The order is fixed globally and never permuted per member, which is the property that
 * matters; a per-member ordering would have exactly the problem this avoids.
 *
 * The cost is that § numbers are no longer ascending across the whole excerpt. They are
 * ascending within each block, they are `agent.md`'s own numbers, and the excerpt says what
 * the order is — which is cheaper than losing the cache.
 */
export function excerptFor(
  document: ContractDocument,
  situation: ContractSituation,
  maxChars: number = MAX_CONTRACT_CHARS,
): ContractExcerpt {
  const needed = CONTRACT_CATALOG.filter((section) => sectionIsNeeded(section, situation));
  const notThisWake = CONTRACT_CATALOG.filter(
    (section) => !sectionIsNeeded(section, situation),
  ).map((section) => ({
    heading: section.heading,
    // Unreachable for a floor section: `sectionIsNeeded` returns true for those first.
    because: section.floor ? 'floor' : section.because,
  }));

  const ordered = [...needed.filter((s) => s.floor), ...needed.filter((s) => !s.floor)];

  const kept: string[] = [];
  const dropped: string[] = [];
  const parts: string[] = [];
  let used = 0;
  for (const section of ordered) {
    const body = document.bodies.get(section.heading);
    if (body === undefined) {
      // Cannot happen: `loadContractDocument` refuses a document missing any catalogued
      // heading. Recorded rather than thrown, because a cast that stops mid-Reckoning is
      // worse than one that names the gap.
      dropped.push(section.heading);
      continue;
    }
    // `+ 2` for the join, so the budget counts the string that is actually built rather
    // than a number two characters smaller per section than the truth.
    const cost = body.length + (parts.length === 0 ? 0 : 2);
    if (used + cost > maxChars) {
      dropped.push(section.heading);
      continue;
    }
    used += cost;
    kept.push(section.heading);
    parts.push(body);
  }

  return { text: parts.join('\n\n'), sections: kept, dropped, notThisWake };
}

/**
 * The whole catalog, for a caller with no observation to select from.
 *
 * Used by the tests and as the shape-preserving default. It is the *ceiling* of the
 * catalog, not what any live wake ships — `llm.ts` selects per wake through
 * {@link excerptFor}.
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
  if (holding['sovereignty'] !== null && holding['sovereignty'] !== undefined)
    focus.push('§11B Sovereignty — you hold territory that has to be MAINTAINED');
  if (((obligations['charge'] ?? []) as unknown[]).length > 0)
    focus.push('§11B The Charge — a bill falls due on your claim this Reckoning');
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
 * wake** (the design working), **did not fit** (a budget problem, and it should never fire —
 * `prompt.test.ts` enumerates the reachable selections), and **never excerpted** (a standing
 * decision, listed with its reason in {@link CONTRACT_NOT_EXCERPTED}).
 */
function absenceNotice(contract: ContractExcerpt): string {
  const clauses = [
    ...contract.notThisWake.map((o) => `${o.heading} — ${o.because}`),
    ...contract.dropped.map((heading) => `${heading} — it did not fit, which is a bug worth reporting`),
    ...CONTRACT_NOT_EXCERPTED.map((o) => `${o.heading} — ${o.because}`),
  ];
  if (clauses.length === 0) return '';
  return (
    `(NOT IN THIS EXCERPT, and why: ${clauses.join('; ')}. Nothing above is paraphrased and ` +
    'nothing is hidden — every section is verbatim, and the complete document is `agent.md`, ' +
    'served at GET /compact/api/agent.md.)'
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
      'It carries the sections every principal needs, then the sections YOUR position touches —',
      'which is why the § numbers restart once. They are the document’s own numbers, in two',
      'blocks. What is not here is named at the end, with the reason.',
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
