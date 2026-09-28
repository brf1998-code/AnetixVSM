// End to end: the data wall (src/datawall.js, docs/DATA-WALL.md). The canary: a marker string is seeded into every
// kind of company data (rows on the floor, a spreadsheet upload, a pointed-at element, an intake's spreadsheet,
// a migration's starting rows), every flow that calls a model runs with the wall up, and no prompt may carry the
// marker; then the wall comes down and the same flows do carry it, which is what proves the test bites. Same
// server as closeout.js (fake agent, passwords on, FRESH database) started with SOS_PROMPT_LOG set to the file
// this script reads:
//   SOS_PROMPT_LOG=/tmp/sos-prompts.jsonl node server.js ...;  SOS_PROMPT_LOG=/tmp/sos-prompts.jsonl node scripts/e2e/datawall.js
const fs = require("fs");
const { PW, runner, login, waitFor, rowsOf, board, proposalFor, ship } = require("./lib");
const R = runner(), t = R.t;
const LOG = process.env.SOS_PROMPT_LOG || "/tmp/sos-prompts.jsonl";
const CANARY = "CANARY7731";
const PAGE = "/c/demo/m/paperline/";

(async () => {
  const admin = await login(PW.admin, ""), mgr = await login(PW.manager, "demo"), floor = await login(PW.floor, "demo");
  const file = async (msg, extra) => (await floor.post("/api/feedback", { company: "demo", module: "paperline", page: PAGE, message: msg, ...(extra || {}) })).json;
  const runOf = async (id) => (await board(mgr)).runs.find((r) => r.id === id);
  const settle = async (runId) => waitFor(`run ${runId} to settle`, async () => { const x = await runOf(runId); if (x && x.step === "confirm_requirement" && x.status === "waiting") { await mgr.post(`/api/runs/${runId}/confirm`, {}); return null; } if (x && x.step === "campaign" && x.status === "waiting") { await mgr.post(`/api/runs/${runId}/campaign/skip`, { reason: "e2e" }); return null; } return x && (x.status === "failed" || (x.step === "await_deploy" && x.status === "waiting")) ? x : null; }, 90000);
  const prompts = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  const since = (n) => prompts().slice(n);
  const carries = (list) => list.filter((p) => JSON.stringify(p).includes(CANARY));
  const kinds = async (k) => rowsOf((await mgr.get(`/api/c/demo/record?kind=${k}`)).json);
  const csv = (rows) => Buffer.from(rows.map((r) => r.join(",")).join("\n")).toString("base64");
  const intakeTo = async (label, attachRows) => {
    const it = (await mgr.post("/api/c/demo/intakes", {})).json;
    const answerFor = (qn) => ({ text: qn.id === "name" ? label : "Text for the intake", choice: { picks: [((qn.options || [])[0] || {}).id].filter(Boolean), other: "" }, roles: { floor: "6" }, devices: { floor: ["phone"] }, order: ["waiting", "checked out", "back on the shelf"], items: ["tools go missing"], attach: { note: "" } }[qn.kind]);
    let view = it, attached = false;
    for (let guard = 0; guard < 6 && ["answering", "thinking"].includes(view.status); guard++) {
      for (const qn of view.questions) {
        if (view.missing.includes(qn.id)) await mgr.post(`/api/intakes/${it.id}/answer`, { id: qn.id, value: answerFor(qn) });
        if (!attached && qn.kind === "attach" && attachRows) { const a = await mgr.post(`/api/intakes/${it.id}/attach`, { question_id: qn.id, filename: "list.csv", mime: "text/csv", data: csv(attachRows) }); attached = a.status === 200; if (!attached) console.log("attach failed:", a.text.slice(0, 200)); }
      }
      await mgr.post(`/api/intakes/${it.id}/next`, {});
      view = await waitFor("the intake to stop thinking", async () => { const v = (await mgr.get(`/api/intakes/${it.id}`)).json; return v.status !== "thinking" ? v : null; });
    }
    if (view.status !== "design") throw new Error(`the intake did not reach a design: ${view.status} ${view.error || ""}`);
    await mgr.post(`/api/intakes/${it.id}/confirm`, {});
    const run = await waitFor("the module build to start", async () => (await board(mgr)).runs.find((r) => r.lane === "module" && r.status !== "deployed" && r.status !== "cancelled"));
    const g = await settle(run.id);
    if (g.status === "failed") throw new Error(`the module build failed: ${((g.log || []).filter((l) => l.step === "error").slice(-1)[0] || {}).note}`);
    await mgr.post(`/api/runs/${run.id}/deploy`);
    await waitFor("the module live", async () => (await runOf(run.id)).status === "deployed");
    return { intake: it, run: await runOf(run.id), slug: view.slug, attached };
  };

  // ---- setup, wall down: a module whose migration carries the marker as starting rows
  t("setup: the prompt log is on (SOS_PROMPT_LOG)", fs.existsSync(LOG) || prompts().length === 0);
  const before = prompts().length;
  const built = await intakeTo("Crib list", [["name", "shelf"], [`${CANARY} caliper`, "A1"], ["Torque wrench", "A2"]]);
  t("setup: a module built from an intake with a spreadsheet, the wall down", built.run.status === "deployed" && built.attached && built.slug, built);
  const seedFiles = (await admin.get(`/api/c/demo/modules/${built.slug}/export`)).json.files;
  t("setup: its first migration carries the marker as starting rows (the wall was down)", /INSERT/.test(seedFiles["migrations/001.sql"]) && seedFiles["migrations/001.sql"].includes(CANARY));
  t("setup: with the wall down the intake's rows reached a prompt", carries(since(before)).length > 0);

  // ---- seed the marker into the rest of the company's data
  const req = await floor.post(PAGE.replace(/\/$/, "") + "/api/requests", { station_id: null, item: "paper_white", requested_by: CANARY });
  t("setup: a row on the floor carries the marker", req.status === 200);
  const up = await mgr.post("/api/c/demo/connections/paperline/stock/upload", { filename: "stock.csv", mime: "text/csv", data: csv([["item", "location", "qty"], [`${CANARY}_sheet`, "stockroom", "4"]]) });
  t("setup: a spreadsheet upload carries the marker", up.status === 200 && up.json.upload_id, up.json);

  // ---- the wall goes up
  const w = await admin.post("/api/admin/companies/demo/data-wall", { walled: true });
  t("the admin walls the company off", w.status === 200 && w.json.walled === true && w.json.ai_reads_data === false, w.json);
  t("a manager cannot", (await mgr.post("/api/admin/companies/demo/data-wall", { walled: false })).status === 403);
  t("the overview says so", (await admin.get("/api/admin/overview")).json.companies.find((c) => c.slug === "demo").walled === true);
  t("it is on the record", (await kinds("datawall_on")).length === 1);
  t("photos are off for the floor while walled", (await floor.get("/api/c/demo/who")).json.photos === false && (await mgr.get("/api/c/demo/settings-view")).json.company.ai_reads_data === false);
  const mark = prompts().length;

  // ---- every flow, wall up: a proposal with a pointed-at element, a change build with a fix round, a review, diagrams, a campaign, an intake with a sheet, Jonah
  const fb1 = await file(`make the crib label bigger ${CANARY}-words-are-fine`, { element: { tag: "td", id: "cell-9", classes: ["qty"], text: `${CANARY} on the screen`, label: `${CANARY} label`, html: `<td>${CANARY}</td>`, path: "table > tr > td", rect: { x: 1, y: 2, w: 3, h: 4, vw: 100, vh: 100 } } });
  const p1 = await proposalFor(mgr, fb1.id, "demo");
  t("a proposal was drafted with the wall up", p1 && p1.id);
  const photo = await file("a photo of it", { photo: { mime: "image/jpeg", data: Buffer.from("not really a jpeg").toString("base64") } });
  t("a photo with a request is refused while walled, the words go through", photo.id && /switched off/.test(photo.photo_note || photo.photo || ""), { note: photo.photo_note, keys: Object.keys(photo) });
  // a change build on the module whose migration carries the marker: the agent's folder is withheld, the file restored
  const fb2 = (await floor.post("/api/feedback", { company: "demo", module: built.slug, page: `/c/demo/m/${built.slug}/`, message: "make the list text bigger" })).json;
  const p2 = await proposalFor(mgr, fb2.id, "demo");
  const r2 = (await mgr.post(`/api/proposals/${p2.id}/decide`, { decision: "approve" })).json;
  const g2 = await settle((r2.run || r2).id);
  t("a change build on that module reaches the gate with the wall noted on it", g2.step === "await_deploy" && g2.evidence.walled === true, g2.evidence);
  t("the run log says the starting rows were withheld from the agent", /starting rows withheld from migrations\/001\.sql/.test((g2.log || []).map((l) => l.note).join("\n")));
  await mgr.post(`/api/runs/${g2.id}/deploy`);
  await waitFor("the change live", async () => (await runOf(g2.id)).status === "deployed");
  const after = (await admin.get(`/api/c/demo/modules/${built.slug}/export`)).json.files;
  t("after the build the migration still carries its rows byte for byte (restored)", after["migrations/001.sql"] === seedFiles["migrations/001.sql"]);
  await waitFor("diagrams for the new version", async () => prompts().slice(mark).some((p) => /diagrams/.test(p.kind) && p.company === "demo" && JSON.stringify(p).includes(built.slug)), 30000).catch(() => {});
  // a fix round after a broken promise: the findings go back to the agent with no value quoted
  const fb3 = await file("group the travelers by fold type on the server BREAKPROMISE");
  const p3 = await proposalFor(mgr, fb3.id, "demo");
  const r3 = (await mgr.post(`/api/proposals/${p3.id}/decide`, { decision: "approve" })).json;
  const f3 = await settle((r3.run || r3).id);
  t("a broken promise stops the build as usual", f3.status === "failed" && f3.evidence.checks && f3.evidence.checks.walled === true, f3.evidence.checks && f3.evidence.checks.kind);
  await mgr.post(`/api/runs/${f3.id}/fix`);
  const fixed = await settle(f3.id);
  t("the fix round gets the findings, and the findings quote no value from the answer", fixed.step === "await_deploy" && /^checks$/.test(fixed.evidence.findings_from) && !fixed.evidence.findings.includes(CANARY), { from: fixed.evidence.findings_from, findings: (fixed.evidence.findings || "").slice(0, 300) });
  await mgr.post(`/api/runs/${f3.id}/cancel`);
  // a whole-tool review and a campaign on the test floor
  const rv = await mgr.post("/api/c/demo/reviews", { module: "paperline" });
  t("a review runs", rv.status === 200, rv.text);
  await waitFor("the review to finish", async () => { const l = (await mgr.get("/api/c/demo/reviews")).json; const list = l.reviews || l; return list.some((x) => x.module === "paperline" && x.status !== "running"); }, 60000);
  await admin.post("/api/admin/companies/demo/test-floor", { on: true });
  const fb4 = await file("make the legend text darker");
  const p4 = await proposalFor(mgr, fb4.id, "demo");
  const r4 = (await mgr.post(`/api/proposals/${p4.id}/decide`, { decision: "approve" })).json;
  const c4 = await waitFor("a campaign proposed", async () => { const x = await runOf((r4.run || r4).id); return x && x.step === "campaign" && x.status === "waiting" ? x : null; }, 60000);
  t("a campaign was proposed with the wall up", c4.evidence.campaign_id > 0);
  await mgr.post(`/api/runs/${c4.id}/campaign/skip`, { reason: "e2e" });
  await mgr.post(`/api/runs/${c4.id}/cancel`);
  await admin.post("/api/admin/companies/demo/test-floor", { on: false });
  // an intake with a spreadsheet, walled: the rows never reach a prompt, the module seeds nothing, the platform loads the list after the deploy
  const walledBuild = await intakeTo("Gauge list", [["name", "shelf"], [`${CANARY} gauge`, "B1"], ["Depth gauge", "B2"]]);
  const wf = (await admin.get(`/api/c/demo/modules/${walledBuild.slug}/export`)).json.files;
  t("walled: the new module's migration seeds no rows and declares the starting list as a connection", !/INSERT/i.test(wf["migrations/001.sql"]) && /"starting"/.test(wf["module.json"]) && /"kind": "files"/.test(wf["module.json"]), wf["module.json"]);
  const items = (await mgr.get(`/c/demo/m/${walledBuild.slug}/api/items`)).json;
  t("walled: the platform loaded the starting list into the tool after the deploy", items && items.items && items.items.some((i) => i.name === `${CANARY} gauge`) && items.items.length === 2, items);
  t("walled: the run log says the platform loaded it and the AI never saw a row", /the platform loaded the starting list .* never saw a row/.test(((await runOf(walledBuild.run.id)).log || []).map((l) => l.note).join("\n")));
  t("walled: on the record", (await kinds("starting_rows_loaded")).length === 1);
  // Jonah
  const jonah = await mgr.post("/c/demo/m/kpis/api/chats", { message: "what is the constraint this week?" });
  t("Jonah does not answer while walled, in plain words", jonah.status >= 400 && /switched off/.test(jonah.text), jonah.text.slice(0, 200));

  // ---- the proof: no prompt sent since the wall went up carries the marker
  const sent = since(mark);
  const bad = carries(sent);
  t("every flow sent prompts while walled", sent.length >= 8 && sent.every((p) => p.company !== "demo" || p.walled === true), sent.map((p) => [p.kind, p.walled]));
  t("the flows covered: a proposal, a build, a fix round, a review, diagrams, a campaign, an intake, a design, a module build", ["structured:proposal", "agent", "structured:review", "structured:diagrams", "structured:campaign", "structured:intake_round", "structured:module_design"].every((k) => sent.some((p) => p.kind === k || (k === "agent" && p.kind === "agent"))), [...new Set(sent.map((p) => p.kind))]);
  t("NO prompt carried the marker while the wall was up (the words typed with a request do, by decision, and are the one thing allowed)", bad.filter((p) => !JSON.stringify(p).includes(`${CANARY}-words-are-fine`) || JSON.stringify(p).replace(new RegExp(`${CANARY}-words-are-fine`, "g"), "").includes(CANARY)).length === 0, bad.map((p) => [p.kind, JSON.stringify(p).indexOf(CANARY)]));
  t("no image or document block went out while walled", sent.every((p) => !(p.blocks || []).some((b) => /^<(image|document)>$/.test(b))));
  t("the element's place went to the proposer, not what it showed", sent.some((p) => p.kind === "structured:proposal" && /POINTED at one thing.*<td id="cell-9"/.test(p.prompt) && !/showing "/.test(p.prompt)), sent.filter((p) => p.kind === "structured:proposal").map((p) => (p.prompt.match(/POINTED[^\n]*/) || [])[0]));

  // ---- the wall comes down: the same marker now reaches a prompt, so the test above bites
  const down = await admin.post("/api/admin/companies/demo/data-wall", { walled: false });
  t("the admin lets the AI read the data again", down.status === 200 && down.json.walled === false && (await kinds("datawall_off")).length === 1);
  const mark2 = prompts().length;
  const fb5 = (await floor.post("/api/feedback", { company: "demo", module: built.slug, page: `/c/demo/m/${built.slug}/`, message: "make the shelf column wider" })).json;
  await proposalFor(mgr, fb5.id, "demo");
  const open = since(mark2);
  t("with the wall down the proposer reads the migration's rows again", carries(open).some((p) => p.kind === "structured:proposal" && p.walled === false), open.map((p) => [p.kind, p.walled]));
  t("photos are back", (await floor.get("/api/c/demo/who")).json.photos === true);
  const jonah2 = await mgr.post("/c/demo/m/kpis/api/chats", { message: "what is the constraint this week?" });
  t("Jonah answers again", jonah2.status === 200, jonah2.text.slice(0, 120));

  R.done();
})().catch(R.abort);
