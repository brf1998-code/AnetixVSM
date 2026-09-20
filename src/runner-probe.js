// "Does routes.js load and hand back a router?" asked in a throwaway process
// (src/runner.js probe()), never in the platform's own. Until option C the
// platform's checks required the file into the platform process to find out,
// so a build whose routes.js looped for ever at load would have hung every
// company's floor, and whatever it did at load it did with the platform's
// environment in reach. Here it has an empty environment, no database, its
// own unprivileged user, and a time limit.
//
// argv[2]: JSON { dir, entry, slug, manifest, connections: { name: kind } }. Prints one JSON line.
"use strict";
const path = require("path");
const out = (o) => { process.stdout.write(JSON.stringify(o) + "\n"); process.exit(0); };
try {
  const spec = JSON.parse(process.argv[2] || "{}");
  const express = require("express");
  const entry = path.resolve(spec.dir, spec.entry || "routes.js");
  const make = require(entry);
  if (typeof make !== "function") out({ ok: false, error: "routes.js must export a function (ctx) => router" });
  const connections = {};
  for (const [name, kind] of Object.entries(spec.connections || {})) connections[name] = kind === "printer"
    ? { kind, status: async () => ({ kind, connected: false, printers: [] }), print: async () => ({ job_id: 0, queued: false, device: false, zpl: "" }), preview: async () => ({ zpl: "", png: null }) }
    : kind === "erp"
    ? { kind, status: async () => ({ kind, connected: false, queries: {} }), query: async () => { throw new Error("not connected yet"); } }
    : { kind, status: async () => ({ kind, connected: false }) };
  const r = make({ express, db: async () => ({ rows: [] }), requireManager: (_req, _res, next) => next(), peer: () => null, agentDoc: async () => "", ai: { models: [], modelFor: async () => null, chat: async () => ({ text: "" }) }, manifest: spec.manifest || {}, moduleName: spec.slug, company: "check", connections });
  if (!r || typeof r !== "function") out({ ok: false, error: "routes.js did not return an express router" });
  out({ ok: true });
} catch (e) { out({ ok: false, error: `routes.js fails to load: ${String((e && e.message) || e).slice(0, 400)}` }); }
