/**
 * The repo-wide §3 vocabulary guard.
 *
 * `vocabulary.test.ts` proves the unions in `core/types.ts` against the canon, and
 * it is careful and compiler-checked. It also **missed every collision wave 1
 * actually shipped**, because all three lived in other modules:
 *
 *   `HoldingState.STANDING`   src/world/holding.ts
 *   `Protection.EXPOSED`      src/world/commons.ts   (§3: EXPOSURE never means peril scope)
 *   `GrantMandate` / `mandateOf`  src/identity/vc.ts (§3: MANDATE never means a grant)
 *
 * Each module's own verifier eventually found its own collision by writing a
 * scanner scoped to its own directory. That is three scanners that cannot see each
 * other, which is the same shape as the bug: a detector with a blind spot reads
 * exactly like a clean bill of health.
 *
 * So this file is deliberately the widest possible version — every `.ts` under
 * `src/`, every string-literal union member and every exported identifier, checked
 * against §3 parsed out of `SPEC.md`. It is slower and blunter than the typed
 * version and that is the point: scar #1 survived a full build and three critic
 * passes because every individual component was correct.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SPEC = readFileSync(new URL('../../../docs/design/SPEC.md', import.meta.url), 'utf8');
const SRC = new URL('../../src/', import.meta.url).pathname;
/** The tests are source too. See the NUL-byte guard at the foot of this file. */
const TEST = new URL('../', import.meta.url).pathname;

/** §3's Term column, parsed from the canon rather than copied out of it. */
function canonTerms(): ReadonlySet<string> {
  const section = SPEC.split('## 3. Vocabulary')[1]?.split('\n## 4.')[0];
  if (section === undefined) throw new Error('SPEC §3 not found — the guard cannot run');
  const terms = new Set<string>();
  for (const m of section.matchAll(/^\| \*\*(.+?)\*\* \|/gm)) {
    for (const part of (m[1] ?? '').split(/[·/]/)) {
      const t = part.trim();
      // §3 formats a few rows with markdown emphasis or backticks.
      const clean = t.replace(/[`*]/g, '').trim();
      if (/^[A-Z][A-Z_ ]*$/.test(clean)) terms.add(clean);
    }
  }
  return terms;
}

/**
 * Sanctioned uses, keyed by **`Union.member`**, not by the bare term.
 *
 * The first version of this map keyed on the term alone, and a mutation test
 * proved it worthless: reintroducing `HoldingState = 'STANDING'` — one of the very
 * collisions this file names in its header — passed all five tests, because
 * `STANDING` was globally allowlisted for the legitimate `Standing` type.
 *
 * That is the detector reproducing the bug it hunts. A canon term is never
 * sanctioned in the abstract; it is sanctioned in exactly one context, and any
 * other declaration reusing it is the second concept §3 forbids. So the key is
 * the pair, and every entry still states why.
 */
const SANCTIONED = new Map<string, string>([
  ['VentureKind.RAID', "§3's own Means column reads 'predation; a venture kind', sanctioning both"],
  ['VentureKind.LEVY', 'the LEVY venture kind is precisely how the LEVY obligation is discharged'],
  ['AccountKind.STORES', "§3 defines STORES as 'assets, inventory, balances'; a STORES account is exactly that"],
  ['AssertScope.TICK', 'the tick horizon and an assertion scoped to tick close are the same tick'],
  ['AssertScope.RECKONING', 'the Reckoning horizon; a Reckoning-scoped assertion names that same horizon'],
  ['Visibility.SEALED', "the visibility tier that holds seals — §3's SEAL row now says so explicitly"],
  // ★ 31's PARLEY. `ReachWhy` answers *why one principal is addressable*, and two of its three rungs
  // name the thing that makes it so: the CAMPAIGN you both stand in, the GRANT one of you holds over
  // the other. That is the canon concept **as the reason**, the same shape as `AssertScope.TICK` —
  // "the tick horizon and an assertion scoped to tick close are the same tick".
  //
  // Renaming them was the alternative and it is strictly worse. `VIA_CAMPAIGN` would be a second word
  // for one concept, which is HARD RULE 4's violation with the sign flipped: §3 forbids one word
  // wearing two concepts, and the remedy for that must not be two words wearing one. The third rung,
  // `REPLY`, needs no entry — it is not a canon term, and it is the rung that keeps a cold approach a
  // channel rather than a megaphone.
  ['ReachWhy.CAMPAIGN', 'the campaign you both stand in IS the reason you may address each other — the canon concept as a reason, not a second sense of the word'],
  ['ReachWhy.GRANT', 'a live grant between two principals is what makes them addressable; the reach rung names the same grant §3 defines and nothing else'],
  // ★ Added when `haul` went live and the word entered §3, and it is RAID's entry with a different
  // noun: carrying goods yourself and hiring a CARRIER to carry them are ONE concept bought two ways,
  // which is what `venture/kinds.ts` means by calling `CARRIER` + `ESCORT` "the vertical slice's exact
  // shape". The canon row says it in the same place RAID's does.
  //
  // Worth recording WHY it needed adding at all: `VentureKind.HAUL` has been in `core/types.ts` since
  // the venture layer shipped and the word was **never in §3**, so this guard had nothing to compare
  // it against — an uncanonised word is unpoliced by construction. Canonising it is what made the
  // collision visible, and it was visible within one test run.
  ['VentureKind.HAUL', "one concept bought two ways — you carry it, or you hire a CARRIER to; §3's row sanctions both, exactly as RAID's does"],
  // ★ Added with CAMPAIGNS (`RULES_VERSION` 22). Master's two, kept verbatim.
  ['PulseOutcome.BREACH', "§3 canonises BREACH as a PULSE the attacker won, and this union IS that concept — the row's 'never means' column forecloses a broken COMPACT (a default) and §9A's hull breach"],
  ['outcome_if_pulsed_now.BREACH', 'the same PulseOutcome value published to an agent before it commits hands; a second word for it would be scar #1 with territory at stake'],
  // ★ Added with the CLEARANCE (`RULES_VERSION` 23), beneath campaigns' because it landed after them.
  // §3 defines STORES as "assets, inventory, balances"; `AccountKind.STORES` is the account that
  // HOLDS them and `Compartment.STORES` is the SIGHT of that same thing — one concept, two facets,
  // and the compartment is named after the thing it reveals precisely so an agent reading
  // `clearance: ["STORES"]` knows exactly which figures it is being handed. Inventing a second word
  // for "your stores, but seen" would be the §3 error run backwards: two words for one concept,
  // teaching a distinction that does not exist.
  //
  // The two sets do not interact — `BREACH` is a pulse outcome and `STORES` is a compartment — and
  // that is exactly why BOTH had to survive the merge. An uncanonised word is unpoliced by
  // construction, so dropping either set would silently un-police it.
  ['Compartment.STORES', "§3's STORES is 'assets, inventory, balances'; this compartment is the SIGHT of exactly that, and AccountKind.STORES is the account that holds it — one concept, two facets"],
]);

/**
 * Members that legitimately appear in two unions, keyed `UnionA+UnionB.MEMBER` with
 * the sorted union names. Each needs a reason that argues the two readings are ONE
 * concept — not merely that both spellings look reasonable.
 */
const SHARED_MEMBERS = new Map<string, string>([
  ['CampaignSide+CampaignStanding.ATTACKER',
    'one side of one war, named once as the side and once as "which side the reader is on"; CampaignStanding is CampaignSide plus null plus the two ALLY_ prefixes'],
  ['CampaignSide+CampaignStanding+RaidSide.DEFENDER',
    'all three mean "the party being attacked" — one role in three horizons (a 24-tick standoff, a multi-Reckoning campaign, and a reader\'s own place in one), never three concepts'],
  ['CampaignState+PulseOutcome.STARVED',
    'a pulse that found no MATERIEL and a campaign that ran out of it are cause and consequence of one fact; naming the ending anything else would make the record say the war ended for a different reason than the pulse did'],
  ['DecisionSource+IntentState+VentureState.LIVE',
    'all three mean "currently active" — one adjective applied to three subjects, not three concepts'],
  ['HandState+LotState.IN_TRANSIT',
    'a hand in transit and a lot in transit are both "moving between systems"; INV-2 counts them as one term'],
  ['RoleLabel+VentureKind.ESCORT',
    'the escorting function, whether it is a role inside a HAUL or a venture of its own — §3 sanctions the identical shape for RAID'],
  ['CascadeStatus+VentureState.DEFERRED',
    'both are §15.3 deferral exactly: carried to the next Reckoning, NOT terminal, and never a default. Their agreement is what showed SealDisposition.DEFERRED was the odd one out'],
  ['SealDisposition+SealVerdict.HONOURED',
    'SealDisposition is SealVerdict plus UNMARKED, so it shares members by construction; PROP-D2 keeps the two-valued verdict the only thing agents ever see'],
  ['SealDisposition+SealVerdict.CONTRADICTED',
    'same superset relationship as HONOURED; splitting the spelling would make the wider type unreadable against the narrower'],
  ['AssertScope+Coverage+Redaction+Rollback.FULL',
    '"complete" in all four — an adjective, and renaming any of them would read as a distinction that does not exist'],
  ['BatchKind+SupplyDirection.ISSUE',
    'value entering the economy against a named faucet; INV-1 treats the batch kind and the direction as one fact'],
  ['BatchKind+SupplyDirection.RETIRE',
    'value leaving the economy against a named sink; the mirror of ISSUE and the same argument'],
  ['RaidSide+RoleLabel.RAIDER',
    'one who raids, whether it is a slot inside a RAID venture or the side a joiner takes in a standoff — the identical shape the ESCORT entry above sanctions, and §3 names RAID once for both'],
  ['AccountKind+Compartment.STORES',
    "the same pair SANCTIONED records one entry up, arriving through the other check: the account that HOLDS a principal's assets, inventory and balances, and the compartment that reveals them. §3's STORES row covers both, and a delegate cleared for STORES reads the STORES account — the words agree because the things do"],
  // ── ★ PHASE 3's RISK MARKET. Seven pairings, and every one is one concept about a new subject. ──
  //
  // A COVER is A7's promise and an INDEMNITY is what it owes, so their lifecycles borrow a venture's
  // vocabulary **on purpose**: `venture/settlement.ts`'s words for "the promise resolved", "the
  // promise broke" and "it carried to the next Reckoning" are the right words for a COVER too, and
  // inventing a second set would teach an agent a distinction that does not exist. That is the same
  // argument the `ChargeRule+LevyRule.EVEN` entry below makes.
  ['CoverState+VentureState.SETTLED',
    'a promise that resolved and is now history — one concept, applied to a venture and to a COVER. §3 gives ESCROWED/ELECTIVE to A7\'s two halves and a COVER is A7 over somebody else\'s loss, so its lifecycle borrowing the venture\'s spelling is the words agreeing because the things do'],
  ['IndemnityState+VentureState.DEFAULTED',
    'THE one concept this whole design is about: an elective half that went unpaid and is attributable. Spelling it differently for a COVER would split the record\'s central fact in two, and INV-17 treats both as accusations through one `DefaultRegister`'],
  ['CascadeStatus+IndemnityState+VentureState.DEFERRED',
    '§15.3\'s deferral exactly, now in three places: carried to the next Reckoning, NOT terminal, never a default. The two-way entry above already argued it; the third subject changes nothing, and a COVER deferring under a different name would be the one spelling that lets a truncated cascade read as a breach'],
  ['ChainLinkState+IndemnityState+RaidState.PAID',
    '"the obligation was met in full" — a raid demand answered, an INDEMNITY honoured, and the link a viewer sees for it. The frame state is the picture OF the record state, so a third word would put the caption and the row into disagreement, which is scar #1 rendered'],
  ['ClaimState+CoverState.LAPSED',
    'an obligation whose clock ran out with nothing owed either way: a CLAIM that stopped paying its CHARGE, and a COVER whose term ended with no FRONT having struck. Both are "expired, not broken", and that distinction from DEFAULTED is the one A5\' most depends on'],
  ['IndemnityState+OrderState.OPEN',
    '"live and unresolved" — a resting order and an INDEMNITY awaiting its settlement. An adjective about two subjects, the same shape as the `LIVE` and `FULL` entries above'],
  ['CoverState+FrontState.STRUCK',
    'the FRONT landed. A front that has STRUCK and a COVER that has been STRUCK are the same instant seen from the peril and from the promise: one event, and the COVER row exists precisely to say "this front reached me". Two words would let the record date the same moment twice'],
  ['ChainLinkState+HoldingState.INTACT',
    '"not destroyed" — a holding that has not fallen, and a chain link whose promise has not snapped. The `ChainLinkState` member was `STANDING` in its first draft and this guard refused it in one line, correctly: §3 gives STANDING to the public factual vectors. See `risk/lines.ts` for the note'],
  ['ChargeRule+LevyRule.EVEN',
    'ONE allocation rule — "every subject on the roll bears the same share" — offered on two ballots, the Levy\'s over principals and the Charge\'s over claims. Renaming either would be the mirror of the §3 error: two words for one concept, so an agent reading EVEN on one ballot and FLAT on the other would learn a distinction that does not exist. The two are also computed by the same weight of 1, in the same largest-remainder pass'],
]);

function srcFiles(dir = SRC): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...srcFiles(full));
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

interface Union {
  readonly file: string;
  readonly line: number;
  readonly name: string;
  readonly members: readonly string[];
}

/**
 * Every string-literal union in `src/`, however it is declared: a named `type`, an
 * inline field annotation, or a `Set`/array of literals used as an enum. The
 * `core/types.ts` guard reaches only the first kind, and `Protection.EXPOSED` was
 * the first kind in a file that guard does not read.
 */
function allUnions(): readonly Union[] {
  const found: Union[] = [];
  for (const file of srcFiles()) {
    const rel = file.slice(file.indexOf('/src/') + 1);
    const lines = readFileSync(file, 'utf8').split('\n');
    for (const [i, raw] of lines.entries()) {
      // Comments are prose, not a rules surface. But a *string literal* inside a
      // comment is still not a rules surface either, so strip both.
      const code = raw.replace(/\/\/.*$/, '');
      if (/^\s*\*/.test(code)) continue;
      const decl = code.match(/(?:type|readonly)?\s*(\w+)\s*[:=]\s*((?:'[A-Z][A-Z_]*'\s*\|\s*)+'[A-Z][A-Z_]*')/);
      if (decl === null) continue;
      const members = [...(decl[2] ?? '').matchAll(/'([A-Z][A-Z_]*)'/g)].map((m) => m[1] ?? '');
      found.push({ file: rel, line: i + 1, name: decl[1] ?? '?', members });
    }
  }
  return found;
}

describe('SPEC §3 is a rules surface — repo-wide', () => {
  it('the canon parsed out of SPEC §3 is non-trivial, so a silent parse failure cannot pass this suite', () => {
    // A guard that quietly finds zero canon terms would pass everything. This is
    // the guard's own guard.
    const canon = canonTerms();
    expect(canon.size).toBeGreaterThan(25);
    expect(canon).toContain('STANDING');
    expect(canon).toContain('EXPOSURE');
    expect(canon).toContain('MANDATE');
    expect(canon).toContain('HOLDING');
  });

  it('finds unions outside core/types.ts, or it is not actually wider than the typed guard', () => {
    // If this ever drops to only core/types.ts, the blind spot is back.
    const unions = allUnions();
    const dirs = new Set(unions.map((u) => u.file.split('/')[1]));
    expect(unions.length).toBeGreaterThan(8);
    expect(dirs.size).toBeGreaterThan(1);
  });

  it('no union member anywhere in src/ reuses a §3 canon term for a second concept', () => {
    const canon = canonTerms();
    const violations: string[] = [];
    for (const u of allUnions()) {
      for (const m of u.members) {
        if (!canon.has(m)) continue;
        // The pair, never the bare term — see the note on SANCTIONED.
        if (SANCTIONED.has(`${u.name}.${m}`)) continue;
        violations.push(`${u.file}:${u.line} ${u.name} = '${m}'`);
      }
    }
    // Three collisions shipped in wave 1 and every one of them would have been
    // caught here: HoldingState.STANDING, Protection.EXPOSED, and the MANDATE
    // reuse in vc.ts. All are fixed; this keeps them fixed.
    expect(violations).toEqual([]);
  });

  it('every sanctioned dual use carries a stated reason', () => {
    // The allowlist is the only way a collision can get in, so it is the thing
    // most worth guarding. An empty reason is not a reason.
    for (const [pair, reason] of [...SANCTIONED, ...SHARED_MEMBERS]) {
      expect(reason.length, `${pair} has no justification`).toBeGreaterThan(20);
      // A bare term as a key would silently re-open the hole the mutation test
      // found, so the shape itself is asserted.
      expect(pair, `${pair} must be keyed Union.MEMBER, not a bare term`).toContain('.');
    }
  });

  it('the guard actually bites — a sanctioned term in an unsanctioned context is caught', () => {
    // The mutation test that saved this file. Keyed on the bare term, this passed
    // while `HoldingState = 'STANDING'` was live in the tree. Simulated here rather
    // than by editing src, so it runs on every CI pass instead of once by hand.
    const canon = canonTerms();
    const mutant: Union = {
      file: 'src/world/holding.ts',
      line: 22,
      name: 'HoldingState',
      members: ['STANDING', 'FALLEN'],
    };
    const caught: string[] = [];
    for (const m of mutant.members) {
      if (!canon.has(m)) continue;
      if (SANCTIONED.has(`${mutant.name}.${m}`)) continue;
      caught.push(`${mutant.name}.${m}`);
    }
    expect(caught).toEqual(['HoldingState.STANDING']);
  });

  it('no member name appears in two different unions without a sanctioned reason', () => {
    // THE GAP THE §3 CHECK ABOVE CANNOT SEE, and it shipped a real defect.
    //
    // `SealDisposition.DEFERRED` and `VentureState.DEFERRED` meant OPPOSITE things: a
    // deferred venture is explicitly not terminal and returns next Reckoning (§15.3);
    // an unmarked seal is terminal and never re-judged (INV-20 — scar #7 was a promise
    // re-judged at every subsequent court). One word, two opposite lifecycles, one
    // engine. The check above could not see it because DEFER appears in §3 as prose,
    // not as a Term-column row, so neither member was a "canon term" at all.
    //
    // Scar #1 was not about canon terms. It was about the ENGINE and the AGENT-FACING
    // TEXT disagreeing over one word. This check is that shape generalised: any member
    // name living in two unions is a word doing two jobs until someone says otherwise.
    const byMember = new Map<string, Set<string>>();
    for (const u of allUnions()) {
      // Skip inline field annotations (`state: 'A' | 'B'`). The regex names those
      // after the FIELD, which is lowercase, and such a field is not a second union
      // — it is the same union written out. Counting them produced pairs like
      // "VentureState+state.FORMING", which is one union reported as two.
      if (!/^[A-Z]/.test(u.name)) continue;
      for (const m of u.members) {
        const homes = byMember.get(m) ?? new Set<string>();
        homes.add(u.name);
        byMember.set(m, homes);
      }
    }

    const shared: string[] = [];
    for (const [member, homes] of byMember) {
      if (homes.size < 2) continue;
      const key = `${[...homes].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).join('+')}.${member}`;
      if (SHARED_MEMBERS.has(key)) continue;
      shared.push(key);
    }
    expect(shared).toEqual([]);
  });

  it('no source file contains a NUL byte', () => {
    // Wave 1 shipped nine of them across two ledger files and one identity test.
    // `file(1)` reports such a file as `data` and grep skips it entirely, so every
    // grep-based guard above — and SEC-9's outbound secret scan — silently stops
    // covering it while tsc, eslint and vitest all stay green.
    //
    // ── `test/` IS WALKED TOO, AND IT WAS NOT ────────────────────────────────
    //
    // This guard was rooted at `src/` alone while its own comment named "one identity
    // test" as a source of the bug it exists to prevent. Wave 2 then shipped a literal
    // NUL in `test/api/scar11.test.ts` — the file whose seventy assertions are the
    // scar-#11 leak suite — and this test stayed green while `file(1)` reported that
    // file as `data` and `grep -rn … test/api/` skipped every line of it. A guard that
    // does not walk the tests cannot see the tests, and a test is a source file.
    const withNul = [...srcFiles(), ...srcFiles(TEST)].filter((f) => readFileSync(f).includes(0));
    expect(withNul).toEqual([]);
  });
});
