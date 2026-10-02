/**
 * Sealing agent keys at rest: AES-256-GCM under a master key that exists only in the service's
 * environment file — never in Postgres, never in a backup, never in a log.
 *
 * The blob is `iv (12) ‖ ciphertext ‖ tag (16)`. The additional authenticated data binds a blob
 * to the account and key id it was sealed for, so a row's ciphertext copied onto another row
 * fails to open instead of letting one account sign as another.
 *
 * Master keys are versioned (`EVE_MCP_MASTER_KEYS=1:…,2:…`): new keys are sealed under the
 * highest version, and every listed version can still open what it sealed, so rotation is
 * "add a version, re-seal, drop the old one" with no flag day.
 */

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

export interface Sealed {
  readonly version: number;
  readonly blob: Buffer;
}

export class VaultError extends Error {}

export class KeyVault {
  readonly #keys: ReadonlyMap<number, Buffer>;
  readonly #current: number;

  constructor(masterKeys: ReadonlyMap<number, Buffer>) {
    if (masterKeys.size === 0) throw new VaultError('no master key configured');
    for (const key of masterKeys.values()) {
      if (key.length !== 32) throw new VaultError('master keys must be 32 bytes');
    }
    this.#keys = new Map(masterKeys);
    this.#current = Math.max(...masterKeys.keys());
  }

  get currentVersion(): number {
    return this.#current;
  }

  seal(plaintext: Buffer, aad: string): Sealed {
    const key = this.#keys.get(this.#current);
    if (key === undefined) throw new VaultError('current master key missing');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return { version: this.#current, blob: Buffer.concat([iv, body, cipher.getAuthTag()]) };
  }

  open(sealed: Sealed, aad: string): Buffer {
    const key = this.#keys.get(sealed.version);
    if (key === undefined) throw new VaultError(`no master key for version ${sealed.version}`);
    if (sealed.blob.length < 12 + 16 + 1) throw new VaultError('sealed blob is too short');
    const iv = sealed.blob.subarray(0, 12);
    const tag = sealed.blob.subarray(sealed.blob.length - 16);
    const body = sealed.blob.subarray(12, sealed.blob.length - 16);
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAAD(Buffer.from(aad, 'utf8'));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(body), decipher.final()]);
    } catch {
      // Never say more: the reason is either a wrong key or a tampered blob.
      throw new VaultError('sealed key failed authentication');
    }
  }

  /** A purpose-bound key derived from the current master key (HKDF-SHA256). */
  derive(purpose: string, length = 32): Buffer {
    const key = this.#keys.get(this.#current);
    if (key === undefined) throw new VaultError('current master key missing');
    return Buffer.from(hkdfSync('sha256', key, Buffer.alloc(0), Buffer.from(`agenteve-mcp/${purpose}`, 'utf8'), length));
  }

  /** Never serialise a vault. */
  toJSON(): string {
    return '[KeyVault]';
  }
}

/** What an agent key is sealed against: its account and its key id. */
export function agentKeyAad(accountId: string, keyid: string): string {
  return `agenteve-mcp/agent-key/v1|${accountId}|${keyid}`;
}
