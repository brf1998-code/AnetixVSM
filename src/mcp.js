// The MCP addresses of this instance: where a connected AI app's calls arrive (2026-10-05, docs/MCP.md).
// src/mcpauth.js is the sign-in behind them; src/mcp-admin.js is what the admin address offers.
//
//   POST /mcp/admin    Anetix's own: operations across the instance, read only. A named ADMIN account's app only.
//   (phase 2: /mcp, a company's managers: their own tools, records, board, and filing a request)
//
// How a call is handled:
//   - The bearer check comes first, for every method: no token or a dead one is a 401 that points the app at the
//     discovery document (the SDK's requireBearerAuth, src/mcpauth.js verifyAccessToken). A token made for another
//     address is the same 401. A cookie is never read here and none is ever set.
//   - Stateless: each POST gets its own server object and JSON answer, nothing is kept in memory between calls, so
//     a redeploy in the middle of a conversation costs the app nothing. GET and DELETE (the streaming and session
//     halves of the transport) answer 405.
//   - Every tool call is one row in platform.mcp_calls: who, which app, which tool, what it was asked (clipped),
//     whether it worked, how long, how much text went back. Never the answer itself.
//   - A tool's answer is JSON as text, at most SOS_MCP_MAX_CHARS (120000) characters; past that the app is told
//     it was cut and to ask for less. A tool that throws answers "that did not work" with the error's words only
//     when the tool marked them as fit to read (err.say); the Railway log has the rest.
//   - A tool marked readOnly: false changes something (2026-10-06, src/mcp-intake.js). It runs only on a connection
//     whose person ticked "let it write" on the consent page (who.writes, mcp_grants.writes); on any other it answers
//     in words that say to connect the app again, and is logged as refused. Nothing a tool here does is destructive.
//
// Where this sits in server.js: mount() is called after edge.gate (so a call still has to come through Cloudflare)
// and BEFORE auth.middleware (an app carries a token, not a cookie). Nothing mounted here trusts a cookie apart
// from the consent page's two calls, which check the account themselves (mcpauth.accountOf).
const path = require("path");
const express = require("express");
const { q } = require("./db");
const edge = require("./edge");
const mcpauth = require("./mcpauth");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { requireBearerAuth } = require("@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js");
const { mcpAuthMetadataRouter, getOAuthProtectedResourceMetadataUrl } = require("@modelcontextprotocol/sdk/server/auth/router.js");
const { authorizationHandler } = require("@modelcontextprotocol/sdk/server/auth/handlers/authorize.js");
const { tokenHandler } = require("@modelcontextprotocol/sdk/server/auth/handlers/token.js");
const { clientRegistrationHandler } = require("@modelcontextprotocol/sdk/server/auth/handlers/register.js");
const { revocationHandler } = require("@modelcontextprotocol/sdk/server/auth/handlers/revoke.js");

const VERSION = require("../package.json").version;
const MAX_CHARS = (() => { const n = Number(process.env.SOS_MCP_MAX_CHARS); return Number.isFinite(n) && n >= 2000 ? Math.min(n, 1e6) : 120000; })();
const page = (name) => path.join(__dirname, "..", "public", name);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS platform.mcp_calls (
  id          BIGSERIAL PRIMARY KEY,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  grant_id    INTEGER,
  account_id  INTEGER,
  surface     TEXT NOT NULL,
  company     TEXT,
  tool        TEXT NOT NULL,
  args        JSONB,
  ok          BOOLEAN NOT NULL,
  ms          INTEGER,
  chars       INTEGER,
  error       TEXT
);
CREATE INDEX IF NOT EXISTS mcp_calls_grant ON platform.mcp_calls (grant_id, id);
`;
async function init() {
  await q(SCHEMA);
  await q("DELETE FROM platform.mcp_calls WHERE at < now() - ($1 || ' days')::interval", [String(mcpauth.CALL_DAYS)]);
}

// ---- pure ---------------------------------------------------------------------------------------------------------
// What the log keeps of what a tool was asked: the same keys, long text cut, nothing nested deeper than it needs.
function clipArgs(args) {
  const out = {};
  for (const [k, v] of Object.entries(args || {}).slice(0, 20)) out[String(k).slice(0, 40)] = typeof v === "string" ? v.slice(0, 200) : typeof v === "number" || typeof v === "boolean" || v == null ? v : JSON.stringify(v).slice(0, 200);
  return out;
}
// A tool's answer as the text an app reads. Dates as ISO, numbers as numbers; past the limit it says so in words an
// AI app acts on, and what it carries up to there is still the start of the real answer.
function toText(data, max = MAX_CHARS) {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 1);
  if (text.length <= max) return { text, cut: false };
  return { text: `${text.slice(0, max)}\n\n[This answer was cut at ${max} characters of ${text.length}. Ask again for less: a smaller limit, fewer days, or one company.]`, cut: true };
}
const result = (data) => { const t = toText(data); return { content: [{ type: "text", text: t.text }], chars: t.text.length }; };

// ---- one tool call, logged ----------------------------------------------------------------------------------------
async function logCall(who, tool, args, { ok, ms, chars = null, error = null }) {
  try {
    await q("INSERT INTO platform.mcp_calls (grant_id, account_id, surface, company, tool, args, ok, ms, chars, error) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [who.grant || null, (who.account && who.account.id) || null, who.surface, who.company || null, tool, JSON.stringify(clipArgs(args)), ok, ms, chars, error ? String(error).slice(0, 300) : null]);
  } catch (e) { console.error("[mcp] could not log a call:", e.message); }
}
const READ_ONLY = "This connection is read only, so nothing was changed. To let this app write, disconnect it and connect it again, and tick \"Let it start and fill in new tool requests\" on the page that asks. Whoever connected it does that, with their passkey or code.";
// A server object for one request, offering this surface's tools as this caller.
function serverFor(surface, tools, who) {
  const server = new McpServer({ name: surface.server, title: surface.title, version: VERSION }, { instructions: surface.instructions });
  for (const t of tools) {
    server.registerTool(t.name, { title: t.title, description: t.description, inputSchema: t.input || {}, annotations: { readOnlyHint: t.readOnly !== false, destructiveHint: false, openWorldHint: false } }, async (args) => {
      const started = Date.now();
      if (t.readOnly === false && who.writes !== true) {
        await logCall(who, t.name, args, { ok: false, ms: 0, error: "read-only connection" });
        return { isError: true, content: [{ type: "text", text: READ_ONLY }] };
      }
      try {
        const out = result(await t.run(args || {}, who));
        await logCall(who, t.name, args, { ok: true, ms: Date.now() - started, chars: out.chars });
        return { content: out.content };
      } catch (e) {
        if (!e.say) console.error(`[mcp] ${surface.server}/${t.name}:`, e.stack || e.message);
        await logCall(who, t.name, args, { ok: false, ms: Date.now() - started, error: e.say ? e.message : (e.name || "Error") });
        return { isError: true, content: [{ type: "text", text: e.say ? e.message : "That did not work on Anetix's side. Nothing was changed. Try again, and if it keeps happening tell Anetix which tool it was." }] };
      }
    });
  }
  return server;
}
// The Express handlers of one MCP address.
function endpoint(surfaceKey, surface, tools) {
  const bearer = requireBearerAuth({ verifier: mcpauth.provider, resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(new URL(mcpauth.resourceOf(surfaceKey))) });
  const mine = (req, res, next) => {
    // a token of another address of this instance is no token here: the same 401, so the app signs in for this one
    if (req.auth && req.auth.extra && req.auth.extra.surface === surfaceKey) return next();
    res.set("WWW-Authenticate", `Bearer error="invalid_token", error_description="this token is for another address", resource_metadata="${getOAuthProtectedResourceMetadataUrl(new URL(mcpauth.resourceOf(surfaceKey)))}"`);
    res.status(401).json({ error: "invalid_token", error_description: "this token is for another address" });
  };
  const handle = async (req, res) => {
    if (req.method !== "POST") return res.status(405).set("Allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "This address answers POST only." }, id: null });
    const who = { ...req.auth.extra, ip: edge.clientIp(req) };
    const server = serverFor(surface, tools, who);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  };
  return [bearer, mine, express.json({ limit: "256kb" }), handle];
}

// ---- mounting -------------------------------------------------------------------------------------------------------
// The OAuth server's own description, at paths under /oauth/ (the SDK's ready-made router would put them at the
// root of the site). Claude reads this to learn where to register, where to send the person and where to trade
// codes; "none" among the token methods is what lets it act as the public client it is.
function oauthMetadata(base = mcpauth.PUBLIC) {
  return {
    issuer: base, authorization_endpoint: `${base}/oauth/authorize`, token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`, revocation_endpoint: `${base}/oauth/revoke`,
    response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "none"], revocation_endpoint_auth_methods_supported: ["client_secret_post", "none"],
  };
}
// The SDK's handlers throttle by address themselves; they are told where the address really is (edge.clientIp, the
// rule for anything that throttles) and given room for one sender that is many people: every hosted Claude app's
// calls come from Anthropic's few addresses, so a per-address limit sized for one person would lock customers out.
const limit = (windowMs, max, extra = () => "") => ({ windowMs, max, validate: false, keyGenerator: (req) => `${edge.clientIp(req)}|${extra(req)}` });

function mount(app, surfaces) {
  // off: the addresses do not exist, and nothing about the sign-in is served
  if (!mcpauth.enabled()) { app.all(["/mcp", "/mcp/*", "/oauth/*", "/.well-known/oauth-*"], (_req, res) => res.status(404).json({ error: "not found" })); return false; }
  const meta = oauthMetadata();
  // discovery: one document per MCP address (which server signs people in for it) and the sign-in server's own
  for (const key of Object.keys(surfaces)) app.use(mcpAuthMetadataRouter({ oauthMetadata: meta, resourceServerUrl: new URL(mcpauth.resourceOf(key)), resourceName: mcpauth.SURFACES[key].name }));
  // an app that looks for some other discovery document gets a plain "not here", not the sign-in page
  app.all(["/.well-known/openid-configuration", "/.well-known/oauth-*"], (_req, res) => res.status(404).json({ error: "not found" }));
  app.use("/oauth/authorize", authorizationHandler({ provider: mcpauth.provider, rateLimit: limit(15 * 60e3, 60) }));
  app.use("/oauth/token", tokenHandler({ provider: mcpauth.provider, rateLimit: limit(15 * 60e3, 120, (req) => String((req.body && req.body.client_id) || "").slice(0, 80)) }));
  app.use("/oauth/register", clientRegistrationHandler({ clientsStore: mcpauth.clientsStore, clientSecretExpirySeconds: 0, rateLimit: limit(60 * 60e3, 300) }));
  app.use("/oauth/revoke", revocationHandler({ provider: mcpauth.provider, rateLimit: limit(15 * 60e3, 120) }));
  // the consent page: never inside a frame of anyone's, never cached
  const sealed = (res) => res.set({ "Cache-Control": "no-store", "X-Frame-Options": "DENY", "Content-Security-Policy": "frame-ancestors 'none'", "Referrer-Policy": "no-referrer" });
  app.get("/oauth/consent", (_req, res) => sealed(res).sendFile(page("connect.html")));
  app.get("/oauth/consent/info", mcpauth.consentInfo);
  app.post("/oauth/consent/decide", mcpauth.json, mcpauth.consentDecide);
  for (const [key, s] of Object.entries(surfaces)) app.all(mcpauth.SURFACES[key].path, ...endpoint(key, s.surface, s.tools));
  return true;
}

module.exports = { init, mount, READ_ONLY, serverFor, endpoint, oauthMetadata, toText, clipArgs, logCall, MAX_CHARS, SCHEMA };
