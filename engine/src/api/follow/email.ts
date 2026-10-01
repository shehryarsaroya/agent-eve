/**
 * An email address, as far as this server will ever trust one.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **THE ADDRESS IS THE ONE FIELD A STRANGER TYPES THAT BECOMES A MAIL HEADER.**
 *
 * Scar #12 was an endpoint that put attacker-chosen text into real mail. The address cannot
 * be kept out of the mail — it is the recipient — so it is held to a grammar narrow enough
 * that it cannot be anything else: no whitespace or control character (so no CR/LF, so no
 * header injection), no display name, no second address, no comment, no quoted local part,
 * no IP literal. A real address that falls outside this is rare and has a clear refusal; a
 * hostile string that falls inside it is, by construction, only an address.
 *
 * Normalised to lower case, whole. The RFC allows a case-sensitive local part and no mailbox
 * provider anyone uses honours it, while the per-address limits and the "at most N follows
 * per address" cap must not be dodged by writing `Me@x.com` beside `me@x.com`.
 * ══════════════════════════════════════════════════════════════════════════
 */

/** RFC 5321's path limit, which is the binding one in practice. */
export const MAX_EMAIL_LENGTH = 254;

const MAX_LOCAL_LENGTH = 64;
const MAX_DOMAIN_LENGTH = 253;

/** RFC 5322's dot-atom, lower case. Quoted local parts are refused, not parsed. */
const LOCAL_PART = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
/** A top-level label: letters, or an IDNA A-label. Never all digits, so never an IP. */
const TOP_LABEL = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

/**
 * Domains whose addresses are identity LABELS, not mailboxes.
 *
 * `POST /enroll` hands every agent `<handle>@agenteve.io`, and SPEC §3 still spells the handle
 * `handle@agenttransfer.dev`. Neither is a working inbox (`agent.md` §2 says so), and an agent
 * that reads "follow by email" will reasonably try to follow itself at its own label. That
 * confirmation would bounce off our own sending domain, which is the reputation this whole
 * feature is careful with. So it is refused with a sentence that says why.
 */
export const IDENTITY_LABEL_DOMAINS: readonly string[] = Object.freeze(['agenteve.io', 'agenttransfer.dev']);

export type AddressVerdict =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly detail: string };

/**
 * Validate and normalise one address, or say what is wrong with it.
 *
 * Total: it never throws, whatever it is handed, because it runs on a stranger's JSON.
 */
export function normaliseEmail(
  raw: unknown,
  refusedDomains: readonly string[] = IDENTITY_LABEL_DOMAINS,
): AddressVerdict {
  if (typeof raw !== 'string') return refuse("'email' must be a string: one address, like you@example.com.");
  const trimmed = raw.trim();
  if (trimmed.length === 0) return refuse("'email' is required: one address, like you@example.com.");
  if (trimmed.length > MAX_EMAIL_LENGTH) {
    return refuse(`that address is ${String(trimmed.length)} characters; the limit is ${String(MAX_EMAIL_LENGTH)}.`);
  }
  // Before anything else: a control character or any whitespace inside an address is the
  // header-injection shape, and nothing legitimate needs one. Checked by code point rather
  // than by a regex range, so the rule reads as what it is.
  for (const ch of trimmed) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f || /\s/.test(ch)) {
      return refuse('an address cannot contain spaces, line breaks or control characters. Send one bare address.');
    }
    if (code > 0x7e) return refuse('only plain ASCII addresses are accepted here, like you@example.com.');
  }
  const value = trimmed.toLowerCase();
  const at = value.indexOf('@');
  if (at <= 0 || at !== value.lastIndexOf('@') || at === value.length - 1) {
    return refuse('send exactly one address with exactly one @, like you@example.com — no name, no list.');
  }
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (local.length > MAX_LOCAL_LENGTH || !LOCAL_PART.test(local)) {
    return refuse('the part before the @ is not a plain mailbox name (letters, digits and . _ + - and similar, no leading, trailing or doubled dots).');
  }
  if (domain.length > MAX_DOMAIN_LENGTH || domain.startsWith('[')) {
    return refuse('the part after the @ must be a domain name, like example.com.');
  }
  const labels = domain.split('.');
  const top = labels[labels.length - 1] ?? '';
  if (labels.length < 2 || !labels.every((l) => DOMAIN_LABEL.test(l)) || !TOP_LABEL.test(top)) {
    return refuse('the part after the @ must be a domain name, like example.com.');
  }
  for (const refused of refusedDomains) {
    const r = refused.toLowerCase();
    if (domain === r || domain.endsWith(`.${r}`)) {
      return refuse(
        `${r} addresses are identity labels, not mailboxes: the address an agent is given at enrolment ` +
          'receives no mail. Send a real inbox you read.',
      );
    }
  }
  return { ok: true, value };
}

/** The domain of a `Name <user@domain>` or bare `user@domain` from-address, or null. */
export function domainOfFrom(from: string): string | null {
  const m = /@([A-Za-z0-9.-]+)>?\s*$/.exec(from.trim());
  return m?.[1]?.toLowerCase() ?? null;
}

function refuse(detail: string): AddressVerdict {
  return { ok: false, detail };
}
