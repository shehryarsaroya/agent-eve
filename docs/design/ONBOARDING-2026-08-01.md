# What a first-time EVE player did wrong, and where our agents do the same thing

*2026-08-01. Source: "Eve Online, From a NEW Players Perspective!" (Guzu, `pubOrr_dZrI`), pulled via
`starvibe/youtube-video-transcript`. ~30.6k characters, two sessions — one alone with the tutorial,
one with a veteran (rushlog) coaching over voice.*

**Scope: LANGUAGE AND SURFACE ONLY.** Owner instruction, and it is the right one — nothing here
proposes a mechanic, a verb, a table or a rule. Every item below is a sentence we could write, a
field we already publish, or an ordering. Where an item happens to match something the two Aug-1
play logs found independently, that is said, because a finding two blind instruments reach is worth
more than either.

---

## The one-line reading

**He never read anything, and he was never lost for more than about ten seconds** — because a named
voice told him the next thing to do and *pointed at it*, and later because a veteran said six-word
imperatives with the reason attached. Our equivalent voice is `briefing.prompt`, it exists, it is
good, and the play logs show it going quiet at exactly the moments it is most needed.

Our onboarding document opens with *"This document is complete. You do not need to read anything
else to play well."* It is 1,847 lines. Both statements are true and they are in tension: complete
is the right ambition for a reference and the wrong shape for a first wake.

---

## Six adjustments, ranked by what the play logs already cost us

### 1. ★ The briefing must name what you MISSED, not only what is pending

The strongest item, and the only one both play logs found without prompting.

mason-01 slept through its own formation window. The venture died `ABANDONED` with both roles filled
and both counterparties countersigned — *"my escrow came back; their committed hands got nothing for
~13 ticks."* At the next wake there was **no `corrections[]` row and nothing in `briefing.prompt`**;
the prompt had moved on to *"Nothing is waiting on you."* Its own note: *"this was the most
consequential thing that happened to me between wakes."*

The video's mirror image: every single thing that happened to the player was narrated at the moment
it happened, and the one mechanic he was told twice was the one with a deadline — *"as soon as you
jump into the wormhole immediately press Ctrl-B."*

**The adjustment.** A `since_your_last_wake[]` line, or one clause on `prompt`, naming what resolved
against you while you were away. We already know it — the state transition is on the record.
`prompt` currently ranks *pending* things; nothing ranks *finished* ones, so a venture that died
unsigned is indistinguishable from a venture that never existed.

### 2. Say whether the agent is ON PACE, not just how much is left

The mentor's most useful sentence in the whole dungeon was a rule of thumb about a timer:
as long as more than half the circle remains when the room is finished, the player is doing fine.
Not the number — the *reading* of the number.

We publish `wakes_remaining` and `next_reckoning` and leave the division to the agent. Both play logs
did that arithmetic by hand and both wrote it down as a lesson they had to learn: saroyan's *"wakes
are the scarce resource, not actions"* at wake 2, and mason-01 budgeting *"~14 wakes across the 275
ticks."* saroyan then spent wakes 1–7 and hit settlement with 5 left; mason-01 missed the LEVY::7
ballot by one tick.

**The adjustment.** One derived sentence on `header` or `briefing`: at this burn you have N wakes for
M ticks, which is one every K — and the next thing that needs you is at tick T. Pure arithmetic over
fields we already publish. No new mechanic; §38's wake budget is a *pool*, and nothing on the surface
says what spending it evenly costs.

### 3. State the forgiveness budget out loud

*"You can fail a can once and nothing happens"* — the mentor names the free mistake before the player
makes it. He then fails, sees fireworks, and learns the shape at zero cost.

saroyan took a `CONTRADICTED` seal by accident and called it *"an unforced error… exactly the kind of
scar an opportunist should only take on purpose, and I took it by accident."* It had sealed an
expectation about **someone else's** follow-through. Nothing on the surface said a seal binds only
what you control, and nothing said which mistakes are permanent.

**The adjustment.** In §3 (What you have) and on the `seal` affordance: which marks are permanent
(defaults, contradicted seals), which are free (a window that closes unfilled — *"charged for leaving,
not for turning up"*, which agent.md already says well and which mason-01 correctly relied on), and
the one-line rule that a seal should bind your own conduct.

### 4. Name the frame's staleness where an agent will look for a clock

mason-01 lost its first venture to this specifically: it waited on `frames/latest.json`'s `tick`,
which read **1439 twenty-five minutes after its signed observation said 1452** — a ~35-tick lag. Its
wait loop never fired. `GET /health` carries the real tick unsigned and is the correct wait target.

Cached frames are the design and the lag is correct behaviour. The defect is that nothing says so.

**The adjustment.** One sentence in §5 (Time) and one field comment on the frame: this feed is cached
and its tick can be tens of ticks old; it is public parity on *facts*, not a clock — poll `/health`
for the tick.

### 5. A "first wake" path above the reference

The player was flying, shooting and completing a mission inside minutes without reading. Our agent
meets 1,847 lines and a claim of completeness.

**The adjustment.** Not a rewrite — a lift. The first ~40 lines become: the three calls, enrol, read
`affordances[]`, send one row **verbatim**, read `briefing.if_you_do_nothing`. Then a single line:
*everything below is reference; you can play from what the payload hands you.* This is already true —
`PROBE_FULL=1` play-throughs confirm it — and the document does not currently claim it early enough
to be acted on.

**And fix the section order while doing it.** It currently runs 11, 11D, 11G, 11A, 11B, 11C, 11E, 11F.
A newcomer reads about being raided (§11D, predation) **before** it reads §11A, *"WORKS — the only
reason goods exist."* The letters record the order the sections were written, not the order they
should be read.

### 6. Reach for an analogy when a mechanic has a familiar shape

*"This is Minesweeper"* did more work than any paragraph in the segment, and the player was playing
competently within a minute. Same for the filaments: *"acting like keys from Diablo."*

We have at least three mechanics with a familiar shape and no analogy attached: the formation window
is an escrowed group booking that expires; the Levy ballot is a tax whose *rate* is fixed and whose
*incidence* is voted; `IN_FULL` is a tip you commit to before the bill is computed. That last one is
where the IN_FULL trap lives, and mason-01 watched it not spring — the quoted electives were 900+300
and the settled figures were 1,099+366, so *an agent electing the quoted numbers would have recorded
two defaults while believing it paid in full.* One analogy would inoculate against that better than
the current warning does.

---

## What the video does NOT argue for

Worth writing down so a later reader does not re-derive it. The single biggest jump in the player's
competence came from **a human veteran on voice**, not from any part of the game. The obvious
inference — build a mentor channel, pair a newcomer with an established principal — is a **mechanic**,
it is out of scope by owner instruction, and it collides with A15 (any gate priced in identities is
unpriced) and with the parley reach rules. Noted, not proposed.

Also not proposed: the game's own analogue of the tutorial's hand-holding already exists and is
better than EVE's in one respect the video accidentally demonstrates — the player could not tell a
weapon from a mining laser (*"this is not a weapon this is a miner"*), where every one of our
affordances carries `max_direct_loss`, `what_it_forecloses` and `expires_tick` before the act. Both
play logs called that out as the thing that made decisions calculable. Do not trade it away for
brevity when doing item 5.
