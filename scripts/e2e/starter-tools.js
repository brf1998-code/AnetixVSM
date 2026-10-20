// End to end: a pin carries the tools its company starts with (src/selfserve.js, src/library.js addStarters). Against a
// server ALREADY UP in fake-agent mode on a fresh database with SOS_WWW_KEY set in both shells (run-all.sh):
//   node scripts/e2e/starter-tools.js
const { runner, login } = require("./lib");
const R = runner(), t = R.t;
const BASE = process.env.SOS_BASE || `http://127.0.0.1:${process.env.PORT || 3999}`;
const KEY = process.env.SOS_WWW_KEY;
if (!KEY) { console.error("SOS_WWW_KEY must be set in this shell and the server's"); process.exit(2); }
const www = async (p, b) => (await fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json", "X-SOS-WWW-Key": KEY }, body: JSON.stringify(b) })).json();

(async () => {
  const admin = await login(process.env.SOS_ADMIN_PASSWORD || "adminpw");
  const tpl = (await admin.post("/api/admin/library/templates", { from_company: "demo", module: "kpis", title: "Plant numbers" })).json;
  t("a template to start from", tpl.ok && tpl.id, tpl);
  const bad = await admin.post("/api/admin/pins", { label: "X at Y", email: "x@y.test", tools: [{ repo: "no-such-tool" }] });
  t("a tool that is not in the library is refused", bad.status === 400 && /no library tool/.test(bad.json.error), bad.json);
  const made = (await admin.post("/api/admin/pins", { label: "Mark at Habco Test", email: "mark@habco.test", max_uses: 1, days: 30, tools: [{ repo: "shop-schedule" }, { template: tpl.id }, { repo: "shop-schedule" }] })).json;
  t("the pin keeps its tools, once each", made.ok && JSON.stringify(made.pin.tools) === JSON.stringify([{ repo: "shop-schedule" }, { template: tpl.id }]), made.pin && made.pin.tools);
  t("the message says the board opens with them", /Open "Shop Schedule" and "Plant numbers" on your board/.test(made.message) && !/Press "Sample data"/.test(made.message), made.message);
  const plain = (await admin.post("/api/admin/pins", { label: "Ann at Plain Co", email: "ann@plain.test" })).json;
  t("a pin with no tools has the old message", plain.ok && plain.pin.tools == null && /Press "\+ New tool" and describe/.test(plain.message));
  // change a pin's tools before it is used
  const ch = await admin.post(`/api/admin/pins/${plain.pin.id}/tools`, { tools: [{ repo: "shop-schedule" }] });
  t("an unused pin's tools can change", ch.json.ok && ch.json.titles[0] === "Shop Schedule", ch.json);

  // the company is made the way anetix.ai makes it
  const co = await www("/api/www/companies", { pin: made.pin.shown, email: "mark@habco.test", name: "Habco Test", contact: "Mark", ref: `starter:${made.pin.shown}`, paid_usd: 0, credit_usd: 10, password: "copper-oak-2201-press", demo: true, collect: true });
  const slug = co.company && co.company.slug;
  t("the company is made", co.created === true && slug, co);
  const ov = (await admin.get("/api/admin/overview")).json.companies.find((c) => c.slug === slug);
  t("it starts with both tools live", ov && ov.modules.length === 2 && ov.modules.every((m) => m.live_version === 1) && ov.modules.some((m) => m.name === "shop-schedule"), ov && ov.modules);
  const b = await admin.get(`/c/${slug}/m/shop-schedule/api/board`);
  t("the schedule opens with the example shop in it", b.status === 200 && b.json.example === true && b.json.jobs.length === 16, b.status);
  const page = await admin.get(`/c/${slug}/m/shop-schedule/`);
  t("its board page answers", page.status === 200 && /Shop Schedule/.test(page.text));
  t("the pin's tools cannot change once it is used", (await admin.post(`/api/admin/pins/${made.pin.id}/tools`, { tools: [] })).status === 409);
  const again = await www("/api/www/companies", { pin: made.pin.shown, email: "mark@habco.test", name: "Habco Test", contact: "Mark", ref: `starter:${made.pin.shown}`, paid_usd: 0, credit_usd: 10, password: "copper-oak-2201-press", demo: true });
  t("the same setup landing twice makes nothing twice", again.created === false && (await admin.get("/api/admin/overview")).json.companies.find((c) => c.slug === slug).modules.length === 2);

  const co2 = await www("/api/www/companies", { pin: plain.pin.shown, email: "ann@plain.test", name: "Plain Co", contact: "Ann", ref: `starter:${plain.pin.shown}`, paid_usd: 0, credit_usd: 10, password: "copper-oak-2201-press", demo: true });
  const ov2 = (await admin.get("/api/admin/overview")).json.companies.find((c) => c.slug === co2.company.slug);
  t("the changed pin's company starts with what it was changed to", ov2.modules.map((m) => m.name).join() === "shop-schedule", ov2.modules);
  R.done();
})().catch(R.abort);
