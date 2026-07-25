/**
 * Hygiene for the golden files themselves.
 *
 * A golden file is only an oracle if it is readable, complete, and honest about
 * what version of the serialiser it was written against. These are the properties
 * that would otherwise rot silently: a stray raw byte that makes an NFC/NFD pair
 * indistinguishable on inspection, a new golden nobody wired into a test, or a
 * `CANONICAL_VERSION` bump that presents as forty unexplained hash failures rather
 * than as one deliberate decision.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { CANONICAL_VERSION } from '../../src/core/canonical.js';
import { GOLDEN_FILES, readGoldenText, goldenCanonicalVersion } from '../golden/load.js';

describe('the golden directory', () => {
  it('every .json in test/golden is covered by a loader and a test', () => {
    // A golden nobody reads is worse than no golden: it looks like coverage.
    const onDisk = readdirSync(new URL('../golden/', import.meta.url))
      .filter((f) => f.endsWith('.json'))
      .sort((a, b) => (a < b ? -1 : 1));
    expect(onDisk).toEqual([...GOLDEN_FILES].sort((a, b) => (a < b ? -1 : 1)));
  });

  it.each(GOLDEN_FILES)('%s is pure ASCII, so escapes stay unambiguous', (file) => {
    // The canonical golden deliberately carries an NFC/NFD pair and two lone
    // surrogates. Written as \uXXXX they are inspectable; written raw they are
    // invisible, and the pair that is supposed to differ would look identical.
    const text = readGoldenText(file);
    const offenders: string[] = [];
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      // Tab, newline and carriage return are the only control bytes allowed.
      const isAllowedControl = code === 9 || code === 10 || code === 13;
      if ((code < 0x20 && !isAllowedControl) || code > 0x7e) {
        offenders.push(`${file}:${i} U+${code.toString(16).padStart(4, '0')}`);
      }
    }
    expect(offenders.slice(0, 5)).toEqual([]);
  });

  it.each(GOLDEN_FILES)('%s records the canonicaliser version it was written against', (file) => {
    // The handshake: bumping CANONICAL_VERSION must force a deliberate pass over
    // every file in this directory, not a wave of mystery failures.
    expect(goldenCanonicalVersion(file)).toBe(CANONICAL_VERSION);
  });

  it.each(GOLDEN_FILES)('%s says what it is and why it exists', (file) => {
    const doc = JSON.parse(readGoldenText(file)) as { __meta?: Record<string, unknown> };
    const meta = doc.__meta;
    expect(meta, `${file} has no __meta`).toBeDefined();
    for (const key of ['what', 'why', 'regenerate']) {
      const v = meta![key];
      // "Why" in particular: an unexplained golden gets deleted by whoever next
      // finds it inconvenient, and with it the only record of the bug it prevents.
      expect(typeof v === 'string' && v.length > 40, `${file}.__meta.${key}`).toBe(true);
    }
  });
});
