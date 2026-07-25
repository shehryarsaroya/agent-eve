/**
 * `/discrepancy`'s field aliases against SPEC §3 — the vocabulary canon is a rules surface.
 *
 * ┌─ HARD RULE 4, AND THE ONE BUG THAT SURVIVED A WHOLE BUILD ────────────────┐
 * │ "Never reuse a canon term for a second concept — not in docs, not in field  │
 * │ names, not in affordance strings." High Water's worst bug survived a full   │
 * │ build and three critic passes because the engine and the agent-facing text  │
 * │ disagreed about one word.                                                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The Gate-3 fix widened `/discrepancy` to accept the words agent.md §13 actually
 * uses, which was right and overdue. It also added `message`, `text` and `body` to
 * the whole-report alias list, and all three are already spoken for:
 *
 *   - **MESSAGE** is §3 canon — "one typed act in a hosted private negotiation" —
 *     and a live, free verb (`src/api/verbs.ts`, `FREE_VERBS`).
 *   - `text` and `body` are that verb's own two parameter spellings
 *     (`vMessage`: `readString(req.params, ['text', 'body'])`).
 *
 * So the three words an agent uses to *say something to a counterparty* are also the
 * three words that file a bug report with the host. This file is the executable
 * statement of that, and of what it costs when it is confused.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { FREE_VERBS } from '../../src/tick/budget.js';
import { PATHS, agent, harness, signed, type Harness } from './harness.js';

let h: Harness | null = null;

afterEach(async () => {
  if (h !== null) await h.close();
  h = null;
});

function live(): Harness {
  if (h === null) throw new Error('no harness');
  return h;
}

describe('SPEC §3 — /discrepancy must not answer to a canon term', () => {
  it('MESSAGE is a canon term and a live verb, so it is not available as a field name', () => {
    // Stated first and separately, so the next assertion cannot be read as pedantry:
    // this word already means something in this world.
    expect(FREE_VERBS.has('message')).toBe(true);
  });

  it('refuses a negotiation act rather than answering it "recorded, thank you"', async () => {
    h = await harness();
    // The exact body shape `vMessage` documents in its own refusal:
    //   {"venture": "<id>", "act": "offer|counter|accept|decline|assure", "text": "..."}
    // Posted one path segment wrong — which is not a hypothetical failure mode in a
    // product where, until this week, nobody could work out what @path was.
    const res = await signed(live(), agent('talker'), 'POST', PATHS.discrepancy, {
      venture: 'v-1',
      act: 'assure',
      text: 'I will pay the elective half at settlement. You have my word.',
    });

    // ══════════════════════════════════════════════════════════════════════
    // BEFORE: `text` was a whole-report alias, so this answered
    // `202 {recorded: true, note: "Thank you…"}` — an affirmative receipt for a game
    // act that never happened. `venture` and `act` went on the floor, and the words
    // went into an operator's ring buffer that no counterparty reads. In a design
    // whose best artifact is the reassuring thing the traitor said (§14, THE RECEIPT
    // REEL), a swallowed `assure` is a deleted piece of evidence.
    // ══════════════════════════════════════════════════════════════════════
    expect(res.status).toBe(400);
    expect(res.json['reason']).toBe('FIELD_MISSING');
    // And the refusal names the collision, so the agent learns where the act belongs
    // instead of merely learning that this was not it.
    const detail = String(res.json['detail']);
    expect(detail).toContain('`text` is the `message` verb');
    expect(detail).toContain('POST /act');
    expect(detail).toContain('"report"');
    // Still free: guessing the shape must not cost the report (the Gate-3 property).
    expect(detail).toContain('no rate-limit window was charged');
    // Nothing was recorded.
    expect(live().context.discrepancies).toHaveLength(0);
  });

  it('names `message` itself as a verb when that is the word the reporter reached for', async () => {
    h = await harness();
    const res = await signed(live(), agent('messenger'), 'POST', PATHS.discrepancy, {
      message: 'the settlement did not happen',
    });
    expect(res.status).toBe(400);
    // §3's MESSAGE, named as canon rather than as a typo.
    expect(String(res.json['detail'])).toContain('`message` is a VERB');
  });

  it('does not answer to `note`, which is this endpoint’s own response key', async () => {
    h = await harness();
    const first = await signed(live(), agent('echoer'), 'POST', PATHS.discrepancy, {
      report: 'the venture settled twice',
    });
    expect(first.status).toBe(202);
    const thanks = String(first.json['note']);

    // An agent that round-trips the shape it was just handed — a normal thing for a
    // client that logs a response and resends on retry — used to file our own
    // thank-you note back to us as its next report, and be thanked for it.
    const second = await signed(live(), agent('echoer-2'), 'POST', PATHS.discrepancy, { note: thanks });
    expect(second.status).toBe(400);
    expect(String(second.json['detail'])).toContain('response key');
    expect(live().context.discrepancies).toHaveLength(1);
  });

  it('still accepts every shape agent.md §13 leads a reporter to, and the one-string form', async () => {
    h = await harness();
    // The narrowing must not cost the widening. These are the shapes the Gate-3 fix
    // was for, and the highest-severity report in the game is the third one.
    const shapes: readonly [Record<string, string>, readonly string[]][] = [
      [{ expected: 'paid', happened: 'not paid' }, ['expected', 'happened']],
      [{ report: 'a venture closed with no countersignature' }, ['report']],
      [{ observed: 'a default was recorded against me and it is wrong' }, ['observed']],
      [{ detail: 'the book shows an amount and the readback says IN_FULL' }, ['detail']],
      [{ wanted: 'my elective half', instead: 'a default' }, ['wanted', 'instead']],
    ];
    for (const [body, readFrom] of shapes) {
      const res = await signed(live(), agent(`shape-${readFrom.join('-')}`), 'POST', PATHS.discrepancy, body);
      expect(res.status, JSON.stringify(body)).toBe(202);
      expect(res.json['read_from']).toEqual(readFrom);
    }
  });

  it('redacts a credential that sits across the old 400-character chunk boundary', async () => {
    h = await harness();
    // ══════════════════════════════════════════════════════════════════════
    // `scrubReport` used to slice the report into 400-character pieces and scrub each,
    // because `scrub`'s bound was hardcoded at MAX_DETAIL_LENGTH. A credential
    // straddling a boundary was split into two halves, NEITHER of which matches the
    // credential pattern — so the one function whose first rule is "remove secrets"
    // stored the secret verbatim. The pattern is first in REDACTIONS for this reason.
    //
    // A reporter pasting a config line or a curl command into a bug report is the
    // ordinary case, not the adversarial one.
    // ══════════════════════════════════════════════════════════════════════
    const secret = 'token=SUPERSECRETVALUE123456';
    // The secret is positioned to straddle character 400 exactly, which is where the
    // old chunk boundary fell.
    // 390 characters ending in a space, so the credential pattern's leading `\b` is
    // satisfied and the only thing under test is the chunk boundary.
    const prefix = 'no settlement, '.repeat(26).slice(0, 389) + ' ';
    expect(prefix).toHaveLength(390);
    const report = `${prefix}${secret} was in my config`;
    expect(report.indexOf(secret)).toBeLessThan(400);
    expect(report.indexOf(secret) + secret.length).toBeGreaterThan(400);

    const res = await signed(live(), agent('paster'), 'POST', PATHS.discrepancy, { report });
    expect(res.status).toBe(202);
    const stored = live().context.discrepancies[0]?.observed ?? '';
    expect(stored).not.toContain('SUPERSECRETVALUE123456');
    expect(stored).toContain('[redacted]');
  });

  it('does not cut an identifier in half at a chunk boundary', async () => {
    h = await harness();
    // The other half of the same defect: the pieces had to be rejoined, so every
    // boundary injected a space. `venture-v-0001-defaulted` straddling 400 came out as
    // `vent ure-v-0001-defaulted` — in the record an operator greps when an agent says
    // a default was recorded against it wrongly, which is the highest-severity report
    // in the game and the one that must survive intact.
    const id = 'venture-v-0001-defaulted-wrongly';
    let report = '';
    while (report.length < 390) report += 'padding ';
    report = `${report.slice(0, 390)}${id} and that is the whole complaint`;
    expect(report.indexOf(id)).toBeLessThan(400);
    expect(report.indexOf(id) + id.length).toBeGreaterThan(400);

    const res = await signed(live(), agent('grepper'), 'POST', PATHS.discrepancy, { report });
    expect(res.status).toBe(202);
    const stored = live().context.discrepancies[0]?.observed ?? '';
    expect(stored).toContain(id);
  });

  it('records nothing against any principal, whatever it accepts — A5′ is untouched', async () => {
    h = await harness();
    const before = live()
      .runtime.events.ticks()
      .reduce((n, t) => n + live().runtime.events.eventsAtTick(t).length, 0);
    await signed(live(), agent('reporter'), 'POST', PATHS.discrepancy, {
      report: 'p:someone-else defaulted on me and it is not recorded',
    });
    // The sensor is a sensor. Naming another principal in a report must never put a
    // line on the permanent record, or the sensor becomes a libel channel.
    const after = live()
      .runtime.events.ticks()
      .reduce((n, t) => n + live().runtime.events.eventsAtTick(t).length, 0);
    expect(after).toBe(before);
  });
});
