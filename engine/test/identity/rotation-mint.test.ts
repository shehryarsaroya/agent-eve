/**
 * SEC-2, the half that was missing: **a retired key must not be able to mint.**
 *
 * Found by the wave-1 adversarial verifier. `bindIssuer` judged issuer liveness
 * at `credential.validFromTick` — a field the issuer chooses and then signs. So a
 * principal who rotated away a leaked key had not actually contained anything:
 * the thief could keep issuing brand-new credentials indefinitely by back-dating
 * that one field, and every one of them verified.
 *
 * Why this is A5′-adjacent rather than merely a key-hygiene bug: a grant is the
 * authority under which a delegate acts, and every act carries `grant_id`. A
 * forged grant therefore attributes real, permanent, public consequences to a
 * principal that never authorised them — through a code path that looks exactly
 * like correct verification.
 *
 * The fix had to satisfy two rules that pull in opposite directions, which is why
 * the module now has two explicit modes rather than one defaulted parameter:
 *
 *   1. **Rotation is prospective.** A grant validly issued under a key that later
 *      rotated stays valid, or every grantor holds a delete button for its own
 *      outstanding authority — rotate instead of revoking and the delegate's
 *      authority silently evaporates. `rotation.test.ts` already pinned this.
 *   2. **A retired key cannot mint.** This file.
 *
 * The only thing separating the two is *who supplied the tick*: the server's own
 * admission record, or the current tick. Never a tick from the credential.
 */

import { describe, expect, it } from 'vitest';
import type { GrantId } from '../../src/core/types.js';
import { minor } from '../../src/core/units.js';
import {
  generateKeypair,
  issueGrantCredential,
  verifyArchivedGrantCredential,
  verifyGrantCredential,
} from '../../src/identity/index.js';
import { enrol, newKeyring } from './helpers.js';

function credentialFrom(
  keyring: ReturnType<typeof newKeyring>,
  grantorName: string,
  delegateName: string,
  id: string,
  issuedAtTick: number,
) {
  const grantor = enrol(keyring, grantorName, 10);
  const delegate = enrol(keyring, delegateName, 10);
  const credential = issueGrantCredential({
    claims: {
      id: id as GrantId,
      grantor: grantor.id,
      delegate: delegate.id,
      template: 'quartermaster',
      maxDirectLoss: minor(40_000),
      maxContingentLiability: minor(120_000),
      expiresTick: 9_000,
    },
    issuerKeypair: grantor.keypair,
    issuerDidKey: grantor.keypair.record.didKey,
    delegateDidKey: delegate.keypair.record.didKey,
    issuedAtTick,
    delegationChain: [grantor.id],
  });
  return { grantor, delegate, credential };
}

describe('SEC-2 — a retired key cannot mint new authority', () => {
  it('refuses a credential minted by a retired key, even back-dated to when it was live', () => {
    const keyring = newKeyring();
    const { grantor, credential } = credentialFrom(keyring, 'halcyon', 'thief', 'g-forged', 20);

    // The key leaks; the principal does the responsible thing and rotates.
    keyring.rotate(grantor.id, generateKeypair().record, 100);

    // Admitting it now, long after the rotation, must fail. The credential is
    // cryptographically perfect — the signature verifies. What fails is the
    // authority question, which is the one that matters.
    const admit = verifyGrantCredential(credential, { atTick: 500, directory: keyring });
    expect(admit.ok).toBe(false);
    if (!admit.ok) expect(admit.reason).toBe('CREDENTIAL_ISSUER_KEY_RETIRED');
  });

  it('refuses at the rotation tick itself, so there is no off-by-one window', () => {
    const keyring = newKeyring();
    const { grantor, credential } = credentialFrom(keyring, 'halcyon', 'thief', 'g-edge', 20);
    keyring.rotate(grantor.id, generateKeypair().record, 100);

    const atRotation = verifyGrantCredential(credential, { atTick: 100, directory: keyring });
    expect(atRotation.ok).toBe(false);
  });

  it('still honours a grant the key issued while live, audited at its recorded admission tick', () => {
    // Rule 1. The distinction is the *source* of the tick: here it is the server's
    // admission record, which the signer cannot influence.
    const keyring = newKeyring();
    const { grantor, credential } = credentialFrom(keyring, 'vale', 'orison', 'g-genuine', 20);

    // The world admitted it at tick 20, while the key was live.
    expect(verifyGrantCredential(credential, { atTick: 20, directory: keyring }).ok).toBe(true);

    // The grantor later rotates. That must not reach backwards.
    keyring.rotate(grantor.id, generateKeypair().record, 100);

    const audit = verifyArchivedGrantCredential(credential, {
      atTick: 5_000,
      directory: keyring,
      admittedAtTick: 20,
    });
    expect(audit.ok).toBe(true);
  });

  it('cannot be laundered through the audit path with a post-rotation admission tick', () => {
    // The obvious escape is to claim the forgery was admitted long ago, which
    // requires an admission record that does not exist. This pins the weaker
    // property the module can enforce on its own: the audit tick is still checked
    // against the keyring, so a tick after the rotation is refused either way.
    const keyring = newKeyring();
    const { grantor, credential } = credentialFrom(keyring, 'halcyon', 'thief', 'g-laundered', 20);
    keyring.rotate(grantor.id, generateKeypair().record, 100);

    const laundered = verifyArchivedGrantCredential(credential, {
      atTick: 5_000,
      directory: keyring,
      admittedAtTick: 400, // after the rotation
    });
    expect(laundered.ok).toBe(false);
    if (!laundered.ok) expect(laundered.reason).toBe('CREDENTIAL_ISSUER_KEY_RETIRED');
  });
});
