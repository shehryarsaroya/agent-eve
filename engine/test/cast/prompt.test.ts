import { citedSection, sectionIsNeeded, situationalFocus } from '../../src/cast/prompt.js';
/**
 * SCAR-1, again, at the cast's own boundary.
 *
 * `test/rules-surface/agent-md.test.ts` compares `agent.md` against the spec. This file
 * compares the **cast's prompt** against `agent.md` — because the cast is a player, and
 * the moment its prompt becomes a second description of the game, the two will disagree
 * and the disagreement will be invisible. High Water's worst bug was exactly that shape
 * and it survived three critic passes.
 *
 * The defence is structural rather than diligent: the prompt is *cut out of* `agent.md`
 * by heading, and a heading that is not there returns `null` and **turns the LLM cast
 * off**. That is the test below that matters most — refusing to play beats playing from
 * a stale copy.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildPrompt,
  CONTRACT_CATALOG,
  CONTRACT_NOT_EXCERPTED,
  CONTRACT_SECTIONS,
  DROP_ORDER,
  EVERY_SITUATION,
  excerptFor,
  loadContract,
  loadContractDocument,
  MAX_CONTRACT_CHARS,
  projectObservation,
  readSituation,
  REPLY_SCHEMA,
  type ContractSituation,
} from '../../src/cast/index.js';
import { buildObservation, OBSERVE_KEYS, type Observation } from '../../src/api/observe.js';
import { charactersFor, HeuristicCast } from '../../src/cast/index.js';
import { FREE_VERBS } from '../../src/tick/budget.js';
import { setSpeed } from '../../src/core/time.js';
import { Runtime } from '../../src/sim/runtime.js';

const AGENT_MD = readFileSync(new URL('../../agent.md', import.meta.url), 'utf8');

/** A real observation, from a real seated world. Never a hand-written fixture. */
function anObservation(): Observation {
  setSpeed('instant');
  const runtime = new Runtime({ seed: 'prompt' });
  const cast = new HeuristicCast(runtime, { size: 3 });
  const members = cast.seat('prompt');
  runtime.runTick();
  const first = members[0];
  if (first === undefined) throw new Error('no cast seated');
  return buildObservation({
    runtime,
    principal: first.principal,
    serverNowMs: 0,
    fresh: true,
    wakesRemaining: 16,
    stale: false,
    corrections: [],
    actionsRemaining: 4,
  });
}

describe('the contract comes from agent.md, or the cast does not play', () => {
  it('every section it asks for exists in agent.md, verbatim', () => {
    for (const heading of CONTRACT_SECTIONS) {
      expect(AGENT_MD).toContain(`\n${heading}\n`);
    }
  });

  it('loads, and carries the sections it named', () => {
    const contract = loadContract();
    expect(contract).not.toBeNull();
    // The same SET as the catalog — but ordered floor-first, not in document order, because
    // the floor is the shared cached prefix. See `excerptFor`.
    expect([...(contract?.sections ?? [])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual(
      [...CONTRACT_SECTIONS].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    );
    expect(contract?.dropped).toEqual([]);
    expect(contract?.notThisWake).toEqual([]);
    expect((contract?.text ?? '').length).toBeLessThanOrEqual(MAX_CONTRACT_CHARS);
    // It is the document, not a paraphrase of it: a distinctive sentence survives.
    expect(contract?.text).toContain('An illegal action is not an error.');
  });

  it('emits the floor first, in one order, so the cached prefix is not per-member', () => {
    const contract = loadContract();
    const floors = CONTRACT_CATALOG.filter((s) => s.floor).map((s) => s.heading);
    expect(contract?.sections.slice(0, floors.length)).toEqual(floors);
  });

  it('RETURNS NULL when a required heading has moved — which disables the LLM cast', () => {
    // The scar-#1 tripwire. Renaming `## 7. Acting` in `agent.md` must not leave the cast
    // quietly prompting from a copy of the old rules; it must stop.
    const mangled = AGENT_MD.replace('\n## 7. Acting\n', '\n## 7. Taking action\n');
    expect(loadContract(mangled)).toBeNull();
  });

  it('returns null when agent.md cannot be read at all', () => {
    expect(loadContract('')).toBeNull();
  });

  it('drops from the end and says so when a section grows without bound', () => {
    const contract = loadContract(AGENT_MD, 4_000);
    expect(contract).not.toBeNull();
    expect((contract?.dropped ?? []).length).toBeGreaterThan(0);
    // Never silently: the omission is named, and `buildPrompt` prints the names.
    expect(contract?.sections.length).toBeLessThan(CONTRACT_SECTIONS.length);
  });
});

describe('the prompt', () => {
  it('states the verb list the ENGINE implements, not a copy of one', () => {
    const contract = loadContract();
    expect(contract).not.toBeNull();
    if (contract === null) return;
    setSpeed('instant');
    const runtime = new Runtime({ seed: 'verbs' });
    const cast = new HeuristicCast(runtime, { size: 1 });
    const members = cast.seat('verbs');
    const character = charactersFor(members, 'verbs').values().next().value;
    expect(character).toBeDefined();
    if (character === undefined) return;

    const liveVerbs = [...runtime.liveVerbs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const prompt = buildPrompt({
      contract,
      character,
      observation: anObservation(),
      memory: 'nothing',
      liveVerbs,
      planMax: 3,
    });
    const text = prompt.messages.map((m) => m.content).join('\n');
    for (const verb of liveVerbs) expect(text).toContain(verb);
    // And the schema the parser enforces is the schema the prompt describes.
    expect(text).toContain(REPLY_SCHEMA);
    expect(text).toContain('THE WHOLE REPLY IS DISCARDED');
    expect(text).toContain('Never a decimal');
  });

  it('puts the contract first, byte-identical for every member', () => {
    const contract = loadContract();
    if (contract === null) throw new Error('no contract');
    setSpeed('instant');
    const runtime = new Runtime({ seed: 'prefix' });
    const cast = new HeuristicCast(runtime, { size: 4 });
    const members = cast.seat('prefix');
    const characters = [...charactersFor(members, 'prefix').values()];
    const observation = anObservation();
    const prefixes = characters.map(
      (character) =>
        buildPrompt({ contract, character, observation, memory: '', liveVerbs: ['move'], planMax: 1 })
          .messages[0]?.content ?? '',
    );
    expect(new Set(prefixes).size).toBe(1);
    // And the members really do differ, downstream of the shared prefix.
    const seconds = characters.map(
      (character) =>
        buildPrompt({ contract, character, observation, memory: '', liveVerbs: ['move'], planMax: 1 })
          .messages[1]?.content ?? '',
    );
    expect(new Set(seconds).size).toBe(characters.length);
  });

  it('carries the member’s own creed and stance', () => {
    const contract = loadContract();
    if (contract === null) throw new Error('no contract');
    setSpeed('instant');
    const runtime = new Runtime({ seed: 'creed' });
    const cast = new HeuristicCast(runtime, { size: 2 });
    const members = cast.seat('creed');
    const character = charactersFor(members, 'creed').values().next().value;
    if (character === undefined) throw new Error('no character');
    const prompt = buildPrompt({
      contract,
      character,
      observation: anObservation(),
      memory: 'you were refused once',
      liveVerbs: ['move'],
      planMax: 1,
    });
    const text = prompt.messages.map((m) => m.content).join('\n');
    expect(text).toContain(character.handle);
    expect(text).toContain(character.title);
    expect(text).toContain(character.creed);
    expect(text).toContain('you were refused once');
  });
});

describe('the observation is projected, never truncated into invalid JSON', () => {
  it('passes the whole thing through when it fits', () => {
    const observation = anObservation();
    const projected = projectObservation(observation, 1_000_000);
    expect(projected.omitted).toEqual([]);
    const parsed: unknown = JSON.parse(projected.json);
    expect(Object.keys(parsed as object)).toEqual([...OBSERVE_KEYS]);
  });

  it('drops whole keys in the published order, and the result is still valid JSON', () => {
    const observation = anObservation();
    const full = JSON.stringify(observation).length;
    const projected = projectObservation(observation, Math.floor(full / 2));
    expect(projected.omitted.length).toBeGreaterThan(0);
    // Whole keys, in order, from the published list.
    for (const [i, key] of projected.omitted.entries()) {
      if (key.includes('affordances[]')) continue;
      expect(DROP_ORDER[i]).toBe(key);
    }
    expect(() => JSON.parse(projected.json) as unknown).not.toThrow();
  });

  it('NEVER drops the four keys a decision cannot be made without', () => {
    const observation = anObservation();
    // A cap so small that everything droppable must go.
    const projected = projectObservation(observation, 200);
    // It overshoots the cap rather than cutting the document in half, and that is the
    // right trade: a JSON document truncated at byte 200 is not a smaller document, it
    // is an invalid one, and a model handed invalid JSON will invent the rest.
    expect(() => JSON.parse(projected.json) as unknown).not.toThrow();
    expect(projected.json.length).toBeGreaterThan(200);
    const parsed = JSON.parse(projected.json) as Record<string, unknown>;
    for (const key of ['header', 'obligations', 'affordances', 'briefing']) {
      expect(Object.keys(parsed)).toContain(key);
    }
  });

  it('counts what it left out, always — the PROP-O1 discipline applied to our own reader', () => {
    const observation = anObservation();
    const projected = projectObservation(observation, 300);
    expect(projected.omitted.length).toBeGreaterThan(0);
    for (const name of projected.omitted) expect(name.length).toBeGreaterThan(0);
  });
});

describe('the prompt names the talk acts, or a layer of the record stays empty', () => {
  it('names every act the engine accepts, and assure among them', () => {
    // `publicLine` in the settled frame — §11.1's layer 1, what a principal SAID — is read
    // from the creator's last `assure`. The cast talked (126 messages on the live world) and
    // never once assured, because nothing in the prompt mentioned the acts. So the field was
    // wired correctly and would have read null forever: a layer of the say-do gap empty not
    // because nobody lied but because nobody was told the word existed.
    //
    // The acts are asserted against the ENGINE's own list rather than retyped, so a prompt
    // that drifts from what `vMessage` accepts fails here (scar #1).
    const contract = loadContract();
    expect(contract).not.toBeNull();
    if (contract === null) return;
    const runtime = new Runtime({ seed: 'acts' });
    const cast = new HeuristicCast(runtime, { size: 1 });
    const members = cast.seat('acts');
    const character = charactersFor(members, 'acts').values().next().value;
    if (character === undefined) return;
    const text = buildPrompt({
      contract,
      character,
      observation: anObservation(),
      memory: 'nothing',
      liveVerbs: [...runtime.liveVerbs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      planMax: 2,
    })
      .messages.map((m) => m.content)
      .join('\n');
    for (const act of ['offer', 'counter', 'accept', 'decline', 'assure']) {
      expect(text, `the prompt must name the '${act}' act`).toContain(act);
    }
    // And it must say what assure COSTS, not merely that it exists.
    expect(text).toMatch(/quoted back at you/i);
  });
});

describe('scar #1 — the prompt tells the truth about what talk costs', () => {
  it('names exactly the verbs the ENGINE charges nothing for, never a hand-written list', () => {
    // The live world ran eight Reckonings with 510 ventures, 297 seals — and ZERO
    // messages. The cast never negotiated, so §14's receipt reel had nothing to show:
    // it is built from what a traitor said next to what it did, and nobody said anything.
    //
    // The cause was not the engine. `message` is a live verb, is handled, and is in
    // FREE_VERBS ("charging for talk starves the channel"). The prompt simply never said
    // so, while steering hard toward copying affordances — so every plan slot went to a
    // material action and talk never competed.
    //
    // The list is read FROM the budget rather than retyped here, because a prompt that
    // claims a verb is free when the engine charges for it is scar #1 exactly: the
    // rules surface and the engine disagreeing about one word.
    const contract = loadContract();
    expect(contract).not.toBeNull();
    if (contract === null) return;
    const runtime = new Runtime({ seed: 'talk' });
    const cast = new HeuristicCast(runtime, { size: 1 });
    const members = cast.seat('talk');
    const character = charactersFor(members, 'talk').values().next().value;
    expect(character).toBeDefined();
    if (character === undefined) return;
    const text = buildPrompt({
      contract,
      character,
      observation: anObservation(),
      memory: 'nothing',
      liveVerbs: [...runtime.liveVerbs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      planMax: 2,
    })
      .messages.map((m) => m.content)
      .join('\n');

    for (const verb of FREE_VERBS) {
      expect(text, `the prompt must name ${verb} as free`).toContain(verb);
    }
    expect(text).toMatch(/cost NO action budget/i);
  });

  it('does not tell the cast to be honest or to talk — that would author the story (A12)', () => {
    // A12: ship systems, never scripted narrative. The prompt may state the incentive and
    // the mechanics; it must not supply the strategy, or the drama is ours and not theirs.
    const contract = loadContract();
    expect(contract).not.toBeNull();
    if (contract === null) return;
    const runtime = new Runtime({ seed: 'talk' });
    const cast = new HeuristicCast(runtime, { size: 1 });
    const members = cast.seat('talk');
    const character = charactersFor(members, 'talk').values().next().value;
    expect(character).toBeDefined();
    if (character === undefined) return;
    const text = buildPrompt({
      contract,
      character,
      observation: anObservation(),
      memory: 'nothing',
      liveVerbs: [...runtime.liveVerbs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      planMax: 2,
    })
      .messages.map((m) => m.content)
      .join('\n');

    expect(text).toMatch(/Silence is legal/i);
    expect(text).not.toMatch(/you should (?:be honest|always tell)/i);
  });
});

describe('the cast can always read where goods come from', () => {
  /**
   * §11A was pushed out of the excerpt the moment it was added: the selected sections measured
   * 25,936 against a 26,000 ceiling that its own comment called "slack rather than a working
   * limit". The drop was disclosed, not silent — but a cast prompting from a rulebook with no
   * goods source watches its Levy shortfall climb every Reckoning and cannot act on it.
   *
   * So this asserts the specific section AND leaves headroom, because the failure mode is a
   * ceiling that quietly becomes a working limit again as agent.md grows.
   */
  it('never drops the WORKS section, and keeps room to spare', () => {
    const contract = loadContract();
    expect(contract?.dropped, 'nothing may be dropped at the current size').toEqual([]);
    expect(contract?.text, 'the yield table has to survive the excerpt').toContain('| FRONTIER |');
    expect(contract?.text).toContain('The yield belongs to the place');
    // §11A is FLOOR now, so this cannot be lost to a situation either — only to length.
    expect(CONTRACT_CATALOG.find((s) => s.heading.startsWith('## 11A'))?.floor).toBe(true);
    // Headroom, so the next section added to agent.md does not repeat this. `loadContract()`
    // is the CEILING of the catalog — every conditional at once — which is the number to read
    // before adding a section, and the enumeration below is what says which combination broke.
    const used = contract?.text.length ?? 0;
    expect(used, `the excerpt is ${String(used)} of ${String(MAX_CONTRACT_CHARS)} — too tight`)
      .toBeLessThan(MAX_CONTRACT_CHARS * 0.95);
  });
});

/** A situation with nothing in it. Fields are turned on one at a time from here. */
const NOTHING: ContractSituation = {
  verbs: new Set<string>(),
  inCommons: false,
  commonsBound: false,
  inVenture: false,
  holdsGrant: false,
};

function document() {
  const doc = loadContractDocument();
  if (doc === null) throw new Error('agent.md could not be read');
  return doc;
}

describe('the excerpt is SELECTED from the observation, and a needed rule is never dropped', () => {
  /**
   * ══════════════════════════════════════════════════════════════════════════════
   * The excerpt was every section on every wake. At 37,902 of a 38,000 bar that had become a
   * content tax: the two changes before this one each traded rules prose for room, one
   * compressing a verbatim sovereignty statement to a numbers check. And at ~40,000 the next
   * section would have dropped §12 off the end silently.
   *
   * These tests are the guarantee, not the saving. The saving is measured at the bottom.
   * ══════════════════════════════════════════════════════════════════════════════
   */

  it('★ A SECTION WHOSE VERB IS OFFERED IS ALWAYS INCLUDED — every verb, exhaustively', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // THE ONE THAT MATTERS. Omitting a rule a member is about to act on is worse than the
    // ceiling ever was: it is refused for something it was never told, and a refusal costs it
    // one of four material actions (AGT-S2). So this does not sample — it walks every verb in
    // the catalog and asserts that offering that verb ALONE, to a member with no venture, no
    // grant and no Commons, pulls its section in.
    //
    // MUTATION: delete a verb from any section's `verbs`, or make `sectionIsNeeded` consult
    // `standing` before the verb list, and this goes red naming the verb and the section.
    // ══════════════════════════════════════════════════════════════════════════
    const doc = document();
    for (const section of CONTRACT_CATALOG) {
      for (const verb of section.verbs) {
        const excerpt = excerptFor(doc, { ...NOTHING, verbs: new Set([verb]) });
        expect(
          excerpt.sections,
          `'${verb}' is offered and ${section.heading} is its rules — a member refused for a ` +
            'rule it was never given loses a real action, which is worse than a long prompt',
        ).toContain(section.heading);
        expect(sectionIsNeeded(section, { ...NOTHING, verbs: new Set([verb]) })).toBe(true);
      }
    }
  });

  it('★ EVERY VERB THE ENGINE IMPLEMENTS HAS A HOME, in the catalog or named as absent', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // The other half of the guarantee, and it is what makes the previous test complete rather
    // than merely true: a verb missing from every `verbs` list would pass above (nothing to
    // check) and ship with no rules at all.
    //
    // Nine live verbs' only home is a section the excerpt has NEVER carried — `post_bond`
    // (§11B), `form`/`apply`/`admit`/`approve` (§11C), `yield`/`fight`/`join`/`demand` (§11D).
    // That was silent until now and two test comments recorded it with a shrug. It is now
    // counted here and named in every prompt. Read `CONTRACT_NOT_EXCERPTED` for why they do
    // not fit and what closing it costs.
    //
    // Verbs come off the ENGINE, never a list retyped here (scar #1).
    // ══════════════════════════════════════════════════════════════════════════
    setSpeed('instant');
    const runtime = new Runtime({ seed: 'homes' });
    const inCatalog = new Set(CONTRACT_CATALOG.flatMap((s) => [...s.verbs]));
    const named = new Set(CONTRACT_NOT_EXCERPTED.flatMap((s) => [...s.verbs]));

    const homeless = [...runtime.liveVerbs].filter((v) => !inCatalog.has(v) && !named.has(v));
    expect(
      homeless,
      `these live verbs have no rules anywhere the cast can read and nothing says so: ` +
        `${homeless.join(', ')}. Claim each one in CONTRACT_CATALOG (if its section is ` +
        'excerpted) or in CONTRACT_NOT_EXCERPTED (if it is not, with the reason).',
    ).toEqual([]);

    // And the size of the hole is pinned, so it cannot grow quietly.
    const unreadable = [...runtime.liveVerbs].filter((v) => !inCatalog.has(v));
    expect(
      unreadable.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      'nine, and the same nine: a tenth means a new mechanic shipped with no rules the cast ' +
        'can read, which is exactly the class of bug agent.md exists to prevent',
    ).toEqual(['admit', 'apply', 'approve', 'demand', 'fight', 'form', 'join', 'post_bond', 'yield']);
  });

  it('★ EVERY REACHABLE SELECTION FITS — the whole space, enumerated', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // This replaces "the one excerpt is under the bar" with "the whole selection space is",
    // which is the only form of the assertion that is a guarantee. Three conditionals means
    // eight reachable excerpts, and exhaustion is cheap.
    //
    // It is also the instrument for the NEXT section added to agent.md. The old assertion
    // could only say "you are out of room"; this one names the combination, so the answer
    // ("make it conditional on something the biggest combination does not have") is readable
    // off the failure. Verified by mutation: adding §11D PREDATION as a conditional fails here
    // with *"## 4. Work happens in ventures + ## 10. Granting authority is 38438 of 38000"* —
    // 438 over, which is the number `CONTRACT_NOT_EXCERPTED` cites for why §11D is still out.
    // ══════════════════════════════════════════════════════════════════════════
    const doc = document();
    const bar = MAX_CONTRACT_CHARS * 0.95;
    const conditionals = CONTRACT_CATALOG.filter((s) => !s.floor);
    const sizes: { combination: string; chars: number }[] = [];

    for (let mask = 0; mask < 1 << conditionals.length; mask += 1) {
      const on = conditionals.filter((_, i) => (mask & (1 << i)) !== 0);
      // Turned on through the VERB path, because that is the path with no escape hatch.
      const verbs = new Set(on.map((s) => s.verbs[0] ?? ''));
      const excerpt = excerptFor(doc, { ...NOTHING, verbs });
      const combination = on.length === 0 ? '(floor only)' : on.map((s) => s.heading).join(' + ');
      sizes.push({ combination, chars: excerpt.text.length });

      expect(
        excerpt.dropped,
        `${combination} overflowed and dropped ${excerpt.dropped.join(', ')} — a NEEDED ` +
          'section was lost to length, which is the failure this whole mechanism exists to ' +
          'prevent. Do not raise the ceiling: make the newest section conditional on ' +
          'something this combination does not have.',
      ).toEqual([]);
      expect(
        excerpt.text.length,
        `${combination} is ${String(excerpt.text.length)} of ${String(bar)} — over the bar`,
      ).toBeLessThan(bar);
    }

    // The floor is the same in all of them; only the conditionals move.
    expect(sizes.length).toBe(2 ** conditionals.length);
    const worst = sizes.reduce((a, b) => (b.chars > a.chars ? b : a));
    expect(worst.chars, `worst reachable selection: ${worst.combination}`).toBeLessThan(bar);
  });

  it('a newcomer with no venture and no grant is not handed the venture or office rules', () => {
    const doc = document();
    const excerpt = excerptFor(doc, { ...NOTHING, inCommons: true, commonsBound: true });
    expect(excerpt.sections).toContain('## 11. The Commons');
    expect(excerpt.sections).not.toContain('## 4. Work happens in ventures');
    expect(excerpt.sections).not.toContain('## 10. Granting authority');
    // Never silently — each absence is named with its reason, and the reason is about the
    // member's situation rather than about the world.
    const left = excerpt.notThisWake.map((o) => o.heading);
    expect(left).toContain('## 4. Work happens in ventures');
    expect(left).toContain('## 10. Granting authority');
    for (const omission of excerpt.notThisWake) expect(omission.because.length).toBeGreaterThan(20);
  });

  it('a member whose holding has left the Commons is not handed §11, and is told why', () => {
    const doc = document();
    const excerpt = excerptFor(doc, { ...NOTHING, inVenture: true, holdsGrant: true });
    expect(excerpt.sections).not.toContain('## 11. The Commons');
    expect(excerpt.sections).toContain('## 4. Work happens in ventures');
    expect(excerpt.sections).toContain('## 10. Granting authority');
    expect(excerpt.notThisWake.find((o) => o.heading === '## 11. The Commons')?.because).toContain(
      'left the Commons',
    );
  });

  it('the FLOOR is in every excerpt, whatever the situation', () => {
    const doc = document();
    const floors = CONTRACT_CATALOG.filter((s) => s.floor).map((s) => s.heading);
    for (const situation of [
      NOTHING,
      { ...NOTHING, inCommons: true },
      { ...NOTHING, inVenture: true, holdsGrant: true },
      EVERY_SITUATION,
    ]) {
      const excerpt = excerptFor(doc, situation);
      for (const heading of floors) expect(excerpt.sections).toContain(heading);
    }
    // And the floor really is the identical prefix two different situations share, which is
    // the answer to "selection breaks the cached prefix".
    const a = excerptFor(doc, { ...NOTHING, inCommons: true }).text;
    const b = excerptFor(doc, { ...NOTHING, inVenture: true }).text;
    let shared = 0;
    while (shared < a.length && shared < b.length && a[shared] === b[shared]) shared += 1;
    expect(shared, 'the shared prefix must be the whole floor, not the first section').toBeGreaterThan(
      20_000,
    );
  });

  it('is DETERMINISTIC — the same observation cuts the same excerpt, byte for byte', () => {
    // It runs inside the tick. DET-7 bans `Date.now`; nothing here may vary between two calls.
    const doc = document();
    const observation = anObservation();
    const first = excerptFor(doc, readSituation(observation as unknown as Record<string, unknown>));
    const second = excerptFor(doc, readSituation(observation as unknown as Record<string, unknown>));
    expect(second.text).toBe(first.text);
    expect(second.sections).toEqual(first.sections);
    expect(second.notThisWake).toEqual(first.notThisWake);
  });

  it('reads the situation off the REAL observation, at the paths observe actually uses', () => {
    // `readSituation` looking in the wrong place is the failure mode that reads green forever:
    // `situationalFocus` looked for a top-level `syndicates` key for its whole life, and
    // `observe` nests it under `grants`, so that line never fired once in production.
    const observation = anObservation();
    const situation = readSituation(observation as unknown as Record<string, unknown>);
    expect(situation.verbs.size, 'a seated member is offered something').toBeGreaterThan(0);
    for (const affordance of observation.affordances) {
      expect(situation.verbs).toContain(affordance.verb);
    }
    expect(situation.inCommons, 'enrolment seats in the Commons').toBe(true);
    expect(situation.commonsBound).toBe(observation.holding['commons_bound']);
  });

  it('states every absence in the PROMPT, with the reason and where the rest lives', () => {
    const doc = document();
    setSpeed('instant');
    const runtime = new Runtime({ seed: 'absence' });
    const cast = new HeuristicCast(runtime, { size: 1 });
    const members = cast.seat('absence');
    const character = charactersFor(members, 'absence').values().next().value;
    if (character === undefined) throw new Error('no character');

    const contract = excerptFor(doc, { ...NOTHING, inCommons: true });
    expect(contract.notThisWake.length).toBeGreaterThan(0);
    const text = buildPrompt({
      contract,
      character,
      observation: anObservation(),
      memory: 'nothing',
      liveVerbs: ['move'],
      planMax: 1,
    })
      .messages.map((m) => m.content)
      .join('\n');

    expect(text).toContain('NOT IN THIS EXCERPT');
    for (const omission of contract.notThisWake) {
      expect(text, `${omission.heading} is absent and unnamed`).toContain(omission.heading);
      expect(text).toContain(omission.because);
    }
    // The standing absences too — the nine verbs with no readable rules are disclosed rather
    // than left to silence.
    for (const omission of CONTRACT_NOT_EXCERPTED) expect(text).toContain(omission.heading);
    // And how to get it.
    expect(text).toContain('GET /compact/api/agent.md');
  });

  it('★ MEASURED, on a real world: the three wakes that matter, in characters', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // Not a synthetic situation — `readSituation` over a real observation from a real seated
    // world, so a predicate that reads a field `observe` does not publish cannot pass here.
    //
    // Measured over 900 ticks × 12 members (1,548 wakes, `scripts/` throwaway): 43% of wakes
    // are 32,664 and 57% are 37,902. The 57% is honest rather than a bug — this world offers
    // `create`, `publish_offer` and `graduate` on essentially every wake, so §4 and §11 are
    // genuinely needed, and §10 arrives with the first grant. **Selection bounds the typical
    // excerpt; it cannot bound the maximum, because the maximum is the catalog.**
    // ══════════════════════════════════════════════════════════════════════════
    const doc = document();
    const bar = MAX_CONTRACT_CHARS * 0.95;

    const newcomer = excerptFor(doc, { ...NOTHING, inCommons: true, commonsBound: true });
    const midGame = excerptFor(doc, {
      ...NOTHING,
      inCommons: true,
      commonsBound: true,
      inVenture: true,
      verbs: new Set(['create', 'message', 'elect']),
    });
    const claimHolder = excerptFor(doc, {
      ...NOTHING,
      inVenture: true,
      holdsGrant: true,
      verbs: new Set(['create', 'build', 'post_bond', 'deliver']),
    });

    // Pinned, so a section added to agent.md moves a number here and somebody has to look.
    expect(newcomer.text.length, 'newcomer: Commons, no venture, no grant').toBe(25_062);
    expect(midGame.text.length, 'mid-game: Commons, in ventures, no grant').toBe(32_664);
    expect(claimHolder.text.length, 'claim-holder: out of the Commons, ventures, holds a grant').toBe(
      33_830,
    );

    for (const [name, excerpt] of [
      ['newcomer', newcomer],
      ['mid-game', midGame],
      ['claim-holder', claimHolder],
    ] as const) {
      expect(excerpt.dropped, `${name} lost a section to length`).toEqual([]);
      expect(excerpt.text.length, `${name} is over the bar`).toBeLessThan(bar);
    }

    // The claim-holder is offered `post_bond`, whose only rules are §11B — and §11B has never
    // been in the excerpt. The prompt has to say so rather than leave the member to find out
    // by being refused. This is the gap, asserted, not described.
    expect(
      CONTRACT_NOT_EXCERPTED.find((s) => s.verbs.includes('post_bond'))?.heading,
    ).toBe('## 11B. Sovereignty — territory you have to MAINTAIN');
  });
});

describe('the contract stays whole and cached; the FOCUS is per-member', () => {
  /**
   * I raised `MAX_CONTRACT_CHARS` twice and wrote down that the contract was "the wrong shape" and
   * should be projected per situation. Then I checked the arithmetic and the recorded fix was wrong.
   *
   * The contract is the FIRST system message and byte-identical for every member, so it is one
   * shared cached prefix — 40,000 characters is ≈10k tokens ≈ $0.001 a call cached, against ~$0.25
   * an hour of total spend. A rounding error. And a per-situation projection would BREAK that: each
   * variant becomes its own prefix, trading a rounding error for real cache misses.
   *
   * The real risk over 40,000 characters is attention, not money. So the pointer goes in the USER
   * message, which is already per-member and already uncached — and it points INTO the real document
   * rather than paraphrasing it, which is what scar #1 forbids.
   */
  it('names the sections a Commons newcomer is standing in, and not the ones it is not', () => {
    const focus = situationalFocus({
      holding: { tier: 'COMMONS', sovereignty: null, works: { held: [] } },
      obligations: { charge: [] },
      affordances: [{ verb: 'create', params: {} }],
      grants: { syndicates: [] },
    });
    const text = focus.join(' | ');
    expect(text, 'the Commons is where it is standing').toContain('§11 The Commons');
    expect(text, 'and it is told nothing about territory it cannot hold').not.toContain('§11B');
    expect(text, 'nor about syndicates it is not in').not.toContain('§11C');
  });

  it('names sovereignty and the Charge for a claimant with a bill due', () => {
    const focus = situationalFocus({
      holding: { tier: 'MARCHES', sovereignty: { statement: 'x' }, works: { held: [{}] } },
      obligations: { charge: [{ owed: 4_000 }] },
      affordances: [{ verb: 'deliver', params: {} }],
      grants: { syndicates: [] },
    });
    const text = focus.join(' | ');
    expect(text).toContain('§11B Sovereignty');
    expect(text).toContain('§11B The Charge');
    expect(text, 'and WORKS, because it holds one').toContain('§11A WORKS');
    expect(text, 'and NOT the Commons, which it has left').not.toContain('§11 The Commons');
  });

  it('reads syndicates at `grants.syndicates`, which is where `observe` puts them', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // The §11C line read a TOP-LEVEL `syndicates` key. `observe` nests it under `grants` —
    // §17's ten-key budget is at its ceiling and the comment there says so — so on every real
    // observation the condition was `undefined.length > 0` and the line had never fired once
    // in production. The old test passed because its fixture put the key where the code
    // looked instead of where the engine puts it, which is the whole failure mode: a pointer
    // that exists, is tested, and reaches nobody.
    //
    // MUTATION: put the read back at the top level and this goes red while the fixture stays
    // honest, because the fixture is now shaped like `observe`'s output.
    // ══════════════════════════════════════════════════════════════════════════
    const inOne = situationalFocus({
      holding: { tier: 'MARCHES', sovereignty: null, works: { held: [] } },
      obligations: { charge: [] },
      affordances: [],
      grants: { granted: [], held: [], syndicates: [{ id: 'syn:vex:12', name: 'The Ninth' }] },
    });
    expect(inOne.join(' | '), 'a member inside a syndicate must be told its charter is fixed').toContain(
      '§11C Syndicates',
    );

    // And the shape really is observe's: a live observation carries the key under `grants`.
    const observation = anObservation();
    expect(Object.keys(observation.grants)).toContain('syndicates');
    expect(Object.keys(observation)).not.toContain('syndicates');
  });

  it('MARKS a focus line whose section is not in this wake’s excerpt', () => {
    // Pointing at §11B is right — the member does hold territory. Pointing at it as though it
    // were in the rulebook the member was handed is not: §11B has never been excerpted. The
    // marker is derived from the excerpt's own `sections`, so it cannot drift from what shipped.
    const doc = loadContractDocument();
    if (doc === null) throw new Error('no document');
    setSpeed('instant');
    const runtime = new Runtime({ seed: 'marker' });
    const cast = new HeuristicCast(runtime, { size: 1 });
    const members = cast.seat('marker');
    const character = charactersFor(members, 'marker').values().next().value;
    if (character === undefined) throw new Error('no character');

    const observation = {
      ...anObservation(),
      holding: { tier: 'MARCHES', sovereignty: 'a statement', commons_bound: false, works: { held: [{}] } },
      obligations: { charge: [{ owed: 4_000 }] },
    } as unknown as Observation;
    const contract = excerptFor(doc, readSituation(observation as unknown as Record<string, unknown>));
    const text = buildPrompt({
      contract,
      character,
      observation,
      memory: 'nothing',
      liveVerbs: ['move'],
      planMax: 1,
    })
      .messages.map((m) => m.content)
      .join('\n');

    expect(text).toMatch(/§11B Sovereignty[^\n]*NOT IN THIS EXCERPT/);
    // §11A is floor, so its line is never marked.
    expect(text).toMatch(/§11A WORKS — the only source of goods in this world\n/);
  });

  it('every § a focus line cites resolves to a real section of agent.md', () => {
    // A focus line citing a § that does not exist is a pointer into nothing, and it would read
    // perfectly in review. Checked against the two lists rather than a typed-out set.
    const known = new Set(
      [...CONTRACT_SECTIONS, ...CONTRACT_NOT_EXCERPTED.map((s) => s.heading)].map(
        (h) => /^##\s+([^.\s]+)\./.exec(h)?.[1] ?? h,
      ),
    );
    const everyLine = [
      ...situationalFocus({
        holding: { tier: 'COMMONS', sovereignty: 'x', commons_bound: true, works: { held: [{}] } },
        obligations: { charge: [{ owed: 1 }] },
        affordances: [
          { verb: 'graduate', params: {} },
          { verb: 'build', params: { kind: 'WORKS' } },
          { verb: 'message', params: {} },
        ],
        grants: { syndicates: [{ id: 'syn:a:1' }] },
      }),
    ];
    expect(everyLine.length).toBeGreaterThan(4);
    for (const line of everyLine) {
      const cited = citedSection(line);
      expect(cited, `"${line}" cites no §`).not.toBeNull();
      expect(known, `"${line}" cites §${String(cited)}, which is not a section of agent.md`).toContain(
        cited,
      );
    }
  });

  it('puts the free assurance LAST, so it is an addition rather than a substitution', () => {
    const focus = situationalFocus({
      holding: { tier: 'MARCHES', sovereignty: null, works: { held: [] } },
      obligations: { charge: [] },
      affordances: [{ verb: 'message', params: { act: 'assure' } }, { verb: 'graduate', params: {} }],
      grants: { syndicates: [] },
    });
    expect(focus.length).toBeGreaterThan(1);
    expect(
      focus[focus.length - 1],
      'the assurance is free, so it should read as something to do AS WELL as the plan',
    ).toContain('Negotiating');
  });

  it('says nothing at all when the situation touches nothing special', () => {
    // An empty focus must produce no block: a header with no bullets under it is noise in a prompt
    // whose whole problem is that it is long.
    expect(situationalFocus({ holding: {}, obligations: {}, affordances: [], grants: {} })).toEqual([]);
  });
});
