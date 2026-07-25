/**
 * The key directory, and rotation.
 *
 * **The rule that matters, chosen and stated** (SEC-2, and A5′ behind it):
 *
 * > Rotation is **prospective only**. Retiring a key stops it *authenticating new
 * > requests* from the tick the rotation lands. It never invalidates anything
 * > already accepted. A signature that verified under a key that was live at
 * > acceptance stays verifiable forever.
 *
 * The alternative — treating a retired key's past signatures as void — hands
 * every principal a delete button for its own history: rotate the key and the
 * compacts you signed, the grants you issued and the defaults you incurred all
 * become unattributable. That is A5′ (the record must never be wrong) failing in
 * the direction nobody checks, because it looks like tidy key hygiene.
 *
 * So an accepted signature is archived with the `keyid` that signed it and the
 * tick it was accepted at, and re-verification asks *was this key live then*
 * rather than *is it live now*. Keys are never deleted — dormant seats are
 * recycled, identity never is (SPEC §6.1, A5, A10, scar #3).
 *
 * Everything here is in **ticks**: registration and retirement are world events,
 * not host bookkeeping.
 */

import type { PrincipalId } from '../core/types.js';
import { IdentityError } from './reasons.js';
import type { PublicKeyJwk, PublicKeyRecord } from './keys.js';
import { keyidMatches } from './keys.js';

export interface KeyRegistration {
  readonly keyid: string;
  readonly principal: PrincipalId;
  readonly publicKeyJwk: PublicKeyJwk;
  readonly didKey: string;
  /** The tick from which this key may authenticate. */
  readonly registeredAtTick: number;
  /**
   * The tick from which it may no longer authenticate. Null while live. The key
   * itself is kept forever: the archive needs it.
   */
  readonly retiredAtTick: number | null;
}

/** The read side. Verification needs only this, so tests can supply a stub. */
export interface KeyDirectory {
  lookup(keyid: string): KeyRegistration | null;
}

/** Was this key permitted to authenticate at this tick? */
export function keyLiveAt(reg: KeyRegistration, tick: number): boolean {
  if (tick < reg.registeredAtTick) return false;
  return reg.retiredAtTick === null || tick < reg.retiredAtTick;
}

export class Keyring implements KeyDirectory {
  /** keyid → registration. A keyid is a thumbprint, so it is globally unique. */
  private readonly byKeyid = new Map<string, KeyRegistration>();
  /** principal → the one live keyid. Exactly one, or identity has two homes. */
  private readonly activeByPrincipal = new Map<PrincipalId, string>();
  /** principal → every keyid it has ever held, oldest first. */
  private readonly historyByPrincipal = new Map<PrincipalId, string[]>();

  lookup(keyid: string): KeyRegistration | null {
    return this.byKeyid.get(keyid) ?? null;
  }

  /**
   * Register a principal's first key. Enrollment calls this once.
   *
   * A principal has at most one live key at a time. Two live keys would be two
   * homes for one identity (scar #5) and would make "whose signature is this"
   * answerable two ways — the exact ambiguity the record cannot afford.
   */
  register(principal: PrincipalId, record: PublicKeyRecord, atTick: number): KeyRegistration {
    this.assertRegisterable(principal, record, atTick);
    if (this.activeByPrincipal.has(principal)) {
      throw new IdentityError(
        `principal ${principal} already has a live key; use rotate() so the old one is retired`,
      );
    }
    return this.insert(principal, record, atTick);
  }

  /**
   * Retire the live key and install a new one, effective `atTick`.
   *
   * `atTick` is the tick the rotation *lands*, which is the tick after the action
   * was taken (SPEC §15.2: actions act from snapshot T and land in T+1). The
   * caller passes the landing tick; this module does not read the clock.
   */
  rotate(
    principal: PrincipalId,
    record: PublicKeyRecord,
    atTick: number,
  ): { readonly retired: KeyRegistration; readonly installed: KeyRegistration } {
    this.assertRegisterable(principal, record, atTick);
    const activeKeyid = this.activeByPrincipal.get(principal);
    if (activeKeyid === undefined) {
      throw new IdentityError(`principal ${principal} has no live key to rotate`);
    }
    const current = this.byKeyid.get(activeKeyid);
    if (current === undefined) throw new IdentityError('unreachable: active keyid not in directory');
    if (atTick < current.registeredAtTick) {
      throw new IdentityError('a key cannot be retired before it was registered');
    }

    const retired: KeyRegistration = { ...current, retiredAtTick: atTick };
    this.byKeyid.set(retired.keyid, retired);
    this.activeByPrincipal.delete(principal);
    const installed = this.insert(principal, record, atTick);
    return { retired, installed };
  }

  /** The live key, or null if the principal has none (never enrolled). */
  activeFor(principal: PrincipalId): KeyRegistration | null {
    const keyid = this.activeByPrincipal.get(principal);
    if (keyid === undefined) return null;
    return this.byKeyid.get(keyid) ?? null;
  }

  /** Every key this principal has ever held, oldest first. Never pruned. */
  historyFor(principal: PrincipalId): readonly KeyRegistration[] {
    const keyids = this.historyByPrincipal.get(principal) ?? [];
    const out: KeyRegistration[] = [];
    for (const keyid of keyids) {
      const reg = this.byKeyid.get(keyid);
      if (reg !== undefined) out.push(reg);
    }
    return out;
  }

  get size(): number {
    return this.byKeyid.size;
  }

  private assertRegisterable(principal: PrincipalId, record: PublicKeyRecord, atTick: number): void {
    if (!Number.isSafeInteger(atTick) || atTick < 0) {
      throw new IdentityError(`tick must be a non-negative integer, got ${String(atTick)}`);
    }
    if (!keyidMatches(record.publicKeyJwk, record.keyid)) {
      // The keyid is the key's own thumbprint. A mismatch means the caller built
      // the record by hand, and a hand-built keyid is a forgeable label.
      throw new IdentityError('keyid is not the thumbprint of the key it names');
    }
    const existing = this.byKeyid.get(record.keyid);
    if (existing !== undefined) {
      // Same key, second owner: whoever registers second is impersonating. Same
      // key, same owner, after retirement: reviving it makes the archive
      // ambiguous about which era a signature belongs to.
      throw new IdentityError(
        existing.principal === principal
          ? `key ${record.keyid} was already registered to ${principal} and may not be revived`
          : `key ${record.keyid} is already registered to another principal`,
      );
    }
  }

  private insert(principal: PrincipalId, record: PublicKeyRecord, atTick: number): KeyRegistration {
    const reg: KeyRegistration = {
      keyid: record.keyid,
      principal,
      publicKeyJwk: record.publicKeyJwk,
      didKey: record.didKey,
      registeredAtTick: atTick,
      retiredAtTick: null,
    };
    this.byKeyid.set(reg.keyid, reg);
    this.activeByPrincipal.set(principal, reg.keyid);
    const history = this.historyByPrincipal.get(principal);
    if (history === undefined) this.historyByPrincipal.set(principal, [reg.keyid]);
    else history.push(reg.keyid);
    return reg;
  }
}
