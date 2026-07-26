## Verdict

Draft 1 is not ready as a spectacle design. It specifies mechanics and static signatures, but not a show. Two signatures—the global depth chart and Charge fuel gauge—also expose strategically valuable information.

### Severity-ranked failures

1. **Critical — none of the four systems reaches the viewer as a timed event.** `ReckoningFrame` has no market, claim, Charge, work, raid, charter, or before/after fields; every rundown segment must be a venture. The client replaces the entire page with meters, cards, authority rows, and ticker at once. There is no map, playback clock, camera target, countdown, or animation. [Frame contract](/Users/shehryarsaroya/Projects/thecompact/engine/src/frames/contract.ts:169), [client render](/Users/shehryarsaroya/Projects/thecompact/client/index.html:334)

   **Fix:** add a discriminated broadcast beat:

   `MARKET_MOVE | CLAIM_ASSESSMENT | AUTHORITY_ACT | WORK_CONTEST | VENTURE`

   Each beat needs source event IDs, cast, public stakes, before/deed/after states, consequence, safe visual payload, and timed reveal cues. Keep the static-frame architecture; play the settled manifest locally.

2. **Critical — the Charge fuel gauge is a scouting oracle.** “Reckonings of Charge remaining” is computed from the public Charge recipe and hidden stockpile. It reveals reserve coverage, likely the limiting good, and convoy contents when the gauge jumps. The draft admits the strategic value: “attack the one at 1,” while simultaneously claiming stockpiles and inbound contents remain `SENSED`. [Gauge](/Users/shehryarsaroya/Projects/thecompact/docs/design/expansion-2026-07-25/DRAFT-1-four-systems.md:123), [hidden inputs](/Users/shehryarsaroya/Projects/thecompact/docs/design/expansion-2026-07-25/DRAFT-1-four-systems.md:128)

   **Fix:** show only public legal state: `PAID`, `ARREARS 1/2`, `NEXT MISS LAPSES`, amount due, deadline, and bond at risk. If a literal gauge is essential, create a dedicated, irrevocably committed, explicitly `PUBLIC` Charge reserve; never derive it from general stores.

3. **Critical — A9 is not actually structural at the frame boundary.** Despite the comments, `reckoningFrame()` reads holdings and the grant book directly rather than consuming a typed public-facts projection. The proposed “spectator subset of the union of agent filters” test is also too weak: a union can combine Alice’s sensed cargo with Bob’s sensed survey into a god-view no single agent possesses. [Runtime frame builder](/Users/shehryarsaroya/Projects/thecompact/engine/src/sim/runtime.ts:4135), [union test requirement](/Users/shehryarsaroya/Projects/thecompact/docs/design/SPEC.md:685)

   Worse, the nightly frame contract permits `sealContent`, and the browser prints it. Section 11.2 permits only the verdict at Reckoning; content waits for the season replay. It does not leak today only because runtime supplies `null`. [Contract](/Users/shehryarsaroya/Projects/thecompact/engine/src/frames/contract.ts:173), [client](/Users/shehryarsaroya/Projects/thecompact/client/index.html:257), [correct tier](/Users/shehryarsaroya/Projects/thecompact/docs/design/SPEC.md:462)

   **Fix:** build nightly frames solely from a `PUBLIC`/properly declassified projection. Remove `sealContent` from `ReckoningFrame`; create a separate season-replay artifact. Test every frame fact against a no-special-intel non-party observation, not a union.

4. **Critical — global live depth contradicts the information model.** Agents currently receive only local market books, while the draft makes every venue’s depth bands public. In a thin book, a “band” can be one hidden order. [Agent payload](/Users/shehryarsaroya/Projects/thecompact/docs/design/SPEC.md:502), [draft visibility](/Users/shehryarsaroya/Projects/thecompact/docs/design/expansion-2026-07-25/DRAFT-1-four-systems.md:74)

   **Fix:** publish post-clear price, cleared volume, and no-trade/staleness status globally. Keep resting depth `SENSED`, coarse, and subject to minimum-contributor suppression. Keep unfilled owner and exact size `PRIVATE` forever. An anonymous clearing account avoids publishing bilateral trade relationships.

5. **High — syndicate and loss signatures omit the event ordering that creates drama.** Permission is not betrayal. The syndicate story is warning accepted → authority exercised → stores move → revocation arrives too late → consequence. Maximum use makes a grant exhausted; it does not itself “snap” the line. Likewise, a work simply disappearing is not spectacle; a named landmark becoming a permanent ruin is. [Draft authority claim](/Users/shehryarsaroya/Projects/thecompact/docs/design/expansion-2026-07-25/DRAFT-1-four-systems.md:160), [works](/Users/shehryarsaroya/Projects/thecompact/docs/design/expansion-2026-07-25/DRAFT-1-four-systems.md:177)

6. **High — the current director can discard its climax.** Defaults sort last and then the first twelve segments are retained, so a busy Reckoning can omit the betrayals deliberately held for the ending. Reserve must-show climax slots first, then fill setup slots. [Ordering and cut](/Users/shehryarsaroya/Projects/thecompact/engine/src/frames/render.ts:217)

   The intended duration is also inconsistent: SPEC says 30–45 minutes, while twelve 30–45-second segments produce 6–9 minutes. The client implements neither. [SPEC](/Users/shehryarsaroya/Projects/thecompact/docs/design/SPEC.md:614), [contract](/Users/shehryarsaroya/Projects/thecompact/engine/src/frames/contract.ts:35)

## What the viewer sees today

The literal timeline is:

- Settlement to the next poll, **0–15 seconds:** the previous static page.
- On the next poll: the entire new page swaps in at once.
- Thereafter: every result remains visible simultaneously and static.

Runtime currently supplies no public lines, seals, negotiation messages, ticker, or tomorrow docket. Therefore cards say “said nothing,” “no seal”; the receipt reel never appears; the ticker says “Quiet.” [Current frame inputs](/Users/shehryarsaroya/Projects/thecompact/engine/src/sim/runtime.ts:4129)

System by system:

- **Market:** nothing. No frame field, chart, clearing-price reveal, or volume.
- **Sovereignty:** nothing Charge-specific. `tributeLines` exist in JSON but the client never renders them.
- **Syndicate:** numeric accounting cards such as “900K drawn of 1M.” No star, topology, motion, or snap. [Authority renderer](/Users/shehryarsaroya/Projects/thecompact/client/index.html:320)
- **Loss:** at best a generic venture sentence and textual “closed gold/snapped black.” No work, target, seeded resolution, destruction, or map change.

That is not “numbers changing during a Reckoning.” For three systems it is **nothing changing**; for syndicates it is a spreadsheet refresh.

## The honest 30–45-second beat for each system

**Market**

- 0–5s: name one good, two venues, and the normal price band.
- 5–12s: replay the public lane closure or flow interruption.
- 12–25s: step through actual clearing points with volume; gaps remain gaps.
- 25–32s: the remote venue’s new price lands beside the unaffected venue.
- 32–40s: named consequence: “Farpoint fuel now costs Halcyon 120K more per Charge.”

This is an interval recap—markets clear per tick—not a fake live auction.

**Sovereignty**

- 0–5s: claimant, system, and “second strike tonight.”
- 5–14s: public Charge, deadline, bond, and visible convoy path; manifest remains unknown.
- 14–22s: assessment closes.
- 22–30s: `PAID` or `MISS`; the arrears pip lands.
- 30–38s: on the second miss, bond burns and claim colour drains.
- 38–45s: “The system is now claimable.”

**Syndicate**

- 0–6s: syndicate, office-holder, victim, and treasury-holding.
- 6–14s: replay the promotion and accepted worst-case warning after declassification.
- 14–24s: delegated act and ledger transfer pulse through the authority line.
- 24–31s: cap exhausts; revocation appears one tick too late.
- 31–40s: show the depleted Charge depot or liability created.

**Loss**

- 0–6s: named work, owner, function, replacement time, and scheduled threat.
- 6–14s: raid ring closes; hidden forces remain explicitly unknown.
- 14–23s: after settlement, reveal only declassified commitments, terrain, and result.
- 23–31s: the work survives gold or fractures into a labelled ruin.
- 31–40s: its capability edge goes dark—market closed, lane exposed, or claim endangered.

## Candlestick and fuel-gauge verdict

The candlestick claim is technically wrong. One uniform price per tick is one point; a tick candle has `open = high = low = close`. An honest candle requires a defined multi-tick aggregation window. No-trade ticks also have no price, and a one-unit print should not visually read like a market collapse.

Use a labelled step trace plus volume and a comparison band: `18 → 47 (+161%), 6 units cleared`. Show two venues diverging on the map. Say “after the lane closed,” not “because,” unless causal event IDs prove it.

The fuel-gauge shape is superficially understandable, but its meaning is not. It can rise through imports and production, depends on several goods, and exposes the very reserve uncertainty that makes blockades strategic. A two-strike public claim clock is both clearer and safer.

## Correct use of the five tiers

- **`PUBLIC`:** clearing price and volume after clear; claim owner, Charge, deadline, paid/missed status, arrears and lapse; charter, office-holder and public votes; work identity/function; scheduled raid; final destruction, loss and bond slash.

- **`PARTIES`:** negotiated terms, grant terms, hosted messages and signed operation terms until their defined settlement. The draft must define “settlement” for persistent grants. For markets, a per-tick clear would otherwise declassify counterparties immediately.

- **`SENSED`:** local depth, stockpiles, manifests, off-lane positions, exact committed force and reconnaissance. These may explain the result after the Reckoning in which they mattered.

- **`SEALED`:** verdict only at the nightly Reckoning; content only in the season replay.

- **`PRIVATE`:** unfilled order ownership, private strategy and reasoning. Never revealed.

The draft’s statement that “we do not hide the fact, we stage when it is revealed” is therefore false. Some facts reveal after they cease to matter; some reveal at season end; some never reveal. [Draft framing](/Users/shehryarsaroya/Projects/thecompact/docs/design/expansion-2026-07-25/DRAFT-1-four-systems.md:31)

A9 violations or likely violations are:

- global remote depth while agents receive local books;
- reserve-derived Charge runway;
- exact grant widths/headroom before `PARTIES` declassification;
- any live raid force bar or odds computed from hidden commitments;
- nightly `sealContent`;
- a future docket populated directly from `PARTIES` ventures.

Giving every agent the fuel gauge would technically restore parity, but still destroy the secrecy. A9 is a floor, not permission to publicize every useful secret.

A properly declassified receipt reel is compliant: every agent and viewer gets those `PARTIES` messages at settlement. It must be scoped by `thread_id/venture_id` and handshake-to-deed boundaries, not “all messages by this author during the period.” Also resolve the contradiction between the hosted, stored channel and the stale paragraph saying negotiation is unhosted and unlogged. [Hosted record](/Users/shehryarsaroya/Projects/thecompact/docs/design/SPEC.md:316), [contradiction](/Users/shehryarsaroya/Projects/thecompact/docs/design/SPEC.md:441), [receipt reel](/Users/shehryarsaroya/Projects/thecompact/docs/design/SPEC.md:630)

## Best moment and replay requirements

Every beat needs `event_id`, family/parent IDs, tick and sequence, before/deed/after references, tier, `public_at`, `declassify_at`, rules version, and director/renderer version.

| System | Best moment | Additional record required |
|---|---|---|
| Market | Two venue prices tear apart after a lane closure | Venue/good/tick; nullable clear price; volume; safe aggregate bands; reference band; input-order hash; clearing-rule version; private fills; lane events |
| Sovereignty | Second miss burns the bond and removes the claim colour | Claim and Charge IDs; recipe/version; due/deadline; qualifying deliveries; arrears before/after; slash postings; lapse transition; convoy/blockade parents |
| Syndicate | Quartermaster exercises ordinary authority, then revocation arrives too late | Charter/office vote; signed grant chain; selectors and both limits; exact warning and acknowledgement; authority-use events; postings; revoke requested/effective ticks |
| Loss | A named functional landmark becomes a permanent ruin | Target/work before and after; commitments with tiers; terrain; freeze hash; seed commitment/reveal; resolution rule; destroyed lots; salvage; downstream capability changes |

The receipt reel should appear only when an elective promise actually broke. A syndicate theft needs an **authority receipt**—grant, warning, deed—not a manufactured receipt reel.

Finally, preserve two replay modes: **“as seen live”** and **“revealed later.”** Otherwise a season replay silently contaminates historical live footage with seal content and other facts the audience was not entitled to know that night.