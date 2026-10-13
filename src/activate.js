// Paid sites, stage 3 (2026-09-26; docs/PAID-SITES.md "Activation: Brendan's side", "The rollover", "Stripe, end to
// end"): Brendan switches a signed site on, and the demo becomes a paying site.
//
// ACTIVATE. The Sites tab, on a signed order with its card, after three checks (the AI key's auto reload is on, a
// second paying site gets a reason typed for sharing one runtime, the size flags) and a fresh authenticator code:
//   1. under the lock on the site's row the order moves to activating, so a second press or a second tab finds it taken
//      and carries on from where the first stopped instead of starting over
//   2. the unused credit the demo BOUGHT is worked out once per card and kept on the order before Stripe hears of it
//      (so a retry sends the same amount), then anetix.ai makes three Stripe calls over the private channel (it holds
//      the key; the product never does): the card becomes the Customer's default, the unused credit becomes a customer
//      balance credit, and the subscription is made on the signed order's band, price and price book with
//      off_session and error_if_incomplete. Each call is idempotent, and anetix.ai first looks for a subscription that
//      already carries this order's id, so a retry never charges twice
//   3. the charge went through: the rollover runs (below), on whichever comes first, this answer or the first
//      invoice.paid anetix.ai forwards (a lost answer does not strand a paid site)
//   4. only a card error is a decline: the order is signed again with no card, the balance credit is reversed and the
//      card removed (anetix.ai does both before it answers), the site goes back to Ordering and the manager is told to
//      use another card. Anything else (a timeout, Stripe down) is not a decline: the order stays Switching on with the
//      error, and Activate again carries on.
//
// THE ROLLOVER, one function that is safe to run twice (docs/PAID-SITES.md's table). Under the lock: the order is
// activated and the site subscribed (standing good, its subscription, its period, the band and price it signed, its
// learning choice, converted_at). Then, each step marked done on sites.rollover so a restart finishes the rest: the
// sample data comes out of every tool (if Brendan left that ticked), the floor gets its own password (handed to the
// manager once, encrypted until then), the DEMO strip comes off and the company takes the site's name. From then on:
// no credit gate (the fair-use line instead, src/fairuse.js), no company cap, the instance cap never refuses it, no
// top-ups (one that lands is refunded), the Demos tab shows the demo period only unless the site opted in to learning.
//
// DECLINE and SEND BACK (a signed order Brendan will not activate as it stands): Decline voids it with a reason the
// manager sees and returns the site to Demo; Send back voids it with a note and starts a new draft holding the same
// answers, for the customer to check and sign again. Either way the card is removed.
//
// A PREVIEW (an admin's own walk-through, src/golive.js) can be switched on too, while Stripe is in TEST mode only:
// the real Stripe calls run on the preview's own Customer, the subscription is cancelled at once, the balance credit
// reversed and the card removed, and nothing on the company changes. What the rollover WOULD do is shown instead.
//
// THE SWEEP (tidy): cards Stripe still holds for orders that will never be activated (a withdrawal, a decline, a
// deleted company: orders.stripe.detach_pending) are removed over the channel, at boot, every 15 minutes and on demand.
//
// SWITCH ON BY HAND (2026-10-13). Brendan: "chelsea should no longer be on the demo view even though the payment has not
// processed yet as we need to start rolling it out on the floor, I will need to have the option to activate companies on
// my own." An admin makes a company a real site now and the payment follows through the usual road (the order signed on
// anetix.ai, the card, Activate). What it does: platform.sites.switched_on is set, so src/kind.js counts the company a
// site (no sample data, the floor's wording, more managers, Ask Anetix in live mode, no company cap, no replays or
// Demos-tab learning from its data), converted_at marks where the plant's data starts, and the rollover runs WITHOUT the
// floor-password step (the floor keeps the password it has, so nobody is signed out the day it goes on the floor). The
// stage is NOT touched: Stripe's road (offer, order, signature, card, Activate) is exactly as before, and when Activate
// finishes, switched_on is cleared and the rollover's marks are kept, so the floor is not given a second new password.
// Switch back to a trial undoes it while no payment has gone through. Needs the step-up code, like Activate.
//
// The channel (docs/PAID-SITES.md "The internal routes are a second listener"): anetix.ai opens a second port with no
// public domain, reached over Railway's private network at WWW_INTERNAL_URL (http://anetix-www.railway.internal:4001)
// with WWW_INTERNAL_KEY, a key of its own in this direction. Without both, Activate says so and does nothing.
//
// Routes:
//   admin:   GET  /api/admin/sites/:slug/checks          what Activate would check, and what the rollover would do
//            POST /api/admin/sites/:slug/activate        { code, tenancy_note, clear_sample }
//            POST /api/admin/sites/:slug/stop-activating { code }   an order stuck switching on: what Stripe holds decides
//            POST /api/admin/sites/:slug/decline         { reason }
//            POST /api/admin/sites/:slug/send-back       { note }
//            POST /api/admin/sites/:slug/lift            { note }   the fair-use line, for the rest of the period
//            POST /api/admin/sites/:slug/switch-on       { code, note, clear_sample }   a site now, payment to follow
//            POST /api/admin/sites/:slug/switch-off      { code }   back to a trial (only while it is on by hand)
//            POST /api/admin/stripe-sweep                remove the cards of withdrawn orders now
//   www:     POST /api/www/billing-events                a Stripe event anetix.ai re-read (the shared key)
//   manager: POST /api/c/:slug/welcome                   the floor's new password, once (managers only)
//            GET  /api/c/:slug/site, POST /api/c/:slug/learning { on }   Settings: the subscription and the learning choice
const crypto = require("crypto");
const express = require("express");
const { q, logEvent } = require("./db");
const sites = require("./sites");

const SCHEMA = `
ALTER TABLE platform.sites ADD COLUMN IF NOT EXISTS stripe_subscription TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS sites_stripe_subscription ON platform.sites (stripe_subscription) WHERE stripe_subscription IS NOT NULL;
ALTER TABLE platform.sites ADD COLUMN IF NOT EXISTS order_id UUID;            -- the order the subscription came from
ALTER TABLE platform.sites ADD COLUMN IF NOT EXISTS period_start TIMESTAMPTZ;  -- the subscription's current period (the fair-use window)
ALTER TABLE platform.sites ADD COLUMN IF NOT EXISTS period_end TIMESTAMPTZ;
ALTER TABLE platform.sites ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;
ALTER TABLE platform.sites ADD COLUMN IF NOT EXISTS converted_at TIMESTAMPTZ;  -- the line between the demo's data and the plant's
ALTER TABLE platform.sites ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ;
ALTER TABLE platform.sites ADD COLUMN IF NOT EXISTS band JSONB;                -- the band and price as signed, never the current facts
ALTER TABLE platform.sites ADD COLUMN IF NOT EXISTS price_usd NUMERIC(10,2);
ALTER TABLE platform.sites ADD COLUMN IF NOT EXISTS learning_opt_in BOOLEAN;
ALTER TABLE platform.sites ADD COLUMN IF NOT EXISTS fair_use_lift JSONB;       -- { until, by, note, at }
ALTER TABLE platform.sites ADD COLUMN IF NOT EXISTS tenancy_note TEXT;
ALTER TABLE platform.sites ADD COLUMN IF NOT EXISTS attention JSONB;
ALTER TABLE platform.sites ADD COLUMN IF NOT EXISTS welcome_enc BYTEA;         -- the floor's first password, encrypted, until the manager collects it once
ALTER TABLE platform.sites ADD COLUMN IF NOT EXISTS rollover JSONB;            -- which steps of the rollover are done
ALTER TABLE platform.sites ADD COLUMN IF NOT EXISTS switched_on JSONB;         -- { at, by, note }: on by hand, payment to follow (2026-10-13)
CREATE TABLE IF NOT EXISTS platform.billing_events (
  stripe_event  TEXT PRIMARY KEY,
  type          TEXT NOT NULL,
  site_id       UUID,
  subscription  TEXT,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied       JSONB
);`;
async function init() {
  await q(SCHEMA);
  // a rollover a restart cut short finishes; the sweep runs soon after boot and every 15 minutes
  setTimeout(() => finishPending().catch((e) => console.error("[activate] finishing rollovers:", e.message)), 5000).unref();
  setTimeout(() => tidy().catch((e) => console.error("[activate] sweep:", e.message)), 20000).unref();
  setInterval(() => { tidy().catch((e) => console.error("[activate] sweep:", e.message)); finishPending().catch((e) => console.error("[activate] finishing rollovers:", e.message)); }, 15 * 60e3).unref();
}

const SLUG = /^[a-z0-9][a-z0-9-]{1,40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fail = (status, msg, extra) => Object.assign(new Error(msg), { status }, extra || {});
const clean = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const usd = (n) => `$${Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const golive = () => require("./golive");
const lockSite = (siteId, fn) => golive().withSite({ site: { id: siteId }, who: "platform" }, fn);

// ---- the channel to anetix.ai ------------------------------------------------------------------------------------------
const INTERNAL_URL = () => String(process.env.WWW_INTERNAL_URL || "").replace(/\/+$/, "");
const INTERNAL_KEY = () => process.env.WWW_INTERNAL_KEY || "";
function channelProblem() {
  if (!INTERNAL_URL()) return "WWW_INTERNAL_URL is not set on this instance (anetix.ai's private address, like http://anetix-www.railway.internal:4001)";
  if (INTERNAL_KEY().length < 16) return "WWW_INTERNAL_KEY is not set on this instance, or is under 16 characters (it must be the same as anetix-www's)";
  return null;
}
async function www(path, body, { timeoutMs = 45000, method = body === undefined ? "GET" : "POST" } = {}) {
  const why = channelProblem(); if (why) throw fail(503, `The channel to anetix.ai is not set up: ${why}.`, { code: "channel" });
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(INTERNAL_URL() + path, { method, signal: ctl.signal, headers: { "Content-Type": "application/json", "X-WWW-Internal-Key": INTERNAL_KEY() }, body: method === "POST" ? JSON.stringify(body || {}) : undefined });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(j.error || `anetix.ai answered ${res.status}`), { status: res.status, www: j });
    return j;
  } catch (e) {
    if (e.name === "AbortError") throw Object.assign(new Error("anetix.ai did not answer in time"), { status: 504, timeout: true });
    if (!e.status) throw Object.assign(new Error(`anetix.ai could not be reached (${e.message})`), { status: 502, unreachable: true });
    throw e;
  } finally { clearTimeout(timer); }
}
// Is the channel up, and which Stripe is behind it (test, live or fake)? Kept for 30 seconds for the Sites tab, which asks
// on every load; Activate always asks fresh, since a preview may run in test mode only.
let pingCache = null;
async function channel({ fresh = false } = {}) {
  const why = channelProblem(); if (why) return { ok: false, why };
  if (!fresh && pingCache && Date.now() - pingCache.at < 30000) return pingCache.v;
  let v;
  try { const p = await www("/internal/ping", undefined, { timeoutMs: 5000 }); v = { ok: true, stripe: p.stripe || null, tax: Boolean(p.tax), webhook: Boolean(p.webhook), can: Array.isArray(p.can) ? p.can : [] }; }
  catch (e) { v = { ok: false, why: e.message }; }
  pingCache = { at: Date.now(), v };
  return v;
}

// ---- what Activate checks ----------------------------------------------------------------------------------------------
async function aiKey() {
  const r = (await q("SELECT autofill, noted_at FROM platform.ai_credit ORDER BY id DESC LIMIT 1").catch(() => ({ rows: [] }))).rows[0];
  return { autofill: Boolean(r && r.autofill), noted_at: r ? r.noted_at : null };
}
// Tenancy option C in force (Brendan's decision of 2026-09-18, kept 2026-09-27): each company's tools in a process of
// their own with a database login that reaches only that company's tables, and no tool kept inside the platform by the
// deploy-day safety net. The review of 2026-09-27: with the tenancy note gone, this is what stands before a second
// customer's production data, so Activate checks it rather than assumes it.
function isolation() {
  const st = require("./runner").state || {};
  const kept = (st.inline_modules || []).map((k) => `${k.company}/${k.module}`);
  const inline = st.effective !== "process";
  return { ok: !inline && kept.length === 0, effective: st.effective || null, kept,
    why: inline ? `module code runs inside the platform's own process (${(st.roles && st.roles.reason) || "the runner could not isolate it"})` : kept.length ? `these tools were kept inside the platform at boot: ${kept.join(", ")}` : null };
}
async function subscribedCount(except) {
  return (await q("SELECT count(*)::int AS n FROM platform.sites WHERE stage='subscribed' AND company <> $1", [except || ""])).rows[0].n;
}
// What the demo bought and did not use, in cents at the price it paid (sites.refundableCredit: free credit counts as
// spent first). 0 for a company that never bought any.
async function refundableCents(slug) {
  const selfserve = require("./selfserve");
  const ss = await selfserve.selfServeRow(slug); if (!ss) return 0;
  // oldest first: refundableCredit counts the oldest purchases as spent first, and ledger() reads newest first (found by
  // the review of 2026-09-26: $30 for $30 then $20 for $10 with $15 spent is $35 back, not $25). A site back to a demo
  // counts from its return (self_serve.credit_since, stage 4): credit bought for the first demo went on its first bill.
  const since = ss.credit_since || ss.created_at;
  const ledger = (await selfserve.ledger(slug)).filter((r) => !ss.credit_since || new Date(r.created_at) >= new Date(ss.credit_since)).slice().sort((a, b) => a.id - b.id);
  const r = sites.refundableCredit(ledger, await selfserve.spentSince(slug, since));
  return Math.max(0, Math.round(Number(r.refund_usd || 0) * 100));
}
// What the first month is, worked out when Activate runs (2026-10-05): a pilot's own fee, a flat band's price (price
// book 1), or, by the tool (price book 2), the tools live on the floor today. The order form says so: "billed on the
// day Anetix switches the Site on, for the tools live that day". -> { cents, tools, plan }
async function amountFor(slug, o) {
  const band = o.band || {};
  if (require("./pilot").isPilot(band)) return { cents: Math.round(Number(band.monthly_usd) * 100), tools: null, plan: "pilot" };
  if (!band.per_tool_usd) return { cents: Math.round(Number(o.price_usd) * 100), tools: null, plan: "flat" };
  const tools = await sites.liveTools(slug);
  return { cents: Math.round(sites.feeFor(band, tools).usd * 100), tools, plan: "tools" };
}
async function sampleFillsIn(slug) {
  return (await q("SELECT DISTINCT ON (module) module, status FROM platform.sample_fills WHERE company=$1 ORDER BY module, id DESC", [slug]).catch(() => ({ rows: [] }))).rows.filter((f) => f.status === "in").map((f) => f.module);
}
// What the rollover does to this company, in plain words (the confirm, and a preview's answer). Pure but for reads.
async function rolloverPlan(slug, o, { clear_sample = true } = {}) {
  const co = (await q("SELECT slug, name FROM platform.companies WHERE slug=$1", [slug])).rows[0] || { slug, name: slug };
  const f = o.facts || {}, band = o.band || {}, cents = await refundableCents(slug), fills = await sampleFillsIn(slug);
  const book = await sites.bookFor(o.price_book);
  const amt = await amountFor(slug, o), fee = amt.cents / 100, P = require("./pilot");
  const pilot = P.isPilot(band) ? band.pilot : null;
  const byHand = Boolean(((await sites.siteRow(slug)) || {}).switched_on);   // on already (switchOn): the floor keeps its password
  return [
    byHand ? "It is switched on by hand already, so the floor keeps the password it has and the sample data is already out. This takes the payment." : null,
    `The DEMO strip and the credit line come off the board, and new AI work has no credit to run out of: the fair-use line is ${usd(fee * book.fair_use_share)} a month.`,
    f.site_name && f.site_name !== co.name ? `The company shows as ${f.site_name} instead of ${co.name} (its address stays /c/${co.slug}/).` : null,
    byHand ? null : "The floor gets its own password, shown once to the manager on the board.",
    fills.length ? (clear_sample ? `The sample data comes out of ${fills.length} tool${fills.length === 1 ? "" : "s"} (${fills.join(", ")}).` : `The sample data stays in ${fills.join(", ")}, as you chose.`) : "No tool has sample data in it.",
    pilot ? `A pilot: ${sites.pilotLine({ monthly_usd: band.monthly_usd, months: pilot.months })}. ${usd(fee)} is charged now${pilot.months > 1 ? `, and ${usd(fee)} on the same day of ${pilot.months === 2 ? "next month" : `each of the next ${pilot.months - 1} months`}` : ""}. Stripe ends it on its own ${pilot.months} month${pilot.months === 1 ? "" : "s"} from today and nothing is charged after that. On that day the site goes back to a demo and the floor's sign-in closes, unless you have agreed what comes next and activated it.`
      : amt.plan === "tools" ? `${band.name} site on price book ${o.price_book}: ${usd(band.per_tool_usd)} a tool, ${amt.tools} live today, so ${usd(fee)} is charged now. From each next bill the fee follows the tools live on the floor, never above the ${usd(band.monthly_usd)} cap. Both prices are locked while the subscription runs.`
        : `${band.name || "The"} band at ${usd(o.price_usd)} a month on price book ${o.price_book}, locked while the subscription runs. The first month is charged now.`,
    cents > 0 ? `${usd(cents / 100)} of unused demo credit they bought comes off the first bill.` : "No bought demo credit is left to come off the first bill.",
    o.learning_opt_in ? "Learning: opted in. The Demos tab keeps showing everything." : "Learning: not opted in. The Demos tab shows the demo period only from now on.",
  ].filter(Boolean);
}
async function checks(slug) {
  slug = String(slug || "").toLowerCase();
  const site = SLUG.test(slug) ? await sites.siteRow(slug) : null;
  if (!site) throw fail(404, "no such site");
  const o = await golive().openOrder(site.id);
  const book = o ? await sites.bookFor(o.price_book) : null;
  const band = o && o.facts && Number.isInteger(o.facts.headcount) ? sites.bandOf(o.facts, book) : null;
  const preview = Boolean(o && o.kind === "preview");
  const others = await subscribedCount(slug);
  const ch = await channel();
  return {
    order: o ? { id: o.id, state: o.state, kind: o.kind, card: o.card, band: o.band, price_usd: o.price_usd == null ? null : Number(o.price_usd), stripe: stripeOut(o.stripe) } : null,
    ready: Boolean(o && ((o.state === "signed" && o.payment_method) || o.state === "activating")),
    channel: ch, ai_key: await aiKey(),
    // a customer's order while Stripe is not live switches a real company on with no real charge (Activate asks for the
    // tick); live with Stripe Tax off makes a subscription with no sales tax, which does not pick it up if Tax is turned on later
    test_mode: Boolean(ch.ok && ch.stripe !== "live" && !preview),
    tax_off: Boolean(ch.ok && ch.stripe === "live" && !ch.tax),
    tenancy: { others, needs_note: false, note: site.tenancy_note || null, isolation: isolation() },
    size: band ? band.flags : [],
    refund_usd: (await refundableCents(slug)) / 100,
    plan: o ? await rolloverPlan(slug, o) : [],
    charge: o ? await amountFor(slug, o).then((a) => ({ usd: a.cents / 100, tools: a.tools, plan: a.plan })) : null,
    preview,
  };
}
function stripeOut(s) {
  s = s || {};
  return { customer: s.customer || null, subscription: s.subscription || null, last_error: s.last_error || null, declined: s.declined || null, balance: s.balance || null, attempts: s.attempts || 0 };
}

// ---- Activate ----------------------------------------------------------------------------------------------------------
async function activate(slug, { tenancy_note, clear_sample = true, test_mode_ok = false } = {}, by) {
  slug = String(slug || "").toLowerCase();
  const site0 = SLUG.test(slug) ? await sites.siteRow(slug) : null;
  if (!site0) throw fail(404, "no such site");
  const why = channelProblem(); if (why) throw fail(409, `The channel to anetix.ai is not set up, so nothing was charged: ${why}.`, { code: "channel" });
  const ch = await channel({ fresh: true });
  if (!ch.ok) throw fail(502, `anetix.ai could not be reached over the private channel, so nothing was charged: ${ch.why}`, { code: "channel" });
  const o0 = await golive().openOrder(site0.id);
  if (!o0) throw fail(409, "this site has no open order");
  const preview = o0.kind === "preview";
  // a pilot is switched on only by an anetix.ai that makes it with its end date (found by the review of 2026-10-05: an
  // older one would take the pilot's fee on a subscription with no end, and charge it month after month)
  if (require("./pilot").isPilot(o0.band) && !(ch.can || []).includes("pilot")) throw fail(409, "anetix.ai is on a version that cannot end a pilot on its own, so nothing was charged. Push the www repo first, then Activate again.", { code: "www_old" });
  if (preview && ch.stripe === "live") throw fail(409, "A preview can be switched on only while Stripe is in test mode: in live mode it would charge a real card.", { code: "live" });
  // a customer's order while Stripe is not live switches a real company on with no real charge and test ids that mean
  // nothing once the live keys are in: only with it said out loud (your own test company, say)
  if (!preview && ch.stripe !== "live" && test_mode_ok !== true) throw fail(409, `Stripe on anetix.ai is in ${ch.stripe} mode, so this would switch ${slug} on with no real charge. Tick "Stripe is in test mode" to do it anyway (your own test company, say).`, { code: "test_mode" });
  if (!preview) {
    const key = await aiKey();
    if (!key.autofill) throw fail(409, "A paying site's loop stops if the Anthropic key runs dry. Turn auto reload on in the Anthropic console, then tick autofill on the AI credit note (the Instance tab), and Activate again.", { code: "ai_key" });
    // No tenancy note (Brendan, 2026-09-27): option C, a process and a database login per company, is what stands
    // before a second customer's production data. A runtime per customer (option D) waits for the first security
    // questionnaire or enterprise production data that asks for it (the 2026-09-18 decisions). So option C has to be
    // in force on this instance before a second paying site goes on it.
    const iso = isolation();
    if ((await subscribedCount(slug)) >= 1 && !iso.ok) throw fail(409, `A second paying site needs each company's tools isolated in a process of their own, and this instance is not doing that: ${iso.why}. Fix it first (the Instance tab, Module isolation), then Activate again.`, { code: "isolation" });
  }
  const note = clean(tenancy_note, 500);
  const r = await lockSite(site0.id, async (c, site, open) => {
    if (!open || open.id !== o0.id) throw fail(409, "the order changed while you were looking; open the site again");
    if (open.state === "activating") return { resume: true };
    if (open.state !== "signed" || !open.payment_method) throw fail(409, "only a signed order with its card saved can be switched on");
    if (!preview) {
      const step = sites.next({ stage: site.stage }, { type: "activate" });
      if (!step.ok) throw fail(409, step.why);
      await c.query("UPDATE platform.sites SET stage=$2, tenancy_note=COALESCE(NULLIF($3,''), tenancy_note), updated_at=now(), updated_by=$4 WHERE id=$1", [site.id, step.state.stage, note, by || "admin"]);
    }
    await c.query(`UPDATE platform.orders SET state='activating', updated_at=now(),
                     stripe = stripe || jsonb_build_object('activate', jsonb_build_object('by', $2::text, 'at', now(), 'clear_sample', $3::boolean)) WHERE id=$1`, [open.id, by || "admin", clear_sample !== false]);
    return { resume: false };
  });
  await logEvent(r.resume ? "site_activate_resumed" : "site_activate_started", slug, { order: o0.id, by: by || null, preview });
  return run(site0.id, o0.id, by);
}

// The Stripe steps for an order that is activating: the amount kept once per card, then anetix.ai's three calls.
async function run(siteId, orderId, by) {
  const o = (await q("SELECT * FROM platform.orders WHERE id=$1", [orderId])).rows[0];
  const site = (await q("SELECT * FROM platform.sites WHERE id=$1", [siteId])).rows[0];
  if (!o || !site || o.state !== "activating") throw fail(409, "this order is not switching on");
  const co = (await q("SELECT slug, name FROM platform.companies WHERE slug=$1", [site.company])).rows[0] || { slug: site.company, name: site.company };
  const preview = o.kind === "preview";
  const st = o.stripe || {};
  let bal = st.balance && st.balance.pm === o.payment_method && !st.balance.reversed_at ? st.balance : null;
  if (!bal) {
    bal = { pm: o.payment_method, cents: await refundableCents(co.slug), at: new Date().toISOString() };
    await q("UPDATE platform.orders SET stripe = stripe || jsonb_build_object('balance', $2::jsonb) WHERE id=$1", [o.id, JSON.stringify(bal)]);
  }
  // the amount, like the credit, is worked out once per card and kept before Stripe hears of it, so a retry sends the same
  let amt = st.amount && st.amount.pm === o.payment_method ? st.amount : null;
  if (!amt) {
    amt = { pm: o.payment_method, ...(await amountFor(co.slug, o)), at: new Date().toISOString() };
    await q("UPDATE platform.orders SET stripe = stripe || jsonb_build_object('amount', $2::jsonb) WHERE id=$1", [o.id, JSON.stringify(amt)]);
  }
  const band = o.band || {}, cents = amt.cents;
  const pilot = require("./pilot").isPilot(band) ? band.pilot : null;
  // one monthly Price per amount: a pilot's, a flat band's (price book 1), or the fee by the tools live (price book 2)
  const price = pilot ? { lookup_key: `anetix_pilot_${cents}`, unit_amount: cents, name: "Anetix pilot", band: "pilot", book: o.price_book }
    : amt.plan === "tools" ? { lookup_key: `anetix_tools_v${o.price_book}_${cents}`, unit_amount: cents, name: "Anetix: tools live on the floor", band: "tools", book: o.price_book }
      : { lookup_key: `anetix_site_${band.key}_v${o.price_book}_${cents}`, unit_amount: cents, name: `Anetix site: ${band.name}`, band: band.key, book: o.price_book };
  const body = {
    order: o.id, site: site.id, slug: co.slug, preview,
    customer: preview ? st.customer : site.stripe_customer,
    payment_method: o.payment_method,
    price,
    // a pilot ends on its own: anetix.ai makes the subscription with Stripe's cancel_at set to its start plus the months,
    // so no charge is ever made after the last payment, whatever happens to this service afterwards
    ...(pilot ? { cancel_after_months: pilot.months } : {}),
    balance: { cents: bal.cents, description: "Unused AI credit bought for the demo, at the price paid" },
    site_name: (o.facts || {}).site_name || co.name,
    metadata: { site: site.id, order: o.id, price_book: String(o.price_book), band: String(band.key || ""), company: co.slug, plan: amt.plan, ...(amt.tools != null ? { tools: String(amt.tools) } : {}), ...(pilot ? { pilot_months: String(pilot.months) } : {}), ...(preview ? { preview: "yes" } : {}) },
    // after a Stripe server error (kept under its idempotency key for 24 hours) the subscription's key moves on; anetix.ai
    // looks for this order's subscription before making one, so a fresh key never charges twice
    key_try: st.last_error && st.last_error.stripe_error ? Number(st.attempts || 0) : 0,
  };
  await q("UPDATE platform.orders SET stripe = jsonb_set(stripe, '{attempts}', to_jsonb(COALESCE((stripe->>'attempts')::int, 0) + 1)) WHERE id=$1", [o.id]);
  let ans;
  try { ans = await www("/internal/activate", body, { timeoutMs: 90000 }); }
  catch (e) {
    if (e.status === 402 && e.www && e.www.declined) return cardDeclined(site, o, e.www);
    const stripeError = Boolean(e.www && e.www.stripe && ["api_error", "idempotency_error"].includes(e.www.stripe.type));
    await q("UPDATE platform.orders SET stripe = stripe || jsonb_build_object('last_error', jsonb_build_object('message', $2::text, 'at', now(), 'stripe_error', $3::boolean)), updated_at=now() WHERE id=$1", [o.id, clean(e.message, 300), stripeError]);
    await logEvent("site_activate_stopped", co.slug, { order: o.id, error: clean(e.message, 300) });
    throw fail(502, `Stripe did not finish (${e.message}). Nothing is lost: the order stays Switching on, and Activate again carries on from where it stopped without charging twice.`, { code: "stopped" });
  }
  let sub = ans.subscription || {};
  // A pilot's subscription always has its end date. One that came back without it (it should never: anetix.ai makes it
  // with one) gets it now, and if that fails Anetix is told at once: the sweep keeps trying every 15 minutes.
  if (pilot && !preview && sub.id && !sub.cancel_at) {
    try { sub = (await www("/internal/pilot-end", { subscription: sub.id, site: site.id }, { timeoutMs: 30000 })).subscription || sub; }
    catch (e) { console.error(`[activate] ${co.slug}: the pilot was charged but has no end date at Stripe: ${e.message}`); }
    if (!sub.cancel_at) require("./notify").notify("A pilot has no end date at Stripe", `${co.name}: the pilot's first month was charged, but its subscription has no cancel date. Set "cancel at" on it in the Stripe dashboard now (${pilot.months} month${pilot.months === 1 ? "" : "s"} from today), or it will keep charging.`, { priority: 5, tags: ["rotating_light"], ref: co.slug });
  }
  // every Stripe id is kept the moment it exists
  await q(`UPDATE platform.orders SET stripe = stripe - 'last_error' || jsonb_build_object('subscription', $2::text, 'price', $3::text) || jsonb_build_object('balance', (stripe->'balance') || jsonb_build_object('txn', $4::text)), updated_at=now() WHERE id=$1`,
    [o.id, sub.id || null, ans.price_id || null, ans.balance_txn || null]);
  if (preview) return previewDone(site, o, co, ans);
  const out = await finish(o.id, sub, "activate");
  return { ok: true, activated: true, ...out, subscription: sub.id, refund_usd: bal.cents / 100, charged_usd: cents / 100, ends_at: sub.cancel_at ? new Date(Number(sub.cancel_at) * 1000).toISOString() : null };
}

// A preview's subscription was made in Stripe's test mode and cancelled at once by anetix.ai; the company is untouched.
async function previewDone(site, o, co, ans) {
  await q(`UPDATE platform.orders SET state='void', note=$2, voided_by='admin', voided_at=now(), updated_at=now(),
             stripe = stripe || jsonb_build_object('preview_run', $3::jsonb) WHERE id=$1`,
  [o.id, "preview switched on in Stripe test mode, then cancelled at once", JSON.stringify({ canceled: Boolean(ans.canceled), reversed: Boolean(ans.balance_reversed), detached: Boolean(ans.detached), at: new Date().toISOString() })]);
  await logEvent("site_preview_activated", co.slug, { order: o.id, subscription: (ans.subscription || {}).id || null });
  return { ok: true, preview: true, subscription: (ans.subscription || {}).id || null, canceled: Boolean(ans.canceled), plan: await rolloverPlan(co.slug, o, { clear_sample: ((o.stripe || {}).activate || {}).clear_sample !== false }) };
}

// A card error on the first charge. anetix.ai has already reversed the balance credit and removed the card.
async function cardDeclined(site0, o0, info) {
  const words = clean(info.message || "the card was declined", 200);
  const r = await lockSite(site0.id, async (c, site, open) => {
    if (!open || open.id !== o0.id || open.state !== "activating") return { moved: false };
    const entry = { pm: o0.payment_method, card: o0.card || null, message: words, code: info.code || null, at: new Date().toISOString(), balance_reversed: Boolean(info.balance_reversed), detached: Boolean(info.detached) };
    const stripe = { ...(open.stripe || {}), declined: [...(((open.stripe || {}).declined) || []), entry] };
    // the credit anetix.ai made for this card: reversed there already, or left for the sweep (never lost, never twice)
    const txn = info.balance_txn || (stripe.balance && stripe.balance.txn) || null;
    if (stripe.balance || txn) stripe.balance = { ...(stripe.balance || {}), txn, reversed_at: txn && info.balance_reversed ? entry.at : null, ...(txn && !info.balance_reversed ? { reverse_pending: true } : {}) };
    if (!info.detached) stripe.detach_list = [...(stripe.detach_list || []), o0.payment_method];
    delete stripe.last_error;
    await c.query("UPDATE platform.orders SET state='signed', payment_method=NULL, card=NULL, card_saved_at=NULL, stripe=$2, updated_at=now() WHERE id=$1", [open.id, JSON.stringify(stripe)]);
    if (open.kind === "customer") {
      const step = sites.next({ stage: site.stage }, { type: "card_declined" });
      if (step.ok) await c.query("UPDATE platform.sites SET stage=$2, updated_at=now(), updated_by='platform' WHERE id=$1", [site.id, step.state.stage]);
      // Stripe's own words only when they say more than "declined" (insufficient funds, expired, and so on)
      const why = /^(your )?card was declined\.?$/i.test(words) || /^the card was declined\.?$/i.test(words) ? "" : ` (${words.replace(/\.$/, "")})`;
      await require("./notices").add(site.company, "card_declined", `Your card was declined when Anetix switched the site on${why}. Nothing was charged. Use another card to finish going live: Add another card, beside the credit line.`, { order: open.id }, c);
    }
    return { moved: true, kind: open.kind };
  });
  await logEvent("site_card_declined", site0.company, { order: o0.id, message: words, preview: r.kind === "preview" });
  // the launch audit, C11: the manager sees it on the board; Anetix hears it on the phone
  if (r.kind === "customer") require("./notify").notify("A card was declined at Activate", `${((await q("SELECT name FROM platform.companies WHERE slug=$1", [site0.company])).rows[0] || {}).name || site0.company}: the first charge was declined (${words}). Nothing was charged; the manager is asked for another card.`, { priority: 4, tags: ["credit_card"], ref: site0.company });
  return { ok: false, declined: true, message: `The card was declined (${words}). The order is back to waiting for a card, and the manager is told to use another one. Nothing was charged.` };
}

// ---- the rollover ------------------------------------------------------------------------------------------------------
// Runs on the Activate answer or the first invoice.paid, whichever comes first; the second finds it done.
async function finish(orderId, sub, via) {
  const o0 = (await q("SELECT site_id, company, kind FROM platform.orders WHERE id=$1", [orderId])).rows[0];
  if (!o0) throw fail(404, "no such order");
  if (o0.kind !== "customer") throw fail(409, "a preview is never rolled over");
  const r = await lockSite(o0.site_id, async (c, site) => {
    const o = (await c.query("SELECT * FROM platform.orders WHERE id=$1", [orderId])).rows[0];
    if (o.state === "activated") return { already: true, slug: site.company };
    if (o.state !== "activating") throw fail(409, `the order is ${o.state}, not switching on`);
    const step = sites.next({ stage: site.stage }, { type: "activated" });
    if (!step.ok) throw fail(409, step.why);
    const ps = sub.current_period_start ? new Date(Number(sub.current_period_start) * 1000) : new Date();
    const pe = sub.current_period_end ? new Date(Number(sub.current_period_end) * 1000) : require("./fairuse").addMonths(ps, 1);
    // what was charged (worked out when Activate ran: the tools live that day, or the pilot's fee), and for a pilot the
    // day Stripe ends it, kept on the site's band and as its cancel date from the start: it is the plan, not a cancellation
    const charged = (o.stripe || {}).amount && Number.isInteger((o.stripe || {}).amount.cents) ? (o.stripe || {}).amount.cents / 100 : Number(o.price_usd);
    const P = require("./pilot");
    let band = o.band || null, endsAt = null;
    if (P.isPilot(band)) {
      endsAt = sub.cancel_at ? new Date(Number(sub.cancel_at) * 1000) : require("./fairuse").addMonths(ps, band.pilot.months);
      band = { ...band, pilot: { ...band.pilot, started_at: ps.toISOString(), ends_at: endsAt.toISOString() } };
    }
    await c.query(`UPDATE platform.orders SET state='activated', updated_at=now(),
                     stripe = stripe || jsonb_build_object('subscription', $2::text, 'activated_at', now(), 'activated_by', $3::text) WHERE id=$1`, [o.id, sub.id || null, via || null]);
    await c.query(`UPDATE platform.sites SET stage='subscribed', standing='good', cancel_at=$11, attention=NULL, stripe_subscription=$2, order_id=$3,
                     period_start=$4, period_end=$5, activated_at=now(), converted_at=COALESCE(converted_at, now()), returned_at=NULL,
                     band=$6, price_usd=$7, price_book=$8, learning_opt_in=$9, fair_use_lift=NULL, offer=NULL,
                     -- a site switched on by hand already had its rollover (the floor kept its password): keep the marks
                     rollover=CASE WHEN switched_on IS NOT NULL AND rollover ? 'done_at' THEN rollover || jsonb_build_object('paid_at', now())
                                   ELSE jsonb_build_object('clear_sample', $10::boolean, 'started_at', now()) END,
                     switched_on=NULL, updated_at=now(), updated_by='platform' WHERE id=$1`,
    [site.id, sub.id || null, o.id, ps, pe, band ? JSON.stringify(band) : null, charged, o.price_book, o.learning_opt_in === true,
      ((o.stripe || {}).activate || {}).clear_sample !== false, endsAt]);
    return { fresh: true, slug: site.company, order: o, charged, band, ends_at: endsAt };
  });
  if (r.fresh) {
    await logEvent("site_activated", r.slug, { order: orderId, subscription: sub.id || null, via: via || null });
    await require("./record").record("site_subscribed", { company: r.slug, actor: { role: "platform", name: "Anetix" }, after: `${r.ends_at ? `Pilot started: ${sites.pilotLine({ monthly_usd: r.band.monthly_usd, months: r.band.pilot.months })}. It ends on its own on ${new Date(r.ends_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" })}` : `Subscribed: ${(r.order.band || {}).name || ""} site, ${sites.feeLine(r.band, ((r.order.stripe || {}).amount || {}).tools || 0)}`}. The demo's data is before this line; the plant's is after it.`, detail: { order: orderId, subscription: sub.id || null } }).catch((e) => console.error("[activate] record:", e.message));
  }
  let rollover_error = null;
  try { await rolloverSteps(r.slug); }
  catch (e) { rollover_error = e.message; console.error(`[activate] ${r.slug}: the rollover stopped partway (${e.message}); it finishes on the next sweep`); }
  return { already: Boolean(r.already), slug: r.slug, ...(rollover_error ? { rollover_error } : {}) };
}
// The steps after the site is subscribed, each done once (sites.rollover marks them), so a restart finishes the rest.
async function rolloverSteps(slug) {
  // one runner per site at a time (found by the review of 2026-09-26: the Activate answer and three webhook events arrive
  // together after a lost answer, and two runners each made a floor password, so the one shown could be the overwritten
  // one). The lock is Postgres's, on a connection of its own, held until the steps are done.
  const lockConn = await require("./db").pool.connect();
  try {
    await lockConn.query("SELECT pg_advisory_lock(hashtext($1))", [`rollover:${slug}`]);
    return await rolloverStepsLocked(slug);
  } finally {
    await lockConn.query("SELECT pg_advisory_unlock(hashtext($1))", [`rollover:${slug}`]).catch(() => {});
    lockConn.release();
  }
}
async function rolloverStepsLocked(slug) {
  const site = await sites.siteRow(slug);   // read again inside the lock: another runner may have done the steps
  if (!site || (site.stage !== "subscribed" && !site.switched_on)) return;
  const ro = site.rollover || {};
  if (ro.done_at) return;
  const mark = (k) => q("UPDATE platform.sites SET rollover = COALESCE(rollover, '{}'::jsonb) || jsonb_build_object($2::text, now()) WHERE id=$1", [site.id, k]);
  // the sample data first, while the company is still a demo (src/sample.js clears a demo's only)
  if (!ro.sample_at) {
    if (ro.clear_sample !== false) {
      for (const mod of await sampleFillsIn(slug)) {
        await require("./sample").clear(slug, mod, { role: "platform", name: "Anetix (going live)" }, { goingLive: true }).catch((e) => console.error(`[activate] ${slug}/${mod}: sample data not cleared: ${e.message}`));
      }
    }
    await mark("sample_at");
  }
  if (!ro.floor_at) {
    const floor = require("./auth").generatePassword();
    await require("./auth").setPasswords(slug, { floor });
    let enc = null;
    try { enc = require("./connections").encrypt({ floor, made_at: new Date().toISOString() }); } catch (e) { console.error(`[activate] ${slug}: the floor password cannot be kept for the manager (${e.message}); reset it from the admin page`); }
    await q("UPDATE platform.sites SET welcome_enc=$2 WHERE id=$1", [site.id, enc]);
    await mark("floor_at");
  }
  if (!ro.company_at) {
    const o = site.order_id ? (await q("SELECT facts FROM platform.orders WHERE id=$1", [site.order_id])).rows[0] : null;
    const name = o && o.facts && o.facts.site_name ? clean(o.facts.site_name, 80) : null;
    await q("UPDATE platform.companies SET demo=false, name=COALESCE($2, name) WHERE slug=$1", [slug, name]);
    require("./kind").forget(slug);   // a paid site from now on: no trial features (src/kind.js)
    await mark("company_at");
  }
  await mark("done_at");
  await logEvent("site_rollover_done", slug, {});
}
// At boot: a subscribed site whose rollover a restart cut short.
async function finishPending() {
  const rows = (await q("SELECT company FROM platform.sites WHERE (stage='subscribed' OR switched_on IS NOT NULL) AND (rollover IS NULL OR NOT rollover ? 'done_at')")).rows;
  for (const r of rows) await rolloverSteps(r.company).catch((e) => console.error(`[activate] ${r.company}: rollover:`, e.message));
}

// ---- Switch on by hand, payment to follow ------------------------------------------------------------------------------
async function switchOn(slug, { note, clear_sample = true } = {}, by) {
  slug = String(slug || "").toLowerCase();
  if (!SLUG.test(slug) || !(await q("SELECT 1 FROM platform.companies WHERE slug=$1", [slug])).rows[0]) throw fail(404, "no such company");
  const site0 = await golive().ensureSite(slug);
  const words = clean(note, 300);
  await lockSite(site0.id, async (c, site) => {
    if (["activating", "subscribed"].includes(site.stage)) throw fail(409, "This site is paying already.");
    if (site.switched_on) throw fail(409, "This site is switched on already.");
    await c.query(`UPDATE platform.sites SET switched_on=$2, converted_at=COALESCE(converted_at, now()), returned_at=NULL,
                     rollover=jsonb_build_object('clear_sample', $3::boolean, 'started_at', now(), 'by_hand', true, 'floor_at', now(), 'floor_kept', true),
                     updated_at=now(), updated_by=$4 WHERE id=$1`,
    [site.id, JSON.stringify({ at: new Date().toISOString(), by: by || "admin", note: words || null }), clear_sample !== false, by || "admin"]);
  });
  require("./kind").forget(slug);
  await logEvent("site_switched_on", slug, { by: by || null, note: words || null, clear_sample: clear_sample !== false });
  await require("./record").record("site_switched_on", { company: slug, actor: { role: "admin", name: by || "Anetix" }, after: `Switched on by Anetix, payment to follow${words ? ` (${words})` : ""}. The demo's data is before this line; the plant's is after it.`, detail: { by: by || null } }).catch((e) => console.error("[activate] record:", e.message));
  let rollover_error = null;
  try { await rolloverSteps(slug); }
  catch (e) { rollover_error = e.message; console.error(`[activate] ${slug}: the rollover stopped partway (${e.message}); it finishes on the next sweep`); }
  return { ok: true, switched_on: true, ...(rollover_error ? { rollover_error } : {}) };
}
// Back to a trial: only a site on by hand with no payment through (a paying site ends through Stripe, src/billing.js).
// The sample data taken out stays out, and the floor keeps its password; the company is a trial again.
async function switchOff(slug, by) {
  slug = String(slug || "").toLowerCase();
  const site0 = SLUG.test(slug) ? await sites.siteRow(slug) : null;
  if (!site0) throw fail(404, "no such site");
  await lockSite(site0.id, async (c, site) => {
    if (["activating", "subscribed"].includes(site.stage)) throw fail(409, "This site is paying, so it ends through its subscription, not here.");
    if (!site.switched_on) throw fail(409, "This site was not switched on by hand.");
    await c.query("UPDATE platform.sites SET switched_on=NULL, rollover=NULL, converted_at=NULL, updated_at=now(), updated_by=$2 WHERE id=$1", [site.id, by || "admin"]);
    // a company that came in from anetix.ai is a demo again (src/kind.js standardize would do it at the next boot)
    await c.query("UPDATE platform.companies SET demo=true WHERE slug=$1 AND EXISTS (SELECT 1 FROM platform.self_serve WHERE company=$1)", [slug]);
  });
  require("./kind").forget(slug);
  await logEvent("site_switched_off", slug, { by: by || null });
  await require("./record").record("site_switched_off", { company: slug, actor: { role: "admin", name: by || "Anetix" }, after: "Switched back to a trial by Anetix." }).catch((e) => console.error("[activate] record:", e.message));
  return { ok: true, switched_on: false };
}

// ---- Stop switching on -------------------------------------------------------------------------------------------------
// An order stuck in Switching on (found by the review of 2026-09-26: a decline anetix.ai handled but whose answer was
// lost, a Customer removed in the dashboard, keys moved between test and live) has a way out. anetix.ai looks at what
// Stripe holds for the order: a subscription made for it means the charge went through, and the rollover runs; none
// means nothing was charged, so any credit standing for the order is reversed and the card removed there, and the order
// goes back to waiting for a card (the site to Ordering), the manager told. Needs the step-up code, like Activate.
async function stopActivating(slug, by) {
  slug = String(slug || "").toLowerCase();
  const site0 = SLUG.test(slug) ? await sites.siteRow(slug) : null;
  if (!site0) throw fail(404, "no such site");
  const o0 = await golive().openOrder(site0.id);
  if (!o0 || o0.state !== "activating") throw fail(409, "this site's order is not switching on");
  const st = o0.stripe || {};
  const customer = o0.kind === "preview" ? st.customer : site0.stripe_customer;
  const ans = await www("/internal/abandon", { order: o0.id, customer, payment_method: o0.payment_method, balance_txn: (st.balance || {}).txn || null, preview: o0.kind === "preview" }, { timeoutMs: 45000 });
  if (ans.subscription && o0.kind === "customer") {   // the charge went through after all
    const out = await finish(o0.id, ans.subscription, "stop: found at Stripe");
    return { ok: true, activated: true, found: true, ...out };
  }
  const r = await lockSite(site0.id, async (c, site, open) => {
    if (!open || open.id !== o0.id || open.state !== "activating") return { moved: false };
    const stripe = { ...(open.stripe || {}), stopped: [...(((open.stripe || {}).stopped) || []), { pm: open.payment_method, at: new Date().toISOString(), by: by || "admin", reversed: Boolean(ans.balance_reversed), detached: Boolean(ans.detached), subscription_canceled: ans.subscription ? ans.subscription.id : null }] };
    if (stripe.balance && stripe.balance.txn) stripe.balance = { ...stripe.balance, reversed_at: ans.balance_reversed ? new Date().toISOString() : null, ...(ans.balance_reversed ? {} : { reverse_pending: true }) };
    if (!ans.detached && open.payment_method) stripe.detach_list = [...(stripe.detach_list || []), open.payment_method];
    delete stripe.last_error;
    await c.query("UPDATE platform.orders SET state='signed', payment_method=NULL, card=NULL, card_saved_at=NULL, stripe=$2, updated_at=now() WHERE id=$1", [open.id, JSON.stringify(stripe)]);
    if (open.kind === "customer") {
      await c.query("UPDATE platform.sites SET stage='ordering', updated_at=now(), updated_by=$2 WHERE id=$1", [site.id, by || "admin"]);
      await require("./notices").add(site.company, "card_declined", "Anetix could not finish switching the site on. Nothing was charged. Add a card again to finish going live: Add another card, beside the credit line.", { order: open.id }, c);
    }
    return { moved: true };
  });
  await logEvent("site_activate_abandoned", slug, { order: o0.id, by: by || null, ...r });
  return { ok: true, stopped: true, message: "Nothing was charged. The order is back to waiting for a card, and the manager is told to add one again." };
}

// ---- Decline and Send back ---------------------------------------------------------------------------------------------
// An order that will not be activated and still has a demo credit standing at Stripe (a decline whose reversal failed):
// the sweep reverses it. Called in the caller's transaction.
async function reverseLeftover(c, o) {
  const b = (o.stripe || {}).balance;
  if (b && b.txn && !b.reversed_at) await c.query("UPDATE platform.orders SET stripe = jsonb_set(stripe, '{balance}', (stripe->'balance') || '{\"reverse_pending\": true}'::jsonb) WHERE id=$1", [o.id]);
}
async function signedOrderOf(slug) {
  slug = String(slug || "").toLowerCase();
  const site = SLUG.test(slug) ? await sites.siteRow(slug) : null;
  if (!site) throw fail(404, "no such site");
  return site;
}
async function decline(slug, { reason } = {}, by) {
  const site0 = await signedOrderOf(slug);
  const words = clean(reason, 300);
  if (words.length < 3) throw fail(400, "say why, in a few words: the manager is shown it");
  const r = await lockSite(site0.id, async (c, site, open) => {
    if (!open || open.kind !== "customer" || open.state !== "signed" || !open.payment_method) throw fail(409, "Decline is for a customer's signed order with its card saved. Withdraw works on any other open order.");
    const step = sites.next({ stage: site.stage }, { type: "decline" });
    if (!step.ok) throw fail(409, step.why);
    await c.query(`UPDATE platform.orders SET state='declined', note=$2, voided_by='admin', voided_at=now(), updated_at=now(),
                     stripe = ${golive().addDetach("payment_method")} WHERE id=$1`, [open.id, `Anetix declined this order: ${words}`]);
    await reverseLeftover(c, open);
    await c.query("UPDATE platform.sites SET stage=$2, updated_at=now(), updated_by=$3 WHERE id=$1", [site.id, step.state.stage, by || "admin"]);
    await require("./notices").add(site.company, "declined", `Anetix declined your order: ${words}. Your demo works as before, and nothing was charged.`, { order: open.id }, c);
    return { order: open.id };
  });
  await logEvent("order_declined", site0.company, { order: r.order, by: by || null, reason: words });
  tidy().catch(() => {});
  return { ok: true, ...r };
}
async function sendBack(slug, { note } = {}, by) {
  const site0 = await signedOrderOf(slug);
  const words = clean(note, 300);
  if (words.length < 3) throw fail(400, "say what to look at again, in a few words: the manager is shown it");
  const r = await lockSite(site0.id, async (c, site, open) => {
    if (!open || open.kind !== "customer" || open.state !== "signed") throw fail(409, "Send back is for a customer's signed order.");
    const step = sites.next({ stage: site.stage === "ordering" ? "signed" : site.stage }, { type: "send_back" });
    if (!step.ok) throw fail(409, step.why);
    await c.query(`UPDATE platform.orders SET state='void', note=$2, voided_by='admin', voided_at=now(), updated_at=now(),
                     stripe = CASE WHEN payment_method IS NULL THEN stripe ELSE ${golive().addDetach("payment_method")} END WHERE id=$1`, [open.id, `Anetix sent this order back: ${words}`]);
    await reverseLeftover(c, open);
    const id = crypto.randomUUID();
    await c.query(`INSERT INTO platform.orders (id, site_id, company, state, version, facts, band, price_usd, price_book, terms_version, kind, from_stage, created_by)
                   VALUES ($1,$2,$3,'draft',1,$4,$5,$6,$7,$8,'customer',$9,'admin')`,
    [id, site.id, site.company, JSON.stringify(open.facts), open.band ? JSON.stringify(open.band) : null, open.price_usd, open.price_book, require("./terms").TERMS_VERSION, open.from_stage]);
    await c.query("UPDATE platform.sites SET stage='ordering', updated_at=now(), updated_by=$2 WHERE id=$1", [site.id, by || "admin"]);
    await require("./notices").add(site.company, "sent_back", `Anetix sent your order back to look at again: ${words}. Your answers are kept. Open Go live, check them and sign again.`, { order: open.id, draft: id }, c);
    return { voided: open.id, draft: id };
  });
  await logEvent("order_sent_back", site0.company, { ...r, by: by || null, note: words });
  tidy().catch(() => {});
  return { ok: true, ...r };
}

// ---- the sweep ---------------------------------------------------------------------------------------------------------
let tidying = false;
async function tidy() {
  if (tidying || channelProblem()) return { skipped: true };
  tidying = true;
  const out = { detached: 0, reversed: 0, failed: 0 };
  try {
    const G = golive();
    const rows = (await q(`SELECT id, company, state, payment_method, stripe FROM platform.orders WHERE ${G.TO_REMOVE_SQL} ORDER BY updated_at LIMIT 50`)).rows;
    for (const o of rows) {
      if (o.state === "activating") continue;   // nothing while an order is switching on
      // never the card an open order holds now (a card replaced on a signed order is on the list, the new one is not);
      // a voided or declined order's own card goes too
      const held = ["draft", "signed"].includes(o.state) ? o.payment_method : null;
      for (const pm of G.cardsToRemove(o.stripe).filter((x) => x !== held)) {
        try {
          await www("/internal/detach", { payment_method: pm, why: `order ${o.id} will not be activated` }, { timeoutMs: 20000 });
          await q(`UPDATE platform.orders SET stripe = stripe || jsonb_build_object('detached_list', COALESCE(stripe->'detached_list', '[]'::jsonb) || jsonb_build_array($2::text))
                     || CASE WHEN stripe->>'detach_pending' = $2 THEN jsonb_build_object('detached_at', now()) ELSE '{}'::jsonb END WHERE id=$1`, [o.id, pm]);
          out.detached++;
        } catch (e) { out.failed++; console.error(`[activate] sweep: card ${pm} (${o.company}):`, e.message); }
      }
    }
    const bals = (await q(`SELECT o.id, o.company, o.kind, o.stripe, s.stripe_customer FROM platform.orders o LEFT JOIN platform.sites s ON s.id=o.site_id
                            WHERE (o.stripe->'balance'->>'reverse_pending') = 'true' AND (o.stripe->'balance'->>'txn') IS NOT NULL AND (o.stripe->'balance'->>'reversed_at') IS NULL LIMIT 50`)).rows;
    for (const b of bals) {
      const bal = b.stripe.balance, customer = b.kind === "preview" ? b.stripe.customer : b.stripe_customer;
      try {
        await www("/internal/reverse-balance", { customer, txn: bal.txn, cents: bal.cents, order: b.id }, { timeoutMs: 20000 });
        await q("UPDATE platform.orders SET stripe = jsonb_set(stripe, '{balance}', (stripe->'balance') - 'reverse_pending' || jsonb_build_object('reversed_at', now())) WHERE id=$1", [b.id]);
        out.reversed++;
      } catch (e) { out.failed++; console.error(`[activate] sweep: balance ${bal.txn} (${b.company}):`, e.message); }
    }
  } finally { tidying = false; }
  if (out.detached || out.reversed) await logEvent("stripe_swept", null, out);
  return out;
}

// ---- Stripe's events, re-read by anetix.ai -----------------------------------------------------------------------------
// A paid first invoice finishes an activation whose answer was lost; the site's current subscription moves the fair-use
// window at each renewal; and (stage 4, 2026-09-27, src/billing.js) the standing, the cancel date and the end of a
// subscription act on the site. A replay changes nothing.
async function billingEvent(b = {}) {
  const ev = b.event || {}, sub = b.subscription && typeof b.subscription === "object" ? b.subscription : null;
  if (!/^evt_[A-Za-z0-9_]{3,}$/.test(String(ev.id || "")) || !clean(ev.type, 80)) throw fail(400, "an event id and type");
  if ((await q("SELECT 1 FROM platform.billing_events WHERE stripe_event=$1", [ev.id])).rows[0]) return { ok: true, replay: true };
  const md = (sub && sub.metadata) || {};
  const applied = {};
  const o = md.order && UUID.test(md.order) ? (await q("SELECT id, kind, state FROM platform.orders WHERE id=$1", [md.order])).rows[0] : null;
  if (sub && o && o.kind === "customer" && o.state === "activating" && ["active", "trialing"].includes(sub.status)
      && ["invoice.paid", "customer.subscription.created", "customer.subscription.updated"].includes(ev.type)) {
    await finish(o.id, sub, ev.type);
    applied.activated = true;
  }
  const site = md.site && UUID.test(md.site) ? (await q("SELECT id, company, stage, standing, cancel_at, ending, stripe_subscription, period_end, band, price_usd FROM platform.sites WHERE id=$1", [md.site])).rows[0] : null;
  if (sub && site && site.stage === "subscribed" && site.stripe_subscription === sub.id) {
    if (sub.current_period_end) {
      const ps = new Date(Number(sub.current_period_start) * 1000), pe = new Date(Number(sub.current_period_end) * 1000);
      if (!site.period_end || pe > new Date(site.period_end)) {
        await q("UPDATE platform.sites SET period_start=$2, period_end=$3, updated_at=now() WHERE id=$1", [site.id, ps, pe]);
        applied.period = { start: ps.toISOString(), end: pe.toISOString() };
      }
    }
    // stage 4 (src/billing.js): the standing (past due, unpaid: AI paused), a cancel date, a cancel on an unpaid month
    // ending it now, and the end of the subscription (back to a demo when it was asked for; flagged for Brendan when
    // Stripe ended it for a payment)
    Object.assign(applied, await require("./billing").onSubscription(site, sub, ev));
    if (ev.type === "invoice.finalization_failed") Object.assign(applied, await require("./billing").onFinalizationFailed(site, ev));
    // price book 2: the fee follows the tools live on the floor (src/modprice.js); every event is a chance to catch up
    if (!applied.returned && !applied.ended_now) require("./modprice").changed(site.company);
  }
  await q("INSERT INTO platform.billing_events (stripe_event, type, site_id, subscription, applied) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (stripe_event) DO NOTHING",
    [ev.id, clean(ev.type, 80), site ? site.id : md.site && UUID.test(md.site) ? md.site : null, sub ? clean(sub.id, 80) : null, JSON.stringify(applied)]);
  return { ok: true, applied };
}

// ---- the board ---------------------------------------------------------------------------------------------------------
async function forBoard(co, role) {
  const out = { notices: await require("./notices").forBoard(co.slug, role), terms: await require("./agreements").forBoard(co, role), billing: await require("./billing").forBoard(co.slug, role).catch(() => null) };
  const site = (await q("SELECT stage, welcome_enc IS NOT NULL AS welcome, activated_at FROM platform.sites WHERE company=$1", [co.slug])).rows[0];
  if (site && site.stage === "subscribed") {
    out.site = { subscribed: true, since: site.activated_at };
    if (site.welcome && ["manager", "admin"].includes(role)) out.welcome = { ready: true, admin: role === "admin" };
    if (["manager", "admin"].includes(role)) {
      const st = await require("./fairuse").stateOf(co.slug).catch(() => null);
      if (st && st.over) out.fair_use = { over: true, message: require("./fairuse").message(st), until: st.to };
    }
  }
  return out;
}
// The floor's first password: handed to a manager once, then gone (a new one is Settings' or the admin's to make).
async function collectWelcome(req, slug) {
  if (req.sosRole !== "manager") throw fail(403, "the site's manager collects the floor's password");
  slug = String(slug || "").toLowerCase();
  const row = (await q(`WITH old AS (SELECT welcome_enc FROM platform.sites WHERE company=$1 AND welcome_enc IS NOT NULL FOR UPDATE)
                        UPDATE platform.sites s SET welcome_enc=NULL FROM old WHERE s.company=$1 RETURNING old.welcome_enc`, [slug])).rows[0];
  if (!row) throw fail(404, "The floor's password was shown once already. Make a new one from the admin page if it was not written down.");
  let v = null; try { v = require("./connections").decrypt(row.welcome_enc); } catch (e) { v = null; }
  if (!v || !v.floor) throw fail(500, "the floor's password could not be read back; make a new one from the admin page");
  // the floor's password may have changed another way since the rollover set it (the admin's New password on the company
  // card, a restore): a password that no longer opens the floor is never shown as if it did
  const access = await require("./auth").accessRow(slug);
  if (!access || !access.floor_hash || !require("./auth").checkHash(v.floor, access.floor_hash)) {
    await logEvent("site_welcome_stale", slug, { by: req.sosAccount ? req.sosAccount.login : "manager" });
    throw fail(410, "The floor's password was changed since it was made, so there is nothing to show. Ask Anetix for the new one, or make one on the admin page.", { code: "stale" });
  }
  await logEvent("site_welcome_collected", slug, { by: req.sosAccount ? req.sosAccount.login : "manager" });
  return { floor: v.floor, board: `/c/${slug}/` };
}

// ---- Settings: the subscription, and the learning choice ---------------------------------------------------------------
// The Terms, 10.2: learning is the customer's choice, "on the Order Form or later in the Service's settings", and they may
// opt out at any time for data going forward. The manager changes it here; who and when go on the record.
async function siteForSettings(slug) {
  const s = await sites.siteRow(String(slug || "").toLowerCase());
  // a site back to a demo keeps its way to its old invoices (stage 4, src/billing.js)
  // a site back to a demo keeps its choice over the data from its paid months (the Terms, 4.4 and 10.2)
  if (!s || s.stage !== "subscribed") return { subscribed: false, billing: Boolean(s && s.stage === "back_to_demo" && s.stripe_customer), returned_at: s && s.stage === "back_to_demo" ? s.returned_at : null,
    learning_opt_in: s && s.stage === "back_to_demo" ? Boolean(s.learning_opt_in) : undefined, terms_link: s && s.stage === "back_to_demo" ? require("./agreements").termsLink() : undefined };
  const B = require("./billing");
  return { subscribed: true, summary: await require("./modprice").summaryFor(s), pilot: require("./pilot").isPilot(s.band), band: s.band ? s.band.name : null, price_usd: s.price_usd == null ? null : Number(s.price_usd), since: s.activated_at, learning_opt_in: Boolean(s.learning_opt_in), terms_link: require("./agreements").termsLink(),
    next_bill: s.cancel_at ? null : s.period_end || null, ends_on: s.cancel_at || null, standing: s.standing || "good", line: B.lineFor(s), billing: Boolean(s.stripe_customer) };
}
async function setLearning(req, slug, on) {
  if (req.sosRole !== "manager") throw fail(403, "the site's manager makes this choice");
  slug = String(slug || "").toLowerCase();
  const s = await sites.siteRow(slug);
  if (!s || !["subscribed", "back_to_demo"].includes(s.stage)) throw fail(409, "learning is a paying site's choice; a demo's is in the Terms (section 4.4)");
  const want = on === true;
  if (Boolean(s.learning_opt_in) !== want) {
    await q("UPDATE platform.sites SET learning_opt_in=$2, updated_at=now(), updated_by=$3 WHERE id=$1", [s.id, want, req.sosAccount ? req.sosAccount.login : "manager"]);
    await logEvent("site_learning_changed", slug, { on: want, by: req.sosAccount ? req.sosAccount.login : "manager" });
    await require("./record").record("learning_changed", { company: slug, actor: { role: "manager", name: req.sosAccount ? req.sosAccount.name || req.sosAccount.login : null }, after: want ? "Learning: opted in. Anetix may learn from how the site uses the system, to improve Anetix for all customers." : "Learning: opted out, for data from now on.", detail: { on: want } });
  }
  return siteForSettings(slug);
}

// ---- routes ------------------------------------------------------------------------------------------------------------
const json = express.json({ limit: "20kb" });
const guard = (fn) => async (req, res) => {
  try { res.set("Cache-Control", "no-store").json(await fn(req.body || {}, req)); }
  catch (e) { if (!e.status) console.error("[activate]", e.stack || e.message); res.status(e.status || 500).json({ error: e.status ? e.message : "Something went wrong on the platform. Try again in a minute.", code: e.code }); }
};
const requireAdmin = (req, res, next) => require("./auth").requireAdmin(req, res, next);
const requireManager = (req, res, next) => require("./auth").requireManager(req, res, next);
const who = (req) => (req.sosAccount ? req.sosAccount.name || req.sosAccount.login : "admin");
const router = express.Router();
router.get("/api/admin/sites/:slug/checks", requireAdmin, guard((_b, req) => checks(req.params.slug)));
// The Terms, 4.2: when Anetix ends a demo for a reason other than the customer's breach, the unused part of the credit
// they bought is refunded. The delete confirm shows what that is and which payments it came from, to refund in Stripe
// (the product has no line to Stripe for a payment; anetix.ai holds the key).
router.get("/api/admin/companies/:slug/refund-due", requireAdmin, guard(async (_b, req) => {
  const slug = String(req.params.slug || "").toLowerCase();
  if (!SLUG.test(slug)) throw fail(404, "no such company");
  const selfserve = require("./selfserve");
  const ss = await selfserve.selfServeRow(slug).catch(() => null);
  const purchases = (await selfserve.ledger(slug).catch(() => [])).filter((r) => r.kind === "purchase" && Number(r.paid_usd) > 0 && (!ss || !ss.credit_since || new Date(r.created_at) >= new Date(ss.credit_since)))
    .map((r) => ({ ref: r.ref, paid_usd: Number(r.paid_usd), credit_usd: Number(r.delta_usd), at: r.created_at }));
  return { refund_usd: (await refundableCents(slug)) / 100, purchases };
}));
router.post("/api/admin/sites/:slug/activate", requireAdmin, json, async (req, res) => {
  const b = req.body || {};
  const gate = await require("./auth").checkAdminCode(req, { code: b.code, password: b.password }, `activate_site:${String(req.params.slug || "").toLowerCase()}`);
  if (!gate.ok) return res.status(403).json({ error: gate.error, code: "step_up" });
  return guard(() => activate(req.params.slug, { tenancy_note: b.tenancy_note, clear_sample: b.clear_sample !== false, test_mode_ok: b.test_mode_ok === true }, who(req)))(req, res);
});
router.post("/api/admin/sites/:slug/stop-activating", requireAdmin, json, async (req, res) => {
  const b = req.body || {};
  const gate = await require("./auth").checkAdminCode(req, { code: b.code, password: b.password }, `stop_activating:${String(req.params.slug || "").toLowerCase()}`);
  if (!gate.ok) return res.status(403).json({ error: gate.error, code: "step_up" });
  return guard(() => stopActivating(req.params.slug, who(req)))(req, res);
});
router.post("/api/admin/sites/:slug/switch-on", requireAdmin, json, async (req, res) => {
  const b = req.body || {};
  const gate = await require("./auth").checkAdminCode(req, { code: b.code, password: b.password }, `switch_on_site:${String(req.params.slug || "").toLowerCase()}`);
  if (!gate.ok) return res.status(403).json({ error: gate.error, code: "step_up" });
  return guard(() => switchOn(req.params.slug, { note: b.note, clear_sample: b.clear_sample !== false }, who(req)))(req, res);
});
router.post("/api/admin/sites/:slug/switch-off", requireAdmin, json, async (req, res) => {
  const b = req.body || {};
  const gate = await require("./auth").checkAdminCode(req, { code: b.code, password: b.password }, `switch_off_site:${String(req.params.slug || "").toLowerCase()}`);
  if (!gate.ok) return res.status(403).json({ error: gate.error, code: "step_up" });
  return guard(() => switchOff(req.params.slug, who(req)))(req, res);
});
router.post("/api/admin/sites/:slug/decline", requireAdmin, json, guard((b, req) => decline(req.params.slug, b, who(req))));
router.post("/api/admin/sites/:slug/send-back", requireAdmin, json, guard((b, req) => sendBack(req.params.slug, b, who(req))));
router.post("/api/admin/sites/:slug/lift", requireAdmin, json, guard((b, req) => require("./fairuse").lift(String(req.params.slug || "").toLowerCase(), b, who(req))));
router.post("/api/admin/stripe-sweep", requireAdmin, guard(() => tidy()));   // not under /api/admin/sites/: that path is src/sites.js's save
router.post("/api/c/:slug/welcome", requireManager, guard((_b, req) => collectWelcome(req, req.params.slug)));
router.get("/api/c/:slug/site", requireManager, guard((_b, req) => siteForSettings(req.params.slug)));
router.post("/api/c/:slug/learning", requireManager, json, guard((b, req) => setLearning(req, req.params.slug, b.on)));
const wwwRouter = express.Router();
wwwRouter.use("/api/www/billing-events", (req, res, next) => (require("./selfserve").keyOk(req) ? next() : res.status(401).json({ error: "www key required" })));
wwwRouter.post("/api/www/billing-events", json, guard((b) => billingEvent(b)));

module.exports = {
  init, SCHEMA, channelProblem, channel, www, checks, activate, run, finish, amountFor, rolloverSteps, finishPending, rolloverPlan, refundableCents,
  decline, sendBack, stopActivating, switchOn, switchOff, tidy, billingEvent, forBoard, collectWelcome, siteForSettings, setLearning, router, wwwRouter,
};
