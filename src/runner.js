// Module code in a process of its own. Tenancy trade study of 2026-09-17,
// option C, build order item 9 of the 2026-09-18 product review.
//
// What the review found and the module gate (src/modulegate.js) could only
// narrow: routes.js is written by a build agent from words typed on a factory
// floor, and the platform `require`d it into ITS OWN process, where the
// database URL, the session secret, the API key, every company's schema and
// every company's files are one expression away. A text check of the source
// stops the careless build and the lazily steered one; it is not a wall.
//
// The wall: each company gets two child processes (src/runner-child.js),
//   live    the code a manager approved
//   staged  a preview nobody has approved yet (exists only while one is up)
// each started
//   - as an unprivileged user of its own (one per company and lane; the two of
//     a company share a group, and the company's module folder is closed to
//     every other group), when the platform runs as root as it does on Railway;
//   - with an environment of one variable, which the child deletes as it reads;
//   - under Node's permission flags where this Node has them: files readable
//     only under the company's module folder and the app's node_modules, no
//     child processes, no workers, no native add-ons;
//   - with a database login of its own (src/dbroles.js) that reaches the rows
//     of its company's module tables and nothing else. The staged login can
//     read the floor's tables and cannot write them, so unapproved code cannot
//     change a row on the floor.
// The platform keeps everything else in its own process: sign-in and the
// company guard, the browser policy, serving the screens, connections and
// their secrets, AI calls and the key, the record. A request under a module
// mount is checked by all of that first and then handed to the child over a
// unix socket in a folder only that child's user can enter, with the visitor's
// role and name as headers and WITHOUT the visitor's cookies; the child's
// answer comes back under the platform's headers, minus any Set-Cookie. What
// the platform lends a module (ctx.connections, ctx.ai, ctx.agentDoc) is asked
// for over the fork's private channel, and the platform answers for the
// company that channel belongs to, whatever the child claims.
//
// Also gained: a module that throws, leaks or loops for ever takes down one
// company's lane, not every company's floor; a request has a time limit; the
// "does routes.js load" check of a new module runs in a throwaway process with
// a time limit instead of inside the platform (probe()).
//
// SOS_MODULE_RUNNER: auto (default) | process | inline.
//   auto     own process when the instance can do it (selfTest() finds out at
//            boot and says so in the log and on /admin); otherwise module code
//            runs the old way, inside the platform, and /admin says THAT in red.
//            The floor never goes dark because of this file.
//   process  own process or nothing: a module that cannot be isolated is not
//            mounted. For an instance that holds a second company's real data.
//   inline   the old way, on purpose (local work without root or Postgres rights).
//
// The unit of isolation is company and lane. Two tools of one company share a
// process and a login on purpose: they already read each other through
// ctx.peer, and one manager approves both.
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { fork, spawnSync } = require("child_process");
const { q, logEvent } = require("./db");
const dbroles = require("./dbroles");

const MODE = ["auto", "process", "inline"].includes(String(process.env.SOS_MODULE_RUNNER || "auto").toLowerCase()) ? String(process.env.SOS_MODULE_RUNNER || "auto").toLowerCase() : "auto";
const REQUEST_TIMEOUT_MS = Number(process.env.SOS_MODULE_TIMEOUT_MS || 30000);
const LOAD_TIMEOUT_MS = Number(process.env.SOS_MODULE_LOAD_TIMEOUT_MS || 10000);
const CHILD = path.join(__dirname, "runner-child.js");
const PROBE = path.join(__dirname, "runner-probe.js");
const APP_MODULES = path.join(__dirname, "..", "node_modules");
const RUN_DIR = path.join(os.tmpdir(), `sos-run-${process.pid}`);
const HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS platform.runner_ids (
  company TEXT PRIMARY KEY,
  base    INTEGER NOT NULL UNIQUE          -- live runs as user base, staged as base+1, both in group base
);`;
const state = {
  mode: MODE, effective: MODE === "inline" ? "inline" : null,
  roles: { ok: null, reason: null }, user: { ok: null, reason: null }, flags: { ok: null, reason: null },
  inline_modules: [],   // auto mode: tools kept in the platform's process because they failed in their own
};
const children = new Map();   // "company/lane" -> child record
const key = (company, lane) => `${company}/${lane}`;
const isRoot = () => typeof process.getuid === "function" && process.getuid() === 0;

async function init() { await q(SCHEMA); }
function enabled() { return state.effective === "process"; }

// ---- pure ------------------------------------------------------------------------------------------
// What the child is told about the visitor. Never the cookies: module code has no business with a session.
function identityHeaders(req, device) {
  const h = { "x-sos-role": String(req.sosRole || "") };
  if (req.sosPerson) h["x-sos-person"] = encodeURIComponent(String(req.sosPerson).slice(0, 120));
  if (req.sosPersonId) h["x-sos-person-id"] = String(req.sosPersonId);
  if (req.sosPersonRole) h["x-sos-person-role"] = String(req.sosPersonRole);
  if (device) h["x-sos-device"] = device;
  return h;
}
function forwardHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) {
    const n = k.toLowerCase();
    if (HOP.has(n) || n === "cookie" || n === "authorization" || n === "host" || n === "content-length" || n.startsWith("x-sos-")) continue;
    out[n] = v;
  }
  return out;
}
function answerHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) {
    const n = k.toLowerCase();
    if (HOP.has(n) || n === "set-cookie") continue;   // a tool does not set cookies on the platform's address
    out[n] = v;
  }
  return out;
}
function permissionFlags(readable, writable) {
  const has = (f) => process.allowedNodeEnvironmentFlags.has(f);
  const main = has("--permission") ? "--permission" : has("--experimental-permission") ? "--experimental-permission" : null;
  if (!main) return null;
  const flags = [main, ...readable.map((p) => `--allow-fs-read=${p}`), ...writable.map((p) => `--allow-fs-write=${p}`)];
  if (has("--allow-net")) flags.push("--allow-net");   // newer Node closes the network under the permission model too; the child needs its database and its socket
  return flags;
}
const deviceOf = (req) => { const m = /(?:^|;\s*)sos_device=([a-f0-9]{24})(?:;|$)/.exec(String((req.headers && req.headers.cookie) || "")); return m ? m[1] : null; };

// ---- users ------------------------------------------------------------------------------------------
async function idsFor(company) {
  let row = (await q("SELECT base FROM platform.runner_ids WHERE company=$1", [company])).rows[0];
  for (let i = 0; !row && i < 5; i++) {
    try { row = (await q("INSERT INTO platform.runner_ids (company, base) SELECT $1, COALESCE(MAX(base), 19990) + 10 FROM platform.runner_ids RETURNING base", [company])).rows[0]; }
    catch (e) { if (e.code !== "23505") throw e; row = (await q("SELECT base FROM platform.runner_ids WHERE company=$1", [company])).rows[0]; }
  }
  // live runs as base, staged as base + 1, the test floor (docs/TEST-ENVIRONMENT.md) as base + 2; the ids step by 10
  return { gid: row.base, live: row.base, staged: row.base + 1, test: row.base + 2 };
}
const uidOf = (ids, lane) => (lane === "staged" ? ids.staged : lane === dbroles.TEST ? ids.test : ids.live);
// The user a company's lane runs as, with the company's module folder closed to everyone else. null when this
// instance cannot run a process as another user.
async function userFor(company, lane) {
  if (!isRoot() || state.user.ok !== true) return null;
  const ids = await idsFor(company);
  closeFolder(path.join(require("./registry").MODULES_DIR, company), ids.gid);
  return { uid: uidOf(ids, lane), gid: ids.gid };
}
// Close the company's module folder to every other company's user.
function closeFolder(dir, gid) {
  fs.mkdirSync(dir, { recursive: true });
  if (!isRoot() || !state.user.ok) return;
  try { fs.chownSync(dir, 0, gid); fs.chmodSync(dir, 0o750); } catch (e) { console.error(`[runner] could not close ${dir}: ${e.message}`); }
}

// ---- children ---------------------------------------------------------------------------------------
async function start(company, lane) {
  const k = key(company, lane);
  const had = children.get(k);
  if (had && had.proc && !had.dead) return had.ready;
  const registry = require("./registry");
  const ids = await idsFor(company);
  const uid = uidOf(ids, lane);
  await dbroles.ensureCompany(company);
  if (lane === dbroles.TEST) await dbroles.ensureTestRole(company);
  const companyDir = path.join(registry.MODULES_DIR, company);
  closeFolder(companyDir, ids.gid);
  const sockDir = path.join(RUN_DIR, `${company}-${lane}`);
  fs.rmSync(sockDir, { recursive: true, force: true });
  fs.mkdirSync(sockDir, { recursive: true });
  const drop = isRoot() && state.user.ok;
  if (drop) { fs.chmodSync(RUN_DIR, 0o711); fs.chownSync(sockDir, uid, ids.gid); fs.chmodSync(sockDir, 0o700); }
  const sock = path.join(sockDir, "s");
  const token = crypto.randomBytes(24).toString("hex");
  const flags = state.flags.ok ? permissionFlags([companyDir, APP_MODULES, CHILD], [sockDir]) : null;
  const boot = { company, lane, sock, token, db: dbroles.connectionFor(company, lane), bodyLimit: "1mb", serviceTimeoutMs: 120000 };
  const rec = had || { company, lane, loaded: new Map(), restarts: 0, exits: [] };
  Object.assign(rec, { sock, token, uid: drop ? uid : null, pending: new Map(), seq: 0, dead: false, started_at: Date.now(), flags: Boolean(flags) });
  rec.proc = fork(CHILD, [], {
    ...(drop ? { uid, gid: ids.gid } : {}),
    cwd: sockDir, execArgv: flags || [],
    env: { PATH: process.env.PATH || "", NODE_ENV: process.env.NODE_ENV || "", TZ: process.env.TZ || "", SOS_RUNNER_BOOT: JSON.stringify(boot) },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const say = (stream, fn) => stream.on("data", (b) => String(b).split("\n").filter(Boolean).forEach((l) => fn(l.startsWith("[module process") ? l : `[module process ${company}/${lane}] ${l}`)));
  say(rec.proc.stdout, console.log); say(rec.proc.stderr, console.error);
  rec.ready = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("the module process did not start in time")), 15000);
    rec.proc.once("error", (e) => { clearTimeout(t); reject(e); });
    rec.onReady = () => { clearTimeout(t); resolve(rec); };
  });
  rec.ready.catch(() => {});
  rec.proc.on("message", (m) => onMessage(rec, m));
  rec.proc.on("exit", (code, signal) => onExit(rec, code, signal));
  children.set(k, rec);
  return rec.ready;
}

function onMessage(rec, m) {
  if (!m || typeof m !== "object") return;
  if (m.op === "ready") return rec.onReady && rec.onReady();
  if (m.op === "reply") { const w = rec.pending.get(m.id); if (!w) return; rec.pending.delete(m.id); clearTimeout(w.timer); return m.ok ? w.resolve(m) : w.reject(new Error(m.error || "the module process refused")); }
  if (m.op === "svc") return serve(rec, m).catch((e) => console.error(`[runner] ${rec.company}/${rec.lane} service ${m.name}: ${e.message}`));
}
function send(rec, msg, timeoutMs) {
  return new Promise((resolve, reject) => {
    const id = ++rec.seq;
    const timer = setTimeout(() => { rec.pending.delete(id); reject(Object.assign(new Error("timeout"), { timeout: true })); }, timeoutMs || LOAD_TIMEOUT_MS);
    rec.pending.set(id, { resolve, reject, timer });
    try { rec.proc.send({ ...msg, id }); } catch (e) { clearTimeout(timer); rec.pending.delete(id); reject(e); }
  });
}
function onExit(rec, code, signal) {
  rec.dead = true;
  for (const w of rec.pending.values()) { clearTimeout(w.timer); w.reject(new Error("the module process stopped")); }
  rec.pending.clear();
  if (rec.stopping) return;
  const now = Date.now();
  rec.exits = rec.exits.filter((t) => now - t < 60000).concat(now);
  rec.restarts++;
  const wait = rec.exits.length >= 5 ? 30000 : 250;
  console.error(`[runner] the ${rec.lane} process of ${rec.company} stopped (${signal || `exit ${code}`}); starting it again${wait > 1000 ? " in 30 s (it keeps stopping)" : ""}`);
  setTimeout(() => restart(rec).catch((e) => console.error(`[runner] could not restart ${rec.company}/${rec.lane}: ${e.message}`)), wait);
}
async function restart(rec) {
  if (rec.stopping || !rec.loaded.size) { children.delete(key(rec.company, rec.lane)); return; }
  const specs = [...rec.loaded.values()];
  await start(rec.company, rec.lane);
  for (const s of specs) {
    try { await send(rec, { op: "load", spec: s.spec }); }
    catch (e) { console.error(`[runner] ${rec.company}/${s.spec.mod} did not load after a restart: ${e.message}`); }
  }
}
function kill(rec) { try { rec.proc.kill("SIGKILL"); } catch (e) { /* already gone */ } }

// ---- what the platform lends, asked for by the child ------------------------------------------------
async function serve(rec, m) {
  const reply = (extra) => { try { rec.proc.send({ op: "svc-reply", id: m.id, ...extra }); } catch (e) { /* gone */ } };
  const entry = rec.loaded.get(m.mod);
  // the channel belongs to one company; a tool is only ever answered as itself
  if (!entry) return reply({ error: "that tool is not loaded in this process" });
  const svc = entry.services, a = m.args || {};
  try {
    const conn = (name) => { const c = svc.connections[name]; if (!c) throw new Error(`no connection named ${name}`); return c; };
    let value;
    if (m.name === "agentDoc") value = await svc.agentDoc(String(a.name || ""));
    else if (m.name === "ai.modelFor") value = await svc.ai.modelFor(a.role);
    else if (m.name === "ai.chat") value = await svc.ai.chat(a);
    else if (m.name === "conn.status") value = await conn(a.name).status();
    else if (m.name === "conn.query") value = await conn(a.name).query(a.qname, a.params);
    else if (m.name === "conn.preview") value = await conn(a.name).preview(a.template, a.data);
    else if (m.name === "conn.web.start") value = await conn(a.name).start(a.question, a.opts);
    else if (m.name === "conn.web.result") value = await conn(a.name).result(a.id);
    else if (m.name === "conn.print") value = await conn(a.name).print({ headers: { cookie: /^[a-f0-9]{24}$/.test(String(a.device || "")) ? `sos_device=${a.device}` : "" } }, a.template, a.data);
    else throw new Error("the platform lends no such thing");
    reply({ value: value === undefined ? null : JSON.parse(JSON.stringify(value)) });
  } catch (e) { reply({ error: String((e && e.message) || e).slice(0, 500), status: e && e.status }); }
}

// ---- load, unload, proxy ----------------------------------------------------------------------------
// What a tool's ctx.peer reaches, per lane: on the live and staged lanes the FLOOR's tables of the tools that are
// live; on the test floor the TEST tables of the tools that are up there (one world: a test tool reads the test
// copy of its sibling, never the floor). The live and staged children never learn a test schema.
async function peersOf(company, lane, rec) {
  const migrate = require("./migrate");
  const rows = (await q("SELECT name, live_version FROM platform.modules WHERE company=$1", [company])).rows;
  const peerSchemas = {};
  if (lane === dbroles.TEST) {
    for (const r of rows) peerSchemas[r.name] = migrate.testSchema(company, r.name).toLowerCase();
    return { peerSchemas, peers: rec ? [...rec.loaded.keys()] : [] };
  }
  for (const r of rows) peerSchemas[r.name] = migrate.liveSchema(company, r.name).toLowerCase();
  return { peerSchemas, peers: rows.filter((r) => r.live_version).map((r) => r.name) };
}
// Put one module version into the company's process for that lane. Throws what `require` threw.
async function load({ company, lane, mod, version, schema, dir, manifest }) {
  const registry = require("./registry"), agent = require("./agent");
  const rec = await start(company, lane);
  const { peerSchemas, peers } = await peersOf(company, lane, rec);
  if ((lane === "live" || lane === dbroles.TEST) && !peers.includes(mod)) peers.push(mod);
  const connections = {}; for (const [n, c] of Object.entries((manifest && manifest.connections) || {})) if (c && c.kind) connections[n] = c.kind;
  const spec = { mod, version, dir, entry: (manifest && manifest.entry) || "routes.js", schema: String(schema).toLowerCase(), manifest, connections, peerSchemas, peers, models: registry.LENT_MODELS };
  try { await send(rec, { op: "load", spec }); }
  catch (e) {
    if (e.timeout) { kill(rec); throw new Error(`routes.js did not finish loading within ${Math.round(LOAD_TIMEOUT_MS / 1000)} seconds`); }
    throw new Error(`routes.js fails to load: ${e.message}`);
  }
  rec.loaded.set(mod, { spec, services: registry.moduleServices(company, mod, manifest, version, lane) });
  // the company's other lane and tools hear which tools are live now (the test child hears only its own world)
  for (const l of lane === dbroles.TEST ? [dbroles.TEST] : dbroles.LANES) { const other = children.get(key(company, l)); if (other && !other.dead) send(other, { op: "peers", peers }, 5000).catch(() => {}); }
  return rec;
}
async function unload(company, lane, mod) {
  const rec = children.get(key(company, lane));
  if (!rec) return;
  rec.loaded.delete(mod);
  if (!rec.dead) await send(rec, { op: "unload", mod }, 5000).catch(() => {});
  if (!rec.loaded.size) stop(company, lane);
  else if (lane === dbroles.TEST && !rec.dead) send(rec, { op: "peers", peers: [...rec.loaded.keys()] }, 5000).catch(() => {});
}
function stop(company, lane) {
  for (const l of lane ? [lane] : dbroles.ALL_LANES) {
    const rec = children.get(key(company, l));
    if (!rec) continue;
    rec.stopping = true; children.delete(key(company, l));
    try { rec.proc.kill("SIGTERM"); } catch (e) { /* gone */ }
    setTimeout(() => kill(rec), 2000).unref();
    fs.rmSync(path.dirname(rec.sock), { recursive: true, force: true });
  }
}
function stopAll() { for (const rec of [...children.values()]) stop(rec.company, rec.lane); fs.rmSync(RUN_DIR, { recursive: true, force: true }); }
process.on("exit", () => { for (const rec of children.values()) kill(rec); try { fs.rmSync(RUN_DIR, { recursive: true, force: true }); } catch (e) { /* nothing to clean */ } });

const plain = (res, status, error, extra) => { if (res.headersSent) return res.end(); res.status(status).set(extra || {}).json({ error }); };
// One call to a child over its socket. Resolves { status, headers, body (Buffer) }.
function call(rec, { method = "GET", url, headers = {}, body, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const r = http.request({ socketPath: rec.sock, method, path: url, headers: { ...headers, "x-sos-runner": rec.token }, timeout: timeoutMs || REQUEST_TIMEOUT_MS }, (pres) => {
      const chunks = []; pres.on("data", (c) => chunks.push(c)); pres.on("end", () => resolve({ status: pres.statusCode, headers: pres.headers, body: Buffer.concat(chunks) })); pres.on("error", reject);
    });
    r.on("timeout", () => r.destroy(Object.assign(new Error("timeout"), { timeout: true })));
    r.on("error", reject);
    r.end(body);
  });
}
// A request answered 'too slow': is the process still there at all? If not, it is stuck in a loop; end it (it comes back by itself).
async function checkAlive(rec) {
  try { await call(rec, { url: "/__ping", timeoutMs: 2000 }); }
  catch (e) { console.error(`[runner] the ${rec.lane} process of ${rec.company} does not answer; ending it`); restartHung(rec, "it stopped answering at all"); }
}
// A process that still answers its ping while its requests keep running out of time (a promise that never settles, a
// database connection it never gave back) was left alone until 2026-09-27: every request to that company's tools
// timed out until the next push (the launch audit 1.16). Each timeout is logged and an event. The process is restarted
// (it comes back by itself, onExit) and Anetix's phones hear about it when, inside HANG_WINDOW_MS, HANG_LIMIT requests
// on two or more different routes ran out of time (the process is stuck, not one slow report), or HANG_LIMIT + 2 on
// the same one (whatever that route waits on is not coming back).
const HANG_LIMIT = Math.max(2, Number(process.env.SOS_MODULE_HANG_LIMIT || 3));
const HANG_WINDOW_MS = 5 * 60 * 1000;
function timedOut(rec, mod, req) {
  const now = Date.now();
  const where = `${req.method} /${mod}${String(req.url || "").split("?")[0].replace(/\/\d+(?=\/|$)/g, "/:n").slice(0, 100)}`;
  rec.timeouts = (rec.timeouts || []).filter((x) => now - x.at < HANG_WINDOW_MS).concat({ at: now, where });
  console.error(`[runner] ${rec.company} ${rec.lane}: ${where} took longer than ${Math.round(REQUEST_TIMEOUT_MS / 1000)} s (${rec.timeouts.length} in ${HANG_WINDOW_MS / 60000} min)`);
  logEvent("tool_timeout", `${rec.company}/${mod}`, { lane: rec.lane, where, count: rec.timeouts.length }).catch(() => {});
  const routes = new Set(rec.timeouts.map((x) => x.where)).size;
  if (rec.timeouts.length >= HANG_LIMIT && (routes >= 2 || rec.timeouts.length >= HANG_LIMIT + 2)) restartHung(rec, `${rec.timeouts.length} requests on ${routes} route${routes === 1 ? "" : "s"} ran out of time in ${HANG_WINDOW_MS / 60000} minutes`);
  else checkAlive(rec);
}
function restartHung(rec, why) {
  if (rec.dead || rec.stopping) return;
  rec.timeouts = [];
  console.error(`[runner] restarting the ${rec.lane} process of ${rec.company}: ${why}`);
  logEvent("tool_restarted", `${rec.company}/${rec.lane}`, { why, tools: [...rec.loaded.keys()] }).catch(() => {});
  if (rec.lane !== "staged") require("./notify").notifyEvery(`tool_restart:${rec.company}/${rec.lane}`, 30 * 60e3, "A tool process was restarted",
    `The ${rec.lane === "live" ? "live" : rec.lane} tools of ${rec.company} (${[...rec.loaded.keys()].join(", ") || "none loaded"}) were restarted: ${why}. Worth a look at the Railway log for which request hangs.`, { priority: 4, tags: ["hourglass"] });
  kill(rec);
}
// The request has already passed sign-in, the company guard and the page policy (registry.attach).
function proxy(req, res, { company, lane, mod }) {
  const rec = children.get(key(company, lane));
  if (!rec || rec.dead || !rec.loaded.has(mod)) return plain(res, 503, "This tool is starting up again. Try again in a moment.", { "Retry-After": "2" });
  const headers = { ...forwardHeaders(req.headers), ...identityHeaders(req, deviceOf(req)), host: String(req.headers.host || "localhost"), "x-sos-runner": rec.token };
  // the platform's own body parser has usually read a JSON body already; hand on what it read
  const parsed = req._body === true && req.body !== undefined ? Buffer.from(JSON.stringify(req.body)) : null;
  if (parsed) { headers["content-type"] = "application/json"; headers["content-length"] = String(parsed.length); }
  else if (req.headers["content-length"]) headers["content-length"] = req.headers["content-length"];
  const out = http.request({ socketPath: rec.sock, method: req.method, path: `/${mod}${req.url}`, headers, timeout: REQUEST_TIMEOUT_MS }, (pres) => {
    res.status(pres.statusCode);
    for (const [k, v] of Object.entries(answerHeaders(pres.headers))) res.setHeader(k, v);
    pres.pipe(res);
    pres.on("error", () => res.end());
  });
  out.on("timeout", () => { out.destroy(Object.assign(new Error("timeout"), { timeout: true })); });
  out.on("error", (e) => {
    if (e.timeout) { plain(res, 504, "This tool took too long to answer."); timedOut(rec, mod, req); }
    else plain(res, 503, "This tool is starting up again. Try again in a moment.", { "Retry-After": "2" });
  });
  res.on("close", () => { if (!res.writableEnded) out.destroy(); });
  if (parsed) out.end(parsed); else req.pipe(out);
}

// ---- the throwaway process for "does routes.js load" -------------------------------------------------
// Synchronous on purpose (modulebuild.validateModule is): { ok, error }.
// run: { uid, gid } from userFor(company, "staged"): the unapproved code of a company is checked as that company's
// staged user, who may enter the company's module folder. Without it the check still has no environment, a time
// limit and (where this Node has them) the permission flags.
function probe({ dir, entry, slug, manifest, run }) {
  const connections = {}; for (const [n, c] of Object.entries((manifest && manifest.connections) || {})) if (c && c.kind) connections[n] = c.kind;
  const drop = isRoot() && state.user.ok === true && run && run.uid;
  const flags = state.flags.ok === false ? null : permissionFlags([dir, APP_MODULES, PROBE], []);
  const r = spawnSync(process.execPath, [...(flags || []), PROBE, JSON.stringify({ dir, entry, slug, manifest, connections })], {
    ...(drop ? { uid: run.uid, gid: run.gid } : {}), cwd: os.tmpdir(), env: { PATH: process.env.PATH || "" }, timeout: LOAD_TIMEOUT_MS, encoding: "utf8", maxBuffer: 1024 * 1024,
  });
  if (r.error && r.error.code === "ETIMEDOUT") return { ok: false, error: `routes.js did not finish loading within ${Math.round(LOAD_TIMEOUT_MS / 1000)} seconds (does it loop or wait at the top of the file?)` };
  const line = String(r.stdout || "").trim().split("\n").filter(Boolean).pop();
  try { return JSON.parse(line); }
  catch (e) { return { ok: false, error: `routes.js fails to load: ${String(r.stderr || (r.error && r.error.message) || "the check process stopped").trim().split("\n").slice(-3).join(" ").slice(0, 400)}` }; }
}

// ---- can this instance do it? ------------------------------------------------------------------------
async function selfTest() {
  if (MODE === "inline") { console.log("[runner] SOS_MODULE_RUNNER=inline: module code runs inside the platform's own process, as it did before option C"); return state; }
  Object.assign(state.roles, await dbroles.selfTest());
  // a process of its own user
  if (!isRoot()) Object.assign(state.user, { ok: false, reason: "the platform is not running as root, so it cannot start a process as another user" });
  else {
    const express = require.resolve("express");
    // as another user: can it run at all, and can it read what a module process needs (express, and the two files it is started from)?
    const r = spawnSync(process.execPath, ["-e", `require(${JSON.stringify(express)}); for (const f of ${JSON.stringify([CHILD, PROBE])}) require("fs").readFileSync(f); process.stdout.write(String(process.getuid()))`], { uid: 19999, gid: 19999, cwd: os.tmpdir(), env: { PATH: process.env.PATH || "" }, timeout: 15000, encoding: "utf8" });
    if (r.status === 0 && String(r.stdout).trim() === "19999") Object.assign(state.user, { ok: true, reason: null });
    else Object.assign(state.user, { ok: false, reason: r.error ? `this container does not let a process run as another user (${r.error.message})` : `another user cannot read the app's files (${String(r.stderr || "").trim().split("\n").pop().slice(0, 160)})` });
  }
  // Node's permission flags
  const flags = permissionFlags([APP_MODULES], []);
  if (!flags) Object.assign(state.flags, { ok: false, reason: `Node ${process.version} has no permission flags` });
  else {
    const express = require.resolve("express");
    const r = spawnSync(process.execPath, [...flags, "-e", `require(${JSON.stringify(express)}); let shut = false; try { require("child_process").execSync("true"); } catch (e) { shut = true; } process.stdout.write(shut ? "shut" : "open")`], { cwd: os.tmpdir(), env: { PATH: process.env.PATH || "" }, timeout: 15000, encoding: "utf8" });
    Object.assign(state.flags, String(r.stdout).trim() === "shut" ? { ok: true, reason: null } : { ok: false, reason: `Node's permission flags did not hold in a trial run (${String(r.stderr || r.stdout || "").trim().split("\n").pop().slice(0, 160)})` });
  }
  state.effective = state.roles.ok ? "process" : MODE === "process" ? "process" : "inline";
  if (state.roles.ok) console.log(`[runner] module code runs in a process of its own per company, with a database login that reaches only that company's tables; ${state.user.ok ? "as its own user" : `NOT as its own user: ${state.user.reason}`}; ${state.flags.ok ? "Node permission flags on" : `Node permission flags OFF: ${state.flags.reason}`}`);
  else if (MODE === "process") console.error(`[runner] SOS_MODULE_RUNNER=process and this instance cannot isolate module code: ${state.roles.reason}. NO MODULE WILL BE MOUNTED until that is fixed or the setting is changed`);
  else console.error(`[runner] module code is running INSIDE the platform's own process, the old way: ${state.roles.reason}. Do not put a second company's real data on this instance until this line reads differently`);
  return state;
}

// for /admin: what is running, as which user, how big
function status() {
  const rss = (pid) => { try { return Math.round(Number(/VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${pid}/status`, "utf8"))[1]) / 1024); } catch (e) { return null; } };
  return {
    ...state,
    processes: [...children.values()].map((r) => ({ company: r.company, lane: r.lane, pid: r.proc && r.proc.pid, user: r.uid, own_user: r.uid != null, flags: r.flags, up: !r.dead, restarts: r.restarts, started_at: new Date(r.started_at).toISOString(), memory_mb: r.proc && !r.dead ? rss(r.proc.pid) : null, modules: [...r.loaded.keys()] })),
  };
}
async function deleteCompany(company) {
  stop(company);
  await q("DELETE FROM platform.runner_ids WHERE company=$1", [company]).catch(() => {});
  await dbroles.dropCompany(company);
}

module.exports = { init, selfTest, enabled, state, MODE, userFor, load, unload, stop, stopAll, proxy, call, probe, status, deleteCompany, timedOut, HANG_LIMIT, identityHeaders, forwardHeaders, answerHeaders, permissionFlags, children, REQUEST_TIMEOUT_MS, LOAD_TIMEOUT_MS };
