/**
 * The agent side: build a signed request in one call.
 *
 * This exists because of the ordering hazard. A body must be digested *before* it
 * is signed, and the digest header must be present *and* covered. Get the order
 * wrong and you produce a request that is signed, well-formed, and rejected — and
 * the client author's natural next move is to remove the digest rather than to
 * reorder, which loses body integrity while making the symptom go away.
 *
 * So there is exactly one sanctioned way to build one, it is what `agent.md` will
 * show, and it is what our own house cast uses. High Water's validated pattern #2:
 * an agent should reach a legal first move in one round trip, from one artifact.
 */

import { contentDigestHeader } from './digest.js';
import type { SignableRequest, SignedHeaders } from './httpsig.js';
import { signRequest } from './httpsig.js';
import type { AgentKeypair } from './keys.js';
import { IdentityError } from './reasons.js';
import type { WallSeconds } from './wallclock.js';

export interface BuildSignedRequestOptions {
  readonly method: string;
  readonly scheme: 'http' | 'https';
  readonly authority: string;
  /** Origin-form: `/act`, `/observe?wait=true`. */
  readonly requestTarget: string;
  /** Already-serialised body bytes, or null. Serialise once, digest those bytes. */
  readonly body?: Uint8Array | null | undefined;
  readonly keypair: AgentKeypair;
  /** Unix seconds from the caller's own clock. Never read here (DET-7). */
  readonly created: WallSeconds;
  /** Single-use, 8+ chars of [A-Za-z0-9_-]. */
  readonly nonce: string;
  readonly expires?: WallSeconds | undefined;
  readonly headers?: Readonly<Record<string, string>> | undefined;
}

export interface SignedRequest {
  /** What the verifier will reduce the message to. Useful in tests and probes. */
  readonly request: SignableRequest;
  /** Ready to hand to `fetch`, including the two signature headers. */
  readonly headers: Readonly<Record<string, string>>;
  readonly signed: SignedHeaders;
}

export function buildSignedRequest(options: BuildSignedRequestOptions): SignedRequest {
  if (!options.requestTarget.startsWith('/')) {
    throw new IdentityError(
      `requestTarget must be origin-form and start with "/", got ${options.requestTarget}`,
    );
  }
  const body = options.body ?? null;
  const headers: Record<string, string> = { ...(options.headers ?? {}) };

  // Digest first, then sign — the whole reason this helper exists.
  const components = ['@method', '@path', '@authority'];
  if (body !== null && body.length > 0) {
    headers['content-digest'] = contentDigestHeader(body);
    components.push('content-digest');
  }

  const request: SignableRequest = {
    method: options.method,
    scheme: options.scheme,
    authority: options.authority,
    requestTarget: options.requestTarget,
    headers,
    body,
  };

  const signed = signRequest({
    request,
    keypair: options.keypair,
    created: options.created,
    nonce: options.nonce,
    expires: options.expires,
    components,
  });

  const outbound: Record<string, string> = {
    ...headers,
    'signature-input': signed.signatureInput,
    signature: signed.signature,
  };
  // The request the verifier sees carries the signature headers too. Returning a
  // request object that lacks them would make a test pass that production fails.
  return { request: { ...request, headers: outbound }, headers: outbound, signed };
}
