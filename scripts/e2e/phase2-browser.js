// Headless browser pass for the launch audit's Phase 2 on /admin (2026-09-28): Demos is the first tab, with who is
// stuck and recent activity and a row's Grant credit and Seen (2.3, 2.9); Library and Models behind More, and a
// company card's experiments behind its own More (2.4); a pill only when something wants a look (2.5); a demo's
// sign-in is not a red flag and has no Set passwords (2.1); a pin made by hand comes with its message (2.8). Same server
// as the other e2e scripts (fake agent, passwords on), a FRESH database.
//   node scripts/e2e/phase2-browser.js
const { BASE, PW, runner, login } = require("./lib");
const { q } = require("../../src/db");
const selfserve = require("../../src/selfserve");
const { chromium } = require("playwright");
const R = runner(), t = R.t;

(async () => {
  const admin = await login(PW.admin, "");
  const pin = await selfserve.makePinRow({ label: "Rae at Gamma Parts", email: "rae@gamma.test", max_uses: 1, days: 30 }, "e2e");
  const made = await selfserve.createCompany({ pin: pin.pin, name: "Gamma Parts", contact: "Rae", email: "rae@gamma.test", ref: "e2e-phase2-browser", paid_usd: 0, credit_usd: 10, password: "a-long-enough-password", demo: true });
  const slug = made.company.slug;
  await q("UPDATE platform.self_serve SET created_at = now() - interval '5 hours' WHERE company=$1", [slug]);
  await q("INSERT INTO platform.ai_usage (company, kind, model, cost_usd) VALUES ($1,'design','claude-opus-5-5',12)", [slug]);   // out of credit

  const browser = await chromium.launch();
  const errors = [];
  const watch = (page, who) => { page.on("pageerror", (e) => errors.push(`${who}: ${e.message}`)); page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`${who} console: ${m.text()}`); }); };
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } }); await ctx.addCookies(admin.cookies());
  const p = await ctx.newPage(); watch(p, "admin"); p.on("dialog", (d) => d.accept());

  // ---- 2.3: Demos first, by default
  await p.goto(BASE + "/admin"); await p.waitForSelector("#demo-stuck", { timeout: 15000 });
  t("/admin opens on Demos", await p.locator("#tab-demos").isVisible() && (await p.locator('#shell nav a[data-tab="demos"]').getAttribute("class")) === "on");
  const tabs = await p.locator("#shell nav a").allInnerTexts();
  // Library came out of More on 2026-10-19, so nine tabs and then More
  t("the row: Demos first, nine tabs, then More", tabs.length === 10 && /^Demos/.test(tabs[0]) && /^More/.test(tabs[9]) && tabs.some((x) => /^Library/.test(x)) && !tabs.some((x) => /^Models/.test(x)), tabs);
  await p.click("#shell nav a[data-more]");
  t("More opens Library and Models", (await p.locator('#shell nav a[data-tab="library"]').isVisible()) && (await p.locator('#shell nav a[data-tab="models"]').isVisible()));
  t("no pill for AI spend or the models (2.5)", (await p.locator("#pill-spend, #pill-models").count()) === 0);

  // ---- 2.9: who is stuck, and recent activity
  const stuck = await p.locator("#demo-stuck").innerText();
  t("who is stuck names the demo: out of credit and the sign-in not set up", /Gamma Parts/.test(stuck) && /Out of credit/.test(stuck) && /Sign-in not set up/.test(stuck), stuck);
  t("the out of credit pill links to Demos", (await p.locator("#pill-pins").count()) === 1 && /#demos$/.test(await p.locator("#pill-pins").getAttribute("href")) && /Out of credit/.test(await p.locator("#pill-pins").innerText()));
  t("recent activity says the demo came in", /Gamma Parts came in/.test(await p.locator("#demo-activity").innerText()));
  const row = p.locator(`#demos-root tr.row`, { hasText: "Gamma Parts" });
  t("its row carries Grant credit and Seen, clear it", (await row.locator("button", { hasText: "Grant credit" }).count()) === 1 && (await row.locator("button", { hasText: "Seen, clear it" }).count()) === 1);
  await row.locator("button", { hasText: "Seen, clear it" }).click();
  await p.waitForFunction(() => /marked seen/.test((document.querySelector("#demo-stuck") || {}).innerText || ""), null, { timeout: 10000 });
  t("Seen, clear it stays on Demos, marks it seen, and the red pill goes", /#demos$/.test(p.url()) || p.url().endsWith("/admin"), p.url());
  await p.waitForFunction(() => !document.querySelector("#pill-pins"), null, { timeout: 10000 }).catch(() => {});
  t("the pill is gone once seen", (await p.locator("#pill-pins").count()) === 0);
  await row.locator("button", { hasText: "Grant credit" }).click();
  await p.fill("#gc-usd", "5"); await p.locator("#mcard button", { hasText: "Grant it" }).click();
  await p.waitForFunction(() => !/Gamma Parts[^\n]*Out of credit|Out of credit[^\n]*Gamma Parts/.test((document.querySelector("#demo-stuck") || {}).innerText || ""), null, { timeout: 10000 }).catch(() => {});
  t("Grant credit from the row takes it off the stuck list", !/Out of credit/.test(await p.locator("#demo-stuck").innerText()) || !/Gamma Parts/.test(await p.locator("#demo-stuck").innerText()));

  // ---- 2.3 and 2.8: the Pins tab
  await p.goto(BASE + "/admin#pins"); await p.waitForSelector("#pins-list");
  t("the Pins tab has no Self-serve companies card any more", (await p.locator("#ss-list").count()) === 0 && !/Self-serve companies/.test(await p.locator("#tab-pins").innerText()));
  await p.fill("#pin-label", "Ola at Delta Mill"); await p.fill("#pin-email", "ola@delta.test"); await p.locator("button", { hasText: "Make the pin" }).click();
  await p.waitForSelector("#drp-msg");
  const msg = await p.locator("#drp-msg").inputValue();
  t("a pin made by hand shows the message to send, with Copy and Open in email", /^Hi Ola,/.test(msg) && /Face ID or a fingerprint/.test(msg) && /To come back later/.test(msg) && (await p.locator("#mcard", { hasText: "Copy the message" }).count()) === 1 && (await p.locator('#mcard a[href^="mailto:ola%40delta.test"]').count()) === 1, msg.slice(0, 160));
  await p.locator("#mcard button", { hasText: "Done" }).click();

  // ---- 2.1 and 2.4: the company card
  await p.goto(BASE + `/admin#companies/${slug}`); await p.waitForSelector(`#companies .card[data-company="${slug}"]`);
  const listText = await p.locator("#co-list").innerText();
  t("a demo is not flagged in the company list", !/Gamma Parts\s*\n[^\n]*\n?\s*sign-in needs setting/.test(listText) && !/still on the shared/.test(listText.split("Gamma Parts")[1] || ""), listText);
  const cardEl = p.locator(`#companies .card[data-company="${slug}"]`);
  t("its sign-in says demo, with no floor PIN button", /a demo: no floor PIN/.test(await cardEl.locator(".sec", { hasText: "Sign-in" }).innerText()) && (await cardEl.locator("button", { hasText: "Floor PIN and passwords" }).count()) === 0);
  t("the rarely used settings wait behind the card's More, closed", (await cardEl.locator("details.comore").count()) === 1 && !(await cardEl.locator("details.comore").evaluate((d) => d.open)) && !(await cardEl.locator(".sec", { hasText: "Test floor" }).isVisible()));
  await cardEl.locator("details.comore > summary").click();
  t("open, they are all there", await cardEl.locator(".sec", { hasText: "Test floor" }).isVisible() && await cardEl.locator(".sec", { hasText: "What the AI reads" }).isVisible() && await cardEl.locator("button", { hasText: "Add module from library" }).isVisible());
  const demoCard = await p.goto(BASE + "/admin#companies/demo").then(() => p.waitForSelector('#companies .card[data-company="demo"]')).then(() => p.locator('#companies .card[data-company="demo"]'));
  t("a company made here still has its floor PIN button", (await demoCard.locator("button", { hasText: "Floor PIN and passwords" }).count()) === 1);

  // ---- a phone
  const ph = await browser.newContext({ viewport: { width: 390, height: 844 } }); await ph.addCookies(admin.cookies());
  const pp = await ph.newPage(); watch(pp, "phone");
  await pp.goto(BASE + "/admin"); await pp.waitForSelector("#demo-stuck", { timeout: 15000 });
  const wide = await pp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  t("Demos fits a phone", wide <= 1, wide);

  t("no script errors", errors.length === 0, errors.join(" | "));
  await browser.close();
  R.done();
})().catch(R.abort);
