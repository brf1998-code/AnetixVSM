// End to end: connector sign-in and the admin MCP (src/mcpauth.js, src/mcp.js, src/mcp-admin.js, docs/MCP.md).
// Runs against a server that is ALREADY UP in fake-agent mode on a FRESH database, with the connector switched on
// and the same environment in this shell (the script reads the database itself):
//
//   export DATABASE_URL=postgres://sos:sos@127.0.0.1:5432/sos_e2e SESSION_SECRET=e2e SOS_CONNECTION_KEY=e2e-connection-key \
//     SOS_FLOOR_PASSWORD=floorpw SOS_MANAGER_PASSWORD=mgrpw SOS_ADMIN_PASSWORD=adminpw SOS_PUBLIC_URL=http://127.0.0.1:3999
//   SOS_FAKE_AGENT=1 SOS_BROWSER=off PORT=3999 node server.js &
//   node scripts/e2e/mcp.js
//
// One more mode, against a server started WITHOUT SOS_PUBLIC_URL (what the instance is until the variable is set):
//   node scripts/e2e/mcp.js off      every connector path is a 404 and nothing about the sign-in is served
//
// The app in these tests is this script: it registers itself, walks the person's browser through the consent page
// with a cookie jar, trades the code with its PKCE proof, then talks to the address with the MCP SDK's own client.
const crypto = require("crypto");
const { PW, runner, client, login, sleep, waitFor, proposalFor, board } = require("./lib");
const totp = require("../../src/totp");
const accounts = require("../../src/accounts");
const { q, pool } = require("../../src/db");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = require("@modelcontextprotocol/sdk/client/streamableHttp.js");
const R = runner(), t = R.t;
const BASE = process.env.SOS_E2E_BASE || "http://127.0.0.1:3999";
const ADDRESS = `${BASE}/mcp/admin`;
const CLAUDE = "https://claude.ai/api/mcp/auth_callback";
const ADMIN = "brendan.mcp@anetix.test", MANAGER = "maria.mcp@plant.test";
const MARKER = "ZZ-MCP-CANARY-7731", MARKER2 = "ZZ-STOP-CANARY-4409";
const hash = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");

async function codeFor(secretText, delta = 0) {
  const into = (Date.now() / 1000) % 30;
  if (into > 27.5) await sleep((30 - into) * 1000 + 300);
  return totp.hotp(totp.base32Decode(secretText), totp.stepAt() + delta);
}
// a code this account has not used: the app's steps are put back to zero first, which only a test may do
async function freshCode(loginName, secret) { await q("UPDATE platform.account_factors SET last_step=0 WHERE account_id=(SELECT id FROM platform.accounts WHERE login=$1)", [loginName]); return codeFor(secret); }
const raw = async (method, path, { headers = {}, body, form } = {}) => {
  const res = await fetch(path.startsWith("http") ? path : BASE + path, { method, redirect: "manual",
    headers: { ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
    body: form ? new URLSearchParams(form).toString() : body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch (e) {}
  return { status: res.status, json, text, headers: res.headers, location: res.headers.get("location") };
};
const pkce = () => { const verifier = crypto.randomBytes(32).toString("base64url"); return { verifier, challenge: crypto.createHash("sha256").update(verifier).digest("base64url") }; };
const register = (extra = {}) => raw("POST", "/oauth/register", { body: { client_name: "Claude", redirect_uris: [CLAUDE], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none", ...extra } });
const authorizeUrl = (app, p, extra = {}) => `/oauth/authorize?${new URLSearchParams({ response_type: "code", client_id: app.client_id, redirect_uri: app.redirect_uris[0], code_challenge: p.challenge, code_challenge_method: "S256", state: "st-123", resource: ADDRESS, ...extra })}`;
const reqOf = (location) => new URL(location, BASE).searchParams.get("req");
// The whole dance for a signed-in admin browser: -> { app, tokens, p }
async function connect(browser, secret, { name = "Claude", writes = false } = {}) {
  const app = (await register({ client_name: name })).json, p = pkce();
  const a = await raw("GET", authorizeUrl(app, p));
  const d = await browser.post("/oauth/consent/decide", { req: reqOf(a.location), allow: true, code: await freshCode(ADMIN, secret), ...(writes ? { writes: true } : {}) });
  if (d.status !== 200) throw new Error(`consent failed: ${d.text}`);
  const back = new URL(d.json.redirect);
  const tok = await raw("POST", "/oauth/token", { form: { grant_type: "authorization_code", client_id: app.client_id, code: back.searchParams.get("code"), code_verifier: p.verifier, redirect_uri: CLAUDE, resource: ADDRESS } });
  if (tok.status !== 200) throw new Error(`token failed: ${tok.text}`);
  return { app, tokens: tok.json, p };
}
async function mcp(token) {
  const transport = new StreamableHTTPClientTransport(new URL(ADDRESS), { requestInit: { headers: { Authorization: `Bearer ${token}` } } });
  const c = new Client({ name: "e2e", version: "1.0.0" });
  await c.connect(transport);
  return c;
}
const post = (token, body = { jsonrpc: "2.0", id: 1, method: "tools/list" }) => raw("POST", "/mcp/admin", { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), Accept: "application/json, text/event-stream" }, body });
const textOf = (r) => (r.content || []).map((c) => c.text || "").join("\n");

async function off() {
  const paths = [["POST", "/mcp/admin"], ["GET", "/mcp/admin"], ["POST", "/mcp"], ["GET", "/.well-known/oauth-protected-resource/mcp/admin"], ["GET", "/.well-known/oauth-authorization-server"],
    ["POST", "/oauth/register"], ["GET", "/oauth/authorize?client_id=x"], ["POST", "/oauth/token"], ["GET", "/oauth/consent"], ["GET", "/oauth/consent/info"], ["POST", "/oauth/consent/decide"]];
  const got = [];
  for (const [m, p] of paths) got.push([m, p, (await raw(m, p, m === "POST" ? { body: {} } : {})).status]);
  t("with no SOS_PUBLIC_URL every connector path is a 404", got.every((g) => g[2] === 404), got.filter((g) => g[2] !== 404));
  const shared = await login(PW.admin, "");
  const view = (await shared.get("/api/admin/mcp")).json;
  t("and the admin page is told it is off", view && view.enabled === false && view.address === null, view);
}

async function main() {
  // ---- setup: one admin with an authenticator, one manager account with one, a floor and a shared-password session
  const shared = await login(PW.admin, "");
  const made = await shared.post("/api/admin/accounts", { login: ADMIN, display_name: "Brendan MCP", generate: true });
  const adminId = made.json.account.id;
  let admin = client();
  await admin.post("/login", { name: ADMIN, password: made.json.password });
  const secret = (await admin.post("/api/admin/accounts/me/enroll/start", {})).json.secret;
  t("(setup: the admin enrolls)", (await admin.post("/api/admin/accounts/me/enroll/verify", { code: await codeFor(secret, -1) })).status === 200);
  const signInAdmin = async () => { const c = client(); const r = await c.post("/login", { name: ADMIN, password: made.json.password, code: await freshCode(ADMIN, secret) }); if (r.status !== 200) throw new Error("admin sign-in: " + r.text); return c; };
  admin = await signInAdmin();
  const mgrMade = await accounts.create({ login: MANAGER, display_name: "Maria", password: "a-long-enough-password-1", role: "manager", company: "demo" }, "e2e", null);
  let manager = client();
  await manager.post("/login", { name: MANAGER, password: "a-long-enough-password-1" });
  const mSecret = (await manager.post("/api/c/demo/me/enroll/start", {})).json.secret;
  t("(setup: the manager account enrolls)", (await manager.post("/api/c/demo/me/enroll/verify", { code: await codeFor(mSecret, -1) })).status === 200 && Boolean(mgrMade.account.id));
  manager = client();
  await q("UPDATE platform.account_factors SET last_step=0 WHERE account_id=$1", [mgrMade.account.id]);
  t("(setup: the manager signs in)", (await manager.post("/login", { name: MANAGER, password: "a-long-enough-password-1", code: await codeFor(mSecret) })).status === 200);
  const floor = await login(PW.floor, "demo"), sharedMgr = await login(PW.manager, "demo");

  // ---- discovery
  const bare = await post(null);
  const prmUrl = `${BASE}/.well-known/oauth-protected-resource/mcp/admin`;
  t("a call with no token is a 401 that points at the discovery document", bare.status === 401 && String(bare.headers.get("www-authenticate")).includes(`resource_metadata="${prmUrl}"`), bare.headers.get("www-authenticate"));
  t("a GET with no token is the same 401, not a sign-in page", (await raw("GET", "/mcp/admin")).status === 401);
  const prm = (await raw("GET", prmUrl)).json;
  t("the document names this address exactly, and one sign-in server", prm.resource === ADDRESS && prm.authorization_servers.length === 1 && prm.authorization_servers[0] === BASE, prm);
  t("a discovery document this server does not have is a plain 404, not the sign-in page", (await raw("GET", "/.well-known/openid-configuration")).status === 404 && (await raw("GET", "/.well-known/oauth-protected-resource")).status === 404);
  const meta = (await raw("GET", "/.well-known/oauth-authorization-server")).json;
  t("the sign-in server's description: its paths under /oauth/, PKCE S256, public clients, registration", meta.issuer === BASE && meta.authorization_endpoint === `${BASE}/oauth/authorize` && meta.token_endpoint === `${BASE}/oauth/token`
    && meta.registration_endpoint === `${BASE}/oauth/register` && meta.code_challenge_methods_supported.join() === "S256" && meta.token_endpoint_auth_methods_supported.includes("none"), meta);

  // ---- an app registers itself
  const reg = await register();
  t("an app that wants answers at Claude's callback is registered, as a public client with no secret", reg.status === 201 && Boolean(reg.json.client_id) && !reg.json.client_secret && reg.json.redirect_uris[0] === CLAUDE, reg.text);
  const evil = await register({ redirect_uris: ["https://evil.example/cb"] });
  t("an app that wants answers anywhere else is refused", evil.status === 400 && evil.json.error === "invalid_client_metadata", evil.text);
  const mixed = await register({ redirect_uris: [CLAUDE, "https://claude.ai.evil.example/api/mcp/auth_callback"] });
  t("a good address beside a bad one: registered for the good one alone", mixed.status === 201 && mixed.json.redirect_uris.length === 1 && mixed.json.redirect_uris[0] === CLAUDE, mixed.text);
  const mixedAz = await raw("GET", authorizeUrl({ client_id: mixed.json.client_id, redirect_uris: ["https://claude.ai.evil.example/api/mcp/auth_callback"] }, pkce()));
  t("and it cannot ask for the answer at the one that was left out", mixedAz.status === 400, mixedAz.text);
  t("Claude's callback with something added is refused", (await register({ redirect_uris: [CLAUDE + "?x=1"] })).status === 400 && (await register({ redirect_uris: ["http://claude.ai/api/mcp/auth_callback"] })).status === 400);
  const local = await register({ client_name: "Claude Code", redirect_uris: ["http://localhost:3118/callback", "http://127.0.0.1:3118/callback"] });
  t("an app on the person's own computer is registered", local.status === 201, local.text);
  const conf = await register({ client_name: "Confidential", token_endpoint_auth_method: "client_secret_post" });
  const kept = (await q("SELECT info, secret FROM platform.mcp_clients WHERE client_id=$1", [conf.json.client_id])).rows[0];
  t("a confidential app gets a secret once, and it is kept encrypted", conf.status === 201 && /^[0-9a-f]{64}$/.test(conf.json.client_secret) && !JSON.stringify(kept.info).includes(conf.json.client_secret) && kept.secret && !kept.secret.toString("latin1").includes(conf.json.client_secret));
  const long = await register({ client_name: "A".repeat(500) + "\n<script>" });
  t("an app's name is cut and cleaned", long.status === 201 && long.json.client_name.length <= 80 && !/\n/.test(long.json.client_name));

  // ---- /oauth/authorize: checks the app, then hands the browser to the consent page
  const app = reg.json, p = pkce();
  t("an unknown app is refused before any redirect", (await raw("GET", authorizeUrl({ client_id: "nobody", redirect_uris: [CLAUDE] }, p))).status === 400);
  t("a redirect address the app did not register is refused before any redirect", (await raw("GET", authorizeUrl({ ...app, redirect_uris: ["http://localhost:1/callback"] }, p))).status === 400);
  const noPkce = await raw("GET", `/oauth/authorize?${new URLSearchParams({ response_type: "code", client_id: app.client_id, redirect_uri: CLAUDE, state: "s" })}`);
  t("no PKCE challenge: the app is told so at its own address, with no code", noPkce.status === 302 && noPkce.location.startsWith(CLAUDE) && /error=invalid_request/.test(noPkce.location) && !/[?&]code=/.test(noPkce.location), noPkce.location);
  const wrongRes = await raw("GET", authorizeUrl(app, p, { resource: "https://example.com/mcp" }));
  t("a request for some other server's address is refused", wrongRes.status === 302 && /error=invalid_target/.test(wrongRes.location), wrongRes.location);
  const az = await raw("GET", authorizeUrl(app, p));
  t("a good request goes to the consent page, and no code exists yet", az.status === 302 && az.location.startsWith("/oauth/consent?req=") && (await q("SELECT count(*)::int AS n FROM platform.mcp_codes")).rows[0].n === 0, az.location);
  const sealed = reqOf(az.location);
  const pageRes = await raw("GET", az.location);
  t("the consent page is served, never inside a frame", pageRes.status === 200 && /Connect an app/.test(pageRes.text) && pageRes.headers.get("x-frame-options") === "DENY" && /frame-ancestors 'none'/.test(pageRes.headers.get("content-security-policy") || ""));
  t("the page carries no em or en dash", !/[\u2013\u2014]/.test(pageRes.text));

  // ---- the consent page's question: who is asking
  const info = (path, c) => (c ? c.get(path) : raw("GET", path));
  const infoPath = `/oauth/consent/info?req=${encodeURIComponent(sealed)}`;
  t("nobody signed in: 401, and nothing about the request", (await info(infoPath)).status === 401 && !/Claude/.test((await info(infoPath)).text));
  t("a floor session is nobody here", (await info(infoPath, floor)).status === 401);
  t("a shared manager password's session is nobody here", (await info(infoPath, sharedMgr)).status === 401);
  t("the shared admin password's session is nobody here", (await info(infoPath, shared)).status === 401);
  const mi = await info(infoPath, manager);
  t("a manager account is told this address is not for it", mi.status === 200 && mi.json.allowed === false && /not open yet/.test(mi.json.why), mi.text);
  const ai = await info(infoPath, admin);
  t("the admin is shown the app, where the answer goes, the address and what is asked", ai.status === 200 && ai.json.allowed === true && ai.json.app.name === "Claude" && ai.json.app.sends_to === "claude.ai" && ai.json.app.this_computer === false
    && ai.json.address === ADDRESS && ai.json.account.login === ADMIN && ai.json.step_up === "code" && ai.json.lasts.idle_days === 7 && ai.json.lasts.cap_days === 30, ai.text);
  const tampered = sealed.replace(/^(.{12})./, (m, a) => a + (m.slice(-1) === "A" ? "B" : "A"));
  t("a request changed in the address is refused", (await info(`/oauth/consent/info?req=${encodeURIComponent(tampered)}`, admin)).status === 400);
  const azLocal = await raw("GET", authorizeUrl(local.json, p, { redirect_uri: "http://localhost:50999/callback" }));
  const li = await info(`/oauth/consent/info?req=${encodeURIComponent(reqOf(azLocal.location))}`, admin);
  t("an app on this computer, on whatever port it got: the page is told to warn", azLocal.status === 302 && li.json.app.this_computer === true && li.json.app.sends_to === "localhost:50999", li.text);

  // ---- the answer
  const decide = (c, body, headers) => (headers ? raw("POST", "/oauth/consent/decide", { body, headers }) : c.post("/oauth/consent/decide", body));
  t("nobody signed in cannot answer", (await raw("POST", "/oauth/consent/decide", { body: { req: sealed, allow: true } })).status === 401);
  const md = await decide(manager, { req: sealed, allow: true, code: await freshCode(MANAGER, mSecret) });
  t("a manager account cannot allow it, even with a good code", md.status === 403 && !md.json.redirect, md.text);
  const noCode = await decide(admin, { req: sealed, allow: true });
  t("the admin's session alone does not connect an app: a fresh code is asked for", noCode.status === 403 && noCode.json.step_up === true && !noCode.json.redirect, noCode.text);
  t("a wrong code is refused", (await decide(admin, { req: sealed, allow: true, code: "000000" })).status === 403);
  await q("UPDATE platform.accounts SET failed_count=0, locked_until=NULL WHERE login=$1", [ADMIN]);
  const cookie = admin.cookies().map((c) => `${c.name}=${c.value}`).join("; ");
  const cross = await decide(null, { req: sealed, allow: true, code: await freshCode(ADMIN, secret) }, { Cookie: cookie, Origin: "https://evil.example" });
  t("an answer posted from another site is refused, good code and cookie and all", cross.status === 403 && !cross.json.redirect, cross.text);
  t("still no code exists", (await q("SELECT count(*)::int AS n FROM platform.mcp_codes")).rows[0].n === 0);
  const no = await decide(admin, { req: sealed, allow: false });
  t("Cancel sends the app a no, with its state and no code", no.status === 200 && no.json.redirect.startsWith(CLAUDE) && /error=access_denied/.test(no.json.redirect) && /state=st-123/.test(no.json.redirect) && !/[?&]code=/.test(no.json.redirect), no.text);
  const yes = await decide(admin, { req: sealed, allow: true, code: await freshCode(ADMIN, secret) });
  const back = yes.json && yes.json.redirect ? new URL(yes.json.redirect) : null;
  const code = back && back.searchParams.get("code");
  t("Allow with a fresh code sends the app a one-time code and its state, at Claude's callback", yes.status === 200 && back.origin + back.pathname === CLAUDE && /^anx_ac_/.test(code) && back.searchParams.get("state") === "st-123", yes.text);
  const codeRow = (await q("SELECT * FROM platform.mcp_codes")).rows[0];
  t("only the code's hash is kept", codeRow.code_hash === hash(code) && !JSON.stringify(codeRow).includes(code));

  // ---- trading the code
  const trade = (form) => raw("POST", "/oauth/token", { form: { grant_type: "authorization_code", client_id: app.client_id, redirect_uri: CLAUDE, ...form } });
  t("the wrong PKCE proof gets nothing", (await trade({ code, code_verifier: pkce().verifier })).status === 400);
  t("another app cannot trade it", (await raw("POST", "/oauth/token", { form: { grant_type: "authorization_code", client_id: local.json.client_id, code, code_verifier: p.verifier } })).status === 400);
  t("nor for another address, nor from another redirect address", (await trade({ code, code_verifier: p.verifier, resource: "https://example.com/mcp" })).status === 400 && (await trade({ code, code_verifier: p.verifier, redirect_uri: "http://localhost:1/callback" })).status === 400);
  t("none of those spent the code or made a connection", (await q("SELECT used_at FROM platform.mcp_codes WHERE code_hash=$1", [hash(code)])).rows[0].used_at === null && (await q("SELECT count(*)::int AS n FROM platform.mcp_grants")).rows[0].n === 0);
  const tok = await trade({ code, code_verifier: p.verifier, resource: ADDRESS });
  t("the right proof gets an access token and a refresh token", tok.status === 200 && /^anx_at_/.test(tok.json.access_token) && /^anx_rt_/.test(tok.json.refresh_token) && tok.json.token_type === "bearer" && tok.json.expires_in > 3500 && tok.json.expires_in <= 3600, tok.text);
  const tokenRows = (await q("SELECT * FROM platform.mcp_tokens")).rows;
  t("only the tokens' hashes are kept", tokenRows.some((r) => r.token_hash === hash(tok.json.access_token)) && !JSON.stringify(tokenRows).includes(tok.json.access_token) && !JSON.stringify(tokenRows).includes(tok.json.refresh_token));

  // a code used twice ends the connection it made
  const c2 = await (async () => {
    const a2 = (await register()).json, p2 = pkce();
    const z = await raw("GET", authorizeUrl(a2, p2));
    const d = await admin.post("/oauth/consent/decide", { req: reqOf(z.location), allow: true, code: await freshCode(ADMIN, secret) });
    const cd = new URL(d.json.redirect).searchParams.get("code");
    const form = { grant_type: "authorization_code", client_id: a2.client_id, code: cd, code_verifier: p2.verifier };
    const first = await raw("POST", "/oauth/token", { form });
    const live = (await post(first.json.access_token)).status;
    const second = await raw("POST", "/oauth/token", { form });
    return { first, live, second, after: (await post(first.json.access_token)).status };
  })();
  t("a code traded twice: the second gets nothing and the connection the first made is ended", c2.first.status === 200 && c2.live === 200 && c2.second.status === 400 && c2.second.json.error === "invalid_grant" && c2.after === 401, [c2.live, c2.second.text, c2.after]);

  // ---- the address itself
  const AT = tok.json.access_token;
  t("the admin's cookie alone never opens the address", (await raw("POST", "/mcp/admin", { headers: { Cookie: cookie, Accept: "application/json, text/event-stream" }, body: { jsonrpc: "2.0", id: 1, method: "tools/list" } })).status === 401);
  t("the internal token never opens it", (await raw("POST", "/mcp/admin", { headers: { "x-sos-internal": process.env.SOS_INTERNAL_TOKEN || "e2e-internal", Accept: "application/json, text/event-stream" }, body: {} })).status === 401);
  t("a made-up token, a refresh token and a code are no token", (await post("anx_at_" + "A".repeat(43))).status === 401 && (await post(tok.json.refresh_token)).status === 401 && (await post(code)).status === 401);
  const noCookie = await post(AT);
  t("a good token is answered, and no cookie is ever set", noCookie.status === 200 && !noCookie.headers.get("set-cookie"), noCookie.text.slice(0, 200));
  t("GET and DELETE are a 405", (await raw("GET", "/mcp/admin", { headers: { Authorization: `Bearer ${AT}` } })).status === 405 && (await raw("DELETE", "/mcp/admin", { headers: { Authorization: `Bearer ${AT}` } })).status === 405);

  // something for the tools to find, and two things they must never carry
  await q("UPDATE mod_demo_paperline.stations SET name=$1 WHERE id=(SELECT min(id) FROM mod_demo_paperline.stations)", [MARKER]);
  const fb = (await floor.post("/api/feedback", { company: "demo", module: "paperline", page: "/c/demo/m/paperline/", message: "Make the release button bigger" })).json;
  const prop = await proposalFor(sharedMgr, fb.id);
  const run = (await sharedMgr.post(`/api/proposals/${prop.id}/decide`, { decision: "approve" })).json;
  const runId = (run.run || run).id;
  await waitFor("the build to reach a gate", async () => { const x = (await board(sharedMgr)).runs.find((y) => y.id === runId); return x && x.status !== "running" && x.status !== "queued" ? x : null; });
  await q(`UPDATE platform.build_runs SET evidence = evidence || $2::jsonb, log = log || $3::jsonb WHERE id=$1`, [runId, JSON.stringify({ error: `platform checks failed: the answer held ${MARKER2}` }),
    JSON.stringify([{ t: new Date().toISOString(), step: "error", note: `platform checks failed: the answer held ${MARKER2}` }])]);
  await floor.post("/api/feedback", { company: "demo", module: "platform", page: "/c/demo/", message: "Please add a dark screen for the night shift" });

  // the audit tools (2026-10-12): an Ask Anetix answer that read the tool's records (it carries MARKER) must be withheld,
  // and the words of a check, a system review, a saved agent doc and a chat persona's answer must stay out
  const askA = async (text) => {
    const conv = (await sharedMgr.post("/api/c/demo/assist/conversations", { scope: { kind: "tool", module: "paperline" } })).json.conversation;
    const sent = (await sharedMgr.post(`/api/c/demo/assist/conversations/${conv.id}/messages`, { text })).json;
    return waitFor("the assistant's answer", async () => { const j = (await sharedMgr.get(`/api/c/demo/assist/conversations/${conv.id}`)).json; const m = j.messages.find((x) => x.id === sent.assistant.id); return m && m.status !== "running" ? { conv, m } : null; });
  };
  const readAns = await askA(`Which stations are there? [[read_records {"table":"stations"}]]`);
  t("setup: the assistant's answer read the station named with the canary", (readAns.m.text || "").includes(MARKER), (readAns.m.text || "").slice(0, 200));
  const plainAns = await askA("What tools do we have? [[list_tools]]");
  for (const kind of ["check_verdict", "review_findings", "doc_saved", "chat_answer"]) await q("INSERT INTO platform.record (company, module, kind, actor_role, after) VALUES ('demo','paperline',$1,'agent',$2)", [kind, `the words held ${kind === "check_verdict" ? MARKER2 : MARKER}`]);
  const c = await mcp(AT);
  const listed = await c.listTools();
  const names = listed.tools.map((x) => x.name).sort();
  const WRITERS = ["answer_tool_request", "change_tool_request_design", "send_tool_request", "start_tool_request"];
  t("the address offers the twelve operations tools and the six new tool request tools", names.join() === ["activity_since", "ai_spend", "answer_tool_request", "change_tool_request_design", "get_demo", "get_tool_request", "list_assistant_conversations", "list_board_requests", "list_companies", "list_demos", "list_requests_to_anetix", "list_runs", "list_sites", "list_stopped_builds", "list_tool_requests", "loop_health", "send_tool_request", "start_tool_request"].join(), names);
  t("four say they write, every other one says it only reads, none is destructive, each has a description", listed.tools.every((x) => x.annotations && x.annotations.readOnlyHint === !WRITERS.includes(x.name) && x.annotations.destructiveHint === false && x.description.length > 40));
  t("the server says what it is", /read only/i.test(c.getInstructions() || "") && c.getServerVersion().name === "anetix-admin");
  const call = async (name, args = {}) => { const r = await c.callTool({ name, arguments: args }); let data = null; try { data = JSON.parse(textOf(r)); } catch (e) {} return { r, data, text: textOf(r) }; };
  const all = {};
  for (const [name, args] of [["list_companies", {}], ["list_demos", {}], ["list_sites", {}], ["loop_health", {}], ["loop_health", { days: 7, company: "demo" }], ["ai_spend", {}], ["list_requests_to_anetix", {}],
    ["list_requests_to_anetix", { status: "all", limit: 5 }], ["list_stopped_builds", {}], ["list_runs", {}], ["list_runs", { company: "demo", days: 1, limit: 5 }], ["list_tool_requests", {}], ["list_tool_requests", { company: "demo", open_only: false }],
    ["activity_since", {}], ["activity_since", { hours: 24, company: "demo", limit: 5 }], ["list_assistant_conversations", {}], ["list_board_requests", {}], ["list_board_requests", { status: "all", company: "demo" }]]) all[`${name} ${JSON.stringify(args)}`] = await call(name, args);
  t("every tool answers with JSON and no error", Object.values(all).every((x) => !x.r.isError && x.data), Object.entries(all).filter(([, x]) => x.r.isError || !x.data).map(([k, x]) => [k, x.text.slice(0, 200)]));
  const co = all["list_companies {}"].data.companies.find((x) => x.slug === "demo");
  t("list_companies: the demo company, its tools and counts", co && co.kind === "trial" && co.tools.some((x) => x.name === "paperline" && x.live_version >= 1) && co.requests.total >= 2 && co.builds.builds >= 1 && co.walled_off_from_ai === false, co);
  const runs = all["list_runs {}"].data.runs, mine = runs.find((x) => x.id === runId);
  t("list_runs: the build, its tool, and its stop as a kind", mine && mine.module === "paperline" && mine.stops.length === 1 && mine.stops[0].kind === "gate", mine);
  t("list_requests_to_anetix: the request to Anetix, in the words written", all["list_requests_to_anetix {}"].data.requests.some((x) => /dark screen for the night shift/.test(x.message) && x.company === "demo"));
  t("loop_health: the fleet and the companies; with a company, only that one", all["loop_health {}"].data.fleet && all["loop_health {}"].data.companies.length >= 1 && all['loop_health {"days":7,"company":"demo"}'].data.companies.length === 1 && all['loop_health {"days":7,"company":"demo"}'].data.window_days === 7);
  t("ai_spend: this month and the thresholds", typeof all["ai_spend {}"].data.this_month_usd === "number" && Boolean(all["ai_spend {}"].data.alert_thresholds));
  const act = all["activity_since {}"].data;
  t("activity_since: the request filed, in the words written, with who and the tool", act.activity.some((x) => x.kind === "feedback_filed" && /release button bigger/.test(x.words || "") && x.tool === "paperline" && x.company === "demo"), act.activity.map((x) => x.kind));
  t("activity_since: a check's verdict shows, its words do not", act.activity.some((x) => x.kind === "check_verdict" && x.words === null));
  t("activity_since: a chat persona's lines are left out, and it says what it leaves out", !act.activity.some((x) => /^chat_/.test(x.kind)) && /Ask Anetix/.test(act.left_out));
  t("activity_since: grouped by company, and the limit says there is more", act.companies.some((x) => x.company === "demo" && x.lines > 0) && all['activity_since {"hours":24,"company":"demo","limit":5}'].data.more === true && all['activity_since {"hours":24,"company":"demo","limit":5}'].data.activity.length === 5);
  const asst = all["list_assistant_conversations {}"].data;
  const convOf = (id) => asst.conversations.find((x) => x.id === id);
  const rc = convOf(readAns.conv.id), pc = convOf(plainAns.conv.id);
  t("list_assistant_conversations: who asked, where, and the question in the words typed", rc && rc.role === "manager" && rc.scope === "tool: Paper Airplane Line" && rc.messages.some((x) => /Which stations are there/.test(x.asked || "")), rc);
  t("an answer that read the tool's records is withheld, with the tool it used", rc && rc.messages.some((x) => x.withheld && x.answered === null && x.tools.includes("read_records")), rc && rc.messages);
  t("an answer that read no records comes back in full", pc && pc.messages.some((x) => /Paper Airplane Line/.test(x.answered || "") && x.tools.includes("list_tools")), pc && pc.messages);
  t("the totals count the questions", asst.totals.questions >= 2 && asst.totals.conversations >= 2, asst.totals);
  const br = all["list_board_requests {}"].data;
  t("list_board_requests: the open request in its words; a request to Anetix is not a board request", br.requests.some((x) => x.id === fb.id && /release button bigger/.test(x.words)) && !br.requests.some((x) => /dark screen/.test(x.words)), br.requests.map((x) => x.words));
  t("list_board_requests: counts by company", br.counts.some((x) => x.company === "demo"));
  const everything = Object.values(all).map((x) => x.text).join("\n");
  t("no answer carries a record from a company's tool", !everything.includes(MARKER));
  t("no answer carries the words of a failed check", !everything.includes(MARKER2));
  t("no answer carries a password hash, a token or an address someone signed in from", !/password_hash|s1\$|anx_(at|rt|ac)_|secret_enc/.test(everything));
  const bad = await call("get_demo", { company: "no-such-company" });
  t("a company that is not there: an error in words, not a crash", bad.r.isError === true && /No demo by that slug/.test(bad.text), bad.text);
  const odd = await call("list_runs", { company: "Not A Slug!" });
  t("a slug that is no slug: an error in words", odd.r.isError === true && /short name/.test(odd.text), odd.text);
  let threw = null; try { await c.callTool({ name: "list_runs", arguments: { limit: 100000 } }); } catch (e) { threw = e; }
  const overLimit = threw ? true : false;
  const over = threw ? null : await c.callTool({ name: "list_runs", arguments: { limit: 100000 } });
  t("an argument outside what a tool takes is refused", overLimit || (over && over.isError === true), over && textOf(over));
  let noTool = null; try { const r = await c.callTool({ name: "delete_company", arguments: {} }); noTool = r.isError ? "error" : "answered"; } catch (e) { noTool = "error"; }
  t("a tool that does not exist is not there", noTool === "error");
  // this connection was allowed with no tick: it reads, and a write tool changes nothing
  const ro = await call("start_tool_request", { company: "demo" });
  t("a connection allowed without the tick cannot write: the tool says so and nothing is started", ro.r.isError === true && /read only/.test(ro.text) && /connect it again/.test(ro.text) && (await q("SELECT count(*)::int AS n FROM platform.module_intakes")).rows[0].n === 0, ro.text);
  t("and the refusal is in the call log as one that did not work", (await q("SELECT ok, error FROM platform.mcp_calls WHERE tool='start_tool_request' ORDER BY id DESC LIMIT 1")).rows[0].error === "read-only connection");
  await c.close();
  await writeTools({ admin, secret, sharedMgr, shared, adminId });

  // ---- the same, with nothing done by hand: the MCP SDK's own OAuth client finds its way from the 401 alone
  // (discovery, registration, PKCE, the trade, a refresh), the way Claude's does. Only the person's part is played here.
  {
    const { UnauthorizedError } = require("@modelcontextprotocol/sdk/client/auth.js");
    const mem = { went: null };
    const authProvider = {
      get redirectUrl() { return CLAUDE; },
      get clientMetadata() { return { client_name: "SDK client", redirect_uris: [CLAUDE], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" }; },
      clientInformation: () => mem.client, saveClientInformation: (x) => { mem.client = x; },
      tokens: () => mem.tokens, saveTokens: (x) => { mem.tokens = x; },
      redirectToAuthorization: (url) => { mem.went = url; },
      saveCodeVerifier: (v) => { mem.verifier = v; }, codeVerifier: () => mem.verifier,
    };
    let tr = new StreamableHTTPClientTransport(new URL(ADDRESS), { authProvider });
    let sdk = new Client({ name: "sdk-oauth", version: "1.0.0" });
    let unauthorized = false;
    try { await sdk.connect(tr); } catch (e) { unauthorized = e instanceof UnauthorizedError; }
    const went = mem.went ? new URL(mem.went) : null;
    t("the SDK's client, given only the address: it registers itself and sends the person to /oauth/authorize for this address", unauthorized && went && went.origin + went.pathname === `${BASE}/oauth/authorize` && went.searchParams.get("resource") === ADDRESS && went.searchParams.get("code_challenge_method") === "S256" && Boolean(mem.client && mem.client.client_id), mem.went && String(mem.went));
    const z = await raw("GET", went.pathname + went.search);
    const d = await admin.post("/oauth/consent/decide", { req: reqOf(z.location), allow: true, code: await freshCode(ADMIN, secret) });
    await tr.finishAuth(new URL(d.json.redirect).searchParams.get("code"));
    tr = new StreamableHTTPClientTransport(new URL(ADDRESS), { authProvider });
    sdk = new Client({ name: "sdk-oauth", version: "1.0.0" });
    await sdk.connect(tr);
    const got = await sdk.callTool({ name: "list_companies", arguments: {} });
    t("after the person allows it, it trades the code and calls a tool", !got.isError && /"slug": "demo"/.test(textOf(got)) && /^anx_at_/.test(mem.tokens.access_token));
    const before = mem.tokens.access_token;
    await q("UPDATE platform.mcp_tokens SET expires_at = now() - interval '1 second' WHERE token_hash=$1", [hash(before)]);
    const again = await sdk.callTool({ name: "ai_spend", arguments: {} });
    t("when its access token runs out it refreshes by itself and carries on", !again.isError && mem.tokens.access_token !== before);
    await sdk.close();
  }

  // ---- the call log
  const calls = (await q("SELECT * FROM platform.mcp_calls ORDER BY id")).rows;
  t("every tool call is one row: who, which app, which tool, whether it worked", calls.length >= 13 && calls.every((r) => r.account_id === adminId && r.surface === "admin" && r.grant_id) && calls.some((r) => r.tool === "get_demo" && r.ok === false) && calls.filter((r) => r.ok).every((r) => r.chars > 0 && r.ms >= 0), calls.slice(-3));
  t("it keeps what was asked, never what was answered", calls.some((r) => r.tool === "list_runs" && r.args && r.args.company === "demo") && !JSON.stringify(calls).includes("paperline") && !JSON.stringify(calls).includes(MARKER) && !JSON.stringify(calls).includes("status_means"));
  t("a long answer written through a tool is cut in the log", calls.filter((r) => r.tool === "answer_tool_request").every((r) => JSON.stringify(r.args).length < 700));
  const evs = (await q("SELECT event FROM platform.auth_events WHERE account_id=$1 AND event LIKE 'mcp_%'", [adminId])).rows.map((r) => r.event);
  t("connecting is on the sign-in log: the yes, the no, the connection, the code used twice", ["mcp_consent_yes", "mcp_consent_no", "mcp_connected", "mcp_code_reuse"].every((e) => evs.includes(e)), evs);

  // ---- /admin: the connected apps
  const view = (await admin.get("/api/admin/mcp")).json;
  const row = view.grants.find((g) => g.client_name === "Claude" && g.calls >= 13);
  t("the Accounts tab's list: the app, whose it is, when, how many calls, and the address to paste", view.enabled === true && view.address === ADDRESS && row && row.login === ADMIN && row.redirect_host === "claude.ai" && Boolean(row.expires_at), view.grants);
  t("it carries no token and no hash", !/anx_|token_hash|[0-9a-f]{64}/.test(JSON.stringify(view)));
  t("a manager account and a floor session cannot read it", (await manager.get("/api/admin/mcp")).status === 403 && (await floor.get("/api/admin/mcp")).status === 403);
  t("nor disconnect anything", (await manager.post(`/api/admin/mcp/grants/${row.id}/disconnect`, {})).status === 403);

  // ---- refresh: one use each
  const refresh = (rt, appId = app.client_id) => raw("POST", "/oauth/token", { form: { grant_type: "refresh_token", client_id: appId, refresh_token: rt } });
  t("another app cannot use this app's refresh token", (await refresh(tok.json.refresh_token, local.json.client_id)).status === 400);
  const r1 = await refresh(tok.json.refresh_token);
  t("a refresh gives a new access token and a new refresh token", r1.status === 200 && r1.json.access_token !== AT && r1.json.refresh_token !== tok.json.refresh_token && (await post(r1.json.access_token)).status === 200, r1.text);
  const r1again = await refresh(tok.json.refresh_token);
  t("the old refresh token again, moments later: refused as invalid_grant, and the connection lives", r1again.status === 400 && r1again.json.error === "invalid_grant" && (await post(r1.json.access_token)).status === 200, r1again.text);
  await q("UPDATE platform.mcp_tokens SET used_at = now() - interval '5 minutes' WHERE token_hash=$1", [hash(tok.json.refresh_token)]);
  const r1late = await refresh(tok.json.refresh_token);
  t("the old refresh token again, minutes later: someone else holds a copy, so the connection is ended", r1late.status === 400 && (await post(r1.json.access_token)).status === 401 && (await refresh(r1.json.refresh_token)).status === 400, r1late.text);

  // ---- what ends a connection
  let k = await connect(admin, secret, { name: "Claude two" });
  await q("UPDATE platform.mcp_tokens SET expires_at = now() - interval '1 second' WHERE token_hash=$1", [hash(k.tokens.access_token)]);
  t("an access token past its hour is a 401, and a refresh brings a new one", (await post(k.tokens.access_token)).status === 401 && (await refresh(k.tokens.refresh_token, k.app.client_id)).status === 200);
  k = await connect(admin, secret, { name: "Claude three" });
  await q("UPDATE platform.mcp_grants SET expires_at = now() - interval '1 second' WHERE id=(SELECT grant_id FROM platform.mcp_tokens WHERE token_hash=$1)", [hash(k.tokens.access_token)]);
  const capped = await refresh(k.tokens.refresh_token, k.app.client_id);
  t("a connection past its cap: the token is dead and so is the refresh (invalid_grant: connect again)", (await post(k.tokens.access_token)).status === 401 && capped.status === 400 && capped.json.error === "invalid_grant");
  k = await connect(admin, secret, { name: "Claude four" });
  await q("UPDATE platform.mcp_grants SET surface='company' WHERE id=(SELECT grant_id FROM platform.mcp_tokens WHERE token_hash=$1)", [hash(k.tokens.access_token)]);
  t("a token made for another address of this instance is no token here", (await post(k.tokens.access_token)).status === 401);
  k = await connect(admin, secret, { name: "Claude five" });
  const gid = (await q("SELECT grant_id FROM platform.mcp_tokens WHERE token_hash=$1", [hash(k.tokens.access_token)])).rows[0].grant_id;
  const dis = await admin.post(`/api/admin/mcp/grants/${gid}/disconnect`, {});
  t("Disconnect on the admin page ends it at once, refresh and all", dis.status === 200 && (await post(k.tokens.access_token)).status === 401 && (await refresh(k.tokens.refresh_token, k.app.client_id)).status === 400 && (await admin.post(`/api/admin/mcp/grants/${gid}/disconnect`, {})).status === 404);
  k = await connect(admin, secret, { name: "Claude six" });
  const rv = await raw("POST", "/oauth/revoke", { form: { client_id: k.app.client_id, token: k.tokens.refresh_token } });
  t("the app saying it is done (revoke) ends it", rv.status === 200 && (await post(k.tokens.access_token)).status === 401, rv.text);
  k = await connect(admin, secret, { name: "Claude seven" });
  t("(a live connection before Sign out everywhere)", (await post(k.tokens.access_token)).status === 200);
  const out = await admin.post(`/api/admin/accounts/${adminId}/signout`, {});
  t("Sign out everywhere ends every app the account connected", out.status === 200 && (await post(k.tokens.access_token)).status === 401 && (await refresh(k.tokens.refresh_token, k.app.client_id)).status === 400);
  admin = await signInAdmin();
  k = await connect(admin, secret, { name: "Claude eight" });
  await q("UPDATE platform.accounts SET status='disabled' WHERE id=$1", [adminId]);
  await sleep(10500);   // the account's state is remembered for ten seconds; a change made on /admin forgets it at once, this one was made behind its back
  t("an account switched off: its apps are out", (await post(k.tokens.access_token)).status === 401);
  await q("UPDATE platform.accounts SET status='active' WHERE id=$1", [adminId]);
  const left = (await require("../../src/mcpauth").grantsView()).grants;
  t("and the admin page lists none of its connections any more", left.length === 0, left);
}

// ---- the write tools: a new tool request started and filled in by Anetix's own app (src/mcp-intake.js) -----------------
async function writeTools({ admin, secret, sharedMgr, shared, adminId }) {
  const intake = require("../../src/intake");
  // the consent page offers the tick, and only the tick makes a connection that writes
  const app = (await register({ client_name: "Claude writer" })).json, p = pkce();
  const az = await raw("GET", authorizeUrl(app, p));
  const info = await admin.get(`/oauth/consent/info?req=${encodeURIComponent(reqOf(az.location))}`);
  t("the consent page is told this address has something to write", info.json.can_write === true, info.text);
  const w = await connect(admin, secret, { name: "Claude writer", writes: true });
  const grants = (await q("SELECT client_name, writes FROM platform.mcp_grants WHERE revoked_at IS NULL ORDER BY id")).rows;
  t("only the connection that was ticked may write, and the admin page says which", grants.find((g) => g.client_name === "Claude writer").writes === true && grants.filter((g) => g.client_name !== "Claude writer").every((g) => g.writes === false)
    && (await admin.get("/api/admin/mcp")).json.grants.find((g) => g.client_name === "Claude writer").writes === true, grants);
  t("the sign-in log says the yes included writing", (await q("SELECT detail FROM platform.auth_events WHERE event='mcp_consent_yes' ORDER BY id DESC LIMIT 1")).rows[0].detail.writes === true);
  const c = await mcp(w.tokens.access_token);
  const call = async (name, args = {}) => { const r = await c.callTool({ name, arguments: args }); let data = null; try { data = JSON.parse(textOf(r)); } catch (e) {} return { r, data, text: textOf(r) }; };
  const texts = [];
  const keep = (x) => { texts.push(x.text); return x; };

  // ---- start
  t("a company that is not there: words, and nothing made", (await call("start_tool_request", { company: "no-such-co" })).r.isError === true && (await q("SELECT count(*)::int AS n FROM platform.module_intakes")).rows[0].n === 0);
  const st = keep(await call("start_tool_request", { company: "demo" }));
  const id = st.data && st.data.request.id;
  t("start_tool_request: a request for the company, started by Anetix, with every question and what each takes", !st.r.isError && id > 0 && st.data.carried_on === false && st.data.request.status === "answering" && st.data.request.writable_here === true && /by Anetix/.test(st.data.request.started)
    && st.data.request.questions.length >= 12 && st.data.request.questions.every((x) => x.takes.length > 20 && x.answered === false) && st.data.request.missing.includes("name") && st.data.request.board === `${BASE}/c/demo/`, st.text.slice(0, 400));
  const b1 = await board(sharedMgr);
  const tile = b1.feedback.find((f) => f.intake_id === id);
  t("the board shows it as a new tool request started by Anetix", tile && tile.kind === "module_request" && tile.name === "Anetix" && b1.intakes[id].via === "anetix" && b1.intakes[id].status === "answering", tile);
  const again = await call("start_tool_request", { company: "demo" });
  t("starting again carries on with the same request: one at a time", again.data.carried_on === true && again.data.request.id === id && (await q("SELECT count(*)::int AS n FROM platform.module_intakes")).rows[0].n === 1);

  // ---- answers
  const early = await call("send_tool_request", { id });
  t("sending before the needed answers are in is refused, and says which are missing", early.r.isError === true && /still missing/.test(early.text) && /name/.test(early.text) && (await intake.getIntake(id)).status === "answering", early.text);
  const a1 = keep(await call("answer_tool_request", { id, answers: {
    name: "Rework board", purpose: "The lead logs a part that failed inspection and the bench tech picks it up. " + "Detail. ".repeat(60), who: { floor: "12", "Leads or supervisors": "2" },
    devices: { floor: ["A tablet"], office: ["desk"] }, thing: "rework ticket", today: { picks: ["A whiteboard", "a notebook at the bench"] }, stages: "1. Found\n2. At the bench\n3. Fixed\n4. Back on the line",
    wrong: ["Parts sit at the bench for days", "Nobody knows who has it"], never: "A part goes back on the line before it is checked.", numbers: { picks: ["how_long", "how_many"], note: "days at the bench" },
    works_with: { picks: ["erp", "scanners"], names: { erp: "Epicor" } }, favourite_colour: "blue" } }));
  const notSaved = (a1.data && a1.data.not_saved) || [];
  t("answer_tool_request: every answer that fits is saved in one call", !a1.r.isError && ["name", "purpose", "who", "thing", "today", "stages", "wrong", "never", "numbers", "works_with"].every((k) => a1.data.saved.includes(k)), a1.text.slice(0, 500));
  t("one that does not fit is reported with why, and does not lose the rest; a question that is not there is named", notSaved.length === 2 && /not a group in the "who" answer/.test(notSaved.find((x) => x.question === "devices").why) && /no question by that id/.test(notSaved.find((x) => x.question === "favourite_colour").why) && a1.data.request.missing.join() === "devices", notSaved);
  const row1 = await intake.getIntake(id);
  t("what is kept is in the shapes the board's own page writes", row1.name === "Rework board" && row1.slug === "rework-board" && JSON.stringify(row1.answers.who) === JSON.stringify({ floor: "12", leads: "2" }) && row1.answers.today.picks.join() === "whiteboard" && row1.answers.today.other === "a notebook at the bench"
    && row1.answers.stages.join("|") === "Found|At the bench|Fixed|Back on the line" && row1.answers.works_with.names.erp === "Epicor" && row1.answers.devices === undefined, row1.answers);
  t("the board's tile carries the tool's name", (await board(sharedMgr)).feedback.find((f) => f.intake_id === id).message === "New tool: Rework board");
  const rec = (await q("SELECT actor_role, actor_name, detail FROM platform.record WHERE intake_id=$1 AND kind='intake_answered' ORDER BY id", [id])).rows;
  t("every answer is on the record under the account's name, as Anetix through the app", rec.length === 10 && rec.every((r) => r.actor_role === "admin" && r.actor_name === "Brendan MCP (Anetix, through Claude writer)"), rec.slice(0, 2));
  const taken = await call("answer_tool_request", { id, answers: { name: "Paper Airplane Line" } });
  t("a name another tool of the company has is refused in the intake's own words, and the name stays", taken.data.not_saved.length === 1 && /already the name of a tool here/.test(taken.data.not_saved[0].why) && (await intake.getIntake(id)).name === "Rework board", taken.text.slice(0, 300));
  const a2 = await call("answer_tool_request", { id, answers: { devices: { floor: ["tablet"], leads: ["phone", "desk"] } } });
  t("the missing one answered: nothing is missing and the next step is to send", a2.data.saved.join() === "devices" && a2.data.request.missing.length === 0 && /send_tool_request/.test(a2.data.request.next), a2.data && a2.data.request.next);
  t("the company's manager reads the same answers on the board's own page", (await sharedMgr.get(`/api/intakes/${id}`)).json.answers.thing === "rework ticket");

  // ---- send, the agent's follow-up round, the design
  const sent = keep(await call("send_tool_request", { id }));
  t("send_tool_request: the round goes to the agent", !sent.r.isError && sent.data.sent === true && ["thinking", "answering"].includes(sent.data.request.status), sent.text.slice(0, 300));
  const r2 = await waitFor("the agent's follow-up round", async () => { const x = await call("get_tool_request", { id }); return x.data.status === "answering" && x.data.round === 2 ? keep(x) : null; });
  const q2 = r2.data.questions.filter((x) => x.round === 2);
  t("get_tool_request: the agent's own questions, with their choices and what is missing", q2.length === 3 && q2[0].options.length === 3 && /One pick/.test(q2[0].takes) && r2.data.missing.join() === "r2q1,r2q2,r2q3" && r2.data.questions.find((x) => x.id === "name").answer === "Rework board", q2);
  const a3 = await call("answer_tool_request", { id, answers: { r2q1: "Only leads and managers", r2q2: { picks: ["o1", "What is at each stage"] }, r2q3: "Fixed and checked. It stays in view for a day." } });
  t("the follow-up round is answered the same way, a choice by the words on it", a3.data.saved.length === 3 && a3.data.request.missing.length === 0 && (await intake.getIntake(id)).answers.r2q1.picks.join() === "o2", a3.text.slice(0, 300));
  await call("send_tool_request", { id });
  const d1 = await waitFor("the design", async () => { const x = await call("get_tool_request", { id }); return x.data.status === "design" ? keep(x) : null; });
  t("the design comes back as points, a reference and the next step: the manager confirms on the board", d1.data.design.points.length === 5 && d1.data.design.points[0].id === "p1" && /Rework board/.test(d1.data.design.reference) && /confirms on the board/.test(d1.data.next) && d1.data.next.includes(`${BASE}/c/demo/`), d1.data.design && d1.data.design.points);
  const closed = await call("answer_tool_request", { id, answers: { thing: "something else" } });
  t("once the design is written the answers are closed", closed.r.isError === true && /not taking answers/.test(closed.text) && (await intake.getIntake(id)).answers.thing === "rework ticket");

  // ---- changes to the design, through the agent
  const lost = await call("change_tool_request_design", { id, changes: [{ point: "p99", text: "x" }] });
  t("a point the design does not have is refused", lost.r.isError === true && /no point p99/.test(lost.text));
  const ch = await call("change_tool_request_design", { id, changes: [{ point: "p3", text: "Only a lead may send a part back to the line." }, { text: "Show how many days each ticket has sat." }] });
  t("change_tool_request_design: the changes go to the agent", !ch.r.isError && ch.data.asked === 2, ch.text.slice(0, 300));
  const d2 = await waitFor("the changed design", async () => { const x = await call("get_tool_request", { id }); return x.data.status === "design" && !x.data.design.change_in_progress && x.data.design.points.length === 6 ? x : null; });
  const pts = d2.data.design.points;
  t("the named point changed, the new one was added, every other point is word for word", pts.find((x) => x.id === "p3").mark === "changed" && pts.find((x) => x.mark === "new").summary === "Show how many days each ticket has sat."
    && ["p1", "p2", "p4", "p5"].every((k) => pts.find((x) => x.id === k).summary === d1.data.design.points.find((x) => x.id === k).summary && !pts.find((x) => x.id === k).mark), pts);
  t("the change is on the record under the same name", (await q("SELECT actor_name FROM platform.record WHERE intake_id=$1 AND kind='intake_revised'", [id])).rows[0].actor_name === "Brendan MCP (Anetix, through Claude writer)"
    && (await q("SELECT count(*)::int AS n FROM platform.record WHERE intake_id=$1 AND kind='intake_sent'", [id])).rows[0].n === 2);

  // ---- what an app cannot do: confirm, build, withdraw
  let none = 0;
  for (const name of ["confirm_tool_request", "build_tool_request", "withdraw_tool_request", "abandon_tool_request", "deploy", "make_it_live"]) { try { const r = await c.callTool({ name, arguments: { id } }); if (r.isError) none++; } catch (e) { none++; } }
  const still = await intake.getIntake(id);
  t("no tool confirms, builds or withdraws: the request waits at its design, with no build and no tool", none === 6 && still.status === "design" && !still.run_ids && (await q("SELECT count(*)::int AS n FROM platform.modules WHERE company='demo' AND name='rework-board'")).rows[0].n === 0);

  // ---- a request the company's manager started is the manager's
  t("(setup: a second company)", (await admin.post("/api/admin/companies", { slug: "acme", name: "Acme Machining" })).status === 200);
  const theirs = await intake.create("acme", "manager");
  await intake.answer(theirs.id, "name", "Tool crib");
  await intake.answer(theirs.id, "thing", "ZZ-THEIR-OWN-WORDS gauge");
  const l1 = keep(await call("list_tool_requests", { company: "acme" }));
  t("list_tool_requests: a trial's own request is listed, as started on the board and not writable here", l1.data.requests.length === 1 && l1.data.requests[0].id === theirs.id && l1.data.requests[0].name === "Tool crib" && l1.data.requests[0].writable_here === false && /on the board/.test(l1.data.requests[0].started), l1.data);
  const g1 = await call("get_tool_request", { id: theirs.id });
  t("a trial's own request is read (the words get_demo carries)", g1.data.questions.find((x) => x.id === "thing").answer === "ZZ-THEIR-OWN-WORDS gauge" && g1.data.writable_here === false);
  const w1 = await call("answer_tool_request", { id: theirs.id, answers: { thing: "overwritten" } });
  const w2 = await call("send_tool_request", { id: theirs.id });
  t("but never written to or sent from here", w1.r.isError === true && /started on the board/.test(w1.text) && w2.r.isError === true && (await intake.getIntake(theirs.id)).answers.thing === "ZZ-THEIR-OWN-WORDS gauge" && (await intake.getIntake(theirs.id)).status === "answering", [w1.text, w2.text]);
  const s2 = await call("start_tool_request", { company: "acme" });
  t("starting one for that company is refused, naming the manager's unfinished one and the way on", s2.r.isError === true && /Tool crib/.test(s2.text) && /use_open/.test(s2.text) && /Nothing was changed/.test(s2.text) && (await q("SELECT count(*)::int AS n FROM platform.module_intakes WHERE company='acme'")).rows[0].n === 1, s2.text);

  // ---- a paying site that did not opt in to learning keeps its own request to itself
  await q("INSERT INTO platform.sites (id, company, stage) VALUES (gen_random_uuid(), 'acme', 'subscribed') ON CONFLICT (company) DO UPDATE SET stage='subscribed'");
  const l2 = keep(await call("list_tool_requests", { company: "acme" }));
  const g2 = keep(await call("get_tool_request", { id: theirs.id }));
  t("a paying site's own request: how far it got, and nothing it said", l2.data.requests[0].name === null && l2.data.requests[0].status === "answering" && g2.data.status === "answering" && g2.data.questions === undefined && !/Tool crib|ZZ-THEIR-OWN-WORDS/.test(l2.text + g2.text), g2.text);
  const s3 = await call("start_tool_request", { company: "acme", use_open: true });
  t("and it cannot be taken over, even when asked", s3.r.isError === true && /paying site's own request/.test(s3.text) && (await intake.getIntake(theirs.id)).via === null, s3.text);
  await q("UPDATE platform.sites SET stage='demo' WHERE company='acme'");
  const s4 = keep(await call("start_tool_request", { company: "acme", use_open: true }));
  t("a trial's unfinished request is taken over when the person asks: the same request, now writable, and on the record", !s4.r.isError && s4.data.took_over === true && s4.data.request.id === theirs.id && s4.data.request.writable_here === true
    && (await q("SELECT actor_name FROM platform.record WHERE intake_id=$1 AND kind='intake_taken_over'", [theirs.id])).rows.length === 1, s4.text.slice(0, 300));
  const w3 = await call("answer_tool_request", { id: theirs.id, answers: { thing: "gauge" } });
  t("and then it is written to", w3.data.saved.join() === "thing" && (await intake.getIntake(theirs.id)).answers.thing === "gauge");
  await q("UPDATE platform.sites SET stage='subscribed' WHERE company='acme'");
  const g3 = await call("get_tool_request", { id: theirs.id });
  t("a request Anetix started or took over is read in full whatever the company is", g3.data.questions.find((x) => x.id === "thing").answer === "gauge" && g3.data.writable_here === true);
  await q("DELETE FROM platform.sites WHERE company='acme'");

  // ---- the pace: an app in a loop stops
  await q(`INSERT INTO platform.mcp_calls (account_id, surface, tool, ok, at) SELECT $1, 'admin', 'send_tool_request', true, now() - interval '5 minutes' FROM generate_series(1, 30)`, [adminId]);
  const paced = await call("change_tool_request_design", { id, changes: [{ text: "One more thing." }] });
  t("past thirty sends to the agent in an hour the next is refused, and nothing is sent", paced.r.isError === true && /in the last hour/.test(paced.text) && (await intake.getIntake(id)).status === "design", paced.text);
  await q("DELETE FROM platform.mcp_calls WHERE grant_id IS NULL AND tool='send_tool_request'");

  // ---- what never leaves, still
  const everything = texts.join("\n");
  t("no answer of these tools carries a record from a company's tool or a secret", !everything.includes(MARKER) && !/password_hash|anx_(at|rt|ac)_|secret_enc/.test(everything));
  t("no words of these tools carry an em or en dash", !/[\u2013\u2014]/.test(everything + ro_words(await c.listTools())));

  // ---- the manager's part is still the manager's: confirm on the board starts the build
  const conf = await sharedMgr.post(`/api/intakes/${id}/confirm`, {});
  t("the manager confirms on the board, and only then is anything built", conf.status === 200 && ["confirmed", "building", "done"].includes(conf.json.status), conf.text.slice(0, 300));
  const after = await call("get_tool_request", { id });
  t("and the app sees it move on, with nothing left for it to do", ["confirmed", "building", "done"].includes(after.data.status) && /on the board|Built/.test(after.data.next), after.data.next);
  await c.close();
}
const ro_words = (listed) => listed.tools.map((x) => `${x.title} ${x.description}`).join("\n");

(process.argv[2] === "off" ? off() : main()).then(() => pool.end()).then(() => R.done()).catch((e) => R.abort(e));
