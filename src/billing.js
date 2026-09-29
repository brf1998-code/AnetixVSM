// Paid sites, stage 4 as far as the first paying site needs it (2026-09-27, the launch audit's C6; docs/PAID-SITES.md
// "The life of a site", "Cancel, and back to a demo", "Stripe, end to end"). Brendan: the price screen says "Cancel any
// time" and the Terms (6.2) say to cancel "in the Service's billing settings", so a paying site needs a way to cancel,
// change the card and see its invoices, and what happens after has to happen.
//
// MANAGE BILLING. Settings on a paying site has one button. The product signs a ten-minute link for the site
// (`billing:<slug>:<site id>:<exp>` under SOS_WWW_KEY) and anetix.ai, which holds the Stripe key, asks the product whose
// Stripe Customer that is (POST /api/www/billing/portal), opens a customer portal session for it and sends the browser
// there. The portal (configured by anetix.ai through the API): change the card, see and download invoices, cancel at
// the end of the month already paid, with a reason. No plan switching (the band is Anetix's to set). The manager only:
// the floor shares a password, and an admin never cancels for a customer.
//
// WHAT STRIPE'S EVENTS NOW DO (billingEvent in src/activate.js hands the site's current subscription here):
//   past_due        a card payment failed and Stripe is retrying: the manager's board and Settings say so, nothing stops
//   unpaid          Stripe's retries ran out (the account is set to mark the subscription unpaid, not to cancel it):
//                   new AI work pauses (src/selfserve.js assertCredit), the tools keep running, Brendan may End it
//   a cancel date   the customer cancelled in the portal: the board says when it ends and how to keep it; everything
//                   runs until then. A cancel on a month nobody paid for ends it now (the order form: the end of the
//                   month ALREADY PAID is past), open invoices voided
//   canceled        the subscription is over. Cancelled because it was asked for (the portal, or End): back to a demo.
//                   Cancelled by Stripe for a failed payment or a dispute: flagged for Brendan and nothing else, because
//                   billing never takes a floor down by itself; he decides with End.
//   good again      the line goes away
// Brendan's phone hears of each (src/notify.js).
//
// BACK TO A DEMO (backToDemo, safe to run twice): the site's stage back_to_demo with returned_at; the DEMO strip back;
// the floor's password removed, which signs the floor out; AI on credit again from 0%, counted from this moment
// (self_serve.credit_since bounds both the ledger and the spend, so the demo's old spend is never handed back as
// credit); the tools, their data, their versions, the record and the manager accounts untouched; a notice for the
// manager. Go live works again from there.
//
// END (the Sites tab, a fresh code): for a site whose payment failed for good (unpaid) or whose subscription Stripe
// already cancelled. anetix.ai cancels the subscription now and voids its open invoices, then the site goes back to a demo.
//
// Routes:
//   manager: POST /api/c/:slug/billing                the portal link (ten minutes)
//   www:     POST /api/www/billing/portal             { slug, t }  -> { customer, return_path, name }
//   admin:   POST /api/admin/sites/:slug/end          { code, note }
const crypto = require("crypto");
const express = require("express");
const { q, pool, logEvent } = require("./db");
const sites = require("./sites");

const SCHEMA = `
ALTER TABLE platform.self_serve ADD COLUMN IF NOT EXISTS credit_since TIMESTAMPTZ;   -- the credit counts from here (back to a demo)
ALTER TABLE platform.sites ADD COLUMN IF NOT EXISTS ending JSONB;                     -- End or a cancel on an unpaid month asked for, not done yet
`;
async function init() { await q(SCHEMA); }

const SLUG = /^[a-z0-9][a-z0-9-]{1,40}$/;
const fail = (status, msg, extra) => Object.assign(new Error(msg), { status }, extra || {});
const clean = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const KEY = () => process.env.SOS_WWW_KEY || "";
const WWW = () => String(process.env.SOS_WWW_URL || "https://anetix.ai").replace(/\/+$/, "");
const notify = (...a) => require("./notify").notify(...a);
const dayOf = (d) => new Date(d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" });
const usd = (n) => `$${Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const CONTACT = "brendan@anetix.ai or taylor@anetix.ai";

// ---- the link ----------------------------------------------------------------------------------------------------------
// "<exp>.<mac>", exp in unix seconds ten minutes out, mac = HMAC-SHA256 over "billing:<slug>:<site id>:<exp>" under
// SOS_WWW_KEY, base64url, 32 characters. Bound to the site's permanent id, so a freed slug's next company never opens the
// last one's billing. Pure but for the clock and the key.
function billingToken(slug, siteId, now = Date.now(), key = KEY()) {
  if (key.length < 16 || !SLUG.test(String(slug || "")) || !siteId) return "";
  const exp = Math.floor(now / 1000) + 600;
  return `${exp}.${crypto.createHmac("sha256", key).update(`billing:${slug}:${siteId}:${exp}`).digest("base64url").slice(0, 32)}`;
}
function billingTokenOk(slug, siteId, t, now = Date.now(), key = KEY()) {
  const m = /^(\d{9,11})\.([A-Za-z0-9_-]{32})$/.exec(String(t || ""));
  if (!m || key.length < 16 || !siteId || Number(m[1]) * 1000 <= now || Number(m[1]) * 1000 > now + 900e3) return false;
  const want = crypto.createHmac("sha256", key).update(`billing:${slug}:${siteId}:${m[1]}`).digest("base64url").slice(0, 32);
  return crypto.timingSafeEqual(Buffer.from(m[2]), Buffer.from(want));
}
const HAS_BILLING = ["subscribed", "back_to_demo"];   // a site back to a demo still reads its old invoices
async function linkFor(req, slug) {
  if (req.sosRole !== "manager") throw fail(403, "the site's manager opens billing");
  slug = String(slug || "").toLowerCase();
  const s = await sites.siteRow(slug);
  if (!s || !s.stripe_customer || !HAS_BILLING.includes(s.stage)) throw fail(409, "This company has no billing yet: it is a demo that has not gone live.");
  const t = billingToken(slug, s.id);
  if (!t) throw fail(503, "Billing cannot be opened from this instance (SOS_WWW_KEY is not set).");
  await logEvent("billing_link", slug, { by: req.sosAccount ? req.sosAccount.login : "manager" });
  return { url: `${WWW()}/c/${slug}/billing?t=${t}` };
}
// anetix.ai asks whose Customer a link is for; the answer is the product's, never the link's
async function portalFor(b = {}) {
  const slug = String(b.slug || "").toLowerCase();
  const s = SLUG.test(slug) ? await sites.siteRow(slug) : null;
  if (!s || !billingTokenOk(slug, s.id, b.t)) throw fail(404, "that link does not open billing");
  if (!s.stripe_customer || !HAS_BILLING.includes(s.stage)) throw fail(410, "This company has no billing to show any more.");
  const co = (await q("SELECT name FROM platform.companies WHERE slug=$1", [slug])).rows[0] || {};
  await logEvent("billing_portal_opened", slug, { site: s.id });
  return { ok: true, customer: s.stripe_customer, return_path: `/c/${slug}/settings`, name: co.name || slug };
}

// ---- the lines a manager reads -----------------------------------------------------------------------------------------
// One line for the board and Settings from the site's standing and cancel date, or null. Pure.
function lineFor(s) {
  if (!s || s.stage !== "subscribed") return null;
  if (s.standing === "unpaid") return { level: "red", text: `Payment for this site is overdue, so new AI work is paused. Your tools keep running. Update the card under Settings, Manage billing, or write to ${CONTACT}.` };
  if (s.standing === "canceled_at_stripe") return { level: "red", text: `This site's subscription lapsed after its payments failed, so new AI work is paused. Your tools keep running. Write to ${CONTACT} to sort it out.` };
  if (s.standing === "past_due") return { level: "amber", text: "A payment for this site did not go through. Stripe will try the card again; you can update it under Settings, Manage billing. Nothing stops in the meantime." };
  if (s.cancel_at) return { level: "amber", text: `This site's subscription ends on ${dayOf(s.cancel_at)}. Everything works until then, and after that it goes back to a demo with your tools and data kept. To keep it, open Settings, Manage billing.` };
  return null;
}
async function forBoard(slug, role) {
  if (!["manager", "admin"].includes(role)) return null;
  const s = await sites.siteRow(slug);
  return lineFor(s);
}

// ---- the events ----------------------------------------------------------------------------------------------------------
// The site's CURRENT subscription as anetix.ai re-read it (src/activate.js billingEvent checks it is the current one and
// the site is subscribed). Returns what was applied.
async function onSubscription(site, sub, ev) {
  const applied = {};
  const co = (await q("SELECT name FROM platform.companies WHERE slug=$1", [site.company])).rows[0] || { name: site.company };
  if (["canceled", "incomplete_expired"].includes(sub.status)) {
    const asked = sub.cancellation_reason === "cancellation_requested" || Boolean(site.ending);
    if (asked) {
      const r = await backToDemo(site.id, site.ending ? site.ending.why : "the customer cancelled", site.ending ? site.ending.by : "the customer");
      if (r.returned) applied.returned = true;
      return applied;
    }
    if (site.standing !== "canceled_at_stripe") {
      await q("UPDATE platform.sites SET standing='canceled_at_stripe', attention=$2, updated_at=now() WHERE id=$1", [site.id, JSON.stringify({ kind: "canceled_at_stripe", reason: sub.cancellation_reason || null, at: new Date().toISOString(), event: ev.id })]);
      applied.attention = "canceled_at_stripe";
      await logEvent("site_canceled_at_stripe", site.company, { subscription: sub.id, event: ev.id, reason: sub.cancellation_reason || null });
      notify("Stripe cancelled a site", `${co.name}: Stripe ended the subscription (${sub.cancellation_reason || "no reason given"}). The floor still works. Decide on the Sites tab: End sends it back to a demo.`, { priority: 4, tags: ["warning"], ref: site.company });
    }
    return applied;
  }
  const cancelAt = sub.cancel_at ? new Date(Number(sub.cancel_at) * 1000) : sub.cancel_at_period_end && sub.current_period_end ? new Date(Number(sub.current_period_end) * 1000) : null;
  const step = sites.next({ stage: site.stage, standing: site.standing === "canceled_at_stripe" ? "good" : site.standing, cancel_at: site.cancel_at }, { type: "stripe_status", status: sub.status, cancel_at: cancelAt ? cancelAt.toISOString() : null });
  if (!step.ok) return applied;   // trialing and the like: nothing to do
  const st = step.state;
  if (step.effects.includes("end_now")) {   // a cancel on a month nobody paid for: it ends now, not on the date Stripe gave
    await endNow(site.id, { why: "cancelled while a payment was overdue, so it ended at once (the order form: a cancel takes effect at the end of the month already paid)", by: "the customer" });
    applied.ended_now = true;
    return applied;
  }
  const was = { standing: site.standing, cancel_at: site.cancel_at ? new Date(site.cancel_at).toISOString() : null };
  if (st.standing !== site.standing || String(was.cancel_at) !== String(st.cancel_at)) {
    await q("UPDATE platform.sites SET standing=$2, cancel_at=$3, updated_at=now() WHERE id=$1", [site.id, st.standing, st.cancel_at]);
    applied.standing = st.standing; applied.cancel_at = st.cancel_at;
  }
  if (st.standing !== was.standing) {
    await logEvent("site_standing", site.company, { from: was.standing, to: st.standing, event: ev.id });
    if (st.standing === "past_due") notify("A site's payment failed", `${co.name}: the card payment did not go through. Stripe is retrying; the manager sees a line asking to update the card. Nothing stops.`, { priority: 4, tags: ["credit_card"], ref: site.company });
    else if (st.standing === "unpaid") notify("A site is unpaid", `${co.name}: Stripe's retries ran out. New AI work is paused, the tools keep running. End is on the Sites tab if it comes to that.`, { priority: 5, tags: ["rotating_light"], ref: site.company });
    else if (st.standing === "good" && ["past_due", "unpaid"].includes(was.standing)) notify("A site paid", `${co.name}: the overdue payment went through. Back to good standing.`, { tags: ["white_check_mark"], ref: site.company });
  }
  if (!was.cancel_at && st.cancel_at) {
    await logEvent("site_cancel_set", site.company, { cancel_at: st.cancel_at, event: ev.id });
    await require("./record").record("site_cancel_set", { company: site.company, actor: { role: "manager", name: null }, after: `Cancelled in billing: the subscription ends on ${dayOf(st.cancel_at)}.`, detail: { cancel_at: st.cancel_at } }).catch(() => {});
    notify("A site cancelled", `${co.name} cancelled. It ends on ${dayOf(st.cancel_at)} and goes back to a demo then.`, { priority: 4, tags: ["wave"], ref: site.company });
  } else if (was.cancel_at && !st.cancel_at) {
    await logEvent("site_cancel_cleared", site.company, { event: ev.id });
    notify("A site is staying", `${co.name} took back its cancellation.`, { tags: ["tada"], ref: site.company });
  }
  return applied;
}
// Invoice trouble that is not a standing (usually a tax address Stripe cannot use): Brendan's phone and the Sites tab.
async function onFinalizationFailed(site, ev) {
  await q("UPDATE platform.sites SET attention=$2, updated_at=now() WHERE id=$1", [site.id, JSON.stringify({ kind: "invoice_not_finalized", at: new Date().toISOString(), event: ev.id })]);
  const co = (await q("SELECT name FROM platform.companies WHERE slug=$1", [site.company])).rows[0] || { name: site.company };
  notify("An invoice could not be finalized", `${co.name}: Stripe could not finalize an invoice (often the tax address). Look in the Stripe dashboard.`, { priority: 4, tags: ["warning"], ref: site.company });
  return { attention: "invoice_not_finalized" };
}

// ---- ending, and back to a demo ----------------------------------------------------------------------------------------
// The flag `ending` says, while the channel call runs, that the end was asked for, so a customer.subscription.deleted
// arriving in that window returns the site with the right reason. It is cleared when the call fails: a flag left behind
// would later read a payment-failure cancel as asked for, and billing never takes a floor down by itself.
async function endNow(siteId, { why, by } = {}) {
  const s = (await q("SELECT * FROM platform.sites WHERE id=$1", [siteId])).rows[0];
  if (!s || s.stage !== "subscribed") return { already: true };
  await q("UPDATE platform.sites SET ending=$2, updated_at=now() WHERE id=$1", [s.id, JSON.stringify({ why: clean(why, 300), by: clean(by, 120) || "admin", at: new Date().toISOString() })]);
  if (s.stripe_subscription) {
    // cancelled now (gone already counts) and every invoice it left open voided, so nobody is dunned for a month the site did not get
    try { await require("./activate").www("/internal/end", { subscription: s.stripe_subscription, site: s.id }, { timeoutMs: 30000 }); }
    catch (e) { await q("UPDATE platform.sites SET ending=NULL WHERE id=$1", [s.id]).catch(() => {}); throw e; }
  }
  return backToDemo(s.id, why, by);
}
async function backToDemo(siteId, why, by) {
  const c = await pool.connect();
  let s;
  try {
    await c.query("BEGIN");
    s = (await c.query("SELECT * FROM platform.sites WHERE id=$1 FOR UPDATE", [siteId])).rows[0];
    if (!s || s.stage !== "subscribed") { await c.query("ROLLBACK"); return { returned: false, already: true }; }
    await c.query(`UPDATE platform.sites SET stage='back_to_demo', standing=NULL, cancel_at=NULL, attention=NULL, ending=NULL, welcome_enc=NULL,
                     stripe_subscription=NULL, returned_at=now(), updated_at=now(), updated_by=$2 WHERE id=$1`, [s.id, clean(by, 120) || "platform"]);
    await c.query("UPDATE platform.companies SET demo=true WHERE slug=$1", [s.company]);
    require("./kind").forget(s.company);   // a trial again (src/kind.js)
    // the credit counts from now, both sides: the old ledger and the old spend are behind the line
    const had = (await c.query("SELECT 1 FROM platform.self_serve WHERE company=$1", [s.company])).rows[0];
    if (had) await c.query("UPDATE platform.self_serve SET credit_since=now() WHERE company=$1", [s.company]);
    else {
      const m = (await c.query("SELECT login, display_name FROM platform.accounts WHERE role='manager' AND company=$1 ORDER BY created_at LIMIT 1", [s.company])).rows[0] || {};
      await c.query("INSERT INTO platform.self_serve (company, email, contact, credit_since) VALUES ($1,$2,$3,now()) ON CONFLICT (company) DO UPDATE SET credit_since=now()", [s.company, m.login || null, m.display_name || null]);
    }
    // the floor's password goes in the same transaction, which signs the floor out (auth.accountsOnly's statement)
    await c.query(`INSERT INTO platform.company_access (company, legacy_login) VALUES ($1,false)
                   ON CONFLICT (company) DO UPDATE SET floor_hash=NULL, manager_hash=NULL, legacy_login=false,
                     generation=platform.company_access.generation + 1, updated_at=now()`, [s.company]);
    await require("./notices").add(s.company, "back_to_demo", `This site's subscription has ended (${clean(why, 200)}), so it is a demo again. Every tool and all your data are still here. The floor's sign-in is closed, and AI runs on credit again: add credit on anetix.ai to keep building, or go live again any time. Questions: ${CONTACT}.`, { why: clean(why, 300) }, c);
    await c.query("COMMIT");
  } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; }
  finally { c.release(); }
  await require("./auth").accountsOnly(s.company);   // again, for its cache of generations (the row is already right)
  await logEvent("site_back_to_demo", s.company, { why: clean(why, 300), by: clean(by, 120) || null, subscription: s.stripe_subscription || null });
  await require("./record").record("site_back_to_demo", { company: s.company, actor: { role: "platform", name: "Anetix" }, after: `Back to a demo: ${clean(why, 300)}. The tools and data stay; the floor's sign-in is closed; AI runs on credit again.`, detail: { subscription: s.stripe_subscription || null } }).catch(() => {});
  const co = (await q("SELECT name FROM platform.companies WHERE slug=$1", [s.company])).rows[0] || { name: s.company };
  notify("A site is a demo again", `${co.name}: ${clean(why, 200)}. The floor is signed out; the tools and data stay.`, { tags: ["arrow_down"], ref: s.company });
  return { returned: true };
}
// Brendan's End: a site whose payment failed for good, or one Stripe already cancelled
async function end(slug, { note } = {}, by) {
  slug = String(slug || "").toLowerCase();
  const s = SLUG.test(slug) ? await sites.siteRow(slug) : null;
  if (!s) throw fail(404, "no such site");
  const words = clean(note, 300);
  if (words.length < 3) throw fail(400, "say why, in a few words: it goes on the site's record and the manager's notice");
  if (s.stage !== "subscribed") throw fail(409, "only a subscribed site can be ended");
  if (!["unpaid", "canceled_at_stripe"].includes(s.standing)) throw fail(409, "End is for a site whose payment failed for good (unpaid) or whose subscription Stripe cancelled. A customer cancels in Manage billing.", { code: "not_unpaid" });
  // the Terms, 5.8: Anetix may end a Subscription "on notice" once Fees are 30 days overdue. The overdue run starts at the
  // first failed payment after the last good one (the site_standing events). Stripe having ended it already is not held back.
  if (s.standing === "unpaid") {
    const since = (await q(`SELECT min(created_at) AS at FROM platform.events WHERE kind='site_standing' AND ref=$1 AND detail->>'to' IN ('past_due','unpaid')
                              AND created_at > COALESCE((SELECT max(created_at) FROM platform.events WHERE kind='site_standing' AND ref=$1 AND detail->>'to'='good'), 'epoch')`, [slug])).rows[0].at;
    const ok = since && Date.now() - new Date(since).getTime() >= 30 * 86400e3;
    if (!ok) throw fail(409, `The Terms (5.8) let Anetix end a subscription once its fees are 30 days overdue, on notice. This one has been overdue since ${since ? dayOf(since) : "recently"}, so End opens on ${since ? dayOf(new Date(new Date(since).getTime() + 30 * 86400e3)) : "a later day"}. Until then new AI work stays paused and the tools run.`, { code: "too_soon" });
  }
  return endNow(s.id, { why: `ended by Anetix: ${words}`, by });
}

// ---- routes ------------------------------------------------------------------------------------------------------------
const json = express.json({ limit: "10kb" });
const guard = (fn) => async (req, res) => {
  try { res.set("Cache-Control", "no-store").json(await fn(req.body || {}, req)); }
  catch (e) { if (!e.status) console.error("[billing]", e.stack || e.message); res.status(e.status || 500).json({ error: e.status ? e.message : "Something went wrong on the platform. Try again in a minute.", code: e.code }); }
};
const router = express.Router();
router.post("/api/c/:slug/billing", (req, res, next) => require("./auth").requireManager(req, res, next), guard((_b, req) => linkFor(req, req.params.slug)));
router.post("/api/admin/sites/:slug/end", (req, res, next) => require("./auth").requireAdmin(req, res, next), json, async (req, res) => {
  const b = req.body || {};
  const gate = await require("./auth").checkAdminCode(req, { code: b.code, password: b.password }, `end_site:${String(req.params.slug || "").toLowerCase()}`);
  if (!gate.ok) return res.status(403).json({ error: gate.error, code: "step_up" });
  return guard(() => end(req.params.slug, b, req.sosAccount ? req.sosAccount.name || req.sosAccount.login : "admin"))(req, res);
});
const wwwRouter = express.Router();
wwwRouter.use("/api/www/billing/portal", (req, res, next) => (require("./selfserve").keyOk(req) ? next() : res.status(401).json({ error: "www key required" })));
wwwRouter.post("/api/www/billing/portal", json, guard((b) => portalFor(b)));

module.exports = { init, SCHEMA, billingToken, billingTokenOk, linkFor, portalFor, lineFor, forBoard, onSubscription, onFinalizationFailed, endNow, backToDemo, end, router, wwwRouter, CONTACT };
