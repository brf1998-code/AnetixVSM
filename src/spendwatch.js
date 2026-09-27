// Phone alerts when AI spend climbs fast (Brendan, 2026-09-27, the launch audit 0.5): no hard limit, "if we expand
// quickly we could fall behind and then have everyone fail ... I just want notifications if we are rapidly blowing past
// limits." Nothing here refuses any work: SOS_MONTHLY_CAP_USD stays unset and these are alerts only.
//
// What is watched: platform.ai_calls, the meter (every answer the AI service sent, written the moment it arrived: src/
// agent.js meter), so a runaway shows within minutes whatever feature spent it. Checked every CHECK_MS and at boot.
//
// The rules, each set in Railway (0 = off):
//   SOS_ALERT_HOUR_USD           15   more than this in the last hour, every company together
//   SOS_ALERT_COMPANY_HOUR_USD    8   one company more than this in the last hour (a loop, a build going round)
//   SOS_ALERT_DAY_USD            60   more than this in the last 24 hours
//   SOS_ALERT_PACE_X              3   the last 24 hours at this many times the average day of the week before, once
//                                     the last 24 hours are at least SOS_ALERT_PACE_MIN_USD (15), so a quiet week
//                                     does not make an ordinary day look fast; needs two days of meter history
//   SOS_ALERT_MONTH_STEP_USD    250   each time this month's total passes another step ($250, $500, $750 ...)
// An hour rule sends once per 3 hours (per company for the company rule), the day and pace rules once per 24 hours,
// a month step once. What was sent is an event (kind spend_alert, ref = the rule's key), so a restart (and a push
// restarts the product) never sends it twice. The message carries dollars and company codes: it goes to Anetix's own
// phones only (src/notify.js), never to a customer.
//
// Routes (admin): GET /api/admin/notify carries spend (src/notify.js asks view()); POST /api/admin/notify/spend-check
// runs the check now and answers what it sent.
const { q, logEvent } = require("./db");

const CHECK_MS = Number(process.env.SOS_SPEND_CHECK_MS || 10 * 60 * 1000);
const num = (name, dflt) => { const v = process.env[name]; if (v == null || String(v).trim() === "") return dflt; const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : dflt; };
function settings() {
  return {
    hour_usd: num("SOS_ALERT_HOUR_USD", 15),
    company_hour_usd: num("SOS_ALERT_COMPANY_HOUR_USD", 8),
    day_usd: num("SOS_ALERT_DAY_USD", 60),
    pace_x: num("SOS_ALERT_PACE_X", 3),
    pace_min_usd: num("SOS_ALERT_PACE_MIN_USD", 15),
    month_step_usd: num("SOS_ALERT_MONTH_STEP_USD", 250),
  };
}
// how long a rule stays quiet after it sent, in hours
const QUIET = { hour: 3, company_hour: 3, day: 24, pace: 24, month: 24 * 40 };
const usd = (x) => `$${Number(x || 0).toFixed(2)}`;

// What to send for a snapshot, as [{ key, rule, title, message, priority }]. Pure: the tests hand it numbers.
//   snap = { hour_usd, day_usd, month_usd, month, prior_days, prior_usd, companies: [{ company, usd }] (last hour, biggest first) }
//   sent = the keys already sent inside their quiet windows
function evaluate(snap, s = settings(), sent = new Set()) {
  const out = [];
  const add = (key, rule, title, message, priority = 4) => { if (!sent.has(key)) out.push({ key, rule, title, message, priority }); };
  const avg = snap.prior_days >= 2 ? snap.prior_usd / snap.prior_days : null;
  const context = `Last 24 hours ${usd(snap.day_usd)}; this month ${usd(snap.month_usd)}.`;
  const top = (snap.companies || [])[0];
  if (s.hour_usd > 0 && snap.hour_usd > s.hour_usd) {
    add("hour", "hour", "AI spend: a fast hour", `${usd(snap.hour_usd)} in the last hour (alert at ${usd(s.hour_usd)}).${top ? ` Most of it: ${top.company || "the platform itself"} ${usd(top.usd)}.` : ""} ${context}`);
  }
  if (s.company_hour_usd > 0) {
    for (const c of snap.companies || []) {
      if (c.usd > s.company_hour_usd) add(`company_hour:${c.company || "platform"}`, "company_hour", `AI spend: ${c.company || "the platform"} in one hour`, `${c.company || "The platform's own work (no company)"} spent ${usd(c.usd)} in the last hour (alert at ${usd(s.company_hour_usd)}). Worth a look at its board for a build going round or a loop.`);
    }
  }
  if (s.day_usd > 0 && snap.day_usd > s.day_usd) {
    add("day", "day", "AI spend: a big day", `${usd(snap.day_usd)} in the last 24 hours (alert at ${usd(s.day_usd)}).${avg != null ? ` The average day the week before was ${usd(avg)}.` : ""} This month ${usd(snap.month_usd)}.`);
  }
  if (s.pace_x > 0 && avg != null && avg > 0 && snap.day_usd >= s.pace_min_usd && snap.day_usd > s.pace_x * avg) {
    add("pace", "pace", `AI spend: ${(snap.day_usd / avg).toFixed(1)} times the usual day`, `${usd(snap.day_usd)} in the last 24 hours against an average day of ${usd(avg)} the week before (alert at ${s.pace_x} times). This month ${usd(snap.month_usd)}.`);
  }
  if (s.month_step_usd > 0 && snap.month_usd >= s.month_step_usd) {
    const step = Math.floor(snap.month_usd / s.month_step_usd) * s.month_step_usd;
    const perDay = snap.prior_days >= 1 ? ` Burning about ${usd((snap.prior_usd + snap.day_usd) / (snap.prior_days + 1))} a day lately.` : "";
    add(`month:${snap.month}:${step}`, "month", `AI spend passed ${usd(step).replace(/\.00$/, "")} this month`, `This month's AI spend is ${usd(snap.month_usd)}, past the ${usd(step).replace(/\.00$/, "")} mark.${perDay}`, 3);
  }
  return out;
}

async function snapshot(now = new Date()) {
  const r = (await q(`SELECT
      COALESCE(SUM(cost_usd) FILTER (WHERE at > $1::timestamptz - interval '1 hour'), 0)::float AS hour_usd,
      COALESCE(SUM(cost_usd) FILTER (WHERE at > $1::timestamptz - interval '24 hours'), 0)::float AS day_usd,
      COALESCE(SUM(cost_usd) FILTER (WHERE at <= $1::timestamptz - interval '24 hours' AND at > $1::timestamptz - interval '8 days'), 0)::float AS prior_usd,
      COALESCE(SUM(cost_usd) FILTER (WHERE at >= date_trunc('month', $1::timestamptz)), 0)::float AS month_usd
    FROM platform.ai_calls WHERE at > least($1::timestamptz - interval '8 days', date_trunc('month', $1::timestamptz)) AND at <= $1::timestamptz`, [now])).rows[0];
  // the week before the last 24 hours, counted only from the meter's first row (a young meter has fewer days)
  const first = (await q("SELECT min(at) AS at FROM platform.ai_calls")).rows[0].at;
  const from = Math.max(first ? new Date(first).getTime() : now.getTime(), now.getTime() - 8 * 86400e3);
  const prior_days = Math.max(0, Math.min(7, (now.getTime() - 86400e3 - from) / 86400e3));
  const companies = (await q(`SELECT company, SUM(cost_usd)::float AS usd FROM platform.ai_calls WHERE at > $1::timestamptz - interval '1 hour' AND at <= $1::timestamptz
                               GROUP BY company ORDER BY 2 DESC LIMIT 10`, [now])).rows;
  return { ...r, prior_days: Math.round(prior_days * 100) / 100, companies, month: now.toISOString().slice(0, 7) };
}
// the keys sent inside their quiet windows
async function sentKeys() {
  const rows = (await q("SELECT ref, detail->>'rule' AS rule, created_at FROM platform.events WHERE kind='spend_alert' AND created_at > now() - interval '40 days'")).rows;
  const now = Date.now(), keys = new Set();
  for (const r of rows) if (now - new Date(r.created_at).getTime() < (QUIET[r.rule] || 24) * 3600e3) keys.add(r.ref);
  return keys;
}
let running = false;
async function check() {
  if (running) return [];
  running = true;
  try {
    const snap = await snapshot();
    const due = evaluate(snap, settings(), await sentKeys());
    for (const a of due) {
      await logEvent("spend_alert", a.key, { rule: a.rule, title: a.title, message: a.message });   // first, so a failed send is not retried every ten minutes
      require("./notify").notify(a.title, a.message, { priority: a.priority, tags: ["money_with_wings"] });
      console.warn(`[spend] ${a.title}: ${a.message}`);
    }
    return due;
  } catch (e) { console.error("[spend] the check failed:", e.message); return []; }
  finally { running = false; }
}
let timer = null;
function start() {
  setTimeout(() => check(), 30 * 1000).unref();   // after boot settles
  if (!timer) { timer = setInterval(check, CHECK_MS); timer.unref(); }
}
// what the admin page shows beside the phone alerts
async function view() {
  const s = settings();
  const snap = await snapshot().catch(() => null);
  const recent = (await q("SELECT ref, detail, created_at FROM platform.events WHERE kind='spend_alert' ORDER BY id DESC LIMIT 5").catch(() => ({ rows: [] }))).rows
    .map((r) => ({ key: r.ref, title: r.detail.title, at: r.created_at }));
  return { settings: s, now: snap && { hour_usd: snap.hour_usd, day_usd: snap.day_usd, month_usd: snap.month_usd }, recent };
}

module.exports = { settings, evaluate, snapshot, check, start, view, QUIET };
