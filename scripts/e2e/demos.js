// End to end: the Demos tab's data (src/demos.js), against a server ALREADY UP in fake-agent mode on a FRESH
// database with SOS_WWW_KEY set in both shells (the header of scripts/e2e/selfserve.js has the command).
// What it proves: two demos made the way anetix.ai makes them, one with a tool, a request shipped, a request waiting,
// a request to Anetix and a paid refill, the other with a new-tool request half answered; the list's totals, money,
// counts and loop numbers; the use cases; one company in full (its requests in its own words, the build, the ledger,
// the spend, the record); the export; and that only an admin gets any of it.
const { runner, client, login, ship, sleep } = require("./lib");
const R = runner(), t = R.t;
const BASE = process.env.SOS_BASE || `http://127.0.0.1:${process.env.PORT || 3999}`;
const KEY = process.env.SOS_WWW_KEY;
if (!KEY) { console.error("SOS_WWW_KEY must be set in this shell and the server's"); process.exit(2); }
const www = async (p, b) => (await fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json", "X-SOS-WWW-Key": KEY }, body: JSON.stringify(b) })).json();

(async () => {
  const admin = await login(process.env.SOS_ADMIN_PASSWORD || "adminpw");
  const empty = await admin.get("/api/admin/demos");
  t("with nobody in yet the list is empty", empty.status === 200 && empty.json.demos.length === 0 && empty.json.totals.companies === 0 && empty.json.use_cases.length === 0, empty.json);
  const mk = async (label, email, name) => {
    const pin = (await admin.post("/api/admin/pins", { label, email, max_uses: 1, days: 30 })).json.pin.shown;
    return www("/api/www/companies", { pin, email, name, contact: label.split(" at ")[0], ref: `demo:${pin}`, paid_usd: 0, credit_usd: 10, password: "copper-oak-2201-press", demo: true, collect: true });
  };
  const A = (await mk("Dana at Riverside", "dana@riverside.test", "Riverside Wire")).company.slug;
  const B = (await mk("Omar at Keystone", "omar@keystone.test", "Keystone Fab")).company.slug;
  await admin.post(`/api/admin/companies/${A}/modules`, { module: "paperline" });
  const f1 = await admin.post("/api/feedback", { company: A, module: "paperline", page: "/", message: "Show the station timer bigger so I can see it from the cart", name: "Dana" });
  await ship(admin, [f1.json.id], A);
  await admin.post("/api/feedback", { company: A, module: "paperline", page: "/", message: "Add a count of scrap per shift", name: "Dana" });
  await admin.post("/api/feedback", { company: A, module: "platform", page: "/", message: "The board is hard to read on my phone", name: "Dana" });
  await www("/api/www/credit", { slug: A, ref: "cs_demos_1", paid_usd: 20, credit_usd: 10 });
  const it = (await admin.post(`/api/c/${B}/intakes`, {})).json;
  await admin.post(`/api/intakes/${it.id}/answer`, { id: "name", value: "Weld cell tracker" });
  await admin.post(`/api/intakes/${it.id}/answer`, { id: "purpose", value: "Track which weld jobs are waiting for inspection and who signed them off." });
  await admin.post(`/api/intakes/${it.id}/answer`, { id: "thing", value: "A welded frame" });
  await sleep(1200);

  // ---- the list
  const L = (await admin.get("/api/admin/demos")).json;
  t("both demos listed, newest first", L.demos.length === 2 && L.demos[0].slug === B && L.demos[1].slug === A && L.demos.every((d) => d.demo), L.demos.map((d) => d.slug));
  t("the totals: $20 paid in one refill, $20 of credit given, two tools-or-requests counted", L.totals.companies === 2 && L.totals.demos === 2 && L.totals.paid_usd === 20 && L.totals.purchases === 1 && L.totals.granted_usd === 20 && L.totals.modules_live === 1 && L.totals.requests === 2 && L.totals.builds_deployed === 1 && L.totals.use_cases === 1, L.totals);
  const a = L.demos.find((d) => d.slug === A), b = L.demos.find((d) => d.slug === B);
  t("Riverside's money: paid $20, 200% of credit left, spend and paid-minus-spend", a.money.paid_usd === 20 && a.money.purchases === 1 && a.money.granted_usd === 10 && a.money.bought_credit_usd === 10 && a.money.percent === 200 && a.money.margin_usd === a.money.paid_usd - a.money.spent_usd, a.money);
  t("what it built and did: paperline live, 2 requests (1 shipped), 1 to Anetix, 1 build live", a.modules.length === 1 && a.modules[0].name === "paperline" && a.modules[0].live_version >= 2 && a.counts.requests === 2 && a.counts.requests_shipped === 1 && a.counts.to_anetix === 1 && a.counts.deployed === 1, { m: a.modules, c: a.counts });
  t("the loop's own numbers ride along", a.loop && a.loop.builds_shipped === 1 && a.loop.approved === 1, a.loop);
  t("who: the pin it came in on, the manager account, not enrolled yet", a.pin && a.pin.label === "Dana at Riverside" && /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(a.pin.shown) && a.manager && a.manager.login === "dana@riverside.test" && a.manager.enrolled === false && a.last_activity, { pin: a.pin, manager: a.manager });
  t("Keystone: nothing built, one new-tool request, $10 given, 100%", b.modules.length === 0 && b.counts.intakes === 1 && b.money.paid_usd === 0 && b.money.granted_usd === 10 && b.money.percent === 100, b);
  const uc = L.use_cases[0];
  t("the use case: what they called it, what it is for, what it tracks, not live", uc.company === B && uc.company_name === "Keystone Fab" && uc.name === "Weld cell tracker" && /inspection/.test(uc.purpose) && uc.thing === "A welded frame" && uc.live === false && uc.status === "answering", uc);

  // ---- one company in full
  const D = (await admin.get(`/api/admin/demos/${A}`)).json;
  t("the full view has every section", ["money", "modules", "intakes", "feedback", "runs", "ledger", "spend", "timeline"].every((k) => k in D));
  t("its requests in its own words, with where each is", D.feedback.length === 3 && D.feedback.some((f) => /timer bigger/.test(f.message) && f.status === "done" && f.outcome) && D.feedback.some((f) => /scrap per shift/.test(f.message) && f.proposal && f.proposal_status === "draft") && D.feedback.some((f) => f.module === "platform"), D.feedback.map((f) => [f.message, f.status, f.proposal_status]));
  t("the build, deployed, with what it changed", D.runs.length === 1 && D.runs[0].status === "deployed" && D.runs[0].module === "paperline" && (D.runs[0].title || D.runs[0].what_changed), D.runs);
  t("the ledger: the grant from anetix.ai, then the $20 refill", D.ledger.length === 2 && D.ledger[0].kind === "grant" && D.ledger[0].made_by === "anetix.ai" && D.ledger[1].kind === "purchase" && D.ledger[1].paid_usd === 20 && D.ledger[1].delta_usd === 10, D.ledger);
  t("where the spend went is broken down", Array.isArray(D.spend) && D.spend.some((s) => s.kind === "builds" && s.n === 1), D.spend);
  t("the process, newest first, from the record", D.timeline.length >= 5 && D.timeline.some((r) => r.kind === "feedback_filed") && D.timeline.some((r) => r.kind === "deployed") && new Date(D.timeline[0].created_at) >= new Date(D.timeline[D.timeline.length - 1].created_at), D.timeline.map((r) => r.kind));
  const DB = (await admin.get(`/api/admin/demos/${B}`)).json;
  t("the new-tool request with every answer, question first", DB.intakes.length === 1 && DB.intakes[0].answers.map((x) => x.id).join(",") === "name,purpose,thing" && DB.intakes[0].answers[0].question === "What should we call it?" && DB.intakes[0].answers[0].answer === "Weld cell tracker", DB.intakes[0]);
  t("a company that did not come in from anetix.ai is not a demo here", (await admin.get("/api/admin/demos/demo")).status === 404 && (await admin.get("/api/admin/demos/nobody")).status === 404 && (await admin.get("/api/admin/demos/..%2Fx")).status === 404);

  // ---- the export, and who may see any of it
  const ex = await admin.get("/api/admin/demos/export");
  t("the export is a download of every company in full", ex.status === 200 && /attachment; filename="anetix-demos-\d{4}-\d{2}-\d{2}\.json"/.test(ex.headers.get("content-disposition") || "") && ex.json.format === "anetix-demos-1" && ex.json.companies.length === 2 && ex.json.use_cases.length === 1 && ex.json.companies.every((c) => c.timeline && c.feedback));
  const mgr = client(); await mgr.post("/login", { name: "dana@riverside.test", password: "copper-oak-2201-press" });
  const floor = client(); await floor.post("/login", { password: process.env.SOS_FLOOR_PASSWORD || "floorpw", company: "demo" });
  for (const [who, c, want] of [["nobody signed in", client(), 401], ["a demo's own manager", mgr, 403], ["a floor login", floor, 403]]) {
    t(`${who} gets none of it`, (await c.get("/api/admin/demos")).status === want && (await c.get(`/api/admin/demos/${A}`)).status === want && (await c.get("/api/admin/demos/export")).status === want);
  }
  R.done();
})().catch(R.abort);
