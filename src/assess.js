// Which model is the baseline (Brendan, 2026-09-22: every job runs on Fable 5.1
// or Opus 5.5; find out which one should be the default). Two instruments, one
// decision, both on /admin#models (public/assets/admin-models.js).
//
// 1. The head-to-head (platform.assessments, assessment_trials, assessment_picks).
//    Stored work is done again by BOTH models with the exact brief a real call
//    gets. Nothing is written anywhere a company sees. The two answers are
//    scored two ways:
//      objective  a cross-check against the manager's Right / Wrong label; a
//                 proposal against what the manager approved (look-and-feel or
//                 how it works, and the screen); a design by its plain-words
//                 flags; a build by the module gate and by BOTH models'
//                 cross-check of the result, so neither only grades itself
//      blind      the admin sees the two answers as Left and Right, with no
//                 model, cost or time on them, and picks one (or "about the
//                 same", or "both miss"). The side is a fixed coin per case.
//    Kinds of case: crosscheck (runs the manager labeled), proposal (requests
//    whose proposal was approved, drafted again against the module version the
//    build started from), design (module intakes that reached a design), build
//    (changes that shipped, built again from the same version in a scratch
//    folder: the costly kind). Trials run one at a time in the background and
//    the two models take turns going first. Spend is ai_usage kind "assess",
//    filed under the company whose work it was: the instance cap and the credit
//    slope see it, a company's credit, its own budget and its fair-use line do
//    not (the launch audit 1.17, 2026-09-27: a demo was paying for Anetix's
//    trials), and an assessment stops at its own budget.
//
// 2. The live A/B (the switch in src/agent.js settings, the arms in
//    platform.model_arms): new proposals, builds and module intakes split
//    between the two models, and health.abSplit breaks the loop health
//    numbers out per arm. The head-to-head says which to try; the A/B says
//    whether it holds on the floor.
//
// The reading (reading() below) is a suggestion with its rules written out on
// the page. The admin changes the baseline; nothing here changes it.
const express = require("express");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const { q, logEvent } = require("./db");
const agent = require("./agent");
const { requireAdmin } = require("./auth");

const KINDS = ["crosscheck", "proposal", "design", "build"];
const KIND_LABEL = {
  crosscheck: "Cross-checks, against your Right / Wrong labels",
  proposal: "Proposals, on requests you approved",
  design: "Designs of new modules",
  build: "Builds of changes that shipped",
};
const PICKED = new Set(["proposal", "design", "build"]);   // a cross-check is scored against its label only
const MAX_CASES = 30;
const PICKS = new Set(["left", "right", "same", "neither"]);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS platform.model_arms (
  id         SERIAL PRIMARY KEY,
  job        TEXT NOT NULL,                 -- propose | build | design
  company    TEXT,
  ref        TEXT NOT NULL,                 -- run:12 | feedback:40 | intake:3
  model      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job, ref)
);
CREATE TABLE IF NOT EXISTS platform.assessments (
  id          SERIAL PRIMARY KEY,
  company     TEXT,                          -- NULL = cases from every company
  plan        JSONB NOT NULL DEFAULT '{}'::jsonb,   -- cases asked for, per kind
  models      TEXT[] NOT NULL,
  baseline    TEXT,                          -- the baseline when it started
  status      TEXT NOT NULL DEFAULT 'running',     -- running | done | stopped | failed
  budget_usd  NUMERIC,
  cost_usd    NUMERIC NOT NULL DEFAULT 0,
  note        TEXT,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS platform.assessment_trials (
  id            SERIAL PRIMARY KEY,
  assessment_id INTEGER NOT NULL,
  kind          TEXT NOT NULL,
  company       TEXT NOT NULL,
  module        TEXT,
  source_id     INTEGER NOT NULL,
  model         TEXT NOT NULL,
  seq           INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'queued',     -- queued | running | done | failed
  output        JSONB,
  score         JSONB,
  cost_usd      NUMERIC NOT NULL DEFAULT 0,
  ms            INTEGER,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS assessment_trials_order ON platform.assessment_trials (assessment_id, seq);
CREATE TABLE IF NOT EXISTS platform.assessment_picks (
  id            SERIAL PRIMARY KEY,
  assessment_id INTEGER NOT NULL,
  kind          TEXT NOT NULL,
  source_id     INTEGER NOT NULL,
  company       TEXT,
  left_model    TEXT NOT NULL,
  right_model   TEXT NOT NULL,
  pick          TEXT NOT NULL,                -- left | right | same | neither
  winner        TEXT,                         -- the model picked; NULL for same and neither
  note          TEXT,
  picked_by     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (assessment_id, kind, source_id)
);
`;

async function init() {
  await q(SCHEMA);
  // A company pin on a model that runs no job any more (Sonnet 5, Opus 5) is cleared, so the column says what
  // happens. Until 2026-09-22 saving the Agent settings page pinned whatever was in force, so most pins are that.
  const ids = agent.MODELS.map((m) => m.id);
  for (const job of agent.COMPANY_JOBS) {
    const r = await q(`UPDATE platform.companies SET model_${job}=NULL WHERE model_${job} IS NOT NULL AND NOT (model_${job} = ANY($1::text[])) RETURNING slug`, [ids]);
    if (r.rowCount) console.log(`[models] ${job} was pinned to a retired model for ${r.rows.map((x) => x.slug).join(", ")}; now the platform's model`);
  }
  const env = agent.retiredEnvSet();
  if (env.length) console.log(`[models] ${env.join(", ")} set on this instance and no longer read (the models are set on /admin#models); delete them`);
  const s = await agent.instanceModels();
  const own = Object.entries(s.jobs).map(([j, m]) => `${j} ${m}`);
  console.log(`[models] baseline ${s.baseline}; short text jobs ${s.summary}${own.length ? `; own model for ${own.join(", ")}` : ""}${s.ab.on ? `; live A/B on for ${s.ab.jobs.join(", ")} since ${s.ab.since}` : ""}`);
  // trials that were running when the last process died run again
  await q("UPDATE platform.assessment_trials SET status='queued' WHERE status='running'");
  // resumed a little after boot, once the module versions are on disk again (registry.loadAll)
  for (const a of (await q("SELECT id FROM platform.assessments WHERE status='running'")).rows) setTimeout(() => drive(a.id), Number(process.env.SOS_ASSESS_RESUME_MS || 15000)).unref();
}

// ---- which cases exist ----------------------------------------------------------------
// Never a paying site's work (stage 3, 2026-09-26): its data is used for other customers only with the learning opt-in
// (the Terms, 10.2), and a trial's cost is metered under the company, so it would count against the site's fair-use
// line. PAYING: the SQL that keeps a company whose site is switching on or subscribed out.
// (a site switched on by hand counts too, src/activate.js switchOn: its data is a real floor's)
const PAYING = (col) => `NOT EXISTS (SELECT 1 FROM platform.sites st WHERE st.company = ${col} AND (st.stage IN ('activating','subscribed') OR st.switched_on IS NOT NULL))`;
async function sources(kind, company, limit) {
  const co = company || null, n = Math.max(1, Math.min(MAX_CASES, Number(limit) || MAX_CASES));
  if (kind === "crosscheck") return (await q(`
    SELECT r.id AS source_id, r.company, r.module FROM platform.build_runs r JOIN platform.check_labels l ON l.run_id = r.id
     WHERE l.label IN ('right','wrong') AND r.to_version IS NOT NULL AND r.lane IN ('ui','functionality')
       AND r.evidence->'cross_check'->>'verdict' IN ('pass','fail') AND COALESCE(r.evidence->'cross_check'->>'model','') <> 'platform checks'
       AND ($1::text IS NULL OR r.company=$1) AND ${PAYING("r.company")}
     ORDER BY r.id DESC LIMIT $2`, [co, n])).rows;
  if (kind === "proposal") return (await q(`
    SELECT * FROM (
      SELECT DISTINCT ON (f.id) f.id AS source_id, f.company, f.module FROM platform.feedback f
        JOIN platform.proposals p ON p.feedback_id = f.id AND p.status = 'approved'
        JOIN platform.build_runs r ON p.id = ANY(COALESCE(r.proposal_ids, ARRAY[r.proposal_id])) AND r.from_version IS NOT NULL AND r.lane IN ('ui','functionality')
       WHERE COALESCE(f.kind, 'feedback') = 'feedback' AND f.module IS NOT NULL AND f.module <> 'platform' AND f.review_id IS NULL
         AND f.duplicate_of IS NULL AND f.name IS DISTINCT FROM 'Brand' AND ($1::text IS NULL OR f.company=$1) AND ${PAYING("f.company")}
       ORDER BY f.id, r.id) x
     ORDER BY source_id DESC LIMIT $2`, [co, n])).rows;
  if (kind === "design") return (await q(`
    SELECT id AS source_id, company, slug AS module FROM platform.module_intakes
     WHERE design IS NOT NULL AND status IN ('design','confirmed','building','done') AND ($1::text IS NULL OR company=$1) AND ${PAYING("module_intakes.company")}
     ORDER BY id DESC LIMIT $2`, [co, n])).rows;
  if (kind === "build") return (await q(`
    SELECT id AS source_id, company, module FROM platform.build_runs
     WHERE status = 'deployed' AND lane IN ('ui','functionality') AND from_version IS NOT NULL AND to_version IS NOT NULL
       AND ($1::text IS NULL OR company=$1) AND ${PAYING("build_runs.company")}
     ORDER BY id DESC LIMIT $2`, [co, n])).rows;
  throw new Error(`unknown kind ${kind}`);
}

// Rough cost of one case on one model, from typical sizes (tokens in, out). Thinking counts as output. A build
// adds both models' cross-check of the result.
const TOKENS = { crosscheck: [20000, 2500], proposal: [18000, 1500], design: [14000, 7000], build: [60000, 12000] };
function estimateCase(kind, model) {
  const m = agent.modelInfo(model), [tin, tout] = TOKENS[kind];
  let usd = (tin * m.in + tout * m.out) / 1e6;
  if (kind === "build") for (const r of agent.MODELS) usd += estimateCase("crosscheck", r.id);
  return usd;
}
async function options(company) {
  const out = {};
  for (const kind of KINDS) {
    const n = (await sources(kind, company, MAX_CASES)).length;
    out[kind] = { label: KIND_LABEL[kind], available: n, per_case_usd: Object.fromEntries(agent.MODELS.map((m) => [m.id, round2(estimateCase(kind, m.id))])), picked: PICKED.has(kind) };
  }
  return out;
}
const round2 = (x) => Math.round(Number(x || 0) * 100) / 100;

// ---- start, drive, stop -----------------------------------------------------------------
async function create({ plan, company, budget_usd, by }) {
  const counts = {};
  for (const k of KINDS) { const n = Math.max(0, Math.min(MAX_CASES, Math.floor(Number((plan || {})[k]) || 0))); if (n) counts[k] = n; }
  if (!Object.keys(counts).length) throw Object.assign(new Error("pick at least one kind of case"), { status: 400 });
  if (!agent.haveKey()) throw new Error("ANTHROPIC_API_KEY not configured on this instance");
  const running = (await q("SELECT id FROM platform.assessments WHERE status='running' LIMIT 1")).rows[0];
  if (running) throw Object.assign(new Error(`assessment #${running.id} is still running; stop it or let it finish first`), { status: 409 });
  const models = agent.MODELS.map((m) => m.id);
  const budget = Number(budget_usd) > 0 ? Number(budget_usd) : null;
  const a = (await q("INSERT INTO platform.assessments (company, plan, models, baseline, budget_usd, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
    [company || null, JSON.stringify(counts), models, (await agent.instanceModels()).baseline, budget, by || null])).rows[0];
  let seq = 0, cases = 0;
  for (const kind of KINDS) {
    if (!counts[kind]) continue;
    const src = await sources(kind, company, counts[kind]);
    for (const [i, s] of src.entries()) {
      cases++;
      const order = i % 2 ? [...models].reverse() : models;   // the two take turns going first
      for (const m of order) await q("INSERT INTO platform.assessment_trials (assessment_id, kind, company, module, source_id, model, seq) VALUES ($1,$2,$3,$4,$5,$6,$7)", [a.id, kind, s.company, s.module, s.source_id, m, seq++]);
    }
  }
  await logEvent("assessment_started", a.id, { plan: counts, company: company || null, budget_usd: budget, cases, by: by || null });
  if (!cases) { await finish(a.id, "done", "Nothing to assess: no stored cases of the kinds asked for."); return (await get(a.id)).assessment; }
  drive(a.id);
  return a;
}

async function finish(id, status, note) {
  await q("UPDATE platform.assessments SET status=$2, note=COALESCE($3, note), finished_at=now() WHERE id=$1 AND status='running'", [id, status, note || null]);
  await logEvent("assessment_finished", id, { status, note: note || null });
}
async function stop(id, by) {
  const a = (await q("SELECT status FROM platform.assessments WHERE id=$1", [id])).rows[0];
  if (!a) throw Object.assign(new Error("assessment not found"), { status: 404 });
  if (a.status !== "running") throw Object.assign(new Error(`assessment #${id} is ${a.status}, not running`), { status: 409 });
  await finish(id, "stopped", `stopped by ${by || "the admin"}; the trial in flight finishes and is kept`);
}

const DRIVING = new Set();
function drive(id) {
  if (DRIVING.has(id)) return;
  DRIVING.add(id);
  (async () => {
    try {
      for (;;) {
        const a = (await q("SELECT * FROM platform.assessments WHERE id=$1", [id])).rows[0];
        if (!a || a.status !== "running") break;
        if (a.budget_usd != null && Number(a.cost_usd) >= Number(a.budget_usd)) { await finish(id, "stopped", `stopped at its budget of $${Number(a.budget_usd).toFixed(2)}`); break; }
        const t = (await q("SELECT * FROM platform.assessment_trials WHERE assessment_id=$1 AND status='queued' ORDER BY seq LIMIT 1", [id])).rows[0];
        if (!t) { await finish(id, "done", null); break; }
        await runTrial(t);
      }
    } catch (e) {
      console.error(`[assess] #${id}:`, e);
      await finish(id, "failed", String(e.message || e).slice(0, 500)).catch(() => {});
    } finally { DRIVING.delete(id); }
  })();
}

async function runTrial(t) {
  await q("UPDATE platform.assessment_trials SET status='running' WHERE id=$1", [t.id]);
  const t0 = Date.now();
  try {
    // the instance cap only: a trial is Anetix's spend, never the company's credit or its own budget (the launch audit 1.17)
    await agent.assertUnderCap(null);
    const out = await agent.withMeterTag("assess", () => TRIALS[t.kind](t));   // the meter files it as the trial it is (1.17)
    await q("UPDATE platform.assessment_trials SET status='done', output=$2, score=$3, cost_usd=$4, ms=$5, finished_at=now() WHERE id=$1",
      [t.id, JSON.stringify(out.output || {}), JSON.stringify(out.score || {}), Number(out.costUsd || 0), Date.now() - t0]);
    await spend(t, out.costUsd);
  } catch (e) {
    const cost = typeof e.costUsd === "number" ? e.costUsd : 0;
    await q("UPDATE platform.assessment_trials SET status='failed', error=$2, cost_usd=$3, ms=$4, finished_at=now() WHERE id=$1",
      [t.id, String(e.message || e).slice(0, 1000), cost, Date.now() - t0]);
    await spend(t, cost);
    // the AI service refusing (credit, key) or a budget: stop rather than fail every trial after this one
    const msg = String(e.message || e);
    if (require("./credit").classify(msg) || /AI budget|monthly AI cap/i.test(msg)) await finish(t.assessment_id, "stopped", `stopped: ${msg}`.slice(0, 500));
  }
}
async function spend(t, usd) {
  if (!usd) return;
  await q("UPDATE platform.assessments SET cost_usd = cost_usd + $2 WHERE id=$1", [t.assessment_id, usd]);
  await agent.recordUsage(t.company, t.module, "assess", t.model, usd, { assessment: t.assessment_id, trial: t.id, kind: t.kind, source: t.source_id });
}

function writeTree(dir, files) {
  for (const [rel, content] of Object.entries(files || {})) {
    if (content == null) continue;
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
}
const blockingOf = (findings) => (findings || []).filter((f) => f && f.severity === "blocking").map((f) => `${f.where}: ${f.what}`).slice(0, 8);

// The proposal a manager approved for a request, the first build it went into (whose from_version is the module
// as it was), and the AI's own words before any edit (the record keeps them).
async function approvedFor(feedbackId) {
  const p = (await q("SELECT * FROM platform.proposals WHERE feedback_id=$1 AND status='approved' ORDER BY id DESC LIMIT 1", [feedbackId])).rows[0];
  if (!p) return {};
  const run = (await q("SELECT * FROM platform.build_runs WHERE $1 = ANY(COALESCE(proposal_ids, ARRAY[proposal_id])) AND from_version IS NOT NULL ORDER BY id LIMIT 1", [p.id])).rows[0];
  const edit = (await q("SELECT before FROM platform.record WHERE kind='proposal_edited' AND proposal_id=$1 ORDER BY id LIMIT 1", [p.id])).rows[0];
  return { proposal: p, run, ai_text: edit ? edit.before : p.body, edited: Boolean(edit) };
}

// ---- one trial per kind: the same brief the real call gets ------------------------------
const TRIALS = {
  async crosscheck(t) {
    const run = (await q("SELECT r.*, l.label FROM platform.build_runs r LEFT JOIN platform.check_labels l ON l.run_id = r.id WHERE r.id=$1", [t.source_id])).rows[0];
    if (!run) throw new Error("the run is gone");
    const pipeline = require("./pipeline");
    const diff = await require("./checks").diffForRun(run);
    const ps = (await q("SELECT target_file, body FROM platform.proposals WHERE id = ANY($1::int[]) ORDER BY id", [run.proposal_ids || [run.proposal_id]])).rows;
    const { data, costUsd } = await pipeline.crossCheckCall({ model: t.model, company: run.company, lane: run.lane, targets: ps.map((x) => x.target_file).filter(Boolean), requirement: run.requirement || (ps[0] && ps[0].body) || "", diff, fromVersion: run.from_version, toVersion: run.to_version });
    const old = run.evidence && run.evidence.cross_check && run.evidence.cross_check.verdict;
    // a Right label keeps the reviewer's verdict at the time, Wrong flips it (the same reading as the checks page)
    const expected = run.label === "right" ? old : run.label === "wrong" ? (old === "fail" ? "pass" : "fail") : null;
    return { output: { verdict: data.verdict, summary: data.summary, blocking: blockingOf(data.findings) }, score: { expected, matches: expected ? data.verdict === expected : null }, costUsd };
  },

  async proposal(t) {
    const fb = (await q("SELECT * FROM platform.feedback WHERE id=$1", [t.source_id])).rows[0];
    if (!fb) throw new Error("the request is gone");
    const ref = await approvedFor(fb.id);
    if (!ref.proposal || !ref.run) throw new Error("the approved proposal or its build is gone");
    const req = await require("./proposals").proposalRequest(fb, { force: true, alone: true, version: ref.run.from_version });
    const { data, costUsd } = await agent.runStructured({ model: t.model, company: fb.company, system: req.system, prompt: req.prompt, schema: req.schema, toolName: "proposal", blocks: req.blocks });
    return {
      output: { proposal: data.proposal, class: data.class, target_file: data.target_file || null, rationale: data.rationale, version: ref.run.from_version },
      score: { class_match: data.class === ref.proposal.class, target_match: (data.target_file || null) === (ref.proposal.target_file || null) },
      costUsd,
    };
  },

  async design(t) {
    const it = (await q("SELECT * FROM platform.module_intakes WHERE id=$1", [t.source_id])).rows[0];
    if (!it) throw new Error("the intake is gone");
    const d = await require("./intake").generateDesign({ ...it, model: t.model }, null, { usageKind: false });
    return {
      output: { bluf: d.bluf, items: d.items, reference_md: d.reference_md, screens: d.screens, connections: d.connections, leaves_out: d.leaves_out, flags: d.flags, estimate_usd: d.estimate_usd },
      score: { flags: (d.flags || []).length, screens: (d.screens || []).length, items: (d.items || []).length },
      costUsd: d.cost_usd || 0,
    };
  },

  async build(t) {
    const run = (await q("SELECT * FROM platform.build_runs WHERE id=$1", [t.source_id])).rows[0];
    if (!run) throw new Error("the run is gone");
    const pipeline = require("./pipeline"), registry = require("./registry"), gate = require("./modulegate");
    const walled = await require("./datawall").isWalled(run.company);
    const fromFiles = require("./datawall").filesForModel(await registry.versionFiles(run.company, run.module, run.from_version), walled);   // a walled company's seed rows never reach the trial's folder
    if (!fromFiles) throw new Error(`the files of v${run.from_version} are gone`);
    const ids = run.proposal_ids && run.proposal_ids.length ? run.proposal_ids : [run.proposal_id];
    const batch = await pipeline.proposalsText(run);
    const req = run.requirement ? `\n\nConfirmed requirement:\n${run.requirement}` : "";
    // a scratch folder, never the module's own: versions/<from> as it was, versions/<to> for the model to change
    const base = fs.mkdtempSync(path.join(os.tmpdir(), `sos-assess-${t.id}-`));
    const fromDir = path.join(base, "versions", String(run.from_version)), dir = path.join(base, "versions", String(run.to_version));
    writeTree(fromDir, fromFiles); writeTree(dir, fromFiles);
    let cost = 0;
    try {
      const guidance = await agent.guidanceFor(run.company, run.module);
      const out = await agent.runAgent({ model: t.model, company: run.company, system: guidance.text, dir, capUsd: agent.runCapUsd(ids.length),
        prompt: pipeline.buildPrompt({ mod: run.module, isBatch: ids.length > 1, batch, req, lane: run.lane, version: run.to_version, walled }) });
      cost += out.costUsd || 0;
      const verdict = gate.checkDir(dir, { fromFiles, lane: run.lane });
      let diff = "";
      try { diff = execFileSync("diff", ["-ruN", fromDir, dir], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }); } catch (e) { diff = e.stdout || ""; }
      const files = [...diff.matchAll(/^diff -ruN \S+ \S+\/versions\/\d+\/(\S+)$/gm)].map((m) => m[1]);
      const targets = (await q("SELECT target_file FROM platform.proposals WHERE id = ANY($1::int[])", [ids])).rows.map((x) => x.target_file).filter(Boolean);
      // both models check the result, so a build is never graded only by its own model
      const reviews = {};
      if (diff.trim()) for (const m of agent.MODELS.map((x) => x.id)) {
        const r = await pipeline.crossCheckCall({ model: m, company: run.company, lane: run.lane, targets, requirement: run.requirement || batch, diff, fromVersion: run.from_version, toVersion: run.to_version });
        cost += r.costUsd || 0;
        reviews[m] = { verdict: r.data.verdict, blocking: blockingOf(r.data.findings), summary: String(r.data.summary || "").slice(0, 1500) };
      }
      const other = agent.MODELS.map((x) => x.id).find((m) => m !== t.model);
      return {
        output: { summary: String(out.text || "").slice(0, 3000), models_seen: out.modelsSeen || [], gate: { ok: verdict.ok, line: verdict.ok ? null : gate.oneLine(verdict) }, files, diff_chars: diff.length, diff: diff.slice(0, 150000), reviews },
        score: { changed: Boolean(diff.trim()), gate_ok: verdict.ok, self_pass: Boolean(reviews[t.model] && reviews[t.model].verdict === "pass"), other_pass: Boolean(reviews[other] && reviews[other].verdict === "pass"), files: files.length },
        costUsd: cost,
      };
    } catch (e) { e.costUsd = (e.costUsd || 0) + cost; throw e; }
    finally { fs.rmSync(base, { recursive: true, force: true }); }
  },
};

// ---- blind picks ------------------------------------------------------------------------
// Which model is on the left, a fixed coin per case so a reload shows the same sides.
function leftIsFirst(aid, kind, sourceId) { return crypto.createHash("sha256").update(`${aid}:${kind}:${sourceId}`).digest()[0] % 2 === 0; }
function sides(a, kind, sourceId) { const [x, y] = a.models; return leftIsFirst(a.id, kind, sourceId) ? { left: x, right: y } : { left: y, right: x }; }

// What each side shows: the work, never the model, the cost or the time.
function blindView(kind, trial) {
  const o = trial.output || {};
  if (kind === "proposal") return { proposal: o.proposal, class: o.class, target_file: o.target_file, rationale: o.rationale };
  if (kind === "design") return { bluf: o.bluf, items: (o.items || []).map((i) => i.summary), screens: o.screens || [], leaves_out: o.leaves_out || [], flags: (o.flags || []).length, reference_md: o.reference_md };
  if (kind === "build") {
    const rv = Object.values(o.reviews || {});
    return { summary: o.summary, files: o.files || [], gate: o.gate || {}, reviews_passed: rv.filter((r) => r.verdict === "pass").length, reviews: rv.length, blocking: [...new Set(rv.flatMap((r) => r.blocking || []))].slice(0, 10), diff: o.diff || "" };
  }
  return {};
}
// What both sides were working from, and what really happened (folded on the page).
async function caseContext(kind, sourceId) {
  if (kind === "proposal") {
    const fb = (await q("SELECT id, company, module, screen, message, name FROM platform.feedback WHERE id=$1", [sourceId])).rows[0] || {};
    const ref = await approvedFor(sourceId);
    return { title: `Request #${sourceId} on ${fb.module || "?"}`, words: fb.message, screen: fb.screen, by: fb.name, then: ref.proposal ? { proposal: ref.proposal.body, class: ref.proposal.class, target_file: ref.proposal.target_file, edited: ref.edited } : null };
  }
  if (kind === "design") {
    const it = (await q("SELECT id, company, name, design FROM platform.module_intakes WHERE id=$1", [sourceId])).rows[0] || {};
    return { title: `New module "${it.name || "?"}" (intake #${sourceId})`, then: it.design ? { bluf: it.design.bluf, items: (it.design.items || []).map((i) => i.summary) } : null };
  }
  if (kind === "build") {
    const run = (await q("SELECT id, company, module, lane, requirement, from_version, to_version, evidence FROM platform.build_runs WHERE id=$1", [sourceId])).rows[0] || {};
    const text = run.id ? await require("./pipeline").proposalsText(run).catch(() => "") : "";
    return { title: `Run #${sourceId} on ${run.module || "?"} (${run.lane === "ui" ? "look and feel" : "how it works"})`, requirement: run.requirement || text, then: { what_changed: (run.evidence || {}).what_changed || null, version: run.to_version } };
  }
  return {};
}

async function nextPick(id) {
  const a = (await q("SELECT * FROM platform.assessments WHERE id=$1", [id])).rows[0];
  if (!a) throw Object.assign(new Error("assessment not found"), { status: 404 });
  const trials = (await q("SELECT * FROM platform.assessment_trials WHERE assessment_id=$1 AND status='done' ORDER BY seq", [id])).rows;
  const picked = new Set((await q("SELECT kind, source_id FROM platform.assessment_picks WHERE assessment_id=$1", [id])).rows.map((p) => `${p.kind}:${p.source_id}`));
  const ready = [];
  for (const kind of KINDS) {
    if (!PICKED.has(kind)) continue;
    const bySource = new Map();
    for (const t of trials.filter((x) => x.kind === kind)) { if (!bySource.has(t.source_id)) bySource.set(t.source_id, {}); bySource.get(t.source_id)[t.model] = t; }
    for (const [sid, m] of bySource) if (a.models.every((x) => m[x]) && !picked.has(`${kind}:${sid}`)) ready.push({ kind, sid, m });
  }
  if (!ready.length) return { done: true, left_to_pick: 0 };
  const c = ready[0], s = sides(a, c.kind, c.sid);
  return { done: false, left_to_pick: ready.length, kind: c.kind, kind_label: KIND_LABEL[c.kind], source_id: c.sid, context: await caseContext(c.kind, c.sid), left: blindView(c.kind, c.m[s.left]), right: blindView(c.kind, c.m[s.right]) };
}

async function pick(id, { kind, source_id, pick: choice, note }, by) {
  const a = (await q("SELECT * FROM platform.assessments WHERE id=$1", [id])).rows[0];
  if (!a) throw Object.assign(new Error("assessment not found"), { status: 404 });
  if (!PICKED.has(kind) || !PICKS.has(choice)) throw Object.assign(new Error("pick left, right, same or neither for a proposal, design or build case"), { status: 400 });
  const sid = Number(source_id);
  const done = (await q("SELECT model, company FROM platform.assessment_trials WHERE assessment_id=$1 AND kind=$2 AND source_id=$3 AND status='done'", [id, kind, sid])).rows;
  if (!a.models.every((m) => done.some((d) => d.model === m))) throw Object.assign(new Error("both answers for that case are not in yet"), { status: 409 });
  const s = sides(a, kind, sid);
  const winner = choice === "left" ? s.left : choice === "right" ? s.right : null;
  await q(`INSERT INTO platform.assessment_picks (assessment_id, kind, source_id, company, left_model, right_model, pick, winner, note, picked_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (assessment_id, kind, source_id) DO UPDATE SET pick=EXCLUDED.pick, winner=EXCLUDED.winner, note=EXCLUDED.note, picked_by=EXCLUDED.picked_by, created_at=now()`,
    [id, kind, sid, done[0].company, s.left, s.right, choice, winner, String(note || "").slice(0, 1000) || null, by || null]);
  return { ok: true, revealed: { left: s.left, right: s.right, winner } };
}

// ---- the scorecard (pure: rows in, numbers out) -----------------------------------------
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
function share(done, field) {
  const xs = done.map((t) => (t.score || {})[field]).filter((v) => v === true || v === false);
  return xs.length ? { n: xs.filter(Boolean).length, of: xs.length } : null;
}
function scorecard(trials, picks, models, baseline) {
  const card = { kinds: {}, totals: {} };
  for (const m of models) card.totals[m] = { cost_usd: 0, done: 0, failed: 0 };
  for (const kind of KINDS) {
    const ts = trials.filter((t) => t.kind === kind);
    if (!ts.length) continue;
    const ps = picks.filter((p) => p.kind === kind);
    const k = { label: KIND_LABEL[kind], cases: new Set(ts.map((t) => t.source_id)).size, picked: ps.length, same: ps.filter((p) => p.pick === "same").length, neither: ps.filter((p) => p.pick === "neither").length, blind: PICKED.has(kind), models: {} };
    for (const m of models) {
      const mine = ts.filter((t) => t.model === m), done = mine.filter((t) => t.status === "done");
      const cost = mine.reduce((n, t) => n + Number(t.cost_usd || 0), 0);
      const row = {
        done: done.length, failed: mine.filter((t) => t.status === "failed").length, waiting: mine.filter((t) => t.status === "queued" || t.status === "running").length,
        cost_usd: round2(cost), cost_avg: done.length ? Math.round((done.reduce((n, t) => n + Number(t.cost_usd || 0), 0) / done.length) * 1000) / 1000 : null,
        secs_avg: done.length ? Math.round(avg(done.map((t) => Number(t.ms || 0) / 1000))) : null,
        wins: ps.filter((p) => p.winner === m).length, losses: ps.filter((p) => p.winner && p.winner !== m).length,
      };
      if (kind === "crosscheck") row.label = share(done, "matches");
      if (kind === "proposal") { row.class = share(done, "class_match"); row.target = share(done, "target_match"); }
      if (kind === "design") { row.flags_avg = avg(done.map((t) => Number((t.score || {}).flags || 0))); row.screens_avg = avg(done.map((t) => Number((t.score || {}).screens || 0))); }
      if (kind === "build") { row.gate = share(done, "gate_ok"); row.self = share(done, "self_pass"); row.other = share(done, "other_pass"); row.files_avg = avg(done.map((t) => Number((t.score || {}).files || 0))); row.unchanged = done.filter((t) => (t.score || {}).changed === false).length; }
      k.models[m] = row;
      card.totals[m].cost_usd = round2(card.totals[m].cost_usd + cost); card.totals[m].done += row.done; card.totals[m].failed += row.failed;
    }
    card.kinds[kind] = k;
  }
  card.reading = reading(card, models, baseline);
  return card;
}

// The suggestion, with its rules written where the page shows it (RULES). A kind of case speaks once it has at
// least MIN_CASES done on both models and, when it is picked blind, at least MIN_CASES picks.
const MIN_CASES = 5, MARGIN_PICKS = 2, MARGIN_POINTS = 15;
const RULES = `A kind of case counts once it has ${MIN_CASES} cases done on both models (and ${MIN_CASES} blind picks, for proposals, designs and builds). On a kind that counts, the other model is worse when it lost ${MARGIN_PICKS} or more blind picks than it won, or its objective score (label agreement, proposals that matched what was approved, builds the other model's check passed) is ${MARGIN_POINTS} points or more under the baseline's; better, the same the other way round. One kind worse keeps the baseline. Nothing worse, and cheaper, suggests switching; the live A/B then has to hold it on the floor.`;
const pct = (s) => (s && s.of ? (100 * s.n) / s.of : null);
function objectiveOf(kind, row) { return kind === "crosscheck" ? pct(row.label) : kind === "proposal" ? pct(row.class) : kind === "build" ? pct(row.other) : null; }
function reading(card, models, baseline) {
  const base = models.includes(baseline) ? baseline : models[0];
  const other = models.find((m) => m !== base);
  const label = (m) => agent.modelInfo(m).label;
  const lines = [], worse = [], better = [];
  let speaking = 0;
  for (const [kind, k] of Object.entries(card.kinds)) {
    const b = k.models[base], o = k.models[other];
    const enough = Math.min(b.done, o.done) >= MIN_CASES && (!k.blind || k.picked >= MIN_CASES);
    if (!enough) { lines.push(`${k.label}: not enough yet (${Math.min(b.done, o.done)} done on both${k.blind ? `, ${k.picked} picked` : ""}; ${MIN_CASES} needed).`); continue; }
    speaking++;
    const ob = objectiveOf(kind, b), oo = objectiveOf(kind, o);
    const pickGap = o.wins - o.losses, pointGap = ob != null && oo != null ? oo - ob : null;
    const isWorse = (k.blind && pickGap <= -MARGIN_PICKS) || (pointGap != null && pointGap <= -MARGIN_POINTS);
    const isBetter = !isWorse && ((k.blind && pickGap >= MARGIN_PICKS) || (pointGap != null && pointGap >= MARGIN_POINTS));
    if (isWorse) worse.push(k.label); else if (isBetter) better.push(k.label);
    const parts = [];
    if (k.blind) parts.push(`${label(other)} won ${o.wins}, lost ${o.losses}, ${k.same} about the same, ${k.neither} both missed`);
    if (pointGap != null) parts.push(`objective ${Math.round(oo)}% against ${Math.round(ob)}%`);
    lines.push(`${k.label}: ${isWorse ? "worse" : isBetter ? "better" : "no clear difference"} (${parts.join("; ")}).`);
  }
  const cb = card.totals[base], co = card.totals[other];
  const perCase = (t) => (t.done ? t.cost_usd / t.done : null);
  const ratio = perCase(cb) && perCase(co) != null ? perCase(co) / perCase(cb) : null;
  let verdict, suggest = null;
  if (!speaking) verdict = "Too few cases to say anything yet.";
  else if (worse.length) verdict = `Keep ${label(base)} as the baseline: ${label(other)} did worse on ${worse.join(", ").toLowerCase()}.`;
  else if (ratio != null && ratio < 1) { verdict = `${label(other)} held up${better.length ? ` and did better on ${better.join(", ").toLowerCase()}` : ""}, at about ${Math.round(ratio * 100)}% of the cost per case. Suggest making it the baseline, then running the live A/B to see it hold on the floor.`; suggest = other; }
  else if (better.length) { verdict = `${label(other)} did better on ${better.join(", ").toLowerCase()}${ratio != null ? `, at about ${Math.round(ratio * 100)}% of the cost per case` : ""}. Your call whether that is worth it.`; }
  else verdict = `No clear difference between the two on what was assessed${ratio != null ? `; ${label(other)} cost about ${Math.round(ratio * 100)}% as much per case` : ""}.`;
  return { baseline: base, challenger: other, verdict, suggest, lines, speaking, rules: RULES };
}

async function get(id) {
  const a = (await q("SELECT * FROM platform.assessments WHERE id=$1", [id])).rows[0];
  if (!a) throw Object.assign(new Error("assessment not found"), { status: 404 });
  const trials = (await q("SELECT id, kind, company, module, source_id, model, seq, status, score, cost_usd, ms, error, finished_at FROM platform.assessment_trials WHERE assessment_id=$1 ORDER BY seq", [id])).rows;
  const picks = (await q("SELECT kind, source_id, left_model, right_model, pick, winner, note, picked_by, created_at FROM platform.assessment_picks WHERE assessment_id=$1 ORDER BY id", [id])).rows;
  const baseline = (await agent.instanceModels()).baseline;
  const done = trials.filter((t) => t.status === "done" || t.status === "failed").length;
  return {
    assessment: { ...a, cost_usd: round2(a.cost_usd), budget_usd: a.budget_usd == null ? null : Number(a.budget_usd) },
    progress: { trials: trials.length, finished: done, failed: trials.filter((t) => t.status === "failed").length },
    card: scorecard(trials, picks, a.models, baseline),
    trials: trials.map((t) => ({ ...t, cost_usd: Number(t.cost_usd || 0) })),
    picks,
  };
}
async function list() {
  return (await q(`SELECT a.id, a.company, a.plan, a.status, a.cost_usd, a.budget_usd, a.created_at, a.finished_at, a.note, a.created_by,
      (SELECT count(*)::int FROM platform.assessment_trials t WHERE t.assessment_id=a.id) AS trials,
      (SELECT count(*)::int FROM platform.assessment_trials t WHERE t.assessment_id=a.id AND t.status IN ('done','failed')) AS finished,
      (SELECT count(*)::int FROM platform.assessment_picks p WHERE p.assessment_id=a.id) AS picks
    FROM platform.assessments a ORDER BY a.id DESC LIMIT 20`)).rows.map((a) => ({ ...a, cost_usd: round2(a.cost_usd), budget_usd: a.budget_usd == null ? null : Number(a.budget_usd) }));
}

// ---- the live A/B ------------------------------------------------------------------------
async function abView(settings) {
  const s = settings || await agent.instanceModels();
  if (!s.ab.since) return { settings: s.ab, split: null };
  const health = require("./health");
  const bundle = await health.load(0);
  bundle.arms = (await q("SELECT job, company, ref, model, created_at FROM platform.model_arms WHERE created_at >= $1", [s.ab.since])).rows;
  const until = s.ab.on ? null : s.ab.ended;
  return { settings: s.ab, split: health.abSplit(bundle, { since: s.ab.since, until, models: agent.MODELS.map((m) => m.id), now: bundle.now }), min_runs: health.AB_MIN_RUNS };
}

// ---- routes (admin only) -------------------------------------------------------------------
const router = express.Router();
const json = express.json({ limit: "200kb" });
const who = (req) => (req.sosAccount && (req.sosAccount.name || req.sosAccount.login)) || req.sosPerson || "admin";
const fail = (res, e) => res.status(e.status || 500).json({ error: e.message });

router.get("/api/admin/models", requireAdmin, async (req, res) => {
  try {
    const settings = await agent.instanceModels();
    const pins = (await q("SELECT slug, name, model_propose, model_build, model_review FROM platform.companies ORDER BY created_at")).rows
      .map((c) => ({ slug: c.slug, name: c.name, pins: Object.fromEntries(agent.COMPANY_JOBS.map((j) => [j, agent.inTier(c[`model_${j}`]) ? c[`model_${j}`] : null])) }))
      .filter((c) => Object.values(c.pins).some(Boolean));
    res.set("Cache-Control", "no-store").json({
      models: agent.MODELS, labels: agent.ALL_MODELS, jobs: agent.JOBS, company_jobs: agent.COMPANY_JOBS, ab_jobs: agent.AB_JOBS,
      summary_choices: agent.SUMMARY_CHOICES.map((id) => agent.modelInfo(id)),
      settings, defaults: await agent.defaultModels(settings), pins, retired_env: agent.retiredEnvSet(),
      ab: await abView(settings), assessments: await list(), kinds: KINDS.map((k) => ({ id: k, label: KIND_LABEL[k], blind: PICKED.has(k) })),
    });
  } catch (e) { fail(res, e); }
});
router.post("/api/admin/models", requireAdmin, json, async (req, res) => {
  try {
    const b = req.body || {}, cur = await agent.instanceModels();
    if (b.baseline != null && !agent.inTier(b.baseline)) return res.status(400).json({ error: "the baseline must be one of the two models" });
    if (b.summary != null && !agent.SUMMARY_CHOICES.includes(b.summary)) return res.status(400).json({ error: "unknown model for the short text jobs" });
    const jobs = { ...cur.jobs };
    if (b.jobs) for (const j of agent.JOBS) { if (!(j in b.jobs)) continue; const v = b.jobs[j]; if (!v) delete jobs[j]; else if (agent.inTier(v)) jobs[j] = v; else return res.status(400).json({ error: `unknown model for ${j}` }); }
    const next = await agent.setInstanceModels({ ...cur, baseline: b.baseline || cur.baseline, jobs, summary: b.summary || cur.summary }, who(req));
    await logEvent("instance_models_changed", 0, { before: { baseline: cur.baseline, jobs: cur.jobs, summary: cur.summary }, after: { baseline: next.baseline, jobs: next.jobs, summary: next.summary }, by: who(req), assessment: b.assessment || null });
    res.json({ ok: true, settings: next, defaults: await agent.defaultModels(next) });
  } catch (e) { fail(res, e); }
});
router.post("/api/admin/models/ab", requireAdmin, json, async (req, res) => {
  try {
    const b = req.body || {}, cur = await agent.instanceModels();
    const jobs = (Array.isArray(b.jobs) ? b.jobs : agent.AB_JOBS).filter((j) => agent.AB_JOBS.includes(j));
    let ab;
    if (b.on) {
      if (!jobs.length) return res.status(400).json({ error: "pick at least one job for the A/B" });
      // switching on starts a fresh count; changing the jobs of a running test keeps its start
      ab = { on: true, jobs, since: cur.ab.on ? cur.ab.since : new Date().toISOString(), by: who(req) };
    } else ab = { on: false, since: cur.ab.since, by: cur.ab.by, ended: new Date().toISOString() };
    const next = await agent.setInstanceModels({ ...cur, ab }, who(req));
    await logEvent("model_ab_changed", 0, { on: next.ab.on, jobs: next.ab.jobs, since: next.ab.since, by: who(req) });
    res.json({ ok: true, settings: next });
  } catch (e) { fail(res, e); }
});
router.post("/api/admin/models/unpin", requireAdmin, json, async (req, res) => {
  try {
    const slug = String((req.body || {}).slug || "");
    const was = (await q("SELECT model_propose, model_build, model_review FROM platform.companies WHERE slug=$1", [slug])).rows[0];
    if (!was) return res.status(404).json({ error: "unknown company" });
    await q("UPDATE platform.companies SET model_propose=NULL, model_build=NULL, model_review=NULL WHERE slug=$1", [slug]);
    await require("./record").record("models_changed", { company: slug, actor: require("./record").actor(req), before: JSON.stringify(was), after: JSON.stringify({ propose: null, build: null, review: null }), detail: { unpinned_from: "admin models" } });
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
});
router.get("/api/admin/assess/options", requireAdmin, async (req, res) => {
  try { res.set("Cache-Control", "no-store").json({ kinds: await options(req.query.company || null), max_cases: MAX_CASES }); } catch (e) { fail(res, e); }
});
router.post("/api/admin/assess", requireAdmin, json, async (req, res) => {
  try { const b = req.body || {}; res.json(await create({ plan: b.plan, company: b.company || null, budget_usd: b.budget_usd, by: who(req) })); } catch (e) { fail(res, e); }
});
router.get("/api/admin/assess/:id(\\d{1,9})", requireAdmin, async (req, res) => {
  try { res.set("Cache-Control", "no-store").json(await get(Number(req.params.id))); } catch (e) { fail(res, e); }
});
router.get("/api/admin/assess/:id(\\d{1,9})/pick", requireAdmin, async (req, res) => {
  try { res.set("Cache-Control", "no-store").json(await nextPick(Number(req.params.id))); } catch (e) { fail(res, e); }
});
router.post("/api/admin/assess/:id(\\d{1,9})/pick", requireAdmin, json, async (req, res) => {
  try { res.json(await pick(Number(req.params.id), req.body || {}, who(req))); } catch (e) { fail(res, e); }
});
router.post("/api/admin/assess/:id(\\d{1,9})/stop", requireAdmin, json, async (req, res) => {
  try { await stop(Number(req.params.id), who(req)); res.json({ ok: true }); } catch (e) { fail(res, e); }
});
// One trial in full, model and all (after the picks, to read the answers side by side with their names).
router.get("/api/admin/assess/:id(\\d{1,9})/trials/:tid(\\d{1,9})", requireAdmin, async (req, res) => {
  try {
    const t = (await q("SELECT * FROM platform.assessment_trials WHERE id=$1 AND assessment_id=$2", [Number(req.params.tid), Number(req.params.id)])).rows[0];
    if (!t) return res.status(404).json({ error: "trial not found" });
    res.set("Cache-Control", "no-store").json({ ...t, cost_usd: Number(t.cost_usd || 0) });
  } catch (e) { fail(res, e); }
});

module.exports = { init, router, SCHEMA, KINDS, sources, options, create, stop, drive, get, list, nextPick, pick, scorecard, reading, sides, estimateCase, abView, TRIALS, RULES, MIN_CASES };
