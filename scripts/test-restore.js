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

  console.log("5. a damaged snapshot (no indexes) is healed from the version's own migrations");
  const fs = require("fs"), os = require("os"), path = require("path");
  const vdir = fs.mkdtempSync(path.join(os.tmpdir(), "sos-v-"));
  fs.mkdirSync(path.join(vdir, "migrations"));
  fs.writeFileSync(path.join(vdir, "migrations", "001.sql"), `
-- the module's own schema, the way a build agent writes it
CREATE TABLE IF NOT EXISTS watch_logs (id serial PRIMARY KEY, watch_date date NOT NULL, station text NOT NULL, reading text);
CREATE UNIQUE INDEX IF NOT EXISTS watch_logs_date_station ON watch_logs (watch_date, station);
CREATE INDEX watch_logs_reading_idx ON watch_logs (reading);
CREATE TABLE IF NOT EXISTS params (
  id serial PRIMARY KEY,
  section text NOT NULL,
  code text NOT NULL,
  limits numeric(10,2),
  CONSTRAINT params_section_code UNIQUE (section, code),
  UNIQUE (code)
);
ALTER TABLE params ADD CONSTRAINT params_code_section UNIQUE (code, section);
`);
  await q(`CREATE TABLE ${live}.params (id serial PRIMARY KEY, section text NOT NULL, code text NOT NULL, limits numeric(10,2))`);
  // strip everything but the primary keys, the way the old restore left demo, and snapshot that
  for (const t of ["watch_logs", "params"]) {
    for (const r of (await q(`SELECT i.indexname, c.conname FROM pg_indexes i JOIN pg_namespace n ON n.nspname=i.schemaname
                              JOIN pg_class ic ON ic.relname=i.indexname AND ic.relnamespace=n.oid
                              LEFT JOIN pg_constraint c ON c.conindid=ic.oid WHERE i.schemaname=$1 AND i.tablename=$2 AND i.indexname NOT LIKE '%_pkey'`, [live, t])).rows) {
      if (r.conname) await q(`ALTER TABLE ${live}.${t} DROP CONSTRAINT ${r.conname}`);
      else await q(`DROP INDEX ${live}.${r.indexname}`);
    }
  }
  const bad = await migrate.snapshotSchema(CO, MOD, 6);
  await migrate.recordSnapshot(CO, MOD, 6, bad);
  ok((await q("SELECT 1 FROM pg_indexes WHERE schemaname=$1 AND indexname NOT LIKE '%_pkey'", [bad])).rows.length === 0, "the snapshot carries no indexes, like demo's");
  const decl = migrate.declaredIndexes(fs.readFileSync(path.join(vdir, "migrations", "001.sql"), "utf8"));
  // in file order since 2026-09-28 (the declarations are read from the validator's statements); the set is what counts
  assert.deepStrictEqual(decl.map((d) => d.name || `${d.table}:${d.cols}`).sort(), ["watch_logs_date_station", "watch_logs_reading_idx", "params_code_section", "params_section_code", "params:code"].sort());
  ok(true, "five declarations found in the migration (index, plain index, alter-add, named body constraint, bare body UNIQUE)");
  let r5 = await migrate.ensureIndexes(live, vdir);
  assert.deepStrictEqual(r5.made.sort(), ["params UNIQUE (code)", "params_code_section", "params_section_code", "watch_logs_date_station", "watch_logs_reading_idx"].sort());
  ok(r5.failed.length === 0, "all five made again, none failed");
  await upsert(); ok(true, "the upsert works again");
  r5 = await migrate.ensureIndexes(live, vdir);
  ok(r5.made.length === 0 && r5.failed.length === 0, "a second pass makes nothing (all present by name or shape)");
  await migrate.restoreSnapshot(CO, MOD, bad);
  ok(!(await indexShapes(live, "watch_logs")).includes("CREATE UNIQUE INDEX ON watch_logs USING btree (watch_date, station)"), "restoring the damaged snapshot strips the index again (faithful to the snapshot)");
  await migrate.ensureIndexes(live, vdir);
  await upsert(); ok(true, "and the heal after the restore brings it back");
  await migrate.restoreSnapshot(CO, MOD, bad);   // params back to no constraints
  await q(`INSERT INTO ${live}.params (section, code) VALUES ('a','x'), ('a','x')`);
  r5 = await migrate.ensureIndexes(live, vdir);
  ok(r5.failed.length === 3 && r5.failed.every((f) => /could not create unique index|duplicate key/.test(f.why)), "duplicate rows: the three params constraints are reported as failed, not thrown");
  ok(r5.made.length === 2, "and the pass still completed: the two watch_logs indexes were made");

  console.log("6. a recorded snapshot whose schema is gone is refused, not restored over");
  await q(`DROP SCHEMA ${bad} CASCADE`);
  await assert.rejects(() => migrate.restoreSnapshot(CO, MOD, bad), /has no tables/);
  ok((await q("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname=$1", [live])).rows[0].n === 2, "the live tables are still there");

  console.log(`\n${passed}/${passed} restore checks passed`);
  await pool.end();
})().catch(async (e) => { console.error("FAILED:", e.message); await pool.end(); process.exit(1); });
