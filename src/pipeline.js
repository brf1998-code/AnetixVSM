// Build pipeline: the two lanes.
//
//   UI lane:            build -> visual_check -> await_deploy
//   Functionality lane: confirm_requirement (manager gate) -> build
//                       -> cross_check (independent agent) -> test_run -> await_deploy
//
// visual_check and test_run are the same thing since 2026-09-19 (runChecks,
// build order item 7): the declared endpoints answer, EVERY acceptance check
// the module has collected passes (src/acceptance.js), and every screen opens
// without a script error (src/pageload.js). Before that both were "the page
// answers below 500", so a 404 passed.
//
// State lives in platform.build_runs (step/status). Steps run async; the board
// polls. Failures stop the run in place with a plain-language log entry.
//
// A batch = several approved proposals for the same module built together in
// ONE agent run, one staged demo, one deploy. Only one run is active per
// module at a time; further runs queue and start when the active one ends.
//
// Changes join the preview (2026-09-28, from a PE partner's demo: "I could not update a preview build with new
// functionality; it seemed I had to make it go live to add or modify"). A change approved while a tool has a build
// waiting at the deploy gate no longer waits for that build to go live: it is built ON TOP of the preview (the draft
// is a copy of the staged version, not of the live one), the run below is set aside as "stacked", the new run's
// proposal_ids carry every change in the preview, and the board shows one card with one deploy for all of them.
// Several changes approved while the preview is still building are merged into one run and added together when it
// reaches the gate. Discarding the top of the stack takes only that change out and puts the preview below back at
// the gate (Brendan's call: peel off the last one). evidence.stack on the top run: { on, own, base, live, carried }.
// A new tool that has never been live works the same way, which is how its first version gets changed before anyone
// uses it.
const { q, logEvent } = require("./db");
const { runAgent, runStructured, haveKey, assertUnderCap, modelFor, buildModelFor, guidanceFor, runCapUsd, inTier, pickModel, keepArm, companyPins, summaryModel, AGENT_EFFORT } = require("./agent");
const registry = require("./registry");
const gate = require("./modulegate");
const { record } = require("./record");
const acceptance = require("./acceptance");
const pageload = require("./pageload");
const auth = require("./auth");

const CROSS_CHECK_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["pass", "fail"], description: "fail only when at least one finding is blocking." },
    summary: { type: "string", description: "What was checked and what was found, in plain language for a production manager. Two to five sentences." },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          severity: { type: "string", enum: ["blocking", "minor"], description: "blocking = the requirement is not met, or the floor would notice something wrong or missing, or a hard rule is broken. minor = worth a note, does not stop the deploy." },
          where: { type: "string", description: "File and place." },
          what: { type: "string", description: "The problem, one or two sentences, plain words." },
          evidence: { type: "string", description: "The diff lines that show it (quote them). Required for a blocking finding." },
        },
        required: ["severity", "where", "what", "evidence"],
      },
    },
  },
  required: ["verdict", "summary", "findings"],
};

// A push starts the new process while the old one is still running (Railway switches over once the new one answers,
// then stops the old one). The new one's boot sweep takes over every build that was running (sweepOrphans: marked
// failed, or started again) and stamps it with its own boot (fence). From then on the older process may not write to
// that run: its agent can still be talking for a few seconds, and until 2026-09-27 whatever it wrote last (a step, a
// status) landed over the new process's. Boots are start times, so any newer process may write, an older one not.
// A refused write throws { fenced: true }, which ends the older process's chain (failRun lets it go quietly).
const FENCE = /^\d{1,15}$/.test(String(process.env.SOS_BOOT_ID || "")) ? Number(process.env.SOS_BOOT_ID) : Date.now();
async function fenced(runId) {
  const r = (await q("SELECT fence FROM platform.build_runs WHERE id=$1", [runId])).rows[0];
  if (r && r.fence != null && Number(r.fence) > FENCE) throw Object.assign(new Error(`run #${runId} was taken over by a newer process`), { fenced: true });
}
async function log(runId, entry) {
  const r = await q(`UPDATE platform.build_runs SET log = log || $2::jsonb, updated_at=now() WHERE id=$1 AND (fence IS NULL OR fence <= $3) RETURNING id`,
    [runId, JSON.stringify([{ t: new Date().toISOString(), ...entry }]), FENCE]);
  if (!r.rowCount) await fenced(runId);
}
async function setRun(runId, fields) {
  // a run this process sets running is this process's to drive: stamped, so a newer process's late sweep can tell a
  // run an older process left behind (sweepOrphans) from one of its own
  if (fields.status === "running" && fields.fence === undefined) fields = { ...fields, fence: FENCE };
  const keys = Object.keys(fields);
  const sets = keys.map((k, i) => `${k}=$${i + 2}`).join(", ");
  const r = await q(`UPDATE platform.build_runs SET ${sets}, updated_at=now() WHERE id=$1 AND (fence IS NULL OR fence <= $${keys.length + 2}) RETURNING id, company, module, step, status`,
    [runId, ...keys.map((k) => (fields[k] !== null && typeof fields[k] === "object" ? JSON.stringify(fields[k]) : fields[k])), FENCE]);
  if (!r.rowCount) await fenced(runId);
  // a build that just reached the deploy gate (here, or from the test campaign's steps): changes approved meanwhile
  // are added on top of its preview now, not after it goes live
  const row = r.rows[0];
  if (fields.status === "waiting" && row && row.step === "await_deploy" && !SHUTDOWN) setImmediate(() => kickQueue(row.company, row.module));
}
// SIGTERM (src/restart.js): the process is going. Builds whose agent is talking are stopped and marked as cut off by the
// restart (unless a newer process took them over already); nothing new starts from the queue here.
let SHUTDOWN = false;
function shutdown() {
  SHUTDOWN = true;
  const ids = [...ACTIVE.keys()];
  for (const [id, ctl] of ACTIVE) { try { ctl.abort(); } catch (e) { /* already */ } console.log(`[pipeline] run #${id}: the agent is stopped, the platform is restarting`); }
  return ids;
}
async function addCost(runId, usd) {
  await q("UPDATE platform.build_runs SET cost_usd = cost_usd + $2 WHERE id=$1", [runId, usd || 0]);
}
async function getRun(runId) {
  return (await q("SELECT * FROM platform.build_runs WHERE id=$1", [runId])).rows[0];
}
// The model for one of a run's own calls (the requirement, the review): the company's pin for that job, then the
// run's arm of the live A/B, then the instance's model for the job. A run on the A/B runs on one model end to end.
async function modelForRun(run, job) {
  const pin = (await companyPins(run.company))[job];
  if (pin) return pin;
  const arm = run.evidence && run.evidence.ab && run.evidence.ab.arm;
  return inTier(arm) ? arm : modelFor(run.company, job);
}
async function loadProposals(ids) {
  const rows = (await q(
    `SELECT p.*, f.company, f.module, f.message, f.page, f.screen, f.name AS reporter
       FROM platform.proposals p JOIN platform.feedback f ON f.id=p.feedback_id
      WHERE p.id = ANY($1::int[]) ORDER BY p.id`, [ids])).rows;
  if (rows.length !== ids.length) throw new Error("one or more proposals not found");
  return rows;
}
async function activeRun(company, mod) {
  return (await q(
    "SELECT * FROM platform.build_runs WHERE company=$1 AND module=$2 AND status IN ('running','waiting') ORDER BY id LIMIT 1", [company, mod])).rows[0];
}
// A preview with a change being added on top: the run below waits as "stacked" until the top one goes live (and
// takes it along) or is taken out (and puts it back at the gate).
async function stackedRun(company, mod) {
  return (await q("SELECT * FROM platform.build_runs WHERE company=$1 AND module=$2 AND status='stacked' ORDER BY id DESC LIMIT 1", [company, mod])).rows[0];
}
// The proposals this run builds itself. A run added on top of a preview carries every change in that preview in
// proposal_ids (so the board, the deploy and the floor's "did it fix it?" see them all) and builds only its own.
function ownIds(run) {
  const st = (run && run.evidence && run.evidence.stack) || null;
  if (st && Array.isArray(st.own) && st.own.length) return st.own.map(Number);
  return (run.proposal_ids && run.proposal_ids.length ? run.proposal_ids : [run.proposal_id]).map(Number);
}
// The runs a run's preview carries, nearest first (each stacked under the one above it).
async function chainBelow(run) {
  const out = []; const seen = new Set([run.id]);
  let cur = run;
  while (cur && cur.evidence && cur.evidence.stack && cur.evidence.stack.on && !seen.has(Number(cur.evidence.stack.on))) {
    const below = await getRun(Number(cur.evidence.stack.on));
    if (!below) break;
    seen.add(below.id); out.push(below); cur = below;
  }
  return out;
}

// The requirement gate: a functionality change stopped after its requirement was written until the manager confirmed
// it. Off since 2026-10-01 (the approval a moment before is the confirmation; the requirement still guides the build
// and the review, and the card shows it). SOS_REQUIREMENT_GATE=on brings the stop back.
const requirementGate = () => /^(on|1|true|yes)$/i.test(String(process.env.SOS_REQUIREMENT_GATE || ""));

// ---- entry point: start a run from one or more approved proposals ----------
async function startRun(proposalIds, opts = {}) {
  const ids = (Array.isArray(proposalIds) ? proposalIds : [proposalIds]).map(Number);
  const ps = await loadProposals(ids);
  for (const p of ps) if (p.status !== "approved") throw new Error(`proposal #${p.id} is not approved`);
  const { company, module: mod } = ps[0];
  if (ps.some((p) => p.module !== mod || p.company !== company)) throw new Error("a batch must be for one module");
  const modRow = await registry.getModule(company, mod);
  if (!modRow) throw new Error(`feedback has no valid module (${company}/${mod})`);
  await assertUnderCap(company);

  const lane = ps.every((p) => p.class === "ui") ? "ui" : "functionality";
  const step = lane === "ui" ? "build" : "confirm_requirement";
  // the build model: one the caller named, else the company's, the instance's, or the run's arm of the live A/B
  // (src/agent.js pickModel). An arm is kept on the run (evidence.ab) and the run's requirement and review follow it.
  let model, ab = null;
  if (opts.model && inTier(opts.model)) model = opts.model;
  else { const pick = await pickModel(company, "build", null); model = pick.model; if (pick.arm) ab = { arm: model, since: pick.since }; }
  const busy = (await activeRun(company, mod)) || (await stackedRun(company, mod));
  const r = await q(
    `INSERT INTO platform.build_runs (proposal_id, proposal_ids, company, module, from_version, lane, step, status, model, evidence, fence)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [ids[0], ids, company, mod, modRow.live_version, lane, step, busy ? "queued" : "running", model, JSON.stringify(ab ? { ab } : {}), FENCE]);
  const run = r.rows[0];
  if (ab) await keepArm("build", company, `run:${run.id}`, model);
  await q("UPDATE platform.feedback SET status='in_progress', updated_at=now() WHERE id = ANY($1::int[])", [ps.map((p) => p.feedback_id)]);
  await logEvent("run_started", run.id, { lane, company, module: mod, batch: ids, model, queued: Boolean(busy) });
  if (busy) {
    await log(run.id, { step, note: `queued behind run #${busy.id}; it is added to that preview as soon as the preview is ready` });
    await kickQueue(company, mod);   // a preview already waiting at the gate takes it on top now
    return (await getRun(run.id)) || run;
  }
  advance(run.id).catch((e) => failRun(run.id, e));
  return run;
}

// Move a module's queue along: a preview waiting at the gate takes the queued changes on top of it (joinPreview);
// with nothing active and no preview being added to, the oldest queued run starts from the live version.
// One kick at a time per module (two approvals in the same instant must not both claim the same preview).
const KICKS = new Map();
function kickQueue(company, mod) {
  if (SHUTDOWN) return Promise.resolve();   // the process is going: the next one's boot starts the queue (sweepOrphans)
  const key = `${company}/${mod}`;
  const next = (KICKS.get(key) || Promise.resolve()).then(() => kickOnce(company, mod)).catch((e) => console.error("queue kick failed:", e));
  KICKS.set(key, next);
  next.then(() => { if (KICKS.get(key) === next) KICKS.delete(key); });
  return next;
}
async function kickOnce(company, mod) {
  for (;;) {
    if (SHUTDOWN) return;
    const act = await activeRun(company, mod);
    if (act) { if (act.status === "waiting" && act.step === "await_deploy") await joinPreview(act); return; }
    if (await stackedRun(company, mod)) return;   // the change on top of a preview stopped: fixed, retried or taken out first
    const next = (await q(
      "SELECT * FROM platform.build_runs WHERE company=$1 AND module=$2 AND status='queued' ORDER BY id LIMIT 1", [company, mod])).rows[0];
    if (!next) return;
    // a queued run is a new start when it actually starts: a paying site past its fair-use line does not start it
    try { await require("./selfserve").assertCredit(company, { started: true, fairUse: true }); }
    catch (e) { await setRun(next.id, { status: "failed" }); await log(next.id, { step: next.step, note: String(e.message || e) }); continue; }
    const modRow = await registry.getModule(company, mod);
    await setRun(next.id, { status: "running", from_version: modRow.live_version });
    await log(next.id, { step: next.step, note: "started from the queue" });
    advance(next.id).catch((e) => failRun(next.id, e));
    return;
  }
}

// The changes queued behind a preview go on top of it: merged into one run (the oldest), built from the staged
// version, carrying every change already in the preview. The preview's run is set aside as "stacked".
async function joinPreview(top) {
  const { company, module: mod } = top;
  const modRow = await registry.getModule(company, mod);
  if (!modRow || !top.to_version || Number(modRow.staged_version) !== Number(top.to_version)) return;   // the preview is not this build's any more
  const queued = (await q("SELECT * FROM platform.build_runs WHERE company=$1 AND module=$2 AND status='queued' ORDER BY id", [company, mod])).rows;
  // a retried or fixed run keeps its own draft and waits its turn; only changes that have not started join
  const fresh = queued.filter((r) => !r.to_version && !(r.evidence || {}).fix_round && !(r.evidence || {}).stack && r.lane !== "module");
  if (!fresh.length) return;
  try { await require("./selfserve").assertCredit(company, { started: true, fairUse: true }); }
  catch (e) { for (const r of fresh) { await setRun(r.id, { status: "failed" }); await log(r.id, { step: r.step, note: String(e.message || e) }); } return; }
  const lead = fresh[0], rest = fresh.slice(1);
  const own = [...new Set(fresh.flatMap((r) => (r.proposal_ids && r.proposal_ids.length ? r.proposal_ids : [r.proposal_id]).map(Number)))];
  const ps = await loadProposals(own);
  const lane = ps.every((p) => p.class === "ui") ? "ui" : "functionality";
  const step = lane === "ui" ? "build" : "confirm_requirement";
  // claim the preview: one change at a time goes on top of it
  const claimed = await q("UPDATE platform.build_runs SET status='stacked', updated_at=now() WHERE id=$1 AND status='waiting' AND step='await_deploy' AND (fence IS NULL OR fence <= $2) RETURNING *", [top.id, FENCE]);
  if (!claimed.rowCount) return;
  const tev = top.evidence || {};
  const topIds = (top.proposal_ids && top.proposal_ids.length ? top.proposal_ids : [top.proposal_id]).map(Number);
  const carried = [...(((tev.stack || {}).carried) || []), { run: top.id, proposal_ids: ownIds(top), title: tev.title || null, what_changed: String(tev.what_changed || tev.build_summary || "").slice(0, 600) || null, lane: top.lane }];
  const stack = { on: top.id, own, base: Number(top.to_version), live: modRow.live_version == null ? null : Number(modRow.live_version), carried };
  const all = [...topIds, ...own.filter((id) => !topIds.includes(id))];
  await setRun(top.id, { evidence: { ...tev, stacked_under: lead.id } });
  await log(top.id, { step: "stack", note: `run #${lead.id} adds ${own.length === 1 ? "a change" : `${own.length} changes`} on top of this preview; they go live together` });
  await q("UPDATE platform.build_runs SET proposal_ids=$2::int[], updated_at=now() WHERE id=$1", [lead.id, all]);
  await setRun(lead.id, { lane, step, status: "running", from_version: Number(top.to_version), evidence: { ...(lead.evidence || {}), stack } });
  for (const r of rest) {
    await setRun(r.id, { status: "cancelled", evidence: { ...(r.evidence || {}), merged_into: lead.id } });
    await log(r.id, { step: r.step, note: `added to run #${lead.id}, which builds it on top of the preview with the other changes approved meanwhile` });
  }
  await log(lead.id, { step, note: `added to the preview of run #${top.id} (v${top.to_version}, not live yet): built on top of it, and one deploy puts every change in it live${rest.length ? `; runs #${rest.map((r) => r.id).join(", #")} were merged into this one` : ""}` });
  await logEvent("preview_joined", lead.id, { company, module: mod, on: top.id, base: top.to_version, own, merged: rest.map((r) => r.id) });
  await record("preview_joined", { company, module: mod, actor: "platform", run_id: lead.id, proposal_id: own[0], version: Number(top.to_version), detail: { on: top.id, own, carried: carried.map((c) => c.run), merged: rest.map((r) => r.id) } });
  advance(lead.id).catch((e) => failRun(lead.id, e));
}

// Text block describing every proposal in the run, for prompts.
async function proposalsText(run) {
  const ps = await loadProposals(ownIds(run));
  return ps.map((p, i) =>
    `${ps.length > 1 ? `Change ${i + 1} of ${ps.length}` : "Approved proposal"} (${p.class})\n` +
    `Target file: ${p.target_file || "unspecified"}${p.screen ? ` (the "${p.screen}" screen)` : ""}\n` +
    `${p.body}\n` +
    `Original floor feedback: "${p.message}" (filed from ${p.screen || p.page || "an unknown screen"}, by ${p.reporter || "anonymous"})`
  ).join("\n\n");
}

// Short title (for the version list) and a two-sentence "what changed" for
// operators, from the approved changes and the agent's final message. On the
// short text jobs' model (agent.summaryModel, Sonnet 5 by default).
async function plainSummary(batch, agentText, isBatch, company) {
  const model = await summaryModel();
  const { data, costUsd } = await runStructured({
    model, company,
    system: "You write one-line change notes for people on a factory floor. Plain words, no code talk, no praise, no preamble.",
    prompt: `Approved changes:\n${batch}\n\nWhat the build agent reported:\n${(agentText || "").slice(0, 3000)}\n\nWrite a title of at most 8 words naming what changed${isBatch ? " (it is a batch, so summarize the theme, e.g. 'Station page: fold names, clip position, distance unit')" : ""}, and a what_changed of one to three short sentences an operator would understand, naming the screen.`,
    schema: { type: "object", properties: { title: { type: "string" }, what_changed: { type: "string" } }, required: ["title", "what_changed"] },
    toolName: "summary",
  });
  return { title: String(data.title || "").slice(0, 80), what_changed: String(data.what_changed || "").slice(0, 600), costUsd, model };
}

// The AbortController of every build agent in flight, by run id, so a manager
// can abort a run that is stuck or wrong instead of waiting on the cost cap.
const ACTIVE = new Map();

async function failRun(runId, err) {
  try { return await failRunInner(runId, err); }
  catch (e) { if (e && e.fenced) { console.log(`[pipeline] run #${runId}: ${e.message}; this process lets it go`); return; } throw e; }
}
async function failRunInner(runId, err) {
  if (err && typeof err.costUsd === "number") await addCost(runId, err.costUsd);
  // a newer process took this run over at a restart: what this one had to say about it no longer counts
  if (err && err.fenced) { console.log(`[pipeline] run #${runId}: ${err.message}; this process lets it go`); return; }
  if (SHUTDOWN) err = new Error("the platform restarted while this build was running; nothing was deployed. Retry or cancel.");
  const before = await getRun(runId);
  if (before && before.status === "cancelled") {
    // the manager aborted it; cancel() already recorded that
    await log(runId, { step: before.step, note: "agent stopped" });
    return;
  }
  console.error(`run ${runId} failed:`, err);
  if (err && err.diag) await log(runId, { step: "diag", note: JSON.stringify(err.diag) });
  await log(runId, { step: "error", note: String(err.message || err) });
  // the AI service itself refusing (no credit, a bad key, too busy) is not the build's fault and not the manager's
  // problem: the card says so in plain words (src/credit.js) and /admin shows it red
  const aiDown = SHUTDOWN ? null : await require("./credit").noteFailure(String(err.message || err), `build run #${runId}`);
  if (aiDown) await setRun(runId, { evidence: { ...((before && before.evidence) || {}), ai_unavailable: aiDown } });
  await setRun(runId, { status: "failed" });
  const run = await getRun(runId);
  if (!run) return;
  // a failed check goes back to the agent on its own, up to SOS_AUTO_FIX_ROUNDS times, before the manager sees a stop
  if (!aiDown && !SHUTDOWN && await autoFix(run).catch((e) => { console.error(`auto fix of run ${runId} failed:`, e); return false; })) return;
  // a demo's build that stopped with no preview: its spend handed back, and on /admin until addressed (src/demostops.js)
  await require("./demostops").onStop(run, { aiDown }).catch((e) => console.error(`[demostops] run ${runId}:`, e.message));
  if (!SHUTDOWN) kickQueue(run.company, run.module).catch((e) => console.error("queue kick failed:", e));
}

// Most stops clear on the second or third attempt (checks campaign, 2026-09-25: the
// reviewer, a check that wanted text the screen only shows after a tap, a check
// title over the limit, a script error). Until now every one of them waited for a
// manager to press Fix. Now the platform presses it: a build that failed the
// cross-check, the module gate, the tests or the visual check goes straight back
// to the agent with the findings, in the same draft, up to AUTO_FIX_ROUNDS times.
// Then it stops as before, with one manual round left (MAX_FIX_ROUNDS). Never for a
// failed test campaign (the manager's own cases), an AI outage or a cost cap.
// SOS_AUTO_FIX_ROUNDS=0 turns it off.
const AUTO_FIX_ROUNDS = Math.max(0, Number(process.env.SOS_AUTO_FIX_ROUNDS ?? 2));
async function autoFix(run) {
  if (!AUTO_FIX_ROUNDS || run.status !== "failed" || !run.to_version) return false;
  if (!["cross_check", "test_run", "visual_check"].includes(run.step)) return false;
  const ev = run.evidence || {};
  if ((ev.fix_round || 0) >= AUTO_FIX_ROUNDS) return false;
  const last = String(((run.log || []).filter((l) => l.step === "error").slice(-1)[0] || {}).note || "");
  if (/cost passed|safety budget|monthly AI cap|platform restarted|could not sign itself in/i.test(last)) return false;
  await fix(run.id, { auto: true });
  await record("run_fixed", { company: run.company, module: run.module, actor: "platform", run_id: run.id, proposal_id: run.proposal_id, version: run.to_version, before: (ev.cross_check && ev.cross_check.summary) || last || null, detail: { round: (ev.fix_round || 0) + 1, auto: true } }).catch((e) => console.error("record run_fixed:", e.message));
  return true;
}

// ---- the state machine -----------------------------------------------------
async function advance(runId) {
  const run = await getRun(runId);
  if (run.lane === "module") return require("./modulebuild").advance(runId);   // a brand-new module from a confirmed design
  const p = (await q("SELECT * FROM platform.proposals WHERE id=$1", [run.proposal_id])).rows[0];
  const batch = await proposalsText(run);
  const isBatch = ownIds(run).length > 1;
  const { company, module: mod } = run;

  try {
    if (run.step === "confirm_requirement") {
      // Agent restates the requirement in plain language; manager must confirm
      // before any code is written.
      // Three layers so the manager actually reads it: one BLUF sentence, one
      // sentence per change (each gets a check box on the board), and the full
      // text behind "see more" (editable before confirming).
      let requirement, bluf = "", items = [];
      let cost = 0;
      const n = ownIds(run).length;
      if (haveKey()) {
        const out = await runStructured({
          model: await modelForRun(run, "propose"), company,
          system: "Restate a change requirement for a factory software module in plain language. The reader is a production manager who will skim. No code talk. Never use em or en dashes.",
          prompt: `${batch}\n\nProduce three things.\n1. bluf: ONE sentence, at most 25 words, saying what will be different for the floor after this ${isBatch ? "batch" : "change"}.\n2. items: exactly ${n} entries, one per change in order (change 1 first). Each summary is ONE sentence, at most 20 words, naming the screen and what changes on it.\n3. requirement: the full statement: (1) what changes and where, (2) what stays the same, (3) how we will know it works${isBatch ? ", change by change" : ""}.`,
          schema: {
            type: "object",
            properties: {
              bluf: { type: "string" },
              items: { type: "array", items: { type: "object", properties: { change: { type: "integer" }, summary: { type: "string" } }, required: ["change", "summary"] } },
              requirement: { type: "string" },
            },
            required: ["bluf", "items", "requirement"],
          },
          toolName: "requirement",
        });
        requirement = out.data.requirement; bluf = out.data.bluf || ""; items = Array.isArray(out.data.items) ? out.data.items : []; cost = out.costUsd;
      } else {
        requirement = `[AI not configured] Requirement to confirm manually:\n${batch}`;
        bluf = "AI is not configured; read the proposals below and confirm by hand.";
      }
      // one line per change, whatever the model returned
      const ps = await loadProposals(ownIds(run));
      items = ps.map((p, i) => ({ change: i + 1, summary: String((items[i] && items[i].summary) || p.body.split(/(?<=[.!?])\s/)[0]).slice(0, 240) }));
      await addCost(runId, cost);
      const cur0 = await getRun(runId);
      if (!requirementGate()) {
        // no second stop (Brendan, 2026-10-01: "nothing really changed since the requirements were just confirmed"):
        // the manager approved the change a moment ago, so the requirement is written down for the builder and the
        // review and the build goes straight on. The board shows it on the card as what the build follows.
        await setRun(runId, { requirement, step: "build", status: "running", evidence: { ...cur0.evidence, req_bluf: bluf.slice(0, 400), req_items: items } });
        await log(runId, { step: "confirm_requirement", note: "requirement written down; the build follows it (the approval was the manager's confirmation)" });
        await record("requirement_drafted", { company, module: mod, actor: "agent", run_id: runId, proposal_id: run.proposal_id, after: requirement, detail: { bluf, items, cost_usd: cost, gate: false } });
        return advance(runId);
      }
      await setRun(runId, { requirement, status: "waiting", evidence: { ...cur0.evidence, req_bluf: bluf.slice(0, 400), req_items: items } });
      await log(runId, { step: "confirm_requirement", note: "requirement drafted, waiting on manager confirmation" });
      await record("requirement_drafted", { company, module: mod, actor: "agent", run_id: runId, proposal_id: run.proposal_id, after: requirement, detail: { bluf, items, cost_usd: cost } });
      return; // resumes via confirmRequirement()
    }

    if (run.step === "build") {
      await assertUnderCap(company, { started: true });   // startRun checked the credit; a build that started finishes
      const ev0 = run.evidence || {};
      let draft;
      if (ev0.fix_round && run.to_version) {
        // fix round: keep working in the same draft version
        draft = { version: run.to_version, dir: await registry.materialize(company, mod, run.to_version) };
        await log(runId, { step: "build", note: `fix round ${ev0.fix_round}: agent revises v${draft.version} against the reviewer's findings` });
        // After a stop by the module gate, the platform puts back the files a
        // lane rule says must not change (a new agent session cannot know what
        // they looked like), and the agent gets the gate's own wording.
        if (ev0.gate && ev0.gate.ok === false) {
          const fromFiles0 = run.from_version ? await registry.versionFiles(company, mod, run.from_version) : null;
          const restored = gate.restoreLaneFiles(draft.dir, fromFiles0, ev0.gate);
          if (restored.length) await log(runId, { step: "build", note: `the platform put back: ${restored.join(", ")}` });
          ev0.findings = gate.forAgent(ev0.gate, restored);
        }
      } else {
        // added on top of a preview: the draft is a copy of the preview's version, not of the live one
        const base = ev0.stack ? Number(ev0.stack.base) : null;
        draft = await registry.createDraftVersion(company, mod, base);
        await setRun(runId, { to_version: draft.version });
        await log(runId, { step: "build", note: base != null ? `draft version v${draft.version} created from the preview v${base} (not live yet)` : `draft version v${draft.version} created` });
      }
      const nChanges = ownIds(run).length;
      const capUsd = runCapUsd(nChanges);
      const req = (run.requirement ? `\n\nConfirmed requirement:\n${run.requirement}` : "")
        + (ev0.fix_round && ev0.findings
          ? (ev0.gate && ev0.gate.ok === false ? `\n\n${ev0.findings}`
            : ev0.findings_from === "checks" ? `\n\nThe platform ran its checks against your previous attempt in this directory and these did not pass. Fix exactly these, keep everything else as it is:\n${ev0.findings}`
            : ev0.findings_from === "campaign" ? `\n\nThe manager's test campaign ran against your previous attempt in this directory, on the company's test floor beside its other tools, and these did not pass. Fix exactly these, keep everything else as it is:\n${ev0.findings}`
            : `\n\nAn independent reviewer looked at your previous attempt in this directory and found these problems. Fix exactly these, keep everything else as it is:\n${ev0.findings}`)
          : "");
      const guidance = await guidanceFor(company, mod);
      // outside connections: what is turned on for this tool (src/connections.js); the gate below holds the build to it
      const cx = require("./connections");
      const outsideOn = await cx.allowedKinds(company, mod);
      const fromFilesO = run.from_version ? await registry.versionFiles(company, mod, run.from_version) : null;
      const outside = cx.outsideBrief(outsideOn, fromFilesO ? JSON.parse(fromFilesO["module.json"] || "{}") : null);
      const { model, substituted } = await buildModelFor(company, run.model);
      if (substituted) await log(runId, { step: "build", note: `${substituted} cannot run as the build agent; building with ${model} instead` });
      // walled off from the data (src/datawall.js): the seed rows in the migrations that existed before this build
      // are withheld from the agent's folder for the length of the build and put back byte for byte after
      const datawall = require("./datawall");
      const walled = await datawall.isWalled(company);
      const fromFilesW = walled && run.from_version ? await registry.versionFiles(company, mod, run.from_version) : null;
      const withheld = walled ? datawall.withhold(draft.dir, fromFilesW) : [];
      if (withheld.length) await log(runId, { step: "build", note: `walled off from the data: starting rows withheld from ${withheld.join(", ")} while the agent works` });
      const ctl = new AbortController();
      ACTIVE.set(runId, ctl);
      let agentOut;
      try {
        agentOut = await runAgent({
        model, company,
        capUsd,
        signal: ctl.signal,
        system: guidance.text,
        dir: draft.dir,
        prompt: buildPrompt({ mod, isBatch, batch, req, lane: run.lane, version: draft.version, walled, outside, stack: ev0.stack || null }),

        });
      } finally { ACTIVE.delete(runId); if (withheld.length) datawall.restore(draft.dir, fromFilesW, withheld); }
      const { text, costUsd, modelsSeen } = agentOut;
      await addCost(runId, costUsd);
      const cur = await getRun(runId);
      // models_seen is the proof of which model actually built this: every
      // model id the agent process reported. Anything but exactly {model}
      // means the CLI swapped models, which CLAUDE_CODE_NO_MODEL_FALLBACK
      // should make impossible; it is logged loudly rather than hidden.
      const seen = Array.isArray(modelsSeen) ? modelsSeen : [];
      const swapped = seen.length && (seen.length > 1 || seen[0] !== model);
      await setRun(runId, { evidence: { ...cur.evidence, build_summary: text, docs: guidance.names, model, models_seen: seen, effort: AGENT_EFFORT, cap_usd: capUsd, ...(walled ? { walled: true } : {}) } });
      await log(runId, { step: "build", note: swapped
        ? `agent build complete, but the agent reported running on ${seen.join(", ")} instead of ${model}`
        : `agent build complete (${model}, effort ${AGENT_EFFORT}${seen.length ? ", confirmed by the agent" : ""})` });
      // The module gate (src/modulegate.js): no tokens, and BEFORE staging,
      // because staging loads the draft's routes.js into this process. A UI
      // build that touched anything but the screens, server code that reaches
      // past its own tables, an edited migration: all stop here, filed as a
      // failed check by "platform checks" so fix, retry and cancel apply
      // (override does not). The draft's text is kept for the fix round.
      {
        const fromFiles = run.from_version ? await registry.versionFiles(company, mod, run.from_version) : null;
        const verdict = gate.checkDir(draft.dir, { fromFiles, lane: run.lane, outside: { allowed: outsideOn } });
        const c2 = await getRun(runId);
        await record("build_finished", { company, module: mod, actor: "agent", run_id: runId, proposal_id: run.proposal_id, version: draft.version, after: text, detail: { model, models_seen: seen, effort: AGENT_EFFORT, cost_usd: costUsd || 0, fix_round: ev0.fix_round || 0, gate_ok: verdict.ok } });
        if (!verdict.ok) {
          await registry.persistVersion(company, mod, draft.version);
          await setRun(runId, { step: "cross_check", evidence: { ...c2.evidence, gate: gate.record(verdict), cross_check: { verdict: "fail", model: "platform checks", summary: gate.summarize(verdict), findings: gate.asFindings(verdict) } } });
          await logEvent("gate_refused", runId, { company, module: mod, version: draft.version, lane: run.lane, rules: verdict.violations.map((f) => f.rule) });
          await record("check_verdict", { company, module: mod, actor: "platform", run_id: runId, version: draft.version, after: gate.summarize(verdict), detail: { by: "platform checks", verdict: "fail", rules: verdict.violations.map((f) => f.rule) } });
          throw new Error(`platform checks failed: ${gate.oneLine(verdict)}`);
        }
        await setRun(runId, { evidence: { ...c2.evidence, gate: gate.record(verdict) } });
        await log(runId, { step: "build", note: `platform checks passed: module code and lane rules${verdict.inherited.length ? ` (${verdict.inherited.length} older finding(s) already on the floor, not from this change)` : ""}` });
        // a change that reads a new ERP field: say in the run log whether the company's lookups can give it
        try { const cx = require("./connections"); const line = cx.auditLine(await cx.fieldAudit(company, mod, registry.readManifest(company, mod, draft.version))); if (line) await log(runId, { step: "build", note: line }); } catch (e) { /* the audit never stops a build */ }
      }
      // Plain-language title and summary for the version list, the Done card
      // and the feedback outcome. Cheap model; the agent's own final text is
      // often chatty despite the instruction.
      try {
        const plain = await plainSummary(batch, text, isBatch, company);
        await addCost(runId, plain.costUsd);
        const c3 = await getRun(runId);
        await setRun(runId, { evidence: { ...c3.evidence, title: plain.title, what_changed: plain.what_changed } });
        // a version built on top of a preview carries the changes below it too: the Versions panel names them all
        const notes = ev0.stack ? [...(ev0.stack.carried || []).map((c) => c.title), plain.title].filter(Boolean).join("; ").slice(0, 200) : plain.title;
        await q("UPDATE platform.module_versions SET notes=$4 WHERE company=$1 AND module=$2 AND version=$3", [company, mod, c3.to_version, notes]);
        await record("build_summarized", { company, module: mod, actor: "platform", run_id: runId, version: c3.to_version, after: plain.what_changed, detail: { title: plain.title, model: plain.model, cost_usd: plain.costUsd || 0 } });
      } catch (e) { await log(runId, { step: "build", note: `summary skipped: ${e.message}` }); }
      await registry.stageVersion(company, mod, (await getRun(runId)).to_version);
      await log(runId, { step: "stage", note: "staged version mounted for preview" });
      await setRun(runId, { step: run.lane === "ui" ? "visual_check" : "cross_check" });
      return advance(runId);
    }

    if (run.step === "visual_check") {
      const ok = await runChecks(company, mod, run);
      const cur = await getRun(runId);
      await setRun(runId, { evidence: { ...cur.evidence, visual_check: { ok: ok.ok, checked: ok.checked || [], detail: ok.detail || undefined }, checks: ok } });
      if (!ok.ok) { await record("check_verdict", { company, module: mod, actor: "platform", run_id: runId, version: cur.to_version, after: ok.detail, detail: { by: "platform tests", verdict: "fail", kind: ok.kind } }); throw new Error(`visual check failed: ${ok.detail}`); }
      await log(runId, { step: "visual_check", note: `${checksLine(ok)}; ready for manager review` });
      return toGate(runId);
    }

    if (run.step === "cross_check") {
      let evidenceUpdate = {};
      if (haveKey()) {
        const cur = await getRun(runId);
        const model = await modelForRun(run, "review");
        const { data, costUsd } = await runStructuredCrossCheck(run, p, cur, model);
        await addCost(runId, costUsd);
        evidenceUpdate = { cross_check: { ...data, model } };
        await record("check_verdict", { company, module: mod, actor: "agent", run_id: runId, version: cur.to_version, after: data.summary, detail: { by: model, verdict: data.verdict, model_verdict: data.model_verdict, findings: data.findings, cost_usd: costUsd || 0 } });
        if (data.verdict === "fail") {
          const c2 = await getRun(runId);
          await setRun(runId, { evidence: { ...c2.evidence, cross_check: { ...data, model } } });
          throw new Error(`cross-check failed: ${data.summary}`);
        }
      } else {
        evidenceUpdate = { cross_check: { verdict: "skipped", summary: "AI not configured" } };
      }
      const cur = await getRun(runId);
      await setRun(runId, { step: "test_run", evidence: { ...cur.evidence, ...evidenceUpdate } });
      await log(runId, { step: "cross_check", note: "independent review passed" });
      return advance(runId);
    }

    if (run.step === "test_run") {
      const ok = await runChecks(company, mod, run);
      const cur = await getRun(runId);
      await setRun(runId, { evidence: { ...cur.evidence, test_run: { ok: ok.ok, checked: ok.checked || [], detail: ok.detail || undefined }, checks: ok } });
      if (!ok.ok) { await record("check_verdict", { company, module: mod, actor: "platform", run_id: runId, version: cur.to_version, after: ok.detail, detail: { by: "platform tests", verdict: "fail", kind: ok.kind, checked: ok.checked } }); throw new Error(`internal tests failed: ${ok.detail}`); }
      await recordAdded(cur, ok);
      if (!ok.acceptance.added.length) await log(runId, { step: "test_run", note: "this change left no check behind; nothing will hold a later build to it" });
      await log(runId, { step: "test_run", note: checksLine(ok) });
      return toGate(runId);
    }
  } catch (e) {
    return failRun(runId, e);
  }
}

// After the platform's checks: the test campaign when the company's test floor is on (src/campaign.js, a step of
// its own before the gate), else straight to the deploy gate.
async function toGate(runId) {
  if (await require("./campaign").begin(runId)) return;
  await setRun(runId, { step: "await_deploy", status: "waiting" });
}

// The build agent's brief for a change (or a batch). A function of its own so the head-to-head assessment
// (src/assess.js) hands both models exactly the prompt a real build gets.
function buildPrompt({ mod, isBatch, batch, req, lane, version, walled = false, outside = "", stack = null }) {
  const onTop = stack ? `\n\nThis directory is NOT the live version. It is a copy of the preview v${stack.base}, which the manager is looking at and has not put live yet. It already carries ${(stack.carried || []).length === 1 ? "this change" : "these changes"}, which go live together with yours:\n${(stack.carried || []).map((c) => `- ${c.what_changed || c.title || `run #${c.run}`}`).join("\n")}\nBuild your change on top of them and keep every one of them working. Its migrations and checks are part of this version: never edit one, add the next number.` : "";
  return `You are implementing ${isBatch ? "a batch of approved changes" : "an approved change"} to the "${mod}" module of a factory operating system. Work only inside this directory; it is a full copy of the ${stack ? "preview" : "live"} module version and will become the next version.${walled ? `\n${require("./datawall").PROMPT_NOTE} Starting rows in the migrations are withheld here and are put back by the platform after you finish.` : ""}${onTop}

${batch}
${req}
${outside ? `\n${outside}\n` : ""}
Rules:
- Each change names a Target file, which is the screen the feedback came from. Make the change in that file. Touch another file only if the change cannot work otherwise, and say so in your summary.
- ${lane === "ui" ? "This is a UI-class change. Do NOT modify routes.js, the module.json smoke list or entry, or migrations. Touch pages/ and presentation only. The platform compares the files after you finish and stops a UI-class build that changed anything else; if the change cannot work without server logic, leave the server files alone and say so in your summary." : "This is a functionality-class change. If the data model must change, add a NEW migrations/NNN.sql file (additive only: CREATE TABLE / ALTER TABLE ADD COLUMN / CREATE INDEX / INSERT INTO table (columns) VALUES (...) seed rows; every statement ends in a semicolon; bare table names, no schema prefixes, no SELECT). Never edit an existing migration file."}
${lane === "ui" ? "" : `- Leave a check behind: add ONE new file checks/NNN-short-name.json (the next number) that proves ${isBatch ? "these changes work" : "this change works"}, built from "how we will know it works" in the confirmed requirement. GUARDRAILS.md ("Checks") has the format. Read the files already in checks/ first: each is a promise an earlier change made, the platform runs all of them against your build, and you never edit or remove one. If one of them would fail because of your change, change your work, not the check. Two things stop most builds at this step, so get them right: the title is one plain sentence of at most 200 characters, and "visible" on a page step may only name text the screen shows on its own as it first opens (never text behind a tap or a value from the rows of the day; prove those with call steps instead).\n`}${isBatch ? "- Implement every change in the batch. Keep them independent where you can so one can be understood without the others.\n" : ""}- Keep the module's existing style and structure. Plain HTML/JS, no frameworks.
- Make the smallest change that removes the reported friction.
- Mark what you touched so the preview can highlight it: put data-changed="v${version}" on every HTML element you add or visibly change (the element itself, not its parent). One attribute per element, nothing else; it costs nothing at runtime and the preview outlines those elements.
- Your final message must be ONLY a short bullet list of what changed (one bullet per change, naming the screen), in plain language for a production manager. No preamble, no headings, no code talk.`;
}

// diffOverride: a caller that has no earlier version to diff against (a brand-new
// module) hands in its own listing in unified-diff shape.
async function runStructuredCrossCheck(run, proposal, cur, model, diffOverride) {
  const dir = registry.versionDir(run.company, run.module, cur.to_version);
  const fromDir = registry.versionDir(run.company, run.module, run.from_version);
  const { execFileSync } = require("child_process");
  let diff = diffOverride || "";
  if (!diff) {
    try {
      // -N: a file the agent ADDED (a new migration, a new page) shows with its
      // whole body instead of "Only in ...: 002.sql", which left the reviewer
      // unable to see new migrations and failing them as unverifiable (run #28)
      diff = execFileSync("diff", ["-ruN", fromDir, dir], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
    } catch (e) { diff = e.stdout || ""; } // diff exits 1 when files differ
  }
  if (!diff.trim()) {
    // nothing to review: the agent changed no file. Usually a request the
    // module cannot carry out (run #32 asked it to change a platform password)
    return { data: { verdict: "fail", summary: "The agent changed nothing: no file differs from the version on the floor. Usually that means the request is not something this module can do (a platform setting, an account, another system). Adjust the proposal or decline it.", findings: [{ severity: "blocking", where: "the whole change", what: "no file was changed", evidence: "(empty diff)" }], issues: ["no file was changed"], model_verdict: "fail" }, costUsd: 0 };
  }
  const ps = await loadProposals(run.proposal_ids || [run.proposal_id]).catch(() => []);
  const targets = ps.map((x) => x.target_file).filter(Boolean);
  return crossCheckCall({ model, lane: run.lane, targets, requirement: cur.requirement || proposal.body, diff, fromVersion: run.from_version, toVersion: cur.to_version, company: run.company });
}

// The cross-check as one pure call, so scripts/replay-crosscheck.js can run
// the same brief against exported cases without a database.
function crossCheckPrompt({ lane, targets, requirement, diff, fromVersion, toVersion }) {
  const truncated = diff.length > CROSS_CHECK_DIFF_CHARS;
  const changed = [...diff.matchAll(/^diff -ru \S+ \S+\/versions\/\d+\/(\S+)$/gm)].map((m) => m[1]);
  return `Lane: ${lane === "ui" ? "look-and-feel change (pages only)" : lane === "module" ? "a brand-new module built from a confirmed design" : "functionality change"}.${targets && targets.length ? ` Screen file(s) named by the proposals: ${targets.join(", ")}.` : ""}\nFiles touched: ${changed.length ? changed.join(", ") : "(see diff)"}.\n\nConfirmed requirement:\n${requirement}\n\nUnified diff of the change (v${fromVersion || 0} -> v${toVersion})${truncated ? `, cut at ${CROSS_CHECK_DIFF_CHARS} characters; judge only what you can see and never fail for what was cut` : ""}:\n${diff.slice(0, CROSS_CHECK_DIFF_CHARS) || "(no textual diff found)"}`;
}
async function crossCheckCall({ model, lane, targets, requirement, diff, fromVersion, toVersion, company }) {
  const out = await runStructured({
    model, company,
    system: crossCheckSystem(lane),
    prompt: crossCheckPrompt({ lane, targets, requirement, diff, fromVersion, toVersion }),
    schema: CROSS_CHECK_SCHEMA,
    toolName: "verdict",
    maxTokens: 6000,
  });
  // the rule, not the model's mood, decides: fail only on a blocking finding.
  // Findings the brief already calls minor are downgraded here as well, because
  // a reviewer keeps marking them blocking anyway (run #31: a missing
  // data-changed mark and an "if the underlying bug is..." guess).
  const findings = (Array.isArray(out.data.findings) ? out.data.findings : []).map((f) => f && demote(f)).filter(Boolean);
  const blocking = findings.filter((f) => f && f.severity === "blocking");
  const verdict = blocking.length ? "fail" : "pass";
  let summary = String(out.data.summary || "").trim();
  if (blocking.length) summary += "\n\nBlocking:\n" + blocking.map((f) => `- ${f.where}: ${f.what}`).join("\n");
  const minor = findings.filter((f) => f && f.severity === "minor");
  if (minor.length) summary += `\n\nNoted, not blocking:\n` + minor.map((f) => `- ${f.where}: ${f.what}`).join("\n");
  return { data: { verdict, summary, findings, issues: blocking.map((f) => f.what), model_verdict: out.data.verdict }, costUsd: out.costUsd };
}

const CROSS_CHECK_DIFF_CHARS = Number(process.env.SOS_CROSS_CHECK_DIFF_CHARS || 90000);

// Never blocking, whatever the reviewer says: housekeeping the platform asks
// the builder for, and anything the reviewer only suspects. Kept as minor with
// the reason recorded, so the checks log shows what was demoted.
const NEVER_BLOCKING = [
  [/data-changed|tour\.json|reference\.md|principles? rule|rule 8|rule 9|plain[- ]words/i, "housekeeping is never blocking"],
  [/\b(if the underlying|if the real|might|may (?:be|still|not)|presumably|cannot (?:confirm|verify|tell|see)|can't (?:confirm|verify|tell|see)|unverifiable|not (?:shown|visible|included) in the diff|would need to (?:run|test)|worth confirming|assum(?:e|ption))\b/i, "a guess or something unverifiable from the diff is never blocking"],
  [/\b(cosmetic|wording|formatting|whitespace|style only|dead (?:code|logic)|misspell)/i, "cosmetic notes are never blocking"],
];
function demote(f) {
  if (f.severity !== "blocking") return f;
  const text = `${f.where || ""} ${f.what || ""}`;
  for (const [re, why] of NEVER_BLOCKING) if (re.test(text)) return { ...f, severity: "minor", demoted: why, was: "blocking" };
  return f;
}

// The reviewer's brief. Calibrated 2026-09-17 after almost every functionality
// change was being failed: the old brief said "fail anything beyond the
// requirement" and never told the reviewer what a functionality change
// legitimately has to touch, so routes.js edits, new migrations and tour.json
// housekeeping were read as violations. Now the standard is explicit and the
// verdict follows the findings' severity.
function crossCheckSystem(lane) {
  const { platformDocs } = require("./agent");
  // GUARDRAILS only. PRINCIPLES.md is the builder's craft (tours, data-changed
  // marks, plain words); handed to the reviewer it became a list of things to
  // fail builds for (run #31 failed on "rule 9").
  const rules = platformDocs().filter((d) => d.name === "GUARDRAILS.md").map((d) => `<!-- ${d.name} -->\n${d.content}`).join("\n\n");
  return `You are an independent reviewer of a change to a factory software module. You did not write it and you cannot run it; you judge from the diff. Your reader is a production manager, so write findings in plain words.

Mark a finding BLOCKING only when one of these is true:
1. The requirement is not met: something it asks for is missing, wrong, or on the wrong screen when it names a screen.
2. The change alters what people see or what happens on the floor beyond what the requirement asks, in a way a manager would notice. Say what they would notice.
3. A migration file that already existed was edited, or a migration uses DROP, DELETE, UPDATE, TRUNCATE, GRANT, or any schema, role, function or trigger statement.
4. Something that worked would plainly break: a route removed or renamed that a page still calls, a field renamed on one side only, invalid syntax, a page reading a column no migration creates.
5. A hard rule in the guardrails below is broken (writing outside the module, importing outside the directory, new dependencies, a hard-coded /m/<name> path).

Everything else is at most MINOR. In particular these are NOT violations and never block:
- Supporting edits the change needs to work: server logic in routes.js for a functionality change, helper functions, styles, a NEW additive migration file, additions to the module.json smoke list or pages map.
- Housekeeping the platform requires: tour.json steps kept true, reference.md updated, data-changed="vN" attributes on touched elements.
- A NEW file under checks/ (the check this change leaves behind). The platform runs every check itself after you, so whether one passes is not yours to judge and a missing one never blocks. It is BLOCKING only if a check file that already existed was edited or removed, and worth a MINOR note if the new check plainly does not test what the requirement asks.
- Small tidy-ups inside lines the change had to touch anyway, and wording changes that keep the meaning.
- The requirement's "what stays the same" describes what the floor sees, not which files may be touched. Touching a file is fine if that behavior is unchanged.
- Anything you cannot verify from the diff. Do not fail for what you cannot see or cannot run.
${lane === "module" ? "\nThis is a brand-new module built from a confirmed design summary. The requirement is that design. Check that every screen, rule, number and connection the design names is there in some form, that visible text is in plain words (no API, database, schema, JSON, deploy, server, sync, token, prompt, backend, frontend), that every outside connection goes through the ctx services the contract allows and nothing reaches the network directly, and that a tour.json exists. A first version is meant to be small: leaving out what the design lists under \"What Rev 1 leaves out\" is correct, not a finding.\n" : ""}
A finding that contains "if", "might", "may", "presumably", "cannot confirm" or "would need to run" is a guess, and a guess is minor by definition. The builder's craft rules (tour steps, data-changed marks, plain words, reference doc) are not yours to enforce; note them as minor at most. A file that appears in full with every line marked + is a NEW file the change adds (a new migration, a new page); read it as such, it is not missing.

When in doubt between blocking and minor, choose minor. A blocking finding must quote the diff lines that show it. The verdict is pass when there is no blocking finding.

${rules}`;
}

// Ask the module's declared endpoints for an answer on the staged (or live) mount, as that company's own
// manager (never the internal token: the list is in module.json, which a build may have written). Since
// 2026-09-19 anything from 400 up is a failure (a 404 used to pass), unless the floor's version answers that
// same path the same way, which means this build did not cause it.
async function smokeCheck(company, mod, staged) {
  const row = await registry.getModule(company, mod);
  const version = staged ? row.staged_version : row.live_version;
  const manifest = registry.readManifest(company, mod, version);
  const origin = `http://127.0.0.1:${process.env.PORT || 3000}`;
  const base = `${origin}/c/${company}${staged ? "/staging" : ""}/m/${mod}`;
  const floorBase = staged && row.live_version ? `${origin}/c/${company}/m/${mod}` : null;
  // only a path the floor's version ALSO lists can be "already like that on the floor"; one this build added has to answer
  const floorLists = new Set(["/"]);
  if (floorBase) { try { for (const t of registry.readManifest(company, mod, row.live_version).smoke || []) floorLists.add(String(t)); } catch (e) { /* no floor manifest: nothing is inherited */ } }
  const targets = ["/", ...(manifest.smoke || [])];
  const checked = [];
  const headers = { Cookie: await auth.serviceCookie(company, "manager") };
  const ask = async (url) => { const res = await fetch(url, { headers, redirect: "manual", signal: AbortSignal.timeout(15000) }).catch((e) => ({ status: 0, err: e.message })); return res; };
  for (const t of targets) {
    const bad = acceptance.pathProblem(String(t));
    if (bad) return { ok: false, detail: `module.json lists "${t}" to check, but a path ${bad}`, checked };
    const res = await ask(base + t);
    checked.push({ url: t, status: res.status });
    // sent to the login page: the platform's own session was not taken, so nothing would really be checked.
    // Better a loud stop that names the platform than a quiet pass.
    if (res.status >= 300 && res.status < 400 && /\/login/.test((res.headers && res.headers.get && res.headers.get("location")) || "")) return { ok: false, detail: `the platform could not sign itself in to check this build (it was sent to the login page), so nothing was checked. That is the platform's fault, not the build's: retry, and tell Anetix if it happens again`, checked };
    if (!res.status || res.status >= 400) {
      const floor = floorBase && floorLists.has(String(t)) ? await ask(floorBase + t) : null;
      if (floor && floor.status === res.status && res.status) { checked[checked.length - 1].inherited = true; continue; }   // the floor answers the same: not this build's doing
      return { ok: false, detail: `${t} answered ${res.status || `nothing (${res.err || "no answer"})`}`, checked };
    }
  }
  return { ok: true, checked };
}

// Everything the platform checks on a staged build before the deploy gate (build order item 7):
//   1. the declared endpoints answer (smokeCheck)
//   2. every acceptance check the module has collected passes, the new one included (src/acceptance.js)
//   3. every screen opens without a script error that is not already on the floor (src/pageload.js)
// Then the staged data goes back to a fresh copy of the floor's, because checks may write rows and the
// manager's preview must not show them. Never throws for a failed check: returns { ok, detail, kind, ... }
// and the caller fails the run. kind: smoke | own_check | promise | page.
async function runChecks(company, mod, run) {
  const row = await registry.getModule(company, mod);
  const version = row.staged_version;
  const files = (await registry.versionFiles(company, mod, version)) || {};
  const fromFiles = run.from_version ? await registry.versionFiles(company, mod, run.from_version) : null;
  const liveFiles = row.live_version ? await registry.versionFiles(company, mod, row.live_version) : null;
  const manifest = JSON.parse(files["module.json"] || "{}");
  const origin = `http://127.0.0.1:${process.env.PORT || 3000}`;
  const mounts = { staged: `/c/${company}/staging/m/${mod}`, live: row.live_version ? `/c/${company}/m/${mod}` : null };
  const cookies = { manager: await auth.serviceCookie(company, "manager"), floor: await auth.serviceCookie(company, "floor") };
  const hideValues = await require("./datawall").isWalled(company);   // a failed check names paths and types, never what the answer held
  const out = { ok: true, kind: null, detail: "", version, ...(hideValues ? { walled: true } : {}) };

  out.smoke = await smokeCheck(company, mod, true);
  if (!out.smoke.ok) return { ...out, ok: false, kind: "smoke", detail: out.smoke.detail, checked: out.smoke.checked };

  // one browser for the whole look, when the instance has one; a browser that will not start never decides a build
  let browser = null, launchNote = null;
  try { browser = await pageload.session(origin); } catch (e) { launchNote = String(e.message).split("\n")[0].slice(0, 160); console.error("[pageload] browser launch failed:", e.message); }
  try {
    out.pages = await pageload.look({ origin, mounts, manifest, files, liveManifest: liveFiles ? JSON.parse(liveFiles["module.json"] || "{}") : null, liveFiles, cookie: cookies.manager, browser });
    if (launchNote && !out.pages.fell_back) out.pages.fell_back = `the browser would not start (${launchNote})`;
    out.acceptance = await acceptance.runAll({ files, fromFiles, retired: await acceptance.retiredSet(company, mod), base: origin + mounts.staged, cookies, browser, hideValues });
  } finally {
    if (browser) await browser.close();
    // checks may have written rows: the preview starts from the floor's data again, pass or fail; not when the build was
    // taken out meanwhile and another version is the preview now (a discard during the checks, or the preview below
    // put back by a peel), which would mount this version over it
    const still = await registry.getModule(company, mod).catch(() => null);
    if ((!out.acceptance || out.acceptance.wrote) && still && Number(still.staged_version) === Number(version)) await registry.resetStagedData(company, mod, version).catch((e) => console.error("[checks] could not reset the staged data:", e.message));
  }
  for (const r of out.acceptance.failed.filter((x) => !x.new)) r.origin = await acceptance.originOf(company, mod, r.file).catch(() => null);
  out.checked = [...out.smoke.checked, ...Array.from({ length: out.acceptance.total }, (_, i) => ({ check: i + 1 })), ...Array.from({ length: out.pages.screens }, (_, i) => ({ screen: i + 1 }))];
  if (!out.acceptance.ok) return { ...out, ok: false, kind: out.acceptance.failed.some((r) => !r.new) ? "promise" : "own_check", detail: acceptance.oneLine(out.acceptance) };
  if (!out.pages.ok) return { ...out, ok: false, kind: "page", detail: pageload.oneLine(out.pages) };
  return out;
}
// One line for the run log when everything passed.
function checksLine(c) {
  const a = c.acceptance || { total: 0, added: [], retired: 0 }, p = c.pages || { screens: 0, mode: "static" };
  return `${c.smoke.checked.length} endpoints answered; ${a.total} check${a.total === 1 ? "" : "s"} passed${a.added.length ? ` (${a.added.length} new with this change)` : ""}${a.retired ? `, ${a.retired} retired` : ""}; ${p.screens} screen${p.screens === 1 ? "" : "s"} opened ${p.mode === "browser" ? "in a browser" : "without a browser"} with no new script errors${p.inherited ? ` (${p.inherited} already on the floor)` : ""}${p.fell_back ? `; ${p.fell_back}, so the screens were checked without it` : ""}`;
}
// What a fix round tells the agent about failed checks (a new session: it sees only this).
function checksForAgent(c) {
  if (!c) return "";
  if (c.kind === "smoke") return `The platform asked the staged build for ${c.detail}. Every path in module.json's smoke list, and the module's first screen, has to answer.`;
  const parts = [];
  if (c.acceptance && !c.acceptance.ok) parts.push(acceptance.forAgent(c.acceptance));
  if (c.pages && !c.pages.ok) parts.push(pageload.forAgent(c.pages));
  return parts.join("\n");
}
// After a build leaves a new check behind and passes: on the record, once.
async function recordAdded(run, c) {
  for (const a of (c.acceptance && c.acceptance.added) || []) await record("check_added", { company: run.company, module: run.module, actor: "agent", run_id: run.id, version: c.version, after: a.title, detail: { file: a.file } });
}

// ---- manager actions -------------------------------------------------------
async function confirmRequirement(runId, edited) {
  const run = await getRun(runId);
  if (run.step !== "confirm_requirement" || run.status !== "waiting") throw new Error("run is not waiting on requirement confirmation");
  await require("./selfserve").assertCredit(run.company, { started: true, fairUse: true });   // a build confirmed later is a new start for a paying site's fair-use line
  if (edited) await setRun(runId, { requirement: edited });
  await setRun(runId, { step: "build", status: "running" });
  await log(runId, { step: "confirm_requirement", note: "manager confirmed requirement" });
  advance(runId).catch((e) => failRun(runId, e));
}

async function deploy(runId) {
  const run = await getRun(runId);
  if (run.status === "stacked") throw new Error(`a change is being added on top of this preview (run #${(run.evidence || {}).stacked_under}); it goes live with that one`);
  if (run.step !== "await_deploy" || run.status !== "waiting") throw new Error("run is not awaiting deploy");
  const chain = (await chainBelow(run)).filter((r) => r.status === "stacked");   // the changes this preview carries
  const result = await registry.deployVersion(run.company, run.module, run.to_version);
  await setRun(runId, { status: "deployed" });
  await require("./campaign").afterRunEnds(run, "deployed").catch((e) => console.error("[campaign] after deploy:", e.message));
  await log(runId, { step: "deploy", note: result.from ? `v${result.from} -> v${result.to} live` : `v${result.to} live: the module is on the floor` });
  // every run below goes live with it (logged as "stack", so loop health counts one deploy, not one per run)
  for (const s of chain) {
    await setRun(s.id, { status: "deployed", evidence: { ...(s.evidence || {}), went_live_in: run.id, went_live_version: result.to } });
    await log(s.id, { step: "stack", note: `went live inside run #${run.id} as v${result.to}, together with the change added on top` });
    await require("./campaign").afterRunEnds(s, "deployed").catch((e) => console.error("[campaign] after deploy:", e.message));
  }
  const ps = await loadProposals(run.proposal_ids || [run.proposal_id]);
  const ev = run.evidence || {};
  const summary = (ev.what_changed || ev.build_summary || "").slice(0, 600);
  // a change that came in with a preview below keeps the words of the build that made it
  const said = new Map();
  for (const c of ((ev.stack || {}).carried) || []) for (const pid of c.proposal_ids || []) if (c.what_changed) said.set(Number(pid), c.what_changed);
  for (const p of ps) {
    await q("UPDATE platform.feedback SET status='done', outcome=$2, batch_id=NULL, updated_at=now() WHERE id=$1",
      [p.feedback_id, `Deployed v${result.to}${ps.length > 1 ? ` (batch of ${ps.length})` : ""}: ${said.get(Number(p.id)) || summary || p.body.slice(0, 500)}`]);
  }
  // close the loop: the floor sees what went live and who asked, and the asker is asked whether it fixed it
  await require("./closeloop").markShipped(ps.map((p) => p.feedback_id), result.to).catch((e) => console.error("[closeloop] markShipped:", e.message));
  if (run.lane === "module") await require("./modulebuild").afterDeploy(await getRun(runId), result);
  // a brand-new tool whose first version was changed before it went live: its request closes now
  for (const s of chain) if (s.lane === "module") await require("./modulebuild").afterDeploy(await getRun(s.id), result);
  kickQueue(run.company, run.module).catch((e) => console.error("queue kick failed:", e));
  return result;
}

async function rollbackRun(runId) {
  let run = await getRun(runId);
  // a change that went live inside a later one is rolled back with it (the floor has one version, not two)
  if (run && run.evidence && run.evidence.went_live_in) run = (await getRun(Number(run.evidence.went_live_in))) || run;
  runId = run.id;
  const result = await registry.rollback(run.company, run.module);
  await setRun(runId, { status: "rolled_back" });
  await log(runId, { step: "rollback", note: `restored v${result.to}` });
  for (const s of (await q("SELECT * FROM platform.build_runs WHERE evidence->>'went_live_in' = $1 AND status='deployed'", [String(runId)])).rows) {
    await setRun(s.id, { status: "rolled_back" });
    await log(s.id, { step: "stack", note: `rolled back with run #${runId} to v${result.to}` });
  }
  const ps = await loadProposals(run.proposal_ids || [run.proposal_id]);
  for (const p of ps) {
    await q("UPDATE platform.feedback SET outcome=$2, updated_at=now() WHERE id=$1", [p.feedback_id, `Rolled back to v${result.to}.`]);
  }
  await require("./closeloop").markRolledBack(ps.map((p) => p.feedback_id)).catch((e) => console.error("[closeloop] markRolledBack:", e.message));
  return result;
}

// Retry a failed run from the build step (new draft, same proposals).
async function retry(runId, opts = {}) {
  const run = await getRun(runId);
  if (run.status !== "failed") throw new Error("only failed runs can be retried");
  const step = run.lane === "ui" || run.lane === "module" || run.requirement ? "build" : "confirm_requirement";
  // a manager's retry starts the build over from scratch, so it needs credit like a new build; the platform's own
  // restart of an orphaned run (opts.auto) is the same build carrying on. Fix rounds (below) are part of the build.
  if (!opts.auto) await require("./selfserve").assertCredit(run.company);
  // added on top of a preview: it starts again from that preview, as long as the preview is still set aside for it
  let st = (run.evidence || {}).stack || null;
  if (st) {
    const under = await getRun(Number(st.on));
    if (!under || under.status !== "stacked") {
      await q("UPDATE platform.build_runs SET proposal_ids=$2::int[] WHERE id=$1", [runId, ownIds(run)]);
      await setRun(runId, { evidence: { ...(run.evidence || {}), stack: undefined } });
      await log(runId, { step, note: "the preview this was added to is gone; it starts again from the live version" });
      st = null;
    }
  }
  const busy = (await activeRun(run.company, run.module)) || (st ? null : await stackedRun(run.company, run.module));
  const modRow = await registry.getModule(run.company, run.module);
  if (run.step === "campaign") await require("./campaign").afterRunEnds(run, "retried").catch((e) => console.error("[campaign] after retry:", e.message));
  await setRun(runId, { step, status: busy ? "queued" : "running", from_version: st ? Number(st.base) : modRow.live_version });
  const who = opts.auto ? "the platform started the run again" : "manager retried the run";
  await log(runId, { step, note: busy ? `${opts.auto ? "started again by the platform" : "manager retried"}; queued behind run #${busy.id}` : who });
  if (!busy) advance(runId).catch((e) => failRun(runId, e));
}

// Rounds in all: the automatic ones (AUTO_FIX_ROUNDS, above failRun) and then the manager's.
const MAX_FIX_ROUNDS = Number(process.env.SOS_MAX_FIX_ROUNDS || 3);

// A failed check (cross-check, tests, visual check) can go back to the agent
// with the findings, in the same draft version. opts.auto: the platform sent it, not a manager.
async function fix(runId, opts = {}) {
  const run = await getRun(runId);
  if (run.status !== "failed" || !run.to_version || !["cross_check", "test_run", "visual_check", "campaign"].includes(run.step)) throw new Error("only a build that failed a check can be sent back for fixes");
  const ev = run.evidence || {};
  const round = (ev.fix_round || 0) + 1;
  if (round > MAX_FIX_ROUNDS) throw new Error(`already tried ${MAX_FIX_ROUNDS} fix rounds; retry from scratch, adjust the proposals, or override`);
  const lastErr = (run.log || []).filter((l) => l.step === "error").slice(-1)[0];
  // a failed test campaign (src/campaign.js): the platform's wording plus a person's own words
  const fromCampaign = run.step === "campaign" ? require("./campaign").forAgent(await require("./campaign").forRun(runId)) : "";
  const fromChecks = ev.checks && ev.checks.ok === false && run.step !== "campaign" ? checksForAgent(ev.checks) : "";
  const findings = fromCampaign || (ev.cross_check && ev.cross_check.verdict === "fail" && ev.cross_check.summary) || fromChecks || (lastErr ? lastErr.note : "the previous attempt failed its checks");
  const busy = (await activeRun(run.company, run.module)) || (ev.stack ? null : await stackedRun(run.company, run.module));
  await setRun(runId, { step: "build", status: busy ? "queued" : "running", evidence: { ...ev, fix_round: round, findings, findings_from: fromCampaign ? "campaign" : fromChecks && !(ev.cross_check && ev.cross_check.verdict === "fail") ? "checks" : "reviewer", cross_check: undefined, test_run: undefined, visual_check: undefined, checks: undefined, campaign: undefined } });
  const who = opts.auto ? "the platform sent the findings back to the agent on its own" : "manager sent the reviewer's findings back to the agent";
  await log(runId, { step: "build", note: busy ? `fix round ${round} queued behind run #${busy.id}` : `${who} (fix round ${round} of ${MAX_FIX_ROUNDS})` });
  if (!busy) advance(runId).catch((e) => failRun(runId, e));
}

// Manager overrides a failed cross-check: the change still has to pass the
// internal tests, then waits at the deploy gate like any other build. The
// override is recorded on the run.
async function override(runId) {
  const run = await getRun(runId);
  if (run.status !== "failed" || run.step !== "cross_check" || !run.to_version) throw new Error("only a build that failed the cross-check can be overridden");
  const ev = run.evidence || {};
  // An override is a manager disagreeing with a reviewer's judgment. The
  // platform's own checks are not a judgment: the draft was never staged, and
  // its code has not been allowed into this process. Fix, retry or cancel.
  if (ev.cross_check && ev.cross_check.model === "platform checks") throw new Error("the platform's own checks cannot be overridden; send the findings back to the agent, retry, or cancel");
  await setRun(runId, { step: "test_run", status: "running", evidence: { ...ev, cross_check: { ...(ev.cross_check || {}), overridden: true } } });
  await log(runId, { step: "cross_check", note: "manager overrode the failed cross-check; findings stay on the record" });
  advance(runId).catch((e) => failRun(runId, e));
}

// The manager says an earlier promise no longer holds (src/acceptance.js): the check is retired for this
// company's module, on the record with who and why, and the same build is checked again. Only a promise THIS
// build broke can be retired here, and only while this build still has the preview.
async function retirePromise(runId, file, reason, actor) {
  const run = await getRun(runId);
  if (!run || run.status !== "failed" || !["test_run", "visual_check"].includes(run.step) || !run.to_version) throw Object.assign(new Error("only a build that was stopped by an earlier promise can retire one"), { status: 409 });
  const modRow = await registry.getModule(run.company, run.module);
  if (!modRow || modRow.staged_version !== run.to_version || (await activeRun(run.company, run.module))) throw Object.assign(new Error("another build has the preview now; retry this one from scratch instead"), { status: 409 });
  const out = await acceptance.retire({ run, file, reason, actor });
  await setRun(runId, { status: "running" });
  await log(runId, { step: run.step, note: `${(actor && actor.name) || "the manager"} retired an earlier promise ("${out.title}"); checking the build again` });
  advance(runId).catch((e) => failRun(runId, e));
  return out;
}

// Cancel a queued, failed, or gate-waiting run, or ABORT one that is running
// (the agent process is killed; whatever it wrote in the draft is dropped).
// Proposals go back to reviewing; the items leave whatever batch they were in.
async function cancel(runId) {
  const run = await getRun(runId);
  if (run.status === "stacked") throw new Error(`a change is being added on top of this preview (run #${(run.evidence || {}).stacked_under}); take that one out first`);
  if (!["queued", "failed", "waiting", "running"].includes(run.status)) throw new Error("this run has already ended");
  const wasRunning = run.status === "running";
  // the top of a preview's stack: taking it out puts the preview below back at the gate (Brendan: peel off the last one)
  const st = (run.evidence || {}).stack || null;
  const under = st ? await getRun(Number(st.on)) : null;
  const peel = Boolean(under && under.status === "stacked");
  await setRun(runId, { status: "cancelled" });
  if (wasRunning) {
    const ctl = ACTIVE.get(runId);
    if (ctl) ctl.abort();
    await log(runId, { step: run.step, note: `aborted by manager during ${run.step}${ctl ? "; agent process stopped" : ""}` });
  }
  const modRow = await registry.getModule(run.company, run.module);
  await require("./campaign").afterRunEnds(run, "cancelled").catch((e) => console.error("[campaign] after cancel:", e.message));
  if (run.to_version && modRow && modRow.staged_version === run.to_version && !peel) await registry.unstage(run.company, run.module);
  // a draft that was never staged is a dead version; drop it so the Versions panel stays honest
  if (run.to_version && modRow && modRow.live_version !== run.to_version && modRow.staged_version !== run.to_version) {
    await registry.dropDraftVersion(run.company, run.module, run.to_version).catch((e) => console.error("drop draft failed:", e.message));
  }
  // only this run's own changes go back to review; the ones it carried stay in the preview below
  const ps = await loadProposals(ownIds(run));
  await q("UPDATE platform.proposals SET status='draft' WHERE id = ANY($1::int[])", [ps.map((p) => p.id)]);
  await q("UPDATE platform.feedback SET status='reviewing', batch_id=NULL, updated_at=now() WHERE id = ANY($1::int[])", [ps.map((p) => p.feedback_id)]);
  if (!wasRunning) await log(runId, { step: run.step, note: peel ? `taken out of the preview by the manager; the preview of run #${under.id} is back as it was, and this change goes back to review` : "cancelled by manager; proposals back to review" });
  if (peel) {
    try {
      await registry.stageVersion(run.company, run.module, under.to_version);
      await log(under.id, { step: "stack", note: `the change added on top (run #${run.id}) was taken out; this preview is back at the gate as it was` });
      await setRun(under.id, { status: "waiting", evidence: { ...(under.evidence || {}), stacked_under: undefined } });
    } catch (e) {
      await setRun(under.id, { status: "failed", evidence: { ...(under.evidence || {}), stacked_under: undefined } });
      await log(under.id, { step: "error", note: `the preview could not be put back after the change on top was taken out: ${e.message}. Retry or cancel.` });
    }
  }
  if (run.lane === "module") await require("./modulebuild").afterCancel(run);
  kickQueue(run.company, run.module).catch((e) => console.error("queue kick failed:", e));
}

// Boot: a run that was "running" when the platform restarted has no process
// behind it any more. Mark it failed so the board offers retry or cancel
// instead of a spinner that never ends, then let the queue move.
// A redeploy mid build used to cost a manual retry every time (runs #63 and #73,
// 2026-09-25). Now a run cut off in an automated step starts again from scratch,
// once (evidence.restarted), so a platform that keeps restarting cannot keep
// spending. SOS_RESTART_ORPHANS=0 goes back to marking them failed.
const RESTART_ORPHANS = process.env.SOS_RESTART_ORPHANS !== "0";
async function sweepOrphans() {
  // take them over first (see FENCE above): from here the older process, if it is still up, cannot write to them. At
  // boot that is every running run; run again a few minutes later (server.js), it is only what an older process
  // started after the boot sweep and left running when it stopped (the launch audit 1.13)
  const rows = (await q("UPDATE platform.build_runs SET fence=$1 WHERE status='running' AND (fence IS NULL OR fence < $1) RETURNING id, company, module, step, evidence", [FENCE])).rows;
  const again = [];
  for (const r of rows) {
    const restarted = Number(((r.evidence || {}).restarted) || 0);
    const canRestart = RESTART_ORPHANS && !restarted && ["build", "cross_check", "test_run", "visual_check"].includes(r.step);
    await log(r.id, { step: "error", note: canRestart ? "the platform restarted while this build was running; nothing was deployed. Starting it again from scratch." : "the platform restarted while this build was running; nothing was deployed. Retry or cancel." });
    await setRun(r.id, { status: "failed", evidence: { ...(r.evidence || {}), restarted: restarted + 1 } });
    console.log(`[pipeline] run #${r.id} (${r.company}/${r.module}) was running at restart; ${canRestart ? "starting again" : "marked failed"}`);
    if (canRestart) again.push(r.id);
    else await require("./demostops").onStop(await getRun(r.id)).catch((e) => console.error(`[demostops] run ${r.id}:`, e.message));
  }
  for (const id of again) await retry(id, { auto: true }).catch((e) => console.error(`[pipeline] restart of run #${id} failed:`, e.message));
  const mods = (await q("SELECT DISTINCT company, module FROM platform.build_runs WHERE status='queued'")).rows;
  for (const m of mods) kickQueue(m.company, m.module).catch((e) => console.error("queue kick failed:", e));
  return rows.length;
}

module.exports = { requirementGate,
  startRun, confirmRequirement, deploy, rollbackRun, retry, cancel, fix, override, retirePromise, getRun, smokeCheck, runChecks, checksLine, checksForAgent, recordAdded, kickQueue, sweepOrphans, MAX_FIX_ROUNDS, AUTO_FIX_ROUNDS, autoFix, toGate,
  ownIds, chainBelow, stackedRun, joinPreview,
  // shared with modulebuild.js (a brand-new module goes through the same runs table and the same gates)
  setRun, log, addCost, failRun, activeRun, shutdown, FENCE, runStructuredCrossCheck, plainSummary, ACTIVE, advance,
  // the cross-check brief, for the replay harness
  crossCheckCall, crossCheckPrompt, crossCheckSystem, buildPrompt, proposalsText, loadProposals, modelForRun, CROSS_CHECK_SCHEMA, CROSS_CHECK_DIFF_CHARS, demote,
};
