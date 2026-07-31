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
    var phases = [
      ['EARLY', 0, 144], ['COMMITMENT', 144, 240], ['FREEZE', 240, 276], ['SETTLING', 276, 288],
    ];
    function yOf(t) { return TOP + (1 - t / TOTAL) * (H - TOP * 2); }
    var kids = [S('rect', { x: X, y: TOP, width: BAR, height: H - TOP * 2, fill: '#00090e', stroke: '#123038' })];
    phases.forEach(function (p) {
      var on = L && L.phase === p[0];
      var y0 = yOf(p[2]), y1 = yOf(p[1]);
      if (on) kids.push(S('rect', { x: X, y: y0, width: BAR, height: y1 - y0, fill: 'rgba(25,215,242,.16)' }));
      kids.push(S('line', { x1: X, y1: y0, x2: X + BAR + 6, y2: y0, stroke: '#123038' }));
      kids.push(S('text', {
        x: X + BAR + 11, y: (y0 + y1) / 2 + 3, fill: on ? '#19d7f2' : '#3f5158',
        style: 'font:9px "Roboto Condensed",sans-serif;letter-spacing:.16em', text: p[0],
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

  var KIND_SW = {
    venture: 'cy', raid: 'rd', convoy: 'cyd', claim: 'am', works: 'gy',
    sap: 'am', front: 'am', grant: 'cyd', tribute: 'cy', battle: 'rd',
  };

  // ═══════════════════════════════════════════════════════════ OVERVIEW ══
  function overview(host, D) {
    var R = D.R, L = D.L, M = (R && R.meters) || {};
    var rows = liveRows(D);
    var stack = el('div', { class: 'rows fill', style: 'height:100%' });

    stack.appendChild(el('div', { class: 'tiles' }, [
      tile('TICK', L ? String(L.tick) : '—', { note: L ? 'phase ' + L.phase : 'live frame not read' }),
      tile('UNTIL THE RECKONING', L ? String(L.ticksUntilReckoning) : '—',
        { note: L ? U.clock(L.ticksUntilReckoning) + ' at 300s/tick' : null, dim: !L }),
      tile('ON A PROMISE', U.n((L && L.meters ? L.meters.onAPromise : M.onAPromise)),
        { note: 'minor riding on nothing but a word' }),
      tile('KEPT', U.n(M.kept), { note: 'settled elective halves honoured' }),
      // The ONE red tile. `broken` is the only meter that counts a broken word.
      tile('BROKEN', U.n(M.broken), { bad: (M.broken || 0) > 0, note: 'defaults on the record' }),
      // Amber, not red: a shortfall is value at risk, and nobody has lied yet.
      tile('LEVY SHORT', U.n(M.levyShort),
        { warn: (M.levyShort || 0) > 0, note: 'no single principal can lower this' }),
      tile('UNREFINED', U.n(M.unrefined), { note: 'yield nobody has made payable', neutral: true }),
    ]));

    var main = el('div', { class: 'grid', style: 'grid-template-columns:1fr 250px;flex:1 1 auto;min-height:0' });
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
    ];
    main.appendChild(panel('THE WORLD, RIGHT NOW', {
      sub: rows.length + ' live rows · click a column to sort',
      right: L ? el('span', null, [el('i', { class: 'pip' }), ' tick ' + L.tick]) : null,
    }, rows.length ? table('ov', cols, rows, {
      sort: 'stake', dir: -1, rerender: D.rerender,
      rowClass: function (r) { return r.alert === 'red' ? 'bad' : r.alert === 'amber' ? 'warn' : ''; },
    })
      : empty('the world is quiet',
        'Nothing is live at this tick. Ventures, raids, convoys and claims all appear here the moment ' +
        'they exist. If this stays empty across several ticks the sim is not running.')));

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

    stack.appendChild(panel('THE TICKER', { sub: 'the export surface · 140 chars, bounded' },
      (D.ticker.length ? el('div', { class: 'log' }, D.ticker.slice(0, 60).map(function (t) {
        return el('div', { class: 'ln' + (/default|failed|raid|arrears/i.test(t) ? ' bad' : '') }, [
          el('span', { class: 'tk', text: 't' + (L ? L.tick : R.tick) }),
          el('span', { class: 'de', text: t }),
        ]);
      })) : empty('no ticker lines', 'The ticker is empty on both frames.'))
    , { style: 'flex:0 0 168px' }));
    U.clear(host).appendChild(stack);
  }

  // ═════════════════════════════════════════════════════════ PRINCIPALS ══
  function principals(host, D, sel) {
    var R = D.R, list = (R.standings || []).slice();
    if (!list.length) {
      U.clear(host).appendChild(panel('PRINCIPALS', { sub: 'standings[]' }, empty('no standings yet',
        '<code>standings[]</code> is published on the <b>Reckoning</b> frame. This world has not settled ' +
        'a Reckoning, so no principal has a public record to show.')));
      return;
    }
    list.sort(function (a, b) { return b.electiveHonouredValue - a.electiveHonouredValue; });
    var cur = list.filter(function (r) { return U.handleOf(r.principal) === sel; })[0] || list[0];

    var wrap = el('div', { class: 'grid', style: 'grid-template-columns:214px 1fr;height:100%' });
    var lst = panel('PRINCIPALS', { sub: list.length + ' on the record' },
      el('div', null, list.map(function (r) {
        var on = r.principal === cur.principal;
        return el('div', {
          style: 'display:flex;align-items:center;gap:8px;padding:5px 8px;cursor:pointer;' +
            'border-bottom:1px solid var(--rule-dim);' + (on ? 'background:var(--cyan-wash-2)' : ''),
          on: { click: function () { location.hash = '#/principals/' + U.handleOf(r.principal); } },
        }, [
          U.crest(r.principal, 22),
          el('div', { style: 'min-width:0;flex:1' }, [
            el('div', {
              style: 'color:' + (r.defaults ? 'var(--red-text)' : 'var(--cyan)') + ';font-size:12px',
              text: r.handle,
            }),
            el('div', { style: 'font-size:9px;color:var(--dim)' },
              r.electiveHonoured + ' kept · ' + r.defaults + ' broken'),
          ]),
          r.defaults ? el('span', { class: 'tag rd', text: String(r.defaults) }) : null,
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
            style: 'font:400 44px/1 var(--mono);letter-spacing:-.02em;color:' + (bad ? 'var(--red-text)' : 'var(--text)'),
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

    var missing = el('div', { class: 'note-line' });
    missing.innerHTML = '<b>What the frame cannot tell you about ' + r.handle + ':</b> hands and their states, ' +
      'STORES balances, syndicate membership, and the full venture history. There is <b>no principal-scoped read</b> — ' +
      'every key is a world-scoped array capped for broadcast, so this page shows the rows that happened to be ' +
      'selected, not the character sheet.';
    stack.appendChild(missing);
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
      tile('ON A PROMISE', U.n(links.reduce(function (a, c) { return a + (c.atStake || 0) * (c.electiveBps || 0) / 10000; }, 0)),
        { note: 'sum of the elective halves on screen' }),
    ]));

    var g2 = el('div', { class: 'grid', style: 'grid-template-columns:1fr 330px;flex:1 1 auto;min-height:0' });
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
          style: 'width:70px;text-align:center', title: g.venture,
        }, [
          U.glyph(g, 52),
          el('div', { style: 'font-size:9px;color:var(--dim);margin-top:3px', text: U.bps(g.electiveBps) }),
          el('div', {
            style: 'font-size:8px;color:' + (g.state === 'SNAPPED_BLACK' ? 'var(--red-text)' : 'var(--dimmer)'),
            text: g.state.replace('_GOLD', '').replace('_BLACK', ''),
          }),
        ]);
      }) : empty('no rings to draw', 'Neither frame carries a <code>glyphs[]</code> row.'));
    g2.appendChild(panel('★ THE VENTURE RING', {
      sub: 'the hollow arc is the part riding on someone\'s word',
      foot: 'deep arc = escrowed, auto-executes · bright arc = elective, can simply not be paid · pulsing socket = an unfilled role',
    }, wall));
    stack.appendChild(g2);

    var docket = R.docket || [];
    stack.appendChild(panel('THE DOCKET', { sub: 'tonight\'s cards, stakes descending · cap 7' },
      docket.length ? el('div', { style: 'display:flex;gap:6px;padding:6px;overflow:auto' }, docket.map(function (c) {
        return el('div', { style: 'flex:0 0 260px;border:1px solid var(--rule);background:var(--panel-2);padding:8px' }, [
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
        'settled by then. Measured at <b>2 cards across 9 frames</b> against a budget of 7.')
    , { style: 'flex:0 0 150px' }));
    U.clear(host).appendChild(stack);
  }

  // ═════════════════════════════════════════════════════════════ GRANTS ══
  function grants(host, D) {
    var lines = D.authority;
    var stack = el('div', { class: 'rows fill', style: 'height:100%' });
    var drawn = lines.filter(function (a) { return a.state === 'DRAWN' || a.spent > 0 || a.spentContingent > 0; });
    stack.appendChild(el('div', { class: 'tiles' }, [
      tile('GRANTS ON FRAME', String(lines.length), { note: 'cap 12 — the frame shows the biggest, not all' }),
      tile('DRAWN ON', String(drawn.length), { note: 'a delegate has acted in its grantor\'s name' }),
      tile('MAX DIRECT LOSS', U.n(lines.reduce(function (a, x) { return Math.max(a, x.granted || 0); }, 0)),
        { note: 'the largest single LIMIT on screen' }),
      tile('MAX CONTINGENT', U.n(lines.reduce(function (a, x) { return Math.max(a, x.grantedContingent || 0); }, 0)),
        { note: 'the worst case, shown before it was signed' }),
      tile('DOSSIER THREADS', String(lines.reduce(function (a, x) { return a + (x.dossiers || []).length; }, 0)),
        { note: 'compartmented authority handed downstream' }),
    ]));

    var g2 = el('div', { class: 'grid', style: 'grid-template-columns:1fr 1fr;flex:1 1 auto;min-height:0' });
    var cols = [
      { k: 'grant', t: 'grant', w: '112px', cell: function (a) { return el('span', { class: 'dim', text: a.grant }); } },
      { k: 'grantor', t: 'grantor', w: '90px', cell: function (a) { return hOf(D, a.grantor); } },
      { k: 'delegate', t: 'delegate', w: '90px', cell: function (a) { return hOf(D, a.delegate); } },
      { k: 'granted', t: 'direct', w: '80px', num: true, cell: function (a) { return U.n(a.granted); } },
      { k: 'spent', t: 'spent', w: '72px', num: true, cell: function (a) { return a.spent ? U.n(a.spent) : el('span', { class: 'dim', text: '0' }); } },
      { k: 'grantedContingent', t: 'contingent', w: '84px', num: true, cell: function (a) { return U.n(a.grantedContingent); } },
      { k: 'clearance', t: 'clearance', w: '68px', cell: function (a) { return U.pips(a.clearance); } },
      { k: 'boundVentures', t: 'bound', w: '54px', num: true },
      { k: 'dossiers', t: 'threads', w: '58px', num: true, cell: function (a) { return String((a.dossiers || []).length); }, sort: function (a) { return (a.dossiers || []).length; } },
      { k: 'state', t: 'state', w: '82px', cell: function (a) { return U.tag(a.state, a.state === 'DRAWN' ? 'solid' : a.state === 'REVOKED' ? 'rd' : 'cy'); } },
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
      sub: 'compartmented authority handed on',
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

  /** grantor → delegate, laid out in two columns. The mock's centre panel. */
  function authorityGraph(D, lines) {
    var W = 520, H = 300, S = U.svg;
    var grantors = [], delegates = [];
    lines.forEach(function (a) {
      if (grantors.indexOf(a.grantor) < 0) grantors.push(a.grantor);
      if (delegates.indexOf(a.delegate) < 0) delegates.push(a.delegate);
    });
    grantors.sort(); delegates.sort();
    var maxL = lines.reduce(function (m, a) { return Math.max(m, a.granted + a.grantedContingent); }, 1);
    function y(i, n) { return 26 + (H - 52) * (n > 1 ? i / (n - 1) : 0.5); }
    var kids = [];
    lines.forEach(function (a) {
      var x1 = 96, y1 = y(grantors.indexOf(a.grantor), grantors.length);
      var x2 = W - 96, y2 = y(delegates.indexOf(a.delegate), delegates.length);
      var w = 0.6 + 3.4 * ((a.granted + a.grantedContingent) / maxL);
      var drawn = a.state === 'DRAWN';
      kids.push(S('path', {
        d: 'M' + x1 + ' ' + y1 + 'C' + (x1 + 90) + ' ' + y1 + ',' + (x2 - 90) + ' ' + y2 + ',' + x2 + ' ' + y2,
        fill: 'none', 'stroke-width': w.toFixed(2),
        stroke: a.state === 'REVOKED' ? '#ca010f' : drawn ? '#19d7f2' : '#0a6a7d',
        'stroke-opacity': drawn ? 1 : 0.55,
      }, S('title', {
        text: U.handleOf(a.grantor) + ' → ' + U.handleOf(a.delegate) + ' · MAX DIRECT LOSS ' +
          U.n(a.granted) + ' · MAX CONTINGENT ' + U.n(a.grantedContingent) + ' · ' + a.state,
      })));
    });
    grantors.forEach(function (p, i) {
      var yy = y(i, grantors.length);
      kids.push(S('circle', { cx: 96, cy: yy, r: 4, fill: '#00060a', stroke: '#19d7f2', 'stroke-width': 1.2 }));
      kids.push(S('text', {
        x: 86, y: yy + 3.5, 'text-anchor': 'end', fill: '#cfdadd',
        style: 'font:10px ui-monospace,monospace', text: U.handleOf(p),
      }));
    });
    delegates.forEach(function (p, i) {
      var yy = y(i, delegates.length);
      kids.push(S('circle', { cx: W - 96, cy: yy, r: 4, fill: '#00060a', stroke: '#19d7f2', 'stroke-width': 1.2 }));
      kids.push(S('text', {
        x: W - 86, y: yy + 3.5, fill: '#cfdadd',
        style: 'font:10px ui-monospace,monospace', text: U.handleOf(p),
      }));
    });
    kids.push(S('text', { x: 96, y: 13, 'text-anchor': 'end', fill: '#3f5158', style: 'font:9px sans-serif;letter-spacing:.16em', text: 'GRANTOR' }));
    kids.push(S('text', { x: W - 96, y: 13, fill: '#3f5158', style: 'font:9px sans-serif;letter-spacing:.16em', text: 'DELEGATE' }));
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

    var g2 = el('div', { class: 'grid g-2', style: 'flex:1 1 auto;min-height:0' });
    g2.appendChild(panel('★ THE PRINT', {
      sub: 'a price on a place, and the gap to everywhere else',
      foot: 'premium is the gap to the galaxy VWAP — the field the signature exists for',
    }, ml.length ? table('mk', [
      { k: 'good', t: 'good', w: '92px', cell: function (m) { return el('span', null, [U.goodIcon(m.good), m.good]); } },
      { k: 'venue', t: 'venue', w: '120px', cell: function (m) { return U.sysLink(m.venue, m.venue + ' ' + sysName(D, m.venue)); } },
      { k: 'lastPrice', t: 'last', w: '60px', num: true },
      { k: 'vwap', t: 'vwap', w: '60px', num: true },
      { k: 'galaxyVwap', t: 'galaxy', w: '64px', num: true },
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
      { k: 'legend', t: 'legend' },
    ], ml, { sort: 'volume', dir: -1, rerender: D.rerender })
      : empty('nothing has printed',
        '<code>marketLines[]</code> is empty. A print appears when two principals trade at a venue; the measured ' +
        'reading in a heuristic world is <b>7 rows across 9 frames, <code>alloy</code> only</b>, with ' +
        '<code>premiumBps</code> zero on all seven.')));

    g2.appendChild(panel('WORKS · what the ground yields', {
      sub: wl.length + ' rows · ★ a WORKS marks a system',
    }, wl.length ? table('wk', [
      { k: 'system', t: 'at', w: '116px', cell: function (w) { return U.sysLink(w.system, w.system + ' ' + sysName(D, w.system)); } },
      { k: 'holder', t: 'holder', w: '92px', cell: function (w) { return hOf(D, w.holder); } },
      { k: 'yieldPerTick', t: 'yield/tick', w: '74px', num: true },
      { k: 'sharePerTick', t: 'share/tick', w: '78px', num: true },
      { k: 'occupants', t: 'occupants', w: '74px', num: true },
      { k: 'extracted', t: 'extracted', w: '82px', num: true, cell: function (w) { return U.n(w.extracted); } },
      { k: 'rentPaid', t: 'rent paid', w: '76px', num: true, cell: function (w) { return w.rentPaid ? U.n(w.rentPaid) : el('span', { class: 'dim', text: '0' }); } },
      { k: 'legend', t: 'state', w: '96px', cell: function (w) { return U.tag(w.legend, 'cy'); } },
    ], wl, { sort: 'yieldPerTick', dir: -1, rerender: D.rerender })
      : empty('nobody is extracting', 'No <code>worksLines[]</code> row on this frame.')));
    stack.appendChild(g2);

    // the hull ladder — the generated plate, used as itself
    stack.appendChild(panel('THE HULL LADDER', {
      sub: 'PIKE · LANCE · WARDEN · BULWARK · CITADEL',
      right: el('span', { class: 'pill', text: 'not on the frame' }),
      foot: 'Reference art. No frame key publishes a hull inventory, so nothing here is a claim about this world.',
    }, el('div', { style: 'padding:6px;background:var(--void)' },
      el('img', { src: 'assets/hulls.webp', class: 'plate', alt: 'the five hulls' })),
    { style: 'flex:0 0 220px' }));
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

    var legend = el('div', { class: 'legend' });
    [['#93a6aa', 'THE COMMONS', 'hostile action is INVALID'],
     ['#2c6b78', 'THE MARCHES', 'contested ground'],
     ['#35808f', 'THE FRONTIER', 'the rim, the prize']].forEach(function (r) {
      legend.appendChild(el('div', { class: 'row' }, [
        el('i', { class: 'sw', style: 'background:' + r[0] }), r[1],
        el('span', { style: 'color:var(--dimmer);margin-left:6px', text: r[2] }),
      ]));
    });
    legend.appendChild(el('hr'));
    [['◯', 'var(--cyan)', 'node size = THE LODE'],
     ['≻≺', 'var(--cyan-deep)', 'waist = a strait, notched with its detour'],
     ['▮', 'var(--red-text)', 'door = a SEVERING strait'],
     ['◠', 'var(--cyan)', 'one continuous outline = THE VERGE'],
     ['◌', 'var(--amber)', 'dashed ring = the ground yields fuel'],
     ['✕', 'var(--red-text)', 'THE RUIN — permanent'],
     ['△', 'var(--cyan-mid)', 'a WORKS marks the system']].forEach(function (r) {
      legend.appendChild(el('div', { class: 'row' }, [
        el('b', { style: 'color:' + r[1] + ';display:inline-block;width:16px', text: r[0] }), r[2],
      ]));
    });
    legend.appendChild(el('hr'));
    legend.appendChild(el('div', { class: 'row', style: 'color:var(--dimmer);white-space:normal;line-height:1.6' },
      'A handle on a VERGE is drawn red when that principal has a default on the record.'));

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
              style: 'margin:0;background:' + ({ COMMONS: '#93a6aa', MARCHES: '#2c6b78', FRONTIER: '#35808f' })[s.tier],
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
    side.appendChild(panel('INSPECT', null, inspect, { style: 'flex:0 0 auto;max-height:290px' }));
    side.appendChild(panel('LEGEND', null, legend, { style: 'flex:0 0 auto' }));
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
    if (!rows.length) {
      stack.appendChild(panel('STANDINGS', { sub: 'standings[]' }, empty('no standings yet',
        'The public directory a counterparty is priced from is published at settlement. ' +
        'This world has not settled a Reckoning.')));
      U.clear(host).appendChild(stack);
      return;
    }
    var g = el('div', { class: 'grid', style: 'grid-template-columns:1fr 340px;flex:1 1 auto;min-height:0' });
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
        k: 'defaults', t: 'defaults', w: '86px', num: true,
        cell: function (r) {
          return r.defaults
            ? el('span', { style: 'color:var(--red-text);font-weight:600', text: String(r.defaults) })
            : el('span', { class: 'dim', text: '0' });
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
      rowClass: function (r) { return r.defaults > 0 ? 'bad' : ''; },
      onRow: function (r) { location.hash = '#/principals/' + U.handleOf(r.principal); },
    })));

    var side = el('div', { class: 'rows', style: 'min-height:0' });
    side.appendChild(panel('THE HALL OF FAME', { sub: 'over the world\'s whole life' },
      (R.hallOfFame || []).length
        ? el('div', null, (R.hallOfFame || []).map(function (f) {
          var bad = /BROKEN/.test(f.title);
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
    side.appendChild(panel('THE SHAPE OF IT', { sub: 'this frame' }, el('div', null, [
      U.kv('PRINCIPALS', String(rows.length)),
      U.kv('NEVER BROKEN', String(clean)),
      U.kv('WITH A DEFAULT', String(rows.length - clean), rows.length - clean > 0),
      U.kv('ELECTIVE HALVES KEPT', U.n(kept)),
      U.kv('DEFAULTS ON THE RECORD', U.n(broke), broke > 0),
      el('div', { class: 'note-line' },
        'Gate 3 measured 12% of settled elective promises broken, unprompted. Neither zero — which would have ' +
        'made trust worthless — nor universal, which would make the elective half a fee.'),
    ])));
    g.appendChild(side);
    stack.appendChild(g);
    U.clear(host).appendChild(stack);
  }

  // ══════════════════════════════════════════════════════════ RECKONING ══
  function reckoning(host, D, sel) {
    var R = D.R;
    if (!R || R.reckoningIndex === undefined || !(R.rundown || []).length) {
      U.clear(host).appendChild(panel('THE RECKONING', { sub: 'the ceremony' }, empty('the first Reckoning has not happened',
        'A Reckoning frame is published once per <b>288 ticks</b>. ' +
        (D.L ? 'This world is at tick <b>' + D.L.tick + '</b> and settles in <b>' + D.L.ticksUntilReckoning +
          '</b> ticks — about ' + U.clock(D.L.ticksUntilReckoning) + ' at 300 s a tick.' : '') +
        ' Until then there is no rundown, no Levy and no hall of fame, and drawing one would be a fabrication.')));
      return;
    }
    var M = R.meters || {}, rd = (R.rundown || []).slice().sort(function (a, b) { return a.order - b.order; });
    var cur = rd.filter(function (s) { return String(s.order) === String(sel); })[0] ||
      rd.filter(function (s) { return s.defaulted; })[0] || rd[rd.length - 1];

    var stack = el('div', { class: 'rows fill', style: 'height:100%' });

    // E6 broadcast scale — the ceremony's headline row
    stack.appendChild(el('div', { class: 'hero' }, [
      el('div', null, [el('div', { class: 'big' + ((M.levyShort || 0) > 0 ? ' bad' : ''), text: U.n(M.levyShort) }), el('div', { class: 'lab', text: 'LEVY SHORT' })]),
      el('div', { style: 'width:1px;align-self:stretch;background:var(--rule)' }),
      el('div', null, [el('div', { class: 'big', text: U.n(M.onAPromise) }), el('div', { class: 'lab', text: 'ON A PROMISE' })]),
      el('div', { style: 'width:1px;align-self:stretch;background:var(--rule)' }),
      el('div', null, [
        el('div', { class: 'big' }, [
          String(M.kept),
          el('span', { style: 'color:var(--dimmer)', text: ' – ' }),
          el('span', { style: 'color:' + (M.broken ? 'var(--red-text)' : 'var(--cyan)'), text: String(M.broken) }),
        ]),
        el('div', { class: 'lab', text: 'KEPT — BROKEN' }),
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
    var lp = el('div', { class: 'rows', style: 'min-height:0' });
    lp.appendChild(panel('THE LEVY', {
      sub: tl.length + ' tribute lines',
      alarm: (M.levyShort || 0) > 0,
      foot: 'SOLID a hand is en route · DASHED no hand assigned · RED unpaid at the freeze · REVERSING a seizure',
    }, tl.length ? el('div', null, tl.map(function (t) {
      var col = t.state === 'RED' ? 'var(--red)' : t.state === 'DASHED' ? 'var(--dim)' : t.state === 'REVERSING' ? 'var(--amber)' : 'var(--cyan-deep)';
      return el('div', { style: 'display:flex;align-items:center;gap:8px;padding:2.5px 8px;border-bottom:1px solid var(--rule-dim)' }, [
        el('span', { style: 'width:78px;flex:0 0 78px' }, hOf(D, t.principal)),
        el('span', {
          style: 'flex:1 1 auto;height:1px;background:' + (t.state === 'DASHED'
            ? 'repeating-linear-gradient(90deg,' + col + ' 0 4px,transparent 4px 8px)' : col),
        }),
        el('span', { style: 'font-size:9px;color:var(--dim);width:52px;text-align:right', text: t.to }),
        el('span', {
          style: 'width:70px;text-align:right;font-variant-numeric:tabular-nums;color:' +
            (t.owed ? 'var(--red-text)' : 'var(--dim)'),
          text: t.owed ? U.n(t.owed) + ' owed' : 'clear',
        }),
      ]);
    })) : empty('no tribute line', 'Nobody owes the Levy on this frame.')));
    lp.appendChild(panel('THE HALL OF FAME', { sub: '4 titles' },
      (R.hallOfFame || []).length ? el('div', null, (R.hallOfFame || []).map(function (f) {
        var bad = /BROKEN/.test(f.title);
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
      : miss('no grant bound this deed',
        'The frame carries <code>rundown[].grant</code>, and it is <code>null</code> here. Either no delegated ' +
        'authority was used, or the venture was not bound to a grant.')));

    // 2 — THE WORDS
    reel.appendChild(band('2', 'THE WORDS', (s.receiptReel || []).length
      ? el('div', null, (s.receiptReel || []).map(function (r) {
        return el('div', { class: 'said' }, [
          el('span', { class: 'who', text: 't' + r.tick + '  ' + r.from }),
          el('span', { style: 'white-space:normal' }, '“' + r.text + '”'),
        ]);
      }))
      : miss('nobody spoke',
        '<code>receiptReel[]</code> is <code>null</code>. The reel is assembled from <b>PARTIES</b>-tier ' +
        'negotiation, declassified at settlement — and no cast in this repo has ever produced one. ' +
        'The path is real and tested; the words are simply not there, and inventing one would be a libel.'),
      'PARTIES · DECLASSIFIED AT SETTLEMENT'));

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
        'intention was sealed against it.')));

    // 4 — THE DEED
    reel.appendChild(band('4', 'THE DEED', el('div', { style: 'display:flex;gap:18px;align-items:center' }, [
      s.glyph ? U.glyph(s.glyph, 74) : null,
      el('div', { style: 'min-width:0' }, [
        el('div', { style: 'font-size:14px;line-height:1.5;white-space:normal;color:' + (s.defaulted ? 'var(--red-text)' : 'var(--text)'), text: s.deed }),
        el('div', { style: 'font-size:11px;color:var(--dim);margin-top:7px;white-space:normal', text: s.consequence }),
        el('div', { style: 'display:flex;gap:8px;margin-top:9px;align-items:center' },
          (s.cast || []).map(function (c) {
            return el('span', {
              style: 'display:flex;align-items:center;gap:6px;border:1px solid var(--rule);padding:2px 7px 2px 3px',
              title: c.line,
            }, [U.crest(c.principal, 18), el('span', { style: 'font-size:11px;color:var(--cyan)', text: c.handle })]);
          })),
      ]),
      el('div', { style: 'margin-left:auto;text-align:right' }, [
        el('div', { style: 'font:400 24px var(--mono);color:' + (s.defaulted ? 'var(--red-text)' : 'var(--cyan)'), text: U.n(s.atStake) }),
        el('div', { style: 'font:9px var(--cond);letter-spacing:.16em;color:var(--dimmer)', text: 'AT STAKE' }),
      ]),
    ])));
    return reel;

    function band(no, title, body, q) {
      return el('div', { class: 'band' }, [
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
