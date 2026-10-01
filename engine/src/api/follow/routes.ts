/**
 * The follow routes: one JSON endpoint and two links that land on a small HTML page.
 *
 *   POST /api/follow                   {handle, email}  → 202, the same body every time
 *   GET  /api/follow/confirm?token=…                    → PENDING → ACTIVE, idempotent
 *   GET  /api/follow/unsubscribe?token=…                → → UNSUBSCRIBED, idempotent, one click
 *   POST /api/follow/unsubscribe?token=…                → RFC 8058's one-click, for mail clients
 *
 * ══════════════════════════════════════════════════════════════════════════
 * Three properties, each the reason for some code below:
 *
 *   1. **No enumeration.** Every refusal `POST /api/follow` can give is about the request or
 *      the caller — shape, IP bucket, an unknown (public) handle, the global ceiling, a full
 *      queue — and never about the address. Whatever the address's state, a valid request
 *      gets `202` with identical bytes, and the work that depends on the state happens after
 *      the response (see `service.ts`).
 *   2. **No cross-site form can reach it.** `POST /api/follow` reads only
 *      `Content-Type: application/json`. An HTML form cannot send that type, and a script
 *      on another origin that does must pass a CORS preflight this API never grants. Without
 *      this rule any web page could make its visitors' browsers request confirmations.
 *   3. **A HEAD is not a click.** Express answers HEAD with the GET handler unless told
 *      otherwise, and link scanners and prefetchers send HEAD. A HEAD on a confirm or
 *      unsubscribe link therefore gets its own handler that changes nothing.
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

  // HEAD first: registered before GET so a scanner's HEAD never reaches the handler that acts.
  router.head(FOLLOW_PATHS.confirm, (_req, res) => {
    res.status(200).set(PAGE_HEADERS).end();
  });
  router.get(FOLLOW_PATHS.confirm, (req, res) => {
    void link(req, res, 'confirm');
  });
  router.head(FOLLOW_PATHS.unsubscribe, (_req, res) => {
    res.status(200).set(PAGE_HEADERS).end();
  });
  router.get(FOLLOW_PATHS.unsubscribe, (req, res) => {
    void link(req, res, 'unsubscribe');
  });
  // RFC 8058: a mail client POSTs `List-Unsubscribe=One-Click` to the List-Unsubscribe URL.
  // The token in the URL is the whole authority; the body is not read.
  router.post(FOLLOW_PATHS.unsubscribe, (req, res) => {
    void link(req, res, 'unsubscribe');
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
          'Nothing else is sent until it is clicked, and every update carries a one-click unsubscribe. ' +
          'This answer is the same whether or not the address already follows anyone.',
        record: service.links.record(handle.value),
      });
    } catch {
      if (!res.headersSent) sendJson(res, 500, refusal(WIRE_REASON.INTERNAL, 'the request could not be processed. Nothing was sent.'));
    }
  }

  async function link(req: Request, res: Response, which: 'confirm' | 'unsubscribe'): Promise<void> {
    try {
      const ip = callerOf(req, res, 'html');
      if (ip === null) return;
      const service = options.service;
      if (service === null) {
        sendPage(res, 503, {
          title: 'Not available',
          paragraphs: ['Follow by email is not available on this world right now. Nothing was changed.'],
        });
        return;
      }
      const gate = service.admitLink(ip);
      if (!gate.allowed) {
        res.setHeader('Retry-After', String(gate.retryAfterSeconds));
        sendPage(res, 429, {
          title: 'Too many requests',
          paragraphs: [`Please try this link again in ${String(gate.retryAfterSeconds)} seconds. Nothing was changed.`],
        });
        return;
      }
      const raw: unknown = req.query['token'];
      const token = typeof raw === 'string' ? raw : null;
      if (which === 'confirm') {
        const outcome = await service.confirm(token, options.world.latestSettledReckoning());
        const page = confirmPage(outcome, service, options.world.msUntilNextReckoning());
        sendPage(res, page.status, page.content);
      } else {
        const outcome = await service.unsubscribe(token);
        const page = unsubscribePage(outcome, service);
        sendPage(res, page.status, page.content);
      }
    } catch {
      if (!res.headersSent) {
        sendPage(res, 500, {
          title: 'Something went wrong',
          paragraphs: ['This link could not be processed just now. Nothing was changed; please try it again later.'],
        });
      }
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
  if (outcome.kind === 'unknown-link') {
    return {
      status: 404,
      content: {
        title: 'This link is not recognised',
        paragraphs: [
          'It may have been replaced by a newer confirmation email, or copied incompletely. Nothing was changed.',
        ],
      },
    };
  }
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
            'Every email carries a one-click unsubscribe.',
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
            'Unsubscribe from one (every update has the link), then click this confirmation link again.',
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
      return {
        status: 404,
        content: {
          title: 'This link is not recognised',
          paragraphs: [
            'Nothing was changed. If updates keep arriving, use the unsubscribe link in the newest one.',
          ],
        },
      };
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
