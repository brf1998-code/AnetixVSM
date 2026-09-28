// Headless browser pass for requests to Anetix and the folds that stay open (2026-09-24). Same server as the
// other e2e scripts (fake agent, passwords on); runs after requests.js on the same database, or on a fresh one.
//   node scripts/e2e/requests-browser.js
const { BASE, PW, sleep, runner, login, person, proposalFor, waitFor, board } = require("./lib");
const { chromium } = require("playwright");
const R = runner(), t = R.t;
const SHOTS = process.env.SOS_SHOTS || "";   // a folder: screenshots land there

(async () => {
  const mgr = await login(PW.manager, "demo"), floor = await login(PW.floor, "demo"), admin = await login(PW.admin, "");
  const maria = await person(mgr, "demo", "Maria Browser", "floor");
  await floor.post("/api/c/demo/who/sign-in", { id: maria.id, pin: maria.pin });
  const req = (await floor.post("/api/feedback", { company: "demo", module: "platform", page: "/c/demo/", message: "BROWSER The board is hard to read on the phone." })).json;
  await admin.post(`/api/admin/requests/${req.id}`, { stage: "looking", note: "Looking at the phone layout now." });
  // a functionality build waiting at the requirement gate, so the fold is on the board (one left by an earlier run of this script will do)
  const atGate = (b) => (b.runs || []).find((r) => r.step === "confirm_requirement" && r.status === "waiting");
  let runId = (atGate(await board(mgr)) || {}).id;
  if (!runId) {
    const fid = (await floor.post("/api/feedback", { company: "demo", module: "paperline", page: "/c/demo/m/paperline/", message: "add a count of planes made this shift to the station page" })).json.id;
    const p = await proposalFor(mgr, fid);
    const approved = (await mgr.post(`/api/proposals/${p.id}/decide`, { decision: "approve" })).json;
    runId = (approved.run || approved).id;
    await waitFor("the requirement gate", async () => (await board(mgr)).runs.some((r) => r.id === runId && r.step === "confirm_requirement" && r.status === "waiting"));
  }

  const browser = await chromium.launch();
  const errors = [];
  const watch = (page, who) => { page.on("pageerror", (e) => errors.push(`${who}: ${e.message}`)); page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|Refused to connect|Content Security Policy/.test(m.text())) errors.push(`${who} console: ${m.text()}`); }); };
  const ctxM = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await ctxM.addCookies(mgr.cookies());
  const ctxF = await browser.newContext({ viewport: { width: 1024, height: 768 } }); await ctxF.addCookies(floor.cookies());
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await ctxA.addCookies(admin.cookies());

  // ---- the board: the fold stays open across two redraws
  const b = await ctxM.newPage(); watch(b, "board");
  await b.goto(`${BASE}/c/demo/`); await b.waitForSelector(`#req-${runId}`, { timeout: 15000 });
  const sum = b.locator(`#req-${runId} details summary`, { hasText: "See the full requirement" });
  await sum.click();
  t("the full requirement opens", await b.locator(`#req-${runId} details[open] .full`).count() === 1);
  await sleep(9000);   // two 4 s redraws
  t("and is still open nine seconds later", await b.locator(`#req-${runId} details[open] .full`).count() === 1);
  if (SHOTS) await b.screenshot({ path: `${SHOTS}/board-requirement-open.png`, fullPage: false });
  await b.locator(`#req-${runId} details[open] summary`).click();
  await sleep(4500);
  t("closing it holds too", await b.locator(`#req-${runId} details[open] .full`).count() === 0);
  // the strip: the request to Anetix, its stage and note
  await b.locator("#platform-wrap > summary").click();
  const strip = await b.locator("#col-platform").innerText();
  t("the strip is called Requests to Anetix and carries the stage line", /Requests to Anetix/i.test(await b.locator("#platform-wrap > summary").innerText()) && /Anetix is looking at it/.test(strip) && /Looking at the phone layout now/.test(strip), strip.slice(0, 300));
  t("the card says TO ANETIX", /TO ANETIX/.test(strip));
  if (SHOTS) { await b.locator("#platform-wrap").scrollIntoViewIfNeeded(); await b.screenshot({ path: `${SHOTS}/board-strip.png`, fullPage: true }); }
  const iconHref = await b.getAttribute("#favicon", "href");
  t("the board's icon link names this company and its icon version", /^\/api\/c\/demo\/icon\?v=[0-9a-f]{10}$/.test(iconHref), iconHref);
  const html = await (await ctxM.request.get(`${BASE}/c/demo/`)).text();
  t("the served HTML already names the company in the icon link", html.includes('href="/api/c/demo/icon"') && !html.includes("__company__"), html.slice(0, 600));

  // ---- the floor: the widget on the board says it goes to Anetix; My requests carries the badge and the line
  const f = await ctxF.newPage(); watch(f, "floor");
  await f.goto(`${BASE}/c/demo/`); await f.waitForSelector("#sos-fb-btn");
  await f.click("#sos-fb-btn");
  t("the feedback panel on the board says it goes to Brendan at Anetix", /Brendan at Anetix/.test(await f.locator("#fbw-anetix").innerText()));
  await waitFor("the My requests line", async () => (await f.locator("#fbw-mine").innerText().catch(() => "")).includes("My requests"), 10000);
  t("the badge says Anetix answered", await f.locator("#fbw-anetix-new").count() === 1, await f.locator("#fbw-mine").innerText());
  if (SHOTS) await f.screenshot({ path: `${SHOTS}/floor-badge.png` });
  await f.click("#fbw-mine-open");
  const row = f.locator(`[data-request="${req.id}"]`);
  const line = await row.locator("[data-line]").innerText();
  t("My requests reads the software itself, to Anetix, and the stage with the word back", /to Anetix/.test(await row.innerText()) && /looking at it/.test(line) && /Looking at the phone layout now/.test(line), line);
  if (SHOTS) await f.screenshot({ path: `${SHOTS}/floor-my-requests.png` });
  await f.click("#fbw-mine-close");
  t("opening the list clears the badge", await f.locator("#fbw-anetix-new").count() === 0);
  // a module page's widget does not say Anetix
  await f.goto(`${BASE}/c/demo/m/paperline/`); await f.waitForSelector("#sos-fb-btn"); await f.click("#sos-fb-btn");
  t("on a module page the panel does not talk about Anetix", await f.locator("#fbw-anetix").count() === 0);

  // ---- admin: the Requests tab
  const a = await ctxA.newPage(); watch(a, "admin");
  await a.goto(`${BASE}/admin#requests`); await a.waitForSelector(`#req-open [data-request="${req.id}"]`, { timeout: 15000 });
  const tab = await a.locator('#shell nav a[data-tab="requests"]').innerText();
  t("the Requests tab carries the open count", /Requests\s*\d+/.test(tab.replace(/\n/g, " ")), tab);
  // a pill only while one is new (the launch audit 2.5): this one is already being looked at, so the tab's count is it
  t("no pill once every open request has been looked at", (await a.locator("#pill-requests").count()) === 0);
  const card = a.locator(`#req-open [data-request="${req.id}"]`);
  t("the request shows the company, the person and the stage", /Maria Browser/.test(await card.innerText()) && /Looking at it/.test(await card.innerText()) && /Looking at the phone layout now/.test(await card.innerText()), await card.innerText());
  if (SHOTS) await a.screenshot({ path: `${SHOTS}/admin-requests.png`, fullPage: true });
  await card.locator("button", { hasText: "Fixed" }).click();
  await a.fill("#rq-what", "The phone layout wraps the columns now.");
  await a.locator("#mcard button", { hasText: "Mark it fixed" }).click();
  await waitFor("the request to close", async () => (await a.locator(`#req-open [data-request="${req.id}"]`).count()) === 0, 10000);
  await a.locator("#req-closed-wrap summary").click();
  t("it moved to closed as fixed", /Fixed/.test(await a.locator(`#req-closed [data-request="${req.id}"]`).innerText()));
  // the floor reads it
  await f.goto(`${BASE}/c/demo/`); await f.waitForSelector("#sos-fb-btn"); await f.click("#sos-fb-btn");
  await waitFor("the badge again", async () => (await f.locator("#fbw-anetix-new").count()) === 1, 10000);
  await f.click("#fbw-mine-open");
  t("Maria reads fixed by Anetix and what changed", /Fixed by Anetix\. The phone layout wraps/.test(await f.locator(`[data-request="${req.id}"] [data-line]`).innerText()));

  t("no script errors on any page", errors.length === 0, errors);
  await browser.close();
  R.done();
})().catch(R.abort);
