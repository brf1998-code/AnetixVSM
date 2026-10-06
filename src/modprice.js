// The fee follows the tools live on the floor (price book 2, 2026-10-05; src/sites.js BOOK_V2 and feeFor). Brendan:
// "$300 per month per module ... with every new module, it stacks on until they reach the maxed out price they would
// normally have with the current plan ... So it makes entry much easier and it would also cap out their price for
// maximum expansion within their plant."
//
// HOW A BILL CHANGES. A subscribed site's subscription at Stripe is one monthly Price for the amount it pays. When the
// number of tools live on its floor changes (a tool made live, one taken off the floor, a tool deleted), the product
// works the fee out again from the plan the site signed (its band: per_tool_usd, min_tools and the cap) and, if it
// moved, asks anetix.ai over the private channel to move the subscription to the Price for the new amount with no
// proration. So the NEXT bill is the first at the new amount, and nothing is charged part way through a month, which is
// what the order form says ("a tool made live raises the fee from the next bill"). The manager is told on the board,
// with the amount and the date, and Anetix on the phone.
//
// It is safe to run any number of times: it compares what the site pays with what its tools come to and does nothing
// when they agree. It runs after every change to a live version (src/registry.js), on every Stripe event for the site
// (src/activate.js billingEvent), at boot and every 15 minutes, so a missed moment (the channel down, a restart) is
// caught up well before a monthly bill. A pilot (src/pilot.js) and a flat band (price book 1) are never repriced.
//
// The same sweep tells Anetix a week before a pilot ends, so what comes next is agreed before the site goes back to a demo.
const { q, logEvent } = require("./db");
const sites = require("./sites");

const usd = (n) => `$${Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const dayOf = (d) => new Date(d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" });
const tools = (n) => `${n} tool${n === 1 ? "" : "s"}`;
const cents = (x) => Math.round(Number(x || 0) * 100);

// Does this site's fee follow its tools? A subscribed site that signed price book 2, and not a pilot. Pure.
function follows(site) {
  return Boolean(site && site.stage === "subscribed" && site.band && Number(site.band.per_tool_usd) > 0 && !require("./pilot").isPilot(site.band));
}
// What the site should pay now against what it pays. Pure. -> { fee, from_usd, to_usd, moved }
function plan(site, live) {
  const fee = sites.feeFor(site.band, live);
  return { fee, from_usd: Number(site.price_usd || 0), to_usd: fee.usd, moved: cents(fee.usd) !== cents(site.price_usd) };
}
// The words a manager reads when the bill moves. Pure.
function notice(p, nextBill) {
  const f = p.fee, when = nextBill ? `From your next bill on ${dayOf(nextBill)}` : "From your next bill";
  const cap = f.capped ? ` That is this site's cap: every tool past it is included.` : ` (${usd(f.per_tool_usd)} a tool, never more than ${usd(f.cap_usd)}).`;
  return `${f.tools === 1 ? "1 tool is" : `${f.tools} tools are`} live on your floor now. ${when} this site is ${usd(p.to_usd)} a month, ${p.to_usd > p.from_usd ? "up" : "down"} from ${usd(p.from_usd)}.${cap} Nothing is charged before then.`;
}

const running = new Map();   // slug -> the sync in flight, so two changes close together make one call
async function sync(slug, opts) {
  slug = String(slug || "").toLowerCase();
  if (running.has(slug)) return running.get(slug);
  const p = syncOnce(slug, opts).finally(() => running.delete(slug));
  running.set(slug, p);
  return p;
}
// check: ask anetix.ai even when the fee has not moved here, so Stripe itself is brought to the amount (the sweep does:
// a request that timed out here can still land at Stripe later, after a newer one, and what this table says would then
// never notice. Found by the review of 2026-10-05). anetix.ai answers "the same" without touching Stripe when it is.
async function syncOnce(slug, { check = false } = {}) {
  const site = await sites.siteRow(slug);
  if (!follows(site) || !site.stripe_subscription) return { skipped: true };
  if (site.standing === "canceled_at_stripe") return { skipped: true };   // nothing left at Stripe to move
  const live = await sites.liveTools(slug);
  const p = plan(site, live);
  if (!p.moved && !check) return { same: true, usd: p.to_usd, tools: live };
  const c = cents(p.to_usd);
  let ans;
  try {
    ans = await require("./activate").www("/internal/reprice", { subscription: site.stripe_subscription, site: site.id,
      price: { lookup_key: `anetix_tools_v${site.price_book}_${c}`, unit_amount: c, name: "Anetix: tools live on the floor", band: "tools", book: site.price_book },
      metadata: { tools: String(live) } }, { timeoutMs: 30000 });
  } catch (e) {
    console.error(`[modprice] ${slug}: the bill should move from ${usd(p.from_usd)} to ${usd(p.to_usd)} (${tools(live)} live) and did not: ${e.message}. The next sweep tries again.`);
    return { error: e.message, from_usd: p.from_usd, to_usd: p.to_usd, tools: live };
  }
  if (!p.moved) {   // the sweep's check: this table was right; Stripe either was too, or has just been put right
    if (!ans.same) { console.error(`[modprice] ${slug}: Stripe was not on ${usd(p.to_usd)} a month and is now`); await logEvent("site_reprice_corrected", slug, { usd: p.to_usd, tools: live, price: ans.price_id || null }); }
    return { same: true, corrected: !ans.same, usd: p.to_usd, tools: live };
  }
  // only if the site is still the one that was read (not ended or repriced by another run in the meantime)
  const done = (await q("UPDATE platform.sites SET price_usd=$2, updated_at=now(), updated_by='platform' WHERE id=$1 AND stage='subscribed' AND stripe_subscription=$3 AND price_usd=$4 RETURNING period_end, cancel_at",
    [site.id, p.to_usd, site.stripe_subscription, site.price_usd])).rows[0];
  if (!done) return { raced: true };
  const next = done.cancel_at ? null : done.period_end;
  await logEvent("site_repriced", slug, { from_usd: p.from_usd, to_usd: p.to_usd, tools: live, price: ans.price_id || null, next_bill: next });
  await require("./record").record("site_repriced", { company: slug, actor: { role: "platform", name: "Anetix" }, after: `The site's fee is ${usd(p.to_usd)} a month from the next bill (${tools(live)} live; it was ${usd(p.from_usd)}).`, detail: { from_usd: p.from_usd, to_usd: p.to_usd, tools: live } }).catch(() => {});
  if (!done.cancel_at) await require("./notices").add(slug, "repriced", notice(p, next), { from_usd: p.from_usd, to_usd: p.to_usd, tools: live }).catch((e) => console.error("[modprice] notice:", e.message));
  const co = (await q("SELECT name FROM platform.companies WHERE slug=$1", [slug])).rows[0] || { name: slug };
  require("./notify").notify(p.to_usd > p.from_usd ? "A site's bill went up" : "A site's bill went down", `${co.name}: ${tools(live)} live, so ${usd(p.to_usd)} a month from the next bill (it was ${usd(p.from_usd)}).`, { tags: [p.to_usd > p.from_usd ? "chart_with_upwards_trend" : "chart_with_downwards_trend"], ref: slug });
  return { moved: true, from_usd: p.from_usd, to_usd: p.to_usd, tools: live };
}
// A live version changed for this company: look again shortly (the change's own transaction is done by then). Never throws.
function changed(slug) {
  if (!slug) return;
  const t = setTimeout(() => { sync(slug).catch((e) => console.error(`[modprice] ${slug}:`, e.message)); }, Number(process.env.SOS_REPRICE_DELAY_MS || 1500));
  if (t.unref) t.unref();
}
async function sweep() {
  const rows = (await q("SELECT company, band, cancel_at FROM platform.sites WHERE stage='subscribed'")).rows;
  const out = { moved: 0, told: 0 };
  for (const r of rows) {
    if (require("./pilot").isPilot(r.band)) { await pilotKeep(r.company).catch((e) => console.error(`[modprice] ${r.company}: pilot:`, e.message)); if (await pilotHeadsUp(r)) out.told++; continue; }
    const s = await sync(r.company, { check: true }).catch((e) => ({ error: e.message }));
    if (s && s.moved) out.moved++;
    if (s && s.corrected) out.corrected = (out.corrected || 0) + 1;
  }
  return out;
}
// A pilot's end date, kept: every pass anetix.ai is asked to make sure the subscription carries it (it works the date out
// from the subscription's own start; "the same" costs nothing), and the site keeps the exact date it answers. A pilot
// still subscribed an hour past its end date is ended now. So a cleared end date is put back within 15 minutes whatever
// happened to the event that announced it, and no pilot runs into another month.
async function pilotKeep(slug) {
  const site = await sites.siteRow(slug);
  const B = require("./billing"), end = B.pilotEnd(site);
  if (!site || site.stage !== "subscribed" || !end || !site.stripe_subscription || site.ending) return { skipped: true };
  if (end.getTime() < Date.now() - 3600e3) {
    const co = (await q("SELECT name FROM platform.companies WHERE slug=$1", [slug])).rows[0] || { name: slug };
    await B.endNow(site.id, { why: "the pilot reached its end date", by: "the pilot's end date" });
    require("./notify").notify("A pilot was ended past its date", `${co.name}: the pilot was still running after its end date, so it was cancelled now and the site is a demo again. Check Stripe for a charge after ${dayOf(end)} and refund it.`, { priority: 5, tags: ["rotating_light"], ref: slug });
    return { ended: true };
  }
  if (site.cancel_at && !B.isPlannedEnd(site, site.cancel_at)) return { skipped: true };   // the customer cancelled early: that date stands
  let ans;
  try { ans = await require("./activate").www("/internal/pilot-end", { subscription: site.stripe_subscription, site: site.id }, { timeoutMs: 30000 }); }
  catch (e) {
    if (e.www && e.www.past) return { skipped: true };
    require("./notify").notify("A pilot's end date could not be checked", `${slug}: anetix.ai could not confirm the pilot's cancel date at Stripe (${String(e.message).slice(0, 120)}). It is tried again in 15 minutes.`, { priority: 4, tags: ["warning"], ref: slug });
    throw e;
  }
  const at = ans.subscription && ans.subscription.cancel_at ? new Date(Number(ans.subscription.cancel_at) * 1000) : null;
  if (at && (at.getTime() !== end.getTime() || !site.cancel_at || new Date(site.cancel_at).getTime() !== at.getTime())) {
    await q("UPDATE platform.sites SET cancel_at=$2, band = jsonb_set(band, '{pilot,ends_at}', to_jsonb($3::text)), updated_at=now() WHERE id=$1 AND stage='subscribed' AND stripe_subscription=$4", [site.id, at, at.toISOString(), site.stripe_subscription]);
  }
  if (!ans.same) await logEvent("pilot_end_kept", slug, { ends_at: at ? at.toISOString() : null, by: "sweep" });
  return { same: Boolean(ans.same), ends_at: at };
}
// A week before a pilot ends, once: what comes next is agreed before the site goes back to a demo and the floor's sign-in closes.
async function pilotHeadsUp(r) {
  const end = r.cancel_at || (r.band.pilot && r.band.pilot.ends_at);
  if (!end) return false;
  const left = new Date(end).getTime() - Date.now();
  if (left <= 0 || left > 7 * 86400e3) return false;
  if ((await q("SELECT 1 FROM platform.events WHERE kind='pilot_ending_told' AND ref=$1 AND detail->>'ends_at'=$2 LIMIT 1", [r.company, new Date(end).toISOString()])).rows[0]) return false;
  await logEvent("pilot_ending_told", r.company, { ends_at: new Date(end).toISOString() });
  const co = (await q("SELECT name FROM platform.companies WHERE slug=$1", [r.company])).rows[0] || { name: r.company };
  require("./notify").notify("A pilot ends in a week", `${co.name}: the pilot ends on ${dayOf(end)}. Stripe stops charging on its own, the site goes back to a demo and the floor's sign-in closes that day. Agree what comes next before then (a new offer on the Sites tab, or Go live).`, { priority: 4, tags: ["hourglass_flowing_sand"], ref: r.company });
  return true;
}
// What Settings says about a paying site's price (the page writes no price of its own). -> a sentence or two
async function summaryFor(site) {
  if (!site || site.stage !== "subscribed") return null;
  const P = require("./pilot");
  if (P.isPilot(site.band)) {
    const end = site.cancel_at || site.band.pilot.ends_at;
    const more = end && site.period_end && new Date(site.period_end).getTime() < new Date(end).getTime() - 86400e3;
    return `A pilot: ${sites.pilotLine({ monthly_usd: site.band.monthly_usd, months: site.band.pilot.months })}.${more ? ` The next payment, ${usd(site.band.monthly_usd)}, is on ${dayOf(site.period_end)}.` : ""}${end ? ` It ends on its own on ${dayOf(end)}, and nothing is charged after that unless you and Anetix agree new terms.` : ""}`;
  }
  if (!follows(site)) return null;
  const live = await sites.liveTools(site.company), f = sites.feeFor(site.band, live);
  return `${usd(f.usd)} a month: ${usd(f.per_tool_usd)} for each tool live on your floor (${tools(f.tools)} now${f.tools < f.billed_tools ? `, and a site pays for ${tools(f.billed_tools)} at least` : ""}), never more than ${usd(f.cap_usd)}. A tool you make live counts from your next bill. Both prices are locked while the subscription runs.`;
}
function init() {
  setTimeout(() => sweep().catch((e) => console.error("[modprice] sweep:", e.message)), 30000).unref();
  setInterval(() => sweep().catch((e) => console.error("[modprice] sweep:", e.message)), 15 * 60e3).unref();
}

module.exports = { init, follows, plan, notice, sync, changed, sweep, pilotHeadsUp, pilotKeep, summaryFor };
