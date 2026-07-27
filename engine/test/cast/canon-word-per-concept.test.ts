/**
 * A CANON WORD MEANING TWO THINGS IN A RULES SURFACE IS SCAR #1.
 *
 * HARD RULE 4: *"One word per concept. SPEC §3 is the vocabulary canon and it is a rules surface, not
 * a style guide. Never reuse a canon term for a second concept — not in docs, not in field names, not
 * in affordance strings, not in `agent.md`."*
 *
 * `grant` is canon for **a scoped delegation of authority** — SPEC §8 is titled "Offices and grants —
 * the betrayal surface", and A6 makes it the core loop. It is arguably the single most load-bearing
 * noun in the design.
 *
 * The LLM cast's prompt and `agent.md` were also using it for **the goods handed out at enrolment**:
 * *"Your enrolment grant is the only goods you will ever be given"*, and *"raising a WORKS out of your
 * enrolment grant is legal"*. The engine has always called that an **endowment**
 * (`ENDOWMENT_GOOD`, `ENDOWMENT_FLOOR_MINOR`, `ledger/endowment.ts`), so the agent-facing text and
 * the engine disagreed about a canon word.
 *
 * That is scar #1 exactly. High Water shipped a game whose central ritual reliably produced the
 * opposite of what the town voted for, and it survived three critic passes *because every individual
 * component was correct* — the engine and the agent-facing text simply disagreed about one word. The
 * failure mode here is not a crash: it is a cast that reads "your grant" as "your starting goods",
 * and therefore never connects the `grant` VERB to delegating authority. Which is worth noting
 * against the observed fact that the live world has **never issued a single grant** and
 * `authorityLines` renders empty.
 *
 * ── WHY A BANNED-PHRASE LIST AND NOT SOMETHING CLEVERER ──────────────────────
 *
 * "Is every use of the word `grant` in this file about authority?" is not mechanically decidable, and
 * a test that pretends otherwise would either pass on everything or need a maintained allowlist of
 * sentences. A banned-phrase list is the same instrument as the determinism lint (DET-1 bans bare
 * `.sort()`): it does not understand the code, it just makes a known-wrong construct impossible to
 * reintroduce quietly. Add to it when a new collision is found.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** Every file an agent's behaviour is actually derived from. */
const RULES_SURFACES = ['agent.md', 'src/cast/prompt.ts', 'src/api/observe.ts'] as const;

/**
 * Phrases that put a canon term on a second concept, each with the word that IS canon for it.
 *
 * Case-insensitive. Keep the replacement in the message — a failure that only says "banned" makes the
 * next person guess, and guessing is how the collision got in.
 */
const COLLISIONS = [
  { phrase: 'enrolment grant', use: 'endowment', canon: 'grant = a scoped delegation of authority (§8, A6)' },
  { phrase: 'enrollment grant', use: 'endowment', canon: 'grant = a scoped delegation of authority (§8, A6)' },
  { phrase: 'starting grant', use: 'endowment', canon: 'grant = a scoped delegation of authority (§8, A6)' },
  { phrase: 'starter grant', use: 'endowment', canon: 'grant = a scoped delegation of authority (§8, A6)' },
] as const;

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL('../../' + relative, import.meta.url)), 'utf8');
}

describe('one word per concept, in the surfaces an agent reads', () => {
  for (const surface of RULES_SURFACES) {
    it(`${surface} does not spend a canon word on a second concept`, () => {
      const text = read(surface).toLowerCase();
      for (const c of COLLISIONS) {
        expect(
          text.includes(c.phrase),
          `${surface} contains "${c.phrase}". That word is canon for something else — ${c.canon} — ` +
            `and the engine calls this concept "${c.use}". Two meanings for one canon term in a rules ` +
            `surface is scar #1: every component reads correctly and the agent still learns the wrong ` +
            `rule. Say "${c.use}".`,
        ).toBe(false);
      }
    });
  }

  it('and the engine still uses the canon word for the concept it owns', () => {
    // The guard's own guard. Renaming away a collision must not have renamed away the REAL use: if
    // `grant` stopped meaning delegated authority in the agent-facing text, the core loop would have
    // no name an agent could act on, which is a worse bug than the collision.
    const prompt = read('src/cast/prompt.ts');
    const agentMd = read('agent.md');
    expect(agentMd.toLowerCase(), 'agent.md must still teach the authority sense of grant').toMatch(
      /grant\w*\s+(authority|a scoped|verb)|authority[^.]{0,40}grant/i,
    );
    expect(prompt, 'the prompt must still expose the grants observe key').toContain('grants');
  });
});
