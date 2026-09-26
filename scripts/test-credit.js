// Unit cases for src/credit.js, the pure part: the glide slope (balance, burn,
// projected runout) and telling the AI service failing from a build failing.
// No database: node scripts/test-credit.js
const c = require("../src/credit");
let pass = 0, fail = 0;
function t(name, cond, detail) { if (cond) { pass++; } else { fail++; console.log(`FAIL  ${name}${detail !== undefined ? "\n      " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : ""}`); } }
const NOW = new Date("2026-09-20T20:00:00Z");
const day = (n) => new Date(NOW.getTime() - n * 86400000).toISOString().slice(0, 10);
const week = (usd) => [6, 5, 4, 3, 2, 1, 0].map((n) => ({ day: day(n), usd }));

const p = c.project({ anchor: { balance_usd: 100, noted_at: "2026-09-18T00:00:00Z" }, spentSince: 30, daily: week(10), now: NOW });
t("balance is what was entered minus what the platform spent since", p.balance_usd === 70 && p.spent_since === 30);
t("burn is the trailing seven day average", p.burn_per_day === 10 && p.burn_days === 7);
t("runout is balance over burn from now", p.days_left === 7 && p.runout.slice(0, 10) === "2026-09-27", p);
t("the line says all of it in one sentence, with 'about'", /^About \$70\.00 left, burning \$10\.00 a day \(7 day average\): runs out around Sep 27, 7 days from now\.$/.test(p.line), p.line);
t("seven days or more is fine", p.level === "ok");
t("under seven days is amber", c.project({ anchor: { balance_usd: 60, noted_at: NOW }, spentSince: 0, daily: week(10), now: NOW }).level === "amber");
t("under three days is red", c.project({ anchor: { balance_usd: 25, noted_at: NOW }, spentSince: 0, daily: week(10), now: NOW }).level === "red");
const gone = c.project({ anchor: { balance_usd: 20, noted_at: "2026-09-18T00:00:00Z" }, spentSince: 21.95, daily: week(10), now: NOW });
t("used up is red and says so plainly, with no runout date", gone.level === "red" && gone.balance_usd === -1.95 && gone.runout === null && /used up/.test(gone.line), gone);
t("with autofill a low balance is not an alarm, and the line says what the date means", (() => { const x = c.project({ anchor: { balance_usd: 25, noted_at: NOW, autofill: true }, spentSince: 0, daily: week(10), now: NOW }); return x.level === "ok" && /if autofill did not exist/.test(x.line); })());
t("nothing spent lately: no date is invented", (() => { const x = c.project({ anchor: { balance_usd: 50, noted_at: NOW }, spentSince: 0, daily: [], now: NOW }); return x.runout === null && x.days_left === null && x.level === "ok" && /no runout date/.test(x.line); })());
t("a young instance divides by the days it has, not by seven", (() => { const x = c.project({ anchor: { balance_usd: 50, noted_at: NOW }, spentSince: 0, daily: [{ day: day(1), usd: 8 }, { day: day(0), usd: 12 }], now: NOW }); return x.burn_days === 2 && x.burn_per_day === 10; })());
t("spend older than the window does not count toward the burn", c.project({ anchor: { balance_usd: 50, noted_at: NOW }, spentSince: 0, daily: [{ day: day(20), usd: 500 }, ...week(1)], now: NOW }).burn_per_day === 1);
t("no balance entered: unknown, and it says so", (() => { const x = c.project({ anchor: null, daily: week(10), now: NOW }); return x.known === false && x.level === "unknown" && /No balance has been entered/.test(x.line) && x.burn_per_day === 10; })());
t("an outage nothing has cleared is red whatever the numbers say", c.project({ anchor: { balance_usd: 500, noted_at: "2026-09-01T00:00:00Z" }, spentSince: 0, daily: week(1), now: NOW, outage: { at: "2026-09-20T19:50:00Z", kind: "credit", cleared: false } }).level === "red");
t("a cleared outage is remembered but not an alarm", (() => { const x = c.project({ anchor: { balance_usd: 500, noted_at: NOW }, spentSince: 0, daily: week(1), now: NOW, outage: { at: "2026-09-20T19:50:00Z", kind: "credit", cleared: true } }); return x.level === "ok" && x.outage === null && x.last_outage.kind === "credit"; })());

// the service failing, or the work failing
t("the live failure of 2026-09-20 is credit", c.classify("build agent failed: the model's API answered with an error: Credit balance is too low (after 170 messages; model claude-fable-5-1)") === "credit");
t("billing words are credit", c.classify("Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.") === "credit");
t("a bad key is key", c.classify("authentication_error: invalid x-api-key") === "key");
t("overloaded and rate limits are busy", c.classify("overloaded_error: Overloaded") === "busy" && c.classify("429 rate_limit_error") === "busy");
t("an ordinary build failure is none of these", c.classify("build agent failed: the agent process died right after starting") === null && c.classify("cross-check failed: the requirement is not met") === null && c.classify("internal tests failed: /api/state answered 404") === null);
t("what a manager reads never carries the raw message, a dash, or blame", ["credit", "key", "busy"].every((k) => { const s = c.plain(k); return /Nothing is wrong with your request/.test(s) && !/credit|balance|key|API/i.test(s) && ![8211, 8212].some((d) => s.includes(String.fromCharCode(d))); }));

// the slope as drawn: the entered balance, down by each day's spend, to what is left now, then to zero on the runout day
{
  const now = new Date("2026-09-20T12:00:00Z");
  const anchor = { balance_usd: 100, noted_at: "2026-09-17T09:00:00Z", autofill: false };
  const daily = [{ day: "2026-09-15", usd: 9 }, { day: "2026-09-17", usd: 14 }, { day: "2026-09-18", usd: 10 }, { day: "2026-09-19", usd: 6 }, { day: "2026-09-20", usd: 4 }];
  // since the anchor: 4 of the 17th's 14 came after 09:00, then 10, 6, 4 = 24
  const p = c.project({ anchor, spentSince: 24, daily, now });
  const a = p.slope.actual;
  t("the slope starts at the entered balance at the time it was entered", a[0].usd === 100 && a[0].t === "2026-09-17T09:00:00.000Z");
  t("the anchor's own day only counts what was spent after the balance was entered", a[1].usd === 96);
  t("then each whole day, then what is left right now", a.map((x) => x.usd).join(",") === "100,96,86,80,76" && a[a.length - 1].t === now.toISOString());
  t("it never rises", a.every((x, i) => i === 0 || x.usd <= a[i - 1].usd));
  t("the dashed part runs from now to zero on the runout day", p.slope.projected.length === 2 && p.slope.projected[0].usd === 76 && p.slope.projected[1].usd === 0 && p.slope.projected[1].t === p.runout);
  const flat = c.project({ anchor, spentSince: 0, daily: [], now });
  t("nothing spent: a flat line and nothing projected", flat.slope.actual[flat.slope.actual.length - 1].usd === 100 && flat.slope.projected.length === 0);
  const sameDay = c.project({ anchor: { ...anchor, noted_at: "2026-09-20T08:00:00Z" }, spentSince: 3, daily: [{ day: "2026-09-20", usd: 5 }], now });
  t("a balance entered today is two points: then and now", sameDay.slope.actual.length === 2 && sameDay.slope.actual[1].usd === 97);
  t("no balance entered, no slope", c.project({ anchor: null, daily, now }).slope === undefined);
}

// the meter (2026-09-26): what the API sent back against what the features filed
{
  const w = c.withMeter({ spentSince: 80.67, daily: [{ day: "2026-09-25", usd: 30 }, { day: "2026-09-26", usd: 5 }], meterStart: "2026-09-26T16:00:00Z", meteredSince: 9, recordedSince: 5, meteredDaily: [{ day: "2026-09-26", usd: 9 }] });
  t("what the meter saw beyond the features is added to the spend", Math.abs(w.spentSince - 84.67) < 1e-9 && w.unrecorded === 4, w);
  t("from the meter's first day a day counts the larger of the two; days before stay as filed", w.daily.find((d) => d.day === "2026-09-26").usd === 9 && w.daily.find((d) => d.day === "2026-09-25").usd === 30, w.daily);
  const same = c.withMeter({ spentSince: 10, daily: [], meterStart: "2026-09-26T16:00:00Z", meteredSince: 3, recordedSince: 4, meteredDaily: [] });
  t("a feature that filed more than the meter saw (a price table differs) never lowers the spend", same.spentSince === 10 && same.unrecorded === 0, same);
  t("no meter yet: nothing changes", c.withMeter({ spentSince: 7, daily: [{ day: "x", usd: 1 }], meterStart: null }).spentSince === 7);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
