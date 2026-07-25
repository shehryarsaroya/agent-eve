/**
 * The observation against `agent.md` — the promise, parsed out of the document.
 *
 * `agent.md`'s own warning: *"It is part of the rules, not a description of them. If
 * anything here disagrees with what the server actually does, **that is a bug and we
 * want to know**."* `test/rules-surface/agent-md.test.ts` checks the document against
 * SPEC. This file checks the document against **this module's output**, which is the
 * other half and the half scar #1 actually lived in: every individual piece was
 * correct, and the engine and the agent-facing text disagreed about one word.
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
  OBSERVE_KEYS,
  SERVICE_NAMES,
  WITHHELD_GROUNDS,
  buildObservation,
} from '../../src/observe/index.js';
import { ALICE, BRAM, CASS, fixture, goLive, levyOwing, makeHaul, sourcesFor } from './fixture.js';

const AGENT_MD = readFileSync(new URL('../../agent.md', import.meta.url), 'utf8');

/** The ten keys, as the document's own §6 block lists them. */
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
    expect(documentedKeys().length).toBe(10);
  });
});

describe('agent.md §6 — the ten keys are the ten keys', () => {
  it('the engine publishes exactly the keys the document names, in order', () => {
    expect(OBSERVE_KEYS).toEqual([...documentedKeys()]);
  });

  it('a real observation has them', () => {
    const f = fixture();
    const built = buildObservation(sourcesFor(f), ALICE);
    expect(Object.keys(built.observation)).toEqual([...documentedKeys()]);
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
    expect(AGENT_MD).toContain('It is exact, not an estimate.');
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
    expect(AGENT_MD).toContain('paginated');
    expect(SERVICE_NAMES as readonly string[]).toContain('page');
  });

  it('promises plan_hands gives 3–6 complete plans with EV bands, worst case and foreclosures', () => {
    expect(AGENT_MD).toContain(
      '`plan_hands` (3–6 complete allocation plans with expected value bands, worst case, and what each',
    );
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
