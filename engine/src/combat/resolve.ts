/**
 * The eight slices. **Pure arithmetic: this file moves nothing.**
 *
 * `predation/resolve.ts`'s discipline, one layer deeper: it computes a verdict and the caller does
 * the ledger work. Here it mutates the formations in the book it is handed — a battle *is* the
 * evolution of those rows — but it touches no account, destroys no lot, and routs no hand. Every
 * value movement is a {@link SliceOutcome} the phase entry point acts on.
 *
 * ── THE SLICE ORDER IS THE DESIGN, AND EVERY ONE OF THE EIGHT IS LOAD-BEARING ─
 *
 * `PASS-SHIPS-COMBAT-extended` §7 MUST-2 gives the order and says why coarse resolution fails:
 * *"a 1–5 minute agent tick is too coarse for locks, alpha, shield/armor repair timing, missiles,
 * reload, and tackle to resolve as one blended number."* So eight slices per tick, and what each one
 * exists to make possible:
 *
 * | # | slice | the counter it creates |
 * |---|---|---|
 * | 1 | `ARRIVE` | a reserve released by a stop condition joins mid-battle |
 * | 2 | `LOCK` | a DAMP removes a repair target before the repair lands |
 * | 3 | `TACKLE` | a POINT decides who leaves, before anyone shoots |
 * | 4 | `CONTROL` | the range race, and DRAIN emptying a capacitor |
 * | 5 | `SHIELD` | repair lands **before** fire, so alpha can outrun it |
 * | 6 | `FIRE` | volleys, with application — the reason a fit matters |
 * | 7 | `DESTROY` | whole hulls die; overkill is measured, not hidden |
 * | 8 | `RECOVER` | armour repair and regen land **after** fire, so they are the second chance |
 *
 * The two orderings that do the most work are (5) before (6) and (8) after it. Shield repair
 * arriving first is what makes *"alpha can beat a repair cycle"* true; armour repair arriving last
 * is what makes an armour fit a different tactical animal from a shield one. §5 MUST-7 names that
 * as *"the alpha breakpoint"* and it is the single most important number in fleet composition.
 *
 * ── NO DICE, AND THE BAND IS WHY ────────────────────────────────────────────
 *
 * §2 MUST-5: *"KEEP uncertainty; CUT all-or-nothing per-cycle dice where it erases agency."* The
 * only draw in this file is {@link volleyBand}, ±8% on an already-computed figure. A side with a
 * 30% application advantage cannot lose to it. Everything else — the range race, tackle, locks,
 * repair allocation, target selection — is deterministic, which is §9's *"higher wins
 * deterministically, no dice"* extended from a hand count to a fleet fight.
 */

import type { Rng } from '../core/rng.js';
import type { HandId, PrincipalId } from '../core/types.js';
import { compareIds } from '../ledger/order.js';
import type { RaidSide } from '../predation/book.js';
import type { EngagementRecord, FieldControl, Formation, FormationId, TraceEntry } from './book.js';
import { ECHELONS, type Echelon } from './book.js';
import type { HullId } from './fleet.js';
import { damageTypesOf, type RoleTag } from './catalogue.js';
import { rangeName, scaleBps, type FitProfile } from './fit.js';
import {
  CAP_SHUTDOWN_ORDER,
  COMMAND_BONUS_BPS,
  COMMAND_REACH,
  ECHELON_DEPTH,
  GAP_MAX,
  LAYER_RESIST,
  PIN_THRESHOLD,
  RANGE_CELLS,
  REPAIR_REACH,
  RESERVE_ECHELON,
  SLICES_PER_TICK,
  VOLLEY_BAND_BPS,
  WRECK_VALUE_PER_GOOD,
} from './params.js';

/** The eight slices, in order. Index is meaning: this array *is* §7 MUST-2's chain. */
export const SLICES = Object.freeze([
  'ARRIVE',
  'LOCK',
  'TACKLE',
  'CONTROL',
  'SHIELD',
  'FIRE',
  'DESTROY',
  'RECOVER',
] as const);

export type Slice = (typeof SLICES)[number];

/** A hull the caller must actually destroy: burn the goods, rout the hand, post the loss. */
export interface HullLoss {
  readonly formation: FormationId;
  readonly principal: PrincipalId;
  readonly hull: string;
  readonly hand: HandId;
  /** The asset. Taken from the index-aligned `hulls` array, never looked up from the hand. */
  readonly hullId: HullId;
  readonly killedBy: PrincipalId | null;
  readonly value: number;
}

/** What one tick of a battle produced, for the caller to make real. */
export interface SliceOutcome {
  readonly losses: readonly HullLoss[];
  /** Formations that left the field this tick, with the hands and hulls they took home. */
  readonly withdrawn: readonly {
    readonly formation: FormationId;
    readonly hands: readonly HandId[];
    readonly hulls: readonly HullId[];
  }[];
  readonly trace: readonly TraceEntry[];
  /** Damage dealt, by principal. The contribution record §7 MUST-9 wants on a loss report. */
  readonly damageBy: ReadonlyMap<PrincipalId, number>;
}

/** How the resolver reads a fit. One lookup, so a profile is computed once per engagement. */
export type ProfileLookup = (fit: string) => FitProfile | undefined;

/** Per-slice scratch state. Rebuilt each slice, because every effect is a *this slice* effect. */
interface Applied {
  tackle: Map<FormationId, number>;
  scram: Set<FormationId>;
  web: Map<FormationId, number>;
  paint: Map<FormationId, number>;
  damp: Map<FormationId, number>;
  locks: Map<FormationId, number>;
  commandCover: Set<FormationId>;
}

/**
 * Run one tick of an engagement: {@link SLICES_PER_TICK} slices, in order.
 *
 * `fireEnabled` is false during CONTACT (the lines have met and nobody has shot yet) and true
 * during CONTEST and BREAK. `pursuitOnly` is true during BREAK: nothing that is free may be shot,
 * only what tackle still holds, which is §7 MUST-5's *"pursuers can catch stragglers"* and the
 * reason a rear guard is a real sacrifice rather than a flavour word.
 */
export function runTick(args: {
  readonly record: EngagementRecord;
  readonly profileOf: ProfileLookup;
  readonly rng: Rng;
  readonly tick: number;
  readonly fireEnabled: boolean;
  readonly pursuitOnly: boolean;
}): SliceOutcome {
  const { record, profileOf, rng, tick } = args;
  const losses: HullLoss[] = [];
  const withdrawn: { formation: FormationId; hands: readonly HandId[]; hulls: readonly HullId[] }[] = [];
  const trace: TraceEntry[] = [];
  const damageBy = new Map<PrincipalId, number>();

  for (let slice = 0; slice < SLICES_PER_TICK; slice += 1) {
    const active = record.formations.filter((f) => !f.withdrawn && f.hands.length > 0);
    if (active.length === 0) break;

    const applied = applyEffects(record, active, profileOf);

    // ── 3. TACKLE — resolved before anything is shot, because leaving is a decision ──
    for (const formation of active) {
      formation.tackledBy = applied.tackle.get(formation.id) ?? 0;
      formation.scrammed = applied.scram.has(formation.id);
      formation.webbedBps = applied.web.get(formation.id) ?? 0;
      formation.paintedBps = applied.paint.get(formation.id) ?? 0;
    }

    for (const formation of active) {
      if (!wantsOut(formation)) continue;
      if (formation.tackledBy >= PIN_THRESHOLD) {
        trace.push(
          entry(tick, slice, 'PINNED', formation.id, null, formation.tackledBy, {
            note:
              `${short(formation.id)} tried to break off and is held by ${String(formation.tackledBy)} tackle ` +
              `(${String(PIN_THRESHOLD)} holds).`,
          }),
        );
        continue;
      }
      formation.withdrawn = true;
      withdrawn.push({ formation: formation.id, hands: [...formation.hands], hulls: [...formation.hulls] });
      trace.push(
        entry(tick, slice, 'WITHDREW', formation.id, null, formation.hands.length, {
          note: `${short(formation.id)} broke off with ${String(formation.hands.length)} hull(s) intact — nothing held it.`,
        }),
      );
    }

    const standing = record.formations.filter((f) => !f.withdrawn && f.hands.length > 0);
    if (standing.length === 0) break;

    // ── 4. CONTROL — the range race, then capacitor warfare ───────────────────
    if (slice === 0) {
      const before = record.gap;
      record.gap = contestGap(record, standing, profileOf);
      if (record.gap !== before) {
        trace.push(
          entry(tick, slice, 'RANGE', null, null, record.gap, {
            note:
              `the lines moved from ${rangeName(before)} to ${rangeName(record.gap)} — ` +
              `${record.gap < before ? 'the brawlers dragged it shut' : 'the kiters held it open'}.`,
          }),
        );
      }
    }

    for (const formation of standing) {
      const profile = profileOf(formation.fit);
      if (profile === undefined || profile.drain === 0) continue;
      const target = pickTarget(formation, standing, record, profileOf, profile.drainReach);
      if (target === null) continue;
      const targetProfile = profileOf(target.fit);
      const resist = targetProfile?.drainResistBps ?? 0;
      const drained = Math.min(
        target.cap,
        scaleBps(profile.drain * formation.hands.length, 10_000 - resist),
      );
      if (drained <= 0) continue;
      target.cap -= drained;
      if (target.cap <= 0 && !target.capOut) {
        trace.push(
          entry(tick, slice, 'CAP_BROKEN', formation.id, target.id, drained, {
            note:
              `${short(target.id)} is dry — undamaged and operationally dead. Its modules shed ` +
              `${CAP_SHUTDOWN_ORDER[0] ?? 'WEAPON'} first, TACKLE last.`,
          }),
        );
      }
    }

    // Capacitor accounting: pay this slice's load, shed modules in the published order if short.
    for (const formation of standing) {
      const profile = profileOf(formation.fit);
      if (profile === undefined) continue;
      const load = profile.capLoadPerSlice * formation.hands.length;
      const regen = profile.capRegenPerSlice * formation.hands.length;
      formation.cap = Math.min(formation.capFull, formation.cap + regen);
      if (formation.cap >= load) {
        formation.cap -= load;
        formation.capOut = false;
      } else {
        formation.cap = 0;
        formation.capOut = load > 0;
      }
    }

    // ── 5. SHIELD — repair lands BEFORE fire. The alpha breakpoint. ───────────
    for (const healer of standing) {
      const profile = profileOf(healer.fit);
      if (profile === undefined || profile.remoteRepair === 0) continue;
      if (healer.capOut) {
        trace.push(
          entry(tick, slice, 'REPAIR_DRY', healer.id, null, 0, {
            note: `${short(healer.id)}'s repairs stopped: no capacitor. Killing the cap is killing the logi.`,
          }),
        );
        continue;
      }
      const locks = applied.locks.get(healer.id) ?? 0;
      if (locks <= 0) {
        trace.push(
          entry(tick, slice, 'REPAIR_JAMMED', healer.id, null, 0, {
            note: `${short(healer.id)} could not hold a lock — damped off its own repair target.`,
          }),
        );
        continue;
      }
      const patient = neediestFriend(healer, standing);
      if (patient === null) continue;
      const bonus = applied.commandCover.has(healer.id) ? COMMAND_BONUS_BPS : 0;
      const amount = Math.min(
        patient.ehpFull - patient.ehp,
        scaleBps(profile.remoteRepair * healer.hands.length, 10_000 + bonus),
      );
      if (amount <= 0) continue;
      patient.ehp += amount;
      trace.push(
        entry(tick, slice, 'REPAIRED', healer.id, patient.id, amount, {
          note: `${short(healer.id)} put ${String(amount)} back into ${short(patient.id)}.`,
        }),
      );
    }

    for (const formation of standing) {
      const profile = profileOf(formation.fit);
      if (profile === undefined || profile.localRepair === 0 || formation.capOut) continue;
      const amount = Math.min(formation.ehpFull - formation.ehp, profile.localRepair * formation.hands.length);
      if (amount > 0) formation.ehp += amount;
    }

    // ── 6. FIRE ───────────────────────────────────────────────────────────────
    if (args.fireEnabled) {
      for (const shooter of standing) {
        const profile = profileOf(shooter.fit);
        if (profile === undefined || profile.alpha === 0) continue;
        if (shooter.echelon === RESERVE_ECHELON) continue;
        if (shooter.capOut && profile.capLoadPerSlice > 0) continue;
        const enemies = standing.filter(
          (f) => f.side !== shooter.side && f.echelon !== RESERVE_ECHELON && (!args.pursuitOnly || f.tackledBy >= PIN_THRESHOLD),
        );
        if (enemies.length === 0) continue;
        const target = pickPrimary(shooter, enemies, record, profileOf);
        if (target === null) continue;
        const targetProfile = profileOf(target.fit);
        if (targetProfile === undefined) continue;

        const shot = applyVolley({
          shooter,
          shooterProfile: profile,
          target,
          targetProfile,
          gap: record.gap,
          commanded: applied.commandCover.has(shooter.id),
          dampedBy: applied.damp.get(shooter.id) ?? 0,
          rng,
        });
        if (shot.damage <= 0) {
          trace.push(
            entry(tick, slice, 'MISSED', shooter.id, target.id, 0, {
              note:
                `${short(shooter.id)} put ${String(profile.alpha * shooter.hands.length)} paper damage at ` +
                `${rangeName(record.gap)} and landed none of it: ${shot.why}.`,
            }),
          );
          continue;
        }
        const overkill = Math.max(0, shot.damage - target.ehp);
        target.ehp -= shot.damage;
        damageBy.set(shooter.principal, (damageBy.get(shooter.principal) ?? 0) + shot.damage);
        trace.push(
          entry(tick, slice, 'VOLLEY', shooter.id, target.id, shot.damage, {
            note:
              `${short(shooter.id)} → ${short(target.id)}: paper ${String(shot.paper)}, applied ` +
              `${String(shot.damage)} (${shot.why})` +
              (overkill > 0 ? `, ${String(overkill)} overkill.` : '.'),
          }),
        );
      }
    }

    // ── 7. DESTROY — whole hulls, one hand each ───────────────────────────────
    for (const formation of standing) {
      const profile = profileOf(formation.fit);
      if (profile === undefined) continue;
      const perHull = Math.max(1, profile.ehp);
      while (formation.hands.length > 0 && formation.ehp <= (formation.hands.length - 1) * perHull) {
        // Pop both, together. The arrays are index-aligned and this is the only place they shrink,
        // so the pairing is maintained in one statement rather than by convention.
        const hand = formation.hands.pop();
        const hullId = formation.hulls.pop();
        if (hand === undefined || hullId === undefined) break;
        formation.hullsLost += 1;
        formation.ehpFull -= perHull;
        formation.capFull = Math.max(0, formation.capFull - profile.capacitor);
        formation.cap = Math.min(formation.cap, formation.capFull);
        const killer = lastAttacker(trace, formation.id);
        losses.push({
          formation: formation.id,
          principal: formation.principal,
          hull: formation.hull,
          hand,
          hullId,
          killedBy: killer,
          value: (profile.costFrame + profile.costFuel) * Number(WRECK_VALUE_PER_GOOD),
        });
        trace.push(
          entry(tick, slice, 'WRECK', killer === null ? null : formation.id, formation.id, 1, {
            note: `a ${formation.hull} of ${formation.principal} is a wreck at ${record.stage}.`,
          }),
        );
        if (formation.hands.length === 0) {
          formation.ehp = 0;
          break;
        }
        formation.ehp = Math.max(formation.ehp, 0);
      }
    }

    // ── 8. RECOVER — nothing to do that is not already in the cap/repair walks ─
  }

  return { losses, withdrawn, trace, damageBy };
}

/**
 * Who holds the field. Published at AFTERMATH.
 *
 * A side holds the field if it has a standing non-reserve formation and the other does not. Both
 * standing is `CONTESTED`, which is a real outcome and not a hedge: §7 MUST-8 requires that
 * *"a side can win one and lose another"*, and a battle both sides walked away from is exactly the
 * case a kill-count model cannot express.
 */
export function fieldControlOf(record: EngagementRecord): FieldControl {
  const standing = (side: RaidSide): boolean =>
    record.formations.some((f) => f.side === side && !f.withdrawn && f.hands.length > 0 && f.echelon !== RESERVE_ECHELON);
  const raider = standing('RAIDER');
  const defender = standing('DEFENDER');
  if (raider && !defender) return 'RAIDER';
  if (defender && !raider) return 'DEFENDER';
  return 'CONTESTED';
}

/**
 * The range race, as arithmetic.
 *
 * Each side's pull is Σ over its standing formations of `posture × effective mobility`, and the gap
 * moves one cell toward whichever side pulls harder. Ties do not move it — the lines hold.
 *
 * **Effective** mobility is where the whole tackle layer earns its place: a WEB takes 60% of it, a
 * SCRAM takes an MWD's contribution entirely. So a brawler fleet does not win the range race by
 * wanting it more; it wins by *removing the kiters' mobility*, which is a fitting decision made
 * before the battle and a targeting decision made during it.
 */
export function contestGap(
  record: EngagementRecord,
  standing: readonly Formation[],
  profileOf: ProfileLookup,
): number {
  let raider = 0;
  let defender = 0;
  for (const formation of standing) {
    if (formation.echelon === RESERVE_ECHELON) continue;
    const profile = profileOf(formation.fit);
    if (profile === undefined) continue;
    const pull = postureSign(formation.posture) * effectiveMobility(formation, profile) * formation.hands.length;
    if (formation.side === 'RAIDER') raider += pull;
    else defender += pull;
  }
  const net = raider + defender;
  if (net === 0) return record.gap;
  return Math.max(0, Math.min(GAP_MAX, record.gap + (net < 0 ? -1 : 1)));
}

/** CLOSE pulls the gap shut (negative), KITE pushes it open, HOLD spends nothing. */
export function postureSign(posture: Formation['posture']): number {
   
  switch (posture) {
    case 'CLOSE':
      return -1;
    case 'KITE':
      return 1;
    case 'HOLD':
      return 0;
  }
}

/** Mobility after webs and scrams. The number the range race and the tracking term both read. */
export function effectiveMobility(formation: Formation, profile: FitProfile): number {
  const base = formation.scrammed ? Math.max(0, profile.mobility - 5) : profile.mobility;
  return Math.max(0, scaleBps(base, 10_000 - Math.min(9_000, formation.webbedBps)));
}

/** The pairwise RANGE cell between two formations: the gap plus both echelons, clamped. */
export function rangeBetween(gap: number, a: Echelon, b: Echelon): number {
  const depth = (e: Echelon): number => ECHELON_DEPTH[e];
  return Math.max(0, Math.min(RANGE_CELLS.length - 1, gap + depth(a) + depth(b) - depth('MAIN') * 2));
}

/** One volley's worth of application, decomposed so the trace can explain it. */
export interface VolleyResult {
  readonly paper: number;
  readonly damage: number;
  /** Why it landed what it landed, ≤ 96 chars. The narration's raw material. */
  readonly why: string;
}

/**
 * Apply a volley. §4 MUST-2 and MUST-3, and §12 relationship #2 in one function.
 *
 * `paper × range × motion × signature × (1 − resist) × command × damp × band`, every factor an
 * integer bps. The decomposition is returned rather than the product alone because §4 MUST-3 asks
 * for exactly that: *"'Paper 18k / applied 5.2k' decomposes into range, motion, signature, EWAR,
 * and resists. Viewers can see which intervention fixed application."*
 */
export function applyVolley(args: {
  readonly shooter: Formation;
  readonly shooterProfile: FitProfile;
  readonly target: Formation;
  readonly targetProfile: FitProfile;
  readonly gap: number;
  readonly commanded: boolean;
  readonly dampedBy: number;
  readonly rng: Rng;
}): VolleyResult {
  const { shooter, shooterProfile, target, targetProfile } = args;
  const cell = rangeBetween(args.gap, shooter.echelon, target.echelon);
  const dampedCell = Math.max(0, Math.min(RANGE_CELLS.length - 1, cell + args.dampedBy));
  const targetMobility = effectiveMobility(target, targetProfile);
  const signature = scaleBps(targetProfile.signature, 10_000 + target.paintedBps);

  let paper = 0;
  let landed = 0;
  const reasons: string[] = [];

  for (const line of shooterProfile.weapons) {
    const linePaper = line.alpha * shooter.hands.length;
    paper += linePaper;
    const rangeBps = line.rangeFactorBps[dampedCell] ?? 0;
    if (rangeBps === 0) {
      reasons.push(`${line.family} dead at ${rangeName(dampedCell)}`);
      continue;
    }
    // Motion: turrets only. `tracking / (tracking + motion)` — §4 MUST-2's single ratio.
    const motionBps =
      line.tracking === null
        ? 10_000
        : Math.trunc((line.tracking * 10_000) / Math.max(1, line.tracking + targetMobility));
    // Signature: a target smaller than the weapon's explosion takes proportionally less.
    const signatureBps = Math.min(10_000, Math.trunc((signature * 10_000) / Math.max(1, line.explosion)));
    let afterResist = 0;
    for (const type of damageTypesOf()) {
      const portion = scaleBps(linePaper, line.damage[type]);
      if (portion === 0) continue;
      afterResist += scaleBps(portion, 10_000 - resistAt(target, targetProfile, type));
    }
    const applied = scaleBps(scaleBps(scaleBps(afterResist, rangeBps), motionBps), signatureBps);
    landed += applied;
    if (line.tracking !== null && motionBps < 5_000) {
      reasons.push(`${line.family} tracking ${String(Math.trunc(motionBps / 100))}% vs mobility ${String(targetMobility)}`);
    } else if (signatureBps < 5_000) {
      reasons.push(`${line.family} signature ${String(Math.trunc(signatureBps / 100))}%`);
    } else if (rangeBps < 10_000) {
      reasons.push(`${line.family} ${String(Math.trunc(rangeBps / 100))}% at ${rangeName(dampedCell)}`);
    }
  }

  if (args.commanded) landed = scaleBps(landed, 10_000 + COMMAND_BONUS_BPS);
  landed = scaleBps(landed, volleyBand(args.rng));

  const why = reasons.length === 0 ? `full application at ${rangeName(dampedCell)}` : reasons.slice(0, 2).join('; ');
  return { paper, damage: Math.max(0, landed), why: why.slice(0, 96) };
}

/**
 * Which layer is taking the hit, and therefore which resist applies.
 *
 * Shield first, then armour, then structure — §5 MUST-1's ladder. The resist an incoming type meets
 * depends on how deep the damage already is, which is what makes *"my shield is strong to EM and my
 * armour is weak to it"* a real fitting consequence rather than a flavour note.
 */
export function resistAt(formation: Formation, profile: FitProfile, type: string): number {
  const perHull = Math.max(1, profile.ehp);
  const hulls = Math.max(1, formation.hands.length);
  const intoTop = formation.ehp - (hulls - 1) * perHull;
  const shield = profile.shield;
  const armor = profile.armor;
  const layer = intoTop > shield + armor ? 'SHIELD' : intoTop > armor ? 'ARMOR' : 'STRUCTURE';
  const row = LAYER_RESIST[layer];
  const value = (row as unknown as Record<string, number>)[type];
  return value ?? 0;
}

/** The ±8% band. The only draw in this file. */
export function volleyBand(rng: Rng): number {
  return rng.range(VOLLEY_BAND_BPS.min, VOLLEY_BAND_BPS.max);
}

// ── Effect application ──────────────────────────────────────────────────────

/**
 * Compute every cross-formation effect for this slice, before anything acts on any of them.
 *
 * Simultaneity is the point, and it is A4 at the slice level: *"within-tick actions never react to
 * another within-tick action."* If tackle were applied formation-by-formation as the walk
 * proceeded, the first formation in id order would web the second before the second's own web
 * landed — an ordering advantage nobody chose and no agent could see.
 */
function applyEffects(
  record: EngagementRecord,
  active: readonly Formation[],
  profileOf: ProfileLookup,
): Applied {
  const out: Applied = {
    tackle: new Map(),
    scram: new Set(),
    web: new Map(),
    paint: new Map(),
    damp: new Map(),
    locks: new Map(),
    commandCover: new Set(),
  };

  for (const formation of active) {
    // A formation starts with one lock per hull and loses one per point of damp on it.
    out.locks.set(formation.id, formation.hands.length);
  }

  for (const source of active) {
    if (source.echelon === RESERVE_ECHELON) continue;
    const profile = profileOf(source.fit);
    if (profile === undefined) continue;
    // A dry formation still holds tackle: it is the last thing shed (CAP_SHUTDOWN_ORDER).
    const dry = source.capOut;

    const enemies = active.filter((f) => f.side !== source.side && f.echelon !== RESERVE_ECHELON);
    if (enemies.length > 0) {
      const reachable = (reach: number): readonly Formation[] =>
        enemies.filter((f) => rangeBetween(record.gap, source.echelon, f.echelon) <= reach);

      if (profile.tackle > 0) {
        const target = nearest(reachable(profile.tackleReach), record, source);
        if (target !== null) {
          out.tackle.set(target.id, (out.tackle.get(target.id) ?? 0) + profile.tackle * source.hands.length);
          if (profile.scrams) out.scram.add(target.id);
        }
      }
      if (!dry && profile.webBps > 0) {
        const target = nearest(reachable(profile.webReach), record, source);
        if (target !== null) out.web.set(target.id, Math.max(out.web.get(target.id) ?? 0, profile.webBps));
      }
      if (!dry && profile.paintBps > 0) {
        const target = pickTarget(source, active, record, profileOf, profile.paintReach);
        if (target !== null) out.paint.set(target.id, Math.max(out.paint.get(target.id) ?? 0, profile.paintBps));
      }
      if (!dry && profile.damp > 0) {
        const target = pickTarget(source, active, record, profileOf, profile.dampReach);
        if (target !== null) {
          out.damp.set(target.id, (out.damp.get(target.id) ?? 0) + profile.damp);
          out.locks.set(target.id, Math.max(0, (out.locks.get(target.id) ?? 0) - profile.damp));
        }
      }
    }

    if (!dry && profile.command > 0) {
      for (const friend of active) {
        if (friend.side !== source.side) continue;
        if (Math.abs(ECHELON_DEPTH[friend.echelon] - ECHELON_DEPTH[source.echelon]) > COMMAND_REACH) continue;
        out.commandCover.add(friend.id);
      }
    }
  }

  return out;
}

/**
 * Choose a primary by the formation's ordered predicates.
 *
 * §7 MUST-4's whole mechanic: the first predicate that matches a reachable enemy wins, and the
 * fallback is the enemy with the least EHP. **This is where a good fleet commander beats a bad
 * one** — `['REPAIR','COMMAND','TACKLE']` kills the force multipliers first, `['WEAKEST']` farms
 * kill count while the enemy's logi keeps everything alive.
 */
export function pickPrimary(
  shooter: Formation,
  enemies: readonly Formation[],
  record: EngagementRecord,
  profileOf: ProfileLookup,
): Formation | null {
  const reachable = enemies.filter((f) => canReach(shooter, f, record, profileOf));
  const pool = reachable.length > 0 ? reachable : [];
  if (pool.length === 0) return null;

  for (const predicate of shooter.primary) {
    if (predicate === 'WEAKEST' || predicate === 'NEAREST') break;
    const matches = pool.filter((f) => tagsOf(f, profileOf).includes(predicate));
    if (matches.length > 0) return weakest(matches);
  }
  if (shooter.primary.includes('NEAREST')) return nearest(pool, record, shooter);
  return weakest(pool);
}

/** Any hostile within a given reach, nearest first, deterministic tiebreak. */
function pickTarget(
  source: Formation,
  all: readonly Formation[],
  record: EngagementRecord,
  profileOf: ProfileLookup,
  reach: number,
): Formation | null {
  const enemies = all.filter(
    (f) =>
      f.side !== source.side &&
      !f.withdrawn &&
      f.hands.length > 0 &&
      f.echelon !== RESERVE_ECHELON &&
      rangeBetween(record.gap, source.echelon, f.echelon) <= reach,
  );
  if (enemies.length === 0) return null;
  for (const predicate of source.primary) {
    if (predicate === 'WEAKEST' || predicate === 'NEAREST') break;
    const matches = enemies.filter((f) => tagsOf(f, profileOf).includes(predicate));
    if (matches.length > 0) return weakest(matches);
  }
  return nearest(enemies, record, source);
}

function canReach(shooter: Formation, target: Formation, record: EngagementRecord, profileOf: ProfileLookup): boolean {
  const profile = profileOf(shooter.fit);
  if (profile === undefined) return false;
  const cell = rangeBetween(record.gap, shooter.echelon, target.echelon);
  return profile.weapons.some((line) => (line.rangeFactorBps[cell] ?? 0) > 0);
}

function nearest(pool: readonly Formation[], record: EngagementRecord, from: Formation): Formation | null {
  if (pool.length === 0) return null;
  return [...pool].sort(
    (a, b) =>
      rangeBetween(record.gap, from.echelon, a.echelon) - rangeBetween(record.gap, from.echelon, b.echelon) ||
      compareIds(a.id, b.id),
  )[0] ?? null;
}

function weakest(pool: readonly Formation[]): Formation {
  const sorted = [...pool].sort((a, b) => a.ehp - b.ehp || compareIds(a.id, b.id));
  const first = sorted[0];
  if (first === undefined) throw new Error('weakest called on an empty pool');
  return first;
}

/** The friendly formation with the lowest EHP fraction inside repair reach. */
function neediestFriend(healer: Formation, standing: readonly Formation[]): Formation | null {
  const candidates = standing.filter(
    (f) =>
      f.side === healer.side &&
      f.echelon !== RESERVE_ECHELON &&
      Math.abs(ECHELON_DEPTH[f.echelon] - ECHELON_DEPTH[healer.echelon]) <= REPAIR_REACH &&
      f.ehp < f.ehpFull,
  );
  if (candidates.length === 0) return null;
  return (
    [...candidates].sort(
      (a, b) =>
        Math.trunc((a.ehp * 10_000) / Math.max(1, a.ehpFull)) -
          Math.trunc((b.ehp * 10_000) / Math.max(1, b.ehpFull)) || compareIds(a.id, b.id),
    )[0] ?? null
  );
}

/** The role tags a formation actually earns from its fit. Never what it claims. */
export function tagsOf(formation: Formation, profileOf: ProfileLookup): readonly RoleTag[] {
  return profileOf(formation.fit)?.roleTags ?? [];
}

/** Has this formation's stop condition fired? A3's stop condition, evaluated every slice. */
export function wantsOut(formation: Formation): boolean {
  const when = formation.withdrawWhen;
  if (when.now) return true;
  if (when.hullsLost > 0 && formation.hullsLost >= when.hullsLost) return true;
  if (when.ehpBelowBps > 0 && formation.ehpFull > 0) {
    return Math.trunc((formation.ehp * 10_000) / formation.ehpFull) < when.ehpBelowBps;
  }
  return false;
}

/** The last principal recorded as shooting this formation. The kill attribution on a loss report. */
function lastAttacker(trace: readonly TraceEntry[], formation: FormationId): PrincipalId | null {
  for (let i = trace.length - 1; i >= 0; i -= 1) {
    const row = trace[i];
    if (row === undefined) continue;
    if (row.kind !== 'VOLLEY' || row.target !== formation || row.actor === null) continue;
    const owner = row.actor.split('/')[1];
    if (owner !== undefined) return owner as PrincipalId;
  }
  return null;
}

function entry(
  tick: number,
  slice: number,
  kind: string,
  actor: FormationId | null,
  target: FormationId | null,
  amount: number,
  extra: { readonly note: string },
): TraceEntry {
  return { tick, slice, kind, actor, target, amount, note: extra.note.slice(0, 140) };
}

/** A formation id is long; the trace needs it short and stable. */
function short(id: FormationId): string {
  const parts = id.split('/');
  return `${parts[1] ?? '?'}·${parts[3] ?? '?'}`;
}

/** Every echelon, so a caller can build a menu without importing the tuple. */
export function echelons(): readonly Echelon[] {
  return ECHELONS;
}
