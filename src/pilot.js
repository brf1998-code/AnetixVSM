// A pilot offer (2026-10-05). Brendan: "I will need some method to sign Chelsea Clock onto their paid pilot plan
// tomorrow. It should be from within their board ... a unique pricing offering as we will be spending quite a bit of
// time on site. So really I will need a way to charge them $1,000 then another $1,000 at the start of the second
// month." And, after the customer's note that the $2,000 is a pilot cost and not a license fee to be paid on an ongoing
// basis: it ends on its own.
//
// WHAT IT IS. An offer Anetix makes to ONE company from the Sites tab: a fixed monthly fee for a fixed number of months,
// with lines of its own (time on site, integrations, hardware, the case study). It is kept on the company's site row
// (platform.sites.offer). While it stands:
//   - the company's manager sees "Start your pilot" on the board and in Settings, whether or not Go live is switched on
//     for everyone (src/golive.js forBoard and resolve): the offer is the invitation
//   - Go live on anetix.ai is the same four screens, signature and card, but the price screen and the order form are the
//     pilot's (src/sites.js pilotText, pricingView), and a signed order keeps the offer exactly as it was signed
//   - Activate charges the first month and makes the subscription end on its own after the last one (anetix.ai sets
//     Stripe's cancel_at to the start date plus the months, so no charge is ever made after the last payment); the site
//     is a paying site until then, with a floor password, no credit line, and the fair-use line at 80% of the month's fee
//   - on the end date Stripe ends it and the site goes back to a demo, tools and data kept (src/billing.js); anything
//     after that is a new offer or the price book, agreed first
// A pilot is never repriced by the tools live on the floor (src/modprice.js skips it).
//
// The offer is cleared when it is activated (the signed order and the site's band keep it), and Brendan can change or
// withdraw it until an order under it is signed.
//
// Routes (admin only):
//   GET  /api/admin/sites/:slug/offer     the offer, the default lines, and the order form it would make
//   POST /api/admin/sites/:slug/offer     { monthly_usd, months, lines: [{ label, text }] } or { clear: true }
const crypto = require("crypto");
const express = require("express");
const { q, logEvent } = require("./db");
const sites = require("./sites");

const SLUG = /^[a-z0-9][a-z0-9-]{1,40}$/;
const fail = (status, msg, extra) => Object.assign(new Error(msg), { status }, extra || {});
const clean = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
// A line's label is shown in bold on the order form (anetix.ai's orderFormHtml reads "Label: text"), so it has that shape.
const LABEL = /^[A-Z][A-Za-z ,-]{1,40}$/;
const RESERVED = ["customer", "site", "plant manager", "billing email", "pilot", "fee", "what the fee is", "end", "cancelling", "included", "fair use", "data", "learning", "after the pilot", "unused demo credit", "terms", "order of precedence"];

// The lines a new offer starts with: the pilot Brendan and Taylor proposed to their first pilot site (2026-10-02),
// in words any site could sign. Each is his to change on the Sites tab before the customer signs.
const DEFAULT_LINES = Object.freeze([
  { label: "On site", text: "Anetix will be at the Site as much as needed to get the pilot running, then about 4 hours a week, mostly with the people on the floor who use it." },
  { label: "Integrations", text: "Anetix will work on connecting the systems Customer names for the pilot at no additional charge." },
  { label: "Hardware", text: "The pilot runs on equipment Customer already has. More screens or tablets are available at cost plus handling, quoted separately." },
  { label: "Ownership", text: "Customer owns all of its data. Anetix owns the system." },
  { label: "Case study", text: "Anetix would like to tell the story of the pilot with quotes and pictures of the operation. Nothing is published without Customer's approval." },
]);

// An offer as it is kept, from what the Sites tab sends. Pure. -> { offer, problems }
function cleanOffer(body = {}, by = null, now = new Date()) {
  const problems = [];
  const money = Number(String(body.monthly_usd == null ? "" : body.monthly_usd).replace(/[$, ]/g, ""));
  const months = Number(body.months);
  if (!Number.isFinite(money) || money < 1 || money > 100000 || Math.abs(Math.round(money * 100) - money * 100) > 1e-6) problems.push("the monthly fee is a dollar amount from 1 to 100,000");
  if (!Number.isInteger(months) || months < 1 || months > 12) problems.push("the pilot runs a whole number of months, 1 to 12");
  const lines = [], seen = new Set();
  for (const l of Array.isArray(body.lines) ? body.lines : []) {
    const label = clean(l && l.label, 40), text = clean(l && l.text, 600).replace(/[.]+$/, "") ;
    if (!label && !text) continue;
    if (!LABEL.test(label)) { problems.push(`a line's label starts with a capital and is letters and spaces only ("${label || "empty"}")`); continue; }
    if (RESERVED.includes(label.toLowerCase())) { problems.push(`the order form has its own "${label}" line; give this one another label`); continue; }
    if (seen.has(label.toLowerCase())) { problems.push(`two lines are labelled "${label}"`); continue; }
    if (text.length < 3) { problems.push(`the "${label}" line needs its words`); continue; }
    if (/[–—]/.test(text)) { problems.push(`the "${label}" line has a dash in it; use a comma or a period`); continue; }
    seen.add(label.toLowerCase());
    lines.push({ label, text });
  }
  if (lines.length > 12) problems.push("twelve lines at most");
  return { offer: { kind: "pilot", id: crypto.randomUUID(), monthly_usd: Math.round(money * 100) / 100, months, lines, made_by: by || null, made_at: new Date(now).toISOString() }, problems };
}
// The offer as an order and a site keep it once signed: a band of its own, so everything that reads a band (the Sites
// tab, Settings, Activate) has a name and a monthly price, and nothing mistakes it for a price book band. Pure.
function bandSnap(offer) {
  return { key: "pilot", name: "Pilot", monthly_usd: Number(offer.monthly_usd), pilot: { id: offer.id || null, months: Number(offer.months), total_usd: Math.round(Number(offer.monthly_usd) * Number(offer.months) * 100) / 100, lines: offer.lines || [], made_by: offer.made_by || null, made_at: offer.made_at || null },
    why: `a pilot offered by Anetix: ${sites.pilotLine(offer)}` };
}
const isPilot = (band) => Boolean(band && band.key === "pilot" && band.pilot);
// The offer standing for a company right now, or null. A site that is switching on or subscribed has none to take.
function standing(site) {
  const o = site && site.offer;
  return o && o.kind === "pilot" && Number(o.monthly_usd) > 0 && Number.isInteger(Number(o.months)) && !["activating", "subscribed"].includes(site.stage) ? o : null;
}

async function get(slug) {
  slug = String(slug || "").toLowerCase();
  if (!SLUG.test(slug) || !(await q("SELECT 1 FROM platform.companies WHERE slug=$1", [slug])).rows[0]) throw fail(404, "no such company");
  const site = await sites.siteRow(slug);
  const offer = standing(site);
  const band = site && pilotBandOf(site);
  return { offer, defaults: { monthly_usd: 1000, months: 2, lines: DEFAULT_LINES }, stage: site ? site.stage : "demo",
    running: site && site.stage === "subscribed" && band ? { monthly_usd: band.monthly_usd, months: band.pilot.months, ends_at: band.pilot.ends_at || site.cancel_at || null } : null,
    preview: offer ? sites.pilotText({ facts: previewFacts(site), offer, terms_url: `${require("./selfserve").WWW_URL()}/terms` }) : null };
}
const pilotBandOf = (site) => (site && isPilot(site.band) ? site.band : null);
function previewFacts(site) {
  return { legal_name: site.legal_name || "(the company's legal name)", site_name: site.site_name || "(the site)", site_address: site.site_address || null, plant_manager: site.plant_manager || null, billing: site.billing || null, learning: false };
}
// Make, change or withdraw a company's offer. Under the lock every order change takes (src/golive.js withSite), so an
// order is never signed against an offer that is changing under it: a draft is asked to look again by its hash, and a
// signed order refuses the change (Send back or Withdraw first).
async function set(slug, body = {}, by) {
  slug = String(slug || "").toLowerCase();
  if (!SLUG.test(slug) || !(await q("SELECT 1 FROM platform.companies WHERE slug=$1", [slug])).rows[0]) throw fail(404, "no such company");
  const golive = require("./golive");
  const site0 = await golive.ensureSite(slug);
  let offer = null;
  if (!body.clear) {
    const c = cleanOffer(body, by);
    if (c.problems.length) throw fail(400, c.problems.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(". ") + ".");
    offer = c.offer;
  }
  await golive.withSite({ site: { id: site0.id }, who: "admin" }, async (c, site, open) => {
    if (["activating", "subscribed"].includes(site.stage)) throw fail(409, "This site is paying already. A new offer is for after its subscription or pilot has ended.");
    if (open && open.kind === "customer" && open.state !== "draft") throw fail(409, "This site has a signed order. Send it back or withdraw it first, then change the offer.");
    await c.query("UPDATE platform.sites SET offer=$2, updated_at=now(), updated_by=$3 WHERE id=$1", [site.id, offer ? JSON.stringify(offer) : null, by || "admin"]);
    // a draft under the old terms: its price and text are made again when it is next read, and a signature over the
    // old words is refused by its version and its hash
    // (and its band and price are worked out again now, so a draft never keeps a pilot's band after the offer is gone:
    // the board and the link read the band. Found by the review of 2026-10-05.)
    if (open && open.state === "draft") {
      const qt = await golive.quoteFor(c, { ...site, offer }, open.facts, await sites.currentBook());
      await c.query("UPDATE platform.orders SET version=version+1, band=$2, price_usd=$3, updated_at=now() WHERE id=$1", [open.id, qt.band ? JSON.stringify(qt.band) : null, qt.price_usd]);
    }
  });
  await logEvent(offer ? "pilot_offered" : "pilot_offer_withdrawn", slug, offer ? { monthly_usd: offer.monthly_usd, months: offer.months, lines: offer.lines.map((l) => l.label), by: by || null } : { by: by || null });
  return get(slug);
}

const router = express.Router();
const json = express.json({ limit: "40kb" });
const requireAdmin = (req, res, next) => require("./auth").requireAdmin(req, res, next);
const guard = (fn) => async (req, res) => { try { res.set("Cache-Control", "no-store").json(await fn(req)); } catch (e) { if (!e.status) console.error("[pilot]", e.stack || e.message); res.status(e.status || 500).json({ error: e.status ? e.message : "Something went wrong on the platform. Try again in a minute." }); } };
const who = (req) => (req.sosAccount ? req.sosAccount.name || req.sosAccount.login : "admin");
router.get("/api/admin/sites/:slug/offer", requireAdmin, guard((req) => get(req.params.slug)));
router.post("/api/admin/sites/:slug/offer", requireAdmin, json, guard((req) => set(req.params.slug, req.body || {}, who(req))));

module.exports = { DEFAULT_LINES, cleanOffer, bandSnap, isPilot, standing, pilotBandOf, get, set, router };
