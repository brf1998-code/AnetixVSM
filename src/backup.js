// Whole-instance backup and restore, as one JSON document.
//
// Everything that matters lives in Postgres: the platform tables (companies,
// module versions with their files, feedback, runs, docs, reviews, diagrams)
// and every company's live module schema (mod_*). The backup carries the rows
// of all of them plus enough DDL (columns, sequences, constraints, indexes) to
// rebuild the module schemas from nothing. Staging clones and snapshots are
// rebuilt by the platform as needed and are left out.
//
// Restore replaces everything, then the process exits so Railway restarts it
// and boot re-materializes versions and mounts from the restored rows.
const { q, pool } = require("./db");

// Every platform table a restore refills. The dump takes all of them on its
// own; until 2026-09-19 this list had fallen behind it, so a restore brought
// back feedback and runs but left the module intakes, their attachments, the
// checks log labels and replays as they were. Keep it in step with db.js.
const PLATFORM_TABLES = [
  "companies", "company_access", "settings", "modules", "module_versions", "feedback", "proposals", "build_runs",
  "agent_docs", "reviews", "diagrams", "events", "schema_snapshots", "batches", "ai_usage",
  "module_intakes", "attachments", "check_labels", "check_replays", "record",
  "connections", "connection_uploads", "print_jobs", "erp_cache", "data_requests", "people", "check_retirements", "ai_credit",
  "model_arms", "assessments", "assessment_trials", "assessment_picks",
  "test_floors",   // the test floor's switch state and data set (src/testfloor.js); its tst_ tables are a copy and are rebuilt at boot, never dumped
  "access_pins", "self_serve", "credit_ledger",   // self-serve companies from anetix.ai: the pins, who came in, every dollar of credit (src/selfserve.js)
  "demo_requests",  // who asked for a demo on anetix.ai, and the pin made for them (src/demorequests.js)
  "sample_fills",   // a demo's sample data: what each fill put in, so Clear still takes out exactly those rows after a restore (src/sample.js)
  "price_books", "sites",   // paid sites: the price book's versions and the pipeline (src/sites.js)
];
// The admin accounts (src/accounts.js), parents first: the two others point at accounts. They travel with the backup
// so a restore does not lock every admin out: password hashes, authenticator secrets encrypted under
// SOS_CONNECTION_KEY, recovery codes as hashes. Restored only when the file carries them (see restore()).
const ACCOUNT_TABLES = ["accounts", "account_factors", "account_recovery_codes", "account_passkeys"];   // passkeys (src/passkeys.js) travel with the account they sign in to
// Never in the file: who tried to sign in from where. It is a log of this instance, and it names addresses.
const NOT_IN_BACKUP = ["auth_events", "admin_devices"];   // the sign-in log and the trusted devices are this instance's, never a file's

async function columnInfo(schema, table) {
  return (await q(
    `SELECT column_name, data_type, udt_name, column_default, is_nullable, character_maximum_length, numeric_precision, numeric_scale
       FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position`, [schema, table])).rows;
}

function typeSql(c) {
  if (c.data_type === "ARRAY") return `${c.udt_name.replace(/^_/, "")}[]`;
  if (c.data_type === "numeric" && c.numeric_precision) return `numeric(${c.numeric_precision},${c.numeric_scale || 0})`;
  if (c.data_type === "character varying" && c.character_maximum_length) return `varchar(${c.character_maximum_length})`;
  if (c.data_type === "USER-DEFINED") return c.udt_name;
  return c.data_type;
}

async function dumpSchema(schema, withDdl) {
  const tables = (await q("SELECT tablename FROM pg_tables WHERE schemaname=$1 ORDER BY tablename", [schema])).rows.map((r) => r.tablename)
    .filter((t) => schema !== "platform" || !NOT_IN_BACKUP.includes(t));
  const out = { tables: {} };
  if (withDdl) {
    out.sequences = (await q("SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema=$1", [schema])).rows.map((r) => r.sequence_name);
    out.ddl = {};
  }
  for (const t of tables) {
    const rows = (await q(`SELECT * FROM ${schema}.${t}`)).rows;
    out.tables[t] = rows;
    if (withDdl) {
      const cols = await columnInfo(schema, t);
      const cons = (await q(
        `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = ($1||'.'||$2)::regclass AND contype IN ('p','u','c','f') ORDER BY contype`, [schema, t])).rows;
      const idx = (await q("SELECT indexname, indexdef FROM pg_indexes WHERE schemaname=$1 AND tablename=$2", [schema, t])).rows
        .filter((i) => !cons.some((c) => c.conname === i.indexname));
      out.ddl[t] = { columns: cols, constraints: cons, indexes: idx };
    }
  }
  return out;
}

async function dump() {
  const platform = await dumpSchema("platform", false);
  const mods = (await q("SELECT nspname FROM pg_namespace WHERE nspname LIKE 'mod\\_%' ORDER BY nspname")).rows.map((r) => r.nspname);
  const schemas = {};
  for (const s of mods) schemas[s] = await dumpSchema(s, true);
  return { format: "sos-backup-1", taken_at: new Date().toISOString(), platform: platform.tables, schemas };
}

function jsonbColumns(cols) { return new Set(cols.filter((c) => c.data_type === "jsonb" || c.data_type === "json").map((c) => c.column_name)); }
// A binary column (an attachment's bytes) arrives from JSON as { type: "Buffer", data: [...] }.
function byteaColumns(cols) { return new Set(cols.filter((c) => c.data_type === "bytea").map((c) => c.column_name)); }
function toBytes(v) { return v && v.type === "Buffer" && Array.isArray(v.data) ? Buffer.from(v.data) : typeof v === "string" ? Buffer.from(v, "base64") : v; }

async function insertRows(client, schema, table, rows, cols) {
  if (!rows.length) return;
  const names = cols.map((c) => c.column_name).filter((n) => Object.prototype.hasOwnProperty.call(rows[0], n));
  const jb = jsonbColumns(cols), bin = byteaColumns(cols);
  const casts = names.map((n, i) => (jb.has(n) ? `$${i + 1}::jsonb` : `$${i + 1}`));
  const sql = `INSERT INTO ${schema}.${table} (${names.join(",")}) VALUES (${casts.join(",")})`;
  for (const r of rows) {
    await client.query(sql, names.map((n) => (jb.has(n) && r[n] != null ? JSON.stringify(r[n]) : bin.has(n) && r[n] != null ? toBytes(r[n]) : r[n])));
  }
}

async function resetSequences(client, schema) {
  const cols = (await client.query(
    `SELECT table_name, column_name, column_default FROM information_schema.columns WHERE table_schema=$1 AND column_default LIKE 'nextval(%'`, [schema])).rows;
  for (const c of cols) {
    const m = /nextval\('([^']+)'/.exec(c.column_default);
    if (m) await client.query(`SELECT setval('${m[1]}', COALESCE((SELECT MAX(${c.column_name}) FROM ${schema}.${c.table_name}), 0) + 1, false)`);
  }
}

async function restore(doc) {
  if (!doc || doc.format !== "sos-backup-1" || !doc.platform) throw new Error("not an Anetix backup file");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // module schemas: drop live, staging and snapshots, rebuild live from the backup's DDL
    const existing = (await client.query("SELECT nspname FROM pg_namespace WHERE nspname LIKE 'mod\\_%' OR nspname LIKE 'stg\\_%' OR nspname LIKE 'snap\\_%' OR nspname LIKE 'tst\\_%'")).rows.map((r) => r.nspname);
    for (const s of existing) await client.query(`DROP SCHEMA ${s} CASCADE`);
    for (const [schema, body] of Object.entries(doc.schemas || {})) {
      if (!/^mod_[a-z0-9_]+$/i.test(schema)) throw new Error(`bad schema name in backup: ${schema}`);
      await client.query(`CREATE SCHEMA ${schema}`);
      for (const seq of body.sequences || []) await client.query(`CREATE SEQUENCE ${schema}.${seq}`);
      for (const [t, ddl] of Object.entries(body.ddl || {})) {
        const defs = ddl.columns.map((c) => `${c.column_name} ${typeSql(c)}${c.column_default ? ` DEFAULT ${c.column_default}` : ""}${c.is_nullable === "NO" ? " NOT NULL" : ""}`);
        await client.query(`CREATE TABLE ${schema}.${t} (${defs.join(", ")})`);
      }
      // constraints after every table exists (foreign keys point across tables)
      for (const [t, ddl] of Object.entries(body.ddl || {})) {
        for (const c of ddl.constraints || []) await client.query(`ALTER TABLE ${schema}.${t} ADD CONSTRAINT ${c.conname} ${c.def}`);
      }
      for (const [t, rows] of Object.entries(body.tables || {})) await insertRows(client, schema, t, rows, (body.ddl[t] || {}).columns || []);
      for (const [t, ddl] of Object.entries(body.ddl || {})) for (const i of ddl.indexes || []) await client.query(i.indexdef);
      await resetSequences(client, schema);
    }
    // platform tables: wipe and refill (the schema itself stays; columns the
    // backup lacks keep their defaults, columns it has that we lack are skipped)
    // A backup from before named accounts has no account rows: the accounts on this instance stay as they are,
    // rather than a restore locking every admin out. A file that has them replaces them. Either way every account's
    // generation ends up above both what the file says and what this instance had, so a session that was signed out
    // everywhere after the backup was taken does not come back to life, and every admin signs in again after a restore.
    const withAccounts = Array.isArray(doc.platform.accounts);
    const restored = withAccounts ? PLATFORM_TABLES.concat(ACCOUNT_TABLES) : PLATFORM_TABLES;
    const generations = (await client.query("SELECT login, generation FROM platform.accounts")).rows;
    // trusted devices (src/devices.js) never travel and none survive a restore: the table goes with the accounts
    // (it references them) and is wiped even when the file has no accounts, since every generation moves anyway
    await client.query(`TRUNCATE ${restored.map((t) => "platform." + t).concat(["platform.admin_devices"]).join(", ")}`);
    for (const t of restored) {
      let rows = doc.platform[t] || [];
      // a backup from before per-company passwords has no login rows: its companies go back on the shared passwords
      if (t === "company_access" && !doc.platform[t]) rows = (doc.platform.companies || []).map((c) => ({ company: c.slug, legacy_login: true }));
      const cols = (await client.query(
        "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='platform' AND table_name=$1 ORDER BY ordinal_position", [t])).rows;
      await insertRows(client, "platform", t, rows, cols);
    }
    // snapshots referenced schemas we just dropped
    for (const g of generations) await client.query("UPDATE platform.accounts SET generation=GREATEST(generation, $2) WHERE login=$1", [g.login, g.generation]);
    await client.query("UPDATE platform.accounts SET generation=generation+1");
    await client.query("TRUNCATE platform.schema_snapshots");
    await client.query("UPDATE platform.modules SET staged_version=NULL");
    await resetSequences(client, "platform");
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally { client.release(); }
}

module.exports = { dump, restore };
