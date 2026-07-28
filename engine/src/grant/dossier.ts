/**
 * The **DossierBook** — evidence, custody, and the delayed audit (SPEC §8, §11.2, §14;
 * `PASS-TERRITORY-POLITICS` §16.7 MUST-8 and MUST-9).
 *
 * ── WHAT A DOSSIER IS, AND WHY IT IS NOT A `leak()` VERB ─────────────────────
 *
 * A **DOSSIER** is one signed, dated extract of one COMPARTMENT of one principal's private
 * facts, handed to one named principal. It is cut and handed by `message` — the ordinary
 * §7.3 negotiation verb — and A6 forbids anything else: *"there is no `betray()` verb and no
 * hidden loyalty meter; betrayal happens through ordinary legitimate actions."*
 *
 * The act is genuinely ambiguous and that is the whole design. A treasurer cutting a
 * dossier on its grantor's STORES **to its grantor** is filing a report. The identical call
 * to its grantor's rival is a leak. The engine records *proven custody* and never intent —
 * §16.7 MUST-9's rule that counterintel surfaces facts and "never `82% spy`", and §16.7
 * MUST-8's that "the audit chain is immutable, but it establishes only proven custody or
 * last authorized readers."
 *
 * ── THE THREE PROPERTIES THAT MAKE IT A BETRAYAL SURFACE ────────────────────
 *
 * 1. **Delay.** §16.7 MUST-8: *"Sensitive writes alert quickly; reads batch into 2–6 tick
 *    delayed access aggregates."* A money draw already alerts instantly (`recordSpend` moves
 *    the counter the grantor reads on its next wake). A dossier does not: it reveals at
 *    {@link Dossier.revealsAtTick}, which is `cutAtTick + AUDIT_LAG_TICKS`. That gap is the
 *    window a betrayal has, and the replay can point at the tick it *could* have been caught.
 *
 * 2. **Custody outlives clearance.** §16.7 MUST-5: *"revocation prevents future reads but
 *    never erases information already observed."* {@link DossierBook.heldBy} answers "what do
 *    you already hold", and a held dossier is re-handable **after the grant that cut it was
 *    revoked**. So `revoke` is not a cure, which is the fact that makes the original decision
 *    to grant clearance the consequential one.
 *
 * 3. **Attribution is proven, never inferred.** Every row names the grant it was cut under,
 *    or the parent row it was copied from. {@link rootOf} walks that chain to the grant that
 *    started it — so the receipt reel (§14) can put the promotion, the accepted warning and
 *    the leak on one strip without asserting a path it cannot prove. Off-platform
 *    paraphrase is free and unattributable, exactly as §16.7 MUST-8 says it must be: we do
 *    not promise perfect cost or attribution, we promise that the *signed* path is signed.
 *
 * ── ★ RETENTION: NOTHING PRUNES THIS BOOK, AND THAT IS THE POINT ────────────
 *
 * A delayed audit is precisely the `Book.prune` hazard — it has bitten five times, once
 * making a §9 fix evaporate in production because a retention window dropped a row two
 * ticks before it was read. Evidence that declassifies later is state that must survive
 * until then, and a window is a second number that has to agree with the lag forever.
 *
 * So there is **no prune path in this file and there must never be one.** The bound is
 * {@link MAX_DOSSIERS}, a cap (INV-26), not a clock. A cap refuses the 4,097th cut with a
 * sentence an agent can read; a clock silently deletes the 1st. `test/grant/dossier.test.ts`
 * asserts both halves: that a row cut at `T` is still readable by its subject at
 * `T + AUDIT_LAG_TICKS`, and — by enumerating this module's own exported surface — that no
 * method removes a row. The second assertion is what would fail if someone added one.
 */

import type { GrantId, PrincipalId } from '../core/types.js';
import type { CanonicalValue } from '../core/canonical.js';
import { compareIds } from '../ledger/order.js';
import type { StateTable } from '../tick/snapshot.js';
import {
  readArray as snapArray,
  readInt as snapInt,
  readObject as snapObject,
  readString as snapString,
  readStringOrNull as snapStringOrNull,
} from '../tick/snapshot.js';
import { COMPARTMENTS, isCompartment, MAX_DIGEST_CHARS, type Compartment } from './compartment.js';

export class DossierBookError extends Error {}

export type DossierId = string & { readonly __brand: 'DossierId' };

/**
 * How long a cut stays dark before it publishes.
 *
 * §16.7 MUST-8 says 2–6 ticks and this is the middle of that band. It is **one** number,
 * used by the subject's sight, the viewer's sight and the ticker alike, because two numbers
 * would let the client show a leak before the victim could read it — A9 inverted, and the
 * failure mode four separate visibility leaks in this codebase took the same shape as.
 *
 * *(calibrate)* — a starting point for simulation, not a claim of correctness.
 */
export const AUDIT_LAG_TICKS = 4;

/**
 * Total cap on the book (INV-26). Generous and deliberately of the same order as
 * `MAX_GRANTS`: a dossier is at most one per `message`, and `message` costs an action.
 */
export const MAX_DOSSIERS = 4_096;

/** How deep {@link rootOf} will walk a custody chain before it calls the chain broken. */
export const MAX_CUSTODY_DEPTH = 32;

/**
 * One dossier: the figures, who cut them, from what authority, and who now holds them.
 *
 * Every field is captured. A dossier whose `revealsAtTick` were outside `state_hash` would
 * let a rolled-back or replayed world publish a leak on a different tick than the one it
 * actually published on — the "state outside the hash" class the ledger, elections and the
 * grant book were all pulled into the hash to close.
 */
export interface Dossier {
  readonly id: DossierId;
  /** Whose private facts these are. The party the delay protects, and the one it exposes. */
  readonly subject: PrincipalId;
  readonly compartment: Compartment;
  /** Who cut or re-handed it. Named on the record beside `subject`, always (§8.1). */
  readonly cutBy: PrincipalId;
  /** Who received it. A dossier always has exactly one recipient — a copy, not a broadcast. */
  readonly toWhom: PrincipalId;
  /**
   * The grant whose CLEARANCE authorised the read, or `null` when this row is a re-hand of
   * a dossier `cutBy` already held ({@link parent} is then non-null). Exactly one of the two
   * is set, and INV-22 halts the world if neither is.
   */
  readonly grant: GrantId | null;
  /** The row this was copied from, or `null` for a first cut. */
  readonly parent: DossierId | null;
  /** The tick the figures were read. What `digest` is a photograph of. */
  readonly cutAtTick: number;
  /** `cutAtTick + AUDIT_LAG_TICKS`. When the subject, every agent and every viewer learn. */
  readonly revealsAtTick: number;
  /** The figures, canonical and integer-only (`compartmentDigest`). Bounded. */
  readonly digest: string;
}

export class DossierBook {
  private readonly byId = new Map<DossierId, Dossier>();

  get(id: DossierId): Dossier | undefined {
    return this.byId.get(id);
  }

  /** Every dossier, in canonical id order — the order capture and any docket must use. */
  all(): readonly Dossier[] {
    return [...this.byId.values()].sort((a, b) => compareIds(a.id, b.id));
  }

  get size(): number {
    return this.byId.size;
  }

  /**
   * Record a cut. Refuses a duplicate id for `GrantBook.add`'s reason: an id is minted once,
   * so a collision is a bug in the minter and overwriting would silently replace one
   * principal's evidence with another's.
   */
  add(row: Dossier): void {
    if (this.byId.has(row.id)) {
      throw new DossierBookError(`dossier ${row.id} already exists; ids are minted once and never reused`);
    }
    if (this.byId.size >= MAX_DOSSIERS) {
      throw new DossierBookError(`the dossier book is at its cap of ${String(MAX_DOSSIERS)}`);
    }
    if (row.digest.length > MAX_DIGEST_CHARS) {
      throw new DossierBookError(
        `dossier ${row.id} digest is ${String(row.digest.length)} chars, over the cap of ${String(MAX_DIGEST_CHARS)}`,
      );
    }
    if (row.revealsAtTick !== row.cutAtTick + AUDIT_LAG_TICKS) {
      // One lag, one home. A row with its own reveal offset is a second copy of the rule,
      // free to disagree with the one the affordance quoted to the grantor.
      throw new DossierBookError(
        `dossier ${row.id} reveals at ${String(row.revealsAtTick)} but was cut at ${String(row.cutAtTick)}; ` +
          `the lag is ${String(AUDIT_LAG_TICKS)} ticks and is not per-row`,
      );
    }
    if ((row.grant === null) === (row.parent === null)) {
      throw new DossierBookError(
        `dossier ${row.id} must name exactly one of grant (a first cut) or parent (a re-hand); ` +
          `it names ${row.grant === null ? 'neither' : 'both'}`,
      );
    }
    this.byId.set(row.id, row);
  }

  /**
   * What `holder` already holds — the rows it may re-hand, whatever happened to the
   * clearance that produced them (§16.7 MUST-5). A dossier reaches a holder either because
   * it received one or because it cut one.
   */
  heldBy(holder: PrincipalId): readonly Dossier[] {
    return this.all().filter((d) => d.toWhom === holder || d.cutBy === holder);
  }

  /** Every dossier cut on this principal's compartments — the access log `audit` reads. */
  about(subject: PrincipalId): readonly Dossier[] {
    return this.all().filter((d) => d.subject === subject);
  }

  /** Rows cut under one grant. What an authority line's threads are drawn from. */
  underGrant(grant: GrantId): readonly Dossier[] {
    return this.all().filter((d) => d.grant === grant);
  }

  /**
   * Whether `subject` may see this row yet, and why.
   *
   * Two ways: the lag has run out, or the subject spent an action on `audit` at or after
   * the cut. The second is §16.7 MUST-9's `audit_access` — counterintel that costs
   * something — and it is the only thing in the design that shortens the window.
   */
  visibleToSubject(row: Dossier, tick: number, auditedThrough: number | null): boolean {
    if (tick >= row.revealsAtTick) return true;
    return auditedThrough !== null && auditedThrough >= row.cutAtTick;
  }

  /**
   * The grant a custody chain roots at, or `null` if the chain is broken.
   *
   * Bounded by {@link MAX_CUSTODY_DEPTH} rather than trusting the graph to be a tree: a
   * cycle here would spin inside a tick, and DET-9 requires a bounded step count regardless
   * of input. A chain that hits the bound returns `null`, which INV-22 reports as broken
   * custody rather than papering over.
   */
  rootOf(row: Dossier): GrantId | null {
    let cursor: Dossier | undefined = row;
    for (let depth = 0; depth < MAX_CUSTODY_DEPTH && cursor !== undefined; depth += 1) {
      if (cursor.grant !== null) return cursor.grant;
      if (cursor.parent === null) return null;
      cursor = this.byId.get(cursor.parent);
    }
    return null;
  }
}

/**
 * When each principal last spent an action reading its own access log (`audit`).
 *
 * A tiny table rather than a field on the principal for the reason the grant book is a
 * book: it is captured, restored on abort and replayed, and a number that decides what an
 * agent may see has to be inside `state_hash` or two worlds that disagree about who has
 * looked at their own logs can hash the same.
 */
export class AuditLog {
  private readonly lastAudit = new Map<PrincipalId, number>();

  /** Record an audit. Kept monotonic: an audit never narrows what an earlier one revealed. */
  record(who: PrincipalId, tick: number): void {
    const prior = this.lastAudit.get(who);
    if (prior === undefined || tick > prior) this.lastAudit.set(who, tick);
  }

  /** The latest tick this principal audited, or null. */
  through(who: PrincipalId): number | null {
    return this.lastAudit.get(who) ?? null;
  }

  entries(): readonly (readonly [PrincipalId, number])[] {
    return [...this.lastAudit.entries()].sort((a, b) => compareIds(a[0], b[0]));
  }
}

/**
 * The state-table descriptor for both structures. One table, because the audit stamps are
 * meaningless without the rows they reveal and capturing them apart would let a restore
 * produce a world where a principal has audited a log that does not exist.
 */
export function dossiersStateTable(
  read: () => { readonly dossiers: DossierBook; readonly audits: AuditLog },
  write: (restored: { readonly dossiers: DossierBook; readonly audits: AuditLog }) => void,
): StateTable {
  return {
    name: 'dossier',
    capture: (): CanonicalValue => {
      const src = read();
      return {
        dossiers: src.dossiers.all().map((d) => ({
          id: d.id,
          subject: d.subject,
          compartment: d.compartment,
          cutBy: d.cutBy,
          toWhom: d.toWhom,
          grant: d.grant,
          parent: d.parent,
          cutAtTick: d.cutAtTick,
          revealsAtTick: d.revealsAtTick,
          digest: d.digest,
        })),
        audits: src.audits.entries().map(([who, tick]) => ({ who, tick })),
      };
    },
    restore: (captured: CanonicalValue): void => {
      const root = snapObject(captured, 'dossier table');
      const dossiers = new DossierBook();
      for (const raw of snapArray(root['dossiers'] ?? [], 'dossier rows')) {
        const r = snapObject(raw, 'dossier row');
        const id = snapString(r, 'id', 'dossier row') as DossierId;
        const compartment = snapString(r, 'compartment', `dossier ${id}`);
        if (!isCompartment(compartment)) {
          throw new DossierBookError(
            `dossier ${id} names compartment "${compartment}", which is not one of ` +
              `${COMPARTMENTS.join(', ')}`,
          );
        }
        dossiers.add({
          id,
          subject: snapString(r, 'subject', `dossier ${id}`) as PrincipalId,
          compartment,
          cutBy: snapString(r, 'cutBy', `dossier ${id}`) as PrincipalId,
          toWhom: snapString(r, 'toWhom', `dossier ${id}`) as PrincipalId,
          grant: snapStringOrNull(r, 'grant', `dossier ${id}`) as GrantId | null,
          parent: snapStringOrNull(r, 'parent', `dossier ${id}`) as DossierId | null,
          cutAtTick: snapInt(r, 'cutAtTick', `dossier ${id}`),
          revealsAtTick: snapInt(r, 'revealsAtTick', `dossier ${id}`),
          digest: snapString(r, 'digest', `dossier ${id}`),
        });
      }
      const audits = new AuditLog();
      for (const raw of snapArray(root['audits'] ?? [], 'audit stamps')) {
        const a = snapObject(raw, 'audit stamp');
        audits.record(
          snapString(a, 'who', 'audit stamp') as PrincipalId,
          snapInt(a, 'tick', 'audit stamp'),
        );
      }
      write({ dossiers, audits });
    },
  };
}
