// End to end: changes join the preview (src/pipeline.js joinPreview, 2026-09-28). A change approved while a tool has a
// build waiting at the deploy gate is built on top of that preview instead of waiting for it to go live; several
// approved while the preview is still building are merged into one run; Discard takes out only the newest change;
// one deploy puts every change in the preview live; a rollback takes the whole preview back; a new tool that has
// never been live works the same way, and a request sent from its preview is read against the preview.
//
// Runs against a server that is ALREADY UP in fake-agent mode on a fresh database, with SOS_AUTO_FIX_ROUNDS=0:
//   DATABASE_URL=postgres://sos:sos@127.0.0.1:5432/sos_e2e SOS_FAKE_AGENT=1 SOS_FAKE_DELAY_MS=300 PORT=3999 \
//   SOS_FLOOR_PASSWORD=floorpw SOS_MANAGER_PASSWORD=mgrpw SOS_ADMIN_PASSWORD=adminpw SESSION_SECRET=e2e \
//   SOS_CONNECTION_KEY=e2e-connection-key SOS_AUTO_FIX_ROUNDS=0 SOS_BROWSER=off node server.js &
//   node scripts/e2e/chamber.js
const { PW, runner, login, waitFor, rowsOf, board, fbRow, proposalFor, sleep } = require("./lib");
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
  const approve = async (fbId) => { const p = await proposalFor(mgr, fbId); const r = await mgr.post(`/api/proposals/${p.id}/decide`, { decision: "approve" }); return { prop: p, run: (r.json && r.json.run) || null, status: r.status, json: r.json }; };
  // drive a run to the deploy gate: confirm the requirement when it waits on it
  const settle = async (id, what = `run ${id} at the gate`) => waitFor(what, async () => {
    const x = await runOf(id);
    if (x && x.step === "confirm_requirement" && x.status === "waiting") { await mgr.post(`/api/runs/${id}/confirm`, {}); return null; }
    // a run that reached the gate may already have a waiting change added on top of it (then it shows as stacked)
    return x && ((x.step === "await_deploy" && ["waiting", "stacked"].includes(x.status)) || x.status === "failed") ? x : null;
  }, 60000);
  const atGate = (x) => x && x.step === "await_deploy" && x.status === "waiting";
  const staged = async (file, name = "paperline") => (await mgr.get(`/c/demo/staging/m/${name}/${file || ""}`)).text;

  // ---- 1. a preview waits at the gate; a second change is approved: it goes ON TOP, not behind
  const f1 = await file("make the station label bigger");   // UI lane
  const a = await approve(f1.id);
  t("setup: the first change is approved", a.status === 200 && a.run, a.json);
  const A = await settle(a.run.id);
  t("setup: its preview waits at the gate", atGate(A), A && A.log);
  const vA = A.to_version;
  t("setup: the preview is its version", (await modRow()).staged_version === vA);

  const f2 = await file("track how many planes fail the flight test");   // functionality lane
  const b = await approve(f2.id);
  t("a change approved while a preview waits is taken straight on top of it (no waiting for Make it live)", b.status === 200 && b.run && b.run.status !== "queued", b.run && b.run.status);
  const B0 = await runOf(b.run.id);
  t("its run builds from the preview's version, not the live one", B0.from_version === vA && B0.evidence.stack && B0.evidence.stack.on === A.id && B0.evidence.stack.base === vA, B0.evidence.stack);
  t("it carries both changes, and builds only its own", (B0.proposal_ids || []).length === 2 && B0.proposal_ids.includes(a.prop.id) && B0.proposal_ids.includes(b.prop.id) && B0.evidence.stack.own.length === 1 && B0.evidence.stack.own[0] === b.prop.id, { ids: B0.proposal_ids, own: B0.evidence.stack.own });
  t("the board shows both requests on the one run", (B0.feedback_ids || []).includes(f1.id) && (B0.feedback_ids || []).includes(f2.id));
  const Aset = await runOf(A.id);
  t("the preview's run is set aside as stacked, under the new one", Aset.status === "stacked" && Aset.evidence.stacked_under === B0.id, { status: Aset.status, ev: Aset.evidence.stacked_under });
  t("the log says what happened, in words", (B0.log || []).some((l) => /added to the preview of run #\d+ \(v\d+, not live yet\)/.test(l.note)) && (Aset.log || []).some((l) => /adds a change on top of this preview; they go live together/.test(l.note)));
  t("while it builds, the preview still shows the first change", /Revised by the fake agent \(v\d+\)/.test(await staged()) && (await modRow()).staged_version === vA);
  const B1 = await waitFor("the requirement of the added change", async () => { const x = await runOf(B0.id); return x && x.step === "confirm_requirement" && x.status === "waiting" ? x : null; });
  t("the requirement to confirm covers only the added change", (B1.evidence.req_items || []).length === 1, B1.evidence.req_items);
  t("the preview under it cannot be put live alone", await (async () => { const x = await mgr.post(`/api/runs/${A.id}/deploy`); return x.status === 500 && /goes live with that one/.test(x.json.error); })());
  t("nor discarded while something is on top of it", await (async () => { const x = await mgr.post(`/api/runs/${A.id}/cancel`); return x.status === 500 && /take that one out first/.test(x.json.error); })());
  const B = await settle(B0.id);
  t("the added change reaches the gate", atGate(B), B.log && B.log.slice(-3));
  t("its draft was a copy of the preview: both changes are in the new preview", await (async () => { const html = await staged(); return html.includes(`Revised by the fake agent (v${vA})`) && html.includes(`Revised by the fake agent (v${B.to_version})`); })());
  t("the draft said so in the run log", (B.log || []).some((l) => new RegExp(`created from the preview v${vA} \\(not live yet\\)`).test(l.note)));
  const vers = (await mgr.get("/api/c/demo/modules/paperline/versions")).json;
  t("the Versions panel names both changes on the new version", ((vers.versions || []).find((v) => v.version === B.to_version) || {}).notes && /;/.test(vers.versions.find((v) => v.version === B.to_version).notes), (vers.versions || []).slice(0, 2));
  t("the record carries it: preview_joined, with the run below", rowsOf((await mgr.get(`/api/c/demo/record?kind=preview_joined`)).json).some((r) => r.run_id === B.id && r.detail.on === A.id));

  // ---- 2. Discard takes out only the newest change; the preview below comes back as it was
  const back = await mgr.post(`/api/runs/${B.id}/cancel`);
  t("Discard on the top of the stack", back.status === 200, back.json);
  const A2 = await waitFor("the preview below back at the gate", async () => { const x = await runOf(A.id); return atGate(x) ? x : null; });
  t("the preview below is back at the gate", atGate(A2) && !A2.evidence.stacked_under);
  t("and it is the preview again, without the change that was taken out", (await modRow()).staged_version === vA && !(await staged()).includes(`Revised by the fake agent (v${B.to_version})`));
  t("the change taken out goes back to review; the one below stays in progress", (await fbRow(mgr, f2.id)).status === "reviewing" && (await fbRow(mgr, f1.id)).status === "in_progress");
  t("the run taken out is cancelled, the log says the preview is back", (await runOf(B.id)).status === "cancelled" && (A2.log || []).some((l) => /taken out; this preview is back at the gate as it was/.test(l.note)));

  // ---- 3. the top of the stack stops: the queue waits, the fix lands on the preview, the next change goes on top
  const f3 = await file("FAILCHECK track the fold count per shift");   // functionality, fails the cross-check once
  const c = await approve(f3.id);
  const C0 = await settle(c.run.id, "the failing change to stop");
  t("setup: a change on top of the preview fails its review", C0.status === "failed" && C0.evidence.stack && C0.evidence.stack.on === A.id, { status: C0.status, step: C0.step });
  t("the preview below stays set aside (it goes live with the fix or comes back on a discard)", (await runOf(A.id)).status === "stacked");
  const f4 = await file("show the wing crease time on the station screen");   // UI lane
  const d = await approve(f4.id);
  await sleep(800);
  const D0 = await runOf(d.run.id);
  t("a change approved meanwhile waits: it does not start from the live version over the preview", D0.status === "queued" && !D0.to_version, { status: D0.status, from: D0.from_version });
  t("the queued card says where it will go", (D0.log || []).some((l) => /added to that preview as soon as the preview is ready/.test(l.note)));
  t("Fix sends the findings back", (await mgr.post(`/api/runs/${C0.id}/fix`)).status === 200);
  // the fixed change reaches the gate and the waiting one goes on top of it at once, so it is seen set aside
  const C = await waitFor("the fixed change at the gate", async () => { const x = await runOf(C0.id); return x && x.step === "await_deploy" && ["waiting", "stacked"].includes(x.status) ? x : null; }, 60000);
  const D1 = await waitFor("the waiting change to join the fixed preview", async () => { const x = await runOf(d.run.id); return x && x.status !== "queued" ? x : null; });
  t("the fixed change was built on the preview too", C.from_version === vA && C.evidence.fix_round === 1);
  t("once it reached the gate, the waiting change went on top of it (three deep)", D1.evidence.stack && D1.evidence.stack.on === C.id && (D1.proposal_ids || []).length === 3 && (D1.evidence.stack.carried || []).length === 2, D1.evidence.stack);
  t("and the one below is set aside in turn", (await runOf(C.id)).status === "stacked");
  const D = await settle(D1.id);
  t("the third change reaches the gate", atGate(D));
  const html3 = await staged();
  t("the preview carries all three changes", html3.includes(`(v${vA})`) && html3.includes(`(v${C.to_version})`) && html3.includes(`(v${D.to_version})`));

  // ---- 4. one deploy puts every change live; everyone who asked hears
  const liveBefore = (await modRow()).live_version;
  const dep = await mgr.post(`/api/runs/${D.id}/deploy`);
  t("one deploy", dep.status === 200 && dep.json.to === D.to_version, dep.json);
  const live = await waitFor("all three requests live", async () => { const xs = await Promise.all([f1, f3, f4].map((f) => fbRow(mgr, f.id))); return xs.every((x) => x && x.status === "done" && x.shipped_version === D.to_version) ? xs : null; });
  t("all three requests are done and stamped with the version that went live", live.length === 3);
  const Afin = await runOf(A.id), Cfin = await runOf(C.id);
  t("the runs below are marked as gone live inside the top one", Afin.status === "deployed" && Afin.evidence.went_live_in === D.id && Cfin.status === "deployed" && Cfin.evidence.went_live_in === D.id);
  t("each request's outcome names the version and the batch", live.every((x) => new RegExp(`^Deployed v${D.to_version} \\(batch of 3\\): Fake-mode summary`).test(x.outcome)), live.map((x) => x.outcome));
  const vers2 = (await mgr.get("/api/c/demo/modules/paperline/versions")).json.versions;
  t("the drafts underneath were never on the floor themselves, and the Versions panel says so", vers2.find((v) => v.version === vA).never_approved === true && vers2.find((v) => v.version === D.to_version).ever_live === true);
  const hb = (await admin.get("/api/admin/health?days=30")).json.companies.find((x) => x.slug === "demo").builds;
  t("loop health counts one deploy, not three", hb.shipped === 1, { shipped: hb.shipped });

  // ---- 5. rolling back any of them takes the whole preview back
  const rb = await mgr.post(`/api/runs/${A.id}/rollback`);
  t("roll back from a run that went live inside another rolls back that one", rb.status === 200 && rb.json.to === liveBefore, rb.json);
  const [Arb, Crb, Drb] = await Promise.all([A.id, C.id, D.id].map(runOf));
  t("all three runs are rolled back", [Arb, Crb, Drb].every((x) => x.status === "rolled_back"), [Arb, Crb, Drb].map((x) => x.status));
  t("and the requests say so", (await fbRow(mgr, f1.id)).outcome.startsWith("Rolled back"));

  // ---- 6. several changes approved while the preview is still being made go on together, as one run
  const g1 = await file("record who folded each plane");   // functionality: waits at its requirement
  const G = await approve(g1.id);
  await waitFor("the first change at its requirement", async () => { const x = await runOf(G.run.id); return x && x.step === "confirm_requirement" && x.status === "waiting"; });
  const g2 = await file("show the plane count bigger");
  const g3 = await file("make the fold step text bigger");
  const [h2, h3] = [await approve(g2.id), await approve(g3.id)];
  t("two more approved while the first is not built yet: they wait", (await runOf(h2.run.id)).status === "queued" && (await runOf(h3.run.id)).status === "queued");
  const Gg = await settle(G.run.id);
  const H = await waitFor("the two to join the preview", async () => { const x = await runOf(h2.run.id); return x && x.status !== "queued" ? x : null; });
  t("they are merged into one run on top of the preview", H.evidence.stack && H.evidence.stack.on === Gg.id && H.evidence.stack.own.length === 2 && (H.proposal_ids || []).length === 3, H.evidence.stack);
  const h3r = await runOf(h3.run.id);
  t("the other run is folded into it, not built on its own", h3r.status === "cancelled" && h3r.evidence.merged_into === H.id);
  t("merged UI changes stay in the UI lane", H.lane === "ui");
  const Hg = await settle(H.id);
  t("the merged run reaches the gate", atGate(Hg));
  t("deploy puts all three live", (await mgr.post(`/api/runs/${Hg.id}/deploy`)).status === 200 && (await waitFor("live", async () => { const xs = await Promise.all([g1, g2, g3].map((f) => fbRow(mgr, f.id))); return xs.every((x) => x.status === "done"); })));

  // ---- 7. two approvals in the same instant claim the preview once
  const k1 = await file("make the queue label darker");
  const K = await approve(k1.id);
  const Kg = await settle(K.run.id);
  const [k2, k3] = [await file("make the order text bigger"), await file("make the clip label text bold")];
  const [p2, p3] = [await proposalFor(mgr, k2.id), await proposalFor(mgr, k3.id)];
  await Promise.all([mgr.post(`/api/proposals/${p2.id}/decide`, { decision: "approve" }), mgr.post(`/api/proposals/${p3.id}/decide`, { decision: "approve" })]);
  await sleep(1500);
  const on = (await runs()).filter((r) => r.evidence && r.evidence.stack && r.evidence.stack.on === Kg.id && r.status !== "cancelled");
  t("exactly one run is built on top of the preview", on.length === 1, on.map((r) => ({ id: r.id, status: r.status })));
  const top = await settle(on[0].id);
  // whichever way the two landed (merged, or the second on top of the first), one deploy takes all three live
  let last = top;
  for (let guard = 0; guard < 3; guard++) {
    const next = (await runs()).find((r) => r.evidence && r.evidence.stack && r.evidence.stack.on === last.id && r.status !== "cancelled");
    if (!next) break;
    last = await settle(next.id);
  }
  t("deploying the top of the stack puts all three live", (await mgr.post(`/api/runs/${last.id}/deploy`)).status === 200 && (await waitFor("live", async () => { const xs = await Promise.all([k1, k2, k3].map((f) => fbRow(mgr, f.id))); return xs.every((x) => x.status === "done"); })));

  // ---- 8. a new tool that has never been live: its preview takes changes too, read against the preview itself
  const it = (await mgr.post("/api/c/demo/intakes", {})).json;
  const answerFor = (qn) => ({ text: qn.id === "name" ? "Late job board" : "Check text for the intake", choice: { picks: [((qn.options || []).find((o) => o.id === "nothing") || (qn.options || [])[0] || {}).id].filter(Boolean), other: "" }, roles: { floor: "6" }, devices: { floor: ["phone"] }, order: ["waiting", "in work", "shipped"], items: ["jobs ship late"], attach: { note: "" } }[qn.kind]);
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
  t("setup: the new tool's first version waits at the gate, nothing live", atGate(M) && (await modRow(slug)).live_version == null && (await modRow(slug)).staged_version === 1, { gate: atGate(M), row: await modRow(slug) });
  const nf = await file("make the add button bigger", `/c/demo/staging/m/${slug}/`, slug);
  const nfRow = await fbRow(mgr, nf.id);
  t("a request sent from the new tool's preview names its screen, not its address", nfRow.screen === "Late job board board" && nfRow.target_file === "pages/board.html", { screen: nfRow.screen, target: nfRow.target_file });
  const np = await proposalFor(mgr, nf.id);
  t("and gets a proposal aimed at that screen", np && np.id && np.target_file === "pages/board.html", np);
  const drafted = rowsOf((await mgr.get(`/api/c/demo/record?kind=proposal_drafted&feedback_id=${nf.id}`)).json)[0];
  t("the proposer was given the preview's source (it had none before)", drafted && drafted.detail.context_chars > 2000, drafted && drafted.detail);
  const N0 = (await mgr.post(`/api/proposals/${np.id}/decide`, { decision: "approve" })).json.run;
  const N1 = await runOf(N0.id);
  t("the change goes on top of the new tool's preview", N1.evidence.stack && N1.evidence.stack.on === M.id && N1.evidence.stack.base === 1 && N1.evidence.stack.live == null, N1.evidence);
  const N = await settle(N0.id);
  t("it builds version 2 from version 1 and reaches the gate", atGate(N) && N.to_version === 2 && N.from_version === 1, { gate: atGate(N), from: N.from_version, to: N.to_version });
  const dn = await mgr.post(`/api/runs/${N.id}/deploy`);
  t("putting it on the floor puts the tool live at version 2", dn.status === 200 && (await modRow(slug)).live_version === 2, dn.json);
  const reqCard = (await board(mgr)).feedback.find((f) => f.kind === "module_request" && f.intake_id === it.id);
  t("the tool request closes as built and live", reqCard && reqCard.status === "done" && /Built and live as v2/.test(reqCard.outcome), reqCard && reqCard.outcome);
  t("the intake is done", (await mgr.get(`/api/intakes/${it.id}`)).json.status === "done");
  t("the request from the preview is done too", (await fbRow(mgr, nf.id)).status === "done");

  // ---- 9. guards: another company cannot reach any of it
  t("another company's manager cannot discard a run here", (await otherMgr.post(`/api/runs/${N.id}/cancel`)).status === 403);
  t("the floor cannot discard", (await floor.post(`/api/runs/${N.id}/cancel`)).status === 403);

  R.done();
})().catch(R.abort);
