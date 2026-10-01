/**
 * The season's rules surfaces (HARD RULE 4): `agent.md` carries the engine's own sentences verbatim,
 * and the canon names the two new concepts once.
 *
 * Scar #1 was the engine and the agent-facing text disagreeing about one word, and it survived a full
 * build and three critic passes because every component was correct on its own. So the statements an
 * agent reads in `header.season.rule` and `header.season.grand.rule` are compared byte for byte against
 * the document it plays from — and because the statements are built from the constants, changing a
 * number in `season/params.ts` turns this red until the document follows.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  GRAND_BASE_YIELD_MINOR,
  GRAND_ROLE_STAKE_MINOR,
  GRAND_VENTURE_STATEMENT,
  SEASON_RECKONINGS,
  SEASON_STATEMENT,
} from '../../src/season/index.js';

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
