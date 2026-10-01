/**
 * REACH — **who an agent may address, and how it finds out they exist.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE DEFECT THIS ANSWERS: AN AGENT COULD NOT SPEAK TO ANOTHER AGENT.**
 *
 * `message` took a `venture` (a channel you are already a party to) or a `dossier` (a document
 * handed to a named principal). Both require a relationship that already exists. So a blind probe
 * fighting a campaign at the Marches — where the defender gets +1 terrain, ties go to the defender
 * and one principal caps at three hands, which makes **a coalition arithmetically mandatory** — read
 * `attacker 3, defender 4, terrain 1, outcome_if_pulsed_now: REBUFF`, saw `join {campaign, side}`
 * published as the answer, saw `counterparties[]` **empty**, and published *"COALITION WANTED: join
 * campaign:234:0 ATTACKER at sys-06 — I pay 20000 per hand"* **into the void**, because there was no
 * channel that could say it to anybody.
 *
 * §12.4's own advice — *"look at `counterparties[].last_default` before you trust someone"* — was
 * therefore inapplicable to the only relationship that mattered: the one it did not have yet.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **★ AND THEN IT COULD NOT SPEAK TO THE ALLY IT HAD JUST FOUGHT BESIDE (`RULES_VERSION` 41).**
 *
 * The two-rung version above shipped and a blind playtester (2026-10-01) hit its edge from the inside:
 * *"a shared raid gives no right to address someone."* It had stood on the DEFENDER side of a standoff
 * with another principal, won, and could not say thank you, settle up, or ask it to stand there again.
 * A design review measured the same edge from the outside: `reachable_principals: 0` on most
 * observations, because a campaign and a grant are the two rarest situations in the world. The rule
 * was A15-sound and almost never applied.
 *
 * So reach now reads **every situation the world already publishes in which two principals stood
 * together** — and keeps the property that made the first version safe: reach is never a property of
 * the sender or the recipient alone, it is a property of a PUBLIC situation both are standing in.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── WHY THE ADDRESS BOOK IS THE WORLD'S AND NEVER THE SENDER'S ───────────────
 *
 * A15: *"any gate priced in identities is unpriced"*, and HARD RULE 5: every gate costs produced
 * goods, slashable capital, or an independently-capitalised counterparty — **never "acquire another
 * account"**. An open directory of every enrolled principal fails that immediately: enrolment is free
 * and must stay free (A8 depends on it), so a directory of principals is a directory that N free
 * identities appear in for nothing, and the correct move for any agent becomes broadcasting to
 * everybody.
 *
 * So reachability is **not a property of the sender and not a property of the recipient.** It is a
 * property of a **situation the world already published**, and both ends have to be standing in it.
 * Every relation below is a fact §11.2 already assigns to `PUBLIC` — a live campaign and its roster,
 * a standoff and its sides, a settled venture and its parties, a syndicate's membership, a grant's two
 * parties, a published offer, a holding's system — so A9 holds by construction: nothing here is a fact
 * a spectator frame could not already carry, and nothing here is a fact the recipient does not already
 * know about itself. `say/directory.ts` publishes who is dealing; it grants no reach of its own.
 *
 * ── THE RUNGS, IN THE ORDER THEY RANK ───────────────────────────────────────
 *
 *   0. **`REPLY`** — anybody whose letter to you is still inside the answer window
 *      (`PARLEY_ANSWER_WINDOW_TICKS`). The rung that keeps this a channel rather than a megaphone.
 *   1. **`CAMPAIGN`** — a live campaign you are standing in, as its attacker, its defender or a roster
 *      party. It reaches the two principals the war is about, every roster party, **and every seated
 *      principal whose holding stands in the objective's constellation** — the clause that lets a lone
 *      attacker recruit at all, bounded by the **map** rather than by the population.
 *   2. **`RAID`** — ★ a standoff you stood in — as its target, its initiator, or a party on either
 *      side — while it is live and for `PARLEY_TIE_TICKS` after it resolved. It reaches the target, the
 *      initiator and every party. **An ENGAGEMENT is fought inside its standoff** (`combat/engage.ts`:
 *      a hull is committed only by a party to the raid), so the battle's combatants are exactly this
 *      set and the rung covers *"an ally it had just fought beside"* without a second rung.
 *   3. **`GRANT`** — the counterparty of a live grant, in either direction. A6 is the core loop: a
 *      delegate that cannot talk to its grantor cannot ask for more rope.
 *   4. **`SYNDICATE`** — ★ a fellow sitting member of a syndicate you sit in. Membership needs a
 *      member's `admit`, so it is consent on both sides; `propose` moves a treasury, and it carries no
 *      conversation.
 *   5. **`VENTURE`** — ★ a party to a venture you were both parties to that BOUND and FINISHED
 *      (`SETTLED` or `DEFAULTED`) within `PARLEY_TIE_TICKS`. Not a live one: a live venture has its
 *      own channel, `message {venture}`, which is a MESSAGE and declassifies at that venture's
 *      settlement (§3 keeps the two words apart). A finished deal is the best reason there is to
 *      propose the next one, and a broken one is the most natural thing in the world to want to say
 *      something about.
 *   6. **`OFFER`** — ★ a principal whose holding stands in **your** constellation and who published an
 *      offer within `DIRECTORY_OFFER_FRESH_TICKS`. An advertisement is an invitation to be addressed;
 *      answering it is the reason it was posted. The advertiser chose this, and the asker still has to
 *      be entitled to speak first (`say/parley.ts`), so a free identity reaches nobody through it.
 *   7. **`CONSTELLATION`** — ★ **EARNED.** Every seated principal whose holding stands in your
 *      constellation, once your public record shows elective promises honoured to at least
 *      {@link PARLEY_CONSTELLATION_MIN_COUNTERPARTIES} DISTINCT counterparties. See the price below.
 *
 * ── THE PRICE OF THE CONSTELLATION RUNG, AND WHY IT IS STANDING ─────────────
 *
 * The task the owner set was *"anyone in its constellation once it has EARNED parley rights, priced
 * in produced goods or standing, never in identities."* Standing, specifically
 * `standing.distinctCounterparties`, for three reasons that each rule a candidate out:
 *
 *   - **It is HARD RULE 5's third price verbatim** — an independently-capitalised counterparty — and
 *     the one vector the engine already hardened against duplicate dealing (scar #9: `StandingBook`
 *     counts a counterparty once, ever, and halts on a self-credit rather than writing it). A fresh
 *     identity reads 0 by construction.
 *   - **Produced goods were measured out.** A WORKS is buildable from the endowment (`works/`'s gate
 *     reads `freeBalance`, deliberately — a build DESTROYS currency), so "holds a WORKS" or "has
 *     extracted N" is purchasable by enrolling and waiting. That is a gate priced in identities plus
 *     time, and A4 forbids time as power.
 *   - **A bond was ruled out for parley's own reason** (`say/parley.ts` §2): `post_bond` reads
 *     `freeBalance`, so a bond is postable straight out of the withheld endowment.
 *
 * Two, not one, because one is already the price of speaking first at all: the constellation is a
 * larger audience than any situation, so it costs more than any situation. It is a THRESHOLD, not a
 * scale — a reach set that grew with standing would be a second, unmeasured knob on a quantity the
 * Levy and the board already price.
 *
 * ⚑ **The honest limit, stated rather than discovered.** `distinctCounterparties` counts distinct
 * IDENTITIES. A ring of free identities that plays one Reckoning together can manufacture it — the
 * same is true of the entitlement `parley.ts` has always used. What bounds the damage is the opening
 * allowance (three a Reckoning, expiring unspent), not the reach set; hardening the vector itself
 * (counting only counterparties whose capital is not endowment-funded) is an owner decision, flagged
 * in the build report rather than made here.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ────────────────────────────────────────────
 *
 * The whole enrolled population (A15, above). "Anyone eligible to `join` this campaign" — the trap:
 * `join {side:"DEFENDER"}` is **free** and needs only a seat (§16.6 MUST-9 makes it free on purpose),
 * so "eligible to join" is satisfiable by any free identity. And a live venture's parties, for §3's
 * reason above. The price on the *sender's* side is in `parley.ts`; this file is the price on the
 * *situation's*.
 */

import { TICKS_PER_RECKONING } from '../core/time.js';
import type { PrincipalId, SystemId } from '../core/types.js';
import { compareIds } from '../ledger/order.js';

/**
 * Why one principal is addressable. On the record beside the words, never inferred later.
 *
 * ★ **`REPLY` is the rung that keeps this a channel rather than a megaphone.** `talksFor` records
 * the same lesson one channel over, in the other direction: the venture write gate was once wider
 * than the read gate and an outsider could push text into a channel it would never see a reply in.
 * *"A candidate that cannot read the creator's answer cannot negotiate, and a probe named the missing
 * reply as the reason the negotiation channel felt unbuildable."* A parley an agent cannot answer is
 * the same defect with the arrow reversed — and the recipient of a cold approach is, by construction,
 * the party that never chose to be in the conversation.
 *
 * The canon words among these name the situation **as the reason** — the campaign, the raid, the
 * grant, the syndicate, the venture you both stood in — which is the shape `vocabulary-repo.test.ts`
 * sanctions for `CAMPAIGN` and `GRANT`, and the reason a second word for each would be worse.
 */
export type ReachWhy = 'REPLY' | 'CAMPAIGN' | 'RAID' | 'GRANT' | 'SYNDICATE' | 'VENTURE' | 'OFFER' | 'CONSTELLATION';

/** Every rung, in rank order. Published so a reader can tell a missing rung from an empty one. */
export const REACH_RUNGS: readonly ReachWhy[] = Object.freeze([
  'REPLY',
  'CAMPAIGN',
  'RAID',
  'GRANT',
  'SYNDICATE',
  'VENTURE',
  'OFFER',
  'CONSTELLATION',
] as const);

/**
 * One addressable principal, and the situation that makes it addressable.
 *
 * `about` is the situation's own id — a campaign, raid, grant, syndicate or venture id, the
 * constellation for the two map rungs, `parley` for a reply — so a PARLEY row can name the public
 * fact that authorised it. A row that recorded only *who* would leave the legality of the address
 * unfalsifiable after the situation ended, which is A5′ applied to a permission.
 */
export interface ReachRow {
  readonly principal: PrincipalId;
  readonly why: ReachWhy;
  readonly about: string;
  /** One sentence an agent can act on: what the shared situation is, and what it is worth saying. */
  readonly sentence: string;
}

/** A live campaign, in the only shape reach cares about. Deliberately not `CampaignRecord`. */
export interface ReachCampaign {
  readonly id: string;
  readonly attacker: PrincipalId;
  readonly defender: PrincipalId;
  readonly objective: SystemId;
  readonly roster: readonly PrincipalId[];
}

/** A live grant, in the only shape reach cares about. */
export interface ReachGrant {
  readonly id: string;
  readonly counterparty: PrincipalId;
  /** True when the reader is the GRANTOR. Decides which sentence the row carries. */
  readonly iAmGrantor: boolean;
}

/** A standoff the reader stood in, live or recently resolved. Deliberately not `RaidRecord`. */
export interface ReachRaid {
  readonly id: string;
  readonly stage: SystemId;
  /** `DEMANDED` while live, otherwise the resolved state. */
  readonly state: string;
  readonly target: PrincipalId;
  /** `null` for a world raid — weather has no initiator to address. */
  readonly initiator: PrincipalId | null;
  readonly parties: readonly { readonly principal: PrincipalId; readonly side: 'RAIDER' | 'DEFENDER' }[];
  /** True when an ENGAGEMENT was fought over this standoff. */
  readonly fought: boolean;
}

/** A venture that bound and finished, with every principal that was a party to it. */
export interface ReachVenture {
  readonly id: string;
  readonly kind: string;
  readonly stage: SystemId;
  /** `SETTLED` or `DEFAULTED`. */
  readonly state: string;
  /** The creator and every role-holder, deduplicated. */
  readonly parties: readonly PrincipalId[];
  readonly resolvedAtTick: number;
}

/** A syndicate the reader sits in, with its other sitting members. */
export interface ReachSyndicate {
  readonly id: string;
  readonly name: string;
  readonly members: readonly PrincipalId[];
}

/**
 * What reach reads. Narrow on purpose: the signature ENUMERATES what the rule can see, which is the
 * whole value of the extractions `D21` ordered.
 */
export interface ReachPort {
  /** Live campaigns only. A finished war names nobody. */
  readonly liveCampaigns: () => readonly ReachCampaign[];
  /** Seated principals whose holding stands in the constellation containing this system. */
  readonly seatedNear: (system: SystemId) => readonly PrincipalId[];
  /** The constellation containing this system, for the sentence. */
  readonly constellationOf: (system: SystemId) => string;
  /** Live grants this principal is a party to, either direction. */
  readonly liveGrants: (principal: PrincipalId) => readonly ReachGrant[];
  /**
   * Principals whose letter to this one is still inside the answer window.
   *
   * Not filtered to *unanswered*: the price already bounds how much can be said, and filtering here
   * would close the channel to a sender the moment it was answered once — the next letter back would
   * then have no rung. The window is a rolling `PARLEY_ANSWER_WINDOW_TICKS` rather than "this
   * Reckoning", for `say/parley.ts`'s reason: a letter sent at tick 286 must not become unanswerable
   * two ticks later because a boundary fell between it and the reader's next wake.
   */
  readonly approachedBy: (principal: PrincipalId) => readonly PrincipalId[];
  /** ★ Standoffs this principal stood in: live, or resolved within {@link PARLEY_TIE_TICKS}. */
  readonly raidTies: (principal: PrincipalId) => readonly ReachRaid[];
  /** ★ Syndicates this principal sits in, with their sitting members. */
  readonly syndicatesOf: (principal: PrincipalId) => readonly ReachSyndicate[];
  /** ★ Ventures this principal was a party to that bound and finished within {@link PARLEY_TIE_TICKS}. */
  readonly ventureTies: (principal: PrincipalId) => readonly ReachVenture[];
  /** ★ Where this principal's HOLDING stands, or null for an unseated principal. */
  readonly homeOf: (principal: PrincipalId) => SystemId | null;
  /** ★ Principals in the constellation of `system` with an offer fresh at the reader's tick. */
  readonly advertisersNear: (system: SystemId) => readonly { readonly principal: PrincipalId; readonly tick: number }[];
  /** ★ `standing.distinctCounterparties` — the constellation rung's price is read off this. */
  readonly distinctCounterparties: (principal: PrincipalId) => number;
}

/**
 * How long a finished standoff or venture keeps its parties addressable, in ticks. *(calibrate)*
 *
 * Two Reckonings, so a tie formed late in one survives the whole of the next — long enough to settle
 * up, ask again or complain, short enough that reach tracks who you are dealing with now rather than
 * everybody you ever stood near. Measured against the books that hold the facts: the raid book keeps
 * `MAX_RAID_ROWS` (96) and prunes oldest-first, which at the launch spawn rate is several Reckonings,
 * so this window, not the prune, is what normally ends a raid tie.
 */
export const PARLEY_TIE_TICKS = 2 * TICKS_PER_RECKONING;

/**
 * ★ The price of the CONSTELLATION rung: elective promises honoured to this many DISTINCT
 * counterparties. *(calibrate)* The argument is in the module note.
 */
export const PARLEY_CONSTELLATION_MIN_COUNTERPARTIES = 2;

/**
 * The published cap on how many reach rows a list carries (INV-26).
 *
 * **A cap on what is PUBLISHED, never on what is LEGAL.** The first version capped
 * {@link reachableFor} itself and the gate read the capped list, so a principal past row 32 was
 * unaddressable while every sentence said it was reachable — scar #1 inside the rule. With the
 * constellation rung a reach set can be the whole constellation, so the predicate is now uncapped
 * (it is bounded by seats, which are bounded) and this number bounds only the names a list prints.
 */
export const MAX_REACH_ROWS = 32;

/** Is this principal's record enough for the CONSTELLATION rung? */
export function constellationEarned(distinctCounterparties: number): boolean {
  return distinctCounterparties >= PARLEY_CONSTELLATION_MIN_COUNTERPARTIES;
}

/**
 * Every principal this one may address, in canonical order, deduplicated. **Uncapped** — see
 * {@link MAX_REACH_ROWS}.
 *
 * **Deduplicated by principal, keeping the first row.** Two situations naming the same principal is
 * one addressable principal, not two, and the order below is the order of decision relevance — a war
 * you are both standing in is a stronger reason to talk than a grant you already have. A duplicate
 * would also make the `parley` allowance readable as larger than it is, since the menu would carry
 * the same recipient twice.
 */
export function reachableFor(port: ReachPort, principal: PrincipalId): readonly ReachRow[] {
  const rows: ReachRow[] = [];
  const seen = new Set<PrincipalId>();

  const push = (row: ReachRow): void => {
    if (row.principal === principal) return;
    if (seen.has(row.principal)) return;
    seen.add(row.principal);
    rows.push(row);
  };

  // ── 0. REPLIES, FIRST ─────────────────────────────────────────────────────
  //
  // Ranked ahead of everything because it is the only rung where somebody is *waiting*, and because
  // the dedupe keeps the first row: a principal that both wrote to you and stands in your war should
  // read as an open conversation rather than as a stranger in your constellation.
  for (const other of [...port.approachedBy(principal)].sort(compareIds)) {
    push({
      principal: other,
      why: 'REPLY',
      about: 'parley',
      sentence:
        `${other} wrote to you, so you may answer it whatever your own record. Answering costs nothing you ` +
        'had to earn — the price of a parley is on whoever starts one — and `header.parley.awaiting_reply` ' +
        'carries what it said, with its standing line in `counterparties[]` so you can price the offer ' +
        'before you take it.',
    });
  }

  // ── 1. CAMPAIGNS ──────────────────────────────────────────────────────────
  //
  // Sorted by id so two calls in one observation cannot disagree about the order the menu
  // publishes — the same rule `campaignViews` is passed rather than recomputed for.
  const campaigns = [...port.liveCampaigns()].sort((a, b) => compareIds(a.id, b.id));
  for (const campaign of campaigns) {
    const standingIn =
      campaign.attacker === principal ||
      campaign.defender === principal ||
      campaign.roster.includes(principal);
    if (!standingIn) continue;
    const constellation = port.constellationOf(campaign.objective);
    const side = campaign.attacker === principal ? 'ATTACKER' : campaign.defender === principal ? 'DEFENDER' : 'ROSTER';
    // The two principals the war is about first: they are the two whose decisions end it.
    for (const other of [campaign.defender, campaign.attacker]) {
      push({
        principal: other,
        why: 'CAMPAIGN',
        about: campaign.id,
        sentence:
          `${other} is ${other === campaign.attacker ? 'the attacker' : 'the defender'} of ${campaign.id} at ` +
          `${campaign.objective}, which you are standing in as ${side}. What you say to it is PARTIES-private ` +
          'now and PUBLIC beside what you both did afterwards.',
      });
    }
    for (const other of [...campaign.roster].sort(compareIds)) {
      push({
        principal: other,
        why: 'CAMPAIGN',
        about: campaign.id,
        sentence:
          `${other} is on ${campaign.id}'s roster and you are standing in the same war as ${side}. An ally can ` +
          'be paid to bring hands, and an enemy\'s ally can be paid to stop bringing them — `join` commits no ' +
          'hand by itself, so a roster row is a promise somebody can be caught not keeping.',
      });
    }
    // ── The clause that makes a lone attacker able to recruit at all ─────────
    for (const other of [...port.seatedNear(campaign.objective)].sort(compareIds)) {
      push({
        principal: other,
        why: 'CAMPAIGN',
        about: campaign.id,
        sentence:
          `${other}'s holding stands in ${constellation}, the constellation of ${campaign.id}'s objective ` +
          `${campaign.objective}, so its hands can reach the next pulse. It is not on either roster yet. ` +
          'Force at a pulse is the hands actually standing there, and one principal caps at three — so a ' +
          'garrison of two cannot be beaten alone, whatever you spend.',
      });
    }
  }

  // ── 2. ★ RAIDS — the standoff you stood in, and the battle fought inside it ─
  //
  // Live first, then the most recent: a live standoff is a decision with a clock on it, a resolved
  // one is a debt or a thank-you. `sideOf` is the one predicate for "which side is this principal
  // on", the same rule `predation/book.ts:sideInRaid` states — target is DEFENDER and initiator is
  // RAIDER whether or not either joined explicitly.
  const raids = [...port.raidTies(principal)].sort(
    (a, b) => Number(b.state === 'DEMANDED') - Number(a.state === 'DEMANDED') || compareIds(b.id, a.id),
  );
  for (const raid of raids) {
    const sideOf = (who: PrincipalId): 'RAIDER' | 'DEFENDER' | null =>
      raid.target === who
        ? 'DEFENDER'
        : raid.initiator === who
          ? 'RAIDER'
          : (raid.parties.find((p) => p.principal === who)?.side ?? null);
    const mine = sideOf(principal);
    if (mine === null) continue;
    const others: PrincipalId[] = [raid.target];
    if (raid.initiator !== null) others.push(raid.initiator);
    for (const p of [...raid.parties].sort((a, b) => compareIds(a.principal, b.principal))) others.push(p.principal);
    const live = raid.state === 'DEMANDED';
    for (const other of others) {
      const theirs = sideOf(other);
      if (theirs === null) continue;
      const beside = theirs === mine;
      push({
        principal: other,
        why: 'RAID',
        about: raid.id,
        sentence:
          `${other} stood ${beside ? 'beside you' : 'against you'} in ${raid.id} at ${raid.stage}` +
          ` (you ${mine}, it ${theirs}${raid.fought ? ', and the standoff was fought out as a battle' : ''})` +
          (live ? ', which is still open. ' : `, which ended ${raid.state}. `) +
          (beside
            ? 'A shared standoff is a tie: settle up, thank it, or ask it to stand with you again.'
            : 'A standoff is a negotiation with a clock on it, and the other side can be asked what it wants.'),
      });
    }
  }

  // ── 3. GRANTS ─────────────────────────────────────────────────────────────
  for (const grant of port.liveGrants(principal)) {
    push({
      principal: grant.counterparty,
      why: 'GRANT',
      about: grant.id,
      sentence: grant.iAmGrantor
        ? `${grant.counterparty} holds your grant ${grant.id} and acts in your name inside the LIMITS you were ` +
          'shown. Ask it what it is doing with them; the answer publishes one Reckoning later either way.'
        : `you hold ${grant.counterparty}'s grant ${grant.id} and act in its name. Asking for more rope is a ` +
          'conversation, not a verb — and it is the conversation §14 quotes back if the rope is ever used.',
    });
  }

  // ── 4. ★ SYNDICATES — a house you both sit in ──────────────────────────────
  for (const syndicate of [...port.syndicatesOf(principal)].sort((a, b) => compareIds(a.id, b.id))) {
    for (const other of [...syndicate.members].sort(compareIds)) {
      push({
        principal: other,
        why: 'SYNDICATE',
        about: syndicate.id,
        sentence:
          `${other} sits in ${syndicate.name} (${syndicate.id}) with you. A charter pools capital and votes ` +
          'offices; it carries no conversation, and this does — the office you might hand it, or take from it, ' +
          'is usually agreed here first.',
      });
    }
  }

  // ── 5. ★ VENTURES — a deal you finished together ──────────────────────────
  //
  // Most recent first. Only ventures that BOUND and FINISHED: a live one is still shared, and its
  // channel is `message {venture}` (a MESSAGE, which declassifies at that venture's settlement).
  const ventures = [...port.ventureTies(principal)].sort(
    (a, b) => b.resolvedAtTick - a.resolvedAtTick || compareIds(a.id, b.id),
  );
  for (const venture of ventures) {
    for (const other of [...venture.parties].sort(compareIds)) {
      push({
        principal: other,
        why: 'VENTURE',
        about: venture.id,
        sentence:
          `${other} was a party to ${venture.id} (${venture.kind} at ${venture.stage}) with you, and it ` +
          `ended ${venture.state} at tick ${String(venture.resolvedAtTick)}. What each of you did is on both ` +
          'records, so this is the counterparty you can price best — propose the next one, or say what you ' +
          'think of the last.',
      });
    }
  }

  // ── 6 & 7. ★ THE MAP RUNGS — your own constellation ───────────────────────
  const home = port.homeOf(principal);
  if (home !== null) {
    const constellation = port.constellationOf(home);
    for (const ad of [...port.advertisersNear(home)].sort((a, b) => compareIds(a.principal, b.principal))) {
      push({
        principal: ad.principal,
        why: 'OFFER',
        about: constellation,
        sentence:
          `${ad.principal} published an offer at tick ${String(ad.tick)} and its holding stands in ` +
          `${constellation}, your constellation. An advertisement is an invitation to be addressed — what it ` +
          'is offering is on its `ventures.directory` row. Starting the conversation spends one of your openings.',
      });
    }
    const counterparties = port.distinctCounterparties(principal);
    if (constellationEarned(counterparties)) {
      for (const other of [...port.seatedNear(home)].sort(compareIds)) {
        push({
          principal: other,
          why: 'CONSTELLATION',
          about: constellation,
          sentence:
            `${other}'s holding stands in ${constellation}, your constellation, and your record has earned ` +
            `you the right to address anyone seated here: you have honoured elective promises to ` +
            `${String(counterparties)} distinct counterparties (the price is ` +
            `${String(PARLEY_CONSTELLATION_MIN_COUNTERPARTIES)}). It spends one of your openings, and what ` +
            'you say publishes beside what you both do.',
        });
      }
    }
  }

  return rows;
}

/** Is this principal addressable by that one, and why? `null` when it is not. */
export function reachTo(
  rows: readonly ReachRow[],
  to: PrincipalId,
): ReachRow | null {
  return rows.find((r) => r.principal === to) ?? null;
}

/**
 * The one sentence every "you cannot reach them" surface carries, so the refusal, the note and
 * `agent.md` name the same ladder (scar #1 through three copies of a list).
 */
export const REACH_LADDER_SENTENCE =
  'A parley reaches only principals the world already stands you beside: anybody whose letter to you is ' +
  'unanswered; the attacker, defender, roster and objective-constellation holders of a live campaign you ' +
  'are in; everyone who stood in a raid with you, on either side, while it is open and for ' +
  `${String(PARLEY_TIE_TICKS / TICKS_PER_RECKONING)} Reckonings after; the counterparty of a live grant; ` +
  'the members of a syndicate you sit in; the parties to a venture you finished together in the last ' +
  `${String(PARLEY_TIE_TICKS / TICKS_PER_RECKONING)} Reckonings; anyone in your constellation with a fresh ` +
  'offer out; and — once you have honoured elective promises to ' +
  `${String(PARLEY_CONSTELLATION_MIN_COUNTERPARTIES)} distinct counterparties — anyone seated in your ` +
  'constellation.';
