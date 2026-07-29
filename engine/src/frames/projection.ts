/**
 * `publicFacts` — the one boundary the nightly frame is allowed to cross.
 *
 * ## Why this file exists
 *
 * A9 says the spectator client never shows a live fact an agent's own `observe` would
 * not. For the **event feed** that is enforced architecturally and fuzzed: `agentView`
 * is built by calling `spectatorView` first, and `test/events/parity.test.ts` proves
 * anything a viewer may read, *every* agent may read, at the same redaction.
 *
 * The **frame** did not go through any of that. `reckoningFrame()` read
 * `world.holdings`, the venture book and the grant book directly, so A9 held on that
 * path by good behaviour rather than by construction. Everything it read was in fact
 * tier-legal — but nothing stopped the next field from being sensed cargo or a hidden
 * stockpile, and that is not a hypothetical: the Charge "fuel gauge" proposed in the
 * expansion draft was exactly that mistake, a frame field derived from a public recipe
 * and a **private** stockpile, and it took an outside critic to notice.
 *
 * So the frame now reads a `PublicFacts` value, and this file is where a new field has
 * to argue for itself against §11.2 before it can reach a screen.
 *
 * ## What makes this a boundary rather than a rename
 *
 * {@link assertInertPublicFacts} canonicalises the projection. `canonicalize` refuses
 * functions, symbols, class instances and cycles, so a projection that still holds a
 * handle to the runtime — a getter, a bound method, a live book — **throws** rather
 * than rendering. That is the structural half: you cannot accidentally pass live state
 * through a value that is required to serialise.
 *
 * The tier half is the field list below. Each entry names the §11.2 tier that admits
 * it, and the assertion checks the value carries no key outside that list.
 */

import { canonicalize, type CanonicalValue } from '../core/canonical.js';
import type { FrameSource } from './render.js';

/**
 * The fields a nightly frame may be built from, each with the §11.2 clause that admits
 * it. This list is the rules surface; the type is just its shape.
 *
 * | field | tier | §11.2 clause |
 * |---|---|---|
 * | `reckoning`, `tick`, `stateHash` | `PUBLIC` | the clock and the published hash |
 * | `settled` | `PUBLIC` | "settled ventures, defaults and cures" |
 * | `meters` | `PUBLIC` | derived from settled ventures and the Levy's public result |
 * | `handles` | `PUBLIC` | "holdings" — a holding is rendered with its name on it |
 * | `standings` | `PUBLIC` | "standing: the public factual vectors" — the same row every agent reads |
 * | `ticker` | `PUBLIC` | published lines, already 140-char bounded |
 * | `tomorrow` | `PUBLIC` | the docket of ventures whose terms are already public |
 * | `tributeLines` | `PUBLIC` | "the Levy vote and its result, tribute lines" |
 * | `authorityLines` | `PUBLIC` | a grant's LIMITS, parties and renewal chain (D9a) |
 * | `raidLines` | `PUBLIC` | "movement on public lanes"; a raid is the map's motion, and its outcome is a public loss (A5) |
 * | `battleLines` | `PUBLIC` | hulls on a field are the map's motion; `ehpBps` is a fraction, never a hold value — the argument is below |
 * | `claimLines` | `PUBLIC` | sovereignty and its published legal state — the argument is below, in full |
 * | `modelBadges` | `PUBLIC` | which model runs a cast seat; not a game fact |
 * | `worksLines` | `PUBLIC` | a structure on the map, its tier-fixed yield, and what the world has already handed over |
 * | `marketLines` | `PUBLIC` | completed fills — economy law 10's "durable economic history", already in every agent's `market.ticker`; the argument is below |
 * | `syndicateLines` | `PUBLIC` | an organisation's standing legal shape, its pooled capital, and who may spend it |
 * | `map` | `PUBLIC` | the topology itself — A13 calls the map the game's only agreed representation |
 *
 * **`map` needed the least argument of anything here and was missing the longest.** §11.2 gives
 * `PUBLIC` to *"movement on public lanes — a convoy is visible to anyone, because it is the map's
 * motion and the map is the show"*, and a lane an agent could not see is a lane it could not have
 * moved along. It carries `id`, `name`, `tier`, `constellation` and `lanes` — every one of which any
 * agent reads out of its own `observe`.
 *
 * **What it deliberately does NOT carry is coordinates.** Position is presentation; putting x/y on
 * `StarSystem` would put presentation inside `state_hash`, where a layout tweak becomes a rules
 * change and a replay divergence. A graph is enough: a client derives a layout and pins it.
 *
 * **`syndicateLines.treasuryMinor` is the third field to argue against the stockpile line, and it
 * wins on §6.4's precedent rather than on convenience.** Bond is *"posted slashable capital,
 * **public**, and any amount — it is your credit rating"*, and a pooled treasury is that same object
 * at org scale: the thing counterparties price, and the thing an office-holder could take. It is not
 * a private hoard inferred through a formula — it is currency in a named account every member
 * deliberately pooled, minted by `PUBLIC` events. Hiding it would make the betrayal unreadable at
 * the exact moment the show exists for. What stays out: any member's OWN balance or holdings
 * (`SENSED` — pooling does not make a member's private stores public) and a covenant's verbs,
 * selectors or approval chain (`PARTIES`, D9a: only a grant's LIMITS and parties are public).
 *
 * **`worksLines` argues itself the same way `claimLines` had to**, and it is worth stating
 * because this is the third mechanic to reach the frame and the second one where the tempting
 * field is a stockpile. `yieldPerTick` is fixed by tier and published in `agent.md`'s own table.
 * `occupants` counts structures each of which was raised by a `PUBLIC` event. `sharePerTick` is
 * the first divided by the second — arithmetic any stranger can already do, and A2 requires
 * known arithmetic be exact and machine-readable. `extracted` is cumulative units the world has
 * **handed over**, one `PUBLIC` event per tick, so it is a sum of completed public acts.
 *
 * **What a works line may never carry:** units the holder still has, anywhere (`SENSED`);
 * Reckonings of Levy or Charge the extraction would cover, which is a public rate divided by a
 * private stockpile and is the rejected fuel gauge exactly; anything that moves when a convoy
 * arrives. `extracted` and *held* differ by everything the holder has spent, and only the first
 * is on the public side of §11.2.
 *
 * ★ **`marketLines` is the fourth mechanic to reach the frame, and its argument turns on the
 * one distinction §11.2 draws hardest: a DEED versus a MANIFEST.**
 *
 * The market's own tier table (`market/observe.ts`) already settles both halves, and they land on
 * opposite sides:
 *
 *   - **A completed fill is `PUBLIC`** — economy law 10: *"completed trades … become durable
 *     economic history."* It is the print, the valuation mark, and the receipt reel's raw
 *     material. Crucially it is `PUBLIC` **galaxy-wide**: `marketView` hands every agent
 *     `ticker: recentPrints(book, …)` over every venue, buyer and seller named. So A9's parity
 *     holds *by construction* rather than by inspection — every field on this line is read out
 *     of the same `book.fills()` log an agent's own `observe` already serves it.
 *   - **A resting order is not on this line, deliberately.** Depth, price levels and best
 *     bid/ask are `PUBLIC` too, but `booksFor` serves them only for venues where the reader has
 *     a hand (§12.1's *"local book only"*). A galaxy-wide ladder on this frame would therefore
 *     be a live fact most agents' `observe` would NOT show — A9 inverted, in the same shape as
 *     the `roleTags` defect two paragraphs above. And `market/observe.ts` gives the sharper
 *     reason: *"a resting ask IS a hold value — 'X has 400 of this good, here, right now'"*, so
 *     publishing depth would let a raider read a manifest off a public surface without ever
 *     scouting, which deletes the intel market. **A ship at sea is visible; its manifest is
 *     not** — and a resting order is the manifest.
 *
 * **Why the projection is a PRICE and not a trade count.** The economy's drama is price. That two
 * systems quote one good 8% apart is a lane worth hauling down, a hub forming and a blockade
 * worth mounting — M1's entire reason for making the book location-bound. `vwap`, `galaxyVwap`
 * and `premiumBps` are integer arithmetic over `PUBLIC` fills, which A2 requires be exact and
 * machine-readable, and `venues` is what stops a sole market's 0 bps from reading as "fairly
 * priced" when the truth is "nothing to compare it to".
 *
 * **What a print may never carry**, each considered: a `reference_mark` (that is the *bond*
 * valuation — the lender's question, not the viewer's, and pinning it here would give
 * "what is this worth" two homes); anybody's balance, inventory or escrow; an order's owner
 * (`PRIVATE`: *"the principal itself; never anyone, never later"*); resting depth at any venue.
 * `contract.ts:assertFrameBudgets` refuses a market line whose field name matches
 * `/depth|resting|ladder|bid|ask|owner|principal|inventory|stock|reserve|held|escrow/i`, which is
 * that rule made executable rather than remembered — the same instrument the claim line uses.
 *
 * **`claimLines` had to argue for itself hardest of all, because this is the exact field the
 * "fuel gauge" would have been.** The argument, field by field:
 *
 *   - §11.2 gives `PUBLIC` to **sovereignty and territorial control** — a claim is A13's own
 *     named signature (*"a claim tints a system"*), and territory nobody can see is not
 *     territory. `system`, `claimant`, `state`, `legend`, `arrears`, `arrearsOf`: all of it is
 *     the **world's own published verdict**, minted at a settlement that already emitted a
 *     `PUBLIC` event for it. Nothing is derived; it is the record, re-read.
 *   - `due`, `deadlineTick`, `arrearsOf`: fixed by rule **in advance** and computable by any
 *     stranger from the tier, the published surcharge and the published ballot. A2 requires
 *     known arithmetic be exact and machine-readable, and a number a stranger can already
 *     compute leaks nothing by being drawn.
 *   - `bondAtRisk`: §6.4 makes bond *"posted slashable capital, **public**, and any amount —
 *     it is your credit rating"*. Publicity is the mechanic.
 *   - `slashed`: A5 — *"loss is real, public, priceable"* — and it is what the ledger actually
 *     moved, on the night it moved.
 *   - `owed`: **the one that needed the argument.** It is `due` less what has been delivered,
 *     and a delivery **destroys** the goods into `sink:consumption`. So it is a function of
 *     the stock a claimant has already *spent*, which is a completed public act, and never a
 *     function of the stock it still *holds*. The rejected gauge published *"Reckonings of
 *     Charge remaining"* — a public recipe divided by a **private** stockpile — and thereby
 *     leaked reserve coverage, the limiting good, and, when it jumped, inbound convoy
 *     contents. Past-spend and present-holdings are the two sides of this boundary, and
 *     `owed` is on the safe one.
 *   - `forSale`: a price the claimant published itself, with `publish_offer`. `contestable`:
 *     a **clock**, from `VULNERABILITY_WINDOW`, and A14 requires it be readable by the
 *     defender too.
 *
 * **What a claim line may never carry**, and each was considered: units of the Charge good the
 * claimant still holds, anywhere (`SENSED` — "a ship at sea is visible; its manifest is not");
 * Reckonings of cover, however public the recipe; the limiting good in a multi-good recipe;
 * anything that moves when a convoy arrives. `contract.ts:assertFrameBudgets` refuses a claim
 * line whose field name matches `/cover|remaining|reserve|stock|gauge/i`, which is that rule
 * made executable rather than remembered.
 *
 * **`raidLines` had to argue for itself, and here is the argument.** §11.2 gives
 * `PUBLIC` to "movement on public lanes — a convoy is visible to anyone, because it is
 * the map's motion and the map is the show", and gives `SENSED` to "cargo contents and
 * hold values". A raid arriving somewhere is motion; what the target has in its hold is
 * not. So the line carries the stage, the target, the state, the countdown, the two
 * force counts, and two quantities — the **demand**, which is a seeded draw from a
 * published band and is deliberately *not* a function of the target's stock (see
 * `predation/params.ts`), and the **loss**, which A5 makes public the moment it happens.
 * An earlier draft made the demand a percentage of the target's standing stock: that
 * would have put a `SENSED` hold value on screen inside a fixed multiple, derived from a
 * public formula and a private stockpile — the "Charge fuel gauge" mistake exactly, in a
 * different mechanic. It was changed in the engine rather than hidden in the renderer.
 *
 * **`battleLines` needed the tightest argument here, because a battle is the most detailed thing
 * on this frame.** The admissible half is the same one `raidLines` won on: hulls standing on a
 * field are *motion*, and §11.2 gives `PUBLIC` to the map's motion *"because the map is the show"*.
 * `state`, `gap`, `echelon`, `posture`, `hulls` and the wreck list are all that.
 *
 * The inadmissible half is **a fit**, and it took one decision to keep out. §11.2 gives `SENSED` to
 * *"cargo contents and hold values"*, and a fit is a manifest by exactly that reasoning — it is what
 * a hull is carrying. So a bar's height is `ehpBps`, **a fraction of full and never an absolute**:
 * an absolute EHP divided by the hull count *is* the buffer, and a buffer names the tank modules.
 * `assertFrameBudgets` refuses an `ehpBps` outside 0..10000, which is that rule made executable
 * rather than remembered — the same instrument as the claim line's `/cover|remaining|reserve/` field
 * refusal, and for the same reason: the failure mode is a viewer's client quietly becoming an
 * intelligence service that any agent can scrape, which §10 SHOULD-2 of the ships pass names as the
 * thing that *"would make private scouting pointless."*
 *
 * The four flags — `pinned`, `capOut`, `repairing`, `roleTags` — are **effects that have already
 * landed**, which is the tier the combat observation already publishes to every agent in the fight
 * as `observed_effects`. So A9's parity holds by construction: a viewer sees nothing a combatant's
 * own `observe` would not contain. And the world's own fleet is public in full, deliberately: the
 * world is not a principal, so §11.2 protects no strategy of its.
 *
 * ⚑ **THREE OF THOSE FOUR WERE EFFECTS AND `roleTags` WAS NOT, FOR THE LAYER'S WHOLE LIFE.** The
 * paragraph above was the argument; the code was `roleTags: [...tagsOf(f, profileOf)]`, which resolves
 * the formation's **fit**. A `REMOTE_REPAIR` that had never fired published `REPAIR` on the night's
 * frame while the agent fighting it saw nothing — `observedEffects` requires the effect to have landed
 * *on the reader*. So the feed carried a live fact no combatant's `observe` contained (A9 inverted) and
 * named part of a `SENSED` manifest (§9A: *"a role is earned from what is fitted"* — the tag **is** the
 * fitting). `combat/view.ts`'s `witnessedTagsOf` now derives it from the trace, and the claim above is
 * true rather than intended. It was found by auditing for the identical defect in `forecastFor`, which
 * computed `hold_field_bps` from the enemy's real profile under a comment saying it did not: **one
 * instance of "the comment and the code disagree" is a reason to search for the second.**
 *
 * **Not admissible, and the reason each was considered:** cargo contents and hold values
 * (`SENSED` — "a ship at sea is visible; its manifest is not"); exact hand disposition
 * off public lanes (`SENSED`); seal *content* (`SEALED`, and it releases in the season
 * replay, not on the night); negotiation messages before settlement (`PARTIES`); a
 * grant's verbs, selectors, approvals and delegation depth (`PARTIES`, D9a); anything
 * derived from a private stockpile, however public the formula.
 */
export const PUBLIC_FACT_KEYS: readonly (keyof FrameSource)[] = Object.freeze([
  // ★ A13's three Phase 3 signatures. All three are PUBLIC by §11.2 and A9's parity rule holds by
  // construction: a FRONT's CONE, a COVER's terms and an INDEMNITY's outcome are every one of them
  // things `observe` already hands every agent (`src/risk/view.ts`), so nothing here is a fact a
  // viewer can read that an agent cannot. The **SWATH before landfall** is the one thing that would
  // break that, and `frontBands` publishes the cone while the front is unstruck for exactly that
  // reason — see `lines.ts:frontBands`.
  'frontBands',
  'coverArcs',
  'coverChains',
  'reckoning',
  'tick',
  'stateHash',
  'settled',
  'meters',
  'handles',
  // ── STANDING VECTORS, AND WHY THEY ARE ALREADY PUBLIC ──────────────────────
  //
  // §11.2 puts "standing: the public factual vectors" at `PUBLIC`, and `standingRow` already
  // serves exactly this row to every agent through `observe` — including in `counterparties[]`
  // about principals other than the reader. So publishing it to a viewer adds no disclosure and
  // A9's parity holds by construction: there is no live fact here an agent's own `observe` would
  // not answer.
  //
  // It is here because `CastChip.line` was hardcoded '' and every name rendered bare, so a
  // stranger had no basis on which to root for anyone — §14.1's "who am I watching" answered by
  // two dead fields. The vectors are the answer, and they were already computed.
  //
  // NOT a score (§3). The frame carries the vectors; the renderer states them and leaves the
  // meaning to the viewer. And a principal with no row is ABSENT from the map rather than present
  // with zeros — a fabricated all-zero standing reads as a clean record, which is a claim about a
  // real agent that nothing supports.
  'standings',
  'modelBadges',
  'ticker',
  'tomorrow',
  'tributeLines',
  'authorityLines',
  'raidLines',
  'battleLines',
  'claimLines',
  // ── ★ THE SAP (§16.6, A13), AND THE ONE FIELD THAT NEEDED AN ARGUMENT ─────
  //
  // Everything on a `SapLine` is `PUBLIC` on a tier already accepted three keys up. The two systems
  // are on the map; the two principals are named by the `PUBLIC` declaration event; the score is the
  // world's own verdict, exactly as `ClaimLine.legend` is; and `bond`/`forfeited` are posted
  // slashable capital, which §6.4 puts at `PUBLIC` in its own words — *"public, and any amount"*.
  //
  // **`hollow` is the field that needed an argument, and it is `anchorHot`'s.** It says "this
  // campaign has no materiel at its depot for its next pulse", which is a threshold on a stock, and
  // §11.2 puts a stock at `SENSED`. It is admitted because it is not a quantity: it is one bit about
  // a **published obligation** falling due at a **published tick**, which is precisely what
  // `ClaimLine.anchorHot` already publishes about an unfuelled anchor. A viewer learns a war is
  // failing; nobody learns what anybody holds.
  //
  // The rejected version, kept because it is the useful half: a `materielHere` figure on the line.
  // That is the "fuel gauge" `sovereignty/view.ts` killed — a public recipe over a private stockpile,
  // leaking reserve coverage, the limiting good, and the contents of an inbound convoy. One bit is
  // the whole admissible signal, and `CampaignView.materiel_here` serves the number to PARTIES only.
  //
  // A9 then holds by construction: `SapLine` carries strictly fewer fields than `CampaignView`, which
  // every agent's own `observe` already returns.
  'saps',
  'worksLines',
  // ── ★ THE MARKET'S PRINT (§10, A13) ────────────────────────────────────────
  //
  // Completed fills only, galaxy-wide, which is the tier `recentPrints` already serves to every
  // agent through `market.ticker` — so this adds no disclosure and A9 holds by construction. No
  // resting order, no depth, no ladder, no owner: those are venue-gated in `observe` and a
  // resting ask is a hold value, so publishing them would be A9 inverted AND the manifest a
  // raid is meant to have to scout for. The full argument is above.
  //
  // It is here because `market/` printed 18 fills and the frame carried no market key at all: the
  // first production fill would have been invisible, which A13 makes a ship-blocker rather than a
  // gap. The key is PRESENT even when nothing traded, because an absent key and an empty one read
  // the same to a client, and "nothing has traded here yet" is a fact this frame must be able to
  // state.
  'marketLines',
  'syndicateLines',
  // ── §16'S WORLD MEMORY, AND WHY BOTH ARE ALREADY PUBLIC ────────────────────
  //
  // Neither adds a disclosure. `places` is derived from the WORKS book, whose rows are `PUBLIC` — a
  // works is a visible structure standing on a system, and `worksLines` already publishes the live
  // ones with holder and yield. `hallOfFame` is derived from `standings`, admitted three entries up
  // for exactly this reason: §11.2 puts the standing vectors at `PUBLIC` and `observe` already serves
  // them about principals other than the reader.
  //
  // So A9's parity holds by construction on both: there is no fact here an agent's own `observe`
  // could not already answer, only an ordering of facts it would have to collect itself.
  //
  // The one thing to watch if these grow: `places` reads RAZED works as well as standing ones. That is
  // still `PUBLIC` — a structure that existed and fell is exactly what a ruin is, and §16 wants the
  // fallen labelled — but it means this key can name a principal who currently holds nothing at all.
  // Intended. A world where losing everything also erases that you built the place is a world with no
  // history in it.
  'places',
  'hallOfFame',
  'map',
]);

export class ProjectionError extends Error {}

/**
 * Prove the projection is inert data carrying only admissible keys.
 *
 * Called on the way into the renderer, so the failure is a refused frame rather than a
 * published one. Both halves matter and they fail differently:
 *
 *   - an **unknown key** means somebody added a field without arguing it against §11.2;
 *   - a **canonicalisation failure** means the projection is still holding live state,
 *     which is the leak this file exists to make impossible.
 */
export function assertInertPublicFacts(facts: FrameSource): void {
  const allowed = new Set<string>(PUBLIC_FACT_KEYS as readonly string[]);
  const extra = Object.keys(facts).filter((k) => !allowed.has(k));
  if (extra.length > 0) {
    throw new ProjectionError(
      `frame projection carries ${extra.join(', ')}, which no §11.2 clause admits. ` +
        'Add it to PUBLIC_FACT_KEYS with the tier that permits it, or keep it out of the frame.',
    );
  }

  // `handles` and `modelBadges` are Maps, which are legitimately not canonical values;
  // everything else must serialise. A Map of primitives is inert, so it is unwrapped
  // rather than rejected — but its CONTENTS still have to be plain.
  const inert: Record<string, unknown> = {};
  for (const key of Object.keys(facts)) {
    const value = (facts as unknown as Record<string, unknown>)[key];
    inert[key] = value instanceof Map ? [...value.entries()] : value;
  }
  try {
    canonicalize(inert as CanonicalValue);
  } catch (error: unknown) {
    throw new ProjectionError(
      'frame projection is not inert data — it is still holding a handle to live state ' +
        `(${error instanceof Error ? error.message : String(error)}). The frame must be ` +
        'built from a value, so that what a viewer sees cannot depend on what the world ' +
        'happens to contain when the renderer runs.',
    );
  }
}
