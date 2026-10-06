// End to end: the Sites tab's data (src/sites.js, docs/PAID-SITES.md stage 1), against a server ALREADY UP in
// fake-agent mode on a FRESH database with SOS_WWW_KEY set in both shells (the header of scripts/e2e/selfserve.js
// has the command; run-all.sh runs it).
// What it proves: only an admin gets any of it; the price book is version 1 with Brendan's five bands; two demos made
// the way anetix.ai makes them are rows at the Demo stage with who made them, since when, the tools built and the AI
// spent; the quick quote sizes a site (floor space moving it up one band, the edge flag) and refuses nonsense in
// plain words; saving the pipeline fields gives the site a permanent id and a band, changes only what was sent, and
// refuses a bad field without touching the rest; a company that is not self-serve joins the pipeline once a field is
// saved for it; a subscribed site's facts cannot be edited and the company cannot be deleted until its subscription
// ends; delete takes the site's row; the backup carries both tables.
const { runner, client, login, PW, sleep } = require("./lib");
const { q } = require("../../src/db");
const R = runner(), t = R.t;
const BASE = process.env.SOS_BASE || `http://127.0.0.1:${process.env.PORT || 3999}`;
const KEY = process.env.SOS_WWW_KEY;
if (!KEY) { console.error("SOS_WWW_KEY must be set in this shell and the server's"); process.exit(2); }
const www = async (p, b) => (await fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json", "X-SOS-WWW-Key": KEY }, body: JSON.stringify(b) })).json();

(async () => {
  const admin = await login(PW.admin);

  // ---- the price book, before anyone is in
  const empty = await admin.get("/api/admin/sites");
  const B = empty.json && empty.json.book;
  t("the price book is version 2: $300 a tool, and the five bands' prices are the caps", empty.status === 200 && B.version === 2 && B.per_tool_usd === 300 && B.bands.map((b) => `${b.key}:${b.monthly_usd}`).join(",") === "small:1000,mid:1750,core:2500,large:3500,very_large:5000", B);
  t("each band carries its annual price, fair-use line and floor-space threshold", B.bands[2].annual_usd === 30000 && B.bands[2].fair_use_usd === 2000 && B.bands[1].sqft_min === 75000 && B.bands[0].sqft_min === null && B.fair_use_share === 0.8 && B.sqft_proposed === true);
  t("with nobody in, the pipeline is empty and every stage reads zero", empty.json.rows.length === 0 && Object.values(empty.json.stages).every((n) => n === 0) && empty.json.attention === 0 && empty.json.cancelling === 0, empty.json.stages);
  const stored = (await q("SELECT version, book FROM platform.price_books ORDER BY version")).rows;
  t("both books are in the database, written from the code: version 1 (flat bands) and version 2 (by the tool)", stored.length === 2 && stored[0].version === 1 && stored[0].book.bands.length === 5 && !stored[0].book.per_tool_usd && stored[1].version === 2 && stored[1].book.per_tool_usd === 300);

  // ---- two demos, made the way anetix.ai makes them
  const mk = async (label, email, name) => {
    const pin = (await admin.post("/api/admin/pins", { label, email, max_uses: 1, days: 30 })).json.pin.shown;
    return www("/api/www/companies", { pin, email, name, contact: label.split(" at ")[0], ref: `sites:${pin}`, paid_usd: 0, credit_usd: 10, password: "copper-oak-2201-press", demo: true, collect: true });
  };
  const A = (await mk("Dana at Riverside", "dana@riverside.test", "Riverside Wire")).company.slug;
  await sleep(20);
  const Bs = (await mk("Omar at Keystone", "omar@keystone.test", "Keystone Fab")).company.slug;
  await admin.post(`/api/admin/companies/${A}/modules`, { module: "paperline" });
  const L = (await admin.get("/api/admin/sites")).json;
  const a = L.rows.find((r) => r.slug === A), b = L.rows.find((r) => r.slug === Bs);
  t("both demos are rows at the Demo stage", L.rows.length === 2 && a && b && a.stage === "demo" && b.stage === "demo" && a.stage_label === "Demo" && L.stages.demo === 2, L.rows.map((r) => [r.slug, r.stage]));
  t("who made the demo and since when, from the pin", a.demo_holder === "Dana at Riverside" && a.demo_email === "dana@riverside.test" && a.demo_since && a.demo === true, a);
  t("what it built, and what its AI has spent against its credit", a.tools.some((x) => x.name === "paperline" && x.live_version) && a.tools_live === 1 && a.ai_spent_usd === 0 && a.credit_percent === 100 && b.tools.length === 0, { tools: a.tools, spent: a.ai_spent_usd, pct: a.credit_percent });
  t("no size yet, so no band; no site row yet, so no permanent id", a.headcount === null && a.band === null && a.site_id === null && a.deal && Object.keys(a.deal).length === 0);

  // ---- the quick quote
  const qt = async (body) => admin.post("/api/admin/sites/quote", body);
  const q1 = await qt({ headcount: 40, sqft: "110,000" });
  t("40 people on 110,000 square feet is a Mid site at $1,750, moved up for floor space", q1.status === 200 && q1.json.band.key === "mid" && q1.json.band.monthly_usd === 1750 && q1.json.band.moved_up === true && /moves it up one band/.test(q1.json.band.why), q1.json);
  const q2 = await qt({ headcount: "49" });
  t("49 people is Small, flagged as within five of Mid", q2.json.band.key === "small" && q2.json.band.flags.some((f) => /within five of Mid/.test(f.text)), q2.json);
  t("a Large quote says its price is still proposed", (await qt({ headcount: 250 })).json.band.proposed === true);
  const q3 = await qt({ headcount: "a lot" });
  t("a headcount in words is refused in plain words", q3.status === 400 && /whole number/.test(q3.json.error), q3.json);
  t("no headcount, no quote", (await qt({ sqft: 5000 })).status === 400);

  // ---- saving the pipeline fields
  const s1 = await admin.post(`/api/admin/sites/${A}`, {
    site_name: "Riverside Wire, Leominster", legal_name: "Riverside Wire Co.", site_address: { line1: "9 Mill Drive", city: "Leominster", state: "ma", postal_code: "01453" },
    plant_manager: { name: "Dana Hale", title: "Plant manager", email: "Dana@Riverside.test" }, headcount: "150", sqft: "215,000",
    deal: { integrations: "SAP", hardware: "4 tablets, a label printer", approval_limit_usd: "$25,000", master_agreement: { yes: false } }, note: "Met at the summit.",
  });
  const sa = s1.json.site;
  t("saved: the site has a permanent id and the band follows the size (150 people on 215,000 sq ft is Core, $2,500)", s1.status === 200 && /^[0-9a-f-]{36}$/.test(sa.site_id) && sa.band.key === "core" && sa.band.monthly_usd === 2500 && sa.band.moved_up === false && sa.headcount === 150 && sa.sqft === 215000, sa);
  t("the address is tidied and written as one line", sa.site_address.state === "MA" && sa.site_address.country === "US" && sa.address_line === "9 Mill Drive, Leominster, MA 01453", sa.site_address);
  t("the plant manager, the deal and the note are kept", sa.plant_manager.name === "Dana Hale" && sa.plant_manager.email === "dana@riverside.test" && sa.deal.integrations === "SAP" && sa.deal.approval_limit_usd === 25000 && sa.deal.master_agreement.yes === false && sa.note === "Met at the summit." && sa.updated_by, sa);
  const s2 = await admin.post(`/api/admin/sites/${A}`, { deal: { master_agreement: { yes: true, signed_at: "2026-10-01" } } });
  t("a second save changes only what it sends: the master agreement, and the rest of the deal stays", s2.status === 200 && s2.json.site.deal.master_agreement.signed_at === "2026-10-01" && s2.json.site.deal.integrations === "SAP" && s2.json.site.headcount === 150 && s2.json.site.site_id === sa.site_id, s2.json.site);
  const s3 = await admin.post(`/api/admin/sites/${A}`, { headcount: 300, plant_manager: { name: "Dana Hale", email: "not an email" } });
  const after = (await admin.get("/api/admin/sites")).json.rows.find((r) => r.slug === A);
  t("a bad field is refused in plain words and nothing is changed", s3.status === 400 && /email/.test(s3.json.error) && after.headcount === 150 && after.plant_manager.email === "dana@riverside.test", s3.json);
  t("nothing to save is refused", (await admin.post(`/api/admin/sites/${A}`, {})).status === 400);
  t("an unknown company, or a junk address, is a 404", (await admin.post("/api/admin/sites/nobody-here", { note: "x" })).status === 404 && (await admin.post("/api/admin/sites/..%2Fx", { note: "x" })).status === 404);
  t("the site touched last is first in the pipeline", (await admin.get("/api/admin/sites")).json.rows[0].slug === A);
  t("an event is logged for the save, with the fields", (await q("SELECT detail FROM platform.events WHERE kind='site_updated' AND ref=$1 ORDER BY id DESC LIMIT 1", [A])).rows[0].detail.fields.includes("deal"));

  // ---- a company that did not come in from anetix.ai joins the pipeline once something is saved for it
  const before = (await admin.get("/api/admin/sites")).json.rows.some((r) => r.slug === "demo");
  await admin.post("/api/admin/sites/demo", { site_name: "Showroom line", headcount: 22 });
  const demoRow = (await admin.get("/api/admin/sites")).json.rows.find((r) => r.slug === "demo");
  t("the showroom company is not listed until a field is saved, then it is, with no demo behind it", !before && demoRow && demoRow.demo_holder === null && demoRow.band.key === "small" && demoRow.stage === "demo" && demoRow.stage_label === "Not ordered yet", demoRow);

  // ---- a paying site: its facts are the signed ones, and the company cannot simply be deleted
  await q("UPDATE platform.sites SET stage='subscribed', standing='good' WHERE company=$1", [Bs]).then(async (r) => {
    if (!r.rowCount) await q("INSERT INTO platform.sites (id, company, stage, standing) VALUES (gen_random_uuid(), $1, 'subscribed', 'good')", [Bs]);
  });
  const locked = await admin.post(`/api/admin/sites/${Bs}`, { headcount: 40 });
  t("a subscribed site's facts cannot be edited here", locked.status === 409 && /signed order/.test(locked.json.error), locked.json);
  const L2 = (await admin.get("/api/admin/sites")).json;
  t("the stage counts follow: one subscribed, paid up", L2.stages.subscribed === 1 && L2.attention === 0 && L2.rows.find((r) => r.slug === Bs).stage_label === "Subscribed" && L2.rows.find((r) => r.slug === Bs).standing_label === "paid up", L2.stages);
  const del1 = await admin.post(`/api/admin/companies/${Bs}/delete`, { confirm_slug: Bs, password: PW.admin });
  t("deleting a paying site's company is refused until its subscription ends", del1.status === 409 && /End its subscription first/.test(del1.json.error), del1.json);
  await q("UPDATE platform.sites SET stage='back_to_demo', standing=NULL WHERE company=$1", [Bs]);
  const del2 = await admin.post(`/api/admin/companies/${Bs}/delete`, { confirm_slug: Bs, password: PW.admin });
  t("once it is back to a demo the delete goes through and takes the site's row", del2.status === 200 && (await q("SELECT 1 FROM platform.sites WHERE company=$1", [Bs])).rows.length === 0, del2.json);

  // ---- the backup
  const bk = await admin.get("/api/admin/backup");
  const has = (k) => Array.isArray((bk.json.platform[k] || {}).rows || bk.json.platform[k]);
  t("the backup carries the price books and the sites", bk.status === 200 && has("price_books") && has("sites"), Object.keys(bk.json.platform || {}).filter((k) => /price|site/.test(k)));

  // ---- who may see any of it
  const mgr = client(); await mgr.post("/login", { name: "dana@riverside.test", password: "copper-oak-2201-press" });
  const floor = client(); await floor.post("/login", { password: PW.floor, company: "demo" });
  for (const [whoIs, c, want] of [["nobody signed in", client(), 401], ["a demo's own manager", mgr, 403], ["a floor login", floor, 403]]) {
    const got = [(await c.get("/api/admin/sites")).status, (await c.post("/api/admin/sites/quote", { headcount: 10 })).status, (await c.post(`/api/admin/sites/${A}`, { note: "x" })).status];
    t(`${whoIs} gets none of it`, got.every((s) => s === want), got);
  }
  t("and nothing they tried changed the note", (await admin.get("/api/admin/sites")).json.rows.find((r) => r.slug === A).note === "Met at the summit.");
  R.done();
})().catch(R.abort);
