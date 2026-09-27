// Self-serve companies: access pins, AI credit, and the way in from anetix.ai (2026-09-25).
//
// Why. anetix.ai is the public front door. Nobody gets in from there without a pin Brendan handed them (the product
// is not open to the public yet), and the ones who do pay a small amount through Stripe and get a company of their
// own on this instance with that amount as AI credit: enough to build a first module and run a couple of loops.
// When it runs low they pay again. Brendan, 2026-09-25: "I do not want everyone using this willy nilly (yet)", per
// person pins issued from /admin, a demo starts with $10 of credit from us (2026-09-26, was $15), top-ups at two dollars for one ($20 buys $10).
//
// Three tables, all in the backup and all gone with the company:
//   platform.access_pins    a pin per invitee: who it is for, how many companies it may make (default one), when it
//                           expires (default 30 days), revoked when, and the count of uses. The pin itself is stored
//                           as typed (uppercase, no dashes): it is an invitation, not a password, and the admin has
//                           to be able to read it back to hand it over again.
//   platform.self_serve     one row per company that came in this way: the pin, the email and name from the
//                           checkout, when. Not on platform.companies (that table is SELECT *'d onto pages).
//   platform.credit_ledger  every dollar of credit: purchase (Stripe, ref = the checkout session id, unique so a
//                           webhook and a success page landing the same payment count it once), grant (the admin,
//                           free), adjust. Credit is a balance, not a monthly budget: sum of the ledger minus what
//                           the platform has spent for the company since its self_serve row was made, the same five
//                           sources monthlySpend adds up (src/agent.js).
//
// The gate. agent.assertUnderCap(company), the one place every AI run passes, also calls assertCredit(company):
// a self-serve company with nothing left is refused with a line that names the top-up page. The company's own
// monthly cap and the instance cap still apply on top. A company with no self_serve row is untouched by any of this.
//
// Routes for the www service (anetix.ai, a separate Railway service), mounted BEFORE the session middleware in
// server.js and opened by a shared key in X-SOS-WWW-Key (SOS_WWW_KEY, compared in constant time):
//   POST /api/www/pin              { pin }                                  is this pin good: label, uses left
//   POST /api/www/companies        { pin, name, contact, email, ref, paid_usd, credit_usd }
//                                  makes the company: a floor password, and for the manager a named ACCOUNT (login =
//                                  the email, a made-up password, an authenticator app set up at the first sign-in:
//                                  Brendan, 2026-09-25, "all demo should be 2FA"; src/accounts.js role manager), both
//                                  shown once in the answer; spends a use of the pin; writes the first ledger row.
//                                  The same ref again returns the company without passwords (created:false), so a
//                                  reload of the success page is safe. No shared manager password exists for such a
//                                  company: manager sign-in is the account and its code, or nothing.
//                                  { collect: true } is what the PERSON's browser sends (the welcome page): the
//                                  passwords come back once more if nobody has collected them yet, then never again.
//                                  Why: Stripe's webhook often lands the payment before the success page does, and
//                                  the webhook is nobody's browser, so the passwords it was handed would be lost.
//                                  They wait encrypted in self_serve.handout_enc until collected (or an admin resets).
//   POST /api/www/credit           { slug, ref, paid_usd, credit_usd }      a top-up; the same ref again adds nothing
//   GET  /api/www/companies/:slug                                           name and balance, for the top-up page
// Admin routes (with the platform router, admin session):
//   GET  /api/admin/pins                       every pin, every self-serve company with its balance, and the last 30
//                                              days of refused pins with the reason (platform.pin_refusals)
//   POST /api/admin/pins                       { label, max_uses, days }  make one
//   POST /api/admin/pins/:id/revoke
//   GET  /api/admin/companies/:slug/credit     the ledger and the balance
//   POST /api/admin/companies/:slug/credit     { usd, note }  a grant (negative to take back); makes the company
//                                              self-serve if it was not
// The board (/api/c/:slug/board) carries credit: { balance_usd, credit_usd, spent_usd, topup_url } for a self-serve
// company, and the board shows it as one line under the band with an Add credit link (SOS_WWW_URL).
const crypto = require("crypto");
const express = require("express");
const { q, logEvent } = require("./db");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS platform.access_pins (
  id          SERIAL PRIMARY KEY,
  pin         TEXT NOT NULL UNIQUE,
  label       TEXT NOT NULL,
  max_uses    INTEGER NOT NULL DEFAULT 1,
  uses        INTEGER NOT NULL DEFAULT 0,
  expires_at  TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS platform.self_serve (
  company     TEXT PRIMARY KEY,
  pin_id      INTEGER,
  email       TEXT,
  contact     TEXT,
  handout_enc BYTEA,                      -- the floor password and the manager's first password, encrypted, until the person's browser collects them once (then NULL)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE platform.self_serve ADD COLUMN IF NOT EXISTS handout_enc BYTEA;
-- the demo workflow (2026-09-25 evening): a pin is made FOR an email and only works with it; a company made from one
-- is a demo (the board's rolling DEMO banner, the out-of-credit panel)
ALTER TABLE platform.access_pins ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE platform.companies ADD COLUMN IF NOT EXISTS demo BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS platform.credit_ledger (
  id          SERIAL PRIMARY KEY,
  company     TEXT NOT NULL,
  delta_usd   NUMERIC(10,2) NOT NULL,
  kind        TEXT NOT NULL,             -- purchase | grant | adjust
  ref         TEXT UNIQUE,               -- the Stripe checkout session id for a purchase; NULL for a grant
  paid_usd    NUMERIC(10,2),             -- what the person paid, for a purchase
  note        TEXT,
  made_by     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS credit_ledger_company ON platform.credit_ledger (company, id);
-- every pin anetix.ai refused, with the reason (the launch audit 0.3, 2026-09-27: five attempts from outside on 9/26,
-- four refused, and nothing said which of five reasons anyone saw). The same pin, email, reason and place within ten
-- minutes is one row with a count. Kept 90 days (src/dataexport.js sweep; the privacy notice says so); never in a backup.
CREATE TABLE IF NOT EXISTS platform.pin_refusals (
  id          SERIAL PRIMARY KEY,
  pin         TEXT,                      -- as typed, cleaned (an invitation, not a password)
  pin_id      INTEGER,                   -- the pin it matched, when it matched one
  email       TEXT,                      -- the email typed with it
  reason      TEXT NOT NULL,             -- unknown | cancelled | expired | used | email
  where_from  TEXT,                      -- pin (the wall's box) | home (a pin page opened again) | check (before a checkout)
  ip          TEXT,
  count       INTEGER NOT NULL DEFAULT 1,
  first_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pin_refusals_last ON platform.pin_refusals (last_at DESC);
`;
async function init() { await q(SCHEMA); }

const SLUG = /^[a-z0-9][a-z0-9-]{1,40}$/;
const WWW_URL = () => String(process.env.SOS_WWW_URL || "https://anetix.ai").replace(/\/+$/, "");
const fail = (status, msg) => Object.assign(new Error(msg), { status });
const clean = (s, n) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);
const money = (x) => Math.round(Number(x || 0) * 100) / 100;

// ---- pure --------------------------------------------------------------------------------------------------------
// A pin a person can read off a text message: eight characters, no letters that look like digits, shown with a dash.
const PIN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function makePin() {
  let s = ""; for (let i = 0; i < 8; i++) s += PIN_ALPHABET[crypto.randomInt(PIN_ALPHABET.length)];
  return s;
}
function normalizePin(s) { return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16); }
function showPin(s) { return `${s.slice(0, 4)}-${s.slice(4)}`; }
// Why a pin is no good, as a reason (unknown, cancelled, expired, used) or null when it is good. Pure.
function pinReason(row, now = new Date()) {
  if (!row) return "unknown";
  if (row.revoked_at) return "cancelled";
  if (row.expires_at && new Date(row.expires_at) <= now) return "expired";
  if (Number(row.uses) >= Number(row.max_uses)) return "used";
  return null;
}
// What the person reads for each reason (the launch audit 0.3: a used pin said nothing about Sign in, and an expired or
// cancelled one said nothing about getting another; anetix.ai also turns the link under the pin box into "Request a new
// pin" for those two). "used_mine" is a used pin whose email matches: it made THEIR demo, and anetix.ai opens Sign in
// with the login filled. The words work on any page that shows them (the set-up form's error too).
const HELP = "brendan@anetix.ai or taylor@anetix.ai";
const PIN_WORDS = {
  unknown: "That pin is not one Anetix gave out. Check it against the message it came in.",
  cancelled: `That pin was cancelled. To get a new one, ask at anetix.ai/request or write to ${HELP}.`,
  expired: `That pin has expired. To get a new one, ask at anetix.ai/request or write to ${HELP}.`,
  used: "That pin has already been used. If it made your demo, sign in with your email instead.",
  used_mine: "That pin already made your demo, so it will not open it again. Sign in with your email instead.",
  email: "That pin and email do not go together. Use the email the pin was made for.",
};
// the Pins tab's short words for a reason
const PIN_SHORT = { unknown: "not a pin we made", cancelled: "cancelled", expired: "expired", used: "already used", email: "wrong email for the pin" };
// Why a pin is no good, in the words a person reads, or null when it is good. Pure.
function pinProblem(row, now = new Date()) { const r = pinReason(row, now); return r ? PIN_WORDS[r] : null; }
// A pin made for an email works only with that email (typed any case, spaces around it ignored). A pin from before
// emails were asked for (email NULL) takes any. Pure.
function pinEmailProblem(row, email) {
  if (!row || !row.email) return null;
  return String(email || "").trim().toLowerCase() === row.email ? null : PIN_WORDS.email;
}
// The company's code from its name: "Acme Wire & Cable Inc." -> "acme-wire-cable-inc". Pure.
function slugFrom(name) {
  let s = String(name || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30).replace(/-+$/g, "");
  if (s.length < 2) s = "co-" + s;
  return s;
}
// The balance and the line the board shows. Pure. The board says a PERCENTAGE, never dollars (Brendan, 2026-09-25:
// "I do not want to show what $ credits, just a percentage"), measured against ONE demo allowance (UNIT, $10 since
// 2026-09-26, was $15): balance / $10. Nothing is lost at a refill: 5% left plus a refill reads 105% ("I do not want to have a frustrating
// rip off system there"), so it can go past 100. The dollar fields stay for the admin page and the www service,
// which never show them to the company.
const UNIT = () => Math.max(1, Number(process.env.SOS_CREDIT_UNIT_USD || 10));
function balanceOf({ credit_usd = 0, spent_usd = 0, unit_usd = UNIT() }) {
  const balance = money(money(credit_usd) - money(spent_usd));   // from the cents shown, so the line adds up
  const percent = balance <= 0 ? 0 : Math.max(1, Math.round((balance / unit_usd) * 100));   // never "0%" while something is left
  const level = balance <= 0 ? "red" : percent < 25 ? "amber" : "ok";
  const line = balance <= 0
    ? "used up. Nothing new will be proposed or built until more is added."
    : `${percent}% left.`;
  return { balance_usd: balance, credit_usd: money(credit_usd), spent_usd: money(spent_usd), unit_usd, percent, level, line };
}

// ---- reads -------------------------------------------------------------------------------------------------------
async function pinRow(pin) {
  const p = normalizePin(pin); if (!p) return null;
  return (await q("SELECT * FROM platform.access_pins WHERE pin=$1", [p])).rows[0] || null;
}
// The refusal for a pin and an email, or null when they are good: { reason, error, signin? }. A used pin typed with
// the email it was made for made THAT person's demo, so the answer carries the manager account's login and anetix.ai
// opens Sign in with it filled (the launch audit 0.3). Anyone else learns only that the pin was used.
async function refusalFor(row, email) {
  const reason = pinReason(row) || (pinEmailProblem(row, email) ? "email" : null);
  if (!reason) return null;
  const out = { reason, error: PIN_WORDS[reason] };
  const typed = String(email || "").trim().toLowerCase();
  if (reason === "used" && row && row.email && typed === row.email) {
    // exactly the account the demo made for this email: the email itself, or <local>+<slug>@<domain> when the email
    // already had an account (createCompany), and switched on; never another manager of that company
    const at = typed.lastIndexOf("@");
    const a = (await q(`SELECT a.login FROM platform.self_serve s JOIN platform.accounts a ON a.company=s.company AND a.role='manager' AND a.status='active'
                         WHERE s.pin_id=$1 AND (a.login=$2::text OR a.login = $3::text || '+' || s.company || $4::text) ORDER BY a.created_at LIMIT 1`,
      [row.id, typed, at > 0 ? typed.slice(0, at) : typed, at > 0 ? typed.slice(at) : ""])).rows[0];
    if (a) { out.error = PIN_WORDS.used_mine; out.signin = a.login; }
  }
  return out;
}
// One line on the Pins tab for a refusal. Never throws: the person's answer never waits on it.
const REFUSED_WHERE = new Set(["pin", "home", "check"]);
async function logRefusal({ pin, row, email, reason, where, ip }) {
  try {
    const p = normalizePin(pin) || null, e = clean(email, 200).toLowerCase() || null, w = REFUSED_WHERE.has(where) ? where : "pin", addr = clean(ip, 64) || null;
    // a pin that matches nothing is merged by address too (the latest typed kept), so a loop of made-up pins is one line
    const bumped = await q(`UPDATE platform.pin_refusals SET count=count+1, last_at=now(), ip=coalesce($5, ip), pin=$1, email=$2
       WHERE id = (SELECT id FROM platform.pin_refusals WHERE reason=$3 AND where_from=$4 AND last_at > now() - interval '10 minutes'
                     AND ((pin IS NOT DISTINCT FROM $1::text AND email IS NOT DISTINCT FROM $2::text) OR ($3 = 'unknown' AND $5::text IS NOT NULL AND ip = $5::text))
                   ORDER BY id DESC LIMIT 1) RETURNING id`, [p, e, reason, w, addr]);
    if (!bumped.rows.length) await q("INSERT INTO platform.pin_refusals (pin, pin_id, email, reason, where_from, ip) VALUES ($1,$2,$3,$4,$5,$6)", [p, row ? row.id : null, e, reason, w, addr]);
  } catch (err) { console.error("[pins] a refusal was not logged:", err.message); }
}
async function selfServeRow(company) {
  return (await q("SELECT * FROM platform.self_serve WHERE company=$1", [company])).rows[0] || null;
}
// What the platform has spent for one company since a moment: the same five sources monthlySpend adds up.
async function spentSince(company, since) {
  const r = (await q(`
    SELECT COALESCE((SELECT SUM(cost_usd) FROM platform.build_runs WHERE company=$1 AND created_at >= $2),0)
         + COALESCE((SELECT SUM(p.cost_usd) FROM platform.proposals p JOIN platform.feedback f ON f.id=p.feedback_id WHERE f.company=$1 AND p.created_at >= $2),0)
         + COALESCE((SELECT SUM(cost_usd) FROM platform.reviews WHERE company=$1 AND created_at >= $2),0)
         + COALESCE((SELECT SUM((brand->>'cost_usd')::numeric) FROM platform.companies WHERE slug=$1 AND brand IS NOT NULL AND (brand->>'built_at')::timestamptz >= $2),0)
         + COALESCE((SELECT SUM(cost_usd) FROM platform.ai_usage WHERE company=$1 AND created_at >= $2),0) AS usd`, [company, since])).rows[0];
  return Number(r.usd || 0);
}
// The top-up page on anetix.ai is behind the wall (2026-09-25): it opens only for a link that carries a token the
// www service can check with the key both services hold. "<exp>.<mac>", exp in unix seconds rounded to the day (so
// the link on the board stays the same all day) and 31 days out; the mac is HMAC-SHA256 over "credit:<slug>:<exp>"
// under SOS_WWW_KEY, base64url, 32 characters. No key (or too short): no token, and the page stays shut. Pure but
// for the clock and the key; www/server.js has the same few lines to check it.
function creditToken(slug, now = Date.now(), key = process.env.SOS_WWW_KEY || "") {
  if (key.length < 16 || !SLUG.test(String(slug || ""))) return "";
  const exp = (Math.floor(now / 86400e3) + 31) * 86400;
  return `${exp}.${crypto.createHmac("sha256", key).update(`credit:${slug}:${exp}`).digest("base64url").slice(0, 32)}`;
}
// An admin's look at anetix.ai as a pin holder sees it (2026-09-25, "View the pin page" on the Pins tab): the same
// kind of key, over "preview:<exp>", good for ten minutes. The www service turns it into a preview cookie; a preview
// can read every page a pin opens but cannot make a company.
function previewToken(now = Date.now(), key = process.env.SOS_WWW_KEY || "") {
  if (key.length < 16) return "";
  const exp = Math.floor(now / 1000) + 600;
  return `${exp}.${crypto.createHmac("sha256", key).update(`preview:${exp}`).digest("base64url").slice(0, 32)}`;
}
function topupUrl(company, now = Date.now()) {
  const t = creditToken(company, now);
  return `${WWW_URL()}/c/${company}/credit${t ? `?t=${t}` : ""}`;
}
// The sign-in form on anetix.ai posts to this product's /login across the origin (server.js). CORS for the www
// service's own addresses only: SOS_WWW_URL and its www. twin. A request from anywhere else gets no CORS headers,
// so a browser will not let that page read the answer (and the preflight gives it nothing to go on).
function wwwOrigins() {
  const out = new Set();
  try { const u = new URL(WWW_URL()); out.add(u.origin); if (!u.hostname.startsWith("www.") && !/^[\d.]+$|^localhost$/.test(u.hostname)) out.add(`${u.protocol}//www.${u.host}`); } catch (e) {}
  return out;
}
function loginCors(req, res, next) {
  const o = String(req.headers.origin || "");
  const ok = o && wwwOrigins().has(o);
  if (ok) res.set({ "Access-Control-Allow-Origin": o, "Access-Control-Allow-Credentials": "true", Vary: "Origin" });
  if (req.method !== "OPTIONS") return next();
  if (ok) res.set({ "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "600" });
  res.status(204).end();
}

// null for a company that is not self-serve; otherwise the balance, with the top-up page's address.
async function credit(company) {
  const ss = await selfServeRow(company); if (!ss) return null;
  // a site back to a demo (stage 4, src/billing.js) counts its credit from that moment, both sides: the ledger rows and
  // the spend, so it starts at 0% and the old demo's spend is never handed back as credit
  const since = ss.credit_since || ss.created_at;
  const bought = Number((await q("SELECT COALESCE(SUM(delta_usd),0) AS usd FROM platform.credit_ledger WHERE company=$1 AND ($2::timestamptz IS NULL OR created_at >= $2)", [company, ss.credit_since || null])).rows[0].usd || 0);
  const spent = await spentSince(company, since);
  return { ...balanceOf({ credit_usd: bought, spent_usd: spent }), topup_url: topupUrl(company), since: ss.created_at, email: ss.email, contact: ss.contact };
}
// The gate every AI run passes through (called from agent.assertUnderCap). Throws for a self-serve company with
// nothing left; does nothing for any other company. opts.started: the call is part of work that already passed
// the gate when it began (a build run, a module creation), so it goes through: "a build already started always
// finishes even if credit runs out" (Brendan, 2026-09-26). The balance can then go below zero; the next refill
// writes that off (addCredit), so the person never pays for it.
// Stage 3 (docs/PAID-SITES.md "The rollover"): a SUBSCRIBED site has no credit gate at all. Its limit is the fair-use
// line instead (src/fairuse.js), checked here because this is the one gate every start passes: four starts call it
// directly and never pass agent.assertUnderCap. While the Terms are switched on (src/agreements.js), a demo whose
// manager has not agreed to them starts nothing new until they tick the box on the board.
// For a subscribed site the options mean (docs/PAID-SITES.md "What already started covers"):
//   started   the same run carrying on: it finishes, one run per tool at most
//   fairUse   a start that is new to the manager although the platform calls it started (a build confirmed later, a
//             queued run when it actually starts, an intake round or design asked for later): checked
//   runtime   the floor's own tools asking the AI (ctx.ai.chat): never stopped at the line (the order form: "A fair-use
//             pause does not stop the Site's tools")
async function siteStage(company) { return ((await q("SELECT stage FROM platform.sites WHERE company=$1", [company])).rows[0] || {}).stage || null; }
async function assertCredit(company, opts = {}) {
  if (!company) return;
  if ((await siteStage(company)) === "subscribed") {
    if (opts.runtime || (opts.started && !opts.fairUse)) return;
    // stage 4 (src/billing.js): Stripe's retries ran out (unpaid), or Stripe ended the subscription for a failed payment
    // (the account's dunning set to cancel), so new AI work pauses; the tools, and AI inside them, never do
    const standing = ((await q("SELECT standing FROM platform.sites WHERE company=$1", [company])).rows[0] || {}).standing;
    if (standing === "unpaid") throw Object.assign(new Error("Payment for this site is overdue, so new AI work is paused until it is paid. Your tools keep running. Update the card under Settings, Manage billing."), { status: 402, code: "unpaid" });
    if (standing === "canceled_at_stripe") throw Object.assign(new Error("This site's subscription lapsed after its payments failed, so new AI work is paused. Your tools keep running. Write to brendan@anetix.ai or taylor@anetix.ai."), { status: 402, code: "lapsed" });
    return require("./fairuse").assertUnder(company);
  }
  if (opts.started) return;
  if (await require("./agreements").needsAcceptance(company)) throw new Error("Anetix's Terms of Service need the manager's agreement first: tick the box at the top of the board to keep building.");
  const c = await credit(company); if (!c) return;
  if (c.balance_usd <= 0) throw new Error(`this company's AI credit is used up. Add credit at ${c.topup_url} to keep going.`);
}

// ---- writes ------------------------------------------------------------------------------------------------------
async function makePinRow({ label, max_uses, days, email }, by) {
  label = clean(label, 80); if (label.length < 2) throw fail(400, "say who the pin is for");
  const accounts = require("./accounts");
  email = accounts.cleanLogin(email);
  if (!accounts.validLogin(email)) throw fail(400, "give the email of the person the pin is for: it only works with that email");
  const uses = Math.max(1, Math.min(50, Number(max_uses) || 1));
  const d = days == null || days === "" ? 30 : Number(days);
  if (!Number.isFinite(d) || d < 0 || d > 3650) throw fail(400, "days: 0 for no expiry, or up to 3650");
  for (let i = 0; i < 5; i++) {
    const pin = makePin();
    try {
      const row = (await q("INSERT INTO platform.access_pins (pin, label, max_uses, expires_at, created_by, email) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
        [pin, label, uses, d ? new Date(Date.now() + d * 86400000) : null, by || null, email])).rows[0];
      await logEvent("pin_made", String(row.id), { label, email, max_uses: uses, days: d, by });
      return row;
    } catch (e) { if (!/access_pins_pin_key/.test(e.message)) throw e; }
  }
  throw fail(500, "could not make a pin");
}
async function revokePin(id, by) {
  const row = (await q("UPDATE platform.access_pins SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL RETURNING *", [Number(id) || 0])).rows[0];
  if (!row) throw fail(404, "no such pin, or already cancelled");
  await logEvent("pin_revoked", String(row.id), { by });
  return row;
}
// A slug nobody has: the name's, then -2, -3...
async function freeSlug(name) {
  const base = slugFrom(name);
  for (let i = 1; i < 100; i++) {
    const s = i === 1 ? base : `${base.slice(0, 30 - String(i).length - 1)}-${i}`;
    if (!SLUG.test(s)) continue;
    if (!(await q("SELECT 1 FROM platform.companies WHERE slug=$1", [s])).rows[0]) return s;
  }
  throw fail(500, "could not find a free company code");
}
// A company from a pin and a payment. Idempotent on ref (the checkout session id): the second call for the same
// payment returns the company it made, without the passwords (they were shown once). The pin's use is spent inside
// the same transaction as the company row, so two landings of one payment cannot spend it twice.
// Stripe's webhook and its success page land the SAME payment within milliseconds of each other (seen in the test
// run: the second one found the pin spent and reported a failure while the first had made the company), so the
// whole thing runs under a lock on the payment's ref: the second caller waits, then finds the ledger row.
// password: the one the person chose on anetix.ai (the demo workflow): their account gets it and the handout carries
// only the floor password. Without one the platform makes one up and hands it out once, as before. demo: the board
// shows the rolling DEMO banner. paid_usd 0: the first credit is a grant from us, not a purchase.
async function createCompany({ pin, name, contact, email, ref, paid_usd, credit_usd, password, demo = false, terms: agreed = null, ip = null, net = null, ua = null }) {
  ref = clean(ref, 200); if (!ref) throw fail(400, "ref (the payment) is required");
  const existing = async (c) => {
    const had = (await c.query("SELECT company FROM platform.credit_ledger WHERE ref=$1", [ref])).rows[0];
    if (!had) return null;
    const co = (await c.query("SELECT slug, name FROM platform.companies WHERE slug=$1", [had.company])).rows[0];
    return { created: false, company: co, passwords: null, credit: await credit(had.company) };
  };
  const already = await existing({ query: q }); if (already) return already;   // the plain case: a reload of the success page
  name = clean(name, 80); if (name.length < 2) throw fail(400, "the company needs a name");
  const usd = money(credit_usd); if (!(usd > 0)) throw fail(400, "credit_usd must be more than zero");
  const auth = require("./auth");
  const { upsertDoc } = require("./db");
  const row = await pinRow(pin);
  const why = pinProblem(row) || pinEmailProblem(row, email); if (why) throw fail(403, why);
  if (password != null && password !== "") { const pw = require("./accounts").passwordProblem(String(password)); if (pw) throw fail(400, pw.charAt(0).toUpperCase() + pw.slice(1) + "."); }
  const chosen = password != null && password !== "";
  // the Terms (src/agreements.js): while switched on, a demo is set up only with the box above "Make my demo" ticked,
  // over the version and words the page showed; the acceptance is written with the company, in one transaction
  const agreements = require("./agreements");
  const termsOn = await agreements.isLive();
  if (termsOn) {
    if (!agreed || agreed.agreed !== true) throw Object.assign(fail(400, "Tick the box to agree to the Terms of Service."), { code: "terms_needed" });
    if (!agreements.sameTerms(agreed.version, agreed.sha)) throw Object.assign(fail(409, "The Terms of Service changed while this page was open. Look at them again and tick the box."), { code: "terms_changed" });
  }
  let slug = await freeSlug(name);
  const floor = demo ? null : auth.generatePassword();   // a personal demo is one person on one manager account: no floor
  const mgrPassword = chosen ? String(password) : require("./accounts").makePassword();
  // the manager's account: the checkout email as the login; a person who already has an account (a second company
  // on the same email) gets "<local>+<slug>@<domain>", so a payment that went through never fails here
  const accounts = require("./accounts");
  let login = accounts.cleanLogin(email);
  if (!accounts.validLogin(login)) throw fail(400, "the email address does not look like one");
  if (await (async () => (await q("SELECT 1 FROM platform.accounts WHERE login=$1", [login])).rows[0])()) login = login.replace(/@/, `+${slug}@`);
  // one transaction: the pin's use, the company, its self_serve row and the first ledger row stand or fall together
  const client = await require("./db").pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`selfserve:${ref}`]);
    const done = await existing(client);
    if (done) { await client.query("COMMIT"); return done; }
    const spent = (await client.query(
      "UPDATE platform.access_pins SET uses=uses+1 WHERE id=$1 AND revoked_at IS NULL AND uses < max_uses AND (expires_at IS NULL OR expires_at > now()) RETURNING id", [row.id])).rows[0];
    if (!spent) throw fail(403, pinProblem((await client.query("SELECT * FROM platform.access_pins WHERE id=$1", [row.id])).rows[0]) || PIN_WORDS.used);
    if ((await client.query("SELECT 1 FROM platform.companies WHERE slug=$1", [slug])).rows[0]) slug = await freeSlug(name);   // taken in the meantime
    await client.query("INSERT INTO platform.companies (slug, name, demo) VALUES ($1,$2,$3)", [slug, name, Boolean(demo)]);
    // the handout (the floor password, the manager's login and first password) is committed WITH the company, so a
    // browser that collects it the instant the row exists finds it (the webhook's transaction and the page's race)
    let handout = null;
    if (floor || !chosen) try { handout = require("./connections").encrypt({ floor, manager: chosen ? { login } : { login, password: mgrPassword } }); } catch (e) { console.error(`[selfserve] ${slug}: the handout cannot be kept (${e.message}); the passwords are only in this answer`); }
    await client.query("INSERT INTO platform.self_serve (company, pin_id, email, contact, handout_enc) VALUES ($1,$2,$3,$4,$5)", [slug, row.id, clean(email, 200) || null, clean(contact, 120) || null, handout]);
    const paid = money(paid_usd);
    await client.query("INSERT INTO platform.credit_ledger (company, delta_usd, kind, ref, paid_usd, note, made_by) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [slug, usd, paid > 0 ? "purchase" : "grant", ref, paid || null, paid > 0 ? "first purchase from anetix.ai" : "demo credit from anetix.ai", paid > 0 ? null : "anetix.ai"]);
    if (termsOn) await agreements.record(client, { company: slug, kind: "demo_setup", words: require("./terms").WORDS.demo(), who: { email: clean(email, 200), name: clean(contact, 120) }, ip, net, ua, ref });
    await client.query("COMMIT");
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
  finally { client.release(); }
  if (floor) await auth.setPasswords(slug, { floor });   // the floor's shared password; no manager password on purpose
  else await auth.accountsOnly(slug);                   // a demo: the manager account is the only way in
  const made = await accounts.create({ login, display_name: clean(contact, 80) || login, role: "manager", company: slug, password: mgrPassword }, "anetix.ai", null);
  await upsertDoc(slug, null, "COMPANY.md", `# ${name}\n\nWhat the agents should know about this company: what it makes, who is on the floor, what matters most (safety, throughput, quality), vocabulary the floor uses, anything to avoid.\n`, "repo", true);
  await logEvent("company_created", slug, { name, self_serve: true, demo: Boolean(demo), pin: row.id, ref, credit_usd: usd, paid_usd: money(paid_usd), manager_account: made.account.id, chose_password: chosen });
  return { created: true, company: { slug, name }, passwords: floor ? { floor } : null, manager: chosen ? { login: made.account.login } : { login: made.account.login, password: mgrPassword }, credit: await credit(slug) };
}
// The passwords a new company's person has not seen yet: handed out once, then gone. null when already collected.
async function collectHandout(slug) {
  // RETURNING on an UPDATE gives the NEW value, so the old one is read in a CTE first (found the hard way, 2026-09-25)
  const row = (await q(`WITH old AS (SELECT handout_enc FROM platform.self_serve WHERE company=$1 AND handout_enc IS NOT NULL FOR UPDATE)
                        UPDATE platform.self_serve s SET handout_enc=NULL FROM old WHERE s.company=$1 RETURNING old.handout_enc`, [slug])).rows[0];
  if (!row) return null;
  try { return require("./connections").decrypt(row.handout_enc); } catch (e) { return null; }
}
// The manager accounts of a self-serve company, as the www service and the admin card read them: login and whether
// the authenticator is set up, never anything secret.
async function managers(slug) {
  return (await require("./accounts").managersOf(slug)).map((a) => ({ id: a.id, login: a.login, name: a.display_name, enrolled: a.enrolled, status: a.status, last_sign_in: a.last_sign_in }));
}
// More credit for a company that exists. Idempotent on ref.
async function addCredit({ slug, ref, paid_usd, credit_usd, kind = "purchase", note, by }) {
  slug = String(slug || "").toLowerCase();
  const co = (await q("SELECT slug, name FROM platform.companies WHERE slug=$1", [slug])).rows[0];
  if (!co) throw fail(404, "no such company");
  const usd = money(credit_usd);
  if (kind === "purchase") {
    ref = clean(ref, 200); if (!ref) throw fail(400, "ref (the payment) is required");
    // a payment credited before is only ever answered "already done", whatever the site is now: the refund below is
    // for a payment that was never credited (found by the review of 2026-09-26: a demo's old top-up, its success page
    // reopened after going live, was refunded although its credit had been used and had come off the first bill)
    if ((await q("SELECT 1 FROM platform.credit_ledger WHERE ref=$1", [ref])).rows[0]) return { added: false, company: co, credit: await credit(slug) };
    // a site switching on or subscribed has no credit to buy (stage 3): the unused credit was worked out when Activate
    // started, so a refill now would be neither on the first bill nor usable. Answered "subscribed", and anetix.ai
    // refunds the payment on the spot (www/server.js fulfil).
    if (["activating", "subscribed"].includes(await siteStage(slug))) throw Object.assign(fail(409, `${co.name} is a subscribed site, so it has no AI credit to add.`), { code: "subscribed" });
    if (!(usd > 0)) throw fail(400, "credit_usd must be more than zero");
  } else {
    ref = null;
    if (!usd) throw fail(400, "give a dollar amount");
  }
  // a build that finished after the credit ran out left the balance under zero: that overrun is on Anetix, so a
  // refill starts from zero, never from a debt (5% left plus a refill still reads 105%; -8% plus a refill reads 100%)
  const before = usd > 0 ? await credit(slug) : null;
  const overrun = before && before.balance_usd < 0 ? money(-before.balance_usd) : 0;
  const client = await require("./db").pool.connect();
  try {
    await client.query("BEGIN");
    if (ref) {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`selfserve:${ref}`]);   // the webhook and the page, the same payment (see createCompany)
      if ((await client.query("SELECT 1 FROM platform.credit_ledger WHERE ref=$1", [ref])).rows[0]) { await client.query("COMMIT"); return { added: false, company: co, credit: await credit(slug) }; }
    }
    if (overrun > 0) await client.query("INSERT INTO platform.credit_ledger (company, delta_usd, kind, ref, paid_usd, note, made_by) VALUES ($1,$2,'adjust',NULL,NULL,$3,'platform')",
      [slug, overrun, "overrun written off: a build that was already running finished after the credit ran out"]);
    // a grant to a company that was not self-serve makes it one from now: its spend counts from this moment
    await client.query("INSERT INTO platform.self_serve (company) VALUES ($1) ON CONFLICT (company) DO NOTHING", [slug]);
    await client.query("INSERT INTO platform.credit_ledger (company, delta_usd, kind, ref, paid_usd, note, made_by) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [slug, usd, kind, ref, kind === "purchase" ? money(paid_usd) || null : null, clean(note, 200) || (kind === "purchase" ? "top-up from anetix.ai" : null), by || null]);
    await client.query("COMMIT");
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
  finally { client.release(); }
  await logEvent("credit_added", slug, { kind, usd, paid_usd: money(paid_usd) || null, ref, by, ...(overrun ? { overrun_written_off: overrun } : {}) });
  return { added: true, company: co, credit: await credit(slug) };
}
async function ledger(slug) {
  return (await q("SELECT id, delta_usd, kind, ref, paid_usd, note, made_by, created_at FROM platform.credit_ledger WHERE company=$1 ORDER BY id DESC", [slug])).rows
    .map((r) => ({ ...r, delta_usd: Number(r.delta_usd), paid_usd: r.paid_usd == null ? null : Number(r.paid_usd) }));
}
// Every pin and every self-serve company, for the admin page.
async function adminView() {
  const pins = (await q("SELECT p.*, (SELECT string_agg(s.company, ', ') FROM platform.self_serve s WHERE s.pin_id=p.id) AS companies FROM platform.access_pins p ORDER BY p.id DESC")).rows
    .map((p) => ({ ...p, shown: showPin(p.pin), problem: PIN_SHORT[pinReason(p)] || null }));
  // the last 30 days of refusals, newest first (the launch audit 0.3)
  const refusals = (await q(`SELECT r.id, r.pin, r.pin_id, r.email, r.reason, r.where_from, r.ip, r.count, r.first_at, r.last_at, p.label
      FROM platform.pin_refusals r LEFT JOIN platform.access_pins p ON p.id=r.pin_id
     WHERE r.last_at > now() - interval '30 days' ORDER BY r.last_at DESC LIMIT 60`)).rows
    .map((r) => ({ ...r, shown: r.pin && r.pin.length === 8 ? showPin(r.pin) : r.pin, why: PIN_SHORT[r.reason] || r.reason }));
  const ss = (await q("SELECT s.*, c.name FROM platform.self_serve s JOIN platform.companies c ON c.slug=s.company ORDER BY s.created_at DESC")).rows;
  const companies = [];
  for (const s of ss) companies.push({ slug: s.company, name: s.name, email: s.email, contact: s.contact, since: s.created_at, ...(await credit(s.company)) });
  return { pins, companies, refusals, www_url: WWW_URL() };
}
// gone with the company (src/feedback.js, the delete route)
async function deleteCompany(slug) {
  // the person's own traces on anetix.ai go with the demo (the launch audit, C9): the demo request the pin was made
  // from, and the pin itself when no other company came in on it. Acceptances of the Terms stay (src/agreements.js).
  const pin = ((await q("SELECT pin_id FROM platform.self_serve WHERE company=$1", [slug])).rows[0] || {}).pin_id;
  if (pin) {
    await q("DELETE FROM platform.demo_requests WHERE pin_id=$1", [pin]);
    await q("DELETE FROM platform.access_pins p WHERE p.id=$1 AND NOT EXISTS (SELECT 1 FROM platform.self_serve s WHERE s.pin_id=p.id AND s.company<>$2)", [pin, slug]);
    await q("DELETE FROM platform.pin_refusals r WHERE r.pin_id=$1 AND NOT EXISTS (SELECT 1 FROM platform.access_pins p WHERE p.id=r.pin_id)", [pin]);
  }
  await q("DELETE FROM platform.credit_ledger WHERE company=$1", [slug]);
  await q("DELETE FROM platform.self_serve WHERE company=$1", [slug]);
  await q("DELETE FROM platform.accounts WHERE role='manager' AND company=$1", [slug]);   // its manager accounts; factors, codes and devices cascade
}

// ---- routes for the www service: before the session middleware, opened by the shared key ---------------------------
const json = express.json({ limit: "50kb" });
const guard = (fn) => async (req, res) => { try { await fn(req, res); } catch (e) { res.status(e.status || 400).json({ error: e.message, code: e.code }); } };
function keyOk(req) {
  const want = process.env.SOS_WWW_KEY || "";
  const got = String(req.headers["x-sos-www-key"] || "");
  if (want.length < 16) return false;   // unset or too short: the door is closed, whatever is sent
  const a = Buffer.from(got), b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const wwwRouter = express.Router();
wwwRouter.use("/api/www", (req, res, next) => {
  if (!keyOk(req)) return res.status(401).json({ error: "www key required" });
  res.set("Cache-Control", "no-store");
  next();
});
wwwRouter.post("/api/www/pin", json, guard(async (req, res) => {
  const b = req.body || {};
  const row = await pinRow(b.pin);
  const no = await refusalFor(row, b.email);
  if (no) { await logRefusal({ pin: b.pin, row, email: b.email, reason: no.reason, where: b.where || "pin", ip: b.ip }); return res.status(403).json({ ok: false, ...no }); }
  res.json({ ok: true, label: row.label, uses_left: Number(row.max_uses) - Number(row.uses) });
}));
wwwRouter.post("/api/www/companies", json, guard(async (req, res) => {
  const b = req.body || {};
  const r = await createCompany(b);
  if (b.collect) {   // the person's browser: the handout, once
    const h = await collectHandout(r.company.slug);
    if (h) { r.passwords = { floor: h.floor }; r.manager = h.manager; r.collected = true; }
    else if (!r.created) { r.passwords = null; r.manager = null; }
  } else if (r.created) { r.passwords = null; r.manager = null; r.kept = true; }   // not a browser (the webhook): the handout stays for the person
  const ms = await managers(r.company.slug);
  const login = r.manager ? r.manager.login : ms.length ? ms[0].login : null;
  res.json({ ok: true, ...r, managers: ms, login_url: `/login?next=${encodeURIComponent(`/c/${r.company.slug}/`)}${login ? `&account=${encodeURIComponent(login)}` : ""}`, floor_login_url: `/login?next=${encodeURIComponent(`/c/${r.company.slug}/`)}` });
}));
// Before the checkout: does this pin still work, and is the email one an account can be made for.
wwwRouter.post("/api/www/check", json, guard(async (req, res) => {
  const b = req.body || {};
  const row = await pinRow(b.pin);
  const no = await refusalFor(row, b.email);
  if (no) { await logRefusal({ pin: b.pin, row, email: b.email, reason: no.reason, where: "check", ip: b.ip }); return res.status(403).json({ ok: false, ...no }); }
  const accounts = require("./accounts");
  const login = accounts.cleanLogin(b.email);
  if (b.email != null && !accounts.validLogin(login)) return res.status(400).json({ ok: false, error: "That email address does not look like one." });
  res.json({ ok: true, label: row.label, email_in_use: Boolean(login && (await q("SELECT 1 FROM platform.accounts WHERE login=$1", [login])).rows[0]) });
}));
wwwRouter.post("/api/www/credit", json, guard(async (req, res) => {
  const b = req.body || {};
  res.json({ ok: true, ...(await addCredit({ slug: b.slug, ref: b.ref, paid_usd: b.paid_usd, credit_usd: b.credit_usd, kind: "purchase" })) });
}));
wwwRouter.get("/api/www/companies/:slug", guard(async (req, res) => {
  const slug = String(req.params.slug || "").toLowerCase();
  const co = SLUG.test(slug) ? (await q("SELECT slug, name FROM platform.companies WHERE slug=$1", [slug])).rows[0] : null;
  if (!co) return res.status(404).json({ error: "no such company" });
  const stage = await siteStage(slug);
  const paying = ["activating", "subscribed"].includes(stage);   // no credit to buy from the moment Activate starts
  res.json({ ok: true, company: co, credit: paying ? null : await credit(slug), managers: await managers(slug), stage: stage || "demo", subscribed: paying });
}));

// ---- admin routes: with the platform router, an admin session ------------------------------------------------------
const adminRouter = express.Router();
const requireAdmin = (req, res, next) => require("./auth").requireAdmin(req, res, next);
const who = (req) => (req.sosAccount && (req.sosAccount.name || req.sosAccount.login)) || "admin";
adminRouter.get("/api/admin/www-preview", requireAdmin, guard(async (_req, res) => {
  const t = previewToken();
  if (!t) return res.status(409).json({ error: "SOS_WWW_KEY is not set on this instance, so anetix.ai cannot be opened from here" });
  res.set("Cache-Control", "no-store").json({ ok: true, url: `${WWW_URL()}/preview?t=${t}` });
}));
adminRouter.get("/api/admin/pins", requireAdmin, guard(async (_req, res) => res.set("Cache-Control", "no-store").json(await adminView())));
adminRouter.post("/api/admin/pins", requireAdmin, json, guard(async (req, res) => {
  const row = await makePinRow(req.body || {}, who(req));
  res.json({ ok: true, pin: { ...row, shown: showPin(row.pin) } });
}));
adminRouter.post("/api/admin/pins/:id(\\d{1,9})/revoke", requireAdmin, guard(async (req, res) => res.json({ ok: true, pin: await revokePin(req.params.id, who(req)) })));
adminRouter.get("/api/admin/companies/:slug/credit", requireAdmin, guard(async (req, res) => {
  const slug = String(req.params.slug || "").toLowerCase();
  res.set("Cache-Control", "no-store").json({ credit: await credit(slug), ledger: await ledger(slug) });
}));
adminRouter.post("/api/admin/companies/:slug/credit", requireAdmin, json, guard(async (req, res) => {
  const b = req.body || {};
  const usd = Number(b.usd);
  if (!Number.isFinite(usd) || usd === 0 || Math.abs(usd) > 10000) throw fail(400, "give a dollar amount (negative takes credit back)");
  res.json({ ok: true, ...(await addCredit({ slug: req.params.slug, credit_usd: usd, kind: usd < 0 ? "adjust" : "grant", note: b.note, by: who(req) })) });
}));

module.exports = {
  init, SCHEMA, makePin, normalizePin, showPin, pinProblem, slugFrom, balanceOf, WWW_URL, keyOk,
  creditToken, previewToken, topupUrl, wwwOrigins, loginCors,
  pinEmailProblem, pinReason, PIN_WORDS, PIN_SHORT, refusalFor, logRefusal,
  pinRow, selfServeRow, spentSince, credit, assertCredit, siteStage, makePinRow, revokePin, freeSlug, createCompany, addCredit, ledger, adminView, deleteCompany, managers, collectHandout,
  wwwRouter, adminRouter, keyOk,
};
