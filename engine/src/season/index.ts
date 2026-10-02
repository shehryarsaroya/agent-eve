/**
 * `src/season/` — the third horizon (SPEC §5) and the grand venture (SPEC §7.6), A10's boundary.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **WHAT WAS MISSING, IN ONE SENTENCE.** §7.6 names exactly two mechanisms that make defection
 * sometimes rational in a permanent-ledger world — the season horizon and the grand venture — and
 * the engine had neither: no season boundary, no finale, nothing that ever ended. A world with no
 * ending is a world where the last-week defection §7.6 depends on has no last week.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ## The files, and what each owns
 *
 *   - `params.ts` — every published number (`SEASON_RECKONINGS`, the grand venture's yield, stake and
 *     kind) and the two rules-surface statements `agent.md` carries verbatim.
 *   - `clock.ts` — the season clock: pure functions of the tick, the `raid_schedule` shape.
 *   - `grand.ts` — the grand venture's five rules: where, when, what it pays, what it costs to
 *     contest, and who carries it. Pure functions over facts the caller gathered.
 *   - `book.ts` — the verdict, the standing baseline, and the record of closed seasons.
 *   - `record.ts` — a season's titles (the Hall of Fame's rules over one season) and its grand result.
 *   - `view.ts` — `header.season` and the frame's season line, from one builder (A9).
 *   - `invariants.ts` — `SSN-1..5`, supplied through the tick loop's `assertions` hook.
 *
 * ## Three budgets this module spends nothing from
 *
 * **No verb.** The grand venture is `create {kind:"BUILD", grand:true}`; its roles are `fill_role`,
 * its signatures `sign`, its payout `elect` — words already in §12.2's forty. **No venture kind.** It
 * is a BUILD, the kind the kind table already called *"§7.6's grand venture shape"*, so §17's eight
 * stay eight. **No top-level `observe` key.** The season is a clock, and clocks live on `header` —
 * `raid_schedule` and `campaign_clock` are the precedent.
 */

export {
  GRAND_BASE_YIELD_MINOR,
  GRAND_KIND,
  GRAND_RESIDUAL_PERCENT,
  GRAND_ROLE_STAKE_MINOR,
  GRAND_VENTURE_STATEMENT,
  GRAND_VENTURE_SUMMARY,
  GRAND_YIELD_MULTIPLE,
  MAX_FRAME_SEASON_RECORDS,
  MAX_LISTED_GRAND_CANDIDATES,
  MAX_SEASON_RECORDS,
  SEASON_RECKONINGS,
  SEASON_SECTION_TITLE,
  SEASON_STATEMENT,
  SEASON_SUMMARY,
  TICKS_PER_SEASON,
  TYPICAL_VENTURE_PROCEEDS_MINOR,
} from './params.js';
export {
  finaleReckoningOf,
  finaleTickOf,
  inFinale,
  isSeasonBoundaryTick,
  reckoningInSeason,
  reckoningsLeft,
  seasonClockAt,
  seasonFirstTick,
  seasonOf,
  type SeasonClock,
} from './clock.js';
export {
  chooseGrandWinner,
  grandCreateRejection,
  grandFillRejection,
  grandMarkerFor,
  grandStageFor,
  grandWindowOf,
  hopsFromCommons,
  inGrandWindow,
  type GrandCreateFacts,
  type GrandFillFacts,
  type GrandTally,
  type GrandWindow,
} from './grand.js';
export {
  GRAND_OUTCOMES,
  isGrandOutcome,
  SeasonBook,
  SeasonBookError,
  seasonStateTable,
  type SeasonEndedClaim,
  type CrewLine,
  type ElectedByRow,
  type GrandOutcome,
  type GrandResult,
  type GrandVerdict,
  type SeasonRecord,
  type SeasonTitle,
  type StandingBaseline,
  type VerdictTally,
} from './book.js';
export { baselineFrom, finaleLine, grandResultFrom, seasonDeltaStandings, seasonTitlesFrom, type WinnerFacts } from './record.js';
export {
  grandBlockFor,
  grandCandidateLine,
  lastSeasonLine,
  seasonBlockFor,
  sealedFromTick,
  type GrandBlock,
  type GrandCandidateLine,
  type GrandSlotLine,
  type GrandVerdictLine,
  type LastSeasonLine,
  type SeasonBlock,
  type SeasonViewPort,
} from './view.js';
export { checkSeasonInvariants, type SeasonInvariantInputs } from './invariants.js';
