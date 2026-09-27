// Acceptances of the Terms of Service (2026-09-26; Brendan's Terms sections 1.2 and 21.9, docs/PAID-SITES.md stage 3):
// who agreed, to which version, over which words, when and from where. Four ways in:
//   order       the signature on a site's order form (src/golive.js sign), one row per customer order
//   demo_setup  the tick box above "Make my demo" on anetix.ai (src/selfserve.js createCompany)
//   topup       the tick box above a refill on anetix.ai's top-up page, before Stripe. Brendan's screen text put this in
//               Stripe's own Checkout box; Stripe shows that box only once the Terms URL is in the account's public
//               details, and with /terms behind the wall its record would be Stripe's word "accepted". A box on
//               anetix.ai's own page keeps the same record as every other acceptance: the words, the version, the
//               hash, the address.
//   board       once, on the board of a demo made before the Terms were switched on (the manager's own tick)
// Every row keeps the version and the SHA-256 of the Terms' words; the words themselves are kept once per version
// (platform.terms_versions, at the first acceptance). Rows are kept after a company is deleted (the Terms, 10.7:
// "records of acceptance"), marked gone_at, so a new company that gets the same slug has agreed to nothing.
//
// THE SWITCH. platform.settings terms_live, off until Brendan switches it on from the Sites tab once counsel has
// approved the Terms. Off: demo set-up and top-ups ask nothing, as before, and no board asks. On: both need the tick
// box, a demo's manager who has not agreed sees the box on the board, and a demo that has not agreed starts no new AI
// work (src/selfserve.js assertCredit). Go live's sign step asks either way: the order form names the version.
//
// Routes:
//   anetix.ai, the shared key:  GET  /api/www/terms/state     the switch, the version and hash to send back, the words
//                               POST /api/www/terms/accept    { slug, kind: "topup", version, sha, ip, net, ua }
//   admin:                      GET|POST /api/admin/terms     the switch, what counsel has left in brackets, who waits
//   manager:                    POST /api/c/:slug/terms/accept { version, sha, agreed }   the board's box
const crypto = require("crypto");
const express = require("express");
const { q, logEvent, getSetting, setSetting } = require("./db");
const terms = require("./terms");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS platform.acceptances (
  id             BIGSERIAL PRIMARY KEY,
  company        TEXT NOT NULL,                  -- the slug at the time
  site_id        UUID,                           -- the site's permanent id, for an order
  kind           TEXT NOT NULL,                  -- order | demo_setup | topup | board
  terms_version  TEXT NOT NULL,
  terms_sha256   TEXT NOT NULL,
  words          TEXT,                           -- the words beside the tick box, as shown
  who            JSONB,                          -- { email, name, title, account, role }
  ip             TEXT,
  net            JSONB,                          -- the evidence behind ip, when anetix.ai saw the request
  ua             TEXT,
  ref            TEXT,                           -- the order, or the company's first payment
  at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  gone_at        TIMESTAMPTZ                     -- the company was deleted; the record stays
);
CREATE INDEX IF NOT EXISTS acceptances_company ON platform.acceptances (company) WHERE gone_at IS NULL;
CREATE TABLE IF NOT EXISTS platform.terms_versions (
  version          TEXT PRIMARY KEY,
  sha256           TEXT NOT NULL,
  doc              JSONB NOT NULL,
  first_signed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);`;
async function init() { await q(SCHEMA); }

const KINDS = ["order", "demo_setup", "topup", "board"];
const SLUG = /^[a-z0-9][a-z0-9-]{1,40}$/;
const fail = (status, msg, extra) => Object.assign(new Error(msg), { status }, extra || {});
const clean = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
function same(a, b) { const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || "")); return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y); }
const WWW = () => require("./selfserve").WWW_URL();

async function isLive() { return (await getSetting("terms_live", "0")) === "1"; }
async function setLive(on, by) {
  await setSetting("terms_live", on ? "1" : "0");
  await logEvent(on ? "terms_live" : "terms_off", null, { version: terms.TERMS_VERSION, by: by || null });
  return status();
}

// The words of the version being accepted, kept the first time anyone accepts under it; after that an acceptance
// under the same version must be over the same words (a version always means one text). -> the hash
async function keepVersion(db) {
  const doc = terms.termsDoc(), sha = terms.termsHash();
  await db.query("INSERT INTO platform.terms_versions (version, sha256, doc) VALUES ($1,$2,$3) ON CONFLICT (version) DO NOTHING", [doc.version, sha, JSON.stringify(doc)]);
  const kept = (await db.query("SELECT sha256 FROM platform.terms_versions WHERE version=$1", [doc.version])).rows[0];
  if (!kept || kept.sha256 !== sha) {
    console.error(`[terms] the words changed under version ${doc.version} without a new version: acceptance refused until TERMS_VERSION moves on`);
    throw fail(503, "Signing is paused for a moment while Anetix updates its terms. Try again later.", { code: "terms" });
  }
  return sha;
}
// A page's version and hash (sent back with the tick) against the Terms in force now. Pure but for the Terms.
function sameTerms(version, sha) { return String(version || "") === terms.TERMS_VERSION && same(sha, terms.termsHash()); }

// One acceptance, in the caller's transaction (db: a pool client or { query: q }).
async function record(db, { company, site_id = null, kind, words, who = null, ip = null, net = null, ua = null, ref = null }) {
  if (!KINDS.includes(kind)) throw new Error(`no acceptance of kind ${kind}`);
  const sha = await keepVersion(db);
  const netOut = net && typeof net === "object" ? Object.fromEntries(["cf", "real", "xff", "peer"].filter((k) => net[k]).map((k) => [k, clean(net[k], 200)])) : null;
  await db.query(`INSERT INTO platform.acceptances (company, site_id, kind, terms_version, terms_sha256, words, who, ip, net, ua, ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [company, site_id, kind, terms.TERMS_VERSION, sha, clean(words, 2000) || null, who ? JSON.stringify(who) : null, clean(ip, 64) || null,
      netOut && Object.keys(netOut).length ? JSON.stringify(netOut) : null, clean(ua, 300) || null, ref ? clean(ref, 200) : null]);
}
// Has someone who can be named agreed for this company: its manager at demo set-up or on the board, or a signer of its
// order form? A refill's box is kept as the record of that purchase and does not count here: the top-up link does not
// say who is paying (an admin can open it from the customer's board), so it never lifts the board's box.
const IDENTIFIED = ["demo_setup", "board", "order"];
async function hasAccepted(company) {
  return Boolean((await q("SELECT 1 FROM platform.acceptances WHERE company=$1 AND gone_at IS NULL AND kind = ANY($2) LIMIT 1", [company, IDENTIFIED])).rows[0]);
}
// Must this company's manager agree before new AI work starts? While the switch is on: a company that came in from
// anetix.ai (it runs on credit), is not a paying site (a site agreed on its order form), and has no acceptance.
async function needsAcceptance(company) {
  if (!company || !(await isLive())) return false;
  if (!(await q("SELECT 1 FROM platform.self_serve WHERE company=$1", [company])).rows[0]) return false;
  const site = (await q("SELECT stage FROM platform.sites WHERE company=$1", [company])).rows[0];
  if (site && ["activating", "subscribed"].includes(site.stage)) return false;
  return !(await hasAccepted(company));
}
// A deleted company: its acceptances stay on record and stop counting.
async function forget(company) { await q("UPDATE platform.acceptances SET gone_at=now() WHERE company=$1 AND gone_at IS NULL", [company]); }

// A link to the Terms on anetix.ai that opens without a pin (the wall stays, Brendan 2026-09-26): HMAC-SHA256 over
// "terms:<exp>" under SOS_WWW_KEY, 32 characters of base64url, exp in unix seconds rounded to the day and 31 days out,
// so the board's link is the same all day. anetix.ai checks it (www/server.js termsTokenOk). "" without a key.
function termsToken(now = Date.now(), key = process.env.SOS_WWW_KEY || "") {
  if (key.length < 16) return "";
  const exp = (Math.floor(now / 86400e3) + 31) * 86400;
  return `${exp}.${crypto.createHmac("sha256", key).update(`terms:${exp}`).digest("base64url").slice(0, 32)}`;
}
function termsLink(version) { const k = termsToken(); return `${WWW()}/terms${version ? `/${encodeURIComponent(version)}` : ""}${k ? `?k=${k}` : ""}`; }

// What a page needs to ask: the switch, the version and hash to send back, the words beside each box.
async function state() {
  return { live: await isLive(), version: terms.TERMS_VERSION, sha: terms.termsHash(), draft: terms.DRAFT, url: `${WWW()}/terms`,
    words: { demo: terms.WORDS.demo(), topup: terms.WORDS.topup() } };
}
// The board: the box a demo's manager has to tick, or null. An admin looking sees that it waits, and cannot tick it.
async function forBoard(co, role) {
  if (!co || !["manager", "admin"].includes(role) || !(await needsAcceptance(co.slug))) return null;
  return { needed: true, admin: role === "admin", version: terms.TERMS_VERSION, sha: terms.termsHash(), url: termsLink(), words: terms.WORDS.board(co.name), draft: terms.DRAFT };
}
async function acceptOnBoard(req, slug, body = {}) {
  slug = String(slug || "").toLowerCase();
  if (req.sosRole !== "manager") throw fail(403, "Only the company's own manager can agree to the Terms for it.");
  const co = SLUG.test(slug) ? (await q("SELECT slug, name FROM platform.companies WHERE slug=$1", [slug])).rows[0] : null;
  if (!co) throw fail(404, "no such company");
  if (body.agreed !== true) throw fail(400, "Tick the box to agree to the Terms of Service.", { code: "invalid" });
  if (!sameTerms(body.version, body.sha)) throw fail(409, "The Terms changed since this page was opened. Look at them again.", { code: "terms_changed" });
  const a = req.sosAccount || {};
  await record({ query: q }, { company: co.slug, kind: "board", words: terms.WORDS.board(co.name),
    who: { email: a.login || null, name: a.name || null, account: a.id || null, role: "manager" },
    ip: require("./edge").clientIp(req), ua: req.headers["user-agent"] || null });
  await logEvent("terms_accepted", co.slug, { kind: "board", version: terms.TERMS_VERSION, account: a.id || null });
  return { ok: true, accepted: true };
}
// A refill on anetix.ai: the tick box above it, recorded before Stripe opens.
async function acceptTopup(b = {}) {
  const slug = String(b.slug || "").toLowerCase();
  const co = SLUG.test(slug) ? (await q("SELECT slug, name FROM platform.companies WHERE slug=$1", [slug])).rows[0] : null;
  if (!co) throw fail(404, "no such company");
  if (b.kind !== "topup") throw fail(400, "only a top-up is accepted here");
  if (!sameTerms(b.version, b.sha)) throw fail(409, "The Terms changed while this page was open. Look at them again and tick the box.", { code: "terms_changed" });
  // who: the manager on file, as a hint (the top-up link is the company's, not a person's); ref: the Checkout session
  await record({ query: q }, { company: co.slug, kind: "topup", words: terms.WORDS.topup(), who: b.email ? { email: clean(b.email, 200), as: "the company's manager on file" } : null, ip: b.ip, net: b.net, ua: b.ua, ref: b.ref || null });
  await logEvent("terms_accepted", co.slug, { kind: "topup", version: terms.TERMS_VERSION });
  return { ok: true };
}

// The Sites tab's switch: on or off, the version, what counsel has left in brackets, and the demos that would have to
// agree on their boards the moment it goes on.
async function status() {
  const waiting = (await q(`SELECT count(*)::int AS n FROM platform.self_serve s
      LEFT JOIN platform.sites st ON st.company=s.company
     WHERE (st.stage IS NULL OR st.stage NOT IN ('activating','subscribed'))
       AND NOT EXISTS (SELECT 1 FROM platform.acceptances a WHERE a.company=s.company AND a.gone_at IS NULL AND a.kind = ANY($1))`, [IDENTIFIED])).rows[0].n;
  const kinds = Object.fromEntries((await q("SELECT kind, count(*)::int AS n FROM platform.acceptances WHERE gone_at IS NULL GROUP BY kind")).rows.map((r) => [r.kind, r.n]));
  return { live: await isLive(), version: terms.TERMS_VERSION, draft: terms.DRAFT, sha: terms.termsHash(), placeholders: terms.placeholders(), demos_waiting: waiting, accepted: kinds };
}

// ---- routes -----------------------------------------------------------------------------------------------------------
const json = express.json({ limit: "20kb" });
const guard = (fn) => async (req, res) => {
  try { res.set("Cache-Control", "no-store").json(await fn(req.body || {}, req)); }
  catch (e) { if (!e.status) console.error("[terms]", e.stack || e.message); res.status(e.status || 500).json({ error: e.status ? e.message : "Something went wrong on the platform. Try again in a minute.", code: e.code }); }
};
const wwwRouter = express.Router();
wwwRouter.use("/api/www/terms", (req, res, next) => (require("./selfserve").keyOk(req) ? next() : res.status(401).json({ error: "www key required" })));
wwwRouter.get("/api/www/terms/state", guard(() => state()));
wwwRouter.post("/api/www/terms/accept", json, guard((b) => acceptTopup(b)));

const router = express.Router();
const requireAdmin = (req, res, next) => require("./auth").requireAdmin(req, res, next);
const requireManager = (req, res, next) => require("./auth").requireManager(req, res, next);
const who = (req) => (req.sosAccount ? req.sosAccount.name || req.sosAccount.login : "admin");
router.get("/api/admin/terms", requireAdmin, guard(() => status()));
router.post("/api/admin/terms", requireAdmin, json, guard((b, req) => setLive(b.live === true, who(req))));
router.post("/api/c/:slug/terms/accept", requireManager, json, guard((b, req) => acceptOnBoard(req, req.params.slug, b)));

module.exports = {
  init, SCHEMA, KINDS, isLive, setLive, keepVersion, sameTerms, record, hasAccepted, needsAcceptance, forget,
  termsToken, termsLink, state, forBoard, acceptOnBoard, acceptTopup, status, wwwRouter, router,
};
