// Paid sites, stage 1 (2026-09-26, docs/PAID-SITES.md): the price book, sizing a site, the fair-use line, the stages
// a site moves through, the order form's text, the credit a demo gets back when it goes live, and the Sites tab of
// /admin (the pipeline). Nothing here charges anyone or changes what a company can do yet. Stage 2 (src/golive.js)
// adds the go-live screens on anetix.ai, the orders and the signature; stage 3 activation and the rollover, stage 4 the
// month to month.
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

// Version 2 (Brendan, 2026-10-05, "a total overhaul of the payment plan"): $300 a month for each tool live on the
// floor, stacking with every new tool until the site reaches the price its band had in version 1, which is now its
// cap. "It makes entry much easier and it would also cap out their price for maximum expansion within their plant."
// So a band's monthly_usd is the CAP in this book, and the fee is per_tool_usd times the tools live, never under
// min_tools of them and never over the cap (feeFor). A tool counts from the bill after it is first made live; drafts
// and previews are free. He expects this to change as they talk to customers: a new plan is version 3, and a signed
// site keeps the book it signed under.
const BOOK_V2 = Object.freeze({
  version: 2,
  per_tool_usd: 300,        // each tool live on the floor
  min_tools: 1,             // a subscribed site pays for one tool at least
  fair_use_share: 0.8,
  alert_share: 0.5,
  sqft_proposed: true,
  bands: BOOK_V1.bands,     // the same sizes; each band's monthly_usd is the cap
  note: "$300 a month for each tool live on the floor, up to the site's cap, which is set by its size (the band prices of version 1).",
});
const BOOK = BOOK_V2;       // the book the code is on; platform.price_books holds every version
const BOOKS = [BOOK_V1, BOOK_V2];

// Why a book cannot be used, or [] when it can. Pure: the tests hold BOOK_V1 to it, and boot refuses to seed a bad one.
function bookProblems(book) {
  const out = [];
  if (!book || !Array.isArray(book.bands) || !book.bands.length) return ["a price book needs bands"];
  if (!Number.isInteger(book.version) || book.version < 1) out.push("the version is a whole number, 1 or more");
  if (!(book.fair_use_share > 0 && book.fair_use_share <= 1)) out.push("the fair-use share is above 0 and at most 1");
  if (!(book.alert_share > 0 && book.alert_share <= book.fair_use_share)) out.push("the alert comes at or before the fair-use line");
  if (book.per_tool_usd != null) {
    if (!(Number.isFinite(book.per_tool_usd) && book.per_tool_usd > 0)) out.push("the price of a tool is a dollar amount above 0");
    if (!(Number.isInteger(book.min_tools) && book.min_tools >= 0)) out.push("the fewest tools a site pays for is a whole number");
    else if (book.per_tool_usd * book.min_tools > book.bands[0].monthly_usd) out.push("the fewest tools a site pays for cost no more than the first band's cap");
  }
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
function bookView(book = BOOK) {
  return {
    version: book.version, per_tool_usd: book.per_tool_usd || null, min_tools: book.per_tool_usd ? book.min_tools : null, fair_use_share: book.fair_use_share, alert_share: book.alert_share, sqft_proposed: Boolean(book.sqft_proposed), note: book.note || null,
    bands: book.bands.map((b) => ({ ...b, annual_usd: b.monthly_usd * 12, tools_at_cap: book.per_tool_usd ? Math.ceil(b.monthly_usd / book.per_tool_usd) : null, fair_use_usd: round2(b.monthly_usd * book.fair_use_share), alert_usd: round2(b.monthly_usd * book.alert_share), proposed: Boolean(b.proposed) })),
  };
}

// ---- sizing a site ------------------------------------------------------------------------------------------------
const wholeOrNull = (v) => { if (v === null || v === undefined || v === "") return null; const n = Number(String(v).replace(/[, ]/g, "")); return Number.isInteger(n) ? n : NaN; };

// What is worth a second look in a site's size, for Brendan's eye at activation (never shown to the customer). Pure.
//   edge: the headcount is within five below the next band, the place a shaded number would sit
//   space: the floor space per person is outside what a plant looks like (under 150 is office density; over 5,000
//          is a warehouse with a few people in it). Neither changes the band.
function flagsOf({ headcount, sqft = null }, book = BOOK) {
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
function bandOf({ headcount, sqft = null } = {}, book = BOOK) {
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
    // version 2: monthly_usd is the cap, and the fee follows the tools live on the floor (feeFor)
    ...(book.per_tool_usd ? { per_tool_usd: book.per_tool_usd, min_tools: book.min_tools, cap_usd: b.monthly_usd } : {}),
    flags: flagsOf({ headcount: h, sqft: s }, book),
  };
}

// ---- the fee, by the tools live on the floor (price book 2) --------------------------------------------------------
// plan: a band as bandOf answers it or as an order or a site keeps it ({ monthly_usd, per_tool_usd, min_tools }).
// live_tools: how many of the site's tools are live on the floor. A plan with no per_tool_usd is a flat price (a
// version 1 band, or a pilot): its monthly_usd whatever the tools. Pure.
//   -> { usd, tools, billed_tools, per_tool_usd, cap_usd, capped, tools_at_cap, flat }
function feeFor(plan, live_tools = 0) {
  const p = plan || {}, cap = Number(p.cap_usd != null ? p.cap_usd : p.monthly_usd) || 0;
  const n = Math.max(0, Math.floor(Number(live_tools) || 0));
  const per = Number(p.per_tool_usd) || 0;
  if (!(per > 0)) return { usd: round2(cap), tools: n, billed_tools: n, per_tool_usd: null, cap_usd: round2(cap), capped: false, tools_at_cap: null, flat: true };
  const billed = Math.max(Number.isInteger(p.min_tools) ? p.min_tools : 1, n);
  const raw = per * billed;
  return { usd: round2(Math.min(raw, cap)), tools: n, billed_tools: billed, per_tool_usd: per, cap_usd: round2(cap), capped: raw >= cap, tools_at_cap: Math.ceil(cap / per), flat: false };
}
const toolsWord = (n) => `${Number(n).toLocaleString("en-US")} tool${Number(n) === 1 ? "" : "s"}`;
// The fee in a few words, for a list or a phone alert: "$600 a month (2 tools live; $300 a tool, never more than $1,000)". Pure.
function feeLine(plan, live_tools = 0) {
  const f = feeFor(plan, live_tools);
  if (f.flat) return `${usd(f.usd)} a month`;
  return `${usd(f.usd)} a month (${toolsWord(f.tools)} live; ${usd(f.per_tool_usd)} a tool, never more than ${usd(f.cap_usd)})`;
}

// ---- the fair-use line ---------------------------------------------------------------------------------------------
// Where a site stands against the line in one billing period. fee_usd: the band price for the period (before tax and
// before any credit on the bill). Pure; stage 3 calls it from the gate every AI start passes.
function fairUse({ spend_usd = 0, fee_usd, share = BOOK.fair_use_share, alert_share = BOOK.alert_share, lifted = false } = {}) {
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
// stage 3 records the standing (src/activate.js billingEvent); what each does to the site (the AI paused while unpaid,
// back to a demo) is stage 4, so the words say what Stripe says and no more
const STANDING_LABEL = { good: "paid up", past_due: "payment failed, Stripe retrying", unpaid: "unpaid, Stripe's retries ran out", canceled_at_stripe: "cancelled at Stripe: see to it" };
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
    case "card_declined":   // the first charge was declined: the card is removed, so the order waits for another (stage 3)
      if (s.stage !== "activating") return no("the site is not switching on");
      return to({ stage: "ordering" }, ["reverse_balance_credit", "detach_card", "tell_manager"]);
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
      // (a pilot's own end date, e.planned_end, is not a cancel: a late payment in its last month is retried like any other)
      if (cancel_at && standing !== "good" && !e.planned_end) return to({ standing, cancel_at }, ["end_now"]);
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
// The one page a customer signs, with every figure in it. `terms_version` names the Terms it points at, and stage 2
// shows it only behind that. The signer's typed name is kept beside the text, never in it: the hash is of the page
// they read. Pure.
const TERMS_VERSION = require("./terms").TERMS_VERSION;   // the Terms of Service the order form points at (src/terms.js)
const usd = (n) => `$${Number(n).toLocaleString("en-US", Number.isInteger(Number(n)) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;   // $1,000 and $1,000.50, never $1,000.5
function addressLine(a) {
  if (!a) return "";
  if (typeof a === "string") return a;
  return [a.line1, a.line2, [a.city, [a.state, a.postal_code].filter(Boolean).join(" ")].filter(Boolean).join(", ")].filter(Boolean).join(", ");
}
// Three order forms, by what is being signed:
//   a pilot       (offer: what Anetix offered this one company from the Sites tab, src/pilot.js) a fixed monthly fee
//                 for a fixed number of months that ends on its own, with the offer's own lines
//   by the tool   (price book 2) $300 a month for each tool live on the floor, up to the site's cap; live_tools is how
//                 many are live when the text is made, so the figure the signer reads is today's
//   by the band   (price book 1) one price for the site, set by its size
const stop = (x) => (/[.!?]$/.test(x) ? x : `${x}.`);   // "Acme Wire & Cable, Inc." ends its own sentence
const monthsWord = (n) => `${n} month${n === 1 ? "" : "s"}`;
function partyLines(facts) {
  const pm = facts.plant_manager && facts.plant_manager.name ? facts.plant_manager.name : "not given";
  return [
    stop(`Customer: ${facts.legal_name || "not given"}`),
    stop(`Site: ${facts.site_name || "not given"}, ${addressLine(facts.site_address) || "address not given"}`),
    stop(`Plant manager: ${pm}`),
    ...(facts.billing && facts.billing.email ? [stop(`Billing email: ${facts.billing.email}`)] : []),
  ];
}
const DATA_LINE = "Data: Customer owns the data its people put into Anetix, and Anetix uses it to run the service for Customer. Customer's data is never shown to another customer.";
const learningLine = (facts) => (facts.learning === true
  ? "Learning: Customer opts in. Anetix may learn from how the Site uses the system, to improve Anetix for all customers."
  : "Learning: Customer does not opt in. Anetix does not learn from how the Site uses the system to improve Anetix for other customers.");
const CREDIT_LINE = "Unused demo credit: credit Customer bought for its demo and has not used by the day the Site is switched on comes off the first bill, at the price Customer paid for it.";
const termsLine = (terms_version, terms_url) => `Terms: this order form is an Order Form under the Anetix Terms of Service, version ${terms_version}${terms_url ? `, at ${terms_url}` : ""}, as updated under section 19.`;
const SIGNED_LINE = "Signed for Customer by the person named below, who confirms they may sign for Customer.";

// The pilot's own order form (Brendan, 2026-10-05, for Chelsea Clock: "$1,000 then another $1,000 at the start of the
// second month", ending on its own; the customer's words: a pilot cost, "not a software license fee" to be paid on an
// ongoing basis, and any commercial arrangement is a separate conversation after it). Pure.
function pilotText({ facts = {}, offer, terms_version = TERMS_VERSION, terms_url = null } = {}) {
  const m = Number(offer.monthly_usd), n = Number(offer.months), share = BOOK.fair_use_share;
  const pay = n === 1 ? `${usd(m)} on the day Anetix switches the Site on`
    : n === 2 ? `${usd(m)} on the day Anetix switches the Site on and ${usd(m)} one month later`
      : `${usd(m)} on the day Anetix switches the Site on and ${usd(m)} on the same day of each of the next ${n - 1} months`;
  return [
    "ANETIX PILOT ORDER FORM",
    `Terms version: ${terms_version}. A pilot offered to Customer by Anetix.`,
    "",
    ...partyLines(facts),
    "",
    `Pilot: a ${n} month pilot of Anetix at the Site. It starts on the day Anetix switches the Site on and ends ${monthsWord(n)} later.`,
    `Fee: ${usd(m)} a month for ${monthsWord(n)}, ${usd(m * n)} in all, plus sales tax where it applies, charged to the card on file: ${pay}.`,
    "What the fee is: the fee covers building and running the pilot. It is not a software license or subscription fee, and nothing in this order form commits Customer to pay anything after the pilot.",
    "End: the pilot ends on its own on its end date. No charge is made after the payments above unless Customer and Anetix agree new terms in writing. Any continuing arrangement is a separate conversation after the pilot.",
    "Cancelling: Customer may cancel at any time, in the Service's billing settings or by writing to Anetix. A payment not yet made is then not charged. Payments already made are not refunded, except as the Terms provide.",
    "Included: use of Anetix at the Site by any number of Customer's people during the pilot, with no limit on tools, requests or changes.",
    `Fair use: if Anetix's own AI cost for the Site in a month of the pilot passes ${Math.round(share * 100)}% of that month's fee, new AI work pauses until the next month. A fair-use pause does not stop the Site's tools.`,
    ...(offer.lines || []).map((l) => stop(`${l.label}: ${l.text}`)),
    DATA_LINE,
    learningLine(facts),
    "After the pilot: unless Customer and Anetix have agreed to continue, the Site becomes a demo account for Customer's manager and the floor's sign-in closes. Customer's data is kept until Customer asks for its deletion, or until 12 months pass with no sign-in.",
    CREDIT_LINE,
    termsLine(terms_version, terms_url),
    "Order of precedence: where this order form and the Terms differ on the fee, the length of the pilot or renewal, this order form controls.",
    "",
    SIGNED_LINE,
  ].join("\n");
}
function orderText({ facts = {}, book = BOOK, terms_version = TERMS_VERSION, terms_url = null, live_tools = 0, offer = null } = {}) {
  if (offer && offer.kind === "pilot") return pilotText({ facts, offer, terms_version, terms_url });
  const band = bandOf(facts, book);
  if (!band) throw new Error("the order needs the number of people at the site");
  const sq = facts.sqft == null || facts.sqft === "" ? "not given" : `${Number(facts.sqft).toLocaleString("en-US")} square feet`;
  const head = [
    "ANETIX SITE ORDER FORM",
    `Terms version: ${terms_version}. Price book: version ${book.version}.`,
    "",
    ...partyLines(facts),
    "",
    `Size, as stated by Customer: ${Number(facts.headcount).toLocaleString("en-US")} people across all shifts; ${sq}.`,
  ];
  // Brendan's notes for counsel (2026-09-26): the order form controls billing (Terms 1.5), so without "except as the
  // Terms provide" this line would cancel the refunds in sections 6.4 and 13.2
  const TERM = "Term: month to month. Customer may cancel at any time. A cancellation takes effect at the end of the month already paid, and partial months are not refunded, except as the Terms provide.";
  const tail = [
    DATA_LINE,
    learningLine(facts),
    "After a cancellation: the Site becomes a demo account for Customer's manager. Customer's data is kept until Customer asks for its deletion, or until 12 months pass with no sign-in.",
    "Add-ons: integrations and hardware are optional and quoted separately.",
    CREDIT_LINE,
    termsLine(terms_version, terms_url),
  ];
  if (book.per_tool_usd) {
    const f = feeFor(band, live_tools);
    return [
      ...head,
      `Cap: ${usd(f.cap_usd)} a month. It is the most the Site pays, however many tools it has, and it is set by the Site's size: ${band.name}${band.moved_up ? " (moved up one band for floor space)" : ""}.`,
      "",
      `Fee: ${usd(f.per_tool_usd)} a month for each tool live on the floor at the Site, never less than ${toolsWord(book.min_tools)} and never more than the cap, billed monthly in advance to the card on file, plus sales tax where it applies. The Site has ${toolsWord(f.tools)} live today, which is ${usd(f.usd)} a month. The first month is billed on the day Anetix switches the Site on, for the tools live that day.`,
      "Tools: a tool is live from the day a manager makes it live for the floor. Drafts and previews cost nothing. A tool made live raises the fee from the next bill, and a tool taken off the floor lowers it from the next bill. Nothing is charged part way through a month.",
      TERM,
      "Included: use of Anetix at the Site by any number of Customer's people, with no limit on requests or changes.",
      `Fair use: if Anetix's own AI cost for the Site in a billing month passes ${Math.round(book.fair_use_share * 100)}% of the Site's monthly fee at that time, new AI work pauses until the next billing month. A fair-use pause does not stop the Site's tools.`,
      "Price: Anetix will not raise the price of a tool or the Site's cap while this subscription continues, except to move the cap up a band when the Site's stated size grows. Customer confirms the Site's size once a year, and the band can only move up.",
      ...tail,
      "Order of precedence: where this order form and section 5 of the Terms differ on how the fee is worked out, this order form controls.",
      "",
      SIGNED_LINE,
    ].join("\n");
  }
  return [
    ...head,
    `Band: ${band.name}${band.moved_up ? " (moved up one band for floor space)" : ""}.`,
    "",
    `Fee: ${usd(band.monthly_usd)} a month, billed monthly in advance to the card on file, plus sales tax where it applies. The first month is billed on the day Anetix switches the Site on.`,
    TERM,
    "Included: use of Anetix at the Site by any number of Customer's people, with no limit on tools, requests or changes.",
    `Fair use: if Anetix's own AI cost for the Site in a billing month passes ${Math.round(book.fair_use_share * 100)}% of that month's fee, new AI work pauses until the next billing month. A fair-use pause does not stop the Site's tools.`,   // not "the tools keep working", which reads as an uptime promise
    "Price: Anetix will not raise the Site's price while this subscription continues, except to move the Site up a band when its stated size grows. Customer confirms the Site's size once a year, and the band can only move up.",
    ...tail,
    "",
    SIGNED_LINE,
  ].join("\n");
}
// A pilot in a few words: "$1,000 a month for 2 months, $2,000 in all". Pure.
function pilotLine(offer) { const m = Number(offer.monthly_usd), n = Number(offer.months); return `${usd(m)} a month for ${monthsWord(n)}${n > 1 ? `, ${usd(m * n)} in all` : ""}`; }

// What the price screen on anetix.ai says (www pages.js lays these words out and writes none of its own, so the price
// a person reads is always the product's): a pilot, a site priced by the tool, or null for a flat band (price book 1,
// which the page still knows how to say). band: bandOf's answer or an order's snapshot. Pure.
function pricingView({ band, live_tools = 0, offer = null, site_name = "the site", range = "" } = {}) {
  const site = site_name || "the site";
  const INCLUDED = [
    "Everyone at the site, on every shift. There is no count of seats.",
    "A way in for the floor: the site gets its own password for the shared screens.",
    "The AI with no credit to run out of. The order form has a fair-use line for a month far past normal use.",
    "Everything built in the demo stays where it is.",
  ];
  if (offer && offer.kind === "pilot") {
    const m = Number(offer.monthly_usd), n = Number(offer.months);
    return {
      kind: "pilot", price_usd: m,
      headline: `A ${n} month pilot at ${site}`,
      big: usd(m), big_note: `a month for ${monthsWord(n)}${n > 1 ? `, ${usd(m * n)} in all` : ""}. It ends on its own.`,
      fine: [
        `Plus sales tax where it applies. ${n === 1 ? `${usd(m)} is charged on the day Anetix switches the site on.` : n === 2 ? `${usd(m)} is charged on the day Anetix switches the site on and ${usd(m)} one month later.` : `${usd(m)} is charged on the day Anetix switches the site on and on the same day of each of the next ${n - 1} months.`} Nothing is charged after that unless you and Anetix agree new terms.`,
        "This is a pilot fee, not a software license or a subscription. You can cancel at any time, and a payment not yet made is then not charged.",
        "Anetix aims to switch the site on within 24 hours of the order being in (signed, with a card saved), and until then you can withdraw it at no charge.",
      ],
      how_title: "What the pilot is",
      how: (offer.lines || []).map((l) => stop(`${l.label}: ${l.text}`)),
      included: ["Every tool you build during the pilot, and every change to them.", ...INCLUDED],
      next: "Any arrangement after the pilot is a separate conversation, once you have seen what it did.",
      summary: `Pilot: ${pilotLine(offer)}. It ends on its own.`,
    };
  }
  if (!band || !band.per_tool_usd) return null;
  const f = feeFor(band, live_tools);
  return {
    kind: "tools", price_usd: f.usd,
    headline: `${usd(f.per_tool_usd)} a month for each tool live on your floor`,
    big: usd(f.usd), big_note: `a month today, for ${toolsWord(f.tools)} live${f.tools < f.billed_tools ? ` (a site pays for ${toolsWord(f.billed_tools)} at least)` : ""}. Billed monthly. Cancel any time.`,
    fine: [
      `Never more than ${usd(f.cap_usd)} a month, however many tools you have. That is the cap for ${site}: a ${band.name} site${range ? `, ${range}` : ""}${band.moved_up ? " (moved up one band for floor space)" : ""}.`,
      "Plus sales tax where it applies. The first month is billed on the day Anetix switches the site on, for the tools live that day. Anetix aims to do that within 24 hours of the order being in (signed, with a card saved), and until then you can withdraw it at no charge.",
    ],
    how_title: "How we price",
    how: [
      `You pay for the tools your floor is using. Each tool that is live on the floor is ${usd(f.per_tool_usd)} a month. A draft or a preview costs nothing, so trying an idea is free.`,
      "A tool you make live counts from your next bill, and one you take off the floor stops counting from your next bill.",
      `The price stops climbing at your cap, ${usd(f.cap_usd)} a month, which is set by the size of the site. Past it, every new tool is included.`,
      "We never charge per person or per use. The system gets better each time someone on the floor uses it, and a price on every use would teach people to use it less.",
    ],
    included: ["Every change to your tools, and as many requests as the floor sends.", ...INCLUDED],
    next: null,
    summary: `${usd(f.usd)} a month today (${toolsWord(f.tools)} live), never more than ${usd(f.cap_usd)}`,
  };
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
// Version 1 follows the code until an order has been signed under it (or a site has gone past ordering); from then on
// it is frozen, and a new list price is version 2. (Found by the review of 2026-09-26: the orders carry the book, so the
// freeze has to look at them.)
async function init() {
  await q(SCHEMA);
  await q("ALTER TABLE platform.sites ADD COLUMN IF NOT EXISTS offer JSONB");   // a pilot Anetix offered this one company (src/pilot.js)
  await q(require("./golive").SCHEMA);   // the orders, so the freeze below can see a signed one (src/golive.js makes them)
  for (const book of BOOKS) {
    const bad = bookProblems(book);
    if (bad.length) { console.error(`[sites] price book ${book.version} in the code is not usable: ${bad.join("; ")}`); continue; }
    await q(`INSERT INTO platform.price_books (version, book, note, made_by) VALUES ($3, $1, $2, 'platform')
             ON CONFLICT (version) DO UPDATE SET book=EXCLUDED.book, note=EXCLUDED.note
             WHERE NOT EXISTS (SELECT 1 FROM platform.sites WHERE price_book=$3 AND stage NOT IN ('demo','ordering'))
               AND NOT EXISTS (SELECT 1 FROM platform.orders WHERE price_book=$3 AND state NOT IN ('draft','void'))`,
    [JSON.stringify(book), book.note, book.version]);
  }
}
// How many of a company's tools are live on the floor: what price book 2 bills by. db: q, or a transaction's client.
async function liveTools(slug, db) {
  const run = db && db.query ? (t, p) => db.query(t, p) : q;
  return (await run("SELECT count(*)::int AS n FROM platform.modules WHERE company=$1 AND live_version IS NOT NULL", [slug])).rows[0].n;
}
// The price floor in words, from a book's first band (the launch audit, C7: a demo sees what a site costs before the
// go-live form asks for anything). Pure. { line: "Sites start at $1,000 a month, for under 50 people.", short: "from $1,000 a month" }
function fromLine(book = BOOK) {
  const b = ((book && book.bands) || [])[0];
  if (!b || !(Number(b.monthly_usd) > 0)) return null;
  const price = `$${Number(b.monthly_usd).toLocaleString("en-US")}`;
  if (book.per_tool_usd) {   // by the tool: the entry price, and the first band's cap
    const per = `$${Number(book.per_tool_usd).toLocaleString("en-US")}`;
    return { line: `A site is ${per} a month for each tool live on the floor, and never more than its cap: ${price} a month${b.max != null ? ` for under ${Number(b.max) + 1} people` : ""}.`, short: `${per} a month a tool` };
  }
  return { line: `Sites start at ${price} a month${b.max != null ? `, for under ${Number(b.max) + 1} people` : ""}.`, short: `from ${price} a month` };
}
async function currentBook() {
  const r = (await q("SELECT book FROM platform.price_books WHERE effective_at <= now() ORDER BY version DESC LIMIT 1").catch(() => ({ rows: [] }))).rows[0];
  return r && bookProblems(r.book).length === 0 ? r.book : BOOK;
}
async function bookFor(version) {
  if (!version) return currentBook();
  const r = (await q("SELECT book FROM platform.price_books WHERE version=$1", [version])).rows[0];
  return r ? r.book : currentBook();
}
async function siteRow(slug) { return (await q("SELECT * FROM platform.sites WHERE company=$1", [slug])).rows[0] || null; }
// The fact columns a customer's order carries (the deal's integrations and hardware too: what they asked for).
const FACT_COLS = ["site_name", "legal_name", "site_address", "plant_manager", "headcount", "sqft"];
// JSON with the keys sorted, so a value read back from JSONB (which keeps its own key order) compares equal. Pure.
function stable(v) {
  if (v === undefined) v = null;
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

// Why this company cannot be deleted yet, or null. A subscribed site has a card being billed; the admin delete never
// talks to Stripe, so End comes first (stage 4). Called from the delete route in src/feedback.js.
async function deleteRefusal(slug) {
  const s = await siteRow(slug);
  if (s && ["activating", "subscribed"].includes(s.stage)) return `${slug} is a paying site. End its subscription first, so the card stops being billed.`;
  if (s && s.switched_on) return `${slug} is switched on as a site. Switch it back to a trial on the Sites tab first.`;
  return null;
}
// The site's row goes with the company; its orders stay, keyed by the site's id, because they are the contract record
// (counsel to confirm). An order still open is voided, so nothing is left waiting on a site that is gone, and a card
// Stripe holds for it is listed for removal (src/golive.js status: cards_to_remove).
async function deleteCompany(slug) {
  const s = await siteRow(slug);
  if (s) await q(`UPDATE platform.orders SET state='void', note='the company was deleted', voided_by='admin', voided_at=now(), updated_at=now(),
                     stripe = CASE WHEN payment_method IS NULL THEN stripe ELSE ${require("./golive").addDetach("payment_method")} END
                   WHERE site_id=$1 AND state IN ('draft','signed')`, [s.id]).catch((e) => console.error("[sites] voiding the orders of", slug, e.message));
  await q("DELETE FROM platform.sites WHERE company=$1", [slug]);
}

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
// The site's latest order, as the Sites tab shows it (src/golive.js makes them). null when it has none.
function orderOut(r) {
  if (!r.order_id) return null;
  const signer = r.order_signer || null, approver = r.order_approver || null;
  return {
    id: r.order_id, state: r.order_state, version: r.order_version, kind: r.order_kind || "customer",
    band: r.order_band || null, price_usd: r.order_price_usd == null ? null : Number(r.order_price_usd),
    signed_at: r.order_signed_at || null, signer: signer ? { name: signer.name, title: signer.title, email: signer.email, via: signer.via } : null,
    card: r.order_card || null, card_saved: Boolean(r.order_card_saved),
    approver: approver ? { name: approver.name, email: approver.email } : null,
    note: r.order_note || null, created_at: r.order_created_at || null, updated_at: r.order_updated_at || null,
    // stage 3: where Activate stands (the last error, a declined card, the subscription made)
    activate: r.order_stripe ? { subscription: r.order_stripe.subscription || null, last_error: r.order_stripe.last_error || null, declined: r.order_stripe.declined || null, attempts: r.order_stripe.attempts || 0 } : null,
  };
}
function rowOut(r, { book, tools, credit, last, fair }) {
  const facts = { headcount: r.headcount, sqft: r.sqft };
  const stage = r.stage || "demo";
  // a subscribed site shows the band and price it signed (stage 3), never one worked out again from the facts
  const signedFee = Number(r.site_price_usd);
  // (price book 2: the band's monthly_usd is its cap and stays so; fee_usd is what the site is on, which the fair-use line follows)
  const capOrFee = stage === "subscribed" && r.site_band && r.site_band.per_tool_usd ? Number(r.site_band.monthly_usd) : signedFee;
  const band = stage === "subscribed" && r.site_band ? { ...r.site_band, monthly_usd: capOrFee, annual_usd: capOrFee * 12, fee_usd: signedFee, flags: [], signed: true,
    fair_use_usd: round2(signedFee * book.fair_use_share), alert_usd: round2(signedFee * book.alert_share), why: r.site_band.why || "the band and price signed on the order form" } : r.headcount ? bandOf(facts, book) : null;
  const order = orderOut(r);
  // 2026-10-05: what the site pays, or would pay today. A pilot (src/pilot.js) is its own fee; price book 2 is by the
  // tools live on the floor, up to the band's cap; a subscribed site reads the amount it is on (price_usd).
  const P = require("./pilot");
  const liveN = (tools || []).filter((t) => t.live_version).length;
  const offer = P.standing({ offer: r.offer, stage });
  const pilot = stage === "subscribed" && P.isPilot(r.site_band) ? { monthly_usd: Number(r.site_band.monthly_usd), months: r.site_band.pilot.months, ends_at: r.site_band.pilot.ends_at || r.cancel_at || null, line: pilotLine({ monthly_usd: r.site_band.monthly_usd, months: r.site_band.pilot.months }) } : null;
  const fee = pilot ? { usd: pilot.monthly_usd, flat: true } : band && band.per_tool_usd ? (stage === "subscribed" ? { ...feeFor(band, liveN), usd: signedFee, due_usd: feeFor(band, liveN).usd } : feeFor(band, liveN)) : band ? { usd: band.monthly_usd, flat: true } : null;
  return {
    offer: offer ? { monthly_usd: Number(offer.monthly_usd), months: Number(offer.months), lines: offer.lines || [], made_by: offer.made_by || null, made_at: offer.made_at || null, line: pilotLine(offer) } : null,
    pilot, fee,
    slug: r.slug, name: r.name, demo: Boolean(r.demo), site_id: r.site_id || null,
    // a company that did not come in on a pin (a pilot made on the admin page, say) has not been a demo: "Not ordered yet"
    // switched on by hand (src/activate.js switchOn, 2026-10-13): a site on the floor, its payment still to come by the usual road
    switched_on: r.switched_on && stage !== "subscribed" ? r.switched_on : null,
    stage, stage_label: r.switched_on && stage !== "subscribed" ? `On, payment to follow${stage === "demo" ? "" : ` (${(STAGE_LABEL[stage] || stage).toLowerCase()})`}` : stage === "demo" && !r.demo ? "Not ordered yet" : STAGE_LABEL[stage] || stage, standing: r.standing || null, standing_label: r.standing ? STANDING_LABEL[r.standing] || r.standing : null,
    cancel_at: r.cancel_at || null,
    site_name: r.site_name || null, legal_name: r.legal_name || null, site_address: r.site_address || null, address_line: addressLine(r.site_address),
    plant_manager: r.plant_manager || null, headcount: r.headcount == null ? null : Number(r.headcount), sqft: r.sqft == null ? null : Number(r.sqft),
    band, price_book: r.price_book || book.version,
    deal: r.deal || {}, note: r.note || null, billing: r.billing || null, stripe_customer: r.stripe_customer || null,
    order, order_open: Boolean(order && ["draft", "signed", "activating"].includes(order.state)),
    demo_holder: r.pin_label || r.contact || null, demo_email: r.email || null, demo_since: r.demo_since || null,
    tools: tools || [], tools_live: (tools || []).filter((t) => t.live_version).length,
    ai_spent_usd: credit ? credit.spent_usd : null, credit_percent: credit ? credit.percent : null, credit_level: credit ? credit.level : null,
    last_activity: last || null, updated_at: r.updated_at || null, updated_by: r.updated_by || null,
    // stage 3: a paying site's subscription and where it stands against the fair-use line this period
    subscription: stage === "subscribed" ? { id: r.stripe_subscription || null, activated_at: r.activated_at || null, period_start: r.period_start || null, period_end: r.period_end || null,
      learning_opt_in: Boolean(r.learning_opt_in), tenancy_note: r.tenancy_note || null, standing: r.standing || "good", cancel_at: r.cancel_at || null } : null,
    fair_use: fair || null,
    attention: r.site_attention || null,   // what Stripe did that Brendan decides on (a subscription it cancelled, say)
  };
}
// The Sites tab: every self-serve company and every company with a site row, the most recently touched first.
async function pipeline() {
  const book = await currentBook();
  const rows = (await q(`
    SELECT c.slug, c.name, c.demo, s.email, s.contact, s.created_at AS demo_since, p.label AS pin_label,
           st.id AS site_id, st.stage, st.standing, st.cancel_at, st.price_book, st.site_name, st.legal_name, st.site_address,
           st.plant_manager, st.headcount, st.sqft, st.deal, st.note, st.updated_at, st.updated_by, st.billing, st.stripe_customer,
           st.stripe_subscription, st.activated_at, st.period_start, st.period_end, st.band AS site_band, st.price_usd AS site_price_usd,
           st.learning_opt_in, st.tenancy_note, st.attention AS site_attention, st.offer, st.switched_on,
           lo.*
      FROM platform.companies c
      LEFT JOIN platform.self_serve s ON s.company=c.slug
      LEFT JOIN platform.access_pins p ON p.id=s.pin_id
      LEFT JOIN platform.sites st ON st.company=c.slug
      LEFT JOIN LATERAL (
        SELECT o.id AS order_id, o.state AS order_state, o.version AS order_version, o.kind AS order_kind, o.band AS order_band,
               o.price_usd AS order_price_usd, o.signed_at AS order_signed_at, o.signer AS order_signer, o.card AS order_card,
               o.payment_method IS NOT NULL AS order_card_saved, o.approver AS order_approver, o.note AS order_note,
               o.created_at AS order_created_at, o.updated_at AS order_updated_at, o.stripe AS order_stripe
          FROM platform.orders o WHERE o.site_id = st.id ORDER BY o.created_at DESC LIMIT 1) lo ON true
     WHERE s.company IS NOT NULL OR st.company IS NOT NULL
     ORDER BY GREATEST(COALESCE(st.updated_at, 'epoch'), COALESCE(s.created_at, 'epoch'), COALESCE(lo.order_updated_at, 'epoch')) DESC, c.slug`)).rows;
  const slugs = rows.map((r) => r.slug);
  const mods = slugs.length ? (await q("SELECT company, name, title, live_version FROM platform.modules WHERE company = ANY($1) ORDER BY created_at", [slugs])).rows : [];
  const tools = {}; for (const m of mods) (tools[m.company] = tools[m.company] || []).push({ name: m.name, title: m.title, live_version: m.live_version });
  const last = await lastActivity(slugs);
  const selfserve = require("./selfserve");
  const books = { [book.version]: book };
  const out = [];
  for (const r of rows) {
    const b = r.price_book && !books[r.price_book] ? (books[r.price_book] = await bookFor(r.price_book)) : books[r.price_book || book.version];
    const fair = r.stage === "subscribed" ? await require("./fairuse").stateOf(r.slug).catch(() => null) : null;
    out.push(rowOut(r, { book: b, tools: tools[r.slug], credit: r.stage === "subscribed" ? null : await selfserve.credit(r.slug).catch(() => null), last: last[r.slug], fair }));
  }
  const stages = Object.fromEntries(STAGES.map((s) => [s, 0]));
  for (const r of out) stages[r.stage] = (stages[r.stage] || 0) + 1;
  // Needs attention: a payment standing that is not good (stage 4), or the fair-use line reached and not lifted.
  // The alert at half the fee is a flag on the row and in the tab's count; the customer never sees a meter.
  const attention = out.filter((r) => r.stage === "subscribed" && ((r.standing && r.standing !== "good") || (r.fair_use && r.fair_use.over))).length;
  const alerts = out.filter((r) => r.fair_use && r.fair_use.alert && !r.fair_use.over).length;
  // a pilot's own end date is its plan, not a cancellation
  const cancelling = out.filter((r) => r.stage === "subscribed" && r.cancel_at && !(r.pilot && r.pilot.ends_at && Math.abs(new Date(r.cancel_at) - new Date(r.pilot.ends_at)) < 36 * 3600e3)).length;
  const golive = await require("./golive").status().catch(() => null);   // the switch for Go live on anetix.ai (stage 2)
  const activate = require("./activate");
  const sc = require("./stripecheck");
  const activation = { refill_check: { on: sc.on(), mode: sc.mode() }, channel: await activate.channel().catch((e) => ({ ok: false, why: e.message })), ai_key: await q("SELECT autofill, noted_at FROM platform.ai_credit ORDER BY id DESC LIMIT 1").then((x) => x.rows[0] || null).catch(() => null) };
  const terms = await require("./agreements").status().catch(() => null);   // the Terms' switch (src/agreements.js)
  return { book: bookView(book), stages, attention, alerts, cancelling, rows: out, stage_labels: STAGE_LABEL, golive, activation, terms };
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
  // The facts (and what they asked for) belong to the customer once an order is open: the draft on anetix.ai is the
  // truth while it is filled in, and a signed order is never edited. The note, the approval limit and the master
  // agreement are Brendan's at every stage. A save that sends the whole form with the facts unchanged goes through.
  const factChanges = FACT_COLS.filter((c) => c in fields && stable(fields[c]) !== stable(had ? had[c] : null));
  const askChanges = fields.deal ? ["integrations", "hardware"].filter((k) => k in fields.deal && stable(fields.deal[k] || null) !== stable(((had && had.deal) || {})[k] || null)) : [];
  if (had && (factChanges.length || askChanges.length)) {
    if (!["demo", "ordering", "back_to_demo"].includes(had.stage)) throw fail(409, "this site has a signed order: its facts are the ones signed. Send the order back to change them.");
    const open = await require("./golive").openOrder(had.id);
    if (open) throw fail(409, `an order is being filled in on anetix.ai (${open.state === "draft" ? "not signed yet" : "signed, waiting for a card"}), so its facts are the customer's. The note, the approval limit and the master agreement can still change.`);
  }
  for (const c of FACT_COLS) if (c in fields && !factChanges.includes(c)) delete fields[c];
  if (fields.deal) { for (const k of ["integrations", "hardware"]) if (k in fields.deal && !askChanges.includes(k)) delete fields.deal[k]; if (!Object.keys(fields.deal).length) delete fields.deal; }
  if (!Object.keys(fields).length) return (await pipeline()).rows.find((r) => r.slug === slug) || null;   // nothing changed
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
// A company added by hand on /admin is not in the pipeline until it has a site row (2026-10-06, Brendan: a company Anetix
// runs for the customer still needs its pilot offered and switched on from the Sites tab). This makes the row.
router.post("/api/admin/sites/:slug/track", requireAdmin, guard(async (req, res) => {
  const slug = String(req.params.slug || "").toLowerCase();
  if (!SLUG.test(slug) || !(await q("SELECT 1 FROM platform.companies WHERE slug=$1", [slug])).rows[0]) throw fail(404, "no such company");
  await require("./golive").ensureSite(slug);
  await logEvent("site_tracked", slug, { by: who(req) });
  res.json({ ok: true, site: (await pipeline()).rows.find((r) => r.slug === slug) || null });
}));
router.post("/api/admin/sites/:slug", requireAdmin, json, guard(async (req, res) => res.json({ ok: true, site: await saveFields(req.params.slug, req.body, who(req)) })));

module.exports = {
  init, router, pipeline, saveFields, deleteRefusal, deleteCompany, currentBook, bookFor, siteRow, FACT_COLS, stable, STAGE_LABEL,
  BOOK_V1, BOOK_V2, BOOK, feeFor, feeLine, liveTools, pilotText, pilotLine, pricingView, TERMS_VERSION, STAGES, STANDINGS, fromLine, bookProblems, bookView, bandOf, flagsOf, fairUse, next, subscribed, orderText, textHash, addressLine, refundableCredit, cleanFields,
};
