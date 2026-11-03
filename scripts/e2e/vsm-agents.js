// End to end for the agent board, A1 (src/vsm-agents.js, public/agent-board.html, docs/AGENTS.md; 2026-11-02).
// What it proves: the floor reaches none of it; agents come from the names on the map, and one with no tool on its boxes
// cannot be set up; setting one up drafts watches from its tools' tables and runs none of them; a manager's watch is
// checked for shape; a watch that finds rows opens one flag, addressed by the map to the next agent and to the people of
// a box with no agent, and keeps one flag while the rows stay, with its count updated; Seen, On it, Resolved (with
// words) and Not a problem (muting the watch) do what they say; a flag nobody marks seen is raised and then climbs, to
// #escalations, the board's notices and the phones, and the push carries no record value; rows that clear close the
// flag; a quiet tool is flagged from its own use; a flag becomes a Kaizen request; watches still run under the data
// wall; the background runner runs on its own; the Map's chips and red box; another company reaches none of it; the
// record, the backup and the company delete.
// Against a server ALREADY UP in fake-agent mode on a fresh database, with the env run-all.sh gives it: SOS_WATCH_MS=0 (no
// background runner, so every look is the test's own "Check now"), SOS_FLAG_UPDATE_MIN=0, SOS_FLAG_RESOLVED_HOLD_MIN=0 and
// NTFY_URL pointing at the stand-in this script serves. "node scripts/e2e/vsm-agents.js runner", against a fresh server
// with SOS_WATCH_MS=1000, proves the background runner flags on its own.
const http = require("http");
const { PW, runner, login, waitFor, sleep } = require("./lib");
const { q } = require("../../src/db");
const R = runner(), t = R.t;
const NTFY_PORT = Number(new URL(process.env.NTFY_URL || "http://127.0.0.1:4788").port);
const A = "/api/c/demo/vsm";
const MAP = { format: "anetix-map-1", stages: [], maps: [{ key: "line", family: "Planes", title: "Planes",
  nodes: [
    { key: "plan", kind: "control", label: "Plan the day", who: "Dana", x: 300, y: 60 },
    { key: "rel", kind: "process", label: "Release", modules: ["paperline"], record_kind: "anetix", who: "Lee", x: 200, y: 240, detail: { agent_name: "Line agent" } },
    { key: "ship", kind: "process", label: "Ship", modules: ["kpis"], record_kind: "anetix", who: "Sam", x: 420, y: 240, detail: { agent_name: "KPI agent" } },
    { key: "wings", kind: "process", label: "Wings", who: "Pat", x: 640, y: 240, detail: { agent_name: "Wing agent" } },
    { key: "far", kind: "process", label: "Far away", who: "Nobody near", x: 860, y: 240 },
    { key: "cus", kind: "customer", label: "Customers", x: 900, y: 20 } ],
  edges: [{ from: "plan", to: "rel", kind: "info_word" }, { from: "rel", to: "ship", kind: "push" }, { from: "ship", to: "wings", kind: "push" }, { from: "wings", to: "far", kind: "push" }, { from: "far", to: "cus", kind: "ship" }] }] };

async function main() {
  // the stand-in for ntfy: what the phones would get
  const pushes = [];
  const stub = http.createServer((req, res) => { let b = ""; req.on("data", (d) => { b += d; }); req.on("end", () => { try { pushes.push(JSON.parse(b)); } catch (e) { pushes.push({ raw: b }); } res.end("{}"); }); });
  await new Promise((r) => stub.listen(NTFY_PORT, "127.0.0.1", r));
  const mgr = await login(PW.manager, "demo"), floor = await login(PW.floor, "demo"), admin = await login(PW.admin, "");

  // ---- who reaches it
  t("the floor cannot read the board or the agents", (await floor.get(`${A}/board`)).status === 403 && (await floor.get(`${A}/agents`)).status === 403 && (await floor.get("/c/demo/agent-board")).status === 403);
  const page = await mgr.get("/c/demo/agent-board");
  t("a manager opens the Agents page, the third tab", page.status === 200 && /href="agent-board"/.test(page.text) && /Kaizen<\/a><a href="map">Map<\/a>/.test(page.text) && !/[–—]/.test(page.text));
  t("the board and the Map carry the Agents tab", /href="agent-board">Agents/.test((await mgr.get("/c/demo/")).text) && /href="agent-board">Agents/.test((await mgr.get("/c/demo/map")).text));

  // ---- agents from the map
  t("setup: the map with its agents is imported", (await admin.post(`${A}/import`, MAP)).status === 200);
  let ov = (await mgr.get(`${A}/agents`)).json;
  const byKey = (k) => ov.agents.find((a) => a.key === k);
  t("the agents are the names on the map, none set up, with the tools on their boxes", ov.agents.length === 3 && byKey("line-agent").tools.join() === "paperline" && byKey("line-agent").status === "not_set_up" && byKey("wing-agent").can_set_up === false, ov.agents);
  const wing = await mgr.post(`${A}/agents`, { key: "wing-agent" });
  t("an agent with no tool on its boxes cannot be set up, and says why", wing.status === 400 && /no Anetix tool/.test(wing.json.error));
  const su = await mgr.post(`${A}/agents`, { key: "line-agent" });
  await mgr.post(`${A}/agents`, { key: "kpi-agent" });
  t("setting one up is refused a second time", (await mgr.post(`${A}/agents`, { key: "line-agent" })).status === 400);
  ov = (await mgr.get(`${A}/agents`)).json;
  const line = byKey("line-agent");
  t("set up: it drafted watches from its tool's tables, every one only proposed", su.status === 200 && line.watches.length >= 3 && line.watches.every((w) => w.status === "proposed") && line.watches.some((w) => w.shape === "quiet") && line.watches.some((w) => w.spec.table === "travelers"), line.watches.map((w) => w.title));
  t("its people come from its boxes", line.people === "Lee");
  const trav = line.watches.find((w) => w.spec.table === "travelers");
  await q("INSERT INTO mod_demo_paperline.travelers (job_num, color, fold_type, clip_pos, state, released_at) VALUES ('J-1','red','dart','front','queued', now() - interval '5 days'),('J-2','red','dart','front','queued', now() - interval '4 days'),('J-3','blue','glider','back','at_station', now() - interval '6 days')");
  let ck = (await mgr.post(`${A}/agents/${line.id}/check`)).json;
  t("a proposed watch does not run", ck.results.length === 0 && (await q("SELECT count(*)::int n FROM platform.vsm_flags")).rows[0].n === 0);

  // ---- a manager's own watch is checked for shape
  t("a watch on a table the tool does not keep is refused", (await mgr.post(`${A}/agents/${line.id}/watches`, { shape: "waiting", tool: "paperline", title: "x", spec: { table: "nope", since_column: "released_at", hours: 1 } })).status === 400);
  t("a watch on a column that is not there is refused", (await mgr.post(`${A}/agents/${line.id}/watches`, { shape: "waiting", tool: "paperline", title: "x", spec: { table: "travelers", since_column: "nope", hours: 1 } })).status === 400);
  t("a time limit on a column that is not a time is refused", (await mgr.post(`${A}/agents/${line.id}/watches`, { shape: "waiting", tool: "paperline", title: "x", spec: { table: "travelers", since_column: "job_num", hours: 1 } })).status === 400);
  t("a watch on another agent's tool is refused", (await mgr.post(`${A}/agents/${line.id}/watches`, { shape: "quiet", tool: "kpis", title: "x", spec: { days: 3 } })).status === 400);
  t("a comparison that is not on the list is refused", (await mgr.post(`${A}/agents/${line.id}/watches`, { shape: "waiting", tool: "paperline", title: "x", spec: { table: "travelers", since_column: "released_at", hours: 1, where: [{ column: "state", op: "; DROP", value: 1 }] } })).status === 400);

  // ---- turn one on: a flag, routed by the map
  const on = await mgr.post(`${A}/watches/${trav.id}`, { status: "on", hours: 72, severity: "look" });
  t("a manager turns a proposed watch on and sets its limit", on.status === 200 && on.json.watch.status === "on" && on.json.watch.spec.hours === 72);
  ck = (await mgr.post(`${A}/agents/${line.id}/check`)).json;
  const flagRow = (await q("SELECT * FROM platform.vsm_flags")).rows[0];
  t("the watch finds the rows and opens one flag", ck.results[0].opened > 0 && flagRow && flagRow.count === 3 && flagRow.status === "open", ck);
  let board = (await mgr.get(`${A}/board?channel=plant`)).json;
  const flag = board.messages.find((m) => m.kind === "flag");
  t("it is on #plant, in the agent's words, with the rows by name and the limit", flag && /travelers still open \(over 3 days\): 3 found \(J-3, J-1, J-2\)/.test(flag.words) && flag.from_name === "Line agent" && flag.flag.status === "open", flag && flag.words);
  t("addressed by the map: the next agent, and the people of the control box with no agent; not the box two steps away", flag.to.some((x) => x.kind === "agent" && x.key === "kpi-agent") && flag.to.some((x) => x.kind === "box" && x.key === "line/plan" && x.people === "Dana") && !flag.to.some((x) => /wings|far/.test(x.key)), flag.to);
  t("the next agent's channel shows it", (await mgr.get(`${A}/board?channel=a:kpi-agent`)).json.messages.some((m) => m.id === flag.id));
  t("the box with no agent has a channel, and the mention lands there", board.channels.some((c) => c.key === "b:line/plan") && (await mgr.get(`${A}/board?channel=${encodeURIComponent("b:line/plan")}`)).json.messages.some((m) => m.id === flag.id));
  t("a box two steps away does not get it", !(await mgr.get(`${A}/board?channel=${encodeURIComponent("b:line/far")}`)).json.messages.some((m) => m.id === flag.id));
  t("the agent's channel counts it open", board.channels.find((c) => c.key === "a:line-agent").open === 1 && board.channels[0].open === 1);
  await mgr.post(`${A}/agents/${line.id}/check`);
  t("checked again with the same rows: still one flag, no new message", (await q("SELECT count(*)::int n FROM platform.vsm_flags")).rows[0].n === 1 && (await q("SELECT count(*)::int n FROM platform.vsm_messages WHERE kind='flag'")).rows[0].n === 1);
  await q("INSERT INTO mod_demo_paperline.travelers (job_num, color, fold_type, clip_pos, state, released_at) VALUES ('J-4','red','dart','front','queued', now() - interval '9 days')");
  await mgr.post(`${A}/agents/${line.id}/check`);
  let th = (await mgr.get(`${A}/board/threads/${flag.id}`)).json;
  t("more rows: the count is updated on the thread", th.root.flag.count === 4 && th.replies.some((r) => r.kind === "update" && /Now 4, was 3/.test(r.words)), th.replies.map((r) => r.words));

  // ---- people
  t("Seen", (await mgr.post(`${A}/board/flags/${flag.id}/seen`)).json.result.status === "seen");
  t("On it, with the name", (await mgr.post(`${A}/board/flags/${flag.id}/on_it`)).json.result.owner === "manager");
  t("Resolved needs a line", (await mgr.post(`${A}/board/flags/${flag.id}/resolved`, {})).status === 400);
  const reply = await mgr.post(`${A}/board/messages`, { thread_id: flag.id, words: "Lee is looking at the rack" });
  t("a reply in the thread", reply.status === 200 && reply.json.message.thread_id === flag.id && reply.json.message.from_kind === "person");
  t("a message in #plant", (await mgr.post(`${A}/board/messages`, { channel: "plant", words: "Short day Friday" })).status === 200);
  t("nobody writes in #escalations, and an empty message is refused", (await mgr.post(`${A}/board/messages`, { channel: "escalations", words: "x" })).status === 400 && (await mgr.post(`${A}/board/messages`, { channel: "plant", words: "  " })).status === 400);
  const res1 = await mgr.post(`${A}/board/flags/${flag.id}/resolved`, { words: "Released the four travelers" });
  t("Resolved with a line closes it", res1.json.result.status === "resolved" && res1.json.result.closed_at);
  await mgr.post(`${A}/agents/${line.id}/check`);
  const again = (await q("SELECT * FROM platform.vsm_flags ORDER BY thread_id")).rows;
  t("still true after it was resolved: a new flag opens (no hold in this run)", again.length === 2 && again[1].status === "open", again.map((f) => f.status));
  const flag2 = again[1].thread_id;
  const nap = await mgr.post(`${A}/board/flags/${flag2}/not_a_problem`, { words: "These are the display planes" });
  const muted = (await q("SELECT muted_until FROM platform.vsm_watches WHERE id=$1", [trav.id])).rows[0].muted_until;
  t("Not a problem closes it and mutes the watch for a week", nap.json.result.status === "not_a_problem" && muted && new Date(muted) - Date.now() > 6 * 86400e3);
  ck = (await mgr.post(`${A}/agents/${line.id}/check`)).json;
  t("a muted watch does not run", ck.results.length === 0 && (await q("SELECT count(*)::int n FROM platform.vsm_flags")).rows[0].n === 2);
  t("it can be unmuted", (await mgr.post(`${A}/watches/${trav.id}`, { unmute: true })).json.watch.muted_until === null);
  t("a flag that is closed takes no Seen; Reopen opens it", (await mgr.post(`${A}/board/flags/${flag2}/seen`)).status === 400 && (await mgr.post(`${A}/board/flags/${flag2}/reopen`)).json.result.status === "open");

  // ---- climbing: nobody marks it seen
  // it was reopened just above, and a reopened flag's clock starts at the reopen (the VSM audit, round 3)
  await q("UPDATE platform.vsm_flags SET opened_at = now() - interval '13 hours', reopened_at = now() - interval '13 hours' WHERE thread_id=$1", [flag2]);
  await mgr.post(`${A}/agents/${line.id}/check`);
  let f2 = (await q("SELECT * FROM platform.vsm_flags WHERE thread_id=$1", [flag2])).rows[0];
  t("a look flag nobody marked seen for a shift is raised to act", f2.severity === "act" && f2.raised_at && !f2.climbed_at);
  await q("UPDATE platform.vsm_flags SET raised_at = now() - interval '5 hours' WHERE thread_id=$1", [flag2]);
  await mgr.post(`${A}/agents/${line.id}/check`);
  f2 = (await q("SELECT * FROM platform.vsm_flags WHERE thread_id=$1", [flag2])).rows[0];
  t("an act flag nobody marked seen climbs", Boolean(f2.climbed_at));
  const esc = (await mgr.get(`${A}/board?channel=escalations`)).json;
  t("it is on #escalations", esc.messages.some((m) => m.id === flag2) && esc.channels.find((c) => c.key === "escalations").open === 1);
  const notice = (await q("SELECT text FROM platform.notices WHERE company='demo' AND kind='agent_flag'")).rows;
  t("a notice for every manager on the board", notice.length === 1 && /Line agent/.test(notice[0].text));
  const push = await waitFor("the push", async () => pushes.find((p) => p.title === "A flag climbed") || null);
  t("the phones get it: the company, the agent and the kind of flag, and a link to the thread", /Demo Company: Line agent/.test(push.message) && /waited too long/.test(push.message) && /agent-board\?thread=/.test(push.click || ""), push);
  t("the push carries no record value and no title a person wrote", !/J-\d|travelers|Paper Airplane/.test(JSON.stringify(push)));
  await mgr.post(`${A}/agents/${line.id}/check`);
  t("it climbs once", (await q("SELECT count(*)::int n FROM platform.notices WHERE kind='agent_flag'")).rows[0].n === 1 && pushes.filter((p) => p.title === "A flag climbed").length === 1);
  const mv = (await mgr.get(`${A}/maps/${(await mgr.get(A)).json.maps[0].id}`)).json;
  t("the Map's chips: the agent with its open flag and the climb, and the red box", mv.agents.agents.find((a) => a.key === "line-agent").open === 1 && mv.agents.agents.find((a) => a.key === "line-agent").climbed === 1 && mv.agents.climbed_boxes.includes("line/rel"));

  // ---- clearing, quiet, a request
  await q("UPDATE mod_demo_paperline.travelers SET done_at = now()");
  await mgr.post(`${A}/agents/${line.id}/check`);
  f2 = (await q("SELECT * FROM platform.vsm_flags WHERE thread_id=$1", [flag2])).rows[0];
  th = (await mgr.get(`${A}/board/threads/${flag2}`)).json;
  t("the rows clear: the flag closes and says so", f2.status === "cleared" && th.replies.some((r) => r.kind === "cleared"));
  const quiet = line.watches.find((w) => w.shape === "quiet");
  await mgr.post(`${A}/watches/${quiet.id}`, { status: "on", days: 3 });
  await q("DELETE FROM platform.module_use WHERE company='demo' AND module='paperline'");
  await q("INSERT INTO platform.module_use (company, module, day, views, changes) VALUES ('demo','paperline', current_date - 10, 5, 7)");
  await mgr.post(`${A}/agents/${line.id}/check`);
  const qf = (await q("SELECT f.*, m.words FROM platform.vsm_flags f JOIN platform.vsm_messages m ON m.id=f.thread_id WHERE f.watch_id=$1", [quiet.id])).rows[0];
  t("a tool the plant stopped using is flagged from its own use", qf && qf.status === "open" && /nobody at the plant changed anything/.test(qf.words), qf && qf.words);
  const rq = await mgr.post(`${A}/board/flags/${qf.thread_id}/request`, { words: "Ask Lee why the line stopped" });
  const fb = rq.json.result && (await q("SELECT * FROM platform.feedback WHERE id=$1", [rq.json.result.feedback_id])).rows[0];
  t("Make it a request: a Kaizen card on the flag's tool, with the evidence", rq.status === 200 && fb && fb.module === "paperline" && fb.source === "agent_board" && /From the agent board/.test(fb.message) && /Ask Lee/.test(fb.message), rq.text);
  t("and only once", (await mgr.post(`${A}/board/flags/${qf.thread_id}/request`, {})).status === 400);

  // ---- the data wall: watches are platform code, so they still run
  await admin.post("/api/admin/companies/demo/data-wall", { walled: true });
  const mr = line.watches.find((w) => w.spec.table === "material_requests");
  await mgr.post(`${A}/watches/${mr.id}`, { status: "on", hours: 0 });
  await q("INSERT INTO mod_demo_paperline.material_requests (item, qty, status) VALUES ('red paper', 10, 'open')");
  await mgr.post(`${A}/agents/${line.id}/check`);
  t("under the data wall a watch still runs and flags", (await q("SELECT count(*)::int n FROM platform.vsm_flags WHERE watch_id=$1 AND status='open'", [mr.id])).rows[0].n === 1);
  await admin.post("/api/admin/companies/demo/data-wall", { walled: false });

  // ---- pausing, another company, the record, the backup, the delete
  await mgr.post(`${A}/agents/${line.id}`, { status: "paused" });
  t("a paused agent's watches do not run from Check now", (await mgr.post(`${A}/agents/${line.id}/check`)).status === 400);
  await mgr.post(`${A}/agents/${line.id}`, { status: "on" });
  const made = await admin.post("/api/admin/companies", { slug: "agentco", name: "Agent Co" });
  const other = await login(made.json.passwords.manager, "agentco");
  t("another company's manager cannot read this board", (await other.get(`${A}/board`)).status === 403 && (await other.get(`${A}/agents`)).status === 403);
  t("nor reach its flags, watches or agents through its own slug", (await other.post(`/api/c/agentco/vsm/board/flags/${flag.id}/seen`)).status === 404 && (await other.post(`/api/c/agentco/vsm/watches/${trav.id}`, { status: "off" })).status === 404
    && (await other.post(`/api/c/agentco/vsm/agents/${line.id}/check`)).status === 404 && (await other.get(`/api/c/agentco/vsm/board/threads/${flag.id}`)).status === 404 && (await other.post("/api/c/agentco/vsm/board/messages", { thread_id: flag.id, words: "x" })).status === 404);
  t("and nothing changed", (await q("SELECT status FROM platform.vsm_watches WHERE id=$1", [trav.id])).rows[0].status === "on");
  t("the ids in the routes take digits only", (await mgr.get(`${A}/board/threads/0x1`)).status === 404);
  const kinds = (await q("SELECT DISTINCT kind FROM platform.record WHERE company='demo' AND kind LIKE 'agent%'")).rows.map((r) => r.kind);
  t("on the record: set up, watches changed, flags, people's actions, the climb, the board's messages", ["agent_set_up", "agent_watch_changed", "agent_flag", "agent_flag_seen", "agent_flag_on_it", "agent_flag_resolved", "agent_flag_not_a_problem", "agent_flag_climbed", "agent_flag_cleared", "agent_board_message", "agent_changed"].every((k) => kinds.includes(k)), kinds);
  t("no word a company reads names a model or carries a dash", !/[–—]/.test(JSON.stringify((await q("SELECT words FROM platform.vsm_messages")).rows)));
  const bk = await admin.get("/api/admin/backup");
  t("the board is in the backup", bk.status === 200 && ["vsm_agents", "vsm_watches", "vsm_messages", "vsm_flags"].every((k) => Array.isArray(bk.json.platform[k]) && bk.json.platform[k].some((r) => r.company === "demo")));
  await mgr.post("/api/c/demo/vsm/board/messages", { channel: "plant", words: "keep" });
  await q("INSERT INTO platform.vsm_messages (company, channel, kind, from_kind, from_name, words) VALUES ('agentco','plant','note','person','x','theirs')");
  await require("../../src/vsm").deleteCompany("agentco");
  t("a company's board goes with the company, another's stays", (await q("SELECT count(*)::int n FROM platform.vsm_messages WHERE company='agentco'")).rows[0].n === 0 && (await q("SELECT count(*)::int n FROM platform.vsm_messages WHERE company='demo'")).rows[0].n > 5);
  stub.close();
}
// The background runner (a server with SOS_WATCH_MS=1000): a watch turned on is looked at, and flags, with nobody pressing
// anything.
async function runnerOnly() {
  const mgr = await login(PW.manager, "demo"), admin = await login(PW.admin, "");
  await admin.post(`${A}/import`, MAP);
  await mgr.post(`${A}/agents`, { key: "line-agent" });
  const line = (await mgr.get(`${A}/agents`)).json.agents.find((a) => a.key === "line-agent");
  const trav = line.watches.find((w) => w.spec.table === "travelers");
  await q("INSERT INTO mod_demo_paperline.travelers (job_num, color, fold_type, clip_pos, state) VALUES ('J-9','red','dart','front','queued')");
  await mgr.post(`${A}/watches/${trav.id}`, { status: "on", hours: 0 });
  const f = await waitFor("the runner's flag", async () => (await q("SELECT * FROM platform.vsm_flags WHERE watch_id=$1", [trav.id])).rows[0] || null);
  t("the runner looks at a watch on its own and flags", f && f.status === "open" && f.count === 1);
  await q("UPDATE mod_demo_paperline.travelers SET done_at = now()");
  const c = await waitFor("the runner's clear", async () => { const r = (await q("SELECT * FROM platform.vsm_flags WHERE watch_id=$1", [trav.id])).rows[0]; return r && r.status === "cleared" ? r : null; });
  t("and clears it on its own", Boolean(c));
  t("one flag, however many times it looked", (await q("SELECT count(*)::int n FROM platform.vsm_flags")).rows[0].n === 1);
}
(process.argv[2] === "runner" ? runnerOnly() : main()).then(() => R.done()).catch(R.abort);
