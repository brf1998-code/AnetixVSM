// Paid sites, stage 1 (2026-09-26, docs/PAID-SITES.md): the price book, sizing a site, the fair-use line, the stages
// a site moves through, the order form's text, the credit a demo gets back when it goes live, and the Sites tab of
// /admin (the pipeline). Nothing here charges anyone or changes what a company can do yet. Stage 2 adds the go-live
// screens on anetix.ai, stage 3 activation and the rollover, stage 4 the month to month.
//
// Brendan's decisions (2026-09-26): priced per site, never per seat or by usage, everything inside a site unlimited;
// five bands by the people at the site counting every shift (50 to 99 at $1,750 added to smooth the jump at 50);
// floor space moves a site up one band at most; self-reported, no audit; no start rate, a site pays its band from
// month one ("they will go to full pricing right away depending on size of the site"); the admin activates every
// site; cancelling returns a site to a demo; a site's AI cost in a billing period may not pass 80% of its fee.
//
// Tables (in the backup, gone with the company):
//   platform.price_books  one row per version: the bands, their floor-space thresholds, the fair-use share. Version 1
//                         is written from BOOK_V1 at every boot until a site has signed under it; after that it is
//                         frozen and a new list price is version 2 (a signed site keeps the book it signed under).
//   platform.sites        one row per company in the pipeline: the facts (site, legal name, address, plant manager,
//                         headcount, floor space), the deal (what they asked for, the master agreement, the plant
//                         manager's approval limit), a note, and the stage. `id` is the site's permanent id: what
//                         orders and Stripe will point at from stage 2 on, because a freed slug goes to the next
//                         company with the same name (selfserve.freeSlug). A self-serve company has no row until
//                         someone writes one; the pipeline shows every self-serve company either way.
//
// Routes (admin only, on the /api/admin path space no module page's policy opens):
//   GET  /api/admin/sites                 the price book, the count per stage, one row per site
//   POST /api/admin/sites/quote           { headcount, sqft }: the band and its price (the Sites tab's quick quote)
//   POST /api/admin/sites/:slug           { site_name, legal_name, site_address, plant_manager, headcount, sqft,
//                                           deal, note }: the pipeline fields; only the keys sent change
const crypto = require("crypto");
const express = require("express");
const { q, logEvent } = require("./db");

const SLUG = /^[a-z0-9][a-z0-9-]{1,40}$/;
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const fail = (status, msg) => Object.assign(new Error(msg), { status });

// ---- the price book ------------------------------------------------------------------------------------------------
// Headcount ranges are whole people and touch without overlapping (the strategy wrote "50 to 200" and "200 to 500";
// here 200 is Large and 500 is Very large). sqft_min: the floor space that moves a site from the band below into this
// one (proposed 2026-09-26: 1,500 square feet a person at each edge, three times the manufacturing norm of about 500,
// the warehouse figure, so only a site that is big for its headcount moves). `proposed`: a price Brendan has not
// settled yet (the strategy's word for Large and Very large).
const BOOK_V1 = Object.freeze({
  version: 1,
  fair_use_share: 0.8,      // decided: a site's AI cost in a billing period may not pass 80% of the period's fee
  alert_share: 0.5,         // Brendan is told at half the fee; the customer never is
  sqft_proposed: true,
  bands: [
    { key: "small", name: "Small", min: 1, max: 49, monthly_usd: 1000, sqft_min: null },
    { key: "mid", name: "Mid", min: 50, max: 99, monthly_usd: 1750, sqft_min: 75000 },
    { key: "core", name: "Core", min: 100, max: 199, monthly_usd: 2500, sqft_min: 150000 },
    { key: "large", name: "Large", min: 200, max: 499, monthly_usd: 3500, sqft_min: 300000, proposed: true },
    { key: "very_large", name: "Very large", min: 500, max: null, monthly_usd: 5000, sqft_min: 750000, proposed: true },
  ].map((b) => Object.freeze(b)),
  note: "Five bands by the people at the site, all shifts; full price from month one; floor space moves a site up one band at most.",
});

// Why a book cannot be used, or [] when it can. Pure: the tests hold BOOK_V1 to it, and boot refuses to seed a bad one.
function bookProblems(book) {
  const out = [];
  if (!book || !Array.isArray(book.bands) || !book.bands.length) return ["a price book needs bands"];
  if (!Number.isInteger(book.version) || book.version < 1) out.push("the version is a whole number, 1 or more");
  if (!(book.fair_use_share > 0 && book.fair_use_share <= 1)) out.push("the fair-use share is above 0 and at most 1");
  if (!(book.alert_share > 0 && book.alert_share <= book.fair_use_share)) out.push("the alert comes at or before the fair-use line");
  const keys = new Set();
  book.bands.forEach((b, i) => {
    const prev = book.bands[i - 1];
    if (!b.key || keys.has(b.key)) out.push(`band ${i + 1} needs a key of its own`); keys.add(b.key);
    if (!b.name) out.push(`band ${b.key} needs a name`);
    if (i === 0 && b.min !== 1) out.push("the first band starts at 1 person");
    if (prev && b.min !== prev.max + 1) out.push(`band ${b.key} starts right after ${prev.key} ends (at ${prev.max + 1})`);
    if (b.max != null && !(Number.isInteger(b.max) && b.max >= b.min)) out.push(`band ${b.key} ends at or after it starts`);
    if (b.max == null && i !== book.bands.length - 1) out.push(`only the last band is open-ended (${b.key} is not last)`);
    if (i === book.bands.length - 1 && b.max != null) out.push("the last band is open-ended");
    if (!(Number.isFinite(b.monthly_usd) && b.monthly_usd > 0)) out.push(`band ${b.key} needs a monthly price`);
    if (prev && !(b.monthly_usd > prev.monthly_usd)) out.push(`band ${b.key} costs more than ${prev.key}`);
    if (i === 0 && b.sqft_min != null) out.push("the first band has no floor-space threshold");
    if (i > 0 && !(Number.isInteger(b.sqft_min) && b.sqft_min > 0)) out.push(`band ${b.key} needs a floor-space threshold`);
    if (i > 1 && prev.sqft_min != null && !(b.sqft_min > prev.sqft_min)) out.push(`band ${b.key}'s floor-space threshold is above ${prev.key}'s`);
  });
  return out;
}

// The price book as the Sites tab shows it: each band with its annual price, fair-use line and the alert. Pure.
function bookView(book = BOOK_V1) {
  return {
    version: book.version, fair_use_share: book.fair_use_share, alert_share: book.alert_share, sqft_proposed: Boolean(book.sqft_proposed), note: book.note || null,
    bands: book.bands.map((b) => ({ ...b, annual_usd: b.monthly_usd * 12, fair_use_usd: round2(b.monthly_usd * book.fair_use_share), alert_usd: round2(b.monthly_usd * book.alert_share), proposed: Boolean(b.proposed) })),
  };
}

// ---- sizing a site ------------------------------------------------------------------------------------------------
const wholeOrNull = (v) => { if (v === null || v === undefined || v === "") return null; const n = Number(String(v).replace(/[, ]/g, "")); return Number.isInteger(n) ? n : NaN; };

// What is worth a second look in a site's size, for Brendan's eye at activation (never shown to the customer). Pure.
//   edge: the headcount is within five below the next band, the place a shaded number would sit
//   space: the floor space per person is outside what a plant looks like (under 150 is office density; over 5,000
//          is a warehouse with a few people in it). Neither changes the band.
function flagsOf({ headcount, sqft = null }, book = BOOK_V1) {
  const out = [];
  const h = Number(headcount);
  if (!Number.isInteger(h) || h < 1) return out;
  for (const b of book.bands) if (b.min > 1 && h < b.min && h >= b.min - 5) out.push({ kind: "edge", text: `${h} people is within five of ${b.name} (${b.min} and up)` });
  if (sqft != null && Number.isFinite(Number(sqft)) && Number(sqft) > 0) {
    const per = Number(sqft) / h;
    if (per < 150) out.push({ kind: "space", text: `${Math.round(per).toLocaleString("en-US")} square feet a person looks low for a plant` });
    else if (per > 5000) out.push({ kind: "space", text: `${Math.round(per).toLocaleString("en-US")} square feet a person looks high for a plant` });
  }
  return out;
}

// The band a site's facts put it in, or null when the headcount is not a whole number of people. headcount: the
// people at the site counting every shift. sqft: its floor space, or null when not given. Floor space at or over the
// NEXT band's threshold moves the site up that one band, never further. Pure.
function bandOf({ headcount, sqft = null } = {}, book = BOOK_V1) {
  const h = Number(headcount);
  if (!Number.isInteger(h) || h < 1) return null;
  const s = sqft === null || sqft === undefined || sqft === "" ? null : Number(sqft);
  const bands = book.bands;
  const byHead = bands.findIndex((b) => h >= b.min && (b.max == null || h <= b.max));
  if (byHead < 0) return null;
  let i = byHead;
  const up = bands[byHead + 1];
  const moved = Boolean(up && up.sqft_min != null && s != null && Number.isFinite(s) && s >= up.sqft_min);
  if (moved) i = byHead + 1;
  const b = bands[i];
  return {
    key: b.key, name: b.name, min: b.min, max: b.max,
    monthly_usd: b.monthly_usd, annual_usd: b.monthly_usd * 12,
    fair_use_usd: round2(b.monthly_usd * book.fair_use_share), alert_usd: round2(b.monthly_usd * book.alert_share),
    by_headcount: bands[byHead].key, moved_up: moved,
    why: moved ? `${h} people is ${bands[byHead].name}; ${Number(s).toLocaleString("en-US")} square feet moves it up one band` : `${h} people`,
    proposed: Boolean(b.proposed), book: book.version,
    flags: flagsOf({ headcount: h, sqft: s }, book),
  };
}

// ---- the fair-use line ---------------------------------------------------------------------------------------------
// Where a site stands against the line in one billing period. fee_usd: the band price for the period (before tax and
// before any credit on the bill). Pure; stage 3 calls it from the gate every AI start passes.
function fairUse({ spend_usd = 0, fee_usd, share = BOOK_V1.fair_use_share, alert_share = BOOK_V1.alert_share, lifted = false } = {}) {
  const fee = Number(fee_usd || 0), spend = round2(spend_usd);
  const line = round2(fee * share);
  return {
    fee_usd: round2(fee), line_usd: line, spend_usd: spend,
    share_of_line: line > 0 ? Math.round((spend / line) * 1000) / 1000 : 0,
    share_of_fee: fee > 0 ? Math.round((spend / fee) * 1000) / 1000 : 0,
    alert: fee > 0 && spend >= fee * alert_share,
    over: !lifted && line > 0 && spend >= line,
    lifted: Boolean(lifted),
  };
}

// ---- the stages ----------------------------------------------------------------------------------------------------
// A site has a stage; while subscribed it also has a payment standing (from Stripe's own status, re-read at every
// event) and, apart from that, a cancel date. Pure: next(state, event) answers the new state and what the platform
// must do about it, or why the event does not apply. Stage 1 drives nothing with it; the tests hold every transition
// (docs/PAID-SITES.md "The life of a site"), and stages 2 to 4 call it from the routes and the webhook.
const STAGES = ["demo", "ordering", "signed", "activating", "subscribed", "back_to_demo"];
const STANDINGS = ["good", "past_due", "unpaid"];
const STAGE_LABEL = { demo: "Demo", ordering: "Ordering", signed: "Signed, waiting on you", activating: "Switching on", subscribed: "Subscribed", back_to_demo: "Back to demo" };
const STANDING_LABEL = { good: "paid up", past_due: "payment failed, Stripe retrying", unpaid: "unpaid, AI paused" };
function next(state, event) {
  const s = { stage: "demo", standing: null, cancel_at: null, attention: null, ...(state || {}) };
  const e = event || {};
  const no = (why) => ({ ok: false, why });
  const to = (patch, effects = []) => ({ ok: true, state: { ...s, ...patch }, effects });
  switch (e.type) {
    case "start_order":
      if (["demo", "ordering", "back_to_demo"].includes(s.stage)) return to({ stage: "ordering" });
      return no(s.stage === "subscribed" ? "the site is subscribed already" : "an order is signed already; send it back or decline it first");
    case "card_saved":
      if (s.stage !== "ordering") return no("only an order being filled in can have a card saved to it");
      if (!e.order_signed) return no("the order form is not signed yet");
      return to({ stage: "signed" }, ["tell_admin"]);
    case "send_back":
      if (s.stage !== "signed") return no("only a signed order can be sent back");
      return to({ stage: "ordering" }, ["void_order", "tell_manager"]);
    case "decline":
      if (s.stage !== "signed") return no("only a signed order can be declined");
      return to({ stage: "demo" }, ["void_order", "detach_card", "tell_manager"]);
    case "activate":
      if (s.stage !== "signed") return no(s.stage === "activating" ? "it is switching on already" : "only a signed order can be activated");
      return to({ stage: "activating" }, ["subscribe"]);
    case "card_declined":
      if (s.stage !== "activating") return no("the site is not switching on");
      return to({ stage: "signed" }, ["reverse_balance_credit", "tell_manager"]);
    case "activated":   // the rollover: runs on the Activate answer or the first invoice.paid, whichever comes first
      if (s.stage === "subscribed") return to({});   // the second of the two: nothing more to do
      if (s.stage !== "activating") return no("the site is not switching on");
      return to({ stage: "subscribed", standing: "good", cancel_at: null, attention: null }, ["rollover"]);
    case "stripe_status": {   // e: { status, cancel_at }: the subscription as Stripe says it is now
      if (s.stage !== "subscribed") return no("the site is not subscribed");
      if (e.status === "canceled") return to({ stage: "back_to_demo", standing: null, cancel_at: null }, ["return_to_demo"]);
      const standing = { active: "good", past_due: "past_due", unpaid: "unpaid" }[e.status];
      if (!standing) return no(`a subscription status of ${e.status || "nothing"} means nothing here`);
      const cancel_at = e.cancel_at || null;
      // a cancel on a month nobody paid for ends it now: the order form's "end of the month already paid" is past
      if (cancel_at && standing !== "good") return to({ standing, cancel_at }, ["end_now"]);
      return to({ standing, cancel_at });
    }
    case "ended":   // customer.subscription.deleted for the site's current subscription, or End went through
      if (s.stage !== "subscribed") return no("the site is not subscribed");
      return to({ stage: "back_to_demo", standing: null, cancel_at: null }, ["return_to_demo"]);
    case "end":     // Brendan's End: only once Stripe has given up on the payment
      if (s.stage !== "subscribed") return no("the site is not subscribed");
      if (s.standing !== "unpaid") return no("End is for a site whose payment has failed for good; a customer cancels in the billing portal");
      return to({}, ["end_now"]);
    case "attention":   // a dispute or a refund: nothing changes on its own, Brendan decides
      if (s.stage !== "subscribed") return no("the site is not subscribed");
      if (!["dispute", "refund"].includes(e.kind)) return no("attention is for a dispute or a refund");
      return to({ attention: e.kind }, ["tell_admin"]);
    default:
      return no(`nothing happens on ${e.type || "an empty event"}`);
  }
}
const subscribed = (s) => Boolean(s && s.stage === "subscribed");   // "Subscribed is the test", whatever the standing

// ---- the order form --------------------------------------------------------------------------------------------------
// The one page a customer signs, with every figure in it. DRAFT for counsel: `terms_version` says so, and stage 2
// shows it only behind that. The signer's typed name is kept beside the text, never in it: the hash is of the page
// they read. Pure.
const TERMS_VERSION = "draft-1";
const usd = (n) => `$${Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
function addressLine(a) {
  if (!a) return "";
  if (typeof a === "string") return a;
  return [a.line1, a.line2, [a.city, [a.state, a.postal_code].filter(Boolean).join(" ")].filter(Boolean).join(", ")].filter(Boolean).join(", ");
}
function orderText({ facts = {}, book = BOOK_V1, terms_version = TERMS_VERSION } = {}) {
  const band = bandOf(facts, book);
  if (!band) throw new Error("the order needs the number of people at the site");
  const sq = facts.sqft == null || facts.sqft === "" ? "not given" : `${Number(facts.sqft).toLocaleString("en-US")} square feet`;
  const pm = facts.plant_manager && facts.plant_manager.name ? facts.plant_manager.name : "not given";
  return [
    "ANETIX SITE ORDER FORM",
    `Terms version: ${terms_version}. Price book: version ${book.version}.`,
    "",
    `Customer: ${facts.legal_name || "not given"}.`,
    `Site: ${facts.site_name || "not given"}, ${addressLine(facts.site_address) || "address not given"}.`,
    `Plant manager: ${pm}.`,
    "",
    `Size, as stated by Customer: ${Number(facts.headcount).toLocaleString("en-US")} people across all shifts; ${sq}.`,
    `Band: ${band.name}${band.moved_up ? " (moved up one band for floor space)" : ""}.`,
    "",
    `Fee: ${usd(band.monthly_usd)} a month, billed monthly in advance to the card on file, plus sales tax where it applies. The first month is billed on the day Anetix switches the Site on.`,
    "Term: month to month. Customer may cancel at any time. A cancellation takes effect at the end of the month already paid, and partial months are not refunded.",
    "Included: use of Anetix at the Site by any number of Customer's people, with no limit on tools, requests or changes.",
    `Fair use: if Anetix's own AI cost for the Site in a billing month passes ${Math.round(book.fair_use_share * 100)}% of that month's fee, new AI work pauses until the next billing month. The Site's tools keep working.`,
    "Price: Anetix will not raise the Site's price while this subscription continues, except to move the Site up a band when its stated size grows. Customer confirms the Site's size once a year, and the band can only move up.",
    "Data: Customer owns the data its people put into Anetix, and Anetix uses it to run the service for Customer. Learning from how the Site uses the system to improve Anetix for all customers happens only if Customer opts in, and Customer's data is never shown to another customer.",
    "After a cancellation: the Site becomes a demo account for Customer's manager. Customer's data is kept until Customer asks for its deletion, or until 12 months pass with no sign-in.",
    "Add-ons: integrations and hardware are optional and quoted separately.",
    "Terms: this order form is governed by the Anetix Terms of Service, version above.",
    "",
    "Signed for Customer by the person named below, who confirms they may sign for Customer.",
  ].join("\n");
}
const textHash = (text) => crypto.createHash("sha256").update(String(text), "utf8").digest("hex");

// ---- the credit a demo gets back when it goes live ------------------------------------------------------------------
// Whatever they bought and did not use comes off the first bill at the rate they paid (docs/PAID-SITES.md "Unused paid
// credit comes back"): free credit (grants, and adjustments such as a written-off overrun or a refunded failure) counts
// as spent first, then purchases oldest first; what is left of the bought credit, never more than the balance, comes
// back at each purchase's own rate. ledger: credit_ledger rows; spent_usd: what the credit has paid for. Pure.
function refundableCredit(ledger = [], spent_usd = 0) {
  const rows = ledger.map((r) => ({ kind: r.kind, credit: Number(r.delta_usd || 0), paid: r.paid_usd == null ? null : Number(r.paid_usd) }));
  const free = rows.filter((r) => r.kind !== "purchase").reduce((n, r) => n + r.credit, 0);
  const bought = rows.filter((r) => r.kind === "purchase" && r.credit > 0);
  const total = free + bought.reduce((n, r) => n + r.credit, 0);
  const spent = Math.max(0, Number(spent_usd || 0));
  const balance = total - spent;
  const out = { credit_usd: 0, refund_usd: 0, balance_usd: round2(balance) };
  if (balance <= 0 || !bought.length) return out;
  let fromBought = Math.max(0, spent - Math.max(0, free));
  let room = balance, credit = 0, refund = 0;
  for (const p of bought) {
    const used = Math.min(p.credit, fromBought); fromBought -= used;
    const left = Math.min(p.credit - used, Math.max(0, room));
    room -= left; credit += left;
    refund += p.paid != null && p.credit > 0 ? left * (p.paid / p.credit) : 0;
  }
  return { credit_usd: round2(credit), refund_usd: round2(refund), balance_usd: round2(balance) };
}

// ---- the pipeline fields, cleaned -----------------------------------------------------------------------------------
// Only the keys that are present are cleaned and returned, so a save changes what it sends and nothing else. Pure.
// -> { fields, problems }
const clean = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[A-Za-z]{2,}$/;
function cleanFields(body = {}) {
  const fields = {}, problems = [];
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  if (has("site_name")) fields.site_name = clean(body.site_name, 120) || null;
  if (has("legal_name")) fields.legal_name = clean(body.legal_name, 160) || null;
  if (has("site_address")) {
    const a = body.site_address || {};
    if (typeof a !== "object" || Array.isArray(a)) problems.push("the address is line1, line2, city, state and postal code");
    else {
      const addr = { line1: clean(a.line1, 160), line2: clean(a.line2, 160), city: clean(a.city, 80), state: clean(a.state, 40), postal_code: clean(a.postal_code, 12), country: clean(a.country, 2).toUpperCase() || "US" };
      if (addr.postal_code && addr.country === "US" && !/^\d{5}(-\d{4})?$/.test(addr.postal_code)) problems.push("a US postal code is five digits (or five, a hyphen and four)");
      if (addr.state && addr.country === "US" && !/^[A-Za-z]{2}$/.test(addr.state)) problems.push("a US state is its two letters, like MA");
      if (addr.state && addr.country === "US") addr.state = addr.state.toUpperCase();
      fields.site_address = Object.values(addr).some((v) => v && v !== "US") ? addr : null;
    }
  }
  if (has("plant_manager")) {
    const p = body.plant_manager || {};
    const pm = { name: clean(p.name, 80), email: clean(p.email, 200).toLowerCase(), title: clean(p.title, 80) };
    if (pm.email && !EMAIL.test(pm.email)) problems.push("the plant manager's email does not look like one");
    fields.plant_manager = pm.name || pm.email || pm.title ? pm : null;
  }
  if (has("headcount")) {
    const h = wholeOrNull(body.headcount);
    if (h === null) fields.headcount = null;
    else if (!Number.isInteger(h) || h < 1 || h > 1000000) problems.push("people at the site is a whole number, 1 or more");
    else fields.headcount = h;
  }
  if (has("sqft")) {
    const s = wholeOrNull(body.sqft);
    if (s === null) fields.sqft = null;
    else if (!Number.isInteger(s) || s < 1 || s > 100000000) problems.push("floor space is a whole number of square feet");
    else fields.sqft = s;
  }
  if (has("deal")) {
    const d = body.deal || {};
    const deal = {};
    if ("integrations" in d) deal.integrations = clean(d.integrations, 200) || null;
    if ("hardware" in d) deal.hardware = clean(d.hardware, 200) || null;
    if ("approval_limit_usd" in d) {
      const n = d.approval_limit_usd === null || d.approval_limit_usd === "" ? null : Number(String(d.approval_limit_usd).replace(/[$, ]/g, ""));
      if (n === null) deal.approval_limit_usd = null;
      else if (!Number.isFinite(n) || n < 0 || n > 100000000) problems.push("the approval limit is a dollar amount");
      else deal.approval_limit_usd = round2(n);
    }
    if ("master_agreement" in d) {
      const m = d.master_agreement || {};
      const at = clean(m.signed_at, 10);
      if (at && !/^\d{4}-\d{2}-\d{2}$/.test(at)) problems.push("the master agreement's date is YYYY-MM-DD");
      deal.master_agreement = { yes: Boolean(m.yes), signed_at: m.yes && at ? at : null };
    }
    fields.deal = deal;
  }
  if (has("note")) fields.note = String(body.note == null ? "" : body.note).trim().slice(0, 2000) || null;
  return { fields, problems };
}

// ---- database -------------------------------------------------------------------------------------------------------
const SCHEMA = `
CREATE TABLE IF NOT EXISTS platform.price_books (
  version     INTEGER PRIMARY KEY,
  effective_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  book        JSONB NOT NULL,
  note        TEXT,
  made_by     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS platform.sites (
  id            UUID PRIMARY KEY,
  company       TEXT NOT NULL UNIQUE,
  stage         TEXT NOT NULL DEFAULT 'demo',
  standing      TEXT,
  cancel_at     TIMESTAMPTZ,
  price_book    INTEGER,
  site_name     TEXT,
  legal_name    TEXT,
  site_address  JSONB,
  plant_manager JSONB,
  headcount     INTEGER,
  sqft          INTEGER,
  deal          JSONB NOT NULL DEFAULT '{}'::jsonb,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    TEXT
);`;
// Version 1 follows the code until a site has gone past ordering under it; from then on it is frozen.
async function init() {
  await q(SCHEMA);
  const bad = bookProblems(BOOK_V1);
  if (bad.length) { console.error(`[sites] the price book in the code is not usable: ${bad.join("; ")}`); return; }
  await q(`INSERT INTO platform.price_books (version, book, note, made_by) VALUES (1, $1, $2, 'platform')
           ON CONFLICT (version) DO UPDATE SET book=EXCLUDED.book, note=EXCLUDED.note
           WHERE NOT EXISTS (SELECT 1 FROM platform.sites WHERE price_book=1 AND stage NOT IN ('demo','ordering'))`,
  [JSON.stringify(BOOK_V1), BOOK_V1.note]);
}
async function currentBook() {
  const r = (await q("SELECT book FROM platform.price_books WHERE effective_at <= now() ORDER BY version DESC LIMIT 1").catch(() => ({ rows: [] }))).rows[0];
  return r && bookProblems(r.book).length === 0 ? r.book : BOOK_V1;
}
async function bookFor(version) {
  if (!version) return currentBook();
  const r = (await q("SELECT book FROM platform.price_books WHERE version=$1", [version])).rows[0];
  return r ? r.book : currentBook();
}
async function siteRow(slug) { return (await q("SELECT * FROM platform.sites WHERE company=$1", [slug])).rows[0] || null; }

// Why this company cannot be deleted yet, or null. A subscribed site has a card being billed; the admin delete never
// talks to Stripe, so End comes first (stage 4). Called from the delete route in src/feedback.js.
async function deleteRefusal(slug) {
  const s = await siteRow(slug);
  if (s && ["activating", "subscribed"].includes(s.stage)) return `${slug} is a paying site. End its subscription first, so the card stops being billed.`;
  return null;
}
async function deleteCompany(slug) { await q("DELETE FROM platform.sites WHERE company=$1", [slug]); }

// Several companies' last activity in one query (the same four sources as the Demos tab).
async function lastActivity(slugs) {
  if (!slugs.length) return {};
  const rows = (await q(`SELECT c AS company, GREATEST(
      (SELECT MAX(created_at) FROM platform.record WHERE company=c),
      (SELECT MAX(updated_at) FROM platform.feedback WHERE company=c),
      (SELECT MAX(updated_at) FROM platform.build_runs WHERE company=c),
      (SELECT MAX(updated_at) FROM platform.module_intakes WHERE company=c)) AS at
    FROM unnest($1::text[]) AS c`, [slugs])).rows;
  return Object.fromEntries(rows.map((r) => [r.company, r.at]));
}
function rowOut(r, { book, tools, credit, last }) {
  const facts = { headcount: r.headcount, sqft: r.sqft };
  const band = r.headcount ? bandOf(facts, book) : null;
  const stage = r.stage || "demo";
  return {
    slug: r.slug, name: r.name, demo: Boolean(r.demo), site_id: r.site_id || null,
    // a company that did not come in on a pin (a pilot made on the admin page, say) has not been a demo: "Not ordered yet"
    stage, stage_label: stage === "demo" && !r.demo ? "Not ordered yet" : STAGE_LABEL[stage] || stage, standing: r.standing || null, standing_label: r.standing ? STANDING_LABEL[r.standing] || r.standing : null,
    cancel_at: r.cancel_at || null,
    site_name: r.site_name || null, legal_name: r.legal_name || null, site_address: r.site_address || null, address_line: addressLine(r.site_address),
    plant_manager: r.plant_manager || null, headcount: r.headcount == null ? null : Number(r.headcount), sqft: r.sqft == null ? null : Number(r.sqft),
    band, price_book: r.price_book || book.version,
    deal: r.deal || {}, note: r.note || null,
    demo_holder: r.pin_label || r.contact || null, demo_email: r.email || null, demo_since: r.demo_since || null,
    tools: tools || [], tools_live: (tools || []).filter((t) => t.live_version).length,
    ai_spent_usd: credit ? credit.spent_usd : null, credit_percent: credit ? credit.percent : null, credit_level: credit ? credit.level : null,
    last_activity: last || null, updated_at: r.updated_at || null, updated_by: r.updated_by || null,
  };
}
// The Sites tab: every self-serve company and every company with a site row, the most recently touched first.
async function pipeline() {
  const book = await currentBook();
  const rows = (await q(`
    SELECT c.slug, c.name, c.demo, s.email, s.contact, s.created_at AS demo_since, p.label AS pin_label,
           st.id AS site_id, st.stage, st.standing, st.cancel_at, st.price_book, st.site_name, st.legal_name, st.site_address,
           st.plant_manager, st.headcount, st.sqft, st.deal, st.note, st.updated_at, st.updated_by
      FROM platform.companies c
      LEFT JOIN platform.self_serve s ON s.company=c.slug
      LEFT JOIN platform.access_pins p ON p.id=s.pin_id
      LEFT JOIN platform.sites st ON st.company=c.slug
     WHERE s.company IS NOT NULL OR st.company IS NOT NULL
     ORDER BY GREATEST(COALESCE(st.updated_at, 'epoch'), COALESCE(s.created_at, 'epoch')) DESC, c.slug`)).rows;
  const slugs = rows.map((r) => r.slug);
  const mods = slugs.length ? (await q("SELECT company, name, title, live_version FROM platform.modules WHERE company = ANY($1) ORDER BY created_at", [slugs])).rows : [];
  const tools = {}; for (const m of mods) (tools[m.company] = tools[m.company] || []).push({ name: m.name, title: m.title, live_version: m.live_version });
  const last = await lastActivity(slugs);
  const selfserve = require("./selfserve");
  const books = { [book.version]: book };
  const out = [];
  for (const r of rows) {
    const b = r.price_book && !books[r.price_book] ? (books[r.price_book] = await bookFor(r.price_book)) : books[r.price_book || book.version];
    out.push(rowOut(r, { book: b, tools: tools[r.slug], credit: await selfserve.credit(r.slug).catch(() => null), last: last[r.slug] }));
  }
  const stages = Object.fromEntries(STAGES.map((s) => [s, 0]));
  for (const r of out) stages[r.stage] = (stages[r.stage] || 0) + 1;
  const attention = out.filter((r) => r.stage === "subscribed" && (r.standing && r.standing !== "good")).length;
  const cancelling = out.filter((r) => r.stage === "subscribed" && r.cancel_at).length;
  return { book: bookView(book), stages, attention, cancelling, rows: out, stage_labels: STAGE_LABEL };
}
async function saveFields(slug, body, by) {
  slug = String(slug || "").toLowerCase();
  if (!SLUG.test(slug)) throw fail(404, "no such company");
  const co = (await q("SELECT slug FROM platform.companies WHERE slug=$1", [slug])).rows[0];
  if (!co) throw fail(404, "no such company");
  const { fields, problems } = cleanFields(body || {});
  if (problems.length) throw fail(400, problems.join(". ") + ".");
  if (!Object.keys(fields).length) throw fail(400, "nothing to save");
  const had = await siteRow(slug);
  if (had && !["demo", "ordering", "back_to_demo"].includes(had.stage)) throw fail(409, "this site has a signed order: its facts are the ones signed. Send the order back to change them.");
  if (fields.deal) fields.deal = { ...((had && had.deal) || {}), ...fields.deal };
  const cols = Object.keys(fields);
  const vals = cols.map((c) => (["site_address", "plant_manager", "deal"].includes(c) ? (fields[c] == null ? null : JSON.stringify(fields[c])) : fields[c]));
  if (had) {
    await q(`UPDATE platform.sites SET ${cols.map((c, i) => `${c}=$${i + 2}`).join(", ")}, updated_at=now(), updated_by=$${cols.length + 2} WHERE company=$1`, [slug, ...vals, by || null]);
  } else {
    await q(`INSERT INTO platform.sites (id, company, ${cols.join(", ")}, updated_by) VALUES ($1, $2, ${cols.map((_, i) => `$${i + 3}`).join(", ")}, $${cols.length + 3})`,
      [crypto.randomUUID(), slug, ...vals, by || null]);
  }
  await logEvent("site_updated", slug, { fields: cols, by: by || null });
  return (await pipeline()).rows.find((r) => r.slug === slug) || null;
}

// ---- routes: admin only ---------------------------------------------------------------------------------------------
const router = express.Router();
const json = express.json({ limit: "20kb" });
const requireAdmin = (req, res, next) => require("./auth").requireAdmin(req, res, next);
const guard = (fn) => async (req, res) => { try { await fn(req, res); } catch (e) { if (!e.status) console.error("[sites]", e.message); res.status(e.status || 500).json({ error: e.message }); } };
const who = (req) => (req.sosAccount ? req.sosAccount.name || req.sosAccount.login : "admin");
router.get("/api/admin/sites", requireAdmin, guard(async (_req, res) => res.set("Cache-Control", "no-store").json(await pipeline())));
router.post("/api/admin/sites/quote", requireAdmin, json, guard(async (req, res) => {
  const { fields, problems } = cleanFields({ headcount: (req.body || {}).headcount, sqft: (req.body || {}).sqft });
  if (problems.length) throw fail(400, problems.join(". ") + ".");
  const band = bandOf(fields, await currentBook());
  if (!band) throw fail(400, "give the number of people at the site");
  res.json({ band });
}));
router.post("/api/admin/sites/:slug", requireAdmin, json, guard(async (req, res) => res.json({ ok: true, site: await saveFields(req.params.slug, req.body, who(req)) })));

module.exports = {
  init, router, pipeline, saveFields, deleteRefusal, deleteCompany, currentBook,
  BOOK_V1, TERMS_VERSION, STAGES, STANDINGS, bookProblems, bookView, bandOf, flagsOf, fairUse, next, subscribed, orderText, textHash, addressLine, refundableCredit, cleanFields,
};
