/* THE COMPACT — ★ THE MAP.
 *
 * A13: *"the map is the game's only agreed representation."* It had never had a
 * pixel drawn from it. `map[]`, `swayLines[]`, `straits[]` and `richnessBps`
 * are the best-populated keys on the frame and `client/index.html` referenced
 * none of them.
 *
 * FOUR SIGNATURES LIVE HERE, and each one is a specific drawing decision:
 *
 *   THE LODE   node radius is `yieldPerTick`, so rich ground is literally
 *              bigger. `richnessBps` (which goes NEGATIVE — measured range
 *              −909…+533) tints the node rather than sizing it, because a
 *              negative radius is not a thing and poor ground still exists.
 *
 *   THE PINCH  a strait is a lane NARROWED TO A WAIST with its detour count
 *              notched beside it; a SEVERING strait is a solid door across the
 *              lane carrying the number of systems it strands. Two different
 *              marks because they are two different facts.
 *
 *   THE VERGE  ONE CONTINUOUS SOLID OUTLINE per bloc. Every generated mock drew
 *              this dashed and every one of them was wrong: a gap in a fence
 *              reads as ground the bloc does not hold, which is a false claim
 *              about a real principal. Built by marching squares over a union
 *              of discs, with interior holes DISCARDED — see `contours()`.
 *
 *   THE TIERS  three concentric BANDS of different ground, not three node
 *              colours. Every generated map failed this. The bands are filled
 *              annuli with a visible boundary edge, and the COMMONS is drawn
 *              categorically differently — a dotted neutral edge, no fence ever
 *              crosses it — because A8 makes hostile action there INVALID
 *              rather than merely punished.
 *
 * The frame carries NO x/y, deliberately: position would enter `state_hash`.
 * So the layout is computed here, deterministically, from the lane graph. Same
 * frame in, same picture out — which is what makes it safe to poll.
 */
/* eslint-env browser */
'use strict';

var MapView = (function () {
  var S = U.svg, E = U.el;

  // ── deterministic hash → [0,1) ────────────────────────────────────────
  function h01(s) {
    var x = 2166136261;
    for (var i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); }
    return ((x >>> 0) % 100000) / 100000;
  }

  /* A principal's colour is identity, never judgement. The ramp is deliberately
     all cool hues: RED IS RESERVED FOR FAILURE and a bloc that happens to hash
     to red would tell a lie about its holder every single frame. */
  var BLOC = ['#19d7f2', '#3f9ad6', '#7f6fd8', '#2fb89a', '#5cc0e8', '#9a72b8',
    '#2f8fb0', '#54d1a8', '#8896d8', '#3fc2c8', '#6f8fd0', '#40a8c0'];
  function blocColour(pid) { return BLOC[Math.floor(h01(String(pid)) * BLOC.length) % BLOC.length]; }

  var TIERS = ['COMMONS', 'MARCHES', 'FRONTIER'];
  // band radii as a fraction of R. The gaps between them are the boundary the
  // prompt says a stranger must be able to put a finger on.
  var BAND = { COMMONS: [0.00, 0.235], MARCHES: [0.325, 0.665], FRONTIER: [0.755, 0.985] };

  /**
   * Lay the 30 systems out. Angular relaxation inside a fixed radial band:
   * the band is a hard constraint (so the tiers always read as tiers) and the
   * lane graph only gets to choose the angle (so constellations cluster and
   * lanes stay short).
   */
  function layout(systems, W, H) {
    // ELLIPTICAL, not circular. A circle inscribed in a 1160×830 panel wastes
    // ~35% of the width, and the map is the one screen that should use every
    // pixel it is given. The layout still reasons in polar coordinates on a
    // unit circle; only the projection to screen is stretched.
    var R = 1, cx = W / 2, cy = H / 2;
    // 0.425 rather than 0.48 so the FRONTIER band label at unit radius 1.08
    // still lands inside the panel rather than clipping against its top edge.
    var RX = W * 0.435, RY = H * 0.425;
    var by = {}, cons = [];
    systems.forEach(function (s) {
      (by[s.tier] || (by[s.tier] = [])).push(s);
      if (cons.indexOf(s.constellation) < 0) cons.push(s.constellation);
    });
    cons.sort();
    var pos = {};

    TIERS.forEach(function (tier, ti) {
      var list = (by[tier] || []).slice();
      if (!list.length) return;
      list.sort(function (a, b) {
        var ca = cons.indexOf(a.constellation), cb = cons.indexOf(b.constellation);
        return ca !== cb ? ca - cb : a.id.localeCompare(b.id);
      });
      var band = BAND[tier], N = list.length;
      // The COMMONS is four systems at the centre: a ring of four reads as a
      // clique, which is exactly what it is.
      var phase = tier === 'COMMONS' ? -Math.PI / 4 : -Math.PI / 2 + ti * 0.21;
      list.forEach(function (s, i) {
        pos[s.id] = { th: phase + (2 * Math.PI * i) / N, tier: tier, sys: s };
      });
    });

    // Angular relaxation — pull each node toward its lane neighbours, then push
    // co-band neighbours apart so the band stays evenly occupied. Fixed
    // iteration count, no randomness: the picture must not move when the frame
    // does not.
    //
    // ★ THE SEPARATION FACTOR IS 0.97, AND THAT NUMBER IS THE WHOLE FIX. At
    // 0.74 the 18 MARCHES systems needed only 74% of the circle, so the lane
    // attraction was free to collapse all of them into three quarters of the
    // ring and leave the rest of the band bare. The band stopped reading as a
    // band and the labels piled on top of each other. At 0.97 the separation
    // constraint very nearly tiles the circle, so the lane graph can choose the
    // ORDER around the ring but not the crowding.
    var idx = {};
    systems.forEach(function (s) { idx[s.id] = s; });
    for (var it = 0; it < 400; it++) {
      var pull = {};
      systems.forEach(function (s) {
        var p = pos[s.id]; if (!p) return;
        var sx = 0, sy = 0, n = 0;
        (s.lanes || []).forEach(function (o) {
          var q = pos[o]; if (!q) return;
          sx += Math.cos(q.th); sy += Math.sin(q.th); n++;
        });
        if (!n) return;
        // The COMMONS is the hub of the whole graph; letting it be dragged by
        // its lanes drags it off centre and the inner band stops reading.
        var w = p.tier === 'COMMONS' ? 0.015 : 0.07;
        var target = Math.atan2(sy, sx), d = norm(target - p.th);
        pull[s.id] = p.th + d * w;
      });
      for (var k in pull) pos[k].th = pull[k];
      TIERS.forEach(function (tier) {
        var list = (by[tier] || []).map(function (s) { return pos[s.id]; }).filter(Boolean);
        if (list.length < 2) return;
        list.sort(function (a, b) { return a.th - b.th; });
        var minSep = (2 * Math.PI) / list.length * 0.97;
        for (var pass = 0; pass < 3; pass++) {
          for (var i = 0; i < list.length; i++) {
            var a = list[i], b = list[(i + 1) % list.length];
            var d2 = norm(b.th - a.th);
            if (d2 < minSep) { var push = (minSep - d2) / 2; a.th -= push; b.th += push; }
          }
        }
      });
    }

    var out = {};
    systems.forEach(function (s) {
      var p = pos[s.id]; if (!p) return;
      var band = BAND[s.tier], w = band[1] - band[0];
      // A little deterministic radial scatter so the band reads as GROUND
      // rather than as a wire hoop — clamped well inside the boundary so the
      // three bands never touch. That gap is the thing a stranger has to be
      // able to put a finger on.
      var f = s.tier === 'COMMONS'
        ? 0.60
        : 0.24 + 0.52 * h01(s.id + '#r');
      var r = band[0] + w * f;                       // unit radius, 0…1
      out[s.id] = {
        id: s.id, sys: s, tier: s.tier, th: p.th, r: r,
        x: cx + r * RX * Math.cos(p.th), y: cy + r * RY * Math.sin(p.th),
      };
    });
    return { pos: out, cx: cx, cy: cy, RX: RX, RY: RY, cons: cons };
  }
  /** unit-polar → screen, the one projection everything on the map goes through */
  function proj(L, r, th) {
    return { x: L.cx + r * L.RX * Math.cos(th), y: L.cy + r * L.RY * Math.sin(th) };
  }
  function norm(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }

  /* ════════════════════════════════════════════════════════ THE VERGE ════
   *
   * Marching squares over a union-of-discs scalar field, contours linked into
   * closed loops, and every loop whose orientation marks it as a HOLE thrown
   * away before drawing. That last step is the whole point: a bloc holding a
   * ring of systems produces a legitimate interior hole, and drawing it would
   * publish "this principal does not hold the middle" — which the frame does
   * not say. One continuous solid outline, or nothing.
   */
  function contours(points, radius, step) {
    if (!points.length) return [];
    var pad = radius + step * 2;
    var minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    points.forEach(function (p) {
      minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x);
      miny = Math.min(miny, p.y); maxy = Math.max(maxy, p.y);
    });
    minx -= pad; miny -= pad; maxx += pad; maxy += pad;
    var nx = Math.max(2, Math.ceil((maxx - minx) / step)), ny = Math.max(2, Math.ceil((maxy - miny) / step));
    if (nx * ny > 90000) { step = step * 2; return contours(points, radius, step); }
    var f = new Float32Array((nx + 1) * (ny + 1));
    for (var j = 0; j <= ny; j++) {
      for (var i = 0; i <= nx; i++) {
        var x = minx + i * step, y = miny + j * step, best = -1e9;
        for (var p = 0; p < points.length; p++) {
          var dx = x - points[p].x, dy = y - points[p].y;
          var v = radius - Math.sqrt(dx * dx + dy * dy);
          if (v > best) best = v;
        }
        f[j * (nx + 1) + i] = best;
      }
    }
    var at = function (i, j) { return f[j * (nx + 1) + i]; };
    var segs = [];
    function ip(x1, y1, v1, x2, y2, v2) {
      var t = v1 / (v1 - v2);
      return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
    }
    for (var jj = 0; jj < ny; jj++) {
      for (var ii = 0; ii < nx; ii++) {
        var x0 = minx + ii * step, y0 = miny + jj * step, x1 = x0 + step, y1 = y0 + step;
        var a = at(ii, jj), b = at(ii + 1, jj), c = at(ii + 1, jj + 1), d = at(ii, jj + 1);
        var code = (a > 0 ? 8 : 0) | (b > 0 ? 4 : 0) | (c > 0 ? 2 : 0) | (d > 0 ? 1 : 0);
        if (code === 0 || code === 15) continue;
        var T = ip(x0, y0, a, x1, y0, b), Rr = ip(x1, y0, b, x1, y1, c);
        var B = ip(x0, y1, d, x1, y1, c), L = ip(x0, y0, a, x0, y1, d);
        // interior kept on the LEFT of each directed segment, so outer loops
        // and hole loops come out with opposite winding.
        switch (code) {
          case 1: segs.push([B, L]); break;
          case 2: segs.push([Rr, B]); break;
          case 3: segs.push([Rr, L]); break;
          case 4: segs.push([T, Rr]); break;
          case 5: segs.push([T, L]); segs.push([B, Rr]); break;
          case 6: segs.push([T, B]); break;
          case 7: segs.push([T, L]); break;
          case 8: segs.push([L, T]); break;
          case 9: segs.push([B, T]); break;
          case 10: segs.push([L, B]); segs.push([Rr, T]); break;
          case 11: segs.push([Rr, T]); break;
          case 12: segs.push([L, Rr]); break;
          case 13: segs.push([B, Rr]); break;
          case 14: segs.push([L, B]); break;
          default: break;
        }
      }
    }
    // link segments into loops
    var key = function (p) { return Math.round(p[0] * 4) + ',' + Math.round(p[1] * 4); };
    var from = {};
    segs.forEach(function (s) { (from[key(s[0])] || (from[key(s[0])] = [])).push(s); });
    var used = new Set(), loops = [];
    segs.forEach(function (s0) {
      if (used.has(s0)) return;
      var loop = [s0[0]], cur = s0, guard = 0;
      while (cur && !used.has(cur) && guard++ < 60000) {
        used.add(cur); loop.push(cur[1]);
        var nxt = (from[key(cur[1])] || []).filter(function (t) { return !used.has(t); })[0];
        if (!nxt) break;
        cur = nxt;
      }
      if (loop.length > 6) loops.push(loop);
    });
    if (!loops.length) return [];
    // shoelace: keep only loops with the same winding as the biggest one, which
    // is by construction an outer boundary. Everything else is a hole.
    function area(l) {
      var s = 0;
      for (var i = 0; i < l.length - 1; i++) s += l[i][0] * l[i + 1][1] - l[i + 1][0] * l[i][1];
      return s / 2;
    }
    var areas = loops.map(area);
    var biggest = 0;
    for (var i2 = 1; i2 < areas.length; i2++) if (Math.abs(areas[i2]) > Math.abs(areas[biggest])) biggest = i2;
    var sign = Math.sign(areas[biggest]);
    return loops.filter(function (l, i3) {
      return Math.sign(areas[i3]) === sign && Math.abs(areas[i3]) > 140;
    });
  }

  /** Catmull-Rom through a closed loop → one smooth `d`. Solid, never dashed. */
  function smooth(loop) {
    var pts = [];
    for (var i = 0; i < loop.length - 1; i += 2) pts.push(loop[i]);
    if (pts.length < 3) pts = loop.slice(0, -1);
    if (pts.length < 3) return '';
    var d = 'M' + pts[0][0].toFixed(1) + ' ' + pts[0][1].toFixed(1);
    var n = pts.length;
    for (var j = 0; j < n; j++) {
      var p0 = pts[(j - 1 + n) % n], p1 = pts[j], p2 = pts[(j + 1) % n], p3 = pts[(j + 2) % n];
      d += 'C' + (p1[0] + (p2[0] - p0[0]) / 6).toFixed(1) + ' ' + (p1[1] + (p2[1] - p0[1]) / 6).toFixed(1) +
        ',' + (p2[0] - (p3[0] - p1[0]) / 6).toFixed(1) + ' ' + (p2[1] - (p3[1] - p1[1]) / 6).toFixed(1) +
        ',' + p2[0].toFixed(1) + ' ' + p2[1].toFixed(1);
    }
    return d + 'Z';
  }

  // ── the renderer ───────────────────────────────────────────────────────
  var state = {
    layers: { verge: true, lode: true, pinch: true, claims: true, works: true, motion: true, labels: true },
    sel: null, view: null, cache: null,
  };

  function nodeR(sys, minY, maxY) {
    var t = maxY > minY ? (sys.yieldPerTick - minY) / (maxY - minY) : 0.5;
    return 5.2 + 8.4 * t;
  }

  function render(host, R, L, opts) {
    var o = opts || {};
    var W = host.clientWidth || 1200, H = host.clientHeight || 700;
    if (!R || !R.map || !R.map.length) {
      U.clear(host).appendChild(U.empty('no map yet',
        'The lane graph lives on the <b>Reckoning</b> frame (<code>latest.json → map[]</code>), which is ' +
        'published once per Reckoning — 288 ticks. This world has not settled its first one yet, so there ' +
        'is nothing to draw. The live frame carries motion, not topology.'));
      return;
    }
    var key = R.stateHash + ':' + W + ':' + H;
    if (!state.cache || state.cache.key !== key) {
      state.cache = { key: key, lay: layout(R.map, W, H) };
    }
    var lay = state.cache.lay, P = lay.pos, cx = lay.cx, cy = lay.cy, RX = lay.RX, RY = lay.RY;
    var idx = {}; R.map.forEach(function (s) { idx[s.id] = s; });
    var minY = Infinity, maxY = -Infinity;
    R.map.forEach(function (s) { minY = Math.min(minY, s.yieldPerTick); maxY = Math.max(maxY, s.yieldPerTick); });

    var gBands = S('g'), gLanes = S('g'), gVerge = S('g'), gClaims = S('g'),
      gMotion = S('g'), gNodes = S('g'), gLabels = S('g'), gCon = S('g');

    // ── ★ THE THREE BANDS ────────────────────────────────────────────────
    // Drawn outermost-first so they stack into three real values of ground
    // with a lit edge between each. A stranger has to be able to put a finger
    // on the line between two bands without reading a word, and every
    // generated map in the sweep failed exactly that.
    function ell(r) { return { rx: (r * RX).toFixed(1), ry: (r * RY).toFixed(1) }; }
    [['FRONTIER', 0.985], ['MARCHES', 0.665], ['COMMONS', 0.235]].forEach(function (b) {
      var e = ell(b[1]);
      gBands.appendChild(S('ellipse', { class: 'band-fill-' + b[0], cx: cx, cy: cy, rx: e.rx, ry: e.ry }));
      gBands.appendChild(S('ellipse', {
        class: 'band-edge' + (b[0] === 'COMMONS' ? ' commons' : ''),
        cx: cx, cy: cy, rx: e.rx, ry: e.ry,
      }));
    });
    var counts = { COMMONS: 0, MARCHES: 0, FRONTIER: 0 };
    R.map.forEach(function (s) { counts[s.tier] = (counts[s.tier] || 0) + 1; });

    // ★ Band labels live in the RADIAL GAPS — 0.28, 0.71, 1.02 — and the gaps
    // are the point: no node can ever occupy them, because the bands are
    // 0…0.235, 0.325…0.665 and 0.755…0.985. So this is collision-free by
    // construction rather than by luck, which the first build was not: it put
    // the labels inside the bands and they landed on top of four system names.
    [['FRONTIER', 1.085], ['MARCHES', 0.712], ['COMMONS', 0.281]].forEach(function (b) {
      var p = proj(lay, b[1], -Math.PI / 2);
      gBands.appendChild(S('text', {
        class: 'band-label' + (b[0] === 'COMMONS' ? ' commons' : ''),
        x: p.x.toFixed(1), y: (p.y + 4).toFixed(1), 'text-anchor': 'middle',
        text: 'THE ' + b[0] + ' · ' + counts[b[0]] + ' SYSTEMS',
      }));
    });
    // A8 spelled out INSIDE the Commons rather than on its rim: the sentence is
    // long, and on the rim it reached across two systems' names. It also
    // belongs to the ground rather than to the boundary.
    var cLab = proj(lay, 0.17, Math.PI / 2);
    gBands.appendChild(S('text', {
      class: 'band-label commons', x: cLab.x.toFixed(1), y: cLab.y.toFixed(1), 'text-anchor': 'middle',
      text: 'HOSTILE ACTION IS INVALID',
    }));

    // ── CONSTELLATIONS, drawn as arcs rather than watermarks ────────────
    // The frame publishes ids (`con-1`), not names. The mocks invented HEARTH /
    // THRESHOLD / MARROW / VANE and `MARROW` collides with the live handle
    // `p:marrow`, so this draws exactly what the frame says.
    //
    // An arc along the band edge spanning the constellation's angular range is
    // strictly more informative than a name floating over the middle of it: it
    // shows WHICH SLICE of the ring belongs to which constellation, and it
    // cannot land on a node because it rides the band boundary.
    var conAgg = {};
    R.map.forEach(function (s) {
      if (s.tier === 'COMMONS') return;               // the Commons is its own thing
      var p = P[s.id]; if (!p) return;
      var a = conAgg[s.constellation] ||
        (conAgg[s.constellation] = { ths: [], tier: s.tier, n: 0 });
      a.ths.push(p.th); a.n++;
    });
    Object.keys(conAgg).sort().forEach(function (c) {
      var a = conAgg[c]; if (!a.n) return;
      // circular mean, then half-width from the furthest member
      var sx = 0, sy = 0;
      a.ths.forEach(function (t) { sx += Math.cos(t); sy += Math.sin(t); });
      var mid = Math.atan2(sy, sx), half = 0;
      a.ths.forEach(function (t) { half = Math.max(half, Math.abs(norm(t - mid))); });
      half = Math.min(half + 0.08, Math.PI * 0.92);
      var rr = a.tier === 'FRONTIER' ? 1.02 : 0.712;
      var steps = 30, d = '';
      for (var i = 0; i <= steps; i++) {
        var t = mid - half + (2 * half * i) / steps, q = proj(lay, rr, t);
        d += (i ? 'L' : 'M') + q.x.toFixed(1) + ' ' + q.y.toFixed(1);
      }
      gCon.appendChild(S('path', { d: d, fill: 'none', stroke: '#173c46', 'stroke-width': 1 }));
      // The band label already owns 12 o'clock in this gap ring, so a
      // constellation whose arc is centred there slides to whichever end of
      // its own arc is further away. Deterministic, and it is the only place
      // two ring labels can meet.
      var lab = mid;
      if (Math.abs(norm(mid + Math.PI / 2)) < 0.6) {
        var a1 = mid - half * 0.72, a2 = mid + half * 0.72;
        lab = Math.abs(norm(a1 + Math.PI / 2)) > Math.abs(norm(a2 + Math.PI / 2)) ? a1 : a2;
      }
      var m = proj(lay, rr, lab);
      gCon.appendChild(S('text', {
        class: 'con-label', x: m.x.toFixed(1), y: (m.y + 4).toFixed(1),
        text: c.toUpperCase().replace('CON-', 'CON ') + ' · ' + a.n,
      }));
    });

    // ── lanes, and THE PINCH ────────────────────────────────────────────
    var seen = {};
    R.map.forEach(function (s) {
      var a = P[s.id]; if (!a) return;
      var straitTo = {};
      (s.straits || []).forEach(function (st) { straitTo[st.to] = st; });
      (s.lanes || []).forEach(function (oid) {
        var b = P[oid]; if (!b) return;
        var kk = s.id < oid ? s.id + '|' + oid : oid + '|' + s.id;
        if (seen[kk]) return; seen[kk] = 1;
        var st = straitTo[oid] || (((idx[oid] || {}).straits || []).filter(function (t) { return t.to === s.id; })[0]);
        var cls = 'lane' + (st ? (st.severs ? ' severed' : ' strait') : '');
        // lanes bow toward the centre so long chords do not cut the map in half
        var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        var bow = 0.10, qx = mx + (cx - mx) * bow, qy = my + (cy - my) * bow;
        gLanes.appendChild(S('path', {
          class: cls, d: 'M' + a.x.toFixed(1) + ' ' + a.y.toFixed(1) + 'Q' + qx.toFixed(1) + ' ' + qy.toFixed(1) +
            ' ' + b.x.toFixed(1) + ' ' + b.y.toFixed(1),
        }));
        if (!st || !state.layers.pinch) return;
        var wx = 0.25 * a.x + 0.5 * qx + 0.25 * b.x, wy = 0.25 * a.y + 0.5 * qy + 0.25 * b.y;
        var dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
        var ux = dx / len, uy = dy / len, px = -uy, py = ux;
        if (st.severs) {
          // A SEVERING STRAIT: a solid door across the lane, carrying the count
          // of systems it strands. Not a narrowing — a closure.
          var hw = 9, th = 3.4;
          gLanes.appendChild(S('path', {
            class: 'door',
            d: 'M' + (wx + px * hw - ux * th) + ' ' + (wy + py * hw - uy * th) +
              'L' + (wx - px * hw - ux * th) + ' ' + (wy - py * hw - uy * th) +
              'L' + (wx - px * hw + ux * th) + ' ' + (wy - py * hw + uy * th) +
              'L' + (wx + px * hw + ux * th) + ' ' + (wy + py * hw + uy * th) + 'Z',
          }));
          gLanes.appendChild(S('text', {
            class: 'door-t', x: (wx + px * 17).toFixed(1), y: (wy + py * 17 + 3).toFixed(1),
            text: st.severed > 0 ? 'STRANDS ' + st.severed : 'SEVERS',
          }));
        } else {
          // A DETOUR STRAIT: the lane pinched to a waist, notched with the
          // number of hops the detour costs.
          var g = 5.5, l2 = 8;
          gLanes.appendChild(S('path', {
            class: 'waist',
            d: 'M' + (wx - ux * l2 + px * g) + ' ' + (wy - uy * l2 + py * g) +
              'L' + wx + ' ' + wy + 'L' + (wx + ux * l2 + px * g) + ' ' + (wy + uy * l2 + py * g),
          }));
          gLanes.appendChild(S('path', {
            class: 'waist',
            d: 'M' + (wx - ux * l2 - px * g) + ' ' + (wy - uy * l2 - py * g) +
              'L' + wx + ' ' + wy + 'L' + (wx + ux * l2 - px * g) + ' ' + (wy + uy * l2 - py * g),
          }));
          if (st.detourHops > 0) {
            gLanes.appendChild(S('circle', { class: 'notch', cx: (wx + px * 13).toFixed(1), cy: (wy + py * 13).toFixed(1), r: 6.2 }));
            gLanes.appendChild(S('text', {
              class: 'notch-t', x: (wx + px * 13).toFixed(1), y: (wy + py * 13 + 2.9).toFixed(1),
              text: String(st.detourHops),
            }));
          }
        }
      });
    });

    // ── ★ THE VERGE ─────────────────────────────────────────────────────
    if (state.layers.verge && R.swayLines && R.swayLines.length) {
      var blocs = {};
      R.swayLines.forEach(function (s) {
        if (!s.principal) return;                       // bare ground is drawn bare
        var p = P[s.system]; if (!p) return;
        if (idx[s.system] && idx[s.system].tier === 'COMMONS') return;  // A8: no fence crosses the Commons
        (blocs[s.principal] || (blocs[s.principal] = [])).push({ x: p.x, y: p.y, sway: s.sway });
      });
      var defaulters = {};
      (R.standings || []).forEach(function (r) { if (r.defaults > 0) defaulters[r.principal] = r.defaults; });
      Object.keys(blocs).sort().forEach(function (pid) {
        var pts = blocs[pid], col = blocColour(pid);
        var loops = contours(pts, 30, 7);
        if (!loops.length) return;
        var d = loops.map(smooth).join(' ');
        if (!d) return;
        gVerge.appendChild(S('path', { class: 'verge', d: d, stroke: col, fill: col }));
        // the handle sits on the fence. It is drawn RED when that principal has
        // a default on the record — the map answering the only question that
        // matters in three seconds.
        var top = pts.reduce(function (a, b) { return b.y < a.y ? b : a; }, pts[0]);
        gLabels.appendChild(S('text', {
          class: 'verge-lab', x: top.x.toFixed(1), y: (top.y - 24).toFixed(1), 'text-anchor': 'middle',
          fill: defaulters[pid] ? '#e34a3f' : col,
          text: U.handleOf(pid) + (defaulters[pid] ? ' ▲' + defaulters[pid] : ''),
        }));
      });
    }

    // ── claims ──────────────────────────────────────────────────────────
    if (state.layers.claims) {
      (R.claimLines || []).forEach(function (c) {
        var p = P[c.system]; if (!p) return;
        var bad = c.state === 'LAPSED' || c.arrears > 0;
        gClaims.appendChild(S('circle', {
          class: 'claim-tint', cx: p.x, cy: p.y, r: nodeR(idx[c.system], minY, maxY) + 6.5,
          fill: bad ? '#ca010f' : blocColour(c.claimant),
          stroke: bad ? '#ca010f' : blocColour(c.claimant),
        }, S('title', { text: c.legend || c.state })));
      });
      (R.ruins || []).forEach(function (r) {
        var p = P[r.system]; if (!p) return;
        gClaims.appendChild(S('path', {
          class: 'ruin-mk',
          d: 'M' + (p.x - 7) + ' ' + (p.y - 7) + 'l14 14M' + (p.x + 7) + ' ' + (p.y - 7) + 'l-14 14',
        }, S('title', { text: 'RUIN · ' + (r.legend || '') })));
      });
    }

    // ── works ───────────────────────────────────────────────────────────
    if (state.layers.works) {
      (R.worksLines || []).forEach(function (w) {
        var p = P[w.system]; if (!p) return;
        var rr = nodeR(idx[w.system], minY, maxY);
        gClaims.appendChild(S('path', {
          class: 'works-mk',
          d: 'M' + (p.x - rr - 4) + ' ' + (p.y + rr + 4) + 'l4 -7l4 7z',
        }, S('title', { text: 'WORKS · ' + U.handleOf(w.holder) + ' · ' + w.legend })));
      });
    }

    // ── motion: raids, compacts, convoys, fronts ────────────────────────
    if (state.layers.motion) {
      (R.frontBands || []).forEach(function (f) {
        var p = P[f.system]; if (!p) return;
        gMotion.appendChild(S('circle', {
          class: 'front-cone', cx: p.x, cy: p.y, r: 15 + 22 * ((f.tintBps || 0) / 10000),
        }, S('title', { text: 'FRONT · ' + (f.legend || '') })));
      });
      (L && L.convoyLines || R.convoyLines || []).forEach(function (cv) {
        var a = P[cv.from], b = P[cv.to]; if (!a || !b) return;
        gMotion.appendChild(S('line', { class: 'convoy-path', x1: a.x, y1: a.y, x2: b.x, y2: b.y }));
        var t = cv.ticksLeft > 0 ? 1 - Math.min(1, cv.ticksLeft / 24) : 0.9;
        gMotion.appendChild(S('circle', {
          class: 'convoy-dot', cx: (a.x + (b.x - a.x) * t).toFixed(1),
          cy: (a.y + (b.y - a.y) * t).toFixed(1), r: 2.6,
        }, S('title', { text: cv.legend || 'CONVOY' })));
      });
      ((L && L.compactLinks) || R.compactLinks || []).forEach(function (cl) {
        var a = P[cl.aAt], b = P[cl.bAt || cl.stage]; if (!a || !b || a === b) return;
        var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        var dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
        var qx = mx - dy / len * len * 0.14, qy = my + dx / len * len * 0.14;
        gMotion.appendChild(S('path', {
          class: 'compact-arc' + (cl.snapped ? ' snapped' : ''),
          d: 'M' + a.x.toFixed(1) + ' ' + a.y.toFixed(1) + 'Q' + qx.toFixed(1) + ' ' + qy.toFixed(1) +
            ' ' + b.x.toFixed(1) + ' ' + b.y.toFixed(1),
        }, S('title', { text: cl.legend || cl.kind })));
      });
      ((L && L.raidLines) || R.raidLines || []).forEach(function (rd) {
        var p = P[rd.stage]; if (!p) return;
        gMotion.appendChild(S('circle', { class: 'raid-halo', cx: p.x, cy: p.y, r: 12 }));
        gMotion.appendChild(S('circle', {
          class: 'raid-arc', cx: p.x, cy: p.y, r: 13,
        }, S('title', { text: 'RAID ' + rd.state + ' · demand ' + U.n(rd.demand) })));
        if (rd.ticksLeft > 0) {
          gMotion.appendChild(S('text', {
            class: 'door-t', x: p.x, y: (p.y - 19).toFixed(1), text: 't−' + rd.ticksLeft,
          }));
        }
      });
    }

    // ── nodes, and THE LODE ─────────────────────────────────────────────
    R.map.forEach(function (s) {
      var p = P[s.id]; if (!p) return;
      var rr = state.layers.lode ? nodeR(s, minY, maxY) : 7;
      var g = S('g');
      if (s.fuelPerTick > 0) g.appendChild(S('circle', { class: 'fuel-ring', cx: p.x, cy: p.y, r: rr + 3.6 }));
      var c = S('circle', {
        class: 'node node-' + s.tier + (state.sel === s.id ? ' sel' : ''),
        cx: p.x, cy: p.y, r: rr.toFixed(1),
        'data-sys': s.id,
      }, S('title', {
        text: s.name + ' · ' + s.id + ' · ' + s.tier + ' · ' + s.yieldPerTick + ' ore/tick' +
          (s.fuelPerTick ? ' · ' + s.fuelPerTick + ' fuel/tick' : '') +
          ' · richness ' + s.richnessBps + 'bps · ' + (s.lanes || []).length + ' lanes',
      }));
      // richness tints the node: the LODE is size, but poor ground is real and
      // a negative richness cannot be drawn as a smaller circle honestly.
      if (s.richnessBps > 0) c.setAttribute('fill', '#0d4a54');
      else if (s.richnessBps < -400) c.setAttribute('fill', '#0a1e24');
      c.addEventListener('click', function (ev) { ev.stopPropagation(); if (o.onSelect) o.onSelect(s.id); });
      g.appendChild(c);
      gNodes.appendChild(g);
      if (state.layers.labels) {
        // Labels fan RADIALLY OUTWARD. Placing every label directly under its
        // node made neighbouring names collide the moment two nodes sat at a
        // similar angle; pushing each one along its own radius spreads them the
        // same way the nodes are spread.
        var lx = p.x + (rr + 7) * Math.cos(p.th), ly = p.y + (rr + 7) * Math.sin(p.th);
        var right = Math.cos(p.th) > 0.24, left = Math.cos(p.th) < -0.24;
        var anchor = right ? 'start' : left ? 'end' : 'middle';
        var dy = Math.abs(Math.cos(p.th)) > 0.24 ? 3 : (Math.sin(p.th) > 0 ? 10 : -4);
        gLabels.appendChild(S('text', {
          class: 'node-lab', x: lx.toFixed(1), y: (ly + dy).toFixed(1), 'text-anchor': anchor, text: s.name,
        }));
        gLabels.appendChild(S('text', {
          class: 'node-id', x: lx.toFixed(1), y: (ly + dy + 9).toFixed(1), 'text-anchor': anchor, text: s.id,
        }));
      }
    });

    var root = S('svg', {
      id: 'mapsvg', viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'xMidYMid meet',
    }, [gBands, gCon, gLanes, gVerge, gClaims, gMotion, gNodes, gLabels]);

    // pan + zoom, on the root group so the layout never recomputes
    var view = state.view || (state.view = { k: 1, x: 0, y: 0 });
    var wrap = S('g', { transform: 'translate(' + view.x + ',' + view.y + ') scale(' + view.k + ')' });
    [gBands, gCon, gLanes, gVerge, gClaims, gMotion, gNodes, gLabels].forEach(function (g) { wrap.appendChild(g); });
    U.clear(root); root.appendChild(wrap);
    root.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      var f = ev.deltaY < 0 ? 1.12 : 1 / 1.12, nk = Math.max(0.5, Math.min(6, view.k * f));
      var rect = root.getBoundingClientRect();
      var mx = (ev.clientX - rect.left) * (W / rect.width), my = (ev.clientY - rect.top) * (H / rect.height);
      view.x = mx - (mx - view.x) * (nk / view.k); view.y = my - (my - view.y) * (nk / view.k);
      view.k = nk;
      wrap.setAttribute('transform', 'translate(' + view.x + ',' + view.y + ') scale(' + view.k + ')');
    }, { passive: false });
    var drag = null;
    root.addEventListener('pointerdown', function (ev) {
      drag = { x: ev.clientX, y: ev.clientY, vx: view.x, vy: view.y };
      root.classList.add('drag'); root.setPointerCapture(ev.pointerId);
    });
    root.addEventListener('pointermove', function (ev) {
      if (!drag) return;
      var rect = root.getBoundingClientRect(), sc = W / rect.width;
      view.x = drag.vx + (ev.clientX - drag.x) * sc; view.y = drag.vy + (ev.clientY - drag.y) * sc;
      wrap.setAttribute('transform', 'translate(' + view.x + ',' + view.y + ') scale(' + view.k + ')');
    });
    root.addEventListener('pointerup', function () { drag = null; root.classList.remove('drag'); });
    root.addEventListener('pointerleave', function () { drag = null; root.classList.remove('drag'); });

    U.clear(host).appendChild(root);
    return { pos: P, colour: blocColour };
  }

  return {
    render: render, layers: state.layers, blocColour: blocColour,
    select: function (id) { state.sel = id; },
    selected: function () { return state.sel; },
    reset: function () { state.view = { k: 1, x: 0, y: 0 }; },
  };
})();
