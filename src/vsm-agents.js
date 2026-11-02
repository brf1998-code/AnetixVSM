// The agent board, A1 (docs/AGENTS.md, 2026-11-02): agents that each watch one area of the plant, placed by the value
// stream map, and talk on one public board that every manager and admin can read. A1 is the part with no AI: the
// board, agents taken from the map, watches (plain rules over a tool's records), routing along the map, climbing, and
// what people do with a flag. The agents' own shift reviews come in A2.
//
// Brendan's calls (2026-11-02):
//   - The board is its own tab: Kaizen | Map | Agents (public/agent-board.html at /c/<slug>/agent-board; /c/<slug>/agents
//     was already the agent settings page).
//   - A manager turns on each watch. Setting an agent up drafts its watches from its tools' tables (no AI in A1: the
//     columns say what can be watched); each one starts as proposed.
//   - A flag about an area with no agent goes to that box's people (a mention in that box's channel).
//   - Climbing: a board notice, and also the founders' phones through ntfy for now, "to get a sense", which can be backed
//     off later (SOS_AGENT_PUSH=off). The push names the company, the agent and the kind of flag, never a record value.
//   - The floor does not see the board. A line on the station screen is an experiment for later, off by default.
//
// What it is:
//   agents    one per name on the map (a box's detail.agent_name; several boxes may share one), set up by a manager.
//             An agent can be set up only where it has data: an Anetix tool on one of its boxes.
//   watches   a stored check in one of a few fixed shapes, run every SOS_WATCH_MS (5 minutes) through the company's
//             read-only database role, with every table and column name checked against the tool's own tables:
//               stuck    rows in an open state, unchanged past a number of hours
//               waiting  rows matching a condition, older than a number of hours (0 = any)
//               level    a number under (or over) a limit or another column
//               due      a date within a number of hours, the work not done
//               quiet    the tool not changed by the plant's own people for a number of days, where it was before
//   flags     a watch that finds rows opens one flag (a thread on the board) and keeps it while the rows are there,
//             updating its count; when they clear, it says so and closes. One open flag per watch at a time.
//   routing   a new flag goes to the agent's channel and #plant, and to the immediate parties on the map: the box right
//             before the agent's box, the box right after, and the production control box with an information flow
//             into it. A party with an agent that is on gets it addressed to that agent; one without gets a mention for
//             its people (the box's channel).
//   climbing  a "look" flag nobody marked seen after SOS_FLAG_RAISE_MIN (720) becomes "act"; an "act" flag nobody marked
//             seen after SOS_FLAG_CLIMB_MIN (240) climbs: #escalations, a notice on the board for every manager, a red
//             box on the map, and the push.
//   people    a manager or an admin marks a flag seen, on it, resolved (with a line) or not a problem (with a line; the
//             watch is muted for a week), makes it a request on the Kaizen board, or writes in any channel or thread.
//
// Rules it keeps: read only, scoped to the agent's own tools, no free SQL; nothing here writes a tool's record or moves
// anything toward the floor; a request made from a flag goes to the Kaizen board, where the manager's approval is still
// the gate. Watches are platform code, not AI, so they run under the data wall too. Every change is on the record.
const express = require("express");
const { q } = require("./db");
const record = require("./record");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS platform.vsm_agents (
  id          SERIAL PRIMARY KEY,
  company     TEXT NOT NULL,
  key         TEXT NOT NULL,
  name        TEXT NOT NULL,
  boxes       JSONB NOT NULL DEFAULT '[]'::jsonb,
  tools       TEXT[] NOT NULL DEFAULT '{}',
  brief       TEXT NOT NULL DEFAULT '',
  people      TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'on',
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company, key)
);
CREATE TABLE IF NOT EXISTS platform.vsm_watches (
  id           SERIAL PRIMARY KEY,
  company      TEXT NOT NULL,
  agent_id     INTEGER NOT NULL REFERENCES platform.vsm_agents(id) ON DELETE CASCADE,
  shape        TEXT NOT NULL,
  tool         TEXT NOT NULL,
  spec         JSONB NOT NULL DEFAULT '{}'::jsonb,
  title        TEXT NOT NULL,
  severity     TEXT NOT NULL DEFAULT 'look',
  status       TEXT NOT NULL DEFAULT 'proposed',
  muted_until  TIMESTAMPTZ,
  last_run_at  TIMESTAMPTZ,
  last_count   INTEGER,
  last_error   TEXT,
  created_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS platform.vsm_messages (
  id          SERIAL PRIMARY KEY,
  company     TEXT NOT NULL,
  channel     TEXT NOT NULL,
  thread_id   INTEGER,
  kind        TEXT NOT NULL,
  severity    TEXT,
  from_kind   TEXT NOT NULL,
  from_name   TEXT NOT NULL,
  agent_id    INTEGER,
  watch_id    INTEGER,
  to_list     JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence    JSONB,
  words       TEXT NOT NULL,
  hops        INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS platform.vsm_flags (
  thread_id    INTEGER PRIMARY KEY,
  company      TEXT NOT NULL,
  agent_id     INTEGER,
  watch_id     INTEGER,
  channel      TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open',
  severity     TEXT NOT NULL DEFAULT 'look',
  count        INTEGER NOT NULL DEFAULT 0,
  evidence     JSONB,
  boxes        JSONB NOT NULL DEFAULT '[]'::jsonb,
  owner        TEXT,
  feedback_id  INTEGER,
  opened_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_true_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_msg_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raised_at    TIMESTAMPTZ,
  climbed_at   TIMESTAMPTZ,
  closed_at    TIMESTAMPTZ,
  status_by    TEXT,
  status_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS vsm_messages_company ON platform.vsm_messages (company, id DESC);
CREATE INDEX IF NOT EXISTS vsm_messages_thread ON platform.vsm_messages (thread_id);
CREATE INDEX IF NOT EXISTS vsm_flags_company ON platform.vsm_flags (company, status);
CREATE INDEX IF NOT EXISTS vsm_watches_agent ON platform.vsm_watches (agent_id);`;

const TABLES = ["vsm_agents", "vsm_watches", "vsm_messages", "vsm_flags"];
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : d; };
const WATCH_MS = num(process.env.SOS_WATCH_MS, 300000);
const RAISE_MIN = () => num(process.env.SOS_FLAG_RAISE_MIN, 720);
const CLIMB_MIN = () => num(process.env.SOS_FLAG_CLIMB_MIN, 240);
const UPDATE_MIN = () => num(process.env.SOS_FLAG_UPDATE_MIN, 60);
const HOLD_MIN = () => num(process.env.SOS_FLAG_RESOLVED_HOLD_MIN, 60);
const PUSH = () => String(process.env.SOS_AGENT_PUSH || "on").toLowerCase() !== "off";
const MUTE_DAYS = 7;
const SHAPES = ["stuck", "waiting", "level", "due", "quiet"];
const SEVERITY = ["look", "act"];
const OPEN_FLAG = ["open", "seen", "on_it"];
const MATERIAL = ["push", "pull", "fifo", "supermarket", "supply", "ship"];
const INFO = ["info_system", "info_word"];
const SHAPE_WORDS = { stuck: "work has sat in one state too long", waiting: "something has waited too long", level: "a number is past its limit", due: "work is coming due and is not done", quiet: "a tool has gone quiet" };

const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
const notFound = (what) => Object.assign(new Error(`no such ${what}`), { status: 404 });
const txt = (v, n) => String(v == null ? "" : v).replace(/\r\n?/g, "\n").replace(/\u0000/g, "").trim().slice(0, n);
const line = (v, n) => txt(v, n).replace(/\s*\n+\s*/g, " ");
const slugify = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
const tools_ = () => require("./assist-tools");
const asBad = (e) => { if (e && e.say && !e.status) e.status = 400; return e; };
const whoOf = (req) => (req.sosAccount && (req.sosAccount.name || req.sosAccount.login)) || req.sosPerson || (req.sosRole === "admin" ? "Anetix" : "manager");

async function init() {
  await q(SCHEMA);
  if (WATCH_MS > 0) setInterval(() => tick().catch((e) => console.error("[agents] watches:", e.message)), WATCH_MS).unref();
}

// ---- the map: who the agents are and where they sit ----------------------------------------------------------------
async function mapBoxes(company) {
  const nodes = (await q(`SELECT m.id AS map_id, m.key AS map_key, m.family, n.key, n.kind, n.label, n.who, n.modules, coalesce(n.detail->>'agent_name','') AS agent_name
                            FROM platform.vsm_nodes n JOIN platform.vsm_maps m ON m.id=n.map_id
                           WHERE n.company=$1 AND NOT m.proposed AND m.replaced_at IS NULL ORDER BY m.sort, m.id, n.id`, [company])).rows;
  const edges = (await q(`SELECT e.map_id, e.from_key, e.to_key, e.kind FROM platform.vsm_edges e JOIN platform.vsm_maps m ON m.id=e.map_id
                           WHERE e.company=$1 AND NOT m.proposed AND m.replaced_at IS NULL`, [company])).rows;
  return { nodes, edges };
}
async function liveTools(company) {
  return (await q("SELECT name, title FROM platform.modules WHERE company=$1 AND live_version IS NOT NULL AND archived_at IS NULL ORDER BY title", [company])).rows;
}
// The agents the map names, merged with the ones set up. Pure but for its inputs.
function agentsFrom(nodes, rows, live) {
  const liveSet = new Set(live.map((t) => t.name));
  const by = new Map();
  for (const n of nodes) {
    const name = line(n.agent_name, 60); if (!name) continue;
    const key = slugify(name); if (!key) continue;
    if (!by.has(key)) by.set(key, { key, name, boxes: [], tools: [] });
    const a = by.get(key);
    a.boxes.push({ map_key: n.map_key, family: n.family, key: n.key, label: n.label, who: n.who || "" });
    for (const m of n.modules || []) if (liveSet.has(m) && !a.tools.includes(m)) a.tools.push(m);
  }
  for (const r of rows) {
    if (!by.has(r.key)) by.set(r.key, { key: r.key, name: r.name, boxes: [], tools: [], off_map: true });
    Object.assign(by.get(r.key), { id: r.id, status: r.status, brief: r.brief, people: r.people, set_up: true, tools_at_setup: r.tools });
  }
  return [...by.values()].map((a) => ({ ...a, status: a.set_up ? a.status : "not_set_up", can_set_up: a.tools.length > 0 }));
}
// The immediate parties of a set of boxes: the box right before (material in), right after (material out) and the
// production control box with an information flow in. Customers and suppliers are not parties. Pure.
function partiesOf(ownKeys, nodes, edges, agentsByKey, ownAgentKey) {
  const byMapKey = new Map(nodes.map((n) => [`${n.map_id}/${n.key}`, n]));
  const own = nodes.filter((n) => ownKeys.has(`${n.map_key}/${n.key}`));
  const near = new Map();
  for (const n of own) {
    for (const e of edges.filter((x) => x.map_id === n.map_id)) {
      let other = null;
      if (e.to_key === n.key && MATERIAL.includes(e.kind)) other = byMapKey.get(`${e.map_id}/${e.from_key}`);
      else if (e.from_key === n.key && MATERIAL.includes(e.kind)) other = byMapKey.get(`${e.map_id}/${e.to_key}`);
      else if (e.to_key === n.key && INFO.includes(e.kind)) { const f = byMapKey.get(`${e.map_id}/${e.from_key}`); if (f && f.kind === "control") other = f; }
      if (!other || !["process", "control", "store"].includes(other.kind) || ownKeys.has(`${other.map_key}/${other.key}`)) continue;
      near.set(`${other.map_key}/${other.key}`, other);
    }
  }
  const out = [], seen = new Set();
  for (const [k, n] of near) {
    const ak = slugify(n.agent_name);
    const ag = ak && agentsByKey.get(ak);
    if (ag && ag.status === "on" && ak !== ownAgentKey) { if (!seen.has(`a:${ak}`)) { seen.add(`a:${ak}`); out.push({ kind: "agent", key: ak, name: ag.name }); } }
    else if (ak !== ownAgentKey && !seen.has(`b:${k}`)) { seen.add(`b:${k}`); out.push({ kind: "box", key: k, name: n.label, people: n.who || "" }); }
  }
  return out;
}

// ---- what a tool's tables offer to watch (no AI: the columns say it) -------------------------------------------------
const SKIP_TABLE = /(^_)|(^|_)(settings|events|history|logs?|readings|layouts|updates|covers|links?)$|sheet|file_rows|kept/;
const DONE_WORD = /^(done|closed|complete|completed|finished|resolved|shipped|delivered|filled|cancel+ed|canceled|cancel|declined|received|approved|archived|void|released|applied|taken)$/i;
const isTime = (c) => /timestamp|date/.test(c.type);
const isNum = (c) => /integer|numeric|real|double|smallint|bigint/.test(c.type);
const isBool = (c) => c.type === "boolean";
const isText = (c) => /text|character/.test(c.type);
const find = (cols, re, test) => cols.find((c) => re.test(c.name) && (!test || test(c)));
const words = (s) => String(s).replace(/_/g, " ");
function labelCol(cols) {
  return (find(cols, /^(part_no|wo_number|job_num|mo_no|mo_number|number|sop|code|name|title|item|description|part_name)$/, isText) || find(cols, /^id$/) || cols.find(isText) || cols[0]).name;
}
function doneCol(cols) { const c = find(cols, /^(done|closed|finished|completed|delivered|shipped|resolved|received|approved|decided|applied)_at$/, isTime); return c ? c.name : null; }
function sinceCol(cols, done) {
  // when a row last changed, else when it began: a column that is filled in later (arrived_at) would leave a new row out
  const pick = find(cols, /^updated_at$/, isTime) || find(cols, /^(created_at|requested_at|released_at|order_date|opened_at|at)$/, isTime) || find(cols, /^(moved|changed|arrived|started|running|setup|marked|last)_at$/, isTime)
    || cols.find((c) => isTime(c) && c.name !== done);
  return pick ? pick.name : null;
}
// -> [{ shape, tool, title, spec, severity }]. valuesOf(table, column) -> [{ v, n }]: the column's values and counts, read
// by platform code (a status list, never a record's words for a model).
async function proposeFor(tool, title, tables, valuesOf) {
  const out = [];
  for (const [table, cols] of tables) {
    if (SKIP_TABLE.test(table)) continue;
    const label = labelCol(cols), done = doneCol(cols), since = sinceCol(cols, done);
    const notDone = done ? [{ column: done, op: "is empty" }] : [];
    const tw = words(table);
    const state = find(cols, /^(stage|status|state|traveler_status)$/, isText);
    if (state && since) {
      const vals = (await valuesOf(table, state.name)).filter((x) => x.v != null && String(x.v).trim());
      const open = vals.map((x) => String(x.v)).filter((v) => !DONE_WORD.test(v.trim())).slice(0, 8);
      if (open.length) out.push({ shape: "stuck", tool, severity: "look", title: `${title}: ${tw} stuck at one ${words(state.name)}`, spec: { table, state_column: state.name, states: open, since_column: since, hours: 72, label_column: label, where: notDone } });
      else if (done && since !== done) out.push({ shape: "waiting", tool, severity: "look", title: `${title}: ${tw} still open`, spec: { table, since_column: since, hours: 72, label_column: label, where: notDone } });
    } else if (done && since && since !== done) {
      out.push({ shape: "waiting", tool, severity: "look", title: `${title}: ${tw} still open`, spec: { table, since_column: since, hours: 72, label_column: label, where: notDone } });
    }
    const qty = find(cols, /^(qty|quantity|on_hand|stock|qty_on_hand)$/, isNum);
    if (qty) {
      const onOrder = find(cols, /^on_order$/, isNum);
      for (const lv of cols.filter((c) => isNum(c) && /^(order_level|reorder_level|reorder_point|order_point|low_level|min_qty|min_level|par_level)$/.test(c.name)).slice(0, 2)) {
        out.push({ shape: "level", tool, severity: "look", title: `${title}: ${tw} under ${words(lv.name)}${onOrder ? " with nothing on order" : ""}`, spec: { table, column: qty.name, op: "under", limit_column: lv.name, label_column: label, where: onOrder ? [{ column: onOrder.name, op: "<=", value: 0 }] : [] } });
      }
    }
    const due = find(cols, /^(ship_date|due_date|due_at|need_by|needed_by|sched_finish|promise_date|ship_by)$/, isTime);
    if (due && done) out.push({ shape: "due", tool, severity: "act", title: `${title}: ${tw} coming due and not done`, spec: { table, date_column: due.name, within_hours: 72, label_column: label, where: notDone } });
    for (const f of cols.filter((c) => isBool(c) && /^(is_short|short|bin_empty|recount|needs_recount|on_hold|hold|blocked|late|is_late)$/.test(c.name)).slice(0, 2)) {
      if (!since) break;
      out.push({ shape: "waiting", tool, severity: "look", title: `${title}: ${tw} marked ${words(f.name).replace(/^is /, "")}`, spec: { table, since_column: since, hours: 48, label_column: label, where: [{ column: f.name, op: "=", value: true }, ...notDone] } });
    }
    for (const n of cols.filter((c) => isText(c) && /(mismatch|problem|issue|error)(_note|_notes)?$/.test(c.name)).slice(0, 1)) {
      if (!since) break;
      out.push({ shape: "waiting", tool, severity: "look", title: `${title}: ${tw} with a ${words(n.name)}`, spec: { table, since_column: since, hours: 0, label_column: label, where: [{ column: n.name, op: "is not empty" }, ...notDone] } });
    }
  }
  out.push({ shape: "quiet", tool, severity: "look", title: `${title}: not used by the plant`, spec: { days: 3 } });
  return out.slice(0, 8).concat(out.length > 8 ? [out[out.length - 1]] : []).filter((w, i, a) => a.findIndex((x) => x.title === w.title) === i);
}

// ---- a watch's spec, checked; and its query ------------------------------------------------------------------------
const OPS = ["=", "!=", "<", "<=", ">", ">=", "contains", "is empty", "is not empty"];
function colOf(cols, name, what, test, testWords) {
  const c = cols.find((x) => x.name === name);
  if (!c) throw bad(`${what}: no column "${line(name, 60)}". Columns: ${cols.map((x) => x.name).join(", ")}.`);
  if (test && !test(c)) throw bad(`${what}: ${c.name} is not ${testWords}.`);
  return c.name;
}
// -> the spec as it will be stored. tables: Map(table -> cols). Throws bad(...) with what is wrong.
function checkSpec(shape, raw, tables) {
  if (!SHAPES.includes(shape)) throw bad(`A watch is one of: ${SHAPES.join(", ")}.`);
  const s = raw && typeof raw === "object" ? raw : {};
  if (shape === "quiet") { const days = Math.round(Number(s.days)); if (!(days >= 1 && days <= 60)) throw bad("A quiet watch counts 1 to 60 days."); return { days }; }
  const table = String(s.table || "");
  if (!tables.has(table)) throw bad(`Name one of the tool's tables: ${[...tables.keys()].join(", ")}.`);
  const cols = tables.get(table);
  const hours = (v, what) => { const h = Number(v); if (!(h >= 0 && h <= 8760)) throw bad(`${what} is 0 to 8760 hours.`); return Math.round(h * 100) / 100; };
  const where = (Array.isArray(s.where) ? s.where : []).slice(0, 6).map((w) => {
    const op = String((w && w.op) || "=");
    if (!OPS.includes(op)) throw bad(`A condition's comparison is one of: ${OPS.join(", ")}.`);
    const column = colOf(cols, w && w.column, "A condition");
    if (op === "is empty" || op === "is not empty") return { column, op };
    if (w.value === undefined || w.value === null || (typeof w.value === "object")) throw bad(`A condition on ${column} needs a value.`);
    return { column, op, value: typeof w.value === "boolean" || typeof w.value === "number" ? w.value : line(w.value, 120) };
  });
  const label_column = s.label_column ? colOf(cols, s.label_column, "The name column") : labelCol(cols);
  const out = { table, label_column, where };
  if (shape === "stuck" || shape === "waiting") {
    out.since_column = colOf(cols, s.since_column, "The time column", isTime, "a date or time");
    out.hours = hours(s.hours == null ? 72 : s.hours, "How long");
    if (shape === "stuck") {
      out.state_column = colOf(cols, s.state_column, "The state column");
      out.states = (Array.isArray(s.states) ? s.states : []).map((v) => line(v, 60)).filter(Boolean).slice(0, 20);
      if (!out.states.length) throw bad("Name the states that count as still open.");
    }
  } else if (shape === "level") {
    out.column = colOf(cols, s.column, "The number", isNum, "a number");
    out.op = s.op === "over" ? "over" : "under";
    if (s.limit_column) out.limit_column = colOf(cols, s.limit_column, "The limit", isNum, "a number");
    else { const l = Number(s.limit); if (!Number.isFinite(l)) throw bad("Give a limit: a number, or another column."); out.limit = l; }
  } else if (shape === "due") {
    out.date_column = colOf(cols, s.date_column, "The date", isTime, "a date or time");
    out.within_hours = hours(s.within_hours == null ? 72 : s.within_hours, "Within");
  }
  return out;
}
// -> { sql, params }: the rows the watch finds, at most 10, each with the total. Pure but for its inputs.
function watchQuery(schema, cols, shape, spec) {
  const { qi, whereSql } = tools_();
  const params = [];
  let where = "";
  try { where = whereSql(cols, spec.where || [], null, params); } catch (e) { throw asBad(e); }
  const parts = where ? [where.replace(/^ WHERE /, "")] : [];
  let order = "1";
  if (shape === "stuck" || shape === "waiting") {
    if (shape === "stuck") { params.push(spec.states); parts.push(`${qi(spec.state_column)}::text = ANY($${params.length}::text[])`); }
    if (spec.hours > 0) { params.push(spec.hours); parts.push(`${qi(spec.since_column)} < now() - ($${params.length}::numeric * interval '1 hour')`); }
    order = `${qi(spec.since_column)} NULLS FIRST`;
  } else if (shape === "level") {
    const rhs = spec.limit_column ? qi(spec.limit_column) : (params.push(spec.limit), `$${params.length}::numeric`);
    parts.push(`${qi(spec.column)} ${spec.op === "over" ? ">" : "<"} ${rhs}`);
    if (spec.limit_column) parts.push(`${qi(spec.limit_column)} IS NOT NULL`);
    order = qi(spec.column);
  } else if (shape === "due") {
    params.push(spec.within_hours);
    parts.push(`${qi(spec.date_column)} <= now() + ($${params.length}::numeric * interval '1 hour')`);
    order = qi(spec.date_column);
  }
  const hasId = cols.some((c) => c.name === "id");
  const sql = `SELECT count(*) OVER () AS total, ${hasId ? `${qi("id")} AS id` : "NULL AS id"}, ${qi(spec.label_column)}::text AS label FROM ${qi(schema)}.${qi(spec.table)}${parts.length ? ` WHERE ${parts.join(" AND ")}` : ""} ORDER BY ${order} LIMIT 10`;
  return { sql, params };
}
// -> { count, sample: [{ id, label }] } or throws with words
async function evaluate(company, w) {
  if (w.shape === "quiet") {
    const days = w.spec.days || 3;
    const r = (await q(`SELECT coalesce(sum(changes) FILTER (WHERE day > current_date - $3::int), 0)::int AS recent,
                               coalesce(sum(changes) FILTER (WHERE day <= current_date - $3::int AND day > current_date - 30 - $3::int), 0)::int AS before
                          FROM platform.module_use WHERE company=$1 AND module=$2`, [company, w.tool, days])).rows[0];
    return r.recent === 0 && r.before > 0 ? { count: 1, sample: [{ id: null, label: `no change in ${days} days` }] } : { count: 0, sample: [] };
  }
  const { tablesOf, readOnly } = tools_();
  const { schema, tables } = await tablesOf(company, w.tool);
  if (!tables.has(w.spec.table)) throw bad(`the tool no longer keeps a table called ${w.spec.table}`);
  const spec = checkSpec(w.shape, w.spec, tables);   // the tool may have changed since the watch was made
  const { sql, params } = watchQuery(schema, tables.get(spec.table), w.shape, spec);
  let rows;
  try { rows = await readOnly(company, sql, params); } catch (e) { throw asBad(e); }
  return { count: rows.length ? Number(rows[0].total) : 0, sample: rows.map((r) => ({ id: r.id, label: line(r.label, 80) })) };
}

// ---- messages and flags ----------------------------------------------------------------------------------------------
async function post(m) {
  return (await q(`INSERT INTO platform.vsm_messages (company, channel, thread_id, kind, severity, from_kind, from_name, agent_id, watch_id, to_list, evidence, words, hops)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13) RETURNING *`,
    [m.company, m.channel, m.thread_id || null, m.kind, m.severity || null, m.from_kind, line(m.from_name, 120) || "Anetix", m.agent_id || null, m.watch_id || null,
      JSON.stringify(m.to_list || []), m.evidence ? JSON.stringify(m.evidence) : null, txt(m.words, 4000), m.hops || 0])).rows[0];
}
// the watch's limit in words, so a title need not carry a number the manager may change. Pure.
function limitWords(shape, spec) {
  const span = (h) => (h >= 48 && h % 24 === 0 ? `${h / 24} days` : h === 1 ? "1 hour" : `${h} hours`);
  if (shape === "stuck" || shape === "waiting") return spec.hours > 0 ? `over ${span(spec.hours)}` : "";
  if (shape === "due") return `within ${span(spec.within_hours)}`;
  if (shape === "level") return `${spec.op} ${spec.limit_column ? String(spec.limit_column).replace(/_/g, " ") : spec.limit}`;
  if (shape === "quiet") return `${spec.days} ${spec.days === 1 ? "day" : "days"}`;
  return "";
}
const sampleWords = (count, sample) => { const l = sample.map((s) => s.label).filter(Boolean).slice(0, 5); return l.length ? ` (${l.join(", ")}${count > l.length ? ", and more" : ""})` : ""; };
async function agentRow(id) { return (await q("SELECT * FROM platform.vsm_agents WHERE id=$1", [id])).rows[0]; }
// a flag's parties: from the map as it is now
async function partiesFor(company, agent, tool) {
  const { nodes, edges } = await mapBoxes(company);
  const rows = (await q("SELECT * FROM platform.vsm_agents WHERE company=$1", [company])).rows;
  const agents = new Map(agentsFrom(nodes, rows, await liveTools(company)).map((a) => [a.key, a]));
  const mine = nodes.filter((n) => slugify(n.agent_name) === agent.key);
  const withTool = mine.filter((n) => (n.modules || []).includes(tool));
  const own = new Set((withTool.length ? withTool : mine).map((n) => `${n.map_key}/${n.key}`));
  return { to: partiesOf(own, nodes, edges, agents, agent.key), boxes: [...own] };
}
async function openFlag(w, res) {
  const agent = await agentRow(w.agent_id);
  const { to, boxes } = await partiesFor(w.company, agent, w.tool);
  const lim = limitWords(w.shape, w.spec || {});
  const words = w.shape === "quiet"
    ? `${w.title} in the last ${lim}: nobody at the plant changed anything in it, where they did before.`
    : `${w.title}${lim ? ` (${lim})` : ""}: ${res.count} found${sampleWords(res.count, res.sample)}.`;
  const evidence = { tool: w.tool, table: w.spec.table || null, shape: w.shape, count: res.count, sample: res.sample.slice(0, 10) };
  const m = await post({ company: w.company, channel: `a:${agent.key}`, kind: "flag", severity: w.severity, from_kind: "watch", from_name: agent.name, agent_id: agent.id, watch_id: w.id, to_list: to, evidence, words });
  await q(`INSERT INTO platform.vsm_flags (thread_id, company, agent_id, watch_id, channel, status, severity, count, evidence, boxes) VALUES ($1,$2,$3,$4,$5,'open',$6,$7,$8::jsonb,$9::jsonb)`,
    [m.id, w.company, agent.id, w.id, m.channel, w.severity, res.count, JSON.stringify(evidence), JSON.stringify(boxes)]);
  await record.record("agent_flag", { company: w.company, module: w.tool, actor: "agent", after: words, detail: { agent: agent.key, watch: w.id, thread: m.id, count: res.count, to: to.map((t) => t.key) } });
  return m;
}
// one run of a watch at a time in this process: the 5 minute runner and a manager's "Check now" may meet
const busy = new Set();
async function runWatch(w) {
  if (busy.has(w.id)) return { busy: true };
  busy.add(w.id);
  try { return await runWatchOnce(w); } finally { busy.delete(w.id); }
}
async function runWatchOnce(w) {
  let res;
  try { res = await evaluate(w.company, w); }
  catch (e) {
    const msg = line(e.message || "it could not be read", 300);
    await q("UPDATE platform.vsm_watches SET last_run_at=now(), last_error=$2 WHERE id=$1", [w.id, msg]);
    if (w.last_error !== msg) {
      const agent = await agentRow(w.agent_id);
      await post({ company: w.company, channel: `a:${agent.key}`, kind: "note", from_kind: "platform", from_name: "Anetix", agent_id: agent.id, watch_id: w.id, words: `The watch "${w.title}" cannot run: ${msg}. Change it or turn it off.` });
    }
    return { error: msg };
  }
  await q("UPDATE platform.vsm_watches SET last_run_at=now(), last_count=$2, last_error=NULL WHERE id=$1", [w.id, res.count]);
  const open = (await q("SELECT * FROM platform.vsm_flags WHERE watch_id=$1 AND status = ANY($2) ORDER BY thread_id DESC LIMIT 1", [w.id, OPEN_FLAG])).rows[0];
  if (res.count > 0) {
    if (!open) {
      const last = (await q("SELECT status, closed_at FROM platform.vsm_flags WHERE watch_id=$1 ORDER BY thread_id DESC LIMIT 1", [w.id])).rows[0];
      // a person marked it resolved a moment ago: give the fix time to show in the records before flagging again
      if (last && last.status === "resolved" && last.closed_at && Date.now() - new Date(last.closed_at).getTime() < HOLD_MIN() * 60e3) return { held: true, count: res.count };
      const m = await openFlag(w, res);
      return { opened: m.id, count: res.count };
    }
    const evidence = { ...(open.evidence || {}), count: res.count, sample: res.sample.slice(0, 10) };
    await q("UPDATE platform.vsm_flags SET count=$2, evidence=$3::jsonb, last_true_at=now() WHERE thread_id=$1", [open.thread_id, res.count, JSON.stringify(evidence)]);
    if (res.count !== open.count && Date.now() - new Date(open.updated_msg_at).getTime() >= UPDATE_MIN() * 60e3) {
      const agent = await agentRow(w.agent_id);
      await post({ company: w.company, channel: open.channel, thread_id: open.thread_id, kind: "update", from_kind: "watch", from_name: agent.name, agent_id: agent.id, watch_id: w.id, evidence,
        words: `Now ${res.count}, was ${open.count}${sampleWords(res.count, res.sample)}.` });
      await q("UPDATE platform.vsm_flags SET updated_msg_at=now() WHERE thread_id=$1", [open.thread_id]);
    }
    return { open: open.thread_id, count: res.count };
  }
  if (open) {
    const agent = await agentRow(w.agent_id);
    await q("UPDATE platform.vsm_flags SET status='cleared', count=0, closed_at=now() WHERE thread_id=$1", [open.thread_id]);
    await post({ company: w.company, channel: open.channel, thread_id: open.thread_id, kind: "cleared", from_kind: "watch", from_name: agent.name, agent_id: agent.id, watch_id: w.id, words: "Cleared: the watch finds nothing now." });
    await record.record("agent_flag_cleared", { company: w.company, module: w.tool, actor: "agent", detail: { agent: agent.key, watch: w.id, thread: open.thread_id } });
    return { cleared: open.thread_id, count: 0 };
  }
  return { count: 0 };
}
let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    const due = (await q(`SELECT w.* FROM platform.vsm_watches w JOIN platform.vsm_agents a ON a.id=w.agent_id
                           WHERE w.status='on' AND a.status='on' AND (w.muted_until IS NULL OR w.muted_until < now())
                             AND (w.last_run_at IS NULL OR w.last_run_at < now() - ($1::numeric * interval '1 millisecond'))
                           ORDER BY w.last_run_at NULLS FIRST LIMIT 200`, [Math.max(0, WATCH_MS * 0.8)])).rows;
    for (const w of due) await runWatch(w).catch((e) => console.error(`[agents] watch ${w.id}:`, e.message));
    await climb();
  } finally { running = false; }
}
async function climb() {
  const raise = (await q(`UPDATE platform.vsm_flags SET severity='act', raised_at=now() WHERE status='open' AND severity='look' AND raised_at IS NULL
                            AND opened_at < now() - ($1::numeric * interval '1 minute') RETURNING *`, [RAISE_MIN()])).rows;
  for (const f of raise) {
    await post({ company: f.company, channel: f.channel, thread_id: f.thread_id, kind: "raised", severity: "act", from_kind: "platform", from_name: "Anetix", agent_id: f.agent_id, watch_id: f.watch_id,
      words: "Nobody has marked this seen, so it is now marked to act on." });
  }
  const up = (await q(`UPDATE platform.vsm_flags SET climbed_at=now() WHERE status='open' AND severity='act' AND climbed_at IS NULL
                         AND greatest(opened_at, coalesce(raised_at, opened_at)) < now() - ($1::numeric * interval '1 minute') RETURNING *`, [CLIMB_MIN()])).rows;
  for (const f of up) {
    const agent = (await agentRow(f.agent_id)) || { key: "", name: "An agent" };
    const root = (await q("SELECT words FROM platform.vsm_messages WHERE id=$1", [f.thread_id])).rows[0] || { words: "" };
    const w = (await q("SELECT shape FROM platform.vsm_watches WHERE id=$1", [f.watch_id])).rows[0] || {};
    await post({ company: f.company, channel: "escalations", thread_id: f.thread_id, kind: "climbed", severity: "act", from_kind: "platform", from_name: "Anetix", agent_id: f.agent_id, watch_id: f.watch_id, to_list: [{ kind: "managers", key: "managers", name: "every manager" }],
      words: `Nobody has picked this up, so it goes to every manager: ${agent.name}. ${root.words}` });
    await require("./notices").add(f.company, "agent_flag", `${agent.name}: ${root.words}`.slice(0, 600), { thread: f.thread_id });
    await record.record("agent_flag_climbed", { company: f.company, actor: "platform", after: root.words, detail: { agent: agent.key, thread: f.thread_id } });
    if (PUSH()) {
      const co = (await q("SELECT name FROM platform.companies WHERE slug=$1", [f.company])).rows[0] || { name: f.company };
      const pub = require("./mcpauth").PUBLIC;
      const p = pushOf(co.name, agent.name, w.shape, f.count);
      require("./notify").notify(p.title, p.message, { priority: 4, tags: ["rotating_light"], ...(pub ? { click: `${pub}/c/${f.company}/agent-board?thread=${f.thread_id}` } : {}) });
    }
  }
  return { raised: raise.length, climbed: up.length };
}
// The push to Anetix's phones: the company, the agent and the kind of flag. Never a record's value or a title a person
// wrote (ntfy's servers carry it; src/notify.js). Pure.
function pushOf(companyName, agentName, shape, count) {
  return { title: "A flag climbed", message: `${line(companyName, 80)}: ${line(agentName, 60)} has had a flag nobody picked up (${SHAPE_WORDS[shape] || "a flag"}${count > 1 ? `, ${count} found` : ""}). It is on the agent board.` };
}

// ---- people: setting agents up, watches, and what they do with a flag -----------------------------------------------
async function overview(company) {
  const { nodes } = await mapBoxes(company);
  const rows = (await q("SELECT * FROM platform.vsm_agents WHERE company=$1 ORDER BY name", [company])).rows;
  const live = await liveTools(company);
  const agents = agentsFrom(nodes, rows, live);
  const watches = (await q("SELECT id, agent_id, shape, tool, spec, title, severity, status, muted_until, last_run_at, last_count, last_error FROM platform.vsm_watches WHERE company=$1 ORDER BY id", [company])).rows;
  const open = (await q("SELECT agent_id, count(*)::int AS n, count(*) FILTER (WHERE climbed_at IS NOT NULL)::int AS climbed FROM platform.vsm_flags WHERE company=$1 AND status = ANY($2) GROUP BY agent_id", [company, OPEN_FLAG])).rows;
  for (const a of agents) {
    a.watches = a.id ? watches.filter((w) => w.agent_id === a.id) : [];
    const o = open.find((x) => x.agent_id === a.id) || {};
    a.open = o.n || 0; a.climbed = o.climbed || 0;
  }
  return { agents, tools: live };
}
async function setUp(req, company, key) {
  const k = slugify(key);
  const { agents } = await overview(company);
  const a = agents.find((x) => x.key === k);
  if (!a) throw notFound("agent on the map");
  if (a.set_up) throw bad(`${a.name} is set up already.`);
  if (!a.tools.length) throw bad(`${a.name} has no Anetix tool on its boxes yet, so there is nothing for it to watch. Its boxes get a channel, and a flag about them reaches their people.`);
  const people = [...new Set(a.boxes.map((b) => b.who).filter(Boolean))].join("; ").slice(0, 300);
  const row = (await q(`INSERT INTO platform.vsm_agents (company, key, name, boxes, tools, people, status, created_by) VALUES ($1,$2,$3,$4::jsonb,$5,$6,'on',$7) RETURNING *`,
    [company, a.key, a.name, JSON.stringify(a.boxes), a.tools, people, whoOf(req)])).rows[0];
  const proposed = await proposeWatches(company, row, whoOf(req));
  await post({ company, channel: `a:${row.key}`, kind: "note", from_kind: "platform", from_name: "Anetix", agent_id: row.id,
    words: `${row.name} is set up. It watches ${a.tools.length === 1 ? "one tool" : `${a.tools.length} tools`} and proposed ${proposed} ${proposed === 1 ? "watch" : "watches"}; none runs until a manager turns it on.` });
  await record.record("agent_set_up", { company, actor: record.actor(req), detail: { agent: row.key, tools: row.tools, proposed } });
  return row;
}
async function proposeWatches(company, agent, by) {
  const live = await liveTools(company);
  const existing = (await q("SELECT title FROM platform.vsm_watches WHERE agent_id=$1", [agent.id])).rows.map((r) => r.title);
  let n = 0;
  for (const tool of agent.tools) {
    const t = live.find((x) => x.name === tool); if (!t) continue;
    const { tablesOf, readOnly, qi } = tools_();
    const { schema, tables } = await tablesOf(company, tool);
    const valuesOf = async (table, col) => {
      try { return await readOnly(company, `SELECT ${qi(col)}::text AS v, count(*)::int AS n FROM ${qi(schema)}.${qi(table)} GROUP BY 1 ORDER BY 2 DESC LIMIT 12`, []); }
      catch (e) { return []; }
    };
    for (const p of await proposeFor(tool, t.title, tables, valuesOf)) {
      if (existing.includes(p.title)) continue;
      let spec;
      try { spec = checkSpec(p.shape, p.spec, tables); } catch (e) { continue; }
      await q(`INSERT INTO platform.vsm_watches (company, agent_id, shape, tool, spec, title, severity, status, created_by) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,'proposed',$8)`,
        [company, agent.id, p.shape, tool, JSON.stringify(spec), p.title.slice(0, 160), p.severity, `${by} (drafted from the tool's tables)`]);
      existing.push(p.title); n++;
    }
  }
  return n;
}
async function agentOf(company, id) {
  const a = (await q("SELECT * FROM platform.vsm_agents WHERE company=$1 AND id=$2", [company, id])).rows[0];
  if (!a) throw notFound("agent");
  return a;
}
async function editAgent(req, company, id, b) {
  const a = await agentOf(company, id);
  const sets = [], vals = [company, id], changed = {};
  if (b.status !== undefined) { if (!["on", "paused"].includes(b.status)) throw bad("An agent is on or paused."); vals.push(b.status); sets.push(`status=$${vals.length}`); changed.status = b.status; }
  if (b.brief !== undefined) { vals.push(txt(b.brief, 2000)); sets.push(`brief=$${vals.length}`); changed.brief = vals[vals.length - 1]; }
  if (!sets.length) throw bad("nothing to change");
  await q(`UPDATE platform.vsm_agents SET ${sets.join(", ")}, updated_at=now() WHERE company=$1 AND id=$2`, vals);
  if (changed.status && changed.status !== a.status) await post({ company, channel: `a:${a.key}`, kind: "note", from_kind: "person", from_name: whoOf(req), agent_id: a.id, words: changed.status === "paused" ? `${a.name} is paused; its watches stop until it is on again.` : `${a.name} is on again.` });
  await record.record("agent_changed", { company, actor: record.actor(req), before: JSON.stringify({ status: a.status, brief: a.brief }), after: JSON.stringify(changed), detail: { agent: a.key } });
  return agentOf(company, id);
}
async function tablesFor(company, id) {
  const a = await agentOf(company, id);
  const out = [];
  for (const tool of a.tools) {
    const { tables } = await tools_().tablesOf(company, tool);
    out.push({ tool, tables: [...tables].map(([name, cols]) => ({ name, columns: cols.map((c) => ({ name: c.name, type: c.type })) })) });
  }
  return out;
}
async function addWatch(req, company, id, b) {
  const a = await agentOf(company, id);
  const tool = String(b.tool || "");
  if (!a.tools.includes(tool)) throw bad(`${a.name} watches ${a.tools.join(", ")}; a watch is on one of those.`);
  const shape = String(b.shape || "");
  const { tables } = shape === "quiet" ? { tables: new Map() } : await tools_().tablesOf(company, tool);
  const spec = checkSpec(shape, b.spec, tables);
  const title = line(b.title, 160); if (!title) throw bad("A watch needs a title: what it looks for, in a line.");
  const severity = SEVERITY.includes(b.severity) ? b.severity : "look";
  const row = (await q(`INSERT INTO platform.vsm_watches (company, agent_id, shape, tool, spec, title, severity, status, created_by) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,'on',$8) RETURNING *`,
    [company, a.id, shape, tool, JSON.stringify(spec), title, severity, whoOf(req)])).rows[0];
  await record.record("agent_watch_added", { company, module: tool, actor: record.actor(req), after: title, detail: { agent: a.key, watch: row.id, shape, spec } });
  return row;
}
async function editWatch(req, company, wid, b) {
  const w = (await q("SELECT * FROM platform.vsm_watches WHERE company=$1 AND id=$2", [company, wid])).rows[0];
  if (!w) throw notFound("watch");
  const next = { status: w.status, title: w.title, severity: w.severity, spec: w.spec, muted_until: w.muted_until };
  if (b.status !== undefined) { if (!["on", "off"].includes(b.status)) throw bad("A watch is on or off."); next.status = b.status; }
  if (b.title !== undefined) { next.title = line(b.title, 160); if (!next.title) throw bad("A watch needs a title."); }
  if (b.severity !== undefined) { if (!SEVERITY.includes(b.severity)) throw bad("A flag is look or act."); next.severity = b.severity; }
  if (b.unmute) next.muted_until = null;
  // the limit only: hours, within, days, the number; the rest of the spec is the watch itself
  const lim = {};
  for (const k of ["hours", "within_hours", "days", "limit"]) if (b[k] !== undefined) lim[k] = b[k];
  if (Object.keys(lim).length) {
    const { tables } = w.shape === "quiet" ? { tables: new Map() } : await tools_().tablesOf(company, w.tool);
    next.spec = checkSpec(w.shape, { ...w.spec, ...lim }, tables);
  }
  await q("UPDATE platform.vsm_watches SET status=$3, title=$4, severity=$5, spec=$6::jsonb, muted_until=$7, updated_at=now() WHERE company=$1 AND id=$2",
    [company, wid, next.status, next.title, next.severity, JSON.stringify(next.spec), next.muted_until]);
  await record.record("agent_watch_changed", { company, module: w.tool, actor: record.actor(req), before: JSON.stringify({ status: w.status, title: w.title, severity: w.severity, spec: w.spec }), after: JSON.stringify(next), detail: { watch: w.id } });
  if (next.status === "off" && w.status === "on") {
    // a watch turned off leaves no flag open behind it
    const open = (await q("UPDATE platform.vsm_flags SET status='cleared', closed_at=now() WHERE watch_id=$1 AND status = ANY($2) RETURNING *", [w.id, OPEN_FLAG])).rows;
    for (const f of open) await post({ company, channel: f.channel, thread_id: f.thread_id, kind: "cleared", from_kind: "person", from_name: whoOf(req), watch_id: w.id, words: `${whoOf(req)} turned this watch off.` });
  }
  return (await q("SELECT * FROM platform.vsm_watches WHERE id=$1", [wid])).rows[0];
}
async function checkNow(company, id) {
  const a = await agentOf(company, id);
  if (a.status !== "on") throw bad(`${a.name} is paused.`);
  const ws = (await q("SELECT * FROM platform.vsm_watches WHERE agent_id=$1 AND status='on' AND (muted_until IS NULL OR muted_until < now()) ORDER BY id", [a.id])).rows;
  const out = [];
  for (const w of ws) out.push({ watch: w.id, ...(await runWatch(w)) });
  await climb();
  return out;
}
const ACTIONS = { seen: "seen", on_it: "on_it", resolved: "resolved", not_a_problem: "not_a_problem", reopen: "open" };
async function flagAction(req, company, threadId, action, b) {
  const f = (await q("SELECT * FROM platform.vsm_flags WHERE company=$1 AND thread_id=$2", [company, threadId])).rows[0];
  if (!f) throw notFound("flag");
  const by = whoOf(req);
  const note = line((b || {}).words, 600);
  if (action === "request") return makeRequest(req, company, f, note);
  if (!ACTIONS[action]) throw bad("That is not something to do with a flag.");
  if (["resolved", "not_a_problem"].includes(action) && !note) throw bad(action === "resolved" ? "Say in a line what was done." : "Say in a line why it is not a problem, so the agent learns.");
  if (action === "reopen" && OPEN_FLAG.includes(f.status)) throw bad("This flag is open.");
  if (action !== "reopen" && !OPEN_FLAG.includes(f.status)) throw bad("This flag is closed. Reopen it first.");
  const closing = ["resolved", "not_a_problem"].includes(action);
  await q(`UPDATE platform.vsm_flags SET status=$3, owner=CASE WHEN $3='on_it' THEN $4 ELSE owner END, status_by=$4, status_at=now(), closed_at=CASE WHEN $5 THEN now() ELSE NULL END WHERE company=$1 AND thread_id=$2`,
    [company, threadId, ACTIONS[action], by, closing]);
  if (action === "not_a_problem" && f.watch_id) await q("UPDATE platform.vsm_watches SET muted_until=now() + ($2::int * interval '1 day') WHERE id=$1", [f.watch_id, MUTE_DAYS]);
  const said = { seen: `${by} has seen this.`, on_it: `${by} is on it.`, resolved: `${by} resolved it: ${note}`, not_a_problem: `${by}: not a problem. ${note} This watch is muted for ${MUTE_DAYS} days.`, reopen: `${by} reopened it.${note ? ` ${note}` : ""}` }[action];
  await post({ company, channel: f.channel, thread_id: threadId, kind: "action", from_kind: "person", from_name: by, agent_id: f.agent_id, watch_id: f.watch_id, words: said });
  await record.record(`agent_flag_${action}`, { company, actor: record.actor(req), after: note || null, detail: { thread: threadId, agent_id: f.agent_id, watch: f.watch_id } });
  return (await q("SELECT * FROM platform.vsm_flags WHERE thread_id=$1", [threadId])).rows[0];
}
// "Make it a request": a card on the Kaizen board, on the flag's tool, carrying the evidence; the proposer reads it at
// once, as a card sent from Ask Anetix does. The manager's approval in Reviewing stays the gate.
async function makeRequest(req, company, f, note) {
  if (f.feedback_id) throw bad(`This flag is already request #${f.feedback_id}.`);
  const w = f.watch_id ? (await q("SELECT tool FROM platform.vsm_watches WHERE id=$1", [f.watch_id])).rows[0] : null;
  const tool = w && w.tool;
  const row = tool ? await require("./registry").getModule(company, tool) : null;
  if (!row || !row.live_version) throw bad("This flag's tool is not on the floor, so the request has nowhere to go. Write it on the Kaizen board.");
  const root = (await q("SELECT words FROM platform.vsm_messages WHERE id=$1", [f.thread_id])).rows[0];
  const message = `From the agent board: ${root.words}${note ? `\n\n${note}` : ""}`.slice(0, 2000);
  const by = whoOf(req);
  const fb = (await q(`INSERT INTO platform.feedback (company, module, page, message, name, person_id, reply_token, source, source_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,'agent_board',$8) RETURNING id, module`,
    [company, tool, `/c/${company}/m/${tool}/`, message, by.slice(0, 80), req.sosPersonId || null, require("./arrival").newToken(), f.thread_id])).rows[0];
  await q("UPDATE platform.vsm_flags SET feedback_id=$2 WHERE thread_id=$1", [f.thread_id, fb.id]);
  await post({ company, channel: f.channel, thread_id: f.thread_id, kind: "action", from_kind: "person", from_name: by, agent_id: f.agent_id, watch_id: f.watch_id, words: `${by} made this a request on the Kaizen board (#${fb.id}).` });
  await record.record("feedback_filed", { company, module: tool, actor: record.actor(req), feedback_id: fb.id, after: message, detail: { via: "agent_board", thread: f.thread_id } });
  const reading = await require("./arrival").start(fb.id, { force: true }).catch(() => false);
  return { feedback_id: fb.id, proposing: reading };
}

// ---- the board: channels and the stream ------------------------------------------------------------------------------
const CHANNEL = /^(plant|escalations|a:[a-z0-9-]{1,40}|b:[a-z0-9_-]{1,40}\/[a-z0-9_-]{1,40})$/i;
async function channels(company) {
  const { agents } = await overview(company);
  const { nodes } = await mapBoxes(company);
  const out = [{ key: "plant", name: "plant", kind: "plant" }, { key: "escalations", name: "escalations", kind: "escalations" }];
  const open = (await q("SELECT channel, count(*)::int AS n FROM platform.vsm_flags WHERE company=$1 AND status = ANY($2) GROUP BY channel", [company, OPEN_FLAG])).rows;
  const climbed = (await q("SELECT count(*)::int AS n FROM platform.vsm_flags WHERE company=$1 AND status = ANY($2) AND climbed_at IS NOT NULL", [company, OPEN_FLAG])).rows[0].n;
  out[1].open = climbed;
  out[0].open = open.reduce((a, r) => a + r.n, 0);
  for (const a of agents.filter((x) => x.set_up)) out.push({ key: `a:${a.key}`, name: a.name, kind: "agent", status: a.status, open: (open.find((r) => r.channel === `a:${a.key}`) || {}).n || 0 });
  // a box with no agent of its own has a channel for the mentions that reach its people
  const set = new Set(agents.filter((a) => a.set_up && a.status === "on").map((a) => a.key));
  for (const n of nodes.filter((x) => ["process", "control", "store"].includes(x.kind) && !set.has(slugify(x.agent_name)))) out.push({ key: `b:${n.map_key}/${n.key}`, name: n.label, kind: "box", family: n.family, people: n.who || "" });
  return out;
}
async function stream(company, { channel = "plant", before = null, limit = 50 } = {}) {
  if (!CHANNEL.test(channel)) throw bad("no such channel");
  const lim = Math.min(100, Math.max(1, Number(limit) || 50));
  const vals = [company, lim];
  let where = "m.company=$1 AND m.thread_id IS NULL";
  if (channel === "escalations") where += " AND EXISTS (SELECT 1 FROM platform.vsm_flags f WHERE f.thread_id=m.id AND f.climbed_at IS NOT NULL)";
  else if (channel.startsWith("a:")) { vals.push(channel, JSON.stringify([{ kind: "agent", key: channel.slice(2) }])); where += ` AND (m.channel=$3 OR m.to_list @> $4::jsonb)`; }
  else if (channel.startsWith("b:")) { vals.push(channel, JSON.stringify([{ kind: "box", key: channel.slice(2) }])); where += ` AND (m.channel=$3 OR m.to_list @> $4::jsonb)`; }
  if (before) { vals.push(Number(before) || 0); where += ` AND m.id < $${vals.length}`; }
  const roots = (await q(`SELECT m.*, f.status AS flag_status, f.severity AS flag_severity, f.count AS flag_count, f.owner, f.feedback_id, f.climbed_at, f.raised_at, f.closed_at, f.status_by,
                                 (SELECT count(*)::int FROM platform.vsm_messages r WHERE r.thread_id=m.id) AS replies,
                                 (SELECT max(r.created_at) FROM platform.vsm_messages r WHERE r.thread_id=m.id) AS last_reply_at
                            FROM platform.vsm_messages m LEFT JOIN platform.vsm_flags f ON f.thread_id=m.id
                           WHERE ${where} ORDER BY greatest(m.created_at, coalesce((SELECT max(r.created_at) FROM platform.vsm_messages r WHERE r.thread_id=m.id), m.created_at)) DESC, m.id DESC LIMIT $2`, vals)).rows;
  return roots.map(msgOut);
}
const msgOut = (m) => ({ id: m.id, channel: m.channel, thread_id: m.thread_id, kind: m.kind, severity: m.severity, from_kind: m.from_kind, from_name: m.from_name, to: m.to_list || [], evidence: m.evidence, words: m.words, created_at: m.created_at,
  ...(m.flag_status !== undefined && m.flag_status !== null ? { flag: { status: m.flag_status, severity: m.flag_severity, count: m.flag_count, owner: m.owner, feedback_id: m.feedback_id, climbed_at: m.climbed_at, raised_at: m.raised_at, closed_at: m.closed_at, status_by: m.status_by } } : {}),
  ...(m.replies !== undefined ? { replies: m.replies, last_reply_at: m.last_reply_at } : {}) });
async function thread(company, id) {
  const root = (await q(`SELECT m.*, f.status AS flag_status, f.severity AS flag_severity, f.count AS flag_count, f.owner, f.feedback_id, f.climbed_at, f.raised_at, f.closed_at, f.status_by
                           FROM platform.vsm_messages m LEFT JOIN platform.vsm_flags f ON f.thread_id=m.id WHERE m.company=$1 AND m.id=$2 AND m.thread_id IS NULL`, [company, id])).rows[0];
  if (!root) throw notFound("thread");
  const replies = (await q("SELECT * FROM platform.vsm_messages WHERE company=$1 AND thread_id=$2 ORDER BY id", [company, id])).rows;
  return { root: msgOut(root), replies: replies.map(msgOut) };
}
async function say(req, company, b) {
  const words = txt(b.words, 2000);
  if (!words) throw bad("Write something first.");
  let channel = String(b.channel || "plant"), threadId = null;
  if (b.thread_id) {
    const root = (await q("SELECT id, channel FROM platform.vsm_messages WHERE company=$1 AND id=$2 AND thread_id IS NULL", [company, Number(b.thread_id) || 0])).rows[0];
    if (!root) throw notFound("thread");
    threadId = root.id; channel = root.channel;
  }
  if (!CHANNEL.test(channel) || channel === "escalations") throw bad("Write in #plant, an area's channel, or a thread.");
  const m = await post({ company, channel, thread_id: threadId, kind: threadId ? "reply" : "note", from_kind: "person", from_name: whoOf(req), words });
  await record.record("agent_board_message", { company, actor: record.actor(req), after: words, detail: { channel, thread: threadId, message: m.id } });
  return msgOut(m);
}
// The Map's agents layer: each agent's status and open flags, and the boxes with a flag that climbed
async function chips(company) {
  const { agents } = await overview(company);
  const climbedBoxes = (await q("SELECT DISTINCT jsonb_array_elements_text(boxes) AS box FROM platform.vsm_flags WHERE company=$1 AND status = ANY($2) AND climbed_at IS NOT NULL", [company, OPEN_FLAG])).rows.map((r) => r.box);
  return { agents: agents.map((a) => ({ key: a.key, name: a.name, status: a.status, open: a.open, climbed: a.climbed, can_set_up: a.can_set_up })), climbed_boxes: climbedBoxes };
}
async function deleteCompany(company) {
  for (const t of ["vsm_flags", "vsm_messages", "vsm_watches", "vsm_agents"]) await q(`DELETE FROM platform.${t} WHERE company=$1`, [company]);
}

// ---- routes: managers and admins (every path under /api/c/:slug/, every id checked in its own WHERE) ---------------
const router = express.Router();
const requireManager = (req, res, next) => require("./auth").requireManager(req, res, next);
const slugOf = (req) => String(req.params.slug || "").toLowerCase();
const small = express.json({ limit: "32kb" });
const ID = ":id(\\d{1,9})";
const A = "/api/c/:slug/vsm/agents", B = "/api/c/:slug/vsm/board";
router.get(A, requireManager, async (req, res) => res.json(await overview(slugOf(req))));
router.post(A, requireManager, small, async (req, res) => res.json({ ok: true, agent: await setUp(req, slugOf(req), (req.body || {}).key) }));
router.post(`${A}/${ID}`, requireManager, small, async (req, res) => res.json({ ok: true, agent: await editAgent(req, slugOf(req), Number(req.params.id), req.body || {}) }));
router.get(`${A}/${ID}/tables`, requireManager, async (req, res) => res.json({ tools: await tablesFor(slugOf(req), Number(req.params.id)) }));
// "Look again": the agent takes the tools now on its boxes (a tool added to the map since it was set up) and drafts
// watches for what it does not watch yet
router.post(`${A}/${ID}/propose`, requireManager, async (req, res) => {
  const slug = slugOf(req), a = await agentOf(slug, Number(req.params.id));
  const now = ((await overview(slug)).agents.find((x) => x.key === a.key) || {}).tools || [];
  const tools = [...new Set([...a.tools, ...now])];
  if (tools.length !== a.tools.length) await q("UPDATE platform.vsm_agents SET tools=$2, updated_at=now() WHERE id=$1", [a.id, tools]);
  res.json({ ok: true, proposed: await proposeWatches(slug, { ...a, tools }, whoOf(req)) });
});
router.post(`${A}/${ID}/check`, requireManager, async (req, res) => res.json({ ok: true, results: await checkNow(slugOf(req), Number(req.params.id)) }));
router.post(`${A}/${ID}/watches`, requireManager, small, async (req, res) => res.json({ ok: true, watch: await addWatch(req, slugOf(req), Number(req.params.id), req.body || {}) }));
router.post(`/api/c/:slug/vsm/watches/${ID}`, requireManager, small, async (req, res) => res.json({ ok: true, watch: await editWatch(req, slugOf(req), Number(req.params.id), req.body || {}) }));
router.get(B, requireManager, async (req, res) => {
  const slug = slugOf(req);
  res.json({ channels: await channels(slug), messages: await stream(slug, { channel: String(req.query.channel || "plant"), before: req.query.before || null }), role: req.sosRole, push: PUSH() });
});
router.get(`${B}/threads/${ID}`, requireManager, async (req, res) => res.json(await thread(slugOf(req), Number(req.params.id))));
router.post(`${B}/messages`, requireManager, small, async (req, res) => res.json({ ok: true, message: await say(req, slugOf(req), req.body || {}) }));
router.post(`${B}/flags/${ID}/:action(seen|on_it|resolved|not_a_problem|reopen|request)`, requireManager, small, async (req, res) => res.json({ ok: true, result: await flagAction(req, slugOf(req), Number(req.params.id), req.params.action, req.body || {}) }));

module.exports = {
  init, SCHEMA, TABLES, router, tick, climb, runWatch, evaluate, checkSpec, watchQuery, proposeFor, limitWords, agentsFrom, partiesOf, pushOf, overview, setUp, addWatch, editWatch, checkNow,
  flagAction, channels, stream, thread, say, chips, deleteCompany, SHAPES, SHAPE_WORDS, slugify,
};
