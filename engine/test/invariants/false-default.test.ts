/**
 * The false-default audit, both modes (SPEC §15.4).
 *
 * The two modes are not two configurations of one test; they are two different
 * assertions catching two different bugs:
 *
 *   - **Mode A, hazards off** catches *invention*. Nothing goes wrong in that world,
 *     so a default is the engine making one up. Zero is assertable.
 *   - **Mode B, hazards on** catches *unattributability*. Raids really drain
 *     accounts, so some defaults are legitimate and zero is not assertable — what
 *     must hold is that every single one names the event that caused it.
 *
 * A suite with only Mode A ships the second bug. A suite with only Mode B ships the
 * first, because a fabricated default is trivially attributable to whatever event
 * happened to be nearby. That is the whole reason SPEC §15.4 specifies two.
 *
 * ## Each mode is shown to bite
 *
 * Three injected defects, one per defence: a default for a promise that was kept
 * (Mode A catches it, Mode B cannot), an accusation published with no registered
 * cause (Mode B catches it), and a rival draining a committed account inside the
 * freeze (INV-18 catches it). A mode that cannot be made to fail has not been tested.
 */

import { describe, expect, it } from 'vitest';
import {
  auditModeA,
  auditModeB,
  verifyModeA,
  verifyModeB,
} from '../../src/invariants/index.js';

const SEED = 'false-default-audit:2026-07-24';

describe('Mode A — hazards off, an all-cooperative simulation logs zero defaults', () => {
  const result = auditModeA({ seed: SEED, reckonings: 2, principals: 4 });

  it('logs zero defaults', () => {
    expect(result.defaults).toEqual([]);
    expect(result.unattributedDefaults).toEqual([]);
  });

  it('is not vacuous: it actually settled ventures', () => {
    // A run that settles nothing satisfies "zero defaults" trivially. TESTING.md
    // §3's own warning about INV-25, applied to the audit itself.
    expect(result.ventures).toBeGreaterThan(0);
    expect(result.settled).toBe(result.ventures);
    expect(result.losses).toBe(0);
  });

  it('breaks no invariant at any tick it visited', () => {
    expect(result.violations).toEqual([]);
    expect(result.ticksVisited.length).toBeGreaterThan(3);
  });

  it('verifies', () => {
    const verdict = verifyModeA(result);
    expect(verdict.failures).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  it('is deterministic in the seed and nothing else', () => {
    const again = auditModeA({ seed: SEED, reckonings: 2, principals: 4 });
    expect(again.stateHashes).toEqual(result.stateHashes);
    const other = auditModeA({ seed: `${SEED}:other`, reckonings: 2, principals: 4 });
    // Hazards are off, so the seed changes nothing observable — which is itself the
    // right answer, and worth pinning: an all-cooperative world has no draws to make.
    expect(other.stateHashes).toEqual(result.stateHashes);
  });

  it('CATCHES a default invented for a promise that was kept', () => {
    // The defect Mode A exists for. Note that the fabricated default is still
    // *attributable* (it cites the formation event), so Mode B's assertion would
    // pass on it — this is the case that justifies running two modes.
    const broken = auditModeA({
      seed: SEED,
      reckonings: 1,
      principals: 3,
      injectFabricatedDefault: true,
    });
    expect(broken.defaults.length).toBeGreaterThan(0);
    const verdict = verifyModeA(broken);
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join(' ')).toContain('accusing an innocent agent');

    // And the proof that one mode is not enough: Mode B's *attribution* clause is
    // satisfied by every one of these fabricated defaults.
    for (const d of broken.defaults) expect(d.causeEventId.length).toBeGreaterThan(0);
  });
});

describe('Mode B — hazards on, every logged default names the event that caused it', () => {
  const result = auditModeB({ seed: SEED, reckonings: 2, principals: 4 });

  it('exercised the raid-drains-the-account path, or it proved nothing', () => {
    // The reason Mode A alone is insufficient (SPEC §15.4): with hazards off this
    // path never runs at all.
    expect(result.losses).toBeGreaterThan(0);
  });

  it('logs some defaults — zero is not assertable here', () => {
    expect(result.defaults.length).toBeGreaterThan(0);
  });

  it('every default carries an attributable cause, in the register and in the record', () => {
    for (const d of result.defaults) {
      expect(d.causeEventId.length).toBeGreaterThan(0);
      expect(d.causeEventId).not.toBe(d.defaultEventId);
      expect(['LOSS', 'MISSED_DELIVERY', 'ELAPSED_WINDOW']).toContain(d.cause);
    }
    // INV-17 is checked at every visited tick and would have fired on a default
    // whose parent_event_id did not match its registered cause.
    expect(result.violations.filter((v) => v.id === 'INV-17')).toEqual([]);
  });

  it('breaks no invariant at any tick it visited', () => {
    expect(result.violations).toEqual([]);
  });

  it('verifies', () => {
    const verdict = verifyModeB(result);
    expect(verdict.failures).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  it('is deterministic in the seed', () => {
    const again = auditModeB({ seed: SEED, reckonings: 2, principals: 4 });
    expect(again.stateHashes).toEqual(result.stateHashes);
    expect(again.defaults.map((d) => d.defaultEventId)).toEqual(
      result.defaults.map((d) => d.defaultEventId),
    );
  });

  it('a different seed fires hazards differently — the model really is driven by Rng', () => {
    const other = auditModeB({ seed: `${SEED}:other`, reckonings: 2, principals: 4 });
    expect(other.stateHashes).not.toEqual(result.stateHashes);
  });

  it('CATCHES an accusation published with no registered cause', () => {
    const broken = auditModeB({
      seed: SEED,
      reckonings: 2,
      principals: 4,
      injectUnattributedDefault: true,
    });
    expect(broken.unattributedDefaults.length).toBeGreaterThan(0);
    // INV-17 fired at the tick it was published, before anything downstream.
    expect(broken.violations.some((v) => v.id === 'INV-17')).toBe(true);
    const verdict = verifyModeB(broken);
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join(' ')).toContain('no attribution');
  });
});

describe('the hard freeze — SPEC §15.4 defence one, and E2E-12 in miniature', () => {
  it('with the freeze honoured, no third party touches the settlement set', () => {
    const clean = auditModeB({ seed: SEED, reckonings: 2, principals: 4 });
    expect(clean.violations.filter((v) => v.id === 'INV-18')).toEqual([]);
  });

  it('with the freeze disabled, a rival drains a committed account and INV-18 fires', () => {
    // "A rival deliberately drains a counterparty's committed account during the
    // commitment window" — and the check that notices is the freeze, not the
    // attribution: the resulting default *is* attributable to the raid, so INV-17
    // alone would let it through. Two defences, two different bugs.
    const broken = auditModeB({
      seed: SEED,
      reckonings: 2,
      principals: 4,
      disableFreeze: true,
    });
    expect(broken.violations.some((v) => v.id === 'INV-18')).toBe(true);
  });
});
