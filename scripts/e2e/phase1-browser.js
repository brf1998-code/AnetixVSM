// Headless browser pass for the launch audit's Phase 1 on the board (2026-09-27): a new company's board says what to do
// first (1.4); a new-tool request is a card in the columns, never under Requests to Anetix (1.5); tool, not module (1.6);
// plain steps and "Make it live" for a demo (1.8); on a phone the board opens the column that waits on the manager and the
// Feedback button sits in the band (1.9); the bare sign-in opens the account form (1.12); the board stays up while the
// platform restarts (1.14). Same server as the other e2e scripts (fake agent, passwords on), a FRESH database.
//   node scripts/e2e/phase1-browser.js
const { BASE, PW, runner, login, board, proposalFor, waitFor } = require("./lib");
const { q } = require("../../src/db");
const { chromium } = require("playwright");
const R = runner(), t = R.t;

(async () => {
  const admin = await login(PW.admin, ""), mgr = await login(PW.manager, "demo"), floor = await login(PW.floor, "demo");
  const made = await admin.post("/api/admin/companies", { slug: "newco", name: "Newco Plastics", manager_password: "newco-manager-pw-1", floor_password: "newco-floor-pw-1" });
  t("a new company with no tools", made.status === 200, made.text);
  await q("UPDATE platform.companies SET demo=true WHERE slug IN ('newco','demo')");
  const nmgr = await login("newco-manager-pw-1", "newco");

  const browser = await chromium.launch();
  const errors = [];
  const watch = (page, who) => { page.on("pageerror", (e) => errors.push(`${who}: ${e.message}`)); };

  // ---- 1.4, 1.5, 1.6: the first ten minutes on a new board --------------------------------------------------------
  const ctxN = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await ctxN.addCookies(nmgr.cookies());
  const n = await ctxN.newPage(); watch(n, "newco");
  await n.goto(BASE + "/c/newco/"); await n.waitForSelector("#firsttool-card", { timeout: 10000 }).catch(() => {});
  t("a board with no tools says what to do first", (await n.locator("#firsttool-card").count()) === 1 && /Build your first tool/.test(await n.locator("#firsttool-card").innerText()));
  const band = await n.locator("#modules").innerText();
  t("the band says tool, never module", /\+ New tool/.test(band) && !/module/i.test(band), band);
  await n.locator("#firsttool-card button", { hasText: "Build your first tool" }).click();
  await n.waitForSelector("#intake-root *", { timeout: 10000 }).catch(() => {});
  const pop = await n.locator("#intake-root").innerText();
  t("the button opens the new-tool questions", pop.length > 20 && /New tool/.test(pop) && !/New module/.test(pop), pop.slice(0, 200));
  await n.keyboard.press("Escape");
  await waitFor("the request's card", async () => (await n.locator("#col-new .card.request").count()) === 1, 12000).catch(() => {});
  t("closing it leaves a card in the Feedback column, named a tool request", (await n.locator("#col-new .card.request").count()) === 1 && /New tool request/.test(await n.locator("#col-new .card.request").innerText()));
  t("not under Requests to Anetix", (await n.locator("#col-platform .card").count()) === 0);
  await n.waitForTimeout(500);
  t("and the first-tool card has done its job", (await n.locator("#firsttool-card").count()) === 0);

  // ---- 1.8, 1.9: a demo's build waiting at the gate, on a phone ---------------------------------------------------
  const fid = (await floor.post("/api/feedback", { company: "demo", module: "paperline", page: "/c/demo/m/paperline/", message: "SIMPLE make the station name text bigger" })).json.id;
  const prop = await proposalFor(mgr, fid);
  const started = (await mgr.post(`/api/proposals/${prop.id}/decide`, { decision: "approve" })).json;
  const runId = (started.run || started).id;
  await waitFor("the gate", async () => {
    const x = (await board(mgr)).runs.find((r) => r.id === runId);
    if (x && x.step === "confirm_requirement" && x.status === "waiting") { await mgr.post(`/api/runs/${runId}/confirm`, {}); return false; }
    return x && x.step === "await_deploy" && x.status === "waiting";
  }, 90000);
  const ctxP = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); await ctxP.addCookies(mgr.cookies());
  const p = await ctxP.newPage(); watch(p, "phone");
  p.on("dialog", (d) => d.accept());
  await p.goto(BASE + "/c/demo/"); await p.waitForSelector(`[data-key="run:${runId}"]`, { state: "attached", timeout: 10000 }).catch(() => {});
  await p.waitForTimeout(300);
  t("the phone opens the column that waits on the manager", (await p.locator("#tab-in_progress.on").count()) === 1 && await p.locator(".col.c-in_progress").isVisible() && !(await p.locator(".col.c-new").isVisible()));
  const tile = p.locator(`.col.c-in_progress [data-key="run:${runId}"]`).first();
  const tileText = await tile.innerText();
  t("a demo's gate says Make it live, in plain steps", /Make it live/.test(tileText) && !/to floor/.test(tileText) && /Waiting for your OK to go live/.test(tileText) && /Building it/.test(tileText), tileText);
  t("the Feedback button sits in the band, not over the cards", (await p.locator("#fbdock #sos-fb-btn").count()) === 1 && (await p.locator("#sos-fb-btn").evaluate((el) => getComputedStyle(el).position)) === "static");
  await p.locator("#tab-done").click();
  await p.waitForTimeout(4500);
  t("a tap on a tab holds while nothing new waits", (await p.locator("#tab-done.on").count()) === 1);
  await p.locator("#tab-in_progress").click();
  await tile.locator("button.go", { hasText: "Make it live" }).click();
  await waitFor("the change live", async () => ((await board(mgr)).runs.find((r) => r.id === runId) || {}).status === "deployed", 30000);
  t("Make it live puts it live", true);

  // ---- 1.9 on a desk: the Feedback button floats as before ------------------------------------------------------------
  const ctxM = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await ctxM.addCookies(mgr.cookies());
  const d = await ctxM.newPage(); watch(d, "desk");
  await d.goto(BASE + "/c/demo/"); await d.waitForSelector("#sos-fb-btn");
  t("on a desk the Feedback button floats in the corner", (await d.locator("#fbdock #sos-fb-btn").count()) === 0 && (await d.locator("#sos-fb-btn").evaluate((el) => getComputedStyle(el).position)) === "fixed");

  // ---- 1.14: the board stays up while the platform restarts --------------------------------------------------------
  await d.waitForSelector(".card");
  await d.route("**/api/c/demo/board", (route) => route.fulfill({ status: 502, contentType: "text/html", body: "<html>Application failed to respond</html>" }));
  await d.waitForSelector("#reconnect", { state: "visible", timeout: 10000 }).catch(() => {});
  t("a 502 from the platform: one line saying so, the board still there", await d.locator("#reconnect").isVisible() && (await d.locator(".card").count()) > 0 && !/Unknown company/.test(await d.locator("body").innerText()));
  await d.unroute("**/api/c/demo/board");
  await d.waitForSelector("#reconnect", { state: "hidden", timeout: 10000 }).catch(() => {});
  t("and gone again once it answers", !(await d.locator("#reconnect").isVisible()));

  // ---- 1.12: the bare sign-in -----------------------------------------------------------------------------------------
  const ctxL = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const l = await ctxL.newPage(); watch(l, "login");
  await l.goto(BASE + "/login"); await l.waitForTimeout(300);
  const lt = await l.locator("body").innerText();
  t("the bare address opens the account form", await l.locator("#nm").isVisible() && await l.locator("#floorpw").isVisible() && /Sign in with your email and password\./.test(lt) && !/both work here/.test(lt), lt);
  await l.locator("#floorpw").click();
  t("one tap back to a floor's shared password", await l.locator("#pw").isVisible() && await l.locator("#co").isVisible() && !(await l.locator("#nm").isVisible()));
  await l.goto(BASE + "/login?next=" + encodeURIComponent("/c/demo/")); await l.waitForTimeout(300);
  t("a link from a company's board opens that company's password box", /Signing in to demo\. Enter the password you were given\./.test(await l.locator("#sub").innerText()) && !(await l.locator("#nm").isVisible()));

  t("no script errors", errors.length === 0, errors);
  await q("UPDATE platform.companies SET demo=false WHERE slug='demo'");
  await browser.close();
  R.done();
})().catch(R.abort);
