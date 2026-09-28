// A sign-in straight from demo setup (the launch audit 3.8, 2026-09-28).
//
// A person who has just picked a password on anetix.ai's set-up form used to be asked for it again on /welcome a
// minute later. Now, when the product makes a demo for the person's browser (POST /api/www/companies with collect),
// it also makes a one-time ticket for the new manager account and hands it back on that answer only, over the
// private www channel (SOS_WWW_KEY). anetix.ai keeps it in the person's own signed cookie and sends the browser to
// GET /login/ticket?t=<id>.<token> when they press "Set up your authenticator". The ticket is the password step,
// once, and nothing more:
//   - it opens only an account that has NOT set up a second factor (no verified authenticator, no passkey), which is
//     the only state a password alone signs in to, and the session it starts is the enrollment-only one;
//   - one use (claimed in the same statement that checks it), SOS_SIGNIN_TICKET_MIN (60) minutes, the account's
//     generation at issue (Sign out everywhere ends it), a manager account that is switched on;
//   - a random 32 byte token; only its sha256 is kept; compared in constant time.
// Anything short of that goes to the product's own sign-in with the email filled in, where the password works as
// always. Never in the backup (like the trusted devices): a restore wipes it and raises generations anyway.
const crypto = require("crypto");
const { q } = require("./db");

const TTL_MIN = (() => { const n = Number(process.env.SOS_SIGNIN_TICKET_MIN); return Number.isFinite(n) && n > 0 ? Math.min(n, 24 * 60) : 60; })();

const SCHEMA = `
CREATE TABLE IF NOT EXISTS platform.signin_tickets (
  id          SERIAL PRIMARY KEY,
  account_id  INTEGER NOT NULL REFERENCES platform.accounts(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  generation  INTEGER NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS signin_tickets_account ON platform.signin_tickets (account_id);
`;
async function init() {
  await q(SCHEMA);
  await q("DELETE FROM platform.signin_tickets WHERE expires_at < now() - interval '7 days'");
}

// ---- pure ----------------------------------------------------------------------------------------------------
const hashToken = (token) => crypto.createHash("sha256").update(String(token || "")).digest("hex");
// "<id>.<token>" -> { id, token } or null
function parse(value) {
  const m = /^(\d{1,9})\.([A-Za-z0-9_-]{40,60})$/.exec(String(value || ""));
  return m ? { id: Number(m[1]), token: m[2] } : null;
}
function sameHash(a, b) {
  const x = Buffer.from(String(a || ""), "hex"), y = Buffer.from(String(b || ""), "hex");
  return x.length === 32 && y.length === 32 && crypto.timingSafeEqual(x, y);
}
// Is this row good for this account now? -> "ok" or why not
function judge(row, token, account, { enrolled = false, now = Date.now() } = {}) {
  if (!row) return "no_row";
  if (!sameHash(row.token_hash, hashToken(token))) return "bad_token";
  if (row.used_at) return "used";
  if (new Date(row.expires_at).getTime() <= now) return "expired";
  if (!account || account.id !== row.account_id) return "wrong_account";
  if (account.status !== "active" || account.role !== "manager" || !account.company) return "account_off";
  if (Number(account.generation) !== Number(row.generation)) return "generation";
  if (enrolled) return "enrolled";
  return "ok";
}

// ---- writes ---------------------------------------------------------------------------------------------------
// -> "<id>.<token>", the only time the token exists outside this process
async function mint(account) {
  const token = crypto.randomBytes(32).toString("base64url");
  const row = (await q("INSERT INTO platform.signin_tickets (account_id, token_hash, generation, expires_at) VALUES ($1,$2,$3, now() + make_interval(mins => $4)) RETURNING id",
    [account.id, hashToken(token), Number(account.generation) || 1, TTL_MIN])).rows[0];
  return `${row.id}.${token}`;
}
// -> { ok: true, account } or { ok: false, why, login? }. Claims the ticket on success, never twice.
async function redeem(value) {
  const p = parse(value);
  if (!p) return { ok: false, why: "malformed" };
  const row = (await q("SELECT * FROM platform.signin_tickets WHERE id=$1", [p.id])).rows[0];
  const account = row ? (await q("SELECT * FROM platform.accounts WHERE id=$1", [row.account_id])).rows[0] : null;
  let enrolled = false;
  if (account) {
    const f = (await q("SELECT 1 FROM platform.account_factors WHERE account_id=$1 AND verified_at IS NOT NULL", [account.id])).rows[0];
    const pk = (await q("SELECT 1 FROM platform.account_passkeys WHERE account_id=$1 AND removed_at IS NULL", [account.id])).rows[0];
    enrolled = Boolean(f || pk);   // any second factor at all: then the password step alone is not a sign-in, and neither is this
  }
  const why = judge(row, p.token, account, { enrolled });
  const login = account && why !== "bad_token" ? account.login : undefined;   // a wrong token names no one
  if (why !== "ok") return { ok: false, why, login };
  const claimed = (await q("UPDATE platform.signin_tickets SET used_at=now() WHERE id=$1 AND used_at IS NULL AND expires_at > now() RETURNING id", [row.id])).rows[0];
  if (!claimed) return { ok: false, why: "used", login };
  return { ok: true, account };
}

module.exports = { init, mint, redeem, parse, judge, hashToken, TTL_MIN };
