// End to end for the tool line and the QR codes (public/index.html, src/feedback.js, src/pageload.js; 2026-10-29).
// Brendan: each tool's line on the board is its name, Screens and Settings, with the rest in a popout; there is a path
// to a QR code for every screen of every tool, printable at a size picked per station; operators see only Feedback.
// What it proves: the QR address draws only a screen of the company's own tools; the board hands each screen's route
// and who it is for; the floor's /who says it is the floor; in a browser, the line holds only the name, Screens and
// Settings, the popout holds the rest, Screens has a QR codes view with a code per screen, a box for a one-of-many
// screen that changes the code, and a print sheet with each code at its size.
// Against a server ALREADY UP in fake-agent mode (run-all.sh has the line).
const { BASE, PW, runner, login, sleep } = require("./lib");
const R = runner(), t = R.t;

(async () => {
  const mgr = await login(PW.manager, "demo"), floor = await login(PW.floor, "demo");
  // ---- the QR address ----
  const raw = async (c, path) => { const r = await fetch(BASE + path, { headers: { Cookie: c.cookies().map((x) => `${x.name}=${x.value}`).join("; ") } }); return { status: r.status, type: r.headers.get("content-type") || "", text: await r.text() }; };
  const board = await raw(mgr, "/api/c/demo/qr.svg?px=200");
  t("the board's own code is drawn as before", board.status === 200 && /svg/.test(board.type));
  const scr = await raw(mgr, `/api/c/demo/qr.svg?px=300&path=${encodeURIComponent("/c/demo/m/paperline/station/3")}`);
  t("a code for one screen of the company's own tool is drawn", scr.status === 200 && /<svg/.test(scr.text) && /width="300"/.test(scr.text), scr.text.slice(0, 120));
  t("and it is not the board's code", scr.text !== board.text);
  const bad = [];
  for (const p of ["/c/other/m/paperline/", "/c/demo/settings", "https://evil.example/c/demo/m/paperline/", "/c/demo/m/paperline/../../admin", "/c/demo/m/paperline//x", "/c/demo/m/paperline/<script>", "/c/demo/m/" + "x".repeat(250)]) {
    const r = await raw(mgr, `/api/c/demo/qr.svg?path=${encodeURIComponent(p)}`); if (r.status !== 400) bad.push(`${p} -> ${r.status}`);
  }
  t("nothing outside the company's own tools' screens is drawn (another company, a settings page, an outside address, a climb)", bad.length === 0, bad);
  t("the floor can draw a code too (it is only an address)", (await raw(floor, `/api/c/demo/qr.svg?path=${encodeURIComponent("/c/demo/m/paperline/")}`)).status === 200);

  // ---- what the board hands the page ----
  const b = (await mgr.get("/api/c/demo/board")).json;
  const pl = ((b.pages || {}).paperline || {}).live || [];
  t("each screen carries its route beside its address and label", pl.length >= 3 && pl.every((x) => typeof x.route === "string" && typeof x.path === "string" && x.label) && pl.some((x) => x.route === "/station/:seq" && x.path === "/station/1"), pl);
  t("a screen with no tag says null, not a guess", pl.every((x) => x.for === null || x.for === "floor" || x.for === "office"));
  const pageload = require("../../src/pageload");
  const sp = pageload.screenPaths({ pages: { "/": { file: "a.html", label: "A", for: "office" }, "/bench/:id": { file: "b.html", label: "B", for: "floor", each: "/api/benches" }, "/x/:id": { file: "c.html", label: "C", for: "boss", each: "https://evil.example/" }, "/y": { file: "d.html", label: "D", each: "/api/ys" } }, smoke: ["/bench/2"] });
  t("the manifest's tag and list address pass through, checked", sp[0].for === "office" && sp[1].for === "floor" && sp[1].each === "/api/benches" && sp[1].path === "/bench/2" && sp[2].for === null && sp[2].each === null && sp[3].each === null, sp);
  const whoF = (await floor.get("/api/c/demo/who")).json, whoM = (await mgr.get("/api/c/demo/who")).json;
  t("/who tells the button whether this device is the floor's", whoF.device === "floor" && whoM.device === "manager", [whoF.device, whoM.device]);

  // ---- in a browser ----
  const { chromium } = require("playwright");
  const browser = await chromium.launch(process.env.SOS_CHROMIUM_PATH ? { executablePath: process.env.SOS_CHROMIUM_PATH } : {});
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await ctx.addCookies(mgr.cookies());
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(BASE + "/c/demo/"); await p.waitForSelector("#modules .modcard");
  const line = p.locator(".modcard", { hasText: "Paper Airplane Line" });
  const words = (await line.innerText()).replace(/\s+/g, " ").trim();
  t("a tool's line is its name, Screens and Settings, nothing else", /^Paper Airplane Line Screens · Settings$/.test(words), words);
  t("no version number, Open live, Diagrams or Versions on the line", (await line.locator("a").count()) === 0 && !/v\d|Open live|Diagrams|Versions|Ask/.test(words));
  await line.locator("button.vbtn", { hasText: "Settings" }).click();
  await p.waitForSelector("#tmenu");
  const menu = (await p.locator("#tmenu").innerText()).replace(/\s+/g, " ");
  t("Settings opens a popout with the rest: the version, Open live, Diagrams, Versions, Ask", /Paper Airplane Line, live v\d+/.test(menu) && /Open live/.test(menu) && /Diagrams/.test(menu) && /Versions/.test(menu) && /Ask about this tool/.test(menu), menu);
  t("its links go where the line's used to", (await p.locator('#tmenu a[href="/c/demo/m/paperline/"]').count()) === 1 && (await p.locator('#tmenu a[href="/c/demo/diagrams/paperline"]').count()) === 1);
  await p.mouse.click(5, 880);
  t("a click elsewhere closes it", (await p.locator("#tmenu").count()) === 0);
  await line.locator("button.vbtn", { hasText: "Settings" }).click(); await p.waitForSelector("#tmenu");
  await p.locator("#tmenu button", { hasText: "Versions" }).click();
  await p.waitForFunction(() => /v\d/.test((document.getElementById("vpanel") || {}).innerText || ""), null, { timeout: 8000 }).catch(() => {});
  t("Versions from the popout opens the versions panel and closes the popout", (await p.locator("#tmenu").count()) === 0 && /v\d/.test(await p.locator("#vpanel").innerText()));

  await line.locator("button.vbtn", { hasText: "Screens" }).click();
  await p.waitForSelector("#scr-root .scr-head");
  t("Screens opens the screens with a QR codes view beside them", (await p.locator("#scr-root .seg button", { hasText: "QR codes" }).count()) === 1);
  await p.locator("#scr-root .seg button", { hasText: "QR codes" }).click();
  await p.waitForSelector("#scr-root .qr-card");
  const cards = p.locator("#scr-root .qr-card");
  const n = await cards.count();
  t("a code for every screen of the tool", n === pl.length, [n, pl.length]);
  await p.waitForFunction(() => [...document.querySelectorAll(".qr-img")].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 8000 }).catch(() => {});
  t("every code is drawn", await p.evaluate(() => [...document.querySelectorAll(".qr-img")].every((i) => i.complete && i.naturalWidth > 0)));
  const station = cards.filter({ hasText: "Station page" });
  t("the one-of-many screen asks which one, starting from 1", (await station.locator("input").count()) === 1 && (await station.locator("input").inputValue()) === "1");
  const before = await station.locator("img").getAttribute("src");
  await station.locator("input").fill("4"); await sleep(500);
  const after = await station.locator("img").getAttribute("src");
  t("typing which one changes the code and the Open link", before !== after && /station%2F4/.test(after) && (await station.locator("a", { hasText: "Open" }).getAttribute("href")) === "/c/demo/m/paperline/station/4", [before, after]);
  await station.locator("select").selectOption("4.5");
  const [sheet] = await Promise.all([ctx.waitForEvent("page"), station.locator("button", { hasText: "Print" }).click()]);
  await sheet.waitForLoadState("domcontentloaded");
  await sheet.waitForFunction(() => [...document.images].every((i) => i.complete), null, { timeout: 8000 }).catch(() => {});
  const sh = await sheet.evaluate(() => ({ cards: document.querySelectorAll(".card").length, w: document.querySelector(".card img").style.width, text: document.body.innerText, ok: [...document.images].every((i) => i.naturalWidth > 0), src: document.querySelector(".card img").getAttribute("src") }));
  t("Print opens a sheet with that one code at the size picked, the company, the tool and the screen over it", sh.cards === 1 && sh.w === "4.5in" && /Demo Company · Paper Airplane Line/.test(sh.text) && /^4$/m.test(sh.text) && /Station page/.test(sh.text) && /floor PIN/.test(sh.text) && sh.ok && /station%2F4/.test(sh.src), sh);
  await sheet.close();
  const [all] = await Promise.all([ctx.waitForEvent("page"), p.locator("#scr-root .scr-head button", { hasText: /Print all/ }).click()]);
  await all.waitForLoadState("domcontentloaded");
  const allN = await all.evaluate(() => document.querySelectorAll(".card").length);
  t("Print all puts every code on the sheet", allN === n, allN);
  await all.close();
  await p.keyboard.press("Escape");
  t("Escape closes it", (await p.locator("#scr-root .scr-head").count()) === 0);

  // a phone
  const ph = await browser.newContext({ viewport: { width: 390, height: 800 } }); await ph.addCookies(mgr.cookies());
  const pp = await ph.newPage(); pp.on("pageerror", (e) => errors.push("phone: " + e.message));
  await pp.goto(BASE + "/c/demo/"); await pp.waitForSelector(".modtoggle"); await pp.click(".modtoggle");
  const pline = pp.locator(".modcard", { hasText: "Paper Airplane Line" });
  await pline.locator("button.vbtn", { hasText: "Settings" }).click(); await pp.waitForSelector("#tmenu");
  const box = await pp.locator("#tmenu").boundingBox();
  t("on a phone the popout fits the screen", box && box.x >= 0 && box.x + box.width <= 390, box);
  await browser.close();
  t("no page errors", errors.length === 0, errors);
  R.done();
})().catch(R.abort);
