// Paid sites, stage 2 (2026-09-26, docs/PAID-SITES.md "Go live: the customer's side"): a demo's manager opens Go live,
// answers four screens on anetix.ai, signs the order form and saves a card. Nothing is charged: the site waits at
// Signed for Brendan's Activate (stage 3). Every Stripe call is the www service's (it holds the key); this module
// keeps the answers, their versions, the signature, and the Stripe ids the www service hands back.
//
// It ships DARK (2026-09-26): platform.settings golive_open stays off until Brendan switches it on from the Sites tab,
// so no customer can sign before Activate exists to keep the 24-hour promise. While it is off the board shows no Go
// live link and a customer's link is refused. An admin's link (the Sites tab, 24 hours) works either way.
//
// PREVIEWS. What an admin's link starts is a preview order (kind preview), kept apart from the customer's: it never
// moves the site's stage, never writes to the site's facts on the Sites tab, never shows on the customer's board or
// page, and saves its card to a Stripe Customer of its own, never the site's. An admin's link can look at a customer's
// order but not change it; a customer's link never sees a preview, and a customer who starts going live while a
// preview is open voids it (its card, if any, is detached on the spot). So Brendan can walk the whole flow on any
// demo, even a real customer's, without leaving anything in their way. Found by the review of 2026-09-26: a preview
// that was a normal order left a real site Signed with his test card on it.
//
// The links. The product signs them with the key both services hold (SOS_WWW_KEY). anetix.ai sends the link back on
// every call, so it is checked every time, together with the site's stage:
//   the manager's   <site id>.<exp>.<kind>.<mac>, mac = HMAC-SHA256 over "golive:<kind>:<slug>:<site id>:<exp>", 32
//                   characters of base64url. kind m: a customer's, 31 days, rounded to the day so the board's link is
//                   the same all day. kind a: an admin's, 24 hours. Bound to the site's permanent id, so a deleted
//                   company's link dies with it even when the next company with the same name gets its slug.
//   the approver's  <exp>.<nonce>.<mac> on /order/<order id>, mac over "order:<order id>:<nonce>:<exp>", 14 days. The
//                   nonce is kept on the order (and checked again under the lock), so naming someone else, or no one,
//                   kills the old link. It opens the same order while it is a draft, the card step while it is signed
//                   without a card, and "your order is in" after that. It never changes who is going live.
//
// The rules that keep an order honest (docs/PAID-SITES.md):
//   one open order per site     a partial unique index on orders (site_id) for draft, signed and activating; every
//                               change to a site's order runs under a lock on its sites row
//   signed is what was shown    every draft has a version; the sign call carries it and the SHA-256 of the text the
//                               signer saw, and is applied only if both still match. The text carries every choice
//                               the terms lean on (the billing email for notices, the learning opt-in).
//   one card per order          the first card saved wins; any other that completes is answered "detach"
//   the signer's own address    anetix.ai passes the signer's address as best it can tell, with the raw evidence
//                               (Cloudflare's header, the edge's, the forwarded chain, the peer), and the browser
//   the terms as signed         the first signature under a terms version keeps that version's words
//                               (platform.terms_versions); a later signature under the same version with other words
//                               is refused, so a version always means one text
// A signed order is kept exactly as signed and never edited: a correction is a new order.
//
// Cards Stripe still holds for an order that will not be activated (the admin's Void, the customer's Withdraw, a
// decline, a deleted company) are listed for removal on the order: orders.stripe.detach_list, every such card, and
// detached_list, the ones removed (stage 2 kept one card in detach_pending with detached_at; still read). The product
// cannot reach Stripe; stage 3's sweep (src/activate.js tidy) removes them over the channel to anetix.ai.
//
// Tables (in the backup): platform.orders, platform.terms_versions; platform.sites gains billing (the billing email
// and address) and stripe_customer (the site's own Customer at Stripe, made at its first signing, one per site so a
// billing portal never shows another site's subscription).
//
// Routes:
//   anetix.ai, the shared key (before the session middleware):
//     POST /api/www/golive/view        { access }                          the site, its stage and its order
//     POST /api/www/golive/save        { access, fields }                  screen 1's answers; starts the draft
//     POST /api/www/golive/approver    { access, approver | clear }        someone else approves (manager only)
//     POST /api/www/golive/sign        { access, version, sha, signer, authority, ip, net, ua }
//     POST /api/www/golive/checkout    { access, stripe_customer, setup_session, replaces? }
//     POST /api/www/golive/start-over  { access }                          void a signed order with no card, redraft
//     POST /api/www/golive/withdraw    { access }                          withdraw a signed order before Activate (5.4)
//     POST /api/www/golive/card        { order, setup_session, stripe_customer, payment_method, card }
//                                                                          a card saved at Stripe (the webhook or the
//                                                                          way back); answers detach when the order
//                                                                          cannot take it
//     GET  /api/www/golive/terms[?version=]                                the Terms of Service (src/terms.js)
//     access: { slug, t } for the manager's link, { order, t } for the approver's
//   admin: GET|POST /api/admin/golive (the switch), GET /api/admin/sites/:slug/golive-link (an admin's link),
//          GET /api/admin/sites/:slug/orders (every order, with the signed text), POST /api/admin/sites/:slug/void-order
//   manager: GET /api/c/:slug/golive (Settings' Go live card); the board carries the same as `golive`
const crypto = require("crypto");
const express = require("express");
const { q, pool, logEvent, getSetting, setSetting } = require("./db");
const sites = require("./sites");
const terms = require("./terms");

const SLUG = /^[a-z0-9][a-z0-9-]{1,40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const OPEN_STATES = ["draft", "signed", "activating"];
const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[A-Za-z]{2,}$/;
const MAX_SESSIONS = 25;   // card steps opened for one order; more is someone pressing Add a card in a loop
const fail = (status, msg, extra) => Object.assign(new Error(msg), { status }, extra || {});
const KEY = () => process.env.SOS_WWW_KEY || "";
const WWW = () => require("./selfserve").WWW_URL();
const termsUrl = () => `${WWW()}/terms`;
const clean = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const mac = (s, key) => crypto.createHmac("sha256", key).update(s).digest("base64url").slice(0, 32);
function same(a, b) { const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || "")); return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y); }
const sentence = (t) => { t = String(t || ""); return t ? t.charAt(0).toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? "" : ".") : t; };
const joinAnd = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

// ---- the links (pure but for the clock and the key) ------------------------------------------------------------------
function goliveToken(slug, site, { kind = "m", now = Date.now(), key = KEY() } = {}) {
  if (key.length < 16 || !SLUG.test(String(slug || "")) || !UUID.test(String(site || "")) || !["m", "a"].includes(kind)) return "";
  const exp = kind === "a" ? Math.floor(now / 1000) + 86400 : (Math.floor(now / 86400e3) + 31) * 86400;
  return `${site}.${exp}.${kind}.${mac(`golive:${kind}:${slug}:${site}:${exp}`, key)}`;
}
// -> { site, exp, kind } or null
function readGoliveToken(slug, t, { now = Date.now(), key = KEY() } = {}) {
  const m = /^([0-9a-f-]{36})\.(\d{9,11})\.([ma])\.([A-Za-z0-9_-]{32})$/.exec(String(t || ""));
  if (!m || key.length < 16 || !SLUG.test(String(slug || "")) || !UUID.test(m[1]) || Number(m[2]) * 1000 <= now) return null;
  if (!same(m[4], mac(`golive:${m[3]}:${slug}:${m[1]}:${m[2]}`, key))) return null;
  return { site: m[1], exp: Number(m[2]), kind: m[3] };
}
function approverToken(orderId, nonce, exp, key = KEY()) {
  if (key.length < 16 || !UUID.test(String(orderId || "")) || !/^[A-Za-z0-9_-]{11}$/.test(String(nonce || "")) || !Number.isInteger(exp)) return "";
  return `${exp}.${nonce}.${mac(`order:${orderId}:${nonce}:${exp}`, key)}`;
}
// -> { exp, nonce } or null
function readApproverToken(orderId, t, { now = Date.now(), key = KEY() } = {}) {
  const m = /^(\d{9,11})\.([A-Za-z0-9_-]{11})\.([A-Za-z0-9_-]{32})$/.exec(String(t || ""));
  if (!m || key.length < 16 || !UUID.test(String(orderId || "")) || Number(m[1]) * 1000 <= now) return null;
  if (!same(m[3], mac(`order:${orderId}:${m[2]}:${m[1]}`, key))) return null;
  return { exp: Number(m[1]), nonce: m[2] };
}

// ---- the answers (pure) ------------------------------------------------------------------------------------------------
// Screen 1's answers as the order keeps them. Only the keys that are present are cleaned and returned.
//   legal_name, site_name, site_address {line1,line2,city,state,postal_code,country}, headcount, sqft,
//   plant_manager {name,title,email}, contact {is_pm,name,title} (the person going live: "That's me" is is_pm, and the
//   plant manager's name and title are copied in when the manager saves), billing {email, same_as_site, address},
//   integrations (which ERP, or null), hardware (what, or null), learning (the opt-in, true or false)
// -> { facts, problems }
function cleanFacts(body = {}) {
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  const pick = {}; for (const k of ["site_name", "legal_name", "site_address", "plant_manager", "headcount", "sqft"]) if (has(k)) pick[k] = body[k];
  const base = sites.cleanFields(pick);
  const facts = { ...base.fields }, problems = [...base.problems];
  if (has("contact")) {
    const c = body.contact || {};
    facts.contact = c.is_pm ? { is_pm: true, name: "", title: "" } : { is_pm: false, name: clean(c.name, 80), title: clean(c.title, 80) };
  }
  if (has("billing")) {
    const b = body.billing || {};
    const email = clean(b.email, 200).toLowerCase();
    if (email && !EMAIL.test(email)) problems.push("the billing email does not look like one");
    const sameAsSite = b.same_as_site !== false;
    let address = null;
    if (!sameAsSite) { const a = sites.cleanFields({ site_address: b.address || {} }); problems.push(...a.problems.map((p) => `in the billing address, ${p}`)); address = a.fields.site_address || null; }
    facts.billing = { email: email || null, same_as_site: sameAsSite, address };
  }
  if (has("integrations")) facts.integrations = clean(body.integrations, 200) || null;
  if (has("hardware")) facts.hardware = clean(body.hardware, 200) || null;
  if (has("learning")) facts.learning = body.learning === true;
  return { facts, problems };
}
// What an order still needs before it can be signed: [[field, words]]. Pure.
function missingFacts(f = {}) {
  const out = [];
  const a = f.site_address || {}, pm = f.plant_manager || {}, c = f.contact || {}, b = f.billing || {};
  const full = (x) => x && x.line1 && x.city && x.state && x.postal_code;
  if (!f.legal_name) out.push(["legal_name", "the company's legal name"]);
  if (!f.site_name) out.push(["site_name", "the site's name"]);
  if (!full(a)) out.push(["site_address", "the site's full address"]);
  if (!(Number.isInteger(f.headcount) && f.headcount >= 1)) out.push(["headcount", "the number of people at the site"]);
  if (!(Number.isInteger(f.sqft) && f.sqft >= 1)) out.push(["sqft", "the site's floor space"]);
  if (!pm.name) out.push(["pm_name", "the plant manager's name"]);
  if (!pm.email) out.push(["pm_email", "the plant manager's email"]);
  if (!c.is_pm && !c.name) out.push(["me_name", "your name"]);
  if (!b.email) out.push(["billing_email", "the billing email"]);
  if (b.same_as_site === false && !full(b.address)) out.push(["billing_address", "the billing address"]);
  return out;
}
// The band as an order keeps it: what the customer is shown and what Activate bills. Brendan's flags stay off it.
function bandSnap(b) {
  if (!b) return null;
  if (b.key === "pilot") return b;   // a pilot's own band (src/pilot.js bandSnap): kept whole, its lines included
  return { key: b.key, name: b.name, min: b.min, max: b.max, monthly_usd: b.monthly_usd, moved_up: b.moved_up, by_headcount: b.by_headcount, why: b.why, book: b.book,
    // price book 2: the fee follows the tools live on the floor, and monthly_usd is the cap (src/sites.js feeFor)
    ...(b.per_tool_usd ? { per_tool_usd: b.per_tool_usd, min_tools: b.min_tools, cap_usd: b.cap_usd != null ? b.cap_usd : b.monthly_usd } : {}) };
}
// What an order is priced at right now (2026-10-05): a pilot Anetix offered this company (its own fee, whatever the
// size or the tools), or the price book: by the tools live on the floor (version 2) or the band (version 1).
// -> { band (the snapshot the order keeps), price_usd (the first month as it stands today), live_tools, offer }
// db: a transaction's client or { query: q }. band is null until the answers hold a headcount (a pilot needs none).
async function quoteFor(db, site, facts, book) {
  const offer = require("./pilot").standing(site);
  if (offer) return { band: require("./pilot").bandSnap(offer), price_usd: Number(offer.monthly_usd), live_tools: null, offer };
  const band = Number.isInteger((facts || {}).headcount) ? sites.bandOf(facts, book) : null;
  if (!band) return { band: null, price_usd: null, live_tools: null, offer: null };
  const live = band.per_tool_usd ? await sites.liveTools(site.company, db) : null;
  return { band: bandSnap(band), price_usd: sites.feeFor(band, live || 0).usd, live_tools: live, offer: null };
}
// Who the Stripe Customer is (the www service makes or updates it at signing): the legal name, the billing email and
// address, and the site's own address as its shipping address, so tax can follow where the software is used. A
// preview's Customer is its own, never the site's. line2 goes as "" when empty, so an update clears an old one.
function customerFor(site, co, f = {}, order = null) {
  const addr = (a) => (a ? { line1: a.line1 || undefined, line2: a.line2 || "", city: a.city || undefined, state: a.state || undefined, postal_code: a.postal_code || undefined, country: a.country || "US" } : undefined);
  const bill = f.billing && f.billing.same_as_site === false && f.billing.address ? f.billing.address : f.site_address;
  const preview = Boolean(order && order.kind === "preview");
  return {
    existing: preview ? ((order.stripe || {}).customer || null) : site.stripe_customer || null,
    name: f.legal_name || co.name, email: (f.billing && f.billing.email) || undefined,
    address: addr(bill), shipping: f.site_address ? { name: f.site_name || co.name, address: addr(f.site_address) } : undefined,
    description: `${preview ? "Anetix preview (not a customer): " : "Anetix site: "}${f.site_name || co.name}`,
    metadata: preview ? { site: site.id, company: co.slug, preview: "yes", order: order.id } : { site: site.id, company: co.slug },
  };
}
function cleanCard(c) {
  if (!c || typeof c !== "object") return null;
  const n = (x) => (Number.isInteger(Number(x)) ? Number(x) : null);
  return { brand: clean(c.brand, 20) || null, last4: /^\d{4}$/.test(String(c.last4 || "")) ? String(c.last4) : null, exp_month: n(c.exp_month), exp_year: n(c.exp_year) };
}
// Where the signer's request came from, as anetix.ai saw it: its best guess and the raw evidence, kept short.
function cleanNet(n) {
  if (!n || typeof n !== "object") return null;
  const out = {}; for (const k of ["cf", "real", "xff", "peer"]) if (n[k]) out[k] = clean(n[k], 200);
  return Object.keys(out).length ? out : null;
}
// A preview's stage comes from the preview order itself; a customer's order moves the site's own stage.
function previewStage(o) { return o.state === "signed" && o.payment_method ? "signed" : o.state === "activating" ? "activating" : "ordering"; }
const kindOf = (acc) => (acc.kind === "a" ? "preview" : "customer");
const mine = (acc, o) => Boolean(o && o.kind === kindOf(acc));

// ---- database ---------------------------------------------------------------------------------------------------------
const SCHEMA = `
ALTER TABLE platform.sites ADD COLUMN IF NOT EXISTS billing JSONB;
ALTER TABLE platform.sites ADD COLUMN IF NOT EXISTS stripe_customer TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS sites_stripe_customer ON platform.sites (stripe_customer) WHERE stripe_customer IS NOT NULL;
CREATE TABLE IF NOT EXISTS platform.orders (
  id              UUID PRIMARY KEY,
  site_id         UUID NOT NULL,                    -- the site's permanent id (the slug can go to another company)
  company         TEXT NOT NULL,                    -- the slug when the order was made
  state           TEXT NOT NULL DEFAULT 'draft',    -- draft, signed, activating, activated, declined, void
  version         INTEGER NOT NULL DEFAULT 1,       -- up by one with every change to the answers while a draft
  facts           JSONB NOT NULL DEFAULT '{}'::jsonb,
  band            JSONB,                            -- worked out here from the answers, never by a page
  price_usd       NUMERIC(10,2),
  price_book      INTEGER,
  terms_version   TEXT,
  terms_sha256    TEXT,                             -- the hash of the terms' exact words when it was signed
  approver        JSONB,                            -- { name, title, email, nonce, exp, kind, made_at }
  text            TEXT,                             -- the order form exactly as signed
  text_sha256     TEXT,
  signer          JSONB,                            -- { name, title, email, via: manager | approver | admin }
  learning_opt_in BOOLEAN,
  signed_at       TIMESTAMPTZ,
  signed_ip       TEXT,
  signed_net      JSONB,                            -- the evidence behind signed_ip: { cf, real, xff, peer }
  signed_ua       TEXT,
  setup_session   TEXT,                             -- the Checkout session (setup mode) for the card
  payment_method  TEXT,
  card            JSONB,                            -- { brand, last4, exp_month, exp_year }, for the admin's eye
  card_saved_at   TIMESTAMPTZ,
  stripe          JSONB NOT NULL DEFAULT '{}'::jsonb,   -- the Stripe ids made for it so far; the cards to remove (detach_list)
  kind            TEXT NOT NULL DEFAULT 'customer', -- customer, or preview (started on an admin's link)
  from_stage      TEXT,                             -- the site's stage when a customer's order started
  note            TEXT,                             -- why it was voided, declined or sent back
  voided_by       TEXT,
  voided_at       TIMESTAMPTZ,
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE platform.orders ADD COLUMN IF NOT EXISTS signed_net JSONB;
ALTER TABLE platform.orders ADD COLUMN IF NOT EXISTS from_stage TEXT;
ALTER TABLE platform.orders ADD COLUMN IF NOT EXISTS voided_by TEXT;
ALTER TABLE platform.orders ADD COLUMN IF NOT EXISTS assent JSONB;   -- the words beside the signature, as shown: { notice, tick } (stage 3)
CREATE UNIQUE INDEX IF NOT EXISTS orders_one_open ON platform.orders (site_id) WHERE state IN ('draft','signed','activating');
CREATE INDEX IF NOT EXISTS orders_site ON platform.orders (site_id, created_at DESC);
CREATE TABLE IF NOT EXISTS platform.terms_versions (
  version          TEXT PRIMARY KEY,
  sha256           TEXT NOT NULL,
  doc              JSONB NOT NULL,                  -- the words as first signed under this version
  first_signed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;
async function init() { await q(SCHEMA); }

async function isOpen() { return (await getSetting("golive_open", "0")) === "1"; }
// The cards to remove: SQL that adds one to an order's list, and the ones still to remove from an order's stripe JSON.
const addDetach = (pmSql) => `stripe || jsonb_build_object('detach_list', COALESCE(stripe->'detach_list', '[]'::jsonb) || jsonb_build_array(${pmSql}))`;
function cardsToRemove(stripe) {
  const x = stripe || {}, done = new Set(x.detached_list || []);
  const all = [...(x.detach_pending && !x.detached_at ? [x.detach_pending] : []), ...(x.detach_list || [])];
  return [...new Set(all)].filter((pm) => pm && !done.has(pm) && !(pm === x.detach_pending && x.detached_at));
}
// an order whose every listed card is removed drops out, so old orders never crowd the sweep's 50 a round
const TO_REMOVE_SQL = "((stripe ? 'detach_list' AND NOT (COALESCE(stripe->'detached_list', '[]'::jsonb) @> (stripe->'detach_list'))) OR (stripe ? 'detach_pending' AND NOT (stripe ? 'detached_at') AND NOT (COALESCE(stripe->'detached_list', '[]'::jsonb) @> jsonb_build_array(stripe->>'detach_pending'))))";
// The switch and what waits on Brendan: cards Stripe still holds for withdrawn orders.
async function status() {
  const rows = (await q(`SELECT o.id, o.company, o.stripe, o.card, o.voided_at FROM platform.orders o WHERE ${TO_REMOVE_SQL.replace(/stripe/g, "o.stripe")}
                          ORDER BY o.voided_at DESC NULLS LAST LIMIT 100`).catch(() => ({ rows: [] }))).rows;
  const cards = rows.flatMap((c) => cardsToRemove(c.stripe).map((pm) => ({ order: c.id, company: c.company, payment_method: pm, card: c.card, since: c.voided_at })));
  return { open: await isOpen(), terms_version: terms.TERMS_VERSION, terms_draft: terms.DRAFT, key_set: KEY().length >= 16, www_url: WWW(), cards_to_remove: cards.slice(0, 50) };
}
async function setOpen(open, by) {
  await setSetting("golive_open", open ? "1" : "0");
  await logEvent(open ? "golive_opened" : "golive_closed", null, { by: by || null });
  return status();
}
async function openOrder(siteId) {
  return (await q("SELECT * FROM platform.orders WHERE site_id=$1 AND state = ANY($2) ORDER BY created_at DESC LIMIT 1", [siteId, OPEN_STATES])).rows[0] || null;
}
// A company's site row, made (stage demo, nothing filled in) the first time a Go live link is needed for it.
async function ensureSite(slug) {
  const had = (await q("SELECT * FROM platform.sites WHERE company=$1", [slug])).rows[0];
  if (had) return had;
  await q("INSERT INTO platform.sites (id, company) VALUES ($1,$2) ON CONFLICT (company) DO NOTHING", [crypto.randomUUID(), slug]);
  return (await q("SELECT * FROM platform.sites WHERE company=$1", [slug])).rows[0];
}
// Every change to a site's order runs here: the site's row locked, its open order read, one transaction. An
// approver's link is checked again here, under the lock, so one replaced a moment ago cannot still sign.
async function withSite(acc, fn) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const site = (await c.query("SELECT * FROM platform.sites WHERE id=$1 FOR UPDATE", [acc.site.id])).rows[0];
    if (!site) throw fail(404, "not found");
    const open = (await c.query("SELECT * FROM platform.orders WHERE site_id=$1 AND state = ANY($2) ORDER BY created_at DESC LIMIT 1", [site.id, OPEN_STATES])).rows[0] || null;
    if (acc.who === "approver") {
      const ap = open && open.id === acc.order_id ? open.approver : null;
      if (!ap || !same(ap.nonce, acc.nonce) || Number(ap.exp) !== acc.exp) throw approverGone();
    }
    const out = await fn(c, site, open);
    await c.query("COMMIT");
    return out;
  } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; }
  finally { c.release(); }
}

// Who is asking, from the link anetix.ai sends back: -> { who, kind, site, co, order_id, nonce, exp }. Anything that
// does not hold up is a 404, so a made-up link learns nothing about which companies exist.
async function resolve(a = {}) {
  const open = await isOpen();
  if (a && a.order) {
    const id = String(a.order);
    const tok = UUID.test(id) ? readApproverToken(id, a.t) : null;
    if (!tok) throw fail(404, "not found");
    const order = (await q("SELECT * FROM platform.orders WHERE id=$1", [id])).rows[0];
    const ap = order && order.approver;
    if (!ap || !same(ap.nonce, tok.nonce) || Number(ap.exp) !== tok.exp) throw fail(404, "not found");
    if (["void", "declined"].includes(order.state)) throw approverGone();
    const site = (await q("SELECT * FROM platform.sites WHERE id=$1", [order.site_id])).rows[0];
    // Go live is off for customers, unless Anetix made this company an offer (src/pilot.js): the offer is the invitation
    if (ap.kind !== "a" && !open && !(site && require("./pilot").standing(site)) && !(site && order.state !== "draft" && require("./pilot").isPilot(order.band))) throw fail(404, "not found");
    const co = site && (await q("SELECT slug, name, demo FROM platform.companies WHERE slug=$1", [site.company])).rows[0];
    if (!site || !co) throw fail(404, "not found");
    return { who: "approver", kind: ap.kind === "a" ? "a" : "m", site, co, order_id: id, nonce: tok.nonce, exp: tok.exp };
  }
  const slug = String((a && a.slug) || "").toLowerCase();
  const tok = readGoliveToken(slug, a && a.t);
  if (!tok) throw fail(404, "not found");
  const site = (await q("SELECT * FROM platform.sites WHERE id=$1 AND company=$2", [tok.site, slug])).rows[0];
  if (tok.kind === "m" && !open && !(site && (await invited(site)))) throw fail(404, "not found");
  const co = site && (await q("SELECT slug, name, demo FROM platform.companies WHERE slug=$1", [slug])).rows[0];
  if (!site || !co) throw fail(404, "not found");
  return { who: "manager", kind: tok.kind, site, co };
}
// Go live being off does not shut out a company Anetix made an offer to, nor one whose order under an offer is already
// in (it must still be able to see it, add a card after a decline, or withdraw).
async function invited(site) {
  if (require("./pilot").standing(site)) return true;
  const o = await openOrder(site.id);
  return Boolean(o && o.kind === "customer" && o.state !== "draft" && require("./pilot").isPilot(o.band));   // a draft counts only while the offer stands
}
function approverGone() { return fail(410, "This link no longer works: the order it was for was started over or withdrawn, or someone else was asked to approve it. Ask the person who sent it to you for a new one.", { code: "gone" }); }
const readOnly = () => fail(409, "This order is the customer's. Your preview link can look at it but not change it; start your own preview on a site with no order open, or void theirs from the Sites tab.", { code: "readonly" });
const noOrder = () => fail(409, "There is no order here yet. Fill in about your site first.", { code: "none" });

// What a new order starts from: what Brendan already knows about the site (the Sites tab), the name the demo was made
// with, and the email its pin was for.
async function prefill(db, site, co) {
  const ss = (await db.query("SELECT email, contact FROM platform.self_serve WHERE company=$1", [co.slug])).rows[0] || {};
  const d = site.deal || {};
  return {
    legal_name: site.legal_name || null, site_name: site.site_name || co.name || null, site_address: site.site_address || null,
    headcount: site.headcount == null ? null : Number(site.headcount), sqft: site.sqft == null ? null : Number(site.sqft),
    plant_manager: site.plant_manager || null,
    contact: { is_pm: false, name: ss.contact || "", title: "" },
    billing: site.billing || { email: ss.email || null, same_as_site: true, address: null },
    integrations: d.integrations || null, hardware: d.hardware || null, learning: false,
  };
}
// A customer's answers go onto the site's row too, so the Sites tab shows what they typed. A preview's never do.
async function writeThrough(db, site, f) {
  const j = (v) => (v == null ? null : JSON.stringify(v));
  await db.query(`UPDATE platform.sites SET site_name=$2, legal_name=$3, site_address=$4, plant_manager=$5, headcount=$6, sqft=$7, billing=$8,
                    deal = COALESCE(deal, '{}'::jsonb) || $9::jsonb, updated_at=now(), updated_by='anetix.ai' WHERE id=$1`,
  [site.id, f.site_name || null, f.legal_name || null, j(f.site_address), j(f.plant_manager), Number.isInteger(f.headcount) ? f.headcount : null,
    Number.isInteger(f.sqft) ? f.sqft : null, j(f.billing), JSON.stringify({ integrations: f.integrations || null, hardware: f.hardware || null })]);
}
function approverUrl(o) {
  const ap = o.approver; if (!ap) return null;
  const t = approverToken(o.id, ap.nonce, Number(ap.exp));
  return t ? `${WWW()}/order/${o.id}?t=${t}` : null;
}
function draftText(facts, book, quote = {}) {
  const text = sites.orderText({ facts, book, terms_version: terms.TERMS_VERSION, terms_url: termsUrl(), live_tools: quote.live_tools || 0, offer: quote.offer || null });
  return { text, sha: sites.textHash(text) };
}
const rangeOf = (b) => (!b || b.min == null ? "" : b.max == null ? `${Number(b.min).toLocaleString("en-US")} people or more` : `${Number(b.min).toLocaleString("en-US")} to ${Number(b.max).toLocaleString("en-US")} people`);
function orderView(o, { acc, book, site, co, quote }) {
  const f = o.facts || {};
  const missing = missingFacts(f);
  const ap = o.approver;
  const out = {
    id: o.id, state: o.state, version: o.version, kind: o.kind, facts: f, readonly: !mine(acc, o),
    missing: missing.map(([key, text]) => ({ key, text })), complete: missing.length === 0,
    band: null, price_usd: null, text: null, sha: null,
    approver: ap ? { name: ap.name, title: ap.title || "", email: ap.email, expires_at: new Date(Number(ap.exp) * 1000).toISOString(), expired: Number(ap.exp) * 1000 <= Date.now(), url: acc.who === "manager" && mine(acc, o) ? approverUrl(o) : null } : null,
    signer: o.signer || null, signed_at: o.signed_at || null, learning_opt_in: o.learning_opt_in == null ? null : Boolean(o.learning_opt_in),
    card: o.card || null, card_saved: Boolean(o.payment_method), setup_session: o.setup_session || null,
    terms_version: o.terms_version || terms.TERMS_VERSION, price_book: o.price_book || book.version, note: o.note || null,
  };
  const P = require("./pilot");
  if (o.state === "draft") {
    const qt = quote || { band: null, price_usd: null };
    out.band = qt.band; out.price_usd = qt.price_usd;
    if (out.complete && qt.band) Object.assign(out, draftText(f, book, qt));
    out.pricing = qt.band ? sites.pricingView({ band: qt.band, live_tools: qt.live_tools || 0, offer: qt.offer, site_name: f.site_name || co.name, range: rangeOf(qt.band) }) : null;
  } else {
    out.band = o.band || null; out.price_usd = o.price_usd == null ? null : Number(o.price_usd); out.text = o.text; out.sha = o.text_sha256;
    // a signed order says what was signed: the pilot as offered then, or the fee as it stood at the signature
    const pilot = P.isPilot(o.band) ? { kind: "pilot", monthly_usd: o.band.monthly_usd, months: o.band.pilot.months, lines: o.band.pilot.lines } : null;
    out.pricing = o.band ? sites.pricingView({ band: o.band, live_tools: (o.stripe || {}).signed_tools || 0, offer: pilot, site_name: f.site_name || co.name, range: rangeOf(o.band) }) : null;
  }
  out.pilot = P.isPilot(out.band);
  if (o.state === "signed" && !o.payment_method && mine(acc, o)) out.customer = customerFor(site, co, f, o);
  return out;
}
async function view(access, acc0) {
  const acc = acc0 || (await resolve(access));
  const site = (await q("SELECT * FROM platform.sites WHERE id=$1", [acc.site.id])).rows[0];
  if (!site) throw fail(404, "not found");
  const book = await sites.currentBook();
  let order = acc.who === "approver" ? (await q("SELECT * FROM platform.orders WHERE id=$1", [acc.order_id])).rows[0] : await openOrder(site.id);
  if (order && acc.kind === "m" && order.kind === "preview") order = null;   // a customer never sees a preview
  const preview = Boolean(order && order.kind === "preview");
  const mgr = acc.who === "manager" ? ((await require("./accounts").managersOf(acc.co.slug))[0] || null) : null;
  const ss = acc.who === "manager" ? (await q("SELECT email, contact FROM platform.self_serve WHERE company=$1", [acc.co.slug])).rows[0] : null;
  // a customer's earlier order Anetix withdrew, with its note, while there is no open one
  const last = !order && acc.who === "manager" && acc.kind === "m" ? (await q("SELECT note, voided_at FROM platform.orders WHERE site_id=$1 AND kind='customer' ORDER BY created_at DESC LIMIT 1", [site.id])).rows[0] : null;
  const stage = preview ? previewStage(order) : site.stage || "demo";
  const quote = order && order.state === "draft" ? await quoteFor({ query: q }, site, order.facts, book) : null;
  const offer = require("./pilot").standing(site);
  const pilot = Boolean(offer || (order && require("./pilot").isPilot(order.band)));
  return {
    ok: true, who: acc.who, preview: acc.kind === "a", open: await isOpen(),
    company: { slug: acc.co.slug, name: acc.co.name, demo: Boolean(acc.co.demo) },
    site: { id: site.id, stage, stage_label: sites.STAGE_LABEL[stage] },
    terms: { version: terms.TERMS_VERSION, url: termsUrl(), draft: terms.DRAFT, ...assentFor(order && order.facts, acc.co) },
    order: order ? orderView(order, { acc, book, site, co: acc.co, quote }) : null,
    // a pilot Anetix offered this company: the screens say "pilot", and what is charged when (www pages.js)
    pilot, offer: offer ? { monthly_usd: Number(offer.monthly_usd), months: Number(offer.months), line: sites.pilotLine(offer) } : null,
    words: pilot ? PILOT_WORDS : null,
    prefill: !order && acc.who === "manager" ? await prefill({ query: q }, site, acc.co) : null,
    withdrawn: last && last.note && /^Anetix withdrew/.test(last.note) ? { note: last.note, at: last.voided_at } : null,
    me: acc.who === "manager" ? { email: (mgr && mgr.login) || (ss && ss.email) || null, name: (mgr && mgr.display_name) || (ss && ss.contact) || null } : null,
    credit_back: Boolean((await q("SELECT 1 FROM platform.credit_ledger WHERE company=$1 AND kind='purchase' LIMIT 1", [acc.co.slug])).rows[0]),
    // the Terms, 5.4: until the site is on, the customer may withdraw the order (the manager, on "Your order is in")
    can_withdraw: Boolean(acc.who === "manager" && order && mine(acc, order) && order.state === "signed" && (preview || site.stage === "signed" || site.stage === "ordering")),
    fair_use_share: book.fair_use_share,
  };
}

// The few lines of the go-live screens that are not the price screen or the order form and that a pilot says
// differently (anetix.ai lays them out; without them it says a subscription's).
const PILOT_WORDS = Object.freeze({
  kicker: "Your pilot",
  about: "Anetix has offered your site a pilot. Your demo becomes the pilot site, with everything you built still in place: your floor gets its own way in and the AI has no credit to run out of. First, a few facts about the site.",
  about_approver: "asked you to approve this pilot. These are their answers; correct anything that is wrong.",
  charge: "the first payment is charged then",
  done: "Until then the demo works as it does now.",
});

// ---- what anetix.ai does ----------------------------------------------------------------------------------------------
// Screen 1: the answers. The first save starts the order (a customer's moves the site to Ordering); a save that
// changes nothing keeps the version, so going back and forward through the screens never asks anyone to look again.
// A customer who starts while a preview is open voids it; its card comes back as detach_cards for anetix.ai to remove.
async function save(access, body = {}) {
  const acc = await resolve(access);
  const { facts: fields, problems } = cleanFacts(body.fields || {});
  if (problems.length) throw fail(400, problems.map(sentence).join(" "), { code: "invalid" });
  if (acc.who === "approver") delete fields.contact;   // who is going live is the manager's to say
  const r = await withSite(acc, async (c, site, open0) => {
    let open = open0, detach = [], replaced = null;
    if (open && !mine(acc, open)) {
      if (acc.kind === "a") throw readOnly();
      // a customer's first answer while Brendan's preview is open: the preview goes, the customer's order starts
      await c.query(`UPDATE platform.orders SET state='void', note='replaced by the customer''s own order', voided_by='platform', voided_at=now(), updated_at=now() WHERE id=$1`, [open.id]);
      if (open.payment_method) detach = [open.payment_method];
      replaced = open.id; open = null;
    }
    const preview = acc.kind === "a";
    if (!preview && !["demo", "ordering", "back_to_demo"].includes(site.stage)) throw fail(409, "This site's order is in already, so its answers cannot change here.", { code: "signed" });
    if (preview && !open && ["signed", "activating", "subscribed"].includes(site.stage)) throw fail(409, "This site's order is in already. A preview needs a site with no order open.", { code: "signed" });
    if (open && open.state !== "draft") throw fail(409, acc.who === "manager" ? "Your order form is signed, so its answers cannot change. To change something, start the order over." : "This order form is signed, so its answers cannot change.", { code: "signed" });
    const book = await sites.currentBook();
    const facts = { ...(open ? open.facts : await prefill(c, site, acc.co)), ...fields };
    // "That's me" (the launch audit, C8): a name or email left empty is filled from the account going live, the
    // manager's own sign-in, so ticking the box is enough. A name or email typed in the boxes wins.
    if (acc.who === "manager" && facts.contact && facts.contact.is_pm) {
      const mgr = (await require("./accounts").managersOf(acc.co.slug))[0] || null;
      const ss = (await c.query("SELECT email, contact FROM platform.self_serve WHERE company=$1", [acc.co.slug])).rows[0] || {};
      const pm = { ...(facts.plant_manager || {}) };
      // the email the demo was made for first (a manager's login can be a +slug alias), then the first manager's
      const myEmail = clean(ss.email || (mgr && mgr.login), 200).toLowerCase(), myName = clean(ss.contact || (mgr && mgr.display_name), 80);
      if (!pm.name && myName) pm.name = myName;
      if (!pm.email && EMAIL.test(myEmail)) pm.email = myEmail;
      facts.plant_manager = pm;
    }
    // "That's me": the plant manager's name and title are the person going live's, copied now, so a later change to
    // the plant manager (the approver's, say) does not change who that is
    if (acc.who === "manager" && facts.contact && facts.contact.is_pm) facts.contact = { is_pm: true, name: (facts.plant_manager || {}).name || "", title: (facts.plant_manager || {}).title || "" };
    const qt = await quoteFor(c, site, facts, book);
    if (!open) {
      let fromStage = null;
      if (!preview) {
        const step = sites.next({ stage: site.stage }, { type: "start_order" });
        if (!step.ok) throw fail(409, sentence(step.why));
        fromStage = site.stage === "ordering" ? "demo" : site.stage;
        await c.query("UPDATE platform.sites SET stage=$2, updated_at=now(), updated_by='anetix.ai' WHERE id=$1", [site.id, step.state.stage]);
      }
      const id = crypto.randomUUID();
      await c.query(`INSERT INTO platform.orders (id, site_id, company, state, version, facts, band, price_usd, price_book, terms_version, kind, from_stage, created_by)
                     VALUES ($1,$2,$3,'draft',1,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, site.id, site.company, JSON.stringify(facts), qt.band ? JSON.stringify(qt.band) : null, qt.price_usd, book.version, terms.TERMS_VERSION, preview ? "preview" : "customer", fromStage, preview ? "admin" : acc.who]);
      if (!preview) await writeThrough(c, site, facts);
      return { started: id, detach, replaced };
    }
    if (sites.stable(facts) === sites.stable(open.facts)) return { unchanged: open.id, detach, replaced };
    await c.query("UPDATE platform.orders SET facts=$2, version=version+1, band=$3, price_usd=$4, price_book=$5, updated_at=now() WHERE id=$1",
      [open.id, JSON.stringify(facts), qt.band ? JSON.stringify(qt.band) : null, qt.price_usd, book.version]);
    if (!preview) await writeThrough(c, site, facts);
    return { changed: open.id, detach, replaced };
  });
  if (r.replaced) await logEvent("order_preview_replaced", acc.co.slug, { preview: r.replaced, order: r.started || null });
  if (r.started) await logEvent("order_started", acc.co.slug, { order: r.started, site: acc.site.id, by: acc.who, preview: acc.kind === "a" });
  return { ...(await view(access, acc)), detach_cards: r.detach };
}

// Screen 3: someone else approves (a link for them, 14 days), or clear: the manager signs it.
async function setApprover(access, body = {}) {
  const acc = await resolve(access);
  if (acc.who !== "manager") throw fail(403, "Only the manager going live can change who signs.");
  let approver = null;
  if (!body.clear) {
    const a = body.approver || {};
    const name = clean(a.name, 80), title = clean(a.title, 80), email = clean(a.email, 200).toLowerCase();
    const bad = [];
    if (name.length < 2) bad.push(["ap_name", "their name"]);
    if (!EMAIL.test(email)) bad.push(["ap_email", "their email"]);
    if (bad.length) throw fail(400, `Give ${joinAnd(bad.map((x) => x[1]))}.`, { code: "invalid", fields: bad.map((x) => x[0]) });
    approver = { name, title, email, nonce: crypto.randomBytes(8).toString("base64url"), exp: Math.floor(Date.now() / 1000) + 14 * 86400, kind: acc.kind, made_at: new Date().toISOString() };
  }
  await withSite(acc, async (c, _site, open) => {
    if (open && !mine(acc, open)) { if (acc.kind === "a") throw readOnly(); throw noOrder(); }
    if (!open || open.state !== "draft") throw open ? fail(409, "The order form is signed already.", { code: "signed" }) : noOrder();
    if (approver && missingFacts(open.facts).length) throw fail(400, "Fill in about your site first, so the person approving sees the whole order.", { code: "incomplete" });
    await c.query("UPDATE platform.orders SET approver=$2, updated_at=now() WHERE id=$1", [open.id, approver ? JSON.stringify(approver) : null]);
  });
  await logEvent(approver ? "order_approver_asked" : "order_approver_cleared", acc.co.slug, approver ? { approver: approver.email } : {});
  return view(access, acc);
}

// The words of the terms version being signed: kept the first time anyone accepts under it, and after that an
// acceptance under the same version must be over the same words (src/agreements.js, which every acceptance uses).
const termsGuard = (c) => require("./agreements").keepVersion(c);
// The words beside the signature (Brendan's screen text): the box above it and the tick. The tick names the company
// the way the order form does.
function assentFor(facts, co) { return { notice: terms.WORDS.notice, tick: terms.WORDS.order((facts && facts.legal_name) || (co && co.name) || "the company") }; }

// Screen 4: the signature. Applied only while the version and the hash of the text the signer saw still match.
async function sign(access, body = {}) {
  const acc = await resolve(access);
  const s = body.signer || {};
  const via = acc.who === "approver" ? "approver" : acc.kind === "a" ? "admin" : "manager";
  const signer = { name: clean(s.name, 80), title: clean(s.title, 80), email: clean(s.email, 200).toLowerCase(), via };
  const bad = [];
  if (signer.name.length < 2) bad.push(["signer_name", "your full name"]);
  if (signer.title.length < 2) bad.push(["signer_title", "your title"]);
  if (!EMAIL.test(signer.email)) bad.push(["signer_email", "your email"]);
  if (bad.length) throw fail(400, `To sign, give ${joinAnd(bad.map((x) => x[1]))}.`, { code: "invalid", fields: bad.map((x) => x[0]) });
  if (body.authority !== true) throw fail(400, "Tick the box to agree to the order form and the Terms of Service, and to say you can sign for the company.", { code: "invalid", fields: ["authority"] });
  const version = Number(body.version), sha = String(body.sha || "");
  const r = await withSite(acc, async (c, site, open) => {
    if (open && !mine(acc, open)) { if (acc.kind === "a") throw readOnly(); throw noOrder(); }
    if (!open) throw noOrder();
    if (open.state !== "draft") throw fail(409, "This order form is signed already.", { code: "signed" });
    if (open.kind === "customer" && site.stage !== "ordering") throw fail(409, "This site is not taking an order just now.", { code: "stage" });
    if (!Number.isInteger(version) || version !== open.version) throw fail(409, "The order changed since this page was opened. Look it over again before you sign.", { code: "changed" });
    const missing = missingFacts(open.facts);
    if (missing.length) throw fail(400, `The order still needs ${joinAnd(missing.map((m) => m[1]))}.`, { code: "incomplete" });
    const book = await sites.currentBook();
    const qt = await quoteFor(c, site, open.facts, book);
    if (!qt.band) throw fail(400, "The order still needs the number of people at the site.", { code: "incomplete" });
    const band = { ...qt.band, monthly_usd: qt.band.monthly_usd };
    const { text, sha: hash } = draftText(open.facts, book, qt);
    if (!same(hash, sha)) throw fail(409, "The order form changed since this page was opened. Look it over again before you sign.", { code: "changed" });
    const termsSha = await termsGuard(c);
    const assent = assentFor(open.facts, acc.co);
    await c.query(`UPDATE platform.orders SET state='signed', text=$2, text_sha256=$3, band=$4, price_usd=$5, price_book=$6, terms_version=$7, terms_sha256=$8,
                     signer=$9, learning_opt_in=$10, signed_at=now(), signed_ip=$11, signed_net=$12, signed_ua=$13, assent=$14,
                     stripe = stripe || jsonb_build_object('signed_tools', $15::int), updated_at=now() WHERE id=$1`,
    [open.id, text, hash, JSON.stringify(qt.band), qt.price_usd, book.version, terms.TERMS_VERSION, termsSha,
      JSON.stringify(signer), open.facts.learning === true, clean(body.ip, 64) || null, cleanNet(body.net) ? JSON.stringify(cleanNet(body.net)) : null, clean(body.ua, 300) || null, JSON.stringify(assent), qt.live_tools || 0]);
    // the signature is the customer's acceptance of the Terms (their section 1.2); a preview is Brendan's own walk-through
    if (open.kind === "customer") await require("./agreements").record(c, { company: site.company, site_id: site.id, kind: "order", words: assent.tick,
      who: { name: signer.name, title: signer.title, email: signer.email, role: via }, ip: body.ip, net: cleanNet(body.net), ua: body.ua, ref: open.id });
    return { order: open.id, band, price_usd: qt.price_usd, preview: open.kind === "preview" };
  });
  await logEvent("order_signed", acc.co.slug, { order: r.order, site: acc.site.id, by: via, band: r.band.key, price_usd: r.price_usd, preview: r.preview });
  return view(access, acc);
}

// The www service made (or reused) the Stripe Customer and a setup session for the card: keep both. A customer's
// order keeps the Customer on the site (one per site); a preview keeps its own on the order. Answers
// previous_session, the one it replaces, for the www service to expire.
async function checkout(access, body = {}) {
  const acc = await resolve(access);
  const cus = String(body.stripe_customer || ""), cs = String(body.setup_session || ""), replaces = body.replaces ? String(body.replaces) : null;
  if (!/^cus_[A-Za-z0-9_]{3,}$/.test(cus) || !/^cs_[A-Za-z0-9_]{3,}$/.test(cs)) throw fail(400, "a Stripe customer and a setup session");
  const r = await withSite(acc, async (c, site, open) => {
    if (open && !mine(acc, open)) { if (acc.kind === "a") throw readOnly(); throw noOrder(); }
    if (!open || open.state !== "signed") throw fail(409, "The order form is not signed yet.", { code: "unsigned" });
    if (open.payment_method) throw fail(409, "This order has its card already.", { code: "has_card" });
    if (((open.stripe || {}).sessions || []).length >= MAX_SESSIONS) throw fail(429, "That is a lot of tries at the card step. Write to Anetix and they will help.", { code: "too_many" });
    if (open.kind === "customer") {
      if (site.stripe_customer && site.stripe_customer !== cus && replaces !== site.stripe_customer) throw fail(409, "This site has another Stripe customer.", { code: "customer" });
      if (site.stripe_customer !== cus) {
        if ((await c.query("SELECT 1 FROM platform.orders WHERE kind='preview' AND stripe->>'customer'=$1", [cus])).rows[0]) throw fail(409, "That Stripe customer is a preview's.", { code: "customer" });
        try { await c.query("UPDATE platform.sites SET stripe_customer=$2, updated_at=now() WHERE id=$1", [site.id, cus]); }
        catch (e) { if (/sites_stripe_customer/.test(e.message)) throw fail(409, "That Stripe customer belongs to another site.", { code: "customer" }); throw e; }
      }
    } else {
      const had = (open.stripe || {}).customer;
      if (had && had !== cus && replaces !== had) throw fail(409, "This preview has another Stripe customer.", { code: "customer" });
      if ((await c.query("SELECT 1 FROM platform.sites WHERE stripe_customer=$1", [cus])).rows[0]) throw fail(409, "That Stripe customer belongs to a site; a preview needs its own.", { code: "customer" });
    }
    const previous = open.setup_session && open.setup_session !== cs ? open.setup_session : null;
    await c.query(`UPDATE platform.orders SET setup_session=$2, stripe = jsonb_set(stripe || jsonb_build_object('customer', $3::text), '{sessions}', COALESCE(stripe->'sessions', '[]'::jsonb) || to_jsonb($2::text)),
                     updated_at=now() WHERE id=$1`, [open.id, cs, cus]);
    return { previous };
  });
  return { ...(await view(access, acc)), previous_session: r.previous };
}

// A card saved at Stripe for an order, from the webhook or the way back from Stripe (both can come, in either order):
// the first card wins, the same card again changes nothing, and anything else is answered detach, including a card
// for a company deleted in the meantime.
async function cardSaved(body = {}) {
  const orderId = String(body.order || ""), cs = String(body.setup_session || ""), cus = String(body.stripe_customer || ""), pm = String(body.payment_method || "");
  if (!UUID.test(orderId) || !/^cs_[A-Za-z0-9_]{3,}$/.test(cs) || !/^cus_[A-Za-z0-9_]{3,}$/.test(cus) || !/^pm_[A-Za-z0-9_]{3,}$/.test(pm)) throw fail(400, "order, setup_session, stripe_customer and payment_method");
  const card = cleanCard(body.card);
  const o0 = (await q("SELECT site_id, company, payment_method FROM platform.orders WHERE id=$1", [orderId])).rows[0];
  if (!o0) throw fail(404, "no such order");
  if (!(await q("SELECT 1 FROM platform.sites WHERE id=$1", [o0.site_id])).rows[0]) {   // the company was deleted
    await logEvent("order_card_refused", o0.company, { order: orderId, why: "the site is gone" });
    return { ok: true, order: orderId, company: o0.company, applied: false, detach: o0.payment_method !== pm, already: o0.payment_method === pm, why: "the site is gone" };
  }
  const r = await withSite({ site: { id: o0.site_id }, who: "platform" }, async (c, site, open) => {
    const o = (await c.query("SELECT * FROM platform.orders WHERE id=$1", [orderId])).rows[0];
    const co = (await c.query("SELECT slug, name FROM platform.companies WHERE slug=$1", [site.company])).rows[0] || { slug: site.company, name: site.company };
    const base = { order: o.id, company: co.slug, company_name: co.name, site_name: (o.facts || {}).site_name || co.name, stage: o.kind === "preview" ? previewStage(o) : site.stage, band: o.band, price_usd: o.price_usd == null ? null : Number(o.price_usd), preview: o.kind === "preview" };
    if (o.payment_method === pm) return { ...base, applied: false, already: true, card: o.card };
    const refuse = (why) => ({ ...base, applied: false, detach: true, why });
    if (o.payment_method) return refuse("this order has its card already");
    if (o.state !== "signed") return refuse(`the order is ${o.state}`);
    if (!open || open.id !== o.id) return refuse("it is not the site's open order");
    if (o.kind === "preview") {
      if ((o.stripe || {}).customer !== cus) return refuse("the card was saved to another Stripe customer");
      await c.query("UPDATE platform.orders SET payment_method=$2, card=$3, card_saved_at=now(), setup_session=$4, updated_at=now() WHERE id=$1", [o.id, pm, card ? JSON.stringify(card) : null, cs]);
      return { ...base, applied: true, stage: "signed", card };
    }
    if (site.stripe_customer !== cus) return refuse("the card was saved to another Stripe customer");
    const step = sites.next({ stage: site.stage }, { type: "card_saved", order_signed: true });
    if (!step.ok) return refuse(step.why);
    await c.query("UPDATE platform.orders SET payment_method=$2, card=$3, card_saved_at=now(), setup_session=$4, updated_at=now() WHERE id=$1", [o.id, pm, card ? JSON.stringify(card) : null, cs]);
    await c.query("UPDATE platform.sites SET stage=$2, updated_at=now(), updated_by='anetix.ai' WHERE id=$1", [site.id, step.state.stage]);
    return { ...base, applied: true, stage: step.state.stage, card };
  });
  if (r.applied) await logEvent("order_card_saved", r.company, { order: orderId, card: r.card ? `${r.card.brand || "card"} ${r.card.last4 || ""}`.trim() : null, preview: r.preview });
  // the launch audit, C11: a signed order with its card is waiting on Brendan, who aims to switch it on within 24 hours
  if (r.applied && !r.preview) require("./notify").notify("Signed order: activate within 24 hours", `${r.company_name}${r.site_name && r.site_name !== r.company_name ? `, ${r.site_name}` : ""}: ${require("./pilot").isPilot(r.band) ? `a pilot, ${sites.pilotLine({ monthly_usd: r.band.monthly_usd, months: r.band.pilot.months })}` : `${(r.band && r.band.name) || "a"} site at $${Number(r.price_usd || 0).toLocaleString("en-US")} a month${r.band && r.band.per_tool_usd ? ` today ($${r.band.per_tool_usd} a tool, cap $${Number(r.band.monthly_usd).toLocaleString("en-US")})` : ""}`}. The card is saved. Activate is on the Sites tab.`, { priority: 5, tags: ["moneybag"], ref: r.company });
  else if (r.detach) await logEvent("order_card_refused", r.company, { order: orderId, why: r.why });
  return { ok: true, ...r };
}

// A signed order with no card yet can be started over: it is voided (kept, as every order is) and a new draft holds
// the same answers. A draft needs no starting over; an order with its card is in.
async function startOver(access) {
  const acc = await resolve(access);
  if (acc.who !== "manager") throw fail(403, "Only the manager going live can start the order over.");
  const r = await withSite(acc, async (c, site, open) => {
    if (open && !mine(acc, open)) { if (acc.kind === "a") throw readOnly(); throw noOrder(); }
    if (!open) throw fail(409, "There is no order to start over.", { code: "none" });
    if (open.state === "draft") return { draft: open.id };
    if (open.state !== "signed" || open.payment_method) throw fail(409, "Your order is in with its card, so it cannot be started over here. Write to Anetix to change it.", { code: "in" });
    await c.query("UPDATE platform.orders SET state='void', note='started over by the customer', voided_by=$2, voided_at=now(), updated_at=now() WHERE id=$1", [open.id, acc.kind === "a" ? "admin" : "manager"]);
    const id = crypto.randomUUID();
    await c.query(`INSERT INTO platform.orders (id, site_id, company, state, version, facts, band, price_usd, price_book, terms_version, kind, from_stage, created_by)
                   VALUES ($1,$2,$3,'draft',1,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [id, site.id, site.company, JSON.stringify(open.facts), open.band ? JSON.stringify(open.band) : null, open.price_usd, open.price_book, terms.TERMS_VERSION, open.kind, open.from_stage, acc.kind === "a" ? "admin" : "manager"]);
    return { voided: open.id, fresh: id, expire: open.setup_session || null };
  });
  if (r.voided) await logEvent("order_started_over", acc.co.slug, { voided: r.voided, order: r.fresh });
  return { ...(await view(access, acc)), expire_session: r.expire || null };
}

// Until the site is switched on, the customer may withdraw a signed order at no charge (the Terms, 5.4): Withdraw on
// "Your order is in", the manager's only. The order is voided (kept, as every order is), the site goes back to the stage
// it had before the order, and its card is listed for removal and answered as detach_cards, so anetix.ai removes it on
// the spot and the sweep (src/activate.js) makes sure. Not while Activate is running: that is Anetix's to finish or undo.
async function withdraw(access) {
  const acc = await resolve(access);
  if (acc.who !== "manager") throw fail(403, "Only the manager going live can withdraw the order.");
  const r = await withSite(acc, async (c, site, open) => {
    if (open && !mine(acc, open)) { if (acc.kind === "a") throw readOnly(); throw noOrder(); }
    if (!open) throw fail(409, "There is no order to withdraw.", { code: "none" });
    if (open.state === "activating") throw fail(409, "Anetix is switching the site on right now, so the order cannot be withdrawn here. Write to Anetix and they will cancel it.", { code: "activating" });
    if (open.state !== "signed") throw fail(409, "This order is not signed, so there is nothing to withdraw. Leave it as it is, and nothing happens.", { code: "draft" });
    await c.query(`UPDATE platform.orders SET state='void', note='withdrawn by the customer before the site was switched on', voided_by=$2, voided_at=now(), updated_at=now(),
                     stripe = CASE WHEN payment_method IS NULL THEN stripe ELSE ${addDetach("payment_method")} END WHERE id=$1`, [open.id, acc.kind === "a" ? "admin" : "manager"]);
    if (open.kind === "customer") await c.query("UPDATE platform.sites SET stage=$2, updated_at=now(), updated_by='anetix.ai' WHERE id=$1", [site.id, open.from_stage || "demo"]);
    return { order: open.id, kind: open.kind, detach: open.payment_method ? [open.payment_method] : [], expire: !open.payment_method && open.setup_session ? open.setup_session : null };
  });
  await logEvent("order_withdrawn", acc.co.slug, { order: r.order, by: acc.kind === "a" ? "admin" : "manager", preview: r.kind === "preview" });
  return { ...(await view(access, acc)), detach_cards: r.detach, expire_session: r.expire };
}

// Brendan withdraws a site's open order (a preview he is done with, or a customer's he will not activate). A
// customer's site goes back to the stage it had before the order, and the manager sees the note the next time they
// open Go live. A card Stripe holds for it is listed for removal (stage 3 removes it; the Stripe dashboard can too).
async function adminVoid(slug, { note } = {}, by) {
  slug = String(slug || "").toLowerCase();
  const site = SLUG.test(slug) ? (await q("SELECT * FROM platform.sites WHERE company=$1", [slug])).rows[0] : null;
  if (!site) throw fail(404, "no such site");
  const words = clean(note, 300);
  const r = await withSite({ site: { id: site.id }, who: "admin" }, async (c, s, open) => {
    if (!open) throw fail(409, "this site has no open order");
    if (open.state === "activating") throw fail(409, "this order is switching on; wait for it to finish");
    const customer = open.kind === "customer";
    if (customer && words.length < 3) throw fail(400, "say why, in a few words: the manager is shown it");
    const noteOut = customer ? `Anetix withdrew this order: ${words}` : `preview voided${words ? `: ${words}` : ""}`;
    await c.query(`UPDATE platform.orders SET state='void', note=$2, voided_by='admin', voided_at=now(), updated_at=now(),
                     stripe = CASE WHEN payment_method IS NULL THEN stripe ELSE ${addDetach("payment_method")} END WHERE id=$1`, [open.id, noteOut]);
    if (customer && ["ordering", "signed"].includes(s.stage)) await c.query("UPDATE platform.sites SET stage=$2, updated_at=now(), updated_by=$3 WHERE id=$1", [s.id, open.from_stage || "demo", by || "admin"]);
    return { order: open.id, kind: open.kind, card: Boolean(open.payment_method) };
  });
  await logEvent("order_voided", slug, { ...r, by: by || null, note: words || null });
  return r;
}

// ---- the board, Settings and the Sites tab ----------------------------------------------------------------------------
// The Go live link for a demo's manager (the credit line, the out-of-credit panel, Settings), or null. An admin
// looking at the board gets an admin's link. Only the customer's own order shows here, never a preview.
async function forBoard(co, role) {
  if (!co || !["manager", "admin"].includes(role)) return null;
  // a pilot Anetix offered this company (src/pilot.js) shows whether or not Go live is on for everyone, and to a
  // company that did not come in as a demo too; without one, Go live is a demo's, once the switch is on
  const had = (await q("SELECT * FROM platform.sites WHERE company=$1", [co.slug])).rows[0] || null;
  const P = require("./pilot");
  const offer = had ? P.standing(had) : null;
  const pilotOrder = had && !offer ? await openOrder(had.id).then((o) => (o && o.kind === "customer" && o.state !== "draft" && P.isPilot(o.band) ? o : null)) : null;
  const pilot = Boolean(offer || pilotOrder);
  if (!pilot && !co.demo) return null;
  const open = await isOpen();
  if (!open && role !== "admin" && !pilot) return null;
  const site = had || await ensureSite(co.slug);
  const stage = site.stage || "demo";
  if (stage === "subscribed") return null;
  const t = goliveToken(co.slug, site.id, { kind: role === "admin" ? "a" : "m" });
  if (!t) return null;
  const o0 = await openOrder(site.id), o = o0 && o0.kind === "customer" ? o0 : null;
  const url = `${WWW()}/c/${co.slug}/go-live?t=${t}`;
  const inAlready = ["signed", "activating"].includes(stage);
  const declined = Boolean(o && o.state === "signed" && !o.payment_method && (o.stripe || {}).declined);   // Activate's charge was declined (stage 3)
  const book = await sites.currentBook();
  const started = stage === "ordering";
  const pl = offer ? sites.pilotLine(offer) : pilotOrder ? sites.pilotLine({ monthly_usd: pilotOrder.band.monthly_usd, months: pilotOrder.band.pilot.months }) : null;
  return {
    stage, url, preview: role === "admin", pilot,
    from: pilot ? { line: `Your pilot: ${pl}.`, short: pl } : ["demo", "ordering", "back_to_demo"].includes(stage) ? sites.fromLine(book) : null,   // the price before the form (the launch audit, C7)
    action: inAlready ? "See your order" : declined ? "Add another card" : pilot ? (started ? "Continue with your pilot" : "Start your pilot") : started ? "Continue going live" : "Go live",
    // the Terms, 5.4: Anetix AIMS to switch a site on within 24 hours (Brendan, 2026-09-26)
    line: inAlready ? (pilot ? "Your pilot order is in. Anetix aims to switch this site on within 24 hours, and the first payment is charged then." : "Your order is in. Anetix aims to switch this site on within 24 hours. Until then your demo works as it does now.")
      : declined ? "Your card was declined, so the site is not switched on yet. Use another card to finish going live."
        // an offer is a line of its own on the board, with the way in beside it: it is there for a company with no credit line too
        : pilot ? (started ? `Your pilot is waiting for you to finish signing: ${pl}.` : `Anetix has a pilot ready for you to sign: ${pl}. It ends on its own.`) : null,
    // what Settings' Go live card says before an order is started (the page writes no price of its own)
    pitch: pilot ? `Anetix has offered this site a pilot: ${pl}. It ends on its own, and everything you built stays. Your floor gets its own way in and the AI has no credit to run out of.`
      : book.per_tool_usd ? `Make this demo your site: $${Number(book.per_tool_usd).toLocaleString("en-US")} a month for each tool live on your floor, never more than a cap set by the site's size, with no credit to run out of and a way in for the floor. Everything you built stays.`
        : null,
    waiting_on: o && o.state === "draft" && o.approver ? o.approver.name : null,
    signed_no_card: Boolean(o && o.state === "signed" && !o.payment_method),
    declined,
  };
}
async function adminLink(slug) {
  slug = String(slug || "").toLowerCase();
  if (!SLUG.test(slug) || !(await q("SELECT 1 FROM platform.companies WHERE slug=$1", [slug])).rows[0]) throw fail(404, "no such company");
  if (KEY().length < 16) throw fail(409, "SOS_WWW_KEY is not set on this instance, so anetix.ai cannot be opened from here");
  const site = await ensureSite(slug);
  return { url: `${WWW()}/c/${slug}/go-live?t=${goliveToken(slug, site.id, { kind: "a" })}`, expires_in_hours: 24 };
}
async function ordersOf(slug) {
  slug = String(slug || "").toLowerCase();
  const site = (await q("SELECT * FROM platform.sites WHERE company=$1", [slug])).rows[0];
  if (!site) return { site: null, orders: [] };
  const orders = (await q("SELECT * FROM platform.orders WHERE site_id=$1 ORDER BY created_at DESC", [site.id])).rows.map((o) => ({
    id: o.id, state: o.state, version: o.version, kind: o.kind, band: o.band, price_usd: o.price_usd == null ? null : Number(o.price_usd), price_book: o.price_book,
    terms_version: o.terms_version, terms_sha256: o.terms_sha256, text: o.text, text_sha256: o.text_sha256, facts: o.facts,
    approver: o.approver ? { name: o.approver.name, title: o.approver.title, email: o.approver.email, expires_at: new Date(Number(o.approver.exp) * 1000).toISOString() } : null,
    signer: o.signer, learning_opt_in: o.learning_opt_in, signed_at: o.signed_at, signed_ip: o.signed_ip, signed_net: o.signed_net, signed_ua: o.signed_ua,
    card: o.card, card_saved_at: o.card_saved_at, stripe: o.stripe, note: o.note, voided_by: o.voided_by, voided_at: o.voided_at, created_at: o.created_at, updated_at: o.updated_at,
  }));
  return { site: { id: site.id, stage: site.stage, stripe_customer: site.stripe_customer }, orders };
}
async function termsFor(version) {
  const want = clean(version, 40);
  if (!want || want === terms.TERMS_VERSION) return { ...terms.termsDoc(), sha256: terms.termsHash(), current: true };
  const kept = (await q("SELECT doc, sha256, first_signed_at FROM platform.terms_versions WHERE version=$1", [want])).rows[0];
  if (!kept) throw fail(404, "no such terms version");
  return { ...kept.doc, sha256: kept.sha256, first_signed_at: kept.first_signed_at, current: false };
}

// ---- routes -----------------------------------------------------------------------------------------------------------
const json = express.json({ limit: "40kb" });
const guard = (fn) => async (req, res) => {
  try { res.set("Cache-Control", "no-store").json(await fn(req.body || {}, req)); }
  catch (e) {
    if (!e.status) console.error("[golive]", e.stack || e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : "Something went wrong on the platform. Try again in a minute.", code: e.code, fields: e.fields });
  }
};
const wwwRouter = express.Router();
wwwRouter.use("/api/www/golive", (req, res, next) => (require("./selfserve").keyOk(req) ? next() : res.status(401).json({ error: "www key required" })));
wwwRouter.post("/api/www/golive/view", json, guard((b) => view(b.access)));
wwwRouter.post("/api/www/golive/save", json, guard((b) => save(b.access, b)));
wwwRouter.post("/api/www/golive/approver", json, guard((b) => setApprover(b.access, b)));
wwwRouter.post("/api/www/golive/sign", json, guard((b) => sign(b.access, b)));
wwwRouter.post("/api/www/golive/checkout", json, guard((b) => checkout(b.access, b)));
wwwRouter.post("/api/www/golive/start-over", json, guard((b) => startOver(b.access)));
wwwRouter.post("/api/www/golive/withdraw", json, guard((b) => withdraw(b.access)));
wwwRouter.post("/api/www/golive/card", json, guard((b) => cardSaved(b)));
wwwRouter.get("/api/www/golive/terms", guard((_b, req) => termsFor(req.query.version)));

const router = express.Router();
const requireAdmin = (req, res, next) => require("./auth").requireAdmin(req, res, next);
const requireManager = (req, res, next) => require("./auth").requireManager(req, res, next);
const who = (req) => (req.sosAccount ? req.sosAccount.name || req.sosAccount.login : "admin");
router.get("/api/admin/golive", requireAdmin, guard(() => status()));
router.post("/api/admin/golive", requireAdmin, json, guard((b, req) => setOpen(b.open === true, who(req))));
router.get("/api/admin/sites/:slug/golive-link", requireAdmin, guard((_b, req) => adminLink(req.params.slug)));
router.get("/api/admin/sites/:slug/orders", requireAdmin, guard((_b, req) => ordersOf(req.params.slug)));
router.post("/api/admin/sites/:slug/void-order", requireAdmin, json, guard((b, req) => adminVoid(req.params.slug, b, who(req))));
// Settings' Go live card (managers only: the floor never sees a way to sign for the company)
router.get("/api/c/:slug/golive", requireManager, guard(async (_b, req) => {
  const co = (await q("SELECT slug, name, demo FROM platform.companies WHERE slug=$1", [String(req.params.slug || "").toLowerCase()])).rows[0];
  if (!co) throw fail(404, "no such company");
  return { golive: await forBoard(co, req.sosRole) };
}));

module.exports = {
  init, SCHEMA, status, isOpen, setOpen, openOrder, addDetach, cardsToRemove, TO_REMOVE_SQL, ensureSite, forBoard, adminLink, ordersOf, adminVoid, termsFor,
  view, save, setApprover, sign, checkout, cardSaved, startOver, withdraw, resolve, withSite, assentFor,
  goliveToken, readGoliveToken, approverToken, readApproverToken, cleanFacts, missingFacts, customerFor, bandSnap, quoteFor, cleanCard, cleanNet, previewStage,
  wwwRouter, router,
};
