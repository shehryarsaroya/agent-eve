/**
 * ★ **SCAR #1 FOR THE CONTACT LAYER: every number `agent.md` prints about who you may address, what
 * it costs and who is listed is the engine's own number (`RULES_VERSION` 41).**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * `agent.md` is a rules surface. 41 changed six published quantities at once — the answer window, the
 * per-Reckoning ceiling, the tie window, the constellation price, the directory's cap and its offer
 * freshness — and moved the inbox to `header.parley.awaiting_reply`. A document that still said
 * *"anybody who has addressed you this Reckoning"* would teach a player to let a letter die at the
 * boundary, which is the exact defect 41 closed; one that said "3 parleys a Reckoning" with no word
 * on answers would teach a popular principal to stop answering to save openings it is never charged.
 *
 * So every figure is read from the constant it states, never retyped here, and the reach ladder's
 * rungs are checked against the engine's own list — the same discipline `agent-md.test.ts` keeps for
 * the verb list and the observe keys.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TICKS_PER_RECKONING } from '../../src/core/time.js';
import { AUDIT_LAG_TICKS } from '../../src/grant/dossier.js';
import { DIRECTORY_OFFER_FRESH_TICKS, MAX_DIRECTORY_ROWS } from '../../src/say/directory.js';
import {
  MAX_AWAITING_SHOWN,
  MAX_PARLEY_ENTRIES,
  MAX_PARLEYS_SENT_PER_RECKONING,
  PARLEY_ANSWER_WINDOW_TICKS,
  PARLEYS_PER_RECKONING,
} from '../../src/say/parley.js';
import { PARLEY_CONSTELLATION_MIN_COUNTERPARTIES, PARLEY_TIE_TICKS } from '../../src/say/reach.js';
import { kindSpec } from '../../src/venture/index.js';

const AGENT_MD = readFileSync(new URL('../../agent.md', import.meta.url), 'utf8');

/** One `###` block of §4, by heading, so a figure is checked where an agent reads it. */
function block(heading: string): string {
  const at = AGENT_MD.indexOf(heading);
  if (at < 0) throw new Error(`agent.md has no heading "${heading}"`);
  const next = AGENT_MD.indexOf('\n### ', at + heading.length);
  return AGENT_MD.slice(at, next < 0 ? undefined : next);
}

const PARLEY = block('### Talking to somebody you share no venture with: the PARLEY');
const NEGOTIATING = block('### Negotiating');

describe('★ the PARLEY block states the engine\'s numbers', () => {
  it('non-vacuity: both blocks are found and substantial', () => {
    expect(PARLEY.length).toBeGreaterThan(2_000);
    expect(NEGOTIATING).toContain('ventures.directory');
  });

  it('the answer window, the ceiling, the openings and the shared book', () => {
    expect(PARLEY, 'the answer window, in ticks').toContain(`${String(PARLEY_ANSWER_WINDOW_TICKS)} ticks`);
    expect(PARLEY, 'the ceiling').toContain(`ceiling of ${String(MAX_PARLEYS_SENT_PER_RECKONING)} sends a Reckoning`);
    expect(PARLEY, 'the openings').toContain(`${String(PARLEYS_PER_RECKONING)} if you are entitled, 0 if you are not`);
    expect(PARLEY, 'the shared book').toContain(`holds ${String(MAX_PARLEY_ENTRIES)} letters`);
    expect(PARLEY, 'the inbox cap').toContain(`(up to ${String(MAX_AWAITING_SHOWN)})`);
    expect(PARLEY, 'the reveal clock').toContain('PUBLIC four ticks later');
    expect(AUDIT_LAG_TICKS, '"four ticks" is AUDIT_LAG_TICKS').toBe(4);
  });

  it('the tie window and the earned rung\'s price', () => {
    const reckonings = PARLEY_TIE_TICKS / TICKS_PER_RECKONING;
    expect(Number.isInteger(reckonings), 'the tie window is a whole number of Reckonings').toBe(true);
    expect(PARLEY, 'raid ties').toContain(`for **${String(reckonings)} Reckonings** after it resolves`);
    expect(PARLEY, 'venture ties').toContain(`in the last\n  **${String(reckonings)} Reckonings**`);
    expect(PARLEY, 'the constellation price').toContain(
      `honoured elective promises to ${String(PARLEY_CONSTELLATION_MIN_COUNTERPARTIES)} distinct counterparties`,
    );
  });

  it('names the inbox where it now lives, and says answers are free', () => {
    expect(PARLEY).toContain('header.parley.awaiting_reply');
    expect(PARLEY).toMatch(/An ANSWER is free/);
    expect(PARLEY).toMatch(/An OPENING spends one of your openings/);
    expect(PARLEY, 'the boundary no longer ends a reply right').toMatch(/across the boundary/);
    expect(
      PARLEY,
      'the 31 sentence that a reply right dies at the Reckoning must be gone — it is the defect 41 closed',
    ).not.toMatch(/anybody who has addressed you this Reckoning/);
  });

  it('names every reach rung the engine has', () => {
    const rungs: readonly [string, RegExp][] = [
      ['REPLY', /letter to you is still answerable/],
      ['CAMPAIGN', /\*\*campaign\*\*/],
      ['RAID', /\*\*raid\*\*/],
      ['GRANT', /\*\*grant\*\*/],
      ['SYNDICATE', /\*\*syndicate\*\*/],
      ['VENTURE', /\*\*venture you finished together\*\*/],
      ['OFFER', /fresh offer\*\*/],
      ['CONSTELLATION', /anybody seated in\n {2}your constellation/],
    ];
    for (const [rung, pattern] of rungs) expect(PARLEY, `the ${rung} rung`).toMatch(pattern);
  });
});

describe('★ the directory and the four-role kinds are documented with the engine\'s numbers', () => {
  it('the directory cap and freshness', () => {
    expect(NEGOTIATING).toContain(`at most ${String(MAX_DIRECTORY_ROWS)} rows`);
    expect(NEGOTIATING).toContain(`last ${String(DIRECTORY_OFFER_FRESH_TICKS)} ticks`);
    expect(NEGOTIATING, 'the one thing listing does not grant').toMatch(/Being listed reaches nobody/);
  });

  it('BUILD and SIEGE yields, and where each is offered', () => {
    // Grouped by hand rather than `toLocaleString`, which DET-4 bans because it reads the host locale.
    const grouped = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    expect(AGENT_MD).toContain(`\`BUILD\` ${grouped(kindSpec('BUILD').baseYieldMinor)} at a full fill`);
    expect(AGENT_MD).toContain(`\`SIEGE\` ${grouped(kindSpec('SIEGE').baseYieldMinor)}`);
    expect(AGENT_MD).toMatch(/`SIEGE` is a hostile act, so it is\s+offered only when your hand\s+stands outside the Commons/);
  });

  it('the observe block names the new fields where they are', () => {
    const observe = AGENT_MD.slice(AGENT_MD.indexOf('## 6. Reading an observation'));
    expect(observe).toContain('directory{}');
    expect(observe).toContain('awaiting_reply[]');
  });
});
