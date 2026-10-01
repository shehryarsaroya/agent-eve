/**
 * ★ THE PASTE BLOCK IS A RULES SURFACE — the first one most agents ever read.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * A human copies one message off the landing page and sends it to their agent. That message is
 * the agent's first instruction, before `agent.md`, and it said *"Wake every ~20 minutes."* The
 * budget is `WAKES_PER_RECKONING` 16 per `TICKS_PER_RECKONING` 288 five-minute ticks — one wake per
 * 90 minutes — so the very first sentence about pacing spent the pool in about five hours and left
 * the agent blind through its own Reckoning. Nothing compared the two: the engine was right, the
 * page was coherent, and they disagreed. That is scar #1's shape, and this file is the comparison.
 *
 * Three surfaces are held together here:
 *   - `client/lib/landing.js`'s PASTE array (what is actually copied),
 *   - `docs/design/FUNNEL-2026-08-01.md`'s block (the canonical text — "edit both or neither"),
 *   - `agent.md`, which must document the field the block tells the agent to pace by.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SPEEDS, TICKS_PER_RECKONING, WAKES_PER_RECKONING } from '../../src/core/time.js';

const LANDING = readFileSync(new URL('../../../client/lib/landing.js', import.meta.url), 'utf8');
const FUNNEL = readFileSync(new URL('../../../docs/design/FUNNEL-2026-08-01.md', import.meta.url), 'utf8');
const AGENT_MD = readFileSync(new URL('../../agent.md', import.meta.url), 'utf8');
const INDEX_HTML = readFileSync(new URL('../../../client/index.html', import.meta.url), 'utf8');

const ORIGIN = 'https://agenteve.io';

/** The PASTE array, evaluated exactly as the browser evaluates it. */
function pasteFromLanding(): string {
  const m = /var PASTE = \[([\s\S]*?)\]\.join\('\\n'\);/.exec(LANDING);
  if (m === null) throw new Error('landing.js: the PASTE array was not found');
  // The array is string literals concatenated with ORIGIN and nothing else; the Function sees only it.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const build = new Function('ORIGIN', `return [${m[1] ?? ''}].join('\\n');`) as (origin: string) => string;
  return build(ORIGIN);
}

/** The fenced block under "THE PASTE BLOCK" in the funnel doc. */
function pasteFromFunnel(): string {
  const m = /## THE PASTE BLOCK[\s\S]*?```\n([\s\S]*?)\n```/.exec(FUNNEL);
  if (m === null) throw new Error('FUNNEL-2026-08-01.md: the paste block was not found');
  return m[1] ?? '';
}

/** Minutes between evenly spent wakes at production speed. 288 × 5 min / 16 = 90. */
const EVEN_WAKE_MINUTES = (TICKS_PER_RECKONING * SPEEDS.prod) / 60 / WAKES_PER_RECKONING;

describe('the paste block paces by the clock the payload carries', () => {
  it('parses both copies non-trivially, so a silent parse failure cannot pass this file', () => {
    expect(pasteFromLanding().length).toBeGreaterThan(500);
    expect(pasteFromFunnel().length).toBeGreaterThan(500);
  });

  it('the copied text and the canonical text are the same text (edit both or neither)', () => {
    expect(pasteFromLanding()).toBe(pasteFromFunnel());
  });

  it('★ never tells an agent to wake faster than the wake budget allows', () => {
    const paste = pasteFromLanding();
    expect(paste, 'the advice that spent the pool in five hours').not.toMatch(/Wake every ~?20 minutes/i);
    // Pace by the field, and fall back to the pool spent evenly — never to anything faster.
    expect(paste).toContain('header.next_decision_at');
    const fallback = /about (\d+) minutes/.exec(paste);
    expect(fallback, 'the block must state its fallback cadence').not.toBeNull();
    const minutes = Number(fallback?.[1]);
    expect(EVEN_WAKE_MINUTES, 'non-vacuity: the even gap is a real number').toBe(90);
    expect(
      minutes,
      `a fallback of ${String(minutes)} minutes is ${String(Math.round((24 * 60) / minutes))} wakes a day against a pool of ${String(WAKES_PER_RECKONING)}`,
    ).toBeGreaterThanOrEqual(EVEN_WAKE_MINUTES);
    expect(paste).toContain(`${String(WAKES_PER_RECKONING)} a day`);
  });

  it('still fits one chat message on every channel the funnel targets', () => {
    // FUNNEL-2026-08-01: Discord caps at 2,000 characters; the target is < 1,500 so the human's own
    // framing sentence fits beside it.
    expect(pasteFromLanding().length).toBeLessThan(1_500);
  });

  it('agent.md documents the field the paste block tells the agent to pace by', () => {
    const time = AGENT_MD.slice(AGENT_MD.indexOf('## 5. Time'), AGENT_MD.indexOf('## 6. Reading an observation'));
    expect(time, '§5 must explain next_decision_at').toContain('`header.next_decision_at` is the tick to be awake BY');
    const budgets = AGENT_MD.slice(AGENT_MD.indexOf('**Budgets.**'), AGENT_MD.indexOf('## 8. What is public'));
    expect(budgets, 'the Budgets paragraph must point at it').toContain('header.next_decision_at');
    expect(budgets).toContain('**90 minutes**');
    // And the observation-key listing names it under `header`.
    expect(AGENT_MD).toMatch(/header {12}tick[^\n]*\n {18}· next_decision_at/);
  });
});

describe('every client asset carries the same cache-busting version', () => {
  it('one ?v= across index.html, so a deploy cannot serve a new landing.js beside an old app.js', () => {
    const versions = [...INDEX_HTML.matchAll(/\?v=(\d+)/g)].map((m) => m[1]);
    expect(versions.length, 'non-vacuity: the assets must be versioned at all').toBeGreaterThanOrEqual(6);
    expect(new Set(versions).size, `mixed versions: ${versions.join(', ')}`).toBe(1);
    // Bumped for this change: the paste block is new text, and a cached landing.js would keep
    // handing out the twenty-minute advice.
    expect(Number(versions[0])).toBeGreaterThanOrEqual(33);
  });
});
