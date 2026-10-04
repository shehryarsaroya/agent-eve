/**
 * The confirm page's logic (`public/oauth/confirm-flow.mjs`), where every sign-in email lands on
 * whatever device it is opened: the person types the word the sign-in page shows (the browser that
 * started it already knows it), the word is checked before the one-time token is spent, the session
 * goes to the waiting page, and `next` counts only for this site's own confirm page.
 */

import { describe, expect, it } from 'vitest';
import { readConfirmLink, runConfirm, sameBrowserWord } from '../public/oauth/confirm-flow.mjs';
import { SAME_BROWSER_KEY } from '../public/oauth/consent-flow.mjs';

const ORIGIN = 'https://mcp.test.example';
const HANDOFF = 'AbCdEfGhIjKlMnOpQrStUv';
const link = (next: string) => `${ORIGIN}/oauth/confirm?token_hash=pkce_abc&type=email&next=${encodeURIComponent(next)}`;
const VIA_HANDOFF = link(`${ORIGIN}/oauth/confirm?handoff=${HANDOFF}`);

type Ask = { needWord: boolean; wrong: { triesLeft: number } | null; yes(word?: string): Promise<unknown>; no(): unknown };
type Check = { status: 'ok' } | { status: 'wrong'; triesLeft: number } | { status: 'unknown' };

function fakeConfirm(options: { pending?: boolean; checks?: Check[]; verifyError?: boolean; verdict?: string | Error; shared?: Map<string, string> } = {}) {
  const calls: unknown[][] = [];
  const ui: Record<string, unknown[]> = {};
  const record = (name: string) => (arg?: unknown) => {
    (ui[name] ??= []).push(arg);
    return arg;
  };
  const checks = [...(options.checks ?? [{ status: 'ok' }])];
  const client = {
    auth: {
      verifyOtp: async (args: unknown) => {
        calls.push(['verify', args]);
        return options.verifyError
          ? { data: { session: null }, error: { message: 'Email link is invalid or has expired' } }
          : { data: { session: { access_token: 'phone-access', refresh_token: 'phone-refresh' } }, error: null };
      },
    },
  };
  const api = {
    pending: async (id: string) => (calls.push(['pending', id]), options.pending ?? true),
    check: async (id: string, word: string) => (calls.push(['check', id, word]), (checks.length > 1 ? checks.shift() : checks[0]) as Check),
    confirm: async (id: string, access: string, refresh: string, word: string) => {
      calls.push(['confirm', id, access, refresh, word]);
      if (options.verdict instanceof Error) throw options.verdict;
      return options.verdict ?? 'ok';
    },
  };
  const shared = options.shared
    ? { getItem: (k: string) => options.shared?.get(k) ?? null, setItem: (k: string, v: string) => void options.shared?.set(k, v), removeItem: (k: string) => void options.shared?.delete(k) }
    : null;
  const run = (href: string) =>
    runConfirm({ client, href, api, shared, now: () => 1_000, ui: { ask: record('ask'), useCode: record('useCode'), done: record('done'), cancelled: record('cancelled'), error: record('error') } });
  const asked = (n = -1) => (ui['ask'] ?? []).at(n) as Ask;
  return { calls, ui, run, asked };
}

describe('reading the email link', () => {
  it('finds the handoff in `next`, or directly', () => {
    expect(readConfirmLink(VIA_HANDOFF)).toEqual({ tokenHash: 'pkce_abc', type: 'email', handoffId: HANDOFF });
    expect(readConfirmLink(`${ORIGIN}/oauth/confirm?handoff=${HANDOFF}&token_hash=t&type=email`)).toMatchObject({ handoffId: HANDOFF, tokenHash: 't' });
  });

  it('ignores a `next` on any other site or page, and a malformed id', () => {
    for (const next of [
      `https://evil.example/oauth/confirm?handoff=${HANDOFF}`,
      `${ORIGIN}/oauth/consent?authorization_id=a`,
      `${ORIGIN}/elsewhere?handoff=${HANDOFF}`,
      `${ORIGIN}/oauth/confirm?handoff=short`,
      ORIGIN,
      'javascript:alert(1)',
      'not a url',
    ]) {
      expect(readConfirmLink(link(next)).handoffId).toBeNull();
    }
  });

  it('knows the word only in the browser that started the sign-in, and only while it lasts', () => {
    const shared = new Map([[SAME_BROWSER_KEY, JSON.stringify({ id: HANDOFF, word: 'TIGER', expiresAt: 2_000 })]]);
    const area = { getItem: (k: string) => shared.get(k) ?? null };
    expect(sameBrowserWord(area, HANDOFF, 1_000)).toBe('TIGER');
    expect(sameBrowserWord(area, HANDOFF, 2_000)).toBeNull();
    expect(sameBrowserWord(area, 'ZZZZZZZZZZZZZZZZZZZZZZ', 1_000)).toBeNull();
    expect(sameBrowserWord(null, HANDOFF, 1_000)).toBeNull();
  });
});

describe('the confirm page', () => {
  it('asks for the word, checks it before spending anything, then hands the session over', async () => {
    const { calls, ui, run, asked } = fakeConfirm();
    await run(VIA_HANDOFF);
    expect(asked()).toMatchObject({ needWord: true, wrong: null });
    expect(calls).toEqual([['pending', HANDOFF]]);
    await asked().yes('tiger');
    expect(calls).toEqual([
      ['pending', HANDOFF],
      ['check', HANDOFF, 'tiger'],
      ['verify', { token_hash: 'pkce_abc', type: 'email' }],
      ['confirm', HANDOFF, 'phone-access', 'phone-refresh', 'tiger'],
    ]);
    expect(ui['done']).toHaveLength(1);
  });

  it('needs one tap in the browser that started the sign-in, and clears its note', async () => {
    const shared = new Map([[SAME_BROWSER_KEY, JSON.stringify({ id: HANDOFF, word: 'TIGER', expiresAt: 600_000 })]]);
    const { calls, ui, run, asked } = fakeConfirm({ shared });
    await run(VIA_HANDOFF);
    expect(asked()).toMatchObject({ needWord: false });
    await asked().yes();
    expect(calls).toContainEqual(['check', HANDOFF, 'TIGER']);
    expect(calls).toContainEqual(['confirm', HANDOFF, 'phone-access', 'phone-refresh', 'TIGER']);
    expect(ui['done']).toHaveLength(1);
    expect(shared.size).toBe(0);
  });

  it('spends nothing on a wrong word: one more try, then the sign-in is cancelled', async () => {
    const { calls, ui, run, asked } = fakeConfirm({ checks: [{ status: 'wrong', triesLeft: 1 }, { status: 'wrong', triesLeft: 0 }] });
    await run(VIA_HANDOFF);
    await asked().yes('guess');
    expect(asked()).toMatchObject({ needWord: true, wrong: { triesLeft: 1 } });
    await asked().yes('again');
    expect(ui['error']?.[0]).toMatch(/not the word, so this sign-in is cancelled/);
    expect(calls.some((c) => c[0] === 'verify' || c[0] === 'confirm')).toBe(false);
  });

  it('spends nothing on Cancel', async () => {
    const { calls, ui, run, asked } = fakeConfirm();
    await run(VIA_HANDOFF);
    asked().no();
    expect(ui['cancelled']).toHaveLength(1);
    expect(calls.some((c) => c[0] === 'check' || c[0] === 'verify')).toBe(false);
  });

  it('says the link is spent, expired or for another email', async () => {
    const gone = fakeConfirm({ pending: false });
    await gone.run(VIA_HANDOFF);
    expect(gone.ui['error']?.[0]).toMatch(/expired or was already used/);
    expect(gone.ui['ask']).toBeUndefined();

    const cancelled = fakeConfirm({ checks: [{ status: 'unknown' }] });
    await cancelled.run(VIA_HANDOFF);
    await cancelled.asked().yes('tiger');
    expect(cancelled.ui['error']?.[0]).toMatch(/expired or was already used/);

    const spent = fakeConfirm({ verifyError: true });
    await spent.run(VIA_HANDOFF);
    await spent.asked().yes('tiger');
    expect(spent.ui['error']?.[0]).toMatch(/expired or was already used/);
    expect(spent.calls.some((c) => c[0] === 'confirm')).toBe(false);

    const mismatch = fakeConfirm({ verdict: 'email_mismatch' });
    await mismatch.run(VIA_HANDOFF);
    await mismatch.asked().yes('tiger');
    expect(mismatch.ui['error']?.[0]).toMatch(/different email/);

    const down = fakeConfirm({ verdict: new Error('network') });
    await down.run(VIA_HANDOFF);
    await down.asked().yes('tiger');
    expect(down.ui['error']?.[0]).toMatch(/expired or was already used/);
  });

  it('points to the code when the link has no handoff, and refuses an incomplete link', async () => {
    const noHandoff = fakeConfirm();
    await noHandoff.run(link(`${ORIGIN}/oauth/consent?authorization_id=auth-1`));
    expect(noHandoff.ui['useCode']).toHaveLength(1);
    expect(noHandoff.calls).toEqual([]);

    for (const href of [`${ORIGIN}/oauth/confirm?type=email&next=${encodeURIComponent(`${ORIGIN}/oauth/confirm?handoff=${HANDOFF}`)}`, `${ORIGIN}/oauth/confirm`]) {
      const { ui, calls, run } = fakeConfirm();
      await run(href);
      expect(ui['error']?.[0]).toMatch(/incomplete/);
      expect(calls).toEqual([]);
    }
  });
});
