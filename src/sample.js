// Sample data for a demo's tools (Brendan, 2026-09-26: "a feature for demos to simulate data for the current build so
// they can get a better representation of what it does"). His choices: demo companies only, the rows go into the tool
// itself and its build preview, a filled snapshot (not live motion), paid from the demo's own credit.
//
// Fill: the AI reads the tool's design (reference.md), its tables (the migrations and the columns as they stand) and
// its code, and writes about a week of made-up history plus work in progress now, in the tool's own words. It never
// reads a row of the company's data (the data wall has nothing to guard here, but the call still goes through
// agent.atWall like every other). The rows are checked against the real columns (migrate.rowsProblems) and go in
// parent tables first. A number the database makes (a serial or identity key) is never taken from the AI: its ids are
// placeholders, remapped to the real ones, and every column that points at them (a foreign key, or a <thing>_id
// column naming a table in the set) follows. A row that does not fit (a unique clash, a check) is left out, and so is
// every row that pointed at it, so a sample row never lands on one of the person's own.
//
// Where: the schema of the newest version decides the columns (the staged one while a build waits at the gate, else
// the live one). The rows go into the live tables when the tool is live, and the same rows, same keys, into the
// preview's copy (stg_) when a build waits. A table or column only the waiting build has is filled in the preview
// now and in the live tables when that build is deployed (afterDeploy, from the registry's deployed hook); a first
// build that is not live yet is filled in its preview and carried to the floor the same way. Every later preview is
// cloned from live, so the rows follow.
//
// Clear: takes out exactly the rows the fill put in, by their keys, from live and the preview: never anything the
// person typed. A sample row that something of the person's now points at (a note on a sample order) is kept, and
// the panel says how many.
//
// platform.sample_fills: one row per fill. status writing | in | cleared | failed. One fill in force per tool; a new
// one replaces it (the old rows are cleared first). Record kinds: sample_filled, sample_cleared.
//
// Routes (manager of a demo company; any other company: 404):
//   GET  /api/c/:slug/modules/:mod/sample            the fill in force, or the one being written
//   POST /api/c/:slug/modules/:mod/sample            { replace? }   start a fill (answers at once; the panel polls)
//   POST /api/c/:slug/modules/:mod/sample/clear      take the sample rows out
const express = require("express");
const { q, pool, logEvent } = require("./db");
const { requireManager } = require("./auth");
const { record, actor } = require("./record");
const agent = require("./agent");
const registry = require("./registry");
const migrate = require("./migrate");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS platform.sample_fills (
  id          SERIAL PRIMARY KEY,
  company     TEXT NOT NULL,
  module      TEXT NOT NULL,
  version     INTEGER,
  status      TEXT NOT NULL DEFAULT 'writing',
  story       TEXT,
  rows        JSONB,          -- { table: [ the rows as they went in, keys and all ] }, in the order they went in
  plan        JSONB,          -- { order: [tables], keys: { table: [pk columns] }, live_cols: { table: [columns live had] }, pending: [tables not in live yet] }
  in_live     BOOLEAN NOT NULL DEFAULT false,
  in_preview  BOOLEAN NOT NULL DEFAULT false,
  skipped     INTEGER NOT NULL DEFAULT 0,
  kept        INTEGER NOT NULL DEFAULT 0,
  cost_usd    NUMERIC NOT NULL DEFAULT 0,
  model       TEXT,
  error       TEXT,
  made_by     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  cleared_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS sample_fills_mod ON platform.sample_fills (company, module, id);`;
async function init() {
  await q(SCHEMA);
  // a fill that was being written when the platform restarted never finishes
  await q("UPDATE platform.sample_fills SET status='failed', error='the platform restarted while the sample data was being written; nothing was put in' WHERE status='writing'");
}

const PER_TABLE = Number(process.env.SOS_SAMPLE_MAX_ROWS || 60);
const fail = (status, msg) => Object.assign(new Error(msg), { status });
const qi = (s) => `"${String(s).replace(/"/g, '""')}"`;
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// ---- what the tables look like ------------------------------------------------------------------------------------
async function schemaExists(schema) {
  return Boolean((await q("SELECT 1 FROM pg_namespace WHERE nspname=$1", [schema])).rows[0]);
}
// { table: [ { name, type, nullable, default, identity } ] }
async function columnsOf(schema) {
  const rows = (await q(`SELECT table_name, column_name, data_type, is_nullable, column_default, is_identity
    FROM information_schema.columns WHERE table_schema=$1 AND table_name <> '_migrations' AND table_name NOT LIKE '\\_%' ORDER BY table_name, ordinal_position`, [schema])).rows;
  const out = {};
  for (const r of rows) (out[r.table_name] = out[r.table_name] || []).push({ name: r.column_name, type: r.data_type, nullable: r.is_nullable === "YES", default: r.column_default, identity: r.is_identity === "YES" });
  return out;
}
async function keysOf(schema) {
  const pks = (await q(`SELECT tc.relname::text AS tbl, array_agg(a.attname::text ORDER BY k.ord) AS cols
    FROM pg_constraint c JOIN pg_class tc ON tc.oid=c.conrelid JOIN pg_namespace n ON n.oid=tc.relnamespace
    JOIN LATERAL unnest(c.conkey) WITH ORDINALITY k(attnum, ord) ON true
    JOIN pg_attribute a ON a.attrelid=tc.oid AND a.attnum=k.attnum
    WHERE c.contype='p' AND n.nspname=$1 GROUP BY tc.relname`, [schema])).rows;
  const fks = (await q(`SELECT tc.relname::text AS tbl, a.attname::text AS col, rc.relname::text AS ref_tbl, ra.attname::text AS ref_col, array_length(c.conkey, 1) AS n
    FROM pg_constraint c JOIN pg_class tc ON tc.oid=c.conrelid JOIN pg_namespace ns ON ns.oid=tc.relnamespace
    JOIN pg_class rc ON rc.oid=c.confrelid
    JOIN LATERAL unnest(c.conkey) WITH ORDINALITY k(attnum, ord) ON true
    JOIN LATERAL unnest(c.confkey) WITH ORDINALITY f(attnum, ord) ON f.ord=k.ord
    JOIN pg_attribute a ON a.attrelid=tc.oid AND a.attnum=k.attnum
    JOIN pg_attribute ra ON ra.attrelid=rc.oid AND ra.attnum=f.attnum
    WHERE c.contype='f' AND ns.nspname=$1`, [schema])).rows;
  const pk = {}; for (const r of pks) pk[r.tbl] = r.cols;
  const fk = {}; for (const r of fks) if (Number(r.n) === 1) (fk[r.tbl] = fk[r.tbl] || []).push({ col: r.col, table: r.ref_tbl, column: r.ref_col });
  return { pk, fk };
}
// Parents before children (a cycle, or a table pointing at itself, just keeps its place). extra: { table: [tables it
// points at without a constraint] } (the <thing>_id columns, see pointers). Pure.
function fkOrder(tables, fk, extra = {}) {
  const out = [], seen = new Set(), busy = new Set();
  const visit = (t) => {
    if (seen.has(t) || busy.has(t)) return;
    busy.add(t);
    for (const p of [...(fk[t] || []).map((f) => f.table), ...(extra[t] || [])]) if (p !== t && tables.includes(p)) visit(p);
    busy.delete(t); seen.add(t); out.push(t);
  };
  for (const t of tables) visit(t);
  return out;
}
// The key the database makes for a table, if it has one: a one-column primary key with a sequence or identity.
function madeKey(table, cols, pk) {
  const k = pk[table];
  if (!k || k.length !== 1) return null;
  const c = (cols[table] || []).find((x) => x.name === k[0]);
  return c && (c.identity || /^nextval\(/.test(String(c.default || ""))) ? c.name : null;
}
// The columns of a table that point at another table's made key: its foreign keys, and a "<thing>_id" column with no
// constraint whose <thing> (or <thing>s, <thing>es) is a table with a made key. -> { col: table }. Pure.
function pointers(table, cols, keys, made) {
  const out = {};
  for (const f of keys.fk[table] || []) if (made[f.table] && made[f.table] === f.column) out[f.col] = f.table;
  for (const c of cols[table] || []) {
    const m = /^(.+)_id$/.exec(c.name);
    if (!m || out[c.name]) continue;
    const hit = [m[1], `${m[1]}s`, `${m[1]}es`].find((t) => made[t] && t !== table);
    if (hit && !(keys.fk[table] || []).some((f) => f.col === c.name)) out[c.name] = hit;
  }
  return out;
}

// ---- the AI's rows ---------------------------------------------------------------------------------------------------
const FILL_SCHEMA = {
  type: "object",
  properties: {
    story: { type: "string", description: "One or two plain sentences a plant manager would read: the made-up week these rows tell (who, what was made, what is going on right now). No dashes." },
    tables: { type: "object", description: "{ \"<table>\": [ { \"<column>\": value, ... } ] }. Only tables and columns that exist. Plain values only (text, numbers, true/false, null, ISO timestamps).", additionalProperties: { type: "array", items: { type: "object" } } },
  },
  required: ["story", "tables"],
};
const clipText = (s, n) => (s.length > n ? `${s.slice(0, n)}\n... (cut)` : s);
// The tool as the AI sees it: the design, the migrations, the columns, the code (routes first, then pages), within a budget.
async function toolContext(company, mod, version, cols, keys) {
  const files = (await registry.versionFiles(company, mod, version)) || {};
  const ref = (await q("SELECT content FROM platform.agent_docs WHERE company=$1 AND module=$2 AND name='reference.md'", [company, mod])).rows[0];
  const migrations = Object.keys(files).filter((f) => /^migrations\/.*\.sql$/.test(f)).sort().map((f) => `-- ${f}\n${files[f]}`).join("\n\n");
  const code = Object.keys(files).filter((f) => /\.(js|html)$/.test(f) && !/^checks\//.test(f)).sort((a, b) => (/routes/.test(b) ? 1 : 0) - (/routes/.test(a) ? 1 : 0) || a.localeCompare(b));
  let budget = 45000, codeText = "";
  for (const f of code) { if (budget <= 0) break; const part = clipText(String(files[f]), Math.min(budget, 20000)); codeText += `\n\n--- ${f}\n${part}`; budget -= part.length; }
  const colText = Object.entries(cols).map(([t, list]) => {
    const made = madeKey(t, cols, keys.pk);
    return `${t}: ${list.map((c) => `${c.name} ${c.type}${c.nullable ? "" : " not null"}${c.name === made ? " (key the database makes: give 1, 2, 3 as placeholders)" : c.default ? " (has a default)" : ""}`).join(", ")}${(keys.fk[t] || []).length ? `\n  points at: ${keys.fk[t].map((f) => `${f.col} -> ${f.table}.${f.column}`).join(", ")}` : ""}`;
  }).join("\n");
  return { ref: ref ? clipText(String(ref.content), 12000) : "", migrations: clipText(migrations, 20000), codeText, colText };
}
async function writeRows(company, mod, version, cols, keys, title, problemsBefore) {
  const model = await agent.modelFor(company, "propose");
  const ctx = await toolContext(company, mod, version, cols, keys);
  const now = new Date();
  const system = `You write sample data for a demo of a small tool that runs a job on a factory floor. The person trying the demo has no data of their own yet; your rows go straight into the tool's own tables so every screen and number shows what the tool does with a normal week of work in it. Write in the tool's own words: the stages, statuses, stations and names its code and design use, exactly as spelled there. Everything is made up; never a real company's or real person's name.`;
  const prompt = `The tool is "${title}".

${ctx.ref ? `Its design:\n${ctx.ref}\n\n` : ""}Its tables, as they stand:
${ctx.colText}

The migrations that made them:
${ctx.migrations}

Its code (so the values are the ones the screens and rules expect):${ctx.codeText || " (none stored)"}

Write the rows:
1. About a week of history ending now (${now.toISOString()}), plus the work in progress right now, so every screen has something on it: finished items, items at each stage, something late or stuck, a few recent events. Timestamps are ISO with a time zone, spread over working hours.
2. Between 5 and ${Math.min(40, PER_TABLE)} rows a table for the tables the screens read; a table the migrations already fill with fixed values (a list of stations, say) needs rows only if more make sense. Never more than ${PER_TABLE}.
3. A key the database makes: give 1, 2, 3 ... per table as placeholders and use those same numbers in the columns that point at it. Leave out a column with a default unless the value matters to the story.
4. Only the tables and columns listed. Plain values. Values that meet every check and "not null" in the migrations.
5. The story: one or two plain sentences on what the week was like.${problemsBefore ? `\n\nAn earlier try did not fit the tables:\n${problemsBefore.join("\n")}\nFix those.` : ""}`;
  if (agent.fakeMode()) {
    await agent.atWall("structured:sample_data", { company, model, system, prompt });
    return { data: fakeRows(cols, keys), costUsd: 0, model };
  }
  const { data, costUsd } = await agent.runStructured({ model, company, system, prompt, schema: FILL_SCHEMA, toolName: "sample_data", maxTokens: 16000 });
  return { data, costUsd, model };
}
// Fake mode: rows from the column types alone, the same every time. Pure.
function fakeRows(cols, keys) {
  const made = {}; for (const t of Object.keys(cols)) made[t] = madeKey(t, cols, keys.pk);
  const order = fkOrder(Object.keys(cols), keys.fk), tables = {}, t0 = Date.UTC(2026, 8, 21, 13, 0);
  for (const t of order) {
    const ptr = pointers(t, cols, keys, made);
    tables[t] = Array.from({ length: 6 }, (_, i) => {
      const row = {};
      for (const c of cols[t]) {
        if (c.name === made[t]) { row[c.name] = i + 1; continue; }
        if (ptr[c.name]) { row[c.name] = (i % 3) + 1; continue; }
        const fk = (keys.fk[t] || []).find((f) => f.col === c.name);
        if (fk || (c.default && c.nullable)) continue;
        if (/int|numeric|double|real/.test(c.type)) row[c.name] = i + 1;
        else if (c.type === "boolean") row[c.name] = i % 2 === 0;
        else if (/timestamp/.test(c.type)) row[c.name] = new Date(t0 + i * 3600e3 * 7).toISOString();
        else if (c.type === "date") row[c.name] = new Date(t0 + i * 86400e3).toISOString().slice(0, 10);
        else if (/char|text/.test(c.type)) row[c.name] = `Sample ${c.name.replace(/_/g, " ")} ${i + 1}`;
      }
      return row;
    });
  }
  return { story: "Fake mode: six made-up rows a table from the column types alone. (SOS_FAKE_AGENT=1)", tables };
}

// ---- putting rows in ---------------------------------------------------------------------------------------------------
const hasIdentity = (list) => (list || []).some((c) => c.identity);
async function insertRow(client, schema, table, row, colList, { explicit = false } = {}) {
  const names = Object.keys(row).filter((k) => colList.some((c) => c.name === k));
  if (!names.length) return null;
  const sql = `INSERT INTO ${schema}.${qi(table)} (${names.map(qi).join(", ")}) ${explicit && hasIdentity(colList) ? "OVERRIDING SYSTEM VALUE " : ""}VALUES (${names.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`;
  await client.query("SAVEPOINT r");
  try {
    const r = await client.query(sql, names.map((k) => row[k]));
    await client.query("RELEASE SAVEPOINT r");
    return r.rows[0];
  } catch (e) {
    await client.query("ROLLBACK TO SAVEPOINT r");
    return null;
  }
}
// JSON-safe copy of a returned row (Dates as ISO strings)
const plainRow = (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]));

// The AI's rows into the primary schema (live, or the preview's for a first build), remapping made keys; then, when a
// build waits and the primary is live, the same rows with their real keys into the preview.
// -> { rows: { table: [rows] }, plan, skipped, counts }
async function putIn(company, mod, made0, { live, stg, liveOn, stgOn, genCols, keys }) {
  const primary = liveOn ? live : stg;
  const primCols = await columnsOf(primary);
  const made = {}; for (const t of Object.keys(genCols)) made[t] = madeKey(t, genCols, keys.pk);
  const links = Object.fromEntries(Object.keys(genCols).map((t) => [t, Object.values(pointers(t, genCols, keys, made))]));
  const order = fkOrder(Object.keys(made0).filter((t) => genCols[t]), keys.fk, links);
  const map = {};          // table -> Map(placeholder -> real key or null when the row was left out)
  const rows = {}, pending = [], liveCols = {};
  let skipped = 0;
  const client = await pool.connect();
  const stgClient = liveOn && stgOn ? await pool.connect() : null;
  try {
    await client.query("BEGIN");
    if (stgClient) await stgClient.query("BEGIN");
    const stgCols = stgClient ? await columnsOf(stg) : {};
    for (const t of order) {
      const inPrimary = Boolean(primCols[t]);
      const cl = inPrimary ? client : stgClient;
      if (!cl) { skipped += made0[t].length; continue; }
      if (!inPrimary) pending.push(t);
      else if (liveOn) liveCols[t] = primCols[t].map((c) => c.name);
      const ptr = pointers(t, genCols, keys, made);
      map[t] = new Map();
      rows[t] = [];
      for (const raw of made0[t].slice(0, PER_TABLE)) {
        const row = { ...raw };
        // a pointer at a row that was left out: this one is left out too; at a placeholder: the real key
        let orphan = false;
        for (const [c, target] of Object.entries(ptr)) {
          if (row[c] == null || !map[target]) continue;
          if (map[target].has(row[c])) { const real = map[target].get(row[c]); if (real == null) orphan = true; else row[c] = real; }
        }
        const ph = made[t] ? row[made[t]] : undefined;
        if (made[t]) delete row[made[t]];
        if (orphan) { if (ph !== undefined) map[t].set(ph, null); skipped++; continue; }
        const got = await insertRow(cl, inPrimary ? primary : stg, t, row, inPrimary ? primCols[t] : genCols[t]);
        if (!got) { if (ph !== undefined) map[t].set(ph, null); skipped++; continue; }
        if (made[t] && ph !== undefined) map[t].set(ph, got[made[t]]);
        rows[t].push({ ...row, ...plainRow(got) });
      }
      // the preview's copy of a table that went into live: the same rows, the same keys, before any child of it
      if (stgClient && inPrimary && stgCols[t]) for (const r of rows[t]) await insertRow(stgClient, stg, t, r, stgCols[t], { explicit: true });
    }
    if (stgClient) await migrate.setSequencesPastData(stgClient, stg);
    await client.query("COMMIT");
    if (stgClient) await stgClient.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    if (stgClient) await stgClient.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
    if (stgClient) stgClient.release();
  }
  const counts = Object.fromEntries(Object.entries(rows).map(([t, r]) => [t, r.length]));
  const keyCols = {}; for (const t of order) keyCols[t] = (keys.pk[t] && keys.pk[t].length) ? keys.pk[t] : null;
  return { rows, skipped, counts, plan: { order, keys: keyCols, live_cols: liveOn ? liveCols : {}, pending: liveOn ? pending : order } };
}

// ---- reads ---------------------------------------------------------------------------------------------------------------
async function isDemo(company) {
  const r = (await q("SELECT demo FROM platform.companies WHERE slug=$1", [company])).rows[0];
  return Boolean(r && r.demo);
}
async function current(company, mod) {
  return (await q("SELECT * FROM platform.sample_fills WHERE company=$1 AND module=$2 AND status IN ('writing','in') ORDER BY id DESC LIMIT 1", [company, mod])).rows[0] || null;
}
async function latest(company, mod) {
  return (await q("SELECT * FROM platform.sample_fills WHERE company=$1 AND module=$2 ORDER BY id DESC LIMIT 1", [company, mod])).rows[0] || null;
}
async function buildRunning(company, mod) {
  return (await q("SELECT id FROM platform.build_runs WHERE company=$1 AND module=$2 AND status='running' LIMIT 1", [company, mod])).rows[0] || null;
}
async function view(company, mod) {
  const m = await registry.getModule(company, mod);
  const f = await latest(company, mod);
  const running = await buildRunning(company, mod);
  const credit = await require("./selfserve").credit(company).catch(() => null);
  const unit = credit ? credit.unit_usd : 10;
  const why = !m ? "no such tool" : m.live_version == null && m.staged_version == null ? "Nothing to fill yet: the tool has not been built." : running ? "A build of this tool is running. Fill it when the build is waiting for you or done." : f && f.status === "writing" ? "Sample data is being written." : credit && credit.balance_usd <= 0 ? "Your AI credit is used up." : null;
  return {
    module: mod, live_version: m ? m.live_version : null, staged_version: m ? m.staged_version : null,
    can_fill: !why, why_not: why,
    fill: f ? {
      id: f.id, status: f.status, story: f.story, version: f.version, error: f.error, in_live: f.in_live, in_preview: f.in_preview,
      rows: f.rows ? Object.values(f.rows).reduce((n, r) => n + r.length, 0) : 0,
      tables: f.rows ? Object.fromEntries(Object.entries(f.rows).map(([t, r]) => [t, r.length])) : {},
      skipped: f.skipped, kept: f.kept, created_at: f.created_at, cleared_at: f.cleared_at,
      credit_percent: Number(f.cost_usd) > 0 ? Math.max(1, Math.round((Number(f.cost_usd) / unit) * 100)) : 0,
    } : null,
  };
}

// ---- fill and clear ---------------------------------------------------------------------------------------------------
async function fill(company, mod, who, { replace = false } = {}) {
  if (!(await isDemo(company))) throw fail(404, "sample data is for demo companies");
  const m = await registry.getModule(company, mod);
  if (!m) throw fail(404, "no such tool");
  if (m.live_version == null && m.staged_version == null) throw fail(409, "Nothing to fill yet: the tool has not been built.");
  if (await buildRunning(company, mod)) throw fail(409, "A build of this tool is running. Fill it when the build is waiting for you or done.");
  const had = await current(company, mod);
  if (had && had.status === "writing") throw fail(409, "Sample data is already being written for this tool.");
  if (had && !replace) throw fail(409, "This tool already has sample data. Clear it first, or replace it with a fresh set.");
  await agent.assertUnderCap(company);   // their credit pays (Brendan's choice); a fill is a start of its own
  if (had) await clear(company, mod, who);
  const f = (await q("INSERT INTO platform.sample_fills (company, module, version, made_by) VALUES ($1,$2,$3,$4) RETURNING *",
    [company, mod, m.staged_version || m.live_version, (who && who.name) || (who && who.role) || null])).rows[0];
  write(f, m, who).catch(async (e) => {
    console.error(`[sample] ${company}/${mod} #${f.id}:`, e.message);
    await q("UPDATE platform.sample_fills SET status='failed', error=$2 WHERE id=$1", [f.id, String(e.message || e).slice(0, 500)]).catch(() => {});
  });
  return f;
}
async function write(f, m, who) {
  const { company, module: mod } = f;
  const live = migrate.liveSchema(company, mod), stg = migrate.stagingSchema(company, mod);
  const liveOn = m.live_version != null && await schemaExists(live);
  const stgOn = m.staged_version != null && await schemaExists(stg);
  if (!liveOn && !stgOn) throw new Error("the tool's tables are not there yet");
  const genSchema = stgOn ? stg : live;
  const genCols = await columnsOf(genSchema);
  if (!Object.keys(genCols).length) throw new Error("this tool keeps no tables of its own, so there is nothing to fill");
  const keys = await keysOf(genSchema);
  let out = await writeRows(company, mod, f.version, genCols, keys, m.title || mod);
  let cost = out.costUsd || 0;
  const flat = () => Object.fromEntries(Object.entries(genCols).map(([t, c]) => [t, c.map((x) => x.name)]));
  let tables = isObj(out.data && out.data.tables) ? out.data.tables : {};
  let problems = migrate.rowsProblems(tables, flat());
  if (problems.length) {   // one more try with what did not fit
    out = await writeRows(company, mod, f.version, genCols, keys, m.title || mod, problems);
    cost += out.costUsd || 0;
    tables = isObj(out.data && out.data.tables) ? out.data.tables : {};
    problems = migrate.rowsProblems(tables, flat());
  }
  await agent.recordUsage(company, mod, "sample_data", out.model, cost, { fill: f.id });
  if (problems.length) throw new Error(`the sample rows did not fit this tool's tables: ${problems.slice(0, 3).join("; ")}`);
  const put = await putIn(company, mod, tables, { live, stg, liveOn, stgOn, genCols, keys });
  const total = Object.values(put.counts).reduce((a, b) => a + b, 0);
  if (!total) throw new Error("none of the sample rows fit this tool's tables");
  const story = String((out.data && out.data.story) || "").replace(/\s*[–—]\s*/g, ", ").slice(0, 600);
  await q(`UPDATE platform.sample_fills SET status='in', story=$2, rows=$3, plan=$4, in_live=$5, in_preview=$6, skipped=$7, cost_usd=$8, model=$9 WHERE id=$1`,
    [f.id, story, JSON.stringify(put.rows), JSON.stringify(put.plan), liveOn, stgOn, put.skipped, cost, out.model]);
  await record("sample_filled", { company, module: mod, actor: who, version: f.version, after: story, detail: { fill: f.id, rows: put.counts, skipped: put.skipped, cost_usd: cost, model: out.model, live: liveOn, preview: stgOn } });
  await logEvent("sample_filled", `${company}/${mod}`, { fill: f.id, rows: total });
}

// Take the fill's rows out of one schema, children first. -> { deleted, kept }
async function takeOut(schema, f) {
  if (!(await schemaExists(schema))) return { deleted: 0, kept: 0 };
  const cols = await columnsOf(schema);
  const plan = f.plan || {}, rows = f.rows || {};
  const order = [...(plan.order || Object.keys(rows))].reverse();
  let deleted = 0, kept = 0;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const t of order) {
      if (!cols[t] || !(rows[t] || []).length) continue;
      const key = (plan.keys || {})[t];
      for (const r of rows[t]) {
        const match = key && key.every((k) => r[k] != null) ? key : Object.keys(r).filter((k) => r[k] != null && cols[t].some((c) => c.name === k) && !/json/.test((cols[t].find((c) => c.name === k) || {}).type || ""));
        if (!match.length) continue;
        await client.query("SAVEPOINT d");
        try {
          const where = match.map((k, i) => `${qi(k)} IS NOT DISTINCT FROM $${i + 1}`).join(" AND ");
          const res = await client.query(`DELETE FROM ${schema}.${qi(t)} WHERE ctid IN (SELECT ctid FROM ${schema}.${qi(t)} WHERE ${where} LIMIT 1)`, match.map((k) => r[k]));
          await client.query("RELEASE SAVEPOINT d");
          deleted += res.rowCount;
        } catch (e) {
          await client.query("ROLLBACK TO SAVEPOINT d");
          kept++;   // something of the person's points at it
        }
      }
    }
    await client.query("COMMIT");
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
  finally { client.release(); }
  return { deleted, kept };
}
async function clear(company, mod, who) {
  if (!(await isDemo(company))) throw fail(404, "sample data is for demo companies");
  const f = await current(company, mod);
  if (!f || f.status !== "in") throw fail(409, "This tool has no sample data to clear.");
  const a = await takeOut(migrate.liveSchema(company, mod), f);
  const b = await takeOut(migrate.stagingSchema(company, mod), f);
  await q("UPDATE platform.sample_fills SET status='cleared', cleared_at=now(), kept=$2 WHERE id=$1", [f.id, a.kept]);
  await record("sample_cleared", { company, module: mod, actor: who, after: `sample data cleared: ${a.deleted} rows out${a.kept ? `, ${a.kept} kept because something added since points at them` : ""}`, detail: { fill: f.id, live: a, preview: b } });
  return { deleted: a.deleted || b.deleted, kept: a.kept };
}

// A deploy: rows that were only in the preview (a first build, or a table or column only the new build has) go into
// the live tables, same keys; the sequences are set past them.
async function afterDeploy(company, mod) {
  const f = await current(company, mod);
  if (!f || f.status !== "in") return;
  const plan = f.plan || {};
  const live = migrate.liveSchema(company, mod);
  if (!(await schemaExists(live))) return;
  const cols = await columnsOf(live);
  const pending = new Set(plan.pending || []);
  const liveCols = plan.live_cols || {};
  const needs = (plan.order || []).some((t) => cols[t] && (pending.has(t) || cols[t].some((c) => !(liveCols[t] || []).includes(c.name))));
  if (!needs && f.in_live) return;
  const client = await pool.connect();
  let added = 0, updated = 0;
  try {
    await client.query("BEGIN");
    for (const t of plan.order || []) {
      if (!cols[t]) continue;
      const key = (plan.keys || {})[t];
      const had = liveCols[t] || [];
      for (const r of (f.rows || {})[t] || []) {
        if (!pending.has(t) && key && key.every((k) => r[k] != null)) {
          const extra = Object.keys(r).filter((k) => r[k] != null && !had.includes(k) && cols[t].some((c) => c.name === k) && !key.includes(k));
          if (!extra.length) continue;
          await client.query("SAVEPOINT u");
          try {
            const res = await client.query(`UPDATE ${live}.${qi(t)} SET ${extra.map((k, i) => `${qi(k)}=$${i + 1}`).join(", ")} WHERE ${key.map((k, i) => `${qi(k)}=$${extra.length + i + 1}`).join(" AND ")}`, [...extra.map((k) => r[k]), ...key.map((k) => r[k])]);
            await client.query("RELEASE SAVEPOINT u"); updated += res.rowCount;
          } catch (e) { await client.query("ROLLBACK TO SAVEPOINT u"); }
        } else if (pending.has(t)) {
          if (await insertRow(client, live, t, r, cols[t], { explicit: true })) added++;
        }
      }
    }
    await migrate.setSequencesPastData(client, live);
    await client.query("COMMIT");
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
  finally { client.release(); }
  const nowCols = Object.fromEntries(Object.entries(cols).map(([t, c]) => [t, c.map((x) => x.name)]));
  await q("UPDATE platform.sample_fills SET in_live=true, plan=$2 WHERE id=$1", [f.id, JSON.stringify({ ...plan, pending: [], live_cols: nowCols })]);
  await logEvent("sample_carried_live", `${company}/${mod}`, { fill: f.id, added, updated });
}

// ---- routes ------------------------------------------------------------------------------------------------------------
const router = express.Router();
const json = express.json({ limit: "8kb" });
const guard = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (e) { res.status(e.status || 500).json({ error: e.message }); }
};
const demoOnly = async (req) => { if (!(await isDemo(req.params.slug))) throw fail(404, "sample data is for demo companies"); };
router.get("/api/c/:slug/modules/:mod/sample", requireManager, guard(async (req, res) => {
  await demoOnly(req);
  res.set("Cache-Control", "no-store").json(await view(req.params.slug, req.params.mod));
}));
router.post("/api/c/:slug/modules/:mod/sample", requireManager, json, guard(async (req, res) => {
  await demoOnly(req);
  await fill(req.params.slug, req.params.mod, actor(req), { replace: Boolean((req.body || {}).replace) });
  res.json(await view(req.params.slug, req.params.mod));
}));
router.post("/api/c/:slug/modules/:mod/sample/clear", requireManager, json, guard(async (req, res) => {
  await demoOnly(req);
  const out = await clear(req.params.slug, req.params.mod, actor(req));
  res.json({ ...(await view(req.params.slug, req.params.mod)), cleared: out });
}));

module.exports = { init, router, fill, clear, afterDeploy, view, isDemo, fkOrder, madeKey, pointers, fakeRows, SCHEMA };
