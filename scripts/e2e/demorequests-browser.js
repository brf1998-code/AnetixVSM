// End to end in a real browser: asking for a demo on anetix.ai (www/pages.js request(), www POST /request) and the
// request on the Pins tab of /admin (src/demorequests.js, public/admin.html). Needs BOTH servers up, fake-agent mode,
// a fresh database, the same SOS_WWW_KEY in all three shells:
//   (sos)  SOS_WWW_KEY=k SOS_WWW_URL=http://localhost:4000 SOS_FAKE_AGENT=1 PORT=3999 node server.js
//   (www)  PORT=4000 STRIPE_FAKE=1 STRIPE_WEBHOOK_SECRET=whsec_fake SOS_URL=http://localhost:3999 PUBLIC_URL=http://localhost:4000 SOS_WWW_KEY=k node server.js
//   (here) SOS_WWW_KEY=k node scripts/e2e/demorequests-browser.js
// What it proves: the product's route is closed without the key and checks the fields; the wall's pin tab links to
// the form; the form shows call times only for a call, says what is missing and keeps what was typed; a sent request
// lands on the Pins tab with everything asked, a pill and the tab's count; the same email again adds to it; a bot
// filling the hidden field sends nothing; "Make their pin" makes a pin for that email, hands back a message with no
// dashes that names the pin, the email and the link, and the pin opens anetix.ai; a second live pin is refused;
// Call booked, a note and Decline move it along; one address sending too many is told to wait.
const { chromium } = require("playwright");
const { runner, login, PW } = require("./lib");
const { q } = require("../../src/db");
const R = runner(), t = R.t;
const SOS = "http://127.0.0.1:3999", WWW = process.env.WWW_BASE || "http://localhost:4000", KEY = process.env.SOS_WWW_KEY;
if (!KEY) { console.error("SOS_WWW_KEY must be set in this shell and both servers'"); process.exit(2); }
const api = async (body, key = KEY) => { const r = await fetch(SOS + "/api/www/demo-requests", { method: "POST", headers: { "Content-Type": "application/json", ...(key ? { "X-SOS-WWW-Key": key } : {}) }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => ({})) }; };
const wwwPost = async (p, o) => { const r = await fetch(WWW + p, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(o).toString() }); return { status: r.status, text: await r.text(), location: r.headers.get("location") }; };
const rows = async (email) => (await q("SELECT * FROM platform.demo_requests WHERE email=$1 ORDER BY id", [email])).rows;
const EMAIL = "sam.lee@acmewire.test";

(async () => {
  // ---- the product's door
  t("without the www key the route is closed", (await api({ name: "X Y", email: "x@y.test", company: "Xy", wants: "pin" }, null)).status === 401);
  const bad = await api({ name: "X Y", email: "not-an-email", company: "Xy", wants: "pin" });
  t("with it, a bad email is refused with the field named", bad.status === 400 && bad.json.field === "email", bad);
  t("and a kind of demo it does not know", (await api({ name: "X Y", email: "x@y.test", company: "Xy", wants: "lunch" })).json.field === "wants");

  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 900 } })).newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));

  // ---- the wall links to the form
  await page.goto(WWW + "/"); await page.waitForTimeout(400);
  t("the wall's pin tab shows the request link", await page.isVisible("#request-link") && /Request a demo/.test(await page.textContent("#request-link")));
  await Promise.all([page.waitForURL(WWW + "/request"), page.click("#request-link")]);
  t("it opens the form", /Request a demo/.test(await page.textContent("h1")));
  t("a pin is the default and call times are hidden for it", await page.isChecked('input[name=wants][value=pin]') && !(await page.isVisible("#call_times")));
  await page.check('input[name=wants][value=call]');
  t("choosing a call shows the call times", await page.isVisible("#call_times"));
  await page.fill("#email", EMAIL);
  await Promise.all([page.waitForLoadState("load"), page.click("#send")]);
  t("sent with no name: says so, keeps the email and the choice", /Tell me your name/.test(await page.textContent(".err")) && (await page.inputValue("#email")) === EMAIL && await page.isChecked('input[name=wants][value=call]'));

  // ---- a real request
  await page.fill("#name", "Sam Lee"); await page.fill("#company", "Acme Wire"); await page.fill("#role", "Plant manager");
  await page.fill("#phone", "555 0100"); await page.selectOption("#size", "100-499"); await page.fill("#makes", "wire and cable");
  await page.check('input[name=wants][value=both]'); await page.fill("#call_times", "Tuesday mornings");
  await page.fill("#goal", "Cycle counts are on paper.\nShipping numbers are late.");
  await page.selectOption("#heard", "someone told me");
  t("someone told me asks who", /Who\?/.test(await page.textContent("#heardmore-l")) && await page.isVisible("#heard_more"));
  await page.fill("#heard_more", "Dana at Riverside");
  await Promise.all([page.waitForLoadState("load"), page.click("#send")]);
  t("the thank-you page names them, the email, and a pin and a call", /Thanks, Sam/.test(await page.textContent("h1")) && /sam\.lee@acmewire\.test/.test(await page.textContent("body")) && /pin and to find a time for a call/.test(await page.textContent("body")));
  let r = await rows(EMAIL);
  t("one request, everything asked kept", r.length === 1 && r[0].name === "Sam Lee" && r[0].company === "Acme Wire" && r[0].role === "Plant manager" && r[0].size === "100-499" && r[0].wants === "both" && r[0].call_times === "Tuesday mornings" && /\n/.test(r[0].goal) && r[0].heard === "someone told me" && r[0].heard_more === "Dana at Riverside" && r[0].status === "new" && r[0].ip, r[0]);

  // ---- the same email again; a bot
  const again = await wwwPost("/request", { name: "Sam Lee", email: "Sam.Lee@AcmeWire.test", company: "Acme Wire Co", wants: "pin" });
  r = await rows(EMAIL);
  t("the same email again adds to the open request: newer answers win, a blank keeps the old", again.status === 200 && r.length === 1 && r[0].asks === 2 && r[0].company === "Acme Wire Co" && r[0].wants === "pin" && r[0].role === "Plant manager" && r[0].heard_more === "Dana at Riverside", r.map((x) => [x.asks, x.company, x.role]));
  await q("UPDATE platform.demo_requests SET wants='both', company='Acme Wire' WHERE id=$1", [r[0].id]);
  const before = (await q("SELECT count(*)::int n FROM platform.demo_requests")).rows[0].n;
  const bot = await wwwPost("/request", { name: "Bot Bot", email: "bot@spam.test", company: "Spam", wants: "pin", website: "http://spam.test" });
  t("a bot filling the hidden field gets thanks and sends nothing", bot.status === 200 && /Thanks/.test(bot.text) && (await q("SELECT count(*)::int n FROM platform.demo_requests")).rows[0].n === before);
  await api({ name: "Kim Park", email: "kim@northside.test", company: "Northside Stamping", wants: "call", heard: "linkedin" });

  // ---- the Pins tab
  const admin = await login(PW.admin, "");
  const actx = await browser.newContext({ viewport: { width: 1280, height: 1000 } }); await actx.addCookies(admin.cookies());
  const a = await actx.newPage(); a.on("pageerror", (e) => errors.push("admin: " + e.message));
  await a.goto(SOS + "/admin#pins");
  await a.waitForSelector(`#dr-list [data-dr="${r[0].id}"]`, { timeout: 15000 });
  const card = await a.textContent(`[data-dr="${r[0].id}"]`);
  t("the request is on the Pins tab with what they asked", ["Sam Lee", "Plant manager", "Acme Wire", "A pin and a call", EMAIL, "555 0100", "Tuesday mornings", "100-499", "wire and cable", "Cycle counts are on paper.", "someone told me: Dana at Riverside", "asked 2 times", "New"].every((x) => card.includes(x)), card);
  t("the heading counts two new", /2 new/.test(await a.textContent("#dr-sub")));
  t("a pill says so on every tab, and the tab counts them", /Demo requests\s+2 new/.test(await a.textContent("#pill-demoreq")) && (await a.textContent('#shell a[data-tab="pins"] .n')) === "2");
  t("the form's address is linked", (await a.getAttribute("#dr-form", "href")) === WWW + "/request");

  // make their pin
  await a.click(`[data-dr="${r[0].id}"] button.primary`);
  await a.waitForSelector("#drp-days"); await a.click("#mcard button.primary");
  await a.waitForSelector("#drp-msg", { timeout: 8000 });
  const shown = (await a.textContent("#drp-shown")).trim(), msg = await a.inputValue("#drp-msg");
  const mailto = await a.getAttribute('#mcard a[href^="mailto:"]', "href");
  t("the pin and a message naming it, the email and the link", /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(shown) && msg.includes(shown) && msg.includes(EMAIL) && msg.includes(WWW + "/pin") && /^Hi Sam,/.test(msg), { shown, msg });
  t("the message has no dashes", !/[–—]/.test(msg) && !/ - /.test(msg));
  t("Open in email carries the subject and the message", mailto.startsWith("mailto:" + encodeURIComponent(EMAIL)) && decodeURIComponent(mailto).includes(shown) && /subject=Your%20Anetix%20demo%20pin/.test(mailto));
  const pr = (await q("SELECT d.status, d.pin_id, p.email, p.label, p.max_uses FROM platform.demo_requests d JOIN platform.access_pins p ON p.id=d.pin_id WHERE d.id=$1", [r[0].id])).rows[0];
  t("the pin is for their email, one company, tied to the request, which is now Pin sent", pr && pr.email === EMAIL && pr.label === "Sam Lee at Acme Wire" && pr.max_uses === 1 && pr.status === "pin_sent", pr);
  const opened = await wwwPost("/pin", { pin: shown, email: EMAIL });
  t("the pin opens anetix.ai with that email", opened.status === 303 && opened.location === "/", opened.status);
  await a.click("#mcard button.go"); await a.waitForTimeout(800);
  t("the card shows the pin and Pin sent", /Pin sent/.test(await a.textContent(`[data-dr="${r[0].id}"]`)) && (await a.textContent(`[data-dr="${r[0].id}"]`)).includes(shown));
  t("and the Pins list below has it", (await a.textContent("#pins-list")).includes(shown));
  const twice = await admin.post(`/api/admin/demo-requests/${r[0].id}/pin`, {});
  t("a second pin while the first is live is refused, naming it", twice.status === 409 && twice.json.error.includes(shown), twice.json);

  // move it along
  await a.click(`[data-dr="${r[0].id}"] button:has-text("Call booked")`); await a.waitForTimeout(800);
  t("Call booked", (await rows(EMAIL))[0].status === "call_booked" && /Call booked/.test(await a.textContent(`[data-dr="${r[0].id}"]`)));
  await a.click(`[data-dr="${r[0].id}"] button:has-text("Note")`); await a.fill("#dr-note", "Call Tuesday 9am, wants picking.");
  await a.click("#mcard button.primary"); await a.waitForTimeout(800);
  t("a note is kept and shown", (await rows(EMAIL))[0].note === "Call Tuesday 9am, wants picking." && /Call Tuesday 9am/.test(await a.textContent(`[data-dr="${r[0].id}"]`)));
  const kim = (await rows("kim@northside.test"))[0];
  a.once("dialog", (d) => d.accept());
  await a.click(`[data-dr="${kim.id}"] button:has-text("Decline")`); await a.waitForTimeout(800);
  t("Decline moves it to Handled", (await rows("kim@northside.test"))[0].status === "declined" && (await a.$(`#dr-closed [data-dr="${kim.id}"]`)) && !(await a.$(`#dr-list [data-dr="${kim.id}"]`)));
  t("with none new, the pill goes", !(await a.$("#pill-demoreq")));
  t("the status is checked", (await admin.post(`/api/admin/demo-requests/${kim.id}`, { status: "whenever" })).status === 400);
  t("the admin routes are admin only", (await fetch(SOS + "/api/admin/demo-requests")).status === 401 || (await fetch(SOS + "/api/admin/demo-requests")).status === 403);

  // ---- one address sending too many
  let limited = null;
  for (let i = 0; i < 8 && !limited; i++) { const x = await wwwPost("/request", { name: "Lee " + i, email: `lee${i}@many.test`, company: "Many Co", wants: "pin" }); if (x.status === 429) limited = { i, x }; }
  t("one address sending too many is told to wait", limited && /Try again in an hour/.test(limited.x.text), limited && limited.i);
  t("no script errors on any page", errors.length === 0, errors);
  await browser.close();
  R.done();
})().catch((e) => { console.error(e); process.exit(1); });
