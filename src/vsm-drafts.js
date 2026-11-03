// The agent board, A3 (docs/AGENTS.md, decisions 7 to 9, 2026-11-02): drafts across tools. An agent's review may draft a
// record for one of the tools on its own boxes or the boxes next to it on the map (a material request, a draft MO, a PO
// request). The draft waits; a person makes it on that tool's own screen, where the tool's own logic runs, or declines it.
// Nothing here writes a tool's record: the tool does, when a person acts.
//
// How a tool takes drafts (its opt-in, one normal Kaizen change; MODULE-CONTRACT.md "Drafts from agents"):
//   module.json "drafts": { "<kind>": { "label": "a material request for the stockroom", "screen": "/stock",
//                           "fields": { "<name>": { "type": "text|integer|number|date|boolean", "required": true,
//                                                   "choices": [...], "min": 1, "max": 50, "label": "..." } } } }
//   routes.js, with what the platform lends on ctx.drafts:
//     list(req)                 -> { can_act, drafts: [{ id, kind, label, fields, why, agent, state, created_at }] }
//     claim(req, id)            -> { id, kind, fields }: the draft is held for this person for two minutes
//     finish(req, id, { ref })  -> done: the tool made it (ref: the new record's number or id, shown on the board)
//     decline(req, id, { note })
//   A claim that is never finished lapses back to waiting, so a tool that fails between the two leaves nothing half done.
//
// Who acts (decision 9): a manager or an admin always; the floor (people signed in by name and PIN) only on a tool whose
// drafts a manager opened to the floor (off by default). The person is the platform's, from the request in flight (the
// tool's process is handed a ticket per request, src/runner.js; module code cannot claim a role it was not given).
// Only the floor's version of a tool takes drafts; a preview or the test floor lists them but cannot act.
const express = require("express");
const { q } = require("./db");
const record = require("./record");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS platform.vsm_record_drafts (
  id          SERIAL PRIMARY KEY,
  company     TEXT NOT NULL,
  module      TEXT NOT NULL,
  kind        TEXT NOT NULL,
  fields      JSONB NOT NULL DEFAULT '{}'::jsonb,
  why         TEXT,
  agent_id    INTEGER,
  agent_name  TEXT,
  message_id  INTEGER,
  thread_id   INTEGER,
  state       TEXT NOT NULL DEFAULT 'waiting',
  held_by     TEXT,
  held_until  TIMESTAMPTZ,
  ref         TEXT,
  note        TEXT,
  decided_by  TEXT,
  decided_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vsm_record_drafts_tool ON platform.vsm_record_drafts (company, module, state);
CREATE TABLE IF NOT EXISTS platform.vsm_tool_settings (
  company      TEXT NOT NULL,
  module       TEXT NOT NULL,
  floor_drafts BOOLEAN NOT NULL DEFAULT false,
  updated_by   TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company, module)
);`;
const TABLES = ["vsm_record_drafts", "vsm_tool_settings"];

const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : d; };
const DRAFT_DAYS = () => num(process.env.SOS_DRAFT_DAYS, 7);
const WAITING_MAX = () => num(process.env.SOS_DRAFTS_WAITING, 10);
const HOLD_SEC = 120;
const OPEN = ["waiting", "taking"];
const TYPES = ["text", "integer", "number", "date", "boolean"];
const KIND = /^[a-z][a-z0-9_]{1,39}$/, FIELD = /^[a-z][a-z0-9_]{0,39}$/;

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const txt = (v, n) => String(v == null ? "" : v).replace(/\r\n?/g, "\n").replace(/\u0000/g, "").trim().slice(0, n);
const line = (v, n) => txt(v, n).replace(/\s*\n+\s*/g, " ");

async function init() { await q(SCHEMA); }

// ---- a tool's declaration, checked (the module gate runs this on every build) -------------------------------------
// -> { kinds: { kind: { label, screen, fields } }, errors: [words] }. Pure.
function checkDeclaration(decl) {
  const errors = [], kinds = {};
  if (decl === undefined || decl === null) return { kinds, errors };
  if (typeof decl !== "object" || Array.isArray(decl)) return { kinds, errors: ["\"drafts\" is an object of kinds: { \"<kind>\": { \"label\", \"fields\" } }"] };
  const names = Object.keys(decl);
  if (names.length > 8) errors.push("a tool takes at most 8 kinds of draft");
  for (const k of names.slice(0, 8)) {
    const d = decl[k];
    if (!KIND.test(k)) { errors.push(`draft kind "${line(k, 40)}": a short name in lower case letters, digits and _`); continue; }
    if (!d || typeof d !== "object") { errors.push(`draft kind ${k}: an object with a label and fields`); continue; }
    const label = line(d.label, 120);
    if (!label) errors.push(`draft kind ${k}: a label, what it is in plain words ("a material request for the stockroom")`);
    const screen = d.screen == null ? null : String(d.screen);
    if (screen !== null && !/^\/[A-Za-z0-9/_:-]{0,79}$/.test(screen)) errors.push(`draft kind ${k}: screen is the route of the page where its drafts are made, like "/stock"`);
    const fields = d.fields && typeof d.fields === "object" && !Array.isArray(d.fields) ? d.fields : null;
    if (!fields || !Object.keys(fields).length) { errors.push(`draft kind ${k}: fields, at least one`); continue; }
    if (Object.keys(fields).length > 20) errors.push(`draft kind ${k}: at most 20 fields`);
    const out = {};
    for (const [f, spec] of Object.entries(fields).slice(0, 20)) {
      if (!FIELD.test(f)) { errors.push(`draft kind ${k}: field "${line(f, 40)}" is a short name in lower case`); continue; }
      const s = spec && typeof spec === "object" ? spec : {};
      const type = String(s.type || "");
      if (!TYPES.includes(type)) { errors.push(`draft kind ${k}: field ${f} has a type, one of ${TYPES.join(", ")}`); continue; }
      const o = { type, required: s.required === true, label: line(s.label, 80) || f.replace(/_/g, " ") };
      if (s.choices !== undefined) {
        if (type !== "text" || !Array.isArray(s.choices) || !s.choices.length || s.choices.length > 50) errors.push(`draft kind ${k}: field ${f}'s choices are a list of up to 50 words, on a text field`);
        else o.choices = s.choices.map((c) => line(c, 80)).filter(Boolean);
      }
      for (const lim of ["min", "max"]) if (s[lim] !== undefined) { if (!["integer", "number"].includes(type) || !Number.isFinite(Number(s[lim]))) errors.push(`draft kind ${k}: field ${f}'s ${lim} is a number, on a number field`); else o[lim] = Number(s[lim]); }
      if (type === "text") o.max_length = Math.min(2000, Math.max(1, Math.round(num(s.max_length, 500))));
      out[f] = o;
    }
    kinds[k] = { label, screen, fields: out };
  }
  return { kinds, errors };
}
// A draft's fields against its kind: -> the values as kept, or throws bad(...) naming what is wrong. Pure.
function checkFields(kind, raw) {
  const v = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  for (const f of Object.keys(v)) if (!kind.fields[f]) throw bad(`there is no field "${line(f, 40)}"; the fields are ${Object.keys(kind.fields).join(", ")}`);
  const out = {};
  for (const [f, s] of Object.entries(kind.fields)) {
    let x = v[f];
    if (x === undefined || x === null || x === "") { if (s.required) throw bad(`${s.label} is needed`); continue; }
    if (s.type === "integer" || s.type === "number") {
      const n = typeof x === "string" && x.trim() !== "" ? Number(x) : x;
      if (typeof n !== "number" || !Number.isFinite(n) || (s.type === "integer" && !Number.isInteger(n))) throw bad(`${s.label} is a ${s.type === "integer" ? "whole number" : "number"}`);
      if (s.min !== undefined && n < s.min) throw bad(`${s.label} is at least ${s.min}`);
      if (s.max !== undefined && n > s.max) throw bad(`${s.label} is at most ${s.max}`);
      x = n;
    } else if (s.type === "boolean") {
      if (typeof x !== "boolean") throw bad(`${s.label} is yes or no`);
    } else if (s.type === "date") {
      if (typeof x !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x) || Number.isNaN(Date.parse(`${x}T00:00:00Z`))) throw bad(`${s.label} is a date like 2026-11-30`);
    } else {
      x = line(x, s.max_length || 500);
      if (!x) { if (s.required) throw bad(`${s.label} is needed`); continue; }
      if (s.choices && !s.choices.includes(x)) throw bad(`${s.label} is one of ${s.choices.join(", ")}`);
    }
    out[f] = x;
  }
  return out;
}

// ---- which tools take drafts, from their manifests on the floor ---------------------------------------------------
const manifests = new Map();   // "company/module@version" -> kinds (a version's files never change)
async function declared(company) {
  const reg = require("./registry");
  const rows = (await q("SELECT name, title, live_version FROM platform.modules WHERE company=$1 AND live_version IS NOT NULL AND archived_at IS NULL ORDER BY title", [company])).rows;
  const out = new Map();
  for (const m of rows) {
    const k = `${company}/${m.name}@${m.live_version}`;
    if (!manifests.has(k)) {
      let kinds = {};
      try { const man = JSON.parse(((await reg.versionFiles(company, m.name, m.live_version)) || {})["module.json"] || "{}"); kinds = checkDeclaration(man.drafts).kinds; } catch (e) { kinds = {}; }
      manifests.set(k, kinds);
    }
    const kinds = manifests.get(k);
    if (Object.keys(kinds).length) out.set(m.name, { module: m.name, title: m.title, kinds });
  }
  return out;
}

// ---- who acts ---------------------------------------------------------------------------------------------------
// who: the platform's word for the person in the request (req.sosRole, req.sosPerson), never the tool's
// method: the request's own (a ticket's, src/runner.js, or the platform's request for a tool kept in its process)
function whoOf(req) {
  const r = req || {};
  return { method: String(r.sosMethod || r.method || "").toUpperCase() || null, role: r.sosRole || null, name: r.sosPerson ? line(r.sosPerson, 80) : r.sosRole === "admin" ? "Anetix" : r.sosRole === "manager" ? "a manager" : r.sosRole === "floor" ? "someone on the floor" : null, personId: r.sosPersonId || null };
}
async function floorOn(company, mod) {
  const r = (await q("SELECT floor_drafts FROM platform.vsm_tool_settings WHERE company=$1 AND module=$2", [company, mod])).rows[0];
  return Boolean(r && r.floor_drafts);
}
async function canAct(company, mod, who) {
  if (!who || !who.role) return false;
  if (who.role === "manager" || who.role === "admin") return true;
  return who.role === "floor" && (await floorOn(company, mod));
}
const shown = (d, kinds) => ({ id: d.id, kind: d.kind, label: (kinds[d.kind] || {}).label || d.kind.replace(/_/g, " "), fields: d.fields, why: d.why, agent: d.agent_name,
  state: d.state === "taking" && d.held_until && new Date(d.held_until) < new Date() ? "waiting" : d.state, held_by: d.state === "taking" ? d.held_by : null, created_at: d.created_at });

// ---- what the platform lends a tool on ctx.drafts ----------------------------------------------------------------
async function listFor(company, mod, who) {
  const ok = await canAct(company, mod, who);
  if (!ok) return { can_act: false, drafts: [] };
  const decl = (await declared(company)).get(mod);
  const rows = (await q("SELECT * FROM platform.vsm_record_drafts WHERE company=$1 AND module=$2 AND state = ANY($3) ORDER BY id LIMIT 50", [company, mod, OPEN])).rows;
  return { can_act: true, drafts: rows.map((d) => shown(d, decl ? decl.kinds : {})) };
}
const idOf = (id) => { const n = Number(id); if (!Number.isInteger(n) || n < 1 || n > 999999999) throw bad("no such draft", 404); return n; };
// A person acts on a draft with a tap: a page that only opens (a GET) never claims, makes or declines one, whatever its
// code does (the VSM audit, round 3, 2026-11-03: a ticket proved a request was in flight, not that a person chose to act).
const READS = ["GET", "HEAD", "OPTIONS"];
async function mustAct(company, mod, who, lane) {
  if (lane && lane !== "live") throw bad("Drafts are made on the floor's version of the tool, not on a preview or the test floor.", 409);
  if (who && who.method && READS.includes(who.method)) throw bad("A draft is made or declined with a tap on the tool's screen, never by opening a page.", 405);
  if (!(await canAct(company, mod, who))) throw bad(who && who.role === "floor" ? "Drafts from agents are made by a manager on this tool, unless a manager opens them to the floor." : "Sign in to act on a draft.", 403);
}
async function claim(company, mod, who, id, lane) {
  await mustAct(company, mod, who, lane);
  const n = idOf(id);
  const d = (await q(`UPDATE platform.vsm_record_drafts SET state='taking', held_by=$4, held_until=now() + ($5::int * interval '1 second')
                       WHERE company=$1 AND module=$2 AND id=$3 AND (state='waiting' OR (state='taking' AND held_until < now())) RETURNING *`, [company, mod, n, who.name, HOLD_SEC])).rows[0];
  if (!d) {
    const now = (await q("SELECT state, held_by FROM platform.vsm_record_drafts WHERE company=$1 AND module=$2 AND id=$3", [company, mod, n])).rows[0];
    if (!now) throw bad("no such draft", 404);
    throw bad(now.state === "taking" ? `${now.held_by || "Someone"} is making it right now.` : `This draft is ${WORDS[now.state] || now.state} already.`, 409);
  }
  return { id: d.id, kind: d.kind, fields: d.fields };
}
const WORDS = { taken: "made", declined: "declined", withdrawn: "withdrawn", expired: "expired" };
async function finish(company, mod, who, id, opts, lane) {
  await mustAct(company, mod, who, lane);
  const n = idOf(id);
  const ref = line((opts || {}).ref, 80) || null;
  const d = (await q(`UPDATE platform.vsm_record_drafts SET state='taken', ref=$4, note=$5, decided_by=$6, decided_at=now(), held_until=NULL
                       WHERE company=$1 AND module=$2 AND id=$3 AND state='taking' RETURNING *`, [company, mod, n, ref, line((opts || {}).note, 300) || null, who.name])).rows[0];
  if (!d) throw bad("Claim the draft first; a claim lapses after two minutes.", 409);
  await say(d, `${who.name} made it in ${await titleOf(company, mod)}${ref ? `: ${ref}` : ""}.`, who.name);
  await record.record("agent_draft_taken", { company, module: mod, actor: { role: who.role, name: who.name }, after: ref, detail: { draft: d.id, kind: d.kind, by: who.name } });
  return { ok: true, ref };
}
async function decline(company, mod, who, id, opts, lane) {
  await mustAct(company, mod, who, lane);
  const n = idOf(id);
  const note = line((opts || {}).note, 300);
  if (!note) throw bad("Say in a line why, so the agent learns.");
  const d = (await q(`UPDATE platform.vsm_record_drafts SET state='declined', note=$4, decided_by=$5, decided_at=now(), held_until=NULL
                       WHERE company=$1 AND module=$2 AND id=$3 AND state = ANY($6) RETURNING *`, [company, mod, n, note, who.name, OPEN])).rows[0];
  if (!d) throw bad("This draft is not waiting.", 409);
  await say(d, `${who.name} declined it: ${note}`, who.name);
  await record.record("agent_draft_declined", { company, module: mod, actor: { role: who.role, name: who.name }, after: note, detail: { draft: d.id, kind: d.kind, by: who.name } });
  return { ok: true };
}
async function titleOf(company, mod) { const r = (await q("SELECT title FROM platform.modules WHERE company=$1 AND name=$2", [company, mod])).rows[0]; return r ? r.title : mod; }
// a line on the draft's thread on the board
async function say(d, words, by) {
  if (!d.message_id) return;
  const m = (await q("SELECT channel FROM platform.vsm_messages WHERE id=$1", [d.message_id])).rows[0];
  if (!m) return;
  await require("./vsm-agents").post({ company: d.company, channel: m.channel, thread_id: d.message_id, kind: "action", from_kind: by ? "person" : "platform", from_name: by || "Anetix", agent_id: d.agent_id, words });
}

// ---- an agent's review drafts one (src/vsm-review.js apply) ---------------------------------------------------------
// allowed: Map(module -> { title, kinds }) of the tools this agent may draft into (its own and its neighbors' that take
// drafts). -> the message posted, or throws bad(...) with why it was left out.
async function create(company, a, x, allowed, { reviewId, to }) {
  const mod = String((x && x.tool) || "");
  const t = allowed.get(mod);
  if (!t) throw bad(`${line(mod, 40)} is not a tool it may draft into (its own and its neighbors' that take drafts)`);
  const kind = t.kinds[String(x.kind || "")];
  if (!kind) throw bad(`${t.title} takes ${Object.keys(t.kinds).join(", ")}, not ${line(x.kind, 40)}`);
  const fields = checkFields(kind, x.fields);
  const waiting = (await q("SELECT count(*)::int AS n FROM platform.vsm_record_drafts WHERE company=$1 AND module=$2 AND state = ANY($3)", [company, mod, OPEN])).rows[0].n;
  if (waiting >= WAITING_MAX()) throw bad(`${t.title} has ${waiting} drafts waiting already`);
  const scrub = (s, n) => txt(require("./assist").scrubText(String(s == null ? "" : s)), n);
  const why = scrub(x.why, 400) || null;
  const summary = Object.entries(fields).map(([f, v]) => `${kind.fields[f].label}: ${v === true ? "yes" : v === false ? "no" : v}`).join("; ");
  const ch = `a:${a.key}`;
  const m = await require("./vsm-agents").post({ company, channel: ch, kind: "record", from_kind: "agent", from_name: a.name, agent_id: a.id, to_list: to || [],
    evidence: { tool: mod, tool_title: t.title, kind: x.kind, kind_label: kind.label, fields, labels: Object.fromEntries(Object.keys(fields).map((f) => [f, kind.fields[f].label])), screen: kind.screen, review: reviewId },
    words: `Drafted ${kind.label} for ${t.title}: ${summary}.${why ? ` ${why}` : ""}` });
  const thread = Number(x.thread_id) || null;
  const d = (await q(`INSERT INTO platform.vsm_record_drafts (company, module, kind, fields, why, agent_id, agent_name, message_id, thread_id) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9) RETURNING *`,
    [company, mod, x.kind, JSON.stringify(fields), why, a.id, a.name, m.id, thread])).rows[0];
  await record.record("agent_record_drafted", { company, module: mod, actor: "agent", after: summary, detail: { agent: a.key, draft: d.id, kind: x.kind, review: reviewId } });
  return m;
}
// what an agent is told of its own drafts, so it does not draft the same thing twice and learns from a decline
async function recentOf(company, agentId) {
  return (await q("SELECT id, module, kind, fields, state, ref, note, decided_by, created_at FROM platform.vsm_record_drafts WHERE company=$1 AND agent_id=$2 ORDER BY id DESC LIMIT 10", [company, agentId])).rows;
}

// ---- the board: withdraw, the floor switch, expiry ---------------------------------------------------------------
const byOf = (req) => (req.sosAccount && (req.sosAccount.name || req.sosAccount.login)) || req.sosPerson || (req.sosRole === "admin" ? "Anetix" : "a manager");
async function withdraw(req, company, messageId) {
  const by = byOf(req);
  const d = (await q(`UPDATE platform.vsm_record_drafts SET state='withdrawn', decided_by=$3, decided_at=now(), held_until=NULL WHERE company=$1 AND message_id=$2 AND state = ANY($4) RETURNING *`, [company, messageId, by, OPEN])).rows[0];
  if (!d) {
    const any = (await q("SELECT state FROM platform.vsm_record_drafts WHERE company=$1 AND message_id=$2", [company, messageId])).rows[0];
    throw any ? bad(`This draft is ${WORDS[any.state] || any.state} already.`, 409) : bad("no such draft", 404);
  }
  await say(d, `${by} withdrew it.`, by);
  await record.record("agent_draft_withdrawn", { company, module: d.module, actor: record.actor(req), detail: { draft: d.id } });
  return { ok: true };
}
async function setFloor(req, company, mod, on) {
  if (!(await declared(company)).has(mod)) throw bad("That tool takes no drafts.", 404);
  await q(`INSERT INTO platform.vsm_tool_settings (company, module, floor_drafts, updated_by, updated_at) VALUES ($1,$2,$3,$4,now())
           ON CONFLICT (company, module) DO UPDATE SET floor_drafts=$3, updated_by=$4, updated_at=now()`, [company, mod, Boolean(on), byOf(req)]);
  await record.record("agent_drafts_floor", { company, module: mod, actor: record.actor(req), after: on ? "on" : "off" });
  return { floor: Boolean(on) };
}
async function toolsView(company) {
  const d = await declared(company);
  const counts = (await q("SELECT module, count(*) FILTER (WHERE state = ANY($2))::int AS waiting FROM platform.vsm_record_drafts WHERE company=$1 GROUP BY module", [company, OPEN])).rows;
  const floor = (await q("SELECT module, floor_drafts FROM platform.vsm_tool_settings WHERE company=$1", [company])).rows;
  return [...d.values()].map((t) => ({ module: t.module, title: t.title, kinds: Object.entries(t.kinds).map(([k, v]) => ({ kind: k, label: v.label, screen: v.screen })),
    waiting: (counts.find((c) => c.module === t.module) || {}).waiting || 0, floor: Boolean((floor.find((f) => f.module === t.module) || {}).floor_drafts) }));
}
async function sweep() {
  // a claim that lapsed (someone opened it and never made it) counts as waiting: it expires too (round 3)
  const gone = (await q(`UPDATE platform.vsm_record_drafts SET state='expired', decided_at=now(), held_until=NULL
                          WHERE (state='waiting' OR (state='taking' AND (held_until IS NULL OR held_until < now()))) AND created_at < now() - ($1::numeric * interval '1 day') RETURNING *`, [DRAFT_DAYS()])).rows;
  for (const d of gone) await say(d, `Nobody made it in ${DRAFT_DAYS()} days, so it expired.`, null).catch(() => {});
  return gone.length;
}
async function deleteCompany(company) { for (const t of TABLES) await q(`DELETE FROM platform.${t} WHERE company=$1`, [company]); }

// ---- routes: managers and admins --------------------------------------------------------------------------------
const router = express.Router();
const requireManager = (req, res, next) => require("./auth").requireManager(req, res, next);
const slugOf = (req) => String(req.params.slug || "").toLowerCase();
router.get("/api/c/:slug/vsm/draft-tools", requireManager, async (req, res) => res.json({ tools: await toolsView(slugOf(req)) }));
router.post("/api/c/:slug/vsm/draft-tools/:mod([a-z0-9][a-z0-9-]{0,60})", requireManager, express.json({ limit: "4kb" }), async (req, res) => res.json({ ok: true, ...(await setFloor(req, slugOf(req), req.params.mod, (req.body || {}).floor === true)) }));
router.post("/api/c/:slug/vsm/record-drafts/:id(\\d{1,9})/withdraw", requireManager, async (req, res) => res.json(await withdraw(req, slugOf(req), Number(req.params.id))));

module.exports = { init, SCHEMA, TABLES, router, checkDeclaration, checkFields, declared, whoOf, canAct, listFor, claim, finish, decline, create, recentOf, withdraw, setFloor, toolsView, sweep, deleteCompany, OPEN };
