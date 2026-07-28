/**
 * The campaign book — and its **retention rule is the most dangerous thing in this module.**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **A CAMPAIGN OUTLIVES EVERY OTHER RETENTION WINDOW IN THE ENGINE, AND THAT IS WHY
 * {@link Book.prune} IS WRITTEN BEFORE ANYTHING ELSE IN THIS FILE.**
 *
 * `Book.prune` has silently destroyed a load-bearing row five times in this repo, and every one
 * failed in production only — the retained rows are always there in a short test. The neighbouring
 * modules' windows are `SOVEREIGNTY_RETAINED_RECKONINGS = 3` and `LEVY_RETAINED_RECKONINGS = 3`; a
 * campaign runs for up to `CAMPAIGN_PULSES = 5`. **A window copied from either neighbour would
 * delete a war on its fourth Reckoning**, and the symptom would not be an error: the pulse handler
 * would find no due campaigns, nothing would resolve, the bond would stay locked forever, and the
 * SAP would vanish off the map with the attacker's capital still inside it.
 *
 * So retention here is two rules and only the second is a window:
 *
 *   1. **An undecided campaign is never pruned**, at any age, at any book size. Not "retained for
 *      N" — retained, full stop. The size cap is enforced at {@link Book.declare} instead, so the
 *      book cannot grow past its bound by admitting a campaign it would then have to drop.
 *   2. **A decided campaign is kept for `CAMPAIGN_RETAINED_RECKONINGS`** (6 — one more than the
 *      longest possible campaign), so its postmortem renders and its ticker line can be read.
 *
 * `CMP-6` audits the first rule from the row's own counters rather than from this comment, and
 * `test/campaign/retention.spec.ts` runs a full five-Reckoning campaign with `prune` called on
 * **every tick** and asserts the row, its bond lock and all five pulses survive to the verdict. A
 * retention rule with no test that would notice it clearing early is a retention rule that has not
 * been checked.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ## Why the pulses are stored on the row and not derived from the event ledger
 *
 * Everything else this book holds could be recomputed. The pulse log could not: it is §16.6
 * MUST-14's *"public strategic war ledger"* — the postmortem — and MUST-13 requires that a finished
 * war be *retellable*. A projection over `event` would work and would put the frame's SAP on a fold
 * over a season of rows every time it renders, which is the event-sourcing cliff `SPEC` §15.1 names
 * by name. So the log is state, bounded by {@link CAMPAIGN_PULSES}, and the events are the permanent
 * copy.
 */

import { reckoningIndex, TICKS_PER_RECKONING } from '../core/time.js';
import type { CampaignState, PrincipalId, PulseOutcome, SystemId } from '../core/types.js';
import { minor, qty, type Minor, type Qty } from '../core/units.js';
import { compareIds } from '../ledger/order.js';
import type { CanonicalValue } from '../core/canonical.js';
import {
  readArray,
  readInt,
  readObject,
  readString,
  SnapshotError,
  type StateTable,
} from '../tick/snapshot.js';
import {
  CAMPAIGN_PULSES,
  CAMPAIGN_RETAINED_RECKONINGS,
  MAX_CAMPAIGN_PARTIES,
  MAX_CAMPAIGNS,
} from './params.js';

export type CampaignId = string & { readonly __brand: 'CampaignId' };

/** The side a party took. Never `RAIDER`/`DEFENDER`: those are §9's, and a campaign is not a raid. */
export type CampaignSide = 'ATTACKER' | 'DEFENDER';

/**
 * `campaign:<declareTick>:<index>` — a namespace of its own, sharing none with `raid:`.
 *
 * A campaign and a raid can be live at the same place in the same tick and both reach the ticker,
 * the frame and the record; two ids that could collide would put one mechanic's row into the
 * other's lookup and abort a tick for everybody (`demandIdFor`'s exact reason).
 */
export function campaignIdFor(declareTick: number, indexAtTick: number): CampaignId {
  return `campaign:${String(declareTick)}:${String(indexAtTick)}` as CampaignId;
}

/** One party's place on the roster. §16.6 MUST-9's *"explicit roster"*, as rows. */
export interface CampaignParty {
  readonly principal: PrincipalId;
  readonly side: CampaignSide;
  /**
   * What this party locked, and the lock holding it. Zero and `null` for a DEFENDER.
   *
   * A DEFENDER stakes nothing on purpose (§16.6 MUST-9, and `join {side:"DEFENDER"}` in §9 already
   * works this way): pricing the act of helping somebody hold their home would mean the aggressor's
   * side was the cheaper one to be on, which inverts the whole point of attacker risk.
   */
  readonly stake: Minor;
  readonly encumbranceId: string | null;
  readonly joinedAtTick: number;
}

/**
 * One PULSE, as it happened. The postmortem's row, and the only place a campaign's history lives.
 *
 * Every figure is what the resolver **measured**, never what it intended — the same rule
 * `RaidRecord.lostQty` follows and for the same reason (`book.close`'s signature makes the intended
 * figure unreachable). `materielSpent` is what the ledger actually destroyed; `attackerForce` and
 * `defenderForce` are the two sums the verdict came out of, published so an agent can check the
 * arithmetic rather than trust it (A2).
 */
export interface PulseRow {
  readonly index: number;
  readonly reckoning: number;
  readonly tick: number;
  readonly outcome: PulseOutcome;
  readonly attackerForce: number;
  readonly defenderForce: number;
  readonly terrain: number;
  /** Units of MATERIEL the ledger destroyed. Zero on a STARVE, by definition. */
  readonly materielSpent: Qty;
  /** Hands the attacker had standing at the OBJECTIVE, its own plus its allies'. */
  readonly attackerHands: number;
  readonly defenderHands: number;
}

/** A declared campaign. Mutable only in the fields a PULSE or an ending writes. */
export interface CampaignRecord {
  readonly id: CampaignId;
  readonly attacker: PrincipalId;
  /**
   * The claimant at declaration, **pinned**.
   *
   * Pinned rather than re-read, because the record must name who the war was declared against even
   * after the claim changes hands — and because a campaign whose defender silently became whoever
   * happened to hold the claim would let an attacker's bond be forfeited to a principal that never
   * chose to be in it. A claim that changes hands ends the campaign `MOOT` instead
   * (`pulse.ts`'s first branch), which is the honest answer: the war's object is gone.
   */
  readonly defender: PrincipalId;
  /** The CLAIMED system this campaign is aimed at. §16.6 MUST-2's machine objective. */
  readonly objective: SystemId;
  /** The attacker's forward system: where its holding stood, one lane from the objective. */
  readonly depot: SystemId;
  readonly bond: Minor;
  bondEncumbranceId: string | null;
  /** Pinned from the claim's public state at declaration. Never recomputed (A5′). */
  readonly breachesNeeded: number;
  readonly rebuffsNeeded: number;
  readonly declaredAtTick: number;
  /** The first PULSE's tick. Never in the Reckoning of declaration (§16.6 MUST-8). */
  readonly firstPulseTick: number;
  state: CampaignState;
  breaches: number;
  rebuffs: number;
  /** Consecutive STARVED pulses. Reset by any pulse that was supplied. */
  starves: number;
  pulses: PulseRow[];
  parties: CampaignParty[];
  endedAtTick: number | null;
  endedAtReckoning: number | null;
  /** What the ending actually moved out of the attacker's bond. Never the bond. */
  forfeited: Minor;
  returned: Minor;
}

const CAMPAIGN_STATES: readonly CampaignState[] = Object.freeze([
  'MASSING',
  'PRESSING',
  'TAKEN',
  'REBUFFED',
  'STARVED',
  'LIFTED',
  'MOOT',
]);

const PULSE_OUTCOMES: readonly PulseOutcome[] = Object.freeze(['BREACH', 'REBUFF', 'STARVED']);

const SIDES: readonly CampaignSide[] = Object.freeze(['ATTACKER', 'DEFENDER']);

export function isCampaignState(s: string): s is CampaignState {
  return (CAMPAIGN_STATES as readonly string[]).includes(s);
}

export function isPulseOutcome(s: string): s is PulseOutcome {
  return (PULSE_OUTCOMES as readonly string[]).includes(s);
}

export function isCampaignSide(s: string): s is CampaignSide {
  return (SIDES as readonly string[]).includes(s);
}

/** Is this campaign still capable of a verdict? The one predicate `prune` may not get wrong. */
export function isLiveCampaign(state: CampaignState): boolean {
  return state === 'MASSING' || state === 'PRESSING';
}

export class CampaignBookError extends Error {}

export class Book {
  private readonly rows = new Map<CampaignId, CampaignRecord>();

  /**
   * Declare a campaign.
   *
   * The size cap is here rather than in `prune`, and that is the load-bearing difference from
   * `predation/book.ts`: a raid row is disposable history, so its book can admit past its cap and
   * drop the excess. A campaign row holds a **live bond lock**, so dropping one would orphan an
   * encumbrance (INV-4 halts the world over that) and lose an attacker's capital. The book therefore
   * refuses to grow rather than growing and forgetting.
   */
  declare(record: CampaignRecord): void {
    if (this.rows.has(record.id)) {
      throw new CampaignBookError(`campaign ${record.id} already exists`);
    }
    if (this.rows.size >= MAX_CAMPAIGNS) {
      throw new CampaignBookError(
        `INV-26: the campaign book holds ${String(this.rows.size)} rows and the declared cap is ` +
          `${String(MAX_CAMPAIGNS)}`,
      );
    }
    this.rows.set(record.id, record);
  }

  get(id: CampaignId): CampaignRecord | undefined {
    return this.rows.get(id);
  }

  require(id: CampaignId): CampaignRecord {
    const row = this.rows.get(id);
    if (row === undefined) throw new CampaignBookError(`no campaign ${id}`);
    return row;
  }

  addParty(id: CampaignId, party: CampaignParty): void {
    const row = this.require(id);
    if (row.parties.length >= MAX_CAMPAIGN_PARTIES) {
      throw new CampaignBookError(
        `INV-26: campaign ${id} holds ${String(row.parties.length)} parties and the cap is ` +
          `${String(MAX_CAMPAIGN_PARTIES)}`,
      );
    }
    if (row.parties.some((p) => p.principal === party.principal)) {
      throw new CampaignBookError(`${party.principal} is already on campaign ${id}'s roster`);
    }
    // Canonical order at insert, never at read: an out-of-order array hashes differently on two
    // hosts (DET-1/DET-2), and `capture` sorting on the way out would hide a caller that appended
    // in arrival order — which is what the hash exists to catch.
    row.parties = [...row.parties, party].sort(
      (a, b) => compareIds(a.principal, b.principal),
    );
  }

  /** Record one PULSE and its counters. The only writer of `breaches`/`rebuffs`/`starves`. */
  recordPulse(id: CampaignId, row: PulseRow): void {
    const campaign = this.require(id);
    if (campaign.pulses.length >= CAMPAIGN_PULSES) {
      throw new CampaignBookError(
        `campaign ${id} has run its ${String(CAMPAIGN_PULSES)} pulses and cannot run another; a ` +
          'campaign that outlived its own clock would be a war with no verdict (A12)',
      );
    }
    campaign.pulses = [...campaign.pulses, row];
    if (row.outcome === 'BREACH') {
      campaign.breaches += 1;
      campaign.starves = 0;
    } else if (row.outcome === 'REBUFF') {
      campaign.rebuffs += 1;
      campaign.starves = 0;
    } else {
      // A STARVE counts for the defender AND toward the campaign's own death. Both, deliberately:
      // §16.6 MUST-5 wants cutting a corridor to be a way a smaller defender wins, and a starve
      // that only stalled the clock would make an unsupplied campaign free to leave open.
      campaign.rebuffs += 1;
      campaign.starves += 1;
    }
    if (campaign.state === 'MASSING') campaign.state = 'PRESSING';
  }

  /** Move a campaign to its verdict. Refuses a second ending, which would move a bond twice. */
  end(
    id: CampaignId,
    outcome: {
      readonly state: Exclude<CampaignState, 'MASSING' | 'PRESSING'>;
      readonly tick: number;
      readonly forfeited: Minor;
      readonly returned: Minor;
    },
  ): void {
    const row = this.require(id);
    if (!isLiveCampaign(row.state)) {
      throw new CampaignBookError(
        `campaign ${id} already ended ${row.state}; a second ending would move its bond twice`,
      );
    }
    row.state = outcome.state;
    row.endedAtTick = outcome.tick;
    row.endedAtReckoning = reckoningIndex(outcome.tick);
    row.forfeited = outcome.forfeited;
    row.returned = outcome.returned;
    row.bondEncumbranceId = null;
  }

  all(): readonly CampaignRecord[] {
    return [...this.rows.values()].sort((a, b) => compareIds(a.id, b.id));
  }

  live(): readonly CampaignRecord[] {
    return this.all().filter((c) => isLiveCampaign(c.state));
  }

  liveCount(): number {
    return this.live().length;
  }

  size(): number {
    return this.rows.size;
  }

  /** Every campaign this principal is in, on either side, decided or not. */
  forPrincipal(principal: PrincipalId): readonly CampaignRecord[] {
    return this.all().filter(
      (c) =>
        c.attacker === principal ||
        c.defender === principal ||
        c.parties.some((p) => p.principal === principal),
    );
  }

  /** The live campaign aimed at this system, or null. One at a time, by rule. */
  liveAgainst(objective: SystemId): CampaignRecord | null {
    return this.live().find((c) => c.objective === objective) ?? null;
  }

  /** Live campaigns whose next PULSE is due at this tick, in canonical order. */
  dueAt(tick: number): readonly CampaignRecord[] {
    return this.live().filter((c) => nextPulseTickOf(c) === tick);
  }

  /** The index for the next campaign id minted at this tick. */
  nextIndexAt(tick: number): number {
    const prefix = `campaign:${String(tick)}:`;
    let n = 0;
    for (const id of this.rows.keys()) if (id.startsWith(prefix)) n += 1;
    return n;
  }

  /**
   * INV-4's question, and **it takes the OBLIGATION REF, never the lock id.**
   *
   * ══════════════════════════════════════════════════════════════════════════
   * This method was written the other way round first, and it halted the world on the most ordinary
   * act in the mechanic — `sovereignty/book.ts` carries the identical warning about the identical
   * mistake, and it was made again here anyway. INV-4 walks every OPEN encumbrance and asks *"is the
   * obligation this secures still live?"* by handing over `encumbrance.obligationRef` — which for a
   * campaign's bond and for every ally stake is the **campaign id**. A version keyed on the lock id
   * answers `false` for a lock that plainly exists, and the first `build {kind:"CAMPAIGN"}` anyone
   * ever sent aborted its tick with `encumbrance … locks 100000 for dead obligation campaign:4:0`.
   *
   * Agent-reachable, on a healthy world, on the one act the whole layer is about. §15.4 puts a false
   * halt in the same class as a false default.
   * ══════════════════════════════════════════════════════════════════════════
   *
   * A live campaign's locks are open; an ended one's are released in the same step that writes its
   * verdict, so a ref that names an ended campaign is correctly dead — and `CMP-6` halts if an ended
   * campaign is ever found still holding one.
   */
  isLive(obligationRef: string): boolean {
    const row = this.rows.get(obligationRef as CampaignId);
    return row !== undefined && isLiveCampaign(row.state);
  }

  /**
   * Drop decided campaigns older than the retention window. **Never a live one.**
   *
   * See this file's header. The `isLiveCampaign` guard is the whole safety property and
   * `test/campaign/retention.spec.ts` bites it by mutation: flip it and a five-Reckoning campaign
   * loses its row mid-war, which the test reports by name.
   */
  prune(currentReckoning: number): number {
    const keepFrom = currentReckoning - CAMPAIGN_RETAINED_RECKONINGS;
    let dropped = 0;
    for (const [id, row] of [...this.rows.entries()].sort((a, b) => compareIds(a[0], b[0]))) {
      if (isLiveCampaign(row.state)) continue;
      if ((row.endedAtReckoning ?? currentReckoning) >= keepFrom) continue;
      this.rows.delete(id);
      dropped += 1;
    }
    return dropped;
  }

  sizes(): Readonly<Record<string, number>> {
    return { campaigns: this.rows.size, campaignPulses: this.all().reduce((n, c) => n + c.pulses.length, 0) };
  }

  capture(): CanonicalValue {
    return {
      campaigns: this.all().map((c) => ({
        id: c.id,
        attacker: c.attacker,
        defender: c.defender,
        objective: c.objective,
        depot: c.depot,
        bond: c.bond,
        bondEncumbranceId: c.bondEncumbranceId,
        breachesNeeded: c.breachesNeeded,
        rebuffsNeeded: c.rebuffsNeeded,
        declaredAtTick: c.declaredAtTick,
        firstPulseTick: c.firstPulseTick,
        state: c.state,
        breaches: c.breaches,
        rebuffs: c.rebuffs,
        starves: c.starves,
        endedAtTick: c.endedAtTick,
        endedAtReckoning: c.endedAtReckoning,
        forfeited: c.forfeited,
        returned: c.returned,
        parties: c.parties.map((p) => ({
          principal: p.principal,
          side: p.side,
          stake: p.stake,
          encumbranceId: p.encumbranceId,
          joinedAtTick: p.joinedAtTick,
        })),
        pulses: c.pulses.map((p) => ({
          index: p.index,
          reckoning: p.reckoning,
          tick: p.tick,
          outcome: p.outcome,
          attackerForce: p.attackerForce,
          defenderForce: p.defenderForce,
          terrain: p.terrain,
          materielSpent: p.materielSpent,
          attackerHands: p.attackerHands,
          defenderHands: p.defenderHands,
        })),
      })),
    };
  }

  restore(captured: CanonicalValue): void {
    this.rows.clear();
    const root = readObject(captured, 'campaign');
    for (const [i, raw] of readArray(root['campaigns'] ?? [], 'campaign.campaigns').entries()) {
      const where = `campaign.campaigns[${String(i)}]`;
      const o = readObject(raw, where);
      const state = readString(o, 'state', where);
      if (!isCampaignState(state)) throw new SnapshotError(`${where}: unknown campaign state ${state}`);
      const lock = o['bondEncumbranceId'];
      const endedTick = o['endedAtTick'];
      const endedReck = o['endedAtReckoning'];
      const row: CampaignRecord = {
        id: readString(o, 'id', where) as CampaignId,
        attacker: readString(o, 'attacker', where) as PrincipalId,
        defender: readString(o, 'defender', where) as PrincipalId,
        objective: readString(o, 'objective', where) as SystemId,
        depot: readString(o, 'depot', where) as SystemId,
        bond: minor(readInt(o, 'bond', where)),
        bondEncumbranceId: lock === null || lock === undefined ? null : readString(o, 'bondEncumbranceId', where),
        breachesNeeded: readInt(o, 'breachesNeeded', where),
        rebuffsNeeded: readInt(o, 'rebuffsNeeded', where),
        declaredAtTick: readInt(o, 'declaredAtTick', where),
        firstPulseTick: readInt(o, 'firstPulseTick', where),
        state,
        breaches: readInt(o, 'breaches', where),
        rebuffs: readInt(o, 'rebuffs', where),
        starves: readInt(o, 'starves', where),
        pulses: [],
        parties: [],
        endedAtTick: endedTick === null || endedTick === undefined ? null : readInt(o, 'endedAtTick', where),
        endedAtReckoning: endedReck === null || endedReck === undefined ? null : readInt(o, 'endedAtReckoning', where),
        forfeited: minor(readInt(o, 'forfeited', where)),
        returned: minor(readInt(o, 'returned', where)),
      };
      for (const [j, rawParty] of readArray(o['parties'] ?? [], `${where}.parties`).entries()) {
        const pw = `${where}.parties[${String(j)}]`;
        const po = readObject(rawParty, pw);
        const side = readString(po, 'side', pw);
        if (!isCampaignSide(side)) throw new SnapshotError(`${pw}: unknown side ${side}`);
        const enc = po['encumbranceId'];
        row.parties.push({
          principal: readString(po, 'principal', pw) as PrincipalId,
          side,
          stake: minor(readInt(po, 'stake', pw)),
          encumbranceId: enc === null || enc === undefined ? null : readString(po, 'encumbranceId', pw),
          joinedAtTick: readInt(po, 'joinedAtTick', pw),
        });
      }
      for (const [j, rawPulse] of readArray(o['pulses'] ?? [], `${where}.pulses`).entries()) {
        const pw = `${where}.pulses[${String(j)}]`;
        const po = readObject(rawPulse, pw);
        const outcome = readString(po, 'outcome', pw);
        if (!isPulseOutcome(outcome)) throw new SnapshotError(`${pw}: unknown pulse outcome ${outcome}`);
        row.pulses.push({
          index: readInt(po, 'index', pw),
          reckoning: readInt(po, 'reckoning', pw),
          tick: readInt(po, 'tick', pw),
          outcome,
          attackerForce: readInt(po, 'attackerForce', pw),
          defenderForce: readInt(po, 'defenderForce', pw),
          terrain: readInt(po, 'terrain', pw),
          materielSpent: qty(readInt(po, 'materielSpent', pw)),
          attackerHands: readInt(po, 'attackerHands', pw),
          defenderHands: readInt(po, 'defenderHands', pw),
        });
      }
      if (this.rows.has(row.id)) throw new SnapshotError(`${where}: duplicate campaign ${row.id}`);
      this.rows.set(row.id, row);
    }
  }
}

/**
 * The tick this campaign's next PULSE resolves at, or `null` when it has none left.
 *
 * A pure function of the row, so the pulse handler, the affordance, the view and the frame all
 * answer *"when does this move next"* from one place. Two homes for a published clock is scar #5
 * with a war in it — and the failure would be an agent bringing hands on the wrong tick.
 */
export function nextPulseTickOf(campaign: CampaignRecord): number | null {
  if (!isLiveCampaign(campaign.state)) return null;
  if (campaign.pulses.length >= CAMPAIGN_PULSES) return null;
  const last = campaign.pulses[campaign.pulses.length - 1];
  if (last === undefined) return campaign.firstPulseTick;
  // The pulse phase is fixed, so the next one is exactly one Reckoning on from the last. Derived
  // from the last pulse's own tick rather than from `firstPulseTick + n × TICKS_PER_RECKONING`, so a
  // campaign that missed a pulse for any reason resumes on the clock rather than trying to catch up.
  return last.tick + TICKS_PER_RECKONING;
}

/**
 * The campaign book inside `state_hash` and the rollback set.
 *
 * Not optional and not a later step. A campaign row holds a live bond lock and decides whether a
 * future tick takes somebody's territory and slashes 50,000 of their capital — so a hash blind to
 * it would call two worlds identical while one of them was about to do that, and an aborted tick
 * would leave a recorded BREACH against materiel destruction that was rolled back. Seven books were
 * once found outside the hash in one night; there is no eighth and there is no ninth.
 *
 * The entry in `CHECKPOINT_REQUIRED_TABLES` lands in the same change as this function, never as a
 * follow-up: a restorable table missing from the manifest is a book adoption silently drops while
 * the gate reports nothing missing, which is how `mint` and `delivery` were found.
 */
export function campaignStateTable(getBook: () => Book, setBook: (book: Book) => void): StateTable {
  return {
    name: 'campaign',
    capture(): CanonicalValue {
      return getBook().capture();
    },
    restore(captured: CanonicalValue): void {
      const fresh = new Book();
      fresh.restore(captured);
      setBook(fresh);
    },
  };
}
