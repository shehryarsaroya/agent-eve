/**
 * The spectator client's half of follow by email, checked from the engine suite because the
 * client has no build and no test runner of its own.
 *
 *   - `?v=N` is ONE number on every asset, and the doc that tells an operator to bump it
 *     quotes the same number — a stale script against a new page is the outage
 *     `client/index.html` describes in its own comment.
 *   - The form posts JSON (so the API's CSRF rule holds for it) to the relative path the
 *     frames use, and never parses the server's sentence as markup.
 *   - The paste block an agent receives is the one `FUNNEL-2026-08-01.md` calls canonical:
 *     "edit both or neither".
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const CLIENT = new URL('../../../client/', import.meta.url);
const read = (rel: string): string => readFileSync(new URL(rel, CLIENT), 'utf8');
const INDEX = read('index.html');
const FOLLOW = read('lib/follow.js');
const LANDING = read('lib/landing.js');
const SCREENS = read('lib/screens.js');

describe('the client loads the follow form, on one asset version', () => {
  it('every asset carries the same ?v=, and it is 43', () => {
    const versions = [...INDEX.matchAll(/\?v=(\d+)/g)].map((m) => m[1]);
    expect(versions.length).toBeGreaterThanOrEqual(8);
    // 42: the frames fixes changed `app.js`, `lib/screens.js` and `lib/mapview.js` (the genesis map,
    // the ticker read newest first, the authority cells on both limits).
    // 43: the SIGNER line (`lib/ui.js`, `lib/landing.js`, `lib/screens.js`, `app.css`).
    expect(new Set(versions)).toEqual(new Set(['43']));
    const infra = readFileSync(new URL('../../../docs/background/INFRA.md', import.meta.url), 'utf8');
    expect(infra).toContain('?v=43');
    // Season 1's four lanes each pre-assigned their own number (35, 35, 40) on top of master's 34;
    // the merge took one, and none of the others may survive in the doc an operator reads.
    for (const stale of ['?v=34', '?v=35', '?v=40', '?v=41', '?v=42']) expect(infra).not.toContain(stale);
  });

  it('follow.js loads after ui.js (it uses U) and before both screens that mount it', () => {
    const at = (name: string): number => INDEX.indexOf(`src="lib/${name}?v=`);
    expect(at('follow.js')).toBeGreaterThan(at('ui.js'));
    expect(at('follow.js')).toBeLessThan(at('screens.js'));
    expect(at('follow.js')).toBeLessThan(at('landing.js'));
    expect(LANDING).toContain('FollowForm.mount(root, h)');
    expect(SCREENS).toContain('FollowForm.mount(followHost, r.handle)');
  });

  it('posts JSON to the relative api/follow and shows the server sentence as TEXT', () => {
    expect(FOLLOW).toContain("var API = 'api/follow'");
    expect(FOLLOW).toMatch(/'content-type': 'application\/json'/);
    expect(FOLLOW).toContain('JSON.stringify({ handle: e.handle, email: email })');
    expect(FOLLOW).toContain('e.note.textContent = text');
    expect(FOLLOW).not.toMatch(/innerHTML|\bhtml:/);
  });
});

describe('★ both public-record pages disclose the SIGNER, drawn one way (SPEC §3, owner decisions 1 and 2)', () => {
  const UI = read('lib/ui.js');

  it('one helper draws it, with the hosted line as the owner decisions ask', () => {
    expect(UI).toContain('function signerLine(signer)');
    expect(UI).toContain("'SIGNED BY AGENT EVE \\u00b7 played from chat'");
    expect(UI).toContain("'SIGNED BY ITS OWN KEY'");
    expect(UI).toContain('signerLine: signerLine');
    // Text, never markup: the line is fixed wording, and nothing a principal wrote reaches it.
    expect(UI).not.toMatch(/signerLine[\s\S]{0,1200}html:/);
  });

  it('#/agent/<handle> reads it from the standing row, else the live dealing mark; the PRINCIPALS dossier from its row', () => {
    expect(LANDING).toContain('U.signerLine(signer)');
    expect(LANDING).toMatch(/row && row\.signer !== undefined \? row\.signer : \(mark \? mark\.signer : undefined\)/);
    expect(LANDING).toContain('(D.directory || []).filter(function (d) { return is(d.principal); })[0]');
    expect(SCREENS).toContain('U.signerLine(r.signer)');
  });
});

describe('the paste block is the canonical one', () => {
  it("its last line — the one that closes the loop for the human — matches FUNNEL-2026-08-01.md", () => {
    const funnel = readFileSync(new URL('../../../docs/design/FUNNEL-2026-08-01.md', import.meta.url), 'utf8');
    const block = /## THE PASTE BLOCK[\s\S]*?```\n([\s\S]*?)\n```/.exec(funnel)?.[1] ?? '';
    const funnelLast = block.split('\n').filter((l) => l.trim().length > 0).at(-1) ?? '';
    // The source line is `'…at ' + ORIGIN + '/#/agent/…',` — rendered here the way the
    // browser will: the ORIGIN spliced in, the \u escapes resolved, the quotes dropped.
    const source = LANDING.split('\n').find((l) => l.includes('The human who sent you this'))?.trim() ?? '';
    const rendered = source
      .replace(/,$/, '')
      .replace(/^'|'$/g, '')
      .replace("' + ORIGIN + '", 'https://agenteve.io')
      .replace(/\\u2014/g, '—');
    expect(funnelLast.length).toBeGreaterThan(40);
    expect(rendered).toBe(funnelLast);
    expect(funnelLast).toContain('follow it there by email');
    expect(funnelLast).not.toContain('Email delivery is not enabled');
  });
});
