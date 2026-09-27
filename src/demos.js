// Demos: what Anetix learns from the personal demos and every other company that came in from anetix.ai (the
// Demos tab of /admin, public/assets/admin-demos.js). Brendan, 2026-09-25: "a way to see from admin what the
// person has spent, how much they have paid ... collect feedback from their CI board and get an overview of their
// company ... see what people start building and use cases ... admin only". Read only: nothing here changes a
// company, and nothing here is reachable by anyone but an admin (every route is requireAdmin, on the /api/admin
// path the module page policy never opens).
//
//   GET /api/admin/demos                  every self-serve company, newest first: who, money, what they built, the
//                                         loop's numbers (health.compute, all time), last activity; plus the totals
//                                         across them and the use cases (what each new-module request was for)
//   GET /api/admin/demos/:slug            one company in full: the above plus every new-module request with its
//                                         answers and design, every request on the board in the person's words,
//                                         every build and what it changed, the credit ledger, spend by kind, and the
//                                         interaction record (the process, step by step)
//   GET /api/admin/demos/export           every company in full as one JSON file, for reading the learnings offline
//
// A company that went live (stage 3, docs/PAID-SITES.md): what it did as a demo stays here, since the Terms (4.4) let
// Anetix learn from a demo; what it does as a paying site does not, unless it opted in to learning on its order form
// (the Terms, 10.2). So for a subscribed site without the opt-in, everything below stops at sites.converted_at: "until".
// A row made before that line but changed after it (a request answered, an intake finished, a build that ran on) shows
// only what it was made with: what changed after the line is the plant's (review, 2026-09-26).
const after = (row, until) => Boolean(until && row && row.updated_at && new Date(row.updated_at) >= new Date(until));
const express = require("express");
const { q } = require("./db");
const selfserve = require("./selfserve");
const health = require("./health");
const IQ = require("./intake-questions");

const money = (x) => Math.round(Number(x || 0) * 100) / 100;
const cut = (s, n) => { s = s == null ? "" : String(s); return s.length > n ? s.slice(0, n) + "…" : s; };
const SLUG = /^[a-z0-9][a-z0-9-]{1,40}$/;

// ---- pure ----------------------------------------------------------------------------------------------------------
// The money for one company from its ledger rows: what they paid (Stripe), what we gave (grants), what was taken back.
function moneyOf(ledger) {
  const paid = ledger.filter((r) => r.kind === "purchase").reduce((n, r) => n + Number(r.paid_usd || 0), 0);
  const bought = ledger.filter((r) => r.kind === "purchase").reduce((n, r) => n + Number(r.delta_usd || 0), 0);
  const granted = ledger.filter((r) => r.kind === "grant").reduce((n, r) => n + Number(r.delta_usd || 0), 0);
  const adjusted = ledger.filter((r) => r.kind === "adjust").reduce((n, r) => n + Number(r.delta_usd || 0), 0);
  return { paid_usd: money(paid), purchases: ledger.filter((r) => r.kind === "purchase").length, bought_credit_usd: money(bought), granted_usd: money(granted), adjusted_usd: money(adjusted) };
}
// One new-module request as a use case: what they called it, what it is for, what it tracks, how they do it today,
// the design's one line, how far it got. intake: a platform.module_intakes row.
function useCaseOf(intake, { company, company_name, live } = {}) {
  const a = intake.answers || {};
  const qn = (id) => IQ.FIXED.find((x) => x.id === id);
  const said = (id) => { const x = qn(id); return x && IQ.answered(x, a[id]) ? IQ.describe(x, a[id]) : null; };
  return {
    company, company_name, intake_id: intake.id,
    name: (typeof a.name === "string" && a.name.trim()) || intake.name || null,
    purpose: said("purpose"), thing: said("thing"), today: said("today"), who: said("who"),
    bluf: intake.design && intake.design.bluf ? intake.design.bluf : null,
    status: intake.status, live: Boolean(live), created_at: intake.created_at,
  };
}
// Every answer of an intake in order, the fixed questions first, then each generated round.
function answersOf(intake) {
  const a = intake.answers || {};
  const out = [];
  for (const qn of IQ.FIXED) if (a[qn.id] !== undefined) out.push({ id: qn.id, question: qn.text, answer: IQ.describe(qn, a[qn.id]) });
  for (const round of intake.rounds || []) for (const qn of round.questions || []) {
    if (a[qn.id] === undefined) continue;
    let answer; try { answer = IQ.describe(qn, a[qn.id]); } catch (e) { answer = typeof a[qn.id] === "string" ? a[qn.id] : JSON.stringify(a[qn.id]); }
    out.push({ id: qn.id, round: round.round, question: qn.text, answer });
  }
  return out;
}

// ---- reads ---------------------------------------------------------------------------------------------------------
async function companiesIn(slug) {
  const rows = (await q(`SELECT s.company AS slug, c.name, c.demo, s.email, s.contact, s.created_at AS since, s.pin_id, p.label AS pin_label, p.pin,
                                st.converted_at, st.learning_opt_in, st.stage AS site_stage
                   FROM platform.self_serve s JOIN platform.companies c ON c.slug=s.company LEFT JOIN platform.access_pins p ON p.id=s.pin_id
                   LEFT JOIN platform.sites st ON st.company=s.company
                   ${slug ? "WHERE s.company=$1" : ""} ORDER BY s.created_at DESC`, slug ? [slug] : [])).rows;
  for (const r of rows) r.until = r.converted_at && !r.learning_opt_in ? r.converted_at : null;   // the demo period only
  return rows;
}
// Spend by where it went, since the company came in (the same five sources the credit counts).
async function spendByKind(slug, since, until = null) {
  const rows = (await q(`
    SELECT kind, SUM(usd)::numeric AS usd, COUNT(*)::int AS n FROM (
      SELECT 'builds' AS kind, cost_usd AS usd, created_at AS at FROM platform.build_runs WHERE company=$1 AND created_at >= $2
      UNION ALL SELECT 'proposals', p.cost_usd, p.created_at FROM platform.proposals p JOIN platform.feedback f ON f.id=p.feedback_id WHERE f.company=$1 AND p.created_at >= $2
      UNION ALL SELECT 'system reviews', cost_usd, created_at FROM platform.reviews WHERE company=$1 AND created_at >= $2
      UNION ALL SELECT 'brand guide', (brand->>'cost_usd')::numeric, (brand->>'built_at')::timestamptz FROM platform.companies WHERE slug=$1 AND brand IS NOT NULL AND (brand->>'built_at')::timestamptz >= $2
      UNION ALL SELECT COALESCE(kind, 'other'), cost_usd, created_at FROM platform.ai_usage WHERE company=$1 AND created_at >= $2
    ) s WHERE ($3::timestamptz IS NULL OR at < $3) GROUP BY kind ORDER BY usd DESC NULLS LAST`, [slug, since, until])).rows;
  return rows.map((r) => ({ kind: r.kind, usd: money(r.usd), n: r.n })).filter((r) => r.usd > 0 || r.n > 0);
}
async function modulesOf(slug, until = null) {
  const rows = (await q(`SELECT m.name, m.title, CASE WHEN $2::timestamptz IS NULL THEN m.live_version
                                ELSE (SELECT MAX(v.version) FROM platform.module_versions v WHERE v.company=m.company AND v.module=m.name AND v.created_at < $2) END AS live_version,
                          CASE WHEN $2::timestamptz IS NULL THEN m.staged_version ELSE NULL END AS staged_version, m.created_at,
                          (SELECT COUNT(*)::int FROM platform.module_versions v WHERE v.company=m.company AND v.module=m.name AND ($2::timestamptz IS NULL OR v.created_at < $2)) AS versions
                         FROM platform.modules m WHERE m.company=$1 AND ($2::timestamptz IS NULL OR m.created_at < $2) ORDER BY m.created_at`, [slug, until]).catch(() => ({ rows: [] }))).rows;
  let registry = null; try { registry = require("./registry"); } catch (e) {}
  return rows.map((m) => {
    let description = null;
    try { if (registry && m.live_version && !until) description = (registry.readManifest(slug, m.name, m.live_version) || {}).description || null; } catch (e) {}
    return { name: m.name, title: m.title, live_version: m.live_version, staged_version: m.staged_version, versions: m.versions, created_at: m.created_at, description };
  });
}
async function lastActivity(slug, until = null) {
  if (until) return until;   // a paying site's activity since it went live is its own
  const r = (await q(`SELECT GREATEST(
      (SELECT MAX(created_at) FROM platform.record WHERE company=$1),
      (SELECT MAX(updated_at) FROM platform.feedback WHERE company=$1),
      (SELECT MAX(updated_at) FROM platform.build_runs WHERE company=$1),
      (SELECT MAX(updated_at) FROM platform.module_intakes WHERE company=$1)) AS at`, [slug])).rows[0];
  return r ? r.at : null;
}
async function countsOf(slug, until = null) {
  const f = (await q(`SELECT COUNT(*) FILTER (WHERE COALESCE(kind,'feedback')='feedback' AND COALESCE(module,'') <> 'platform')::int AS requests,
                             COUNT(*) FILTER (WHERE COALESCE(kind,'feedback')='feedback' AND COALESCE(module,'') <> 'platform' AND status='done')::int AS requests_shipped,
                             COUNT(*) FILTER (WHERE module='platform')::int AS to_anetix,
                             COUNT(*) FILTER (WHERE kind='module_request')::int AS module_requests
                      FROM platform.feedback WHERE company=$1 AND ($2::timestamptz IS NULL OR created_at < $2)`, [slug, until])).rows[0];
  const r = (await q(`SELECT COUNT(*)::int AS builds, COUNT(*) FILTER (WHERE status='deployed')::int AS deployed,
                             COUNT(*) FILTER (WHERE status='failed')::int AS stopped, COUNT(*) FILTER (WHERE status='rolled_back')::int AS rolled_back
                      FROM platform.build_runs WHERE company=$1 AND ($2::timestamptz IS NULL OR created_at < $2)`, [slug, until])).rows[0];
  const i = (await q(`SELECT COUNT(*)::int AS intakes, COUNT(*) FILTER (WHERE status='done')::int AS intakes_done,
                             COUNT(*) FILTER (WHERE status='abandoned')::int AS intakes_abandoned
                      FROM platform.module_intakes WHERE company=$1 AND ($2::timestamptz IS NULL OR created_at < $2)`, [slug, until])).rows[0];
  return { ...f, ...r, ...i };
}
// The loop's own numbers for these companies, all time (the Health tab's per-company metrics).
async function loopFor(slugs) {
  if (!slugs.length) return {};
  const h = await health.forAdmin(0);
  const out = {};
  for (const c of h.companies) if (slugs.includes(c.slug)) out[c.slug] = {
    filed: c.feedback.filed, open: c.feedback.open,
    approved: c.decisions.approved, declined: c.decisions.declined, edited: c.decisions.edited,
    builds_started: c.builds.started, builds_shipped: c.builds.shipped, rolled_back: c.builds.rolled_back, fix_rounds: c.builds.fix_rounds,
    to_floor_median_hours: c.floor.median_hours, same_shift: c.floor.same_shift, shipped_n: c.floor.n,
    manager_done: c.answers && c.answers.manager_done, a_little_left: c.answers && c.answers.manager_little_left,
  };
  return out;
}

async function summaryOf(c, loop) {
  const ledger = (await q("SELECT kind, delta_usd, paid_usd, created_at FROM platform.credit_ledger WHERE company=$1 ORDER BY id", [c.slug])).rows;
  const [credit0, modules, counts, last, managers] = await Promise.all([selfserve.credit(c.slug), modulesOf(c.slug, c.until), countsOf(c.slug, c.until), lastActivity(c.slug, c.until), selfserve.managers(c.slug)]);
  // bounded: what the demo spent up to the line, never the plant's since
  const credit = credit0 && c.until ? { ...credit0, spent_usd: money((await spendByKind(c.slug, c.since, c.until)).reduce((n, r) => n + Number(r.usd || 0), 0)), balance_usd: null, percent: null, level: null } : credit0;
  const m = managers[0] || null;
  return {
    slug: c.slug, name: c.name, demo: Boolean(c.demo), email: c.email, contact: c.contact, since: c.since,
    pin: c.pin_id ? { id: c.pin_id, label: c.pin_label, shown: c.pin ? `${c.pin.slice(0, 4)}-${c.pin.slice(4)}` : null } : null,
    manager: m ? { login: m.login, enrolled: m.enrolled, last_sign_in: m.last_sign_in } : null,
    money: { ...moneyOf(ledger), spent_usd: credit ? credit.spent_usd : 0, balance_usd: credit ? credit.balance_usd : 0, percent: credit ? credit.percent : 0, level: credit ? credit.level : null,
      margin_usd: money(moneyOf(ledger).paid_usd - (credit ? credit.spent_usd : 0)) },
    modules: modules.map((x) => ({ name: x.name, title: x.title, live_version: x.live_version, versions: x.versions })),
    counts, loop: c.until ? null : loop[c.slug] || null, last_activity: last,
    // stage 3: a site that went live. demo_period_only: everything here stops at the day it did (no learning opt-in)
    subscribed: c.converted_at ? { since: c.converted_at, learning_opt_in: Boolean(c.learning_opt_in), demo_period_only: Boolean(c.until), stage: c.site_stage } : null,
  };
}

async function list() {
  const cos = await companiesIn();
  const loop = await loopFor(cos.map((c) => c.slug));
  const demos = [];
  for (const c of cos) demos.push(await summaryOf(c, loop));
  const untilOf = Object.fromEntries(cos.map((c) => [c.slug, c.until]));
  const intakes = (cos.length ? (await q("SELECT i.*, c.name AS company_name FROM platform.module_intakes i JOIN platform.companies c ON c.slug=i.company WHERE i.company = ANY($1) ORDER BY i.created_at DESC", [cos.map((c) => c.slug)])).rows : [])
    .filter((i) => !untilOf[i.company] || new Date(i.created_at) < new Date(untilOf[i.company]));
  const liveByCo = {}; for (const d of demos) liveByCo[d.slug] = new Set(d.modules.filter((m) => m.live_version).map((m) => m.name));
  const use_cases = intakes.map((i) => (after(i, untilOf[i.company])
    ? { company: i.company, company_name: i.company_name, intake_id: i.id, name: i.name || null, status: "changed after going live", live: false, created_at: i.created_at, after_going_live: true }
    : useCaseOf(i, { company: i.company, company_name: i.company_name, live: i.slug && liveByCo[i.company] && liveByCo[i.company].has(i.slug) })));
  const sum = (f) => money(demos.reduce((n, d) => n + Number(f(d) || 0), 0));
  const totals = {
    companies: demos.length, demos: demos.filter((d) => d.demo).length,
    active_7d: demos.filter((d) => d.last_activity && Date.now() - new Date(d.last_activity).getTime() < 7 * 86400e3).length,
    enrolled: demos.filter((d) => d.manager && d.manager.enrolled).length,
    paid_usd: sum((d) => d.money.paid_usd), purchases: demos.reduce((n, d) => n + d.money.purchases, 0),
    granted_usd: sum((d) => d.money.granted_usd), spent_usd: sum((d) => d.money.spent_usd), margin_usd: sum((d) => d.money.margin_usd),
    modules_live: demos.reduce((n, d) => n + d.modules.filter((m) => m.live_version).length, 0),
    requests: demos.reduce((n, d) => n + d.counts.requests, 0), builds_deployed: demos.reduce((n, d) => n + d.counts.deployed, 0),
    use_cases: use_cases.length,
  };
  // the Terms, 6.3 and 10.7: a company's data may go after 12 months with no sign-in; these are a month from it (src/dataexport.js)
  const idle = await require("./dataexport").idle();
  return { totals, demos, use_cases, idle };
}

async function detail(slug) {
  slug = String(slug || "").toLowerCase();
  if (!SLUG.test(slug)) return null;
  const c = (await companiesIn(slug))[0]; if (!c) return null;
  const loop = await loopFor([slug]);
  const summary = await summaryOf(c, loop);
  const until = c.until;
  const modules = await modulesOf(slug, until);
  const liveNames = new Set(modules.filter((m) => m.live_version).map((m) => m.name));
  const intakes = (await q("SELECT * FROM platform.module_intakes WHERE company=$1 AND ($2::timestamptz IS NULL OR created_at < $2) ORDER BY created_at", [slug, until])).rows.map((i) => (after(i, until)
    ? { id: i.id, status: "changed after going live", name: i.name, slug: null, created_at: i.created_at, updated_at: null, cost_usd: null, use_case: { company: slug, company_name: c.name, intake_id: i.id, name: i.name || null, after_going_live: true }, answers: [], design: null, error: null, after_going_live: true }
    : {
    id: i.id, status: i.status, name: i.name, slug: i.slug, created_at: i.created_at, updated_at: i.updated_at, cost_usd: money(i.cost_usd),
    use_case: useCaseOf(i, { company: slug, company_name: c.name, live: i.slug && liveNames.has(i.slug) }),
    answers: answersOf(i),
    design: i.design ? { bluf: i.design.bluf || null, items: i.design.items || i.design.check_items || [], screens: (i.design.screens || []).map((s) => (typeof s === "string" ? s : s.name || s.title || JSON.stringify(s))), leaves_out: i.design.leaves_out || null } : null,
    error: i.error || null,
  }));
  const feedback = (await q(`SELECT f.id, f.module, f.screen, f.message, f.name, f.status, f.outcome, COALESCE(f.kind,'feedback') AS kind, f.created_at, f.updated_at,
                                    f.shipped_version, f.manager_answer, f.floor_answer, f.duplicate_of, f.follow_up_of,
                                    (SELECT p.body FROM platform.proposals p WHERE p.feedback_id=f.id ORDER BY p.id DESC LIMIT 1) AS proposal,
                                    (SELECT p.status FROM platform.proposals p WHERE p.feedback_id=f.id ORDER BY p.id DESC LIMIT 1) AS proposal_status
                             FROM platform.feedback f WHERE f.company=$1 AND ($2::timestamptz IS NULL OR f.created_at < $2) ORDER BY f.id`, [slug, until])).rows
    .map((f) => (after(f, until)
      // filed in the demo, touched after going live: the words stay (they were said in the demo), what happened since goes
      ? { id: f.id, module: f.module, screen: f.screen, message: cut(f.message, 4000), name: f.name, kind: f.kind, created_at: f.created_at, updated_at: null,
          status: "changed after going live", outcome: null, shipped_version: null, manager_answer: null, floor_answer: null, duplicate_of: null,
          follow_up_of: f.follow_up_of, proposal: null, proposal_status: null, after_going_live: true }
      : { ...f, message: cut(f.message, 4000), proposal: f.proposal ? cut(f.proposal, 1000) : null }));
  const runs = (await q("SELECT id, module, lane, status, step, from_version, to_version, model, requirement, evidence, cost_usd, created_at, updated_at FROM platform.build_runs WHERE company=$1 AND ($2::timestamptz IS NULL OR created_at < $2) ORDER BY id", [slug, until])).rows.map((r) => (after(r, until)
    ? { id: r.id, module: r.module, lane: r.lane, status: "changed after going live", step: null, from_version: r.from_version, to_version: null, model: r.model,
        title: null, what_changed: null, requirement: null, error: null, cost_usd: null, created_at: r.created_at, updated_at: null, after_going_live: true }
    : {
    id: r.id, module: r.module, lane: r.lane, status: r.status, step: r.step, from_version: r.from_version, to_version: r.to_version, model: r.model,
    title: (r.evidence && r.evidence.title) || null, what_changed: (r.evidence && r.evidence.what_changed) || null,
    requirement: r.requirement ? cut(r.requirement, 1500) : null, error: (r.evidence && r.evidence.error) ? cut(r.evidence.error, 500) : null,
    cost_usd: money(r.cost_usd), created_at: r.created_at, updated_at: r.updated_at,
  }));
  const ledger = (await q("SELECT id, kind, delta_usd, paid_usd, ref, note, made_by, created_at FROM platform.credit_ledger WHERE company=$1 ORDER BY id", [slug])).rows
    .map((r) => ({ ...r, delta_usd: money(r.delta_usd), paid_usd: r.paid_usd == null ? null : money(r.paid_usd) }));
  const spend = await spendByKind(slug, c.since, until);
  const timeline = (await q(`SELECT id, kind, module, actor_role, actor_name, feedback_id, run_id, intake_id, version, before, after, created_at
                             FROM platform.record WHERE company=$1 AND ($2::timestamptz IS NULL OR created_at < $2) ORDER BY id DESC LIMIT 600`, [slug, until])).rows
    .map((r) => ({ ...r, before: r.before ? cut(r.before, 600) : null, after: r.after ? cut(r.after, 600) : null }));
  return { ...summary, modules, intakes, feedback, runs, ledger, spend, timeline };
}

async function exportAll() {
  const cos = await companiesIn();
  const out = [];
  for (const c of cos) out.push(await detail(c.slug));
  const { totals, use_cases } = await list();
  return { format: "anetix-demos-1", exported_at: new Date().toISOString(), totals, use_cases, companies: out };
}

// ---- routes: admin only --------------------------------------------------------------------------------------------
const router = express.Router();
const requireAdmin = (req, res, next) => require("./auth").requireAdmin(req, res, next);
const guard = (fn) => async (req, res) => { try { await fn(req, res); } catch (e) { console.error("[demos]", e.message); res.status(500).json({ error: e.message }); } };
router.get("/api/admin/demos", requireAdmin, guard(async (_req, res) => res.set("Cache-Control", "no-store").json(await list())));
router.get("/api/admin/demos/export", requireAdmin, guard(async (_req, res) => {
  res.set({ "Cache-Control": "no-store", "Content-Disposition": `attachment; filename="anetix-demos-${new Date().toISOString().slice(0, 10)}.json"` }).json(await exportAll());
}));
router.get("/api/admin/demos/:slug", requireAdmin, guard(async (req, res) => {
  const d = await detail(req.params.slug);
  if (!d) return res.status(404).json({ error: "no such self-serve company" });
  res.set("Cache-Control", "no-store").json(d);
}));

module.exports = { router, list, detail, exportAll, moneyOf, useCaseOf, answersOf };
