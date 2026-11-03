// M3 of the value stream map (docs/VSM.md section 10, 2026-11-02): the Map and the Kaizen board joined.
//
//   - A request sits on a box. feedback.map_key and feedback.node_key tie it to a box of a map by keys (a box's key
//     survives an import and a walk's "Use this map", where its id does not; the agent board ties boxes the same way).
//     The board shows the box on the card, "Show on map" opens it, and the board filters by box as it does by tool.
//   - A box with no tool can carry a request too: a plant request (feedback.kind 'plant', no tool). It is the plant's
//     own work (move a bench, a FIFO lane, a word with the supplier), so no AI reads it and nothing is built: a manager
//     moves it to Working on it, Done or Not doing this, or makes it a new tool request. This ends the trap where a
//     request with no tool landed in Requests to Anetix (section 4).
//   - A kaizen burst becomes a request in one tap: a change to one of the box's tools (the proposer reads it on arrival,
//     as any request), a plant request, or a new tool request pre-filled from the box (section 5, phase 6: round 1's
//     who, how it is kept today, the stages and what it works with come from the box). Or it is put away.
//   - The future state (decision 9, Brendan 2026-11-02: "the agent drafts it"). One model call reads the family's
//     current map and drafts its future state beside it: the same boxes, flows changed to pull, FIFO or supermarket
//     where the map shows the reason, where each step's record would live, and up to eight kaizen bursts, each tied to
//     evidence on the map (a quote, a "?", a word-of-mouth flow, a wait, a step with no record). Platform code checks
//     every part against the map and lists what it left out; the manager keeps it, or drafts it again. Bursts on it act
//     like any other. A future map is never the plant today: the agents, the walk and the live numbers ignore it.
//
// Rules kept here:
//   - Every route is under /api/c/:slug/vsm (auth.companyGuard scopes it), managers and admins, and every id is checked
//     against the company in its own WHERE. Every write goes on the record.
//   - Nothing here moves anything toward the floor: a change request waits for the proposer and the manager's approval
//     like any other, a new tool request for its own design and confirm.
//   - The future draft reads the map, which is the plant's own typed words; under the data wall it leaves out the live
//     numbers (they come from the tools' records). Its model and cost go to admins only (the meter, the record).
const express = require("express");
const { q, pool } = require("./db");
const record = require("./record");
const agent = require("./agent");
const plain = require("./plainwords");

const SCHEMA = `
ALTER TABLE platform.feedback ADD COLUMN IF NOT EXISTS map_key TEXT;
ALTER TABLE platform.feedback ADD COLUMN IF NOT EXISTS node_key TEXT;
CREATE INDEX IF NOT EXISTS feedback_box ON platform.feedback (company, map_key, node_key) WHERE node_key IS NOT NULL;
ALTER TABLE platform.vsm_kaizen ADD COLUMN IF NOT EXISTS evidence JSONB;
ALTER TABLE platform.vsm_kaizen ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'map';
ALTER TABLE platform.vsm_kaizen ADD COLUMN IF NOT EXISTS becomes TEXT;
ALTER TABLE platform.vsm_kaizen ADD COLUMN IF NOT EXISTS decided_by TEXT;
ALTER TABLE platform.vsm_kaizen ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ;
ALTER TABLE platform.vsm_maps ADD COLUMN IF NOT EXISTS parent_key TEXT;`;
async function init() { await q(SCHEMA); }

const AS = ["change", "plant", "new_tool"];
const PLANT_STATUS = ["new", "in_progress"];
const EVIDENCE = ["quote", "unknown", "word", "wait", "no_record"];
const FLOW_KINDS = ["push", "pull", "fifo", "supermarket", "info_system", "info_word"];
const RECORD_KINDS = ["anetix", "next", "other", "paper", "none"];
const MAX_BURSTS = 8, MAX_FLOWS = 12, MAX_RECORDS = 10;

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const txt = (v, n) => String(v == null ? "" : v).replace(/\r\n?/g, "\n").trim().slice(0, n);
const line = (v, n) => txt(v, n).replace(/\s*\n+\s*/g, " ");
const norm = (s) => String(s || "").toLowerCase().replace(/[‘’“”"']/g, "").replace(/\s+/g, " ").trim();
const whoOf = (req) => (req && ((req.sosAccount && (req.sosAccount.name || req.sosAccount.login)) || req.sosPerson)) || (req && req.sosRole === "admin" ? "Anetix" : "a manager");

// ---- pure: a new tool request pre-filled from a box (section 5, phase 6) ----------------------------------------------
// The answers of round 1 the box can give (src/intake-questions.js shapes). A guess the manager sees answered and can
// change; what the box cannot say is left for the manager.
function prefillFromBox(node, stages, words) {
  const n = node || {}, d = n.detail || {};
  const a = {};
  const purpose = [line(words, 1500), n.label ? `On the map: ${n.label}${d.what ? `, where ${line(d.what, 400).replace(/^[A-Z]/, (c) => c.toLowerCase())}` : ""}.` : "", d.missing ? `Not recorded today: ${line(d.missing, 400)}` : ""].filter(Boolean).join("\n\n");
  if (purpose) a.purpose = purpose.slice(0, 8000);
  if (n.kind === "process") a.who = { floor: "" };
  else if (n.kind === "control") a.who = { office: "" };
  const sys = line(n.record_system, 60);
  if (n.record_kind === "paper") a.today = /white ?board/i.test(sys) ? { picks: ["whiteboard"] } : /sheet|excel/i.test(sys) ? { picks: ["spreadsheet"] } : { picks: ["paper"], ...(sys ? { other: "" } : {}) };
  else if (n.record_kind === "other" && sys) a.today = /sheet|excel/i.test(sys) ? { picks: ["spreadsheet"] } : { picks: ["program"], names: { program: sys } };
  else if (n.record_kind === "none") a.today = { picks: ["none"] };
  if (a.today && a.today.other === "") delete a.today.other;
  const names = (n.stage_refs || []).map((r) => (stages || []).find((s) => s.ref === r)).filter(Boolean).map((s) => line(s.name, 200));
  if (names.length >= 2) a.stages = names.slice(0, 16);
  if (n.record_kind === "other" && sys && !/sheet|excel/i.test(sys)) a.works_with = { picks: ["program"], names: { program: sys } };
  return a;
}

// ---- reading -----------------------------------------------------------------------------------------------------------
async function mapRow(company, key) {
  return (await q("SELECT * FROM platform.vsm_maps WHERE company=$1 AND key=$2 AND replaced_at IS NULL", [company, key])).rows[0] || null;
}
async function nodeRow(company, mapId, key) {
  return (await q("SELECT * FROM platform.vsm_nodes WHERE company=$1 AND map_id=$2 AND key=$3", [company, mapId, key])).rows[0] || null;
}
// Where a request on a box of a future map is tied: the same box on the current map when it is there, since the board
// shows where the work is today.
async function tieOf(company, map, nodeKey) {
  if (map.state === "future" && map.parent_key) {
    const parent = await mapRow(company, map.parent_key);
    if (parent && (await nodeRow(company, parent.id, nodeKey))) return { map_key: parent.key, node_key: nodeKey };
  }
  return { map_key: map.key, node_key: nodeKey };
}
// The requests on a map's boxes (and, for a future map, on its current map's), newest open first: the map's panels.
async function cardsFor(company, map) {
  const keys = [map.key].concat(map.state === "future" && map.parent_key ? [map.parent_key] : []);
  return (await q(`SELECT id, node_key, kind, module, status, message, name, created_at FROM platform.feedback
                    WHERE company=$1 AND map_key = ANY($2) AND duplicate_of IS NULL
                    ORDER BY (status IN ('done','declined')), id DESC LIMIT 300`, [company, keys])).rows
    .map((r) => ({ ...r, message: line(r.message, 200) }));
}
// For the board: the boxes the requests sit on, by "map_key/node_key".
async function boxesFor(company, rows) {
  const pairs = [...new Set((rows || []).filter((f) => f.map_key && f.node_key).map((f) => `${f.map_key}/${f.node_key}`))];
  if (!pairs.length) return {};
  const mapKeys = [...new Set(pairs.map((p) => p.split("/")[0]))];
  const found = (await q(`SELECT m.id AS map_id, m.key AS map_key, m.family, m.state, n.key, n.label FROM platform.vsm_nodes n JOIN platform.vsm_maps m ON m.id=n.map_id
                           WHERE n.company=$1 AND m.key = ANY($2) AND m.replaced_at IS NULL`, [company, mapKeys])).rows;
  const out = {};
  for (const p of pairs) {
    const [mk, nk] = p.split("/");
    const r = found.find((x) => x.map_key === mk && x.key === nk);
    out[p] = r ? { label: r.label, map_id: r.map_id, family: r.family, future: r.state === "future" } : { label: nk, map_id: null, gone: true };
  }
  return out;
}

// ---- filing: from a box or a burst --------------------------------------------------------------------------------------
// opts: { map (row), node (row), as, tool, words, kaizen (row) }. Returns what was made.
async function fileFrom(req, company, o) {
  const as = String(o.as || "");
  if (!AS.includes(as)) throw bad("A request from the map is a change to a tool, a plant request, or a new tool.");
  const words = txt(o.words, 2000);
  if (!words) throw bad("Say what should change, in a line or two.");
  const by = whoOf(req);
  const tie = await tieOf(company, o.map, o.node.key);
  const mine = req.sosPersonId && req.sosPersonCompany === company;
  const screen = `Map: ${line(o.node.label, 60)}`.slice(0, 80);
  let made;
  if (as === "change") {
    const tool = String(o.tool || "");
    if (!(o.node.modules || []).includes(tool)) throw bad("A change goes to one of this box's own tools. Pick one, or make it a plant request.");
    const row = (await q("SELECT name, title, live_version FROM platform.modules WHERE company=$1 AND name=$2 AND archived_at IS NULL", [company, tool])).rows[0];
    if (!row || !row.live_version) throw bad("That tool is not on the floor now, so a change has nothing to change. Make it a plant request, or a new tool.");
    const fb = (await q(`INSERT INTO platform.feedback (company, module, page, screen, message, name, person_id, reply_token, source, source_ref, map_key, node_key)
                         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'map',$9,$10,$11) RETURNING id`,
      [company, tool, `/c/${company}/map`, screen, words, by.slice(0, 80), mine ? req.sosPersonId : null, require("./arrival").newToken(), o.kaizen ? o.kaizen.id : null, tie.map_key, tie.node_key])).rows[0];
    await record.record("feedback_filed", { company, module: tool, actor: record.actor(req), feedback_id: fb.id, after: words, detail: { via: "map", box: tie.node_key, map: tie.map_key, ...(o.kaizen ? { kaizen: o.kaizen.n } : {}) } });
    const proposing = await require("./arrival").start(fb.id, { force: true }).catch(() => false);
    made = { as, feedback_id: fb.id, tool, proposing };
  } else if (as === "plant") {
    const fb = (await q(`INSERT INTO platform.feedback (company, module, page, screen, message, name, person_id, kind, source, source_ref, map_key, node_key)
                         VALUES ($1,NULL,$2,$3,$4,$5,$6,'plant','map',$7,$8,$9) RETURNING id`,
      [company, `/c/${company}/map`, screen, words, by.slice(0, 80), mine ? req.sosPersonId : null, o.kaizen ? o.kaizen.id : null, tie.map_key, tie.node_key])).rows[0];
    await record.record("feedback_filed", { company, module: null, actor: record.actor(req), feedback_id: fb.id, after: words, detail: { via: "map", plant: true, box: tie.node_key, map: tie.map_key, ...(o.kaizen ? { kaizen: o.kaizen.n } : {}) } });
    made = { as, feedback_id: fb.id };
  } else {
    made = { as, ...(await newToolFrom(req, company, o.node, words, tie)) };
  }
  if (o.kaizen) {
    await q("UPDATE platform.vsm_kaizen SET status='filed', feedback_id=$3, decided_by=$4, decided_at=now() WHERE company=$1 AND id=$2", [company, o.kaizen.id, made.feedback_id, by]);
    await record.record("kaizen_filed", { company, actor: record.actor(req), feedback_id: made.feedback_id, after: o.kaizen.title, detail: { kaizen: o.kaizen.n, map: o.map.key, box: o.node.key, as } });
  }
  return made;
}
// A new tool request with round 1 answered from the box where the box can say it (src/intake.js). A blank draft the
// company already had is used, as the New tool button does.
async function newToolFrom(req, company, node, words, tie) {
  const intake = require("./intake");
  const stages = (await q("SELECT ref, name FROM platform.vsm_stages WHERE company=$1", [company])).rows;
  const it = await intake.create(company, req.sosRole, { name: whoOf(req) });
  const answers = { ...prefillFromBox(node, stages, words), ...(it.answers || {}) };
  await q("UPDATE platform.module_intakes SET answers=$2::jsonb, updated_at=now() WHERE id=$1", [it.id, JSON.stringify(answers)]);
  await q("UPDATE platform.feedback SET map_key=$2, node_key=$3, updated_at=now() WHERE id=$1", [it.feedback_id, tie.map_key, tie.node_key]);
  await record.record("intake_started_from_map", { company, actor: record.actor(req), intake_id: it.id, feedback_id: it.feedback_id, after: words, detail: { box: tie.node_key, map: tie.map_key, prefilled: Object.keys(answers) } });
  return { feedback_id: it.feedback_id, intake_id: it.id };
}

async function burstOf(company, id) {
  const z = (await q("SELECT * FROM platform.vsm_kaizen WHERE company=$1 AND id=$2", [company, id])).rows[0];
  if (!z) throw bad("no such kaizen burst", 404);
  const map = (await q("SELECT * FROM platform.vsm_maps WHERE company=$1 AND id=$2", [company, z.map_id])).rows[0];
  if (!map || map.replaced_at) throw bad("That burst's map was replaced. Open the map in use.", 409);
  return { z, map };
}
async function fileBurst(req, company, id, b) {
  const { z, map } = await burstOf(company, id);
  if (z.status === "filed" && z.feedback_id) throw bad(`This burst is request #${z.feedback_id} already.`, 409);
  if (!z.node_key) throw bad("This burst is not on a box. Put it on the Kaizen board by hand.");
  const node = await nodeRow(company, map.id, z.node_key);
  if (!node) throw bad("The box this burst was on is not on the map now.", 409);
  const ev = z.evidence && z.evidence.text ? `\n\nOn the map: "${line(z.evidence.text, 300)}"` : "";
  const words = b.words != null ? b.words : `${z.title}${z.why ? `. ${z.why}` : ""}${ev}`;
  return fileFrom(req, company, { map, node, as: b.as, tool: b.tool, words, kaizen: z });
}
async function setBurst(req, company, id, to) {
  const { z } = await burstOf(company, id);
  if (z.status === "filed") throw bad(`This burst is request #${z.feedback_id} already.`, 409);
  const status = to === "dismissed" ? "dismissed" : "open";
  await q("UPDATE platform.vsm_kaizen SET status=$3, decided_by=$4, decided_at=now() WHERE company=$1 AND id=$2", [company, id, status, whoOf(req)]);
  await record.record(status === "dismissed" ? "kaizen_put_away" : "kaizen_brought_back", { company, actor: record.actor(req), after: z.title, detail: { kaizen: z.n, map_id: z.map_id } });
  return { status };
}
async function fileFromBox(req, company, nodeId, b) {
  const node = (await q("SELECT * FROM platform.vsm_nodes WHERE company=$1 AND id=$2", [company, nodeId])).rows[0];
  if (!node) throw bad("no such box", 404);
  const map = (await q("SELECT * FROM platform.vsm_maps WHERE company=$1 AND id=$2", [company, node.map_id])).rows[0];
  if (!map || map.replaced_at) throw bad("This map was replaced. Open the map in use.", 409);
  if (map.proposed) throw bad("This is a walk's draft. Use it as the family's map first, then ask for changes on it.", 409);
  return fileFrom(req, company, { map, node, as: b.as, tool: b.tool, words: b.words });
}

// ---- a plant request on the board ----------------------------------------------------------------------------------------
async function plantOf(company, id) {
  const fb = (await q("SELECT * FROM platform.feedback WHERE company=$1 AND id=$2 AND kind='plant'", [company, id])).rows[0];
  if (!fb) throw bad("no such plant request", 404);
  return fb;
}
async function plantStatus(req, company, id, status) {
  const fb = await plantOf(company, id);
  if (!PLANT_STATUS.includes(status)) throw bad("A plant request is new or being worked on; close it with Done or Not doing this.");
  if (["done", "declined"].includes(fb.status)) throw bad("This request is closed.", 409);
  await q("UPDATE platform.feedback SET status=$3, updated_at=now() WHERE company=$1 AND id=$2", [company, id, status]);
  await record.record("plant_request_moved", { company, actor: record.actor(req), feedback_id: id, before: fb.status, after: status });
  return { status };
}
// "Make it a new tool": the request closes, pointing at the new tool request, which carries the same box.
async function plantToTool(req, company, id) {
  const fb = await plantOf(company, id);
  if (["done", "declined"].includes(fb.status)) throw bad("This request is closed.", 409);
  const map = fb.map_key ? await mapRow(company, fb.map_key) : null;
  const node = map ? await nodeRow(company, map.id, fb.node_key) : null;
  const made = await newToolFrom(req, company, node || { label: "", kind: "process" }, fb.message, { map_key: fb.map_key, node_key: fb.node_key });
  await q("UPDATE platform.feedback SET status='done', outcome=$3, updated_at=now() WHERE company=$1 AND id=$2", [company, id, `Became new tool request #${made.feedback_id}.`]);
  await q("UPDATE platform.vsm_kaizen SET feedback_id=$3 WHERE company=$1 AND feedback_id=$2", [company, id, made.feedback_id]);
  await record.record("feedback_closed", { company, module: null, actor: record.actor(req), feedback_id: id, after: `Became new tool request #${made.feedback_id}.`, detail: { plant: true, new_tool: made.intake_id } });
  return made;
}

// ---- the future state (decision 9) ------------------------------------------------------------------------------------------
const FUTURE_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "Two or three sentences: what the future state changes and why, in plain words." },
    bursts: { type: "array", maxItems: MAX_BURSTS, items: { type: "object", properties: {
      node: { type: "string", description: "The key of the box the burst is on, exactly as given." },
      title: { type: "string", description: "What to do, under 80 characters." },
      why: { type: "string", description: "Why, from the map, under 300 characters." },
      becomes: { type: "string", enum: AS, description: "change: a change to an Anetix tool already on the box; new_tool: an Anetix tool for a step that has none; plant: work on the floor itself, no software." },
      evidence: { type: "object", properties: {
        kind: { type: "string", enum: EVIDENCE, description: "quote: a person's words on the box; unknown: a ? in its data box; word: a word-of-mouth flow into or out of it; wait: inventory or a wait before it; no_record: nothing or paper keeps its record." },
        text: { type: "string", description: "For a quote, the words exactly as they are on the map; otherwise the label or value you are pointing at." } }, required: ["kind", "text"] } },
      required: ["node", "title", "why", "becomes", "evidence"] } },
    flows: { type: "array", maxItems: MAX_FLOWS, items: { type: "object", properties: {
      from: { type: "string" }, to: { type: "string" }, kind: { type: "string", enum: FLOW_KINDS }, label: { type: "string", description: "A short label, or empty." } },
      required: ["from", "to", "kind"] } },
    records: { type: "array", maxItems: MAX_RECORDS, items: { type: "object", properties: {
      node: { type: "string" }, record_kind: { type: "string", enum: RECORD_KINDS }, record_system: { type: "string" }, note: { type: "string", description: "One line: what changes about where this step's record lives." } },
      required: ["node", "record_kind"] } },
  },
  required: ["summary", "bursts", "flows", "records"],
};
const SYSTEM = `You draft the future-state value stream map for one product family of a small manufacturer, the way Rother and Shook's Learning to See teaches it: produce to the customer's pace, flow continuously where steps can be joined, pull through a supermarket where they cannot, FIFO lanes between steps that cannot be joined or pulled, one pacemaker scheduled from production control, and information in a system instead of by word of mouth.

This plant's map adds one thing the paper method does not have: where each step's record lives (an Anetix tool, another system, paper or word of mouth, or nothing). A step with no record, or a record on paper, is a gap the plant cannot see; an Anetix tool is how the plant closes one. A change to an Anetix tool already on a box is a "change"; a tool for a step that has none is a "new_tool"; work on the floor itself, with no software, is "plant".

Rules:
- Use only the boxes and flows given. Name a box by its key exactly as given. Do not add boxes.
- Every burst stands on evidence that is on the map: a person's words on the box (quote them exactly), a ? in its data box, a word-of-mouth flow into or out of it, inventory or a wait before it, or a record kept nowhere or on paper. A burst without evidence on the map is left out.
- Never invent a number. A number nobody gave stays ?.
- At most ${MAX_BURSTS} bursts: the few that matter most for this family, not a list of everything.
- Change a flow only where the map shows the reason. Change where a record lives only where a burst calls for it.
- Plain words a production manager uses. No dashes between clauses; use commas or full stops.`;

async function contextFor(company, map) {
  const nodes = (await q("SELECT key, kind, label, sub, who, stage_refs, record_kind, record_system, modules, x, y, w, h, data, detail, confidence FROM platform.vsm_nodes WHERE company=$1 AND map_id=$2 ORDER BY id", [company, map.id])).rows;
  const edges = (await q("SELECT from_key, to_key, kind, label, from_side, to_side, from_at, to_at, inventory, sort FROM platform.vsm_edges WHERE company=$1 AND map_id=$2 ORDER BY sort, id", [company, map.id])).rows;
  const kaizen = (await q("SELECT node_key, n, title, status FROM platform.vsm_kaizen WHERE company=$1 AND map_id=$2 ORDER BY n", [company, map.id])).rows;
  const questions = (await q("SELECT node_key, claim FROM platform.vsm_questions WHERE company=$1 AND map_key=$2 AND status='open' ORDER BY sort, id LIMIT 40", [company, map.key])).rows;
  const walled = await require("./datawall").isWalled(company);
  const live = walled ? null : await require("./vsm-stages").liveFor(company, nodes, edges).catch(() => null);
  const tools = (await q("SELECT name, title, live_version FROM platform.modules WHERE company=$1 AND archived_at IS NULL", [company])).rows;
  const co = (await q("SELECT name FROM platform.companies WHERE slug=$1", [company])).rows[0] || {};
  return { map, nodes, edges, kaizen, questions, live, walled, tools, company_name: co.name || company };
}
function promptFor(ctx) {
  const t = (n) => (ctx.tools.find((x) => x.name === n) || { title: n }).title;
  const box = (n) => {
    const d = n.detail || {}, lv = ctx.live && ctx.live.nodes ? ctx.live.nodes[n.key] : null;
    return [`[${n.key}] ${n.label}${n.sub ? ` (${n.sub})` : ""}, a ${n.kind} box`,
      n.who ? `  who: ${n.who}` : "",
      `  record: ${n.record_kind}${n.record_system ? ` (${n.record_system})` : ""}${(n.modules || []).length ? `; Anetix tools: ${n.modules.map(t).join(", ")}` : ""}`,
      (n.data || []).length ? `  data box: ${n.data.map((r) => `${r.label} ${r.value}`).join("; ")}` : "",
      d.what ? `  what happens: ${line(d.what, 400)}` : "", d.recorded ? `  recorded today: ${line(d.recorded, 300)}` : "", d.missing ? `  not recorded: ${line(d.missing, 300)}` : "",
      d.quote ? `  quote: "${line(d.quote, 400)}" (${line(d.quote_by, 80)})` : "",
      lv && lv.events ? `  live, last ${ctx.live.days} days: cycle ${lv.cycle_min == null ? "?" : `${lv.cycle_min} min`}, work in process ${lv.wip}, first pass ${lv.fpy == null ? "?" : `${lv.fpy}%`}` : ""].filter(Boolean).join("\n");
  };
  const flow = (e) => `${e.from_key} -> ${e.to_key}: ${e.kind}${e.label ? ` "${line(e.label, 80)}"` : ""}${e.inventory ? `; waiting before it: ${line(e.inventory.label || "?", 60)}` : ""}${ctx.live && ctx.live.waits && ctx.live.waits[`${e.from_key}>${e.to_key}`] ? `; live wait ${ctx.live.waits[`${e.from_key}>${e.to_key}`].wait_min} min` : ""}`;
  return [`The current-state map of ${ctx.map.family} at ${ctx.company_name}.`,
    `Boxes:\n${ctx.nodes.map(box).join("\n")}`,
    `Flows:\n${ctx.edges.map(flow).join("\n") || "none"}`,
    ctx.questions.length ? `Where the map is still guessing:\n${ctx.questions.map((x) => `- ${x.node_key ? `[${x.node_key}] ` : ""}${line(x.claim, 200)}`).join("\n")}` : "",
    ctx.kaizen.length ? `Kaizen already on the current map (do not repeat these):\n${ctx.kaizen.map((z) => `- [${z.node_key || ""}] ${line(z.title, 120)}`).join("\n")}` : "",
    ctx.walled ? "The live numbers from the tools are left out: this company keeps its records walled off from the AI." : "",
    "Draft the future state: the flows to change, where records would live, and the kaizen bursts."].filter(Boolean).join("\n\n");
}
// The canned draft of fake mode (the tests, the sandbox): a burst per kind of evidence the map has, a pull between the
// first two process boxes, and a record for the first box with none.
function fakeFuture(ctx) {
  const procs = ctx.nodes.filter((n) => n.kind === "process").sort((a, b) => a.x - b.x);
  const bursts = [];
  const quoted = ctx.nodes.find((n) => n.detail && n.detail.quote);
  if (quoted) bursts.push({ node: quoted.key, title: `Act on what ${quoted.label} says`, why: "The person doing the work named the problem.", becomes: (quoted.modules || []).length ? "change" : "plant", evidence: { kind: "quote", text: String(quoted.detail.quote).slice(0, 40) } });
  const blank = ctx.nodes.find((n) => n.record_kind === "none" || n.record_kind === "paper");
  if (blank) bursts.push({ node: blank.key, title: `Keep ${blank.label}'s record in a tool`, why: "Nobody can see this step's work today.", becomes: "new_tool", evidence: { kind: "no_record", text: blank.label } });
  const word = ctx.edges.find((e) => e.kind === "info_word");
  if (word) bursts.push({ node: word.to_key, title: "Put the word-of-mouth hand-off in a system", why: "It is passed on in person.", becomes: "plant", evidence: { kind: "word", text: word.label || word.to_key } });
  bursts.push({ node: "no-such-box", title: "A burst on a box that is not on the map", why: "The board leaves it out.", becomes: "plant", evidence: { kind: "quote", text: "words nobody said" } });
  const flows = procs.length >= 2 ? [{ from: procs[0].key, to: procs[1].key, kind: "pull", label: "kanban" }] : [];
  const records = blank ? [{ node: blank.key, record_kind: "anetix", record_system: "", note: "Kept in an Anetix tool" }] : [];
  return { summary: `Pull ${procs[1] ? `into ${procs[1].label}` : "between the steps"}, and records for the steps nobody can see today.`, bursts, flows, records };
}

// Every part checked against the map; what fails is listed for the manager, never drawn.
function checkFuture(ctx, raw) {
  const d = raw && typeof raw === "object" ? raw : {};
  const byKey = Object.fromEntries(ctx.nodes.map((n) => [n.key, n]));
  const left = [];
  const holds = (n, ev) => {
    const text = norm(ev.text);
    switch (ev.kind) {
      case "quote": { if (text.length < 8) return false; const d2 = n.detail || {}; return [d2.quote, d2.what, d2.missing, d2.recorded, d2.notes].some((s) => norm(s).includes(text)); }
      case "unknown": return (n.data || []).some((r) => String(r.value || "").includes("?"));
      case "word": return ctx.edges.some((e) => e.kind === "info_word" && (e.from_key === n.key || e.to_key === n.key));
      case "wait": return ctx.edges.some((e) => e.to_key === n.key && (e.inventory || (ctx.live && ctx.live.waits && ctx.live.waits[`${e.from_key}>${e.to_key}`])));
      case "no_record": return n.record_kind === "none" || n.record_kind === "paper";
      default: return false;
    }
  };
  const bursts = [];
  for (const b of (Array.isArray(d.bursts) ? d.bursts : []).slice(0, MAX_BURSTS * 2)) {
    const n = byKey[line(b && b.node, 40)], title = line(b && b.title, 100);
    if (!title) continue;
    if (!n) { left.push(`"${title}": its box is not on the map.`); continue; }
    const ev = { kind: EVIDENCE.includes(b.evidence && b.evidence.kind) ? b.evidence.kind : "", text: line(b.evidence && b.evidence.text, 300) };
    if (!holds(n, ev)) { left.push(`"${title}" (${n.label}): the map does not show what it stands on.`); continue; }
    let becomes = AS.includes(b.becomes) ? b.becomes : "plant";
    if (becomes === "change" && !(n.modules || []).length) becomes = "new_tool";
    if (bursts.length >= MAX_BURSTS) { left.push(`"${title}": more than ${MAX_BURSTS} bursts.`); continue; }
    bursts.push({ node: n.key, title, why: line(b.why, 300), becomes, evidence: ev });
  }
  const flows = [];
  for (const f of (Array.isArray(d.flows) ? d.flows : []).slice(0, MAX_FLOWS * 2)) {
    const from = line(f && f.from, 40), to = line(f && f.to, 40), kind = f && f.kind;
    if (!byKey[from] || !byKey[to] || from === to) { left.push(`A flow from ${from || "?"} to ${to || "?"}: a box is not on the map.`); continue; }
    if (!FLOW_KINDS.includes(kind)) continue;
    const was = ctx.edges.find((e) => e.from_key === from && e.to_key === to);
    if (was && was.kind === kind) continue;
    if (flows.length >= MAX_FLOWS) break;
    flows.push({ from, to, kind, label: line(f.label, 60), was: was ? was.kind : null });
  }
  const records = [];
  for (const r of (Array.isArray(d.records) ? d.records : []).slice(0, MAX_RECORDS * 2)) {
    const n = byKey[line(r && r.node, 40)];
    if (!n || !RECORD_KINDS.includes(r.record_kind) || n.record_kind === r.record_kind) continue;
    if (records.some((x) => x.node === n.key) || records.length >= MAX_RECORDS) continue;
    records.push({ node: n.key, record_kind: r.record_kind, record_system: line(r.record_system, 120), note: line(r.note, 200), was: n.record_kind });
  }
  return { summary: line(d.summary, 600), bursts, flows, records, left_out: left.slice(0, 20) };
}
// The future map's rows, from the current map and the checked draft. Pure.
function drawFuture(ctx, c) {
  const nodes = ctx.nodes.map((n) => {
    const r = c.records.find((x) => x.node === n.key);
    const detail = { ...(n.detail || {}) };
    delete detail.steps; delete detail.screen;   // the future is not where today's work is reported or shown
    if (r && r.note) detail.future = r.note;
    return { ...n, record_kind: r ? r.record_kind : n.record_kind, record_system: r ? r.record_system || (r.record_kind === "anetix" ? "" : n.record_system) : n.record_system, detail, confidence: r ? "assumed" : n.confidence };
  });
  const byKey = Object.fromEntries(nodes.map((n) => [n.key, n]));
  const edges = ctx.edges.map((e) => ({ ...e }));
  let sort = edges.length;
  for (const f of c.flows) {
    const e = edges.find((x) => x.from_key === f.from && x.to_key === f.to);
    if (e) { e.kind = f.kind; if (f.label) e.label = f.label; continue; }
    const a = byKey[f.from], b = byKey[f.to];
    const sameRow = Math.abs(a.y - b.y) < Math.max(a.h, b.h);
    const sides = sameRow ? (a.x <= b.x ? ["right", "left"] : ["left", "right"]) : (a.y < b.y ? ["bottom", "top"] : ["top", "bottom"]);
    edges.push({ from_key: f.from, to_key: f.to, kind: f.kind, label: f.label, from_side: sides[0], to_side: sides[1], from_at: 0.5, to_at: 0.5, inventory: null, sort: sort++ });
  }
  const kaizen = c.bursts.map((b, i) => ({ node_key: b.node, n: i + 1, title: b.title, why: b.why, becomes: b.becomes, evidence: b.evidence }));
  return { nodes, edges, kaizen };
}

const drafting = new Map();   // "company/mapKey" -> { started, error }: in memory; a restart forgets a draft in flight
async function startFuture(req, company, mapId) {
  const map = (await q("SELECT * FROM platform.vsm_maps WHERE company=$1 AND id=$2 AND replaced_at IS NULL", [company, mapId])).rows[0];
  if (!map) throw bad("no such map", 404);
  if (map.state === "future") throw bad("This is a future state already. Draft it again from its current map.");
  if (map.proposed) throw bad("This is a walk's draft. Use it as the family's map first.");
  const k = `${company}/${map.key}`;
  if (drafting.has(k) && !drafting.get(k).error) throw bad("The future state is being drafted already.", 409);
  await agent.assertUnderCap(company);
  const nodes = Number((await q("SELECT count(*) FROM platform.vsm_nodes WHERE map_id=$1", [map.id])).rows[0].count);
  if (!nodes) throw bad("The map has no boxes to draft from.");
  drafting.set(k, { started: Date.now(), error: null });
  await record.record("map_future_asked", { company, actor: record.actor(req), detail: { map: map.key } });
  const job = draftFuture(company, map, whoOf(req)).then(() => drafting.delete(k)).catch((e) => {
    console.error(`[vsm-kaizen] ${company}/${map.key} future draft failed:`, e.message);
    drafting.set(k, { started: Date.now(), error: e.code === "cap" || e.status === 429 || e.status === 402 ? e.message : "The draft did not finish. Draft it again; if it fails again, write to Anetix." });
  });
  if (req && req.query && req.query.wait === "1") await job;   // the answer waits for the draft (the tests)
  return { drafting: true };
}
async function draftFuture(company, map, by) {
  const ctx = await contextFor(company, map);
  const model = (await agent.pickModel(company, "design", `future:${map.id}`)).model;
  const prompt = promptFor(ctx);
  const system = `${SYSTEM}${ctx.walled ? `\n\n${require("./datawall").PROMPT_NOTE}` : ""}\n\n${plain.rules()}`;
  let raw, cost = 0;
  if (agent.fakeMode()) {
    await agent.atWall("structured:map_future", { company, model, system, prompt });
    const wait = Number(process.env.SOS_FAKE_FUTURE_MS || 0);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    raw = fakeFuture(ctx);
  } else {
    const r = await agent.runStructured({ model, company, schema: FUTURE_SCHEMA, toolName: "map_future", maxTokens: 6000, system, prompt });
    raw = r.data; cost += r.costUsd || 0;
  }
  const c = checkFuture(ctx, raw);
  // generated words through the plain-words check: a line that cannot be said plainly is dropped, as the walk does
  const allow = ctx.tools.map((t) => t.title).concat(ctx.nodes.map((n) => n.record_system).filter(Boolean));
  const plainOr = (s) => { const out = require("./assist").scrubText(s); return plain.check(out, allow).length ? "" : out; };
  c.summary = plainOr(c.summary);
  c.bursts = c.bursts.map((b) => ({ ...b, title: plainOr(b.title), why: plainOr(b.why) })).filter((b) => b.title);
  c.records = c.records.map((r) => ({ ...r, note: plainOr(r.note) }));
  const d = drawFuture(ctx, c);
  const key = `${map.key.slice(0, 33)}-future`;
  const client = await pool.connect();
  let futureId;
  try {
    await client.query("BEGIN");
    const old = (await client.query("SELECT id, key FROM platform.vsm_maps WHERE company=$1 AND key=$2 AND replaced_at IS NULL", [company, key])).rows[0];
    if (old) await client.query("UPDATE platform.vsm_maps SET key=$3, replaced_at=now(), updated_at=now() WHERE company=$1 AND id=$2", [company, old.id, `${key.slice(0, 28)}-r${old.id}`]);
    const layout = { ...(map.layout || {}), feed: [], future: { summary: c.summary, left_out: c.left_out, drafted_by: by, drafted_at: new Date().toISOString(), flows: c.flows.length, records: c.records.length } };
    futureId = (await client.query(`INSERT INTO platform.vsm_maps (company, key, family, title, state, status, layout, sort, parent_key) VALUES ($1,$2,$3,$4,'future','draft',$5::jsonb,$6,$7) RETURNING id`,
      [company, key, map.family, `${map.family}, future state`, JSON.stringify(layout), map.sort, map.key])).rows[0].id;
    for (const n of d.nodes) {
      await client.query(`INSERT INTO platform.vsm_nodes (company, map_id, key, kind, label, sub, who, stage_refs, record_kind, record_system, modules, x, y, w, h, data, detail, confidence, updated_by)
                          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17::jsonb,$18,'the agent')`,
        [company, futureId, n.key, n.kind, n.label, n.sub || "", n.who || "", n.stage_refs || [], n.record_kind, n.record_system || "", n.modules || [], n.x, n.y, n.w, n.h, JSON.stringify(n.data || []), JSON.stringify(n.detail || {}), n.confidence]);
    }
    for (const e of d.edges) await client.query(`INSERT INTO platform.vsm_edges (company, map_id, from_key, to_key, kind, label, from_side, to_side, from_at, to_at, inventory, sort) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)`,
      [company, futureId, e.from_key, e.to_key, e.kind, e.label || "", e.from_side, e.to_side, e.from_at, e.to_at, e.inventory ? JSON.stringify(e.inventory) : null, e.sort]);
    for (const z of d.kaizen) await client.query(`INSERT INTO platform.vsm_kaizen (company, map_id, node_key, n, title, why, status, evidence, source, becomes) VALUES ($1,$2,$3,$4,$5,$6,'open',$7::jsonb,'agent',$8)`,
      [company, futureId, z.node_key, z.n, z.title, z.why, JSON.stringify(z.evidence), z.becomes]);
    await client.query("COMMIT");
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
  if (!agent.fakeMode()) await agent.recordUsage(company, null, "mapping", model, cost, { future: map.key, bursts: d.kaizen.length });
  await record.record("map_future_drafted", { company, actor: "agent", detail: { map: map.key, future_id: futureId, bursts: d.kaizen.length, flows: c.flows.length, records: c.records.length, left_out: c.left_out.length, model, cost_usd: cost } });
  return { future_id: futureId, bursts: d.kaizen.length, left_out: c.left_out };
}
async function keepFuture(req, company, mapId) {
  const m = (await q("SELECT * FROM platform.vsm_maps WHERE company=$1 AND id=$2 AND state='future' AND replaced_at IS NULL", [company, mapId])).rows[0];
  if (!m) throw bad("no such future state", 404);
  if (m.status === "confirmed") return { status: "confirmed" };
  await q("UPDATE platform.vsm_maps SET status='confirmed', updated_at=now() WHERE id=$1", [m.id]);
  await record.record("map_future_kept", { company, actor: record.actor(req), detail: { map: m.key, parent: m.parent_key } });
  return { status: "confirmed" };
}
// For a map's view: its future state (or, for a future, its current map), and a draft in flight
async function futureInfo(company, map) {
  if (map.state === "future") {
    const parent = map.parent_key ? await mapRow(company, map.parent_key) : null;
    return { parent: parent ? { id: parent.id, title: parent.title } : null, ...(map.layout && map.layout.future ? { summary: map.layout.future.summary, left_out: map.layout.future.left_out || [], drafted_by: map.layout.future.drafted_by, drafted_at: map.layout.future.drafted_at } : {}) };
  }
  const f = (await q("SELECT id, status, updated_at FROM platform.vsm_maps WHERE company=$1 AND parent_key=$2 AND state='future' AND replaced_at IS NULL ORDER BY id DESC LIMIT 1", [company, map.key])).rows[0];
  const job = drafting.get(`${company}/${map.key}`);
  return { future: f ? { id: f.id, status: f.status } : null, drafting: Boolean(job && !job.error), error: job && job.error ? job.error : null };
}

// ---- routes: managers and admins, under /api/c/:slug/vsm ---------------------------------------------------------------
const router = express.Router();
const requireManager = (req, res, next) => require("./auth").requireManager(req, res, next);
const slugOf = (req) => String(req.params.slug || "").toLowerCase();
const small = express.json({ limit: "16kb" });
const ID = ":id(\\d{1,9})";
const V = "/api/c/:slug/vsm";
router.post(`${V}/kaizen/${ID}/file`, requireManager, small, async (req, res) => res.json({ ok: true, ...(await fileBurst(req, slugOf(req), Number(req.params.id), req.body || {})) }));
router.post(`${V}/kaizen/${ID}/dismiss`, requireManager, async (req, res) => res.json({ ok: true, ...(await setBurst(req, slugOf(req), Number(req.params.id), "dismissed")) }));
router.post(`${V}/kaizen/${ID}/restore`, requireManager, async (req, res) => res.json({ ok: true, ...(await setBurst(req, slugOf(req), Number(req.params.id), "open")) }));
router.post(`${V}/nodes/${ID}/request`, requireManager, small, async (req, res) => res.json({ ok: true, ...(await fileFromBox(req, slugOf(req), Number(req.params.id), req.body || {})) }));
router.post(`${V}/maps/${ID}/future`, requireManager, async (req, res) => res.json({ ok: true, ...(await startFuture(req, slugOf(req), Number(req.params.id))) }));
router.post(`${V}/maps/${ID}/keep`, requireManager, async (req, res) => res.json({ ok: true, ...(await keepFuture(req, slugOf(req), Number(req.params.id))) }));
router.post(`${V}/plant/${ID}/status`, requireManager, small, async (req, res) => res.json({ ok: true, ...(await plantStatus(req, slugOf(req), Number(req.params.id), String((req.body || {}).status || ""))) }));
router.post(`${V}/plant/${ID}/new-tool`, requireManager, async (req, res) => res.json({ ok: true, ...(await plantToTool(req, slugOf(req), Number(req.params.id))) }));

module.exports = { init, SCHEMA, router, prefillFromBox, cardsFor, boxesFor, fileFrom, fileBurst, setBurst, fileFromBox, plantStatus, plantToTool, contextFor, promptFor, fakeFuture, checkFuture, drawFuture, startFuture, draftFuture, keepFuture, futureInfo, FUTURE_SCHEMA, SYSTEM, MAX_BURSTS };
