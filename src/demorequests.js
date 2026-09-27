// Demo requests from anetix.ai (2026-09-26, Brendan: "an intake form for someone who wants to get a demo, and what sort
// of demo they want (just a pin or a call), how they heard about it, contact information, business ... then that will
// come in on the pins page, so I can see requests and get people initial sign ins and accounts").
//
// The form is the www service's (www/pages.js request(), POST /request); it posts here server to server with the shared
// key, like every other www call (selfserve.keyOk). The Pins tab on /admin lists the requests newest first, with what
// they want, and "Make their pin" makes a pin for their email (one company, 30 days), ties it to the request and hands
// back a message to send them. The same email asking again inside a day adds to its open request instead of making a
// second one. Nothing here sends email: the platform has no mail of its own yet, so Brendan sends the pin himself.
//
//   platform.demo_requests   who (name, email, company, role, phone, size), what they make, what they want (pin, call or
//                            both, with good times for a call), what they would like to fix, how they heard, status
//                            (new, pin_sent, call_booked, done, declined), a note, the pin made for it, who handled it.
//
// Routes:
//   POST /api/www/demo-requests                  the www service (shared key)
//   GET  /api/admin/demo-requests                admin: the list, with the company each pin made
//   POST /api/admin/demo-requests/:id            admin: { status?, note? }
//   POST /api/admin/demo-requests/:id/pin        admin: make their pin { days?, uses? } -> the pin and a message to send
// auth-free record: events demo_requested, demo_request_pin, demo_request_status.
const express = require("express");
const { q, logEvent } = require("./db");
const selfserve = require("./selfserve");
const accounts = require("./accounts");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS platform.demo_requests (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  company     TEXT NOT NULL,
  role        TEXT,
  phone       TEXT,
  size        TEXT,
  makes       TEXT,                           -- what the business makes or does
  wants       TEXT NOT NULL DEFAULT 'pin',    -- pin | call | both
  call_times  TEXT,
  goal        TEXT,                           -- what they would like to fix or see
  heard       TEXT,
  heard_more  TEXT,
  status      TEXT NOT NULL DEFAULT 'new',    -- new | pin_sent | call_booked | done | declined
  note        TEXT,
  pin_id      INTEGER,
  ip          TEXT,
  asks        INTEGER NOT NULL DEFAULT 1,     -- the same email asking again inside a day adds here
  handled_by  TEXT,
  handled_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS demo_requests_email ON platform.demo_requests (email, created_at DESC);`;
async function init() { await q(SCHEMA); }

const WANTS = ["pin", "call", "both"];
const STATUSES = ["new", "pin_sent", "call_booked", "done", "declined"];
const SIZES = ["1-19", "20-99", "100-499", "500+"];
const HEARD = ["someone told me", "linkedin", "mit", "search", "event", "other"];
const clean = (s, n) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);
const long = (s, n) => String(s == null ? "" : s).replace(/\r\n/g, "\n").trim().slice(0, n);
const fail = (status, msg) => Object.assign(new Error(msg), { status });

// Pure: the form's fields, cleaned, or the first problem in plain words. -> { ok, row } | { ok: false, error, field }
function check(b = {}) {
  const row = {
    name: clean(b.name, 100), email: accounts.cleanLogin(b.email), company: clean(b.company, 120), role: clean(b.role, 80) || null,
    phone: clean(b.phone, 40) || null, size: SIZES.includes(b.size) ? b.size : null, makes: clean(b.makes, 200) || null,
    wants: WANTS.includes(b.wants) ? b.wants : null, call_times: clean(b.call_times, 200) || null, goal: long(b.goal, 2000) || null,
    heard: HEARD.includes(b.heard) ? b.heard : null, heard_more: clean(b.heard_more, 200) || null,
  };
  if (row.name.length < 2) return { ok: false, field: "name", error: "Tell me your name." };
  if (!accounts.validLogin(row.email)) return { ok: false, field: "email", error: "Give an email I can write back to." };
  if (row.company.length < 2) return { ok: false, field: "company", error: "Tell me the company." };
  if (!row.wants) return { ok: false, field: "wants", error: "Choose the kind of demo you would like." };
  if (row.wants !== "pin" && !row.phone && !row.call_times) row.call_times = null;   // a call can still be arranged by email
  return { ok: true, row };
}

async function create(b, ip) {
  const c = check(b);
  if (!c.ok) throw Object.assign(fail(400, c.error), { field: c.field });
  const r = c.row;
  // the same email again inside a day: the open request takes the newer answers (a blank keeps the old one) and counts the ask
  const open = (await q("SELECT id FROM platform.demo_requests WHERE email=$1 AND status='new' AND created_at > now() - interval '1 day' ORDER BY id DESC LIMIT 1", [r.email])).rows[0];
  if (open) {
    await q(`UPDATE platform.demo_requests SET name=$2, company=$3, role=COALESCE($4, role), phone=COALESCE($5, phone), size=COALESCE($6, size), makes=COALESCE($7, makes), wants=$8, call_times=COALESCE($9, call_times), goal=COALESCE($10, goal), heard=COALESCE($11, heard), heard_more=COALESCE($12, heard_more), asks=asks+1, updated_at=now() WHERE id=$1`,
      [open.id, r.name, r.company, r.role, r.phone, r.size, r.makes, r.wants, r.call_times, r.goal, r.heard, r.heard_more]);
    await logEvent("demo_requested", String(open.id), { again: true, wants: r.wants });
    return { id: open.id, again: true };
  }
  const row = (await q(`INSERT INTO platform.demo_requests (name, email, company, role, phone, size, makes, wants, call_times, goal, heard, heard_more, ip)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
  [r.name, r.email, r.company, r.role, r.phone, r.size, r.makes, r.wants, r.call_times, r.goal, r.heard, r.heard_more, clean(ip, 80) || null])).rows[0];
  await logEvent("demo_requested", String(row.id), { wants: r.wants, heard: r.heard });
  return { id: row.id, again: false };
}

async function list() {
  return (await q(`SELECT d.*, p.pin AS pin_raw, p.uses AS pin_uses, p.max_uses AS pin_max, p.expires_at AS pin_expires, p.revoked_at AS pin_revoked,
      (SELECT string_agg(s.company, ', ') FROM platform.self_serve s WHERE s.pin_id=d.pin_id) AS companies
    FROM platform.demo_requests d LEFT JOIN platform.access_pins p ON p.id=d.pin_id ORDER BY d.id DESC LIMIT 300`)).rows
    .map(({ pin_raw, ...d }) => ({ ...d, pin_shown: pin_raw ? selfserve.showPin(pin_raw) : null }));
}
async function setStatus(id, { status, note }, by) {
  const d = (await q("SELECT * FROM platform.demo_requests WHERE id=$1", [Number(id)])).rows[0];
  if (!d) throw fail(404, "no such request");
  if (status !== undefined && !STATUSES.includes(status)) throw fail(400, `status is one of ${STATUSES.join(", ")}`);
  await q("UPDATE platform.demo_requests SET status=COALESCE($2, status), note=COALESCE($3, note), handled_by=$4, handled_at=now(), updated_at=now() WHERE id=$1",
    [d.id, status || null, note === undefined ? null : long(note, 2000), by || null]);
  await logEvent("demo_request_status", String(d.id), { status: status || d.status, by });
}
// The message a person gets with their pin (Brendan sends it; nothing here sends mail). Pure. No dashes: it goes out.
function messageFor({ name, email, pin, days, url }) {
  const first = String(name || "").trim().split(/\s+/)[0] || "there";
  return `Hi ${first},\n\nThanks for asking to try Anetix. Here is your demo pin: ${pin}\n\nGo to ${url}/pin and enter it with this email address (${email}). You will name your company, pick a password and set up an authenticator app, and then your demo board is ready, with AI credit from us to build your first tool.${days ? ` The pin is good for ${days} days.` : ""}\n\nReply here with any questions.`;
}
async function makePin(id, { days = 30, uses = 1 } = {}, by) {
  const d = (await q("SELECT * FROM platform.demo_requests WHERE id=$1", [Number(id)])).rows[0];
  if (!d) throw fail(404, "no such request");
  if (d.pin_id) {
    const p = (await q("SELECT * FROM platform.access_pins WHERE id=$1", [d.pin_id])).rows[0];
    if (p && !selfserve.pinProblem(p)) throw fail(409, `this request already has a live pin (${selfserve.showPin(p.pin)})`);
  }
  const row = await selfserve.makePinRow({ label: `${d.name} at ${d.company}`.slice(0, 80), email: d.email, max_uses: uses, days }, by);
  await q("UPDATE platform.demo_requests SET pin_id=$2, status=CASE WHEN status IN ('new','call_booked') THEN 'pin_sent' ELSE status END, handled_by=$3, handled_at=now(), updated_at=now() WHERE id=$1", [d.id, row.id, by || null]);
  await logEvent("demo_request_pin", String(d.id), { pin: row.id, by });
  const url = selfserve.WWW_URL().replace(/\/+$/, "");
  const shown = selfserve.showPin(row.pin);
  return { pin: { id: row.id, shown, email: row.email, max_uses: row.max_uses, expires_at: row.expires_at }, message: messageFor({ name: d.name, email: d.email, pin: shown, days: Number(days) || 0, url }), subject: "Your Anetix demo pin" };
}

// ---- routes ------------------------------------------------------------------------------------------------------------
const json = express.json({ limit: "20kb" });
const guard = (fn) => async (req, res) => { try { await fn(req, res); } catch (e) { res.status(e.status || 400).json({ error: e.message, field: e.field }); } };
// the www service's route: before the session middleware, opened by the shared key (server.js mounts it beside selfserve.wwwRouter)
const wwwRouter = express.Router();
wwwRouter.post("/api/www/demo-requests", json, guard(async (req, res) => {
  if (!selfserve.keyOk(req)) return res.status(401).json({ error: "www key required" });
  const b = req.body || {};
  res.set("Cache-Control", "no-store").json({ ok: true, ...(await create(b, b.ip)) });
}));
// the admin's routes: behind the session middleware
const router = express.Router();
const admin = (req, res, next) => require("./auth").requireAdmin(req, res, next);
const who = (req) => (req.sosAccount ? req.sosAccount.login : "admin");
router.get("/api/admin/demo-requests", admin, guard(async (_req, res) => {
  const rows = await list();
  res.set("Cache-Control", "no-store").json({ requests: rows, open: rows.filter((r) => r.status === "new").length, www_url: selfserve.WWW_URL() });
}));
router.post("/api/admin/demo-requests/:id(\\d{1,9})", admin, json, guard(async (req, res) => {
  const b = req.body || {};
  await setStatus(req.params.id, { status: b.status, note: b.note }, who(req));
  res.json({ ok: true });
}));
router.post("/api/admin/demo-requests/:id(\\d{1,9})/pin", admin, json, guard(async (req, res) => {
  const b = req.body || {};
  res.set("Cache-Control", "no-store").json({ ok: true, ...(await makePin(req.params.id, { days: b.days == null ? 30 : Number(b.days), uses: Number(b.uses) || 1 }, who(req))) });
}));

module.exports = { init, SCHEMA, wwwRouter, router, check, create, list, setStatus, makePin, messageFor, WANTS, STATUSES, SIZES, HEARD };
