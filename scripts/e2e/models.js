// End to end: every job on Fable 5.1 or Opus 5.5, the baseline, a job of its own, company pins, the live A/B
// and the head-to-head (src/agent.js, src/assess.js, /admin#models). Runs against a server that is ALREADY UP in
// fake-agent mode on a fresh database, started with one retired variable set so its warning can be seen:
//
//   createdb sos_e2e   (user sos / sos, see CLAUDE.md "Deploying")
//   DATABASE_URL=postgres://sos:sos@127.0.0.1:5432/sos_e2e SOS_FAKE_AGENT=1 SOS_FAKE_DELAY_MS=300 PORT=3999 \
//   SOS_FLOOR_PASSWORD=floorpw SOS_MANAGER_PASSWORD=mgrpw SOS_ADMIN_PASSWORD=adminpw SESSION_SECRET=e2e \
//   SOS_MODEL_PROPOSE=claude-sonnet-5 node server.js &
//   node scripts/e2e/models.js
const { PW, runner, login, waitFor, board, fbRow, proposalFor, ship } = require("./lib");
const R = runner(), t = R.t;
const F = "claude-fable-5-1", O = "claude-opus-5-5";

(async () => {
  const admin = await login(PW.admin, "");
  const mgr = await login(PW.manager, "demo");
  const floor = await login(PW.floor, "demo");
  const PAGE = "/c/demo/m/paperline/";
  const file = async (message) => (await floor.post("/api/feedback", { company: "demo", module: "paperline", page: PAGE, message })).json;
  const models = async () => (await admin.get("/api/admin/models")).json;
  const runOf = async (id) => (await admin.get(`/api/runs/${id}`)).json;   // which model ran is Anetix's to read (src/companyview.js)

  // ---- the tier, the defaults, the retired variables
  let m = await models();
  t("two models on offer, Fable 5.1 and Opus 5.5", m.models.map((x) => x.id).join() === `${F},${O}`, m.models);
  t("Fable is the first baseline and every job runs on it", m.settings.baseline === F && Object.values(m.defaults).every((x) => x === F) && m.jobs.length === 4, m.defaults);
  t("a variable that no longer picks a model is named", m.retired_env.includes("SOS_MODEL_PROPOSE"), m.retired_env);
  t("a manager cannot read or set the instance's models", (await mgr.get("/api/admin/models")).status === 403 && (await mgr.post("/api/admin/models", { baseline: O })).status === 403);
  t("the baseline must be one of the two", (await admin.post("/api/admin/models", { baseline: "claude-sonnet-5" })).status === 400);
  t("the agent settings are Anetix's: a manager gets 403 on the page's routes (the launch audit 1.18)", (await mgr.get("/api/c/demo/agents")).status === 403 && (await mgr.post("/api/c/demo/agents/models", { build: O })).status === 403 && (await mgr.post("/api/c/demo/agents/docs", { name: "X.md", content: "x" })).status === 403);
  const sv = (await mgr.get("/api/c/demo/settings-view")).json;
  t("the manager's Settings route has the company's switches and tools and names no model", sv.company && sv.company.slug === "demo" && Array.isArray(sv.modules) && !/claude|fable|opus|sonnet|haiku|principles/i.test(JSON.stringify(sv)), sv);
  const ag = (await admin.get("/api/c/demo/agents")).json.models;
  t("the company's agent settings offer the two, pin nothing, and follow Fable", ag.list.length === 2 && Object.values(ag.pins).every((x) => x === null) && ag.propose === F && ag.defaults.build === F, ag);
  t("the checks page replays on the review model by default", (await admin.get("/api/c/demo/checks")).json.review_model === F);
  t("the checks log is Anetix's: a manager gets 403 (Phase 2)", (await mgr.get("/api/c/demo/checks")).status === 403 && (await mgr.get("/api/c/demo/checks/export")).status === 403);
  t("the short text jobs run on Sonnet 5, and the page offers Sonnet 5, Haiku 4.5 and the two", m.settings.summary === "claude-sonnet-5" && m.summary_choices.map((x) => x.id).join() === `claude-sonnet-5,claude-haiku-4-5-20251001,${F},${O}`, m.summary_choices);
  t("but not a retired model", (await admin.post("/api/admin/models", { summary: "claude-opus-5" })).status === 400);

  // ---- a company pin, and the admin unpinning it
  t("the admin may pin a company's job to one of the two", (await admin.post("/api/c/demo/agents/models", { propose: "", build: O, review: "" })).status === 200);
  t("but not to a retired model", (await admin.post("/api/c/demo/agents/models", { propose: "claude-sonnet-5" })).status === 400);
  const ag2 = (await admin.get("/api/c/demo/agents")).json.models;
  t("the pin shows as the company's own, the rest still follow", ag2.pins.build === O && ag2.pins.propose === null && ag2.build === O && ag2.propose === F, ag2);
  m = await models();
  t("the admin sees which company pins what", m.pins.length === 1 && m.pins[0].slug === "demo" && m.pins[0].pins.build === O, m.pins);
  const ov = (await admin.get("/api/admin/overview")).json;
  t("the company card says what is pinned", ov.companies.find((c) => c.slug === "demo").models.pinned.join() === "build" && ov.modelSettings.baseline === F && ov.defaults.design === F);
  t("the admin puts the company back on the platform's models", (await admin.post("/api/admin/models/unpin", { slug: "demo" })).status === 200 && (await admin.get("/api/c/demo/agents")).json.models.pins.build === null);

  // ---- the baseline moves every job; a job of its own moves one
  t("the baseline can be moved to Opus 5.5", (await admin.post("/api/admin/models", { baseline: O })).json.defaults.propose === O);
  const f1 = await file("make the station name text bigger");
  const p1 = await proposalFor(admin, f1.id);
  t("a new request is proposed on the new baseline", p1.model === O, p1);
  await admin.post("/api/admin/models", { jobs: { propose: F } });
  m = await models();
  t("a job of its own: propose on Fable, the rest on the baseline", m.defaults.propose === F && m.defaults.build === O && m.settings.jobs.propose === F, m.defaults);
  const f2 = await file("show the order label in bold text");
  t("and the next proposal follows it", (await proposalFor(admin, f2.id)).model === F);
  await admin.post("/api/admin/models", { baseline: F, jobs: { propose: null } });
  m = await models();
  t("back to Fable everywhere, nothing of its own", m.settings.baseline === F && !Object.keys(m.settings.jobs).length && Object.values(m.defaults).every((x) => x === F), m.settings);
  const rv = (await mgr.post("/api/c/demo/reviews", { module: "paperline" })).json;
  t("a system review runs on the design job's model, and the manager's answer does not say which", ((await admin.get("/api/c/demo/reviews")).json.find((x) => x.id === rv.id) || {}).model === F && rv.id && rv.model === undefined, rv);
  await waitFor("the system review", async () => ((await mgr.get("/api/c/demo/reviews")).json.find((x) => x.id === rv.id) || {}).status !== "running");

  // ---- the live A/B
  t("the A/B needs at least one job", (await admin.post("/api/admin/models/ab", { on: true, jobs: [] })).status === 400);
  const on = (await admin.post("/api/admin/models/ab", { on: true, jobs: ["propose", "build", "design"] })).json;
  t("the A/B starts with its jobs and a start time", on.settings.ab.on && on.settings.ab.jobs.join() === "propose,build,design" && on.settings.ab.since);
  const ids = [];
  for (const w of ["make the legend text darker", "show the shift clock bigger", "make the station colors brighter", "display the takt time larger"]) ids.push((await file(w)).id);
  const props = []; for (const id of ids) props.push(await proposalFor(admin, id));
  const onF = props.filter((p) => p.model === F).length, onO = props.filter((p) => p.model === O).length;
  t("four new requests split two and two between the models", onF === 2 && onO === 2, props.map((p) => p.model));
  const s1 = await ship(mgr, [ids[0]]);
  const summarized = async (runId) => ((await admin.get(`/api/c/demo/record?kind=build_summarized&run_id=${runId}`)).json.rows || [])[0];
  t("a build's plain summary is written on the short text model, and the record says which", ((await summarized(s1.runId)) || {}).detail?.model === "claude-sonnet-5", await summarized(s1.runId));
  await admin.post("/api/admin/models", { summary: O });
  const s2 = await ship(mgr, [ids[1]]);
  t("move the short text jobs to Opus 5.5 and the next summary is on it", ((await summarized(s2.runId)) || {}).detail?.model === O, await summarized(s2.runId));
  await admin.post("/api/admin/models", { summary: "claude-sonnet-5" });
  const r1 = await runOf(s1.runId), r2 = await runOf(s2.runId);
  t("two builds, one on each arm, and the arm is kept on the run", r1.model !== r2.model && r1.evidence.ab.arm === r1.model && r2.evidence.ab.arm === r2.model, [r1.model, r2.model]);
  // a functionality change: its requirement and its review run on the build's arm
  const fx = (await file("count scrap per shift and keep it")).id;
  const px = await proposalFor(admin, fx);
  const dx = (await mgr.post(`/api/proposals/${px.id}/decide`, { decision: "approve" })).json;
  const rxId = (dx.run || dx).id;
  await waitFor("the requirement", async () => { const x = await runOf(rxId); return x.step === "confirm_requirement" && x.status === "waiting"; });
  await mgr.post(`/api/runs/${rxId}/confirm`, {});
  const rx = await waitFor("the functionality build at the gate", async () => { const x = await runOf(rxId); return x.status === "waiting" && x.step === "await_deploy" ? x : (x.status === "failed" ? x : null); });
  t("the review of an A/B build ran on the build's own arm", rx.evidence.ab && rx.evidence.cross_check && rx.evidence.cross_check.model === rx.model && rx.evidence.cross_check.verdict === "pass", { model: rx.model, cc: rx.evidence.cross_check });
  await mgr.post(`/api/runs/${rxId}/deploy`);
  await waitFor("the functionality change live", async () => (await runOf(rxId)).status === "deployed");
  // a pinned job stays out of the A/B
  await admin.post("/api/c/demo/agents/models", { build: F });
  const pinnedRun = await ship(mgr, [ids[2]]);
  const rp = await runOf(pinnedRun.runId);
  t("a company that pins the build model keeps it, off the A/B", rp.model === F && !(rp.evidence && rp.evidence.ab), rp.evidence);
  await admin.post("/api/admin/models/unpin", { slug: "demo" });
  // a new module on the A/B
  const it = (await mgr.post("/api/c/demo/intakes", {})).json;
  it.model = (await admin.get(`/api/intakes/${it.id}`)).json.model;
  t("a new module's intake is given an arm", [F, O].includes(it.model), it.model);
  m = await models();
  const split = m.ab.split;
  const started = split[F].builds.started + split[O].builds.started;
  t("the split counts every A/B build on its arm, and leaves the pinned one out", started === 3 && split[r1.model].builds.shipped >= 1 && split[r2.model].builds.shipped >= 1, { f: split[F].builds, o: split[O].builds });
  t("the split counts proposals drafted on each arm", split[F].proposals.drafted + split[O].proposals.drafted === 5, { f: split[F].proposals, o: split[O].proposals });
  t("and the new module on its arm", split[it.model].intakes.started === 1, split[it.model].intakes);
  const off = (await admin.post("/api/admin/models/ab", { on: false })).json;
  t("the A/B stops and keeps when it ran", off.settings.ab.on === false && off.settings.ab.since === on.settings.ab.since && off.settings.ab.ended);
  const after = await proposalFor(admin, (await file("make the header text larger")).id);
  t("after the A/B, new work is back on the baseline", after.model === F, after.model);
  t("the numbers of the test that ran stay on the page", (await models()).ab.split[F].builds.started + (await models()).ab.split[O].builds.started === 3);

  // ---- material for the head-to-head: a labeled run and a module design
  t("label the functionality run Right", (await admin.post(`/api/runs/${rxId}/label`, { label: "right", note: "the check was right" })).status === 200);
  const answerFor = (qn) => ({ text: qn.id === "name" ? "Tool crib" : "Check text for the intake", choice: { picks: [((qn.options || [])[0] || {}).id].filter(Boolean), other: "" }, roles: { floor: "6" }, devices: { floor: ["phone"] }, order: ["waiting", "checked out", "back on the shelf"], items: ["tools go missing"], attach: { note: "" } }[qn.kind]);
  let view = (await mgr.get(`/api/intakes/${it.id}`)).json;
  for (let guard = 0; guard < 6 && ["answering", "thinking"].includes(view.status); guard++) {
    for (const qn of view.questions.filter((x) => view.missing.includes(x.id))) await mgr.post(`/api/intakes/${it.id}/answer`, { id: qn.id, value: answerFor(qn) });
    await mgr.post(`/api/intakes/${it.id}/next`, {});
    view = await waitFor("the intake to stop thinking", async () => { const v = (await mgr.get(`/api/intakes/${it.id}`)).json; return v.status !== "thinking" ? v : null; });
  }
  t("setup: the intake reaches a design", view.status === "design", view.status);

  // ---- the head-to-head
  const opts = (await admin.get("/api/admin/assess/options")).json.kinds;
  t("what can be assessed, with a cost per case for each model", opts.crosscheck.available === 1 && opts.proposal.available >= 3 && opts.design.available === 1 && opts.build.available >= 3 && opts.build.per_case_usd[F] > opts.build.per_case_usd[O], opts);
  t("an empty plan is refused", (await admin.post("/api/admin/assess", { plan: {} })).status === 400);
  const a = (await admin.post("/api/admin/assess", { plan: { crosscheck: 1, proposal: 2, design: 1, build: 2 }, budget_usd: 5 })).json;
  t("a head-to-head starts", a.id && a.status === "running", a);
  t("one at a time", (await admin.post("/api/admin/assess", { plan: { proposal: 1 } })).status === 409);
  const done = await waitFor("the head-to-head to finish", async () => { const g = (await admin.get(`/api/admin/assess/${a.id}`)).json; return g.assessment.status !== "running" ? g : null; }, 180000);
  t("it finishes, every trial on both models", done.assessment.status === "done" && done.trials.length === 12 && done.trials.every((x) => x.status === "done"), done.trials.filter((x) => x.status !== "done"));
  t("the two take turns going first", done.trials.filter((x) => x.kind === "proposal").map((x) => x.model).join() === `${F},${O},${O},${F}`, done.trials.map((x) => x.model));
  const cc = done.trials.filter((x) => x.kind === "crosscheck");
  t("a cross-check is scored against the label", cc.length === 2 && cc.every((x) => x.score.expected === "pass" && x.score.matches === true), cc.map((x) => x.score));
  t("a proposal is scored against what was approved", done.trials.filter((x) => x.kind === "proposal").every((x) => typeof x.score.class_match === "boolean" && typeof x.score.target_match === "boolean"));
  const bt = done.trials.find((x) => x.kind === "build");
  const full = (await admin.get(`/api/admin/assess/${a.id}/trials/${bt.id}`)).json;
  t("a build is done in a scratch folder, gated, and checked by BOTH models", full.output.gate.ok === true && full.output.files.length >= 1 && Object.keys(full.output.reviews).sort().join() === [F, O].sort().join() && full.score.changed, full.output && { gate: full.output.gate, files: full.output.files, reviews: Object.keys(full.output.reviews || {}) });
  const liveBefore = (await board(mgr)).runs.length;
  t("nothing the head-to-head did reached the board", liveBefore === (await board(mgr)).runs.length && !(await board(mgr)).feedback.some((f) => /assess/i.test(f.message || "")));
  t("the scorecard has all four kinds, both models", Object.keys(done.card.kinds).sort().join() === "build,crosscheck,design,proposal" && [F, O].every((mm) => done.card.kinds.proposal.models[mm].done === 2), Object.keys(done.card.kinds));
  t("and says it is too early to call", /Too few/.test(done.card.reading.verdict) && done.card.reading.suggest === null, done.card.reading);

  // blind picks
  let pk = (await admin.get(`/api/admin/assess/${a.id}/pick`)).json;
  t("a blind case waits, with no model, cost or time on it", !pk.done && pk.left_to_pick === 5 && !/claude-|Fable|Opus|cost_usd|"ms"/.test(JSON.stringify({ l: pk.left, r: pk.right })), pk);
  t("a pick needs a real choice", (await admin.post(`/api/admin/assess/${a.id}/pick`, { kind: pk.kind, source_id: pk.source_id, pick: "maybe" })).status === 400);
  t("a cross-check is not picked blind", (await admin.post(`/api/admin/assess/${a.id}/pick`, { kind: "crosscheck", source_id: rxId, pick: "left" })).status === 400);
  let n = 0, reveals = [];
  while (!pk.done && n < 10) {
    const r = (await admin.post(`/api/admin/assess/${a.id}/pick`, { kind: pk.kind, source_id: pk.source_id, pick: n % 2 ? "same" : "left", note: `pick ${n}` })).json;
    reveals.push(r.revealed); n++;
    pk = (await admin.get(`/api/admin/assess/${a.id}/pick`)).json;
  }
  t("five cases picked (two proposals, the design, two builds), then none left", n === 5 && pk.done, { n, pk });
  t("a pick reveals which side was which", reveals.every((r) => r && [F, O].includes(r.left) && r.left !== r.right));
  const g2 = (await admin.get(`/api/admin/assess/${a.id}`)).json;
  const pr = g2.card.kinds.proposal;
  t("the picks are on the scorecard", pr.picked === 2 && pr.same === 1 && pr.models[F].wins + pr.models[O].wins === 1 && g2.card.kinds.build.picked === 2, pr);
  const again = (await admin.post(`/api/admin/assess/${a.id}/pick`, { kind: "proposal", source_id: g2.picks[0].source_id, pick: "neither" })).json;
  t("a pick can be changed", again.ok && (await admin.get(`/api/admin/assess/${a.id}`)).json.card.kinds.proposal.neither === 1);

  // stop, list, backup
  const b = (await admin.post("/api/admin/assess", { plan: { build: 3 }, budget_usd: 50 })).json;
  t("a second head-to-head starts once the first is done", b.id && b.status === "running", b);
  t("and can be stopped", (await admin.post(`/api/admin/assess/${b.id}/stop`, {})).status === 200 && (await admin.get(`/api/admin/assess/${b.id}`)).json.assessment.status === "stopped");
  t("stopping twice says so", (await admin.post(`/api/admin/assess/${b.id}/stop`, {})).status === 409);
  const list = (await models()).assessments;
  t("the page lists both, newest first", list.length === 2 && list[0].id === b.id && list[1].picks === 5, list);
  const bk = (await admin.get("/api/admin/backup")).json;
  t("the backup carries the arms, the assessments, trials and picks", ["model_arms", "assessments", "assessment_trials", "assessment_picks"].every((k) => (bk.platform[k] || []).length > 0), Object.fromEntries(["model_arms", "assessments", "assessment_trials", "assessment_picks"].map((k) => [k, (bk.platform[k] || []).length])));
  t("a manager cannot reach the head-to-head", (await mgr.get(`/api/admin/assess/${a.id}`)).status === 403 && (await mgr.post("/api/admin/assess", { plan: { proposal: 1 } })).status === 403);

  R.done();
})().catch(R.abort);
