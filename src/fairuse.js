// The fair-use line for a subscribed site (stage 3, 2026-09-26; docs/PAID-SITES.md "The fair-use line, exactly"; the
// Terms, 5.6): if Anetix's own AI cost for a site in a billing month passes 80% of that month's fee, new AI work pauses
// until the next billing month. Work already running finishes, and the site's tools never notice.
//
//   the window   the subscription's current period (anetix.ai forwards it at every Stripe event; Activate seeds it).
//                If the stored period has ended and no event has come, the window rolls forward a month at a time
//                from the anchor instead of counting a stale month.
//   what counts  day by day, the larger of the meter (platform.ai_calls: every answer the API sent, when it arrived)
//                and what the features filed (build runs, proposals, reviews, the brand guide, chats, diagrams), for
//                this company. A build's row is dated when it starts while its cost keeps growing, so the meter is
//                what books a build that crosses a renewal to the right month.
//   the line     fair_use_share (0.8) of the site's monthly price, before tax and before any credit on the bill
//   the gate     selfserve.assertCredit, the one gate every AI start passes (opts.started lets a run already going
//                finish, one run per tool at most)
//   the alert    at alert_share (0.5) of the fee: the Sites tab's pill and the site's row. The customer never sees a meter.
//   a lift       Brendan can lift the line for the rest of the period from the site's card, with a note (a big first
//                month of new tools, say). The lift ends with the period.
const { q, logEvent } = require("./db");

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const fail = (status, msg, extra) => Object.assign(new Error(msg), { status }, extra || {});

// A month on from a date, the way a monthly subscription's anchor day works: the same day of the month, or the last
// day of a shorter month. Pure.
function addMonths(d, n) {
  const t = new Date(d); const day = t.getUTCDate();
  const out = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + n, 1, t.getUTCHours(), t.getUTCMinutes(), t.getUTCSeconds()));
  const last = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(day, last));
  return out;
}
// The billing period `now` falls in: the stored one while it lasts, else rolled forward from its start a month at a
// time (never backward). null without a stored period. Pure.
function windowOf({ period_start, period_end }, now = new Date()) {
  if (!period_start) return null;
  const t = new Date(now).getTime();
  let from = new Date(period_start), to = period_end ? new Date(period_end) : addMonths(from, 1);
  if (t < to.getTime()) return { from, to, rolled: false };
  let k = 0;
  const anchor = new Date(period_start);
  while (t >= to.getTime() && k < 1200) { k++; from = addMonths(anchor, k); to = addMonths(anchor, k + 1); }
  return { from, to, rolled: true };
}

// What the platform spent for one company in [from, to): each day the larger of the meter and the feature rows.
async function spendIn(company, from, to) {
  const r = (await q(`
    WITH feat AS (
      SELECT date_trunc('day', at) AS d, SUM(usd) AS usd FROM (
        SELECT created_at AS at, cost_usd AS usd FROM platform.build_runs WHERE company=$1 AND created_at >= $2 AND created_at < $3
        UNION ALL SELECT p.created_at, p.cost_usd FROM platform.proposals p JOIN platform.feedback f ON f.id=p.feedback_id WHERE f.company=$1 AND p.created_at >= $2 AND p.created_at < $3
        UNION ALL SELECT created_at, cost_usd FROM platform.reviews WHERE company=$1 AND created_at >= $2 AND created_at < $3
        UNION ALL SELECT (brand->>'built_at')::timestamptz, (brand->>'cost_usd')::numeric FROM platform.companies
                   WHERE slug=$1 AND brand IS NOT NULL AND brand->>'built_at' IS NOT NULL AND (brand->>'built_at')::timestamptz >= $2 AND (brand->>'built_at')::timestamptz < $3
        UNION ALL SELECT created_at, cost_usd FROM platform.ai_usage WHERE company=$1 AND created_at >= $2 AND created_at < $3 AND kind IS DISTINCT FROM 'assess'
        UNION ALL SELECT created_at, cost_usd FROM platform.diagrams WHERE company=$1 AND created_at >= $2 AND created_at < $3
      ) x GROUP BY 1),
    meter AS (SELECT date_trunc('day', at) AS d, SUM(cost_usd) AS usd FROM platform.ai_calls WHERE company=$1 AND at >= $2 AND at < $3 AND kind NOT LIKE 'assess:%' GROUP BY 1)
    SELECT COALESCE(SUM(GREATEST(COALESCE(f.usd, 0), COALESCE(m.usd, 0))), 0) AS usd FROM feat f FULL OUTER JOIN meter m ON m.d = f.d`,
  [company, from, to])).rows[0];
  return Number(r.usd || 0);
}

// Where a subscribed site stands this period, or null for a site that is not subscribed.
async function stateOf(slug, now = new Date()) {
  const s = (await q("SELECT * FROM platform.sites WHERE company=$1", [slug])).rows[0];
  if (!s || s.stage !== "subscribed") return null;
  const w = windowOf(s, now);
  if (!w) return null;
  const book = await require("./sites").bookFor(s.price_book);
  const fee = Number(s.price_usd || 0);
  const lift = s.fair_use_lift && s.fair_use_lift.until && new Date(s.fair_use_lift.until) > new Date(now) ? s.fair_use_lift : null;
  const spend = await spendIn(slug, w.from, w.to);
  const f = require("./sites").fairUse({ spend_usd: spend, fee_usd: fee, share: book.fair_use_share, alert_share: book.alert_share, lifted: Boolean(lift) });
  return { ...f, from: w.from.toISOString(), to: w.to.toISOString(), rolled: w.rolled, lift };
}
const dayOf = (t) => new Date(t).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
// The words a manager reads at the line (docs/PAID-SITES.md "Copy"), and the gate that throws them.
function message(st) { return `New AI work here is paused until ${dayOf(st.to)}. This month passed the fair-use line in your agreement, which normal use does not reach, and Anetix has been told. Your tools keep working.`; }
async function assertUnder(slug) {
  const st = await stateOf(slug);
  if (!st || !st.over) return;
  // Anetix is told once a period: the event is what the Sites tab's pill and the record show
  const told = (await q("SELECT 1 FROM platform.events WHERE kind='fair_use_reached' AND ref=$1 AND detail->>'from'=$2 LIMIT 1", [slug, st.from])).rows[0];
  if (!told) await logEvent("fair_use_reached", slug, { from: st.from, to: st.to, spend_usd: st.spend_usd, line_usd: st.line_usd });
  throw fail(429, message(st), { code: "fair_use" });
}
// Brendan lifts the line for the rest of this period, with a note. It ends with the period.
async function lift(slug, { note } = {}, by) {
  const st = await stateOf(slug);
  if (!st) throw fail(409, "only a subscribed site has a fair-use line");
  const words = String(note == null ? "" : note).replace(/\s+/g, " ").trim().slice(0, 300);
  if (words.length < 3) throw fail(400, "say why, in a few words: it goes on the site's record");
  const l = { until: st.to, by: by || "admin", note: words, at: new Date().toISOString() };
  await q("UPDATE platform.sites SET fair_use_lift=$2, updated_at=now(), updated_by=$3 WHERE company=$1", [slug, JSON.stringify(l), by || "admin"]);
  await logEvent("fair_use_lifted", slug, l);
  return stateOf(slug);
}

module.exports = { addMonths, windowOf, spendIn, stateOf, message, assertUnder, lift };
