/**
 * Scar #1 for this module: **the agent-facing text is part of the rules surface.**
 *
 * High Water's engine resolved votes as *stones protect the district they are
 * placed on*; the players' prompt said stones decide *which district the water
 * drowns*. Both were internally coherent, nothing compared them, and the town
 * reliably saved what it meant to drown. So the seal module's engine constants are
 * compared against `agent.md` and against SPEC §11 here, mechanically.
 *
 * **Scope, deliberately narrow.** `test/rules-surface/agent-md.test.ts` owns the
 * doc; this file owns the *seam* between the doc and this module's constants. The
 * phrases asserted below are the ones that file already pins, so the two suites
 * cannot drift apart into a disagreement of their own — which would be the bug
 * they both exist to catch, one level up.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SealVerdict } from '../../src/core/types.js';
import {
  SEAL_DISCLOSURE_KEYS,
  SEAL_INTENT_KEYS,
  SEAL_STANDING_SCHEDULE,
  SEAL_STANDING_STATEMENT,
} from '../../src/seal/index.js';

const AGENT_MD = readFileSync(new URL('../../agent.md', import.meta.url), 'utf8');
const SPEC = readFileSync(new URL('../../../docs/design/SPEC.md', import.meta.url), 'utf8');

/** Every verdict this engine can produce. Two, and there is no third. */
const VERDICTS: readonly SealVerdict[] = ['HONOURED', 'CONTRADICTED'];

describe('the doc and the engine agree about what an agent learns', () => {
  it('agent.md names every verdict the engine can produce, and no fourth outcome', () => {
    for (const verdict of VERDICTS) {
      expect(AGENT_MD, verdict).toContain(verdict);
    }
    // The phrase the doc's own suite pins. If the engine ever gained a third
    // verdict, this pair of assertions is where the mismatch surfaces.
    expect(AGENT_MD).toMatch(
      /learn only \*\*`HONOURED`\*\* or \*\*`CONTRADICTED`\*\*\. Never the content/,
    );
    expect(SEAL_DISCLOSURE_KEYS).toContain('verdict');
    expect(SEAL_DISCLOSURE_KEYS.length).toBe(4);
  });

  it('agent.md tells the player it cannot use seals to monitor other agents', () => {
    // AGT-X4's assertion, stated to the player. A cast that believes content leaks
    // will either perform for the seal or run a cartel monitor with it.
    expect(AGENT_MD).toContain('You cannot use seals to verify each other');
    expect(SEAL_STANDING_STATEMENT).toContain('nothing else');
  });

  it('both surfaces say a contradiction costs standing, and the engine prices it', () => {
    expect(AGENT_MD).toContain('A contradiction costs standing');
    expect(SEAL_STANDING_STATEMENT).toContain('contradicted-seals count');
    expect(SEAL_STANDING_SCHEDULE.contradictedSealStep).toBeGreaterThan(0);
    // The step is stated in the sentence, not only in the constant: A2 requires
    // known arithmetic to be exact and machine-readable, and an agent has to be
    // able to price a seal *before* making it.
    expect(SEAL_STANDING_STATEMENT).toContain(
      `adds ${String(SEAL_STANDING_SCHEDULE.contradictedSealStep)} to your public`,
    );
  });

  it('the statement is a superset of the doc’s pinned sentence, so one home can serve both', () => {
    // agent.md should carry SEAL_STANDING_STATEMENT verbatim. Until it does, this
    // is what stops the two wordings contradicting each other: the constant
    // contains the doc's own load-bearing sentence.
    expect(SEAL_STANDING_STATEMENT).toContain('You cannot use seals to verify each other');
    expect(AGENT_MD).toContain('You cannot use seals to verify each other');
  });

  it('both surfaces say the contradiction is against a timestamp, not behaviour', () => {
    // The single most important sentence in this module. Inferring a betrayal from
    // behaviour is scar #8, and there is no mechanism in this design that does it.
    expect(AGENT_MD).toContain('provable against a timestamp, not inferred from your behaviour');
  });

  it('both surfaces say a seal is structured', () => {
    expect(AGENT_MD).toContain('structured statement');
    expect(SPEC).toContain('The seal is structured and the flag is computed from typed fields only');
    expect(SEAL_INTENT_KEYS.length).toBe(5);
  });
});

describe('the spec’s own claims about §11 are the ones implemented here', () => {
  it('SPEC §11.1 states all four, so none of them is this module’s invention', () => {
    const section = SPEC.split('### 11.1 Three layers')[1]?.split('### 11.2')[0] ?? '';
    expect(section.length).toBeGreaterThan(500);
    // structured, never prose
    expect(section).toContain('never** an input to the flag');
    // scoped to its Reckoning
    expect(section).toContain('Seals are scoped to their Reckoning');
    // mandatory and free
    expect(section).toContain('Seals are mandatory and free');
    // a contradiction costs standing
    expect(section).toContain('A contradicted seal costs standing');
    // the flag, and nothing else
    expect(section).toContain('agents receive `HONOURED | CONTRADICTED` and never the content');
  });

  it('SPEC §11.2 gives content to the season replay and to agents never', () => {
    const section = SPEC.split('### 11.2 The visibility ladder')[1]?.split('### 11.3')[0] ?? '';
    expect(section).toContain('agents get the flag and nothing else, forever');
    expect(section).toContain('content in the season documentary');
  });
});
