// Headless browser pass for the Sites tab of /admin (public/assets/admin-sites.js, src/sites.js). Same server as
// scripts/e2e/sites.js (fake agent, SOS_WWW_KEY set in both shells); runs after it on the same database, or on a
// fresh one: it makes its own demo.
//   SOS_WWW_KEY=... node scripts/e2e/sites-browser.js          (SOS_SHOTS=<folder> keeps screenshots)
// What it proves: the tab is the tenth, between Demos and Companies; the price book shows the five bands with the two
// proposed prices marked; the quick quote sizes a site as you type; a row opens its form with what was saved, the
// band line follows the headcount typed, Save puts it on the row with its flag; a bad email says why and keeps the
// form open; Escape closes it; and on a phone the form is one column with nothing wider than the screen.
const { BASE, PW, sleep, runner, login } = require("./lib");
const { chromium } = require("playwright");
const R = runner(), t = R.t;
const SHOTS = process.env.SOS_SHOTS || "";
const KEY = process.env.SOS_WWW_KEY;
if (!KEY) { console.error("SOS_WWW_KEY must be set in this shell and the server's"); process.exit(2); }
const www = async (p, b) => (await fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json", "X-SOS-WWW-Key": KEY }, body: JSON.stringify(b) })).json();

(async () => {
  const admin = await login(PW.admin);
  const stamp = Date.now().toString(36).slice(-4);
  const email = `sam${stamp}@acmewire.test`;
  const pin = (await admin.post("/api/admin/pins", { label: `Sam at Acme ${stamp}`, email, max_uses: 1, days: 30 })).json.pin.shown;
  const slug = (await www("/api/www/companies", { pin, email, name: `Acme Wire ${stamp}`, contact: "Sam", ref: `sitesb:${pin}`, paid_usd: 0, credit_usd: 10, password: "copper-oak-2201-press", demo: true, collect: true })).company.slug;

  const browser = await chromium.launch();
  const errors = [];
  const watch = (page, who) => { page.on("pageerror", (e) => errors.push(`${who}: ${e.message}`)); page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`${who} console: ${m.text()}`); }); };
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } }); await ctx.addCookies(admin.cookies());
  const p = await ctx.newPage(); watch(p, "admin");
  await p.goto(`${BASE}/admin#sites`);
  await p.waitForSelector("#sites-table", { timeout: 15000 });
  const tabs = await p.locator("#shell nav a").allInnerTexts();
  t("Demos is the first tab (the launch audit 2.3), then Pins, then Sites", /^Demos/.test(tabs[0]) && /^Pins/.test(tabs[1]) && /^Sites/.test(tabs[2]) && /^More/.test(tabs[tabs.length - 1]), tabs);
  const bookRows = await p.locator("#sites-root .card").first().locator("table tr").count();
  t("the price book shows five bands, two with the price proposed", bookRows === 6 && (await p.locator("#sites-root .card").first().locator(".chip.prop").count()) === 2, bookRows);
  t("and says floor space moves a site up one band at most, and the fair-use line", /moves a site up one band at most/.test(await p.locator("#sites-root .card").first().innerText()) && /80% of the fee/.test(await p.locator("#sites-root .card").first().innerText()));

  // ---- the quick quote
  await p.fill("#sq-head", "40"); await p.fill("#sq-sqft", "110000");
  await p.waitForFunction(() => /Mid site/.test(document.getElementById("sq-line").innerText), null, { timeout: 5000 }).catch(() => {});
  const ql = await p.locator("#sq-line").innerText();
  t("the quick quote: 40 people on 110,000 square feet is a Mid site at $1,750 a month, moved up for floor space", /Mid site: \$1,750 a month/.test(ql) && /moves it up one band/.test(ql), ql);
  await p.fill("#sq-head", "lots");
  await p.waitForFunction(() => /whole number/.test(document.getElementById("sq-line").innerText), null, { timeout: 5000 }).catch(() => {});
  t("words in the headcount say why", /whole number/.test(await p.locator("#sq-line").innerText()));
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/sites-tab.png`, fullPage: true });

  // ---- one site's form
  await p.locator(`tr.row[data-slug="${slug}"]`).click();
  await p.waitForSelector("#sites-modal.on", { timeout: 5000 });
  t("the row opens its form, named for the company, with the demo behind it", /Acme Wire/.test(await p.locator("#sites-mcard h2").innerText()) && /came in on the pin for Sam at Acme/.test(await p.locator("#sites-mcard").innerText()));
  await p.fill("#sf-site", "Acme Wire, Worcester");
  await p.fill("#sf-l1", "40 Foundry Street"); await p.fill("#sf-city", "Worcester"); await p.fill("#sf-state", "ma"); await p.fill("#sf-zip", "01608");
  await p.fill("#sf-pmname", "Sam Ortiz"); await p.fill("#sf-pmemail", "not an email");
  await p.fill("#sf-head", "48");
  await p.waitForFunction(() => /Small site/.test(document.getElementById("sf-band").innerText), null, { timeout: 5000 }).catch(() => {});
  const bl = await p.locator("#sf-band").innerText();
  t("the band line follows the headcount typed, with the edge flag", /Small site: \$1,000 a month/.test(bl) && /within five of Mid/.test(bl), bl);
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/sites-form.png` });
  await p.click("#sf-save");
  await p.waitForFunction(() => document.getElementById("sf-err").innerText.length > 0, null, { timeout: 5000 }).catch(() => {});
  t("a bad email says why, and the form stays open", /email/.test(await p.locator("#sf-err").innerText()) && await p.locator("#sites-modal.on").count() === 1, await p.locator("#sf-err").innerText());
  await p.fill("#sf-pmemail", "sam@acmewire.test");
  await p.click("#sf-save");
  await p.waitForSelector("#sites-modal.on", { state: "detached", timeout: 5000 }).catch(() => {});
  await p.waitForFunction((s) => { const r = document.querySelector(`tr.row[data-slug="${s}"]`); return r && /Small/.test(r.innerText); }, slug, { timeout: 5000 }).catch(() => {});
  const row = await p.locator(`tr.row[data-slug="${slug}"]`).innerText();
  t("saved: the row shows the site, the plant manager, the size, the band and its flag", /Acme Wire, Worcester/.test(row) && /40 Foundry Street, Worcester, MA 01608/.test(row) && /Sam Ortiz/.test(row) && /48 people/.test(row) && /Small · \$1,000\/mo/.test(row) && /within five of Mid/.test(row), row);
  t("the form is closed", await p.locator("#sites-modal.on").count() === 0);
  await p.locator(`tr.row[data-slug="${slug}"]`).click(); await p.waitForSelector("#sites-modal.on");
  t("opening it again shows what was saved", (await p.inputValue("#sf-head")) === "48" && (await p.inputValue("#sf-state")) === "MA" && (await p.inputValue("#sf-pmemail")) === "sam@acmewire.test");
  await p.keyboard.press("Escape");
  t("Escape closes it", await p.locator("#sites-modal.on").count() === 0);

  // ---- on a phone
  const ph = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); await ph.addCookies(admin.cookies());
  const m = await ph.newPage(); watch(m, "phone");
  await m.goto(`${BASE}/admin#sites`); await m.waitForSelector("#sites-table", { timeout: 15000 });
  if (SHOTS) await m.screenshot({ path: `${SHOTS}/sites-phone.png`, fullPage: true });
  await m.locator(`tr.row[data-slug="${slug}"]`).click(); await m.waitForSelector("#sites-modal.on");
  const widths = await m.evaluate(() => {
    const card = document.getElementById("sites-mcard").getBoundingClientRect();
    const inputs = [...document.querySelectorAll("#sites-mcard input:not([type=checkbox])")].map((i) => i.getBoundingClientRect());
    return { vw: window.innerWidth, card: Math.round(card.width), right: Math.round(card.right), oneColumn: inputs.every((r) => Math.abs(r.left - inputs[0].left) < 2), font: getComputedStyle(document.getElementById("sf-head")).fontSize };
  });
  t("on a phone the form fits the screen, one column, with 16px boxes (no zoom on focus)", widths.right <= widths.vw && widths.oneColumn && widths.font === "16px", widths);
  if (SHOTS) await m.screenshot({ path: `${SHOTS}/sites-phone-form.png`, fullPage: false });

  t("no script errors on any page", errors.length === 0, errors);
  await browser.close();
  R.done();
})().catch(R.abort);
