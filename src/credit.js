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
async function init() { await q(SCHEMA); await require("./agent").initMeter(); }

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
// credit (billing), key (the key or its workspace refused), model (a model id the API does not know), busy (overloaded,
// rate limited, an internal error or the API not reachable, after the SDK's own retries), api (any other error the API
// itself answered with). null = not one of these: a build that failed on its own merits.
//
// 2026-10-08: a new key that was not scoped to a workspace came back as a 400 invalid_request_error ("This API key is not
// scoped to a workspace..."). None of the three patterns of the time matched it, so it was logged and nothing reached the
// phones. Since then anything in the API's own error shape is at least "api", and every kind alerts (src/notify.js).
function classify(message) {
  const m = String(message || "");
  if (/credit balance|billing|payment|insufficient (funds|credit|quota)|purchase credits/i.test(m)) return "credit";
  if (/invalid x-api-key|authentication_error|permission_error|invalid api key|api key.*(invalid|revoked|disabled)|not scoped to a workspace|anthropic-workspace-id|organization (has been |is )?disabled|\b401\b.*anthropic/i.test(m)) return "key";
  if (/not_found_error/.test(m) && /model/i.test(m)) return "model";
  if (/overloaded|rate.?limit|\b529\b|\b429\b|service unavailable|\b503\b|\bapi_error\b|anthropic_connection_error/i.test(m)) return "busy";
  if (apiError(m) || /model's API answered with an error/i.test(m)) return "api";
  return null;
}
// The API's own error, when the message carries its body ({"type":"error","error":{"type","message"}}) or names one of its
// error types. -> { type, message } or null. Pure.
const API_TYPES = /\b(invalid_request_error|authentication_error|permission_error|not_found_error|request_too_large|rate_limit_error|api_error|overloaded_error|billing_error)\b/;
function apiError(message) {
  const m = String(message || ""), j = m.indexOf("{");
  if (j >= 0) { try { const o = JSON.parse(m.slice(j)); if (o && o.type === "error" && o.error && o.error.type) return { type: String(o.error.type), message: String(o.error.message || "") }; } catch { /* not the API's body */ } }
  const t = m.match(API_TYPES);
  return t ? { type: t[1], message: "" } : null;
}
// The alert for a kind, or null for none. Pure: noteFailure sends it. What goes out: the kind, where it happened (a feature,
// a request number, a company's slug) and Anthropic's own error text, never anything from a company's data.
function alertFor(kind, where, message) {
  if (!kind) return null;
  const at = where || "a call";
  const api = apiError(message), said = api && api.message ? ` Anthropic said: "${api.message.replace(/\s+/g, " ").slice(0, 200)}"` : "";
  const stopped = " Nothing new is proposed or built until it answers again; the Instance tab of /admin shows it.";
  if (kind === "busy") return { key: "ai_busy", gapMs: 60 * 60e3, event: false, title: "The AI service is overloaded", message: `A call during ${at} gave up after the SDK's retries (overloaded, rate limited or not reachable).${said} One is a blip; if more follow, check status.anthropic.com.`, priority: 3, tags: ["hourglass"] };
  if (kind === "api") return { key: "ai_unavailable:api", gapMs: 30 * 60e3, event: true, title: "An AI call failed", message: `The API answered with an error during ${at}.${said} The Instance tab of /admin shows it.`, priority: 4, tags: ["warning"] };
  const why = kind === "credit" ? "out of credit" : kind === "key" ? "the key was refused" : kind === "model" ? "a model was not found" : kind;
  return { key: `ai_unavailable:${kind}`, gapMs: 30 * 60e3, event: true, title: "The AI service is refusing work", message: `It refused a call (${why}) during ${at}.${said}${stopped}`, priority: 5, tags: ["rotating_light"] };
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
  UNION ALL SELECT created_at, cost_usd FROM platform.ai_usage WHERE ${where}
  UNION ALL SELECT created_at, cost_usd FROM platform.diagrams WHERE ${where}`;   // 2026-09-26: the diagrams drawn after every deploy were missing here ($19.85 in six days), and the key ran out while this said about $14 was left
// Pure: the meter (platform.ai_calls, every answer the API sent) against what the features filed. From the day the meter
// started, a day counts the larger of the two, and whatever the meter saw beyond the features since the anchor is added
// to the spend. -> { spentSince, daily, unrecorded }
function withMeter({ spentSince, daily, meterStart, meteredSince = 0, recordedSince = 0, meteredDaily = [] }) {
  if (!meterStart) return { spentSince, daily, unrecorded: 0 };
  const unrecorded = Math.max(0, Number(meteredSince) - Number(recordedSince));
  const startDay = new Date(meterStart).toISOString().slice(0, 10);
  const byDay = new Map((daily || []).map((d) => [d.day, Number(d.usd || 0)]));
  for (const m of meteredDaily) if (m.day >= startDay) byDay.set(m.day, Math.max(byDay.get(m.day) || 0, Number(m.usd || 0)));
  return { spentSince: Number(spentSince) + unrecorded, daily: [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([day, usd]) => ({ day, usd })), unrecorded: round2(unrecorded) };
}
async function status(now = new Date()) {
  const anchor = (await q("SELECT balance_usd, autofill, note, noted_by, noted_at FROM platform.ai_credit ORDER BY id DESC LIMIT 1")).rows[0] || null;
  const recordedAll = anchor ? Number((await q(`SELECT COALESCE(SUM(usd),0) AS usd FROM (${SPEND("created_at >= $1")}) s`, [anchor.noted_at])).rows[0].usd) : 0;
  const recordedDaily = (await q(`SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, SUM(usd)::float AS usd FROM (${SPEND("created_at >= $1")}) s GROUP BY 1 ORDER BY 1`, [new Date(now.getTime() - 30 * DAY)])).rows;
  // the meter's view, from the later of the anchor and the meter's first call
  const meterStart = (await q("SELECT min(at) AS at FROM platform.ai_calls").catch(() => ({ rows: [{}] }))).rows[0].at || null;
  let m = { spentSince: recordedAll, daily: recordedDaily, unrecorded: 0 };
  if (meterStart) {
    const from = anchor && new Date(anchor.noted_at) > new Date(meterStart) ? anchor.noted_at : meterStart;
    const meteredSince = anchor ? Number((await q("SELECT COALESCE(SUM(cost_usd),0) AS usd FROM platform.ai_calls WHERE at >= $1", [from])).rows[0].usd) : 0;
    const recordedSince = anchor ? Number((await q(`SELECT COALESCE(SUM(usd),0) AS usd FROM (${SPEND("created_at >= $1")}) s`, [from])).rows[0].usd) : 0;
    const meteredDaily = (await q("SELECT to_char(date_trunc('day', at), 'YYYY-MM-DD') AS day, SUM(cost_usd)::float AS usd FROM platform.ai_calls WHERE at >= $1 GROUP BY 1 ORDER BY 1", [new Date(now.getTime() - 30 * DAY)])).rows;
    m = withMeter({ spentSince: recordedAll, daily: recordedDaily, meterStart, meteredSince, recordedSince, meteredDaily });
  }
  const spentSince = m.spentSince, daily = m.daily;
  // the last time the service itself failed, and whether any AI call has worked since
  const ev = (await q("SELECT detail, created_at FROM platform.events WHERE kind='ai_unavailable' ORDER BY id DESC LIMIT 1")).rows[0];
  let outage = null;
  if (ev) {
    const later = (await q(`SELECT 1 FROM (${SPEND("created_at > $1")}) s WHERE usd > 0 LIMIT 1`, [ev.created_at])).rows.length > 0;
    outage = { at: ev.created_at, kind: (ev.detail || {}).kind || "credit", where: (ev.detail || {}).where || null, cleared: later || (anchor && new Date(anchor.noted_at) > new Date(ev.created_at)) };
  }
  const out = project({ anchor, spentSince, daily, now, outage });
  out.unrecorded_usd = m.unrecorded;
  out.metered_since = meterStart;
  if (m.unrecorded >= 0.5) out.line += ` That includes $${m.unrecorded.toFixed(2)} the meter saw that no feature filed as its own spend.`;
  return out;
}
async function setBalance({ balance_usd, autofill, note, by }) {
  const n = Number(balance_usd);
  if (!Number.isFinite(n) || n < 0 || n > 1000000) throw Object.assign(new Error("the balance is a number of dollars, zero or more"), { status: 400 });
  await q("INSERT INTO platform.ai_credit (balance_usd, autofill, note, noted_by) VALUES ($1,$2,$3,$4)", [n.toFixed(2), Boolean(autofill), String(note || "").slice(0, 300) || null, by || null]);
  await logEvent("ai_credit_noted", null, { balance_usd: n, autofill: Boolean(autofill) });
  return status();
}
// Called wherever an AI call fails (each caller, and since 2026-10-08 the shared calls in src/agent.js, so the same failure
// usually arrives twice: the second within a few seconds is dropped). Leaves a mark the admin page reads and alerts the
// phones. Never throws.
let lastNoted = { message: null, at: 0 };
async function noteFailure(message, where) {
  const kind = classify(message);
  const a = alertFor(kind, where, message);
  if (!a) return kind;
  const msg = String(message || "");
  if (lastNoted.message === msg && Date.now() - lastNoted.at < 10e3) return kind;
  lastNoted = { message: msg, at: Date.now() };
  if (a.event) { try { await logEvent("ai_unavailable", null, { kind, where: where || null, message: msg.slice(0, 300) }); } catch (e) { /* best effort */ } }
  console.error(`[credit] the AI service failed a call (${kind}) during ${where || "a call"}: ${msg.slice(0, 160)}`);
  require("./notify").notifyEvery(a.key, a.gapMs, a.title, a.message, { priority: a.priority, tags: a.tags });
  return kind;
}

module.exports = { init, SCHEMA, project, slopeOf, classify, apiError, alertFor, plain, status, setBalance, noteFailure, withMeter };
