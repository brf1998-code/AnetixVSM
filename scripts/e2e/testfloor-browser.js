// Headless browser pass for the test floor (docs/TEST-ENVIRONMENT.md, push 1): the violet bar on a test page, no
// "did it fix it" or news there, the strip link on the board only while the switch is on, the settings card, the
// admin section, and a test page that leaves when the floor is switched off. Same server as the other e2e
// scripts (fake agent, passwords on), right after testfloor.js on the same database or on a fresh one.
//   node scripts/e2e/testfloor-browser.js
const { BASE, PW, sleep, runner, login, board } = require("./lib");
const { chromium } = require("playwright");
const R = runner(), t = R.t;

(async () => {
  const mgr = await login(PW.manager, "demo"), admin = await login(PW.admin, "");
  await admin.post("/api/admin/companies/demo/test-floor", { on: false });
  const browser = await chromium.launch();
  const errors = [];
  const watch = (page, who) => { page.on("pageerror", (e) => errors.push(`${who}: ${e.message}`)); page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|Refused to connect|violates the following Content Security Policy/.test(m.text())) errors.push(`${who} console: ${m.text()}`); }); };
  const ctxM = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await ctxM.addCookies(mgr.cookies());
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await ctxA.addCookies(admin.cookies());

  // ---- off: nothing on the board or the settings page
  const b = await ctxM.newPage(); watch(b, "board"); b.on("dialog", (d) => d.accept());
  await b.goto(BASE + "/c/demo/"); await b.waitForSelector("#modules .modcard");
  t("off: the strip has no test floor link", (await b.locator('#modules a[href*="/test/m/"]').count()) === 0);
  const st = await ctxM.newPage(); watch(st, "settings");
  await st.goto(BASE + "/c/demo/settings"); await st.waitForSelector("#coname");
  await sleep(600);
  t("off: the settings page has no test floor card", !(await st.locator("#tf-card").isVisible()));
  const a = await ctxA.newPage(); watch(a, "admin"); a.on("dialog", (d) => d.accept());
  await a.goto(BASE + "/admin#companies/demo"); await a.waitForSelector("#companies .card");
  const secOff = a.locator("#companies .card .sec", { hasText: "Test floor" });
  t("off: the admin card carries the switch and says off", (await secOff.count()) === 1 && /Off\./.test(await secOff.innerText()) && (await secOff.locator("button", { hasText: "Switch on" }).count()) === 1, await secOff.innerText());

  // ---- on, from the admin page
  await secOff.locator("button", { hasText: "Switch on" }).click();
  await a.waitForFunction(() => { const s = [...document.querySelectorAll("#companies .card .sec")].find((x) => /Test floor/.test(x.textContent)); return s && /On\./.test(s.textContent); }, null, { timeout: 30000 });
  const secOn = a.locator("#companies .card .sec", { hasText: "Test floor" });
  const onText = await secOn.innerText();
  t("on: the admin card says so, names the tools and offers the way in and the way back off", /On\. 2 tools up/.test(onText) && /Data: (a copy of the floor|a made-up set)/.test(onText) && (await secOn.locator('a[href="/c/demo/test/m/paperline/"]').count()) === 1 && (await secOn.locator("button", { hasText: "Switch off" }).count()) === 1, onText);
  await b.reload(); await b.waitForSelector('#modules a[href*="/test/m/"]');
  t("on: the strip links every tool's test floor", (await b.locator('#modules a[href="/c/demo/test/m/paperline/"]').count()) === 1 && (await b.locator('#modules a[href="/c/demo/test/m/kpis/"]').count()) === 1);
  await st.reload(); await st.waitForSelector("#tf-card", { state: "visible" });
  t("on: the settings page shows the card with a button per tool and the reset", (await st.locator('#tf-tools a[href="/c/demo/test/m/paperline/"]').count()) === 1 && /(copy of the floor|made-up set)/.test(await st.locator("#tf-data").innerText()) && (await st.locator("#tf-reset").count()) === 1);

  // ---- a test page: the violet bar, and the feedback panel's line
  const p = await ctxM.newPage(); watch(p, "test page");
  await p.goto(BASE + "/c/demo/test/m/paperline/"); await p.waitForSelector("#sos-test-bar");
  const bar = await p.locator("#sos-test-bar").innerText();
  t("a test page carries the bar: nothing here is real, the floor's version, the way back", /TEST FLOOR\. Nothing here is real\./.test(bar) && /The floor is on version \d+/.test(bar) && (await p.locator('#sos-test-bar a[href="/c/demo/m/paperline/"]').count()) === 1, bar);
  t("the bar is violet, not the preview's amber", /rgb\(91, 63, 160\)/.test(await p.locator("#sos-test-bar").evaluate((el) => getComputedStyle(el).backgroundColor)));
  t("no preview bar and no news banner on a test page", (await p.locator("#sos-staged-bar, #sos-news").count()) === 0);
  await p.locator("#sos-fb-btn").click();
  t("the feedback panel says where you are", /You are on the test floor/.test(await p.locator("#fbw-msg").evaluate((el) => el.parentElement.innerText)));
  t("the page's own API works from the page", (await p.evaluate(async () => (await fetch(location.pathname + "api/state")).status)) === 200);

  t("no script errors on any page so far", errors.length === 0, errors);

  // ---- the floor is switched off while the page is open: it says so and leaves (the page's own polling may log
  // an error in the two seconds before it goes, as a staged page does when its preview is deployed under it)
  await admin.post("/api/admin/companies/demo/test-floor", { on: false });
  await p.waitForURL(/\/c\/demo\/m\/paperline\/$/, { timeout: 15000 }).catch(() => {});
  t("switched off under it, the test page goes to the live page", /\/c\/demo\/m\/paperline\/$/.test(p.url()), p.url());
  t("the live page has no bar of either kind", (await p.locator("#sos-test-bar, #sos-staged-bar").count()) === 0);

  await browser.close();
  t("the board is back to no test floor", (await board(mgr)).test_floor === false);
  R.done();
})().catch(R.abort);
