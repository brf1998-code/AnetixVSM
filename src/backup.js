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
  "demo_stops",     // a demo's builds that stopped before a preview, and what was done about each (src/demostops.js)
  "sample_fills",   // a demo's sample data: what each fill put in, so Clear still takes out exactly those rows after a restore (src/sample.js)
  "price_books", "sites", "orders", "terms_versions",   // paid sites: the price book's versions, the pipeline (src/sites.js), the orders and the terms as signed (src/golive.js)
  "acceptances", "notices", "billing_events",   // stage 3: every acceptance of the Terms (src/agreements.js), the managers' notices (src/notices.js), Stripe's events as applied (src/activate.js)
  "connection_allowances",   // which outside connections Anetix turned on for which tool (src/connections.js)
  "web_jobs",   // each look-up a tool asked of the web, and what came back (src/connections.js, the web kind)
  "assist_conversations", "assist_messages",   // Ask Anetix: what each manager asked and was answered, the request cards (src/assist.js)
  "library_templates", "library_copies",   // the tool library across companies: templates, and which company got a copy of what (src/library.js)
  "vsm_stages", "vsm_maps", "vsm_nodes", "vsm_edges", "vsm_questions", "vsm_kaizen", "module_use",   // the value stream map: stages, maps (before the rows that point at them), boxes, flows, review questions, kaizen, each tool's daily use (src/vsm.js)
  "vsm_walks", "vsm_sources",   // the mapping walks and what went into each (before the sources that point at them); their files are attachments (src/vsm-walk.js)
  "vsm_agents", "vsm_watches", "vsm_messages", "vsm_flags",   // the agent board: agents (before the watches that point at them), watches, the board's messages, flags (src/vsm-agents.js)
  "vsm_agent_settings", "vsm_reviews", "vsm_drafts",   // the agents' shift times, their reviews (after the agents they point at), draft request cards (src/vsm-review.js)
];
// The admin accounts (src/accounts.js), parents first: the two others point at accounts. They travel with the backup
// so a restore does not lock every admin out: password hashes, authenticator secrets encrypted under
// SOS_CONNECTION_KEY, recovery codes as hashes. Restored only when the file carries them (see restore()).
const ACCOUNT_TABLES = ["accounts", "account_factors", "account_recovery_codes", "account_passkeys", "account_identities"];   // passkeys (src/passkeys.js) and connected Google or Microsoft identities (src/oidc.js) travel with the account they sign in to
// Never in the file: who tried to sign in from where. It is a log of this instance, and it names addresses.
const NOT_IN_BACKUP = ["auth_events", "admin_devices", "pin_refusals", "manager_invites", "signin_tickets",   // (manager_invites, src/managers.js: a restore ends pending invitations, and they are made again)
     // the sign-in log, the trusted devices, the refused pins and the one-time sign-ins from demo setup are this instance's, never a file's
  "mcp_clients", "mcp_grants", "mcp_tokens", "mcp_codes", "mcp_calls",   // connected AI apps, their tokens (hashes) and what they asked (src/mcpauth.js, src/mcp.js): a restore ends every connection, and each app is connected again
  "assist_calls"];   // Ask Anetix's audit of every tool call (src/assist.js): this instance's log, like mcp_calls

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

// Evidence the Terms say is kept (10.7: every acceptance; Stripe's events as applied; the words of each terms version as
// first signed): a restore adds the file's rows to what this instance holds and never takes one away. The key says when a
// file's row is one the instance already has; an acceptance the instance lacks gets a new id (its old one may be taken).
const MERGED = { acceptances: { key: ["company", "kind", "at", "terms_sha256"], newId: true }, billing_events: { key: ["stripe_event"] }, terms_versions: { key: ["version"] } };
async function mergeRows(client, table, rows, cols, { key, newId }) {
  const types = Object.fromEntries(cols.map((c) => [c.column_name, c.data_type]));
  if (!rows.length || key.some((k) => !types[k])) return 0;
  const jb = jsonbColumns(cols);
  let added = 0;
  for (const r of rows) {
    if (key.some((k) => r[k] == null)) continue;
    // a time comes back from the file to the millisecond (JavaScript's Date) while the database kept microseconds
    const same = (k, i) => (/^timestamp/.test(types[k]) ? `abs(extract(epoch FROM (${k} - $${i + 1}::${types[k]}))) < 0.001` : `${k} = $${i + 1}::${types[k]}`);
    const seen = await client.query(`SELECT 1 FROM platform.${table} WHERE ${key.map(same).join(" AND ")} LIMIT 1`, key.map((k) => r[k]));
    if (seen.rows.length) continue;
    const names = Object.keys(r).filter((n) => types[n] && !(newId && n === "id"));
    await client.query(`INSERT INTO platform.${table} (${names.join(",")}) VALUES (${names.map((n, i) => (jb.has(n) ? `$${i + 1}::jsonb` : `$${i + 1}`)).join(",")})`,
      names.map((n) => (jb.has(n) && r[n] != null ? JSON.stringify(r[n]) : r[n])));
    added++;
  }
  return added;
}

async function restore(doc, { notice = null, paying = ["subscribed", "activating"] } = {}) {
  if (!doc || doc.format !== "sos-backup-1" || !doc.platform) throw new Error("not an Anetix backup file");
  let told = [];
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
    const restored = (withAccounts ? PLATFORM_TABLES.concat(ACCOUNT_TABLES) : PLATFORM_TABLES).filter((t) => !MERGED[t]);
    const generations = (await client.query("SELECT login, generation FROM platform.accounts")).rows;
    // trusted devices (src/devices.js) never travel and none survive a restore: the table goes with the accounts
    // (it references them) and is wiped even when the file has no accounts, since every generation moves anyway
    await client.query(`TRUNCATE ${restored.map((t) => "platform." + t).concat(["platform.admin_devices", "platform.mcp_tokens", "platform.mcp_codes", "platform.mcp_grants", "platform.manager_invites", "platform.signin_tickets"]).join(", ")}`);   // each points at accounts, so it is cleared with them
    for (const t of restored) {
      let rows = doc.platform[t] || [];
      // a backup from before per-company passwords has no login rows: its companies go back on the shared passwords
      if (t === "company_access" && !doc.platform[t]) rows = (doc.platform.companies || []).map((c) => ({ company: c.slug, legacy_login: true }));
      const cols = (await client.query(
        "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='platform' AND table_name=$1 ORDER BY ordinal_position", [t])).rows;
      await insertRows(client, "platform", t, rows, cols);
    }
    for (const [t, how] of Object.entries(MERGED)) {
      const cols = (await client.query(
        "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='platform' AND table_name=$1 ORDER BY ordinal_position", [t])).rows;
      if (cols.length) await mergeRows(client, t, doc.platform[t] || [], cols, how);
    }
    // snapshots referenced schemas we just dropped
    for (const g of generations) await client.query("UPDATE platform.accounts SET generation=GREATEST(generation, $2) WHERE login=$1", [g.login, g.generation]);
    await client.query("UPDATE platform.accounts SET generation=generation+1");
    await client.query("TRUNCATE platform.schema_snapshots");
    await client.query("UPDATE platform.modules SET staged_version=NULL");
    await resetSequences(client, "platform");
    // the customers' managers are told (the Terms, 9.1): a notice on every paying site's board in the restored data
    // (after the sequences are reset, or the new notice's id could be one the file's notices already use)
    if (notice && notice.text) {
      told = (await client.query("SELECT company FROM platform.sites WHERE stage = ANY($1)", [paying])).rows.map((r) => r.company);
      for (const co of told) await client.query("INSERT INTO platform.notices (company, kind, text, detail) VALUES ($1, 'tool_changed', $2, $3)", [co, String(notice.text).slice(0, 1000), JSON.stringify({ why: notice.why || null, restore: true, taken_at: doc.taken_at || null })]);
    }
    await client.query("COMMIT");
    return { told };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally { client.release(); }
}

module.exports = { dump, restore, MERGED };
