import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration — CONCURRENCY ONLY. It deliberately sets nothing else.
 *
 * ── WHY THIS FILE EXISTS ──
 *
 * There was no config at all until 2026-08-02, so vitest ran on defaults: one worker
 * thread per core, 14 of 14 on this box. The suite is ~6,300 seconds of CPU-bound
 * simulation — single specs run 17 and 23 minutes — so all fourteen workers stay hot for
 * the whole run and the MAIN process, which owns the reporter, never gets scheduled.
 *
 * Its RPC then times out:
 *
 *     Error: [vitest-worker]: Timeout calling "onTaskUpdate"
 *
 * Twice, on two different full-suite runs, each time reported against whichever spec
 * happened to be running (`test/works/a-good-only-the-commons-makes.spec.ts` both times —
 * it is not the cause; it passes alone in 30 s, 16 tests).
 *
 * ── WHY IT MATTERED ENOUGH TO FIX RATHER THAN RETRY ──
 *
 * Those are *unhandled errors*, not test failures. Both runs reported **3,899 passed, 1
 * skipped, 0 failed** — and vitest still exits non-zero, so `gate0` refused to deploy. A
 * gate that fails on a coin-flip for reasons unrelated to the code is a gate somebody
 * eventually learns to skip, and this repo has a scar for exactly that shape: a signal
 * that is red while nothing is broken stops being read.
 *
 * ── WHAT IT CHANGES, AND WHAT IT MUST NOT ──
 *
 * `maxThreads: 10` leaves four cores for the main process and the OS. Nothing else. In
 * particular this file does **not** set `include`, `exclude`, `testTimeout` or anything
 * else that could change WHICH tests run or WHETHER one can pass — a config that quietly
 * narrowed discovery would turn a flaky gate into a lying one, which is strictly worse.
 *
 * **The count is the guard.** The full suite is 312 files / 3,904 tests. If that number
 * ever falls after touching this file, the config is wrong, not the suite.
 */
export default defineConfig({
  test: {
    pool: 'threads',
    poolOptions: {
      threads: {
        // BOTH bounds, and that is not belt-and-braces. `minThreads` defaults to the core
        // count, so setting `maxThreads` alone makes min(14) > max(10) and tinypool throws
        // `options.minThreads and options.maxThreads must not conflict` — which vitest
        // reports as an unhandled error and **"no tests"**, in 31 ms.
        //
        // It exits non-zero, so the gate catches it. Worth recording anyway: the dangerous
        // version of this mistake is the one that runs SOME tests and exits 0, and the
        // count check in the docblock above is the only thing that would separate the two.
        minThreads: 1,
        // Headroom for the main process, which owns the reporter RPC. Not a tuning knob:
        // raise it back to the core count and the timeout above comes back.
        maxThreads: 10,
      },
    },
  },
});
