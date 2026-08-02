/**
 * RFC 9421 HTTP Message Signatures — the subset THE COMPACT needs.
 *
 * Covered components: `@method` `@path` `@authority` `content-digest` (plus
 * `@scheme`, `@query` and `@target-uri`, which cost nothing to support and stop a
 * conforming client being refused for being thorough). Parameters: `created`,
 * `expires`, `keyid`, `nonce`, `alg=ed25519`.
 *
 * **The signature base is built per §2.5 and re-serialised, never echoed.** The
 * `@signature-params` line is rebuilt from the parsed `Signature-Input`, so what
 * we verify is the canonical spelling. Echoing the raw header instead would let a
 * sender hand us one spelling and the next verifier a different one — and the
 * whole point of this file is that a third party, later, reaches the same verdict
 * we did.
 *
 * **Check order is deliberate** and is the security-relevant part of the design:
 *
 *   structural → base construction → body digest → freshness → key → crypto → nonce
 *
 * State is mutated **last**. The nonce is only spent once the signature has
 * verified, so an unauthenticated flood can never burn a real principal's replay
 * budget or, worse, pre-spend the nonce a legitimate request is about to use.
 * Everything before crypto is cheap and structural, so the common case — a client
 * with a bug — gets a precise hint (scar #1: the agent-facing string is a rules
 * surface) without costing a curve operation.
 *
 * **`@path` is the client's path, not ours.** §2.2.6 derives it from the target the
 * client sent, and a path-stripping proxy destroys that before the origin sees it.
 * The caller therefore supplies the client-visible spelling plus any other spelling
 * that routes here — see {@link SignableRequest.alternateRequestTargets}, which
 * argues why that is not a hole. Getting this wrong refused *every conformant
 * client* in Gate 3.
 *
 * **A failing signature says what we computed.** `SIGNATURE_INVALID` carries the
 * base, one line per covered component, in {@link RefusalDiagnostic}. The old
 * sentence named the two causes that were fine and not the one that was wrong, and
 * cost a probe most of a session.
 */

import type { PrincipalId } from '../core/types.js';
import { verifyContentDigest } from './digest.js';
import type { AgentKeypair } from './keys.js';
import { verifyBytes } from './keys.js';
import type { KeyDirectory, KeyRegistration } from './keyring.js';
import { keyLiveAt } from './keyring.js';
import type { RefusalDiagnostic, SignatureRejection, Verified } from './reasons.js';
import { IdentityError, accept, refuse } from './reasons.js';
import type { ReplayStore, ReplayStoreLimits } from './replay.js';
import { decodeBase64, encodeBase64 } from './encoding.js';
import { dictGet, parseDictionary, serializeInnerList, serializeItem, sfInteger, sfParam, sfString, SfParseError } from './sfv.js';
import type { SfBareItem, SfDictionary, SfInnerList, SfItem } from './sfv.js';
import type { WallSeconds } from './wallclock.js';
import { wallSeconds } from './wallclock.js';

// ── the message ─────────────────────────────────────────────────────────────

/**
 * A request, reduced to exactly what a signature covers. Built once at the HTTP
 * boundary so that nothing downstream re-derives (and disagrees about) a value
 * that was signed.
 */
export interface SignableRequest {
  readonly method: string;
  readonly scheme: 'http' | 'https';
  /** host, optionally with a port. Normalised on the way into the base. */
  readonly authority: string;
  /**
   * Origin-form target: absolute path plus optional query, **as the client sent
   * it** — which is what RFC 9421 §2.2.6 derives `@path` from, and is not always
   * what this process received. See {@link alternateRequestTargets}.
   */
  readonly requestTarget: string;
  /**
   * Other spellings of {@link requestTarget} that address this same resource, tried
   * in order after the canonical one fails. Empty or absent in the normal case.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * **WHY THIS FIELD EXISTS, AND WHY IT IS NOT A HOLE.**
   *
   * `@path` is defined over the target *the client sent*. A path-stripping reverse
   * proxy destroys that information before we see it: nginx proxies
   * `/api/observe` to the app root, so the app is handed `/observe` and a
   * conformant client — which signed `/api/observe`, correctly — fails at
   * its first request with nothing to go on. Measured in Gate 3: every conformant
   * client failed, and the workaround (sign the app-internal path) is the one thing
   * the RFC forbids.
   *
   * The origin cannot recover the sent target by inspection, so it is *told*: the
   * caller supplies the canonical, client-visible spelling and any other spelling
   * that routes to the same handler here.
   *
   * This does not weaken verification, and the reasons are worth stating rather
   * than assuming:
   *
   *   1. **No cross-resource acceptance.** The alternates differ from the canonical
   *      only by a mount prefix that is a routing no-op — both spellings reach the
   *      same handler on the same host — so a signature accepted under one spelling
   *      cannot authorise something the other would not.
   *   2. **No replay window.** The nonce is spent per `(keyid, nonce)`, never per
   *      path, so a signature accepted under either spelling burns the same nonce.
   *   3. **Attribution stays exact.** {@link AcceptedSignature.signatureBase} records
   *      the base that actually verified, not the canonical one, so the archive
   *      re-proves years later without knowing anything about proxies.
   *   4. **Bounded, and unreachable while unauthenticated.** At most
   *      {@link MAX_ALTERNATE_REQUEST_TARGETS} extra curve operations, only when a
   *      target-derived component is actually covered, and only after the key has
   *      been found — an unknown keyid is refused before any of it.
   * ══════════════════════════════════════════════════════════════════════════
   */
  readonly alternateRequestTargets?: readonly string[] | undefined;
  readonly headers: Readonly<Record<string, string | readonly string[]>>;
  /** The exact bytes read from the wire, or null for a bodyless request. */
  readonly body: Uint8Array | null;
}

// ── policy ──────────────────────────────────────────────────────────────────

export interface SignaturePolicy {
  /** Components a signature must cover here, whatever else it covers. */
  readonly requiredComponents: readonly string[];
  /** How long a signature stays fresh. Wall-clock: it protects the host. */
  readonly maxAge: WallSeconds;
  /** How far ahead of our clock a client's `created` may be. */
  readonly maxSkewAhead: WallSeconds;
  readonly requireNonce: boolean;
  readonly requireContentDigestWithBody: boolean;
  readonly maxNonceLength: number;
}

/**
 * The default policy. Every number is *(calibrate)* in the SPEC §17 sense, but
 * the *shape* is not: a nonce is required because without one a captured request
 * is replayable for the whole freshness window, and the digest is required with a
 * body because otherwise the signature says nothing about what was asked for.
 */
export const DEFAULT_SIGNATURE_POLICY: SignaturePolicy = {
  requiredComponents: ['@method', '@path', '@authority'],
  maxAge: wallSeconds(60),
  maxSkewAhead: wallSeconds(30),
  requireNonce: true,
  requireContentDigestWithBody: true,
  maxNonceLength: 64,
};

/** Nonce grammar. Long enough not to collide, short enough to remember cheaply. */
const NONCE_GRAMMAR = /^[A-Za-z0-9_-]{8,}$/;

const SUPPORTED_DERIVED = new Set(['@method', '@path', '@authority', '@scheme', '@query', '@target-uri']);

/** The derived components whose value depends on the request target, and only those. */
const TARGET_DERIVED: ReadonlySet<string> = new Set(['@path', '@query', '@target-uri']);

/**
 * How many extra request-target spellings a signature may be checked against.
 *
 * A cap rather than a trusted caller: the alternates are derived from an
 * agent-reachable path, and a bug upstream that produced hundreds of them would turn
 * one request into hundreds of curve operations. Excess is dropped, never thrown on
 * — no agent-reachable input may halt the world (AGT-X9).
 */
export const MAX_ALTERNATE_REQUEST_TARGETS = 3;

/**
 * Signature-base lines echoed back in a `SIGNATURE_INVALID` diagnostic.
 *
 * The covered list is client-controlled, so the diagnostic it produces has to be
 * bounded like every other outbound string (INV-26). Twenty is far past the five a
 * real client covers, and a truncation marker says so rather than lying by omission.
 */
const MAX_DIAGNOSTIC_LINES = 20;

const DEFAULT_LABEL = 'compact';

// ── the archived result ─────────────────────────────────────────────────────

/**
 * What a verified request leaves behind.
 *
 * `signatureBase` is stored verbatim because it *is* the signed statement: with
 * it, the ledger can re-prove attribution years later without reconstructing the
 * original HTTP request. That is what makes the record auditable *against us*
 * (SPEC §6.1) rather than merely by us.
 */
export interface AcceptedSignature {
  readonly principal: PrincipalId;
  readonly keyid: string;
  readonly label: string;
  readonly coveredComponents: readonly string[];
  readonly created: WallSeconds;
  readonly expires: WallSeconds | null;
  readonly nonce: string | null;
  readonly signatureBase: string;
  /** base64, exactly as it arrived. */
  readonly signature: string;
  /** Game time at acceptance. What key-liveness is judged against (SEC-2). */
  readonly acceptedAtTick: number;
}

// ── signing ─────────────────────────────────────────────────────────────────

export interface SignRequestOptions {
  readonly request: SignableRequest;
  readonly keypair: AgentKeypair;
  readonly created: WallSeconds;
  readonly nonce: string;
  readonly expires?: WallSeconds | undefined;
  readonly components?: readonly string[] | undefined;
  readonly label?: string | undefined;
}

export interface SignedHeaders {
  readonly signatureInput: string;
  readonly signature: string;
  /** Exposed so a signer can be diffed against a verifier when they disagree. */
  readonly signatureBase: string;
}

/**
 * Sign a request. Throws on programmer error — asking to cover a component the
 * message does not have is a bug in the client, not a rejected message, and
 * failing loudly here is what stops it becoming a mysterious 401 in production.
 */
export function signRequest(options: SignRequestOptions): SignedHeaders {
  const componentNames =
    options.components ??
    (options.request.body === null
      ? DEFAULT_SIGNATURE_POLICY.requiredComponents
      : [...DEFAULT_SIGNATURE_POLICY.requiredComponents, 'content-digest']);

  const params: [string, SfBareItem][] = [['created', sfInteger(options.created)]];
  if (options.expires !== undefined) params.push(['expires', sfInteger(options.expires)]);
  params.push(['keyid', sfString(options.keypair.keyid)]);
  params.push(['alg', sfString('ed25519')]);
  params.push(['nonce', sfString(options.nonce)]);

  const items: SfItem[] = componentNames.map((name) => ({
    kind: 'item',
    bare: sfString(name),
    params: [],
  }));
  const innerList: SfInnerList = { kind: 'inner-list', items, params };

  const built = buildSignatureBase(items, innerList, options.request);
  if (!built.ok) {
    throw new IdentityError(`cannot sign: ${built.detail} (${built.reason})`);
  }

  const label = options.label ?? DEFAULT_LABEL;
  const signature = options.keypair.sign(Buffer.from(built.value, 'ascii'));
  return {
    signatureInput: `${label}=${serializeInnerList(innerList)}`,
    signature: `${label}=:${encodeBase64(signature)}:`,
    signatureBase: built.value,
  };
}

// ── verification ────────────────────────────────────────────────────────────

export interface VerifyRequestOptions {
  readonly request: SignableRequest;
  /** Real time, from an injected Clock. Never read here (DET-7). */
  readonly now: WallSeconds;
  /** Game time, for key liveness. Ticks, because retirement is a world event. */
  readonly tick: number;
  readonly directory: KeyDirectory;
  readonly replay: ReplayStore;
  readonly policy?: SignaturePolicy | undefined;
}

export function verifySignedRequest(
  options: VerifyRequestOptions,
): Verified<AcceptedSignature, SignatureRejection> {
  const policy = options.policy ?? DEFAULT_SIGNATURE_POLICY;
  const headers = normaliseHeaders(options.request.headers);

  // ── structural ────────────────────────────────────────────────────────────
  const inputHeader = headers.get('signature-input');
  if (inputHeader === undefined) {
    return refuse('SIGNATURE_INPUT_MISSING', 'no Signature-Input header; every action must be signed per RFC 9421');
  }
  const signatureHeader = headers.get('signature');
  if (signatureHeader === undefined) {
    return refuse('SIGNATURE_MISSING', 'Signature-Input was present but the Signature header was not');
  }

  let inputDict: SfDictionary;
  try {
    inputDict = parseDictionary(inputHeader);
  } catch (e) {
    return refuse('SIGNATURE_INPUT_MALFORMED', describe(e));
  }
  if (inputDict.length === 0) {
    return refuse('SIGNATURE_INPUT_MALFORMED', 'Signature-Input is empty');
  }
  if (inputDict.length > 1) {
    return refuse(
      'MULTIPLE_SIGNATURES',
      `${inputDict.length} signatures offered; exactly one is accepted so that "who signed this" has one answer`,
    );
  }
  const entry = inputDict[0];
  if (entry === undefined) return refuse('SIGNATURE_INPUT_MALFORMED', 'unreachable: empty dictionary');
  const [label, member] = entry;
  if (member.kind !== 'inner-list') {
    return refuse('SIGNATURE_INPUT_MALFORMED', `Signature-Input '${label}' is not a list of covered components`);
  }

  let sigDict: SfDictionary;
  try {
    sigDict = parseDictionary(signatureHeader);
  } catch (e) {
    return refuse('SIGNATURE_MALFORMED', describe(e));
  }
  if (sigDict.length === 0) {
    return refuse('SIGNATURE_MALFORMED', 'the Signature header is empty');
  }
  if (sigDict.length > 1) {
    return refuse('MULTIPLE_SIGNATURES', `${sigDict.length} signatures offered; exactly one is accepted`);
  }
  const sigMember = dictGet(sigDict, label);
  if (sigMember === null) {
    return refuse(
      'LABEL_MISMATCH',
      `Signature-Input labels the signature '${label}' but the Signature header has no such entry`,
    );
  }
  if (sigMember.kind !== 'item' || sigMember.bare.type !== 'binary') {
    return refuse('SIGNATURE_MALFORMED', `Signature '${label}' is not a byte sequence (expected :base64:)`);
  }
  const signatureBytes = sigMember.bare.value;

  // ── parameters ────────────────────────────────────────────────────────────
  const alg = sfParam(member.params, 'alg');
  if (alg !== null && !(alg.type === 'string' && alg.value === 'ed25519')) {
    return refuse(
      'ALGORITHM_UNSUPPORTED',
      `alg must be "ed25519"; identity in this world is Ed25519 only (SPEC §6.1)`,
    );
  }
  const keyidParam = sfParam(member.params, 'keyid');
  if (keyidParam === null || keyidParam.type !== 'string') {
    return refuse('KEYID_MISSING', 'no keyid parameter, so there is no key to check the signature against');
  }
  const keyid = keyidParam.value;

  const createdParam = sfParam(member.params, 'created');
  if (createdParam === null || createdParam.type !== 'integer') {
    return refuse('CREATED_MISSING', 'no created parameter, so the signature has no age');
  }
  // Unix timestamps are non-negative. Guarded here rather than downstream, so a
  // hostile value produces a rejection and never an exception (scar #11).
  if (createdParam.value < 0) {
    return refuse('SIGNATURE_INPUT_MALFORMED', 'created must be a non-negative Unix timestamp in seconds');
  }
  const expiresParam = sfParam(member.params, 'expires');
  if (expiresParam !== null && expiresParam.type !== 'integer') {
    return refuse('SIGNATURE_INPUT_MALFORMED', 'expires must be an integer number of seconds');
  }
  if (expiresParam !== null && expiresParam.value < 0) {
    return refuse('SIGNATURE_INPUT_MALFORMED', 'expires must be a non-negative Unix timestamp in seconds');
  }

  const nonceParam = sfParam(member.params, 'nonce');
  if (nonceParam !== null && nonceParam.type !== 'string') {
    return refuse('SIGNATURE_INPUT_MALFORMED', 'nonce must be a string');
  }
  const nonce = nonceParam === null ? null : nonceParam.value;
  if (policy.requireNonce && nonce === null) {
    return refuse('NONCE_MISSING', 'a nonce is required: without one a captured request is replayable');
  }
  // Length before grammar: the cap is what keeps an over-long nonce from being
  // work we do at all, and the replay store from being asked to remember it.
  if (nonce !== null && (nonce.length > policy.maxNonceLength || !NONCE_GRAMMAR.test(nonce))) {
    return refuse(
      'NONCE_MALFORMED',
      `nonce must be 8..${policy.maxNonceLength} characters of [A-Za-z0-9_-]`,
    );
  }

  // ── the covered component list ────────────────────────────────────────────
  const covered: string[] = [];
  for (const item of member.items) {
    if (item.bare.type !== 'string') {
      return refuse('SIGNATURE_INPUT_MALFORMED', 'covered components must be strings');
    }
    const name = item.bare.value;
    if (name !== name.toLowerCase()) {
      return refuse('SIGNATURE_INPUT_MALFORMED', `component '${name}' must be lowercase (RFC 9421 §2.1)`);
    }
    if (name === '@signature-params') {
      return refuse('SIGNATURE_INPUT_MALFORMED', '@signature-params may not appear in its own covered list');
    }
    if (covered.includes(name)) {
      return refuse('COVERED_COMPONENT_DUPLICATED', `component '${name}' is covered twice`);
    }
    if (item.params.length > 0) {
      return refuse(
        'COVERED_COMPONENT_UNSUPPORTED',
        `component parameters are not implemented (on '${name}')`,
      );
    }
    if (name.startsWith('@') && !SUPPORTED_DERIVED.has(name)) {
      return refuse(
        'COVERED_COMPONENT_UNSUPPORTED',
        `derived component '${name}' is not implemented here (supported: ${[...SUPPORTED_DERIVED].join(' ')})`,
      );
    }
    covered.push(name);
  }
  for (const required of policy.requiredComponents) {
    if (!covered.includes(required)) {
      return refuse(
        'COVERED_COMPONENT_REQUIRED',
        `the signature must cover '${required}'; it covers ${covered.join(' ')}`,
      );
    }
  }

  // A signature that does not cover the digest says nothing about what was asked
  // for, only that someone asked for something at this path.
  const body = options.request.body;
  if (body !== null && body.length > 0 && policy.requireContentDigestWithBody) {
    if (headers.get('content-digest') === undefined) {
      return refuse('CONTENT_DIGEST_MISSING', 'a request with a body must carry Content-Digest (RFC 9530)');
    }
    if (!covered.includes('content-digest')) {
      return refuse(
        'CONTENT_DIGEST_UNCOVERED',
        'Content-Digest must be one of the covered components, or the body is unsigned',
      );
    }
  }

  // ── the signature base ────────────────────────────────────────────────────
  //
  // One per acceptable spelling of the request target, canonical first. A refusal
  // here can only come from the canonical build: the alternates differ from it in
  // `@path`/`@query`/`@target-uri` alone, and none of those can be absent.
  const built = buildSignatureBase(member.items, member, options.request);
  if (!built.ok) return built;
  const candidates = candidateBases(member, options.request, covered, built.value);

  // ── the body ──────────────────────────────────────────────────────────────
  const digestHeader = headers.get('content-digest');
  if (digestHeader !== undefined) {
    const digestOk = verifyContentDigest(digestHeader, body ?? new Uint8Array(0));
    if (!digestOk.ok) return digestOk;
  }

  // ── freshness ─────────────────────────────────────────────────────────────
  const created = createdParam.value;
  const expires = expiresParam === null ? null : expiresParam.value;
  if (expires !== null && expires <= created) {
    return refuse('EXPIRES_NOT_AFTER_CREATED', `expires (${expires}) is not after created (${created})`);
  }
  if (created > options.now + policy.maxSkewAhead) {
    return refuse(
      'CREATED_IN_FUTURE',
      `created ${created} is ahead of server time ${options.now} by more than the ${policy.maxSkewAhead}s skew bound`,
    );
  }
  if (options.now - created > policy.maxAge) {
    return refuse(
      'CREATED_TOO_OLD',
      `created ${created} is older than the ${policy.maxAge}s freshness window at server time ${options.now}`,
    );
  }
  if (expires !== null && options.now > expires) {
    return refuse('SIGNATURE_EXPIRED', `expires ${expires} has passed at server time ${options.now}`);
  }

  // ── the key ───────────────────────────────────────────────────────────────
  const registration = options.directory.lookup(keyid);
  if (registration === null) {
    return refuse('KEYID_UNKNOWN', `keyid ${keyid} is not registered; enroll before acting`);
  }
  if (options.tick < registration.registeredAtTick) {
    return refuse(
      'KEY_NOT_YET_REGISTERED',
      `key ${keyid} takes effect at tick ${registration.registeredAtTick}, and it is tick ${options.tick}`,
    );
  }
  if (!keyLiveAt(registration, options.tick)) {
    return refuse(
      'KEY_RETIRED',
      `key ${keyid} was retired at tick ${String(registration.retiredAtTick)}; sign with the current key. Signatures already accepted under it remain valid.`,
    );
  }

  // ── crypto ────────────────────────────────────────────────────────────────
  //
  // Canonical spelling first, so the common case is one curve operation and the
  // archived base is the RFC-correct one whenever both would verify.
  let verified: BaseCandidate | null = null;
  for (const candidate of candidates) {
    if (verifyBytes(registration.publicKeyJwk, Buffer.from(candidate.base, 'ascii'), signatureBytes)) {
      verified = candidate;
      break;
    }
  }
  if (verified === null) {
    return refuse('SIGNATURE_INVALID', invalidDetail(covered, candidates), invalidDiagnostic(covered, candidates));
  }

  // ── replay: the only state this function writes, and it writes it last ────
  if (nonce !== null) {
    const outcome = options.replay.spend(keyid, nonce, options.now);
    if (outcome === 'REPLAYED') {
      return refuse('NONCE_REPLAYED', `nonce ${nonce} has already been used by this key`);
    }
    if (outcome === 'BUDGET_EXCEEDED') {
      return refuse(
        'NONCE_BUDGET_EXCEEDED',
        'too many unexpired signatures outstanding for this key; slow down and reuse a wake',
      );
    }
  }

  return accept<AcceptedSignature>({
    principal: registration.principal,
    keyid,
    label,
    coveredComponents: covered,
    created: wallSeconds(created),
    expires: expires === null ? null : wallSeconds(expires),
    nonce,
    // The base that actually verified, never the canonical one — an archive that
    // records a base the bytes do not sign is an archive that cannot be re-proved.
    signatureBase: verified.base,
    signature: encodeBase64(signatureBytes),
    acceptedAtTick: options.tick,
  });
}

// ── candidate bases, and the diagnostic when none of them verify ────────────

interface BaseCandidate {
  /** The request-target spelling this base was built from. */
  readonly target: string;
  readonly base: string;
}

/**
 * Every base this signature may legitimately have been made over, canonical first.
 *
 * Returns the canonical one alone unless a target-derived component is actually
 * covered — if the signature says nothing about the path, every spelling produces a
 * byte-identical base and the extra curve operations would buy nothing.
 */
function candidateBases(
  innerList: SfInnerList,
  request: SignableRequest,
  covered: readonly string[],
  canonicalBase: string,
): readonly BaseCandidate[] {
  const out: BaseCandidate[] = [{ target: request.requestTarget, base: canonicalBase }];
  if (!covered.some((name) => TARGET_DERIVED.has(name))) return out;
  const alternates = (request.alternateRequestTargets ?? []).slice(0, MAX_ALTERNATE_REQUEST_TARGETS);
  for (const target of alternates) {
    if (out.some((candidate) => candidate.target === target)) continue;
    const rebuilt = buildSignatureBase(innerList.items, innerList, { ...request, requestTarget: target });
    // A build that fails for an alternate cannot succeed for the canonical either,
    // and the canonical has already succeeded — so this is unreachable and skipped
    // rather than returned, because a refusal here would be the wrong reason.
    if (rebuilt.ok) out.push({ target, base: rebuilt.value });
  }
  return out;
}

/**
 * The sentence a client reads when its signature does not verify.
 *
 * Leads with the actionable fact and never names an innocent cause first. The
 * section number of RFC 9421's `@path` rule is deliberately *not* quoted: the
 * outbound scrubber redacts anything shaped like a semantic version, so "§2.2.6"
 * would reach the agent as "§[version]" — a rules surface mangled by a security
 * filter, which is precisely the class of bug this whole change is about.
 */
function invalidDetail(covered: readonly string[], candidates: readonly BaseCandidate[]): string {
  const parts = [
    'the signature does not verify over the signature base we computed.',
    'That base is in diagnostic.signature_base, one line per covered component — diff it against yours rather than guessing.',
  ];
  if (covered.includes('@path')) {
    const paths = candidates.map((candidate) => splitTarget(candidate.target).path);
    const canonical = paths[0] ?? '/';
    parts.push(
      `We computed "@path": ${canonical} — RFC 9421 derives @path from the request target you sent, including any mount prefix.`,
    );
    const others = paths.slice(1).filter((path) => path !== canonical);
    if (others.length > 0) parts.push(`We also checked ${others.join(' and ')}.`);
  }
  parts.push('If your base matches ours line for line, the bytes were signed by a different key.');
  return parts.join(' ');
}

/** The machine-readable half. See {@link RefusalDiagnostic} for why it is safe to send. */
function invalidDiagnostic(
  covered: readonly string[],
  candidates: readonly BaseCandidate[],
): RefusalDiagnostic {
  const canonical = candidates[0];
  return {
    signature_base: bounded(canonical === undefined ? [] : canonical.base.split('\n'), 'lines'),
    covered_components: bounded(covered, 'components'),
    // Bounded by construction: at most MAX_ALTERNATE_REQUEST_TARGETS + 1.
    request_targets_checked: candidates.map((candidate) => candidate.target),
  };
}

/**
 * Cap a client-controlled list on its way out, saying so rather than lying by omission.
 *
 * Both lists here are derived from the covered-component list, which a caller chooses.
 * Echoing it wholesale is not amplification — every entry had to be present in the
 * request — but "not amplification" is not the same as "bounded", and INV-26 asks for
 * bounded.
 */
function bounded(values: readonly string[], noun: string): readonly string[] {
  if (values.length <= MAX_DIAGNOSTIC_LINES) return values;
  return [
    ...values.slice(0, MAX_DIAGNOSTIC_LINES),
    `… ${String(values.length - MAX_DIAGNOSTIC_LINES)} further ${noun}`,
  ];
}

/**
 * Re-verify an archived signature — the audit path, and the answer to SEC-2's
 * second half.
 *
 * Judged against the tick it was **accepted** at, so rotating a key never unmakes
 * a promise made under the old one. Freshness and replay are not checked: an
 * archive entry is a record, not a request, and refusing it for being old would
 * mean the record expires.
 */
export function verifyArchivedSignature(
  record: AcceptedSignature,
  directory: KeyDirectory,
): Verified<KeyRegistration, SignatureRejection> {
  const registration = directory.lookup(record.keyid);
  if (registration === null) {
    return refuse('KEYID_UNKNOWN', `keyid ${record.keyid} is not in the directory; the archive cannot be checked`);
  }
  if (registration.principal !== record.principal) {
    return refuse(
      'SIGNATURE_INVALID',
      `the archive attributes this to ${record.principal} but key ${record.keyid} belongs to ${registration.principal}`,
    );
  }
  if (!keyLiveAt(registration, record.acceptedAtTick)) {
    return refuse(
      'KEY_RETIRED',
      `key ${record.keyid} was not live at tick ${record.acceptedAtTick}, so this record could not have been signed with it`,
    );
  }
  const signature = decodeBase64(record.signature);
  if (signature === null) {
    return refuse('SIGNATURE_MALFORMED', 'the archived signature is not canonical base64');
  }
  if (!verifyBytes(registration.publicKeyJwk, Buffer.from(record.signatureBase, 'ascii'), signature)) {
    return refuse('SIGNATURE_INVALID', 'the archived signature does not verify over the archived signature base');
  }
  return accept(registration);
}

/**
 * Bundles the three things verification needs and checks the one invariant that
 * spans them: **a nonce must be remembered for at least as long as a signature
 * bearing it can still be fresh.** Otherwise there is a replay hole exactly the
 * width of the difference, and it is invisible — every individual component is
 * correct, which is scar #1's shape.
 */
export class RequestVerifier {
  constructor(
    private readonly directory: KeyDirectory,
    private readonly replay: ReplayStore,
    private readonly policy: SignaturePolicy = DEFAULT_SIGNATURE_POLICY,
  ) {}

  static assertReplayCoversPolicy(limits: ReplayStoreLimits, policy: SignaturePolicy): void {
    const window = policy.maxAge + policy.maxSkewAhead;
    if (limits.retention < window) {
      throw new IdentityError(
        `replay retention (${limits.retention}s) is shorter than the freshness window ` +
          `(${policy.maxAge}s age + ${policy.maxSkewAhead}s skew = ${window}s): a nonce could be forgotten while still replayable`,
      );
    }
  }

  verify(request: SignableRequest, now: WallSeconds, tick: number): Verified<AcceptedSignature, SignatureRejection> {
    return verifySignedRequest({
      request,
      now,
      tick,
      directory: this.directory,
      replay: this.replay,
      policy: this.policy,
    });
  }
}

// ── the signature base, per RFC 9421 §2.5 ───────────────────────────────────

/**
 * One line per covered component (`"name": value`), LF-separated, then the
 * `"@signature-params"` line — with **no trailing newline**. The last detail is
 * the one everyone gets wrong, and it fails as an opaque signature mismatch.
 */
function buildSignatureBase(
  items: readonly SfItem[],
  innerList: SfInnerList,
  request: SignableRequest,
): Verified<string, SignatureRejection> {
  const headers = normaliseHeaders(request.headers);
  const lines: string[] = [];
  for (const item of items) {
    if (item.bare.type !== 'string') {
      return refuse('SIGNATURE_INPUT_MALFORMED', 'covered components must be strings');
    }
    const name = item.bare.value;
    const value = componentValue(name, request, headers);
    if (value === null) {
      return refuse(
        'COVERED_COMPONENT_ABSENT',
        `the signature covers '${name}' but the message does not have it`,
      );
    }
    lines.push(`${serializeItem({ kind: 'item', bare: sfString(name), params: item.params })}: ${value}`);
  }
  lines.push(`${serializeItem({ kind: 'item', bare: sfString('@signature-params'), params: [] })}: ${serializeInnerList(innerList)}`);
  return accept(lines.join('\n'));
}

function componentValue(
  name: string,
  request: SignableRequest,
  headers: ReadonlyMap<string, string>,
): string | null {
  switch (name) {
    case '@method':
      return request.method.toUpperCase();
    case '@authority':
      return normaliseAuthority(request.authority, request.scheme);
    case '@scheme':
      return request.scheme;
    case '@path': {
      const path = splitTarget(request.requestTarget).path;
      // RFC 9421 §2.2.6: an empty path is the single slash.
      return path === '' ? '/' : path;
    }
    case '@query': {
      const query = splitTarget(request.requestTarget).query;
      // RFC 9421 §2.2.7: the value carries the leading '?', and is '?' when absent.
      return query === null ? '?' : `?${query}`;
    }
    case '@target-uri':
      return `${request.scheme}://${normaliseAuthority(request.authority, request.scheme)}${request.requestTarget}`;
    default: {
      if (name.startsWith('@')) return null;
      return headers.get(name) ?? null;
    }
  }
}

function splitTarget(target: string): { readonly path: string; readonly query: string | null } {
  const q = target.indexOf('?');
  if (q < 0) return { path: target, query: null };
  return { path: target.slice(0, q), query: target.slice(q + 1) };
}

/**
 * Lowercase, and drop the port when it is the scheme's default. Both are required
 * by RFC 9421 §2.2.3 and both are things a client and a server will otherwise
 * disagree about silently — `Example.com:443` and `example.com` are the same
 * authority and must produce the same base.
 */
function normaliseAuthority(authority: string, scheme: 'http' | 'https'): string {
  const lower = authority.toLowerCase();
  const defaultPort = scheme === 'https' ? ':443' : ':80';
  return lower.endsWith(defaultPort) ? lower.slice(0, -defaultPort.length) : lower;
}

/**
 * Lowercase the names and canonicalise the values per RFC 9421 §2.1: strip
 * leading and trailing OWS, replace obs-folds with a single space, and join
 * repeated fields with ", ".
 */
function normaliseHeaders(
  headers: Readonly<Record<string, string | readonly string[]>>,
): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const rawName of Object.keys(headers)) {
    const value = headers[rawName];
    if (value === undefined) continue;
    const name = rawName.toLowerCase();
    const raw: readonly string[] = typeof value === 'string' ? [value] : value;
    const parts = raw.map((v) => v.replace(/\r?\n[ \t]+/g, ' ').trim());
    const joined = parts.join(', ');
    const existing = out.get(name);
    out.set(name, existing === undefined ? joined : `${existing}, ${joined}`);
  }
  return out;
}

function describe(e: unknown): string {
  return e instanceof SfParseError ? e.message : String(e);
}
