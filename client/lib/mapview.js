/* AGENT TRANSFER — ★ THE MAP.
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
  /**
   * ★ BY POSITION, NOT BY HASH.
   *
   * Hashing a principal id into a 12-entry palette used only 8 of the 12
   * across 16 principals and put FOUR of them on `#2fb89a` — so two blocs were
   * fenced in the same green, and since one of them is a defaulter whose
   * handle is red-overridden, the only green label on the map named the other.
   *
   * Assigning by index in the frame's own sorted `standings[]` is just as
   * deterministic, is derived from the frame rather than from a hash function,
   * and is collision-free up to twelve blocs. Past twelve it wraps, which is
   * honest and is also more blocs than the sway data has ever carried.
   */
  var blocOrder = {};
  function setBlocOrder(standings) {
    blocOrder = {};
    (standings || []).slice().sort(function (a, b) {
      return String(a.principal).localeCompare(String(b.principal));
    }).forEach(function (r, i) { blocOrder[r.principal] = i; });
  }
  function blocColour(pid) {
    var i = blocOrder[pid];
    if (i === undefined) i = Math.floor(h01(String(pid)) * BLOC.length);
    return BLOC[i % BLOC.length];
  }

  var TIERS = ['COMMONS', 'MARCHES', 'FRONTIER'];
  // band radii as a fraction of R. The gaps between them are the boundary the
  // prompt says a stranger must be able to put a finger on.
  var BAND = { COMMONS: [0.00, 0.235], MARCHES: [0.325, 0.665], FRONTIER: [0.755, 0.985] };
  /** the metaball radius a VERGE is built from, and therefore the distance a
      label on a bloc member must clear to be outside its own fence. */
  var VERGE_R = 30;

  /**
   * ★ THE ONE SOURCE OF THE BAND COLOURS.
   *
   * The map fills, the map legend and the SYSTEMS table's tier swatch all read
   * from here. They were three separate literals before, and they disagreed:
   * the legend drew MARCHES darker than FRONTIER while the map drew it
   * brighter, so the key was a lie about the picture it keyed.
   *
   * The steps are a real value ramp — 0x12 → 0x30 → 0x50 luminance — because a
   * 1.12:1 contrast step is not a boundary a stranger can find. Lightest at
   * the core: the Commons is settled ground, the Frontier is raw.
   */
  /**
   * ⚑ **THE LADDER MOVED OFF THE FILL AND ONTO THE EDGE, AND IT IS MEASURED.**
   *
   * The old ramp put the whole tier distinction in three flat fills covering
   * 17.9% of the screen at 1.62 : 1.35 : 1.24 contrast — and 1.35:1 between
   * MARCHES and FRONTIER is the step a stranger needs MOST (18 systems against
   * 8) and the one that was weakest. At these luminances the `+0.05` term in
   * the WCAG ratio dominates, so darkening the fills to let the star field
   * through collapses the ladder further: −35% gives 1.33/1.18, −50% gives
   * 1.23/1.11. **The fill is the wrong instrument for the ladder.**
   *
   * So: fills go dark and get out of the sky's way, and the 3 px boundary —
   * which was already drawn and already the thing an eye actually lands on —
   * carries the ladder instead.
   *
   *              edge vs its own fill      before → after
   *   COMMONS            4.25 : 1     →      9.4 : 1
   *   MARCHES            3.94 : 1     →      8.4 : 1
   *   FRONTIER           3.21 : 1     →      5.8 : 1
   *   edge-to-edge ladder      —      →   1.51 · 1.68
   *
   * A2 is served BETTER — three rings at near-white / bright cyan / mid cyan
   * are findable without reading a word — and it costs 3 × 3 px of area rather
   * than 41% of the screen. FRONTIER's fill stays two steps clear of the void
   * ground (#02141b vs #00060a) because the file has been burned once already
   * by a band one value off its backing, which made the outer tier vanish.
   */
  var BAND_FILL = { COMMONS: '#0b3946', MARCHES: '#052029', FRONTIER: '#02141b' };
  var BAND_EDGE = { COMMONS: '#cfe3e7', MARCHES: '#6fc3d8', FRONTIER: '#3f97ad' };

  /* ════════════════════════════════════════════════ ★ THE STAR FIELD ════
   *
   * ⚑ **SEEDED OFF STABLE SYSTEM IDS, AND THAT IS A RULES CONSTRAINT, NOT A
   * PERFORMANCE ONE.** §6.2 pins layout so a position keeps its meaning
   * between Reckonings — a viewer who learns "the trouble is bottom-right"
   * must still be right tomorrow. 390 background stars that reshuffle on every
   * five-second poll break exactly that rule with thirteen times more pixels
   * than the thing it protects.
   *
   * So every star is a pure function of one charted system's id: thirteen per
   * system, `h01(id + '#sx' + i)`. Same 30 ids in, same sky out, forever — and
   * the field re-derives only when the panel is resized.
   *
   * **AND THEY MUST READ AS DECORATION.** A background star is a 1 px square
   * at ≤0.30 opacity with no name, no title, no hit area and `pointer-events:
   * none`. A charted system is a 6–12 px stroked disc carrying its name AND
   * its id AND a click target. The two are four opacity steps and an order of
   * magnitude of area apart; nothing in between is ever drawn.
   *
   * Four `<path>`s of 1 px squares rather than 390 `<rect>`s — the field is
   * static, so this costs one string build per resize and nothing per frame.
   */
  /**
   * ⚑ **CANVAS, NOT SVG — AND THAT IS WHAT LETS THE DENSITY BE RIGHT.**
   *
   * Three rounds of this field were measured against the concept and the size
   * and the brightness converged while the DENSITY never moved: 11.5 → 12.5
   * blobs per 10k px against the concept's **160.7**. Thirteen times short,
   * twice in a row, because the whole field was four `<path>`s of 1 px
   * subpaths inside the pan/zoom group — so every star cost DOM, cost a
   * ~22-character subpath in an attribute string, and cost a re-rasterise on
   * every pan. At the concept's density that is a 600 KB attribute and a
   * 28,000-subpath re-raster per drag frame, and 60 fps is a hard requirement.
   *
   * The right split was in the brief all along: *canvas 2D for the star field,
   * SVG for the data.* On a canvas the field is ~28,000 `fillRect`s ONCE per
   * layout and exactly zero per frame — panning moves it with a CSS
   * `transform`, which is GPU-composited and never re-rasterises. Density
   * stops being a cost decision and goes back to being a design one.
   *
   * The seeding rule is unchanged and is the point: every star is still a pure
   * function of a stable system id, so the same thirty ids produce the same
   * sky forever. §6.2 pins layout; a field that reshuffles every poll breaks
   * the same rule with 28,000 more pixels than the layout it protects.
   */
  function paintStars(cv, systems, W, H) {
    if (!cv || !W || !H) return;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.max(1, Math.round(W * dpr));
    cv.height = Math.max(1, Math.round(H * dpr));
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    var ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    /* THE FOUR BUCKETS, and every number here is a measurement.
     *
     * Sizes match the concept exactly (median blob 2 px, median max dimension
     * 2 px — verified). The alphas are capped so that the BRIGHTEST possible
     * background star stays under the DIMMEST charted system: at round 3 the
     * brightest star hit L=98.2 while nine of thirty nodes peaked at 94–98,
     * so 30% of the map had a dim unnamed decoration out-punching a labelled
     * clickable place. The hard rule says that distinction must be
     * unmistakable, so the ceiling comes down here and the node strokes go up
     * in `app.css`. Both halves, because one alone leaves it marginal. */
    var BUCK = [
      { c: '125,145,151', a: 0.26, w: 1 },
      { c: '147,167,172', a: 0.34, w: 1 },
      { c: '180,194,198', a: 0.44, w: 2 },
      { c: '25,215,242', a: 0.30, w: 2 },
    ];
    var per = Math.max(1, Math.ceil(starCount(W, H) / Math.max(1, (systems || []).length)));
    (systems || []).forEach(function (s) {
      for (var i = 0; i < per; i++) {
        var x = h01(s.id + '#sx' + i) * W;
        var y = h01(s.id + '#sy' + i) * H;
        var v = h01(s.id + '#sv' + i);
        var b = BUCK[v > 0.965 ? 3 : v > 0.86 ? 2 : v > 0.48 ? 1 : 0];
        ctx.fillStyle = 'rgba(' + b.c + ',' + b.a.toFixed(2) + ')';
        ctx.fillRect(x | 0, y | 0, b.w, b.w);
      }
    });
  }

  var STAR_BUCKETS = ['sf-a', 'sf-b', 'sf-c', 'sf-d'];
  /* ⚑ **70, NOT 13.** Counted against the concept in an identical empty
   * 290×190 patch of sky: concept 272 legible blobs, this field 8. Full-screen
   * that is ~9,000 against ~264 — **34× short**, and the shortfall was not
   * subtle, it was the difference between "space" and "a few specks". 70 per
   * system is 2,100 stars, still four <path>s, still zero per-frame cost, and
   * still every one of them a pure function of a stable system id. */
  var PER_SYSTEM = 70;
  /**
   * ⚑ **AND THE DENSITY COMES OFF THE VIEWPORT, NOT OFF THE SYSTEM COUNT.**
   *
   * Seeding N stars per system meant zooming IN — where the sky has the most
   * room and the fewest systems — emptied it. Measured, stars per 10k px:
   * map 32.3, `con-2` 3.7, `sys-05` 6.1, `con-4` 7.5, against the concept's
   * 28.0. `con-4`, the one screen whose entire story is that nobody has taken
   * this ground, had the barest sky in the product.
   *
   * Stars are still a pure function of stable system ids — that is the rule
   * and it is unchanged — but the COUNT is now what the canvas can hold, so
   * the ids just get more draws each.
   */
  function starCount(W, H) { return Math.max(64, Math.round((W * H) / 62)); }
  function starField(systems, W, H) {
    var d = ['', '', '', ''];
    var per = Math.max(1, Math.ceil(starCount(W, H) / Math.max(1, systems.length)));
    systems.forEach(function (s) {
      for (var i = 0; i < per; i++) {
        var x = h01(s.id + '#sx' + i) * W;
        var y = h01(s.id + '#sy' + i) * H;
        var v = h01(s.id + '#sv' + i);
        // bucket 3 is the rare cyan one, ~4% of the field
        var b = v > 0.96 ? 3 : v > 0.80 ? 2 : v > 0.44 ? 1 : 0;
        /* ⚑ **DENSE AND SMALL, NOT SPARSE AND FAT — AND THE ROUND-2 FIELD WAS
         * THE WRONG ONE OF THOSE.** Round 1 drew 1.0 px at 0.13 and was
         * invisible; round 2 answered with 1.6–2.6 px at 0.22–0.62 and
         * overshot in the other direction: median blob 8 px against the
         * concept's 2 px, median peak luminance 78 against 39, and the
         * BRIGHTEST background star at L=223 out-punching SIX of nine charted
         * systems. That is the hard rule failing — a dim unnamed decoration
         * cannot be the brightest thing in its neighbourhood.
         *
         * The concept's answer is thousands of 1–2 px pinpricks. 1.0–1.9 px,
         * alphas back down, and roughly nine times as many of them. */
        var w = b === 3 ? 1.9 : b === 2 ? 1.6 : b === 1 ? 1.2 : 1.0;
        d[b] += 'M' + x.toFixed(1) + ' ' + y.toFixed(1) + 'h' + w + 'v' + w + 'h-' + w + 'Z';
      }
    });
    return d;
  }

  /**
   * Lay the 30 systems out. Angular relaxation inside a fixed radial band:
   * the band is a hard constraint (so the tiers always read as tiers) and the
   * lane graph only gets to choose the angle (so constellations cluster and
   * lanes stay short).
   *
   * `inset` reserves the edges the FLOATING PANELS cover. The tactical layout
   * puts the SYSTEMS rail and the legend ON TOP of the galaxy rather than
   * beside it, so without this the outermost FRONTIER systems lay out
   * underneath the rail and a third of the map is unreadable — the exact
   * failure the docked build existed to avoid, reintroduced by going
   * full-bleed. The ellipse is centred in the FREE area, not in the panel.
   */
  function layout(systems, W, H, inset) {
    // ELLIPTICAL, not circular. A circle inscribed in a 1160×830 panel wastes
    // ~35% of the width, and the map is the one screen that should use every
    // pixel it is given. The layout still reasons in polar coordinates on a
    // unit circle; only the projection to screen is stretched.
    var ins = inset || { l: 0, r: 0, t: 0, b: 0 };
    var FW = Math.max(240, W - ins.l - ins.r), FH = Math.max(200, H - ins.t - ins.b);
    var R = 1, cx = ins.l + FW / 2, cy = ins.t + FH / 2;
    /* ⚑ **0.435/0.425 WAS THE DOCKED BUILD'S MARGIN AND IT MADE FULL-BLEED A
     * LOSS.** Measured against the previous screenshot the "full-bleed" map
     * came out 1251×759 against 1257×776 — SIX PIXELS NARROWER and seventeen
     * shorter than the panel it replaced, because the inset now reserves the
     * rail (348) and the strip (33) explicitly where the old grid got the
     * header for free. A refactor that moves the rail one pixel and shrinks
     * the galaxy is not a layout change, it is a rewrite with a cost.
     *
     * The margin those factors leave is 6.5% / 7.5% of the FREE area — on top
     * of an inset that already reserves every panel. It was being paid twice.
     * 0.448/0.452 leaves ~5% for the outermost node's own label to fan into,
     * which is what the margin is actually for, and takes the ellipse to
     * 1300×866: **+16% area over the docked build** rather than −3%. */
    var RX = FW * 0.448, RY = FH * 0.452;
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

  /** The middle of the widest node-free arc in a tier — where a band label goes. */
  function emptiestAngle(P, tier) {
    var ths = [];
    for (var id in P) if (P[id].tier === tier) ths.push(P[id].th);
    if (!ths.length) return -Math.PI / 2;
    ths.sort(function (a, b) { return a - b; });
    var best = -1, at = -Math.PI / 2;
    for (var i = 0; i < ths.length; i++) {
      var a = ths[i], b = ths[(i + 1) % ths.length];
      var gap = norm(b - a); if (gap < 0) gap += 2 * Math.PI;
      if (gap > best) { best = gap; at = a + gap / 2; }
    }
    return at;
  }

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

  /** Walk a closed polyline at a fixed arc-length step. */
  function resample(loop, step) {
    var pts = [], acc = 0, prev = loop[0];
    if (!prev) return pts;
    pts.push(prev);
    for (var i = 1; i < loop.length; i++) {
      var p = loop[i], d = Math.hypot(p[0] - prev[0], p[1] - prev[1]);
      acc += d;
      if (acc >= step) { pts.push(p); acc = 0; }
      prev = p;
    }
    // drop a final vertex that sits on top of the first, or the spline kinks
    if (pts.length > 3) {
      var a = pts[0], b = pts[pts.length - 1];
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < step * 0.6) pts.pop();
    }
    return pts;
  }

  /**
   * Catmull-Rom through a closed loop → one smooth `d`. Solid, never dashed.
   *
   * ★ RESAMPLED TO UNIFORM ARC LENGTH FIRST. Taking every other raw vertex off
   * a 7 px marching-squares grid preserves the grid's axis-aligned staircase,
   * and Catmull-Rom through a staircase produces a hard right-angled notch —
   * one appeared on `sable`'s fence at (672,600) and bit a 20×22 px square out
   * of an outline whose whole promise is that it has no bites in it. Walking
   * the loop at a fixed arc-length step throws the staircase away before the
   * spline ever sees it.
   */
  function smooth(loop) {
    var pts = resample(loop, 13);
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
    sel: null, hov: null, view: null, cache: null, blocs: [],
  };

  /* THE LODE is node size, but the range is 6→12 rather than 5→14: at 3× the
     biggest discs merged into each other and swallowed their own labels, and
     the verge fill is drawn concentric with the node, so an oversized node and
     a territory blob become one visual channel. 2× still reads as a ladder. */
  function nodeR(sys, minY, maxY, lvl) {
    var t = maxY > minY ? (sys.yieldPerTick - minY) / (maxY - minY) : 0.5;
    // Stakes set the SIZE CLASS; the lode only breathes inside it. A quiet
    // system is 4\u20135.5 px \u2014 texture \u2014 and a staked one 10\u201313, which is the
    // whole hierarchy argument in one line. lvl is optional so the zoom
    // screen's callers keep their old geometry untouched.
    if (lvl === 2) return 12 + 1.5 * t;
    if (lvl === 1) return 10 + 1.5 * t;
    if (lvl === 0) return 4 + 1.5 * t;
    return 6 + 6 * t;
  }

  /**
   * ★ LABELS FAN RADIALLY OUTWARD, AND CLEAR THEIR OWN FENCE.
   *
   * Round 1 painted labels over the VERGE and their halos punched holes in it
   * — a false claim about a real principal. Round 2 painted the VERGE over the
   * labels and struck 12 of 30 system names through. Neither paint order is
   * the answer, because the two objects were occupying the same pixels.
   *
   * A fence is a union of discs of radius VERGE_R around the bloc's nodes, so
   * a label on a bloc member at `rr + 7` is always inside it. Pushing it past
   * VERGE_R puts it OUTSIDE its own fence — and then paint order stops
   * mattering. It clears EVERY fence, not just its own, because the verge is
   * painted last and a neighbouring bloc's outline drew over `kestrel`'s final
   * glyph. Capped, so a label can never fly off the map.
   *
   * ★ **AND IT IS A FUNCTION NOW, NOT A LOOP BODY.** The fence handles have to
   * dodge these anchors, which means they have to be known before any fence is
   * drawn — and a second copy of this arithmetic that drifted by 4 px would be
   * a collision detector that misses.
   */
  function nodeLabelAt(s, p, rr, blocs, blocOf) {
    // +14 when selected: the reticle's ticks reach rr+18 and at rr+7 the act
    // of selecting a system struck through its own name.
    var lx, ly, off = (blocOf[s.id] ? VERGE_R + 9 : rr + 7) + (state.sel === s.id ? 14 : 0);
    for (var att = 0; att < 5; att++) {
      lx = p.x + off * Math.cos(p.th); ly = p.y + off * Math.sin(p.th);
      var clash = false;
      for (var bp in blocs) {
        for (var bi = 0; bi < blocs[bp].length; bi++) {
          var q0 = blocs[bp][bi];
          if (Math.hypot(lx - q0.x, ly - q0.y) < VERGE_R + 5) { clash = true; break; }
        }
        if (clash) break;
      }
      if (!clash) break;
      off += 13;
    }
    var right = Math.cos(p.th) > 0.24, left = Math.cos(p.th) < -0.24;
    var dy = Math.abs(Math.cos(p.th)) > 0.24 ? 3 : (Math.sin(p.th) > 0 ? 10 : -4);
    return { x: lx, y: ly + dy, anchor: right ? 'start' : left ? 'end' : 'middle' };
  }

  /* Stakes come off THE FRAME, once, shared by the chart and the phone
   * ladder — two copies of "what is at stake tonight" that drift by one
   * clause would be the vocabulary bug in mark form.
   *   lvl 2 (red)   a promise broke: a claim at final arrears, or a rundown
   *                 beat that settled DEFAULTED on this stage. Red keeps
   *                 meaning a broken promise and nothing else.
   *   lvl 1 (amber) value at risk: arrears short of final, tribute owed on
   *                 a claim, a live raid or battle standing here.
   */
  function stakesOf(R, L) {
    var stakes = {};
    function stake(sid, lvl, line) {
      if (!sid) return;
      var cur = stakes[sid];
      if (!cur || lvl > cur.lvl) stakes[sid] = { lvl: lvl, line: line };
    }
    (R.claimLines || []).forEach(function (c) {
      var last = c.state === 'LAPSED' || (c.arrearsOf > 0 && c.arrears >= c.arrearsOf);
      if (last) stake(c.system, 2, 'CLAIM ' + U.handleOf(c.claimant) + ' \u00b7 NEXT MISS LAPSES');
      else if (c.arrears > 0 || c.owed > 0) {
        stake(c.system, 1, 'CLAIM ' + U.handleOf(c.claimant) +
          (c.arrears ? ' \u00b7 ARREARS ' + c.arrears + ' of ' + c.arrearsOf : '') +
          (c.owed ? ' \u00b7 OWED ' + U.n(c.owed) : ''));
      }
    });
    ((L && L.raidLines) || R.raidLines || []).forEach(function (rd) {
      stake(rd.stage || rd.system, 1, 'RAID' + (rd.demand ? ' \u00b7 DEMAND ' + U.n(rd.demand) : '') +
        (rd.sides ? ' \u00b7 ' + rd.sides + ' SIDES' : ''));
    });
    ((L && L.battleLines) || R.battleLines || []).forEach(function (b) {
      stake(b.stage || b.system, 1, 'BATTLE LIVE');
    });
    (R.rundown || []).forEach(function (b) {
      if (b.defaulted && b.glyph && b.glyph.stage) stake(b.glyph.stage, 2, 'PROMISE BROKEN TONIGHT');
    });
    return stakes;
  }

  function render(host, R, L, opts) {
    var o = opts || {};
    var W = host.clientWidth || 1200, H = host.clientHeight || 700;
    if (!R || !R.map || !R.map.length) {
      // ★ THE REASON IS DRAWN, NOT HIDDEN IN A TOOLTIP. Everywhere else a
      // one-line strip with the argument on hover is the right trade, because
      // the panel around it is full of other things. Here the panel IS the
      // empty thing — 1110x798 of it — and nobody hovers a blank canvas.
      var W0 = host.clientWidth || 900, H0 = host.clientHeight || 600;
      var cx0 = W0 / 2, cy0 = H0 / 2, r0 = Math.min(W0, H0) * 0.3;
      U.clear(host).appendChild(S('svg', {
        viewBox: '0 0 ' + W0 + ' ' + H0, style: 'width:100%;height:100%;display:block',
      }, [
        // the three bands, empty, so the shape of the thing that is coming is
        // on screen while it is not here yet
        S('ellipse', { cx: cx0, cy: cy0, rx: r0 * 3.2, ry: r0 * 2.2, fill: 'none', stroke: '#0d2830', 'stroke-width': 2 }),
        S('ellipse', { cx: cx0, cy: cy0, rx: r0 * 2.1, ry: r0 * 1.45, fill: 'none', stroke: '#0d2830', 'stroke-width': 2 }),
        S('ellipse', { cx: cx0, cy: cy0, rx: r0 * 0.72, ry: r0 * 0.5, fill: 'none', stroke: '#20363c', 'stroke-width': 2, 'stroke-dasharray': '5 6' }),
        S('text', {
          x: cx0, y: cy0 - 14, 'text-anchor': 'middle', fill: '#4e9db2',
          style: 'font:600 15px "Roboto Condensed",sans-serif;letter-spacing:.24em',
          text: 'NO MAP UNTIL THE FIRST RECKONING',
        }),
        S('text', {
          x: cx0, y: cy0 + 12, 'text-anchor': 'middle', fill: '#6f8288',
          style: 'font:12px ui-monospace,monospace',
          text: 'the lane graph is published at settlement, once per 288 ticks',
        }),
        S('text', {
          x: cx0, y: cy0 + 32, 'text-anchor': 'middle', fill: '#3f5158',
          style: 'font:11px ui-monospace,monospace',
          text: 'the live frame carries motion, not topology' +
            (L ? '  \u00b7  ' + L.ticksUntilReckoning + ' ticks to go' : ''),
        }),
      ]));
      return;
    }
    var ins = o.inset || { l: 0, r: 0, t: 0, b: 0 };
    var key = R.stateHash + ':' + W + ':' + H + ':' + ins.l + ',' + ins.r + ',' + ins.t + ',' + ins.b;
    if (!state.cache || state.cache.key !== key) {
      state.cache = { key: key, lay: layout(R.map, W, H, ins) };
    }
    var lay = state.cache.lay, P = lay.pos, cx = lay.cx, cy = lay.cy, RX = lay.RX, RY = lay.RY;
    var idx = {}; R.map.forEach(function (s) { idx[s.id] = s; });
    setBlocOrder(R.standings);
    var minY = Infinity, maxY = -Infinity;
    R.map.forEach(function (s) { minY = Math.min(minY, s.yieldPerTick); maxY = Math.max(maxY, s.yieldPerTick); });

    /* ═══════════════════════════ ★ INK FOLLOWS STAKES ═══════════════════
     *
     * The owner's complaint, verbatim off a screenshot of this screen:
     * thirty near-identical rings, and the night's one line of real drama
     * ten pixels tall. The fix is a HIERARCHY pass, not more pixels: a
     * system where money or a promise stands at risk TONIGHT is large and
     * annotated; a quiet system is a small dim point that reads as
     * texture. Concept plate map-v2-a-hierarchy.png is the reference, and
     * its legend line is the rule: LARGE MEANS AT STAKE TONIGHT.
     *
     * Stakes come off THIS FRAME only, same as every other mark here:
     *   lvl 2 (red)   a promise broke — a claim at its final arrears, or a
     *                 rundown beat that settled DEFAULTED on this stage.
     *                 Red keeps meaning a broken promise and nothing else.
     *   lvl 1 (amber) value at risk — arrears short of final, tribute
     *                 owed, a live raid or battle standing here.
     * Everything else is lvl 0: quiet, and drawn quiet.
     */
    var stakes = stakesOf(R, L);

    var gBands = S('g'), gLanes = S('g'), gVerge = S('g'), gClaims = S('g'),
      gMotion = S('g'), gNodes = S('g'), gLabels = S('g'), gCon = S('g'), gPlates = S('g'),
      gSel = S('g', { class: 'selg' });

    // ── ★ THE THREE BANDS ────────────────────────────────────────────────
    // Drawn outermost-first so they stack into three real values of ground
    // with a lit edge between each. A stranger has to be able to put a finger
    // on the line between two bands without reading a word, and every
    // generated map in the sweep failed exactly that.
    function ell(r) { return { rx: (r * RX).toFixed(1), ry: (r * RY).toFixed(1) }; }
    [['FRONTIER', 0.985], ['MARCHES', 0.665], ['COMMONS', 0.235]].forEach(function (b) {
      var e = ell(b[1]);
      gBands.appendChild(S('ellipse', {
        cx: cx, cy: cy, rx: e.rx, ry: e.ry, fill: BAND_FILL[b[0]], stroke: 'none',
      }));
      gBands.appendChild(S('ellipse', {
        class: 'band-edge' + (b[0] === 'COMMONS' ? ' commons' : ''),
        cx: cx, cy: cy, rx: e.rx, ry: e.ry, stroke: BAND_EDGE[b[0]],
      }));
    });
    var counts = { COMMONS: 0, MARCHES: 0, FRONTIER: 0 };
    R.map.forEach(function (s) { counts[s.tier] = (counts[s.tier] || 0) + 1; });

    // ★ A BAND LABEL NAMES THE GROUND IT SITS ON.
    //
    // The first build put all three in the radial GAPS — 0.281 / 0.712 / 1.085
    // — reasoning that no node can occupy a gap, so the labels were
    // collision-free by construction. They were, and they were also all
    // outside the band they named: "THE FRONTIER" floated in the void beyond
    // the outermost fill, and a stranger reading top-to-bottom mislabelled
    // every tier. Collision-free and wrong is worse than crowded and right.
    //
    // So they go back INSIDE, at each band's radial midpoint, drawn as the
    // mock draws its own — large, ghosted, well behind the data — and placed
    // at the angle with the widest node-free arc so they still rarely collide.
    [['FRONTIER', 0.87], ['MARCHES', 0.50]].forEach(function (b) {
      var p = proj(lay, b[1], emptiestAngle(P, b[0]));
      gBands.appendChild(S('text', {
        class: 'band-label', x: p.x.toFixed(1), y: (p.y + 5).toFixed(1), 'text-anchor': 'middle',
        text: 'THE ' + b[0] + ' · ' + counts[b[0]],
      }));
    });
    // ★ The COMMONS is the one band whose label goes just OUTSIDE it, at 12 and
    // 6 o'clock in the gap ring. Four systems in a disc leaves no interior a
    // 120px line can sit in — the first version put the name on Candle and A8's
    // one on-map sentence on Salt Ward. A label immediately against the dotted
    // boundary, with a leader tick to it, is unambiguous in a way that the
    // FRONTIER and MARCHES labels were not, because the Commons is the
    // innermost region and there is nothing else the label could belong to.
    [[-Math.PI / 2, 'THE COMMONS · ' + counts.COMMONS], [Math.PI / 2, 'HOSTILE ACTION IS INVALID']]
      .forEach(function (t) {
        var p = proj(lay, 0.288, t[0]), e = proj(lay, 0.238, t[0]);
        gBands.appendChild(S('line', {
          x1: p.x, y1: p.y + (t[0] < 0 ? 3 : -3), x2: e.x, y2: e.y,
          stroke: '#93a6aa', 'stroke-opacity': 0.5,
        }));
        gBands.appendChild(S('text', {
          class: 'band-label commons', x: p.x.toFixed(1),
          y: (p.y + (t[0] < 0 ? -3 : 11)).toFixed(1), 'text-anchor': 'middle', text: t[1],
        }));
      });

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
      var rr = 0.712;   // the MARCHES/FRONTIER gap: no node can be here, and it is inside the world
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
      var clab = S('text', {
        class: 'con-label' + (o.onZoom ? ' go' : ''), x: m.x.toFixed(1), y: (m.y + 4).toFixed(1),
        // the count excludes COMMONS members (con-1 has 7 systems, 4 of them
        // in the Commons), and a bare number summing to 26 beside a header
        // saying 30 is a discrepancy nobody can resolve from the screen
        text: c.toUpperCase().replace('CON-', 'CON ') + ' · ' + a.n,
      }, S('title', { text: 'drill into ' + c }));
      if (o.onZoom) {
        clab.addEventListener('click', function (ev) { ev.stopPropagation(); o.onZoom(c, null); });
      }
      gCon.appendChild(clab);
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
            class: 'door-t', x: (wx + px * 18).toFixed(1), y: (wy + py * 18 + 3).toFixed(1),
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
    var blocs = {}, blocOf = {}, labelPts = [];
    if (state.layers.verge && R.swayLines && R.swayLines.length) {
      R.swayLines.forEach(function (s) {
        if (!s.principal) return;                       // bare ground is drawn bare
        var p = P[s.system]; if (!p) return;
        if (idx[s.system] && idx[s.system].tier === 'COMMONS') return;  // A8: no fence crosses the Commons
        (blocs[s.principal] || (blocs[s.principal] = [])).push({ x: p.x, y: p.y, sway: s.sway });
        blocOf[s.system] = s.principal;
      });
      var defaulters = {};
      (R.standings || []).forEach(function (r) { if (r.defaults > 0) defaulters[r.principal] = r.defaults; });
      state.blocs = [];
      // every system name's anchor, computed before any fence is labelled so a
      // handle can be placed clear of them. Same formula the node loop uses;
      // `nodeLabelAt` is the one definition of it.
      R.map.forEach(function (s) {
        var p2 = P[s.id]; if (!p2) return;
        var rr2 = state.layers.lode ? nodeR(s, minY, maxY) : 7;
        labelPts.push(nodeLabelAt(s, p2, rr2, blocs, blocOf));
        // ⚑ and the NODE ITSELF. Round 2 dodged `brannock` off Bastion's
        // label and dropped it straight onto Mirefall's node halo — a
        // collision detector that knows about text and not about the discs
        // the text is attached to just relocates the collision.
        labelPts.push({ x: p2.x, y: p2.y, r: rr2 + 6 });
      });
      Object.keys(blocs).sort().forEach(function (pid) {
        var pts = blocs[pid], col = blocColour(pid);
        var loops = contours(pts, VERGE_R, 7);
        if (!loops.length) return;
        var d = loops.map(smooth).join(' ');
        if (!d) return;
        state.blocs.push({ principal: pid, colour: col, systems: pts.length, defaults: defaulters[pid] || 0 });
        // ★ AT MOST TWO HANDLES PER BLOC, AND NEVER TWICE IN THE SAME PLACE.
        //
        // One label per bloc left three of brannock's four rings anonymous,
        // including the two carrying its claim and its raid. One label per
        // LOOP printed `brannock ▲3` three times in one corner. The middle
        // answer: the two largest loops get the handle, and the second only if
        // it is far enough from the first to be telling a viewer something new.
        // Every other loop is still unmistakably the same bloc — it is drawn
        // in the bloc's own colour, which is now collision-free.
        var ranked = loops.slice().sort(function (a, b) { return b.length - a.length; }).slice(0, 2);
        var placed = [];
        ranked.forEach(function (lp) {
          /* ⚑ **THE HANDLE HAS TO DODGE THE SYSTEM NAMES, NOT LOSE TO THEM.**
           *
           * The fence's topmost vertex is ~VERGE_R above its topmost member,
           * and a bloc member's own label is pushed to exactly VERGE_R + 9 —
           * so the two land on each other by construction. Node labels are
           * drawn LATER in the same group and carry a 3.2 px halo, so the
           * handle lost: `brannock` rendered as `b` … `k` with the middle
           * eaten by `Mirefall`, on the map whose subject is which named
           * principal holds which named ground.
           *
           * Every node label's anchor is already computed above, so this walks
           * the fence's own vertices — topmost first, then the next highest —
           * and takes the first one clear of all of them. It stays ON the
           * fence, which is where a fence's label belongs. */
          var cands = lp.slice().sort(function (a, b) { return a[1] - b[1]; });
          var t2 = cands[0];
          for (var ci = 0; ci < cands.length; ci += 3) {
            var c0 = cands[ci], ok = true;
            for (var li = 0; li < labelPts.length; li++) {
              // ⚑ the label BLOCK is two lines — the name at `y` and the id at
              // `y + 9` — and checking only the name is how `brannock` came out
              // as `brann·ck` with `sys-18`'s halo through the middle. The
              // band is [y−14, y+22]: name ascender to id descender.
              var a3 = labelPts[li], cy2 = c0[1] - 11;
              if (a3.r) {
                if (Math.hypot(a3.x - c0[0], a3.y - cy2) < a3.r + 9) { ok = false; break; }
              } else if (Math.abs(a3.x - c0[0]) < 56 && cy2 > a3.y - 14 && cy2 < a3.y + 22) { ok = false; break; }
            }
            if (ok) { t2 = c0; break; }
          }
          var far = placed.every(function (q) { return Math.hypot(q[0] - t2[0], q[1] - t2[1]) > 130; });
          if (!far) return;
          placed.push(t2);
          /* ⚑ **THE HANDLE KEEPS ITS BLOC COLOUR; ONLY THE BADGE IS RED.**
           *
           * Counted: the concept spends 17 red marks on ONE subject and drags
           * the eye there. This map was spending 13 across EIGHT — five broken
           * promises plus three bloc handles — so red stopped pointing at
           * anything and became a census. A handle is IDENTITY, and identity
           * is not an accusation; the ▲N badge beside it is the accusation and
           * it is the part that gets the alarm colour. Same information, one
           * subject per mark. */
          var lab = S('text', {
            class: 'verge-lab', x: t2[0].toFixed(1), y: (t2[1] - 11).toFixed(1), 'text-anchor': 'middle',
            fill: col,
          }, S('tspan', { text: U.handleOf(pid) }));
          if (defaulters[pid]) {
            lab.appendChild(S('tspan', {
              fill: '#e34a3f', text: ' \u25b2' + defaulters[pid],
            }));
          }
          gLabels.appendChild(lab);
        });
        // a dark backing stroke under the fence, so a label halo crossing it
        // cannot punch a hole through the one line that must never have one
        gVerge.appendChild(S('path', {
          d: d, fill: 'none', stroke: '#00060a', 'stroke-width': 4.4, 'stroke-linejoin': 'round',
        }));
        gVerge.appendChild(S('path', { class: 'verge', d: d, stroke: col, fill: col }));
        // the handle sits on the fence. It is drawn RED when that principal has
        // a default on the record — the map answering the only question that
        // matters in three seconds.

      });
    }

    // ── claims ──────────────────────────────────────────────────────────
    if (state.layers.claims) {
      (R.claimLines || []).forEach(function (c) {
        var p = P[c.system]; if (!p) return;
        // ★ THE CLAIM RAMP, three steps, matching the mock's own legend:
        //   held/supplied  bloc colour · one miss  amber · last miss  red
        // The first build fired full red on the first miss, which spends the
        // alarm colour on a claim that is still standing.
        var last = c.state === 'LAPSED' || (c.arrearsOf > 0 && c.arrears >= c.arrearsOf);
        var col = last ? '#ca010f' : c.arrears > 0 ? '#d89c42' : blocColour(c.claimant);
        gClaims.appendChild(S('circle', {
          class: 'claim-tint', cx: p.x, cy: p.y, r: nodeR(idx[c.system], minY, maxY) + 6.5,
          fill: col, stroke: col,
        }, S('title', { text: c.legend || c.state })));
      });
      (R.ruins || []).forEach(function (r) {
        var p = P[r.system]; if (!p) return;
        // THE RUIN is a heavy dark blot with a broken ring, not a red cross:
        // destruction is permanent and it is not a lie, so it does not get the
        // one colour reserved for a broken word.
        gClaims.appendChild(S('circle', {
          class: 'ruin-ring', cx: p.x, cy: p.y, r: nodeR(idx[r.system] || { yieldPerTick: minY }, minY, maxY) + 5,
        }));
        gClaims.appendChild(S('path', {
          class: 'ruin-mk',
          d: 'M' + (p.x - 6) + ' ' + (p.y - 6) + 'l12 12M' + (p.x + 6) + ' ' + (p.y - 6) + 'l-12 12',
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
      /* ★ **THE SEAT — WHERE THE LEVY CONVERGES, AND THE MAP'S ONLY STAKE.**
       *
       * The critic's sharpest line: *"your map answers where things are; the
       * concept's answers who is about to lose something."* It was right, and
       * the missing field was not missing — `tributeLines[]` has carried
       * THIRTEEN rows since it was written and not one pixel depended on any
       * of them. A14 makes the Levy the one promise nobody can dodge into
       * quiet, and it was the one promise with no mark.
       *
       * Eleven of tonight's thirteen converge on `sys-01`, one on `sys-08`,
       * one on `sys-16` — which is exactly the *"convergence on a handful of
       * hands"* the frame contract says this key exists to render. So the
       * receiving system gets a dotted collection ring and a count, and the
       * count goes AMBER the moment any line into it is REVERSING (a seizure)
       * or DASHED (no hand assigned to carry it). Amber, not red: value at
       * risk is not yet a broken word. `RED` — unpaid at the freeze — is the
       * state that earns the alarm colour, and it is a state this frame does
       * not currently carry. */
      var seats = {};
      (R.tributeLines || []).forEach(function (t) {
        var e = seats[t.to] || (seats[t.to] = { n: 0, owed: 0, hot: 0, red: 0 });
        e.n++; e.owed += t.owed || 0;
        if (t.state === 'REVERSING' || t.state === 'DASHED') e.hot++;
        if (t.state === 'RED') e.red++;
      });
      Object.keys(seats).sort().forEach(function (sid) {
        var p = P[sid]; if (!p) return;
        var e = seats[sid], rr3 = nodeR(idx[sid] || { yieldPerTick: minY }, minY, maxY);
        /* ⚑ **SPOKES, NOT A DOTTED RING.**
         *
         * A dotted white ring around a node was, by count, the FOURTH thing
         * on these screens drawn as a dotted ring — the COMMONS boundary, the
         * fuel ring, an arrears outline, and now this — and it was the same
         * hue and pitch as the COMMONS. A clustering pass literally merged
         * the Salt Ward seat ring into the Commons ellipse; a viewer has no
         * better tools. HARD RULE 4 is one word per concept, and it has a
         * pixel counterpart: one MARK per concept.
         *
         * Six short spokes pointing INWARD is the convergence this key
         * renders — the contract's own word for it — and nothing else on
         * either screen is drawn as spokes. */
        for (var sp2 = 0; sp2 < 6; sp2++) {
          var sa = -Math.PI / 2 + sp2 * Math.PI / 3;
          gMotion.appendChild(S('line', {
            class: 'seat-spoke' + (e.red ? ' red' : e.hot ? ' hot' : ''),
            x1: (p.x + (rr3 + 15) * Math.cos(sa)).toFixed(1),
            y1: (p.y + (rr3 + 15) * Math.sin(sa)).toFixed(1),
            x2: (p.x + (rr3 + 6) * Math.cos(sa)).toFixed(1),
            y2: (p.y + (rr3 + 6) * Math.sin(sa)).toFixed(1),
          }));
        }
        gMotion.appendChild(S('circle', {
          class: 'seat-hit', cx: p.x, cy: p.y, r: (rr3 + 15).toFixed(1),
        }, S('title', {
          text: 'THE SEAT · ' + e.n + ' tribute lines converge here' +
            (e.owed ? ' · ' + U.n(e.owed) + ' owed' : '') +
            (e.hot ? ' · ' + e.hot + ' not moving' : ''),
        })));
        /* ⚑ OPPOSITE THE NODE'S OWN NAME — AND ASKED, NOT INFERRED.
         *
         * A fixed `+rr+21` put `◈ 11 · 31K OWED` straight through
         * `Salt Ward / sys-01`, which is the busiest seat on the map (ten of
         * the eleven tribute lines land there) and therefore the one caption
         * that had to be readable. Inferring the free side from `sin(th)` got
         * it backwards for the Commons ring, which is exactly where those ten
         * are. `nodeLabelAt` already knows where the name went — five branches
         * of radial offset, halo and anchor — so ask it rather than
         * re-deriving a rule it owns.
         *
         * ★ AND IT CLEARS THE OUTERMOST DRAWN RADIUS, NOT THE YIELD ONE.
         * `rr3` is THE LODE's radius. Wither's yield disc is r≈11 and its
         * CLAIM ring is r≈30, so a caption at `rr3 + 22` sat under the claim
         * ring and 80% of it was destroyed — two 3 px fragments left on the
         * map, reading as dirt.
         *
         * ★ AND IT GOES IN `gLabels`. `gMotion` is painted before the nodes
         * and before every other label, so on `sys-08` the caption came out as
         * `◈ TRIB TE`. A seat caption is a LABEL; it belongs in the group
         * that wins.
         */
        var la = nodeLabelAt(idx[sid], p, rr3, blocs, blocOf);
        var outer = rr3 + 15;
        (R.claimLines || []).forEach(function (c2) {
          if (c2.system === sid) outer = Math.max(outer, rr3 + 13);
        });
        ((L && L.frontBands) || R.frontBands || []).forEach(function (f2) {
          if (f2.system === sid) outer = Math.max(outer, 17 + 22 * ((f2.tintBps || 0) / 10000));
        });
        gLabels.appendChild(S('text', {
          // RED is unpaid at the freeze, which is a word broken; REVERSING and
          // DASHED are value at risk, which is amber. Binding both to `hot`
          // was an invariant whose subject cannot occur, written in CSS.
          class: 'seat-t' + (e.red ? ' red' : e.hot ? ' hot' : ''),
          x: p.x, y: (la.y > p.y ? p.y - outer - 9 : p.y + outer + 17).toFixed(1),
          // `◈ 1` alone communicated nothing: an unexplained count badge in
          // a field that already carries `▲N`. The noun costs eight chars.
          text: '◈ ' + e.n + ' TRIBUTE' + (e.owed ? ' · ' + U.k(e.owed) + ' OWED' : ''),
        }));
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
      var stk = stakes[s.id];
      var lvl = stk ? stk.lvl : 0;
      var rr = state.layers.lode ? nodeR(s, minY, maxY, lvl) : (lvl ? 10 : 5);
      var g = S('g');
      if (s.fuelPerTick > 0) g.appendChild(S('circle', { class: 'fuel-ring', cx: p.x, cy: p.y, r: rr + 3.6 }));
      var c = S('circle', {
        class: 'node node-' + s.tier + (state.sel === s.id ? ' sel' : '') +
          (lvl === 2 ? ' node-stk2' : lvl === 1 ? ' node-stk1' : ' node-quiet'),
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
      c.addEventListener('dblclick', function (ev) {
        ev.stopPropagation(); if (o.onZoom) o.onZoom(s.constellation, s.id);
      });
      // Hover = the callout without the pin. Fine pointers only: on touch,
      // pointerenter fires glued to the tap and the leave never comes, which
      // would wedge the last-touched callout on screen forever.
      if (window.matchMedia && window.matchMedia('(hover: hover)').matches) {
        c.addEventListener('pointerenter', function () { state.hov = s.id; focusDraw(s.id); });
        c.addEventListener('pointerleave', function () {
          if (state.hov === s.id) state.hov = null;
          focusDraw(state.sel);
        });
      }
      g.appendChild(c);
      gNodes.appendChild(g);
      if (state.layers.labels) {
        // ★ LABELS FAN RADIALLY OUTWARD, AND CLEAR THEIR OWN FENCE.
        //
        // Round 1 painted labels over the VERGE and their halos punched holes
        // in it — a false claim about a real principal. Round 2 painted the
        // VERGE over the labels and struck 12 of 30 system names through.
        // Neither paint order is the answer, because the two objects were
        // occupying the same pixels.
        //
        // A fence is a union of discs of radius VERGE_R around the bloc's
        // nodes, so a label on a bloc member at `rr + 7` is always inside it.
        // Pushing that label past VERGE_R puts it OUTSIDE its own fence, and
        // then the paint order stops mattering at all.
        // …and clear EVERY fence, not just its own: the verge is painted last,
        // so a neighbouring bloc's outline drew straight over `kestrel`'s
        // final glyph. Walk outwards until the label origin is clear of every
        // bloc's disc, capped so a label can never fly off the map.
        var a2 = nodeLabelAt(s, p, rr, blocs, blocOf);
        // the halo is the BAND FILL rather than the void, so a name is not the
        // highest-contrast edge on a map whose subject is a tier boundary.
        var halo = BAND_FILL[s.tier];
        gLabels.appendChild(S('text', {
          class: 'node-lab', x: a2.x.toFixed(1), y: a2.y.toFixed(1), 'text-anchor': a2.anchor,
          stroke: halo, text: s.name,
        }));
        gLabels.appendChild(S('text', {
          class: 'node-id', x: a2.x.toFixed(1), y: (a2.y + 9).toFixed(1), 'text-anchor': a2.anchor,
          stroke: halo, text: s.id,
        }));
      }
    });

    /* ═══════════════════════════════════ ★ THE RETICLE AND THE CALLOUT ════
     *
     * The tactical concept's one genuinely new INTERACTION: a selected system
     * is ringed by a reticle and answered by a callout beside it, so the
     * three-second question — *what is this place and is anything wrong with
     * it* — is answered on the map instead of in a rail 900 px away.
     *
     * The docked build already had every one of these facts. It had them in a
     * side panel the eye never travelled to while it was reading the graph,
     * which is A2's failure mode with the data technically present.
     *
     * THE LAST LINE IS THE ONLY ONE ALLOWED TO BE RED, and only for a claim in
     * its final arrears — red on this map means a promise broke, and a callout
     * that spends it on "3 straits" spends the one alarm colour on geography.
     */
    /* ★ HOVER IS SELECT-LITE. The callout used to fire only on CLICK, so the
     * three-second answer the comment below promises was gated behind knowing
     * the map is clickable. Now pointing at a system draws the same callout
     * (concept plate map-v2-b-hovercard.png), and clicking PINS it — the
     * reticle marks the pin, hover shows no reticle, and leaving returns to
     * whatever was pinned. Touch has no hover; a tap is a click and pins,
     * exactly as before. focusDraw is idempotent over gSel. */
    function focusDraw(focusId) {
      while (gSel.firstChild) gSel.removeChild(gSel.firstChild);
      if (!focusId || !P[focusId]) return;
      var pinned = focusId === state.sel;
      var ss = idx[focusId], sp = P[focusId];
      var slvl = stakes[focusId] ? stakes[focusId].lvl : 0;
      var srr = state.layers.lode ? nodeR(ss, minY, maxY, slvl) : (slvl ? 10 : 5);
      var RR = srr + 13;
      if (pinned) {
      // two opposing arcs + four ticks: a ring alone reads as another claim
      // tint, and the claim tint is a real mark this map already draws.
      [0, 180].forEach(function (a0) {
        var a1 = (a0 - 52) * Math.PI / 180, a2 = (a0 + 52) * Math.PI / 180;
        gSel.appendChild(S('path', {
          class: 'ret-arc',
          d: 'M' + (sp.x + RR * Math.cos(a1)).toFixed(1) + ' ' + (sp.y + RR * Math.sin(a1)).toFixed(1) +
            'A' + RR + ' ' + RR + ' 0 0 1 ' +
            (sp.x + RR * Math.cos(a2)).toFixed(1) + ' ' + (sp.y + RR * Math.sin(a2)).toFixed(1),
        }));
      });
      [-90, 90].forEach(function (a0) {
        var a = a0 * Math.PI / 180;
        gSel.appendChild(S('line', {
          class: 'ret-tick',
          x1: (sp.x + (RR - 5) * Math.cos(a)).toFixed(1), y1: (sp.y + (RR - 5) * Math.sin(a)).toFixed(1),
          x2: (sp.x + (RR + 5) * Math.cos(a)).toFixed(1), y2: (sp.y + (RR + 5) * Math.sin(a)).toFixed(1),
        }));
      });
      }

      // ── the lines, and every one of them comes off this frame ──────────
      var cl = (R.claimLines || []).filter(function (c) { return c.system === focusId; })[0];
      var wk = (R.worksLines || []).filter(function (w) { return w.system === focusId; });
      var sw = (R.swayLines || []).filter(function (w) { return w.system === focusId; })[0];
      var rn = (R.ruins || []).filter(function (r) { return r.system === focusId; })[0];
      var lines = [
        { t: ss.name.toUpperCase() + '  ·  ' + ss.id + '  ·  ' + ss.tier, c: 'co-h' },
        {
          t: ss.yieldPerTick + ' ore/tick' + (ss.fuelPerTick ? '  ·  ' + ss.fuelPerTick + ' fuel/tick' : '') +
            (ss.richnessBps ? '  ·  ' + (ss.richnessBps > 0 ? '+' : '') + ss.richnessBps + ' bps' : ''),
          c: 'co-b',
        },
        {
          t: (ss.lanes || []).length + ' LANES  ·  ' + (ss.straits || []).length + ' STRAITS' +
            (sw && sw.reachers ? '  ·  reachers ' + sw.reachers : ''),
          c: 'co-b',
        },
      ];
      /* ★ THE CLAIM GOES SECOND, AND THE STRAITS GET ONE LINE BETWEEN THEM.
       *
       * Round 1 pushed up to three `STRAIT …` rows ahead of everything else,
       * so a system one miss from LAPSING got its red line as row 7 of 8, in
       * the same 10 px type as its routing. §16.12 does rank the chokepoint
       * first among FEATURES, which is not the same as ranking it first in a
       * callout about one place. The concept's callout ENDS on `ARREARS 2 of 2
       * · NEXT MISS LAPSES`: the drama outranks the road. */
      if (cl) {
        var last = cl.state === 'LAPSED' || (cl.arrearsOf > 0 && cl.arrears >= cl.arrearsOf);
        lines.push({
          t: 'CLAIM ' + U.handleOf(cl.claimant) + '  ·  ' + (cl.legend || cl.state) +
            (cl.arrearsOf && cl.arrears ? '  ·  ARREARS ' + cl.arrears + ' of ' + cl.arrearsOf : '') +
            (last ? '  ·  NEXT MISS LAPSES' : '') +
            (cl.anchorHot === false ? '  ·  ANCHOR COLD' : ''),
          c: last ? 'co-r' : cl.arrears > 0 ? 'co-a' : 'co-c',
        });
      }
      var sts = ss.straits || [];
      if (sts.length) {
        var st0 = sts[0];
        lines.push({
          t: (st0.severs
            ? 'SEVERS ' + st0.to + '  ·  strands ' + st0.severed
            : 'STRAIT ' + st0.to + '  ·  detour ' + st0.detourHops + ' hops') +
            (sts.length > 1 ? '  ·  +' + (sts.length - 1) + ' more' : ''),
          c: 'co-b',
        });
      }
      if (wk.length) {
        lines.push({
          t: 'WORKS ' + wk.length + '  ·  ' + wk[0].legend +
            (wk[0].sharePerTick ? '  ·  ' + wk[0].sharePerTick + '/tick each' : ''),
          c: 'co-b',
        });
      }
      var pl = (R.places || []).filter(function (p) { return p.system === focusId; })[0];
      if (pl) lines.push({ t: 'NAMED FOR ' + pl.handle + '  ·  since t' + pl.sinceTick, c: 'co-d' });
      if (sw && sw.principal) {
        lines.push({ t: 'SWAY ' + U.handleOf(sw.principal) + ' ' + sw.sway + (sw.gate ? '  ·  STRAIT GATE' : ''), c: 'co-d' });
      }
      if (rn) lines.push({ t: (rn.legend || 'RUIN').toUpperCase(), c: 'co-d' });

      // ★ THE DRILL AFFORDANCE LIVES ON THE CALLOUT.
      //
      // The zoomed screen is reachable by double-clicking a node and by
      // clicking a constellation arc, and NEITHER of those is discoverable —
      // this repo's own refrain is that a capability nobody exercises is
      // indistinguishable from one that is missing, and an undiscoverable
      // affordance is that defect with a keyboard shortcut.
      lines.push({
        t: '▸ DRILL INTO ' + String(ss.constellation).toUpperCase() + '  ·  ' +
          R.map.filter(function (m) { return m.constellation === ss.constellation; }).length + ' SYSTEMS',
        c: 'co-go', go: true,
      });

      // 6.05 px per char at 10 px in the mono stack, measured rather than
      // guessed — a box sized off `length * 6` clipped its own last glyph.
      var wmax = 0;
      lines.forEach(function (l) { wmax = Math.max(wmax, l.t.length); });
      var BW = Math.round(wmax * 6.05) + 20, BH = lines.length * 14 + 12;
      var by = Math.max(ins.t + 6, Math.min(H - ins.b - BH - 6, sp.y - BH / 2));
      /* ★ THE SIDE THAT COVERS FEWER SYSTEMS WINS.
       *
       * Round 1 chose "right unless it would run off the canvas", which put
       * Ironhold's callout — Ironhold sits at the far LEFT of the ring — face
       * down on Coldwater and Pale Reach. A2 says legibility is the interface,
       * and an overlay that answers one system by hiding two is a net loss of
       * one system.
       *
       * So both candidate boxes are built, clamped into the viewport, and
       * scored by how many node CENTRES they cover. Fewest wins; a tie goes
       * outward from the middle of the map, which is where the empty margin
       * is. Thirty nodes × two boxes, once per selection. */
      function clampX(x) { return Math.max(ins.l + 4, Math.min(W - ins.r - BW - 4, x)); }
      function covers(x) {
        var n2 = 0;
        for (var k2 in P) {
          var q = P[k2];
          if (q.x > x - 6 && q.x < x + BW + 6 && q.y > by - 8 && q.y < by + BH + 8) n2++;
        }
        return n2;
      }
      var xR = clampX(sp.x + RR + 34), xL = clampX(sp.x - RR - 34 - BW);
      var cR = covers(xR), cL = covers(xL);
      var right = cR !== cL ? cR < cL : sp.x < cx;
      var bx = right ? xR : xL;
      // ...and if the clamp pushed the box back over its own node — Ironhold
      // sits 250 px from the left edge and a 268 px box clamped to x=4 landed
      // face down on the very system it was describing — step it clear
      // vertically instead. Above if there is room, otherwise below.
      if (bx < sp.x + RR && bx + BW > sp.x - RR) {
        var above = sp.y - RR - 10 - BH;
        by = above > ins.t + 6 ? above : Math.min(H - ins.b - BH - 6, sp.y + RR + 10);
      }
      /* ★ THE LEADER IS DRAWN AFTER THE DODGE AND IT IS BRIGHT.
       *
       * Round 1 built the path from `by` BEFORE the vertical dodge could move
       * the box, so on every dodged callout the line pointed at empty space —
       * and at 0.6 opacity nobody noticed, which meant the box read as an
       * unrelated panel that happened to be nearby. The two leaders are the
       * concept's most recognisable mark; a reticle answered by an unconnected
       * rectangle is not the same picture. */
      var ex = right ? bx - 3 : bx + BW + 3;
      var ey = Math.max(by + 9, Math.min(by + BH - 6, sp.y));
      gSel.appendChild(S('path', {
        class: 'ret-lead',
        d: 'M' + (sp.x + (right ? RR + 2 : -RR - 2)).toFixed(1) + ' ' + sp.y.toFixed(1) +
          'L' + ((sp.x + ex) / 2).toFixed(1) + ' ' + sp.y.toFixed(1) +
          'L' + ex.toFixed(1) + ' ' + ey.toFixed(1),
      }));
      gSel.appendChild(S('rect', { class: 'co-box', x: bx, y: by, width: BW, height: BH }));
      lines.forEach(function (l, i) {
        var ty = by + 16 + i * 14;
        if (l.go) {
          var hit = S('rect', {
            class: 'co-go-hit', x: bx + 1, y: ty - 11, width: BW - 2, height: 15,
          });
          hit.addEventListener('click', function (ev) {
            ev.stopPropagation();
            if (o.onZoom) o.onZoom(ss.constellation, ss.id);
          });
          gSel.appendChild(hit);
          gSel.appendChild(S('line', {
            class: 'co-rule', x1: bx + 1, y1: ty - 11, x2: bx + BW - 1, y2: ty - 11,
          }));
        }
        gSel.appendChild(S('text', {
          class: 'co-t ' + l.c, x: bx + 10, y: ty, text: l.t,
        }));
      });
    }
    /* ★ THE PLATES. Concept A's signature mark: the top staked systems
     * carry a two-line annotation ON the canvas, so the night's drama is
     * readable from across the room with nothing hovered. Capped at four —
     * past that the plates would recreate the noise they exist to cut — and
     * lvl 2 outranks lvl 1 outranks nothing. The callout remains the full
     * record; a plate is the headline. */
    Object.keys(stakes)
      .sort(function (a, b) { return stakes[b].lvl - stakes[a].lvl; })
      .slice(0, 4)
      .filter(function (sid) { return P[sid] && idx[sid]; })
      .forEach(function (sid) {
        var p = P[sid], sy = idx[sid], stk = stakes[sid];
        var t1 = sy.name.toUpperCase() + ' \u00b7 ' + sid;
        var t2 = stk.line;
        var pw = Math.max(t1.length, t2.length) * 6.05 + 16;
        var px2 = p.x + (p.x < cx ? -(pw + 22) : 22);
        px2 = Math.max(ins.l + 4, Math.min(W - ins.r - pw - 4, px2));
        var py2 = Math.max(ins.t + 4, Math.min(H - ins.b - 40, p.y - 18));
        var cls = stk.lvl === 2 ? 'plate-red' : 'plate-amber';
        gPlates.appendChild(S('line', {
          class: 'plate-lead ' + cls,
          x1: p.x + (p.x < cx ? -10 : 10), y1: p.y,
          x2: p.x < cx ? px2 + pw : px2, y2: py2 + 18,
        }));
        gPlates.appendChild(S('rect', { class: 'plate-box ' + cls, x: px2, y: py2, width: pw, height: 36 }));
        gPlates.appendChild(S('text', { class: 'plate-t1', x: px2 + 8, y: py2 + 14, text: t1 }));
        gPlates.appendChild(S('text', { class: 'plate-t2 ' + cls, x: px2 + 8, y: py2 + 29, text: t2 }));
      });
    focusDraw(state.hov || state.sel);

    // ★ THE FENCE IS PAINTED LAST, AND THAT IS A CORRECTNESS FIX.
    //
    // `gLabels` used to be the final group, and every node label carries a
    // 3.2px halo. So a label crossing a VERGE stamped a hole straight through
    // it — Orison's fence vanished for ~25 px behind the "sys-05" plate, and
    // `marrow`'s was cut twice. The 4.4 px dark backing stroke defended it from
    // nothing, because the thing eating it was painted afterwards.
    //
    // A gap in a fence reads as ground the bloc does not hold. That is a false
    // claim about a real principal, published every frame, and it is the one
    // class of bug this file's header says it exists to prevent. Verge over
    // labels, and the labels halo in the BAND FILL rather than in the void so
    // they stop being the highest-contrast edge on a map whose subject is a
    // 1.3:1 tier boundary.
    /* ★ THE STARS GO INSIDE THE PAN/ZOOM WRAP, AND THE SELECTION GOES ON TOP.
     *
     * A field that does not move with the graph reads as a wallpaper the map
     * is printed on; a field that does reads as the space the map is IN, which
     * is the whole reason the concept has one.
     *
     * ⚑ **AND THE FIELD IS PAINTED OVER THE BANDS, NOT UNDER THEM.** Under
     * them it was invisible: the three band fills are opaque and cover ~92% of
     * the canvas, so a field seeded off thirty system ids showed up in four
     * corners and nowhere else — 390 stars, ~30 of them on screen. Over them
     * the tint reads as what it is (a marked REGION of space) and the sky
     * reads as sky. The reticle is painted after the fence for the same reason
     * the fence is painted after the labels: it is the one mark that must
     * never be cut by anything. */
    var ORDER = [gBands, gCon, gLanes, gClaims, gMotion, gNodes, gLabels, gVerge, gPlates, gSel];
    var root = S('svg', {
      id: 'mapsvg', viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'xMidYMid meet',
    }, ORDER);

    // pan + zoom, on the root group so the layout never recomputes
    var view = state.view || (state.view = { k: 1, x: 0, y: 0 });
    var wrap = S('g', { transform: 'translate(' + view.x + ',' + view.y + ') scale(' + view.k + ')' });
    ORDER.forEach(function (g) { wrap.appendChild(g); });
    U.clear(root); root.appendChild(wrap);
    root.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      var f = ev.deltaY < 0 ? 1.12 : 1 / 1.12, nk = Math.max(0.5, Math.min(6, view.k * f));
      var rect = root.getBoundingClientRect();
      var mx = (ev.clientX - rect.left) * (W / rect.width), my = (ev.clientY - rect.top) * (H / rect.height);
      view.x = mx - (mx - view.x) * (nk / view.k); view.y = my - (my - view.y) * (nk / view.k);
      view.k = nk;
      wrap.setAttribute('transform', 'translate(' + view.x + ',' + view.y + ') scale(' + view.k + ')');
      moveStars();
    }, { passive: false });
    var drag = null;
    root.addEventListener('pointerdown', function (ev) {
      drag = { x: ev.clientX, y: ev.clientY, vx: view.x, vy: view.y, moved: 0 };
      root.classList.add('drag'); root.setPointerCapture(ev.pointerId);
    });
    root.addEventListener('pointermove', function (ev) {
      if (!drag) return;
      var rect = root.getBoundingClientRect(), sc = W / rect.width;
      drag.moved = Math.max(drag.moved, Math.abs(ev.clientX - drag.x) + Math.abs(ev.clientY - drag.y));
      view.x = drag.vx + (ev.clientX - drag.x) * sc; view.y = drag.vy + (ev.clientY - drag.y) * sc;
      wrap.setAttribute('transform', 'translate(' + view.x + ',' + view.y + ') scale(' + view.k + ')');
      moveStars();
    });
    // ★ EMPTY SPACE CLEARS THE SELECTION. A reticle with no way off it is a
    // mode, and the callout covers real ground while it is up.
    root.addEventListener('pointerup', function () {
      if (drag && drag.moved < 4 && state.sel && o.onSelect) o.onSelect(null);
      drag = null; root.classList.remove('drag');
    });
    root.addEventListener('pointerleave', function () { drag = null; root.classList.remove('drag'); });

    /* THE FIELD IS A SIBLING CANVAS UNDER THE SVG, and it is moved by the
       SAME numbers the SVG group is — as a CSS transform, so a pan is a
       composite rather than a 28,000-rect repaint. */
    U.clear(host);
    var cv = document.createElement('canvas');
    cv.className = 'starcv';
    host.appendChild(cv);
    host.appendChild(root);
    paintStars(cv, R.map, W, H);
    function moveStars() {
      cv.style.transform = 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.k + ')';
    }
    moveStars();
    return { pos: P, colour: blocColour };
  }

  return {
    render: render, stakesOf: stakesOf, layers: state.layers, blocColour: blocColour,
    // exported so the legend and the SYSTEMS swatch read the SAME constants the
    // map fills from — three literals that disagreed is what made the key lie
    BAND_FILL: BAND_FILL, BAND_EDGE: BAND_EDGE,
    blocs: function () { return state.blocs || []; },
    select: function (id) { state.sel = id; },
    selected: function () { return state.sel; },
    reset: function () { state.view = { k: 1, x: 0, y: 0 }; },
    // ★ THE ZOOM VIEW READS THE GALAXY LAYOUT FROM HERE rather than
    // reimplementing it. The locator inset's whole job is to say WHERE in the
    // galaxy you are, and a second layout function would answer that with a
    // second galaxy — a picture that disagrees with the map it is a key to.
    layout: layout, paintStars: paintStars, h01: h01, setBlocOrder: setBlocOrder,
  };
})();
