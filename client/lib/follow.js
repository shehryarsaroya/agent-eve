/* AGENT EVE — follow a principal by email.
 *
 * One small form, drawn on both public-record pages: #/agent/<handle> (landing.js) and the
 * PRINCIPALS screen (screens.js). It POSTs {handle, email} to api/follow and shows the
 * server's own sentence back — the server is the only thing that knows whether mail is
 * switched on, and its refusals are written to be read by a person.
 *
 * TWO THINGS THIS FILE EXISTS TO GET RIGHT.
 *
 *   1. The page re-renders every five seconds (app.js polls live.json and every screen
 *      rebuilds its DOM). A form rebuilt on each render would eat the address mid-typing.
 *      So the form is built ONCE per handle and re-attached; mount() notes whether its
 *      input had focus before the move, and refocus() restores it after the screen has
 *      put the new tree in the document.
 *   2. Nothing the server says is ever parsed as markup: `detail` goes in via textContent.
 *
 * The answer to a request is deliberately the same whether or not that address already
 * follows anyone (no enumeration), so this form can only ever say "check your inbox".
 */
/* eslint-env browser */
/* global U */
'use strict';

var FollowForm = (function () {
  var el = U.el;
  // Relative, like the frames: resolves to /api/follow at the root and under any mount.
  var API = 'api/follow';
  var MAX_FORMS = 32;
  var forms = {};
  var count = 0;

  function say(e, text, tone) {
    e.note.textContent = text;
    e.note.className = 'f-note' + (tone ? ' ' + tone : '');
  }

  function build(handle) {
    var input = el('input', {
      class: 'f-input', type: 'email', name: 'email', inputmode: 'email', autocomplete: 'email',
      autocapitalize: 'none', spellcheck: 'false', maxlength: '254',
      placeholder: 'you@example.com', 'aria-label': 'your email address',
    });
    var button = el('button', { class: 'f-go', type: 'submit', text: 'FOLLOW' });
    var note = el('p', { class: 'f-note', role: 'status', 'aria-live': 'polite' });
    var form = el('form', { class: 'f-form', novalidate: true }, [input, button]);
    var lede = 'One short email after each Reckoning, telling ' + handle + '\u2019s story from its public record. ' +
      'Confirm by link; unsubscribe in one click.';
    var node = el('section', { class: 'f-sec', 'aria-label': 'follow ' + handle + ' by email' }, [
      el('h3', { text: 'FOLLOW BY EMAIL' }),
      // `title` too: the console's one-row strip ellipsizes this sentence.
      el('p', { class: 'f-lede', title: lede, text: lede }),
      form,
      note,
    ]);
    var e = { handle: handle, node: node, input: input, button: button, note: note, busy: false };
    form.addEventListener('submit', function (ev) { ev.preventDefault(); submit(e); });
    return e;
  }

  function submit(e) {
    if (e.busy) return;
    var email = (e.input.value || '').trim();
    if (!email || email.indexOf('@') < 1) {
      say(e, 'Enter the address the updates should go to.', 'warn');
      return;
    }
    e.busy = true;
    e.button.disabled = true;
    say(e, 'Sending\u2026', '');
    fetch(API, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: e.handle, email: email }),
    }).then(function (r) {
      return r.text().then(function (t) {
        var j = null;
        try { j = JSON.parse(t); } catch (x) { j = null; }
        return { status: r.status, body: j };
      });
    }).then(function (res) {
      if (res.status === 202) {
        e.input.value = '';
        say(e, 'Check your inbox. If that address can receive mail, a confirmation link is on its way \u2014 ' +
          'nothing more is sent until you click it.', 'ok');
      } else {
        var detail = res.body && typeof res.body.detail === 'string' ? res.body.detail : '';
        say(e, detail || 'That did not work. Please try again later.', 'warn');
      }
    }).catch(function () {
      say(e, 'Could not reach the server. Please try again.', 'warn');
    }).then(function () {
      e.busy = false;
      e.button.disabled = false;
    });
  }

  function entry(handle) {
    if (!forms[handle]) {
      // Bounded: a viewer looks at a handful of principals, and a map that grew one form per
      // page visited forever would be a slow leak in a tab left open for a season.
      if (count >= MAX_FORMS) { forms = {}; count = 0; }
      forms[handle] = build(handle);
      count++;
    }
    return forms[handle];
  }

  /**
   * Put `handle`'s form into `host`. Returns {refocus}, to be called once the screen has put
   * its new tree into the document: moving a focused input out of the page blurs it.
   */
  function mount(host, handle) {
    var h = String(handle || '').toLowerCase().replace(/^p:/, '');
    if (!h) return { refocus: function () {} };
    var e = entry(h);
    var focused = document.activeElement === e.input;
    host.appendChild(e.node);
    return {
      refocus: function () {
        if (!focused || !document.body.contains(e.input)) return;
        try { e.input.focus({ preventScroll: true }); } catch (x) { e.input.focus(); }
      },
    };
  }

  return { mount: mount };
})();
