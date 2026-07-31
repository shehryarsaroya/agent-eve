/**
 * `withdraw` — leaving a venture before it binds, as a function of its inputs.
 *
 * Third extraction under `D21`'s coupling order (2 runtime members: the venture book and the hand it
 * releases).
 *
 * ── THE RULE THIS VERB EXISTS TO STATE ───────────────────────────────────────
 *
 * You may leave while a venture is **FORMING** and not after. Once it is LIVE the way out is to decline
 * the elective half at settlement — **and that is a default on the record.** A7 is the reason: the
 * escrowed part auto-executes and the elective part stays a promise, so an exit that cost nothing after
 * binding would make every promise free to break quietly and delete the only thing the game measures.
 *
 * The refusal says both halves, because "you may not withdraw" without "here is the exit that does
 * exist, and here is what it costs you" is a dead end an agent pays for every wake (A2).
 *
 * ── ★ AND IT IS WHERE A STAKE IS ACTUALLY LOST (§7.3) ────────────────────────
 *
 * > **"Abandoning a filled slot forfeits the stake to the other parties, not to a sink.** Forfeiture
 * > to the void is a griefer's bargain; forfeiture to the counterparties makes a no-show a transfer,
 * > so griefing pays the victim." — §7.3
 *
 * This is the one place in the venture layer where A7's *staked* half can genuinely be destroyed for
 * its owner, and it is what makes the escrow at fill time a price rather than a deposit. Until
 * `lockFillStake` had a caller there was never a stake here to forfeit, so the `withdraw` affordance
 * said *"no stake to forfeit"* — truthfully, and about a mechanism that did not run.
 */

import { readString } from '../core/params.js';
import type { HandId, PrincipalId, VentureId } from '../core/types.js';
import { minor, type Minor } from '../core/units.js';
import { largestRemainder } from '../core/allocate.js';
import { compareIds } from '../ledger/order.js';
import { reject, type WorldResult } from '../world/result.js';
import { roleOfPrincipal, vacateRole, type VentureRecord } from './venture.js';

/** What `withdraw` touches: the venture, the hand it hands back, and the stake it forfeits. */
export interface WithdrawPort {
  readonly ventureOf: (id: VentureId) => VentureRecord | undefined;
  /** Drop the venture book's index entry for a freed hand. */
  readonly releaseIndex: (hand: HandId) => void;
  /** Return a committed hand to IDLE. A no-op if it is in any other state. */
  readonly freeHand: (hand: HandId) => void;
  /** What this role's open stake lock currently holds. Zero when it never staked. */
  readonly stakedOn: (venture: VentureRecord, roleIndex: number) => Minor;
  /**
   * Release this role's stake lock and pay it out in the shares given. A no-op on an empty list.
   * Never throws: a forfeit that could halt the tick would make `withdraw` — R5's unconditional
   * right — an agent-reachable outage (§15.4).
   */
  readonly forfeitStake: (
    venture: VentureRecord,
    roleIndex: number,
    shares: readonly (readonly [PrincipalId, Minor])[],
  ) => void;
}

/**
 * Who the forfeited stake goes to, and in what shares. **Pure, so the split is testable.**
 *
 * "The other parties" of a FORMING venture are its creator and every *other* filled role holder,
 * deduplicated — the creator is always one of them (it is the party that escrowed at signing and
 * whose window is what closes), and a second filler is one because it committed a hand to a venture
 * this withdrawal may now leave unformed.
 *
 * Split **evenly**, not by role value: this is a penalty on the leaver rather than compensation
 * measured against anyone's loss, and a value-weighted split would need the claim waterfall run on a
 * venture that never bound. Sorted by principal id and the remainder given to the earliest, so two
 * replays of the same action log move the same minor units (DET-1).
 */
export function forfeitShares(
  venture: VentureRecord,
  withdrawer: PrincipalId,
  amount: Minor,
): readonly (readonly [PrincipalId, Minor])[] {
  if (amount <= 0) return [];
  const others = new Set<PrincipalId>();
  if (venture.creator !== withdrawer) others.add(venture.creator);
  for (const role of venture.roles) {
    const holder = role.filledByPrincipal;
    if (holder !== null && holder !== withdrawer) others.add(holder);
  }
  const payees = [...others].sort(compareIds);
  if (payees.length === 0) return [];
  // `largestRemainder` over equal weights, not a private `trunc` + hand-dealt remainder
  // (the ONE-HOME sweep). Provably the same vector — equal weights make the allocator's tie-break the
  // index order, which is what the hand-rolled loop was doing by walking `payees` in `compareIds`
  // order — and the reason to swap is that this is a forfeit being split between real principals, so
  // the allocator that asserts Σ === amount is the one that should compute it. The old loop asserted
  // nothing; a remainder it failed to deal would have vanished silently.
  const shares = largestRemainder(amount, payees.map(() => 1));
  const out: (readonly [PrincipalId, Minor])[] = [];
  for (const [i, payee] of payees.entries()) {
    const share = shares[i] ?? minor(0);
    if (share > 0) out.push([payee, share]);
  }
  return out;
}

export function withdraw(
  port: WithdrawPort,
  principal: PrincipalId,
  params: Readonly<Record<string, unknown>>,
): WorldResult<null> {
  const ventureId = readString(params, ['venture', 'venture_id']) as VentureId | null;
  if (ventureId === null) return reject('A2', 'withdraw needs {"venture": "<id>"}.');
  const venture = port.ventureOf(ventureId);
  if (venture === undefined) return reject('PROP-V6', `there is no venture ${ventureId}.`);
  if (venture.state !== 'FORMING') {
    return reject(
      'PROP-V6',
      `${ventureId} is ${venture.state}. You may withdraw from a venture while it is FORMING; once it is ` +
        'LIVE the way out is to decline the elective part at settlement, and that is a default on the record.',
    );
  }
  const role = roleOfPrincipal(venture, principal);
  if (role === null) return reject('PROP-V6', `you hold no role in ${ventureId}.`);
  // ── ★ THE STAKE GOES BEFORE THE ROLE DOES, AND THE ORDER IS LOAD-BEARING ──
  //
  // {@link forfeitShares} reads `role.filledByPrincipal` to find the other parties, and
  // {@link vacateRole} clears exactly that field. Computed after the vacate, the withdrawer would be
  // invisible to its own exclusion test — harmless — but a *second* filler would be too if the roles
  // were cleared in a loop, and this ordering makes the dependency explicit rather than lucky.
  port.forfeitStake(venture, role.index, forfeitShares(venture, principal, port.stakedOn(venture, role.index)));
  const freed = vacateRole(venture, role.index);
  if (freed !== null) {
    port.releaseIndex(freed);
    port.freeHand(freed);
  }
  return { ok: true, value: null };
}
