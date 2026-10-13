// End to end: Change it at the gate (src/pipeline.js rework, 2026-10-12). Taylor on the Chelsea Clock board: "Allow me
// to edit and rebuild a built change, instead of having to simply discard it if it's not right." The manager says what
// is off in the preview; the agent reworks the SAME draft version (keeping what was right), the checks and the second
// review run again, and it comes back to the gate. The manager's words join the requirement, go on the record word for
// word, and the board shows them while the agent works. A change on top of a preview and a brand-new tool work the same.
//
// Runs against a server that is ALREADY UP in fake-agent mode on a fresh database (see scripts/e2e/run-all.sh):
//   node scripts/e2e/rework.js
const { PW, runner, login, waitFor, rowsOf, board, fbRow, proposalFor } = require("./lib");
const R = runner(), t = R.t;

(async () => {
  const admin = await login(PW.admin, "");
  const mgr = await login(PW.manager, "demo");
  const floor = await login(PW.floor, "demo");
  const made = await admin.post("/api/admin/companies", { slug: "other", name: "Other Co" });
  const otherMgr = await login(made.json.passwords.manager, "other");

  const PAGE = "/c/demo/m/paperline/";
  const file = async (message, page = PAGE, mod = "paperline") => (await floor.post("/api/feedback", { company: "demo", module: mod, page, message })).json;
  const runs = async () => (await board(mgr)).runs;
  const runOf = async (id) => (await runs()).find((r) => r.id === id);
  const modRow = async (name = "paperline") => (await board(mgr)).modules.find((m) => m.name === name);
  const approve = async (fbId) => { const p = await proposalFor(mgr, fbId); const r = await mgr.post(`/api/proposals/${p.id}/decide`, { decision: "approve" }); return (r.json && r.json.run) || null; };
  const settle = async (id, what = `run ${id} at the gate`) => waitFor(what, async () => {
    const x = await runOf(id);
    if (x && x.step === "confirm_requirement" && x.status === "waiting") { await mgr.post(`/api/runs/${id}/confirm`, {}); return null; }
    return x && ((x.step === "await_deploy" && ["waiting", "stacked"].includes(x.status)) || x.status === "failed") ? x : null;
  }, 60000);
  const atGate = (x) => x && x.step === "await_deploy" && x.status === "waiting";
  const staged = async (f = "", name = "paperline") => (await mgr.get(`/c/demo/staging/m/${name}/${f}`)).text;
  const marks = (html) => (String(html).match(/Revised by the fake agent/g) || []).length;

  // ---- 1. a UI change waits at the gate; the manager asks for a change instead of discarding it
  const f1 = await file("make the station label bigger");
  const r1 = await approve(f1.id);
  const A = await settle(r1.id);
  t("setup: the preview waits at the gate", atGate(A), A && A.log);
  const vA = A.to_version, before = marks(await staged());
  t("setup: the fake agent stamped the preview once", before >= 1, before);
  t("the board tells the page how many changes a preview may take", (await board(mgr)).maxReworks === 5);

  t("an empty change is refused", (await mgr.post(`/api/runs/${A.id}/rework`, { words: "  " })).status === 400);
  t("the floor cannot ask for a change", (await floor.post(`/api/runs/${A.id}/rework`, { words: "make it red" })).status === 403);
  t("another company's manager cannot either", (await otherMgr.post(`/api/runs/${A.id}/rework`, { words: "make it red" })).status === 403);

  const WORDS = "The label is bigger but now it covers the count. Move it above the count instead.";
  const rw = await mgr.post(`/api/runs/${A.id}/rework`, { words: WORDS });
  t("Change it is taken", rw.status === 200 && rw.json.round === 1 && rw.json.max === 5, rw.json);
  const A1 = await runOf(A.id);
  t("the run leaves the gate and goes back to the build", A1 && !atGate(A1), A1 && { step: A1.step, status: A1.status });
  t("the manager's words are on the run while it is reworked", A1.evidence.findings_from === "manager" && A1.evidence.reworks.length === 1 && A1.evidence.reworks[0].words === WORDS && A1.evidence.reworks[0].by, A1.evidence.reworks);
  t("a second Change it while it is being reworked is refused", (await mgr.post(`/api/runs/${A.id}/rework`, { words: "and green" })).status === 409);
  t("Make it live is refused while it is being reworked", (await mgr.post(`/api/runs/${A.id}/deploy`)).status !== 200);

  const A2 = await settle(A.id, "the reworked preview back at the gate");
  t("the reworked preview comes back to the gate", atGate(A2), A2 && A2.log);
  t("in the SAME version (reworked, not started over)", A2.to_version === vA, { was: vA, now: A2.to_version });
  t("no new version was made for it", (await modRow()).staged_version === vA);
  t("the agent worked on top of what was there (two stamps now)", marks(await staged()) === before + 1, { before, after: marks(await staged()) });
  t("the run log says who asked for the change", (A2.log || []).some((l) => /looked at the preview and asked for a change \(1 of 5\)/.test(l.note || "")), (A2.log || []).map((l) => l.note));
  t("the agent was told it was a rework", (A2.log || []).some((l) => /reworks v\d+ with the manager's change/.test(l.note || "")));
  t("the checks ran again", A2.evidence.visual_check && A2.evidence.visual_check.ok === true, A2.evidence.visual_check);
  const rec = rowsOf((await mgr.get(`/api/c/demo/record?kind=run_reworked&run_id=${A.id}`)).json)[0]
    || rowsOf((await mgr.get(`/api/c/demo/record?kind=run_reworked`)).json).find((x) => x.run_id === A.id);
  t("Change it is on the record word for word, with what the preview did before", rec && rec.after === WORDS && rec.actor_role === "manager" && rec.before && rec.detail.round === 1, rec);
  const fbA = await fbRow(mgr, f1.id);
  t("the request stays in progress, not back to Reviewing", fbA.status === "in_progress", fbA.status);

  const dA = await mgr.post(`/api/runs/${A.id}/deploy`);
  t("the reworked preview goes live like any other", dA.status === 200 && (await modRow()).live_version === vA, dA.json);
  t("Change it after it went live is refused", (await mgr.post(`/api/runs/${A.id}/rework`, { words: "one more thing" })).status === 409);

  // ---- 2. a functionality change: the words join the requirement, so the second review holds the build to them
  const f2 = await file("track how many planes fail the flight test");
  const r2 = await approve(f2.id);
  const B = await settle(r2.id);
  t("setup: the functionality change waits at the gate", atGate(B) && B.lane === "functionality", B && { lane: B.lane, log: B.log });
  const W2 = "Count only planes that fail twice, not every failed throw.";
  t("Change it on a functionality change", (await mgr.post(`/api/runs/${B.id}/rework`, { words: W2 })).status === 200);
  const B2 = await settle(B.id, "the reworked functionality change");
  t("it comes back to the gate in the same version", atGate(B2) && B2.to_version === B.to_version, B2 && { step: B2.step, status: B2.status, log: B2.log });
  t("the manager's words are now part of the requirement", B2.requirement && B2.requirement.includes(W2) && /Changed after .* looked at the preview \(change 1\)/.test(B2.requirement), B2.requirement);
  t("the second review ran again on the reworked build", B2.evidence.cross_check && B2.evidence.cross_check.verdict === "pass", B2.evidence.cross_check);
  t("and the tests", B2.evidence.test_run && B2.evidence.test_run.ok === true, B2.evidence.test_run);

  // ---- 3. Discard still works after a change, and the request goes back to Reviewing
  const cB = await mgr.post(`/api/runs/${B.id}/cancel`);
  t("Discard after Change it still sends it back to Reviewing", cB.status === 200 && (await fbRow(mgr, f2.id)).status === "reviewing");

  // ---- 4. a change on top of a preview: Change it reworks the top, and the change below stays in it
  const f3 = await file("make the count text bigger");
  const C = await settle((await approve(f3.id)).id);
  const f4 = await file("show the shift name in the header");
  const D0 = await approve(f4.id);
  const D = await settle(D0.id);
  t("setup: the second change sits on top of the first preview", atGate(D) && D.evidence.stack && D.evidence.stack.on === C.id, D && D.evidence && D.evidence.stack);
  const rwD = await mgr.post(`/api/runs/${D.id}/rework`, { words: "Put the shift name on the right side." });
  t("Change it on the top of a stacked preview", rwD.status === 200, rwD.json);
  const D2 = await settle(D.id, "the reworked top of the stack");
  t("it comes back in the same version, still on top of the first change", atGate(D2) && D2.to_version === D.to_version && D2.evidence.stack && D2.evidence.stack.on === C.id, D2 && { step: D2.step, status: D2.status, stack: D2.evidence.stack });
  t("the change below is still set aside under it", (await runOf(C.id)) === undefined || (await runOf(C.id)).status === "stacked");
  t("one Make it live puts both live", (await mgr.post(`/api/runs/${D.id}/deploy`)).status === 200 && (await waitFor("both live", async () => { const xs = await Promise.all([f3, f4].map((f) => fbRow(mgr, f.id))); return xs.every((x) => x.status === "done"); })));

  // ---- 5. a brand-new tool's first version: Change it reworks it before anyone uses it
  const it = (await mgr.post("/api/c/demo/intakes", {})).json;
  const answerFor = (qn) => ({ text: qn.id === "name" ? "Rework board" : "Check text for the intake", choice: { picks: [((qn.options || []).find((o) => o.id === "nothing") || (qn.options || [])[0] || {}).id].filter(Boolean), other: "" }, roles: { floor: "6" }, devices: { floor: ["phone"] }, order: ["waiting", "in work", "shipped"], items: ["jobs ship late"], attach: { note: "" } }[qn.kind]);
  let view = it;
  for (let guard = 0; guard < 6 && ["answering", "thinking"].includes(view.status); guard++) {
    for (const qn of view.questions.filter((x) => view.missing.includes(x.id))) await mgr.post(`/api/intakes/${it.id}/answer`, { id: qn.id, value: answerFor(qn) });
    await mgr.post(`/api/intakes/${it.id}/next`, {});
    view = await waitFor("the intake to stop thinking", async () => { const v = (await mgr.get(`/api/intakes/${it.id}`)).json; return v.status !== "thinking" ? v : null; });
  }
  t("setup: the new tool reaches a design", view.status === "design", view.status);
  await mgr.post(`/api/intakes/${it.id}/confirm`, {});
  const slug = view.slug;
  const M0 = await waitFor("the new tool's build", async () => (await runs()).find((r) => r.lane === "module" && r.module === slug));
  const M = await settle(M0.id);
  t("setup: the new tool waits at the gate", atGate(M), M && M.log);
  const stampsBefore = (String(await staged("", slug)).match(/Built by the fake agent from the design/g) || []).length;
  const W5 = "Call the first stage Not started instead of waiting.";
  t("Change it on a new tool", (await mgr.post(`/api/runs/${M.id}/rework`, { words: W5 })).status === 200);
  const M2 = await settle(M.id, "the reworked new tool");
  t("the new tool comes back to the gate, still version 1, nothing live", atGate(M2) && M2.to_version === 1 && (await modRow(slug)).live_version == null, M2 && { step: M2.step, status: M2.status, log: M2.log });
  t("it was reworked, not rebuilt from the skeleton", !(M2.log || []).slice(-8).some((l) => /skeleton written from the design/.test(l.note || "")) && (String(await staged("", slug)).match(/Built by the fake agent from the design/g) || []).length === stampsBefore + 1, (M2.log || []).map((l) => l.note));
  t("the reviewer holds it to the manager's words too", M2.requirement && M2.requirement.includes(W5), M2.requirement);
  t("it goes live as version 1", (await mgr.post(`/api/runs/${M.id}/deploy`)).status === 200 && (await modRow(slug)).live_version === 1);

  R.done();
})().catch(R.abort);
