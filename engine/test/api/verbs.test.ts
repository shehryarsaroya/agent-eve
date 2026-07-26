/**
 * The verb surface, checked against the canon rather than against itself.
 *
 * `src/api/verbs.ts` hard-codes SPEC §12.2's list, because production must not depend
 * on a markdown file being on disk. That hard-coding is only safe if something
 * compares the two, and this is that comparison — the same shape as
 * `test/rules-surface/agent-md.test.ts`, for the same reason: a list that agrees with
 * nothing is a list that drifts.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CANON_VERBS, VERB_ARRIVES_AT, classifyVerb, isCanonVerb, unbuiltVerbs } from '../../src/api/index.js';

const SPEC = readFileSync(new URL('../../../docs/design/SPEC.md', import.meta.url), 'utf8');
const AGENT_MD = readFileSync(new URL('../../agent.md', import.meta.url), 'utf8');

/** SPEC §12.2's block, parsed rather than copied. */
function specVerbs(): readonly string[] {
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
  return [...verbs];
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

describe('the API verb list is the canon verb list', () => {
  it('parses the spec non-trivially, so a silent parse failure cannot pass this file', () => {
    // The guard's own guard: a regex that quietly matched nothing would make every
    // assertion below vacuously true, which is the same failure shape as the bug.
    expect(specVerbs().length).toBeGreaterThan(30);
  });

  it('holds exactly SPEC §12.2 — no extras, none missing', () => {
    expect([...CANON_VERBS].sort(cmp)).toEqual([...specVerbs()].sort(cmp));
  });

  it('stays inside the §17 budget of 40', () => {
    expect(CANON_VERBS.length).toBeLessThanOrEqual(40);
    // And no word names two verbs, which would be §3's prohibition inside one list.
    expect(new Set(CANON_VERBS).size).toBe(CANON_VERBS.length);
  });

  it('offers a player exactly what agent.md offers', () => {
    // agent.md is the document a player learns from; the engine's list is what it can
    // actually reach. The two disagreeing about one word is scar #1.
    const block = AGENT_MD.match(/```\nidentity {3}([\s\S]*?)```/);
    expect(block).not.toBeNull();
    const fromDoc = new Set<string>();
    for (const line of `identity   ${block?.[1] ?? ''}`.split('\n')) {
      if (!line.trim()) continue;
      const rest = line.slice(line.indexOf(' ')).trim();
      for (const v of rest.split('·')) {
        const t = v.trim();
        if (/^[a-z_]+$/.test(t)) fromDoc.add(t);
      }
    }
    expect([...fromDoc].sort(cmp)).toEqual([...CANON_VERBS].sort(cmp));
  });

  it('names a build step for every canon verb it does not implement', () => {
    // "Coming soon" is not an answer an agent can check. A step number is checkable
    // against a published plan, and it is the difference between a gap and an excuse.
    const live = new Set(['move', 'create', 'fill_role', 'sign', 'seal']);
    for (const verb of unbuiltVerbs(live)) {
      const verdict = classifyVerb(verb, live);
      expect(verdict.canon).toBe(true);
      expect(verdict.live).toBe(false);
      expect(verdict.invariant).toBe('PHASE-0');
      // Either the map names its step, or the fallback sentence does — but it must
      // never read as though the verb does not exist.
      expect(verdict.hint).not.toContain('not a verb in this game');
      expect(verdict.hint).toContain('Nothing was charged');
      if (VERB_ARRIVES_AT[verb] !== undefined) {
        expect(verdict.hint).toContain(String(VERB_ARRIVES_AT[verb]));
      }
    }
  });

  it('every verb the arrival map mentions is actually in the canon', () => {
    // A stale entry here would promise a step for a verb nobody can name, which is
    // worse than no entry: it reads as though the canon had changed.
    for (const verb of Object.keys(VERB_ARRIVES_AT)) {
      expect(isCanonVerb(verb), `${verb} is in VERB_ARRIVES_AT but not in the canon`).toBe(true);
    }
  });

  it('distinguishes a typo from a gap, because they are different mistakes', () => {
    const live = new Set(['move']);
    const gap = classifyVerb('trade', live);
    const typo = classifyVerb('mvoe', live);
    expect(gap.canon).toBe(true);
    expect(typo.canon).toBe(false);
    expect(gap.hint).not.toBe(typo.hint);
    // An agent can only correct the mistake it is told about.
    expect(typo.hint).toContain('not a verb in this game');
    expect(typo.hint).toContain('agent.md');
  });

  it('says nothing at all when the verb is live, so a live verb has no hint to leak', () => {
    const verdict = classifyVerb('move', new Set(['move']));
    expect(verdict.live).toBe(true);
    expect(verdict.hint).toBe('');
  });
});

describe('a verb cannot be both live and waiting on a build step', () => {
  /**
   * Found by audit, not by a failure: `admit`, `apply`, `deliver`, `form`, `grant`, `revoke` and
   * `vote` all had working handlers **and** entries in `VERB_ARRIVES_AT` saying which future build
   * step they were waiting on. One of them was `grant` — the A6 core loop.
   *
   * Nothing broke, and that is the whole reason this test exists. `classifyVerb` checks `live`
   * first, so a stale entry is never *shown* to an agent; it just quietly disagrees with the
   * engine. `verbs.ts` already documented the convention — remove the entry when the verb lands —
   * and the convention drifted anyway, because a convention maintained by remembering is one that
   * drifts. Four entries had been removed correctly and seven had not.
   *
   * This asserts the two sets are disjoint, so the next verb to go live cannot leave its promise
   * behind. It reads the runtime's own live set rather than a hand-kept list, so it cannot drift in
   * the same way it is guarding against.
   */
  it('every verb with a handler is absent from VERB_ARRIVES_AT', async () => {
    const { harness } = await import('./harness.js');
    const h = await harness({ seed: 'verb-drift' });
    try {
      const live = h.runtime.liveVerbs;
      const promised = Object.keys(VERB_ARRIVES_AT);
      // Explicit comparator: DET-1 bans a bare .sort() even on a diagnostic string list, and it is
      // right to — a message whose order varies by platform makes a failure hard to compare.
      const both = promised.filter((v) => live.has(v)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      expect(
        both,
        `these verbs have handlers AND claim to be waiting on a build step: ${both.join(', ')}. ` +
          'Remove their VERB_ARRIVES_AT entries — a promise about a verb that already works is a ' +
          'rules surface disagreeing with the engine, which is scar #1 in miniature.',
      ).toEqual([]);
    } finally {
      await h.close();
    }
  });

  it('and every verb still promised really has no handler', async () => {
    // The other direction, so the fix cannot be "delete the map". A verb genuinely waiting on a
    // build step must stay listed, because the agent is owed the step number rather than silence.
    const { harness } = await import('./harness.js');
    const h = await harness({ seed: 'verb-drift-2' });
    try {
      expect(Object.keys(VERB_ARRIVES_AT).length, 'the map must not be empty while work remains').toBeGreaterThan(0);
      for (const [verb, step] of Object.entries(VERB_ARRIVES_AT)) {
        expect(h.runtime.liveVerbs.has(verb), `${verb} is listed as unbuilt but has a handler`).toBe(false);
        expect(step, `${verb}'s note must cite a step, not an apology`).toMatch(/step \d+/);
      }
    } finally {
      await h.close();
    }
  });
});
