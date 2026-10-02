/**
 * The PUBLIC frames — exactly what https://agenteve.io/frames/ serves to anyone (A9: public
 * parity). Spectator tools read nothing else, so they can never show a fact the site does not.
 *
 * Production reads them from nginx on a loopback-only listener (the frames directory is not
 * readable by this service's user, and should not be); tests read the engine's frames directory.
 * A short cache keeps a burst of chat users from turning into a burst of reads.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export type FrameName = 'live.json' | 'latest.json';

export interface FramesSource {
  get(name: FrameName): Promise<Record<string, unknown> | null>;
}

const MAX_FRAME_BYTES = 16 * 1024 * 1024;

export class PublicFrames implements FramesSource {
  readonly #dir: string | null;
  readonly #url: string | null;
  readonly #ttlMs: number;
  readonly #cache = new Map<FrameName, { readonly at: number; readonly value: Record<string, unknown> | null }>();

  constructor(options: { readonly dir: string | null; readonly url: string | null; readonly ttlMs?: number }) {
    this.#dir = options.dir;
    this.#url = options.url;
    this.#ttlMs = options.ttlMs ?? 5_000;
  }

  async get(name: FrameName): Promise<Record<string, unknown> | null> {
    const cached = this.#cache.get(name);
    const now = Date.now();
    // A frame that is not there yet (a new world before its first tick or Reckoning) is asked for
    // again after a second rather than the full TTL, so it appears as soon as it is written.
    const ttl = cached?.value === null ? Math.min(this.#ttlMs, 1_000) : this.#ttlMs;
    if (cached !== undefined && now - cached.at < ttl) return cached.value;
    const value = await this.#read(name);
    this.#cache.set(name, { at: now, value });
    return value;
  }

  async #read(name: FrameName): Promise<Record<string, unknown> | null> {
    try {
      let text: string;
      if (this.#dir !== null) {
        text = await readFile(join(this.#dir, name), 'utf8');
      } else if (this.#url !== null) {
        const response = await fetch(new URL(name, this.#url), { redirect: 'error', signal: AbortSignal.timeout(5_000) });
        if (response.status !== 200) return null;
        text = await response.text();
      } else {
        return null;
      }
      if (text.length > MAX_FRAME_BYTES) return null;
      const value: unknown = JSON.parse(text);
      return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
    } catch {
      // Missing (no Reckoning has settled yet) and unreadable are both "not available".
      return null;
    }
  }
}
