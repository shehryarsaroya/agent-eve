/**
 * Cast memory survives a restart — the months A6 needs.
 */
import { describe, expect, it } from 'vitest';
import { CastMemory, type CastNote, type MemoryVault } from '../../src/cast/memory.js';

function doubleVault(seed: Record<string, CastNote[]> | null = null): MemoryVault & {
  saved: Record<string, CastNote[]> | null;
} {
  const v = {
    saved: seed,
    load: (): Record<string, CastNote[]> | null => v.saved,
    save: (all: Record<string, CastNote[]>): void => {
      v.saved = all;
    },
  };
  return v;
}

describe('a grudge outlives the process', () => {
  it('memory written before a restart is there after it', () => {
    // "Months of honest work, then abuse at maximum leverage" needs the months. With
    // memory in the heap, every deploy reset every member to a stranger — and this
    // project deploys several times a day, so no trust arc could outlive an afternoon.
    const vault = doubleVault();
    const before = new CastMemory(10, 160, vault, 1); // save every note, for the test
    before.remember('brannock', 12, 'halcyon defaulted on the elective half');
    before.flush();

    const after = new CastMemory(10, 160, vault, 1);
    expect(after.render('brannock')).toContain('halcyon defaulted');
  });

  it('a corrupt or hand-edited vault is IGNORED, never half-applied', () => {
    // Same discipline as the snapshot parsers: a store that cannot be read is a store
    // that is skipped. A truncated file must not be able to hand the prompt a
    // non-integer tick or an unbounded string.
    const junk = {
      brannock: [
        { tick: 1.5, text: 'not an integer tick' },
        { tick: 2, text: 'x'.repeat(9_999) },
        { tick: 3, text: 'kept' },
      ],
      broken: 'not an array',
    } as unknown as Record<string, CastNote[]>;
    const m = new CastMemory(10, 160, doubleVault(junk), 1);
    const rendered = m.render('brannock');
    expect(rendered).toContain('kept');
    expect(rendered).not.toContain('not an integer tick');
    expect(rendered.length).toBeLessThan(1_000); // the 9,999-char note was truncated
    expect(m.render('broken')).toContain('Nothing yet');
  });

  it('a vault that throws on save can never take the tick down', () => {
    // Cast continuity is worth a write; it is not worth a halted world. Same ordering as
    // the frame writer: the record is sacred, the nicety is not.
    const exploding: MemoryVault = {
      load: () => null,
      save: () => {
        throw new Error('disk full');
      },
    };
    const m = new CastMemory(10, 160, exploding, 1);
    expect(() => {
      m.remember('vex', 1, 'still fine');
    }).not.toThrow();
    expect(m.render('vex')).toContain('still fine');
  });

  it('with no vault it behaves exactly as before — dies with the process', () => {
    const m = new CastMemory();
    m.remember('wren', 1, 'ephemeral');
    expect(m.render('wren')).toContain('ephemeral');
    expect(new CastMemory().render('wren')).toContain('Nothing yet');
  });
});
