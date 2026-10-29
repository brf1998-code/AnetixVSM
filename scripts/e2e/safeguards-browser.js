// In a browser: the Safeguards section of a company's card on /admin and the Upload scanner card on the Instance tab
// (src/safeguards.js, src/scan.js; 2026-10-08), and what the floor sees of the mic switch: with talking off a tool's
// page offers no mic button, and the browser itself has been told the microphone is not for that page.
// Against a server ALREADY UP in fake-agent mode on a fresh database (run-all.sh has the line); this script plays the
// scanner on SOS_SCAN_PORT. SOS_SHOTS=<folder> keeps screenshots.
const { chromium } = require("playwright");
const { runner, login, PW, BASE, sleep } = require("./lib");
const fakeClamd = require("./fake-clamd");
const R = runner(), t = R.t;
const SHOTS = process.env.SOS_SHOTS || "";
const PAGE = "/c/demo/m/paperline/";
(async () => {
  const fake = await fakeClamd.start(Number(process.env.SOS_SCAN_PORT || 4666));
  const admin = await login(PW.admin, ""), floor = await login(PW.floor, "demo");
  const demo = async () => (await admin.get("/api/admin/overview")).json.companies.find((c) => c.slug === "demo");
  const browser = await chromium.launch();
  const errors = [];
  const watch = (page, who) => { page.on("pageerror", (e) => errors.push(`${who}: ${e.message}`)); page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|Refused to connect|violates the following Content Security Policy|Permissions policy violation/.test(m.text())) errors.push(`${who} console: ${m.text()}`); }); };
  const ctxAd = await browser.newContext({ viewport: { width: 1280, height: 1000 } }); await ctxAd.addCookies(admin.cookies());
  const ctxF = await browser.newContext({ viewport: { width: 1024, height: 768 } }); await ctxF.addCookies(floor.cookies());

  // ---- the company's card
  const p = await ctxAd.newPage(); watch(p, "admin");
  p.on("dialog", (d) => d.accept());
  await p.goto(`${BASE}/admin#companies/demo`); await p.waitForSelector('[data-company="demo"]', { timeout: 15000 });
  await p.locator('[data-more="demo"] > summary').click();
  const sec = p.locator('[data-safeguards="demo"]');
  await sec.waitFor({ state: "visible", timeout: 5000 });
  const text0 = await sec.innerText();
  t("the card's More has a Safeguards section that says who it is for", /government contract information/.test(text0) && /defense supplier/.test(text0));
  t("three switches as they stand by default, each saying what on means", await sec.locator('[data-sg="talk"]').isChecked() && await sec.locator('[data-sg="label_preview"]').isChecked() && !(await sec.locator('[data-sg="require_scan"]').isChecked()) && /sends the audio to Google or Apple/.test(text0) && /public renderer/.test(text0) && /kept, and scanned when the scanner answers again/.test(text0), text0);
  t("and where the shared passwords work from: anywhere", /Shared passwords work from:\s*anywhere/.test(text0) && await sec.locator("button", { hasText: "Limit to the plant's network" }).isVisible());
  t("no dashes in it (house rule)", !/[–—]/.test(text0));
  if (SHOTS) await p.locator('[data-company="demo"]').screenshot({ path: `${SHOTS}/safeguards-card.png` });
  await sec.locator('[data-sg="talk"]').click();
  await p.waitForFunction(() => { const b = document.querySelector('[data-safeguards="demo"] [data-sg="talk"]'); return b && !b.checked && /no mic button/i.test(document.querySelector('[data-safeguards="demo"]').innerText); }, null, { timeout: 8000 }).catch(() => {});
  t("unticking Talk switches it off for the company, and the card stays open on the section", (await demo()).allow_talk === false && /Off: no mic button/.test(await sec.innerText()) && await sec.isVisible());
  await sec.locator('[data-sg="require_scan"]').click();
  await p.waitForFunction(() => { const b = document.querySelector('[data-safeguards="demo"] [data-sg="require_scan"]'); return b && b.checked && /could not take is refused/.test(document.querySelector('[data-safeguards="demo"]').innerText); }, null, { timeout: 8000 }).catch(() => {});
  t("ticking Uploads must be scanned switches it on", (await demo()).require_scan === true && /could not take is refused/.test(await sec.innerText()));

  // the network list
  await sec.locator("button", { hasText: "Limit to the plant's network" }).click();
  await p.waitForSelector("#nw-list", { state: "visible", timeout: 5000 });
  const modal = await p.locator("#mcard").innerText();
  t("the list's box says what goes in it, what it holds and what it is not", /what the plant's internet connection shows the world/.test(modal) && /not a second factor/.test(modal) && /is not signed out/.test(modal) && /You are coming from 127\.0\.0\.1/.test(modal), modal);
  await p.fill("#nw-list", "the plant wifi"); await p.locator("#mcard button.go").click();
  await p.waitForFunction(() => document.getElementById("nw-msg").innerText.length > 0, null, { timeout: 5000 }).catch(() => {});
  t("something that is not an address is refused in the box, in words", /not an address/.test(await p.locator("#nw-msg").innerText()), await p.locator("#nw-msg").innerText());
  await p.fill("#nw-list", "203.0.113.0/24");
  await p.locator("#mcard button", { hasText: "Add the network I am on now" }).click();
  t("Add the network I am on now puts the admin's own address on its own line", (await p.inputValue("#nw-list")) === "203.0.113.0/24\n127.0.0.1/32");
  await p.locator("#mcard button.go").click();
  await p.waitForFunction(() => /203\.0\.113\.0\/24, 127\.0\.0\.1\/32/.test((document.querySelector('[data-safeguards="demo"]') || {}).innerText || ""), null, { timeout: 8000 }).catch(() => {});
  t("saved, the card lists them and offers Change", JSON.stringify((await demo()).access.networks) === JSON.stringify(["203.0.113.0/24", "127.0.0.1/32"]) && /Shared passwords work from:\s*203\.0\.113\.0\/24, 127\.0\.0\.1\/32/.test(await sec.innerText()) && await sec.locator("button", { hasText: "Change" }).isVisible());
  if (SHOTS) await p.locator('[data-company="demo"]').screenshot({ path: `${SHOTS}/safeguards-card-set.png` });
  await admin.post("/api/admin/companies/demo/safeguards", { networks: "", require_scan: false });

  // a company whose name carries an apostrophe and quotes: its buttons work, and the name is only ever text
  await admin.post("/api/admin/companies", { slug: "obrien", name: `O'Brien "Tool" <b>&</b> Die');window.__pwned=1;//` });
  await p.goto(`${BASE}/admin#companies/obrien`); await p.reload(); await p.waitForSelector('[data-company="obrien"]', { timeout: 15000 });
  await p.locator('[data-more="obrien"] > summary').click();
  await p.locator('[data-safeguards="obrien"] button', { hasText: "Limit to the plant's network" }).click();
  await p.waitForSelector("#nw-list", { state: "visible", timeout: 5000 }).catch(() => {});
  t("a company named with an apostrophe opens its network box, the name shown as it is and never run", /O'Brien "Tool" <b>&<\/b> Die'\);window\.__pwned=1;\/\//.test(await p.locator("#mcard h2").innerText().catch(() => "")) && (await p.evaluate(() => window.__pwned)) === undefined, await p.locator("#mcard").innerText().catch(() => "no box"));
  t("the box says the address is not proven on an instance with no edge check", /address a request claims is not proven/.test(await p.locator("#nw-unproven").innerText().catch(() => "")));
  await p.locator("#mcard button", { hasText: "Cancel" }).click();
  await p.locator('[data-company="obrien"] button', { hasText: "Floor PIN and passwords" }).click();   // "Set passwords" until the floor PIN (2026-10-29)
  t("so does Floor PIN and passwords, which had the same trouble", /Floor PIN for O'Brien/.test(await p.locator("#mcard h2").innerText().catch(() => "")) && (await p.evaluate(() => window.__pwned)) === undefined);
  await p.locator("#mcard button", { hasText: "Cancel" }).click();

  // ---- the Instance tab's card
  await admin.post("/api/admin/scan/sweep", {});
  await p.goto(`${BASE}/admin#instance`); await p.reload(); await p.waitForFunction(() => /Answering|not answering|No scanner/.test(document.getElementById("scan-line").innerText), null, { timeout: 15000 });
  const card = await p.locator("#scan-line").innerText();
  t("the Upload scanner card says it answers, with its engine and the day of its signatures", /Answering at 127\.0\.0\.1: engine 1\.4\.3, signatures 27784 of/.test(card) && /scanned again once its last scan is 7 days old/.test(card), card);
  await p.click("#scan-sweep");
  await p.waitForFunction(() => /scanned|Not run/.test(document.getElementById("scan-msg").innerText), null, { timeout: 8000 }).catch(() => {});
  t("Scan the stored files now says what it did", /\d+ scanned, \d+ clean, \d+ removed/.test(await p.locator("#scan-msg").innerText()), await p.locator("#scan-msg").innerText());
  if (SHOTS) await p.locator("#tab-instance").screenshot({ path: `${SHOTS}/safeguards-instance.png` });
  fake.down = true;
  await admin.post("/api/admin/scan/sweep", {});
  await p.reload(); await p.waitForFunction(() => /not answering|Answering|No scanner/.test(document.getElementById("scan-line").innerText), null, { timeout: 15000 });
  await sleep(300);
  t("with the scanner away the card turns red, and a pill in the header says so on every tab", /The scanner is not answering at 127\.0\.0\.1/.test(await p.locator("#scan-line").innerText()) && /Upload scanner/.test(await p.locator("header, .pills, body").first().innerText()) && await p.evaluate(() => document.getElementById("scan-line").className.includes("bad")));
  fake.down = false;

  // ---- what the floor sees of the mic switch (talking is off for demo since the first step)
  const supported = async (page) => page.evaluate(() => Boolean(window.SpeechRecognition || window.webkitSpeechRecognition));
  const openPanel = async (page) => { await page.goto(BASE + PAGE); await page.waitForSelector("#sos-fb-btn"); await sleep(800); if (await page.locator("#setup.on").count()) await page.locator("#setup button", { hasText: "Cancel" }).click(); await page.click("#sos-fb-btn"); await page.waitForSelector("#fbw-msg", { state: "visible" }); await sleep(900); };
  const tab = await ctxF.newPage(); watch(tab, "tablet");
  await openPanel(tab);
  const can = await supported(tab);
  t("with talking off, a tool's page offers no mic button", (await tab.locator("[data-dictate-btn]").count()) === 0 && await tab.evaluate(() => !window.Dictate || window.Dictate.allowed() === false));
  const policyOff = await tab.evaluate(() => { const fp = document.permissionsPolicy || document.featurePolicy; return fp ? fp.allowsFeature("microphone") : null; });
  t("and the browser has been told the microphone is not for this page", policyOff === false || policyOff === null, policyOff);
  // the same tablet, the same page held by its browser, as the switch moves: on, and off again
  await admin.post("/api/admin/companies/demo/safeguards", { talk: true });
  await openPanel(tab);
  const policyOn = await tab.evaluate(() => { const fp = document.permissionsPolicy || document.featurePolicy; return fp ? fp.allowsFeature("microphone") : null; });
  if (can) t("with talking back on, the mic button is there again and the browser lets the page have the microphone", (await tab.locator("[data-dictate-btn]").count()) >= 1 && await tab.evaluate(() => window.Dictate.allowed() === true) && policyOn !== false, { buttons: await tab.locator("[data-dictate-btn]").count(), policyOn });
  else t("with talking back on, the page is free to offer the mic (this browser cannot listen, so no button either way)", policyOn !== false && (await tab.locator("[data-dictate-btn]").count()) === 0);
  await admin.post("/api/admin/companies/demo/safeguards", { talk: false });
  await openPanel(tab);
  const policyOffAgain = await tab.evaluate(() => { const fp = document.permissionsPolicy || document.featurePolicy; return fp ? fp.allowsFeature("microphone") : null; });
  t("switched off again, the page the tablet already held loses the button and the microphone", (await tab.locator("[data-dictate-btn]").count()) === 0 && await tab.evaluate(() => !window.Dictate || window.Dictate.allowed() === false) && (policyOffAgain === false || policyOffAgain === null), { policyOffAgain });
  console.log(`   (speech recognition in this browser: ${can ? "yes" : "no"}; the page's microphone policy read back: ${policyOff} off, ${policyOn} on, ${policyOffAgain} off again)`);

  t("no script errors on any page", errors.length === 0, errors.join(" | "));
  await browser.close(); await fake.stop();
  R.done();
})().catch(R.abort);
