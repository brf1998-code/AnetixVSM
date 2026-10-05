// Unit cases for the connector's pure parts (src/mcpauth.js, src/mcp.js, src/mcp-admin.js). No database, no network.
//   node scripts/test-mcp.js
const path = require("path");
let pass = 0, fail = 0;
function t(name, cond, detail) { if (cond) { pass++; } else { fail++; console.log(`FAIL  ${name}${detail !== undefined ? "\n      " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : ""}`); } }
process.env.SESSION_SECRET = "unit-secret";
function load(env) {
  for (const k of ["SOS_PUBLIC_URL", "SOS_MCP_REDIRECTS", "SOS_MCP_ACCESS_MIN"]) delete process.env[k];
  Object.assign(process.env, env || {});
  for (const f of ["mcpauth", "mcp", "mcp-admin"]) delete require.cache[path.resolve(__dirname, `../src/${f}.js`)];
  return require("../src/mcpauth");
}
const quiet = (fn) => { const w = console.warn, l = console.log; console.warn = console.log = () => {}; try { return fn(); } finally { console.warn = w; console.log = l; } };

// ---- the switch: the instance's own address
let m = load();
t("no SOS_PUBLIC_URL: off, and no address exists", m.enabled() === false && m.PUBLIC === null && m.resourceOf("admin") === null);
t("an https address with no path is taken, as its origin", m.publicUrl("https://app.anetix.ai") === "https://app.anetix.ai" && m.publicUrl("https://app.anetix.ai/") === "https://app.anetix.ai" && m.publicUrl(" https://APP.anetix.ai ") === "https://app.anetix.ai");
t("http is taken only for this computer", m.publicUrl("http://127.0.0.1:3999") === "http://127.0.0.1:3999" && m.publicUrl("http://localhost:3999") === "http://localhost:3999" && m.publicUrl("http://app.anetix.ai") === null);
t("a path, a query, a fragment, another scheme or junk is not an address", ["https://app.anetix.ai/x", "https://app.anetix.ai?x=1", "https://app.anetix.ai#x", "ftp://app.anetix.ai", "app.anetix.ai", "", null, undefined, "on", "1"].every((v) => m.publicUrl(v) === null));
m = load({ SOS_PUBLIC_URL: "https://app.anetix.ai" });
t("with it set: on, and the admin address is under it", m.enabled() && m.resourceOf("admin") === "https://app.anetix.ai/mcp/admin" && m.resourceOf("company") === null);
t("an address names its surface exactly: a trailing slash or a fragment is forgiven, nothing else", m.surfaceOf("https://app.anetix.ai/mcp/admin") === "admin" && m.surfaceOf("https://app.anetix.ai/mcp/admin/") === "admin" && m.surfaceOf("https://app.anetix.ai/mcp/admin#x") === "admin"
  && [null, "", "https://app.anetix.ai/mcp", "https://app.anetix.ai/mcp/admin/x", "https://evil.example/mcp/admin", "http://app.anetix.ai/mcp/admin", "https://app.anetix.ai/mcp/admin?x=1", "https://app.anetix.ai/MCP/ADMIN"].every((v) => m.surfaceOf(v) === null));

// ---- where an answer may be sent
const CLAUDE = "https://claude.ai/api/mcp/auth_callback";
t("by default: Claude's hosted callback, exactly", m.redirectAllowed(CLAUDE) && [CLAUDE + "/", CLAUDE + "?x=1", CLAUDE + "#x", "http://claude.ai/api/mcp/auth_callback", "https://claude.ai/api/mcp/auth_callback2", "https://claude.ai.evil.example/api/mcp/auth_callback",
  "https://evil.example/?https://claude.ai/api/mcp/auth_callback", "https://user:pw@claude.ai/api/mcp/auth_callback", "https://claude.ai/", "javascript:alert(1)", "", null].every((u) => !m.redirectAllowed(u)));
t("and an app on the person's own computer, on any port", ["http://localhost:3118/callback", "http://127.0.0.1:50999/callback", "http://localhost/callback", "http://[::1]:8080/cb"].every((u) => m.redirectAllowed(u) && m.isLoopback(u)));
t("this computer over https, a look-alike host or with a login in it is not that", ["https://localhost:3118/callback", "http://localhost.evil.example/callback", "http://127.0.0.1.evil.example/callback", "http://user@localhost:1/callback", "http://10.0.0.5:3118/callback"].every((u) => !m.redirectAllowed(u)));
t("SOS_MCP_REDIRECTS replaces the list", m.redirectAllowed("https://app.example.com/oauth/callback", ["https://app.example.com/oauth/callback"]) && !m.redirectAllowed(CLAUDE, ["https://app.example.com/oauth/callback"]) && !m.redirectAllowed("http://localhost:1/callback", [CLAUDE]));
t("an empty or blank setting is the default list, never an open one", m.redirectList("").join() === m.DEFAULT_REDIRECTS.join() && m.redirectList(" , ").join() === m.DEFAULT_REDIRECTS.join() && m.redirectList("loopback").join() === "loopback");

// ---- the request carried through the consent page
const now = 1790000000000, req = { c: "client-1", r: CLAUDE, s: "state", ch: "challenge", f: "admin" };
const sealed = m.sealRequest(req, now), opened = m.openRequest(sealed, now + 60e3);
t("a sealed request opens to what was sealed", opened && opened.c === "client-1" && opened.r === CLAUDE && opened.s === "state" && opened.ch === "challenge" && opened.f === "admin");
t("it is good for fifteen minutes and not a second more", m.openRequest(sealed, now + (m.CONSENT_S - 1) * 1000) !== null && m.openRequest(sealed, now + (m.CONSENT_S + 1) * 1000) === null);
const [body, mac] = sealed.split(".");
const forged = Buffer.from(JSON.stringify({ ...req, f: "company", exp: Math.floor(now / 1000) + 900 })).toString("base64url");
t("a changed body, a changed seal, a swapped body or junk does not open", [`${body.slice(0, -2)}AA.${mac}`, `${body}.${mac.slice(0, -2)}AA`, `${forged}.${mac}`, body, `.${mac}`, "", null, "a.b", "x".repeat(5000) + ".y"].every((v) => m.openRequest(v, now) === null));
const other = (() => { process.env.SESSION_SECRET = "another-secret"; for (const f of ["auth", "mcpauth"]) delete require.cache[path.resolve(__dirname, `../src/${f}.js`)]; const x = require("../src/mcpauth"); const out = x.openRequest(sealed, now); process.env.SESSION_SECRET = "unit-secret"; return out; })();
t("a request sealed under another instance's secret does not open", other === null);
m = load({ SOS_PUBLIC_URL: "https://app.anetix.ai" });

// ---- who may connect an app
const admin = { id: 1, role: "admin", status: "active", enrolled: true }, manager = { id: 2, role: "manager", company: "demo", status: "active", enrolled: true };
t("an admin account with its second factor may connect an app to the admin address", m.refusal(admin, "admin") === null);
t("nobody, a switched-off account, and an account with no second factor may not", /sign in/.test(m.refusal(null, "admin")) && /switched off/.test(m.refusal({ ...admin, status: "disabled" }, "admin")) && /authenticator/.test(m.refusal({ ...admin, enrolled: false }, "admin")));
t("under break glass the password stands in for the factor, as it does on /admin", m.refusal({ ...admin, enrolled: false }, "admin", { twoFaOff: true }) === null);
t("a manager account may not, whatever its factor", /not open yet/.test(m.refusal(manager, "admin")) && /not open yet/.test(m.refusal(manager, "admin", { twoFaOff: true })));
t("an address this instance does not have connects no one", /not an address/.test(m.refusal(admin, "company")) && /not an address/.test(m.refusal(admin, undefined)));
t("a connection lives by the admin cookie's own windows", m.windowsFor("admin").idle === 168 * 3600 && m.windowsFor("admin").cap === 720 * 3600 && m.ACCESS_S === 3600);
t("a token's hash is sha256, and never the token", /^[0-9a-f]{64}$/.test(m.hashToken("anx_at_x")) && m.hashToken("a") !== m.hashToken("b"));

// ---- what a tool's answer becomes, and what the log keeps
const mcp = quiet(() => require("../src/mcp"));
const small = mcp.toText({ a: 1, when: new Date("2026-10-05T12:00:00Z") });
t("an answer is JSON as text, dates as ISO", !small.cut && JSON.parse(small.text).a === 1 && JSON.parse(small.text).when === "2026-10-05T12:00:00.000Z");
const big = mcp.toText({ rows: Array.from({ length: 5000 }, (_, i) => ({ i, words: "x".repeat(40) })) }, 3000);
t("past the limit it is cut, and says so in words that name the way out", big.cut && big.text.length < 3300 && /was cut at 3000 characters of \d+\. Ask again for less/.test(big.text));
const kept = mcp.clipArgs({ company: "demo", limit: 5, flag: true, none: null, words: "y".repeat(900), nested: { a: "z".repeat(900) } });
t("the log keeps what was asked, with long text cut", kept.company === "demo" && kept.limit === 5 && kept.flag === true && kept.none === null && kept.words.length === 200 && kept.nested.length === 200);
const meta = mcp.oauthMetadata("https://app.anetix.ai");
t("the sign-in server's description: every path under /oauth/, PKCE S256 only, public clients allowed, no client ID documents claimed",
  meta.issuer === "https://app.anetix.ai" && ["authorization_endpoint", "token_endpoint", "registration_endpoint", "revocation_endpoint"].every((k) => meta[k].startsWith("https://app.anetix.ai/oauth/")) && meta.code_challenge_methods_supported.join() === "S256"
  && meta.token_endpoint_auth_methods_supported.includes("none") && meta.client_id_metadata_document_supported === undefined && meta.grant_types_supported.join() === "authorization_code,refresh_token");

// ---- what leaves the admin tools
const A = require("../src/mcp-admin");
const names = A.tools.map((x) => x.name);
t("nine tools, each with a name, a description and a run", names.length === 9 && new Set(names).size === 9 && A.tools.every((x) => /^[a-z_]+$/.test(x.name) && x.description.length > 40 && typeof x.run === "function" && x.readOnly !== false));
t("no tool's words carry an em or en dash", !/[\u2013\u2014]/.test(JSON.stringify(A.tools.map((x) => [x.title, x.description])) + A.surface.instructions));
const demo = A.demoOut({ slug: "acme", pin: { id: 4, label: "Acme, from the trade show", shown: "ABCD-EFGH" }, money: { paid_usd: 20 } });
t("a demo leaves without its access pin, keeping whose it was", demo.pin.label === "Acme, from the trade show" && demo.pin.id === 4 && !JSON.stringify(demo).includes("ABCD") && demo.money.paid_usd === 20 && A.demoOut({ slug: "x", pin: null }).pin === null);
const stopKind = require("../src/health").stopKind;
const dr = A.demoRunOut({ id: 9, status: "failed", error: "platform checks failed: GET /api/orders answered {\"customer\":\"Acme Corp\"}" }, stopKind);
t("a demo's stopped build leaves as the kind of stop, never the failing line", dr.stopped === "gate" && dr.error === undefined && !JSON.stringify(dr).includes("Acme Corp") && A.demoRunOut({ id: 1, status: "deployed", error: null }, stopKind).stopped === null);
const site = A.siteOut({ slug: "acme", name: "Acme", stage: "subscribed", standing: "good", stripe_customer: "cus_123", billing: { email: "ap@acme.test" }, site_address: { line1: "1 Main St" }, address_line: "1 Main St", demo_email: "pat@acme.test", headcount: 80,
  band: { key: "b2", monthly_usd: 1750 }, order: { id: 3, state: "signed", price_usd: 1750, card: { brand: "visa", last4: "4242" }, card_saved: true, signer: { name: "Pat", title: "Plant manager", email: "pat@acme.test", via: "typed" }, approver: { name: "B", email: "b@x" },
    activate: { subscription: "sub_123", last_error: "card_declined: insufficient funds", declined: null, attempts: 2 } },
  subscription: { id: "sub_123", activated_at: "2026-10-01", standing: "good", learning_opt_in: false } });
const siteText = JSON.stringify(site);
t("a site leaves with its stage, band and order, and without Stripe's ids, the card, the billing contact, the street address or anyone's email",
  site.stage === "subscribed" && site.band.monthly_usd === 1750 && site.order.state === "signed" && site.order.card_saved === true && site.order.signer.name === "Pat" && site.order.activate.attempts === 2 && site.order.activate.failed === true && site.subscription.activated_at === "2026-10-01"
  && !/cus_123|sub_123|4242|visa|ap@acme|pat@acme|b@x|Main St|insufficient funds/.test(siteText), siteText);
const health = require("../src/health");
const run = A.runOut({ id: 5, company: "acme", module: "orders", lane: "ui", step: "error", status: "failed", model: "claude-opus-5-5", from_version: 2, to_version: 3, cost_usd: "0.3141", created_at: "2026-10-05T10:00:00Z", updated_at: "2026-10-05T10:02:00Z",
  evidence: { title: "Bigger button", what_changed: "The release button is bigger.", error: "cross-check failed: the row for Acme Corp", diff: "- a\n+ b" }, log: [{ t: "2026-10-05T10:01:00Z", step: "error", note: "cross-check failed: the row for Acme Corp" }] }, health);
t("a build run leaves with where it is, what it cost, the change in plain words and each stop as a kind; no log line, no diff",
  run.cost_usd === 0.31 && run.title === "Bigger button" && run.stops.length === 1 && run.stops[0].kind === "reviewer" && !/Acme Corp|diff|"log"|"evidence"/.test(JSON.stringify(run)), JSON.stringify(run));

// ---- the backup: never in the file, and a restore clears what points at the accounts
const backup = require("fs").readFileSync(path.resolve(__dirname, "../src/backup.js"), "utf8");
const notIn = /const NOT_IN_BACKUP = \[([^\]]*)\]/.exec(backup)[1];
t("no connector table is ever in a backup file", ["mcp_clients", "mcp_grants", "mcp_tokens", "mcp_codes", "mcp_calls"].every((x) => notIn.includes(`"${x}"`)));
t("a restore clears the connections, tokens and codes together with the accounts they point at", ["platform.mcp_grants", "platform.mcp_tokens", "platform.mcp_codes"].every((x) => new RegExp(`TRUNCATE[^\\n]*"${x.replace(".", "\\.")}"`).test(backup)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
