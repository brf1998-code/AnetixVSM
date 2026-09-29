// Requests to Anetix: feedback about the software itself, and the way back (2026-09-24).
//
// A request filed from the improvement board or one of the platform's own pages (module "platform") is not built
// by the in-app agent: Brendan picks it up and ships the change through the repo. Until this there was no one
// place to see those requests (a manager session could read one company's at
// GET /api/c/<slug>/feedback/platform, and that was it) and nothing went back to the person who sent one. Brendan,
// 2026-09-24: a clear place to see the feedback from the boards, make it plain that it goes to him, and two-way
// communication so the person can see where it is while it is being addressed.
//
// The shape: a request is RECEIVED when it lands (nobody at Anetix has looked), then LOOKING AT IT, then WORKING ON
// IT, and it ends FIXED (what changed, in words the floor reads) or NOT DOING THIS (why). At any step Anetix can
// leave a word back. Where it stands is read three ways: the Requests tab of /admin (every company, newest first,
// the untouched ones marked), the "Requests to Anetix" strip on the company's board, and My requests on the
// feedback button of the person who sent it, which also carries a quiet "Anetix answered" badge until they open it.
//
// Columns on platform.feedback:
//   anetix_stage   NULL (received) | looking | working
//   anetix_note    the last word back, if any
//   anetix_at      when Anetix last touched it (the badge on the floor keys on this)
//   anetix_by      who (the admin account's name)
// A closed request keeps its stage; status (done | declined) and outcome say how it ended, as they always did.
// The manager's own Decline on the board strip (POST /api/feedback/:id/close) is unchanged and shows as declined.
//
// Routes (admin only; mounted with the other platform routes, so a module page's policy cannot reach them):
//   GET  /api/admin/requests?status=open|closed|all        every company's requests, plus counts
//   POST /api/admin/requests/:id        { stage, note }    move it along (also reopens a closed one), a word back
//   POST /api/admin/requests/:id/close  { answer, what }   fixed | not_doing, with what changed or why
// Record kinds: anetix_stage (before/after the stage, detail.note), feedback_closed (detail.by_anetix, answer).
const express = require("express");
const { q } = require("./db");
const { record } = require("./record");

const SCHEMA = `
ALTER TABLE platform.feedback ADD COLUMN IF NOT EXISTS anetix_stage TEXT;
ALTER TABLE platform.feedback ADD COLUMN IF NOT EXISTS anetix_note TEXT;
ALTER TABLE platform.feedback ADD COLUMN IF NOT EXISTS anetix_at TIMESTAMPTZ;
ALTER TABLE platform.feedback ADD COLUMN IF NOT EXISTS anetix_by TEXT;
CREATE INDEX IF NOT EXISTS feedback_platform ON platform.feedback (status, id DESC) WHERE module='platform';
ALTER TABLE platform.feedback ADD COLUMN IF NOT EXISTS anetix_kind TEXT;      -- NULL (the software itself) | integration
ALTER TABLE platform.feedback ADD COLUMN IF NOT EXISTS about_module TEXT;     -- integration: the tool it is for
ALTER TABLE platform.feedback ADD COLUMN IF NOT EXISTS about_system TEXT;     -- integration: the system, as the company calls it
ALTER TABLE platform.feedback ADD COLUMN IF NOT EXISTS about_kind TEXT;       -- integration: erp | printer | machine | scale | other
`;
async function init() { await q(SCHEMA); }

// Integration requests (2026-09-28). A request that asks to connect a tool to an outside system that is not turned on
// for it ("how do I connect Epicor to this?") is not a change the agent can build and not something for the manager
// to decline: the proposer hands it here (handoff), and so does a new tool's design for each outside system the
// manager named (handoffNew). It becomes a request to Anetix (module 'platform', so the strip, My requests and this
// tab all carry it) marked anetix_kind 'integration', with the tool in about_module and the system in about_system.
// The handoff is deliberately light for now: the integration team turns the connection on for the tool
// (connections.setAllowed, a button on the Requests tab), sets it up with the company, and closes it with Fixed.
const STAGES = ["received", "looking", "working"];
// The one line the floor and the manager read for a platform request. Pure. r: a feedback row (status, outcome,
// anetix_stage, anetix_note, anetix_by).
const STAGE_LINE = { received: "Sent to Anetix, the people who make this software. Nobody has looked yet.", looking: "Anetix is looking at it.", working: "Anetix is working on it." };
const INTEGRATION_LINE = { received: "Sent to Anetix's integration team, who connect outside systems like your ERP or a label printer. Nobody has looked yet.", looking: "Anetix's integration team is looking at it.", working: "Anetix's integration team is setting it up." };
function stateOf(r) {
  const note = r.anetix_note ? ` ${r.anetix_by || "Anetix"} says: "${String(r.anetix_note).trim()}"` : "";
  const ig = r.anetix_kind === "integration";
  if (r.status === "done") return { state: "anetix_fixed", line: `${ig ? "Connected by Anetix." : "Fixed by Anetix."}${r.outcome ? ` ${r.outcome}` : ""}` };
  if (r.status === "declined") {
    if (r.anetix_by) return { state: "anetix_not_doing", line: `${ig ? "Anetix is not connecting this one." : "Anetix is not doing this one."}${r.outcome ? ` ${r.outcome}` : ""}` };
    const why = r.outcome && !/^declined$/i.test(r.outcome) ? ` ${r.outcome}` : "";
    return { state: "declined", line: `Declined by the manager.${why}` };
  }
  const stage = STAGES.includes(r.anetix_stage) ? r.anetix_stage : "received";
  return { state: `anetix_${stage}`, line: (ig ? INTEGRATION_LINE : STAGE_LINE)[stage] + note };
}

const clean = (s, n) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);
const fail = (status, msg) => Object.assign(new Error(msg), { status });

async function get(id) {
  return (await q("SELECT * FROM platform.feedback WHERE id=$1 AND module='platform'", [Number(id) || 0])).rows[0] || null;
}
// Every company's requests, newest first. status: open (new) | closed (done or declined) | all.
async function list(status = "open") {
  const where = status === "open" ? "f.status='new'" : status === "closed" ? "f.status IN ('done','declined')" : "true";
  const rows = (await q(
    `SELECT f.id, f.company, c.name AS company_name, f.page, f.screen, f.message, f.name, f.person_id, f.status, f.outcome, f.recurrence, f.created_at, f.updated_at,
            f.anetix_stage, f.anetix_note, f.anetix_at, f.anetix_by, f.anetix_kind, f.about_module, f.about_system, f.about_kind, f.triage_note,
            m.title AS about_title,
            (SELECT array_agg(a.kind ORDER BY a.kind) FROM platform.connection_allowances a WHERE a.company=f.company AND a.module=f.about_module) AS turned_on
       FROM platform.feedback f LEFT JOIN platform.companies c ON c.slug=f.company
       LEFT JOIN platform.modules m ON m.company=f.company AND m.name=f.about_module
      WHERE f.module='platform' AND f.kind='feedback' AND ${where} ORDER BY f.id DESC LIMIT 300`)).rows;
  const counts = (await q("SELECT count(*) FILTER (WHERE status='new')::int AS open, count(*) FILTER (WHERE status='new' AND anetix_stage IS NULL)::int AS untouched FROM platform.feedback WHERE module='platform' AND kind='feedback'")).rows[0];
  return { requests: rows.map((r) => ({ ...r, turned_on: r.turned_on || [], ...stateOf(r), stage: STAGES.includes(r.anetix_stage) ? r.anetix_stage : "received" })), open: counts.open, untouched: counts.untouched };
}

const IG_KINDS = ["erp", "printer", "machine", "scale", "other"];
const igKind = (k) => (IG_KINDS.includes(String(k || "")) ? String(k) : "other");
// A request the proposer read as a connection to an outside system that is not turned on for its tool: it becomes a
// request to Anetix's integration team. fb: the feedback row as it arrived. Returns the updated row.
async function handoff(fb, { kind, system, would_give, note, by = "agent", model = null } = {}) {
  const sys = clean(system, 80) || null;
  const upd = (await q(
    `UPDATE platform.feedback SET module='platform', about_module=$2, about_system=$3, about_kind=$4, anetix_kind='integration', triage='integration', triage_note=$5,
            status='new', anetix_stage=NULL, updated_at=now() WHERE id=$1 RETURNING *`,
    [fb.id, fb.module, sys, igKind(kind), clean(note || would_give, 300) || null])).rows[0];
  await record("handed_to_integration", { company: fb.company, module: fb.module, actor: by === "agent" ? "agent" : by, feedback_id: fb.id, before: clean(fb.message, 2000), after: clean(would_give || note, 600) || null, detail: { kind: igKind(kind), system: sys, model } });
  await require("./db").logEvent("handed_to_integration", fb.id, { company: fb.company, module: fb.module, kind: igKind(kind), system: sys });
  tellPhones(fb.company, fb.module, sys);
  return upd;
}
// The same for a system a new tool's design names but that is not turned on: one request per system, at confirm.
async function handoffNew({ company, module: mod, title, kind, system, would_give, name, intake_id }) {
  const sys = clean(system, 80) || null;
  const exists = (await q("SELECT id FROM platform.feedback WHERE company=$1 AND anetix_kind='integration' AND about_module=$2 AND about_kind=$3 AND COALESCE(about_system,'')=COALESCE($4,'') AND status='new'", [company, mod, igKind(kind), sys])).rows[0];
  if (exists) return exists;
  const message = clean(`Connect ${sys || "an outside system"} to the new tool "${title || mod}"${would_give ? `: ${would_give}` : "."}`, 2000);
  const r = (await q(
    `INSERT INTO platform.feedback (company, module, page, screen, message, name, status, anetix_kind, about_module, about_system, about_kind, triage, triage_note)
     VALUES ($1,'platform',NULL,$2,$3,$4,'new','integration',$5,$6,$7,'integration',$8) RETURNING *`,
    [company, clean(`New tool: ${title || mod}`, 120), message, clean(name, 80) || null, mod, sys, igKind(kind), clean(would_give, 300) || null])).rows[0];
  await record("handed_to_integration", { company, module: mod, actor: "platform", feedback_id: r.id, intake_id: intake_id || null, after: message, detail: { kind: igKind(kind), system: sys, from: "tool design" } });
  tellPhones(company, mod, sys);
  return r;
}
function tellPhones(company, mod, sys) {
  try { require("./notify").notifyEvery(`integration:${company}`, 10 * 60e3, "Integration request", `${company} wants ${sys || "an outside system"} connected to ${mod}. It is on the Requests tab of /admin.`, { tags: ["electric_plug"] }); }
  catch (e) { console.error("[requests] notify:", e.message); }
}
// The manager says it is a change to the tool after all: it goes back to the tool's board and is proposed as a change.
async function backToTool(id, who) {
  const r = (await q("SELECT * FROM platform.feedback WHERE id=$1 AND module='platform' AND anetix_kind='integration'", [Number(id) || 0])).rows[0];
  if (!r) throw fail(404, "no such integration request");
  if (r.status !== "new") throw fail(409, "this one is closed");
  const mod = r.about_module;
  const row = mod ? (await q("SELECT name FROM platform.modules WHERE company=$1 AND name=$2", [r.company, mod])).rows[0] : null;
  if (!row) throw fail(409, "that tool is not there to change");
  const upd = (await q("UPDATE platform.feedback SET module=$2, anetix_kind=NULL, triage=NULL, triage_note=NULL, anetix_stage=NULL, anetix_note=NULL, updated_at=now() WHERE id=$1 RETURNING *", [r.id, mod])).rows[0];
  await record("integration_back_to_tool", { company: r.company, module: mod, actor: who || "manager", feedback_id: r.id, before: r.about_system || null });
  return upd;
}
// Move a request along, or leave a word back. by: the admin's name. A closed request set to a stage is open again.
async function setStage(id, { stage, note }, by) {
  const r = await get(id); if (!r) throw fail(404, "no such request");
  stage = stage ? String(stage) : (STAGES.includes(r.anetix_stage) ? r.anetix_stage : "received");
  if (!STAGES.includes(stage)) throw fail(400, "the stage is received, looking or working");
  const word = clean(note, 600);
  if (note != null && note !== "" && word.length < 2) throw fail(400, "a word back needs a few letters");
  const upd = (await q(
    `UPDATE platform.feedback SET anetix_stage=$2, anetix_note=$3, anetix_at=now(), anetix_by=$4, status='new', outcome=NULL, updated_at=now() WHERE id=$1 RETURNING *`,
    [r.id, stage === "received" ? null : stage, note == null ? r.anetix_note : (word || null), by])).rows[0];
  await record("anetix_stage", { company: r.company, module: "platform", actor: { role: "admin", name: by }, feedback_id: r.id, before: r.anetix_stage || (r.status === "new" ? "received" : r.status), after: stage, detail: { note: word || null, reopened: r.status !== "new" } });
  return { ...upd, ...stateOf(upd) };
}
// How it ended: fixed (what changed, the words the floor reads) or not doing this (why). The words are the last word
// back, so an earlier note goes (it read oddly after "Fixed": "Anetix says: looking at it now").
async function close(id, { answer, what }, by) {
  const r = await get(id); if (!r) throw fail(404, "no such request");
  if (!["fixed", "not_doing"].includes(answer)) throw fail(400, "the answer is fixed or not_doing");
  const words = clean(what, 1000);
  if (words.length < 3) throw fail(400, answer === "fixed" ? "say what changed, in a few words the floor will read" : "say why, in a sentence the person will read");
  const upd = (await q(
    `UPDATE platform.feedback SET status=$2, outcome=$3, anetix_note=NULL, anetix_at=now(), anetix_by=$4, updated_at=now() WHERE id=$1 RETURNING *`,
    [r.id, answer === "fixed" ? "done" : "declined", words, by])).rows[0];
  await record("feedback_closed", { company: r.company, module: "platform", actor: { role: "admin", name: by }, feedback_id: r.id, after: words, detail: { by_anetix: true, answer, declined: answer !== "fixed" } });
  return { ...upd, ...stateOf(upd) };
}

// ---- routes: admin only, on the platform router's path space (a module page's policy does not open /api/admin) ----
const router = express.Router();
const json = express.json({ limit: "100kb" });
const requireAdmin = (req, res, next) => require("./auth").requireAdmin(req, res, next);
const who = (req) => (req.sosAccount && (req.sosAccount.name || req.sosAccount.login)) || "Anetix";
const guard = (fn) => async (req, res) => { try { await fn(req, res); } catch (e) { res.status(e.status || 400).json({ error: e.message }); } };
router.get("/api/admin/requests", requireAdmin, guard(async (req, res) => {
  res.set("Cache-Control", "no-store").json(await list(String(req.query.status || "open")));
}));
router.post("/api/admin/requests/:id(\\d{1,9})", requireAdmin, json, guard(async (req, res) => {
  res.json(await setStage(req.params.id, req.body || {}, who(req)));
}));
router.post("/api/admin/requests/:id(\\d{1,9})/close", requireAdmin, json, guard(async (req, res) => {
  res.json(await close(req.params.id, req.body || {}, who(req)));
}));

// The integration team turns a kind of outside connection on (or off) for the tool a request is about.
router.post("/api/admin/requests/:id(\\d{1,9})/turn-on", requireAdmin, json, guard(async (req, res) => {
  const r = await get(req.params.id); if (!r || r.anetix_kind !== "integration") throw fail(404, "no such integration request");
  const kind = String((req.body || {}).kind || r.about_kind || "");
  const on = (req.body || {}).on !== false;
  const turned = await require("./connections").setAllowed(r.company, r.about_module, kind, on, { system: r.about_system, note: `request #${r.id}` }, who(req));
  res.json({ ok: true, turned_on: turned.map((a) => a.kind) });
}));

module.exports = { init, SCHEMA, STAGES, stateOf, list, setStage, close, router, handoff, handoffNew, backToTool, IG_KINDS };
