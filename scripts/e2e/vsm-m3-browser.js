// In a browser, VSM M3 and the floor's line (public/map.html, public/index.html, public/agent-board.html,
// public/assets/feedback-widget.js). Runs right after scripts/e2e/vsm-m3.js on the same server and database: the map
// "planes", its kept future state, the Line agent with its line on and one open flag on the Assembly box's station screen.
// What it proves: a burst shows its words, then becomes a plant request in the words sent, and its star turns green; a box's ask form files a change to
// its tool, and a new tool request opens on the board with its popout; the future state is a tab beside the current
// state, with no agent chips, and drafting it again opens the new draft; the editor picks a box's station screen; the
// board filters by box, shows a plant request's own buttons and takes it to Working on it, and links back to the box on
// the map; the QR codes tab tags a screen; the agent board takes the line off the floor and puts it back; on a phone,
// the floor's station screen shows the line, opens it, and nowhere else; no page throws.
//   NODE_PATH=<global node_modules> node scripts/e2e/vsm-m3-browser.js   (after vsm-m3.js)
const { PW, runner, login, waitFor } = require("./lib");
const { q } = require("../../src/db");
const R = runner(), t = R.t;
const BASE = process.env.SOS_E2E_BASE || "http://127.0.0.1:3999";
const A = "/api/c/demo/vsm";

(async () => {
  const { chromium } = require("playwright");
  const mgr = await login(PW.manager, "demo"), floor = await login(PW.floor, "demo");
  const b = await chromium.launch();
  const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addCookies(mgr.cookies());
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  p.on("dialog", (d) => d.accept());

  // ---- a burst to a plant request, in one tap
  await p.goto(`${BASE}/c/demo/map?mapkey=planes&box=ship`);
  await p.waitForSelector(".detail h2");
  t("the board's link opens the map on its box", (await p.textContent(".detail h2")).trim() === "Ship");
  const ship = (await q("SELECT k.id FROM platform.vsm_kaizen k JOIN platform.vsm_maps m ON m.id=k.map_id WHERE m.key='planes' AND k.n=3")).rows[0].id;
  await p.click(`.detail [data-act="kz-file"][data-z="${ship}"][data-as="plant"]`);
  await p.waitForSelector("#kzform #kzwords");
  t("a burst shows its words before it is filed (the VSM audit, round 2)", /^A shipping log/.test(await p.$eval("#kzwords", (x) => x.value)) && /A plant request/.test(await p.textContent("#kzform")) && !(await q("SELECT feedback_id FROM platform.vsm_kaizen WHERE id=$1", [ship])).rows[0].feedback_id);
  await p.click('#kzform [data-act="kz-cancel"]');
  t("Cancel leaves it a burst", !(await p.$("#kzform")) && Boolean(await p.$(`.detail [data-act="kz-file"][data-z="${ship}"]`)));
  await p.click(`.detail [data-act="kz-file"][data-z="${ship}"][data-as="plant"]`);
  await p.fill("#kzwords", "A shipping log by the door");
  await p.click('#kzform button[type="submit"]');
  await p.waitForSelector(`.detail .burst .stw`);
  t("sent, it becomes a plant request in the words sent, and says so on the box", (await q("SELECT f.message FROM platform.vsm_kaizen k JOIN platform.feedback f ON f.id=k.feedback_id WHERE k.id=$1", [ship])).rows[0].message === "A shipping log by the door" && /a plant request: new/.test(await p.textContent(".detail .burst .stw")) && Boolean(await p.$('.host .kz.done[data-node="ship"]')));
  t("the box lists it under On the Kaizen board", /A shipping log by the door/.test(await p.textContent(".detail .cards")));

  // ---- the ask form on a box
  await p.click('.host .node[data-node="asm"]');
  await p.click('[data-act="ask"]');
  await p.fill("#askwords", "Show the next job number big on the station screen");
  t("a box with a tool offers a change to it first", await p.isChecked('#askform input[value="change|paperline"]'));
  await p.click('#askform button[type="submit"]');
  await p.waitForFunction(() => /Show the next job number big/.test((document.querySelector(".detail .cards") || {}).textContent || ""));
  const asked = (await q("SELECT module, node_key, source FROM platform.feedback WHERE message LIKE 'Show the next job number big%'")).rows[0];
  t("the ask form files a change to the box's tool, on that box", asked && asked.module === "paperline" && asked.node_key === "asm" && asked.source === "map", asked);
  await p.click('.host .node[data-node="kit"]');
  await p.click('[data-act="ask"]');
  await p.fill("#askwords", "A board for kits");
  await p.check('#askform input[value="new_tool"]');
  await Promise.all([p.waitForURL(/\?intake=\d+/), p.click('#askform button[type="submit"]')]);
  await p.waitForSelector("#intake-root .ik-box");
  const iid = Number(new URL(p.url()).searchParams.get("intake"));
  t("a new tool for a box opens its request on the board, with the box's answers in", Boolean(iid) && /A board for kits/.test((await q("SELECT answers FROM platform.module_intakes WHERE id=$1", [iid])).rows[0].answers.purpose));
  await mgr.post(`/api/intakes/${iid}/abandon`);

  // ---- the future state beside the current one
  await p.goto(`${BASE}/c/demo/map?mapkey=planes`);
  await p.waitForSelector(".host .node");
  await p.click('.seg button:has-text("Future state")');
  await p.waitForSelector(".futurebar");
  t("the future state is a tab beside the current state, kept", /Kept/.test(await p.textContent(".futurebar")) && /future state/.test(await p.textContent(".maphead")));
  t("no agent watches it, so it shows no agent chips", !(await p.$(".host .agent")));
  await p.click('.futurebar [data-act="fs-draft"]');
  // run-all starts the server with SOS_FAKE_FUTURE_MS, so the draft takes a moment and the page has to wait for it
  if (Number(process.env.SOS_FAKE_FUTURE_MS || 0) > 0) t("while the agent drafts, the map says so", await p.waitForSelector("text=The agent is drafting the future state", { timeout: 4000 }).then(() => true).catch(() => false));
  await p.waitForFunction(() => /The agent's draft of the future state/.test((document.querySelector(".futurebar") || {}).textContent || ""), null, { timeout: 15000 }).catch(() => {});
  if (!(await p.$(".futurebar"))) { await p.click('.seg button:has-text("Future state")'); await p.waitForSelector(".futurebar"); }
  t("drafting it again opens the new draft, waiting to be kept", /The agent's draft of the future state/.test(await p.textContent(".futurebar")) && Boolean(await p.$('[data-act="fs-keep"]')), [await p.textContent(".futurebar"), await p.textContent(".maphead"), p.url()]);
  await p.click('.futurebar button:has-text("Back to the current state")');
  await p.waitForFunction(() => /current state/.test((document.querySelector(".maphead") || {}).textContent || ""));

  // ---- the station screen in the box's editor
  await p.click('.host .node[data-node="asm"]');
  await p.click('[data-act="edit"]');
  await p.waitForSelector('#editform select[name="screen"]');
  t("the editor offers the box's tool's screens, its station screen picked", (await p.$eval('#editform select[name="screen"]', (s) => s.value)) === "paperline|/station/:seq");
  await p.selectOption('#editform select[name="screen"]', "paperline|/stock");
  await p.click('#editform button[type="submit"]');
  await p.waitForFunction(() => /Station screen: Stockroom page/.test((document.querySelector(".detail") || {}).textContent || ""));
  t("picking another saves it", true);
  const asmId = (await q("SELECT n.id FROM platform.vsm_nodes n JOIN platform.vsm_maps m ON m.id=n.map_id WHERE m.key='planes' AND n.key='asm'")).rows[0].id;
  await mgr.post(`${A}/nodes/${asmId}`, { screen: { module: "paperline", route: "/station/:seq" } });

  // ---- a form being typed in survives a redraw the page makes on its own (the VSM audit, 2026-11-03)
  await q("INSERT INTO platform.vsm_questions (company, map_key, node_key, where_label, claim, status, sort) VALUES ('demo','planes','asm','Assembly','Assembly is one step','open',1)");
  await p.goto(`${BASE}/c/demo/map?mapkey=planes&box=asm`);
  await p.waitForSelector(".detail h2");
  await p.click('[data-act="edit"]');
  await p.waitForSelector('#editform textarea[name="notes"]');
  await p.fill('#editform textarea[name="notes"]', "typed before the redraw");
  await p.click('#editform [data-act="addrow"]').catch(() => {});
  await p.click('[data-act="confirm"]');
  await p.waitForFunction(() => /confirmed/i.test((document.querySelector('section[aria-label="Review"]') || {}).textContent || ""));
  t("a review answer redraws the page, and the box being edited keeps what was typed", Boolean(await p.$("#editform")) && (await p.$eval('#editform textarea[name="notes"]', (x) => x.value)) === "typed before the redraw");
  await p.click('[data-act="canceledit"]');

  // ---- the board: a box's cards, a plant request's buttons, back to the map
  await p.goto(`${BASE}/c/demo/?box=planes/ship`);
  await p.waitForSelector(".card");
  const shown = await p.$$eval(".col .card, [id^=col-] .card", (els) => els.map((e) => e.textContent));
  t("the board filters by box and says so", /showing the cards on Ship/.test(await p.textContent("#modules")) && shown.length >= 1 && shown.every((x) => /ON THE MAP: SHIP/.test(x)), shown.length);
  const plantId = (await q("SELECT id FROM platform.feedback WHERE kind='plant' AND node_key='ship' AND status='new' ORDER BY id DESC LIMIT 1")).rows[0].id;
  await p.click(`[data-key="fb:${plantId}"] button:has-text("Working on it")`);
  await p.waitForFunction((id) => Boolean(document.querySelector(`#col-in_progress [data-key="fb:${id}"]`)), plantId);
  t("a plant request moves to Working on it with its own button", (await q("SELECT status FROM platform.feedback WHERE id=$1", [plantId])).rows[0].status === "in_progress");
  await p.click('#modules a:has-text("show all")');
  t("show all clears the box", !/showing the cards on/.test(await p.textContent("#modules")) && !/box=/.test(p.url()));
  await Promise.all([p.waitForURL(/\/map\?mapkey=planes&box=ship/), p.click(`[data-key="fb:${plantId}"] a.maplink`)]);
  await p.waitForSelector(".detail h2");
  t("Show on map opens the map on the card's box", (await p.textContent(".detail h2")).trim() === "Ship");

  // ---- who a screen is for, on the QR codes tab
  await p.goto(`${BASE}/c/demo/`);
  await p.waitForSelector(".card");
  await p.evaluate(() => openScreens("paperline", "codes"));
  await p.waitForSelector(".qr-card");
  const picker = await p.$$eval(".qr-card", (cs) => cs.findIndex((c) => /Station picker/.test(c.querySelector(".qr-lab").textContent)));
  await p.selectOption(`.qr-card[data-code="${picker}"] select[aria-label^="Who uses"]`, "floor");
  await p.waitForFunction(() => [...document.querySelectorAll(".qr-card")].some((c) => /Station picker/.test(c.textContent) && /For the floor/.test(c.textContent)));
  t("a manager tags a screen the floor's on the QR codes tab, and the floor's come first", (await q("SELECT for_who FROM platform.screen_tags WHERE company='demo' AND module='paperline' AND route='/station'")).rows[0].for_who === "floor"
    && /For the floor/.test(await p.textContent('.qr-card[data-code="0"]')));

  // ---- the agent board takes the line off the floor, and puts it back
  const fctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  await fctx.addCookies(floor.cookies());
  const fp = await fctx.newPage();
  fp.on("pageerror", (e) => errs.push(`floor: ${e.message}`));
  await p.goto(`${BASE}/c/demo/agent-board?channel=a:line-agent`);
  await p.waitForSelector("text=Its line on the floor");
  await p.click('[data-act="floorline"]');
  await p.waitForSelector('[data-act="floorline"][data-to="on"]');
  await fp.goto(`${BASE}/c/demo/m/paperline/station/2`); await fp.waitForTimeout(1500);
  t("with its line off, the floor's screen shows nothing", !(await fp.$("#sos-line")));
  await p.click('[data-act="floorline"]');
  await p.waitForSelector('[data-act="floorline"][data-to="off"]');
  await fp.goto(`${BASE}/c/demo/m/paperline/station/2`);
  await fp.waitForSelector("#sos-line", { timeout: 8000 });
  t("on again, the floor's station screen shows the line, the agent's name first", /^Line agent: Traveler 1001/.test((await fp.textContent("#sos-line")).trim()));
  await fp.click("#sos-line");
  t("a tap opens it all, read only", /The managers handle it on the agent board/.test(await fp.textContent("#sos-line")) && (await fp.$$("#sos-line button")).length === 0);
  t("it fits a phone", (await fp.evaluate(() => document.documentElement.scrollWidth)) <= 390);
  await fp.goto(`${BASE}/c/demo/m/paperline/stock`); await fp.waitForTimeout(1500);
  t("and shows nowhere else", !(await fp.$("#sos-line")));

  // ---- the agent board, round 2 of the audit: what is typed and left survives the board's look; an error says itself
  // where the action was; on a phone, an agent on the map that is not set up can be set up
  await p.goto(`${BASE}/c/demo/agent-board?channel=plant`);
  await p.waitForSelector("#say textarea");
  await p.fill("#say textarea", "typed and left on the board");
  await p.click(".card.head h2");
  await p.evaluate(() => load());
  t("a message typed and left survives the board's look", (await p.$eval("#say textarea", (x) => x.value)) === "typed and left on the board");
  await p.click('#say button[type="submit"]');
  await p.waitForFunction(() => /typed and left on the board/.test((document.querySelector("section.main .msg .words") || {}).textContent || ""));
  t("sent, its box is empty again", (await p.$eval("#say textarea", (x) => x.value)) === "");
  await p.goto(`${BASE}/c/demo/agent-board?channel=a:line-agent`);
  await p.waitForSelector('[data-act="ask"][data-do="resolved"]');
  await p.click('[data-act="ask"][data-do="resolved"]');
  await p.click('form[data-ask] button[type="submit"]');
  await p.waitForSelector("form[data-ask] .err");
  t("an empty Resolved says why inside the flag's own form, and the form stays", /what was done/i.test(await p.textContent("form[data-ask] .err")) && !(await p.$("section.main > .err.top")));
  await p.click('[data-act="cancelask"]');
  await q("UPDATE platform.vsm_nodes n SET detail = n.detail || '{\"agent_name\":\"Kit agent\"}'::jsonb, modules = ARRAY['paperline'] FROM platform.vsm_maps m WHERE m.id=n.map_id AND m.key='planes' AND m.replaced_at IS NULL AND m.state='current' AND n.key='kit'");
  const kitKey = ((await mgr.get(`${A}/agents`)).json.agents.find((a) => a.name === "Kit agent") || {}).key;
  const pctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  await pctx.addCookies(mgr.cookies());
  const pp = await pctx.newPage();
  pp.on("pageerror", (e) => errs.push(`phone: ${e.message}`));
  await pp.goto(`${BASE}/c/demo/agent-board`);
  await pp.waitForSelector(`.phonechan [data-act="setup"][data-key="${kitKey}"]`, { timeout: 8000 });
  t("on a phone, an agent on the map that is not set up is under the channel picker", Boolean(kitKey) && await pp.isVisible(`.phonechan [data-act="setup"][data-key="${kitKey}"]`) && !(await pp.isVisible("nav.chans")));
  await pp.click(`.phonechan [data-act="setup"][data-key="${kitKey}"]`);
  await pp.waitForFunction((k) => new URLSearchParams(location.search).get("channel") === `a:${k}`, kitKey);
  t("and the phone sets it up", (await mgr.get(`${A}/agents`)).json.agents.some((a) => a.key === kitKey && a.status !== "not_set_up"));

  t("no page threw", errs.length === 0, errs);
  await b.close();
})().then(() => R.done()).catch(R.abort);
