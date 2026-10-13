// The admin MCP's write tools: a new tool request started and filled in by Anetix's own connected AI app (2026-10-06,
// docs/MCP.md "Write tools"). Brendan: "add much more write capability to the MCP so that we can write in a tooling
// request automatically from a call transcript or tour transcript ... instead of going to handjam it all."
//
// What it is for. After a call or a walk of a plant, Brendan has the answers to the new-tool questions in a chat.
// The app reads the questions (get_tool_request), writes the answers (answer_tool_request), sends them to the agent
// (send_tool_request), answers the agent's follow-up round the same way, and reads the design that comes back. The
// company's manager then opens the board, reads the points and confirms: that step is not here, on purpose.
//
// Rules this file keeps:
//   - It writes through src/intake.js, the same functions the board's own routes call. Nothing here touches a table
//     of the loop directly, so every rule the intake has (one unfinished request at a time, the name is free, credit,
//     fair use, the record) holds for an app exactly as for a person.
//   - Nothing here moves anything toward the floor. Confirm (which starts the build) and Make it live stay on the
//     board, with the manager's PIN. Withdraw stays there too: an app cannot throw a request away.
//   - An app writes only to a request Anetix started through a connector (module_intakes.via = 'anetix'). A request
//     the company's manager started is the manager's: it is read here for a trial (the same words get_demo carries)
//     and taken over only when the person at the app says so (start_tool_request use_open). A paying site that did
//     not opt in to learning keeps its own requests to itself: neither read nor taken over here.
//   - An answer is checked against its question's shape before it is saved (the board's page is trusted to send the
//     right shape; an AI app is not): option ids, group ids, lengths, counts. One bad answer does not lose the rest.
//   - Sending to the agent and asking for a design change spend AI. Each is counted per account per hour
//     (SOS_MCP_AI_STARTS_PER_HOUR, 30), so an app in a loop stops.
//   - Files (a photo of the whiteboard, the starting spreadsheet) are added on the board. Not here.
//   - Every write is on the record under the account's own name, marked as Anetix through the app.
const { z } = require("zod");
const { q } = require("./db");
const Q = require("./intake-questions");

const say = (message) => Object.assign(new Error(message), { say: true });
const SLUG = /^[a-z0-9][a-z0-9-]{1,40}$/;
const VIA = "anetix";
const AI_STARTS = ["send_tool_request", "change_tool_request_design"];
const PER_HOUR = (() => { const n = Number(process.env.SOS_MCP_AI_STARTS_PER_HOUR); return Number.isFinite(n) && n >= 0 ? n : 30; })();
const clip = (v, n) => String(v == null ? "" : v).replace(/\u0000/g, "").trim().slice(0, n);
const isObj = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);

// ---- pure: one answer, brought to its question's shape -----------------------------------------------------------
// find an option by its id or by the words on it, whatever the capitals
function optionOf(options, v) {
  const want = String(v == null ? "" : v).trim().toLowerCase();
  if (!want) return null;
  return (options || []).find((o) => String(o.id).toLowerCase() === want) || (options || []).find((o) => String(o.label).trim().toLowerCase() === want) || null;
}
const idList = (options) => (options || []).map((o) => `${o.id} (${o.label})`).join(", ");
// how many items a list question takes, and how long each may be. The fixed questions keep the count in `max`; a
// question the agent wrote keeps it in maxItems and uses `max` for the length of typed text.
const listLimits = (qn) => ({ count: qn.maxItems || (qn.max && qn.max <= 50 ? qn.max : 10), each: qn.item_max || 500 });

// -> the value to save. Throws say(...) with what the question takes when the value cannot be made to fit.
// ctx.who: the "who" answer as it stands (the groups a devices answer may name).
function normalize(qn, value, ctx = {}) {
  if (value == null) throw say(`${qn.id}: no answer was given. Leave a question out to leave it as it is.`);
  switch (qn.kind) {
    case "text": {
      if (typeof value !== "string" && typeof value !== "number") throw say(`${qn.id} takes plain text.`);
      const text = clip(value, qn.max || 6000);
      if (!text) throw say(`${qn.id}: the text was empty.`);
      return qn.multiline === false ? text.replace(/\s*\n+\s*/g, " ") : text;
    }
    case "choice": {
      let raw = value;
      if (typeof raw === "string") raw = { picks: [raw] };
      if (Array.isArray(raw)) raw = { picks: raw };
      if (!isObj(raw)) throw say(`${qn.id} takes { picks: [option ids], other: "free text" }.`);
      const picks = [], extra = [];
      for (const p of [].concat(raw.picks == null ? [] : raw.picks).slice(0, 20)) {
        const o = optionOf(qn.options, p);
        if (o) { if (!picks.includes(o.id)) picks.push(o.id); } else if (clip(p, 300)) extra.push(clip(p, 300));
      }
      const other = [clip(raw.other, 1500), ...extra].filter(Boolean).join("; ").slice(0, 1500);
      if (other && qn.other === false) throw say(`${qn.id}: "${(extra[0] || other).slice(0, 80)}" is not one of its choices. They are: ${idList(qn.options)}.`);
      if (!qn.multi && picks.length > 1) throw say(`${qn.id} takes one pick, not ${picks.length}. Put anything more in "other".`);
      if (!picks.length && !other) throw say(`${qn.id}: nothing was picked. Its choices are: ${idList(qn.options)}${qn.other === false ? "" : ', or free text in "other"'}.`);
      const out = { picks };
      if (other) out.other = other;
      if (qn.names_for && isObj(raw.names)) {
        const names = {};
        for (const [k, v] of Object.entries(raw.names).slice(0, 20)) { const o = optionOf(qn.options, k); if (o && qn.names_for.includes(o.id) && picks.includes(o.id) && clip(v, 80)) names[o.id] = clip(v, 80); }
        if (Object.keys(names).length) out.names = names;
      }
      if (qn.note && clip(raw.note, 2000)) out.note = clip(raw.note, 2000);
      return out;
    }
    case "roles": {
      let raw = value;
      if (Array.isArray(raw)) raw = Object.fromEntries(raw.map((g) => [String(g), ""]));
      if (!isObj(raw) || !Object.keys(raw).length) throw say(`${qn.id} takes { group id: "rough headcount" } for each group that will use it. The groups: ${idList(qn.options)}.`);
      const out = {};
      for (const [k, n] of Object.entries(raw).slice(0, 20)) {
        const g = optionOf(qn.options, k);
        if (!g) throw say(`${qn.id}: "${String(k).slice(0, 60)}" is not one of its groups. They are: ${idList(qn.options)}.`);
        out[g.id] = clip(n, 40);
      }
      return out;
    }
    case "devices": {
      const groups = Object.keys(ctx.who || {});
      if (!groups.length) throw say(`${qn.id} needs the "who" answer first: it takes the devices of each group named there.`);
      if (!isObj(value)) throw say(`${qn.id} takes { group id: [device ids] } for each group in the "who" answer (${groups.join(", ")}). The devices: ${idList(qn.options)}.`);
      const out = {};
      for (const [k, ds] of Object.entries(value).slice(0, 20)) {
        const g = optionOf(Q.GROUPS, k);
        if (!g || !groups.includes(g.id)) throw say(`${qn.id}: "${String(k).slice(0, 60)}" is not a group in the "who" answer (${groups.join(", ")}).`);
        const list = [];
        for (const d of [].concat(ds == null ? [] : ds).slice(0, 10)) {
          const o = optionOf(qn.options, d);
          if (!o) throw say(`${qn.id}: "${String(d).slice(0, 60)}" is not one of its devices. They are: ${idList(qn.options)}.`);
          if (!list.includes(o.id)) list.push(o.id);
        }
        if (list.length) out[g.id] = list;
      }
      if (!Object.keys(out).length) throw say(`${qn.id}: no device was given for any group.`);
      return out;
    }
    case "order":
    case "items": {
      const lim = listLimits(qn);
      const raw = typeof value === "string" ? value.split(/\r?\n/) : value;
      if (!Array.isArray(raw)) throw say(`${qn.id} takes a list of short lines${qn.kind === "order" ? ", in order" : ""}.`);
      const list = raw.map((s) => (typeof s === "string" || typeof s === "number" ? clip(s, lim.each).replace(/^\s*(?:\d+[.)]|[-*•])\s+/, "") : "")).filter(Boolean);
      if (!list.length) throw say(`${qn.id}: the list was empty.`);
      if (list.length > lim.count) throw say(`${qn.id} takes at most ${lim.count} lines; ${list.length} were given. Keep the ones that matter most.`);
      return list;
    }
    case "attach": {
      const note = clip(isObj(value) ? value.note : value, 2000);
      if (!note) throw say(`${qn.id} takes { note: "a line about the file" }. The file itself is added on the board.`);
      return { note };
    }
    default: throw say(`${qn.id} cannot be answered here.`);
  }
}
// What a question takes, in words an AI app can act on.
function takes(qn) {
  switch (qn.kind) {
    case "text": return `Plain text, up to ${qn.max || 6000} characters${qn.multiline === false ? ", one line" : ""}.`;
    case "choice": return `{ picks: [option ids]${qn.other === false ? "" : ', other: "anything the options miss, in their words"'}${qn.names_for ? `, names: { option id: "what they call it" } for ${qn.names_for.join(", ")}` : ""}${qn.note ? ', note: "in their words"' : ""} }. ${qn.multi ? "Several picks may apply." : "One pick."}`;
    case "roles": return '{ group id: "rough headcount" } for each group that will use it; "" when the headcount is not known.';
    case "devices": return '{ group id: [device ids] } for each group named in the "who" answer.';
    case "order": { const l = listLimits(qn); return `A list of short lines in order, ${qn.min || 1} to ${l.count}.`; }
    case "items": { const l = listLimits(qn); return `A list of short lines, ${qn.min || 1} to ${l.count}.`; }
    case "attach": return '{ note: "a line about the file" }. The file itself is added on the board, not here.';
    default: return "";
  }
}
// The order answers are applied in: the question order, so the name comes first and "who" before "devices".
function inOrder(questions, answers) {
  const ids = questions.map((qn) => qn.id), keys = Object.keys(answers || {});
  return { known: ids.filter((id) => keys.includes(id)), unknown: keys.filter((k) => !ids.includes(k)) };
}
const STATUS_WORDS = {
  answering: "questions are open", thinking: "the agent is working", design: "the design is ready for the manager to read and confirm", confirmed: "confirmed, the build has not started",
  building: "being built", done: "built", abandoned: "withdrawn", failed: "the agent's turn failed; sending again retries it", paused: "paused",
};
function nextStep(v, boardUrl) {
  const where = boardUrl ? ` (${boardUrl})` : "";
  switch (v.status) {
    case "failed":
    case "answering":
      if (v.missing.length) return `Answer what is missing with answer_tool_request: ${v.missing.join(", ")}. Leave out anything the conversation did not settle and tell the person what is missing; do not make an answer up.`;
      return v.round > 1 ? "This round is answered. send_tool_request sends it to the agent." : "Every needed question is answered. Read the answers back to the person, then send_tool_request sends them to the agent. A photo of the whiteboard or the starting spreadsheet is added on the board first, if there is one.";
    case "thinking": return "The agent is working, a minute or two. Ask again with get_tool_request.";
    case "design": return `Read the points to the person. change_tool_request_design changes them through the agent. The company's manager reads and confirms on the board${where}, which starts the build; that step is not available here.`;
    case "confirmed": case "building": return `The rest happens on the board${where}.`;
    case "done": return "Built. list_runs shows the build.";
    default: return "Nothing to do here.";
  }
}
// One request as an app reads it. v: intake.view(). full: false keeps a paying site's own words out.
function requestOut(v, { boardUrl = null, full = true } = {}) {
  const head = {
    id: v.id, company: v.company, status: v.status, status_means: STATUS_WORDS[v.status] || v.status, started: v.via === VIA ? "by Anetix, through a connected app" : "on the board, by the company",
    writable_here: v.via === VIA, name: v.name || null, tool_address: v.slug || null, board: boardUrl, created_at: v.created_at, updated_at: v.updated_at,
  };
  if (!full) return { ...head, name: null, tool_address: null, note: "This is a paying site's own request. Its answers and its design are not read here." };
  const design = v.design ? {
    summary: v.design.bluf, points: (v.design.items || []).map((p) => ({ id: p.id, kind: p.kind, summary: p.summary, ...(p.mark ? { mark: p.mark } : {}) })), reference: v.design.reference_md,
    screens: v.design.screens || [], connections: v.design.connections || [], handed_to_the_integration_team: v.design.handoffs || [], starting_data: v.design.starting_data || "none", leaves_out: v.design.leaves_out || [],
    wording_flags: v.design.flags || [], estimate_usd: v.design.estimate_usd == null ? null : v.design.estimate_usd, change_in_progress: Boolean(v.design.revising),
  } : null;
  return {
    ...head, round: v.round, round_of: 3, why_these_questions: v.round_why || null, missing: v.missing,
    questions: v.questions.map((qn) => ({
      id: qn.id, round: qn.round, needed: Boolean(qn.required), text: qn.text, hint: qn.hint || null, kind: qn.kind, takes: takes(qn),
      ...((qn.options || []).length ? { options: qn.options.map((o) => ({ id: o.id, label: o.label })) } : {}),
      answered: Q.answered(qn, v.answers[qn.id]), answer: v.answers[qn.id] === undefined ? null : v.answers[qn.id],
    })),
    files_on_the_board: (v.attachments || []).map((a) => ({ question: a.question_id, name: a.filename })),
    design, ai_cost_usd: Math.round(Number(v.cost_usd || 0) * 100) / 100, problem: v.error || null, next: nextStep(v, boardUrl),
  };
}

// ---- with the database ----------------------------------------------------------------------------------------------
const slugArg = (v) => { const s = String(v || "").trim().toLowerCase(); if (!SLUG.test(s)) throw say("That is not a company's short name. list_companies gives each company's slug."); return s; };
async function companyOf(slug) {
  const c = (await q("SELECT slug, name FROM platform.companies WHERE slug=$1", [slug])).rows[0];
  if (!c) throw say("No company by that slug. list_companies names them.");
  return c;
}
// A paying site that did not opt in to learning: what its people wrote is the plant's own (the rule src/demos.js keeps).
async function plantsOwn(company) {
  const r = (await q("SELECT stage, learning_opt_in FROM platform.sites WHERE company=$1", [company]).catch(() => ({ rows: [] }))).rows[0];
  return Boolean(r && r.stage === "subscribed" && !r.learning_opt_in);
}
const boardOf = (company) => { const base = require("./mcpauth").PUBLIC; return base ? `${base}/c/${company}/` : null; };
// Who is writing, for the record: the account's own name, said to be Anetix through the app.
const byOf = (who) => ({ role: "admin", name: `${(who.account && (who.account.name || who.account.login)) || "Anetix"} (Anetix, through ${who.app || "a connected app"})`.slice(0, 120) });
// The intake's own errors are written for a person; a database error is not, and stays in the log.
const words = async (fn) => { try { return await fn(); } catch (e) { if (e.say || e.severity || e.routine || e instanceof TypeError || e instanceof ReferenceError) throw e; throw say(String(e.message || "that did not work").replace(/^./, (c) => c.toUpperCase())); } };
async function load(id) {
  const intake = require("./intake");
  const it = await intake.getIntake(Number(id));
  if (!it) throw say("No new tool request by that id. list_tool_requests names them.");
  return it;
}
// A request an app may write to: one Anetix started through a connector.
async function mine(id) {
  const it = await load(id);
  if (it.via !== VIA) throw say(`Request ${it.id} was started on the board by the company, so it is not written to from here. Nothing was changed. start_tool_request with use_open takes over a trial's unfinished request, when the person asks for that.`);
  return it;
}
async function shown(it) {
  const intake = require("./intake");
  const full = it.via === VIA || !(await plantsOwn(it.company));
  return requestOut(await intake.view(it), { boardUrl: boardOf(it.company), full });
}
async function pace(who) {
  if (!PER_HOUR) return;
  const n = (await q("SELECT count(*)::int AS n FROM platform.mcp_calls WHERE account_id=$1 AND ok AND tool = ANY($2) AND at > now() - interval '1 hour'", [(who.account && who.account.id) || 0, AI_STARTS])).rows[0].n;
  if (n >= PER_HOUR) throw say(`This account has sent ${n} things to the agent through a connected app in the last hour, which is the limit (${PER_HOUR}). Nothing was sent. Try again later, or do it on the board.`);
}

// ---- the tools --------------------------------------------------------------------------------------------------------
const idArg = z.number().int().min(1).max(999999999).describe("The request's id, from start_tool_request or list_tool_requests");
const tools = [
  {
    name: "list_tool_requests", title: "New tool requests",
    description: "New tool requests (the question set a company answers to get a new tool designed and built): which company, the tool's name, how far it got, and whether Anetix started it through a connected app or the company started it on the board. For one company or all. Newest first.",
    input: { company: z.string().optional().describe("A company's slug; leave out for every company"), open_only: z.boolean().optional().describe("Only the unfinished ones. Default true.") },
    async run({ company, open_only }) {
      const slug = company ? slugArg(company) : null;
      const rows = (await q(`SELECT i.id, i.company, i.name, i.slug, i.status, i.via, i.created_at, i.updated_at, i.design->>'bluf' AS bluf FROM platform.module_intakes i
                              WHERE ($1::text IS NULL OR i.company=$1) AND ($2::boolean IS FALSE OR i.status IN ('answering','failed','thinking','design','confirmed','building')) ORDER BY i.id DESC LIMIT 200`, [slug, open_only !== false])).rows;
      const own = new Map();
      const out = [];
      for (const r of rows) {
        if (!own.has(r.company)) own.set(r.company, await plantsOwn(r.company));
        const hidden = r.via !== VIA && own.get(r.company);
        out.push({ id: r.id, company: r.company, name: hidden ? null : r.name, tool_address: hidden ? null : r.slug, status: r.status, status_means: STATUS_WORDS[r.status] || r.status,
          started: r.via === VIA ? "by Anetix, through a connected app" : "on the board, by the company", writable_here: r.via === VIA, design_summary: hidden ? null : r.bluf, created_at: r.created_at, updated_at: r.updated_at });
      }
      return { requests: out };
    },
  },
  {
    name: "get_tool_request", title: "One new tool request",
    description: "One new tool request in full: every question with what kind of answer it takes and its choices, the answers so far, what is still missing, the agent's follow-up questions once it has asked them, the design once it is written, and what to do next. Read this before answering, and again after sending to see what the agent came back with. A paying site's own request shows only how far it got.",
    input: { id: idArg },
    async run({ id }) { return shown(await load(id)); },
  },
  {
    name: "start_tool_request", title: "Start a new tool request", readOnly: false,
    description: "Start a new tool request for a company, as Anetix, to fill in from a call or a plant walk. Returns the questions. A company has one unfinished request at a time: if Anetix already started one, that one is returned to carry on with; if the company's manager started one, this refuses and says so. The board shows the request as started by Anetix. Nothing is sent to the agent and nothing is built by this.",
    input: {
      company: z.string().describe("The company's slug, from list_companies"),
      use_open: z.boolean().optional().describe("Take over an unfinished request the company's manager started on the board (a trial only). Its answers can then be overwritten. Only when the person asks for that. Default false."),
    },
    async run({ company, use_open }, who) {
      const intake = require("./intake");
      const co = await companyOf(slugArg(company));
      const open = await intake.openFor(co.slug);
      if (open && open.via !== VIA) {
        if (await plantsOwn(co.slug)) throw say(`${co.name} has an unfinished new tool request its own people started on the board (request ${open.id}), and a company has one at a time. It is a paying site's own request, so it is not taken over from here. Nothing was changed. It is finished or withdrawn on the board.`);
        if (use_open !== true) {
          const v = await intake.view(open);
          throw say(`${co.name} has an unfinished new tool request its manager started on the board (request ${open.id}${v.name ? `, "${v.name}"` : ""}: ${STATUS_WORDS[open.status] || open.status}, ${v.round_answered} of ${v.round_total} answered in round ${v.round}), and a company has one at a time. Nothing was changed. Ask the person: start_tool_request with use_open true takes that one over, or the manager finishes or withdraws it on the board.`);
        }
        await q("UPDATE platform.module_intakes SET via=$2, updated_at=now() WHERE id=$1", [open.id, VIA]);
        await require("./record").record("intake_taken_over", { company: co.slug, module: open.slug || null, actor: byOf(who), intake_id: open.id, feedback_id: open.feedback_id, detail: { status: open.status } });
        return { took_over: true, request: await shown(await load(open.id)) };
      }
      const it = await words(() => intake.create(co.slug, "admin", { name: "Anetix", via: VIA }));
      return { carried_on: Boolean(it.reopened), request: await shown(await load(it.id)) };
    },
  },
  {
    name: "answer_tool_request", title: "Answer a new tool request", readOnly: false,
    description: "Write answers into a new tool request Anetix started: any of its questions, in one call, by question id. Each answer is checked against what its question takes (get_tool_request says what that is) and saved on its own, so one that does not fit is reported back and the rest are kept. Answering again replaces the earlier answer. Use the company's own words and names from the conversation. Leave out a question the conversation did not settle, and tell the person which ones are left: never make an answer up. Nothing is sent to the agent by this.",
    input: {
      id: idArg,
      answers: z.record(z.string().max(40), z.any()).describe('Question id -> answer, in the shape that question takes. For example { "name": "Rework board", "stages": ["Found", "At the bench", "Fixed", "Back on the line"], "who": { "floor": "12", "leads": "2" }, "devices": { "floor": ["tablet"], "leads": ["phone"] }, "today": { "picks": ["whiteboard"], "other": "a notebook at the bench" } }'),
    },
    async run({ id, answers }, who) {
      const intake = require("./intake");
      let it = await mine(id);
      if (!["answering", "failed"].includes(it.status)) throw say(`Request ${it.id} is not taking answers: ${STATUS_WORDS[it.status] || it.status}. Nothing was changed.`);
      if (!isObj(answers) || !Object.keys(answers).length) throw say("No answers were given.");
      if (Object.keys(answers).length > 40) throw say("That is more answers than a request has questions. Nothing was changed.");
      const questions = await intake.questionsFor(it);
      const { known, unknown } = inOrder(questions, answers);
      const by = byOf(who), saved = [], refused = unknown.map((k) => ({ question: String(k).slice(0, 40), why: "This request has no question by that id. get_tool_request lists them." }));
      for (const qid of known) {
        const qn = questions.find((x) => x.id === qid);
        try {
          const value = normalize(qn, answers[qid], { who: (it.answers || {}).who });
          it = await words(() => intake.answer(it.id, qid, value, by));
          saved.push(qid);
        } catch (e) {
          if (!e.say) throw e;
          refused.push({ question: qid, why: e.message });
        }
      }
      return { saved, not_saved: refused, request: await shown(await load(it.id)) };
    },
  },
  {
    name: "send_tool_request", title: "Send the answers to the agent", readOnly: false,
    description: "Send the open round of a new tool request Anetix started to the agent. The agent then either asks a short follow-up round (answer it the same way and send again; at most two follow-up rounds) or writes the design. It takes a minute or two: read the result with get_tool_request. This spends the company's AI credit like the same button on the board. Refused while a needed answer is missing. It does not confirm the design and does not build anything: the company's manager does that on the board.",
    input: { id: idArg },
    async run({ id }, who) {
      const intake = require("./intake");
      const it = await mine(id);
      await pace(who);
      try { await intake.next(it.id); }
      catch (e) {
        if (e.missing) throw say(`Not sent: ${e.missing.length === 1 ? "one needed answer is" : `${e.missing.length} needed answers are`} still missing (${e.missing.map((m) => m.id).join(", ")}). Nothing was changed.`);
        await words(() => { throw e; });
      }
      await require("./record").record("intake_sent", { company: it.company, module: it.slug || null, actor: byOf(who), intake_id: it.id, feedback_id: it.feedback_id, detail: { round: (it.rounds || []).length + 1 } });
      return { sent: true, request: await shown(await load(it.id)) };
    },
  },
  {
    name: "change_tool_request_design", title: "Change the design through the agent", readOnly: false,
    description: "Ask the agent to change the design of a new tool request Anetix started, once the design is written: name a point by its id (p1, p2, ...) and say what should be different, or leave the point out to add something new. The agent re-issues the design and every point nobody named stays word for word. It takes a minute: read the result with get_tool_request. This spends AI like the same step on the board. It does not confirm the design.",
    input: {
      id: idArg,
      changes: z.array(z.object({ point: z.string().max(12).optional().describe("The id of the point to change (p1, p2, ...). Leave out to add a new point."), text: z.string().min(1).max(2000).describe("What should be different, or what to add, in plain words") })).min(1).max(12),
    },
    async run({ id, changes }, who) {
      const intake = require("./intake");
      const it = await mine(id);
      if (it.status !== "design" || !it.design) throw say(`Request ${it.id} has no design to change right now: ${STATUS_WORDS[it.status] || it.status}. Nothing was changed.`);
      const ids = new Set(intake.withIds(it.design.items || []).map((p) => p.id));
      const lost = changes.filter((c) => c.point && !ids.has(String(c.point)));
      if (lost.length) throw say(`The design has no point ${lost.map((c) => c.point).join(", ")}. Its points are ${[...ids].join(", ")}. Nothing was changed.`);
      await pace(who);
      await words(() => intake.revise(it.id, changes, byOf(who)));
      return { asked: changes.length, request: await shown(await load(it.id)) };
    },
  },
];

module.exports = { tools, normalize, takes, inOrder, requestOut, nextStep, optionOf, listLimits, byOf, plantsOwn, VIA, AI_STARTS, PER_HOUR, STATUS_WORDS };
