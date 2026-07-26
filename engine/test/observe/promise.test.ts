/**
 * The observation against `agent.md` — the promise, parsed out of the document.
 *
 * `agent.md`'s own warning: *"It is part of the rules, not a description of them. If
 * anything here disagrees with what the server actually does, **that is a bug and we
 * want to know**."* `test/rules-surface/agent-md.test.ts` checks the document against
 * SPEC. This file checks the document against the builder's output, which is the
 * other half and the half scar #1 actually lived in: every individual piece was
 * correct, and the engine and the agent-facing text disagreed about one word.
 *
 * ── WHICH BUILDER, AND WHY IT WAS THE WRONG ONE ─────────────────────────────
 *
 * There are TWO `buildObservation`s. `src/observe/` has one; `src/api/observe.ts` has the
 * other, and **only the second is reachable from the server**. `src/observe/` is imported by
 * eight test files and zero production files.
 *
 * The §6 key assertions below used to read `src/observe/`, so they compared the document an
 * agent reads against a builder no agent can reach. Discovered by adding a real key
 * (`syndicates`) to the live payload: the live builder, `SPEC.md` and `agent.md` all agreed at
 * eleven, and this file failed at ten — the one file whose entire job is to notice that
 * disagreement was pointing at the wrong side of it.
 *
 * The KEY-CONTRACT assertions now read `src/api/observe.ts`. Everything else here still
 * exercises `src/observe/` and its fixture, because those tests are about that module's
 * internals rather than about the promise. The duplicate itself is recorded as open in
 * `D13-what-playing-it-found.md` §4: deleting 1,241 lines is a decision to take deliberately,
 * not one to slip into a fix for something else.
 *
 * Everything below is parsed from the document rather than copied out of it. A test
 * that hard-codes the promise cannot notice the promise changing.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { minor } from '../../src/core/units.js';
import { ACTIONS_PER_TICK, WAKES_PER_RECKONING } from '../../src/core/time.js';
import {
  AFFORDANCE_KEYS,
  SERVICE_NAMES,
  WITHHELD_GROUNDS,
  buildObservation,
} from '../../src/observe/index.js';
// The LIVE contract: the key list the server actually serves. See the note above.
import { OBSERVE_KEYS } from '../../src/api/observe.js';
import { ALICE, BRAM, CASS, fixture, goLive, levyOwing, makeHaul, sourcesFor } from './fixture.js';

const AGENT_MD = readFileSync(new URL('../../agent.md', import.meta.url), 'utf8');

/** The keys, as the document's own §6 block lists them. Counted, never hard-coded. */
function documentedKeys(): readonly string[] {
  const block = AGENT_MD.match(/```\nheader {12}([\s\S]*?)```/);
  if (block === null) throw new Error('agent.md observe block not found');
  return `header            ${block[1] ?? ''}`
    .split('\n')
    .filter((l) => l && !l.startsWith(' '))
    .map((l) => (l.split(/\s+/)[0] ?? '').replace(/\[\]$/, ''));
}

describe('the parse is non-trivial, so a silent regex failure cannot pass this suite', () => {
  it('finds the document and its observe block', () => {
    expect(AGENT_MD.length).toBeGreaterThan(5_000);
    expect(documentedKeys().length).toBeGreaterThanOrEqual(10);
  });
});

describe('agent.md §6 — the documented keys are the served keys', () => {
  it('the engine publishes exactly the keys the document names, in order', () => {
    expect(OBSERVE_KEYS).toEqual([...documentedKeys()]);
  });

  it('a real observation has them', () => {
    // Deliberately NOT asserted against `src/observe/`'s builder: it is not the payload an agent
    // receives, so an equality here would be a promise about the wrong object. `test/api/
    // contract.test.ts` makes this assertion against a real HTTP response, which is the only
    // version of it that means anything.
    const f = fixture();
    const built = buildObservation(sourcesFor(f), ALICE);
    expect(Object.keys(built.observation).length, 'the dead builder still builds something').toBeGreaterThan(0);
  });
});

describe('agent.md §6 — every affordance field the document tells players to read', () => {
  it('names the same six, and the engine publishes all of them', () => {
    // The document lists them as bullets: "- `cost` — actions it consumes", etc.
    const documented = [...AGENT_MD.matchAll(/^- `([a-z_]+)` — /gm)].map((m) => m[1] ?? '');
    for (const field of [
      'cost',
      'max_direct_loss',
      'max_contingent_liability',
      'what_it_forecloses',
      'expires_tick',
      'quote_id',
    ]) {
      expect(documented, `agent.md no longer documents ${field}`).toContain(field);
      expect(AFFORDANCE_KEYS).toContain(field);
    }
  });

  it('the document’s claim that max_direct_loss "is exact, not an estimate" holds', () => {
    expect(AGENT_MD).toContain('exact, not estimates');
    // Exact means an integer computed from pinned terms — never a band, never a null.
    const f = fixture();
    const haul = makeHaul(f);
    goLive(f, haul, [BRAM, CASS], minor(12_000));
    const built = buildObservation(sourcesFor(f, { levy: levyOwing(f) }), ALICE);
    for (const affordance of built.observation.affordances) {
      expect(Number.isSafeInteger(affordance.max_direct_loss)).toBe(true);
    }
  });
});

describe('agent.md §6 — "We never truncate this list"', () => {
  it('says so, and the engine has no way to do it', () => {
    expect(AGENT_MD).toContain('**We never truncate this list.**');
    expect(AGENT_MD).toContain('you get a `withheld` count and a reason');
    // The structural half: no ground means "we cut it".
    expect(WITHHELD_GROUNDS as readonly string[]).not.toContain('TRUNCATED');
  });

  it('the count is exact for a world large enough to need narrowing', () => {
    const f = fixture();
    for (let i = 0; i < 24; i += 1) {
      makeHaul(f, {
        id: `v-p${String(i).padStart(2, '0')}` as never,
        creator: ALICE,
        windowClosesTick: 200,
        resolvesAtTick: 250,
      });
    }
    const built = buildObservation(sourcesFor(f), ALICE);
    expect(built.accounting).toEqual([]);
    expect(built.observation.header.withheld.some((r) => r.ground === 'PAGED')).toBe(true);
  });
});

describe('agent.md §6 — the free services', () => {
  it('names the six the document names, plus its "paginated reads"', () => {
    for (const service of [
      'plan_hands',
      'quote_venture',
      'reference_split',
      'stress_grant',
      'dry_run',
      'mandate',
    ]) {
      expect(AGENT_MD, `agent.md no longer offers ${service}`).toContain(`\`${service}\``);
      expect(SERVICE_NAMES as readonly string[]).toContain(service);
    }
    expect(AGENT_MD.toLowerCase()).toContain('paginated');
    expect(SERVICE_NAMES as readonly string[]).toContain('page');
  });

  it('marks the advisory services NOT-YET-LIVE so no one builds strategy on vapor (Gate 3 #6)', () => {
    // The services are designed but unbuilt in Phase 0; agent.md once pushed plan_hands as
    // getting-good tactic #1, which sent every probe chasing a PHASE-0 reply. It must now
    // say plainly they are not live, and point at the consequence-preview fields that ARE.
    expect(AGENT_MD).toContain('Not yet live (Phase 0)');
    expect(AGENT_MD).toContain('the observation already previews consequences');
    // And the getting-good list must no longer open with the vapor.
    expect(AGENT_MD).not.toContain('Call `plan_hands` before every allocation decision');
  });
});

describe('agent.md §7 — the budgets the document publishes', () => {
  it('four material actions per tick, matching the engine constant', () => {
    expect(AGENT_MD).toContain('Four material actions per tick');
    expect(ACTIONS_PER_TICK).toBe(4);
  });

  it('16 wakes per day, matching the engine constant', () => {
    expect(AGENT_MD).toContain('**16 wakes per day**');
    expect(WAKES_PER_RECKONING).toBe(16);
  });

  it('outside a wake: cached, no fresh affordances, no new quote_id, "legal, free, and useless"', () => {
    expect(AGENT_MD).toContain(
      'outside\na wake, `observe` returns a cached snapshot with no fresh affordances and no new `quote_id`',
    );
    // Wrapped across a line break in the document, so the phrase is matched with the
    // wrap in it rather than loosely — a loose match here would stop noticing an edit.
    expect(AGENT_MD).toContain('Legal,\nfree, and useless.');
  });
});

describe('agent.md §6 — briefing', () => {
  it('promises if_you_do_nothing is the concrete consequence and is tested against reality', () => {
    expect(AGENT_MD).toContain('if_you_do_nothing (the concrete consequence at the next Reckoning)');
    expect(AGENT_MD).toContain('it is *tested against reality*');
  });

  it('promises the prompt names the actual dilemma in one sentence', () => {
    expect(AGENT_MD).toContain('prompt (one sentence naming your actual dilemma)');
    const f = fixture();
    const built = buildObservation(sourcesFor(f), ALICE);
    // One sentence: capped, and not a paragraph.
    expect(built.observation.briefing.prompt.split('. ').length).toBeLessThanOrEqual(3);
  });
});

describe('agent.md §8 — the sensed/public split the payload has to respect', () => {
  it('states the split, and the payload carries no other principal’s hold', () => {
    expect(AGENT_MD).toContain('**Movement on public lanes is public. What is in your hold is not.**');
    const f = fixture();
    const haul = makeHaul(f);
    goLive(f, haul, [BRAM, CASS], minor(12_000));
    const built = buildObservation(sourcesFor(f), ALICE);
    for (const hand of built.observation.hands) expect(hand.id.startsWith(ALICE)).toBe(true);
  });
});

describe('the module surface is importable the way the API layer will import it', () => {
  it('re-exports everything a caller needs from one place', () => {
    // A smoke test on the barrel: an export removed from index.ts fails here rather
    // than in the API layer, which is not this wave's to fix.
    expect(typeof buildObservation).toBe('function');
    expect(Array.isArray(OBSERVE_KEYS)).toBe(true);
    expect(AFFORDANCE_KEYS.length).toBe(8);
    expect(SERVICE_NAMES.length).toBe(7);
  });
});
