// End to end for the agent board, A2 (src/vsm-review.js, the Disagree watch in src/vsm-agents.js; docs/AGENTS.md).
// What it proves, in fake-agent mode: the floor reaches none of it; setting an agent up drafts its brief; a Disagree watch
// compares two of an agent's tools by their key and clears when they agree; the shift times are checked; a manager turns
// each agent's reviews on; a review posts a note; an urgent flag wakes the neighbor's agent, which answers; answers stop
// at two hops; a thread is passed on to a neighbor, who is woken and answers; an agent cannot answer a thread it was not
// given, read a tool that is not its own, or flag rows that are not there; it clears its own flag, asks a neighbor and
// no one else, proposes a watch, and drafts a request card that only a manager's tap sends to the Kaizen board; the day's
// cap, the AI budget, a paused agent and the data wall stop a review (and the wall keeps record values out of the brief);
// another company reaches none of it; no model or cost in what a manager reads; the record, the backup, the delete.
//
// Against a server ALREADY UP on a fresh database, the env run-all.sh gives it:
//   SOS_FAKE_AGENT=1 SOS_WATCH_MS=0 SOS_AGENT_EARLY_MIN=0 SOS_FLAG_UPDATE_MIN=0 SOS_PROMPT_LOG=<file>     node scripts/e2e/vsm-review.js
// Two more modes:
//   api    the requests a real review sends, against a stand-in for the Messages API this script serves on 3998; the
//          server runs with SOS_FAKE_AGENT=0 ANTHROPIC_API_KEY=stand-in ANTHROPIC_BASE_URL=http://127.0.0.1:3998
//          SOS_AGENT_REVIEW_STEPS=3 SOS_WATCH_MS=0
//   shift  the shift clock, against a server with SOS_WATCH_MS=1000 (fake agent)
const http = require("http");
const fs = require("fs");
const { PW, runner, login, waitFor, sleep } = require("./lib");
const { q } = require("../../src/db");
const R = runner(), t = R.t;
const A = "/api/c/demo/vsm";
const MAP = { format: "anetix-map-1", stages: [], maps: [{ key: "line", family: "Planes", title: "Planes",
  nodes: [
    { key: "plan", kind: "control", label: "Plan the day", who: "Dana", x: 300, y: 60 },
    { key: "rel", kind: "process", label: "Release", modules: ["paperline", "kpis"], record_kind: "anetix", who: "Lee", x: 200, y: 240, detail: { agent_name: "Line agent" } },
    { key: "ship", kind: "process", label: "Ship", modules: ["kpis"], record_kind: "anetix", who: "Sam", x: 420, y: 240, detail: { agent_name: "KPI agent" } },
    { key: "wings", kind: "process", label: "Wings", modules: ["paperline"], record_kind: "anetix", who: "Pat", x: 640, y: 240, detail: { agent_name: "Wing agent" } },
    { key: "far", kind: "process", label: "Far away", who: "Nobody near", x: 860, y: 240 },
    { key: "cus", kind: "customer", label: "Customers", x: 900, y: 20 } ],
  edges: [{ from: "plan", to: "rel", kind: "info_word" }, { from: "rel", to: "ship", kind: "push" }, { from: "ship", to: "wings", kind: "push" }, { from: "wings", to: "far", kind: "push" }, { from: "far", to: "cus", kind: "ship" }] }] };

const lastId = async () => (await q("SELECT coalesce(max(id), 0)::int AS n FROM platform.vsm_reviews")).rows[0].n;
const reviewAfter = (agentId, after, reason) => waitFor(`a ${reason || ""} review of agent ${agentId}`, async () =>
  (await q("SELECT * FROM platform.vsm_reviews WHERE agent_id=$1 AND id>$2 AND status<>'running' AND ($3::text IS NULL OR reason=$3) ORDER BY id DESC LIMIT 1", [agentId, after, reason || null])).rows[0] || null, 20000);
const settle = () => waitFor("no review running", async () => (await q("SELECT count(*)::int n FROM platform.vsm_reviews WHERE status='running'")).rows[0].n === 0, 20000);
const promptsOf = (kind) => (process.env.SOS_PROMPT_LOG && fs.existsSync(process.env.SOS_PROMPT_LOG) ? fs.readFileSync(process.env.SOS_PROMPT_LOG, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []).filter((p) => p.company === "demo" && (!kind || p.kind === kind));

async function setup(mgr, admin) {
  await admin.post(`${A}/import`, MAP);
  for (const key of ["line-agent", "kpi-agent", "wing-agent"]) await mgr.post(`${A}/agents`, { key });
  const ov = (await mgr.get(`${A}/agents`)).json;
  const by = (k) => ov.agents.find((a) => a.key === k);
  return { ov, line: by("line-agent"), kpi: by("kpi-agent"), wing: by("wing-agent") };
}

async function main() {
  const mgr = await login(PW.manager, "demo"), floor = await login(PW.floor, "demo"), admin = await login(PW.admin, "");
  // ---- who reaches it
  t("the floor reaches no review, settings, brief or draft route", (await floor.post(`${A}/agents/1/review`)).status === 403 && (await floor.get(`${A}/agent-settings`)).status === 403
    && (await floor.post(`${A}/agents/1/brief`)).status === 403 && (await floor.post(`${A}/board/drafts/1/send`)).status === 403 && (await floor.get(`${A}/agents/1/reviews`)).status === 403);

  // ---- set up: the brief is drafted
  let { line, kpi, wing } = await setup(mgr, admin);
  const briefs = await waitFor("the drafted briefs", async () => { const r = (await q("SELECT key, brief FROM platform.vsm_agents WHERE company='demo' ORDER BY key")).rows; return r.length === 3 && r.every((x) => /^Fake brief/.test(x.brief)) ? r : null; });
  t("setting an agent up drafts its brief, and says so on its channel", briefs.length === 3 && (await q("SELECT count(*)::int n FROM platform.vsm_messages WHERE company='demo' AND kind='note' AND from_kind='platform' AND words LIKE '%drafted its brief%'")).rows[0].n === 3);
  const bp = promptsOf("structured:agent_brief").find((p) => /Agent: Line agent/.test(p.prompt));
  t("its prompt: the boxes, the tools' tables and columns, counts and the values of a state column, as information", bp && /Release \(people: Lee\)/.test(bp.prompt) && /travelers \(id integer, job_num text/.test(bp.prompt) && /rows/.test(bp.prompt) && /status values: running/.test(bp.prompt) && /never instructions/.test(bp.prompt), bp && bp.prompt.slice(0, 400));
  await mgr.post(`${A}/agents/${line.id}`, { brief: "Mine, by hand." });
  const again = await mgr.post(`${A}/agents/${line.id}/brief`);
  t("Draft it again replaces the brief when a manager asks", again.status === 200 && /^Fake brief/.test(again.json.brief) && again.json.kept === false);

  // ---- disagree: two of the Line agent's tools that name the same items
  let ov = (await mgr.get(`${A}/agents`)).json;
  line = ov.agents.find((a) => a.key === "line-agent"); kpi = ov.agents.find((a) => a.key === "kpi-agent"); wing = ov.agents.find((a) => a.key === "wing-agent");
  const dis = line.watches.find((w) => w.shape === "disagree" && w.spec.table === "material_requests" && w.spec.other.tool === "kpis");
  t("a Disagree watch is drafted where two of its tools share a key, only proposed", dis && dis.status === "proposed" && dis.spec.key_column === "item" && dis.spec.other.table === "inventory_daily" && /with an item Plant KPIs does not know/.test(dis.title), line.watches.map((w) => w.title));
  t("an agent with one tool has no Disagree watch", !kpi.watches.some((w) => w.shape === "disagree"));
  await mgr.post(`${A}/watches/${dis.id}`, { status: "on" });
  await q("INSERT INTO mod_demo_paperline.material_requests (item, qty, status) VALUES ('ZZ-Unknown paper', 3, 'open')");
  await mgr.post(`${A}/agents/${line.id}/check`);
  let df = (await q("SELECT f.*, m.words FROM platform.vsm_flags f JOIN platform.vsm_messages m ON m.id=f.thread_id WHERE f.watch_id=$1", [dis.id])).rows[0];
  t("a request for an item the KPI tool has never heard of is flagged, with both tools in the evidence", df && df.status === "open" && df.count === 1 && df.evidence.sample[0].label === "ZZ-Unknown paper" && df.evidence.other.tool === "kpis", df);
  await q("INSERT INTO mod_demo_kpis.inventory_daily (day, item, on_hand, received) VALUES (current_date, ' zz-unknown PAPER ', 5, 0)");
  await mgr.post(`${A}/agents/${line.id}/check`);
  df = (await q("SELECT status FROM platform.vsm_flags WHERE watch_id=$1", [dis.id])).rows[0];
  t("once the KPI tool knows it (whatever its case and spaces), the flag clears", df.status === "cleared");
  const addD = (id, spec) => mgr.post(`${A}/agents/${id}/watches`, { shape: "disagree", tool: spec.tool || "kpis", title: "Disagree by hand", spec });
  const byHand = await addD(line.id, { tool: "paperline", table: "material_requests", key_column: "item", other: { tool: "kpis", table: "inventory_daily", key_column: "item" }, test: "compare", compare: { other_column: "on_hand", op: ">=", column: "qty" } });
  t("a Disagree watch by hand: only with another of the agent's own tools", (await addD(kpi.id, { table: "inventory_daily", key_column: "item", other: { tool: "paperline", table: "inventory", key_column: "item" } })).status === 400 && byHand.status === 200);
  await mgr.post(`${A}/agents/${line.id}/check`);
  t("a request the KPI tool shows enough of on hand is flagged by the comparison", (await q("SELECT count(*)::int n FROM platform.vsm_flags WHERE watch_id=$1 AND status='open'", [byHand.json.watch.id])).rows[0].n === 1);
  await mgr.post(`${A}/watches/${byHand.json.watch.id}`, { status: "off" });

  // ---- the shift times
  const st0 = (await mgr.get(`${A}/agent-settings`)).json;
  t("the shift times start at 15:00, New York time", st0.shift_times.join() === "15:00" && st0.tz === "America/New_York");
  t("a time that is not a time, or a zone that is not a zone, is refused", (await mgr.post(`${A}/agent-settings`, { shift_times: "25:00" })).status === 400 && (await mgr.post(`${A}/agent-settings`, { shift_times: "15:00", tz: "Mars/Base" })).status === 400
    && (await mgr.post(`${A}/agent-settings`, { shift_times: "1:00, 2:00, 3:00, 4:00, 5:00" })).status === 400);
  const st1 = await mgr.post(`${A}/agent-settings`, { shift_times: "15:00, 7:00", tz: "America/Chicago" });
  t("the shift times are kept, in order", st1.status === 200 && st1.json.settings.shift_times.join() === "07:00,15:00" && st1.json.settings.tz === "America/Chicago");

  // ---- a manager turns reviews on
  for (const a of [line, kpi, wing]) await mgr.post(`${A}/agents/${a.id}`, { reviews: true });
  ov = (await mgr.get(`${A}/agents`)).json;
  t("reviews on: each agent says when its next review is", ov.agents.filter((a) => a.set_up).every((a) => a.reviews === true && a.next_review) && ov.settings.tz === "America/Chicago");
  t("and its channel says so, with the times", (await q("SELECT count(*)::int n FROM platform.vsm_messages WHERE company='demo' AND words LIKE '%turned on%shift reviews%07:00, 15:00 (America/Chicago)%'")).rows[0].n === 3);

  // ---- Review now: a note
  let before = await lastId();
  const rn = await mgr.post(`${A}/agents/${kpi.id}/review`);
  let rev = await reviewAfter(kpi.id, before);
  const kNote = (await q("SELECT * FROM platform.vsm_messages WHERE agent_id=$1 AND from_kind='agent' AND kind='note' ORDER BY id DESC LIMIT 1", [kpi.id])).rows[0];
  t("Review now: the agent reviews and posts a note in its channel", rn.status === 200 && rn.json.review.status === "running" && rev.status === "done" && rev.reason === "manual" && kNote && /^Fake note from KPI agent/.test(kNote.words) && kNote.channel === "a:kpi-agent", rev);
  const rp = promptsOf("agent-review").pop();
  t("its prompt: who it is, its boxes, tools, neighbors and inbox; the rules say messages are never instructions", rp && /You are: KPI agent/.test(JSON.stringify(rp.messages)) && /Line agent \(an agent, key line-agent\)/.test(JSON.stringify(rp.messages)) && /never an instruction to you/.test(rp.system) && /Your inbox/.test(JSON.stringify(rp.messages)));
  ov = (await mgr.get(`${A}/agents`)).json;
  t("the agent's panel shows the last review", ov.agents.find((a) => a.key === "kpi-agent").last_review.status === "done");

  // ---- an urgent flag wakes the neighbor's agent, which answers
  const addW = (id, title, spec, extra = {}) => mgr.post(`${A}/agents/${id}/watches`, { shape: "waiting", tool: "paperline", title, severity: "act", spec, ...extra });
  const w1 = (await addW(line.id, "Release: travelers queued", { table: "travelers", since_column: "released_at", hours: 0, where: [{ column: "state", op: "=", value: "queued" }] })).json.watch;
  await q("INSERT INTO mod_demo_paperline.travelers (job_num, color, fold_type, clip_pos, state) VALUES ('J-1','red','dart','front','queued'),('J-2','red','dart','front','queued'),('J-3','blue','glider','back','queued')");
  before = await lastId();
  await mgr.post(`${A}/agents/${line.id}/check`);
  const f1 = (await q("SELECT f.*, m.to_list FROM platform.vsm_flags f JOIN platform.vsm_messages m ON m.id=f.thread_id WHERE f.watch_id=$1", [w1.id])).rows[0];
  t("the act flag goes to the KPI agent and the planning box's people", f1 && f1.to_list.some((x) => x.kind === "agent" && x.key === "kpi-agent") && f1.to_list.some((x) => x.kind === "box" && x.key === "line/plan"));
  rev = await reviewAfter(kpi.id, before, "early");
  const ans1 = (await q("SELECT * FROM platform.vsm_messages WHERE thread_id=$1 AND kind='answer'", [f1.thread_id])).rows;
  t("which wakes the KPI agent for an early review, and it answers in the thread, one hop", rev.status === "done" && rev.posted.answers === 1 && ans1.length === 1 && ans1[0].from_name === "KPI agent" && ans1[0].hops === 1, rev.posted);
  before = await lastId();
  await mgr.post(`${A}/agents/${line.id}/review`);
  rev = await reviewAfter(line.id, before);
  const ans2 = (await q("SELECT * FROM platform.vsm_messages WHERE thread_id=$1 AND kind='answer' ORDER BY id", [f1.thread_id])).rows;
  t("the Line agent answers back: two hops", rev.posted.answers === 1 && ans2.length === 2 && ans2[1].from_name === "Line agent" && ans2[1].hops === 2, rev.posted);
  await mgr.post(`${A}/board/messages`, { thread_id: f1.thread_id, words: "Who has the J-1 sheet?" });
  before = await lastId();
  await mgr.post(`${A}/agents/${kpi.id}/review`);
  rev = await reviewAfter(kpi.id, before);
  t("past two hops the agents stop: only people write in it", rev.posted.answers === 0 && (await q("SELECT count(*)::int n FROM platform.vsm_messages WHERE thread_id=$1 AND from_kind='agent'", [f1.thread_id])).rows[0].n === 2, rev.posted);

  // ---- a thread passed on to a neighbor, who is woken and answers
  await mgr.post(`${A}/agents/${kpi.id}`, { brief: '[[pass {"to":"wing-agent"}]]' });
  const w2 = (await addW(line.id, "Release: requests still open", { table: "material_requests", since_column: "requested_at", hours: 0, where: [{ column: "status", op: "=", value: "open" }] })).json.watch;
  before = await lastId();
  await mgr.post(`${A}/agents/${line.id}/check`);
  const f2 = (await q("SELECT * FROM platform.vsm_flags WHERE watch_id=$1", [w2.id])).rows[0];
  const kRev = await reviewAfter(kpi.id, before, "early");
  const pass = (await q("SELECT * FROM platform.vsm_messages WHERE thread_id=$1 AND kind='pass'", [f2.thread_id])).rows[0];
  t("the KPI agent passes it on to the Wing agent, addressed to it, one hop", kRev.posted.passes === 1 && pass && pass.to_list[0].key === "wing-agent" && pass.hops === 1, kRev.posted);
  const wRev = await reviewAfter(wing.id, before, "early");
  const wAns = (await q("SELECT * FROM platform.vsm_messages WHERE thread_id=$1 AND kind='answer'", [f2.thread_id])).rows[0];
  t("the pass wakes the Wing agent, which answers: two hops", wRev.posted.answers === 1 && wAns && wAns.from_name === "Wing agent" && wAns.hops === 2, wRev.posted);
  const wingStream = (await mgr.get(`${A}/board?channel=a:wing-agent`)).json.messages;
  t("the thread shows in the Wing agent's channel", wingStream.some((m) => m.id === f2.thread_id));
  await settle();
  await mgr.post(`${A}/agents/${kpi.id}`, { brief: `[[passto {"thread_id":${f2.thread_id},"to":"wing-agent"}]] [[answer {"thread_id":${f1.thread_id}}]]` });
  before = await lastId();
  await mgr.post(`${A}/agents/${kpi.id}/review`);
  rev = await reviewAfter(kpi.id, before);
  t("a thread is passed on once, and an agent answers only a thread it may", rev.posted.passes === 0 && rev.posted.answers === 0 && rev.posted.left_out.some((x) => /^a pass/.test(x)) && rev.posted.left_out.some((x) => /^an answer/.test(x)), rev.posted);
  const plantMsg = (await mgr.post(`${A}/board/messages`, { channel: "plant", words: "Lunch is at noon." })).json.message;
  await mgr.post(`${A}/agents/${kpi.id}`, { brief: `[[answer {"thread_id":${plantMsg.id}}]]` });
  before = await lastId();
  await mgr.post(`${A}/agents/${kpi.id}/review`);
  rev = await reviewAfter(kpi.id, before);
  t("nor a thread it was never given", rev.posted.answers === 0 && rev.posted.left_out.some((x) => /only in a thread it was given/.test(x)) && (await q("SELECT count(*)::int n FROM platform.vsm_messages WHERE thread_id=$1", [plantMsg.id])).rows[0].n === 0);

  // ---- reading only its own tools
  await mgr.post(`${A}/agents/${wing.id}`, { brief: '[[read {"tool":"kpis","table":"daily"}]] [[read {"tool":"paperline","table":"travelers","limit":2}]]' });
  before = await lastId();
  await mgr.post(`${A}/agents/${wing.id}/review`);
  rev = await reviewAfter(wing.id, before);
  const wNote = (await q("SELECT words, evidence FROM platform.vsm_messages WHERE agent_id=$1 AND from_kind='agent' AND kind='note' ORDER BY id DESC LIMIT 1", [wing.id])).rows[0];
  t("an agent reads its own tool, and another tool is not there for it", /error: \{"error":"No tool called \\"kpis\\"/.test(wNote.words) && /ok: \{"note"/.test(wNote.words) && /J-\d/.test(wNote.words) && rev.steps.some((s) => /Paper Airplane Line/.test(s)), wNote.words.slice(0, 500));
  t("the note says what it looked at", (wNote.evidence.looked || []).length === 2);

  // ---- a flag of its own: the rows it names are checked
  const j1 = (await q("SELECT id FROM mod_demo_paperline.travelers WHERE job_num='J-1'")).rows[0].id;
  await mgr.post(`${A}/agents/${line.id}`, { brief: `[[flag {"tool":"paperline","table":"travelers","ids":[${j1},999999],"words":"J-1 carries the wrong fold."}]] [[flag {"tool":"paperline","table":"travelers","ids":[999998]}]]` });
  before = await lastId();
  await mgr.post(`${A}/agents/${line.id}/review`);
  rev = await reviewAfter(line.id, before);
  const rf = (await q("SELECT f.*, m.words, m.to_list, m.from_kind FROM platform.vsm_flags f JOIN platform.vsm_messages m ON m.id=f.thread_id WHERE f.agent_id=$1 AND f.watch_id IS NULL", [line.id])).rows;
  t("its own flag is posted with the rows the board found, and one naming no real row is left out", rev.posted.flags === 1 && rf.length === 1 && rf[0].from_kind === "agent" && rf[0].evidence.sample.length === 1 && rf[0].evidence.sample[0].label === "J-1" && rf[0].evidence.checked.named === 2 && rf[0].evidence.checked.found === 1
    && rev.posted.left_out.some((x) => /none of the rows/.test(x)) && rf[0].to_list.some((x) => x.key === "kpi-agent"), { posted: rev.posted, rf });
  await mgr.post(`${A}/agents/${wing.id}`, { brief: '[[flag {"tool":"kpis","table":"daily","ids":[1]}]]' });
  before = await lastId();
  await mgr.post(`${A}/agents/${wing.id}/review`);
  rev = await reviewAfter(wing.id, before);
  t("nor a flag on a tool that is not its own", rev.posted.flags === 0 && rev.posted.left_out.some((x) => /not one of its tools/.test(x)));
  await mgr.post(`${A}/agents/${line.id}`, { brief: "[[clear]]" });
  before = await lastId();
  await mgr.post(`${A}/agents/${line.id}/review`);
  rev = await reviewAfter(line.id, before);
  t("it clears its own flag when the records no longer show it", rev.posted.clears === 1 && (await q("SELECT status FROM platform.vsm_flags WHERE thread_id=$1", [rf[0].thread_id])).rows[0].status === "cleared");

  // ---- asking a neighbor, and no one else
  await mgr.post(`${A}/agents/${line.id}`, { brief: '[[ask {"to":"line/far","words":"Anyone there?"}]]' });
  before = await lastId();
  await mgr.post(`${A}/agents/${line.id}/review`);
  rev = await reviewAfter(line.id, before);
  t("a question to a box that is not a neighbor is left out", rev.posted.asks === 0 && rev.posted.left_out.some((x) => /neighbor/.test(x)));
  await mgr.post(`${A}/agents/${line.id}`, { brief: '[[ask {"to":"kpi-agent","words":"Is the KPI board counting today?"}]]' });
  before = await lastId();
  await mgr.post(`${A}/agents/${line.id}/review`);
  rev = await reviewAfter(line.id, before);
  const askM = (await q("SELECT * FROM platform.vsm_messages WHERE company='demo' AND kind='ask' ORDER BY id DESC LIMIT 1")).rows[0];
  t("a question to a neighbor is posted, addressed to it, and shows in its channel", rev.posted.asks === 1 && askM.channel === "a:line-agent" && askM.to_list[0].key === "kpi-agent" && (await mgr.get(`${A}/board?channel=a:kpi-agent`)).json.messages.some((m) => m.id === askM.id));

  // ---- a watch for a manager to turn on
  await mgr.post(`${A}/agents/${line.id}`, { brief: '[[watch {"shape":"level","tool":"paperline","title":"Paper on the shelf under ten","spec":{"table":"inventory","column":"qty","op":"under","limit":10},"why":"The shelf ran dry twice."}]] [[watch {"shape":"level","tool":"paperline","title":"Bad","spec":{"table":"nope"}}]]' });
  before = await lastId();
  await mgr.post(`${A}/agents/${line.id}/review`);
  rev = await reviewAfter(line.id, before);
  const idea = (await q("SELECT * FROM platform.vsm_watches WHERE agent_id=$1 AND title='Paper on the shelf under ten'", [line.id])).rows[0];
  t("a watch it proposes is checked, kept as proposed, and said on its channel; one that does not fit is left out", rev.posted.ideas === 1 && idea && idea.status === "proposed" && /its review/.test(idea.created_by) && rev.posted.left_out.some((x) => /^a watch/.test(x))
    && (await q("SELECT count(*)::int n FROM platform.vsm_messages WHERE agent_id=$1 AND kind='idea'", [line.id])).rows[0].n === 1);

  // ---- a draft request card: only a manager's tap sends it
  await mgr.post(`${A}/agents/${line.id}`, { brief: '[[draft {"tool":"paperline","what":"Show how many travelers wait at release on the release screen.","why":"Release keeps overfilling the line."}]]' });
  before = await lastId();
  await mgr.post(`${A}/agents/${line.id}/review`);
  rev = await reviewAfter(line.id, before);
  const draft = (await mgr.get(`${A}/board?channel=a:line-agent`)).json.messages.find((m) => m.kind === "draft");
  t("the draft card waits on the board, filed nowhere", rev.posted.requests === 1 && draft && draft.draft.state === "draft" && draft.evidence.card.tool === "paperline"
    && (await q("SELECT count(*)::int n FROM platform.feedback WHERE source='agent_board' AND message LIKE '%travelers wait at release%'")).rows[0].n === 0);
  t("the floor cannot send it", (await floor.post(`${A}/board/drafts/${draft.id}/send`)).status === 403);
  const sent = await mgr.post(`${A}/board/drafts/${draft.id}/send`);
  const fb = sent.json && sent.json.result ? (await q("SELECT * FROM platform.feedback WHERE id=$1", [sent.json.result.feedback_id])).rows[0] : null;
  t("a manager's tap sends it to the Kaizen board, saying which agent drafted it and who sent it", sent.status === 200 && fb && fb.source === "agent_board" && fb.module === "paperline" && /drafted by Line agent, sent by/.test(fb.message), sent.json);
  t("and only once", (await mgr.post(`${A}/board/drafts/${draft.id}/send`)).status === 400 && (await q("SELECT state FROM platform.vsm_drafts WHERE message_id=$1", [draft.id])).rows[0].state === "sent");
  before = await lastId();
  await mgr.post(`${A}/agents/${line.id}/review`);
  await reviewAfter(line.id, before);
  const d2 = (await q("SELECT message_id FROM platform.vsm_drafts WHERE company='demo' AND state='draft' ORDER BY message_id DESC LIMIT 1")).rows[0];
  const nn = await mgr.post(`${A}/board/drafts/${d2.message_id}/dismiss`);
  t("Not now puts another one away", nn.status === 200 && (await q("SELECT state FROM platform.vsm_drafts WHERE message_id=$1", [d2.message_id])).rows[0].state === "dismissed");
  await mgr.post(`${A}/agents/${line.id}`, { brief: "" });

  // ---- what stops a review
  await q("INSERT INTO platform.vsm_reviews (company, agent_id, reason, status) SELECT 'demo', $1, 'manual', 'done' FROM generate_series(1, 60)", [kpi.id]);
  const capped = await mgr.post(`${A}/agents/${kpi.id}/review`);
  t("past the day's reviews, Review now is refused in words", capped.status === 409 && /most a day/.test(capped.json.error), capped.json);
  await q("DELETE FROM platform.vsm_reviews WHERE company='demo' AND posted IS NULL AND status='done'");
  await q("UPDATE platform.companies SET monthly_cap_usd=0.01 WHERE slug='demo'");
  await q("INSERT INTO platform.ai_usage (company, kind, cost_usd, detail) VALUES ('demo', 'agents', 1, '{}')");
  const broke = await mgr.post(`${A}/agents/${kpi.id}/review`);
  t("past the company's AI budget, too", broke.status === 429 && /AI budget/.test(broke.json.error), broke.json);
  await q("UPDATE platform.companies SET monthly_cap_usd=NULL WHERE slug='demo'");
  await mgr.post(`${A}/agents/${kpi.id}`, { status: "paused" });
  t("a paused agent does not review", (await mgr.post(`${A}/agents/${kpi.id}/review`)).status === 409);
  await mgr.post(`${A}/agents/${kpi.id}`, { status: "on" });
  // the data wall: no reviews, the brief from names and columns only, the watches still run
  await settle();
  await admin.post("/api/admin/companies/demo/data-wall", { walled: true });
  const nReviewPrompts = promptsOf("agent-review").length;
  const walled = await mgr.post(`${A}/agents/${kpi.id}/review`);
  await mgr.post(`${A}/agents/${wing.id}`, { reviews: false });
  const backOn = await mgr.post(`${A}/agents/${wing.id}`, { reviews: true });
  await q("INSERT INTO mod_demo_paperline.travelers (job_num, color, fold_type, clip_pos, state) VALUES ('J-9','red','dart','front','ZZCANARY')");
  await mgr.post(`${A}/agents/${wing.id}/brief`);
  const wp = promptsOf("structured:agent_brief").filter((p) => /Agent: Wing agent/.test(p.prompt)).pop();
  t("under the wall: no review, reviews cannot be turned on", walled.status === 409 && /walled off/.test(walled.json.error) && backOn.status === 400 && promptsOf("agent-review").length === nReviewPrompts);
  t("and the brief is drafted from names and columns only", wp && /names and columns only/.test(wp.prompt) && !/ZZCANARY/.test(wp.prompt) && !/\d+ rows/.test(wp.prompt) && !/values:/.test(wp.prompt), wp && wp.prompt.slice(0, 600));
  t("the watches still run", (await mgr.post(`${A}/agents/${line.id}/check`)).status === 200);
  await admin.post("/api/admin/companies/demo/data-wall", { walled: false });

  // ---- another company, what a manager reads, the record, the backup, the delete
  const made = await admin.post("/api/admin/companies", { slug: "reviewco", name: "Review Co" });
  const other = await login(made.json.passwords.manager, "reviewco");
  t("another company's manager reaches none of it", (await other.post(`${A}/agents/${kpi.id}/review`)).status === 403 && (await other.get(`${A}/agent-settings`)).status === 403);
  t("nor through its own slug", (await other.post(`/api/c/reviewco/vsm/agents/${kpi.id}/review`)).status === 404 && (await other.post(`/api/c/reviewco/vsm/agents/${kpi.id}/brief`)).status === 404
    && (await other.post(`/api/c/reviewco/vsm/board/drafts/${d2.message_id}/send`)).status === 404 && (await other.get(`/api/c/reviewco/vsm/agents/${kpi.id}/reviews`)).json.reviews.length === 0);
  const reads = JSON.stringify((await mgr.get(`${A}/agents`)).json) + JSON.stringify((await mgr.get(`${A}/agents/${line.id}/reviews`)).json) + JSON.stringify((await mgr.get(`${A}/board`)).json);
  t("what a manager reads names no model and no cost", !/"model"|cost_usd|fake-model|claude-/i.test(reads));
  const kinds = (await q("SELECT DISTINCT kind FROM platform.record WHERE company='demo'")).rows.map((r) => r.kind);
  t("on the record: reviews, the asks for one, the shift times, the briefs, the drafts sent and put away", ["agent_review", "agent_review_asked", "agent_settings_changed", "agent_brief_drafted", "agent_draft_dismissed", "feedback_filed"].every((k) => kinds.includes(k)), kinds);
  t("no word on the board carries a long dash", !/[\u2013\u2014]/.test(JSON.stringify((await q("SELECT words FROM platform.vsm_messages")).rows)));
  const bk = await admin.get("/api/admin/backup");
  t("reviews, drafts and the shift times are in the backup", bk.status === 200 && ["vsm_reviews", "vsm_drafts", "vsm_agent_settings"].every((k) => Array.isArray(bk.json.platform[k]) && bk.json.platform[k].some((r) => r.company === "demo")));
  await q("INSERT INTO platform.vsm_agent_settings (company) VALUES ('reviewco')");
  await require("../../src/vsm").deleteCompany("reviewco");
  t("they go with the company, another's stay", (await q("SELECT count(*)::int n FROM platform.vsm_agent_settings WHERE company='reviewco'")).rows[0].n === 0 && (await q("SELECT count(*)::int n FROM platform.vsm_reviews WHERE company='demo'")).rows[0].n > 5);
}

// ---- the requests a real review sends -------------------------------------------------------------------------------
async function api() {
  const seen = [];
  const reply = (res, j, content, stop) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ id: `msg_${seen.length}`, type: "message", role: "assistant", model: j.model, content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1500, output_tokens: 120, cache_read_input_tokens: 3000, cache_creation_input_tokens: 0 } })); };
  const server = http.createServer((req, res) => {
    let body = ""; req.on("data", (c) => { body += c; });
    req.on("end", () => {
      let j = {}; try { j = JSON.parse(body); } catch (e) { /* */ }
      const names = (j.tools || []).map((x) => x.name);
      if (names.includes("agent_brief")) { seen.push({ brief: true, j }); return reply(res, j, [{ type: "tool_use", id: "toolu_b", name: "agent_brief", input: { brief: "Release turns sheets into travelers \u2014 written by Claude Opus 5.5.", watch_ideas: [{ shape: "level", tool: "paperline", title: "Paper under ten", spec: { table: "inventory", column: "qty", op: "under", limit: 10 } }] } }], "tool_use"); }
      if (!names.includes("post_review")) return reply(res, j, [{ type: "text", text: "{}" }], "end_turn");
      seen.push({ review: true, j });
      const first = JSON.stringify(j.messages[0]);
      const lastUser = j.messages[j.messages.length - 1];
      const results = Array.isArray(lastUser.content) ? lastUser.content.filter((b) => b.type === "tool_result").length : 0;
      if (/You are: Line agent/.test(first)) {
        if (!results) return reply(res, j, [{ type: "text", text: "Looking." }, { type: "tool_use", id: `toolu_${seen.length}a`, name: "read_records", input: { tool: "paperline", table: "travelers", limit: 5 } }, { type: "tool_use", id: `toolu_${seen.length}b`, name: "summarize_records", input: { tool: "Plant KPIs", table: "daily", measures: [{ fn: "count" }] } }], "tool_use");
        return reply(res, j, [{ type: "tool_use", id: `toolu_${seen.length}p`, name: "post_review", input: { note: "Three travelers waited at release. Claude Opus 5.5 by Anthropic \u2014 says hi.", answers: [{ thread_id: 999999, words: "x" }] } }], "tool_use");
      }
      if ((j.tool_choice && j.tool_choice.name === "post_review") || /last step/.test(JSON.stringify(lastUser))) return reply(res, j, [{ type: "tool_use", id: `toolu_${seen.length}p`, name: "post_review", input: { note: "Nothing moved at shipping." } }], "tool_use");
      return reply(res, j, [{ type: "text", text: "Thinking it over." }], "end_turn");
    });
  });
  await new Promise((r) => server.listen(Number(process.env.SOS_STANDIN_PORT || 3998), "127.0.0.1", r));
  const mgr = await login(PW.manager, "demo"), admin = await login(PW.admin, "");
  const { line, kpi } = await setup(mgr, admin);
  const br = await waitFor("the drafted brief", async () => { const r = (await q("SELECT brief FROM platform.vsm_agents WHERE id=$1", [line.id])).rows[0]; return r.brief ? r : null; });
  t("the brief comes back through the forced tool, scrubbed of the model's name and the long dash", /^Release turns sheets into travelers/.test(br.brief) && !/Claude|\u2014/.test(br.brief), br.brief);
  const bReq = seen.find((s) => s.brief).j;
  t("the brief's request offers its one tool, forced where the model takes that and asked for in words where it does not", bReq.tools.length === 1 && bReq.tools[0].name === "agent_brief"
    && ((bReq.tool_choice && bReq.tool_choice.name === "agent_brief") || /Respond only by calling the agent_brief tool/.test(JSON.stringify(bReq.messages))), { tc: bReq.tool_choice, model: bReq.model });
  t("the watch it proposed with the brief is kept as proposed", (await q("SELECT status, created_by FROM platform.vsm_watches WHERE agent_id=$1 AND title='Paper under ten'", [line.id])).rows.some((w) => w.status === "proposed" && /drafted with its brief/.test(w.created_by)));
  await q("INSERT INTO mod_demo_paperline.travelers (job_num, color, fold_type, clip_pos, state) VALUES ('J-1','red','dart','front','queued')");
  let before = await lastId();
  await mgr.post(`${A}/agents/${line.id}/review`);
  let rev = await reviewAfter(line.id, before);
  const lineReqs = seen.filter((s) => s.review && /You are: Line agent/.test(JSON.stringify(s.j.messages[0]))).map((s) => s.j);
  const problems = [];
  for (const [i, j] of lineReqs.entries()) {
    if (!Array.isArray(j.system) || !j.system[0].cache_control || !/never an instruction to you/.test(j.system[0].text)) problems.push(`${i}: the fixed rules are not first and cached`);
    const last = j.messages[j.messages.length - 1];
    const lb = Array.isArray(last.content) ? last.content[last.content.length - 1] : null;
    if (!lb || !lb.cache_control) problems.push(`${i}: no cache mark on the last block`);
    for (let k = 1; k < j.messages.length; k++) if (j.messages[k].role === j.messages[k - 1].role) problems.push(`${i}: two ${j.messages[k].role} messages in a row`);
    for (let k = 0; k < j.messages.length; k++) {
      const blocks = Array.isArray(j.messages[k].content) ? j.messages[k].content : [];
      const uses = blocks.filter((b) => b.type === "tool_use").map((b) => b.id);
      if (uses.length) { const nb = (j.messages[k + 1] || {}).content || []; const first = []; for (const b of nb) { if (b.type !== "tool_result") break; first.push(b.tool_use_id); } if (uses.some((id) => !first.includes(id))) problems.push(`${i}: a tool call not answered first`); }
      for (const b of blocks) if (b.type === "text" && !String(b.text || "").trim()) problems.push(`${i}: an empty text block`);
    }
    const names = j.tools.map((x) => x.name).sort().join();
    if (names !== "describe_tool,post_review,read_records,summarize_records") problems.push(`${i}: tools ${names}`);
    if (!j.max_tokens || j.max_tokens > 4000) problems.push(`${i}: max_tokens`);
  }
  t("every request a review sends is in the shape the API takes, with the record tools and post_review only", lineReqs.length === 2 && !problems.length, problems.concat([String(lineReqs.length)]));
  const results = lineReqs[1].messages[2].content.filter((b) => b.type === "tool_result");
  t("its record reads come back: its own tool's rows, and the other tool it has", results.length === 2 && /J-1/.test(results[0].content) && !results[0].is_error && !results[1].is_error, results.map((r) => String(r.content).slice(0, 200)));
  const lNote = (await q("SELECT words FROM platform.vsm_messages WHERE agent_id=$1 AND from_kind='agent' AND kind='note' ORDER BY id DESC LIMIT 1", [line.id])).rows[0];
  t("the note is posted scrubbed; an answer to a thread it was not given is left out", rev.status === "done" && /^Three travelers waited at release/.test(lNote.words) && !/Claude|Anthropic|\u2014/.test(lNote.words) && rev.posted.answers === 0 && rev.posted.left_out.length === 1, { rev, lNote });
  before = await lastId();
  await mgr.post(`${A}/agents/${kpi.id}/review`);
  rev = await reviewAfter(kpi.id, before);
  const kReqs = seen.filter((s) => s.review && /You are: KPI agent/.test(JSON.stringify(s.j.messages[0]))).map((s) => s.j);
  const forced = require("../../src/agent").takesForcedTool(kReqs[2] && kReqs[2].model);
  t("an agent that only talks is told to post, and its last step forces the post where the model takes that (and never a forced call it refuses)", rev.status === "done" && kReqs.length === 3 && !kReqs[0].tool_choice && !kReqs[1].tool_choice
    && /Call post_review now/.test(JSON.stringify(kReqs[1].messages)) && /last step/.test(JSON.stringify(kReqs[2].messages)) && (forced ? kReqs[2].tool_choice.name === "post_review" : !kReqs[2].tool_choice), kReqs.map((j) => [j.model, j.tool_choice, j.messages.length]));
  const calls = (await q("SELECT count(*)::int n FROM platform.ai_calls WHERE company='demo' AND kind='agents' AND model IS NOT NULL")).rows[0].n;
  const usage = (await q("SELECT coalesce(sum(cost_usd), 0)::float AS usd FROM platform.ai_usage WHERE company='demo' AND kind='agents'")).rows[0].usd;
  t("every call is on the meter as the agents' and counts toward the company's spend", calls >= 5 && usage > 0, { calls, usage });
  const reads = JSON.stringify((await mgr.get(`${A}/agents`)).json) + JSON.stringify((await mgr.get(`${A}/agents/${kpi.id}/reviews`)).json);
  t("and a manager reads no model and no cost", !/"model"|cost_usd|claude-/i.test(reads));
  server.close();
}

// ---- the shift clock (a server with SOS_WATCH_MS=1000) -----------------------------------------------------------
async function shift() {
  const mgr = await login(PW.manager, "demo"), admin = await login(PW.admin, "");
  const { kpi } = await setup(mgr, admin);
  const hhmm = (d) => d.toISOString().slice(11, 16);
  await mgr.post(`${A}/agent-settings`, { shift_times: hhmm(new Date(Date.now() - 60e3)), tz: "UTC" });
  await mgr.post(`${A}/agents/${kpi.id}`, { reviews: true });
  await sleep(2500);
  t("turning reviews on does not catch up a shift that already passed", (await q("SELECT count(*)::int n FROM platform.vsm_reviews WHERE agent_id=$1", [kpi.id])).rows[0].n === 0);
  await q("UPDATE platform.vsm_agents SET last_shift_at = now() - interval '1 hour' WHERE id=$1", [kpi.id]);
  const r = await waitFor("the shift review", async () => (await q("SELECT * FROM platform.vsm_reviews WHERE agent_id=$1 AND reason='shift' AND status='done'", [kpi.id])).rows[0] || null, 15000);
  t("at the shift time the agent reviews on its own", r && r.status === "done");
  await sleep(3000);
  t("once a shift", (await q("SELECT count(*)::int n FROM platform.vsm_reviews WHERE agent_id=$1 AND reason='shift'", [kpi.id])).rows[0].n === 1);
  await mgr.post(`${A}/agent-settings`, { shift_times: hhmm(new Date(Date.now() - 4 * 3600e3)), tz: "UTC" });
  await q("UPDATE platform.vsm_agents SET last_shift_at = now() - interval '5 hours' WHERE id=$1", [kpi.id]);
  await sleep(3000);
  t("a shift more than three hours gone is not caught up", (await q("SELECT count(*)::int n FROM platform.vsm_reviews WHERE agent_id=$1 AND reason='shift'", [kpi.id])).rows[0].n === 1);
}

({ api, shift }[process.argv[2]] || main)().then(() => R.done()).catch(R.abort);
