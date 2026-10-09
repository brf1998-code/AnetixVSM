// Headless browser pass for Ask Anetix (public/assets/assist.js on the board, src/assist.js). Same server and environment
// as assist.js (fake agent, passwords on), on a FRESH database:
//   node scripts/e2e/assist-browser.js            (SOS_SHOTS=<dir> also saves screenshots of each state)
// What a manager sees: the button in the band, the chips, the starters filling the box, an answer with its steps,
// Looked at line and Show me button, the request card sent to Reviewing and the chip on the board's card; a phone;
// a demo's set answer; and that the floor sees none of it.
const fs = require("fs");
const path = require("path");
const { BASE, PW, runner, login, waitFor, board } = require("./lib");
const { chromium } = require("playwright");
const { q, pool } = require("../../src/db");
const R = runner(), t = R.t;
const SHOTS = process.env.SOS_SHOTS || null;
const shot = async (page, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }); } };

(async () => {
  const admin = await login(PW.admin, "demo");
  const made = await admin.post("/api/admin/companies", { slug: "brow", name: "Brow Works" });
  await q("INSERT INTO platform.sites (id, company, stage, standing, rollover) VALUES ($1,'brow','subscribed','good', jsonb_build_object('done_at', now()))", [require("crypto").randomUUID()]);
  for (const m of ["paperline", "kpis"]) await admin.post("/api/admin/companies/brow/modules", { module: m });
  const mgr = await login(made.json.passwords.manager, "brow");
  const floor = await login(made.json.passwords.floor, "brow");
  const demoMgr = await login(PW.manager, "demo");
  const browser = await chromium.launch();

  // ---- a manager on a computer -------------------------------------------------------------------------------
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await ctx.addCookies(mgr.cookies());
  const page = await ctx.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${BASE}/c/brow/`);
  await page.waitForSelector("#ax-btn", { timeout: 15000 });
  t("the band has an Ask Anetix button for a manager", await page.isVisible("#ax-btn"));
  t("each tool on the band has an Ask link", (await page.locator(".modcard button.vbtn", { hasText: "Ask" }).count()) === 2);
  await page.click("#ax-btn");
  await page.waitForSelector(".ax:not([hidden]) .ax-chips button");
  const chips = await page.locator(".ax-chips button").allInnerTexts();
  t("the chips: Anetix help, both tools, Whole company", chips[0] === "Anetix help" && chips.includes("Paper Airplane Line") && chips.includes("Plant KPIs") && chips[chips.length - 1] === "Whole company", chips);
  t("it opens on Whole company", (await page.locator(".ax-chips button.on").innerText()) === "Whole company");
  t("on a wide screen the board moves over beside it", await page.evaluate(() => getComputedStyle(document.body).paddingRight === "430px"));
  t("the disclosure says it is AI and can be wrong", /Anetix's AI\. It can be wrong/.test(await page.locator(".ax-note").innerText()));
  t("a live site shows no demo line", !/Demo/.test(await page.locator(".ax-note").innerText()));
  await shot(page, "1-open");
  await page.locator(".ax-start button").first().click();
  t("a starter fills the box and sends nothing", (await page.inputValue(".ax-f textarea")) === "What should we improve next?" && (await page.locator(".ax-u").count()) === 0);
  await page.fill(".ax-f textarea", "What tools do we have? [[list_tools]]");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".ax-a .ax-looked", { timeout: 20000 });
  t("the question shows, then the answer", (await page.locator(".ax-u").innerText()).includes("What tools do we have?") && /Paper Airplane Line/.test(await page.locator(".ax-a").last().innerText()));
  t("the Looked at line under it", /Looked at:\s*Your tools/.test(await page.locator(".ax-looked").last().innerText()), await page.locator(".ax-looked").last().innerText());
  await page.locator("[data-down]").last().click();
  await page.waitForSelector("[data-why]");
  await page.fill("[data-why]", "too long");
  await page.click("[data-save]");
  await page.waitForSelector(".ax-th .ok");
  t("an answer can be rated down with a reason", (await q("SELECT thumbs_reason FROM platform.assist_messages WHERE company='brow' AND thumbs=-1")).rows[0].thumbs_reason === "too long");

  // a tool chip, Show me, and a request card sent to Reviewing
  await page.locator(".ax-chips button", { hasText: "Paper Airplane Line" }).click();
  t("a new chip starts a fresh conversation with its own starters", (await page.locator(".ax-u").count()) === 0 && /Walk me through this tool/.test(await page.locator(".ax-start").innerText()));
  await page.fill(".ax-f textarea", '[[show_on_screen {"step":2}]] [[draft_request {"what":"Make the shift timer on the line board twice as big so it reads from the stations.","why":"Station 3 cannot read it.","screen":"Line board"}]]');
  await page.click(".ax-f .send");
  await page.waitForSelector(".ax-card [data-file]", { timeout: 20000 });
  const show = page.locator(".ax-show a").first();
  t("a Show me button opens the tool at the tour step", /Show me: One tile per station/.test(await show.innerText()) && /\/c\/brow\/m\/paperline\/\?tour=1&step=2$/.test(await show.getAttribute("href")));
  t("the card names the tool and the screen, and the words can be changed", /Paper Airplane Line · Line board/.test(await page.locator(".ax-card .t").innerText()) && (await page.inputValue(".ax-card textarea")).startsWith("Make the shift timer"));
  t("the card says nothing is built until it is approved", /Nothing is built until it is approved/.test(await page.locator(".ax-card").innerText()));
  await shot(page, "2-card");
  await page.fill(".ax-card textarea", "Make the shift timer on the line board twice as big, readable from every station.");
  await page.click(".ax-card [data-file]");
  await page.waitForSelector(".ax-card.done", { timeout: 10000 });
  const sentId = Number((/#(\d+)/.exec(await page.locator(".ax-card.done").innerText()) || [])[1]);
  t("Send to Reviewing: the card says it was sent, with its number", sentId > 0);
  const f = (await q("SELECT * FROM platform.feedback WHERE id=$1", [sentId])).rows[0];
  t("the request went in with the words as changed on the card", f && f.source === "assistant" && /every station/.test(f.message));
  await waitFor("it to land in Reviewing", async () => { const x = (await board(mgr, "brow")).feedback.find((y) => y.id === sentId); return x && x.status === "reviewing" ? x : null; });
  await page.click("[data-a=close]");
  await page.waitForFunction((id) => [...document.querySelectorAll(".card .meta")].some((m) => m.textContent.includes(`#${id}`) && m.textContent.includes("FROM A CONVERSATION")), sentId, { timeout: 15000 });
  t("the board's card says it came from a conversation", true);
  await page.locator(".chip.convo").first().click();
  await page.waitForSelector(".ax:not([hidden]) .ax-card.done");
  t("the chip opens that conversation", (await page.locator(".ax-u").count()) >= 1);
  await shot(page, "3-board");

  // the panel comes back after a reload, on the same conversation
  await page.reload();
  await page.waitForSelector(".ax:not([hidden]) .ax-card.done", { timeout: 15000 });
  t("a reload keeps the panel and the conversation", true);
  await page.click("[data-a=hist]");
  await page.waitForSelector(".ax-hist button");
  t("History lists the conversations", (await page.locator(".ax-hist button").count()) >= 2);
  await page.keyboard.press("Escape");
  t("Escape closes it", await page.locator(".ax").isHidden());
  t("no script errors on the board", !errors.length, errors);

  // ?ask=<tool> opens on that tool
  await page.goto(`${BASE}/c/brow/?ask=kpis`);
  await page.waitForSelector(".ax:not([hidden]) .ax-chips button.on");
  t("?ask= opens the panel on that tool", (await page.locator(".ax-chips button.on").innerText()) === "Plant KPIs" && !/ask=/.test(page.url()));

  // ---- a phone -----------------------------------------------------------------------------------------------
  const phone = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true }); await phone.addCookies(mgr.cookies());
  const pp = await phone.newPage();
  await pp.goto(`${BASE}/c/brow/`);
  await pp.waitForSelector("#ax-btn");
  await shot(pp, "4a-phone-board");
  const bandOk = await pp.evaluate(() => { const b = document.getElementById("ax-btn").getBoundingClientRect(); return b.width > 0 && b.right <= window.innerWidth + 1; });
  t("on a phone the button fits in the band", bandOk);
  await pp.click("#ax-btn");
  await pp.waitForSelector(".ax:not([hidden])");
  const box = await pp.locator(".ax").boundingBox();
  t("on a phone the panel takes the whole screen", box && box.width >= 389 && box.x <= 1, box);
  t("and the page does not scroll sideways", await pp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await shot(pp, "4-phone");

  // ---- a demo ----------------------------------------------------------------------------------------------------
  const dctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await dctx.addCookies(demoMgr.cookies());
  const dp = await dctx.newPage();
  await dp.goto(`${BASE}/c/demo/`);
  await dp.waitForSelector("#ax-btn");
  await dp.click("#ax-btn");
  await dp.waitForSelector(".ax:not([hidden]) .ax-note");
  t("a demo's panel says it gives set answers", /Demo: set answers/.test(await dp.locator(".ax-note").innerText()));
  await dp.fill(".ax-f textarea", "What should we improve next?");
  await dp.keyboard.press("Enter");
  await dp.waitForSelector(".ax-set");
  t("a demo's answer is marked as a set answer and says what it would do", /SET ANSWER/.test(await dp.locator(".ax-a").last().innerText()) && /not switched on in a demo/.test(await dp.locator(".ax-a").last().innerText()));
  t("a set answer has no rating buttons", (await dp.locator(".ax-a").last().locator("[data-up]").count()) === 0);
  await shot(dp, "5-demo");

  // ---- the floor ---------------------------------------------------------------------------------------------
  const fctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await fctx.addCookies(floor.cookies());
  const fp = await fctx.newPage();
  await fp.goto(`${BASE}/c/brow/`);
  await fp.waitForSelector("#col-new", { timeout: 15000 });
  await fp.waitForTimeout(1500);
  t("the floor sees no Ask Anetix button", (await fp.locator("#ax-btn").count()) === 0);
  t("and no Ask link on the tools", (await fp.locator(".modcard button.vbtn", { hasText: "Ask" }).count()) === 0);

  await browser.close();
  await pool.end();
  R.done();
})().catch(R.abort);
