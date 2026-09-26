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

const PER_TABLE = Number(process.env.SOS_SAMPLE_MAX_ROWS || 1200);   // after the copies (expandRepeats); the AI writes far fewer
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
  // the rules a row has to meet, told to the AI exactly as the database holds them (2026-09-26: a revision's checks and
  // unique columns sat past the cut in a long migrations text, and every row of the next fill was refused)
  const checks = (await q(`SELECT tc.relname::text AS tbl, pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c JOIN pg_class tc ON tc.oid=c.conrelid JOIN pg_namespace n ON n.oid=tc.relnamespace
    WHERE c.contype='c' AND n.nspname=$1`, [schema])).rows;
  const check = {}; for (const r of checks) (check[r.tbl] = check[r.tbl] || []).push(r.def);
  return { pk, fk, check, unique: await uniquesOf(schema) };
}
// { table: { index name: [columns] } } for every unique index but the primary key's
async function uniquesOf(schema) {
  const rows = (await q(`SELECT t.relname::text AS tbl, i.relname::text AS idx, array_agg(a.attname::text ORDER BY k.ord) AS cols
    FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_class t ON t.oid=x.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    JOIN LATERAL unnest(x.indkey) WITH ORDINALITY k(attnum, ord) ON true JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum
    WHERE n.nspname=$1 AND x.indisunique AND NOT x.indisprimary GROUP BY t.relname, i.relname`, [schema])).rows;
  const out = {}; for (const r of rows) (out[r.tbl] = out[r.tbl] || {})[r.idx] = r.cols;
  return out;
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
// The key the database makes for a table, if it has one: a one-column primary key with a sequence, an identity or any
// other default (gen_random_uuid(), say).
function madeKey(table, cols, pk) {
  const k = pk[table];
  if (!k || k.length !== 1) return null;
  const c = (cols[table] || []).find((x) => x.name === k[0]);
  return c && (c.identity || c.default) ? c.name : null;
}
const isJson = (c) => Boolean(c && /^json/.test(c.type));
// A JSON column takes structured values (an object or a list); everything else plain ones. Values for a JSON column go
// in as JSON text: an object or list as itself, a string that is JSON as it is, any other string as a JSON string. Pure.
function jsonReady(row, colList) {
  const out = { ...row };
  for (const c of colList || []) {
    if (!isJson(c) || out[c.name] == null) continue;
    const v = out[c.name];
    if (typeof v === "string") { try { JSON.parse(v); } catch { out[c.name] = JSON.stringify(v); } }
    else out[c.name] = JSON.stringify(v);
  }
  return out;
}
// migrate.rowsProblems, with structured values allowed in JSON columns. Pure.
function fitProblems(tables, cols) {
  const flat = {}, plain = {};
  for (const [t, list] of Object.entries(cols)) flat[t] = list.map((c) => c.name);
  for (const [t, rows] of Object.entries(tables || {})) {
    const jc = new Set((cols[t] || []).filter(isJson).map((c) => c.name));
    plain[t] = Array.isArray(rows) ? rows.map((r) => (isObj(r) ? Object.fromEntries(Object.entries(r).map(([k, v]) => [k, jc.has(k) && v !== null && typeof v === "object" ? JSON.stringify(v) : v])) : r)) : rows;
  }
  return migrate.rowsProblems(plain, flat);
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
// Simpler since 2026-09-26 (Brendan: "burning through credits getting failures ... we need a bit of a simpler solution").
// The first version asked for a whole week of rows; for a tool that logs twenty readings an hour the answer ran past
// its length limit, came back cut off and empty, and every try cost the demo about fifty cents. Now the AI writes only
// the latest few rows (at most AI_PER_TABLE a table, AI_TOTAL in all) on the short text model, once, and says which
// tables repeat; the platform copies those back in time itself (expandRepeats), with the rows that belong to each.
const AI_PER_TABLE = 10, AI_TOTAL = 80, MAX_ROWS = Number(process.env.SOS_SAMPLE_MAX_ROWS || 1200);
const FILL_SCHEMA = {
  type: "object",
  properties: {
    story: { type: "string", description: "One or two plain sentences a plant manager would read: the made-up work these rows tell (who, what, what is going on right now). No dashes." },
    tables: { type: "object", description: `{ "<table>": [ { "<column>": value, ... } ] }. Only tables and columns that exist. At most ${AI_PER_TABLE} rows a table, ${AI_TOTAL} in all.`, additionalProperties: { type: "array", items: { type: "object" } } },
    repeat: { type: "object", description: "Tables that record something again and again (hourly logs, readings, moves): { \"<table>\": { \"covers_minutes\": the time the rows you wrote for it cover, \"back_hours\": how far back the platform should copy them, at most 168 } }. Leave out every other table.", additionalProperties: { type: "object", properties: { covers_minutes: { type: "number" }, back_hours: { type: "number" } } } },
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
  let budget = 30000, codeText = "";
  for (const f of code) { if (budget <= 0) break; const part = clipText(String(files[f]), Math.min(budget, 15000)); codeText += `\n\n--- ${f}\n${part}`; budget -= part.length; }
  const colText = Object.entries(cols).map(([t, list]) => {
    const made = madeKey(t, cols, keys.pk);
    const uniq = Object.values((keys.unique || {})[t] || {});
    return `${t}: ${list.map((c) => `${c.name} ${c.type}${c.nullable ? "" : " not null"}${c.name === made ? " (key the database makes: give 1, 2, 3 as placeholders)" : c.default ? " (has a default)" : ""}${isJson(c) ? " (give an object or a list)" : ""}`).join(", ")}${(keys.fk[t] || []).length ? `\n  points at: ${keys.fk[t].map((f) => `${f.col} -> ${f.table}.${f.column}`).join(", ")}` : ""}${((keys.check || {})[t] || []).length ? `\n  every row must meet: ${keys.check[t].join("; ")}` : ""}${uniq.length ? `\n  no two rows may share: ${uniq.map((u) => u.join(" + ")).join("; ")} (the migrations' own rows count too)` : ""}`;
  }).join("\n");
  const mig = migrations.length > 16000 ? `... (the first part cut)\n${migrations.slice(-16000)}` : migrations;
  return { ref: ref ? clipText(String(ref.content), 8000) : "", migrations: mig, codeText, colText };
}
// The model: SOS_SAMPLE_MODEL, else the short text jobs' model (/admin#models, Sonnet 5 by default).
async function sampleModel() { return process.env.SOS_SAMPLE_MODEL || (await agent.summaryModel()); }
async function writeRows(company, mod, version, cols, keys, title) {
  const model = await sampleModel();
  const ctx = await toolContext(company, mod, version, cols, keys);
  const now = new Date();
  const system = `You write sample data for a demo of a small tool that runs a job on a factory floor. The person trying the demo has no data of their own yet; your rows go straight into the tool's own tables so its screens and numbers show what the tool does with real work in it. Write in the tool's own words: the stages, statuses, stations and names its code and design use, exactly as spelled there. Everything is made up; never a real company's or real person's name. Keep the answer short.`;
  const prompt = `The tool is "${title}".

${ctx.ref ? `Its design:\n${ctx.ref}\n\n` : ""}Its tables, as they stand:
${ctx.colText}

The migrations that made them:
${ctx.migrations}

Its code (so the values are the ones the screens and rules expect):${ctx.codeText || " (none stored)"}

Write the rows. It is now ${now.toISOString()}.
1. Only the latest part: the most recent work and what is in progress right now, with something late, stuck or out of the ordinary. At most ${AI_PER_TABLE} rows a table and ${AI_TOTAL} in all. A table the migrations already fill (a list of stations, say) needs rows only if more make sense.
2. A table that records something again and again (hourly logs, readings, moves, counts): write only the latest few and name it in "repeat" with the time those rows cover and how far back to copy them. The platform copies them back in time with small changes to the numbers, and copies the rows that belong to each one along with it. Never write the copies yourself.
3. A key the database makes: give 1, 2, 3 ... per table as placeholders and use those same numbers in the columns that point at it. Leave out a column with a default unless the value matters.
4. Only the tables and columns listed. Plain values (an object or a list only where a column says so). Every rule listed with a table, every "not null", the checks in the migrations. Names and codes of your own, never ones the migrations already insert. Timestamps are ISO with a time zone.
5. The story: one or two plain sentences on what is going on.`;
  if (agent.fakeMode()) {
    await agent.atWall("structured:sample_data", { company, model, system, prompt });
    return { data: fakeRows(cols, keys), costUsd: 0, model };
  }
  const { data, costUsd, stopReason } = await agent.runStructured({ model, company, system, prompt, schema: FILL_SCHEMA, toolName: "sample_data", maxTokens: 8000 });
  return { data, costUsd, model, stopReason };
}
// The AI's answer made usable, never refused whole: a list given as JSON text is read; an unknown table goes; an unknown
// column goes from its row; a structured value where a plain one belongs goes; rows past the caps go. Pure.
// -> { tables, repeat, dropped: [notes] }
function tidy(data, cols) {
  const dropped = [];
  let tables = data && data.tables;
  if (typeof tables === "string") { try { tables = JSON.parse(tables); } catch { tables = null; } }
  let repeat = data && data.repeat;
  if (typeof repeat === "string") { try { repeat = JSON.parse(repeat); } catch { repeat = null; } }
  const out = {};
  let total = 0;
  for (const [t, rows0] of Object.entries(isObj(tables) ? tables : {})) {
    let rows = rows0;
    if (typeof rows === "string") { try { rows = JSON.parse(rows); } catch { rows = null; } }
    if (!cols[t]) { dropped.push(`no table named ${t}`); continue; }
    if (!Array.isArray(rows)) { dropped.push(`${t}: not a list of rows`); continue; }
    const byName = Object.fromEntries(cols[t].map((c) => [c.name, c]));
    const bad = new Set();
    const list = [];
    for (const r of rows.slice(0, AI_PER_TABLE * 2)) {
      if (!isObj(r) || total >= AI_TOTAL * 2) continue;
      const row = {};
      for (const [k, v] of Object.entries(r)) {
        if (!byName[k]) { bad.add(k); continue; }
        if (v !== null && typeof v === "object" && !isJson(byName[k])) continue;
        row[k] = v;
      }
      if (Object.keys(row).length) { list.push(row); total++; }
    }
    if (bad.size) dropped.push(`${t}: no column named ${[...bad].join(", ")}`);
    if (list.length) out[t] = list;
  }
  const rep = {};
  for (const [t, r] of Object.entries(isObj(repeat) ? repeat : {})) {
    const cover = Number(r && r.covers_minutes), back = Math.min(168, Number(r && r.back_hours));
    if (out[t] && cover >= 5 && back > 0 && back * 60 > cover) rep[t] = { covers_minutes: cover, back_hours: back };
  }
  return { tables: out, repeat: rep, dropped };
}
// Copies of the repeating tables' rows, back in time: copy k moves every timestamp and date back k times the time the
// rows cover and nudges the decimal numbers by up to 3%; the rows that point at a copied row are copied with it (and
// theirs), pointing at the copy. Placeholders of copies are "<placeholder>~k". A table copied as part of another's
// family is not copied again on its own. At most MAX_ROWS rows in all. Pure (seeded, so the same answer copies the same).
function expandRepeats(tables, repeat, cols, keys, { now = Date.now(), max = MAX_ROWS } = {}) {
  const made = {}; for (const t of Object.keys(cols)) made[t] = madeKey(t, cols, keys.pk);
  const ptrs = Object.fromEntries(Object.keys(cols).map((t) => [t, pointers(t, cols, keys, made)]));
  const children = (t) => Object.keys(tables).filter((c) => c !== t && Object.values(ptrs[c] || {}).includes(t));
  // a family: the table and every table below it through pointers
  const family = (t, seen = new Set()) => { if (seen.has(t)) return []; seen.add(t); return [t, ...children(t).flatMap((c) => family(c, seen))]; };
  const out = Object.fromEntries(Object.entries(tables).map(([t, r]) => [t, r.map((x) => ({ ...x }))]));
  let total = Object.values(out).reduce((n, r) => n + r.length, 0);
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const covered = new Set();
  const K = (v) => String(v);
  for (const [root, spec] of Object.entries(repeat || {})) {
    if (covered.has(root) || !tables[root]) continue;
    if (!made[root] && (keys.pk[root] || []).length) continue;   // a key of the AI's own would clash on every copy
    const fam = family(root);
    fam.forEach((t) => covered.add(t));
    // the rows of one copy: the root's rows, and down the family the rows that point at a row already in the copy
    const members = { [root]: tables[root] };
    const inCopy = { [root]: new Set(tables[root].map((r) => (made[root] ? K(r[made[root]]) : null)).filter(Boolean)) };
    for (const t of fam.slice(1)) {
      const p = ptrs[t] || {};
      members[t] = (tables[t] || []).filter((r) => Object.entries(p).some(([c, target]) => inCopy[target] && r[c] != null && inCopy[target].has(K(r[c]))));
      inCopy[t] = new Set(members[t].map((r) => (made[t] ? K(r[made[t]]) : null)).filter(Boolean));
    }
    const perCopy = Object.values(members).reduce((n, r) => n + r.length, 0);
    if (!perCopy) continue;
    const copies = Math.max(0, Math.min(Math.floor((spec.back_hours * 60) / spec.covers_minutes), Math.floor((max - total) / perCopy)));
    const shiftMs = spec.covers_minutes * 60e3;
    for (let k = 1; k <= copies; k++) {
      for (const t of fam) {
        const byName = Object.fromEntries((cols[t] || []).map((c) => [c.name, c]));
        for (const r of members[t] || []) {
          const c2 = {};
          for (const [col, v] of Object.entries(r)) {
            const c = byName[col];
            if (v == null || !c) { c2[col] = v; continue; }
            if (col === made[t]) { c2[col] = `${v}~${k}`; continue; }
            const target = (ptrs[t] || {})[col];
            if (target && fam.includes(target) && inCopy[target] && inCopy[target].has(K(v))) { c2[col] = `${v}~${k}`; continue; }
            if (/timestamp|date/.test(c.type) && !Number.isNaN(Date.parse(v))) {
              const d = new Date(Date.parse(v) - k * shiftMs);
              c2[col] = c.type === "date" ? d.toISOString().slice(0, 10) : d.toISOString();
              continue;
            }
            if (/numeric|real|double/.test(c.type) && typeof v === "number" && !target) {
              const dec = (String(v).split(".")[1] || "").length;
              c2[col] = Number((v * (1 + (rnd() - 0.5) * 0.06)).toFixed(dec));
              continue;
            }
            c2[col] = v;
          }
          (out[t] = out[t] || []).push(c2);
          total++;
        }
      }
    }
  }
  void now;
  return out;
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
        else if (/^json/.test(c.type)) row[c.name] = { note: `sample ${i + 1}` };
        else if (/char|text/.test(c.type)) row[c.name] = `Sample ${c.name.replace(/_/g, " ")} ${i + 1}`;
      }
      return row;
    });
  }
  // the first table with a timestamp that another table points at repeats: six hours of it, copied back a day
  const rep = order.find((t) => made[t] && cols[t].some((c) => /timestamp/.test(c.type)) && order.some((o) => o !== t && Object.values(pointers(o, cols, keys, made)).includes(t)));
  return { story: "Fake mode: six made-up rows a table from the column types alone. (SOS_FAKE_AGENT=1)", tables, repeat: rep ? { [rep]: { covers_minutes: 360, back_hours: 24 } } : {} };
}

// ---- putting rows in ---------------------------------------------------------------------------------------------------
const hasIdentity = (list) => (list || []).some((c) => c.identity);
// -> the row as it went in, or null; onError(e) hears why a row was refused
async function insertRow(client, schema, table, row, colList, { explicit = false, onError } = {}) {
  const ready = jsonReady(row, colList);
  const names = Object.keys(ready).filter((k) => colList.some((c) => c.name === k));
  if (!names.length) return null;
  const sql = `INSERT INTO ${schema}.${qi(table)} (${names.map(qi).join(", ")}) ${explicit && hasIdentity(colList) ? "OVERRIDING SYSTEM VALUE " : ""}VALUES (${names.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`;
  await client.query("SAVEPOINT r");
  try {
    const r = await client.query(sql, names.map((k) => ready[k]));
    await client.query("RELEASE SAVEPOINT r");
    return r.rows[0];
  } catch (e) {
    await client.query("ROLLBACK TO SAVEPOINT r");
    if (onError) onError(e);
    return null;
  }
}
// JSON-safe copy of a returned row (Dates as ISO strings)
const plainRow = (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]));

// The AI's rows into the primary schema (live, or the preview's for a first build), remapping made keys; then, when a
// build waits and the primary is live, the same rows with their real keys into the preview.
// leftovers: { table: Set(key) } of rows earlier fills put in that a clear had to keep (something the tool or the person
// added points at them). A new row that clashes with one on a unique column takes it over instead of being left out
// (2026-09-26, seancorp: the first fill worked, then every fill after it was refused: its parents clashed with kept
// ones on a unique name and every child went with them).
// -> { rows: { table: [rows] }, plan, skipped, reused, counts, reasons }
async function putIn(company, mod, made0, { live, stg, liveOn, stgOn, genCols, keys, leftovers = {} }) {
  const primary = liveOn ? live : stg;
  const primCols = await columnsOf(primary);
  const primUniq = await uniquesOf(primary);
  const made = {}; for (const t of Object.keys(genCols)) made[t] = madeKey(t, genCols, keys.pk);
  const links = Object.fromEntries(Object.keys(genCols).map((t) => [t, Object.values(pointers(t, genCols, keys, made))]));
  const order = fkOrder(Object.keys(made0).filter((t) => genCols[t]), keys.fk, links);
  const K = (v) => String(v);   // "1" and 1 are the same placeholder
  const map = {};          // table -> Map(placeholder -> real key or null when the row was left out)
  const rows = {}, pending = [], liveCols = {}, why = {};
  let skipped = 0, reused = 0, attempted = 0;
  const heard = (t) => (e) => { const m = `${e.message}${e.detail ? ` (${e.detail})` : ""}`.slice(0, 300); (why[t] = why[t] || new Map()).set(m, ((why[t] && why[t].get(m)) || 0) + 1); };
  const client = await pool.connect();
  const stgClient = liveOn && stgOn ? await pool.connect() : null;
  try {
    await client.query("BEGIN");
    if (stgClient) await stgClient.query("BEGIN");
    const stgCols = stgClient ? await columnsOf(stg) : {};
    for (const t of order) {
      const inPrimary = Boolean(primCols[t]);
      const cl = inPrimary ? client : stgClient;
      const list = Array.isArray(made0[t]) ? made0[t].slice(0, PER_TABLE) : [];
      if (!cl) { skipped += list.length; continue; }
      if (!inPrimary) pending.push(t);
      else if (liveOn) liveCols[t] = primCols[t].map((c) => c.name);
      const ptr = pointers(t, genCols, keys, made);
      map[t] = new Map();
      rows[t] = [];
      for (const raw of list) {
        if (!isObj(raw)) continue;
        attempted++;
        const row = { ...raw };
        // a pointer at a row that was left out: this one is left out too; at a placeholder: the real key
        let orphan = false;
        for (const [c, target] of Object.entries(ptr)) {
          if (row[c] == null || !map[target]) continue;
          if (map[target].has(K(row[c]))) { const real = map[target].get(K(row[c])); if (real == null) orphan = true; else row[c] = real; }
        }
        const ph = made[t] ? row[made[t]] : undefined;
        if (made[t]) delete row[made[t]];
        if (orphan) { if (ph !== undefined) map[t].set(K(ph), null); skipped++; continue; }
        let err = null;
        const got = await insertRow(cl, inPrimary ? primary : stg, t, row, inPrimary ? primCols[t] : genCols[t], { onError: (e) => { err = e; } });
        if (got) {
          if (made[t] && ph !== undefined) map[t].set(K(ph), got[made[t]]);
          rows[t].push({ ...row, ...plainRow(got) });
          continue;
        }
        // a clash on a unique column with a sample row an earlier fill left behind: take that row over
        const cols = err && err.code === "23505" && inPrimary && made[t] ? ((primUniq[t] || {})[err.constraint]) : null;
        if (cols && cols.every((c) => row[c] != null) && leftovers[t] && leftovers[t].size) {
          const had = (await cl.query(`SELECT * FROM ${primary}.${qi(t)} WHERE ${cols.map((c, i) => `${qi(c)} = $${i + 1}`).join(" AND ")} LIMIT 1`, cols.map((c) => row[c]))).rows[0];
          if (had && leftovers[t].has(K(had[made[t]]))) {
            if (ph !== undefined) map[t].set(K(ph), had[made[t]]);
            rows[t].push(plainRow(had));   // this fill's now: a clear takes it out if it can
            reused++;
            continue;
          }
        }
        if (err) heard(t)(err);
        if (ph !== undefined) map[t].set(K(ph), null);
        skipped++;
      }
      // the preview's copy of a table that went into live: the same rows, the same keys, before any child of it
      if (stgClient && inPrimary && stgCols[t]) for (const r of rows[t]) await insertRow(stgClient, stg, t, r, stgCols[t], { explicit: true });
    }
    const reasons = Object.entries(why).flatMap(([t, m]) => [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([msg, n]) => `${t}: ${msg}${n > 1 ? ` (${n} rows)` : ""}`)).slice(0, 8);
    if (stgClient) await migrate.setSequencesPastData(stgClient, stg);
    await client.query("COMMIT");
    if (stgClient) await stgClient.query("COMMIT");
    const counts = Object.fromEntries(Object.entries(rows).map(([t, r]) => [t, r.length]));
    const keyCols = {}; for (const t of order) keyCols[t] = (keys.pk[t] && keys.pk[t].length) ? keys.pk[t] : null;
    return { rows, skipped, reused, counts, reasons, plan: { order, keys: keyCols, live_cols: liveOn ? liveCols : {}, pending: liveOn ? pending : order } };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    if (stgClient) await stgClient.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
    if (stgClient) stgClient.release();
  }
}
// The keys of rows earlier fills of this tool put in, per table (for a clash with one a clear had to keep).
async function leftoverKeys(company, mod, exceptId) {
  const out = {};
  for (const f of (await q("SELECT rows, plan FROM platform.sample_fills WHERE company=$1 AND module=$2 AND id<>$3 AND rows IS NOT NULL", [company, mod, exceptId])).rows) {
    for (const [t, list] of Object.entries(f.rows || {})) {
      const k = ((f.plan || {}).keys || {})[t];
      if (!k || k.length !== 1) continue;
      for (const r of list || []) if (r[k[0]] != null) (out[t] = out[t] || new Set()).add(String(r[k[0]]));
    }
  }
  return out;
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
  let cost = 0, model = null, done = false;
  try {
    const live = migrate.liveSchema(company, mod), stg = migrate.stagingSchema(company, mod);
    const liveOn = m.live_version != null && await schemaExists(live);
    const stgOn = m.staged_version != null && await schemaExists(stg);
    if (!liveOn && !stgOn) throw new Error("the tool's tables are not there yet");
    const genSchema = stgOn ? stg : live;
    const genCols = await columnsOf(genSchema);
    if (!Object.keys(genCols).length) throw new Error("this tool keeps no tables of its own, so there is nothing to fill");
    const keys = await keysOf(genSchema);
    const out = await writeRows(company, mod, f.version, genCols, keys, m.title || mod);
    cost = out.costUsd || 0; model = out.model;
    const tidied = tidy(out.data, genCols);
    if (!Object.keys(tidied.tables).length) {
      throw new Error(out.stopReason === "max_tokens" ? "the agent's answer was too long and came back cut off" : `the agent gave no rows for this tool's tables${tidied.dropped.length ? ` (${tidied.dropped.slice(0, 3).join("; ")})` : ""}`);
    }
    const rows = expandRepeats(tidied.tables, tidied.repeat, genCols, keys);
    const leftovers = await leftoverKeys(company, mod, f.id);
    const put = await putIn(company, mod, rows, { live, stg, liveOn, stgOn, genCols, keys, leftovers });
    const total = Object.values(put.counts).reduce((a, b) => a + b, 0);
    const notes = [...tidied.dropped, ...put.reasons];
    if (notes.length) console.error(`[sample] ${company}/${mod} #${f.id}: ${put.skipped} rows left out. ${notes.join(" | ")}`);
    if (!total) throw new Error(`none of the sample rows fit this tool's tables${put.reasons.length ? `: ${put.reasons.slice(0, 2).join("; ")}` : ""}`);
    const story = String((out.data && out.data.story) || "").replace(/\s*[–—]\s*/g, ", ").slice(0, 600);
    await agent.recordUsage(company, mod, "sample_data", model, cost, { fill: f.id });
    done = true;
    await q(`UPDATE platform.sample_fills SET status='in', story=$2, rows=$3, plan=$4, in_live=$5, in_preview=$6, skipped=$7, cost_usd=$8, model=$9, error=$10 WHERE id=$1`,
      [f.id, story, JSON.stringify(put.rows), JSON.stringify(put.plan), liveOn, stgOn, put.skipped, cost, model, notes.length ? notes.join("\n").slice(0, 2000) : null]);
    await record("sample_filled", { company, module: mod, actor: who, version: f.version, after: story, detail: { fill: f.id, rows: put.counts, repeated: Object.keys(tidied.repeat), skipped: put.skipped, reused: put.reused, left_out_because: notes, cost_usd: cost, model, live: liveOn, preview: stgOn } });
    await logEvent("sample_filled", `${company}/${mod}`, { fill: f.id, rows: total });
  } catch (e) {
    // a fill that did not work costs the demo nothing: the spend is filed (the admin sees it) and handed back as credit
    if (!done && cost > 0) {
      await agent.recordUsage(company, mod, "sample_data_failed", model, cost, { fill: f.id }).catch(() => {});
      const ss = require("./selfserve");
      if (await ss.credit(company).catch(() => null)) await ss.addCredit({ slug: company, credit_usd: cost, kind: "adjust", note: `a sample fill that did not work (#${f.id}), handed back`, by: "platform" }).catch((x) => console.error("[sample] refund:", x.message));
    }
    await record("sample_failed", { company, module: mod, actor: who, version: f.version, after: String(e.message || e).slice(0, 500), detail: { fill: f.id, cost_usd: cost, refunded: !done && cost > 0, model } });
    throw e;
  }
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

module.exports = { init, router, fill, clear, afterDeploy, view, isDemo, fkOrder, madeKey, pointers, fakeRows, jsonReady, fitProblems, tidy, expandRepeats, SCHEMA };
