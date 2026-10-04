// The confirm page's logic, separate from the DOM so it can be tested with fakes.
//
// Every sign-in email links here, on whatever device the person opens it:
//   /oauth/confirm?token_hash=…&type=email&next=<the URL the consent page asked Supabase for>
// `next` is this page with a handoff id (`/oauth/confirm?handoff=…`) whenever the consent page could
// open one. Nothing is spent until the person confirms, so an email scanner that opens links uses
// nothing up:
//   1. The person types the word the sign-in page shows — or, in the browser that started the
//      sign-in, the page already knows it and one tap does. It is checked BEFORE the token is spent;
//      two wrong words cancel the sign-in (src/auth/handoff.ts).
//   2. Only then is the token spent (`verifyOtp`) and the fresh session posted to the handoff with
//      the word again; the waiting sign-in page collects it and carries on.
// Typing the word is what makes an email the person never asked for harmless: they cannot know it.
// Without a handoff the page only says to type the email's code where the sign-in started — a link
// that signed in wherever it was opened would let anyone sign someone's browser into their account.
import { SAME_BROWSER_KEY } from './consent-flow.mjs';

const EXPIRED = 'This sign-in link has expired or was already used. Ask your app for a new email.';
const INCOMPLETE = 'This link is incomplete. Ask your app for a new sign-in email.';
const CANCELLED = 'That was not the word, so this sign-in is cancelled and nothing was shared. If you are signing in, ask your app for a new email.';

/** What the link asks for: the one-time token, and the handoff it belongs to (only ever this site's). */
export function readConfirmLink(href) {
  const url = new URL(href);
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') || 'email';
  let handoffId = url.searchParams.get('handoff');
  const next = url.searchParams.get('next');
  if (!handoffId && next) {
    let target = null;
    try {
      target = new URL(next);
    } catch {
      target = null;
    }
    // `next` arrives in an email anyone can forge: only this page on this site counts.
    if (target !== null && target.origin === url.origin && target.pathname === '/oauth/confirm') handoffId = target.searchParams.get('handoff');
  }
  if (handoffId !== null && !/^[A-Za-z0-9_-]{16,64}$/.test(handoffId)) handoffId = null;
  return { tokenHash, type, handoffId };
}

/** The word, when this same browser started the sign-in (the consent page left it in localStorage). */
export function sameBrowserWord(shared, id, now) {
  try {
    const saved = JSON.parse(shared?.getItem(SAME_BROWSER_KEY) ?? 'null');
    if (saved && saved.id === id && typeof saved.word === 'string' && Number(saved.expiresAt) > now) return saved.word;
  } catch {
    /* unreadable: ask for the word */
  }
  return null;
}

export async function runConfirm(deps) {
  const { client, href, api, shared = null, now = () => Date.now(), ui } = deps;
  const { tokenHash, type, handoffId } = readConfirmLink(href);
  if (!tokenHash) return ui.error(INCOMPLETE);
  if (!handoffId) return ui.useCode();

  let pending = false;
  try {
    pending = await api.pending(handoffId);
  } catch {
    pending = false;
  }
  if (!pending) return ui.error(EXPIRED);

  const forgetWord = () => {
    try {
      if (sameBrowserWord(shared, handoffId, now()) !== null) shared.removeItem(SAME_BROWSER_KEY);
    } catch {
      /* storage unavailable */
    }
  };
  const no = () => ui.cancelled();
  const ask = (wrong) => ui.ask({ needWord: true, wrong, yes: (typed) => go(typed ?? ''), no });

  async function go(word) {
    let checked;
    try {
      checked = await api.check(handoffId, word);
    } catch {
      return ui.error(EXPIRED);
    }
    if (checked.status === 'wrong') return checked.triesLeft > 0 ? ask({ triesLeft: checked.triesLeft }) : ui.error(CANCELLED);
    if (checked.status !== 'ok') return ui.error(EXPIRED);

    let session = null;
    try {
      const { data, error } = await client.auth.verifyOtp({ token_hash: tokenHash, type });
      session = error ? null : (data?.session ?? null);
    } catch {
      session = null;
    }
    if (session === null) return ui.error(EXPIRED);
    let verdict = 'gone';
    try {
      verdict = await api.confirm(handoffId, session.access_token, session.refresh_token, word);
    } catch {
      verdict = 'gone';
    }
    if (verdict === 'ok') {
      forgetWord();
      return ui.done();
    }
    if (verdict === 'email_mismatch') return ui.error('This link was sent to a different email than the one signing in. Ask your app for a new email.');
    return ui.error(EXPIRED);
  }

  const known = sameBrowserWord(shared, handoffId, now());
  if (known !== null) return ui.ask({ needWord: false, wrong: null, yes: () => go(known), no });
  return ask(null);
}
