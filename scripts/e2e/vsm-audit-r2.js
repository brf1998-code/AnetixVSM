// End to end for round 2 of the VSM audit (docs/FEATURES.md, "The VSM audit's round 2", 2026-11-03). What it proves:
// the actions that had no way back have one (Not now on an agent's draft card, a closed plant request, a walk put
// away), and the one that stays for good asks first in the page; a burst is filed with the words the manager sent; a
// part-scrapped run is still open to a stage watch and an agent's review; a job that began before the live numbers'
// window keeps its whole lead time.
// Against a server ALREADY UP in fake-agent mode on a fresh database, with SOS_WATCH_MS=0; this script also calls the
// stage functions in its own process, on the same database.
const { PW, runner, login } = require("./lib");
const { q } = require("../../src/db");
const R = runner(), t = R.t;
const A = "/api/c/demo/vsm";
const MAP = { format: "anetix-map-1", stages: [], maps: [{ key: "planes", family: "Planes", title: "Planes",
  nodes: [
    { key: "plan", kind: "control", label: "Plan the day", x: 500, y: 40 },
    { key: "kit", kind: "process", label: "Kitting", record_kind: "paper", x: 280, y: 240 },
    { key: "asm", kind: "process", label: "Assembly", modules: ["paperline"], record_kind: "anetix", x: 500, y: 240, detail: { agent_name: "Line agent" } },
    { key: "cus", kind: "customer", label: "Customers", x: 800, y: 20 } ],
  edges: [{ from: "plan", to: "kit", kind: "info_word" }, { from: "kit", to: "asm", kind: "push" }, { from: "asm", to: "cus", kind: "ship" }],
  kaizen: [{ node: "kit", n: 1, title: "A kit cart", why: "Kai walks." }, { node: "asm", n: 2, title: "Show the next job", why: "Nobody knows." }] }] };

(async () => {
  const mgr = await login(PW.manager, "demo"), admin = await login(PW.admin, "");
  await admin.post(`${A}/import`, MAP);
  const mapId = (await mgr.get(A)).json.maps.find((m) => m.key === "planes").id;
  await mgr.post(`${A}/agents`, { key: "line-agent" });
  const la = (await mgr.get(`${A}/agents`)).json.agents.find((a) => a.key === "line-agent");

  // ---- Not now on a draft card is not for good
  const dm = (await q(`INSERT INTO platform.vsm_messages (company, channel, kind, from_kind, from_name, agent_id, words) VALUES ('demo',$1,'draft','agent','Line agent',$2,'Drafted a request') RETURNING id`, [`a:${la.key}`, la.id])).rows[0];
  await q("INSERT INTO platform.vsm_drafts (message_id, company, agent_id, tool, what, why) VALUES ($1,'demo',$2,'paperline','Show the next job big','Nobody knows what is next')", [dm.id, la.id]);
  const nn = await mgr.post(`${A}/board/drafts/${dm.id}/dismiss`);
  const blocked = await mgr.post(`${A}/board/drafts/${dm.id}/send`);
  t("a card put away with Not now cannot be sent until it is brought back", nn.status === 200 && blocked.status === 400 && /Bring it back/.test(blocked.json.error));
  const back = await mgr.post(`${A}/board/drafts/${dm.id}/restore`);
  const st = (await q("SELECT state, decided_by FROM platform.vsm_drafts WHERE message_id=$1", [dm.id])).rows[0];
  t("Bring it back makes it a draft again, and says so in its thread", back.status === 200 && st.state === "draft" && st.decided_by === null
    && (await q("SELECT count(*)::int n FROM platform.vsm_messages WHERE thread_id=$1 AND words LIKE '%brought it back.'", [dm.id])).rows[0].n === 1);
  t("bringing back a card that is waiting is refused", (await mgr.post(`${A}/board/drafts/${dm.id}/restore`)).status === 409);
  const sent = await mgr.post(`${A}/board/drafts/${dm.id}/send`);
  t("then it can be sent", sent.status === 200 && sent.json.result.state === "sent" && (await mgr.post(`${A}/board/drafts/${dm.id}/restore`)).status === 409);
  t("the record has it brought back", (await q("SELECT count(*)::int n FROM platform.record WHERE kind='agent_draft_brought_back'")).rows[0].n === 1);

  // ---- a burst is filed with the words the manager sent
  const view = (await mgr.get(`${A}/maps/${mapId}`)).json;
  const z1 = view.kaizen.find((x) => x.n === 1);
  const fz = await mgr.post(`${A}/kaizen/${z1.id}/file`, { as: "plant", words: "A kit cart at Kitting, by Friday" });
  const fzr = fz.json && fz.json.feedback_id ? (await q("SELECT message, kind FROM platform.feedback WHERE id=$1", [fz.json.feedback_id])).rows[0] : null;
  t("a burst becomes a plant request in the words the manager sent", fz.status === 200 && fzr && fzr.kind === "plant" && fzr.message === "A kit cart at Kitting, by Friday", fzr);
  const z2 = view.kaizen.find((x) => x.n === 2);
  t("an empty one is refused, and the burst stays open", (await mgr.post(`${A}/kaizen/${z2.id}/file`, { as: "plant", words: "  " })).status === 400 && (await q("SELECT status FROM platform.vsm_kaizen WHERE id=$1", [z2.id])).rows[0].status === "open");

  // ---- a closed plant request can be opened again
  const pid = fz.json.feedback_id;
  const closed = await mgr.post(`/api/feedback/${pid}/close`, { outcome: "Cart ordered", declined: false });
  const reo = await mgr.post(`${A}/plant/${pid}/reopen`);
  const prow = (await q("SELECT status, outcome FROM platform.feedback WHERE id=$1", [pid])).rows[0];
  t("a plant request closed with Done opens again, its outcome cleared", closed.status === 200 && reo.status === 200 && prow.status === "new" && prow.outcome === null, [closed.status, reo.status, prow]);
  t("an open one is not reopened", (await mgr.post(`${A}/plant/${pid}/reopen`)).status === 409);
  t("the record has it reopened, with what it said before", (await q("SELECT before FROM platform.record WHERE kind='plant_request_reopened' AND feedback_id=$1", [pid])).rows[0].before === "Cart ordered");
  const tool = await mgr.post(`${A}/plant/${pid}/new-tool`);
  const moved = await mgr.post(`${A}/plant/${pid}/reopen`);
  t("one that became a new tool request stays closed, and says where it went", tool.status === 200 && moved.status === 409 && new RegExp(`#${tool.json.feedback_id}`).test(moved.json.error), moved.json);
  await mgr.post(`/api/intakes/${tool.json.intake_id}/abandon`);

  // ---- a walk put away comes back
  const walk = (await mgr.post(`${A}/walks`, {})).json.walk;
  await mgr.post(`${A}/walks/${walk.id}/words`, { title: "Walk notes", kind: "walk", words: "Kai kits paper, then the line folds it." });
  const away = await mgr.post(`${A}/walks/${walk.id}/abandon`);
  const ov = (await mgr.get(A)).json;
  t("a walk put away leaves the open walks and is listed as put away", away.status === 200 && !ov.walks.some((w) => w.id === walk.id) && (ov.walks_away || []).some((w) => w.id === walk.id), ov.walks_away);
  const bb = await mgr.post(`${A}/walks/${walk.id}/bring-back`);
  t("Bring the walk back puts it where it was, with its sources", bb.status === 200 && bb.json.walk.status === "sources" && bb.json.walk.sources.length === 1, bb.json.walk && bb.json.walk.status);
  t("and it is open again", (await mgr.get(A)).json.walks.some((w) => w.id === walk.id) && (await mgr.post(`${A}/walks/${walk.id}/bring-back`)).status === 409);

  // ---- the stage numbers: a part scrap, a job older than the window
  const S = require("../../src/vsm-stages");
  const ev = (step, ref, kind, minAgo, qty = 1) => q("INSERT INTO platform.vsm_stage_events (company, module, step, ref, kind, qty, at) VALUES ('demo','paperline',$1,$2,$3,$4, now() - ($5::int * interval '1 minute'))", [step, ref, kind, qty, minAgo]);
  await ev("Fold", "J-1", "start", 600, 10); await ev("Fold", "J-1", "scrap", 540, 2);
  await ev("Fold", "J-2", "start", 600, 3); await ev("Fold", "J-2", "scrap", 590, 3);
  await ev("Fold", "J-3", "start", 600); await ev("Fold", "J-3", "finish", 580);
  const late = await S.evaluateStage("demo", { module: "paperline", step: "Fold", measure: "open", hours: 8 });
  t("a stage watch sees a part-scrapped job as still open, and a wholly scrapped one as gone", late.count === 1 && late.sample[0].label === "J-1", late);
  const wip = await S.evaluateStage("demo", { module: "paperline", step: "Fold", measure: "wip", limit: 0 });
  t("and counts it in work in process", wip.count === 1, wip);
  const fa = await S.forAgent("demo", [{ module: "paperline", step: "Fold" }]);
  t("an agent's review reads it as open too", fa.open_longest.length === 1 && fa.open_longest[0].ref === "J-1" && fa.open_longest[0].kind === "start", fa.open_longest);
  await ev("Cut", "J-9", "start", 9 * 1440); await ev("Cut", "J-9", "finish", 9 * 1440 - 30);
  await ev("Pack", "J-9", "start", 60); await ev("Pack", "J-9", "finish", 10);
  const live = await S.liveFor("demo", [{ key: "cut", kind: "process", detail: { steps: [{ module: "paperline", step: "Cut" }] } }, { key: "pack", kind: "process", detail: { steps: [{ module: "paperline", step: "Pack" }] } }],
    [{ from_key: "cut", to_key: "pack", kind: "push" }]);
  t("a job that started before the week keeps its whole lead time", live.lead && live.lead.refs === 1 && live.lead.lead_min > 9 * 1440 - 20 && live.lead.lead_min < 9 * 1440 + 20, live.lead);
})().then(() => R.done()).catch(R.abort);
