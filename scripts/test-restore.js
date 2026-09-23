// Snapshot and restore of a module schema, on a real Postgres (DATABASE_URL).
// The 2026-09-23 failure: a revert with data dropped the unique index the
// reverted version's ON CONFLICT needed, because restoreSnapshot compared
// index NAMES and the clone (LIKE ... INCLUDING ALL) renames every index.
//   node scripts/test-restore.js
const assert = require("assert");
const { q, pool, initPlatformSchema } = require("../src/db");
const migrate = require("../src/migrate");

const CO = "acme", MOD = "watch";
const live = migrate.liveSchema(CO, MOD);
let passed = 0;
function ok(cond, what) { assert.ok(cond, what); passed++; console.log("  ok  " + what); }

async function indexShapes(schema, table) {
  return (await q("SELECT indexdef FROM pg_indexes WHERE schemaname=$1 AND tablename=$2", [schema, table]))
    .rows.map((r) => migrate.indexShape(r.indexdef)).sort();
}
async function cols(schema, table) {
  return (await q("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position", [schema, table]))
    .rows.map((r) => r.column_name);
}
async function upsert() {
  // what the module's page load does
  await q(`INSERT INTO ${live}.watch_logs (watch_date, station, reading) VALUES (current_date, 'A', 'ok')
           ON CONFLICT (watch_date, station) DO UPDATE SET reading = EXCLUDED.reading`);
}

(async () => {
  await initPlatformSchema();
  for (const s of (await q("SELECT nspname FROM pg_namespace WHERE nspname LIKE 'mod\\_acme%' OR nspname LIKE 'snap\\_acme%'")).rows) {
    await q(`DROP SCHEMA ${s.nspname} CASCADE`);
  }
  await q("DELETE FROM platform.schema_snapshots WHERE company=$1", [CO]);

  console.log("1. the failure of 2026-09-23: a named unique index survives a revert with data");
  await q(`CREATE SCHEMA ${live}`);
  await q(`CREATE TABLE ${live}.watch_logs (id serial PRIMARY KEY, watch_date date NOT NULL, station text NOT NULL, reading text)`);
  await q(`CREATE UNIQUE INDEX watch_logs_date_station ON ${live}.watch_logs (watch_date, station)`);
  await q(`INSERT INTO ${live}.watch_logs (watch_date, station, reading) VALUES ('2026-09-20', 'A', 'v1 row')`);
  const snap = await migrate.snapshotSchema(CO, MOD, 1);
  await migrate.recordSnapshot(CO, MOD, 1, snap);
  const snapNames = (await q("SELECT indexname FROM pg_indexes WHERE schemaname=$1 AND tablename='watch_logs'", [snap])).rows.map((r) => r.indexname);
  ok(!snapNames.includes("watch_logs_date_station"), "the clone renamed the index (" + snapNames.filter((n) => !/_pkey$/.test(n)).join(", ") + "), which is what the old name compare tripped on");

  // version 2's migration: a column, a second named unique index, a plain index, a named constraint, more rows
  await q(`ALTER TABLE ${live}.watch_logs ADD COLUMN shift text`);
  await q(`CREATE UNIQUE INDEX watch_logs_shift_station ON ${live}.watch_logs (shift, station)`);
  await q(`CREATE INDEX watch_logs_reading_idx ON ${live}.watch_logs (reading)`);
  await q(`ALTER TABLE ${live}.watch_logs ADD CONSTRAINT watch_logs_date_shift UNIQUE (watch_date, shift)`);
  await q(`INSERT INTO ${live}.watch_logs (watch_date, station, reading, shift) VALUES ('2026-09-22', 'B', 'v2 row', 'day')`);

  await migrate.restoreSnapshot(CO, MOD, snap);
  const shapes = await indexShapes(live, "watch_logs");
  ok(shapes.includes("CREATE UNIQUE INDEX ON watch_logs USING btree (watch_date, station)"), "the unique index from before the snapshot is still there");
  ok(shapes.length === 2, "only the primary key and that index remain (" + shapes.length + ")");
  ok(!shapes.some((s) => /shift/.test(s)), "the later unique index and the later constraint are gone");
  ok(!shapes.some((s) => /reading/.test(s)), "the later plain index is gone");
  assert.deepStrictEqual(await cols(live, "watch_logs"), ["id", "watch_date", "station", "reading"]); ok(true, "the later column is gone");
  const rows = (await q(`SELECT reading FROM ${live}.watch_logs ORDER BY id`)).rows.map((r) => r.reading);
  assert.deepStrictEqual(rows, ["v1 row"]); ok(true, "the data is the snapshot's");
  await upsert(); ok(true, "INSERT ... ON CONFLICT (watch_date, station) works after the restore");
  await q(`INSERT INTO ${live}.watch_logs (watch_date, station, reading) VALUES ('2026-09-24', 'C', 'seq check')`);
  ok(true, "the serial sequence was reset (a new row got an id)");

  console.log("2. the state demo is in now: the live table lost the index; a restore brings it back");
  await q(`DROP INDEX ${live}.watch_logs_date_station`);
  await assert.rejects(upsert, /no unique or exclusion constraint/); ok(true, "without the index the upsert fails the way the logs show");
  await migrate.restoreSnapshot(CO, MOD, snap);
  ok((await indexShapes(live, "watch_logs")).includes("CREATE UNIQUE INDEX ON watch_logs USING btree (watch_date, station)"), "the restore made the index again from the snapshot's definition");
  await upsert(); ok(true, "the upsert works again");

  console.log("3. a second restore is a no-op on structure (nothing dropped, nothing doubled)");
  const before = await indexShapes(live, "watch_logs");
  await migrate.restoreSnapshot(CO, MOD, snap);
  assert.deepStrictEqual(await indexShapes(live, "watch_logs"), before); ok(true, "same indexes before and after");

  console.log("4. a unique CONSTRAINT (not a plain index) from before the snapshot survives too");
  await q(`ALTER TABLE ${live}.watch_logs ADD CONSTRAINT watch_logs_station_reading UNIQUE (station, reading)`);
  const snap2 = await migrate.snapshotSchema(CO, MOD, 2);
  await migrate.recordSnapshot(CO, MOD, 2, snap2);
  await q(`CREATE INDEX later_idx ON ${live}.watch_logs (station)`);
  await migrate.restoreSnapshot(CO, MOD, snap2);
  const s4 = await indexShapes(live, "watch_logs");
  ok(s4.includes("CREATE UNIQUE INDEX ON watch_logs USING btree (station, reading)"), "the constraint's index is still there");
  ok(!s4.some((s) => /btree \(station\)$/.test(s)), "the later plain index is gone");
  ok((await q("SELECT 1 FROM pg_constraint WHERE conname='watch_logs_station_reading'")).rows.length === 1, "and it is still a constraint, untouched");

  console.log(`\n${passed}/${passed} restore checks passed`);
  await pool.end();
})().catch(async (e) => { console.error("FAILED:", e.message); await pool.end(); process.exit(1); });
