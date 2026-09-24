// The test floor: a third lane per company where every tool runs together on data that is not the floor's
// (docs/TEST-ENVIRONMENT.md, Brendan 2026-09-24). A switch per company, off by default, set by the admin: not
// every company has this, and with it off nothing about it shows anywhere.
//
// What "on" builds: for every tool with a live version, a schema tst_<company>_<tool> made from the version's
// own migrations (sequences of its own, so nothing done on the test floor advances a sequence on the floor)
// and filled from the floor's rows or from a made-up set; a third database role (src/dbroles.js) that reaches
// those tables and nothing else; a third child process (src/runner.js, lane "test") whose ctx.peer reads the
// TEST copy of a sibling tool, never the floor; a mount at /c/<slug>/test/m/<tool>/ with the same browser policy
// as the other two. Which version runs there: platform.modules.test_version, NULL meaning the floor's version
// (a campaign, src/campaign.js, sets it to the build under test for its module and clears it after).
//
// What "off" tears down, in this order: refuse while a campaign is running; builds waiting at the campaign step
// go on to the deploy gate with a note; every test mount and the test child go; every tst_ schema is dropped
// (the data is thrown away, the admin page says so); test_version cleared; the platform.test_floors row is kept
// with on=false so a made-up set survives a round trip; campaign history stays readable.
//
// Data sets (platform.test_floors): the source in force per company, "floor" (a fresh copy of the floor's rows)
// or "made" (rows the campaign proposed, kept here), who set it and when it was last built. Reset rebuilds
// every tool's test tables from the source in force; an open test page notices (the version route carries
// test_built_at) and reloads.
//
// Routes:
//   POST /api/admin/companies/:slug/test-floor  { on }              admin: the switch
//   GET  /api/c/:slug/test-floor                                    any device of the company: status
//   POST /api/c/:slug/test-floor/reset  { source?, rows?, note? }   manager: rebuild the data (a campaign's choice lands here too)
// Record kinds: test_floor_on, test_floor_off, test_floor_reset, test_floor_data.
const express = require("express");
const { q, logEvent } = require("./db");
const { record, actor } = require("./record");
const migrate = require("./migrate");
const registry = require("./registry");
const runner = require("./runner");

const SCHEMA = `
ALTER TABLE platform.companies ADD COLUMN IF NOT EXISTS test_floor BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE platform.modules ADD COLUMN IF NOT EXISTS test_version INTEGER;
CREATE TABLE IF NOT EXISTS platform.test_floors (
  company      TEXT PRIMARY KEY,
  "on"         BOOLEAN NOT NULL DEFAULT false,
  data_source  TEXT NOT NULL DEFAULT 'floor',      -- floor | made
  made_rows    JSONB,                              -- { "<tool>": { "<table>": [ rows ] } }
  made_note    TEXT,
  set_by       TEXT,
  set_person   INTEGER,
  built_at     TIMESTAMPTZ,
  reset_at     TIMESTAMPTZ,
  campaign_id  INTEGER,                            -- the campaign whose data set is in force, if any
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);`;
async function init() { await q(SCHEMA); }

const fail = (status, msg) => Object.assign(new Error(msg), { status });
const SOURCES = ["floor", "made"];
// a hook src/campaign.js fills in: is a campaign running on this company right now, and which builds wait at the step
const hooks = { running: async () => 0, releaseWaiting: async () => 0 };

// ---- reads ----------------------------------------------------------------------------------------
async function isOn(company) {
  const r = (await q("SELECT test_floor FROM platform.companies WHERE slug=$1", [company])).rows[0];
  return Boolean(r && r.test_floor);
}
async function floorRow(company) {
  return (await q("SELECT * FROM platform.test_floors WHERE company=$1", [company])).rows[0] || null;
}
// The version a tool runs on the test floor: test_version when set (a build under test), else the floor's.
const effective = (m) => (m.test_version != null ? Number(m.test_version) : m.live_version != null ? Number(m.live_version) : null);
async function status(company) {
  const on = await isOn(company);
  const row = await floorRow(company);
  const mods = (await q("SELECT name, title, live_version, test_version FROM platform.modules WHERE company=$1 ORDER BY name", [company])).rows;
  return {
    on,
    data_source: row ? row.data_source : "floor",
    made_note: row ? row.made_note : null,
    made_tables: row && row.made_rows ? Object.fromEntries(Object.entries(row.made_rows).map(([m, t]) => [m, Object.fromEntries(Object.entries(t || {}).map(([tb, rows]) => [tb, Array.isArray(rows) ? rows.length : 0]))])) : null,
    built_at: row ? row.built_at : null,
    reset_at: row ? row.reset_at : null,
    campaign_id: row ? row.campaign_id : null,
    modules: mods.map((m) => ({ name: m.name, title: m.title, live_version: m.live_version, test_version: m.test_version, version: effective(m), up: on && registry.testMounted(company, m.name), under_test: m.test_version != null })),
  };
}

// ---- building the tables --------------------------------------------------------------------------
// One tool's test tables from the source in force (or the one given), then its mount. rows: the made-up set
// for THIS tool ({ table: [rows] }) when the source is "made"; a tool the set says nothing about is filled
// from the floor.
async function buildTool(company, mod, version, { source, rows }) {
  const dir = await registry.materialize(company, mod, version);
  const made = source === "made" && rows && Object.keys(rows).length;
  const out = await migrate.buildTestSchema(company, mod, dir, made ? { source: "made", rows } : { source: "floor" });
  await registry.mountTest(company, mod, version);
  return { ...out, source: made ? "made" : "floor" };
}
async function buildAll(company, { source, madeRows } = {}) {
  const row = await floorRow(company);
  const src = SOURCES.includes(source) ? source : (row && row.data_source) || "floor";
  const rows = madeRows || (row && row.made_rows) || {};
  const mods = (await q("SELECT * FROM platform.modules WHERE company=$1 ORDER BY name", [company])).rows;
  const built = {};
  for (const m of mods) {
    const v = effective(m);
    if (v == null) continue;
    built[m.name] = await buildTool(company, m.name, v, { source: src, rows: rows[m.name] });
  }
  return { source: src, built };
}

// ---- the switch -----------------------------------------------------------------------------------
async function turnOn(company, who) {
  if (await isOn(company)) return { ok: true, already: true, ...(await status(company)) };
  await q(`INSERT INTO platform.test_floors (company, "on") VALUES ($1, true) ON CONFLICT (company) DO UPDATE SET "on"=true, updated_at=now()`, [company]);
  await q("UPDATE platform.companies SET test_floor=true WHERE slug=$1", [company]);
  let built;
  try { built = await buildAll(company); }
  catch (e) {
    // half a test floor is worse than none: back out and say why
    await tearDown(company).catch(() => {});
    throw fail(500, `the test floor could not be built: ${e.message}`);
  }
  await q("UPDATE platform.test_floors SET built_at=now(), updated_at=now() WHERE company=$1", [company]);
  await logEvent("test_floor_on", company, { tools: Object.keys(built.built), source: built.source, by: who && who.name });
  await record("test_floor_on", { company, actor: who, after: `on: ${Object.keys(built.built).join(", ") || "no tools yet"}`, detail: { source: built.source, tools: built.built } });
  return { ok: true, ...(await status(company)) };
}
async function tearDown(company) {
  const mods = (await q("SELECT name FROM platform.modules WHERE company=$1", [company])).rows.map((m) => m.name);
  for (const m of mods) await registry.unmountTest(company, m);
  runner.stop(company, "test");
  for (const m of mods) await migrate.dropTestSchema(company, m);
  await q("UPDATE platform.modules SET test_version=NULL WHERE company=$1", [company]);
  await q("UPDATE platform.companies SET test_floor=false WHERE slug=$1", [company]);
  await q(`UPDATE platform.test_floors SET "on"=false, campaign_id=NULL, updated_at=now() WHERE company=$1`, [company]);
  return mods;
}
async function turnOff(company, who) {
  if (!(await isOn(company))) return { ok: true, already: true, ...(await status(company)) };
  const running = await hooks.running(company);
  if (running) throw fail(409, `a test campaign is running on this company right now (${running} build${running === 1 ? "" : "s"}); let it finish or cancel it first`);
  const released = await hooks.releaseWaiting(company);
  const mods = await tearDown(company);
  await logEvent("test_floor_off", company, { tools: mods, released, by: who && who.name });
  await record("test_floor_off", { company, actor: who, after: "off: the test floor's data was thrown away", detail: { tools: mods, builds_released: released } });
  return { ok: true, released, ...(await status(company)) };
}

// ---- data ----------------------------------------------------------------------------------------
// Rebuild every tool's test tables. source and rows change what is in force; without them the source in force
// is rebuilt. campaign_id says whose data set this is (a campaign's choice goes through here).
async function reset(company, who, { source, rows, note, campaign_id } = {}) {
  if (!(await isOn(company))) throw fail(404, "this company has no test floor");
  if (source !== undefined && !SOURCES.includes(source)) throw fail(400, `source is "floor" or "made"`);
  if (source === "made" && (!rows || typeof rows !== "object" || Array.isArray(rows))) throw fail(400, "a made-up set is an object of tools, each an object of tables, each a list of rows");
  // a made-up set is checked against the tables as they stand before anything is rebuilt, then built with; only a
  // set that fits is kept as the source in force
  if (source === "made") {
    const problems = [];
    for (const [mod, tables] of Object.entries(rows)) {
      if (!(await q("SELECT 1 FROM platform.modules WHERE company=$1 AND name=$2", [company, mod])).rows.length) { problems.push(`there is no tool named ${mod}`); continue; }
      if (await hasSchema(company, mod)) problems.push(...migrate.rowsProblems(tables, await migrate.columnsByTable(migrate.testSchema(company, mod))).map((p) => `${mod}: ${p}`));
    }
    if (problems.length) throw Object.assign(fail(400, `the made-up rows do not fit: ${problems.join("; ")}`), { problems });
  }
  const built = await buildAll(company, source !== undefined ? { source, madeRows: source === "made" ? rows : {} } : {});
  if (source !== undefined) {
    await q(`UPDATE platform.test_floors SET data_source=$2, made_rows=$3, made_note=$4, set_by=$5, set_person=$6, campaign_id=$7, updated_at=now() WHERE company=$1`,
      [company, source, source === "made" ? JSON.stringify(rows) : null, source === "made" ? String(note || "").slice(0, 300) || null : null, who && who.name ? who.name : who && who.role === "admin" ? "Anetix" : "The manager", who && who.person ? who.person : null, campaign_id || null]);
    await record("test_floor_data", { company, actor: who, after: source === "made" ? `made-up data: ${note || "a set the campaign proposed"}` : "a copy of the floor's data", detail: { source, campaign_id: campaign_id || null, tables: source === "made" ? Object.fromEntries(Object.entries(rows).map(([m, t]) => [m, Object.fromEntries(Object.entries(t || {}).map(([tb, r]) => [tb, Array.isArray(r) ? r.length : 0]))])) : null } });
  }
  await q("UPDATE platform.test_floors SET reset_at=now(), built_at=now(), updated_at=now() WHERE company=$1", [company]);
  await logEvent("test_floor_reset", company, { source: built.source, by: who && who.name });
  await record("test_floor_reset", { company, actor: who, after: `the test floor's data was put back (${built.source === "made" ? "the made-up set" : "a copy of the floor"})`, detail: { source: built.source, tools: built.built } });
  return { ok: true, ...built, ...(await status(company)) };
}

// ---- moves --------------------------------------------------------------------------------------
// The floor moved (deploy, switch, rollback): a tool that is not under test follows it, data kept.
async function afterDeploy(company, mod, version) {
  if (!(await isOn(company))) return;
  const m = (await q("SELECT test_version, live_version FROM platform.modules WHERE company=$1 AND name=$2", [company, mod])).rows[0];
  if (!m || m.test_version != null) return;   // under test: the campaign moves it
  try {
    if (await hasSchema(company, mod)) await registry.mountTest(company, mod, Number(version));
    else { const row = (await floorRow(company)) || {}; await buildTool(company, mod, Number(version), { source: row.data_source || "floor", rows: (row.made_rows || {})[mod] }); }
  } catch (e) { console.error(`[testfloor] ${company}/${mod} did not follow the floor to v${version}: ${e.message}`); }
}
// A build under test: put that version on the test floor for its tool (src/campaign.js). back = true returns
// the tool to the floor's version.
async function setUnderTest(company, mod, version, { rebuild = true, source, rows } = {}) {
  if (!(await isOn(company))) throw fail(404, "this company has no test floor");
  await q("UPDATE platform.modules SET test_version=$3 WHERE company=$1 AND name=$2", [company, mod, version == null ? null : Number(version)]);
  const m = (await q("SELECT * FROM platform.modules WHERE company=$1 AND name=$2", [company, mod])).rows[0];
  const v = effective(m);
  if (v == null) return null;
  const row = await floorRow(company);
  if (rebuild) return buildTool(company, mod, v, { source: source || (row && row.data_source) || "floor", rows: rows || ((row && row.made_rows) || {})[mod] });
  await registry.mountTest(company, mod, v);
  return { version: v };
}
async function hasSchema(company, mod) {
  return (await q("SELECT 1 FROM pg_namespace WHERE nspname=$1", [migrate.testSchema(company, mod)])).rows.length > 0;
}

// ---- boot and delete -------------------------------------------------------------------------------
// After every mount at boot: every company with the switch on gets its test floor back. A schema that is missing
// (a restore, a fresh instance from a backup) is built again from the floor; one that exists is mounted as it is.
async function boot() {
  const cos = (await q("SELECT slug FROM platform.companies WHERE test_floor=true ORDER BY created_at")).rows;
  for (const c of cos) {
    const row = await floorRow(c.slug);
    const mods = (await q("SELECT * FROM platform.modules WHERE company=$1 ORDER BY name", [c.slug])).rows;
    let n = 0;
    for (const m of mods) {
      const v = effective(m);
      if (v == null) continue;
      try {
        if (await hasSchema(c.slug, m.name)) await registry.mountTest(c.slug, m.name, v);
        else await buildTool(c.slug, m.name, v, { source: (row && row.data_source) || "floor", rows: ((row && row.made_rows) || {})[m.name] });
        n++;
      } catch (e) { console.error(`[testfloor] ${c.slug}/${m.name} did not come up on the test floor: ${e.message}`); }
    }
    console.log(`[testfloor] ${c.slug}: test floor on, ${n} tool${n === 1 ? "" : "s"} up`);
  }
}
async function deleteCompany(company) {
  const mods = (await q("SELECT name FROM platform.modules WHERE company=$1", [company])).rows.map((m) => m.name);
  for (const m of mods) { await registry.unmountTest(company, m).catch(() => {}); await migrate.dropTestSchema(company, m).catch(() => {}); }
  await q("DELETE FROM platform.test_floors WHERE company=$1", [company]);
}
// A new tool on the floor (a library module added, a new module built): give it a test copy too.
async function afterModuleAdded(company, mod, version) { return afterDeploy(company, mod, version); }

// ---- routes ---------------------------------------------------------------------------------------
const router = express.Router();
const json = express.json({ limit: "2mb" });
const requireAdmin = (req, res, next) => require("./auth").requireAdmin(req, res, next);
const requireManager = (req, res, next) => require("./auth").requireManager(req, res, next);
const guard = (fn) => async (req, res) => { try { await fn(req, res); } catch (e) { res.status(e.status || 500).json({ error: e.message, problems: e.problems }); } };
const who = (req) => actor(req, req.sosAccount && req.sosAccount.name ? req.sosAccount.name : null);

router.post("/api/admin/companies/:slug/test-floor", requireAdmin, json, guard(async (req, res) => {
  const co = (await q("SELECT slug FROM platform.companies WHERE slug=$1", [req.params.slug])).rows[0];
  if (!co) throw fail(404, "unknown company");
  const on = Boolean((req.body || {}).on);
  res.json(on ? await turnOn(co.slug, who(req)) : await turnOff(co.slug, who(req)));
}));
router.get("/api/c/:slug/test-floor", guard(async (req, res) => {
  res.set("Cache-Control", "no-store").json(await status(req.params.slug));
}));
router.post("/api/c/:slug/test-floor/reset", requireManager, json, guard(async (req, res) => {
  const b = req.body || {};
  res.json(await reset(req.params.slug, who(req), { source: b.source, rows: b.rows, note: b.note }));
}));

module.exports = { init, router, hooks, isOn, status, floorRow, effective, turnOn, turnOff, reset, setUnderTest, afterDeploy, afterModuleAdded, boot, deleteCompany, hasSchema, SOURCES };
