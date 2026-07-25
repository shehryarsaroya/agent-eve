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
