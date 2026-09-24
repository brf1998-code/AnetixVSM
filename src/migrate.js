// Platform-mediated module migrations + in-database snapshots.
//
// Modules own real SQL tables, but module code (and build agents) never run DDL
// directly. A module version ships migration files (migrations/NNN.sql). The
// platform:
//   1. VALIDATES each file: additive-only statements, inside the module's own
//      schema, no destructive operations.
//   2. Applies new migrations to the STAGING schema first (stg_<name>), which is
//      a structural+data clone of the live schema made when a build starts.
//   3. On deploy: snapshots the live schema (a clone into snap_<name>_<ts>),
//      then applies the same migrations to the live schema (mod_<name>).
// Rollback restores the snapshot into the live schema in place (data + column
// set + indexes) and repoints the live version. No pg_dump, no disk: the
// database is the only thing that has to persist across a container redeploy.
const fs = require("fs");
const path = require("path");
const { q, pool, logEvent } = require("./db");

const KEEP_SNAPSHOTS = Number(process.env.SOS_KEEP_SNAPSHOTS || 10);

// Schema names must be bare SQL identifiers; slugs may carry dashes.
const ident = (s) => String(s).replace(/[^a-z0-9_]/gi, "_");
function liveSchema(company, mod) { return `mod_${ident(company)}_${ident(mod)}`; }
function stagingSchema(company, mod) { return `stg_${ident(company)}_${ident(mod)}`; }

// ---- validation -----------------------------------------------------------
// Allowed statement shapes (whitespace-insensitive, case-insensitive):
//   CREATE TABLE [IF NOT EXISTS] <ident> ...
//   CREATE [UNIQUE] INDEX [IF NOT EXISTS] <ident> ON <ident> ...
//   ALTER TABLE <ident> ADD COLUMN [IF NOT EXISTS] ...
//   INSERT INTO <ident> ...            (seed data only)
// Anything else is rejected. Table identifiers must be bare names (no schema
// qualification, no quotes) so the platform controls the schema via search_path.
// Forbidden operations, checked as WHOLE words with string literals blanked
// out. Until 2026-09-17 this was a substring match on the raw statement, so a
// column named updated_at, deleted_at, owner_name, granted_at, reset_count,
// rule_text, trigger_level or copy_count, and any seed value containing "do"
// or "update", was rejected as a forbidden operation. Functionality builds
// (the ones that add migrations) died at the build step on that, which looked
// like a rejection on the board. A forbidden word directly followed by a
// column type (owner TEXT, cluster INTEGER) is a column definition, not an
// operation, and is allowed too.
const FORBIDDEN_WORDS = /\b(DROP|TRUNCATE|DELETE|UPDATE|GRANT|REVOKE|SECURITY|FUNCTION|TRIGGER|RULE|EXTENSION|COPY|VACUUM|REINDEX|CLUSTER|OWNER|RESET|DO)\b(?!\s+(?:TEXT|VARCHAR|CHAR|INTEGER|INT|SMALLINT|BIGINT|SERIAL|BIGSERIAL|BOOLEAN|BOOL|NUMERIC|DECIMAL|REAL|DOUBLE|FLOAT|TIMESTAMPTZ|TIMESTAMP|DATE|TIME|JSONB|JSON|UUID|BYTEA)\b)/i;
const FORBIDDEN_PHRASES = /\b(ALTER\s+SCHEMA|CREATE\s+SCHEMA|SET\s+ROLE|ALTER\s+TABLE\s+\w+\s+(?:DROP|RENAME|ALTER)\b)/i;
const stripLiterals = (st) => st.replace(/'(?:[^']|'')*'/g, "''");
const FORBIDDEN = { test: (st) => { const bare = stripLiterals(st); return FORBIDDEN_PHRASES.test(bare) || FORBIDDEN_WORDS.test(bare); } };
const BARE_IDENT = "[a-z_][a-z0-9_]*";
const ALLOWED = [
  new RegExp(`^CREATE\\s+TABLE\\s+(IF\\s+NOT\\s+EXISTS\\s+)?${BARE_IDENT}\\s*\\(`, "i"),
  new RegExp(`^CREATE\\s+(UNIQUE\\s+)?INDEX\\s+(IF\\s+NOT\\s+EXISTS\\s+)?${BARE_IDENT}\\s+ON\\s+${BARE_IDENT}\\b`, "i"),
  new RegExp(`^ALTER\\s+TABLE\\s+${BARE_IDENT}\\s+ADD\\s+COLUMN\\s+(IF\\s+NOT\\s+EXISTS\\s+)?${BARE_IDENT}\\b`, "i"),
  new RegExp(`^INSERT\\s+INTO\\s+${BARE_IDENT}\\b`, "i"),
];

function splitStatements(sql) {
  // naive split on ";" at line ends. Migration files are agent/platform
  // authored, so we keep the dialect simple on purpose (no functions, no $$).
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.replace(/--[^\n]*/g, "").trim())
    .filter(Boolean);
}

function validateMigrationSql(sql) {
  const errors = [];
  const statements = splitStatements(sql);
  if (!statements.length) errors.push("migration file contains no statements");
  for (const st of statements) {
    if (FORBIDDEN.test(st)) {
      errors.push(`forbidden operation in: ${st.slice(0, 80)}`);
      continue;
    }
    if (/\bpublic\s*\.|\bplatform\s*\.|\bmod_|\bstg_|\bsnap_|"/i.test(st)) {
      errors.push(`schema-qualified or quoted identifier not allowed: ${st.slice(0, 80)}`);
      continue;
    }
    if (!ALLOWED.some((re) => re.test(st))) {
      errors.push(`statement shape not allowed (additive-only): ${st.slice(0, 80)}`);
    }
  }
  return { ok: errors.length === 0, errors, count: statements.length };
}

// ---- migration bookkeeping ------------------------------------------------
async function ensureMigrationTable(schema) {
  await q(`CREATE TABLE IF NOT EXISTS ${schema}._migrations (
    file TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
}

function migrationFiles(versionDir) {
  const dir = path.join(versionDir, "migrations");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()
    .map((f) => ({ file: f, sql: fs.readFileSync(path.join(dir, f), "utf8") }));
}

// Apply a version's migrations to a schema (skipping already-applied files).
async function applyMigrations(schema, versionDir) {
  await q(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  await ensureMigrationTable(schema);
  const applied = new Set(
    (await q(`SELECT file FROM ${schema}._migrations`)).rows.map((r) => r.file)
  );
  const results = [];
  for (const m of migrationFiles(versionDir)) {
    if (applied.has(m.file)) continue;
    const v = validateMigrationSql(m.sql);
    if (!v.ok) throw new Error(`migration ${m.file} rejected: ${v.errors.join("; ")}`);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL search_path TO ${schema}`);
      await client.query(m.sql);
      await client.query(`INSERT INTO ${schema}._migrations (file) VALUES ($1)`, [m.file]);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw new Error(`migration ${m.file} failed: ${e.message}`);
    } finally {
      client.release();
    }
    results.push(m.file);
  }
  await ensureIndexes(schema, versionDir);
  return results;
}

// ---- declared indexes (self-heal) -----------------------------------------
// The 2026-09-23 damage: a restore stripped a module's named indexes, and
// every snapshot taken after that carried the loss, so any later restore put
// a schema with no indexes on the floor and the version's ON CONFLICT
// upserts failed. Structure the version's own migrations declare is not
// something a snapshot gets to take away: after the migrations run (boot,
// deploy, switch, staging) and after a data restore, every index and unique
// constraint those files name is made again if it is missing. Only those
// statements are replayed, each made idempotent; tables and columns stay
// with applyMigrations. Handled: CREATE [UNIQUE] INDEX, ALTER TABLE ... ADD
// CONSTRAINT ... UNIQUE (...), and CONSTRAINT/UNIQUE (...) lines inside a
// CREATE TABLE body. A column-level UNIQUE on a single column is not.
const unq = (s) => s.replace(/^"|"$/g, "");
function tableBodies(sql) {
  const out = [];
  const re = /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?("?[\w.]+"?)\s*\(/gi;
  let m;
  while ((m = re.exec(sql))) {
    let depth = 1, i = re.lastIndex;
    while (i < sql.length && depth > 0) { if (sql[i] === "(") depth++; else if (sql[i] === ")") depth--; i++; }
    out.push({ table: unq(m[1]), body: sql.slice(re.lastIndex, i - 1) });
  }
  return out;
}
function declaredIndexes(sql) {
  sql = sql.replace(/--[^\n]*/g, "");
  const out = [];
  let m;
  const idx = /\bCREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?("?\w+"?)\s+ON\s+([^;]+)/gi;
  while ((m = idx.exec(sql))) out.push({ name: unq(m[2]), exec: `CREATE ${m[1] ? "UNIQUE " : ""}INDEX IF NOT EXISTS ${m[2]} ON ${m[3].trim()}` });
  const alt = /\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?("?[\w.]+"?)\s+ADD\s+CONSTRAINT\s+("?\w+"?)\s+(UNIQUE\s*\([^)]*\))/gi;
  while ((m = alt.exec(sql))) out.push({ name: unq(m[2]), exec: `ALTER TABLE ${m[1]} ADD CONSTRAINT ${m[2]} ${m[3]}` });
  for (const t of tableBodies(sql)) {
    const con = /(?:CONSTRAINT\s+("?\w+"?)\s+)?\bUNIQUE\s*\(([^)]*)\)/gi;
    while ((m = con.exec(t.body))) {
      const cols = m[2].split(",").map((c) => c.trim()).filter(Boolean).join(", ");
      if (m[1]) out.push({ name: unq(m[1]), exec: `ALTER TABLE ${t.table} ADD CONSTRAINT ${m[1]} UNIQUE (${cols})` });
      else out.push({ name: null, table: t.table, cols, exec: `ALTER TABLE ${t.table} ADD UNIQUE (${cols})` });
    }
  }
  return out;
}
async function ensureIndexes(schema, versionDir) {
  const wanted = [];
  for (const m of migrationFiles(versionDir)) wanted.push(...declaredIndexes(m.sql));
  if (!wanted.length) return { made: [], failed: [] };
  const made = [], failed = [];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL search_path TO ${schema}`);
    for (const w of wanted) {
      const have = w.name
        ? (await client.query(
            `SELECT 1 FROM pg_indexes WHERE schemaname=$1 AND indexname=$2
             UNION ALL SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname=$1 AND c.conname=$2`,
            [schema, w.name])).rows.length > 0
        : (await client.query(
            `SELECT 1 FROM pg_indexes WHERE schemaname=$1 AND tablename=$2 AND indexdef LIKE 'CREATE UNIQUE INDEX %' AND indexdef LIKE $3`,
            [schema, w.table, `%(${w.cols})`])).rows.length > 0;
      if (have) continue;
      await client.query("SAVEPOINT one");
      try {
        await client.query(w.exec);
        made.push(w.name || `${w.table} UNIQUE (${w.cols})`);
      } catch (e) {
        await client.query("ROLLBACK TO SAVEPOINT one");
        failed.push({ what: w.exec, why: e.message });
      }
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  if (made.length || failed.length) {
    console.warn(`[migrate] ${schema}: ${made.length} declared index(es) were missing and were made again${failed.length ? `; ${failed.length} could not be (${failed.map((f) => f.why).join("; ")})` : ""}`);
    await logEvent("indexes_ensured", schema, { made, failed });
  }
  return { made, failed };
}

// ---- schema cloning (used for staging and snapshots) ----------------------
async function tablesIn(schema) {
  return (await q(`SELECT tablename FROM pg_tables WHERE schemaname = $1 ORDER BY tablename`, [schema]))
    .rows.map((r) => r.tablename);
}

async function cloneSchema(fromSchema, toSchema) {
  await q(`DROP SCHEMA IF EXISTS ${toSchema} CASCADE`);
  await q(`CREATE SCHEMA ${toSchema}`);
  await q(`CREATE SCHEMA IF NOT EXISTS ${fromSchema}`);
  const tables = await tablesIn(fromSchema);
  for (const t of tables) {
    // INCLUDING ALL keeps defaults (so serial columns keep pointing at the live
    // sequence), constraints and indexes. Data is copied row for row.
    await q(`CREATE TABLE ${toSchema}.${t} (LIKE ${fromSchema}.${t} INCLUDING ALL)`);
    await q(`INSERT INTO ${toSchema}.${t} SELECT * FROM ${fromSchema}.${t}`);
  }
  return tables;
}

// Rebuild the staging schema as a clone (structure + data) of the live one.
async function rebuildStagingClone(company, mod) {
  const tables = await cloneSchema(liveSchema(company, mod), stagingSchema(company, mod));
  await logEvent("staging_clone_rebuilt", `${company}/${mod}`, { tables });
  return tables;
}

// ---- snapshots (in-database) ----------------------------------------------
async function snapshotSchema(company, mod, version) {
  const name = `snap_${ident(company)}_${ident(mod)}_${Date.now()}`;
  await cloneSchema(liveSchema(company, mod), name);
  return name;
}

async function recordSnapshot(company, mod, version, snapName) {
  await q(
    "INSERT INTO platform.schema_snapshots (company, module, version, file) VALUES ($1,$2,$3,$4)",
    [company, mod, version, snapName]
  );
  // retention: keep the newest N per module
  const old = (await q(
    `SELECT id, file FROM platform.schema_snapshots WHERE company=$1 AND module=$2 ORDER BY id DESC OFFSET $3`,
    [company, mod, KEEP_SNAPSHOTS])).rows;
  for (const s of old) {
    await q(`DROP SCHEMA IF EXISTS ${s.file} CASCADE`);
    await q("DELETE FROM platform.schema_snapshots WHERE id=$1", [s.id]);
  }
}

async function columnsOf(schema, table) {
  return (await q(
    `SELECT column_name, column_default FROM information_schema.columns
      WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position`, [schema, table])).rows;
}

// One row per index of a table, with the constraint behind it when there is
// one (a UNIQUE or PRIMARY KEY constraint owns its index; DROP INDEX refuses
// those, DROP CONSTRAINT is the way).
const INDEX_SQL = `
  SELECT i.indexname, i.indexdef, c.conname, c.contype
    FROM pg_indexes i
    JOIN pg_namespace n ON n.nspname = i.schemaname
    JOIN pg_class ic ON ic.relname = i.indexname AND ic.relnamespace = n.oid
    LEFT JOIN pg_constraint c ON c.conindid = ic.oid AND c.contype IN ('p', 'u', 'x')
   WHERE i.schemaname = $1 AND i.tablename = $2
   ORDER BY i.indexname`;
// "CREATE UNIQUE INDEX watch_logs_date_station ON mod_demo_watch.watch_logs USING btree (watch_date, station)"
// becomes "CREATE UNIQUE INDEX ON watch_logs USING btree (watch_date, station)": the same
// index in any schema under any name has the same shape.
function indexShape(indexdef) {
  return indexdef.replace(/^CREATE (UNIQUE )?INDEX \S+ ON \S+\.(\S+) /, "CREATE $1INDEX ON $2 ");
}
// The snapshot's definition pointed at the live table, with no name so that
// Postgres picks a free one (the snapshot's own name is a made-up one anyway).
function indexOnLive(indexdef, liveSchemaName) {
  return indexdef.replace(/^CREATE (UNIQUE )?INDEX \S+ ON \S+\./, `CREATE $1INDEX ON ${liveSchemaName}.`);
}

// Restore a snapshot INTO the live schema in place. Additive-only migrations
// mean the live schema is a superset of the snapshot: extra tables, columns and
// indexes get dropped, then every table's data is replaced with the snapshot's.
async function restoreSnapshot(company, mod, snapName) {
  const live = liveSchema(company, mod);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const liveTables = (await client.query(`SELECT tablename FROM pg_tables WHERE schemaname=$1`, [live])).rows.map((r) => r.tablename);
    const snapTables = (await client.query(`SELECT tablename FROM pg_tables WHERE schemaname=$1`, [snapName])).rows.map((r) => r.tablename);
    // A recorded snapshot whose schema is gone would read as "no tables" and
    // the loop below would drop every live table. Refuse instead.
    if (!snapTables.length) throw new Error(`snapshot ${snapName} has no tables; nothing was restored`);

    for (const t of liveTables) {
      if (!snapTables.includes(t)) await client.query(`DROP TABLE ${live}.${t} CASCADE`);
    }
    for (const t of snapTables) {
      if (!liveTables.includes(t)) {
        await client.query(`CREATE TABLE ${live}.${t} (LIKE ${snapName}.${t} INCLUDING ALL)`);
      }
      const liveCols = (await client.query(
        `SELECT column_name, column_default FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position`, [live, t])).rows;
      const snapCols = (await client.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position`, [snapName, t])).rows.map((r) => r.column_name);
      for (const c of liveCols) {
        if (!snapCols.includes(c.column_name)) await client.query(`ALTER TABLE ${live}.${t} DROP COLUMN ${c.column_name}`);
      }
      // Indexes: matched to the snapshot's by DEFINITION, never by name. The
      // clone (LIKE ... INCLUDING ALL) gives every copied index a name Postgres
      // makes up, so an index a migration named itself (CREATE UNIQUE INDEX
      // watch_logs_date_station ...) sits in the snapshot as
      // watch_logs_watch_date_station_idx. Comparing names took the live one
      // for "added after the snapshot" and dropped it, and the reverted
      // version's INSERT ... ON CONFLICT (watch_date, station) then failed on
      // every request (demo, 2026-09-23). Now: a live index whose definition
      // the snapshot does not have goes (it was added by a later migration); an
      // index the snapshot has and the live table lacks is made again from the
      // snapshot's definition. The primary key is never dropped.
      const liveIdx = (await client.query(INDEX_SQL, [live, t])).rows;
      const snapIdx = (await client.query(INDEX_SQL, [snapName, t])).rows;
      const snapShapes = new Set(snapIdx.map((r) => indexShape(r.indexdef)));
      const liveShapes = new Set(liveIdx.map((r) => indexShape(r.indexdef)));
      for (const i of liveIdx) {
        if (i.contype === "p" || snapShapes.has(indexShape(i.indexdef))) continue;
        if (i.conname) await client.query(`ALTER TABLE ${live}.${t} DROP CONSTRAINT ${i.conname}`);
        else await client.query(`DROP INDEX IF EXISTS ${live}.${i.indexname}`);
      }
      for (const i of snapIdx) {
        if (i.contype === "p" || liveShapes.has(indexShape(i.indexdef))) continue;
        await client.query(indexOnLive(i.indexdef, live));
      }
      const cols = snapCols.join(", ");
      await client.query(`TRUNCATE ${live}.${t}`);
      await client.query(`INSERT INTO ${live}.${t} (${cols}) SELECT ${cols} FROM ${snapName}.${t}`);
      // reset serial sequences to the restored data
      for (const c of liveCols) {
        const m = /nextval\('([^']+)'/.exec(c.column_default || "");
        if (m && snapCols.includes(c.column_name)) {
          await client.query(
            `SELECT setval('${m[1]}', COALESCE((SELECT MAX(${c.column_name}) FROM ${live}.${t}), 0) + 1, false)`);
        }
      }
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  await logEvent("schema_restored", `${company}/${mod}`, { snapshot: snapName });
}

module.exports = {
  liveSchema, stagingSchema, validateMigrationSql, applyMigrations,
  rebuildStagingClone, snapshotSchema, recordSnapshot, restoreSnapshot, tablesIn, columnsOf,
  indexShape, indexOnLive, ensureIndexes, declaredIndexes,
};
