/* THE COMPACT — shared drawing helpers.
 *
 * Classic script, no modules, no build step: the deploy is an rsync of static
 * files and `index.html` has to open straight off disk.
 *
 * Everything here exists so that one concept is drawn ONE way everywhere. A
 * principal is always a handle chip; a broken promise is always the same red;
 * an empty panel always says which frame key is empty and what would fill it.
 * SPEC §3's one-word-per-concept rule has a pixel counterpart, and this file
 * is it.
 */
/* eslint-env browser */
'use strict';

var U = (function () {
  // ── DOM ────────────────────────────────────────────────────────────────
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'text') n.textContent = String(v);
        else if (k === 'html') n.innerHTML = v;
        else if (k === 'on') { for (var e in v) n.addEventListener(e, v[e]); }
        else n.setAttribute(k, v === true ? '' : String(v));
      }
    }
    add(n, kids);
    return n;
  }
  function add(n, kids) {
    if (kids === null || kids === undefined) return n;
    if (Array.isArray(kids)) { kids.forEach(function (k) { add(n, k); }); return n; }
    n.appendChild(typeof kids === 'string' || typeof kids === 'number'
      ? document.createTextNode(String(kids)) : kids);
    return n;
  }
  var NS = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs, kids) {
    var n = document.createElementNS(NS, tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'text') { n.textContent = String(v); continue; }
        if (k === 'on') { for (var e in v) n.addEventListener(e, v[e]); continue; }
        n.setAttribute(k, String(v));
      }
    }
    if (kids) (Array.isArray(kids) ? kids : [kids]).forEach(function (c) {
      if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }

  /**
   * ⚑ **A DRAW THAT THROWS INSIDE A rAF MUST STILL SAY WHAT BROKE.**
   *
   * `app.js` wraps `paint()` in a try/catch precisely so a broken screen is
   * never a blank page. The two map screens then defer their canvas draw to
   * `requestAnimationFrame` — which runs OUTSIDE that catch — so a
   * `ReferenceError` in the layout blanked the entire drill-down, printed
   * nothing to the console the harness could see, and left a fully rendered
   * set of rails around 1450×960 of black. It looked like an empty
   * constellation, which is a state this world genuinely has.
   *
   * That is this project's own defect at 1:1: a failure indistinguishable
   * from a legitimate empty. Every deferred draw goes through here.
   */
  function guard(host, fn) {
    return function () {
      try { fn(); } catch (e) {
        if (window.console) console.error(e);
        if (!host) return;
        clear(host).appendChild(el('div', { class: 'empty' }, [
          el('span', { class: 'mark' }),
          el('span', { class: 'say', text: 'the canvas failed on this frame' }),
          el('span', { class: 'why', text: String((e && e.message) || e) }),
        ]));
      }
    };
  }

  // ── numbers ────────────────────────────────────────────────────────────
  // `minor` is the currency unit. Compact form on tiles, exact form in tables:
  // a viewer skims the tile and audits the table, and rounding the table would
  // make the record wrong on screen while right on the wire.
  function n(v) {
    if (v === null || v === undefined) return '—';
    // `minor` is an integer unit. A tile that computes a share of it (elective
    // halves are `atStake * electiveBps / 10000`) was printing 13,276.75, and
    // a currency with a fractional part is a currency this world does not have.
    return Math.round(Number(v)).toLocaleString('en-US');
  }
  function k(v) {
    if (v === null || v === undefined) return '—';
    var a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
    if (a >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (a >= 1000) return Math.round(v / 1000) + 'K';
    return String(v);
  }
  function bps(v) { return v === null || v === undefined ? '—' : (v / 100).toFixed(v % 100 ? 2 : 0) + '%'; }
  function pct(x, of) { return of ? Math.round((100 * x) / of) + '%' : '0%'; }
  // Ticks are the world's clock; production is 300 s a tick, so a countdown is
  // both a tick count and real hours. Both are shown because a viewer thinks in
  // hours and an agent thinks in ticks.
  function clock(ticks, secondsPerTick) {
    var s = Math.max(0, Math.round(ticks * (secondsPerTick || 300)));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    return (h ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
  }
  function handleOf(pid) { return String(pid || '').replace(/^p:/, ''); }

  // ── the standard chips ─────────────────────────────────────────────────
  /**
   * A principal, drawn the one way.
   *
   * ★ RED DISCIPLINE. `bad: true` is opt-in and belongs ONLY on the screens
   * where judgement is the subject — THE STANDING, the dossier, the hall of
   * fame, and the handle on a VERGE. The first build painted every handle with
   * a historical default red, and in a mature world that is most of them: the
   * screen went red everywhere and the one alarm colour stopped meaning
   * anything. Red means A PROMISE WAS BROKEN, and on a row that is not about a
   * promise it means nothing, so it is not spent there.
   */
  function h(pid, opts) {
    var o = opts || {};
    var a = el('a', { class: 'h' + (o.bad ? ' bad' : ''), href: '#/principals/' + handleOf(pid), text: o.text || handleOf(pid) });
    if (o.title) a.setAttribute('title', o.title);
    return a;
  }
  function sysLink(id, label) {
    return el('a', { class: 'sysl', href: '#/map/' + id, text: label || id });
  }
  function tag(text, cls) { return el('span', { class: 'tag' + (cls ? ' ' + cls : ''), text: text }); }
  function sw(cls) { return el('i', { class: 'sw ' + cls }); }

  /**
   * The empty state — ONE DIM LINE, and the reasoning goes in the tooltip.
   *
   * Two constraints pull against each other here and the resolution matters.
   * A blank panel is this repo's oldest defect drawn at 1:1: a capability
   * nobody can tell from a missing one. So an empty panel has to SAY it is
   * empty. But the first build answered that with a centred five-sentence
   * paragraph quoting frame keys — `compactLinks[]`, `dossierBook`,
   * `receiptReel[]` — at the audience, on ten of twelve screens. The viewer is
   * not the API consumer, and a product whose most repeated element is an
   * apology written in JSON is not the product in the mocks.
   *
   * So: the viewer gets one short sentence in plain words. The engineer gets
   * the whole argument on hover, where it costs no pixels. Honest, and dense.
   */
  function empty(say, why) {
    var strip = el('div', { class: 'empty' }, [
      el('span', { class: 'mark' }),
      el('span', { class: 'say', text: say }),
    ]);
    if (why) strip.setAttribute('title', String(why).replace(/<[^>]+>/g, ''));
    return strip;
  }

  /**
   * The SPARSE state — an empty panel that keeps its structure.
   *
   * A page with nothing on it reads as a failed render; a page whose frames,
   * column headers and tiles are all present but blank reads as *not yet*. The
   * live world spends its first 288 ticks with no Reckoning frame at all, and
   * that is a normal state that must not look like an outage.
   */
  function skeleton(rows, cols) {
    var body = el('div', { class: 'skel' });
    for (var r = 0; r < (rows || 6); r++) {
      var line = el('div', { class: 'skel-row' });
      for (var c = 0; c < (cols || 4); c++) {
        line.appendChild(el('i', { style: 'flex:' + (c === 0 ? 2 : 1) }));
      }
      body.appendChild(line);
    }
    return body;
  }

  /** The one null token. A missing number is dim; it is never accent-bright. */
  function nul() { return el('span', { class: 'nul', text: '—' }); }

  // ── tables ─────────────────────────────────────────────────────────────
  /**
   * cols: [{ k, t, num, w, cell(row) -> node|string, sort(row) -> number|string }]
   * opts: { sort, dir, rowClass(row), onRow(row), sel(row), foot }
   */
  var sortState = {};
  function table(id, cols, rows, opts) {
    var o = opts || {};
    var st = sortState[id] || (sortState[id] = { k: o.sort || null, dir: o.dir || -1 });
    var data = rows.slice();
    if (st.k) {
      var col = cols.filter(function (c) { return c.k === st.k; })[0];
      if (col) {
        data.sort(function (a, b) {
          var va = col.sort ? col.sort(a) : a[col.k], vb = col.sort ? col.sort(b) : b[col.k];
          if (va === null || va === undefined) va = col.num ? -Infinity : '';
          if (vb === null || vb === undefined) vb = col.num ? -Infinity : '';
          if (typeof va === 'string' || typeof vb === 'string') {
            return String(va).localeCompare(String(vb)) * st.dir;
          }
          return (va - vb) * st.dir;
        });
      }
    }
    var thead = el('thead', null, el('tr', null, cols.map(function (c) {
      var th = el('th', {
        class: c.num ? 'num' : null,
        style: c.w ? 'width:' + c.w : null,
        'data-sorted': st.k === c.k ? (st.dir > 0 ? 'up' : 'down') : null,
        title: 'sort by ' + c.t,
      }, [c.t, el('span', { class: 'ar', text: st.k === c.k ? (st.dir > 0 ? '▲' : '▼') : '·' })]);
      th.addEventListener('click', function () {
        if (st.k === c.k) st.dir = -st.dir; else { st.k = c.k; st.dir = c.num ? -1 : 1; }
        if (o.rerender) o.rerender();
      });
      return th;
    })));
    var tbody = el('tbody', null, data.map(function (r) {
      var tr = el('tr', { class: [o.rowClass ? o.rowClass(r) : '', o.sel && o.sel(r) ? 'sel' : ''].join(' ').trim() || null });
      cols.forEach(function (c) {
        var v = c.cell ? c.cell(r) : r[c.k];
        tr.appendChild(el('td', { class: (c.num ? 'num ' : '') + (c.cls || '') || null },
          v === null || v === undefined ? '—' : v));
      });
      if (o.onRow) { tr.style.cursor = 'pointer'; tr.addEventListener('click', function () { o.onRow(r); }); }
      return tr;
    }));
    return el('table', { class: 't' + (o.onRow ? ' click' : '') }, [thead, tbody]);
  }

  /**
   * `panel(title, opts, body, extra)`.
   *
   * ★ `extra` exists because a dozen call sites were already passing a fourth
   * argument — `{ style: 'flex:0 0 214px' }` and friends — and the signature
   * took three, so every one of those sizing hints was silently dropped. The
   * hull ladder took 450 px of a screen it was told to take 214, and the map's
   * LAYERS panel was squeezed until its last row clipped. A silently ignored
   * argument is the quietest kind of bug there is.
   */
  function panel(title, opts, body, extra) {
    var o = opts || {};
    if (extra) { for (var xk in extra) if (o[xk] === undefined) o[xk] = extra[xk]; }
    var head = el('h2', { class: o.alarm ? 'alarm' : null }, [
      title,
      // a node OR a string. `text:` stringifies, so passing an element here
      // silently rendered `[object HTMLSpanElement]` into the subtitle.
      o.sub ? (typeof o.sub === 'string' || typeof o.sub === 'number'
        ? el('span', { class: 'sub', text: o.sub })
        : el('span', { class: 'sub' }, o.sub)) : null,
      o.right ? el('span', { class: 'right' }, o.right) : null,
    ]);
    var b = el('div', { class: 'body' + (o.pad ? ' pad' : '') }, body);
    return el('section', { class: 'panel' + (o.cls ? ' ' + o.cls : ''), style: o.style || null },
      [head, b, o.foot ? el('div', { class: 'foot' }, o.foot) : null]);
  }

  function tile(lab, val, opts) {
    var o = opts || {};
    return el('div', { class: 'tile' + (o.bad ? ' bad' : o.warn ? ' warn' : '') }, [
      el('div', { class: 'lab', text: lab }),
      el('div', { class: 'val' + (o.sm ? ' sm' : '') + (o.neutral ? ' neutral' : '') + (o.dim ? ' dimval' : ''), text: val }),
      o.note ? el('div', { class: 'note', text: o.note }) : null,
    ]);
  }

  function bar(frac, cls) {
    return el('div', { class: 'bar', style: 'flex:1 1 auto;min-width:0' }, el('i', {
      class: cls || null,
      style: 'width:' + Math.max(0, Math.min(100, frac * 100)).toFixed(1) + '%',
    }));
  }

  function kv(a, b, bad) {
    return el('div', { class: 'kv2' }, [el('span', { text: a }), el('span', { class: bad ? 'bad' : null }, b)]);
  }

  function pips(list) {
    // CLEARANCE PIPS — a grant's clearance set, drawn as filled squares. Two
    // slots because §7's clearance vocabulary is STORES and HANDS.
    var all = ['STORES', 'HANDS'];
    return el('span', { class: 'pips', title: (list || []).join(' · ') || 'act-only' },
      all.map(function (c) { return el('i', { class: (list || []).indexOf(c) >= 0 ? 'on' : '' }); }));
  }

  /**
   * ★ THE VENTURE GLYPH.  A13: a venture is a ring whose HOLLOW ARC is the part
   * riding on someone's word; an unfilled role is an empty socket that pulses.
   *
   * The escrowed part is a solid deep-cyan arc that auto-executes; the elective
   * part is drawn bright and open, because that is the half a principal can
   * simply decline to pay. A7 in one mark.
   */
  function glyph(g, size) {
    // Stroke scales with the ring. At a fixed 3px a 74px hero glyph reads as a
    // thin hoop and the escrow/elective split — the whole point of the mark —
    // becomes invisible at exactly the size where it matters most.
    var s = size || 30, sw = Math.max(2.4, s * 0.13), r = (s - sw) / 2 - 1;
    var cx = s / 2, cy = s / 2, C = 2 * Math.PI * r;
    var e = Math.max(0, Math.min(10000, g && g.electiveBps || 0)) / 10000;
    var snapped = g && g.state === 'SNAPPED_BLACK';
    var forming = g && g.state === 'FORMING';
    var kids = [];
    // A faint full track first, so the ring is legible as a RING even when one
    // of its two arcs is short.
    kids.push(svg('circle', {
      cx: cx, cy: cy, r: r, fill: 'none', stroke: '#0a1c22', 'stroke-width': sw,
    }));
    // escrowed arc: starts at 12 o'clock, runs clockwise for (1-e)
    kids.push(svg('circle', {
      class: 'g-escrow', cx: cx, cy: cy, r: r, 'stroke-width': sw,
      'stroke-dasharray': (C * (1 - e)).toFixed(2) + ' ' + (C * e).toFixed(2),
      transform: 'rotate(-90 ' + cx + ' ' + cy + ')',
    }));
    // elective arc: the rest, and the only part that can break
    kids.push(svg('circle', {
      class: 'g-elective' + (snapped ? ' snap' : ''), cx: cx, cy: cy, r: r, 'stroke-width': sw,
      'stroke-dasharray': (C * e).toFixed(2) + ' ' + (C * (1 - e)).toFixed(2),
      'stroke-dashoffset': (-C * (1 - e)).toFixed(2),
      transform: 'rotate(-90 ' + cx + ' ' + cy + ')',
      opacity: snapped ? 0.35 : 1,
    }));
    if (forming) {
      var total = (g && g.rolesTotal) || 0, filled = (g && g.rolesFilled) || 0;
      for (var i = filled; i < total; i++) {
        var ang = -Math.PI / 2 + (i / Math.max(1, total)) * 2 * Math.PI;
        kids.push(svg('circle', {
          class: 'g-socket', cx: (cx + r * Math.cos(ang)).toFixed(2),
          cy: (cy + r * Math.sin(ang)).toFixed(2), r: Math.max(2.6, sw * 0.95), 'stroke-width': 1.3,
        }));
      }
    }
    if (snapped) {
      kids.push(svg('line', {
        class: 'g-break', x1: cx + r * 0.62, y1: cy - r * 0.62, x2: cx + r * 1.05, y2: cy - r * 1.05,
      }));
      kids.push(svg('line', {
        class: 'g-break', x1: cx + r * 1.05, y1: cy - r * 0.62, x2: cx + r * 0.62, y2: cy - r * 1.05,
      }));
    }
    // ★ A TICK AT THE SPLIT. The two arcs are correct arithmetic — measured
    // 35.25 escrow against 18.60 elective on a 65/35 venture — and they still
    // did not READ, because a dark teal arc and a bright cyan arc at 6 px on a
    // near-black panel are not two things to the eye. A hard radial mark at the
    // boundary makes the split a fact rather than a shade.
    if (e > 0.01 && e < 0.99) {
      var ba = -Math.PI / 2 + 2 * Math.PI * (1 - e);
      kids.push(svg('line', {
        x1: (cx + (r - sw / 2 - 1) * Math.cos(ba)).toFixed(2),
        y1: (cy + (r - sw / 2 - 1) * Math.sin(ba)).toFixed(2),
        x2: (cx + (r + sw / 2 + 1) * Math.cos(ba)).toFixed(2),
        y2: (cy + (r + sw / 2 + 1) * Math.sin(ba)).toFixed(2),
        stroke: '#00060a', 'stroke-width': 1.6,
      }));
    }
    var title = g ? (g.state + ' · ' + bps(g.electiveBps) + ' elective · ' +
      (g.rolesFilled || 0) + '/' + (g.rolesTotal || 0) + ' roles') : '';
    return svg('svg', { class: 'glyph', width: s, height: s, viewBox: '0 0 ' + s + ' ' + s },
      [svg('title', { text: title })].concat(kids));
  }

  /**
   * A crest tile out of the generated 4×4 plate, chosen deterministically.
   *
   * `span`, not `div`, and inline-block: a block element here put the handle on
   * its own line and blew every table row up from 22 px to 50 px, which is the
   * single biggest way a dense console stops looking dense.
   *
   * The plate has 16 marks and a world can hold more principals than that, so
   * two handles can collide on a crest. That is acceptable — the crest is a
   * recognition aid beside a name that is always present, never the identifier.
   */
  function crest(pid, size) {
    var hh = 0, s = String(pid || '');
    for (var i = 0; i < s.length; i++) hh = (hh * 31 + s.charCodeAt(i)) >>> 0;
    var idx = hh % 16, col = idx % 4, row = (idx / 4) | 0;
    var px = size === 'lg' ? 62 : size === 'md' ? 26 : (size || 15);
    return el('span', {
      class: 'crest',
      title: handleOf(pid),
      style: 'width:' + px + 'px;height:' + px + 'px;flex:0 0 ' + px + 'px;' +
        'background-image:url(assets/crests.webp);background-size:400% 400%;' +
        'background-position:' + (col * 33.3333).toFixed(4) + '% ' + (row * 33.3333).toFixed(4) + '%',
    });
  }
  /** One tile out of a generated N×M plate. */
  function plateTile(src, cols, rows, index, cls) {
    var col = index % cols, row = (index / cols) | 0;
    return el('span', {
      class: cls || 'mark-ico',
      style: 'display:inline-block;background-image:url(' + src + ');' +
        'background-size:' + cols * 100 + '% ' + rows * 100 + '%;' +
        'background-position:' + (cols > 1 ? (col * 100) / (cols - 1) : 0).toFixed(3) + '% ' +
        (rows > 1 ? (row * 100) / (rows - 1) : 0).toFixed(3) + '%',
    });
  }
  var GOOD_IDX = { ore: 0, ration: 1, alloy: 2, fuel: 3 };
  function goodIcon(g) { return plateTile('assets/goods.webp', 2, 2, GOOD_IDX[g] || 0, 'good-ico'); }
  // marks.png is 4×3: seals (kept/contradicted/sealed/lapsed), RUIN/wreck/anchor/works, hand states
  var MARK = {
    SEAL_KEPT: 0, SEAL_BROKEN: 1, SEAL_SHUT: 2, SEAL_LAPSED: 3,
    RUIN: 4, WRECK: 5, ANCHOR: 6, WORKS: 7,
    IDLE: 8, TRANSIT: 9, COMMITTED: 10, RECOVERING: 11,
  };
  function mark(name, big) { return plateTile('assets/marks.webp', 4, 3, MARK[name] || 0, 'mark-ico' + (big ? ' lg' : '')); }
  /**
   * A HALL OF FAME title's own pictogram, out of a generated 2x2 plate.
   *
   * The build reused the principal-crest family here, so the icon beside
   * "MOST BROKEN" was a randomly-hashed starburst and carried no meaning at
   * all. These four mean their titles: a rising bar chart, a snapped chain in
   * red, an unbroken shield, a hub with six spokes.
   */
  var TITLE_IDX = {
    'MOST KEPT, BY VALUE': 0, 'MOST BROKEN': 1,
    'NEVER BROKEN A PROMISE': 2, 'WIDEST CIRCLE': 3,
  };
  function titleIcon(title) {
    var i = TITLE_IDX[String(title || '').toUpperCase()];
    if (i === undefined) return null;
    return plateTile('assets/titles.webp', 2, 2, i, 'title-ico');
  }

  return {
    el: el, svg: svg, clear: clear, add: add, guard: guard,
    n: n, k: k, bps: bps, pct: pct, clock: clock, handleOf: handleOf,
    h: h, sysLink: sysLink, tag: tag, sw: sw, empty: empty, skeleton: skeleton, nul: nul,
    table: table, panel: panel, tile: tile, bar: bar, kv: kv, pips: pips,
    glyph: glyph, crest: crest, goodIcon: goodIcon, mark: mark, titleIcon: titleIcon, plateTile: plateTile,
    MARK: MARK,
  };
})();
