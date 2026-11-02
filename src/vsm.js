// The value stream map: the plant's second primary view beside the Kaizen board (docs/VSM.md, milestone M1,
// 2026-11-01). One map per product family, drawn the way a lean practitioner draws one (information on top, material
// below, inventory between steps, the timeline ladder at the bottom), with one thing the paper method does not have:
// where each step's record lives. An Anetix tool, another system (Fishbowl, Shopify, QuickBooks, HubSpot), paper or
// word of mouth, or nothing.
//
// What M1 is (Brendan, 2026-11-01): managers and admins see the map (the floor keeps its station screens); a manager
// lands on Kaizen and the Map is a tab; a manager answers the review questions and makes small edits (a box's record,
// tools, who, numbers, its place on the map); boxes and flows are added by an import for now, and by the mapping walk
// in M2. Coverage is two numbers: stages with an Anetix tool built, and stages whose tool is in daily use, worked out
// live from the tool's own use (module_use, below).
//
// Tables (all per company, all in backup.js PLATFORM_TABLES, all gone with the company):
//   vsm_stages     the plant's stage list (Chelsea: Arthur's 20 master stages), where each one's record lives today,
//                  the Anetix tools that hold it, the phase that moves it, the record when done. Coverage counts these.
//   vsm_maps       one per product family: its title and the layout bits that are not boxes (the control band, the
//                  ladder's row).
//   vsm_nodes      a box on a map: process, control (production control's steps), supplier, customer, outside. Its
//                  place, its record, its tools, its data box rows, and the detail the panel shows (what happens, what
//                  is and is not recorded, the evidence and its quote).
//   vsm_edges      a flow between two boxes by key: push, pull, fifo, supply, ship, info_system, info_word. Which
//                  sides it leaves and enters; the renderer routes it, so a dragged box keeps its flows.
//   vsm_questions  the review queue: the places the map is guessing, answered by a manager (confirmed, or needs a fix
//                  with the right answer).
//   vsm_kaizen     the bursts on a map, numbered, tied to a box.
//   module_use     per tool per day: screens opened and changes made by the company's own people (floor and manager
//                  sessions; Anetix's admin sessions do not count). "In daily use" reads it.
//
// Routes (managers and admins; everything under /api/c/:slug/, so auth.companyGuard scopes it, and every id is also
// checked against the company in its own WHERE):
//   GET  /api/c/:slug/vsm                         the maps, the stages, coverage, the open questions
//   GET  /api/c/:slug/vsm/maps/:id                one map: boxes, flows, bursts, its questions, the company's tools
//   POST /api/c/:slug/vsm/nodes/:id               a small edit of one box
//   POST /api/c/:slug/vsm/stages/:id              a small edit of one stage
//   POST /api/c/:slug/vsm/questions/:id/answer    { status: confirmed | fix | open, answer }
//   GET  /api/c/:slug/vsm/export                  the company's map as one JSON file (format anetix-map-1)
//   POST /api/c/:slug/vsm/import                  admin only: replace the company's map with a file
// Every change goes on the record (map_changed, stage_changed, map_question_answered, map_imported).
const express = require("express");
const { q, pool } = require("./db");
const record = require("./record");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS platform.vsm_stages (
  id            SERIAL PRIMARY KEY,
  company       TEXT NOT NULL,
  ref           TEXT NOT NULL,
  name          TEXT NOT NULL,
  who           TEXT NOT NULL DEFAULT '',
  record_kind   TEXT NOT NULL DEFAULT 'none',
  record_system TEXT NOT NULL DEFAULT '',
  modules       TEXT[] NOT NULL DEFAULT '{}',
  anetix_note   TEXT NOT NULL DEFAULT '',
  phase         TEXT NOT NULL DEFAULT '',
  target        TEXT NOT NULL DEFAULT '',
  sort          INTEGER NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company, ref)
);
CREATE TABLE IF NOT EXISTS platform.vsm_maps (
  id          SERIAL PRIMARY KEY,
  company     TEXT NOT NULL,
  key         TEXT NOT NULL,
  family      TEXT NOT NULL,
  title       TEXT NOT NULL,
  state       TEXT NOT NULL DEFAULT 'current',
  status      TEXT NOT NULL DEFAULT 'draft',
  layout      JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company, key)
);
CREATE TABLE IF NOT EXISTS platform.vsm_nodes (
  id            SERIAL PRIMARY KEY,
  company       TEXT NOT NULL,
  map_id        INTEGER NOT NULL REFERENCES platform.vsm_maps(id) ON DELETE CASCADE,
  key           TEXT NOT NULL,
  kind          TEXT NOT NULL,
  label         TEXT NOT NULL,
  sub           TEXT NOT NULL DEFAULT '',
  who           TEXT NOT NULL DEFAULT '',
  stage_refs    TEXT[] NOT NULL DEFAULT '{}',
  record_kind   TEXT NOT NULL DEFAULT 'none',
  record_system TEXT NOT NULL DEFAULT '',
  modules       TEXT[] NOT NULL DEFAULT '{}',
  x INTEGER NOT NULL DEFAULT 0, y INTEGER NOT NULL DEFAULT 0, w INTEGER NOT NULL DEFAULT 144, h INTEGER NOT NULL DEFAULT 64,
  data          JSONB NOT NULL DEFAULT '[]'::jsonb,
  detail        JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence    TEXT NOT NULL DEFAULT 'assumed',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    TEXT,
  UNIQUE (map_id, key)
);
CREATE TABLE IF NOT EXISTS platform.vsm_edges (
  id          SERIAL PRIMARY KEY,
  company     TEXT NOT NULL,
  map_id      INTEGER NOT NULL REFERENCES platform.vsm_maps(id) ON DELETE CASCADE,
  from_key    TEXT NOT NULL,
  to_key      TEXT NOT NULL,
  kind        TEXT NOT NULL,
  label       TEXT NOT NULL DEFAULT '',
  from_side   TEXT NOT NULL DEFAULT 'right',
  to_side     TEXT NOT NULL DEFAULT 'left',
  from_at     REAL NOT NULL DEFAULT 0.5,
  to_at       REAL NOT NULL DEFAULT 0.5,
  inventory   JSONB,
  sort        INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS platform.vsm_questions (
  id           SERIAL PRIMARY KEY,
  company      TEXT NOT NULL,
  map_key      TEXT,
  node_key     TEXT,
  where_label  TEXT NOT NULL DEFAULT '',
  claim        TEXT NOT NULL,
  why          TEXT NOT NULL DEFAULT '',
  confidence   TEXT NOT NULL DEFAULT 'assumed',
  status       TEXT NOT NULL DEFAULT 'open',
  answer       TEXT NOT NULL DEFAULT '',
  answered_by  TEXT,
  answered_at  TIMESTAMPTZ,
  sort         INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS platform.vsm_kaizen (
  id          SERIAL PRIMARY KEY,
  company     TEXT NOT NULL,
  map_id      INTEGER NOT NULL REFERENCES platform.vsm_maps(id) ON DELETE CASCADE,
  node_key    TEXT,
  n           INTEGER NOT NULL,
  title       TEXT NOT NULL,
  why         TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'open',
  feedback_id INTEGER
);
CREATE TABLE IF NOT EXISTS platform.module_use (
  company  TEXT NOT NULL,
  module   TEXT NOT NULL,
  day      DATE NOT NULL,
  views    INTEGER NOT NULL DEFAULT 0,
  changes  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (company, module, day)
);
CREATE INDEX IF NOT EXISTS vsm_nodes_map ON platform.vsm_nodes (map_id);
CREATE INDEX IF NOT EXISTS vsm_edges_map ON platform.vsm_edges (map_id);
CREATE INDEX IF NOT EXISTS vsm_questions_company ON platform.vsm_questions (company, sort);`;
async function init() { await q(SCHEMA); setInterval(() => flushUse().catch((e) => console.error("[vsm] use:", e.message)), USE_FLUSH_MS).unref(); }

const TABLES = ["vsm_stages", "vsm_maps", "vsm_nodes", "vsm_edges", "vsm_questions", "vsm_kaizen", "module_use"];
const RECORD_KINDS = ["anetix", "next", "other", "paper", "none"];
const NODE_KINDS = ["process", "control", "supplier", "customer", "outside", "store"];
const EDGE_KINDS = ["push", "pull", "fifo", "supermarket", "supply", "ship", "info_system", "info_word"];
const SIDES = ["left", "right", "top", "bottom"];
const CONFIDENCE = ["heard", "seen", "assumed", "confirmed"];
const ANSWERS = ["confirmed", "fix", "open"];
// "In daily use": the company's own people changed something in the tool on at least DAILY_MIN of the last DAILY_DAYS
// days. Chelsea's first floor works four days a week, so "every day" would never be true there.
const DAILY_DAYS = 14, DAILY_MIN = 5;

const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
const notFound = (what) => Object.assign(new Error(`no such ${what}`), { status: 404 });
const txt = (v, n) => String(v == null ? "" : v).replace(/\r\n?/g, "\n").trim().slice(0, n);
const one = (v, allowed, what) => { if (!allowed.includes(v)) throw bad(`${what} must be one of ${allowed.join(", ")}`); return v; };
const strList = (v, n, each) => (Array.isArray(v) ? v : []).map((x) => txt(x, each)).filter(Boolean).slice(0, n);
const int = (v, lo, hi) => { const n = Math.round(Number(v)); if (!Number.isFinite(n)) throw bad("a position must be a number"); return Math.max(lo, Math.min(hi, n)); };
const KEY = /^[a-z0-9][a-z0-9_-]{0,39}$/i;
const who = (req) => (req.sosAccount && (req.sosAccount.name || req.sosAccount.login)) || req.sosPerson || req.sosRole || "manager";

// ---- tool use (module_use): counted in memory as requests come in, written once a minute
const USE_FLUSH_MS = Number(process.env.SOS_USE_FLUSH_MS || 60000);
const pending = new Map();
function noteUse(company, module, kind) {
  const day = new Date().toISOString().slice(0, 10);
  const k = `${company}\u0000${module}\u0000${day}`;
  const c = pending.get(k) || { company, module, day, views: 0, changes: 0 };
  if (kind === "change") c.changes++; else c.views++;
  pending.set(k, c);
}
// From the live mount of a tool (registry.attach): a screen opened or a change made by the company's own people.
// Admin sessions are Anetix's and the platform's own calls carry no role; neither counts.
function useMiddleware(req, res, next) {
  const role = req.sosRole;
  if (role === "floor" || role === "manager") {
    const company = req.params.company, module = req.params.module;
    const change = !["GET", "HEAD", "OPTIONS"].includes(req.method);
    const view = !change && !/^\/api(\/|$)/.test(req.path) && !/\.[a-z0-9]{1,5}$/i.test(req.path);
    if (change || view) res.on("finish", () => { if (res.statusCode < 400) noteUse(company, module, change ? "change" : "view"); });
  }
  next();
}
async function flushUse() {
  if (!pending.size) return;
  const rows = [...pending.values()]; pending.clear();
  for (const r of rows) {
    await q(`INSERT INTO platform.module_use (company, module, day, views, changes) VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (company, module, day) DO UPDATE SET views = module_use.views + EXCLUDED.views, changes = module_use.changes + EXCLUDED.changes`,
      [r.company, r.module, r.day, r.views, r.changes]);
  }
}

// ---- reading
async function tools(company) {
  const mods = (await q(`SELECT name, title, live_version, archived_at FROM platform.modules WHERE company=$1 ORDER BY title`, [company])).rows;
  const use = (await q(`SELECT module, count(*) FILTER (WHERE changes > 0)::int AS days_changed, count(*)::int AS days_opened, max(day) AS last_day
                          FROM platform.module_use WHERE company=$1 AND day >= current_date - $2::int GROUP BY module`, [company, DAILY_DAYS - 1])).rows;
  const by = Object.fromEntries(use.map((u) => [u.module, u]));
  return mods.map((m) => {
    const u = by[m.name] || {};
    return { name: m.name, title: m.title || m.name, live: Boolean(m.live_version) && !m.archived_at, archived: Boolean(m.archived_at),
      days_changed: u.days_changed || 0, days_opened: u.days_opened || 0, last_used: u.last_day || null,
      daily: (u.days_changed || 0) >= DAILY_MIN && Boolean(m.live_version) && !m.archived_at };
  });
}
function coverage(stages, toolList) {
  const live = new Set(toolList.filter((t) => t.live).map((t) => t.name));
  const daily = new Set(toolList.filter((t) => t.daily).map((t) => t.name));
  const c = { total: stages.length, built: 0, daily: 0, next: 0, other: 0, paper: 0, none: 0, anetix_without_tool: 0, rule: { days: DAILY_DAYS, min_days: DAILY_MIN } };
  for (const s of stages) {
    if (s.record_kind === "anetix") {
      if (s.modules.some((m) => live.has(m))) c.built++; else c.anetix_without_tool++;
      if (s.modules.some((m) => daily.has(m))) c.daily++;
    } else if (c[s.record_kind] !== undefined) c[s.record_kind]++;
  }
  return c;
}
async function overview(company, role) {
  const maps = (await q(`SELECT id, key, family, title, state, status, updated_at FROM platform.vsm_maps WHERE company=$1 ORDER BY sort, id`, [company])).rows;
  const stages = (await q(`SELECT id, ref, name, who, record_kind, record_system, modules, anetix_note, phase, target FROM platform.vsm_stages WHERE company=$1 ORDER BY sort, ref`, [company])).rows;
  const toolList = await tools(company);
  const open = (await q(`SELECT count(*)::int AS n FROM platform.vsm_questions WHERE company=$1 AND status='open'`, [company])).rows[0].n;
  const co = (await q(`SELECT slug, name FROM platform.companies WHERE slug=$1`, [company])).rows[0] || { slug: company, name: company };
  return { company: co, role, maps, stages, tools: toolList, coverage: coverage(stages, toolList), questions_open: open, can_import: role === "admin" };
}
async function mapView(company, id) {
  const map = (await q(`SELECT id, key, family, title, state, status, layout, updated_at FROM platform.vsm_maps WHERE company=$1 AND id=$2`, [company, id])).rows[0];
  if (!map) throw notFound("map");
  const nodes = (await q(`SELECT id, key, kind, label, sub, who, stage_refs, record_kind, record_system, modules, x, y, w, h, data, detail, confidence, updated_at, updated_by
                            FROM platform.vsm_nodes WHERE company=$1 AND map_id=$2 ORDER BY id`, [company, id])).rows;
  const edges = (await q(`SELECT id, from_key, to_key, kind, label, from_side, to_side, from_at, to_at, inventory FROM platform.vsm_edges WHERE company=$1 AND map_id=$2 ORDER BY sort, id`, [company, id])).rows;
  const kaizen = (await q(`SELECT id, node_key, n, title, why, status, feedback_id FROM platform.vsm_kaizen WHERE company=$1 AND map_id=$2 ORDER BY n`, [company, id])).rows;
  const questions = (await q(`SELECT id, map_key, node_key, where_label, claim, why, confidence, status, answer, answered_by, answered_at
                                FROM platform.vsm_questions WHERE company=$1 AND (map_key IS NULL OR map_key=$2) ORDER BY (status='open') DESC, sort, id`, [company, map.key])).rows;
  return { map, nodes, edges, kaizen, questions, tools: await tools(company) };
}

// ---- small edits (M1): a box's words, record, tools, who, data box rows and place
const nodeFields = {
  label: (v) => { const s = txt(v, 80); if (!s) throw bad("a box needs a name"); return s; },
  sub: (v) => txt(v, 80),
  who: (v) => txt(v, 200),
  record_kind: (v) => one(v, RECORD_KINDS, "record"),
  record_system: (v) => txt(v, 120),
  modules: (v) => strList(v, 8, 60),
  confidence: (v) => one(v, CONFIDENCE, "confidence"),
  data: (v) => (Array.isArray(v) ? v : []).slice(0, 12).map((r) => ({ label: txt(r && r.label, 24), value: txt(r && r.value, 60) })).filter((r) => r.label),
  x: (v) => int(v, 0, 6000), y: (v) => int(v, 0, 4000),
};
async function editNode(req, company, id, body) {
  const before = (await q(`SELECT * FROM platform.vsm_nodes WHERE company=$1 AND id=$2`, [company, id])).rows[0];
  if (!before) throw notFound("box");
  const sets = [], vals = [company, id], changed = {};
  for (const [k, clean] of Object.entries(nodeFields)) {
    if (body[k] === undefined) continue;
    const v = clean(body[k]);
    changed[k] = v;
    vals.push(k === "data" ? JSON.stringify(v) : v);
    sets.push(`${k}=$${vals.length}${k === "data" ? "::jsonb" : ""}`);
  }
  if (body.notes !== undefined) { vals.push(txt(body.notes, 2000)); sets.push(`detail = jsonb_set(detail, '{notes}', to_jsonb($${vals.length}::text))`); changed.notes = vals[vals.length - 1]; }
  if (!sets.length) throw bad("nothing to change");
  if (changed.modules) {
    const known = new Set((await q(`SELECT name FROM platform.modules WHERE company=$1`, [company])).rows.map((r) => r.name));
    const unknown = changed.modules.filter((m) => !known.has(m));
    if (unknown.length) throw bad(`not a tool of this company: ${unknown.join(", ")}`);
  }
  vals.push(who(req));
  await q(`UPDATE platform.vsm_nodes SET ${sets.join(", ")}, updated_at=now(), updated_by=$${vals.length} WHERE company=$1 AND id=$2`, vals);
  await q(`UPDATE platform.vsm_maps SET updated_at=now() WHERE id=$1`, [before.map_id]);
  const moveOnly = Object.keys(changed).every((k) => k === "x" || k === "y");
  if (!moveOnly) {
    const was = Object.fromEntries(Object.keys(changed).map((k) => [k, k === "notes" ? (before.detail || {}).notes || "" : before[k]]));
    await record.record("map_changed", { company, actor: record.actor(req), before: JSON.stringify(was), after: JSON.stringify(changed), detail: { box: before.key, label: before.label, map_id: before.map_id } });
  }
  return (await q(`SELECT id, key, kind, label, sub, who, stage_refs, record_kind, record_system, modules, x, y, w, h, data, detail, confidence, updated_at, updated_by FROM platform.vsm_nodes WHERE id=$1`, [id])).rows[0];
}
const stageFields = { who: (v) => txt(v, 200), record_kind: (v) => one(v, RECORD_KINDS, "record"), record_system: (v) => txt(v, 160), modules: (v) => strList(v, 8, 60), anetix_note: (v) => txt(v, 300), phase: (v) => txt(v, 20), target: (v) => txt(v, 160) };
async function editStage(req, company, id, body) {
  const before = (await q(`SELECT * FROM platform.vsm_stages WHERE company=$1 AND id=$2`, [company, id])).rows[0];
  if (!before) throw notFound("stage");
  const sets = [], vals = [company, id], changed = {};
  for (const [k, clean] of Object.entries(stageFields)) {
    if (body[k] === undefined) continue;
    changed[k] = clean(body[k]); vals.push(changed[k]); sets.push(`${k}=$${vals.length}`);
  }
  if (!sets.length) throw bad("nothing to change");
  await q(`UPDATE platform.vsm_stages SET ${sets.join(", ")}, updated_at=now() WHERE company=$1 AND id=$2`, vals);
  const was = Object.fromEntries(Object.keys(changed).map((k) => [k, before[k]]));
  await record.record("stage_changed", { company, actor: record.actor(req), before: JSON.stringify(was), after: JSON.stringify(changed), detail: { stage: before.ref, name: before.name } });
  return (await q(`SELECT id, ref, name, who, record_kind, record_system, modules, anetix_note, phase, target FROM platform.vsm_stages WHERE id=$1`, [id])).rows[0];
}
async function answer(req, company, id, body) {
  const status = one(body.status, ANSWERS, "status");
  const words = txt(body.answer, 2000);
  if (status === "fix" && !words) throw bad("say what is right, so the map can be fixed");
  const before = (await q(`SELECT * FROM platform.vsm_questions WHERE company=$1 AND id=$2`, [company, id])).rows[0];
  if (!before) throw notFound("question");
  const by = status === "open" ? null : who(req);
  const row = (await q(`UPDATE platform.vsm_questions SET status=$3, answer=$4, answered_by=$5, answered_at=CASE WHEN $3='open' THEN NULL ELSE now() END
                         WHERE company=$1 AND id=$2 RETURNING id, map_key, node_key, where_label, claim, why, confidence, status, answer, answered_by, answered_at`,
    [company, id, status, status === "open" ? "" : words, by])).rows[0];
  await record.record("map_question_answered", { company, actor: record.actor(req), before: before.claim, after: words || status, detail: { question: id, status, where: before.where_label } });
  return row;
}

// ---- the whole map as one file: export for anyone who can see it, import (replace) for Anetix
async function exportMap(company) {
  const stages = (await q(`SELECT ref, name, who, record_kind, record_system, modules, anetix_note, phase, target FROM platform.vsm_stages WHERE company=$1 ORDER BY sort, ref`, [company])).rows;
  const maps = [];
  for (const m of (await q(`SELECT id, key, family, title, state, status, layout FROM platform.vsm_maps WHERE company=$1 ORDER BY sort, id`, [company])).rows) {
    const nodes = (await q(`SELECT key, kind, label, sub, who, stage_refs, record_kind, record_system, modules, x, y, w, h, data, detail, confidence FROM platform.vsm_nodes WHERE map_id=$1 ORDER BY id`, [m.id])).rows;
    const edges = (await q(`SELECT from_key AS "from", to_key AS "to", kind, label, from_side, to_side, from_at, to_at, inventory FROM platform.vsm_edges WHERE map_id=$1 ORDER BY sort, id`, [m.id])).rows;
    const kaizen = (await q(`SELECT node_key AS node, n, title, why, status FROM platform.vsm_kaizen WHERE map_id=$1 ORDER BY n`, [m.id])).rows;
    const { id, ...rest } = m;
    maps.push({ ...rest, nodes, edges, kaizen });
  }
  const questions = (await q(`SELECT map_key AS map, node_key AS node, where_label AS "where", claim, why, confidence, status, answer, answered_by FROM platform.vsm_questions WHERE company=$1 ORDER BY sort, id`, [company])).rows;
  return { format: "anetix-map-1", company, exported_at: new Date().toISOString(), stages, maps, questions };
}
// Checked for shape before anything is written; the whole replace is one transaction.
function checkImport(doc) {
  if (!doc || doc.format !== "anetix-map-1") throw bad("not an Anetix map file (format anetix-map-1)");
  const stages = (doc.stages || []).slice(0, 200).map((s, i) => {
    if (!txt(s.ref, 12) || !txt(s.name, 120)) throw bad(`stage ${i + 1} needs a ref and a name`);
    return { ref: txt(s.ref, 12), name: txt(s.name, 120), who: txt(s.who, 200), record_kind: one(s.record_kind || "none", RECORD_KINDS, "a stage's record"),
      record_system: txt(s.record_system, 160), modules: strList(s.modules, 8, 60), anetix_note: txt(s.anetix_note, 300), phase: txt(s.phase, 20), target: txt(s.target, 160), sort: i };
  });
  const keys = new Set();
  const maps = (doc.maps || []).slice(0, 20).map((m, mi) => {
    const key = txt(m.key, 40);
    if (!KEY.test(key) || keys.has(key)) throw bad(`map ${mi + 1} needs a unique key (letters, digits, - and _)`);
    keys.add(key);
    const nodeKeys = new Set();
    const nodes = (m.nodes || []).slice(0, 200).map((n) => {
      const k = txt(n.key, 40);
      if (!KEY.test(k) || nodeKeys.has(k)) throw bad(`map ${key}: every box needs a unique key`);
      nodeKeys.add(k);
      return { key: k, kind: one(n.kind, NODE_KINDS, `box ${k}'s kind`), label: txt(n.label, 80) || k, sub: txt(n.sub, 80), who: txt(n.who, 200),
        stage_refs: strList(n.stage_refs, 10, 12), record_kind: one(n.record_kind || "none", RECORD_KINDS, `box ${k}'s record`), record_system: txt(n.record_system, 120),
        modules: strList(n.modules, 8, 60), x: int(n.x || 0, 0, 6000), y: int(n.y || 0, 0, 4000), w: int(n.w || 144, 40, 1200), h: int(n.h || 64, 24, 600),
        data: nodeFields.data(n.data), detail: cleanDetail(n.detail), confidence: one(n.confidence || "assumed", CONFIDENCE, `box ${k}'s confidence`) };
    });
    const edges = (m.edges || []).slice(0, 400).map((e, i) => {
      const from = txt(e.from, 40), to = txt(e.to, 40);
      if (!nodeKeys.has(from) || !nodeKeys.has(to)) throw bad(`map ${key}: flow ${i + 1} joins a box that is not on the map`);
      return { from, to, kind: one(e.kind, EDGE_KINDS, `flow ${i + 1}'s kind`), label: txt(e.label, 80), from_side: one(e.from_side || "right", SIDES, "a side"), to_side: one(e.to_side || "left", SIDES, "a side"),
        from_at: Math.max(0, Math.min(1, Number(e.from_at) || 0.5)), to_at: Math.max(0, Math.min(1, Number(e.to_at) || 0.5)),
        inventory: e.inventory ? { label: txt(e.inventory.label, 40), note: txt(e.inventory.note, 200) } : null, sort: i };
    });
    const kaizen = (m.kaizen || []).slice(0, 50).map((z) => ({ node: z.node && nodeKeys.has(txt(z.node, 40)) ? txt(z.node, 40) : null, n: int(z.n || 0, 0, 999), title: txt(z.title, 160), why: txt(z.why, 400), status: txt(z.status, 20) || "open" }));
    const layout = { bands: (((m.layout || {}).bands) || []).slice(0, 10).map((b) => ({ label: txt(b.label, 60), note: txt(b.note, 200), x: int(b.x, 0, 6000), y: int(b.y, 0, 4000), w: int(b.w, 10, 6000), h: int(b.h, 10, 4000) })),
      ladder_y: (m.layout || {}).ladder_y != null ? int(m.layout.ladder_y, 0, 4000) : null,
      // what the agents would say to each other on this map: a concept until the agents exist (docs/VSM.md, section 8)
      feed: (((m.layout || {}).feed) || []).slice(0, 20).map((f) => ({ from: txt(f.from, 40), to: txt(f.to, 40), text: txt(f.text, 300), tag: txt(f.tag, 60), now: /^possible/i.test(String(f.tag || "")) })) };
    return { key, family: txt(m.family, 80) || key, title: txt(m.title, 120) || key, state: m.state === "future" ? "future" : "current", status: m.status === "confirmed" ? "confirmed" : "draft", layout, nodes, edges, kaizen, sort: mi };
  });
  const questions = (doc.questions || []).slice(0, 300).map((x, i) => ({ map: x.map && keys.has(txt(x.map, 40)) ? txt(x.map, 40) : null, node: txt(x.node, 40) || null, where: txt(x.where, 80),
    claim: (() => { const c = txt(x.claim, 600); if (!c) throw bad(`question ${i + 1} needs words`); return c; })(), why: txt(x.why, 1000),
    confidence: CONFIDENCE.includes(x.confidence) ? x.confidence : (x.confidence === "unknown" ? "assumed" : "assumed"), status: ANSWERS.includes(x.status) ? x.status : "open", answer: txt(x.answer, 2000), sort: i }));
  return { stages, maps, questions };
}
function cleanDetail(d) {
  const o = d && typeof d === "object" ? d : {};
  const out = {};
  for (const k of ["what", "recorded", "missing", "anetix", "agent", "agent_name", "kaizen", "quote", "quote_by", "source", "notes"]) if (o[k]) out[k] = txt(o[k], 1200);
  return out;
}
async function importMap(req, company, doc) {
  const c = checkImport(doc);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const t of ["vsm_questions", "vsm_kaizen", "vsm_edges", "vsm_nodes", "vsm_maps", "vsm_stages"]) await client.query(`DELETE FROM platform.${t} WHERE company=$1`, [company]);
    for (const s of c.stages) {
      await client.query(`INSERT INTO platform.vsm_stages (company, ref, name, who, record_kind, record_system, modules, anetix_note, phase, target, sort) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [company, s.ref, s.name, s.who, s.record_kind, s.record_system, s.modules, s.anetix_note, s.phase, s.target, s.sort]);
    }
    for (const m of c.maps) {
      const id = (await client.query(`INSERT INTO platform.vsm_maps (company, key, family, title, state, status, layout, sort) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [company, m.key, m.family, m.title, m.state, m.status, JSON.stringify(m.layout), m.sort])).rows[0].id;
      for (const n of m.nodes) {
        await client.query(`INSERT INTO platform.vsm_nodes (company, map_id, key, kind, label, sub, who, stage_refs, record_kind, record_system, modules, x, y, w, h, data, detail, confidence)
                            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17::jsonb,$18)`,
          [company, id, n.key, n.kind, n.label, n.sub, n.who, n.stage_refs, n.record_kind, n.record_system, n.modules, n.x, n.y, n.w, n.h, JSON.stringify(n.data), JSON.stringify(n.detail), n.confidence]);
      }
      for (const e of m.edges) {
        await client.query(`INSERT INTO platform.vsm_edges (company, map_id, from_key, to_key, kind, label, from_side, to_side, from_at, to_at, inventory, sort) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)`,
          [company, id, e.from, e.to, e.kind, e.label, e.from_side, e.to_side, e.from_at, e.to_at, e.inventory ? JSON.stringify(e.inventory) : null, e.sort]);
      }
      for (const z of m.kaizen) await client.query(`INSERT INTO platform.vsm_kaizen (company, map_id, node_key, n, title, why, status) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [company, id, z.node, z.n, z.title, z.why, z.status]);
    }
    for (const x of c.questions) {
      await client.query(`INSERT INTO platform.vsm_questions (company, map_key, node_key, where_label, claim, why, confidence, status, answer, sort) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [company, x.map, x.node, x.where, x.claim, x.why, x.confidence, x.status, x.answer, x.sort]);
    }
    await client.query("COMMIT");
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
  const counts = { stages: c.stages.length, maps: c.maps.length, boxes: c.maps.reduce((a, m) => a + m.nodes.length, 0), flows: c.maps.reduce((a, m) => a + m.edges.length, 0), questions: c.questions.length };
  await record.record("map_imported", { company, actor: record.actor(req), detail: counts });
  return counts;
}

async function deleteCompany(company) {
  for (const t of ["vsm_questions", "vsm_kaizen", "vsm_edges", "vsm_nodes", "vsm_maps", "vsm_stages", "module_use"]) await q(`DELETE FROM platform.${t} WHERE company=$1`, [company]);
}

// ---- routes
const router = express.Router();
const auth = () => require("./auth");
const requireManager = (req, res, next) => auth().requireManager(req, res, next);
const requireAdmin = (req, res, next) => auth().requireAdmin(req, res, next);
const slugOf = (req) => String(req.params.slug || "").toLowerCase();
const big = express.json({ limit: "5mb" });
const small = express.json({ limit: "64kb" });
router.get("/api/c/:slug/vsm", requireManager, async (req, res) => res.json(await overview(slugOf(req), req.sosRole)));
router.get("/api/c/:slug/vsm/maps/:id(\\d{1,9})", requireManager, async (req, res) => res.json(await mapView(slugOf(req), Number(req.params.id))));
router.post("/api/c/:slug/vsm/nodes/:id(\\d{1,9})", requireManager, small, async (req, res) => res.json({ ok: true, node: await editNode(req, slugOf(req), Number(req.params.id), req.body || {}) }));
router.post("/api/c/:slug/vsm/stages/:id(\\d{1,9})", requireManager, small, async (req, res) => res.json({ ok: true, stage: await editStage(req, slugOf(req), Number(req.params.id), req.body || {}) }));
router.post("/api/c/:slug/vsm/questions/:id(\\d{1,9})/answer", requireManager, small, async (req, res) => res.json({ ok: true, question: await answer(req, slugOf(req), Number(req.params.id), req.body || {}) }));
router.get("/api/c/:slug/vsm/export", requireManager, async (req, res) => {
  const slug = slugOf(req);
  res.set("Content-Disposition", `attachment; filename="${slug}-map-${new Date().toISOString().slice(0, 10)}.json"`).json(await exportMap(slug));
});
router.post("/api/c/:slug/vsm/import", requireAdmin, big, async (req, res) => {
  const slug = slugOf(req);
  if (!(await q("SELECT 1 FROM platform.companies WHERE slug=$1", [slug])).rows[0]) throw notFound("company");
  res.json({ ok: true, counts: await importMap(req, slug, req.body) });
});

module.exports = { init, SCHEMA, TABLES, router, useMiddleware, noteUse, flushUse, tools, coverage, overview, mapView, editNode, editStage, answer, exportMap, importMap, checkImport, deleteCompany, DAILY_DAYS, DAILY_MIN };
