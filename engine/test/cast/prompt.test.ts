import { citedSection, situationalFocus } from '../../src/cast/prompt.js';
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

  it('★ A UNIT WHOSE VERB IS OFFERED IS ALWAYS INCLUDED — every verb, exhaustively', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // THE ONE THAT MATTERS. Omitting a rule a member is about to act on is worse than the
    // ceiling ever was: it is refused for something it was never told, and a refusal costs it
    // one of four material actions (AGT-S2). So this does not sample — it walks every verb in
    // the catalog and asserts that offering that verb ALONE, to a member holding nothing,
    // pulls its unit in, at grade RULES, with its section's preamble for company.
    //
    // MUTATION: delete a verb from any unit's `verbs`, or make `unitGrade` consult `required`
    // or `wanted` before the verb list, and this goes red naming the verb and the unit.
    // ══════════════════════════════════════════════════════════════════════════
    const doc = document();
    for (const unit of CONTRACT_CATALOG) {
      for (const verb of unit.verbs) {
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
    const claimed = new Set(CONTRACT_CATALOG.flatMap((u) => [...u.verbs]));
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
    // ⚑ **THE ANALYTIC MARGIN IS NOW 5,276 OF 72,000, DOWN FROM 10,307 IN ONE FEATURE.** Read
    // `MAX_CONTRACT_CHARS`'s note before the next block, not after it. Two consecutive features have
    // now each spent about a quarter of the raise.
    const uncapped = excerptFor(doc, EVERY_SITUATION, 10_000_000);
    expect(uncapped.text.length, 'the analytic maximum, uncapped, for the record').toBe(66_724);
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
    // 56,647 → 59,138 at `RULES_VERSION` 17: +1,919 in §4's `stake` block and +572 in §5's Levy
    // block, both naming the EXPOSURE HIGH-WATER MARK the two exposure rules now read. The margin
    // asserted below is the one that matters (cry-wolf on legitimate play) and it is 12,862.
    expect(worst.chars, 'the largest position a principal can occupy').toBe(59_138);
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

  it('★ THE POSITIONS DOMINATE A REAL WORLD — swept, not assumed', () => {
    // ══════════════════════════════════════════════════════════════════════════
    // The budget above is only as good as the position list. A list that has gone stale would
    // narrow what was checked and read green — the same shape as a predicate on a path
    // `observe` does not use. So a real world is driven and every observed situation must be
    // dominated by some declared position: its offered verbs a subset, its standing facts no
    // stronger. A situation that escapes fails HERE, naming the member and the fact, and the
    // fix is to widen the position and re-check the budget.
    // ══════════════════════════════════════════════════════════════════════════
    setSpeed('instant');
    const seed = 'dominates';
    const runtime = new Runtime({ seed });
    const cast = new HeuristicCast(runtime, { size: 6 });
    const members = cast.seat(seed);
    const doc = document();

    const dominates = (big: ContractSituation, small: ContractSituation): boolean => {
      for (const verb of small.verbs) if (!big.verbs.has(verb)) return false;
      const bits = [
        'inCommons', 'commonsBound', 'outsideCommons', 'inVenture', 'holdsGrant',
        'inSyndicate', 'holdsClaim', 'inArrears', 'anchorCold', 'underRaid',
        'holdsWorks', 'canBuildWorks',
      ] as const;
      return bits.every((bit) => !small[bit] || big[bit]);
    };

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
          actionsRemaining: 4,
        });
        const situation = readSituation(observation as unknown as Record<string, unknown>);
        const covered = CONTRACT_POSITIONS.some((p) => dominates(p.situation, situation));
        expect(
          covered,
          `no declared position dominates ${String(member.handle)} at tick ${String(runtime.engine.tick)}: ` +
            `verbs=[${[...situation.verbs].join(',')}] claim=${String(situation.holdsClaim)} ` +
            `raid=${String(situation.underRaid)} syndicate=${String(situation.inSyndicate)}`,
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
      { field: 'underRaid', to: true, patch: { obligations: { ...obligations, raid: [{ raid: 'r1' }] } } },
      // §9A. `obligations.battle`, adjacent to `raid` and NOT folded into it: the two carry
      // different deadlines, and MUSTER is 6 ticks of the raid's 24.
      { field: 'inBattle', to: true, patch: { obligations: { ...obligations, battle: [{ raid: 'r1' }] } } },
      { field: 'holdsWorks', to: true, patch: { holding: { ...holding, works: { ...works, held: [{}] } } } },
      {
        field: 'canBuildWorks',
        to: false,
        patch: { holding: { ...holding, works: { ...works, here: { affordable: false } } } },
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

    // Every field is covered. A new field with no case is a new unchecked path.
    const covered = new Set(cases.map((c) => String(c.field)));
    for (const field of Object.keys(base)) {
      if (field === 'verbs') continue;
      expect(covered, `${field} has no flip case, so its path is unverified`).toContain(field);
    }

    // ── AN ABSENT KEY IS "NO", NEVER AN ASSERTION ─────────────────────────────
    // `readSituation` is handed partial observations (`relations.spec.ts` builds a two-key stub),
    // and every field must read `false` from nothing. This is not decoration: writing
    // `outsideCommons: tier !== 'COMMONS'` — which is equivalent to the real code on every REAL
    // observation, and passed every case above — makes an observation with no `holding` read as
    // *predation can reach you*, which ships §11D to a stub and states a fact that is not true.
    // Caught only here, by mutation.
    const nothing = readSituation({});
    for (const [field, value] of Object.entries(nothing)) {
      if (field === 'verbs') continue;
      expect(value, `${field} read something out of an empty observation`).toBe(false);
    }
    expect(nothing.verbs.size).toBe(0);
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
    const spelled = { 28: 'twenty-eight', 41: 'forty-one', 44: 'forty-four', 45: 'forty-five' };
    const n = CONTRACT_CATALOG.length;
    expect(n, 'if this moved, update the three prose counts in prompt.ts too').toBe(45);
    expect(source, `the prose says a different number than ${String(n)}`).toContain(
      spelled[n as 45],
    );
    for (const [count, word] of Object.entries(spelled)) {
      if (Number(count) === n || Number(count) === n + 1) continue;
      expect(source, `prompt.ts still says "${word}" and there are ${String(n)} units`).not.toContain(
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
    const map: Record<string, string> = {};
    for (const verb of [...runtime.liveVerbs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
      map[verb] = CONTRACT_CATALOG.filter((u) => u.verbs.includes(verb))
        .map((u) => (u.block ?? '(preamble)').replace(/^### /, ''))
        .join(' + ');
    }
    expect(map).toEqual({
      abandon: '(preamble) + Losing it — arrears, the window, and two exits that beat a lapse',
      admit: 'Joining — `apply` `{"syndicate":"<id>"}` · `admit` `{"syndicate":"<id>","principal":"<who>"}`',
      apply: 'Joining — `apply` `{"syndicate":"<id>"}` · `admit` `{"syndicate":"<id>","principal":"<who>"}`',
      approve: 'OFFICES — `grant` with `on_behalf_of`',
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
      build:
        '`build` is THREE different acts — read the `kind` + Building one — `build` `{"kind":"WORKS","system":"<id>"}`',
      claim: '(preamble)',
      create: 'Every promise has two halves + Choosing the proportion — `elective_bps` on `create`',
      deliver: 'The Levy — nobody sits this out',
      demand: 'Opening one — `demand`',
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
      grant: 'Doing it — `grant`, acting on behalf, and `revoke` (all live now)',
      join: 'Answering either one — `yield` · `fight` · join, or say nothing',
      message: 'Negotiating',
      move: '(preamble)',
      post_bond: '(preamble) + Taking one — `post_bond` then `build`',
      publish_offer: 'Negotiating',
      refine: '(preamble)',
      revoke: 'Doing it — `grant`, acting on behalf, and `revoke` (all live now)',
      seal: 'Seals — the say-do gap',
      set_delivery_intent: 'The Levy — nobody sits this out',
      sign: '(preamble)',
      trade: '(preamble)',
      vote:
        'The third half: `stake` on `fill_role` — how you outbid a rival, and what it costs + The Levy — nobody sits this out',
      withdraw: 'Leaving costs a Reckoning of notice',
      yield: 'Answering either one — `yield` · `fight` · join, or say nothing',
    });
    // And no live verb may end up with an empty claim, which is the failure the map makes visible.
    for (const [verb, homes] of Object.entries(map)) {
      expect(homes, `${verb} is claimed by no unit`).not.toBe('');
    }
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
      35_512, // a newcomer on its first wake
      43_900, // mid-game in the Commons
      44_542, // about to take territory — and §11B is READABLE now, which it was not
      59_138, // a claimant in trouble — the largest REACHABLE position
      66_724, // the analytic maximum, which at 72,000 fits WHOLE and is no longer priced down
    ]);
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
