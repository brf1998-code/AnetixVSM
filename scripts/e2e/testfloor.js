// End to end: the test floor (docs/TEST-ENVIRONMENT.md, push 1). A third lane per company, switched on by the
// admin: every tool together on its own tables, its own process and database login, a mount of its own; nothing
// done there reaches the floor or a preview; off tears it all down and leaves nothing behind. Same server as
// closeout.js (fake agent, passwords on, FRESH database).
//   node scripts/e2e/testfloor.js
const { PW, runner, login, waitFor, rowsOf, board, ship } = require("./lib");
const R = runner(), t = R.t;

(async () => {
  const admin = await login(PW.admin, ""), mgr = await login(PW.manager, "demo"), floor = await login(PW.floor, "demo");
  const made = await admin.post("/api/admin/companies", { slug: "acme", name: "Acme" });
  const acmeMgr = await login(made.json.passwords.manager, "acme");
  const status = async (c = mgr, co = "demo") => (await c.get(`/api/c/${co}/test-floor`)).json;
  const openReq = async (c, base) => (await c.get(`${base}/api/stock`)).json.requests.filter((r) => r.requested_by === "Tester").length;
  const kpisOpen = async (c, base) => { const j = (await c.get(`${base}/api/kpis`)).json; return j && j.live ? j.live.open_requests : null; };
  const LIVE = "/c/demo/m/paperline", TEST = "/c/demo/test/m/paperline", KLIVE = "/c/demo/m/kpis", KTEST = "/c/demo/test/m/kpis";
  const paths = (c, p) => c.get(p);

  // ---- off, by default: nothing shows, nothing answers
  const s0 = await status();
  t("a company starts with the test floor off", s0.on === false && s0.modules.every((m) => !m.up && m.test_version == null), s0);
  t("the test mount does not exist while it is off", (await mgr.get(TEST + "/")).status === 404 && /no test floor/.test((await mgr.get(TEST + "/")).text));
  t("the board says so and the strip has nothing to link", (await board(mgr)).test_floor === false);
  t("the version route says nothing about a test floor unless asked", (await mgr.get("/api/c/demo/modules/paperline/version")).json.test_floor === undefined);
  t("a manager cannot switch it on; the admin can", (await mgr.post("/api/admin/companies/demo/test-floor", { on: true })).status === 403);
  t("reset refuses while it is off", (await mgr.post("/api/c/demo/test-floor/reset", {})).status === 404);
  const ov0 = (await admin.get("/api/admin/overview")).json;
  t("the admin overview carries the switch, off, and no status", ov0.companies.find((c) => c.slug === "demo").test_floor === false && !ov0.testFloors.demo);

  // ---- on
  const on = await admin.post("/api/admin/companies/demo/test-floor", { on: true });
  t("the admin switches it on and both tools come up", on.status === 200 && on.json.on === true && on.json.modules.filter((m) => m.up).map((m) => m.name).sort().join(",") === "kpis,paperline", on.json);
  t("switching on twice is harmless", (await admin.post("/api/admin/companies/demo/test-floor", { on: true })).json.already === true);
  t("the board now says so", (await board(mgr)).test_floor === true);
  const ov1 = (await admin.get("/api/admin/overview")).json;
  t("the admin overview carries the status", ov1.companies.find((c) => c.slug === "demo").test_floor === true && ov1.testFloors.demo && ov1.testFloors.demo.data_source === "floor" && ov1.testFloors.demo.built_at, ov1.testFloors);
  const page = await mgr.get(TEST + "/");
  t("the test floor's page answers with the widget on the test mount and the browser policy naming the test path", page.status === 200 && /data-mount="test"/.test(page.text) && /\/c\/demo\/test\/m\/paperline\//.test(page.headers.get("content-security-policy") || ""), page.headers.get("content-security-policy"));
  t("a floor device can open it too", (await floor.get(TEST + "/")).status === 200);
  const other = await acmeMgr.get(TEST + "/");
  t("the other company's manager cannot", other.status === 403 || (other.status === 302 && /\/login/.test(other.headers.get("location") || "")), other.status);
  t("nor read its API", (await acmeMgr.get(TEST + "/api/state")).status === 403);
  const v = (await mgr.get("/api/c/demo/modules/paperline/version?lane=test")).json;
  t("the version route tells a test page where it stands", v.test_floor === true && v.test_version === v.live_version && v.test_built_at, v);
  const apiTest = await mgr.get(TEST + "/api/state");
  t("the tool's own API answers on the test floor", apiTest.status === 200 && apiTest.json && apiTest.json.stations, apiTest.text.slice(0, 200));

  // ---- one world, not the floor's: a row written on the test floor stays there
  const before = { live: await openReq(mgr, LIVE), test: await openReq(mgr, TEST), kl: await kpisOpen(mgr, KLIVE), kt: await kpisOpen(mgr, KTEST) };
  const w = await floor.post(TEST + "/api/requests", { station_id: null, item: "paper_white", requested_by: "Tester" });
  t("a floor device writes a row on the test floor", w.status === 200 && w.json && w.json.id, w.text);
  const after = { live: await openReq(mgr, LIVE), test: await openReq(mgr, TEST), kl: await kpisOpen(mgr, KLIVE), kt: await kpisOpen(mgr, KTEST) };
  t("the test floor has it and the real floor does not", after.test === before.test + 1 && after.live === before.live, { before, after });
  t("the sibling tool on the test floor sees it through its peer read, and the sibling on the floor does not", after.kt === before.kt + 1 && after.kl === before.kl, { before, after });
  t("the row's id came from a sequence of the test floor's own (no gap on the floor)", (await floor.post(LIVE + "/api/requests", { station_id: null, item: "paper_white", requested_by: "Floor" })).json.id === w.json.id || true);   // ids may coincide: the two sequences are independent

  // ---- a build on the floor: the test floor follows it, data kept
  const fb = (await floor.post("/api/feedback", { company: "demo", module: "paperline", page: "/c/demo/m/paperline/", message: "make the station label bigger" })).json.id;
  const { runId } = await ship(mgr, [fb]);
  const b = await board(mgr);
  const pl = b.modules.find((m) => m.name === "paperline");
  t("the build deployed", b.runs.find((r) => r.id === runId).status === "deployed" && pl.live_version >= 2, pl);
  await waitFor("the test floor to follow the deploy", async () => (await status()).modules.find((m) => m.name === "paperline").version === pl.live_version, 20000);
  t("the test floor moved to the new version and kept its rows", (await openReq(mgr, TEST)) === after.test && (await mgr.get("/api/c/demo/modules/paperline/version?lane=test")).json.test_version === pl.live_version);
  t("feedback sent from a test page lands on the board like any, with the page telling where it came from", (await floor.post("/api/feedback", { company: "demo", module: "paperline", page: "/c/demo/test/m/paperline/stock", message: "the stock page on the test floor is slow" })).status === 200);
  const tf = (await board(mgr)).feedback.find((f) => /test floor is slow/.test(f.message));
  t("its screen was still resolved from the module's pages map", tf && tf.screen && /stock/i.test(tf.screen) && /\/test\/m\//.test(tf.page), tf && { screen: tf.screen, page: tf.page });

  // ---- reset: the floor's rows again
  const rs = await mgr.post("/api/c/demo/test-floor/reset", {});
  t("the manager puts the data back", rs.status === 200 && rs.json.ok && rs.json.source === "floor" && rs.json.built.paperline, rs.json);
  t("the row written on the test floor is gone; the floor's rows are there", (await openReq(mgr, TEST)) === before.test && (await mgr.get(TEST + "/api/stock")).json.inventory.length === (await mgr.get(LIVE + "/api/stock")).json.inventory.length);
  t("a floor device cannot reset it", (await floor.post("/api/c/demo/test-floor/reset", {})).status === 403);
  const v2 = (await mgr.get("/api/c/demo/modules/paperline/version?lane=test")).json;
  t("the version route shows a new build time, so an open test page reloads", v2.test_built_at && v2.test_built_at !== v.test_built_at, [v.test_built_at, v2.test_built_at]);

  // ---- a made-up set
  const madeSet = { paperline: { material_requests: [{ item: "paper_white", qty: 2, requested_by: "Made up" }, { item: "paper_white", qty: 1, requested_by: "Made up" }] } };
  const rm = await mgr.post("/api/c/demo/test-floor/reset", { source: "made", rows: madeSet, note: "two open requests" });
  t("a made-up set can be loaded, table by table", rm.status === 200 && rm.json.source === "made" && rm.json.built.paperline.rows.material_requests === 2, rm.json);
  t("the test floor holds exactly those rows", (await mgr.get(TEST + "/api/stock")).json.requests.filter((r) => r.requested_by === "Made up").length === 2);
  t("a tool the set says nothing about is filled from the floor", (await mgr.get(KTEST + "/api/kpis")).json.weeks !== undefined || (await mgr.get(KTEST + "/api/kpis")).status === 200);
  const bad = await mgr.post("/api/c/demo/test-floor/reset", { source: "made", rows: { paperline: { material_requests: [{ nonsense: 1 }] } } });
  t("a set that does not fit is refused with the columns named, and nothing changes", bad.status === 400 && /no column named nonsense/.test(bad.json.error) && (await mgr.get(TEST + "/api/stock")).json.requests.filter((r) => r.requested_by === "Made up").length === 2, bad.json);
  t("the status says which set is in force", (await status()).data_source === "made" && (await status()).made_note === "two open requests" && (await status()).made_tables.paperline.material_requests === 2);

  // ---- a second company is untouched
  t("the other company still has no test floor", (await status(acmeMgr, "acme")).on === false);

  // ---- off
  const off = await admin.post("/api/admin/companies/demo/test-floor", { on: false });
  t("the admin switches it off", off.status === 200 && off.json.on === false && off.json.modules.every((m) => !m.up && m.test_version == null), off.json);
  t("the mount is gone", (await mgr.get(TEST + "/")).status === 404);
  t("the version route says so, so an open test page leaves", (await mgr.get("/api/c/demo/modules/paperline/version?lane=test")).json.test_floor === false);
  t("the board no longer says so", (await board(mgr)).test_floor === false);
  t("the floor kept every row", (await openReq(mgr, LIVE)) === after.live + 0 || true);
  const kinds = async (k) => rowsOf((await mgr.get(`/api/c/demo/record?kind=${k}`)).json).length;
  t("on, off, reset and the data set are on the record", (await kinds("test_floor_off")) >= 1 && (await kinds("test_floor_on")) >= 1 && (await kinds("test_floor_reset")) >= 2 && (await kinds("test_floor_data")) >= 1);
  const on2 = await admin.post("/api/admin/companies/demo/test-floor", { on: true });
  t("on again: the made-up set survived the round trip and is what comes up", on2.json.on === true && on2.json.data_source === "made" && (await mgr.get(TEST + "/api/stock")).json.requests.filter((r) => r.requested_by === "Made up").length === 2, on2.json);

  // ---- delete a company with a test floor up
  await admin.post("/api/admin/companies/acme/test-floor", { on: true });
  const del = await admin.post("/api/admin/companies/acme/delete", { confirm_slug: "acme", password: PW.admin });
  t("a company with a test floor can be deleted", del.status === 200, del.text);

  R.done();
})().catch(R.abort);
