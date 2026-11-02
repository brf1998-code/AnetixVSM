// End to end for the value stream map, M1 (src/vsm.js, public/map.html, docs/VSM.md; 2026-11-01).
// What it proves: the floor sees no map and no Map tab; a manager sees an empty map and cannot import; an admin imports
// a map and it reads back whole; coverage counts a stage once its tool is live, and "in daily use" only from the
// company's own use on 5 of the last 14 days, never Anetix's; screens opened by the floor are counted and an admin's are
// not; a manager's small edits are checked, saved and on the record; review questions are confirmed, fixed (with words)
// and reopened; another company reaches none of it, not by its own slug with another's id either; the export reads
// back through the import unchanged; the map travels in the backup and goes with the company.
// Against a server ALREADY UP in fake-agent mode on a fresh database, with SOS_USE_FLUSH_MS=500 (run-all.sh has the line).
const { PW, runner, login, waitFor } = require("./lib");
const { q } = require("../../src/db");
const vsm = require("../../src/vsm");
const R = runner(), t = R.t;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MAP = {
  format: "anetix-map-1",
  stages: [
    { ref: "01", name: "Order entry", who: "Sales", record_kind: "other", record_system: "an ERP" },
    { ref: "02", name: "Make the parts", who: "Line", record_kind: "anetix", record_system: "Paper Airplane Line", modules: ["paperline"] },
    { ref: "03", name: "Plan", who: "Nobody", record_kind: "none" },
    { ref: "04", name: "Dispatch", who: "Lead", record_kind: "paper", record_system: "a whiteboard" },
  ],
  maps: [{
    key: "line", family: "Paper airplanes", title: "Paper airplanes", layout: { bands: [{ label: "Production control", x: 200, y: 20, w: 600, h: 140 }], ladder_y: 420, feed: [{ from: "Floor agent", to: "Lead", text: "Batch the folds", tag: "Possible with built tools" }] },
    nodes: [
      { key: "cus", kind: "customer", label: "Customers", x: 900, y: 20, w: 160, h: 90 },
      { key: "plan", kind: "control", label: "Plan the day", sub: "Lead", record_kind: "paper", record_system: "a whiteboard", x: 300, y: 60, w: 150, h: 70, detail: { what: "The lead plans", quote: "We plan it in our heads", quote_by: "Lead" }, confidence: "heard" },
      { key: "fold", kind: "process", label: "Fold", record_kind: "anetix", modules: ["paperline"], x: 200, y: 240, w: 140, h: 60, data: [{ label: "C/T", value: "?" }] },
      { key: "ship", kind: "process", label: "Ship", record_kind: "other", record_system: "an ERP", x: 420, y: 240, w: 140, h: 60 },
    ],
    edges: [
      { from: "plan", to: "fold", kind: "info_word", label: "verbal", from_side: "bottom", to_side: "top" },
      { from: "fold", to: "ship", kind: "push", from_side: "right", from_at: 0.75, to_side: "left", to_at: 0.75, inventory: { label: "?" } },
      { from: "ship", to: "cus", kind: "ship", from_side: "right", to_side: "bottom" },
    ],
    kaizen: [{ n: 1, node: "plan", title: "Write the plan down", why: "It lives in one head" }],
  }],
  questions: [
    { map: "line", node: "plan", where: "Plan the day", claim: "The lead plans the day VSMCANARY", why: "Assumed", confidence: "assumed" },
    { where: "Whole plant", claim: "Nobody plans ahead", confidence: "heard" },
  ],
};

(async () => {
  const mgr = await login(PW.manager, "demo"), floor = await login(PW.floor, "demo"), admin = await login(PW.admin, "");

  // ---- who sees it
  t("the floor cannot read the map", (await floor.get("/api/c/demo/vsm")).status === 403);
  t("nor open the Map page", (await floor.get("/c/demo/map")).status === 403);
  const page = await mgr.get("/c/demo/map");
  t("a manager opens the Map page, with the company's own icon on the tab", page.status === 200 && /Value stream map/.test(page.text) && /\/api\/c\/demo\/icon/.test(page.text) && !/<title>Anetix · /.test(page.text), page.status);
  const boardPage = await mgr.get("/c/demo/");
  t("the board carries the Kaizen and Map tabs, hidden until it knows who is signed in", /id="views"[^>]*hidden/.test(boardPage.text) && /href="map"/.test(boardPage.text));
  const empty = (await mgr.get("/api/c/demo/vsm")).json;
  t("a company with no map yet: no maps, nothing to count, no import for a manager", empty.maps.length === 0 && empty.coverage.total === 0 && empty.can_import === false && empty.company.slug === "demo", empty);
  t("a manager cannot import a map", (await mgr.post("/api/c/demo/vsm/import", MAP)).status === 403);
  t("an admin's import is checked for shape first", (await admin.post("/api/c/demo/vsm/import", { format: "something else" })).status === 400);
  const badEdge = JSON.parse(JSON.stringify(MAP)); badEdge.maps[0].edges.push({ from: "fold", to: "nowhere", kind: "push" });
  const be = await admin.post("/api/c/demo/vsm/import", badEdge);
  t("a flow to a box that is not on the map is refused, and nothing is written", be.status === 400 && /not on the map/.test(be.json.error) && (await q("SELECT count(*)::int n FROM platform.vsm_nodes WHERE company='demo'")).rows[0].n === 0, be.text);

  // ---- import and read back
  const imp = await admin.post("/api/c/demo/vsm/import", MAP);
  t("an admin imports a map", imp.status === 200 && imp.json.counts.boxes === 4 && imp.json.counts.flows === 3 && imp.json.counts.stages === 4 && imp.json.counts.questions === 2, imp.text);
  t("the import is on the record", (await q("SELECT 1 FROM platform.record WHERE company='demo' AND kind='map_imported'")).rows.length === 1);
  const ov = (await mgr.get("/api/c/demo/vsm")).json;
  t("the overview lists the map, the stages and the open questions", ov.maps.length === 1 && ov.maps[0].family === "Paper airplanes" && ov.stages.length === 4 && ov.questions_open === 2, ov);
  t("coverage: the stage whose tool is live counts as built; the rest by where their record lives", ov.coverage.built === 1 && ov.coverage.other === 1 && ov.coverage.paper === 1 && ov.coverage.none === 1 && ov.coverage.total === 4, ov.coverage);
  t("nothing is in daily use yet", ov.coverage.daily === 0 && ov.tools.find((x) => x.name === "paperline").daily === false);
  const mapId = ov.maps[0].id;
  const mv = (await mgr.get(`/api/c/demo/vsm/maps/${mapId}`)).json;
  t("one map reads back whole: boxes, flows, bursts, its questions, the company's tools", mv.nodes.length === 4 && mv.edges.length === 3 && mv.kaizen.length === 1 && mv.questions.length === 2 && mv.tools.some((x) => x.name === "paperline"), mv);
  t("a box keeps its detail, data box and confidence", (() => { const p = mv.nodes.find((n) => n.key === "plan"); const f = mv.nodes.find((n) => n.key === "fold"); return p.detail.quote === "We plan it in our heads" && p.confidence === "heard" && f.data[0].label === "C/T" && f.modules[0] === "paperline"; })());
  t("a flow keeps its sides and its inventory", mv.edges.some((e) => e.kind === "push" && e.from_at === 0.75 && e.inventory && e.inventory.label === "?"));
  t("the map's concept feed comes through, marked possible or not", mv.map.layout.feed.length === 1 && mv.map.layout.feed[0].now === true);
  t("the JSON names no model and no cost", !/claude-|cost_usd|"model"/i.test(JSON.stringify(mv)));

  // ---- daily use: only the company's own people, 5 of the last 14 days
  const before = (await q("SELECT coalesce(sum(views),0)::int v, coalesce(sum(changes),0)::int c FROM platform.module_use WHERE company='demo' AND module='paperline'")).rows[0];
  await floor.get("/c/demo/m/paperline/");
  const counted = await waitFor("the floor's screen to be counted", async () => { const r = (await q("SELECT coalesce(sum(views),0)::int v FROM platform.module_use WHERE company='demo' AND module='paperline'")).rows[0]; return r.v > before.v ? r : null; }, 8000).catch(() => null);
  t("a screen the floor opens is counted", Boolean(counted), before);
  const v1 = counted ? counted.v : before.v;
  await admin.get("/c/demo/m/paperline/");
  await sleep(1300);
  t("a screen Anetix's admin opens is not", (await q("SELECT coalesce(sum(views),0)::int v FROM platform.module_use WHERE company='demo' AND module='paperline'")).rows[0].v === v1);
  for (const d of [1, 2, 3, 4]) await q("INSERT INTO platform.module_use (company, module, day, views, changes) VALUES ('demo','paperline', current_date - $1::int, 3, 2) ON CONFLICT (company, module, day) DO UPDATE SET changes=2", [d]);
  t("changes on 4 of the last 14 days are not daily use", (await mgr.get("/api/c/demo/vsm")).json.coverage.daily === 0);
  await q("INSERT INTO platform.module_use (company, module, day, views, changes) VALUES ('demo','paperline', current_date - 6, 1, 1) ON CONFLICT (company, module, day) DO UPDATE SET changes=1");
  const ov2 = (await mgr.get("/api/c/demo/vsm")).json;
  t("on 5 of them, it is, and its stage counts", ov2.coverage.daily === 1 && ov2.tools.find((x) => x.name === "paperline").days_changed === 5, ov2.coverage);
  await q("INSERT INTO platform.module_use (company, module, day, views, changes) VALUES ('demo','kpis', current_date - 20, 1, 9)");
  t("use older than 14 days does not count", (await mgr.get("/api/c/demo/vsm")).json.tools.find((x) => x.name === "kpis").days_changed === 0);

  // ---- a manager's small edits
  const plan = mv.nodes.find((n) => n.key === "plan"), fold = mv.nodes.find((n) => n.key === "fold");
  const e1 = await mgr.post(`/api/c/demo/vsm/nodes/${plan.id}`, { record_kind: "anetix", modules: ["kpis"], who: "Dana, the lead", notes: "Plans at 7" });
  t("a manager changes a box's record, tools, who and notes", e1.status === 200 && e1.json.node.record_kind === "anetix" && e1.json.node.modules[0] === "kpis" && e1.json.node.who === "Dana, the lead" && e1.json.node.detail.notes === "Plans at 7" && e1.json.node.detail.quote === "We plan it in our heads", e1.text);
  const rec = (await q("SELECT before, after, actor_role FROM platform.record WHERE company='demo' AND kind='map_changed' ORDER BY id DESC LIMIT 1")).rows[0];
  t("the change is on the record, before and after", rec && /paper/.test(rec.before) && /anetix/.test(rec.after) && rec.actor_role === "manager", rec);
  t("a tool the company does not have is refused", (await mgr.post(`/api/c/demo/vsm/nodes/${plan.id}`, { modules: ["no-such-tool"] })).status === 400);
  t("a record kind that is not one of the five is refused", (await mgr.post(`/api/c/demo/vsm/nodes/${plan.id}`, { record_kind: "magic" })).status === 400);
  t("a box cannot lose its name", (await mgr.post(`/api/c/demo/vsm/nodes/${plan.id}`, { label: "  " })).status === 400);
  t("an empty edit is refused", (await mgr.post(`/api/c/demo/vsm/nodes/${plan.id}`, {})).status === 400);
  const mv2 = await mgr.post(`/api/c/demo/vsm/nodes/${fold.id}`, { x: 264, y: 248, data: [{ label: "C/T", value: "45 s" }, { label: "", value: "dropped" }, { label: "C/O", value: "?" }] });
  t("a box is moved and its data box changed; a row with no label is dropped", mv2.status === 200 && mv2.json.node.x === 264 && mv2.json.node.data.length === 2 && mv2.json.node.data[0].value === "45 s", mv2.text);
  t("the floor cannot edit a box", (await floor.post(`/api/c/demo/vsm/nodes/${plan.id}`, { label: "x" })).status === 403);
  const st = (await mgr.get("/api/c/demo/vsm")).json.stages.find((s) => s.ref === "03");
  const se = await mgr.post(`/api/c/demo/vsm/stages/${st.id}`, { record_kind: "paper", record_system: "a notebook" });
  t("a manager changes a stage's record, and coverage follows", se.status === 200 && (await mgr.get("/api/c/demo/vsm")).json.coverage.paper === 2 && (await q("SELECT 1 FROM platform.record WHERE company='demo' AND kind='stage_changed'")).rows.length === 1);

  // ---- review questions
  const qs = (await mgr.get(`/api/c/demo/vsm/maps/${mapId}`)).json.questions;
  const qa = qs.find((x) => /VSMCANARY/.test(x.claim)), qb = qs.find((x) => x !== qa);
  t("a fix needs words", (await mgr.post(`/api/c/demo/vsm/questions/${qa.id}/answer`, { status: "fix", answer: " " })).status === 400);
  const fx = await mgr.post(`/api/c/demo/vsm/questions/${qa.id}/answer`, { status: "fix", answer: "Dana plans it, not the lead on shift" });
  t("a manager says what is right", fx.status === 200 && fx.json.question.status === "fix" && fx.json.question.answer === "Dana plans it, not the lead on shift" && fx.json.question.answered_by, fx.text);
  const ok = await mgr.post(`/api/c/demo/vsm/questions/${qb.id}/answer`, { status: "confirmed" });
  t("and confirms what is right; the open count follows", ok.status === 200 && ok.json.question.status === "confirmed" && (await mgr.get("/api/c/demo/vsm")).json.questions_open === 0);
  const ro = await mgr.post(`/api/c/demo/vsm/questions/${qb.id}/answer`, { status: "open" });
  t("an answer can be reopened", ro.json.question.status === "open" && !ro.json.question.answered_at);
  t("each answer is on the record", (await q("SELECT count(*)::int n FROM platform.record WHERE company='demo' AND kind='map_question_answered'")).rows[0].n === 3);

  // ---- another company
  const made = await admin.post("/api/admin/companies", { slug: "mapco", name: "Map Co" });
  const other = await login(made.json.passwords.manager, "mapco");
  t("another company's manager cannot read this company's map", (await other.get("/api/c/demo/vsm")).status === 403 && (await other.get(`/api/c/demo/vsm/maps/${mapId}`)).status === 403);
  t("nor reach its box, stage or question through its own slug", (await other.post(`/api/c/mapco/vsm/nodes/${plan.id}`, { label: "taken" })).status === 404 && (await other.post(`/api/c/mapco/vsm/stages/${st.id}`, { who: "x" })).status === 404 && (await other.post(`/api/c/mapco/vsm/questions/${qa.id}/answer`, { status: "confirmed" })).status === 404 && (await other.get(`/api/c/mapco/vsm/maps/${mapId}`)).status === 404);
  t("and nothing changed", (await q("SELECT label FROM platform.vsm_nodes WHERE id=$1", [plan.id])).rows[0].label === "Plan the day");

  // ---- export, import round trip, backup, delete
  const ex = await mgr.get("/api/c/demo/vsm/export");
  t("a manager downloads the map as one file", ex.status === 200 && ex.json.format === "anetix-map-1" && ex.json.maps[0].nodes.length === 4 && /attachment/.test(ex.headers.get("content-disposition") || ""));
  const back = await admin.post("/api/c/mapco/vsm/import", ex.json);
  const mco = (await admin.get("/api/c/mapco/vsm")).json;
  t("the file reads back through the import into another company", back.status === 200 && back.json.counts.boxes === 4 && mco.maps.length === 1 && mco.stages.find((s) => s.ref === "03").record_kind === "paper", back.text);
  t("an edit made before the export travels with it", (await admin.get(`/api/c/mapco/vsm/maps/${mco.maps[0].id}`)).json.nodes.find((n) => n.key === "plan").who === "Dana, the lead");
  const bk = await admin.get("/api/admin/backup");
  t("the map is in the backup", bk.status === 200 && Array.isArray(bk.json.platform.vsm_nodes) && bk.json.platform.vsm_nodes.some((n) => n.company === "demo") && Array.isArray(bk.json.platform.module_use));
  await vsm.deleteCompany("mapco");
  t("a company's map goes with the company", (await q("SELECT count(*)::int n FROM platform.vsm_nodes WHERE company='mapco'")).rows[0].n === 0 && (await q("SELECT count(*)::int n FROM platform.vsm_nodes WHERE company='demo'")).rows[0].n === 4);
  t("the ids in the routes take digits only", (await mgr.get("/api/c/demo/vsm/maps/0x1")).status === 404);
  R.done();
})().catch(R.abort);
