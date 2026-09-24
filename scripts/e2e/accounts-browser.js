// Headless browser pass for named admin accounts: the login page's staff sign-in (name, password, then the code
// box), the admin page's setup-and-nothing-else view with the QR code, the recovery codes shown once, the accounts
// card, and the delete prompt asking for a fresh code. Same server and environment as accounts.js (fake agent,
// passwords on, SOS_CONNECTION_KEY set), on a FRESH database: it makes the first account through the shared
// admin password the way the first admin will.
//   node scripts/e2e/accounts-browser.js
const { BASE, PW, runner, login, sleep } = require("./lib");
const { chromium } = require("playwright");
const totp = require("../../src/totp");
const { q, pool } = require("../../src/db");
const R = runner(), t = R.t;
const NAME = "browser.e2e@anetix.test";
async function codeFor(secretText, delta = 0) {
  const into = (Date.now() / 1000) % 30;
  if (into > 27.5) await sleep((30 - into) * 1000 + 300);
  return totp.hotp(totp.base32Decode(secretText), totp.stepAt() + delta);
}

(async () => {
  const shared = await login(PW.admin, "");
  const made = (await shared.post("/api/admin/accounts", { login: NAME, display_name: "Browser E2E", generate: true })).json;
  t("(setup: an account made with the shared admin password)", made && made.password, made);

  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|Failed to fetch/.test(m.text())) errors.push(m.text()); });   // "Failed to fetch": a page left while its numbers were still loading
  page.on("dialog", (d) => d.accept());

  // ---- the login page: what the floor sees has not changed
  await page.goto(BASE + "/login?next=" + encodeURIComponent("/c/demo/"));
  t("a floor login sees the password box and no name box, no code box", (await page.locator("#pw").isVisible()) && !(await page.locator("#nm").isVisible()) && !(await page.locator("#codebox").isVisible()));
  t("the staff link is small and at the bottom", (await page.locator("#staff").isVisible()) && /Anetix staff sign in/.test(await page.locator("#staff").innerText()));
  await page.fill("#pw", PW.floor); await page.click("button[type=submit]"); await page.waitForURL(/\/c\/demo\/$/);
  t("a floor password signs in the way it always did", /\/c\/demo\/$/.test(page.url()));
  await ctx.clearCookies();

  // ---- staff sign-in: name and password, straight to the setup
  await page.goto(BASE + "/admin"); await page.waitForURL(/\/login\?next=%2Fadmin/);
  t("asking for the admin page opens the name box by itself", await page.locator("#nm").isVisible());
  await page.fill("#nm", NAME); await page.fill("#pw", "not-the-password-x"); await page.click("button[type=submit]");
  await page.waitForSelector("#err", { state: "visible" });
  t("a wrong password says so in plain words, and no code box appears", /name and password did not match/i.test(await page.locator("#err").innerText()) && !(await page.locator("#codebox").isVisible()));
  await q("UPDATE platform.accounts SET failed_count=0 WHERE login=$1", [NAME]);
  await page.fill("#pw", made.password); await page.click("button[type=submit]"); await page.waitForURL(/\/admin$/);
  await page.waitForSelector("#enroll-card h2");
  t("an account with no authenticator lands on the setup", /Set up your authenticator/.test(await page.locator("#enroll-card").innerText()));
  const hidden = await page.evaluate(() => ["health-card", "library-card", "accounts-card", "companies"].every((id) => getComputedStyle(document.getElementById(id)).display === "none"));
  t("and sees nothing else of the admin page", hidden);
  await page.click("#enroll-card button.go"); await page.waitForSelector("#enroll-card svg");
  const secret = (await page.locator("#enroll-card code").innerText()).trim();
  t("the setup shows a QR code and the key to type", /^([A-Z2-7]{4} ){7}[A-Z2-7]{4}$/.test(secret) && (await page.locator("#enroll-card svg").count()) === 1, secret);
  await page.fill("#en-code", "000000"); await page.click("#enroll-card button.primary"); await sleep(600);
  t("a wrong code is refused and the setup stays", await page.locator("#en-code").isVisible());
  await q("UPDATE platform.accounts SET failed_count=0 WHERE login=$1", [NAME]);
  await page.fill("#en-code", await codeFor(secret, -1)); await page.click("#enroll-card button.primary");
  await page.waitForSelector("#enroll-card .codes");
  const codes = await page.locator("#enroll-card .codes div").allInnerTexts();
  t("a good code shows the ten recovery codes", codes.length === 10 && codes.every((c) => /^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/.test(c)), codes);
  t("with a download and a copy button", (await page.locator("#rc-dl").getAttribute("href")).startsWith("data:text/plain") && (await page.locator("#rc-copy").count()) === 1);
  await page.locator("#enroll-card button.go").click(); await page.waitForSelector("#acc-list tr td");
  t("then the whole admin page opens, on the accounts tab, with the seven tabs in the header", /#accounts$/.test(page.url()) && await page.locator("#accounts-card").isVisible() && (await page.locator("#shell nav a").count()) === 7, await page.locator("#shell nav a").count());
  await page.click('#shell nav a[data-tab="health"]'); await page.waitForSelector("#h-table tr td");
  t("a tab shows its own work and nothing of the others", await page.locator("#health-card").isVisible() && !(await page.locator("#accounts-card").isVisible()));
  await page.click('#shell nav a[data-tab="accounts"]');
  const card = await page.locator("#accounts-card").innerText();
  t("the accounts card lists the account as set up, with ten recovery codes left", /Browser E2E/.test(card) && /\(you\)/.test(card) && /set up/.test(card) && /10 recovery codes left/.test(card), card.slice(0, 600));
  t("and says the shared admin password no longer opens admin", /shared admin password no longer opens admin/.test(card));
  const edgeText = await page.locator("#edge-line").innerText();   // the edge check lives on the Instance tab; the header carries its pill on every tab
  t("and the instance tab says the edge check is off here, with a pill for it in the header", /Edge check/.test(edgeText) && /SOS_EDGE_SECRET is not set/.test(edgeText) && /off/.test(await page.locator("#pill-edge").innerText()));
  t("the header says who is signed in", /Browser E2E/.test(await page.locator("#shell-who").innerText()));
  t("the recovery codes are not on the page any more", !codes.some((c) => card.includes(c)) && !(await page.content()).includes(codes[0]));

  // ---- the delete prompt asks for a fresh code, not a password
  await shared.get("/health");
  await page.evaluate(() => openDelete("demo", "Demo Company")); await page.waitForSelector("#del-code");
  t("delete asks for a fresh code from the authenticator, and no password", (await page.locator("#del-code").count()) === 1 && (await page.locator("#del-pw").count()) === 0 && /does not count/.test(await page.locator("#mcard").innerText()));
  await page.evaluate(() => closeModal());
  await page.evaluate(() => openRestore()); await page.waitForSelector("#rs-code");
  t("restore asks for the same", (await page.locator("#rs-code").count()) === 1 && (await page.locator("#rs-pw").count()) === 0);
  await page.evaluate(() => closeModal());

  // ---- sign out, sign in with the code box
  await page.goto(BASE + "/logout"); await page.goto(BASE + "/admin"); await page.waitForURL(/\/login/);
  await page.fill("#nm", NAME); await page.fill("#pw", made.password); await page.click("button[type=submit]");
  await page.waitForSelector("#codebox", { state: "visible" });
  t("after the password the page asks for the 6 digit code, with no error showing", (await page.locator("#code").isVisible()) && !(await page.locator("#err").isVisible()) && /one-time-code/.test(await page.locator("#code").getAttribute("autocomplete")));
  await page.fill("#code", "000000"); await page.click("button[type=submit]"); await page.waitForSelector("#err", { state: "visible" });
  t("a wrong code says so", /code did not match/i.test(await page.locator("#err").innerText()));
  await q("UPDATE platform.accounts SET failed_count=0 WHERE login=$1", [NAME]);
  await page.fill("#code", await codeFor(secret, 0)); await page.click("button[type=submit]"); await page.waitForURL(/\/admin$/);
  await page.goto(BASE + "/admin#accounts"); await page.waitForSelector("#acc-list tr td");
  t("the right code signs in to the admin page", await page.locator("#accounts-card").isVisible());
  // a recovery code in place of the app
  await page.goto(BASE + "/logout"); await page.goto(BASE + "/admin"); await page.waitForURL(/\/login/);
  await page.fill("#nm", NAME); await page.fill("#pw", made.password); await page.click("button[type=submit]");
  await page.waitForSelector("#codebox", { state: "visible" }); await page.click("#userec");
  t("'use a recovery code' turns the box into a text box", (await page.locator("#code").getAttribute("placeholder")) === "recovery code");
  await page.fill("#code", codes[3]); await page.click("button[type=submit]"); await page.waitForURL(/\/admin$/); await page.goto(BASE + "/admin#accounts"); await page.waitForSelector("#acc-list tr td");
  t("a recovery code signs in, and the card says nine left", /9 recovery codes left/.test(await page.locator("#accounts-card").innerText()));
  await page.locator("#accounts-card summary").click();
  const log = await page.locator("#acc-events").innerText();
  t("the sign-in log shows what happened, and never a code", /enrolled/.test(log) && /recovery_used/.test(log) && /bad_code/.test(log) && !log.includes(codes[3]) && !/\b\d{6}\b/.test(log.replace(/\d{1,2}:\d{2}:\d{2}|\d{1,2}\/\d{1,2}\/\d{4}/g, "")), log.slice(0, 400));

  // ---- trusted devices: the box on the code step, the list, Remove, and a sign-in that skips the code
  await page.goto(BASE + "/logout"); await page.goto(BASE + "/admin"); await page.waitForURL(/\/login/);
  t("before the code step there is no remember box", !(await page.locator("#rememberbox").isVisible()));
  await page.fill("#nm", NAME); await page.fill("#pw", made.password); await page.click("button[type=submit]");
  await page.waitForSelector("#codebox", { state: "visible" });
  t("the code step carries 'Remember this computer for 30 days', unticked", (await page.locator("#rememberbox").isVisible()) && /Remember this computer for 30 days/.test(await page.locator("#rememberlabel").innerText()) && !(await page.locator("#remember").isChecked()));
  await page.click("#userec");
  t("choosing a recovery code takes the box away", !(await page.locator("#rememberbox").isVisible()));
  await page.reload(); await page.fill("#nm", NAME); await page.fill("#pw", made.password); await page.click("button[type=submit]"); await page.waitForSelector("#codebox", { state: "visible" });
  await page.check("#remember");
  await q("UPDATE platform.accounts SET failed_count=0 WHERE login=$1", [NAME]); await q("UPDATE platform.account_factors SET last_step=0 WHERE account_id=(SELECT id FROM platform.accounts WHERE login=$1)", [NAME]);
  await page.fill("#code", await codeFor(secret, -1)); await page.click("button[type=submit]"); await page.waitForURL(/\/admin$/);
  await page.goto(BASE + "/admin#accounts"); await page.waitForSelector("#acc-devices-list tr td");
  const devs = await page.locator("#acc-devices").innerText();
  t("the Accounts tab lists this computer under my account: a label, since, last used, Remove", /Chrome on Linux/.test(devs) && (await page.locator("#acc-devices-list tr[data-device]").count()) === 1 && /Remove/.test(devs), devs);
  t("the account row says one trusted computer", /1 trusted computer/.test(await page.locator("#acc-list").innerText()));
  await page.goto(BASE + "/logout"); await page.goto(BASE + "/admin"); await page.waitForURL(/\/login/);
  await page.fill("#nm", NAME); await page.fill("#pw", made.password); await page.click("button[type=submit]"); await page.waitForURL(/\/admin$/);
  t("from this browser, password alone now signs in: no code step", /\/admin$/.test(page.url()));
  await page.goto(BASE + "/admin#accounts"); await page.waitForSelector("#acc-devices-list tr td");
  t("the list says when it was last used", !/not yet/.test(await page.locator("#acc-devices-list").innerText()));
  await page.locator("#acc-devices-list button", { hasText: "Remove" }).click();
  await page.waitForFunction(() => document.querySelector("#acc-devices-list") === null);
  t("Remove asks for nothing and the list is empty", /None\./.test(await page.locator("#acc-devices").innerText()));
  await page.goto(BASE + "/logout"); await page.goto(BASE + "/admin"); await page.waitForURL(/\/login/);
  await page.fill("#nm", NAME); await page.fill("#pw", made.password); await page.click("button[type=submit]"); await page.waitForSelector("#codebox", { state: "visible" });
  t("and the next sign-in asks for the code again", await page.locator("#code").isVisible());

  t("no script errors on either page", errors.length === 0, errors);
  await browser.close(); await pool.end();
  R.done();
})().catch((e) => R.abort(e));
