// The process a company's module code runs in (src/runner.js starts it; tenancy
// trade study option C). One per company and lane: "live" holds the code a
// manager approved, "staged" holds a preview nobody has approved yet.
//
// What this process has: the module files of ITS company (read only), a
// database login that reaches ITS company's module tables and nothing else
// (src/dbroles.js), a unix socket only the platform can reach, and a private
// channel to the platform for the things the platform lends a module
// (connections, the AI persona chat, an agent doc). What it does not have: the
// platform's environment (no database URL of the platform, no session secret,
// no API key, no passwords), the platform's files, another company's files,
// the visitor's cookies, or a way to start other programs.
//
// This file is deliberately self-contained (express, pg, node built-ins): it
// must never require the platform's own modules, which expect the platform's
// environment.
"use strict";
const http = require("http");
const path = require("path");
const express = require("express");
const { Pool } = require("pg");

// everything the platform handed over arrives in ONE variable and leaves the environment at once,
// so module code that looks at process.env finds nothing
const boot = JSON.parse(process.env.SOS_RUNNER_BOOT || "{}");
delete process.env.SOS_RUNNER_BOOT;
const { company, lane, sock, token, db: dbConfig, bodyLimit } = boot;

const pool = dbConfig ? new Pool({ ...dbConfig, max: Number(boot.poolMax || 6), idleTimeoutMillis: 30000 }) : null;
if (pool) pool.on("error", (e) => console.error(`[module process ${company}/${lane}] database: ${e.message}`));
const SCHEMA = /^[a-z0-9_]+$/;
// the same shape as the platform's scopedDb: a query function pinned to one schema
function scopedDb(schema, { readOnly = false } = {}) {
  if (!SCHEMA.test(schema)) throw new Error("bad schema name");
  return async function scopedQuery(text, params) {
    if (!pool) throw new Error("no database in this process");
    const client = await pool.connect();
    try {
      await client.query(`SET search_path TO ${schema}, public`);
      if (!readOnly) return await client.query(text, params);
      await client.query("BEGIN READ ONLY");
      try { const r = await client.query(text, params); await client.query("COMMIT"); return r; }
      catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
    } finally {
      await client.query("SET search_path TO public").catch(() => {});
      client.release();
    }
  };
}

// ---- the private channel to the platform -------------------------------------------------------
let seq = 0;
const waiting = new Map();
function ask(mod, name, args) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { waiting.delete(id); reject(new Error("the platform did not answer in time")); }, Number(boot.serviceTimeoutMs || 120000));
    waiting.set(id, { resolve, reject, timer });
    process.send({ op: "svc", id, mod, name, args });
  });
}

// ---- modules ------------------------------------------------------------------------------------
const mounted = new Map();   // mod -> { router, version }
let peers = new Set();       // the company's tools that are live right now (ctx.peer)

function services(mod, spec) {
  const connections = {};
  for (const [name, kind] of Object.entries(spec.connections || {})) {
    const status = () => ask(mod, "conn.status", { name });
    if (kind === "erp") connections[name] = { kind, status, query: (qname, params) => ask(mod, "conn.query", { name, qname, params: params || {} }) };
    else if (kind === "printer") connections[name] = {
      kind, status,
      print: (req, template, data) => ask(mod, "conn.print", { name, template, data: data || {}, device: (req && req.headers && req.headers["x-sos-device"]) || null }),
      preview: (template, data) => ask(mod, "conn.preview", { name, template, data: data || {} }),
    };
    else connections[name] = { kind, status };
  }
  return {
    manifest: spec.manifest || {},
    connections,
    peer(name) { return peers.has(name) && SCHEMA.test(spec.peerSchemas[name] || "") ? scopedDb(spec.peerSchemas[name], { readOnly: true }) : null; },
    agentDoc: (name) => ask(mod, "agentDoc", { name }),
    ai: { models: spec.models || [], modelFor: (role) => ask(mod, "ai.modelFor", { role }), chat: (args) => ask(mod, "ai.chat", args || {}) },
  };
}

function load(spec) {
  const entry = path.resolve(spec.dir, spec.entry || "routes.js");
  if (!entry.startsWith(path.resolve(spec.dir) + path.sep)) throw new Error("the entry file is outside the module");
  for (const k of Object.keys(require.cache)) if (k.startsWith(path.resolve(spec.dir) + path.sep)) delete require.cache[k];
  const make = require(entry);
  if (typeof make !== "function") throw new Error("routes.js must export a function (ctx) => router");
  const requireManager = (req, res, next) => (["manager", "admin"].includes(req.sosRole) ? next() : res.status(403).json({ error: "manager login required" }));
  if (spec.peers) peers = new Set(spec.peers);
  const router = make({ express, db: scopedDb(spec.schema), moduleName: spec.mod, company, requireManager, ...services(spec.mod, spec) });
  if (!router || typeof router !== "function") throw new Error("routes.js did not return an express router");
  mounted.set(spec.mod, { router, version: spec.version });
}

// ---- the socket the platform proxies to -----------------------------------------------------------
const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  // only the platform holds this process's token; anything else on the machine gets nothing
  if (req.headers["x-sos-runner"] !== token) return res.status(403).end();
  delete req.headers["x-sos-runner"];
  req.sosRole = req.headers["x-sos-role"] || null;
  req.sosCompany = company;
  req.sosPerson = req.headers["x-sos-person"] ? decodeURIComponent(req.headers["x-sos-person"]) : undefined;
  req.sosPersonId = req.headers["x-sos-person-id"] ? Number(req.headers["x-sos-person-id"]) : undefined;
  req.sosPersonRole = req.headers["x-sos-person-role"] || undefined;
  next();
});
app.get("/__ping", (_req, res) => res.json({ ok: true, mounted: [...mounted].map(([m, v]) => `${m}@${v.version}`) }));
// the platform's own body parser ran before a module's router when module code lived in its process; same here
app.use(express.json({ limit: bodyLimit || "1mb" }));
app.use("/:mod", (req, res, next) => {
  const m = mounted.get(req.params.mod);
  if (!m) return res.status(404).json({ error: "module not loaded in this process" });
  m.router(req, res, next);
});
app.use((err, _req, res, _next) => {   // eslint-disable-line no-unused-vars
  console.error(`[module process ${company}/${lane}] ${err && err.stack ? err.stack.split("\n").slice(0, 3).join(" | ") : err}`);
  if (!res.headersSent) res.status(err && err.status ? err.status : 500).json({ error: err && err.status && err.status < 500 ? err.message : "this tool hit a problem answering that" });
});

process.on("message", (m) => {
  if (!m || typeof m !== "object") return;
  if (m.op === "svc-reply") {
    const w = waiting.get(m.id); if (!w) return;
    waiting.delete(m.id); clearTimeout(w.timer);
    return m.error ? w.reject(Object.assign(new Error(m.error), m.status ? { status: m.status } : {})) : w.resolve(m.value);
  }
  const reply = (extra) => process.send({ op: "reply", id: m.id, ...extra });
  try {
    if (m.op === "load") { load(m.spec); return reply({ ok: true }); }
    if (m.op === "unload") { mounted.delete(m.mod); return reply({ ok: true }); }
    if (m.op === "peers") { peers = new Set(m.peers || []); return reply({ ok: true }); }
    reply({ ok: false, error: "unknown message" });
  } catch (e) { reply({ ok: false, error: String((e && e.message) || e).slice(0, 600) }); }
});
// the platform went away: so does this
process.on("disconnect", () => process.exit(0));
// a module's stray rejection or throw must not take the company's other tools down with it
process.on("unhandledRejection", (e) => console.error(`[module process ${company}/${lane}] unhandled: ${(e && e.message) || e}`));
process.on("uncaughtException", (e) => console.error(`[module process ${company}/${lane}] uncaught: ${(e && e.message) || e}`));

const server = http.createServer(app);
server.keepAliveTimeout = 60000;
server.listen(sock, () => process.send({ op: "ready", pid: process.pid, uid: process.getuid ? process.getuid() : null }));
