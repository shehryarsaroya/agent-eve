/**
 * The season's lines for both frames: the FINALE countdown and the grand venture (THE SEASON LINE),
 * and each closed season's FINALE and champions (THE SEASON RECORD).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **A TRANSLATION, NEVER A SECOND DERIVATION.** The season line is `Runtime.seasonBlock(tick, null)`
 * — the exact block an agent's `header.season` is built by, with no viewer — re-spelled in the
 * frame's camelCase and given handles. Nothing here decides anything: which crew carries the yield,
 * what a stake is, and whether a share was paid are all answered upstream, once. A frame that computed
 * its own answer would be a viewer reading a fact no agent can (A9 inverted).
 * ══════════════════════════════════════════════════════════════════════════
 */

import type { Handle, PrincipalId, SystemId } from '../core/types.js';
import type { SeasonBlock, SeasonRecord } from '../season/index.js';
import type { GrandCandidateCard, SeasonLine, SeasonRecordLine } from './contract.js';
import { MAX_FRAME_GRAND_CANDIDATES, MAX_FRAME_SEASONS } from './contract.js';

function handleOf(handles: ReadonlyMap<PrincipalId, Handle>, p: PrincipalId): string {
  return String(handles.get(p) ?? p);
}

function maybeHandle(handles: ReadonlyMap<PrincipalId, Handle>, p: PrincipalId | null): string | null {
  return p === null ? null : handleOf(handles, p);
}

/** THE SEASON LINE, from the public season block. */
export function seasonLineFor(
  block: SeasonBlock,
  handles: ReadonlyMap<PrincipalId, Handle>,
  systemName: (id: SystemId) => string | null,
): SeasonLine {
  const g = block.grand;
  const candidates: GrandCandidateCard[] = g.candidates.slice(0, MAX_FRAME_GRAND_CANDIDATES).map((c) => ({
    venture: c.venture,
    creator: c.creator,
    creatorHandle: handleOf(handles, c.creator),
    formedBy: c.formed_by,
    formedByHandle: maybeHandle(handles, c.formed_by),
    state: c.state,
    rolesFilled: c.roles_filled,
    rolesTotal: c.roles_total,
    staked: c.staked,
    sealedFills: c.sealed_fills,
    slots: c.slots.map((s) => ({
      label: s.label,
      shareBps: s.share_bps,
      holder: s.holder,
      holderHandle: maybeHandle(handles, s.holder),
    })),
  }));
  return {
    season: block.season,
    reckoning: block.reckoning,
    of: block.of,
    reckoningsLeft: block.reckonings_left,
    finaleTick: block.finale_tick,
    inFinale: block.in_finale,
    grand: {
      stage: g.stage,
      stageName: g.stage === null ? null : systemName(g.stage),
      kind: g.kind,
      baseYield: g.base_yield,
      opensTick: g.opens_tick,
      closesTick: g.closes_tick,
      stakePerRole: g.stake_per_role,
      openNow: g.open_now,
      candidates,
      winner: g.verdict?.winner ?? null,
    },
  };
}

/** One closed season's line. The legend is the finale in one sentence a stranger reads. */
function recordLine(record: SeasonRecord, handles: ReadonlyMap<PrincipalId, Handle>): SeasonRecordLine {
  const g = record.grand;
  const who = g.creator === null ? null : handleOf(handles, g.creator);
  const by = g.formedBy === null ? '' : ` (formed by ${handleOf(handles, g.formedBy)})`;
  const unpaid = g.crew.filter((c) => c.paidMinor < c.dueMinor).length;
  const legend = (
    g.outcome === 'UNCLAIMED' || who === null
      ? `SEASON ${String(record.season)}: the grand venture went unclaimed.`
      : g.outcome === 'KEPT'
        ? `SEASON ${String(record.season)}: ${who}${by} carried ${String(g.proceedsMinor)} and paid every share.`
        : g.outcome === 'BROKEN'
          ? `SEASON ${String(record.season)}: ${who}${by} carried ${String(g.proceedsMinor)} and left ${String(unpaid)} share(s) unpaid.`
          : `SEASON ${String(record.season)}: ${who}${by} carried ${String(g.proceedsMinor)}; its shares settle late.`
  ).slice(0, 140);
  return {
    season: record.season,
    finaleTick: record.finaleTick,
    stage: record.stage,
    outcome: g.outcome,
    venture: g.venture,
    creator: g.creator,
    creatorHandle: who,
    formedBy: g.formedBy,
    formedByHandle: maybeHandle(handles, g.formedBy),
    proceeds: g.proceedsMinor,
    crew: g.crew.map((c) => ({
      label: c.label,
      principal: c.principal,
      handle: handleOf(handles, c.principal),
      due: c.dueMinor,
      paid: c.paidMinor,
      electedBy: c.electedBy,
      electedByHandle: maybeHandle(handles, c.electedBy),
    })),
    titles: record.titles.map((t) => ({
      title: t.title,
      principal: t.principal,
      handle: handleOf(handles, t.principal),
      value: t.value,
      clause: t.clause,
    })),
    closedClaims: record.closedClaims.length,
    legend,
  };
}

/** THE SEASON RECORD lines, newest first, bounded. `records` arrives newest first. */
export function seasonRecordLinesFor(
  records: readonly SeasonRecord[],
  handles: ReadonlyMap<PrincipalId, Handle>,
): readonly SeasonRecordLine[] {
  return records.slice(0, MAX_FRAME_SEASONS).map((r) => recordLine(r, handles));
}
