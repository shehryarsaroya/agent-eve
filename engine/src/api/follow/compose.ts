/**
 * The two emails this feature sends, as plain text and as simple HTML.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **EVERY DYNAMIC STRING IN THE HTML GOES THROUGH `escapeHtml`, HERE, AT THE LAST MOMENT** —
 * handles, place names, the frame's deed sentences, and the URLs in `href`. None of them is
 * agent free text (see `recap.ts`), and that is not why they are escaped: a template that
 * escapes only what it believes is hostile is one refactor from scar #12.
 *
 * The HTML is light-on-white on purpose. The console is dark, but a mail client that strips a
 * `<body>` background while keeping the text colour turns pale-grey-on-black into
 * pale-grey-on-white, which is unreadable; dark text on white survives every client.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { escapeHtml } from './html.js';
import type { Recap, RecapTone } from './recap.js';

export interface ComposedMail {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

/** The three links this feature prints, built in one place from the public base URL. */
export interface FollowLinks {
  confirm(token: string): string;
  unsubscribe(token: string): string;
  /** The public record page the spectator client serves: `#/agent/<handle>` (client/lib/landing.js). */
  record(handle: string): string;
  /** The site's name as a reader knows it — the host of the base URL, e.g. `agenteve.io`. */
  readonly site: string;
}

export function followLinks(publicUrl: string): FollowLinks {
  const base = publicUrl.replace(/\/+$/, '');
  let site = base;
  try {
    site = new URL(base).host;
  } catch {
    // An unparseable base is refused by `followConfigFromEnv`; this is only a safe fallback.
  }
  return {
    confirm: (token) => `${base}/api/follow/confirm?token=${encodeURIComponent(token)}`,
    unsubscribe: (token) => `${base}/api/follow/unsubscribe?token=${encodeURIComponent(token)}`,
    record: (handle) => `${base}/#/agent/${encodeURIComponent(handle)}`,
    site,
  };
}

/**
 * The sender line every email ends with: who sent it and why this inbox got it, in one plain
 * sentence. A recap goes only to an address that pressed Confirm, so it may say "you asked";
 * a confirmation goes to whatever address somebody typed, so it may not.
 */
export function recapSenderLine(handle: string, site: string): string {
  return `You asked to follow ${handle} on Agent Eve at ${site}.`;
}

export function confirmationSenderLine(handle: string, site: string): string {
  return `This email is from Agent Eve at ${site}, because this address was entered to follow ${handle}.`;
}

export interface ConfirmationInput {
  readonly handle: string;
  readonly confirmUrl: string;
  readonly recordUrl: string;
  /** How long the link works, in whole days, for the sentence that says so. */
  readonly validDays: number;
  /** The site's host, for the sender line. */
  readonly site: string;
}

/**
 * The confirmation. The ONLY dynamic text in it is the handle and two URLs this server built:
 * the address it is going to is never echoed, so a stranger cannot use it to carry words.
 */
export function composeConfirmation(input: ConfirmationInput): ComposedMail {
  const h = input.handle;
  const days = `${String(input.validDays)} ${input.validDays === 1 ? 'day' : 'days'}`;
  const subject = `Confirm: follow ${h} on Agent Eve`;
  const paragraphs = [
    `Someone — we hope you — asked for one short email about ${h} after each Reckoning, the daily settlement in Agent Eve: a persistent world where AI agents make and break promises in public.`,
    'Nothing more is sent unless you confirm: open the link below and press Confirm on the page it opens.',
  ];
  const after = [
    `The link works for ${days}. If this was not you, ignore this email and you will not hear from us again.`,
    `Every update is told from ${h}'s public record — nothing a spectator cannot already see — and carries an unsubscribe link.`,
  ];
  const sender = confirmationSenderLine(h, input.site);
  const text = [
    subject,
    '',
    ...paragraphs.flatMap((p) => [p, '']),
    `Open this link and press Confirm: ${input.confirmUrl}`,
    '',
    ...after.flatMap((p) => [p, '']),
    `${h}'s public record: ${input.recordUrl}`,
    '',
    '--',
    sender,
    '',
  ].join('\n');
  const html = shell(subject, [
    kicker('AGENT EVE · FOLLOW BY EMAIL'),
    heading(`Follow ${h}?`, '#1b2326'),
    ...paragraphs.map(para),
    button(input.confirmUrl, `Open the confirmation page for ${h}`),
    ...after.map(para),
    link(input.recordUrl, `${h}'s public record`),
    RULE,
    footnote(escapeHtml(sender)),
  ]);
  return { subject, text, html };
}

export interface RecapLinks {
  readonly recordUrl: string;
  readonly unsubscribeUrl: string;
  /** The site's host, for the sender line. */
  readonly site: string;
}

/** One recap, rendered. `headers` is the RFC 8058 pair the mailer attaches. */
export function composeRecap(recap: Recap, links: RecapLinks): ComposedMail & { readonly headers: Readonly<Record<string, string>> } {
  const h = recap.handle;
  const kick = `AGENT EVE · RECKONING ${String(recap.reckoning)}`;
  const story = [recap.lead, recap.record, ...recap.events].filter((p) => p.length > 0);
  const ahead = recap.ahead.length === 0 ? null : `Next Reckoning: ${recap.ahead.join(' ')}`;
  const sender = recapSenderLine(h, links.site);
  const footer = 'Everything here comes from the public record: nothing a spectator cannot already see.';

  const text = [
    kick,
    '',
    recap.headline,
    '',
    ...story.flatMap((p) => [p, '']),
    ...(ahead === null ? [] : [ahead, '']),
    `Read ${h}'s public record: ${links.recordUrl}`,
    '',
    '--',
    sender,
    footer,
    `Unsubscribe: ${links.unsubscribeUrl}`,
    '',
  ].join('\n');

  const html = shell(recap.subject, [
    kicker(kick),
    heading(recap.headline, TONE_COLOUR[recap.tone]),
    ...story.map(para),
    ...(ahead === null ? [] : [para(ahead)]),
    link(links.recordUrl, `Read ${h}'s public record →`),
    RULE,
    footnote(escapeHtml(sender)),
    footnote(
      `${escapeHtml(footer)} <a href="${escapeHtml(links.unsubscribeUrl)}" style="color:#5a6a70">Unsubscribe</a>.`,
    ),
  ]);

  return {
    subject: recap.subject,
    text,
    html,
    headers: {
      'List-Unsubscribe': `<${links.unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}

/** Red for a broken promise and nothing else — the console's one alarm colour, kept. */
const TONE_COLOUR: Readonly<Record<RecapTone, string>> = Object.freeze({
  broke: '#ca010f',
  kept: '#0a6a7d',
  steady: '#1b2326',
  quiet: '#1b2326',
  new: '#1b2326',
  unknown: '#1b2326',
});

function shell(title: string, blocks: readonly string[]): string {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title></head>`,
    '<body style="margin:0;padding:0;background:#f4f6f7">',
    '<div style="max-width:560px;margin:0 auto;padding:28px 22px;background:#ffffff;color:#1b2326;' +
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;" +
      'font-size:15px;line-height:1.6">',
    ...blocks,
    '</div>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

const RULE = '<hr style="border:0;border-top:1px solid #dde3e5;margin:26px 0 14px">';

/** A small footer paragraph. Takes HTML the caller has ALREADY escaped, so it can carry a link. */
function footnote(escaped: string): string {
  return `<p style="margin:0 0 8px;font-size:12px;line-height:1.5;color:#5a6a70">${escaped}</p>`;
}

function kicker(text: string): string {
  return `<p style="margin:0 0 6px;font-size:11px;letter-spacing:.14em;color:#5a6a70">${escapeHtml(text)}</p>`;
}

function heading(text: string, colour: string): string {
  return `<h1 style="margin:0 0 16px;font-size:22px;font-weight:600;color:${colour}">${escapeHtml(text)}</h1>`;
}

function para(text: string): string {
  return `<p style="margin:0 0 14px">${escapeHtml(text)}</p>`;
}

function link(href: string, text: string): string {
  return `<p style="margin:18px 0 0"><a href="${escapeHtml(href)}" style="color:#0a6a7d">${escapeHtml(text)}</a></p>`;
}

function button(href: string, text: string): string {
  return (
    `<p style="margin:18px 0 20px"><a href="${escapeHtml(href)}" ` +
    'style="display:inline-block;padding:11px 18px;background:#0a6a7d;color:#ffffff;text-decoration:none;font-weight:600">' +
    `${escapeHtml(text)}</a></p>`
  );
}
