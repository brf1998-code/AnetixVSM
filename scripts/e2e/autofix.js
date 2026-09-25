// End to end: the automatic fix loop (pipeline.autoFix, 2026-09-25). A build that fails a check goes back to the
// agent on its own, in the same draft, and reaches the deploy gate without a manager pressing Fix.
// Same server as checks.js (fake agent, passwords on, FRESH database) with SOS_AUTO_FIX_ROUNDS at its default (2);
// the other suites run with SOS_AUTO_FIX_ROUNDS=0 because they press Fix themselves.
//   node scripts/e2e/autofix.js
// Fake agent markers (src/agent.js): FAILCHECK fails the fake cross-check until a fix round; BREAKPAGE breaks a
// screen until a fix round; BADCHECKALWAYS leaves a check behind that does not pass, and no fix round clears it.
const { PW, runner, login, waitFor, rowsOf, person, board, proposalFor } = require("./lib");
const R = runner(), t = R.t;
const PAGE = "/c/demo/m/paperline/";

(async () => {
  const mgr = await login(PW.manager, "demo"), floor = await login(PW.floor, "demo");
  const brendan = await person(mgr, "demo", "Brendan F", "manager"); await mgr.post("/api/c/demo/who/sign-in", { id: brendan.id, pin: brendan.pin });
  const maria = await person(mgr, "demo", "Maria G", "floor"); await floor.post("/api/c/demo/who/sign-in", { id: maria.id, pin: maria.pin });
  const file = async (msg) => (await floor.post("/api/feedback", { company: "demo", module: "paperline", page: PAGE, message: msg })).json.id;
  const runOf = async (id) => (await board(mgr)).runs.find((r) => r.id === id);
  const start = async (fbId) => { const prop = await proposalFor(mgr, fbId); const r = (await mgr.post(`/api/proposals/${prop.id}/decide`, { decision: "approve" })).json; return (r.run || r).id; };
  const settle = async (runId) => waitFor(`run ${runId} to settle`, async () => {
    const x = await runOf(runId);
    if (x && x.step === "confirm_requirement" && x.status === "waiting") { await mgr.post(`/api/runs/${runId}/confirm`, {}); return null; }
    return x && (x.status === "failed" || (x.step === "await_deploy" && x.status === "waiting")) ? x : null;
  }, 120000);
  const notes = (x) => (x.log || []).map((l) => l.note || "");
  const atGate = (x) => x.step === "await_deploy" && x.status === "waiting";
  const lastErr = (x) => ((x.log || []).filter((l) => l.step === "error").slice(-1)[0] || {}).note || "";

  // ---- the reviewer fails the first attempt: nobody presses Fix, the platform does
  const r1 = await start(await file("count the sheets on the station screen FAILCHECK"));
  const g1 = await settle(r1);
  t("a reviewer stop reaches the deploy gate without a manager", atGate(g1), `${g1.step}/${g1.status}: ${lastErr(g1)}`);
  t("after exactly one automatic fix round, said so in the run log", g1.evidence.fix_round === 1 && notes(g1).some((n) => /the platform sent the findings back to the agent on its own \(fix round 1 of 3\)/.test(n)), notes(g1).join(" | "));
  t("the reviewer's stop and the pass both stay on the run", notes(g1).some((n) => /^cross-check failed/.test(n)) && notes(g1).some((n) => /independent review passed/.test(n)));
  t("the agent was told as a reviewer", g1.evidence.findings_from === "reviewer" && /FAKE-BAD/.test(g1.evidence.findings || ""), g1.evidence.findings);
  const rec1 = rowsOf((await mgr.get(`/api/c/demo/record?run_id=${r1}&kind=run_fixed`)).json);
  t("run_fixed is on the record with the platform as the actor", rec1.length === 1 && rec1[0].actor_role === "platform" && rec1[0].detail && rec1[0].detail.auto === true && rec1[0].detail.round === 1, JSON.stringify(rec1).slice(0, 300));
  t("the manager cannot send a build at the gate back for fixes", (await mgr.post(`/api/runs/${r1}/fix`)).status >= 400);
  await mgr.post(`/api/runs/${r1}/deploy`);
  await waitFor("r1 live", async () => (await runOf(r1)).status === "deployed");

  // ---- a screen that breaks on opening (a platform test, not a reviewer): same loop
  const r2 = await start(await file("make the shift clock text bigger BREAKPAGE"));
  const g2 = await settle(r2);
  t("a broken screen is fixed on its own too, and the agent was told as the platform", atGate(g2) && g2.evidence.fix_round === 1 && g2.evidence.findings_from === "checks" && g2.evidence.checks.ok === true, `${g2.step}/${g2.status} round ${g2.evidence.fix_round}: ${lastErr(g2)}`);
  await mgr.post(`/api/runs/${r2}/cancel`);

  // ---- a stop the agent cannot clear: two automatic rounds, then the manager sees it with one round left
  const r3 = await start(await file("keep a tally of scrapped sheets per shift BADCHECKALWAYS"));
  const g3 = await settle(r3);
  t("after two automatic rounds it stops for the manager", g3.status === "failed" && g3.evidence.fix_round === 2 && /^internal tests failed: the check that came with this change does not pass/.test(lastErr(g3)), `${g3.step}/${g3.status} round ${g3.evidence.fix_round}: ${lastErr(g3)}`);
  t("both rounds were the platform's", notes(g3).filter((n) => /the platform sent the findings back to the agent on its own/.test(n)).length === 2, notes(g3).join(" | "));
  const cl = (await mgr.get("/api/c/demo/checks")).json; const row3 = rowsOf(cl.runs || cl).find((r) => r.id === r3);
  t("the checks log calls it what it is, with the rounds on it", row3 && row3.reason === "its own check failed" && row3.fix_round === 2, row3 && `${row3.reason} / ${row3.fix_round}`);
  const fix3 = await mgr.post(`/api/runs/${r3}/fix`);
  t("the manager still has one manual round (3 of 3)", fix3.status === 200, fix3.text);
  const g3b = await settle(r3);
  t("and after it, none: retry from scratch, override, or cancel", g3b.evidence.fix_round === 3 && (await mgr.post(`/api/runs/${r3}/fix`)).status >= 400 && /already tried 3 fix rounds/.test((await mgr.post(`/api/runs/${r3}/fix`)).text), lastErr(g3b));
  await mgr.post(`/api/runs/${r3}/cancel`);

  R.done();
})().catch((e) => { console.error(e); process.exit(1); });
