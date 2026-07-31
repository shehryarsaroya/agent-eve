/**
 * `CMP-1` … `CMP-7` — campaigns as executable rules rather than as review items.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE TWENTY-SIX STAY TWENTY-SIX.** `invariants/registry.ts` holds `TESTING.md` §3's numbered
 * twenty-six, and growing that list quietly is how "the 26" becomes a number nobody can trust. So
 * this is a prefixed module family in the shape `PRD-*`, `SOV-*`, `OPS-*`, `MKT-*` and `INV-W*`
 * already use: supplied through the tick loop's `assertions` hook, merged into the same ASSERT pass,
 * halting on the same terms.
 *
 * Every function returns violations and **none throws**. A campaign row is reachable from three
 * agent-triggerable verbs, and a throw out of a phase becomes `TICK-STAGE` — an outage in front of
 * an audience (A14) where a refusal would have cost one action.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ## CMP-6 is the one that exists because of `Book.prune`
 *
 * The retention rule this module depends on is *"an undecided campaign is never pruned"*, and the
 * failure mode is silent: the row vanishes, no pulse is due, no bond is released, and the SAP leaves
 * the map with an attacker's capital inside it. Nothing would report it. So `CMP-6` audits the rule
 * from **the row's own counters** — `pulses.length` must equal `breaches + rebuffs`, and a live row
 * must still hold its bond lock — which is a property a dropped row cannot have and a truncated log
 * fails immediately.
 *
 * The complementary half is a test rather than an invariant, because the invariant can only see rows
 * that still exist: `test/campaign/retention.spec.ts` runs a whole campaign with `prune` called on
 * every tick and asserts by name that the row is still there at the verdict.
 */

import { phaseOfReckoning } from '../core/time.js';
import type { InvariantViolation, PrincipalId, SystemId, ZoneTier } from '../core/types.js';
import type { Minor, Qty } from '../core/units.js';
import { halt } from '../invariants/registry.js';
import { compareIds } from '../ledger/order.js';
import { Book, isLiveCampaign, nextPulseTickOf, type CampaignRecord } from './book.js';
import {
  CAMPAIGN_PULSES,
  CAMPAIGN_PULSE_PHASE,
  MAX_CAMPAIGN_PARTIES,
  MAX_CAMPAIGNS,
  MAX_LIVE_CAMPAIGNS,
  PULSE_MATERIEL_QTY,
  breachesToTake,
} from './params.js';

export interface CampaignInvariantInputs {
  readonly book: Book;
  readonly tick: number;
  readonly tierOf: (system: SystemId) => ZoneTier;
  /**
   * MATERIEL the posting log says this campaign actually destroyed, or `null` when no ledger is
   * attached. `CMP-3`'s second road — the A5′ input, exactly as `movedForRaid` is `PRD-3`'s.
   */
  readonly materielDestroyedFor: (campaign: CampaignRecord) => Qty | null;
  /** Is this encumbrance id still an open lock? `CMP-6`'s bond-lock input. */
  readonly lockIsOpen: (encumbranceId: string) => boolean;
}

export function checkCampaignInvariants(input: CampaignInvariantInputs): readonly InvariantViolation[] {
  return [
    ...checkCmp1(input),
    ...checkCmp2(input),
    ...checkCmp3(input),
    ...checkCmp4(input),
    ...checkCmp5(input),
    ...checkCmp6(input),
    ...checkCmp7(input),
  ];
}

/**
 * **CMP-1 — no campaign touches the Commons, at either end, live or historical.**
 *
 * §16.6 MUST-1 is the one absolute in the whole section, and A8 makes it a *result* rather than a
 * gate: *"in the Commons, hostile action is INVALID, not merely punished."* `declareRefusal` checks
 * both ends, and a floor held up by one caller behaving well is not a floor. The DEPOT half is the
 * one that could not be inferred from anywhere else: a Commons claim cannot exist, so a Commons
 * OBJECTIVE is unreachable through the claim book — but a Commons **depot** would be reachable the
 * day somebody's holding is Commons-seated and the adjacency gate passes, and it would make the
 * sanctuary an arsenal.
 */
export function checkCmp1(input: CampaignInvariantInputs): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  for (const c of input.book.all()) {
    for (const [role, system] of [
      ['objective', c.objective],
      ['depot', c.depot],
    ] as const) {
      if (input.tierOf(system) !== 'COMMONS') continue;
      out.push(
        halt(
          'A8',
          input.tick,
          `campaign ${c.id} has its ${role} at ${system}, which is a COMMONS system. §16.6 MUST-1 makes the ` +
            'Commons absolutely uncampaignable at both ends: nothing there may be fought over, and a depot ' +
            'inside it would make the one place nobody may attack into the staging ground for attacking ' +
            'everywhere else',
        ),
      );
    }
  }
  return out;
}

/** **CMP-2 — the book stays inside every bound it declared** (INV-26, scar #3). */
export function checkCmp2(input: CampaignInvariantInputs): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  const book = input.book;
  if (book.size() > MAX_CAMPAIGNS) {
    out.push(halt('INV-26', input.tick, `the campaign book holds ${String(book.size())} rows, cap ${String(MAX_CAMPAIGNS)}`));
  }
  if (book.liveCount() > MAX_LIVE_CAMPAIGNS) {
    out.push(
      halt('INV-26', input.tick, `${String(book.liveCount())} campaigns are live, cap ${String(MAX_LIVE_CAMPAIGNS)}`),
    );
  }
  for (const c of book.all()) {
    if (c.parties.length > MAX_CAMPAIGN_PARTIES) {
      out.push(
        halt('INV-26', input.tick, `campaign ${c.id} holds ${String(c.parties.length)} parties, cap ${String(MAX_CAMPAIGN_PARTIES)}`),
      );
    }
    if (c.pulses.length > CAMPAIGN_PULSES) {
      out.push(
        halt(
          'INV-26',
          input.tick,
          `campaign ${c.id} has run ${String(c.pulses.length)} pulses and its clock is ${String(CAMPAIGN_PULSES)}; ` +
            'a campaign that outlived its own sunset is the endless aggression §16.6 MUST-20 cuts',
        ),
      );
    }
    // Out-of-order arrays hash differently on two hosts (DET-1/DET-2). Checked rather than sorted at
    // read, so a caller that appended in arrival order fails here instead of diverging in production.
    const ordered = [...c.parties].sort((a, b) => compareIds(a.principal, b.principal));
    if (c.parties.some((p, i) => p.principal !== ordered[i]?.principal)) {
      out.push(halt('INV-26', input.tick, `campaign ${c.id}'s roster is not in canonical order`));
    }
    if (c.pulses.some((p, i) => p.index !== i)) {
      out.push(halt('INV-26', input.tick, `campaign ${c.id}'s pulse log is not contiguously indexed from zero`));
    }
    if (new Set(c.parties.map((p) => p.principal)).size !== c.parties.length) {
      out.push(halt('INV-26', input.tick, `campaign ${c.id} lists a principal twice on its roster`));
    }
  }
  return out;
}

/**
 * **CMP-3 — every recorded `materielSpent` is what the posting log actually destroyed** (A5′).
 *
 * `PRD-3`'s shape, and the accusation here is bigger: a recorded BREACH the world was not paid for
 * moves territory, and the sum of the log is what says whether a campaign was ever supplied at all.
 * Halts on a mismatch **in either direction** — over-recording is the world crediting an assault
 * nobody funded, under-recording is the world having destroyed goods it did not account for.
 *
 * Skipped, not failed, when `materielDestroyedFor` returns `null`: no ledger is attached in a
 * book-only fixture, and a checker that failed on its own absence of inputs is the flattery this
 * repo has already paid for once.
 */
export function checkCmp3(input: CampaignInvariantInputs): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  for (const c of input.book.all()) {
    const recorded = c.pulses.reduce((n, p) => n + p.materielSpent, 0);
    const moved = input.materielDestroyedFor(c);
    if (moved === null) continue;
    if (recorded !== moved) {
      out.push(
        halt(
          'A5-PRIME',
          input.tick,
          `campaign ${c.id} records ${String(recorded)} of materiel spent over ${String(c.pulses.length)} ` +
            `pulses and the posting log moved ${String(moved)}. A pulse's supply is what says whether an ` +
            'assault happened at all, and a figure that cannot be reproduced is a permanent public fact about ' +
            'a war that may not have been fought',
        ),
      );
    }
    for (const p of c.pulses) {
      if (p.outcome === 'STARVED' && p.materielSpent !== 0) {
        out.push(
          halt(
            'A5-PRIME',
            input.tick,
            `campaign ${c.id} pulse ${String(p.index)} is recorded STARVED and spent ${String(p.materielSpent)} ` +
              'of materiel. A starve is by definition a pulse that found nothing to spend',
          ),
        );
      }
      if (p.outcome !== 'STARVED' && p.materielSpent !== PULSE_MATERIEL_QTY) {
        out.push(
          halt(
            'A5-PRIME',
            input.tick,
            `campaign ${c.id} pulse ${String(p.index)} is recorded ${p.outcome} having spent ` +
              `${String(p.materielSpent)}; a pressed pulse spends exactly ${String(PULSE_MATERIEL_QTY)} or it ` +
              'is a starve. A partial spend would buy a fraction of a breach, which this design has no ' +
              'arithmetic for',
          ),
        );
      }
    }
  }
  return out;
}

/**
 * **CMP-4 — every pulse's verdict follows from the two forces it published** (A2, A5′).
 *
 * The tie-break is the clause worth halting over: §9's rule is *higher wins, ties to the defender*,
 * and an inverted tie would hand over territory on an equal reading. Both directions are checked, so
 * a resolver that silently used `>=` fails here rather than in six Reckonings' worth of frames.
 */
export function checkCmp4(input: CampaignInvariantInputs): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  for (const c of input.book.all()) {
    for (const p of c.pulses) {
      if (p.outcome === 'STARVED') continue;
      const shouldBreach = p.attackerForce > p.defenderForce;
      if (shouldBreach && p.outcome !== 'BREACH') {
        out.push(
          halt(
            'A5-PRIME',
            input.tick,
            `campaign ${c.id} pulse ${String(p.index)} published attacker ${String(p.attackerForce)} against ` +
              `defender ${String(p.defenderForce)} and recorded ${p.outcome}. Higher force wins`,
          ),
        );
      }
      if (!shouldBreach && p.outcome === 'BREACH') {
        out.push(
          halt(
            'A5-PRIME',
            input.tick,
            `campaign ${c.id} pulse ${String(p.index)} recorded a BREACH on attacker ${String(p.attackerForce)} ` +
              `against defender ${String(p.defenderForce)}. Ties go to the DEFENDER, so this is territory ` +
              'taken on a reading that did not take it',
          ),
        );
      }
    }
  }
  return out;
}

/**
 * **CMP-5 — a campaign's money is conserved and its scope was never rewritten.**
 *
 * `forfeited + returned === bond` on every ended campaign, so no ending can quietly create or
 * destroy an attacker's capital; and `breachesNeeded` must still be a value `breachesToTake` can
 * produce, so a scope pinned at declaration cannot have been widened afterwards. §16.6 MUST-2 makes
 * scope expansion require a bond top-up, and this build has no top-up — so scope is immutable and
 * this is the assertion of it.
 */
export function checkCmp5(input: CampaignInvariantInputs): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  const scopes = new Set([breachesToTake('SUPPLIED'), breachesToTake('STRAINED')]);
  for (const c of input.book.all()) {
    if (!scopes.has(c.breachesNeeded)) {
      out.push(
        halt(
          'A5-PRIME',
          input.tick,
          `campaign ${c.id} requires ${String(c.breachesNeeded)} breaches, which is not a published scope. A ` +
            'campaign\'s scope is pinned at declaration and there is no top-up verb, so a changed scope is the ' +
            'record disagreeing with what the attacker was shown',
        ),
      );
    }
    if (isLiveCampaign(c.state)) {
      if (c.forfeited !== 0 || c.returned !== 0) {
        out.push(
          halt(
            'A5-PRIME',
            input.tick,
            `campaign ${c.id} is ${c.state} and has already moved ${String(c.forfeited)} forfeit / ` +
              `${String(c.returned)} returned. A live campaign's bond is locked, not settled`,
          ),
        );
      }
      continue;
    }
    if (c.forfeited + c.returned !== c.bond) {
      out.push(
        halt(
          'INV-1',
          input.tick,
          `campaign ${c.id} ended ${c.state} with ${String(c.forfeited)} forfeit and ${String(c.returned)} ` +
            `returned against a bond of ${String(c.bond)}. An ending that does not account for the whole bond ` +
            'either mints capital or destroys it',
        ),
      );
    }
    if (c.state === 'TAKEN' && c.forfeited !== 0) {
      out.push(
        halt(
          'A5-PRIME',
          input.tick,
          `campaign ${c.id} was TAKEN and still forfeited ${String(c.forfeited)}. The bond prices FAILURE, not ` +
            'war — a winner that pays it would make the mechanic a recurring fee, which §16.6 MUST-20 cuts',
        ),
      );
    }
  }
  return out;
}

/**
 * **CMP-6 — a live campaign's row is intact and still holds its bond.** The prune audit.
 *
 * See this file's header. Three clauses, and each is a shape a dropped or truncated row cannot have:
 * the pulse log's length equals the counters it produced; a live campaign holds an open bond lock;
 * and a live campaign's next pulse lands on the published phase. The third catches a clock that has
 * drifted off `CAMPAIGN_PULSE_PHASE`, which would be a scheduled decision at an unpublished tick —
 * A4's forbidden advantage from presence, arriving through arithmetic.
 */
export function checkCmp6(input: CampaignInvariantInputs): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  for (const c of input.book.all()) {
    if (c.pulses.length !== c.breaches + c.rebuffs) {
      out.push(
        halt(
          'A5-PRIME',
          input.tick,
          `campaign ${c.id} holds ${String(c.pulses.length)} pulses against counters of ${String(c.breaches)} ` +
            `breaches + ${String(c.rebuffs)} rebuffs. Either the log was truncated — retention dropping a row ` +
            'a live mechanic depends on, which Book.prune has done five times in this repo — or a counter ' +
            'moved without a pulse behind it',
        ),
      );
    }
    if (!isLiveCampaign(c.state)) {
      if (c.bondEncumbranceId !== null && input.lockIsOpen(c.bondEncumbranceId)) {
        out.push(
          halt(
            'INV-4',
            input.tick,
            `campaign ${c.id} ended ${c.state} and its bond lock ${c.bondEncumbranceId} is still open. An ended ` +
              "war holding an attacker's capital is that capital destroyed without a posting",
          ),
        );
      }
      continue;
    }
    if (c.bondEncumbranceId === null || !input.lockIsOpen(c.bondEncumbranceId)) {
      out.push(
        halt(
          'INV-4',
          input.tick,
          `campaign ${c.id} is ${c.state} and holds no open bond lock. An attacker with nothing at risk is ` +
            'weather rather than a character (A7), and the record says it posted one',
        ),
      );
    }
    const next = nextPulseTickOf(c);
    // `phaseOfReckoning`, not a hand-inlined copy of its body with the cycle length written three
    // times (the ONE-HOME sweep). This is the A14 halt for "a scheduled decision at an unpublished
    // tick"; a guard that computes the phase differently from the clock it guards is the defect it
    // was written to catch.
    if (next !== null && phaseOfReckoning(next) !== CAMPAIGN_PULSE_PHASE) {
      out.push(
        halt(
          'A14',
          input.tick,
          `campaign ${c.id}'s next pulse is tick ${String(next)}, which is not phase ` +
            `${String(CAMPAIGN_PULSE_PHASE)} of a Reckoning. A scheduled decision at an unpublished tick is a ` +
            'clock nobody can read, and it lands when whoever is awake decides (A4, A14)',
        ),
      );
    }
  }
  return out;
}

/**
 * **CMP-7 — nobody campaigns against itself, and no roster row shadows a principal.**
 *
 * §9's related-party clause in the one form decidable without a graph, plus the double-count guard:
 * `readCampaignForce` counts the attacker's and defender's own hands as each side's base, so a
 * roster row for either would count the same hands twice — inflating a side's force with nothing
 * standing anywhere, which is the one way this arithmetic could produce a verdict out of nothing.
 */
export function checkCmp7(input: CampaignInvariantInputs): readonly InvariantViolation[] {
  const out: InvariantViolation[] = [];
  for (const c of input.book.all()) {
    if (c.attacker === c.defender) {
      out.push(
        halt(
          'A15',
          input.tick,
          `campaign ${c.id} names ${c.attacker} as both attacker and defender. §9 gives related-party losses ` +
            'zero salvage and zero standing, because self-predation is a faucet plus a bravery receipt',
        ),
      );
    }
    for (const principal of [c.attacker, c.defender] as readonly PrincipalId[]) {
      if (!c.parties.some((p) => p.principal === principal)) continue;
      out.push(
        halt(
          'A5-PRIME',
          input.tick,
          `campaign ${c.id} carries ${principal} on its roster and it is already one of the two sides. Its ` +
            'hands would be counted twice, which is force from nowhere',
        ),
      );
    }
    if (c.objective === c.depot) {
      out.push(
        halt(
          'A2',
          input.tick,
          `campaign ${c.id}'s depot and objective are both ${c.objective}. A campaign is supplied across a ` +
            'lane; with no lane there is no corridor for a defender to cut, and MUST-5 is the mechanic',
        ),
      );
    }
  }
  return out;
}

/** Zero, typed, for a port with no ledger attached. */
export const NO_FORFEIT: Minor = 0 as Minor;
