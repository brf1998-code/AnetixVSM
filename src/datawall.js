// The data wall: whether the AI may read a company's data (Brendan, 2026-09-24). A switch per company on the
// admin card, on by default ("the AI reads the data too"). Walled off, the AI builds the pipeline the data goes
// through without ever seeing the data: no row from the company's tables, no upload, no ERP answer, no photo
// and no attachment reaches a model. What stays outside the wall, by decision: the words people type (feedback,
// intake answers, a manager's adjustments) are the request itself and are accepted as shared with the AI; no
// filter is put on them.
//
// Where rows reached a model before this, and what the wall does at each (docs/DATA-WALL.md has the list):
//   the system review's live snapshot            skipped
//   ctx.ai.chat (Jonah and any persona)          refused with a plain sentence the tool shows
//   intake attachments (photos, pdfs, sheets)    photos and pdfs not sent; a sheet as its headers and row count
//   starting rows in a new module's build        the skeleton seeds nothing; the platform loads the sheet into
//                                                the tool's table after the first deploy (a files connection)
//   seed rows in migrations (files a model reads) withheld: INSERT statements replaced by a note in the copy a
//                                                model reads (filesForModel) and in the agent's working folder
//                                                (withhold before the build, restore byte for byte after)
//   "point at it" element text and markup         tag, id, classes and position only
//   photos with a request                         off (the widget hides the button)
//   check failures quoted to the agent            paths and types, never values (acceptance hideValues)
//   the campaign proposal, diagrams, cross-check  files only, through filesForModel
// The choke point: agent.runStructured, runChat and runAgent take `company`; walled, they drop image and document
// blocks whatever the caller sent. The proof: scripts/e2e/datawall.js seeds a marker string into every kind of
// data and asserts no prompt carries it (SOS_PROMPT_LOG), then that it does with the wall down.
const fs = require("fs");
const path = require("path");
const { q, logEvent } = require("./db");
const { record } = require("./record");

const SCHEMA = `ALTER TABLE platform.companies ADD COLUMN IF NOT EXISTS ai_reads_data BOOLEAN NOT NULL DEFAULT true;`;
async function init() { await q(SCHEMA); }

// ---- the switch ---------------------------------------------------------------------------------------------
const cache = new Map();   // company -> { walled, at }
const TTL = 10000;
async function isWalled(company) {
  if (!company) return false;
  const c = cache.get(company);
  if (c && Date.now() - c.at < TTL) return c.walled;
  const r = (await q("SELECT ai_reads_data FROM platform.companies WHERE slug=$1", [company])).rows[0];
  const walled = Boolean(r && r.ai_reads_data === false);
  cache.set(company, { walled, at: Date.now() });
  return walled;
}
async function setWall(company, walled, who) {
  const r = (await q("UPDATE platform.companies SET ai_reads_data=$2 WHERE slug=$1 RETURNING slug", [company, !walled])).rows[0];
  if (!r) throw Object.assign(new Error("unknown company"), { status: 404 });
  cache.delete(company);
  await logEvent(walled ? "datawall_on" : "datawall_off", company, { by: who && who.name });
  await record(walled ? "datawall_on" : "datawall_off", { company, actor: who, after: walled ? "the AI is walled off from the company's data" : "the AI may read the company's data" });
  return { walled };
}
function status(row) { return { ai_reads_data: !row || row.ai_reads_data !== false, walled: Boolean(row && row.ai_reads_data === false) }; }

// ---- files a model reads (pure) --------------------------------------------------------------------------------
const NOTE = "-- starting rows withheld: the company's data is walled off from the AI (the rows are on the floor and load with the migration)";
// A migration with its INSERT statements replaced by one note each; CREATE and ALTER stay whole. Returns the
// text and how many statements went.
function withheldMigration(sql) {
  let n = 0;
  const out = String(sql || "").split(/;\s*(?:\r?\n|$)/).map((st) => {
    if (/^\s*(?:--[^\n]*\n\s*)*INSERT\s+INTO\b/i.test(st)) { n++; return NOTE; }
    return st;
  });
  const text = out.filter((s, i, a) => !(i === a.length - 1 && !s.trim())).join(";\n");
  return { text: n ? text + (text.endsWith(";") ? "" : "") : String(sql || ""), withheld: n };
}
// The copy of a version's files a model may read: migrations withheld, everything else as is.
function filesForModel(files, walled) {
  if (!walled || !files) return files;
  const out = {};
  for (const [name, text] of Object.entries(files)) out[name] = /^migrations\/.*\.sql$/.test(name) ? withheldMigration(text).text : text;
  return out;
}
// Before a build in dir: every migration that existed before the build is replaced by its withheld copy. After
// the build restore() puts the originals back byte for byte (the gate refuses an edit to an existing migration
// anyway, so the agent never had a reason to touch them). -> the list of files withheld.
function withhold(dir, fromFiles) {
  const done = [];
  for (const [name, text] of Object.entries(fromFiles || {})) {
    if (!/^migrations\/.*\.sql$/.test(name)) continue;
    const w = withheldMigration(text);
    if (!w.withheld) continue;
    const p = path.join(dir, name);
    if (!fs.existsSync(p)) continue;
    fs.writeFileSync(p, w.text);
    done.push(name);
  }
  return done;
}
function restore(dir, fromFiles, withheld) {
  for (const name of withheld || []) {
    const p = path.join(dir, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, fromFiles[name]);
  }
  return (withheld || []).length;
}
// What the proposer may know about a pointed-at element: where it is, never what it showed.
function element(el) {
  if (!el) return el;
  const { text, label, html, ...rest } = el;
  return rest;
}
// The line in a prompt that says so.
const PROMPT_NOTE = "This company's data is walled off from the AI: you never see its rows, uploads, ERP answers or photos, only the tool's files and the words people wrote. Build for the data's shape, never for particular values.";

module.exports = { init, isWalled, setWall, status, withheldMigration, filesForModel, withhold, restore, element, NOTE, PROMPT_NOTE };
