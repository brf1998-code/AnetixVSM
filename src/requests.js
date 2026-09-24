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
`;
async function init() { await q(SCHEMA); }

const STAGES = ["received", "looking", "working"];
// The one line the floor and the manager read for a platform request. Pure. r: a feedback row (status, outcome,
// anetix_stage, anetix_note, anetix_by).
const STAGE_LINE = { received: "Sent to Anetix, the people who make this software. Nobody has looked yet.", looking: "Anetix is looking at it.", working: "Anetix is working on it." };
function stateOf(r) {
  const note = r.anetix_note ? ` ${r.anetix_by || "Anetix"} says: "${String(r.anetix_note).trim()}"` : "";
  if (r.status === "done") return { state: "anetix_fixed", line: `Fixed by Anetix.${r.outcome ? ` ${r.outcome}` : ""}` };
  if (r.status === "declined") {
    if (r.anetix_by) return { state: "anetix_not_doing", line: `Anetix is not doing this one.${r.outcome ? ` ${r.outcome}` : ""}` };
    const why = r.outcome && !/^declined$/i.test(r.outcome) ? ` ${r.outcome}` : "";
    return { state: "declined", line: `Declined by the manager.${why}` };
  }
  const stage = STAGES.includes(r.anetix_stage) ? r.anetix_stage : "received";
  return { state: `anetix_${stage}`, line: STAGE_LINE[stage] + note };
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
            f.anetix_stage, f.anetix_note, f.anetix_at, f.anetix_by
       FROM platform.feedback f LEFT JOIN platform.companies c ON c.slug=f.company
      WHERE f.module='platform' AND f.kind='feedback' AND ${where} ORDER BY f.id DESC LIMIT 300`)).rows;
  const counts = (await q("SELECT count(*) FILTER (WHERE status='new')::int AS open, count(*) FILTER (WHERE status='new' AND anetix_stage IS NULL)::int AS untouched FROM platform.feedback WHERE module='platform' AND kind='feedback'")).rows[0];
  return { requests: rows.map((r) => ({ ...r, ...stateOf(r), stage: STAGES.includes(r.anetix_stage) ? r.anetix_stage : "received" })), open: counts.open, untouched: counts.untouched };
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
router.post("/api/admin/requests/:id(\\d+)", requireAdmin, json, guard(async (req, res) => {
  res.json(await setStage(req.params.id, req.body || {}, who(req)));
}));
router.post("/api/admin/requests/:id(\\d+)/close", requireAdmin, json, guard(async (req, res) => {
  res.json(await close(req.params.id, req.body || {}, who(req)));
}));

module.exports = { init, SCHEMA, STAGES, stateOf, list, setStage, close, router };
