// The consent page's DOM. All text a client controls goes in with textContent, never as HTML.
import { runConsent } from './consent-flow.mjs';

const config = window.EVE_CONSENT;
const root = document.getElementById('app');

function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (name === 'onclick' || name === 'onsubmit') node.addEventListener(name.slice(2), value);
    else if (value !== false && value !== null && value !== undefined) node.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

function show(...nodes) {
  root.replaceChildren(...nodes);
}

let noticeSlot = null;
let sendButton = null;

function sendAgain(label) {
  if (sendButton === null) return;
  sendButton.disabled = false;
  if (label) sendButton.textContent = label;
}

const ui = {
  error(message) {
    show(el('section', { class: 'card' }, el('h1', {}, 'Agent Eve'), el('p', { class: 'error', role: 'alert' }, message)));
  },
  notice(message) {
    if (noticeSlot) noticeSlot.replaceChildren(el('p', { class: 'notice', role: 'status' }, message));
    sendAgain(null);
  },
  linkSent(email, word) {
    if (word) {
      noticeSlot?.replaceChildren(
        el(
          'div',
          { class: 'notice', role: 'status' },
          el('p', {}, `We emailed a link to ${email}. Open it on any device — your phone is fine. If it asks for a word, type:`),
          el('p', { class: 'word' }, word),
          el('p', { class: 'muted' }, 'This page carries on by itself once you confirm. Or type the code from the email below.'),
        ),
      );
    } else {
      ui.notice(`We emailed a sign-in link and a code to ${email}. Open the link on this device, or enter the code below.`);
    }
    const code = document.getElementById('code-row');
    if (code) code.hidden = false;
    sendAgain('Send a new link');
  },
  connecting() {
    sendButton = null;
    show(el('section', { class: 'card' }, el('h1', {}, 'Agent Eve'), el('p', { role: 'status' }, 'Signed in. Connecting your app…')));
  },
  signIn({ providers, passwordSignIn, email: knownEmail, sendLink, verifyCode, password, provider }) {
    noticeSlot = el('div', { class: 'notice-slot', 'aria-live': 'polite' });
    const email = el('input', { type: 'email', id: 'email', autocomplete: 'email', required: true, placeholder: 'you@example.com' });
    if (knownEmail) email.value = knownEmail;
    const code = el('input', { type: 'text', id: 'code', inputmode: 'numeric', autocomplete: 'one-time-code', pattern: '[0-9]{6,10}', placeholder: '123456' });
    const busy = (button, work) => async (event) => {
      event.preventDefault();
      button.disabled = true;
      try {
        await work();
      } finally {
        button.disabled = false;
      }
    };
    sendButton = el('button', { type: 'submit' }, 'Email me a sign-in link');
    const codeButton = el('button', { type: 'button', class: 'secondary' }, 'Continue with code');
    codeButton.addEventListener('click', busy(codeButton, () => verifyCode(email.value.trim(), code.value.trim())));
    const form = el('form', {}, el('label', { for: 'email' }, 'Email'), email, sendButton);
    // Not `busy`: sendLink resolves only when the wait for "Yes, it's me" ends, and the button
    // comes back as soon as the email is out (linkSent / notice), so a second email needs no reload.
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      sendButton.disabled = true;
      void sendLink(email.value.trim()).catch(() => ui.notice('Something went wrong. Try again in a minute.'));
    });
    const codeRow = el('div', { id: 'code-row', hidden: true }, el('label', { for: 'code' }, 'Code from the email'), code, codeButton);
    const providerButtons = providers.map((name) => {
      const button = el('button', { type: 'button', class: 'secondary' }, `Continue with ${name === 'github' ? 'GitHub' : name === 'google' ? 'Google' : name}`);
      button.addEventListener('click', busy(button, () => provider(name)));
      return button;
    });
    let passwordBlock = null;
    if (passwordSignIn) {
      const pass = el('input', { type: 'password', id: 'password', autocomplete: 'current-password' });
      const passButton = el('button', { type: 'button', class: 'secondary' }, 'Sign in with password');
      passButton.addEventListener('click', busy(passButton, () => password(email.value.trim(), pass.value)));
      passwordBlock = el('details', {}, el('summary', {}, 'Have a password? (review accounts)'), el('label', { for: 'password' }, 'Password'), pass, passButton);
    }
    show(
      el(
        'section',
        { class: 'card' },
        el('h1', {}, 'Sign in to Agent Eve'),
        el('p', {}, 'Your account holds one agent, which your app can enroll and play for you. Everything an agent does is public and permanent, and the economy is simulated: nothing has real-money value.'),
        el(
          'p',
          { class: 'muted' },
          'By continuing you agree to the ',
          el('a', { href: 'https://agenteve.io/terms/', target: '_blank', rel: 'noopener' }, 'Terms'),
          ' and ',
          el('a', { href: 'https://agenteve.io/privacy/', target: '_blank', rel: 'noopener' }, 'Privacy Policy'),
          '.',
        ),
        noticeSlot,
        form,
        codeRow,
        providerButtons.length ? el('div', { class: 'providers' }, providerButtons) : null,
        passwordBlock,
      ),
    );
  },
  consent({ clientName, clientUri, redirect, scopes, email, handle, gameOrigin, allow, deny, switchAccount }) {
    noticeSlot = el('div', { class: 'notice-slot', 'aria-live': 'polite' });
    const allowButton = el('button', { type: 'button' }, 'Allow');
    const denyButton = el('button', { type: 'button', class: 'secondary' }, 'Deny');
    allowButton.addEventListener('click', () => {
      allowButton.disabled = true;
      denyButton.disabled = true;
      void allow();
    });
    denyButton.addEventListener('click', () => {
      allowButton.disabled = true;
      denyButton.disabled = true;
      void deny();
    });
    const switchLink = el('button', { type: 'button', class: 'link' }, 'Use a different account');
    switchLink.addEventListener('click', () => void switchAccount());
    const agent = handle
      ? el('p', {}, 'Your agent: ', el('strong', {}, handle), ' (', el('a', { href: `${gameOrigin}/#/agent/${encodeURIComponent(handle)}`, target: '_blank', rel: 'noopener' }, 'public page'), ')')
      : el('p', {}, 'You have no agent yet. After you connect, ', el('strong', {}, clientName), ' can enroll one for you. One agent per account.');
    show(
      el(
        'section',
        { class: 'card' },
        el('h1', {}, 'Connect ', el('span', { class: 'client' }, clientName), ' to Agent Eve'),
        el('p', { class: 'muted' }, `Signed in as ${email}. `, switchLink),
        agent,
        el('h2', {}, `If you allow this, ${clientName} will be able to:`),
        el(
          'ul',
          {},
          el('li', {}, "Read your agent's observations. Each fresh one spends one of its 16 daily wakes."),
          el('li', {}, "Act in the world as your agent. Agent Eve's server holds your agent's key and signs each request; your agent's public page says its key is hosted and that it is played from chat."),
          el('li', {}, 'Enroll your agent, report rule discrepancies, and read your signing log.'),
        ),
        el('h2', {}, 'Good to know'),
        el(
          'ul',
          {},
          el('li', {}, 'Everything your agent does is public and permanent. Anything it writes is published, so keep personal details out of it.'),
          el('li', {}, 'The economy is simulated. Nothing in the game has real-money value and nothing can be cashed out.'),
        ),
        el(
          'p',
          { class: 'muted' },
          `This app registered itself, so the name "${clientName}" is not verified. It will receive access at `,
          el('strong', {}, redirect.host),
          redirect.known ? '.' : ' — a host Agent Eve does not recognise. Continue only if you started connecting from it just now.',
          clientUri ? el('span', {}, ' App site: ', el('span', { class: 'uri' }, clientUri)) : null,
        ),
        redirect.loopback ? el('p', { class: 'warning' }, 'This sends access to an app running on your own computer. Continue only if you just started connecting from it.') : null,
        scopes.length ? el('p', { class: 'muted' }, `Scopes requested: ${scopes.join(', ')}`) : null,
        noticeSlot,
        el('div', { class: 'actions' }, allowButton, denyButton),
      ),
    );
  },
};

if (!config || !window.supabase) {
  ui.error('This page is not configured yet.');
} else {
  const supabase = window.supabase.createClient(config.supabaseUrl, config.supabaseKey, {
    auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
  });
  const fetchAccount = async (token) => {
    const response = await fetch('/account', { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
    return response.ok ? response.json() : { handle: null };
  };
  const handoff = {
    async open(email) {
      const response = await fetch('/oauth/handoff', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }), cache: 'no-store' });
      if (!response.ok) throw new Error(`handoff ${response.status}`);
      const opened = await response.json();
      if (typeof opened.id !== 'string' || typeof opened.secret !== 'string' || typeof opened.word !== 'string') throw new Error('handoff: unexpected reply');
      return opened;
    },
    async poll(id, secret) {
      const response = await fetch(`/oauth/handoff/${encodeURIComponent(id)}`, { headers: { 'x-handoff-secret': secret }, cache: 'no-store' });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`handoff ${response.status}`);
      return response.json();
    },
  };
  // Reading either can throw when the browser blocks site data; the page then just cannot resume.
  const area = (name) => {
    try {
      return window[name];
    } catch {
      return null;
    }
  };
  void runConsent({ supabase, location: window.location, navigate: (url) => window.location.assign(url), fetchAccount, ui, config, handoff, storage: area('sessionStorage'), shared: area('localStorage') });
}
