/**
 * The follow routes: one JSON endpoint, and two links that open a page with one button.
 *
 *   POST /api/follow                      {handle, email} JSON  -> 202, the same body every time
 *   GET  /api/follow/confirm?token=...    a page with a Confirm button — CHANGES NOTHING
 *   POST /api/follow/confirm              token=... (form)      -> PENDING -> ACTIVE, idempotent
 *   GET  /api/follow/unsubscribe?token=.. a page with an Unsubscribe button — CHANGES NOTHING
 *   POST /api/follow/unsubscribe          token=... (form), or RFC 8058's one-click from a mail
 *                                         client (token in the URL) -> UNSUBSCRIBED, idempotent
 *
 * ══════════════════════════════════════════════════════════════════════════
 * Five properties, each the reason for some code below:
 *
 *   1. **No enumeration.** Every refusal `POST /api/follow` can give is about the request or
 *      the caller — shape, IP bucket, an unknown (public) handle, the global ceiling, a full
 *      queue — and never about the address. Whatever the address's state, a valid request
 *      gets `202` with identical bytes, and the work that depends on the state happens after
 *      the response (see `service.ts`). The link pages say the same for any token that
 *      verifies, whatever the follow's state; only "invalid or expired" differs.
 *   2. **A GET is not consent.** Corporate mail scanners open every link in every email. If
 *      opening the confirm link confirmed, anyone could subscribe a stranger's address and the
 *      stranger's own scanner would complete the double opt-in. So a GET renders a page that
 *      names the handle and carries one button; only that button's POST acts. The same for
 *      unsubscribe, where a scanner would otherwise unsubscribe people who never asked to stop.
 *   3. **A HEAD is not a click either.** Express answers HEAD with the GET handler unless told
 *      otherwise, and prefetchers send HEAD. Both links get a HEAD handler that does nothing.
 *   4. **No cross-site form can reach `POST /api/follow`.** It reads only
 *      `Content-Type: application/json`: an HTML form cannot send that type, and a script on
 *      another origin that does must pass a CORS preflight this API never grants. The two link
 *      POSTs DO take a form (`application/x-www-form-urlencoded`, which is what their own page
 *      sends) — safe because the token in the body is the whole capability, and nothing here
 *      sets or reads a cookie, so there is no ambient authority for another page to ride.
 *   5. **RFC 8058 keeps working exactly as before.** A mail client's one-click POST carries the
 *      token in the List-Unsubscribe URL and `List-Unsubscribe=One-Click` as a body that RFC 8058
 *      says SHOULD be `multipart/form-data` — so the unsubscribe POST takes the token from the
 *      form body when there is one and from the URL otherwise, whatever the body's type. That
 *      POST is the scanner-safe path: it is what a mail client's own Unsubscribe button sends.
 *
 * The routes are always mounted, even with mail off. A link already in someone's inbox must
 * keep working — above all the unsubscribe link — whatever the operator has since switched
 * off, and a client must be told "this is switched off" rather than "no such route".
 * ══════════════════════════════════════════════════════════════════════════
 */

import express, { type Request, type Response, type Router } from 'express';
import { clientAddress, FOLLOW_CONFIRM_TTL_MS, MAX_BODY_BYTES, MS_PER_UTC_DAY } from '../limits.js';
import { HANDLE_GRAMMAR, MAX_HANDLE_LENGTH } from '../seats.js';
import { WIRE_REASON, parseBody, refusal, type WireRefusal } from '../wire.js';
import { IDENTITY_LABEL_DOMAINS, normaliseEmail } from './email.js';
import { PAGE_HEADERS, renderPage, type PageContent } from './html.js';
import type { ConfirmOutcome, FollowService, UnsubscribeOutcome } from './service.js';

/** What the routes need to know about the running world, and nothing more. */
export interface FollowWorld {
  /** Does this handle name a principal in the running world? Handles are public (§3). */
  readonly principalExists: (handle: string) => boolean;
  /** The Reckoning that most recently settled, or null before the first. */
  readonly latestSettledReckoning: () => number | null;
  /** Wall-clock milliseconds until the next Reckoning settles, for the confirm page. */
  readonly msUntilNextReckoning: () => number;
}

export interface FollowRouterOptions {
  /** Null: no follow store at all. Every route still answers, and says so. */
  readonly service: FollowService | null;
  readonly world: FollowWorld;
  /** True behind Cloudflare, exactly as for the rest of the API (SEC-5). */
  readonly trustEdge: boolean;
}

/** The route paths, relative to the API mount. Exported so the 404 enumeration cannot drift. */
export const FOLLOW_PATHS = {
  follow: '/follow',
  confirm: '/follow/confirm',
  unsubscribe: '/follow/unsubscribe',
} as const;

export function followRouter(options: FollowRouterOptions): Router {
  const router = express.Router();
  const refusedDomains = options.service?.refusedDomains ?? IDENTITY_LABEL_DOMAINS;

  router.post(FOLLOW_PATHS.follow, (req, res) => {
    void postFollow(req, res);
  });

  // HEAD first: registered before GET so a prefetcher's HEAD never reaches even the page.
  router.head(FOLLOW_PATHS.confirm, (_req, res) => {
    res.status(200).set(PAGE_HEADERS).end();
  });
  router.head(FOLLOW_PATHS.unsubscribe, (_req, res) => {
    res.status(200).set(PAGE_HEADERS).end();
  });
  // GET: read, never act. A page naming the handle, with one button.
  router.get(FOLLOW_PATHS.confirm, (req, res) => {
    void showLink(req, res, 'confirm');
  });
  router.get(FOLLOW_PATHS.unsubscribe, (req, res) => {
    void showLink(req, res, 'unsubscribe');
  });
  // POST: the button, and for unsubscribe also RFC 8058's one-click from a mail client.
  router.post(FOLLOW_PATHS.confirm, (req, res) => {
    void actOnLink(req, res, 'confirm');
  });
  router.post(FOLLOW_PATHS.unsubscribe, (req, res) => {
    void actOnLink(req, res, 'unsubscribe');
  });

  return router;

  async function postFollow(req: Request, res: Response): Promise<void> {
    try {
      const service = options.service;
      if (service === null || !service.sending) {
        sendJson(
          res,
          503,
          refusal(
            WIRE_REASON.FOLLOW_DISABLED,
            `follow by email is switched off on this world: ${service?.offReason ?? 'it has no follow store.'} ` +
              'Nothing was stored and nothing was sent. The public record is still readable at /#/agent/<handle>.',
          ),
        );
        return;
      }
      const ip = callerOf(req, res, 'json');
      if (ip === null) return;
      if (!isJsonRequest(req)) {
        sendJson(
          res,
          415,
          uncharged(
            refusal(
              WIRE_REASON.CONTENT_TYPE_UNSUPPORTED,
              'send Content-Type: application/json with a body of {"handle": "...", "email": "..."}.',
            ),
          ),
        );
        return;
      }
      const parsed = parseBody(bytesOf(req), MAX_BODY_BYTES);
      if (!parsed.ok) {
        sendJson(res, 400, uncharged(parsed.refusal));
        return;
      }
      const handle = readHandle(parsed.value.json['handle']);
      if (!handle.ok) {
        sendJson(res, 400, uncharged(refusal(WIRE_REASON.FIELD_MALFORMED, handle.detail)));
        return;
      }
      const email = normaliseEmail(parsed.value.json['email'], refusedDomains);
      if (!email.ok) {
        sendJson(res, 400, uncharged(refusal(WIRE_REASON.FIELD_MALFORMED, email.detail)));
        return;
      }

      // Everything past here reads state, so everything past here is metered — the handle
      // lookup included, for the reason `/enroll` meters it.
      const gate = service.admitIp(ip);
      if (!gate.allowed) {
        res.setHeader('Retry-After', String(gate.retryAfterSeconds));
        sendJson(
          res,
          429,
          refusal(
            WIRE_REASON.RATE_LIMITED,
            `too many follow requests from this address; retry in ${String(gate.retryAfterSeconds)}s. ` +
              'A malformed request is never charged; this one reached the store.',
          ),
        );
        return;
      }
      if (!options.world.principalExists(handle.value)) {
        sendJson(
          res,
          404,
          refusal(
            WIRE_REASON.NOT_ENROLLED,
            `no principal has the handle '${handle.value}' in this world. Every handle is public: ` +
              'the standings on the console list them all.',
          ),
        );
        return;
      }
      if (!(await service.ceilingHasRoom())) {
        res.setHeader('Retry-After', String(service.ceilingRetryAfterSeconds()));
        sendJson(
          res,
          503,
          refusal(
            WIRE_REASON.MAIL_CEILING,
            "this world has sent today's whole allowance of email, which protects strangers' inboxes " +
              'and the sending domain. It resets at 00:00 UTC; ask again after that.',
          ),
        );
        return;
      }
      if (!service.request(handle.value, email.value)) {
        res.setHeader('Retry-After', '30');
        sendJson(
          res,
          503,
          refusal(WIRE_REASON.RATE_LIMITED, 'the follow queue is full right now; try again in a minute.'),
        );
        return;
      }
      // ── THE ONE RESPONSE ─────────────────────────────────────────────────
      //
      // Identical for a new address, a pending one, one that already follows, one that
      // unsubscribed and one a per-address bucket silently refused. Echoing the address back
      // would add nothing the caller does not have; leaving it out keeps the bytes identical.
      sendJson(res, 202, {
        ok: true,
        handle: handle.value,
        detail:
          `If that address can receive mail, a confirmation link for ${handle.value} is on its way. ` +
          'Nothing else is sent until the link is opened and Confirm is pressed, and every update carries an unsubscribe link. ' +
          'This answer is the same whether or not the address already follows anyone.',
        record: service.links.record(handle.value),
      });
    } catch {
      if (!res.headersSent) sendJson(res, 500, refusal(WIRE_REASON.INTERNAL, 'the request could not be processed. Nothing was sent.'));
    }
  }

  /**
   * Admit a link request: the caller's address, the follow store, the IP bucket. Returns the
   * service, or null when it has already answered with a page.
   */
  function admitLink(req: Request, res: Response): FollowService | null {
    const ip = callerOf(req, res, 'html');
    if (ip === null) return null;
    const service = options.service;
    if (service === null) {
      sendPage(res, 503, {
        title: 'Not available',
        paragraphs: ['Follow by email is not available on this world right now. Nothing was changed.'],
      });
      return null;
    }
    const gate = service.admitLink(ip);
    if (!gate.allowed) {
      res.setHeader('Retry-After', String(gate.retryAfterSeconds));
      sendPage(res, 429, {
        title: 'Too many requests',
        paragraphs: [`Please try this link again in ${String(gate.retryAfterSeconds)} seconds. Nothing was changed.`],
      });
      return null;
    }
    return service;
  }

  /** The GET: what the link names, and one button. Never a state change. */
  async function showLink(req: Request, res: Response, which: 'confirm' | 'unsubscribe'): Promise<void> {
    try {
      const service = admitLink(req, res);
      if (service === null) return;
      const raw: unknown = req.query['token'];
      const token = typeof raw === 'string' ? raw : null;
      const seen = which === 'confirm' ? await service.inspectConfirm(token) : await service.inspectUnsubscribe(token);
      if (seen.kind === 'invalid-link' || token === null) {
        sendPage(res, 404, invalidLinkPage());
        return;
      }
      const h = seen.handle;
      const record = { href: service.links.record(h), text: `${h}'s public record` };
      sendPage(
        res,
        200,
        which === 'confirm'
          ? {
              title: `Follow ${h}?`,
              paragraphs: [
                `Press Confirm to get one short email about ${h} after each Reckoning, told from its public record.`,
                'Nothing changes until you press it. If you did not ask for this, close this page and nothing more will be sent.',
              ],
              form: { action: 'confirm', token, button: 'Confirm' },
              links: [record],
            }
          : {
              title: `Unsubscribe from ${h}?`,
              paragraphs: [
                `Press Unsubscribe and no more email about ${h} will be sent to this address.`,
                'Nothing changes until you press it.',
              ],
              form: { action: 'unsubscribe', token, button: 'Unsubscribe' },
              links: [record],
            },
      );
    } catch {
      if (!res.headersSent) sendPage(res, 500, brokenPage());
    }
  }

  /** The POST: the button on that page — and, for unsubscribe, RFC 8058's one-click. */
  async function actOnLink(req: Request, res: Response, which: 'confirm' | 'unsubscribe'): Promise<void> {
    try {
      const service = admitLink(req, res);
      if (service === null) return;
      const form = isFormRequest(req) ? formFields(req) : null;
      if (which === 'confirm') {
        // Only the page's own form confirms, and it always sends this type. Anything else is not
        // a person pressing the button.
        if (form === null) {
          sendPage(res, 415, {
            title: 'Open the link from your email',
            paragraphs: ['Confirming takes the button on the page your confirmation link opens. Nothing was changed.'],
          });
          return;
        }
        const outcome = await service.confirm(form.get('token'), options.world.latestSettledReckoning());
        const page = confirmPage(outcome, service, options.world.msUntilNextReckoning());
        sendPage(res, page.status, page.content);
        return;
      }
      // Unsubscribe: the form's token when the page sent one, else the token in the URL — which
      // is where RFC 8058 puts it, whatever type its one-click body is.
      const fromForm = form?.get('token') ?? null;
      const raw: unknown = req.query['token'];
      const token = fromForm !== null && fromForm.length > 0 ? fromForm : typeof raw === 'string' ? raw : null;
      const page = unsubscribePage(await service.unsubscribe(token), service);
      sendPage(res, page.status, page.content);
    } catch {
      if (!res.headersSent) sendPage(res, 500, brokenPage());
    }
  }

  function callerOf(req: Request, res: Response, shape: 'json' | 'html'): string | null {
    const address = clientAddress(req.headers, req.socket.remoteAddress, { trustEdge: options.trustEdge });
    if (address.ok) return address.value.ip;
    if (shape === 'json') {
      sendJson(res, 400, refusal(WIRE_REASON.CLIENT_IP_UNVERIFIED, `${address.reason}: ${address.detail}`));
    } else {
      sendPage(res, 400, { title: 'Request refused', paragraphs: ['This request did not arrive through the site. Nothing was changed.'] });
    }
    return null;
  }
}

// ── The pages ───────────────────────────────────────────────────────────────

function confirmPage(
  outcome: ConfirmOutcome,
  service: FollowService,
  msUntilNext: number,
): { readonly status: number; readonly content: PageContent } {
  if (outcome.kind === 'unknown-link') return { status: 404, content: invalidLinkPage() };
  const h = outcome.handle;
  const record = { href: service.links.record(h), text: `${h}'s public record` };
  switch (outcome.kind) {
    case 'confirmed':
      return {
        status: 200,
        content: {
          title: `You follow ${h}`,
          paragraphs: [
            `One short email about ${h} will arrive after each Reckoning, told from its public record.`,
            `The next Reckoning settles in ${aboutDuration(msUntilNext)}.`,
            'Every email carries an unsubscribe link.',
          ],
          links: [record],
        },
      };
    case 'already-following':
      return {
        status: 200,
        content: {
          title: `You already follow ${h}`,
          paragraphs: ['Nothing has changed. The next update arrives after the next Reckoning settles.'],
          links: [record],
        },
      };
    case 'unsubscribed-earlier':
      return {
        status: 409,
        content: {
          title: 'This link is from before you unsubscribed',
          paragraphs: [
            `You unsubscribed from ${h}, so this older confirmation link no longer starts a follow.`,
            `To follow ${h} again, ask from its page and a fresh link will arrive.`,
          ],
          links: [record],
        },
      };
    case 'link-expired':
      return {
        status: 410,
        content: {
          title: 'This link has expired',
          paragraphs: [
            `Confirmation links work for ${String(Math.round(FOLLOW_CONFIRM_TTL_MS / MS_PER_UTC_DAY))} days. ` +
              `Ask again from ${h}'s page and a fresh one will arrive.`,
          ],
          links: [record],
        },
      };
    case 'follow-cap':
      return {
        status: 409,
        content: {
          title: 'This address follows as many as it may',
          paragraphs: [
            `This address already follows ${String(outcome.max)} principals, the most one address may.`,
            'Unsubscribe from one (every update has the link), then open this confirmation link again.',
          ],
          links: [record],
        },
      };
  }
}

function unsubscribePage(
  outcome: UnsubscribeOutcome,
  service: FollowService,
): { readonly status: number; readonly content: PageContent } {
  switch (outcome.kind) {
    case 'unknown-link':
      return { status: 404, content: invalidLinkPage() };
    case 'unsubscribed':
    case 'already-unsubscribed':
      return {
        status: 200,
        content: {
          title: `You have unsubscribed from ${outcome.handle}`,
          paragraphs: [
            outcome.kind === 'unsubscribed'
              ? `No more email about ${outcome.handle} will be sent to this address.`
              : `You had already unsubscribed: no email about ${outcome.handle} goes to this address.`,
            'Changed your mind? You can follow again from its page.',
          ],
          links: [{ href: service.links.record(outcome.handle), text: `${outcome.handle}'s public record` }],
        },
      };
  }
}

/** The one page any token that does not verify gets — unknown, replaced, or past its window. */
function invalidLinkPage(): PageContent {
  return {
    title: 'This link is invalid or expired',
    paragraphs: [
      'It may have been replaced by a newer email, copied incompletely, or be past its seven days. Nothing was changed.',
      'If updates keep arriving, use the unsubscribe link in the newest one.',
    ],
  };
}

function brokenPage(): PageContent {
  return {
    title: 'Something went wrong',
    paragraphs: ['This link could not be processed just now. Nothing was changed; please try it again later.'],
  };
}

/** `application/x-www-form-urlencoded` — what a browser form sends, and RFC 8058 MAY send. */
function isFormRequest(req: Request): boolean {
  const type = req.headers['content-type'];
  return typeof type === 'string' && /^application\/x-www-form-urlencoded(?:\s*;|$)/i.test(type.trim());
}

/** A form body's fields. Bounded by the router's 64 KB body cap; a malformed body is an empty one. */
function formFields(req: Request): URLSearchParams {
  try {
    return new URLSearchParams(Buffer.from(bytesOf(req)).toString('utf8'));
  } catch {
    return new URLSearchParams();
  }
}

/** "about 3 hours". Rounded generously: it is a sentence on a page, not a countdown. */
export function aboutDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 90) return `about ${String(minutes)} ${minutes === 1 ? 'minute' : 'minutes'}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `about ${String(hours)} hours`;
  return `about ${String(Math.round(hours / 24))} days`;
}

// ── Plumbing ────────────────────────────────────────────────────────────────

/** A handle as people type it: `vale`, `Vale`, `@vale` or `p:vale` all mean `vale`. */
function readHandle(raw: unknown): { readonly ok: true; readonly value: string } | { readonly ok: false; readonly detail: string } {
  if (typeof raw !== 'string') return { ok: false, detail: "'handle' is required: the name of the principal to follow." };
  const value = raw.trim().replace(/^@/, '').replace(/^p:/, '').toLowerCase();
  if (value.length === 0 || value.length > MAX_HANDLE_LENGTH || !HANDLE_GRAMMAR.test(value)) {
    return {
      ok: false,
      detail:
        `'handle' must be a principal's handle: lowercase letters and digits with single internal hyphens, ` +
        `1..${String(MAX_HANDLE_LENGTH)} characters, such as 'vale' or 'red-ash-9'.`,
    };
  }
  return { ok: true, value };
}

function isJsonRequest(req: Request): boolean {
  const type = req.headers['content-type'];
  return typeof type === 'string' && /^application\/json(?:\s*;|$)/i.test(type.trim());
}

function bytesOf(req: Request): Uint8Array {
  const body: unknown = req.body;
  return body instanceof Buffer ? new Uint8Array(body) : new Uint8Array(0);
}

function uncharged(source: WireRefusal): WireRefusal {
  return refusal(
    source.reason,
    `${source.detail} Nothing was stored and no rate-limit window was charged: correct it and send it again.`,
  );
}

function sendJson(res: Response, status: number, body: WireRefusal | Record<string, unknown>): void {
  res.status(status).set('Cache-Control', 'no-store').type('application/json').send(JSON.stringify(body));
}

function sendPage(res: Response, status: number, content: PageContent): void {
  res.status(status).set(PAGE_HEADERS).send(renderPage(content));
}
