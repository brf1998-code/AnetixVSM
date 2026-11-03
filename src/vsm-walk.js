// The mapping walk (docs/VSM.md section 5, milestone M2, 2026-11-01): the agent that guides a manager, or Anetix as a
// service, through mapping one product family of the plant, and draws the map from what was settled.
//
// Brendan's calls for M2 (2026-11-01):
//   - "Confirm the guess": the sources are read once, then the walk goes upstream from shipping, one step at a time,
//     each step a card pre-filled from the sources (who, what tells them to start, where its record lives, what waits
//     before it, any number anyone said). The manager says "Looks right" or changes a field. About two screens a step:
//     which step comes before this one, then its card.
//   - Board and admin MCP now: managers and admins run it from the Map tab, and Anetix's own connected AI app can
//     start a walk, add transcripts and notes, have them read, and answer in bulk (src/mcp-vsm.js).
//   - The result is a draft beside the current map ("Mechanical, walk draft"), so the two can be compared; "Use this
//     map" (board only) replaces the family's map, and the old one is kept, hidden, not deleted.
//
// The phases, as the walk's status and screen:
//   sources   add what went into the walk: transcripts and notes typed or pasted, the plant's documents (pdf, a text
//             file, a spreadsheet export), photos of a whiteboard or a traveler. Every file goes through scan.check
//             before it is kept (src/scan.js); the bytes live in platform.attachments with walk_id set, so the
//             scanner's look-behind, the backup and the company delete cover them.
//   reading   one model call (the company's design model, metered as "mapping") reads every source and writes the
//             candidates: families, the customer, systems, production control in order, the material steps of each
//             family in order with who, trigger, record, waits, numbers and a quote from a source, the supplier, and
//             the open questions. Nothing is estimated: a number nobody said is "?". Generated words go through the
//             plain-words scrub; quotes are the person's own words and are kept as they are.
//   walking   frame (which family, the customer and demand, the systems in use), then the walk upstream from
//             shipping (last, card, before, card, ... until "this is where it starts"), then the supplier, then
//             production control end to end, then a review of the whole walk.
//   drafted   platform code (no model) draws the map: the process row in flow order, production control in its band,
//             supplier and customer, push flows with what waits before each step, the information flows from each
//             step's trigger, data boxes, and the review questions (every "?", every step the manager was unsure of,
//             the reader's open questions, every step the sources mention that the walk left out).
//   used      the draft replaced the family's map.
//   failed    the read failed (the error is kept; reading again retries); abandoned: put away by a manager.
//
// Rules this file keeps:
//   - Under the data wall the walk still runs on what people say and type (the rule for typed words); photos and pdfs
//     are named to the model, never sent (agent.atWall drops them anyway). The walk never reads a tool's records.
//   - Nothing here moves anything toward the floor. The map is a picture of the plant; no tool changes.
//   - A company's people never read a model name or an AI cost: the walk's model and cost go to admins only.
//   - Every route is under /api/c/:slug/ (auth.companyGuard scopes it) and every id is checked against the company in
//     its own WHERE. Every write goes on the record.
const express = require("express");
const { q, pool } = require("./db");
const record = require("./record");
const agent = require("./agent");
const plain = require("./plainwords");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS platform.vsm_walks (
  id          SERIAL PRIMARY KEY,
  company     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'sources',
  via         TEXT NOT NULL DEFAULT 'board',
  started_by  TEXT,
  extraction  JSONB,
  frame       JSONB NOT NULL DEFAULT '{}'::jsonb,
  steps       JSONB NOT NULL DEFAULT '{}'::jsonb,
  chain       JSONB NOT NULL DEFAULT '[]'::jsonb,
  walk        JSONB NOT NULL DEFAULT '{}'::jsonb,
  map_id      INTEGER,
  from_walk   INTEGER,
  model       TEXT,
  cost_usd    NUMERIC NOT NULL DEFAULT 0,
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS platform.vsm_sources (
  id             SERIAL PRIMARY KEY,
  company        TEXT NOT NULL,
  walk_id        INTEGER NOT NULL REFERENCES platform.vsm_walks(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL,
  title          TEXT NOT NULL,
  words          TEXT,
  attachment_id  INTEGER,
  chars          INTEGER NOT NULL DEFAULT 0,
  size           INTEGER NOT NULL DEFAULT 0,
  added_by       TEXT,
  via            TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vsm_walks_company ON platform.vsm_walks (company, id);
CREATE INDEX IF NOT EXISTS vsm_sources_walk ON platform.vsm_sources (walk_id, id);
ALTER TABLE platform.attachments ADD COLUMN IF NOT EXISTS walk_id INTEGER;
ALTER TABLE platform.vsm_maps ADD COLUMN IF NOT EXISTS walk_id INTEGER;
ALTER TABLE platform.vsm_maps ADD COLUMN IF NOT EXISTS proposed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE platform.vsm_maps ADD COLUMN IF NOT EXISTS replaced_at TIMESTAMPTZ;`;
async function init() {
  await q(SCHEMA);
  // a read that was running when the instance restarted will never finish: say so, and let it be read again
  await q(`UPDATE platform.vsm_walks SET status='failed', error='The instance restarted while the sources were being read. Read them again.', updated_at=now() WHERE status='reading'`);
}

const TABLES = ["vsm_walks", "vsm_sources"];
const OPEN = ["sources", "reading", "walking", "drafted", "failed"];
const SCREEN_WORDS = {
  sources: "adding sources", reading: "reading the sources", family: "which family to map", customer: "the customer and demand", systems: "the systems in use",
  last: "the last step before the customer", card: "a step's card", before: "the step before", supplier: "the supplier", control: "production control", review: "the review before drawing",
  drafted: "drawn", used: "used", abandoned: "put away",
};
const STATUS_WORDS = {
  sources: "adding sources", reading: "the agent is reading the sources", walking: "walking the family with the manager", drafted: "the draft map is beside the current one",
  used: "the draft became the family's map", failed: "the read failed; reading again retries it", abandoned: "put away",
};
const RECORD = ["anetix", "other", "paper", "none"];
const HOW = ["system", "paper", "word"];
const CONF = ["heard", "seen", "assumed"];
const MAX_SOURCES = 20, MAX_WORDS = 300000, MAX_WORDS_TOTAL = 400000, MAX_FILES = 8;
const MAX_FILE_BYTES = 15 * 1024 * 1024, MAX_FILE_BYTES_TOTAL = 20 * 1024 * 1024;
const MAX_STEPS = 24, MAX_CONTROL = 6, MAX_QUESTIONS = 40;
const WORD_KINDS = { transcript: "a call or walk-through transcript", notes: "notes", document: "a document", email: "an email" };

const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
const notFound = (what) => Object.assign(new Error(`no such ${what}`), { status: 404 });
const txt = (v, n) => String(v == null ? "" : v).replace(/\r\n?/g, "\n").replace(/\u0000/g, "").trim().slice(0, n);
const line = (v, n) => txt(v, n).replace(/\s*\n+\s*/g, " ");
const isObj = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const slugify = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 28);
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const sameName = (a, b) => { const x = norm(a), y = norm(b); if (!x || !y) return false; return x === y || x.startsWith(y) || y.startsWith(x) || x.split(" ")[0] === y.split(" ")[0]; };
const unknown = (v) => !v || /^\?+$/.test(String(v).trim()) || /^\?\s/.test(String(v).trim());
const short = (s, n) => { const t = line(s, 400); return t.length <= n ? t : `${t.slice(0, n - 1).replace(/\s+\S*$/, "")}…`; };

// ---- reading the rows ------------------------------------------------------------------------------------------------
async function getWalk(company, id) {
  const w = (await q("SELECT * FROM platform.vsm_walks WHERE company=$1 AND id=$2", [company, id])).rows[0];
  if (!w) throw notFound("walk");
  return w;
}
async function sourcesOf(walkId, withBody = false) {
  return (await q(`SELECT s.id, s.kind, s.title, s.chars, s.size, s.added_by, s.via, s.created_at, s.attachment_id, a.mime, a.filename, (s.attachment_id IS NOT NULL AND a.id IS NULL) AS gone
                     ${withBody ? ", s.words, a.bytes" : ""}
                     FROM platform.vsm_sources s LEFT JOIN platform.attachments a ON a.id = s.attachment_id WHERE s.walk_id=$1 ORDER BY s.id`, [walkId])).rows;
}
async function companyTools(company) {
  return (await q("SELECT name, title, live_version FROM platform.modules WHERE company=$1 AND archived_at IS NULL ORDER BY title", [company])).rows
    .map((m) => ({ name: m.name, title: m.title || m.name, live: Boolean(m.live_version) }));
}
async function currentMaps(company) {
  // a family's future state (src/vsm-kaizen.js) is not a family of its own
  return (await q("SELECT id, key, family, title, walk_id, proposed, sort FROM platform.vsm_maps WHERE company=$1 AND replaced_at IS NULL AND state <> 'future' ORDER BY sort, id", [company])).rows;
}

// ---- starting a walk, and its sources ----------------------------------------------------------------------------------
// opts: { by: who for the record's words, actor, via: 'board' | 'anetix', fromWalk: map another family from the same
// sources (its sources and its read are carried over, nothing is read again) }
async function start(company, opts = {}) {
  if (!(await q("SELECT 1 FROM platform.companies WHERE slug=$1", [company])).rows[0]) throw notFound("company");
  const via = opts.via === "anetix" ? "anetix" : "board";
  if (via === "anetix" && !opts.fromWalk) {
    // a connected app carries on with Anetix's own walk that has not been read yet, instead of starting a second
    const open = (await q("SELECT id FROM platform.vsm_walks WHERE company=$1 AND via='anetix' AND status IN ('sources','failed') ORDER BY id DESC LIMIT 1", [company])).rows[0];
    if (open) return { id: open.id, carried_on: true };
  }
  let base = null;
  if (opts.fromWalk) {
    base = (await q("SELECT * FROM platform.vsm_walks WHERE company=$1 AND id=$2", [company, Number(opts.fromWalk)])).rows[0];
    if (!base) throw notFound("walk");
    if (!base.extraction) throw bad("That walk has not read its sources yet, so there is nothing to carry over.");
  }
  const frame = base ? { customer: (base.frame || {}).customer || null, customer_done: false, systems: (base.frame || {}).systems || [], systems_done: Boolean((base.frame || {}).systems_done) } : {};
  const row = (await q(`INSERT INTO platform.vsm_walks (company, status, via, started_by, extraction, frame, from_walk, model) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8) RETURNING id`,
    [company, base ? "walking" : "sources", via, txt(opts.by, 120) || null, base ? JSON.stringify(base.extraction) : null, JSON.stringify(frame), base ? base.id : null, base ? base.model : null])).rows[0];
  if (base) await q(`INSERT INTO platform.vsm_sources (company, walk_id, kind, title, words, attachment_id, chars, size, added_by, via)
                     SELECT company, $2, kind, title, words, attachment_id, chars, size, added_by, via FROM platform.vsm_sources WHERE walk_id=$1 ORDER BY id`, [base.id, row.id]);
  await record.record("map_walk_started", { company, actor: opts.actor, detail: { walk: row.id, via, from_walk: base ? base.id : null } });
  return { id: row.id, carried_on: false };
}
function assertAdding(w) {
  if (!["sources", "failed"].includes(w.status)) throw bad("The sources were already read. To add more, read them again (the walk starts over from the sources; what was added stays).");
}
async function totals(walkId) {
  return (await q(`SELECT count(*)::int AS n, coalesce(sum(chars),0)::int AS chars, count(*) FILTER (WHERE attachment_id IS NOT NULL)::int AS files,
                          coalesce(sum(size) FILTER (WHERE attachment_id IS NOT NULL),0)::bigint AS bytes FROM platform.vsm_sources WHERE walk_id=$1`, [walkId])).rows[0];
}
async function addWords(company, id, body, opts = {}) {
  const w = await getWalk(company, id);
  assertAdding(w);
  const words = String((body || {}).words == null ? "" : body.words).replace(/\r\n?/g, "\n").replace(/\u0000/g, "").trim();
  if (!words) throw bad("There are no words to add.");
  if (words.length > MAX_WORDS) throw bad(`That is more than ${MAX_WORDS.toLocaleString("en-US")} characters. Split it in two.`);
  const kind = Object.keys(WORD_KINDS).includes(body.kind) ? body.kind : "notes";
  const title = line(body.title, 120) || (kind === "transcript" ? "Transcript" : "Notes");
  const t = await totals(id);
  if (t.n >= MAX_SOURCES) throw bad(`This walk already has ${MAX_SOURCES} sources. Remove one first.`);
  if (t.chars + words.length > MAX_WORDS_TOTAL) throw bad(`All the words together would be more than ${MAX_WORDS_TOTAL.toLocaleString("en-US")} characters, more than one read can take. Leave out the parts that are not about the floor.`);
  const row = (await q(`INSERT INTO platform.vsm_sources (company, walk_id, kind, title, words, chars, added_by, via) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [company, id, kind, title, words, words.length, txt(opts.by, 120) || null, opts.via || "board"])).rows[0];
  await q("UPDATE platform.vsm_walks SET updated_at=now() WHERE id=$1", [id]);
  await record.record("map_source_added", { company, actor: opts.actor, after: title, detail: { walk: id, source: row.id, kind, chars: words.length } });
  return row.id;
}
// A file: a pdf or a photo is kept as it is and sent to the model at the read; a text file or a spreadsheet becomes
// words. Every one is scanned before anything of it is kept.
function fileKind(mime, filename) {
  const m = String(mime || "").toLowerCase(), ext = String(filename || "").toLowerCase().split(".").pop();
  if (m === "application/pdf" || ext === "pdf") return "pdf";
  if (/^image\/(jpeg|png|webp|gif)$/.test(m) || ["jpg", "jpeg", "png", "webp", "gif"].includes(ext)) return "image";
  if (/spreadsheetml/.test(m) || ext === "xlsx" || ext === "csv" || ext === "tsv") return "sheet";
  if (/^text\//.test(m) || ["txt", "md", "vtt", "srt", "text"].includes(ext)) return "text";
  return null;
}
const IMAGE_MIME = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };
async function addFile(company, id, body, opts = {}) {
  const w = await getWalk(company, id);
  assertAdding(w);
  const filename = line((body || {}).filename, 200) || "file";
  const kind = fileKind(body.mime, filename);
  if (!kind) throw bad("That kind of file cannot be read here. A pdf, a photo, a text file, a csv or an xlsx works; a Word file can be saved as a pdf.");
  const buf = Buffer.from(String(body.data || ""), "base64");
  if (!buf.length) throw bad("The file was empty.");
  if (buf.length > MAX_FILE_BYTES) throw bad(`That file is bigger than ${MAX_FILE_BYTES / 1048576} MB.`);
  const t = await totals(id);
  if (t.n >= MAX_SOURCES) throw bad(`This walk already has ${MAX_SOURCES} sources. Remove one first.`);
  const sc = await require("./scan").check({ company, bytes: buf, what: "map source", filename, ids: { walk_id: id } });
  if (kind === "text" || kind === "sheet") {
    let words;
    if (kind === "sheet") {
      let p;
      try { p = require("./attachments").parseSheet(buf, body.mime, filename); } catch (e) { throw bad(`That spreadsheet could not be read (${e.message}). Save it as csv and try again.`); }
      words = [p.headers.join(" | "), ...p.rows.map((r) => r.join(" | "))].join("\n") + (p.row_count > p.rows.length ? `\n... ${p.row_count - p.rows.length} more rows` : "");
    } else words = buf.toString("utf8").replace(/^﻿/, "");
    return addWords(company, id, { words, title: filename, kind: "document" }, opts);
  }
  if (t.files >= MAX_FILES) throw bad(`This walk already has ${MAX_FILES} files. Remove one first.`);
  if (Number(t.bytes) + buf.length > MAX_FILE_BYTES_TOTAL) throw bad(`The files together would be more than ${MAX_FILE_BYTES_TOTAL / 1048576} MB, more than one read can take.`);
  const ext = filename.toLowerCase().split(".").pop();
  const mime = kind === "pdf" ? "application/pdf" : (/^image\//.test(String(body.mime || "")) ? String(body.mime).toLowerCase() : IMAGE_MIME[ext] || "image/jpeg");
  const a = (await q(`INSERT INTO platform.attachments (company, walk_id, filename, mime, size, bytes, scan, scanned_at, scan_sig) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [company, id, filename, mime, buf.length, buf, sc.scan, sc.scanned_at, sc.scan_sig])).rows[0];
  const row = (await q(`INSERT INTO platform.vsm_sources (company, walk_id, kind, title, attachment_id, size, added_by, via) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [company, id, kind === "pdf" ? "pdf" : "photo", filename, a.id, buf.length, txt(opts.by, 120) || null, opts.via || "board"])).rows[0];
  await q("UPDATE platform.vsm_walks SET updated_at=now() WHERE id=$1", [id]);
  await record.record("map_source_added", { company, actor: opts.actor, after: filename, detail: { walk: id, source: row.id, kind, size: buf.length } });
  return row.id;
}
async function removeSource(company, id, sid, opts = {}) {
  const w = await getWalk(company, id);
  assertAdding(w);
  const s = (await q("SELECT id, title, attachment_id FROM platform.vsm_sources WHERE company=$1 AND walk_id=$2 AND id=$3", [company, id, sid])).rows[0];
  if (!s) throw notFound("source");
  await q("DELETE FROM platform.vsm_sources WHERE id=$1", [s.id]);
  // the bytes go with the last source that points at them (a walk for another family shares its files)
  if (s.attachment_id && !(await q("SELECT 1 FROM platform.vsm_sources WHERE attachment_id=$1", [s.attachment_id])).rows[0]) await q("DELETE FROM platform.attachments WHERE id=$1 AND company=$2 AND walk_id IS NOT NULL", [s.attachment_id, company]);
  await record.record("map_source_removed", { company, actor: opts.actor, before: s.title, detail: { walk: id, source: s.id } });
}

// ---- the read ----------------------------------------------------------------------------------------------------------
const EXTRACT_SCHEMA = (() => {
  const S = (description) => ({ type: "string", ...(description ? { description } : {}) });
  const E = (values, description) => ({ type: "string", enum: values, ...(description ? { description } : {}) });
  const obj = (properties) => ({ type: "object", properties, required: Object.keys(properties) });
  const arr = (items, maxItems, description) => ({ type: "array", items, ...(maxItems ? { maxItems } : {}), ...(description ? { description } : {}) });
  const SRC = { type: "integer", description: "The number of the source the quote is from; 0 when there is no quote." };
  return obj({
    plant: obj({ makes: S("What the plant makes, one line."), orders: S("How orders arrive, one line.") }),
    families: arr(obj({ key: S("A short id: lowercase letters and digits."), name: S("The family's name, the way the plant says it."), products: S("Which products are in it."), why: S("One line: what the products share.") }), 6),
    customer: obj({ who: S("Who buys (the kinds of customer)."), demand: S("Demand as said, with units and hedges; ? when nobody said."), ships: S("How often the plant ships; ? when nobody said."), quote: S(), source: SRC }),
    systems: arr(obj({ name: S("The system's own name."), used_for: S("What it is used for here, one line.") }), 12),
    people: arr(obj({ name: S(), role: S("Their job, in the plant's words.") }), 30),
    control: arr(obj({
      key: S("A short id."), name: S("Two to four words."), who: S(), what: S("One line."),
      how: E(HOW, "How it is passed on to the next step: system = in a system; paper = on paper, a list or a whiteboard; word = in person, a call, an email or a text."),
      system: S("The system or paper it lives in, by name; empty when none."), record_kind: E(RECORD), tools: arr(S("An Anetix tool's name from the list.")), quote: S(), source: SRC,
    }), MAX_CONTROL, "Production control end to end, in order: how an order becomes work on the floor."),
    steps: arr(obj({
      key: S("A short id."), families: arr(S("A family key.")), name: S("Two to four words."), who: S(), where: S("Where in the plant."), what: S("What happens, one line."),
      trigger: obj({ from: S("arrival = the work arriving from the step before; person = someone tells them; or the key of a production control step."), how: E(HOW), text: S("In their words, one line.") }),
      record_kind: E(RECORD), record_system: S("The system or paper, by name; empty when none."), tools: arr(S("An Anetix tool's name from the list.")), stages: arr(S("A ref from the plant's stage list.")),
      waits_before: S("What waits before this step, as said (a count, a rack, a cart, days); ? when nobody said."),
      numbers: arr(obj({ label: S("C/T, C/O, Uptime, Operators, Batch, Scrap, First pass, or the plant's own label."), value: S("As said, with units; never estimated.") }), 8),
      recorded: S("What is recorded today, one line."), missing: S("What is not recorded, one line."), quote: S(), source: SRC, confidence: E(CONF),
    }), MAX_STEPS, "The material steps of each family, in the order the work moves, first step first and the last step before the customer last."),
    supplier: obj({ name: S(), what: S("What they send."), how_ordered: S("How it is ordered, one line."), record_kind: E(RECORD), record_system: S() }),
    questions: arr(obj({ step: S("The key of the step or production control step it is about; empty for the whole plant."), claim: S("What you are guessing, one sentence."), why: S("Why it is unsure, one line."), ask: S("Who would know.") }), 20),
  });
})();

const BRIEF = `Read the sources above (call and walk-through transcripts, notes, the plant's own documents, photos) and pull out what a value stream map of this plant needs, the way a lean practitioner draws one (Rother and Shook, Learning to See). This is the first pass of a mapping walk: the manager will confirm or correct every step you find, one at a time, walking upstream from shipping. Your job is to make each guess good and to say where it came from.

What to find:
1. Product families: groups of products that share most of their steps. Usually two to four. Name them the way the plant does.
2. The customer and demand: who buys, how much and how often (as said, with units), how often the plant ships.
3. The systems in use, by the plant's own names (the order system, the inventory or ERP system, accounting, a CRM, spreadsheets, and the Anetix tools listed below), and what each is used for here.
4. Production control end to end, in order: how an order becomes work on the floor (the order coming in, the build order or work order, priority, the daily list or dispatch). At most ${MAX_CONTROL} steps. For each, who does it and how it is passed on.
5. The material steps of each family, in the order the work moves: the first step first, the last step before the customer (packing and shipping) last. A step is where the product is worked on, checked, or waits for a decision. A meeting, a report or typing in an order is production control, not a step. Merge what is one step on the floor; split where the work changes hands or waits. At most ${MAX_STEPS} steps across all families; a step two families share is listed once, with both families.
6. For each step: who does it, where, what happens, what tells them to start (the work arriving, a production control step, or someone telling them; by system, paper or word of mouth), where its record lives today, what waits before it, and every number anyone said (cycle time, changeover, uptime, batch size, operators, scrap, first pass yield).
7. The main supplier (or the outside shop), what they send and how it is ordered.
8. Questions: where you are guessing or the sources disagree, each for the person who would know. At most 20.

Where a record lives (record_kind): anetix = an Anetix tool from the list below keeps it (name the tool); other = another system (name it); paper = paper, a whiteboard, a printed list, a spreadsheet kept by hand, an email or a text; none = nothing is kept, it is in someone's head or said in passing.

Rules:
- Never estimate a number. A number nobody said is "?". Keep the units and the hedges people used ("about 45 minutes").
- A quote is a person's own words copied exactly from one source, one or two sentences, with that source's number. Pick the quote that best shows why you believe the step is as you say. No quote is better than one that is not in the source.
- confidence: seen = a document or a tool shows it; heard = someone said it; assumed = you inferred it, and then there is a question about it.
- Use the plant's own names for people, places, products and systems. Plain words: the manager reads every line.`;

async function contextFor(w) {
  const company = w.company;
  const sources = await sourcesOf(w.id, true);
  const walled = await require("./datawall").isWalled(company);
  const tools = await companyTools(company);
  const stages = (await q("SELECT ref, name FROM platform.vsm_stages WHERE company=$1 ORDER BY sort, ref", [company])).rows;
  const maps = (await currentMaps(company)).filter((m) => !m.proposed);
  const doc = (await q("SELECT content FROM platform.agent_docs WHERE company=$1 AND module IS NULL AND name='COMPANY.md' AND content <> ''", [company])).rows[0];
  const blocks = [];
  sources.forEach((s, i) => {
    const n = i + 1;
    if (s.words != null) blocks.push({ type: "text", text: `Source ${n}: "${s.title}" (${WORD_KINDS[s.kind] || "notes"})\n<<<\n${s.words}\n>>>` });
    else if (s.gone || !s.bytes) blocks.push({ type: "text", text: `Source ${n}: "${s.title}" was removed by the malware scan and cannot be read.` });
    else if (walled) blocks.push({ type: "text", text: `Source ${n}: "${s.title}", a ${s.kind === "pdf" ? "pdf" : "photo"}. It is withheld: this company's data is walled off from the AI.` });
    else if (s.kind === "pdf") { blocks.push({ type: "text", text: `Source ${n}: "${s.title}", a pdf:` }); blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: s.bytes.toString("base64") } }); }
    else { blocks.push({ type: "text", text: `Source ${n}: "${s.title}", a photo:` }); blocks.push({ type: "image", source: { type: "base64", media_type: s.mime || "image/jpeg", data: s.bytes.toString("base64") } }); }
  });
  const company_name = ((await q("SELECT name FROM platform.companies WHERE slug=$1", [company])).rows[0] || {}).name || company;
  const system = `You are the agent inside a factory operating system (call yourself "the agent" if you ever need a name; never name the model or the company that makes it), helping the production manager of ${company_name} map the plant's value stream. The manager knows the operation; everything you write is read by that manager.${walled ? `\n\n${require("./datawall").PROMPT_NOTE}` : ""}\n\n${plain.rules()}${doc ? `\n\nWhat the plant has said about itself (COMPANY.md):\n${doc.content.slice(0, 6000)}` : ""}`;
  const prompt = [
    BRIEF,
    tools.length ? `Anetix tools this company has (name: what it is called on the floor): ${tools.map((t) => `${t.name}: ${t.title}${t.live ? "" : " (not live yet)"}`).join("; ")}.` : "This company has no Anetix tools yet.",
    stages.length ? `The plant's own stage list (put a stage's ref in a step's stages when the step is that stage): ${stages.map((s) => `${s.ref} ${s.name}`).join("; ")}.` : "",
    maps.length ? `Families already on the plant's map (use the same names when the sources speak of the same products): ${maps.map((m) => m.family).join("; ")}.` : "",
  ].filter(Boolean).join("\n\n");
  return { sources, walled, tools, stages, maps, blocks, system, prompt };
}
async function rewriteWith(costBox) {
  const model = await agent.summaryModel();
  return async (text, instructions) => {
    const r = await agent.runChat({ model, system: instructions, messages: [{ role: "user", content: text }], maxTokens: 2000 });
    costBox.usd += r.costUsd || 0;
    return r.text;
  };
}

async function read(company, id, opts = {}) {
  const w = await getWalk(company, id);
  if (!["sources", "failed"].includes(w.status)) throw bad(w.status === "reading" ? "The sources are being read already." : "The sources were already read.");
  if (!(await totals(id)).n) throw bad("Add a source first: a transcript, notes, or a document.");
  await agent.assertUnderCap(company);
  const pick = await agent.pickModel(company, "design", `walk:${id}`);
  const r = await q("UPDATE platform.vsm_walks SET status='reading', error=NULL, model=$2, updated_at=now() WHERE id=$1 AND status IN ('sources','failed') RETURNING id", [id, pick.model]);
  if (!r.rows[0]) throw bad("The sources are being read already.");
  await record.record("map_walk_reading", { company, actor: opts.actor, detail: { walk: id } });
  const job = extract(company, id).catch(async (e) => {
    console.error(`[vsm-walk] walk ${id} read failed:`, e.message);
    const words = e.code === "cap" || e.status === 429 ? e.message : "The read did not finish. Read again to retry; if it fails again, write to Anetix.";
    await q("UPDATE platform.vsm_walks SET status='failed', error=$2, updated_at=now() WHERE id=$1", [id, words]).catch(() => {});
  });
  if (opts.wait) await job;
}
async function extract(company, id) {
  const w = await getWalk(company, id);
  const ctx = await contextFor(w);
  const cost = { usd: 0 };
  let data;
  if (agent.fakeMode()) {
    // the prompt is assembled and logged as for a real call (the data wall's canary test reads the log); the read is canned
    await agent.atWall("structured:map_extract", { company, model: w.model, system: ctx.system, prompt: ctx.prompt, blocks: ctx.blocks });
    const wait = Number(process.env.SOS_FAKE_WALK_MS || 0);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (ctx.blocks.some((b) => b.type === "text" && /FAILREAD/.test(b.text))) throw new Error("fake mode: the read failed (FAILREAD)");
    data = fakeExtraction(ctx);
  } else {
    const r = await agent.runStructured({ model: w.model, company, blocks: ctx.blocks, schema: EXTRACT_SCHEMA, toolName: "map_extract", maxTokens: 16000, system: ctx.system, prompt: ctx.prompt });
    data = r.data; cost.usd += r.costUsd || 0;
  }
  const ex = await cleanExtraction(data, ctx, agent.fakeMode() ? null : await rewriteWith(cost));
  if (!agent.fakeMode()) await agent.recordUsage(company, null, "mapping", w.model, cost.usd, { walk: id, sources: ctx.sources.length, steps: ex.steps.length });
  const done = await q(`UPDATE platform.vsm_walks SET status='walking', extraction=$2::jsonb, cost_usd=cost_usd+$3, error=NULL, updated_at=now() WHERE id=$1 AND status='reading' RETURNING id`, [id, JSON.stringify(ex), cost.usd]);
  if (done.rows[0]) await record.record("map_walk_read", { company, actor: "agent", detail: { walk: id, families: ex.families.length, steps: ex.steps.length, control: ex.control.length, systems: ex.systems.length, questions: ex.questions.length, model: w.model, cost_usd: cost.usd } });
}

// What the model wrote, brought to shape: keys of our own, every reference checked, the tools and stages that exist,
// generated words through the plain-words scrub (a line that cannot be said plainly is dropped), quotes kept as said.
async function cleanExtraction(data, ctx, rewrite) {
  const d = isObj(data) ? data : {};
  const allow = [...new Set([...(d.systems || []).map((s) => line(s && s.name, 60)), ...ctx.tools.map((t) => t.title)].filter(Boolean))];
  const say = async (v, n) => { const t = line(v, n); if (!t) return ""; const s = await plain.scrub(t, { allow, rewrite }); return s.hits.length ? "" : line(s.text, n); };
  const toolOf = (v) => { const t = norm(v); const m = ctx.tools.find((x) => norm(x.name) === t || norm(x.title) === t); return m ? m.name : null; };
  const tools = (list) => [...new Set((Array.isArray(list) ? list : []).map(toolOf).filter(Boolean))].slice(0, 6);
  const stageRefs = new Set(ctx.stages.map((s) => s.ref));
  const srcTitle = (n) => { const s = ctx.sources[Number(n) - 1]; return s ? s.title : ""; };
  const rec = (kind, sys, toolList) => {
    let k = RECORD.includes(kind) ? kind : (sys ? "other" : "none");
    if (k === "anetix" && !toolList.length) k = sys ? "other" : "none";
    return k;
  };
  const families = [], famKey = {};
  for (const f of (Array.isArray(d.families) ? d.families : []).slice(0, 6)) {
    const name = line(f && f.name, 60); if (!name) continue;
    let k = slugify(f.key || name) || `f${families.length + 1}`; while (families.some((x) => x.key === k)) k = `${k}-${families.length + 1}`;
    famKey[String(f.key || name)] = k; famKey[name] = k;
    families.push({ key: k, name, products: line(f.products, 200), why: await say(f.why, 300) });
  }
  const control = [], ctlKey = {};
  for (const c of (Array.isArray(d.control) ? d.control : []).slice(0, MAX_CONTROL)) {
    const name = line(c && c.name, 60); if (!name) continue;
    const k = `c${control.length + 1}`; ctlKey[String(c.key || name)] = k;
    const t = tools(c.tools), system = line(c.system, 120);
    control.push({ key: k, name, who: line(c.who, 120), what: await say(c.what, 300), how: HOW.includes(c.how) ? c.how : "word", system, record_kind: rec(c.record_kind, system, t), tools: t, quote: line(c.quote, 400), quote_by: c.quote ? srcTitle(c.source) : "" });
  }
  const steps = [], stepKey = {};
  for (const s of (Array.isArray(d.steps) ? d.steps : []).slice(0, MAX_STEPS)) {
    const name = line(s && s.name, 60); if (!name) continue;
    const k = `s${steps.length + 1}`; stepKey[String(s.key || name)] = k;
    const t = tools(s.tools), system = line(s.record_system, 120), tr = isObj(s.trigger) ? s.trigger : {};
    const from = tr.from === "person" ? "person" : ctlKey[String(tr.from || "")] || "arrival";
    const numbers = (Array.isArray(s.numbers) ? s.numbers : []).slice(0, 8).map((x) => ({ label: line(x && x.label, 24), value: line(x && x.value, 60) || "?" })).filter((x) => x.label);
    steps.push({
      key: k, families: [...new Set((Array.isArray(s.families) ? s.families : []).map((f) => famKey[String(f)]).filter(Boolean))], name, who: line(s.who, 120), where: line(s.where, 80), what: await say(s.what, 300),
      trigger: { from, how: HOW.includes(tr.how) ? tr.how : "word", text: await say(tr.text, 200) },
      record_kind: rec(s.record_kind, system, t), record_system: system, tools: t, stages: (Array.isArray(s.stages) ? s.stages : []).map((x) => line(x, 12)).filter((x) => stageRefs.has(x)).slice(0, 6),
      waits_before: line(s.waits_before, 80) || "?", numbers, recorded: await say(s.recorded, 300), missing: await say(s.missing, 300),
      quote: line(s.quote, 400), quote_by: s.quote ? srcTitle(s.source) : "", confidence: CONF.includes(s.confidence) ? s.confidence : "assumed",
    });
  }
  const seen = new Set(), systems = [];
  for (const x of (Array.isArray(d.systems) ? d.systems : []).slice(0, 12)) { const name = line(x && x.name, 60); if (!name || seen.has(norm(name))) continue; seen.add(norm(name)); systems.push({ name, used_for: await say(x.used_for, 120) }); }
  const cu = isObj(d.customer) ? d.customer : {}, su = isObj(d.supplier) ? d.supplier : {};
  const questions = [];
  for (const x of (Array.isArray(d.questions) ? d.questions : []).slice(0, 20)) {
    const claim = await say(x && x.claim, 300); if (!claim) continue;
    questions.push({ about: stepKey[String(x.step || "")] || ctlKey[String(x.step || "")] || null, claim, why: await say(x.why, 400), ask: line(x.ask, 80) });
  }
  return {
    plant: { makes: line((d.plant || {}).makes, 200), orders: line((d.plant || {}).orders, 200) },
    families, control, steps, systems,
    people: (Array.isArray(d.people) ? d.people : []).slice(0, 30).map((p) => ({ name: line(p && p.name, 60), role: line(p && p.role, 80) })).filter((p) => p.name),
    customer: { who: line(cu.who, 120), demand: line(cu.demand, 120) || "?", ships: line(cu.ships, 120) || "?", quote: line(cu.quote, 400), quote_by: cu.quote ? srcTitle(cu.source) : "" },
    supplier: { name: line(su.name, 80), what: line(su.what, 120), how_ordered: line(su.how_ordered, 200), record_kind: RECORD.includes(su.record_kind) ? su.record_kind : (su.record_system ? "other" : "none"), record_system: line(su.record_system, 120) },
    questions, read_at: new Date().toISOString(),
  };
}
// Fake mode: a small plant with two families, so every screen of the walk and the draft can be tested without a key.
function fakeExtraction(ctx) {
  const tool = (ctx.tools[0] || {}).name || "";
  return {
    plant: { makes: "Widgets and gadgets (fake mode)", orders: "By email and the web store" },
    families: [{ key: "widgets", name: "Widgets", products: "The W line", why: "They share kitting, assembly and test." }, { key: "gadgets", name: "Gadgets", products: "The G line", why: "Bought in and packed." }],
    customer: { who: "Shops and the web store", demand: "about 40 a week", ships: "daily", quote: "We ship every afternoon.", source: 1 },
    systems: [{ name: "Fishbowl", used_for: "orders and inventory" }, { name: "QuickBooks", used_for: "money" }],
    people: [{ name: "Dana", role: "production manager" }, { name: "Lee", role: "assembly" }],
    control: [
      { key: "oe", name: "Order entry", who: "Dana", what: "Types the order in.", how: "system", system: "Fishbowl", record_kind: "other", tools: [], quote: "", source: 0 },
      { key: "list", name: "Morning list", who: "Dana", what: "Writes what to build today.", how: "paper", system: "whiteboard", record_kind: "paper", tools: [], quote: "", source: 0 },
    ],
    steps: [
      { key: "k", families: ["widgets"], name: "Kit parts", who: "Lee", where: "stockroom", what: "Pulls the parts for the order.", trigger: { from: "list", how: "paper", text: "the morning list" }, record_kind: tool ? "anetix" : "paper", record_system: "", tools: tool ? [tool] : [], stages: [], waits_before: "?", numbers: [{ label: "C/T", value: "?" }], recorded: "What was pulled.", missing: "Shortages.", quote: "I pull from the list.", source: 1, confidence: "heard" },
      { key: "a", families: ["widgets"], name: "Assemble", who: "Lee", where: "bench 2", what: "Builds the widget.", trigger: { from: "arrival", how: "word", text: "the kit arrives" }, record_kind: "none", record_system: "", tools: [], stages: [], waits_before: "kits on the cart", numbers: [{ label: "C/T", value: "about 20 min" }], recorded: "", missing: "Who built it and when.", quote: "", source: 0, confidence: "heard" },
      { key: "t", families: ["widgets"], name: "Test", who: "Sam", where: "test rack", what: "Runs it for a day.", trigger: { from: "arrival", how: "word", text: "" }, record_kind: "paper", record_system: "test sheet", tools: [], stages: [], waits_before: "?", numbers: [], recorded: "Pass or fail on the sheet.", missing: "", quote: "", source: 0, confidence: "assumed" },
      { key: "p", families: ["widgets", "gadgets"], name: "Pack and ship", who: "Dana", where: "shipping", what: "Packs and ships.", trigger: { from: "oe", how: "system", text: "the order in Fishbowl" }, record_kind: "other", record_system: "Fishbowl", tools: [], stages: [], waits_before: "?", numbers: [], recorded: "The shipment.", missing: "", quote: "We ship every afternoon.", source: 1, confidence: "heard" },
      { key: "r", families: ["gadgets"], name: "Receive", who: "Dana", where: "dock", what: "Checks in the bought gadgets.", trigger: { from: "arrival", how: "word", text: "" }, record_kind: "other", record_system: "Fishbowl", tools: [], stages: [], waits_before: "?", numbers: [], recorded: "", missing: "", quote: "", source: 0, confidence: "assumed" },
    ],
    supplier: { name: "Parts supplier", what: "Parts", how_ordered: "By email", record_kind: "paper", record_system: "email" },
    questions: [{ step: "t", claim: "Test takes a day for every widget.", why: "Only one person mentioned it.", ask: "Sam" }, { step: "", claim: "The plant ships every afternoon.", why: "Said once.", ask: "Dana" }],
  };
}

// ---- where the walk is: the screen a person (or an app) is on -------------------------------------------------------
const exOf = (w) => w.extraction || { families: [], control: [], steps: [], systems: [], people: [], questions: [], customer: {}, supplier: {} };
async function familyOptions(w) {
  const ex = exOf(w);
  const maps = (await currentMaps(w.company)).filter((m) => !m.proposed);
  const out = [];
  for (const m of maps) {
    const f = ex.families.find((x) => sameName(x.name, m.family));
    out.push({ key: `map:${m.key}`, name: m.family, on_map: true, map_key: m.key, ext: f ? f.key : null, products: f ? f.products : "" });
  }
  for (const f of ex.families) if (!out.some((o) => o.ext === f.key)) out.push({ key: `ext:${f.key}`, name: f.name, on_map: false, map_key: null, ext: f.key, products: f.products });
  return out.map((o) => ({ ...o, steps: ex.steps.filter((s) => !o.ext || !s.families.length || s.families.includes(o.ext)).length }));
}
function familySteps(w) {
  const fam = (w.frame || {}).family_ext;
  return exOf(w).steps.filter((s) => !fam || !s.families.length || s.families.includes(fam));
}
function guesses(w, of) {
  const list = familySteps(w), chain = w.chain || [];
  const left = list.filter((s) => !chain.includes(s.key));
  if (!left.length) return { guess: null, others: [] };
  let guess;
  if (!of) guess = left[left.length - 1];
  else {
    const order = list.map((s) => s.key);
    const at = order.indexOf(of);
    const walked = chain.map((k) => order.indexOf(k)).filter((i) => i >= 0);
    const below = at >= 0 ? at : (walked.length ? Math.min(...walked) : order.length);
    guess = [...left].reverse().find((s) => order.indexOf(s.key) < below) || null;
  }
  const brief = (s) => ({ key: s.key, name: s.name, who: s.who, what: s.what, quote: s.quote, quote_by: s.quote_by });
  return { guess: guess ? brief(guess) : null, others: left.filter((s) => !guess || s.key !== guess.key).map(brief).slice(0, 8) };
}
function controlNow(w) { return (w.walk || {}).control || exOf(w).control; }
const STEP_OUT = ["key", "name", "who", "where", "what", "trigger", "record_kind", "record_system", "tools", "stages", "waits_before", "numbers", "recorded", "missing", "quote", "quote_by", "confidence", "confirmed", "unsure", "note", "added"];
const pickStep = (s) => Object.fromEntries(STEP_OUT.filter((k) => s[k] !== undefined).map((k) => [k, s[k]]));
async function screenOf(w) {
  const f = w.frame || {}, wk = w.walk || {}, chain = w.chain || [];
  if (w.status === "sources" || w.status === "failed") return { kind: "sources" };
  if (w.status === "reading") return { kind: "reading" };
  if (w.status === "drafted") return { kind: "drafted", map_id: w.map_id };
  if (w.status === "used") return { kind: "used", map_id: w.map_id };
  if (w.status === "abandoned") return { kind: "abandoned" };
  const ex = exOf(w);
  if (!f.family) return { kind: "family", options: await familyOptions(w) };
  if (!f.customer_done) return { kind: "customer", prefill: f.customer || { who: ex.customer.who, demand: ex.customer.demand, ships: ex.customer.ships }, evidence: ex.customer.quote ? { quote: ex.customer.quote, quote_by: ex.customer.quote_by } : null };
  if (!f.systems_done) return { kind: "systems", suggested: ex.systems, chosen: f.systems && f.systems.length ? f.systems : ex.systems.map((s) => s.name) };
  if (!chain.length) return { kind: "last", ...guesses(w, null) };
  const top = chain[chain.length - 1];
  if (!(w.steps[top] || {}).confirmed) return cardScreen(w, top);
  if (!wk.start_reached) return { kind: "before", of: { key: top, name: w.steps[top].name }, ...guesses(w, top), walked: chain.length, max: MAX_STEPS };
  if (!wk.supplier_done) return { kind: "supplier", prefill: wk.supplier || ex.supplier, first: w.steps[chain[chain.length - 1]].name };
  if (!wk.control_done) return { kind: "control", prefill: controlNow(w), max: MAX_CONTROL };
  return { kind: "review", ...reviewOf(w) };
}
function cardScreen(w, key) {
  const s = w.steps[key], chain = w.chain || [];
  return { kind: "card", key, position: chain.indexOf(key) + 1, step: pickStep(s), evidence: s.quote ? { quote: s.quote, quote_by: s.quote_by } : null,
    control: controlNow(w).map((c) => ({ key: c.key, name: c.name })), systems: (w.frame || {}).systems || [] };
}
// what a step leaves unknown: every number given as ?, a cycle time nobody gave, and what waits before it
function unknownsOf(s) {
  const unk = (s.numbers || []).filter((n) => unknown(n.value)).map((n) => n.label);
  if (!(s.numbers || []).some((n) => /^c\/t$/i.test(n.label))) unk.unshift("C/T");
  if (unknown(s.waits_before)) unk.push("what waits before it");
  return unk;
}
function reviewOf(w) {
  const flow = [...(w.chain || [])].reverse().map((k) => w.steps[k]).filter(Boolean);
  const walked = new Set(w.chain || []);
  return {
    family: (w.frame || {}).family_name, customer: (w.frame || {}).customer || {}, supplier: (w.walk || {}).supplier || {}, control: controlNow(w),
    steps: flow.map((s) => ({ key: s.key, name: s.name, who: s.who, record_kind: s.record_kind, record_system: s.record_system, tools: s.tools, waits_before: s.waits_before, unknown: unknownsOf(s), unsure: Boolean(s.unsure) })),
    left_out: familySteps(w).filter((s) => !walked.has(s.key)).map((s) => ({ key: s.key, name: s.name, who: s.who })),
  };
}

// ---- answering: one screen at a time from the board, or several at once from a connected app ----------------------------
async function inWalk(company, id, fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const w = (await client.query("SELECT * FROM platform.vsm_walks WHERE company=$1 AND id=$2 FOR UPDATE", [company, id])).rows[0];
    if (!w) throw notFound("walk");
    w.frame = w.frame || {}; w.steps = w.steps || {}; w.chain = w.chain || []; w.walk = w.walk || {};
    const out = await fn(w, client);
    await client.query(`UPDATE platform.vsm_walks SET status=$2, frame=$3::jsonb, steps=$4::jsonb, chain=$5::jsonb, walk=$6::jsonb, map_id=$7, updated_at=now() WHERE id=$1`,
      [w.id, w.status, JSON.stringify(w.frame), JSON.stringify(w.steps), JSON.stringify(w.chain), JSON.stringify(w.walk), w.map_id]);
    await client.query("COMMIT");
    return out;
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
}
const assertWalking = (w) => { if (w.status !== "walking") throw bad(w.status === "drafted" ? "The map is drawn. Change the walk first to answer again." : `The walk is not taking answers: ${STATUS_WORDS[w.status] || w.status}.`); };
function newKey(w) { w.walk.n = (w.walk.n || 0) + 1; return `n${w.walk.n}`; }
function stepFrom(w, pick) {
  // pick: an extraction step's key, or { name } for a step the sources did not have
  if (typeof pick === "string" && pick) {
    if (w.steps[pick]) return pick;
    const s = exOf(w).steps.find((x) => x.key === pick);
    if (!s) throw bad("That is not a step from the sources. Name it instead.");
    w.steps[pick] = { ...JSON.parse(JSON.stringify(s)), confirmed: false };
    return pick;
  }
  const name = line(isObj(pick) ? pick.name : "", 60);
  if (!name) throw bad("Name the step.");
  const key = newKey(w);
  w.steps[key] = { key, name, who: line(pick.who, 120), where: "", what: line(pick.what, 300), trigger: { from: "arrival", how: "word", text: "" }, record_kind: "none", record_system: "", tools: [], stages: [], waits_before: "?", numbers: [{ label: "C/T", value: "?" }], recorded: "", missing: "", quote: "", quote_by: "", confidence: "heard", confirmed: false, added: true };
  return key;
}
async function cleanTools(company, list) {
  const tools = await companyTools(company);
  const out = [];
  for (const v of (Array.isArray(list) ? list : []).slice(0, 8)) {
    const t = tools.find((x) => norm(x.name) === norm(v) || norm(x.title) === norm(v));
    if (!t) throw bad(`"${line(v, 60)}" is not one of this company's tools. They are: ${tools.map((x) => x.title).join(", ") || "none yet"}.`);
    if (!out.includes(t.name)) out.push(t.name);
  }
  return out;
}
const numbersOf = (v) => (Array.isArray(v) ? v : []).slice(0, 8).map((r) => ({ label: line(r && r.label, 24), value: line(r && r.value, 60) || "?" })).filter((r) => r.label);
async function card(w, key, b) {
  if (!w.chain.includes(key) || !w.steps[key]) throw bad("That step is not on this walk.");
  const s = w.steps[key], before = JSON.stringify(pickStep(s));
  if (b.name !== undefined) { const n = line(b.name, 60); if (!n) throw bad("A step needs a name."); s.name = n; }
  if (b.who !== undefined) s.who = line(b.who, 120);
  if (b.where !== undefined) s.where = line(b.where, 80);
  if (b.what !== undefined) s.what = line(b.what, 300);
  if (b.trigger !== undefined) {
    const t = isObj(b.trigger) ? b.trigger : {};
    const ctl = controlNow(w).map((c) => c.key);
    const from = ["arrival", "person"].includes(t.from) ? t.from : ctl.includes(t.from) ? t.from : (controlNow(w).find((c) => sameName(c.name, t.from)) || {}).key;
    if (!from) throw bad(`What tells them to start is "arrival" (the work arrives), "person" (someone tells them), or a production control step: ${controlNow(w).map((c) => `${c.key} (${c.name})`).join(", ") || "none yet"}.`);
    s.trigger = { from, how: HOW.includes(t.how) ? t.how : (s.trigger || {}).how || "word", text: line(t.text, 200) };
  }
  if (b.record_kind !== undefined) { if (!RECORD.includes(b.record_kind)) throw bad(`Where the record lives is one of ${RECORD.join(", ")}.`); s.record_kind = b.record_kind; }
  if (b.record_system !== undefined) s.record_system = line(b.record_system, 120);
  if (b.tools !== undefined) s.tools = await cleanTools(w.company, b.tools);
  if (s.record_kind === "anetix" && !(s.tools || []).length) throw bad("Pick the Anetix tool that keeps this record, or say where else it lives.");
  if (b.waits_before !== undefined) s.waits_before = line(b.waits_before, 80) || "?";
  if (b.numbers !== undefined) s.numbers = numbersOf(b.numbers);
  if (b.unsure !== undefined) s.unsure = Boolean(b.unsure);
  if (b.note !== undefined) s.note = line(b.note, 500);
  const changed = JSON.stringify(pickStep(s)) !== before;
  if (changed && !s.added) s.edited = true;   // the manager changed what the sources said
  s.confirmed = true;
  if (s.confidence === "assumed" && !s.unsure) s.confidence = "heard";
  return { before, after: JSON.stringify(pickStep(s)), changed };
}
function setFamily(w, opt) {
  const was = w.frame.family_ext;
  w.frame.family = opt.key; w.frame.family_name = opt.name; w.frame.family_ext = opt.ext; w.frame.replaces = opt.map_key;
  if (w.chain.length && was !== opt.ext) { w.chain = []; w.steps = {}; w.walk.start_reached = false; }
}
async function familyOf(w, v) {
  const opts = await familyOptions(w);
  if (isObj(v) && line(v.name, 60) && !v.key) {
    const name = line(v.name, 60);
    return opts.find((o) => sameName(o.name, name)) || { key: `new:${slugify(name) || "family"}`, name, on_map: false, map_key: null, ext: null };
  }
  const want = String(isObj(v) ? v.key : v || "");
  const o = opts.find((x) => x.key === want) || opts.find((x) => sameName(x.name, want)) || opts.find((x) => x.ext === want || x.map_key === want);
  if (!o) throw bad(`Pick one of the families: ${opts.map((x) => `${x.key} (${x.name})`).join(", ") || "none found; name one"}.`);
  return o;
}
function setCustomer(w, b) {
  w.frame.customer = { who: line(b.who, 120), demand: line(b.demand, 120) || "?", ships: line(b.ships, 120) || "?" };
  w.frame.customer_done = true;
}
function setSystems(w, list) {
  const out = [];
  for (const v of (Array.isArray(list) ? list : []).slice(0, 12)) { const n = line(v, 60); if (n && !out.some((x) => norm(x) === norm(n))) out.push(n); }
  w.frame.systems = out; w.frame.systems_done = true;
}
async function setSupplier(w, b) {
  const k = RECORD.includes(b.record_kind) ? b.record_kind : "none";
  w.walk.supplier = { name: line(b.name, 80) || "Supplier", what: line(b.what, 120), how_ordered: line(b.how_ordered, 200), record_kind: k === "anetix" ? "other" : k, record_system: line(b.record_system, 120) };
  w.walk.supplier_done = true;
}
async function setControl(w, list) {
  if (!Array.isArray(list)) throw bad("Production control is a list of steps, in order.");
  if (list.length > MAX_CONTROL) throw bad(`At most ${MAX_CONTROL} production control steps; keep the ones the work cannot start without.`);
  const known = new Set(controlNow(w).map((c) => c.key)), out = [];
  for (const c of list) {
    const name = line(c && c.name, 60); if (!name) continue;
    let key = String((c && c.key) || ""); if (!known.has(key) || out.some((x) => x.key === key)) { w.walk.cn = (w.walk.cn || 0) + 1; key = `cn${w.walk.cn}`; }
    const tools = await cleanTools(w.company, c.tools || (c.tool ? [c.tool] : []));
    let k = RECORD.includes(c.record_kind) ? c.record_kind : (c.system ? "other" : "none");
    if (k === "anetix" && !tools.length) throw bad(`"${name}": pick the Anetix tool that keeps it, or say where else it lives.`);
    out.push({ key, name, who: line(c.who, 120), what: line(c.what, 300), how: HOW.includes(c.how) ? c.how : "word", system: line(c.system, 120), record_kind: k, tools });
  }
  w.walk.control = out; w.walk.control_done = true;
}
// One screen from the board: { screen, ... } and the screen must be the one the walk is on (a card may be opened again
// any time while walking, and the frame's answers changed).
async function answer(company, id, body, opts = {}) {
  const b = isObj(body) ? body : {};
  return inWalk(company, id, async (w) => {
    assertWalking(w);
    const now = await screenOf(w);
    const s = String(b.screen || "");
    const anyTime = ["family", "customer", "systems", "card", "remove", "more", "supplier", "control"];
    if (s !== now.kind && !anyTime.includes(s)) throw Object.assign(bad("The walk moved on since this page was opened. It shows where it is now."), { status: 409 });
    let detail = { walk: id, screen: s };
    if (s === "family") { setFamily(w, await familyOf(w, b.family)); detail.family = w.frame.family_name; }
    else if (s === "customer") setCustomer(w, b);
    else if (s === "systems") setSystems(w, b.systems);
    else if (s === "last") {
      if (w.chain.length) throw Object.assign(bad("The last step is already walked."), { status: 409 });
      w.chain.push(stepFrom(w, b.pick));
    } else if (s === "before") {
      if (b.pick === "start") w.walk.start_reached = true;
      else {
        if (w.chain.length >= MAX_STEPS) throw bad(`A map of one family holds at most ${MAX_STEPS} steps. Say this is where it starts, or merge steps.`);
        const k = stepFrom(w, b.pick);
        if (w.chain.includes(k)) throw bad("That step is already on the walk.");
        w.chain.push(k);
      }
    } else if (s === "card") {
      const key = String(b.key || (now.kind === "card" ? now.key : ""));
      const r = await card(w, key, b);
      detail = { ...detail, step: key, name: w.steps[key].name, changed: r.changed };
      if (r.changed || !opts.quiet) await record.record("map_walk_step", { company, actor: opts.actor, before: r.before, after: r.after, detail });
      return { ok: true };
    } else if (s === "remove") {
      const key = String(b.key || "");
      if (!w.chain.includes(key)) throw bad("That step is not on this walk.");
      w.chain = w.chain.filter((k) => k !== key); delete w.steps[key]; detail.step = key;
      if (!w.chain.length) w.walk.start_reached = false;
    } else if (s === "more") { w.walk.start_reached = false; w.walk.supplier_done = false; }
    else if (s === "supplier") await setSupplier(w, b);
    else if (s === "control") await setControl(w, b.control);
    else throw bad("Nothing to answer on this screen.");
    if (!opts.quiet) await record.record("map_walk_answered", { company, actor: opts.actor, after: JSON.stringify(b).slice(0, 4000), detail });
    return { ok: true };
  });
}
// Several answers at once, from a connected app that has the transcript in front of it (src/mcp-vsm.js). The same
// checks as the board's screens. steps: the family's material steps in the order the work moves (first step first),
// each one an extraction step's key with any field to change, or a new step by name; the walk is then taken as walked
// to its start. Returns what was saved and what was not, one by one, so one bad answer does not lose the rest.
async function answerMany(company, id, b, opts = {}) {
  const saved = [], refused = [];
  const tryOne = async (what, fn) => { try { await fn(); saved.push(what); } catch (e) { if (!e.status || e.status >= 500) throw e; refused.push({ what, why: e.message }); } };
  const one = (screen, extra) => answer(company, id, { screen, ...extra }, { ...opts, quiet: true });
  if (b.family !== undefined) await tryOne("family", () => one("family", { family: b.family }));
  if (b.customer !== undefined) await tryOne("customer", () => one("customer", isObj(b.customer) ? b.customer : {}));
  if (b.systems !== undefined) await tryOne("systems", () => one("systems", { systems: b.systems }));
  if (b.control !== undefined) await tryOne("control", () => one("control", { control: b.control }));
  if (Array.isArray(b.steps)) {
    await tryOne("steps", () => inWalk(company, id, async (w) => {
      assertWalking(w);
      if (!w.frame.family) throw bad("Say which family first (family).");
      if (!b.steps.length) throw bad("No steps were given.");
      if (b.steps.length > MAX_STEPS) throw bad(`A map of one family holds at most ${MAX_STEPS} steps.`);
      w.chain = []; w.steps = {};
      const keys = [];
      for (const st of [...b.steps].reverse()) {
        const k = stepFrom(w, isObj(st) && st.key && !st.new ? String(st.key) : { name: isObj(st) ? st.name : st, who: isObj(st) ? st.who : "", what: isObj(st) ? st.what : "" });
        if (keys.includes(k)) throw bad(`Step ${k} is listed twice.`);
        keys.push(k); w.chain.push(k);
      }
      for (const st of b.steps) {
        if (!isObj(st)) continue;
        const k = w.chain.find((x) => x === String(st.key)) || w.chain.find((x) => w.steps[x].name === line(st.name, 60));
        const { key, new: _n, ...fields } = st;
        try { await card(w, k, fields); }
        catch (e) { throw bad(`Step "${line(st.name || st.key, 60)}": ${e.message}`); }
      }
      for (const k of w.chain) w.steps[k].confirmed = true;
      w.walk.start_reached = b.first_step_reached !== false;
    }));
  }
  if (b.supplier !== undefined) await tryOne("supplier", () => one("supplier", isObj(b.supplier) ? b.supplier : {}));
  if (saved.length) await record.record("map_walk_answered", { company, actor: opts.actor, after: JSON.stringify(b).slice(0, 4000), detail: { walk: id, via: "app", saved } });
  return { saved, not_saved: refused };
}

// ---- the draft: platform code draws the map from what the walk settled ---------------------------------------------------
const P = { x0: 288, dx: 200, y: 400, w: 144, h: 64 }, C = { y: 208, w: 152, h: 80 }, BAND = { x: 264, y: 152, h: 168 };
const KIND_OF = { system: "info_system", paper: "info_word", word: "info_word" };
const HOW_WORDS = { system: "in a system", paper: "on paper", word: "word of mouth" };
function buildDraft(w, tools) {
  const flow = [...w.chain].reverse().map((k) => w.steps[k]).filter(Boolean);
  if (!flow.length) throw bad("Walk at least one step before the map is drawn.");
  const control = controlNow(w), f = w.frame || {}, sup = (w.walk || {}).supplier || {}, cus = f.customer || {};
  const title = (n) => (tools.find((t) => t.name === n) || { title: n }).title;
  const nodes = [], edges = [], questions = [];
  const lastX = P.x0 + P.dx * (flow.length - 1);
  // production control runs right to left: the order comes in from the customer at the right
  let bandW = Math.max(400, lastX - 48 - BAND.x);
  const k = control.length;
  if (k > 1 && (bandW - 40 - C.w) / (k - 1) < 168) bandW = 40 + C.w + (k - 1) * 168;
  const bandRight = BAND.x + bandW;
  const stepX = k > 1 ? Math.min(480, (bandW - 40 - C.w) / (k - 1)) : 0;
  control.forEach((c, j) => {
    nodes.push({ key: `c-${c.key}`, kind: "control", label: c.name, sub: c.who, who: c.who, stage_refs: [], record_kind: c.record_kind, record_system: c.system, modules: c.tools || [],
      x: Math.round(bandRight - 20 - C.w - j * stepX), y: C.y, w: C.w, h: C.h, data: [], detail: { what: c.what, anetix: (c.tools || []).length ? `Kept in ${c.tools.map(title).join(", ")}.` : "", quote: c.quote || "", quote_by: c.quote_by || "", source: c.quote_by ? `${c.quote_by}, read on the walk` : "the mapping walk" }, confidence: "heard" });
  });
  const cusX = Math.max(lastX - 16, k ? bandRight + 24 : 0);
  // the customer's box wears where its orders are kept: the first production control step's record
  nodes.push({ key: "cus", kind: "customer", label: cus.who ? short(cus.who, 40) : "Customer", sub: unknown(cus.demand) ? "demand ?" : short(cus.demand, 40), who: "", stage_refs: [], record_kind: k ? control[0].record_kind : "none", record_system: k ? control[0].system : "", modules: k ? control[0].tools || [] : [],
    x: cusX, y: 24, w: 176, h: 96, data: [], detail: { what: [cus.demand && !unknown(cus.demand) ? `Demand: ${cus.demand}.` : "", cus.ships && !unknown(cus.ships) ? `Ships: ${cus.ships}.` : ""].filter(Boolean).join(" "), source: "the mapping walk" }, confidence: "heard" });
  nodes.push({ key: "sup", kind: "supplier", label: short(sup.name || "Supplier", 40), sub: short(sup.what, 40), who: "", stage_refs: [], record_kind: sup.record_kind || "none", record_system: sup.record_system || "", modules: [],
    x: 32, y: 384, w: 192, h: 96, data: [], detail: { what: sup.how_ordered ? `Ordered: ${sup.how_ordered}` : "", source: "the mapping walk" }, confidence: "heard" });
  flow.forEach((s, i) => {
    const data = (s.numbers || []).slice(0, 6);
    if (!data.some((d) => /^c\/t$/i.test(d.label))) data.unshift({ label: "C/T", value: "?" });
    nodes.push({ key: `p-${s.key}`, kind: "process", label: s.name, sub: s.where, who: s.who, stage_refs: s.stages || [], record_kind: s.record_kind, record_system: s.record_system, modules: s.tools || [],
      x: P.x0 + P.dx * i, y: P.y, w: P.w, h: P.h, data,
      detail: { what: s.what, recorded: s.recorded, missing: s.missing, anetix: (s.tools || []).length ? `Kept in ${s.tools.map(title).join(", ")}.` : "", quote: s.quote || "", quote_by: s.quote_by || "",
        source: s.added ? "added on the mapping walk" : s.quote_by ? `${s.quote_by}, confirmed on the walk` : "the sources, confirmed on the walk", notes: s.note || "" },
      confidence: s.unsure ? "assumed" : s.confidence === "seen" ? "seen" : "heard" });
  });
  const inv = (s) => ({ label: unknown(s.waits_before) ? "?" : short(s.waits_before, 24), note: s.waits_before || "" });
  edges.push({ from: "sup", to: `p-${flow[0].key}`, kind: "supply", label: "", from_side: "right", to_side: "left", from_at: 0.5, to_at: 0.5, inventory: inv(flow[0]) });
  for (let i = 0; i < flow.length - 1; i++) edges.push({ from: `p-${flow[i].key}`, to: `p-${flow[i + 1].key}`, kind: "push", label: "", from_side: "right", to_side: "left", from_at: 0.75, to_at: 0.75, inventory: inv(flow[i + 1]) });
  edges.push({ from: `p-${flow[flow.length - 1].key}`, to: "cus", kind: "ship", label: "", from_side: "top", to_side: "bottom", from_at: 0.5, to_at: 0.5, inventory: null });
  if (k) {
    edges.push({ from: "cus", to: `c-${control[0].key}`, kind: KIND_OF[control[0].how] || "info_word", label: short(control[0].system || HOW_WORDS[control[0].how], 60), from_side: "left", to_side: "top", from_at: 0.5, to_at: 0.5, inventory: null });
    for (let j = 1; j < k; j++) edges.push({ from: `c-${control[j - 1].key}`, to: `c-${control[j].key}`, kind: KIND_OF[control[j].how] || "info_word", label: short(control[j].how === "system" ? control[j].system || "in a system" : HOW_WORDS[control[j].how], 60), from_side: "left", to_side: "right", from_at: 0.5, to_at: 0.5, inventory: null });
  }
  const ctlKeys = new Set(control.map((c) => c.key));
  for (const s of flow) {
    const t = s.trigger || {};
    if (ctlKeys.has(t.from)) edges.push({ from: `c-${t.from}`, to: `p-${s.key}`, kind: KIND_OF[t.how] || "info_word", label: short(t.text || HOW_WORDS[t.how], 40), from_side: "bottom", to_side: "top", from_at: 0.5, to_at: 0.5, inventory: null });
  }
  // the review queue: every place the draft is guessing
  const famName = f.family_name || "this family";
  for (const s of flow) {
    const unk = unknownsOf(s);
    if (unk.length) questions.push({ node: `p-${s.key}`, where: s.name, claim: `${s.name}: ${unk.join(", ")} not known yet.`, why: "Nobody gave these on the walk. A scan when the work starts and finishes here would fill the cycle time and the wait before it.", confidence: "assumed" });
    if (s.unsure) questions.push({ node: `p-${s.key}`, where: s.name, claim: `Is ${s.name} drawn right?`, why: s.note || "The manager was not sure about this step on the walk.", confidence: "assumed" });
  }
  const walked = new Set(w.chain);
  for (const x of exOf(w).questions || []) {
    if (x.about && x.about.startsWith("s") && !walked.has(x.about)) continue;
    const node = x.about ? (walked.has(x.about) ? `p-${x.about}` : ctlKeys.has(x.about) ? `c-${x.about}` : null) : null;
    const where = node ? (nodes.find((n) => n.key === node) || {}).label : "";
    questions.push({ node, where: where || "Whole plant", claim: x.claim, why: [x.why, x.ask ? `Ask ${x.ask}.` : ""].filter(Boolean).join(" "), confidence: "assumed" });
  }
  for (const s of familySteps(w).filter((s) => !walked.has(s.key))) questions.push({ node: null, where: "Left out", claim: `The sources mention "${s.name}"${s.who ? ` (${s.who})` : ""}. Is it a step of ${famName}?`, why: s.quote ? `"${short(s.quote, 200)}" (${s.quote_by})` : "It was not walked.", confidence: "assumed" });
  const systems = (f.systems || []).join(" · ");
  const layout = { bands: k ? [{ label: "Production control", note: systems, x: BAND.x, y: BAND.y, w: bandW, h: BAND.h }] : [], ladder_y: null, feed: [] };
  return { nodes, edges, questions: questions.slice(0, MAX_QUESTIONS), layout };
}
async function draft(company, id, opts = {}) {
  const tools = await companyTools(company);
  return inWalk(company, id, async (w, client) => {
    assertWalking(w);
    const scr = await screenOf(w);
    if (scr.kind !== "review" && !opts.anyway) throw bad(`Finish the walk first: it is still on ${SCREEN_WORDS[scr.kind] || scr.kind}.`);
    const d = buildDraft(w, tools);
    const f = w.frame;
    const base = f.replaces || slugify(f.family_name) || "family";
    const key = `${base.slice(0, 26)}-walk-${w.id}`;
    // a draft drawn again replaces this walk's own earlier draft, never anything else
    const old = (await client.query("SELECT id, key FROM platform.vsm_maps WHERE company=$1 AND walk_id=$2 AND proposed", [company, w.id])).rows;
    for (const m of old) { await client.query("DELETE FROM platform.vsm_questions WHERE company=$1 AND map_key=$2", [company, m.key]); await client.query("DELETE FROM platform.vsm_maps WHERE id=$1", [m.id]); }
    const sort = ((await client.query("SELECT sort FROM platform.vsm_maps WHERE company=$1 AND key=$2", [company, f.replaces || ""])).rows[0] || { sort: 90 }).sort;
    const mapId = (await client.query(`INSERT INTO platform.vsm_maps (company, key, family, title, state, status, layout, sort, walk_id, proposed) VALUES ($1,$2,$3,$4,'current','draft',$5::jsonb,$6,$7,true) RETURNING id`,
      [company, key, f.family_name, `${f.family_name}, from the walk`, JSON.stringify(d.layout), sort, w.id])).rows[0].id;
    for (const n of d.nodes) {
      await client.query(`INSERT INTO platform.vsm_nodes (company, map_id, key, kind, label, sub, who, stage_refs, record_kind, record_system, modules, x, y, w, h, data, detail, confidence, updated_by)
                          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17::jsonb,$18,'the mapping walk')`,
        [company, mapId, n.key, n.kind, n.label, n.sub || "", n.who || "", n.stage_refs, n.record_kind, n.record_system || "", n.modules, n.x, n.y, n.w, n.h, JSON.stringify(n.data), JSON.stringify(n.detail), n.confidence]);
    }
    let i = 0;
    for (const e of d.edges) await client.query(`INSERT INTO platform.vsm_edges (company, map_id, from_key, to_key, kind, label, from_side, to_side, from_at, to_at, inventory, sort) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)`,
      [company, mapId, e.from, e.to, e.kind, e.label, e.from_side, e.to_side, e.from_at, e.to_at, e.inventory ? JSON.stringify(e.inventory) : null, i++]);
    i = 0;
    for (const x of d.questions) await client.query(`INSERT INTO platform.vsm_questions (company, map_key, node_key, where_label, claim, why, confidence, status, sort) VALUES ($1,$2,$3,$4,$5,$6,$7,'open',$8)`,
      [company, key, x.node, x.where || "", x.claim, x.why || "", x.confidence, 1000 + i++]);
    w.status = "drafted"; w.map_id = mapId;
    await record.record("map_drafted", { company, actor: opts.actor, detail: { walk: w.id, map_id: mapId, family: f.family_name, boxes: d.nodes.length, flows: d.edges.length, questions: d.questions.length } });
    return { map_id: mapId, boxes: d.nodes.length, flows: d.edges.length, questions: d.questions.length };
  });
}
// Back to the walk from the draft (the draft stays until it is drawn again), or back to the sources to read them again
async function reopen(company, id, opts = {}) {
  return inWalk(company, id, async (w) => {
    if (w.status !== "drafted") throw bad("Only a drawn walk can be changed again here.");
    w.status = "walking";
    await record.record("map_walk_reopened", { company, actor: opts.actor, detail: { walk: id } });
  });
}
async function reread(company, id, opts = {}) {
  await inWalk(company, id, async (w, client) => {
    if (!["walking", "drafted", "failed"].includes(w.status)) throw bad(`The walk cannot go back to its sources now: ${STATUS_WORDS[w.status] || w.status}.`);
    w.status = "sources"; w.frame = {}; w.steps = {}; w.chain = []; w.walk = {};
    await client.query("UPDATE platform.vsm_walks SET extraction=NULL, error=NULL WHERE id=$1", [w.id]);
    await record.record("map_walk_back_to_sources", { company, actor: opts.actor, detail: { walk: id } });
  });
}
async function abandon(company, id, opts = {}) {
  await inWalk(company, id, async (w, client) => {
    if (!OPEN.includes(w.status) || w.status === "reading") throw bad(`The walk cannot be put away now: ${STATUS_WORDS[w.status] || w.status}.`);
    w.status = "abandoned";
    for (const m of (await client.query("SELECT id, key FROM platform.vsm_maps WHERE company=$1 AND walk_id=$2 AND proposed", [company, w.id])).rows) {
      await client.query("DELETE FROM platform.vsm_questions WHERE company=$1 AND map_key=$2", [company, m.key]);
      await client.query("DELETE FROM platform.vsm_maps WHERE id=$1", [m.id]);
    }
    w.map_id = null;
    await record.record("map_walk_abandoned", { company, actor: opts.actor, detail: { walk: id } });
  });
}
// "Use this map" (the board only): the draft becomes the family's map. The map it replaces is kept, hidden (replaced_at
// set, its key moved aside with its review answers), so nothing is lost; a company with no stage list yet gets one
// from the map's boxes, so its coverage counts.
async function use(company, id, opts = {}) {
  return inWalk(company, id, async (w, client) => {
    if (w.status !== "drafted" || !w.map_id) throw bad("There is no drawn map to use. Finish the walk and draw it first.");
    const m = (await client.query("SELECT * FROM platform.vsm_maps WHERE company=$1 AND id=$2 AND proposed AND replaced_at IS NULL", [company, w.map_id])).rows[0];
    if (!m) throw bad("The drawn map is gone. Draw it again.");
    const target = w.frame.replaces ? (await client.query("SELECT * FROM platform.vsm_maps WHERE company=$1 AND key=$2 AND replaced_at IS NULL AND NOT proposed", [company, w.frame.replaces])).rows[0] : null;
    let key = slugify(w.frame.family_name) || "family";
    if (target) {
      const aside = `${target.key.slice(0, 28)}-r${target.id}`;
      await client.query("UPDATE platform.vsm_maps SET key=$3, replaced_at=now(), updated_at=now() WHERE company=$1 AND id=$2", [company, target.id, aside]);
      await client.query("UPDATE platform.vsm_questions SET map_key=$3 WHERE company=$1 AND map_key=$2", [company, target.key, aside]);
      key = target.key;
    } else {
      let n = 1; const base = key;
      while ((await client.query("SELECT 1 FROM platform.vsm_maps WHERE company=$1 AND key=$2", [company, key])).rows[0]) key = `${base}-${++n}`;
    }
    await client.query("UPDATE platform.vsm_maps SET key=$3, title=$4, proposed=false, updated_at=now() WHERE company=$1 AND id=$2", [company, m.id, key, m.family]);
    await client.query("UPDATE platform.vsm_questions SET map_key=$3 WHERE company=$1 AND map_key=$2", [company, m.key, key]);
    let stages = 0;
    if (!(await client.query("SELECT 1 FROM platform.vsm_stages WHERE company=$1 LIMIT 1", [company])).rows[0]) {
      const boxes = (await client.query("SELECT key, kind, label, who, record_kind, record_system, modules, x FROM platform.vsm_nodes WHERE map_id=$1 AND kind IN ('control','process') ORDER BY (kind='process'), CASE WHEN kind='control' THEN -x ELSE x END", [m.id])).rows;
      for (const bx of boxes) {
        stages++;
        const ref = String(stages).padStart(2, "0");
        await client.query("INSERT INTO platform.vsm_stages (company, ref, name, who, record_kind, record_system, modules, sort) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (company, ref) DO NOTHING",
          [company, ref, bx.label, bx.who, bx.record_kind, bx.record_system, bx.modules, stages]);
        await client.query("UPDATE platform.vsm_nodes SET stage_refs=$2 WHERE map_id=$1 AND key=$3", [m.id, [ref], bx.key]);
      }
    }
    w.status = "used";
    await record.record("map_walk_used", { company, actor: opts.actor, detail: { walk: w.id, map_id: m.id, key, replaced: target ? target.id : null, stages_made: stages } });
    return { map_id: m.id, key, replaced: target ? { id: target.id, title: target.title } : null, stages_made: stages };
  });
}

// ---- what a page or an app reads -------------------------------------------------------------------------------------
async function view(w, opts = {}) {
  const ex = w.extraction;
  const sources = (await sourcesOf(w.id)).map((s) => ({ id: s.id, kind: s.kind, title: s.title, chars: s.chars, size: s.size, file: Boolean(s.attachment_id), gone: Boolean(s.gone), added_by: s.added_by, via: s.via, created_at: s.created_at }));
  const flow = [...(w.chain || [])].reverse().map((k) => (w.steps || {})[k]).filter(Boolean);
  const out = {
    id: w.id, company: w.company, status: w.status, status_means: STATUS_WORDS[w.status] || w.status, via: w.via, started_by: w.started_by, from_walk: w.from_walk, map_id: w.map_id,
    family: (w.frame || {}).family_name || null, created_at: w.created_at, updated_at: w.updated_at, problem: w.error || null,
    screen: await screenOf(w), sources, limits: { sources: MAX_SOURCES, words: MAX_WORDS_TOTAL, files: MAX_FILES, steps: MAX_STEPS, control: MAX_CONTROL },
    walked: flow.map((s) => ({ ...pickStep(s), confirmed: Boolean(s.confirmed) })),   // in the order the work moves
    settled: ex ? { family: (w.frame || {}).family || null, customer: (w.frame || {}).customer || null, systems: (w.frame || {}).systems || [], supplier: (w.walk || {}).supplier || null, control: controlNow(w), start_reached: Boolean((w.walk || {}).start_reached) } : null,
    family_options: ex && ["walking", "drafted"].includes(w.status) ? await familyOptions(w) : [],
    found: ex ? { plant: ex.plant, families: ex.families, systems: ex.systems, people: ex.people.length, steps: ex.steps.length, control: ex.control.length, questions: ex.questions.length } : null,
    tools: await companyTools(w.company),
  };
  if (opts.app && ex) out.found = { ...out.found, steps: ex.steps, control: ex.control, customer: ex.customer, supplier: ex.supplier, questions: ex.questions, people: ex.people };
  if (opts.admin) { out.model = w.model; out.cost_usd = Math.round(Number(w.cost_usd || 0) * 100) / 100; }
  return out;
}
async function list(company) {
  return (await q(`SELECT w.id, w.status, w.via, w.started_by, w.frame->>'family_name' AS family, jsonb_array_length(w.chain) AS steps, w.map_id, w.created_at, w.updated_at,
                          (SELECT count(*)::int FROM platform.vsm_sources s WHERE s.walk_id=w.id) AS sources
                     FROM platform.vsm_walks w WHERE w.company=$1 ORDER BY w.id DESC LIMIT 50`, [company])).rows.map((r) => ({ ...r, status_means: STATUS_WORDS[r.status] || r.status, open: OPEN.includes(r.status) }));
}
async function deleteCompany(company) {
  await q("DELETE FROM platform.vsm_sources WHERE company=$1", [company]);
  await q("DELETE FROM platform.vsm_walks WHERE company=$1", [company]);
}

// ---- routes: managers and admins of the company ----------------------------------------------------------------------
const router = express.Router();
const auth = () => require("./auth");
const requireManager = (req, res, next) => auth().requireManager(req, res, next);
const slugOf = (req) => String(req.params.slug || "").toLowerCase();
const small = express.json({ limit: "64kb" });
const words = express.json({ limit: "2mb" });
const big = express.json({ limit: `${Math.ceil(MAX_FILE_BYTES * 1.4 / 1048576) + 1}mb` });
const whoOf = (req) => (req.sosAccount && (req.sosAccount.name || req.sosAccount.login)) || req.sosPerson || req.sosRole || "manager";
const ctxOf = (req) => ({ actor: record.actor(req), by: whoOf(req), via: "board" });
const shown = async (req, id) => view(await getWalk(slugOf(req), id), { admin: req.sosRole === "admin" });
const W = "/api/c/:slug/vsm/walks";
const ID = ":id(\\d{1,9})";
router.get(W, requireManager, async (req, res) => res.json({ walks: await list(slugOf(req)) }));
router.post(W, requireManager, small, async (req, res) => {
  const r = await start(slugOf(req), { ...ctxOf(req), fromWalk: (req.body || {}).from_walk ? Number(req.body.from_walk) : null });
  res.json({ ok: true, walk: await shown(req, r.id) });
});
router.get(`${W}/${ID}`, requireManager, async (req, res) => res.json({ walk: await shown(req, Number(req.params.id)) }));
router.post(`${W}/${ID}/words`, requireManager, words, async (req, res) => { await addWords(slugOf(req), Number(req.params.id), req.body || {}, ctxOf(req)); res.json({ ok: true, walk: await shown(req, Number(req.params.id)) }); });
router.post(`${W}/${ID}/file`, requireManager, big, async (req, res) => { await addFile(slugOf(req), Number(req.params.id), req.body || {}, ctxOf(req)); res.json({ ok: true, walk: await shown(req, Number(req.params.id)) }); });
router.post(`${W}/${ID}/sources/:sid(\\d{1,9})/remove`, requireManager, async (req, res) => { await removeSource(slugOf(req), Number(req.params.id), Number(req.params.sid), ctxOf(req)); res.json({ ok: true, walk: await shown(req, Number(req.params.id)) }); });
router.post(`${W}/${ID}/read`, requireManager, async (req, res) => { await read(slugOf(req), Number(req.params.id), ctxOf(req)); res.json({ ok: true, walk: await shown(req, Number(req.params.id)) }); });
router.post(`${W}/${ID}/answer`, requireManager, small, async (req, res) => { await answer(slugOf(req), Number(req.params.id), req.body || {}, ctxOf(req)); res.json({ ok: true, walk: await shown(req, Number(req.params.id)) }); });
router.post(`${W}/${ID}/draft`, requireManager, async (req, res) => { const r = await draft(slugOf(req), Number(req.params.id), ctxOf(req)); res.json({ ok: true, ...r, walk: await shown(req, Number(req.params.id)) }); });
router.post(`${W}/${ID}/reopen`, requireManager, async (req, res) => { await reopen(slugOf(req), Number(req.params.id), ctxOf(req)); res.json({ ok: true, walk: await shown(req, Number(req.params.id)) }); });
router.post(`${W}/${ID}/reread`, requireManager, async (req, res) => { await reread(slugOf(req), Number(req.params.id), ctxOf(req)); res.json({ ok: true, walk: await shown(req, Number(req.params.id)) }); });
router.post(`${W}/${ID}/abandon`, requireManager, async (req, res) => { await abandon(slugOf(req), Number(req.params.id), ctxOf(req)); res.json({ ok: true, walk: await shown(req, Number(req.params.id)) }); });
router.post(`${W}/${ID}/use`, requireManager, async (req, res) => { const r = await use(slugOf(req), Number(req.params.id), ctxOf(req)); res.json({ ok: true, ...r, walk: await shown(req, Number(req.params.id)) }); });

module.exports = {
  init, SCHEMA, TABLES, router, start, addWords, addFile, removeSource, read, extract, cleanExtraction, fakeExtraction, answer, answerMany, draft, buildDraft, reopen, reread, abandon, use,
  view, list, getWalk, screenOf, SCREEN_WORDS, familyOptions, deleteCompany, EXTRACT_SCHEMA, STATUS_WORDS, OPEN, MAX_STEPS, MAX_CONTROL, MAX_SOURCES, MAX_WORDS, MAX_WORDS_TOTAL, fileKind, sameName,
};
