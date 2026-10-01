/**
 * One principal's Reckoning, told as a short story — from the PUBLISHED FRAMES and nothing else.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **A9 IS STRUCTURAL HERE, NOT REVIEWED.** {@link buildRecap} takes two `ReckoningFrame`s —
 * the night that just settled and the one before it, read back off the files any spectator
 * can download (`frames/latest.json`, `frames/r-NNNNNN.json`) — and a handle. It is given no
 * runtime, no ledger, no observation and no store. So it cannot say anything a spectator could
 * not already read, for the same reason `frames/write.ts:frameIndexRow` cannot: the only
 * facts in reach have already crossed the projection boundary in `frames/projection.ts`.
 *
 * That also answers SPEC §15.7's warning about the Gazette — *"a strict subset of `observe`,
 * or the rational agent reads the Gazette as a cheaper observation"*. The frames are already
 * free and unsigned; a recap built from them is a subset of what any agent can fetch, and it
 * arrives after the frame it is built from.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * **A5′: this text accuses named agents, to third parties, by email.** So it states only what
 * the frames state. Counts of promises kept and broken are the difference between two
 * published STANDING rows (§3: the public factual vectors), and the difference is refused
 * outright when it is negative or the two frames are not consecutive nights — a re-seeded or
 * forked archive would otherwise print a nonsense figure about a real principal. Settlement
 * beats are quoted from the frame's own `deed` sentence rather than re-authored.
 *
 * **News, not a ledger.** A grant held for forty nights is not news on the forty-first, so
 * standing authority and titles are reported when they CHANGE between the two frames.
 *
 * **Agent-authored free text never reaches an email.** `publicLine`, the receipt reel and a
 * syndicate's chosen name are strings an agent wrote; mailing them would make this domain a
 * relay for whatever an agent wants a stranger to read — scar #12 by a longer route. Every
 * sentence here is a template over measured quantities and grammar-checked handles.
 *
 * Not the DISPATCH (SPEC §3: *"the letter an agent emails its owner after a Reckoning"*). An
 * agent writes a dispatch; this is the house's recap of the public record, to whoever asked.
 */

import { reckoningIndex } from '../../core/time.js';
import type {
  AuthorityLine,
  ClaimLine,
  DocketCard,
  RaidLine,
  ReckoningFrame,
  RundownSegment,
  StandingRow,
} from '../../frames/contract.js';

/** Sentences of news, at most. A recap a stranger reads in a minute, not a ledger. */
export const MAX_RECAP_EVENTS = 6;

/** Docket cards about tomorrow, at most. */
export const MAX_RECAP_AHEAD = 2;

/** Grant sentences, at most. */
const MAX_GRANT_LINES = 2;

/** What the night was, for the subject line and the accent colour. */
export type RecapTone = 'broke' | 'kept' | 'steady' | 'quiet' | 'new' | 'unknown';

export interface Recap {
  readonly handle: string;
  readonly reckoning: number;
  readonly tick: number;
  readonly tone: RecapTone;
  readonly subject: string;
  /** The title line, a few words. */
  readonly headline: string;
  readonly lead: string;
  /** The STANDING paragraph: the record as it now reads, and what moved. Empty with no record. */
  readonly record: string;
  /** What happened, one sentence (or two) each, most consequential first. */
  readonly events: readonly string[];
  /** What is riding on it next Reckoning. */
  readonly ahead: readonly string[];
}

export interface RecapInput {
  /** The Reckoning that just settled, as published. */
  readonly frame: ReckoningFrame;
  /** The Reckoning before it, as published, or null when there is none on disk. */
  readonly previous: ReckoningFrame | null;
  readonly handle: string;
}

/**
 * What tonight is compared against. `genesis` is the world before its first Reckoning, when
 * every vector was zero and nobody held anything — exact, not assumed, for Reckoning 0.
 */
type Baseline = { readonly kind: 'frame'; readonly frame: ReckoningFrame } | { readonly kind: 'genesis' };

interface Delta {
  readonly kept: number;
  readonly keptValue: number;
  readonly broke: number;
  readonly counterparties: number;
  readonly seals: number;
}

interface Ranked {
  readonly rank: number;
  readonly text: string;
}

interface Ctx {
  readonly frame: ReckoningFrame;
  readonly baseline: Baseline | null;
  readonly pid: string;
  readonly h: string;
  readonly name: (p: string | null | undefined) => string;
  readonly place: (s: string) => string;
}

export function buildRecap(input: RecapInput): Recap {
  const { frame, handle } = input;
  const R = frame.reckoningIndex;
  const standings = list(frame.standings);
  const row = standings.find((s) => s.handle === handle) ?? standings.find((s) => s.principal === `p:${handle}`);
  const pid = row?.principal ?? `p:${handle}`;
  const names = nameIndex(frame);
  const places = placeIndex(frame);
  const baseline = baselineFor(frame, input.previous);
  const ctx: Ctx = {
    frame,
    baseline,
    pid,
    h: handle,
    name: (p) => (p === null || p === undefined ? 'nobody' : (names.get(p) ?? stripId(p))),
    place: (s) => places.get(s) ?? s,
  };

  const before = baseline === null ? undefined : baselineRow(baseline, pid);
  const delta = baseline === null ? null : deltaOf(row, before ?? null);

  const events = [
    ...settlementBeats(ctx),
    ...raidLines(ctx),
    ...claimLines(ctx),
    ...grantLines(ctx),
    ...memoryLines(ctx),
    ...battleLines(ctx),
  ]
    .sort((a, b) => b.rank - a.rank)
    .slice(0, MAX_RECAP_EVENTS)
    .map((e) => e.text);

  const ahead = list(frame.nextDocket)
    .filter((card) => involvedInCard(card, pid))
    .slice(0, MAX_RECAP_AHEAD)
    .map((card) => `${card.headline} ${card.tension}`.trim());

  const tone: RecapTone =
    row === undefined
      ? 'new'
      : delta === null
        ? 'unknown'
        : delta.broke > 0
          ? 'broke'
          : delta.kept > 0
            ? 'kept'
            : events.length > 0
              ? 'steady'
              : 'quiet';

  return {
    handle,
    reckoning: R,
    tick: frame.tick,
    tone,
    subject: subjectFor(tone, handle, R, delta),
    headline: headlineFor(tone, handle, R, delta),
    lead: leadFor(tone, handle, R, delta),
    record: row === undefined ? '' : recordFor(handle, row, delta),
    events,
    ahead,
  };
}

// ── The comparison, refused when it cannot be honest ───────────────────────

/**
 * The previous frame, only if it really is the night before this one.
 *
 * A re-seeded world restarts its archive at Reckoning 0 while an old `r-000040.json` may still
 * sit on disk, and a forked record (CLAUDE.md §3) can leave two nights with one number. A
 * difference taken against the wrong night is a fabricated count about a real agent, so the
 * comparison is dropped rather than trusted.
 */
function baselineFor(frame: ReckoningFrame, previous: ReckoningFrame | null): Baseline | null {
  if (frame.reckoningIndex === 0) return { kind: 'genesis' };
  if (previous === null) return null;
  if (previous.reckoningIndex !== frame.reckoningIndex - 1) return null;
  if (!(previous.tick < frame.tick)) return null;
  return { kind: 'frame', frame: previous };
}

function baselineRow(baseline: Baseline, pid: string): StandingRow | undefined {
  return baseline.kind === 'genesis' ? undefined : list(baseline.frame.standings).find((s) => s.principal === pid);
}

function deltaOf(now: StandingRow | undefined, before: StandingRow | null): Delta | null {
  if (now === undefined) return null;
  // No row last night and one tonight: everything on it happened tonight.
  const base = before ?? {
    electiveHonoured: 0,
    electiveHonouredValue: 0,
    defaults: 0,
    distinctCounterparties: 0,
    contradictedSeals: 0,
  };
  const d: Delta = {
    kept: now.electiveHonoured - base.electiveHonoured,
    keptValue: now.electiveHonouredValue - base.electiveHonouredValue,
    broke: now.defaults - base.defaults,
    counterparties: now.distinctCounterparties - base.distinctCounterparties,
    seals: now.contradictedSeals - base.contradictedSeals,
  };
  // The vectors are cumulative and never fall. One that did means the two rows are not the
  // same history, and no figure derived from them may be printed.
  if (d.kept < 0 || d.keptValue < 0 || d.broke < 0 || d.counterparties < 0 || d.seals < 0) return null;
  return d;
}

// ── The lead, the subject, the record ──────────────────────────────────────

function subjectFor(tone: RecapTone, h: string, R: number, d: Delta | null): string {
  const n = `Reckoning ${String(R)}`;
  switch (tone) {
    case 'broke':
      return `${h} broke ${d !== null && d.broke > 1 ? `${fmt(d.broke)} promises` : 'a promise'} · ${n}`;
    case 'kept':
      return `${h} kept ${d !== null && d.kept > 1 ? `${fmt(d.kept)} promises` : 'a promise'} · ${n}`;
    case 'steady':
      return `${h}: what the record shows · ${n}`;
    case 'quiet':
      return `A quiet night for ${h} · ${n}`;
    case 'new':
      return `${h} has no record yet · ${n}`;
    case 'unknown':
      return `${h}, as ${n} settles`;
  }
}

function headlineFor(tone: RecapTone, h: string, R: number, d: Delta | null): string {
  switch (tone) {
    case 'broke':
      return d !== null && d.broke > 1 ? `${h} broke ${fmt(d.broke)} promises` : `${h} broke a promise`;
    case 'kept':
      return `${h} kept its word`;
    case 'quiet':
      return `A quiet night for ${h}`;
    case 'new':
      return `${h} has no record yet`;
    case 'steady':
    case 'unknown':
      return `${h}, Reckoning ${String(R)}`;
  }
}

function leadFor(tone: RecapTone, h: string, R: number, d: Delta | null): string {
  const n = `Reckoning ${String(R)}`;
  switch (tone) {
    case 'broke': {
      const broke = d?.broke ?? 1;
      const also = d !== null && d.kept > 0 ? ` It kept ${fmt(d.kept)} ${plural(d.kept, 'other', 'others')}.` : '';
      return (
        `${h} defaulted on ${broke === 1 ? 'an elective promise' : `${fmt(broke)} elective promises`} in ${n}. ` +
        `A default is permanent and public: it stays on ${h}'s record for good.${also}`
      );
    }
    case 'kept': {
      const kept = d?.kept ?? 1;
      const worth = d !== null && d.keptValue > 0 ? `, worth ${fmt(d.keptValue)}` : '';
      return `${h} kept its word in ${n}: it honoured ${fmt(kept)} elective ${plural(kept, 'promise', 'promises')}${worth}, and broke none.`;
    }
    case 'steady':
      return `None of ${h}'s own promises came due in ${n}, so its count of kept and broken did not move. The night still touched it:`;
    case 'quiet':
      return `A quiet night for ${h}: none of its own promises came due in ${n}, and nothing on the public record named it.`;
    case 'new':
      return `${n} has settled, and ${h} has no public record yet: no promise of its has come due, so there is nothing kept or broken to report.`;
    case 'unknown':
      return `${n} has settled. This is where ${h} stands on the public record.`;
  }
}

function recordFor(h: string, row: StandingRow, d: Delta | null): string {
  const defaults =
    row.defaults === 0
      ? 'no defaults'
      : `${fmt(row.defaults)} ${plural(row.defaults, 'default', 'defaults')}` +
        (row.lastDefaultTick === null ? '' : `, the last in Reckoning ${String(reckoningIndex(row.lastDefaultTick))}`);
  const seals =
    row.contradictedSeals === 0
      ? 'no contradicted seals'
      : `${fmt(row.contradictedSeals)} contradicted ${plural(row.contradictedSeals, 'seal', 'seals')}`;
  const base =
    `${h}'s public record: ${fmt(row.electiveHonoured)} elective ${plural(row.electiveHonoured, 'promise', 'promises')} ` +
    `kept, worth ${fmt(row.electiveHonouredValue)}, across ${fmt(row.distinctCounterparties)} ` +
    `${plural(row.distinctCounterparties, 'counterparty', 'counterparties')}; ${defaults}; ${seals}.`;
  if (d === null) return base;
  const moved: string[] = [];
  if (d.kept > 0) moved.push(`${fmt(d.kept)} more kept`);
  if (d.broke > 0) moved.push(`${fmt(d.broke)} new ${plural(d.broke, 'default', 'defaults')}`);
  if (d.counterparties > 0) moved.push(`${fmt(d.counterparties)} new ${plural(d.counterparties, 'counterparty', 'counterparties')}`);
  if (d.seals > 0) moved.push(`${fmt(d.seals)} newly contradicted ${plural(d.seals, 'seal', 'seals')}`);
  return moved.length === 0
    ? `${base} None of it moved this Reckoning.`
    : `${base} Since the last Reckoning: ${joinAnd(moved)}.`;
}

// ── The events, each from one published line set ──────────────────────────

/**
 * The night's settled ventures that name this principal.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **`cast` IS THE ROLE-HOLDERS, NOT EVERY PARTY** — measured, not assumed. A segment's chips
 * come from `venture.partiesOf`, which is "distinct principals holding a role", and the
 * creator who PAYS usually holds none. On the first world this was run against, `sable`'s own
 * default ("sable walked away from 382 of the 2K it had promised") carried
 * `cast: [varrow, vex]`, so a cast-only filter dropped the one beat sable's followers most
 * needed. The creator is therefore found two more ways: the compact link for the same venture
 * (`CompactLink.a` is the creator, by contract), and the frame's own deed template, which
 * always opens with the payer's handle and a possessive.
 * ══════════════════════════════════════════════════════════════════════════
 */
function settlementBeats(ctx: Ctx): readonly Ranked[] {
  const out: Ranked[] = [];
  const creatorOf = new Map<string, string>();
  for (const link of list(ctx.frame.compactLinks)) creatorOf.set(String(link.venture), link.a);
  for (const seg of list<RundownSegment>(ctx.frame.rundown)) {
    if (seg.kind !== 'SETTLEMENT') continue;
    const pays =
      (seg.venture !== null && creatorOf.get(String(seg.venture)) === ctx.pid) || seg.deed.startsWith(`${ctx.h}'s `);
    const involved =
      pays || list(seg.cast).some((c) => c.principal === ctx.pid) || seg.actedBy === ctx.pid || seg.onBehalfOf === ctx.pid;
    if (!involved) continue;
    const snapped = seg.glyph?.state === 'SNAPPED_BLACK';
    const delegated =
      seg.actedBy !== null && seg.actedBy !== undefined
        ? ` ${ctx.name(seg.actedBy)} did it in ${ctx.name(seg.onBehalfOf)}'s name, under a grant.`
        : '';
    // Its OWN promise first: the follower is here for this principal's word, not a partner's.
    out.push({ rank: (snapped ? 60 : 30) + (pays ? 5 : 0), text: `${sentence(seg.deed)}${delegated}` });
  }
  return out;
}

/**
 * The raids that touched this principal — the ones that are NEWS tonight.
 *
 * The frame's raid lines come off the raid book, not off tonight's resolutions, so a raid
 * paid off yesterday can still be on tonight's frame in the same state. Reporting it again
 * would tell a follower it was paid twice. A live standoff is always news; a resolved one is
 * news only if last night's frame did not already show it resolved the same way.
 */
function raidLines(ctx: Ctx): readonly Ranked[] {
  const { pid, h, name, place } = ctx;
  const out: Ranked[] = [];
  const paid: RaidLine[] = [];
  const before = new Map<string, RaidLine>();
  if (ctx.baseline?.kind === 'frame') for (const r of list<RaidLine>(ctx.baseline.frame.raidLines)) before.set(r.raid, r);
  for (const r of list<RaidLine>(ctx.frame.raidLines)) {
    if (r.state !== 'DEMANDED' && before.get(r.raid)?.state === r.state) continue;
    const at = place(r.stage);
    const take = r.lost > 0 ? r.lost : r.demand;
    const by = r.initiator !== null && r.initiator !== pid ? ` ${name(r.initiator)} opened it.` : '';
    if (r.target === pid) {
      switch (r.state) {
        case 'DEMANDED':
          out.push({
            rank: 40,
            text:
              `A raid at ${at} is demanding ${fmt(r.demand)} units from ${h}, and it resolves in ` +
              `${fmt(r.ticksLeft)} ${plural(r.ticksLeft, 'tick', 'ticks')}.${by}`,
          });
          break;
        case 'PAID':
          paid.push(r);
          break;
        case 'REPULSED':
          out.push({
            rank: 25,
            text: `${h} held ${at} against a raid: ${fmt(r.defenderForce)} stood against ${fmt(r.raiderForce)}.${by}`,
          });
          break;
        case 'PLUNDERED':
          out.push({ rank: 50, text: `A raid plundered ${fmt(r.lost)} units from ${h} at ${at}.${by}` });
          break;
        case 'MISSED':
          out.push({ rank: 15, text: `A raid came for ${h} at ${at} and found nothing to take.${by}` });
          break;
      }
      continue;
    }
    if (r.initiator === pid) {
      const outcome =
        r.state === 'DEMANDED'
          ? 'the standoff is still open'
          : r.state === 'PAID'
            ? `${name(r.target)} paid ${fmt(take)} units`
            : r.state === 'REPULSED'
              ? `${name(r.target)} held, and ${h} forfeited the stake it opened with`
              : r.state === 'PLUNDERED'
                ? `it took ${fmt(r.lost)} units`
                : 'it found nothing to take';
      out.push({ rank: 35, text: `${h} raided ${name(r.target)} at ${at}: ${outcome}.` });
      continue;
    }
    if (list(r.raiders).some((p) => p === pid)) {
      out.push({ rank: 20, text: `${h} rode with the raiders against ${name(r.target)} at ${at}.` });
    } else if (list(r.defenders).some((p) => p === pid)) {
      out.push({ rank: 20, text: `${h} stood with ${name(r.target)} against a raid at ${at}.` });
    }
  }
  // Several raids paid off read as one beat, not as a list of receipts.
  if (paid.length === 1) {
    const r = paid[0];
    if (r !== undefined) {
      out.push({
        rank: 25,
        text: `${h} paid ${fmt(r.lost > 0 ? r.lost : r.demand)} units to a raid at ${place(r.stage)}, and the raid left.`,
      });
    }
  } else if (paid.length > 1) {
    const total = paid.reduce((n, r) => n + (r.lost > 0 ? r.lost : r.demand), 0);
    const at = [...new Set(paid.map((r) => place(r.stage)))];
    out.push({
      rank: 26,
      text: `${h} paid off ${fmt(paid.length)} raids, ${fmt(total)} units in all, at ${joinAnd(at)}.`,
    });
  }
  return out;
}

/**
 * Claims: an ending (LAPSED, CEDED) is reported the night it happens, never again; a claim in
 * danger (arrears, contested) is reported every night it is in danger, because that is the
 * night-by-night tension a follower is watching.
 */
function claimLines(ctx: Ctx): readonly Ranked[] {
  const { pid, h, place } = ctx;
  const out: Ranked[] = [];
  let supplied = 0;
  const before = new Map<string, ClaimLine>();
  if (ctx.baseline?.kind === 'frame') for (const c of list<ClaimLine>(ctx.baseline.frame.claimLines)) before.set(c.claim, c);
  for (const c of list<ClaimLine>(ctx.frame.claimLines)) {
    if (c.claimant !== pid) continue;
    const ended = c.state === 'LAPSED' || c.state === 'CEDED' || c.state === 'CLOSED';
    if (ended && before.get(c.claim)?.state === c.state) continue;
    const at = place(c.system);
    switch (c.state) {
      case 'LAPSED':
        out.push({
          rank: 55,
          text:
            `${h}'s claim on ${at} lapsed: it missed the Charge ${fmt(c.arrears)} ${plural(c.arrears, 'time', 'times')}, ` +
            `and ${fmt(c.slashed)} of its bond was slashed.`,
        });
        break;
      case 'STRAINED':
        out.push({
          rank: 22,
          text:
            `${h}'s claim on ${at} is in arrears, ${fmt(c.arrears)} of ${fmt(c.arrearsOf)}: ${fmt(c.owed)} still owed, ` +
            `with ${fmt(c.bondAtRisk)} of bond at risk.`,
        });
        break;
      case 'CONTESTED':
        out.push({
          rank: 28,
          text: `${h}'s claim on ${at} is contested${c.contestable ? ', and the window to take it is open now' : ''}.`,
        });
        break;
      case 'CEDED':
        out.push({ rank: 18, text: `${h} ceded its claim on ${at}.` });
        break;
      case 'CLOSED':
        out.push({ rank: 18, text: `The season closed ${h}'s claim on ${at}; its bond was untouched.` });
        break;
      case 'SUPPLIED':
        supplied += 1;
        break;
    }
  }
  if (supplied > 0) {
    out.push({
      rank: 5,
      text: `${h} holds ${fmt(supplied)} ${plural(supplied, 'claim', 'claims')} with the Charge paid.`,
    });
  }
  return out;
}

/**
 * Standing authority, reported as CHANGE: a grant given tonight, drawn on tonight, or ended
 * tonight. Against no usable baseline it is reported as it stands, briefly.
 */
function grantLines(ctx: Ctx): readonly Ranked[] {
  const { pid, h, name } = ctx;
  const mine = list<AuthorityLine>(ctx.frame.authorityLines).filter((a) => a.delegate === pid || a.grantor === pid);
  const before = new Map<string, AuthorityLine>();
  if (ctx.baseline?.kind === 'frame') {
    for (const a of list<AuthorityLine>(ctx.baseline.frame.authorityLines)) before.set(String(a.grant), a);
  }
  const out: Ranked[] = [];
  for (const a of mine) {
    const iAmDelegate = a.delegate === pid;
    const other = name(iAmDelegate ? a.grantor : a.delegate);
    const limits = `up to ${fmt(a.granted)} of direct loss and ${fmt(a.grantedContingent)} of contingent liability`;
    const prior = before.get(String(a.grant));
    if (ctx.baseline === null) {
      out.push({
        rank: 10,
        text: iAmDelegate
          ? `${other} has given ${h} authority to act in its name, ${limits}; ${fmt(a.spent)} drawn so far.`
          : `${h} has given ${other} authority to act in its name, ${limits}; ${fmt(a.spent)} drawn so far.`,
      });
      continue;
    }
    if (prior === undefined) {
      // NOT "gave … tonight". `authorityLines` is capped and ranked, so a grant missing from
      // last night's frame may be weeks old and merely newly prominent; the sentence claims
      // only what both frames prove — that it stands now.
      if (a.state === 'EXPIRED') continue; // on the frame only because something else names it
      out.push({
        rank: 23,
        text: iAmDelegate
          ? `${other} has given ${h} authority to act in its name, ${limits}; ${fmt(a.spent)} drawn so far.`
          : `${h} has given ${other} authority to act in its name, ${limits}; ${fmt(a.spent)} drawn so far.`,
      });
      continue;
    }
    const parts: string[] = [];
    const drew = a.spent - prior.spent + (a.spentContingent - prior.spentContingent);
    if (drew > 0) {
      parts.push(
        iAmDelegate
          ? `${h} drew ${fmt(drew)} more on ${other}'s grant`
          : `${other} drew ${fmt(drew)} more on ${h}'s grant`,
      );
    }
    const bound = a.boundVentures - prior.boundVentures;
    if (bound > 0) {
      parts.push(
        iAmDelegate
          ? `${h} bound ${other} to ${fmt(bound)} more ${plural(bound, 'venture', 'ventures')} ${other} never signed`
          : `${other} bound ${h} to ${fmt(bound)} more ${plural(bound, 'venture', 'ventures')} in its name`,
      );
    }
    if (a.state !== prior.state) {
      const subject = iAmDelegate ? `${other}'s grant to ${h}` : `${h}'s grant to ${other}`;
      if (a.state === 'REVOKED') parts.push(`${subject} was revoked`);
      else if (a.state === 'EXPIRED') parts.push(`${subject} ran out`);
      else if (a.state === 'EXHAUSTED') parts.push(`${subject} is used up`);
    }
    // Never capitalised: every part opens with a handle, and `Vale` is not `vale`'s name.
    if (parts.length > 0) out.push({ rank: bound > 0 ? 36 : 24, text: `${joinAnd(parts)}.` });
  }
  return out.sort((x, y) => y.rank - x.rank).slice(0, MAX_GRANT_LINES);
}

function memoryLines(ctx: Ctx): readonly Ranked[] {
  const { frame, pid, h, place } = ctx;
  const out: Ranked[] = [];
  for (const ruin of list(frame.ruins)) {
    if (ruin.fellAtReckoning !== frame.reckoningIndex) continue;
    if (ruin.holder === pid) {
      out.push({
        rank: 45,
        text: `${h}'s works at ${place(ruin.system)} fell${ruin.razedByHandle === null ? ' to a world raid' : ` to ${ruin.razedByHandle}`}.`,
      });
    } else if (ruin.razedBy === pid) {
      out.push({ rank: 38, text: `${h} razed ${ruin.handle}'s works at ${place(ruin.system)}.` });
    }
  }
  // Titles and names are news only when NEW tonight, which needs the night before.
  if (ctx.baseline?.kind === 'frame') {
    const prior = ctx.baseline.frame;
    const held = new Set(list(prior.hallOfFame).map((t) => `${t.title}|${String(t.principal)}`));
    for (const title of list(frame.hallOfFame)) {
      if (title.principal !== pid || held.has(`${title.title}|${String(title.principal)}`)) continue;
      out.push({ rank: 16, text: `${h} now holds the title ${titleCase(title.title)}: ${title.clause}.` });
    }
    for (const p of list(frame.places)) {
      if (p.namedFor !== pid || p.sinceTick <= prior.tick) continue;
      out.push({ rank: 14, text: `${place(p.system)} now carries ${h}'s name: it raised the first works there.` });
    }
  }
  return out;
}

/** Engagements: a new one, or hulls lost since last night in one already running. */
function battleLines(ctx: Ctx): readonly Ranked[] {
  const lostBefore = new Map<string, number>();
  if (ctx.baseline?.kind === 'frame') {
    for (const b of list(ctx.baseline.frame.battleLines)) {
      const mine = list(b.formations).filter((f) => f.principal === ctx.pid);
      if (mine.length > 0) lostBefore.set(b.engagement, mine.reduce((n, f) => n + f.hullsLost, 0));
    }
  }
  const out: Ranked[] = [];
  for (const b of list(ctx.frame.battleLines)) {
    const mine = list(b.formations).filter((f) => f.principal === ctx.pid);
    if (mine.length === 0) continue;
    const at = ctx.place(b.stage);
    const lost = mine.reduce((n, f) => n + f.hullsLost, 0);
    const prior = lostBefore.get(b.engagement);
    if (prior === undefined) {
      out.push({
        rank: lost > 0 ? 42 : 21,
        text: `${ctx.h} fought in the engagement at ${at}${lost > 0 ? `, losing ${fmt(lost)} ${plural(lost, 'hull', 'hulls')}` : ''}.`,
      });
    } else if (lost > prior) {
      const more = lost - prior;
      out.push({ rank: 41, text: `${ctx.h} lost ${fmt(more)} more ${plural(more, 'hull', 'hulls')} in the engagement at ${at}.` });
    }
  }
  return out;
}

function involvedInCard(card: DocketCard, pid: string): boolean {
  return list(card.cast).some((c) => c.principal === pid);
}

// ── Small, pure helpers ─────────────────────────────────────────────────────

/** principal → handle, from every published place the frame names one. */
function nameIndex(frame: ReckoningFrame): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const s of list(frame.standings)) out.set(s.principal, s.handle);
  for (const seg of list(frame.rundown)) for (const c of list(seg.cast)) if (!out.has(c.principal)) out.set(c.principal, c.handle);
  for (const card of list(frame.nextDocket)) for (const c of list(card.cast)) if (!out.has(c.principal)) out.set(c.principal, c.handle);
  return out;
}

function placeIndex(frame: ReckoningFrame): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const sys of list(frame.map)) out.set(sys.id, sys.name);
  return out;
}

function stripId(id: string): string {
  return id.startsWith('p:') ? id.slice(2) : id;
}

/**
 * A frame field, defensively. The recap reads a file back off disk, and a frame written by an
 * older build may lack a field a newer contract added; a missing list is an empty one, never
 * a crash in the middle of a send run.
 */
function list<T>(value: readonly T[] | null | undefined): readonly T[] {
  // `Array.isArray` narrows a readonly array to `any[]`; the cast puts the element type back.
  return Array.isArray(value) ? (value as readonly T[]) : [];
}

/**
 * Integers with thousands separators, by hand: `toLocaleString` is banned in the engine
 * (DET-4), and an email is the one place a reader most needs `12,500` rather than `12500`.
 */
export function fmt(n: number): string {
  const v = Math.round(Number.isFinite(n) ? n : 0);
  const digits = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return v < 0 ? `-${digits}` : digits;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

function joinAnd(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1] ?? ''}`;
}

function sentence(text: string): string {
  const t = text.trim();
  if (t.length === 0) return t;
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

function titleCase(title: string): string {
  const lower = title.toLowerCase();
  return `“${lower.charAt(0).toUpperCase()}${lower.slice(1)}”`;
}
