/**
 * `clearance-probe` — **can a COMPARTMENT actually bind in a real world?**
 *
 * The question this answers is the one the mechanism's own tests structurally cannot: a unit
 * test proves a cleared delegate *may* cut a DOSSIER, and says nothing about whether a world
 * nobody steers ever produces the state. *"A capability that exists and is never exercised is
 * indistinguishable from one that is missing"* — and the way that hides is a green suite.
 *
 * So this drives the ordinary heuristic cast and counts, per seed:
 *
 *   - `grants`      — grants issued at all
 *   - `cleared`     — grants whose CLEARANCE is non-empty (can a compartment bind?)
 *   - `fenced`      — grants whose fence is narrower than `DELEGABLE_VERBS` (does the fence bite?)
 *   - `offered`     — observations offering `message {dossier}` or `audit`
 *   - `cut`         — dossiers actually cut
 *   - `audits`      — principals that spent an action on `audit`
 *   - `digest`      — the widest compartment digest seen, so "the figures are real" is checkable
 *
 * **A zero in `cut` is the expected answer today and is a finding, not a failure**: `cast/heuristic.ts`
 * has no branch that selects either verb (it was another agent's lane the round the clearance
 * landed). What must NOT be zero is `cleared` and `offered` — those are the engine's half, and a
 * zero there means the mechanism is unreachable rather than merely unused.
 *
 * ```
 * npx tsx scripts/clearance-probe.ts --seeds g01,g02 --reckonings 3
 * ```
 */

import { buildObservation } from '../src/api/observe.js';
import { HeuristicCast } from '../src/cast/index.js';
import { setSpeed, TICKS_PER_RECKONING } from '../src/core/time.js';
import { compartmentDigest, COMPARTMENTS, DELEGABLE_VERBS, isCompartment } from '../src/grant/index.js';
import { Runtime } from '../src/sim/runtime.js';

interface Row {
  readonly seed: string;
  readonly halted: boolean;
  readonly grants: number;
  readonly cleared: number;
  readonly fenced: number;
  readonly dossierOffers: number;
  readonly auditOffers: number;
  readonly cut: number;
  readonly audits: number;
  readonly widestDigest: number;
  readonly observations: number;
}

function obj(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}
function rows(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.map(obj) : [];
}

function run(seed: string, ticks: number, members: number): Row {
  setSpeed('instant');
  const rt = new Runtime({ seed });
  const cast = new HeuristicCast(rt, { size: members });
  cast.seat(seed);

  let halted = false;
  let dossierOffers = 0;
  let auditOffers = 0;
  let observations = 0;
  let widestDigest = 0;

  for (let i = 0; i < ticks; i += 1) {
    for (const a of cast.decide(rt.engine.tick + 1, seed)) rt.engine.submit(a);
    if (rt.runTick().halted) {
      halted = true;
      break;
    }
    // Sampled, not every tick: the question is whether the state occurs, not how often.
    if (i % 25 !== 0) continue;
    for (const member of cast.roster) {
      const payload = buildObservation({
        runtime: rt,
        principal: member.principal,
        serverNowMs: 0,
        fresh: true,
        stale: false,
        wakesRemaining: 9,
        corrections: [],
        actionsRemaining: 4,
      }) as unknown as Record<string, unknown>;
      observations += 1;
      for (const a of rows(payload['affordances'])) {
        if (a['verb'] === 'audit') auditOffers += 1;
        if (a['verb'] === 'message' && 'dossier' in obj(a['params'])) dossierOffers += 1;
      }
    }
    // The digest, measured against the port rather than a served string — this is the
    // "are the figures real" half, and a constant would be worse than a missing field.
    for (const grant of rt.grants.all()) {
      for (const room of grant.clearance) {
        if (!isCompartment(room)) continue;
        const digest = compartmentDigest(rt.compartmentPort(), grant.grantor, room, rt.engine.tick);
        if (digest.length > widestDigest) widestDigest = digest.length;
      }
    }
  }

  const grants = rt.grants.all();
  let audits = 0;
  for (const [, tick] of rt.audits.entries()) if (tick >= 0) audits += 1;

  return {
    seed,
    halted,
    grants: grants.length,
    cleared: grants.filter((g) => g.clearance.length > 0).length,
    fenced: grants.filter((g) => g.verbs.length < DELEGABLE_VERBS.length).length,
    dossierOffers,
    auditOffers,
    cut: rt.dossiers.all().length,
    audits,
    widestDigest,
    observations,
  };
}

function parse(argv: readonly string[]): { seeds: readonly string[]; ticks: number; members: number } {
  let seeds = ['g01', 'g02', 'g03'];
  let reckonings = 3;
  let members = 8;
  for (let i = 0; i < argv.length; i += 2) {
    const value = argv[i + 1] ?? '';
    // An if-chain rather than a switch: `argv[i]` is `string | undefined`, and the
    // exhaustiveness lint correctly refuses a switch over it without an `undefined` case. A
    // `default` clause does not satisfy that rule and adding a `case undefined` to describe an
    // index that cannot be out of range in this loop is noise.
    if (argv[i] === '--seeds') seeds = value.split(',');
    else if (argv[i] === '--reckonings') reckonings = Number(value);
    else if (argv[i] === '--members') members = Number(value);
  }
  return { seeds, ticks: reckonings * TICKS_PER_RECKONING, members };
}

const args = parse(process.argv.slice(2));
console.log(
  `clearance probe — ${String(args.seeds.length)} seeds x ${String(args.ticks)} ticks x ` +
    `${String(args.members)} members · compartments ${COMPARTMENTS.join('/')}`,
);
console.log('seed    halt grants cleared fenced dOffer aOffer  cut audits digest obs');
const all: Row[] = [];
for (const seed of args.seeds) {
  const r = run(seed, args.ticks, args.members);
  all.push(r);
  console.log(
    [
      r.seed.padEnd(7),
      (r.halted ? 'YES' : 'no').padStart(4),
      String(r.grants).padStart(6),
      String(r.cleared).padStart(7),
      String(r.fenced).padStart(6),
      String(r.dossierOffers).padStart(6),
      String(r.auditOffers).padStart(6),
      String(r.cut).padStart(4),
      String(r.audits).padStart(6),
      String(r.widestDigest).padStart(6),
      String(r.observations).padStart(4),
    ].join(' '),
  );
}
const sum = (pick: (r: Row) => number): number => all.reduce((a, r) => a + pick(r), 0);
console.log(
  `TOTAL   ${all.some((r) => r.halted) ? ' YES' : '  no'} ${String(sum((r) => r.grants)).padStart(6)} ` +
    `${String(sum((r) => r.cleared)).padStart(7)} ${String(sum((r) => r.fenced)).padStart(6)} ` +
    `${String(sum((r) => r.dossierOffers)).padStart(6)} ${String(sum((r) => r.auditOffers)).padStart(6)} ` +
    `${String(sum((r) => r.cut)).padStart(4)} ${String(sum((r) => r.audits)).padStart(6)} ` +
    `${String(Math.max(...all.map((r) => r.widestDigest))).padStart(6)} ` +
    `${String(sum((r) => r.observations)).padStart(4)}`,
);
console.log(
  `\nRESULT ${JSON.stringify({
    cleared: sum((r) => r.cleared),
    fenced: sum((r) => r.fenced),
    dossierOffers: sum((r) => r.dossierOffers),
    auditOffers: sum((r) => r.auditOffers),
    cut: sum((r) => r.cut),
    audits: sum((r) => r.audits),
  })}`,
);
console.log(
  '\nREAD IT LIKE THIS: `cleared` and `dOffer`/`aOffer` are the ENGINE\'s half — a zero there means\n' +
    'the mechanism is unreachable and is a bug. `cut` and `audits` are the CAST\'s half — a zero there\n' +
    'means no heuristic branch selects the act, which is a known gap and not a defect in this layer.',
);
