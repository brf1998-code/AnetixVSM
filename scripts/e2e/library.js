// End to end for the tool library across companies (src/library.js): copy a tool from one company to another, save a
// template, the standard package, the check of what is a company's own, the gate on old code, and that only code
// travels. Against a server ALREADY UP in fake-agent mode on a fresh database (run-all.sh):
//   node scripts/e2e/library.js
const fs = require("fs");
const path = require("path");
const { runner, login, PW, BASE } = require("./lib");
const { q } = require("../../src/db");
const R = runner(), t = R.t;

// the e2e client has GET and POST; PATCH and DELETE with the same cookies
async function call(c, method, p, body) {
  const res = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", Cookie: c.cookies().map((x) => `${x.name}=${x.value}`).join("; ") }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch (e) { /* not json */ }
  return { status: res.status, json, text };
}
function readTree(dir, rel = "") {
  const out = {};
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) Object.assign(out, readTree(dir, r)); else out[r] = fs.readFileSync(path.join(dir, r), "utf8");
  }
  return out;
}

(async () => {
  const admin = await login(PW.admin);
  for (const [slug, name, demo] of [["acme-tools", "Acme Tools", false], ["prospect-one", "Prospect One", true], ["prospect-two", "Prospect Two", true]]) {
    await q("INSERT INTO platform.companies (slug, name, demo) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [slug, name, demo]);
  }
  // a tool Acme made: the kpis screens, renamed, with Acme's name, a contact, its own address and one seeded row
  const files = readTree(path.join(__dirname, "..", "..", "modules", "kpis"));
  const mf = JSON.parse(files["module.json"]); mf.title = "Acme CRM"; mf.description = "Customers and the next touch."; delete mf.company;
  files["module.json"] = JSON.stringify(mf, null, 2);
  const firstPage = Object.keys(files).find((f) => f.startsWith("pages/") && f.endsWith(".html"));
  files[firstPage] = files[firstPage].replace("</body>", `<p id="acme">Acme Tools customers. Ask sam@acmetools.com. <a href="/c/acme-tools/m/acme-crm/">home</a></p></body>`);
  files["migrations/900.sql"] = "INSERT INTO chats (title, messages) VALUES ('Acme Tools seed', '[]')";
  await q("INSERT INTO platform.modules (company, name, title, live_version) VALUES ('acme-tools','acme-crm','Acme CRM',3)");
  for (const v of [1, 2, 3]) await q("INSERT INTO platform.module_versions (company, module, version, source, files) VALUES ('acme-tools','acme-crm',$1,'build',$2)", [v, JSON.stringify(files)]);

  // ---- the check
  const ck = await admin.get("/api/admin/library/check?company=acme-tools&module=acme-crm");
  t("the check reads the version on the floor", ck.status === 200 && ck.json.version === 3 && ck.json.live === true && ck.json.title === "Acme CRM", ck.json);
  const kinds = (ck.json.findings || []).map((f) => f.kind);
  t("it finds Acme's name, an email, a seeded row and Acme's own address", ["name", "contact", "rows", "path"].every((k) => kinds.includes(k)), ck.json.findings);
  t("a manager may not ask", (await (await login(PW.manager, "demo")).get("/api/admin/library/check?company=acme-tools&module=acme-crm")).status === 403);

  // ---- copy to a demo: live, empty tables, addresses rewritten, version 1
  const cp = await admin.post("/api/admin/library/copy", { from_company: "acme-tools", module: "acme-crm", to_company: "prospect-one" });
  t("copied, live as version 1 under its own name", cp.status === 200 && cp.json.module === "acme-crm" && cp.json.version === 1 && !cp.json.renamed, cp.json);
  const row = (await q("SELECT * FROM platform.modules WHERE company='prospect-one' AND name='acme-crm'")).rows[0];
  t("the module row is live at v1", row && row.live_version === 1 && row.title === "Acme CRM", row);
  const v1 = (await q("SELECT source, notes, files FROM platform.module_versions WHERE company='prospect-one' AND module='acme-crm'")).rows;
  t("one version, source copy, the notes say where from", v1.length === 1 && v1[0].source === "copy" && /Acme Tools \(acme-tools\/acme-crm v3\)/.test(v1[0].notes), v1.map((v) => [v.source, v.notes]));
  t("Acme's address is rewritten to the prospect's", !JSON.stringify(v1[0].files).includes("/c/acme-tools/") && JSON.stringify(v1[0].files).includes("/c/prospect-one/m/acme-crm/"));
  const page = await admin.get("/c/prospect-one/m/acme-crm/");
  t("its page answers at the prospect", page.status === 200 && /id="acme"/.test(page.text), page.status);
  // only the code travels: a row put in Acme's tables is not at the prospect
  const prospectRows = (await q("SELECT count(*)::int AS n FROM mod_prospect_one_acme_crm.chats")).rows[0].n;
  t("the only row at the prospect is the one a migration puts there (the check said so)", prospectRows === 1, prospectRows);
  const hist = (await q("SELECT * FROM platform.library_copies WHERE company='prospect-one'")).rows;
  t("the copy is on the record of copies", hist.length === 1 && hist[0].from_company === "acme-tools" && hist[0].from_version === 3, hist);

  // ---- the same tool again: a free name
  const again = await admin.post("/api/admin/library/copy", { from_company: "acme-tools", module: "acme-crm", to_company: "prospect-one" });
  t("a second copy takes -2", again.status === 200 && again.json.module === "acme-crm-2" && again.json.renamed === true, again.json);
  // a repo library tool's name is never taken by a copy (the boot import would fight it)
  const pl = await admin.post("/api/admin/library/copy", { from_company: "demo", module: "paperline", to_company: "prospect-one" });
  t("demo's Paper Airplane Line copies as paperline-2, never paperline", pl.status === 200 && pl.json.module === "paperline-2", pl.json);

  // ---- templates
  const sv = await admin.post("/api/admin/library/templates", { from_company: "acme-tools", module: "acme-crm", title: "CRM", description: "A simple CRM", standard: true });
  t("saved as a standard template, with what it carries", sv.status === 200 && sv.json.id && sv.json.findings.some((f) => f.kind === "name"), sv.json);
  const ov = await admin.get("/api/admin/overview");
  const tpl = (ov.json.templates || []).find((x) => x.id === sv.json.id);
  t("the overview lists it with its screens and source", tpl && tpl.title === "CRM" && tpl.standard && tpl.from_name === "Acme Tools" && tpl.from_version === 3 && tpl.screens.length > 0, tpl);
  t("and the copies made so far", (ov.json.copies || []).length === 3, ov.json.copies);
  // the source keeps building: the template does not move
  await q("INSERT INTO platform.module_versions (company, module, version, source, files) VALUES ('acme-tools','acme-crm',4,'build',$1)", [JSON.stringify({ ...files, "module.json": JSON.stringify({ ...mf, title: "Acme CRM v4" }) })]);
  await q("UPDATE platform.modules SET live_version=4 WHERE company='acme-tools' AND name='acme-crm'");
  const rn = await call(admin, "PATCH", `/api/admin/library/templates/${sv.json.id}`, { title: "Simple CRM" });
  t("renamed", rn.status === 200);
  const pk = await admin.post("/api/admin/companies/prospect-two/package", { standard: true });
  t("the standard package goes on in one call", pk.status === 200 && pk.json.added === 1 && pk.json.results[0].module === "acme-crm", pk.json);
  const two = (await q("SELECT title, (SELECT files->>'module.json' FROM platform.module_versions v WHERE v.company=m.company AND v.module=m.name) AS mf FROM platform.modules m WHERE company='prospect-two'")).rows;
  t("with the template's new name and the frozen code (not Acme's v4)", two.length === 1 && two[0].title === "Simple CRM" && !/v4/.test(two[0].mf), two);
  const pk2 = await admin.post("/api/admin/companies/prospect-two/package", { standard: true });
  t("a template the company already has is skipped", pk2.status === 200 && pk2.json.added === 0 && pk2.json.results[0].skipped, pk2.json);
  const pk3 = await admin.post("/api/admin/companies/prospect-two/package", { ids: [] });
  t("an empty pick is refused in words", pk3.status === 400 && /pick at least one/.test(pk3.json.error), pk3.json);
  const add = await admin.post(`/api/admin/library/templates/${sv.json.id}/add`, { to_company: "prospect-one" });
  t("one template to one company", add.status === 200 && add.json.module === "acme-crm-3", add.json);

  // ---- old code the gate would refuse today does not travel
  const bad = { ...files, "routes.js": "const fs = require('fs');\n" + files["routes.js"] };
  await q("INSERT INTO platform.modules (company, name, title, live_version) VALUES ('acme-tools','old-tool','Old tool',1)");
  await q("INSERT INTO platform.module_versions (company, module, version, source, files) VALUES ('acme-tools','old-tool',1,'build',$1)", [JSON.stringify(bad)]);
  const refused = await admin.post("/api/admin/library/copy", { from_company: "acme-tools", module: "old-tool", to_company: "prospect-one" });
  t("refused with the gate's words, and nothing half made", refused.status === 422 && /refused as a new build/.test(refused.json.error) && !(await q("SELECT 1 FROM platform.modules WHERE company='prospect-one' AND name='old-tool'")).rows.length, refused.json);
  const nope = await admin.post("/api/admin/library/copy", { from_company: "acme-tools", module: "nothing", to_company: "prospect-one" });
  t("an unknown tool is a 404", nope.status === 404, nope.json);

  // ---- delete the template: the copies stay
  const del = await call(admin, "DELETE", `/api/admin/library/templates/${sv.json.id}`);
  t("deleted", del.status === 200);
  t("the companies keep their copies", (await q("SELECT count(*)::int AS n FROM platform.modules WHERE name LIKE 'acme-crm%'")).rows[0].n === 5);
  R.done();
})().catch(R.abort);
