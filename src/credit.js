// The AI credit glide slope, and telling "the AI service is not available"
// from "the build is wrong".
//
// Why (2026-09-20). Run 38 on the live instance died after 170 messages with
// "Credit balance is too low": the Anthropic key had a fixed amount on it and
// ran out. Nothing on /admin had warned of it, and the manager's card showed
// the raw API message as if their build were at fault. Brendan: "there should
// be a glide slope so admin will have a projected runout date, but when we are
// live I will have an autofill set up".
//
// The platform cannot read the balance (Anthropic does not hand it to an API
// key), so the admin tells it: "the balance is $X as of now". From there the
// platform subtracts what IT has spent since (the same five sources
// monthlySpend adds up: build runs, proposals, system reviews, brand guides,
// ai_usage), takes the burn from the trailing 7 days, and projects the day the
// balance reaches zero. It is the platform's own count: anything else spending
// on the same key is invisible here, so the line says "about", and a fresh
// balance from the console re-anchors it any time.
//
// project() is pure and unit tested (scripts/test-credit.js).
const { q, logEvent } = require("./db");

const DAY = 86400000;
const SCHEMA = `
CREATE TABLE IF NOT EXISTS platform.ai_credit (
  id          SERIAL PRIMARY KEY,
  balance_usd NUMERIC(12,2) NOT NULL,
  autofill    BOOLEAN NOT NULL DEFAULT false,
  note        TEXT,
  noted_by    TEXT,
  noted_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);`;
async function init() { await q(SCHEMA); }

// ---- pure ------------------------------------------------------------------------------------------
// anchor: { balance_usd, noted_at, autofill } or null; spentSince: platform spend since the anchor;
// daily: [{ day: "YYYY-MM-DD", usd }] for the trailing days (missing days = 0); outage: { at, kind, cleared } or null.
function project({ anchor, spentSince = 0, daily = [], now = new Date(), outage = null, windowDays = 7 }) {
  const t = now instanceof Date ? now : new Date(now);
  const days = Math.max(1, Math.min(windowDays, 30));
  const from = t.getTime() - days * DAY;
  const inWin = daily.filter((d) => new Date(d.day + "T12:00:00Z").getTime() >= from - DAY / 2);
  const windowUsd = inWin.reduce((s, d) => s + Number(d.usd || 0), 0);
  // a young instance (or a young anchor) has fewer days of history than the window: divide by the days it has
  const first = daily.length ? Math.min(...daily.map((d) => new Date(d.day + "T00:00:00Z").getTime())) : t.getTime();
  const span = Math.max(1, Math.min(days, Math.ceil((t.getTime() - first) / DAY) || 1));
  const burn = windowUsd / span;
  const out = { known: Boolean(anchor), burn_per_day: round2(burn), burn_days: span, window_usd: round2(windowUsd), outage: outage && !outage.cleared ? outage : null, last_outage: outage || null };
  if (!anchor) return { ...out, level: out.outage ? "red" : "unknown", line: "No balance has been entered yet, so there is nothing to project." };
  const balance = Number(anchor.balance_usd) - Number(spentSince || 0);
  out.anchor = { balance_usd: round2(Number(anchor.balance_usd)), noted_at: anchor.noted_at, autofill: Boolean(anchor.autofill) };
  out.spent_since = round2(Number(spentSince || 0));
  out.balance_usd = round2(balance);
  out.days_left = burn > 0 ? Math.max(0, Math.floor((balance / burn) * 10) / 10) : null;
  out.runout = burn > 0 && balance > 0 ? new Date(t.getTime() + (balance / burn) * DAY).toISOString() : null;
  out.slope = slopeOf({ anchor, spentSince: Number(spentSince || 0), daily, now: t, balance, runout: out.runout });
  out.level = out.outage || balance <= 0 ? "red" : anchor.autofill ? "ok" : out.days_left != null && out.days_left < 3 ? "red" : out.days_left != null && out.days_left < 7 ? "amber" : "ok";
  const when = out.runout ? new Date(out.runout).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : null;
  out.line = balance <= 0 ? "By the platform's own count the balance is used up."
    : burn <= 0 ? `About $${balance.toFixed(2)} left. Nothing has been spent in the last ${span} day${span === 1 ? "" : "s"}, so there is no runout date to project.`
    : `About $${balance.toFixed(2)} left, burning $${burn.toFixed(2)} a day (${span} day average): runs out around ${when}, ${out.days_left} day${out.days_left === 1 ? "" : "s"} from now${anchor.autofill ? ", if autofill did not exist" : ""}.`;
  return out;
}
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
// The glide slope as points to draw: the balance the admin entered, down by each day's spend to what is left now
// (solid), then on down the burn rate to zero on the runout day (dashed). Times are ISO strings. Pure.
function slopeOf({ anchor, spentSince, daily, now, balance, runout }) {
  const start = new Date(anchor.noted_at), day = (d) => new Date(d).toISOString().slice(0, 10);
  const later = (daily || []).filter((d) => d.day > day(start) && d.day <= day(now)).sort((a, b) => (a.day < b.day ? -1 : 1));
  const firstDay = Math.max(0, spentSince - later.reduce((s, d) => s + Number(d.usd || 0), 0));   // what was spent on the anchor's own day, after the anchor
  const actual = [{ t: start.toISOString(), usd: round2(Number(anchor.balance_usd)) }];
  let left = Number(anchor.balance_usd);
  const endOf = (d) => new Date(d + "T23:59:59Z");
  if (day(start) < day(now)) { left -= firstDay; actual.push({ t: endOf(day(start)).toISOString(), usd: round2(left) }); }
  for (const d of later) { if (d.day >= day(now)) break; left -= Number(d.usd || 0); actual.push({ t: endOf(d.day).toISOString(), usd: round2(left) }); }
  actual.push({ t: now.toISOString(), usd: round2(balance) });
  return { actual, projected: runout ? [{ t: now.toISOString(), usd: round2(balance) }, { t: runout, usd: 0 }] : [] };
}

// What kind of failure an error from the AI service is, when it is the SERVICE and not the work:
// credit (billing), key (authentication), busy (overloaded or rate limited). null = not one of these.
function classify(message) {
  const m = String(message || "");
  if (/credit balance|billing|payment|insufficient (funds|credit|quota)|purchase credits/i.test(m)) return "credit";
  if (/invalid x-api-key|authentication_error|invalid api key|api key.*(invalid|revoked|disabled)|\b401\b.*anthropic/i.test(m)) return "key";
  if (/overloaded|rate.?limit|\b529\b|\b429\b|service unavailable|\b503\b/i.test(m)) return "busy";
  return null;
}
// What a manager reads instead of the raw message.
function plain(kind) {
  return kind === "busy"
    ? "The AI service was too busy to finish this. Nothing is wrong with your request and nothing reached the floor. Try again in a few minutes."
    : "The AI service was not available, so this stopped partway. Nothing is wrong with your request and nothing reached the floor. This is on Anetix's side to fix, not yours; try again later.";
}

// ---- database ---------------------------------------------------------------------------------------
const SPEND = (where) => `
  SELECT created_at, cost_usd AS usd FROM platform.build_runs WHERE ${where}
  UNION ALL SELECT p.created_at, p.cost_usd FROM platform.proposals p WHERE ${where.replace(/created_at/g, "p.created_at")}
  UNION ALL SELECT created_at, cost_usd FROM platform.reviews WHERE ${where}
  UNION ALL SELECT (brand->>'built_at')::timestamptz, (brand->>'cost_usd')::numeric FROM platform.companies WHERE brand IS NOT NULL AND brand->>'built_at' IS NOT NULL AND ${where.replace(/created_at/g, "(brand->>'built_at')::timestamptz")}
  UNION ALL SELECT created_at, cost_usd FROM platform.ai_usage WHERE ${where}`;
async function status(now = new Date()) {
  const anchor = (await q("SELECT balance_usd, autofill, note, noted_by, noted_at FROM platform.ai_credit ORDER BY id DESC LIMIT 1")).rows[0] || null;
  const spentSince = anchor ? Number((await q(`SELECT COALESCE(SUM(usd),0) AS usd FROM (${SPEND("created_at >= $1")}) s`, [anchor.noted_at])).rows[0].usd) : 0;
  const daily = (await q(`SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, SUM(usd)::float AS usd FROM (${SPEND("created_at >= $1")}) s GROUP BY 1 ORDER BY 1`, [new Date(now.getTime() - 30 * DAY)])).rows;
  // the last time the service itself failed, and whether any AI call has worked since
  const ev = (await q("SELECT detail, created_at FROM platform.events WHERE kind='ai_unavailable' ORDER BY id DESC LIMIT 1")).rows[0];
  let outage = null;
  if (ev) {
    const later = (await q(`SELECT 1 FROM (${SPEND("created_at > $1")}) s WHERE usd > 0 LIMIT 1`, [ev.created_at])).rows.length > 0;
    outage = { at: ev.created_at, kind: (ev.detail || {}).kind || "credit", where: (ev.detail || {}).where || null, cleared: later || (anchor && new Date(anchor.noted_at) > new Date(ev.created_at)) };
  }
  return project({ anchor, spentSince, daily, now, outage });
}
async function setBalance({ balance_usd, autofill, note, by }) {
  const n = Number(balance_usd);
  if (!Number.isFinite(n) || n < 0 || n > 1000000) throw Object.assign(new Error("the balance is a number of dollars, zero or more"), { status: 400 });
  await q("INSERT INTO platform.ai_credit (balance_usd, autofill, note, noted_by) VALUES ($1,$2,$3,$4)", [n.toFixed(2), Boolean(autofill), String(note || "").slice(0, 300) || null, by || null]);
  await logEvent("ai_credit_noted", null, { balance_usd: n, autofill: Boolean(autofill) });
  return status();
}
// Called wherever an AI call fails: if it is the service, leave a mark the admin page reads. Never throws.
async function noteFailure(message, where) {
  const kind = classify(message);
  if (!kind || kind === "busy") return kind;
  try { await logEvent("ai_unavailable", null, { kind, where: where || null, message: String(message || "").slice(0, 300) }); } catch (e) { /* best effort */ }
  console.error(`[credit] the AI service refused a call (${kind}) during ${where || "a call"}: ${String(message || "").slice(0, 160)}`);
  return kind;
}

module.exports = { init, SCHEMA, project, slopeOf, classify, plain, status, setBalance, noteFailure };
