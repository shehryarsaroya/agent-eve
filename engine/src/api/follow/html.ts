/**
 * HTML, escaped, and the two pages a link click lands on.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **SCAR #12: AN ATTACKER-CONTROLLED NAME, INTERPOLATED UNESCAPED INTO MAIL.**
 *
 * SPEC §5: *"The handle is simultaneously the email address, the map label, the ledger key and
 * the Gazette HTML … so it is an impersonation and injection surface and is escaped
 * everywhere."* A handle is grammar-checked at enrolment, and that is not why it is safe here:
 * every dynamic string that reaches HTML in this feature goes through {@link escapeHtml}, at
 * the last moment, whatever its source. A guard that relied on the grammar would be one
 * grammar change from an injection, and `test/follow/escaping.test.ts` feeds hostile strings
 * through every template precisely so nobody has to remember which inputs are "trusted".
 * ══════════════════════════════════════════════════════════════════════════
 */

const ENTITIES: Readonly<Record<string, string>> = Object.freeze({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
});

/** Escape for text AND for a double- or single-quoted attribute value. Total, never throws. */
export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"'`]/g, (ch) => ENTITIES[ch] ?? ch);
}

/**
 * The security headers every HTML response from this feature carries.
 *
 * The confirm and unsubscribe URLs carry their token in the query string, so the page must
 * not hand that URL to anyone as a `Referer` (`no-referrer`), must not be framed and clicked
 * through (`frame-ancestors 'none'`), must not be indexed, and must not be cached by the edge.
 * nginx's own `add_header` lines do not reach these responses — its `/api/` location declares
 * one, which in nginx replaces rather than extends the server-level set — so the app sends
 * its own.
 */
export const PAGE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy':
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
});

export interface PageLink {
  readonly href: string;
  readonly text: string;
}

export interface PageContent {
  readonly title: string;
  /** Plain-text paragraphs. Escaped here; never pre-escaped by a caller. */
  readonly paragraphs: readonly string[];
  readonly links?: readonly PageLink[];
}

/**
 * A small, self-contained page in the console's palette. No script, no external resource —
 * the CSP above would refuse one anyway — so it renders identically from a mail client's
 * in-app browser and from a terminal's `curl`.
 */
export function renderPage(content: PageContent): string {
  const title = escapeHtml(content.title);
  const body = content.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n');
  const links = (content.links ?? [])
    .map((l) => `<p><a href="${escapeHtml(l.href)}">${escapeHtml(l.text)}</a></p>`)
    .join('\n');
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="referrer" content="no-referrer">',
    '<meta name="robots" content="noindex, nofollow">',
    `<title>${title} · Agent Eve</title>`,
    '<style>',
    'body{margin:0;padding:40px 18px;background:#00060a;color:#cfdadd;',
    'font:15px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}',
    'main{max-width:560px;margin:0 auto;border:1px solid #123038;background:#000d12;padding:22px 24px}',
    '.k{font-size:11px;letter-spacing:.16em;color:#6f8288;margin:0 0 10px}',
    'h1{font-size:20px;font-weight:500;margin:0 0 14px;color:#cfdadd}',
    'p{margin:0 0 12px;color:#9aa9ad}',
    'a{color:#19d7f2}',
    '</style>',
    '</head>',
    '<body>',
    '<main>',
    '<p class="k">AGENT EVE · FOLLOW BY EMAIL</p>',
    `<h1>${title}</h1>`,
    body,
    links,
    '</main>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
