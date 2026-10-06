// In a browser: an Anetix admin adds a manager from a company's Settings, copies the link, and the invited person
// opens it with no sign-in, picks a password and lands on the page that sets up their second step; the Companies tab's
// "Set up billing" puts a company added by hand on the Sites tab (src/managers.js, src/sites.js; 2026-10-06).
// Against a server ALREADY UP in fake-agent mode on a fresh database. SOS_SHOTS=<folder> keeps screenshots.
const { chromium } = require("playwright");
const { runner, login, PW, BASE } = require("./lib");
const R = runner(), t = R.t;
const SHOTS = process.env.SOS_SHOTS || "";
(async () => {
  const admin = await login(PW.admin);
  await admin.post("/api/admin/companies", { slug: "clockworks", name: "Clockworks" });
  const browser = await chromium.launch();
  const errors = [];
  const watch = (page, who) => { page.on("pageerror", (e) => errors.push(`${who}: ${e.message}`)); page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`${who} console: ${m.text()}`); }); };
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await ctx.addCookies(admin.cookies());
  const p = await ctx.newPage(); watch(p, "settings");
  await p.goto(`${BASE}/c/clockworks/settings#managers`); await p.waitForSelector("#mg-card", { state: "visible", timeout: 15000 });
  t("Settings has a Managers card, empty for a company added by hand, with Add a manager for an admin", /No manager has a sign-in of their own/.test(await p.locator("#mg-list").innerText()) && await p.locator("#mg-add").isVisible());
  await p.fill("#mg-name", "Art Stone"); await p.fill("#mg-email", "nope"); await p.click("#mg-go");
  await p.waitForFunction(() => document.getElementById("mg-msg").innerText.length > 0, null, { timeout: 5000 }).catch(() => {});
  t("a bad email says so", /does not look like one/.test(await p.locator("#mg-msg").innerText()), await p.locator("#mg-msg").innerText());
  await p.fill("#mg-email", "art@clockworks.test"); await p.click("#mg-go");
  await p.waitForSelector("#mg-link", { state: "visible", timeout: 8000 });
  const link = await p.inputValue("#mg-link-url");
  t("the link appears once, for that person, with how long it is good", link.startsWith(`${BASE}/join?t=`) && /The link for Art Stone \(good for 7 days, one use\)/.test(await p.locator("#mg-link-for").innerText()), link);
  await p.waitForSelector(".mg-row", { timeout: 5000 });
  const rowText = await p.locator(".mg-row").first().innerText();
  t("the list shows them as invited, with New link and Take back", /Art Stone/.test(rowText) && /invited, link good until/.test(rowText) && /New link/.test(rowText) && /Take back/.test(rowText), rowText);
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/managers-settings.png`, fullPage: true });

  // the invited person, a browser with no cookies, on a phone
  const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const j = await pctx.newPage(); watch(j, "join");
  await j.goto(link); await j.waitForSelector("#form:not([hidden])", { timeout: 10000 });
  t("the link opens with no sign-in: the company, who it is for, their email filled in and fixed", /Clockworks/.test(await j.locator("#title").innerText()) && /Art Stone, you were invited to be a manager at Clockworks/.test(await j.locator("#sub").innerText()) && (await j.inputValue("#email")) === "art@clockworks.test" && (await j.locator("#email").getAttribute("readonly")) !== null);
  t("the link is gone from the address bar", !/t=/.test(j.url()), j.url());
  t("on a phone the boxes are 16px (no zoom on focus) and fit", await j.evaluate(() => getComputedStyle(document.getElementById("pw")).fontSize === "16px" && document.querySelector(".card").getBoundingClientRect().right <= window.innerWidth));
  if (SHOTS) await j.screenshot({ path: `${SHOTS}/managers-join.png` });
  await j.fill("#pw", "short"); await j.click("#go");
  await j.waitForFunction(() => document.getElementById("err").innerText.length > 0, null, { timeout: 5000 }).catch(() => {});
  t("a short password says the rule", /at least 12 characters/.test(await j.locator("#err").innerText()), await j.locator("#err").innerText());
  await j.fill("#pw", "brass-gear-4471-chime");
  await Promise.all([j.waitForURL(/\/c\/clockworks\/enroll$/, { timeout: 10000 }), j.click("#go")]);
  t("with a password picked they land on setting up the second step", /\/c\/clockworks\/enroll$/.test(j.url()));
  const again = await pctx.newPage(); watch(again, "join again");
  await again.goto(link); await again.waitForFunction(() => /used already|no longer works/.test(document.getElementById("sub").innerText), null, { timeout: 8000 }).catch(() => {});
  t("opened again the link says it was used, with the way to sign in, and shows no form", /used already/.test(await again.locator("#sub").innerText()) && !(await again.locator("#form").isVisible()) && (await again.locator('#sub a[href="/login?staff=1"]').count()) === 1, await again.locator("#sub").innerText());

  // the Companies tab: Set up billing
  const a = await ctx.newPage(); watch(a, "admin");
  await a.goto(`${BASE}/admin#companies/clockworks`); await a.waitForSelector('a[data-track="clockworks"]', { timeout: 15000 }).catch(() => {});
  t("the company's card has Add a manager and Set up billing", (await a.locator('a[data-track="clockworks"]').count()) === 1 && (await a.locator('a[href="/c/clockworks/settings#managers"]').count()) === 1);
  await a.locator('a[data-track="clockworks"]').click();
  await a.waitForSelector("#sites-modal.on", { timeout: 10000 }).catch(() => {});
  t("Set up billing opens the Sites tab on that company's form, with the pilot offer there", /#sites/.test(a.url()) && (await a.locator("#sites-modal.on").count()) === 1 && /Clockworks/.test(await a.locator("#sites-mcard h2").innerText()));
  await a.waitForSelector("#sf-of-save", { timeout: 8000 }).catch(() => {});
  t("and the pilot can be offered from it", (await a.locator("#sf-of-save").count()) === 1);
  t("no script errors on any page", errors.length === 0, errors);
  await browser.close();
  R.done();
})().catch(R.abort);
