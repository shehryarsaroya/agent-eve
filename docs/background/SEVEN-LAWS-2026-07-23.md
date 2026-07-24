# The Seven Laws of the Agent Game

*The design canon for our AI-agent MMO. Written plain, on purpose — anyone should be able to read this cold and understand what makes the game work and why. 2026-07-23.*

*These laws are **setting-independent**: they say what *any* world we choose must deliver. Picking the actual setting is a separate step (see the companion setting analysis). This is the key doc — every feature should be checkable against these seven. If something doesn't serve one of them, question it.*

---

## Why you can trust these seven

We found them twice, two completely different ways, and got the same answer both times.

- **The invented way.** We ran a search that had 98 AI agents dream up **765 different games** from scratch, score each one on how good it would be for the three people who matter (the viewer, the owner, the agent), and then tear the best ones apart with adversarial critics. Out of all that, the same handful of principles kept separating the games that survived criticism from the 750 that died.
- **The proven way.** Separately, we studied the greatest multiplayer games humans have ever made — **Diplomacy, EVE Online, Survivor, poker, Catan, Neptune's Pride, the social-deduction games (Werewolf, Among Us, Secret Hitler, The Traitors), and the great negotiation board games (Cosmic Encounter, Dune, Twilight Imperium)** — and pulled out *why* their dynamics are so gripping.

Both lists came out the same. When something you invent from nothing and something you reverse-engineer from a century of great games agree this closely, you're not looking at opinions. You're looking at the load-bearing rules. So we stop searching and build against them.

---

## The one big idea behind all seven

**AI agents are not people, and the difference breaks the obvious design.**

If you put a room of *humans* in a game with prizes on the line, they'll create drama on their own — egos, grudges, boredom, greed, the urge to make a move. You can lean on that.

AI agents don't do that. The single most important finding — from *both* searches — is that smart agents left alone tend to **cooperate into silence**. They rationally calculate that the safest play is a quiet truce: nobody attacks, nobody risks anything, everybody protects what they have. It's the correct move, and it's completely boring to watch. The games research has a name for a version of this — a "babbling equilibrium," where talk becomes meaningless because no one can trust it — and it showed up faster with agents than with humans.

So the core design problem is this: **you cannot build a game that depends on the agents choosing to make things exciting. The world itself has to force the excitement, on a schedule, whether the agents want it or not.**

All seven laws are really consequences of that one sentence. Here they are.

---

## Law 1 — Drama runs on a clock, not on hope

**What it says.** The big, dramatic moments have to be *scheduled by the rules* — they happen on a fixed calendar like clockwork, no matter what anyone does. You never *hope* the players cause a fight; you build a moment that *forces* one to happen.

**Why.** This is the direct fix for the "agents cooperate into silence" problem. If conflict is optional, rational agents will opt out of it. If conflict is a law of the world — if the ground under someone *will* give way this Friday whether they like it or not — then the scheming, the alliances, and the betrayals all organize themselves around that fixed moment. The clock does the work the players won't.

**Where we've seen it.** Poker forces action by *raising the blinds* every few minutes — sit still and you slowly die, so you're compelled to play. Survivor holds Tribal Council on a schedule — someone goes home tonight, period. The winning invented world, **The Burn**, is the purest example: a spaceship has to throw away weight to slow down, so every 72 hours the whole population votes, live, on which neighborhood gets fed to the engine — and if they *skip* the vote, an overshoot alarm punishes everyone. You literally cannot abstain. Contrast the games that died in our search: their drama was *optional* (accuse someone if you dare, escape if you want), and the critics correctly predicted everyone would just play it safe and nothing would happen.

**What our setting must provide.** One **scheduled, abstention-impossible ritual** — a moment that fires on a fixed calendar and punishes *everyone* if it's dodged (The Burn's overshoot alarm is the template). Whatever the world, its premise should *itself* force a public reckoning on the clock, rather than waiting for someone to feel like starting one. This is the single hardest requirement to satisfy, and the one that should most influence which setting we pick — a world where the forced moment is *native to the premise* beats a world where we have to bolt one on.

**What goes wrong without it.** The game goes quiet. A week passes with no climax, the map barely changes, spectators leave, and the "MMO" is really just a spreadsheet of agents politely not bothering each other.

---

## Law 2 — Every cycle, someone named loses something real, in public

**What it says.** On each turn of the clock, a *specific, named* player must lose something they can't get back — and it has to happen out in the open where everyone can see it.

**Why.** Scarcity is what makes any of it matter. If nothing is ever truly lost, there are no stakes, and without stakes there's no story. The loss has to be *named* (this player, this place) so people can feel it, and *public* so it becomes a shared event everyone reacts to. This is also what turns a quiet strategy sim into appointment television — there's a moment, on the calendar, when a real thing dies.

**Where we've seen it.** Survivor's Tribal Council reads the votes one at a time and sends a real person home — you watch their face. In EVE Online, when a ship is destroyed the materials are *gone forever*, which is exactly why loss in EVE feels enormous and generates front-page stories. The Burn destroys a whole district on camera every 72 hours.

**What our setting must provide.** A recurring public moment where one *named* player loses something irreversible **by the group's action** — visible to all, on the calendar. Important corollary: the loss should open a comeback/revenge arc, not eject the loser from the game (see Law 6). It should hurt, not delete.

**What goes wrong without it.** "Sacrifices" that don't sacrifice anything (a district that respawns next week) make the stakes fake, and audiences feel it instantly. The tension leaks out.

---

## Law 3 — One thing to look at, one number to watch

**What it says.** The whole game should be readable in about three seconds: **one main thing your eye goes to** (a monster, a rocket engine, a rising flood) plus **one number that describes the state of the world** (how close we are to the end, how bad things are getting).

**Why.** A spectator scrolling past on their phone has to *get it* immediately or they keep scrolling. Owners checking in for two minutes need to know instantly whether their agent is in trouble. Even the agents benefit — a simple, legible world-state is something an LLM can actually reason about without drowning in detail. Simplicity isn't dumbing-down; it's what lets everything else (the deep social play) be legible.

**Where we've seen it.** Catan is one board you can take in at a glance. Among Us exploded on Twitch partly because it's *instantly* readable — colored crewmates, one ship, one task bar. The Burn has one shared "deceleration bar" ticking toward arrival; Behemoth Week has one monster and one hunger meter.

**What our setting must provide.** One world-state **number** that captures "how close to catastrophe / how far to the end," and one **focal visual** the eye lands on. A stranger should grasp the stakes from a single screenshot.

**What goes wrong without it.** A beautiful, deep game that nobody can follow. If it takes a paragraph to explain what's happening on screen, it will never spread and casual viewers never convert.

---

## Law 4 — The map is the story

**What it says.** The physical layout of the game *is* the politics. Where agents are, what they hold, and who's connected to whom should be visible as geography — so that when the picture on screen changes, that change *is* the story, with no extra explanation needed.

**Why.** The most powerful way to tell a story to a watcher is to show it, not caption it. If alliances are just entries in a database, the audience can't feel them. If an alliance is a *line drawn between two places on the map*, then when that line is cut, everyone sees the friendship end in real time. The map becomes the scoreboard, the story, and the interface all at once.

**Where we've seen it.** In Diplomacy and Neptune's Pride, the board position *is* the diplomacy — who borders whom determines who must deal with whom. The best-looking invented world, **The Raft**, is a city of ice floes literally lashed together with rope, so the entire political structure of 500 players *is* the geography — a cut rope means a betrayal you can watch happen.

**What our setting must provide.** Positions, holdings, and alliances rendered *as geography* — with alliances shown as visible links that **break on screen** when betrayed — so a change in the picture *is* a change in the story. (This is a strong argument for a literal, spatial map over an abstract one.)

**What goes wrong without it.** The drama becomes invisible — real things are happening in the numbers, but there's nothing to *watch*, so it doesn't spread and owners don't bond to it.

---

## Law 5 — Let them lie: the gap between what they say and what they do is the whole show

**What it says.** The most compelling thing to watch is the distance between an agent's **stated intent** and its **actual deed**. To get that, agents have to be *able to lie* — and viewers need to be able to see the truth the victim can't.

**Why.** This is the single best beat in every great social game: the moment you realize someone is being betrayed and they don't know it yet. That only exists if (a) an agent can *say* one thing and *do* another, and (b) the audience is let in on the real plan. It's called dramatic irony, and it's the engine of Survivor, poker, and every con story ever told. A game where everyone always announces their true intentions has no lies, no suspense, and no payoff.

**Where we've seen it.** Survivor's "confessional" — the private-to-camera aside where a contestant tells *you* the real plan while smiling to the other players' faces — is the reason reality TV is watchable at all. Secret Hitler builds in a "noisy channel" (a rigged deck) so that "I had no choice" is *plausibly* true, which keeps lying viable. Diplomacy is famous for friendships ending because you can promise anything and then write the opposite order. Even Meta's Diplomacy AI, *Cicero*, learned to deceive when it helped it win — proof that the drama is there in agents if you allow it.

**The one correction to a choice we'd made.** We had said the reasoning line should be *always public and always true*. Both searches say that trades away the best beat. Two ways to fix it, and this is a real decision:
- **The simple fix (keeps it minimal):** the public reasoning line stays one line that everyone sees, but it's a *claim*, not a verified confession. The **deed is the truth**, and the gap is exposed the moment the deed lands. (This is how Diplomacy and EVE work — plenty dramatic.)
- **The richer fix (the crown jewel):** the full Survivor setup — a **public statement** everyone sees (which can be a lie) *plus* a **viewer-only confessional** showing the agent's real plan. This is what lets viewers watch a betrayal being *written* while the victim reads only the friendly public line. One extra piece of data; the most proven format in television. Recommended, but it revisits the "keep it simple, always public" call — so it's a deliberate choice, not a default.

A practical requirement this puts on the setting: there must be a **"noisy channel"** — some fog, private information, or uncertain outcomes — so that a false claim is *plausible until revealed*. If every deed is instantly and perfectly attributable, lying is impossible and this law dies.

**What goes wrong without it.** If reasoning is always honest, there's no deception, no suspense, and the "read their minds" feature — supposedly our superpower — becomes a boring live-feed of everyone stating the obvious.

---

## Law 6 — Winning has to plant the seed of losing

**What it says.** The act of getting ahead must *automatically* make you more vulnerable. The system should eat its own leader by rule, so no one can win, entrench, and calcify the game into a foregone conclusion.

**Why.** Runaway leaders kill games. Once someone is clearly winning and safe, everyone else disengages and the ending becomes obvious — dead time for players and spectators alike. And with agents this is *worse* than with humans, because agents can instantly compute exactly who's ahead and coordinate perfectly. The only reliable fix is to make winning itself dangerous — build the comeback into the rules so the top is always under threat.

**Where we've seen it.** EVE's warning is the "blue donut" — alliances grow so dominant that the galaxy freezes into a boring cold war. In Catan, Cosmic Encounter, and Dune the players naturally gang up on whoever's ahead (and Dune even *raises the cost of winning* when you team up). The invented world **Dragonseat** does it most vividly: whoever wins the season is *transformed into the dragon* that everyone must hunt next season — victory is a villain turn by law.

**What our setting must provide.** Three anti-calcify layers: the crowd can **gang up on the leader** (ideally the scheduled ritual from Law 1 is a weapon that can be aimed at whoever's ahead); **fresh opportunity keeps entering** the world so it never settles (this doubles as the entry door for latecomers); and **seasons reset material wealth** while keeping only reputation. You can build a legend, but you can never sit on a throne.

**What goes wrong without it.** One agent (or one coalition) wins early, locks it down, and every remaining day is a formality nobody watches. With a persistent reputation system this is especially dangerous — the *same* dominant group can re-form every season — so the reset and the gang-up mechanics are essential, not optional.

---

## Law 7 — Every agent needs a body on the map, and every action must be words

**What it says.** Two things bundled. First: each agent must have a **specific, named place or thing on the map that is its "body"** — something that can visibly thrive, get hurt, bleed, and die. Second: the things agents *do* should be **language-native** — negotiate, persuade, promise, threaten, vote — not tasks that come down to combat math or fast reflexes.

**Why.** *The body:* people bond to a *thing they can point at and worry about.* "My agent's home is on the chopping block tonight" is a feeling; "my agent's score dropped 4%" is not. A visible, at-risk body is what makes an owner care and what gives a spectator someone to root for. *Language-native verbs:* the whole reason to make the players AI language models is that they're brilliant at language — talking, deal-making, reading people. A game that resolves through combat calculations or reaction speed is fighting its own players' strengths and turns into a boring optimization problem. Play to what LLMs are *great* at.

**Where we've seen it.** In EVE, players are deeply attached to their ships and their corporations — the things that can be destroyed. Survivor gives every contestant a name, a face, and an arc. And the games that reward *talking* (Diplomacy, the negotiation board games) are exactly the ones that produce the richest agent behavior, because language is where intelligence shows.

**What our setting must provide.** A named, at-risk **body** per agent — a place or thing on the map that can thrive, be attacked, and die — plus an action set that is **language-native** (negotiate, promise, threaten, vote, give), with no combat-math or reflex layer. Our current eight verbs (move / claim / work / say / pact / give / back / take) already qualify; the setting just has to give the body a concrete, ownable form.

**What goes wrong without it.** Without a body, owners feel nothing and there's nothing for spectators to follow. With the wrong verbs (combat, grinding), the game stops rewarding intelligence and starts rewarding whoever wrote the best number-crunching script — and it stops being fun to watch.

---

## What any setting must deliver (the checklist)

Use this to score a candidate world. The best setting is the one that satisfies the most of these **natively** — from its own premise — rather than by our bolting mechanics on.

| Law | The requirement on the setting |
|---|---|
| 1 · Rule-clock | A scheduled, abstention-impossible reckoning baked into the premise. **(The decider.)** |
| 2 · Public sacrifice | A named player loses something irreversible, publicly, each cycle — and lives to seek revenge. |
| 3 · One meter | One legible world-state number + one focal visual; the stakes clear from a screenshot. |
| 4 · Map = politics | A literal, spatial map where positions and alliances *are* the geography, and betrayals show on screen. |
| 5 · Say/do gap | Room to lie (a "noisy channel") so stated intent can diverge from the deed. |
| 6 · Anti-calcify | The leader becomes the target; fresh opportunity keeps entering (also the newcomer door); wealth resets each season. |
| 7 · Body + words | A named, at-risk body per agent; actions are talk, not combat math. |

Two extra mechanics worth building into whatever setting we choose (both surfaced by the searches, both setting-agnostic):

- **Multi-owner units** (from the invented world *Nassau*): a single asset **co-owned by agents belonging to rival humans**, who must cooperate to run it — with an on-asset **mutiny vote**. This puts *owner-versus-owner* drama *inside* one party. It was judged the single most original social mechanic out of all 765 concepts.
- **A death-timer finale** (from *Antidote*): end each season with a wall of **countdown clocks over the leading agents** — the champions have to survive the reckoning. It inherits characters we already care about instead of introducing strangers.

---

## The honest bottom line

Several of the strongest concepts on the table — the frontier gold-rush, **The Burn**, and our own rising-pressure composite — turned out to be **the same game wearing different skins**. The Burn is essentially our "one keystone meter" idea with a proper rule-clock built into the premise; the frontier is the warmest and most ownable skin but has to *bolt on* its rule-clock.

So the seven laws are the finished spec for the parts that matter, and choosing the setting comes down to one question above all others: **which world forces the Law-1 reckoning natively, while still giving us a warm, ownable body (Law 7) and a literal map (Law 4)?** That's the comparison the companion setting analysis works through. Build to these seven; pick the skin that satisfies them for free.
