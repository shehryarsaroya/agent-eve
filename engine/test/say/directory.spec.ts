/**
 * ★ **THE DIRECTORY — who is dealing near you, what they offer or seek, and their record
 * (`RULES_VERSION` 41).**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * A design review measured blind probes managing five to seven counterparties across a whole run and
 * named the cause: *no public place says who is dealing.* This file holds the answer to four claims,
 * and the fourth is the one A15 rests on:
 *
 *   1. **CONTENT** — a fresh offer, a venture still recruiting and a live role each list a principal;
 *      a principal doing none of those is not listed, however many there are.
 *   2. **ORDER** — soliciting rows first, then by record, distinct counterparties before raw count, so
 *      a fresh identity sinks below anyone with a record and the cap's `unlisted` says how many sank.
 *   3. **TIER** — every field is `PUBLIC`, and the agent's `ventures.directory` and the spectator's
 *      `directoryLines` are the same rows from the same builder (A9 by construction).
 *   4. **LISTING REACHES NOBODY** — a Sybil that gets itself listed has bought a line of text, never a
 *      channel. The reach and the price are exactly what they were without the directory.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import type { PrincipalId } from '../../src/core/types.js';
import { MAX_DIRECTORY_ROWS } from '../../src/say/directory.js';
import { act, contactWorld, entitle, liveHaul, observe, runTo, seatAt, tick, SETTLEMENT } from './contact-fixture.js';

type Row = Readonly<Record<string, unknown>>;

function directoryOf(runtime: Parameters<typeof observe>[0], reader: PrincipalId): {
  readonly rows: readonly Row[];
  readonly unlisted: number;
  readonly constellation: string;
  readonly rule: string;
} {
  const ventures = observe(runtime, reader).ventures;
  const directory = ventures['directory'] as Readonly<Record<string, unknown>>;
  return {
    rows: directory['rows'] as readonly Row[],
    unlisted: directory['unlisted'] as number,
    constellation: directory['constellation'] as string,
    rule: directory['rule'] as string,
  };
}

const READER = 'p:dreader' as PrincipalId;
const SELLER = 'p:dseller' as PrincipalId;
const RECRUITER = 'p:drecruit' as PrincipalId;
const IDLE = 'p:didle' as PrincipalId;

describe('★ 1. CONTENT — offering, seeking and at-work each list a principal; doing nothing does not', () => {
  it('lists the seller and the recruiter, and not the idle principal beside them', () => {
    const w = contactWorld('dir-content', [READER, SELLER, RECRUITER, IDLE]);
    expect(act(w.runtime, SELLER, 'publish_offer', { text: 'HANDS FOR HIRE — 8% OF CARGO' })).toBeNull();
    expect(act(w.runtime, RECRUITER, 'create', { kind: 'BUILD', stage: w.stage })).toBeNull();

    const d = directoryOf(w.runtime, READER);
    const who = d.rows.map((r) => r['principal']);
    expect(who).toContain(SELLER);
    expect(who).toContain(RECRUITER);
    expect(who, 'a principal that offers, seeks and works at nothing is not dealing').not.toContain(IDLE);
    expect(who, 'and the reader is not in its own directory — its record is on header.standing').not.toContain(READER);

    const seller = d.rows.find((r) => r['principal'] === SELLER);
    expect((seller?.['offering'] as Row | null)?.['text']).toBe('HANDS FOR HIRE — 8% OF CARGO');
    const recruiter = d.rows.find((r) => r['principal'] === RECRUITER);
    const seeking = recruiter?.['seeking'] as readonly Row[];
    expect(seeking, 'the four-role BUILD it is recruiting for').toHaveLength(1);
    expect(seeking[0]?.['kind']).toBe('BUILD');
    expect(
      (seeking[0]?.['open_roles'] as readonly string[]).length,
      'all four roles are open — the board shows a filler a slot; the directory shows who wants crew',
    ).toBe(4);
    expect(d.rule, 'the rule states the one thing listing does NOT grant').toMatch(/reaches nobody/);
  });

  it('a principal at work in a live venture is listed as at work, with live roles counted', () => {
    const PAYER = 'p:dpayer' as PrincipalId;
    const FILLER = 'p:dfiller' as PrincipalId;
    const w = contactWorld('dir-working', [READER, PAYER, FILLER]);
    liveHaul(w, PAYER, FILLER);
    const rows = directoryOf(w.runtime, READER).rows;
    const filler = rows.find((r) => r['principal'] === FILLER);
    expect(filler?.['live_roles'], 'the filler holds a role in a LIVE venture').toBe(1);
  });
});

describe('★ 2. ORDER — soliciting first, then RECORD; a fresh identity sinks and the cap counts it', () => {
  it('a principal with kept promises to distinct counterparties ranks above a crowd of fresh ones', () => {
    const PAYER = 'p:dvet' as PrincipalId;
    const FILLER = 'p:dvetfill' as PrincipalId;
    const w = contactWorld('dir-order', [READER, PAYER, FILLER]);
    liveHaul(w, PAYER, FILLER);
    runTo(w.runtime, SETTLEMENT + 1);
    expect(w.runtime.standing.row(PAYER).distinctCounterparties, 'the veteran has a record').toBe(1);

    // A crowd of fresh identities, each soliciting for free — the cheapest way to flood a list.
    const crowd: PrincipalId[] = [];
    for (let n = 0; n < MAX_DIRECTORY_ROWS + 3; n += 1) {
      const p = `p:dfresh${String(n).padStart(2, '0')}` as PrincipalId;
      seatAt(w, p, w.stage);
      crowd.push(p);
    }
    tick(w.runtime);
    for (const p of crowd) expect(act(w.runtime, p, 'publish_offer', { text: 'CHEAP HANDS' })).toBeNull();
    expect(act(w.runtime, PAYER, 'publish_offer', { text: 'VETERAN CARRIER, ONE DEFAULT IN ZERO' })).toBeNull();

    const d = directoryOf(w.runtime, READER);
    expect(d.rows, 'capped at the published limit').toHaveLength(MAX_DIRECTORY_ROWS);
    expect(d.rows[0]?.['principal'], 'the record wins the top row — free identities cannot crowd it out').toBe(PAYER);
    expect(d.unlisted, 'and the cap says how many it left off, rather than hiding them').toBeGreaterThan(0);
  });
});

describe('★ 3. TIER — PUBLIC, and the agent and the viewer read the same rows', () => {
  it('ventures.directory and the live frame\'s directoryLines agree for the reader\'s constellation', () => {
    const w = contactWorld('dir-parity', [READER, SELLER, RECRUITER]);
    expect(act(w.runtime, SELLER, 'publish_offer', { text: 'ALLOY AT 12' })).toBeNull();
    expect(act(w.runtime, RECRUITER, 'create', { kind: 'BUILD', stage: w.stage })).toBeNull();

    const agent = directoryOf(w.runtime, READER);
    const live = w.runtime.liveFrame();
    const viewer = live.directoryLines.filter((l) => l.constellation === agent.constellation);
    // The frame caps per constellation, the observation by its own limit; compare the overlap in order.
    const n = Math.min(viewer.length, agent.rows.length);
    expect(n, 'non-vacuity: both surfaces list somebody').toBeGreaterThan(0);
    for (let i = 0; i < n; i += 1) {
      expect(viewer[i]?.principal, `row ${String(i)}: one builder, one order`).toBe(agent.rows[i]?.['principal']);
    }
    for (const line of live.directoryLines) {
      for (const key of Object.keys(line)) {
        expect(key, 'no stores, cargo, hands, reach or score on a public mark').not.toMatch(
          /stores|escrow|balance|cargo|hand|reach|parley|score/i,
        );
      }
    }
  });
});

describe('★ 4. A15 — being listed reaches nobody', () => {
  it('a listed free identity can address nobody, and nobody gains an opening by reading the list', () => {
    const SYBIL = 'p:dsybil' as PrincipalId;
    const w = contactWorld('dir-a15', [READER, SYBIL]);
    expect(act(w.runtime, SYBIL, 'publish_offer', { text: 'WRITE TO ME' })).toBeNull();
    expect(
      directoryOf(w.runtime, READER).rows.map((r) => r['principal']),
      'listing is free — which is exactly why it must buy nothing',
    ).toContain(SYBIL);

    expect(w.runtime.reachFor(SYBIL, w.runtime.engine.tick), 'the sybil reaches nobody').toHaveLength(0);
    expect(act(w.runtime, SYBIL, 'message', { to: READER, act: 'offer', text: 'hello' })?.invariant).toBe('A15');

    // The unentitled READER can see the advertiser and still cannot open to it: the OFFER rung
    // makes the advertiser ADDRESSABLE, and the price of speaking first is unchanged.
    const row = directoryOf(w.runtime, READER).rows.find((r) => r['principal'] === SYBIL);
    expect((row?.['parley'] as Row | null)?.['why'], 'the row names the rung that would apply').toBe('OFFER');
    expect(act(w.runtime, READER, 'message', { to: SYBIL, act: 'offer', text: 'hi' })?.invariant).toBe('A15');
    entitle(w.runtime, READER);
    tick(w.runtime);
    expect(
      act(w.runtime, READER, 'message', { to: SYBIL, act: 'offer', text: 'hi' }),
      'once the reader has been paid, the advertisement is answerable',
    ).toBeNull();
  });
});
