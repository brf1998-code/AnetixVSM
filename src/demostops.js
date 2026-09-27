// A demo's build that stopped before it showed anything (the launch audit 1.20; Brendan, 2026-09-27: "hand it back but
// these absolutely need to be addressed"). A build that stops with no preview to open left the demo with nothing for
// what it spent, and says something about the product we have to fix. So each one:
//   - hands its AI spend back as credit (an adjust row on the credit ledger, like a sample fill that did not work),
//     once per dollar: a later stop of the same run hands back only what it spent since (the sum of its rows here);
//     a refund never writes off an overrun the way a refill does;
//   - is a row here, open until an admin marks it addressed with a few words on what was done (/admin, the Demos tab);
//   - sends one phone alert (src/notify.js).
// Only demo companies (companies.demo): a paid site has no credit to hand back. Only a stop, never an abort: a manager
// who cancels chose to. A stop after a preview was staged (a failed check, a test campaign) is not one of these: the
// manager has something to look at and the usual Fix, Override and Retry (hadPreview below).
//
// Called by src/pipeline.js failRun (after the automatic fix rounds said no) and sweepOrphans (a restart the build
// could not start again from). The board's stopped card says the credit came back, never how much (no costs to a company).
//
// Routes (admin): GET  /api/admin/demo-stops                   open ones first, then the last 30 addressed
//                 POST /api/admin/demo-stops/:id/addressed      { note } what was done about it
const express = require("express");
const { q, logEvent } = require("./db");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS platform.demo_stops (
  id            SERIAL PRIMARY KEY,
  company       TEXT NOT NULL,
  run_id        INTEGER NOT NULL,
  module        TEXT,
  lane          TEXT,
  step          TEXT,
  why           TEXT,                              -- the run's last error line, for Anetix only
  ai_down       TEXT,                              -- 'busy' | 'unavailable' when the AI service refused (src/credit.js)
  refunded_usd  NUMERIC(10,4) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  addressed_at  TIMESTAMPTZ,
  addressed_by  TEXT,
  note          TEXT
);
CREATE INDEX IF NOT EXISTS demo_stops_open ON platform.demo_stops (addressed_at, id);`;
async function init() { await q(SCHEMA); }

const money = (x) => Math.round(Number(x || 0) * 10000) / 10000;
const STEP_WORDS = { build: "while building", confirm_requirement: "writing the requirement", cross_check: "at the second review", test_run: "in its tests", visual_check: "checking its screens", campaign: "on the test floor" };

// Did the manager get a preview to open? A draft version is made before the agent starts (so to_version alone says
// nothing); it is staged once the build step is done, and the checks after it run against the preview. A stop by the
// platform's own gate (the "platform checks" cross-check) staged nothing either: the board offers no preview for it.
function hadPreview(run) {
  const ev = run.evidence || {};
  if (!run.to_version || !["cross_check", "test_run", "visual_check", "campaign", "await_deploy"].includes(run.step)) return false;
  return !(ev.cross_check && ev.cross_check.model === "platform checks" && ev.cross_check.verdict === "fail");
}
// run: the build_runs row as it is after the stop. -> the demo_stops row, or null when this is not one of these.
async function onStop(run, { aiDown = null, why = null } = {}) {
  if (!run || run.status !== "failed" || hadPreview(run)) return null;
  const co = (await q("SELECT slug, name, demo FROM platform.companies WHERE slug=$1", [run.company])).rows[0];
  if (!co || !co.demo) return null;
  const ev = run.evidence || {};
  const last = why || String(((run.log || []).filter((l) => l.step === "error").slice(-1)[0] || {}).note || "");
  // what this run has had back already is the sum of its rows here (written before the credit, so a crash in between
  // can never pay twice; a credit that failed is set back to 0 below)
  const had = Number((await q("SELECT COALESCE(SUM(refunded_usd),0) AS usd FROM platform.demo_stops WHERE run_id=$1", [run.id])).rows[0].usd || 0);
  const ss = require("./selfserve");
  const selfServe = Boolean(await ss.credit(run.company).catch(() => null));
  const back = selfServe ? Math.max(0, money(money(run.cost_usd) - money(had))) : 0;
  let row = (await q(`INSERT INTO platform.demo_stops (company, run_id, module, lane, step, why, ai_down, refunded_usd) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [run.company, run.id, run.module || null, run.lane || null, run.step || null, last.slice(0, 1000) || null, aiDown || null, back])).rows[0];
  let refunded = 0;
  if (back > 0) {
    try {
      await ss.addCredit({ slug: run.company, credit_usd: back, kind: "adjust", note: `a build that stopped before a preview (run #${run.id}), handed back`, by: "platform", write_off: false });
      refunded = back;
    } catch (e) {
      console.error(`[demostops] run #${run.id}: handing back $${back} failed: ${e.message}`);
      row = (await q("UPDATE platform.demo_stops SET refunded_usd=0 WHERE id=$1 RETURNING *", [row.id])).rows[0];
    }
    // the board's line on the stopped card (never the amount); best effort, the row above is what counts
    if (refunded) {
      const P = require("./pipeline");
      const now = await P.getRun(run.id).catch(() => null);
      await P.setRun(run.id, { evidence: { ...((now && now.evidence) || ev), refunded_usd: money(had + refunded) } }).catch((e) => console.error(`[demostops] run #${run.id}: ${e.message}`));
    }
  }
  await logEvent("demo_stop", String(run.id), { company: run.company, step: run.step, lane: run.lane, refunded_usd: refunded, ai_down: aiDown || null });
  // the phone: the company's name, the step and the dollars; never the error line (it can quote what someone typed)
  const what = run.lane === "module" ? "a new tool" : "a change";
  require("./notify").notify(`A demo build stopped: ${co.name}`,
    `Run #${run.id} (${what}${run.module ? `, ${run.module}` : ""}) stopped ${STEP_WORDS[run.step] || `at ${run.step}`} before a preview.${aiDown ? ` The AI service ${aiDown === "busy" ? "was too busy" : "refused"}.` : ""} ${refunded ? `$${refunded.toFixed(2)} handed back as credit.` : "Nothing to hand back."} It stays on /admin, Demos, until someone marks it addressed.`,
    { priority: 4, tags: ["construction"], ref: `demo_stop:${row.id}` });
  console.warn(`[demostops] ${co.slug} run #${run.id} stopped at ${run.step} before a preview; $${refunded} handed back`);
  return row;
}

async function list() {
  const rows = (await q(`SELECT s.*, c.name AS company_name FROM platform.demo_stops s LEFT JOIN platform.companies c ON c.slug=s.company
                         WHERE s.addressed_at IS NULL OR s.id IN (SELECT id FROM platform.demo_stops WHERE addressed_at IS NOT NULL ORDER BY addressed_at DESC LIMIT 30)
                         ORDER BY (s.addressed_at IS NULL) DESC, s.id DESC`)).rows
    .map((r) => ({ ...r, refunded_usd: money(r.refunded_usd) }));
  return { open: rows.filter((r) => !r.addressed_at), addressed: rows.filter((r) => r.addressed_at) };
}
async function addressed(id, note, by) {
  note = String(note || "").trim().slice(0, 1000);
  if (note.length < 3) throw Object.assign(new Error("say in a few words what was done about it"), { status: 400 });
  const r = (await q("UPDATE platform.demo_stops SET addressed_at=now(), addressed_by=$2, note=$3 WHERE id=$1 AND addressed_at IS NULL RETURNING *", [id, by || null, note])).rows[0];
  if (!r) throw Object.assign(new Error("no open stop with that number"), { status: 404 });
  await logEvent("demo_stop_addressed", String(r.run_id), { id: r.id, by: by || null });
  return r;
}
async function deleteCompany(slug) { await q("DELETE FROM platform.demo_stops WHERE company=$1", [slug]); }

const router = express.Router();
const requireAdmin = (req, res, next) => require("./auth").requireAdmin(req, res, next);
router.get("/api/admin/demo-stops", requireAdmin, async (_req, res) => res.set("Cache-Control", "no-store").json(await list()));
router.post("/api/admin/demo-stops/:id(\\d{1,9})/addressed", requireAdmin, express.json({ limit: "16kb" }), async (req, res) => {
  try { res.json({ ok: true, stop: await addressed(Number(req.params.id), (req.body || {}).note, req.sosAccount ? (req.sosAccount.name || req.sosAccount.login) : "admin") }); }
  catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

module.exports = { init, onStop, hadPreview, list, addressed, deleteCompany, router };
