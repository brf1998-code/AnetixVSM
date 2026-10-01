// End to end: the first-time user round of 2026-10-01 (two LGO classmates' first go at a demo), server side. Against a
// server ALREADY UP in fake-agent mode on a FRESH database, with SOS_WWW_KEY and SOS_WWW_URL=https://anetix.test in
// both shells (run-all.sh has the line), and SOS_REQUIREMENT_GATE unset (the default: no second stop).
// What it proves:
//   - the new tool's requirements: every point has an id and a tag; changes to named points and things to add go to
//     the agent in one pass; every point nobody named comes back word for word; what changed and what is new is marked;
//     the record has it; a design from before ids reads with ids
//   - a functionality change writes its requirement and builds without stopping for a second confirmation
//   - Review all with AI drafts every waiting request it is sent for this company, and leaves alone one being read,
//     one with a question out, one of another company, one to Anetix
//   - out of credit, a start is refused with 402 and the refill page named, never a 500
//   - GET /login/session tells anetix.ai, and only anetix.ai, whether this browser is still signed in
//   - the board carries every screen of each tool with an address to open it at
const { runner, login, waitFor, board, fbRow, sleep } = require("./lib");
const { q } = require("../../src/db");
const intake = require("../../src/intake");
const R = runner(), t = R.t;
const BASE = process.env.SOS_BASE || `http://127.0.0.1:${process.env.PORT || 3999}`;
const KEY = process.env.SOS_WWW_KEY, WWW = process.env.SOS_WWW_URL || "https://anetix.test";
if (!KEY) { console.error("SOS_WWW_KEY must be set in this shell and the server's"); process.exit(2); }
const www = async (p, b) => (await fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json", "X-SOS-WWW-Key": KEY }, body: JSON.stringify(b) })).json();
const answerFor = (qn) => ({ text: qn.id === "name" ? "Spool tracker" : "Check text for the intake", choice: { picks: [((qn.options || []).find((o) => o.id === "nothing") || (qn.options || [])[0] || {}).id].filter(Boolean), other: "" }, roles: { floor: "6" }, devices: { floor: ["phone"] }, order: ["wound", "checked", "shipped"], items: ["spools get lost"], attach: { note: "" } }[qn.kind]);

(async () => {
  const admin = await login(process.env.SOS_ADMIN_PASSWORD || "adminpw"), mgr = await login(process.env.SOS_MANAGER_PASSWORD || "mgrpw", "demo"), floor = await login(process.env.SOS_FLOOR_PASSWORD || "floorpw", "demo");

  // ---- the new tool's requirements -------------------------------------------------------------------------------
  const it = (await mgr.post("/api/c/demo/intakes", {})).json;
  let view = it;
  for (let guard = 0; guard < 6 && ["answering", "thinking"].includes(view.status); guard++) {
    for (const qn of view.questions.filter((x) => view.missing.includes(x.id))) await mgr.post(`/api/intakes/${it.id}/answer`, { id: qn.id, value: answerFor(qn) });
    await mgr.post(`/api/intakes/${it.id}/next`, {});
    view = await waitFor("the intake to stop thinking", async () => { const v = (await mgr.get(`/api/intakes/${it.id}`)).json; return v.status !== "thinking" ? v : null; });
  }
  t("setup: the intake reaches its requirements", view.status === "design", view.status + " " + (view.error || ""));
  const fixed = view.questions.filter((x) => x.round === 1);
  t("every fixed question says what its answer is for", fixed.length >= 12 && fixed.every((x) => typeof x.why === "string" && x.why.length > 10 && x.why.length < 80 && !/[–—]/.test(x.why)), fixed.map((x) => x.why));
  const pts = view.design.items;
  t("every point has an id and a tag for what it is about", pts.length === 5 && pts.every((p, i) => p.id === `p${i + 1}` && intake.POINT_KINDS.includes(p.kind)), pts);
  const before = pts.map((p) => p.summary);
  t("the board's card counts the points", (await board(mgr)).intakes[it.id].points === 5);

  t("no changes, nothing sent", (await mgr.post(`/api/intakes/${it.id}/revise`, { changes: [{ point: "p2", text: "   " }] })).status === 400);
  t("the floor cannot ask for changes", (await floor.post(`/api/intakes/${it.id}/revise`, { changes: [{ point: "p2", text: "x" }] })).status === 403);
  const sent = await mgr.post(`/api/intakes/${it.id}/revise`, { changes: [{ point: "p2", text: "the lead also gets a screen" }, { point: null, text: "a spool is weighed before it ships" }, { point: "p99", text: "this names no point, so it is something to add" }] });
  t("the changes go to the agent: thinking, and the screen knows how many", sent.status === 200 && sent.json.status === "thinking" && sent.json.design.revising.count === 3, sent.json);
  const after = await waitFor("the revised requirements", async () => { const v = (await mgr.get(`/api/intakes/${it.id}`)).json; return v.status === "design" ? v : null; });
  const ap = after.design.items;
  t("every point nobody named comes back word for word, in its place", ["p1", "p3", "p4", "p5"].every((id) => ap.find((p) => p.id === id).summary === before[Number(id.slice(1)) - 1] && !ap.find((p) => p.id === id).mark) && ap[0].id === "p1" && ap[2].id === "p3", ap);
  t("the named point changed, and says so", ap[1].id === "p2" && ap[1].mark === "changed" && /the lead also gets a screen/.test(ap[1].summary), ap[1]);
  t("the additions are new points with new ids", ap.length === 7 && ap.filter((p) => p.mark === "new").map((p) => p.id).join() === "p6,p7" && ap.some((p) => p.summary === "a spool is weighed before it ships"), ap);
  t("the revision is kept with what was asked", after.design.revisions.length === 1 && after.design.revisions[0].changes.length === 3 && after.design.revisions[0].changes[2].point === null, after.design.revisions);
  t("the record has it, the points before and after", Boolean((await q("SELECT 1 FROM platform.record WHERE company='demo' AND kind='intake_revised' AND detail->'changes'->0->>'point'='p2'")).rows[0]));
  t("nothing on the screen says what it cost or names a model", !JSON.stringify(after).match(/cost_usd|claude-/), JSON.stringify(after).match(/cost_usd|claude-.{0,30}/));

  // a second pass takes out a point when asked, and leaves the rest
  await mgr.post(`/api/intakes/${it.id}/revise`, { changes: [{ point: "p7", text: "take this one out" }] });
  const after2 = await waitFor("the second revision", async () => { const v = (await mgr.get(`/api/intakes/${it.id}`)).json; return v.status === "design" ? v : null; });
  t("a later pass keeps every earlier answer and starts its marks over", after2.design.items.length === 7 && after2.design.items.filter((p) => p.id !== "p7").every((p) => !p.mark) && after2.design.items.find((p) => p.id === "p2").summary === ap[1].summary, after2.design.items);

  // the merge on its own: a dropped point nobody asked about goes back; a named one may go; an unasked change is undone
  const prev = [{ id: "p1", kind: "stages", summary: "A" }, { id: "p2", kind: "screen", summary: "B" }, { id: "p3", kind: "rule", summary: "C" }];
  const m1 = intake.mergeRevision(prev, [{ id: "p1", summary: "A changed quietly", changed: false }, { id: "p3", summary: "C" }], [{ point: "p3", text: "x" }]);
  t("merge: a point nobody asked about is put back where it was, and an unasked rewording is undone", JSON.stringify(m1.items.map((p) => [p.id, p.summary, p.mark || ""])) === JSON.stringify([["p1", "A", ""], ["p2", "B", ""], ["p3", "C", ""]]), m1.items);
  const m2 = intake.mergeRevision(prev, [{ id: "p1", summary: "A" }, { id: "p2", summary: "B" }], [{ point: "p3", text: "remove it" }]);
  t("merge: a point the manager named may be taken out", m2.items.length === 2 && m2.removed[0] === "C", m2);
  const m3 = intake.mergeRevision(prev, [{ id: "p1", summary: "A2", changed: true }, { id: "p2", summary: "B" }, { id: "p3", summary: "C2", changed: true }], [{ point: "p3", text: "x" }]);
  t("merge: a change made to fit is marked apart from the one asked for", m3.items[0].mark === "fit" && m3.items[2].mark === "changed", m3.items);
  t("changes: blank ones dropped, unknown points become additions, at most twelve", intake.cleanChanges([{ point: "p1", text: " " }, { point: "zz", text: "y" }, ...Array(20).fill({ point: "p2", text: "z" })], prev).length === 12 && intake.cleanChanges([{ point: "zz", text: "y" }], prev)[0].point === null);

  // a design written before points had ids reads with ids
  const old = (await q("INSERT INTO platform.module_intakes (company, status, design, answers) VALUES ('demo','design',$1,'{}') RETURNING id", [JSON.stringify({ bluf: "old", items: [{ summary: "one" }, { summary: "two" }], reference_md: "r" })])).rows[0].id;
  const oldView = (await mgr.get(`/api/intakes/${old}`)).json;
  t("a design from before ids reads with ids", oldView.design.items.map((p) => p.id).join() === "p1,p2", oldView.design.items);
  await q("UPDATE platform.module_intakes SET status='abandoned' WHERE id=$1", [old]);
  await mgr.post(`/api/intakes/${it.id}/abandon`, {});

  // ---- the requirement gate is off: a functionality change builds straight on ----------------------------------------
  const b0 = await board(mgr);
  t("the board says the gate is off", b0.requirement_gate === false);
  const fn = (await floor.post("/api/feedback", { company: "demo", module: "paperline", page: "/c/demo/m/paperline/", message: "track scrap counts per shift on the station page" })).json.id;
  const prop = await waitFor("its proposal", async () => { const f = await fbRow(mgr, fn); return f && f.arrival !== "proposing" && f.proposal_id ? f : null; });
  t("setup: a functionality proposal", prop.proposal_class === "functionality", prop.proposal_class);
  const run = (await mgr.post(`/api/proposals/${prop.proposal_id}/decide`, { decision: "approve" })).json;
  const runId = (run.run || run).id;
  let sawWait = false;
  const gated = await waitFor("the build to reach the preview", async () => {
    const x = (await board(mgr)).runs.find((r) => r.id === runId);
    if (x && x.step === "confirm_requirement" && x.status === "waiting") sawWait = true;
    return x && (x.status === "failed" || (x.step === "await_deploy" && x.status === "waiting")) ? x : null;
  }, 90000);
  t("it never stops to have its requirement confirmed, and reaches the preview", !sawWait && gated.step === "await_deploy", gated.status + " " + gated.step);
  t("its requirement is written down and on the run, with the summary and a line per change", Boolean(gated.requirement) && Boolean(gated.evidence.req_bluf) && gated.evidence.req_items.length === 1, gated.evidence);
  t("the run's log says the build follows it", (gated.log || []).some((l) => /requirement written down/.test(l.note || "")), gated.log);
  t("the record has the requirement, marked as no gate", Boolean((await q("SELECT 1 FROM platform.record WHERE company='demo' AND kind='requirement_drafted' AND run_id=$1 AND detail->>'gate'='false'", [runId])).rows[0]));
  await mgr.post(`/api/runs/${runId}/cancel`);

  // ---- Review all with AI ---------------------------------------------------------------------------------------------
  t("setup: reading on arrival off", (await mgr.post("/api/c/demo/agents/arrival", { auto_propose: false })).json.auto_propose === false);
  const file = async (msg) => (await floor.post("/api/feedback", { company: "demo", module: "paperline", page: "/c/demo/m/paperline/", message: msg })).json.id;
  const a = await file("the clip bin count should reset each shift"), b = await file("stations need a way to mark a jam"), c = await file("the timer should pause on a jam"), d = await file("the stock page should warn before paper runs out");
  await q("UPDATE platform.feedback SET arrival='proposing' WHERE id=$1", [c]);                                             // being read right now
  await q("UPDATE platform.feedback SET question=$2 WHERE id=$1", [d, JSON.stringify({ text: "which station?", asked_at: new Date().toISOString() })]);   // a question out
  await admin.post("/api/admin/companies", { slug: "other-co", name: "Other Co" });
  await admin.post("/api/admin/companies/other-co/modules", { module: "paperline" });
  await admin.post("/api/c/other-co/agents/arrival", { auto_propose: false });
  const otherFb = (await admin.post("/api/feedback", { company: "other-co", module: "paperline", page: "/c/other-co/m/paperline/", message: "someone else's request" })).json.id;
  const toAnetix = (await floor.post("/api/feedback", { company: "demo", module: "platform", page: "/c/demo/", message: "the board is slow" })).json.id;
  t("the floor cannot send them", (await floor.post("/api/c/demo/feedback/review-all", { ids: [a, b] })).status === 403);
  t("nothing sent, nothing done", (await mgr.post("/api/c/demo/feedback/review-all", { ids: [] })).status === 400);
  const ra = await mgr.post("/api/c/demo/feedback/review-all", { ids: [a, b, c, d, otherFb, toAnetix, 999999] });
  t("two start; the one being read, the one with a question, another company's, one to Anetix and an unknown are skipped", ra.status === 200 && ra.json.started === 2 && ra.json.skipped === 5, ra.json);
  const both = await waitFor("both drafted", async () => { const x = await fbRow(mgr, a), y = await fbRow(mgr, b); return x && y && x.status === "reviewing" && y.status === "reviewing" && x.proposal_id && y.proposal_id ? [x, y] : null; }, 60000);
  t("each lands in Reviewing with its proposal, read as done", both.every((f) => f.arrival === "done"));
  t("the one being read and the one with a question are untouched", (await fbRow(mgr, c)).status === "new" && (await fbRow(mgr, d)).status === "new" && (await fbRow(mgr, d)).arrival !== "proposing");
  t("another company's request is untouched", (await q("SELECT status, arrival FROM platform.feedback WHERE id=$1", [otherFb])).rows[0].status === "new");
  t("the record has who sent them", Boolean((await q("SELECT 1 FROM platform.record WHERE company='demo' AND kind='review_all'")).rows[0]));
  t("sending the same ones again starts nothing", (await mgr.post("/api/c/demo/feedback/review-all", { ids: [a, b] })).json.started === 0);
  await q("UPDATE platform.feedback SET arrival=NULL WHERE id=$1", [c]);
  await mgr.post("/api/c/demo/agents/arrival", { auto_propose: true });

  // ---- out of credit: 402 with the refill page, never a 500 -------------------------------------------------------------
  const pin = (await admin.post("/api/admin/pins", { label: "Ana at Copper", email: "ana@copper.test", max_uses: 1, days: 30 })).json.pin.shown;
  const A = (await www("/api/www/companies", { pin, email: "ana@copper.test", name: "Copper Works", contact: "Ana", ref: `demo:${pin}`, paid_usd: 0, credit_usd: 10, password: "copper-oak-2201-press", demo: true, collect: true })).company.slug;
  await admin.post(`/api/admin/companies/${A}/modules`, { module: "paperline" });
  await q("INSERT INTO platform.ai_usage (company, module, kind, model, cost_usd, detail) VALUES ($1,'paperline','test','x',11,'{}')", [A]);
  const ni = await admin.post(`/api/c/${A}/intakes`, {});
  t("a new tool, out of credit: 402, the words, and the refill page", ni.status === 402 && ni.json.code === "credit_out" && /credit is used up/.test(ni.json.error) && ni.json.error.includes(`${WWW}/c/${A}/credit?t=`), ni);
  const sf = await admin.post(`/api/c/${A}/modules/paperline/sample`, {});
  t("sample data, out of credit: 402, not 500", sf.status === 402 && /credit is used up/.test(sf.json.error), sf);
  const fbA = (await admin.post("/api/feedback", { company: A, module: "paperline", page: "/", message: "add a jam counter" })).json.id;
  await sleep(300);
  const rv = await admin.post(`/api/feedback/${fbA}/review`);
  t("Review with AI, out of credit: 402", rv.status === 402 && /credit is used up/.test(rv.json.error), rv);
  const raA = await admin.post(`/api/c/${A}/feedback/review-all`, { ids: [fbA] });
  t("Review all, out of credit: 402 and nothing marked as being read", raA.status === 402 && (await q("SELECT arrival FROM platform.feedback WHERE id=$1", [fbA])).rows[0].arrival !== "proposing", raA);

  // ---- is this browser still signed in? (anetix.ai asks) ------------------------------------------------------------------
  const ask = async (c, origin) => {
    const headers = { Origin: origin };
    if (c) headers.Cookie = c.cookies().map((k) => `${k.name}=${k.value}`).join("; ");
    const r = await fetch(`${BASE}/login/session`, { headers });
    return { status: r.status, json: await r.json(), acao: r.headers.get("access-control-allow-origin"), acac: r.headers.get("access-control-allow-credentials"), cache: r.headers.get("cache-control") };
  };
  const s1 = await ask(mgr, WWW);
  t("a signed-in manager: yes, the company's name and its board, for anetix.ai only", s1.status === 200 && s1.json.signed_in === true && s1.json.board === "/c/demo/" && s1.json.name && s1.acao === WWW && s1.acac === "true" && /no-store/.test(s1.cache), s1);
  t("nobody signed in: no", (await ask(null, WWW)).json.signed_in === false);
  const s3 = await ask(mgr, "https://evil.test");
  t("another site gets no CORS headers, so its page cannot read the answer", !s3.acao, s3);
  t("an admin: the admin page", (await ask(admin, WWW)).json.board === "/admin");
  t("the floor: its board", (await ask(floor, WWW)).json.board === "/c/demo/");
  t("a cookie that does not verify: no", (await fetch(`${BASE}/login/session`, { headers: { Origin: WWW, Cookie: "sos_session=manager.demo.1.abc.abc.forged" } }).then((r) => r.json())).signed_in === false);

  // ---- every screen of each tool, for the board's Screens popout ----------------------------------------------------------
  const b1 = await board(mgr);
  const pl = (b1.pages || {}).paperline || {};
  t("the board lists every live screen of a tool with an address, a parameter filled from its checks", (pl.live || []).length === 4 && pl.live.some((x) => x.path === "/station/1") && pl.live.every((x) => x.label && x.path.startsWith("/")), pl);
  t("no preview screens while nothing is staged", Array.isArray(pl.staged) && pl.staged.length === 0, pl.staged);

  R.done();
})().catch(R.abort);
