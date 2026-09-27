// Passkeys: sign in with an email and the phone's or computer's Face ID, fingerprint or PIN (2026-09-26, Brendan:
// "this is a better route for authentication, much more durable, lets build that").
//
// Why: the sign-in was an email, a password and a 6 digit code. A passkey is one step for the person and stronger than
// both together: the private key never leaves their device, the device checks it is them (user verification is
// required, so a passkey is the possession and the face or fingerprint at once), and it only ever answers to this
// site's name, so a look-alike page cannot collect it the way it can a password and a code.
//
// What stays: the password with the authenticator app is the fallback on a device without a passkey, and the
// recovery codes are the way back from a lost phone. A passkey is added only by an account that already has its
// authenticator set up (auth.middleware keeps an account without one on its setup page), so the app is always there
// behind it. Reset authenticator on /admin takes an account's passkeys too: a reset is for a lost or taken device.
//
// Discoverable credentials (residentKey required): at sign-in the browser offers the passkeys it holds for this site,
// the server finds the account by the credential's id. Nothing at sign-in says whether an email has a passkey (the
// email typed only has to match the account the passkey belongs to), so the sign-in tells nobody which emails exist.
//
// Where the name comes from (rpID): SOS_PASSKEY_RP_ID, else the parent both the product and anetix.ai share
// (app.anetix.ai and anetix.ai -> anetix.ai), so one passkey works on the wall at anetix.ai and on the product's own
// sign-in page. The origins a response may come from: the product's own and the www service's (SOS_WWW_URL).
//
//   platform.account_passkeys   one row per passkey: the credential's id, its public key, the signature counter,
//                               a label (the device it was made on), created, last used, removed.
//   platform.accounts.passkey_handle  the random user handle the passkeys of one account share
//
// Routes:
//   GET  /api/me/passkeys                 a signed-in named account's passkeys
//   POST /api/me/passkeys/options         begin adding one (the challenge is kept five minutes, one per account)
//   POST /api/me/passkeys                 finish adding it { response, label? }
//   POST /api/me/passkeys/:id/remove      remove one (asks for nothing: it only tightens)
//   POST /login/passkey/options           begin a sign-in (public; CORS for anetix.ai like /login)
//   POST /login/passkey                   finish it { response, email? }: the same session /login gives
// auth_events: passkey_added, passkey_removed, login_passkey, passkey_refused.
const crypto = require("crypto");
const express = require("express");
const { q } = require("./db");
const accounts = require("./accounts");
const edge = require("./edge");
const authLib = () => require("./auth");

const SCHEMA = `
ALTER TABLE platform.accounts ADD COLUMN IF NOT EXISTS passkey_handle BYTEA;
CREATE TABLE IF NOT EXISTS platform.account_passkeys (
  id            SERIAL PRIMARY KEY,
  account_id    INTEGER NOT NULL REFERENCES platform.accounts(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,             -- base64url, as the browser gives it
  public_key    BYTEA NOT NULL,                   -- COSE
  counter       BIGINT NOT NULL DEFAULT 0,
  transports    TEXT[],
  backed_up     BOOLEAN NOT NULL DEFAULT false,   -- synced (iCloud Keychain, Google Password Manager) or on one device
  label         TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ,
  removed_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS account_passkeys_account ON platform.account_passkeys (account_id);`;
async function init() { await q(SCHEMA); }

const MAX_PER_ACCOUNT = 10;
const CHALLENGE_MS = 5 * 60 * 1000;
const lib = () => require("@simplewebauthn/server");
const b64u = (buf) => Buffer.from(buf).toString("base64url");

// ---- the site's name and addresses ----------------------------------------------------------------------------------
const hostOf = (s) => { try { return new URL(s).hostname; } catch (e) { return ""; } };
function requestHost(req) { return String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim().replace(/:\d+$/, "").toLowerCase(); }
// Pure. The parent the product's host and the www host share, or the product's host.
function rpIdFor(host, wwwHost, env) {
  if (env) return env.toLowerCase();
  host = String(host || "").toLowerCase(); wwwHost = String(wwwHost || "").toLowerCase().replace(/^www\./, "");
  if (wwwHost && (host === wwwHost || host.endsWith(`.${wwwHost}`))) return wwwHost;
  return host;
}
function rpId(req) { return rpIdFor(requestHost(req), hostOf(process.env.SOS_WWW_URL || ""), process.env.SOS_PASSKEY_RP_ID || ""); }
// Pure. Every origin a response may carry: https on the name itself, on any host under it the platform serves, the
// www service's, and the product's own (http only for localhost).
function originsFor({ rp, host, proto, www }) {
  const out = new Set([`https://${rp}`, `https://www.${rp}`, `https://app.${rp}`]);
  if (host && (host === rp || host.endsWith(`.${rp}`))) out.add(`${proto === "http" && host === "localhost" ? "http" : "https"}://${host}`);
  try { if (www) { const u = new URL(www); if (u.hostname === rp || u.hostname.endsWith(`.${rp}`)) out.add(u.origin); } } catch (e) {}
  return [...out];
}
function origins(req, rp) {
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim().toLowerCase();
  const proto = String(req.headers["x-forwarded-proto"] || (req.secure ? "https" : "http")).split(",")[0].trim();
  const list = originsFor({ rp, host: host.replace(/:\d+$/, ""), proto, www: process.env.SOS_WWW_URL || "" });
  // localhost keeps its port (a dev server or a test)
  if (/^localhost(:\d+)?$/.test(host) && proto === "http") list.push(`http://${host}`);
  return list;
}

// ---- challenges: kept in this process, five minutes, used once ----------------------------------------------------
const regChallenges = new Map();    // account id -> { challenge, at, rp }
const authChallenges = new Map();   // challenge -> { at, rp }
function sweep(map) { const cut = Date.now() - CHALLENGE_MS; for (const [k, v] of map) if (v.at < cut) map.delete(k); if (map.size > 5000) map.clear(); }
function takeAuthChallenge(clientDataJSON) {
  let challenge = null;
  try { challenge = JSON.parse(Buffer.from(String(clientDataJSON || ""), "base64url").toString("utf8")).challenge; } catch (e) {}
  const hit = challenge ? authChallenges.get(challenge) : null;
  if (challenge) authChallenges.delete(challenge);
  return hit && Date.now() - hit.at < CHALLENGE_MS ? { challenge, rp: hit.rp } : null;
}
// A light brake on the public begin step: 30 a minute from one address.
const begins = new Map();
function beginAllowed(ip) {
  const now = Date.now(), r = begins.get(ip);
  if (!r || now - r.at > 60000) { begins.set(ip, { at: now, n: 1 }); if (begins.size > 5000) begins.clear(); return true; }
  return ++r.n <= 30;
}

// ---- reads -----------------------------------------------------------------------------------------------------------
async function listFor(accountId) {
  return (await q("SELECT id, label, backed_up, created_at, last_used_at FROM platform.account_passkeys WHERE account_id=$1 AND removed_at IS NULL ORDER BY id", [accountId])).rows;
}
async function live(accountId) {
  return (await q("SELECT * FROM platform.account_passkeys WHERE account_id=$1 AND removed_at IS NULL ORDER BY id", [accountId])).rows;
}
// The device a passkey was made on, from the browser's own description of itself. Pure.
function labelFrom(ua) {
  ua = String(ua || "");
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /CrOS/.test(ua) ? "Chromebook" : /Linux/.test(ua) ? "Linux" : "a device";
  const br = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  return br ? `${os}, ${br}` : os;
}

// ---- adding one -----------------------------------------------------------------------------------------------------
async function handleFor(account) {
  const row = (await q("SELECT passkey_handle FROM platform.accounts WHERE id=$1", [account.id])).rows[0];
  if (row && row.passkey_handle) return row.passkey_handle;
  const h = crypto.randomBytes(32);
  await q("UPDATE platform.accounts SET passkey_handle=$2 WHERE id=$1 AND passkey_handle IS NULL", [account.id, h]);
  return (await q("SELECT passkey_handle FROM platform.accounts WHERE id=$1", [account.id])).rows[0].passkey_handle;
}
async function registrationOptions(req, account) {
  const have = await live(account.id);
  if (have.length >= MAX_PER_ACCOUNT) throw Object.assign(new Error(`this account has ${MAX_PER_ACCOUNT} passkeys, the most it can; remove one first`), { status: 400 });
  const rp = rpId(req);
  const options = await lib().generateRegistrationOptions({
    rpName: "Anetix", rpID: rp,
    userName: account.login, userDisplayName: account.name || account.login,
    userID: new Uint8Array(await handleFor(account)),
    attestationType: "none",
    excludeCredentials: have.map((p) => ({ id: p.credential_id, transports: p.transports || undefined })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    supportedAlgorithmIDs: [-7, -257],   // ES256, RS256: every platform authenticator in use
  });
  sweep(regChallenges);
  regChallenges.set(account.id, { challenge: options.challenge, at: Date.now(), rp });
  return options;
}
async function register(req, account, { response, label } = {}) {
  const pending = regChallenges.get(account.id);
  regChallenges.delete(account.id);
  if (!pending || Date.now() - pending.at > CHALLENGE_MS) throw Object.assign(new Error("that took too long; press Add a passkey again"), { status: 400 });
  let v;
  try {
    v = await lib().verifyRegistrationResponse({ response, expectedChallenge: pending.challenge, expectedOrigin: origins(req, pending.rp), expectedRPID: pending.rp, requireUserVerification: true });
  } catch (e) { throw Object.assign(new Error(`the passkey could not be checked: ${e.message}`), { status: 400 }); }
  if (!v.verified) throw Object.assign(new Error("the passkey could not be checked"), { status: 400 });
  const c = v.registrationInfo.credential;
  const name = String(label || "").replace(/\s+/g, " ").trim().slice(0, 60) || labelFrom(req.headers["user-agent"]);
  const row = (await q(`INSERT INTO platform.account_passkeys (account_id, credential_id, public_key, counter, transports, backed_up, label)
    VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (credential_id) DO NOTHING RETURNING id, label, backed_up, created_at`,
  [account.id, c.id, Buffer.from(c.publicKey), Number(c.counter || 0), Array.isArray(c.transports) ? c.transports : null, Boolean(v.registrationInfo.credentialBackedUp), name])).rows[0];
  if (!row) throw Object.assign(new Error("that passkey is already on an account"), { status: 409 });
  await accounts.event("passkey_added", { account_id: account.id, login: account.login, ip: edge.clientIp(req), detail: { passkey: row.id, label: row.label, synced: row.backed_up } });
  return row;
}
async function remove(req, account, id) {
  const r = (await q("UPDATE platform.account_passkeys SET removed_at=now() WHERE id=$1 AND account_id=$2 AND removed_at IS NULL RETURNING id, label", [Number(id), account.id])).rows[0];
  if (!r) return null;
  await accounts.event("passkey_removed", { account_id: account.id, login: account.login, ip: edge.clientIp(req), detail: { passkey: r.id, label: r.label } });
  return r;
}
// Reset authenticator on /admin: the passkeys go with the app (src/accounts.js resetFactor calls this).
async function removeAll(accountId) { await q("UPDATE platform.account_passkeys SET removed_at=now() WHERE account_id=$1 AND removed_at IS NULL", [accountId]); }

// ---- signing in with one ------------------------------------------------------------------------------------------
async function authenticationOptions(req) {
  const rp = rpId(req);
  const options = await lib().generateAuthenticationOptions({ rpID: rp, userVerification: "required", allowCredentials: [] });
  sweep(authChallenges);
  authChallenges.set(options.challenge, { at: Date.now(), rp });
  return options;
}
// -> { ok, account } | { status, error }
async function authenticate(req, { response, email } = {}) {
  const ip = edge.clientIp(req);
  const refuse = async (status, error, why, extra = {}) => { await accounts.event("passkey_refused", { ip, detail: { why, ...extra } }); return { status, error }; };
  if (!response || typeof response !== "object" || !response.id || !response.response) return refuse(400, "no passkey answer came back", "shape");
  const ch = takeAuthChallenge(response.response.clientDataJSON);
  if (!ch) return refuse(400, "that took too long; try again", "challenge");
  const pk = (await q("SELECT * FROM platform.account_passkeys WHERE credential_id=$1 AND removed_at IS NULL", [String(response.id)])).rows[0];
  if (!pk) return refuse(401, "this passkey is not on any account here (it may have been removed). Sign in with your password.", "unknown_credential");
  const a = (await q("SELECT * FROM platform.accounts WHERE id=$1", [pk.account_id])).rows[0];
  if (!a || a.status !== "active" || !["admin", "manager"].includes(a.role) || (a.role === "manager" && !a.company)) return refuse(401, "this account cannot sign in", "account", { account_id: pk.account_id });
  const wait = a.locked_until && new Date(a.locked_until) > new Date() ? Math.ceil((new Date(a.locked_until) - Date.now()) / 1000) : 0;
  if (wait) return { status: 429, retry_after: wait, error: `too many failed tries for this account; try again in ${Math.ceil(wait / 60)} min` };
  const typed = accounts.cleanLogin(email);
  if (typed && typed !== a.login) return refuse(401, `this passkey is for a different email. Choose the passkey for ${typed}, or clear the email.`, "other_email", { account_id: a.id });
  let v;
  try {
    v = await lib().verifyAuthenticationResponse({
      response, expectedChallenge: ch.challenge, expectedOrigin: origins(req, ch.rp), expectedRPID: ch.rp, requireUserVerification: true,
      credential: { id: pk.credential_id, publicKey: new Uint8Array(pk.public_key), counter: Number(pk.counter), transports: pk.transports || undefined },
    });
  } catch (e) { return refuse(401, "the passkey could not be checked", "verify", { account_id: a.id, error: e.message.slice(0, 200) }); }
  if (!v.verified) return refuse(401, "the passkey could not be checked", "verify", { account_id: a.id });
  await q("UPDATE platform.account_passkeys SET counter=$2, last_used_at=now() WHERE id=$1", [pk.id, Number(v.authenticationInfo.newCounter || 0)]);
  await q("UPDATE platform.accounts SET failed_count=0, locked_until=NULL WHERE id=$1", [a.id]);
  await accounts.event("login_passkey", { account_id: a.id, login: a.login, ip, detail: { passkey: pk.id, label: pk.label } });
  accounts.forget(a.id);
  return { ok: true, account: a };
}

// A cookie anetix.ai's own page can read, so the wall knows this browser has signed in with a passkey and offers it
// first. It carries no secret and opens nothing (the session cookie is the product's own, HttpOnly).
function hintCookie(req, rp) {
  const secure = req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
  const dom = /^localhost$|^[\d.]+$/.test(rp) ? "" : `; Domain=${rp}`;
  return `anx_pk=1; Path=/${dom}; Max-Age=${400 * 86400}; SameSite=Lax${secure}`;
}

// ---- routes ------------------------------------------------------------------------------------------------------------
const json = express.json({ limit: "64kb" });
const guard = (fn) => async (req, res) => { try { await fn(req, res); } catch (e) { res.status(e.status || 400).json({ error: e.message }); } };
const named = (req, res) => { if (req.sosAccount && req.sosAccount.id) return true; res.status(400).json({ error: "passkeys are for a personal account (an email), not a shared password" }); return false; };
const router = express.Router();   // behind auth.middleware
router.get("/api/me/passkeys", guard(async (req, res) => {
  if (!named(req, res)) return;
  res.set("Cache-Control", "no-store").json({ passkeys: await listFor(req.sosAccount.id), max: MAX_PER_ACCOUNT, login: req.sosAccount.login });
}));
router.post("/api/me/passkeys/options", json, guard(async (req, res) => {
  if (!named(req, res)) return;
  res.set("Cache-Control", "no-store").json(await registrationOptions(req, req.sosAccount));
}));
router.post("/api/me/passkeys", json, guard(async (req, res) => {
  if (!named(req, res)) return;
  const row = await register(req, req.sosAccount, req.body || {});
  res.set("Set-Cookie", hintCookie(req, rpId(req)));
  res.json({ ok: true, passkey: row });
}));
router.post("/api/me/passkeys/:id(\\d{1,9})/remove", json, guard(async (req, res) => {
  if (!named(req, res)) return;
  const gone = await remove(req, req.sosAccount, req.params.id);
  if (!gone) return res.status(404).json({ error: "no such passkey on your account" });
  res.json({ ok: true });
}));
// public: mounted before auth.middleware, with selfserve.loginCors in front (server.js)
async function beginSignIn(req, res) {
  try {
    if (!beginAllowed(edge.clientIp(req))) return res.status(429).json({ error: "too many tries; wait a minute" });
    res.set("Cache-Control", "no-store").json(await authenticationOptions(req));
  } catch (e) { res.status(500).json({ error: e.message }); }
}
async function finishSignIn(req, res) {
  try {
    const r = await authenticate(req, req.body || {});
    if (!r.ok) {
      if (r.retry_after) res.set("Retry-After", String(r.retry_after));
      return res.status(r.status || 401).json({ error: r.error });
    }
    const out = authLib().startAccountSession(req, res, r.account, { extraCookies: [hintCookie(req, rpId(req))] });
    res.json({ ...out, passkey: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

module.exports = { init, router, beginSignIn, finishSignIn, removeAll, listFor, rpIdFor, originsFor, labelFrom, SCHEMA, MAX_PER_ACCOUNT };
