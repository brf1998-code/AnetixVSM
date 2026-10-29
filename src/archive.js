// Archiving a tool, and deleting one for good (2026-10-29, Taylor's request #286 on the Requests tab: "I want the
// ability to delete a module from the admin view of a company"). Brendan's decision the same morning: "it should be
// archive to where it doesn't show up on the main screen just under settings. Then from the admin side we can actually
// delete it."
//
//   archive        a manager, from the tool's Settings popout on the board. The tool leaves the board (the band, its
//                  cards), its screens answer "archived" instead of opening (a QR code taped at a station says so), and
//                  it is listed under Settings, Archived tools, where it can be brought back. Nothing is lost: its
//                  versions, its data, its requests and the record all stay. Refused while one of its builds is open,
//                  and when another tool reads its data (ctx.peer) the manager is told which and asked again.
//   bring back     the same manager: the tool is on the board and its screens open again, as it was.
//   delete         Anetix, from the company card on /admin, only once it is archived, with the tool's name typed and a
//                  fresh code (auth.checkAdminCode: a destructive admin action). Its tables (live, preview, test floor
//                  and every snapshot) are dropped, its versions, docs, connections, reviews and diagrams go, and its open
//                  requests are closed with "The tool was deleted." What stays: the requests themselves, the builds and
//                  the record (the plant's history, insert-only), the AI spend, and copies a library made of it.
//
// A library tool's own copy in the company the library seeds (registry.loadAll: the demo company) is never deleted: it
// would be imported again at the next start. It can be archived.
// What archiving does not change: a paying site's fee (src/modprice.js counts the tools live on the floor; an archived
// tool still counts until it is deleted), and the tool library's view of the company's tools.
//
// Routes:
//   POST /api/c/:slug/modules/:name/archive     { confirm? }   manager (and a fresh PIN for a signed-in name)
//   POST /api/c/:slug/modules/:name/unarchive                  manager
//   POST /api/admin/companies/:slug/modules/:name/delete       { confirm_name, code | password | passkey }   admin
const express = require("express");
const fs = require("fs");
const path = require("path");
const { q, logEvent } = require("./db");
const { record, actor } = require("./record");

const SCHEMA = `
ALTER TABLE platform.modules ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE platform.modules ADD COLUMN IF NOT EXISTS archived_by TEXT;
`;
// the companies' archived tools, "<company>/<module>", in memory: every request to a tool's screens asks
const archived = new Set();
const key = (c, m) => `${c}/${m}`;
async function init() {
  await q(SCHEMA);
  archived.clear();
  for (const r of (await q("SELECT company, name FROM platform.modules WHERE archived_at IS NOT NULL")).rows) archived.add(key(r.company, r.name));
}
const isArchived = (company, mod) => archived.has(key(company, mod));
const fail = (status, message, extra) => Object.assign(new Error(message), { status }, extra || {});
const OPEN_RUNS = ["running", "queued", "waiting", "stacked"];

async function toolRow(company, mod) {
  const row = (await q("SELECT * FROM platform.modules WHERE company=$1 AND name=$2", [company, mod])).rows[0];
  if (!row) throw fail(404, "no such tool");
  return row;
}
async function openBuilds(company, mod) {
  return (await q("SELECT count(*)::int AS n FROM platform.build_runs WHERE company=$1 AND module=$2 AND status = ANY($3)", [company, mod, OPEN_RUNS])).rows[0].n;
}
// The other live tools of the company whose code reads this one's data (ctx.peer("<name>")).
async function readersOf(company, mod) {
  const rows = (await q(
    `SELECT m.name, m.title, v.files->>'routes.js' AS routes FROM platform.modules m
       JOIN platform.module_versions v ON v.company=m.company AND v.module=m.name AND v.version=m.live_version
      WHERE m.company=$1 AND m.name<>$2 AND m.archived_at IS NULL`, [company, mod])).rows;
  const re = /peer\s*\(\s*["'`]([^"'`]+)["'`]/g;
  return rows.filter((r) => { let m; re.lastIndex = 0; while ((m = re.exec(r.routes || ""))) if (m[1] === mod) return true; return false; }).map((r) => ({ name: r.name, title: r.title }));
}

async function archive(company, mod, who, { confirm = false } = {}) {
  const row = await toolRow(company, mod);
  if (row.archived_at) return { ok: true, already: true };
  const busy = await openBuilds(company, mod);
  if (busy) throw fail(409, `${row.title} has a change being built or waiting for its OK. Make it live or cancel it first, then archive the tool.`, { code: "busy" });
  const readers = await readersOf(company, mod);
  if (readers.length && !confirm) throw fail(409, `${readers.map((r) => r.title).join(" and ")} ${readers.length === 1 ? "reads" : "read"} ${row.title}'s data. Archived, ${row.title}'s data stays and ${readers.length === 1 ? "it" : "they"} can still read it, but nothing new comes in from its screens. Archive it anyway?`, { code: "readers", readers });
  await q("UPDATE platform.modules SET archived_at=now(), archived_by=$3 WHERE company=$1 AND name=$2", [company, mod, (who && who.name) || (who && who.role) || null]);
  archived.add(key(company, mod));
  await record("tool_archived", { company, module: mod, actor: who, after: `${row.title} was archived: off the board, listed under Settings`, detail: { readers: readers.map((r) => r.name) } });
  await logEvent("tool_archived", company, { module: mod });
  return { ok: true, readers };
}
async function unarchive(company, mod, who) {
  const row = await toolRow(company, mod);
  if (!row.archived_at) return { ok: true, already: true };
  await q("UPDATE platform.modules SET archived_at=NULL, archived_by=NULL WHERE company=$1 AND name=$2", [company, mod]);
  archived.delete(key(company, mod));
  await record("tool_unarchived", { company, module: mod, actor: who, after: `${row.title} is back on the board` });
  await logEvent("tool_unarchived", company, { module: mod });
  return { ok: true };
}
async function listArchived(company) {
  return (await q("SELECT name, title, live_version, archived_at, archived_by FROM platform.modules WHERE company=$1 AND archived_at IS NOT NULL ORDER BY archived_at DESC", [company])).rows;
}

// For good. The caller has checked the admin's code.
const GONE_WITH_IT = ["module_versions", "agent_docs", "batches", "check_retirements", "connection_allowances", "connection_uploads", "connections",
  "data_requests", "diagrams", "erp_cache", "print_jobs", "reviews", "sample_fills"];
async function deleteForGood(company, mod, who) {
  const row = await toolRow(company, mod);
  if (!row.archived_at) throw fail(409, "archive the tool first (its Settings on the board), then delete it here", { code: "not_archived" });
  if (await openBuilds(company, mod)) throw fail(409, "a build of this tool is still open; cancel it first", { code: "busy" });
  const migrate = require("./migrate"), registry = require("./registry"), runner = require("./runner");
  // a library tool's own copy in the company it seeds comes back at the next boot (registry.loadAll), so it is never
  // deleted there: archived, it stays off that company's board
  const lib = registry.libraryModules().find((l) => l.name === mod);
  if (lib && (lib.company || "demo") === company) throw fail(409, `${row.title} is the tool library's own copy, which this company is seeded with at every start: it would come back. Leave it archived instead.`, { code: "library_seed" });
  registry.forgetModule(company, mod);
  for (const lane of ["live", "staged", "test"]) await runner.unload(company, lane, mod).catch(() => {});
  const counts = {};
  for (const s of [migrate.liveSchema(company, mod), migrate.stagingSchema(company, mod), migrate.testSchema(company, mod)]) await q(`DROP SCHEMA IF EXISTS ${s} CASCADE`);
  for (const sn of (await q("SELECT file FROM platform.schema_snapshots WHERE company=$1 AND module=$2", [company, mod])).rows) {
    if (/^snap_[a-z0-9_]+$/i.test(sn.file)) await q(`DROP SCHEMA IF EXISTS ${sn.file} CASCADE`);
  }
  counts.schema_snapshots = (await q("DELETE FROM platform.schema_snapshots WHERE company=$1 AND module=$2", [company, mod])).rowCount;
  for (const t of GONE_WITH_IT) {
    try { counts[t] = (await q(`DELETE FROM platform.${t} WHERE company=$1 AND module=$2`, [company, mod])).rowCount; }
    catch (e) { console.error(`[archive] ${company}/${mod}: ${t}:`, e.message); counts[t] = `error: ${e.message}`; }
  }
  counts.requests_closed = (await q(`UPDATE platform.feedback SET status='declined', outcome='The tool was deleted.', updated_at=now()
                                       WHERE company=$1 AND module=$2 AND status IN ('new','reviewing','in_progress')`, [company, mod])).rowCount;
  counts.modules = (await q("DELETE FROM platform.modules WHERE company=$1 AND name=$2", [company, mod])).rowCount;
  archived.delete(key(company, mod));
  try { fs.rmSync(path.join(registry.MODULES_DIR || path.join(__dirname, "..", "data", "modules"), company, mod), { recursive: true, force: true }); } catch (e) { /* the disk copy is a cache */ }
  await record("tool_deleted", { company, module: mod, actor: who, before: row.title, after: `${row.title} was deleted for good: its tables, versions, docs and connections`, detail: { counts } });
  await logEvent("tool_deleted", company, { module: mod, title: row.title, counts, by: who && who.name });
  return { ok: true, counts };
}

// A tool's screens while it is archived: the page says so in plain words; a call gets JSON.
function archivedAnswer(req, res) {
  res.set("Cache-Control", "no-store");
  if (req.method === "GET" && !/(^|\/)api\//.test(req.path)) return res.status(410).type("html").send(`<!DOCTYPE html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>This tool is archived</title>
<body style="font-family:system-ui,sans-serif;background:#f2f4f7;color:#1c242e;margin:0;padding:24px"><div style="max-width:440px;margin:8vh auto;background:#fff;border:1px solid #d9dee5;border-radius:10px;padding:22px">
<h1 style="font-size:20px;margin:0 0 10px">This tool is archived</h1>
<p style="font-size:16px;line-height:1.5;margin:0">It is not in use right now. Ask your manager: they can bring it back from Settings.</p></div></body></html>`);
  return res.status(410).json({ error: "this tool is archived; a manager can bring it back from Settings", code: "archived" });
}

// ---- routes ------------------------------------------------------------------------------------------------------------
const router = express.Router();
const json = express.json({ limit: "16kb" });
const auth = () => require("./auth");
const guard = (fn) => async (req, res) => { try { await fn(req, res); } catch (e) { res.status(e.status || 500).json({ error: e.status ? e.message : "it did not go through", ...(e.code ? { code: e.code } : {}), ...(e.readers ? { readers: e.readers } : {}) }); if (!e.status) console.error("[archive]", e); } };
const NAME = /^[a-z0-9][a-z0-9-]{0,60}$/;
router.post("/api/c/:slug/modules/:name/archive", (req, res, next) => auth().requireManager(req, res, next), (req, res, next) => require("./people").requireFreshPin(req, res, next), json, guard(async (req, res) => {
  if (!NAME.test(req.params.name)) throw fail(404, "no such tool");
  res.json(await archive(req.params.slug, req.params.name, actor(req), { confirm: (req.body || {}).confirm === true }));
}));
router.post("/api/c/:slug/modules/:name/unarchive", (req, res, next) => auth().requireManager(req, res, next), json, guard(async (req, res) => {
  if (!NAME.test(req.params.name)) throw fail(404, "no such tool");
  res.json(await unarchive(req.params.slug, req.params.name, actor(req)));
}));
router.post("/api/admin/companies/:slug/modules/:name/delete", (req, res, next) => auth().requireAdmin(req, res, next), json, guard(async (req, res) => {
  const { slug, name } = req.params;
  if (!NAME.test(name)) throw fail(404, "no such tool");
  const row = await toolRow(slug, name);
  const typed = String((req.body || {}).confirm_name || "").trim();
  if (typed !== row.name && typed.toLowerCase() !== String(row.title).toLowerCase()) throw fail(400, `type the tool's name (${row.title}) to confirm`);
  const gate = await auth().checkAdminCode(req, { code: (req.body || {}).code, password: (req.body || {}).password }, `delete_tool:${slug}/${name}`);
  if (!gate.ok) { await logEvent("tool_delete_refused", slug, { module: name, reason: gate.error }); throw fail(403, gate.error); }
  res.json(await deleteForGood(slug, name, actor(req)));
}));

module.exports = { init, SCHEMA, router, isArchived, archive, unarchive, listArchived, deleteForGood, readersOf, archivedAnswer, GONE_WITH_IT };
