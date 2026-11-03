// The floor's side of the map and the agent board (VSM copy, 2026-11-02, with M3): which screens of a tool are the
// floor's, which station screen is a box's, and the one line an agent may show there.
//
// Brendan's calls:
//   - Agent board decision 6 (2026-11-02): the floor sees a flag only as an experiment, "since nobody knows how people
//     will take it": a switch per agent, off by default, and one line on that box's station screen only.
//   - The line is read only (2026-11-02): the words and how long the flag has been open. Managers still mark it Seen or
//     On it on the agent board; nothing on the floor's screen changes a flag.
//
// Screen tags. Since 2026-10-29 a tool's module.json says who each screen is for ("for": "floor" or "office"); tools
// built before that carry no tag until a build adds one. A tag is where a screen is used, not code, so a manager sets it
// here without a build (platform.screen_tags, by route) and it wins over the manifest's. Picking a box's station screen
// on the Map tags that screen "floor" when it had no tag. The board's QR codes and the station picker read the tags
// through applyTags; a build's page check still reads only the manifest.
//
// A box's station screen is kept in its detail (detail.screen = { module, route }), like its steps: a screen of one of
// the box's own tools, checked against the tool's live screens when it is set.
//
// The line (GET /api/c/:slug/who/line?module=&page=): under /who because the feedback button on a tool's screen asks
// for it, and the tool page policy opens /who to the company's own devices. It answers for a live screen only (never a
// preview or the test floor), and only with the most urgent open flag of an agent whose switch is on and whose box names
// that screen. It gives the words the board already shows a manager, cut to a line, with no model name and no cost.
// A floor device being shown it is counted on the flag in ten-minute slices (floor_views), so the experiment can be
// read on the agent board and in the admin MCP's counts.
const express = require("express");
const { q } = require("./db");
const record = require("./record");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS platform.screen_tags (
  company   TEXT NOT NULL,
  module    TEXT NOT NULL,
  route     TEXT NOT NULL,
  for_who   TEXT NOT NULL,
  set_by    TEXT,
  set_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company, module, route)
);
ALTER TABLE platform.vsm_agents ADD COLUMN IF NOT EXISTS floor_line BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE platform.vsm_flags ADD COLUMN IF NOT EXISTS floor_views INTEGER NOT NULL DEFAULT 0;
ALTER TABLE platform.vsm_flags ADD COLUMN IF NOT EXISTS floor_seen_at TIMESTAMPTZ;`;
async function init() { await q(SCHEMA); }
const TABLES = ["screen_tags"];
const FOR = ["floor", "office"];
const LINE_CHARS = 160;
const VIEW_SLICE_MIN = 10;

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const txt = (v, n) => String(v == null ? "" : v).replace(/\r\n?/g, "\n").trim().slice(0, n);
const whoOf = (req) => (req && ((req.sosAccount && (req.sosAccount.name || req.sosAccount.login)) || req.sosPerson)) || (req && req.sosRole === "admin" ? "Anetix" : "a manager");

// ---- pure ----------------------------------------------------------------------------------------------------------
// The route of a screen a page address is on: the most specific route that fits. More parts first, then the one with a
// word where the other has a :parameter (so /station/new beats /station/:seq for /station/new; round 3), then length.
function routeOf(routes, rel) {
  const r = String(rel || "/").split("?")[0].replace(/\/+$/, "") || "/";
  const fits = (route) => {
    if (route === "/" || route === "") return r === "/";
    const re = new RegExp("^" + String(route).replace(/\/+$/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/:[^/]+/g, "[^/]+") + "$");
    return re.test(r);
  };
  const parts = (x) => String(x).replace(/\/+$/, "").split("/").filter(Boolean);
  const order = (a, b) => {
    const pa = parts(a), pb = parts(b);
    if (pa.length !== pb.length) return pb.length - pa.length;
    for (let i = 0; i < pa.length; i++) { const la = !pa[i].startsWith(":"), lb = !pb[i].startsWith(":"); if (la !== lb) return la ? -1 : 1; }
    return String(b).length - String(a).length;
  };
  return [...routes].sort(order).find(fits) || null;
}
// A live tool screen's address, split: /c/<slug>/m/<tool>/<rest>. A preview or the test floor is not one.
function liveRel(company, mod, page) {
  const p = String(page || "").split("?")[0];
  const base = `/c/${company}/m/${mod}`;
  if (p !== base && !p.startsWith(`${base}/`)) return null;
  return p.slice(base.length) || "/";
}
// the order a screen list is shown in: the floor's first, untagged next, the office's last
const rank = (s) => (s.for === "floor" ? 0 : s.for === "office" ? 2 : 1);

// ---- screen tags ---------------------------------------------------------------------------------------------------
async function tagsOf(company) {
  const rows = (await q("SELECT module, route, for_who FROM platform.screen_tags WHERE company=$1", [company])).rows;
  const by = {};
  for (const r of rows) (by[r.module] = by[r.module] || {})[r.route] = r.for_who;
  return by;
}
// list: screenPaths entries of one tool. A manager's tag wins over the manifest's; tag_by_manager says which it is.
function applyTags(list, tags) {
  return (list || []).map((s) => (tags && tags[s.route] ? { ...s, for: tags[s.route], tag_by_manager: true } : s));
}
function liveScreens(company, mod, row) {
  const registry = require("./registry");
  if (!row || !row.live_version) return [];
  try { return require("./pageload").screenPaths(registry.readManifest(company, mod, row.live_version)); } catch (e) { return []; }
}
// Every live screen of the company's tools (or of the ones named), tagged, the floor's first.
async function screensOf(company, modules) {
  const rows = (await q("SELECT name, title, live_version FROM platform.modules WHERE company=$1 AND live_version IS NOT NULL AND archived_at IS NULL ORDER BY title", [company])).rows
    .filter((m) => !modules || modules.includes(m.name));
  const tags = await tagsOf(company);
  const out = {};
  for (const m of rows) out[m.name] = applyTags(liveScreens(company, m.name, m), tags[m.name]).map((s) => ({ route: s.route, path: s.path, label: s.label, for: s.for, tag_by_manager: Boolean(s.tag_by_manager) })).sort((a, b) => rank(a) - rank(b));
  return out;
}
async function setTag(req, company, mod, route, forWho) {
  const row = (await q("SELECT name, live_version FROM platform.modules WHERE company=$1 AND name=$2 AND archived_at IS NULL", [company, String(mod || "")])).rows[0];
  if (!row) throw bad("no such tool", 404);
  const screens = liveScreens(company, row.name, row);
  const s = screens.find((x) => x.route === route);
  if (!s) throw bad("That is not a screen of this tool's live version.");
  if (forWho != null && !FOR.includes(forWho)) throw bad("A screen is for the floor or the office.");
  const before = (await q("SELECT for_who FROM platform.screen_tags WHERE company=$1 AND module=$2 AND route=$3", [company, row.name, route])).rows[0];
  if (forWho == null) await q("DELETE FROM platform.screen_tags WHERE company=$1 AND module=$2 AND route=$3", [company, row.name, route]);
  else await q(`INSERT INTO platform.screen_tags (company, module, route, for_who, set_by) VALUES ($1,$2,$3,$4,$5)
                ON CONFLICT (company, module, route) DO UPDATE SET for_who=EXCLUDED.for_who, set_by=EXCLUDED.set_by, set_at=now()`, [company, row.name, route, forWho, whoOf(req)]);
  await record.record("screen_tagged", { company, module: row.name, actor: record.actor(req), before: before ? before.for_who : (s.for || null), after: forWho || (s.for || null), detail: { route, label: s.label } });
  return { route, for: forWho || s.for || null, tag_by_manager: forWho != null };
}

// ---- a box's station screen --------------------------------------------------------------------------------------------
// raw: { module, route } or null. The tool must be one of the box's own and the route one of its live screens; an
// untagged screen picked here becomes the floor's.
async function cleanScreen(req, company, raw, boxModules) {
  if (raw == null || raw === "" || (typeof raw === "object" && !raw.module)) return null;
  const mod = txt(raw.module, 60), route = txt(raw.route, 200);
  if (!(boxModules || []).includes(mod)) throw bad("A box's station screen is a screen of one of the box's own tools. Tick the tool on the box first.");
  const all = await screensOf(company, [mod]);
  const s = (all[mod] || []).find((x) => x.route === route);
  if (!s) throw bad("That is not a screen of the tool's live version.");
  if (!s.for) await setTag(req, company, mod, route, "floor");
  return { module: mod, route, label: s.label };
}

// ---- the line ------------------------------------------------------------------------------------------------------
async function lineFor(company, mod, page, role) {
  const rel = liveRel(company, mod, page);
  if (rel == null) return null;
  const row = (await q("SELECT name, live_version FROM platform.modules WHERE company=$1 AND name=$2 AND archived_at IS NULL", [company, mod])).rows[0];
  if (!row || !row.live_version) return null;
  const route = routeOf(liveScreens(company, mod, row).map((s) => s.route), rel);
  if (route == null) return null;
  // the boxes of the maps in use whose station screen this is, and the agents named on them with the switch on
  const boxes = (await q(`SELECT m.key AS map_key, n.key, n.label, coalesce(n.detail->>'agent_name','') AS agent_name
                            FROM platform.vsm_nodes n JOIN platform.vsm_maps m ON m.id=n.map_id
                           WHERE n.company=$1 AND NOT m.proposed AND m.replaced_at IS NULL AND m.state='current'
                             AND n.detail->'screen'->>'module'=$2 AND n.detail->'screen'->>'route'=$3`, [company, mod, route])).rows;
  const keys = [...new Set(boxes.map((b) => require("./vsm-agents").slugify(b.agent_name)).filter(Boolean))];
  if (!keys.length) return null;
  const agents = (await q("SELECT id, key, name FROM platform.vsm_agents WHERE company=$1 AND key = ANY($2) AND status='on' AND floor_line", [company, keys])).rows;
  if (!agents.length) return null;
  const f = (await q(`SELECT f.thread_id, f.agent_id, f.severity, f.status, f.opened_at, f.climbed_at, m.words
                        FROM platform.vsm_flags f JOIN platform.vsm_messages m ON m.id=f.thread_id
                       WHERE f.company=$1 AND f.agent_id = ANY($2) AND f.status IN ('open','seen','on_it') AND f.closed_at IS NULL
                       ORDER BY (f.climbed_at IS NOT NULL) DESC, (f.severity='act') DESC, f.opened_at ASC LIMIT 1`, [company, agents.map((a) => a.id)])).rows[0];
  if (!f) return null;
  const a = agents.find((x) => x.id === f.agent_id);
  let words = require("./assist").scrubText(String(f.words || "").replace(/\s+/g, " ").trim());
  if (words.length > LINE_CHARS) words = `${words.slice(0, LINE_CHARS - 1).trimEnd()}\u2026`;
  if (role === "floor") await q(`UPDATE platform.vsm_flags SET floor_views=floor_views+1, floor_seen_at=now() WHERE thread_id=$1 AND (floor_seen_at IS NULL OR floor_seen_at < now() - interval '${VIEW_SLICE_MIN} minutes')`, [f.thread_id]);
  return { words, severity: f.severity === "act" || f.climbed_at ? "act" : "look", since_min: Math.max(0, Math.round((Date.now() - new Date(f.opened_at).getTime()) / 60000)), agent: a ? a.name : "", status: f.status };
}

// ---- the switch on an agent (from editAgent, src/vsm-agents.js) ------------------------------------------------------
// The station screens of an agent's boxes, for its panel on the agent board: a switch with nowhere to show says so.
async function stationsOf(company) {
  const rows = (await q(`SELECT n.key, n.label, coalesce(n.detail->>'agent_name','') AS agent_name, n.detail->'screen' AS screen, m.key AS map_key
                           FROM platform.vsm_nodes n JOIN platform.vsm_maps m ON m.id=n.map_id
                          WHERE n.company=$1 AND NOT m.proposed AND m.replaced_at IS NULL AND m.state='current' AND n.detail ? 'screen'`, [company])).rows;
  const titles = Object.fromEntries((await q("SELECT name, title FROM platform.modules WHERE company=$1", [company])).rows.map((r) => [r.name, r.title || r.name]));
  const by = {};
  for (const r of rows) {
    const k = require("./vsm-agents").slugify(r.agent_name); if (!k || !r.screen) continue;
    (by[k] = by[k] || []).push({ box: r.label, tool: titles[r.screen.module] || r.screen.module, screen: r.screen.label || r.screen.route });
  }
  return by;
}

async function deleteCompany(company) { await q("DELETE FROM platform.screen_tags WHERE company=$1", [company]); }

// ---- routes --------------------------------------------------------------------------------------------------------
const router = express.Router();
const requireManager = (req, res, next) => require("./auth").requireManager(req, res, next);
const slugOf = (req) => String(req.params.slug || "").toLowerCase();
// any device of the company (the feedback button asks from a tool's screen)
router.get("/api/c/:slug/who/line", async (req, res) => {
  const line = await lineFor(slugOf(req), String(req.query.module || "").slice(0, 60), String(req.query.page || "").slice(0, 300), req.sosRole);
  res.set("Cache-Control", "no-store").json({ line });
});
// managers: who a screen is for. On a path the tool page policy does not open.
router.post("/api/c/:slug/screens/:module/tag", requireManager, express.json({ limit: "8kb" }), async (req, res) => {
  const b = req.body || {};
  res.json({ ok: true, screen: await setTag(req, slugOf(req), String(req.params.module || ""), txt(b.route, 200), b.for == null || b.for === "" ? null : String(b.for)) });
});

module.exports = { init, SCHEMA, TABLES, router, routeOf, liveRel, applyTags, tagsOf, screensOf, setTag, cleanScreen, lineFor, stationsOf, deleteCompany, LINE_CHARS };
