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
 * a holding's system, a grant's two parties — so A9 holds by construction: nothing here is a fact a
 * spectator frame could not already carry, and nothing here is a fact the recipient does not already
 * know about itself.
 *
 * That also makes discovery honest rather than a directory. An agent does not *look up* who to talk
 * to; the situations it is standing in name them, and the affordance carries the names (see
 * `api/observe.ts`'s `message {to}` block). The alternative — publish the principal list and let
 * agents guess — is the same thing with a Sybil funnel attached.
 *
 * ── THE TWO RELATIONS, AND WHY EACH ONE ─────────────────────────────────────
 *
 *   1. **`CAMPAIGN`** — a live campaign you are standing in, as its attacker, its defender or a
 *      roster party. It reaches the other two principals the war is about, every other roster party,
 *      **and every seated principal whose holding stands in the objective's constellation.** The last
 *      clause is the one that does the work and it is the one that needs the argument: a roster-only
 *      rule would let allies talk to each other and leave the lone attacker mute, which is the exact
 *      state the probe was in. Constellation rather than system, because a war is won by hands that
 *      can *arrive* — §4.2 bounds a constellation at 5–8 systems, so this is who could actually help,
 *      and it is bounded by the **map** rather than by the population.
 *
 *   2. **`GRANT`** — the counterparty of a live grant, in either direction. §11.2 puts a grant's
 *      parties, limits, clearance and renewal chain in `PUBLIC` explicitly, and A6 is the core loop:
 *      a delegate that cannot talk to its grantor cannot ask for more rope, and *betrayal by
 *      persuasion* is unreachable if the persuading has to happen inside a venture the two are
 *      already committed to.
 *
 * **What is deliberately NOT here.** Syndicate co-members (they already have `propose` and a shared
 * treasury), the whole enrolled population (A15), and "anyone eligible to `join` this campaign" —
 * that last one looks attractive and is the trap: `join {side:"DEFENDER"}` is **free** and needs only
 * a seat (§16.6 MUST-9 makes it free on purpose), so "eligible to join" is satisfiable by any free
 * identity, and a reach relation built on it would be A15-unpriced through a door another axiom holds
 * open. The price on the *sender's* side is in `parley.ts`; this file is the price on the
 * *situation's*.
 */

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
 */
export type ReachWhy = 'CAMPAIGN' | 'GRANT' | 'REPLY';

/**
 * One addressable principal, and the situation that makes it addressable.
 *
 * `about` is the situation's own id — a campaign id or a grant id — so a PARLEY row can name the
 * public fact that authorised it. A row that recorded only *who* would leave the legality of the
 * address unfalsifiable after the situation ended, which is A5′ applied to a permission.
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
   * Principals that have addressed this one **inside the current Reckoning**.
   *
   * Not filtered to *unanswered*: the allowance already bounds how much can be said, and filtering
   * here would close the channel to a second sender the moment the first was answered. Scoped to the
   * Reckoning for the allowance's reason — a licence to talk to somebody who spoke once six cycles
   * ago accumulates exactly the way §9 forbids a war chest to.
   */
  readonly approachedBy: (principal: PrincipalId) => readonly PrincipalId[];
}

/**
 * The published cap on how many principals one agent may address (INV-26).
 *
 * A bound rather than a clock, for `MAX_DOSSIERS`' reason: what is dropped here is dropped from the
 * *menu*, and `header.withheld` counts it with a sentence naming the situation, so an agent can still
 * construct the call. Sized against the map rather than the population: §4.2 bounds a constellation
 * at 5–8 systems and `MAX_CAMPAIGN_PARTIES` is 12, so a principal in one war at full roster reaches
 * at most ~20, and a principal in four reaches this cap.
 */
export const MAX_REACH_ROWS = 32;

/**
 * Every principal this one may address, in canonical order, deduplicated, capped.
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
        `${other} addressed you this Reckoning, so you may answer it whatever your own record. Answering costs ` +
        'nothing you had to earn — the price of a parley is on whoever starts one — and ' +
        '`counterparties[].last_parley` carries what it said, with its standing row beside it so you can price ' +
        'the offer before you take it.',
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

  // ── 2. GRANTS ─────────────────────────────────────────────────────────────
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

  return rows.slice(0, MAX_REACH_ROWS);
}

/** Is this principal addressable by that one, and why? `null` when it is not. */
export function reachTo(
  rows: readonly ReachRow[],
  to: PrincipalId,
): ReachRow | null {
  return rows.find((r) => r.principal === to) ?? null;
}
