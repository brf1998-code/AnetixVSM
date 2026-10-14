// End to end: the web connection (src/connections.js, the web kind; 2026-10-13). A tool reaches the public web only
// once Anetix turns the web on for it, the same as an ERP or a printer; then its code starts a look-up and reads the
// result through ctx.connections.<name>, from its own process. A request filed as "other" before the web existed is
// turned on as the web from the request itself.
//
// Runs against a server that is ALREADY UP in fake-agent mode on a fresh database, with SOS_AUTO_FIX_ROUNDS=0 and a
// prompt log (the same file for the server and this script); scripts/e2e/run-all.sh starts it.
const fs = require("fs");
const { PW, runner, login, waitFor, board, proposalFor, rowsOf } = require("./lib");
const R = runner(), t = R.t;
const LOG = process.env.SOS_PROMPT_LOG;

(async () => {
  if (!LOG) throw new Error("run with SOS_PROMPT_LOG set, the same file the server writes");
  const prompts = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  const admin = await login(PW.admin, "");
  const mgr = await login(PW.manager, "demo");
  const floor = await login(PW.floor, "demo");
  const made = await admin.post("/api/admin/companies", { slug: "other", name: "Other Co" });
  const otherMgr = await login(made.json.passwords.manager, "other");
  const maria = (await mgr.post("/api/c/demo/people", { name: "Maria G", role: "floor" })).json;
  await floor.post("/api/c/demo/who/sign-in", { id: maria.person.id, pin: maria.pin });

  const PAGE = "/c/demo/m/paperline/";
  const file = async (message) => (await floor.post("/api/feedback", { company: "demo", module: "paperline", page: PAGE, message })).json;
  const runOf = async (id) => (await board(mgr)).runs.find((r) => r.id === id);
  const settle = async (id) => waitFor(`run ${id} to stop or reach the gate`, async () => {
    const x = await runOf(id);
    if (x && x.step === "confirm_requirement" && x.status === "waiting") { await mgr.post(`/api/runs/${id}/confirm`, {}); return null; }
    return x && ((x.step === "await_deploy" && x.status === "waiting") || x.status === "failed") ? x : null;
  }, 60000);
  const build = async (message) => { const f = await file(message); const p = await proposalFor(mgr, f.id); const r = (await mgr.post(`/api/proposals/${p.id}/decide`, { decision: "approve" })).json.run; return { f, p, run: await settle(r.id) }; };
  const lastBuildPrompt = () => prompts().filter((p) => p.kind === "agent" && p.company === "demo").slice(-1)[0] || {};

  // ---- 1. the web is off: a build that reaches for it is stopped, and the builder was told
  const a = await build("ADDWEB look the supplier up on its website");
  const vio = ((a.run.evidence || {}).gate || {}).violations || [];
  t("a change that adds a web connection nobody turned on is stopped before it runs", a.run.status === "failed" && vio.length === 1 && vio[0].rule === "connection-not-on" && /a connection to the public web/.test(vio[0].what), { status: a.run.status, vio });
  t("the builder was told the web is not on", /Not turned on: .*the public web/.test(lastBuildPrompt().prompt || "") && /"web"/.test(lastBuildPrompt().prompt || "") && /no "look it up online"/.test(lastBuildPrompt().prompt || ""));
  await mgr.post(`/api/runs/${a.run.id}/cancel`);

  // ---- 2. a request filed as "other" (no web kind then): the integration team turns the web on from it
  const q1 = await file("INTEGRATIONWEB can we fill the details in from the company's website");
  const ig = await waitFor("the request to be handed over", async () => { const x = (await board(mgr)).feedback.find((f) => f.id === q1.id); return x && x.anetix_kind === "integration" ? x : null; });
  t("setup: it is an integration request about something the platform did not name", ig.about_kind === "other", ig.about_kind);
  t("a manager cannot turn the web on", (await mgr.post(`/api/admin/requests/${q1.id}/turn-on`, { kind: "web" })).status === 403);
  t("another company's manager cannot either", (await otherMgr.post(`/api/admin/requests/${q1.id}/turn-on`, { kind: "web" })).status === 403);
  const turned = await admin.post(`/api/admin/requests/${q1.id}/turn-on`, { kind: "web" });
  t("the integration team turns the web on for that tool from the request", turned.status === 200 && turned.json.turned_on.includes("web"), turned.json);
  const rq = (await admin.get("/api/admin/requests?status=open")).json.requests.find((r) => r.id === q1.id);
  t("the request now reads as a web request, turned on", rq && rq.about_kind === "web" && rq.turned_on.includes("web"), rq && { kind: rq.about_kind, on: rq.turned_on });
  t("the record has it", rowsOf((await mgr.get("/api/c/demo/record?kind=connection_turned_on")).json).some((r) => /^Web/.test(r.after || "")));
  t("the Companies tab shows it on paperline only", await (async () => { const c = (await admin.get("/api/admin/overview")).json.companies.find((x) => x.slug === "demo"); return c.modules.find((m) => m.name === "paperline").outside_on.includes("web") && !c.modules.find((m) => m.name === "kpis").outside_on.includes("web"); })());

  // ---- 3. on: the change goes through, deploys, and the tool's own process can look something up
  const b = await build("ADDWEBALWAYS look the supplier up on its website");
  t("with it on, a change that declares a web connection passes the platform's checks", b.run.step === "await_deploy" && b.run.status === "waiting", b.run.log && b.run.log.slice(-3));
  t("and the builder was told it is on", /turned on for this tool: the public web/.test(lastBuildPrompt().prompt || ""));
  t("deploy", (await mgr.post(`/api/runs/${b.run.id}/deploy`)).status === 200);
  const live = (await admin.get("/api/c/demo/modules/paperline/export")).json.files;
  t("the live tool declares the web", JSON.parse(live["module.json"]).connections.web.kind === "web");

  const base = "/c/demo/m/paperline";
  const started = await floor.get(`${base}/api/fake-web/start?q=${encodeURIComponent("Who makes paper airplanes in Ohio?")}&url=${encodeURIComponent("https://example.com/about")}&json=1`);
  t("the tool starts a look-up and gets an id at once", started.status === 200 && started.json.id > 0 && started.json.status === "running", { status: started.status, body: started.text && started.text.slice(0, 300) });
  const res = await waitFor("the look-up to finish", async () => { const r = (await floor.get(`${base}/api/fake-web/result/${started.json.id}`)).json; return r && r.status !== "running" ? r : null; });
  t("the result comes back with an answer, its sources and the JSON asked for", res.status === "done" && /Fake-mode look-up/.test(res.answer) && res.sources.length === 1 && res.sources[0].url === "https://example.com/about" && res.data && res.data.fake === true, res);
  t("the answer names no model and no cost", !/model|cost|usd/i.test(Object.keys(res).join(",")) && !JSON.stringify(res).includes("claude"));
  const wp = prompts().filter((p) => p.kind === "web").slice(-1)[0] || {};
  t("the look-up went through the wall's choke point with the start page in the question", wp.company === "demo" && /Who makes paper airplanes in Ohio\?/.test(wp.prompt || "") && /https:\/\/example\.com\/about/.test(wp.prompt || "") && /```json/.test(wp.system || ""));
  t("a look-up of another tool's id is not found", (await floor.get(`${base}/api/fake-web/result/999999`)).status === 404);
  t("the record has the look-up", rowsOf((await mgr.get("/api/c/demo/record?kind=web_lookup")).json).length >= 1);
  const conns = (await mgr.get("/api/c/demo/connections")).json;
  const wc = (conns.modules.find((m) => m.module === "paperline") || { connections: [] }).connections.find((c) => c.kind === "web");
  t("the connections page shows the web as on, with the look-up", wc && wc.status === "connected" && wc.lookups.length >= 1 && wc.lookups[0].status === "done", wc);

  const failed = await floor.get(`${base}/api/fake-web/start?q=FAILWEB`);
  const fr = await waitFor("the failing look-up", async () => { const r = (await floor.get(`${base}/api/fake-web/result/${failed.json.id}`)).json; return r && r.status !== "running" ? r : null; });
  t("a look-up that fails says so in plain words, naming no vendor", fr.status === "failed" && fr.error === "the look-up did not finish; ask again", fr);
  t("an empty question is refused", (await floor.get(`${base}/api/fake-web/start?q=`)).status === 409);

  // ---- 4. off again: the tool keeps its declaration, but a look-up is refused
  t("the admin turns the web off", (await admin.post("/api/admin/companies/demo/outside", { module: "paperline", kind: "web", on: false })).json.turned_on.length === 0);
  const off = await floor.get(`${base}/api/fake-web/start?q=${encodeURIComponent("anything")}`);
  t("turned off, the tool's look-up is refused with a plain reason", off.status === 409 && /not turned on for this tool/.test(off.json.error), off.json);

  R.done();
})().catch((e) => { console.error(e); process.exit(1); });
