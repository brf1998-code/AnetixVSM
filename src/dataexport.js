// A company's own data, as one JSON file (the Terms, 10.6: "Customer may export its Customer Data in a standard
// machine-readable format at any time"; the launch audit, C9, 2026-09-27). Brendan's line: "We will promise to export
// their data but not export their module. We will need to own their modules but their data is their data." So the
// file holds what the company's people put in and what their tools keep, and never a tool's code, its versions, the
// AI's proposals, builds or designs (the Terms, 12.1: the code of the Tools is part of the Service).
//
// In the file:
//   tools        each tool's name and title, and every table in its live schema with every row (the records the tool
//                keeps; sample rows a demo filled are marked by the tool's own data, as they are on screen)
//   requests     every request and piece of feedback: the words, who, the screen, the status, the answers to questions,
//                and Anetix's answer to a request to Anetix
//   intakes      each new-tool intake's answers, in the order given
//   attachments  the photos and files attached, base64 (a file over ATTACH_MAX is listed without its bytes)
//   uploads      spreadsheets uploaded to a tool's connections, as they were read
//   print_jobs   the labels sent to a printer
//   people       the floor's people by name and role (never a PIN)
//   managers     the manager accounts' sign-in emails and names (never a password or an authenticator)
//   record       what the company's own people said and decided, word for word (floor, manager and named people's
//                rows of the record; the agent's and the platform's rows are Anetix's Output and carry build summaries
//                and designs, so they stay out)
//   site         a paying site's facts as the order form had them (no card, no Stripe ids)
//
// Routes: GET /api/c/:slug/export (the company's manager; an admin too). Each download goes on the event log.
//
// Also here, the retention the privacy notice promises (anetix.ai/privacy, "How long Anetix keeps it"):
//   - a demo request is deleted 12 months after it was made unless it led to a demo (sweep at boot and daily)
//   - a refused pin's line on the Pins tab is deleted after 90 days (the launch audit 0.3)
//   - idle(): companies whose last sign-in is 11 months old or more, for the Demos tab (the Terms, 6.3 and 10.7: the
//     data may go after 12 months with no sign-in; deleting is Brendan's button, with the customer told first)
const express = require("express");
const { q, logEvent } = require("./db");
const auth = require("./auth");

const SLUG = /^[a-z0-9][a-z0-9-]{1,40}$/;
const B_CONTACT = "brendan@anetix.ai or taylor@anetix.ai";
const ident = (s) => String(s).replace(/[^a-z0-9_]/gi, "_").toLowerCase();   // the same as src/dbroles.js
const ATTACH_MAX = Number(process.env.SOS_EXPORT_ATTACH_MAX || 15 * 1024 * 1024);          // one file
const ATTACH_TOTAL = Number(process.env.SOS_EXPORT_ATTACH_TOTAL || 60 * 1024 * 1024);      // all the files in one export (the file is built in memory)
const HUMAN = ["floor", "manager", "person"];   // the record's actor roles that are the company's own people
const plain = (row) => { const o = {}; for (const [k, v] of Object.entries(row)) o[k] = Buffer.isBuffer(v) ? { base64: v.toString("base64") } : v; return o; };   // a bytea column reads as base64, not a list of numbers
// record kinds that carry model names or AI costs: Usage Data under the Terms, and no model names to companies
const RECORD_SKIP = new Set(["models_changed", "model_pinned", "model_unpinned"]);

async function tableRows(schema, table) {
  return (await q(`SELECT * FROM "${schema}"."${table}"`)).rows;
}
async function toolsOf(slug) {
  const mods = (await q("SELECT name, title, created_at FROM platform.modules WHERE company=$1 ORDER BY created_at, name", [slug])).rows;
  const out = [];
  for (const m of mods) {
    const schema = `mod_${ident(slug)}_${ident(m.name)}`;
    const tables = (await q("SELECT tablename FROM pg_tables WHERE schemaname=$1 AND tablename NOT LIKE '\\_%' ORDER BY tablename", [schema])).rows.map((r) => r.tablename);
    const data = {};
    for (const t of tables) data[t] = (await tableRows(schema, t)).map(plain);
    out.push({ name: m.name, title: m.title || m.name, since: m.created_at, tables: data });
  }
  return out;
}

async function exportCompany(slug) {
  slug = String(slug || "").toLowerCase();
  const co = SLUG.test(slug) ? (await q("SELECT slug, name, created_at, demo FROM platform.companies WHERE slug=$1", [slug])).rows[0] : null;
  if (!co) throw Object.assign(new Error("no such company"), { status: 404 });
  const requests = (await q(`SELECT id, module, page, kind, message, name, status, outcome, question, floor_answer, floor_answer_at,
      manager_answer, manager_answer_at, follow_up_of, duplicate_of, shipped_version, shipped_at, anetix_stage, anetix_note, anetix_at,
      created_at, updated_at FROM platform.feedback WHERE company=$1 ORDER BY id`, [slug])).rows;
  const intakes = (await q("SELECT id, feedback_id, name, slug AS tool, status, answers, created_at, updated_at FROM platform.module_intakes WHERE company=$1 ORDER BY id", [slug])).rows;
  // the files one at a time, newest first, until the export's total is spent; the rest are listed for Anetix to send
  let left = ATTACH_TOTAL;
  const attachments = [];
  for (const a of (await q("SELECT id, feedback_id, intake_id, filename, mime, size, created_at FROM platform.attachments WHERE company=$1 ORDER BY id DESC", [slug])).rows) {
    const row = { id: a.id, feedback_id: a.feedback_id, intake_id: a.intake_id, filename: a.filename, mime: a.mime, size: a.size, created_at: a.created_at };
    const n = Number(a.size) || 0;
    if (n > ATTACH_MAX || n > left) { attachments.push({ ...row, base64: null, note: `Not in this file (too large to include). Ask Anetix for it: ${B_CONTACT}.` }); continue; }
    const b = (await q("SELECT bytes FROM platform.attachments WHERE id=$1", [a.id])).rows[0];
    const buf = b && b.bytes != null ? (Buffer.isBuffer(b.bytes) ? b.bytes : Buffer.from(String(b.bytes))) : null;
    if (!buf) { attachments.push({ ...row, base64: null, note: "No bytes kept." }); continue; }
    left -= buf.length;
    attachments.push({ ...row, base64: buf.toString("base64") });
  }
  attachments.reverse();
  const uploads = (await q("SELECT id, module, filename, headers, rows, row_count, status, created_at, loaded_at FROM platform.connection_uploads WHERE company=$1 ORDER BY id", [slug])).rows;
  const print_jobs = (await q("SELECT id, module, device, template, zpl, status, printer, created_at FROM platform.print_jobs WHERE company=$1 ORDER BY id", [slug])).rows;
  const people = (await q("SELECT name, role, active, created_at FROM platform.people WHERE company=$1 ORDER BY name", [slug])).rows;
  const managers = (await q("SELECT login AS email, display_name AS name, created_at FROM platform.accounts WHERE role='manager' AND company=$1 ORDER BY created_at", [slug])).rows;
  const record = (await q("SELECT kind, module, actor_role, actor_name, feedback_id, intake_id, version, before, after, created_at FROM platform.record WHERE company=$1 AND actor_role = ANY($2) ORDER BY id", [slug, HUMAN])).rows
    .filter((r) => !RECORD_SKIP.has(r.kind));
  const s = (await q("SELECT stage, site_name, legal_name, site_address, plant_manager, headcount, sqft, billing, band, price_usd, learning_opt_in, activated_at, converted_at, returned_at FROM platform.sites WHERE company=$1", [slug]).catch(() => ({ rows: [] }))).rows[0];
  return {
    format: "anetix-export-1",
    exported_at: new Date().toISOString(),
    company: { slug: co.slug, name: co.name, since: co.created_at, demo: Boolean(co.demo) },
    note: "Your company's data in Anetix (the Terms of Service, section 10.6): what your people entered and what your tools keep. The tools' code is part of the Anetix service and is not in this file (section 12.1).",
    tools: await toolsOf(slug),
    requests, intakes, attachments, uploads, print_jobs, people, managers, record,
    site: s || null,
  };
}

// ---- retention ---------------------------------------------------------------------------------------------------------
async function sweepDemoRequests() {
  const r = await q(`DELETE FROM platform.demo_requests d WHERE d.created_at < now() - interval '12 months'
                       AND NOT EXISTS (SELECT 1 FROM platform.self_serve s WHERE s.pin_id IS NOT NULL AND s.pin_id = d.pin_id)`).catch((e) => { console.error("[retention] demo requests:", e.message); return { rowCount: 0 }; });
  if (r.rowCount) console.log(`[retention] ${r.rowCount} demo request(s) older than 12 months deleted (the privacy notice)`);
  // a pin carries the email it was made for and a "Name at Company" label: one nobody came in on goes after 12 months too
  const p = await q(`DELETE FROM platform.access_pins p WHERE p.created_at < now() - interval '12 months'
                       AND NOT EXISTS (SELECT 1 FROM platform.self_serve s WHERE s.pin_id = p.id)
                       AND NOT EXISTS (SELECT 1 FROM platform.demo_requests d WHERE d.pin_id = p.id)`).catch((e) => { console.error("[retention] pins:", e.message); return { rowCount: 0 }; });
  if (p.rowCount) console.log(`[retention] ${p.rowCount} unused pin(s) older than 12 months deleted (the privacy notice)`);
  // a refused pin's line (the pin and email typed, the address) is kept 90 days (the launch audit 0.3; the privacy notice)
  const f = await q("DELETE FROM platform.pin_refusals WHERE last_at < now() - interval '90 days'").catch((e) => { console.error("[retention] pin refusals:", e.message); return { rowCount: 0 }; });
  if (f.rowCount) console.log(`[retention] ${f.rowCount} refused pin line(s) older than 90 days deleted (the privacy notice)`);
  return r.rowCount + p.rowCount + f.rowCount;
}
let sweepTimer = null;
function startSweeps() {
  sweepDemoRequests();
  if (!sweepTimer) { sweepTimer = setInterval(sweepDemoRequests, 24 * 3600e3); sweepTimer.unref(); }
}
// Companies from anetix.ai (and sites back to a demo) whose last sign-in is 11 months ago or more. A company nobody
// ever signed in to counts from the day it was made. A subscribed site is never listed: it is paying.
async function idle({ months = 11 } = {}) {
  return (await q(`
    SELECT c.slug, c.name, c.created_at, greatest(c.created_at, max(e.at)) AS last_sign_in,
           greatest(c.created_at, max(e.at)) + interval '12 months' AS delete_after
      FROM platform.companies c
      LEFT JOIN platform.self_serve ss ON ss.company = c.slug
      LEFT JOIN platform.sites st ON st.company = c.slug
      LEFT JOIN platform.accounts a ON a.company = c.slug
      LEFT JOIN platform.auth_events e ON e.account_id = a.id AND e.event IN ('login_ok','recovery_used','signin_trusted_device','login_passkey')
     WHERE (ss.company IS NOT NULL OR st.stage = 'back_to_demo') AND coalesce(st.stage, 'demo') <> 'subscribed'
     GROUP BY c.slug, c.name, c.created_at
    HAVING greatest(c.created_at, max(e.at)) < now() - ($1 || ' months')::interval
     ORDER BY 4`, [String(months)]).catch((e) => { console.error("[retention] idle:", e.message); return { rows: [] }; })).rows;
}

// ---- routes ------------------------------------------------------------------------------------------------------------
const router = express.Router();
const exporting = new Set();   // one export per company at a time: the file is built in memory
router.get("/api/c/:slug/export", auth.requireManager, async (req, res) => {
  const slug = String(req.params.slug || "").toLowerCase();
  if (exporting.has(slug)) return res.status(429).json({ error: "An export of this company is being made already. Try again in a minute." });
  exporting.add(slug);
  try {
    const doc = await exportCompany(req.params.slug);
    await logEvent("data_exported", doc.company.slug, { by: req.sosAccount ? req.sosAccount.login : req.sosRole, tools: doc.tools.length, requests: doc.requests.length });
    res.set({ "Cache-Control": "no-store", "Content-Disposition": `attachment; filename="anetix-${doc.company.slug}-data-${doc.exported_at.slice(0, 10)}.json"` });
    res.type("application/json").send(JSON.stringify(doc, null, 1));
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  finally { exporting.delete(slug); }
});

module.exports = { router, exportCompany, sweepDemoRequests, startSweeps, idle, RECORD_SKIP };
