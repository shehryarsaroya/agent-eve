/**
 * The season's rules surfaces (HARD RULE 4): `agent.md` carries the engine's own sentences verbatim,
 * and the canon names the two new concepts once.
 *
 * Scar #1 was the engine and the agent-facing text disagreeing about one word, and it survived a full
 * build and three critic passes because every component was correct on its own. So the two statements
 * are compared byte for byte against the document an agent plays from — and because they are built from
 * the constants, changing a number in `season/params.ts` turns this red until the document follows.
 *
 * Since the Season 1 merge `header.season.rule` and `header.season.grand.rule` carry a one-line summary
 * and the name of the `agent.md` section with the statements in it — the scale lane's `header.growth`
 * precedent, because static prose in every observation is paid for out of the cast's own affordances.
 * The last describe below checks the pointer resolves and the header carries it.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  GRAND_BASE_YIELD_MINOR,
  GRAND_KIND,
  GRAND_RESIDUAL_PERCENT,
  GRAND_ROLE_STAKE_MINOR,
  GRAND_VENTURE_STATEMENT,
  GRAND_VENTURE_SUMMARY,
  SEASON_RECKONINGS,
  SEASON_SECTION_TITLE,
  SEASON_STATEMENT,
  SEASON_SUMMARY,
  seasonClockAt,
} from '../../src/season/index.js';
import { kindSpec } from '../../src/venture/kinds.js';

const AGENT_MD = readFileSync(new URL('../../agent.md', import.meta.url), 'utf8');
const SPEC = readFileSync(new URL('../../../docs/design/SPEC.md', import.meta.url), 'utf8');
const normalised = AGENT_MD.replace(/\n> ?/g, ' ').replace(/[ \t]+/g, ' ');

describe('agent.md says what the engine does about seasons', () => {
  it('carries the season statement verbatim', () => {
    expect(normalised).toContain(SEASON_STATEMENT.replace(/[ \t]+/g, ' '));
  });

  it('carries the grand venture statement verbatim, with the numbers the engine enforces', () => {
    expect(normalised).toContain(GRAND_VENTURE_STATEMENT.replace(/[ \t]+/g, ' '));
    // The statement is built from the constants, so this is the check that they are the ones meant.
    expect(GRAND_VENTURE_STATEMENT).toContain(String(GRAND_BASE_YIELD_MINOR));
    expect(GRAND_VENTURE_STATEMENT).toContain(String(GRAND_ROLE_STAKE_MINOR));
    // A2: the yield is not claimed exact — the band is the kind's own seeded residual, in the prose.
    expect(GRAND_RESIDUAL_PERCENT * 100).toBe(kindSpec(GRAND_KIND).residualBandBps);
    expect(GRAND_VENTURE_STATEMENT).toContain(`${String(GRAND_BASE_YIELD_MINOR)} (±${String(GRAND_RESIDUAL_PERCENT)}%)`);
    expect(SEASON_STATEMENT).toContain(`${String(SEASON_RECKONINGS)} Reckonings`);
  });

  it('names header.season in the observation block, without a twelfth key', () => {
    const block = /```\nheader {12}([\s\S]*?)```/.exec(AGENT_MD)?.[0] ?? '';
    expect(block).toContain('· season (§5');
    const keys = block
      .split('\n')
      .slice(1, -1)
      .filter((l) => l.length > 0 && !l.startsWith(' '))
      .map((l) => l.split(/\s+/)[0]);
    expect(keys).toHaveLength(11);
  });

  it('the horizons table gives the season its length and its FINALE', () => {
    expect(AGENT_MD).toContain(
      `| **Season** | ${String(SEASON_RECKONINGS)} Reckonings. The last is the **FINALE**: Frontier claims close and the grand venture settles.`,
    );
  });

  it('shows the copyable act exactly as the verb reads it', () => {
    expect(AGENT_MD).toContain('`create {"kind":"BUILD","stage":"<stage>","grand":true}`');
  });

  it('tells a claimant its Frontier claim closes, and that closing is not a lapse', () => {
    expect(normalised).toContain('becomes `CLOSED` — not a lapse, nothing slashed, your bond still posted');
  });
});

describe('the canon names the season’s two new concepts once', () => {
  const section = SPEC.split('## 3. Vocabulary')[1]?.split('\n## 4.')[0] ?? '';

  it('FINALE and GRAND VENTURE are §3 rows', () => {
    expect(section).toMatch(/^\| \*\*FINALE\*\* \|/m);
    expect(section).toMatch(/^\| \*\*GRAND VENTURE\*\* \|/m);
  });

  it('§7.6 records how it was built, and §17 carries the calibration', () => {
    expect(SPEC).toContain('### ★ As built (`RULES_VERSION` 41, `src/season/`)');
    expect(SPEC).toContain(`**${String(SEASON_RECKONINGS)} Reckonings** (\`SEASON_RECKONINGS\`)`);
  });
});

describe('the header carries a pointer to the season\'s rules, and the pointer resolves', () => {
  it('both summaries name the agent.md section that carries the statements, and it is a real heading', () => {
    expect(AGENT_MD).toContain(`### ${SEASON_SECTION_TITLE}\n`);
    for (const summary of [SEASON_SUMMARY, GRAND_VENTURE_SUMMARY]) {
      expect(summary).toContain(`agent.md, "${SEASON_SECTION_TITLE}"`);
    }
  });

  it('each is under half the statement it stands for, so the header stops paying for the prose', () => {
    // 169 of 380 and 277 of 685 characters at the merge: ~620 fewer bytes in every observation of every
    // principal, which in the house cast's 24,000-character projection is affordances kept.
    expect(SEASON_SUMMARY.length).toBeLessThan(SEASON_STATEMENT.length / 2);
    expect(GRAND_VENTURE_SUMMARY.length).toBeLessThan(GRAND_VENTURE_STATEMENT.length / 2);
    expect(SEASON_SUMMARY).toContain(`${String(SEASON_RECKONINGS)} Reckonings`);
  });

  it('the clock serves the summary, not the statement', () => {
    expect(seasonClockAt(0).rule).toBe(SEASON_SUMMARY);
  });
});
