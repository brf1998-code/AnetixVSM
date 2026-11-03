// End to end for VSM M3 (src/vsm-kaizen.js: the Map and the Kaizen board joined, the future state) and the floor's side
// of the map and the agent board (src/vsm-floor.js: who each screen is for, a box's station screen, the agent's line).
// What it proves: a kaizen burst becomes a change to one of its box's tools (the proposer reads it), a plant request (no
// AI, never a request to Anetix), or a new tool request pre-filled from the box; a box takes a request the same three
// ways; a plant request moves to Working on it and closes, or becomes a new tool request; the board says which box each
// request sits on; a burst is put away and brought back; the agent drafts a future state beside the current map, every
// part checked against the map and what it left out said, the live numbers left out under the data wall; drafting it
// again keeps the earlier one hidden; it is kept; a burst on it files on the current map's box; agents and the walk never
// read a future map; a manager tags a screen, and picking a box's station screen tags it the floor's; the agent's line
// shows on that screen only with its switch on, only live, the most urgent flag first, and a floor device's look is
// counted; the floor and another company reach none of the rest; the record, the backup, the status counts, the delete.
// Against a server ALREADY UP in fake-agent mode on a fresh database, with SOS_WATCH_MS=0.
const { PW, runner, login } = require("./lib");
const { q } = require("../../src/db");
const fs = require("fs");
const R = runner(), t = R.t;
const A = "/api/c/demo/vsm", P = "/c/demo/m/paperline";
const MAP = { format: "anetix-map-1", stages: [{ ref: "01", name: "Plan" }, { ref: "02", name: "Kit the order" }, { ref: "03", name: "Check the kit" }], maps: [{ key: "planes", family: "Planes", title: "Planes",
  nodes: [
    { key: "plan", kind: "control", label: "Plan the day", who: "Dana", record_kind: "other", record_system: "Fishbowl", x: 500, y: 40 },
    { key: "stock", kind: "process", label: "Stockroom", modules: ["paperline"], record_kind: "anetix", who: "Lee", x: 60, y: 240, detail: { quote: "We count the paper by hand every morning", quote_by: "Lee" } },
    { key: "kit", kind: "process", label: "Kitting", who: "Kai", record_kind: "paper", record_system: "a clipboard", stage_refs: ["02", "03"], x: 280, y: 240, data: [{ label: "C/T", value: "?" }], detail: { what: "Pulls the paper for each job", missing: "Which kit is short" } },
    { key: "asm", kind: "process", label: "Assembly", modules: ["paperline"], record_kind: "anetix", x: 500, y: 240, detail: { agent_name: "Line agent", steps: [{ module: "paperline", step: "Kit and Crease" }] } },
    { key: "ship", kind: "process", label: "Ship", record_kind: "none", x: 720, y: 240 },
    { key: "cus", kind: "customer", label: "Customers", x: 900, y: 20 } ],
  edges: [{ from: "plan", to: "kit", kind: "info_word", label: "Dana tells them" }, { from: "stock", to: "kit", kind: "supply" }, { from: "kit", to: "asm", kind: "push", inventory: { label: "2 days" } },
    { from: "asm", to: "ship", kind: "push" }, { from: "ship", to: "cus", kind: "ship" }],
  kaizen: [{ node: "kit", n: 1, title: "A kit cart at each station", why: "Kai walks for paper." }, { node: "asm", n: 2, title: "The station screen shows the next job", why: "Nobody knows what is next." }, { node: "ship", n: 3, title: "A shipping log", why: "Nothing kept." }] }] };
const prompts = () => { const f = process.env.SOS_PROMPT_LOG; return f && fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []; };

(async () => {
  const mgr = await login(PW.manager, "demo"), floor = await login(PW.floor, "demo"), admin = await login(PW.admin, "");
  await admin.post(`${A}/import`, MAP);
  let ov = (await mgr.get(A)).json;
  const mapId = ov.maps.find((m) => m.key === "planes").id;
  let mv = (await mgr.get(`${A}/maps/${mapId}`)).json;
  const node = (k) => mv.nodes.find((n) => n.key === k), burst = (n) => mv.kaizen.find((z) => z.n === n);
  t("a map's view carries its cards, its future state and every live screen", Array.isArray(mv.cards) && mv.cards.length === 0 && mv.future && mv.future.future === null && !mv.future.drafting
    && mv.screens.paperline && mv.screens.paperline.length === 4 && mv.screens.kpis, Object.keys(mv));

  // ---- a burst becomes a change to its box's tool
  const ch = await mgr.post(`${A}/kaizen/${burst(2).id}/file`, { as: "change", tool: "paperline" });
  const fbc = ch.json && (await q("SELECT * FROM platform.feedback WHERE id=$1", [ch.json.feedback_id])).rows[0];
  t("a burst on a box with a tool becomes a change to that tool, on that box", ch.status === 200 && fbc && fbc.module === "paperline" && fbc.kind === "feedback" && fbc.map_key === "planes" && fbc.node_key === "asm"
    && fbc.source === "map" && fbc.source_ref === burst(2).id && /next job/.test(fbc.message) && fbc.screen === "Map: Assembly", fbc);
  t("the proposer reads it on arrival, as any request", ch.json.proposing === true);
  t("it is that burst's request now, and not twice", (await mgr.post(`${A}/kaizen/${burst(2).id}/file`, { as: "plant" })).status === 409);
  t("a change goes only to a tool on the box", (await mgr.post(`${A}/kaizen/${burst(1).id}/file`, { as: "change", tool: "paperline" })).status === 400
    && (await mgr.post(`${A}/kaizen/${burst(2).id}/file`, { as: "change", tool: "kpis" })).status === 409);

  // ---- a plant request: no tool, no AI, never a request to Anetix
  const pl = await mgr.post(`${A}/kaizen/${burst(1).id}/file`, { as: "plant", words: "Put a kit cart at each station" });
  const fbp = (await q("SELECT * FROM platform.feedback WHERE id=$1", [pl.json.feedback_id])).rows[0];
  t("a burst on a box with no tool becomes a plant request on the box", pl.status === 200 && fbp.kind === "plant" && fbp.module === null && fbp.node_key === "kit" && fbp.message === "Put a kit cart at each station" && fbp.arrival === null, fbp);
  t("it is not a request to Anetix", !(await mgr.get("/api/c/demo/feedback/platform")).json.some((f) => f.id === fbp.id) && !((await admin.get("/api/admin/requests")).json.requests || []).some((f) => f.id === fbp.id));
  t("the proposer never reads it", (await mgr.post(`/api/feedback/${fbp.id}/review`)).status >= 400 && (await q("SELECT count(*)::int n FROM platform.proposals WHERE feedback_id=$1", [fbp.id])).rows[0].n === 0);
  const wk = await mgr.post(`${A}/plant/${fbp.id}/status`, { status: "in_progress" });
  t("a manager moves it to Working on it, and back", wk.status === 200 && (await q("SELECT status FROM platform.feedback WHERE id=$1", [fbp.id])).rows[0].status === "in_progress" && (await mgr.post(`${A}/plant/${fbp.id}/status`, { status: "new" })).status === 200);
  t("closing it is Done or Not doing this, not a status here", (await mgr.post(`${A}/plant/${fbp.id}/status`, { status: "done" })).status === 400);
  await mgr.post(`/api/feedback/${fbp.id}/close`, { outcome: "Carts are in", declined: false });
  t("Done closes it like any card, and a closed one does not move", (await q("SELECT status, outcome FROM platform.feedback WHERE id=$1", [fbp.id])).rows[0].outcome === "Carts are in" && (await mgr.post(`${A}/plant/${fbp.id}/status`, { status: "in_progress" })).status === 409);

  // ---- a new tool request, pre-filled from the box
  const nt = await mgr.post(`${A}/nodes/${node("kit").id}/request`, { as: "new_tool", words: "Track kits so nobody walks for paper" });
  const it = nt.json && (await q("SELECT * FROM platform.module_intakes WHERE id=$1", [nt.json.intake_id])).rows[0];
  const ntf = it && (await q("SELECT * FROM platform.feedback WHERE id=$1", [it.feedback_id])).rows[0];
  t("a box starts a new tool request, its first answers from the box", nt.status === 200 && it && /Track kits/.test(it.answers.purpose) && /On the map: Kitting/.test(it.answers.purpose) && it.answers.who.floor === ""
    && it.answers.today.picks[0] === "paper" && it.answers.stages.join("|") === "Kit the order|Check the kit" && ntf.kind === "module_request" && ntf.node_key === "kit", it && it.answers);
  const iv = (await mgr.get(`/api/intakes/${it.id}`)).json;
  t("the popout shows them answered, the name left to the manager", iv && iv.answers && iv.answers.purpose && !iv.answers.name, iv && Object.keys(iv));
  const pl2 = await mgr.post(`${A}/nodes/${node("ship").id}/request`, { as: "plant", words: "Write down each shipment" });
  const tt = await mgr.post(`${A}/plant/${pl2.json.feedback_id}/new-tool`);
  const f2 = (await q("SELECT status, outcome FROM platform.feedback WHERE id=$1", [pl2.json.feedback_id])).rows[0];
  const it2 = (await q("SELECT answers FROM platform.module_intakes WHERE id=$1", [tt.json.intake_id])).rows[0];
  t("a plant request becomes a new tool request from its box, and closes pointing at it", tt.status === 200 && f2.status === "done" && new RegExp(`#${tt.json.feedback_id}`).test(f2.outcome) && /Write down each shipment/.test(it2.answers.purpose) && it2.answers.today.picks[0] === "none", { f2, it2 });
  t("words are needed, and a request from the map is one of the three", (await mgr.post(`${A}/nodes/${node("ship").id}/request`, { as: "plant", words: " " })).status === 400 && (await mgr.post(`${A}/nodes/${node("ship").id}/request`, { as: "fix", words: "x" })).status === 400);
  for (const id of [it.id, tt.json.intake_id]) await mgr.post(`/api/intakes/${id}/abandon`);

  // ---- the board and the map show the box
  const board = (await mgr.get("/api/c/demo/board")).json;
  t("the board says which box each request sits on, with its map", board.boxes["planes/asm"] && board.boxes["planes/asm"].label === "Assembly" && board.boxes["planes/asm"].map_id === mapId && board.boxes["planes/kit"].label === "Kitting");
  t("a plant request is a card on the board", board.feedback.some((f) => f.id === fbp.id && f.kind === "plant"));
  mv = (await mgr.get(`${A}/maps/${mapId}`)).json;
  t("the map lists the cards on its boxes, and each burst's card and where it is", mv.cards.some((c) => c.id === fbc.id && c.node_key === "asm") && mv.cards.some((c) => c.id === fbp.id && c.kind === "plant")
    && burst(2).status === "filed" && burst(2).feedback_id === fbc.id && burst(2).card_module === "paperline" && burst(1).card_status === "done", mv.kaizen);
  const dz = await mgr.post(`${A}/kaizen/${burst(3).id}/dismiss`);
  t("a burst is put away, and brought back", dz.status === 200 && (await q("SELECT status FROM platform.vsm_kaizen WHERE id=$1", [burst(3).id])).rows[0].status === "dismissed"
    && (await mgr.post(`${A}/kaizen/${burst(3).id}/restore`)).status === 200 && (await mgr.post(`${A}/kaizen/${burst(2).id}/dismiss`)).status === 409);

  // ---- the floor and another company reach none of it
  t("the floor reads no map and files nothing from it", (await floor.get(`${A}/maps/${mapId}`)).status === 403 && (await floor.post(`${A}/kaizen/${burst(3).id}/file`, { as: "plant" })).status === 403
    && (await floor.post(`${A}/nodes/${node("ship").id}/request`, { as: "plant", words: "x" })).status === 403 && (await floor.post(`${A}/maps/${mapId}/future`)).status === 403 && (await floor.post(`${A}/plant/${fbp.id}/status`, { status: "new" })).status === 403);

  // ---- the future state, drafted by the agent
  await q("UPDATE mod_demo_paperline.inventory SET qty=500");
  await mgr.post(`${P}/api/settings`, { release_per_shift: 2 });
  await mgr.post(`${P}/api/shift/start`);
  const trav = (await q("SELECT id FROM mod_demo_paperline.travelers ORDER BY id")).rows;
  await floor.post(`${P}/api/travelers/${trav[0].id}/complete`, { operator: "Kai" });
  const before = prompts().length;
  const fu = await mgr.post(`${A}/maps/${mapId}/future?wait=1`);
  ov = (await mgr.get(A)).json;
  const fm = ov.maps.find((m) => m.state === "future");
  t("the agent drafts the future state beside the current map", fu.status === 200 && fm && fm.parent_key === "planes" && fm.family === "Planes" && fm.status === "draft", ov.maps);
  let fv = (await mgr.get(`${A}/maps/${fm.id}`)).json;
  t("the same boxes; a flow changed; a record changed, as a guess", fv.nodes.length === 6 && fv.edges.some((e) => e.from_key === "stock" && e.to_key === "kit" && e.kind === "pull")
    && fv.nodes.find((n) => n.key === "kit").record_kind === "anetix" && fv.nodes.find((n) => n.key === "kit").confidence === "assumed", fv.edges);
  t("its bursts are the agent's, each with its evidence; the one the map does not hold up is left out and said", fv.kaizen.length >= 2 && fv.kaizen.every((z) => z.source === "agent" && z.evidence && z.evidence.kind)
    && fv.future.left_out.length === 1 && /not on the map/.test(fv.future.left_out[0]) && fv.future.summary && fv.future.parent.id === mapId, fv.future);
  t("a future state shows no live numbers and asks no questions of its own", fv.live === null && fv.questions.length === 0 && !fv.nodes.find((n) => n.key === "asm").detail.steps);
  const fp = prompts().slice(before).find((p) => p.kind === "structured:map_future");
  t("it read the current map: the boxes, the quotes, the flows and today's live numbers", !process.env.SOS_PROMPT_LOG || (fp && /\[kit\] Kitting/.test(fp.prompt) && /We count the paper by hand/.test(fp.prompt) && /plan -> kit: info_word/.test(fp.prompt) && /live, last 7 days/.test(fp.prompt)), fp && fp.prompt.slice(0, 300));
  t("the current map says its future state is there", (await mgr.get(`${A}/maps/${mapId}`)).json.future.future.id === fm.id);
  const ag = (await mgr.get(`${A}/agents`)).json.agents.find((a) => a.key === "line-agent");
  t("no agent watches a future map", ag && ag.boxes.length === 1 && ag.boxes[0].map_key === "planes", ag && ag.boxes);
  // under the data wall the live numbers are left out
  await admin.post("/api/admin/companies/demo/data-wall", { walled: true });
  const b2 = prompts().length;
  await mgr.post(`${A}/maps/${mapId}/future?wait=1`);
  await admin.post("/api/admin/companies/demo/data-wall", { walled: false });
  const fp2 = prompts().slice(b2).find((p) => p.kind === "structured:map_future");
  t("under the data wall the draft reads the map, not the tools' live numbers", !process.env.SOS_PROMPT_LOG || (fp2 && /\[kit\] Kitting/.test(fp2.prompt) && !/live, last/.test(fp2.prompt) && /walled off/.test(fp2.prompt + fp2.system)), fp2 && fp2.prompt.slice(-300));
  ov = (await mgr.get(A)).json;
  const fm2 = ov.maps.find((m) => m.state === "future");
  t("drafting it again keeps one future state in view, the earlier one hidden", ov.maps.filter((m) => m.state === "future").length === 1 && fm2.id !== fm.id
    && (await q("SELECT replaced_at FROM platform.vsm_maps WHERE id=$1", [fm.id])).rows[0].replaced_at !== null);
  t("a burst on the hidden one is gone with it", (await mgr.post(`${A}/kaizen/${fv.kaizen[0].id}/file`, { as: "plant" })).status === 409);
  fv = (await mgr.get(`${A}/maps/${fm2.id}`)).json;
  const fz = fv.kaizen.find((z) => z.node_key === "stock") || fv.kaizen[0];
  const ff = await mgr.post(`${A}/kaizen/${fz.id}/file`, { as: "plant" });
  t("a burst on the future state files on the same box of the current map", ff.status === 200 && (await q("SELECT map_key, node_key FROM platform.feedback WHERE id=$1", [ff.json.feedback_id])).rows[0].map_key === "planes");
  t("a future state is kept", (await mgr.post(`${A}/maps/${fm2.id}/keep`)).json.status === "confirmed" && (await q("SELECT status FROM platform.vsm_maps WHERE id=$1", [fm2.id])).rows[0].status === "confirmed");
  t("a future state is not drafted from a future state", (await mgr.post(`${A}/maps/${fm2.id}/future`)).status === 400);
  const ex = (await mgr.get(`${A}/export`)).json;
  t("the export carries the future state and its parent, and each burst's evidence", ex.maps.some((m) => m.state === "future" && m.parent === "planes" && m.kaizen.some((z) => z.source === "agent" && z.evidence)));

  // ---- who a screen is for
  t("a manager tags a screen; only a screen of the tool's live version", (await mgr.post("/api/c/demo/screens/paperline/tag", { route: "/nope", for: "floor" })).status === 400
    && (await mgr.post("/api/c/demo/screens/paperline/tag", { route: "/", for: "kitchen" })).status === 400 && (await floor.post("/api/c/demo/screens/paperline/tag", { route: "/", for: "office" })).status === 403);
  const tg = await mgr.post("/api/c/demo/screens/paperline/tag", { route: "/", for: "office" });
  const pages = (await mgr.get("/api/c/demo/board")).json.pages.paperline.live;
  t("the board's screens carry the tag, the manager's marked", tg.status === 200 && pages.find((p) => p.route === "/").for === "office" && pages.find((p) => p.route === "/").tag_by_manager && pages.find((p) => p.route === "/stock").for === null);
  const csp = (await mgr.get(`${P}/`)).headers.get("content-security-policy") || "";
  t("a tool's own page cannot reach the tag route", /connect-src/.test(csp) && !/\/screens\//.test(csp) && /\/who\//.test(csp));

  // ---- a box's station screen
  mv = (await mgr.get(`${A}/maps/${mapId}`)).json;
  const asmId = node("asm").id;
  t("a station screen is a live screen of one of the box's own tools", (await mgr.post(`${A}/nodes/${asmId}`, { screen: { module: "kpis", route: "/" } })).status === 400
    && (await mgr.post(`${A}/nodes/${asmId}`, { screen: { module: "paperline", route: "/gone" } })).status === 400);
  const ss = await mgr.post(`${A}/nodes/${asmId}`, { screen: { module: "paperline", route: "/station/:seq" } });
  t("picking it keeps the box's other words, and tags an untagged screen the floor's", ss.status === 200 && ss.json.node.detail.screen.route === "/station/:seq" && ss.json.node.detail.agent_name === "Line agent" && ss.json.node.detail.steps.length === 1
    && (await q("SELECT for_who FROM platform.screen_tags WHERE company='demo' AND module='paperline' AND route='/station/:seq'")).rows[0].for_who === "floor");

  // ---- the agent's line on the floor's screen
  await mgr.post(`${A}/agents`, { key: "line-agent" });
  const la = (await mgr.get(`${A}/agents`)).json.agents.find((a) => a.key === "line-agent");
  const flag = async (words, severity) => {
    const m = (await q(`INSERT INTO platform.vsm_messages (company, channel, kind, severity, from_kind, from_name, agent_id, words) VALUES ('demo',$1,'flag',$2,'watch',$3,$4,$5) RETURNING id`, [`a:${la.key}`, severity, la.name, la.id, words])).rows[0];
    await q(`INSERT INTO platform.vsm_flags (thread_id, company, agent_id, channel, status, severity, count, boxes) VALUES ($1,'demo',$2,$3,'open',$4,1,'["planes/asm"]'::jsonb)`, [m.id, la.id, `a:${la.key}`, severity]);
    return m.id;
  };
  const f1 = await flag("Traveler 1001 has waited 9 hours at Kit and Crease", "look");
  const line = async (who, page) => (await who.get(`/api/c/demo/who/line?module=paperline&page=${encodeURIComponent(page)}`)).json;
  t("with the switch off, no line", la.floor_line === false && (await line(floor, `${P}/station/2`)).line === null);
  const on = await mgr.post(`${A}/agents/${la.id}`, { floor_line: true });
  t("the floor's switch is a manager's", (await floor.post(`${A}/agents/${la.id}`, { floor_line: false })).status === 403 && on.status === 200
    && (await q("SELECT count(*)::int n FROM platform.vsm_messages WHERE channel=$1 AND from_kind='platform' AND words LIKE '%line on the floor%'", [`a:${la.key}`])).rows[0].n === 1);
  let ln = await line(floor, `${P}/station/2`);
  t("switched on, its open flag is one line on its box's station screen", ln.line && /Traveler 1001/.test(ln.line.words) && ln.line.severity === "look" && ln.line.agent === "Line agent" && ln.line.since_min >= 0, ln);
  t("on that screen only: not another screen, not a preview, not the test floor, not another tool", (await line(floor, `${P}/stock`)).line === null && (await line(floor, "/c/demo/staging/m/paperline/station/2")).line === null
    && (await line(floor, "/c/demo/test/m/paperline/station/2")).line === null && (await floor.get(`/api/c/demo/who/line?module=kpis&page=${encodeURIComponent("/c/demo/m/kpis/")}`)).json.line === null);
  const v1 = (await q("SELECT floor_views FROM platform.vsm_flags WHERE thread_id=$1", [f1])).rows[0].floor_views;
  await line(floor, `${P}/station/3`); await line(mgr, `${P}/station/2`);
  t("a floor device's look is counted once in ten minutes; a manager's not at all", v1 === 1 && (await q("SELECT floor_views FROM platform.vsm_flags WHERE thread_id=$1", [f1])).rows[0].floor_views === 1);
  const f2a = await flag("Six travelers are open at Kit and Crease", "act");
  ln = await line(floor, `${P}/station/2`);
  t("the most urgent flag is the line: act before look", /Six travelers/.test(ln.line.words) && ln.line.severity === "act");
  await q("UPDATE platform.vsm_flags SET status='resolved', closed_at=now() WHERE thread_id=$1", [f2a]);
  t("a closed flag leaves the line to the next", /Traveler 1001/.test((await line(floor, `${P}/station/2`)).line.words));
  await q("UPDATE platform.vsm_messages SET words=$2 WHERE id=$1", [f1, `Traveler 1001 \u2014 ${"waited ".repeat(40)}`]);
  ln = await line(floor, `${P}/station/2`);
  t("the line is cut to a line, with no long dash", ln.line.words.length <= 160 && !/[\u2013\u2014]/.test(ln.line.words), ln.line.words);
  await mgr.post(`${A}/agents/${la.id}`, { status: "paused" });
  t("a paused agent shows nothing", (await line(floor, `${P}/station/2`)).line === null);
  await mgr.post(`${A}/agents/${la.id}`, { status: "on" });
  const la2 = (await mgr.get(`${A}/agents`)).json.agents.find((a) => a.key === "line-agent");
  t("the agent board lists its station screens and how often the floor saw its flags", la2.floor_line === true && la2.stations.length === 1 && la2.stations[0].box === "Assembly" && la2.stations[0].screen === "Station page (operator, on a phone)" && la2.floor_shown_7d && la2.floor_shown_7d.views >= 1, la2.stations);
  const st = await require("../../src/mcp-vsm").tools.find((x) => x.name === "agent_board_status").run({ company: "demo" });
  const sc = st.companies[0];
  t("the admin connector counts it: the line's switch and the floor's looks, the map's requests", sc.agents.some((a) => a.floor_line === true && a.floor_views_7d >= 1) && sc.map_requests.bursts_filed >= 3 && sc.map_requests.requests_on_a_box >= 4 && !JSON.stringify(st).includes("Traveler 1001"), sc.map_requests);

  // ---- another company, the record, the backup, the delete
  const madeCo = await admin.post("/api/admin/companies", { slug: "m3co", name: "M3 Co" });
  const other = await login(madeCo.json.passwords.manager, "m3co");
  t("another company reaches none of it", (await other.post(`${A}/kaizen/${burst(3).id}/file`, { as: "plant" })).status === 403 && (await other.post(`/api/c/m3co/vsm/kaizen/${burst(3).id}/file`, { as: "plant" })).status === 404
    && (await other.post(`/api/c/m3co/vsm/maps/${mapId}/future`)).status === 404 && (await other.get(`/api/c/demo/who/line?module=paperline&page=${encodeURIComponent(`${P}/station/2`)}`)).status === 403
    && (await other.post(`/api/c/m3co/vsm/plant/${fbp.id}/status`, { status: "new" })).status === 404 && (await other.post("/api/c/m3co/screens/paperline/tag", { route: "/", for: "floor" })).status === 404);
  const kinds = (await q("SELECT DISTINCT kind FROM platform.record WHERE company='demo'")).rows.map((r) => r.kind);
  t("on the record: filed from the map, put away, a new tool from a box, the future drafted and kept, a screen tagged", ["kaizen_filed", "kaizen_put_away", "kaizen_brought_back", "intake_started_from_map", "plant_request_moved", "map_future_asked", "map_future_drafted", "map_future_kept", "screen_tagged"].every((k) => kinds.includes(k)), kinds);
  const bk = await admin.get("/api/admin/backup");
  t("the screen tags are in the backup", bk.status === 200 && Array.isArray(bk.json.platform.screen_tags) && bk.json.platform.screen_tags.some((r) => r.company === "demo"));
  await q("INSERT INTO platform.screen_tags (company, module, route, for_who) VALUES ('m3co','x','/','floor')");
  await require("../../src/vsm").deleteCompany("m3co");
  t("they go with the company, another's stay", (await q("SELECT count(*)::int n FROM platform.screen_tags WHERE company='m3co'")).rows[0].n === 0 && (await q("SELECT count(*)::int n FROM platform.screen_tags WHERE company='demo'")).rows[0].n === 2);
})().then(() => R.done()).catch(R.abort);
