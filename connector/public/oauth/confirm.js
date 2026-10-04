// The confirm page's DOM. Text is set with textContent only.
import { runConfirm } from './confirm-flow.mjs';

const config = window.EVE_CONSENT;
const root = document.getElementById('app');

function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value !== false && value !== null && value !== undefined) node.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

function show(...nodes) {
  root.replaceChildren(el('section', { class: 'card' }, ...nodes));
}

const IGNORE = "Didn't start signing in? Ignore this email: nothing is shared.";

const ui = {
  error(message) {
    show(el('h1', {}, 'Agent Eve'), el('p', { class: 'error', role: 'alert' }, message));
  },
  useCode() {
    show(
      el('h1', {}, 'Use the code instead'),
      el('p', {}, 'Go back to the page where you started signing in to Agent Eve, and type the 6-digit code from this email there.'),
      el('p', { class: 'muted' }, IGNORE),
    );
  },
  ask({ needWord, wrong, yes, no }) {
    const yesButton = el('button', { type: 'submit' }, needWord ? 'Continue' : "Yes, it's me");
    const noButton = el('button', { type: 'button', class: 'secondary' }, 'Cancel');
    const word = needWord
      ? el('input', { type: 'text', id: 'word', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', required: true, placeholder: 'e.g. TIGER' })
      : null;
    const form = el(
      'form',
      {},
      needWord ? el('label', { for: 'word' }, 'The word on the sign-in page') : null,
      word,
      el('div', { class: 'actions' }, yesButton, noButton),
    );
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (word !== null && word.value.trim() === '') return;
      yesButton.disabled = true;
      noButton.disabled = true;
      yesButton.textContent = 'Signing in…';
      void yes(word === null ? undefined : word.value);
    });
    noButton.addEventListener('click', () => {
      yesButton.disabled = true;
      noButton.disabled = true;
      void no();
    });
    show(
      el('h1', {}, "Confirm it's you"),
      needWord
        ? el('p', {}, 'Type the word shown on the page where you started signing in to Agent Eve — in ChatGPT, Claude, Muse or another app.')
        : el('p', {}, 'You started signing in to Agent Eve in this browser. Continue?'),
      wrong ? el('p', { class: 'error', role: 'alert' }, `That's not the word. ${wrong.triesLeft === 1 ? '1 try left.' : `${wrong.triesLeft} tries left.`}`) : null,
      form,
      el('p', { class: 'muted' }, IGNORE),
    );
    word?.focus();
  },
  done() {
    show(el('h1', {}, "You're signed in"), el('p', {}, 'Go back to your app: it carries on by itself. You can close this page.'));
  },
  cancelled() {
    show(el('h1', {}, 'Cancelled'), el('p', {}, 'Nothing was shared. If someone else asked for this link, you can ignore the email.'));
  },
};

if (!config || !window.supabase) {
  ui.error('This page is not configured yet.');
} else {
  // Holds nothing: the session it receives is handed to the page that asked, never kept or refreshed here.
  const client = window.supabase.createClient(config.supabaseUrl, config.supabaseKey, {
    auth: { detectSessionInUrl: false, persistSession: false, autoRefreshToken: false, storageKey: 'eve-confirm' },
  });
  const path = (id, action = '') => `/oauth/handoff/${encodeURIComponent(id)}${action}`;
  const post = (url, body, headers = {}) =>
    fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), cache: 'no-store' });
  const api = {
    async pending(id) {
      const response = await fetch(path(id), { cache: 'no-store' });
      return response.ok;
    },
    async check(id, word) {
      const response = await post(path(id, '/check'), { word });
      if (response.ok) return { status: 'ok' };
      const body = await response.json().catch(() => ({}));
      if (response.status === 422) return { status: 'wrong', triesLeft: Number(body.tries_left ?? 0) };
      return { status: 'unknown' };
    },
    async confirm(id, accessToken, refreshToken, word) {
      const response = await post(path(id, '/confirm'), { refresh_token: refreshToken, word }, { authorization: `Bearer ${accessToken}` });
      if (response.ok) return 'ok';
      const body = await response.json().catch(() => ({}));
      return body.error === 'email_mismatch' ? 'email_mismatch' : 'gone';
    },
  };
  let shared = null;
  try {
    shared = window.localStorage;
  } catch {
    shared = null;
  }
  void runConfirm({ client, href: window.location.href, api, shared, ui });
}
