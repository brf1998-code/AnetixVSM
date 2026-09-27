// End to end: the test campaign (docs/TEST-ENVIRONMENT.md, push 2; src/campaign.js). A step before the deploy
// gate for a company whose test floor is on: proposed, approved by the manager, run on the test floor, the
// guided steps done by a person there, the verdict, the fix round, deploy anyway, skip, and the switch going
// off under a waiting build. Same server as closeout.js (fake agent, passwords on, FRESH database).
//   node scripts/e2e/campaign.js
// Fake mode markers in the feedback: CAMPAIGNFAIL (the second case fails on the first attempt), CAMPAIGNMADE (a
// made-up set is proposed), CAMPAIGNNOWATCH (the guided step has no watch).
const { PW, runner, login, waitFor, rowsOf, person, board, proposalFor } = require("./lib");
const R = runner(), t = R.t;
const PAGE = "/c/demo/m/paperline/";

(async () => {
  const admin = await login(PW.admin, ""), mgr = await login(PW.manager, "demo"), floor = await login(PW.floor, "demo");
  const brendan = await person(mgr, "demo", "Brendan F", "manager"); await mgr.post("/api/c/demo/who/sign-in", { id: brendan.id, pin: brendan.pin });
  const maria = await person(mgr, "demo", "Maria G", "floor"); await floor.post("/api/c/demo/who/sign-in", { id: maria.id, pin: maria.pin });
  const file = async (msg) => (await floor.post("/api/feedback", { company: "demo", module: "paperline", page: PAGE, message: msg })).json.id;
  const runOf = async (id) => (await board(mgr)).runs.find((r) => r.id === id);
  const campOf = async (id) => (await mgr.get(`/api/runs/${id}/campaign`)).json;
  const start = async (fbId) => { const prop = await proposalFor(mgr, fbId); const r = (await mgr.post(`/api/proposals/${prop.id}/decide`, { decision: "approve" })).json; return (r.run || r).id; };
  // wait until the run stops moving: waiting on the manager (any step), at the gate, or failed
  const settle = async (runId) => waitFor(`run ${runId} to settle`, async () => {
    const x = await runOf(runId);
    if (x && x.step === "confirm_requirement" && x.status === "waiting") { await mgr.post(`/api/runs/${runId}/confirm`, {}); return null; }
    return x && (x.status === "failed" || x.status === "waiting") ? x : null;
  }, 90000);
  const lastErr = (x) => ((x.log || []).filter((l) => l.step === "error").slice(-1)[0] || {}).note || "";
  const kinds = async (k) => rowsOf((await mgr.get(`/api/c/demo/record?kind=${k}`)).json);

  // ---- switch off: no step, nothing on the run
  const r0 = await settle(await start(await file("make the station label bigger")));
  t("with the test floor off a build goes straight to the deploy gate, no campaign", r0.step === "await_deploy" && !(r0.evidence || {}).campaign_id && (await mgr.get(`/api/runs/${r0.id}/campaign`)).status === 404, r0.step);
  await mgr.post(`/api/runs/${r0.id}/deploy`);
  await waitFor("r0 live", async () => (await runOf(r0.id)).status === "deployed");

  // ---- on: a UI build gets a campaign proposed
  await admin.post("/api/admin/companies/demo/test-floor", { on: true });
  const r1 = await settle(await start(await file("show the order label in bold text")));
  t("with the switch on the build stops at the campaign step, waiting on the manager", r1.step === "campaign" && r1.status === "waiting" && r1.evidence.campaign_id, r1.step + " " + r1.status);
  const c1 = await campOf(r1.id);
  t("the campaign was proposed: a title, a summary, cases with kinds and areas, one guided", c1.status === "proposed" && c1.title && c1.summary && c1.proposed_cases.length === 4 && c1.counts.guided === 1 && c1.counts.across === 1, c1);
  t("the board carries it for the card", (await board(mgr)).campaigns[r1.id] && (await board(mgr)).campaigns[r1.id].status === "proposed");
  t("a floor device can read it but not approve it", (await floor.get(`/api/runs/${r1.id}/campaign`)).status === 200 && (await floor.post(`/api/runs/${r1.id}/campaign/approve`, {})).status === 403);
  t("deploy is refused while the campaign waits", (await mgr.post(`/api/runs/${r1.id}/deploy`)).status >= 400);
  t("it is on the record", (await kinds("campaign_proposed")).length === 1);
  t("the steps on the card include the campaign", /campaign/.test(JSON.stringify((await runOf(r1.id)).log)));

  // ---- approve: drop one case, add one in the manager's words, keep the floor's data
  const dropped = c1.proposed_cases.find((c) => c.area === "across").id;
  const ap = await mgr.post(`/api/runs/${r1.id}/campaign/approve`, { cases: c1.proposed_cases.map((c) => c.id).filter((id) => id !== dropped), data: "floor", added: [{ do: "On the line board, start a shift and watch the first station light up", on: "/" }] });
  t("the manager approves it with one case dropped and one added", ap.status === 200 && ["preparing", "running", "walking", "passed"].includes(ap.json.status) && ap.json.counts.total === 4 && ap.json.counts.guided === 2 && ap.json.counts.across === 0, ap.json);
  const w1 = await waitFor("the campaign to reach the guided steps", async () => { const c = await campOf(r1.id); return c.status === "walking" ? c : null; }, 60000);
  const autos = w1.cases.filter((c) => c.kind === "auto");
  t("the platform's cases ran on the test floor and passed", autos.length === 2 && autos.every((c) => c.result && c.result.ok === true), autos.map((c) => c.result));
  const st1 = (await mgr.get("/api/c/demo/test-floor")).json;
  t("the tool under test is on the test floor at the build's version, data from the floor", st1.modules.find((m) => m.name === "paperline").test_version === r1.to_version && st1.data_source === "floor" && st1.campaign_id === w1.id, st1);
  t("the test page can be opened at that version", (await mgr.get("/c/demo/test/m/paperline/api/state")).status === 200 && (await mgr.get("/api/c/demo/modules/paperline/version?lane=test")).json.test_version === r1.to_version);
  const guided = w1.cases.filter((c) => c.kind === "guided");
  const watched = guided.find((c) => c.steps[0].then), own = guided.find((c) => !c.steps[0].then);
  t("the guided step with a watch was seen by the platform on its own; the manager's own step waits for a tick", watched.result.steps[0].state === "seen" && own.result.steps[0].state === "waiting", guided.map((c) => c.result));
  const shown = (await floor.get(`/api/c/demo/who/campaign?module=paperline&page=/c/demo/test/m/paperline/`)).json;
  t("the test page for that screen is told the steps and their state", shown.steps.length === 2 && shown.steps.some((s) => s.state === "seen") && shown.steps.some((s) => s.state === "waiting") && shown.campaign.id === w1.id, shown);
  t("a run's status is waiting while a person is asked for something", (await runOf(r1.id)).status === "waiting");
  // the floor person ticks the manager's own step from the test page
  const tick = await floor.post(`/api/c/demo/who/campaign/steps/${w1.id}/${own.id}/1`, { answer: "done" });
  t("a person on the test floor ticks a step done, under their name", tick.status === 200 && tick.json.cases.find((c) => c.id === own.id).result.steps[0].state === "done" && tick.json.cases.find((c) => c.id === own.id).result.steps[0].by === "Maria G", tick.json);
  const g1 = await waitFor("the campaign to pass", async () => { const x = await runOf(r1.id); return x.step === "await_deploy" && x.status === "waiting" ? x : null; });
  t("every step closed: the campaign passed and the build is at the deploy gate", g1.evidence.campaign.status === "passed" && /passed: 4 cases, 1 step seen by the platform and 1 done by hand \(Maria G\)/.test(g1.evidence.campaign.line), g1.evidence.campaign);
  // the record is written behind the answer (record() never holds the work up), so give the last row a moment to land
  // (a run-all on 2026-09-27 read it a moment early once in four)
  t("passed, approved and the steps are on the record", await waitFor("the campaign's records", async () => (await kinds("campaign_passed")).length === 1 && (await kinds("campaign_approved")).length === 1 && (await kinds("campaign_step")).length === 2, 5000).catch(() => false));
  await mgr.post(`/api/runs/${r1.id}/deploy`);
  await waitFor("r1 live", async () => (await runOf(r1.id)).status === "deployed");
  const st2 = (await mgr.get("/api/c/demo/test-floor")).json;
  t("after the deploy the tool is no longer under test and the test floor is on the new live version", st2.modules.find((m) => m.name === "paperline").test_version == null && st2.modules.find((m) => m.name === "paperline").version === r1.to_version, st2.modules);

  // ---- a failing case, a person's "not right", the fix round, the same campaign again
  const r2 = await settle(await start(await file("make the legend text darker CAMPAIGNFAIL CAMPAIGNMADE CAMPAIGNNOWATCH")));
  const c2 = await campOf(r2.id);
  t("a made-up data set is proposed with the campaign", c2.data && c2.data.source === "made" && c2.data.tables.paperline.material_requests === 2, c2.data);
  const ap2 = await mgr.post(`/api/runs/${r2.id}/campaign/approve`, { data: "made" });
  t("approved as proposed, with the made-up data", ap2.status === 200 && ap2.json.data_choice === "made");
  const w2 = await waitFor("the second campaign to reach the guided steps", async () => { const c = await campOf(r2.id); return c.status === "walking" ? c : null; }, 60000);
  t("the failing case is marked, the others passed, and the campaign still waits for the person", w2.cases.filter((c) => c.kind === "auto" && c.result.ok === false).length === 1 && w2.cases.filter((c) => c.kind === "auto" && c.result.ok === true).length === 2, w2.cases.map((c) => c.result));
  t("the test floor holds the made-up set", (await mgr.get("/c/demo/test/m/paperline/api/stock")).json.requests.filter((r) => r.requested_by === "Made up").length === 2);
  const gc = w2.cases.find((c) => c.kind === "guided");
  const nr = await mgr.post(`/api/runs/${r2.id}/campaign/steps/${gc.id}/1`, { answer: "not_right", what: "the station count on the board did not move when I pressed start" });
  t("the manager says not right, in words", nr.status === 200);
  const f2 = await waitFor("the run to fail at the campaign", async () => { const x = await runOf(r2.id); return x.status === "failed" ? x : null; });
  t("the build fails at the campaign step with the failed cases on it", f2.step === "campaign" && f2.evidence.campaign.status === "failed" && f2.evidence.campaign.failed.length === 2 && /^test campaign failed/.test(lastErr(f2)), f2.evidence.campaign);
  t("a person's words travel with the failure", f2.evidence.campaign.failed.some((f) => f.kind === "guided" && /station count/.test(f.words) && f.by === "Brendan F"), f2.evidence.campaign.failed);
  t("the checks log names it", rowsOf((await admin.get("/api/c/demo/checks")).json.runs || (await admin.get("/api/c/demo/checks")).json).find((r) => r.id === r2.id).reason === "test campaign failed");
  t("without words, not right is refused", (await mgr.post(`/api/runs/${r2.id}/campaign/steps/${gc.id}/1`, { answer: "not_right" })).status === 409);
  const fx = await mgr.post(`/api/runs/${r2.id}/fix`);
  t("the findings go back to the agent", fx.status === 200);
  const w3 = await waitFor("the same campaign to run again after the fix", async () => { const c = await campOf(r2.id); return c.attempt === 2 && ["walking", "passed", "failed"].includes(c.status) ? c : null; }, 120000);
  t("attempt 2 runs the same cases without a second approval, and the auto cases pass now", w3.attempt === 2 && w3.status === "walking" && w3.cases.length === w2.cases.length && w3.cases.filter((c) => c.kind === "auto").every((c) => c.result.ok === true), w3.cases.map((c) => [c.id, c.result && c.result.ok]));
  t("the guided step has to be done again", w3.cases.find((c) => c.kind === "guided").result.steps[0].state !== "not_right");
  const run3 = await runOf(r2.id);
  t("the fix round's brief carried the campaign findings and the person's words", run3.evidence.findings_from === "campaign" && /station count/.test(run3.evidence.findings), run3.evidence.findings);
  await mgr.post(`/api/runs/${r2.id}/campaign/steps/${w3.cases.find((c) => c.kind === "guided").id}/1`, { answer: "done" });
  const g2 = await waitFor("attempt 2 to pass", async () => { const x = await runOf(r2.id); return x.step === "await_deploy" ? x : null; });
  t("attempt 2 passed", g2.evidence.campaign.status === "passed" && g2.evidence.campaign.attempt === 2);
  await mgr.post(`/api/runs/${r2.id}/cancel`);
  const st3 = (await mgr.get("/api/c/demo/test-floor")).json;
  t("discarded at the gate: the tool goes back to the floor's version on the test floor", st3.modules.find((m) => m.name === "paperline").test_version == null && st3.modules.find((m) => m.name === "paperline").version === r1.to_version, st3.modules);

  // ---- deploy anyway, with a reason
  const r4 = await settle(await start(await file("make the shift clock text bigger CAMPAIGNFAIL CAMPAIGNNOWATCH")));
  await mgr.post(`/api/runs/${r4.id}/campaign/approve`, {});
  const w4 = await waitFor("campaign 4 walking", async () => { const c = await campOf(r4.id); return c.status === "walking" ? c : null; }, 60000);
  t("a guided step with no watch waits for a tick", w4.cases.find((c) => c.kind === "guided").result.steps[0].state === "waiting" && w4.cases.find((c) => c.kind === "guided").steps[0].then === undefined);
  await mgr.post(`/api/runs/${r4.id}/campaign/steps/${w4.cases.find((c) => c.kind === "guided").id}/1`, { answer: "done" });
  const f4 = await waitFor("run 4 to fail on its auto case", async () => { const x = await runOf(r4.id); return x.status === "failed" ? x : null; });
  t("the auto case that fails stops the build once every step is closed", f4.step === "campaign" && f4.evidence.campaign.failed.length === 1 && f4.evidence.campaign.failed[0].kind === "auto", f4.evidence.campaign);
  t("deploy anyway needs words", (await mgr.post(`/api/runs/${r4.id}/campaign/waive`, {})).status === 400);
  const wv = await mgr.post(`/api/runs/${r4.id}/campaign/waive`, { reason: "the failing case expects a rule we removed on purpose" });
  t("deploy anyway moves the build to the gate as a waiver", wv.status === 200 && wv.json.status === "waived" && (await runOf(r4.id)).step === "await_deploy", wv.json);
  await mgr.post(`/api/runs/${r4.id}/deploy`);
  await waitFor("r4 live", async () => (await runOf(r4.id)).status === "deployed");
  const d4 = await runOf(r4.id);
  t("the shipped tile says it was deployed over a failed campaign, and the checks log too", d4.evidence.campaign.status === "waived" && /removed on purpose/.test(d4.evidence.campaign.waived.reason) && rowsOf((await admin.get("/api/c/demo/checks")).json.runs || (await admin.get("/api/c/demo/checks")).json).find((r) => r.id === r4.id).reason === "deployed over a failed test campaign");
  t("waived is on the record", (await kinds("campaign_waived")).length === 1);

  // ---- skip, with a reason
  const r5 = await settle(await start(await file("make the legend text bigger")));
  t("skip needs words", (await mgr.post(`/api/runs/${r5.id}/campaign/skip`, {})).status === 400);
  const sk = await mgr.post(`/api/runs/${r5.id}/campaign/skip`, { reason: "a wording change, nothing to try" });
  t("skipped: straight to the gate, on the record", sk.status === 200 && (await runOf(r5.id)).step === "await_deploy" && (await runOf(r5.id)).evidence.campaign.status === "skipped" && (await kinds("campaign_skipped")).length === 1);
  await mgr.post(`/api/runs/${r5.id}/cancel`);

  // ---- the switch goes off under a waiting build
  const r6 = await settle(await start(await file("make the station names bold")));
  t("a build waits at its campaign", r6.step === "campaign" && r6.status === "waiting");
  const off = await admin.post("/api/admin/companies/demo/test-floor", { on: false });
  t("switching off releases the waiting build to the gate with a note", off.status === 200 && off.json.released === 1 && (await runOf(r6.id)).step === "await_deploy" && (await runOf(r6.id)).evidence.campaign.status === "skipped" && /switched off/.test((await runOf(r6.id)).evidence.campaign.reason), off.json);
  t("its campaign row says why", (await campOf(r6.id)).status === "skipped");
  await mgr.post(`/api/runs/${r6.id}/cancel`);
  const r7 = await settle(await start(await file("make the station names darker")));
  t("with the switch off again, no campaign", r7.step === "await_deploy" && !(r7.evidence || {}).campaign_id);
  await mgr.post(`/api/runs/${r7.id}/cancel`);

  // ---- loop health counts them
  const h = (await admin.get("/api/admin/health?days=1")).json;
  const demo = (h.companies || []).find((c) => c.slug === "demo") || {};
  const cm = (demo.builds && demo.builds.campaigns) || (h.fleet && h.fleet.builds && h.fleet.builds.campaigns);
  t("loop health carries the campaigns", cm && cm.proposed >= 4 && cm.passed === 2 && cm.failed === 2 && cm.waived === 1 && cm.skipped >= 2 && cm.steps_not_right === 1, cm);

  R.done();
})().catch(R.abort);
