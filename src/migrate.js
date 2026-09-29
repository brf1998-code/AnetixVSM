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
// Two companies' tools must never share tables (the launch audit 2.14, 2026-09-27): a schema is mod_<company>_<tool>
// with dashes read as underscores, so acme + north-scrap and acme-north + scrap would both be mod_acme_north_scrap.
// -> { company, name } of the tool (or a new-tool request under way at another company) already on those tables, or
// null. A company's own slug cannot clash with another's (slugs carry no underscores), so the check is per tool.
async function schemaClash(company, mod, { intakes = true } = {}) {
  const want = `${ident(company)}_${ident(mod)}`;
  const rows = (await q("SELECT company, name FROM platform.modules WHERE NOT (company=$1 AND name=$2)", [company, mod])).rows;
  if (intakes) {
    const more = await q("SELECT company, slug AS name FROM platform.module_intakes WHERE slug IS NOT NULL AND status NOT IN ('abandoned','done') AND company<>$1", [company]).catch(() => ({ rows: [] }));
    rows.push(...more.rows);
  }
  return rows.find((r) => `${ident(r.company)}_${ident(r.name)}` === want) || null;
}
// The tool's own name when its tables are free, else the name with -2, -3 ... (a tool's slug is only its address;
// the manager sees the name they typed). `taken(slug)` is the company's own test (another tool or request there).
async function freeToolSlug(company, slug, taken = async () => false) {
  for (let i = 1; i < 60; i++) {
    const s = i === 1 ? slug : `${slug.slice(0, 30 - String(i).length - 1).replace(/-+$/, "")}-${i}`;
    if (i > 1 && (await taken(s))) continue;
    if (!(await schemaClash(company, s))) return s;
  }
  throw new Error("could not find a free name for this tool's tables");
}
function stagingSchema(company, mod) { return `stg_${ident(company)}_${ident(mod)}`; }
// the test floor (docs/TEST-ENVIRONMENT.md): a third set of tables per tool, built from the version's own
// migrations with sequences of its own, so nothing done there advances a sequence on the real floor
function testSchema(company, mod) { return `tst_${ident(company)}_${ident(mod)}`; }

// ---- validation -----------------------------------------------------------
// The validator lives in src/migrationsql.js (pure, so the module gate and the tests use it). What it passes is a
// list of statements; applyMigrations runs exactly those, one at a time, and never the file (2026-09-28: the file
// used to run whole, so a second statement on the same line as the first ran unchecked, with platform rights).
const { splitStatements, validateMigrationSql, statementProblem, stripLiterals } = require("./migrationsql");

// The rule got stricter on 2026-09-28. A file already applied to a tool's floor tables never runs there again
// (applyMigrations skips it), but it does run again when the test floor is rebuilt from the version's own migrations,
// when the tool is copied into another company, and every file of a version that has never been live runs at its
// first deploy. So at boot every migration file stored in any version is checked against the rule as it is now, and
// each one it would refuse is logged with whether the floor already has it. Never blocks anything; it tells Anetix
// which tool would need a new migration before one of those moments. -> { checked, refused: [...] }
async function auditStored() {
  const rows = (await q("SELECT company, module, version, files FROM platform.module_versions ORDER BY company, module, version")).rows;
  const byFile = new Map();
  for (const r of rows) {
    for (const [rel, text] of Object.entries(r.files || {})) {
      if (!/^migrations\/[^/]+\.sql$/.test(rel) || typeof text !== "string") continue;
      const key = `${r.company}\u0000${r.module}\u0000${rel}\u0000${text}`;
      if (!byFile.has(key)) byFile.set(key, { company: r.company, module: r.module, file: rel, text, versions: [] });
      byFile.get(key).versions.push(r.version);
    }
  }
  const refused = [];
  for (const f of byFile.values()) {
    const v = validateMigrationSql(f.text);
    if (v.ok) continue;
    const name = f.file.replace(/^migrations\//, "");
    const onFloor = await q(`SELECT 1 FROM ${liveSchema(f.company, f.module)}._migrations WHERE file=$1`, [name]).then((x) => x.rows.length > 0).catch(() => false);
    refused.push({ company: f.company, module: f.module, file: f.file, versions: f.versions, on_floor: onFloor, why: v.errors.slice(0, 3) });
  }
  console.log(`[migrate] audit: ${byFile.size} stored migration file(s) checked against the rule as it is now; ${refused.length ? `${refused.length} it would refuse` : "every one passes"}`);
  for (const r of refused) console.warn(`[migrate] audit: ${r.company}/${r.module} ${r.file} (v${r.versions.join(", v")}; ${r.on_floor ? "already on the floor tables, runs again only on a test floor rebuild or a copy" : "NOT applied to the floor yet: its next deploy stops here"}): ${r.why.join(" | ")}`);
  if (refused.length) await logEvent("migration_audit", "instance", { checked: byFile.size, refused: refused.map(({ why, ...rest }) => ({ ...rest, why })) });
  return { checked: byFile.size, refused };
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
      // plain '...' text reads no backslash escapes, as the splitter assumed
      await client.query("SET LOCAL standard_conforming_strings TO on");
      // exactly what was validated, one statement at a time; the extended protocol refuses a text with two commands in it
      for (const st of v.statements) await client.query({ text: st, queryMode: "extended" });
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
// Built from the same statements the validator reads (2026-09-28): until then a regex ran over the raw file, so an
// index statement written INSIDE a seed row's text was found and run here, unchecked. Now a CREATE INDEX is replayed
// only when it is a statement of its own that the validator passes, as written; a UNIQUE constraint only from bare
// names (the constraint, the table, the columns), whatever the statement around it says.
const identList = (s) => {
  const cols = String(s || "").split(",").map((c) => c.trim()).filter(Boolean);
  return cols.length && cols.every((c) => /^[a-z_][a-z0-9_]*$/i.test(c)) ? cols.join(", ") : null;
};
function bodyAfter(text, open) {
  let depth = 1, i = open;
  while (i < text.length && depth > 0) { if (text[i] === "(") depth++; else if (text[i] === ")") depth--; i++; }
  return text.slice(open, i - 1);
}
function declaredIndexes(sql) {
  const out = [];
  let m;
  for (const st of splitStatements(sql).statements) {
    const bare = stripLiterals(st);
    if ((m = /^CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)\s+ON\s+/i.exec(bare))) {
      if (statementProblem(st)) continue;
      out.push({ name: m[2], exec: st.replace(/^CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?/i, (x, u) => `CREATE ${u ? "UNIQUE " : ""}INDEX IF NOT EXISTS `) });
      continue;
    }
    const alt = /^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?([a-z_][a-z0-9_]*)\b/i.exec(bare);
    if (alt) {
      const re = /\bADD\s+CONSTRAINT\s+([a-z_][a-z0-9_]*)\s+UNIQUE\s*\(([^)]*)\)/gi;
      while ((m = re.exec(bare))) { const cols = identList(m[2]); if (cols) out.push({ name: m[1], exec: `ALTER TABLE ${alt[1]} ADD CONSTRAINT ${m[1]} UNIQUE (${cols})` }); }
      continue;
    }
    const tb = /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)\s*\(/i.exec(bare);
    if (tb) {
      const body = bodyAfter(bare, tb[0].length);
      const con = /(?:CONSTRAINT\s+([a-z_][a-z0-9_]*)\s+)?\bUNIQUE\s*\(([^)]*)\)/gi;
      while ((m = con.exec(body))) {
        const cols = identList(m[2]);
        if (!cols) continue;
        if (m[1]) out.push({ name: m[1], exec: `ALTER TABLE ${tb[1]} ADD CONSTRAINT ${m[1]} UNIQUE (${cols})` });
        else out.push({ name: null, table: tb[1], cols, exec: `ALTER TABLE ${tb[1]} ADD UNIQUE (${cols})` });
      }
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
    await client.query("SET LOCAL standard_conforming_strings TO on");
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
        await client.query({ text: w.exec, queryMode: "extended" });
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

// ---- the test floor's tables (docs/TEST-ENVIRONMENT.md) --------------------
// Built FROM THE VERSION'S OWN MIGRATIONS on an empty schema (so every serial
// column has a sequence of its own; the staging clone's LIKE ... INCLUDING ALL
// keeps the floor's), then filled one of three ways:
//   source "floor"  every row of the floor's table (the columns the two have
//                   in common), sequences set past the copied ids
//   source "made"   the rows given (validated against the real columns first;
//                   one bad column or value and nothing is written)
//   source "empty"  nothing but what the migrations seed
// -> { tables, rows: { table: n } }
const ROW_CAP = Number(process.env.SOS_CAMPAIGN_MAX_ROWS || 200);
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
// Pure: the problems with a made-up set against the tables and columns it will go into.
// columnsByTable: { table: [column names] }. -> [problem strings]
function rowsProblems(made, columnsByTable) {
  const out = [];
  if (!isObj(made)) return ["the rows are an object of tables, each a list of rows"];
  for (const [t, rows] of Object.entries(made)) {
    if (!/^[a-z_][a-z0-9_]*$/.test(t)) { out.push(`"${t}" is not a table name`); continue; }
    const cols = columnsByTable[t];
    if (!cols) { out.push(`there is no table named ${t}`); continue; }
    if (!Array.isArray(rows)) { out.push(`${t}: not a list of rows`); continue; }
    if (rows.length > ROW_CAP) out.push(`${t}: ${rows.length} rows; at most ${ROW_CAP}`);
    rows.slice(0, ROW_CAP).forEach((r, i) => {
      if (!isObj(r)) { out.push(`${t} row ${i + 1}: not an object of column: value`); return; }
      const bad = Object.keys(r).filter((k) => !cols.includes(k));
      if (bad.length) out.push(`${t} row ${i + 1}: no column named ${bad.join(", ")} (the columns are ${cols.join(", ")})`);
      for (const v of Object.values(r)) if (v !== null && typeof v === "object") { out.push(`${t} row ${i + 1}: a value is a nested object; give plain values`); break; }
    });
  }
  return out.slice(0, 20);
}
async function columnsByTable(schema) {
  const rows = (await q("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name <> '_migrations' ORDER BY table_name, ordinal_position", [schema])).rows;
  const out = {};
  for (const r of rows) (out[r.table_name] = out[r.table_name] || []).push(r.column_name);
  return out;
}
async function setSequencesPastData(client, schema) {
  const cols = (await client.query(
    `SELECT table_name, column_name, column_default FROM information_schema.columns WHERE table_schema=$1 AND column_default LIKE 'nextval(%'`, [schema])).rows;
  for (const c of cols) {
    const m = /nextval\('([^']+)'/.exec(c.column_default || "");
    if (!m) continue;
    await client.query(`SELECT setval('${m[1]}', COALESCE((SELECT MAX(${c.column_name}) FROM ${schema}.${c.table_name}), 0) + 1, false)`);
  }
}
async function buildTestSchema(company, mod, versionDir, { source = "floor", rows = null } = {}) {
  const schema = testSchema(company, mod), live = liveSchema(company, mod);
  await q(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await applyMigrations(schema, versionDir);   // makes the schema, the tables, their own sequences, the seed rows
  const tables = (await tablesIn(schema)).filter((t) => t !== "_migrations");
  const counts = {};
  if (source === "made") {
    const cols = await columnsByTable(schema);
    const problems = rowsProblems(rows || {}, cols);
    if (problems.length) { const e = new Error(`the made-up rows do not fit this tool's tables: ${problems.join("; ")}`); e.problems = problems; throw e; }
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (source === "floor") {
      const liveTables = new Set(await tablesIn(live));
      for (const t of tables) {
        if (!liveTables.has(t)) continue;
        const a = (await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2", [schema, t])).rows.map((r) => r.column_name);
        const b = new Set((await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2", [live, t])).rows.map((r) => r.column_name));
        const common = a.filter((c) => b.has(c));
        if (!common.length) continue;
        await client.query(`TRUNCATE ${schema}.${t}`);   // the migrations' seed rows are on the floor too; the floor's copy is the one that counts
        const r = await client.query(`INSERT INTO ${schema}.${t} (${common.join(", ")}) SELECT ${common.join(", ")} FROM ${live}.${t}`);
        counts[t] = r.rowCount;
      }
    } else if (source === "made") {
      for (const [t, list] of Object.entries(rows || {})) {
        await client.query(`TRUNCATE ${schema}.${t}`);
        let n = 0;
        for (const row of list.slice(0, ROW_CAP)) {
          const keys = Object.keys(row);
          if (!keys.length) continue;
          await client.query(`INSERT INTO ${schema}.${t} (${keys.join(", ")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")})`, keys.map((k) => row[k]));
          n++;
        }
        counts[t] = n;
      }
    }
    await setSequencesPastData(client, schema);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  await logEvent("test_schema_built", `${company}/${mod}`, { source, tables, rows: counts });
  return { tables, rows: counts };
}
async function dropTestSchema(company, mod) { await q(`DROP SCHEMA IF EXISTS ${testSchema(company, mod)} CASCADE`); }

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
  liveSchema, stagingSchema, testSchema, schemaClash, freeToolSlug, ident, buildTestSchema, dropTestSchema, rowsProblems, columnsByTable, ROW_CAP, setSequencesPastData,
  validateMigrationSql, applyMigrations, auditStored, splitStatements,
  rebuildStagingClone, snapshotSchema, recordSnapshot, restoreSnapshot, tablesIn, columnsOf,
  indexShape, indexOnLive, ensureIndexes, declaredIndexes,
};
