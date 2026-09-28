// End to end for the launch audit's Phase 2 on the server (2026-09-28): one spend formula (2.2), a demo's sign-in is
// not a red flag (2.1), one pin message both ways (2.8), who is stuck and what happened lately on the Demos tab (2.9),
// and two companies' tools never on the same tables (2.14). Against a server ALREADY UP in fake-agent mode on a FRESH
// database (run-all.sh does it).
//   node scripts/e2e/phase2.js
const { PW, runner, login, waitFor } = require("./lib");
const { q } = require("../../src/db");
const selfserve = require("../../src/selfserve");
const R = runner(), t = R.t;
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

(async () => {
  const admin = await login(PW.admin, ""), mgr = await login(PW.manager, "demo");

  // ---- 2.2: one formula. Spend of every kind this month on the demo company: a build, a proposal, new-tool design,
  // sample data, a diagram, and a model trial (Anetix's own: in the instance's total, not the company's)
  await q("INSERT INTO platform.ai_usage (company, kind, model, cost_usd) VALUES ('demo','design','claude-opus-5-5',1.25), ('demo','sample_data','claude-sonnet-5',0.40), ('demo','assess','claude-opus-5-5',2.00)");
  await q("INSERT INTO platform.diagrams (company, module, version, model, status, cost_usd) VALUES ('demo','paperline',1,'claude-opus-5-5','done',0.75)");
  const ov = (await admin.get("/api/admin/overview")).json;
  const demo = ov.companies.find((c) => c.slug === "demo");
  const month = (await q(`SELECT (SELECT COALESCE(SUM(cost_usd),0) FROM platform.build_runs WHERE company='demo' AND created_at >= date_trunc('month', now()))
      + (SELECT COALESCE(SUM(p.cost_usd),0) FROM platform.proposals p JOIN platform.feedback f ON f.id=p.feedback_id WHERE f.company='demo' AND p.created_at >= date_trunc('month', now()))
      + (SELECT COALESCE(SUM(cost_usd),0) FROM platform.reviews WHERE company='demo' AND created_at >= date_trunc('month', now()))
      + (SELECT COALESCE(SUM(cost_usd),0) FROM platform.ai_usage WHERE company='demo' AND kind <> 'assess' AND created_at >= date_trunc('month', now()))
      + (SELECT COALESCE(SUM(cost_usd),0) FROM platform.diagrams WHERE company='demo' AND created_at >= date_trunc('month', now())) AS usd`)).rows[0].usd;
  t("the company list and card count new-tool design, sample data and diagrams (they used to leave them out)", near(demo.spend_usd, month) && demo.spend_usd >= 2.4, [demo.spend_usd, Number(month)]);
  const health = (await admin.get("/api/admin/health?days=30")).json;
  const hd = health.companies.find((c) => c.slug === "demo" || c.name === demo.name);
  t("loop health's month for the company is the same figure", hd && near(hd.spend.month_usd, demo.spend_usd), hd && hd.spend);
  t("the instance's total carries the trial too", ov.totalSpend >= demo.spend_usd + 2 - 0.005, [ov.totalSpend, demo.spend_usd]);
  t("and the company's own budget still leaves the trial out", near((await require("../../src/agent").monthlySpend("demo")).usd, demo.spend_usd));

  // ---- 2.8: one pin message, whichever way the pin is made
  const hand = (await admin.post("/api/admin/pins", { label: "Sam at Acme Wire", email: "sam@acme.test", max_uses: 1, days: 30 })).json;
  const m = hand.message || "";
  t("a pin made by hand comes with a message to send", hand.ok && /^Hi Sam,/.test(m) && m.includes(hand.pin.shown) && m.includes("sam@acme.test") && /30 days/.test(m), m.slice(0, 200));
  t("which says what to have ready, how to sign in later and where to get help", /Face ID or a fingerprint/.test(m) && /authenticator app/.test(m) && /To come back later/.test(m) && /brendan@anetix\.ai or taylor@anetix\.ai/.test(m));
  t("no dashes in it (it goes out)", !/[–—]/.test(m) && !/ - /.test(m));
  const dr = await q("INSERT INTO platform.demo_requests (name, email, company, wants) VALUES ('Pat Doe','pat@zeta.test','Zeta Tools','pin') RETURNING id");
  const drPin = (await admin.post(`/api/admin/demo-requests/${dr.rows[0].id}/pin`, { days: 30 })).json;
  t("a demo request's pin comes with the same message", drPin.message && drPin.message.replace(/Pat|pat@zeta\.test|[A-Z0-9]{4}-[A-Z0-9]{4}/g, "") === m.replace(/Sam|sam@acme\.test|[A-Z0-9]{4}-[A-Z0-9]{4}/g, ""), drPin.message);

  // ---- 2.1 and 2.9: a demo from a pin, then the ways a demo gets stuck
  const pin = await selfserve.makePinRow({ label: "Lee at Stuck Co", email: "lee@stuck.test", max_uses: 1, days: 30 }, "e2e");
  const made = await selfserve.createCompany({ pin: pin.pin, name: "Stuck Co", contact: "Lee", email: "lee@stuck.test", ref: "e2e-phase2-stuck", paid_usd: 0, credit_usd: 10, password: "a-long-enough-password", demo: true });
  const slug = made.slug || (made.company && made.company.slug);
  t("a demo company from a pin", Boolean(slug), made);
  const card = (await admin.get("/api/admin/overview")).json.companies.find((c) => c.slug === slug);
  t("its access row has no passwords and one manager account: the admin page reads that as a demo, not a flag", card && card.demo === true && !card.access.own_floor && !card.access.legacy_login && card.managers.length === 1);
  const oldPin = await selfserve.makePinRow({ label: "Old pin for Kim", email: "kim@old.test", max_uses: 1, days: 30 }, "e2e");
  await q("UPDATE platform.access_pins SET created_at = now() - interval '3 days' WHERE id=$1", [oldPin.id]);
  await q("UPDATE platform.self_serve SET created_at = now() - interval '3 hours' WHERE company=$1", [slug]);
  let demos = (await admin.get("/api/admin/demos")).json;
  const kinds = (s) => (demos.stuck || []).filter((x) => x.slug === s).map((x) => x.kind);
  t("who is stuck: the sign-in not set up after hours", kinds(slug).includes("no_2fa"), demos.stuck);
  t("and a pin not used in three days", (demos.stuck || []).some((x) => x.kind === "pin" && x.pin_id === oldPin.id && /Old pin for Kim/.test(x.text)), demos.stuck);
  await q("UPDATE platform.accounts SET locked_until = now() + interval '10 minutes' WHERE company=$1", [slug]);
  await q("INSERT INTO platform.ai_usage (company, kind, model, cost_usd) VALUES ($1,'design','claude-opus-5-5',11)", [slug]);
  demos = (await admin.get("/api/admin/demos")).json;
  t("a locked account and no credit left come first", kinds(slug)[0] === "locked" && kinds(slug).includes("out"), kinds(slug));
  const row = demos.demos.find((d) => d.slug === slug);
  t("the row says it is out and not yet seen", row && row.money.balance_usd <= 0 && row.seen === false && row.manager.locked === true);
  await admin.post(`/api/admin/companies/${slug}/credit/seen`, {});
  demos = (await admin.get("/api/admin/demos")).json;
  t("Seen, clear it keeps it on the list, marked seen", (demos.stuck || []).some((x) => x.slug === slug && x.kind === "out" && x.seen === true) && demos.demos.find((d) => d.slug === slug).seen === true);
  const kindsNow = (demos.activity || []).map((a) => a.kind);
  t("recent activity: the demo coming in and the demo request", kindsNow.includes("demo") && kindsNow.includes("demo_request") && demos.activity.some((a) => a.kind === "demo" && a.company === slug), kindsNow);
  await q("UPDATE platform.accounts SET locked_until = NULL WHERE company=$1", [slug]);

  // ---- 2.14: two companies' tools never on the same tables
  for (const [s, n] of [["zz", "Zed"], ["zz-north", "Zed North"]]) await admin.post("/api/admin/companies", { slug: s, name: n });
  const it1 = (await admin.post("/api/c/zz/intakes", {})).json;
  await admin.post(`/api/intakes/${it1.id}/answer`, { id: "name", value: "North Paperline" });
  t("a new tool named at one company", (await q("SELECT slug FROM platform.module_intakes WHERE id=$1", [it1.id])).rows[0].slug === "north-paperline");
  const add = await admin.post("/api/admin/companies/zz-north/modules", { module: "paperline" });
  t("the library tool whose tables would be the same (zz + north-paperline, zz-north + paperline) is refused, saying with what", add.status === 409 && /zz's north-paperline/.test(add.json.error || ""), add.json);
  t("and nothing was made", !(await q("SELECT 1 FROM platform.modules WHERE company='zz-north' AND name='paperline'")).rows.length);
  const it2 = (await admin.post("/api/c/zz-north/intakes", {})).json;
  const ans = await admin.post(`/api/intakes/${it2.id}/answer`, { id: "name", value: "Paperline" });
  const slug2 = (await q("SELECT slug, name FROM platform.module_intakes WHERE id=$1", [it2.id])).rows[0];
  t("a new tool with that name elsewhere keeps its name and takes the next free address", ans.status === 200 && slug2.name === "Paperline" && slug2.slug === "paperline-2", slug2);
  t("the library tool goes on a company whose tables are free", (await admin.post("/api/admin/companies/zz/modules", { module: "kpis" })).status === 200);

  R.done();
})().catch(R.abort);
