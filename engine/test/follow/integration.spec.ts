/**
 * ★ Follow by email, end to end, against a MOCKED RESEND ENDPOINT.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * Everything real except the provider: the real `createApp`, the real `createFollow` wiring,
 * the real `resendMailer` speaking HTTP — pointed at a local server that implements
 * `POST /emails` the way Resend documents it — a real world with a real cast driven through
 * two Reckonings, and frames published by the real `publishFrame`. The worker is kicked
 * exactly where `serve()` kicks it: after a settled frame is published.
 *
 * The story it walks is the product: a human follows a house character; one confirmation
 * arrives; a mail scanner opens its link and nothing happens; the human opens it and presses
 * Confirm; the Reckoning settles and ONE recap arrives telling that character's night, with a
 * one-click unsubscribe in its headers; their mail client uses RFC 8058 to unsubscribe; the
 * next Reckoning settles and nothing more is sent.
 *
 * **THE KEY IS NOT A KEY.** It is assembled from the words "not a real key" and goes only to
 * 127.0.0.1. No request in this file leaves the machine.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setSpeed } from '../../src/core/time.js';
import { createApp } from '../../src/api/server.js';
import { SeatBook } from '../../src/api/seats.js';
import { publishFrame } from '../../src/frames/write.js';
import { HeuristicCast } from '../../src/cast/index.js';
import { Runtime } from '../../src/sim/runtime.js';
import {
  InMemoryFollowStore,
  createFollow,
  followWorldOf,
  resendMailer,
  type FollowSetup,
} from '../../src/api/follow/index.js';
import { TEST_SECRET, clockAt, pathOf } from './helpers.js';

const FAKE_KEY = ['re', 'integration', 'not', 'a', 'real', 'key', '99'].join('_');
const SEED = 'follow-integration-1';

interface ResendCall {
  readonly method: string;
  readonly path: string;
  readonly headers: IncomingMessage['headers'];
  readonly body: Record<string, unknown>;
}

/** A local stand-in for Resend: `POST /emails` → `{ id }`, recording everything it is sent. */
async function mockResend(): Promise<{ url: string; calls: ResendCall[]; close: () => Promise<void> }> {
  const calls: ResendCall[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
      } catch {
        // recorded as empty; the assertions below will notice
      }
      calls.push({ method: req.method ?? '', path: req.url ?? '', headers: req.headers, body });
      const authorised = req.headers['authorization'] === `Bearer ${FAKE_KEY}`;
      if (req.method !== 'POST' || req.url !== '/emails' || !authorised) {
        res.writeHead(authorised ? 404 : 401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ statusCode: authorised ? 404 : 401, name: 'error', message: 'refused' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: `em_${String(calls.length)}` }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${String(port)}/emails`,
    calls,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

describe('★ follow by email, end to end, against a mocked Resend endpoint', () => {
  let resend: Awaited<ReturnType<typeof mockResend>>;
  let dir = '';
  let saved: string | undefined;
  let follow: FollowSetup;
  let runtime: Runtime;
  let cast: HeuristicCast;
  let origin = '';
  let closeApp: () => Promise<void> = () => Promise.resolve();
  let handle = '';
  const clock = clockAt();

  beforeAll(async () => {
    setSpeed('instant');
    saved = process.env['RESEND_API_KEY'];
    process.env['RESEND_API_KEY'] = FAKE_KEY;
    resend = await mockResend();
    dir = mkdtempSync(join(tmpdir(), 'follow-e2e-'));

    runtime = new Runtime({ seed: SEED });
    cast = new HeuristicCast(runtime, { size: 6 });
    const members = cast.seat(SEED);
    handle = members[0]?.handle ?? '';

    follow = createFollow({
      env: { ...process.env, COMPACT_FOLLOW_SECRET: TEST_SECRET, COMPACT_MAIL_FROM: 'Agent Eve <updates@agenteve.io>' },
      clock,
      framesDir: dir,
      store: new InMemoryFollowStore(),
      // The REAL mailer, over real HTTP, to the local stand-in.
      mailer: resendMailer({ from: 'Agent Eve <updates@agenteve.io>', url: resend.url }),
      principalExists: followWorldOf(runtime).principalExists,
      sleep: () => Promise.resolve(),
      log: () => undefined,
    });
    expect(follow.config.sending).toBe(true);

    const { app } = createApp({ runtime, clock, seats: new SeatBook(64), follow: follow.service });
    const server: Server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
    closeApp = () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
  }, 120_000);

  afterAll(async () => {
    await follow.close();
    await closeApp();
    await resend.close();
    rmSync(dir, { recursive: true, force: true });
    if (saved === undefined) delete process.env['RESEND_API_KEY'];
    else process.env['RESEND_API_KEY'] = saved;
  });

  /** Run the world to its next settlement, publish the frame, and kick — exactly as serve() does. */
  async function settleNextReckoning(): Promise<void> {
    for (;;) {
      for (const action of cast.decide(runtime.engine.tick + 1, SEED)) runtime.engine.submit(action);
      const report = runtime.runTick();
      if (report.clock.isSettlementTick) {
        const frame = runtime.reckoningFrame();
        if (frame === null) throw new Error('a settlement with no frame');
        publishFrame(dir, frame);
        follow.recaps.kick();
        await follow.recaps.idle();
        return;
      }
    }
  }

  const emails = (): ResendCall[] => resend.calls.filter((c) => c.path === '/emails');

  it('a follow request sends exactly ONE confirmation, in Resend’s shape', async () => {
    const res = await fetch(`${origin}/api/follow`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle, email: 'Watcher@Example.com' }),
    });
    expect(res.status).toBe(202);
    await follow.service.idle();
    expect(emails()).toHaveLength(1);
    const call = emails()[0];
    if (call === undefined) throw new Error('no call');
    expect(call.method).toBe('POST');
    expect(call.headers['authorization']).toBe(`Bearer ${FAKE_KEY}`);
    expect(call.headers['content-type']).toBe('application/json');
    expect(String(call.headers['idempotency-key'])).toMatch(/^follow-confirm-[0-9a-f]{40}$/);
    expect(call.body['from']).toBe('Agent Eve <updates@agenteve.io>');
    expect(call.body['to']).toEqual(['watcher@example.com']);
    expect(String(call.body['subject'])).toBe(`Confirm: follow ${handle} on Agent Eve`);
    expect(String(call.body['text'])).toMatch(/https:\/\/agenteve\.io\/api\/follow\/confirm\?token=[A-Za-z0-9_-]{43}/);
    // Who sent it and why, in one plain line — and it does not claim the reader asked.
    expect(String(call.body['text'])).toContain(
      `This email is from Agent Eve at agenteve.io, because this address was entered to follow ${handle}.`,
    );
    expect(String(call.body['html'])).toContain('/api/follow/confirm?token=');
    // A confirmation is transactional: no list headers, nothing to unsubscribe from yet.
    expect(call.body['headers']).toBeUndefined();
    // The key went in the header and nowhere else.
    expect(JSON.stringify(call.body)).not.toContain(FAKE_KEY);
  });

  it('a scanner opening the link is not a confirmation — nothing more is sent to that address', async () => {
    // A second follower whose corporate scanner opens every link and who never presses Confirm.
    await fetch(`${origin}/api/follow`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle, email: 'scanned@corp.example' }),
    });
    await follow.service.idle();
    const mine = emails().filter((c) => JSON.stringify(c.body['to']) === '["scanned@corp.example"]');
    expect(mine).toHaveLength(1);
    const link = /https:\/\/agenteve\.io\/api\/follow\/confirm\?token=[A-Za-z0-9_-]{43}/.exec(String(mine[0]?.body['text']))?.[0] ?? '';
    for (const method of ['HEAD', 'GET', 'GET']) {
      const res = await fetch(`${origin}${pathOf(link)}`, { method });
      expect(res.status).toBe(200);
      await res.text();
    }
  });

  it('opening the link and pressing Confirm activates the follow', async () => {
    const confirmUrl = /https:\/\/agenteve\.io\/api\/follow\/confirm\?token=[A-Za-z0-9_-]{43}/.exec(String(emails()[0]?.body['text']))?.[0] ?? '';
    const page = await fetch(`${origin}${pathOf(confirmUrl)}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain(`Follow ${handle}?`);
    // Press the button exactly as the browser would: the form's action, the form's field.
    const token = /name="token" value="([A-Za-z0-9_-]{43})"/.exec(html)?.[1] ?? '';
    const action = /<form method="post" action="([a-z]+)">/.exec(html)?.[1] ?? '';
    const pressed = await fetch(new URL(action, `${origin}${pathOf(confirmUrl)}`), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
    });
    expect(pressed.status).toBe(200);
    expect(await pressed.text()).toContain(`You follow ${handle}`);
  });

  it('after the Reckoning settles: ONE recap, for that character, with RFC 8058 headers', async () => {
    const before = emails().length;
    await settleNextReckoning();
    const recaps = emails().slice(before);
    expect(recaps).toHaveLength(1);
    const recap = recaps[0];
    if (recap === undefined) throw new Error('no recap');
    expect(recap.body['to']).toEqual(['watcher@example.com']);
    expect(String(recap.body['subject'])).toContain(handle);
    expect(String(recap.body['subject'])).toContain('Reckoning 0');
    expect(String(recap.headers['idempotency-key'])).toMatch(/^recap-[A-Za-z0-9_-]+-r0$/);
    const headers = recap.body['headers'] as Record<string, string>;
    expect(headers['List-Unsubscribe']).toMatch(/^<https:\/\/agenteve\.io\/api\/follow\/unsubscribe\?token=[A-Za-z0-9_-]{43}>$/);
    expect(headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    const text = String(recap.body['text']);
    expect(text).toContain(`https://agenteve.io/#/agent/${handle}`);
    expect(text).toContain('Unsubscribe: https://agenteve.io/api/follow/unsubscribe?token=');
    expect(text).toContain(`${handle}'s public record`);
    expect(text).toContain(`You asked to follow ${handle} on Agent Eve at agenteve.io.`);
    // The scanned, never-confirmed address got no recap.
    expect(recaps.map((c) => JSON.stringify(c.body['to']))).not.toContain('["scanned@corp.example"]');
    expect(String(recap.body['html'])).toContain('<h1');
    // Kicking again for the same Reckoning sends nothing: exactly once.
    follow.recaps.kick();
    await follow.recaps.idle();
    expect(emails().length).toBe(before + 1);
  }, 600_000);

  it('the mail client’s one-click unsubscribe works, and the next Reckoning sends nothing', async () => {
    const recap = emails().at(-1);
    const header = String((recap?.body['headers'] as Record<string, string> | undefined)?.['List-Unsubscribe'] ?? '');
    const url = header.slice(1, -1);
    const res = await fetch(`${origin}${pathOf(url)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'List-Unsubscribe=One-Click',
    });
    expect(res.status).toBe(200);
    const before = emails().length;
    await settleNextReckoning();
    expect(emails().length).toBe(before);
    expect(follow.health()).toMatchObject({ sending: true, store: 'memory', recaps_sent: 1, last_recap_reckoning: 1 });
  }, 600_000);
});
