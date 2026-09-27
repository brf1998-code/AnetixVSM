// End to end for the spend watch (src/spendwatch.js, the launch audit 0.5: phone alerts when AI spend climbs fast, never
// a limit). Against a server ALREADY UP in fake-agent mode on a fresh database, started with SOS_ALERT_MONTH_STEP_USD=25
// (run-all.sh does it). The fake agent never writes the meter, so the test writes platform.ai_calls itself.
//   node scripts/e2e/spendwatch.js
const { runner, login, PW, waitFor } = require("./lib");
const { q } = require("../../src/db");
const R = runner(), t = R.t;
const call = (company, usd, ago) => q(`INSERT INTO platform.ai_calls (company, kind, model, cost_usd, at) VALUES ($1, 'structured:e2e', 'claude-opus-5-5', $2, now() - $3::interval)`, [company, usd, ago]);

(async () => {
  const admin = await login(PW.admin);
  const mgr = await login(PW.manager, "demo");
  t("a manager cannot run the check", (await mgr.post("/api/admin/notify/spend-check", {})).status === 403);
  t("nothing spent, nothing sent", (await admin.post("/api/admin/notify/spend-check", {})).json.sent.length === 0);
  // a quiet week: $2 a day for the seven days before the last 24 hours
  for (let d = 2; d <= 8; d++) await call("demo", 2, `${d - 0.5} days`);
  const quiet = (await admin.post("/api/admin/notify/spend-check", {})).json.sent;
  t("a quiet week sends nothing but the month step it crossed ($14 is under $25)", quiet.length === 0, quiet);
  // then a fast hour: demo $9 and acme $7 in the last hour, acme $10 more five hours ago
  await call("demo", 9, "30 minutes"); await call("acme", 7, "20 minutes"); await call("acme", 10, "5 hours");
  const sent = (await admin.post("/api/admin/notify/spend-check", {})).json.sent;
  const k = sent.map((x) => x.key).sort();
  t("a fast hour: the hour, demo past the company line, the pace against the quiet week, the $25 month step", ["company_hour:demo", "hour", "month:" + new Date().toISOString().slice(0, 7) + ":25", "pace"].every((x) => k.includes(x)) && !k.includes("company_hour:acme") && !k.includes("day"), k);
  t("the hour alert has the figures and who spent most", /\$16\.00 in the last hour \(alert at \$15\.00\)\. Most of it: demo \$9\.00/.test((sent.find((x) => x.key === "hour") || {}).message || ""), sent);
  t("the pace alert compares with the week before", /\$26\.00 in the last 24 hours against an average day of \$2\.\d\d the week before/.test((sent.find((x) => x.key === "pace") || {}).message || ""), sent);
  // notify files its own event behind the answer: give the last one a moment
  const pushed = await waitFor("the alerts on the event log", async () => { const p = (await q("SELECT detail->>'title' AS title FROM platform.events WHERE kind='notified' ORDER BY id")).rows.map((r) => r.title); return sent.every((x) => p.includes(x.title)) ? p : null; }, 5000).catch(() => null);
  t("each went to the phones through notify", Boolean(pushed), sent.map((x) => x.title));
  t("checked again at once: nothing new (each rule keeps quiet for its window)", (await admin.post("/api/admin/notify/spend-check", {})).json.sent.length === 0);
  // a restart must not send them again: the keys are events, not memory
  t("what was sent is on the event log, one line a rule", (await q("SELECT count(*)::int AS n FROM platform.events WHERE kind='spend_alert'")).rows[0].n === sent.length);
  const v = (await admin.get("/api/admin/notify")).json.spend;
  t("the admin card reads the rules, the spend now and the last alert", v && v.settings.hour_usd === 15 && v.settings.month_step_usd === 25 && Math.abs(v.now.hour_usd - 16) < 0.01 && v.recent.length === sent.length, v);
  t("nothing was refused: the demo's manager can still ask for a proposal", (await mgr.post("/api/feedback", { company: "demo", module: "paperline", message: "Station 3 needs a bigger timer", page: "/c/demo/m/paperline/" })).status === 200);
  R.done();
})().catch(R.abort);
