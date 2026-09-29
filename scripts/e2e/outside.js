// End to end: outside connections are off until Anetix turns them on, one tool at a time, and a request to connect one
// goes to Anetix's integration team (src/connections.js allowances, the module gate's connection-not-on rule,
// src/requests.js handoff, src/intake.js handoffs; 2026-09-28).
//
// Runs against a server that is ALREADY UP in fake-agent mode on a fresh database, with SOS_AUTO_FIX_ROUNDS=0 and a
// prompt log (the same file for the server and this script):
//   DATABASE_URL=postgres://sos:sos@127.0.0.1:5432/sos_e2e SOS_FAKE_AGENT=1 SOS_FAKE_DELAY_MS=300 PORT=3999 \
//   SOS_FLOOR_PASSWORD=floorpw SOS_MANAGER_PASSWORD=mgrpw SOS_ADMIN_PASSWORD=adminpw SESSION_SECRET=e2e \
//   SOS_CONNECTION_KEY=e2e-connection-key SOS_AUTO_FIX_ROUNDS=0 SOS_BROWSER=off SOS_PROMPT_LOG=/tmp/outside-prompts.jsonl node server.js &
//   SOS_PROMPT_LOG=/tmp/outside-prompts.jsonl node scripts/e2e/outside.js
const fs = require("fs");
const { PW, runner, login, waitFor, rowsOf, board, fbRow, proposalFor } = require("./lib");
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
  t("setup: Maria signs in on her tablet", (await floor.post("/api/c/demo/who/sign-in", { id: maria.person.id, pin: maria.pin })).status === 200);

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
  const allowed = async (slug = "demo") => (await admin.get("/api/admin/overview")).json.companies.find((c) => c.slug === slug);

  // ---- 1. nothing is on: a build that reaches for an ERP is stopped by the platform's own checks
  const a = await build("ADDERP track the late jobs from the scheduling system");
  t("a change that adds an ERP connection nobody turned on is stopped before it runs", a.run.status === "failed" && a.run.step === "cross_check" && a.run.evidence.gate && a.run.evidence.gate.ok === false, { status: a.run.status, step: a.run.step });
  const vio = (a.run.evidence.gate || {}).violations || [];
  t("the finding is the connection rule, in plain words", vio.length === 1 && vio[0].rule === "connection-not-on" && /"epicor", a connection to the company's ERP or scheduling system, which is not turned on for this tool/.test(vio[0].what), vio);
  t("the manager's card says why", /outside system that is not connected for this tool/.test(a.run.evidence.cross_check.summary));
  const bp = lastBuildPrompt();
  t("the builder was told up front that nothing outside is on", /Outside connections: none is turned on for this tool\./.test(bp.prompt || "") && /do NOT declare a connection of kind "erp" or "printer"/.test(bp.prompt || ""), (bp.prompt || "").slice(-1500));
  t("and that the ERP connection paperline already had stays as it is", /This tool already declares "labels" \(printer\), "erp" \(erp\) from before this rule: leave the declaration as it is/.test(bp.prompt || ""));
  t("the fix round takes it out and passes", (await mgr.post(`/api/runs/${a.run.id}/fix`)).status === 200);
  const a2 = await settle(a.run.id);
  t("after the fix the change reaches the gate without the connection", a2.step === "await_deploy" && a2.status === "waiting" && !((a2.evidence.gate || {}).violations || []).length, a2.log && a2.log.slice(-3));
  const fixPrompt = lastBuildPrompt();
  t("the fix round's brief named the connection rule", /connection to the company's ERP or scheduling system, which is not turned on for this tool/.test(fixPrompt.prompt || ""));
  await mgr.post(`/api/runs/${a2.id}/cancel`);

  // ---- 2. Anetix turns the ERP on for paperline: the same kind of change goes through
  t("a manager cannot turn a connection on", (await mgr.post("/api/admin/companies/demo/outside", { module: "paperline", kind: "erp", on: true })).status === 403);
  t("only an ERP or a printer can be turned on", (await admin.post("/api/admin/companies/demo/outside", { module: "paperline", kind: "scale", on: true })).status === 400);
  const on = await admin.post("/api/admin/companies/demo/outside", { module: "paperline", kind: "erp", on: true, system: "Epicor" });
  t("the admin turns the ERP on for paperline", on.status === 200 && on.json.turned_on.includes("erp"), on.json);
  const ov = await allowed();
  t("the Companies tab shows it on that tool only", ov.modules.find((m) => m.name === "paperline").outside_on.includes("erp") && !ov.modules.find((m) => m.name === "kpis").outside_on.length);
  const b = await build("ADDERPALWAYS track the late jobs from the scheduling system");
  t("with it on, a change that declares an ERP connection passes the platform's checks", b.run.step === "await_deploy" && b.run.status === "waiting", b.run.log && b.run.log.slice(-3));
  t("and the builder was told it is on", /Outside connections: turned on for this tool: the company's ERP or scheduling system\./.test(lastBuildPrompt().prompt || ""));
  t("deploy", (await mgr.post(`/api/runs/${b.run.id}/deploy`)).status === 200);
  const live = (await admin.get("/api/c/demo/modules/paperline/export")).json.files;
  t("the live tool declares the connection now", Boolean(JSON.parse(live["module.json"]).connections.epicor));
  t("the kpis tool is still held: an ERP there is refused", await (async () => {
    const k = await (async () => { const f = (await floor.post("/api/feedback", { company: "demo", module: "kpis", page: "/c/demo/m/kpis/", message: "ADDERPALWAYS track the weekly numbers from the scheduling system" })).json; const p = await proposalFor(mgr, f.id); return (await mgr.post(`/api/proposals/${p.id}/decide`, { decision: "approve" })).json.run; })();
    const x = await settle(k.id);
    await mgr.post(`/api/runs/${k.id}/cancel`);
    return x.status === "failed" && ((x.evidence.gate || {}).violations || []).some((v) => v.rule === "connection-not-on");
  })());

  // ---- 3. turned off again: what the tool already has stays (it was there before), nothing new may be added
  t("the admin turns it off", (await admin.post("/api/admin/companies/demo/outside", { module: "paperline", kind: "erp", on: false })).json.turned_on.length === 0);
  const c = await build("ADDERPALWAYS track the late jobs from the scheduling system again");
  t("a later change keeps the connection the tool already had without being stopped", c.run.step === "await_deploy" && c.run.status === "waiting", c.run.log && c.run.log.slice(-3));
  await mgr.post(`/api/runs/${c.run.id}/cancel`);

  // ---- 4. "how do I connect Epicor to this?" goes to the integration team, not to the build loop
  const q1 = await file("INTEGRATION how do i connect Epicor to this?");
  const ig = await waitFor("the request to be read", async () => { const b2 = await board(mgr); const x = b2.feedback.find((f) => f.id === q1.id); return x && x.arrival !== "proposing" ? x : null; });
  t("the request is handed to Anetix as an integration", ig.module === "platform" && ig.anetix_kind === "integration" && ig.about_module === "paperline" && ig.about_system === "Epicor" && ig.status === "new", { module: ig.module, kind: ig.anetix_kind, about: ig.about_module, sys: ig.about_system, status: ig.status });
  t("no proposal was drafted for it", !ig.proposal_id);
  const prop = prompts().filter((p) => p.kind === "structured:proposal").slice(-1)[0] || {};
  t("the proposer was told what is on for the tool", /Outside connections turned on for this tool: none\./.test(prop.prompt || "") && /- integration: it asks to connect this tool to an outside system/.test(prop.prompt || ""));
  const mine = (await floor.get("/api/c/demo/who/requests")).json.requests.find((r) => r.id === q1.id);
  t("Maria reads where it went, in plain words", mine && mine.to_anetix && mine.integration && mine.integration.system === "Epicor" && /^Sent to Anetix's integration team, who connect outside systems like your ERP or a label printer\. Nobody has looked yet\./.test(mine.line), mine);
  const reqs = (await admin.get("/api/admin/requests?status=open")).json.requests;
  const rq = reqs.find((r) => r.id === q1.id);
  t("it is on the Requests tab with the tool, the system and the switch state", rq && rq.anetix_kind === "integration" && rq.about_module === "paperline" && rq.about_title === "Paper Airplane Line" && rq.about_system === "Epicor" && rq.about_kind === "erp" && Array.isArray(rq.turned_on) && !rq.turned_on.length, rq);
  t("the record has the handoff", rowsOf((await mgr.get(`/api/c/demo/record?kind=handed_to_integration&feedback_id=${q1.id}`)).json).length === 1);
  t("a manager cannot turn it on from the request", (await mgr.post(`/api/admin/requests/${q1.id}/turn-on`, { kind: "erp" })).status === 403);
  const turned = await admin.post(`/api/admin/requests/${q1.id}/turn-on`, { kind: "erp" });
  t("the integration team turns the ERP on for that tool from the request", turned.status === 200 && turned.json.turned_on.includes("erp"));
  t("the tab shows it on", (await admin.get("/api/admin/requests?status=open")).json.requests.find((r) => r.id === q1.id).turned_on.includes("erp"));
  await admin.post(`/api/admin/requests/${q1.id}`, { stage: "working", note: "Setting up read access with your IT." });
  t("a word back reads as the integration team", /^Anetix's integration team is setting it up\. .* says: "Setting up read access with your IT\."/.test((await floor.get("/api/c/demo/who/requests")).json.requests.find((r) => r.id === q1.id).line));
  await admin.post(`/api/admin/requests/${q1.id}/close`, { answer: "fixed", what: "Epicor is connected to the paper airplane line." });
  t("closed: it reads as connected", /^Connected by Anetix\. Epicor is connected/.test((await floor.get("/api/c/demo/who/requests")).json.requests.find((r) => r.id === q1.id).line));

  // ---- 5. the manager says it is a change to the tool after all
  const q2 = await file("INTEGRATION make the Epicor refresh button bigger");
  await waitFor("the second request to be handed over", async () => { const x = (await board(mgr)).feedback.find((f) => f.id === q2.id); return x && x.anetix_kind === "integration"; });
  t("a floor device cannot send it back", (await floor.post(`/api/feedback/${q2.id}/to-tool`)).status === 403);
  t("another company's manager cannot reach it", (await otherMgr.post(`/api/feedback/${q2.id}/to-tool`)).status === 403);
  const back = await mgr.post(`/api/feedback/${q2.id}/to-tool`);
  t("the manager sends it back to the tool and a change is proposed", back.status === 200 && back.json.id && back.json.feedback_id === q2.id, back.json);
  const q2row = await fbRow(mgr, q2.id);
  t("it is a paperline request again, waiting on the manager", q2row.module === "paperline" && !q2row.anetix_kind && q2row.status === "reviewing", { module: q2row.module, kind: q2row.anetix_kind, status: q2row.status });

  // ---- 6. a new tool: an ERP the manager names is handed to the integration team, and the first version works without it
  const newTool = async (name, picks) => {
    const it = (await mgr.post("/api/c/demo/intakes", {})).json;
    const answerFor = (qn) => qn.id === "works_with" ? { picks, other: "", names: picks.includes("erp") ? { erp: "Epicor" } : {}, note: "" }
      : ({ text: qn.id === "name" ? name : "Check text for the intake", choice: { picks: [((qn.options || [])[0] || {}).id].filter(Boolean), other: "" }, roles: { floor: "6" }, devices: { floor: ["phone"] }, order: ["waiting", "in work", "shipped"], items: ["jobs ship late"], attach: { note: "" } }[qn.kind]);
    let view = it;
    for (let guard = 0; guard < 6 && ["answering", "thinking"].includes(view.status); guard++) {
      for (const qn of view.questions.filter((x) => view.missing.includes(x.id))) await mgr.post(`/api/intakes/${it.id}/answer`, { id: qn.id, value: answerFor(qn) });
      await mgr.post(`/api/intakes/${it.id}/next`, {});
      view = await waitFor("the intake to stop thinking", async () => { const v = (await mgr.get(`/api/intakes/${it.id}`)).json; return v.status !== "thinking" ? v : null; });
    }
    return view;
  };
  const v1 = await newTool("Late jobs", ["erp", "scanners"]);
  t("setup: the new tool reaches a design", v1.status === "design", v1.status);
  const d1 = v1.design;
  t("the design leaves the ERP out of its connections and hands it off", !(d1.connections || []).some((x) => x.kind === "erp") && (d1.handoffs || []).length === 1 && d1.handoffs[0].system === "Epicor" && d1.handoffs[0].kind === "erp", { conns: d1.connections, handoffs: d1.handoffs });
  t("the scanner stays (it reaches nothing outside)", (d1.connections || []).some((x) => x.kind === "scanners"));
  await mgr.post(`/api/intakes/${v1.id}/confirm`, {});
  const M1 = await waitFor("the new tool's build", async () => (await board(mgr)).runs.find((r) => r.lane === "module" && r.module === v1.slug));
  const handed = (await admin.get("/api/admin/requests?status=open")).json.requests.find((r) => r.about_module === v1.slug);
  t("confirming sends Epicor to the integration team, for this tool", handed && handed.anetix_kind === "integration" && handed.about_system === "Epicor" && handed.about_kind === "erp" && /^Connect Epicor to the new tool "Late jobs"/.test(handed.message), handed);
  const m1 = await settle(M1.id);
  t("the first version is built without it and reaches the gate", m1.step === "await_deploy" && m1.status === "waiting", m1.log && m1.log.slice(-3));
  const mp = prompts().filter((p) => p.kind === "agent" && /^NEW MODULE BUILD/m.test(p.prompt || "")).slice(-1)[0] || {};
  t("the builder was told Epicor is handed off, not connected", /Handed to Anetix's integration team, NOT connected in this version/.test(mp.prompt || "") && /Epicor \(erp\)/.test(mp.prompt || "") && /Outside connections: none is turned on for this tool/.test(mp.prompt || ""));
  const files1 = await waitFor("the staged tool", async () => (await mgr.get(`/c/demo/staging/m/${v1.slug}/`)).status === 200);
  t("setup: its preview opens", files1);

  // ---- 7. turned on ahead of the build: the design keeps it and the build may declare it
  const v2i = await newTool("Ship list", ["erp"]);
  // the slug is known once the name is answered; turn the ERP on for it, then have the design written again
  t("the admin can turn it on for a tool that does not exist yet", (await admin.post("/api/admin/companies/demo/outside", { module: v2i.slug, kind: "erp", on: true, system: "Epicor" })).status === 200);
  await mgr.post(`/api/intakes/${v2i.id}/adjust`, { text: v2i.design.reference_md });
  const v2 = await waitFor("the design written again", async () => { const v = (await mgr.get(`/api/intakes/${v2i.id}`)).json; return v.status === "design" ? v : null; });
  const d2 = v2.design || {};
  t("with it on, the design keeps the ERP as a connection", (d2.connections || []).some((x) => x.kind === "erp") && !(d2.handoffs || []).length, { conns: d2.connections, handoffs: d2.handoffs });
  await mgr.post(`/api/intakes/${v2i.id}/confirm`, {});
  const M2 = await waitFor("the second tool's build", async () => (await board(mgr)).runs.find((r) => r.lane === "module" && r.module === v2i.slug));
  const m2 = await settle(M2.id);
  t("its build declares the ERP and passes the platform's checks", m2.step === "await_deploy" && m2.status === "waiting", m2.log && m2.log.slice(-3));
  t("nothing was handed off for it", !(await admin.get("/api/admin/requests?status=open")).json.requests.some((r) => r.about_module === v2i.slug));

  // ---- 8. the backup carries the switches; a company's delete takes them
  const bk = (await admin.get("/api/admin/backup")).json;
  t("the backup carries what is turned on", ((bk.platform || {}).connection_allowances || []).some((r) => r.company === "demo" && r.module === v2i.slug && r.kind === "erp"));

  R.done();
})().catch(R.abort);
