/**
 * THE OPERATOR DOOR'S KEY: an acceptance that names WHAT it accepts, not just WHERE.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE DEFECT THIS FILE EXISTS TO CLOSE, MEASURED IN PRODUCTION.**
 *
 * A rules change that would not reproduce the record is supposed to stop the deploy and
 * force a human to accept the discontinuity deliberately. For nineteen consecutive rules
 * changes it stopped nothing:
 *
 * ```
 * select count(*), min(tick), max(tick) from journal_divergence;
 *  19 | 287 | 287
 * ```
 *
 * Nineteen accepted divergences, **every one at tick 287.** `COMPACT_ACCEPT_DIVERGENCE_AT_TICK=287`
 * had been standing in `/etc/compact/env` since an early change, and nearly every rules
 * change first diverges at the first snapshot tripwire — which is tick 287. So the
 * preflight read a matching number, called it pre-accepted, and restarted production
 * without asking. The recording was honest the whole time; the gate was not.
 *
 * **A tick number is not an identifier for a divergence. It is only a location, and every
 * change shares the same location.** A standing declaration therefore pre-authorised every
 * future rules change — the project's own recurring defect (*a check whose failure
 * condition cannot occur*), arriving this time on the surface that guards the record.
 *
 * So an acceptance is bound to the divergence's **identity**: the tick *and* a fingerprint
 * over what actually disagreed. `287` is refused. `287:9f3a1c4e5b07d218` authorises exactly
 * one change and is inert against the next.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ## Why a fingerprint rather than "the hash the record holds"
 *
 * A tripwire divergence carries two hashes: the journalled one (`expectedHash`) and the one
 * this build produced (`actualHash`). Binding to `expectedHash` alone would be **almost as
 * wedged as the bare tick** — the record's hash at tick 287 is the same for every candidate
 * build, so one declaration would still pre-authorise every future change at that tick. The
 * identity of a *change* is what the new build computes.
 *
 * And an `APPLIED_REFUSED` divergence has no hashes at all: what identifies it is the action
 * the record says applied and the invariant that now refuses it. So the fingerprint covers
 * `kind`, `tick`, both hashes **and** `detail` — one derivation that identifies both kinds,
 * rather than two rules an operator has to know which of. `detail`'s stability across
 * restarts is already load-bearing (`boot.ts:annotate` deduplicates on it), so this adds no
 * new requirement.
 *
 * ## Why not `shortHash`
 *
 * `core/canonical.ts:shortHash` is 12 hex chars and its own doc forbids using it "as an
 * identity or a lookup key, because 48 bits collides". This *is* an identity, so it does
 * not reuse that helper or its length — 16 hex chars (64 bits), derived here. The threat
 * model is an operator forgetting to update a variable, not an adversary searching for a
 * rules change that collides; but a distinct length keeps a display hash and an identity
 * hash from being mistaken for each other, which is HARD RULE 4 at the substrate.
 */

import { createHash } from 'node:crypto';

/** Hex characters printed in an accept-string. 64 bits, and not `shortHash`'s 12. */
export const ACCEPT_FINGERPRINT_CHARS = 16;

/**
 * The shortest prefix an operator may declare.
 *
 * A prefix is accepted rather than an exact match because the operator's job is to
 * copy what the preflight printed, and a value truncated in transit should still name the
 * divergence it came from. Below this it stops naming anything: 4 hex chars is 16 bits, and
 * a fingerprint that short would drift back toward the bare-tick wedge one deploy at a time.
 */
export const ACCEPT_FINGERPRINT_MIN_CHARS = 8;

/** The env var that carries the declaration. One home for the name. */
export const ACCEPT_ENV_VAR = 'COMPACT_ACCEPT_DIVERGENCE_AT_TICK';

/**
 * What diverged — everything the fingerprint is taken over.
 *
 * Structurally a subset of `BootDiagnosis` and of `FirstDivergence`, so both can be
 * fingerprinted without either importing the other.
 */
export interface DivergenceIdentity {
  readonly tick: number;
  /** `APPLIED_REFUSED` | `STATE_HASH_MISMATCH`. Widened to string so `boot.ts` needs no cast. */
  readonly kind: string;
  /** The action and its refusal, or the two hashes. Stable across restarts. */
  readonly detail: string;
  readonly expectedHash: string | null;
  readonly actualHash: string | null;
}

/**
 * The divergence's identity, as 16 hex chars.
 *
 * Hand-built rather than `canonicalHash`ed: five scalars in a fixed order, joined with a single
 * space, so this module stays a leaf with one import.
 *
 * **The encoding is unambiguous even though `detail` is full of spaces**, and that is worth stating
 * because the first draft of this comment claimed the separator "cannot appear in any of them",
 * which was simply false. It does not need to be true: `detail` is LAST, and the four fields before
 * it are a decimal integer, an enum member and two hex strings — none of which can hold a space. So
 * the split is fixed by the first four separators, and everything after them is the detail.
 *
 * ⚑ That separator was a literal **NUL byte** for one draft. It worked, and it was still wrong: the
 * repo-wide guard in `vocabulary-repo.test.ts` forbids a NUL in any source file, because `file(1)`
 * then reports the file as `data` and `grep -rn` silently skips every line of it. It caught this
 * one, in the file whose own comment was describing the separator.
 */
export function divergenceFingerprint(id: DivergenceIdentity): string {
  const parts = [
    String(id.tick),
    id.kind,
    id.expectedHash ?? '',
    id.actualHash ?? '',
    id.detail,
  ];
  return createHash('sha256')
    .update(parts.join(' '), 'utf8')
    .digest('hex')
    .slice(0, ACCEPT_FINGERPRINT_CHARS);
}

/**
 * The value to set: `287:9f3a1c4e5b07d218`. What lands in the record as `accepted_as`.
 *
 * **Build-specific on purpose.** Any change to {@link divergenceFingerprint} — the field list, the
 * order, the separator — moves every key, so a standing declaration written by an older build stops
 * authorising anything. That is the correct direction: it fails **closed**, holding the world and
 * printing the new string, which is the same refusal a stale declaration gets. It is also why
 * {@link parseAcceptance} rejects a fingerprint longer than {@link ACCEPT_FINGERPRINT_CHARS}: a
 * value that cannot have come from a preflight of this build should say so rather than be truncated
 * into something that might accidentally match.
 */
export function acceptanceStringFor(id: DivergenceIdentity): string {
  return `${String(id.tick)}:${divergenceFingerprint(id)}`;
}

/** The whole line an operator pastes into `/etc/compact/env`. */
export function operatorInstructionFor(id: DivergenceIdentity): string {
  return `${ACCEPT_ENV_VAR}=${acceptanceStringFor(id)}`;
}

/**
 * A parsed declaration.
 *
 * `BARE_TICK` and `MALFORMED` are **not** acceptances — {@link acceptanceAuthorises} refuses
 * both — but they are kept apart from `ABSENT` so the refusal can say which mistake was made.
 * A wedged deploy that says nothing is how this defect survived nineteen changes.
 */
export type Acceptance =
  | { readonly kind: 'ABSENT' }
  | {
      readonly kind: 'BOUND';
      readonly tick: number;
      /** The prefix the operator declared. Lower-case hex, at least {@link ACCEPT_FINGERPRINT_MIN_CHARS}. */
      readonly fingerprint: string;
      readonly raw: string;
    }
  | { readonly kind: 'BARE_TICK'; readonly tick: number; readonly raw: string }
  | { readonly kind: 'MALFORMED'; readonly raw: string; readonly why: string };

/**
 * Parse the operator's declaration. **Never throws, never widens.**
 *
 * Anything this cannot read becomes `MALFORMED`, which authorises nothing — the failure
 * direction is always "the world holds", never "the deploy proceeds".
 */
export function parseAcceptance(raw: string | null | undefined): Acceptance {
  if (raw === undefined || raw === null || raw.trim().length === 0) return { kind: 'ABSENT' };
  const text = raw.trim();
  const colon = text.indexOf(':');

  if (colon === -1) {
    const n = decimalTick(text);
    if (n !== null) return { kind: 'BARE_TICK', tick: n, raw: text };
    return {
      kind: 'MALFORMED',
      raw: text,
      why: 'it is neither a tick nor a `<tick>:<fingerprint>` pair',
    };
  }

  const tickText = text.slice(0, colon);
  const fingerprint = text.slice(colon + 1).toLowerCase();
  const tick = decimalTick(tickText);
  if (tick === null) {
    return { kind: 'MALFORMED', raw: text, why: `'${tickText}' is not a tick number` };
  }
  if (!/^[0-9a-f]+$/.test(fingerprint)) {
    return {
      kind: 'MALFORMED',
      raw: text,
      why: `'${fingerprint}' is not a hex fingerprint`,
    };
  }
  if (fingerprint.length < ACCEPT_FINGERPRINT_MIN_CHARS) {
    return {
      kind: 'MALFORMED',
      raw: text,
      why:
        `the fingerprint '${fingerprint}' is ${String(fingerprint.length)} hex characters; at least ` +
        `${String(ACCEPT_FINGERPRINT_MIN_CHARS)} are required, because a shorter one stops naming a ` +
        'particular divergence and drifts back toward accepting all of them',
    };
  }
  if (fingerprint.length > ACCEPT_FINGERPRINT_CHARS) {
    return {
      kind: 'MALFORMED',
      raw: text,
      why:
        `the fingerprint '${fingerprint}' is longer than the ${String(ACCEPT_FINGERPRINT_CHARS)} ` +
        'characters this build prints, so it cannot have come from a preflight of this build',
    };
  }
  return { kind: 'BOUND', tick, fingerprint, raw: text };
}

/**
 * A tick, in decimal digits and nothing else.
 *
 * **Not `Number()`**, which is far too generous for a gate: `Number('0x11f')` is 287,
 * `Number('1e2')` is 100, `Number(' 287\n')` is 287, and `Number('287.0')` is 287. A test
 * caught the first of those — a declaration reading `0x11f:<fingerprint>` was parsed as tick
 * 287 and compared against a divergence at tick 100, which meant the door could be reasoned
 * about in one notation and enforced in another. Every one of those spellings is a value an
 * operator did not intend, and the fail-closed answer to "I am not sure what this means" is
 * MALFORMED rather than a guess.
 */
function decimalTick(text: string): number | null {
  if (!/^[0-9]+$/.test(text)) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * Does this declaration authorise **this** divergence?
 *
 * Fail closed, in one expression: only a `BOUND` acceptance whose tick is the first
 * divergence's tick and whose prefix is a prefix of that divergence's fingerprint. There is
 * no third branch and in particular no "close enough".
 */
export function acceptanceAuthorises(acceptance: Acceptance, id: DivergenceIdentity): boolean {
  if (acceptance.kind !== 'BOUND') return false;
  if (acceptance.tick !== id.tick) return false;
  return divergenceFingerprint(id).startsWith(acceptance.fingerprint);
}

/**
 * Why a declaration was not honoured, in the operator's terms — and what to set instead.
 *
 * Returns null when the acceptance did authorise the divergence, or when there was none to
 * report on. **The bare-tick branch is the whole feature**: someone deploying under time
 * pressure has to be *told* that their standing `=287` is not a key, not trusted to
 * remember.
 *
 * `id` may be null — the process that reads the variable at start-up has not replayed
 * anything yet. A `BARE_TICK` or a `MALFORMED` value is reported anyway, because both are
 * wrong independently of what turns out to have diverged; a well-formed `BOUND` value is
 * not, because until something diverges there is nothing for it to fail to name.
 */
export function describeAcceptanceRefusal(
  acceptance: Acceptance,
  id: DivergenceIdentity | null,
): string | null {
  if (acceptance.kind === 'ABSENT') return null;
  if (acceptance.kind === 'BOUND' && id === null) return null;
  if (id !== null && acceptanceAuthorises(acceptance, id)) return null;

  const instruction = id === null ? null : operatorInstructionFor(id);
  const setThis =
    instruction === null
      ? [
          `  Run the replay preflight (\`node dist/persist/replayCheck.js\`). It names the`,
          `  divergence and prints the exact ${ACCEPT_ENV_VAR} value that accepts it.`,
        ]
      : [`  Set exactly this, in /etc/compact/env:`, ``, `      ${instruction}`];

  switch (acceptance.kind) {
    case 'BARE_TICK':
      return [
        `  ⚑ ${ACCEPT_ENV_VAR}=${acceptance.raw} IS REFUSED: A BARE TICK IS NOT A KEY.`,
        ``,
        `  A tick number says WHERE the record and this build disagree, never WHAT they`,
        `  disagree about — and nearly every rules change first diverges at the same place,`,
        `  the first snapshot tripwire. A standing bare tick therefore pre-authorises every`,
        `  future rules change, which is how nineteen consecutive changes were waved through`,
        `  a gate that had never once refused anything.`,
        ``,
        `  An acceptance must name the divergence it accepts: <tick>:<fingerprint>.`,
        ...setThis,
      ].join('\n');
    case 'MALFORMED':
      return [
        `  ⚑ ${ACCEPT_ENV_VAR}='${acceptance.raw}' CANNOT BE READ: ${acceptance.why}.`,
        ``,
        `  Nothing is accepted. An acceptance this build cannot parse is never widened into`,
        `  one it can — the whole variable exists to make a discontinuity deliberate, so a`,
        `  typo must hold the world rather than authorise a guess.`,
        ...setThis,
      ].join('\n');
    case 'BOUND':
      return [
        `  ⚑ ${ACCEPT_ENV_VAR}=${acceptance.raw} DOES NOT NAME THIS DIVERGENCE.`,
        ``,
        id === null
          ? `  Nothing has been replayed yet, so it authorises nothing so far.`
          : acceptance.tick === id.tick
            ? `  It names tick ${String(id.tick)} correctly, but the fingerprint is for a different ` +
              `change:\n  this build's divergence there is ${divergenceFingerprint(id)}. A standing ` +
              `acceptance from an\n  earlier deploy is INERT against a new one, which is the point of ` +
              `binding it.`
            : `  It names tick ${String(acceptance.tick)}; the FIRST divergence is at tick ` +
              `${String(id.tick)}.`,
        ...(id === null ? [] : ['', ...setThis]),
      ].join('\n');
  }
}
