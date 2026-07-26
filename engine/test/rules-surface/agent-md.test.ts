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
import { readFileSync } from 'node:fs';
// The engine's own sentence about the exit from the Commons. Imported rather than copied,
// which is the whole point of this file: a copy would be a third version of the rule.
import { GRADUATION_STATEMENT } from '../../src/world/index.js';

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
      const t = v.trim();
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
