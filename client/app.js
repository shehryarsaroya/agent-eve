/* AGENT EVE — the spectator console: data layer, router, backdrop.
 *
 * SPEC §15.5: static cacheable files behind Cloudflare, NOT per-connection SSE.
 * The Reckoning is exactly when you have an audience, which is exactly when a
 * connection-per-viewer model falls over. So this is a poller against three
 * static files and nothing else. No database handle, no live-sim socket — which
 * is how A9 parity holds BY CONSTRUCTION rather than by review: the client
 * cannot show a fact it did not read out of a published frame, because a
 * published frame is the only thing it can read.
 *
 * TWO CLOCKS.
 *   frames/live.json    rewritten every tick   — motion. Polled fast.
 *   frames/latest.json  once per 288 ticks     — the ceremony. Polled slowly,
 *                                                and re-read the moment
 *                                                `live.lastReckoning` moves.
 *   frames/index.json   the scrubber           — every Reckoning ever, free.
 *
 * A re-seeded world has no `latest.json` at all (404 until the first
 * settlement). That is a NORMAL STATE, not an error, and every screen has to
 * read as "nothing yet" rather than as a broken layout when it happens.
 */
/* eslint-env browser */
'use strict';

var App = (function () {
  var el = U.el;

  var S = {
    R: null,            // the Reckoning frame currently shown
    L: null,            // the live frame
    index: [],          // every Reckoning on disk
    pinned: null,       // a Reckoning the viewer scrubbed to, if any
    screen: 'overview',
    arg: null,
    slice: 'ALL',   // OVERVIEW's second-level filter
    lastLiveAt: 0,
    liveFail: 0,
    derived: null,
  };

  var TABS = [
    ['overview', 'OVERVIEW', 'F1'], ['principals', 'PRINCIPALS', 'F2'],
    ['ventures', 'VENTURES', 'F3'], ['grants', 'GRANTS', 'F4'],
    ['market', 'MARKET', 'F5'], ['map', 'MAP', 'F6'],
    ['standings', 'STANDINGS', 'F7'], ['reckoning', 'RECKONING', 'F8'],
  ];

  // ── fetch ──────────────────────────────────────────────────────────────
  // `no-store` on the two moving pointers, plain cache on an archived
  // Reckoning: an archived frame is immutable by contract and revalidating it
  // is pure waste in front of an audience.
  function getJSON(path, moving) {
    return fetch(path, moving ? { cache: 'no-store' } : {}).then(function (r) {
      if (!r.ok) return null;
      return r.text().then(function (t) {
        if (t.slice(0, 40).indexOf('<') >= 0) return null;  // nginx fell through to index.html
        try { return JSON.parse(t); } catch (e) { return null; }
      });
    }).catch(function () { return null; });
  }

  function pollLive() {
    return getJSON('frames/live.json', true).then(function (j) {
      if (!j) { S.liveFail++; return; }
      S.liveFail = 0; S.lastLiveAt = Date.now();
      var settled = S.L && j.lastReckoning !== S.L.lastReckoning;
      S.L = j;
      if (settled && !S.pinned) { loadIndex(); loadLatest(); }
      render();
    });
  }
  function loadLatest() {
    return getJSON('frames/latest.json', true).then(function (j) {
      if (j) { S.R = j; S.pinned = null; render(); }
    });
  }
  function loadIndex() {
    return getJSON('frames/index.json', true).then(function (j) {
      S.index = (j && j.reckonings) || [];
      render();
    });
  }
  function loadReckoning(file) {
    return getJSON('frames/' + file, false).then(function (j) {
      if (j) { S.R = j; S.pinned = file; render(); }
    });
  }

  // ── derive ─────────────────────────────────────────────────────────────
  // One pass, once per render, so no screen has to re-scan an array. Also the
  // one place a live key is preferred over a Reckoning key, written down: the
  // live frame is NEWER, so for anything both frames carry it wins.
  function derive() {
    var R = S.R || {}, L = S.L;
    var sysIndex = {};
    (R.map || []).forEach(function (s) { sysIndex[s.id] = s; });
    var byPrincipal = {};
    (R.standings || []).forEach(function (r) { byPrincipal[r.principal] = r; });
    var glyphs = (L && L.glyphs && L.glyphs.length) ? L.glyphs : (R.glyphs || []);
    var glyphIndex = {};
    glyphs.forEach(function (g) { glyphIndex[g.venture] = g; });
    var links = (L && L.compactLinks && L.compactLinks.length) ? L.compactLinks : (R.compactLinks || []);
    var authority = (L && L.authorityLines && L.authorityLines.length) ? L.authorityLines : (R.authorityLines || []);
    var ticker = (L && L.ticker && L.ticker.length) ? L.ticker : (R.ticker || []);
    var laneCount = 0, straitCount = 0, severCount = 0;
    (R.map || []).forEach(function (s) {
      laneCount += (s.lanes || []).length;
      (s.straits || []).forEach(function (t) { straitCount++; if (t.severs) severCount++; });
    });
    return {
      R: R, L: L, index: S.index, sysIndex: sysIndex, byPrincipal: byPrincipal,
      glyphs: glyphs, glyphIndex: glyphIndex, links: links, authority: authority, ticker: ticker,
      laneCount: laneCount / 2, straitCount: straitCount / 2, severCount: severCount / 2,
      rerender: render, loadReckoning: loadReckoning,
      slice: S.slice, setSlice: function (v) { S.slice = v; render(); },
    };
  }

  // ── chrome ─────────────────────────────────────────────────────────────
  function drawChrome() {
    // ── the door chip and the handle chip live between brand and tabs ──
    var chip = document.getElementById('doorchip');
    if (!chip) {
      chip = el('button', { id: 'doorchip', text: '⌘ SEND YOUR AGENT' });
      chip.addEventListener('click', function () { if (window.ATDoor) ATDoor.show(S.derived); });
      var brand = document.getElementById('brand');
      brand.parentNode.insertBefore(chip, brand.nextSibling);
    }
    // …and the repo, one small chip, from every screen. The door carries the
    // big version; this is for whoever dismissed it and got curious later.
    if (!document.getElementById('ghchip')) {
      var ghc = el('a', {
        id: 'ghchip', href: 'https://github.com/shehryarsaroya/agent-eve',
        target: '_blank', rel: 'noopener', text: 'GITHUB \u2197',
      });
      chip.parentNode.insertBefore(ghc, chip.nextSibling);
    }
    var mine = window.ATDoor ? ATDoor.handle() : null;
    var mychip = document.getElementById('mychip');
    if (mine && !mychip) {
      mychip = el('a', { id: 'mychip', href: '#/agent/' + encodeURIComponent(mine) });
      chip.parentNode.insertBefore(mychip, chip.nextSibling);
    }
    if (mychip) {
      if (mine) { U.clear(mychip).appendChild(el('span', { text: '◉ ' + mine })); mychip.href = '#/agent/' + encodeURIComponent(mine); }
      else mychip.remove();
    }

    var tabs = document.getElementById('tabs');
    if (!tabs.childNodes.length) {
      TABS.forEach(function (t) {
        tabs.appendChild(el('button', {
          'data-t': t[0], on: { click: function () { location.hash = '#/' + t[0]; } },
        }, [el('span', { class: 'fk', text: t[2] }), t[1]]));
      });
      // the mock terminates its tab strip in one empty bordered cell rather
      // than in nothing; that cell is most of why its chrome reads as an
      // application window and not as a web page
      tabs.appendChild(el('span', { class: 'fillcell' }));
    }
    // `zoom` is a drill-down of MAP, not a ninth tab: it has no F-key, it is
    // only reachable from the map, and the tab strip must not go blank while
    // you are inside it.
    var lit = S.screen === 'zoom' ? 'map' : S.screen;
    Array.prototype.forEach.call(tabs.childNodes, function (b) {
      if (b.getAttribute) b.setAttribute('aria-current', b.getAttribute('data-t') === lit ? 'true' : 'false');
    });

    var c = U.clear(document.getElementById('clock'));
    var L = S.L, R = S.R;
    var stale = S.liveFail > 2 || (S.lastLiveAt && Date.now() - S.lastLiveAt > 90000);
    if (L) {
      c.appendChild(el('div', { class: 'seg' }, [el('em', { text: 'TICK' }), el('b', { text: String(L.tick) })]));
      c.appendChild(el('div', { class: 'seg' }, [el('em', { text: 'PHASE' }), el('b', { text: L.phase })]));
      c.appendChild(el('div', { class: 'seg' + (L.ticksUntilReckoning < 24 ? ' warn' : '') }, [
        el('em', { text: 'RECKONING IN' }),
        el('b', { text: L.ticksUntilReckoning + 't · ' + U.clock(L.ticksUntilReckoning) }),
      ]));
      if ((L.meters || {}).raidsLive) {
        // ⚑ AMBER. `app.css` writes the rule down twice — *"a raid is a LOSS,
        // not a betrayal"* — and the chrome broke it on every screen. On the
        // `con-4` drill-down, where nobody holds anything and nobody has
        // broken anything, this was the ONLY red mark on the frame: one
        // accusation, and a false one.
        c.appendChild(el('div', { class: 'seg' }, [
          el('em', { text: 'RAIDS' }),
          el('b', { style: 'color:var(--amber)', text: String(L.meters.raidsLive) }),
        ]));
      }
    } else {
      c.appendChild(el('div', { class: 'seg stale' }, [el('em', { text: 'LIVE FRAME' }), el('b', { text: 'NOT READ' })]));
    }
    if (R && R.reckoningIndex !== undefined) {
      c.appendChild(el('div', { class: 'seg' }, [
        el('em', { text: S.pinned ? 'SHOWING' : 'LAST SETTLED' }),
        el('b', { text: 'R' + R.reckoningIndex }),
      ]));
    }
    c.appendChild(el('div', { class: 'seg' + (stale ? ' stale' : '') }, [
      stale ? el('b', { text: 'STALE' }) : el('i', { class: 'pip' }),
    ]));
    c.appendChild(el('div', { class: 'wc' }, [
      el('span', { text: '\u2500' }), el('span', { text: '\u25a2' }), el('span', { text: '\u2715' }),
    ]));
  }

  // ── render ─────────────────────────────────────────────────────────────
  var busy = false;
  function render() {
    if (busy) return; busy = true;
    requestAnimationFrame(function () {
      busy = false;
      try { paint(); } catch (e) {
        /* A broken screen must still say what broke. Never a blank page. */
        var host = document.getElementById('stage');
        U.clear(host).appendChild(U.el('div', { class: 'empty' }, [
          U.el('div', { class: 'mark' }),
          U.el('div', { class: 'say', text: 'the renderer failed on this frame' }),
          U.el('div', { class: 'why', text: String(e && e.stack || e) }),
        ]));
        if (window.console) console.error(e);
      }
    });
  }
  function paint() {
    document.getElementById('boot').classList.add('gone');
    drawChrome();
    var D = derive();
    S.derived = D;
    // The door waits for a live frame so it never opens over a blank page,
    // then opens exactly once per browser (localStorage.at_seen).
    if (window.ATDoor) ATDoor.maybeShow(D);
    var host = document.getElementById('stage');
    var fn = Screens[S.screen] || Screens.overview;
    fn(host, D, S.arg);
    drawTicker(D);
  }
  function drawTicker(D) {
    var t = document.getElementById('ticker');
    var text = (D.ticker || []).join('   ');
    var run = t.querySelector('.run');
    if (!run) {
      U.clear(t);
      t.appendChild(el('div', { class: 'lead', text: 'THE RECORD' }));
      run = el('div', { class: 'run' });
      // the marquee gets its own clipped track so it cannot run under the chip
      t.appendChild(el('div', { class: 'track' }, run));
    }
    if (run.getAttribute('data-t') !== text) {
      run.setAttribute('data-t', text);
      U.clear(run);
      var lines = (D.ticker || []).length ? D.ticker : ['the record is quiet'];
      // written twice, so translateX(-50%) is a seamless loop
      lines.concat(lines).forEach(function (line) { run.appendChild(el('i', { text: line })); });
    }
  }

  // ── router ─────────────────────────────────────────────────────────────
  function route() {
    var p = (location.hash || '#/').replace(/^#\/?/, '').split('/');
    // The empty hash is the CONSOLE with the door floating over it on a first
    // visit (ATDoor.maybeShow) — the world stays visible under the pitch,
    // which is the pitch. Every named screen keeps its URL.
    var name = p[0] || 'overview';
    if (!Screens[name]) name = 'overview';
    S.screen = name; S.arg = p[1] ? decodeURIComponent(p[1]) : null;
    if (name === 'map' && S.arg) MapView.select(S.arg);
    render();
  }

  // ── the backdrop ───────────────────────────────────────────────────────
  /*
   * Canvas 2D, not three.js, and the reasoning is worth writing down because
   * the brief said "three.js to whatever".
   *
   * Every element of the target is flat UI: panels, hairline tables and a 2D
   * node-link graph. A WebGL context would buy nothing for any of it, and
   * vendoring three.js means ~600 KB of dependency behind Cloudflare for a
   * parallax starfield that costs 90 lines here. The one place 3D would be
   * defensible is exactly this backdrop, and this backdrop must never compete
   * with the data — so the correct amount of it is the cheapest thing that
   * looks right.
   *
   * The palette is read out of the SAME CSS custom properties the interface
   * uses. A backdrop one hue off the UI is instantly obvious.
   */
  function starfield() {
    var cv = document.getElementById('stars');
    if (!cv) return;
    var ctx = cv.getContext('2d');
    var css = getComputedStyle(document.documentElement);
    var cyan = (css.getPropertyValue('--cyan') || '#19d7f2').trim();
    var deep = (css.getPropertyValue('--cyan-deep') || '#0a6a7d').trim();
    var stars = [], drift = 0, W = 0, H = 0, dpr = Math.min(2, window.devicePixelRatio || 1);
    function seedRand(s) { return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; }
    function build() {
      W = cv.clientWidth; H = cv.clientHeight;
      cv.width = W * dpr; cv.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var r = seedRand(20260731), n = Math.round((W * H) / 5200);
      stars = [];
      for (var i = 0; i < n; i++) {
        stars.push({
          x: r() * W, y: r() * H,
          z: 0.25 + r() * 0.75,
          a: 0.05 + r() * 0.4,
          c: r() > 0.93 ? deep : '#8fa3a8',
          tw: r() * 6.28,
        });
      }
    }
    function frame(t) {
      if (cv.clientWidth !== W || cv.clientHeight !== H) build();
      ctx.clearRect(0, 0, W, H);
      drift = (t || 0) / 90000;
      for (var i = 0; i < stars.length; i++) {
        var s = stars[i];
        var x = (s.x + drift * 26 * s.z) % W, y = s.y;
        // a slow twinkle, well under the threshold where it would draw the eye
        var a = s.a * (0.72 + 0.28 * Math.sin((t || 0) / 2600 + s.tw));
        ctx.globalAlpha = a;
        ctx.fillStyle = s.c;
        var r2 = s.z * 1.05;
        ctx.fillRect(x, y, r2, r2);
      }
      // one very faint sweep, tied to the tick, so the page is never truly still
      if (S.L) {
        ctx.globalAlpha = 0.03;
        ctx.strokeStyle = cyan;
        ctx.lineWidth = 1;
        var yy = ((S.L.tick % 288) / 288) * H;
        ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(W, yy); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      requestAnimationFrame(frame);
    }
    build();
    requestAnimationFrame(frame);
  }

  // ── boot ───────────────────────────────────────────────────────────────
  function boot() {
    window.addEventListener('hashchange', route);
    window.addEventListener('keydown', function (e) {
      var i = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8'].indexOf(e.key);
      if (i >= 0) { e.preventDefault(); location.hash = '#/' + TABS[i][0]; }
    });
    var to = null;
    window.addEventListener('resize', function () { clearTimeout(to); to = setTimeout(render, 180); });
    starfield();
    route();
    loadIndex();
    loadLatest();
    pollLive();
    // The live frame is `max-age=2` and rewritten every tick. 5 s is fast
    // enough that a turbo world visibly moves and slow enough that a production
    // world (300 s a tick) costs an audience almost nothing behind Cloudflare.
    setInterval(pollLive, 5000);
    // The Reckoning frame changes once a day in production; the settlement
    // itself is caught by `lastReckoning` moving on the live frame, so this is
    // only a backstop for a viewer who arrived during the gap.
    setInterval(function () { if (!S.pinned) { loadLatest(); loadIndex(); } }, 120000);
  }

  return { boot: boot, state: S, render: render };
})();

document.addEventListener('DOMContentLoaded', App.boot);
