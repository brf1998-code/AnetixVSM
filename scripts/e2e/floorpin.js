// End to end for the floor PIN (src/auth.js, src/safeguards.js, public/login.html; 2026-10-29).
// What it proves: a company made by hand gets a floor PIN, not a password; the login page is told to show a number
// pad; a PIN works only from the plant's network list, and with no list every floor sign-in gets the same answer
// whether the PIN was right or wrong; at the plant a wrong PIN is counted per device and per plant, never per address,
// so one device's typos never lock the rest of the floor out; a person's own PIN typed into the floor's box (what
// happened at Chelsea on 2026-10-28) is told apart in words; a floor password from before PINs works as it did; the
// floor's session is a week. The browser half checks the page says the server's reason instead of "did not match".
// Against a server ALREADY UP in fake-agent mode on a fresh database, started with SOS_FLOOR_COMPANY_FAILS=15
// (run-all.sh has the line).
const { runner, login, PW, BASE } = require("./lib");
const R = runner(), t = R.t;
const INSIDE = "203.0.113.9", OUTSIDE = "198.51.100.9";
const S = "pinco";

// a client that keeps every cookie and says which address it comes from (X-Real-IP, src/edge.js)
function clientAt(at) {
  const jar = new Map();
  const c = { at, jar };
  const call = async (method, path, body) => {
    const res = await fetch(BASE + path, { method, redirect: "manual", headers: { "Content-Type": "application/json", Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "), ...(c.at ? { "X-Real-IP": c.at } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const ck of res.headers.getSetCookie ? res.headers.getSetCookie() : []) { const [kv] = ck.split(";"); const i = kv.indexOf("="); const k = kv.slice(0, i), v = kv.slice(i + 1); if (v) jar.set(k, v); else jar.delete(k); }
    const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch (e) {}
    return { status: res.status, json, text, headers: res.headers };
  };
  c.get = (p) => call("GET", p); c.post = (p, body) => call("POST", p, body === undefined ? {} : body);
  return c;
}
const wrongPin = (pin) => String((Number(pin) + 1) % 1e6).padStart(6, "0") === pin ? "593021" : String((Number(pin) + 1) % 1e6).padStart(6, "0");

(async () => {
  const admin = await login(PW.admin, "");
  // ---- a company made by hand gets a floor PIN ----
  const made = await admin.post("/api/admin/companies", { slug: S, name: "Pin Co" });
  const pin = made.json && made.json.passwords && made.json.passwords.floor, mgrPw = made.json && made.json.passwords && made.json.passwords.manager;
  t("a company made by hand gets a floor PIN of 6 digits, and a manager password", made.status === 200 && /^\d{6}$/.test(pin || "") && typeof mgrPw === "string" && mgrPw.length >= 8, made.text);
  const mode = await clientAt(OUTSIDE).get(`/login/mode?c=${S}`);
  t("the login page is told this company's floor signs in with a PIN", mode.json && mode.json.mode === "pin", mode.text);
  t("a company on the old shared passwords is still a password box", (await clientAt(OUTSIDE).get("/login/mode?c=demo")).json.mode === "password");
  const card = (await admin.get("/api/admin/overview")).json;
  const row = card && (card.companies || []).find((c) => c.slug === S);
  t("the admin page knows it is a floor PIN with no plant network yet", row && row.access && row.access.floor_pin === true && (row.access.networks || []).length === 0, row && row.access);

  // ---- no plant network: the floor cannot sign in, and right or wrong get the same answer ----
  const right0 = await clientAt(OUTSIDE).post("/login", { password: pin, company: S });
  const wrong0 = await clientAt(OUTSIDE).post("/login", { password: wrongPin(pin), company: S });
  t("with no plant network, the right floor PIN is refused in words that say why", right0.status === 403 && right0.json.code === "floor_no_network" && /plant's wifi/.test(right0.json.error), right0.text);
  t("and a wrong one gets the very same answer", wrong0.status === right0.status && wrong0.json.error === right0.json.error && wrong0.json.code === right0.json.code, wrong0.text);
  t("no session came of either", !(right0.headers.getSetCookie() || []).some((c) => c.startsWith("sos_session=") && !/sos_session=;/.test(c)));
  const mgrOut = await clientAt(OUTSIDE).post("/login", { password: mgrPw, company: S });
  t("the shared manager password still signs a manager in (it is not the floor's PIN)", mgrOut.status === 200 && mgrOut.json.role === "manager", mgrOut.text);

  // ---- the plant's network goes on the list ----
  const nw = await admin.post(`/api/admin/companies/${S}/safeguards`, { networks: "203.0.113.0/24" });
  t("the admin puts the plant's network on the list", nw.status === 200 && nw.json.floor_pin === true && nw.json.networks[0] === "203.0.113.0/24", nw.text);
  const dev1 = clientAt(INSIDE);
  const in1 = await dev1.post("/login", { password: pin, company: S });
  const sess = (in1.headers.getSetCookie() || []).find((c) => c.startsWith("sos_session="));
  t("on the plant's wifi the floor PIN signs the device in as the floor", in1.status === 200 && in1.json.role === "floor" && in1.json.company === S, in1.text);
  t("for a week: the floor's cookie is set for 7 days", sess && /Max-Age=604800/.test(sess), sess);
  t("the device gets its own counting cookie, only on the sign-in path", (in1.headers.getSetCookie() || []).some((c) => /^sos_fdev=[A-Za-z0-9_-]{16,}; Path=\/login; HttpOnly/.test(c)));
  const board = await dev1.get(`/api/c/${S}/board`);
  t("and it can open the board", board.status === 200, board.status);
  const out1 = await clientAt(OUTSIDE).post("/login", { password: pin, company: S });
  t("off the plant's wifi the right PIN is refused as off the network", out1.status === 403 && out1.json.code === "off_network" && /plant's wifi/.test(out1.json.error), out1.text);
  dev1.at = OUTSIDE;
  const carried = await dev1.get(`/api/c/${S}/board`);
  t("a floor device carried off the wifi is refused until it is back", carried.status === 403 && carried.json.off_network === true, carried.text);
  dev1.at = INSIDE;
  t("and works again once it is back, still signed in", (await dev1.get(`/api/c/${S}/board`)).status === 200);

  // ---- wrong PINs at the plant ----
  const typo = await clientAt(INSIDE).post("/login", { password: wrongPin(pin), company: S });
  t("a wrong floor PIN at the plant says it is the PIN that did not match", typo.status === 401 && typo.json.code === "wrong_pin", typo.text);
  const word = await clientAt(INSIDE).post("/login", { password: "not-a-pin-at-all", company: S });
  t("words where a PIN goes are a wrong password, not a wrong PIN", word.status === 401 && word.json.code === "wrong_password", word.text);
  // what happened at Chelsea on 2026-10-28: a person's own PIN (the People page) typed into the floor's box
  const mgr = await login(mgrPw, S);
  const added = await mgr.post(`/api/c/${S}/people`, { name: "Maria G", role: "floor", pin: "4821" });
  t("a manager adds a person with their own PIN", added.status === 200 && added.json.pin === "4821", added.text);
  const theirs = await clientAt(INSIDE).post("/login", { password: "4821", company: S });
  t("that person's own PIN in the floor's box is a wrong PIN, which the page explains", theirs.status === 401 && theirs.json.code === "wrong_pin", theirs.text);   // 3 wrong at the plant so far

  // ---- a floor password from before PINs, and the other boxes ----
  const legacy = await clientAt(null).post("/login", { password: PW.floor, company: "demo" });
  t("a company still on a floor password signs in as it always did", legacy.status === 200 && legacy.json.role === "floor", legacy.text);
  const pinInPw = await clientAt(OUTSIDE).post("/login", { password: "4821", company: "demo" });
  t("a PIN typed where a floor password goes is told apart", pinInPw.status === 401 && pinInPw.json.code === "pin_in_password_box", pinInPw.text);
  const pinInAccount = await clientAt(OUTSIDE).post("/login", { name: "someone@anetix.test", password: "482913" });
  t("a PIN typed into the account form is told apart", pinInAccount.status === 401 && pinInAccount.json.code === "pin_in_account_form", pinInAccount.text);

  // ---- setting a floor PIN ----
  const short = await admin.post(`/api/admin/companies/${S}/access`, { floor_pin: "48291" });
  const run = await admin.post(`/api/admin/companies/${S}/access`, { floor_pin: "123456" });
  const words = await admin.post(`/api/admin/companies/${S}/access`, { floor_pin: "brass-gear-12" });
  t("a floor PIN that is too short, a run, or words is refused in words", short.status === 400 && /6 to 8 digits/.test(short.json.error) && run.status === 400 && /guess/.test(run.json.error) && words.status === 400, [short.text, run.text, words.text]);
  const fresh = await admin.post(`/api/admin/companies/${S}/access`, { generate: "floor" });
  const pin2 = fresh.json && fresh.json.passwords && fresh.json.passwords.floor;
  t("Make up a floor PIN makes only the floor's, and leaves the manager password alone", fresh.status === 200 && /^\d{6}$/.test(pin2 || "") && pin2 !== pin && fresh.json.passwords.manager === null && (await clientAt(INSIDE).post("/login", { password: mgrPw, company: S })).status === 200, fresh.text);   // the shared manager password is held to the list too, so from the plant
  t("a new floor PIN signs the floor's devices out", (await dev1.get(`/api/c/${S}/board`)).status === 401);
  t("the old PIN no longer opens the floor", (await clientAt(INSIDE).post("/login", { password: pin, company: S })).json.code === "wrong_pin");   // 4 wrong

  // ---- the list taken away: a floor PIN is for the plant only ----
  const dev2 = clientAt("203.0.113.40");
  const in2 = await dev2.post("/login", { password: pin2, company: S });
  t("the new PIN signs a device in at the plant", in2.status === 200 && in2.json.role === "floor", in2.text);
  await admin.post(`/api/admin/companies/${S}/safeguards`, { networks: "" });
  const api = await dev2.get(`/api/c/${S}/board`), pg = await dev2.get(`/c/${S}/`);
  t("with the list cleared, a floor device is refused, in words that say the plant is not set up", api.status === 403 && api.json.code === "floor_no_network" && pg.status === 403 && /not set up yet/.test(pg.text), [api.text, pg.status]);
  await admin.post(`/api/admin/companies/${S}/safeguards`, { networks: "203.0.113.0/24" });
  t("with it back, the device is in again", (await dev2.get(`/api/c/${S}/board`)).status === 200);

  // ---- the page itself: says the server's reason, shows a number pad ----
  let chromium = null; try { ({ chromium } = require("playwright")); } catch (e) { /* no browser here */ }
  let pageFails = 0;
  if (chromium) {
    const browser = await chromium.launch(process.env.SOS_CHROMIUM_PATH ? { executablePath: process.env.SOS_CHROMIUM_PATH } : {});
    const ctx = await browser.newContext({ extraHTTPHeaders: { "X-Real-IP": OUTSIDE }, viewport: { width: 390, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/c/${S}/`);
    await page.waitForFunction(() => document.getElementById("pw").placeholder === "Floor PIN", null, { timeout: 5000 }).catch(() => {});
    const pad = await page.evaluate(() => ({ ph: document.getElementById("pw").placeholder, im: document.getElementById("pw").inputMode, hint: getComputedStyle(document.getElementById("pinhint")).display, sub: document.getElementById("sub").textContent }));
    t("the board's link opens the floor PIN box: a number pad, and words that say which PIN", pad.ph === "Floor PIN" && pad.im === "numeric" && pad.hint !== "none" && /floor PIN/.test(pad.sub), pad);
    await page.fill("#pw", pin2); await page.click("button[type=submit]");
    await page.waitForFunction(() => getComputedStyle(document.getElementById("err")).display !== "none", null, { timeout: 5000 });
    const said = await page.textContent("#err");
    t("off the plant's wifi the page says so, not that the PIN did not match (the 2026-10-28 bug)", /plant's wifi/.test(said) && !/did not match/.test(said), said);
    await ctx.close();
    const ctx2 = await browser.newContext({ extraHTTPHeaders: { "X-Real-IP": "203.0.113.77" } });
    const p2 = await ctx2.newPage();
    await p2.goto(`${BASE}/login?next=${encodeURIComponent(`/c/${S}/`)}`);
    await p2.waitForFunction(() => document.getElementById("pw").placeholder === "Floor PIN", null, { timeout: 5000 }).catch(() => {});
    await p2.fill("#pw", "4821"); await p2.click("button[type=submit]");
    await p2.waitForFunction(() => getComputedStyle(document.getElementById("err")).display !== "none", null, { timeout: 5000 });
    const said2 = await p2.textContent("#err");
    pageFails = 1;
    t("a person's own PIN in the floor's box: the page says to use the floor PIN, and where their own goes", /floor PIN your manager gave you/.test(said2) && /tap your name/.test(said2), said2);   // 5 wrong
    await p2.fill("#pw", pin2); await p2.click("button[type=submit]");
    await p2.waitForURL((u) => new URL(u).pathname === `/c/${S}/`, { timeout: 8000 }).catch(() => {});
    t("and the right floor PIN lands on the board", new URL(p2.url()).pathname === `/c/${S}/`, p2.url());
    await browser.close();
  } else console.log("(no browser: the page checks were skipped)");

  // ---- the counts at the plant: per device and per plant, never per address ----
  // wrong so far from the plant: typo, word, theirs, the old PIN, and the page's (if a browser ran): 4 or 5
  const clumsy = clientAt(INSIDE);
  for (let i = 0; i < 5; i++) await clumsy.post("/login", { password: wrongPin(pin2), company: S });
  const held = await clumsy.post("/login", { password: pin2, company: S });
  t("after five wrong tries that device waits, even with the right PIN", held.status === 429 && held.json.code === "device_wait" && /this phone or tablet/.test(held.json.error) && Number(held.headers.get("retry-after")) > 0, held.text);
  for (let i = 0; i < 3 - pageFails; i++) await clientAt(INSIDE).post("/login", { password: wrongPin(pin2), company: S });
  const other = await clientAt(INSIDE).post("/login", { password: pin2, company: S });
  t("another device at the same plant still signs in after twelve wrong tries from the one address (no lock on the address)", other.status === 200 && other.json.role === "floor", other.text);
  for (let i = 0; i < 3; i++) await clientAt(INSIDE).post("/login", { password: wrongPin(pin2), company: S });
  const paused = await clientAt(INSIDE).post("/login", { password: pin2, company: S });
  t("fifteen wrong tries across the plant pause its floor sign-in, for a fresh device too", paused.status === 429 && paused.json.code === "plant_wait" && /paused/.test(paused.json.error), paused.text);
  t("a device already in keeps working through the pause", (await dev2.get(`/api/c/${S}/board`)).status === 200);
  t("the pause is the company's shared sign-in only: an admin signing in from the same address is not touched by it", (await clientAt(INSIDE).post("/login", { password: PW.admin, company: "" })).status === 200);
  const otherCo = await clientAt(INSIDE).post("/login", { password: PW.floor, company: "demo" });
  t("and another company's floor from that address is not paused", otherCo.status === 200, otherCo.text);
  t("the pause is on the sign-in log", await (async () => { const { q } = require("../../src/db"); const r = (await q("SELECT detail FROM platform.auth_events WHERE event='floor_pin_paused'")).rows; return r.some((x) => x.detail && x.detail.company === S); })());
  R.done();
})().catch(R.abort);
