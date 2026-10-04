// Cross-device sign-in: the email link may be opened on any device.
//
// The consent popup asks for a sign-in link and opens a pending HANDOFF here: an id, a secret only
// the popup holds, and a WORD the popup shows. The email's link lands on /oauth/confirm, on whatever
// device the person opens it. There the person TYPES the word the popup shows (in the browser that
// started the sign-in, the page fills it in by itself); the page checks it here BEFORE it spends the
// email's one-time token, then posts the fresh session to /oauth/handoff/<id>/confirm with the word
// again. The popup, polling with its secret, collects the session ONCE and finishes signing in.
//
// Why typed, not just shown: anyone can start a sign-in with someone else's email address. If the
// confirm page only showed a word and asked "Yes?", one tap on an email the person never asked for
// would hand their session to whoever started it. Typing the word proves the person can see the page
// that started the sign-in. Two wrong words and the handoff is gone.
//
// Memory only and bounded (scar #3): a restart forgets pending handoffs, and the person asks for a
// new email. When full, NEW handoffs are refused (the page falls back to the email's code); pending
// ones are never pushed out, so a flood cannot cancel other people's sign-ins. The default lifetime is
// Supabase's own OAuth authorization lifetime (10 minutes): past it, the request the popup is
// finishing has expired anyway. Sessions are held for at most that long and handed over exactly once.
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** Short, common, unambiguous words: easy to read on one screen and type on another. */
const WORDS = [
  'AMBER', 'ANCHOR', 'APPLE', 'ARROW', 'ASPEN', 'BADGE', 'BAMBOO', 'BANJO', 'BASIL', 'BEACON',
  'BERRY', 'BISON', 'BLAZE', 'BREEZE', 'BRICK', 'CABIN', 'CACTUS', 'CAMEL', 'CANOE', 'CANYON',
  'CEDAR', 'CHALK', 'CHERRY', 'CLOVER', 'COBALT', 'COMET', 'CORAL', 'COTTON', 'CRANE', 'CRATER',
  'DAISY', 'DELTA', 'DESERT', 'DRAGON', 'EAGLE', 'EMBER', 'FALCON', 'FERN', 'FLINT', 'FOREST',
  'FOSSIL', 'FROST', 'GALAXY', 'GARNET', 'GECKO', 'GINGER', 'GRAPE', 'HARBOR', 'HAZEL', 'HERON',
  'HONEY', 'IRIS', 'IVORY', 'JADE', 'JUNGLE', 'KAYAK', 'KETTLE', 'KIWI', 'LAGOON', 'LANTERN',
  'LEMON', 'LILAC', 'LINEN', 'LOTUS', 'LUNAR', 'MAGNET', 'MANGO', 'MAPLE', 'MARBLE', 'MEADOW',
  'MESA', 'MINT', 'MOSAIC', 'NECTAR', 'NOVA', 'OCEAN', 'OLIVE', 'ONYX', 'OPAL', 'ORBIT',
  'ORCHID', 'OTTER', 'PANDA', 'PEARL', 'PEBBLE', 'PEPPER', 'PINE', 'PIXEL', 'PLUM', 'POLAR',
  'QUARTZ', 'RAVEN', 'REEF', 'RIVER', 'ROBIN', 'SABLE', 'SAGE', 'SALMON', 'SATURN', 'SHELL',
  'SILVER', 'SOLAR', 'SPRUCE', 'STONE', 'SUMMIT', 'TIDE', 'TIGER', 'TOPAZ', 'TULIP', 'TUNDRA',
  'VELVET', 'WALNUT', 'WILLOW', 'ZEBRA',
] as const;

/** Wrong words allowed before the handoff is cancelled. */
export const WRONG_WORDS_ALLOWED = 2;

export interface HandoffSession {
  readonly accessToken: string;
  readonly refreshToken: string;
}

interface Pending {
  readonly secretHash: Buffer;
  readonly emailHash: string;
  readonly word: string;
  readonly createdAt: number;
  wrong: number;
  session: HandoffSession | null;
}

export type CheckVerdict = { readonly status: 'ok' } | { readonly status: 'wrong'; readonly triesLeft: number } | { readonly status: 'unknown' };
export type ConfirmVerdict = 'confirmed' | 'unknown' | 'wrong_word' | 'email_mismatch' | 'already_confirmed';
export type TakeVerdict =
  | { readonly status: 'waiting' }
  | { readonly status: 'confirmed'; readonly session: HandoffSession }
  | { readonly status: 'unknown' };

const sha256 = (value: string): Buffer => createHash('sha256').update(value).digest();
const emailKey = (email: string): string => sha256(email.trim().toLowerCase()).toString('hex');
/** "  tiger " and "Tiger." are TIGER: people type on phones. */
export const normaliseWord = (word: string): string => word.toUpperCase().replace(/[^A-Z]/g, '');

export class SignInHandoffs {
  readonly #pending = new Map<string, Pending>();
  readonly #ttlMs: number;
  readonly #max: number;
  readonly #now: () => number;

  constructor(options: { readonly ttlSeconds?: number; readonly max?: number; readonly now?: () => number } = {}) {
    this.#ttlMs = (options.ttlSeconds ?? 600) * 1000;
    this.#max = options.max ?? 20_000;
    this.#now = options.now ?? (() => Date.now());
  }

  get size(): number {
    this.#sweep();
    return this.#pending.size;
  }

  get ttlSeconds(): number {
    return this.#ttlMs / 1000;
  }

  /** Open a handoff for a sign-in link sent to `email`, or null when full. The secret is returned once and kept only hashed. */
  open(email: string): { readonly id: string; readonly secret: string; readonly word: string } | null {
    this.#sweep();
    if (this.#pending.size >= this.#max) return null;
    const id = randomBytes(16).toString('base64url');
    const secret = randomBytes(32).toString('base64url');
    const word = WORDS[randomInt(WORDS.length)] as string;
    this.#pending.set(id, { secretHash: sha256(secret), emailHash: emailKey(email), word, createdAt: this.#now(), wrong: 0, session: null });
    return { id, secret, word };
  }

  /** Whether a handoff is still waiting, for the confirm page; it never learns the word this way. */
  pending(id: string): boolean {
    this.#sweep();
    const pending = this.#pending.get(id);
    return pending !== undefined && pending.session === null;
  }

  /** The person typed `word` on the confirm page; checked before the email's token is spent. */
  check(id: string, word: string): CheckVerdict {
    this.#sweep();
    const pending = this.#pending.get(id);
    if (pending === undefined || pending.session !== null) return { status: 'unknown' };
    if (normaliseWord(word) === pending.word) return { status: 'ok' };
    return { status: 'wrong', triesLeft: this.#wrongWord(id, pending) };
  }

  /** "Yes, it's me", signed in as `email` on the confirm page, with the word again. */
  confirm(id: string, email: string, word: string, session: HandoffSession): ConfirmVerdict {
    this.#sweep();
    const pending = this.#pending.get(id);
    if (pending === undefined) return 'unknown';
    if (pending.session !== null) return 'already_confirmed';
    if (normaliseWord(word) !== pending.word) {
      this.#wrongWord(id, pending);
      return 'wrong_word';
    }
    if (pending.emailHash !== emailKey(email)) return 'email_mismatch';
    pending.session = session;
    return 'confirmed';
  }

  /** The popup's poll. A confirmed session is handed over exactly once, then forgotten. */
  take(id: string, secret: string): TakeVerdict {
    this.#sweep();
    const pending = this.#pending.get(id);
    if (pending === undefined) return { status: 'unknown' };
    const offered = sha256(secret);
    if (offered.length !== pending.secretHash.length || !timingSafeEqual(offered, pending.secretHash)) return { status: 'unknown' };
    if (pending.session === null) return { status: 'waiting' };
    this.#pending.delete(id);
    return { status: 'confirmed', session: pending.session };
  }

  /** Counts a wrong word; the last allowed one cancels the handoff. Returns the tries left. */
  #wrongWord(id: string, pending: Pending): number {
    pending.wrong += 1;
    const left = Math.max(0, WRONG_WORDS_ALLOWED - pending.wrong);
    if (left === 0) this.#pending.delete(id);
    return left;
  }

  #sweep(): void {
    const cutoff = this.#now() - this.#ttlMs;
    for (const [id, pending] of this.#pending) {
      if (pending.createdAt >= cutoff) break; // insertion order is creation order
      this.#pending.delete(id);
    }
  }
}
