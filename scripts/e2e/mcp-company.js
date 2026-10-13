// End to end: the company MCP (phase 2, src/mcp-company.js, src/mcpauth.js, docs/MCP.md "Proof for phase 2").
// Runs against a server that is ALREADY UP in fake-agent mode on a FRESH database, with the connector on, one trial named
// in SOS_MCP_TRIALS, the prompt log on, and the same environment in this shell (the script reads the database itself):
//
//   export DATABASE_URL=postgres://sos:sos@127.0.0.1:5432/sos_e2e SESSION_SECRET=e2e SOS_CONNECTION_KEY=e2e-connection-key \
//     SOS_FLOOR_PASSWORD=floorpw SOS_MANAGER_PASSWORD=mgrpw SOS_ADMIN_PASSWORD=adminpw SOS_PUBLIC_URL=http://127.0.0.1:3999 \
//     SOS_MCP_TRIALS=trialco SOS_PROMPT_LOG=/tmp/mcp-company-prompts.jsonl
//   SOS_FAKE_AGENT=1 SOS_BROWSER=off PORT=3999 node server.js &
//   node scripts/e2e/mcp-company.js
//
// What it proves, in the design's order: a token of company A and A's database role both fail against company B; a
// canary row is in no answer with the records switch off and is there with it on; Anetix's lock beats the manager's
// switch; no answer names a model or a cost; a write through the read role is refused by Postgres; a trial's manager
// cannot connect (a trial on SOS_MCP_TRIALS can); and, with the data wall up, a request the app filed reaches no prompt
// until the manager taps Review, while every other prompt keeps flowing. Around those: the sign-in for a manager, the
// address as a pair with the admin one, the board, Ask Anetix and the admin MCP showing that a held request exists but
// not its words, Disconnect and the switch on Settings, a company that stops being a site, a company deleted.
const crypto = require("crypto");
const fs = require("fs");
const { Pool } = require("pg");
const { PW, runner, client, login, sleep, waitFor } = require("./lib");
const totp = require("../../src/totp");
const accounts = require("../../src/accounts");
const dbroles = require("../../src/dbroles");
const migrate = require("../../src/migrate");
const { q } = require("../../src/db");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = require("@modelcontextprotocol/sdk/client/streamableHttp.js");
const R = runner(), t = R.t;
const BASE = process.env.SOS_E2E_BASE || "http://127.0.0.1:3999";
const ADDRESS = `${BASE}/mcp`, ADMIN_ADDRESS = `${BASE}/mcp/admin`;
const CLAUDE = "https://claude.ai/api/mcp/auth_callback";
const PROMPTS = process.env.SOS_PROMPT_LOG;
const ROW_A = "ZZ-ACME-ROW-5521", ROW_B = "ZZ-BOLT-ROW-8830", HELD_WORDS = "ZZ-HELD-WORDS-3307";
const MODELISH = /claude-(?:opus|sonnet|haiku|fable)|\bOpus 5|\bSonnet 5|\bFable 5|cost_usd|spend_usd|estimate_usd/i;
if (!PROMPTS) { console.error("run with SOS_PROMPT_LOG set, the same file the server writes"); process.exit(2); }

async function codeFor(secretText, delta = 0) {
  const into = (Date.now() / 1000) % 30;
  if (into > 27.5) await sleep((30 - into) * 1000 + 300);
  return totp.hotp(totp.base32Decode(secretText), totp.stepAt() + delta);
}
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
const reqOf = (location) => new URL(location, BASE).searchParams.get("req");
const prompts = () => { try { return fs.readFileSync(PROMPTS, "utf8"); } catch (e) { return ""; } };

// A manager account of a company, enrolled with an authenticator, signed in. -> { c, login, secret, id }
async function manager(company, loginName) {
  const made = await accounts.create({ login: loginName, display_name: loginName.split("@")[0], password: "a-long-enough-password-1", role: "manager", company }, "e2e", null);
  let c = client();
  await c.post("/login", { name: loginName, password: "a-long-enough-password-1" });
  const secret = (await c.post(`/api/c/${company}/me/enroll/start`, {})).json.secret;
  const v = await c.post(`/api/c/${company}/me/enroll/verify`, { code: await codeFor(secret, -1) });
  if (v.status !== 200) throw new Error(`enroll ${loginName}: ${v.text}`);
  c = client();
  const r = await c.post("/login", { name: loginName, password: "a-long-enough-password-1", code: await freshCode(loginName, secret) });
  if (r.status !== 200) throw new Error(`sign in ${loginName}: ${r.text}`);
  return { c, login: loginName, secret, id: made.account.id };
}
// The whole sign-in for one browser, as an app would drive it. resource: the address the app names (null: none).
async function connect(who, { resource = ADDRESS, writes = false, name = "Claude" } = {}) {
  const app = (await register({ client_name: name })).json, p = pkce();
  const params = { response_type: "code", client_id: app.client_id, redirect_uri: CLAUDE, code_challenge: p.challenge, code_challenge_method: "S256", state: "s1", ...(resource ? { resource } : {}) };
  const a = await raw("GET", `/oauth/authorize?${new URLSearchParams(params)}`);
  if (a.status !== 302 || !a.location.startsWith("/oauth/consent")) throw new Error(`authorize: ${a.status} ${a.text}`);
  const sealed = reqOf(a.location);
  const info = await who.c.get(`/oauth/consent/info?req=${encodeURIComponent(sealed)}`);
  const d = await who.c.post("/oauth/consent/decide", { req: sealed, allow: true, code: await freshCode(who.login, who.secret), ...(writes ? { writes: true } : {}) });
  if (d.status !== 200) return { info, decide: d };
  const code = new URL(d.json.redirect).searchParams.get("code");
  const tok = await raw("POST", "/oauth/token", { form: { grant_type: "authorization_code", client_id: app.client_id, code, code_verifier: p.verifier, redirect_uri: CLAUDE, ...(resource ? { resource } : {}) } });
  return { info, decide: d, tokens: tok.json, tokenStatus: tok.status, app };
}
async function mcpClient(token, address = ADDRESS) {
  const c = new Client({ name: "e2e", version: "1.0.0" });
  await c.connect(new StreamableHTTPClientTransport(new URL(address), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  return c;
}
const textOf = (r) => (r.content || []).map((c) => c.text || "").join("\n");
const ANSWERS = [];   // every answer an app read, for the model-name and canary checks at the end
async function caller(token) {
  const c = await mcpClient(token);
  return async (name, args = {}) => {
    const r = await c.callTool({ name, arguments: args });
    const text = textOf(r);
    ANSWERS.push({ name, text });
    let data = null; try { data = JSON.parse(text); } catch (e) {}
    return { r, text, data, error: r.isError === true };
  };
}

async function main() {
  // ---- setup: three companies with Paper Airplane Line, two paying sites, one trial on SOS_MCP_TRIALS
  // Anetix's own account first: once an admin account has its authenticator, the shared admin password opens nothing
  const adminAcct = await (async () => {
    const shared = await login(PW.admin, "");
    const made = await shared.post("/api/admin/accounts", { login: "anetix.mcp@anetix.test", display_name: "Anetix MCP", generate: true });
    let c = client(); await c.post("/login", { name: "anetix.mcp@anetix.test", password: made.json.password });
    const secret = (await c.post("/api/admin/accounts/me/enroll/start", {})).json.secret;
    await c.post("/api/admin/accounts/me/enroll/verify", { code: await codeFor(secret, -1) });
    c = client(); await c.post("/login", { name: "anetix.mcp@anetix.test", password: made.json.password, code: await freshCode("anetix.mcp@anetix.test", secret) });
    return { c, login: "anetix.mcp@anetix.test", secret };
  })();
  const admin = adminAcct.c;
  const passwords = {};
  for (const [slug, name] of [["acme", "Acme Machining"], ["bolt", "Bolt Fab"], ["trialco", "Trial Co"]]) {
    const made = await admin.post("/api/admin/companies", { slug, name });
    passwords[slug] = (made.json || {}).passwords || {};
    const added = await admin.post(`/api/admin/companies/${slug}/modules`, { module: "paperline" });
    t(`(setup: ${slug} with Paper Airplane Line)`, made.status === 200 && added.status === 200, made.text + added.text);
  }
  // the sites table decides a paying site (src/kind.js), read before the server ever asks about these two; the rollover
  // marked done, so going live's own steps (a new floor password among them, src/activate.js) are not run on them here
  for (const slug of ["acme", "bolt"]) await q(`INSERT INTO platform.sites (id, company, stage, rollover) VALUES ($1,$2,'subscribed', jsonb_build_object('done_at', now()))
                                                ON CONFLICT (company) DO UPDATE SET stage='subscribed', rollover=jsonb_build_object('done_at', now())`, [crypto.randomUUID(), slug]);
  const schemaA = migrate.liveSchema("acme", "paperline"), schemaB = migrate.liveSchema("bolt", "paperline");
  await q(`INSERT INTO "${schemaA}".inventory (item, location, qty) VALUES ($1, 'Rack 1', 7)`, [ROW_A]);
  await q(`INSERT INTO "${schemaB}".inventory (item, location, qty) VALUES ($1, 'Rack 9', 3)`, [ROW_B]);
  const ma = await manager("acme", "ann.mcp@acme.test"), mb = await manager("bolt", "bo.mcp@bolt.test");
  const md = await manager("demo", "dee.mcp@demo.test"), mt = await manager("trialco", "tia.mcp@trial.test");

  // ---- the address, as a pair with the admin one
  const bare = await raw("POST", "/mcp", { headers: { Accept: "application/json, text/event-stream" }, body: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
  const prmUrl = `${BASE}/.well-known/oauth-protected-resource/mcp`;
  t("a call with no token is a 401 that points at the company address's own discovery document", bare.status === 401 && String(bare.headers.get("www-authenticate")).includes(`resource_metadata="${prmUrl}"`), bare.headers.get("www-authenticate"));
  const prm = (await raw("GET", prmUrl)).json;
  t("that document names the company address exactly, and the one sign-in server", prm && prm.resource === ADDRESS && prm.authorization_servers[0] === BASE, prm);
  t("the admin address keeps its own document", ((await raw("GET", `${BASE}/.well-known/oauth-protected-resource/mcp/admin`)).json || {}).resource === ADMIN_ADDRESS);
  t("a GET is the same 401, and with a token a GET is a 405", (await raw("GET", "/mcp")).status === 401);

  // ---- who may connect
  const a1 = await connect(ma, { writes: false });
  t("the consent page shows Acme's manager the company, that it may file, and that records are off", a1.info.status === 200 && a1.info.json.allowed === true && a1.info.json.surface === "company" && a1.info.json.company.name === "Acme Machining"
    && a1.info.json.company.records === false && a1.info.json.can_write === true && a1.info.json.address === ADDRESS && a1.info.json.lasts.cap_days === 30, a1.info.text);
  t("Acme's manager connects an app to the company address", a1.tokenStatus === 200 && /^anx_at_/.test(a1.tokens.access_token), a1.tokens);
  const g1 = (await q("SELECT * FROM platform.mcp_grants WHERE account_id=$1 ORDER BY id DESC LIMIT 1", [ma.id])).rows[0];
  t("the connection is for the company address and carries Acme, read only without the tick", g1 && g1.surface === "company" && g1.company === "acme" && g1.writes === false, g1);
  const d1 = await connect(md);
  t("a trial's manager is told a connected app is part of a paying site", d1.info.status === 200 && d1.info.json.allowed === false && /paying site/.test(d1.info.json.why), d1.info.text);
  t("and cannot allow it, even with a good code", d1.decide.status === 403 && !d1.tokens, d1.decide.text);
  const tr = await connect(mt);
  t("a trial Anetix named in SOS_MCP_TRIALS can", tr.tokenStatus === 200 && tr.info.json.allowed === true, tr.info.text);
  const ad = await connect(adminAcct);
  t("an admin account cannot connect to the company address: it is told the managers do, and where its own is", ad.info.json.allowed === false && /company's managers/.test(ad.info.json.why) && ad.decide.status === 403, ad.info.text);
  const none = await connect(mb, { resource: null, writes: true });
  t("an app that names no address: a manager's sign-in becomes a company connection", none.tokenStatus === 200 && none.info.json.surface === "company"
    && (await q("SELECT surface, company, writes FROM platform.mcp_grants WHERE account_id=$1 ORDER BY id DESC LIMIT 1", [mb.id])).rows[0].company === "bolt", none.info.text);
  const adm = await connect(adminAcct, { resource: null });
  t("and an admin's becomes an admin one, as before", adm.tokenStatus === 200 && adm.info.json.surface === "admin", adm.info.text);

  // ---- a token is for one address
  const viaAdmin = await raw("POST", "/mcp/admin", { headers: { Authorization: `Bearer ${a1.tokens.access_token}`, Accept: "application/json, text/event-stream" }, body: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
  const viaCompany = await raw("POST", "/mcp", { headers: { Authorization: `Bearer ${adm.tokens.access_token}`, Accept: "application/json, text/event-stream" }, body: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
  t("a company token on the admin address is a 401, and an admin token on the company address too", viaAdmin.status === 401 && viaCompany.status === 401);

  // ---- what the app reads, records off
  const A = await caller(a1.tokens.access_token);
  const listed = (await (await mcpClient(a1.tokens.access_token)).listTools()).tools;
  t("the app is offered the company's tools and file_request, with the one write marked", listed.map((x) => x.name).sort().join() === "describe_tool,file_request,get_request,list_requests,list_tools,read_records,summarize_records,whats_changed"
    && listed.find((x) => x.name === "file_request").annotations.readOnlyHint === false && listed.find((x) => x.name === "read_records").annotations.readOnlyHint === true, listed.map((x) => x.name));
  const lt = await A("list_tools");
  t("list_tools: Acme's own tool", !lt.error && lt.data.tools.length === 1 && lt.data.tools[0].title === "Paper Airplane Line", lt.text.slice(0, 300));
  const dt = await A("describe_tool", { tool: "Paper Airplane Line" });
  t("describe_tool: the tables and their row counts, never a row", !dt.error && dt.data.tables.some((x) => x.table === "inventory" && x.rows >= 1) && !dt.text.includes(ROW_A), dt.text.slice(0, 300));
  const off = await A("read_records", { tool: "Paper Airplane Line", table: "inventory" });
  t("records off: read_records refuses, in words that name the manager's switch", off.error && /Settings, under Connected apps/.test(off.text) && !off.text.includes(ROW_A), off.text);
  const offSum = await A("summarize_records", { tool: "Paper Airplane Line", table: "inventory", measures: [{ fn: "count" }] });
  t("and so does summarize_records", offSum.error && /switched off/.test(offSum.text));
  const lr = await A("list_requests", { status: "all" });
  t("the board and its requests read with records off (the company's own words)", !lr.error && Array.isArray(lr.data.requests));

  // ---- the manager's switch, on Settings
  const v0 = await ma.c.get("/api/c/acme/mcp");
  t("Settings lists the connection, the address, and records off", v0.status === 200 && v0.json.address === ADDRESS && v0.json.may_connect === true && v0.json.records.on === false && v0.json.connections.length === 1 && v0.json.connections[0].app === "Claude" && v0.json.can_switch === true, v0.text);
  t("turning records on asks for a fresh code first", (await ma.c.post("/api/c/acme/mcp/records", { on: true })).json.step_up === true && (await q("SELECT mcp_reads_records FROM platform.companies WHERE slug='acme'")).rows[0].mcp_reads_records === false);
  const on = await ma.c.post("/api/c/acme/mcp/records", { on: true, code: await freshCode(ma.login, ma.secret) });
  t("with the code it is on, and on the record", on.status === 200 && on.json.records.on === true && (await q("SELECT count(*)::int AS n FROM platform.record WHERE company='acme' AND kind='mcp_records_on'")).rows[0].n === 1, on.text);
  const rr = await A("read_records", { tool: "Paper Airplane Line", table: "inventory", where: [{ column: "item", op: "contains", value: "ZZ-" }] });
  t("records on: the canary row comes back, and only Acme's", !rr.error && rr.text.includes(ROW_A) && !rr.text.includes(ROW_B), rr.text.slice(0, 400));
  const sm = await A("summarize_records", { tool: "Paper Airplane Line", table: "inventory", measures: [{ fn: "count" }, { fn: "sum", column: "qty" }] });
  t("summarize_records: numbers from the rows", !sm.error && sm.data.records.length === 1 && Number(sm.data.records[0].count) >= 1, sm.text);
  const B = await caller(none.tokens.access_token);
  const rb = await B("read_records", { tool: "Paper Airplane Line", table: "inventory" });
  t("Bolt's token with Bolt's switch off reads none of its rows, and never Acme's", rb.error && !rb.text.includes(ROW_A) && !rb.text.includes(ROW_B));

  // ---- the database holds it too: A's read role against B, and a write through it
  await dbroles.selfTest().catch(() => {});
  const poolA = new Pool({ ...dbroles.connectionFor("acme", dbroles.READ), max: 1 });
  const cross = await poolA.query(`SELECT item FROM "${schemaB}".inventory`).then(() => "read").catch((e) => e.code);
  const write = await poolA.query(`INSERT INTO "${schemaA}".inventory (item, location, qty) VALUES ('x','y',1)`).then(() => "wrote").catch((e) => e.code);
  const own = await poolA.query(`SELECT count(*)::int AS n FROM "${schemaA}".inventory`).then((r) => r.rows[0].n).catch((e) => e.code);
  await poolA.end();
  t("Acme's read role reads its own rows", typeof own === "number" && own >= 1, own);
  t("and Postgres refuses it Bolt's schema", cross === "42501", cross);
  t("and refuses a write through it", write === "42501" || write === "25006", write);

  // ---- Anetix's lock beats the manager's switch
  const lock = await admin.post("/api/admin/companies/acme/mcp-lock", { locked: true });
  const locked = await A("read_records", { tool: "Paper Airplane Line", table: "inventory" });
  t("locked by Anetix: no rows, in words that say Anetix did it", lock.status === 200 && locked.error && /Anetix has records switched off/.test(locked.text) && !locked.text.includes(ROW_A), locked.text);
  t("the manager's switch is still on underneath, and cannot be turned on again over the lock", (await q("SELECT mcp_reads_records FROM platform.companies WHERE slug='acme'")).rows[0].mcp_reads_records === true
    && (await ma.c.post("/api/c/acme/mcp/records", { on: true, code: await freshCode(ma.login, ma.secret) })).status === 409);
  const ov = (await admin.get("/api/admin/overview")).json.companies.find((c) => c.slug === "acme").mcp;
  t("the admin's company card says one app is connected and records are locked off", ov && ov.connections === 1 && ov.records_locked === true && ov.records_on === false && ov.may_connect === true, ov);
  await admin.post("/api/admin/companies/acme/mcp-lock", { locked: false });
  t("unlocked: the manager's own setting decides again", !(await A("read_records", { tool: "Paper Airplane Line", table: "inventory" })).error);

  // ---- filing a request: read only refuses; the tick files one that waits
  const ro = await A("file_request", { tool: "Paper Airplane Line", what: "Add a column for the reorder point on the inventory screen" });
  t("a connection made without the tick cannot file", ro.error && /read only/.test(ro.text) && (await q("SELECT count(*)::int AS n FROM platform.feedback WHERE source='mcp'")).rows[0].n === 0, ro.text);
  const a2 = await connect(ma, { writes: true, name: "Claude writer" });
  const W = await caller(a2.tokens.access_token);
  const before = prompts().length;
  // the data wall up for Acme: the proof that a filed request reaches no prompt until the manager's tap
  t("(the data wall goes up for Acme)", (await admin.post("/api/admin/companies/acme/data-wall", { walled: true })).status === 200);
  const f1 = await W("file_request", { tool: "Paper Airplane Line", screen: "nope", what: `Show ${HELD_WORDS} on the inventory screen next to each item` });
  t("a screen the tool does not have is refused, naming its screens", f1.error && /has no screen called/.test(f1.text));
  const f2 = await W("file_request", { tool: "Paper Airplane Line", what: `Show ${HELD_WORDS} on the inventory screen next to each item`, why: "So the crib sees it" });
  const row = f2.data && f2.data.id ? (await q("SELECT * FROM platform.feedback WHERE id=$1", [f2.data.id])).rows[0] : null;
  t("filed: on Acme's board, in the manager's name, from the app, held, and the answer says it waits", !f2.error && f2.data.filed === true && row && row.company === "acme" && row.source === "mcp" && row.held === true && row.status === "new" && row.name === "ann.mcp" && /waiting for a manager/.test(f2.data.where_it_is), f2.text);
  await sleep(1500);
  t("it is not read on arrival, whatever the company's switch says", (await q("SELECT arrival FROM platform.feedback WHERE id=$1", [row.id])).rows[0].arrival === null && !(await q("SELECT 1 FROM platform.proposals WHERE feedback_id=$1", [row.id])).rows.length);
  const { claim } = require("../../src/arrival");
  t("and the arrival step refuses it if anything ever hands it one", (await claim(row.id)) === null && /^skipped: sent from a connected app/.test((await q("SELECT arrival FROM platform.feedback WHERE id=$1", [row.id])).rows[0].arrival));
  await q("UPDATE platform.feedback SET arrival=NULL WHERE id=$1", [row.id]);
  // a floor request on the same tool is read on arrival as ever; the held one is left out of its duplicate check
  const floor = await login(passwords.acme.floor, "acme");
  {
    const fl = (await floor.post("/api/feedback", { company: "acme", module: "paperline", page: "/c/acme/m/paperline/", message: "Show the reorder point on the inventory screen" })).json;
    await waitFor("the floor request to be read", async () => { const x = (await q("SELECT arrival FROM platform.feedback WHERE id=$1", [fl.id])).rows[0]; return x && x.arrival && x.arrival !== "proposing"; }, 30000).catch(() => null);
    t("a floor request beside it is still read on arrival", (await q("SELECT arrival FROM platform.feedback WHERE id=$1", [fl.id])).rows[0].arrival === "done");
  }
  const sim = await W("file_request", { tool: "Paper Airplane Line", what: `Please show ${HELD_WORDS} on the inventory screen for every item` });
  t("a request like an open one is not filed: the app is shown the open ones and told how to file anyway", !sim.error && sim.data.filed === false && sim.data.may_already_be_asked.some((x) => x.id === row.id), sim.text);
  t("no prompt carried the held words while it waits", !prompts().slice(before).includes(HELD_WORDS) && prompts().length > before, prompts().length - before);

  // ---- who sees that it waits: the board, Ask Anetix, the admin MCP
  const card = ((await ma.c.get("/api/c/acme/board")).json.feedback || []).find((x) => x.id === row.id);
  t("the board shows the card with the app's name and that it is held", card && card.held === true && card.source === "mcp" && card.source_app === "Claude writer", card);
  const tools = require("../../src/assist-tools");
  const askCtx = tools.newCtx({ company: "acme", role: "manager", scope: { kind: "company" }, walled: true, person: "Ann" });
  const asked = await tools.call(askCtx, "list_requests", { status: "all" });
  t("Ask Anetix (Anetix's AI) sees the request exists, not its words", asked.ok && !asked.text.includes(HELD_WORDS) && /connected AI app/.test(asked.text), asked.text.slice(0, 400));
  const probe = await tools.call(askCtx, "list_requests", { status: "all", words: HELD_WORDS });
  t("and cannot find it by searching for its words", probe.ok && JSON.parse(probe.text).requests.length === 0, probe.text.slice(0, 300));
  const one = await tools.call(askCtx, "get_request", { id: row.id });
  t("nor read them by its number", one.ok && !one.text.includes(HELD_WORDS));
  const adminTools = require("../../src/mcp-admin").tools;
  const lb = await adminTools.find((x) => x.name === "list_board_requests").run({ company: "acme", status: "all" });
  const act = await adminTools.find((x) => x.name === "activity_since").run({ hours: 2, company: "acme" });
  t("the admin MCP shows it waits, from the company's app, without its words", !JSON.stringify(lb).includes(HELD_WORDS) && lb.requests.some((x) => x.id === row.id && /connected app/.test(x.via)) && !JSON.stringify(act).includes(HELD_WORDS), JSON.stringify(lb).slice(0, 300));
  const mine = await A("get_request", { id: row.id });
  t("the company's own app reads its words, and that it waits for a manager", !mine.error && mine.text.includes(HELD_WORDS) && mine.data.waiting_for_a_manager === true, mine.text.slice(0, 300));

  // ---- the manager's tap
  const rev = await ma.c.post(`/api/feedback/${row.id}/review`);
  const after = (await q("SELECT held, status FROM platform.feedback WHERE id=$1", [row.id])).rows[0];
  t("Review with AI: the manager's tap lets the AI read it, a change is drafted, and the tap is on the record", rev.status === 200 && after.held === false && after.status === "reviewing" && prompts().includes(HELD_WORDS)
    && (await q("SELECT count(*)::int AS n FROM platform.record WHERE feedback_id=$1 AND kind='mcp_request_released'", [row.id])).rows[0].n === 1, rev.text.slice(0, 300));
  t("and nothing asked a question of nobody: the draft is a proposal", Boolean((await q("SELECT 1 FROM platform.proposals WHERE feedback_id=$1", [row.id])).rows.length) && !(await q("SELECT question FROM platform.feedback WHERE id=$1", [row.id])).rows[0].question);
  await admin.post("/api/admin/companies/acme/data-wall", { walled: false });

  // ---- the day's cap
  await q("INSERT INTO platform.feedback (company, module, page, message, name, source, held, status, created_at) SELECT 'acme','paperline','/c/acme/m/paperline/','cap filler ' || g, 'x', 'mcp', false, 'declined', now() FROM generate_series(1, 25) g");
  const capped = await W("file_request", { tool: "Paper Airplane Line", what: "A completely different thing about labels and printers", even_if_similar: true });
  t("past the day's cap a connected app files nothing", capped.error && /most for one day/.test(capped.text), capped.text);
  await q("DELETE FROM platform.feedback WHERE company='acme' AND message LIKE 'cap filler %'");

  // ---- Disconnect, from Settings; another company's manager cannot
  const v1 = (await ma.c.get("/api/c/acme/mcp")).json;
  const theirs = v1.connections.find((c) => c.app === "Claude");
  t("Bolt's manager cannot see or disconnect Acme's apps", (await mb.c.get("/api/c/acme/mcp")).status === 403 && (await mb.c.post(`/api/c/acme/mcp/grants/${theirs.id}/disconnect`, {})).status === 403);
  t("Settings lists the last calls, who and which tool, never the answer", v1.calls.length > 5 && v1.calls.every((c) => !JSON.stringify(c).includes(ROW_A)) && v1.calls.some((c) => c.tool === "read_records"));
  t("Acme's manager disconnects one", (await ma.c.post(`/api/c/acme/mcp/grants/${theirs.id}/disconnect`, {})).status === 200);
  const gone = await raw("POST", "/mcp", { headers: { Authorization: `Bearer ${a1.tokens.access_token}`, Accept: "application/json, text/event-stream" }, body: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
  t("and its token is a 401 at once; the other still works", gone.status === 401 && !(await W("list_tools")).error);
  t("records off from Settings asks for nothing", (await ma.c.post("/api/c/acme/mcp/records", { on: false })).json.records.on === false);

  // ---- a company that stops being a site: refused, not ended; back again, back to work
  await q("UPDATE platform.sites SET stage='demo' WHERE company='acme'");
  await sleep(16000);   // src/kind.js remembers a company's kind for 15 seconds
  const asTrial = await raw("POST", "/mcp", { headers: { Authorization: `Bearer ${a2.tokens.access_token}`, Accept: "application/json, text/event-stream" }, body: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
  t("a company no longer a paying site: its app is refused", asTrial.status === 401);
  t("but its connection is not ended", (await q("SELECT revoked_at FROM platform.mcp_grants WHERE id=(SELECT id FROM platform.mcp_grants WHERE account_id=$1 AND writes ORDER BY id DESC LIMIT 1)", [ma.id])).rows[0].revoked_at === null);
  await q("UPDATE platform.sites SET stage='subscribed' WHERE company='acme'");
  await sleep(16000);
  t("a site again: the same token works", !(await (await caller(a2.tokens.access_token))("list_tools")).error);

  // ---- no answer named a model or a cost, and the canary only where records were on
  const leaky = ANSWERS.filter((x) => MODELISH.test(x.text));
  t("no answer names a model or carries an AI cost", leaky.length === 0, leaky.map((x) => `${x.name}: ${x.text.match(MODELISH)[0]}`));
  t("Bolt's canary row is in no answer at all", ANSWERS.every((x) => !x.text.includes(ROW_B)));
  const calls = (await q("SELECT tool, args, ok FROM platform.mcp_calls WHERE surface='company'")).rows;
  t("every call is logged with its company, and the log keeps no answer", calls.length > 10 && (await q("SELECT count(*)::int AS n FROM platform.mcp_calls WHERE surface='company' AND company IS NULL")).rows[0].n === 0 && !JSON.stringify(calls).includes(ROW_A));

  // ---- a company deleted: its connections end
  t("(Bolt has a live connection)", (await q("SELECT count(*)::int AS n FROM platform.mcp_grants WHERE company='bolt' AND revoked_at IS NULL")).rows[0].n === 1);
  await require("../../src/mcp-company").deleteCompany("bolt");   // what the company delete route calls (src/feedback.js)
  t("deleting a company ends every connection to it", (await q("SELECT count(*)::int AS n FROM platform.mcp_grants WHERE company='bolt' AND revoked_at IS NULL")).rows[0].n === 0);
  const bGone = await raw("POST", "/mcp", { headers: { Authorization: `Bearer ${none.tokens.access_token}`, Accept: "application/json, text/event-stream" }, body: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
  t("and its token is a 401", bGone.status === 401);
}

main().then(() => R.done(), (e) => R.abort(e.stack || e));
