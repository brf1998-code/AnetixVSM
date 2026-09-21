// End to end: named admin accounts with an authenticator app (src/accounts.js, src/totp.js, the admin half of
// src/auth.js). Runs against a server that is ALREADY UP in fake-agent mode on a FRESH database, with the same
// environment in this shell (the script signs cookies and reads the database itself):
//
//   export DATABASE_URL=postgres://sos:sos@127.0.0.1:5432/sos_e2e SESSION_SECRET=e2e SOS_CONNECTION_KEY=e2e-connection-key \
//     SOS_FLOOR_PASSWORD=floorpw SOS_MANAGER_PASSWORD=mgrpw SOS_ADMIN_PASSWORD=adminpw
//   SOS_FAKE_AGENT=1 PORT=3999 node server.js &
//   node scripts/e2e/accounts.js
//
// Two more modes, each against the database the first run left behind:
//   node scripts/e2e/accounts.js restore      the server under a restart loop (while true; do node server.js; done):
//                                             a backup is taken and restored with a fresh code, the server exits and
//                                             comes back, and the admins still sign in with their codes
//   node scripts/e2e/accounts.js breakglass   the server restarted with SOS_ADMIN_2FA=off: password alone, on the record
//   node scripts/e2e/accounts.js noadminvar   the server restarted WITHOUT SOS_ADMIN_PASSWORD (what Railway looks like
//                                             once the variable is taken out): the plants sign in as before, the shared
//                                             manager password is a manager again and not an admin, nothing is open
// With SOS_INTERNAL_TOKEN=<anything> in the environment of both, the main run also checks the platform's internal
// token is kept out of the accounts.
//
// A sign-in claims its time step, so a second code for the same account needs a newer step. The three steps that are
// valid at any moment (before, now, after) give three sign-ins without waiting; past that the script puts last_step
// back to 0 in the database, which only a test may do.
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Client } = require("pg");
const { PW, runner, client, login, sleep, waitFor } = require("./lib");
const totp = require("../../src/totp");
const auth = require("../../src/auth");
const { q, pool } = require("../../src/db");
const dbroles = require("../../src/dbroles");
const R = runner(), t = R.t;
const MODE = process.argv[2] || "main";
const STATE = path.join(os.tmpdir(), "sos-e2e-accounts.json");
const BRENDAN = "brendan.e2e@anetix.test", TAYLOR = "taylor.e2e@anetix.test";

// the code the app would show, delta steps from now; never computed within two seconds of a step rolling over
async function codeFor(secretText, delta = 0) {
  const into = (Date.now() / 1000) % 30;
  if (into > 27.5) await sleep((30 - into) * 1000 + 300);
  return totp.hotp(totp.base32Decode(secretText), totp.stepAt() + delta);
}
const freshSteps = (login) => q("UPDATE platform.account_factors SET last_step=0 WHERE account_id=(SELECT id FROM platform.accounts WHERE login=$1)", [login]);
const unlock = (login) => q("UPDATE platform.accounts SET failed_count=0, locked_until=NULL WHERE login=$1", [login]);
const events = async (ev) => (await q("SELECT * FROM platform.auth_events WHERE event=$1 ORDER BY id", [ev])).rows;
async function signIn(name, password, code) { const c = client(); const r = await c.post("/login", { name, password, code }); return { c, r }; }
// every request from its own address, so the per-address login throttle (10 failures) never gets in the way of
// what is being tested; without Railway's edge in front the app reads the address the old way (src/edge.js)
let n = 0;
function from(c) {
  const ip = `198.51.100.${(++n % 250) + 1}`;
  const call = (method) => async (p, b) => {
    const res = await fetch((process.env.SOS_E2E_BASE || "http://127.0.0.1:3999") + p, { method, redirect: "manual", headers: { "Content-Type": "application/json", "x-real-ip": ip }, body: b === undefined ? undefined : JSON.stringify(b) });
    let json = null; const text = await res.text(); try { json = JSON.parse(text); } catch (e) {}
    return { status: res.status, json, text, headers: res.headers, cookie: (res.headers.getSetCookie ? res.headers.getSetCookie() : []).join(";") };
  };
  return { post: call("POST"), ip };
}
const tryLogin = (body) => from().post("/login", body);

async function main() {
  // ---- before any account: everything is as it was
  const shared = await login(PW.admin, "");
  t("the shared admin password still opens admin while no account has an authenticator", (await shared.get("/api/admin/overview")).status === 200);
  const me0 = (await shared.get("/api/admin/accounts/me")).json;
  t("and the admin page is told so", me0.shared_password === true && me0.me === null && me0.step_up === "shared_password" && me0.shared_password_open === true, me0);
  t("its use is on the record", (await events("legacy_admin_password")).length >= 1);
  const floor = await login(PW.floor, "demo"), mgr = await login(PW.manager, "demo");
  t("floor and manager sign in with no name, as before", (await floor.get("/api/c/demo/board")).status === 200 && (await mgr.get("/api/c/demo/board")).status === 200);
  t("and neither reaches the accounts", (await mgr.get("/api/admin/accounts")).status === 403 && (await floor.get("/api/admin/accounts/me")).status === 403);
  // cookies exactly as the code before this change made them (signed here by hand, not by the new code)
  const old = (role, company, gen) => { const p = `${role}.${company}.${gen}.${(Date.now() - 5 * 24 * 3600e3).toString(36)}`; return `sos_session=${p}.${crypto.createHmac("sha256", process.env.SESSION_SECRET).update(p).digest("base64url")}`; };
  const gen = (await q("SELECT generation FROM platform.company_access WHERE company='demo'")).rows[0].generation;
  const withCookie = async (cookie, p) => (await fetch("http://127.0.0.1:3999" + p, { headers: { Cookie: cookie }, redirect: "manual" })).status;
  t("a floor cookie from five days before this deploy still works", (await withCookie(old("floor", "demo", gen), "/api/c/demo/board")) === 200);
  t("a manager cookie from five days before this deploy still works", (await withCookie(old("manager", "demo", gen), "/api/c/demo/board")) === 200);
  t("an admin cookie from before this deploy does not: admins sign in again", (await withCookie(old("admin", "*", 0), "/api/admin/overview")) === 401);

  // ---- the first accounts, made from the shared password's session
  t("a name that is not an email address is refused", (await shared.post("/api/admin/accounts", { login: "brendan", generate: true })).status === 400);
  t("a short password is refused", (await shared.post("/api/admin/accounts", { login: BRENDAN, password: "short" })).status === 400);
  const mb = await shared.post("/api/admin/accounts", { login: BRENDAN.toUpperCase(), display_name: "Brendan E2E", generate: true });
  const mt = await shared.post("/api/admin/accounts", { login: TAYLOR, display_name: "Taylor E2E", generate: true });
  t("two accounts are made; the made-up passwords are shown once", mb.status === 200 && mt.status === 200 && /^[a-z]+-[a-z]+-\d{3}-[a-z]+-[a-z]+$/.test(mb.json.password) && mb.json.account.login === BRENDAN, mb.json);
  t("the same name twice is refused", (await shared.post("/api/admin/accounts", { login: BRENDAN, generate: true })).status === 400);
  const pwB = mb.json.password, pwT = mt.json.password, idB = mb.json.account.id, idT = mt.json.account.id;
  const listed = (await shared.get("/api/admin/accounts")).json;
  t("the list shows both, not set up, and never a hash or a secret", listed.accounts.length === 2 && listed.accounts.every((a) => !a.enrolled) && !/password_hash|secret|s1\$/.test(JSON.stringify(listed.accounts)), listed.accounts);

  // ---- an account without an authenticator: the setup and nothing else
  const wrong = await tryLogin({ name: BRENDAN, password: "not-the-password" });
  const unknown = await tryLogin({ name: "nobody.e2e@anetix.test", password: "not-the-password" });
  t("a wrong password and an unknown name get the same answer", wrong.status === 401 && unknown.status === 401 && wrong.text === unknown.text && !wrong.cookie, [wrong.text, unknown.text]);
  await unlock(BRENDAN);
  const { c: b1, r: rb1 } = await signIn(BRENDAN, pwB);
  t("name and password sign in, and say the authenticator has to be set up", rb1.status === 200 && rb1.json.enroll === true && rb1.json.role === "admin");
  const meB = (await b1.get("/api/admin/accounts/me")).json;
  t("who-am-I answers, and asks for the setup", meB.me.login === BRENDAN && meB.enroll_required === true && meB.me.enrolled === false, meB);
  const blocked = await Promise.all(["/api/admin/overview", "/api/admin/accounts", "/api/admin/backup", "/api/c/demo/board", "/api/admin/events"].map((p) => b1.get(p)));
  t("everything else is refused until a code verifies", blocked.every((x) => x.status === 403 && x.json && x.json.enroll_required === true), blocked.map((x) => x.status));
  t("a page sends it to the admin page", [(await b1.get("/")).status, (await b1.get("/c/demo/")).status].every((s) => s === 302) && (await b1.get("/c/demo/")).headers.get("location") === "/admin");
  t("the admin page itself opens", (await b1.get("/admin")).status === 200);
  t("it cannot make accounts or delete a company yet", (await b1.post("/api/admin/accounts", { login: "x.e2e@anetix.test", generate: true })).status === 403 && (await b1.post("/api/admin/companies/demo/delete", { confirm_slug: "demo" })).status === 403);

  // ---- enrollment
  const st = await b1.post("/api/admin/accounts/me/enroll/start", {});
  t("setup answers with a QR code and the key to type", st.status === 200 && /^<svg /.test(st.json.qr_svg) && /^([A-Z2-7]{4} ){7}[A-Z2-7]{4}$/.test(st.json.secret), st.json && st.json.secret);
  const secretB = st.json.secret;
  const stored = (await q("SELECT secret_enc, verified_at FROM platform.account_factors WHERE account_id=$1", [idB])).rows[0];
  t("the secret is kept encrypted, and not verified yet", stored && stored.verified_at === null && !stored.secret_enc.toString("latin1").includes(secretB.replace(/ /g, "")) && !stored.secret_enc.toString("latin1").includes("secret"));
  t("the shared password still opens admin: a started setup is not a working authenticator", (await tryLogin({ password: PW.admin })).status === 200);
  t("a wrong code does not verify", (await b1.post("/api/admin/accounts/me/enroll/verify", { code: "000000" })).status === 401);
  const ev = await b1.post("/api/admin/accounts/me/enroll/verify", { code: await codeFor(secretB, -1) });
  t("a good code verifies, and the ten recovery codes are shown", ev.status === 200 && ev.json.recovery_codes.length === 10, ev.json);
  const recB = ev.json.recovery_codes;
  t("the recovery codes are kept as hashes", (await q("SELECT code_hash FROM platform.account_recovery_codes WHERE account_id=$1", [idB])).rows.every((r) => /^[0-9a-f]{64}$/.test(r.code_hash) && !recB.some((c) => r.code_hash.includes(c))));
  t("setup cannot be started again over a working authenticator", (await b1.post("/api/admin/accounts/me/enroll/start", {})).status === 400);
  t("the same session now reaches everything", (await b1.get("/api/admin/overview")).status === 200 && (await b1.get("/api/admin/accounts")).status === 200);
  t("enrolled is on the record", (await events("enrolled")).some((e) => e.account_id === idB));

  // ---- the shared admin password is finished
  t("the shared password's open session ended at once", (await shared.get("/api/admin/overview")).status === 401);
  const refused = await tryLogin({ password: PW.admin });
  t("and the shared password is refused from now on, with the ordinary words", refused.status === 401 && refused.json.error === "wrong password" && !refused.cookie, refused.text);
  t("the refusal is on the record", (await events("legacy_admin_refused")).length === 1);
  t("floor and manager passwords are untouched by that", (await tryLogin({ password: PW.floor, company: "demo" })).status === 200 && (await tryLogin({ password: PW.manager, company: "demo" })).status === 200);

  // ---- signing in with a code
  const need = await tryLogin({ name: BRENDAN, password: pwB });
  t("password alone: no cookie, the page is told to ask for the code", need.status === 200 && need.json.need_code === true && !need.json.ok && !need.cookie, need.text);
  t("a wrong password never gets as far as the code", (await tryLogin({ name: BRENDAN, password: "not-the-password", code: await codeFor(secretB) })).json.need_code !== true);
  await unlock(BRENDAN);
  const used = await codeFor(secretB, 0);
  const { c: b2, r: rb2 } = await signIn(BRENDAN, pwB, used);
  t("password and the current code sign in", rb2.status === 200 && rb2.json.ok === true && !rb2.json.enroll && (await b2.get("/api/admin/overview")).status === 200, rb2.text);
  const again = await tryLogin({ name: BRENDAN, password: pwB, code: used });
  t("the same code a second time is refused", again.status === 401 && /already used/.test(again.json.error) && !again.cookie, again.text);
  t("the replay is on the record", (await events("replayed_code")).length === 1);
  const del1 = await b2.post("/api/admin/companies/nosuch/delete", { confirm_slug: "nosuch", code: used });
  t("(a company that is not there is 404 before any code is looked at)", del1.status === 404);
  await shared.get("/health");
  const made = await b2.post("/api/admin/accounts", { login: "third.e2e@anetix.test", generate: true, code: used });
  t("the code that signed you in does not count as a step-up", made.status === 403 && made.json.step_up === true && /already used/.test(made.json.error), made.text);
  await unlock(BRENDAN);
  t("older steps are refused too once a newer one was used", (await tryLogin({ name: BRENDAN, password: pwB, code: await codeFor(secretB, -1) })).status === 401);
  await unlock(BRENDAN);
  const { r: rNext } = await signIn(BRENDAN, pwB, await codeFor(secretB, 1));
  t("the next step's code signs in (a phone clock a little ahead)", rNext.status === 200 && rNext.json.ok === true);
  await freshSteps(BRENDAN);
  const far = totp.hotp(totp.base32Decode(secretB), totp.stepAt() + 3), back = totp.hotp(totp.base32Decode(secretB), totp.stepAt() - 3);
  t("a code from 90 seconds ahead or behind is refused", (await tryLogin({ name: BRENDAN, password: pwB, code: far })).status === 401 && (await tryLogin({ name: BRENDAN, password: pwB, code: back })).status === 401);
  await unlock(BRENDAN);

  // ---- step-up on delete and restore
  await shared.get("/health");
  const co = await b2.post("/api/admin/companies", { slug: "scrap", name: "Scrap Co" });
  t("(setup: a company to delete)", co.status === 200, co.text);
  t("delete without a code is refused", (await b2.post("/api/admin/companies/scrap/delete", { confirm_slug: "scrap" })).status === 403);
  t("delete with the old shared admin password is refused", (await b2.post("/api/admin/companies/scrap/delete", { confirm_slug: "scrap", password: PW.admin })).status === 403);
  t("delete with a wrong code is refused", (await b2.post("/api/admin/companies/scrap/delete", { confirm_slug: "scrap", code: "123456" })).status === 403);
  await unlock(BRENDAN); await freshSteps(BRENDAN);
  const fresh = await codeFor(secretB, -1);
  const del = await b2.post("/api/admin/companies/scrap/delete", { confirm_slug: "scrap", code: fresh });
  t("delete with a fresh code goes through", del.status === 200 && del.json.ok === true, del.text);
  t("a restore with that same code is refused (each step-up needs its own)", (await b2.post("/api/admin/restore", { code: fresh, backup: { format: "nope" } })).status === 403);
  t("step-ups are on the record, with what they were for", (await events("step_up_ok")).some((e) => e.detail && e.detail.what === "delete_company:scrap") && (await events("step_up_fail")).length >= 1);
  await unlock(BRENDAN);

  // ---- the lock: five wrong codes, and the address throttle is a separate thing
  await freshSteps(BRENDAN);
  for (let i = 0; i < 5; i++) await tryLogin({ name: BRENDAN, password: pwB, code: "000000" });
  const lockedOut = await tryLogin({ name: BRENDAN, password: pwB, code: await codeFor(secretB, 0) });
  t("five wrong codes lock the account, even for the right password and code, from a new address", lockedOut.status === 429 && /too many failed tries for this name/.test(lockedOut.json.error) && Number(lockedOut.headers.get("retry-after")) > 800, lockedOut.text);
  t("the lock is on the record", (await events("locked")).length >= 1 && (await events("refused_locked")).length >= 1);
  t("a session that is already open carries on", (await b2.get("/api/admin/overview")).status === 200);
  t("a step-up is refused while locked", (await b2.post("/api/admin/companies/demo/delete", { confirm_slug: "demo", code: await codeFor(secretB, 1) })).status === 403);
  t("other accounts and the plants are not touched by it", (await tryLogin({ name: TAYLOR, password: pwT })).status === 200 && (await tryLogin({ password: PW.floor, company: "demo" })).status === 200);
  for (let i = 0; i < 5; i++) await tryLogin({ name: "ghost.e2e@anetix.test", password: "whatever-it-is" });
  const ghost = await tryLogin({ name: "ghost.e2e@anetix.test", password: "whatever-it-is" });
  const lockWords = /^too many failed tries for this name; try again in \d+ min$/;
  t("a name nobody has locks the same way, so the lock does not say which names exist", ghost.status === 429 && lockWords.test(ghost.json.error) && lockWords.test(lockedOut.json.error), ghost.text);
  const one = from();
  let last = null; for (let i = 0; i < 11; i++) last = await one.post("/login", { password: "wrong-floor-password", company: "demo" });
  t("ten failures from one address still close that address, as before", last.status === 429 && /too many failed logins/.test(last.json.error), last.text);
  t("and only that address", (await tryLogin({ password: PW.floor, company: "demo" })).status === 200);
  await unlock(BRENDAN); await freshSteps(BRENDAN);

  // ---- recovery codes
  const viaRec = await tryLogin({ name: BRENDAN, password: pwB, code: recB[0].toUpperCase() });
  t("a recovery code signs in in place of the app's code", viaRec.status === 200 && viaRec.json.ok === true, viaRec.text);
  t("once", (await tryLogin({ name: BRENDAN, password: pwB, code: recB[0] })).status === 401);
  t("its use is on the record with how many are left", (await events("recovery_used")).some((e) => e.detail && e.detail.left === 9));
  t("the list says nine left", (await b2.get("/api/admin/accounts")).json.accounts.find((a) => a.id === idB).recovery_left === 9);
  await unlock(BRENDAN);

  // ---- Taylor enrolls; sign out everywhere; reset; switch off
  const { c: t1 } = await signIn(TAYLOR, pwT);
  const stT = await t1.post("/api/admin/accounts/me/enroll/start", {});
  const secretT = stT.json.secret;
  const evT = await t1.post("/api/admin/accounts/me/enroll/verify", { code: await codeFor(secretT, -1) });
  t("(setup: the second admin enrolls)", evT.status === 200 && secretT !== secretB);
  t("one admin's code is no use on the other's account", (await tryLogin({ name: TAYLOR, password: pwT, code: await codeFor(secretB, 0) })).status === 401);
  t("nor is one admin's recovery code", (await tryLogin({ name: TAYLOR, password: pwT, code: recB[1] })).status === 401 && (await q("SELECT used_at FROM platform.account_recovery_codes WHERE account_id=$1 AND used_at IS NOT NULL", [idB])).rows.length === 1);
  await unlock(TAYLOR);
  const { c: t2 } = await signIn(TAYLOR, pwT, await codeFor(secretT, 0));
  const floorBefore = (await floor.get("/api/c/demo/board")).status;
  const started = Date.now();
  const so = await b2.post(`/api/admin/accounts/${idT}/signout`, {});
  await waitFor("Taylor's sessions to end", async () => (await t2.get("/api/admin/overview")).status === 401 && (await t1.get("/api/admin/overview")).status === 401, 12000);
  t("sign out everywhere ends every session of that account within ten seconds", so.status === 200 && Date.now() - started < 11000, Date.now() - started);
  t("the admin who pressed it, the floor and the manager are not touched", (await b2.get("/api/admin/overview")).status === 200 && floorBefore === 200 && (await floor.get("/api/c/demo/board")).status === 200 && (await mgr.get("/api/c/demo/board")).status === 200);
  t("a forged older generation is refused", (await withCookie(`sos_session=${auth.signAdmin(idT, 1)}`, "/api/admin/overview")) === 401);
  t("an account cannot switch itself off", (await b2.post(`/api/admin/accounts/${idB}/disable`, {})).status === 400);
  t("resetting another admin's authenticator needs a fresh code from the one doing it", (await b2.post(`/api/admin/accounts/${idT}/reset-factor`, {})).status === 403 && (await b2.post(`/api/admin/accounts/${idT}/reset-factor`, { code: await codeFor(secretT, 1) })).status === 403);
  await unlock(BRENDAN); await freshSteps(BRENDAN);
  const rf = await b2.post(`/api/admin/accounts/${idT}/reset-factor`, { code: await codeFor(secretB, -1) });
  const afterReset = await tryLogin({ name: TAYLOR, password: pwT });
  t("with it, the authenticator is gone and they are sent to set it up again", rf.status === 200 && afterReset.status === 200 && afterReset.json.enroll === true, [rf.text, afterReset.text]);
  t("their old recovery codes went with it", (await q("SELECT count(*)::int AS n FROM platform.account_recovery_codes WHERE account_id=$1", [idT])).rows[0].n === 0);
  t("the shared password stays shut: one admin still has a working authenticator", (await tryLogin({ password: PW.admin })).status === 401);
  const np = await b2.post(`/api/admin/accounts/${idT}/reset-password`, { code: await codeFor(secretB, 0) });
  t("a new password for another admin, shown once; the old one stops working", np.status === 200 && np.json.password && np.json.password !== pwT && (await tryLogin({ name: TAYLOR, password: pwT })).status === 401, np.text);
  await unlock(TAYLOR);
  const { c: t3 } = await signIn(TAYLOR, np.json.password);
  t("switching an account off signs it out and keeps it out", (await b2.post(`/api/admin/accounts/${idT}/disable`, {})).status === 200 && (await t3.get("/api/admin/accounts/me")).status === 401 && (await tryLogin({ name: TAYLOR, password: np.json.password })).status === 401);
  t("switching it back on needs a fresh code", (await b2.post(`/api/admin/accounts/${idT}/enable`, {})).status === 403 && (await b2.post(`/api/admin/accounts/${idT}/enable`, { code: await codeFor(secretB, 1) })).status === 200);

  // ---- removing an account for good (a name typed wrong, someone who left)
  await freshSteps(BRENDAN);
  const wrongName = "taylorpearlman.e2e@anetix.test";
  const mw = await b2.post("/api/admin/accounts", { login: wrongName, display_name: "Typo", generate: true, code: await codeFor(secretB, -1) });
  t("(setup: an account made under a name typed wrong)", mw.status === 200, mw.text);
  const idW = mw.json.account.id;
  t("an account that is switched on cannot be removed, code or not", (await b2.post(`/api/admin/accounts/${idW}/remove`, { code: await codeFor(secretB, 0) })).status === 400);
  t("you cannot remove your own account", (await b2.post(`/api/admin/accounts/${idB}/remove`, { code: await codeFor(secretB, 1) })).status === 400);
  t("(setup: switched off)", (await b2.post(`/api/admin/accounts/${idW}/disable`, {})).status === 200);
  await freshSteps(BRENDAN);
  t("removing a switched-off account needs a fresh code", (await b2.post(`/api/admin/accounts/${idW}/remove`, {})).status === 403 && (await b2.post(`/api/admin/accounts/${idW}/remove`, { code: "000000" })).status === 403);
  await unlock(BRENDAN);
  // give the doomed account a factor and recovery codes, so the cascade has something to take
  await q("INSERT INTO platform.account_factors (account_id, kind, secret_enc, verified_at) VALUES ($1,'totp',$2,now())", [idW, Buffer.from("x")]);
  await q("INSERT INTO platform.account_recovery_codes (account_id, code_hash) VALUES ($1,'abc')", [idW]);
  const rm = await b2.post(`/api/admin/accounts/${idW}/remove`, { code: await codeFor(secretB, -1) });
  t("with one, the account is gone", rm.status === 200 && rm.json.ok === true && !(await b2.get("/api/admin/accounts")).json.accounts.some((a) => a.id === idW), rm.text);
  t("and its authenticator and recovery codes went with it", (await q("SELECT count(*)::int AS n FROM platform.account_factors WHERE account_id=$1", [idW])).rows[0].n === 0 && (await q("SELECT count(*)::int AS n FROM platform.account_recovery_codes WHERE account_id=$1", [idW])).rows[0].n === 0);
  t("the sign-in log keeps its lines, and says who removed it", (await q("SELECT count(*)::int AS n FROM platform.auth_events WHERE account_id=$1", [idW])).rows[0].n >= 3 && (await events("account_removed")).some((e) => e.account_id === idW && e.login === wrongName && e.detail.by === BRENDAN && e.detail.had_authenticator === true));
  t("the name is free to be used again", (await b2.post("/api/admin/accounts", { login: wrongName, display_name: "Typo again", generate: true, code: await codeFor(secretB, 0) })).status === 200);
  t("removing what is already gone is 404", (await b2.post(`/api/admin/accounts/${idW}/remove`, { code: await codeFor(secretB, 1) })).status === 404);
  const idW2 = (await b2.get("/api/admin/accounts")).json.accounts.find((a) => a.login === wrongName).id;
  await b2.post(`/api/admin/accounts/${idW2}/disable`, {}); await freshSteps(BRENDAN);
  t("(cleanup: the second one removed too)", (await b2.post(`/api/admin/accounts/${idW2}/remove`, { code: await codeFor(secretB, -1) })).status === 200);
  await freshSteps(BRENDAN);
  // Taylor enrolls again for the restore mode
  const { c: t4 } = await signIn(TAYLOR, np.json.password);
  const secretT2 = (await t4.post("/api/admin/accounts/me/enroll/start", {})).json.secret;
  t("(setup: the second admin enrolls again, with a new secret)", (await t4.post("/api/admin/accounts/me/enroll/verify", { code: await codeFor(secretT2, -1) })).status === 200 && secretT2 !== secretT);

  // ---- change my password
  await freshSteps(BRENDAN);
  t("changing a password needs the current one", (await b2.post("/api/admin/accounts/me/password", { current: "wrong", next: "a-new-long-password" })).status === 403);
  await unlock(BRENDAN);
  const cp = await b2.post("/api/admin/accounts/me/password", { current: pwB, next: "a-new-long-password-1" });
  t("with it, the password changes and every session of the account ends", cp.status === 200 && (await b2.get("/api/admin/overview")).status === 401 && (await tryLogin({ name: BRENDAN, password: pwB })).status === 401);
  await unlock(BRENDAN);
  const { c: b3, r: rb3 } = await signIn(BRENDAN, "a-new-long-password-1", await codeFor(secretB, -1));
  t("the new password and a code sign in", rb3.status === 200 && rb3.json.ok === true);

  // ---- lifetimes, against the running server
  const gB = (await q("SELECT generation FROM platform.accounts WHERE id=$1", [idB])).rows[0].generation;
  const aged = (role, company, g, hours) => { const p = `${role}.${company}.${g}.${(Date.now() - hours * 3600e3).toString(36)}`; return `sos_session=${p}.${auth.hmac(p)}`; };
  t("an admin cookie 11 hours old works, 13 hours old does not", (await withCookie(aged("admin", `*${idB}`, gB, 11), "/api/admin/overview")) === 200 && (await withCookie(aged("admin", `*${idB}`, gB, 13), "/api/admin/overview")) === 401);
  t("a floor cookie 13 hours old works", (await withCookie(aged("floor", "demo", gen, 13), "/api/c/demo/board")) === 200);
  t("the admin cookie is set for 12 hours, the floor's for 30 days", /Max-Age=43200/.test((await tryLogin({ name: TAYLOR, password: np.json.password, code: await codeFor(secretT2, 0) })).cookie) && /Max-Age=2592000/.test((await tryLogin({ password: PW.floor, company: "demo" })).cookie));

  // ---- the backup file, and what module code's database login can see
  const dump = (await b3.get("/api/admin/backup")).json;
  t("the backup carries the accounts, their authenticators and recovery codes", dump.platform.accounts.length === 2 && dump.platform.account_factors.length === 2 && dump.platform.account_recovery_codes.length === 20);
  t("and not the sign-in log", dump.platform.auth_events === undefined);
  const flat = JSON.stringify(dump.platform.accounts) + JSON.stringify(dump.platform.account_factors) + JSON.stringify(dump.platform.account_recovery_codes);
  t("no secret, password or recovery code is readable in it", ![secretB, secretT2].some((s) => flat.includes(s.replace(/ /g, ""))) && !flat.includes("a-new-long-password-1") && !recB.some((c) => flat.includes(c)));
  const role = new Client({ ...dbroles.connectionFor("demo", "live"), connectionTimeoutMillis: 8000 });
  let roleUp = true; try { await role.connect(); } catch (e) { roleUp = false; console.log(`      (module database login not available here: ${e.message}; skipped)`); }
  if (roleUp) {
    const denied = [];
    for (const tbl of ["accounts", "account_factors", "account_recovery_codes", "auth_events"]) { try { await role.query(`SELECT 1 FROM platform.${tbl} LIMIT 1`); denied.push(false); } catch (e) { denied.push(e.code === "42501"); } }
    let wrote = false; try { await role.query("INSERT INTO platform.auth_events (event) VALUES ('forged')"); wrote = true; } catch (e) { /* refused */ }
    await role.end();
    t("module code's database login can read none of the four tables, and cannot write the log", denied.every(Boolean) && !wrote, denied);
  }
  const log = (await b3.get("/api/admin/accounts")).json;
  t("the sign-in log on the admin page never carries a code, a secret or a password", log.events.length > 20 && ![secretB, secretT2, used, "a-new-long-password-1", pwB].some((s) => JSON.stringify(log.events).includes(s.replace(/ /g, ""))));
  t("the admin page is told the edge check is off here, and where this request came from", log.edge && log.edge.mode === "off" && typeof log.edge.client_ip === "string", log.edge);

  if (process.env.SOS_INTERNAL_TOKEN) {
    const internal = async (p) => (await fetch("http://127.0.0.1:3999" + p, { headers: { "x-sos-internal": process.env.SOS_INTERNAL_TOKEN } })).status;
    t("the platform's internal token is admin elsewhere and refused at the accounts", (await internal("/api/admin/overview")) === 200 && (await internal("/api/admin/accounts")) === 403 && (await internal("/api/admin/accounts/me")) === 403);
  } else console.log("      (SOS_INTERNAL_TOKEN not pinned: the internal token case was skipped)");

  fs.writeFileSync(STATE, JSON.stringify({ BRENDAN, TAYLOR, pwB: "a-new-long-password-1", pwT: np.json.password, secretB, secretT: secretT2, recB }), { mode: 0o600 });
}

async function restore() {
  const S = JSON.parse(fs.readFileSync(STATE, "utf8"));
  await freshSteps(S.BRENDAN); await freshSteps(S.TAYLOR); await unlock(S.BRENDAN); await unlock(S.TAYLOR);
  const { c: b, r } = await signIn(S.BRENDAN, S.pwB, await codeFor(S.secretB, -1));
  t("(setup: signed in)", r.status === 200 && r.json.ok === true, r.text);
  const doc = (await b.get("/api/admin/backup")).json;
  const genBefore = (await q("SELECT generation FROM platform.accounts WHERE login=$1", [S.BRENDAN])).rows[0].generation;
  t("restore with no code is refused", (await b.post("/api/admin/restore", { backup: doc })).status === 403);
  // something that happens AFTER the backup was taken: the other admin is signed out everywhere
  const idT = doc.platform.accounts.find((a) => a.login === S.TAYLOR).id;
  await b.post(`/api/admin/accounts/${idT}/signout`, {});
  const genT = (await q("SELECT generation FROM platform.accounts WHERE id=$1", [idT])).rows[0].generation;
  const boot = (await b.get("/health")).json.boot;
  const rs = await b.post("/api/admin/restore", { code: await codeFor(S.secretB, 0), backup: doc });
  t("restore with a fresh code goes through and the platform restarts", rs.status === 200 && rs.json.restarting === true, rs.text);
  await waitFor("the platform to come back", async () => { try { const h = await (await fetch("http://127.0.0.1:3999/health")).json(); return h.boot !== boot; } catch (e) { return false; } }, 90000);
  await sleep(1500);
  t("every admin signs in again after a restore", (await b.get("/api/admin/overview")).status === 401);
  const gens = (await q("SELECT login, generation FROM platform.accounts ORDER BY id")).rows;
  t("generations end up above both the file's and what the instance had, so a signed-out session stays dead", gens.find((g) => g.login === S.BRENDAN).generation > genBefore && gens.find((g) => g.login === S.TAYLOR).generation > genT, [gens, genBefore, genT]);
  await freshSteps(S.BRENDAN); await freshSteps(S.TAYLOR);
  const b2 = await signIn(S.BRENDAN, S.pwB, await codeFor(S.secretB, -1)), t2 = await signIn(S.TAYLOR, S.pwT, await codeFor(S.secretT, -1));
  t("both admins still sign in with their passwords and the codes from their apps", b2.r.status === 200 && b2.r.json.ok === true && t2.r.status === 200 && t2.r.json.ok === true && !b2.r.json.enroll, [b2.r.text, t2.r.text]);
  t("an unused recovery code from before still works", (await tryLogin({ name: S.BRENDAN, password: S.pwB, code: S.recB[5] })).status === 200);
  t("the shared admin password stays shut after a restore", (await tryLogin({ password: PW.admin })).status === 401);
  t("the plants sign in as before", (await tryLogin({ password: PW.floor, company: "demo" })).status === 200);
  // a backup from before named accounts: the accounts on the instance stay
  const older = JSON.parse(JSON.stringify(doc)); for (const k of ["accounts", "account_factors", "account_recovery_codes"]) delete older.platform[k];
  const boot2 = (await b2.c.get("/health")).json.boot;
  const rs2 = await b2.c.post("/api/admin/restore", { code: await codeFor(S.secretB, 0), backup: older });
  t("(a backup from before named accounts restores)", rs2.status === 200, rs2.text);
  await waitFor("the platform to come back", async () => { try { const h = await (await fetch("http://127.0.0.1:3999/health")).json(); return h.boot !== boot2; } catch (e) { return false; } }, 90000);
  await sleep(1500); await freshSteps(S.BRENDAN);
  const b3 = await signIn(S.BRENDAN, S.pwB, await codeFor(S.secretB, -1));
  t("and locks nobody out: the accounts on the instance stay as they were", b3.r.status === 200 && b3.r.json.ok === true && (await q("SELECT count(*)::int AS n FROM platform.accounts")).rows[0].n === 2, b3.r.text);
}

async function breakglass() {
  const S = JSON.parse(fs.readFileSync(STATE, "utf8"));
  await unlock(S.BRENDAN);
  const before = (await events("break_glass")).length;
  const { c: b, r } = await signIn(S.BRENDAN, S.pwB);
  t("with SOS_ADMIN_2FA=off a password alone signs in", r.status === 200 && r.json.ok === true && !r.json.need_code, r.text);
  t("and reaches everything", (await b.get("/api/admin/overview")).status === 200);
  t("every such sign-in is on the record as break glass", (await events("break_glass")).length === before + 1);
  const me = (await b.get("/api/admin/accounts/me")).json;
  t("the admin page is told, loudly", me.two_fa_off === true && me.step_up === "password", me);
  t("a wrong password is still refused and still counts toward the lock", (await tryLogin({ name: S.BRENDAN, password: "not-the-password" })).status === 401);
  t("an unknown name is still refused", (await tryLogin({ name: "nobody.e2e@anetix.test", password: S.pwB })).status === 401);
  t("the shared admin password is still shut", (await tryLogin({ password: PW.admin })).status === 401);
  await b.post("/api/admin/companies", { slug: "scrap2", name: "Scrap Two", password: S.pwB });
  t("a step-up takes the account's own password, since there is no code to give", (await b.post("/api/admin/companies/scrap2/delete", { confirm_slug: "scrap2", password: "wrong-password" })).status === 403 && (await b.post("/api/admin/companies/scrap2/delete", { confirm_slug: "scrap2", password: S.pwB })).status === 200);
  t("and that is on the record as break glass too", (await events("break_glass")).some((e) => e.detail && e.detail.at === "step_up"));
  await unlock(S.BRENDAN);
}

async function noadminvar() {
  const S = JSON.parse(fs.readFileSync(STATE, "utf8"));
  await freshSteps(S.BRENDAN); await unlock(S.BRENDAN);
  t("(this mode needs the server started without SOS_ADMIN_PASSWORD)", !process.env.SOS_ADMIN_PASSWORD);
  t("nothing is open: a request with no session is sent to sign in", (await fetch("http://127.0.0.1:3999/api/admin/overview", { redirect: "manual" })).status === 401);
  const f = await tryLogin({ password: PW.floor, company: "demo" }), m = await tryLogin({ password: PW.manager, company: "demo" });
  t("the floor password signs in to the floor", f.status === 200 && f.json.role === "floor", f.text);
  t("the shared manager password is a MANAGER of its company, not an admin", m.status === 200 && m.json.role === "manager" && m.json.company === "demo", m.text);
  t("the old admin password is nothing now", (await tryLogin({ password: "adminpw" })).status === 401);
  const { c: b, r } = await signIn(S.BRENDAN, S.pwB, await codeFor(S.secretB, -1));
  t("the named account signs in with its code and is admin", r.status === 200 && r.json.ok === true && (await b.get("/api/admin/overview")).status === 200, r.text);
}

({ main, restore, breakglass, noadminvar }[MODE] || main)().then(async () => { await pool.end(); R.done(); }).catch((e) => R.abort(e));
