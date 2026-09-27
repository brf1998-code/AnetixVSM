// End to end for the launch audit's Phase 1 (2026-09-27) on the server side: one new-tool request at a time (1.5),
// the tool wording (1.6), what a restart leaves behind (1.13), the fence on builds a newer process took over (1.13),
// the phone alerts (1.15), a hung tool process (1.16), trials off a demo's credit (1.17), Settings without the agent
// settings (1.18), a demo's diagrams only when asked (1.19), and a demo's build that stopped before a preview (1.20).
// Against a server ALREADY UP in fake-agent mode on a FRESH database (run-all.sh does it). Some checks call the
// platform's own modules from this process, on the same database, where a route would need a second service.
//   node scripts/e2e/phase1.js
const http = require("http");
const os = require("os");
const path = require("path");
const fs = require("fs");
const { PW, runner, login, waitFor, board, fbRow, proposalFor, ship, client } = require("./lib");
const { q } = require("../../src/db");
const R = runner(), t = R.t;
const PAGE = "/c/demo/m/paperline/";
const notified = async (title) => (await q("SELECT detail FROM platform.events WHERE kind='notified' AND detail->>'title' = $1 ORDER BY id", [title])).rows.map((r) => r.detail);
const MODEL_IDS = require("../../src/agent").MODELS.map((m) => m.id);

(async () => {
  const admin = await login(PW.admin), mgr = await login(PW.manager, "demo"), floor = await login(PW.floor, "demo");

  // ---- 1.18: Settings reads its own view; the agent settings are Anetix's -------------------------------------------
  const sv = await mgr.get("/api/c/demo/settings-view");
  t("Settings has its own view for a manager", sv.status === 200 && sv.json.company && sv.json.company.slug === "demo" && Array.isArray(sv.json.modules), sv.text.slice(0, 200));
  t("and it names no model", !MODEL_IDS.some((m) => sv.text.includes(m)) && !/fable|opus|sonnet|haiku/i.test(sv.text), sv.text.slice(0, 300));
  t("the agent settings answer a manager 403", (await mgr.get("/api/c/demo/agents")).status === 403 && (await mgr.post("/api/c/demo/agents/models", {})).status === 403);
  t("and an admin 200", (await admin.get("/api/c/demo/agents")).status === 200);

  // ---- 1.5 and 1.6: one new-tool request at a time, in tool words -----------------------------------------------------
  const i1 = (await mgr.post("/api/c/demo/intakes", {})).json;
  const i2 = (await mgr.post("/api/c/demo/intakes", {})).json;
  t("New tool twice opens the same request again", i1.id && i2.id === i1.id && i2.reopened === true && !i1.reopened, [i1.id, i2.id, i2.reopened]);
  const card = (await board(mgr)).feedback.find((f) => f.intake_id === i1.id);
  t("its card is the company's own (no tool yet) and says tool", card && card.kind === "module_request" && card.module == null && card.screen === "New tool request" && card.message === "New tool", card);
  await mgr.post(`/api/intakes/${i1.id}/answer`, { id: "name", value: "Scrap Tally" });
  t("once named, the card is New tool: <name>", (await fbRow(mgr, card.id)).message === "New tool: Scrap Tally");
  await mgr.post(`/api/intakes/${i1.id}/abandon`, {});
  const i3 = (await mgr.post("/api/c/demo/intakes", {})).json;
  t("after it is withdrawn, New tool starts a new one", i3.id && i3.id !== i1.id && !i3.reopened, i3);
  t("the withdrawn one says so in tool words", /^Tool request withdrawn\.$/.test((await fbRow(mgr, card.id)).outcome || ""));

  // ---- 1.13: what a restart leaves behind ---------------------------------------------------------------------------
  const design = { bluf: "e2e", items: [], reference_md: "# e2e" };
  const iDesign = (await q("INSERT INTO platform.module_intakes (company, feedback_id, status, design, answers) VALUES ('demo', NULL, 'thinking', $1, '{}') RETURNING id", [JSON.stringify(design)])).rows[0].id;
  await q("UPDATE platform.module_intakes SET status='thinking' WHERE id=$1", [i3.id]);
  const rv = (await q("INSERT INTO platform.reviews (company, module, model, version, status) VALUES ('demo', 'paperline', 'e2e', 1, 'running') RETURNING id")).rows[0].id;
  const dg = (await q("INSERT INTO platform.diagrams (company, module, version, model, status) VALUES ('demo', 'paperline', 99, 'e2e', 'running') RETURNING id")).rows[0].id;
  await q("UPDATE platform.companies SET brand = jsonb_build_object('status','building','url','https://example.com') WHERE slug='demo'");
  const swept = await require("../../src/restart").sweep();
  t("the sweep counts what it found", swept.intakes === 1 && swept.intakes_redo === 1 && swept.reviews === 1 && swept.diagrams === 1 && swept.brands === 1, swept);
  const it3 = (await q("SELECT status, error FROM platform.module_intakes WHERE id=$1", [i3.id])).rows[0];
  t("a request the AI was reading is failed, with words the tile shows", it3.status === "failed" && /restarted while the AI was reading the answers/.test(it3.error), it3);
  const itD = (await q("SELECT status, error FROM platform.module_intakes WHERE id=$1", [iDesign])).rows[0];
  t("one redoing its design goes back to that design, saying the edit was not applied", itD.status === "design" && /edit was not applied/.test(itD.error), itD);
  t("a review, diagrams and a brand guide are failed, not running for ever",
    (await q("SELECT status FROM platform.reviews WHERE id=$1", [rv])).rows[0].status === "failed"
    && (await q("SELECT status FROM platform.diagrams WHERE id=$1", [dg])).rows[0].status === "failed"
    && (await q("SELECT brand->>'status' AS s FROM platform.companies WHERE slug='demo'")).rows[0].s === "failed");
  t("a failed request can be sent again", (await mgr.get(`/api/intakes/${i3.id}`)).json.status === "failed");
  await mgr.post(`/api/intakes/${i3.id}/abandon`, {});
  t("the sweep a second time finds nothing", Object.values(await require("../../src/restart").sweep()).every((n) => n === 0));

  // ---- 1.20: a demo's build that stops before a preview -------------------------------------------------------------
  await q("UPDATE platform.companies SET demo=true WHERE slug='demo'");
  const ss = require("../../src/selfserve");
  await ss.addCredit({ slug: "demo", credit_usd: 30, kind: "grant", note: "e2e", by: "e2e" });
  const before = (await board(admin)).credit;   // the dollars: an admin's copy (src/companyview.js)
  t("the demo runs on credit", before && Math.abs(before.balance_usd - 30) < 0.01, before);
  const fid = (await floor.post("/api/feedback", { company: "demo", module: "paperline", page: PAGE, message: "count the scrapped sheets per shift FAILBUILD" })).json.id;
  const prop = await proposalFor(mgr, fid);
  const started = (await mgr.post(`/api/proposals/${prop.id}/decide`, { decision: "approve" })).json;
  const runId = (started.run || started).id;
  const settle = () => waitFor(`run ${runId} to stop`, async () => {
    const x = (await board(mgr)).runs.find((r) => r.id === runId);
    if (x && x.step === "confirm_requirement" && x.status === "waiting") { await mgr.post(`/api/runs/${runId}/confirm`, {}); return null; }
    return x && x.status === "failed" ? x : null;
  }, 60000);
  const stopped = await settle();
  t("the build stopped while building, before a preview", stopped.step === "build" && /FAILBUILD/.test(JSON.stringify(stopped.log)), stopped.step);
  const stops1 = await waitFor("the stop on the list", async () => { const r = (await q("SELECT * FROM platform.demo_stops WHERE run_id=$1", [runId])).rows; return r.length ? r : null; });
  t("it is on the list of stops, open", stops1.length === 1 && !stops1[0].addressed_at && stops1[0].step === "build" && Number(stops1[0].refunded_usd) === 0.42, stops1);
  const ledger = (await q("SELECT delta_usd, kind, note FROM platform.credit_ledger WHERE company='demo' AND kind='adjust' ORDER BY id")).rows;
  t("what it spent went back to the credit as an adjust row", ledger.length === 1 && Number(ledger[0].delta_usd) === 0.42 && new RegExp(`run #${runId}`).test(ledger[0].note), ledger);
  const after1 = (await board(admin)).credit;
  t("so the demo's balance is where it was", Math.abs(after1.balance_usd - before.balance_usd) < 0.01, [before.balance_usd, after1.balance_usd]);
  const r1 = (await board(admin)).runs.find((r) => r.id === runId);
  t("the run remembers what was handed back", Number(r1.evidence.refunded_usd) === 0.42, r1.evidence);
  // the manager reads only that it was handed back (src/companyview.js, Phase 2's first item)
  const m1 = (await board(mgr)).runs.find((r) => r.id === runId);
  t("and the manager's copy says so without the figure", m1.evidence.refunded === true && m1.evidence.refunded_usd === undefined, m1.evidence);
  const alert1 = await waitFor("the phone alert", async () => { const a = await notified("A demo build stopped: Demo Company"); return a.length ? a : null; }, 5000).catch(() => []);
  t("Anetix's phones heard, with the dollars and without the error line", alert1.length === 1 && /\$0\.42 handed back/.test(alert1[0].message) && !/FAILBUILD/.test(alert1[0].message), alert1);
  // the same run stops again: only what it spent since goes back
  await mgr.post(`/api/runs/${runId}/retry`, {});
  await waitFor("the retry to start", async () => { const x = (await board(mgr)).runs.find((r) => r.id === runId); return x && x.status !== "failed" ? x : null; }, 20000).catch(() => null);
  await settle();
  const stops2 = await waitFor("the second stop", async () => { const r = (await q("SELECT * FROM platform.demo_stops WHERE run_id=$1 ORDER BY id", [runId])).rows; return r.length === 2 ? r : null; });
  const ledger2 = (await q("SELECT delta_usd FROM platform.credit_ledger WHERE company='demo' AND kind='adjust' ORDER BY id")).rows.map((r) => Number(r.delta_usd));
  t("a second stop of the same run hands back only its own spend, once", Number(stops2[1].refunded_usd) === 0.42 && ledger2.length === 2 && ledger2[1] === 0.42, ledger2);
  const list = await admin.get("/api/admin/demo-stops");
  t("the admin sees both open", list.status === 200 && list.json.open.length === 2 && list.json.open[0].company_name === "Demo Company", list.json);
  t("a manager cannot read the list", (await mgr.get("/api/admin/demo-stops")).status === 403);
  t("addressed needs a few words", (await admin.post(`/api/admin/demo-stops/${stops2[0].id}/addressed`, { note: "" })).status === 400);
  const done = await admin.post(`/api/admin/demo-stops/${stops2[0].id}/addressed`, { note: "the fake agent was told to stop; nothing to fix" });
  const left = (await admin.get("/api/admin/demo-stops")).json;
  t("and closes it", done.status === 200 && left.open.length === 1 && left.addressed.length === 1 && left.addressed[0].addressed_by, [done.status, done.text, left]);
  t("twice is refused", (await admin.post(`/api/admin/demo-stops/${stops2[0].id}/addressed`, { note: "again please" })).status === 404);
  t("the Demos tab carries the stops", ((await admin.get("/api/admin/demos")).json.stops || {}).open.length === 1);
  await mgr.post(`/api/runs/${runId}/cancel`, {});

  // ---- 1.17: Anetix's model trials never come off a demo's credit ---------------------------------------------------
  const b0 = (await board(admin)).credit.balance_usd;
  await q("INSERT INTO platform.ai_usage (company, module, kind, model, cost_usd, detail) VALUES ('demo', 'paperline', 'assess', 'e2e', 5, '{}')");
  t("a trial's spend under the demo leaves its credit alone", Math.abs((await board(admin)).credit.balance_usd - b0) < 0.01);
  t("and its own budget", (await require("../../src/agent").monthlySpend("demo")).usd < 5);

  // ---- 1.19: a demo's diagrams are drawn when asked -------------------------------------------------------------------
  const f2 = (await floor.post("/api/feedback", { company: "demo", module: "paperline", page: PAGE, message: "make the shift clock text bigger" })).json.id;
  const { runId: shipped } = await ship(mgr, [f2]);
  const live = (await q("SELECT live_version FROM platform.modules WHERE company='demo' AND name='paperline'")).rows[0].live_version;
  await new Promise((r) => setTimeout(r, 1500));
  t("a deploy on a demo draws no diagrams", (await q("SELECT count(*)::int AS n FROM platform.diagrams WHERE company='demo' AND module='paperline' AND version=$1", [live])).rows[0].n === 0, shipped);
  const dview = await mgr.get("/api/c/demo/diagrams/paperline");
  t("the diagrams page knows it is a demo", dview.status === 200 && dview.json.demo === true && !(dview.json.versions || []).includes(live), dview.json.versions);
  t("drawn when the manager asks", (await mgr.post("/api/c/demo/diagrams/paperline/regenerate", {})).status === 200);
  const drawn = (await mgr.get("/api/c/demo/diagrams/paperline")).json.current;
  t("and the manager's view names no model and no cost", drawn && drawn.model === undefined && drawn.cost_usd === undefined, drawn && Object.keys(drawn));
  const adminDrawn = (await admin.get("/api/c/demo/diagrams/paperline")).json.current;
  t("the admin's still does", adminDrawn && adminDrawn.model !== undefined && adminDrawn.cost_usd !== undefined);

  // ---- 1.13: the fence ----------------------------------------------------------------------------------------------
  const P = require("../../src/pipeline");
  await q("UPDATE platform.build_runs SET fence=$2 WHERE id=$1", [runId, P.FENCE + 60000]);
  const refused = await P.setRun(runId, { model: "e2e" }).then(() => null, (e) => e);
  const refusedLog = await P.log(runId, { step: "e2e", note: "should not land" }).then(() => null, (e) => e);
  t("an older process may not write to a run a newer one took over", refused && refused.fenced && refusedLog && refusedLog.fenced, refused && refused.message);
  t("and nothing it wrote landed", !(await q("SELECT log::text AS l FROM platform.build_runs WHERE id=$1", [runId])).rows[0].l.includes("should not land"));
  await q("UPDATE platform.build_runs SET fence=$2 WHERE id=$1", [runId, P.FENCE - 60000]);
  t("a newer process may", (await P.setRun(runId, { model: null }).then(() => true, () => false)));
  await q("UPDATE platform.build_runs SET fence=NULL WHERE id=$1", [runId]);
  t("a fenced error answers as a restart, not a product error", require("../../src/errors").classify({ fenced: true }).status === 503);
  // the late sweep: a run an older process left running is taken over; one a newer process drives is left alone
  const ins = async (fence) => (await q("INSERT INTO platform.build_runs (proposal_id, company, module, lane, step, status, fence) VALUES ($1,'demo','paperline','functionality','confirm_requirement','running',$2) RETURNING id", [prop.id, fence])).rows[0].id;
  const oldRun = await ins(1), newRun = await ins(P.FENCE + 60000);
  const swept2 = await P.sweepOrphans();
  const rowOf = async (id) => (await q("SELECT status, fence FROM platform.build_runs WHERE id=$1", [id])).rows[0];
  const o = await rowOf(oldRun), nw = await rowOf(newRun);
  t("the late sweep takes over what an older process left running, and only that", swept2 === 1 && o.status === "failed" && Number(o.fence) === P.FENCE && nw.status === "running", { swept2, o, nw });
  await q("UPDATE platform.build_runs SET status='cancelled' WHERE id=$1", [newRun]);
  t("a run this process sets running carries its stamp", await P.setRun(oldRun, { status: "running" }).then(async () => Number((await rowOf(oldRun)).fence) === P.FENCE));
  await q("UPDATE platform.build_runs SET status='cancelled' WHERE id=$1", [oldRun]);

  // ---- 1.15: the phone alerts ---------------------------------------------------------------------------------------
  await floor.post("/api/feedback", { company: "demo", module: "platform", page: "/c/demo/", screen: "Improvement board", message: "the board font is too small SECRETWORDS" });
  const toAnetix = await waitFor("the request alert", async () => { const a = await notified("Request to Anetix"); return a.length ? a : null; }, 5000).catch(() => []);
  t("a request to Anetix buzzes, with the company and the screen and never the words", toAnetix.length === 1 && /Demo Company, on Improvement board/.test(toAnetix[0].message) && !/SECRETWORDS/.test(toAnetix[0].message), toAnetix);
  await floor.post("/api/feedback", { company: "demo", module: "platform", page: "/c/demo/", screen: "Improvement board", message: "another one" });
  await new Promise((r) => setTimeout(r, 600));
  t("a second one inside ten minutes waits for the next alert", (await notified("Request to Anetix")).length === 1);
  await require("../../src/demorequests").create({ name: "Pat Example", email: "pat@example.com", company: "Example Castings", wants: "pin", size: require("../../src/demorequests").SIZES[0] }, "127.0.0.1");
  const dr = await waitFor("the demo request alert", async () => { const a = await notified("Demo request"); return a.length ? a : null; }, 5000).catch(() => []);
  t("a demo request buzzes with the company, not the person", dr.length === 1 && /Example Castings/.test(dr[0].message) && !/Pat|pat@/.test(dr[0].message), dr);
  await require("../../src/credit").noteFailure("Your credit balance is too low to access the Anthropic API", "e2e");
  const ai = await waitFor("the AI alert", async () => { const a = await notified("The AI service is refusing work"); return a.length ? a : null; }, 5000).catch(() => []);
  t("the AI service refusing buzzes, loudly", ai.length === 1, ai);
  const acc = require("../../src/accounts");
  await acc.create({ login: "lockme@e2e.test", display_name: "Lock Me", role: "manager", company: "demo", password: "a-long-e2e-password-1" }, "e2e", null);
  for (let i = 0; i < acc.MAX_FAILS; i++) await client().post("/login", { name: "lockme@e2e.test", password: "wrong-password-" + i });
  const lock = await waitFor("the lock alert", async () => { const a = await notified("An account was locked"); return a.length ? a : null; }, 5000).catch(() => []);
  t("a locked account buzzes, without the address", lock.length === 1 && /A manager account of demo was locked/.test(lock[0].message) && !/lockme/.test(lock[0].message), lock);

  // ---- 1.16: a tool process whose requests keep timing out is restarted ---------------------------------------------
  const runner = require("../../src/runner");
  const sock = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "e2e-hang-")), "s.sock");
  const pinger = http.createServer((_req, res) => res.end("ok")); await new Promise((r) => pinger.listen(sock, r));
  let kills = 0;
  const rec = { company: "demo", lane: "live", sock, token: "x", loaded: new Map([["paperline", {}]]), proc: { kill: () => { kills++; } }, dead: false };
  const reqOf = { method: "GET", url: "/api/jobs/12?x=1" }, report = { method: "GET", url: "/api/report" };
  for (let i = 0; i < runner.HANG_LIMIT + 1; i++) runner.timedOut(rec, "paperline", report);
  await new Promise((r) => setTimeout(r, 500));
  t("one slow route timing out, the process still answering: logged, not restarted", kills === 0 && rec.timeouts.length === runner.HANG_LIMIT + 1);
  runner.timedOut(rec, "paperline", report);
  t(`the same route ${runner.HANG_LIMIT + 2} times: restarted (what it waits on is not coming back)`, kills === 1 && rec.timeouts.length === 0);
  rec.dead = false;
  for (let i = 1; i < runner.HANG_LIMIT; i++) runner.timedOut(rec, "paperline", i % 2 ? reqOf : report);
  await new Promise((r) => setTimeout(r, 300));
  t("under the limit on two routes: not yet", kills === 1);
  runner.timedOut(rec, "paperline", reqOf);
  t(`${runner.HANG_LIMIT} on two routes inside five minutes: restarted`, kills === 2 && rec.timeouts.length === 0);
  const evs = await waitFor("the events", async () => { const r = (await q("SELECT kind, detail FROM platform.events WHERE kind IN ('tool_timeout','tool_restarted') ORDER BY id")).rows; return r.filter((e) => e.kind === "tool_restarted").length >= 2 ? r : null; }, 5000).catch(() => []);
  t("each timeout is an event with the route's shape, and each restart one more", evs.filter((e) => e.kind === "tool_timeout").length === 2 * runner.HANG_LIMIT + 2 && evs.filter((e) => e.kind === "tool_restarted").length === 2 && evs.some((e) => e.detail.where === "GET /paperline/api/jobs/:n"), evs.map((e) => e.detail));
  t("and Anetix's phones heard once", (await waitFor("the restart alert", async () => { const a = await notified("A tool process was restarted"); return a.length ? a : null; }, 5000).catch(() => [])).length === 1);
  pinger.close();

  // ---- 1.13: the deep health check ----------------------------------------------------------------------------------
  const deep = await client().get("/health?deep=1");
  t("/health?deep=1 asks the database", deep.status === 200 && deep.json.db === true && deep.json.draining === false, deep.text);

  await q("UPDATE platform.companies SET demo=false WHERE slug='demo'");
  R.done();
})().catch(R.abort);
