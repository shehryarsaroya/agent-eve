/* THE COMPACT — ★ THE CONSTELLATION, DRILLED INTO.
 *
 * The second screen the owner picked out of the concept round, and the reason
 * it was picked: **it is the only one of the seven that adds INFORMATION
 * rather than mood.** Every field it draws is live on the frame right now and
 * was, before this file, rendered by nothing at all:
 *
 *   `worksLines[].occupants`      seven principals share `sys-05` and the map
 *                                 drew one 8 px triangle for all seven
 *   `worksLines[].sharePerTick`   what each of them actually takes per tick
 *   `worksLines[].extracted`      what the ground has already handed over
 *   `worksLines[].legend`         `EXTRACTING` · `SPINNING UP 9 ticks`
 *   `claimLines[].anchorHot`      a claim collecting nothing looks, on the
 *                                 map, exactly like one collecting everything
 *   `claimLines[].tenants`        who is paying rent to whom
 *   `claimLines[].state`          `CEDED` and `LAPSED` are different endings
 *   `ruins[]`                     memory: what stopped, and who ended it
 *   `swayLines[].reachers`        whether a border means anything
 *
 * That list is this repo's own refrain at 1:1 — *a capability that exists and
 * is never exercised is indistinguishable from one that is missing* — and this
 * screen is the exercise. THE MAP answers "where is the trouble". THIS answers
 * "what is actually happening on this ground, and to whom".
 *
 * ⚑ **POSITION IS PRESERVED FROM THE MAP, NOT RECOMPUTED.** §6.2 pins layout
 * so a place keeps its meaning between Reckonings. A drill-down that arranges
 * the same eight systems in a different order teaches a viewer the arrangement
 * twice and makes one of the two a lie. So the members' galaxy coordinates are
 * fitted into this viewport with a UNIFORM scale — same relative geometry,
 * bigger — and only then separated far enough apart to carry labels.
 */
/* eslint-env browser */
'use strict';

var ZoomView = (function () {
  var S = U.svg;

  /** disc radius from THE LODE, the same channel the map sizes nodes on. */
  function discR(y, minY, maxY) {
    var t = maxY > minY ? (y - minY) / (maxY - minY) : 0.5;
    return 38 + 16 * t;
  }

  /** the room a disc's own labels need below it: state lines run r+26 … r+62. */
  function belowNeed(R) { return R + 68; }

  /** the widest `handle · STATE` label a disc puts beside itself, in px. */
  var LABEL_W = 132;

  /**
   * Members' galaxy positions → this viewport: fit, separate, re-fit, dodge
   * the floating panels. Fixed iteration counts and no randomness anywhere, so
   * the same frame lays out the same way every poll.
   */
  function place(members, gal, W, H, R, ins, avoid) {
    var MX = R + 58;
    var L = ins.l + MX, T = ins.t + R + 52, Rg = W - ins.r - MX, B = H - ins.b - belowNeed(R);
    var FW = Math.max(200, Rg - L), FH = Math.max(200, B - T);
    var pts = members.map(function (m) {
      var p = gal.pos[m.id];
      return { id: m.id, sys: m, x: p ? p.x : 0, y: p ? p.y : 0 };
    });
    function bbox() {
      var b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      pts.forEach(function (p) {
        b.x0 = Math.min(b.x0, p.x); b.x1 = Math.max(b.x1, p.x);
        b.y0 = Math.min(b.y0, p.y); b.y1 = Math.max(b.y1, p.y);
      });
      return b;
    }
    /**
     * Fit the current arrangement into the free rect.
     *
     * ★ **NEARLY UNIFORM, CAPPED AT 1.4.** A pure uniform fit is the honest
     * one — §6.2 pins layout and a drill-down that rearranges the same seven
     * systems teaches the arrangement twice. But `con-1` is four COMMONS at
     * the hub and three MARCHES on an arc, so its bbox is 685×682 fitted into
     * a 1260×722 free rect: height-bound at k=1.06, and 575 px of the width
     * stayed black while three discs sat 15 px apart.
     *
     * 1.4 is the compromise, and it is a compromise rather than a fix: a
     * stretch that far still reads as the same constellation — every
     * left-of / above-of relation is preserved, because an axis-aligned
     * positive scale preserves ordering on both axes — while a 2:1 stretch
     * starts inventing a shape that exists on no other screen.
     */
    var ANISO = 1.4;
    function fit(cap) {
      var b = bbox();
      var bw = Math.max(1, b.x1 - b.x0), bh = Math.max(1, b.y1 - b.y0);
      var kx = FW / bw, ky = FH / bh, k = Math.min(kx, ky);
      if (cap !== undefined) { kx = Math.min(kx, cap); ky = Math.min(ky, cap); k = Math.min(k, cap); }
      kx = Math.min(kx, k * ANISO); ky = Math.min(ky, k * ANISO);
      var ox = L + (FW - bw * kx) / 2 - b.x0 * kx, oy = T + (FH - bh * ky) / 2 - b.y0 * ky;
      pts.forEach(function (p) { p.x = p.x * kx + ox; p.y = p.y * ky + oy; });
    }
    fit();

    // separation — a labelled disc needs room for a name above, a state line
    // below and two columns of holder labels beside it.
    // 132, not 104: a disc carries a 3-line name stack ~43 px above it and up
    // to four state lines ~71 px below, so two discs 196 px apart printed
    // `kestrel SWAY 2 · REACHERS 1` through `GALLOW GREEN`. The separation has
    // to clear the LABELS, not the discs.
    var MIN = 2 * R + 132;
    function separate(iter) {
      for (var it = 0; it < iter; it++) {
        for (var i = 0; i < pts.length; i++) {
          for (var j = i + 1; j < pts.length; j++) {
            var a = pts[i], b2 = pts[j];
            var dx = b2.x - a.x, dy = b2.y - a.y, d = Math.hypot(dx, dy) || 0.01;
            if (d >= MIN) continue;
            var push = (MIN - d) / 2 / d;
            a.x -= dx * push; a.y -= dy * push; b2.x += dx * push; b2.y += dy * push;
          }
        }
        pts.forEach(function (p) {
          p.x = Math.max(L, Math.min(Rg, p.x));
          p.y = Math.max(T, Math.min(B, p.y));
        });
      }
    }
    separate(220);

    /* ★ RE-FIT AFTER SEPARATING, AND SCALE UP ONLY.
     *
     * Round 1 fitted the galaxy bbox first and separated second, and the
     * clamp did the rest of the work: `con-1` is four COMMONS systems at the
     * hub and three MARCHES on a ring, so its bbox is long and thin, the fit
     * squeezed it against two edges, and separation then pinned three discs
     * to the boundary while the upper-left third of the screen stayed black.
     * Re-fitting the SEPARATED arrangement uses the room. Scaling up can only
     * increase the gaps, so it can never undo the separation it follows —
     * scaling DOWN could, which is why `fit(1)` is capped. */
    fit(1e9);
    var b3 = bbox();
    if (b3.x1 - b3.x0 < FW && b3.y1 - b3.y0 < FH) fit();

    /* ★ AND THEN GET OUT FROM UNDER THE FLOATING PANELS.
     *
     * The locator sits bottom-left and the record strip runs along the bottom.
     * A disc under either is a system a viewer cannot read, which is the exact
     * failure that got the map's controls docked in the first place. Push
     * straight up — the shortest way out of a bottom-anchored rect, and it
     * never swaps two systems' left-to-right order. */
    // the clearance is `belowNeed`, the SAME figure the bottom clamp uses.
    // Round 1 used `R + 34` here and `R + 62` there, so a disc pushed off the
    // record strip landed 28 px short and its three state lines went under it
    // anyway — the panel stopped covering the disc and kept covering the only
    // lines on it that say what is happening.
    for (var pass = 0; pass < 3; pass++) {
      (avoid || []).forEach(function (rc) {
        pts.forEach(function (p) {
          if (p.x + R + 30 < rc.x || p.x - R - 30 > rc.x + rc.w) return;
          if (p.y + belowNeed(R) < rc.y) return;
          p.y = Math.max(T, rc.y - belowNeed(R));
        });
      });
      separate(40);
    }
    (avoid || []).forEach(function (rc) {
      pts.forEach(function (p) {
        if (p.x + R + 30 < rc.x || p.x - R - 30 > rc.x + rc.w) return;
        if (p.y + belowNeed(R) < rc.y) return;
        p.y = Math.max(T, rc.y - belowNeed(R));
      });
    });
    pts.forEach(function (p) {
      p.x = Math.max(L, Math.min(Rg, p.x));
      p.y = Math.max(T, Math.min(B, p.y));
    });

    var out = {};
    pts.forEach(function (p) { out[p.id] = p; });
    return out;
  }

  /**
   * ★ THE LOCATOR — stolen from the concept, bottom-left.
   *
   * The whole galaxy at 1/6 scale with the constellation you are inside boxed
   * and lit. It is not decoration: a drill-down with no locator is the oldest
   * way to lose someone in a map, and the answer costs 300×170 px.
   *
   * It reads the SAME `MapView.layout` the map itself draws from, so the
   * miniature and the thing it is a key to cannot disagree.
   */
  function locator(map, con, W, H) {
    var lay = MapView.layout(map, W, H, { l: 8, r: 8, t: 14, b: 14 });
    var P = lay.pos, kids = [], seen = {};
    map.forEach(function (s) {
      var a = P[s.id]; if (!a) return;
      (s.lanes || []).forEach(function (o) {
        var b = P[o]; if (!b) return;
        var kk = s.id < o ? s.id + o : o + s.id;
        if (seen[kk]) return; seen[kk] = 1;
        kids.push(S('line', {
          class: 'loc-lane', x1: a.x.toFixed(1), y1: a.y.toFixed(1),
          x2: b.x.toFixed(1), y2: b.y.toFixed(1),
        }));
      });
    });
    var bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    map.forEach(function (s) {
      var a = P[s.id]; if (!a) return;
      var on = s.constellation === con;
      if (on) {
        bx0 = Math.min(bx0, a.x); bx1 = Math.max(bx1, a.x);
        by0 = Math.min(by0, a.y); by1 = Math.max(by1, a.y);
      }
      kids.push(S('circle', {
        class: 'loc-n' + (on ? ' on' : ''), cx: a.x.toFixed(1), cy: a.y.toFixed(1), r: on ? 2.6 : 1.6,
      }));
    });
    if (bx0 < Infinity) {
      kids.push(S('rect', {
        class: 'loc-box', x: (bx0 - 9).toFixed(1), y: (by0 - 9).toFixed(1),
        width: (bx1 - bx0 + 18).toFixed(1), height: (by1 - by0 + 18).toFixed(1),
      }));
      // above the box when there is no room below it — at `by1 + 22` the label
      // fell off the bottom of a 178 px inset for two of the four
      // constellations, so the locator named the thing it was locating for
      // half the map and not the other half.
      var below = by1 + 22 < H - 3;
      kids.push(S('text', {
        class: 'loc-t', x: Math.max(26, Math.min(W - 26, (bx0 + bx1) / 2)).toFixed(1),
        y: (below ? by1 + 21 : Math.max(11, by0 - 15)).toFixed(1),
        'text-anchor': 'middle', text: String(con).toUpperCase().replace('CON-', 'CON '),
      }));
    }
    return S('svg', {
      class: 'locsvg', viewBox: '0 0 ' + W + ' ' + H,
      style: 'width:' + W + 'px;height:' + H + 'px;display:block',
    }, kids);
  }

  /* ════════════════════════════════════════════════════════ the renderer ══ */

  function render(host, D, con, selId, opts) {
    var o = opts || {}, R = D.R;
    var W = host.clientWidth || 1200, H = host.clientHeight || 700;
    var map = R.map || [];
    var members = map.filter(function (m) { return m.constellation === con; });
    if (!members.length) { U.clear(host); return; }

    var gal = MapView.layout(map, 1200, 800);
    MapView.setBlocOrder(R.standings);
    var minY = Infinity, maxY = -Infinity;
    members.forEach(function (m) {
      minY = Math.min(minY, m.yieldPerTick); maxY = Math.max(maxY, m.yieldPerTick);
    });
    var R0 = discR((minY + maxY) / 2, minY, maxY);
    var ins = o.inset || { l: 0, r: 0, t: 0, b: 0 };
    var P = place(members, gal, W, H, R0, ins, o.avoid || []);
    var inCon = {};
    members.forEach(function (m) { inCon[m.id] = m; });

    // ── the frame's rows, indexed by system ─────────────────────────────
    var works = {}, claims = {}, sway = {}, ruins = {}, places = {}, convoys = {};
    (R.worksLines || []).forEach(function (w) { (works[w.system] || (works[w.system] = [])).push(w); });
    (R.claimLines || []).forEach(function (c) { claims[c.system] = c; });
    (R.swayLines || []).forEach(function (s) { sway[s.system] = s; });
    (R.ruins || []).forEach(function (r) { (ruins[r.system] || (ruins[r.system] = [])).push(r); });
    (R.places || []).forEach(function (p) { places[p.system] = p; });
    ((D.L && D.L.convoyLines) || R.convoyLines || []).forEach(function (c) {
      (convoys[c.to] || (convoys[c.to] = [])).push(c);
    });

    var gStars = S('g', { class: 'starfield' }), gVerge = S('g'), gLanes = S('g'),
      gDisc = S('g'), gLab = S('g'), gSel = S('g');

    // the same seeded field, derived from the same ids
    MapView.starField(members, W, H).forEach(function (d, i) {
      if (d) gStars.appendChild(S('path', { class: MapView.STAR_BUCKETS[i], d: d }));
    });

    /* ══════════════════════════════════════════════ ★ WHO HOLDS THIS ════
     *
     * ⚑ **NOT A VERGE. A COLLAR — AND THE REASON IS THE VERGE'S OWN RULE.**
     *
     * `mapview.js` states it as law: THE VERGE is *one continuous solid
     * outline*, never dashed, because *"a gap in a fence reads as ground the
     * bloc does not hold, which is a false claim about a real principal."*
     *
     * At this zoom that mark cannot be drawn honestly. Round 3 tried it as a
     * union of discs at R0+46 and `kestrel`'s six systems in `con-2` sit
     * ~250 px apart, so the union produced SIX SEPARATE CIRCLES — a fence made
     * entirely of gaps, which is the exact false claim the rule exists to
     * prevent. Growing the radius until they merge (~125 px) swallows Gallow
     * Green, which `kestrel` does not hold: a false claim in the other
     * direction, and the worse of the two.
     *
     * So the zoom does not draw a fence at all. It tags each held disc with a
     * COLLAR — a 120° arc on its outboard side in the holder's colour, the
     * same colour the map fences that bloc in. A collar is a per-system mark
     * and makes no claim about the ground between two systems, which is
     * precisely the claim that cannot be made here. Whole-bloc territory is
     * the MAP's question and the map answers it correctly one click away.
     */
    var defaulters = {};
    (R.standings || []).forEach(function (r) { if (r.defaults > 0) defaulters[r.principal] = r.defaults; });
    var cxAll = 0, cyAll = 0;
    members.forEach(function (m) { cxAll += P[m.id].x; cyAll += P[m.id].y; });
    cxAll /= members.length; cyAll /= members.length;
    var collarSeen = {};
    (R.swayLines || []).forEach(function (s) {
      var p = P[s.system]; if (!s.principal || !p) return;
      if (inCon[s.system] && inCon[s.system].tier === 'COMMONS') return;   // A8
      var col = MapView.blocColour(s.principal);
      var rr = discR(inCon[s.system].yieldPerTick, minY, maxY) + 11;
      // outboard: away from the cluster centre, so a collar never sits on the
      // lane side where the labels and the pinch marks are
      var th = Math.atan2(p.y - cyAll, p.x - cxAll);
      var a1 = th - 1.05, a2 = th + 1.05;
      gVerge.appendChild(S('path', {
        class: 'zcollar', stroke: col,
        d: 'M' + (p.x + rr * Math.cos(a1)).toFixed(1) + ' ' + (p.y + rr * Math.sin(a1)).toFixed(1) +
          'A' + rr.toFixed(1) + ' ' + rr.toFixed(1) + ' 0 0 1 ' +
          (p.x + rr * Math.cos(a2)).toFixed(1) + ' ' + (p.y + rr * Math.sin(a2)).toFixed(1),
      }, S('title', { text: U.handleOf(s.principal) + ' holds this ground · sway ' + s.sway })));
      // the handle once per bloc, on its outboard-most member
      if (!collarSeen[s.principal] || collarSeen[s.principal].d < Math.hypot(p.x - cxAll, p.y - cyAll)) {
        collarSeen[s.principal] = { d: Math.hypot(p.x - cxAll, p.y - cyAll), p: p, th: th, col: col, pid: s.principal, rr: rr };
      }
    });
    Object.keys(collarSeen).sort().forEach(function (pid) {
      var c = collarSeen[pid];
      gVerge.appendChild(S('text', {
        class: 'zverge-lab',
        x: (c.p.x + (c.rr + 8) * Math.cos(c.th)).toFixed(1),
        y: (c.p.y + (c.rr + 8) * Math.sin(c.th) + 3).toFixed(1),
        'text-anchor': Math.cos(c.th) < -0.2 ? 'end' : Math.cos(c.th) > 0.2 ? 'start' : 'middle',
        fill: defaulters[pid] ? '#e34a3f' : c.col,
        text: U.handleOf(pid) + (defaulters[pid] ? ' ▲' + defaulters[pid] : ''),
      }));
    });

    // ── lanes, including the ones that leave ────────────────────────────
    var idx = {};
    map.forEach(function (s) { idx[s.id] = s; });
    var seen = {}, exits = [];
    members.forEach(function (s) {
      var a = P[s.id];
      var straitTo = {};
      (s.straits || []).forEach(function (st) { straitTo[st.to] = st; });
      (s.lanes || []).forEach(function (oid) {
        var st = straitTo[oid] ||
          (((idx[oid] || {}).straits || []).filter(function (t) { return t.to === s.id; })[0]);
        if (!P[oid]) { exits.push({ from: a, to: idx[oid], st: st }); return; }
        var kk = s.id < oid ? s.id + '|' + oid : oid + '|' + s.id;
        if (seen[kk]) return; seen[kk] = 1;
        var b = P[oid];
        // trimmed to the disc edges, so a lane never runs under a name
        var dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
        var ux = dx / len, uy = dy / len;
        var ra = discR(s.yieldPerTick, minY, maxY) + 3;
        var rb = discR(idx[oid].yieldPerTick, minY, maxY) + 3;
        var x1 = a.x + ux * ra, y1 = a.y + uy * ra, x2 = b.x - ux * rb, y2 = b.y - uy * rb;
        gLanes.appendChild(S('line', {
          class: 'zlane' + (st ? (st.severs ? ' severed' : ' strait') : ''),
          x1: x1.toFixed(1), y1: y1.toFixed(1), x2: x2.toFixed(1), y2: y2.toFixed(1),
        }));
        if (!st) return;
        var wx = (x1 + x2) / 2, wy = (y1 + y2) / 2, px = -uy, py = ux;
        if (st.severs) {
          gLanes.appendChild(S('rect', {
            class: 'zdoor', x: (wx - 5).toFixed(1), y: (wy - 11).toFixed(1), width: 10, height: 22,
            transform: 'rotate(' + (Math.atan2(dy, dx) * 180 / Math.PI).toFixed(1) + ' ' + wx.toFixed(1) + ' ' + wy.toFixed(1) + ')',
          }, S('title', { text: 'SEVERING STRAIT · strands ' + st.severed })));
          gLanes.appendChild(S('text', {
            class: 'zpinch-t rd', x: (wx + px * 20).toFixed(1), y: (wy + py * 20 + 3).toFixed(1),
            text: 'STRANDED ' + st.severed,
          }));
        } else {
          [1, -1].forEach(function (sgn) {
            gLanes.appendChild(S('path', {
              class: 'zwaist',
              d: 'M' + (wx - ux * 10 + px * 7 * sgn) + ' ' + (wy - uy * 10 + py * 7 * sgn) +
                'L' + wx + ' ' + wy +
                'L' + (wx + ux * 10 + px * 7 * sgn) + ' ' + (wy + uy * 10 + py * 7 * sgn),
            }));
          });
          gLanes.appendChild(S('text', {
            class: 'zpinch-t', x: (wx + px * 17).toFixed(1), y: (wy + py * 17 + 3).toFixed(1),
            text: String(st.detourHops),
          }, S('title', { text: 'STRAIT · ' + st.detourHops + ' hops to go around' })));
        }
      });
    });

    /* ★ THE LANES THAT LEAVE ARE DRAWN, AND THAT IS NOT DECORATION.
     *
     * A drill-down that shows only the interior graph publishes a false claim:
     * that this constellation is a closed pocket. `con-4` has five lanes out
     * of it, and two of them are straits — which is precisely the fact §16.12
     * ranks first. So every exit gets a stub, an arrow and the name of the
     * system on the other end. */
    var exSeen = {};
    exits.forEach(function (e) {
      if (!e.to || exSeen[e.to.id]) return; exSeen[e.to.id] = 1;
      /* ★ THE STUB POINTS WHERE THE SYSTEM ACTUALLY IS.
       *
       * Round 1 pointed every stub "away from the cluster centre", which is a
       * shape rule rather than a fact: Vale's exit to Ashen Ford therefore
       * pointed down-right into Vale's own state lines and printed
       * `GATEm Ford` across them. The bearing to the target's GALAXY position
       * is the truthful direction and it happens to fix the collision, because
       * a system that is not in this constellation is, by construction, not in
       * the middle of it. */
      var ga = gal.pos[e.from.id], gb = gal.pos[e.to.id];
      var dx = gb && ga ? gb.x - ga.x : 1, dy = gb && ga ? gb.y - ga.y : 0;
      var len = Math.hypot(dx, dy) || 1;
      var ux = dx / len, uy = dy / len;
      var x1 = e.from.x + ux * (R0 + 8), y1 = e.from.y + uy * (R0 + 8);
      var x2 = x1 + ux * 62, y2 = y1 + uy * 62;
      gLanes.appendChild(S('line', {
        class: 'zlane exit' + (e.st ? ' strait' : ''),
        x1: x1.toFixed(1), y1: y1.toFixed(1), x2: x2.toFixed(1), y2: y2.toFixed(1),
      }));
      var anchor = ux > 0.25 ? 'start' : ux < -0.25 ? 'end' : 'middle';
      // clamped inside the free area — `→ sys-16 Wither` ran off the left edge
      // of `con-4` and the map lost the one lane out of Ironhold that is not
      // severed.
      var tx = Math.max(ins.l + 40, Math.min(W - ins.r - 40, x2 + ux * 6));
      var ty = Math.max(ins.t + 20, Math.min(H - 84, y2 + uy * 6));
      // ★ AND OUT OF THE STATE-LINE BAND. A stub whose bearing runs down-right
      // lands in the 70 px strip under its own disc where the state lines are,
      // and `→ sys-05 Orison` printed through `ashlin SWAY 2 · REACHERS 6 ·
      // GATE` as `GATEIrison`. Lift it clear; the arrow still points the way.
      if (ty > e.from.y + R0 && ty < e.from.y + R0 + 78) ty = e.from.y + R0 + 86;
      var g = S('g', { class: 'zexit', on: { click: function () { if (o.onExit) o.onExit(e.to); } } },
        S('title', { text: 'leaves for ' + e.to.name + (e.st ? ' · STRAIT' : '') }));
      g.appendChild(S('text', {
        class: 'zexit-t', x: tx.toFixed(1), y: ty.toFixed(1),
        'text-anchor': anchor, text: '→ ' + e.to.id + (e.st ? (e.st.severs ? ' ✕' : ' ≻≺') : ''),
      }));
      g.appendChild(S('text', {
        class: 'zexit-n', x: tx.toFixed(1), y: (ty + 11).toFixed(1),
        'text-anchor': anchor, text: e.to.name,
      }));
      gLanes.appendChild(g);
    });

    // ── ★ THE DISCS ─────────────────────────────────────────────────────
    members.forEach(function (s) {
      var p = P[s.id], r = discR(s.yieldPerTick, minY, maxY);
      var wk = works[s.id] || [], cl = claims[s.id], sw = sway[s.id], rn = ruins[s.id] || [];
      var lastMiss = cl && (cl.state === 'LAPSED' || (cl.arrearsOf > 0 && cl.arrears >= cl.arrearsOf));
      var ceded = cl && cl.state === 'CEDED';
      // the ring says who holds it and how close to falling it is — the same
      // three-step ramp the map's claim tint uses, so the two agree.
      var ring = !cl ? null
        : lastMiss ? '#ca010f'
          : cl.arrears > 0 ? '#d89c42'
            : ceded ? '#5b6f97'
              : MapView.blocColour(cl.claimant);
      var g = S('g', { class: 'zsys' + (selId === s.id ? ' sel' : '') });

      g.appendChild(S('circle', {
        class: 'zdisc t-' + s.tier, cx: p.x.toFixed(1), cy: p.y.toFixed(1), r: r.toFixed(1),
      }));
      if (ring) {
        g.appendChild(S('circle', {
          class: 'zclaim' + (lastMiss ? ' hot' : ''), cx: p.x.toFixed(1), cy: p.y.toFixed(1), r: r.toFixed(1),
          stroke: ring, fill: ring,
        }));
      }
      if (s.fuelPerTick > 0) {
        g.appendChild(S('circle', { class: 'zfuel', cx: p.x.toFixed(1), cy: p.y.toFixed(1), r: (r + 5).toFixed(1) }));
      }

      /* ★ ONE SQUARE PER WORKS, AND THAT IS THE POINT OF THIS SCREEN.
       *
       * `sys-05` carries SEVEN of them at 15/tick each. The map drew one 8 px
       * triangle for all seven and no number anywhere — so the single most
       * crowded piece of ground in the world was, on the only agreed
       * representation of the world, indistinguishable from a system with one
       * quiet holder. A hatched square each, and they are countable.
       *
       * A square that is still SPINNING UP is drawn hollow, because it is not
       * taking a share yet, and a viewer counting productive ground would
       * otherwise count it. */
      var SQ = 13, GAP = 4, n = Math.min(wk.length, 9);
      var cols = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(n))));
      var rows = Math.ceil(n / cols);
      var x0 = p.x - (cols * SQ + (cols - 1) * GAP) / 2;
      var y0 = p.y - (rows * SQ + (rows - 1) * GAP) / 2 - (cl ? 7 : 0);
      wk.slice(0, 9).forEach(function (w, i) {
        var cc = i % cols, rr2 = Math.floor(i / cols);
        var up = /SPINNING/.test(w.legend || '');
        g.appendChild(S('rect', {
          class: 'zworks' + (up ? ' up' : ''),
          x: (x0 + cc * (SQ + GAP)).toFixed(1), y: (y0 + rr2 * (SQ + GAP)).toFixed(1),
          width: SQ, height: SQ,
        }, S('title', {
          text: U.handleOf(w.holder) + ' · ' + w.legend + ' · ' + w.sharePerTick +
            '/tick · ' + U.n(w.extracted) + ' extracted',
        })));
      });
      // a RUIN is a square with a cross through it, in the same grid — what
      // stopped, beside what still runs.
      rn.slice(0, 3).forEach(function (rr3, i) {
        var xx = x0 + ((n + i) % cols) * (SQ + GAP), yy = y0 + Math.floor((n + i) / cols) * (SQ + GAP);
        g.appendChild(S('rect', { class: 'zruin', x: xx.toFixed(1), y: yy.toFixed(1), width: SQ, height: SQ },
          S('title', { text: rr3.legend })));
        g.appendChild(S('path', {
          class: 'zruin-x',
          d: 'M' + xx + ' ' + yy + 'l' + SQ + ' ' + SQ + 'M' + (xx + SQ) + ' ' + yy + 'l-' + SQ + ' ' + SQ,
        }));
      });
      if (wk.length > 9) {
        g.appendChild(S('text', {
          class: 'zmore', x: p.x.toFixed(1), y: (y0 + rows * (SQ + GAP) + 9).toFixed(1),
          'text-anchor': 'middle', text: '+' + (wk.length - 9),
        }));
      }
      if (!wk.length && !rn.length) {
        g.appendChild(S('text', {
          class: 'zbare', x: p.x.toFixed(1), y: (p.y + 4).toFixed(1), 'text-anchor': 'middle',
          text: 'BARE',
        }, S('title', { text: 'no WORKS stands here on this frame' })));
      }

      /* ★ THE ANCHOR, AND `anchorHot` IS THE WHOLE REASON IT IS DRAWN.
       *
       * A claim whose anchor has gone cold collects nothing — and on the map
       * it is tinted exactly like a claim collecting from seven tenants. The
       * frame has carried the bit since the claim line was written and no
       * pixel has ever depended on it. Solid anchor = hot; hollow, dimmed and
       * captioned = cold. */
      if (cl) {
        var ax = p.x, ay = p.y + r - 15;
        g.appendChild(S('path', {
          class: 'zanchor' + (cl.anchorHot ? ' hot' : ' cold'),
          d: 'M' + ax + ' ' + (ay - 7) + 'v13M' + (ax - 5) + ' ' + (ay - 3) + 'h10' +
            'M' + (ax - 7) + ' ' + (ay + 2) + 'q7 10 14 0',
        }, S('title', {
          text: cl.anchorHot ? 'ANCHOR HOT · this claim collects' : 'ANCHOR COLD · collecting nothing',
        })));
        g.appendChild(S('circle', {
          class: 'zanchor-h' + (cl.anchorHot ? ' hot' : ' cold'),
          cx: ax, cy: ay - 8.5, r: 2.4,
        }));
      }

      // ── the label stack above ─────────────────────────────────────────
      gLab.appendChild(S('text', {
        class: 'zid', x: p.x.toFixed(1), y: (p.y - r - 33).toFixed(1), 'text-anchor': 'middle', text: s.id,
      }));
      gLab.appendChild(S('text', {
        class: 'zname', x: p.x.toFixed(1), y: (p.y - r - 19).toFixed(1), 'text-anchor': 'middle',
        text: s.name.toUpperCase(),
      }));
      gLab.appendChild(S('text', {
        class: 'zyield', x: p.x.toFixed(1), y: (p.y - r - 5).toFixed(1), 'text-anchor': 'middle',
        text: String(s.yieldPerTick) + (s.fuelPerTick ? ' · ' + s.fuelPerTick + 'f' : ''),
      }));

      // ── the state lines below, in priority order ──────────────────────
      var st = [];
      if (wk.length) {
        var spin = wk.filter(function (w) { return /SPINNING/.test(w.legend || ''); })[0];
        st.push({
          t: spin ? spin.legend.toUpperCase()
            : 'OCCUPANTS ' + (wk[0].occupants || wk.length) + ' · ' + wk[0].legend,
          c: spin ? 'am' : 'cy',
        });
      }
      if (cl) {
        if (lastMiss) st.push({ t: 'ARREARS ' + cl.arrears + ' of ' + cl.arrearsOf + ' · NEXT MISS LAPSES', c: 'rd' });
        else if (cl.arrears > 0) st.push({ t: 'ARREARS ' + cl.arrears + ' of ' + cl.arrearsOf, c: 'am' });
        else if (ceded) st.push({ t: 'CEDED', c: 'ce' });
        else st.push({ t: cl.legend || cl.state, c: 'cy' });
        if (!cl.anchorHot) st.push({ t: 'ANCHOR COLD · COLLECTING NOTHING', c: 'dm' });
      }
      rn.slice(0, 1).forEach(function (rr4) { st.push({ t: rr4.legend.toUpperCase(), c: 'dm' }); });
      if (sw && sw.reachers) {
        st.push({
          t: (sw.principal ? U.handleOf(sw.principal) + ' SWAY ' + sw.sway + ' · ' : '') +
            'REACHERS ' + sw.reachers + (sw.gate ? ' · GATE' : ''),
          c: 'dm',
        });
      }
      // +26, not +15: the reticle's lower tick reaches r+18, and at +15 the
      // selected system's first state line had a bright cyan bar through it.
      st.slice(0, 4).forEach(function (l, i) {
        gLab.appendChild(S('text', {
          class: 'zstate ' + l.c, x: p.x.toFixed(1), y: (p.y + r + 26 + i * 12).toFixed(1),
          'text-anchor': 'middle', text: l.t,
        }));
      });

      /* ★ `holder · STATE`, BESIDE THE DISC — the concept's most distinctive
       * mark, and the one whose data turned out to be only half there.
       *
       * The concept shows HAND states (`vex · COMMITTED`, `orrin ·
       * RECOVERING 31`). **No frame key carries a hand roster** — see
       * `Screens.MISSING` — so those two exact strings cannot be drawn without
       * inventing them, and this client does not invent.
       *
       * What IS live and has the identical shape is the WORKS holder and its
       * legend, and the convoy hand arriving. So the ring of labels is real,
       * every string in it comes off the frame, and the missing half is
       * reported rather than faked. */
      var side = [];
      (convoys[s.id] || []).slice(0, 2).forEach(function (c) {
        side.push({ h: c.principal, s: 'IN TRANSIT ' + c.ticksLeft, cls: 'tr' });
      });
      wk.forEach(function (w) {
        side.push({ h: w.holder, s: /SPINNING/.test(w.legend || '') ? 'SPINNING UP' : w.legend, cls: '' });
      });
      /* ★ FOUR, AND THEN A COUNT.
       *
       * `sys-05` has seven holders. Seven labels in two columns is four rows a
       * side, 104 px tall, and at `con-1`'s spacing the bottom of Orison's
       * column landed on Vale's name. Two a side plus `+3 MORE` is legible,
       * the state line under the disc already says OCCUPANTS 7, and the rail's
       * WORKS table carries every one of them with its share and its total —
       * which is where a viewer who wants all seven should be looking. */
      /* ⚑ **AND THEY FLIP INWARD AT THE EDGES.** Alternating left/right is
       * right in the middle of the screen and wrong at its margins: Orison
       * sits 110 px from the SYSTEM rail, so its right-hand column —
       * `dunmore · EXTRACTING`, `ashlin · EXTRACTING`, `+3 MORE` — ran
       * straight under the panel. Three holders of the world's most crowded
       * system, hidden by the panel that lists them. */
      var SHOW = 4;
      var forceL = p.x + r + 13 + LABEL_W > W - ins.r - 6;
      var forceR = p.x - r - 13 - LABEL_W < ins.l + 6;
      side.slice(0, SHOW).forEach(function (l, i) {
        var right = forceR ? true : forceL ? false : i % 2 === 0;
        var row = (forceL || forceR) ? i : Math.floor(i / 2);
        gLab.appendChild(S('text', {
          class: 'zhold ' + l.cls, x: (p.x + (right ? r + 13 : -r - 13)).toFixed(1),
          y: (p.y - (forceL || forceR ? 18 : 5) + row * 13).toFixed(1),
          'text-anchor': right ? 'start' : 'end',
          text: U.handleOf(l.h) + ' · ' + l.s,
        }));
      });
      if (side.length > SHOW) {
        var mr = !forceL;
        gLab.appendChild(S('text', {
          class: 'zhold more', x: (p.x + (mr ? r + 13 : -r - 13)).toFixed(1),
          y: (p.y - (forceL || forceR ? 18 : 5) + (forceL || forceR ? SHOW : Math.ceil(SHOW / 2)) * 13).toFixed(1),
          'text-anchor': mr ? 'start' : 'end',
          text: '+' + (side.length - SHOW) + ' MORE',
        }, S('title', { text: side.slice(SHOW).map(function (l) { return U.handleOf(l.h) + ' · ' + l.s; }).join('\n') })));
      }

      /* ★ WHAT IS HAPPENING HERE, NOT JUST WHAT IS STANDING HERE.
       *
       * Round 2 drew ground, holders and claims and NOTHING that moves —
       * so `con-2`, which is carrying two live raids and four staged ventures,
       * drew exactly the same as an empty frontier pocket. A13 names the
       * venture ring and the raid as map signatures; a drill-down that omits
       * them is the map with the drama removed.
       *
       * The RING is the same glyph the VENTURES screen draws (escrowed arc
       * deep, elective arc bright, socket for an unfilled role) so a viewer
       * reads it once. The raid is amber — a raid is a LOSS and not a lie. */
      var vg = (o.glyphs || []).filter(function (x) { return x.stage === s.id; });
      vg.slice(0, 3).forEach(function (x, i) {
        var a = -Math.PI / 4 - i * 0.42;
        var gx = p.x + (r + 17) * Math.cos(a), gy = p.y + (r + 17) * Math.sin(a);
        var gl = U.glyph(x, 26);
        gl.setAttribute('x', (gx - 13).toFixed(1));
        gl.setAttribute('y', (gy - 13).toFixed(1));
        gl.setAttribute('class', 'glyph zglyph');
        g.appendChild(gl);
      });
      var rd = (o.raids || []).filter(function (x) { return x.stage === s.id; });
      if (rd.length) {
        var live = rd.filter(function (x) { return x.ticksLeft > 0; })[0] || rd[0];
        g.appendChild(S('circle', {
          class: 'zraid' + (live.ticksLeft > 0 ? ' live' : ''),
          cx: p.x.toFixed(1), cy: p.y.toFixed(1), r: (r + 8).toFixed(1),
        }, S('title', {
          text: 'RAID ' + live.state + ' · demands ' + U.n(live.demand) +
            ' of ' + U.handleOf(live.target) + (live.lost ? ' · took ' + U.n(live.lost) : ''),
        })));
        gLab.appendChild(S('text', {
          class: 'zstate am', x: p.x.toFixed(1), y: (p.y - r - 48).toFixed(1), 'text-anchor': 'middle',
          text: 'RAID ' + live.state + ' · ' + U.n(live.demand) +
            (live.ticksLeft > 0 ? ' · t−' + live.ticksLeft : ''),
        }));
      }
      var fb = (o.fronts || []).filter(function (x) { return x.system === s.id; })[0];
      if (fb) {
        g.appendChild(S('circle', {
          class: 'zfront', cx: p.x.toFixed(1), cy: p.y.toFixed(1),
          r: (r + 20 + 26 * ((fb.tintBps || 0) / 10000)).toFixed(1),
        }, S('title', { text: 'FRONT · ' + fb.legend })));
      }

      // hit target last, over everything this disc drew
      var hit = S('circle', {
        class: 'zhit', cx: p.x.toFixed(1), cy: p.y.toFixed(1), r: (r + 4).toFixed(1),
      });
      hit.addEventListener('click', function (ev) {
        ev.stopPropagation(); if (o.onSelect) o.onSelect(s.id);
      });
      g.appendChild(hit);
      gDisc.appendChild(g);

      if (selId === s.id) {
        var RR = r + 13;
        [0, 180].forEach(function (a0) {
          var a1 = (a0 - 52) * Math.PI / 180, a2 = (a0 + 52) * Math.PI / 180;
          gSel.appendChild(S('path', {
            class: 'ret-arc',
            d: 'M' + (p.x + RR * Math.cos(a1)).toFixed(1) + ' ' + (p.y + RR * Math.sin(a1)).toFixed(1) +
              'A' + RR + ' ' + RR + ' 0 0 1 ' +
              (p.x + RR * Math.cos(a2)).toFixed(1) + ' ' + (p.y + RR * Math.sin(a2)).toFixed(1),
          }));
        });
        [-90, 90].forEach(function (a0) {
          var a = a0 * Math.PI / 180;
          gSel.appendChild(S('line', {
            class: 'ret-tick',
            x1: (p.x + (RR - 5) * Math.cos(a)).toFixed(1), y1: (p.y + (RR - 5) * Math.sin(a)).toFixed(1),
            x2: (p.x + (RR + 5) * Math.cos(a)).toFixed(1), y2: (p.y + (RR + 5) * Math.sin(a)).toFixed(1),
          }));
        });
      }
    });

    var root = S('svg', {
      id: 'zoomsvg', viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'xMidYMid meet',
    }, [gStars, gVerge, gLanes, gDisc, gLab, gSel]);
    U.clear(host).appendChild(root);
  }

  return { render: render, locator: locator };
})();
