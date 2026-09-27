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
// Routes: POST /api/c/:slug/notices/:id/seen (managers; the id must be this company's)
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
// The board's list: a manager's open notices, newest first; an admin sees them too (and cannot close them for the manager).
async function forBoard(company, role) {
  if (!["manager", "admin"].includes(role)) return [];
  return (await q("SELECT id, kind, text, created_at FROM platform.notices WHERE company=$1 AND seen_at IS NULL ORDER BY id DESC LIMIT 20", [company])).rows;
}
async function seen(req, slug, id) {
  if (req.sosRole !== "manager") return { status: 403, body: { error: "the company's manager closes its notices" } };
  const who = req.sosAccount ? req.sosAccount.login : "manager";
  const r = await q("UPDATE platform.notices SET seen_at=now(), seen_by=$3 WHERE id=$1 AND company=$2 AND seen_at IS NULL RETURNING id", [Number(id) || 0, slug, who]);
  return r.rows[0] ? { status: 200, body: { ok: true } } : { status: 404, body: { error: "no such notice" } };
}
async function deleteCompany(company) { await q("DELETE FROM platform.notices WHERE company=$1", [company]); }

const router = express.Router();
const requireManager = (req, res, next) => require("./auth").requireManager(req, res, next);
router.post("/api/c/:slug/notices/:id(\\d{1,9})/seen", requireManager, async (req, res) => {
  try { const r = await seen(req, String(req.params.slug || "").toLowerCase(), req.params.id); res.status(r.status).json(r.body); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = { init, SCHEMA, add, forBoard, seen, deleteCompany, router };
