// Sign in with Google or Microsoft (2026-10-29, Brendan's request #301: "We need to have auth login, so people can login
// from their google or Microsoft accounts or other, that will be much easier for most people"). His decision the same
// morning: for managers and admins (and a demo's sign-up, the www service's part, not built here), beside the email,
// password and second factor; never the floor, which signs in with its PIN.
//
// How an account comes to use it: CONNECTED, never matched by email. A person signs in the usual way (a full session:
// a password and a second factor, or a passkey), presses Connect Google or Connect Microsoft on Settings (a manager) or
// the Accounts tab (an admin), and signs in there once; the provider's own id for them is kept on their account
// (platform.account_identities: Google's "sub", Microsoft's tenant and object id). From then on Sign in with Google on
// the login page signs that account in. An email is never what links the two: a provider's email claim is not always
// one the person proved they own (Microsoft's can be set by a tenant's own admin), and matching on it is how other
// products were taken over. A Google or Microsoft sign-in counts as the whole sign-in, second factor included: both
// providers hold their own second factor, and Brendan chose it as the second route beside ours.
//
// The flow is the authorization code flow with PKCE. The state, the nonce and the code verifier ride in one signed,
// HttpOnly cookie on /login/oidc for ten minutes. The ID token comes straight from the provider's token endpoint over
// TLS with this instance's client secret, so its signature is not checked here (OpenID Connect Core 3.1.3.7: the TLS
// connection stands in for it); its issuer, audience, expiry, issue time and nonce are.
//
// Off until a provider's client id and secret are set, and SOS_PUBLIC_URL names this instance (the address the
// provider sends people back to). Each provider is its own switch:
//   SOS_GOOGLE_CLIENT_ID, SOS_GOOGLE_CLIENT_SECRET
//   SOS_MS_CLIENT_ID, SOS_MS_CLIENT_SECRET, SOS_MS_TENANT (default "common": work, school and personal accounts;
//     "organizations" for work and school only, or one tenant's id to allow only that company's)
// The redirect addresses to register with each provider: <SOS_PUBLIC_URL>/login/oidc/google/callback and
// <SOS_PUBLIC_URL>/login/oidc/microsoft/callback. SOS_OIDC_STUB points both at a stand-in provider for the tests and
// is refused on a hosted instance.
//
// Routes (public: mounted before the sign-in middleware, server.js; the link mode reads the session cookie itself):
//   GET  /login/oidc/providers                    which providers are on
//   GET  /login/oidc/:provider?next=&link=1       begin: to the provider (link=1: connect it to the signed-in account)
//   GET  /login/oidc/:provider/callback           the provider sends the person back here
//   GET  /api/me/identities                       a signed-in named account's connected identities
//   POST /api/me/identities/:id/remove            disconnect one
// auth_events: oidc_linked, oidc_unlinked, login_oidc, oidc_refused.
const crypto = require("crypto");
const express = require("express");
const { q } = require("./db");
const accounts = require("./accounts");
const edge = require("./edge");
const authLib = () => require("./auth");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS platform.account_identities (
  id           SERIAL PRIMARY KEY,
  account_id   INTEGER NOT NULL REFERENCES platform.accounts(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL,                    -- google | microsoft
  subject      TEXT NOT NULL,                    -- google: sub; microsoft: <tid>:<oid>
  email        TEXT,                             -- what the provider showed, for the person to recognize; never used to match
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  UNIQUE (provider, subject)
);
`;
async function init() { await q(SCHEMA); }

const HOSTED = () => Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_SERVICE_ID || process.env.NODE_ENV === "production");
const STUB = () => (!HOSTED() && process.env.SOS_OIDC_STUB ? String(process.env.SOS_OIDC_STUB).replace(/\/+$/, "") : null);
// The instance's own address: an https origin with no path (http only off a hosted instance, for the tests).
function publicUrl() {
  const raw = String(process.env.SOS_PUBLIC_URL || "").trim().replace(/\/+$/, "");
  let u; try { u = new URL(raw); } catch (e) { return null; }
  if (u.pathname !== "/" && u.pathname !== "") return null;
  if (u.protocol !== "https:" && !(u.protocol === "http:" && !HOSTED())) return null;
  return `${u.protocol}//${u.host}`;
}
const MS_PERSONAL = "9188040d-6c67-4c5b-b112-36a304b66dad";   // the tenant every personal Microsoft account is in
function providers() {
  const out = {}, stub = STUB();
  if (!publicUrl()) return out;
  if (process.env.SOS_GOOGLE_CLIENT_ID && process.env.SOS_GOOGLE_CLIENT_SECRET) out.google = {
    name: "Google", id: process.env.SOS_GOOGLE_CLIENT_ID, secret: process.env.SOS_GOOGLE_CLIENT_SECRET,
    authorize: stub ? `${stub}/google/authorize` : "https://accounts.google.com/o/oauth2/v2/auth",
    token: stub ? `${stub}/google/token` : "https://oauth2.googleapis.com/token",
    issuer: (iss) => (stub ? iss === `${stub}/google` : iss === "https://accounts.google.com" || iss === "accounts.google.com"),
    subject: (c) => (c.sub ? String(c.sub) : null),
  };
  if (process.env.SOS_MS_CLIENT_ID && process.env.SOS_MS_CLIENT_SECRET) {
    const tenant = String(process.env.SOS_MS_TENANT || "common").trim();
    const oneTenant = /^[0-9a-f-]{36}$/i.test(tenant) ? tenant.toLowerCase() : null;
    out.microsoft = {
      name: "Microsoft", id: process.env.SOS_MS_CLIENT_ID, secret: process.env.SOS_MS_CLIENT_SECRET,
      authorize: stub ? `${stub}/microsoft/authorize` : `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize`,
      token: stub ? `${stub}/microsoft/token` : `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,
      issuer: (iss, c) => {
        const tid = String(c.tid || "").toLowerCase();
        if (!/^[0-9a-f-]{36}$/.test(tid)) return false;
        if (oneTenant && tid !== oneTenant) return false;
        if (tenant === "organizations" && tid === MS_PERSONAL) return false;
        return iss === (stub ? `${stub}/microsoft/${tid}/v2.0` : `https://login.microsoftonline.com/${tid}/v2.0`);
      },
      subject: (c) => (c.tid && c.oid ? `${String(c.tid).toLowerCase()}:${String(c.oid).toLowerCase()}` : null),
    };
  }
  return out;
}
const redirectUri = (name) => `${publicUrl()}/login/oidc/${name}/callback`;

// ---- the state cookie ------------------------------------------------------------------------------------------------
const STATE_COOKIE = "sos_oidc";
const STATE_MS = 10 * 60e3;
const b64u = (buf) => Buffer.from(buf).toString("base64url");
function writeState(req, res, data) {
  const payload = b64u(JSON.stringify({ ...data, exp: Date.now() + STATE_MS }));
  const value = `${payload}.${authLib().hmac(`oidc.${payload}`)}`;
  const secure = req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
  res.append("Set-Cookie", `${STATE_COOKIE}=${value}; Path=/login/oidc; HttpOnly; SameSite=Lax; Max-Age=${STATE_MS / 1000}${secure}`);
}
function readState(req) {
  const raw = authLib().parseCookies(req)[STATE_COOKIE];
  const [payload, mac] = String(raw || "").split(".");
  if (!payload || !mac) return null;
  const want = authLib().hmac(`oidc.${payload}`);
  if (mac.length !== want.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return null;
  let d; try { d = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch (e) { return null; }
  return d && d.exp > Date.now() ? d : null;
}
const clearState = (res) => res.append("Set-Cookie", `${STATE_COOKIE}=; Path=/login/oidc; HttpOnly; SameSite=Lax; Max-Age=0`);
const same = (a, b) => { const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || "")); return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y); };

// The named account whose full session this request carries, or null. The cookie is read here, so the same checks the
// middleware makes: revoked, enrollment-only, the account's generation and standing.
async function signedInAccount(req) {
  const auth = authLib();
  const v = auth.verify(auth.parseCookies(req)[auth.COOKIE]);
  if (!v || !v.account || v.enroll) return null;
  if (await auth.isRevoked(v.sid)) return null;
  const st = await accounts.sessionState(v.account);
  if (!st || st.status !== "active" || st.generation !== v.gen || st.role !== v.role) return null;
  if (!st.enrolled && !accounts.twoFaOff()) return null;
  return st;
}
// Where an account lands after signing in: the page asked for inside its company (a manager) or anywhere here (an
// admin), else its board or /admin.
function landing(account, next) {
  const n = String(next || "");
  const ok = /^\/(?!\/)[A-Za-z0-9/_.~%?=&-]*$/.test(n) && n.length < 300;
  if (account.role === "manager") { const own = `/c/${account.company}/`; return ok && n.startsWith(own) ? n : own; }
  return ok ? n : "/admin";
}

// ---- the token -------------------------------------------------------------------------------------------------------
function claimsOf(idToken) {
  const parts = String(idToken || "").split(".");
  if (parts.length !== 3) return null;
  try { return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")); } catch (e) { return null; }
}
// -> { subject, email } or throws with a short reason (for the log, never shown as it is)
async function exchange(p, name, code, st) {
  const body = new URLSearchParams({ grant_type: "authorization_code", code: String(code || ""), redirect_uri: redirectUri(name), client_id: p.id, client_secret: p.secret, code_verifier: st.verifier });
  const r = await fetch(p.token, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body, signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.id_token) throw new Error(`token endpoint ${r.status}${j.error ? ` ${String(j.error).slice(0, 60)}` : ""}`);
  const c = claimsOf(j.id_token);
  if (!c) throw new Error("no readable id_token");
  const now = Math.floor(Date.now() / 1000);
  if (!p.issuer(String(c.iss || ""), c)) throw new Error("issuer");
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!aud.includes(p.id) || (aud.length > 1 && c.azp !== p.id)) throw new Error("audience");
  if (!(Number(c.exp) > now - 60) || !(Number(c.iat) < now + 300)) throw new Error("expired");
  if (!same(c.nonce, st.nonce)) throw new Error("nonce");
  if (name === "google" && c.email && c.email_verified === false) c.email = null;   // shown only; never used to match
  const subject = p.subject(c);
  if (!subject) throw new Error("no subject");
  return { subject, email: c.email || c.preferred_username || null };
}

// ---- routes ----------------------------------------------------------------------------------------------------------
const publicRouter = express.Router();
publicRouter.get("/login/oidc/providers", (_req, res) => {
  const p = providers();
  res.set("Cache-Control", "no-store").json({ providers: Object.keys(p).map((k) => ({ id: k, name: p[k].name })) });
});
publicRouter.get("/login/oidc/:provider", async (req, res) => {
  const name = String(req.params.provider), p = providers()[name];
  if (!p) return res.status(404).send("not found");
  const link = req.query.link === "1";
  let account = null;
  if (link) {
    account = await signedInAccount(req);
    if (!account) return res.redirect(303, "/login?staff=1&oidc=signin_first");
  }
  const st = { provider: name, state: b64u(crypto.randomBytes(24)), nonce: b64u(crypto.randomBytes(24)), verifier: b64u(crypto.randomBytes(48)),
    mode: link ? "link" : "signin", account: account ? account.id : null, next: String(req.query.next || "").slice(0, 300) };
  writeState(req, res, st);
  const challenge = b64u(crypto.createHash("sha256").update(st.verifier).digest());
  const u = new URL(p.authorize);
  for (const [k, v] of Object.entries({ client_id: p.id, response_type: "code", redirect_uri: redirectUri(name), scope: "openid email profile", state: st.state, nonce: st.nonce, code_challenge: challenge, code_challenge_method: "S256", prompt: "select_account" })) u.searchParams.set(k, v);
  res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }).redirect(303, u.toString());
});
publicRouter.get("/login/oidc/:provider/callback", async (req, res) => {
  const name = String(req.params.provider), p = providers()[name];
  if (!p) return res.status(404).send("not found");
  const auth = authLib(), ip = edge.clientIp(req);
  res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  const st = readState(req);
  clearState(res);
  // back to where the person came from, with a word for the page: the page they connect from (a link, signed in), or
  // the sign-in page
  const refuse = async (why, code, extra = {}) => {
    await accounts.event("oidc_refused", { ip, ...(extra.account ? { account_id: extra.account.id, login: extra.account.login } : {}), detail: { provider: name, why } });
    if (extra.account) { const back = landing(extra.account, st && st.next); return res.redirect(303, `${back}${back.includes("?") ? "&" : "?"}oidc=${code}`); }
    return res.redirect(303, `/login?staff=1&oidc=${code}`);
  };
  if (auth.loginBlocked(ip)) return refuse("rate", "wait");
  if (!st || st.provider !== name || !same(req.query.state, st.state)) { auth.noteLoginFail(ip); return refuse("state", "expired"); }
  if (req.query.error) return refuse(`provider: ${String(req.query.error).slice(0, 40)}`, "cancelled", st.mode === "link" ? { account: await signedInAccount(req) } : {});
  let who;
  try { who = await exchange(p, name, req.query.code, st); }
  catch (e) { auth.noteLoginFail(ip); console.error(`[oidc] ${name}: ${e.message}`); return refuse(e.message.slice(0, 80), "failed"); }

  if (st.mode === "link") {
    const account = await signedInAccount(req);
    if (!account || account.id !== st.account) return refuse("link: not the same account", "signin_first");
    const taken = (await q("SELECT account_id FROM platform.account_identities WHERE provider=$1 AND subject=$2", [name, who.subject])).rows[0];
    if (taken && taken.account_id !== account.id) return refuse("link: on another account", "taken", { account });
    if (!taken) await q("INSERT INTO platform.account_identities (account_id, provider, subject, email) VALUES ($1,$2,$3,$4)", [account.id, name, who.subject, who.email ? String(who.email).slice(0, 200) : null]);
    await accounts.event("oidc_linked", { account_id: account.id, login: account.login, ip, detail: { provider: name } });
    const back = landing(account, st.next);
    return res.redirect(303, `${back}${back.includes("?") ? "&" : "?"}oidc=linked_${name}`);
  }
  const row = (await q(`SELECT i.id AS identity_id, a.* FROM platform.account_identities i JOIN platform.accounts a ON a.id=i.account_id
                         WHERE i.provider=$1 AND i.subject=$2`, [name, who.subject])).rows[0];
  if (!row) { auth.noteLoginFail(ip); return refuse("not connected", `unlinked_${name}`); }
  if (row.status !== "active" || !["admin", "manager"].includes(row.role)) return refuse("account off", "off");
  await q("UPDATE platform.account_identities SET last_used_at=now() WHERE id=$1", [row.identity_id]);
  await accounts.event("login_oidc", { account_id: row.id, login: row.login, ip, detail: { provider: name } });
  accounts.forget(row.id);
  const out = auth.startAccountSession(req, res, row, { enroll: false });
  if (out.enroll) return res.redirect(303, out.enroll_url || "/admin");
  res.redirect(303, landing(row, st.next));
});

// a signed-in named account's own (behind the sign-in middleware: req.sosAccount)
const router = express.Router();
const json = express.json({ limit: "8kb" });
router.get("/api/me/identities", async (req, res) => {
  if (!req.sosAccount || !req.sosAccount.id) return res.status(403).json({ error: "only a named account connects these" });
  const rows = (await q("SELECT id, provider, email, created_at, last_used_at FROM platform.account_identities WHERE account_id=$1 ORDER BY provider, id", [req.sosAccount.id])).rows;
  const p = providers();
  res.set("Cache-Control", "no-store").json({ identities: rows, providers: Object.keys(p).map((k) => ({ id: k, name: p[k].name })) });
});
router.post("/api/me/identities/:id(\\d{1,9})/remove", json, async (req, res) => {
  if (!req.sosAccount || !req.sosAccount.id) return res.status(403).json({ error: "only a named account connects these" });
  const gone = (await q("DELETE FROM platform.account_identities WHERE id=$1 AND account_id=$2 RETURNING provider", [Number(req.params.id), req.sosAccount.id])).rows[0];
  if (!gone) return res.status(404).json({ error: "no such connection on your account" });
  await accounts.event("oidc_unlinked", { account_id: req.sosAccount.id, login: req.sosAccount.login, ip: edge.clientIp(req), detail: { provider: gone.provider } });
  res.json({ ok: true });
});

module.exports = { init, SCHEMA, providers, publicRouter, router, claimsOf, landing, publicUrl, readState, STATE_COOKIE };
