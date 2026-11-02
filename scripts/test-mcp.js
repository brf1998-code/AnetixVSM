// Unit cases for the connector's pure parts (src/mcpauth.js, src/mcp.js, src/mcp-admin.js). No database, no network.
//   node scripts/test-mcp.js
const path = require("path");
let pass = 0, fail = 0;
function t(name, cond, detail) { if (cond) { pass++; } else { fail++; console.log(`FAIL  ${name}${detail !== undefined ? "\n      " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : ""}`); } }
process.env.SESSION_SECRET = "unit-secret";
function load(env) {
  for (const k of ["SOS_PUBLIC_URL", "SOS_MCP_REDIRECTS", "SOS_MCP_ACCESS_MIN", "SOS_MCP_TRIALS"]) delete process.env[k];
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
t("with it set: on, and both addresses are under it", m.enabled() && m.resourceOf("admin") === "https://app.anetix.ai/mcp/admin" && m.resourceOf("company") === "https://app.anetix.ai/mcp" && m.resourceOf("nope") === null);
t("an address names its surface exactly: a trailing slash or a fragment is forgiven, nothing else", m.surfaceOf("https://app.anetix.ai/mcp/admin") === "admin" && m.surfaceOf("https://app.anetix.ai/mcp/admin/") === "admin" && m.surfaceOf("https://app.anetix.ai/mcp/admin#x") === "admin"
  && m.surfaceOf("https://app.anetix.ai/mcp") === "company" && m.surfaceOf("https://app.anetix.ai/mcp/") === "company"
  && [null, "", "https://app.anetix.ai", "https://app.anetix.ai/mcp/x", "https://app.anetix.ai/mcp/admin/x", "https://evil.example/mcp/admin", "https://evil.example/mcp", "http://app.anetix.ai/mcp/admin", "http://app.anetix.ai/mcp", "https://app.anetix.ai/mcp/admin?x=1", "https://app.anetix.ai/mcp?c=acme", "https://app.anetix.ai/MCP/ADMIN", "https://app.anetix.ai/MCP"].every((v) => m.surfaceOf(v) === null));

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
t("a manager account may not connect to the admin address, whatever its factor, and is told its own", /Anetix's own accounts; your company's address is https:\/\/app\.anetix\.ai\/mcp$/.test(m.refusal(manager, "admin")) && /Anetix's own accounts/.test(m.refusal(manager, "admin", { twoFaOff: true })));
t("an admin account may not connect to the company address: a company's managers do, each with their own account", /for a company's managers/.test(m.refusal(admin, "company")) && /mcp\/admin/.test(m.refusal(admin, "company")));
t("a manager account with its second factor may connect to the company address (the company half is checked apart)", m.refusal(manager, "company") === null && /authenticator app or a passkey/.test(m.refusal({ ...manager, enrolled: false }, "company")));
t("a manager account with no company connects nowhere", /no company/.test(m.refusal({ ...manager, company: null }, "company")));
t("an address this instance does not have connects no one", /not an address/.test(m.refusal(admin, "elsewhere")) && /not an address/.test(m.refusal(admin, undefined)) && /not an address/.test(m.refusal(manager, "")));
t("an app that names no address gets the one the account's kind has, never more", m.surfaceFor(null, admin) === "admin" && m.surfaceFor(null, manager) === "company" && m.surfaceFor("admin", manager) === "admin" && m.surfaceFor(undefined, null) === "admin");
t("a connection lives by the admin cookie's own windows, a manager's too", m.windowsFor("admin").idle === 168 * 3600 && m.windowsFor("admin").cap === 720 * 3600 && m.ACCESS_S === 3600
  && m.windowsFor("manager").idle === m.windowsFor("admin").idle && m.windowsFor("manager").cap === m.windowsFor("admin").cap);
t("SOS_MCP_TRIALS is a list of slugs: junk is dropped, nothing is a wildcard, empty is none", m.trialList("anetix, Demo ,bad slug!,*,,x") .join() === "anetix,demo" && m.trialList("").length === 0 && m.trialList(undefined).length === 0 && m.TRIALS.size === 0);
t("the company address has one write tool, so the consent page offers the tick there too", m.WRITES.company === true && m.WRITES.admin === true);
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
const WRITERS = ["add_map_source", "answer_map_walk", "answer_tool_request", "change_tool_request_design", "draft_map_walk", "map_another_family", "read_map_sources", "send_tool_request", "start_map_walk", "start_tool_request"];
t("twenty-eight tools, each with a name, a description and a run", names.length === 28 && new Set(names).size === 28 && A.tools.every((x) => /^[a-z_]+$/.test(x.name) && x.description.length > 40 && typeof x.run === "function"));
t("ten of them write, a new tool request or a mapping walk, and every other one only reads", A.tools.filter((x) => x.readOnly === false).map((x) => x.name).sort().join() === WRITERS.join());
t("no tool confirms a design, builds, deploys, withdraws or deletes", !names.some((n) => /^(confirm|build|deploy|withdraw|abandon|delete|remove|approve)_|make_.*live/.test(n)));
t("the instructions say which tools write, and that a manager confirms on the board", /Read only, with two exceptions/.test(A.surface.instructions) && /replaces a map/.test(A.surface.instructions) && WRITERS.every((n) => A.surface.instructions.includes(n)) && /a manager does that on the board/.test(A.surface.instructions));
t("no tool's words carry an em or en dash", !/[\u2013\u2014]/.test(JSON.stringify(A.tools.map((x) => [x.title, x.description])) + A.surface.instructions));
// ---- the mapping walk's tools (src/mcp-vsm.js, the VSM dev copy's M2)
const V = require("../src/mcp-vsm");
t("the walk's tools: two read, six write, and none uses or puts away a map; and the agent board's counts, which only read", V.tools.map((x) => x.name).sort().join() === "add_map_source,agent_board_status,answer_map_walk,draft_map_walk,get_map_walk,list_map_walks,map_another_family,read_map_sources,start_map_walk" && !V.tools.some((x) => /^(use|abandon|delete|remove|replace)_/.test(x.name)) && V.tools.filter((x) => x.readOnly === false).length === 6 && V.tools.find((x) => x.name === "agent_board_status").readOnly !== false);
const nv = (kind, extra = {}) => V.nextStep({ screen: { kind, ...extra }, sources: [] }, "https://app.anetix.ai/c/acme/map");
t("each screen of the walk tells an app what to do next", ["sources", "reading", "family", "customer", "systems", "last", "card", "before", "supplier", "control", "review", "drafted", "used"].every((k) => nv(k).length > 20) && /read_map_sources|add_map_source/.test(nv("sources")) && /draft_map_walk/.test(nv("review")));
t("a drawn walk says the manager decides on the board, with the board's address", /manager/.test(nv("drafted")) && nv("drafted").includes("https://app.anetix.ai/c/acme/map") && /not available here/.test(nv("drafted")));
t("an answer is never to be made up", /never make a field up|Never make a field up/i.test(nv("card")) && /\?/.test(nv("customer")));
t("reading the sources is paced with the intake's sends", V.READS.join() === "read_map_sources");
// the audit tools (2026-10-12): what a line of the record carries
const line = (kind, after) => A.activityOut({ id: 1, kind, company: "acme", module: "count", actor_role: "manager", actor_name: "Maria", before: "was", after, detail: { round: 2, cost_usd: 1.2, prompt: "x" }, created_at: new Date() });
t("a request's line carries the words written, who and a small detail", line("feedback_filed", "make the button bigger").words === "make the button bigger" && line("feedback_filed", "x").who === "Maria" && line("feedback_filed", "x").detail.round === 2 && line("feedback_filed", "x").detail.prompt === undefined && line("feedback_filed", "x").detail.cost_usd === undefined);
t("a check, a system review and a saved doc carry no words", ["check_verdict", "review_findings", "doc_saved"].every((k) => line(k, "CANARY").words === null && line(k, "CANARY").before === null));
t("a chat persona's lines never leave, and the record tools of Ask Anetix are named", A.NEVER.includes("chat_answer") && A.NEVER.includes("chat_question") && A.RECORD_TOOLS.has("read_records") && A.RECORD_TOOLS.has("summarize_records"));
t("a long line is cut and says so", /\[cut\]$/.test(line("feedback_filed", "x".repeat(5000)).words));
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

// ---- the new tool request tools: an answer is brought to its question's shape, or refused in words
const I = require("../src/mcp-intake"), IQ = require("../src/intake-questions");
const F = Object.fromEntries(IQ.FIXED.map((x) => [x.id, x]));
const refused = (fn) => { try { fn(); return null; } catch (e) { return e.say ? e.message : `THREW ${e.message}`; } };
t("text: trimmed, cut at the question's length, one line where the question is one line", I.normalize(F.name, "  Rework\nboard  ") === "Rework board" && I.normalize(F.purpose, "a\nb") === "a\nb" && I.normalize(F.name, "x".repeat(500)).length === 80 && I.normalize(F.thing, 42) === "42");
t("text: empty, or not text, is refused", /empty/.test(refused(() => I.normalize(F.name, "   "))) && /plain text/.test(refused(() => I.normalize(F.name, { a: 1 }))) && /no answer/.test(refused(() => I.normalize(F.name, null))));
const today = I.normalize(F.today, { picks: ["A whiteboard", "SPREADSHEET", "a notebook at the bench"], other: "sticky notes" });
t("choice: picks by id or by the words on the option; what matches nothing goes to other", today.picks.join() === "whiteboard,spreadsheet" && today.other === "sticky notes; a notebook at the bench");
t("choice: a bare string or a list is taken as the picks", I.normalize(F.today, "paper").picks.join() === "paper" && I.normalize(F.today, ["paper", "head"]).picks.join() === "paper,head" && I.normalize(F.today, "we shout across the floor").other === "we shout across the floor");
const ww = I.normalize(F.works_with, { picks: ["erp", "scanners"], names: { erp: "Epicor", "Barcode or QR scanners": "Zebra", machine: "Haas" }, note: "ignored here" });
t("choice: a name is kept only for a picked option that takes one, a note only where the question has one", JSON.stringify(ww) === JSON.stringify({ picks: ["erp", "scanners"], names: { erp: "Epicor" } }) && I.normalize(F.numbers, { picks: ["how_late"], note: "late orders per week" }).note === "late orders per week");
const peers = { id: "peers", kind: "choice", multi: true, other: false, options: [{ id: "orders", label: "Orders" }, { id: "none", label: "No" }] };
const one = { id: "r2q1", kind: "choice", multi: false, other: true, options: [{ id: "o1", label: "Anyone" }, { id: "o2", label: "Only leads" }] };
t("choice: a question with no free text refuses what is not a choice, and names the choices", /not one of its choices.*orders \(Orders\)/.test(refused(() => I.normalize(peers, ["Inventory"]))) && I.normalize(peers, ["Orders"]).picks.join() === "orders");
t("choice: a one-pick question refuses two, and takes one by its words", /one pick/.test(refused(() => I.normalize(one, ["o1", "o2"]))) && I.normalize(one, "only leads").picks.join() === "o2" && /nothing was picked/.test(refused(() => I.normalize(one, { picks: [] }))));
t("roles: group ids or their words, a headcount as text; an unknown group is refused", JSON.stringify(I.normalize(F.who, { floor: 12, "Leads or supervisors": " 2 " })) === JSON.stringify({ floor: "12", leads: "2" }) && JSON.stringify(I.normalize(F.who, ["floor"])) === JSON.stringify({ floor: "" })
  && /not one of its groups/.test(refused(() => I.normalize(F.who, { welders: "4" }))) && /takes/.test(refused(() => I.normalize(F.who, {}))));
t("devices: only for a group in the who answer, by id or words", JSON.stringify(I.normalize(F.devices, { floor: ["A tablet", "phone", "phone"], leads: "desk" }, { who: { floor: "12", leads: "2" } })) === JSON.stringify({ floor: ["tablet", "phone"], leads: ["desk"] })
  && /not a group in the "who" answer/.test(refused(() => I.normalize(F.devices, { office: ["desk"] }, { who: { floor: "" } }))) && /needs the "who" answer first/.test(refused(() => I.normalize(F.devices, { floor: ["phone"] }, {})))
  && /not one of its devices/.test(refused(() => I.normalize(F.devices, { floor: ["a pager"] }, { who: { floor: "" } }))));
t("a list: lines in order, numbering and bullets taken off, blanks dropped", I.normalize(F.stages, "1. Found\n2) At the bench\n\n- Fixed").join("|") === "Found|At the bench|Fixed" && I.normalize(F.wrong, [" a ", "", "b"]).join() === "a,b");
t("a list: more than the question takes is refused, never silently cut", /at most 5 lines; 6 were given/.test(refused(() => I.normalize(F.wrong, ["a", "b", "c", "d", "e", "f"]))) && /at most 16/.test(refused(() => I.normalize(F.stages, Array.from({ length: 17 }, (_, i) => `s${i}`))))
  && I.listLimits({ kind: "order", max: 6000, maxItems: 10 }).count === 10 && /empty/.test(refused(() => I.normalize(F.stages, []))));
t("a file question takes a note, never a file", I.normalize(F.starting_list, { note: "the parts list" }).note === "the parts list" && I.normalize(F.starting_list, "the parts list").note === "the parts list" && /added on the board/.test(refused(() => I.normalize(F.starting_list, {}))));
t("every fixed question says what it takes", IQ.FIXED.every((x) => I.takes(x).length > 20) && /names: \{ option id/.test(I.takes(F.works_with)) && /One pick/.test(I.takes(one)) && /2 to 16/.test(I.takes(F.stages)));
const ord = I.inOrder(IQ.FIXED, { devices: 1, nope: 2, who: 3, name: 4 });
t("answers are applied in the question order (the name first, who before devices), and an unknown id is set aside", ord.known.join() === "name,who,devices" && ord.unknown.join() === "nope");
const view = { id: 7, company: "acme", status: "answering", via: "anetix", name: "Rework board", slug: "rework-board", round: 1, round_why: "", missing: ["stages"], cost_usd: "0.123", error: null, attachments: [{ question_id: "today", filename: "board.jpg", bytes: "SECRET-BYTES" }],
  answers: { name: "Rework board", who: { floor: "12" } }, questions: IQ.FIXED.map((x) => ({ ...x, round: 1 })), design: null };
const ro = I.requestOut(view, { boardUrl: "https://app.anetix.ai/c/acme/" });
t("a request as an app reads it: each question with what it takes and its answer, what is missing, what to do next, the board's address", ro.writable_here === true && ro.questions.length === IQ.FIXED.length && ro.questions[0].answer === "Rework board" && ro.questions[0].answered === true
  && ro.questions.find((x) => x.id === "stages").answered === false && ro.questions.find((x) => x.id === "who").options.length === 5 && /stages/.test(ro.next) && /never|do not make an answer up/.test(ro.next) && ro.board === "https://app.anetix.ai/c/acme/" && ro.ai_cost_usd === 0.12);
t("a file on the board is named, never carried", ro.files_on_the_board[0].name === "board.jpg" && !JSON.stringify(ro).includes("SECRET-BYTES"));
const hid = I.requestOut({ ...view, via: null, design: { bluf: "SECRET-DESIGN", items: [] } }, { full: false });
t("a paying site's own request leaves as how far it got and nothing it said", hid.status === "answering" && hid.writable_here === false && hid.name === null && hid.questions === undefined && hid.design === undefined && !/Rework|SECRET|floor/.test(JSON.stringify(hid)));
const des = I.requestOut({ ...view, status: "design", missing: [], design: { bluf: "A board.", items: [{ id: "p1", kind: "rule", summary: "One at a time.", mark: "changed" }], reference_md: "# Ref", flags: [], estimate_usd: 9, model: "claude-fable-5-1" } }, { boardUrl: "https://app.anetix.ai/c/acme/" });
t("a design leaves as its points and reference, and the next step is the manager's on the board", des.design.points[0].id === "p1" && des.design.points[0].mark === "changed" && des.design.reference === "# Ref" && /manager reads and confirms on the board/.test(des.next) && /not available here/.test(des.next));
t("whoever writes is on the record by name, as Anetix through the app", I.byOf({ account: { name: "Brendan Finn", login: "b@anetix.ai" }, app: "Claude" }).name === "Brendan Finn (Anetix, through Claude)" && I.byOf({ account: { login: "b@anetix.ai" }, app: "Claude" }).role === "admin");
t("a write tool on a connection that may not write is told how to get there", /read only/.test(mcp.READ_ONLY) && /connect it again/.test(mcp.READ_ONLY) && !/[\u2013\u2014]/.test(mcp.READ_ONLY));
const consent = require("fs").readFileSync(path.resolve(__dirname, "../public/connect.html"), "utf8");
t("the consent page's tick is off until the person ticks it, and says what it never does", /id="writes"/.test(consent) && !/id="writes"[^>]*checked/.test(consent) && /cannot confirm a design, build, put anything on a floor/.test(consent));

// ---- the backup: never in the file, and a restore clears what points at the accounts
const backup = require("fs").readFileSync(path.resolve(__dirname, "../src/backup.js"), "utf8");
const notIn = /const NOT_IN_BACKUP = \[([^\]]*)\]/.exec(backup)[1];
t("no connector table is ever in a backup file", ["mcp_clients", "mcp_grants", "mcp_tokens", "mcp_codes", "mcp_calls"].every((x) => notIn.includes(`"${x}"`)));
t("a restore clears the connections, tokens and codes together with the accounts they point at", ["platform.mcp_grants", "platform.mcp_tokens", "platform.mcp_codes"].every((x) => new RegExp(`TRUNCATE[^\\n]*"${x.replace(".", "\\.")}"`).test(backup)));


// ---- the company MCP (src/mcp-company.js): the shared tools, what leaves, and the one write
{
  const mc = quiet(() => require("../src/mcp-company"));
  const names = mc.tools.map((x) => x.name);
  t("the company address serves the shared registry's tools and file_request, nothing else", names.join() === "list_tools,describe_tool,whats_changed,list_requests,get_request,summarize_records,read_records,file_request", names);
  t("file_request is its only write; every other tool reads", mc.tools.filter((x) => x.readOnly === false).map((x) => x.name).join() === "file_request");
  t("the two record tools are the ones marked as reading records", mc.tools.filter((x) => x.records).map((x) => x.name).join() === "summarize_records,read_records");
  t("no tool takes a company, a role or a person", mc.tools.every((x) => !Object.keys(x.input || {}).some((k) => /company|role|person|slug|account/.test(k))), mc.tools.map((x) => Object.keys(x.input || {})));
  const scrubbed = mc.out({ tool: "Cycle count", cost_usd: 1.2, model: "claude-opus-5", note: "built by claude-opus-5", records: [{ model: "claude-opus-5", cost_usd: 9.5, part: "A1" }] });
  t("what leaves is scrubbed of model names and AI costs, apart from the company's own rows", scrubbed.cost_usd === undefined && scrubbed.model === undefined && scrubbed.note === "built by the AI" && scrubbed.records[0].model === "claude-opus-5" && scrubbed.records[0].cost_usd === 9.5, scrubbed);
  t("an answer with no records is scrubbed whole", mc.out({ spend: 3, list: [{ cost_usd: 1, a: 1 }] }).spend === undefined && mc.out({ list: [{ cost_usd: 1, a: 1 }] }).list[0].cost_usd === undefined);
  t("the refusal words for records name the manager's switch, and Anetix's lock apart", /Settings, under Connected apps/.test(mc.RECORDS_OFF) && /Anetix has records switched off/.test(mc.RECORDS_LOCKED));
  t("the surface tells the app what is the company's and that a filed request waits", /belongs to this company/.test(mc.surface.instructions) && /waits there for a manager/.test(mc.surface.instructions) && !/[–—]/.test(mc.surface.instructions + mc.tools.map((x) => x.description).join(" ")));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
