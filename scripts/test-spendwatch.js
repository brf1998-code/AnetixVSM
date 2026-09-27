// src/spendwatch.js evaluate(): which spend alerts a snapshot sends (the launch audit 0.5: alerts, never a limit).
//   node scripts/test-spendwatch.js
const W = require("../src/spendwatch");
let pass = 0, fail = 0;
const t = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log(`FAIL  ${name}${detail !== undefined ? "\n      " + JSON.stringify(detail).slice(0, 500) : ""}`); } };
const S = { hour_usd: 15, company_hour_usd: 8, day_usd: 60, pace_x: 3, pace_min_usd: 15, month_step_usd: 250 };
const base = { hour_usd: 2, day_usd: 12, month_usd: 120, month: "2026-09", prior_days: 7, prior_usd: 70, companies: [{ company: "acme", usd: 1.5 }] };
const keys = (a) => a.map((x) => x.key).sort();

t("an ordinary day sends nothing", W.evaluate(base, S).length === 0);
const fast = W.evaluate({ ...base, hour_usd: 23.4, day_usd: 25, companies: [{ company: "acme-north", usd: 18.1 }, { company: "demo", usd: 5.3 }] }, S);
t("a fast hour: the hour alert and the one company past its line", JSON.stringify(keys(fast)) === JSON.stringify(["company_hour:acme-north", "hour"]), keys(fast));
t("the hour alert names the figure, the line and who spent most", /\$23\.40 in the last hour \(alert at \$15\.00\)\. Most of it: acme-north \$18\.10/.test(fast.find((x) => x.key === "hour").message));
t("the company alert says where to look", /acme-north spent \$18\.10 in the last hour/.test(fast.find((x) => x.rule === "company_hour").message) && /board/.test(fast.find((x) => x.rule === "company_hour").message));
t("spend with no company is named as the platform's own", W.evaluate({ ...base, companies: [{ company: null, usd: 9 }] }, S)[0].key === "company_hour:platform");
t("a big day", keys(W.evaluate({ ...base, day_usd: 61 }, S)).includes("day"));
const pace = W.evaluate({ ...base, day_usd: 35 }, S);
t("35 dollars against a 10 dollar day is the pace alert, with the times in the title", pace.length === 1 && pace[0].key === "pace" && /3\.5 times the usual day/.test(pace[0].title), pace);
t("the pace needs the day to reach its floor", W.evaluate({ ...base, day_usd: 14, prior_usd: 7 }, S).length === 0);
t("and two days of history", W.evaluate({ ...base, day_usd: 40, prior_days: 1.5, prior_usd: 3 }, S).every((x) => x.rule !== "pace"));
const month = W.evaluate({ ...base, month_usd: 512.4 }, S);
t("the month passes a step: one alert for the step it is past, keyed by month and step", month.length === 1 && month[0].key === "month:2026-09:500" && month[0].title === "AI spend passed $500 this month" && month[0].priority === 3, month);
t("a step already sent is not sent again, the next one is", W.evaluate({ ...base, month_usd: 512.4 }, S, new Set(["month:2026-09:500"])).length === 0 && W.evaluate({ ...base, month_usd: 760 }, S, new Set(["month:2026-09:500"]))[0].key === "month:2026-09:750");
t("a key inside its quiet window is held", W.evaluate({ ...base, hour_usd: 30 }, S, new Set(["hour"])).length === 0);
t("a rule set to 0 is off", W.evaluate({ ...base, hour_usd: 30, day_usd: 90, month_usd: 900, companies: [{ company: "x", usd: 30 }] }, { hour_usd: 0, company_hour_usd: 0, day_usd: 0, pace_x: 0, pace_min_usd: 15, month_step_usd: 0 }).length === 0);
t("no dashes in anything sent", fast.concat(pace, month).every((x) => !/[–—]/.test(x.title + x.message)));
process.env.SOS_ALERT_HOUR_USD = "0"; process.env.SOS_ALERT_DAY_USD = "abc";
t("the variables: 0 turns a rule off, junk keeps the default", W.settings().hour_usd === 0 && W.settings().day_usd === 60);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
