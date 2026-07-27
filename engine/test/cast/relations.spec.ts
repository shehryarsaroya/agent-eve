/**
 * The cast's memory of each other, which it did not have.
 *
 * A character was `handle · title · creed · stance` — appetite, and no history. So every wake a
 * member met the world as a stranger: it could read that a venture had settled and not that the
 * principal across it had broken a promise to it twice before. A12 says the sandbox authors the
 * stories, and an agent with no memory of who wronged it cannot be a party to one. That, not engine
 * surface area, is the watchability ceiling.
 *
 * **Derived, never stored.** A wound is a `DEFAULT` that already happened and A5 makes it permanent,
 * so the journal IS the memory: there is nothing to keep in sync, nothing in `state_hash`, nothing in
 * the rollback set. A `relationships` table could disagree with the record; this cannot.
 */

import { describe, expect, it } from 'vitest';
import { setSpeed } from '../../src/core/time.js';
import { HeuristicCast } from '../../src/cast/index.js';
import { Runtime } from '../../src/sim/runtime.js';
import { MAX_RELATIONS } from '../../src/sim/runtime.js';
import { buildPrompt } from '../../src/cast/prompt.js';
import type { PrincipalId } from '../../src/core/types.js';

function world(seed: string, ticks: number): Runtime {
  setSpeed('instant');
  const rt = new Runtime({ seed });
  const cast = new HeuristicCast(rt, { size: 6 });
  cast.seat(seed);
  for (let i = 0; i < ticks; i += 1) {
    for (const a of cast.decide(rt.engine.tick + 1, seed)) rt.engine.submit(a);
    const r = rt.runTick();
    if (r.halted) throw new Error(`halted at ${String(r.tick)}`);
  }
  return rt;
}

describe('a member remembers who it has dealt with', () => {
  it('builds relations from the standing journal and nothing else', () => {
    const rt = world('relations-a', 700);
    const withHistory = rt.standing
      .rows()
      .map((r) => r.principal)
      .filter((p) => rt.relationsFor(p).length > 0);
    expect(withHistory.length, 'a driven world must produce dealings between members').toBeGreaterThan(0);

    const subject = withHistory[0] as PrincipalId;
    const rel = rt.relationsFor(subject);
    // Every relation must correspond to a real journal entry naming both parties. Checked against
    // the journal rather than against the function's own output, so it cannot agree with itself.
    for (const r of rel) {
      const shared = rt.standing
        .changes()
        .some(
          (c) =>
            (c.principal === subject && c.counterparty === r.other) ||
            (c.principal === r.other && c.counterparty === subject),
        );
      expect(shared, `${String(r.other)} appears with no journal entry naming both`).toBe(true);
      expect(r.other, 'never itself — self-dealing earns nothing (scar #9)').not.toBe(subject);
    }
  });

  it('keeps THEIR record of you separate from YOUR record of them', () => {
    // The asymmetry is the point. `kept`/`broke` is what they did to you, which decides whether to
    // deal again. `youKept`/`youBroke` is what they can read about you. A model given only its own
    // side could not reason about being distrusted.
    const rt = world('relations-b', 700);
    const subject = rt.standing.rows().map((r) => r.principal).find((p) => rt.relationsFor(p).length > 0);
    expect(subject).toBeDefined();
    for (const r of rt.relationsFor(subject as PrincipalId)) {
      const theirs = rt.relationsFor(r.other).find((x) => String(x.other) === String(subject));
      if (theirs === undefined) continue;
      // My view of what they did to me must equal their view of what they did to me.
      expect(r.kept, 'their kept-toward-me is their own youKept-toward-me').toBe(theirs.youKept);
      expect(r.broke, 'and the same for what they broke').toBe(theirs.youBroke);
    }
  });

  it('is bounded, most recent first, because a prompt is not a ledger', () => {
    const rt = world('relations-c', 700);
    for (const row of rt.standing.rows()) {
      const rel = rt.relationsFor(row.principal);
      expect(rel.length).toBeLessThanOrEqual(MAX_RELATIONS);
      const ticks = rel.map((r) => r.lastTick);
      expect([...ticks].sort((a, b) => b - a), 'most recent first').toEqual(ticks);
    }
  });
});

describe('the prompt says what passed between them, in words a model can act on', () => {
  it('names a broken promise as broken, and says they can read your half too', () => {
    const built = buildPrompt({
      contract: { text: 'CONTRACT', sections: [], dropped: [], notThisWake: [] },
      character: { handle: 'vex', role: 'raider', title: 'The Debt Collector', creed: 'You take what is owed.', stance: 'HARD' } as never,
      observation: { holding: {}, obligations: {}, affordances: [] } as never,
      memory: 'nothing yet',
      liveVerbs: ['create'],
      planMax: 3,
      relations: [
        { other: 'p:halcyon', kept: 1, broke: 2, youKept: 0, youBroke: 0 },
        { other: 'p:orrin', kept: 3, broke: 0, youKept: 1, youBroke: 0 },
      ],
    });
    const text = built.messages.map((m) => m.content).join('\n');
    expect(text).toContain('p:halcyon: 2 promise(s) to you BROKEN');
    expect(text, 'and the kept ones alongside, so it is not a grudge list').toContain('1 kept');
    expect(text).toContain('p:orrin: 3 promise(s) to you kept, none broken');
    expect(text, 'your own half is named, because they can read it').toContain('you have kept 1 to them');
    expect(text, 'and it must not instruct a response').toContain('Nobody is telling you to forgive or to retaliate');
  });

  it('emits no block at all when there is no history', () => {
    const built = buildPrompt({
      contract: { text: 'CONTRACT', sections: [], dropped: [], notThisWake: [] },
      character: { handle: 'new', role: 'digger', title: 'x', creed: 'y', stance: 'HARD' } as never,
      observation: { holding: {}, obligations: {}, affordances: [] } as never,
      memory: 'nothing yet',
      liveVerbs: ['create'],
      planMax: 3,
      relations: [],
    });
    expect(built.messages.map((m) => m.content).join('\n')).not.toContain('WHO YOU HAVE DEALT WITH');
  });
});
