/**
 * CHECKPOINT ADOPTION — the adversarial audit. Written by the verifier, not the
 * builder, and it exists because three claims in the builder's report were true of the
 * code and unproven by the tests.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * **1. THE ESCROW CLAIM WAS VACUOUS AS TESTED.**
 *
 * `checkpoint-adoption.test.ts` argues that because the adopted world's BALANCES match
 * the genesis-replayed world's, escrow survives an adoption. It does not follow, and
 * measured on that very run it proves nothing: the heuristic cast opens **zero**
 * encumbrances that are still open at a tick boundary (0 across 420 ticks and 60
 * snapshots), so every snapshot it adopts has an empty lock book and an empty book
 * restores correctly whether or not the capture works.
 *
 * A5′ is the reason this matters — a world whose escrowed stake is silently spendable
 * is *wrong*, not stale. So this file forces the case: raid-shaped stakes (the same
 * `encumbrances.lock` call `src/sim/runtime.ts` makes), a live obligation behind them,
 * a journalled snapshot taken while they are open, and then an adoption that has to
 * bring them back — with a spend attempt against the restored book.
 *
 * It also pins the thing that makes the manifest's `obligation` entry load-bearing
 * rather than cautious: with the locks correctly restored and the obligation book
 * empty, the first tick after an adopted boot **halts on INV-4**. That is the concrete
 * cost of adopting today, and it is a halt, not a wrong number — which is the right
 * failure mode and worth pinning so it cannot silently become the other one.
 *
 * **2. THE FK REPLACEMENT WAS UNTESTED.** `schema.sql` drops
 * `posting_account_id_fkey`, and the stated reason it is safe is that the hydrate
 * refuses any posting whose account is absent from the snapshot's own captured
 * account set — "strictly stronger than the FK". That check had no test: deleting it
 * left the whole suite green. It has one now.
 *
 * **3. THE SELF-CHECKING DENORMALISATION WAS UNTESTED.** `batch_kind` and
 * `supply_account_id` are the batch's fields repeated on every row, and the argument
 * that this stays a copy rather than a second home is that the reader refuses a group
 * whose rows disagree. Deleting that refusal also left the suite green.
 *
 * **4. A RULES CHANGE MUST FORCE THE SLOW PATH.** An adopted boot re-derives nothing,
 * and the tail after the latest Reckoning holds no snapshot to check against
 * (measured: `tripwiresChecked === 0` on a 900-tick journal), so a build whose
 * arithmetic moved would resume with no tripwire and no divergence record — the exact
 * thing `rules-change.test.ts` exists to make impossible. `planCheckpoint` now refuses
 * on a rules change; this pins it.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { HeuristicCast } from '../../src/cast/index.js';
import type { AccountId, EventId, PrincipalId } from '../../src/core/types.js';
import { minor } from '../../src/core/units.js';
import { storesAccount } from '../../src/ledger/accounts.js';
import { checkInv7 } from '../../src/ledger/index.js';
import {
  HydrateError,
  InMemoryJournalStore,
  Journal,
  bootFromStore,
  hydrateLedgerForSnapshot,
  planCheckpoint,
  type PersistedPosting,
  type SnapshotRecord,
} from '../../src/persist/index.js';
import { Runtime, freeStores } from '../../src/sim/runtime.js';

const SEED = 'checkpoint-audit-1';
const CAST_SIZE = 6;
/** 300 committed ticks; tick 300 is a multiple of the snapshot cadence below. */
const TICKS = 301;
const SNAPSHOT_EVERY = 10;
const LOCK_AT = 295;

function registeredTables(runtime: Runtime): readonly string[] {
  return runtime.engine.stateTables.filter((t) => t.restore !== undefined).map((t) => t.name);
}

function seated(seed: string): Runtime {
  const runtime = new Runtime({ seed });
  new HeuristicCast(runtime, { size: CAST_SIZE }).seat(seed);
  return runtime;
}

function lockRows(runtime: Runtime): readonly {
  id: string;
  account: string;
  amountMinor: number;
  principal: string;
}[] {
  return runtime.ledger.encumbrances.open().map((r) => ({
    id: r.id,
    account: r.account,
    amountMinor: r.amountMinor,
    principal: r.principal,
  }));
}

/** Every account whose free balance is BELOW its balance — i.e. every locked one. */
function encumberedAccounts(runtime: Runtime): readonly (readonly [string, number, number])[] {
  return runtime.ledger
    .allAccounts()
    .map((a) => [a.id, a.balanceMinor, runtime.ledger.freeBalance(a.id)] as const)
    .filter(([, bal, free]) => bal !== free);
}

interface LockedRun {
  readonly store: InMemoryJournalStore;
  readonly liveHash: string;
  readonly liveRows: string;
  readonly liveEncumbered: string;
  readonly liveExposure: readonly (readonly [string, number])[];
  readonly lockedPrincipals: readonly PrincipalId[];
}

/** One sim that really is holding open escrow at its last journalled snapshot. */
let cachedLocked: Promise<LockedRun> | null = null;
function lockedRun(): Promise<LockedRun> {
  cachedLocked ??= (async (): Promise<LockedRun> => {
    const runtime = new Runtime({ seed: SEED });
    const cast = new HeuristicCast(runtime, { size: CAST_SIZE });
    cast.seat(SEED);
    const store = new InMemoryJournalStore();
    const journal = new Journal(store, { snapshotEveryTicks: SNAPSHOT_EVERY });
    await bootFromStore(runtime, store, { seed: SEED });

    let lockedPrincipals: readonly PrincipalId[] = [];
    for (let i = 0; i < TICKS; i += 1) {
      const target = runtime.engine.tick + 1;
      if (target === LOCK_AT) {
        // Two raid-shaped stakes. `obligations.open` first, or INV-4 reads the lock as
        // an orphan and halts the tick that opened it — which is itself the proof that
        // the obligation book is load-bearing for a lock to exist at all.
        lockedPrincipals = [...runtime.world.principalOrder]
          .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
          .slice(0, 2);
        for (const p of lockedPrincipals) {
          const amount = minor(Math.floor(freeStores(runtime.ledger, p) / 4));
          runtime.obligations.open(`raid:audit:${p}` as never, true);
          runtime.ledger.encumbrances.lock({
            eventId: `audit:stake:${p}`,
            tick: target,
            principal: p,
            account: storesAccount(p),
            amountMinor: amount,
            obligationRef: `raid:audit:${p}` as never,
            maxDirectLoss: amount,
          });
        }
      }
      for (const action of cast.decide(target, SEED)) runtime.engine.submit(action);
      const report = runtime.runTick();
      if (report.halted) throw new Error(`live sim halted at tick ${String(report.tick)}`);
      journal.record(runtime, report);
      await journal.flushPending();
    }
    await journal.drain();

    return {
      store,
      liveHash: runtime.engine.stateHash,
      liveRows: JSON.stringify(lockRows(runtime)),
      liveEncumbered: JSON.stringify(encumberedAccounts(runtime)),
      liveExposure: lockedPrincipals.map(
        (p) => [p, runtime.ledger.encumbrances.cachedExposure(p)] as const,
      ),
      lockedPrincipals,
    };
  })();
  return cachedLocked;
}

describe('A5′: escrow across a checkpoint adoption, with locks that are actually open', () => {
  it('the adoption point HAS open locks — otherwise everything below is vacuous', async () => {
    const live = await lockedRun();
    const snapshot = await live.store.latestSnapshot();
    expect(snapshot?.tick).toBe(TICKS - 1);
    // The control the builder's equivalence test does not have. Two locks, non-zero,
    // still open at the tick the snapshot was taken over.
    const rows = JSON.parse(live.liveRows) as readonly { amountMinor: number }[];
    expect(rows.length).toBe(2);
    for (const r of rows) expect(r.amountMinor).toBeGreaterThan(0);
  }, 120_000);

  it('brings every lock back, keeps freeBalance below balance, and REFUSES a spend of the locked stake', async () => {
    const live = await lockedRun();
    const adopted = seated(SEED);
    const result = await bootFromStore(adopted, live.store, {
      seed: SEED,
      checkpoint: { requiredTables: registeredTables(adopted) },
    });
    expect(result.adoptedAtTick).toBe(TICKS - 1);
    expect(result.ticksReplayed).toBe(0);

    // The locks themselves, the derived free balances, and the exposure cache INV-5
    // checks — all three, because restoring rows without the cache resurrects exactly
    // the mismatch INV-5 exists to catch.
    expect(JSON.stringify(lockRows(adopted))).toBe(live.liveRows);
    expect(JSON.stringify(encumberedAccounts(adopted))).toBe(live.liveEncumbered);
    for (const [principal, exposure] of live.liveExposure) {
      expect(adopted.ledger.encumbrances.cachedExposure(principal as PrincipalId)).toBe(exposure);
    }
    expect(adopted.engine.stateHash).toBe(live.liveHash);

    // NOW TRY TO SPEND IT. A second lock over the FULL balance must be refused by the
    // free-balance test, which reads the restored book: if the book had come back
    // empty this would succeed and escrowed stake would be spendable (A5′).
    const row = lockRows(adopted)[0];
    expect(row).toBeDefined();
    if (row === undefined) return;
    const account = row.account as AccountId;
    const balance = adopted.ledger.balance(account);
    expect(adopted.ledger.freeBalance(account)).toBe(balance - row.amountMinor);
    expect(adopted.ledger.freeBalance(account)).toBeLessThan(balance);
    expect(() =>
      adopted.ledger.encumbrances.lock({
        eventId: 'audit:double-spend',
        tick: adopted.engine.tick,
        principal: row.principal as PrincipalId,
        account,
        amountMinor: balance,
        obligationRef: 'raid:audit:double' as never,
        maxDirectLoss: minor(0),
      }),
    ).toThrow(/INV-3/);
    // And the money the locks sit on is still exactly right.
    expect(checkInv7(adopted.ledger, adopted.engine.tick)).toEqual([]);
  }, 120_000);

  it('and the obligation book DOES come back, so the first tick after is clean', async () => {
    const live = await lockedRun();
    const adopted = seated(SEED);
    await bootFromStore(adopted, live.store, {
      seed: SEED,
      checkpoint: { requiredTables: registeredTables(adopted) },
    });
    const ref = `raid:audit:${String(live.lockedPrincipals[0])}`;
    // The lock is back AND the obligation it secures is back. This used to be the
    // manifest's `obligation` entry measured rather than asserted: the lock returned,
    // its obligation did not, and INV-4 halted the first tick after boot on an
    // orphan lock that nobody had orphaned.
    expect(adopted.obligations.isLive(ref as never)).toBe(true);

    const report = adopted.runTick();
    expect(
      report.halted,
      report.violations.map((v) => `${v.id} ${v.message}`).join(' | '),
    ).toBe(false);
    expect(report.violations.map((v) => v.id)).not.toContain('INV-4');
  }, 120_000);

  it('MUTATION PROOF: drop the obligation book from the capture and INV-4 halts again', async () => {
    const live = await lockedRun();
    const adopted = seated(SEED);
    await bootFromStore(adopted, live.store, {
      seed: SEED,
      checkpoint: { requiredTables: registeredTables(adopted) },
    });
    // Exactly what an unregistered obligation book looked like from here: the locks
    // restored, the obligations gone. If INV-4 does not halt on this, the check that
    // this whole capture exists to satisfy has stopped biting.
    adopted.obligations.restore({ live: [], secured: [] });
    const report = adopted.runTick();
    expect(report.halted).toBe(true);
    expect(report.violations.map((v) => v.id)).toContain('INV-4');
    expect(report.violations.map((v) => v.message).join(' ')).toMatch(/dead obligation/);
  }, 120_000);
});

// ── The two refusals that were in the code and in the report, but in no test ──

const ACCOUNT = 'stores:p:vex' as AccountId;
const FAUCET = 'faucet:starter_stake' as AccountId;

function posting(over: Partial<PersistedPosting> = {}): PersistedPosting {
  return {
    tick: 0,
    seqInTick: 0,
    postingIndex: 0,
    eventId: 'e:one' as EventId,
    account: ACCOUNT,
    good: null,
    amountMinor: 100,
    amountQty: null,
    batchKind: 'TRANSFER',
    supplyAccount: null,
    ...over,
  };
}

function snapshotOver(
  accounts: readonly string[],
  postingCount: number,
  batchCount: number,
): SnapshotRecord {
  return {
    tick: 0,
    stateHash: 'h',
    stateVersion: 1,
    seed: 's',
    seedHash: 'sh',
    tables: [['ledger', { accounts: accounts.map((id) => ({ id })), postingCount, batchCount }]],
  };
}

async function storeWith(postings: readonly PersistedPosting[]): Promise<InMemoryJournalStore> {
  const store = new InMemoryJournalStore();
  await store.init('s');
  await store.appendTick({ tick: 0, seed: 's', seedHash: 'sh', events: [], actions: [], postings });
  return store;
}

describe('the hydrate refusals the dropped foreign key was traded for', () => {
  it('refuses a posting whose account the snapshot never held — the FK replacement', async () => {
    // `schema.sql` drops `posting_account_id_fkey` and argues this check is strictly
    // stronger, because it compares against the accounts as they were AT that tick.
    // Deleting the check left the whole suite green before this test existed.
    const store = await storeWith([posting({ account: 'stores:p:ghost' as AccountId })]);
    const snapshot = snapshotOver([ACCOUNT], 1, 1);
    await expect(
      hydrateLedgerForSnapshot(seated(SEED).ledger, store, snapshot),
    ).rejects.toThrow(/which the snapshot's ledger capture does not contain/);
    // The same row against a snapshot that DOES hold the account is accepted, so the
    // refusal is discriminating rather than blanket.
    await expect(
      hydrateLedgerForSnapshot(seated(SEED).ledger, store, snapshotOver(['stores:p:ghost'], 1, 1)),
    ).resolves.toEqual({ postings: 1, batches: 1 });
  }, 60_000);

  it('refuses a batch group whose rows disagree about kind or supply — the denormalisation check', async () => {
    // `batch_kind`/`supply_account_id` are the batch's fields repeated on every row.
    // The argument that this stays a COPY of the fact and not a second HOME for it is
    // that the reader cross-checks them. Three disagreements, one per column.
    for (const [label, second] of [
      ['kind', posting({ postingIndex: 1, batchKind: 'ISSUE', supplyAccount: FAUCET })],
      ['supply', posting({ postingIndex: 1, supplyAccount: FAUCET, batchKind: 'TRANSFER' })],
      ['event', posting({ postingIndex: 1, eventId: 'e:other' as EventId })],
    ] as const) {
      const store = await storeWith([posting(), second]);
      await expect(
        hydrateLedgerForSnapshot(seated(SEED).ledger, store, snapshotOver([ACCOUNT], 2, 1)),
        `rows disagreeing about ${label} must be refused`,
      ).rejects.toThrow(HydrateError);
    }
    // And a group whose rows agree is accepted — the check is not refusing everything.
    const ok = await storeWith([posting(), posting({ postingIndex: 1, amountMinor: -100 })]);
    await expect(
      hydrateLedgerForSnapshot(seated(SEED).ledger, ok, snapshotOver([ACCOUNT], 2, 1)),
    ).resolves.toEqual({ postings: 2, batches: 1 });
  }, 60_000);
});

/**
 * A journal with nothing injected into it, so a genesis replay reproduces the head
 * hash. The locked run above deliberately cannot: its stakes are opened outside the
 * action log, which is what makes it a lock fixture and not a replay fixture.
 */
let cachedPlain: Promise<{ store: InMemoryJournalStore; headHash: string }> | null = null;
function plainRun(): Promise<{ store: InMemoryJournalStore; headHash: string }> {
  cachedPlain ??= (async (): Promise<{ store: InMemoryJournalStore; headHash: string }> => {
    const runtime = new Runtime({ seed: SEED });
    const cast = new HeuristicCast(runtime, { size: CAST_SIZE });
    cast.seat(SEED);
    const store = new InMemoryJournalStore();
    const journal = new Journal(store, { snapshotEveryTicks: SNAPSHOT_EVERY });
    await bootFromStore(runtime, store, { seed: SEED });
    for (let i = 0; i < TICKS; i += 1) {
      const target = runtime.engine.tick + 1;
      for (const action of cast.decide(target, SEED)) runtime.engine.submit(action);
      const report = runtime.runTick();
      if (report.halted) throw new Error(`plain sim halted at tick ${String(report.tick)}`);
      journal.record(runtime, report);
      await journal.flushPending();
    }
    await journal.drain();
    return { store, headHash: runtime.engine.stateHash };
  })();
  return cachedPlain;
}

describe('a rules change forces the slow path, because adoption re-derives nothing', () => {
  it('an adopted boot verifies ZERO tripwires, which is why the rules version has to gate it', async () => {
    const live = await plainRun();
    const runtime = seated(SEED);
    const result = await bootFromStore(runtime, live.store, {
      seed: SEED,
      checkpoint: { requiredTables: registeredTables(runtime) },
    });
    expect(result.adoptedAtTick).not.toBeNull();
    // The measured fact the gate below rests on: adopting the LATEST snapshot leaves a
    // tail with no snapshot in it, so nothing in the record is re-derived at all.
    expect(result.tripwiresChecked).toBe(0);
    // The genesis path, by contrast, checks every one.
    const control = seated(SEED);
    const slow = await bootFromStore(control, live.store, {
      seed: SEED,
      checkpoint: { disabled: true },
    });
    expect(slow.tripwiresChecked).toBeGreaterThan(0);
  }, 180_000);

  it('planCheckpoint refuses on a rules change even when the manifest is satisfied', async () => {
    const live = await plainRun();
    const runtime = seated(SEED);
    const tables = runtime.engine.stateTables;
    const required = registeredTables(runtime);

    // The control: with the manifest narrowed and no rules change, it adopts.
    const clean = await planCheckpoint(tables, live.store, { requiredTables: required });
    expect(clean.snapshot).not.toBeNull();

    const changed = await planCheckpoint(tables, live.store, {
      requiredTables: required,
      rulesChanged: true,
    });
    expect(changed.snapshot).toBeNull();
    expect(changed.refusal).toMatch(/RULES_VERSION/);
  }, 180_000);

  it('and boot supplies that fact itself, so a caller cannot narrow its way past it', async () => {
    const live = await plainRun();

    // The same journal read by a build whose rules moved. `bootFromStore` reads the
    // journalled version itself and ORs it in, so `rulesChanged: false` cannot unset it.
    const store = new InMemoryJournalStore();
    await store.init(SEED);
    for (const t of await live.store.ticksSince(-1)) await store.appendTick(t);
    for (const s of await live.store.snapshots()) await store.writeSnapshot(s);
    // `recordRulesVersion` is write-once, so this is the only way to stage the case.
    await store.recordRulesVersion(-1);

    const fresh = seated(SEED);
    const result = await bootFromStore(fresh, store, {
      seed: SEED,
      checkpoint: { requiredTables: registeredTables(fresh), rulesChanged: false },
    });
    expect(result.rulesVersionChanged).toBe(true);
    expect(result.adoptedAtTick).toBeNull();
    expect(result.checkpointRefusal).toMatch(/RULES_VERSION/);
    // The slow path ran, checked the record, and landed on the recorded world.
    expect(result.ticksReplayed).toBe(TICKS);
    expect(result.tripwiresChecked).toBeGreaterThan(0);
    expect(fresh.engine.stateHash).toBe(live.headHash);
  }, 180_000);
});
