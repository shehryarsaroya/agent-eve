/* THE COMPACT — the eight screens.
 *
 *   OVERVIEW · PRINCIPALS · VENTURES · GRANTS · MARKET · MAP · STANDINGS · RECKONING
 *
 * TWO CLOCKS, and the whole design turns on it. OVERVIEW / VENTURES / MAP read
 * `live.json`, which is rewritten every tick: countdowns run, convoys move,
 * FORMING ventures pulse. RECKONING / STANDINGS read `latest.json`, published
 * once per 288 ticks: it is a ceremony, and it is allowed to sit still.
 *
 * A9 IS A HARD CONSTRAINT ON THIS FILE. The frame is the only legal source.
 * Nothing here computes a fact the frame does not carry, and nothing here
 * carries over a fact from a previous frame and presents it as current. Where
 * a screen wants a field that does not exist, it says so on screen rather than
 * inferring it — see `Screens.MISSING` at the bottom, which is also the list
 * this build reports back to the engine.
 *
 * A HARD LIMIT THE MOCK SERIES DISCOVERED: there is no principal-scoped read.
 * Every key is a world-scoped array capped for broadcast (7 docket cards, 12
 * authority lines, 12 rundown segments). So a full character sheet for `sable`
 * cannot be assembled unless `sable` happens to be on tonight's frame. The
 * PRINCIPALS screen therefore shows what the frame carries about a principal
 * and names what it does not, rather than fabricating the rest.
 */
/* eslint-env browser */
'use strict';

var Screens = (function () {
  var el = U.el, panel = U.panel, tile = U.tile, table = U.table, empty = U.empty;

  // ───────────────────────────────────────────────────────────────────────
  // shared bits
  // ───────────────────────────────────────────────────────────────────────

  /**
   * ★ RED DISCIPLINE, and it is the single most load-bearing rule in this file.
   *
   * `badOf` answers "does this principal have a default on the record". That is
   * a judgement, and the judgement is only allowed to colour a handle on the
   * four surfaces where judgement IS the subject: THE STANDING, the dossier,
   * the hall of fame, and the label on a VERGE.
   *
   * Everywhere else `hOf` is used, and it is always cyan. The first build wired
   * every handle through `badOf` and a mature world came out red from edge to
   * edge — twelve of sixteen principals carry a default, so the alarm colour
   * appeared on nearly every row of every table and stopped meaning anything at
   * all. One alarm colour, spent only where a promise actually broke.
   */
  function badOf(D, pid) {
    var r = (D.byPrincipal[pid] || {});
    return (r.defaults || 0) > 0;
  }
  /** A principal on a row that is not about their record. Always cyan. */
  function hOf(D, pid, text) { return U.h(pid, { text: text }); }
  /** A principal on a surface where their record IS the subject. May be red. */
  function hJudged(D, pid, text) { return U.h(pid, { bad: badOf(D, pid), text: text }); }

  function sysName(D, id) {
    var s = D.sysIndex[id];
    return s ? s.name : id;
  }

  /**
   * ★ THE FREEZE — one Reckoning as a 288-tick column, filling from the bottom,
   * with the current tick as a bright rule across it.
   *
   * A viewer's only question at a glance is "how much of the day is left", and
   * a column answers it without a number. Drawn with an SVG rather than
   * absolutely-positioned divs because the first version let the phase labels
   * escape the panel and clip against its right edge.
   */
  function freezeColumn(L) {
    var S = U.svg;
    var TOTAL = 288, W = 210, H = 250, BAR = 40, X = 12, TOP = 12;
    // ★ THE REAL BOUNDARIES, out of engine/src/core/time.ts. The first build
    // guessed 0/144/240/276 and every one of them was wrong, so the gauge put
    // the tick marker in COMMITMENT while the chrome next to it said EARLY.
    // A clock that lies is worse than no clock:
    //   SETTLEMENT_PHASE   = 287        the settling tick
    //   FREEZE_FIRST_PHASE = 286        FREEZE_TICKS = 1
    //   WINDOW_FIRST_PHASE = 262        COMMITMENT_WINDOW_TICKS = 24
    var phases = [
      ['EARLY', 0, 262], ['COMMITMENT', 262, 286], ['FREEZE', 286, 287], ['SETTLING', 287, 288],
    ];
    function yOf(t) { return TOP + (1 - t / TOTAL) * (H - TOP * 2); }
    var kids = [S('rect', { x: X, y: TOP, width: BAR, height: H - TOP * 2, fill: '#00090e', stroke: '#123038' })];
    // EARLY is 262 of the 288 ticks and SETTLING is one, so three of the four
    // labels want the same 3 px of column. Stack them downward with a hard
    // minimum gap and run a leader back to the true boundary: the BAR stays
    // proportional and truthful, and the LABELS stay readable.
    var want = phases.map(function (p) { return (yOf(p[1]) + yOf(p[2])) / 2; });
    var place = want.slice();
    for (var i = 1; i < place.length; i++) {
      if (place[i] - place[i - 1] < 13) place[i] = place[i - 1] + 13;
    }
    var over = place[place.length - 1] - (H - TOP);
    if (over > 0) for (var j = 0; j < place.length; j++) place[j] -= over;
    phases.forEach(function (p, i2) {
      var on = L && L.phase === p[0];
      var y0 = yOf(p[2]), y1 = yOf(p[1]);
      if (on) kids.push(S('rect', { x: X, y: y0, width: BAR, height: Math.max(1.5, y1 - y0), fill: 'rgba(25,215,242,.16)' }));
      kids.push(S('line', { x1: X, y1: y0, x2: X + BAR, y2: y0, stroke: '#2a5f6b' }));
      kids.push(S('path', {
        d: 'M' + (X + BAR) + ' ' + y0.toFixed(1) + 'L' + (X + BAR + 6) + ' ' + place[i2].toFixed(1) +
          'L' + (X + BAR + 10) + ' ' + place[i2].toFixed(1),
        fill: 'none', stroke: on ? '#19d7f2' : '#1d4a56',
      }));
      kids.push(S('text', {
        x: X + BAR + 14, y: place[i2] + 3, fill: on ? '#19d7f2' : '#3f5158',
        style: 'font:9px "Roboto Condensed",sans-serif;letter-spacing:.16em',
        text: p[0] + (p[2] - p[1] <= 2 ? ' ' + p[1] : ''),
      }));
    });
    // axis ticks, so the column is a scale rather than a picture
    [0, 72, 144, 216, 288].forEach(function (t) {
      kids.push(S('text', {
        x: X - 4, y: yOf(t) + 3, 'text-anchor': 'end', fill: '#2c4750',
        style: 'font:8px ui-monospace,monospace', text: String(t),
      }));
    });
    if (L) {
      var done = TOTAL - (L.ticksUntilReckoning || 0), y = yOf(done);
      kids.push(S('rect', { x: X, y: y, width: BAR, height: Math.max(0, H - TOP - y), fill: 'rgba(25,215,242,.20)' }));
      kids.push(S('line', { x1: X - 5, y1: y, x2: X + BAR + 5, y2: y, stroke: '#19d7f2', 'stroke-width': 2 }));
      kids.push(S('text', {
        x: X + BAR / 2, y: Math.max(TOP + 10, y - 6), 'text-anchor': 'middle', fill: '#19d7f2',
        style: 'font:10px ui-monospace,monospace', text: 't' + done,
      }));
    }
    return S('svg', { viewBox: '0 0 ' + W + ' ' + H, style: 'width:100%;height:' + H + 'px;display:block' }, kids);
  }

  /**
   * A live-entity row, one shape for every kind of thing in the world.
   *
   * `alert` is `'red'`, `'amber'` or null, and the split is the red discipline
   * written as data:
   *   RED    a promise was broken — a snapped venture, a tribute unpaid at the
   *          freeze, a claim that lapsed.
   *   AMBER  value is at risk or was taken by force — a raid paid, a claim in
   *          arrears, a battle, a front, a revoked grant. A raid is a loss and
   *          it is not a betrayal, and the screen must not say it is.
   */
  function liveRows(D) {
    var R = D.R, L = D.L, out = [];
    function push(type, name, at, state, ticks, stake, party, alert, kind) {
      out.push({
        type: type, name: name, at: at, state: state, ticks: ticks,
        stake: stake, party: party, alert: alert || null, kind: kind,
        tier: at && D.sysIndex[at] ? D.sysIndex[at].tier : null,
      });
    }
    ((L && L.compactLinks) || R.compactLinks || []).forEach(function (c) {
      push('VENTURE', c.kind + ' ' + c.venture.replace(/^v:/, 'v'), c.stage, c.state,
        null, c.atStake, c.a, c.snapped ? 'red' : null, 'venture');
    });
    ((L && L.raidLines) || R.raidLines || []).forEach(function (r) {
      push('RAID', r.raid, r.stage, r.state, r.ticksLeft || null, r.demand, r.target,
        r.state === 'REPULSED' ? null : 'amber', 'raid');
    });
    ((L && L.convoyLines) || R.convoyLines || []).forEach(function (c) {
      push('CONVOY', c.hand, c.from + ' → ' + c.to, c.strait ? 'IN TRANSIT · STRAIT' : 'IN TRANSIT',
        c.ticksLeft, null, c.principal, null, 'convoy');
    });
    ((L && L.claimLines) || R.claimLines || []).forEach(function (c) {
      push('CLAIM', c.claim, c.system, c.legend || c.state, null, c.bondAtRisk, c.claimant,
        c.state === 'LAPSED' ? 'red' : c.arrears > 0 ? 'amber' : null, 'claim');
    });
    (R.worksLines || []).forEach(function (w) {
      push('WORKS', w.works.replace(/^works:/, ''), w.system, w.legend, null, null, w.holder, null, 'works');
    });
    ((L && L.saps) || R.saps || []).forEach(function (s) {
      push('CAMPAIGN', s.campaign, s.objective, s.state, s.nextPulseTick, s.bond, s.attacker, 'amber', 'sap');
    });
    ((L && L.frontBands) || R.frontBands || []).forEach(function (f) {
      push('FRONT', f.front, f.system, f.state, f.ticksToLandfall, null, null,
        f.state === 'FORECAST' ? 'amber' : null, 'front');
    });
    ((L && L.authorityLines) || R.authorityLines || []).forEach(function (a) {
      push('GRANT', a.grant.replace(/^g:/, 'g'), null, a.state, null, a.granted, a.grantor,
        a.state === 'REVOKED' ? 'amber' : null, 'grant');
    });
    (R.tributeLines || []).forEach(function (t) {
      push('TRIBUTE', U.handleOf(t.principal), t.to, t.state, null, t.owed, t.principal,
        t.state === 'RED' ? 'red' : t.state === 'REVERSING' ? 'amber' : null, 'tribute');
    });
    (R.battleLines || []).forEach(function (b) {
      push('BATTLE', b.engagement, b.stage, b.state, b.ticksLeft, null, null, 'amber', 'battle');
    });
    return out;
  }

  // A raid is a LOSS, and the swatch said otherwise on six rows whose own
  // state chip read PAID in amber twelve pixels away.
  var KIND_SW = {
    venture: 'cy', raid: 'am', convoy: 'cyd', claim: 'cy', works: 'gy',
    sap: 'am', front: 'am', grant: 'cyd', tribute: 'cy', battle: 'am',
  };

  // ═══════════════════════════════════════════════════════════ OVERVIEW ══
  function overview(host, D) {
    var R = D.R, L = D.L, M = (R && R.meters) || {};
    var rows = liveRows(D);
    var stack = el('div', { class: 'rows fill', style: 'height:100%' });

    stack.appendChild(el('div', { class: 'tiles' }, [
      // TICK and the countdown are already in the chrome 12px above; a tile
      // that restates the header is 200px of nothing.
      tile('LIVE COMPACTS', String((L && L.meters ? L.meters.live : 0) + (L && L.meters ? L.meters.forming : 0)),
        { note: (L && L.meters ? L.meters.forming : 0) + ' still forming' }),
      // NOT "0". The lane graph is published at settlement; a live world with
      // fifteen rows in eight named systems that says it has zero of them is
      // the only false statement this client can make.
      (R.map || []).length
        ? tile('SYSTEMS', String(R.map.length), { note: D.laneCount + ' lanes · ' + D.straitCount + ' straits' })
        : tile('SYSTEMS', '—', { dim: true, note: 'the lane graph is published at settlement' }),
      tile('ON A PROMISE NOW', U.n((L && L.meters ? L.meters.onAPromise : M.onAPromise)),
        { note: 'live · riding on nothing but a word' }),
      // ★ SCOPE IN THE LABEL. `meters.kept`/`broken` count ELECTIVE HALVES at
      // settlement; `standings[].defaults` counts DEFAULT EVENTS per principal.
      // Different subjects, and both were captioned "on the record" — so
      // OVERVIEW said 20 and STANDINGS said 33 for what read as one number.
      tile('HALVES KEPT', U.n(M.kept), { note: 'at R' + (R.reckoningIndex !== undefined ? R.reckoningIndex : '—') + ' · elective halves paid' }),
      tile('HALVES BROKEN', U.n(M.broken),
        { bad: (M.broken || 0) > 0, note: 'at R' + (R.reckoningIndex !== undefined ? R.reckoningIndex : '—') + ' · not paid' }),
      // Amber, not red: a shortfall is value at risk, and nobody has lied yet.
      tile('LEVY SHORT', U.n(M.levyShort),
        { warn: (M.levyShort || 0) > 0, note: 'at R' + (R.reckoningIndex !== undefined ? R.reckoningIndex : '—') + ' · nobody lowers this alone' }),
      tile('UNREFINED', U.n(M.unrefined),
        { note: 'at R' + (R.reckoningIndex !== undefined ? R.reckoningIndex : '—') + ' · not yet payable', neutral: true }),
    ]));

    var main = el('div', { class: 'grid', style: 'grid-template-columns:1fr 250px;flex:1 1 auto;min-height:0' });
    // ★ SLICING, not just sorting. The mock's second-level strip is
    // ALL · HANDS · HOLDINGS · VENTURES · STANDOFFS · CONVOYS · TRIBUTE and it
    // is how a viewer gets from 70 rows to the seven they care about. A sort
    // header reorders; it never removes.
    var SLICES = [
      ['ALL', null], ['VENTURES', 'venture'], ['STANDOFFS', 'raid'], ['CONVOYS', 'convoy'],
      ['HOLDINGS', 'claim'], ['WORKS', 'works'], ['GRANTS', 'grant'], ['TRIBUTE', 'tribute'],
      ['WEATHER', 'front'],
    ];
    var slice = D.slice || 'ALL';
    var sliceBar = el('div', { class: 'slices' }, SLICES.map(function (sl) {
      var n = sl[1] ? rows.filter(function (r) { return r.kind === sl[1]; }).length : rows.length;
      return el('button', {
        'aria-current': slice === sl[0] ? 'true' : null,
        on: { click: function () { D.setSlice(sl[0]); } },
      }, [sl[0], el('span', { class: 'count', text: String(n) })]);
    }));
    var kindOf = {};
    SLICES.forEach(function (sl) { kindOf[sl[0]] = sl[1]; });
    if (kindOf[slice]) rows = rows.filter(function (r) { return r.kind === kindOf[slice]; });
    var cols = [
      { k: 'type', t: 'type', w: '86px', cell: function (r) { return el('span', null, [U.sw(KIND_SW[r.kind] || 'gy'), r.type]); } },
      { k: 'name', t: 'name', cell: function (r) { return el('span', { class: 'k', text: r.name }); } },
      { k: 'at', t: 'at', w: '128px', cell: function (r) { return r.at ? (D.sysIndex[r.at] ? U.sysLink(r.at, r.at + ' ' + sysName(D, r.at)) : r.at) : '—'; } },
      { k: 'tier', t: 'tier', w: '74px', cell: function (r) { return el('span', { class: 'dim', text: r.tier || '—' }); } },
      {
        k: 'state', t: 'state', w: '140px',
        cell: function (r) { return U.tag(r.state || '—', r.alert === 'red' ? 'rd' : r.alert === 'amber' ? 'am' : 'cy'); },
      },
      { k: 'ticks', t: 'ticks', w: '58px', num: true, cell: function (r) { return r.ticks ? String(r.ticks) : '—'; } },
      { k: 'stake', t: 'at stake', w: '86px', num: true, cell: function (r) { return r.stake ? U.n(r.stake) : '—'; } },
      { k: 'party', t: 'party', w: '104px', cell: function (r) { return r.party ? hOf(D, r.party) : el('span', { class: 'dim', text: 'the world' }); } },
      {
        // the default order: what is happening, then how much is on it
        k: 'motion', t: '·', w: '18px', num: true,
        cell: function () { return ''; },
        sort: function (r) {
          var rank = { battle: 9, raid: 8, sap: 7, convoy: 6, venture: 5, front: 4, tribute: 3, claim: 2, works: 1, grant: 0 };
          return (rank[r.kind] || 0) * 1e9 + Math.min(1e8, r.stake || 0);
        },
      },
    ];
    main.appendChild(panel('THE WORLD, RIGHT NOW', {
      sub: rows.length + ' live rows · click a column to sort',
      right: L ? el('span', null, [el('i', { class: 'pip' }), ' tick ' + L.tick]) : null,
    }, rows.length ? el('div', null, [sliceBar, table('ov', cols, rows, {
      // ★ MOTION FIRST, then stake. Sorting the world by AT STAKE opened
      // "THE WORLD, RIGHT NOW" on eleven identical UNUSED grants and two paid
      // claims — no venture, no raid, nothing moving above the fold.
      sort: 'motion', dir: -1, rerender: D.rerender,
      rowClass: function (r) { return r.alert === 'red' ? 'bad' : r.alert === 'amber' ? 'warn' : ''; },
    })])
      : el('div', null, [sliceBar, U.skeleton(9, 6)]),
    ));

    var side = el('div', { class: 'rows', style: 'min-height:0' });
    side.appendChild(panel('THE FREEZE', { sub: '288 ticks · one Reckoning' }, freezeColumn(L)));
    side.appendChild(panel('MOTION', { sub: 'live meters' }, el('div', null, [
      U.kv('FORMING', String((L && L.meters && L.meters.forming) || 0)),
      U.kv('LIVE', String((L && L.meters && L.meters.live) || 0)),
      U.kv('RAIDS LIVE', String((L && L.meters && L.meters.raidsLive) || 0), (L && L.meters && L.meters.raidsLive) > 0),
      U.kv('BATTLES LIVE', String((L && L.meters && L.meters.battlesLive) || 0), (L && L.meters && L.meters.battlesLive) > 0),
      U.kv('CONVOYS', String((L && L.meters && L.meters.convoys) || 0)),
      U.kv('STATE HASH', el('span', { style: 'font-size:9px;color:var(--dim)', text: (L && L.stateHash || R.stateHash || '').slice(0, 16) })),
    ])));
    main.appendChild(side);
    stack.appendChild(main);

    // ★ THE STATE KEY, permanent, as in the mock. Without it a stranger meets
    // LIVE / PAID / UNUSED / DRAWN / RED with nothing on screen defining any of
    // them — and `RED` is a state NAME as well as the alarm colour, which is
    // exactly the collision a key exists to resolve. It costs 26 px.
    stack.appendChild(el('div', { class: 'panel', style: 'flex:0 0 auto' },
      el('div', { class: 'states' }, [
        ['LIVE', 'var(--cyan)'], ['FORMING', 'var(--cyan-deep)'], ['SETTLED', 'var(--cyan-mid)'],
        ['IN TRANSIT', 'var(--cyan-deep)'], ['EXTRACTING', 'var(--cyan-mid)'],
        ['DRAWN', 'var(--cyan)'], ['UNUSED', 'var(--dim)'],
        ['DEMANDED', 'var(--amber)'], ['ARREARS', 'var(--amber)'], ['PAID', 'var(--amber)'],
        ['FORECAST', 'var(--amber)'],
        ['SNAPPED', 'var(--red)'], ['LAPSED', 'var(--red)'], ['RED · unpaid at the freeze', 'var(--red)'],
      ].map(function (t) {
        return el('span', null, [el('i', { style: 'background:' + t[1] }), t[0]]);
      }))));

    stack.appendChild(panel('THE RECORD', {
      sub: 'the export surface · 140 chars, bounded',
      right: 'tick ' + (L ? L.tick : R.tick),
    },
      (D.ticker.length ? el('div', { class: 'log' }, D.ticker.slice(0, 60).map(function (t, i) {
        // RED ONLY FOR A BROKEN WORD. `raid` was in this regex and 7 of 10
        // lines came out red without one of them being a default — including
        // "p:brannock paid 5252 and the raid left", which is a promise KEPT.
        var broke = /\bdefault|failed to|walked away|contradicted|snapped|lapsed\b/i.test(t);
        var risk = /\braid|demand|arrears|short\b/i.test(t);
        return el('div', { class: 'ln' + (broke ? ' bad' : risk ? ' warn' : '') }, [
          el('span', { class: 'tk', text: String(i + 1).padStart(2, '0') }),
          el('span', { class: 'de', text: t }),
        ]);
      })) : empty('the record is quiet', 'The ticker is empty on both frames.'))
    , { style: 'flex:0 0 168px' }));
    U.clear(host).appendChild(stack);
  }

  // ═════════════════════════════════════════════════════════ PRINCIPALS ══
  function principals(host, D, sel) {
    var R = D.R, list = (R.standings || []).slice();
    if (!list.length) {
      var w = el('div', { class: 'grid', style: 'grid-template-columns:214px 1fr;height:100%' });
      w.appendChild(panel('PRINCIPALS', { sub: 'awaiting the first Reckoning' }, U.skeleton(10, 2),
        { foot: 'the public record is written at settlement' }));
      var d = el('div', { class: 'rows', style: 'min-height:0' });
      d.appendChild(panel('THE DOSSIER', { sub: 'a principal\u2019s whole public record' },
        el('div', null, [
          el('div', { class: 'tiles', style: 'padding:8px' },
            ['ELECTIVE HONOURED', 'VALUE HONOURED', 'DEFAULTS', 'CONTRADICTED SEALS',
             'COUNTERPARTIES', 'LAST DEFAULT'].map(function (t) {
              return tile(t, '—', { dim: true });
            })),
          U.skeleton(9, 4),
        ]), { foot: 'everything on this page is written at settlement' }));
      w.appendChild(d);
      U.clear(host).appendChild(w);
      return;
    }
    // ★ CLEAN FIRST. Sorting purely by value honoured buried every spotless
    // record among the big defaulters, so the roster answered "who is busy"
    // when the question this product exists for is "who keeps their word".
    list.sort(function (a, b) {
      if ((a.defaults > 0) !== (b.defaults > 0)) return a.defaults - b.defaults;
      return b.electiveHonouredValue - a.electiveHonouredValue;
    });
    var cur = list.filter(function (r) { return U.handleOf(r.principal) === sel; })[0] || list[0];

    var wrap = el('div', { class: 'grid', style: 'grid-template-columns:196px 1fr;height:100%' });
    var lst = panel('PRINCIPALS', { sub: list.length + ' \u00b7 clean first' },
      el('div', null, list.map(function (r) {
        var on = r.principal === cur.principal;
        return el('div', {
          style: 'display:flex;align-items:center;gap:8px;padding:5px 8px;cursor:pointer;' +
            'border-bottom:1px solid var(--rule-dim);' + (on ? 'background:var(--cyan-wash-2)' : ''),
          on: { click: function () { location.hash = '#/principals/' + U.handleOf(r.principal); } },
        }, [
          U.crest(r.principal, 22),
          el('div', { style: 'min-width:0;flex:1' }, [
            el('div', { style: 'color:var(--text);font-size:12px', text: r.handle }),
            el('div', {
              style: 'font-size:10px;color:var(--dim);white-space:nowrap',
              title: r.electiveHonoured + ' elective promises kept across ' +
                r.distinctCounterparties + ' counterparties',
              text: r.electiveHonoured + ' kept · ' + r.distinctCounterparties + ' cp',
            }),
          ]),
          // graded, like the mock's own standings legend: 1 amber · 2 mid · 3+ red
          r.defaults
            ? el('span', { class: 'tag ' + (r.defaults >= 3 ? 'rd' : r.defaults === 2 ? 'rd2' : 'am'), title: r.defaults + ' defaults on the record', text: String(r.defaults) })
            : el('span', { class: 'tag solid', title: 'never broken a promise', text: 'CLEAN' }),
        ]);
      })));
    wrap.appendChild(lst);
    wrap.appendChild(dossier(D, cur));
    U.clear(host).appendChild(wrap);
  }

  /**
   * The dossier at E6 scale — the owner's chosen pair are the SAME SCREEN at two
   * zoom levels, so this is the E1 table density with one broadcast-scale
   * banner and one row of oversized numerals at the top.
   */
  function dossier(D, r) {
    var R = D.R, pid = r.principal, bad = r.defaults > 0;
    var stack = el('div', { class: 'rows', style: 'min-height:0;overflow:auto' });

    stack.appendChild(el('section', { class: 'panel' }, el('div', { class: 'body' }, [
      el('div', { style: 'display:flex;align-items:center;gap:16px;padding:12px 14px 10px' }, [
        U.crest(pid, 'lg'),
        el('div', null, [
          el('div', {
            // 68px, not 44. Measured against the mock at the same effective width
            // the whole hero stack was running 18-28% small, and E6 is the POSTER
            // half of the pair -- the size IS the design.
            style: 'font:400 68px/1 var(--mono);letter-spacing:-.03em;color:' + (bad ? 'var(--red-text)' : 'var(--text)'),
            text: r.handle,
          }),
          el('div', { style: 'font-size:10px;color:var(--dim);margin-top:6px' }, r.handle + '@agenttransfer.dev'),
        ]),
        el('div', { style: 'margin-left:auto;text-align:right' }, [
          el('div', { style: 'font:9px var(--cond);letter-spacing:.16em;color:var(--dimmer)', text: 'PRINCIPAL' }),
          el('div', { style: 'font-size:10px;color:var(--dim)', text: pid }),
        ]),
      ]),
      // ★ THE BANNER. The three-second question, answered in one line.
      el('div', { class: 'banner ' + (bad ? 'bad' : 'good') }, [
        bad ? 'BROKEN ' + r.defaults : 'NEVER BROKEN A PROMISE',
        el('span', { class: 'clause' },
          bad
            ? (r.defaults === 1 ? 'one default' : r.defaults + ' defaults') + ' on the record' +
              (r.lastDefaultTick ? ', the last at tick ' + r.lastDefaultTick : '')
            : r.electiveHonoured + ' elective halves honoured and not one default'),
      ]),
      el('div', { class: 'tiles', style: 'padding:8px' }, [
        tile('ELECTIVE HONOURED', U.n(r.electiveHonoured)),
        tile('VALUE HONOURED', U.n(r.electiveHonouredValue)),
        tile('DEFAULTS', U.n(r.defaults), { bad: bad }),
        tile('CONTRADICTED SEALS', U.n(r.contradictedSeals), { bad: r.contradictedSeals > 0 }),
        tile('COUNTERPARTIES', U.n(r.distinctCounterparties)),
        tile('LAST DEFAULT', r.lastDefaultTick ? 'tick ' + r.lastDefaultTick : 'none',
          { sm: true, bad: bad, dim: !bad }),
      ]),
    ])));

    var g2 = el('div', { class: 'grid g-2' });

    // holdings + places named for them
    var places = (R.places || []).filter(function (p) { return p.namedFor === pid; });
    var works = (R.worksLines || []).filter(function (w) { return w.holder === pid; });
    var claims = (R.claimLines || []).filter(function (c) { return c.claimant === pid; });
    var sway = (R.swayLines || []).filter(function (s) { return s.principal === pid; });
    var hold = [];
    works.forEach(function (w) { hold.push({ k: 'WORKS', at: w.system, d: w.legend + ' · ' + w.yieldPerTick + '/tick', bad: false }); });
    claims.forEach(function (c) { hold.push({ k: 'CLAIM', at: c.system, d: c.legend || c.state, bad: c.arrears > 0 }); });
    sway.forEach(function (s) { hold.push({ k: 'SWAY', at: s.system, d: 'sway ' + s.sway + (s.gate ? ' · strait gate' : ''), bad: false }); });
    places.forEach(function (p) { hold.push({ k: 'PLACE', at: p.system, d: 'named for ' + p.handle + ' since t' + p.sinceTick, bad: false }); });
    g2.appendChild(panel('HOLDINGS', { sub: hold.length + ' rows on this frame' },
      hold.length ? table('dos-h', [
        { k: 'k', t: 'kind', w: '68px', cell: function (x) { return U.tag(x.k, x.bad ? 'rd' : 'cy'); } },
        { k: 'at', t: 'at', w: '130px', cell: function (x) { return U.sysLink(x.at, x.at + ' ' + sysName(D, x.at)); } },
        { k: 'd', t: 'detail' },
      ], hold, { rerender: D.rerender, rowClass: function (x) { return x.bad ? 'bad' : ''; } })
        : empty('holds nothing on this frame',
          'A principal with no WORKS, CLAIM or sway row this Reckoning holds no ground the frame reports.')));

    // ventures they are party to
    var mine = (D.links || []).filter(function (c) { return c.a === pid || c.b === pid; });
    g2.appendChild(panel('VENTURES', { sub: mine.length + ' with this principal as a party' },
      mine.length ? table('dos-v', [
        { k: 'glyph', t: '', w: '30px', cell: function (c) { return U.glyph(D.glyphIndex[c.venture] || { electiveBps: c.electiveBps, state: c.snapped ? 'SNAPPED_BLACK' : 'LIVE' }, 20); } },
        { k: 'kind', t: 'kind', w: '66px' },
        { k: 'state', t: 'state', w: '92px', cell: function (c) { return U.tag(c.state, c.snapped ? 'rd' : 'cy'); } },
        { k: 'other', t: 'counterparty', cell: function (c) { var o = c.a === pid ? c.b : c.a; return o ? hOf(D, o) : el('span', { class: 'dim', text: 'unfilled' }); } },
        { k: 'electiveBps', t: 'elective', w: '68px', num: true, cell: function (c) { return U.bps(c.electiveBps); } },
        { k: 'atStake', t: 'at stake', w: '80px', num: true, cell: function (c) { return U.n(c.atStake); } },
      ], mine, { sort: 'atStake', dir: -1, rerender: D.rerender, rowClass: function (c) { return c.snapped ? 'bad' : ''; } })
        : empty('no venture on this frame names them',
          'The frame caps <code>compactLinks[]</code> for broadcast, so a quiet principal simply does not appear. ' +
          'This is <b>not</b> the same as "has never dealt".')));
    stack.appendChild(g2);

    // ★ COUNTERPARTIES and VALUE FLOW — two of the mock's blocks, both
    // derivable from `compactLinks[]` alone. The dossier used to end here with
    // half a page of nothing under it.
    var g3 = el('div', { class: 'grid g-2' });
    var cps = {};
    mine.forEach(function (c) {
      var o = c.a === pid ? c.b : c.a; if (!o) return;
      var e = cps[o] || (cps[o] = { p: o, n: 0, stake: 0, snapped: 0 });
      e.n++; e.stake += c.atStake || 0; if (c.snapped) e.snapped++;
    });
    var cpl = Object.keys(cps).map(function (k2) { return cps[k2]; });
    g3.appendChild(panel('COUNTERPARTIES', {
      sub: r.distinctCounterparties + ' distinct over the whole record · ' + cpl.length + ' on this frame',
    }, cpl.length ? table('dos-c', [
      { k: 'p', t: 'handle', w: '108px', cell: function (x) { return el('span', { style: 'display:inline-flex;align-items:center;gap:7px' }, [U.crest(x.p, 15), hOf(D, x.p)]); }, sort: function (x) { return U.handleOf(x.p); } },
      { k: 'n', t: 'compacts', w: '74px', num: true },
      { k: 'stake', t: 'at stake', w: '86px', num: true, cell: function (x) { return U.n(x.stake); } },
      { k: 'standing', t: 'their record', cell: function (x) {
        var o = D.byPrincipal[x.p];
        return o ? el('span', { class: 'dim', text: o.electiveHonoured + ' kept · ' + o.defaults + ' broken' }) : U.nul();
      }, sort: function (x) { return (D.byPrincipal[x.p] || {}).defaults || 0; } },
    ], cpl, { sort: 'stake', dir: -1, rerender: D.rerender, rowClass: function (x) { return x.snapped ? 'bad' : ''; } })
      : empty('no counterparty on this frame · 8 over the whole record'.replace('8', String(r.distinctCounterparties)),
        'The frame caps compactLinks[] for broadcast, so a principal who was quiet this Reckoning ' +
        'simply does not appear. That is not the same as having never dealt.')));

    var vin = 0, vout = 0, nin = 0, nout = 0;
    mine.forEach(function (c) {
      if (c.a === pid) { vout += c.atStake || 0; nout++; } else { vin += c.atStake || 0; nin++; }
    });
    var onWord = mine.reduce(function (a, c) { return a + (c.atStake || 0) * (c.electiveBps || 0) / 10000; }, 0);
    g3.appendChild(panel('VALUE FLOW', { sub: 'across the compacts on this frame' }, el('div', null, [
      el('div', { class: 'meter' }, [el('span', { class: 'nm', text: 'OUT' }), U.bar(vout / Math.max(1, vin + vout)), el('span', { class: 'qt', text: U.n(vout) })]),
      el('div', { class: 'meter' }, [el('span', { class: 'nm', text: 'IN' }), U.bar(vin / Math.max(1, vin + vout)), el('span', { class: 'qt', text: U.n(vin) })]),
      U.kv('COMPACTS INITIATED', String(nout)),
      U.kv('COMPACTS JOINED', String(nin)),
      U.kv('NET', (vin - vout >= 0 ? '+' : '') + U.n(vin - vout)),
      U.kv('RIDING ON A WORD', U.n(Math.round(onWord))),
      U.kv('VALUE HONOURED, ALL TIME', U.n(r.electiveHonouredValue)),
      mine.length ? null : el('div', { class: 'note-line' },
        'Every flow above is zero because no compact on tonight\u2019s frame names ' + r.handle +
        '. The all-time figure is the record; the rest is this Reckoning only.'),
    ])));
    stack.appendChild(g3);

    // AUTHORITY, on the page of the principal it belongs to. A6 is the core
    // loop, and `quill` appeared as a delegate holding MAX DIRECT LOSS 27,242
    // on the GRANTS screen and nowhere at all on quill's own page.
    var held = (D.authority || []).filter(function (a) { return a.delegate === pid; });
    var issued = (D.authority || []).filter(function (a) { return a.grantor === pid; });
    var auth = held.concat(issued);
    stack.appendChild(panel('AUTHORITY', {
      sub: issued.length + ' handed out - ' + held.length + ' held',
      foot: 'The worst case was shown before it was signed: a grant serialises as a signed credential.',
    }, auth.length ? table('dos-a', [
      { k: 'side', t: 'side', w: '80px', cell: function (a) { return U.tag(a.grantor === pid ? 'ISSUED' : 'HELD', a.grantor === pid ? 'cy' : 'solid'); }, sort: function (a) { return a.grantor === pid ? 1 : 0; } },
      { k: 'other', t: 'counterparty', w: '108px', cell: function (a) { return hOf(D, a.grantor === pid ? a.delegate : a.grantor); }, sort: function (a) { return U.handleOf(a.grantor === pid ? a.delegate : a.grantor); } },
      { k: 'grant', t: 'grant', w: '116px', cell: function (a) { return el('span', { class: 'dim', text: a.grant }); } },
      { k: 'granted', t: 'max direct loss', w: '112px', num: true, cell: function (a) { return U.n(a.granted); } },
      { k: 'grantedContingent', t: 'max contingent', w: '112px', num: true, cell: function (a) { return U.n(a.grantedContingent); } },
      { k: 'spent', t: 'drawn', w: '68px', num: true, cell: function (a) { return a.spent ? U.n(a.spent) : el('span', { class: 'dim', text: '0' }); } },
      { k: 'clearance', t: 'clearance', w: '74px', cell: function (a) { return U.pips(a.clearance); } },
      { k: 'state', t: 'state', cell: function (a) { return U.tag(a.state, a.state === 'DRAWN' ? 'solid' : a.state === 'REVOKED' ? 'am' : 'cy'); } },
    ], auth, { sort: 'granted', dir: -1, rerender: D.rerender })
      : empty('no authority on tonight\u2019s frame names them',
        'authorityLines[] is capped at 12 for broadcast and sorted by size, so a small or an expired ' +
        'grant does not appear. Authority is drawn on far more often than a nightly frame can show.')));

    // the rundown beats about them
    var beats = (R.rundown || []).filter(function (s) {
      return (s.cast || []).some(function (c) { return c.principal === pid; }) ||
        (s.deed || '').indexOf(r.handle) >= 0;
    });
    stack.appendChild(panel('THE RECORD · this Reckoning', { sub: beats.length + ' beats name them', alarm: bad },
      beats.length ? el('div', { class: 'log' }, beats.map(function (s) {
        return el('div', { class: 'ln' + (s.defaulted ? ' bad' : '') }, [
          el('span', { class: 'tk', text: '#' + s.order }),
          el('span', { class: 'ty', text: s.kind }),
          el('span', { class: 'de', text: s.deed }),
        ]);
      })) : empty('nothing this Reckoning',
        'No rundown segment names this principal. The rundown is capped at 12 segments, largest say-do delta last.')));

    // The honest caveat, as one dim line with the argument on hover. It used to
    // be a four-line paragraph occupying the slot where the mock puts HANDS,
    // STORES, COUNTERPARTIES and VALUE FLOW — the page apologised for its data
    // in the space the data belongs in.
    stack.appendChild(el('div', { class: 'note-line', title:
      'There is no principal-scoped read. Every frame key is a world-scoped array capped for ' +
      'broadcast (7 docket cards, 12 authority lines, 12 rundown segments), so this page shows ' +
      'the rows that happened to be selected for tonight\u2019s frame, not a character sheet. ' +
      'Hands and their states, STORES balances and syndicate membership have no frame field at all.',
    }, 'The frame carries no hand roster, no STORES balance and no syndicate membership — hover for why.'));
    return stack;
  }

  // ═══════════════════════════════════════════════════════════ VENTURES ══
  function ventures(host, D) {
    var links = D.links, glyphs = D.glyphs, R = D.R;
    var stack = el('div', { class: 'rows fill', style: 'height:100%' });
    var byState = {};
    glyphs.forEach(function (g) { byState[g.state] = (byState[g.state] || 0) + 1; });

    stack.appendChild(el('div', { class: 'tiles' }, [
      tile('FORMING', String(byState.FORMING || 0), { note: 'a role is still an empty socket' }),
      tile('LIVE', String(byState.LIVE || 0), { note: 'both roles filled, running' }),
      tile('CLOSED', String(byState.CLOSED_GOLD || 0), { note: 'the elective half was paid' }),
      tile('SNAPPED', String(byState.SNAPPED_BLACK || 0), { bad: (byState.SNAPPED_BLACK || 0) > 0, note: 'the word was broken' }),
      tile('ON A WORD, ON SCREEN', U.n(links.reduce(function (a, c) { return a + (c.atStake || 0) * (c.electiveBps || 0) / 10000; }, 0)),
        { note: 'elective halves of the compacts listed here' }),
    ]));

    var g2 = el('div', { class: 'grid', style: 'grid-template-columns:1fr 392px;flex:1 1 auto;min-height:0' });
    g2.appendChild(panel('COMPACTS', {
      sub: links.length + ' links · ★ THE COMPACT LINK joins two holdings and snaps when the word breaks',
    }, links.length ? table('vt', [
      { k: 'g', t: '', w: '34px', cell: function (c) { return U.glyph(D.glyphIndex[c.venture] || { electiveBps: c.electiveBps, state: c.snapped ? 'SNAPPED_BLACK' : c.state }, 22); } },
      { k: 'kind', t: 'kind', w: '66px', cell: function (c) { return el('span', { class: 'k', text: c.kind }); } },
      { k: 'venture', t: 'venture', w: '124px', cell: function (c) { return el('span', { class: 'dim', text: c.venture }); } },
      { k: 'a', t: 'party a', w: '96px', cell: function (c) { return hOf(D, c.a); } },
      { k: 'aAt', t: 'at', w: '58px', cell: function (c) { return U.sysLink(c.aAt); } },
      { k: 'b', t: 'party b', w: '96px', cell: function (c) { return c.b ? hOf(D, c.b) : el('span', { class: 'dim', text: '— unfilled' }); } },
      { k: 'bAt', t: 'at', w: '58px', cell: function (c) { return c.bAt ? U.sysLink(c.bAt) : '—'; } },
      { k: 'state', t: 'state', w: '96px', cell: function (c) { return U.tag(c.state, c.snapped ? 'rd' : 'cy'); } },
      { k: 'electiveBps', t: 'elective', w: '68px', num: true, cell: function (c) { return U.bps(c.electiveBps); } },
      { k: 'atStake', t: 'at stake', w: '82px', num: true, cell: function (c) { return U.n(c.atStake); } },
      { k: 'grant', t: 'grant', w: '92px', cell: function (c) { return c.grant ? el('span', { class: 'dim', text: c.grant }) : el('span', { class: 'dim', text: '—' }); } },
    ], links, { sort: 'atStake', dir: -1, rerender: D.rerender, rowClass: function (c) { return c.snapped ? 'bad' : ''; } })
      : empty('no compact is live',
        '<code>compactLinks[]</code> is empty on both frames. A compact appears the moment a venture is created ' +
        'and stays until it settles.')));

    // the glyph wall — A13's ring, at a size a viewer can actually read
    var wall = el('div', { style: 'display:flex;flex-wrap:wrap;gap:9px;padding:9px' },
      glyphs.length ? glyphs.map(function (g) {
        return el('div', {
          style: 'width:60px;text-align:center', title: g.venture,
        }, [
          U.glyph(g, 44),
          el('div', { style: 'font-size:9px;color:var(--dim);margin-top:3px', text: U.bps(g.electiveBps) }),
          el('div', {
            style: 'font-size:8px;color:' + (g.state === 'SNAPPED_BLACK' ? 'var(--red-text)' : 'var(--dimmer)'),
            text: g.state.replace('_GOLD', '').replace('_BLACK', ''),
          }),
        ]);
      }) : empty('no rings to draw', 'Neither frame carries a <code>glyphs[]</code> row.'));
    var right = el('div', { class: 'rows', style: 'min-height:0' });
    right.appendChild(panel('★ THE VENTURE RING', {
      sub: 'the hollow arc rides on a word',
      foot: 'deep arc = escrowed, auto-executes · bright arc = elective, can simply not be paid',
    }, wall, { style: 'flex:0 1 auto' }));

    // ★ THE STANDOFFS. `raidLines` and `battleLines` were on the frame and on
    // no screen but the OVERVIEW table. A raid with a countdown is the most
    // legible thing the live frame carries, and the ventures rail was spending
    // its height redrawing the ten rows of the table beside it.
    var rl = (D.L && D.L.raidLines || R.raidLines || []).slice();
    right.appendChild(panel('STANDOFFS', {
      sub: rl.length + ' raids · ' + ((R.battleLines || []).length) + ' battles',
    }, rl.length ? table('vt-r', [
      { k: 'stage', t: 'at', w: '108px', cell: function (x) { return U.sysLink(x.stage, sysName(D, x.stage)); } },
      { k: 'target', t: 'target', w: '84px', cell: function (x) { return hOf(D, x.target); } },
      { k: 'demand', t: 'demand', w: '74px', num: true, cell: function (x) { return U.n(x.demand); } },
      { k: 'lost', t: 'taken', w: '68px', num: true, cell: function (x) { return x.lost ? el('span', { style: 'color:var(--amber)', text: U.n(x.lost) }) : el('span', { class: 'dim', text: '0' }); } },
      { k: 'defenders', t: 'rode out', w: '76px', cell: function (x) { return (x.defenders || []).length ? String(x.defenders.length) : el('span', { class: 'dim', text: 'nobody' }); }, sort: function (x) { return (x.defenders || []).length; } },
      { k: 'state', t: 'state', cell: function (x) { return U.tag(x.state, x.state === 'REPULSED' ? 'cy' : 'am'); } },
    ], rl, { sort: 'demand', dir: -1, rerender: D.rerender })
      : empty('nobody is demanding anything', 'No raid is live and none settled this Reckoning.'),
    { style: 'flex:1 1 auto;min-height:0' }));
    g2.appendChild(right);
    stack.appendChild(g2);

    var docket = R.docket || [];
    // ★ THE SHAPE OF THE NIGHT. `dense-ventures` was 65% blank body rows; these
    // three are all counts over `compactLinks[]`, which is already on screen.
    var bot = el('div', { class: 'grid g-3', style: 'flex:0 0 178px' });
    var byKind = {};
    links.forEach(function (c) {
      var e = byKind[c.kind] || (byKind[c.kind] = { kind: c.kind, n: 0, stake: 0, snapped: 0, elective: 0 });
      e.n++; e.stake += c.atStake || 0; e.elective += c.electiveBps || 0;
      if (c.snapped) e.snapped++;
    });
    var kl = Object.keys(byKind).map(function (k2) { return byKind[k2]; });
    bot.appendChild(panel('BY KIND', { sub: kl.length + ' kinds of compact live' },
      kl.length ? table('vt-k', [
        { k: 'kind', t: 'kind', w: '78px', cell: function (x) { return el('span', { class: 'k', text: x.kind }); } },
        { k: 'n', t: 'count', w: '54px', num: true },
        { k: 'stake', t: 'at stake', w: '82px', num: true, cell: function (x) { return U.n(x.stake); } },
        { k: 'elective', t: 'mean elective', w: '96px', num: true, cell: function (x) { return U.bps(Math.round(x.elective / x.n)); }, sort: function (x) { return x.elective / x.n; } },
        { k: 'snapped', t: 'snapped', w: '72px', num: true, cell: function (x) { return x.snapped ? el('span', { style: 'color:var(--red-text)', text: String(x.snapped) }) : el('span', { class: 'dim', text: '0' }); } },
      ], kl, { sort: 'stake', dir: -1, rerender: D.rerender })
        : empty('no compact is live', 'compactLinks[] is empty on both frames.')));

    // the elective spread — how much of the world is riding on a word rather
    // than on escrow, drawn as a histogram because one mean hides the shape
    var buckets = [0, 0, 0, 0, 0];
    links.forEach(function (c) {
      var b = Math.min(4, Math.floor((c.electiveBps || 0) / 2000));
      buckets[b]++;
    });
    var maxB = Math.max(1, Math.max.apply(null, buckets));
    bot.appendChild(panel('ELECTIVE SPREAD', {
      sub: 'how much of a compact rides on a word',
      foot: 'A7: full escrow deletes the betrayal · zero escrow enables fake counterparties.',
    }, el('div', { style: 'padding:6px 0' }, buckets.map(function (n2, i) {
      return el('div', { class: 'meter' }, [
        el('span', { class: 'nm', text: (i * 20) + '–' + ((i + 1) * 20) + '%' }),
        U.bar(n2 / maxB),
        el('span', { class: 'qt', text: String(n2) }),
      ]);
    }))));

    bot.appendChild(panel('THE DOCKET', { sub: 'tonight\'s cards, stakes descending · cap 7' },
      docket.length ? el('div', { style: 'display:flex;gap:6px;padding:6px;overflow:auto' }, docket.map(function (c) {
        return el('div', { style: 'flex:0 0 236px;border:1px solid var(--rule);background:var(--panel-2);padding:8px' }, [
          el('div', { style: 'display:flex;gap:8px;align-items:flex-start' }, [
            U.glyph({ electiveBps: c.electiveBps, state: 'LIVE', rolesFilled: 2, rolesTotal: 2 }, 30),
            el('div', { style: 'min-width:0' }, [
              el('div', { style: 'color:var(--text);font-size:12px', text: c.headline }),
              el('div', { style: 'font-size:10px;color:var(--dim);margin-top:3px', text: c.tension }),
            ]),
          ]),
          el('div', { style: 'display:flex;gap:5px;margin-top:7px;align-items:center' },
            (c.cast || []).map(function (p) { return U.crest(p.principal, 22); }).concat([
              el('div', { style: 'margin-left:auto;font:400 15px var(--mono);color:var(--cyan)', text: U.n(c.atStake) }),
            ])),
        ]);
      })) : empty('the docket is empty',
        'The docket is built from ventures still LIVE at the settlement tick, and almost everything has already ' +
        'The docket is built from ventures still LIVE at the settlement tick, and almost everything has ' +
        'already settled by then. Measured at 2 cards across 9 frames against a budget of 7.')));
    stack.appendChild(bot);
    U.clear(host).appendChild(stack);
  }

  // ═════════════════════════════════════════════════════════════ GRANTS ══
  function grants(host, D) {
    var lines = D.authority;
    var stack = el('div', { class: 'rows fill', style: 'height:100%' });
    var drawn = lines.filter(function (a) { return a.state === 'DRAWN' || a.spent > 0 || a.spentContingent > 0; });
    stack.appendChild(el('div', { class: 'tiles' }, [
      tile('GRANTS ON FRAME', String(lines.length), { note: 'cap 12 · the biggest, not all' }),
      tile('DRAWN ON', String(drawn.length), { note: 'acted in a grantor\u2019s name' }),
      tile('MAX DIRECT LOSS', U.n(lines.reduce(function (a, x) { return Math.max(a, x.granted || 0); }, 0)),
        { note: 'the largest single LIMIT on screen' }),
      tile('MAX CONTINGENT', U.n(lines.reduce(function (a, x) { return Math.max(a, x.grantedContingent || 0); }, 0)),
        { note: 'the worst case, shown before it was signed' }),
      tile('DOSSIER THREADS', String(lines.reduce(function (a, x) { return a + (x.dossiers || []).length; }, 0)),
        { note: 'authority handed downstream' }),
    ]));

    // ★ THE PROVABLE WARNING — the single line the mock series called the best
    // thing in it. A grant serialises as a signed W3C credential, so "the worst
    // case was shown before it was signed" is provable rather than asserted,
    // and that sentence IS A6. The build had no equivalent anywhere.
    // ★ THE DRAWN ONE FIRST. Sorting by size featured the biggest UNUSED grant
    // and hid the single grant anybody had actually acted under — on the screen
    // whose whole subject is authority being used.
    var big = lines.slice().sort(function (a, b) {
      var da = (a.spent || 0) + (a.spentContingent || 0), db = (b.spent || 0) + (b.spentContingent || 0);
      if ((da > 0) !== (db > 0)) return db - da;
      return (b.granted + b.grantedContingent) - (a.granted + a.grantedContingent);
    })[0];
    if (big) {
      stack.appendChild(el('div', { class: 'warncall' }, [
        el('div', { class: 'l1' }, [
          el('span', { class: 'gid', text: big.grant }), ' · ',
          hOf(D, big.grantor), el('span', { class: 'arrow', text: ' ⟶ ' }), hOf(D, big.delegate),
          ' · MAX DIRECT LOSS ', el('b', { text: U.n(big.granted) }),
          ' · MAX CONTINGENT ', el('b', { text: U.n(big.grantedContingent) }),
          (big.spent || big.spentContingent)
            ? el('span', null, [' · DRAWN ', el('b', { text: U.n((big.spent || 0) + (big.spentContingent || 0)) })])
            : null,
          ' · ', el('span', { class: 'st', text: big.state }),
          el('span', { class: 'tail', text: 'the worst case, shown before it was signed' }),
        ]),
        el('div', { class: 'l2', text: 'a grant serialises as a signed credential, so this warning is provable rather than asserted' }),
      ]));
    }

    var g2 = el('div', { class: 'grid', style: 'grid-template-columns:1fr 1fr;flex:1 1 auto;min-height:0' });
    var cols = [
      { k: 'grant', t: 'grant', w: '112px', cell: function (a) { return el('span', { class: 'dim', text: a.grant }); } },
      { k: 'grantor', t: 'grantor', w: '90px', cell: function (a) { return hOf(D, a.grantor); } },
      { k: 'delegate', t: 'delegate', w: '90px', cell: function (a) { return hOf(D, a.delegate); } },
      { k: 'granted', t: 'direct', w: '78px', num: true, cell: function (a) { return U.n(a.granted); } },
      { k: 'grantedContingent', t: 'contingent', w: '84px', num: true, cell: function (a) { return U.n(a.grantedContingent); } },
      {
        // ★ DRAWN, not SPENT. The one grant exercised on this whole frame drew
        // on its CONTINGENT limit (`spentContingent: 2400`) and nothing at all
        // on its direct one, and the cell read `a.spent` — so the A6 screen
        // printed 0 against the only occurrence of A6 in the world.
        k: 'drawn', t: 'drawn', w: '74px', num: true,
        cell: function (a) {
          var d = (a.spent || 0) + (a.spentContingent || 0);
          return d
            ? el('span', { style: 'color:var(--cyan)', title: 'direct ' + U.n(a.spent) + ' · contingent ' + U.n(a.spentContingent), text: U.n(d) })
            : el('span', { class: 'dim', text: '0' });
        },
        sort: function (a) { return (a.spent || 0) + (a.spentContingent || 0); },
      },
      { k: 'clearance', t: 'clr', w: '46px', cell: function (a) { return U.pips(a.clearance); } },
      { k: 'state', t: 'state', w: '78px', cell: function (a) { return U.tag(a.state, a.state === 'DRAWN' ? 'solid' : a.state === 'REVOKED' ? 'am' : 'cy'); } },
    ];
    g2.appendChild(panel('★ THE AUTHORITY LINE', {
      sub: 'A6, the core loop — authority a grantor handed out, and the LIMITS it was shown',
      foot: 'CLEARANCE PIPS: filled = the delegate can read that compartment. Left STORES · right HANDS.',
    }, lines.length ? table('gr', cols, lines, {
      sort: 'granted', dir: -1, rerender: D.rerender,
      rowClass: function (a) { return a.state === 'REVOKED' ? 'bad' : ''; },
    }) : empty('no grant is live',
      '<code>authorityLines[]</code> is empty on both frames. A6 — betrayal through legitimate authority — ' +
      'is the core loop, and this panel is where it becomes visible.')));

    g2.appendChild(panel('WHO CAN ACT FOR WHOM', {
      sub: 'grantor → delegate · line weight is the worst case',
    }, lines.length ? authorityGraph(D, lines)
      : empty('nothing to draw', 'No authority line on either frame.')));
    stack.appendChild(g2);

    var threads = [];
    lines.forEach(function (a) {
      (a.dossiers || []).forEach(function (d) {
        threads.push({ grant: a.grant, from: a.delegate, to: d.to, compartment: d.compartment, cutAtTick: d.cutAtTick, copied: d.copied });
      });
    });
    // The mock's bottom strip: four small tallies that turn a table into a
    // dashboard. Every one of them is a count over `authorityLines[]`.
    var strip = el('div', { class: 'grid g-4', style: 'flex:0 0 168px' });
    var tally = {};
    lines.forEach(function (a) { tally[a.state] = (tally[a.state] || 0) + 1; });
    strip.appendChild(panel('STATE TALLY', null, el('div', null,
      ['UNUSED', 'DRAWN', 'EXHAUSTED', 'REVOKED', 'EXPIRED'].map(function (st) {
        return U.kv(st, String(tally[st] || 0), st === 'REVOKED' && tally[st]);
      }))));
    var clr = { 'act-only': 0, STORES: 0, HANDS: 0, both: 0 };
    lines.forEach(function (a) {
      var c = a.clearance || [];
      if (!c.length) clr['act-only']++;
      else if (c.length > 1) clr.both++;
      else clr[c[0]] = (clr[c[0]] || 0) + 1;
    });
    strip.appendChild(panel('CLEARANCE BREAKDOWN', { sub: 'what a delegate may read' }, el('div', null, [
      U.kv('ACT ONLY', String(clr['act-only'])),
      U.kv('STORES', String(clr.STORES)),
      U.kv('HANDS', String(clr.HANDS)),
      U.kv('BOTH', String(clr.both)),
    ])));
    var byDel = {};
    lines.forEach(function (a) { byDel[a.delegate] = Math.max(byDel[a.delegate] || 0, a.granted); });
    var top = Object.keys(byDel).map(function (p) { return { p: p, v: byDel[p] }; })
      .sort(function (a, b) { return b.v - a.v; }).slice(0, 5);
    strip.appendChild(panel('TOP DIRECT EXPOSURE', { sub: 'the most a delegate could lose you' },
      top.length ? el('div', null, top.map(function (t) {
        return el('div', { style: 'display:flex;align-items:center;gap:8px;padding:3px 8px' }, [
          el('span', { style: 'flex:0 0 82px' }, hOf(D, t.p)),
          U.bar(t.v / (top[0].v || 1)),
          el('span', { style: 'flex:0 0 62px;text-align:right;font-variant-numeric:tabular-nums', text: U.n(t.v) }),
        ]);
      })) : empty('no delegate', 'No grant on frame.')));
    strip.appendChild(panel('★ THE DOSSIER THREADS', {
      sub: 'authority handed on',
    }, threads.length ? table('gd', [
      { k: 'from', t: 'delegate', cell: function (t) { return hOf(D, t.from); } },
      { k: 'to', t: 'handed to', cell: function (t) { return hOf(D, t.to); } },
      { k: 'compartment', t: 'compartment', w: '96px', cell: function (t) { return U.tag(t.compartment, 'cy'); } },
      { k: 'cutAtTick', t: 'cut at', w: '68px', num: true },
      { k: 'copied', t: 'copy', w: '56px', cell: function (t) { return t.copied ? U.tag('EXISTS', 'am') : '—'; } },
    ], threads, { rerender: D.rerender })
      : empty('no dossier handed on',
        'Measured at <b>0 threads in every frame of every world</b> — the <code>dossierBook</code> has never held a row. ' +
        'The wiring is real and tested; nothing selects it yet.')));
    stack.appendChild(strip);
    U.clear(host).appendChild(stack);
  }

  /**
   * ★ WHO CAN ACT FOR WHOM — one node per principal, directed.
   *
   * The first build was bipartite: grantors down the left, delegates down the
   * right. `ashlin` therefore appeared as TWO UNLINKED DOTS, once in each
   * column, with no edge between its own two instances — so the diagram
   * structurally could not draw a delegation CHAIN, which is A6. It also spent
   * 34,800 px per edge against the mock's 6,435.
   *
   * One node per principal on a ring, arrowheads on every edge, and a chain is
   * now just a path you can follow with a finger.
   */
  function authorityGraph(D, lines) {
    var W = 520, H = 330, S = U.svg, cx = W / 2, cy = H / 2 + 6;
    var nodes = [];
    lines.forEach(function (a) {
      if (nodes.indexOf(a.grantor) < 0) nodes.push(a.grantor);
      if (nodes.indexOf(a.delegate) < 0) nodes.push(a.delegate);
    });
    nodes.sort();
    // ★ LAYERED, NOT A RING. On a ring, twelve edges all route through the
    // centre and you cannot trace one arrow without hovering — on the panel
    // named after the core loop. Three columns by role — issues only, does
    // both, holds only — puts every edge left-to-right, keeps ONE node per
    // principal so a delegation CHAIN still renders as a path you can follow,
    // and drops the crossings to near zero.
    var outDeg = {}, inDeg = {};
    lines.forEach(function (a) {
      outDeg[a.grantor] = (outDeg[a.grantor] || 0) + 1;
      inDeg[a.delegate] = (inDeg[a.delegate] || 0) + 1;
    });
    var cols = [[], [], []];
    nodes.forEach(function (p) {
      cols[!inDeg[p] ? 0 : (outDeg[p] ? 1 : 2)].push(p);
    });
    // biggest exposure at the top of each column, so the eye starts on the risk
    var expo = {};
    lines.forEach(function (a) {
      expo[a.grantor] = (expo[a.grantor] || 0) + a.granted + a.grantedContingent;
      expo[a.delegate] = (expo[a.delegate] || 0) + a.granted + a.grantedContingent;
    });
    cols.forEach(function (c) { c.sort(function (a, b) { return (expo[b] || 0) - (expo[a] || 0); }); });
    var used = cols.filter(function (c) { return c.length; });
    var at = {};
    used.forEach(function (c, ci) {
      var x = used.length === 1 ? cx : 96 + ((W - 192) * ci) / (used.length - 1);
      c.forEach(function (p, i) {
        at[p] = { x: x, y: 30 + (H - 62) * (c.length > 1 ? i / (c.length - 1) : 0.5), col: ci, last: ci === used.length - 1 };
      });
    });
    var maxL = lines.reduce(function (m, a) { return Math.max(m, a.granted + a.grantedContingent); }, 1);
    var kids = [S('defs', null, [
      S('marker', {
        id: 'ah', viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 5, markerHeight: 5, orient: 'auto',
      }, S('path', { d: 'M0 0L8 4L0 8Z', fill: '#19d7f2' })),
      S('marker', {
        id: 'ahd', viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 5, markerHeight: 5, orient: 'auto',
      }, S('path', { d: 'M0 0L8 4L0 8Z', fill: '#0a6a7d' })),
      S('marker', {
        id: 'ahr', viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 5, markerHeight: 5, orient: 'auto',
      }, S('path', { d: 'M0 0L8 4L0 8Z', fill: '#ca010f' })),
    ])];
    lines.forEach(function (a) {
      var p = at[a.grantor], q = at[a.delegate];
      if (!p || !q) return;
      var dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy) || 1;
      // stop short of the target node so the arrowhead lands on its edge
      var ex = q.x - (dx / len) * 9, ey = q.y - (dy / len) * 9;
      var sx = p.x + (dx / len) * 6, sy = p.y + (dy / len) * 6;
      // a shallow S rather than a chord through the middle
      var mx = (sx + ex) / 2, my = (sy + ey) / 2;
      var bx = mx, by = my + (p.col === q.col ? (p.y < q.y ? 26 : -26) : 0);
      var w = 0.7 + 3.1 * ((a.granted + a.grantedContingent) / maxL);
      var drawn = a.state === 'DRAWN' || a.spent > 0 || a.spentContingent > 0;
      var revoked = a.state === 'REVOKED';
      kids.push(S('path', {
        d: 'M' + sx.toFixed(1) + ' ' + sy.toFixed(1) + 'Q' + bx.toFixed(1) + ' ' + by.toFixed(1) +
          ' ' + ex.toFixed(1) + ' ' + ey.toFixed(1),
        fill: 'none', 'stroke-width': w.toFixed(2),
        stroke: revoked ? '#ca010f' : drawn ? '#19d7f2' : '#0a6a7d',
        'stroke-opacity': drawn ? 1 : 0.6,
        'marker-end': 'url(#' + (revoked ? 'ahr' : drawn ? 'ah' : 'ahd') + ')',
      }, S('title', {
        text: U.handleOf(a.grantor) + ' → ' + U.handleOf(a.delegate) + ' · MAX DIRECT LOSS ' +
          U.n(a.granted) + ' · MAX CONTINGENT ' + U.n(a.grantedContingent) + ' · ' + a.state +
          (a.spent ? ' · spent ' + U.n(a.spent) : ''),
      })));
      if (revoked) {
        // the mock's double-slash across a revoked edge
        var nx = -(ey - sy) / len, ny = (ex - sx) / len;
        [-2.5, 2.5].forEach(function (o) {
          kids.push(S('line', {
            x1: bx + nx * 5 + (dx / len) * o, y1: by + ny * 5 + (dy / len) * o,
            x2: bx - nx * 5 + (dx / len) * o, y2: by - ny * 5 + (dy / len) * o,
            stroke: '#ca010f', 'stroke-width': 1.4,
          }));
        });
      }
    });
    nodes.forEach(function (p) {
      var n = at[p]; if (!n) return;
      var right = !n.last;
      var out = lines.filter(function (a) { return a.grantor === p; }).length;
      var inn = lines.filter(function (a) { return a.delegate === p; }).length;
      kids.push(S('circle', { cx: n.x, cy: n.y, r: 5, fill: '#00060a', stroke: '#19d7f2', 'stroke-width': 1.3 }));
      kids.push(S('text', {
        x: n.x + (right ? 10 : -10), y: n.y + 3.5, 'text-anchor': right ? 'start' : 'end',
        fill: '#cfdadd', style: 'font:11px ui-monospace,monospace',
        text: U.handleOf(p),
      }, S('title', { text: U.handleOf(p) + ' · issues ' + out + ' · holds ' + inn })));
    });
    ['ISSUES ONLY', 'ISSUES AND HOLDS', 'HOLDS ONLY'].forEach(function (t, i) {
      if (!cols[i].length) return;
      var any = at[cols[i][0]]; if (!any) return;
      kids.push(S('text', {
        x: any.x, y: 14, 'text-anchor': i === 0 ? 'start' : i === 2 ? 'end' : 'middle',
        fill: '#3f5158', style: 'font:10px sans-serif;letter-spacing:.16em', text: t,
      }));
    });
    kids.push(S('text', {
      x: cx, y: H - 6, 'text-anchor': 'middle', fill: '#2c4750',
      style: 'font:10px sans-serif;letter-spacing:.16em',
      text: 'AN ARROW POINTS AT WHO MAY ACT \u00b7 WEIGHT IS THE WORST CASE',
    }));
    return S('svg', { viewBox: '0 0 ' + W + ' ' + H, style: 'width:100%;height:100%;display:block' }, kids);
  }

  // ═════════════════════════════════════════════════════════════ MARKET ══
  function market(host, D) {
    var R = D.R, ml = R.marketLines || [], wl = R.worksLines || [];
    var stack = el('div', { class: 'rows fill', style: 'height:100%' });
    var totalYield = wl.reduce(function (a, w) { return a + (w.yieldPerTick || 0); }, 0);
    var extracted = wl.reduce(function (a, w) { return a + (w.extracted || 0); }, 0);

    stack.appendChild(el('div', { class: 'tiles' }, [
      tile('UNREFINED', U.n(R.meters && R.meters.unrefined), { note: 'ore nobody has made payable yet' }),
      tile('YIELD / TICK', U.n(totalYield), { note: 'across ' + wl.length + ' WORKS' }),
      tile('EXTRACTED', U.n(extracted), { note: 'cumulative, this world' }),
      tile('VENUES', String(new Set(ml.map(function (m) { return m.venue; })).size), { note: 'systems with a print' }),
      tile('PRINTS', U.n(ml.reduce(function (a, m) { return a + (m.prints || 0); }, 0)), { note: 'trades on the record' }),
    ]));

    var g2 = el('div', { class: 'grid g-2', style: 'flex:0 0 244px' });
    g2.appendChild(panel('★ THE PRINT', {
      sub: 'a price on a place, and the gap to everywhere else',
      foot: 'PREMIUM is the gap between this venue and every venue — the number the signature exists for',
    }, ml.length ? table('mk', [
      { k: 'good', t: 'good', w: '92px', cell: function (m) { return el('span', null, [U.goodIcon(m.good), m.good]); } },
      { k: 'venue', t: 'venue', w: '120px', cell: function (m) { return U.sysLink(m.venue, m.venue + ' ' + sysName(D, m.venue)); } },
      { k: 'lastPrice', t: 'last', w: '60px', num: true },
      { k: 'vwap', t: 'vwap', w: '60px', num: true },
      { k: 'galaxyVwap', t: 'all venues', w: '74px', num: true },
      {
        k: 'premiumBps', t: 'premium', w: '76px', num: true,
        cell: function (m) {
          return m.premiumBps
            ? el('span', { style: 'color:' + (m.premiumBps > 0 ? 'var(--amber)' : 'var(--cyan)'), text: U.bps(m.premiumBps) })
            : el('span', { class: 'dim', text: '0%' });
        },
      },
      { k: 'volume', t: 'volume', w: '76px', num: true, cell: function (m) { return U.n(m.volume); } },
      { k: 'prints', t: 'prints', w: '56px', num: true },
      { k: 'legend', t: 'legend', cell: function (m) { return el('span', { title: m.legend, text: m.legend }); } },
    ], ml, { sort: 'volume', dir: -1, rerender: D.rerender })
      : empty('nothing has printed',
        'marketLines[] is empty. A print appears when two principals trade at a venue; the measured ' +
        'reading in a heuristic world is 7 rows across 9 frames, alloy only, with premiumBps zero on all seven.'),
    { style: 'flex:1 1 auto;min-height:0' }));

    // ★ THE FOUR GOODS. §10 specifies four and the chain is ore → refine →
    // ration/alloy/fuel. A good with no print says "no print", because that is
    // the fact, and a market screen that only shows the one good that traded
    // hides three quarters of the economy behind an absence.
    var GOODS = ['ore', 'ration', 'alloy', 'fuel'];
    var byGood = {};
    ml.forEach(function (m) {
      var e = byGood[m.good] || (byGood[m.good] = { prints: 0, volume: 0, venues: 0, last: null, premium: 0 });
      e.prints += m.prints || 0; e.volume += m.volume || 0;
      e.venues = Math.max(e.venues, m.venues || 0);
      e.last = m.lastPrice; e.premium = Math.max(e.premium, Math.abs(m.premiumBps || 0));
    });
    var maxVol = Math.max(1, GOODS.reduce(function (a, g) { return Math.max(a, (byGood[g] || {}).volume || 0); }, 0));
    g2.appendChild(panel('THE GOODS', {
      sub: 'ore is dug · refine makes it payable · a debt settles in the rest',
      foot: 'A good with no print has never been traded on a venue in this world. That is a fact about the world, not a gap in the frame.',
    }, el('div', { style: 'padding:4px 0' }, GOODS.map(function (gd) {
      var e = byGood[gd];
      return el('div', { style: 'display:flex;align-items:center;gap:10px;padding:5px 8px;border-bottom:1px solid var(--rule-dim)' }, [
        U.goodIcon(gd),
        el('span', { style: 'flex:0 0 58px;color:var(--text)', text: gd }),
        U.bar(e ? e.volume / maxVol : 0),
        el('span', {
          style: 'flex:0 0 92px;text-align:right;font-variant-numeric:tabular-nums;color:' +
            (e ? 'var(--text-2)' : 'var(--dimmer)'),
          text: e ? U.n(e.volume) + ' vol' : 'no print',
        }),
        el('span', {
          style: 'flex:0 0 78px;text-align:right;font-variant-numeric:tabular-nums;color:' +
            (e ? 'var(--cyan)' : 'var(--dimmer)'),
          text: e ? 'last ' + U.n(e.last) : '—',
        }),
      ]);
    })), { style: 'min-height:0' }));
    stack.appendChild(g2);

    // WORKS is 16 rows and the only full table on this screen. It was boxed
    // into a column beside a panel with 295px of blank; now it spans.
    stack.appendChild(panel('WORKS · what the ground yields', {
      sub: wl.length + ' rows · ★ a WORKS marks a system',
    }, wl.length ? table('wk', [
      { k: 'system', t: 'at', w: '116px', cell: function (w) { return U.sysLink(w.system, w.system + ' ' + sysName(D, w.system)); } },
      { k: 'holder', t: 'holder', w: '86px', cell: function (w) { return hOf(D, w.holder); } },
      { k: 'yieldPerTick', t: 'yield', w: '54px', num: true },
      { k: 'sharePerTick', t: 'share', w: '58px', num: true },
      { k: 'occupants', t: 'occ', w: '44px', num: true },
      { k: 'extracted', t: 'extracted', w: '82px', num: true, cell: function (w) { return U.n(w.extracted); } },
      { k: 'legend', t: 'state', w: '92px', cell: function (w) { return U.tag(w.legend, 'cy'); } },
    ], wl, { sort: 'yieldPerTick', dir: -1, rerender: D.rerender })
      : U.skeleton(8, 6), { style: 'flex:1 1 auto;min-height:0' }));

    // the hull ladder — the generated plate, used as itself
    stack.appendChild(panel('THE HULL LADDER', {
      sub: 'PIKE · LANCE · WARDEN · BULWARK · CITADEL',
      right: el('span', { class: 'pill', title: 'No frame key publishes a hull inventory, so nothing here is a claim about this world.', text: 'reference · not on the frame' }),
    }, el('div', { style: 'height:100%;background:var(--void);display:flex;align-items:center;justify-content:center' },
      el('img', {
        src: 'assets/hulls.webp', alt: 'the five hulls',
        style: 'max-width:100%;max-height:100%;object-fit:contain;display:block',
      })),
    { style: 'flex:0 0 158px' }));
    U.clear(host).appendChild(stack);
  }

  // ════════════════════════════════════════════════════════════════ MAP ══
  function mapScreen(host, D, sel) {
    var R = D.R;
    var wrap = el('div', { class: 'grid', style: 'grid-template-columns:1fr 322px;height:100%' });
    var mapPanel = el('section', { class: 'panel' });
    mapPanel.appendChild(el('h2', null, [
      'THE MAP',
      el('span', { class: 'sub' },
        R.map ? (R.map.length + ' systems · ' + D.laneCount + ' lanes · ' + D.straitCount + ' straits, ' + D.severCount + ' severing') : 'no topology'),
      el('span', { class: 'right' }, [
        R.meters ? 'LEVY SHORT ' + U.n(R.meters.levyShort) : '',
        el('button', {
          style: 'margin-left:10px;background:var(--panel-2);border:1px solid var(--rule);color:var(--dim);' +
            'font:9px var(--cond);letter-spacing:.16em;padding:2px 8px;cursor:pointer', text: 'RESET VIEW',
          on: { click: function () { MapView.reset(); D.rerender(); } },
        }),
      ]),
    ]));
    var body = el('div', { class: 'body', style: 'position:relative;overflow:hidden' });
    var host2 = el('div', { id: 'mapwrap' });
    body.appendChild(host2);
    mapPanel.appendChild(body);
    wrap.appendChild(mapPanel);

    // ★ EVERY CONTROL IS DOCKED IN THE SIDE COLUMN, none of it floats over the
    // canvas. The first build overlaid the legend, the layer toggles and the
    // inspector on the map, and the legend sat squarely on top of a FRONTIER
    // system. The mock docks its panels hard to the edge for exactly this
    // reason: the map is data, and nothing that is not data may cover it.
    var tools = el('div', { style: 'display:grid;grid-template-columns:1fr 1fr' },
      [['verge', 'THE VERGE'], ['lode', 'THE LODE'], ['pinch', 'THE PINCH'],
       ['claims', 'CLAIMS · RUINS'], ['works', 'WORKS'], ['motion', 'MOTION'],
       ['labels', 'LABELS']]
        .map(function (t) {
          var cb = el('input', { type: 'checkbox' });
          cb.checked = MapView.layers[t[0]];
          cb.addEventListener('change', function () { MapView.layers[t[0]] = cb.checked; draw(); });
          return el('label', { class: 'lyr' }, [cb, t[1]]);
        }));

    // ★ THE SWATCHES ARE THE BAND FILLS. Not a second set of literals: the
    // first build hand-picked legend colours and they ended up 2.6x brighter
    // than the map and in the WRONG ORDER — the key lied about the picture.
    var legend = el('div', { class: 'legend' });
    [['COMMONS', 'hostile action is INVALID'],
     ['MARCHES', 'contested ground'],
     ['FRONTIER', 'the rim, the prize']].forEach(function (r) {
      legend.appendChild(el('div', { class: 'row' }, [
        el('i', {
          class: 'sw',
          style: 'background:' + MapView.BAND_FILL[r[0]] + ';border:1px solid ' + MapView.BAND_EDGE[r[0]],
        }),
        'THE ' + r[0],
        el('span', { style: 'color:var(--dimmer);margin-left:6px', text: r[1] }),
      ]));
    });
    legend.appendChild(el('hr'));
    // Every mark the canvas can draw has a line here. The previous key covered
    // ten of about twenty, and the one it missed was the LARGEST object on the
    // map — an amber FRONT disc up to 78px across, 3x the biggest node.
    [['◯', 'var(--cyan)', 'node size = THE LODE'],
     ['◍', 'var(--cyan-deep)', 'brighter node = rich ground'],
     ['≻≺', 'var(--cyan)', 'waist = a STRAIT, notched with its detour'],
     ['▮', '#cfdadd', 'solid door = a SEVERING strait'],
     ['◠', 'var(--cyan)', 'one continuous outline = THE VERGE'],
     ['◌', 'var(--amber)', 'dashed ring = the ground yields fuel'],
     ['△', 'var(--cyan-mid)', 'a WORKS marks the system'],
     ['◦', 'var(--cyan)', 'tinted node = a CLAIM, in its holder\u2019s colour'],
     ['◦', 'var(--amber)', 'amber claim = in ARREARS'],
     ['◦', 'var(--red-text)', 'red claim = the next miss LAPSES it'],
     ['◜', 'var(--amber)', 'faint dashed disc = a FRONT, before landfall'],
     ['◜', 'var(--amber)', 'ring + countdown = a RAID demanding'],
     ['⌇', 'var(--cyan)', 'thin arc = a COMPACT between two holdings'],
     ['⌇', 'var(--red-text)', 'broken arc = the compact SNAPPED'],
     ['✕', '#8a969a', 'THE RUIN — permanent'],
     ['⌒', '#1c3b44', 'outer arc + name = a CONSTELLATION']].forEach(function (r) {
      legend.appendChild(el('div', { class: 'row' }, [
        el('b', { style: 'color:' + r[1] + ';display:inline-block;width:16px', text: r[0] }), r[2],
      ]));
    });
    legend.appendChild(el('hr'));
    legend.appendChild(el('div', { class: 'row', style: 'color:var(--dimmer);white-space:normal;line-height:1.6' },
      'Red on this map means one thing: a promise was broken. A severing strait, a raid and a ruin are ' +
      'losses, not lies, and they are not drawn in it.'));
    // the blocs actually on screen, in their own colours — colour was the first
    // thing the eye read and the key never mentioned it
    var bl = MapView.blocs();
    if (bl.length) {
      legend.appendChild(el('hr'));
      legend.appendChild(el('div', { class: 'row', style: 'color:var(--dim)', text: 'THE VERGES ON SCREEN' }));
      bl.slice().sort(function (a, b) { return b.systems - a.systems; }).forEach(function (b) {
        legend.appendChild(el('div', { class: 'row' }, [
          el('i', { class: 'sw', style: 'background:' + b.colour }),
          el('span', { style: 'color:' + (b.defaults ? 'var(--red-text)' : 'var(--text-2)'), text: U.handleOf(b.principal) }),
          el('span', { style: 'color:var(--dimmer)', text: ' · ' + b.systems + (b.defaults ? ' · ▲' + b.defaults : '') }),
        ]));
      });
    }

    var inspect = el('div', { class: 'inspect' });

    function drawInspect(id) {
      U.clear(inspect);
      var s = D.sysIndex[id];
      if (!s) {
        inspect.appendChild(el('div', { style: 'padding:9px;color:var(--dimmer);line-height:1.7' },
          'Click a node to inspect it. Scroll to zoom, drag to pan.'));
        return;
      }
      inspect.appendChild(el('div', {
        style: 'padding:5px 8px;background:var(--panel-2);border-bottom:1px solid var(--rule);' +
          'font:600 11px var(--cond);letter-spacing:.16em;color:var(--cyan);text-transform:uppercase',
        text: s.name + ' · ' + s.id,
      }));
      var kids = [
        ['TIER', s.tier], ['CONSTELLATION', s.constellation],
        ['ORE / TICK', String(s.yieldPerTick)],
        ['FUEL / TICK', s.fuelPerTick ? String(s.fuelPerTick) : '—'],
        ['RICHNESS', s.richnessBps + ' bps'],
        ['LANES', String((s.lanes || []).length)],
        ['STRAITS', String((s.straits || []).length)],
      ];
      (s.straits || []).forEach(function (st) {
        kids.push([st.severs ? 'SEVERS' : 'DETOUR', st.to + (st.severs ? ' · strands ' + st.severed : ' · ' + st.detourHops + ' hops')]);
      });
      (D.R.swayLines || []).filter(function (w) { return w.system === id; }).forEach(function (w) {
        kids.push(['SWAY', (w.principal ? U.handleOf(w.principal) : 'bare ground') + ' · ' + w.sway +
          ' · ' + w.reachers + ' can reach' + (w.gate ? ' · GATE' : '')]);
      });
      (D.R.worksLines || []).filter(function (w) { return w.system === id; }).forEach(function (w) {
        kids.push(['WORKS', U.handleOf(w.holder) + ' · ' + w.yieldPerTick + '/tick']);
      });
      (D.R.places || []).filter(function (p) { return p.system === id; }).forEach(function (p) {
        kids.push(['NAMED FOR', p.handle + ' since t' + p.sinceTick]);
      });
      kids.forEach(function (kv) {
        inspect.appendChild(el('div', { class: 'kv' }, [el('span', { text: kv[0] }), el('span', { text: kv[1] })]));
      });
    }

    function draw() {
      MapView.render(host2, R, D.L, { onSelect: function (id) { MapView.select(id); draw(); drawInspect(id); } });
      drawInspect(MapView.selected());
    }

    var side = el('div', { class: 'rows', style: 'min-height:0' });
    side.appendChild(panel('LAYERS', { sub: 'what the map is drawing' }, tools, { style: 'flex:0 0 auto' }));
    side.appendChild(panel('SYSTEMS', { sub: (R.map || []).length + ' · sortable' },
      (R.map || []).length ? table('sys', [
        { k: 'id', t: 'sys', w: '48px', cell: function (s) { return el('span', { class: 'dim', text: s.id.replace('sys-', '') }); } },
        { k: 'name', t: 'name', w: '104px', cell: function (s) { return U.sysLink(s.id, s.name); } },
        {
          k: 'tier', t: 'tier', w: '32px',
          cell: function (s) {
            return el('i', {
              class: 'sw', title: s.tier,
              style: 'margin:0;background:' + MapView.BAND_FILL[s.tier] +
                ';border:1px solid ' + MapView.BAND_EDGE[s.tier],
            });
          },
          sort: function (s) { return s.tier; },
        },
        { k: 'yieldPerTick', t: 'ore', w: '42px', num: true },
        { k: 'lanes', t: 'ln', w: '30px', num: true, cell: function (s) { return String((s.lanes || []).length); }, sort: function (s) { return (s.lanes || []).length; } },
        {
          k: 'straits', t: 'st', w: '30px', num: true,
          cell: function (s) { return (s.straits || []).length || el('span', { class: 'dim', text: '—' }); },
          sort: function (s) { return (s.straits || []).length; },
        },
      ], R.map, {
        sort: 'id', dir: 1, rerender: D.rerender,
        sel: function (s) { return s.id === MapView.selected(); },
        onRow: function (s) { MapView.select(s.id); draw(); },
      }) : empty('no topology on the frame',
        'The lane graph is on the Reckoning frame only. Nothing to lay out until the first settlement.')));
    side.appendChild(panel('INSPECT', null, inspect, { style: 'flex:0 0 auto;max-height:260px' }));
    // the legend is 16 keyed marks plus the blocs on screen; it scrolls rather
    // than squeezing SYSTEMS down to a single row, which is what it did
    side.appendChild(panel('LEGEND', { sub: 'every mark the canvas draws' }, legend,
      { style: 'flex:0 1 300px;min-height:120px' }));
    wrap.appendChild(side);
    U.clear(host).appendChild(wrap);
    if (sel) MapView.select(sel);
    // one frame later, so clientWidth is real
    requestAnimationFrame(draw);
  }

  // ══════════════════════════════════════════════════════════ STANDINGS ══
  function standings(host, D) {
    var R = D.R, rows = (R.standings || []).slice();
    var stack = el('div', { class: 'rows fill', style: 'height:100%' });
    var g = el('div', { class: 'grid', style: 'grid-template-columns:1fr 340px;flex:1 1 auto;min-height:0' });
    // ★ SPARSE KEEPS ITS STRUCTURE. A page with one card floating in black
    // reads as a failed render; a page whose frames, headers and rails are all
    // present but blank reads as NOT YET. The live world spends its first 288
    // ticks with no Reckoning frame at all and that is a normal state.
    if (!rows.length) {
      g.appendChild(panel('THE STANDING', {
        sub: 'the public directory a counterparty is priced from',
        right: el('span', { class: 'pill', text: 'awaiting the first Reckoning' }),
        foot: 'There is deliberately no rating here. A composite would do the judging for you, and the judging is the show.',
      }, el('div', null, [
        el('table', { class: 't' }, el('thead', null, el('tr', null,
          ['handle', 'elective honoured', 'value honoured', 'defaults', 'contradicted seals',
           'counterparties', 'last default', 'holding'].map(function (t) {
            return el('th', { class: /honoured|default|counter/.test(t) ? 'num' : null, text: t });
          })))),
        U.skeleton(16, 6),
      ]), { foot: 'standings[] is published at settlement \u00b7 this world has not settled a Reckoning' }));
      var sk = el('div', { class: 'rows', style: 'min-height:0' });
      sk.appendChild(panel('THE HALL OF FAME', { sub: 'over the world\u2019s whole life' },
        U.skeleton(4, 3), { foot: 'four titles, awarded over the world\u2019s whole life' }));
      sk.appendChild(panel('THE SHAPE OF IT', { sub: 'this frame' }, el('div', null, [
        U.kv('PRINCIPALS', U.nul()), U.kv('NEVER BROKEN', U.nul()),
        U.kv('WITH A DEFAULT', U.nul()), U.kv('ELECTIVE HALVES KEPT', U.nul()),
        U.kv('DEFAULTS ON THE RECORD', U.nul()),
      ])));
      g.appendChild(sk);
      stack.appendChild(g);
      var sb = el('div', { class: 'grid g-3', style: 'flex:0 0 176px' });
      [['RECENT ACTIVITY', 'this Reckoning\u2019s beats'],
       ['THE SEAL', 'a sealed intention reveals one Reckoning later'],
       ['HOLDING SNAPSHOT', 'who works which ground']].forEach(function (t) {
        sb.appendChild(panel(t[0], { sub: t[1] }, U.skeleton(5, 3),
          { foot: 'nothing until the first settlement' }));
      });
      stack.appendChild(sb);
      U.clear(host).appendChild(stack);
      return;
    }
    // ★ NO SCORE COLUMN, NO GRADE, NO GAUGE. Raw counts only — the moment a
    // number is composited into a rating the viewer stops judging and starts
    // reading the rating, and the judging is the product.
    g.appendChild(panel('THE STANDING', {
      sub: rows.length + ' principals · raw counts only, no score and no grade',
      foot: 'There is deliberately no rating here. A composite would do the judging for you, and the judging is the show.',
    }, table('st', [
      // ★ hJudged, not hOf. This is one of exactly four surfaces where a
      // principal's record is allowed to colour their name.
      {
        k: 'handle', t: 'handle', w: '124px',
        cell: function (r) {
          return el('span', { style: 'display:inline-flex;align-items:center;gap:7px' },
            [U.crest(r.principal, 15), hJudged(D, r.principal, r.handle)]);
        },
      },
      { k: 'electiveHonoured', t: 'elective honoured', w: '128px', num: true },
      { k: 'electiveHonouredValue', t: 'value honoured', w: '118px', num: true, cell: function (r) { return U.n(r.electiveHonouredValue); } },
      {
        // GRADED, three steps, exactly as the mock's own legend grades it.
        // A binary wash says 1 default and 5 defaults are the same thing.
        k: 'defaults', t: 'defaults', w: '86px', num: true,
        cell: function (r) {
          if (!r.defaults) return el('span', { class: 'dim', text: '0' });
          // a filled cell, graded. A row wash at 1.02:1 is chroma only; the
          // mock grades the CELL and gets 1.57:1 out of the same three steps.
          var bg = r.defaults >= 3 ? '#8f0a12' : r.defaults === 2 ? '#7a3418' : '#5c4415';
          var fg = r.defaults >= 3 ? '#ffd9d5' : r.defaults === 2 ? '#ffd9bd' : '#f3dfae';
          return el('span', {
            style: 'display:inline-block;min-width:34px;padding:1px 8px;background:' + bg +
              ';color:' + fg + ';font-weight:600;text-align:center',
            text: String(r.defaults),
          });
        },
      },
      { k: 'contradictedSeals', t: 'contradicted seals', w: '128px', num: true },
      { k: 'distinctCounterparties', t: 'counterparties', w: '110px', num: true },
      {
        k: 'lastDefaultTick', t: 'last default', w: '92px', num: true,
        cell: function (r) { return r.lastDefaultTick ? 'tick ' + r.lastDefaultTick : el('span', { class: 'dim', text: 'none' }); },
      },
      {
        k: 'holding', t: 'holding',
        cell: function (r) {
          var p = (R.places || []).filter(function (x) { return x.namedFor === r.principal; })[0];
          var w = (R.worksLines || []).filter(function (x) { return x.holder === r.principal; })[0];
          var sid = p ? p.system : w ? w.system : null;
          return sid ? U.sysLink(sid, sysName(D, sid) + ' · ' + sid) : el('span', { class: 'dim', text: '—' });
        },
        sort: function (r) { return r.handle; },
      },
    ], rows, {
      sort: 'defaults', dir: -1, rerender: D.rerender,
      rowClass: function (r) { return r.defaults >= 3 ? 'bad' : r.defaults > 0 ? 'warn' : ''; },
      onRow: function (r) { location.hash = '#/principals/' + U.handleOf(r.principal); },
    })));
    // ★ THE THREE-SECOND ANSWER, IN WORDS. The mock puts exactly this under
    // its table — the cleanest record in cyan over the worst in red — and it is
    // the line a stranger actually reads. A table alone makes them scan.
    var best = rows.slice().sort(function (a, b) {
      return (a.defaults - b.defaults) || (b.electiveHonouredValue - a.electiveHonouredValue);
    })[0];
    var worst = rows.slice().sort(function (a, b) {
      return (b.defaults - a.defaults) || ((b.lastDefaultTick || 0) - (a.lastDefaultTick || 0));
    })[0];
    var callout = el('div', { class: 'callout' }, [
      el('div', { class: 'good' }, [
        el('span', { class: 'who', text: best.handle }),
        'kept ' + best.electiveHonoured + ' elective promises across ' +
          best.distinctCounterparties + ' counterparties' +
          (best.defaults ? ' · ' + best.defaults + ' defaults' : ' · not one default'),
      ]),
      worst.defaults ? el('div', { class: 'bad' }, [
        el('span', { class: 'who', text: worst.handle }),
        'defaulted ' + worst.defaults + (worst.defaults === 1 ? ' time' : ' times') +
          ' · kept ' + worst.electiveHonoured + ' · ' + worst.distinctCounterparties +
          ' counterparties' + (worst.lastDefaultTick ? ' · last at tick ' + worst.lastDefaultTick : ''),
      ]) : null,
    ]);
    // sits between the table body and the panel's own footnote
    g.firstChild.insertBefore(callout, g.firstChild.lastChild);

    var side = el('div', { class: 'rows', style: 'min-height:0' });
    side.appendChild(panel('THE HALL OF FAME', { sub: 'over the world\'s whole life' },
      (R.hallOfFame || []).length
        ? el('div', null, (R.hallOfFame || []).map(function (f) {
          var bad = /^MOST BROKEN/.test(f.title);
          return el('div', { style: 'display:flex;gap:10px;padding:8px;border-bottom:1px solid var(--rule-dim)' }, [
            U.crest(f.principal, 22),
            el('div', { style: 'min-width:0' }, [
              el('div', {
                style: 'font:600 10px var(--cond);letter-spacing:.16em;color:' + (bad ? 'var(--red-text)' : 'var(--cyan)'),
                text: f.title,
              }),
              el('div', { style: 'font-size:10px;color:var(--dim);margin-top:3px;white-space:normal;line-height:1.5' },
                f.handle + ' — ' + f.clause),
            ]),
          ]);
        }))
        : empty('no titles yet', '<code>hallOfFame[]</code> fills once the world has a history to rank.')));

    var kept = rows.reduce(function (a, r) { return a + r.electiveHonoured; }, 0);
    var broke = rows.reduce(function (a, r) { return a + r.defaults; }, 0);
    var clean = rows.filter(function (r) { return !r.defaults; }).length;
    // declared here, not in the bottom row: `var` hoisting made this read
    // `undefined` and the panel printed an em-dash for a real number
    var totalCp = rows.reduce(function (a, r) { return a + r.distinctCounterparties; }, 0);
    // A three-step row wash needs a three-step key. The mock ships one; the
    // build introduced the grading and shipped no key for it, so the middle
    // step was an unexplained tint.
    side.appendChild(panel('THE KEY', { sub: 'what a row tint means' }, el('div', { class: 'legend' }, [
      el('div', { class: 'row' }, [el('i', { class: 'sw', style: 'background:#0a1c22;border:1px solid var(--rule)' }), 'no default \u00b7 a clean record']),
      el('div', { class: 'row' }, [el('i', { class: 'sw', style: 'background:rgba(216,156,66,.16);border:1px solid rgba(216,156,66,.45)' }), '1\u20132 defaults']),
      el('div', { class: 'row' }, [el('i', { class: 'sw', style: 'background:rgba(202,1,15,.18);border:1px solid rgba(202,1,15,.55)' }), '3 or more defaults']),
      el('div', { class: 'row', style: 'color:var(--dimmer);white-space:normal;line-height:1.6;padding-top:4px' },
        'A DEFAULT is an elective half a principal could have paid and did not. The escrowed half auto-executes and cannot be broken.'),
    ]), { style: 'flex:0 0 auto' }));
    side.appendChild(panel('THE SHAPE OF IT', { sub: 'this frame' }, el('div', null, [
      U.kv('PRINCIPALS', String(rows.length)),
      U.kv('NEVER BROKEN', String(clean)),
      U.kv('WITH A DEFAULT', String(rows.length - clean), rows.length - clean > 0),
      U.kv('ELECTIVE PROMISES KEPT', U.n(kept)),
      U.kv('DEFAULTS, ALL TIME', U.n(broke), broke > 0),
      // the degree sum, named as one: it counts each relationship from both
      // ends, so it is not an edge count and must not be labelled as one
      U.kv('COUNTERPARTY TIES, SUMMED', U.n(totalCp)),
      el('div', { class: 'note-line' },
        'Gate 3 measured 12% of settled elective promises broken, unprompted. Neither zero — which would have ' +
        'made trust worthless — nor universal, which would make the elective half a fee.'),
    ])));
    g.appendChild(side);
    stack.appendChild(g);

    // ★ THE BOTTOM ROW. `dense-standings` was 68% blank body rows against the
    // mocks' worst of 33%, and the mock fits seven more panels at a narrower
    // width. These three are the ones this frame can actually feed.
    var bottom = el('div', { class: 'grid g-4', style: 'flex:0 0 208px' });

    var beatsAll = (R.rundown || []).slice().sort(function (a, b) { return b.order - a.order; });
    bottom.appendChild(panel('RECENT ACTIVITY', { sub: 'this Reckoning\u2019s beats, newest first' },
      beatsAll.length ? el('div', { class: 'log' }, beatsAll.map(function (b) {
        return el('div', { class: 'ln' + (b.defaulted ? ' bad' : '') }, [
          el('span', { class: 'tk', text: '#' + String(b.order).padStart(2, '0') }),
          el('span', { class: 'ty', text: b.kind }),
          // wraps: the ellipsis was cutting exactly the half of the sentence
          // that says what happened
          el('span', { class: 'de', style: 'white-space:normal;line-height:1.5', text: b.deed }),
        ]);
      })) : empty('nothing settled tonight', 'The rundown is empty on this frame.')));

    var seals = { HONOURED: 0, CONTRADICTED: 0, none: 0 };
    (R.rundown || []).forEach(function (b) { seals[b.sealVerdict || 'none']++; });
    bottom.appendChild(panel('THE SEAL', { sub: 'a sealed intention reveals one Reckoning later' }, el('div', null, [
      U.kv('HONOURED', String(seals.HONOURED)),
      U.kv('CONTRADICTED', String(seals.CONTRADICTED), seals.CONTRADICTED > 0),
      U.kv('NO SEAL ON THE BEAT', String(seals.none)),
      U.kv('CONTRADICTED, ALL TIME', String(rows.reduce(function (a, r) { return a + r.contradictedSeals; }, 0))),
      el('div', { class: 'note-line', title:
        'A CONTRADICTED seal is the say-do gap caught in the act: an agent sealed one intention and did ' +
        'another, and the record can prove it. It has never once occurred in any world this repo has run.',
      }, 'CONTRADICTED has never occurred in any world measured — hover for what it would mean.'),
    ])));

    var holds = {};
    (R.worksLines || []).forEach(function (w) {
      var e = holds[w.system] || (holds[w.system] = { system: w.system, works: 0, yield: 0, holders: [] });
      e.works++; e.yield += w.yieldPerTick || 0;
      if (e.holders.indexOf(w.holder) < 0) e.holders.push(w.holder);
    });
    var hl = Object.keys(holds).map(function (k2) { return holds[k2]; });
    // ★ SYNDICATES. `syndicateLines[]` carries eight rows on every frame of
    // every world and this client referenced it zero times — the exact defect
    // this repo keeps re-teaching, reproduced in the renderer. The measured
    // truth is unflattering (every syndicate is a solo founder with an empty
    // strongbox) and that is a fact about the world worth showing, not a
    // reason to leave the key unread.
    var syn = (R.syndicateLines || []).slice();
    bottom.appendChild(panel('SYNDICATES', {
      sub: syn.length + ' chartered · ' + syn.filter(function (x) { return x.members > 1; }).length + ' pooled',
      foot: 'A STRONGBOX with one member and no treasury is a charter nobody has joined.',
    }, syn.length ? table('st-s', [
      { k: 'name', t: 'name', w: '116px', cell: function (x) { return el('span', { class: 'k', text: x.name }); } },
      { k: 'founder', t: 'founder', w: '92px', cell: function (x) { return hOf(D, x.founder); } },
      { k: 'members', t: 'pooled', w: '58px', num: true, cell: function (x) { return x.members > 1 ? String(x.members) : el('span', { class: 'dim', text: '1' }); } },
      { k: 'treasuryMinor', t: 'box', w: '64px', num: true, cell: function (x) { return x.treasuryMinor ? U.n(x.treasuryMinor) : el('span', { class: 'dim', text: 'empty' }); } },
      { k: 'officeHolders', t: 'offices', w: '62px', num: true, cell: function (x) { return x.officeHolders || el('span', { class: 'dim', text: '0' }); } },
      { k: 'admission', t: 'entry', w: '68px', cell: function (x) { return U.tag(x.admission, 'cy'); } },
      { k: 'decision', t: 'decision', cell: function (x) { return el('span', { class: 'dim', text: x.decision }); } },
    ], syn, { sort: 'members', dir: -1, rerender: D.rerender })
      : empty('nobody has chartered a syndicate', 'No syndicate exists in this world.')));

    bottom.appendChild(panel('HOLDING SNAPSHOT', { sub: hl.length + ' systems worked' },
      hl.length ? table('st-h', [
        { k: 'system', t: 'at', w: '112px', cell: function (x) { return U.sysLink(x.system, sysName(D, x.system) + ' · ' + x.system); } },
        { k: 'tier', t: 'tier', w: '76px', cell: function (x) { return el('span', { class: 'dim', text: (D.sysIndex[x.system] || {}).tier || '—' }); }, sort: function (x) { return (D.sysIndex[x.system] || {}).tier || ''; } },
        { k: 'works', t: 'works', w: '54px', num: true },
        { k: 'yield', t: 'ore/tick', w: '64px', num: true },
        {
          // one holder plus a +N pill: five of eight rows were cut mid-glyph at
          // the panel border with no ellipsis
          k: 'holders', t: 'held by',
          cell: function (x) {
            return el('span', { title: x.holders.map(U.handleOf).join(' \u00b7 ') }, [
              hOf(D, x.holders[0]),
              x.holders.length > 1 ? el('span', { class: 'pill', style: 'margin-left:6px', text: '+' + (x.holders.length - 1) }) : null,
            ]);
          },
          sort: function (x) { return x.holders.length; },
        },
      ], hl, { sort: 'yield', dir: -1, rerender: D.rerender })
        : empty('nobody is working the ground', 'No WORKS row on this frame.')));
    stack.appendChild(bottom);
    U.clear(host).appendChild(stack);
  }

  // ══════════════════════════════════════════════════════════ RECKONING ══
  function reckoning(host, D, sel) {
    var R = D.R;
    if (!R || R.reckoningIndex === undefined || !(R.rundown || []).length) {
      // The ceremony's frame, standing empty and counting down. Every hero
      // tile, every panel and the reel's four bands are present with no
      // content, because an empty STRUCTURE reads as *not yet* while an empty
      // PAGE reads as an outage — and this is the state the live world is in
      // for the first 288 ticks of its life.
      var L0 = D.L;
      var waiting = el('div', { class: 'rows fill', style: 'height:100%' });
      waiting.appendChild(el('div', { class: 'hero' }, [
        el('div', null, [el('div', { class: 'big', style: 'color:var(--dimmer)', text: '·' }), el('div', { class: 'lab', text: 'LEVY SHORT' })]),
        el('div', { style: 'width:1px;align-self:stretch;background:var(--rule)' }),
        el('div', null, [
          el('div', { class: 'big', text: L0 ? U.n(L0.meters && L0.meters.onAPromise) : '—' }),
          el('div', { class: 'lab', text: 'ON A PROMISE' }),
        ]),
        el('div', { style: 'width:1px;align-self:stretch;background:var(--rule)' }),
        el('div', null, [
          el('div', { class: 'big', style: 'color:var(--dimmer)', text: '· / ·' }),
          el('div', { class: 'lab', text: 'HALVES KEPT / BROKEN' }),
        ]),
        el('div', { style: 'margin-left:auto;text-align:right' }, [
          el('div', { style: 'font:600 13px var(--cond);letter-spacing:.16em;color:var(--cyan)' },
            L0 ? 'RECKONING ' + L0.reckoningIndex + ' SETTLES IN ' + L0.ticksUntilReckoning + ' TICKS' : 'AWAITING THE FIRST RECKONING'),
          el('div', { style: 'font-size:11px;color:var(--dim);margin-top:5px' },
            L0 ? 'about ' + U.clock(L0.ticksUntilReckoning) + ' at 300 s a tick · phase ' + L0.phase : ''),
        ]),
      ]));
      var wg = el('div', { class: 'grid', style: 'grid-template-columns:330px 320px 1fr;flex:1 1 auto;min-height:0' });
      wg.appendChild(panel('THE RUNDOWN', { sub: 'the night\u2019s beats, largest say-do delta last' },
        U.skeleton(10, 3), { foot: 'the night is written at settlement \u00b7 nothing has settled' }));
      var wl = el('div', { class: 'rows', style: 'min-height:0' });
      wl.appendChild(panel('THE LEVY', { sub: 'tribute lines' }, U.skeleton(7, 3),
        { foot: 'the Levy falls at settlement' }));
      wl.appendChild(panel('THE HALL OF FAME', { sub: '4 titles' }, U.skeleton(4, 2),
        { foot: 'titles are awarded over the world\u2019s whole life' }));
      wg.appendChild(wl);
      wg.appendChild(panel('★ THE RECEIPT REEL', { sub: 'the grant · the words · the seal · the deed' },
        el('div', { class: 'reel' }, [
          ['THE GRANT', 'the authority the deed was done under'],
          ['THE WORDS', 'what its author said while doing it'],
          ['THE SEAL', 'the intention it declared beforehand'],
          ['THE DEED', 'what it actually did, and what that cost'],
        ].map(function (t, i) {
          return el('div', { class: 'band nul' }, [
            el('div', { class: 'no', text: String(i + 1) }),
            el('div', { class: 'bd' }, [
              el('div', { class: 'bt' }, [t[0], el('span', { class: 'q', text: '  ' + t[1] })]),
              empty('nothing until the first settlement'),
            ]),
          ]);
        }))));
      waiting.appendChild(wg);
      U.clear(host).appendChild(waiting);
      return;
    }
    var M = R.meters || {}, rd = (R.rundown || []).slice().sort(function (a, b) { return a.order - b.order; });
    var cur = rd.filter(function (s) { return String(s.order) === String(sel); })[0] ||
      rd.filter(function (s) { return s.defaulted; })[0] || rd[rd.length - 1];

    var stack = el('div', { class: 'rows fill', style: 'height:100%' });

    // E6 broadcast scale — the ceremony's headline row
    stack.appendChild(el('div', { class: 'hero' }, [
      el('div', null, [
        el('div', { class: 'big' + ((M.levyShort || 0) > 0 ? ' warn' : ''), text: U.n(M.levyShort) }),
        el('div', { class: 'lab', text: 'LEVY SHORT' }),
      ]),
      el('div', { style: 'width:1px;align-self:stretch;background:var(--rule)' }),
      el('div', null, [el('div', { class: 'big', text: U.n(M.onAPromise) }), el('div', { class: 'lab', text: 'ON A PROMISE' })]),
      el('div', { style: 'width:1px;align-self:stretch;background:var(--rule)' }),
      el('div', null, [
        el('div', { class: 'big' }, [
          String(M.kept),
          el('span', { style: 'color:var(--dimmer)', text: ' – ' }),
          el('span', { style: 'color:' + (M.broken ? 'var(--red-text)' : 'var(--cyan)'), text: String(M.broken) }),
        ]),
        el('div', { class: 'lab', text: 'HALVES KEPT / BROKEN' }),
      ]),
      el('div', { style: 'width:1px;align-self:stretch;background:var(--rule)' }),
      el('div', null, [el('div', { class: 'big', text: U.n(M.unrefined) }), el('div', { class: 'lab', text: 'UNREFINED' })]),
      el('div', { style: 'margin-left:auto;text-align:right' }, [
        el('div', { style: 'font:600 13px var(--cond);letter-spacing:.16em;color:var(--text)' },
          'RECKONING ' + R.reckoningIndex + ' · SETTLED AT TICK ' + U.n(R.tick)),
        el('div', { style: 'font-size:10px;color:var(--dim);margin-top:5px' },
          'IMMUTABLE · state hash ' + (R.stateHash || '').slice(0, 24)),
      ]),
    ]));

    var g = el('div', { class: 'grid', style: 'grid-template-columns:330px 320px 1fr;flex:1 1 auto;min-height:0' });

    // THE RUNDOWN
    g.appendChild(panel('THE RUNDOWN', {
      sub: rd.length + ' beats · largest say-do delta last',
    }, el('div', null, rd.map(function (s) {
      var on = s === cur;
      return el('div', {
        style: 'display:flex;gap:9px;padding:7px 8px;cursor:pointer;border-bottom:1px solid var(--rule-dim);' +
          (on ? 'background:var(--cyan-wash-2);' : ''),
        on: { click: function () { location.hash = '#/reckoning/' + s.order; } },
      }, [
        el('span', { style: 'color:var(--dimmer);width:18px;flex:0 0 18px;font-variant-numeric:tabular-nums', text: String(s.order).padStart(2, '0') }),
        s.glyph ? U.glyph(s.glyph, 22) : el('span', { style: 'width:22px;flex:0 0 22px' }),
        el('div', { style: 'min-width:0' }, [
          el('div', {
            style: 'font:600 9px var(--cond);letter-spacing:.16em;color:' + (s.defaulted ? 'var(--red-text)' : 'var(--dim)'),
            text: s.kind + (s.sealVerdict ? ' · SEAL ' + s.sealVerdict : ''),
          }),
          el('div', {
            style: 'font-size:11px;line-height:1.45;white-space:normal;color:' + (s.defaulted ? 'var(--red-text)' : 'var(--text-2)'),
            text: s.deed,
          }),
        ]),
      ]);
    }))));

    // THE LEVY
    var tl = (R.tributeLines || []).slice();
    var maxOwed = tl.reduce(function (a, t) { return Math.max(a, t.owed || 0); }, 0);
    var byState = {};
    tl.forEach(function (t) { byState[t.state] = (byState[t.state] || 0) + 1; });
    var lp = el('div', { class: 'rows', style: 'min-height:0' });
    lp.appendChild(panel('THE LEVY', {
      sub: tl.length + ' tribute lines · ' +
        Object.keys(byState).sort().map(function (k2) { return byState[k2] + ' ' + k2; }).join(' · ') +
        ((M.levyShort || 0) ? ' · SHORT ' + U.n(M.levyShort) : ''),
      alarm: (M.levyShort || 0) > 0,
      // the legend now describes what is DRAWN. It used to describe the mock's
      // Sankey — three of its four entries named marks this panel never makes.
      foot: 'line length is what is owed · RED unpaid at the freeze · a full dim line is a tribute clear',
    }, tl.length ? el('div', null, tl.map(function (t) {
      // ★ THE LINE LENGTH IS THE DEBT. Every one of the sixteen used to be
      // exactly 120px, so the only variable in the chart was its hue — a chart
      // that encoded nothing sitting under a headline number it was supposed
      // to decompose.
      var col = t.state === 'RED' ? 'var(--red)' : t.state === 'DASHED' ? 'var(--dim)' : t.state === 'REVERSING' ? 'var(--amber)' : 'var(--cyan-deep)';
      var frac = maxOwed ? (t.owed || 0) / maxOwed : 0;
      return el('div', { style: 'display:flex;align-items:center;gap:8px;padding:2.5px 8px;border-bottom:1px solid var(--rule-dim)' }, [
        el('span', { style: 'width:78px;flex:0 0 78px' }, hOf(D, t.principal)),
        el('span', { style: 'flex:1 1 auto;height:3px;position:relative;background:#0a1c22' },
          el('i', {
            style: 'position:absolute;left:0;top:0;bottom:0;display:block;width:' +
              (t.owed ? Math.max(3, frac * 100) : 100).toFixed(1) + '%;background:' +
              (t.owed ? col : 'var(--cyan-deep)') + ';opacity:' + (t.owed ? 1 : 0.35),
          })),
        el('span', {
          style: 'width:88px;flex:0 0 88px;text-align:right;font-variant-numeric:tabular-nums;color:' +
            (t.owed ? 'var(--red-text)' : 'var(--dimmer)'),
          title: 'tribute flows to ' + t.to,
          text: t.owed ? U.n(t.owed) : 'clear',
        }),
      ]);
    })) : empty('no tribute line', 'Nobody owes the Levy on this frame.')));
    lp.appendChild(panel('THE HALL OF FAME', { sub: '4 titles' },
      (R.hallOfFame || []).length ? el('div', null, (R.hallOfFame || []).map(function (f) {
        var bad = /^MOST BROKEN/.test(f.title);
        return el('div', { style: 'display:flex;gap:9px;padding:7px 8px;border-bottom:1px solid var(--rule-dim)' }, [
          U.crest(f.principal, 22),
          el('div', { style: 'min-width:0' }, [
            el('div', { style: 'font:600 9px var(--cond);letter-spacing:.16em;color:' + (bad ? 'var(--red-text)' : 'var(--cyan)'), text: f.title }),
            el('div', { style: 'font-size:10px;color:var(--dim);white-space:normal;line-height:1.5', text: f.clause }),
          ]),
        ]);
      })) : empty('no titles', 'Nothing ranked yet.')));
    g.appendChild(lp);

    // ★ THE RECEIPT REEL
    g.appendChild(panel('★ THE RECEIPT REEL', {
      sub: cur ? 'beat #' + cur.order + ' · ' + cur.kind : '',
      alarm: cur && cur.defaulted,
    }, receiptReel(D, cur)));
    stack.appendChild(g);

    // the scrubber — index.json is free and exact
    if (D.index.length > 1) {
      stack.appendChild(el('div', { class: 'panel', style: 'flex:0 0 auto' },
        el('div', { class: 'scroller' }, [
          el('span', { style: 'font:9px var(--cond);letter-spacing:.16em;color:var(--dim);margin-right:6px', text: 'EVERY RECKONING' }),
        ].concat(D.index.map(function (ix) {
          return el('button', {
            'aria-current': ix.reckoning === R.reckoningIndex ? 'true' : null,
            text: 'R' + ix.reckoning,
            title: 'tick ' + ix.tick + ' · kept ' + ix.kept + ' · broken ' + ix.broken + ' · levy short ' + ix.levyShort,
            on: { click: function () { D.loadReckoning(ix.file); } },
          });
        })))));
    }
    U.clear(host).appendChild(stack);
  }

  /**
   * §14: *"the traitor's own words beside the promise it broke."* Four bands —
   * THE GRANT, THE WORDS, THE SEAL, THE DEED.
   *
   * The words band is `receiptReel[]`, and it is `null` on every segment of
   * every world this repo has produced: the reel is gated on PARTIES-tier
   * negotiation and the cast does not talk. So the band renders EMPTY AND SAYS
   * WHY. Drawing a plausible line there would be the single worst thing this
   * client could do — A5′ says a fabricated record libels a real agent
   * permanently, and that applies to the renderer exactly as it applies to the
   * engine.
   */
  function receiptReel(D, s) {
    if (!s) return empty('no beat selected', 'Pick a beat from the rundown.');
    var R = D.R;
    var grantLine = s.grant ? (D.authority || []).filter(function (a) { return a.grant === s.grant; })[0] : null;
    var reel = el('div', { class: 'reel' });

    // 1 — THE GRANT
    reel.appendChild(band('1', 'THE GRANT', s.grant
      ? el('div', null, [
        el('div', { style: 'display:flex;align-items:baseline;gap:14px;font-size:17px' }, [
          hOf(D, s.actedBy || (grantLine && grantLine.grantor)),
          el('span', { style: 'color:var(--dimmer)', text: '————————▶' }),
          hOf(D, s.onBehalfOf || (grantLine && grantLine.delegate)),
        ]),
        el('div', { style: 'font-size:10px;color:var(--dim);margin-top:6px', text: s.grant }),
        grantLine ? el('div', { style: 'display:flex;gap:22px;margin-top:8px;font-size:11px' }, [
          el('span', null, [el('span', { style: 'color:var(--dimmer)', text: 'MAX DIRECT LOSS ' }), U.n(grantLine.granted)]),
          el('span', null, [el('span', { style: 'color:var(--dimmer)', text: 'MAX CONTINGENT ' }), U.n(grantLine.grantedContingent)]),
          U.pips(grantLine.clearance),
        ]) : null,
        el('div', { style: 'font-size:10px;color:var(--dimmer);margin-top:7px', text: 'the worst case, shown before it was signed' }),
      ])
      : miss('nobody acted on another\u2019s authority here',
        'The frame carries rundown[].grant and it is null on this beat: either no delegated authority ' +
        'was used, or the venture was not bound to a grant.'), null, !s.grant));

    // 2 — THE WORDS
    reel.appendChild(band('2', 'THE WORDS', (s.receiptReel || []).length
      ? el('div', null, (s.receiptReel || []).map(function (r) {
        return el('div', { class: 'said' }, [
          el('span', { class: 'who', text: 't' + r.tick + '  ' + r.from }),
          el('span', { style: 'white-space:normal' }, '“' + r.text + '”'),
        ]);
      }))
      : miss('nothing was said between the handshake and the deed',
        'The reel is assembled from PARTIES-tier negotiation, declassified at settlement. No agent in ' +
        'this world has yet used it, so there are no words to re-read. Inventing one would be a libel ' +
        'against a real principal, so the band stays empty.'),
      'PARTIES · DECLASSIFIED AT SETTLEMENT', !(s.receiptReel || []).length));

    // 3 — THE SEAL
    var v = s.sealVerdict;
    reel.appendChild(band('3', 'THE SEAL', v
      ? el('div', { style: 'display:flex;align-items:center;gap:16px' }, [
        U.mark(v === 'CONTRADICTED' ? 'SEAL_BROKEN' : 'SEAL_KEPT', true),
        el('span', { class: 'verdict' + (v === 'CONTRADICTED' ? '' : ' ok'), text: v }),
        s.sealContradictedBy ? el('span', { style: 'color:var(--dim)' }, ['by ', hOf(D, 'p:' + s.sealContradictedBy, s.sealContradictedBy)]) : null,
      ])
      : miss('no seal on this beat',
        'A sealed intention reveals one Reckoning later. This beat carries no verdict, which means no ' +
        'intention was sealed against it.'), null, !v));

    // 4 — THE DEED, with the map rail the mock puts beside it. `R.map` is 30
    // rows on the frame and the stage of the deed is one of them: the rail
    // answers "where did this happen" without a second screen, and it is what
    // was filling the 720x272 of void under this band.
    function stageRail(stage) {
      var sys = (R.map || []).slice();
      if (!sys.length) return null;
      var S2 = U.svg, cols2 = 6, cw = 30, ch = 22;
      var rowsN = Math.ceil(sys.length / cols2);
      var kids2 = [];
      sys.sort(function (a, b) { return a.id.localeCompare(b.id); }).forEach(function (sy, i) {
        var cxx = (i % cols2) * cw + cw / 2, cyy = ((i / cols2) | 0) * ch + ch / 2;
        var on = sy.id === stage;
        var r2 = 7;
        var pts = [];
        for (var k2 = 0; k2 < 6; k2++) {
          var a2 = Math.PI / 6 + (k2 * Math.PI) / 3;
          pts.push((cxx + r2 * Math.cos(a2)).toFixed(1) + ',' + (cyy + r2 * Math.sin(a2)).toFixed(1));
        }
        kids2.push(S2('polygon', {
          points: pts.join(' '), fill: on ? '#19d7f2' : '#06222c',
          stroke: on ? '#19d7f2' : '#123038', 'stroke-width': 1,
        }, S2('title', { text: sy.name + ' · ' + sy.id + ' · ' + sy.tier })));
        if (on) {
          kids2.push(S2('text', {
            x: cxx, y: cyy + r2 + 10, 'text-anchor': 'middle', fill: '#19d7f2',
            style: 'font:9px ui-monospace,monospace', text: sy.id,
          }));
        }
      });
      return U.el('div', { style: 'flex:0 0 auto;padding-left:14px' }, [
        U.el('div', { style: 'font:9px "Roboto Condensed",sans-serif;letter-spacing:.16em;color:var(--dimmer);margin-bottom:5px', text: 'WHERE' }),
        S2('svg', {
          width: cols2 * cw, height: rowsN * ch + 12,
          viewBox: '0 0 ' + cols2 * cw + ' ' + (rowsN * ch + 12),
        }, kids2),
      ]);
    }

    reel.appendChild(band('4', 'THE DEED', el('div', { style: 'display:flex;gap:18px;align-items:center' }, [
      s.glyph ? U.glyph(s.glyph, 74) : null,
      el('div', { style: 'min-width:0' }, [
        el('div', { style: 'font-size:14px;line-height:1.5;white-space:normal;color:' + (s.defaulted ? 'var(--red-text)' : 'var(--text)'), text: s.deed }),
        // `deed` already ends with `consequence` in every segment measured, so
        // printing both put the same sentence on the hero panel twice
        (s.consequence && (s.deed || '').indexOf(s.consequence) < 0)
          ? el('div', { style: 'font-size:11px;color:var(--dim);margin-top:7px;white-space:normal', text: s.consequence })
          : null,
        el('div', { style: 'display:flex;gap:8px;margin-top:9px;align-items:center' },
          (s.cast || []).map(function (c) {
            return el('span', {
              style: 'display:flex;align-items:center;gap:6px;border:1px solid var(--rule);padding:2px 7px 2px 3px',
              title: c.line,
            }, [U.crest(c.principal, 18), el('span', { style: 'font-size:11px;color:var(--cyan)', text: c.handle })]);
          })),
      ]),
      el('div', { style: 'margin-left:auto;text-align:right' }, [
        el('div', { style: 'font:400 30px var(--mono);color:' + (s.defaulted ? 'var(--red-text)' : 'var(--cyan)'), text: U.n(s.atStake) }),
        el('div', { style: 'font:9px var(--cond);letter-spacing:.16em;color:var(--dimmer)', text: 'AT STAKE' }),
      ]),
      stageRail(s.glyph && s.glyph.stage),
    ])));
    return reel;

    /**
     * `band(no, title, body, q, null)` — a null act collapses.
     *
     * THE GRANT and THE WORDS are `null` on every segment of every world this
     * repo has produced, and at equal billing they took 350 of the reel's
     * 780px: half the ceremony was an apology, at the same size as the deed.
     * The honesty is not negotiable — but a one-line strip is as honest as a
     * paragraph and it gives the space back to the thing that actually happened.
     */
    function band(no, title, body, q, isNull) {
      return el('div', { class: 'band' + (isNull ? ' nul' : '') }, [
        el('div', { class: 'no', text: no }),
        el('div', { class: 'bd' }, [
          el('div', { class: 'bt' }, [title, q ? el('span', { class: 'q', text: '  ' + q }) : null]),
          body,
        ]),
      ]);
    }
    function miss(say, why) {
      return el('div', { style: 'display:flex;gap:11px;align-items:flex-start;padding:2px 0' }, [
        el('span', { style: 'width:11px;height:11px;border:1px solid var(--rule-bright);flex:0 0 11px;margin-top:2px' }),
        el('div', null, [
          el('div', { style: 'font:600 10px var(--cond);letter-spacing:.16em;color:var(--dim);text-transform:uppercase', text: say }),
          el('div', { style: 'font-size:10px;color:var(--dimmer);line-height:1.65;margin-top:4px;white-space:normal;max-width:62ch', html: why }),
        ]),
      ]);
    }
  }

  /** Frame fields this client wants and the engine does not publish. */
  var MISSING = [
    ['map[].constellationName', 'The frame publishes `con-1`…`con-4`. The mock series invented HEARTH / THRESHOLD / MARROW / VANE, and `MARROW` collides with the live handle `p:marrow`. The map draws the ids.'],
    ['StandingRow.hands / handStates', 'The mocks show a HANDS strip (IDLE · IN TRANSIT · COMMITTED · RECOVERING). No frame key carries a hand roster, so the dossier cannot draw one.'],
    ['a principal-scoped read', 'Every key is a world-scoped array capped for broadcast, so a full character sheet cannot be assembled for a principal that missed tonight\'s cut.'],
    ['CastChip.crest / sigil', 'Crests are assigned by hashing the principal id into a generated 4×4 plate. Stable and deterministic, but it is the client\'s choice, not the world\'s.'],
    ['rundown[].receiptReel content', 'The field exists and is `null` on every segment of every world measured. The reel needs a cast that talks.'],
  ];

  return {
    overview: overview, principals: principals, ventures: ventures, grants: grants,
    market: market, map: mapScreen, standings: standings, reckoning: reckoning,
    MISSING: MISSING,
  };
})();
