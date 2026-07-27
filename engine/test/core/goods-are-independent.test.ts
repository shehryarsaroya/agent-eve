/**
 * ONE CONSTANT WEARING FOUR MEANINGS IS SCAR #5 IN THE TYPE SYSTEM.
 *
 * The Levy's good, the WORKS yield, the sovereignty Charge and the enrolment grant were declared as
 * `X = LEVY_GOOD` — three aliases of one constant. Every one of them read correctly, every test
 * passed, and the coupling was invisible: changing `LEVY_GOOD` to introduce a second good would have
 * silently moved what a WORKS extracts, what a Charge is payable in, and what a newcomer is handed,
 * in one edit, with nothing failing.
 *
 * That is scar #5's exact shape ("one quantity, two homes") relocated from a table into an import
 * graph, and it also inverted the layering: `ledger/` and `works/` had to import from `levy/` to
 * learn the name of a good, so the lowest layer in the engine depended on one of the highest.
 *
 * ── WHAT THIS FILE PINS, AND WHY IT IS TWO ASSERTIONS AND NOT ONE ────────────
 *
 * The two halves pull in opposite directions and both matter:
 *
 *   1. **They all agree today.** This build has ONE good on purpose — `D17` — so a WORKS extracts
 *      what the Levy demands and a newcomer is endowed in it. If they silently diverged, the Levy
 *      would become unpayable from domestic production and `levyShort` would climb with no act any
 *      agent could take to stop it. So equality is load-bearing and must be asserted, not assumed.
 *
 *   2. **They are declared independently.** Equality must hold because four decisions currently
 *      agree, NOT because there is one decision with four names. The day a second good lands, the
 *      edit is "change `CHARGE_GOOD`" — and that must be a one-line change with a failing test
 *      here, rather than an edit that moves three other mechanics without saying so.
 *
 * Assertion 1 alone would pass just as happily on the aliased version — which is why the aliased
 * version survived 200+ commits. Assertion 2 is the one that had no test, and it is a source-level
 * check because that is the only level at which "independently declared" is a fact: at runtime an
 * alias and a duplicate literal are indistinguishable, which is precisely the problem.
 *
 * **What this test does not claim** is that one good is the right design. It is a recorded decision
 * with a known cost (a corner on `ration` is a corner on every claim — `CHARGE_STATEMENT` says so to
 * the agent). This file only ensures the decision is revisable in four independent places.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ENDOWMENT_GOOD } from '../../src/ledger/endowment.js';
import { LEVY_GOOD } from '../../src/levy/params.js';
import { CHARGE_GOOD } from '../../src/sovereignty/params.js';
import { WORKS_GOOD } from '../../src/works/params.js';

/** The four goods constants, each with the file and export that declares it. */
const GOODS = [
  { name: 'LEVY_GOOD', value: LEVY_GOOD, file: 'src/levy/params.ts' },
  { name: 'WORKS_GOOD', value: WORKS_GOOD, file: 'src/works/params.ts' },
  { name: 'CHARGE_GOOD', value: CHARGE_GOOD, file: 'src/sovereignty/params.ts' },
  { name: 'ENDOWMENT_GOOD', value: ENDOWMENT_GOOD, file: 'src/ledger/endowment.ts' },
] as const;

function sourceOf(relative: string): string {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  return readFileSync(root + relative, 'utf8');
}

describe('the four goods constants agree, and do so independently', () => {
  it('all name the same good, because this build has one', () => {
    // Load-bearing: the Levy is payable only in a located good, and a WORKS is the only source of
    // goods. If these two diverged the Levy would be unpayable from production — an unwinnable
    // obligation, which is worse than a hard error because it looks like a balance problem.
    const distinct = new Set(GOODS.map((g) => g.value));
    expect(
      [...distinct],
      `all four must name one good while this build has one; got ${GOODS.map((g) => `${g.name}=${g.value}`).join(', ')}`,
    ).toHaveLength(1);
  });

  it('each is declared with its own literal, not as an alias of another', () => {
    // The half that had no test. An alias makes the four inseparable, so the "one good" decision
    // becomes unrevisable-in-part: you cannot give the Charge a second good without moving the
    // WORKS yield and the enrolment grant in the same edit.
    for (const g of GOODS) {
      const src = sourceOf(g.file);
      const declaration = new RegExp(`^export const ${g.name}\\s*(?::[^=]+)?=\\s*(.+);$`, 'm').exec(src);
      expect(declaration, `${g.name} must be declared in ${g.file}`).not.toBeNull();
      if (declaration === null) continue;

      const rhs = declaration[1] ?? '';
      // A string literal (with or without an `as GoodId`) is independent. A bare identifier is not.
      expect(
        rhs,
        `${g.name} in ${g.file} is declared as \`${rhs}\` — an alias, so changing another good ` +
          `silently changes this one. Declare it with its own literal.`,
      ).toMatch(/^'[a-z_]+'( as GoodId)?$/);
    }
  });

  it('no goods module imports another goods module for the name of a good', () => {
    // The layering half. `ledger/endowment.ts` importing `LEVY_GOOD` meant the ledger — the lowest
    // layer, where every value ultimately lands — depended on the Levy, one of the highest. The
    // import is what made the alias possible, so forbidding it is what keeps the alias gone.
    const OTHERS = ['LEVY_GOOD', 'WORKS_GOOD', 'CHARGE_GOOD', 'ENDOWMENT_GOOD'];
    for (const g of GOODS) {
      const src = sourceOf(g.file);
      // Every import statement, including the multi-line `import type { A,\n  B } from` form.
      const imports = (src.match(/^import\b[\s\S]*?;$/gm) ?? []).join('\n');
      for (const other of OTHERS) {
        if (other === g.name) continue;
        expect(
          imports.includes(other),
          `${g.file} imports ${other}; a goods constant must not be defined in terms of another`,
        ).toBe(false);
      }
    }
  });
});
