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
 * And when it cannot: {@link loadContract} returns `null` if a required section is
 * missing, which **disables the LLM cast** and falls the world back to heuristics.
 * Refusing to play is the correct failure. A cast prompted from a stale private copy of
 * the rules is exactly the bug above, and it would be invisible.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { readFileSync } from 'node:fs';
import type { Observation } from '../api/observe.js';
import type { CastCharacter } from './characters.js';
import { FREE_VERBS } from '../tick/budget.js';
import { STANCE_CREED } from './characters.js';
import type { CompletionMessage } from './transport.js';

/**
 * The `agent.md` sections a player needs in order to *decide*, by heading prefix.
 *
 * Chosen by what a seated principal actually uses, and the omissions are as deliberate
 * as the inclusions: **§2 Enrolling** (the cast is seated at boot and never enrols),
 * **§9 Being offline** (the cast is in-process and never is), and **§13 When something
 * seems wrong** (a bug-report channel a member cannot usefully reach) are all left out.
 * Everything a decision depends on is in.
 *
 * `agent.md` numbers its headings, and the number is part of the match: a section
 * renumbered is a section reordered, and the cast should notice.
 */
export const CONTRACT_SECTIONS: readonly string[] = Object.freeze([
  '## 1. The loop',
  '## 3. What you have',
  '## 4. Work happens in ventures',
  '## 5. Time',
  '## 6. Reading an observation',
  '## 7. Acting',
  '## 8. What is public, and what is not',
  '## 10. Granting authority',
  '## 11. The Commons',
  // §11A carries the ONLY source of goods in the game. Omitting it left a cast that could
  // read its own Levy shortfall rising every Reckoning and had no idea what to do about it —
  // the same reachability failure as a verb that is legal and never offered, one layer out.
  '## 11A. WORKS — the only reason goods exist',
  '## 12. Getting good',
]);

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

export interface ContractExcerpt {
  readonly text: string;
  /** Sections actually included, in order. */
  readonly sections: readonly string[];
  /** Sections that did not fit under {@link MAX_CONTRACT_CHARS}. Usually empty. */
  readonly dropped: readonly string[];
}

/**
 * Read `agent.md` and cut out the sections a decider needs.
 *
 * Resolved by the **same URL expression `server.ts` uses** (`../../agent.md` relative to
 * the module), so the compiled `dist/cast/prompt.js` and the source both land on
 * `engine/agent.md`, and the cast and the API can never be reading two different files.
 *
 * Returns `null` — and the caller disables the LLM cast — when the file cannot be read
 * or when **any** required section is missing. See the module note: a missing section is
 * a rules surface that moved, and the safe response to that is to stop, not to guess.
 */
export function loadContract(
  source?: string,
  maxChars: number = MAX_CONTRACT_CHARS,
): ContractExcerpt | null {
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

  const kept: string[] = [];
  const dropped: string[] = [];
  const parts: string[] = [];
  let used = 0;
  for (const heading of CONTRACT_SECTIONS) {
    const body = bodies.get(heading);
    // The scar-#1 tripwire. A renamed or renumbered heading is a contract that moved.
    if (body === undefined) return null;
    if (used + body.length > maxChars) {
      dropped.push(heading);
      continue;
    }
    used += body.length;
    kept.push(heading);
    parts.push(body);
  }

  return { text: parts.join('\n\n'), sections: kept, dropped };
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
 * The order is load-bearing for cost as well as clarity: message 0 is **byte-identical
 * for every member on every wake**, so a provider that discounts a repeated prefix can.
 * The budget never assumes that discount — it prices every call at full rate — but there
 * is no reason to make the saving impossible.
 */
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
      input.contract.dropped.length === 0
        ? ''
        : `(${String(input.contract.dropped.length)} section(s) omitted for length: ${input.contract.dropped.join(', ')}.)`,
      '',
      '--- BEGIN PLAYER CONTRACT ---',
      input.contract.text,
      '--- END PLAYER CONTRACT ---',
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
      '  Your enrolment grant is the only goods you will ever be given, and it covers about two',
      '  Reckonings of Levy. After that you are short every night unless you are EXTRACTING.',
      '  A WORKS is the only thing in the game that makes goods.',
      '',
      '  A system yields a fixed amount per tick and every WORKS on it DIVIDES that amount. So',
      '  where you build decides what you earn: read `holding.works.here.share_per_tick`, which',
      '  already counts your own arrival, and remember it falls again when the next one arrives.',
      '  An empty frontier system is worth several times a crowded Commons one.',
      '',
      '  It costs EARNINGS, not your starter stake, and it extracts nothing while it spins up.',
      '  So the time to build is well before you need it, not the night the Levy comes due.',
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
