// Every file that comes in from outside is scanned for malware before it is kept (2026-10-08).
//
// Why. The CMMC Level 1 gap audit of 2026-10-08 (Brendan: "get going on the product side fixes that are needed
// including scanning uploaded files for malware"). Three of the fifteen basic safeguards a defense supplier answers
// for are about this: protect against malicious code where files come in, keep that protection up to date, and scan
// files from outside as they arrive and again from time to time. Until this, a photo, an attachment or a spreadsheet
// was checked for its type and its size and nothing else.
//
// What. A ClamAV daemon (clamd) runs as a service of its own on the instance's private network and keeps its own
// signatures up to date (freshclam, inside that service). This file speaks clamd's INSTREAM protocol to it, one TCP
// connection a file: the bytes go over the private network, the verdict comes back, nothing is written to a disk on
// either side. No dependency. Nothing here names the scanner to a company: "the malware scan" is all a person reads.
//
//   SOS_SCAN_HOST         the scanner's private address (clamav.railway.internal). Unset: there is no scanner; a file is
//                         kept as before and marked unscanned, and the Instance tab of /admin says so in amber.
//   SOS_SCAN_PORT         3310
//   SOS_SCAN_TIMEOUT_MS   20000: one file's scan
//   SOS_SCAN_SWEEP_MIN    60: how often the look-behind runs (0 = never)
//   SOS_SCAN_RESCAN_DAYS  7: a stored file is scanned again once its last scan is older than this
//   SOS_SCAN_STALE_DAYS   3: signatures older than this are a fault (the Instance tab, and a phone alert)
//
// The rule at the door (check()), the same for every way a file comes in: a photo with a request (src/feedback.js),
// an attachment to a new tool's intake (src/attachments.js), a spreadsheet for a tool's table (src/connections.js),
// a company's icon read from its own site (src/brand.js).
//   clean                  kept, marked clean with the time and the signature set that said so
//   flagged                refused and never stored; on the company's record, in the event log, a phone alert
//   could not be scanned   (no scanner, or it did not answer)
//       a company with "uploads must be scanned" on (src/safeguards.js): refused, with words that say to try again
//       any other company: kept, marked unscanned, and scanned by the look-behind once the scanner answers
//
// The look-behind (sweep()): every unscanned file first, then every file whose last scan is older than
// SOS_SCAN_RESCAN_DAYS, under the day's signatures (a file that was clean by last week's signatures may not be by
// today's). A stored file that a later scan flags is REMOVED: the row goes, the removal is on the company's record
// and a phone alert says so. A false alarm costs a photo or a sheet the manager sends again; a kept file would be
// served back to a browser. A spreadsheet's bytes are not kept after it is read (only its rows), and an icon lives in
// the company's brand, so the look-behind is over platform.attachments, where the bytes are.
const net = require("net");
const { q, logEvent } = require("./db");

const HOST = () => String(process.env.SOS_SCAN_HOST || "").trim();
const PORT = () => Number(process.env.SOS_SCAN_PORT || 3310);
const TIMEOUT = () => Number(process.env.SOS_SCAN_TIMEOUT_MS || 20000);
const SWEEP_MIN = Number(process.env.SOS_SCAN_SWEEP_MIN === undefined ? 60 : process.env.SOS_SCAN_SWEEP_MIN);
const RESCAN_DAYS = Number(process.env.SOS_SCAN_RESCAN_DAYS || 7);
const STALE_DAYS = Number(process.env.SOS_SCAN_STALE_DAYS || 3);
const CHUNK = 256 * 1024;
const configured = () => Boolean(HOST());

const SCHEMA = `
ALTER TABLE platform.attachments ADD COLUMN IF NOT EXISTS scan TEXT;               -- clean | unscanned (NULL: stored before there was a scanner)
ALTER TABLE platform.attachments ADD COLUMN IF NOT EXISTS scanned_at TIMESTAMPTZ;
ALTER TABLE platform.attachments ADD COLUMN IF NOT EXISTS scan_sig TEXT;           -- the signature set that said clean: "27784 of Oct 7 2026"
CREATE INDEX IF NOT EXISTS attachments_scan ON platform.attachments (scanned_at NULLS FIRST);
`;
async function init() { await q(SCHEMA); }

// ---- clamd's protocol -------------------------------------------------------------------------------------------
// One command a connection, the "z" form: the command and the answer each end in a zero byte. INSTREAM sends the file
// as chunks, each led by its length in four bytes, ended by a chunk of length zero.
function talk(command, body) {
  return new Promise((resolve, reject) => {
    const got = [];
    let done = false;
    const sock = net.connect({ host: HOST(), port: PORT() });
    const answer = () => Buffer.concat(got).toString("utf8").replace(/\0[\s\S]*$/, "").trim();
    const finish = (err, val) => { if (done) return; done = true; clearTimeout(timer); sock.destroy(); if (err) reject(err); else resolve(val); };
    const timer = setTimeout(() => finish(new Error("the scanner did not answer in time")), TIMEOUT());
    sock.on("connect", () => {
      sock.write(`z${command}\0`);
      if (!body) return;
      for (let i = 0; i < body.length; i += CHUNK) {
        const part = body.subarray(i, i + CHUNK), len = Buffer.alloc(4);
        len.writeUInt32BE(part.length);
        sock.write(len); sock.write(part);
      }
      sock.write(Buffer.alloc(4));
    });
    sock.on("data", (d) => { got.push(d); if (d.includes(0)) finish(null, answer()); });
    sock.on("end", () => finish(null, answer()));
    // the scanner may answer (a file over its limit) and hang up while the rest is still being written: the answer wins
    sock.on("error", (e) => (got.length ? finish(null, answer()) : finish(new Error(`the scanner could not be reached (${e.code || e.message})`))));
  });
}
// Pure: what clamd's one line means. -> { verdict: clean | infected | error, signature?, reason? }
// "Heuristics.Limits.Exceeded..." is the scanner saying a file was past one of its own limits, not that it found
// anything (only when it is set to alert on that): an error, never a flag, or the look-behind would remove a large
// clean file.
function readVerdict(line) {
  const s = String(line || "").trim();
  if (/^stream: OK$/.test(s)) return { verdict: "clean" };
  const hit = /^stream: (.+) FOUND$/.exec(s);
  if (hit && /^Heuristics\.Limits\.Exceeded/i.test(hit[1])) return { verdict: "error", reason: `past the scanner's size limit (${hit[1].slice(0, 80)})` };
  if (hit) return { verdict: "infected", signature: hit[1].slice(0, 120) };
  return { verdict: "error", reason: s ? s.slice(0, 200) : "the scanner hung up without an answer" };
}
// Pure: "ClamAV 1.4.3/27784/Tue Oct  7 09:27:45 2026" -> { engine, signatures, signatures_at } (null when it is not that).
// A scanner with no signature set of its own loaded answers "ClamAV 1.5.4" alone (seen against a real clamd 1.5.4
// started with a hand-made set, 2026-10-08): it is there, and it has no signatures to name, which is a fault.
function readVersion(line) {
  const m = /^ClamAV ([^/\s]+)(?:\/(\d+)\/(.+))?$/.exec(String(line || "").trim());
  if (!m) return null;
  if (!m[2]) return { engine: m[1], signatures: null, signatures_at: null };
  const at = new Date(`${m[3].replace(/\s+/g, " ")} UTC`);
  return { engine: m[1], signatures: Number(m[2]), signatures_at: Number.isNaN(at.getTime()) ? null : at.toISOString() };
}
const sigLabel = (v) => (v && v.signatures ? `${v.signatures}${v.signatures_at ? ` of ${v.signatures_at.slice(0, 10)}` : ""}` : v ? `engine ${v.engine}, no signature set named` : null);

async function scanBuffer(buf) {
  if (!configured()) return { verdict: "error", reason: "no scanner on this instance" };
  try { return readVerdict(await talk("INSTREAM", Buffer.isBuffer(buf) ? buf : Buffer.from(buf))); }
  catch (e) { return { verdict: "error", reason: e.message }; }
}

// ---- is the scanner there, and how old are its signatures -----------------------------------------------------------
const state = { checked_at: 0, reachable: false, version: null, error: null, down_since: null, last_sweep: null, last_flag: null };
async function health(force) {
  if (!configured()) return { configured: false, reachable: false };
  if (!force && Date.now() - state.checked_at < 60000) return view();
  state.checked_at = Date.now();
  try {
    const v = readVersion(await talk("VERSION"));
    if (!v) throw new Error("the scanner answered something that is not a version");
    state.reachable = true; state.version = v; state.error = null; state.down_since = null;
  } catch (e) {
    state.reachable = false; state.error = e.message; state.down_since = state.down_since || new Date().toISOString();
  }
  return view();
}
// old signatures, or a scanner that names none: both are a fault
function stale(v, now = Date.now()) { return Boolean(v && (!v.signatures_at || now - Date.parse(v.signatures_at) > STALE_DAYS * 86400e3)); }
function view() {
  return { configured: configured(), reachable: state.reachable, engine: state.version ? state.version.engine : null, signatures: state.version ? state.version.signatures : null,
    signatures_at: state.version ? state.version.signatures_at : null, stale: stale(state.version), stale_days: STALE_DAYS, error: state.error, down_since: state.down_since,
    last_sweep: state.last_sweep, last_flag: state.last_flag, rescan_days: RESCAN_DAYS };
}
// What the Instance tab shows: the scanner, and how the stored files stand.
async function status() {
  const h = await health();
  const c = (await q(`SELECT count(*)::int AS total, count(*) FILTER (WHERE scan='clean')::int AS clean,
                             count(*) FILTER (WHERE scan IS DISTINCT FROM 'clean')::int AS unscanned, count(*) FILTER (WHERE scan IS DISTINCT FROM 'clean' AND scanned_at IS NOT NULL)::int AS not_taken,
                             min(scanned_at) FILTER (WHERE scan='clean') AS oldest_scan
                        FROM platform.attachments`)).rows[0];
  const need = (await q("SELECT count(*)::int AS n FROM platform.companies WHERE require_scan").catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n;
  return { ...h, host: configured() ? HOST() : null, files: c, companies_requiring: need };
}

// ---- the rule at the door ------------------------------------------------------------------------------------------
const WHAT = { photo: "a photo with a request", attachment: "a file added to a new tool's questions", sheet: "a spreadsheet for a tool", icon: "the company's icon from its site" };
async function flagged({ company, what, filename, signature, stored, ids }) {
  state.last_flag = { at: new Date().toISOString(), company, what, stored: Boolean(stored) };
  const co = (await q("SELECT name FROM platform.companies WHERE slug=$1", [company]).catch(() => ({ rows: [] }))).rows[0];
  await logEvent(stored ? "scan_removed" : "scan_refused", company, { what, signature, filename: String(filename || "").slice(0, 200), ...(ids || {}) }).catch(() => {});
  await require("./record").record(stored ? "file_removed_by_scan" : "file_refused_by_scan", { company, actor: "platform", feedback_id: (ids && ids.feedback_id) || null, intake_id: (ids && ids.intake_id) || null,
    after: stored ? "a stored file was removed: a later malware scan flagged it" : "a file was refused: the malware scan flagged it", detail: { what, signature, filename: String(filename || "").slice(0, 200) } });
  // the company and the kind of file, never its name or a person's words (src/notify.js)
  require("./notify").notify(stored ? "Malware scan removed a stored file" : "Malware scan refused a file", `${(co && co.name) || company}: ${WHAT[what] || "a file"} was ${stored ? "removed, flagged by a later scan" : "refused"} (${signature}). It is in the event log.`, { priority: 4, tags: ["biohazard"], ref: company });
}
function scannerDown(reason) {
  require("./notify").notifyEvery("scan_down", 6 * 3600e3, "The upload scanner is not answering", `Until it does, files are kept unscanned for most companies and refused for the ones whose uploads must be scanned (${String(reason || "").slice(0, 120)}). Check the scanner service on Railway.`, { priority: 4, tags: ["warning"] });
}
// check({ company, bytes, what, filename, ids }) -> { scan, scanned_at, scan_sig } to store beside the file, or throws
// (status 422 flagged, 503 could not be scanned and this company's uploads must be) with words a person can read.
async function check({ company, bytes, what, filename, ids }) {
  const must = await require("./safeguards").mustScan(company);
  const none = { scan: "unscanned", scanned_at: null, scan_sig: null };
  const refuse = () => Object.assign(new Error("that file could not be scanned for malware just now, so it was not kept. Try again in a few minutes."), { status: 503, unscanned: true });
  if (!configured()) { if (must) throw refuse(); return none; }
  const r = await scanBuffer(bytes);
  if (r.verdict === "infected") {
    await flagged({ company, what, filename, signature: r.signature, stored: false, ids });
    throw Object.assign(new Error("that file was not kept: the malware scan flagged it. If that looks wrong, tell Anetix."), { status: 422, infected: true });
  }
  if (r.verdict !== "clean") {
    console.error(`[scan] ${company}: ${what} not scanned (${r.reason})`);
    // one file the scanner would not take (its size, a scan that ran out of time) is that file's trouble; the scanner
    // is away only if it does not answer when asked who it is
    if (!(await health(true).catch(() => ({ reachable: false }))).reachable) scannerDown(r.reason);
    if (must) throw refuse();
    return none;
  }
  // it answered: whatever the last look said, the scanner is there (and its version is asked again when it had gone away)
  if (!state.version || !state.reachable) await health(true).catch(() => {});
  return { scan: "clean", scanned_at: new Date(), scan_sig: sigLabel(state.version) };
}

// ---- the look-behind -----------------------------------------------------------------------------------------------
let sweeping = false;
async function sweep({ limit = 200 } = {}) {
  if (!configured()) return { skipped: "no scanner on this instance" };
  if (sweeping) return { skipped: "already running" };
  sweeping = true;
  const out = { scanned: 0, clean: 0, removed: 0, left: 0 };
  try {
    const h = await health(true);
    if (!h.reachable) { scannerDown(h.error); return { skipped: `the scanner is not answering (${h.error})` }; }
    if (h.stale) require("./notify").notifyEvery("scan_stale", 24 * 3600e3, "The upload scanner's signatures are old", `${h.signatures_at ? `Its newest signatures are from ${String(h.signatures_at).slice(0, 10)}, more than ${STALE_DAYS} days ago` : "It names no signature set at all"}. Restart the scanner service on Railway and look at its log.`, { priority: 4, tags: ["warning"] });
    // never tried (kept while the scanner was away, or from before there was one); tried and not taken, once a day;
    // clean, once its scan is RESCAN_DAYS old
    const rows = (await q(
      `SELECT id, company, filename, feedback_id, intake_id FROM platform.attachments
        WHERE scanned_at IS NULL
           OR (scan IS DISTINCT FROM 'clean' AND scanned_at < now() - interval '1 day')
           OR (scan = 'clean' AND scanned_at < now() - ($2 || ' days')::interval)
        ORDER BY scanned_at NULLS FIRST, id LIMIT $1`, [limit, String(RESCAN_DAYS)])).rows;
    for (const a of rows) {
      const b = (await q("SELECT bytes FROM platform.attachments WHERE id=$1", [a.id])).rows[0];
      if (!b) continue;
      const r = await scanBuffer(b.bytes);
      out.scanned++;
      if (r.verdict === "clean") { await q("UPDATE platform.attachments SET scan='clean', scanned_at=now(), scan_sig=$2 WHERE id=$1", [a.id, sigLabel(state.version)]); out.clean++; continue; }
      if (r.verdict === "infected") {
        await q("DELETE FROM platform.attachments WHERE id=$1", [a.id]);
        await flagged({ company: a.company, what: a.feedback_id ? "photo" : "attachment", filename: a.filename, signature: r.signature, stored: true, ids: { feedback_id: a.feedback_id, intake_id: a.intake_id } });
        out.removed++; continue;
      }
      // One file the scanner would not take (its size, a scan that ran out of time) is marked as tried, with why, and
      // passed over until tomorrow: left untried it would be first in line every round and nothing behind it would
      // ever be scanned (the review of 2026-10-08). Only a scanner that went away ends the round.
      if ((await health(true)).reachable) {
        await q("UPDATE platform.attachments SET scan='unscanned', scanned_at=now(), scan_sig=$2 WHERE id=$1", [a.id, `not taken by the scanner: ${String(r.reason || "no reason given").slice(0, 100)}`]);
        console.error(`[scan] look-behind: file ${a.id} was not taken (${r.reason}); tried again tomorrow`);
        out.left++; continue;
      }
      console.error(`[scan] look-behind stopped at file ${a.id}: the scanner went away (${r.reason})`);
      scannerDown(r.reason);
      out.left += rows.length - out.scanned + 1; break;
    }
    state.last_sweep = { at: new Date().toISOString(), ...out };
    if (out.scanned) console.log(`[scan] look-behind: ${out.scanned} file(s) scanned, ${out.clean} clean, ${out.removed} removed${out.left ? `, ${out.left} left for next time` : ""}`);
    return out;
  } finally { sweeping = false; }
}
function start() {
  if (!configured()) { console.log("[scan] SOS_SCAN_HOST is not set: uploads are kept unscanned (a company whose uploads must be scanned gets them refused)"); return; }
  health(true).then((h) => console.log(h.reachable ? `[scan] the scanner answers at ${HOST()}:${PORT()}: engine ${h.engine}, ${h.signatures ? `signatures ${h.signatures} of ${String(h.signatures_at).slice(0, 10)}${h.stale ? " (OLD)" : ""}` : "NO signature set named"}` : `[scan] the scanner at ${HOST()}:${PORT()} is not answering yet (${h.error})`)).catch(() => {});
  if (!SWEEP_MIN) return;
  setTimeout(() => sweep().catch((e) => console.error("[scan] look-behind:", e.message)), 90000).unref();
  setInterval(() => sweep().catch((e) => console.error("[scan] look-behind:", e.message)), SWEEP_MIN * 60e3).unref();
}

module.exports = { init, SCHEMA, configured, scanBuffer, readVerdict, readVersion, sigLabel, stale, health, status, check, sweep, start, WHAT, _state: state };
