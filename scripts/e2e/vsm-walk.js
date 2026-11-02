// End to end for the mapping walk, M2 (src/vsm-walk.js, public/map.html, docs/VSM.md section 5; 2026-11-01).
// What it proves: the floor reaches no walk; a manager adds words and files (checked for kind and size), and a file is
// kept only after the scanner's word; the read runs on the sources, fails in words and is read again; under the data
// wall a pdf is named to the model and never sent, the typed words still are; every screen of the walk is answered in
// order, a stale screen is refused, a card is checked (an Anetix record needs its tool, a tool must be the company's);
// the draft is drawn beside the family's map with its flows and review questions and counts in nothing until it is
// used; changing the walk and drawing again replaces only its own draft; "Use this map" replaces the family's map and
// keeps the old one hidden; another family starts from the same sources without a second read; putting a walk away
// takes its draft with it; another company reaches none of it; a manager reads no model and no cost; every step is on
// the record; the walk travels in the backup and goes with the company.
// Against a server ALREADY UP in fake-agent mode on a fresh database, with SOS_PROMPT_LOG set (run-all.sh has the line).
const fs = require("fs");
const { PW, runner, login, waitFor } = require("./lib");
const { q } = require("../../src/db");
const R = runner(), t = R.t;
const LOG = process.env.SOS_PROMPT_LOG;
const W = (slug = "demo") => `/api/c/${slug}/vsm/walks`;

// the plant's hand-drawn map, so the walk has a family's map to sit beside and replace
const HAND = {
  format: "anetix-map-1",
  stages: [{ ref: "01", name: "Order entry", record_kind: "other", record_system: "Fishbowl" }, { ref: "02", name: "Build", record_kind: "none" }],
  maps: [{ key: "widgets-hand", family: "Widgets", title: "Widgets", nodes: [{ key: "a", kind: "process", label: "Build", x: 200, y: 300 }, { key: "cus", kind: "customer", label: "Shops", x: 500, y: 40 }],
    edges: [{ from: "a", to: "cus", kind: "ship" }], kaizen: [{ n: 1, node: "a", title: "Write it down" }] }],
  questions: [{ map: "widgets-hand", node: "a", where: "Build", claim: "Build is one step" }],
};

(async () => {
  const mgr = await login(PW.manager, "demo"), floor = await login(PW.floor, "demo"), admin = await login(PW.admin, "");
  const promptsBefore = () => (LOG && fs.existsSync(LOG) ? fs.readFileSync(LOG, "utf8").split("\n").filter(Boolean).length : 0);

  // ---- who reaches it
  t("the floor cannot start or read a walk", (await floor.post(W(), {})).status === 403 && (await floor.get(W())).status === 403);
  t("an admin imports the plant's hand-drawn map first", (await admin.post("/api/c/demo/vsm/import", HAND)).status === 200);
  const st = await mgr.post(W(), {});
  const id = st.json.walk && st.json.walk.id;
  t("a manager starts a walk: it opens on its sources", st.status === 200 && id > 0 && st.json.walk.status === "sources" && st.json.walk.screen.kind === "sources" && st.json.walk.via === "board", st.text.slice(0, 300));
  t("a manager reads no model and no cost", st.json.walk.model === undefined && st.json.walk.cost_usd === undefined);
  t("the walk shows on the map's overview as open", (await mgr.get("/api/c/demo/vsm")).json.walks.some((w) => w.id === id && w.open));

  // ---- sources
  t("reading with no source is refused in words", (await mgr.post(`${W()}/${id}/read`)).status === 400);
  t("no words is refused", (await mgr.post(`${W()}/${id}/words`, { title: "x", words: "   " })).status === 400);
  t("words past what one source takes are refused", (await mgr.post(`${W()}/${id}/words`, { title: "huge", words: "x".repeat(300001) })).status === 400);
  const w1 = await mgr.post(`${W()}/${id}/words`, { title: "Walk-through with Dana and Lee", kind: "transcript", words: "Dana: we ship every afternoon. Lee: I pull from the list. WORDCANARY-55" });
  t("a transcript is added as a source", w1.status === 200 && w1.json.walk.sources.length === 1 && w1.json.walk.sources[0].kind === "transcript" && w1.json.walk.sources[0].chars > 40, w1.text.slice(0, 300));
  t("a source's words are not sent back to the page", !w1.text.includes("WORDCANARY-55"));
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\nPDFCANARY-31").toString("base64");
  const f1 = await mgr.post(`${W()}/${id}/file`, { filename: "process.pdf", mime: "application/pdf", data: pdf });
  t("a pdf is added and kept as a file, with the scanner's word beside it", f1.status === 200 && f1.json.walk.sources.some((s) => s.kind === "pdf" && s.file)
    && (await q("SELECT scan FROM platform.attachments WHERE walk_id=$1", [id])).rows[0].scan === "unscanned", f1.text.slice(0, 300));
  const f2 = await mgr.post(`${W()}/${id}/file`, { filename: "notes.txt", mime: "text/plain", data: Buffer.from("Sam tests every widget for a day.").toString("base64") });
  t("a text file becomes words, and no file is kept for it", f2.status === 200 && f2.json.walk.sources.some((s) => s.title === "notes.txt" && !s.file && s.chars > 10) && (await q("SELECT count(*)::int n FROM platform.attachments WHERE walk_id=$1", [id])).rows[0].n === 1);
  t("a Word file is refused in words", (await mgr.post(`${W()}/${id}/file`, { filename: "spec.docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", data: pdf })).status === 400);
  const extra = await mgr.post(`${W()}/${id}/words`, { title: "Wrong one", words: "FAILREAD" });
  const extraId = extra.json.walk.sources.find((s) => s.title === "Wrong one").id;

  // ---- the read: a failure in words, then read again
  const r1 = await mgr.post(`${W()}/${id}/read`);
  t("the read starts", r1.status === 200 && ["reading", "failed"].includes(r1.json.walk.status));
  const failed = await waitFor("the read to fail", async () => { const v = (await mgr.get(`${W()}/${id}`)).json.walk; return v.status === "failed" ? v : null; });
  t("a read that fails says so in words and goes back to the sources", failed.screen.kind === "sources" && /Read again/.test(failed.problem || ""), failed.problem);
  t("a source can be taken off before reading again", (await mgr.post(`${W()}/${id}/sources/${extraId}/remove`)).status === 200);
  // the data wall: the typed words still go, the pdf is named and never sent
  await admin.post("/api/admin/companies/demo/data-wall", { walled: true });
  const before = promptsBefore();
  await mgr.post(`${W()}/${id}/read`);
  const read = await waitFor("the read", async () => { const v = (await mgr.get(`${W()}/${id}`)).json.walk; return v.status === "walking" ? v : null; });
  await admin.post("/api/admin/companies/demo/data-wall", { walled: false });
  t("after the read the walk asks which family", read.screen.kind === "family" && read.found.steps === 5 && read.found.systems.length === 2, read.screen);
  if (LOG) {
    const lines = fs.readFileSync(LOG, "utf8").split("\n").filter(Boolean).slice(before).map((l) => JSON.parse(l)).filter((l) => l.kind === "structured:map_extract");
    const last = lines[lines.length - 1] || { blocks: [] };
    t("under the data wall the typed words reach the read, the pdf is named and not sent", last.walled === true && last.blocks.some((b) => b.includes("WORDCANARY-55")) && last.blocks.some((b) => /process\.pdf.*withheld/.test(b)) && !last.blocks.some((b) => b === "<document>" || b.includes("PDFCANARY")), last.blocks);
  }
  t("nothing can be added once the sources are read", (await mgr.post(`${W()}/${id}/words`, { title: "late", words: "late words" })).status === 400);
  const fam = read.screen.options.find((o) => o.name === "Widgets");
  t("the family on the map is offered as that family, matched to what the sources found", fam && fam.key === "map:widgets-hand" && fam.on_map === true && fam.ext === "widgets" && fam.steps === 4, read.screen.options);

  // ---- the walk, one screen at a time
  const ans = (body) => mgr.post(`${W()}/${id}/answer`, body);
  t("a screen the walk is not on is refused", (await ans({ screen: "before", pick: "start" })).status === 409);
  let v = (await ans({ screen: "family", family: fam.key })).json.walk;
  t("the customer is asked next, filled from the sources", v.screen.kind === "customer" && v.screen.prefill.demand === "about 40 a week" && v.screen.evidence.quote === "We ship every afternoon.", v.screen);
  v = (await ans({ screen: "customer", who: "Shops", demand: "40 a week", ships: "daily" })).json.walk;
  v = (await ans({ screen: "systems", systems: ["Fishbowl", "QuickBooks", "a whiteboard"] })).json.walk;
  t("then the last step before the customer, the sources' guess first", v.screen.kind === "last" && v.screen.guess.name === "Pack and ship" && v.screen.others.length === 3, v.screen);
  v = (await ans({ screen: "last", pick: v.screen.guess.key })).json.walk;
  t("its card, pre-filled from the sources with the quote", v.screen.kind === "card" && v.screen.position === 1 && v.screen.step.record_system === "Fishbowl" && v.screen.evidence.quote === "We ship every afternoon.", v.screen);
  const packKey = v.screen.key;
  const noTool = await ans({ screen: "card", key: packKey, record_kind: "anetix", tools: [] });
  t("an Anetix record with no tool is refused", noTool.status === 400 && /tool/.test(noTool.json.error));
  const otherTool = await ans({ screen: "card", key: packKey, record_kind: "anetix", tools: ["not-a-tool"] });
  t("a tool that is not the company's is refused, naming the ones it has", otherTool.status === 400 && /Paper Airplane Line/.test(otherTool.json.error), otherTool.json.error);
  v = (await ans({ screen: "card", key: packKey, numbers: [{ label: "C/T", value: "10 min" }], waits_before: "boxes on the bench" })).json.walk;
  t("Looks right: the next question is what comes before it", v.screen.kind === "before" && v.screen.of.name === "Pack and ship" && v.screen.guess.name === "Test", v.screen);
  v = (await ans({ screen: "before", pick: v.screen.guess.key })).json.walk;
  v = (await ans({ screen: "card", key: v.screen.key, unsure: true, note: "Sam may test only some" })).json.walk;
  v = (await ans({ screen: "before", pick: { name: "Wash" } })).json.walk;
  t("a step the sources missed is added by name and gets a card", v.screen.kind === "card" && v.screen.step.name === "Wash" && v.screen.step.added === true);
  const washKey = v.screen.key;
  v = (await ans({ screen: "remove", key: washKey })).json.walk;
  t("a step can be taken off again, and the walk asks again", v.screen.kind === "before" && v.screen.of.name === "Test" && !v.walked.some((s) => s.name === "Wash"));
  v = (await ans({ screen: "before", pick: v.screen.guess.key })).json.walk;   // Assemble
  v = (await ans({ screen: "card", key: v.screen.key })).json.walk;
  v = (await ans({ screen: "before", pick: v.screen.guess.key })).json.walk;   // Kit parts, kept in the company's tool
  t("a step the sources put in an Anetix tool comes with that tool", v.screen.step.record_kind === "anetix" && v.screen.step.tools.length === 1, v.screen.step);
  v = (await ans({ screen: "card", key: v.screen.key })).json.walk;
  t("when the sources have no step left, the walk offers where it starts", v.screen.kind === "before" && v.screen.guess === null);
  v = (await ans({ screen: "before", pick: "start" })).json.walk;
  t("then the supplier, filled from the sources", v.screen.kind === "supplier" && v.screen.prefill.name === "Parts supplier" && v.screen.first === "Kit parts", v.screen);
  v = (await ans({ screen: "supplier", name: "Acme Parts", what: "parts", how_ordered: "email", record_kind: "paper", record_system: "email" })).json.walk;
  t("then production control, in order", v.screen.kind === "control" && v.screen.prefill.map((c) => c.name).join() === "Order entry,Morning list");
  t("an Anetix control step with no tool is refused", (await ans({ screen: "control", control: [{ name: "Order entry", how: "system", record_kind: "anetix" }] })).status === 400);
  t("more than six control steps are refused", (await ans({ screen: "control", control: Array.from({ length: 7 }, (_, i) => ({ name: `Step ${i}` })) })).status === 400);
  v = (await ans({ screen: "control", control: v.screen.prefill })).json.walk;
  t("the review lists the steps in the order the work moves", v.screen.kind === "review" && v.screen.steps.map((s) => s.name).join() === "Kit parts,Assemble,Test,Pack and ship" && v.screen.left_out.length === 0, v.screen.steps);
  t("every step answered is on the record", (await q("SELECT count(*)::int n FROM platform.record WHERE company='demo' AND kind='map_walk_step'")).rows[0].n >= 4);

  // ---- the draft
  const d1 = await mgr.post(`${W()}/${id}/draft`);
  t("the map is drawn", d1.status === 200 && d1.json.map_id > 0 && d1.json.walk.status === "drafted", d1.text.slice(0, 300));
  const mv = (await mgr.get(`/api/c/demo/vsm/maps/${d1.json.map_id}`)).json;
  const procs = mv.nodes.filter((n) => n.kind === "process").sort((a, b) => a.x - b.x);
  t("a draft beside the family's map, its process row in flow order", mv.map.proposed === true && mv.map.walk_id === id && mv.map.family === "Widgets" && procs.map((n) => n.label).join() === "Kit parts,Assemble,Test,Pack and ship", procs.map((n) => n.label));
  t("supplier, customer and production control are boxes", ["supplier", "customer"].every((k) => mv.nodes.some((n) => n.kind === k)) && mv.nodes.filter((n) => n.kind === "control").length === 2 && mv.nodes.find((n) => n.kind === "supplier").label === "Acme Parts");
  const edge = (from, to) => mv.edges.find((e) => e.from_key === from && e.to_key === to);
  const pk = (name) => procs.find((n) => n.label === name).key;
  t("material is pushed step to step, with what waits before each", edge(pk("Test"), pk("Pack and ship")).kind === "push" && edge(pk("Test"), pk("Pack and ship")).inventory.label === "boxes on the bench" && edge(pk("Kit parts"), pk("Assemble")).inventory.label === "kits on the cart");
  t("the information flows come from each step's trigger", edge("c-c2", pk("Kit parts")).kind === "info_word" && edge("c-c1", pk("Pack and ship")).kind === "info_system" && edge("cus", "c-c1").kind === "info_system");
  t("a step kept in a tool keeps its tool", procs[0].record_kind === "anetix" && procs[0].modules.length === 1);
  t("the data box carries what was said and ? for the rest", procs.find((n) => n.label === "Pack and ship").data.some((d) => d.label === "C/T" && d.value === "10 min") && procs.find((n) => n.label === "Kit parts").data.some((d) => d.label === "C/T" && d.value === "?"));
  const claims = mv.questions.map((x) => x.claim);
  t("every guess is a review question: the unknown numbers, the step the manager was unsure of, the reader's questions", claims.some((c) => /^Kit parts: C\/T/.test(c)) && claims.some((c) => /^Is Test drawn right/.test(c)) && claims.some((c) => /Test takes a day/.test(c)) && !claims.some((c) => /^Pack and ship: C\/T/.test(c)), claims);
  const ov = (await mgr.get("/api/c/demo/vsm")).json;
  t("the overview lists the draft beside the hand map, and its questions are not counted yet", ov.maps.length === 2 && ov.maps.some((m) => m.proposed) && ov.questions_open === 1, ov.questions_open);
  t("the export leaves the draft out", (await mgr.get("/api/c/demo/vsm/export")).json.maps.length === 1);
  t("a drawn walk takes no answers until it is changed again", (await mgr.post(`${W()}/${id}/answer`, { screen: "customer", who: "x" })).status === 400);

  // change the walk and draw again: only this walk's draft is replaced
  await mgr.post(`${W()}/${id}/reopen`);
  await ans({ screen: "card", key: packKey, waits_before: "a pallet" });
  const d2 = await mgr.post(`${W()}/${id}/draft`);
  const drafts = (await q("SELECT id FROM platform.vsm_maps WHERE company='demo' AND proposed")).rows;
  t("drawing again replaces the walk's own draft and nothing else", d2.status === 200 && drafts.length === 1 && drafts[0].id === d2.json.map_id && d2.json.map_id !== d1.json.map_id && (await q("SELECT count(*)::int n FROM platform.vsm_maps WHERE company='demo' AND NOT proposed")).rows[0].n === 1);

  // ---- another company
  const made = await admin.post("/api/admin/companies", { slug: "walkco", name: "Walk Co" });
  const other = await login(made.json.passwords.manager, "walkco");
  t("another company's manager cannot read this company's walk", (await other.get(`${W()}/${id}`)).status === 403 && (await other.get(W())).status === 403);
  t("nor reach it through its own slug", (await other.get(`${W("walkco")}/${id}`)).status === 404 && (await other.post(`${W("walkco")}/${id}/answer`, { screen: "review" })).status === 404 && (await other.post(`${W("walkco")}/${id}/use`)).status === 404);
  t("the ids in the routes take digits only", (await mgr.get(`${W()}/0x1`)).status === 404);

  // ---- use it
  const used = await mgr.post(`${W()}/${id}/use`);
  const ov2 = (await mgr.get("/api/c/demo/vsm")).json;
  const old = (await q("SELECT key, replaced_at FROM platform.vsm_maps WHERE company='demo' AND replaced_at IS NOT NULL")).rows;
  t("Use this map: the draft takes the family's key and title", used.status === 200 && used.json.key === "widgets-hand" && used.json.replaced && ov2.maps.length === 1 && ov2.maps[0].id === d2.json.map_id && ov2.maps[0].title === "Widgets" && !ov2.maps[0].proposed, used.text.slice(0, 300));
  t("the old map is kept, hidden, with its kaizen and review answers moved aside with it", old.length === 1 && /^widgets-hand-r\d+$/.test(old[0].key) && (await q("SELECT count(*)::int n FROM platform.vsm_kaizen k JOIN platform.vsm_maps m ON m.id=k.map_id WHERE m.replaced_at IS NOT NULL")).rows[0].n === 1
    && (await q("SELECT count(*)::int n FROM platform.vsm_questions WHERE map_key=$1", [old[0].key])).rows[0].n === 1);
  t("a company with a stage list keeps it", ov2.stages.length === 2 && used.json.stages_made === 0);
  t("the walk's questions now count", ov2.questions_open > 1);

  // ---- another family from the same sources, without reading again
  const reads = (await q("SELECT count(*)::int n FROM platform.record WHERE company='demo' AND kind='map_walk_read'")).rows[0].n;
  const g = await mgr.post(W(), { from_walk: id });
  const gid = g.json.walk.id;
  t("another family starts from the same sources, already read", g.status === 200 && g.json.walk.status === "walking" && g.json.walk.screen.kind === "family" && g.json.walk.sources.length === 3 && g.json.walk.screen.options.some((o) => o.name === "Gadgets"));
  t("and nothing was read a second time", (await q("SELECT count(*)::int n FROM platform.record WHERE company='demo' AND kind='map_walk_read'")).rows[0].n === reads);
  t("the first walk's file is shared, not copied", (await q("SELECT count(*)::int n FROM platform.attachments WHERE company='demo' AND walk_id IS NOT NULL")).rows[0].n === 1);
  await mgr.post(`${W()}/${gid}/answer`, { screen: "family", family: "ext:gadgets" });
  const ab = await mgr.post(`${W()}/${gid}/abandon`);
  t("a walk is put away, and leaves the overview", ab.status === 200 && ab.json.walk.status === "abandoned" && !(await mgr.get("/api/c/demo/vsm")).json.walks.some((w) => w.id === gid));

  // ---- an admin, the record, the backup, the company delete
  const av = (await admin.get(`${W()}/${id}`)).json.walk;
  t("an admin reads the walk's model and its cost", typeof av.model === "string" && typeof av.cost_usd === "number");
  const kinds = (await q("SELECT DISTINCT kind FROM platform.record WHERE company='demo' AND kind LIKE 'map_%'")).rows.map((r) => r.kind);
  t("the walk is on the record: started, sources, read, steps, drawn, used, put away", ["map_walk_started", "map_source_added", "map_source_removed", "map_walk_reading", "map_walk_read", "map_walk_answered", "map_walk_step", "map_drafted", "map_walk_reopened", "map_walk_used", "map_walk_abandoned"].every((k) => kinds.includes(k)), kinds);
  const bk = await admin.get("/api/admin/backup");
  t("the walks and their sources are in the backup", bk.status === 200 && bk.json.platform.vsm_walks.some((w) => w.id === id) && bk.json.platform.vsm_sources.some((s) => s.walk_id === id));
  const wc = (await other.post(W("walkco"), {})).json.walk;
  await other.post(`${W("walkco")}/${wc.id}/words`, { title: "notes", words: "a few words" });
  await require("../../src/vsm").deleteCompany("walkco");
  t("a company's walks go with the company, another's stay", (await q("SELECT count(*)::int n FROM platform.vsm_walks WHERE company='walkco'")).rows[0].n === 0 && (await q("SELECT count(*)::int n FROM platform.vsm_sources WHERE company='walkco'")).rows[0].n === 0 && (await q("SELECT count(*)::int n FROM platform.vsm_walks WHERE company='demo'")).rows[0].n === 2);
  const page = await mgr.get("/c/demo/map");
  t("the Map page carries the walk", /Start the mapping walk/.test(page.text) && /data-act="w-new"/.test(page.text) && !/[–—]/.test(page.text));
  R.done();
})().catch(R.abort);
