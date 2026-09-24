// Unit tests for the pure parts of the test campaign (src/campaign.js): the case format and its validator, the
// verdict, the counts, the steps shown on a test page. No database, no server.
//   node scripts/test-campaign.js
const C = require("../src/campaign");
let pass = 0, fail = 0;
const t = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log(`FAIL  ${name}${detail !== undefined ? "\n      " + JSON.stringify(detail).slice(0, 500) : ""}`); } };
const ctx = { modules: ["paperline", "kpis"], self: "paperline" };

// ---- parse: a good proposal
{
  const p = C.parse({
    title: "x", summary: "y",
    data: { source: "made", why: "a busy shift", made: { paperline: { material_requests: [{ item: "paper_white" }] }, nowhere: { t: [] } } },
    cases: [
      { id: "c1", title: "The first screen opens and the list answers", area: "inside", kind: "auto", steps: [{ page: "/" }, { call: "GET /api/state", expect: { status: 200 } }] },
      { id: "c2", title: "The KPI board counts the new request", area: "across", kind: "auto", steps: [{ call: "POST /api/requests", body: { item: "paper_white" }, save: { id: "id" } }, { call: "GET /api/kpis", module: "kpis", expect: { json: { live: { open_requests: { $gte: 1 } } } } }] },
      { id: "c3", title: "Print a label at station one and check it", area: "connection", kind: "guided", steps: [{ do: "On station 1, press Print label on the first traveler", on: "/station/1", then: { call: "GET /api/state", expect: { status: 200 } }, within: 5 }, { do: "Check the label shows the order number", on: "/station/1" }] },
      { title: "A floor device may not change the setup", kind: "auto", area: "role", steps: [{ call: "POST /api/setup", as: "floor", expect: { status: [401, 403] } }] },
    ],
  }, ctx);
  t("every good case is kept, ids filled in", p.cases.length === 4 && p.cases[3].id === "c4", p.cases.map((c) => c.id));
  t("kinds and areas are kept; a step naming a sibling makes an across case", p.cases[1].area === "across" && p.cases[2].kind === "guided" && p.cases[2].area === "connection");
  t("a guided step is normalized: within clamped to 30 seconds, the watch kept, a plain tick allowed", p.cases[2].steps[0].within === 30 && p.cases[2].steps[0].then && !p.cases[2].steps[1].then && p.cases[2].steps[1].within === 600, p.cases[2].steps);
  t("the made-up set keeps only tools on the test floor and says what it left out", p.data.source === "made" && Object.keys(p.data.made).join() === "paperline" && /nowhere/.test(p.problems.join()), p);
}
// ---- parse: what is dropped, and why
{
  const p = C.parse({
    data: { source: "floor", why: "" },
    cases: [
      { id: "a", title: "short", area: "inside", kind: "auto", steps: [{ call: "GET /api/x" }] },
      { id: "b", title: "A step against a tool that is not there", area: "across", kind: "auto", steps: [{ call: "GET /api/x", module: "erp" }] },
      { id: "c", title: "A do step inside an auto case is wrong", area: "inside", kind: "auto", steps: [{ do: "press it", on: "/" }] },
      { id: "d", title: "A guided step that climbs out of the tool", area: "inside", kind: "guided", steps: [{ do: "Open the other tool by hand", on: "/../kpis" }] },
      { id: "e", title: "A title with a long dash — is refused", area: "inside", kind: "auto", steps: [{ page: "/" }] },
      { id: "f", title: "A bad watch is refused with the step named", area: "inside", kind: "guided", steps: [{ do: "Press the big button", on: "/", then: { call: "FETCH /api/x" } }] },
      { id: "g", title: "An unknown expect rule is refused", area: "inside", kind: "auto", steps: [{ call: "GET /api/x", expect: { json: { n: { $between: [1, 2] } } } }] },
      { id: "h", title: "A fine case survives beside the bad ones", area: "inside", kind: "auto", steps: [{ page: "/", expect: { status: 200 } }] },
    ],
  }, ctx);
  t("only the fine case is kept", p.cases.length === 1 && p.cases[0].id === "h", p.cases);
  const why = Object.fromEntries(p.dropped.map((d) => [d.id, d.why]));
  t("each drop names its reason", /8 characters/.test(why.a) && /not on the test floor/.test(why.b) && /guided case/.test(why.c) && /climb out/.test(why.d) && /long dashes/.test(why.e) && /then/.test(why.f) && /\$between/.test(why.g), why);
  t("an empty proposal is one problem, not a crash", C.parse(null, ctx).problems.length === 1 && C.parse({}, ctx).problems.includes("no cases"));
  t("more than 12 cases are cut to 12", C.parse({ data: { source: "floor" }, cases: Array.from({ length: 15 }, (_, i) => ({ id: `c${i}`, title: `A perfectly fine case number ${i}`, area: "inside", kind: "auto", steps: [{ page: "/" }] })) }, ctx).cases.length === 12);
  t("more than 4 guided cases: the fifth is dropped", C.parse({ data: { source: "floor" }, cases: Array.from({ length: 5 }, (_, i) => ({ id: `g${i}`, title: `A guided case number ${i} for a person`, area: "inside", kind: "guided", steps: [{ do: "Press the button and look", on: "/" }] })) }, ctx).cases.length === 4);
}
// ---- counts and the verdict
{
  const cases = [
    { id: "c1", kind: "auto", area: "inside", steps: [{ page: "/" }] },
    { id: "c2", kind: "auto", area: "across", steps: [{ page: "/", module: "kpis" }] },
    { id: "g1", kind: "guided", area: "inside", steps: [{ do: "a", on: "/" }, { do: "b", on: "/" }] },
  ];
  t("counts", JSON.stringify(C.counts(cases)) === JSON.stringify({ total: 3, guided: 1, across: 1 }));
  const v0 = C.verdictOf(cases, { cases: [] });
  t("nothing run: not done", !v0.done && !v0.ok);
  const v1 = C.verdictOf(cases, { cases: [{ id: "c1", ok: true }, { id: "c2", ok: true }, { id: "g1", steps: [{ state: "seen" }, { state: "waiting" }] }] });
  t("a guided step still waiting: not done", !v1.done);
  const v2 = C.verdictOf(cases, { cases: [{ id: "c1", ok: true }, { id: "c2", ok: true }, { id: "g1", steps: [{ state: "seen" }, { state: "done" }] }] });
  t("every step closed and nothing failed: passed", v2.done && v2.ok && !v2.failed.length);
  const v3 = C.verdictOf(cases, { cases: [{ id: "c1", ok: false }, { id: "c2", ok: true }, { id: "g1", steps: [{ state: "seen" }, { state: "waiting" }] }] });
  t("a failed auto case does not end the campaign while a person still has a step", !v3.done && v3.failed.join() === "c1");
  const v4 = C.verdictOf(cases, { cases: [{ id: "c1", ok: true }, { id: "c2", ok: true }, { id: "g1", steps: [{ state: "not_right", words: "no" }, { state: "done" }] }] });
  t("a not right closes its step and fails the case", v4.done && !v4.ok && v4.failed.join() === "g1");
  const v5 = C.verdictOf(cases, { cases: [{ id: "c1", ok: true }, { id: "c2", ok: true }, { id: "g1", steps: [{ state: "seen" }] }] });
  t("a guided case with a step not yet listed is not done", !v5.done);
}
// ---- the steps a test page shows
{
  const camp = { id: 7, module: "paperline", cases: [
    { id: "g1", kind: "guided", title: "Station one", steps: [{ do: "Press print", on: "/station/1", then: { call: "GET /x" } }, { do: "Look at the board", on: "/" }] },
    { id: "g2", kind: "guided", title: "The KPI board", steps: [{ do: "Open the KPI board", on: "/", module: "kpis" }] },
    { id: "c1", kind: "auto", title: "x", steps: [{ page: "/" }] },
  ], results: { cases: [{ id: "g1", steps: [{ state: "seen", saw: "GET /x answered 200" }, { state: "waiting" }] }, { id: "g2", steps: [{ state: "waiting" }] }] } };
  const s1 = C.stepsForScreen(camp, "paperline", "/c/demo/test/m/paperline/station/1");
  t("the station page gets its own step, seen, with what was seen", s1.length === 1 && s1[0].case === "g1" && s1[0].n === 1 && s1[0].state === "seen" && s1[0].watched && /200/.test(s1[0].saw), s1);
  const s2 = C.stepsForScreen(camp, "paperline", "/c/demo/test/m/paperline/");
  t("the first screen gets the step on it and not the sibling's", s2.length === 1 && s2[0].n === 2 && !s2[0].watched, s2);
  const s3 = C.stepsForScreen(camp, "kpis", "/c/demo/test/m/kpis/");
  t("the sibling's page gets the step that names it", s3.length === 1 && s3[0].case === "g2", s3);
  t("a page with nothing on it gets nothing", C.stepsForScreen(camp, "paperline", "/c/demo/test/m/paperline/stock").length === 0);
}
// ---- the fake proposal parses under the same rules
{
  const p = C.fakeProposal({ module: "paperline", to_version: 2 }, { smoke: ["/api/state", "/api/stock"] }, ["kpis"], 1, "CAMPAIGNFAIL CAMPAIGNMADE");
  const q = C.parse(p.data, ctx);
  t("fake mode: four cases, one guided, one across, a made-up set", q.cases.length === 4 && C.counts(q.cases).guided === 1 && C.counts(q.cases).across === 1 && q.data.source === "made" && !q.dropped.length, q);
  t("fake mode: the failing case only on the first attempt", C.parse(C.fakeProposal({ module: "paperline", to_version: 2 }, { smoke: ["/api/state"] }, [], 2, "CAMPAIGNFAIL").data, ctx).cases[1].steps[0].expect.status === 200);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
