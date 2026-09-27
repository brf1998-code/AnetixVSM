// End to end for a company's own data (src/dataexport.js; the Terms, 10.6 and 10.7; the launch audit, C9): the manager
// downloads everything the company put in and never a tool's code; the floor and other companies cannot; deleting a
// demo takes its demo request and its pin with it; a demo request past 12 months goes unless it led to a demo; the
// Demos tab lists companies idle 11 months or more. Against a server ALREADY UP in fake-agent mode with SOS_WWW_KEY
// set, on a fresh database (run-all.sh does it):
//   SOS_WWW_KEY=... node scripts/e2e/dataexport.js
const { runner, client, login, PW, sleep } = require("./lib");
const { q } = require("../../src/db");
const totp = require("../../src/totp");
const X = require("../../src/dataexport");
const R = runner(), t = R.t;
const BASE = process.env.SOS_E2E_BASE || "http://127.0.0.1:3999";
const KEY = process.env.SOS_WWW_KEY;
if (!KEY) { console.error("SOS_WWW_KEY must be set in this shell and the server's"); process.exit(2); }
const www = async (p, body) => {
  const r = await fetch(BASE + p, { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", "X-SOS-WWW-Key": KEY }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
async function codeFor(secretText) {
  const into = (Date.now() / 1000) % 30;
  if (into > 27.5) await sleep((30 - into) * 1000 + 300);
  return totp.hotp(totp.base32Decode(secretText), totp.stepAt());
}
const tag = Date.now().toString(36).slice(-5);

(async () => {
  const admin = await login(PW.admin);

  // ---- a demo the whole way from anetix.ai: the request, its pin, the demo
  const email = `dana${tag}@harbor.test`;
  t("a demo request lands", (await www("/api/www/demo-requests", { name: "Dana Reyes", email, company: "Harbor Fittings", wants: "pin", ip: "203.0.113.9" })).status === 200);
  const reqRow = (await admin.get("/api/admin/demo-requests")).json.requests.find((r) => r.email === email);
  const made = (await admin.post(`/api/admin/demo-requests/${reqRow.id}/pin`, { days: 30 })).json;
  const pin = made.pin.shown, pinId = made.pin.id;
  const password = "harbor-oak-2201-press";
  const co = await www("/api/www/companies", { pin, email, name: `Harbor Fittings ${tag}`, contact: "Dana Reyes", ref: `export:${pin}`, paid_usd: 0, credit_usd: 10, password, demo: true, collect: true });
  t("the pin makes the demo", co.status === 200 && co.json.company && co.json.company.slug, co.json);
  const slug = co.json.company.slug;
  const mgr = client();
  await mgr.post("/login", { name: email, password });
  const es = await mgr.post(`/api/c/${slug}/me/enroll/start`, {});
  await mgr.post(`/api/c/${slug}/me/enroll/verify`, { code: await codeFor(es.json.secret.replace(/\s/g, "")) });

  // ---- what the company put in: a request, and a tool with a record in it (made here the way a build leaves one)
  const fb = await mgr.post("/api/feedback", { company: slug, module: "platform", message: "Where do I see last week's scrap by shift?", page: `/c/${slug}/` });
  t("the manager files a request", fb.status === 200 || fb.status === 201, fb.json);
  await q("INSERT INTO platform.modules (company, name, title) VALUES ($1, 'scrap', 'Scrap log') ON CONFLICT DO NOTHING", [slug]);
  const schema = `mod_${slug.replace(/[^a-z0-9_]/gi, "_")}_scrap`;
  await q(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  await q(`CREATE TABLE IF NOT EXISTS ${schema}.entries (id serial primary key, shift text, pounds numeric)`);
  await q(`CREATE TABLE IF NOT EXISTS ${schema}._migrations (id serial primary key, name text)`);
  await q(`INSERT INTO ${schema}.entries (shift, pounds) VALUES ('first', 12.5), ('second', 8)`);
  await q("INSERT INTO platform.module_versions (company, module, version, files, notes) VALUES ($1, 'scrap', 1, $2, 'v1') ON CONFLICT DO NOTHING", [slug, JSON.stringify({ "server.js": "module.exports = function secretSauce() {}" })]).catch(() => {});

  // the record: a build summary by the agent (Anetix's Output, which can quote code) and a manager's own words
  await q("INSERT INTO platform.record (company, module, kind, actor_role, actor_name, after) VALUES ($1, 'scrap', 'build_finished', 'agent', 'agent', 'Wrote routes.js: module.exports = function recordedSauce() {}')", [slug]);
  await q("INSERT INTO platform.record (company, module, kind, actor_role, actor_name, after) VALUES ($1, 'scrap', 'proposal_edited', 'manager', 'Dana Reyes', 'Show scrap by shift, not by day')", [slug]);
  await q(`CREATE TABLE IF NOT EXISTS ${schema}.photos (id serial primary key, img bytea)`);
  await q(`INSERT INTO ${schema}.photos (img) VALUES ('\\x89504e47')`);

  // ---- the download
  const ex = await mgr.get(`/api/c/${slug}/export`);
  const doc = ex.json || {};
  t("the manager downloads the company's data as one JSON file, named for the company and the day", ex.status === 200 && doc.format === "anetix-export-1" && new RegExp(`attachment; filename="anetix-${slug}-data-\\d{4}-\\d{2}-\\d{2}\\.json"`).test(ex.headers.get("content-disposition") || ""), ex.headers.get("content-disposition"));
  t("it holds the request in the words typed", (doc.requests || []).some((r) => r.message === "Where do I see last week's scrap by shift?"));
  const tool = (doc.tools || []).find((x) => x.name === "scrap");
  t("it holds the tool's records, table by table, and not the platform's own bookkeeping table", tool && tool.title === "Scrap log" && tool.tables.entries.length === 2 && tool.tables.entries.some((r) => r.shift === "first") && !("_migrations" in tool.tables), tool);
  t("it holds the manager's sign-in email and name, and no secret", (doc.managers || []).some((m) => m.email === email) && !/password_hash|pin_hash|secret|scrypt/i.test(JSON.stringify(doc.managers)));
  const all = ex.text || "";
  t("never a tool's code, a version's files, a proposal or a model name", !/secretSauce|module_versions|"files"|claude-|proposal_body/.test(all));
  t("the record: the manager's own words are in, the agent's build summary (Output, which can quote code) is not", (doc.record || []).some((r) => r.after === "Show scrap by shift, not by day") && !/recordedSauce/.test(all) && !(doc.record || []).some((r) => r.actor_role === "agent"));
  t("a bytea column reads as base64, not a list of numbers", tool && tool.tables.photos && tool.tables.photos[0].img && tool.tables.photos[0].img.base64 === Buffer.from("89504e47", "hex").toString("base64"), tool && tool.tables.photos);
  t("it says what it leaves out and why", /tools' code is part of the Anetix service/.test(doc.note || ""));
  t("the download is on the event log", (await q("SELECT 1 FROM platform.events WHERE kind='data_exported' AND ref=$1", [slug])).rows.length === 1);

  // ---- who cannot
  const floorish = client();
  t("no session: refused", (await floorish.get(`/api/c/${slug}/export`)).status >= 400);
  const other = await login(PW.manager, "demo");
  t("another company's manager: refused", [401, 403, 404].includes((await other.get(`/api/c/${slug}/export`)).status));
  const floor = await login(PW.floor, "demo");
  t("a floor login, even on its own company: refused (manager only)", (await floor.get("/api/c/demo/export")).status === 403);
  t("an admin can download any company's", (await admin.get(`/api/c/${slug}/export`)).json.company.slug === slug);

  // ---- idle 11 months or more (the Demos tab)
  t("a demo signed in today is not idle", !(await X.idle()).some((x) => x.slug === slug));
  const old = `oldco${tag}`;
  await q("INSERT INTO platform.companies (slug, name, demo, created_at) VALUES ($1, 'Old Co', true, now() - interval '13 months')", [old]);
  await q("INSERT INTO platform.self_serve (company, email, contact, created_at) VALUES ($1, 'old@old.test', 'Old', now() - interval '13 months')", [old]);
  const idle = await X.idle();
  t("a demo nobody signed in to for 13 months is listed, with the day its data can go", idle.some((x) => x.slug === old && new Date(x.delete_after) < new Date()), idle);
  const dl = (await admin.get("/api/admin/demos")).json;
  t("the Demos tab carries the list", (dl.idle || []).some((x) => x.slug === old));

  // ---- a demo request past 12 months goes, unless it led to a demo
  await q("INSERT INTO platform.demo_requests (name, email, company, created_at) VALUES ('Old Ask', 'oldask@x.test', 'Old Ask Co', now() - interval '13 months')");
  await q("UPDATE platform.demo_requests SET created_at = now() - interval '13 months' WHERE id=$1", [reqRow.id]);   // Dana's, which led to a demo
  const oldPin = (await q("INSERT INTO platform.access_pins (pin, label, max_uses, created_at, email) VALUES ('OLDP2345', 'Old Ask at Old Ask Co', 1, now() - interval '13 months', 'oldask@x.test') RETURNING id")).rows[0].id;
  await X.sweepDemoRequests();
  t("an unused pin older than 12 months goes too, with the email and name on it", !(await q("SELECT 1 FROM platform.access_pins WHERE id=$1", [oldPin])).rows.length);
  t("an old request that led nowhere is deleted", !(await q("SELECT 1 FROM platform.demo_requests WHERE email='oldask@x.test'")).rows.length);
  t("an old request that led to a demo stays while the demo does", (await q("SELECT 1 FROM platform.demo_requests WHERE id=$1", [reqRow.id])).rows.length === 1);

  // ---- deleting the demo takes its request and its pin
  const del = await admin.post(`/api/admin/companies/${slug}/delete`, { confirm_slug: slug, password: PW.admin });
  t("the admin deletes the demo", del.status === 200, del.json);
  t("its demo request went with it", !(await q("SELECT 1 FROM platform.demo_requests WHERE id=$1", [reqRow.id])).rows.length);
  t("and so did its pin", !(await q("SELECT 1 FROM platform.access_pins WHERE id=$1", [pinId])).rows.length);
  R.done();
})().catch(R.abort);
