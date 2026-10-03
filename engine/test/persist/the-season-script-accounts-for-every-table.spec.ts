/**
 * ★ EVERY TABLE IS ON EXACTLY ONE OF THE SEASON SCRIPT'S LISTS — checked here, not first on the host.
 *
 * `deploy/new-season-standalone.sh` empties WORLD_TABLES, keeps KEEP_TABLES, and refuses outright when
 * the live database holds a table on neither list. That refusal is right, and it fires on the box, at
 * step 4 of a season cutover, with an owner waiting. This is the same check one step earlier: every
 * table `schema.sql` creates must be on exactly one list, and every name on a list must be a table the
 * schema creates — so a migration that adds a table cannot reach a cutover undecided.
 *
 * And the decision for `hosted_key` (migration 3, the SIGNER disclosure) is pinned: WORLD. Each row
 * names a key the chat connector enrolled for one of this world's principals, beside the
 * `journal_enrollment` row that re-seats it, and those principals end with the world.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SCHEMA = readFileSync(new URL('../../src/db/schema.sql', import.meta.url), 'utf8');
const SCRIPT = readFileSync(new URL('../../../deploy/new-season-standalone.sh', import.meta.url), 'utf8');
const RESTORE = readFileSync(new URL('../../../deploy/verify-standalone-restore.py', import.meta.url), 'utf8');

function list(name: string): readonly string[] {
  const body = new RegExp(`^${name}=\\(([^)]*)\\)`, 'm').exec(SCRIPT)?.[1];
  if (body === undefined) throw new Error(`${name} not found in new-season-standalone.sh — this guard cannot run`);
  return body.split(/\s+/).filter((t) => t.length > 0);
}

/** Every table `schema.sql` creates. Partitions are made by `ensurePartitions`, never here, and the script skips them. */
const TABLES = [...SCHEMA.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(/g)].map((m) => m[1] ?? '');

describe('★ the season script decides every table the schema creates', () => {
  it('parses both sides non-trivially', () => {
    expect(TABLES.length).toBeGreaterThan(15);
    expect(list('WORLD_TABLES').length).toBeGreaterThan(10);
    expect(list('KEEP_TABLES').length).toBeGreaterThan(1);
  });

  it('each table is on exactly one list, and each listed name is a real table', () => {
    const world = list('WORLD_TABLES');
    const keep = list('KEEP_TABLES');
    for (const table of TABLES) {
      const on = Number(world.includes(table)) + Number(keep.includes(table));
      expect(on, `${table} is on ${String(on)} of the season script's lists; it must be on exactly one`).toBe(1);
    }
    for (const name of [...world, ...keep]) expect(TABLES, `${name} is listed and the schema creates no such table`).toContain(name);
  });

  it('hosted_key ends with the world', () => {
    expect(list('WORLD_TABLES')).toContain('hosted_key');
    expect(list('KEEP_TABLES')).not.toContain('hosted_key');
  });

  it("the restore pre-flight proves every hosted key in a dump comes back, counted after the build's own migration", () => {
    const migrateAt = RESTORE.indexOf("engine/dist/db/migrate.js");
    const countAt = RESTORE.indexOf('SELECT count(*) FROM hosted_key');
    expect(migrateAt).toBeGreaterThan(0);
    expect(countAt, 'the dump is counted only once the table is sure to exist').toBeGreaterThan(migrateAt);
    expect(RESTORE).toContain("assert report['signers']['hosted'] == hosted");
  });
});
