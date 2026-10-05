// Connector sign-in: how an AI app (Claude first) is let in to an MCP address of this instance (2026-10-05,
// docs/MCP.md; Brendan: "each company can have an MCP to their own data and processes then I can also have an admin
// MCP"). This file is the sign-in half. src/mcp.js is the address itself and src/mcp-admin.js the admin tools.
//
// It is OAuth 2.1 on the named accounts that already exist (src/accounts.js), with the MCP SDK's own handlers doing
// the protocol (authorize, token, register, revoke, the two discovery documents) and this file being the "provider"
// behind them: who the person is, what they agreed to, what a token is worth.
//
//   1. The person pastes the address (https://app.anetix.ai/mcp/admin) into their AI app. The app gets a 401 that
//      points at the discovery documents, registers itself (POST /oauth/register), and sends the person's browser to
//      /oauth/authorize.
//   2. /oauth/authorize checks the app and where it wants the answer sent, then hands the browser to the consent
//      page (/oauth/consent, public/connect.html). Not signed in: the page sends them to the ordinary sign-in and
//      back. The page says which app is asking, where the answer goes, and what it will be able to read.
//   3. Allow asks for a FRESH passkey or code (accounts.stepUp, the same step a destructive admin action takes), so a
//      browser left signed in cannot connect an app on its own. Then a one-time code goes back to the app, which
//      trades it at /oauth/token (with its PKCE proof) for an access token and a refresh token.
//
// Rules this file keeps:
//   - Off until SOS_PUBLIC_URL names the instance's own address (https://app.anetix.ai). No variable, no connector:
//     a missing variable never means open, and the issuer is never read from a request's Host header.
//   - Only a named account that is switched on and has its second factor can connect an app. A floor session, a shared
//     company password or the internal token never can. In this first phase only an ADMIN account can, and only to
//     the admin address; a company's managers come with the company MCP (docs/MCP.md, phase 2).
//   - A connection (platform.mcp_grants) belongs to one account and one address. A token for the admin address is
//     refused anywhere else. Every call re-checks the account: switched off, removed, or "Sign out everywhere"
//     (the generation) ends its connections at once.
//   - Tokens are random and only their sha256 is kept. Access: SOS_MCP_ACCESS_MIN (60) minutes. Refresh: one use
//     each, a new one with every refresh, good for the same idle window the account's cookie has
//     (SOS_ADMIN_IDLE_HOURS, 168), and the whole connection ends at the cookie's cap (SOS_ADMIN_CAP_HOURS, 720):
//     an admin's app is connected again with a passkey about once a month, like the admin's own browser.
//     A refresh token used a second time ends the connection (someone else holds a copy); a second use inside
//     REUSE_GRACE_S is only refused, since an app whose first try was cut off will try once more.
//   - Where an answer may be sent is an allow-list (SOS_MCP_REDIRECTS): Claude's hosted callback and a callback on
//     the person's own computer (Claude Code) by default. An app is registered only for the addresses on the list;
//     any other it asks for is left out and logged, which is how the list grows on purpose.
//   - Never in a backup file (like the sign-in log and the trusted devices): a restore raises every generation
//     anyway, so every app is connected again.
//   - A token, a code or a client secret is never logged and never returned apart from the one answer that hands it
//     to the app it is for.
const crypto = require("crypto");
const express = require("express");
const { q } = require("./db");
const auth = require("./auth");
const accounts = require("./accounts");
const edge = require("./edge");
const connections = require("./connections");   // encrypt / decrypt: one key and one format for every stored secret
const { InvalidGrantError, InvalidTokenError, InvalidTargetError, InvalidClientMetadataError, AccessDeniedError } = require("@modelcontextprotocol/sdk/server/auth/errors.js");

// ---- settings (pure) ------------------------------------------------------------------------------------------
// The instance's own address, or null. https only, apart from this computer (local work and the tests).
function publicUrl(value = process.env.SOS_PUBLIC_URL) {
  let u; try { u = new URL(String(value || "").trim()); } catch (e) { return null; }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) return null;
  if (u.search || u.hash || (u.pathname && u.pathname !== "/")) return null;
  return u.origin;
}
const PUBLIC = publicUrl();
const enabled = () => Boolean(PUBLIC);
// The addresses a token can be for. Phase 2 adds { company: PUBLIC + "/mcp" }.
const SURFACES = { admin: { path: "/mcp/admin", role: "admin", name: "Anetix admin" } };
const resourceOf = (surface, base = PUBLIC) => (base && SURFACES[surface] ? base + SURFACES[surface].path : null);
// Which surface an address names: exact, with or without a trailing slash, nothing else.
function surfaceOf(resource, base = PUBLIC) {
  const want = String(resource || "").replace(/#.*$/, "").replace(/\/$/, "");
  for (const s of Object.keys(SURFACES)) if (want && want === resourceOf(s, base)) return s;
  return null;
}
const minutes = (name, dflt, max) => { const n = Number(process.env[name]); return Number.isFinite(n) && n > 0 ? Math.min(n, max) : dflt; };
const ACCESS_S = minutes("SOS_MCP_ACCESS_MIN", 60, 24 * 60) * 60;
const CODE_S = 120;           // an authorization code: the app trades it within seconds
const CONSENT_S = 15 * 60;    // how long the consent page may sit open
const REUSE_GRACE_S = 60;
const CALL_DAYS = Number(process.env.SOS_MCP_CALL_DAYS || 400);
// the same windows the account's cookie has (src/auth.js WINDOWS), in seconds; cap 0 = no cap
const windowsFor = (role) => { const w = role === "admin" ? auth.WINDOWS.admin : auth.WINDOWS.device; return { idle: w.idle * 3600, cap: w.cap ? w.cap * 3600 : 0 }; };

// Where an answer may be sent. "loopback" = this person's own computer (http, localhost or 127.0.0.1, any port),
// which is how Claude Code and other desktop apps receive it (RFC 8252).
const DEFAULT_REDIRECTS = ["https://claude.ai/api/mcp/auth_callback", "loopback"];
function redirectList(value = process.env.SOS_MCP_REDIRECTS) {
  const list = String(value || "").split(",").map((s) => s.trim()).filter(Boolean);
  return list.length ? list : DEFAULT_REDIRECTS;
}
function isLoopback(uri) {
  let u; try { u = new URL(uri); } catch (e) { return false; }
  return u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) && !u.username && !u.password;
}
function redirectAllowed(uri, list = redirectList()) {
  let u; try { u = new URL(String(uri || "")); } catch (e) { return false; }
  if (u.hash || u.username || u.password) return false;
  if (isLoopback(uri)) return list.includes("loopback");
  if (u.protocol !== "https:") return false;
  return list.includes(u.origin + u.pathname) && !u.search;
}
const hostOf = (uri) => { try { return new URL(uri).host; } catch (e) { return ""; } };

// ---- small things (pure) ----------------------------------------------------------------------------------------
const hashToken = (t) => crypto.createHash("sha256").update(String(t || "")).digest("hex");
const mint = (prefix) => `${prefix}_${crypto.randomBytes(32).toString("base64url")}`;
const cleanName = (s) => String(s || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
// The authorize request, carried through the consent page in the address: signed under the session secret so the
// page's answer can only be about a request /oauth/authorize itself checked, and good for CONSENT_S.
const seal = (body) => auth.hmac(`mcp-consent:${body}`);
function sealRequest(o, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ ...o, exp: Math.floor(now / 1000) + CONSENT_S })).toString("base64url");
  return `${body}.${seal(body)}`;
}
function openRequest(value, now = Date.now()) {
  const m = /^([A-Za-z0-9_-]{10,4000})\.([A-Za-z0-9_-]{20,100})$/.exec(String(value || ""));
  if (!m) return null;
  const want = Buffer.from(seal(m[1])), got = Buffer.from(m[2]);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  let o; try { o = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8")); } catch (e) { return null; }
  if (!o || typeof o !== "object" || !(Number(o.exp) > now / 1000)) return null;
  return o;
}
// May this account connect an app to this surface? -> null, or why not in words the consent page shows.
function refusal(account, surface, { twoFaOff = false } = {}) {
  const s = SURFACES[surface];
  if (!s) return "that is not an address of this instance";
  if (!account) return "sign in first";
  if (account.status !== "active") return "this account is switched off";
  if (account.role !== s.role) return account.role === "manager" ? "connecting an app to a company's tools is not open yet; this address is for Anetix's own accounts" : "this address is for another kind of account";
  if (!account.enrolled && !twoFaOff) return "set up your authenticator app first";
  return null;
}

// ---- tables -----------------------------------------------------------------------------------------------------
const SCHEMA = `
CREATE TABLE IF NOT EXISTS platform.mcp_clients (
  client_id    TEXT PRIMARY KEY,
  name         TEXT NOT NULL DEFAULT '',
  info         JSONB NOT NULL,                     -- what the app registered, without its secret
  secret       BYTEA,                              -- a confidential app's secret, encrypted (src/connections.js)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS platform.mcp_grants (
  id           SERIAL PRIMARY KEY,
  account_id   INTEGER NOT NULL REFERENCES platform.accounts(id) ON DELETE CASCADE,
  client_id    TEXT NOT NULL,
  client_name  TEXT NOT NULL DEFAULT '',
  redirect_host TEXT NOT NULL DEFAULT '',
  surface      TEXT NOT NULL,                      -- 'admin' (phase 2: 'company')
  company      TEXT,                               -- NULL for admin
  generation   INTEGER NOT NULL,                   -- the account's, when the person said Allow
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ,                        -- the cap: the connection ends here whatever its use
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  revoked_by   TEXT
);
CREATE INDEX IF NOT EXISTS mcp_grants_account ON platform.mcp_grants (account_id);
CREATE TABLE IF NOT EXISTS platform.mcp_tokens (
  token_hash   TEXT PRIMARY KEY,
  grant_id     INTEGER NOT NULL REFERENCES platform.mcp_grants(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,                      -- 'access' | 'refresh'
  expires_at   TIMESTAMPTZ NOT NULL,
  used_at      TIMESTAMPTZ,                        -- a refresh token: when it was traded for the next pair
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mcp_tokens_grant ON platform.mcp_tokens (grant_id);
CREATE TABLE IF NOT EXISTS platform.mcp_codes (
  code_hash    TEXT PRIMARY KEY,
  client_id    TEXT NOT NULL,
  account_id   INTEGER NOT NULL REFERENCES platform.accounts(id) ON DELETE CASCADE,
  generation   INTEGER NOT NULL,
  surface      TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  challenge    TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  used_at      TIMESTAMPTZ,
  grant_id     INTEGER,                            -- the connection it became, so a second use can end it
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;
async function sweep() {
  await q("DELETE FROM platform.mcp_codes WHERE expires_at < now() - interval '1 day'");
  await q("DELETE FROM platform.mcp_tokens WHERE expires_at < now() - interval '1 day'");
  // an app registers itself afresh for every new connection, so the ones that never became a connection, or whose
  // connections are all over, go
  await q(`DELETE FROM platform.mcp_clients c WHERE c.created_at < now() - interval '2 days'
             AND NOT EXISTS (SELECT 1 FROM platform.mcp_grants g WHERE g.client_id=c.client_id AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > now()))`);
  await q("DELETE FROM platform.mcp_grants WHERE COALESCE(revoked_at, expires_at) < now() - interval '90 days'");
}
async function init() {
  await q(SCHEMA);
  await sweep().catch((e) => console.error("[mcp] sweep:", e.message));
  if (!enabled()) console.log(`[mcp] connectors are off: SOS_PUBLIC_URL ${process.env.SOS_PUBLIC_URL ? "is not an https address with no path" : "is not set"}`);
  else console.log(`[mcp] connectors are on at ${PUBLIC} (answers may go to: ${redirectList().join(", ")})`);
  setInterval(() => sweep().catch((e) => console.error("[mcp] sweep:", e.message)), 24 * 3600e3).unref();
}

// ---- who is at the browser ----------------------------------------------------------------------------------------
// The named account this browser is signed in as, checked the way src/auth.js checks it on every request, or null.
// /oauth/* sits before the sign-in middleware (an app's own calls carry no cookie), so the consent routes ask here.
async function accountOf(req) {
  if (auth.OPEN) return null;   // local work with no sign-in has no accounts to connect an app to
  const s = auth.verify(auth.parseCookies(req)[auth.COOKIE]);
  if (!s || !s.account) return null;
  const st = await accounts.sessionState(s.account);
  if (!st || st.role !== s.role || st.status !== "active" || st.generation !== s.gen) return null;
  if (st.role === "manager" && st.company !== s.company) return null;
  return st;
}
// The same account, by id, for a token: null unless it could still connect an app to that surface right now.
async function liveAccount(id, surface, generation) {
  const st = await accounts.sessionState(id);   // remembered for ten seconds, and forgotten at once by every change to the account (src/accounts.js)
  if (!st || refusal(st, surface, { twoFaOff: accounts.twoFaOff() })) return null;
  if (generation !== undefined && st.generation !== Number(generation)) return null;
  return st;
}

// ---- the app (client) registry ---------------------------------------------------------------------------------
let refusedLogged = 0;
const clientsStore = {
  async getClient(clientId) {
    const r = (await q("SELECT info, secret FROM platform.mcp_clients WHERE client_id=$1", [String(clientId || "").slice(0, 200)])).rows[0];
    if (!r) return undefined;
    let secret; try { secret = r.secret ? connections.decrypt(r.secret) : undefined; } catch (e) { return undefined; }   // a secret this key cannot read is no client
    return { ...r.info, ...(secret ? { client_secret: secret.s } : {}) };
  },
  async registerClient(info) {
    // Only the addresses on the list are kept. An app that names others beside a good one is registered for the
    // good one alone (its answers can then go nowhere else); an app with none left is refused. Either way the
    // addresses that were not kept are logged: a URL an app asked for is not a secret, and that line is how the
    // list grows on purpose.
    const asked = Array.isArray(info.redirect_uris) ? info.redirect_uris.map(String).slice(0, 20) : [];
    const uris = asked.filter((u) => redirectAllowed(u)), bad = asked.filter((u) => !redirectAllowed(u));
    if (bad.length && refusedLogged++ < 50) console.warn(`[mcp] an app's registration asked for answers at ${bad.slice(0, 3).map((u) => u.slice(0, 120)).join(", ")}: not on the list (SOS_MCP_REDIRECTS), ${uris.length ? "left out" : "so it was refused"}`);
    if (!uris.length) throw new InvalidClientMetadataError("this server sends sign-in answers only to the addresses it lists; none of those is on the list");
    const { client_secret: secret, ...rest } = info;
    const kept = { ...rest, client_name: cleanName(info.client_name) || "An app", redirect_uris: uris, grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] };
    for (const k of ["client_uri", "logo_uri", "tos_uri", "policy_uri", "jwks_uri", "jwks", "software_statement"]) delete kept[k];   // nothing this server shows or fetches
    await q("INSERT INTO platform.mcp_clients (client_id, name, info, secret) VALUES ($1,$2,$3,$4)", [kept.client_id, kept.client_name, JSON.stringify(kept), secret ? connections.encrypt({ s: secret }) : null]);
    return { ...kept, ...(secret ? { client_secret: secret } : {}) };
  },
};

// ---- tokens --------------------------------------------------------------------------------------------------------
// A new access token and a new refresh token for a connection. -> the answer /oauth/token gives the app.
async function issue(grant, now = Date.now()) {
  const w = windowsFor(SURFACES[grant.surface].role);
  const end = grant.expires_at ? new Date(grant.expires_at).getTime() : Infinity;
  const accessEnd = Math.min(now + ACCESS_S * 1000, end), refreshEnd = Math.min(now + w.idle * 1000, end);
  const access = mint("anx_at"), refresh = mint("anx_rt");
  await q("INSERT INTO platform.mcp_tokens (token_hash, grant_id, kind, expires_at) VALUES ($1,$2,'access',$3), ($4,$2,'refresh',$5)",
    [hashToken(access), grant.id, new Date(accessEnd), hashToken(refresh), new Date(refreshEnd)]);
  return { access_token: access, token_type: "bearer", expires_in: Math.max(1, Math.round((accessEnd - now) / 1000)), refresh_token: refresh };
}
async function endGrant(id, by) {
  const r = (await q("UPDATE platform.mcp_grants SET revoked_at=now(), revoked_by=$2 WHERE id=$1 AND revoked_at IS NULL RETURNING id, account_id, client_name, surface", [id, String(by || "").slice(0, 120)])).rows[0];
  await q("DELETE FROM platform.mcp_tokens WHERE grant_id=$1", [id]);
  return r || null;
}
const grantAlive = (g, now = Date.now()) => Boolean(g && !g.revoked_at && (!g.expires_at || new Date(g.expires_at).getTime() > now));

// ---- the provider the SDK's handlers call -----------------------------------------------------------------------
const provider = {
  get clientsStore() { return clientsStore; },

  // /oauth/authorize has checked the app and its redirect address. Nothing is decided here: the browser goes to
  // the consent page with the request sealed in the address.
  async authorize(client, params, res) {
    const surface = params.resource ? surfaceOf(params.resource.href) : "admin";   // an app that names no address gets the only one there is
    if (!surface) throw new InvalidTargetError("that is not an address of this server");
    if (!redirectAllowed(params.redirectUri)) throw new AccessDeniedError("this server does not send sign-in answers there");   // the list changed since the app registered
    const sealed = sealRequest({ c: client.client_id, r: params.redirectUri, s: params.state || null, ch: params.codeChallenge, f: surface });
    res.redirect(302, `/oauth/consent?req=${encodeURIComponent(sealed)}`);
  },

  async challengeForAuthorizationCode(client, code) {
    const r = (await q("SELECT challenge FROM platform.mcp_codes WHERE code_hash=$1 AND client_id=$2", [hashToken(code), client.client_id])).rows[0];
    if (!r) throw new InvalidGrantError("that code is not one this server made");
    return r.challenge;
  },

  async exchangeAuthorizationCode(client, code, _verifier, redirectUri, resource) {
    const hash = hashToken(code);
    const seen = (await q("SELECT * FROM platform.mcp_codes WHERE code_hash=$1 AND client_id=$2", [hash, client.client_id])).rows[0];
    if (!seen) throw new InvalidGrantError("that code is not one this server made");
    if (seen.used_at) {
      // a code presented twice: whoever holds the connection it made may not be the app the person approved
      if (seen.grant_id) { const g = await endGrant(seen.grant_id, "a sign-in code was used twice"); if (g) await accounts.event("mcp_code_reuse", { account_id: g.account_id, detail: { grant: g.id, app: g.client_name } }); }
      throw new InvalidGrantError("that code was already used");
    }
    // a trade that is wrong about where or what for is refused before the code is spent
    if (redirectUri !== undefined && redirectUri !== seen.redirect_uri) throw new InvalidGrantError("the redirect address is not the one the code was made for");
    if (resource && surfaceOf(resource.href) !== seen.surface) throw new InvalidTargetError("the code was made for another address");
    const c = (await q("UPDATE platform.mcp_codes SET used_at=now() WHERE code_hash=$1 AND client_id=$2 AND used_at IS NULL AND expires_at > now() RETURNING *", [hash, client.client_id])).rows[0];
    if (!c) throw new InvalidGrantError("that code is used or too old");
    const account = await liveAccount(c.account_id, c.surface, c.generation);
    if (!account) throw new InvalidGrantError("the account can no longer connect an app");
    const w = windowsFor(SURFACES[c.surface].role);
    const grant = (await q(`INSERT INTO platform.mcp_grants (account_id, client_id, client_name, redirect_host, surface, company, generation, expires_at)
                            VALUES ($1,$2,$3,$4,$5,$6,$7, CASE WHEN $8::int > 0 THEN now() + make_interval(secs => $8::int) ELSE NULL END) RETURNING *`,
      [account.id, client.client_id, cleanName(client.client_name) || "An app", hostOf(c.redirect_uri), c.surface, c.surface === "admin" ? null : account.company, account.generation, w.cap])).rows[0];
    await q("UPDATE platform.mcp_codes SET grant_id=$2 WHERE code_hash=$1", [hash, grant.id]);
    await accounts.event("mcp_connected", { account_id: account.id, login: account.login, detail: { grant: grant.id, app: grant.client_name, to: grant.redirect_host, surface: grant.surface } });
    return issue(grant);
  },

  async exchangeRefreshToken(client, refreshToken, _scopes, resource) {
    const hash = hashToken(refreshToken);
    const t = (await q(`SELECT t.*, g.id AS gid, g.account_id, g.client_id, g.client_name, g.surface, g.generation, g.expires_at AS grant_expires_at, g.revoked_at
                          FROM platform.mcp_tokens t JOIN platform.mcp_grants g ON g.id=t.grant_id WHERE t.token_hash=$1 AND t.kind='refresh'`, [hash])).rows[0];
    if (!t || t.client_id !== client.client_id) throw new InvalidGrantError("that refresh token is not one this server made for this app");
    const grant = { id: t.gid, surface: t.surface, expires_at: t.grant_expires_at, revoked_at: t.revoked_at };
    if (!grantAlive(grant) || new Date(t.expires_at).getTime() <= Date.now()) throw new InvalidGrantError("this connection has ended; connect the app again");
    if (resource && surfaceOf(resource.href) !== t.surface) throw new InvalidTargetError("this connection is for another address");
    if (t.used_at) {
      if (Date.now() - new Date(t.used_at).getTime() > REUSE_GRACE_S * 1000) {
        await endGrant(t.gid, "a refresh token was used twice");
        await accounts.event("mcp_refresh_reuse", { account_id: t.account_id, detail: { grant: t.gid, app: t.client_name } });
      }
      throw new InvalidGrantError("that refresh token was already used");
    }
    if (!(await liveAccount(t.account_id, t.surface, t.generation))) { await endGrant(t.gid, "the account can no longer hold a connection"); throw new InvalidGrantError("the account can no longer hold a connection"); }
    const claimed = (await q("UPDATE platform.mcp_tokens SET used_at=now() WHERE token_hash=$1 AND used_at IS NULL RETURNING token_hash", [hash])).rows[0];
    if (!claimed) throw new InvalidGrantError("that refresh token was already used");
    await q("DELETE FROM platform.mcp_tokens WHERE grant_id=$1 AND (expires_at < now() OR (kind='refresh' AND used_at < now() - make_interval(secs => $2)))", [t.gid, REUSE_GRACE_S * 10]);
    return issue(grant);
  },

  // Every call to an MCP address comes through here (the SDK's bearer check). Anything short of a live token of a
  // live connection of a live account is the same InvalidTokenError: a 401 that tells the app to sign in again.
  async verifyAccessToken(token) {
    const no = () => new InvalidTokenError("sign in again");
    if (!/^anx_at_[A-Za-z0-9_-]{40,60}$/.test(String(token || ""))) throw no();
    // the token's own end under its own name: the connection has an expires_at too (its cap), and g.* would hide this one
    const t = (await q(`SELECT g.*, t.expires_at AS token_expires_at FROM platform.mcp_tokens t JOIN platform.mcp_grants g ON g.id=t.grant_id WHERE t.token_hash=$1 AND t.kind='access'`, [hashToken(token)])).rows[0];
    if (!t || !grantAlive(t) || new Date(t.token_expires_at).getTime() <= Date.now()) throw no();
    const account = await liveAccount(t.account_id, t.surface, t.generation);
    if (!account) { await endGrant(t.id, "the account can no longer hold a connection"); throw no(); }
    if (!t.last_used_at || Date.now() - new Date(t.last_used_at).getTime() > 60e3) q("UPDATE platform.mcp_grants SET last_used_at=now() WHERE id=$1", [t.id]).catch(() => {});
    return {
      token, clientId: t.client_id, scopes: [], expiresAt: Math.floor(new Date(t.token_expires_at).getTime() / 1000), resource: new URL(resourceOf(t.surface)),
      extra: { grant: t.id, surface: t.surface, company: t.company || null, app: t.client_name, account: { id: account.id, login: account.login, name: account.name, role: account.role } },
    };
  },

  // The app says it is done with a token: the whole connection ends, whichever of the two it named.
  async revokeToken(client, request) {
    const t = (await q("SELECT t.grant_id, g.client_id FROM platform.mcp_tokens t JOIN platform.mcp_grants g ON g.id=t.grant_id WHERE t.token_hash=$1", [hashToken(request && request.token)])).rows[0];
    if (t && t.client_id === client.client_id) await endGrant(t.grant_id, "the app disconnected");
  },
};

// ---- the consent page's two calls (mounted before sign-in; each asks who the browser is itself) ---------------
const json = express.json({ limit: "64kb" });
// What the page shows. Never says whether a request is good to someone who is not signed in.
async function consentInfo(req, res) {
  res.set("Cache-Control", "no-store");
  const account = await accountOf(req);
  if (!account) return res.status(401).json({ error: "sign in first", signed_in: false });
  const o = openRequest(req.query.req);
  if (!o) return res.status(400).json({ error: "this sign-in request is too old or was changed. Go back to the app and connect again." });
  const client = await clientsStore.getClient(o.c);
  if (!client) return res.status(400).json({ error: "the app that asked is not registered here any more. Go back to it and connect again." });
  const why = refusal(account, o.f, { twoFaOff: accounts.twoFaOff() });
  res.json({
    account: { login: account.login, name: account.name, role: account.role, passkeys: account.passkeys || 0 },
    app: { name: cleanName(client.client_name) || "An app", sends_to: hostOf(o.r), this_computer: isLoopback(o.r) },
    address: resourceOf(o.f), surface: o.f, surface_name: SURFACES[o.f] ? SURFACES[o.f].name : null,
    allowed: !why, why: why || null, step_up: accounts.twoFaOff() ? "password" : "code",
    lasts: SURFACES[o.f] ? { idle_days: Math.round(windowsFor(SURFACES[o.f].role).idle / 86400), cap_days: Math.round(windowsFor(SURFACES[o.f].role).cap / 86400) || null } : null,
  });
}
// The person's answer. -> { redirect }: where the page sends the browser (back to the app, with a code or a no).
async function consentDecide(req, res) {
  res.set("Cache-Control", "no-store");
  // the page is this instance's own: an answer from any other origin is nobody's decision
  const origin = req.headers.origin;
  if (origin && origin !== PUBLIC) return res.status(403).json({ error: "this answer did not come from the consent page" });
  const account = await accountOf(req);
  if (!account) return res.status(401).json({ error: "sign in first", signed_in: false });
  const body = req.body || {};
  const o = openRequest(body.req);
  if (!o) return res.status(400).json({ error: "this sign-in request is too old or was changed. Go back to the app and connect again." });
  const client = await clientsStore.getClient(o.c);
  if (!client || !redirectAllowed(o.r)) return res.status(400).json({ error: "the app that asked is not registered here any more. Go back to it and connect again." });
  const back = new URL(o.r);
  if (o.s) back.searchParams.set("state", o.s);
  const ip = edge.clientIp(req);
  if (body.allow !== true) {
    await accounts.event("mcp_consent_no", { account_id: account.id, login: account.login, ip, detail: { app: cleanName(client.client_name), to: hostOf(o.r), surface: o.f } });
    back.searchParams.set("error", "access_denied"); back.searchParams.set("error_description", "the person said no");
    return res.json({ redirect: back.href });
  }
  const why = refusal(account, o.f, { twoFaOff: accounts.twoFaOff() });
  if (why) return res.status(403).json({ error: why });
  // a fresh passkey or code, the step a destructive admin action takes: the session alone never connects an app
  const step = await accounts.stepUp(account, { code: body.code, password: body.password, passkey: body.passkey }, ip, `mcp_connect:${o.f}`, req);
  if (!step.ok) return res.status(403).json({ error: step.error, step_up: true });
  const code = mint("anx_ac");
  await q("INSERT INTO platform.mcp_codes (code_hash, client_id, account_id, generation, surface, redirect_uri, challenge, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7, now() + make_interval(secs => $8))",
    [hashToken(code), client.client_id, account.id, account.generation, o.f, o.r, String(o.ch), CODE_S]);
  await accounts.event("mcp_consent_yes", { account_id: account.id, login: account.login, ip, detail: { app: cleanName(client.client_name), to: hostOf(o.r), surface: o.f } });
  back.searchParams.set("code", code);
  res.json({ redirect: back.href });
}

// ---- /admin: the connected apps (after sign-in, admin only) -----------------------------------------------------
async function grantsView() {
  const rows = (await q(`SELECT g.id, g.account_id, a.login, a.display_name, g.client_name, g.redirect_host, g.surface, g.company, g.created_at, g.expires_at, g.last_used_at,
                                (SELECT count(*)::int FROM platform.mcp_calls c WHERE c.grant_id=g.id) AS calls
                           FROM platform.mcp_grants g JOIN platform.accounts a ON a.id=g.account_id
                          WHERE g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > now())
                            AND g.generation = a.generation AND a.status='active'   -- "Sign out everywhere" and switching an account off end its apps; the row is closed at the app's next call
                          ORDER BY g.id DESC`)).rows;
  const calls = (await q(`SELECT c.id, c.at, c.tool, c.ok, c.ms, c.chars, c.error, a.login, g.client_name FROM platform.mcp_calls c
                            LEFT JOIN platform.accounts a ON a.id=c.account_id LEFT JOIN platform.mcp_grants g ON g.id=c.grant_id ORDER BY c.id DESC LIMIT 40`)).rows;
  return { enabled: enabled(), address: resourceOf("admin"), public_url: PUBLIC, redirects: redirectList(), access_minutes: ACCESS_S / 60,
    idle_hours: auth.WINDOWS.admin.idle, cap_hours: auth.WINDOWS.admin.cap || null, grants: rows, calls };
}
const router = express.Router();
const requireAdmin = (req, res, next) => auth.requireAdmin(req, res, next);
router.get("/api/admin/mcp", requireAdmin, async (_req, res) => res.set("Cache-Control", "no-store").json(await grantsView()));
// Disconnect asks for nothing more, like removing a trusted computer: taking access away is never the risky direction.
router.post("/api/admin/mcp/grants/:id(\\d{1,9})/disconnect", requireAdmin, async (req, res) => {
  const who = (req.sosAccount && req.sosAccount.login) || "admin";
  const g = await endGrant(Number(req.params.id), who);
  if (!g) return res.status(404).json({ error: "no such connection, or it has already ended" });
  await accounts.event("mcp_disconnected", { account_id: g.account_id, ip: edge.clientIp(req), detail: { grant: g.id, app: g.client_name, by: who } });
  res.json({ ok: true });
});

module.exports = {
  init, sweep, enabled, provider, clientsStore, router, consentInfo, consentDecide, json, accountOf, endGrant, grantsView,
  PUBLIC, SURFACES, resourceOf, surfaceOf, publicUrl, redirectList, redirectAllowed, isLoopback, sealRequest, openRequest, refusal, hashToken, windowsFor,
  ACCESS_S, CODE_S, CONSENT_S, REUSE_GRACE_S, CALL_DAYS, DEFAULT_REDIRECTS,
};
