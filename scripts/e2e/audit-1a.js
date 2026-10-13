// End to end for the outside audit's three sign-in findings (Audit/findings/1A.md, 2026-10-13), each replayed the way
// the auditor did it, over HTTP with copied cookies:
//   S1-01  a password-only session of an account with no second factor stayed alive and became a full session the
//          moment ANOTHER browser finished the setup. Now it is enrollment-only for good, and dies at that moment;
//          the browser that proved the factor gets the full session.
//   S1-02  any live session of an enrolled account could add a passkey (or a passkey-only manager the app), which
//          then outlived the session and answered admin step-ups. Now a fresh proof of a factor the account already
//          has comes first, bound to the session and used once; the passkey offered right after the first setup is
//          the one exception, from that browser only.
//   S1-03  /logout only told the browser to drop the cookie; a copy kept working for up to 180 days. Now the session
//          is revoked on the server, and a copy of a cookie from before this change dies with it too.
// Against a server ALREADY UP in fake-agent mode on a fresh database (run-all.sh), SESSION_SECRET=e2e.
const crypto = require("crypto");
const { runner, client, login, PW, sleep } = require("./lib");
const { q } = require("../../src/db");
const totp = require("../../src/totp");
const accounts = require("../../src/accounts");
const auth = require("../../src/auth");   // SESSION_SECRET is the server's (run-all.sh), so a second session of an account can be signed here
const R = runner(), t = R.t;
const BASE = process.env.SOS_E2E_BASE || "http://127.0.0.1:3999";
const CO = "audit-a";
const ADMIN1 = "audit.admin@anetix.test", ADMIN2 = "audit.admin2@anetix.test";

async function codeFor(secretText, delta = 0) {
  const into = (Date.now() / 1000) % 30;
  if (into > 27.5) await sleep((30 - into) * 1000 + 300);
  return totp.hotp(totp.base32Decode(String(secretText).replace(/\s/g, "")), totp.stepAt() + delta);
}
const freshSteps = (login) => q("UPDATE platform.account_factors SET last_step=0 WHERE account_id=(SELECT id FROM platform.accounts WHERE login=$1)", [login]);
const unlock = () => q("UPDATE platform.accounts SET failed_count=0, locked_until=NULL");
// the session cookie a client holds, and a request made with exactly that cookie and nothing else (a copy of it)
const cookieOf = (c) => (c.cookies().find((x) => x.name === "sos_session") || {}).value;
async function withCookie(value, p, method = "GET", body) {
  const r = await fetch(BASE + p, { method, redirect: "manual", headers: { Cookie: `sos_session=${value}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return r.status;
}
async function signIn(name, password, code) { const c = client(); const r = await c.post("/login", { name, password, code }); return { c, r }; }

(async () => {
  // ---- setup, from the shared admin password's session (no authenticator anywhere yet)
  const shared = await login(PW.admin, "");
  const co = await shared.post("/api/admin/companies", { slug: CO, name: "Audit A" });
  t("(setup: a company)", co.status === 200, co.text);
  const a1 = await shared.post("/api/admin/accounts", { login: ADMIN1, display_name: "Audit Admin", generate: true });
  const a2 = await shared.post("/api/admin/accounts", { login: ADMIN2, display_name: "Audit Admin Two", generate: true });
  t("(setup: two admin accounts)", a1.status === 200 && a2.status === 200);
  const inviteAndJoin = async (name, email) => {
    const inv = await shared.post(`/api/c/${CO}/managers/invite`, { name, email });
    const tok = new URL(inv.json.link, BASE).searchParams.get("t");
    const c = client();
    const j = await c.post("/join", { t: tok, password: `${name.toLowerCase().replace(/\s/g, "-")}-long-password-1` });
    return { c, j, password: `${name.toLowerCase().replace(/\s/g, "-")}-long-password-1` };
  };
  const mgrM = await inviteAndJoin("Mara Vance", "mara@audit-a.test");
  const mgrP = await inviteAndJoin("Pia Lund", "pia@audit-a.test");
  t("(setup: two manager accounts by invitation, each in an enrollment-only session)", mgrM.j.status === 200 && mgrP.j.status === 200, [mgrM.j.text, mgrP.j.text]);

  // ======== S1-01: the admin
  const { c: A, r: ra } = await signIn(ADMIN1, a1.json.password);
  t("S1-01 admin: the password alone signs in to the setup", ra.status === 200 && ra.json.enroll === true);
  const aCookie = cookieOf(A);
  t("S1-01 admin: the cookie is an enrollment-only one (its tag starts with e)", /\.e[0-9a-z]+\.[^.]+$/.test(aCookie), aCookie);
  t("S1-01 admin: browser A is refused the accounts list", (await withCookie(aCookie, "/api/admin/accounts")) === 403);
  const { c: B } = await signIn(ADMIN1, a1.json.password);
  const st = await B.post("/api/admin/accounts/me/enroll/start", {});
  const ev = await B.post("/api/admin/accounts/me/enroll/verify", { code: await codeFor(st.json.secret, -1) });
  t("S1-01 admin: browser B sets up the authenticator", ev.status === 200 && Array.isArray(ev.json.recovery_codes));
  t("S1-01 admin: and B's answer carries a full session, which reaches the accounts list", !/\.e[0-9a-z]+\.[^.]+$/.test(cookieOf(B)) && (await B.get("/api/admin/accounts")).status === 200);
  const after = await withCookie(aCookie, "/api/admin/accounts");
  t("S1-01 admin: A's unchanged cookie is now signed out (the finding: 200)", after === 401, after);
  t("S1-01 admin: and it cannot reach even the setup pages any more", (await withCookie(aCookie, "/api/admin/accounts/me")) === 401);
  t("S1-01 admin: the cookie B held during setup is over too", (await q("SELECT count(*)::int AS n FROM platform.revoked_sessions WHERE why='enrolled'")).rows[0].n >= 1);

  // ======== S1-01: the manager (invitation, then a second browser with the password)
  const mCookie = cookieOf(mgrM.c);
  t("S1-01 manager: the invitation's session is enrollment-only and refused the company's people", /\.e[0-9a-z]+\.[^.]+$/.test(mCookie) && (await withCookie(mCookie, `/api/c/${CO}/people`)) === 403);
  const { c: D, r: rd } = await signIn("mara@audit-a.test", mgrM.password);
  t("S1-01 manager: browser D signs in with the password, also to the setup", rd.status === 200 && rd.json.enroll === true);
  const ms = await D.post(`/api/c/${CO}/me/enroll/start`, {});
  const mv = await D.post(`/api/c/${CO}/me/enroll/verify`, { code: await codeFor(ms.json.secret, -1) });
  t("S1-01 manager: D sets up the app and gets a full session", mv.status === 200 && (await D.get(`/api/c/${CO}/people`)).status === 200);
  const mAfter = await withCookie(mCookie, `/api/c/${CO}/people`);
  t("S1-01 manager: the invitation browser's unchanged cookie is now signed out (the finding: 200)", mAfter === 401, mAfter);

  // ======== S1-01: a first passkey saved elsewhere ends the other enrollment-only sessions too
  const pCookie = cookieOf(mgrP.c);
  const pid = (await q("SELECT id FROM platform.accounts WHERE login='pia@audit-a.test'")).rows[0].id;
  await q("INSERT INTO platform.account_passkeys (account_id, credential_id, public_key, label) VALUES ($1, $2, $3, 'e2e')", [pid, crypto.randomBytes(16).toString("base64url"), Buffer.from("not-a-key")]);
  accounts.forget(pid);
  await sleep(10500);   // the server remembers an account's state ten seconds (another process; the setup forgets at once in its own)
  t("S1-01 first passkey: once the account has a passkey, the other enrollment-only session is signed out", (await withCookie(pCookie, `/api/c/${CO}/me`)) === 401);

  // ======== S1-02: an enrolled admin's session cannot add a factor without proving one
  await unlock(); await freshSteps(ADMIN1);
  const sec1 = st.json.secret;
  const { c: B2, r: rb2 } = await signIn(ADMIN1, a1.json.password, await codeFor(sec1));
  t("(S1-02 setup: the admin signs in with password and code)", rb2.status === 200 && !rb2.json.enroll, rb2.text);
  const bare = await B2.post("/api/me/passkeys/options", {});
  t("S1-02: adding a passkey with the session alone is refused, and says what would do (the finding: 200)", bare.status === 403 && bare.json.step_up === true && bare.json.via && bare.json.via.code === true, bare.json);
  t("S1-02: a wrong code does not do", (await B2.post("/api/me/passkeys/options", { code: "000000" })).status === 403);
  await sleep(31000 - ((Date.now() / 1000) % 30) * 1000 + 300);   // the sign-in's code step is claimed; the next one
  const proved = await B2.post("/api/me/passkeys/options", { code: await codeFor(sec1) });
  t("S1-02: a fresh code from the app does, and the passkey's challenge comes back", proved.status === 200 && proved.json.challenge, proved.text);
  // another sign-in of the same account (one that proved nothing) cannot finish the passkey this one began
  const id1 = (await q("SELECT id, generation FROM platform.accounts WHERE login=$1", [ADMIN1])).rows[0];
  const otherSession = auth.signAdmin(id1.id, id1.generation);
  t("(S1-02 setup: a second full session of the same account)", (await withCookie(otherSession, "/api/admin/accounts")) === 200);
  const r4 = await withCookie(otherSession, "/api/me/passkeys", "POST", { response: { id: "x", response: {} } });
  t("S1-02: another session of the same account cannot finish the passkey the proved one began", r4 === 403, r4);

  // the passkey offered right after the first setup, from the browser that set it up, needs no second proof, once
  const { c: E } = await signIn(ADMIN2, a2.json.password);
  const se = await E.post("/api/admin/accounts/me/enroll/start", {});
  const ve = await E.post("/api/admin/accounts/me/enroll/verify", { code: await codeFor(se.json.secret, -1) });
  t("(S1-02 setup: a second admin sets up the app)", ve.status === 200);
  t("S1-02: right after the setup, that browser may begin a passkey with no second proof", (await E.post("/api/me/passkeys/options", {})).status === 200);
  t("S1-02: once only: the next one asks for a proof", (await E.post("/api/me/passkeys/options", {})).status === 403);
  const own = await E.post("/api/me/passkeys", { response: { id: "x", response: {} } });
  t("S1-02: the session that began it gets as far as the passkey's own check (a made-up answer fails there)", own.status === 400 && /could not be checked|no passkey/.test(own.json.error), own.text);

  // a manager who signs in with a passkey adds the app only after proving a factor (here a recovery code)
  const codes = ["aaaa-bbbb-cccc-dd22", "eeee-ffff-gggg-hh33"];
  for (const c of codes) await q("INSERT INTO platform.account_recovery_codes (account_id, code_hash) VALUES ($1, $2)", [pid, accounts.recoveryHash(c)]);
  const { c: P, r: rp } = await signIn("pia@audit-a.test", mgrP.password, codes[0]);
  t("(S1-02 setup: the passkey manager signs in with a recovery code)", rp.status === 200 && !rp.json.enroll, rp.text);
  const ps = await P.post(`/api/c/${CO}/me/enroll/start`, {});
  t("S1-02 manager: adding the app with the session alone is refused (it asks for the passkey or a recovery code)", ps.status === 403 && ps.json.step_up === true && ps.json.via.passkey === true && ps.json.via.recovery === true, ps.json);
  const ps2 = await P.post(`/api/c/${CO}/me/enroll/start`, { code: codes[1] });
  t("S1-02 manager: with a recovery code it starts", ps2.status === 200 && ps2.json.secret, ps2.text);
  const pg = (await q("SELECT generation FROM platform.accounts WHERE id=$1", [pid])).rows[0].generation;
  const sneak = await withCookie(auth.signManager(pid, CO, pg), `/api/c/${CO}/me/enroll/verify`, "POST", { code: await codeFor(ps2.json.secret) });
  t("S1-02 manager: another session of the account cannot finish the app setup this one started", sneak === 403, sneak);
  const pv = await P.post(`/api/c/${CO}/me/enroll/verify`, { code: await codeFor(ps2.json.secret) });
  t("S1-02 manager: the session that proved it finishes it", pv.status === 200 && Array.isArray(pv.json.recovery_codes), pv.text);

  // ======== S1-03: logging out ends the session, and every copy of its cookie
  const floor = await login(PW.floor, "demo"), floor2 = await login(PW.floor, "demo");
  const fCopy = cookieOf(floor);
  t("(S1-03 setup: a floor device reaches its board)", (await withCookie(fCopy, "/api/c/demo/board")) === 200);
  const lo = await floor.get("/logout");
  t("S1-03 floor: /logout answers with the redirect", lo.status === 302);
  const fAfter = await withCookie(fCopy, "/api/c/demo/board");
  t("S1-03 floor: the copied cookie is signed out (the finding: 200)", fAfter === 401, fAfter);
  t("S1-03 floor: another floor device of the company carries on", (await floor2.get("/api/c/demo/board")).status === 200);
  const mgr = await login(PW.manager, "demo");
  const mCopy = cookieOf(mgr);
  await mgr.get("/logout");
  t("S1-03 manager (shared password): the copied cookie is signed out", (await withCookie(mCopy, "/api/c/demo/people")) === 401);
  const bCopy = cookieOf(B);
  t("(S1-03 setup: the admin's session works)", (await withCookie(bCopy, "/api/admin/accounts")) === 200);
  await B.get("/logout");
  t("S1-03 admin: the copied cookie is signed out (the finding: 200)", (await withCookie(bCopy, "/api/admin/accounts")) === 401);
  t("S1-03 admin: the account's other session carries on", (await B2.get("/api/admin/accounts")).status === 200);
  const who = async (v) => (await (await fetch(BASE + "/login/session", { headers: { Cookie: `sos_session=${v}` } })).json().catch(() => ({}))).signed_in;
  t("S1-03: who-am-I for anetix.ai says signed out for the copy, signed in for the live session", (await who(bCopy)) === false && (await who(cookieOf(B2))) === true);
  // a cookie in the shape from before this change (six parts, no tag): its logout ends its copies as well
  const gen = (await q("SELECT generation FROM platform.company_access WHERE company='demo'")).rows[0].generation;
  const then = Date.now() - 2 * 24 * 3600e3;
  const payload = `floor.demo.${gen}.${then.toString(36)}.${then.toString(36)}`;
  const six = `${payload}.${crypto.createHmac("sha256", process.env.SESSION_SECRET || "e2e").update(payload).digest("base64url")}`;
  t("(S1-03 setup: a six part cookie from before this change still works)", (await withCookie(six, "/api/c/demo/board")) === 200);
  await withCookie(six, "/logout");
  t("S1-03: logging out with it signs out every copy of it", (await withCookie(six, "/api/c/demo/board")) === 401);
  t("S1-03: the revocation is kept for as long as such a copy could live (its cap)", (await q("SELECT count(*)::int AS n FROM platform.revoked_sessions WHERE why='logout' AND expires_at > now() + interval '170 days'")).rows[0].n >= 1);

  // the connector consent page reads the cookie itself: a logged out or enrollment-only session is nobody there
  const mcpauth = require("../../src/mcpauth");
  const reqOf = (v) => ({ headers: { cookie: `sos_session=${v}` } });
  t("the connector consent page: a logged out admin cookie is nobody", (await mcpauth.accountOf(reqOf(bCopy))) === null);
  t("the connector consent page: an enrollment-only cookie is nobody", (await mcpauth.accountOf(reqOf(aCookie))) === null);
  t("the connector consent page: a live full session is still the account", ((await mcpauth.accountOf(reqOf(cookieOf(B2)))) || {}).login === ADMIN1);

  R.done();
})().catch(R.abort);
