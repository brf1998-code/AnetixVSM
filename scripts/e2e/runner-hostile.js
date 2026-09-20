// Hostile module code against the wall (tenancy option C: src/runner.js, src/runner-child.js, src/dbroles.js).
//
// The module gate (src/modulegate.js) would refuse every line of the "tool" below at build time, which is the
// point: this suite does NOT go through a build. It plays the platform, loads the hostile routes.js straight into
// a company's own process the way registry.buildRouter does, puts the platform's proxy in front of it, and then
// tries everything. What it proves is what is left standing when the text check has been got around: the process
// and database boundary, not the gate.
//
// Needs Postgres (DATABASE_URL, a user that may make roles) and, to prove the file/user half, root (a container
// runs as root on Railway; the sandbox too). Without root it still proves the database and channel halves and says
// the file half was not tested. No server has to be up.
//   DATABASE_URL=postgres://sos:sos@127.0.0.1:5432/sos_e2e node scripts/e2e/runner-hostile.js
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "e2e-secret";
process.env.ANTHROPIC_API_KEY = "sk-ant-THE-PLATFORM-KEY-do-not-leak";
process.env.SOS_ADMIN_PASSWORD = "THE-ADMIN-PASSWORD-do-not-leak";
process.env.SOS_MODULE_TIMEOUT_MS = "2000";
process.env.SOS_MODULE_LOAD_TIMEOUT_MS = "3000";
process.env.SOS_MODULE_RUNNER = "process";
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http");
// under the app tree, so module code's require("pg") resolves to the app's node_modules exactly as in production
const APP = path.join(__dirname, "..", "..");
const base = fs.mkdtempSync(path.join(APP, "data", "hostile-")); fs.chmodSync(base, 0o755);
process.env.MODULES_DIR = path.join(base, "modules");
const express = require("express");
const { q, initPlatformSchema, pool } = require("../../src/db");
const migrate = require("../../src/migrate");
const registry = require("../../src/registry");
const runner = require("../../src/runner"), dbroles = require("../../src/dbroles");
let pass = 0, fail = 0;
const t = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log(`FAIL  ${name}${detail !== undefined ? "\n      " + (typeof detail === "string" ? detail : JSON.stringify(detail)).slice(0, 500) : ""}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Everything a steered build could try to reach from inside routes.js, one endpoint each.
const HOSTILE = String.raw`
const fs = require("fs"), http = require("http");
module.exports = (ctx) => {
  const r = ctx.express.Router();
  const go = async (f) => { try { return { ok: true, value: await f() }; } catch (e) { return { ok: false, why: String(e.code || e.message).slice(0, 140) }; } };
  r.get("/env", (req, res) => res.json({ keys: Object.keys(process.env), dump: JSON.stringify(process.env) }));
  r.get("/parent-env", async (req, res) => res.json(await go(() => fs.readFileSync("/proc/" + process.ppid + "/environ", "utf8"))));
  r.get("/read", async (req, res) => res.json(await go(() => fs.readFileSync(req.query.p, "utf8").slice(0, 60))));
  r.get("/write", async (req, res) => res.json(await go(() => { fs.writeFileSync(req.query.p, "owned"); return "written"; })));
  r.get("/shell", async (req, res) => res.json(await go(() => require("child_process").execSync("id").toString())));
  r.get("/worker", async (req, res) => res.json(await go(() => { new (require("worker_threads").Worker)("0", { eval: true }); return "started"; })));
  r.get("/sql", async (req, res) => res.json(await go(async () => (await ctx.db(req.query.q)).rows)));
  r.get("/peer", async (req, res) => res.json(await go(async () => { const p = ctx.peer(req.query.m); if (!p) return "no peer"; return (await p(req.query.q)).rows; })));
  r.get("/own-pool", async (req, res) => res.json(await go(async () => { const { Pool } = require("pg"); const p = new Pool({ connectionString: req.query.url, max: 1, connectionTimeoutMillis: 4000 }); try { return (await p.query(req.query.q || "SELECT current_user")).rows; } finally { p.end().catch(() => {}); } })));
  r.get("/who", (req, res) => res.json({ role: req.sosRole, company: req.sosCompany, person: req.sosPerson || null, cookie: req.headers.cookie || null, authorization: req.headers.authorization || null, runner: req.headers["x-sos-runner"] || null, device: req.headers["x-sos-device"] || null }));
  r.post("/echo", (req, res) => res.json({ body: req.body }));
  r.get("/manager-only", ctx.requireManager, (req, res) => res.json({ ok: true }));
  r.get("/set-cookie", (req, res) => { res.cookie("sos_session", "stolen"); res.set("Content-Security-Policy", "default-src *"); res.json({ ok: true }); });
  r.get("/loop", () => { const end = Date.now() + 60000; while (Date.now() < end) {} });
  r.get("/exit", () => process.exit(3));
  r.get("/socket", async (req, res) => res.json(await go(() => new Promise((ok, no) => { const x = http.get({ socketPath: req.query.p, path: "/other/api/state", headers: { "x-sos-runner": req.query.tok || "" } }, (y) => ok(y.statusCode)); x.on("error", no); }))));
  r.get("/impersonate", async (req, res) => res.json(await go(() => new Promise((ok) => { const id = 987654; const on = (m) => { if (m && m.op === "svc-reply" && m.id === id) { process.off("message", on); ok(m); } }; process.on("message", on); process.send({ op: "svc", id, mod: req.query.mod || "victim", name: "agentDoc", args: { name: "COMPANY.md" } }); setTimeout(() => ok("no answer"), 1500); }))));
  r.get("/doc", async (req, res) => res.json(await go(() => ctx.agentDoc("reference.md"))));
  return r;
};`;

// A harmless sibling in the SAME company, so ctx.peer has a real target.
const SIBLING = String.raw`
module.exports = (ctx) => { const r = ctx.express.Router();
  r.get("/api/state", (req, res) => res.json({ ok: true }));
  return r; };`;

const manifest = (name, extra) => ({ name, title: name, entry: "routes.js", pages: {}, ...(extra || {}) });
function put(company, mod, version, code, mani) {
  const dir = path.join(process.env.MODULES_DIR, company, mod, "versions", String(version));
  fs.mkdirSync(path.join(dir, "migrations"), { recursive: true });
  fs.writeFileSync(path.join(dir, "routes.js"), code);
  fs.writeFileSync(path.join(dir, "module.json"), JSON.stringify(mani || manifest(mod)));
  fs.writeFileSync(path.join(dir, "migrations", "001.sql"), `CREATE TABLE IF NOT EXISTS thing (id SERIAL PRIMARY KEY, secret TEXT);\nINSERT INTO thing (secret) VALUES ('${company}-${mod}-row');`);
}

(async () => {
  await initPlatformSchema();
  await runner.init();
  const self = await runner.selfTest();
  if (self.effective !== "process") { console.log("SKIP: this machine cannot run module code in its own process:", self.roles.reason || self.state); process.exit(0); }
  const asUser = self.user.ok === true;
  console.log(`running as ${asUser ? "root: file and user checks included" : "not root: file and user checks SKIPPED (database and channel checks still run)"}\n`);

  // two companies; evil has the hostile tool plus a sibling, victim has one tool with a secret row
  for (const c of ["evil", "victim"]) await q("INSERT INTO platform.companies (slug, name) VALUES ($1,$1) ON CONFLICT DO NOTHING", [c]);
  put("evil", "tool", 1, HOSTILE);
  put("evil", "sibling", 1, SIBLING);
  put("victim", "tool", 1, SIBLING);
  const app = express();
  app.disable("x-powered-by");
  const mount = async (company, mod) => {
    await q("INSERT INTO platform.modules (company, name, title, live_version) VALUES ($1,$2,$2,1) ON CONFLICT (company, name) DO UPDATE SET live_version=1", [company, mod]);
    await migrate.applyMigrations(migrate.liveSchema(company, mod), path.join(process.env.MODULES_DIR, company, mod, "versions", "1"));
    await registry.mountLiveIfNeeded(company, mod, 1);
  };
  for (const [c, m] of [["evil", "sibling"], ["evil", "tool"], ["victim", "tool"]]) await mount(c, m);
  // a session the platform would have set, in place BEFORE the module mounts, so the proxy has it to strip
  app.use((req, _res, next) => { req.sosRole = req.headers["x-role"] || "floor"; req.sosCompany = req.path.split("/")[2]; req.sosPerson = "Dana"; req.sosPersonId = 7; req.headers.cookie = "sos_session=SECRETSESSION; sos_person=SECRETPERSON"; next(); });
  registry.attach(app);
  const srv = app.listen(0);
  await new Promise((r) => srv.once("listening", r));
  const port = srv.address().port;
  const call = (p, role) => new Promise((ok, no) => { const req = http.get({ port, path: p, headers: role ? { "x-role": role } : {} }, (res) => { let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => { try { ok({ status: res.statusCode, json: JSON.parse(b) }); } catch (e) { ok({ status: res.statusCode, text: b }); } }); }); req.on("error", no); req.setTimeout(8000, () => req.destroy(new Error("timeout"))); });
  const G = (r) => r.json && r.json.value, refused = (r) => r.json && r.json.ok === false;
  const evilRole = migrate.liveSchema("evil", "tool"); // just to name schemas below
  const evilLive = "mod_evil_tool", victimLive = "mod_victim_tool", evilRoleUrl = (lane) => { const c = dbroles.connectionFor("evil", lane); return `postgres://${c.user}:${c.password}@${c.host}:${c.port}/${c.database}`; };

  // ---- the environment
  {
    const r = await call("/c/evil/m/tool/env");
    const dump = (r.json && r.json.dump) || "";
    t("the child cannot see the platform's API key", !dump.includes("THE-PLATFORM-KEY") && !(r.json.keys || []).includes("ANTHROPIC_API_KEY"), (r.json.keys || []).join(","));
    t("nor the admin password, session secret or database URL", !dump.includes("THE-ADMIN-PASSWORD") && !dump.includes("e2e-secret") && !/postgres:\/\//.test(dump) && !(r.json.keys || []).some((k) => /SECRET|PASSWORD|DATABASE_URL|SOS_RUNNER_BOOT/.test(k)), (r.json.keys || []).join(","));
    if (asUser) t("nor read them out of the platform process's own /proc/<ppid>/environ", refused(await call("/c/evil/m/tool/parent-env")), await call("/c/evil/m/tool/parent-env"));
  }
  // ---- the database
  {
    t("its own table answers", (G(await call("/c/evil/m/tool/sql?q=" + encodeURIComponent("SELECT secret FROM thing"))) || [{}])[0].secret === "evil-tool-row");
    const plat = await call("/c/evil/m/tool/sql?q=" + encodeURIComponent("SELECT slug FROM platform.companies"));
    t("the platform's own tables do not", refused(plat) && /permission denied|42501/.test(plat.json.why), plat.json);
    const other = await call("/c/evil/m/tool/sql?q=" + encodeURIComponent("SELECT secret FROM " + victimLive + ".thing"));
    t("another company's tables do not", refused(other) && /permission denied|42501/.test(other.json.why), other.json);
    for (const stmt of ["CREATE TABLE evil2 (x int)", "DROP TABLE thing", "TRUNCATE thing", "ALTER TABLE thing ADD COLUMN x int", "SET ROLE postgres", "COPY thing TO '/tmp/x'"]) {
      const r = await call("/c/evil/m/tool/sql?q=" + encodeURIComponent(stmt));
      t("SQL refused: " + stmt.slice(0, 22), refused(r), r.json);
    }
    // it may write its OWN rows (a real tool does)
    t("it can write its own rows", (await call("/c/evil/m/tool/sql?q=" + encodeURIComponent("INSERT INTO thing (secret) VALUES ('mine') RETURNING id"))).json.ok !== false);
    // a Pool it builds itself is still only its own login (it has no other credentials)
    const asOwn = await call("/c/evil/m/tool/own-pool?url=" + encodeURIComponent(evilRoleUrl("live")) + "&q=" + encodeURIComponent("SELECT 1 FROM " + victimLive + ".thing"));
    t("a Pool it builds by hand reaches no further than its own login", refused(asOwn) && /permission denied|42501/.test(asOwn.json.why), asOwn.json);
  }
  // ---- peers: read a sibling, not another company
  {
    const sib = await call("/c/evil/m/tool/peer?m=sibling&q=" + encodeURIComponent("SELECT secret FROM thing"));
    t("it reads its own company's sibling tool (ctx.peer)", G(sib) && G(sib)[0].secret === "evil-sibling-row", sib.json);
    const cross = await call("/c/evil/m/tool/peer?m=tool&q=1");
    t("ctx.peer never names another company", G(cross) === "no peer" || refused(cross), cross.json);
    // even holding victim's live schema name, the read-only peer login cannot reach it
    const reach = await call("/c/evil/m/tool/sql?q=" + encodeURIComponent("SELECT 1 FROM " + victimLive + ".thing"));
    t("and victim's schema stays unreadable by name", refused(reach), reach.json);
  }
  // ---- the visitor's session
  {
    const who = (await call("/c/evil/m/tool/who", "manager")).json;
    t("the child sees the role and the person", who.role === "manager" && who.person === "Dana", who);
    t("but never the session cookie or an authorization header", !who.cookie && !who.authorization, who);
    t("nor the token that guards its own socket", !who.runner, who);
    t("its company is fixed by the platform, not by anything it reads", who.company === "evil", who);
    t("requireManager still works inside the child", (await call("/c/evil/m/tool/manager-only", "floor")).status === 403 && (await call("/c/evil/m/tool/manager-only", "manager")).status === 200);
    t("a body the platform parsed reaches it", JSON.stringify((await (async () => new Promise((ok) => { const req = http.request({ port, path: "/c/evil/m/tool/echo", method: "POST", headers: { "content-type": "application/json" } }, (res) => { let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => ok(JSON.parse(b))); }); req.end(JSON.stringify({ hi: 1 })); }))()).body) === JSON.stringify({ hi: 1 }));
  }
  // ---- headers a tool must not set on the platform's address
  {
    const raw = await new Promise((ok) => { http.get({ port, path: "/c/evil/m/tool/set-cookie" }, (res) => { let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => ok({ setCookie: res.headers["set-cookie"], csp: res.headers["content-security-policy"] })); }); });
    t("a Set-Cookie from module code never reaches the browser", !raw.setCookie, raw);
    t("and the platform's page policy is not the one the module tried to set", raw.csp !== "default-src *", raw);
  }
  // ---- the files
  if (asUser) {
    t("it cannot read the platform's own source", refused(await call("/c/evil/m/tool/read?p=" + encodeURIComponent(path.join(__dirname, "..", "..", "src", "db.js")))));
    const otherDir = path.join(process.env.MODULES_DIR, "victim", "tool", "versions", "1", "routes.js");
    t("it cannot read another company's module files", refused(await call("/c/evil/m/tool/read?p=" + encodeURIComponent(otherDir))));
    t("it cannot write into the app", refused(await call("/c/evil/m/tool/write?p=" + encodeURIComponent(path.join(__dirname, "..", "..", "evil.txt")))));
    t("it cannot start a shell", refused(await call("/c/evil/m/tool/shell")));
    t("it cannot start a worker thread", refused(await call("/c/evil/m/tool/worker")));
  }
  // ---- the private channel: it cannot ask the platform to act as another tool
  {
    const imp = await call("/c/evil/m/tool/impersonate?mod=victim");
    const val = G(imp);
    t("it cannot borrow victim's channel to read victim's agent doc", val === "no answer" || (val && val.error) || refused(imp), imp.json);
    t("its own agent doc is answered", typeof G(await call("/c/evil/m/tool/doc")) === "string");
  }
  // ---- a crash and a loop take the tool's own lane, not the instance
  {
    call("/c/evil/m/tool/exit").catch(() => {});
    await sleep(800);
    const back = await call("/c/evil/m/tool/sql?q=" + encodeURIComponent("SELECT 1 AS x"));
    t("after the tool calls process.exit, its lane comes back on its own", back.status === 200 || back.status === 503, back);
    t("and victim's tool never stopped", (await call("/c/victim/m/tool/api/state")).status === 200);
    const slow = await call("/c/evil/m/tool/loop");
    t("an endless loop is cut off with a 504, not left to hang", slow.status === 504, slow.status);
    await sleep(1200);
    t("victim still answers while evil looped", (await call("/c/victim/m/tool/api/state")).status === 200);
    await sleep(1500);
    const after = await call("/c/evil/m/tool/api/state").catch(() => ({ status: 0 }));
    t("evil's own tool recovers after the loop is ended", [200, 404, 503].includes(after.status), after.status);
  }

  srv.close();
  runner.stopAll();
  await dbroles.dropCompany("evil").catch(() => {});
  await dbroles.dropCompany("victim").catch(() => {});
  await pool.end().catch(() => {});
  fs.rmSync(base, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("ABORTED:", e); process.exit(1); });
