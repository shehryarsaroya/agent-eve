/**
 * Adversarial verification pass over `src/identity` — counterexamples written
 * against the module's *stated* invariants rather than against its code.
 *
 * Follows `test/core/vocabulary.test.ts`'s convention: each defect is an
 * `it.fails` asserting the **correct** behaviour (so it flips to an unexpected
 * pass the moment it is fixed) paired with a companion test that records what
 * happens today, so the defect is not abstract.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

import { minor } from '../../src/core/units.js';
import type { GrantId } from '../../src/core/types.js';
import {
  BoundedReplayStore,
  DEFAULT_SIGNATURE_POLICY,
  RequestVerifier,
  buildSignedRequest,
  generateKeypair,
  issueGrantCredential,
  verifyGrantCredential,
  wallSeconds,
} from '../../src/identity/index.js';
import type { GrantCredential, KeyDirectory, ReplayStoreLimits } from '../../src/identity/index.js';
import { NOW, TICK, enrol, newKeyring } from './helpers.js';

const NONCE = 'nonce-aaaaaaaa';

// ── DEFECT 1 ────────────────────────────────────────────────────────────────

/** retention (30 s) < maxAge (60 s) + skew (30 s): the pairing the guard exists to refuse. */
const TOO_SHORT: ReplayStoreLimits = { retention: wallSeconds(30), perKeyCap: 8, maxKeys: 8 };
const WIDE_ENOUGH: ReplayStoreLimits = { retention: wallSeconds(90), perKeyCap: 8, maxKeys: 8 };

function replayTwice(limits: ReplayStoreLimits): { first: boolean; second: boolean; reason?: string } {
  const keyring = newKeyring();
  const { keypair } = enrol(keyring, 'vale');
  const verifier = new RequestVerifier(keyring, new BoundedReplayStore(limits));
  const built = buildSignedRequest({
    method: 'POST',
    scheme: 'https',
    authority: 'compact.example',
    requestTarget: '/act',
    keypair,
    created: NOW,
    nonce: NONCE,
  });
  const first = verifier.verify(built.request, NOW, TICK);
  // `now - created > maxAge` is false at exactly maxAge, so the captured request
  // is still fresh — and by now the store has rotated the nonce out.
  const second = verifier.verify(built.request, wallSeconds(NOW + DEFAULT_SIGNATURE_POLICY.maxAge), TICK);
  return { first: first.ok, second: second.ok, ...(second.ok ? {} : { reason: second.reason }) };
}

describe('DEFECT(identity/httpsig) — RequestVerifier does not check the invariant it documents', () => {
  it.fails(
    'DEFECT: the RequestVerifier constructor must refuse a store that would forget a nonce while it is still replayable',
    () => {
      // httpsig.ts's class doc: "Bundles the three things verification needs and
      // checks the one invariant that spans them: a nonce must be remembered for
      // at least as long as a signature bearing it can still be fresh."
      //
      // `assertReplayCoversPolicy` implements that check, but nothing in `src/`
      // calls it. The invariant is documented, unit-tested in isolation, and
      // unenforced on the only path a caller uses.
      expect(() => new RequestVerifier(newKeyring(), new BoundedReplayStore(TOO_SHORT))).toThrow();
    },
  );

  it.fails('DEFECT: a captured request must not verify twice under any store the caller supplies', () => {
    expect(replayTwice(TOO_SHORT).second).toBe(false);
  });

  it('records the live behaviour: byte-identical replay, accepted', () => {
    expect(() => RequestVerifier.assertReplayCoversPolicy(TOO_SHORT, DEFAULT_SIGNATURE_POLICY)).toThrow(
      /shorter than the freshness window/,
    );
    expect(() => new RequestVerifier(newKeyring(), new BoundedReplayStore(TOO_SHORT))).not.toThrow();
    expect(replayTwice(TOO_SHORT)).toMatchObject({ first: true, second: true });
  });

  it('control — a store that satisfies the guard refuses the identical replay', () => {
    RequestVerifier.assertReplayCoversPolicy(WIDE_ENOUGH, DEFAULT_SIGNATURE_POLICY);
    expect(replayTwice(WIDE_ENOUGH)).toMatchObject({
      first: true,
      second: false,
      reason: 'NONCE_REPLAYED',
    });
  });
});

// ── DEFECT 2 ────────────────────────────────────────────────────────────────

/**
 * `keyring.ts`: "Retiring a key stops it *authenticating new requests* from the
 * tick the rotation lands." `vc.ts`'s `bindIssuer` judges the issuer key live at
 * `credential.validFromTick` — a field the **signer** chooses and signs.
 *
 * So a retired key cannot authenticate a request, but it can still mint brand-new
 * grants: backdate `validFromTick` into the window when the key was live, and the
 * credential verifies at any later tick. Rotation is the only remedy available
 * against a leaked key — a principal cannot revoke a credential it has never seen
 * — so this is precisely the case rotation exists for.
 */
function forgeBackdatedGrant(): { credential: GrantCredential; directory: KeyDirectory } {
  const keyring = newKeyring();
  const grantor = enrol(keyring, 'vale', 0);
  const accomplice = enrol(keyring, 'kell', 0);
  // The grantor learns its key is leaked and rotates at tick 100. There is no
  // outstanding credential to revoke.
  keyring.rotate(grantor.id, generateKeypair().record, 100);
  const credential = issueGrantCredential({
    claims: {
      id: 'g-forged' as GrantId,
      grantor: grantor.id,
      delegate: accomplice.id,
      template: 'quartermaster',
      maxDirectLoss: minor(40_000),
      maxContingentLiability: minor(120_000),
      expiresTick: 99_999,
    },
    issuerKeypair: grantor.keypair, // the RETIRED key
    issuedAtTick: 50, // backdated to before the rotation landed
    issuerDidKey: grantor.keypair.record.didKey,
    delegateDidKey: accomplice.keypair.record.didKey,
    delegationChain: [grantor.id],
  });
  return { credential, directory: keyring };
}

describe('FIXED(identity/vc) — a rotated-out key can no longer mint by backdating', () => {
  it('a key retired at tick 100 creates no authority readable at tick 500', () => {
    // Was an it.fails pin. `bindIssuer` judged issuer liveness at
    // `credential.validFromTick`, a field the signer chooses and then signs, so a
    // leaked-then-rotated key kept minting valid grants forever. Rotation had
    // contained nothing.
    //
    // Liveness is now judged at a tick the SERVER supplied — the current tick when
    // admitting, the recorded admission tick when auditing. Never one from the
    // credential. See test/identity/rotation-mint.test.ts for the full pair, and
    // rotation.test.ts for the opposite rule it has to coexist with.
    const { credential, directory } = forgeBackdatedGrant();
    const verdict = verifyGrantCredential(credential, { atTick: 500, directory });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe('CREDENTIAL_ISSUER_KEY_RETIRED');
  });

  it('the backdated fields are still signed and still unfalsifiable — which is why the tick must come from us', () => {
    // The forgery remains cryptographically perfect. Nothing about the credential
    // betrays it, and no later auditor could tell it from one genuinely issued at
    // tick 50. That is precisely why the verifying tick cannot be sourced from the
    // document being verified.
    const { credential } = forgeBackdatedGrant();
    expect(credential.validFromTick).toBe(50);
    expect(credential.proof.createdAtTick).toBe(50);
  });
});

// ── DEFECT 3 ────────────────────────────────────────────────────────────────

/**
 * HARD RULE 4 / SPEC §3 / scar #1. §3 canonises **MANDATE** as "an owner's
 * published disposition — advice the agent may disregard", and its *Never means*
 * column reads: **a grant**. That concept already owns a table in
 * `src/db/schema.sql` ("An owner's published disposition … §13B").
 *
 * `src/identity/vc.ts` uses `claims` throughout for the signed subset of a
 * GRANT — `GrantClaims`, `claimsOf`, `claimsFromCredential`, and a rejection
 * detail. One word, two concepts, in one codebase.
 */
function mandateSites(): readonly string[] {
  const dir = new URL('../../src/identity/', import.meta.url);
  const sites: string[] = [];
  const names = readdirSync(dir).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const name of names) {
    if (!name.endsWith('.ts')) continue;
    const lines = readFileSync(new URL(name, dir), 'utf8').split('\n');
    for (const [i, line] of lines.entries()) {
      // Skip prose: `//` tails and `*` continuation lines are not a rules surface.
      const code = line.replace(/\/\/.*$/, '');
      if (/^\s*\*/.test(code)) continue;
      if (/[Mm]andate/.test(code)) sites.push(`${name}:${i + 1}`);
    }
  }
  return sites;
}

// ── DEFECT 4 ────────────────────────────────────────────────────────────────

/**
 * A literal NUL byte in a source file makes `grep` treat the whole file as binary
 * and produce **no output at all** — `file` reports "data", `grep -c ""` prints
 * nothing. `tsc`, `eslint` and `vitest` read it happily (NUL is valid UTF-8), so
 * every gate stays green while the file is invisible to text tooling.
 *
 * That matters here specifically: SEC-9's stated enforcement is "assert by
 * pattern-scanning all outbound artifacts in CI", and the §3 vocabulary
 * discipline is grep over the rules surface. A file grep silently skips is a hole
 * in both.
 *
 * `test/identity/vc.test.ts:448` had one, inside `fc.string(...).filter((s) =>
 * !s.includes(' '))` where a space was plainly meant — `fc.string()` emits a
 * space in ~8% of samples and NUL in none, so the filter removed nothing.
 * Corrected; this guard keeps it corrected. `test/core/canonical.prop.test.ts`
 * has two more (another module's file, reported not touched).
 */
function filesWithNulBytes(): readonly string[] {
  const roots = [new URL('../../src/identity/', import.meta.url), new URL('./', import.meta.url)];
  const hits: string[] = [];
  for (const dir of roots) {
    const names = readdirSync(dir).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (const name of names) {
      if (!name.endsWith('.ts')) continue;
      if (readFileSync(new URL(name, dir)).includes(0)) hits.push(name);
    }
  }
  return hits;
}

describe('no source file in this module may contain a NUL byte', () => {
  it('because grep silently skips such a file while every gate stays green', () => {
    expect(filesWithNulBytes()).toEqual([]);
  });
});

describe('FIXED(identity/vc) — §3: MANDATE names only the owner concept', () => {
  it('no identity source file uses MANDATE for a grant', () => {
    // Was an it.fails pin. §3 canonises MANDATE as "an owner's published
    // disposition — advice the agent may disregard", and its Never-means column
    // reads literally: **a grant**. vc.ts had used it for a grant's signed subset
    // across ~35 sites while `schema.sql` already held the owner concept under the
    // same word. One word, two concepts, one codebase — scar #1's exact shape, and
    // the reason HARD RULE 4 extends to field names.
    //
    // Renamed to `claims`, which is also the correct W3C VC word for a
    // credential's signed subject.
    expect(mandateSites()).toEqual([]);
  });

  it('the owner concept still owns the word, so the rename moved the collision rather than deleting the term', () => {
    const schema = readFileSync(new URL('../../src/db/schema.sql', import.meta.url), 'utf8');
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS mandate');
    expect(schema).toContain("An owner's published disposition");
  });
});
