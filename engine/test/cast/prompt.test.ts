import {
  actTokensOf,
  citedSection,
  CONTRACT_ACTS,
  CONTRACT_MULTI_MEANING_VERBS,
  discriminatorsOf,
  situationalFocus,
} from '../../src/cast/prompt.js';
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
  CONTRACT_CEILING_MARGIN,
  CONTRACT_NOT_EXCERPTED,
  CONTRACT_POSITIONS,
  CONTRACT_SECTIONS,
  DROP_ORDER,
  EVERY_SITUATION,
  excerptFor,
  loadContract,
  loadContractDocument,
  MAX_CONTRACT_CHARS,
  NO_SITUATION,
  projectObservation,
  readSituation,
  REPLY_SCHEMA,
  unitGrade,
  unitName,
  type ContractDocument,
  type ContractSituation,
} from '../../src/cast/index.js';
import { buildObservation, OBSERVE_KEYS, type Observation } from '../../src/api/observe.js';
import { charactersFor, HeuristicCast } from '../../src/cast/index.js';
import { FREE_VERBS } from '../../src/tick/budget.js';
import { setSpeed } from '../../src/core/time.js';
import { Runtime } from '../../src/sim/runtime.js';
import { holdingOf } from '../../src/world/index.js';
import { giveAlloy } from '../works/alloy-fixture.js';

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
    correctionsDropped: 0,
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
    expect(contract?.notThisWake, 'the ceiling needs everything').toEqual([]);
    // `loadContract()` selects for EVERY_SITUATION — the analytic ceiling, 51,289 characters,
    // which no principal can occupy. It used to OVERSHOOT a 38,000 bar and lose the two
    // discretionary §11A blocks; the ceiling now sits above it, so the whole catalog fits and
    // nothing at all is dropped. See MAX_CONTRACT_CHARS for why the number moved.
    expect(contract?.overBudget, 'the ceiling must come in under 56,000').toBe(false);
    // It comes in under by SQUEEZING, not by fitting: §9A's combat rules took the uncapped
    // analytic total to 58,446, so two discretionary §11A blocks are dropped and the rest fits.
    // That is the mechanism working — the analytic maximum is unreachable, and what gives is
    // CONTEXT. Asserted as CONTEXT-only rather than asserted away.
    for (const omission of contract?.dropped ?? []) {
      const unit = CONTRACT_CATALOG.find((u) => unitName(u) === omission.heading);
      expect(unit?.floor, `${omission.heading} is FLOOR and was dropped`).not.toBe(true);
      if (unit === undefined) continue;
      expect(unitGrade(unit, EVERY_SITUATION), omission.heading).toBe('CONTEXT');
    }
    // It is the document, not a paraphrase of it: a distinctive sentence survives.
    expect(contract?.text).toContain('An illegal action is not an error.');
  });

  it('emits the FLOOR-ONLY sections first, in one order, so the cached prefix is not per-member', () => {
    const contract = loadContract();
    const floorOnly = CONTRACT_SECTIONS.filter((section) =>
      CONTRACT_CATALOG.filter((u) => u.section === section).every((u) => u.floor === true),
    );
    expect(contract?.sections.slice(0, floorOnly.length)).toEqual(floorOnly);
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

  it('under an absurd cap through `loadContract`, CONTEXT goes and the RULES DO NOT', () => {
    // This used to assert that sections dropped off the end. They no longer can: FLOOR and RULES
    // are emitted whatever the total, so a cap of 4,000 squeezes out every discretionary block
    // and NOTHING ELSE. That is the change `MAX_CONTRACT_CHARS` documents, and asserting the old
    // behaviour would now be asserting that a needed rule can vanish.
    const contract = loadContract(AGENT_MD, 4_000);
    expect(contract).not.toBeNull();
    if (contract === null) return;
    expect(contract.overBudget, 'a 4,000 cap must be reported as overrun').toBe(true);
    expect(contract.dropped.length, 'every discretionary block goes').toBeGreaterThan(0);
    // Every section is still present, because every one of them has a FLOOR or RULES unit here.
    expect(contract.sections.length).toBe(CONTRACT_SECTIONS.length);
    for (const omission of contract.dropped) {
      const unit = CONTRACT_CATALOG.find((u) => unitName(u) === omission.heading);
      expect(unit, omission.heading).toBeDefined();
      expect(unit?.floor, `${omission.heading} is FLOOR and was dropped`).not.toBe(true);
      expect(unit?.verbs.some((v) => EVERY_SITUATION.verbs.has(v)) === true && unit?.required === undefined)
        .toBe(false);
    }
    // And the omission is never silent.
    expect(contract.dropped.every((o) => o.because.length > 10)).toBe(true);
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
    expect(contract?.text, 'the yield table has to survive the excerpt').toContain('| FRONTIER |');
    expect(contract?.text).toContain('The yield belongs to the place');
    // §11A is FLOOR now, so this cannot be lost to a situation either — only to length.
    expect(
      CONTRACT_CATALOG.filter((u) => u.section.startsWith('## 11A') && u.floor === true).length,
      'the WORKS preamble and the yield rule are FLOOR',
    ).toBe(2);
    // Headroom is measured on the positions a principal can actually occupy, not on the
    // analytic ceiling, which overshoots by design. `CONTRACT_POSITIONS` is the governor.
    const doc = document();
    for (const position of CONTRACT_POSITIONS.filter((x) => x.reachable)) {
      const excerpt = excerptFor(doc, position.situation);
      expect(excerpt.text, `${position.name} lost the yield table`).toContain('| FRONTIER |');
      const used = excerpt.text.length;
      expect(
        used,
        `${position.name} is ${String(used)}, leaving less than the declared ` +
          `${String(CONTRACT_CEILING_MARGIN)} of margin under ${String(MAX_CONTRACT_CHARS)}`,
      ).toBeLessThanOrEqual(MAX_CONTRACT_CHARS - CONTRACT_CEILING_MARGIN);
    }
  });
});

/** A situation with nothing in it. Fields are turned on one at a time from here. */
function document(): ContractDocument {
  const doc = loadContractDocument();
  if (doc === null) throw new Error('agent.md could not be read');
  return doc;
}

/** Turn one verb on and nothing else. The tightest situation that can need a unit. */
function offering(...verbs: readonly string[]): ContractSituation {
  return { ...NO_SITUATION, verbs: new Set(verbs) };
}

/**
 * Turn one ACT on and nothing else — and the verb with it, because the engine cannot do otherwise.
 *
 * `readSituation` reads both off the same affordance row, so `build{CAMPAIGN}` without `build` is a
 * state no observation can produce, and a fixture asserting against it would be checking a shape
 * the engine does not have. That is the failure the `##` version's arithmetic made.
 */
function offeringAct(...acts: readonly string[]): ContractSituation {
  return {
    ...NO_SITUATION,
    verbs: new Set(acts.map((act) => act.slice(0, act.indexOf('{')))),
    acts: new Set(acts),
  };
}

describe('the excerpt is SELECTED from the observation, and a needed rule is never dropped', () => {
  /**
   * ══════════════════════════════════════════════════════════════════════════════
   * The excerpt was every `##` section on every wake. At 37,902 of a 38,000 bar that had
   * become a content tax — two consecutive changes traded rules prose for room, one
   * compressing a verbatim sovereignty statement to a numbers check — and at ~40,000 the next
   * section would have dropped §12 off the end silently.
   *
   * Section-level selection freed too little (57% of real wakes still took the whole catalog)
   * and left **nine live verbs with no readable rules**, because §11B/§11C/§11D could not fit
   * as whole sections. `###` granularity is what closed both.
   *
   * These tests are the guarantee. The measurement is at the bottom.
   * ══════════════════════════════════════════════════════════════════════════════
   */

  it('★ A UNIT WHOSE VERB *OR ACT* IS OFFERED IS ALWAYS INCLUDED — exhaustively, both lists', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // THE ONE THAT MATTERS. Omitting a rule a member is about to act on is worse than the
    // ceiling ever was: it is refused for something it was never told, and a refusal costs it
    // one of four material actions (AGT-S2). So this does not sample — it walks every verb AND
    // every act in the catalog and asserts that offering that one thing ALONE, to a member
    // holding nothing, pulls its unit in, at grade RULES, with its section's preamble for company.
    //
    // The `acts` half is new and it is why the property did not weaken when §11E stopped being
    // gated on `build`: an act gate is checked at the SAME precedence as a verb gate — both above
    // `required` and `wanted` — so "whatever is offered, its rules ship" is unchanged in strength.
    //
    // MUTATION: delete a verb or an act from any unit, or make `unitGrade` consult `required` or
    // `wanted` before either list, and this goes red naming the thing and the unit.
    // ══════════════════════════════════════════════════════════════════════════
    const doc = document();
    let verbPairs = 0;
    let actPairs = 0;
    for (const unit of CONTRACT_CATALOG) {
      for (const verb of unit.verbs) {
        verbPairs += 1;
        const situation = offering(verb);
        expect(unitGrade(unit, situation), `${verb} → ${unitName(unit)}`).toBe(
          unit.floor === true ? 'FLOOR' : 'RULES',
        );
        const excerpt = excerptFor(doc, situation);
        expect(
          excerpt.units,
          `'${verb}' is offered and ${unitName(unit)} is its rules — a member refused for a rule ` +
            'it was never given loses a real action, which is worse than a long prompt',
        ).toContain(unitName(unit));
        // And never in `dropped`: RULES does not consult the budget.
        expect(excerpt.dropped.map((o) => o.heading)).not.toContain(unitName(unit));
      }
      for (const act of unit.acts ?? []) {
        actPairs += 1;
        const situation = offeringAct(act);
        expect(unitGrade(unit, situation), `${act} → ${unitName(unit)}`).toBe(
          unit.floor === true ? 'FLOOR' : 'RULES',
        );
        const excerpt = excerptFor(doc, situation);
        expect(
          excerpt.units,
          `'${act}' is offered and ${unitName(unit)} is its rules — the whole point of the act gate ` +
            'is a sharper aim, never a weaker guarantee',
        ).toContain(unitName(unit));
        expect(excerpt.dropped.map((o) => o.heading)).not.toContain(unitName(unit));
      }
    }
    // ── NON-VACUITY, ASSERTED BEFORE THE WALK IS TRUSTED ──────────────────────
    //
    // A loop over `unit.verbs` never runs for a unit whose list is empty, so an exhaustive sweep
    // shaped like this one CANNOT catch a deleted gate — that is exactly how deleting `engage`
    // from a §9A block broke nothing. Both counts are pinned, so emptying any list fails HERE as
    // well as in the pinned maps below.
    // ★ 33: §11G's three units each gate on `demand`, which means one thing however it is
    // parameterised — the `grant` control case, and `principal` is not an ACT_SUBJECT_KEY so no
    // `demand{...}` token could ever be produced to gate on instead.
    expect(verbPairs, 'verb gates in the catalog').toBe(44);
    // ★ 23 at 24: §11D's coalition block is the second unit to gate on `join{RAID}`, which is the
    // token master split out precisely because a raid side and a campaign side are different rules.
    // Two units on one act is not a collision — the both-ways pin below requires every token to be
    // gated by SOME unit, and a bystander needs the answering block's preamble as well as this one.
    // Then `sign{COVER}`/`elect{COVER}` at 29 (Phase 3), and `message{TO}` at 31 — §4's PARLEY
    // block, one act on one unit, the narrow case that keeps a newcomer from paying for a channel it
    // cannot open. **30 is the merged count and it was MEASURED, not carried over:** 29 and 31 were
    // built in parallel, each pinned a number for a catalog containing only its own gate, and both
    // numbers were wrong the moment the two landed together. A pin that is arithmetic on the last
    // pin rather than a reading of the merged catalog is a pin that agrees with itself and nothing
    // else.
    // ★ 33 adds §11G's three units, each gated on `join{RAID}`, `join{CAMPAIGN}` and `build{CAMPAIGN}`
    // — nine more pairs, 30 → 39. Three units on one act is not a collision (see the note above
    // `expect(actPairs` at 24): the both-ways pin below only requires every token to be gated by SOME
    // unit. MEASURED on the merged catalog, for the reason the paragraph above gives — 30 was itself
    // a merge correction, and the branch this came from pinned 32 against a catalog that had neither
    // the risk market's four units nor the parley's one.
    expect(actPairs, 'act gates in the catalog').toBe(39);
  });

  it('★ NO HEADING OF `agent.md` IS A SLOT NOTHING FILLS — the fourth depth, checked here', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // Campaigns turned up a **fourth depth** of this project's recurring defect: not a verb with no
    // handler, not an affordance nothing selects, not an invariant whose subject cannot occur, but
    // **a reserved slot in a published contract that nothing ever fills** — §12.1 reserved a *siege
    // clock* on the holding row and nothing had written to it for the project's whole life.
    //
    // The contract catalog has exactly that failure available to it, in both directions:
    //
    //   · a `##` or `###` heading in `agent.md` that no unit names and that is not in
    //     CONTRACT_NOT_EXCERPTED is **rules prose no cast member can ever be shown**. It is worse
    //     than a missing rule, because it reads as delivered in the document and in review.
    //   · the reverse is already covered — `loadContractDocument` returns `null` and turns the cast
    //     off when a catalogued heading is missing.
    //
    // Measured at the time of writing: **zero orphans.** Which is the point of asserting it — the
    // number is only worth anything if something keeps it at zero.
    // ══════════════════════════════════════════════════════════════════════════
    const outside = new Set(CONTRACT_NOT_EXCERPTED.map((s) => s.heading));
    const catalogued = new Set(CONTRACT_CATALOG.map(unitName));
    const sections = new Set(CONTRACT_CATALOG.map((u) => u.section));
    const orphans: string[] = [];
    let section = '';
    for (const line of AGENT_MD.split('\n')) {
      if (line.startsWith('## ')) {
        section = line.trim();
        if (!sections.has(section) && !outside.has(section)) orphans.push(section);
        continue;
      }
      if (!line.startsWith('### ')) continue;
      // A `###` inside a section nobody excerpts is accounted for by the section's own entry.
      if (outside.has(section) || !sections.has(section)) continue;
      const name = `${section} › ${line.trim()}`;
      if (!catalogued.has(name)) orphans.push(name);
    }
    expect(
      orphans,
      'these headings exist in the player contract and no unit selects them, so the house cast can ' +
        'never read them. Claim each in CONTRACT_CATALOG, or record it in CONTRACT_NOT_EXCERPTED ' +
        'with a CAPABILITY reason.',
    ).toEqual([]);
    // Non-vacuous: the walk must actually have seen the document.
    expect(sections.size, 'no sections were walked at all').toBeGreaterThan(10);
  });

  it('★ AN OFFERED VERB OR ACT BEATS ITS OWN `wanted` — the PRECEDENCE, not just the presence', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // **THIS TEST EXISTS BECAUSE A MUTATION SURVIVED THE OTHER TEN.**
    //
    // Moving `unitGrade`'s act loop BELOW `required`/`wanted` broke nothing. Everything above walks
    // `offering(verb)` / `offeringAct(act)` — a situation with every standing fact false — so no
    // predicate can fire and the loop runs either way. The exhaustive sweep proved the gate is
    // CONSULTED; nothing proved it is consulted FIRST.
    //
    // And first is the whole guarantee. Eighteen units carry a gate *and* a predicate — 41 (gate,
    // unit) pairs between them — and for those
    // the ordering decides between `RULES` (emitted whatever the total) and `CONTEXT` (dropped when
    // the budget binds). A member offered `refine {kind:"ALLOY"}` while working ground would have
    // been graded CONTEXT — droppable — for the recipe it is about to act on. That is *"refused for
    // a rule it was never given"* arriving through the budget instead of through the predicate, and
    // it is the failure `MAX_CONTRACT_CHARS` is only allowed to be 120,000 because of.
    //
    // So this builds, for every gated unit, the situation where BOTH its gate and its predicate hold
    // — and asserts `RULES`, and asserts it survives a cap two orders of magnitude below the real
    // ceiling. MUTATION: swap the loops below `required`/`wanted` and this goes red naming the unit.
    // ══════════════════════════════════════════════════════════════════════════
    const doc = document();
    // Every standing fact on at once. Not a reachable position — it is the analytic ceiling's facts
    // — and that is right here: the question is the ORDER of two checks, and the strongest predicate
    // state is the one that can shadow a gate.
    const everyFact: ContractSituation = { ...EVERY_SITUATION, verbs: new Set(), acts: new Set() };
    let checked = 0;
    for (const unit of CONTRACT_CATALOG) {
      if (unit.floor === true) continue;
      if (unit.wanted === undefined && unit.required === undefined) continue;
      for (const verb of unit.verbs) {
        checked += 1;
        const both: ContractSituation = { ...everyFact, verbs: new Set([verb]) };
        expect(
          unitGrade(unit, both),
          `${unitName(unit)} grades ${unitGrade(unit, both)} when '${verb}' is OFFERED and its own ` +
            'predicate also holds. An offered verb must outrank `wanted`, or the budget may drop a ' +
            'rule the member is about to act on',
        ).toBe('RULES');
        expect(
          excerptFor(doc, both, 4_000).dropped.map((o) => o.heading),
          `${unitName(unit)} was dropped under a 4,000 cap while '${verb}' was offered`,
        ).not.toContain(unitName(unit));
      }
      for (const act of unit.acts ?? []) {
        checked += 1;
        const both: ContractSituation = {
          ...everyFact,
          verbs: new Set([act.slice(0, act.indexOf('{'))]),
          acts: new Set([act]),
        };
        expect(
          unitGrade(unit, both),
          `${unitName(unit)} grades ${unitGrade(unit, both)} when '${act}' is OFFERED and its own ` +
            'predicate also holds. The act gate sits at the SAME precedence as the verb gate — above ' +
            'both predicates — or `acts` is a weaker guarantee than the thing it replaced',
        ).toBe('RULES');
        expect(
          excerptFor(doc, both, 4_000).dropped.map((o) => o.heading),
          `${unitName(unit)} was dropped under a 4,000 cap while '${act}' was offered`,
        ).not.toContain(unitName(unit));
      }
    }
    // Non-vacuous: there must really be units where a gate and a predicate compete.
    // ★ 42 at 24: the coalition block carries `acts: ['join{RAID}']` AND `wanted: nearStandoff`, so
    // it is one more unit where the two could compete — and the precedence matters here more than
    // usual, because a bystander standing at the stage is offered the act while one two lanes off is
    // only `nearStandoff`. Both must select it.
    expect(checked, 'no unit carries both a gate and a predicate, so this proves nothing').toBe(42);
  });

  it('★ EVERY UNIT IS REACHABLE BY SOMETHING — no unit is gated on nothing at all', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // The other half of the non-vacuity guard, and the one that survives a renumbering. A unit
    // with `floor` unset, both lists empty and neither predicate present is **dead prose**: it can
    // never be selected, and every test above passes because their loop bodies do not run. Moving
    // §11E off `build` emptied six `verbs` lists at once, so this is the shape the change itself
    // could most easily have left behind.
    //
    // Checked positively — each unit must reach at least CONTEXT for SOME situation — rather than
    // by inspecting the fields, so a unit gated on a predicate that can never be true fails too.
    // ══════════════════════════════════════════════════════════════════════════
    for (const unit of CONTRACT_CATALOG) {
      const reachable =
        unit.floor === true ||
        unit.verbs.some((verb) => unitGrade(unit, offering(verb)) === 'RULES') ||
        (unit.acts ?? []).some((act) => unitGrade(unit, offeringAct(act)) === 'RULES') ||
        CONTRACT_POSITIONS.some((p) => unitGrade(unit, p.situation) !== 'NO');
      expect(
        reachable,
        `${unitName(unit)} can never be selected by anything: no \`floor\`, no verb, no act, and no ` +
          'declared position satisfies its predicates. It is prose the cast can never be shown.',
      ).toBe(true);
    }
  });

  it('★ EVERY VERB THE ENGINE IMPLEMENTS NOW HAS READABLE RULES — none left unclaimed', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // This assertion used to allow nine exceptions. `post_bond` (§11B), `form`/`apply`/`admit`/
    // `approve` (§11C) and `yield`/`fight`/`join`/`demand` (§11D) had rules no cast member could
    // read, because those three sections did not fit as whole `##` sections and lived in
    // CONTRACT_NOT_EXCERPTED. Two test comments recorded it as costing "nothing"; the sign was
    // wrong, since the house cast reads only the excerpt.
    //
    // `###` granularity closed it: §11B ships as 1,983 characters to a member offered
    // `post_bond` rather than 8,491 to everybody. So the exception list is now EMPTY, and this
    // asserts that rather than describing it — a tenth unreadable verb is a mechanic shipping
    // with rules no player can read.
    //
    // Verbs come off the ENGINE, never a list retyped here (scar #1).
    // ══════════════════════════════════════════════════════════════════════════
    setSpeed('instant');
    const runtime = new Runtime({ seed: 'homes' });
    // ── A VERB MAY NOW BE CLAIMED THROUGH ITS ACTS, AND SEVEN ARE ─────────────
    //
    // `abandon` and `withdraw` are claimed by NO unit's `verbs` any more — both mean two things and
    // both are gated per act. So "has a home" is the union: the verb itself, or any act of it. What
    // this must NOT become is satisfied by one act of a two-act verb, and the ledger test below is
    // the half that checks that: `CONTRACT_MULTI_MEANING_VERBS` names every act the engine can
    // offer, and each has to resolve somewhere.
    const claimed = new Set([
      ...CONTRACT_CATALOG.flatMap((u) => [...u.verbs]),
      ...CONTRACT_CATALOG.flatMap((u) => [...(u.acts ?? [])].map((a) => a.slice(0, a.indexOf('{')))),
    ]);
    const unreadable = [...runtime.liveVerbs].filter((v) => !claimed.has(v));
    expect(
      unreadable,
      `these live verbs have no rules the cast can read: ${unreadable.join(', ')}. Claim each in ` +
        'CONTRACT_CATALOG against the `###` block that actually documents it.',
    ).toEqual([]);
    // And nothing may be parked in the not-excerpted list as a verb's only home.
    for (const outside of CONTRACT_NOT_EXCERPTED) {
      expect(outside.verbs, `${outside.heading} is outside the excerpt and claims verbs`).toEqual([]);
    }
  });

  it('★ EVERY DECLARED POSITION IS ENUMERATED, and the assertion names the position', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // 2^41 over the units is neither enumerable nor the right space: most combinations are
    // unreachable, and that is exactly what bit the `##` version — its worst "combination"
    // paired §11 with the whole of §11B, which no principal can be in.
    //
    // Selection is MONOTONE (an extra verb or fact never removes a unit), so the worst excerpt
    // over a set of wakes is the excerpt for the position that dominates them, and enumerating
    // the maximal positions is exact. The coverage half — that these positions really do
    // dominate what a live world produces — is the next test.
    // ══════════════════════════════════════════════════════════════════════════
    // No `* 0.95` fudge here any more. That was a second, undeclared budget sitting under the
    // declared one, and with the ceiling above the analytic maximum it started failing the
    // maximum for a number nothing names. There is one ceiling and one margin, and the margin
    // is asserted in the test below, against the position it actually protects.
    const doc = document();
    for (const position of CONTRACT_POSITIONS) {
      const excerpt = excerptFor(doc, position.situation);

      // ── TRUE FOR EVERY POSITION, BUDGETED OR NOT ──────────────────────────
      // Nothing FLOOR and nothing RULES is ever in `dropped`. That is the guarantee, and it is
      // checked on the positions that OVERSHOOT as well — those are exactly where a
      // length-driven drop would bite if the budget were allowed near the mandatory half.
      for (const omission of excerpt.dropped) {
        const unit = CONTRACT_CATALOG.find((u) => unitName(u) === omission.heading);
        expect(unit, omission.heading).toBeDefined();
        if (unit === undefined) continue;
        expect(
          unitGrade(unit, position.situation),
          `${position.name} dropped ${omission.heading}, which is not CONTEXT`,
        ).toBe('CONTEXT');
      }

      // ── NO EXCEPTIONS ANY MORE, AND THAT IS THE POINT OF THE RAISE ────────
      // Two of these used to overshoot a 38,000 bar — the fully-developed claimant at 43,789 on
      // every wake for ever. `overBudget` firing on the most advanced member in the world is a
      // detector that gets silenced before it ever catches a defect, which is the same failure
      // `/health` had when `deciding_share_bps` returned 503 for a structural condition. The
      // ceiling now sits above the analytic maximum, so an overshoot is ANOMALOUS and every
      // position — reachable or not — must come in under it.
      expect(
        excerpt.text.length,
        `${position.name} — ${String(excerpt.text.length)} of ${String(MAX_CONTRACT_CHARS)}. Make ` +
          'the newest block conditional on something this position does not have, or move it to ' +
          '`wanted`.',
      ).toBeLessThanOrEqual(MAX_CONTRACT_CHARS);
      expect(excerpt.overBudget, `${position.name} overran the ceiling`).toBe(false);
    }
  });

  it('★ THE CEILING CLEARS THE MAXIMUM, with the MARGIN measured where cry-wolf would bite', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // The margin IS the mechanism. `overBudget` is only a useful signal while the largest
    // excerpt a real member can be shown is comfortably under the ceiling — otherwise the alarm
    // fires on legitimate play, and the lesson recorded on the `/health` 503 fix applies: "a
    // signal that is red while nothing is broken stops being read, which is how scar #14b wins
    // twice — first by hiding a fallback, then by making the detector cry wolf until somebody
    // silences it."
    //
    // TWO DIFFERENT CHECKS, and conflating them is how a margin becomes decoration:
    //
    //   · the ANALYTIC maximum (every fact and verb at once) only has to FIT. Nothing is ever
    //     it — `graduate` and a held claim cannot coexist — so slack there buys nothing.
    //   · the REACHABLE maximum carries the margin, because that is the excerpt a real member
    //     is really shown, and the one whose overshoot would be the false alarm.
    //
    // Both measured rather than trusted, so growing `agent.md` into the slack fails here and is
    // then a decision somebody makes on purpose: raise the ceiling again (safe only while
    // RULES-never-drop holds), or make the new block conditional on something the maximum lacks.
    // ══════════════════════════════════════════════════════════════════════════
    const doc = document();

    // The ANALYTIC maximum, uncapped: what the catalog would emit if one member could somehow be
    // every situation at once. **61,693, which at 72,000 fits WHOLE** — it was 2,446 above the
    // 56,000 ceiling and got priced down to 55,996 by dropping CONTEXT. Either way it was tolerable,
    // precisely because nothing is ever it: `graduate` and a held claim cannot coexist, so this state
    // has no occupant, and what gave when it was priced was CONTEXT rather than a rule. Still pinned
    // rather than asserted under the ceiling, because that is what makes growth visible — and padding
    // the ceiling for a state that cannot exist is how a margin becomes decoration.
    //
    // **59,453 → 61,693: +2,240, and it is `deliver {payer}` being written down.** §5.2 escrows 70%
    // of every assessment and permits another principal's hand to carry it; the verb had implemented
    // that since the Levy landed and `agent.md` had never said so, which is why `paidOther` was 0 in
    // every world this repo ran. A mechanism no agent is told about is one no agent uses. The
    // prose went into `## 5`'s Levy block, which is FLOOR, so every position below grew by the same
    // +2,200 — that is what the ceiling was raised for and it is spent on purpose.
    //
    // **64,233 → 66,724: +2,491, and it is the EXPOSURE HIGH-WATER MARK being written down.**
    // `RULES_VERSION` 17 made two of §5.2's four allocation rules read the largest EXPOSURE a
    // principal carried at any tick of a Reckoning, instead of the instantaneous figure at
    // `LEVY_ASSESS_PHASE` — which is the tick after every stake in the world is released, a 22x
    // trough that left the three exposure-shaped rules flat on seven dockets in eight. +1,919 of it
    // is §4's `stake` block (RULES, so only members holding a role pay for it) and +572 is §5's Levy
    // block (FLOOR, so everybody does). The split is deliberate: the FLOOR half is one paragraph,
    // because the published default's *"allocated inversely to Exposure"* had to name **which**
    // Exposure or it names a quantity the engine no longer reads.
    //
    // ⚑ **THE ANALYTIC MARGIN IS NOW 662 OF 72,000, DOWN FROM 1,408 (778 at 19).** Read
    // `MAX_CONTRACT_CHARS`'s note before the next block, not after it. Two consecutive features each
    // spent about a quarter of the raise; this one spent 631 characters of what was left.
    //
    // ── ★ +631, AND IT IS D7's GOODS FLOOR BEING WRITTEN DOWN FOR THE FIRST TIME ──
    //
    // §11A's funding block explained the CURRENCY half of D7 and had never mentioned the goods half:
    // `ENDOWMENT_GOOD_FLOOR_QTY` withholds 50,000 `ration` **per venue** from sale, `agent.md` said
    // nothing about it, and forty lines up it actively told an agent *"you sell ore and rations"* —
    // which is false for the only rations a newcomer has. Measured on a swept world: **74% of
    // observations hold `ration` and can sell none of it.**
    //
    // The budget was checked before the words were written, not after, and it changed them twice:
    //
    //   · the first draft was 930 characters and would have left 479 of analytic margin. Rewritten to
    //     590 for the same four facts (the floor, the figure to read, per-venue, it never falls).
    //   · the §11A `because` string was widened to describe the new selector and put **+65 on all
    //     five positions** — including a newcomer's first wake, where the budget is tightest — for a
    //     clause that changes no decision. Reverted; the original sentence is still true under the
    //     wider predicate.
    //
    // The remaining +40 on every position is the inline correction to the false sentence, which is a
    // rules surface contradicting the engine and not optional.
    //
    // ⚑ **THE TWO ⚑ BLOCKS ABOVE ARE HISTORY AND THEIR NUMBERS ARE STALE — READ THE ASSERTIONS.**
    // Every figure in them is measured against `MAX_CONTRACT_CHARS` = **72,000**, which was raised
    // to 120,000 one commit before `RULES_VERSION` 23. So *"662 is not enough for a paragraph"* and
    // *"the reachable margin is 6,677"* were both true when written and are both wrong now: the live
    // figures are 44,566 analytic and 52,152 reachable, and they are on the `expect` lines below
    // rather than in prose. Kept rather than rewritten because the REASONING is the valuable part —
    // it is the record of two features that each had to be costed before they were written, and the
    // second draft that was 340 characters shorter for the same four facts. Do not quote the
    // numbers; do copy the method.
    //
    // ⚑ For the next author: 662 is not enough for a paragraph. The reachable margin is 6,677 and
    // quoting THAT number is the mistake this comment block already warns about two screens up.
    //
    // ── ★ +100 AT `RULES_VERSION` 20, AND IT IS THE SAME PARAGRAPH BEING CORRECTED ──
    //
    // 778 → **662 of analytic margin**, and the honest framing is that this is a *correction paying
    // for itself rather than a feature buying space*. The paragraph 19 bought for 631 characters
    // described the floor as **per venue** and as one that **NEVER FALLS**, and 20 makes both
    // clauses false: the floor is now what is LEFT of the allotment and it is charged once per
    // principal. The replacement states four facts where the old one stated four, and costs +116.
    //
    // Measured before the prose was written, as `MAX_CONTRACT_CHARS`'s note asks. Two things were
    // NOT done to pay for it, and both would have been cheaper:
    //
    //   · **Deleting the "delivering it unlocks nothing" clause** would have come in at −40, i.e.
    //     free. It is the expensive wrong belief on this side of D7 — the goods twin of "burn some
    //     to free the rest", which `ENDOWMENT_RULE` spends a whole clause on — and an agent acting
    //     on it pays a Levy it did not owe to unlock a sale that does not unlock.
    //   · **Leaving the per-venue sentence out entirely** was +0 and is what the first draft did.
    //     Rejected: the split-venue case was refused at BOTH venues under the old rule with nothing
    //     anywhere saying why, and a rule that has just stopped applying is exactly the one an agent
    //     needs told, because its prior is the old behaviour.
    //
    // ⚑ 678 is still not enough for a paragraph, and it is now not enough for a SENTENCE on every
    // position. The next block needs the ceiling looked at.
    const uncapped = excerptFor(doc, EVERY_SITUATION, 10_000_000);
    // ── ★ TWO FEATURES LANDED ON THIS NUMBER AND BOTH NOTES SURVIVE THE MERGE ──
    //
    // **22 · campaigns** added ~3,543 to EVERY position, because §11E's rules are gated on `build`
    // and `build` also raises a WORKS — so a Commons newcomer pays for a mechanic it cannot reach.
    // That is master's finding, it is recorded in the measured table below in campaigns' own words,
    // and it is being fixed properly with a kind-aware selector rather than by trimming a rule.
    //
    // **23 · the clearance** added 74 to every position (§12.1's DOSSIER log line) and 2,525 to the
    // two that are party to a grant (§10's `### CLEARANCE and the DOSSIER`). It is deliberately NOT
    // an instance of campaigns' defect and the contrast is the useful part: the unit is gated on
    // `grant`/`revoke`/`audit` plus `holdsGrant`, so a newcomer pays 74 characters for an
    // observation key it can read and **nothing** for the mechanic. The gate is doing exactly what
    // campaigns' `build` gate cannot.
    //
    // ── ★ RE-MEASURED, AND THE TWO DELTAS ADD EXACTLY — WHICH IS THE EVIDENCE ──
    //
    // Every number here was taken from the engine after the merge rather than summed, because the
    // selector trades CONTEXT for rules and two independent measurements need not compose. They do,
    // to the character, on all five positions:
    //
    //     baseline (f2bd06c)   39,489 · 47,877 · 48,750 · 65,323 · 72,909
    //     + campaigns (22)     +3,543  +3,543  +3,543  +3,543  +3,985
    //     + clearance (23)        +74     +74     +74  +2,525  +2,525
    //     = merged             43,106 · 51,494 · 52,367 · 71,391 · 79,419   ← measured, not added
    //
    // **That the sums hold is a fact about the budget, not a coincidence.** Exact composition means
    // the selector dropped no CONTEXT for either feature — i.e. nothing is being squeezed at
    // 120,000, so `overBudget` is still a signal rather than the normal state. The day these stop
    // adding is the day the bar is binding again, and that is the thing to watch for.
    //
    // ── ★ 24 · THE ACT GATE, AND IT COMPOSES TOO — IN THE OTHER DIRECTION ────
    //
    // The fix 22's note above asks for. It is the first row of this ledger to be NEGATIVE, and it
    // composes exactly the same way — the two Commons positions fall by 3,360, which is §11E's five
    // `build`-gated units to the character (315 + 636 + 858 + 471 + 1,070 = 3,350, plus five
    // 2-character separators), and no other declared position moves at all:
    //
    //     = merged (23)        43,106 · 51,494 · 52,367 · 71,391 · 79,419
    //     + act gate (24)      −3,360  −3,360       0       0       0
    //     = now                39,746 · 48,134 · 52,367 · 71,391 · 79,419   ← measured, not added
    //
    // A negative delta that composes proves the same thing a positive one does and one thing more:
    // **the excerpt did not lose a rule, it lost a READER.** The analytic ceiling is byte-identical
    // across the change, so every character §11E ever had is still in the catalog; what changed is
    // which principals are shown it. Had the ceiling fallen, the gate would have made some block
    // unreachable, which is the failure this whole file exists to prevent.
    //
    // ── ★ 24 · COALITIONS: +3,263, AND IT IS THE THIRD ROW TO COMPOSE EXACTLY ──
    //
    //     = merged (23) + act gate   39,746 · 48,134 · 52,367 · 52,809 · 71,391 · 62,436 · 72,900 · 79,419
    //     + coalitions (24)               0       0       0       0  +3,263       0  +3,263  +3,263
    //     = now                      39,746 · 48,134 · 52,367 · 52,809 · 74,654 · 62,436 · 76,163 · 82,682
    //
    // **+3,263 is `agent.md`'s whole delta**, so nothing was absorbed and nothing was trimmed — and
    // **five of the eight rows are byte-identical**, which is the act gate and `nearStandoff` doing
    // to §11D what 24's predecessor did to §11E. A section is not a cost in this budget; a *reader*
    // is.
    //
    // ── ★ 27 · CORRECTIONS: +3,202, AND IT COMPOSES EXACTLY TOO ──────────────
    //
    //     = coalitions (24)          39,746 · 48,134 · 52,367 · 52,809 · 74,654 · 62,436 · 76,163 · 82,682
    //     + corrections (27)         +1,809  +1,809  +1,895  +1,895  +3,202  +3,116  +3,202  +3,202
    //     = now                      41,555 · 49,943 · 54,262 · 54,704 · 77,856 · 65,552 · 79,365 · 85,884
    //
    // The fourth row to compose with nothing absorbed — and the first where **no row is
    // byte-identical**, which is the correct signature for this change rather than a regression:
    // every previous entry added a *block* and gated it, so most readers paid nothing. 27 added no
    // block at all. It corrected sentences inside blocks that every position already reads,
    // including a **false rule** stated twice (alloy as COMMONS-only, against the engine's
    // `ALLOY_IN_BY_TIER` gradient) and a **wrong count** in a FLOOR section (`build` as three acts,
    // against four). A correction cannot be gated away from the readers the wrong version reached.
    //
    // Analytic margin 120,000 − 85,884 = **34,116**. The reachable maximum is still `outside the
    // Commons and landless, at its fullest`, now 79,365 — leaving **40,635**, against a required
    // 4,000.
    // ── ★ 29 + 31 · THE RISK MARKET AND THE PARLEY, COMPOSED — AND THE PROOF
    //                  THAT `acts` GATING WORKS IS THAT THE FIRST FOUR ROWS DID NOT MOVE ────
    //
    //     = corrections (27)      41,555 · 49,943 · 54,371 · 54,813 · 77,965 · 65,552 · 79,474 · 85,993
    //     + the parley (31)         +857    +857    +857  +3,557  +3,557  +3,557  +3,557  +3,557
    //     + the risk market (29)      +0      +0      +0      +0  +3,826  +3,826  +3,826  +3,826
    //     = measured              42,412 · 50,800 · 55,228 · 58,370 · 85,348 · 72,935 · 86,857 · 93,376
    //
    // **The `+0` column is the finding, and it is the whole argument for `acts` gating.** Phase 3's
    // COVER rules cost a newcomer, a mid-game Commons member and a graduated member with no grant
    // *nothing at all* — none of them can be offered `sign{COVER}`, so none of them reads a word of
    // it. Under a `verbs: ['sign']` gate all eight positions would have paid, because `sign` is
    // offered to every creator of every venture. That is the `build` defect (+3,543 to a newcomer for
    // a mechanic it could not reach) not repeated, twice in one merge.
    //
    // The parley's +857 FLOOR half *is* paid by everybody, and correctly: it is two corrections to
    // rules the wrong version already reached, and A2 does not let a correction be gated away from
    // the readers who got the error.
    //
    // Both branches pinned this number before the other existed — 31 predicted 89,550, 29 predicted
    // 89,819 — and **both were wrong the moment they merged**, which is why this line is a reading
    // and not arithmetic on the previous reading.
    //
    // Analytic margin 120,000 − 93,376 = **26,624**. The reachable maximum is `outside the Commons
    // and landless, at its fullest` at 86,857 — leaving **33,143**, against a required 4,000.
    //
    // ── ★ 33 · §16.12 #1's THREE CLAUSES, ON TOP OF BOTH ────────────────────
    //
    //     = 29 + 31 (measured)    42,412 · 50,800 · 55,228 · 58,370 · 85,348 · 72,935 · 86,857 · 93,376
    //     + the LODE (§11A)       +1,615  +1,615  +1,615  +1,615  +1,615  +1,615  +1,615  +1,615
    //     + §11G STRAITS/SWAY         +0      +0  +2,891  +2,891  +2,891    −442  +2,891  +2,891
    //     = measured              44,027 · 52,415 · 59,734 · 62,876 · 89,854 · 74,108 · 91,363 · 97,882
    //
    // **The LODE row is +1,615 to EVERY position and that is correct rather than a gate failure.**
    // It lives in §11A's existing `### A place yields; you do not` block, gated on `build{WORKS}` and
    // `refine` — which a newcomer is offered on its first wake, because raising a WORKS is the first
    // thing it does. And it must be: `holding.graduation.ground[]` prices destinations a newcomer is
    // about to spend a one-way act on, and a rule that only reaches principals who have already
    // crossed is a rule delivered after the decision it governs. A2 does not let a correction be
    // gated away from the readers who need it, and this is the same clause as 31's +857 FLOOR half.
    //
    // **§11G's row is the `acts` gate working**: the two positions that cannot open a demand, join a
    // raid or stage a campaign pay **nothing** for the borders section, and the Commons row is
    // −442 — AGT-S2's `join{CAMPAIGN}` fix removing a token the engine can no longer produce.
    //
    // Third merge in a row where a branch's pin was wrong on landing: 29 predicted 89,819, 31
    // predicted 89,550, and §16.12 #1's own branch predicted 88,884 against a tree that had neither
    // of the other two in it. **This cell is a reading. It is never arithmetic on the last reading.**
    //
    // Analytic margin 120,000 − 97,882 = **22,118**. The reachable maximum is `outside the Commons
    // and landless, at its fullest` at 91,363 — leaving **28,637**, against a required 4,000.
    expect(uncapped.text.length, 'the analytic maximum, uncapped, for the record').toBe(104_647);
    // ── ★ AND AT 32, +2,384 MORE: DESTRUCTIBLE WORKS ────────────────────────
    //
    // §11A `### It can be DESTROYED` — one unit, and it lands on the five positions outside the
    // Commons and on none of the three inside it. **MEASURED against the merged catalog, not added to
    // the line above**, which is the rule the paragraph above earned: 93,376 + 2,384 happens to be
    // 95,760 here, and it would not have been if the new block had displaced anything. Reading it is
    // the only way to know which.
    //
    // Analytic margin 120,000 − 95,760 = **24,240**. The reachable maximum is `outside the Commons
    // and landless, at its fullest` at 89,241 — leaving **30,759**, against a required 4,000.
    // ── ★ AND AT 37, THE CROWDING TERM AND THE SEAL EXAMPLE ─────────────────
    //
    // Two rules-surface edits, both forced by a blind player being misled by text that was true:
    // §7's `share_per_tick` paragraph (the lode is the SMALLER term — crowding spreads a tier by
    // ~435% against the lode's ~15%), and §8's copyable `seal` example, which the document described
    // in prose and named `unit` for a field the engine reads as `measure`.
    //
    // Its own branch predicted 101,273 and that figure is NOT the one below. It was read against a
    // tree that had the strike-floor correction (`agent.md`'s per-good FLOOR, +251) missing, so both
    // parents were right about their own tree and neither about this one. **MEASURED against the
    // merged tree, not added to either parent's line.**
    //
    // 100,517 + 1,007 = 101,524 happens to be the reading here, and the +1,007 is the same on six of
    // the seven positions — but that is a *result*, not the derivation. The rule earned itself twice
    // more inside this one cell: the branch's own first reading was 101,272 and its second 101,273,
    // because reflowing one pinned sentence onto its own line added a newline. A cell that is
    // arithmetic on the last cell would have been wrong by one and nobody would have known which end.
    //
    // Analytic margin 120,000 − 101,524 = **18,476**. The reachable maximum is `outside the Commons
    // and landless, at its fullest` at 95,005 — leaving **24,995**, against a required 4,000.
    // ── ★ AND AT 40, +3,123: §12.1's ELEVENTH KEY, `risk` ───────────────────
    //
    // `agent.md` §6 gained the key's line (+460, FLOOR) and §11F gained the schedule, `at_stake`
    // and the four fields it had never named (+2,663, act-gated on the three COVER acts). The two
    // sum to the whole file's delta, so both land whole and nothing was displaced — which is the
    // only thing reading this cell can tell you that arithmetic cannot.
    //
    // Analytic margin 120,000 − 104,647 = **15,353**. The reachable maximum is `outside the Commons
    // and landless, at its fullest` at 98,128 — leaving **21,872**, against a required 4,000.
    expect(uncapped.text.length, 'the analytic maximum, uncapped, for the record').toBe(104_647);
    expect(uncapped.dropped, 'uncapped, nothing is squeezed at all').toEqual([]);

    // Priced at the real ceiling it comes in under, by dropping CONTEXT and nothing else. The
    // raise is only legitimate while that is true at ANY ceiling.
    const analytic = excerptFor(doc, EVERY_SITUATION);
    expect(analytic.overBudget, 'the analytic maximum still comes in under the ceiling').toBe(false);
    for (const omission of analytic.dropped) {
      const unit = CONTRACT_CATALOG.find((u) => unitName(u) === omission.heading);
      expect(unitGrade(unit as never, EVERY_SITUATION), omission.heading).toBe('CONTEXT');
    }

    const reachable = CONTRACT_POSITIONS.filter((p) => p.reachable).map((p) => ({
      name: p.name,
      chars: excerptFor(doc, p.situation).text.length,
    }));
    expect(reachable.length, 'there must be reachable positions to measure').toBeGreaterThan(0);
    const worst = reachable.reduce((a, b) => (b.chars > a.chars ? b : a));
    // 56,647 → 59,138 at `RULES_VERSION` 17 (the EXPOSURE high-water mark, in §4's `stake` block and
    // §5's Levy block) and again at 18 (the fourth good, in §7's production chain and §11A's own
    // block). Both features landed concurrently, so this row carries the sum of two independent
    // raises and neither author saw the other's — which is why the number is measured rather than
    // predicted, and why the margin below is the one to read.
    // +631 at 19: §11A's goods-floor paragraph, which is `wanted` on `trade` OR on a
    // withheld endowment, so a claimant in trouble reads it. The reachable margin is where cry-wolf
    // would bite and it is still healthy — 6,677 against a required 4,000 — which is the number to
    // quote about SAFETY and never the number to quote about ROOM.
    // +116 at 20: the same paragraph, corrected. The floor now falls and is charged per principal,
    // so the two clauses that said otherwise had to go — a rules surface describing the old
    // behaviour is scar #1, and this one is published to every agent in the world.
    // ── ★ THE ROW CHANGED IDENTITY, AND THE `acts` GATE DID NOT MOVE IT ─────
    //
    // The largest reachable position is no longer the claimant in trouble. It is `outside the Commons
    // and landless, at its fullest`, one of two rows added because the coverage test was a tautology:
    // it dominates everything the analytic ceiling does except a held claim, and it keeps `graduate`
    // and `form`, which the claimant cannot hold. So it is 1,509 characters larger than the claimant
    // — the crossing block, less §11B's required blocks.
    //
    // The `acts` gate did not move this number in either direction: both of these rows are offered
    // every campaign act, so §11E was and remains theirs. The reachable margin is
    // 120,000 − 70,375 = **49,625** against a required 4,000.
    // The largest reachable position is no longer the claimant in trouble. It is `outside the Commons
    // and landless, at its fullest`, one of two rows added because the coverage test was a tautology:
    // it dominates everything the analytic ceiling does except a held claim, and it keeps `graduate`
    // and `form`, which a claimant cannot hold — so it is 1,509 characters larger than the claimant,
    // the crossing block less §11B's required blocks.
    //
    // The act gate did not move this number in either direction: this row and the claimant are both
    // offered every campaign act, so §11E was and remains theirs.
    //
    // ★ +3,263 at 24, and this row is where the coalition's cost becomes REACHABLE rather than
    // theoretical: a landless member outside the Commons is exactly the principal §9's escort market
    // is for — it has hands, no ground to bill, and standoffs it can walk to. The reachable margin is
    // 120,000 − 76,163 = **43,837** against a required 4,000, which is the number to quote about
    // SAFETY and never the number to quote about ROOM.
    // ★ 86,857 at 29+31 — the two features composed. 31's PARLEY adds +3,557 there (§4's block plus
    // 857 of FLOOR) and 29's COVER rules another +3,826, because this row is the one position that
    // qualifies for both: it holds a grant, so the GRANT rung reaches its counterparty even with A8
    // keeping campaigns away from it, and it creates ventures, so it can be offered `sign{COVER}`.
    // ★ +2,384 at 32, and this row carries razing's whole reachable cost: a landless member outside
    // the Commons works ground somebody else may claim and can be routed at a stage it walked to. It
    // is exactly the principal §11A's destruction rules are written for.
    // Margin 120,000 − 89,241 = **30,759** against a required 4,000 — the number to quote about
    // SAFETY and never the number to quote about ROOM.
    // ★ At 37 this row pays for §7's crowding paragraph and §8's seal example, +1,007. Re-measured
    // on the merged tree rather than carried over: the branch read 94,754 against a tree missing the
    // strike-floor correction's +251. Margin 120,000 − 95,005 = **24,995** against a required 4,000
    // — the number to quote about SAFETY and never the number to quote about ROOM.
    // ★ RE-MEASURED at 40: +3,123 — §6's `risk` key line (+460, FLOOR) and §11F's schedule,
    // `at_stake` and four previously-unnamed fields (+2,663, act-gated). Read, not added.
    expect(worst.chars, 'the largest position a principal can occupy').toBe(98_128);
    expect(
      MAX_CONTRACT_CHARS - worst.chars,
      `the largest REACHABLE position (${worst.name}) is ${String(worst.chars)} against a ceiling ` +
        `of ${String(MAX_CONTRACT_CHARS)} — only ${String(MAX_CONTRACT_CHARS - worst.chars)} of ` +
        `slack, under the ${String(CONTRACT_CEILING_MARGIN)} needed to keep \`overBudget\` ` +
        'anomalous rather than a thing the best player in the world sets every wake',
    ).toBeGreaterThanOrEqual(CONTRACT_CEILING_MARGIN);
  });

  it('★ THE OVERSHOOT PATH STILL WORKS, and still loses only CONTEXT', () => {
    // The ceiling is now above anything the rules can produce, so no position exercises the
    // overshoot. That would leave the branch untested — a capability that exists and is never
    // exercised, which is the lesson this project keeps re-teaching. So it is driven directly
    // with an absurd cap, and what it must NOT do is lose a rule.
    const doc = document();
    const squeezed = excerptFor(doc, EVERY_SITUATION, 4_000);
    expect(squeezed.overBudget, 'a 4,000 cap must be reported as overrun').toBe(true);
    expect(squeezed.dropped.length, 'every discretionary block goes').toBeGreaterThan(0);
    for (const omission of squeezed.dropped) {
      const unit = CONTRACT_CATALOG.find((u) => unitName(u) === omission.heading);
      expect(unit?.floor, `${omission.heading} is FLOOR and was dropped`).not.toBe(true);
      if (unit === undefined) continue;
      expect(unitGrade(unit, EVERY_SITUATION), omission.heading).toBe('CONTEXT');
    }
  });

  it('★ CONTRACT_NOT_EXCERPTED STAYS AT THREE, and none of them is there because of size', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // A bigger budget must not quietly absorb these, and it must not tempt anyone to park a
    // section here for room again. All three are CAPABILITY reasons — you cannot enrol, you are
    // never offline, you cannot file a bug report from a plan — and a member that cannot act on
    // a rule should still not be charged for reading it.
    //
    // This list held §11B, §11C and §11D for a size reason, with the only rules for nine live
    // verbs in them. That is what "it does not fit" costs, and the test is here so the next
    // person has to argue capability rather than characters.
    // ══════════════════════════════════════════════════════════════════════════
    expect(CONTRACT_NOT_EXCERPTED.map((s) => s.heading)).toEqual([
      '## 2. Enrolling',
      '## 9. Being offline',
      '## 13. When something seems wrong',
    ]);
    for (const outside of CONTRACT_NOT_EXCERPTED) {
      expect(outside.verbs, `${outside.heading} is a verb's only home`).toEqual([]);
      expect(
        outside.because,
        `${outside.heading} is excluded for a SIZE reason — say why it cannot be used instead`,
      ).not.toMatch(/does not fit|too (?:big|long)|no room|budget/i);
      // And it really is outside: a section cannot be in both lists.
      expect(CONTRACT_SECTIONS, `${outside.heading} is in both lists`).not.toContain(outside.heading);
    }
  });

  it('★ A *REACHABLE* POSITION DOMINATES A REAL WORLD — swept, and no longer vacuous', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // The budget above is only as good as the position list. A list that has gone stale would
    // narrow what was checked and read green — the same shape as a predicate on a path
    // `observe` does not use. So a real world is driven and every observed situation must be
    // dominated by some declared position: its offered verbs a subset, its offered acts a subset,
    // its standing facts no stronger. A situation that escapes fails HERE, naming the member and
    // the fact, and the fix is to widen the position and re-check the budget.
    //
    // ── ★ THIS TEST WAS A TAUTOLOGY, AND THE ONE-WORD FIX IS `reachable` ──────
    //
    // It read `CONTRACT_POSITIONS.some(...)`, and `CONTRACT_POSITIONS` ends with the **analytic
    // ceiling** — every fact true, every verb offered. That row dominates *anything* by
    // construction, so the assertion could not fail for any world, any cast, any tick. It is the
    // shape CLAUDE.md calls out by name: an invariant whose subject cannot occur, sitting inside
    // the guard written to keep the position list honest.
    //
    // And the list HAD gone stale, completely. Filtered to reachable rows, **120 of 120 swept
    // observations escaped** — so the unreachable ceiling row was carrying 100% of the coverage, and
    // the four rows the budget is quoted by covered nothing the world actually produces. The fact
    // every escape carried is `endowmentWithheld`, true of nearly every member of every world this
    // repo has run (D7) and declared by no reachable row; also missing were a Commons member inside
    // a syndicate and a graduated landless member under raid.
    //
    // With the two rows added: **0 of 120**.
    //
    // Two positions were added rather than the five named rows widened, so the numbers those rows
    // are quoted by stay comparable. See `CONTRACT_POSITIONS`.
    // ══════════════════════════════════════════════════════════════════════════
    setSpeed('instant');
    const seed = 'dominates';
    const runtime = new Runtime({ seed });
    const cast = new HeuristicCast(runtime, { size: 6 });
    const members = cast.seat(seed);
    const doc = document();

    const dominates = (big: ContractSituation, small: ContractSituation): boolean => {
      for (const verb of small.verbs) if (!big.verbs.has(verb)) return false;
      // The act half. A position that carries `build` but not `build{CAMPAIGN}` no longer dominates
      // a member that was offered the campaign — which is the whole point of the gate, and it has
      // to be true of the coverage check too or the budget is measured against the wrong ceiling.
      for (const act of small.acts) if (!big.acts.has(act)) return false;
      const bits = [
        'inCommons', 'commonsBound', 'outsideCommons', 'inVenture', 'inCampaign', 'holdsGrant',
        'inSyndicate', 'holdsClaim', 'inArrears', 'anchorCold', 'underRaid', 'nearStandoff',
        'inBattle', 'holdsWorks', 'canBuildWorks', 'endowmentWithheld',
      ] as const;
      return bits.every((bit) => !small[bit] || big[bit]);
    };
    // Every bit of the situation is compared, so a new field cannot slip past the coverage check
    // the way `inBattle` and `endowmentWithheld` both did.
    const compared = new Set([
      'inCommons', 'commonsBound', 'outsideCommons', 'inVenture', 'inCampaign', 'holdsGrant',
      'inSyndicate', 'holdsClaim', 'inArrears', 'anchorCold', 'underRaid', 'nearStandoff',
      'inBattle', 'holdsWorks', 'canBuildWorks', 'endowmentWithheld',
    ]);
    for (const field of Object.keys(NO_SITUATION)) {
      if (field === 'verbs' || field === 'acts') continue;
      expect(compared, `${field} is not compared by \`dominates\`, so coverage ignores it`).toContain(field);
    }

    let worst = 0;
    for (let i = 0; i < 240; i += 1) {
      for (const action of cast.decide(runtime.engine.tick + 1, seed)) runtime.engine.submit(action);
      const report = runtime.runTick();
      expect(report.halted, `halted at ${String(report.tick)}`).toBe(false);
      if (i % 12 !== 0) continue;
      for (const member of members) {
        const observation = buildObservation({
          runtime,
          principal: member.principal,
          serverNowMs: 0,
          fresh: true,
          wakesRemaining: 16,
          stale: false,
          corrections: [],
          correctionsDropped: 0,
          actionsRemaining: 4,
        });
        const situation = readSituation(observation as unknown as Record<string, unknown>);
        const covered = CONTRACT_POSITIONS.filter((p) => p.reachable).some((p) =>
          dominates(p.situation, situation),
        );
        expect(
          covered,
          `no REACHABLE position dominates ${String(member.handle)} at tick ${String(runtime.engine.tick)}: ` +
            `verbs=[${[...situation.verbs].join(',')}] acts=[${[...situation.acts].join(',')}] ` +
            `claim=${String(situation.holdsClaim)} raid=${String(situation.underRaid)} ` +
            `syndicate=${String(situation.inSyndicate)} endowment=${String(situation.endowmentWithheld)}`,
        ).toBe(true);
        const excerpt = excerptFor(doc, situation);
        expect(excerpt.overBudget).toBe(false);
        expect(excerpt.dropped, 'a real wake should not be squeezing out CONTEXT').toEqual([]);
        worst = Math.max(worst, excerpt.text.length);
      }
    }
    expect(worst, 'the sweep must actually have built excerpts').toBeGreaterThan(20_000);
    // ── THE `* 0.95` FUDGE IS GONE, AND §11B'S SPLIT IS WHY ───────────────────
    //
    // Two concurrent branches met here. The territorial work raised this to `* 0.98` with a measured
    // worst case of **38,725** (`sable` at tick 36) and a note to restore 0.95 "once §11B is split" —
    // because the day the cast could take ground was the day a claimant was offered `post_bond`, which
    // selected §11B **for the first time in a real wake in this project's life**. Until then
    // `claimLines` was 0, so the largest declared position had never once occurred.
    //
    // §11B is now split. At `###` granularity a member offered `post_bond` gets §11B's preamble plus
    // one block — **1,983 characters, not ~8,500** — so the condition that note set has been met, and
    // met better than by restoring a fraction: the fudge is replaced by a DECLARED constant measured
    // against the REACHABLE maximum. A second, undeclared budget sitting under the declared one is the
    // thing that made 38,725 surprising in the first place.
    //
    // Kept as the ceiling-minus-margin form deliberately. `MAX_CONTRACT_CHARS * 0.98` moves silently
    // whenever the ceiling moves; `MAX_CONTRACT_CHARS - CONTRACT_CEILING_MARGIN` does not.
    expect(worst, 'a real wake must sit inside the declared margin').toBeLessThanOrEqual(
      MAX_CONTRACT_CHARS - CONTRACT_CEILING_MARGIN,
    );
  });

  it('★ THE TWO EXCLUSIONS THE NUMBERS REST ON ARE ENGINE-ENFORCED, not assumed', () => {
    // The `##` version's arithmetic was wrong because it ASSUMED §11 and §11B were mutually
    // exclusive, and they are not — a MARCHES member is offered `graduate` too. What IS true,
    // and is enforced in `observe.ts` by `crossing.anchoring.length === 0`, is that a principal
    // whose body anchors a claim is never offered the crossing. `CONTRACT_POSITIONS` depends on
    // it, so it is asserted rather than believed.
    setSpeed('instant');
    const runtime = new Runtime({ seed: 'exclusions' });
    const cast = new HeuristicCast(runtime, { size: 4 });
    const members = cast.seat('exclusions');
    for (let i = 0; i < 60; i += 1) {
      for (const a of cast.decide(runtime.engine.tick + 1, 'exclusions')) runtime.engine.submit(a);
      runtime.runTick();
      for (const member of members) {
        const situation = readSituation(
          buildObservation({
            runtime,
            principal: member.principal,
            serverNowMs: 0,
            fresh: true,
            wakesRemaining: 16,
            stale: false,
            corrections: [],
            correctionsDropped: 0,
            actionsRemaining: 4,
          }) as unknown as Record<string, unknown>,
        );
        if (situation.holdsClaim) {
          expect(
            situation.verbs.has('graduate'),
            'a claim anchors the body, so the crossing must be withheld (INV-8)',
          ).toBe(false);
        }
        if (situation.inCommons) {
          // A8: hostile action in the Commons is INVALID, not merely rare.
          expect(situation.underRaid, 'nothing may stand against a Commons holding').toBe(false);
        }
        expect(
          situation.inCommons && situation.outsideCommons,
          'a holding is in one tier',
        ).toBe(false);
      }
    }
  });

  it('a `###` block never ships without its section’s preamble, which carries the heading', () => {
    // The heading lives in the preamble. A block emitted without it is prose with no name on
    // it, and a member cannot tell which section a rule belongs to — nearer scar #1 than
    // omitting the block. Structural in `excerptFor`, not a predicate, so it cannot be forgotten.
    const doc = document();
    for (const unit of CONTRACT_CATALOG) {
      if (unit.block === null) continue;
      for (const verb of unit.verbs.length > 0 ? unit.verbs : ['__none__']) {
        const excerpt = excerptFor(doc, offering(verb));
        if (!excerpt.units.includes(unitName(unit))) continue;
        expect(
          excerpt.units,
          `${unitName(unit)} shipped without ${unit.section}'s preamble`,
        ).toContain(unit.section);
        expect(excerpt.text, 'and the `##` heading itself must be in the text').toContain(unit.section);
      }
    }
  });

  it('keeps a section’s units CONTIGUOUS and in document order', () => {
    // A `### Paying for it — the CHARGE` emitted three sections away from `## 11B.` is a rule
    // with its framing removed.
    const doc = document();
    for (const position of CONTRACT_POSITIONS) {
      const excerpt = excerptFor(doc, position.situation);
      const sectionOf = (name: string): string => name.split(' › ')[0] ?? name;
      const runs: string[] = [];
      for (const name of excerpt.units) {
        const section = sectionOf(name);
        if (runs[runs.length - 1] !== section) runs.push(section);
      }
      expect(new Set(runs).size, `${position.name}: a section appears in two runs`).toBe(runs.length);
      // And within each section, document order.
      for (const section of excerpt.sections) {
        const wanted = CONTRACT_CATALOG.filter(
          (u) => u.section === section && excerpt.units.includes(unitName(u)),
        ).map(unitName);
        const got = excerpt.units.filter((n) => sectionOf(n) === section);
        expect(got, `${position.name}: ${section} is out of document order`).toEqual(wanted);
      }
    }
  });

  it('★ A PARTIAL SECTION SAYS WHICH BLOCKS ARE MISSING, or it looks complete and is not', () => {
    // The one real hazard of `###` granularity. `## 11B.` with two of its five blocks reads as
    // a complete section, and that is worse than omitting §11B outright — unless the excerpt
    // names the three that are absent and why. It does, unit by unit.
    const doc = document();
    setSpeed('instant');
    const runtime = new Runtime({ seed: 'partial' });
    const cast = new HeuristicCast(runtime, { size: 1 });
    const members = cast.seat('partial');
    const character = charactersFor(members, 'partial').values().next().value;
    if (character === undefined) throw new Error('no character');

    // Offered `post_bond`, holds no claim: §11B ships two of five blocks.
    const contract = excerptFor(doc, offering('post_bond'));
    expect(contract.sections).toContain('## 11B. Sovereignty — territory you have to MAINTAIN');
    expect(contract.units).toContain(
      '## 11B. Sovereignty — territory you have to MAINTAIN › ### Taking one — `post_bond` then `build`',
    );
    expect(contract.units).not.toContain(
      '## 11B. Sovereignty — territory you have to MAINTAIN › ### Paying for it — the CHARGE',
    );

    const text = buildPrompt({
      contract,
      character,
      observation: anObservation(),
      memory: 'nothing',
      liveVerbs: ['post_bond'],
      planMax: 1,
    })
      .messages.map((m) => m.content)
      .join('\n');

    // The notice is grouped by section — shorter than the flat form, and it says the thing the
    // flat form only implied: whether a section is absent entirely or PRESENT WITH BLOCKS GONE.
    // That distinction is the whole hazard of `###` granularity, so it is asserted directly.
    expect(text).toContain('NOT IN THIS EXCERPT');
    expect(text).toContain('GET /compact/api/agent.md');
    expect(text, '§11B ships partial here, and the member has to be told so').toMatch(
      /## 11B\. Sovereignty[^\n]*is here WITHOUT 3 of its blocks/,
    );
    // Every absence is named, at the granularity that carries information: a section that is
    // gone ENTIRELY is named once with its reason, and listing its five blocks under it would be
    // noise; a section that ships PARTIAL names each missing block, because that is the case a
    // reader cannot otherwise detect.
    for (const omission of contract.notThisWake) {
      const [section = omission.heading, block] = omission.heading.split(' › ');
      expect(text, `${section} is absent and unnamed`).toContain(section);
      if (block !== undefined && contract.sections.includes(section)) {
        expect(text, `${section} is partial and ${block} is unnamed`).toContain(block);
        expect(text, `${omission.heading} is absent with no reason`).toContain(omission.because);
      }
    }
    // A partial section's own reason line must not claim the whole section is absent.
    for (const section of contract.sections) {
      expect(text).not.toContain(`${section} — you hold`);
    }
  });

  it('the FLOOR is in every excerpt, and is the identical prefix two members share', () => {
    const doc = document();
    const floors = CONTRACT_CATALOG.filter((u) => u.floor === true).map(unitName);
    for (const situation of [NO_SITUATION, ...CONTRACT_POSITIONS.map((p) => p.situation)]) {
      const excerpt = excerptFor(doc, situation);
      for (const name of floors) expect(excerpt.units).toContain(name);
    }
    // FLOOR-only sections come first, so the front of the message is byte-identical whatever
    // the situation. Weaker than at `##` granularity (11,527 rather than 20,976) because §8 and
    // §11A now have variable tails — the price of the granularity, paid knowingly.
    const a = excerptFor(doc, CONTRACT_POSITIONS[0]?.situation ?? NO_SITUATION).text;
    const b = excerptFor(doc, CONTRACT_POSITIONS[3]?.situation ?? NO_SITUATION).text;
    let shared = 0;
    while (shared < a.length && shared < b.length && a[shared] === b[shared]) shared += 1;
    expect(shared, 'the shared prefix must be the whole FLOOR-only run').toBeGreaterThan(11_000);
  });

  it('is DETERMINISTIC — the same observation cuts the same excerpt, byte for byte', () => {
    // It runs inside the tick. DET-7 bans `Date.now`; nothing here may vary between two calls.
    const doc = document();
    const observation = anObservation();
    const first = excerptFor(doc, readSituation(observation as unknown as Record<string, unknown>));
    const second = excerptFor(doc, readSituation(observation as unknown as Record<string, unknown>));
    expect(second.text).toBe(first.text);
    expect(second.units).toEqual(first.units);
    expect(second.notThisWake).toEqual(first.notThisWake);
    expect(second.dropped).toEqual(first.dropped);
  });

  it('★ EVERY FIELD OF THE SITUATION FLIPS WHEN ITS REAL PATH CHANGES, and only then', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // **THE FIRST VERSION OF THIS TEST WAS VACUOUS AND A MUTATION PROVED IT.**
    //
    // The defect class is the one this change kept turning up: `situationalFocus` read a
    // top-level `syndicates` key that `observe` nests under `grants`, so its §11C line never
    // fired once in production, and its test passed because the FIXTURE matched the code instead
    // of the engine. Twelve predicates is twelve chances to do it again.
    //
    // So I wrote `expect(situation.anchorCold).toBe(rows.some((r) => r['anchor_hot'] === false))`
    // against a REAL observation — and changing the code to read `claim['anchorHot']` still broke
    // nothing, because a fresh claim has a hot anchor and no arrears, so **both sides of the
    // assertion were `false`**. An equality between two expressions that are both false in the
    // only state the test can reach proves precisely nothing. Same for `inVenture`, `holdsGrant`,
    // `inSyndicate`, `underRaid`, `holdsWorks` and `outsideCommons` — every field whose real
    // value at tick 1 is `false`.
    //
    // The fix is to take the shape from the engine and the DISCRIMINATION from a flip: mutate the
    // exact path `observe` publishes, and require the field to change. A predicate reading any
    // other key cannot pass, because flipping the real key would leave it unmoved.
    // ══════════════════════════════════════════════════════════════════════════
    const observation = anObservation();
    const base = readSituation(observation as unknown as Record<string, unknown>);
    const holding = observation.holding as Record<string, unknown>;
    const grants = observation.grants as Record<string, unknown>;
    const obligations = observation.obligations as Record<string, unknown>;
    const ventures = observation.ventures as Record<string, unknown>;
    const works = holding['works'] as Record<string, unknown>;
    const market = observation.market as Record<string, unknown>;

    expect(base.verbs.size, 'a seated member is offered something').toBeGreaterThan(0);
    for (const affordance of observation.affordances) expect(base.verbs).toContain(affordance.verb);

    // The nesting that was got wrong once, pinned against the engine.
    expect(Object.keys(observation), '`syndicates` is NOT a top-level key').not.toContain('syndicates');
    expect(Object.keys(grants), '`observe` nests it under the authority block').toContain('syndicates');
    // And `holding.sovereignty` is NOT the claim indicator: its last branch returns "how to take
    // one" to a graduated principal holding nothing. `obligations.charge` is `myClaims`.
    expect(Object.keys(obligations)).toContain('charge');

    /** Rebuild the observation with one real path changed, and read the situation off that. */
    const flipped = (patch: Record<string, unknown>): ContractSituation =>
      readSituation({ ...(observation as unknown as Record<string, unknown>), ...patch });

    const claimRow = { arrears: 0, anchor_hot: true, owed: 4_000 };
    const cases: readonly {
      readonly field: keyof ContractSituation;
      readonly to: boolean;
      readonly patch: Record<string, unknown>;
    }[] = [
      { field: 'inCommons', to: false, patch: { holding: { ...holding, tier: 'MARCHES' } } },
      { field: 'outsideCommons', to: true, patch: { holding: { ...holding, tier: 'MARCHES' } } },
      { field: 'commonsBound', to: false, patch: { holding: { ...holding, commons_bound: false } } },
      { field: 'inVenture', to: true, patch: { ventures: { ...ventures, mine: [{ venture: 'v1' }] } } },
      // `inCampaign` is `your_side`, never the row's existence — see the assertion below the loop,
      // which is the half a flip cannot express.
      {
        field: 'inCampaign',
        to: true,
        patch: { holding: { ...holding, campaigns: [{ campaign: 'campaign:5:0', your_side: 'DEFENDER' }] } },
      },
      { field: 'holdsGrant', to: true, patch: { grants: { ...grants, granted: [{ id: 'g1' }] } } },
      { field: 'holdsGrant', to: true, patch: { grants: { ...grants, held: [{ id: 'g2' }] } } },
      { field: 'inSyndicate', to: true, patch: { grants: { ...grants, syndicates: [{ id: 'syn:a:1' }] } } },
      { field: 'holdsClaim', to: true, patch: { obligations: { ...obligations, charge: [claimRow] } } },
      {
        field: 'inArrears',
        to: true,
        patch: { obligations: { ...obligations, charge: [{ ...claimRow, arrears: 5_000 }] } },
      },
      {
        field: 'anchorCold',
        to: true,
        patch: { obligations: { ...obligations, charge: [{ ...claimRow, anchor_hot: false }] } },
      },
      // ── ★ `your_side` IS PART OF THE PATH NOW, AND THE FIXTURE HAD TO SAY SO ──
      //
      // This patch was `raid: [{ raid: 'r1' }]` and it **failed the moment `underRaid` became a party
      // test** — correctly, and by name: *"underRaid did not move when the path `observe` publishes for
      // it changed."* At `RULES_VERSION` 24 `obligations.raid[]` carries standoffs a hand could WALK
      // to as well as the ones aimed at you, so the row's existence stopped meaning "you are the
      // target" and `your_side` is what does. A bare row is now the OTHER case, below.
      {
        field: 'underRaid',
        to: true,
        patch: { obligations: { ...obligations, raid: [{ raid: 'r1', your_side: 'TARGET' }] } },
      },
      // ★ The bystander half, and it is the same list with a different `your_side`. This is §9's
      // escort market: `raidViewsFor` only returns a non-party row the reader could actually reach.
      {
        field: 'nearStandoff',
        to: true,
        patch: { obligations: { ...obligations, raid: [{ raid: 'r1', your_side: null }] } },
      },
      // §9A. `obligations.battle`, adjacent to `raid` and NOT folded into it: the two carry
      // different deadlines, and MUSTER is 6 ticks of the raid's 24.
      { field: 'inBattle', to: true, patch: { obligations: { ...obligations, battle: [{ raid: 'r1' }] } } },
      { field: 'holdsWorks', to: true, patch: { holding: { ...holding, works: { ...works, held: [{}] } } } },
      {
        field: 'canBuildWorks',
        to: false,
        patch: { holding: { ...holding, works: { ...works, here: { affordable: false } } } },
      },
      // ── ★ `endowmentWithheld`, AND IT NEEDS TWO CASES BECAUSE IT READS TWO PATHS ──
      //
      // The state a probe read on the live shard as `market.transferable_minor: 0` beside 200,000
      // currency. It is a conjunction, so ONE flip case would leave half the predicate unverified
      // — a version reading `market.balance_minor` (which does not exist) instead of
      // `market.endowment.balance_minor` would pass the transferable case and be false for every
      // member for ever, which is exactly the `anchorCold`/`claim['anchorHot']` failure this whole
      // block was rewritten for.
      { field: 'endowmentWithheld', to: false, patch: { market: { ...market, transferable_minor: 5_000 } } },
      {
        field: 'endowmentWithheld',
        to: false,
        patch: {
          market: {
            ...market,
            endowment: { ...(market['endowment'] as Record<string, unknown>), balance_minor: 0 },
          },
        },
      },
    ];

    for (const { field, to, patch } of cases) {
      // The flip must be a real change, or the case proves nothing — the exact trap above.
      expect(base[field], `${String(field)} already reads ${String(to)}; this case is vacuous`).toBe(!to);
      expect(
        flipped(patch)[field],
        `${String(field)} did not move when the path \`observe\` publishes for it changed — it is ` +
          'reading somewhere else, and it will read false for every member for ever',
      ).toBe(to);
    }

    // ── ★ `inCampaign` READS `your_side`, NOT THE ROW'S EXISTENCE ─────────────
    //
    // `holding.campaigns[]` is §12.1's siege-clock slot and it carries **every LIVE campaign in the
    // galaxy**, not just this principal's — `campaignViewsFor` filters on `isLiveCampaign(…) ||
    // attacker === me || defender === me`. So `length > 0` would make every principal a party to
    // every war, which is the `holding.sovereignty !== null` mistake `situationalFocus` was caught
    // making one function down: a condition that reads plausibly and asserts something FALSE about
    // the reader's own position, on a surface A5′ says must never be wrong.
    //
    // A flip case cannot express this (both readings of an empty list are `false`), so it is asserted
    // directly — a row present, a side of `null`, and the field must stay down.
    expect(
      readSituation({
        ...(observation as unknown as Record<string, unknown>),
        holding: { ...holding, campaigns: [{ campaign: 'campaign:5:0', your_side: null }] },
      }).inCampaign,
      'a campaign this principal can SEE but is not party to must not make it a party',
    ).toBe(false);

    // Every field is covered. A new field with no case is a new unchecked path.
    const covered = new Set(cases.map((c) => String(c.field)));
    for (const field of Object.keys(base)) {
      if (field === 'verbs' || field === 'acts') continue;
      expect(covered, `${field} has no flip case, so its path is unverified`).toContain(field);
    }

    // ── AND `acts`, WHICH IS A SET AND SO NEEDS ITS OWN CASE ──────────────────
    //
    // The one path `readSituation` gained. It comes off `affordances[]` — the same rows `verbs`
    // does, in one pass — so a member cannot hold an act without its verb, and the assertion is
    // that a real affordance's `kind` reaches the set.
    expect(base.verbs.has('build'), 'the seated member is offered a build').toBe(true);
    expect(
      base.acts.has('build{WORKS}'),
      '`build {kind:"WORKS"}` is in `affordances[]` and must be readable as an ACT, or §11A’s WORKS ' +
        'block is gated on something no observation produces',
    ).toBe(true);
    expect(
      flipped({ affordances: [{ verb: 'build', params: { kind: 'CAMPAIGN', system: 'sys-09' } }] }).acts,
    ).toEqual(new Set(['build{CAMPAIGN}']));

    // ── AN ABSENT KEY IS "NO", NEVER AN ASSERTION ─────────────────────────────
    // `readSituation` is handed partial observations (`relations.spec.ts` builds a two-key stub),
    // and every field must read `false` from nothing. This is not decoration: writing
    // `outsideCommons: tier !== 'COMMONS'` — which is equivalent to the real code on every REAL
    // observation, and passed every case above — makes an observation with no `holding` read as
    // *predation can reach you*, which ships §11D to a stub and states a fact that is not true.
    // Caught only here, by mutation.
    const nothing = readSituation({});
    for (const [field, value] of Object.entries(nothing)) {
      if (field === 'verbs' || field === 'acts') continue;
      expect(value, `${field} read something out of an empty observation`).toBe(false);
    }
    expect(nothing.verbs.size).toBe(0);
    expect(nothing.acts.size, 'no affordances means no acts, never a guessed one').toBe(0);
  });

  it('★ THE CLAIM FIELDS ARE READ OFF A REAL CLAIM ROW, not off a world that has none', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // **THIS TEST EXISTS BECAUSE A MUTATION FOUND NOTHING.**
    //
    // Changing `anchorCold` to read `claim['anchorHot']` instead of `claim['anchor_hot']` broke
    // no test at all. The predicate would have read `false` for every claimant for ever, so
    // §11B's fuel block — the ONE rule in this game whose failure is otherwise silent, because a
    // cold anchor takes no arrears, lapses nothing and slashes no bond — would never have been
    // selected for the members it exists for.
    //
    // The check for it was already in the test above, and it was **vacuous**: it guarded on
    // `if (claimKeys.size > 0)`, and the heuristic world never takes a claim, so the branch never
    // ran. That is CLAUDE.md's "an invariant whose subject cannot occur" one level in — and it is
    // the same shape as the adopted-boot reporting a confidently wrong divergence tick with a
    // test that agreed with it.
    //
    // So this drives a world into actually holding a claim — `graduate`, `post_bond`, `build`
    // ANCHOR, submitted straight into the engine — and reads the row `observe` really publishes.
    // ══════════════════════════════════════════════════════════════════════════
    setSpeed('instant');
    const runtime = new Runtime({ seed: 'claimant' });
    const cast = new HeuristicCast(runtime, { size: 3 });
    const members = cast.seat('claimant');
    const me = members[0];
    if (me === undefined) throw new Error('no member');

    const observeMe = (): Observation =>
      buildObservation({
        runtime,
        principal: me.principal,
        serverNowMs: 0,
        fresh: true,
        wakesRemaining: 16,
        stale: false,
        corrections: [],
        correctionsDropped: 0,
        actionsRemaining: 4,
      });
    /** Take the affordance the engine is offering, so the path is the real one. */
    const take = (verb: string, kind?: string): boolean => {
      const offered = observeMe().affordances.find(
        (a) => a.verb === verb && (kind === undefined || a.params['kind'] === kind),
      );
      if (offered === undefined) return false;
      runtime.engine.submit({
        principal: me.principal,
        verb,
        params: offered.params,
        clientSequence: 1,
        arrivalMs: 0,
        decisionSource: 'HEURISTIC',
      });
      const report = runtime.runTick();
      expect(report.halted, `halted taking ${verb}`).toBe(false);
      return true;
    };

    expect(take('graduate'), '`graduate` must be offered to a funded newcomer').toBe(true);
    expect(take('post_bond'), '`post_bond` must be offered once out of the Commons').toBe(true);
    // An anchor's manufactured half, supplied rather than hauled: this test is about which RULES a
    // real claimant can read, not about the supply chain that gets it there. See `alloy-fixture.ts`
    // for why that is honest and where the road itself is actually walked.
    giveAlloy(runtime, me.principal, holdingOf(runtime.world, me.principal).system);
    expect(take('build', 'ANCHOR'), '`build` ANCHOR must be offered with a bond posted').toBe(true);

    const observation = observeMe();
    const rows = (observation.obligations as Record<string, unknown>)['charge'] as Record<
      string,
      unknown
    >[];
    expect(rows.length, 'the whole point of this test is a REAL claim row').toBeGreaterThan(0);
    const row = rows[0];
    if (row === undefined) throw new Error('no claim row');

    // The two field names the predicates depend on, asserted against the row the engine built.
    expect(Object.keys(row), 'inArrears reads `arrears`').toContain('arrears');
    expect(Object.keys(row), 'anchorCold reads `anchor_hot`').toContain('anchor_hot');

    const situation = readSituation(observation as unknown as Record<string, unknown>);
    expect(situation.holdsClaim, 'a claim was taken and holdsClaim says so').toBe(true);
    // NOT `expect(situation.inArrears).toBe(rows.some(...))` — a fresh claim has no arrears and a
    // hot anchor, so both sides are `false` and the equality proves nothing. That version passed a
    // mutation that read `claim['anchorHot']`. The discriminating half is the flip test above;
    // this test's job is the ROW SHAPE, which only a real claim can supply.
    expect(situation.inArrears, 'a claim taken this tick is not yet in arrears').toBe(false);

    // ── AND THE PAYOFF: THE CLAIMANT CAN READ THE RULES IT IS BILLED UNDER ──
    // A5′. Before `###` granularity this was impossible for anybody: §11B was 8,491 characters
    // and lived in CONTRACT_NOT_EXCERPTED, so `post_bond` was a verb with no readable rules.
    const excerpt = excerptFor(document(), situation);
    expect(excerpt.sections).toContain('## 11B. Sovereignty — territory you have to MAINTAIN');
    expect(excerpt.text, 'the Charge rules reach the member the Charge bills').toContain(
      '### Paying for it — the CHARGE',
    );
    expect(excerpt.dropped.map((o) => o.heading)).not.toContain(
      '## 11B. Sovereignty — territory you have to MAINTAIN › ### Paying for it — the CHARGE',
    );
    // And the engine-enforced exclusion the position arithmetic rests on, on a REAL claimant.
    expect(
      situation.verbs.has('graduate'),
      'a claim anchors the body, so the crossing must be withheld (INV-8)',
    ).toBe(false);
  });

  it('the unit count in the prose matches the catalog — it has drifted twice already', () => {
    // Two of these numbers have gone stale inside one night: 28 → 41 when the catalog was written,
    // 41 → 44 when §9A landed. Prose counts in a rules-surface file are claims, and the lesson from
    // `build` is TWO → THREE acts is that a claim which quietly stops being true is scar #1's
    // shape. So the count is asserted rather than trusted. It churns when the catalog changes,
    // which is the point: somebody looks.
    const source = readFileSync(new URL('../../src/cast/prompt.ts', import.meta.url), 'utf8');
    const spelled = {
      28: 'twenty-eight',
      41: 'forty-one',
      44: 'forty-four',
      45: 'forty-five',
      46: 'forty-six',
      47: 'forty-seven',
      53: 'fifty-three',
      // ★ 54 after the merge: campaigns' six §11E units and the clearance's one §10 unit both
      // landed. `CONTRACT_CATALOG.length` is the only authority here — this map exists so the
      // PROSE in prompt.ts cannot drift from it, and both features moved the prose.
      54: 'fifty-four',
      // ★ 55 at 24: §11D's coalition block. One unit for 3,263 characters of `agent.md`, and the
      // section had shipped with NO unit at all — the orphan-heading guard above caught it on the
      // merge, before any reviewer did.
      55: 'fifty-five',
      // ★ 56 at 31 (§4's PARLEY block, one unit, act-gated on `message{TO}`) and 60 once Phase 3's
      // four COVER units landed in the same merge. Both branches wrote their own number into the
      // prose and neither was right afterwards, which is what this map exists to catch.
      60: 'sixty',
      // ★ 61 at 32: §11A's `### It can be DESTROYED`. One unit, `wanted`-gated rather than act-gated —
      // no verb identifies "has production to lose", and the counterplay verbs (`fight`, `join`) are
      // only offered once a standoff is already live, by which point a member reading the rules for
      // the first time inside a 24-tick window has already chosen wrong.
      64: 'sixty-four',
    };
    const n = CONTRACT_CATALOG.length;
    expect(n, 'if this moved, update the three prose counts in prompt.ts too').toBe(64);
    expect(source, `the prose says a different number than ${String(n)}`).toContain(
      spelled[n as 64],
    );
    // ── ★ MATCHED ON A WORD BOUNDARY, NOT AS A SUBSTRING ─────────────────────
    //
    // `not.toContain` was the check until the count reached **sixty-one**, at which point the guard
    // failed on `spelled[60]` — because "sixty-one" contains "sixty". A stale-number guard that goes
    // red on the correct number is worse than no guard: the obvious way out is to delete the row it
    // trips on, which is exactly the row that catches the next drift.
    //
    // So the compound numbers are matched with a trailing boundary. `sixty-one` no longer counts as an
    // occurrence of `sixty`, and `sixty` still counts as one wherever it really appears.
    for (const [count, word] of Object.entries(spelled)) {
      if (Number(count) === n || Number(count) === n + 1) continue;
      const stale = new RegExp(`${word}(?![a-z-])`);
      expect(
        stale.test(source),
        `prompt.ts still says "${word}" and there are ${String(n)} units`,
      ).toBe(false);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // ★ **AND THE SAME GUARD FOR `CONTRACT_ACTS`, BECAUSE IT HAD ALREADY DRIFTED.**
    //
    // Found at 33: the docblock said *"Twelve tokens"* over a set of **sixteen**. It had been wrong
    // since the risk market's three COVER tokens and the parley's `message{TO}` landed — through a
    // merge, a review and a full suite — because the mechanism above covers `CONTRACT_CATALOG` and
    // nothing covered this. A prose count in a rules-surface file is a claim, and this one is the
    // audit's own summary of itself.
    // ══════════════════════════════════════════════════════════════════════════
    const acts = CONTRACT_ACTS.size;
    const actWords: Readonly<Record<number, string>> = {
      12: 'Twelve tokens',
      13: 'Thirteen tokens',
      14: 'Fourteen tokens',
      15: 'Fifteen tokens',
      16: 'Sixteen tokens',
      17: 'Seventeen tokens',
      18: 'Eighteen tokens',
    };
    const actWord = actWords[acts];
    expect(actWord, `CONTRACT_ACTS is ${String(acts)} — add the word to actWords`).toBeDefined();
    expect(source, `the CONTRACT_ACTS docblock must say ${String(acts)}`).toContain(actWord as string);
    for (const [count, word] of Object.entries(actWords)) {
      if (Number(count) === acts) continue;
      expect(source, `prompt.ts still says "${word}" and CONTRACT_ACTS has ${String(acts)}`).not.toContain(
        word,
      );
    }
  });

  it('★ THE VERB→UNIT MAP IS PINNED, because an empty `verbs` list is invisible to the sweep', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // **THREE MUTATIONS FOUND NOTHING AND THIS IS THE FIRST OF TWO FIXES.**
    //
    // Deleting `engage` from `### A refused demand becomes a BATTLE — the five phases` broke no
    // test. The exhaustive sweep above iterates units × THEIR OWN verbs, so a unit whose `verbs`
    // list has been emptied is never visited by it — the loop body simply does not run. `engage`
    // was still claimed by two other blocks, so "every verb has a home" stayed green too.
    //
    // That is the vacuity pattern this whole change keeps re-finding, now in the sweep meant to
    // prevent it: an assertion whose subject can be removed along with the defect. So the MAP is
    // pinned, not just its coverage. Editing the catalog churns this list, and that is the point —
    // re-homing a verb's rules is a rules-surface decision and somebody should have to look.
    // ══════════════════════════════════════════════════════════════════════════
    setSpeed('instant');
    const runtime = new Runtime({ seed: 'verbmap' });
    const homesOf = (claims: (u: (typeof CONTRACT_CATALOG)[number]) => boolean): string =>
      CONTRACT_CATALOG.filter(claims)
        .map((u) => (u.block ?? '(preamble)').replace(/^### /, ''))
        .join(' + ');
    const map: Record<string, string> = {};
    for (const verb of [...runtime.liveVerbs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
      map[verb] = homesOf((u) => u.verbs.includes(verb));
    }
    expect(map).toEqual({
      // ── ★ FOUR ROWS WENT EMPTY OR SHRANK, AND THAT IS THE `acts` GATE LANDING ──
      //
      // `abandon` and `join` and `withdraw` are claimed by no unit's `verbs` at all now: every one
      // of them means two things, and each meaning is claimed per act in the map below. `build` and
      // `refine` and `vote` keep exactly the one claim that really is verb-wide.
      //
      // An empty string here is legal ONLY because the act map covers it, and the two assertions at
      // the bottom of this test are what tie the halves together.
      abandon: '',
      admit: 'Joining — `apply` `{"syndicate":"<id>"}` · `admit` `{"syndicate":"<id>","principal":"<who>"}`',
      apply: 'Joining — `apply` `{"syndicate":"<id>"}` · `admit` `{"syndicate":"<id>","principal":"<who>"}`',
      approve: 'OFFICES — `grant` with `on_behalf_of`',
      // ★ `audit` — a canon verb that went LIVE at `RULES_VERSION` 23 after twenty versions with no
      // handler. It is claimed by the same block as `grant` and `revoke` and that is deliberate:
      // an access log is only worth reading because a CLEARANCE was granted, so a member offered
      // `audit` needs the paragraph that explains what a clearance is, not a separate one.
      audit:
        'Doing it — `grant`, acting on behalf, and `revoke` (all live now) + CLEARANCE and the DOSSIER — the part `revoke` cannot undo',
      // ── `build` DOES NOT CLAIM §11B's `### Taking one`, AND THE MAP IS WHY I LOOKED ──
      //
      // That block's heading contains the word `build` and it documents `build {"kind":"ANCHOR"}`,
      // so the map made it look like a missing claim. It is a deliberate omission, decided by
      // measurement: claiming `build` there costs a **Commons newcomer 1,987 characters** — the
      // §11B preamble plus the block — for a member that cannot take a claim at all, since a
      // Commons claim is INVALID rather than merely refused.
      //
      // The gap it leaves is narrow and real: a member holding a posted bond, offered `build`
      // ANCHOR, with no claim yet and `post_bond` no longer on its menu, would get §11A and not
      // §11B. So the costed facts moved INTO §11A's kind block instead — the 5000 `ration`
      // standing at the system, the 50000 slashable bond, and a pointer to §11B — for about 140
      // characters in a block `build` already pulls. `agent-md.test.ts` pins that text.
      //
      // The deep section still arrives the two ways it should: through `post_bond`, and through
      // `required: holdsClaim` once territory is actually held.
      // ── ★ §11E's SIX UNITS USED TO ARRIVE HERE, AND FIVE OF THEM ON `build` ──
      //
      // This row was the whole defect, visible in exactly the place this map exists to make it
      // visible, and it read as *correct*: `build` documents four acts, so of course the fourth
      // one's section is claimed by `build`. But `build` also raises a WORKS, so **every position
      // in the game** — a Commons newcomer included — paid 3,360 characters for a war it cannot
      // declare. `build` now claims ONE unit: the kind block, which really is verb-wide because it
      // is the block that tells an agent to read the `kind` at all.
      build: '`build` is FOUR different acts — read the `kind`',
      claim: '(preamble)',
      create: 'Every promise has two halves + Choosing the proportion — `elective_bps` on `create`',
      deliver: 'The Levy — nobody sits this out',
      // ★ At 28 `demand` also pulls §11F, and this is the whole of what a verb gate on a
      // single-meaning verb buys: `demand` means one thing, so gating on it is already as sharp as
      // an act gate, and the three positions that can open one are the three that pay.
      demand:
        'Opening one — `demand` + (preamble) + ' +
        'STRAITS — the lanes the region cannot route around + ' +
        'SWAY — how many hands count as force, and where',
      deny: '(preamble)',
      elect: 'Every promise has two halves + Paying the elective half: `elect`, and say `IN_FULL`',
      // §9A. THREE blocks, and C1 was deleting one of them: the timetable (the only window a hull
      // may be committed in), the orders, and the stop condition that survives being offline.
      engage:
        'A refused demand becomes a BATTLE — the five phases + Committing a hull — `engage` + `withdraw_below_bps` is a STOP CONDITION, not an act',
      fight: 'Answering either one — `yield` · `fight` · join, or say nothing',
      fill_role:
        '(preamble) + The third half: `stake` on `fill_role` — how you outbid a rival, and what it costs',
      form: 'Founding one — `form` `{"name":"...", ...}`',
      graduate: '`graduate` — leaving, and it is one-way',
      // ★ LEFT EXACTLY ALONE, AND IT IS THE CONTROL CASE. `grant` means ONE thing, so its verb
      // gate is already as sharp as an act gate would be — `RULES_VERSION` 23's clearance block
      // cost a newcomer 74 characters against campaigns' 3,360 through the same mechanism.
      grant:
        'Doing it — `grant`, acting on behalf, and `revoke` (all live now) + CLEARANCE and the DOSSIER — the part `revoke` cannot undo',
      // `join {raid, side}` and `join {campaign, side, system}` are two sections of the document and
      // the verb gate shipped both to whoever was offered either. `side` is on BOTH, so it is not
      // the discriminator; which subject the affordance names is.
      join: '',
      message: 'Negotiating',
      // ★ `haul` — the canon verb whose step arrived with the fourth good. It is claimed by ONE
      // block on purpose: the block states a rule about geography (the good is refined at one tier
      // and spent at another) and neither `refine {kind:"ALLOY"}` nor `haul` is usable without it.
      haul: 'The fourth good — the one the COMMONS makes CHEAPEST, and the one that flows the other way',
      move: '(preamble)',
      post_bond: '(preamble) + Taking one — `post_bond` then `build`',
      publish_offer: 'Negotiating',
      // §7's production chain, which is FLOOR. The ALLOY fork is `refine{ALLOY}` below.
      refine: '(preamble)',
      revoke:
        'Doing it — `grant`, acting on behalf, and `revoke` (all live now) + CLEARANCE and the DOSSIER — the part `revoke` cannot undo',
      seal: 'Seals — the say-do gap',
      set_delivery_intent: 'The Levy — nobody sits this out',
      sign: '(preamble)',
      trade:
        '(preamble) + ★ What you may spend, and the one rule that decides it — `market.transferable_minor`',
      // The Levy block is FLOOR, so `vote` keeps it and it costs nothing. The 4,462-character
      // EXPOSURE block is now `vote{LEVY}`, because the Charge ballot reads no EXPOSURE.
      vote: 'The Levy — nobody sits this out',
      // ★ Empty, and this is the row that was actively WRONG rather than merely expensive: it
      // pointed a venture exit and a campaign lift at §11C's syndicate notice — an act the engine
      // cannot perform (`SyndicateBook.giveNotice` has no caller).
      withdraw: '',
      yield: 'Answering either one — `yield` · `fight` · join, or say nothing',
    });

    // ── ★ AND THE ACT→UNIT MAP, WHICH IS THE OTHER HALF OF THE SAME PIN ───────
    //
    // Same argument one level down: a unit whose `acts` list is emptied is invisible to any loop
    // over `unit.acts`, so emptying one has to churn a pinned literal or the mutation is free.
    // Twelve tokens, and the vocabulary is asserted closed against this map below.
    const actMap: Record<string, string> = {};
    for (const act of [...CONTRACT_ACTS].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
      actMap[act] = homesOf((u) => (u.acts ?? []).includes(act));
    }
    expect(actMap).toEqual({
      // ── ★ PHASE 3's THREE, and every one of them is `(preamble) + <its own block>` ──
      //
      // The preamble is the FRONT's clock and it goes to all three, because a front is weather and
      // anybody pricing it needs the timetable. The per-act blocks are the three decisions.
      'elect{COVER}':
        '(preamble) + The decision — `elect` `{"cover":"<id>","election":"IN_FULL"}`',
      'publish_offer{COVER}':
        '(preamble) + Writing COVER — `publish_offer` ' +
        '`{"kind":"COVER","system":…,"good":…,"limit":N,"premium":N}`',
      'sign{COVER}': '(preamble) + Buying COVER — `sign` `{"cover":"<id>","terms_hash":"<hash>"}`',
      'abandon{CLAIM}': 'Losing it — arrears, the window, and two exits that beat a lapse',
      'abandon{VENTURE}': '(preamble)',
      // ★ Five of §11E's six units, and this row is where the +3,360 went: onto the act that is
      // only ever offered to a principal whose holding can actually stage a war.
      'build{CAMPAIGN}':
        '(preamble) + Declaring one — `build` `{"kind":"CAMPAIGN","system":"<the claimed system>"}` + The PULSE — once a Reckoning, on a published clock, whether you are awake or not + Reading it — `holding.campaigns[]` + Getting out — and there are four ways, not one' +
        ' + (preamble) + STRAITS — the lanes the region cannot route around + SWAY — how many hands count as force, and where',
      'build{WORKS}': 'Building one — `build` `{"kind":"WORKS","system":"<id>"}`',
      'deliver{CHARGE}': 'Paying for it — the CHARGE',
      // A campaign ally gets the pulse clock, how to read the row and how to take the side — and
      // NOT how to declare one or how to lift one, neither of which is available to it.
      'join{CAMPAIGN}':
        '(preamble) + The PULSE — once a Reckoning, on a published clock, whether you are awake or not + Reading it — `holding.campaigns[]` + Taking a side — `join` `{"campaign":"<id>","side":"ATTACKER"|"DEFENDER"}`' +
        ' + (preamble) + STRAITS — the lanes the region cannot route around + SWAY — how many hands count as force, and where',
      // ★ TWO units at 24, and the pair is the point: a bystander offered `join{RAID}` needs the
      // answering block (what the force arithmetic is, and that ties go to the defender) AND the
      // coalition block (what its hand costs, and that `join` draws no aggression capacity). The
      // `+` is this map's own spelling for "more than one unit claims this gate".
      'join{RAID}':
        'Answering either one — `yield` · `fight` · join, or say nothing + Standing with somebody else — `join`, and the coalition it makes' +
        ' + (preamble) + STRAITS — the lanes the region cannot route around + SWAY — how many hands count as force, and where',
      // ★ 31. ONE unit, and the narrowness is the point: everything else `message` means — the typed
      // acts, the 480 characters, that nothing binds until both parties countersign — binds every
      // shape of the verb alike and stays on the bare verb in `### Negotiating`. Only the reach rule
      // and the entitlement are specific to addressing a PRINCIPAL, and only they are gated here.
      'message{TO}': 'Talking to somebody you share no venture with: the PARLEY',
      'refine{ALLOY}': 'The fourth good — the one the COMMONS makes CHEAPEST, and the one that flows the other way',
      'vote{CHARGE}': 'Paying for it — the CHARGE',
      'vote{LEVY}': 'The third half: `stake` on `fill_role` — how you outbid a rival, and what it costs',
      'withdraw{CAMPAIGN}':
        '(preamble) + Reading it — `holding.campaigns[]` + Getting out — and there are four ways, not one',
      // ★ The correction: a venture exit now selects the block that states what it FORFEITS.
      'withdraw{VENTURE}':
        '(preamble) + The third half: `stake` on `fill_role` — how you outbid a rival, and what it costs',
    });

    // ── THE TWO HALVES, TIED TOGETHER ────────────────────────────────────────
    //
    // An empty row in the verb map is legal only when the act map covers that verb, and no row in
    // either map may be empty. Without this pair, moving a verb to `acts` and then deleting the
    // `acts` entry would leave a mechanic with no readable rules and both maps still pinned.
    for (const [act, homes] of Object.entries(actMap)) {
      expect(homes, `${act} is in CONTRACT_ACTS and claimed by no unit`).not.toBe('');
    }
    for (const [verb, homes] of Object.entries(map)) {
      if (homes !== '') continue;
      const byAct = Object.entries(actMap).filter(([act]) => act.startsWith(`${verb}{`));
      expect(
        byAct.length,
        `${verb} is claimed by no unit's \`verbs\` AND by no act — it is a mechanic whose rules no ` +
          'player can read',
      ).toBeGreaterThan(0);
      for (const [act, actHomes] of byAct) {
        expect(actHomes, `${verb} is act-gated and ${act} has no home`).not.toBe('');
      }
    }
  });

  it('★ THE ACT VOCABULARY IS CLOSED, BOTH WAYS — no typo matches, no token is decoration', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // The two failure directions of an act gate, and they are not symmetrical:
    //
    //   · **A typo in a unit's `acts`** (`build{CAMPAIGNS}`) would never match anything, and the
    //     unit would silently stop being selected for the act it documents. That is a DROPPED RULE
    //     — the one thing this catalog exists to make impossible — and nothing else would notice,
    //     because `readSituation` filters to the vocabulary and a token outside it never appears.
    //   · **A token in the vocabulary that no unit gates on** is decoration: a capability that
    //     exists and is never exercised, which this project has now shipped at five depths.
    //
    // So the set and the catalog are pinned against each other in both directions. `EVERY_SITUATION`
    // derives its acts from the catalog, so this also proves the analytic ceiling is the whole
    // catalog and not a stale hand-typed copy of it.
    // ══════════════════════════════════════════════════════════════════════════
    const gated = new Set(CONTRACT_CATALOG.flatMap((u) => [...(u.acts ?? [])]));
    for (const act of gated) {
      expect(
        CONTRACT_ACTS.has(act),
        `${act} is gated on by a unit and is NOT in CONTRACT_ACTS, so \`readSituation\` will never ` +
          'produce it and the unit is unreachable by its own act',
      ).toBe(true);
    }
    for (const act of CONTRACT_ACTS) {
      expect(gated, `${act} is in the vocabulary and no unit gates on it — decoration`).toContain(act);
    }
    const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
    expect([...EVERY_SITUATION.acts].sort(byName)).toEqual([...CONTRACT_ACTS].sort(byName));
    // Every token is `verb{DISCRIMINATOR}` and its verb half is a real verb of the catalog.
    setSpeed('instant');
    const live = new Set(new Runtime({ seed: 'vocab' }).liveVerbs);
    for (const act of CONTRACT_ACTS) {
      expect(act, `${act} is not spelled verb{...}`).toMatch(/^[a-z_]+\{[A-Z_]+\}$/);
      expect(live, `${act} names a verb the engine does not implement`).toContain(
        act.slice(0, act.indexOf('{')),
      );
    }
  });

  it('★ `actTokensOf` READS THE SHAPES THE ENGINE ACTUALLY PUBLISHES — value keys and subject keys', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // `situationalFocus` read a top-level `syndicates` key for its whole life and never fired once,
    // and its test passed because the fixture matched the code instead of the engine. A params
    // reader is the same trap with more keys, so these are the literal param objects from
    // `api/observe.ts` and `observe/catalogue.ts`, copied from the call sites.
    // ══════════════════════════════════════════════════════════════════════════
    expect(actTokensOf('build', { kind: 'WORKS', system: 'sys-01' })).toEqual(['build{WORKS}']);
    expect(actTokensOf('build', { kind: 'CAMPAIGN', system: 'sys-09' })).toEqual(['build{CAMPAIGN}']);
    // ANCHOR and HULL carry no token: their rules are in the verb-wide kind block.
    expect(actTokensOf('build', { kind: 'ANCHOR', system: 'sys-09' })).toEqual([]);
    expect(actTokensOf('build', { kind: 'HULL', system: 'sys-09', hull: 'WARDEN', modules: [] })).toEqual([]);
    // The ration recipe names no discriminator, so nothing is invented for it.
    expect(actTokensOf('refine', { system: 'sys-01' })).toEqual([]);
    expect(actTokensOf('refine', { kind: 'ALLOY', system: 'sys-01', qty: 40 })).toEqual(['refine{ALLOY}']);
    // Subject keys. `side` is on BOTH kinds of `join`, so it is never the discriminator.
    expect(actTokensOf('join', { raid: 'raid:1', side: 'DEFENDER' })).toEqual(['join{RAID}']);
    expect(actTokensOf('join', { raid: 'raid:1', side: 'RAIDER', principal: 'p:x' })).toEqual(['join{RAID}']);
    expect(actTokensOf('join', { campaign: 'campaign:5:0', side: 'ATTACKER', system: 'sys-09' })).toEqual([
      'join{CAMPAIGN}',
    ]);
    expect(actTokensOf('withdraw', { campaign: 'campaign:5:0' })).toEqual(['withdraw{CAMPAIGN}']);
    expect(actTokensOf('withdraw', { venture: 'v:1', role_index: 0 })).toEqual(['withdraw{VENTURE}']);
    expect(actTokensOf('abandon', { claim: 'sys-09' })).toEqual(['abandon{CLAIM}']);
    expect(actTokensOf('abandon', { venture: 'v:1', role_index: 0 })).toEqual(['abandon{VENTURE}']);
    expect(actTokensOf('deliver', { obligation: 'CHARGE', system: 'sys-09', amount: 4_000 })).toEqual([
      'deliver{CHARGE}',
    ]);
    // The Levy and its `payer` carry no token: §5's block is FLOOR, so a finer gate changes nothing.
    expect(actTokensOf('deliver', { obligation: 'LEVY', amount: 4_000 })).toEqual([]);
    expect(actTokensOf('deliver', { obligation: 'LEVY', payer: 'p:x', amount: 4_000 })).toEqual([]);
    expect(actTokensOf('vote', { ballot: 'LEVY', rule: 'INVERSE_EXPOSURE' })).toEqual(['vote{LEVY}']);
    expect(actTokensOf('vote', { ballot: 'CHARGE', rule: 'EVEN' })).toEqual(['vote{CHARGE}']);
    // Discriminated verbs whose rules are genuinely verb-wide produce nothing at all.
    expect(actTokensOf('create', { kind: 'HAUL' })).toEqual([]);
    expect(actTokensOf('trade', { operation: 'place', side: 'BID', quantity: 4 })).toEqual([]);
    expect(actTokensOf('message', { venture: 'v:1' })).toEqual([]);
    // Total on rubbish, because a partial observation must read as "no act" and never throw.
    expect(actTokensOf('build', undefined)).toEqual([]);
    expect(actTokensOf('build', null)).toEqual([]);
    expect(actTokensOf('build', { kind: 7 })).toEqual([]);
    expect(actTokensOf('build', { kind: '' })).toEqual([]);
  });

  it('★ NO VERB HAS GROWN A SECOND MEANING BEHIND THE AUDIT — swept against a real world', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // The tripwire for the FOURTH instance. `build` grew from two kinds to four across three
    // features and no test noticed, because a new `kind` is a new *param value*, not a new verb,
    // and nothing was watching params.
    //
    // What it flags: a verb whose offers **disagree about their discriminator** inside one swept
    // world — two values, or one offer with and one without. `elect {venture}` is always
    // `elect{VENTURE}` and is not flagged; `refine` appears both bare and as `refine{ALLOY}` and is.
    //
    // A flagged verb is not automatically a bug: `create`'s five kinds share one set of promise
    // rules, and the ledger records that as `VERB_GATED` with the reason. What it is, is a decision
    // somebody has to write down. This is a tripwire and not a proof — it only sees what the swept
    // world produces, which is why the ledger's `gate` consistency is checked separately below.
    // ══════════════════════════════════════════════════════════════════════════
    setSpeed('instant');
    const seed = 'meanings';
    const runtime = new Runtime({ seed });
    const cast = new HeuristicCast(runtime, { size: 6 });
    const members = cast.seat(seed);
    const signatures = new Map<string, Set<string>>();
    for (let i = 0; i < 120; i += 1) {
      for (const action of cast.decide(runtime.engine.tick + 1, seed)) runtime.engine.submit(action);
      expect(runtime.runTick().halted).toBe(false);
      if (i % 8 !== 0) continue;
      for (const member of members) {
        const observation = buildObservation({
          runtime,
          principal: member.principal,
          serverNowMs: 0,
          fresh: true,
          wakesRemaining: 16,
          stale: false,
          corrections: [],
          correctionsDropped: 0,
          actionsRemaining: 4,
        });
        for (const affordance of observation.affordances) {
          const seen = signatures.get(affordance.verb) ?? new Set<string>();
          // The empty signature counts: a verb offered both with and without a `kind` means two
          // things exactly as much as one offered with two kinds does. `refine` is that case.
          seen.add(discriminatorsOf(affordance.verb, affordance.params).join('|'));
          signatures.set(affordance.verb, seen);
        }
      }
    }
    const audited = new Set(CONTRACT_MULTI_MEANING_VERBS.map((row) => row.verb));
    const grown = [...signatures.entries()].filter(([, seen]) => seen.size > 1).map(([verb]) => verb);
    for (const verb of grown) {
      expect(
        audited,
        `\`${verb}\` is offered with ${String(signatures.get(verb)?.size ?? 0)} different discriminators ` +
          `(${[...(signatures.get(verb) ?? [])].join(' / ')}) and is not in CONTRACT_MULTI_MEANING_VERBS. ` +
          'Decide whether its rules are verb-wide or per-act, and record it — that decision going ' +
          "unrecorded is how §11E ended up in a newcomer's first wake.",
      ).toContain(verb);
    }
    // Non-vacuous: the sweep must actually have found verbs that mean more than one thing, or it is
    // asserting over an empty list — the failure this whole change keeps re-finding.
    //
    // `create` (five venture kinds) and `refine` (bare and `{kind:"ALLOY"}`) are the two this world
    // always produces, so they are named rather than counted. `build` is NOT: whether one member is
    // offered two different kinds inside 120 ticks depends on what it can afford, which is exactly
    // why a swept tripwire is a tripwire and the ledger's `gate` consistency below is the proof.
    expect(grown, 'the sweep found no verb with two meanings at all').toEqual(
      expect.arrayContaining(['create', 'refine']),
    );
  });

  it('★ THE AUDIT LEDGER CANNOT GO STALE — every row’s `gate` matches the catalog', () => {
    // A row saying `ACT_GATED` while no unit gates one of that verb's acts is a comment claiming a
    // fix that was reverted; a row saying `VERB_GATED` while some unit gates an act of it is the
    // reverse. Both read fine in review, which is why they are checked.
    const gated = new Set(CONTRACT_CATALOG.flatMap((u) => [...(u.acts ?? [])]));
    for (const row of CONTRACT_MULTI_MEANING_VERBS) {
      const anyGated = [...gated].some((act) => act.startsWith(`${row.verb}{`));
      expect(anyGated, `${row.verb} is marked ${row.gate} and the catalog disagrees`).toBe(
        row.gate === 'ACT_GATED',
      );
      // An act-gated verb with one meaning is a contradiction; a verb-gated row with one is the
      // honest state of `set_delivery_intent`, which has one obligation today.
      if (row.gate === 'ACT_GATED') {
        expect(row.acts.length, `${row.verb} is ACT_GATED with one meaning`).toBeGreaterThan(1);
      }
      expect(row.because.length, `${row.verb} has no recorded reason`).toBeGreaterThan(40);
    }
    // And every verb the catalog act-gates has a row, so the ledger is the complete list.
    for (const act of gated) {
      const verb = act.slice(0, act.indexOf('{'));
      expect(
        CONTRACT_MULTI_MEANING_VERBS.map((r) => r.verb),
        `${verb} is act-gated in the catalog and unrecorded in the audit ledger`,
      ).toContain(verb);
    }
  });

  it('★ `build` ALONE DOES NOT SHIP §11E — the third instance, and the one this change is for', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // **THE MUTATION THAT MATTERS. Put `build` back on any §11E unit and this goes red.**
    //
    // Measured before: a Commons newcomer offered `build {kind:"WORKS"}` was shipped the whole
    // campaign section — 3,360 characters, 8% of its excerpt — for a mechanic that needs a
    // lane-adjacent CLAIMED system, twice a claim bond, and a depot §16.6 MUST-1 forbids in the
    // Commons. The verb gate could not express the difference, because `build` means four things
    // and is offered to essentially everybody.
    //
    // Asserted as a PAIR, because either half alone is passable by an accident: the verb must not
    // pull it, and the act must.
    // ══════════════════════════════════════════════════════════════════════════
    const doc = document();
    const campaignSection = '## 11E. CAMPAIGNS — the only way to take ground somebody is PAYING for';
    const declaring =
      '### Declaring one — `build` `{"kind":"CAMPAIGN","system":"<the claimed system>"}`';

    // A WORKS builder — the newcomer's actual position — gets §11A and NOT §11E.
    const works = excerptFor(doc, offeringAct('build{WORKS}'));
    expect(works.units, 'the WORKS block is what a WORKS builder needs').toContain(
      '## 11A. WORKS — the only reason goods exist › ### Building one — `build` `{"kind":"WORKS","system":"<id>"}`',
    );
    expect(
      works.sections,
      'a member that can raise a WORKS must not be shipped the rules of a war it cannot declare',
    ).not.toContain(campaignSection);
    expect(works.text).not.toContain(declaring);
    // And the absence is NAMED, not silent — the whole discipline of this file.
    expect(works.notThisWake.map((o) => o.heading)).toContain(`${campaignSection} › ${declaring}`);

    // The act itself — everything §11E has for a declarer, including its preamble.
    const campaign = excerptFor(doc, offeringAct('build{CAMPAIGN}'));
    expect(campaign.sections, 'the act is offered, so the section ships').toContain(campaignSection);
    expect(campaign.units).toContain(`${campaignSection} › ${declaring}`);
    expect(campaign.dropped.map((o) => o.heading)).not.toContain(`${campaignSection} › ${declaring}`);
    // A declarer needs the exits too: doing nothing forfeits the whole bond.
    expect(campaign.units).toContain(`${campaignSection} › ### Getting out — and there are four ways, not one`);

    // ── AND THE MEASUREMENT, WHICH IS THE ARGUMENT ──────────────────────────
    const newcomer = CONTRACT_POSITIONS[0];
    expect(newcomer?.name).toMatch(/^a newcomer on its first wake/);
    const asIs = excerptFor(doc, newcomer?.situation ?? NO_SITUATION);
    expect(asIs.sections, 'a first wake pays nothing for §11E').not.toContain(campaignSection);
    const asIfVerbGated = excerptFor(doc, {
      ...(newcomer?.situation ?? NO_SITUATION),
      acts: new Set([...(newcomer?.situation.acts ?? []), 'build{CAMPAIGN}']),
    });
    expect(
      asIfVerbGated.text.length - asIs.text.length,
      // ★ 33: §11E's block plus §11G's, because `build{CAMPAIGN}` gates both. That
      // the two ADD is the check — the day a delta gets absorbed is the day the budget binds — and
      // it is why §11F is act-gated rather than gated on the bare `build` a newcomer really is
      // offered.
      'what the verb gate cost a newcomer, pinned so the saving cannot quietly come back',
    ).toBe(6_251);
  });

  it('★ A PARTY TO A LIVE CAMPAIGN IS REQUIRED THE PULSE — no verb announces the clock', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // The situation half of the §11E fix, and §9A's `inBattle` argument one clock out. A campaign
    // pulses **once a Reckoning on a published clock whether or not you are awake**; force is
    // counted at that instant and a starved pulse walks toward forfeiting the whole bond. A defender
    // is offered no campaign verb at all — it cannot declare, and only the attacker may lift — so
    // without `inCampaign` the party with the most to lose would be the one shown nothing.
    //
    // MUTATION: delete `required: (s) => s.inCampaign` from the PULSE block and this goes red.
    // ══════════════════════════════════════════════════════════════════════════
    const doc = document();
    const pulse = '### The PULSE — once a Reckoning, on a published clock, whether you are awake or not';
    const unit = CONTRACT_CATALOG.find((u) => u.block === pulse);
    expect(unit).toBeDefined();
    if (unit === undefined) return;
    expect(unitGrade(unit, { ...NO_SITUATION, inCampaign: true }), 'a party to a live campaign').toBe('RULES');
    expect(unitGrade(unit, NO_SITUATION), 'and nobody else is charged for it').toBe('NO');

    const besieged = excerptFor(doc, { ...NO_SITUATION, inCampaign: true });
    expect(besieged.units, 'the timetable reaches a defender that is offered no verb').toContain(
      `## 11E. CAMPAIGNS — the only way to take ground somebody is PAYING for › ${pulse}`,
    );
    expect(besieged.dropped.map((o) => o.heading), 'RULES never consults the budget').not.toContain(
      `## 11E. CAMPAIGNS — the only way to take ground somebody is PAYING for › ${pulse}`,
    );
    // It is `required`, so it survives an absurd cap — the property the whole ceiling rests on.
    const squeezed = excerptFor(doc, { ...NO_SITUATION, inCampaign: true }, 4_000);
    expect(squeezed.units).toContain(
      `## 11E. CAMPAIGNS — the only way to take ground somebody is PAYING for › ${pulse}`,
    );
  });

  it('★ `withdraw` NO LONGER SHIPS SYNDICATE NOTICE — it ships what the exit actually COSTS', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // The instance that was WRONG rather than merely expensive. The engine's `withdraw` takes
    // `{campaign}` or `{venture, role_index}` and nothing else — `SyndicateBook.giveNotice` has no
    // caller — so §11C's `### Leaving costs a Reckoning of notice` was selected by every venture
    // exit and every campaign lift, and never once by the act it documents.
    //
    // What a staked role-holder needed instead is in §4: *"`withdraw` from a venture you have staked
    // in and the stake is forfeit to the other parties"*. That is slashable capital lost to a rule,
    // which is A5′'s shape — and it was the one sentence the verb gate did NOT reach.
    // ══════════════════════════════════════════════════════════════════════════
    const doc = document();
    const notice = '## 11C. SYNDICATES — pooling, and the authority that comes with it › ### Leaving costs a Reckoning of notice';
    const stake =
      '## 4. Work happens in ventures › ### The third half: `stake` on `fill_role` — how you outbid a rival, and what it costs';

    const quitting = excerptFor(doc, offeringAct('withdraw{VENTURE}'));
    expect(quitting.units, 'the forfeit is what a venture exit costs, so it is what it is shown').toContain(stake);
    expect(quitting.text).toContain('the stake is **forfeit to the');
    expect(quitting.units, 'and NOT the syndicate notice rules, which are a different act').not.toContain(notice);
    expect(quitting.sections, 'nor §11C at all, which quitting a role has nothing to do with').not.toContain(
      '## 11C. SYNDICATES — pooling, and the authority that comes with it',
    );

    // A campaign lift gets §11E's exits and, again, not §11C.
    const lifting = excerptFor(doc, offeringAct('withdraw{CAMPAIGN}'));
    expect(lifting.units).toContain(
      '## 11E. CAMPAIGNS — the only way to take ground somebody is PAYING for › ### Getting out — and there are four ways, not one',
    );
    expect(lifting.units).not.toContain(notice);

    // And a member that sits in a house still reads the notice rule, because it is a true fact about
    // the house whether or not the exit has a verb.
    expect(unitGrade(CONTRACT_CATALOG.find((u) => unitName(u) === notice) as never, {
      ...NO_SITUATION,
      inSyndicate: true,
    })).toBe('CONTEXT');
  });

  it('★ THE OTHER THREE MULTI-MEANING VERBS AIM AT THE RIGHT SECTION — `abandon` · `join` · `vote`', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // One test, three defects of the same shape, each asserted in both directions — because a gate
    // that is too wide and a gate that is too narrow read identically in review.
    //
    //   `abandon` — `{venture, role_index}` quits a role, `{claim}` cedes territory. The verb gate
    //               cost a landless member §11B's preamble plus `### Losing it`: 2,962 characters.
    //   `join`    — `{raid, side}` and `{campaign, side, system}`. Wrong in BOTH directions: a raid
    //               bystander got §11E, a campaign ally got §11D — a section A8 makes unreachable
    //               for half the world.
    //   `vote`    — the Levy ballot is allocated by EXPOSURE and the Charge ballot is not, so a
    //               claimant voting on the Charge was charged 4,462 characters of stake rules.
    // ══════════════════════════════════════════════════════════════════════════
    const doc = document();
    const sovereignty = '## 11B. Sovereignty — territory you have to MAINTAIN';
    const predation = '## 11D. PREDATION — two kinds, and only one of them has a name';
    const campaigns = '## 11E. CAMPAIGNS — the only way to take ground somebody is PAYING for';
    const stakeBlock = '### The third half: `stake` on `fill_role` — how you outbid a rival, and what it costs';
    const chargeBlock = '### Paying for it — the CHARGE';

    expect(excerptFor(doc, offeringAct('abandon{VENTURE}')).sections).not.toContain(sovereignty);
    expect(excerptFor(doc, offeringAct('abandon{CLAIM}')).units).toContain(
      `${sovereignty} › ### Losing it — arrears, the window, and two exits that beat a lapse`,
    );

    expect(excerptFor(doc, offeringAct('join{RAID}')).sections, 'a raid is not a campaign').not.toContain(
      campaigns,
    );
    expect(excerptFor(doc, offeringAct('join{RAID}')).units).toContain(
      `${predation} › ### Answering either one — \`yield\` · \`fight\` · join, or say nothing`,
    );
    expect(
      excerptFor(doc, offeringAct('join{CAMPAIGN}')).sections,
      'a campaign ally is not under a raid, and inside the Commons a raid is INVALID',
    ).not.toContain(predation);
    expect(excerptFor(doc, offeringAct('join{CAMPAIGN}')).units).toContain(
      `${campaigns} › ### Taking a side — \`join\` \`{"campaign":"<id>","side":"ATTACKER"|"DEFENDER"}\``,
    );

    expect(
      excerptFor(doc, offeringAct('vote{CHARGE}')).units,
      'the Charge ballot reads no EXPOSURE, so the stake block is not its rules',
    ).not.toContain(`## 4. Work happens in ventures › ${stakeBlock}`);
    expect(
      excerptFor(doc, offeringAct('vote{CHARGE}')).units,
      'and the block that DOES document `vote {"ballot":"CHARGE"}` ships instead',
    ).toContain(`${sovereignty} › ${chargeBlock}`);
    expect(excerptFor(doc, offeringAct('vote{LEVY}')).units).toContain(
      `## 4. Work happens in ventures › ${stakeBlock}`,
    );
  });

  it('★ A PARTY TO A LIVE BATTLE IS REQUIRED the timetable and the stop condition', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // The second fix for the three vacuous mutations. Removing `required: (s) => s.inBattle` from
    // either §9A block broke nothing, because no test asserted what a member IN a battle is owed —
    // only what a member offered `engage` is.
    //
    // The two are different and the difference is the whole point of `required`. MUSTER is **6
    // ticks of a 24-tick window and the only phase a hull may be committed in**; the window closes
    // whether or not the member was told it existed. And `withdraw_below_bps` is the one field
    // that lets a formation survive a fight its owner sleeps through (A3) — plus the rule that it
    // CANNOT save a tackled formation, which is a loss it would otherwise not see coming.
    // ══════════════════════════════════════════════════════════════════════════
    const doc = document();
    const phases = '### A refused demand becomes a BATTLE — the five phases';
    const stop = '### `withdraw_below_bps` is a STOP CONDITION, not an act';
    const orders = '### Committing a hull — `engage`';

    // In a battle with NO verb offered — mid-CONTEST, say, when it is too late to commit.
    const fighting = { ...NO_SITUATION, inBattle: true };
    for (const block of [phases, stop]) {
      const unit = CONTRACT_CATALOG.find((u) => u.block === block);
      expect(unit, block).toBeDefined();
      if (unit === undefined) continue;
      expect(unitGrade(unit, fighting), `${block} for a party to a live battle`).toBe('RULES');
    }
    const inBattle = excerptFor(doc, fighting);
    expect(inBattle.units, 'the timetable reaches a member inside a battle').toContain(
      `## 11D. PREDATION — two kinds, and only one of them has a name › ${phases}`,
    );
    expect(inBattle.text, 'and MUSTER is named, because it is the only window that takes a hull')
      .toContain('the ONLY window a hull may be committed in');
    expect(inBattle.text, 'and the tackle exception, which no threshold survives').toContain(
      'It cannot save a formation that something has TACKLE on',
    );

    // Offered `engage` — all three blocks, whether or not a battle is already live.
    const committing = excerptFor(doc, offering('engage'));
    for (const block of [phases, orders, stop]) {
      expect(committing.units, `${block} must reach a member offered \`engage\``).toContain(
        `## 11D. PREDATION — two kinds, and only one of them has a name › ${block}`,
      );
    }

    // And neither in a battle nor offered `engage`: none of it, and it is named as absent.
    const idle = excerptFor(doc, NO_SITUATION);
    for (const block of [phases, orders, stop]) {
      expect(idle.units).not.toContain(
        `## 11D. PREDATION — two kinds, and only one of them has a name › ${block}`,
      );
    }
  });

  it('a claimant is REQUIRED the Charge rules; a member with no claim is not', () => {
    // M5 in the mutation sweep — making §11B's CHARGE block non-required — was caught only by
    // the pinned size table, which says "a number moved" rather than "a claimant lost the rule
    // it is billed under". This says the second thing.
    const chargeBlock = CONTRACT_CATALOG.find(
      (u) => u.block === '### Paying for it — the CHARGE',
    );
    expect(chargeBlock).toBeDefined();
    if (chargeBlock === undefined) return;
    expect(
      unitGrade(chargeBlock, { ...NO_SITUATION, holdsClaim: true }),
      'A5′: never a lapse against a claimant that was never shown what it owed',
    ).toBe('RULES');
    expect(unitGrade(chargeBlock, NO_SITUATION)).toBe('NO');

    // Same for the two whose failure is silent or terminal.
    for (const [block, fact] of [
      ["### Keeping it COLLECTING — the anchor's fuel", 'anchorCold'],
      ['### Losing it — arrears, the window, and two exits that beat a lapse', 'inArrears'],
    ] as const) {
      const unit = CONTRACT_CATALOG.find((u) => u.block === block);
      expect(unit, block).toBeDefined();
      if (unit === undefined) continue;
      expect(unitGrade(unit, { ...NO_SITUATION, [fact]: true }), `${block} on ${fact}`).toBe('RULES');
    }
  });

  it('★ MEASURED: what each position actually costs, in characters', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // Pinned, so a block added to agent.md moves a number here and somebody has to look. The
    // last row is the analytic ceiling — every fact and every verb at once, which no principal
    // can be, since a claim anchors the body and withholds the crossing.
    // ══════════════════════════════════════════════════════════════════════════
    const doc = document();
    const sizes = CONTRACT_POSITIONS.map((p) => excerptFor(doc, p.situation).text.length);
    expect(sizes, 'the measured table in the report and in CONTRACT_POSITIONS').toEqual([
      // ══════════════════════════════════════════════════════════════════════════
      // ★ **THE `acts` GATE, MEASURED. TWO ROWS FELL AND NOTHING ELSE MOVED.**
      //
      // The note that used to sit here said §11E's cost was *"reported rather than trimmed"* and
      // named the fix: *"a `ContractSituation` field rather than the `build` verb, which is a change
      // to the catalog's own shape."* That is this change, and the shape is
      // {@link ContractUnit.acts} plus `inCampaign`.
      //
      //   before  after   Δ       position
      //   43,106  39,746  −3,360  a newcomer on its first wake
      //   51,494  48,134  −3,360  mid-game in the Commons
      //   52,367  52,367       0  about to take territory
      //   71,391  71,391       0  a claimant in trouble
      //   79,419  79,419       0  the analytic ceiling
      //
      // **−3,360 is exactly §11E's five `build`-gated units** (315 + 636 + 858 + 471 + 1,070 = 3,350,
      // plus five 2-character separators). Nothing was rewritten and no rule was cut: the same prose
      // now reaches the principals whose affordance list offers the act.
      //
      // **The two zero rows are the measurement that proves the mechanism rather than the number.**
      // "About to take territory" is a graduated holding, and a graduated holding CAN stage a
      // campaign — the depot rule (§16.6 MUST-1) is what excludes the Commons, not the lack of a
      // claim — so it keeps `build{CAMPAIGN}` and keeps paying. The claimant likewise. Had those
      // rows fallen too, the gate would be dropping rules from readers who can act on them, which is
      // a different and much worse finding.
      //
      // Three rows are NEW. `at war` is where §11E's bill belongs and had no row before. The last two
      // exist because the coverage test was a tautology — see `CONTRACT_POSITIONS`.
      // ══════════════════════════════════════════════════════════════════════════
      // ══════════════════════════════════════════════════════════════════════════
      // ★ **24 · COALITIONS. THREE ROWS MOVED BY EXACTLY THE SECTION'S SIZE AND FIVE DID NOT MOVE.**
      //
      //   before  after   Δ       position
      //   39,746  39,746       0  a newcomer on its first wake
      //   48,134  48,134       0  mid-game in the Commons
      //   52,367  52,367       0  about to take territory
      //   52,809  52,809       0  at war
      //   71,391  74,654  +3,263  a claimant in trouble
      //   62,436  62,436       0  the Commons at its fullest
      //   72,900  76,163  +3,263  outside the Commons and landless, at its fullest
      //   79,419  82,682  +3,263  the analytic ceiling
      //
      // **+3,263 is `agent.md`'s delta to the character**, so §11D's new coalition block lands whole
      // on every position that can reach a standoff and nothing was trimmed to fit it. And the five
      // zeroes are the gate: the block is `wanted` on `nearStandoff` and act-gated on `join{RAID}`,
      // and **neither reaches a principal that cannot take a side.**
      //
      // The three that move are the three that can: a claimant, a landless member outside the
      // Commons, and the ceiling. The five that do not include `at war` — a campaign is not a
      // standoff — and `the Commons at its fullest`, which is the one that had to be argued rather
      // than observed: it inherited `nearStandoff: true` from `EVERY_SITUATION` and grew **890
      // characters** for an act A8 makes impossible at both ends, which is §11E's own defect
      // appearing inside the fixture built to measure §11E. `CONTRACT_POSITIONS` now states the
      // exclusion with its reason.
      //
      // Two of the four zero rows are the two the previous author added because the coverage test was
      // a tautology, and this is the first change measured against them. They earned their keep
      // immediately: the landless row is where the +3,263 shows up as a REACHABLE cost, and without
      // it the only row carrying this section would have been the unreachable ceiling.
      // ══════════════════════════════════════════════════════════════════════════
      //
      // ── ★ AT 27, +1,809 TO EVERY ROW AND +3,202 TO THE THREE THAT WORK GROUND ──
      //
      // 27 is a *corrections* pass, not a feature, and the shape of its cost says so: it added no
      // block and every character went into blocks that already existed. The two figures decompose
      // exactly, which is the check that matters here:
      //
      //   +1,809 to EVERY position, of which
      //     +1,013  §11A `### The fourth good` — **a FALSE RULE, corrected.** `agent.md` asserted
      //             twice that alloy *"runs only at a COMMONS system … cannot make one unit, at any
      //             occupancy, with any amount of ore, ever."* The engine has `ALLOY_IN_BY_TIER`
      //             (COMMONS 8 · MARCHES 32 · FRONTIER 64) and its own comment calls it *"a price
      //             gradient rather than a wall, because the wall version was measured and
      //             deadlocked"*. A probe hauled 288 ore to the Marches and got 9 alloy. The doc had
      //             also contradicted ITSELF for fifteen versions — eight lines below the
      //             prohibition it priced self-refining at *"four times the price"*.
      //     +503    §6 preamble — `corrections_dropped`, and the prompt RANKING, so the ordering the
      //             fix installs is checkable by the agent reading it rather than only by us.
      //     +318    §6 `### Read affordances[] carefully` — withheld from the MENU is not withheld
      //             from the GAME, which is the sentence a capped list needs to not read as a ban.
      //     +257    §8 — the spectator frames exist and are at `/compact/frames/`, not the API path.
      //     +151    §7 — the alloy rate again (§7 states it too) and **`build` is FOUR acts, not
      //             three**: §7 said three, the engine has WORKS · ANCHOR · CAMPAIGN · HULL, and §7
      //             is FLOOR so that line was charged to every position on every wake.
      //
      //   +1,393 MORE on the three rows that hold a grant or work claimed ground:
      //     +1,307  §10 `### CLEARANCE and the DOSSIER` — that a clearance is a **continuous,
      //             per-tick, unlogged** read, which `audit` cannot show you because `audit` and
      //             `about_me[]` list *cut dossiers* and never reads. §10 documented the leak half
      //             in four bullets and the surveillance half nowhere, so a grantor could read all
      //             four and still not know its books were being watched.
      //     +86     §11B — the anchor's alloy, restated as the gradient.
      //
      // **§13's +1,153 is charged to nobody**, and that is the gating working rather than luck:
      // `CONTRACT_NOT_EXCERPTED` excludes *"## 13. When something seems wrong"* as *"a bug-report
      // channel you cannot reach from a plan"*, so the whole `briefing.corrections[]` reference —
      // `repeats`, `nearest_legal: null`, `corrections_dropped`, the `clientSequence` match key —
      // costs the cast zero and is there for the HTTP agents that read the file.
      //
      // The one row worth arguing is the newcomer's +1,809 for a rule about the fourth good. It
      // stays: a newcomer is offered `refine` on its first wake, `refine{ALLOY}` is one of its two
      // recipes, and the previous text would have sent it hauling ore it never needed to move. A
      // correct rule is not a feature and does not get to be optional.
      // ── ★ AT 28 (§16.12 #1, STRAITS AND SWAY): +2,891 TO SIX ROWS, AND ONE ROW GOT CHEAPER ──
      //
      //   before  after   Δ       position
      //   41,555  41,555       0  a newcomer on its first wake
      //   49,943  49,943       0  mid-game in the Commons
      //   54,371  57,262  +2,891  about to take territory
      //   54,813  57,704  +2,891  at war
      //   77,965  80,856  +2,891  a claimant in trouble
      //   65,552  65,110  **−442**  the Commons at its fullest
      //   79,474  82,365  +2,891  outside the Commons and landless
      //   85,993  88,884  +2,891  the analytic ceiling
      //
      // **+2,891 is §11F's whole size to the character**, so the section lands whole wherever it
      // lands and nothing was trimmed to fit it — against a 6,000 quota, less than half spent. The
      // gate is `verbs: ['demand']` plus `acts: ['join{RAID}', 'join{CAMPAIGN}', 'build{CAMPAIGN}']`:
      // `demand` means one thing so its verb gate is already sharp (`grant`'s control case), while
      // `join` and `build` each carry a second meaning and are act-gated. Gating on the bare `build`
      // would have charged all eight rows, which is §11E's +3,543 defect with a new section number.
      //
      // ★ **THE −442 IS THE FINDING, AND IT IS A DEFECT CLOSED RATHER THAN A SAVING.** 24's open
      // list said: *"`join {campaign, side}` has no tier gate — a Commons-seated principal is
      // offered both sides of a war two tiers away, and its hands are Commons-bound so it can never
      // reach the objective."* `campaign/roster.ts` now refuses that outright, so `join{CAMPAIGN}`
      // left `COMMONS_CANNOT_HOLD`'s complement — and with it went 442 characters of §11E that the
      // Commons row had been charged for an act it could never perform. Had the token stayed, this
      // row would have grown **+2,891** instead: §11E's own defect, for the third time, inside the
      // fixture built to measure §11E's defect. It was found by measuring, not by reasoning.
      //
      // The two zero rows are the proof the gate aims: a newcomer and a Commons member read none of
      // this, because neither can open a demand, join a raid or stage a campaign — and `holding.sway`
      // still carries their reach and its rule on every wake regardless of this catalog, so neither
      // can be refused for a rule it was never shown.
      // ⚑ The seven figures that used to sit here (41,555 · 49,943 · 57,262 · 57,704 · 80,856 ·
      // 65,110 · 82,365) were §11F-on-28's reading, taken against a tree that had **neither** the
      // risk market nor the parley in it. They are deleted rather than kept as history because two
      // value arrays in one `toEqual` is how a suite comes to check one quantity twice against two
      // expectations — the exact defect the 29/31 merge produced one file over. The Δ argument above
      // survives; its absolute numbers do not.
      //
      // ── ★ §11F, PHASE 3's RISK MARKET, MEASURED. FOUR POSITIONS PAID ZERO. ──
      //
      //   before  after   Δ       position
      //   41,555  41,555      0  a newcomer on its first wake
      //   49,943  49,943      0  mid-game in the Commons
      //   54,371  54,371      0  about to take territory
      //   54,813  54,813      0  at war: party to a live campaign
      //   77,965  81,791  +3,826 a claimant in trouble
      //   65,552  69,378  +3,826 the Commons at its fullest
      //   79,474  83,300  +3,826 outside the Commons and landless
      //
      // **The `acts` gate is why the first four are zero**, and it is version 24's lesson applied
      // before it cost anything rather than after. `sign` and `elect` are offered to essentially every
      // principal holding a venture role, so a §11F gated on the bare verbs would have charged
      // **every** position +3,826 — §11E's +3,543 defect with a different section number. Gated on
      // `sign{COVER}` / `elect{COVER}` / `publish_offer{COVER}`, only a position actually offered a
      // COVER act pays for the section, and the four that are not offered one pay nothing.
      // ── ★ 33 · THE LODE (+1,619 EVERYWHERE) AND §11G (+2,891, ACT-GATED) ──
      //
      // The two rows compose exactly and the composition is the check: 1,615 + 2,891 = 4,506, which
      // is the delta on all five positions that can reach a standoff, and the Commons row is
      // 1,615 − 442 = +1,173 because AGT-S2's fix took `join{CAMPAIGN}` out of its offered set.
      // Nothing was trimmed at any position. `agent.md`'s bill for 33 is 4,506 characters against a
      // 6,000 quota — the LODE's 1,615 includes the floor paragraph a settler needs before it
      // commits, and §11G's 2,891 is charged only to principals who can project force.
      // ── ★ 37 · THE CROWDING TERM AND THE SEAL EXAMPLE ─────────────────────
      //
      // Two rules-surface corrections, and both are charged to EVERY position because both are FLOOR
      // rules rather than act-gated ones:
      //
      //   · §7's crowding paragraph. The lode is the SMALLER term. A blind player read
      //     `yield 110 · richness_bps 0 · gate: true`, crossed onto the most crowded system on the
      //     map, and was not wrong about anything it read — the row published the ~15% spread and
      //     hid the ~435% one. Every principal that can `graduate` or `build` needs this, which is
      //     all of them.
      //   · §8's copyable `seal` example. The document described the five fields in prose and called
      //     one of them `unit`; the engine reads `measure`. PROP-D1 refused the documented spelling.
      //     Sealing is required for every role held, so this is FLOOR too.
      //
      // Neither is discretionary: both are cases of a rules surface that read as complete while
      // misleading its reader (hard rule 4, scar #1).
      //
      // ★ **THE NEWCOMER'S +656 IS THE `acts` GATE, MEASURED FOR THE SIXTH TIME.** It pays for the
      // crowding paragraph — it can `graduate`, so it needs it — and pays **nothing** for the seal
      // example, because a newcomer holds no venture role and `seal` is act-gated. Two FLOOR-ish
      // corrections landing together, and one of them still discriminates.
      //
      // ⚑ The branch's own reading of this array (44,683 · 53,422 · 63,125 · 66,267 · 93,245 ·
      // 75,115 · 94,754) is **deleted rather than kept**, for the reason two rows up. Its first four
      // cells happen to agree with the merged tree to the character and its last four are 251 low —
      // the strike-floor correction, which lands only on the four positions that can be struck. Had
      // this cell been adjusted rather than read, four of eight would have been wrong and the four
      // that were right would have made the array look verified. Every cell below is a fresh reading.
    // ── ★ AT 40 · §12.1's ELEVENTH KEY, `risk` (A9) ─────────────────────────
    //
    // Two edits to `agent.md`, and they decompose to the character against the section sizes:
    //
    //   +460    §6's observe block — one key line and its five continuation lines. **FLOOR**, so
    //           every position pays it. It is the payload's shape and an agent reads that once.
    //   +2,663  §11F — the `schedule{}` sentence (a front is on a calendar, so a world between
    //           fronts still has a countdown), `at_stake` as a BOUND rather than a forecast, and
    //           `covered[]` / `owed_to_you[]` / `your_record` / `terms`, none of which the section
    //           had ever named. **Act-gated** on `publish_offer{COVER}` · `sign{COVER}` ·
    //           `elect{COVER}`, so it lands on the same four positions §11F already landed on.
    //
    //   before  after   Δ       position
    //   44,683  45,143   +460   a newcomer on its first wake
    //   53,422  53,882   +460   mid-game in the Commons
    //   63,125  63,585   +460   about to take territory
    //   66,267  66,727   +460   at war: party to a live campaign
    //   93,496  96,619 +3,123   a claimant in trouble
    //   75,366  78,489 +3,123   the Commons at its fullest
    //   95,005  98,128 +3,123   outside the Commons and landless
    //  101,524 104,647 +3,123   the analytic ceiling
    //
    // **460 + 2,663 = 3,123 is `agent.md`'s whole delta**, so both edits land whole and nothing was
    // trimmed to fit either. The four +460 rows are the `acts` gate for the seventh time: a newcomer
    // is never offered a COVER act, so it pays for the key's *shape* and not for the section's rules
    // — and it still reads `risk.rule` and `risk.schedule` on every wake, because those travel with
    // the data rather than with the contract.
    //
    // Every cell is a fresh reading against the merged tree. `risk` is the ONE case in this table's
    // history where the arithmetic was checkable independently — the section deltas are exact — and
    // it was still read rather than added, because that is the only version of this that survives a
    // merge with a branch nobody here measured against.
      45_143, // a newcomer on its first wake            (+460: §6's key line ONLY)
      53_882, // mid-game in the Commons                 (+460)
      63_585, // about to take territory                 (+460)
      66_727, // at war: party to a live campaign        (+460)
      96_619, // a claimant in trouble                   (+3,123)
      78_489, // the Commons at its fullest              (+3,123)
      98_128, // outside the Commons and landless, at its fullest: the largest REACHABLE (+3,123)
      // ── ★ AT 32, +2,384 TO THE FIVE ROWS OUTSIDE THE COMMONS AND ZERO TO THE THREE INSIDE IT ──
      //
      // ══════════════════════════════════════════════════════════════════════════
      // 32 makes a WORKS destructible, and §11A `### It can be DESTROYED` is its rules surface: your
      // structure can be ended, the margin that decides it, the force that saves it, and the fact that
      // rebuilding gets **no** first-works discount. That last clause is why the block is not optional
      // — a member that lost a WORKS and expected the 25,000 currency door to reopen has been billed by
      // a rule nobody showed it, which is the class this catalog exists to prevent.
      //
      //   before  after   Δ       position
      //   42,412  42,412      0  a newcomer on its first wake
      //   50,800  50,800      0  mid-game in the Commons
      //   55,228  57,612 +2,384  about to take territory
      //   58,370  60,754 +2,384  at war
      //   85,348  87,732 +2,384  a claimant in trouble
      //   72,935  72,935      0  the Commons at its fullest
      //   86,857  89,241 +2,384  outside the Commons and landless, at its fullest
      //   93,376  95,760 +2,384  the analytic ceiling
      //
      // **+2,384 is `agent.md`'s delta to the character**, so the block lands whole wherever it lands
      // and nothing was trimmed to fit it. Every row is a READING of the merged catalog, taken after
      // 29 and 31 were both in the tree — the mistake this table's own header records is arithmetic on
      // a pin taken when the catalog held only one of the three features.
      //
      // **The three zeroes are the gate, and they are the whole argument for it.** The unit is `wanted`
      // on `outsideCommons && (holdsWorks || canBuildWorks)`. A8 makes a Commons WORKS unrazable — no
      // force reading reaches it, and `razeVerdict` refuses it as INVALID rather than merely failing —
      // so every rule in the block is a threat that cannot touch a Commons-seated reader. Note that
      // `mid-game in the Commons` **holds a WORKS** and still pays nothing: the works predicate alone
      // would have charged it, and `outsideCommons` is what makes it free. Same call as `join{RAID}`'s
      // row, and the same error §11E cost every position 3,543 characters for.
      //
      // The block still states the Commons exemption for the five that do get it, so a member reading
      // it on the wake it graduates out learns both the threat and where it stops.
      // ══════════════════════════════════════════════════════════════════════════
      //
      // ══════════════════════════════════════════════════════════════════════════
      // ★ **31 · THE PARLEY. +857 EVERYWHERE AND +2,700 MORE ON FIVE ROWS OF EIGHT.**
      //
      //   before  after   Δ       position
      //   41,555  42,412    +857  a newcomer on its first wake
      //   49,943  50,800    +857  mid-game in the Commons
      //   54,371  55,228    +857  about to take territory
      //   54,813  58,370  +3,557  at war: party to a live campaign
      //   77,965  81,522  +3,557  a claimant in trouble
      //   65,552  69,109  +3,557  the Commons at its fullest
      //   79,474  83,031  +3,557  outside the Commons and landless, at its fullest
      //   85,993  89,550  +3,557  the analytic ceiling
      //
      // **The delta decomposes exactly, and the two halves are two different decisions.**
      //
      //   +857 to EVERY row, both of it FLOOR and both of it unavoidable:
      //     §6's observe block — `counterparties[]` now also carries the principals you may address,
      //     with `parley_reach`, `parleys_received` and `last_parley`. A reader that thinks that list
      //     is "people I have dealt with" will not look for its mail in it.
      //     §7's verb table — **`message` is THREE acts**, and the note names all six multi-meaning
      //     verbs. This is the `build`-is-three-not-four correction of `RULES_VERSION` 27 arriving
      //     one verb over, before it becomes a wrong count somebody acts on: an agent that believes
      //     `message` takes a venture will never find the parley, whatever `affordances[]` says.
      //
      //   +2,700 MORE on the five rows that can address somebody: §4's
      //     `### Talking to somebody you share no venture with: the PARLEY`, act-gated on
      //     `message{TO}`, landing whole with nothing trimmed.
      //
      // 3,557 characters is the whole `agent.md` bill for this feature, against a 5,000 quota — and a
      // NEWCOMER pays 857 of it rather than all of it, which is the gate's entire purpose.
      //
      // **The three zeroes are the gate, and the first one is the number that mattered.** `message` is
      // offered to essentially every principal that has ever created a venture — `message {venture,
      // act:"assure"}` is on the menu for every unpaid elective half — so a `verbs: ['message']` gate
      // would have charged **all eight rows**, including a newcomer that cannot reach a single
      // principal and cannot be entitled on its first wake. That is `build`'s +3,543 defect exactly,
      // and `message{TO}` is the discriminator that avoids it: `to` is present precisely when the
      // address is a PRINCIPAL rather than a venture. `mid-game in the Commons` and `about to take
      // territory` hold no grant and stand in no campaign, so reach is empty for both and the rules
      // are correctly free.
      //
      // **`at war` is the row this section exists for**, and it is the one to watch: it is
      // hand-declared and ARGUED rather than swept, because the heuristic cast has never declared a
      // campaign (`grep CAMPAIGN src/cast/heuristic.ts` is empty). Its `acts` set had to gain
      // `message{TO}` explicitly, and without that the fixture would have measured **zero** cost for
      // the section written to close its own defect — this project's signature failure landing inside
      // the measurement of the fix. `test/say/parley.spec.ts` is the driven proof that the engine
      // really offers it there.
      //
      // The four `EVERY_SITUATION`-derived rows gained it automatically, and each legitimately: all
      // four hold a grant, and a grant's counterparty is reachable in either direction (§11.2 puts a
      // grant's parties in `PUBLIC`). `the Commons at its fullest` is the one worth naming — A8 keeps
      // campaigns out, so its reach is the GRANT rung alone, which is real and enough.
      // ══════════════════════════════════════════════════════════════════════════
      //
      // ── ★ +109 MORE ON FIVE ROWS: THE ENGINE'S OWN STATEMENT WAS WRONG TOO ──
      //
      // The alloy prohibition was not only in `agent.md`. `SOVEREIGNTY_STATEMENT` — a **rules
      // surface**, published in `post_bond`/`build` refusals and in every claim statement — said *"it
      // is refined only at a COMMONS system … so buy it at a Commons venue"*, and `agent.md` §11B
      // quotes that constant **verbatim** under a golden-file test. So the two surfaces were held in
      // sync on the false version by the guard whose whole job is keeping them in sync. Fixing the
      // constant is what moved these five rows, and only these five: §11B is gated on holding or
      // taking a claim, and a newcomer is charged none of it.
      //
      // ── ★ AND `RULES_VERSION` 23's CLEARANCE IS THE CONTROL CASE THAT REFINES THE LESSON ──
      //
      // Kept from the merge, because it is the half that stops this from being read as *"verb gating
      // is broken"*. 23 added +74 to every row and +2,525 to the two that hold a grant. The 74 is one
      // line of the §12.1 observe block, which every position pulls because every position reads the
      // observation. The 2,525 is §10's `### CLEARANCE and the DOSSIER`, gated on
      // `grant`/`revoke`/`audit` plus `holdsGrant` — so it lands on the two positions party to a
      // grant and on neither of the first two.
      //
      // **Same catalog, same gating mechanism, opposite outcome**, and the difference is not the
      // mechanism: `grant` means one thing and `build` means four. So verb gating is not replaced
      // here and 30-odd single-meaning verbs are untouched — *verb gating is only as sharp as the
      // verb*, and what this change adds is a discriminator for the six that have grown a second
      // meaning. `CONTRACT_MULTI_MEANING_VERBS` names all of them and the five left verb-gated.
      //
      // The deltas still compose exactly: 22 and 23 summed with no absorption, and 24 does too — see
      // the ceiling test. The day two deltas stop adding is the day the bar binds again.
      // ── ★ THE ANALYTIC MAXIMUM CROSSED THE CEILING, AND THE CAP ABSORBED IT ──
      //
      // **UNCAPPED it is 72,162 against `MAX_CONTRACT_CHARS` = 72,000** (pinned two tests above),
      // so the sentence in `MAX_CONTRACT_CHARS`'s note that says *"the analytic maximum only has
      // to fit, which it does"* is now false by 162 characters — the first time that has happened.
      //
      // **This row is 70,591, one character BELOW what it was before the feature**, and that is the
      // budget mechanism working rather than a coincidence: priced at the real ceiling the selector
      // dropped CONTEXT to make room for a rule, which is exactly the trade it is for. The
      // assertion two tests above proves only CONTEXT gave. And no principal can occupy this
      // position anyway — `graduate` and a held claim cannot coexist.
      //
      // The margin that governs is the REACHABLE one, and it is healthy: 72,000 − 64,576 = **7,424**
      // against a required 4,000. Spent on `RULES_VERSION` 19's §11A block — the rule that decides
      // what a member may commit to a BID, which had no home in the contract at all until now,
      // because until 19 the answer was *nothing, for everyone, always*.
      //
      // ── ★ 71,338 → 72,909 AT THE 120,000 RAISE, AND ONLY THIS ROW MOVED ─────
      //
      // The four rows above are **byte-identical** across the raise. This one grew by 1,571, which
      // is the exact amount of CONTEXT the 72,000 bar had been trimming off a position no principal
      // can occupy. So the raise bought back nothing a player will ever read — and that is the
      // measurement that proves the mechanism rather than the number: **the budget governs CONTEXT
      // only, and no REACHABLE position was ever being squeezed.** Had a reachable row moved here,
      // the raise would have been silently restoring rules an agent had been denied, which is a
      // different and much worse finding.
      // ── ★ 72,909 → 76,894 at 22 → 79,419 at 23 → 82,682 at 24 ──────────────
      //
      // Three features spent here and none had to trim a rule. Against 120,000 the analytic margin is
      // **37,318**, and for the first time in this file's history three consecutive features landed
      // without the margin being the headline — which is exactly what the raise bought.
      //
      // ── 82,682 → 85,884 at 27 ────────────────────────────────────────────────
      //
      // +3,202, and the margin is **34,116** against a required 4,000. Nothing trimmed, and nothing
      // to argue about the ceiling this time: 27 is a corrections pass and the largest single item in
      // it is a false rule being made true.
      //
      // ── 85,993 → 89,819 at 29 (Phase 3's risk market) ────────────────────────
      //
      // +3,826 for §11F, and the margin is **30,181** against a required 4,000. The number that
      // matters more is one row up: the largest **reachable** position went 79,474 → 83,300, so the
      // reachable margin is 36,700 and no rule was trimmed. Four of the seven reachable positions
      // paid **nothing**, which is the `acts` gate doing the job version 24 built it for.
      // ── AND 31's PARLEY ON TOP: +3,557 gated, +857 FLOOR ────────────────────
      //
      // 29 and 31 were built on parallel branches and each pinned this cell for a world containing
      // only its own feature — 89,819 and 89,550. **Neither survived the merge.** The measured
      // figure is 93,376, margin **26,624** against a required 4,000, and the largest reachable
      // position is 86,857 with 33,143 to spare. Read the two dead numbers above as the reason this
      // cell must be re-measured rather than adjusted whenever two features land together.
      // ── 93,376 → 95,760 at 32 ────────────────────────────────────────────────
      //
      // +2,384 for §11A `### It can be DESTROYED`. The ceiling remains unreachable by construction —
      // it holds a claim *and* is landless, which no principal is (`SOV-2` anchors a claimant's
      // holding on its claim).
      104_647, // the analytic ceiling                    (+3,123 at 40)
    ]);
    // ══════════════════════════════════════════════════════════════════════════
    // ⚑⚑ **STOP. THE ANALYTIC MARGIN IS 662 OF 72,000 AND THAT IS THE FINDING, NOT THE FOOTNOTE.**
    //
    // 778 → 662 at `RULES_VERSION` 20, and the 116 did not buy a rule — it CORRECTED one. The
    // paragraph 19 bought for 631 characters said the goods floor was **per venue** and **never
    // falls**, and 20 makes both false. That is the one spend that is never optional: an agent
    // planning against a rules surface that describes the old engine is scar #1, and this surface
    // is published to every agent in the world.
    //
    // 1,408 → 778 at 19, and the 631 bought the one half of D7 the contract had never
    // stated: the GOODS floor. Measured before the prose was written rather than after, which is
    // what the paragraph below asks for and had not previously been done — see the note on the
    // `uncapped` assertion above for the two drafts the measurement rejected.
    //
    // This row is the SUM of two features that landed concurrently in separate worktrees, neither of
    // whose authors could see the other's spend:
    //
    //   10,307 → 5,276  `RULES_VERSION` 17, the EXPOSURE high-water mark
    //    5,276 → 1,408  `RULES_VERSION` 18, the fourth good
    //
    // **Three quarters of the raise, gone in two features, and the second author measured 3,899 of
    // margin on their own branch and 1,408 after the merge.** That gap is the whole lesson: a
    // character budget is a shared resource in exactly the way `RULES_VERSION` is (HARD RULE 7), and
    // unlike `RULES_VERSION` nobody arbitrates it in advance, so two correct local decisions compose
    // into one that nobody made. This is the third shared resource this project has been bitten by
    // and the first that has no owner.
    //
    // The next author cannot write their way past this. `MAX_CONTRACT_CHARS`'s note names the moves in
    // order — make the unit CONDITIONAL (the catalogue already selects per wake, and the fourth good's
    // `### The fourth good` block is `required` only for a claimant, which is what kept it this cheap);
    // FOLD it into a field whose unit is already unambiguous (read `one-word-two-units.spec.ts` first —
    // nine numbered sites are exactly that fold going wrong); or RAISE the ceiling with the cost
    // measured. **What is not available any more is "add a paragraph and re-measure".**
    //
    // Worth stating what is NOT alarming: the analytic maximum has no occupant — `graduate` and a held
    // claim cannot coexist — and the largest REACHABLE position is 63,006, which leaves 8,994. A
    // reader who quotes only the reachable number will conclude there is room, and will be wrong about
    // the direction of travel.
    // ══════════════════════════════════════════════════════════════════════════
    // ── ★ FIVE ROWS +3,637, AND IT IS THE FOURTH GOOD BEING WRITTEN DOWN ────────────────────
    //
    // Every row, including the newcomer's, and that is the honest signature of this change rather
    // than a regression. §7's production-chain paragraph is FLOOR — it is where an agent learns that
    // ore pays nothing — and the fork between `refine {kind:"RATION"}` and `refine {kind:"ALLOY"}`
    // belongs in exactly that paragraph, along with the sentence that goods are located and `haul` is
    // the only verb that moves them. A newcomer that did not read those two would refine its whole
    // store into the wrong good and then find it in the wrong place.
    //
    // The remaining +2,000 or so is `### The fourth good`, which is RULES for anybody working ground
    // or holding a claim and is **required** for a claimant: the anchor's manufactured half is a
    // price no MARCHES seat can pay out of local production, and a claimant refused for a shortfall
    // in a good it was never told it cannot make has been billed by a rule nobody showed it (A5′).
    //
    // 68,319 against `MAX_CONTRACT_CHARS` = 72,000 leaves **3,899 characters of margin** on a state
    // no principal can occupy, and 11,485 on the largest reachable one. The margin is thinner than it
    // was and that is worth saying out loud: the next section of this size needs the ceiling looked
    // at rather than raised reflexively.
    // ── ★ ALL FIVE ROWS +572 TO +2,491, AND THAT IS THE HIGH-WATER MARK GETTING WRITTEN DOWN ──
    //
    // `RULES_VERSION` 17 made §5.2's two exposure rules read a **per-Reckoning EXPOSURE high-water
    // mark** instead of the instantaneous figure at `LEVY_ASSESS_PHASE`, and the prose landed in two
    // places, which is why the rows move by different amounts:
    //
    //   · **§4's `### The third half: \`stake\`\` block, +1,919** — RULES for anybody offered
    //     `fill_role` or `vote`. The three consequences and the two-field table live here, because
    //     this is the block that already explains what a stake costs and the mark is the *other*
    //     thing it costs. The newcomer, who holds no role, does not pay for it.
    //   · **§5's Levy block, +572** — FLOOR, so every member is shown it every wake. Only a
    //     paragraph: the published default's "inversely to Exposure" had to say *which* Exposure, or
    //     the one sentence a turtling member reads about why hiding is taxed names a quantity the
    //     engine no longer reads. That is the expensive placement and it was kept to the minimum.
    //
    // **Written at full length rather than compressed, for `DoNothingOutcome.unit`'s reason.** The
    // detail is not decoration: the mark only ever RISES inside a cycle, so releasing a stake before
    // the freeze does not undo the position, and `obligations.exposure.mine` reads ~0 at exactly the
    // phase an agent is most likely to check it. A member that knows about EXPOSURE but not about
    // *which reading* will size its stakes from the wrong number and read its own bill as arbitrary —
    // which is scar #1's class, not a nicety.
    //
    // The margins now, which is the number the next author needs:
    //
    //   - largest REACHABLE position 59,138 of the 68,000 the margin allows → **8,862 characters**;
    //   - analytic maximum 66,724 of `MAX_CONTRACT_CHARS` → **5,276 characters**.
    //
    // Still yes to "can I add a sentence", and no longer comfortably: the analytic margin has gone
    // from 10,307 to 5,276 in one feature. `MAX_CONTRACT_CHARS`'s note names what to do when it runs
    // out, and the next author should read it before the next block rather than after.
    // ── ★ FOUR ROWS +2,540, AND THAT IS THE ROLE `stake` GETTING WRITTEN DOWN ─────────────────
    //
    // `### The third half: \`stake\` on \`fill_role\`` is RULES for anybody offered `fill_role` or
    // `vote`, so it lands on every position that holds a role and on none that does not — which is
    // why the newcomer row is the only one that does not rise. It goes the other way by **5
    // characters**, and that is `### Negotiating` losing the separator it used to run to now that a
    // sibling block follows it; no prose was cut.
    //
    // Written at full length for `deliver {payer}`'s reason one feature earlier: a stake is
    // **escrowed at fill time and forfeit to the other parties on withdrawal** (§7.3) and it is the
    // figure two of §5.2's four allocation rules are computed from. Until `RULES_VERSION` 16
    // `lockFillStake` had no caller, EXPOSURE was identically zero, and there was nothing to say —
    // so this is the first version of `agent.md` that *can* say it, and the ceiling is what let it.
    // The largest reachable position is 56,647 against 72,000.
    // ── ★ ALL FIVE ROWS +2,200, AND THAT IS `deliver {payer}` GETTING WRITTEN DOWN ────────────
    //
    // The whole table moved by the same +2,240 because the prose went into `## 5`'s Levy block,
    // which is FLOOR: every member is shown it every wake, including one that will never carry
    // anybody's tribute. That is the expensive placement and it was chosen deliberately — the
    // block it belongs to is the one that already explains the non-escrowable share, and splitting
    // "you must be present for 30%" from "anybody may carry the other 70%" across two units is how
    // a rule gets read as half a rule.
    //
    // **The first feature since the raise to be able to just say the thing.** §5.2 escrowed 70% of
    // every assessment from the start, `deliver {payer}` implemented it from the start, `agent.md`
    // never mentioned it, and `paidOther` was **0 in every world this repo has ever run** — a
    // capability that exists and is never exercised is indistinguishable from one that is missing.
    // Under the old 56,000 ceiling this paragraph would have had to be rewritten to a sentence or
    // pushed onto a verb condition, which is exactly the rent the note below says three features in
    // a row paid. Nothing was trimmed to make room.
    // ── ⚑ THE CEILING WAS RAISED 56,000 → 72,000, AND THIS TABLE IS WHAT MOVED ────────────────
    //
    // **One row, and it is the unreachable one.** The four reachable positions are byte-identical
    // before and after the raise, because none of them was ever being squeezed — they were being
    // *threatened*, at 133 characters of margin. What moved is the analytic maximum: at 56,000 it
    // was priced down to **55,996** by dropping CONTEXT, and at 72,000 it emits **61,693** whole.
    // That is the raise doing the thing `MAX_CONTRACT_CHARS` says a non-binding ceiling does —
    // showing up as more rules delivered rather than as slack.
    //
    // **The margins now, which is the number the next author needs:**
    //
    //   - largest REACHABLE position 54,107 of the 68,000 the margin allows → **13,893 characters**;
    //   - analytic maximum 61,693 of `MAX_CONTRACT_CHARS` → **10,307 characters**.
    //
    // So the answer to "can I add a sentence" is **yes**, for the first time in three features. What
    // has NOT changed is what to do when this runs out again: `MAX_CONTRACT_CHARS`'s note names the
    // two legitimate moves and the one precondition (RULES-never-drop) that makes a raise permissible
    // at all. Trimming a rule to fit is not on that list, and the paragraph below is what it cost the
    // last three times.
    //
    // ── WHAT IT COST WHEN THE BUDGET WAS GONE, KEPT AS THE EVIDENCE FOR THE RAISE ──
    //
    // At 56,000 the slack was 133 characters on the reachable maximum and 4 on the analytic one.
    //
    // The currency door for a first WORKS (`works/params.ts:WORKS_GOODS_IN_CURRENCY_MINOR`) had to be
    // stated in `agent.md`, because a principal drained by four Reckonings of tribute was locked out of
    // the economy permanently and the rule that lets it back in is useless if only the engine knows it
    // — A2, and the same "a capability it cannot find" failure as the `fight` block below.
    //
    // **Where the 304 went, and what was NOT done to pay for it.** Three drafts were measured. The
    // first put an urgency paragraph in §11A's FLOOR preamble and cost **2,346** — every position pays
    // for FLOOR, including a member that will never be short. The second cost 800. This one is a single
    // sentence inside `### Building one`, which is `verbs: ['build']` and therefore shipped *exactly*
    // when the door is actionable. **No other block was trimmed to make room** — every character came
    // out of the new sentence, three times, and the field name `paying_goods_in_currency` was dropped
    // from the prose (it survives in the observation's own field docs) rather than a rule being cut.
    //
    // **That is what a spent budget does to a rules surface**, and it is the argument the raise rests
    // on: an author rewriting one sentence three times for length is a ceiling *charging a mechanic
    // rent in rules text*, and what gets cut to pay it is always prose a player can be refused for not
    // having read. Three features in a row paid that rent. The ceiling is what moved instead.
    // ── WHAT §9A's COMBAT LAYER COST, WHICH IS ALSO WHAT THE RAISES ARE FOR ──
    // +1,403 on a newcomer and +3,837 on a claimant, and `engage` went from a verb with rules
    // NOWHERE a member could read to four blocks. That growth is exactly what the raise was for:
    // at 38,000 it could not have landed without either trimming rules prose or putting a tenth
    // entry in CONTRACT_NOT_EXCERPTED, both of which this work exists to stop.

    // The last two are 3,457 larger than they were at a 38,000 ceiling, and the reason is worth
    // reading: the CONTEXT the old budget squeezed out of them — §11A's `### Who owns the ground`
    // and `### What to read` — now fits. **A ceiling that stops binding shows up as more rules
    // delivered, not as slack.** That is the raise doing something rather than nothing.

    // ── WHAT `###` GRANULARITY ACTUALLY BOUGHT, IN CHARACTERS ────────────────
    //
    // **Not headroom. Reachability, at roughly its own cost**, and that is worth writing down
    // because the estimate that justified this change said 7,400 characters would come free.
    //
    // The old `##` catalog would have shipped the newcomer 32,646 (floor 20,976 + §4 + §11) and
    // could not carry §11C at all; the new one ships 30,998 INCLUDING §11C's founding rules —
    // 1,648 fewer characters carrying 1,672 more of newly-readable rules. For the member about
    // to take territory the old number was the same 32,646 with **no §11B whatsoever**; the new
    // one is 35,564 with it. So the freed space went into the nine verbs rather than into slack.
    // That is what it was asked to do, and the budgeted positions now sit at 82–94% of the bar.
    for (const [i, position] of CONTRACT_POSITIONS.entries()) {
      if (!position.reachable) continue;
      expect(sizes[i] ?? 0, position.name).toBeLessThanOrEqual(
        MAX_CONTRACT_CHARS - CONTRACT_CEILING_MARGIN,
      );
    }
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

  it('MARKS a focus line whose section is not in this wake’s excerpt — and DOES NOT when it is', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // This test used to prove the marker on a CLAIMANT citing §11B, because §11B had never been
    // excerpted for anybody. `###` granularity changed the answer: a claimant now gets §11B, so
    // the honest version of this test is the pair — the marker fires for a member whose cited
    // section really is absent, and does NOT fire for one whose is present. Asserting the old
    // case would now be asserting that a claimant is denied the Charge rules.
    //
    // The remaining marker case is the line I had to fix: a graduated principal holding NOTHING
    // still gets a non-null `holding.sovereignty` (the last branch of `sovereigntyStatementFor`
    // returns "how to take one"), so it cites §11B — and §11B is not selected for it, because
    // `post_bond` is not offered and it holds no claim. Right to point, wrong to imply it was
    // handed the section.
    // ══════════════════════════════════════════════════════════════════════════
    const doc = loadContractDocument();
    if (doc === null) throw new Error('no document');
    setSpeed('instant');
    const runtime = new Runtime({ seed: 'marker' });
    const cast = new HeuristicCast(runtime, { size: 1 });
    const members = cast.seat('marker');
    const character = charactersFor(members, 'marker').values().next().value;
    if (character === undefined) throw new Error('no character');

    const render = (observation: Observation): string => {
      const contract = excerptFor(doc, readSituation(observation as unknown as Record<string, unknown>));
      return buildPrompt({
        contract,
        character,
        observation,
        memory: 'nothing',
        liveVerbs: ['move'],
        planMax: 1,
      })
        .messages.map((m) => m.content)
        .join('\n');
    };

    // ── ABSENT: graduated, holds nothing, offered no `post_bond`. §11B is cited, not given.
    const landless = render({
      ...anObservation(),
      holding: { tier: 'MARCHES', sovereignty: 'a statement', commons_bound: false, works: { held: [] } },
      obligations: { charge: [] },
      affordances: [],
    });
    expect(landless).toMatch(/§11B Sovereignty — you hold NO territory[^\n]*NOT IN THIS EXCERPT/);

    // ── PRESENT: a claimant. §11B IS in its excerpt now, so the marker must NOT appear — and
    // the Charge rules must really be there, verbatim.
    const claimant = render({
      ...anObservation(),
      holding: { tier: 'MARCHES', sovereignty: 'a statement', commons_bound: false, works: { held: [{}] } },
      obligations: { charge: [{ owed: 4_000, arrears: 0, anchor_hot: true }] },
    });
    expect(claimant).toContain('§11B Sovereignty — you hold territory that has to be MAINTAINED');
    expect(claimant).not.toMatch(/§11B Sovereignty — you hold territory[^\n]*NOT IN THIS EXCERPT/);
    expect(claimant, 'a claimant must be able to read the Charge it is billed under (A5′)').toContain(
      '### Paying for it — the CHARGE',
    );
    // §11A is floor, so its line is never marked.
    expect(claimant).toMatch(/§11A WORKS — the only source of goods in this world\n/);
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
