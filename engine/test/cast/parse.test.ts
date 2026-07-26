/**
 * Reading a model's reply on the assumption that it is hostile.
 *
 * The one test in this file that is not about tidiness is the float. Action params are
 * canonicalised into the hashed action log, and `canonicalize` **throws** on a
 * non-integer number — on a path inside tick resolution with no catch above it. So a
 * model that answers `{"share": 12.5}` would halt the world. That is not a hypothetical
 * about a badly-behaved model; it is the single most natural thing a model would type
 * when asked for a share.
 */

import { describe, expect, it } from 'vitest';
import { canonicalize } from '../../src/core/canonical.js';
import type { CanonicalValue } from '../../src/core/canonical.js';
import { MAX_PARAM_STRING, MAX_REPLY_CHARS, parseReply } from '../../src/cast/index.js';

/**
 * A NUL, built rather than typed.
 *
 * Writing the byte literally would put it in this source file, which is banned repo-wide
 * and makes the file binary to `grep`. Built here so the tests below can still prove that
 * the parser refuses one.
 */
const NUL = String.fromCharCode(0);

const VERBS = new Set(['move', 'create', 'elect', 'sign', 'claim']);
const OPTIONS = { liveVerbs: VERBS, planMax: 3 };

function parse(text: string): ReturnType<typeof parseReply> {
  return parseReply(text, OPTIONS);
}

describe('what it accepts', () => {
  it('a well-formed reply', () => {
    const result = parse(JSON.stringify({ note: 'why', plan: [{ verb: 'move', params: { hand: 'h:1', to: 's:2' } }] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan).toEqual([{ verb: 'move', params: { hand: 'h:1', to: 's:2' } }]);
    expect(result.note).toBe('why');
  });

  it('a reply wrapped in a markdown fence, which is the commonest deviation', () => {
    const inner = JSON.stringify({ plan: [{ verb: 'claim', params: {} }] });
    const result = parse('```json\n' + inner + '\n```');
    expect(result.ok).toBe(true);
  });

  it('integers, booleans, null and arrays of them', () => {
    const result = parse(
      JSON.stringify({
        plan: [{ verb: 'create', params: { stage: 's:1', roles: [1, 2, 3], escrowed: 0, hostile: false, target: null } }],
      }),
    );
    expect(result.ok).toBe(true);
  });

  it('truncates an over-long plan rather than throwing the whole decision away', () => {
    const result = parse(
      JSON.stringify({
        plan: [
          { verb: 'move', params: {} },
          { verb: 'move', params: {} },
          { verb: 'move', params: {} },
          { verb: 'move', params: {} },
          { verb: 'move', params: {} },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.plan.length).toBe(3);
  });
});

describe('what it refuses', () => {
  const cases: readonly (readonly [string, string, string])[] = [
    ['prose', 'I think I will move the hand west.', 'not-json'],
    ['an array at the root', '[{"verb":"move"}]', 'not-an-object'],
    ['no plan key', '{"note":"hello"}', 'no-plan'],
    ['an empty plan', '{"plan":[]}', 'empty-plan'],
    ['a plan entry that is a string', '{"plan":["move"]}', 'plan-entry-not-an-object'],
    ['a missing verb', '{"plan":[{"params":{}}]}', 'verb-not-a-string'],
    ['an upper-case verb', '{"plan":[{"verb":"MOVE","params":{}}]}', 'verb-malformed'],
    ['a verb the engine does not implement', '{"plan":[{"verb":"betray","params":{}}]}', 'unknown-verb:betray'],
    ['params as an array', '{"plan":[{"verb":"move","params":[1]}]}', 'params-not-an-object'],
    ['a nested object', '{"plan":[{"verb":"move","params":{"terms":{"wage":1}}}]}', 'param-terms-nested-object'],
    ['a param key with a space', '{"plan":[{"verb":"move","params":{"to system":"s:1"}}]}', 'param-key-malformed'],
    ['a nested array', '{"plan":[{"verb":"move","params":{"xs":[[1]]}}]}', 'param-xs-nested-array'],
  ];

  for (const [name, text, why] of cases) {
    it(`refuses ${name}`, () => {
      const result = parse(text);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.why).toBe(why);
    });
  }

  it('refuses a float, which would otherwise HALT THE WORLD', () => {
    const result = parse('{"plan":[{"verb":"elect","params":{"election":12.5}}]}');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.why).toBe('param-election-not-an-integer');

    // The consequence, demonstrated rather than asserted about: this is what would have
    // happened inside the tick if the float had been passed through.
    expect(() => canonicalize({ election: 12.5 })).toThrow(/float/);
  });

  it('refuses a control byte in a param, because params reach the hashed record', () => {
    const evil = JSON.stringify({ plan: [{ verb: 'claim', params: { text: `a${NUL}b` } }] });
    const result = parse(evil);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.why).toBe('param-text-control-bytes');
  });

  it('refuses an over-long param string', () => {
    const long = 'x'.repeat(MAX_PARAM_STRING + 1);
    const result = parse(JSON.stringify({ plan: [{ verb: 'claim', params: { text: long } }] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.why).toBe('param-text-string-too-long');
  });

  it('refuses a reply longer than the cap without even parsing it', () => {
    const result = parse('x'.repeat(MAX_REPLY_CHARS + 1));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.why).toBe('reply-too-long');
  });

  it('refuses an unsafe integer', () => {
    const result = parse('{"plan":[{"verb":"elect","params":{"election":900719925474099100}}]}');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.why).toBe('param-election-unsafe-integer');
  });
});

describe('it never throws', () => {
  it('survives every hostile string thrown at it', () => {
    const nasty = [
      '',
      '   ',
      'null',
      'undefined',
      '{',
      '{"plan":',
      '{"plan":[{"verb":"move","params":{"a":',
      NUL,
      '```json\n```',
      JSON.stringify({ plan: [{ verb: 'move', params: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${String(i)}`, i])) }] }),
      JSON.stringify({ plan: [{ verb: 'move', params: { xs: Array.from({ length: 100 }, (_, i) => i) } }] }),
    ];
    for (const text of nasty) {
      expect(() => parse(text)).not.toThrow();
    }
  });

  it('a note is scrubbed rather than refused, and bounded', () => {
    const result = parse(
      JSON.stringify({ note: `line${NUL}one\nline two ${'z'.repeat(400)}`, plan: [{ verb: 'move', params: {} }] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.note).not.toBeNull();
    expect(result.note?.includes(NUL)).toBe(false);
    expect((result.note ?? '').length).toBeLessThanOrEqual(200);
  });

  it('the parsed params survive canonicalisation, which is the whole point', () => {
    const result = parse(
      JSON.stringify({ plan: [{ verb: 'create', params: { stage: 's:1', n: -0, xs: [1, 2], ok: true } }] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const action of result.plan) {
      expect(() => canonicalize(action.params as CanonicalValue)).not.toThrow();
    }
  });
});
