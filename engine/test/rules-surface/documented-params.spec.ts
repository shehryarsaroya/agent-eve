/**
 * ★ **EVERY PARAM SPELLING `agent.md` PRINTS MUST BE ONE THE ENGINE ACCEPTS.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **HARD RULE 4, AND SCAR #1'S EXACT SHAPE, ON THE ONE SURFACE AN AGENT PLAYS FROM.**
 *
 * A blind player read §8 — *"`seal` a structured statement of what you intend and expect — the verb,
 * the target, **the unit**, and an outcome band of two integers"* — sent `unit`, and was refused with
 * `PROP-D1`. The engine's alias array is `['measure']` and has never contained `unit`. One concept,
 * two words, and the document was the one that was wrong.
 *
 * `test/rules-surface/agent-md.test.ts` is 800 lines of pinned prose and pinned verb *names*, and
 * `test/seal/rules-surface.test.ts` asserts `SEAL_INTENT_KEYS.length === 5` — the count, not the
 * spellings. **Nothing anywhere reconciled a documented param name against a `read*` alias array**,
 * so a manual that named a field the handler did not read read as correct to every reader.
 *
 * This is that reconciliation, and it is deliberately a **sweep** rather than a pin on `measure`:
 * a pin would close one spelling and this closes the class. The keys are lifted out of `agent.md`'s
 * own JSON examples, and the accepted set is lifted out of `src/`'s own alias arrays, so neither side
 * is retyped and the test cannot drift from either.
 *
 * ── NON-VACUITY FIRST (the guard that passed over the defect it was written for) ──
 *
 * Two ways this could be green while checking nothing, and both are asserted before anything else:
 * an empty set of documented keys (a regex that stopped matching after a doc edit), and an accepted
 * set that swallows everything (a regex matching every string literal in `src/`). A third assertion
 * proves the check can FAIL — `unit` must be absent from the accepted set, which is the exact word
 * that produced the refusal.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const AGENT_MD = readFileSync(fileURLToPath(new URL('../../agent.md', import.meta.url)), 'utf8');
const SRC = fileURLToPath(new URL('../../src', import.meta.url));

/** Every `.ts` under `src/`, so a handler moving between files cannot make this vacuous. */
function sourceFiles(dir: string): readonly string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

const SOURCE = sourceFiles(SRC)
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

/**
 * Every param spelling the engine will read, from the alias arrays themselves.
 *
 * The shape is *nearly* uniform across every handler: `readString(req.params, ['a', 'b'])`,
 * `readInt(params, ['x'])`, `readEnum(req.params, ['side'], [...])`. So the accepted set is every
 * quoted string inside the FIRST array literal after a `params` argument. Deliberately not "every
 * string literal in src" — that is the way this test goes vacuous, and the non-vacuity block below
 * bounds the size to prove it did not.
 *
 * ── AND THE SECOND SHAPE, WHICH THIS TEST FOUND BY GETTING IT WRONG ──────────
 *
 * The first version of this file reported `engage.primary` as undocumented-and-unread, and it was
 * wrong: `runtime.ts:targetPolicyOf` reads `params['primary'] ?? params['primary_policy'] ??
 * params['target_policy']` — a **direct subscript**, because the value is a list of enum tokens and
 * `readList` was the wrong tool. So `params['<key>']` is the second accepted shape, and it is added
 * rather than the finding being waved through. A sweep that reported a true param as a lie would be
 * exactly the failure it exists to catch, one level up.
 */
function acceptedParamNames(): ReadonlySet<string> {
  const out = new Set<string>();
  const call = /read(?:String|Int|Bool|Enum|Qty|Minor|Bps|Number|List)\s*\(\s*[A-Za-z_.]*[Pp]arams\s*,\s*\[([^\]]*)\]/g;
  for (const match of SOURCE.matchAll(call)) {
    for (const key of (match[1] ?? '').matchAll(/'([A-Za-z_][A-Za-z0-9_]*)'/g)) {
      out.add(key[1] as string);
    }
  }
  // Direct subscripts. Narrow on purpose: the identifier must literally end in `params`, so a lookup
  // into any other record is not swept up and the bound in the non-vacuity block still binds.
  for (const match of SOURCE.matchAll(/[A-Za-z_.]*[Pp]arams\['([A-Za-z_][A-Za-z0-9_]*)'\]/g)) {
    out.add(match[1] as string);
  }
  // The seal's closed key set is a second, equally authoritative home — it is what `intent.ts`
  // validates against, and it stores camelCase for two fields the wire accepts snake_case for.
  for (const match of SOURCE.matchAll(/SEAL_INTENT_KEYS\s*=\s*\[([^\]]*)\]/g)) {
    for (const key of (match[1] ?? '').matchAll(/'([A-Za-z_][A-Za-z0-9_]*)'/g)) {
      out.add(key[1] as string);
    }
  }
  return out;
}

/**
 * Every `"params": { ... }` object `agent.md` prints, with the verb it is printed for.
 *
 * Brace-matched rather than regexed to the closing bracket, because two of the examples nest an
 * object inside `params` (`grant`'s caps, `engage`'s formation) and a greedy or lazy regex gets one
 * of those two wrong in a way that silently drops keys.
 */
function documentedParams(): readonly { readonly verb: string; readonly keys: readonly string[] }[] {
  const out: { verb: string; keys: string[] }[] = [];
  // TWO forms, because agent.md prints both and covering one closes half the class: the envelope form
  // `"verb": "x", "params": { … }` and the shorthand `x  { … }` at the start of a line in a fence.
  // The `seal` and the syndicate `grant` examples are the shorthand, and `seal` is the one that
  // produced the defect — so a sweep that missed the shorthand would have missed it too.
  const head = /(?:"verb"\s*:\s*"([a-z_]+)"\s*,\s*"params"\s*:\s*\{)|(?:^([a-z_]+)[ \t]+\{)/gm;
  for (const match of AGENT_MD.matchAll(head)) {
    const verb = (match[1] ?? match[2]) as string;
    // `...` is the placeholder form at §12's envelope sketch; it names no fields.
    if (verb === '...') continue;
    const start = (match.index ?? 0) + match[0].length;
    let depth = 1;
    let i = start;
    for (; i < AGENT_MD.length && depth > 0; i += 1) {
      const ch = AGENT_MD[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
    }
    const body = AGENT_MD.slice(start, i - 1);
    // Top-level keys only: a nested object's keys are that field's own schema, not `params`'.
    const keys: string[] = [];
    let nest = 0;
    for (let k = 0; k < body.length; k += 1) {
      const ch = body[k];
      if (ch === '{' || ch === '[') nest += 1;
      else if (ch === '}' || ch === ']') nest -= 1;
      else if (ch === '"' && nest === 0) {
        const close = body.indexOf('"', k + 1);
        if (close < 0) break;
        const word = body.slice(k + 1, close);
        const after = body.slice(close + 1).match(/^\s*:/);
        if (after !== null && /^[A-Za-z_][A-Za-z0-9_]*$/.test(word)) keys.push(word);
        k = close;
      }
    }
    out.push({ verb, keys });
  }
  return out;
}

describe('★ agent.md names params the engine actually reads (hard rule 4, scar #1)', () => {
  const accepted = acceptedParamNames();
  const documented = documentedParams();

  it('★ NON-VACUITY: both sides of the comparison are populated and neither is everything', () => {
    // If the alias regex stops matching, `accepted` empties and every assertion below inverts into
    // a flood rather than a silence — but the sweep two tests down would then be all-red for the
    // wrong reason, so it is bounded here instead.
    expect(accepted.size, 'the alias sweep found no param names at all; the regex is stale').toBeGreaterThan(60);
    expect(
      accepted.size,
      'the alias sweep is matching more than alias arrays; it would accept anything',
    ).toBeLessThan(400);
    expect(
      documented.length,
      'no `"verb": …, "params": {…}` example was found in agent.md; the extractor is stale',
    ).toBeGreaterThanOrEqual(8);
    expect(
      documented.flatMap((d) => d.keys).length,
      'examples were found but no keys inside them',
    ).toBeGreaterThanOrEqual(15);
  });

  it('★ MUTATION: the check CAN fail — `unit` is not a spelling this engine reads', () => {
    // The exact word §8 used to print. If this ever passes as accepted, `measure` grew an alias and
    // the doc may say either — but until then a document that prints `unit` is refusing its reader.
    expect(accepted.has('unit'), '`unit` must not be an accepted alias while the seal reads `measure`').toBe(false);
    expect(accepted.has('measure'), 'the seal reads `measure`').toBe(true);
    expect(accepted.has('zzz_not_a_param')).toBe(false);
  });

  it('★ every param spelling in every agent.md example is one a handler reads', () => {
    const wrong: string[] = [];
    for (const { verb, keys } of documented) {
      for (const key of keys) {
        if (!accepted.has(key)) wrong.push(`${verb}.${key}`);
      }
    }
    expect(
      wrong.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      'agent.md prints a param the engine will not read. It is a rules surface: fix the document to ' +
        'the engine, or give the handler the alias — never leave the two disagreeing (hard rule 4)',
    ).toEqual([]);
  });

  it('★ and the SEAL example is present, complete, and in the accepted spellings', () => {
    // The specific defect, pinned as well as swept: the whole reason a player could not seal was that
    // §8 described the fields in prose and printed no example at all, so `measure` had no spelling
    // anywhere in the document an agent could copy.
    const seal = AGENT_MD.match(/^seal\s+(\{[^\n]*\})$/m);
    expect(seal, 'agent.md must print a copyable `seal` example').not.toBeNull();
    const body = JSON.parse(seal?.[1] ?? '{}') as Record<string, unknown>;
    for (const key of ['verb', 'target', 'measure', 'outcome_low', 'outcome_high']) {
      expect(Object.prototype.hasOwnProperty.call(body, key), `the seal example must name ${key}`).toBe(true);
      expect(accepted.has(key), `${key} must be a spelling the handler reads`).toBe(true);
    }
    expect(['MINOR', 'QTY', 'BPS']).toContain(body['measure']);
    expect(
      AGENT_MD,
      'and it must say `unit` is refused, because the document told agents to send it',
    ).toMatch(/so is `unit`/);
  });
});
