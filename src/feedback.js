// Platform APIs: feedback capture + improvement board + pipeline actions +
// agent settings/docs + admin. Everything is scoped by company (/api/c/:slug/...)
// except run actions, which are addressed by run id.
const express = require("express");
const { q, logEvent, upsertDoc } = require("./db");
const { generateProposal } = require("./proposals");
const pipeline = require("./pipeline");
const registry = require("./registry");
const agent = require("./agent");
const review = require("./review");
const diagrams = require("./diagrams");
const auth = require("./auth");
const { requireManager, requireAdmin } = auth;
const qrcode = require("./qrcode");
const brand = require("./brand");
const backup = require("./backup");
const migrate = require("./migrate");
const intake = require("./intake");
const { record, actor } = require("./record");
const health = require("./health");
const connections = require("./connections");
const datacheck = require("./datacheck");
const people = require("./people");
// a signed-in name whose PIN is older than SOS_APPROVAL_PIN_HOURS is asked for it again on an approval (src/people.js)
const freshPin = people.requireFreshPin;
const closeloop = require("./closeloop");
const arrival = require("./arrival");
const testfloor = require("./testfloor");
const campaign = require("./campaign");
const datawall = require("./datawall");
const selfserve = require("./selfserve");   // self-serve companies from anetix.ai: the credit on the board and the company card, gone with the company

const router = express.Router();
// the restore route carries a whole backup and parses its own body; a request from the floor may carry one photo
// (the widget scales it down first), so exactly /api/feedback gets a bigger body and nothing else does
const smallJson = express.json({ limit: "1mb" }), photoJson = express.json({ limit: "6mb" });
router.use((req, res, next) => (req.path === "/api/admin/restore" || /^\/api\/c\/[^/]+\/connections\/[^/]+\/[^/]+\/upload$/.test(req.path) ? next() : (req.path === "/api/feedback" && req.method === "POST" ? photoJson : smallJson)(req, res, next)));

async function company(slug) {
  return (await q("SELECT * FROM platform.companies WHERE slug=$1", [slug])).rows[0];
}
const SLUG = /^[a-z0-9][a-z0-9-]{1,40}$/;

// ---- capture (feedback widget posts here) ---------------------------------
// module "platform" (or none) = feedback about the platform itself. Those items
// are not built by the in-app agent; Brendan picks them up from Cowork via
// GET /api/c/:slug/feedback/platform and ships the change through the repo.
router.post("/api/feedback", async (req, res) => {
  const { company: slug, module: mod, page, message, name, element, photo } = req.body || {};
  if (!message || !message.trim()) return res.status(400).json({ error: "message required" });
  // a floor or manager session files into its own company, whatever the body says
  const co = req.sosRole === "admin" ? ((await company(slug || "demo")) || (await company("demo"))) : await company(req.sosCompany);
  if (!co) return res.status(404).json({ error: "unknown company" });
  let screen = null, target = null;
  if (mod && mod !== "platform") {
    const row = await registry.getModule(co.slug, mod);
    if (row && row.live_version) {
      const hit = registry.screenFor(registry.readManifest(co.slug, mod, row.live_version), page);
      if (hit) { screen = hit.label; target = hit.file; }
    }
  } else if (page) {
    screen = /\/agents/.test(page) ? "Agent settings page" : /\/admin/.test(page) ? "Admin page" : "Improvement board";
  }
  // a person signed in on this device (name and PIN) files under their own name; a named account (an admin or a
  // demo's manager, signed in with a code) files under the account's name (Brendan, 2026-09-26: the system knows who
  // it is, so no request from an account should arrive nameless); a typed name is only for a device nobody is signed in on
  const mine = req.sosPersonId && req.sosPersonCompany === co.slug;
  const accountName = req.sosAccount ? (req.sosAccount.name || req.sosAccount.login || "") : "";
  // what the person pointed at, for the proposer (src/arrival.js); a token so the device that sent a nameless request can answer its question
  const pointed = mod && mod !== "platform" ? arrival.cleanElement(element) : null;
  const r = await q(
    `INSERT INTO platform.feedback (company, module, page, screen, target_file, message, name, person_id, element, reply_token) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [co.slug, mod || "platform", page || null, screen, target, message.trim().slice(0, 2000), ((mine ? req.sosPerson : accountName || name) || "").slice(0, 80) || null, mine ? req.sosPersonId : null, pointed ? JSON.stringify(pointed) : null, arrival.newToken()]);
  const fb = r.rows[0];
  // one photo, already scaled down by the widget; a company can switch photos off (Agent settings)
  let photoNote = null;
  if (photo && photo.data && mod && mod !== "platform") {
    try {
      if (co.allow_photos === false) throw new Error("photos are switched off for this company");
      if (co.ai_reads_data === false) throw new Error("photos are switched off for this company while the AI is walled off from its data; the words went through");
      const mime = String(photo.mime || "image/jpeg").toLowerCase();
      if (!/^image\/(jpeg|png|webp)$/.test(mime)) throw new Error("a photo is a jpeg, png or webp");
      const bytes = Buffer.from(String(photo.data).replace(/^data:[^,]*,/, ""), "base64");
      if (bytes.length < 100 || bytes.length > 4 * 1024 * 1024) throw new Error("the photo is too large");
      // a bound on what a floor device can put in the database: photos a company a day
      const today = Number((await q("SELECT count(*) FROM platform.attachments WHERE company=$1 AND feedback_id IS NOT NULL AND created_at > now() - interval '24 hours'", [co.slug])).rows[0].count);
      if (today >= arrival.PHOTOS_PER_DAY) throw new Error("enough photos for one day; the words went through");
      await q("INSERT INTO platform.attachments (company, feedback_id, filename, mime, size, bytes) VALUES ($1,$2,$3,$4,$5,$6)", [co.slug, fb.id, `request-${fb.id}.${mime.split("/")[1].replace("jpeg", "jpg")}`, mime, bytes.length, bytes]);
    } catch (e) { photoNote = e.message; }
  }
  await logEvent("feedback_submitted", fb.id, { company: co.slug, module: mod, screen });
  await record("feedback_filed", { company: co.slug, module: mod || "platform", actor: actor(req, name), feedback_id: fb.id, after: message.trim(), detail: { screen, page, ...(pointed ? { pointed: arrival.clip(`${pointed.tag || ""} ${pointed.text || pointed.id || ""}`, 120) } : {}), ...(photo && photo.data ? { photo: !photoNote } : {}) } });
  // the proposer reads it now (src/arrival.js): claimed before the answer goes back, worked behind it; never throws
  const reading = await arrival.start(fb.id);
  res.json({ ...fb, arrival: reading ? "proposing" : null, photo_note: photoNote });
});

// a request's reply_token (src/arrival.js) goes back to the device that sent it and to nobody else
const noToken = (row) => { if (row) delete row.reply_token; return row; };
router.post("/api/feedback/:id/plusone", async (req, res) => {
  const r = await q("UPDATE platform.feedback SET recurrence = recurrence + 1, updated_at=now() WHERE id=$1 RETURNING *", [req.params.id]);
  res.json(noToken(r.rows[0]));
});

// Platform-level feedback, for the Cowork revision loop (plain JSON, newest first).
router.get("/api/c/:slug/feedback/platform", requireManager, async (req, res) => {
  const status = req.query.status || "new";
  const rows = (await q(
    `SELECT id, page, screen, message, name, status, recurrence, outcome, created_at
       FROM platform.feedback WHERE company=$1 AND module='platform' AND ($2 = 'all' OR status=$2) ORDER BY id DESC`, [req.params.slug, status])).rows;
  res.json(rows);
});

router.post("/api/feedback/:id/close", requireManager, async (req, res) => {
  const { outcome, declined } = req.body || {};
  const r = await q("UPDATE platform.feedback SET status=$2, outcome=$3, updated_at=now() WHERE id=$1 RETURNING *",
    [req.params.id, declined ? "declined" : "done", outcome || null]);
  if (r.rows[0]) await record("feedback_closed", { company: r.rows[0].company, module: r.rows[0].module, actor: actor(req), feedback_id: r.rows[0].id, after: outcome || null, detail: { declined: Boolean(declined) } });
  res.json(noToken(r.rows[0]));
});

// The manager's close-out on a shipped tile (src/closeloop.js): Done (the asker reads a check mark and a
// thank-you) or "a little left" (what is left goes back on the board as a linked follow-up). Manager only, and
// on a path the module page policy does not open, so a module page in a manager's browser cannot reach it.
router.post("/api/feedback/:id/closeout", requireManager, async (req, res) => {
  try {
    const fb = (await q("SELECT company FROM platform.feedback WHERE id=$1", [Number(req.params.id) || 0])).rows[0];
    if (!fb) return res.status(404).json({ error: "no such request" });
    res.json(await closeloop.managerAnswer({ company: fb.company, feedbackId: req.params.id, actor: actor(req), answer: (req.body || {}).answer, what: (req.body || {}).what }));
  } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});

// Module version probe: module pages poll this and reload when it changes.
router.get("/api/c/:slug/modules/:name/version", async (req, res) => {
  const row = await registry.getModule(req.params.slug, req.params.name);
  if (!row) return res.status(404).json({ error: "unknown module" });
  // the test floor's page (src/testfloor.js) reloads when its version moves or its data was rebuilt, and leaves when the floor is switched off
  const tf = req.query.lane === "test" ? await testfloor.status(req.params.slug) : null;
  res.set("Cache-Control", "no-store").json({ live_version: row.live_version, staged_version: row.staged_version,
    ...(tf ? { test_floor: tf.on, test_version: tf.on ? testfloor.effective(row) : null, test_built_at: tf.built_at } : {}) });
});

// Guided tour steps for a module (any signed-in role; the widget drives it).
router.get("/api/c/:slug/modules/:name/tour", async (req, res) => {
  try {
    const t = await registry.tourFor(req.params.slug, req.params.name);
    if (!t) return res.status(404).json({ error: "no tour for this module" });
    res.json(t);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Version history and jumps (manager). Back or forward, with or without the
// data as it was when that version was last live.
router.get("/api/c/:slug/modules/:name/versions", requireManager, async (req, res) => {
  try { res.json(await registry.versionHistory(req.params.slug, req.params.name)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
// What a tool promises: every check its live version carries, in plain words, and the ones a manager retired.
router.get("/api/c/:slug/modules/:name/checks", requireManager, async (req, res) => {
  try {
    const row = await registry.getModule(req.params.slug, req.params.name);
    if (!row) return res.status(404).json({ error: "unknown module" });
    const acceptance = require("./acceptance");
    const files = row.live_version ? (await registry.versionFiles(req.params.slug, req.params.name, row.live_version)) || {} : {};
    const retired = await acceptance.listRetired(req.params.slug, req.params.name);
    const gone = new Set(retired.map((r) => r.file));
    res.json({ version: row.live_version, checks: acceptance.collect(files).checks.filter((c) => !gone.has(c.file)).map((c) => ({ file: c.file, title: c.title, steps: c.steps.length })), retired });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// The Terms, 9.1 (2026-09-26): a change to a customer's live tool goes live only when someone with approval rights at
// the customer approves it. Anetix changes a live tool without that only to fix a security problem or an error that
// stops the tool working, and tells the customer's manager when it does. An admin pressing Deploy, Roll back or Switch
// on a customer's board is Anetix doing it: the admin says which (or that the manager asked Anetix to put it live), and
// the manager gets a notice on the board (src/notices.js). "demo" is Anetix's own company.
const ANETIX_OWN = new Set(["demo"]);
const ADMIN_WHY = { security: "to fix a security problem", broken: "to fix an error that stopped the tool working", asked: "because your manager asked Anetix to" };
function adminChange(req, slug) {
  if (req.sosRole !== "admin" || ANETIX_OWN.has(slug)) return { ok: true };
  const b = req.body || {};
  const why = String(b.admin_reason || ""), note = String(b.admin_note || "").replace(/\s+/g, " ").trim().slice(0, 300);
  if (!ADMIN_WHY[why]) return { ok: false, error: "This is a customer's live tool. Say why Anetix is changing it: a security fix, a fix for an error that stops it working, or their manager asked. The manager is told either way.", code: "admin_reason" };
  if (note.length < 3) return { ok: false, error: "Add a few words on what changed: the manager reads them.", code: "admin_reason" };
  return { ok: true, why, note };
}
// Called after the change: the change has happened, so a notice that cannot be written is logged and never turns the
// answer into an error (record() never throws, so the interaction record still carries it).
async function tellManager(slug, what, gate) {
  if (!gate || !gate.why) return;
  try { await require("./notices").add(slug, "tool_changed", `Anetix ${what} ${ADMIN_WHY[gate.why]}: ${gate.note}`, { why: gate.why }); }
  catch (e) { console.error(`[notices] ${slug}: the manager's notice could not be written (${e.message}); the change stands`); }
  await record("tool_changed_by_anetix", { company: slug, actor: { role: "admin" }, after: `${what} ${ADMIN_WHY[gate.why]}: ${gate.note}`, detail: { why: gate.why } });
}
router.post("/api/c/:slug/modules/:name/goto", requireManager, freshPin, async (req, res) => {
  const { version, restore_data } = req.body || {};
  const gate = adminChange(req, req.params.slug);
  if (!gate.ok) return res.status(400).json({ error: gate.error, code: gate.code });
  const row = await registry.getModule(req.params.slug, req.params.name);
  if (!row) return res.status(404).json({ error: "unknown module" });
  const busy = (await q(
    "SELECT id FROM platform.build_runs WHERE company=$1 AND module=$2 AND status='running'", [req.params.slug, req.params.name])).rows[0];
  if (busy) return res.status(409).json({ error: "a build is running on this module; wait for it to reach the gate or cancel it first" });
  try {
    const out = await registry.goToVersion(req.params.slug, req.params.name, Number(version), { restoreData: !!restore_data });
    await record("version_switched", { company: req.params.slug, module: req.params.name, actor: actor(req), version: out.to, detail: { from: out.from, to: out.to, restored: out.restored } });
    await tellManager(req.params.slug, `switched ${row.title || req.params.name} from v${out.from} to v${out.to}${out.restored ? " with its data as it was then" : ""}`, gate);
    res.json(out);
  }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ---- board QR code ---------------------------------------------------------
// The board's own address as a scannable code, shown in the top right of the
// board and printable for the wall. One code per company: it points at
// /c/<slug>/, so whoever scans it lands on that company's board (and at the
// login page first if they have no session).
function boardUrl(req, slug) {
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  return `${proto}://${host}/c/${slug}/`;
}
router.get("/api/c/:slug/qr.svg", async (req, res) => {
  const co = await company(req.params.slug);
  if (!co) return res.status(404).json({ error: "unknown company" });
  const px = Math.min(1200, Math.max(80, Number(req.query.px) || 240));
  try {
    res.type("image/svg+xml").set("Cache-Control", "no-cache").send(qrcode.svg(boardUrl(req, co.slug), { size: px }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- batches -----------------------------------------------------------------
// A batch is a persistent group of feedback items for one module, open until
// it is built. Items join or leave at any station (new or reviewing); the
// column headers on the board carry the batch actions. One open batch per
// module at a time.
async function openBatch(company, mod, create) {
  let b = (await q("SELECT * FROM platform.batches WHERE company=$1 AND module=$2 AND run_id IS NULL ORDER BY id DESC LIMIT 1", [company, mod])).rows[0];
  if (!b && create) b = (await q("INSERT INTO platform.batches (company, module) VALUES ($1,$2) RETURNING *", [company, mod])).rows[0];
  return b;
}
router.post("/api/c/:slug/batch/add", requireManager, async (req, res) => {
  const ids = ((req.body || {}).feedback_ids || []).map(Number).filter(Boolean);
  if (!ids.length) return res.status(400).json({ error: "no feedback ids" });
  const rows = (await q("SELECT id, module, status FROM platform.feedback WHERE company=$1 AND id = ANY($2::int[]) AND status IN ('new','reviewing') AND module <> 'platform' AND kind = 'feedback'", [req.params.slug, ids])).rows;
  for (const f of rows) {
    const b = await openBatch(req.params.slug, f.module, true);
    await q("UPDATE platform.feedback SET batch_id=$2, updated_at=now() WHERE id=$1", [f.id, b.id]);
  }
  res.json({ ok: true, added: rows.length });
});
router.post("/api/c/:slug/batch/remove", requireManager, async (req, res) => {
  const ids = ((req.body || {}).feedback_ids || []).map(Number).filter(Boolean);
  await q("UPDATE platform.feedback SET batch_id=NULL, updated_at=now() WHERE company=$1 AND id = ANY($2::int[])", [req.params.slug, ids]);
  res.json({ ok: true });
});
router.post("/api/c/:slug/batch/:id/clear", requireManager, async (req, res) => {
  await q("UPDATE platform.feedback SET batch_id=NULL, updated_at=now() WHERE company=$1 AND batch_id=$2", [req.params.slug, req.params.id]);
  res.json({ ok: true });
});
// Build the batch: every item that has a proposal goes into one run; items not
// reviewed yet leave the batch (the board says how many) so the run is exactly
// what the manager looked at.
router.post("/api/c/:slug/batch/:id/build", requireManager, freshPin, async (req, res) => {
  const b = (await q("SELECT * FROM platform.batches WHERE id=$1 AND company=$2 AND run_id IS NULL", [req.params.id, req.params.slug])).rows[0];
  if (!b) return res.status(404).json({ error: "no such open batch" });
  const items = (await q(
    `SELECT f.id, p.id AS proposal_id FROM platform.feedback f
       LEFT JOIN LATERAL (SELECT id FROM platform.proposals WHERE feedback_id=f.id ORDER BY id DESC LIMIT 1) p ON true
      WHERE f.batch_id=$1 AND f.status='reviewing'`, [b.id])).rows;
  const ids = items.map((i) => i.proposal_id).filter(Boolean);
  if (!ids.length) return res.status(400).json({ error: "nothing in this batch has a proposal yet; review the items first" });
  try {
    if (await waitingOnData(ids)) return res.status(409).json({ error: "One of these changes is waiting on data from your ERP connection. Take it out of the batch, or build the batch once it is back." });
    await q("UPDATE platform.proposals SET status='approved' WHERE id = ANY($1::int[]) AND status='draft'", [ids]);
    const run = await pipeline.startRun(ids, { model: (req.body || {}).model });
    for (const it of items) await record("proposal_approved", { company: req.params.slug, module: b.module, actor: actor(req), feedback_id: it.id, proposal_id: it.proposal_id, run_id: run.id, detail: { batch: b.id, model: (req.body || {}).model || null } });
    await q("UPDATE platform.batches SET run_id=$2 WHERE id=$1", [b.id, run.id]);
    await q("UPDATE platform.feedback SET batch_id=NULL, updated_at=now() WHERE batch_id=$1 AND status <> 'in_progress'", [b.id]);
    res.json({ ok: true, run, built: ids.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// What the staged preview changed against the floor version: the files that
// differ (mapped to screens) and the plain summary from the run. Zero extra
// tokens: it is a text compare of the two versions already in the database.
router.get("/api/c/:slug/modules/:name/staged-changes", async (req, res) => {
  const row = await registry.getModule(req.params.slug, req.params.name);
  if (!row || !row.staged_version) return res.status(404).json({ error: "nothing staged" });
  const [from, to] = await Promise.all([registry.versionFiles(row.company, row.name, row.live_version), registry.versionFiles(row.company, row.name, row.staged_version)]);
  const run = (await q("SELECT id, evidence, from_version FROM platform.build_runs WHERE company=$1 AND module=$2 AND to_version=$3 ORDER BY id DESC LIMIT 1", [row.company, row.name, row.staged_version])).rows[0];
  let manifest = {};
  try { manifest = registry.readManifest(row.company, row.name, row.staged_version); } catch (e) { /* none */ }
  const screens = registry.pageEntries(manifest);
  const changed = [];
  for (const f of new Set([...Object.keys(from || {}), ...Object.keys(to || {})])) {
    if ((from || {})[f] === (to || {})[f]) continue;
    const scr = screens.filter((s) => s.file === f).map((s) => ({ label: s.label, route: s.route }));
    changed.push({ file: f, screens: scr.length ? scr : [{ label: f === "routes.js" ? "Server logic" : f, route: null }], added: !(from || {})[f], removed: !(to || {})[f] });
  }
  const ev = run ? run.evidence || {} : {};
  res.set("Cache-Control", "no-store").json({
    live_version: row.live_version, staged_version: row.staged_version, run_id: run ? run.id : null,
    title: ev.title || null, what_changed: ev.what_changed || null, build_summary: ev.build_summary || null, changed,
  });
});

// Company icon for the tab and the phone home screen: the brand icon when the
// guide found one, else the platform's own mark.
const DEFAULT_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" rx="180" fill="#14171c"/><path fill="#4c90d1" d="M468 146h87l387 733H775L512 383 248 879H81z"/><path fill="#4c90d1" d="M439 616h145l68 127H371z"/></svg>`;   // the Anetix mark (2026-09-25; public/assets/anetix-mark.svg is the same file)
// A short fingerprint of the icon the company has now: the board puts it in the icon's address (?v=) so a browser
// that keys its icon cache by URL never shows one company's mark on another's board (Safari did, 2026-09-24).
const iconVersion = (b) => require("crypto").createHash("sha1").update(b && b.icon ? String(b.icon) : `anetix:${b && b.colors && b.colors.primary ? b.colors.primary : "#14171c"}`).digest("hex").slice(0, 10);
router.get("/api/c/:slug/icon", async (req, res) => {
  const co = await company(req.params.slug);
  const b = co && co.brand;
  const etag = `"${iconVersion(b)}"`;
  res.set("Cache-Control", "no-cache").set("ETag", etag);
  if (req.headers["if-none-match"] === etag) return res.status(304).end();
  if (b && b.icon && /^data:image\/[\w.+-]+;base64,/.test(b.icon)) {
    const [head, data] = b.icon.split(",", 2);
    return res.type(head.slice(5, head.indexOf(";"))).send(Buffer.from(data, "base64"));
  }
  const primary = b && b.colors && b.colors.primary ? b.colors.primary : "#14171c";
  res.type("image/svg+xml").send(DEFAULT_ICON.replace("#14171c", primary));
});

function brandPublic(b) {
  if (!b) return null;
  const { icon, ...rest } = b;
  return { ...rest, has_icon: Boolean(icon), icon_v: iconVersion(b) };
}

// ---- board data ------------------------------------------------------------
router.get("/api/c/:slug/board", async (req, res) => {
  const co = await company(req.params.slug);
  if (!co) return res.status(404).json({ error: "unknown company" });
  const all = (await q(
    `SELECT f.*, p.id AS proposal_id, p.body AS proposal_body, p.class AS proposal_class,
            p.target_file AS proposal_target, p.rationale AS proposal_rationale, p.status AS proposal_status, p.model AS proposal_model,
            CASE WHEN p.data_check IS NULL THEN NULL ELSE jsonb_build_object('status', p.data_check->'status', 'reason', p.data_check->'reason', 'missing', (SELECT COALESCE(jsonb_agg(m->'what'), '[]'::jsonb) FROM jsonb_array_elements(COALESCE(p.data_check->'missing','[]'::jsonb)) m)) END AS proposal_data,
            (SELECT o.message FROM platform.feedback o WHERE o.id=f.follow_up_of) AS follow_up_words,
            (SELECT o.manager_answer FROM platform.feedback o WHERE o.id=f.follow_up_of) AS follow_up_origin,
            (SELECT c.id FROM platform.feedback c WHERE c.follow_up_of=f.id ORDER BY c.id DESC LIMIT 1) AS follow_up_id,
            (SELECT a.id FROM platform.attachments a WHERE a.feedback_id=f.id ORDER BY a.id LIMIT 1) AS photo_id
       FROM platform.feedback f
       LEFT JOIN LATERAL (SELECT * FROM platform.proposals WHERE feedback_id=f.id ORDER BY id DESC LIMIT 1) p ON true
      WHERE f.company=$1
      ORDER BY f.recurrence DESC, f.id DESC`, [co.slug])).rows;
  // propose on arrival (src/arrival.js): a request the proposer folded into another rides on that one's card
  // ("asked 4 times by 3 people"), never as a card of its own; the token that lets a device answer its own
  // question never goes to a page
  const folded = new Map();
  for (const f of all) { delete f.reply_token; if (f.duplicate_of) { if (!folded.has(f.duplicate_of)) folded.set(f.duplicate_of, []); folded.get(f.duplicate_of).push(f); } }
  const feedback = all.filter((f) => !f.duplicate_of || !all.some((o) => o.id === f.duplicate_of));
  for (const f of feedback) {
    const dupes = (folded.get(f.id) || []).sort((a, b) => a.id - b.id);
    if (!dupes.length) continue;
    f.dupes = dupes.map((d) => ({ id: d.id, message: d.message, name: d.name, screen: d.screen, created_at: d.created_at, floor_answer: d.floor_answer || null, note: d.triage_note || null, photo_id: d.photo_id || null, pointed: d.element ? arrival.clip(d.element.text || d.element.label || d.element.id || d.element.tag, 80) : null }));
    f.asked = arrival.tally(f, dupes);
  }
  const runs = (await q(
    `SELECT r.*, p.feedback_id,
            (SELECT array_agg(feedback_id ORDER BY id) FROM platform.proposals
              WHERE id = ANY(COALESCE(r.proposal_ids, ARRAY[r.proposal_id]))) AS feedback_ids
       FROM platform.build_runs r
       JOIN platform.proposals p ON p.id = r.proposal_id
      WHERE r.company=$1
      ORDER BY r.id DESC`, [co.slug])).rows;
  const modules = (await q("SELECT * FROM platform.modules WHERE company=$1 ORDER BY name", [co.slug])).rows;
  // screens per module, so the adjust form can offer target files
  const screens = {};
  for (const m of modules) {
    try { screens[m.name] = registry.pageEntries(registry.readManifest(co.slug, m.name, m.live_version)).concat([{ route: null, file: "routes.js", label: "Server logic (routes.js)" }]); }
    catch (e) { screens[m.name] = []; }
  }
  const reviews = await review.listReviews(co.slug);
  const batches = (await q("SELECT * FROM platform.batches WHERE company=$1 AND run_id IS NULL ORDER BY id", [co.slug])).rows;
  const { brand: b, ...coPublic } = co;
  const intakes = req.sosRole === "floor" ? {} : await intake.boardIntakes(co.slug);
  res.json({
    company: coPublic, brand: brandPublic(b), icon_v: iconVersion(b), feedback, runs, modules, screens, reviews, batches, intakes,
    test_floor: Boolean(co.test_floor),   // the strip shows a "Test floor" link per tool only while the company's switch is on
    campaigns: co.test_floor || runs.some((r) => r.step === "campaign" || (r.evidence && r.evidence.campaign_id)) ? await campaign.forBoard(co.slug) : {},
    boardUrl: boardUrl(req, co.slug),
    spend: await agent.monthlySpend(co.slug),
    // null unless the company came in from anetix.ai; then its balance and the top-up page. A subscribed site has no credit (stage 3)
    credit: (await selfserve.siteStage(co.slug)) === "subscribed" ? null : await selfserve.credit(co.slug),
    golive: await require("./golive").forBoard(co, req.sosRole).catch((e) => { console.error("[golive] board", e.message); return null; }),   // a demo's Go live link, managers only (src/golive.js)
    // stage 3 (src/activate.js): notices for the managers, the Terms' box while it waits, a new site's welcome (the floor's
    // password, once), the fair-use line when it is reached
    ...(await require("./activate").forBoard(co, req.sosRole).catch((e) => { console.error("[activate] board", e.message); return {}; })),
    models: { list: agent.MODELS, build: (await agent.buildModelFor(co.slug, await agent.modelFor(co.slug, "build"))).model },
    role: req.sosRole,
    boot: process.env.SOS_BOOT_ID,
    aiConfigured: agent.haveKey(),
    fakeAgent: agent.fakeMode(),
    maxRunUsd: agent.MAX_RUN_USD,
    maxBatchUsd: agent.MAX_BATCH_USD,
    maxFixRounds: pipeline.MAX_FIX_ROUNDS,
  });
});

// ---- lifecycle actions (manager only) --------------------------------------
// "Review with AI" / "Propose anyway". On a request the proposer has already read (it asked a question, or
// flagged it) the manager is asking for a proposal, so the call drafts one: no sorting, no question.
router.post("/api/feedback/:id/review", requireManager, async (req, res) => {
  try {
    const fb = (await q("SELECT id, question, triage, arrival FROM platform.feedback WHERE id=$1", [Number(req.params.id) || 0])).rows[0];
    if (fb && fb.arrival === "proposing") return res.status(409).json({ error: "the proposal for this one is being drafted right now; give it a moment" });
    res.json(await generateProposal(Number(req.params.id), { force: Boolean(fb && (fb.question || fb.triage || fb.arrival === "done")) }));
  } catch (e) {
    // the AI service itself refusing (no credit, a bad key, too busy) is said in plain words and marked for the admin page
    const credit = require("./credit"), kind = credit.classify(e.message);
    await credit.noteFailure(e.message, `the proposal for request #${req.params.id}`);
    res.status(500).json({ error: kind ? credit.plain(kind) : e.message });
  }
});

// The manager answers the proposer's one question for the person who asked (whoever answers first wins).
router.post("/api/feedback/:id/answer", requireManager, async (req, res) => {
  try {
    const fb = (await q("SELECT company FROM platform.feedback WHERE id=$1", [Number(req.params.id) || 0])).rows[0];
    if (!fb) return res.status(404).json({ error: "no such request" });
    const who = actor(req);
    res.json(await arrival.answerQuestion({ company: fb.company, feedbackId: req.params.id, answer: (req.body || {}).answer, who: { role: who.role, name: who.name || null, person: who.person || null }, via: "manager" }));
  } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});
// "Not the same": a request the proposer folded into another one stands on its own again.
router.post("/api/feedback/:id/unlink", requireManager, async (req, res) => {
  try {
    const fb = (await q("SELECT company FROM platform.feedback WHERE id=$1", [Number(req.params.id) || 0])).rows[0];
    if (!fb) return res.status(404).json({ error: "no such request" });
    const out = await arrival.unlink({ feedbackId: req.params.id, company: fb.company, actor: actor(req) });
    await arrival.start(out.id, { alone: true });   // proposed on its own this time: nothing to repeat
    res.json(out);
  } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});

// The data check (src/datacheck.js): is any of these proposals waiting on ERP data, or in need of data the ERP cannot give?
async function waitingOnData(proposalIds) {
  return (await q("SELECT 1 FROM platform.proposals WHERE id = ANY($1::int[]) AND data_check->>'status' IN ('waiting','unavailable') LIMIT 1", [proposalIds])).rows.length > 0;
}

// Manager decision on a proposal (approve/decline, with optional edits)
router.post("/api/proposals/:id/decide", requireManager, freshPin, async (req, res) => {
  const { decision, note, editedBody, editedClass, editedTarget, model } = req.body || {};
  try {
    // the proposal as it stands, before anything the manager typed lands on it
    const was = (await q("SELECT p.*, f.company, f.module FROM platform.proposals p JOIN platform.feedback f ON f.id=p.feedback_id WHERE p.id=$1", [req.params.id])).rows[0];
    if (!was) return res.status(404).json({ error: "not found" });
    const ids = { company: was.company, module: was.module, feedback_id: was.feedback_id, proposal_id: was.id };
    if (editedBody || editedClass || editedTarget) {
      await q("UPDATE platform.proposals SET body=COALESCE($2,body), class=COALESCE($3,class), target_file=COALESCE($4,target_file) WHERE id=$1",
        [req.params.id, editedBody || null, editedClass || null, editedTarget || null]);
      const changed = (editedBody && editedBody !== was.body) || (editedClass && editedClass !== was.class) || (editedTarget && editedTarget !== was.target_file);
      if (changed) await record("proposal_edited", { ...ids, actor: actor(req), before: was.body, after: editedBody || was.body, detail: { class_before: was.class, class_after: editedClass || was.class, target_before: was.target_file, target_after: editedTarget || was.target_file, model_before: was.model } });
    }
    if (decision === "approve") {
      // the data check: a change that waits on ERP data is not built yet; one the ERP cannot feed is built only after the manager changed the ask
      const ds = was.data_check && was.data_check.status;
      if (ds === "waiting") return res.status(409).json({ error: "This change is waiting on data from your ERP connection. Anetix has been told; it comes back here when the data is there." });
      if (ds === "unavailable" && !(editedBody && editedBody !== was.body)) return res.status(409).json({ error: "This change needs data your ERP connection cannot provide. Adjust it so it does not need that data, or decline it." });
      await q("UPDATE platform.proposals SET status='approved', manager_note=$2 WHERE id=$1", [req.params.id, note || null]);
      const run = await pipeline.startRun(Number(req.params.id), { model });
      await record("proposal_approved", { ...ids, actor: actor(req), run_id: run.id, after: note || null, detail: { model: model || null, edited: Boolean(editedBody || editedClass || editedTarget) } });
      return res.json({ ok: true, run });
    }
    if (decision === "decline") {
      const p = (await q("UPDATE platform.proposals SET status='declined', manager_note=$2 WHERE id=$1 RETURNING *", [req.params.id, note || null])).rows[0];
      await q("UPDATE platform.feedback SET status='declined', outcome=$2, updated_at=now() WHERE id=$1", [p.feedback_id, note || "declined"]);
      await record("proposal_declined", { ...ids, actor: actor(req), after: note || null });
      return res.json({ ok: true });
    }
    if (decision === "save") return res.json({ ok: true });
    res.status(400).json({ error: "decision must be approve, decline, or save" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Batch: approve several reviewed proposals and build them in one run
router.post("/api/runs/batch", requireManager, freshPin, async (req, res) => {
  const ids = ((req.body || {}).proposal_ids || []).map(Number).filter(Boolean);
  if (!ids.length) return res.status(400).json({ error: "pick at least one proposal" });
  try {
    // this route names its proposals in the body, so the company guard cannot see them
    const owners = (await q("SELECT DISTINCT f.company FROM platform.proposals p JOIN platform.feedback f ON f.id=p.feedback_id WHERE p.id = ANY($1::int[])", [ids])).rows.map((r) => r.company);
    if (owners.some((c) => !auth.ownsCompany(req, c))) return res.status(403).json({ error: "this login is for another company" });
    if (await waitingOnData(ids)) return res.status(409).json({ error: "One of these changes is waiting on data from your ERP connection. Build the others, or wait until it is back." });
    await q("UPDATE platform.proposals SET status='approved' WHERE id = ANY($1::int[]) AND status='draft'", [ids]);
    const run = await pipeline.startRun(ids, { model: (req.body || {}).model });
    for (const p of (await q("SELECT p.id, p.feedback_id, f.company, f.module FROM platform.proposals p JOIN platform.feedback f ON f.id=p.feedback_id WHERE p.id = ANY($1::int[])", [ids])).rows)
      await record("proposal_approved", { company: p.company, module: p.module, actor: actor(req), feedback_id: p.feedback_id, proposal_id: p.id, run_id: run.id, detail: { batch: true, model: (req.body || {}).model || null } });
    res.json({ ok: true, run });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// A manager's decision on a run, with who made it, on the record.
async function runIds(id) { const r = await pipeline.getRun(Number(id)); return r ? { run: r, ids: { company: r.company, module: r.module, run_id: r.id, feedback_id: null, proposal_id: r.proposal_id, version: r.to_version || null } } : null; }
router.post("/api/runs/:id/cancel", requireManager, async (req, res) => {
  try { const x = await runIds(req.params.id); await pipeline.cancel(Number(req.params.id)); if (x) await record("run_cancelled", { ...x.ids, actor: actor(req), detail: { step: x.run.step, status_before: x.run.status } }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
router.post("/api/runs/:id/confirm", requireManager, freshPin, async (req, res) => {
  try {
    const x = await runIds(req.params.id); const edited = (req.body || {}).requirement;
    await pipeline.confirmRequirement(Number(req.params.id), edited);
    if (x) await record("requirement_confirmed", { ...x.ids, actor: actor(req), before: x.run.requirement, after: edited || x.run.requirement, detail: { edited: Boolean(edited && edited !== x.run.requirement) } });
    res.json({ ok: true });
  }
  catch (e) { res.status(500).json({ error: e.message }); }
});
router.post("/api/runs/:id/deploy", requireManager, freshPin, async (req, res) => {
  try {
    const x = await runIds(req.params.id);
    const gate = x ? adminChange(req, x.run.company) : { ok: true };
    if (!gate.ok) return res.status(400).json({ error: gate.error, code: gate.code });
    const out = await pipeline.deploy(Number(req.params.id));
    if (x) await record("deployed", { ...x.ids, actor: actor(req), version: out.to, detail: { from: out.from, to: out.to, lane: x.run.lane } });
    if (x) await tellManager(x.run.company, `put a change live on ${x.run.module} (v${out.to})`, gate);
    res.json(out);
  }
  catch (e) { res.status(500).json({ error: e.message }); }
});
router.post("/api/runs/:id/fix", requireManager, async (req, res) => {
  try { const x = await runIds(req.params.id); await pipeline.fix(Number(req.params.id)); if (x) await record("run_fixed", { ...x.ids, actor: actor(req), before: ((x.run.evidence || {}).cross_check || {}).summary || null, detail: { round: ((x.run.evidence || {}).fix_round || 0) + 1 } }); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.post("/api/runs/:id/override", requireManager, freshPin, async (req, res) => {
  try { const x = await runIds(req.params.id); await pipeline.override(Number(req.params.id)); if (x) await record("run_overridden", { ...x.ids, actor: actor(req), before: ((x.run.evidence || {}).cross_check || {}).summary || null }); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
// An earlier promise no longer holds (src/acceptance.js, build order item 7): the manager retires the check this
// build broke, with a reason, and the same build is checked again. On the record with who and why.
router.post("/api/runs/:id/retire-check", requireManager, freshPin, async (req, res) => {
  try { res.json({ ok: true, ...(await pipeline.retirePromise(Number(req.params.id), String((req.body || {}).file || ""), (req.body || {}).reason, actor(req))) }); }
  catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});
router.post("/api/runs/:id/rollback", requireManager, freshPin, async (req, res) => {
  try {
    const x = await runIds(req.params.id);
    const gate = x ? adminChange(req, x.run.company) : { ok: true };
    if (!gate.ok) return res.status(400).json({ error: gate.error, code: gate.code });
    const out = await pipeline.rollbackRun(Number(req.params.id));
    if (x) await record("rolled_back", { ...x.ids, actor: actor(req), version: out.to, detail: { to: out.to } });
    if (x) await tellManager(x.run.company, `rolled ${x.run.module} back to v${out.to}`, gate);
    res.json(out);
  }
  catch (e) { res.status(500).json({ error: e.message }); }
});
router.post("/api/runs/:id/retry", requireManager, async (req, res) => {
  try { const x = await runIds(req.params.id); await pipeline.retry(Number(req.params.id)); if (x) await record("run_retried", { ...x.ids, actor: actor(req), detail: { step: x.run.step } }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
router.get("/api/runs/:id", async (req, res) => {
  res.json(await pipeline.getRun(Number(req.params.id)));
});

// ---- system review: re-baseline a whole module (manager) --------------------
router.get("/api/c/:slug/reviews/estimate", requireManager, async (req, res) => {
  try { res.json(await review.estimate(req.params.slug, String(req.query.module), agent.inTier(req.query.model) ? req.query.model : await agent.modelFor(req.params.slug, "design"))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
router.post("/api/c/:slug/reviews", requireManager, async (req, res) => {
  await record("review_started", { company: req.params.slug, module: (req.body || {}).module || null, actor: actor(req), detail: { model: (req.body || {}).model || null } });
  const { module: mod, model, requested_by } = req.body || {};
  try { res.json(await review.startReview(req.params.slug, mod, agent.inTier(model) ? model : await agent.modelFor(req.params.slug, "design"), requested_by)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
router.get("/api/c/:slug/reviews", requireManager, async (req, res) => {
  res.json(await review.listReviews(req.params.slug));
});

// ---- diagrams: data flows and workflows per deployed version ---------------
router.get("/api/c/:slug/diagrams/:module", async (req, res) => {
  const row = await registry.getModule(req.params.slug, req.params.module);
  if (!row) return res.status(404).json({ error: "unknown module" });
  const v = req.query.version ? Number(req.query.version) : null;
  const d = await diagrams.latest(req.params.slug, req.params.module, v);
  res.json({ module: row, ...d, conventions: diagrams.conventions(), role: req.sosRole });
});
router.post("/api/c/:slug/diagrams/:module/regenerate", requireManager, async (req, res) => {
  try {
    const row = await registry.getModule(req.params.slug, req.params.module);
    const out = await diagrams.generate(req.params.slug, req.params.module, row.live_version, { force: true, model: (req.body || {}).model });
    res.json({ ok: true, ...out });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- agent settings: models per role + guidance docs (manager) --------------
router.get("/api/c/:slug/agents", requireManager, async (req, res) => {
  const co = await company(req.params.slug);
  if (!co) return res.status(404).json({ error: "unknown company" });
  // docs the platform writes itself (ERP-FIELDS.md) are for the agents; only an admin sees them here
  const docs = (await q("SELECT id, module, name, content, source, updated_at FROM platform.agent_docs WHERE company=$1 AND ($2 OR source <> 'platform') ORDER BY module NULLS FIRST, name", [co.slug, req.sosRole === "admin"])).rows;
  const modules = (await q("SELECT name, title FROM platform.modules WHERE company=$1 ORDER BY name", [co.slug])).rows;
  const { brand: b, ...coPublic } = co;
  res.json({
    company: coPublic, brand: brandPublic(b),
    models: {
      list: agent.MODELS,
      defaults: await agent.defaultModels(),   // what each job runs on when the company leaves it to the instance
      pins: await agent.companyPins(co.slug),   // the company's own choices; null = follows the instance
      propose: await agent.modelFor(co.slug, "propose"),
      build: await agent.modelFor(co.slug, "build"),
      review: await agent.modelFor(co.slug, "review"),
      ab: (await agent.instanceModels()).ab.on,
    },
    platformDocs: agent.platformDocs(),
    docs, modules,
    role: req.sosRole,
  });
});

router.post("/api/c/:slug/agents/models", requireManager, async (req, res) => {
  const b = req.body || {};
  const ok = (id) => (id === "" || id == null) ? null : (agent.MODELS.some((m) => m.id === id) ? id : undefined);
  const vals = { propose: ok(b.propose), build: ok(b.build), review: ok(b.review) };
  if (Object.values(vals).includes(undefined)) return res.status(400).json({ error: "unknown model id" });
  const wasModels = (await q("SELECT model_propose, model_build, model_review FROM platform.companies WHERE slug=$1", [req.params.slug])).rows[0] || {};
  await q("UPDATE platform.companies SET model_propose=$2, model_build=$3, model_review=$4 WHERE slug=$1",
    [req.params.slug, vals.propose, vals.build, vals.review]);
  await logEvent("models_changed", req.params.slug, vals);
  await record("models_changed", { company: req.params.slug, actor: actor(req), before: JSON.stringify(wasModels), after: JSON.stringify(vals) });
  res.json({ ok: true });
});

// What happens the moment a request arrives (src/arrival.js): the proposer reads it at once, and the floor may send a photo.
router.post("/api/c/:slug/agents/arrival", requireManager, async (req, res) => {
  const b = req.body || {};
  const was = await arrival.settings(req.params.slug);
  const now = { auto_propose: b.auto_propose === undefined ? was.auto_propose : Boolean(b.auto_propose), allow_photos: b.allow_photos === undefined ? was.allow_photos : Boolean(b.allow_photos) };
  await q("UPDATE platform.companies SET auto_propose=$2, allow_photos=$3 WHERE slug=$1", [req.params.slug, now.auto_propose, now.allow_photos]);
  await record("arrival_settings", { company: req.params.slug, actor: actor(req), before: JSON.stringify(was), after: JSON.stringify(now) });
  res.json({ ok: true, ...now });
});

router.post("/api/c/:slug/agents/docs", requireManager, async (req, res) => {
  const { module: mod, name, content } = req.body || {};
  if (!name || !/^[A-Za-z0-9_.-]{1,60}$/.test(name)) return res.status(400).json({ error: "name must be a simple filename like NOTES.md" });
  const wasDoc = (await q("SELECT content FROM platform.agent_docs WHERE company=$1 AND module IS NOT DISTINCT FROM $2 AND name=$3 ORDER BY id DESC LIMIT 1", [req.params.slug, mod || null, name])).rows[0];
  const row = await upsertDoc(req.params.slug, mod || null, name, String(content || ""), "user", false);
  await logEvent("agent_doc_saved", req.params.slug, { module: mod || null, name });
  if (!wasDoc || wasDoc.content !== String(content || "")) await record("doc_saved", { company: req.params.slug, module: mod || null, actor: actor(req), before: wasDoc ? wasDoc.content : null, after: String(content || ""), detail: { name } });
  res.json(row);
});

router.delete("/api/c/:slug/agents/docs/:id", requireManager, async (req, res) => {
  const gone = (await q("DELETE FROM platform.agent_docs WHERE company=$1 AND id=$2 RETURNING module, name, content", [req.params.slug, req.params.id])).rows[0];
  if (gone) await record("doc_deleted", { company: req.params.slug, module: gone.module, actor: actor(req), before: gone.content, detail: { name: gone.name } });
  res.json({ ok: true });
});

// ---- the interaction record: the plant's own, readable and exportable by its manager
router.get("/api/c/:slug/record", requireManager, async (req, res) => {
  const { kind, feedback_id, run_id, limit, before_id } = req.query;
  res.set("Cache-Control", "no-store").json({ company: req.params.slug, rows: await require("./record").list(req.params.slug, { kind, feedback_id, run_id, limit, before_id }) });
});
router.get("/api/c/:slug/record/export", requireManager, async (req, res) => {
  const rows = await require("./record").list(req.params.slug, { limit: 5000, before_id: req.query.before_id });
  res.set("Content-Disposition", `attachment; filename="record-${req.params.slug}-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json({ format: "sos-record-1", company: req.params.slug, taken_at: new Date().toISOString(), count: rows.length, rows });
});

// ---- admin: companies across the instance ------------------------------------
// The module library as the admin page shows it: every separate module once, then the instances of it.
// Two kinds of entry. "repo": a module that ships in modules/<name>/ and is added to companies from there; its
// instances are the companies that have it. "company": a module a company made through module creation
// (src/modulebuild.js); it lives in that company's versions only, so it is an entry of its own with one instance,
// and what it is (description, screens, tour, smoke checks) is read from the version on the floor, else the staged
// one, else the first. Two companies that each made a module with the same slug are two entries, never merged.
async function libraryView(modules) {
  const stats = (await q(`SELECT company, module, count(*)::int AS versions, count(*) FILTER (WHERE source='build')::int AS built, max(created_at) AS last_change
    FROM platform.module_versions GROUP BY company, module`)).rows;
  const instance = (x) => {
    const st = stats.find((v) => v.company === x.company && v.module === x.name) || {};
    return { company: x.company, live_version: x.live_version, staged_version: x.staged_version, versions: st.versions || 0, built: st.built || 0, last_change: st.last_change || x.created_at || null };
  };
  const lib = registry.libraryModules();
  const out = lib.map((m) => {
    const instances = modules.filter((x) => x.name === m.name).map(instance);
    return {
      key: m.name, origin: "repo", made_at: null,
      name: m.name, title: m.title, description: m.description || "", screens: m.screens, migrations: m.migrations,
      tourSteps: m.tour && m.tour.steps ? m.tour.steps.length : 0, tourTitle: m.tour ? m.tour.title : null,
      smoke: (m.smoke || []).length,
      instances, deployed: instances.filter((i) => i.live_version).map((i) => ({ company: i.company, live_version: i.live_version })),
    };
  });
  const own = modules.filter((x) => !lib.some((m) => m.name === x.name));
  if (own.length) {
    const facts = (await q(`SELECT m.company, m.name, v.files->>'module.json' AS manifest, v.files->>'tour.json' AS tour,
        (SELECT count(*)::int FROM jsonb_object_keys(COALESCE(v.files, '{}'::jsonb)) k WHERE k LIKE 'migrations/%.sql') AS migrations
      FROM platform.modules m LEFT JOIN platform.module_versions v
        ON v.company = m.company AND v.module = m.name AND v.version = COALESCE(m.live_version, m.staged_version, 1)
      WHERE m.name <> ALL($1::text[])`, [lib.map((m) => m.name)])).rows;
    const parse = (t) => { try { return t ? JSON.parse(t) : null; } catch (e) { return null; } };
    const screensOf = (mf) => { try { return registry.pageEntries(mf); } catch (e) { return []; } };   // an agent-written manifest, so never trusted to be well formed
    for (const x of own) {
      const f = facts.find((r) => r.company === x.company && r.name === x.name) || {};
      const manifest = parse(f.manifest) || {}, tour = parse(f.tour), inst = instance(x);
      out.push({
        key: `${x.company}/${x.name}`, origin: "company", made_at: x.company,
        name: x.name, title: manifest.title || x.title, description: manifest.description || "", screens: screensOf(manifest), migrations: f.migrations || 0,
        tourSteps: tour && tour.steps ? tour.steps.length : 0, tourTitle: tour ? tour.title : null,
        smoke: (manifest.smoke || []).length,
        instances: [inst], deployed: inst.live_version ? [{ company: inst.company, live_version: inst.live_version }] : [],
      });
    }
  }
  return out;
}

router.get("/api/admin/overview", requireAdmin, async (_req, res) => {
  const companies = (await q("SELECT * FROM platform.companies ORDER BY created_at")).rows;
  const modules = (await q("SELECT company, name, title, live_version, staged_version, created_at FROM platform.modules ORDER BY company, name")).rows;
  const settings = await agent.instanceModels(), defs = await agent.defaultModels(settings);
  const eff = (c, job) => (agent.inTier(c[`model_${job}`]) ? c[`model_${job}`] : defs[job]);
  const docs = (await q("SELECT company, module, name, source, updated_at, length(content) AS bytes FROM platform.agent_docs ORDER BY company, module NULLS FIRST, name")).rows;
  const counts = (await q(`SELECT company, count(*) FILTER (WHERE status='new')::int AS open, count(*)::int AS total FROM platform.feedback GROUP BY company`)).rows;
  const spend = (await q(`
    SELECT c.slug,
      COALESCE((SELECT SUM(cost_usd) FROM platform.build_runs r WHERE r.company=c.slug AND r.created_at >= date_trunc('month', now())),0)
    + COALESCE((SELECT SUM(p.cost_usd) FROM platform.proposals p JOIN platform.feedback f ON f.id=p.feedback_id WHERE f.company=c.slug AND p.created_at >= date_trunc('month', now())),0) AS usd
    FROM platform.companies c`)).rows;
  const runs = (await q("SELECT company, count(*)::int AS n, count(*) FILTER (WHERE status='deployed')::int AS deployed FROM platform.build_runs GROUP BY company")).rows;
  const access = (await q("SELECT * FROM platform.company_access")).rows;
  const selfServe = {};   // the balance of every company that came in from anetix.ai (src/selfserve.js)
  for (const c of (await selfserve.adminView()).companies) selfServe[c.slug] = c;
  const managersBy = {};
  for (const c of companies) { const ms = await selfserve.managers(c.slug); if (ms.length) managersBy[c.slug] = ms; }
  res.json({
    companies: companies.map((c) => ({
      ...c,
      models: { propose: eff(c, "propose"), build: eff(c, "build"), review: eff(c, "review"), pinned: agent.COMPANY_JOBS.filter((j) => agent.inTier(c[`model_${j}`])) },
      modules: modules.filter((m) => m.company === c.slug),
      docs: docs.filter((d) => d.company === c.slug),
      feedback: counts.find((x) => x.company === c.slug) || { open: 0, total: 0 },
      runs: runs.find((x) => x.company === c.slug) || { n: 0, deployed: 0 },
      spend_usd: Number((spend.find((x) => x.slug === c.slug) || {}).usd || 0),
      monthly_cap_usd: c.monthly_cap_usd == null ? null : Number(c.monthly_cap_usd),
      access: auth.accessPublic(access.find((a) => a.company === c.slug)),
      brand: brandPublic(c.brand),
      test_floor: Boolean(c.test_floor),
      ...datawall.status(c),
      credit: selfServe[c.slug] || null,
      managers: managersBy[c.slug] || [],   // manager accounts (email, authenticator app): self-serve companies (src/selfserve.js)
    })),
    testFloors: Object.fromEntries(await Promise.all(companies.filter((c) => c.test_floor).map(async (c) => [c.slug, await testfloor.status(c.slug)]))),
    library: await libraryView(modules),
    models: agent.MODELS,
    labels: agent.ALL_MODELS,   // every model a row may name, retired ones included, for labels only
    defaults: defs,
    modelSettings: settings,
    monthlyCap: agent.MONTHLY_CAP_USD,
    totalSpend: (await agent.monthlySpend(null)).usd,
    runner: require("./runner").status(),
  });
});

// Loop health: the platform's own numbers, per company and across the fleet
// (src/health.js). ?days=7|30|90|365|0 (0 = all time), default 30.
// The AI credit glide slope (src/credit.js): the balance the admin entered, the platform's own burn, the projected runout.
router.get("/api/admin/credit", requireAdmin, async (_req, res) => {
  try { res.set("Cache-Control", "no-store").json(await require("./credit").status()); } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post("/api/admin/credit", requireAdmin, async (req, res) => {
  try { const b = req.body || {}; res.json(await require("./credit").setBalance({ balance_usd: b.balance_usd, autofill: b.autofill, note: b.note, by: req.sosPerson || "admin" })); }
  catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});
router.get("/api/admin/health", requireAdmin, async (req, res) => {
  try { res.json(await health.forAdmin(req.query.days)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- people: a name and a PIN (src/people.js). Two sets of routes, on purpose.
// /who is the picker on the feedback button: any device of the company lists the
// names, signs one in, signs out. A module page's browser policy opens /who and
// nothing else here (registry.modulePagePolicy), so an agent-written screen in a
// manager's browser can never reach the list-keeping routes below.
// /people is the manager's list: add, new PIN, switch off. ----
const whoAmI = (req) => (req.sosPersonId && req.sosPersonCompany === req.params.slug ? { id: req.sosPersonId, name: req.sosPerson, role: req.sosPersonRole } : null);
router.get("/api/c/:slug/who", async (req, res) => {
  // account: the named account behind this session (an admin, a demo's manager), so the feedback button can say who it sends as when nobody tapped a name
  try { res.set("Cache-Control", "no-store").json({ people: await people.list(req.params.slug), me: whoAmI(req), account: req.sosAccount ? { name: req.sosAccount.name || req.sosAccount.login } : null, photos: (await arrival.settings(req.params.slug)).allow_photos }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
router.get("/api/c/:slug/people", requireManager, async (req, res) => {
  try { res.set("Cache-Control", "no-store").json({ people: await people.list(req.params.slug, { manage: true }), me: whoAmI(req) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
router.post("/api/c/:slug/who/sign-in", async (req, res) => {
  try { const me = await people.signIn(req, res, req.params.slug, (req.body || {}).id, (req.body || {}).pin); await record("person_signed_in", { company: req.params.slug, actor: { role: req.sosRole, name: me.name, person: me.id }, detail: {} }); res.json({ me }); }
  catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});
router.post("/api/c/:slug/who/sign-out", async (req, res) => { people.signOut(req, res); res.json({ ok: true }); });
// ---- close the loop, floor side (src/closeloop.js). Under /who on purpose: the feedback button uses these from
// module pages, and they do no more than the feedback endpoint already lets a page do (read the signed-in
// person's own requests, file a request under their name).
router.get("/api/c/:slug/who/requests", async (req, res) => {
  try { const me = whoAmI(req); res.set("Cache-Control", "no-store").json({ me, ...(await closeloop.myRequests(req.params.slug, me && me.id)) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
router.get("/api/c/:slug/who/news", async (req, res) => {
  try { const me = whoAmI(req); res.set("Cache-Control", "no-store").json(await closeloop.news(req.params.slug, String(req.query.module || ""), me && me.id)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
router.post("/api/c/:slug/who/requests/:id/answer", async (req, res) => {
  try { res.json(await closeloop.answer({ company: req.params.slug, feedbackId: req.params.id, person: whoAmI(req), role: req.sosRole, answer: (req.body || {}).answer, what: (req.body || {}).what })); }
  catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});
// The proposer's one question (src/arrival.js). The feedback button asks here right after sending, and the person
// who asked (or, for a request sent with nobody signed in, the device holding its token) may answer. Nobody else's
// question is ever shown, and an answer files nothing on the floor: it only lets the proposal be drafted.
router.get("/api/c/:slug/who/question", async (req, res) => {
  try {
    const fb = (await q("SELECT id, status, person_id, question, reply_token, duplicate_of, arrival, triage FROM platform.feedback WHERE id=$1 AND company=$2 AND kind='feedback'", [Number(req.query.id) || 0, req.params.slug])).rows[0];
    const me = whoAmI(req), token = String(req.query.token || "");
    const mine = fb && (fb.person_id ? Boolean(me && Number(me.id) === Number(fb.person_id)) : Boolean(token && token === fb.reply_token));
    if (!mine) return res.status(404).json({ error: "no such request" });
    const ask = arrival.mayReply(fb, me, token);
    res.set("Cache-Control", "no-store").json({ id: fb.id, reading: fb.arrival === "proposing", question: ask ? { text: fb.question.text, options: fb.question.options } : null, added_to: fb.duplicate_of || null, proposed: fb.status !== "new" && !fb.duplicate_of });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post("/api/c/:slug/who/requests/:id/reply", async (req, res) => {
  try {
    const fb = (await q("SELECT * FROM platform.feedback WHERE id=$1 AND company=$2 AND kind='feedback'", [Number(req.params.id) || 0, req.params.slug])).rows[0];
    const me = whoAmI(req), token = String((req.body || {}).token || "");
    if (!fb) return res.status(404).json({ error: "no such request" });
    if (!arrival.mayReply(fb, me, token)) return res.status(fb.question && fb.question.answer ? 409 : 403).json({ error: fb.question && fb.question.answer ? "that one is already answered, thank you" : "only the person who asked can answer this one" });
    res.json(await arrival.answerQuestion({ company: req.params.slug, feedbackId: fb.id, answer: (req.body || {}).answer, who: { role: req.sosRole, name: me ? me.name : fb.name || null, person: me ? me.id : null }, via: me ? "asker" : "device" }));
  } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});
router.post("/api/c/:slug/people", requireManager, async (req, res) => {
  try { const out = await people.add(req.params.slug, req.body || {}); await record("person_added", { company: req.params.slug, actor: actor(req), after: out.person.name, detail: { person_id: out.person.id, role: out.person.role } }); res.json(out); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.post("/api/c/:slug/people/:id/pin", requireManager, async (req, res) => {
  try { const out = await people.resetPin(req.params.slug, req.params.id, (req.body || {}).pin); await record("person_pin_reset", { company: req.params.slug, actor: actor(req), after: out.person.name, detail: { person_id: out.person.id } }); res.json(out); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.post("/api/c/:slug/people/:id/active", requireManager, async (req, res) => {
  try { const p = await people.setActive(req.params.slug, req.params.id, (req.body || {}).active); await record(p.active ? "person_switched_on" : "person_switched_off", { company: req.params.slug, actor: actor(req), after: p.name, detail: { person_id: p.id } }); res.json({ person: p }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ---- data requests: ERP data a reviewed change needs and the connection cannot give yet (src/datacheck.js). Admin side only. ----
router.get("/api/admin/data-requests", requireAdmin, async (req, res) => {
  try { res.json({ requests: await datacheck.list({ status: req.query.status || "open" }) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
router.post("/api/admin/data-requests/:id/resolve", requireAdmin, async (req, res) => {
  try { res.json(await datacheck.resolve(Number(req.params.id), (req.body || {}).note, actor(req))); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.post("/api/admin/data-requests/:id/dismiss", requireAdmin, async (req, res) => {
  try { res.json(await datacheck.dismiss(Number(req.params.id), (req.body || {}).note, actor(req))); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ---- connections: the outside world, owned by the platform (src/connections.js) ----
// The company's connections page (manager): every declared connection of
// every live module, its state, and what a person has to set up.
router.get("/api/c/:slug/connections", requireManager, async (req, res) => {
  try { res.json({ company: req.params.slug, role: req.sosRole, modules: await connections.companyView(req.params.slug, { admin: req.sosRole === "admin" }) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
router.post("/api/c/:slug/connections/:mod/:name/settings", requireManager, async (req, res) => {
  try { res.json({ settings: await connections.setSettings(req.params.slug, req.params.mod, req.params.name, req.body || {}, actor(req)) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
// files: upload (parse, match the columns, preview), then load (one transaction)
const sheetJson = express.json({ limit: "24mb" });
router.post("/api/c/:slug/connections/:mod/:name/upload", requireManager, sheetJson, async (req, res) => {
  try { res.json(await connections.previewUpload(req.params.slug, req.params.mod, req.params.name, req.body || {}, req.sosRole)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.post("/api/c/:slug/connections/:mod/:name/load", requireManager, async (req, res) => {
  try { res.json(await connections.loadUpload(req.params.slug, req.params.mod, req.params.name, Number((req.body || {}).upload_id), actor(req))); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
// printer: a test label for this device; erp: every query with its test params
router.post("/api/c/:slug/connections/:mod/:name/test", requireManager, async (req, res) => {
  try {
    const c = await connections.row(req.params.slug, req.params.mod, req.params.name);
    if (c && c.kind === "erp") {
      if (req.sosRole !== "admin") return res.status(403).json({ error: "the ERP connection is set up and tested by Anetix" });
      return res.json(await connections.testErp(req.params.slug, req.params.mod, req.params.name, actor(req)));
    }
    res.json(await connections.testLabel(req.params.slug, req.params.mod, req.params.name, req));
  }
  catch (e) { res.status(400).json({ error: e.message }); }
});
// erp: where the system is, how each query is fulfilled, the read-only login
// (admin only during pilots, decided 2026-09-19; the login never comes back out)
router.post("/api/admin/connections/:slug/:mod/:name/erp", requireAdmin, async (req, res) => {
  try { res.json(await connections.setErp(req.params.slug, req.params.mod, req.params.name, req.body || {}, actor(req))); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
// erp: have the model write what IT needs to build each lookup, wide on purpose
router.post("/api/admin/connections/:slug/:mod/:name/draft", requireAdmin, async (req, res) => {
  try { res.json(await connections.draftLookups(req.params.slug, req.params.mod, req.params.name, actor(req))); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.get("/api/c/:slug/connections/:mod/:name/it-note.txt", requireAdmin, async (req, res) => {
  try { res.set("Content-Disposition", `attachment; filename="read-only-access-${req.params.slug}-${req.params.name}.txt"`).type("text/plain").send(await connections.itNote(req.params.slug, req.params.mod, req.params.name)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.get("/api/c/:slug/connections/:mod/:name/preview.png", requireManager, async (req, res) => {
  try {
    const c = await connections.row(req.params.slug, req.params.mod, req.params.name);
    if (!c || c.kind !== "printer") return res.status(404).end();
    const co = (await q("SELECT name FROM platform.companies WHERE slug=$1", [req.params.slug])).rows[0];
    const zpl = connections.renderZpl(connections.TEST_LABEL, { company: co ? co.name : req.params.slug, when: "date and time", code: "TEST000000" });
    const png = await connections.previewPng(zpl, c.settings);
    if (!png) return res.status(503).json({ error: "the label renderer could not be reached" });
    res.set("Cache-Control", "no-cache").type("png").send(png);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.get("/api/c/:slug/connections/:mod/:name/jobs", requireManager, async (req, res) => {
  try { res.json({ jobs: await connections.jobs(req.params.slug, req.params.mod, req.params.name, req.query.limit) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
// the device side: the platform's print helper on a page asks for the next
// label queued for this device (any signed-in role: a station tablet prints)
router.get("/api/c/:slug/print/next", async (req, res) => {
  try { const job = await connections.nextJob(req.params.slug, connections.deviceOf(req)); res.set("Cache-Control", "no-store").json(job ? { job } : {}); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
router.post("/api/c/:slug/print/jobs/:id/done", async (req, res) => {
  try { await connections.finishJob(req.params.slug, connections.deviceOf(req), Number(req.params.id), { ok: true, printer: (req.body || {}).printer }); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.post("/api/c/:slug/print/jobs/:id/failed", async (req, res) => {
  try { await connections.finishJob(req.params.slug, connections.deviceOf(req), Number(req.params.id), { ok: false, printer: (req.body || {}).printer, error: (req.body || {}).error }); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

router.post("/api/admin/companies", requireAdmin, async (req, res) => {
  const { slug, name, brand_url, brand_model } = req.body || {};
  if (!SLUG.test(slug || "")) return res.status(400).json({ error: "slug: lowercase letters, digits, dashes" });
  if (!name) return res.status(400).json({ error: "name required" });
  const existed = Boolean(await company(slug));
  // A new company never rides on the shared passwords: it gets its own at
  // birth, the ones given or ones made up here and shown to the admin once.
  let made = null;
  if (!existed) {
    const floor = String((req.body || {}).floor_password || "").trim() || auth.generatePassword();
    let manager = String((req.body || {}).manager_password || "").trim() || auth.generatePassword();
    while (manager === floor) manager = auth.generatePassword();
    try { await q("INSERT INTO platform.companies (slug, name) VALUES ($1,$2)", [slug, name]); await auth.setPasswords(slug, { floor, manager }); }
    catch (e) { await q("DELETE FROM platform.companies WHERE slug=$1", [slug]).catch(() => {}); return res.status(400).json({ error: e.message }); }
    made = { floor, manager };
  }
  await q("INSERT INTO platform.companies (slug, name) VALUES ($1,$2) ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name", [slug, name]);
  if (brand_url && String(brand_url).trim()) {
    const url = String(brand_url).trim();
    await q("UPDATE platform.companies SET brand=$2 WHERE slug=$1", [slug, JSON.stringify({ url, status: "building" })]);
    brand.buildGuide(slug, url, brand_model).catch((e) => console.error(`[brand] ${slug}:`, e.message));
  }
  await upsertDoc(slug, null, "COMPANY.md", `# ${name}\n\nWhat the agents should know about this company: what it makes, who is on the floor, what matters most (safety, throughput, quality), vocabulary the floor uses, anything to avoid.\n`, "repo", true);
  await logEvent(existed ? "company_renamed" : "company_created", slug, { name });
  res.json({ ok: true, passwords: made });
});

// Set or rotate a company's floor and manager passwords. Giving a company its
// own passwords ends its use of the shared ones from the environment.
router.post("/api/admin/companies/:slug/access", requireAdmin, async (req, res) => {
  const co = await company(req.params.slug);
  if (!co) return res.status(404).json({ error: "unknown company" });
  const b = req.body || {};
  const floor = b.generate ? auth.generatePassword() : String(b.floor_password || "").trim();
  let manager = b.generate ? auth.generatePassword() : String(b.manager_password || "").trim();
  while (b.generate && manager === floor) manager = auth.generatePassword();
  try {
    await auth.setPasswords(co.slug, { floor: floor || null, manager: manager || null });
    // a new site's once-only welcome holds the floor password the rollover made: a new one here makes that one dead
    if (floor) await q("UPDATE platform.sites SET welcome_enc=NULL WHERE company=$1 AND welcome_enc IS NOT NULL", [co.slug]).catch(() => {});
    await logEvent("company_passwords_set", co.slug, { floor: Boolean(floor), manager: Boolean(manager), generated: Boolean(b.generate) });
    res.json({ ok: true, passwords: b.generate ? { floor, manager } : null, access: auth.accessPublic(await auth.accessRow(co.slug)) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// A company's own monthly AI budget; blank or 0 takes it off.
router.post("/api/admin/companies/:slug/cap", requireAdmin, async (req, res) => {
  const co = await company(req.params.slug);
  if (!co) return res.status(404).json({ error: "unknown company" });
  const raw = (req.body || {}).usd;
  const usd = raw === "" || raw == null ? null : Number(raw);
  if (usd != null && (!Number.isFinite(usd) || usd < 0 || usd > 100000)) return res.status(400).json({ error: "give a dollar amount, or leave it blank for no cap" });
  await q("UPDATE platform.companies SET monthly_cap_usd=$2 WHERE slug=$1", [co.slug, usd || null]);
  await logEvent("company_cap_set", co.slug, { usd: usd || null });
  res.json({ ok: true, monthly_cap_usd: usd || null });
});

router.post("/api/admin/companies/:slug/modules", requireAdmin, async (req, res) => {
  const { module: mod } = req.body || {};
  try {
    const co = await company(req.params.slug);
    if (!co) return res.status(404).json({ error: "unknown company" });
    const r = await registry.importFromRepo(co.slug, mod);
    const row = await registry.getModule(co.slug, mod);
    if (row && row.live_version) { await registry.mountLiveIfNeeded(co.slug, mod, row.live_version); await testfloor.afterModuleAdded(co.slug, mod, row.live_version); }
    let restyle = null;
    if (co.brand && co.brand.status === "done" && (req.body || {}).restyle !== false) {
      try { restyle = (await brand.restyleModule(co.slug, mod)).id; }
      catch (e) { console.error(`[brand] restyle ${co.slug}/${mod}:`, e.message); }
    }
    res.json({ ok: true, ...r, restyle_run: restyle });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- admin: brand guide from a URL, restyle a module to it ---------------------
router.post("/api/admin/companies/:slug/brand", requireAdmin, async (req, res) => {
  const { url, model } = req.body || {};
  const co = await company(req.params.slug);
  if (!co) return res.status(404).json({ error: "unknown company" });
  if (!url || !/^https?:\/\//i.test(String(url).trim())) return res.status(400).json({ error: "give the site address, starting with https://" });
  if (co.brand && co.brand.status === "building") return res.status(409).json({ error: "the guide is already being built" });
  await q("UPDATE platform.companies SET brand=$2 WHERE slug=$1", [co.slug, JSON.stringify({ ...(co.brand || {}), url: String(url).trim(), status: "building" })]);
  brand.buildGuide(co.slug, String(url).trim(), model).catch((e) => console.error(`[brand] ${co.slug}:`, e.message));
  res.json({ ok: true, status: "building" });
});
router.post("/api/admin/companies/:slug/modules/:module/restyle", requireAdmin, async (req, res) => {
  try { const run = await brand.restyleModule(req.params.slug, req.params.module, { model: (req.body || {}).model }); res.json({ ok: true, run }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ---- admin: delete a company ----------------------------------------------------
// Two gates: the slug typed back, and a fresh code from the admin's authenticator
// (auth.checkAdminCode; the shared admin password again while that still exists).
// Refused while any build of that company is running or queued. Everything the
// company owns goes: module schemas and snapshots, versions, feedback, runs,
// docs, reviews, diagrams, batches, the mounts, the materialized files.
// The data wall (src/datawall.js): whether the AI may read this company's data. Admin only; on the record.
router.post("/api/admin/companies/:slug/data-wall", requireAdmin, async (req, res) => {
  try {
    const co = await company(req.params.slug);
    if (!co) return res.status(404).json({ error: "unknown company" });
    const out = await datawall.setWall(co.slug, Boolean((req.body || {}).walled), actor(req, req.sosAccount && req.sosAccount.name ? req.sosAccount.name : null));
    res.json({ ok: true, ...out, ai_reads_data: !out.walled });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});
router.post("/api/admin/companies/:slug/delete", requireAdmin, async (req, res) => {
  const { confirm_slug, password, code } = req.body || {};
  const co = await company(req.params.slug);
  if (!co) return res.status(404).json({ error: "unknown company" });
  if (String(confirm_slug || "") !== co.slug) return res.status(400).json({ error: "type the company slug exactly to confirm" });
  const gate = await auth.checkAdminCode(req, { code, password }, `delete_company:${co.slug}`);
  if (!gate.ok) { await logEvent("company_delete_refused", co.slug, { reason: gate.error, by: req.sosAccount ? req.sosAccount.login : null }); return res.status(403).json({ error: gate.error }); }
  const busy = (await q("SELECT count(*)::int AS n FROM platform.build_runs WHERE company=$1 AND status IN ('running','queued','waiting')", [co.slug])).rows[0].n;
  if (busy) return res.status(409).json({ error: `${busy} build(s) still open on this company; cancel them first` });
  const paying = await require("./sites").deleteRefusal(co.slug);   // a subscribed site's card is still being billed (src/sites.js)
  if (paying) return res.status(409).json({ error: paying });
  try {
    const mods = (await q("SELECT name FROM platform.modules WHERE company=$1", [co.slug])).rows.map((m) => m.name);
    await testfloor.deleteCompany(co.slug);   // its test tables and its test_floors row (the third role goes with the runner below)
    await selfserve.deleteCompany(co.slug);   // its credit ledger and its self_serve row (the pin it used keeps its count)
    await q("DELETE FROM platform.sample_fills WHERE company=$1", [co.slug]);   // what its sample fills put in (the rows go with the schemas below)
    await require("./sites").deleteCompany(co.slug);   // its row in the pipeline (src/sites.js)
    await require("./notices").deleteCompany(co.slug);   // its managers' notices
    await require("./agreements").forget(co.slug);       // its acceptances of the Terms stay on record (the Terms, 10.7) and stop counting
    registry.unmountCompany(co.slug);
    for (const m of mods) {
      await q(`DROP SCHEMA IF EXISTS ${migrate.liveSchema(co.slug, m)} CASCADE`);
      await q(`DROP SCHEMA IF EXISTS ${migrate.stagingSchema(co.slug, m)} CASCADE`);
    }
    for (const sn of (await q("SELECT file FROM platform.schema_snapshots WHERE company=$1", [co.slug])).rows) {
      if (/^snap_[a-z0-9_]+$/i.test(sn.file)) await q(`DROP SCHEMA IF EXISTS ${sn.file} CASCADE`);
    }
    const counts = {};
    const fbIds = (await q("SELECT id FROM platform.feedback WHERE company=$1", [co.slug])).rows.map((r) => r.id);
    counts.runs = (await q("DELETE FROM platform.build_runs WHERE company=$1", [co.slug])).rowCount;
    counts.proposals = (await q("DELETE FROM platform.proposals WHERE feedback_id = ANY($1::int[])", [fbIds])).rowCount;
    counts.feedback = (await q("DELETE FROM platform.feedback WHERE company=$1", [co.slug])).rowCount;
    for (const t of ["batches", "agent_docs", "reviews", "diagrams", "module_versions", "modules", "schema_snapshots", "attachments", "module_intakes", "company_access", "model_arms", "assessment_trials", "assessment_picks"]) {
      counts[t] = (await q(`DELETE FROM platform.${t} WHERE company=$1`, [co.slug])).rowCount;
    }
    await connections.deleteCompany(co.slug);
    await datacheck.deleteCompany(co.slug);
    await people.deleteCompany(co.slug);
    await require("./acceptance").deleteCompany(co.slug);
    await require("./runner").deleteCompany(co.slug);   // its processes, its two database logins, its user ids
    counts.record = await require("./record").deleteCompany(co.slug);
    await q("DELETE FROM platform.companies WHERE slug=$1", [co.slug]);
    await logEvent("company_deleted", co.slug, { name: co.name, modules: mods, counts, by: req.sosAccount ? req.sosAccount.login : null });
    res.json({ ok: true, counts });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- admin: whole-instance backup and restore ----------------------------------
router.get("/api/admin/backup", requireAdmin, async (_req, res) => {
  try {
    const doc = await backup.dump();
    await logEvent("backup_downloaded", null, { taken_at: doc.taken_at, schemas: Object.keys(doc.schemas).length });
    res.set("Content-Disposition", `attachment; filename="sos-backup-${doc.taken_at.slice(0, 19).replace(/[:T]/g, "-")}.json"`);
    res.type("application/json").send(JSON.stringify(doc));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// Restore replaces everything and then exits the process (Railway restarts it;
// boot rebuilds versions and mounts from the restored rows).
// A paying site (subscribed or switching on) is a customer's live tools (the Terms, 9.1): the admin says why, and every
// paying site in the restored data gets a notice on its board. A file older than a site's subscription would show a
// paying site as a demo while Stripe keeps billing it, so that is refused unless the admin says restore anyway.
const PAYING = ["subscribed", "activating"];
router.post("/api/admin/restore", requireAdmin, express.json({ limit: "300mb" }), async (req, res) => {
  const { password, code, backup: doc, sites_ok } = req.body || {};
  // asked before the step-up, so a code is never spent on an answer that sends the admin back to the form
  let why = null, behind = [];
  if (doc && doc.format === "sos-backup-1" && doc.platform) {
    const payingHere = (await q("SELECT company, stage FROM platform.sites WHERE stage = ANY($1)", [PAYING]).catch(() => ({ rows: [] }))).rows;
    const fileSites = Array.isArray(doc.platform.sites) ? doc.platform.sites : [];
    behind = payingHere.filter((h) => !fileSites.some((s) => s.company === h.company && s.stage === h.stage)).map((h) => h.company);
    if (payingHere.length || fileSites.some((s) => PAYING.includes(s.stage))) {
      why = adminChange(req, "*");
      if (!why.ok) return res.status(400).json({ error: "Paying sites' tools change with a restore. " + why.error, code: why.code });
    }
    if (behind.length && sites_ok !== true) return res.status(409).json({ code: "sites_behind", sites: behind, error: `The file is from before ${behind.join(", ")} ${behind.length === 1 ? "was" : "were"} switched on as it is now: restoring it would show ${behind.length === 1 ? "that site" : "those sites"} as ${behind.length === 1 ? "it was" : "they were"} then while Stripe keeps billing. End the subscription on Stripe first, or restore a newer file.` });
  }
  const gate = await auth.checkAdminCode(req, { code, password }, "restore_backup");
  if (!gate.ok) return res.status(403).json({ error: gate.error });
  const busy = (await q("SELECT count(*)::int AS n FROM platform.build_runs WHERE status='running'")).rows[0].n;
  if (busy) return res.status(409).json({ error: "a build is running; abort it first" });
  try {
    const when = String(doc.taken_at || "").slice(0, 10) || "an earlier day";
    const told = await backup.restore(doc, why && why.why ? { notice: { text: `Anetix put the platform back to a backup from ${when} ${ADMIN_WHY[why.why]}: ${why.note}. Your tools and their data are as they were then; anything changed after that is not in it.`, why: why.why }, paying: PAYING } : {});
    await logEvent("backup_restored", null, { taken_at: doc.taken_at, by: req.sosAccount ? req.sosAccount.login : null, told: told.told || [], sites_behind: behind, why: why && why.why ? why.why : null });
    res.json({ ok: true, restarting: true });
    console.log("[backup] restored; exiting so the platform reboots on the restored data");
    setTimeout(() => process.exit(1), 800);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- admin/manager: module version export (for revising a module from Cowork)
router.get("/api/c/:slug/modules/:name/export", requireManager, async (req, res) => {
  const row = await registry.getModule(req.params.slug, req.params.name);
  if (!row) return res.status(404).json({ error: "unknown module" });
  const version = req.query.version ? Number(req.query.version) : row.live_version;
  const files = await registry.versionFiles(row.company, row.name, version);
  if (!files) return res.status(404).json({ error: "no such version" });
  res.json({ company: row.company, module: row.name, version, live_version: row.live_version, files });
});

router.get("/api/admin/events", requireAdmin, async (_req, res) => {
  res.json((await q("SELECT * FROM platform.events ORDER BY id DESC LIMIT 200")).rows);
});

module.exports = router;
