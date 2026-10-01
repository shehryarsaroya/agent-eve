/**
 * HARD RULE 1, for mail: no key value may be logged, thrown, stored or committed — and no
 * follower's address may be logged either.
 *
 * Mirrors `test/cast/secrets.test.ts`: the leak that happens is never "somebody printed the
 * key", it is a provider error echoing the Authorization header into a log line. So the test
 * checks the whole path — the source files, the mailer's errors, and the worker's log sink
 * under a provider that echoes everything back.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishFrame } from '../../src/frames/write.js';
import {
  InMemoryFollowStore,
  RecapWorker,
  FollowService,
  hashToken,
  resendMailer,
  unsubscribeTokenFor,
} from '../../src/api/follow/index.js';
import { RateLimiter } from '../../src/api/limits.js';
import { LOOSE_FOLLOW_LIMITS, TEST_SECRET, clockAt, frame, standing } from './helpers.js';

const FAKE_KEY = ['re', 'secrets', 'test', 'not', 'a', 'real', 'key', '7777'].join('_');
let saved: string | undefined;
beforeEach(() => {
  saved = process.env['RESEND_API_KEY'];
  process.env['RESEND_API_KEY'] = FAKE_KEY;
});
afterEach(() => {
  if (saved === undefined) delete process.env['RESEND_API_KEY'];
  else process.env['RESEND_API_KEY'] = saved;
});

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...tsFiles(full));
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const SRC = new URL('../../src/', import.meta.url).pathname;
const TESTS = new URL('../', import.meta.url).pathname;

/** A provider that echoes the request — header, address and all — into its error body. */
const echoingFetch = ((_url: string, init: RequestInit) => {
  const headers = init.headers as Record<string, string>;
  return Promise.resolve(
    new Response(`{"message":"rejected ${headers['authorization'] ?? ''} for ${typeof init.body === 'string' ? init.body : ''}"}`, {
      status: 500,
    }),
  );
}) as unknown as typeof fetch;

describe('nothing in the source or the tests carries a mail credential', () => {
  it("only mailer.ts reads RESEND_API_KEY's VALUE; everywhere else is a presence test or prose", () => {
    const access = /\[\s*['"]RESEND_API_KEY['"]\s*\]|\.RESEND_API_KEY\b/;
    const readers: string[] = [];
    for (const file of tsFiles(SRC)) {
      const text = readFileSync(file, 'utf8');
      if (!access.test(text)) continue;
      readers.push(file.slice(file.indexOf('/src/') + 5));
    }
    expect(readers).toEqual(['api/follow/mailer.ts']);
  });

  it('no source or test file contains a Resend-key-shaped literal', () => {
    // `re_` and then enough to be a credential, contiguous. Assembled so this line cannot trip it.
    const shape = new RegExp(`\\b${'re'}_[A-Za-z0-9]{20,}`);
    for (const file of [...tsFiles(SRC), ...tsFiles(TESTS)]) {
      expect(shape.test(readFileSync(file, 'utf8')), file).toBe(false);
    }
  });
});

describe('a provider that echoes everything back cannot get it into a log line', () => {
  let dir = '';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'follow-secrets-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('the recap worker logs neither the key, the address, nor the unsubscribe token', async () => {
    publishFrame(dir, frame(0, { standings: [standing('vale')] }));
    const store = new InMemoryFollowStore();
    await store.insertPending({
      id: 'f1', handle: 'vale', email: 'private.person@example.com', confirmTokenHash: 'c',
      unsubscribeTokenHash: hashToken(unsubscribeTokenFor(TEST_SECRET, 'f1')), nowMs: 1,
    });
    await store.activate('f1', 2, null);
    const logs: string[] = [];
    const w = new RecapWorker({
      store, mailer: resendMailer({ from: 'a@agenteve.io', fetchImpl: echoingFetch }), secret: TEST_SECRET,
      framesDir: dir, publicUrl: 'https://agenteve.io', clock: clockAt(), dailyCeiling: 10,
      log: (l) => logs.push(l), schedule: () => ({ cancel: () => undefined }),
    });
    const report = await w.run();
    expect(report.failed).toBe(1);
    const everything = [...logs, JSON.stringify(w.health())].join('\n');
    expect(everything).not.toContain(FAKE_KEY);
    expect(everything).not.toContain('private.person@example.com');
    expect(everything).not.toContain(unsubscribeTokenFor(TEST_SECRET, 'f1'));
    expect(everything).not.toContain(TEST_SECRET);
    // But it does say something an operator can act on.
    expect(everything).toContain('follow f1');
  });

  it('the confirmation path logs neither the key, the address, nor the confirm token', async () => {
    const logs: string[] = [];
    const service = new FollowService({
      store: new InMemoryFollowStore(),
      mailer: resendMailer({ from: 'a@agenteve.io', fetchImpl: echoingFetch }),
      offReason: null, secret: TEST_SECRET, clock: clockAt(), publicUrl: 'https://agenteve.io',
      dailyCeiling: 10, maxActivePerEmail: 10, limiter: new RateLimiter(LOOSE_FOLLOW_LIMITS),
      log: (l) => logs.push(l), newToken: () => 'T'.repeat(43),
    });
    service.request('vale', 'private.person@example.com');
    await service.idle();
    const everything = [...logs, JSON.stringify(service.counts())].join('\n');
    expect(service.outcomes).toEqual(['send-failed']);
    expect(everything).not.toContain(FAKE_KEY);
    expect(everything).not.toContain('private.person@example.com');
    expect(everything).not.toContain('T'.repeat(43));
  });
});
