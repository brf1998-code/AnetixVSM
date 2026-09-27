// End to end for what a company's people read at an AI cap (the launch audit 0.5, src/agent.js CAP_WORDS): no dollars,
// no variable names, what still works and who to write to; the figures go to the log and one alert a month per cap.
// Against a server ALREADY UP in fake-agent mode on a fresh database, started with SOS_MONTHLY_CAP_USD=5 (run-all.sh):
//   node scripts/e2e/caps.js
const { runner, login, PW } = require("./lib");
const { q } = require("../../src/db");
const R = runner(), t = R.t;
const clean = (w) => !/\$|SOS_|USD/.test(w) && /brendan@anetix\.ai or taylor@anetix\.ai/.test(w) && /Everything you built stays/.test(w);

(async () => {
  const admin = await login(PW.admin);
  const mgr = await login(PW.manager, "demo");
  // ---- the company's own budget: a cent, and a dollar already spent this month
  await q("UPDATE platform.companies SET monthly_cap_usd=0.01, auto_propose=false WHERE slug='demo'");
  await q("INSERT INTO platform.ai_usage (company, kind, cost_usd) VALUES ('demo', 'chat', 1)");
  const fb = (await mgr.post("/api/feedback", { company: "demo", module: "paperline", message: "The station 2 timer should reset between shifts", page: "/c/demo/m/paperline/" })).json;
  const own = await mgr.post(`/api/feedback/${fb.id}/review`, {});
  t("the company's own budget: refused with 429 and plain words", own.status === 429 && /AI budget for the month is used up/.test(own.json.error), own);
  t("no dollars, no variable, what still works, who to write to", clean(own.json.error), own.json.error);
  // ---- the instance cap: every company's spend together past $5; the company's own budget taken off first
  await q("UPDATE platform.companies SET monthly_cap_usd=NULL WHERE slug='demo'");
  await q("INSERT INTO platform.ai_usage (company, kind, cost_usd) VALUES ('demo', 'chat', 10)");
  const all = await mgr.post(`/api/feedback/${fb.id}/review`, {});
  t("the instance cap: refused with 429, and it says demos", all.status === 429 && /monthly AI cap for demos on Anetix is reached/.test(all.json.error), all);
  t("no dollars, no SOS_MONTHLY_CAP_USD, what still works, who to write to", clean(all.json.error), all.json.error);
  const again = await mgr.post(`/api/feedback/${fb.id}/review`, {});
  t("a second refusal says the same", again.status === 429);
  // ---- the alert: once a month per cap, with the figures
  const alerts = (await q("SELECT detail FROM platform.events WHERE kind='notified' AND detail->>'title'='AI cap reached' ORDER BY id")).rows.map((r) => r.detail.message);
  t("one alert per cap, the figures in it for Anetix", alerts.length === 2 && alerts.some((m) => /demo's own budget is reached for this month \(\$1\.00 of \$0\.01\)/.test(m)) && alerts.some((m) => /the instance cap \(SOS_MONTHLY_CAP_USD\) is reached for this month \(\$11\.00 of \$5\.00\)/.test(m)), alerts);
  t("the admin sees the request is still there, untouched", (await admin.get("/api/c/demo/board")).json.feedback.some((f) => f.id === fb.id && f.status === "new"));
  R.done();
})().catch(R.abort);
