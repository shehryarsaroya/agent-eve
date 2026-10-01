/**
 * Switching the feature on and off — and `serve()` wiring it in without touching the world.
 *
 * Off is the default and must be LOUD and SAFE: no key or no secret means `POST /api/follow`
 * answers a clear 503 naming the missing variable, nothing crashes, and the links already in
 * people's inboxes keep working. On needs both variables and a frames directory.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve, API_BASE_PATH } from '../../src/api/server.js';
import { InMemoryJournalStore } from '../../src/persist/index.js';
import { setSpeed } from '../../src/core/time.js';
import type { Pool } from 'pg';
import {
  DEFAULT_MAIL_FROM,
  DEFAULT_PUBLIC_URL,
  FOLLOW_ENV,
  InMemoryFollowStore,
  PgFollowStore,
  createFollow,
  followConfigFromEnv,
} from '../../src/api/follow/index.js';
import { FOLLOW_MAX_PER_EMAIL_DEFAULT, MAIL_DAILY_CEILING_DEFAULT } from '../../src/api/limits.js';
import { RecordingMailer, TEST_SECRET, clockAt } from './helpers.js';

const KEY = ['re', 'setup', 'not', 'a', 'real', 'key', '42'].join('_');
const ON = { RESEND_API_KEY: KEY, COMPACT_FOLLOW_SECRET: TEST_SECRET };

describe('followConfigFromEnv', () => {
  it('is OFF with nothing set, and names the variable that would turn it on', () => {
    const c = followConfigFromEnv({}, '/frames');
    expect(c.sending).toBe(false);
    expect(c.offReason).toContain(FOLLOW_ENV.key);
  });

  it('is OFF with a key but no secret, and names the secret', () => {
    const c = followConfigFromEnv({ RESEND_API_KEY: KEY }, '/frames');
    expect(c.sending).toBe(false);
    expect(c.offReason).toContain(FOLLOW_ENV.secret);
  });

  it('ignores a too-short secret with a warning, rather than signing links with it', () => {
    const c = followConfigFromEnv({ RESEND_API_KEY: KEY, COMPACT_FOLLOW_SECRET: 'short' }, '/frames');
    expect(c.sending).toBe(false);
    expect(c.secret).toBeNull();
    expect(c.warnings.join(' ')).toContain(FOLLOW_ENV.secret);
  });

  it('is OFF in a world that publishes no frames: there is nothing to recap', () => {
    const c = followConfigFromEnv(ON, null);
    expect(c.sending).toBe(false);
    expect(c.offReason).toContain('COMPACT_FRAMES_DIR');
  });

  it('is ON with both variables and frames, on the documented defaults', () => {
    const c = followConfigFromEnv(ON, '/frames');
    expect(c.sending).toBe(true);
    expect(c.offReason).toBeNull();
    expect(c.from).toBe(DEFAULT_MAIL_FROM);
    expect(c.from).toBe('Agent Eve <updates@agenteve.io>');
    expect(c.publicUrl).toBe(DEFAULT_PUBLIC_URL);
    expect(c.publicUrl).toBe('https://agenteve.io');
    expect(c.dailyCeiling).toBe(MAIL_DAILY_CEILING_DEFAULT);
    expect(c.dailyCeiling).toBe(2_000);
    expect(c.maxActivePerEmail).toBe(FOLLOW_MAX_PER_EMAIL_DEFAULT);
    expect(c.warnings).toEqual([]);
  });

  it('reads the overrides, and refuses a typo with a warning and the default — never "unlimited"', () => {
    const c = followConfigFromEnv(
      {
        ...ON,
        COMPACT_MAIL_FROM: 'Eve Updates <eve@mail.example>',
        COMPACT_PUBLIC_URL: 'https://staging.example/',
        COMPACT_MAIL_DAILY_LIMIT: '50',
        COMPACT_FOLLOW_MAX_PER_EMAIL: 'lots',
      },
      '/frames',
    );
    expect(c.from).toBe('Eve Updates <eve@mail.example>');
    expect(c.publicUrl).toBe('https://staging.example');
    expect(c.dailyCeiling).toBe(50);
    expect(c.maxActivePerEmail).toBe(FOLLOW_MAX_PER_EMAIL_DEFAULT);
    expect(c.warnings.join(' ')).toContain(FOLLOW_ENV.maxPerEmail);
    for (const bad of ['0', '-5', '1.5', 'Infinity']) {
      expect(followConfigFromEnv({ ...ON, COMPACT_MAIL_DAILY_LIMIT: bad }, '/f').dailyCeiling).toBe(MAIL_DAILY_CEILING_DEFAULT);
    }
  });

  it('only builds links on an https origin with no path (http only for localhost)', () => {
    for (const bad of ['http://agenteve.io', 'https://agenteve.io/path', 'https://x.io/?q=1', 'javascript:alert(1)', 'not a url', 'https://u:p@x.io']) {
      const c = followConfigFromEnv({ ...ON, COMPACT_PUBLIC_URL: bad }, '/f');
      expect(c.publicUrl, bad).toBe(DEFAULT_PUBLIC_URL);
      expect(c.warnings.length, bad).toBeGreaterThan(0);
    }
    expect(followConfigFromEnv({ ...ON, COMPACT_PUBLIC_URL: 'http://localhost:8787' }, '/f').publicUrl).toBe('http://localhost:8787');
  });
});

describe('createFollow', () => {
  it('off: the service refuses to send and says why; confirm and unsubscribe still work', async () => {
    const lines: string[] = [];
    const setup = createFollow({ env: {}, clock: clockAt(), framesDir: '/f', store: new InMemoryFollowStore(), log: (l) => lines.push(l) });
    expect(setup.service.sending).toBe(false);
    expect(setup.service.offReason).toContain('RESEND_API_KEY');
    expect(setup.service.request('vale', 'you@example.com')).toBe(false);
    expect((await setup.service.unsubscribe('x'.repeat(43))).kind).toBe('unknown-link');
    expect(lines.join('\n')).toContain('follow by email is OFF');
    expect(setup.health()).toMatchObject({ sending: false, store: 'memory', recaps_sent: 0 });
    await setup.close();
  });

  it('warns LOUDLY when there is no database, because follows would vanish at a restart', async () => {
    const lines: string[] = [];
    const setup = createFollow({ env: ON, clock: clockAt(), framesDir: '/f', database: null, log: (l) => lines.push(l) });
    expect(lines.join('\n')).toMatch(/WARNING[^\n]*LOST at the next restart/);
    await setup.close();
  });

  it('says at boot, once, when the follow tables are missing (a migration that has not run)', async () => {
    const lines: string[] = [];
    const missing = {
      query: () => Promise.reject(new Error('relation "follow_mail_day" does not exist')),
      end: () => Promise.resolve(),
    };
    const setup = createFollow({
      env: ON,
      clock: clockAt(),
      framesDir: '/f',
      store: new PgFollowStore({ pool: missing as unknown as Pool }),
      log: (l) => lines.push(l),
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(lines.join('\n')).toMatch(/follow tables are not readable[^\n]*Run the migration/);
    await setup.close();
  });

  it('refuses addresses on its own sending domain, whatever that is configured to be', async () => {
    const setup = createFollow({
      env: { ...ON, COMPACT_MAIL_FROM: 'Eve <updates@eve-mail.example>' },
      clock: clockAt(),
      framesDir: '/f',
      store: new InMemoryFollowStore(),
      mailer: new RecordingMailer(),
      log: () => undefined,
    });
    expect(setup.service.refusedDomains).toContain('eve-mail.example');
    expect(setup.service.refusedDomains).toContain('agenteve.io');
    await setup.close();
  });
});

describe('serve() wires it in — wiring only', () => {
  let dir = '';
  afterEach(() => {
    setSpeed('instant');
    if (dir !== '') rmSync(dir, { recursive: true, force: true });
    dir = '';
  });

  it('mounts the routes, reports the meter on /health without ever failing it, and closes it', async () => {
    dir = mkdtempSync(join(tmpdir(), 'follow-serve-'));
    const mailer = new RecordingMailer();
    const saved = process.env['RESEND_API_KEY'];
    process.env['RESEND_API_KEY'] = KEY;
    const follow = createFollow({
      env: { ...process.env, COMPACT_FOLLOW_SECRET: TEST_SECRET },
      clock: clockAt(),
      framesDir: dir,
      store: new InMemoryFollowStore(),
      mailer,
      sleep: () => Promise.resolve(),
      log: () => undefined,
    });
    const started = await serve({
      port: 0,
      host: '127.0.0.1',
      seed: 'follow-serve-1',
      trustEdge: false,
      castSize: 2,
      framesDir: dir,
      store: new InMemoryJournalStore(),
      follow,
    });
    try {
      expect(started.created?.context.follow).toBe(follow.service);
      const base = `http://127.0.0.1:${String(started.port)}`;
      const handle = String(started.created?.context.runtime.world.principalOrder[0] ?? '').replace(/^p:/, '');
      const res = await fetch(`${base}${API_BASE_PATH}/follow`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ handle, email: 'you@example.com' }),
      });
      expect(res.status).toBe(202);
      await follow.service.idle();
      expect(mailer.sent).toHaveLength(1);
      const health = (await (await fetch(`${base}${API_BASE_PATH}/health`)).json()) as { report: { follow: unknown; failures: string[] } };
      expect(health.report.follow).toMatchObject({ sending: true, confirmations_sent: 1 });
      expect(health.report.failures.join(' ')).not.toMatch(/follow|mail/i);
    } finally {
      await started.close();
      if (saved === undefined) delete process.env['RESEND_API_KEY'];
      else process.env['RESEND_API_KEY'] = saved;
    }
    // Closed with the server: it no longer accepts work.
    expect(follow.service.request('vale', 'late@example.com')).toBe(false);
  }, 120_000);

  it('with follow: null the routes still answer, and say the feature is off', async () => {
    dir = mkdtempSync(join(tmpdir(), 'follow-serve-off-'));
    const started = await serve({
      port: 0,
      host: '127.0.0.1',
      seed: 'follow-serve-2',
      trustEdge: false,
      castSize: 2,
      framesDir: dir,
      store: new InMemoryJournalStore(),
      follow: null,
    });
    try {
      const res = await fetch(`http://127.0.0.1:${String(started.port)}${API_BASE_PATH}/follow`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ handle: 'vale', email: 'you@example.com' }),
      });
      expect(res.status).toBe(503);
      expect(((await res.json()) as { reason: string }).reason).toBe('FOLLOW_DISABLED');
    } finally {
      await started.close();
    }
  }, 120_000);
});
