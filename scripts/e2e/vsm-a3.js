// End to end for the agent board's A3 (src/vsm-drafts.js, src/vsm-stages.js; docs/AGENTS.md decisions 7 to 10) with the
// reference tool, the Paper Airplane Line (modules/paperline), which reports its stations as stage events and takes
// material requests drafted by agents on its Stockroom screen.
// What it proves: the line's stations report stage events as travelers move, and a preview's are not kept; a box is tied
// to its steps (only steps of the company's own tools) and the Map shows its live numbers, the waits between boxes and
// the lead time; an agent with steps and no tool can be set up, and its stage watches flag work open too long and too
// much of it; its review reads the live numbers at its steps; an agent drafts a material request for a neighbor's tool,
// and not for a tool that is neither its own nor its neighbors', nor with fields the tool does not take; the draft
// waits on the tool's own screen for a manager, not the floor; a manager makes it through the tool's own logic and the
// board says so, once; a claim that lapses returns to waiting; a manager opens a tool's drafts to the floor, and the
// floor declines one with a line; a draft is withdrawn on the board, and one nobody makes expires; another company
// reaches none of it; the record, the backup, the export and the delete.
// Against a server ALREADY UP in fake-agent mode on a fresh database, with SOS_WATCH_MS=0 and SOS_AGENT_EARLY_MIN=0.
const { PW, runner, login, waitFor } = require("./lib");
const { q } = require("../../src/db");
const R = runner(), t = R.t;
const A = "/api/c/demo/vsm", P = "/c/demo/m/paperline";
const STEPS = ["Kit and Crease", "Nose Folds", "Body Fold", "Wings", "Clip and Test"];
const st = (s) => [{ module: "paperline", step: s }];
const MAP = { format: "anetix-map-1", stages: [], maps: [{ key: "planes", family: "Planes", title: "Planes",
  nodes: [
    { key: "plan", kind: "control", label: "Plan the day", who: "Dana", x: 500, y: 40 },
    { key: "stock", kind: "process", label: "Stockroom", modules: ["paperline"], record_kind: "anetix", who: "Lee", x: 60, y: 240, detail: { agent_name: "Stock agent" } },
    { key: "kit", kind: "process", label: "Kit", who: "Kai", x: 280, y: 240, detail: { agent_name: "Kit agent", steps: st("Kit and Crease") } },
    { key: "nose", kind: "process", label: "Nose", x: 500, y: 240, detail: { agent_name: "Assembly agent", steps: st("Nose Folds") } },
    { key: "body", kind: "process", label: "Body", x: 720, y: 240, detail: { agent_name: "Assembly agent", steps: st("Body Fold") } },
    { key: "wings", kind: "process", label: "Wings", x: 940, y: 240, detail: { agent_name: "Assembly agent", steps: st("Wings") } },
    { key: "test", kind: "process", label: "Test", x: 1160, y: 240, detail: { steps: st("Clip and Test") } },
    { key: "ship", kind: "process", label: "Ship", modules: ["kpis"], record_kind: "anetix", x: 1380, y: 240, detail: { agent_name: "KPI agent" } },
    { key: "cus", kind: "customer", label: "Customers", x: 1500, y: 20 } ],
  edges: [{ from: "plan", to: "kit", kind: "info_word" }, { from: "stock", to: "kit", kind: "supply" }, { from: "kit", to: "nose", kind: "push" }, { from: "nose", to: "body", kind: "push" },
    { from: "body", to: "wings", kind: "push" }, { from: "wings", to: "test", kind: "push" }, { from: "test", to: "ship", kind: "push" }, { from: "ship", to: "cus", kind: "ship" }] }] };
const lastReview = async () => (await q("SELECT coalesce(max(id), 0)::int AS n FROM platform.vsm_reviews")).rows[0].n;
const reviewAfter = (agentId, after) => waitFor(`a review of agent ${agentId}`, async () => (await q("SELECT * FROM platform.vsm_reviews WHERE agent_id=$1 AND id>$2 AND status<>'running' ORDER BY id DESC LIMIT 1", [agentId, after])).rows[0] || null, 20000);

(async () => {
  const mgr = await login(PW.manager, "demo"), floor = await login(PW.floor, "demo"), admin = await login(PW.admin, "");

  // ---- the line reports its stations as stage events
  await q("UPDATE mod_demo_paperline.inventory SET qty=500");
  await mgr.post(`${P}/api/settings`, { release_per_shift: 5 });
  t("setup: a shift starts", (await mgr.post(`${P}/api/shift/start`)).status === 200);
  const trav = (await q("SELECT id, job_num FROM mod_demo_paperline.travelers ORDER BY id")).rows;
  const complete = async (id, body) => floor.post(`${P}/api/travelers/${id}/complete`, { operator: "Kai", ...(body || {}) });
  // three travelers all the way through (one scrapped at the test), the fourth only past the first station, the fifth
  // still waiting there
  for (const tr of trav.slice(0, 3)) for (let i = 0; i < 5; i++) await complete(tr.id, i === 4 ? { distance_ft: 20, qc: tr === trav[2] ? "scrap" : "pass" } : {});
  await complete(trav[3].id);
  const evs = (await q("SELECT step, ref, kind FROM platform.vsm_stage_events WHERE company='demo' ORDER BY id")).rows;
  t("each traveler joins the first station's queue when released, and finishes or is scrapped at each station", evs.filter((e) => e.kind === "wait" && e.step === "Kit and Crease").length === 5
    && evs.filter((e) => e.kind === "finish" && e.step === "Clip and Test").length === 2 && evs.filter((e) => e.kind === "scrap").length === 1 && evs.some((e) => e.ref === trav[0].job_num), evs.length);
  t("the floor's person is the platform's, kept on the event", (await q("SELECT count(*)::int n FROM platform.vsm_stage_events WHERE company='demo' AND person IS NOT NULL")).rows[0].n > 0);
  t("the floor never reads the steps", (await floor.get(`${A}/steps`)).status === 403);
  const seen = (await mgr.get(`${A}/steps`)).json.steps;
  t("a manager reads the steps the tools reported, by tool", STEPS.every((s) => seen.some((x) => x.module === "paperline" && x.step === s && x.title === "Paper Airplane Line")));

  // ---- the map ties boxes to steps and shows their numbers
  await admin.post(`${A}/import`, MAP);
  const ov = (await mgr.get(A)).json;
  const mapId = (ov.maps.find((m) => m.key === "planes") || ov.maps[0]).id;
  let mv = (await mgr.get(`${A}/maps/${mapId}`)).json;
  const kit = mv.live && mv.live.nodes.kit, tst = mv.live && mv.live.nodes.test;
  t("the Map shows a box's live numbers: runs, work in process, finished", kit && kit.runs === 4 && kit.wip === 1 && kit.finished === 4 && mv.live.nodes.nose.wip === 1 && tst.finished === 2 && tst.scrapped === 1 && tst.fpy === 66.7, mv.live);
  t("the waits between boxes along the flow and the lead time", mv.live.waits["kit>nose"] && mv.live.waits["kit>nose"].refs === 4 && mv.live.lead && mv.live.lead.refs === 2, { waits: mv.live.waits, lead: mv.live.lead });
  t("a box with no steps has no numbers", !mv.live.nodes.stock && !mv.live.nodes.ship);
  const shipNode = mv.nodes.find((n) => n.key === "ship");
  t("a box is tied only to steps of the company's own tools", (await mgr.post(`${A}/nodes/${shipNode.id}`, { steps: [{ module: "nope", step: "x" }] })).status === 400);
  const tie = await mgr.post(`${A}/nodes/${shipNode.id}`, { steps: [{ module: "paperline", step: "Clip and Test" }] });
  mv = (await mgr.get(`${A}/maps/${mapId}`)).json;
  t("tying a box to a step in its editor gives it numbers, its other words kept", tie.status === 200 && mv.live.nodes.ship && mv.live.nodes.ship.finished === 2 && mv.nodes.find((n) => n.key === "ship").detail.agent_name === "KPI agent", tie.json);
  await mgr.post(`${A}/nodes/${shipNode.id}`, { steps: [] });

  // ---- agents on steps: set up with no tool, stage watches
  for (const key of ["kit-agent", "stock-agent", "kpi-agent"]) await mgr.post(`${A}/agents`, { key });
  let ag = (await mgr.get(`${A}/agents`)).json;
  const kitA = ag.agents.find((a) => a.key === "kit-agent"), stockA = ag.agents.find((a) => a.key === "stock-agent"), kpiA = ag.agents.find((a) => a.key === "kpi-agent");
  t("an agent with steps and no tool of its own is set up, with a stage watch drafted", kitA.set_up && kitA.tools.length === 0 && kitA.steps.length === 1 && kitA.watches.some((w) => w.shape === "stage" && w.spec.step === "Kit and Crease" && w.status === "proposed"), kitA);
  t("the tools that take drafts are listed for the board, managers only to begin with", ag.draft_tools.length === 1 && ag.draft_tools[0].module === "paperline" && ag.draft_tools[0].floor === false && ag.draft_tools[0].kinds[0].kind === "material_request");
  const sw = kitA.watches.find((w) => w.shape === "stage");
  await mgr.post(`${A}/watches/${sw.id}`, { status: "on", hours: 0 });
  await mgr.post(`${A}/agents/${kitA.id}/check`);
  const sf = (await q("SELECT f.*, m.words FROM platform.vsm_flags f JOIN platform.vsm_messages m ON m.id=f.thread_id WHERE f.watch_id=$1", [sw.id])).rows[0];
  t("a stage watch flags work open at its step, by the job's own number", sf && sf.count === 1 && sf.evidence.sample[0].label === trav[4].job_num && /Kit and Crease: work open too long/.test(sf.words), sf);
  const wip = await mgr.post(`${A}/agents/${kitA.id}/watches`, { shape: "stage", title: "Too much at kit", severity: "look", spec: { module: "paperline", step: "Kit and Crease", measure: "wip", limit: 0 } });
  t("a stage watch on too much work in process", wip.status === 200 && wip.json.watch.spec.measure === "wip");
  t("and only on the agent's own steps", (await mgr.post(`${A}/agents/${kitA.id}/watches`, { shape: "stage", title: "Not mine", spec: { module: "paperline", step: "Wings", measure: "open", hours: 1 } })).status === 400);

  // ---- a review reads the live numbers at its steps
  await mgr.post(`${A}/agents/${kitA.id}`, { reviews: true, brief: '[[read {"tool_name":"stage_numbers"}]]' });
  let before = await lastReview();
  await mgr.post(`${A}/agents/${kitA.id}/review`);
  let rev = await reviewAfter(kitA.id, before);
  const kNote = (await q("SELECT words FROM platform.vsm_messages WHERE agent_id=$1 AND from_kind='agent' AND kind='note' ORDER BY id DESC LIMIT 1", [kitA.id])).rows[0];
  t("an agent with steps reads the live numbers there in its review", rev.status === "done" && /ok: \{"days"/.test(kNote.words) && /Kit and Crease/.test(kNote.words) && rev.steps.includes("Reading the live numbers at its steps"), kNote && kNote.words.slice(0, 300));
  const rp = (() => { const fs = require("fs"); const f = process.env.SOS_PROMPT_LOG; return f && fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((p) => p.kind === "agent-review" && /You are: Kit agent/.test(JSON.stringify(p.messages))).pop() : null; })();
  t("its prompt names its steps and the tools it may draft into, with their fields", !process.env.SOS_PROMPT_LOG || (rp && /Your steps/.test(JSON.stringify(rp.messages)) && /tool paperline \(Paper Airplane Line\), kind material_request/.test(JSON.stringify(rp.messages)) && /item \(text, needed, one of paper_white/.test(JSON.stringify(rp.messages))));

  // ---- drafts across tools
  const draftBrief = (fields, tool = "paperline") => `[[record {"tool":"${tool}","kind":"material_request","fields":${JSON.stringify(fields)},"why":"Blue ran out twice at kit."}]]`;
  await mgr.post(`${A}/agents/${kitA.id}`, { brief: draftBrief({ item: "paper_blue", qty: 5, station: 1 }) });
  before = await lastReview();
  await mgr.post(`${A}/agents/${kitA.id}/review`);
  rev = await reviewAfter(kitA.id, before);
  const d1 = (await q("SELECT * FROM platform.vsm_record_drafts WHERE company='demo' ORDER BY id DESC LIMIT 1")).rows[0];
  const d1m = d1 && (await q("SELECT * FROM platform.vsm_messages WHERE id=$1", [d1.message_id])).rows[0];
  t("an agent drafts a material request for its neighbor's tool; it waits, addressed to the neighbor", rev.posted.records === 1 && d1 && d1.state === "waiting" && d1.module === "paperline" && d1.fields.qty === 5 && d1m.kind === "record" && d1m.to_list.some((x) => x.key === "stock-agent"), { posted: rev.posted, d1m });
  await mgr.post(`${A}/agents/${kpiA.id}`, { reviews: true, brief: draftBrief({ item: "paper_blue", qty: 5 }) });
  before = await lastReview();
  await mgr.post(`${A}/agents/${kpiA.id}/review`);
  rev = await reviewAfter(kpiA.id, before);
  t("not for a tool that is neither its own nor its neighbors'", rev.posted.records === undefined && rev.posted.left_out.some((x) => /not a tool it may draft into/.test(x)), rev.posted);
  await mgr.post(`${A}/agents/${kitA.id}`, { brief: draftBrief({ item: "gold", qty: 5 }) + draftBrief({ item: "clip", qty: 500 }) });
  before = await lastReview();
  await mgr.post(`${A}/agents/${kitA.id}/review`);
  rev = await reviewAfter(kitA.id, before);
  t("nor with fields the tool does not take, each said in words", !rev.posted.records && rev.posted.left_out.some((x) => /Item is one of paper_white/.test(x)) && rev.posted.left_out.some((x) => /Quantity is at most 50/.test(x)), rev.posted);

  // the tool's own screen: a manager makes it, the floor does not see it
  const fl = (await floor.get(`${P}/api/drafts`)).json;
  t("on the tool's screen the floor sees no drafts and cannot act", fl.can_act === false && fl.drafts.length === 0);
  const ml = (await mgr.get(`${P}/api/drafts`)).json;
  t("a manager sees the draft there, with who drafted it and why", ml.can_act === true && ml.drafts.length === 1 && ml.drafts[0].agent === "Kit agent" && /Blue ran out/.test(ml.drafts[0].why));
  t("the floor cannot make it", (await floor.post(`${P}/api/drafts/${d1.id}/make`)).status === 403 && (await q("SELECT state FROM platform.vsm_record_drafts WHERE id=$1", [d1.id])).rows[0].state === "waiting");
  const reqsBefore = (await q("SELECT count(*)::int n FROM mod_demo_paperline.material_requests")).rows[0].n;
  const made = await mgr.post(`${P}/api/drafts/${d1.id}/make`);
  const mr = made.json && made.json.request;
  t("a manager makes it: the tool's own request, as drafted", made.status === 200 && mr && mr.item === "paper_blue" && mr.qty === 5 && (await q("SELECT count(*)::int n FROM mod_demo_paperline.material_requests")).rows[0].n === reqsBefore + 1, made.json);
  const d1after = (await q("SELECT * FROM platform.vsm_record_drafts WHERE id=$1", [d1.id])).rows[0];
  t("the draft is made, with the tool's own reference", d1after.state === "taken" && d1after.ref === `request ${mr.id}`);
  t("the board's thread says who made it, where", (await q("SELECT count(*)::int n FROM platform.vsm_messages WHERE thread_id=$1 AND words LIKE '%made it in Paper Airplane Line: request%'", [d1.message_id])).rows[0].n === 1);
  t("only once", (await mgr.post(`${P}/api/drafts/${d1.id}/make`)).status === 409 && (await q("SELECT count(*)::int n FROM mod_demo_paperline.material_requests")).rows[0].n === reqsBefore + 1);
  const bd = (await mgr.get(`${A}/board?channel=a:kit-agent`)).json.messages.find((m) => m.id === d1.message_id);
  t("the board shows the draft as made", bd && bd.record && bd.record.state === "taken" && bd.record.ref === `request ${mr.id}`);

  // another draft: a lapsed claim, the floor opened, a decline
  await mgr.post(`${A}/agents/${kitA.id}`, { brief: draftBrief({ item: "clip", qty: 3 }) });
  before = await lastReview();
  await mgr.post(`${A}/agents/${kitA.id}/review`);
  await reviewAfter(kitA.id, before);
  const d2 = (await q("SELECT * FROM platform.vsm_record_drafts WHERE company='demo' AND state='waiting' ORDER BY id DESC LIMIT 1")).rows[0];
  await q("UPDATE platform.vsm_record_drafts SET state='taking', held_by='someone', held_until=now() - interval '1 minute' WHERE id=$1", [d2.id]);
  t("a claim that was never finished lapses back to waiting", (await mgr.get(`${P}/api/drafts`)).json.drafts.find((d) => d.id === d2.id).state === "waiting");
  t("the floor switch is a manager's", (await floor.post(`${A}/draft-tools/paperline`, { floor: true })).status === 403 && (await mgr.post(`${A}/draft-tools/nope`, { floor: true })).status === 404);
  await mgr.post(`${A}/draft-tools/paperline`, { floor: true });
  const fl2 = (await floor.get(`${P}/api/drafts`)).json;
  t("opened to the floor, the floor sees it", fl2.can_act === true && fl2.drafts.some((d) => d.id === d2.id));
  t("a decline needs a line on why", (await floor.post(`${P}/api/drafts/${d2.id}/decline`, {})).status === 400);
  const dec = await floor.post(`${P}/api/drafts/${d2.id}/decline`, { note: "Clips came in this morning." });
  const d2after = (await q("SELECT * FROM platform.vsm_record_drafts WHERE id=$1", [d2.id])).rows[0];
  t("the floor declines it, and the agent will read why", dec.status === 200 && d2after.state === "declined" && d2after.note === "Clips came in this morning.");
  await mgr.post(`${A}/draft-tools/paperline`, { floor: false });

  // withdrawn on the board, expired when nobody makes it
  await mgr.post(`${A}/agents/${kitA.id}`, { brief: draftBrief({ item: "paper_white", qty: 2 }) });
  before = await lastReview(); await mgr.post(`${A}/agents/${kitA.id}/review`); await reviewAfter(kitA.id, before);
  const d3 = (await q("SELECT * FROM platform.vsm_record_drafts WHERE company='demo' AND state='waiting' ORDER BY id DESC LIMIT 1")).rows[0];
  t("the floor cannot withdraw a draft on the board", (await floor.post(`${A}/record-drafts/${d3.message_id}/withdraw`)).status === 403);
  const wd = await mgr.post(`${A}/record-drafts/${d3.message_id}/withdraw`);
  t("a manager withdraws it there, and the tool no longer offers it", wd.status === 200 && !(await mgr.get(`${P}/api/drafts`)).json.drafts.some((d) => d.id === d3.id) && (await mgr.post(`${A}/record-drafts/${d3.message_id}/withdraw`)).status === 409);
  await mgr.post(`${A}/agents/${kitA.id}`, { brief: draftBrief({ item: "paper_yellow", qty: 2 }) });
  before = await lastReview(); await mgr.post(`${A}/agents/${kitA.id}/review`); await reviewAfter(kitA.id, before);
  const d4 = (await q("SELECT * FROM platform.vsm_record_drafts WHERE company='demo' AND state='waiting' ORDER BY id DESC LIMIT 1")).rows[0];
  await q("UPDATE platform.vsm_record_drafts SET created_at = now() - interval '8 days' WHERE id=$1", [d4.id]);
  const gone = await require("../../src/vsm-drafts").sweep();
  t("one nobody makes in a week expires, and the board says so", gone === 1 && (await q("SELECT state FROM platform.vsm_record_drafts WHERE id=$1", [d4.id])).rows[0].state === "expired"
    && (await q("SELECT count(*)::int n FROM platform.vsm_messages WHERE thread_id=$1 AND words LIKE '%expired%'", [d4.message_id])).rows[0].n === 1);
  const rp2 = (() => { const fs = require("fs"); const f = process.env.SOS_PROMPT_LOG; return f && fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((p) => p.kind === "agent-review" && /You are: Kit agent/.test(JSON.stringify(p.messages))).pop() : null; })();
  t("the agent reads what became of its drafts, a decline's words too", !process.env.SOS_PROMPT_LOG || (rp2 && /Your recent drafts/.test(JSON.stringify(rp2.messages)) && /Clips came in this morning/.test(JSON.stringify(rp2.messages))));

  // ---- another company, the record, the backup, the export, the delete
  const madeCo = await admin.post("/api/admin/companies", { slug: "a3co", name: "A3 Co" });
  const other = await login(madeCo.json.passwords.manager, "a3co");
  t("another company reaches none of it", (await other.get(`${A}/steps`)).status === 403 && (await other.post(`${A}/draft-tools/paperline`, { floor: true })).status === 403
    && (await other.post(`/api/c/a3co/vsm/record-drafts/${d1.message_id}/withdraw`)).status === 404 && (await other.post(`/api/c/a3co/vsm/draft-tools/paperline`, { floor: true })).status === 404);
  const kinds = (await q("SELECT DISTINCT kind FROM platform.record WHERE company='demo'")).rows.map((r) => r.kind);
  t("on the record: drafted, made, declined, withdrawn, the floor switch", ["agent_record_drafted", "agent_draft_taken", "agent_draft_declined", "agent_draft_withdrawn", "agent_drafts_floor"].every((k) => kinds.includes(k)), kinds);
  t("no word on the board carries a long dash", !/[\u2013\u2014]/.test(JSON.stringify((await q("SELECT words FROM platform.vsm_messages")).rows)));
  const bk = await admin.get("/api/admin/backup");
  t("drafts, the floor switch and the stage events are in the backup", bk.status === 200 && ["vsm_record_drafts", "vsm_tool_settings", "vsm_stage_events"].every((k) => Array.isArray(bk.json.platform[k]) && bk.json.platform[k].some((r) => r.company === "demo")));
  await q("INSERT INTO platform.vsm_stage_events (company, module, step, ref, kind) VALUES ('a3co','paperline','x','y','start')");
  await require("../../src/vsm").deleteCompany("a3co");
  t("they go with the company, another's stay", (await q("SELECT count(*)::int n FROM platform.vsm_stage_events WHERE company='a3co'")).rows[0].n === 0 && (await q("SELECT count(*)::int n FROM platform.vsm_stage_events WHERE company='demo'")).rows[0].n > 10);
})().then(() => R.done()).catch(R.abort);
