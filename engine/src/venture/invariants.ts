/**
 * The venture invariants, for the ASSERT phase of every tick (`TESTING.md` §3).
 *
 * These run **in production, forever**, not only in CI. At ~500 open ventures with
 * <=8 roles each that is ~4,000 rows, so there is no reason to sample, and on
 * failure the tick aborts and the world halts rather than publishing (§15.2).
 *
 * Three claims, and each is here because the alternative is unrecoverable:
 *
 *   - **INV-9** — a hand appears in at most one live `filled_by_hand_id`. A hand in
 *     two ventures is a hand paid twice.
 *   - **INV-6** — a settled venture's splits sum exactly to its proceeds, with the
 *     remainder accounted. "Rounding leaks are how a ledger silently stops
 *     balancing", and an append-only ledger cannot be corrected afterwards.
 *   - **PROP-V6 / PROP-V5** — the structural rules that force cooperation and keep
 *     A7 alive. Not invariants in `TESTING.md`'s numbering, asserted here anyway,
 *     because both fail *silently into a playable game*: cooperation quietly becomes
 *     optional, or every venture quietly becomes fully escrowed and nothing is ever
 *     trusted. Neither would break a test that was not looking for it.
 *
 * Returns violations rather than throwing, matching `world/invariants.ts`: the tick
 * loop owns the halt, because halting is a world-level decision with defined
 * semantics (PAUSED, last good snapshot, queued submissions) and a module that threw
 * from inside a phase would bypass all of it.
 */

import type { InvariantViolation } from '../core/types.js';
import { addMinor, minor, type Minor } from '../core/units.js';
import { compareIds } from '../ledger/index.js';
import { VentureBook } from './book.js';
import { assertKindTable, electiveFloor, isEscrowable, isTopYield, minRoles } from './kinds.js';
import { SettlementHalt, assertClaimsExact, type VentureSettlement } from './settlement.js';
import { pinnedConsideration, validateRoleTerms } from './terms.js';
import { isLive, partiesOf, termsHashOf } from './venture.js';

function violation(id: string, tick: number, message: string): InvariantViolation {
  return { id, message, tick, severity: 'HALT' };
}

/**
 * The structural rules on every venture in the book: role count, one principal per
 * role, `f(kind)`, un-escrowable top kinds, and the pinned `terms_hash`.
 */
export function checkVentureStructure(book: VentureBook, tick: number): InvariantViolation[] {
  const out: InvariantViolation[] = [];

  for (const venture of book.all()) {
    // PROP-V6 clause 3, and the arithmetic that makes cooperation compulsory.
    if (venture.roles.length < minRoles(venture.kind)) {
      out.push(
        violation(
          'PROP-V6',
          tick,
          `${venture.id} (${venture.kind}) has ${venture.roles.length} roles but the kind needs ` +
            `>=${minRoles(venture.kind)}${isTopYield(venture.kind) ? ' as a top-yield kind' : ''}; ` +
            'fewer roles means fewer principals required and presence scarcity stops binding',
        ),
      );
    }

    // PROP-V6 clause 2. Asserted as well as enforced at fill time, because it is the
    // clause that makes "a solo principal cannot satisfy a top-yield kind at any
    // capital level" true, and it is one line away from being false.
    const seen = new Map<string, number[]>();
    for (const role of venture.roles) {
      if (role.filledByPrincipal === null) continue;
      const list = seen.get(role.filledByPrincipal) ?? [];
      list.push(role.index);
      seen.set(role.filledByPrincipal, list);
    }
    for (const [principal, indices] of [...seen.entries()].sort((a, b) => compareIds(a[0], b[0]))) {
      if (indices.length > 1) {
        out.push(
          violation(
            'PROP-V6',
            tick,
            `${principal} fills roles ${indices.join(', ')} in ${venture.id}; one principal fills at ` +
              'most one role in a venture',
          ),
        );
      }
    }

    // A fully-filled venture must have as many distinct principals as roles. The
    // headline claim, stated positively so a bug that lets two roles share a
    // principal is caught even if the check above is somehow satisfied.
    const filledCount = venture.roles.filter((r) => r.filledByPrincipal !== null).length;
    if (filledCount > 0 && partiesOf(venture).length !== filledCount) {
      out.push(
        violation(
          'PROP-V6',
          tick,
          `${venture.id} has ${filledCount} filled roles held by only ${partiesOf(venture).length} ` +
            'distinct principals',
        ),
      );
    }

    for (const role of venture.roles) {
      const check = validateRoleTerms(venture.kind, role.terms);
      if (!check.ok) {
        out.push(
          violation(
            check.invariant,
            tick,
            `${venture.id} role ${role.index} (${role.label}): ${check.hint}`,
          ),
        );
      }
      // Restated independently of the validator, because PROP-V5's whole point is
      // that a zero elective part is *playable* and therefore invisible: if this
      // silently stopped holding, every venture would become fully escrowed, nobody
      // would ever risk trust, and no other assertion in the codebase would notice.
      const total = pinnedConsideration(role.terms);
      const floor = electiveFloor(venture.kind, total);
      if (role.terms.elective < floor) {
        out.push(
          violation(
            'PROP-V5',
            tick,
            `${venture.id} role ${role.index} has elective ${role.terms.elective} under f(${venture.kind}) ` +
              `= ${floor} on a role priced at ${total}; A7's priced tail is what standing accrues to`,
          ),
        );
      }
      if (!isEscrowable(venture.kind) && role.terms.escrowed !== 0) {
        out.push(
          violation(
            'PROP-V5',
            tick,
            `${venture.id} is a top-yield kind and is legally un-escrowable, but role ${role.index} ` +
              `escrows ${role.terms.escrowed}`,
          ),
        );
      }
      if (role.filledByHandId === null && role.filledByPrincipal !== null) {
        out.push(
          violation(
            'INV-9',
            tick,
            `${venture.id} role ${role.index} names principal ${role.filledByPrincipal} with no hand; ` +
              'commitment lives in filled_by_hand_id and nowhere else',
          ),
        );
      }
      if (role.filledByHandId !== null && role.filledByPrincipal === null) {
        out.push(
          violation('INV-9', tick, `${venture.id} role ${role.index} names a hand with no principal`),
        );
      }
      // The paid-so-far markers are what give §15.3's deferral a memory, so they are
      // asserted rather than trusted: a negative or fractional marker means a settlement
      // pass un-paid a role, and the next pass would then re-pay value that had already
      // moved — the double-charge and the fabricated default that came with it.
      for (const [what, amount] of [
        ['escrowed', role.settledEscrowedMinor],
        ['elective', role.settledElectiveMinor],
      ] as const) {
        if (!Number.isSafeInteger(amount) || amount < 0) {
          out.push(
            violation(
              'INV-6',
              tick,
              `${venture.id} role ${role.index} has settled ${what} ${String(amount)}; the paid-so-far ` +
                'markers are whole, non-negative and monotonic or a deferral can forget a payment',
            ),
          );
        }
      }
    }

    // A7's escrowed half auto-executes at the *first* settlement, so an obligation that
    // has deferred has necessarily executed it. A DEFERRED venture with no execution
    // marker means phase 1 was skipped without ever having run: the escrow is stranded
    // and every subsequent receipt publishes a shortfall on the one half A7 guarantees.
    if (venture.state === 'DEFERRED' && venture.escrowExecutedAtTick === null) {
      out.push(
        violation(
          'PROP-V4',
          tick,
          `${venture.id} has deferred without ever executing its escrowed parts; the escrowed half ` +
            'always executes, so a deferral that skipped it is a receipt denying its own guarantee',
        ),
      );
    }
    if (venture.escrowExecutedAtTick !== null && venture.state === 'FORMING') {
      out.push(
        violation(
          'PROP-V4',
          tick,
          `${venture.id} is FORMING but its escrowed parts have executed; settlement ran on a venture ` +
            'that was never live',
        ),
      );
    }

    // INV-15 / §15.4: the terms a venture settles on are the terms that were
    // countersigned. Recomputing the hash every tick is cheap and it is the only
    // thing that makes "pinned" mean pinned.
    if (venture.termsHash !== null) {
      const recomputed = termsHashOf(venture);
      if (recomputed !== venture.termsHash) {
        out.push(
          violation(
            'INV-15',
            tick,
            `${venture.id}'s terms no longer hash to the countersigned ${venture.termsHash.slice(0, 12)} ` +
              `(now ${recomputed.slice(0, 12)}); a pinned obligation was rewritten`,
          ),
        );
      }
    }

    if (isLive(venture) && venture.windowClosesTick < venture.windowOpensTick) {
      out.push(
        violation('PROP-V6', tick, `${venture.id}'s window closes before it opens`),
      );
    }
  }

  return out;
}

/** INV-9 and PROP-V6's window clause, from the book's own index. */
export function checkVentureIndex(book: VentureBook, tick: number): InvariantViolation[] {
  return book.checkVentureInvariants(tick);
}

/**
 * INV-6 on a completed settlement.
 *
 * Distinct from `assertClaimsExact`, which checks the *plan*. This checks the
 * *outcome*: nothing was paid that was not claimed, no payout went negative, and the
 * escrowed and elective halves add back to the claim. A settlement that planned
 * correctly and paid wrongly is the interesting bug, and it is the one a plan-only
 * assertion cannot see.
 */
export function checkSettlementExact(
  settlement: VentureSettlement,
  tick: number,
): InvariantViolation[] {
  const out: InvariantViolation[] = [];
  try {
    assertClaimsExact(settlement.claims);
  } catch (err) {
    out.push(
      violation(
        'INV-6',
        tick,
        err instanceof SettlementHalt ? err.message : `${settlement.venture}: ${String(err)}`,
      ),
    );
  }

  for (const p of settlement.payouts) {
    if (p.escrowedPaid < 0 || p.electivePaid < 0) {
      out.push(
        violation('INV-6', tick, `${settlement.venture} role ${p.roleIndex} has a negative payout`),
      );
    }
    if (p.escrowedPaid > p.escrowedDue) {
      out.push(
        violation(
          'INV-6',
          tick,
          `${settlement.venture} role ${p.roleIndex} was paid ${p.escrowedPaid} from escrow against a ` +
            `guaranteed ${p.escrowedDue}`,
        ),
      );
    }
    if (p.electivePaid > p.electiveDue) {
      out.push(
        violation(
          'INV-6',
          tick,
          `${settlement.venture} role ${p.roleIndex} was paid ${p.electivePaid} elective against ` +
            `${p.electiveDue} due`,
        ),
      );
    }
    if (addMinor(p.escrowedPaid, p.escrowedShortfall) !== p.escrowedDue) {
      out.push(
        violation(
          'INV-6',
          tick,
          `${settlement.venture} role ${p.roleIndex}: escrowed paid + shortfall != due`,
        ),
      );
    }
    if (addMinor(p.electivePaid, p.electiveShortfall) !== p.electiveDue) {
      out.push(
        violation(
          'INV-6',
          tick,
          `${settlement.venture} role ${p.roleIndex}: elective paid + shortfall != due`,
        ),
      );
    }
  }

  // INV-17, the A5' group's highest severity. Every default names the event that
  // caused it, or the record is the game accusing an innocent agent.
  for (const d of settlement.defaults) {
    if (d.amount <= 0) {
      out.push(
        violation('INV-17', tick, `${settlement.venture} records a default of ${d.amount}`),
      );
    }
    if (d.causeEventId.length === 0) {
      out.push(
        violation(
          'INV-17',
          tick,
          `${settlement.venture} role ${d.roleIndex} defaults with no attributable cause`,
        ),
      );
    }
    if (d.payer === d.payee) {
      out.push(
        violation(
          'INV-17',
          tick,
          `${settlement.venture} records ${d.payer} defaulting to itself; self-dealing is not a promise`,
        ),
      );
    }
  }

  // INV-21: standing moves only on an elective part honoured or a default. A
  // 100%-escrowed venture earns a performance record and zero standing (PROP-S2), so
  // an entry with neither is a leak in the one vector that must not be farmable.
  for (const s of settlement.standing) {
    if (s.electiveHonoured === 0 && s.defaults === 0) {
      out.push(
        violation(
          'INV-21',
          tick,
          `${settlement.venture} reports a standing change for ${s.principal} that is neither an ` +
            'elective part honoured nor a default',
        ),
      );
    }
    if (s.principal === s.counterparty) {
      out.push(
        violation(
          'INV-21',
          tick,
          `${settlement.venture} reports standing for ${s.principal} against itself; self-dealing yields ` +
            'zero (scar #9)',
        ),
      );
    }
  }

  return out;
}

/**
 * PROP-V6's headline as an assertion over the whole kind table, not one case.
 *
 * "Assert a solo principal *cannot* satisfy a top-yield kind at any capital level."
 * The reason this can be asserted without a capital argument at all is the whole
 * point: the requirement is a role count and a one-role-per-principal rule, and
 * neither takes a balance.
 */
export function assertSoloCannotSatisfyTopYield(): void {
  assertKindTable();
  const problems: string[] = [];
  for (const kind of ['BUILD', 'DIG', 'ESCORT', 'HAUL', 'LEVY', 'RAID', 'SIEGE', 'SURVEY'] as const) {
    if (!isTopYield(kind)) continue;
    if (minRoles(kind) < 2) {
      problems.push(`${kind} is top-yield but needs only ${minRoles(kind)} roles, so one principal suffices`);
    }
    if (isEscrowable(kind)) {
      problems.push(`${kind} is top-yield but escrowable; §7.5 makes the highest prizes un-escrowable`);
    }
  }
  if (problems.length > 0) {
    throw new SettlementHalt(`PROP-V6:\n  - ${problems.join('\n  - ')}`);
  }
}

/** Every venture check, for the tick's ASSERT phase. */
export function checkVentureInvariants(book: VentureBook, tick: number): InvariantViolation[] {
  return [...checkVentureStructure(book, tick), ...checkVentureIndex(book, tick)];
}

/** Σ of a settlement's elective value paid — the only input to standing (§6.4). */
export function electiveHonouredValue(settlement: VentureSettlement): Minor {
  let total = 0;
  for (const s of settlement.standing) total += s.electiveHonouredValue;
  return minor(total);
}
