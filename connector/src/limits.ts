/**
 * Per-account rate limits, and one-at-a-time execution per account.
 *
 * These protect the host and the engine; they are not game rules. A4 already makes request
 * speed powerless — actions are tick-batched and wakes are a fixed pool — so a limit here can
 * only ever cost a careless client time, never give a fast one an edge. One principal per
 * account is housekeeping too, not Sybil defence (A15): accounts are free, and the game's real
 * prices stay in the game.
 *
 * Bounded (scar #3): the window map holds at most `maxKeys` entries and evicts rolled windows
 * first, then the oldest.
 */

import type { LimitName, RateAllowance } from './config.js';

export interface LimitVerdict {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
}

export class RateLimiter {
  readonly #limits: Readonly<Record<LimitName, RateAllowance>>;
  readonly #maxKeys: number;
  readonly #windows = new Map<string, { count: number; openedAt: number }>();

  constructor(limits: Readonly<Record<LimitName, RateAllowance>>, maxKeys = 50_000) {
    this.#limits = limits;
    this.#maxKeys = maxKeys;
  }

  get tracked(): number {
    return this.#windows.size;
  }

  check(limit: LimitName, key: string, nowSeconds: number): LimitVerdict {
    const allowance = this.#limits[limit];
    const id = `${limit}::${key}`;
    const window = this.#windows.get(id);
    if (window === undefined || nowSeconds - window.openedAt >= allowance.windowSeconds) {
      if (window === undefined) this.#admit();
      this.#windows.set(id, { count: 1, openedAt: nowSeconds });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (window.count >= allowance.burst) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(allowance.windowSeconds - (nowSeconds - window.openedAt))) };
    }
    window.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  #admit(): void {
    if (this.#windows.size < this.#maxKeys) return;
    const now = Date.now() / 1000;
    for (const [id, window] of this.#windows) {
      const limit = id.slice(0, id.indexOf('::')) as LimitName;
      if (now - window.openedAt >= (this.#limits[limit]?.windowSeconds ?? 0)) this.#windows.delete(id);
    }
    while (this.#windows.size >= this.#maxKeys) {
      const oldest = this.#windows.keys().next();
      if (oldest.done === true) break;
      this.#windows.delete(oldest.value);
    }
  }
}

/**
 * Serialises work per key. Two concurrent `eve_act` calls for one account — a host retrying a
 * call that is still in flight — run one after the other, so the second sees the first in the
 * signing log and replays it instead of acting twice. Entries are dropped when idle.
 */
export class KeyedMutex {
  readonly #tails = new Map<string, Promise<void>>();

  async run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.#tails.set(key, tail);
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (this.#tails.get(key) === tail) this.#tails.delete(key);
    }
  }

  get size(): number {
    return this.#tails.size;
  }
}
