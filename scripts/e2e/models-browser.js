// Headless browser pass for /admin#models and the Agent settings page (src/assess.js, public/assets/admin-models.js).
// Run it right AFTER scripts/e2e/models.js, on the same server and database (it reads the head-to-heads and the A/B
// numbers that suite left behind).   node scripts/e2e/models-browser.js   (SOS_E2E_SHOTS=<dir> keeps screenshots)
const { BASE, PW, runner, login, waitFor } = require("./lib");
const { chromium } = require("playwright");
const R = runner(), t = R.t;
const F = "claude-fable-5-1", O = "claude-opus-5-5";
const SHOTS = process.env.SOS_E2E_SHOTS || "";

(async () => {
  const admin = await login(PW.admin, ""), mgr = await login(PW.manager, "demo");
  const before = (await admin.get("/api/admin/models")).json.assessments;   // newest first: the stopped one, then the one with picks
  const newest = before[0].id, older = before[1].id;
  const browser = await chromium.launch();
  const errors = [];
  const watch = (page, who) => { page.on("pageerror", (e) => errors.push(`${who}: ${e.message}`)); page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`${who} console: ${m.text()}`); }); };
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await ctx.addCookies(admin.cookies());
  const p = await ctx.newPage(); watch(p, "admin");
  p.on("dialog", (d) => d.accept());
  await p.goto(BASE + "/admin#models");
  await p.waitForSelector("#am-baseline");
  const text = await p.locator("#models-root").innerText();
  t("the Models tab shows the baseline, the head-to-head and the live A/B", /Baseline/.test(text) && /Head-to-head/.test(text) && /Live A\/B/.test(text), text.slice(0, 400));
  t("the baseline reads Fable 5.1", (await p.locator("#am-baseline .big").innerText()).trim() === "Fable 5.1");
  t("the retired variable is named on the page", /SOS_MODEL_PROPOSE/.test(text));
  t("the short text jobs show their own model, Sonnet 5", /Short text jobs/i.test(text) && (await p.locator("#am-summary").inputValue()) === "claude-sonnet-5");
  t("the tab row has Models, and the pill says the baseline", (await p.locator('#shell nav a[data-tab="models"]').count()) === 1 && /Fable 5\.1 baseline/.test(await p.locator("#pill-models").innerText()));
  await p.waitForSelector("#am-assess");
  const card = await p.locator("#am-assess").innerText();
  t("the newest head-to-head is open, with its status", new RegExp(`Head-to-head #${newest}`).test(card) && /stopped/.test(card), card.slice(0, 300));
  await p.click('#am-list button:has-text("Open") >> nth=0');
  await p.waitForFunction((id) => new RegExp(`Head-to-head #${id}`).test(document.querySelector("#am-assess").innerText), older);
  const card1 = await p.locator("#am-assess").innerText();
  t("the older head-to-head: four kinds, both models, spend line, the rules folded", /Cross-checks/.test(card1) && /Proposals/.test(card1) && /Designs/.test(card1) && /Builds/.test(card1) && /Fable 5\.1/i.test(card1) && /Opus 5\.5/i.test(card1) && /The rules the reading uses/.test(card1), card1.slice(0, 600));
  t("it says it is too early to call", /Too few cases/.test(card1));
  t("the live A/B shows the test that ran, one column per model", /Builds started/.test(await p.locator("#am-ab").innerText()) && /Off\. The last test ran/.test(await p.locator("#am-ab").innerText()));
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/models-desktop.png`, fullPage: true });

  // a fresh head-to-head from the page, then a blind pick in the overlay
  await p.fill("#am-n-crosscheck", "0"); await p.fill("#am-n-proposal", "1"); await p.fill("#am-n-design", "0"); await p.fill("#am-n-build", "0");
  await p.dispatchEvent("#am-n-build", "input");
  t("the estimate follows the cases asked for", /About \$0\.\d\d for both models/.test(await p.locator("#am-est").innerText()), await p.locator("#am-est").innerText());
  await p.click('button:has-text("Start the head-to-head")');
  const third = await waitFor("the new head-to-head", async () => { const l = (await admin.get("/api/admin/models")).json.assessments; return l[0].id > newest ? l[0].id : null; });
  await p.waitForFunction((id) => new RegExp(`Head-to-head #${id}`).test((document.querySelector("#am-assess") || {}).innerText || ""), third, { timeout: 30000 });
  await waitFor("the new one to finish", async () => (await admin.get(`/api/admin/assess/${third}`)).json.assessment.status === "done", 60000);
  await p.waitForFunction(() => /Pick blind \(1 waiting\)/.test((document.querySelector("#am-assess") || {}).innerText || ""), null, { timeout: 20000 });
  await p.click('button:has-text("Pick blind")');
  await p.waitForSelector("#am-over.on .sides");
  const blind = await p.locator("#am-card").innerText();
  t("the blind pick shows the request and two answers, Left and Right", /Left/.test(blind) && /Right/.test(blind) && /The request/.test(blind), blind.slice(0, 300));
  t("and no model name, cost or time anywhere on it", !/Fable|Opus|claude-|\$\d|\d+ s\b/.test(blind), blind.match(/.{0,30}(Fable|Opus|claude-|\$\d).{0,30}/));
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/models-blind.png`, fullPage: true });
  await p.click('#am-card button:has-text("Left is better")');
  await p.waitForFunction(() => /Left was/.test(document.getElementById("am-revealed").innerText));
  t("a pick reveals which model was on which side", /Left was (Fable 5\.1|Opus 5\.5), right was (Fable 5\.1|Opus 5\.5)/.test(await p.locator("#am-revealed").innerText()));
  await p.waitForFunction(() => /Nothing left to pick/.test(document.getElementById("am-card").innerText), null, { timeout: 5000 });
  await p.click('#am-card button:has-text("Close")');
  const g3 = (await admin.get(`/api/admin/assess/${third}`)).json;
  t("the pick landed", g3.picks.length === 1 && g3.picks[0].pick === "left");

  // the baseline from the page, and back
  await p.selectOption("#am-base", O);
  await p.click('button:has-text("Make it the baseline")');
  await p.waitForFunction(() => document.querySelector("#am-baseline .big").innerText.trim() === "Opus 5.5");
  t("the baseline moves from the page", (await admin.get("/api/admin/models")).json.settings.baseline === O);
  await p.selectOption("#am-base", F); await p.click('button:has-text("Make it the baseline")');
  await p.waitForFunction(() => document.querySelector("#am-baseline .big").innerText.trim() === "Fable 5.1");

  // the short text model from the page, and back
  await p.selectOption("#am-summary", "claude-haiku-4-5-20251001"); await p.click('#am-baseline button:has-text("Save") >> nth=0');
  await waitFor("the short text model", async () => (await admin.get("/api/admin/models")).json.settings.summary === "claude-haiku-4-5-20251001");
  t("the short text model moves from the page", true);
  await p.waitForSelector("#am-summary"); await p.selectOption("#am-summary", "claude-sonnet-5"); await p.click('#am-baseline button:has-text("Save") >> nth=0');
  await waitFor("back to Sonnet 5", async () => (await admin.get("/api/admin/models")).json.settings.summary === "claude-sonnet-5");

  // the A/B switch from the page
  await p.click('button:has-text("Start the A/B")');
  await p.waitForFunction(() => /Running/.test(document.querySelector("#am-ab").innerText));
  t("the A/B starts from the page", (await admin.get("/api/admin/models")).json.settings.ab.on === true);
  await p.click('button:has-text("Stop the A/B")');
  await p.waitForFunction(() => /Off\./.test(document.querySelector("#am-ab").innerText));
  t("and stops", (await admin.get("/api/admin/models")).json.settings.ab.on === false);

  // phone width: no sideways scroll on the page itself
  const ph = await browser.newContext({ viewport: { width: 390, height: 844 } }); await ph.addCookies(admin.cookies());
  const pp = await ph.newPage(); watch(pp, "phone");
  await pp.goto(BASE + "/admin#models"); await pp.waitForSelector("#am-assess");
  const wide = await pp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  t("the Models tab fits a phone (tables scroll inside their own box)", wide <= 1, wide);
  if (SHOTS) await pp.screenshot({ path: `${SHOTS}/models-phone.png`, fullPage: true });

  // the company's Agent settings: follow the platform, or pin
  const cm = await browser.newContext({ viewport: { width: 1100, height: 900 } }); await cm.addCookies(admin.cookies());   // Anetix's page since the launch audit 1.18
  const ap = await cm.newPage(); watch(ap, "agents");
  ap.on("dialog", (d) => d.accept());
  await ap.goto(BASE + "/c/demo/agents"); await ap.waitForSelector("#m-build option", { state: "attached" });
  const opts = await ap.locator("#m-build option").allInnerTexts();
  t("each job offers the platform's model first, then a pin on either model", opts.length === 3 && /^Platform's model \(now Fable 5\.1\)/.test(opts[0]) && /Pin Fable 5\.1/.test(opts[1]) && /Pin Opus 5\.5/.test(opts[2]), opts);
  t("nothing on the page names Sonnet or Haiku", !/Sonnet|Haiku/.test(await ap.locator("body").innerText()));
  await ap.click('button:has-text("Save models")');
  await ap.waitForTimeout(600);
  t("saving without touching anything pins nothing (the old page pinned what was in force)", Object.values((await admin.get("/api/c/demo/agents")).json.models.pins).every((x) => x === null));
  await ap.selectOption("#m-review", O); await ap.click('button:has-text("Save models")');
  await waitFor("the pin", async () => (await admin.get("/api/c/demo/agents")).json.models.pins.review === O);
  t("picking a pin pins that job only", (await admin.get("/api/c/demo/agents")).json.models.pins.build === null);
  await admin.post("/api/admin/models/unpin", { slug: "demo" });

  t("no page errors", errors.length === 0, errors);
  await browser.close();
  R.done();
})().catch(R.abort);
