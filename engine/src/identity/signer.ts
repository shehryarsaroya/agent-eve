/**
 * ★ SIGNER (SPEC §3) — who holds the private key a principal's requests are signed with.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * §6.1: *"a product whose only asset is a permanent public account of who kept their word cannot rest
 * that account on trust our server."* Every act in the record is provably its principal's because the
 * principal signs it with a key the server never sees. The chat connector (`connector/`) breaks that
 * for its players ON PURPOSE — a chat host cannot hold an Ed25519 key, so Agent Eve's server holds it
 * and signs for them (owner decision 1, `docs/design/CONNECTORS-2026-10-02.md`). The canon's answer is
 * not to hide it: the record of such a principal says so, in public, on every row that carries its
 * record. That one field is this.
 *
 *   - `self`   — the principal's own key. The server has only ever seen the public half.
 *   - `hosted` — Agent Eve's server holds the key and signs each request for the principal. Such a
 *                principal may be **played from chat**: a person typing its moves into ChatGPT or
 *                Claude, which owner decision 2 allows and requires disclosed.
 *   - `null`   — the principal holds no key at all: it was seated by the world itself (the named
 *                characters Agent Eve runs), never enrolled. Not `self`, because nothing it does is
 *                signed by it; not `hosted`, because nobody plays it from a chat.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * **Recorded per KEY, never per principal**, and that is what makes it honest over time. "Agent Eve's
 * server signs with key K" is a fact about K that never stops being true, so a key the server held is
 * `hosted` forever — and a principal that later takes its key over (Phase 4: `keyring.rotate()` to a
 * key it made itself) reads `self` **from the tick the new key took effect**, while every frame from
 * before keeps saying `hosted`. A per-principal flag would rewrite the archive the day it flipped.
 *
 * **NOT IN THE HASH, AND IT MUST NEVER BE.** Nothing here is world state: no handler reads it, no
 * snapshot captures it, `state_hash` cannot see it. It is a projection input — the frames and the
 * observation read it beside the world, the way `modelBadges` is read — so deploying it, or a key
 * being recorded as hosted, moves no tick of the record (`test/api/signer-is-not-in-the-world.spec.ts`).
 *
 * **Not a judgement.** `hosted` says whose signature the record rests on. It does not say the principal
 * is less trustworthy, and nothing in the game reads it: no gate, no price, no rule.
 */

import type { PrincipalId } from '../core/types.js';
import { keyLiveAt, type KeyRegistration } from './keyring.js';

/** The two values a principal with a key can carry. Lower case: the owner's own spelling, `signer: hosted`. */
export const SIGNERS = ['self', 'hosted'] as const;

export type Signer = (typeof SIGNERS)[number];

/** What a projection asks: the signer of this principal, as of this tick. */
export type SignerLookup = (principal: PrincipalId, atTick: number) => Signer | null;

/** The one read the answer needs from the key directory: every key a principal has held, oldest first. */
export interface KeyHistory {
  historyFor(principal: PrincipalId): readonly KeyRegistration[];
}

/**
 * The signer of `principal` at `atTick`.
 *
 * The key live at that tick decides it. Before a principal's first key takes effect (it is minted into
 * the NEXT tick, `agent.md` §2) the principal still exists — seated, on the map, in its own enrol
 * response — and the key it enrolled with is the one that will sign for it, so that key answers. A
 * principal with no key at all is `null`.
 */
export function signerAt(
  keys: KeyHistory,
  hostedKeyids: ReadonlySet<string>,
  principal: PrincipalId,
  atTick: number,
): Signer | null {
  const history = keys.historyFor(principal);
  const first = history[0];
  if (first === undefined) return null;
  const live = history.find((reg) => keyLiveAt(reg, atTick)) ?? (atTick < first.registeredAtTick ? first : history[history.length - 1]);
  if (live === undefined) return null;
  return hostedKeyids.has(live.keyid) ? 'hosted' : 'self';
}
