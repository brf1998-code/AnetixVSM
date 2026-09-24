// Trusted admin devices: "Remember this computer for 30 days" (2026-09-24).
//
// Once a sign-in has passed the password and the authenticator's code, the person may tick a box on the code step
// (and only there: a sign-in that used a recovery code never shows it, recovery is for getting back in, not for
// minting a device). Ticked, the platform makes a random 32 byte token, keeps its sha256 in
// platform.admin_devices, and sets cookie sos_admin_device = "<id>.<token>": HttpOnly, Secure, SameSite=Lax,
// Path limited to /login (the one route the sign-in form posts to, so no page ever sees it), Max-Age 30 days.
//
// At the next sign-in from that browser, when the password matches an enrolled account, the row is looked up by
// id, the token compared to the hash in constant time, and the row must be not removed, not expired, the account
// switched on, and carry the account's CURRENT generation. All true: the admin session is issued with no code step
// and the sign-in log says signin_trusted_device with the device id. Anything false: the code step as always, and
// the cookie is cleared when the row is expired or the generation has moved.
//
// What a trusted device never skips: the fresh code on company delete, backup restore, add account, switch on,
// new password, remove, reset authenticator (src/accounts.js stepUp is untouched). Break glass is unchanged.
//
// Keeping them: the Accounts tab lists the person's own devices (label, issued, last used) with Remove on each;
// removing asks for nothing, it only tightens. Sign out everywhere raises the generation, so every device row of
// the account stops matching. Reset authenticator deletes the account's device rows (new factor, trust again).
// Switch off: rows are refused while the account is off. Ten devices per account; the eleventh removes the oldest.
// Never in the backup (like the sign-in log); a restore wipes the table and raises generations anyway. A wrong
// password on a trusted-device sign-in counts toward the lock like any other.
//
// The honest cost: a computer holding both cookies is an admin for up to SOS_TRUSTED_DEVICE_DAYS (30) without a
// code. That is the trade GitHub and Google make. Both admin Macs need FileVault and a lock-screen timeout, and
// Sign out everywhere is the kill switch.
const crypto = require("crypto");
const { q } = require("./db");

const COOKIE = "sos_admin_device";
const COOKIE_PATH = "/login";
const DAYS = (() => { const n = Number(process.env.SOS_TRUSTED_DEVICE_DAYS); return Number.isFinite(n) && n > 0 ? n : 30; })();
const MAX_PER_ACCOUNT = 10;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS platform.admin_devices (
  id           SERIAL PRIMARY KEY,
  account_id   INTEGER NOT NULL REFERENCES platform.accounts(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL,
  label        TEXT NOT NULL DEFAULT '',
  issued_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ NOT NULL,                -- issued plus SOS_TRUSTED_DEVICE_DAYS; absolute, not sliding
  generation   INTEGER NOT NULL,                    -- the account's generation at issue: sign out everywhere ends it
  removed_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS admin_devices_account ON platform.admin_devices (account_id) WHERE removed_at IS NULL;
`;
async function init() { await q(SCHEMA); }

// ---- pure ----------------------------------------------------------------------------------------------------
const hashToken = (token) => crypto.createHash("sha256").update(String(token || "")).digest("hex");
// "<id>.<token>" -> { id, token } or null
function parseCookie(value) {
  const m = /^(\d{1,9})\.([A-Za-z0-9_-]{40,60})$/.exec(String(value || ""));
  return m ? { id: Number(m[1]), token: m[2] } : null;
}
// Is this row good for this account now? -> "ok" | "no_row" | "bad_token" | "removed" | "expired" | "generation" | "account_off" | "wrong_account"
function judge(row, token, account, now = Date.now()) {
  if (!row) return "no_row";
  if (!account || row.account_id !== account.id) return "wrong_account";
  const want = Buffer.from(String(row.token_hash || ""), "hex"), got = Buffer.from(hashToken(token), "hex");
  if (want.length !== 32 || got.length !== 32 || !crypto.timingSafeEqual(want, got)) return "bad_token";
  if (row.removed_at) return "removed";
  if (!row.expires_at || new Date(row.expires_at).getTime() <= now) return "expired";
  if (account.status !== "active") return "account_off";
  if (Number(row.generation) !== Number(account.generation)) return "generation";
  return "ok";
}
// Which of an account's live rows go when one more is added: the oldest, past the cap. rows: live rows, any order.
function overflow(rows, adding = 1, cap = MAX_PER_ACCOUNT) {
  const live = rows.slice().sort((a, b) => new Date(a.issued_at) - new Date(b.issued_at) || a.id - b.id);
  const over = live.length + adding - cap;
  return over > 0 ? live.slice(0, over).map((r) => r.id) : [];
}
// "Safari on macOS", "Chrome on Windows", "Safari on iPhone": enough to tell one's computers apart in a list.
function labelFor(ua) {
  const s = String(ua || "");
  const os = /iPhone/.test(s) ? "iPhone" : /iPad/.test(s) ? "iPad" : /Android/.test(s) ? "Android" : /Windows/.test(s) ? "Windows" : /Mac OS X|Macintosh/.test(s) ? "macOS" : /CrOS/.test(s) ? "ChromeOS" : /Linux/.test(s) ? "Linux" : "";
  const browser = /Edg\//.test(s) ? "Edge" : /OPR\/|Opera/.test(s) ? "Opera" : /Firefox\//.test(s) ? "Firefox" : /Chrome\/|CriOS\//.test(s) ? "Chrome" : /Safari\//.test(s) ? "Safari" : "";
  return browser && os ? `${browser} on ${os}` : browser || os || "a browser";
}
const cookieHeader = (req, value, maxAge) => `${COOKIE}=${value}; Path=${COOKIE_PATH}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${req.headers["x-forwarded-proto"] === "https" ? "; Secure" : ""}`;
const clearHeader = (req) => cookieHeader(req, "", 0);

// ---- rows ---------------------------------------------------------------------------------------------------
async function byId(id) { return (await q("SELECT * FROM platform.admin_devices WHERE id=$1", [Number(id) || 0])).rows[0] || null; }
// The rows that would still work: not removed, not expired, and at the account's current generation (a row left
// behind by sign out everywhere or a new password is dead, so it is not listed either).
async function liveRows(accountId) {
  return (await q(
    `SELECT d.* FROM platform.admin_devices d JOIN platform.accounts a ON a.id=d.account_id
      WHERE d.account_id=$1 AND d.removed_at IS NULL AND d.expires_at > now() AND d.generation = a.generation ORDER BY d.issued_at, d.id`, [accountId])).rows;
}
// A device for this account, from this browser. -> { id, token, label, expires_at } (the token goes into the cookie and nowhere else)
async function mint(account, ua) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + DAYS * 86400e3);
  for (const id of overflow(await liveRows(account.id))) await q("UPDATE platform.admin_devices SET removed_at=now() WHERE id=$1", [id]);
  const r = (await q(
    "INSERT INTO platform.admin_devices (account_id, token_hash, label, expires_at, generation) VALUES ($1,$2,$3,$4,$5) RETURNING id, label, issued_at, expires_at",
    [account.id, hashToken(token), labelFor(ua).slice(0, 80), expires, Number(account.generation)])).rows[0];
  return { id: r.id, token, label: r.label, issued_at: r.issued_at, expires_at: r.expires_at };
}
// The cookie against the account that just gave the right password. -> { ok: true, row } | { ok: false, why, clear }
async function check(cookieValue, account, now = Date.now()) {
  const parsed = parseCookie(cookieValue);
  if (!parsed) return { ok: false, why: "no_cookie", clear: Boolean(cookieValue) };
  const row = await byId(parsed.id);
  const why = judge(row, parsed.token, account, now);
  if (why === "ok") {
    await q("UPDATE platform.admin_devices SET last_used_at=now() WHERE id=$1", [row.id]);
    return { ok: true, row };
  }
  // an expired row or a moved generation is gone for good: clear the cookie. A wrong token is left alone (it may be
  // a stale cookie from another account on the same browser; it gets the code step and nothing more).
  return { ok: false, why, clear: ["expired", "generation", "removed", "no_row"].includes(why) };
}
const publicRow = (r) => ({ id: r.id, label: r.label, issued_at: r.issued_at, last_used_at: r.last_used_at, expires_at: r.expires_at });
async function list(accountId) { return (await liveRows(accountId)).map(publicRow); }
async function remove(accountId, id) {
  const r = await q("UPDATE platform.admin_devices SET removed_at=now() WHERE id=$1 AND account_id=$2 AND removed_at IS NULL RETURNING id, label", [Number(id) || 0, accountId]);
  return r.rows[0] || null;
}
async function removeAll(accountId) {
  const r = await q("DELETE FROM platform.admin_devices WHERE account_id=$1", [accountId]);
  return r.rowCount;
}
async function countFor(accountId) { return (await liveRows(accountId)).length; }

module.exports = { init, SCHEMA, COOKIE, COOKIE_PATH, DAYS, MAX_PER_ACCOUNT, hashToken, parseCookie, judge, overflow, labelFor, cookieHeader, clearHeader, mint, check, list, remove, removeAll, countFor, byId };
