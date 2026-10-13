// Named accounts: a personal login for each of the platform's own people, with
// a second factor of their own (2026-09-21).
//
// Until this, admin was one shared password in SOS_ADMIN_PASSWORD, its cookie
// carried no generation and was never re-checked, so an admin session could not
// be signed out without rotating SESSION_SECRET (which signs out every plant),
// and the second gate on delete and restore was a second copy of the same
// password. Now:
//
//   platform.accounts               who: a login (an email address, which is what
//                                   SSO would key on later), a scrypt password
//                                   hash, a generation (raise it and every session
//                                   of that account ends), a status, a lock.
//   platform.account_factors        the authenticator app's secret, encrypted the
//                                   way connection logins are (AES-256-GCM under
//                                   SOS_CONNECTION_KEY), verified_at once a first
//                                   good code came back, and last_step: the newest
//                                   time step a code was accepted for. A code is
//                                   claimed with one UPDATE ... WHERE last_step <
//                                   $step, so the same code never works twice, not
//                                   at sign-in and not for a step-up seconds later.
//   platform.account_recovery_codes ten single-use codes per account, as hashes,
//                                   shown once at enrollment.
//   platform.auth_events            who tried what from where. Insert only, never
//                                   in a backup file.
//
// Only role admin exists for now. The shape is the one managers inherit later
// (role, company), which is why it is a table and not an environment variable.
// Floor and manager logins are untouched by all of this (src/auth.js).
//
// Rules this file keeps: a secret, a code or a recovery code is never logged and
// never returned, apart from the one enrollment answer that shows the person
// their own. An unknown name and a wrong password get the same words and the
// same work. Module code's database logins (src/dbroles.js) have no rights on
// the platform schema at all, so none on these tables.
const crypto = require("crypto");
const express = require("express");
const { q } = require("./db");
const totp = require("./totp");
const qrcode = require("./qrcode");
const connections = require("./connections");   // encrypt / decrypt: one key and one format for every stored secret
const edge = require("./edge");
const devices = require("./devices");   // "remember this computer": a trusted device skips the code at sign-in
const authLib = () => require("./auth");         // at call time: auth.js requires this file

const MAX_FAILS = Number(process.env.SOS_ACCOUNT_MAX_FAILS || 5);
const LOCK_MINUTES = Number(process.env.SOS_ACCOUNT_LOCK_MIN || 15);
const RECOVERY_CODES = 10;
const MIN_PASSWORD = 12;
const EVENT_DAYS = Number(process.env.SOS_AUTH_EVENT_DAYS || 400);   // how long the sign-in log is kept
// Break glass: both phones lost. Set in Railway (which is itself behind 2FA), sign in with the password alone,
// enroll again, take the variable back out. Every sign-in under it is on the record as break_glass.
const twoFaOff = () => String(process.env.SOS_ADMIN_2FA || "").toLowerCase() === "off";
// The key the secrets are encrypted under must not be the session secret: rotating that would lock every admin out.
const keyPinned = () => Boolean(process.env.SOS_CONNECTION_KEY);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS platform.accounts (
  id            SERIAL PRIMARY KEY,
  login         TEXT NOT NULL UNIQUE,              -- lower case
  display_name  TEXT NOT NULL DEFAULT '',
  role          TEXT NOT NULL DEFAULT 'admin',     -- admin (manager later)
  company       TEXT,                              -- NULL for admin; a slug for a future manager
  password_hash TEXT NOT NULL,
  generation    INTEGER NOT NULL DEFAULT 1,        -- raise it: every session of this account ends
  status        TEXT NOT NULL DEFAULT 'active',    -- active | disabled
  failed_count  INTEGER NOT NULL DEFAULT 0,
  locked_until  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS platform.account_factors (
  id          SERIAL PRIMARY KEY,
  account_id  INTEGER NOT NULL REFERENCES platform.accounts(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL DEFAULT 'totp',
  secret_enc  BYTEA NOT NULL,
  verified_at TIMESTAMPTZ,                         -- NULL until the first good code
  last_step   BIGINT NOT NULL DEFAULT 0,           -- the newest time step a code was accepted for
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS account_factors_one ON platform.account_factors (account_id, kind);
CREATE TABLE IF NOT EXISTS platform.account_recovery_codes (
  id         SERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES platform.accounts(id) ON DELETE CASCADE,
  code_hash  TEXT NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_recovery_codes_account ON platform.account_recovery_codes (account_id);
CREATE TABLE IF NOT EXISTS platform.auth_events (
  id         BIGSERIAL PRIMARY KEY,
  at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  account_id INTEGER,                              -- no foreign key on purpose: the log outlives the account
  login      TEXT,
  ip         TEXT,
  event      TEXT NOT NULL,
  detail     JSONB
);
CREATE INDEX IF NOT EXISTS auth_events_at ON platform.auth_events (at DESC);
-- sessions someone logged out of (src/auth.js revoke; the outside audit 1A, S1-03). Not a company's, never in a backup.
CREATE TABLE IF NOT EXISTS platform.revoked_sessions (
  sid        TEXT PRIMARY KEY,
  expires_at TIMESTAMPTZ,                          -- when no copy of that cookie could live anyway; NULL = keep
  why        TEXT,
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;
async function init() {
  await q(SCHEMA);
  await q("DELETE FROM platform.auth_events WHERE at < now() - ($1 || ' days')::interval", [String(EVENT_DAYS)]);
  await q("DELETE FROM platform.revoked_sessions WHERE expires_at < now()");
  if (twoFaOff()) console.warn("[accounts] SOS_ADMIN_2FA=off: admin accounts sign in with a password alone. Take the variable back out as soon as the authenticator is set up again.");
}

// ---- small things --------------------------------------------------------------------------------
const cleanLogin = (s) => String(s || "").trim().toLowerCase().slice(0, 120);
const validLogin = (s) => /^[a-z0-9][a-z0-9._+-]*@[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(s);
const cleanName = (s) => String(s || "").replace(/\s+/g, " ").trim().slice(0, 80);
function passwordProblem(p) {
  p = String(p || "");
  if (p.length < MIN_PASSWORD) return `a password needs at least ${MIN_PASSWORD} characters`;
  if (p.length > 200) return "that password is too long";
  return null;
}
// Four words and a number: about 30 bits, behind a lock after five tries and a second factor. For a first
// password handed to a colleague, who then changes it.
function makePassword() {
  const a = authLib();
  return `${a.generatePassword()}-${a.generatePassword().replace(/-\d+$/, "")}`;
}

// Never throws: a sign-in must not fail because the log could not be written.
async function event(ev, { account_id = null, login = null, ip = null, detail = null } = {}) {
  try {
    await q("INSERT INTO platform.auth_events (account_id, login, ip, event, detail) VALUES ($1,$2,$3,$4,$5)",
      [account_id, login ? String(login).slice(0, 120) : null, ip ? String(ip).slice(0, 80) : null, ev, detail ? JSON.stringify(detail) : null]);
  } catch (e) { console.error(`[accounts] could not record ${ev}:`, e.message); }
}

const publicRow = (a) => ({
  id: a.id, login: a.login, display_name: a.display_name, role: a.role, status: a.status,
  enrolled: Boolean(a.enrolled), app: Boolean(a.has_app), locked: Boolean(a.locked_until && new Date(a.locked_until) > new Date()),
  recovery_left: a.recovery_left == null ? null : Number(a.recovery_left), last_sign_in: a.last_sign_in || null, created_at: a.created_at,
  devices: a.devices == null ? 0 : Number(a.devices),
  passkeys: a.passkeys == null ? 0 : Number(a.passkeys),
});
// enrolled: a second factor is set up. For an admin that is the authenticator app. For a manager it is the app OR a
// passkey (the launch audit 1.3, 2026-09-27, Brendan: passkey first on phones, the app and the recovery codes behind
// it): a passkey is possession and the face or fingerprint at once, so it is a factor on its own.
const LIST_SQL = `
  SELECT a.*,
    EXISTS (SELECT 1 FROM platform.account_factors f WHERE f.account_id=a.id AND f.verified_at IS NOT NULL) AS has_app,
    (EXISTS (SELECT 1 FROM platform.account_factors f WHERE f.account_id=a.id AND f.verified_at IS NOT NULL)
      OR (a.role='manager' AND EXISTS (SELECT 1 FROM platform.account_passkeys k WHERE k.account_id=a.id AND k.removed_at IS NULL))) AS enrolled,
    (SELECT count(*) FROM platform.account_recovery_codes r WHERE r.account_id=a.id AND r.used_at IS NULL) AS recovery_left,
    (SELECT max(at) FROM platform.auth_events e WHERE e.account_id=a.id AND e.event IN ('login_ok','recovery_used','break_glass','signin_trusted_device','login_passkey')) AS last_sign_in,
    (SELECT count(*) FROM platform.admin_devices d WHERE d.account_id=a.id AND d.removed_at IS NULL AND d.expires_at > now() AND d.generation = a.generation) AS devices,
    (SELECT count(*) FROM platform.account_passkeys k WHERE k.account_id=a.id AND k.removed_at IS NULL) AS passkeys
  FROM platform.accounts a`;
async function list() { return (await q(`${LIST_SQL} WHERE a.role='admin' ORDER BY a.id`)).rows.map(publicRow); }
// The manager accounts of one company (2026-09-25: a self-serve company's manager signs in with an account and an
// authenticator app, never a shared manager password; src/selfserve.js makes the account).
async function managersOf(company) { return (await q(`${LIST_SQL} WHERE a.role='manager' AND a.company=$1 ORDER BY a.id`, [company])).rows.map((a) => ({ ...publicRow(a), company: a.company })); }
async function byLogin(login) { return (await q("SELECT * FROM platform.accounts WHERE login=$1", [login])).rows[0] || null; }
async function byId(id) { return (await q("SELECT * FROM platform.accounts WHERE id=$1", [Number(id)])).rows[0] || null; }

// ---- what a session is checked against, remembered for ten seconds (the generationOf pattern in auth.js) --------
const states = new Map();   // id -> { state, at }
async function sessionState(id) {
  const hit = states.get(id);
  if (hit && Date.now() - hit.at < 10000) return hit.state;
  const a = (await q(`${LIST_SQL} WHERE a.id=$1`, [Number(id)])).rows[0];
  const state = a ? { id: a.id, login: a.login, name: a.display_name || a.login, role: a.role, company: a.company || null, status: a.status, generation: Number(a.generation), enrolled: Boolean(a.enrolled), app: Boolean(a.has_app), passkeys: Number(a.passkeys || 0) } : null;
  states.set(id, { state, at: Date.now() });
  return state;
}
function forget(id) { states.delete(Number(id)); legacy.at = 0; }

// Does the shared admin password (SOS_ADMIN_PASSWORD) still open admin? Only while no active admin account has an
// authenticator that works: that is how the first accounts get made. A factor whose secret cannot be read any more
// (a backup restored under another key) does not count, so a restore to a fresh instance cannot lock everyone out.
const legacy = { open: true, at: 0 };
async function legacyOpen() {
  if (Date.now() - legacy.at < 10000) return legacy.open;
  const rows = (await q(
    `SELECT f.secret_enc FROM platform.account_factors f JOIN platform.accounts a ON a.id=f.account_id
      WHERE f.verified_at IS NOT NULL AND f.kind='totp' AND a.role='admin' AND a.status='active'`)).rows;
  legacy.open = !rows.some((r) => readSecret(r.secret_enc));
  legacy.at = Date.now();
  return legacy.open;
}

// ---- the lock: five wrong passwords or codes, fifteen minutes -------------------------------------------
async function noteFail(a, ev, ip, detail) {
  const r = (await q(
    `UPDATE platform.accounts SET
       failed_count = CASE WHEN failed_count + 1 >= $2 THEN 0 ELSE failed_count + 1 END,
       locked_until = CASE WHEN failed_count + 1 >= $2 THEN now() + ($3 || ' minutes')::interval ELSE locked_until END,
       updated_at = now()
     WHERE id=$1 RETURNING locked_until, failed_count`, [a.id, MAX_FAILS, String(LOCK_MINUTES)])).rows[0];
  await event(ev, { account_id: a.id, login: a.login, ip, detail });
  if (r && r.failed_count === 0 && r.locked_until) {
    await event("locked", { account_id: a.id, login: a.login, ip, detail: { minutes: LOCK_MINUTES } });
    // who it is stays on the Accounts tab: the phone gets the kind of account and its company, never the email
    require("./notify").notifyEvery(`locked:${a.id}`, 30 * 60e3, "An account was locked", `${a.role === "admin" ? "An Anetix admin account" : `A manager account${a.company ? ` of ${a.company}` : ""}`} was locked for ${LOCK_MINUTES} minutes after ${MAX_FAILS} wrong tries in a row. The Accounts tab of /admin has the addresses the tries came from.`, { priority: 4, tags: ["lock"] });
  }
}
const lockedFor = (a) => (a.locked_until && new Date(a.locked_until) > new Date() ? Math.ceil((new Date(a.locked_until) - Date.now()) / 1000) : 0);
// A name nobody has gets the same lock, in memory, so the lock cannot be used to find out which names exist.
const phantoms = new Map();   // login -> { count, first, until }
function phantomLocked(login) {
  const p = phantoms.get(login);
  return p && p.until > Date.now() ? Math.ceil((p.until - Date.now()) / 1000) : 0;
}
function notePhantom(login) {
  if (phantoms.size > 5000) phantoms.clear();
  const p = phantoms.get(login) || { count: 0, until: 0 };
  p.count++;
  if (p.count >= MAX_FAILS) { p.count = 0; p.until = Date.now() + LOCK_MINUTES * 60000; }
  phantoms.set(login, p);
}
const lockedAnswer = (seconds) => ({ status: 429, retry_after: seconds, error: `too many failed tries for this name; try again in ${Math.ceil(seconds / 60)} min` });
// the work a real password check costs, so an unknown name answers no faster than a known one
let dummyHash = null;
function burn(password) { dummyHash = dummyHash || authLib().hashPassword("not-anyone's-password"); authLib().checkHash(password, dummyHash); }

// ---- the authenticator ------------------------------------------------------------------------------
function readSecret(enc) {
  try { const o = connections.decrypt(enc); return o && o.secret ? totp.base32Decode(o.secret) : null; } catch (e) { return null; }
}
async function verifiedFactor(accountId) {
  return (await q("SELECT * FROM platform.account_factors WHERE account_id=$1 AND kind='totp' AND verified_at IS NOT NULL", [accountId])).rows[0] || null;
}
// -> "ok" | "bad_code" | "replayed_code" | "no_factor" | "unreadable". The claim is the one UPDATE: two requests
// with the same good code cannot both win it.
async function useCode(accountId, code) {
  const f = await verifiedFactor(accountId);
  if (!f) return "no_factor";
  const secret = readSecret(f.secret_enc);
  if (!secret) return "unreadable";
  const step = totp.check(secret, code);
  if (step === null) return "bad_code";
  const claimed = await q("UPDATE platform.account_factors SET last_step=$2 WHERE id=$1 AND last_step < $2", [f.id, step]);
  return claimed.rowCount ? "ok" : "replayed_code";
}
const recoveryHash = (code) => crypto.createHash("sha256").update(String(code || "").toLowerCase().replace(/[^a-z0-9]/g, "")).digest("hex");
async function useRecoveryCode(accountId, code) {
  if (String(code || "").replace(/[^a-z0-9]/gi, "").length < 12) return false;
  const r = await q("UPDATE platform.account_recovery_codes SET used_at=now() WHERE account_id=$1 AND code_hash=$2 AND used_at IS NULL", [accountId, recoveryHash(code)]);
  return r.rowCount > 0;
}
function makeRecoveryCodes() {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";   // no 0 o 1 l i
  return Array.from({ length: RECOVERY_CODES }, () => {
    const raw = Array.from({ length: 16 }, () => alphabet[crypto.randomInt(alphabet.length)]).join("");
    return raw.match(/.{4}/g).join("-");
  });
}

// ---- sign in ----------------------------------------------------------------------------------------------
// -> { ok, account, enroll, trusted?, device? } | { need_code, clear_device? } | { status, error, need_code?, retry_after? }
// device: this browser's sos_admin_device cookie, if any; remember: the box on the code step; ua: for the device's label.
async function signIn({ login, password, code, ip, device, remember, ua }) {
  const name = cleanLogin(login);
  password = String(password || "");
  const nope = { status: 401, error: "that name and password did not match" };
  const a = name ? await byLogin(name) : null;
  const wait = a ? lockedFor(a) : phantomLocked(name);
  if (wait) { await event("refused_locked", { account_id: a ? a.id : null, login: name, ip }); return lockedAnswer(wait); }
  if (!a || a.status !== "active" || !["admin", "manager"].includes(a.role) || (a.role === "manager" && !a.company)) {
    burn(password); notePhantom(name);
    await event("bad_password", { login: name, ip, detail: { known: Boolean(a) } });
    return nope;
  }
  if (!authLib().checkHash(password, a.password_hash)) { await noteFail(a, "bad_password", ip); return nope; }

  const done = async (ev, extra) => {
    await q("UPDATE platform.accounts SET failed_count=0, locked_until=NULL WHERE id=$1", [a.id]);
    await event(ev, { account_id: a.id, login: a.login, ip, detail: extra || null });
    forget(a.id);
    return { ok: true, account: a, enroll: Boolean(extra && extra.enroll) };
  };
  if (twoFaOff()) return done("break_glass", { at: "sign_in" });
  const typed = String(code || "").trim();
  if (!(await verifiedFactor(a.id))) {
    // a manager who set up a passkey and no app (1.3): the password alone is never enough, or it would walk around
    // the passkey. The passkey signs in; on a device without it, a recovery code stands in for the second factor.
    if (a.role === "manager" && (await livePasskeys(a.id)) > 0) {
      if (!typed) return { need_code: true, passkey_first: true };
      if (await useRecoveryCode(a.id, typed)) {
        const left = (await q("SELECT count(*)::int AS n FROM platform.account_recovery_codes WHERE account_id=$1 AND used_at IS NULL", [a.id])).rows[0].n;
        return done("recovery_used", { left });
      }
      await noteFail(a, "bad_code", ip, { kind: "recovery", passkey_first: true });
      return { status: 401, need_code: true, passkey_first: true, error: "that recovery code did not match. This account signs in with its passkey: use Sign in with a passkey, or type one of the recovery codes you saved." };
    }
    return done("login_ok", { enroll: true });   // straight to enrollment, and nothing else (auth.middleware)
  }
  // a trusted device (src/devices.js): this browser's cookie names a live row of THIS account, at its current
  // generation, so the code step is skipped. Anything short of that is the code step as always.
  if (!typed && device) {
    const d = await devices.check(device, a);
    if (d.ok) { const out = await done("signin_trusted_device", { device: d.row.id, label: d.row.label }); return { ...out, trusted: d.row.id }; }
    await event("device_refused", { account_id: a.id, login: a.login, ip, detail: { why: d.why } });
    return { need_code: true, clear_device: d.clear };
  }
  if (!typed) return { need_code: true };
  if (/^[\d\s]+$/.test(typed)) {
    const r = await useCode(a.id, typed);
    if (r === "ok") {
      const out = await done("login_ok");
      // "remember this computer": only after the app's code, never after a recovery code (the branch below)
      if (remember) { out.device = await devices.mint(a, ua); await event("device_trusted", { account_id: a.id, login: a.login, ip, detail: { device: out.device.id, label: out.device.label, days: devices.DAYS } }); }
      return out;
    }
    if (r === "unreadable") { await event("factor_unreadable", { account_id: a.id, login: a.login, ip }); return { status: 401, need_code: true, error: "this account's authenticator cannot be checked (the platform's key changed). Another admin has to reset it." }; }
    await noteFail(a, r === "replayed_code" ? "replayed_code" : "bad_code", ip);
    return { status: 401, need_code: true, error: r === "replayed_code" ? "that code was already used. Wait for the next one." : "that code did not match" };
  }
  if (await useRecoveryCode(a.id, typed)) {
    const left = (await q("SELECT count(*)::int AS n FROM platform.account_recovery_codes WHERE account_id=$1 AND used_at IS NULL", [a.id])).rows[0].n;
    return done("recovery_used", { left });
  }
  await noteFail(a, "bad_code", ip, { kind: "recovery" });
  return { status: 401, need_code: true, error: "that code did not match" };
}

// ---- step-up: a fresh code at the moment of a destructive action -----------------------------------------------
// The code that signed the person in does not count: its step is already claimed. Under break glass there is no
// code to give, so the account's own password stands in, and the record says so.
async function stepUp(account, { code, password, passkey } = {}, ip, what, req = null) {
  const a = await byId(account.id);
  if (!a || a.status !== "active") return { ok: false, error: "this account is switched off" };
  const wait = lockedFor(a);
  if (wait) return { ok: false, error: lockedAnswer(wait).error };
  // a passkey answers for the code (2026-09-27, Brendan): this account's own, on a challenge made for it, used once
  // (src/passkeys.js checkStepUp). Only with the request in hand, which is where the site's name and origin come from.
  if (passkey && req) {
    const r = await require("./passkeys").checkStepUp(req, a, passkey);
    if (r.ok) { await event("step_up_ok", { account_id: a.id, login: a.login, ip, detail: { what, via: "passkey", passkey: r.passkey } }); return { ok: true }; }
    await noteFail(a, "step_up_fail", ip, { what, kind: "passkey", why: r.why });
    return { ok: false, error: r.error };
  }
  if (twoFaOff()) {
    if (authLib().checkHash(String(password || ""), a.password_hash)) { await event("break_glass", { account_id: a.id, login: a.login, ip, detail: { at: "step_up", what } }); return { ok: true }; }
    await noteFail(a, "step_up_fail", ip, { what, kind: "password" });
    return { ok: false, error: "wrong password" };
  }
  const r = await useCode(a.id, code);
  if (r === "ok") { await event("step_up_ok", { account_id: a.id, login: a.login, ip, detail: { what } }); return { ok: true }; }
  if (r === "no_factor") return { ok: false, error: "set up your authenticator app first" };
  if (r === "unreadable") return { ok: false, error: "this account's authenticator cannot be checked (the platform's key changed)" };
  await noteFail(a, r === "replayed_code" ? "replayed_code" : "step_up_fail", ip, { what });
  return { ok: false, error: r === "replayed_code" ? "that code was already used (signing in used it). Wait for the next one, up to 30 seconds." : "that code did not match" };
}

async function livePasskeys(accountId) {
  return (await q("SELECT count(*)::int AS n FROM platform.account_passkeys WHERE account_id=$1 AND removed_at IS NULL", [accountId]).catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n;
}
// A manager's first passkey as the account's first factor (1.3): the recovery codes are made here, as the app's
// setup makes them, and shown once. src/passkeys.js calls this after a passkey is added.
async function passkeyEnrolled(account, ip) {
  const a = await byId(account.id);
  // a manager with no app and a passkey, and no unused recovery code: the first passkey, or a first one whose codes
  // never reached the page (the answer was lost after the passkey was saved), or every code used up
  if (!a || a.role !== "manager" || (await verifiedFactor(a.id)) || (await livePasskeys(a.id)) < 1) return null;
  if ((await q("SELECT 1 FROM platform.account_recovery_codes WHERE account_id=$1 AND used_at IS NULL LIMIT 1", [a.id])).rows.length) return null;
  const codes = makeRecoveryCodes();   // a fresh set, as the app's setup makes (any earlier ones stop working)
  await q("DELETE FROM platform.account_recovery_codes WHERE account_id=$1", [a.id]);
  for (const c of codes) await q("INSERT INTO platform.account_recovery_codes (account_id, code_hash) VALUES ($1,$2)", [a.id, recoveryHash(c)]);
  await event("enrolled", { account_id: a.id, login: a.login, ip, detail: { factor: "passkey" } });
  forget(a.id);
  return codes;
}

// ---- a further factor on an account that has one (the outside audit 1A, S1-02, 2026-10-13) ----------------------------
// Before this, any live session of an enrolled account could add a passkey: a stolen cookie became a way in of its own
// that outlived the session, and answered for the step-up on admin actions. Now adding a factor to an account that
// already has one takes a fresh proof of one it has (a passkey, or a code from the app; the password under break
// glass), in the same request that begins the adding, and what that proof allows is bound to this session and used
// once (src/passkeys.js keeps the session's id with the challenge; the app's setup keeps it below until its code is
// checked). The one exception: the next factor added in the ten minutes after the first one was set up, from the
// browser that set it up (the passkey offered right after the app), since that browser proved a factor a moment ago.
const GRANT_MS = 10 * 60e3;
const grants = new Map();   // session id -> { account, generation, at }
function grantNewFactor(sid, st) {
  if (!sid || !st) return;
  if (grants.size > 5000) grants.clear();
  grants.set(sid, { account: st.id, generation: st.generation, at: Date.now() });
}
function takeGrant(sid, st) {
  const g = sid ? grants.get(sid) : null;
  if (g) grants.delete(sid);
  return Boolean(g && g.account === st.id && g.generation === st.generation && Date.now() - g.at < GRANT_MS);
}
// What a proof may be for this account, for the page to ask the right thing.
const proofVia = (st) => ({ passkey: st.passkeys > 0, code: Boolean(st.app), recovery: true, password: twoFaOff() });
// -> true when this request may begin adding a factor; otherwise it has answered 403 { step_up, via }.
async function proveForNewFactor(req, res, what) {
  if (authLib().OPEN) return true;
  const me = req.sosAccount;
  if (!me || !me.id) { res.status(400).json({ error: "this is for a personal account (an email)" }); return false; }
  forget(me.id);
  const st = await sessionState(me.id);
  if (!st) { res.status(401).json({ error: "login required" }); return false; }
  if (!st.enrolled) return true;   // the first factor: nothing to prove yet (and the session is enrollment-only)
  const sid = req.sosSession && req.sosSession.sid;
  if (takeGrant(sid, st)) { await event("new_factor_after_enroll", { account_id: st.id, login: st.login, ip: edge.clientIp(req), detail: { what } }); return true; }
  const b = req.body || {};
  const via = proofVia(st);
  if (!b.passkey && !String(b.code || "").trim() && !String(b.password || "").trim()) {
    res.status(403).json({ error: "Confirm it is you first, with a passkey this account already has, a fresh code from its authenticator app or one of its recovery codes.", step_up: true, via });
    return false;
  }
  // one of the account's recovery codes is a factor it has too (a manager on passkeys whose phone is gone, adding the app)
  const typed = String(b.code || "").trim();
  if (!b.passkey && typed && !/^[\d\s]+$/.test(typed)) {
    const a = await byId(st.id);
    if (a && !lockedFor(a) && await useRecoveryCode(st.id, typed)) { await event("recovery_used", { account_id: st.id, login: st.login, ip: edge.clientIp(req), detail: { at: "new_factor", what } }); return true; }
    if (a) await noteFail(a, "step_up_fail", edge.clientIp(req), { what, kind: "recovery" });
    res.status(403).json({ error: "that recovery code did not match", step_up: true, via });
    return false;
  }
  const r = await stepUp(me, { code: b.code, password: b.password, passkey: b.passkey }, edge.clientIp(req), what, req);
  if (!r.ok) { res.status(403).json({ error: r.error, step_up: true, via }); return false; }
  return true;
}
// The app's setup on an account that has a passkey already (a manager adding the app from Settings): the start was
// proved, and its code is checked only from the same session within the same ten minutes.
const appStarts = new Map();   // account id -> { sid, at }
function appStartOk(req, st) {
  const s = appStarts.get(st.id);
  const sid = req.sosSession && req.sosSession.sid;
  return Boolean(s && sid && s.sid === sid && Date.now() - s.at < GRANT_MS);
}

// ---- enrollment ------------------------------------------------------------------------------------------
async function enrollStart(account, ip, origin) {
  if (!keyPinned()) throw new Error("SOS_CONNECTION_KEY is not set on this instance. Set it first (any long random string): without it the authenticator secrets would be encrypted under SESSION_SECRET, and rotating that would lock every admin out.");
  if (await verifiedFactor(account.id)) throw new Error("an authenticator is already set up for this account; reset it first");
  const secret = totp.newSecret(), b32 = totp.base32Encode(secret);
  await q(
    `INSERT INTO platform.account_factors (account_id, kind, secret_enc) VALUES ($1,'totp',$2)
     ON CONFLICT (account_id, kind) DO UPDATE SET secret_enc=EXCLUDED.secret_enc, verified_at=NULL, last_step=0, created_at=now()`,
    [account.id, connections.encrypt({ secret: b32 })]);
  await event("enroll_started", { account_id: account.id, login: account.login, ip });
  // the issuer names the instance, so a test instance and the live one are told apart in the app
  const issuer = /localhost|127\.0\.0\.1/.test(origin || "") ? "Anetix (local)" : "Anetix";
  const uri = totp.uri(secret, account.login, issuer);
  // uri: the same secret as a link, so a phone setting up the app on itself can open the app with it (the launch audit
  // 1.2: a QR code on the phone that has to scan it)
  return { secret: b32.match(/.{1,4}/g).join(" "), qr_svg: qrcode.svg(uri, { size: 220 }), uri };
}
async function enrollVerify(account, code, ip) {
  const f = (await q("SELECT * FROM platform.account_factors WHERE account_id=$1 AND kind='totp'", [account.id])).rows[0];
  if (!f) throw new Error("start the setup first");
  if (f.verified_at) throw new Error("an authenticator is already set up for this account");
  const secret = readSecret(f.secret_enc);
  const step = secret ? totp.check(secret, code) : null;
  if (step === null) { await noteFail(await byId(account.id), "bad_code", ip, { at: "enroll" }); return null; }
  const r = await q("UPDATE platform.account_factors SET verified_at=now(), last_step=$2 WHERE id=$1 AND verified_at IS NULL", [f.id, step]);
  if (!r.rowCount) throw new Error("an authenticator is already set up for this account");
  const codes = makeRecoveryCodes();
  await q("DELETE FROM platform.account_recovery_codes WHERE account_id=$1", [account.id]);
  for (const c of codes) await q("INSERT INTO platform.account_recovery_codes (account_id, code_hash) VALUES ($1,$2)", [account.id, recoveryHash(c)]);
  await event("enrolled", { account_id: account.id, login: account.login, ip });
  forget(account.id);
  return codes;
}

// ---- keeping the list ---------------------------------------------------------------------------------------
async function create({ login, display_name, password, role = "admin", company = null }, by, ip) {
  const name = cleanLogin(login);
  if (!validLogin(name)) throw new Error("the name is an email address, like maria@anetix.com");
  if (await byLogin(name)) throw new Error("there is already an account with that name");
  if (!["admin", "manager"].includes(role)) throw new Error("the role is admin or manager");
  if (role === "manager" && !company) throw new Error("a manager account belongs to a company");
  const made = password ? null : makePassword();
  const problem = passwordProblem(password || made);
  if (problem) throw new Error(problem);
  const a = (await q("INSERT INTO platform.accounts (login, display_name, role, company, password_hash) VALUES ($1,$2,$3,$4,$5) RETURNING *",
    [name, cleanName(display_name) || name, role, role === "manager" ? company : null, authLib().hashPassword(password || made)])).rows[0];
  await event("account_created", { account_id: a.id, login: a.login, ip, detail: { by, role, company: a.company } });
  return { account: { ...publicRow(a), company: a.company }, password: made };
}
// A manager's own enrollment and who-am-I, from the company's side (auth.MANAGER_ENROLL_PATHS lets an account
// without an authenticator reach these and nothing else). The account must be a manager of THIS company.
const mineManager = (req, res) => {
  const a = req.sosAccount;
  if (a && a.id && a.role === "manager" && a.company === req.params.slug) return true;
  res.status(403).json({ error: "this is for a manager account of this company" }); return false;
};
async function setStatus(id, status, by, ip) {
  const a = await byId(id); if (!a) throw new Error("no such account");
  await q("UPDATE platform.accounts SET status=$2, generation=generation+1, failed_count=0, locked_until=NULL, updated_at=now() WHERE id=$1", [a.id, status]);
  forget(a.id);
  await event(status === "active" ? "account_enabled" : "account_disabled", { account_id: a.id, login: a.login, ip, detail: { by } });
}
async function signOutEverywhere(id, by, ip) {
  const a = await byId(id); if (!a) throw new Error("no such account");
  await q("UPDATE platform.accounts SET generation=generation+1, updated_at=now() WHERE id=$1", [a.id]);
  forget(a.id);
  await event("signed_out_everywhere", { account_id: a.id, login: a.login, ip, detail: { by } });
}
async function resetFactor(id, by, ip) {
  const a = await byId(id); if (!a) throw new Error("no such account");
  await q("DELETE FROM platform.account_factors WHERE account_id=$1", [a.id]);
  await q("DELETE FROM platform.account_recovery_codes WHERE account_id=$1", [a.id]);
  await devices.removeAll(a.id);   // a new factor means trusting each computer again
  await require("./passkeys").removeAll(a.id);   // and a reset is for a lost or taken device: its passkeys go too
  await q("UPDATE platform.accounts SET generation=generation+1, failed_count=0, locked_until=NULL, updated_at=now() WHERE id=$1", [a.id]);
  forget(a.id);
  await event("factor_reset", { account_id: a.id, login: a.login, ip, detail: { by } });
}
// Gone for good: the row, and with it the password hash, the authenticator secret and the recovery codes (the two
// tables cascade). Only an account that is switched off, so nothing can be removed in one press, and never your own.
// The sign-in log keeps every line it wrote under the account's id and login: that history is the instance's, not the
// account's.
async function remove(id, by, ip) {
  const a = await byId(id); if (!a) throw new Error("no such account");
  if (a.status !== "disabled") throw new Error("switch the account off first, then remove it");
  const enrolled = Boolean(await verifiedFactor(a.id));
  await q("DELETE FROM platform.accounts WHERE id=$1", [a.id]);
  forget(a.id);
  await event("account_removed", { account_id: a.id, login: a.login, ip, detail: { by, had_authenticator: enrolled } });
}
async function setPassword(id, password, by, ip, { made = false } = {}) {
  const a = await byId(id); if (!a) throw new Error("no such account");
  const next = made ? makePassword() : String(password || "");
  const problem = passwordProblem(next); if (problem) throw new Error(problem);
  await q("UPDATE platform.accounts SET password_hash=$2, generation=generation+1, failed_count=0, locked_until=NULL, updated_at=now() WHERE id=$1", [a.id, authLib().hashPassword(next)]);
  forget(a.id);
  await event("password_changed", { account_id: a.id, login: a.login, ip, detail: { by, reset: made } });
  return made ? next : null;
}

// ---- routes (mounted below auth.middleware; every one of them is admin's) -----------------------------------
// /api/admin/accounts/me and the two enroll routes are the ONLY things an account without an authenticator may
// reach besides the admin page itself (auth.ENROLL_PATHS).
const router = express.Router();
// the platform's own internal calls (the checks it runs against a staged build) are admin everywhere else; they have no business here
router.use("/api/admin/accounts", (req, res, next) => (req.sosInternal ? res.status(403).json({ error: "not for the platform's internal calls" }) : next()));
const json = express.json({ limit: "100kb" });
const who = (req) => (req.sosAccount ? req.sosAccount.login : "the shared admin password");
const mine = (req, res) => { if (req.sosAccount && req.sosAccount.id) return true; res.status(400).json({ error: "this is for a named account; you are signed in with the shared admin password" }); return false; };
const guard = (fn) => async (req, res) => { try { await fn(req, res); } catch (e) { res.status(400).json({ error: e.message }); } };
// What a destructive or account-making action needs on top of the session. A named account gives a fresh code (its
// password under break glass). The shared admin password's session needs nothing more here: it exists only until the
// first authenticator is set up, and typing the same password twice proves nothing.
async function needStepUp(req, res, what) {
  const a = authLib();
  if (a.OPEN || !req.sosAccount || !req.sosAccount.id) return true;
  const r = await stepUp(req.sosAccount, req.body || {}, edge.clientIp(req), what, req);
  if (!r.ok) res.status(403).json({ error: r.error, step_up: true });
  return r.ok;
}

router.get("/api/admin/accounts/me", (req, res, next) => authLib().requireAdmin(req, res, next), guard(async (req, res) => {
  const me = req.sosAccount && req.sosAccount.id ? { ...req.sosAccount } : null;
  if (me) { const st = await sessionState(me.id); if (st) { me.app = st.app; me.passkeys = st.passkeys; } }
  res.json({
    me, shared_password: !me && !authLib().OPEN, open: authLib().OPEN,
    enroll_required: Boolean(me && !me.enrolled && !twoFaOff()),
    step_up: me ? (twoFaOff() ? "password" : "code") : "shared_password",
    two_fa_off: twoFaOff(), key_pinned: keyPinned(), shared_password_open: await legacyOpen(),
  });
}));
router.post("/api/admin/accounts/me/enroll/start", (req, res, next) => authLib().requireAdmin(req, res, next), json, guard(async (req, res) => {
  if (!mine(req, res)) return;
  res.set("Cache-Control", "no-store");
  res.json(await enrollStart(req.sosAccount, edge.clientIp(req), `${req.headers.host || ""}`));
}));
router.post("/api/admin/accounts/me/enroll/verify", (req, res, next) => authLib().requireAdmin(req, res, next), json, guard(async (req, res) => {
  if (!mine(req, res)) return;
  const codes = await enrollVerify(req.sosAccount, (req.body || {}).code, edge.clientIp(req));
  if (!codes) return res.status(401).json({ error: "that code did not match. Check the phone's clock is set automatically, then type the code it shows now." });
  await authLib().finishEnrollment(req, res);   // this browser proved the factor: its enrollment-only session becomes a full one
  res.set("Cache-Control", "no-store");
  res.json({ ok: true, recovery_codes: codes });
}));
router.post("/api/admin/accounts/me/password", (req, res, next) => authLib().requireAdmin(req, res, next), json, guard(async (req, res) => {
  if (!mine(req, res)) return;
  const { current, next: wanted } = req.body || {};
  const a = await byId(req.sosAccount.id);
  if (!a || !authLib().checkHash(String(current || ""), a.password_hash)) { if (a) await noteFail(a, "bad_password", edge.clientIp(req), { at: "change_password" }); return res.status(403).json({ error: "the current password did not match" }); }
  await setPassword(a.id, wanted, who(req), edge.clientIp(req));
  res.json({ ok: true, signed_out: true });   // the generation went up: this session ends too
}));

// The person's own trusted devices (src/devices.js): the list, and Remove, which asks for nothing (it only tightens).
router.get("/api/admin/accounts/me/devices", (req, res, next) => authLib().requireAdmin(req, res, next), guard(async (req, res) => {
  if (!mine(req, res)) return;
  res.set("Cache-Control", "no-store").json({ devices: await devices.list(req.sosAccount.id), days: devices.DAYS, max: devices.MAX_PER_ACCOUNT });
}));
router.post("/api/admin/accounts/me/devices/:id(\\d{1,9})/remove", (req, res, next) => authLib().requireAdmin(req, res, next), json, guard(async (req, res) => {
  if (!mine(req, res)) return;
  const gone = await devices.remove(req.sosAccount.id, req.params.id);
  if (!gone) return res.status(404).json({ error: "no such device on your account" });
  await event("device_removed", { account_id: req.sosAccount.id, login: req.sosAccount.login, ip: edge.clientIp(req), detail: { device: gone.id, label: gone.label } });
  res.json({ ok: true });
}));

router.get("/api/c/:slug/me", (req, res, next) => authLib().requireManager(req, res, next), guard(async (req, res) => {
  const me = req.sosAccount && req.sosAccount.id ? { ...req.sosAccount } : null;
  if (me) { const st = await sessionState(me.id); if (st) { me.app = st.app; me.passkeys = st.passkeys; } }
  res.set("Cache-Control", "no-store").json({ me, role: req.sosRole, company: req.sosCompany, enroll_required: Boolean(me && me.role === "manager" && !me.enrolled && !twoFaOff()), key_pinned: keyPinned(), two_fa_off: twoFaOff() });
}));
// A manager who signs in with a passkey and adds the app (Settings): the passkey (or a recovery code) is proved first, as
// for any further factor (S1-02), and the app's code is checked only from the session that started the setup.
router.post("/api/c/:slug/me/enroll/start", (req, res, next) => authLib().requireManager(req, res, next), json, guard(async (req, res) => {
  if (!mineManager(req, res)) return;
  if (!(await proveForNewFactor(req, res, "add_app"))) return;
  const st = await sessionState(req.sosAccount.id);
  if (st && st.enrolled) appStarts.set(st.id, { sid: req.sosSession && req.sosSession.sid, at: Date.now() });
  res.set("Cache-Control", "no-store").json(await enrollStart(req.sosAccount, edge.clientIp(req), req.headers.origin || req.headers.host));
}));
router.post("/api/c/:slug/me/enroll/verify", (req, res, next) => authLib().requireManager(req, res, next), json, guard(async (req, res) => {
  if (!mineManager(req, res)) return;
  forget(req.sosAccount.id);
  const st = await sessionState(req.sosAccount.id);
  if (st && st.enrolled && !appStartOk(req, st)) return res.status(403).json({ error: "Start the app's setup again (it asks for your passkey first).", step_up: true });
  const codes = await enrollVerify(req.sosAccount, String((req.body || {}).code || ""), edge.clientIp(req));
  if (!codes) return res.status(401).json({ error: "that code did not match. Wait for the app to show the next one and try again." });
  if (st) appStarts.delete(st.id);
  await authLib().finishEnrollment(req, res);   // a first factor: this browser's enrollment-only session becomes a full one
  res.set("Cache-Control", "no-store").json({ ok: true, recovery_codes: codes });
}));
router.post("/api/c/:slug/me/password", (req, res, next) => authLib().requireManager(req, res, next), json, guard(async (req, res) => {
  if (!mineManager(req, res)) return;
  const { current, password } = req.body || {};
  const a = await byId(req.sosAccount.id);
  if (!authLib().checkHash(String(current || ""), a.password_hash)) return res.status(401).json({ error: "the current password did not match" });
  await setPassword(a.id, password, a.login, edge.clientIp(req));
  res.json({ ok: true, signed_out: true });
}));

router.get("/api/admin/accounts", (req, res, next) => authLib().requireAdmin(req, res, next), guard(async (req, res) => {
  const events = (await q("SELECT id, at, account_id, login, ip, event, detail FROM platform.auth_events ORDER BY id DESC LIMIT 60")).rows;
  res.json({ accounts: await list(), events, shared_password_open: await legacyOpen(), two_fa_off: twoFaOff(), key_pinned: keyPinned(), lock: { fails: MAX_FAILS, minutes: LOCK_MINUTES }, edge: edge.status(req), trusted_days: devices.DAYS });
}));
router.post("/api/admin/accounts", (req, res, next) => authLib().requireAdmin(req, res, next), json, guard(async (req, res) => {
  if (!(await needStepUp(req, res, "create_account"))) return;
  const { login, display_name, password, generate } = req.body || {};
  const out = await create({ login, display_name, password: generate ? "" : password }, who(req), edge.clientIp(req));
  res.set("Cache-Control", "no-store");
  res.json({ ok: true, ...out });
}));
router.post("/api/admin/accounts/:id(\\d{1,9})/:action", (req, res, next) => authLib().requireAdmin(req, res, next), json, guard(async (req, res) => {
  const id = Number(req.params.id), action = req.params.action, ip = edge.clientIp(req), self = Boolean(req.sosAccount && req.sosAccount.id === id);
  if (!(await byId(id))) return res.status(404).json({ error: "no such account" });
  if (action === "disable") {
    if (self) return res.status(400).json({ error: "you cannot switch off the account you are signed in with" });
    await setStatus(id, "disabled", who(req), ip); return res.json({ ok: true });
  }
  if (action === "signout") { await signOutEverywhere(id, who(req), ip); return res.json({ ok: true, signed_out: self }); }
  if (!["enable", "reset-factor", "reset-password", "remove"].includes(action)) return res.status(404).json({ error: "no such action" });
  if (action === "remove" && self) return res.status(400).json({ error: "you cannot remove the account you are signed in with" });
  if (!(await needStepUp(req, res, `${action}:${id}`))) return;
  if (action === "enable") { await setStatus(id, "active", who(req), ip); return res.json({ ok: true }); }
  if (action === "remove") { await remove(id, who(req), ip); return res.json({ ok: true }); }
  if (action === "reset-factor") { await resetFactor(id, who(req), ip); return res.json({ ok: true, signed_out: self }); }
  if (self) return res.status(400).json({ error: "change your own password with Change my password" });
  res.set("Cache-Control", "no-store");
  res.json({ ok: true, password: await setPassword(id, null, who(req), ip, { made: true }) });
}));

module.exports = {
  managersOf, makePassword,
  grantNewFactor, proveForNewFactor,
  init, router, signIn, stepUp, sessionState, legacyOpen, forget, twoFaOff, keyPinned, event, list, create,
  enrollStart, enrollVerify, passkeyEnrolled, livePasskeys, useCode, useRecoveryCode, signOutEverywhere, setStatus, resetFactor, setPassword, remove,
  cleanLogin, validLogin, passwordProblem, makeRecoveryCodes, recoveryHash, MAX_FAILS, LOCK_MINUTES,
};
