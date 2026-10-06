// Headless browser pass for the simplified board (Brendan, 2026-09-20): no model and no cost anywhere on it, the
// top right is who is here, Settings and sign out, one big button per card with the rest under "more", and one
// "Build these N together" panel at the top of Reviewing instead of "Add to batch" on every card. Same server as
// the other e2e scripts (fake agent, passwords on); runs on a fresh database or after the others.
//   node scripts/e2e/board-browser.js
const { BASE, PW, sleep, runner, login, person, board, fbRow, proposalFor, waitFor } = require("./lib");
const { chromium } = require("playwright");
const R = runner(), t = R.t;

(async () => {
  const mgr = await login(PW.manager, "demo"), floor = await login(PW.floor, "demo"), admin = await login(PW.admin, "");
  const brendan = await person(mgr, "demo", "Brendan F", "manager");
  await mgr.post("/api/c/demo/who/sign-in", { id: brendan.id, pin: brendan.pin });
  const PAGE = "/c/demo/m/paperline/";
  const file = async (msg) => (await floor.post("/api/feedback", { company: "demo", module: "paperline", page: PAGE, message: msg })).json.id;
  const S1 = await file("SIMPLE make the station name text bigger"), S2 = await file("SIMPLE show the order label in bold text"), S3 = await file("SIMPLE make the legend text darker");
  const P1 = await proposalFor(mgr, S1), P2 = await proposalFor(mgr, S2), P3 = await proposalFor(mgr, S3);
  t("three proposals wait in Reviewing", [P1, P2, P3].every((p) => p && p.id));

  const browser = await chromium.launch();
  const errors = [];
  const watch = (page, who) => { page.on("pageerror", (e) => errors.push(`${who}: ${e.message}`)); page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|Refused to connect|violates the following Content Security Policy/.test(m.text())) errors.push(`${who} console: ${m.text()}`); }); };
  const ctxM = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await ctxM.addCookies(mgr.cookies());
  const ctxF = await browser.newContext({ viewport: { width: 1024, height: 768 } }); await ctxF.addCookies(floor.cookies());
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await ctxA.addCookies(admin.cookies());
  const noMoneyNoModel = (text) => !/\$\d/.test(text) && !/Sonnet|Opus|Haiku|claude-/i.test(text) && !/per M tokens|AI spend|build model|cost/i.test(text);

  // ---- the manager's board
  const b = await ctxM.newPage(); watch(b, "board");
  b.on("dialog", (d) => d.accept());
  await b.goto(BASE + "/c/demo/"); await b.waitForSelector("#col-reviewing .card");
  await b.locator("#col-reviewing button", { hasText: "Show the other" }).click().catch(() => {});
  const who = await b.locator("#who").innerText();
  t("top right: who is here, Settings, sign out, nothing else", /signed in as manager/.test(who) && /Brendan F/.test(who) && /Settings/.test(who) && /sign out/.test(who) && !/agent settings|checks log|connections|record|wall sign|people/.test(who), who);
  t("the Settings link goes to the company's settings page", (await b.locator('#who a[href="/c/demo/settings"]').count()) === 1);
  t("no numbers strip above the columns", (await b.locator("#kpis, .kpis, .kpi").count()) === 0);
  // the system review left the board for the settings page on 2026-09-26 (only what is used every day stays on the board)
  t("the system review is not on the board", (await b.locator("#toolbar, #rv-module").count()) === 0);
  const st = await ctxM.newPage(); watch(st, "settings");
  await st.goto(BASE + "/c/demo/settings"); await st.waitForSelector("#rv-module", { timeout: 10000 }).catch(() => {});
  t("the settings page's system review offers the module and the button, no model, no estimate", (await st.locator("#rv-module").count()) === 1 && (await st.locator("#rv-model, #rv-est").count()) === 0 && /Review the whole module/.test(await st.locator("#rv-card").innerText()));
  await st.close();
  const body0 = await b.locator("body").innerText();
  t("no cost and no model anywhere on the board", noMoneyNoModel(body0), body0.match(/.{0,40}(\$\d|Sonnet|Opus|Haiku|claude-|cost|AI spend).{0,40}/i));

  const c1 = b.locator(`[data-key="fb:${S1}"]`);
  t("a proposal card has one big Approve build and the rest under more", (await c1.locator("button").count()) - (await c1.locator("details.more button").count()) === 1 && /Approve build/.test(await c1.locator("button.go").first().innerText()) && !/\(/.test(await c1.locator("button.go").first().innerText()) && (await c1.locator("details.more").count()) === 1 && (await c1.locator("details.more button", { hasText: "Adjust" }).count()) === 1 && (await c1.locator("details.more button", { hasText: "Decline" }).count()) === 1 && (await c1.locator("button", { hasText: /batch/i }).count()) === 0);
  t("the folded buttons are not on view until more is opened", !(await c1.locator("details.more button", { hasText: "Decline" }).isVisible()));
  await c1.locator("details.more > summary").click();
  t("more opens and shows them", await c1.locator("details.more button", { hasText: "Decline" }).isVisible());
  await sleep(4600);
  t("an open more survives the board's reload", (await c1.locator("details.more[open]").count()) === 1 && (await c1.locator("details.more button", { hasText: "Adjust" }).isVisible()));
  t("the card no longer says which model proposed it", !/proposed by/.test(await c1.innerText()));

  // ---- build these N together: one panel at the top of Reviewing, no adding first
  // the count is whatever waits on this module right now (an earlier suite may have left some)
  const N = (await board(mgr)).feedback.filter((f) => f.module === "paperline" && f.status === "reviewing" && f.proposal_id && !["waiting", "unavailable"].includes((f.proposal_data || {}).status)).length;
  const panel = b.locator('#together [data-together="paperline"]');
  t(`with ${N} changes waiting, Reviewing leads with one Build these ${N} together`, N >= 3 && (await panel.count()) === 1 && new RegExp(`${N} changes waiting`).test(await panel.innerText()) && (await panel.locator("button", { hasText: `Build these ${N} together` }).count()) === 1, await b.locator("#together").innerText());
  await panel.locator("button", { hasText: `Build these ${N} together` }).click();
  const runId = await waitFor("the batch run", async () => { const r = (await board(mgr)).runs.find((x) => (x.proposal_ids || []).includes(P1.id) && (x.proposal_ids || []).includes(P3.id) && x.status !== "cancelled"); return r ? r.id : null; }, 15000);
  const tile = b.locator(`[data-key="run:${runId}"]`);
  await b.waitForSelector(`[data-key="run:${runId}"]`, { timeout: 10000 });
  t("one tile in progress for all of them, and the panel is gone", (await tile.count()) === 1 && (await b.locator("#together .together").count()) === 0);
  t("the tile's run line carries no model and no cost", noMoneyNoModel(await tile.innerText()), await tile.innerText());
  // a run holding a functionality change stops at the requirement gate first: one Confirm, the rest under more
  const atGate = await waitFor("a gate", async () => { const r = (await board(mgr)).runs.find((x) => x.id === runId); return r && r.status === "waiting" && ["confirm_requirement", "await_deploy"].includes(r.step) ? r.step : null; }, 60000);
  if (atGate === "confirm_requirement") {
    await b.waitForSelector(`[data-key="run:${runId}"] .req .item input`, { timeout: 10000 });
    t("the requirement gate: one Confirm, Adjust and Cancel under more", (await tile.locator("button#reqgo-" + runId).count()) === 1 && (await tile.locator("details.more button", { hasText: "Adjust the requirement" }).count()) === 1 && (await tile.locator("details.more button", { hasText: "Cancel" }).count()) === 1);
    for (const box of await tile.locator(".req .item input").all()) await box.check();
    await tile.locator("button#reqgo-" + runId).click();
    await waitFor("the deploy gate", async () => { const r = (await board(mgr)).runs.find((x) => x.id === runId); return r && r.step === "await_deploy" && r.status === "waiting"; }, 90000);
  }
  // the Demo Company is a trial (not a paid site), so its one button says "Make it live" like every demo (src/kind.js, 2026-09-29)
  await b.waitForFunction((id) => /Make it live/.test((document.querySelector(`[data-key="run:${id}"]`) || {}).innerText || ""), runId, { timeout: 15000 });
  const gate = await tile.innerText();
  t("at the gate: the preview, one Deploy button, Discard under more", /Open preview of v\d+/.test(gate) && (await tile.locator("button.go", { hasText: /Make it live/ }).count()) === 1 && (await tile.locator("details.more button", { hasText: "Discard" }).count()) === 1 && !(await tile.locator("details.more button", { hasText: "Discard" }).isVisible()));
  // the plain line shows; the counts and the second review's words are folded under "What was checked" (the launch audit 1.8)
  const gateAll = await tile.evaluate((el) => el.textContent);
  t("the gate says what was checked in plain words, the counts folded, and no model", /Checked before it reached you/.test(gate) && /What was checked/.test(gate) && !/checks passed:/.test(gate) && /checks passed:/.test(gateAll) && !/cross-check \(/.test(gateAll) && noMoneyNoModel(gateAll), gate);
  t("the steps are in plain words", /Waiting for your OK to go live/.test(gate) && !/Manager deploy gate|Agent build/.test(gate), gate);
  // every tool page links back to the improvement board, and so does the preview's bar (Brendan, 2026-10-05)
  const pv = await ctxM.newPage(); watch(pv, "preview");
  await pv.goto(BASE + "/c/demo/staging/m/paperline/"); await pv.waitForSelector("#sos-staged-bar");
  t("the preview's bar links back to the improvement board", (await pv.locator("#sos-staged-bar #sos-bar-board").getAttribute("href")) === "/c/demo/" && /back to the improvement board/.test(await pv.locator("#sos-staged-bar").innerText()));
  t("and the preview page carries the board link in its corner too", (await pv.locator("#sos-board-link").getAttribute("href")) === "/c/demo/");
  await Promise.all([pv.waitForURL(/\/c\/demo\/$/), pv.click("#sos-bar-board")]);
  t("it lands on the board", /Improvement Board/.test(await pv.title()));
  const lv = await ctxF.newPage(); watch(lv, "live tool");
  await lv.goto(BASE + PAGE); await lv.waitForSelector("#sos-fb-btn");
  t("a live tool page carries the link back to the board, for the floor too", (await lv.locator("#sos-board-link").getAttribute("href")) === "/c/demo/" && /Improvement board/.test(await lv.locator("#sos-board-link").innerText()));
  await pv.close(); await lv.close();
  await tile.locator("button.go", { hasText: /Make it live/ }).click();
  await waitFor("the change live", async () => { const f = await fbRow(mgr, S1); return f && f.status === "done" && f.shipped_version; }, 30000);
  await b.locator("#col-done button", { hasText: "Show the other" }).click().catch(() => {});
  await b.waitForSelector(`#col-done [data-key="run:${runId}"]`, { timeout: 15000 });
  const done = b.locator(`#col-done [data-key="run:${runId}"]`);
  t("shipped: one Done for the lot, Roll back under more", (await done.locator("[data-closeout-all]").count()) === 1 && (await done.locator("details.more button", { hasText: "Roll back" }).count()) === 1 && (await done.locator("button.no").count()) === (await done.locator("details.more button.no").count()));
  t("still no cost or model after a build", noMoneyNoModel(await b.locator("body").innerText()));

  // ---- the floor's board: no buttons, no more, no Settings
  const fb = await ctxF.newPage(); watch(fb, "floor board");
  await fb.goto(BASE + "/c/demo/"); await fb.waitForSelector("#col-done .card");
  const fwho = await fb.locator("#who").innerText();
  t("a floor device sees who is here and sign out, no Settings", /signed in as floor/.test(fwho) && /sign out/.test(fwho) && !/Settings/.test(fwho), fwho);
  t("a floor device gets no buttons and no more on the cards", (await fb.locator(".card button, .card details.more, #together .together, #toolbar button").count()) === 0);

  // ---- the admin page reaches what left the board header
  const a = await ctxA.newPage(); watch(a, "admin"); await a.goto(BASE + "/admin#companies"); await a.waitForSelector("#companies .card .links", { timeout: 10000 });   // the Companies tab: one company open at a time
  const links = await a.locator("#companies .card .links").first().innerText();
  t("the company card on the admin page links to Settings, the agent settings, the checks log, people, connections and the record", ["Settings", "Agent settings", "Checks log", "People", "Connections", "Download the record"].every((x) => links.includes(x)), links);

  t("no script errors on any page", errors.length === 0, errors);
  await browser.close();
  R.done();
})().catch(R.abort);
