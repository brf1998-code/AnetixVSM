// End to end for archiving a tool and deleting one for good (src/archive.js; 2026-10-29, Taylor's request #286).
// What it proves: the floor cannot archive; a manager is told when another tool reads the one being archived and
// archives on the second ask; an archived tool is off the board (the band and its cards), its screens say "archived",
// it is listed under Settings and comes back from there exactly as it was; archiving waits for an open build; Anetix
// deletes an archived tool for good only with its name typed and the admin's step, and then its tables, versions and
// docs are gone, its open requests are closed, and its history stays; a tool on the board cannot be deleted.
// Against a server ALREADY UP in fake-agent mode on a fresh database (run-all.sh has the line).
const { BASE, PW, runner, login, waitFor, proposalFor, board } = require("./lib");
const { q } = require("../../src/db");
const R = runner(), t = R.t;

(async () => {
  const mgr = await login(PW.manager, "demo"), floor = await login(PW.floor, "demo"), admin = await login(PW.admin, "");
  const b0 = await board(mgr);
  t("setup: the demo has the paper airplane line, Plant KPIs (which reads the line) and Shop Schedule", ["paperline", "kpis", "shop-schedule"].every((n) => b0.modules.some((m) => m.name === n)), b0.modules.map((m) => m.name));

  t("the floor cannot archive a tool", (await floor.post("/api/c/demo/modules/paperline/archive", {})).status === 403);
  const a1 = await mgr.post("/api/c/demo/modules/paperline/archive", {});
  t("archiving a tool another reads asks first, naming who reads it", a1.status === 409 && a1.json.code === "readers" && a1.json.readers.some((r) => r.name === "kpis") && /Plant KPIs reads Paper Airplane Line/.test(a1.json.error), a1.text);
  t("and nothing changed yet", !(await q("SELECT archived_at FROM platform.modules WHERE company='demo' AND name='paperline'")).rows[0].archived_at);
  const a2 = await mgr.post("/api/c/demo/modules/paperline/archive", { confirm: true });
  t("asked again, it is archived", a2.status === 200 && a2.json.ok === true, a2.text);
  const b1 = await board(mgr);
  t("it is off the board: not on the band, its cards gone, the count says one is archived", !b1.modules.some((m) => m.name === "paperline") && !b1.feedback.some((f) => f.module === "paperline") && b1.archived_tools === 1 && !b1.pages.paperline);
  const page = await mgr.get("/c/demo/m/paperline/station/1"), api = await floor.get("/c/demo/m/paperline/api/state");
  t("its screens say it is archived, a page in words and a call in JSON", page.status === 410 && /This tool is archived/.test(page.text) && /bring it back from Settings/.test(page.text) && api.status === 410 && api.json.code === "archived", [page.status, api.status]);
  t("its preview and test floor addresses say so too", (await mgr.get("/c/demo/staging/m/paperline/")).status === 410);
  const sv = (await mgr.get("/api/c/demo/settings-view")).json;
  t("it is listed under Settings, Archived tools", (sv.archived || []).some((m) => m.name === "paperline" && m.title === "Paper Airplane Line" && m.archived_at), sv.archived);
  t("Plant KPIs, which reads it, still works", (await mgr.get("/c/demo/m/kpis/")).status === 200);
  const ov = (await admin.get("/api/admin/overview")).json.companies.find((c) => c.slug === "demo");
  t("the admin's company card shows it archived", ov.modules.some((m) => m.name === "paperline" && m.archived_at));
  t("it is on the record", (await q("SELECT 1 FROM platform.record WHERE company='demo' AND kind='tool_archived' AND module='paperline'")).rows.length === 1);

  t("the floor cannot bring it back", (await floor.post("/api/c/demo/modules/paperline/unarchive", {})).status === 403);
  const back = await mgr.post("/api/c/demo/modules/paperline/unarchive", {});
  t("a manager brings it back from Settings", back.status === 200);
  const b2 = await board(mgr);
  t("and it is on the board as it was, its screens open again", b2.modules.some((m) => m.name === "paperline" && m.live_version === b0.modules.find((x) => x.name === "paperline").live_version) && (await mgr.get("/c/demo/m/paperline/station/1")).status === 200 && b2.archived_tools === 0);

  // ---- delete for good ----
  // the demo company is seeded with the library's tools at every start, so its copies are archived, never deleted
  t("Shop Schedule is archived in the demo company (nothing reads it)", (await mgr.post("/api/c/demo/modules/shop-schedule/archive", {})).status === 200);
  const seed = await admin.post("/api/admin/companies/demo/modules/shop-schedule/delete", { confirm_name: "Shop Schedule", password: PW.admin });
  t("the library's own copy in the company it seeds is not deleted (it would come back at the next start)", seed.status === 409 && seed.json.code === "library_seed", seed.text);
  // another company with its own copy of Shop Schedule, and a request on it that stays open
  const made = await admin.post("/api/admin/companies", { slug: "toolco", name: "Tool Co" });
  const tmgr = await login(made.json.passwords.manager, "toolco");
  t("setup: Tool Co gets its own copy of Shop Schedule", (await admin.post("/api/admin/companies/toolco/modules", { module: "shop-schedule" })).status === 200 && (await board(tmgr, "toolco")).modules.some((m) => m.name === "shop-schedule"));
  const fbS = (await tmgr.post("/api/feedback", { company: "toolco", module: "shop-schedule", page: "/c/toolco/m/shop-schedule/", message: "the late jobs should be red ARCHIVECANARY" })).json.id;
  t("a tool on the board cannot be deleted", (await admin.post("/api/admin/companies/toolco/modules/shop-schedule/delete", { confirm_name: "Shop Schedule", password: PW.admin })).json.code === "not_archived");
  t("Tool Co's manager archives it", (await tmgr.post("/api/c/toolco/modules/shop-schedule/archive", {})).status === 200);
  t("a manager cannot delete it", (await tmgr.post("/api/admin/companies/toolco/modules/shop-schedule/delete", { confirm_name: "Shop Schedule" })).status === 403);
  const wrongName = await admin.post("/api/admin/companies/toolco/modules/shop-schedule/delete", { confirm_name: "Shop", password: PW.admin });
  const noStep = await admin.post("/api/admin/companies/toolco/modules/shop-schedule/delete", { confirm_name: "Shop Schedule" });
  t("it takes the tool's name typed and the admin's step", wrongName.status === 400 && /type the tool's name/.test(wrongName.json.error) && noStep.status === 403, [wrongName.text, noStep.text]);
  t("and nothing went while it was refused", (await q("SELECT 1 FROM platform.modules WHERE company='toolco' AND name='shop-schedule'")).rows.length === 1);
  const del = await admin.post("/api/admin/companies/toolco/modules/shop-schedule/delete", { confirm_name: "Shop Schedule", password: PW.admin });
  t("with both, it is deleted for good", del.status === 200 && del.json.ok === true && del.json.counts.modules === 1 && del.json.counts.module_versions >= 1, del.text);
  const schemas = (await q("SELECT nspname FROM pg_namespace WHERE nspname IN ('mod_toolco_shop_schedule','stg_toolco_shop_schedule','tst_toolco_shop_schedule')")).rows;
  t("its tables are gone", schemas.length === 0, schemas);
  t("its versions, docs and the tool are gone", (await q("SELECT 1 FROM platform.module_versions WHERE company='toolco' AND module='shop-schedule' UNION ALL SELECT 1 FROM platform.agent_docs WHERE company='toolco' AND module='shop-schedule' UNION ALL SELECT 1 FROM platform.modules WHERE company='toolco' AND name='shop-schedule'")).rows.length === 0);
  const fbRow = (await q("SELECT status, outcome, message FROM platform.feedback WHERE id=$1", [fbS])).rows[0];
  t("its open request is closed with words, and kept", fbRow && fbRow.status === "declined" && fbRow.outcome === "The tool was deleted." && /ARCHIVECANARY/.test(fbRow.message), fbRow);
  t("the record keeps its history and says it was deleted", (await q("SELECT 1 FROM platform.record WHERE company='toolco' AND module='shop-schedule' AND kind='tool_deleted'")).rows.length === 1 && (await q("SELECT 1 FROM platform.record WHERE company='toolco' AND module='shop-schedule' AND kind='tool_archived'")).rows.length === 1);
  t("its address is gone", [404, 410].includes((await tmgr.get("/c/toolco/m/shop-schedule/")).status));
  t("it is not under Settings any more", !((await tmgr.get("/api/c/toolco/settings-view")).json.archived || []).some((m) => m.name === "shop-schedule"));
  t("the demo company's copy is untouched (still archived there)", (await q("SELECT archived_at FROM platform.modules WHERE company='demo' AND name='shop-schedule'")).rows[0].archived_at && (await q("SELECT nspname FROM pg_namespace WHERE nspname='mod_demo_shop_schedule'")).rows.length === 1);
  const again = await admin.post("/api/admin/companies/toolco/modules", { module: "shop-schedule" });
  t("its name is free again: the library tool can be added back, fresh", again.status === 200 && (await board(tmgr, "toolco")).modules.some((m) => m.name === "shop-schedule" && m.live_version === 1) && (await tmgr.get("/c/toolco/m/shop-schedule/")).status === 200, again.text);

  // ---- archiving waits for an open build ----
  const fbK = (await floor.post("/api/feedback", { company: "demo", module: "kpis", page: "/c/demo/m/kpis/", message: "SIMPLE make the chart titles bigger" })).json.id;
  const prop = await proposalFor(mgr, fbK);
  const runId = ((await mgr.post(`/api/proposals/${prop.id}/decide`, { decision: "approve" })).json.run || {}).id;
  await waitFor("the build at a gate", async () => { const r = (await board(mgr)).runs.find((x) => x.id === runId); return r && r.status === "waiting"; });
  const busy = await mgr.post("/api/c/demo/modules/kpis/archive", { confirm: true });
  t("a tool with a change waiting for its OK is not archived until that is done", busy.status === 409 && busy.json.code === "busy" && /Make it live or cancel it first/.test(busy.json.error), busy.text);
  R.done();
})().catch(R.abort);
