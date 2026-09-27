// Headless browser pass for the test campaign on the board and on a test page (src/campaign.js): the proposed
// block with its cases, data choice and the manager's own case; Run; the guided steps on the card and in the test
// page's bar turning green when the platform has seen one; Done from the test page; a failed campaign's card with
// Deploy anyway; the gate line and the shipped tile's waiver line. Same server as campaign.js, on a fresh
// database or after it.
//   node scripts/e2e/campaign-browser.js
const { BASE, PW, sleep, runner, login, person, board, proposalFor, waitFor } = require("./lib");
const { chromium } = require("playwright");
const R = runner(), t = R.t;
const PAGE = "/c/demo/m/paperline/";

(async () => {
  const admin = await login(PW.admin, ""), mgr = await login(PW.manager, "demo"), floor = await login(PW.floor, "demo");
  const maria = await person(mgr, "demo", "Maria G", "floor"); await floor.post("/api/c/demo/who/sign-in", { id: maria.id, pin: maria.pin });
  await admin.post("/api/admin/companies/demo/test-floor", { on: true });
  const file = async (msg) => (await floor.post("/api/feedback", { company: "demo", module: "paperline", page: PAGE, message: msg })).json.id;
  const runOf = async (id) => (await board(mgr)).runs.find((r) => r.id === id);
  const start = async (fbId) => { const prop = await proposalFor(mgr, fbId); const r = (await mgr.post(`/api/proposals/${prop.id}/decide`, { decision: "approve" })).json; return (r.run || r).id; };
  const settle = async (runId) => waitFor(`run ${runId} to settle`, async () => { const x = await runOf(runId); if (x && x.step === "confirm_requirement" && x.status === "waiting") { await mgr.post(`/api/runs/${runId}/confirm`, {}); return null; } return x && (x.status === "failed" || x.status === "waiting") ? x : null; }, 90000);

  const browser = await chromium.launch();
  const errors = [];
  const watch = (page, who) => { page.on("pageerror", (e) => errors.push(`${who}: ${e.message}`)); page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|Refused to connect|violates the following Content Security Policy/.test(m.text())) errors.push(`${who} console: ${m.text()}`); }); };
  const ctxM = await browser.newContext({ viewport: { width: 1280, height: 1000 } }); await ctxM.addCookies(mgr.cookies());
  const ctxF = await browser.newContext({ viewport: { width: 1024, height: 768 } }); await ctxF.addCookies(floor.cookies());
  const b = await ctxM.newPage(); watch(b, "board"); b.on("dialog", (d) => d.accept("because the board suite says so"));
  // every column shows three tiles and folds the rest; open them all so a card can be found whatever else is on the board
  const open = async () => { await b.waitForSelector("#modules .modcard"); for (let i = 0; i < 4; i++) { const more = b.locator("button", { hasText: "Show the other" }); if (!(await more.count())) break; await more.first().click().catch(() => {}); await sleep(200); } };

  // ---- a proposed campaign on the card
  const r1 = await settle(await start(await file("SIMPLE show the order label in bold text CAMPAIGNNOWATCH")));
  t("the build waits at its campaign", r1.step === "campaign" && r1.status === "waiting");
  await b.goto(BASE + "/c/demo/"); await open(); await b.waitForSelector(`[data-key="run:${r1.id}"] .camp`);
  const card = b.locator(`[data-key="run:${r1.id}"]`);
  const campText = await card.locator(".camp").innerText();
  t("the card shows the campaign: title, 4 cases, one you do, the data choice and a box for your own case", /Test campaign: Fake campaign/.test(campText) && /4 cases, 1 you do yourself, 1 across tools/.test(campText) && /Data on the test floor/.test(campText) && (await card.locator("textarea[id^=camp-add-]").count()) === 1, campText);
  t("the steps list carries the campaign step, in plain words (the launch audit 1.8)", /Trying it on the test floor/.test(await card.locator(".steps").innerText()));
  await card.locator("details summary", { hasText: "See the 4 cases" }).click();
  t("the cases fold open with an area chip each and a tick box to keep or drop", (await card.locator(".camp .case").count()) === 4 && (await card.locator(".camp .case .a", { hasText: "YOU DO" }).count()) === 1 && (await card.locator(".camp .case .a", { hasText: "ACROSS TOOLS" }).count()) === 1 && (await card.locator(".camp .case input[type=checkbox]").count()) === 4);
  t("the primary button runs it; skip is under more", (await card.locator("button.go", { hasText: "Run the campaign" }).count()) === 1 && (await card.locator("details.more button", { hasText: "Skip this campaign" }).count()) === 1);
  // drop the across case, add a step of the manager's own, run
  await card.locator(".camp .case", { hasText: "ACROSS TOOLS" }).locator("input[type=checkbox]").uncheck();
  await card.locator("textarea[id^=camp-add-]").fill("On the stockroom screen, ask for one sheet of paper and see it listed");
  await card.locator("button.go", { hasText: "Run the campaign" }).click();
  const w1 = await waitFor("walking", async () => { const c = (await mgr.get(`/api/runs/${r1.id}/campaign`)).json; return c.status === "walking" ? c : null; }, 60000);
  t("the manager's own case was added and the across case dropped", w1.counts.total === 4 && w1.counts.guided === 2 && w1.counts.across === 0, w1.counts);
  await b.waitForFunction((id) => { const el = document.querySelector(`[data-key="run:${id}"] .camp`); return el && /wait/.test(el.textContent) && /YOU DO/.test(el.textContent); }, r1.id, { timeout: 30000 });
  const walkText = await card.locator(".camp").innerText();
  t("the card lists the guided steps with the way into the test floor and Done and Not right", /waiting for you/.test(walkText) && (await card.locator('.camp a[href^="/c/demo/test/m/paperline"]').count()) >= 2 && (await card.locator(".camp button", { hasText: "Done" }).count()) >= 1 && (await card.locator(".camp button", { hasText: "Not right" }).count()) >= 1, walkText);

  // ---- the test page: the step for this screen, then a person ticks it there
  const p = await ctxF.newPage(); watch(p, "test page");
  await p.goto(BASE + "/c/demo/test/m/paperline/"); await p.waitForSelector("#sos-test-bar");
  await p.waitForFunction(() => { const el = document.getElementById("sos-test-step"); return el && /Test step/.test(el.textContent); }, null, { timeout: 20000 });
  const stepText = await p.locator("#sos-test-step").innerText();
  t("the test page shows the steps for this screen, with what to do and whether it is watched", /Test step 1:/.test(stepText) && /Open the first screen|stockroom/.test(stepText) && (await p.locator("#sos-test-step button", { hasText: "Done" }).count()) >= 1, stepText);
  await p.locator("#sos-test-step button", { hasText: "Done" }).first().click();
  await p.waitForFunction(() => /Done \(Maria G\)/.test((document.getElementById("sos-test-step") || {}).textContent || ""), null, { timeout: 15000 });
  t("a tick from the test page shows at once, under the person's name", /Done \(Maria G\)/.test(await p.locator("#sos-test-step").innerText()));
  // the second guided step (the manager's own, on the stockroom screen) is on another screen: not shown here, ticked from the card
  await b.waitForFunction((id) => { const el = document.querySelector(`[data-key="run:${id}"] .camp`); return el && /done by hand \(Maria G\)/.test(el.textContent); }, r1.id, { timeout: 15000 });
  t("the card saw it too", /done by hand \(Maria G\)/.test(await card.locator(".camp").innerText()));
  const remaining = card.locator(".camp button", { hasText: "Done" });
  if (await remaining.count()) await remaining.first().click();
  const g1 = await waitFor("the gate", async () => { const x = await runOf(r1.id); return x.step === "await_deploy" ? x : null; }, 30000);
  t("everything closed: the deploy gate", g1.evidence.campaign.status === "passed");
  await b.waitForFunction((id) => { const el = document.querySelector(`[data-key="run:${id}"]`); return el && /test campaign passed/.test(el.textContent); }, r1.id, { timeout: 15000 });
  t("the gate line says the campaign passed", /test campaign passed: 4 cases/.test(await card.innerText()));
  await mgr.post(`/api/runs/${r1.id}/deploy`);
  await waitFor("r1 live", async () => (await runOf(r1.id)).status === "deployed");

  // ---- a failed campaign: the stopped card, Deploy anyway, the shipped tile's line
  const r2 = await settle(await start(await file("SIMPLE make the legend text darker CAMPAIGNFAIL CAMPAIGNNOWATCH")));
  await mgr.post(`/api/runs/${r2.id}/campaign/approve`, {});
  const w2 = await waitFor("walking 2", async () => { const c = (await mgr.get(`/api/runs/${r2.id}/campaign`)).json; return c.status === "walking" ? c : null; }, 60000);
  await b.reload(); await open(); await b.waitForSelector(`[data-key="run:${r2.id}"] .camp`);
  const card2 = b.locator(`[data-key="run:${r2.id}"]`);
  await card2.locator(".camp button", { hasText: "Not right" }).first().click();
  await b.waitForSelector(`[data-key="run:${r2.id}"] textarea[id^=nr-]`);
  await card2.locator("textarea[id^=nr-]").fill("the numbers at the top did not move");
  await card2.locator("button", { hasText: "Send: not right" }).click();
  const f2 = await waitFor("run 2 failed", async () => { const x = await runOf(r2.id); return x.status === "failed" ? x : null; }, 30000);
  t("not right from the card fails the campaign once every step is closed", f2.step === "campaign" && f2.evidence.campaign.failed.length === 2);
  await b.waitForFunction((id) => { const el = document.querySelector(`[data-key="run:${id}"] .findings`); return el && /The test campaign stopped it/.test(el.textContent); }, r2.id, { timeout: 15000 });
  const stop = await card2.innerText();
  t("the stopped card leads with the failed cases and the person's words", /The test campaign stopped it/.test(stop) && /did not move/.test(stop) && /A made-up rule/.test(stop), stop);
  t("it offers the fix round first, and Deploy anyway, Retry and Cancel under more", (await card2.locator("button.go", { hasText: "Send findings back" }).count()) === 1 && (await card2.locator("details.more button", { hasText: "Deploy anyway" }).count()) === 1 && (await card2.locator("details.more button", { hasText: "Retry from scratch" }).count()) === 1);
  t("and a way onto the test floor at that version", (await card2.locator(`a[href="/c/demo/test/m/paperline/"]`).count()) >= 1);
  await card2.locator("details.more summary").click();
  await card2.locator("details.more button", { hasText: "Deploy anyway" }).click();   // the dialog answers with a reason
  const g2 = await waitFor("run 2 at the gate", async () => { const x = await runOf(r2.id); return x.step === "await_deploy" ? x : null; }, 15000);
  t("deploy anyway, with the reason typed into the prompt, puts it at the gate", g2.evidence.campaign.status === "waived" && /board suite/.test(g2.evidence.campaign.waived.reason));
  await mgr.post(`/api/runs/${r2.id}/deploy`);
  await waitFor("r2 live", async () => (await runOf(r2.id)).status === "deployed");
  await b.reload(); await open();
  const shipped = b.locator(`#col-done .card[data-key="fb:${(await runOf(r2.id)).feedback_ids[0]}"]`);
  await shipped.waitFor({ timeout: 15000 });
  t("the shipped tile says it was deployed over a failed campaign", /deployed over a failed test campaign: because the board suite says so/.test(await shipped.innerText()));
  t("no script errors on any page", errors.length === 0, errors);

  await browser.close();
  await admin.post("/api/admin/companies/demo/test-floor", { on: false });
  R.done();
})().catch(R.abort);
