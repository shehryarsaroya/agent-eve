/**
 * Scar #12, as a test: an attacker-controlled name, interpolated UNESCAPED into real mail.
 *
 * The handle grammar would stop most of these at enrolment, and that is exactly why the test
 * does not lean on it: every template is fed hostile strings directly — as handles, place
 * names, deed sentences and docket lines on a frame — and the HTML that comes out must carry
 * them only as inert text. A guard that relied on the grammar would be one grammar change
 * from an injection.
 */

import { describe, expect, it } from 'vitest';
import type { PrincipalId } from '../../src/core/types.js';
import {
  buildRecap,
  composeConfirmation,
  composeRecap,
  escapeHtml,
  followLinks,
  renderPage,
} from '../../src/api/follow/index.js';
import { frame, standing } from './helpers.js';

const HOSTILE = [
  '<script>alert(1)</script>',
  '"><img src=x onerror=alert(1)>',
  "'><svg onload=alert(1)>",
  '`${x}`',
  '&lt;already&gt;',
  '</p><a href="javascript:alert(1)">click</a>',
] as const;

/** The only tags our templates emit. Anything else in the output was smuggled in. */
const OUR_TAGS = new Set(['html', 'head', 'meta', 'title', 'style', 'body', 'main', 'div', 'p', 'h1', 'a', 'hr']);

/**
 * No tag, attribute or URL from any hostile string survives as MARKUP. The words may appear —
 * as escaped text, which is the point — so the check is on the tags actually present.
 */
function assertInert(html: string): void {
  for (const tag of html.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g)) {
    const [whole, name = '', attrs = ''] = tag;
    expect(OUR_TAGS.has(name.toLowerCase()), whole).toBe(true);
    expect(attrs, whole).not.toMatch(/\son\w+\s*=/i);
    expect(attrs, whole).not.toMatch(/javascript:/i);
  }
  // The only anchors are ours, and every href is an https URL we built.
  for (const m of html.matchAll(/href="([^"]*)"/g)) expect(m[1]).toMatch(/^https:\/\/agenteve\.io\//);
  // And no raw script, however it was spelled.
  expect(html).not.toMatch(/<script/i);
}

describe('escapeHtml', () => {
  it('escapes every character that can open markup or close an attribute', () => {
    expect(escapeHtml(`<a href="x" title='y'>&\`</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&#96;&lt;/a&gt;',
    );
  });

  it('is total: it stringifies anything and never throws', () => {
    for (const v of [undefined, null, 1, {}, [], Symbol.for('s').description]) expect(() => escapeHtml(v)).not.toThrow();
  });
});

describe('every template carries a hostile string only as text', () => {
  const links = followLinks('https://agenteve.io');

  it.each(HOSTILE)('the confirmation email, with handle %s', (h) => {
    const mail = composeConfirmation({ handle: h, confirmUrl: links.confirm('T'.repeat(43)), recordUrl: links.record(h), validDays: 7 });
    assertInert(mail.html);
    expect(mail.html).toContain(escapeHtml(h));
    // The record link encodes the handle into the URL rather than splicing it.
    expect(mail.html).toContain(`#/agent/${escapeHtml(encodeURIComponent(h))}`);
  });

  it.each(HOSTILE)('a recap, with %s as the handle, a place, a deed and a docket line', (s) => {
    const pid = `p:${s}` as PrincipalId;
    const f = frame(3, {
      standings: [standing(s, { principal: pid, electiveHonoured: 2, electiveHonouredValue: 900 as never })],
      map: [{ id: 'sys-1', name: s, tier: 'COMMONS', constellation: 'con-1', lanes: [], straits: [], yieldPerTick: 0, fuelPerTick: 0, richnessBps: 0 }] as never,
      rundown: [
        {
          order: 1,
          kind: 'SETTLEMENT',
          subject: 'v-1',
          venture: 'v-1',
          cast: [{ principal: pid, handle: s, line: s, modelBadge: null }],
          publicLine: null,
          sealVerdict: null,
          deed: `${s}'s 4K was riding on ${s}.`,
          glyph: null,
          consequence: s,
          receiptReel: null,
          grant: null,
          actedBy: null,
          onBehalfOf: null,
        },
      ] as never,
      raidLines: [
        { raid: 'r-1', stage: 'sys-1', target: pid, initiator: null, demand: 5, state: 'DEMANDED', lost: 0, raiderForce: 1, defenderForce: 0, ticksLeft: 3, defenders: [], raiders: [] },
      ] as never,
      nextDocket: [{ venture: 'v-2', headline: s, tension: s, atStake: 1, electiveBps: 0, cast: [{ principal: pid, handle: s, line: s, modelBadge: null }], grant: null }] as never,
    });
    const prev = frame(2, { standings: [standing(s, { principal: pid })] });
    const recap = buildRecap({ frame: f, previous: prev, handle: s });
    const mail = composeRecap(recap, { recordUrl: links.record(s), unsubscribeUrl: links.unsubscribe('U'.repeat(43)) });
    assertInert(mail.html);
    // It reached the email — as text.
    expect(mail.html).toContain(escapeHtml(s));
    // And the RFC 8058 header pair is exactly the two strings we built.
    expect(mail.headers['List-Unsubscribe']).toBe(`<${links.unsubscribe('U'.repeat(43))}>`);
    expect(mail.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    // A subject is a header: no line break, whatever the handle was.
    expect(mail.subject).not.toMatch(/[\r\n]/);
  });

  it.each(HOSTILE)('the confirm/unsubscribe landing page, with %s', (s) => {
    const html = renderPage({ title: `You follow ${s}`, paragraphs: [s, `${s}'s record`], links: [{ href: links.record(s), text: s }] });
    assertInert(html);
    expect(html).toContain(escapeHtml(s));
  });
});
