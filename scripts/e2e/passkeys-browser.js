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
  t("before the app is set up, no passkey can be added", noKeyYet.status() === 403);
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
  t("no script errors on any page", errors.length === 0, errors);
  await browser.close();
  R.done();
})().catch((e) => { console.error(e); process.exit(1); });
