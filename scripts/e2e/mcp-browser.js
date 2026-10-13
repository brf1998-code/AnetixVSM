// Headless browser pass for connector sign-in (src/mcpauth.js, public/connect.html, the Connected apps block of the
// Accounts tab). Same server and environment as mcp.js (fake agent, passwords on, SOS_CONNECTION_KEY set,
// SOS_PUBLIC_URL=http://127.0.0.1:3999), on a FRESH database.
//   node scripts/e2e/mcp-browser.js
// The app is this script (it registers itself and trades the code); the person is the browser. Claude's callback
// address is never really visited: the browser's trip there is caught and read.
const crypto = require("crypto");
const { BASE, PW, runner, client, login, sleep } = require("./lib");
const { chromium } = require("playwright");
const totp = require("../../src/totp");
const accounts = require("../../src/accounts");
const { q, pool } = require("../../src/db");
const R = runner(), t = R.t;
const ADMIN = "browser.mcp@anetix.test", MANAGER = "maria.browser@plant.test", MPW = "a-long-enough-password-2";
const CLAUDE = "https://claude.ai/api/mcp/auth_callback", ADDRESS = `${BASE}/mcp/admin`;

async function codeFor(secretText, delta = 0) {
  const into = (Date.now() / 1000) % 30;
  if (into > 27.5) await sleep((30 - into) * 1000 + 300);
  return totp.hotp(totp.base32Decode(secretText), totp.stepAt() + delta);
}
const fresh = async (name, secret) => { await q("UPDATE platform.account_factors SET last_step=0 WHERE account_id=(SELECT id FROM platform.accounts WHERE login=$1)", [name]); return codeFor(secret); };
const post = async (path, { body, form, headers = {} } = {}) => {
  const res = await fetch(BASE + path, { method: "POST", redirect: "manual", headers: { "Content-Type": form ? "application/x-www-form-urlencoded" : "application/json", ...headers }, body: form ? new URLSearchParams(form).toString() : JSON.stringify(body || {}) });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch (e) {}
  return { status: res.status, json, text };
};
const pkce = () => { const verifier = crypto.randomBytes(32).toString("base64url"); return { verifier, challenge: crypto.createHash("sha256").update(verifier).digest("base64url") }; };
// an app registers and asks; -> { app, p, consent } where consent is the page the person's browser is sent to
async function ask(name = "Claude", redirect = CLAUDE) {
  const app = (await post("/oauth/register", { body: { client_name: name, redirect_uris: [redirect], token_endpoint_auth_method: "none" } })).json, p = pkce();
  const res = await fetch(`${BASE}/oauth/authorize?${new URLSearchParams({ response_type: "code", client_id: app.client_id, redirect_uri: redirect, code_challenge: p.challenge, code_challenge_method: "S256", state: "st-browser", resource: ADDRESS })}`, { redirect: "manual" });
  return { app, p, consent: BASE + res.headers.get("location") };
}

(async () => {
  // ---- setup: an admin and a manager account, each with an authenticator, enrolled without the browser
  const shared = await login(PW.admin, "");
  const made = (await shared.post("/api/admin/accounts", { login: ADMIN, display_name: "Browser MCP", generate: true })).json;
  const a = client(); await a.post("/login", { name: ADMIN, password: made.password });
  const secret = (await a.post("/api/admin/accounts/me/enroll/start", {})).json.secret;
  t("(setup: the admin enrolls)", (await a.post("/api/admin/accounts/me/enroll/verify", { code: await codeFor(secret, -1) })).status === 200);
  await accounts.create({ login: MANAGER, display_name: "Maria", password: MPW, role: "manager", company: "demo" }, "e2e", null);
  const m = client(); await m.post("/login", { name: MANAGER, password: MPW });
  const mSecret = (await m.post("/api/c/demo/me/enroll/start", {})).json.secret;
  t("(setup: the manager enrolls)", (await m.post("/api/c/demo/me/enroll/verify", { code: await codeFor(mSecret, -1) })).status === 200);

  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (msg) => { if (msg.type() === "error" && !/Failed to load resource|Failed to fetch/.test(msg.text())) errors.push(msg.text()); });
  page.on("dialog", (d) => d.accept());
  // the trip back to the app: caught, never made
  const landed = [];
  await ctx.route(/^https:\/\/claude\.ai\//, (route) => { landed.push(route.request().url()); route.fulfill({ status: 200, contentType: "text/html", body: "<p id='app'>back at the app</p>" }); });
  const signIn = async (name, password, sec) => {
    await page.fill("#nm", name); await page.fill("#pw", password); await page.click("button[type=submit]");
    await page.waitForSelector("#codebox", { state: "visible" });
    await page.fill("#code", await fresh(name, sec)); await page.click("button[type=submit]");
  };

  // ---- not signed in: the consent page sends the person to the account sign-in and back
  const one = await ask();
  await page.goto(one.consent); await page.waitForURL(/\/login\?staff=1&next=/);
  t("opened signed out, the consent page goes to the account sign-in (the email box, not the floor's password)", await page.locator("#nm").isVisible());
  await signIn(ADMIN, made.password, secret);
  await page.waitForURL(/\/oauth\/consent\?req=/); await page.waitForSelector("#yes");
  t("and signing in comes straight back to it", /\/oauth\/consent\?req=/.test(page.url()));
  const text = await page.locator("#card").innerText();
  t("it names the app, the address, who is signed in and where the answer goes", /Claude is asking to connect to Anetix admin/.test(text.replace(/\s+/g, " ")) && text.includes(ADDRESS) && text.includes(ADMIN) && /goes back to claude\.ai/.test(text), text);
  t("it says what the app can read, that without the tick it cannot change anything, and that it gets no record from a company's tools", /Read demos, sites, loop health/.test(text) && /Without the tick it cannot change anything at all/.test(text) && /never gets a record from a company's tools/.test(text));
  t("the tick for writing is there, off, and says what it adds and what it never does", (await page.locator("#writes").count()) === 1 && !(await page.locator("#writes").isChecked()) && /Let it start and fill in new tool requests/.test(text) && /spends the company's AI credit/.test(text) && /cannot confirm a design, build, put anything on a floor/.test(text));
  t("it says how long the connection lasts and where to end it", /up to 30 days/.test(text) && /after 7 days unused/.test(text) && /under Accounts/.test(text));
  t("with no passkey on the account it asks for the code, and offers no passkey button", await page.locator("#code").isVisible() && (await page.locator("#pk").count()) === 0 && /^Allow$/.test((await page.locator("#yes").innerText()).trim()));
  t("no em or en dash anywhere on it", !/[\u2013\u2014]/.test(await page.content()));

  await page.click("#yes");
  await page.waitForSelector("#err", { state: "visible" });
  t("Allow with no code asks for one, and goes nowhere", /Type the code/.test(await page.locator("#err").innerText()) && landed.length === 0 && /\/oauth\/consent/.test(page.url()));
  await page.fill("#code", "000000"); await page.click("#yes");
  await page.waitForFunction(() => /did not match/.test((document.getElementById("err") || {}).textContent || ""));
  t("a wrong code is refused on the page, the box is cleared, and nothing went to the app", (await page.inputValue("#code")) === "" && landed.length === 0 && (await q("SELECT count(*)::int AS n FROM platform.mcp_codes")).rows[0].n === 0);
  await q("UPDATE platform.accounts SET failed_count=0, locked_until=NULL WHERE login=$1", [ADMIN]);
  await page.fill("#code", await fresh(ADMIN, secret)); await page.click("#yes");
  await page.waitForSelector("#app");
  const back = new URL(landed[0]);
  t("a fresh code: the browser goes back to the app with a one-time code and the app's own state", landed.length === 1 && back.origin + back.pathname === CLAUDE && /^anx_ac_/.test(back.searchParams.get("code")) && back.searchParams.get("state") === "st-browser", landed);
  const tok = await post("/oauth/token", { form: { grant_type: "authorization_code", client_id: one.app.client_id, code: back.searchParams.get("code"), code_verifier: one.p.verifier, redirect_uri: CLAUDE } });
  t("which the app trades for its tokens", tok.status === 200 && /^anx_at_/.test(tok.json.access_token), tok.text);
  const call = await post("/mcp/admin", { headers: { Authorization: `Bearer ${tok.json.access_token}`, Accept: "application/json, text/event-stream" }, body: { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "list_companies", arguments: {} } } });
  t("and uses to call a tool", call.status === 200 && /demo/.test(call.text), call.text.slice(0, 200));

  // ---- Cancel
  const two = await ask("Claude again");
  await page.goto(two.consent); await page.waitForSelector("#no");
  await page.click("#no"); await page.waitForSelector("#app");
  t("Cancel goes back to the app with a no and no code", landed.length === 2 && /error=access_denied/.test(landed[1]) && !/[?&]code=/.test(landed[1]) && /state=st-browser/.test(landed[1]), landed[1]);

  // ---- an app on this computer: the warning
  const three = await ask("Claude Code", "http://localhost:3118/callback");
  await page.goto(three.consent); await page.waitForSelector("#yes");
  const warn = await page.locator(".note.warn").innerText();
  t("an app on this computer gets the warning and the address named", /a program on this computer/.test(warn) && /localhost:3118/.test(warn) && /only if you started connecting an app on this computer/i.test(warn), warn);

  // ---- a request that was changed, and one with nothing in it
  await page.goto(three.consent.replace(/req=(.{20})./, (x, keep) => `req=${keep}${x.slice(-1) === "A" ? "B" : "A"}`)); await page.waitForSelector(".note.bad");
  t("a changed request is refused in words, with no button to allow anything", /too old or was changed/.test(await page.locator("#card").innerText()) && (await page.locator("#yes").count()) === 0);
  await page.goto(BASE + "/oauth/consent"); await page.waitForSelector(".note.bad");
  t("the page opened on its own says to start from the app", /Start from the app/.test(await page.locator("#card").innerText()));

  // ---- a phone
  await page.setViewportSize({ width: 390, height: 780 });
  const four = await ask("Claude on a phone");
  await page.goto(four.consent); await page.waitForSelector("#yes");
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  const tall = await page.evaluate(() => Math.min(...[...document.querySelectorAll("#card button")].map((b) => b.getBoundingClientRect().height)));
  t("on a phone the page fits the screen and the buttons are big enough to tap", fits && tall >= 40, { fits, tall });
  await page.setViewportSize({ width: 1280, height: 900 });

  // ---- the Accounts tab: the address, the connected app, what it asked, Disconnect
  await page.goto(BASE + "/admin#accounts"); await page.waitForSelector("#mcp-grants tr[data-grant]");
  const block = await page.locator("#acc-mcp").innerText();
  t("the Accounts tab shows the address to give an app, and how a connection ends", (await page.locator("#mcp-address").innerText()) === ADDRESS && /ends after 7 days unused/.test(block) && /after 30 days whatever its use/.test(block) && /an app on your own computer/.test(block), block.slice(0, 500));
  const row = await page.locator("#mcp-grants tr[data-grant]").first().innerText();
  t("and the connected app: its name, where its answers go, whose it is, that it only reads, its calls", (await page.locator("#mcp-grants tr[data-grant]").count()) === 1 && /Claude/.test(row) && /claude\.ai/.test(row) && row.includes(ADMIN) && /Reads only/.test(row) && /\b1\b/.test(row), row);
  await page.locator("#acc-mcp summary").click();
  const callsText = await page.locator("#mcp-calls").innerText();
  t("what the apps asked: the tool and who, never the answer", /list_companies/.test(callsText) && callsText.includes(ADMIN) && !/paperline/.test(callsText), callsText);
  t("nothing on the tab is a token", !/anx_(at|rt|ac)_/.test(await page.content()));
  await page.locator("#mcp-grants tr[data-grant] button").click();
  await page.waitForSelector("#mcp-none");
  const after = await post("/mcp/admin", { headers: { Authorization: `Bearer ${tok.json.access_token}`, Accept: "application/json, text/event-stream" }, body: { jsonrpc: "2.0", id: 8, method: "tools/list" } });
  t("Disconnect takes the app off the list and its token stops at once", /No app is connected/.test(await page.locator("#acc-mcp").innerText()) && after.status === 401);

  // ---- the tick: a connection that may write new tool requests (src/mcp-intake.js)
  const six = await ask("Claude writer");
  await page.goto(six.consent); await page.waitForSelector("#writes");
  await page.check("#writes");
  await page.fill("#code", await fresh(ADMIN, secret)); await page.click("#yes");
  await page.waitForSelector("#app");
  const wBack = new URL(landed[landed.length - 1]);
  const wTok = await post("/oauth/token", { form: { grant_type: "authorization_code", client_id: six.app.client_id, code: wBack.searchParams.get("code"), code_verifier: six.p.verifier, redirect_uri: CLAUDE } });
  const tool = (name, args) => post("/mcp/admin", { headers: { Authorization: `Bearer ${wTok.json.access_token}`, Accept: "application/json, text/event-stream" }, body: { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name, arguments: args } } });
  const started = await tool("start_tool_request", { company: "demo" });
  const reqId = (() => { try { return JSON.parse(started.json.result.content[0].text).request.id; } catch (e) { return 0; } })();
  t("ticked on the page, the connection writes: it starts a new tool request", wTok.status === 200 && started.status === 200 && reqId > 0 && (await q("SELECT writes FROM platform.mcp_grants ORDER BY id DESC LIMIT 1")).rows[0].writes === true, started.text.slice(0, 300));
  await page.goto(BASE + "/admin#accounts"); await page.waitForSelector("#mcp-grants tr[data-grant]");
  t("the Accounts tab says that connection reads and writes new tool requests", /Reads, and writes new tool requests/.test(await page.locator("#mcp-grants tr[data-grant]").first().innerText()));
  await tool("answer_tool_request", { id: reqId, answers: { name: "Rework board", thing: "rework ticket" } });

  // ---- a manager account: told this address is not for it
  await ctx.clearCookies();
  const five = await ask("Claude for a manager");
  await page.goto(five.consent); await page.waitForURL(/\/login\?staff=1&next=/);
  await signIn(MANAGER, MPW, mSecret);
  // the sign-in sends a manager back to the page that asked (it used to land them on their board, phase 2 of docs/MCP.md)
  await page.waitForURL(/\/oauth\/consent\?req=/); await page.waitForSelector(".note.bad");
  t("a manager's sign-in goes back to the consent page", /\/oauth\/consent\?req=/.test(page.url()));
  const mtext = await page.locator("#card").innerText();
  t("a manager account sees why it cannot connect an app here, and no Allow", /cannot connect an app here/.test(mtext) && /Anetix.s own accounts/.test(mtext) && (await page.locator("#yes").count()) === 0 && (await page.locator("#code").count()) === 0, mtext);
  await page.click("#no"); await page.waitForSelector("#app");
  t("its way out goes back to the app with a no", /error=access_denied/.test(landed[landed.length - 1]));
  // the manager's board: the request Anetix started and filled in, said to be Anetix's, with the manager's own buttons
  await page.goto(BASE + "/c/demo/"); await page.waitForSelector(".card.request");
  const tile = await page.locator(".card.request").first().innerText();
  t("the manager's board shows the request as started by Anetix, and says to read the answers over before sending", /New tool: Rework board/.test(tile) && /started by Anetix/.test(tile) && /Anetix wrote these answers from a conversation with you/.test(tile) && /Continue/.test(tile) && !/[\u2013\u2014]/.test(tile), tile);

  t("no script error on any page", errors.length === 0, errors);
  await browser.close();
  await pool.end();
  R.done();
})().catch((e) => R.abort(e));
