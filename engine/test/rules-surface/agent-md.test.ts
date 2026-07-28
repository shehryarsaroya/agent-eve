/**
 * SCAR-1 — `agent.md` is part of the rules surface, so it is under test.
 *
 * High Water's engine resolved votes as *stones protect the district they are
 * placed on*. The LLM players' prompt said stones decide *which district the
 * water drowns* — the exact inverse. Agents piled stones on the district they were
 * announcing they wanted destroyed, so the town reliably **saved what it meant to
 * drown**. It was verified live: six agents stoned Miller's Row while saying
 * "drown Miller's Row", and Miller's Row was saved.
 *
 * That bug survived the entire build and three critic passes because every
 * individual component was correct. The engine was right. The prompt was
 * internally coherent. Nothing compared them. **This file is that comparison.**
 *
 * It runs now, before the API exists, deliberately: written after the API it would
 * be a description of whatever the code happens to do, which is exactly how the
 * original bug got in. Written first, it is a contract the API has to meet, and
 * the diff is visible the moment they disagree.
 *
 * Right now the comparison is agent.md against SPEC.md, because the API does not
 * exist yet. When the verb registry and observation builder land, point these at
 * the ENGINE instead — the spec is a stand-in for the engine, and a doc that agrees
 * with the spec while the engine disagrees with both is still scar #1.
 */

import { describe, it, expect } from 'vitest';
import { TICKS_PER_RECKONING } from '../../src/core/time.js';
import {
  WORKS_BUILD_QTY,
  WORKS_COST_MINOR,
  WORKS_GOODS_IN_CURRENCY_MINOR,
  WORKS_PER_PRINCIPAL_PER_SYSTEM,
  WORKS_SPINUP_TICKS,
  YIELD_PER_TICK,
} from '../../src/works/params.js';
import { FOUNDING_COST_MINOR } from '../../src/syndicate/params.js';
import { VERB_ARRIVES_AT } from '../../src/api/verbs.js';
import { readFileSync } from 'node:fs';
// The engine's own sentence about the exit from the Commons. Imported rather than copied,
// which is the whole point of this file: a copy would be a third version of the rule.
import { GRADUATION_STATEMENT } from '../../src/world/index.js';
import {
  ARREARS_STATEMENT,
  CHARGE_STATEMENT,
  FUEL_STATEMENT,
  SOVEREIGNTY_STATEMENT,
} from '../../src/sovereignty/index.js';

const AGENT_MD = readFileSync(new URL('../../agent.md', import.meta.url), 'utf8');

const SPEC = readFileSync(new URL('../../../docs/design/SPEC.md', import.meta.url), 'utf8');

/** The verb list, parsed out of SPEC §12.2 rather than copied from it. */
function specVerbs(): ReadonlySet<string> {
  const block = SPEC.match(/### 12\.2 act\n\n```text\n([\s\S]*?)```/);
  if (block === null) throw new Error('SPEC §12.2 act block not found');
  const verbs = new Set<string>();
  for (const line of (block[1] ?? '').split('\n')) {
    if (!line.trim() || line.startsWith(' ')) continue;
    const rest = line.slice(line.indexOf(' ')).trim();
    for (const v of (rest.split('—')[0] ?? '').split('·')) {
      const t = v.trim();
      if (/^[a-z_]+$/.test(t)) verbs.add(t);
    }
  }
  return verbs;
}

/** The verb list as `agent.md` presents it to a player. */
function agentMdVerbs(): ReadonlySet<string> {
  const block = AGENT_MD.match(/```\nidentity {3}([\s\S]*?)```/);
  if (block === null) throw new Error('agent.md verb block not found');
  const verbs = new Set<string>();
  for (const line of `identity   ${block[1] ?? ''}`.split('\n')) {
    if (!line.trim()) continue;
    const rest = line.slice(line.indexOf(' ')).trim();
    for (const v of rest.split('·')) {
      // The dagger marks a RESERVED verb — in the vocabulary, no handler yet. Stripped here so this
      // parser keeps answering "which verbs does the document offer", which is a different question
      // from "which of them work". The second question has its own test below, pinned to
      // VERB_ARRIVES_AT, because conflating the two is how a reserved verb ends up looking live.
      const t = v.trim().replace(/†$/, '');
      if (/^[a-z_]+$/.test(t)) verbs.add(t);
    }
  }
  return verbs;
}

function specObserveKeys(): readonly string[] {
  const block = SPEC.match(/```text\n(header [\s\S]*?)```/);
  if (block === null) throw new Error('SPEC §12.1 observe block not found');
  return (block[1] ?? '')
    .split('\n')
    .filter((l) => l && !l.startsWith(' '))
    .map((l) => (l.split(/\s+/)[0] ?? ''));
}

function agentMdObserveKeys(): readonly string[] {
  const block = AGENT_MD.match(/```\nheader {12}([\s\S]*?)```/);
  if (block === null) throw new Error('agent.md observe block not found');
  return `header            ${block[1] ?? ''}`
    .split('\n')
    .filter((l) => l && !l.startsWith(' '))
    .map((l) => (l.split(/\s+/)[0] ?? ''));
}

describe('SCAR-1 — agent.md and the canon must agree', () => {
  it('parses both sides non-trivially, so a silent parse failure cannot pass this suite', () => {
    // The guard's own guard. A regex that quietly matches nothing would make every
    // assertion below vacuously true, which is the same failure shape as the bug.
    expect(specVerbs().size).toBeGreaterThan(30);
    expect(agentMdVerbs().size).toBeGreaterThan(30);
    expect(specObserveKeys().length).toBe(10);
    expect(agentMdObserveKeys().length).toBe(10);
  });

  it('offers a player exactly the verbs the canon defines — no extras, none missing', () => {
    // A verb in agent.md that the engine does not have teaches an agent to attempt
    // something impossible. A verb the engine has that agent.md omits is a
    // capability only readers of the spec know about, which is an unfair
    // information asymmetry in a game whose second goal is autonomy.
    // Explicit comparator: DET-1 bans a bare .sort() even on strings, because the
    // default is implementation-defined for anything else and the habit is what
    // matters. Byte order, like the canonical serialiser uses.
    const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
    const spec = [...specVerbs()].sort(cmp);
    const doc = [...agentMdVerbs()].sort(cmp);
    expect(doc).toEqual(spec);
  });

  it('names the same ten observation keys, in the same order', () => {
    // Order matters more than it looks: an agent reads this document once and then
    // pattern-matches on shape. §17's budget is at its ceiling at ten.
    expect(agentMdObserveKeys()).toEqual(specObserveKeys());
  });

  it('describes A7 the way the engine implements it, not the reverse', () => {
    // The single most load-bearing sentence pair in the document. If a player
    // believes escrowed and elective are the other way round, every deal it makes
    // is mispriced — and that is scar #1's exact shape with money attached.
    const escrowed = AGENT_MD.indexOf('**escrowed**');
    const elective = AGENT_MD.indexOf('**elective**');
    expect(escrowed).toBeGreaterThan(-1);
    expect(elective).toBeGreaterThan(escrowed);

    // Assert the exact table rows rather than a loose regex. An earlier version
    // matched /escrowed.*executes automatically/s and caught an inversion only by
    // the accident that "does not execute automatically" lacks the trailing "s" on
    // "execute". A guard that works by accident is the thing this file exists to
    // prevent, so both rows are pinned verbatim.
    expect(AGENT_MD).toContain(
      '| **escrowed** | locked up front | **executes automatically.** Nobody can stop it. |',
    );
    expect(AGENT_MD).toContain(
      '| **elective** | not locked | **does not execute automatically.** The payer chooses. |',
    );
    // And the rows are the right way round in the table, not merely both present.
    expect(AGENT_MD.indexOf('**executes automatically.** Nobody can stop it'))
      .toBeLessThan(AGENT_MD.indexOf('**does not execute automatically.** The payer chooses'));
    // And standing accrues only to the half that was at risk.
    expect(AGENT_MD).toContain('Standing accrues only to the elective half honoured');
    expect(SPEC).toContain('Standing accrues only to the elective part honoured');
  });

  it('tells the player the one thing about seals that must never be wrong', () => {
    // Agents may learn HONOURED | CONTRADICTED and nothing else, at any tier, on
    // any delay. If a player believes seal content leaks, it will either perform
    // for the seal or use it to monitor a cartel — and one of those makes a
    // collusive stalemate stable, which is the design's most likely real failure.
    expect(AGENT_MD).toMatch(/learn only \*\*`HONOURED`\*\* or \*\*`CONTRADICTED`\*\*\. Never the content/);
    expect(AGENT_MD).toContain('You cannot use seals to verify each other');
  });

  it('states the visibility split that makes reconnaissance worth paying for', () => {
    // "Movement is public, cargo is not" is the line that gives the map its motion
    // while keeping an ambush dependent on scouting. An agent that believes cargo
    // is public will raid blind; one that believes movement is private will not
    // understand why it was intercepted.
    expect(AGENT_MD).toContain('A ship at sea is visible; its manifest is not');
    expect(SPEC).toContain('A ship at sea is visible; its manifest is not');
  });

  it('promises the offline guarantees the engine is tested to provide', () => {
    // R19. These are the sentences an owner will hold us to, and E2E-16/17 are the
    // tests that make them true rather than reassuring.
    expect(AGENT_MD).toMatch(/never\*{0,2} costs your identity, your holding, or your standing/i);
    expect(AGENT_MD).toContain('cannot be widened while you are dark');
  });

  it('does not promise throughput matters, and says plainly that it does not', () => {
    // A4. Scar #2 shipped a game where wealth was determined by requests per
    // second. Saying so in the player-facing document is cheap and it stops an
    // agent wasting its budget on a strategy we have engineered to be worthless.
    expect(AGENT_MD).toContain('never by who arrived');
    expect(AGENT_MD).toContain('Sending requests faster does not help you');
  });

  it('tells the player how to report a wrong record, because that is the worst failure', () => {
    // A5′. A fabricated default libels a real agent permanently, in a system that
    // looks perfectly healthy. The players are the only sensor we have for it.
    expect(AGENT_MD).toContain('/compact/api/discrepancy');
    expect(AGENT_MD).toMatch(/worse than a crash/);
  });

  it('warns that it is itself a rules surface', () => {
    // The meta-guarantee. An agent that knows the document may be wrong will report
    // a mismatch instead of silently playing the wrong game for weeks.
    expect(AGENT_MD).toContain('It is part of the rules, not a description of them');
  });

  it('uses no canon term for a second concept', () => {
    // SPEC §3 is enforced across src/ by vocabulary-repo.test.ts. agent.md is the
    // other half of the same surface — arguably the more important half, since it is
    // what the model actually reads.
    const forbidden: ReadonlyArray<readonly [string, RegExp, string]> = [
      ['HOLDING', /holding[^.]{0,40}\b(assets|inventory|balances)\b/i,
        'HOLDING is your body on the map; assets are STORES'],
      ['STANDING', /standing[^.]{0,30}\bscore\b/i,
        'STANDING is the public factual vectors, never a score'],
      ['EXPOSURE', /exposure[^.]{0,40}\b(peril scope|value committed)\b/i,
        'EXPOSURE is Σ open max_direct_loss and nothing else'],
      ['MANDATE', /mandate[^.]{0,30}\bgrant\b/i,
        "MANDATE is the owner's published disposition, never a grant"],
    ];
    const violations: string[] = [];
    for (const [term, pattern, why] of forbidden) {
      if (pattern.test(AGENT_MD)) violations.push(`${term}: ${why}`);
    }
    expect(violations).toEqual([]);
  });

  it('names every agent-facing election the engine accepts', () => {
    // Found by a re-verifier, and it is scar #1's exact shape at the boundary: the
    // engine gained `IN_FULL` — the election that says "pay whatever is owed" — to fix
    // a case where a payer electing the exact figure it was quoted got recorded as
    // having DECLINED the difference when the venture over-performed. A fabricated
    // partial default against an agent that believed it was paying in full.
    //
    // But agent.md named no election shape at all, so the fix existed only on our side
    // of the wire. An agent cannot choose a word it has never been told exists, which
    // means shipping it that way would have recreated the very defect the fix closed,
    // at the one place the agent could not see it.
    //
    // Any future election must appear here too. The engine's vocabulary and the
    // player's vocabulary are one surface.
    const settlement = readFileSync(new URL('../../src/venture/settlement.ts', import.meta.url), 'utf8');
    const declared = [...settlement.matchAll(/^export const ([A-Z][A-Z_]*) = '\1' as const;$/gm)]
      .map((m) => m[1] ?? '');
    expect(declared).toContain('IN_FULL');
    for (const election of declared) {
      // A bare `toContain(election)` is NOT enough, and a mutation test proved it:
      // stripping the defining row left one incidental mention of `IN_FULL` elsewhere
      // in the prose and the assertion stayed green. That is the third time in this
      // project that a presence check has passed while the meaning was gone —
      // presence is not semantics. So require the DEFINING TABLE ROW: the election
      // named in a row that says what it does.
      const definingRow = new RegExp(`^\\| \`${election}\` \\| .{10,} \\|$`, 'm');
      expect(definingRow.test(AGENT_MD),
        `the engine accepts '${election}' but agent.md has no table row defining it`)
        .toBe(true);
    }
  });

  it('warns that electing the quoted p50 on a share role is not paying in full', () => {
    // The specific trap. It is not enough to mention IN_FULL exists; the document has
    // to say why the obvious alternative is wrong, because the obvious alternative
    // looks like the careful choice.
    expect(AGENT_MD).toContain('Anything short of the due is a decline');
    expect(AGENT_MD).toMatch(/over-performs, the real due is \*\*higher\*\*/);
  });

  it('carries the engine’s own graduation sentence VERBATIM, or the exit means two things', () => {
    // ══════════════════════════════════════════════════════════════════════
    // Scar #1 on the single most consequential decision a newcomer makes.
    //
    // A live playtest found that no principal could leave the Commons at all, so A8's
    // permanent floor was the entire world and predation could never touch a player.
    // `graduate` is the fix, and it is **irreversible**: an agent that misreads the price,
    // or reads "one-way" as "reversible", cannot undo it. So the sentence the engine
    // prints in its refusals and its affordance and the sentence this document teaches
    // have to be the same bytes, not two compatible paraphrases.
    //
    // Verbatim, not "contains the numbers": a paraphrase that agreed on the price and
    // disagreed on the direction would pass a looser check and is the worse bug.
    //
    // MUTATION: change `GRADUATION_UPKEEP_MINOR` in `src/world/graduation.ts` and this
    // goes red immediately, because the statement quotes the constant and this compares
    // the statement.
    // ══════════════════════════════════════════════════════════════════════
    const normalised = AGENT_MD.replace(/\n> ?/g, ' ').replace(/[ \t]+/g, ' ');
    const wanted = GRADUATION_STATEMENT.replace(/[ \t]+/g, ' ');
    expect(normalised).toContain(wanted);
  });

  it('says the three things about the Commons an agent must not have to infer', () => {
    // The task the document has: you start safe, nothing can hurt you there, and the
    // frontier is where the yield and the risk are. A document that only names the verb
    // teaches an agent to cross without knowing what it is giving up.
    expect(AGENT_MD).toContain('**You start in the Commons.**');
    expect(AGENT_MD).toContain('Hostile action against you in the Commons is **invalid**');
    expect(AGENT_MD).toContain('**What you give up is A8.**');
    // And that the bind on its hands is the reason `move` refuses, not a bug.
    expect(AGENT_MD).toContain('Commons-bound');
  });

  it('carries the FOUR sovereignty statements verbatim, because a lapse is irreversible', () => {
    // ══════════════════════════════════════════════════════════════════════
    // Same argument as the graduation statement above, with a larger loss on the end: a
    // misread Charge costs an agent its TERRITORY and 50,000 of slashable capital, and the
    // record of it is permanent. A5′ is explicit — never a lapse against a claimant that was
    // never shown what it owed — and the document is half of "was shown".
    //
    // All four, and verbatim rather than "contains the numbers": a paraphrase that agreed on
    // the price and disagreed on how many misses lapse a claim would pass a looser check and is
    // the worse bug. The observation ships only the ONE statement that applies right now (§12.1
    // is a budget, and 3 KB of static prose on every wake measurably crowded out the cast's own
    // affordances), so this document is the only place all four appear together.
    //
    // `FUEL_STATEMENT` is the fourth, added 2026-07-27 when `sovereigntyStatementFor` began serving
    // it. It was exported, pinned, and served NOWHERE for a day — this document was the whole of an
    // agent's access to the rule — and it is the statement whose failure is silent: a cold anchor
    // takes no arrears, lapses nothing and is slashed nothing, so no other field in the observation
    // moves when the income stops. §11B carries it under its own heading.
    //
    // **It used to say that cost the cast contract "nothing" because `CONTRACT_SECTIONS` excerpts
    // §11 and §11A and not §11B. That was the wrong sign on the cost.** The house cast reads only
    // the excerpt, so §11B being outside it means `post_bond` — the verb that takes a claim — has
    // rules no cast member has ever been able to read. The gap is now counted and disclosed in
    // `src/cast/prompt.ts:CONTRACT_NOT_EXCERPTED`, which also carries the arithmetic for closing
    // it: §11B is 8,491 characters against 4,000 of room, so it needs a decision, not a comment.
    // This document remains the only place all four statements appear together, and for an
    // external agent over HTTP it is the whole of the rule either way.
    //
    // MUTATION: change `CHARGE_MISSES_TO_LAPSE`, `CESSION_SALVAGE_BPS` or
    // `ANCHOR_FUEL_BY_TIER.FRONTIER` in `src/sovereignty/params.ts` and this goes red immediately,
    // because the statements quote the constants and this compares the statements.
    // ══════════════════════════════════════════════════════════════════════
    const normalised = AGENT_MD.replace(/\n> ?/g, ' ').replace(/[ \t]+/g, ' ');
    for (const [name, statement] of [
      ['SOVEREIGNTY_STATEMENT', SOVEREIGNTY_STATEMENT],
      ['CHARGE_STATEMENT', CHARGE_STATEMENT],
      ['ARREARS_STATEMENT', ARREARS_STATEMENT],
      ['FUEL_STATEMENT', FUEL_STATEMENT],
    ] as const) {
      expect(normalised, `${name} is not in agent.md verbatim`).toContain(
        statement.replace(/[ \t]+/g, ' '),
      );
    }
  });

  it('says the four things about a claim an agent must not have to infer', () => {
    // The task the document has: territory is not bought once, the bill is in goods at the
    // place, missing it three times ends it, and there are two exits that beat failing. A
    // document that only names the verbs teaches an agent to claim without knowing what it
    // signed up for — which is the graduation failure with a permanent loss attached.
    expect(AGENT_MD).toContain('territory you have to MAINTAIN');
    expect(AGENT_MD).toContain('**A bond is locked, not spent.**');
    expect(AGENT_MD).toContain('**The two exits are cheaper than failing');
    // And that the recurring price attaches to a CLAIM and not to a graduated body, which is
    // the one thing an agent could reasonably infer wrongly from §6.3's own wording.
    expect(AGENT_MD).toContain('attaches to a CLAIM, not');
  });

  it('names `briefing.corrections[]`, because a channel the manual omits does not exist', () => {
    // ══════════════════════════════════════════════════════════════════════
    // **THE DEFERRED-REFUSAL CHANNEL WAS BUILT, COMMENTED AT LENGTH, AND UNDOCUMENTED.**
    //
    // `observe.ts` carries a long note on why `corrections[]` lives under `briefing` and why the drain
    // is tied to a wake, and `server.ts` carries another on a probe that "burned 62% of a Reckoning's
    // wakes … then reported that refused actions produced no correction at all". **A probe reproduced
    // that report on 2026-07-27 from the opposite cause**: it read `agent.md`, found no mention of
    // `corrections` anywhere in the document, looked for a top-level key, found none, and concluded
    // the engine had accepted two `create`s and silently dropped them. The `action_log` said
    // `accepted=false, reject_reason=PROP-V5` for both, and `briefing.corrections[]` was carrying two
    // exemplary hints — naming the band, the reason and a copyable alternative — to a field the
    // manual never named.
    //
    // So this is the same defect as an accessor with no observation and a verb with no affordance,
    // one layer further out: the surface exists and the reader cannot find it. An agent that cannot
    // find its verdicts is the *confidently wrong* failure, which `server.ts` already calls the worse
    // one — "a stuck agent retries; a confidently-wrong agent makes commitments".
    //
    // MUTATION: delete the §13 subsection. RED here, and green in every engine test, because the
    // channel keeps working perfectly while nobody knows where to look.
    // ══════════════════════════════════════════════════════════════════════
    expect(AGENT_MD, 'the field, by its exact path').toContain('`briefing.corrections[]`');
    expect(AGENT_MD, 'that `accepted` is not `done`').toMatch(/`accepted`\s*\n?means QUEUED|means QUEUED/);
    expect(AGENT_MD, 'that a poll does not deliver it').toContain('A wake drains it, a poll does not');
    // And the falsification instruction, which is what makes the channel auditable by its readers:
    // an accepted no-op with no verdict is a bug, and the manual has to say so or nobody reports it.
    expect(AGENT_MD).toContain('accepted no-op with no verdict');
  });

  it('is self-contained: it does not send the player somewhere else to learn the rules', () => {
    // High Water verified that three tester agents played from one document with
    // zero extra reading. That property is worth keeping, and it is easy to lose
    // one "see SPEC §7" at a time.
    expect(AGENT_MD).toContain('This document is complete');
    expect(AGENT_MD).not.toMatch(/see (SPEC|TESTING|EXPERIENCE)\.md/i);
    // A section reference to our own numbering is fine; a reference to a document
    // the player cannot fetch is not.
    expect(AGENT_MD).not.toMatch(/docs\/design/);
  });
});

/**
 * The `parent_event_id` contract, pinned against the canon.
 *
 * A wave-2 verifier found `src/invariants/attribution.ts` (INV-17) and
 * `src/venture/events.ts` disagreeing about what `parent_event_id` means: the causal
 * edge, or the settlement cohort. Either is defensible in isolation, and whichever
 * loses, the world halts at every Reckoning that records a default — so this is the
 * kind of disagreement that has to be settled in one place and then asserted.
 *
 * SPEC §15.1 settles it, and states the reason in the same breath.
 */
describe('SPEC §15.1 — parent_event_id is causality, event_family_id is the cohort', () => {
  it('the canon says so, and says why one field cannot be both', () => {
    const SPEC_TEXT = readFileSync(new URL('../../../docs/design/SPEC.md', import.meta.url), 'utf8');
    expect(SPEC_TEXT).toContain('`event_family_id` (immutable primary cohort)');
    expect(SPEC_TEXT).toContain('`parent_event_id` (causality');
    expect(SPEC_TEXT).toContain('one flat field cannot express both');
  });

  it('core/types.ts declares both fields, so neither can be quietly dropped', () => {
    const TYPES = readFileSync(new URL('../../src/core/types.ts', import.meta.url), 'utf8');
    expect(TYPES).toContain('readonly eventFamilyId: string');
    expect(TYPES).toContain('readonly parentEventId: EventId | null');
  });
});

/**
 * INV-17's attribution column — an OPEN constraint, pinned so it cannot ship unwired.
 *
 * A wave-2 verifier found `checkInv17` requiring a default's `parent_event_id` to BE
 * its attributable cause, while `venture/events.ts` sets that field to the settlement
 * cohort. SPEC §15.1 settles which is right — "`event_family_id` (immutable primary
 * cohort) · `parent_event_id` (causality — one flat field cannot express both)" — so
 * the check is correct and the venture side must move.
 *
 * Attempting the move revealed why it is not a one-line change: `EventLedger.append`
 * MINTS ids as `ev:{tick}:{seq}`, so the caller-supplied `input.eventId` can never be
 * a ledger id, and writing it into `parent_event_id` makes INV-12 refuse the row
 * ("a cause must precede its effect"). The invariant was right; my change was wrong.
 *
 * Only the caller that appends the batch knows the settled row's minted id, so this
 * belongs to the Reckoning driver. These assertions hold the requirement in view.
 */
describe('INV-17 — the attribution column is a tracked debt, not a silent gap', () => {
  it('the cause is at least carried in the payload today, so no default is unattributed', () => {
    const events = readFileSync(new URL('../../src/venture/events.ts', import.meta.url), 'utf8');
    expect(events).toContain('causeEventId: d.causeEventId');
    expect(events).toContain('isDefault: true');
  });

  it('the reason it is not yet a column is recorded at the site rather than lost', () => {
    // A gap nobody wrote down is a gap that ships. This asserts the explanation
    // survives, so the next person to touch this file inherits the finding instead of
    // rediscovering it by breaking INV-12 the same way.
    const events = readFileSync(new URL('../../src/venture/events.ts', import.meta.url), 'utf8');
    // Phrases chosen to survive comment wrapping: an assertion that breaks when
    // someone re-flows a paragraph is an assertion that gets deleted.
    expect(events).toContain('AN OPEN CONSTRAINT');
    expect(events).toContain('INV-12 reject the row outright');
    expect(events).toContain('mints ids itself');
    expect(events).toMatch(/Reckoning[\s/*]+driver/i);
    expect(events).toContain('tracked, not forgotten');
  });

  it('the ledger really does mint its own ids, which is the fact the debt rests on', () => {
    // If ids ever become caller-supplied, this debt evaporates and the fix is trivial.
    // Assert the premise so that change is noticed here too.
    const ledger = readFileSync(new URL('../../src/events/ledger.ts', import.meta.url), 'utf8');
    expect(ledger).toContain('const id = mintEventId(tick, seqInTick);');
  });
});

describe('agent.md quotes the WORKS numbers the engine actually uses', () => {
  /**
   * §11A tells an agent what a place yields, what a WORKS costs and how long it takes to pay
   * anything — and an agent plans its whole economy off those figures. `params.ts` marks them
   * *(calibrate)*, which is precisely why this test exists: the next person to tune a yield
   * will change one number in one file, and without this the prose keeps promising the old one.
   *
   * That is scar #1's exact shape. High Water shipped a game whose central ritual reliably
   * produced the opposite of what the town voted for, and it survived three critic passes
   * because every individual component was correct — engine and agent-facing text simply
   * disagreed. The numbers are the rules surface here, not the engine alone.
   */
  it('names every tier yield, and none that the engine does not have', () => {
    for (const [tier, amount] of Object.entries(YIELD_PER_TICK)) {
      expect(
        AGENT_MD,
        `§11A must quote ${tier}'s real yield of ${String(amount)}`,
      ).toContain(`| ${tier} | ${String(amount)} |`);
    }
  });

  it('quotes the price, the spin-up and the per-system cap exactly', () => {
    expect(AGENT_MD, 'the currency half').toContain(`${String(WORKS_COST_MINOR)} currency`);
    expect(AGENT_MD, 'the goods half').toContain(`${String(WORKS_BUILD_QTY)} units of \`ration\``);
    // ── AND THE CURRENCY SUBSTITUTE FOR THE GOODS HALF, BOTH FIGURES ─────────
    //
    // `WORKS_GOODS_IN_CURRENCY_MINOR` is what lets a principal drained past the endowment window back
    // into the economy at all — without it the only escape was a second identity (A15 inverted) — so a
    // manual that quoted the old price would be telling a locked-out agent it is still locked out.
    // The TOTAL is pinned as well as the part, because `total_minor` is the field the agent budgets
    // off and a manual naming only the increment leaves it doing the addition (A2).
    //
    // Matched as the bolded figure plus the parenthesised total rather than as `"25000 currency"`,
    // because the phrase wraps across a line in the document and the contract excerpt has **4
    // characters** of headroom left (`prompt.test.ts`) — so reflowing `agent.md` to suit a test's
    // regex would push the analytic ceiling over `MAX_CONTRACT_CHARS`. Two figures pinned instead of
    // one loose phrase, which is the stronger guard anyway: the part and the sum.
    expect(AGENT_MD, 'the currency substitute for the goods half').toContain(
      `**${String(WORKS_GOODS_IN_CURRENCY_MINOR)}`,
    );
    expect(AGENT_MD, 'and the total it comes to').toContain(
      `(${String(WORKS_COST_MINOR + WORKS_GOODS_IN_CURRENCY_MINOR)})`,
    );
    expect(AGENT_MD, 'the spin-up, which decides whether a build helps tonight').toContain(
      `nothing for ${String(WORKS_SPINUP_TICKS)} ticks`,
    );
    expect(AGENT_MD, 'the per-system cap').toContain(
      `${WORKS_PER_PRINCIPAL_PER_SYSTEM === 1 ? 'one WORKS per system' : String(WORKS_PER_PRINCIPAL_PER_SYSTEM)}`,
    );
  });

  it('does the sole-occupant arithmetic the way the engine does, so the promise is true', () => {
    // The worked example — "alone at a COMMONS system you take all 80 a tick — 23040 a
    // Reckoning" — is the sentence an agent decides on. If TICKS_PER_RECKONING or the yield
    // moves and the example does not, agent.md is quietly lying about whether a WORKS covers
    // a Levy. Recomputed here rather than pinned as a literal.
    const perReckoning = YIELD_PER_TICK.COMMONS * TICKS_PER_RECKONING;
    expect(AGENT_MD, `a sole COMMONS occupant really does take ${String(perReckoning)}`).toContain(
      String(perReckoning),
    );
  });

  it('says the one thing that stops a puppet farm being tried', () => {
    // A15. If an agent believes more identities means more extraction it will try, waste its
    // enrolments, and conclude the game is broken. The engine makes it pointless; this makes it
    // obvious.
    expect(AGENT_MD).toContain('Enrolling a second identity gains you nothing here');
    expect(AGENT_MD).toContain('The yield belongs to the place');
  });

  it('says what CAN pay for one, and what is actually withheld', () => {
    // ── THIS ASSERTION USED TO DEMAND THE OPPOSITE SENTENCE ──────────────────
    // It required `'starter stake cannot buy a WORKS'`, and its comment read: *the build is refused
    // with a healthy-looking balance on screen, so without this paragraph the agent reads a bug and
    // files a discrepancy.* The build is not refused. `worksQuote` gates on `freeBalance` and has
    // since the earnings gate was measured to make the mechanic unreachable — so this test was
    // pinning a rule the engine had already dropped, which is exactly why the wrong paragraph
    // survived in the manual: it was protected by a test.
    //
    // A probe agent then played the newcomer path reading only `agent.md`, built a WORKS out of
    // 100% enrolment grant, and filed the discrepancy this assertion existed to prevent. A guard
    // that encodes the abandoned side of a rule change does not merely fail to help; it holds the
    // contradiction in place.
    //
    // The engine-side pin lives in `works-provenance.test.ts`, so the two directions cannot drift
    // apart again without one of them going red.
    expect(AGENT_MD).toContain('your starter stake can cover it');
    expect(AGENT_MD).toContain('spendable_minor');
    // A refusal still happens — just for a different reason — and it is still owed an explanation.
    expect(AGENT_MD, 'what IS withheld must be named').toContain('pledged stores withheld');
  });
});

describe('agent.md warns about the one verb whose meaning depends on a parameter', () => {
  /**
   * `build` is **three** acts as of §9A: ANCHOR takes territory with a permanent Charge attached,
   * WORKS raises a production structure and is legal in the Commons, and HULL makes a warship out
   * of `ration` and `fuel` with its fit frozen for life. An agent that searches `affordances[]`
   * for `verb == "build"` and takes the first match gets whichever the ranking happened to put
   * first — and the three commit it to completely different futures.
   *
   * **It went two → three on 2026-07-27 and this assertion is what said so**, by going red on the
   * word "TWO" the moment `engage` landed. That is the check working: a count in a rules surface
   * is a claim, and a claim that quietly stops being true is scar #1's shape. The number is
   * spelled out in the heading precisely so it cannot drift silently.
   *
   * This is not hypothetical. Adding WORKS turned FOUR of this repo's own test helpers ambiguous
   * in one commit, including two written the same night, and broke an A8 assertion that read "no
   * `build` is offered in the Commons". If the engine's own tests fell for it within hours, an
   * LLM reading affordances under a token budget certainly will.
   *
   * Hard rule 4 is about one word per concept. `build` builds structures and both of these are
   * structures, so the vocabulary is sound — the hazard is in the affordance surface, and the
   * defence is to say so where the agent is reading.
   */
  it('says to match on params.kind and not on the verb alone', () => {
    expect(AGENT_MD).toContain('`build` is THREE different acts');
    expect(AGENT_MD).toContain('Match');
    expect(AGENT_MD).toContain('params.kind');
  });

  it('names what each kind commits you to, so the choice is not a coin flip', () => {
    expect(AGENT_MD).toContain('Legal in the Commons');
    expect(AGENT_MD).toContain('Invalid in the Commons');
    // HULL's two, both irreversible and neither inferable from the verb: it is the only kind that
    // costs `fuel` (which only the FRONTIER makes), and its fit can never be changed.
    expect(AGENT_MD, 'a hull costs fuel and the Commons cannot make any').toContain(
      'fuel exists only at FRONTIER systems',
    );
    expect(AGENT_MD, 'and the fit is a permanent commitment').toContain(
      'the fit is frozen at build; there is no refit',
    );
    // ── ANCHOR's PRICE, IN THE BLOCK `build` PULLS ────────────────────────────
    // §11B is the full rules, but a member holding a posted bond and offered `build` ANCHOR does
    // not always get §11B in its excerpt (`cast/prompt.ts` records why: claiming `build` there
    // costs a Commons newcomer 1,987 characters for a claim it cannot legally take). So the two
    // costed facts live HERE as well, and that duplication is deliberate — pinned so it cannot
    // drift from §11B, which is the scar-#1 risk a second copy always carries.
    expect(AGENT_MD, 'the goods a claim destroys, where `build` is documented').toContain(
      'It destroys 5000 units of `ration` **and 500 units of `alloy`**',
    );
    // ★ And the reason the alloy half is different in kind from every other price in the game: it is
    // the only one an agent CANNOT pay out of its own production, because the tier that makes it and
    // the tier a claim lives in are disjoint by construction. An agent that read "500 alloy" as just
    // another number would spend Reckonings refining ore into a good its ground cannot produce.
    expect(AGENT_MD, 'and that the alloy half must be hauled in').toContain(
      'only the Commons refines it',
    );
    expect(AGENT_MD, 'and the bond, which is slashable and does not come back').toContain(
      'requires a posted BOND of 50000 per claim',
    );
  });
});

describe('agent.md teaches the syndicate rules an agent cannot discover by trying', () => {
  /**
   * Two of these are unrecoverable if the agent learns them the hard way.
   *
   * A charter is permanent, so a founder that misreads `treasury_offices` has built the wrong
   * organisation forever and cannot fix it. And an office-holder can empty a pool inside its limits
   * without violating anything, which means a principal that grants one without understanding that
   * has not been betrayed by a bug — it has been betrayed by the mechanic working, which is A6.
   *
   * The numbers are pinned to the engine for the reason §11A's are: params.ts marks them
   * *(calibrate)*, so the next tuning pass changes one file and the prose keeps promising the old
   * figure unless something goes red.
   */
  it('says a charter can never be amended, in as many words', () => {
    expect(AGENT_MD).toContain('The three charter clauses are permanent');
    expect(AGENT_MD).toContain('no verb in this game that amends a charter');
  });

  it('names all three clauses and every option, so no choice is made blind', () => {
    for (const option of ['OPEN', 'INVITE', 'CLOSED', 'FOUNDER', 'MAJORITY', 'UNANIMOUS']) {
      expect(AGENT_MD, `${option} must be documented`).toContain(option);
    }
    expect(AGENT_MD).toContain('treasury_offices');
    expect(AGENT_MD, 'and the consequence of the dangerous setting').toContain('how one is looted');
  });

  it('quotes the founding cost the engine charges', () => {
    expect(AGENT_MD).toContain(`Costs ${String(FOUNDING_COST_MINOR)}`);
  });

  it('explains that an office-holder spending the pool breaks no rule (A6)', () => {
    // The single most important sentence in the section. An agent that thinks abuse is illegal will
    // not price the risk, and A6 is explicit that there is no betray() verb and no dice roll.
    expect(AGENT_MD).toContain('nothing it does that way is a violation');
    expect(AGENT_MD).toContain('there is no rule for it to break');
  });

  it('tells an applicant what to do when INVITE refuses it', () => {
    // Otherwise the refusal is a dead end and the agent concludes syndicates are broken.
    // Matched across the line wrap: agent.md is hard-wrapped, so a phrase pinned as one line is a
    // phrase that breaks the next time somebody reflows a paragraph.
    expect(AGENT_MD.replace(/\s+/g, ' ')).toContain('There is no application queue');
    // Backtick-tolerant: agent.md marks up verb names, so a literal phrase match is really a match
    // against the markdown as well as the words.
    expect(AGENT_MD.replace(/\s+/g, ' ')).toMatch(/`?message`? one of them.*admits you/);
  });
});

describe("agent.md's verb table says which verbs actually exist", () => {
  /**
   * The table listed all forty canon verbs with no way to tell the twelve reserved ones from the
   * twenty-eight that work. An agent budgeting actions off that list spends them discovering which
   * half is real — and `agent.md` is the document three tester agents played from with no other
   * reading, so it is the rules surface that matters most.
   *
   * Pinned against `VERB_ARRIVES_AT` in both directions, so the marks cannot rot the way the map
   * itself just did: seven live verbs had been sitting in that map claiming to be unbuilt, `grant`
   * among them, and nothing failed because nothing checked.
   */
  it('marks every reserved verb with a dagger, and marks nothing else', () => {
    const table = AGENT_MD.slice(AGENT_MD.indexOf('identity   '), AGENT_MD.indexOf('```', AGENT_MD.indexOf('identity   ')));
    const daggered = new Set([...table.matchAll(/([a-z_]+)†/g)].map((m) => m[1] ?? ''));
    const reserved = new Set(Object.keys(VERB_ARRIVES_AT));

    const unmarked = [...reserved].filter((v) => !daggered.has(v)).sort((a, b) => (a < b ? -1 : 1));
    expect(unmarked, `reserved verbs offered without a dagger: ${unmarked.join(', ')}`).toEqual([]);

    const overmarked = [...daggered].filter((v) => !reserved.has(v)).sort((a, b) => (a < b ? -1 : 1));
    expect(
      overmarked,
      `these are marked as not existing but they work: ${overmarked.join(', ')}. Telling an agent a ` +
        'live verb is unavailable costs it every action it would have spent there.',
    ).toEqual([]);
  });

  it('explains what the dagger means, so the mark is not decoration', () => {
    expect(AGENT_MD).toContain('do not exist yet');
    expect(AGENT_MD, 'and that a refusal names the build step').toMatch(/build step it is waiting on/);
  });

  it('names the two consequences an agent would otherwise discover by losing something', () => {
    // Three kinds since the HULL landed; the sentence has to count them correctly or it is scar #1
    // in the sentence that exists to prevent scar #1.
    expect(AGENT_MD, '`build` being three acts').toContain('`build` is three acts');
    // ── THIS ASSERTION USED TO SAY THE OPPOSITE, AND THE INVERSION IS THE FIX ──
    //
    // It pinned *"cargo cannot be intercepted in transit, because the hand is what is in transit"* —
    // true, and a consequence of `haul` not existing. `haul` is live now, so the same sentence would
    // be a **false statement about the rules on the most-read surface in the game**, which is exactly
    // the failure this whole file exists to catch. What an agent must know instead is that goods are
    // located and one verb moves them, because everything about a market fill's usefulness depends on
    // it.
    const flat = AGENT_MD.replace(/\s+/g, ' ');
    expect(flat, 'goods do not teleport').toContain('Goods are LOCATED, and `haul` is the only verb');
    expect(flat, 'and a fill lands where it traded').toContain(
      'A market fill settles the cargo at the venue it traded at',
    );
    expect(flat, 'a stale promise that cargo is safe would misprice every raid').not.toContain(
      'cannot be intercepted in transit',
    );
  });
});

describe('agent.md says WHEN an assurance is worth anything', () => {
  /**
   * Measured on the live world: **40 of 41 assurances were about ventures that had already
   * resolved.** The cast was speaking, at the right party — 40 of them from the creator, who owes the
   * elective half — and about the wrong MOMENT. A promise made after the outcome is known is not a
   * promise; nobody relied on it and no reader will ever see it beside a deed.
   *
   * The guidance said `assure` is "the one that is quoted back at you" and never said when. The
   * affordance now enforces the timing structurally (offered only on live ventures the principal
   * still owes), but an agent reading the document is entitled to know why, and a human tuning the
   * prompt later is entitled to know this was measured rather than assumed.
   */
  it('says an assurance after settlement is worth nothing', () => {
    const flat = AGENT_MD.replace(/\s+/g, ' ');
    expect(flat).toContain('TIMING is its whole value');
    expect(flat, 'and what makes it worthless').toMatch(/already resolved it is worth \*\*nothing\*\*/);
  });

  it('points at the affordance as the way to get the timing right', () => {
    const flat = AGENT_MD.replace(/\s+/g, ' ');
    expect(flat).toContain('while you still owe something');
    expect(flat, 'and names where the correctly-timed act is offered').toContain('affordances[]');
  });
});

describe('agent.md warns about the one refusal every agent hits first', () => {
  /**
   * Found by playing the game. Enrol succeeds, and an immediate `GET /observe` returns
   * `401 KEY_NOT_YET_REGISTERED — key … takes effect at tick 98, and it is tick 97`.
   *
   * The error itself is exemplary — it names both ticks, so an agent can see exactly what happened.
   * But `agent.md` never mentioned it, and this is the **first signed request an agent ever makes**.
   * A conformant client that follows the natural enrol → observe flow gets a 401 with a correct
   * signature and no way to know that waiting is the answer, which reads as "my signing is broken"
   * and sends it to debug the one thing that was right.
   *
   * The document already pre-empts the two other first-try mistakes (`content-digest` on a bodyless
   * GET, and the `@path` prefix). This is the third and it was missing.
   */
  it('says the key takes effect next tick, and that the enrol response already carries an observation', () => {
    const flat = AGENT_MD.replace(/\s+/g, ' ');
    expect(flat).toContain('Your key takes effect on the NEXT tick');
    expect(flat, 'and names the exact refusal so it is searchable').toContain('KEY_NOT_YET_REGISTERED');
    expect(flat, 'and says why, so it does not read as a bug').toContain('identity is minted into a tick');
    expect(flat, 'and gives the way round it rather than only the explanation').toContain(
      'already contains a live first observation',
    );
  });
});
