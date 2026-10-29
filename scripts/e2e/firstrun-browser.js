// Headless browser pass for the first-time user round (2026-10-01): the questions say needed or optional and what
// each is for, with a dot per question; the requirements screen says what it is, numbers the points with a tag, takes
// a change in words per point and sends them in one pass, and opens Approve build only after "I've read all N"
// (shown once the end of the list has been on screen); Fill with sample data shows the wait at once; Review all with
// AI sends the waiting requests; Screens shows every screen of a tool and goes to the one tapped. Same server as
// firstrun.js. Screenshots go to SOS_SHOTS (default /tmp/firstrun-shots).
//   node scripts/e2e/firstrun-browser.js
const { PW, BASE, sleep, runner, login, person, board, fbRow, waitFor } = require("./lib");
const { chromium } = require("playwright");
const fs = require("fs");
const R = runner(), t = R.t;
const SHOTS = process.env.SOS_SHOTS || "/tmp/firstrun-shots";
fs.mkdirSync(SHOTS, { recursive: true });
const answerFor = (qn) => ({ text: qn.id === "name" ? "Spool tracker" : "Check text for the intake", choice: { picks: [((qn.options || []).find((o) => o.id === "nothing") || (qn.options || [])[0] || {}).id].filter(Boolean), other: "" }, roles: { floor: "6" }, devices: { floor: ["phone"] }, order: ["wound", "checked", "shipped"], items: ["spools get lost"], attach: { note: "" } }[qn.kind]);

(async () => {
  const mgr = await login(PW.manager, "demo"), floor = await login(PW.floor, "demo");
  const brendan = await person(mgr, "demo", "Brendan F", "manager");
  await mgr.post("/api/c/demo/who/sign-in", { id: brendan.id, pin: brendan.pin });
  const browser = await chromium.launch();
  const errors = [];
  const watch = (page, who) => { page.on("pageerror", (e) => errors.push(`${who}: ${e.message}`)); page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|Refused to connect|violates the following Content Security Policy/.test(m.text())) errors.push(`${who} console: ${m.text()}`); }); };
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await ctx.addCookies(mgr.cookies());
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); await phone.addCookies(mgr.cookies());

  // ---- the questions --------------------------------------------------------------------------------------------------
  const it = (await mgr.post("/api/c/demo/intakes", {})).json;
  const p = await ctx.newPage(); watch(p, "board"); p.on("dialog", (d) => d.accept());
  await p.goto(`${BASE}/c/demo/?intake=${it.id}`);
  await p.waitForSelector(".ik-box");
  t("the first question says it is needed and what the answer is for", /needed/i.test(await p.locator(".ik-need").innerText()) && /board/.test(await p.locator(".ik-need").innerText()));
  t("a dot per question of the round", (await p.locator(".ik-dot").count()) >= 12);
  await p.screenshot({ path: `${SHOTS}/1-question.png` });
  await p.locator("button", { hasText: "Next" }).click();            // past the name without answering
  await p.locator("button", { hasText: "Next" }).click();
  t("a needed question left behind shows as a red ring", (await p.locator(".ik-dot.miss").count()) >= 1);
  t("the head counts what is still needed", /needed/.test(await p.locator(".ik-prog").innerText()), await p.locator(".ik-prog").innerText());
  await p.locator(".ik-dot").first().click();
  t("tapping a dot goes to that question", /call it/.test(await p.locator(".ik-q").innerText()));
  const last = (await p.locator(".ik-dot").count()) - 1;
  await p.locator(".ik-dot").nth(last).click();
  t("an optional question says so", /optional/i.test(await p.locator(".ik-need").innerText()));
  await p.screenshot({ path: `${SHOTS}/2-question-dots.png` });
  await p.locator(".ik-x").click();

  // to the requirements, through the API
  let view = it;
  for (let guard = 0; guard < 6 && ["answering", "thinking"].includes(view.status); guard++) {
    for (const qn of view.questions.filter((x) => view.missing.includes(x.id))) await mgr.post(`/api/intakes/${it.id}/answer`, { id: qn.id, value: answerFor(qn) });
    await mgr.post(`/api/intakes/${it.id}/next`, {});
    view = await waitFor("the intake to stop thinking", async () => { const v = (await mgr.get(`/api/intakes/${it.id}`)).json; return v.status !== "thinking" ? v : null; });
  }
  t("setup: requirements ready", view.status === "design");

  // ---- the requirements ----------------------------------------------------------------------------------------------
  await p.goto(`${BASE}/c/demo/`);
  await p.waitForSelector(".card.request");
  t("the card says requirements to confirm and how many points", /Requirements ready to confirm: 5 points/.test(await p.locator(".card.request").innerText()));
  await p.locator(".card.request button", { hasText: "Confirm the requirements" }).click();
  await p.waitForSelector(".ik-points");
  t("the screen says it is the requirements being confirmed, and what to do", /confirm the requirements/i.test(await p.locator(".ik-round").innerText()) && /Read each one/.test(await p.locator(".ik-intro").innerText()));
  t("five numbered points, each with a tag and Change this", (await p.locator(".ik-pt").count()) === 5 && (await p.locator(".ik-pt .ik-tag").count()) === 5 && (await p.locator(".ik-pt .ik-link", { hasText: "Change this" }).count()) === 5);
  t("no raw text editor any more", (await p.locator("button", { hasText: "Adjust the text" }).count()) === 0 && (await p.locator(".ik-ref textarea").count()) === 0);
  t("Approve build waits", await p.locator("#ik-approve").isDisabled());
  await p.screenshot({ path: `${SHOTS}/3-requirements-top.png` });
  // the tick shows once the end has been on screen (here the list fits, so at once; the phone below has to scroll)
  await p.evaluate(() => { const b = document.querySelector(".ik-body"); b.scrollTop = b.scrollHeight; });
  await p.waitForSelector("#ik-readall:not([hidden])");
  t("at the end, the one tick", /I've read all 5 points/.test(await p.locator("#ik-readall").innerText()));
  await p.locator("#ik-readall input").check();
  t("the tick opens Approve build", !(await p.locator("#ik-approve").isDisabled()));
  await p.screenshot({ path: `${SHOTS}/4-requirements-end.png` });

  // a change to point 2 and something to add
  await p.locator('.ik-pt[data-pt="p2"] .ik-link', { hasText: "Change this" }).click();
  await p.locator("#ik-ed").fill("leads get their own screen too");
  await p.locator("button", { hasText: "Keep this change" }).click();
  await p.locator("button", { hasText: "+ Add something missing" }).click();
  await p.locator("#ik-ed").fill("a spool is weighed before it ships");
  await p.locator("button", { hasText: "Add it" }).click();
  t("the change shows under its point, the addition below the list", /leads get their own screen too/.test(await p.locator('.ik-pt[data-pt="p2"] .ik-ask').innerText()) && /weighed/.test(await p.locator(".ik-ask", { hasText: "To add" }).innerText()));
  t("with changes waiting, the button sends them and Approve is gone", /Send 2 changes to the agent/.test(await p.locator("#ik-send").innerText()) && (await p.locator("#ik-approve").count()) === 0);
  await p.screenshot({ path: `${SHOTS}/5-requirements-changes.png` });
  // closing keeps them (this browser)
  await p.locator(".ik-x").click(); await sleep(300);
  await p.locator(".card.request button", { hasText: "Confirm the requirements" }).click();
  await p.waitForSelector("#ik-send");
  t("closing and opening again keeps the changes not yet sent", /Send 2 changes/.test(await p.locator("#ik-send").innerText()));
  await p.locator("#ik-send").click();
  await p.waitForSelector(".ik-think");
  t("while the agent works it says the rest stays as it is", /stays exactly as it was/.test(await p.locator(".ik-think").innerText()));
  await p.screenshot({ path: `${SHOTS}/6-requirements-thinking.png` });
  await p.waitForSelector(".ik-points", { timeout: 30000 });
  t("back: point 2 marked as changed as asked", /changed as you asked/i.test(await p.locator('.ik-pt[data-pt="p2"] .ik-mark').innerText()));
  t("the addition is a new point", (await p.locator(".ik-pt .ik-mark.new").count()) === 1 && (await p.locator(".ik-pt").count()) === 6);
  t("a new version is read again: Approve waits", await p.locator("#ik-approve").isDisabled());
  await p.screenshot({ path: `${SHOTS}/7-requirements-revised.png`, fullPage: false });

  // the phone
  const ph = await phone.newPage(); watch(ph, "phone"); ph.on("dialog", (d) => d.accept());
  await ph.goto(`${BASE}/c/demo/?intake=${it.id}`);
  await ph.waitForSelector(".ik-points");
  await sleep(200);
  t("on a phone the list runs past the screen, and the tick waits for the end", !(await ph.locator("#ik-readall").isVisible()) && /Read to the end/.test(await ph.locator(".ik-foot").innerText()));
  await ph.screenshot({ path: `${SHOTS}/8-requirements-phone.png` });
  await ph.evaluate(() => { const b = document.querySelector(".ik-body"); b.scrollTop = b.scrollHeight; });
  await ph.waitForSelector("#ik-readall:not([hidden])");
  await ph.screenshot({ path: `${SHOTS}/9-requirements-phone-end.png` });
  await ph.close();
  await p.locator(".ik-x").click();
  await mgr.post(`/api/intakes/${it.id}/abandon`, {});

  // ---- sample data: the wait shows at once ---------------------------------------------------------------------------
  await p.goto(`${BASE}/c/demo/`);
  await p.waitForSelector(".modcard");
  await p.locator(".modcard", { hasText: "Paper Airplane Line" }).locator("button.vbtn", { hasText: "Settings" }).click();   // the tool's Settings popout (2026-10-29)
  await p.locator("#tmenu button", { hasText: "Sample data" }).click();
  await p.waitForSelector("#samplepanel");
  // hold the fill's answer back a moment so the wait before it can be seen
  await p.route("**/modules/paperline/sample", async (route) => { if (route.request().method() === "POST") await sleep(1200); route.continue().catch(() => {}); });
  await p.locator("#samplepanel button", { hasText: "Fill with sample data" }).click();
  await p.waitForSelector("#samplepanel .swait .wheel", { timeout: 500 });
  t("the wheel turns the moment Fill is pressed, and nothing can be pressed twice", /Starting the agent/.test(await p.locator("#samplepanel .swait").innerText()) && await p.locator("#samplepanel .vrow button").first().isDisabled());
  await p.screenshot({ path: `${SHOTS}/10-sample-starting.png` });
  await p.unroute("**/modules/paperline/sample");
  const writing = await p.waitForSelector("#samplepanel .swait b:has-text('Writing sample data')", { timeout: 5000 }).then(() => true, () => false);
  if (writing) { t("then it says it is writing, with a bar and the time so far", (await p.locator("#samplepanel .sbar").count()) === 1 && /so far/.test(await p.locator("#samplepanel .swait").innerText())); await p.screenshot({ path: `${SHOTS}/11-sample-writing.png` }); }
  await p.waitForSelector("#samplepanel button:has-text('Clear sample data')", { timeout: 60000 }).catch(() => {});
  await p.locator("#samplepanel .x").click().catch(() => {});

  // ---- Review all with AI ----------------------------------------------------------------------------------------------
  await mgr.post("/api/c/demo/agents/arrival", { auto_propose: false });
  const file = async (msg) => (await floor.post("/api/feedback", { company: "demo", module: "paperline", page: "/c/demo/m/paperline/", message: msg })).json.id;
  const a = await file("the clip bin count should reset each shift"), b = await file("stations need a way to mark a jam"), c = await file("the timer should pause on a jam");
  await p.goto(`${BASE}/c/demo/`);
  await p.waitForSelector("#reviewall .reviewall");
  t("one panel above the Feedback column counts what waits", /Review all 3 with AI/.test(await p.locator("#reviewall-go").innerText()));
  await p.screenshot({ path: `${SHOTS}/12-review-all.png` });
  await p.locator("#reviewall-go").click();
  await waitFor("all three drafted", async () => { const rows = await Promise.all([a, b, c].map((id) => fbRow(mgr, id))); return rows.every((f) => f.status === "reviewing" && f.proposal_id); }, 60000);
  await sleep(4500);
  t("the panel goes once nothing waits", (await p.locator("#reviewall .reviewall").count()) === 0);
  await mgr.post("/api/c/demo/agents/arrival", { auto_propose: true });

  // ---- every screen of a tool -----------------------------------------------------------------------------------------
  await p.locator(".modcard", { hasText: "Paper Airplane Line" }).locator("button.vbtn", { hasText: "Screens" }).click();
  await p.waitForSelector(".scr-grid .scr-tile");
  t("every screen of the tool side by side, each a small live copy", (await p.locator(".scr-tile").count()) === 4 && (await p.locator(".scr-tile iframe").count()) === 4);
  t("each goes to its screen", (await p.locator(".scr-tile").nth(2).getAttribute("href")) === "/c/demo/m/paperline/station/1");
  await sleep(2500);
  await p.screenshot({ path: `${SHOTS}/13-screens.png` });
  await p.keyboard.press("Escape");
  t("Escape closes it", (await p.locator(".scr-grid").count()) === 0);
  await p.locator(".modcard", { hasText: "Paper Airplane Line" }).locator("button.vbtn", { hasText: "Screens" }).click();
  await p.locator(".scr-tile").nth(1).click();
  await p.waitForURL(/\/m\/paperline\/station/);
  t("tapping one opens that screen", /\/c\/demo\/m\/paperline\/station$/.test(new URL(p.url()).pathname.replace(/\/$/, "")), p.url());
  const pp = await phone.newPage(); watch(pp, "phone");
  await pp.goto(`${BASE}/c/demo/`);
  await pp.waitForSelector(".modtoggle");
  await pp.locator(".modtoggle").click();
  await pp.locator(".modcard", { hasText: "Paper Airplane Line" }).locator("button.vbtn", { hasText: "Screens" }).click();
  await pp.waitForSelector(".scr-tile");
  await sleep(2500);
  await pp.screenshot({ path: `${SHOTS}/14-screens-phone.png` });

  t("no errors on any page", errors.length === 0, errors);
  await browser.close();
  R.done();
})().catch(R.abort);
