// Notices for a company's managers (stage 3, 2026-09-26): a line on the board until a manager closes it. What puts one
// there:
//   tool_changed   Anetix changed one of the company's live tools without the company's approval (the Terms, 9.1:
//                  only to fix a security problem or an error that stops the tool working, "and tells Customer's
//                  manager when it does"), or put a change live that the manager asked Anetix to put live
//   card_declined  Activate's first charge was declined: another card is needed
//   declined       Anetix declined the site's order, with the reason
//   sent_back      Anetix sent the site's order back to be answered and signed again, with the note
// Plain text, never anything secret (the floor password of a new site has its own once-only handout, src/activate.js).
//
// Table (in the backup, gone with the company): platform.notices
// Routes: POST /api/c/:slug/notices/:id/seen   one notice (managers and admins; the id must be this company's)
//         POST /api/c/:slug/notices/seen-all     every open one at once
// 2026-10-13 (Brendan, seven "Anetix put a change live" lines stacked on Chelsea's board): "These notifications should not
// be taking up so much space ... we should be able to clear it." The board folds them into one line with a count, and
// an admin can close them too: Anetix runs some companies' boards itself for now (Chelsea Clock), so the admin is often
// the only one there to read them. Who closed one is kept (seen_by).
const express = require("express");
const { q } = require("./db");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS platform.notices (
  id          SERIAL PRIMARY KEY,
  company     TEXT NOT NULL,
  kind        TEXT NOT NULL,
  text        TEXT NOT NULL,
  detail      JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  seen_at     TIMESTAMPTZ,
  seen_by     TEXT
);
CREATE INDEX IF NOT EXISTS notices_company ON platform.notices (company, id DESC);`;
async function init() { await q(SCHEMA); }

const clean = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
async function add(company, kind, text, detail = null, db = { query: q }) {
  await db.query("INSERT INTO platform.notices (company, kind, text, detail) VALUES ($1,$2,$3,$4)", [company, kind, clean(text, 1000), detail ? JSON.stringify(detail) : null]);
}
// The board's list: the open notices, newest first, for managers and admins.
async function forBoard(company, role) {
  if (!["manager", "admin"].includes(role)) return [];
  return (await q("SELECT id, kind, text, created_at FROM platform.notices WHERE company=$1 AND seen_at IS NULL ORDER BY id DESC LIMIT 20", [company])).rows;
}
const closer = (req) => (req.sosAccount ? req.sosAccount.login : req.sosRole === "admin" ? "admin" : "manager");
async function seen(req, slug, id) {
  if (!["manager", "admin"].includes(req.sosRole)) return { status: 403, body: { error: "a manager closes the company's notices" } };
  const r = await q("UPDATE platform.notices SET seen_at=now(), seen_by=$3 WHERE id=$1 AND company=$2 AND seen_at IS NULL RETURNING id", [Number(id) || 0, slug, closer(req)]);
  return r.rows[0] ? { status: 200, body: { ok: true } } : { status: 404, body: { error: "no such notice" } };
}
async function seenAll(req, slug) {
  if (!["manager", "admin"].includes(req.sosRole)) return { status: 403, body: { error: "a manager closes the company's notices" } };
  const r = await q("UPDATE platform.notices SET seen_at=now(), seen_by=$2 WHERE company=$1 AND seen_at IS NULL", [slug, closer(req)]);
  return { status: 200, body: { ok: true, closed: r.rowCount } };
}
async function deleteCompany(company) { await q("DELETE FROM platform.notices WHERE company=$1", [company]); }

const router = express.Router();
const requireManager = (req, res, next) => require("./auth").requireManager(req, res, next);
router.post("/api/c/:slug/notices/seen-all", requireManager, async (req, res) => {
  try { const r = await seenAll(req, String(req.params.slug || "").toLowerCase()); res.status(r.status).json(r.body); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
router.post("/api/c/:slug/notices/:id(\\d{1,9})/seen", requireManager, async (req, res) => {
  try { const r = await seen(req, String(req.params.slug || "").toLowerCase(), req.params.id); res.status(r.status).json(r.body); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = { init, SCHEMA, add, forBoard, seen, seenAll, deleteCompany, router };
