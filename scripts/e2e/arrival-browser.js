// Headless browser pass for propose on arrival: point at it, add a photo, the proposer's one question on the
// screen and in My requests, the manager's card (question, flag, asked N times, not the same), the two switches on
// the Agent settings page, the credit line on /admin, and what a module page may and may not reach. Same server as
// arrival.js (fake agent, passwords on, SOS_AUTO_PROPOSE_PER_HOUR=500), on a fresh database or after arrival.js.
//   node scripts/e2e/arrival-browser.js
const { BASE, PW, sleep, runner, login, person, waitFor, board, fbRow } = require("./lib");
const { chromium } = require("playwright");
const R = runner(), t = R.t;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAFklEQVR4nGP8z4AdMOEQHzgJRnq4CgB1LQEPfJc1CAAAAABJRU5ErkJggg==", "base64");

(async () => {
  const mgr = await login(PW.manager, "demo"), floor = await login(PW.floor, "demo"), anon = await login(PW.floor, "demo"), admin = await login(PW.admin, "");
  const ana = await person(mgr, "demo", "Ana R", "floor");
  await floor.post("/api/c/demo/who/sign-in", { id: ana.id, pin: ana.pin });
  await mgr.post("/api/c/demo/agents/arrival", { auto_propose: true, allow_photos: true });
  const PAGE = "/c/demo/m/paperline/";
  const read = (id) => waitFor(`request ${id} to be read`, async () => { const x = await fbRow(mgr, id); return x && x.arrival !== "proposing" ? x : null; });
  const newest = async (pred) => (await board(mgr)).feedback.filter(pred).sort((a, b) => b.id - a.id)[0];

  const browser = await chromium.launch();
  const errors = [];
  const watch = (page, who) => { page.on("pageerror", (e) => errors.push(`${who}: ${e.message}`)); page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|Refused to connect|violates the following Content Security Policy/.test(m.text())) errors.push(`${who} console: ${m.text()}`); }); };
  const ctxF = await browser.newContext({ viewport: { width: 1024, height: 768 } }); await ctxF.addCookies(floor.cookies());
  const ctxA = await browser.newContext({ viewport: { width: 1024, height: 768 } }); await ctxA.addCookies(anon.cookies());
  const ctxM = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await ctxM.addCookies(mgr.cookies());
  const ctxAd = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await ctxAd.addCookies(admin.cookies());

  // ---- Ana's tablet: point at it, add a photo, send, get ONE question back on the same screen
  const tab = await ctxF.newPage(); watch(tab, "tablet");
  await tab.goto(BASE + PAGE); await tab.waitForSelector("#sos-fb-btn"); await sleep(800);
  // a fresh demo line opens its own setup sheet over the whole page; put it away so there is a page to point at
  if (await tab.locator("#setup.on").count()) await tab.locator("#setup button", { hasText: "Cancel" }).click();
  await tab.click("#sos-fb-btn");
  t("the feedback panel offers Point at it and Add a photo", (await tab.locator("#fbw-point").count()) === 1 && (await tab.locator("#fbw-photo").count()) === 1);
  await tab.click("#fbw-point");
  t("pointing puts a pane over the page and hides the panel", (await tab.locator("#sos-point").count()) === 1 && !(await tab.locator("#fbw-msg").isVisible()));
  const h1 = await tab.locator("h1").first().boundingBox();
  const before = await tab.evaluate(() => document.body.innerText.length);
  await tab.mouse.move(h1.x + 10, h1.y + 8); await tab.mouse.click(h1.x + 10, h1.y + 8);
  await tab.waitForSelector("#fbw-pointed");
  t("after the tap the panel is back and says what is pointed at", (await tab.locator("#fbw-msg").isVisible()) && /Pointing at: Paper Airplane Line/.test(await tab.locator("#fbw-pointed").innerText()) && (await tab.locator("#sos-point").count()) === 0);
  await tab.click("#fbw-unpoint");
  t("it can be taken off again", (await tab.locator("#fbw-pointed").count()) === 0 && (await tab.locator("#fbw-point").count()) === 1);
  await tab.click("#fbw-point"); await tab.keyboard.press("Escape");
  t("Escape cancels pointing", (await tab.locator("#sos-point").count()) === 0 && (await tab.locator("#fbw-pointed").count()) === 0);
  await tab.click("#fbw-point"); await tab.mouse.click(h1.x + 10, h1.y + 8); await tab.waitForSelector("#fbw-pointed");
  await tab.setInputFiles("#fbw-file", { name: "jam.png", mimeType: "image/png", buffer: PNG });
  await tab.waitForSelector("#fbw-photo-on");
  t("a photo is added, scaled on the device", (await tab.locator("#fbw-photo-on").count()) === 1 && (await tab.locator("#fbw-photo").count()) === 0);
  await tab.fill("#fbw-msg", "ASKME make this one bigger");
  await tab.click("#fbw-send");
  await tab.waitForSelector("#sos-question", { timeout: 12000 });
  const qText = await tab.locator("#sos-question").innerText();
  t("the question comes back on the screen she is standing at, with her words and answers to tap", /One quick question/.test(qText) && /ASKME make this one bigger/.test(qText) && /Which one do you mean\?/.test(qText) && (await tab.locator("#sos-question [data-option]").count()) === 2 && /Say it in my own words/.test(qText));
  const A1 = await newest((f) => /ASKME make this one bigger/.test(f.message));
  t("what she pointed at and the photo went with the request", A1.element && A1.element.tag === "h1" && /Paper Airplane Line/.test(A1.element.text) && A1.photo_id > 0 && A1.name === "Ana R", A1 && A1.element);
  t("the panel is clean for the next request", (await tab.locator("#fbw-pointed, #fbw-photo-on").count()) === 0);
  await tab.locator("#sos-question button", { hasText: "Later" }).click();
  t("Later takes the card away", (await tab.locator("#sos-question").count()) === 0);
  await tab.reload(); await tab.waitForSelector("#sos-fb-btn"); await sleep(1500);
  t("and it stays away for this sitting", (await tab.locator("#sos-question").count()) === 0);
  await tab.click("#sos-fb-btn"); await tab.waitForSelector("#fbw-mine-open");
  t("My requests carries a badge for it", /1 to check/.test(await tab.locator("#fbw-mine").innerText()));
  await tab.click("#fbw-mine-open"); await tab.waitForSelector(`[data-request="${A1.id}"] [data-option]`);
  t("My requests shows the question with the answers", /One quick question/.test(await tab.locator(`[data-request="${A1.id}"] [data-line]`).innerText()) && /Which one do you mean/.test(await tab.locator(`[data-request="${A1.id}"] [data-qtext]`).innerText()));
  await tab.locator(`[data-request="${A1.id}"] [data-option="0"]`).click();
  await waitFor("the row to move on", async () => !/One quick question/.test(await tab.locator(`[data-request="${A1.id}"] [data-line]`).innerText().catch(() => "One quick question")));
  const a1 = await waitFor("the proposal", async () => { const x = await fbRow(mgr, A1.id); return x.status === "reviewing" ? x : null; });
  t("one tap answers it and the proposal is drafted with the answer, the element and the photo", /Answer received: The count on the left/.test(a1.proposal_rationale) && /Pointed element received: <h1/.test(a1.proposal_rationale) && /Photo received \(1\)/.test(a1.proposal_rationale), a1.proposal_rationale);

  // ---- a tablet nobody is signed in on: the device that sent it is asked, across a reload, and answers in its own words
  const tab2 = await ctxA.newPage(); watch(tab2, "nameless tablet");
  await tab2.goto(BASE + PAGE); await tab2.waitForSelector("#sos-fb-btn"); await sleep(600);
  await tab2.click("#sos-fb-btn"); await tab2.fill("#fbw-msg", "ASKME that thing is hard to read"); await tab2.click("#fbw-send");
  await tab2.waitForSelector("#sos-question", { timeout: 12000 });
  await tab2.reload(); await tab2.waitForSelector("#sos-question", { timeout: 8000 });
  t("the nameless device is asked, and still asked after a reload", (await tab2.locator("#sos-question [data-option]").count()) === 2);
  await tab2.locator("#sos-question [data-own]").click();
  await tab2.locator("#sos-question [data-own-text]").fill("the clip count, from across the aisle");
  await tab2.locator("#sos-question [data-own-send]").click();
  await waitFor("the card to go", async () => (await tab2.locator("#sos-question").count()) === 0);
  const A2 = await newest((f) => /that thing is hard to read/.test(f.message));
  const a2 = await waitFor("the proposal", async () => { const x = await fbRow(mgr, A2.id); return x.status === "reviewing" ? x : null; });
  t("its own words reach the proposer", /Answer received: the clip count, from across the aisle/.test(a2.proposal_rationale) && a2.question.via === "device");
  // the same thing someone already asked for
  const rootId = (await anon.post("/api/feedback", { company: "demo", module: "paperline", page: PAGE, message: "show the order due time" })).json.id; await read(rootId);
  await tab2.click("#sos-fb-btn").catch(() => {}); if (!(await tab2.locator("#fbw-msg").isVisible())) await tab2.click("#sos-fb-btn");
  await tab2.fill("#fbw-msg", "DUPE when is each order due"); await tab2.click("#fbw-send");
  const said = await waitFor("the banner", async () => { const x = await tab2.evaluate(() => [...document.querySelectorAll("body > div")].map((d) => d.textContent).find((x) => /Someone already asked for this/.test(x)) || null); return x; }, 12000);
  t("a repeat is told it was added to the first request", new RegExp(`added to request #${rootId}`).test(said), said);
  const D1 = (await anon.post("/api/feedback", { company: "demo", module: "paperline", page: PAGE, message: "DUPE due times please", name: "Cy" })).json;
  await waitFor("the second fold", async () => ((await fbRow(mgr, rootId)).dupes || []).length === 2);

  // ---- what a module page may and may not reach (the page policy)
  const A3 = (await floor.post("/api/feedback", { company: "demo", module: "paperline", page: PAGE, message: "ASKME the policy one" })).json; await read(A3.id);
  const mp = await ctxM.newPage();   // a MANAGER's browser on a module page: agent-written code would run with this session
  await mp.goto(BASE + PAGE); await mp.waitForSelector("#sos-fb-btn");
  const reach = await mp.evaluate(async (id) => {
    const tryIt = async (url, method) => { try { const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: method === "POST" ? JSON.stringify({ answer: "x" }) : undefined }); return r.status; } catch (e) { return "blocked"; } };
    return { answer: await tryIt(`/api/feedback/${id}/answer`, "POST"), unlink: await tryIt(`/api/feedback/${id}/unlink`, "POST"), settings: await tryIt("/api/c/demo/agents/arrival", "POST"), credit: await tryIt("/api/admin/credit", "GET"), question: await tryIt(`/api/c/demo/who/question?id=${id}`, "GET") };
  }, A3.id);
  t("a module page cannot reach the manager's answer, the unlink, the switches or the credit routes", reach.answer === "blocked" && reach.unlink === "blocked" && reach.settings === "blocked" && reach.credit === "blocked", reach);
  t("it can reach the question route, which answers only the person who asked", reach.question === 404, reach);
  t("and the question was not answered by any of that", !(await fbRow(mgr, A3.id)).question.answer);

  // ---- the manager's board
  const N1 = (await floor.post("/api/feedback", { company: "demo", module: "paperline", page: PAGE, message: "NOTTHISTOOL the dock door sticks" })).json; await read(N1.id);
  const b = await ctxM.newPage(); watch(b, "board");
  b.on("dialog", (d) => d.accept());
  await b.goto(BASE + "/c/demo/"); await b.waitForSelector("#col-new .card, #col-reviewing .card");
  for (const col of ["#col-new", "#col-reviewing"]) await b.locator(`${col} button`, { hasText: "Show the other" }).click().catch(() => {});
  const qCard = b.locator(`[data-key="fb:${A3.id}"]`);
  t("a waiting question is on the card, with the answers as buttons and a way past it", (await qCard.locator(".askbox").count()) === 1 && /Which one do you mean\?/.test(await qCard.innerText()) && (await qCard.locator(".askbox button.opt").count()) === 2 && /Propose anyway/.test(await qCard.innerText()) && !/Review with AI/.test(await qCard.innerText()));
  await qCard.locator("a", { hasText: "answer in my own words" }).click();
  await b.fill(`#ans-${A3.id}`, "she means the takt clock");
  await sleep(5200);
  t("the manager's own words survive the board's reload", (await b.inputValue(`#ans-${A3.id}`)) === "she means the takt clock");
  await qCard.locator("button", { hasText: "Send the answer" }).click();
  await b.waitForSelector(`#col-reviewing [data-key="fb:${A3.id}"] .prop`, { timeout: 10000 });
  t("answering moves it to a drafted proposal that shows what was asked and answered", /Asked first: "Which one do you mean\?" Answer from .*: "she means the takt clock"/.test(await b.locator(`[data-key="fb:${A3.id}"]`).innerText()), await b.locator(`[data-key="fb:${A3.id}"]`).innerText());
  const flag = b.locator(`[data-key="fb:${N1.id}"]`);
  // one button for what the card waits on, Decline under "more" (the board simplification, 2026-09-20)
  t("a flagged request says what it is in one sentence and offers Propose anyway, with Decline under more", /NOT ABOUT THIS TOOL/.test(await flag.innerText()) && /about the building/.test(await flag.innerText()) && /Propose anyway/.test(await flag.innerText()) && (await flag.locator("details.more button", { hasText: "Decline" }).count()) === 1);
  await flag.locator("button", { hasText: "Propose anyway" }).click();
  await b.waitForSelector(`#col-reviewing [data-key="fb:${N1.id}"] .prop`, { timeout: 10000 });
  t("Propose anyway drafts one and the flag is gone", !/NOT ABOUT THIS TOOL/.test(await b.locator(`[data-key="fb:${N1.id}"]`).innerText()));
  const rootCard = b.locator(`[data-key="fb:${rootId}"]`);
  t("repeats are one card that says how often and by how many", /Asked 3 times by \d people/.test(await rootCard.locator("details.asked summary").innerText()) && (await b.locator(`[data-key="fb:${D1.id}"]`).count()) === 0);
  await rootCard.locator("details.asked summary").click();
  await sleep(4800);
  t("the opened list survives the reload and carries the other wordings", (await rootCard.locator("details.asked[open]").count()) === 1 && /DUPE due times please/.test(await rootCard.innerText()) && /Cy/.test(await rootCard.innerText()));
  await rootCard.locator(".dupe", { hasText: "DUPE due times please" }).locator("a", { hasText: "not the same" }).click();
  // a column shows three tiles and folds the rest: open whatever is folded before looking for the card
  await waitFor("its own card", async () => { for (const col of ["#col-new", "#col-reviewing"]) { const more = b.locator(`${col} button`, { hasText: "Show the other" }); if (await more.count()) await more.first().click().catch(() => {}); } return (await b.locator(`[data-key="fb:${D1.id}"]`).count()) === 1; }, 15000);
  t("not the same makes it its own card again", /Asked 2 times/.test(await rootCard.locator("details.asked summary").innerText()) && (await b.locator(`[data-key="fb:${D1.id}"]`).count()) === 1);
  await b.locator("#col-reviewing button", { hasText: "Show the other" }).click().catch(() => {});
  const pCard = b.locator(`[data-key="fb:${A1.id}"]`);
  t("the card keeps one quiet line for what was pointed at, and a photo link for the manager", /pointed at "Paper Airplane Line"/.test(await pCard.locator(".pointed").first().innerText()) && (await pCard.locator(`.pointed a[href="/api/attachments/${A1.photo_id}"]`).count()) === 1);
  const fb = await ctxF.newPage(); watch(fb, "floor board");
  await fb.goto(BASE + "/c/demo/"); await fb.waitForSelector("#col-reviewing .card");
  await fb.locator("#col-reviewing button", { hasText: "Show the other" }).click().catch(() => {});
  t("a floor device sees no photo link, no answer buttons, no not-the-same", (await fb.locator(`a[href^="/api/attachments/"]`).count()) === 0 && (await fb.locator(".askbox button, details.asked a.leftlink").count()) === 0);

  // ---- the two switches, on the manager's Settings page (people, printers and spreadsheets, the wall sign, arrival)
  const ag = await ctxM.newPage(); watch(ag, "settings");
  await ag.goto(BASE + "/c/demo/settings"); await ag.waitForSelector("#a-auto");
  await sleep(600);
  t("Settings shows both switches on, the wall sign and the way to people and connections", (await ag.isChecked("#a-auto")) && (await ag.isChecked("#a-photos")) && (await ag.locator("#qr").count()) === 1 && (await ag.locator('a[href="/c/demo/people"]').count()) === 1 && (await ag.locator('a[href="/c/demo/connections"]').count()) === 1);
  await ag.uncheck("#a-photos"); await ag.waitForFunction(() => document.getElementById("a-ok").textContent === "saved");
  t("unticking photos saves", (await floor.get("/api/c/demo/who")).json.photos === false);
  await tab.reload(); await tab.waitForSelector("#sos-fb-btn"); await sleep(1000); await tab.click("#sos-fb-btn");
  t("then the tablet offers no photo button, and still offers pointing", (await tab.locator("#fbw-photo").count()) === 0 && (await tab.locator("#fbw-point").count()) === 1);
  await ag.check("#a-photos"); await ag.waitForFunction(() => document.getElementById("a-ok").textContent === "saved");
  await ag.uncheck("#a-auto"); await sleep(800);
  t("unticking read-at-once saves", (await mgr.get("/api/c/demo/agents")).json.company.auto_propose === false);
  await ag.check("#a-auto"); await sleep(800);

  // ---- the platform board itself offers no pointing (nothing there goes to the proposer)
  const pb = await ctxM.newPage(); await pb.goto(BASE + "/c/demo/"); await pb.waitForSelector("#sos-fb-btn"); await pb.click("#sos-fb-btn");
  t("the board's own feedback button has no point or photo", (await pb.locator("#fbw-point, #fbw-photo").count()) === 0);

  // ---- /admin: the credit line
  const ad = await ctxAd.newPage(); watch(ad, "admin");
  await ad.goto(BASE + "/admin"); await ad.waitForSelector("#credit-line");
  const line0 = await ad.locator("#credit").innerText();
  await ad.locator("#credit a", { hasText: /balance/ }).click();
  await ad.fill("#cr-bal", "80"); await ad.locator("#mcard button", { hasText: "Save" }).click();
  await ad.waitForFunction(() => /About \$80\.00 left/.test(document.getElementById("credit-line").textContent), null, { timeout: 8000 });
  t("the admin enters the balance and reads the projection", /AI credit/.test(line0) && /About \$80\.00 left/.test(await ad.locator("#credit-line").innerText()));
  t("loop health carries what the proposer did on arrival", /proposed on arrival/.test(await ad.locator("#h-table").innerText()));

  t("no script errors on any page", errors.length === 0, errors.join(" | "));
  await browser.close();
  R.done();
})().catch(R.abort);
