// End to end in a real browser: passkeys (src/passkeys.js, public/assets/passkey.js, the anetix.ai wall in www/pages.js).
// Chromium's virtual authenticator stands in for Face ID: it holds the passkey and answers "yes, it is them".
// Needs BOTH servers up on localhost (a passkey's name must be a host name, never an IP), fake-agent mode, a fresh
// database, the same SOS_WWW_KEY in all three shells:
//   (sos)  SOS_WWW_KEY=k SOS_WWW_URL=http://localhost:4000 SOS_FAKE_AGENT=1 PORT=3999 node server.js
//   (www)  PORT=4000 STRIPE_FAKE=1 STRIPE_WEBHOOK_SECRET=whsec_fake SOS_URL=http://localhost:3999 PUBLIC_URL=http://localhost:4000 SOS_WWW_KEY=k node server.js
//   (here) SOS_WWW_KEY=k node scripts/e2e/passkeys-browser.js
// What it proves: a demo's manager adds a passkey on Settings once the app is set up; the board's offer goes away;
// signed out, the wall at anetix.ai opens on Sign in with the passkey first and signs in with it alone (no password,
// no code) straight to the board; the product's own sign-in does the same; a passkey for another email is refused; a
// removed passkey signs in nobody; Reset authenticator takes the passkeys; a shared-password session has none.
const { chromium } = require("playwright");
const { runner, sleep } = require("./lib");
const { q } = require("../../src/db");
const totp = require("../../src/totp");
const R = runner(), t = R.t;
const SOS = "http://localhost:3999", WWW = "http://localhost:4000", KEY = process.env.SOS_WWW_KEY;
if (!KEY) { console.error("SOS_WWW_KEY must be set in this shell and both servers'"); process.exit(2); }
const EMAIL = "dana@riverside.test", PASSWORD = "copper-oak-2201-press";
// the app's code for now; a code is good once, so a second one waits for the next 30 second step
let lastStep = 0;
const code = async (secret) => {
  const into = (Date.now() / 1000) % 30; if (into > 27.5) await sleep((30 - into) * 1000 + 300);
  if (totp.stepAt() <= lastStep) await sleep(((lastStep + 1) * 30 - Date.now() / 1000) * 1000 + 400);
  lastStep = totp.stepAt();
  return totp.hotp(totp.base32Decode(secret.replace(/\s/g, "")), lastStep);
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });

  // ---- a demo made the way anetix.ai makes one, its manager signed in and the app set up
  const admin = await browser.newContext();
  const al = await admin.request.post(SOS + "/login", { data: { password: process.env.SOS_ADMIN_PASSWORD || "adminpw" } });
  t("admin signs in", al.ok());
  const pin = (await (await admin.request.post(SOS + "/api/admin/pins", { data: { label: "Dana", email: EMAIL, max_uses: 1, days: 30 } })).json()).pin.shown;
  const made = await (await fetch(SOS + "/api/www/companies", { method: "POST", headers: { "Content-Type": "application/json", "X-SOS-WWW-Key": KEY }, body: JSON.stringify({ pin, email: EMAIL, name: "Riverside Wire", contact: "Dana", ref: "demo:" + pin, paid_usd: 0, credit_usd: 10, password: PASSWORD, demo: true }) })).json();
  const SLUG = made.company.slug;
  const li = await page.request.post(SOS + "/login", { data: { name: EMAIL, password: PASSWORD } });
  t("the manager signs in with the password (no app yet: straight to setup)", li.ok() && (await li.json()).enroll === true);
  const noKeyYet = await page.request.post(SOS + "/api/me/passkeys/options", { data: {} });
  t("before the app is set up, a passkey may be the first factor (the launch audit 1.3)", noKeyYet.ok(), await noKeyYet.text());
  const es = await (await page.request.post(`${SOS}/api/c/${SLUG}/me/enroll/start`, { data: {} })).json();
  const ev = await page.request.post(`${SOS}/api/c/${SLUG}/me/enroll/verify`, { data: { code: await code(es.secret) } });
  t("the app is set up", ev.ok());

  // ---- the board offers a passkey; Settings adds one
  await page.goto(`${SOS}/c/${SLUG}/`); await page.waitForTimeout(1500);
  t("the board offers a passkey to a manager without one", await page.isVisible("#pknudge") && /Add a passkey/.test(await page.textContent("#pknudge")));
  await page.goto(`${SOS}/c/${SLUG}/settings`);
  await page.waitForSelector("#pk-card button[data-add]", { timeout: 8000 });
  await page.click("#pk-card button[data-add]");
  await page.waitForSelector("#pk-card table.acc", { timeout: 8000 });
  const keys = (await q("SELECT k.*, a.login FROM platform.account_passkeys k JOIN platform.accounts a ON a.id=k.account_id WHERE a.login=$1 AND k.removed_at IS NULL", [EMAIL])).rows;
  t("Settings adds a passkey on this device, labelled by the device", keys.length === 1 && /Chrome/.test(keys[0].label) && /Linux|Mac|Windows/.test(keys[0].label), keys.map((k) => k.label));
  const creds = (await cdp.send("WebAuthn.getCredentials", { authenticatorId })).credentials;
  t("the authenticator holds it as a discoverable passkey for localhost", creds.length === 1 && creds[0].isResidentCredential && creds[0].rpId === "localhost", creds.map((c) => ({ rp: c.rpId, resident: c.isResidentCredential })));
  t("the hint cookie is set for the wall", (await ctx.cookies(WWW)).some((c) => c.name === "anx_pk"));
  await page.goto(`${SOS}/c/${SLUG}/`); await page.waitForTimeout(1500);
  t("with a passkey, the board makes no offer", !(await page.isVisible("#pknudge")));
  const second = await page.request.post(SOS + "/api/me/passkeys/options", { data: {} });
  t("adding again names the passkey it has, so the same device is not asked twice", second.ok() && (await second.json()).excludeCredentials.length === 1);

  // ---- signed out: anetix.ai. First the email box's own passkey list (the browser's autofill): the virtual authenticator
  // picks the passkey the way a person taps it in the list, and that alone signs in
  await page.goto(`${SOS}/logout`);
  await Promise.all([page.waitForURL(new RegExp(`^${SOS}/c/${SLUG}/`), { timeout: 10000 }), page.goto(`${WWW}/`)]);
  t("the email box's passkey list signs in on the wall, no password and no code", page.url().startsWith(`${SOS}/c/${SLUG}/`) && /Improvement Board/.test(await page.title()), page.url());
  // then the button, with the autofill switched off in this browser
  await ctx.addInitScript(() => { if (window.PublicKeyCredential) PublicKeyCredential.isConditionalMediationAvailable = async () => false; });
  await page.goto(`${SOS}/logout`);
  await page.goto(`${WWW}/`); await page.waitForTimeout(800);
  t("the wall opens on Sign in for a browser that has a passkey", await page.isVisible("#signin") && !(await page.isVisible("#pin-input")));
  t("with the passkey first and the password behind a link", await page.isVisible("#pk") && !(await page.isVisible("#pw")) && await page.isVisible("#pwlink"));
  await page.fill("#nm", EMAIL);
  await Promise.all([page.waitForURL(new RegExp(`^${SOS}/c/${SLUG}/`), { timeout: 10000 }), page.click("#pk")]);
  await page.waitForTimeout(1200);
  t("the passkey alone signs in, straight to the board", page.url().startsWith(`${SOS}/c/${SLUG}/`) && /Improvement Board/.test(await page.title()), page.url());
  const ev1 = (await q("SELECT event FROM platform.auth_events WHERE login=$1 ORDER BY id DESC LIMIT 1", [EMAIL])).rows[0];
  t("the sign-in log says passkey", ev1 && ev1.event === "login_passkey", ev1);
  const used = (await q("SELECT last_used_at FROM platform.account_passkeys WHERE credential_id=$1", [keys[0].credential_id])).rows[0];
  t("the passkey's last use is kept", used && used.last_used_at);

  // ---- the product's own sign-in page, the same way; and the password is still there behind the link
  await page.goto(`${SOS}/logout`);
  await page.goto(`${SOS}/login?account=${encodeURIComponent(EMAIL)}`); await page.waitForTimeout(600);
  t("the product's sign-in offers the passkey first too", await page.isVisible("#pk") && await page.isVisible("#pwlink"));
  await Promise.all([page.waitForURL(new RegExp(`^${SOS}/c/${SLUG}/`), { timeout: 10000 }), page.click("#pk")]);
  t("and signs in with it", page.url().startsWith(`${SOS}/c/${SLUG}/`));

  // ---- the wrong email with this passkey; a removed passkey
  await page.goto(`${SOS}/logout`);
  await page.goto(`${SOS}/login?account=${encodeURIComponent("someone@else.test")}`); await page.waitForTimeout(600);
  await page.click("#pk"); await page.waitForTimeout(1500);
  t("a passkey for another email is refused, and says so", /different email/.test(await page.textContent("#err")) && page.url().includes("/login"), await page.textContent("#err"));
  const back = await page.request.post(SOS + "/login", { data: { name: EMAIL, password: PASSWORD, code: await code(es.secret) } });
  t("the password and the app's code still sign in", back.ok(), await back.text());
  const mine = (await (await page.request.get(SOS + "/api/me/passkeys")).json()).passkeys;
  const rm = await page.request.post(`${SOS}/api/me/passkeys/${mine[0].id}/remove`, { data: {} });
  t("the manager removes it", rm.ok());
  await page.goto(`${SOS}/logout`);
  await page.goto(`${WWW}/#signin`); await page.waitForTimeout(600);
  await page.click("#pk"); await page.waitForTimeout(1500);
  t("a removed passkey signs in nobody (the device still holds it)", /not on any account/.test(await page.textContent("#err")) && page.url().startsWith(WWW), await page.textContent("#err"));
  await page.click("#pwlink");
  t("and the password is right there", await page.isVisible("#pw"));

  // ---- Reset authenticator takes the passkeys; a shared password has none
  await page.request.post(SOS + "/login", { data: { name: EMAIL, password: PASSWORD, code: await code(es.secret) } });
  await page.goto(`${SOS}/c/${SLUG}/settings`);
  await page.waitForSelector("#pk-card button[data-add]", { timeout: 8000 });
  await cdp.send("WebAuthn.clearCredentials", { authenticatorId });
  await page.click("#pk-card button[data-add]");
  await page.waitForSelector("#pk-card table.acc", { timeout: 8000 });
  const acct = (await q("SELECT id FROM platform.accounts WHERE login=$1", [EMAIL])).rows[0].id;
  const reset = await admin.request.post(`${SOS}/api/admin/accounts/${acct}/reset-factor`, { data: {} });
  const left = (await q("SELECT count(*)::int AS n FROM platform.account_passkeys WHERE account_id=$1 AND removed_at IS NULL", [acct])).rows[0].n;
  t("Reset authenticator on /admin takes the passkeys too", reset.ok() && left === 0, { status: reset.status(), left });
  const floor = await browser.newContext();
  await floor.request.post(SOS + "/login", { data: { password: process.env.SOS_FLOOR_PASSWORD || "floorpw", company: "demo" } });
  t("a shared-password session has no passkeys to add", (await floor.request.post(SOS + "/api/me/passkeys/options", { data: {} })).status() === 400);

  // ---- passkey first on a phone (the launch audit 1.3, Brendan 2026-09-27: "Passkey first on phones"): the manager turns
  // on the phone's screen lock for Anetix, gets the recovery codes, and never sets up an authenticator app
  const EMAIL2 = "jo@harbor.test", PASSWORD2 = "harbor-pine-3302-lathe";
  const pin2 = (await (await admin.request.post(SOS + "/api/admin/pins", { data: { label: "Jo", email: EMAIL2, max_uses: 1, days: 30 } })).json()).pin.shown;
  const made2 = await (await fetch(SOS + "/api/www/companies", { method: "POST", headers: { "Content-Type": "application/json", "X-SOS-WWW-Key": KEY }, body: JSON.stringify({ pin: pin2, email: EMAIL2, name: "Harbor Lathe", contact: "Jo", ref: "demo:" + pin2, paid_usd: 0, credit_usd: 10, password: PASSWORD2, demo: true }) })).json();
  const SLUG2 = made2.company && made2.company.slug;
  t("a second demo for the phone", Boolean(SLUG2), made2);
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36" });
  const pp = await phone.newPage(); pp.on("pageerror", (e) => errors.push("phone: " + e.message));
  const cdp2 = await phone.newCDPSession(pp); await cdp2.send("WebAuthn.enable");
  const auth2 = (await cdp2.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } })).authenticatorId;
  const li2 = await pp.request.post(SOS + "/login", { data: { name: EMAIL2, password: PASSWORD2 } });
  t("the phone's first sign-in goes to setup", li2.ok() && (await li2.json()).enroll === true);
  await pp.goto(`${SOS}/c/${SLUG2}/enroll`); await pp.waitForSelector("#pkfirst", { timeout: 8000 }).catch(() => {});
  const setup = await pp.locator("#card").innerText();
  t("on a phone, setup offers the screen lock first and the app as the other way", await pp.isVisible("#pkfirst") && /Use an authenticator app instead/.test(setup), setup);
  await pp.click("#pkfirst");
  await pp.waitForSelector(".codes div", { timeout: 10000 }).catch(() => {});
  const shown = await pp.locator(".codes div").allInnerTexts();
  t("one tap makes the passkey and shows ten recovery codes", shown.length === 10 && shown.every((c) => /^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/.test(c)), shown);
  t("the device holds the passkey", (await cdp2.send("WebAuthn.getCredentials", { authenticatorId: auth2 })).credentials.length === 1);
  await Promise.all([pp.waitForURL(new RegExp(`^${SOS}/c/${SLUG2}/$`), { timeout: 10000 }), pp.click("#saved")]);
  const me2 = await (await pp.request.get(`${SOS}/api/c/${SLUG2}/me`)).json();
  t("the account is set up with the passkey and no app", me2.enroll_required === false && me2.me.app === false && me2.me.passkeys === 1, me2.me);
  const ev2 = (await q("SELECT event, detail FROM platform.auth_events WHERE login=$1 AND event='enrolled' ORDER BY id DESC LIMIT 1", [EMAIL2])).rows[0];
  t("the sign-in log says it was set up with a passkey", ev2 && ev2.detail && ev2.detail.factor === "passkey", ev2);
  const only = (await (await pp.request.get(SOS + "/api/me/passkeys")).json()).passkeys;
  const rmOnly = await pp.request.post(`${SOS}/api/me/passkeys/${only[0].id}/remove`, { data: {} });
  t("the only passkey of an account with no app cannot be removed", rmOnly.status() === 409, await rmOnly.text());
  await pp.goto(`${SOS}/c/${SLUG2}/settings`); await pp.waitForSelector("#app-line", { timeout: 8000 }).catch(() => {});
  t("Settings offers to add the app as a second way in", /Add the app/.test(await pp.locator("#app-line").innerText().catch(() => "")));
  // the password alone is not enough: a recovery code stands in for the passkey
  await pp.goto(`${SOS}/logout`);
  const pwOnly = await (await pp.request.post(SOS + "/login", { data: { name: EMAIL2, password: PASSWORD2 } })).json();
  t("password right, no passkey: the sign-in asks for a recovery code", pwOnly.need_code === true && pwOnly.passkey_first === true && !pwOnly.enroll, pwOnly);
  const wrong = await pp.request.post(SOS + "/login", { data: { name: EMAIL2, password: PASSWORD2, code: "aaaa-bbbb-cccc-dddd" } });
  t("a wrong recovery code is refused, in words that point at the passkey", wrong.status() === 401 && /signs in with its passkey/.test(await wrong.text()));
  await phone.addInitScript(() => { if (window.PublicKeyCredential) PublicKeyCredential.isConditionalMediationAvailable = async () => false; });   // no autofill: the passkey would sign in by itself
  await pp.goto(`${SOS}/login?account=${encodeURIComponent(EMAIL2)}`); await pp.waitForTimeout(500);
  if (await pp.isVisible("#pwlink")) await pp.click("#pwlink");
  await pp.fill("#pw", PASSWORD2); await pp.click("#f button[type=submit]"); await pp.waitForTimeout(800);
  t("the sign-in page shows the recovery box with the passkey hint, not the app's", await pp.isVisible("#codebox") && /signs in with its passkey/.test(await pp.textContent("#codehint")) && !(await pp.isVisible("#userec")));
  await pp.fill("#code", shown[3]);
  await Promise.all([pp.waitForURL(new RegExp(`^${SOS}/c/${SLUG2}/`), { timeout: 10000 }), pp.click("#f button[type=submit]")]);
  t("and a saved recovery code signs in", pp.url().startsWith(`${SOS}/c/${SLUG2}/`));
  const reuse = await (await browser.newContext()).request.post(SOS + "/login", { data: { name: EMAIL2, password: PASSWORD2, code: shown[3] } });
  t("each recovery code works once", reuse.status() === 401);
  await pp.goto(`${SOS}/logout`);
  await pp.goto(`${SOS}/login?account=${encodeURIComponent(EMAIL2)}`); await pp.waitForTimeout(500);
  await Promise.all([pp.waitForURL(new RegExp(`^${SOS}/c/${SLUG2}/`), { timeout: 10000 }), pp.click("#pk")]);
  t("and the passkey alone signs in on the phone", pp.url().startsWith(`${SOS}/c/${SLUG2}/`));
  // the wall at anetix.ai, the same way
  await pp.goto(`${SOS}/logout`);
  await pp.goto(`${WWW}/#signin`); await pp.waitForTimeout(600);
  if (await pp.isVisible("#pwlink")) await pp.click("#pwlink");
  await pp.fill("#nm", EMAIL2); await pp.fill("#pw", PASSWORD2); await pp.click("#go"); await pp.waitForTimeout(1000);
  t("the wall asks a passkey-first account for a recovery code, with the passkey hint", await pp.isVisible("#codebox") && /signs in with its passkey/.test(await pp.textContent("#codehint")) && !(await pp.isVisible("#userec")), await pp.textContent("#codehint").catch(() => ""));
  await pp.fill("#code", shown[5]);
  await Promise.all([pp.waitForURL(new RegExp(`^${SOS}/c/${SLUG2}/`), { timeout: 10000 }), pp.click("#go")]);
  t("and a recovery code signs in from the wall", pp.url().startsWith(`${SOS}/c/${SLUG2}/`));
  // Settings, Your sign-in (the launch audit 1.10): the manager changes their own password
  await pp.goto(`${SOS}/c/${SLUG2}/settings`); await pp.waitForSelector("#pw-form", { timeout: 8000 });
  const NEWPW = "harbor-pine-4410-mill";
  await pp.fill("#pw-cur", PASSWORD2); await pp.fill("#pw-new", NEWPW); await pp.fill("#pw-new2", NEWPW);
  await Promise.all([pp.waitForURL(/\/login\?account=/, { timeout: 10000 }), pp.click("#pw-form button[type=submit]")]);
  const oldPw = await (await browser.newContext()).request.post(SOS + "/login", { data: { name: EMAIL2, password: PASSWORD2 } });
  const newPw = await (await (await browser.newContext()).request.post(SOS + "/login", { data: { name: EMAIL2, password: NEWPW } })).json();
  t("Settings changes the manager's own password and signs them out to the sign-in", oldPw.status() === 401 && newPw.need_code === true && newPw.passkey_first === true, newPw);

  t("no script errors on any page", errors.length === 0, errors);
  await browser.close();
  R.done();
})().catch((e) => { console.error(e); process.exit(1); });
