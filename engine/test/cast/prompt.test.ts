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
  CONTRACT_SECTIONS,
  DROP_ORDER,
  loadContract,
  MAX_CONTRACT_CHARS,
  projectObservation,
  REPLY_SCHEMA,
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
    expect(contract?.sections).toEqual([...CONTRACT_SECTIONS]);
    expect(contract?.dropped).toEqual([]);
    expect((contract?.text ?? '').length).toBeLessThanOrEqual(MAX_CONTRACT_CHARS);
    // It is the document, not a paraphrase of it: a distinctive sentence survives.
    expect(contract?.text).toContain('An illegal action is not an error.');
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
    // Headroom, so the next section added to agent.md does not repeat this.
    const used = contract?.text.length ?? 0;
    expect(used, `the excerpt is ${String(used)} of ${String(MAX_CONTRACT_CHARS)} — too tight`)
      .toBeLessThan(MAX_CONTRACT_CHARS * 0.95);
  });
});
