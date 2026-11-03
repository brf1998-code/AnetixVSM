// Module creation intake (docs/MODULE-CREATION.md). A manager answers the
// fixed questions, the agent asks up to two more rounds of its own, then writes
// the design summary the manager confirms. Everything here is platform code;
// the in-app build agent never touches it. Confirm hands the design to
// src/modulebuild.js, which builds the first version through the same gates
// as any change.
//
// Statuses: answering (a round is open) -> thinking (the agent is working) ->
// answering (a new round) or design (summary ready) -> confirmed -> building
// -> done. Also abandoned, and failed (a model call died; the card offers
// Try again).
const express = require("express");
const { q, logEvent } = require("./db");
const agent = require("./agent");
const registry = require("./registry");
const attachments = require("./attachments");
const plain = require("./plainwords");
const Q = require("./intake-questions");
const { requireManager } = require("./auth");
const freshPin = require("./people").requireFreshPin;   // an approval with a stale PIN asks for the PIN again

// The intake runs on the design job's model (src/agent.js): the baseline unless /admin#models gives design its
// own, or the intake's arm of the live A/B. Chosen once at create and kept on the row, so one intake is one model.
const intakeModel = async (it) => (it && agent.inTier(it.model) ? it.model : agent.modelFor(it && it.company, "design"));
const MAX_GENERATED_ROUNDS = 2;           // round 1 is fixed; hard cap three rounds in all
const MAX_QUESTIONS_PER_ROUND = 6;
const RESERVED = new Set(["platform", "admin", "staging", "test", "new", "api", "assets", "login", "logout", "health"]);

// ---- helpers ------------------------------------------------------------------
async function getIntake(id) { return (await q("SELECT * FROM platform.module_intakes WHERE id=$1", [id])).rows[0]; }
async function setIntake(id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return getIntake(id);
  const sets = keys.map((k, i) => `${k}=$${i + 2}`).join(", ");
  const vals = keys.map((k) => (["answers", "rounds", "design"].includes(k) && fields[k] != null ? JSON.stringify(fields[k]) : fields[k]));
  return (await q(`UPDATE platform.module_intakes SET ${sets}, updated_at=now() WHERE id=$1 RETURNING *`, [id, ...vals])).rows[0];
}
async function setFeedback(intake, fields) {
  if (!intake.feedback_id) return;
  const keys = Object.keys(fields);
  const sets = keys.map((k, i) => `${k}=$${i + 2}`).join(", ");
  await q(`UPDATE platform.feedback SET ${sets}, updated_at=now() WHERE id=$1`, [intake.feedback_id, ...keys.map((k) => fields[k])]);
}
async function companyModules(company) {
  return (await q("SELECT name, title FROM platform.modules WHERE company=$1 AND live_version IS NOT NULL ORDER BY name", [company])).rows;
}
function slugify(name) {
  const s = String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30).replace(/-+$/g, "");
  return /^[a-z0-9]/.test(s) ? s : "";
}
// A name is taken when its slug or its title matches a module of the company
// (the library module "paperline" is titled "Paper Airplane Line": both
// count) or another live intake.
async function slugTaken(company, slug, exceptIntake, name) {
  if (RESERVED.has(slug)) return true;
  const title = String(name || "").trim().toLowerCase();
  if ((await q("SELECT 1 FROM platform.modules WHERE company=$1 AND (name=$2 OR lower(title)=$3)", [company, slug, title || slug])).rowCount) return true;
  if ((await q("SELECT 1 FROM platform.module_intakes WHERE company=$1 AND (slug=$2 OR lower(name)=$3) AND status <> 'abandoned' AND id <> $4", [company, slug, title || slug, exceptIntake || 0])).rowCount) return true;
  return false;
}

// All questions of an intake in order: the fixed ones for this company, then
// every generated round's, each tagged with its round number.
async function questionsFor(intake) {
  const mods = await companyModules(intake.company);
  const fixed = Q.fixedFor(mods).map((qn) => ({ ...qn, round: 1 }));
  const gen = [];
  for (const r of intake.rounds || []) for (const qn of r.questions || []) gen.push({ ...qn, round: r.round });
  return fixed.concat(gen);
}
// The round the person is answering now, and whether it is complete.
function roundState(questions, answers) {
  const rounds = [...new Set(questions.map((qn) => qn.round))].sort((a, b) => a - b);
  for (const r of rounds) {
    const qs = questions.filter((qn) => qn.round === r);
    const missing = qs.filter((qn) => qn.required && !Q.answered(qn, answers[qn.id]));
    const answered = qs.filter((qn) => Q.answered(qn, answers[qn.id])).length;
    if (missing.length || r === rounds[rounds.length - 1]) return { round: r, questions: qs, missing, answered, total: qs.length, done: !missing.length };
  }
  return { round: 1, questions: [], missing: [], answered: 0, total: 0, done: true };
}

// The public view of an intake (no file bytes), for the popout and the card.
async function view(intake) {
  const questions = await questionsFor(intake);
  const files = await attachments.list(intake.id);
  const state = roundState(questions, intake.answers || {});
  const roundsDone = (intake.rounds || []).length;
  const lastRound = (intake.rounds || [])[roundsDone - 1];
  return {
    id: intake.id, company: intake.company, feedback_id: intake.feedback_id, status: intake.status, name: intake.name, slug: intake.slug,
    via: intake.via || null, answers: intake.answers || {}, questions, attachments: files, design: intake.design ? { ...intake.design, items: withIds(intake.design.items || []) } : null, model: intake.model || null,
    cost_usd: Number(intake.cost_usd || 0), error: intake.error || null,
    round: state.round, round_answered: state.answered, round_total: state.total, round_done: state.done, missing: state.missing.map((m) => m.id),
    round_why: ((intake.rounds || []).find((r) => r.round === state.round) || {}).why || "",
    rounds_generated: roundsDone, enough: Boolean(lastRound && lastRound.enough), can_ask_more: roundsDone < MAX_GENERATED_ROUNDS && !(lastRound && lastRound.enough),
    created_at: intake.created_at, updated_at: intake.updated_at,
  };
}

// ---- lifecycle ------------------------------------------------------------------
// The company's unfinished new-tool request, if it has one: still being answered, thought about or waiting at its design.
async function openFor(company) {
  return (await q(`SELECT i.* FROM platform.module_intakes i JOIN platform.feedback f ON f.id=i.feedback_id
    WHERE i.company=$1 AND i.status IN ('answering','failed','thinking','design') AND f.status NOT IN ('declined','done') ORDER BY i.id DESC LIMIT 1`, [company])).rows[0] || null;
}
// opts (2026-10-06, the admin connector's write tools, src/mcp-intake.js): name = who the board says started it
// (default: the role), via = 'anetix' when Anetix started it through a connected app.
// A draft nobody has put anything in yet: still on its first questions, nothing answered, not named. opts.via keeps
// Anetix's drafts (a connected app) and the plant's apart.
async function blankFor(company, via = null) {
  return (await q(`SELECT i.* FROM platform.module_intakes i JOIN platform.feedback f ON f.id=i.feedback_id
    WHERE i.company=$1 AND i.status='answering' AND i.answers='{}'::jsonb AND i.rounds='[]'::jsonb AND i.name IS NULL
      AND i.via IS NOT DISTINCT FROM $2 AND f.status NOT IN ('declined','done') ORDER BY i.id DESC LIMIT 1`, [company, via])).rows[0] || null;
}
async function create(company, role, opts = {}) {
  // Several drafts at once since 2026-10-29 (Taylor's #288: "the ability to work on multiple new tool drafts at the same
  // time"): each is its own card on the board, opened from there. What the launch audit 1.5 (2026-09-27) guarded
  // against stays guarded: each tap on "New tool" used to start another empty request, so a tap while a draft is still
  // blank (nothing answered, not named) opens that blank one again instead of making a second empty card.
  const open = await blankFor(company, opts.via || null);
  // starting a module needs credit (asked on a reopen too, so New tool says so the same way); once started, its rounds,
  // design and build go through to the end (the generateRound / generateDesign gates pass started: true)
  await require("./selfserve").assertCredit(company);
  if (open) return Object.assign(open, { reopened: true });
  const fb = (await q(
    `INSERT INTO platform.feedback (company, module, page, screen, message, name, status, kind) VALUES ($1,NULL,$2,'New tool request','New tool',$3,'new','module_request') RETURNING id`,
    [company, `/c/${company}/`, String(opts.name || role || "manager").slice(0, 80)])).rows[0];
  const pick = await agent.pickModel(company, "design", null);
  const it = (await q(
    `INSERT INTO platform.module_intakes (company, feedback_id, started_by, model, via) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [company, fb.id, role || "manager", pick.model, opts.via || null])).rows[0];
  if (pick.arm) await agent.keepArm("design", company, `intake:${it.id}`, pick.model);
  await q("UPDATE platform.feedback SET intake_id=$2 WHERE id=$1", [fb.id, it.id]);
  await logEvent("intake_started", it.id, { company, role, ...(opts.via ? { via: opts.via } : {}) });
  return it;
}

const { record, actor } = require("./record");

// by: who is answering, for the record (default: the manager). The admin connector passes Anetix's named account.
async function answer(id, qid, value, by) {
  const it = await getIntake(id);
  if (!it) throw new Error("intake not found");
  if (!["answering", "failed"].includes(it.status)) throw new Error(`answers are closed while the intake is ${it.status}`);
  const questions = await questionsFor(it);
  const qn = questions.find((x) => x.id === qid);
  if (!qn) throw new Error("unknown question");
  const answers = { ...(it.answers || {}) };
  const fields = {};
  if (qid === "name") {
    const name = String(value || "").trim().slice(0, 80);
    const slug = slugify(name) || (name ? `module-${it.id}` : "");
    if (slug && (await slugTaken(it.company, slug, it.id, name))) throw new Error(`"${name}" is already the name of a tool here. Pick another.`);
    // its tables may not land on another company's (the launch audit 2.14): the address steps to -2 when they would
    const free = slug ? await require("./migrate").freeToolSlug(it.company, slug, (s) => slugTaken(it.company, s, it.id, null)) : "";
    fields.name = name || null; fields.slug = free || null;
    answers.name = name;
    await setFeedback(it, { message: name ? `New tool: ${name}` : "New tool", module: free || null });
  } else {
    answers[qid] = value;
  }
  fields.answers = answers;
  if (it.status === "failed") { fields.status = "answering"; fields.error = null; }
  const before = (it.answers || {})[qid];
  if (JSON.stringify(before) !== JSON.stringify(qid === "name" ? answers.name : value))
    await record("intake_answered", { company: it.company, module: it.slug || null, actor: by || "manager", intake_id: id, feedback_id: it.feedback_id, before: before == null ? null : (typeof before === "string" ? before : JSON.stringify(before)), after: typeof value === "string" ? value : JSON.stringify(value), detail: { question: qid, text: qn.text } });
  return setIntake(id, fields);
}

// The person finished the open round: check it, then let the agent think.
async function next(id) {
  const it = await getIntake(id);
  if (!it) throw new Error("intake not found");
  if (!["answering", "failed"].includes(it.status)) throw new Error(`nothing to send while the intake is ${it.status}`);
  const questions = await questionsFor(it);
  const state = roundState(questions, it.answers || {});
  if (!state.done) { const e = new Error("a few answers are still missing"); e.missing = state.missing.map((m) => ({ id: m.id, text: m.text })); throw e; }
  if (!it.name) throw new Error("the tool needs a name first");
  await setIntake(id, { status: "thinking", error: null });
  await setFeedback(it, { status: "reviewing" });
  think(id).catch(async (e) => {
    console.error(`intake ${id} think failed:`, e);
    await setIntake(id, { status: "failed", error: String(e.message || e).slice(0, 500) });
  });
  return getIntake(id);
}

// The agent's turn: another round of questions, or the design summary.
async function think(id) {
  let it = await getIntake(id);
  const generated = (it.rounds || []).length;
  const last = (it.rounds || [])[generated - 1];
  const askMore = generated < MAX_GENERATED_ROUNDS && !(last && last.enough);
  if (askMore) {
    const round = await generateRound(it);
    it = await getIntake(id);
    const rounds = [...(it.rounds || []), round];
    if (!round.enough && round.questions.length) {
      await setIntake(id, { rounds, status: "answering", cost_usd: Number(it.cost_usd || 0) + round.cost_usd });
      await setFeedback(it, { status: "new" });
      await logEvent("intake_round", id, { round: round.round, questions: round.questions.length, model: round.model, costUsd: round.cost_usd });
      await record("intake_round", { company: it.company, module: it.slug || null, actor: "agent", intake_id: id, feedback_id: it.feedback_id, after: JSON.stringify(round.questions), detail: { round: round.round, why: round.why || null, model: round.model, cost_usd: round.cost_usd } });
      return;
    }
    it = await setIntake(id, { rounds, cost_usd: Number(it.cost_usd || 0) + round.cost_usd });
  }
  const design = await generateDesign(it, null);
  it = await getIntake(id);
  await setIntake(id, { design, status: "design", cost_usd: Number(it.cost_usd || 0) + design.cost_usd });
  await setFeedback(it, { status: "reviewing" });
  await logEvent("intake_design", id, { model: design.model, costUsd: design.cost_usd, estimate: design.estimate_usd, screens: (design.screens || []).length });
  await record("intake_design", { company: it.company, module: it.slug || null, actor: "agent", intake_id: id, feedback_id: it.feedback_id, after: design.reference_md, detail: { bluf: design.bluf, items: design.items, estimate_usd: design.estimate_usd, model: design.model, cost_usd: design.cost_usd } });
}

// The manager edited the summary text: the agent re-issues the design against it.
async function adjust(id, text, by) {
  const it = await getIntake(id);
  if (!it || it.status !== "design") throw new Error("there is no design to adjust right now");
  await setIntake(id, { status: "thinking", error: null });
  (async () => {
    try {
      const prev = it.design || {};
      const design = await generateDesign(it, String(text || "").slice(0, 20000));
      design.adjustments = [...(prev.adjustments || []), { at: new Date().toISOString(), text: String(text || "").slice(0, 20000) }];
      const cur = await getIntake(id);
      await setIntake(id, { design, status: "design", cost_usd: Number(cur.cost_usd || 0) + design.cost_usd });
      await record("intake_adjusted", { company: it.company, module: it.slug || null, actor: by || "manager", intake_id: id, feedback_id: it.feedback_id, before: prev.reference_md || null, after: design.reference_md, detail: { asked: String(text || "").slice(0, 20000), model: design.model, cost_usd: design.cost_usd } });
    } catch (e) {
      console.error(`intake ${id} adjust failed:`, e);
      await setIntake(id, { status: "design", error: String(e.message || e).slice(0, 500) });
    }
  })();
  return getIntake(id);
}

async function confirm(id, by) {
  const it = await getIntake(id);
  if (!it || it.status !== "design" || !it.design) throw new Error("there is no design to confirm");
  if (await slugTaken(it.company, it.slug, it.id, it.name)) throw new Error(`a tool named "${it.name}" now exists; rename this one first`);
  let out = await setIntake(id, { status: "confirmed" });
  await setFeedback(it, { status: "reviewing" });
  await logEvent("intake_confirmed", id, { company: it.company, slug: it.slug, estimate: it.design.estimate_usd });
  await record("intake_confirmed", { company: it.company, module: it.slug || null, actor: by || "manager", intake_id: id, feedback_id: it.feedback_id, after: it.design.reference_md, detail: { estimate_usd: it.design.estimate_usd, adjustments: (it.design.adjustments || []).length } });
  // each outside system the design could not connect goes to Anetix's integration team now (src/requests.js)
  for (const h of (it.design.handoffs || []).filter((x) => x && x.system)) {
    await require("./requests").handoffNew({ company: it.company, module: it.slug, title: it.name, kind: h.kind, system: h.system, would_give: h.would_add, intake_id: id })
      .catch((e) => console.error(`[intake] ${id}: integration handoff for ${h.system} failed:`, e.message));
  }
  // confirmed means building: the first version goes straight to the agent,
  // then the same gates as any change (Brendan, 2026-09-17)
  try {
    await require("./modulebuild").startBuild(out);
    out = await getIntake(id);
  } catch (e) {
    console.error(`intake ${id} build start failed:`, e);
    out = await setIntake(id, { error: `the build could not start: ${String(e.message || e).slice(0, 300)}` });
  }
  return out;
}

async function restart(id) {
  const it = await getIntake(id);
  if (!it || ["confirmed", "building", "done"].includes(it.status)) throw new Error("this intake can no longer be restarted");
  await require("./selfserve").assertCredit(it.company);   // starting over is a new start
  const answers = {};
  for (const [k, v] of Object.entries(it.answers || {})) if (!/^r\d+q\d+$/.test(k)) answers[k] = v;   // keep the fixed answers, drop the generated rounds'
  const out = await setIntake(id, { rounds: [], design: null, answers, status: "answering", error: null });
  await setFeedback(it, { status: "new" });
  await logEvent("intake_restarted", id, {});
  return out;
}

async function abandon(id, by) {
  const it = await getIntake(id);
  if (!it) throw new Error("intake not found");
  if (["building", "done"].includes(it.status)) throw new Error("this tool is already being built");
  const out = await setIntake(id, { status: "abandoned" });
  await setFeedback(it, { status: "declined", outcome: "Tool request withdrawn." });
  await logEvent("intake_abandoned", id, {});
  await record("intake_abandoned", { company: it.company, module: it.slug || null, actor: by || "manager", intake_id: id, feedback_id: it.feedback_id, detail: { status_before: it.status } });
  return out;
}

// ---- The agent ------------------------------------------------------------------------
const CONNECTION_KINDS = "files (a spreadsheet or photo they upload), scanners (barcode or QR scanners in keyboard mode: nothing to connect), printer (a label printer, printed from the device on the plant network), erp (their ERP or scheduling system, read only, a short list of named lookups), web (the public web: look a company up, search, read a website; turned on for the tool by Anetix), spreadsheet (one they keep), machine (a machine or PLC: later, through a plant-side helper), scale, other";

function answersText(questions, answers, files) {
  return questions.map((qn) => {
    const att = files.filter((a) => a.question_id === qn.id);
    return `Q (round ${qn.round}, ${qn.id}): ${qn.text}\nA: ${Q.describe(qn, answers[qn.id], att)}`;
  }).join("\n\n");
}
async function contextFor(it) {
  const questions = await questionsFor(it);
  const files = await attachments.list(it.id);
  const mods = await companyModules(it.company);
  const guidance = await agent.guidanceFor(it.company, it.slug || "new-module");
  const allow = Q.systemNames(it.answers || {});
  const walled = await require("./datawall").isWalled(it.company);
  const blocks = await attachments.blocksFor(it.id, { walled });   // fake mode ignores them; the prompt log still sees the text parts
  return {
    questions, files, mods, allow, blocks, walled,
    system: `You are the agent inside a factory operating system (call yourself "the agent" if you ever need a name; never name the model or the company that makes it), helping a production manager design a new module (a small tracker with a few screens) by asking the right questions and then writing its design. The manager knows the operation and nothing about how software is made. Everything you write is read by that manager.${walled ? `\n\n${require("./datawall").PROMPT_NOTE}` : ""}\n\n${plain.rules()}\n\n${guidance.text}`,
    answersText: answersText(questions, it.answers || {}, files),
    modulesText: mods.length ? `Modules this company already has: ${mods.map((m) => `${m.title} (${m.name})`).join(", ")}.` : "This company has no other modules yet.",
  };
}
// The plain-words rewrite runs on the short text jobs' model (agent.summaryModel, Sonnet 5 by default).
async function rewriteWith(costBox) {
  const model = await agent.summaryModel();
  return async (text, instructions) => {
    const r = await agent.runChat({ model, system: instructions, messages: [{ role: "user", content: text }], maxTokens: 6000 });
    costBox.usd += r.costUsd || 0;
    return r.text;
  };
}

const ROUND_SCHEMA = {
  type: "object",
  properties: {
    enough: { type: "boolean", description: "true when the answers so far are enough to write a small first version; then ask nothing." },
    why: { type: "string", description: "One plain sentence for the manager: why you have enough, or what these questions settle." },
    questions: {
      type: "array", maxItems: MAX_QUESTIONS_PER_ROUND,
      items: {
        type: "object",
        properties: {
          text: { type: "string", description: "The question, one sentence, plain words, in the company's own names for its systems." },
          hint: { type: "string", description: "One line on why it matters for the design." },
          kind: { type: "string", enum: ["choice", "text", "order", "attach"], description: "choice = suggested answers to pick from (always allow something else); text = free text; order = an ordered list; attach = ask for a file such as a photo of the label or an export." },
          options: { type: "array", items: { type: "string" }, description: "2 to 5 suggested answers for kind choice; empty otherwise." },
          multi: { type: "boolean", description: "choice only: several answers may apply." },
        },
        required: ["text", "hint", "kind", "options", "multi"],
      },
    },
  },
  required: ["enough", "why", "questions"],
};
async function generateRound(it) {
  const roundNo = (it.rounds || []).length + 2;
  const cost = { usd: 0 };
  if (agent.fakeMode()) {
    // the prompt is assembled and logged as for a real call (the data wall's canary test reads the log); the round is canned
    const ctx = await contextFor(it);
    await agent.atWall("structured:intake_round", { company: it.company, model: it.model, system: ctx.system, prompt: ctx.answersText, blocks: ctx.blocks });
    return fakeRound(roundNo, it);
  }
  await agent.assertUnderCap(it.company, { started: true, fairUse: true });   // the credit was checked when the intake began; a paying site's fair-use line is checked at each round (src/selfserve.js)
  const ctx = await contextFor(it);
  const model = await intakeModel(it);
  const { data, costUsd } = await agent.runStructured({
    model, company: it.company, blocks: ctx.blocks, schema: ROUND_SCHEMA, toolName: "intake_round", maxTokens: 4000,
    system: ctx.system,
    prompt: `This is round ${roundNo} of at most 3. Below are the manager's answers so far, and any files they attached are above.\n\n${ctx.answersText}\n\n${ctx.modulesText}\n\nWhat the tool can connect to: ${CONNECTION_KINDS}.\n\nAsk only what still changes the design of a deliberately small first version: who may move the thing from one stage to the next; what happens at capacity or when two people want the same thing; whether things already carry a number or a name and what a scan of one contains; what the one-glance screen shows first; time (due dates, shift boundaries, how long a thing may sit); what "done" means and whether done things stay in view; and for every outside system they ticked, the follow-ups that shape the connection (for a label printer: what is on the label, its size, how many a day, which printer; for an ERP: which few things this needs from it, how fresh, who can get a login; for a spreadsheet: which columns matter, who keeps it; for a scanner: what gets scanned; for a machine: what it reports). Never ask something already answered. Never ask about how the tool is built, and never ask the manager to choose between fixed rules and the tool working something out: that is yours to decide (see the operating principles, 11). Where the tool will read a file or words from outside that it has not seen, the one thing worth asking is what should happen when something in it does not match. At most ${MAX_QUESTIONS_PER_ROUND} questions; fewer is better. If you already have enough for a small first version, say so and ask nothing.`,
  });
  cost.usd += costUsd || 0;
  const rewrite = await rewriteWith(cost);
  const questions = [];
  let n = 0;
  for (const raw of (data.questions || []).slice(0, MAX_QUESTIONS_PER_ROUND)) {
    const text = await plain.scrub(String(raw.text || ""), { allow: ctx.allow, rewrite });
    const hint = await plain.scrub(String(raw.hint || ""), { allow: ctx.allow, rewrite });
    if (text.hits.length || hint.hits.length) continue;   // a question that cannot be said plainly is dropped
    const opts = [];
    for (const o of (raw.options || []).slice(0, 5)) { const s = await plain.scrub(String(o), { allow: ctx.allow, rewrite }); if (!s.hits.length && s.text.trim()) opts.push(s.text.trim()); }
    const kind = ["choice", "text", "order", "attach"].includes(raw.kind) ? raw.kind : "text";
    n++;
    questions.push({
      id: `r${roundNo}q${n}`, round: roundNo, kind: kind === "choice" && opts.length < 2 ? "text" : kind, required: kind !== "attach",
      text: text.text.trim(), hint: hint.text.trim(), multi: Boolean(raw.multi), other: true, attach: kind === "attach",
      options: kind === "choice" ? opts.map((o, i) => ({ id: `o${i + 1}`, label: o })) : [],
      multiline: true, max: 6000, min: 1, maxItems: 10,
    });
  }
  const why = await plain.scrub(String(data.why || ""), { allow: ctx.allow, rewrite });
  await agent.recordUsage(it.company, it.slug, "intake", model, cost.usd, { intake: it.id, round: roundNo, questions: questions.length, enough: Boolean(data.enough) });
  return { round: roundNo, questions, enough: Boolean(data.enough) || !questions.length, why: why.hits.length ? "" : why.text.trim(), model, cost_usd: cost.usd, at: new Date().toISOString() };
}

// What a point of the design is about: a short tag beside it on the confirm screen, so the manager sees what each
// point is for before reading it (2026-10-01).
const POINT_KINDS = ["stages", "people", "screen", "rule", "number", "connection", "data", "later", "other"];
const DESIGN_SCHEMA = {
  type: "object",
  properties: {
    bluf: { type: "string", description: "One sentence: what this module is and who it is for." },
    items: { type: "array", minItems: 3, maxItems: 8, items: { type: "object", properties: { summary: { type: "string", description: "One sentence the manager reads and confirms: a screen, a rule, a number, a connection, or what is left out." }, kind: { type: "string", enum: POINT_KINDS, description: "What the point is about: stages (how the thing moves), people (who uses it), screen, rule, number (a number it shows), connection, data (starting data), later (left for a later version), other." } }, required: ["summary", "kind"] }, description: "The points the manager must read and confirm, one sentence each. Together they are the requirements of the first version." },
    reference_md: { type: "string", description: "The module reference in markdown with exactly these headings, in this order: Purpose; Who uses it and where; The thing and its stages; Screens; Rules; Numbers on the board; Connections; Starting data; What Rev 1 leaves out; Change guidance. Plain words throughout. Screens: one per role, each with its single prominent action. Change guidance: which kinds of later change are look-and-feel and which change how it works." },
    screens: { type: "array", items: { type: "object", properties: { role: { type: "string" }, title: { type: "string" }, device: { type: "string" }, prominent_action: { type: "string" } }, required: ["role", "title", "device", "prominent_action"] } },
    connections: { type: "array", items: { type: "object", properties: { kind: { type: "string", enum: ["files", "scanners", "printer", "erp", "web", "spreadsheet", "machine", "scale", "other", "peer"] }, name: { type: "string", description: "What the company calls it." }, what_for: { type: "string" }, tool_does: { type: "string", description: "What the tool connects on its own." }, person_does: { type: "string", description: "What a person has to do, or 'nothing'." } }, required: ["kind", "name", "what_for", "tool_does", "person_does"] } },
    handoffs: { type: "array", description: "Each outside system the manager named (an ERP, a label printer, the web, a machine, a scale) that is NOT turned on for this tool: Anetix's integration team connects it later. Empty when none.", items: { type: "object", properties: { kind: { type: "string", enum: ["erp", "printer", "web", "machine", "scale", "other"] }, system: { type: "string", description: "What the company calls it." }, would_add: { type: "string", description: "One plain sentence: what the tool will do once it is connected." }, until: { type: "string", description: "One plain sentence: how the first version works without it (typed in, scanned, a spreadsheet the manager loads)." } }, required: ["kind", "system", "would_add", "until"] } },
    starting_data: { type: "string", description: "What gets loaded from the attachments at first deploy, or 'none'." },
    leaves_out: { type: "array", items: { type: "string" }, description: "What Rev 1 deliberately leaves for later feedback." },
    change_guidance: { type: "string" },
  },
  required: ["bluf", "items", "reference_md", "screens", "connections", "handoffs", "starting_data", "leaves_out", "change_guidance"],
};
// Steps that need judgment (principles/PRINCIPLES.md 11, 2026-10-20): the design says where the tool works something out
// itself, in what the manager will see, so the build reaches for ctx.ai.judge there instead of a list of other names.
const JUDGMENT_DESIGN = "Steps that need judgment: where the tool must read something from outside that it has not seen before (a template or spreadsheet someone uploads, a customer's or supplier's file, notes typed in a person's own words) and line it up with what it keeps, no list of rules covers the next file. Say so in that screen's rules, as what the person sees: the tool works out the match itself, shows it to them to check or fix, and, when the same kind of file comes back, remembers the match and reuses it. Everything else stays fixed rules. Never offer the manager a choice between ways of building.";

// Outside connections are off until Anetix turns them on for the tool (src/connections.js, 2026-09-28). The design is
// told which are on, and whatever it still lists that is not on moves to handoffs here: the first version is built
// without it, and confirm hands each one to Anetix's integration team (src/requests.js handoffNew).
const OUTSIDE_DESIGN = ["erp", "printer", "web", "machine", "scale", "other"];
function outsideDesignBrief(on) {
  const words = require("./connections").OUTSIDE_WORDS;
  return `Outside systems: ${on.length ? `turned on for this tool: ${on.map((k) => words[k]).join(" and ")}.` : "none is turned on for this tool yet."} An ERP, a label printer, the public web, a machine or a scale is connected only after Anetix's integration team sets it up for this tool. Design the first version to work without any that is not turned on: people type the value in, scan it, or the manager loads a spreadsheet (files and scanners are always fine). List each such system the manager named under handoffs, with what it will add once connected and how the first version works until then, and leave it out of connections. The reference's Connections section says the same in plain words (for example: "Epicor: Anetix's integration team connects it later; until then the due date is typed in").`;
}
function splitHandoffs(design, on) {
  const keep = [], moved = [];
  for (const c of design.connections || []) {
    if (!c || !OUTSIDE_DESIGN.includes(c.kind) || on.includes(c.kind)) { keep.push(c); continue; }
    moved.push({ kind: c.kind, system: String(c.name || c.kind).slice(0, 80), would_add: String(c.what_for || c.tool_does || "").slice(0, 300), until: "people type it in for now" });
  }
  const handoffs = [...(design.handoffs || []).filter((h) => h && h.system), ...moved];
  const seen = new Set();
  return { connections: keep, handoffs: handoffs.filter((h) => { const k = `${h.kind}:${String(h.system).toLowerCase()}`; if (seen.has(k)) return false; seen.add(k); return true; }) };
}
function estimateUsd(d) {
  const screens = (d.screens || []).length, conns = (d.connections || []).filter((c) => c.kind !== "files").length;
  const usd = 4 + 2 * screens + 1.5 * conns + (d.starting_data && !/^none/i.test(d.starting_data) ? 1 : 0);
  return Math.round(usd * 2) / 2;
}
// ---- the confirm screen's changes (2026-10-01) ------------------------------------------------------------------
// Brendan: adjusting goes through the agent, not the raw text, and a change to one point must not reset the others.
// Every point carries an id (p1, p2...). The manager asks for changes to named points and for things to add; the agent
// re-issues the design, saying for each point which old one it is and whether it changed; mergeRevision then keeps
// every point nobody asked about word for word, puts back one the agent dropped, and marks what is different
// (changed: asked for; fit: changed to fit an asked-for change; new: added) so the manager knows what to read again.
const withIds = (items) => items.map((p, i) => ({ id: p.id || `p${i + 1}`, ...p }));
const REVISE_SCHEMA = (() => {
  const d = JSON.parse(JSON.stringify(DESIGN_SCHEMA));
  d.properties.items.maxItems = 12;
  d.properties.items.items.properties.id = { type: "string", description: "The point's id from the current design (p1, p2, ...) when this is that point, changed or not; \"new\" for a point that was not there." };
  d.properties.items.items.properties.changed = { type: "boolean", description: "true only when this point's wording changed." };
  d.properties.items.items.required = ["id", "summary", "kind", "changed"];
  return d;
})();
const MAX_CHANGES = 12;
function cleanChanges(raw, items) {
  const ids = new Set((items || []).map((p) => p.id));
  const out = [];
  for (const c of Array.isArray(raw) ? raw : []) {
    const text = String((c && c.text) || "").trim().slice(0, 2000);
    if (!text) continue;
    const point = c && c.point != null && ids.has(String(c.point)) ? String(c.point) : null;
    out.push({ point, text });
  }
  return out.slice(0, MAX_CHANGES);
}
function revisionText({ current, changes }) {
  const pts = withIds(current.items || []).map((p) => `${p.id}: ${p.summary}`).join("\n");
  const asks = changes.map((c) => {
    if (!c.point) return `- Add: ${c.text}`;
    const p = (current.items || []).find((x) => x.id === c.point);
    return `- Change ${c.point} ("${p ? p.summary : ""}"): ${c.text}`;
  }).join("\n");
  return `The manager read the design below and asked for these changes. Make exactly these and nothing else.\n\nThe current design:\nSummary: ${current.bluf || ""}\nPoints:\n${pts}\n\nThe current reference:\n${current.reference_md || ""}\n\nThe changes:\n${asks}\n\nRules for this revision: every point the changes do not name keeps its id and its exact wording, with changed false. A named point keeps its id and gets new wording. Something to add becomes a new point (id "new") unless it plainly belongs inside a named or existing point; then change that point and mark it changed. Change a point nobody named only when a requested change cannot hold without it, and mark it changed. Remove a point only when a change asks for that. Keep the reference word for word except where a change reaches it, and keep the summary unless a change makes it wrong.`;
}
function mergeRevision(prevItems, outItems, changes) {
  const prev = withIds(prevItems || []);
  const byId = new Map(prev.map((p) => [p.id, p]));
  const asked = new Set((changes || []).filter((c) => c.point).map((c) => c.point));
  let n = prev.reduce((m, p) => Math.max(m, Number(String(p.id).replace(/^p/, "")) || 0), 0);
  const used = new Set(), items = [];
  for (const o of outItems || []) {
    const old = byId.get(o.id);
    if (old && !used.has(o.id)) {
      used.add(o.id);
      const differs = String(o.summary).trim() !== String(old.summary).trim();
      if (differs && (asked.has(o.id) || o.changed)) items.push({ id: old.id, kind: o.kind || old.kind || "other", summary: o.summary, mark: asked.has(o.id) ? "changed" : "fit", flagged: o.flagged });
      else items.push({ id: old.id, kind: old.kind || o.kind || "other", summary: old.summary });   // nobody asked: word for word
    } else items.push({ id: `p${++n}`, kind: o.kind || "other", summary: o.summary, mark: "new", flagged: o.flagged });
  }
  // a point nobody asked about that the agent left out goes back where it was; one the manager named may go
  const removed = [];
  prev.forEach((p, i) => {
    if (used.has(p.id)) return;
    if (asked.has(p.id)) { removed.push(p.summary); return; }
    let at = 0;
    for (let k = i - 1; k >= 0; k--) { const j = items.findIndex((x) => x.id === prev[k].id); if (j >= 0) { at = j + 1; break; } }
    items.splice(at, 0, { id: p.id, kind: p.kind || "other", summary: p.summary });
  });
  return { items: items.slice(0, 14), removed };
}
// fake mode: each named point says what was asked, each addition becomes a point; the rest stays as it was
function fakeRevision({ current, changes }) {
  const out = withIds(current.items || []).map((p) => {
    const c = changes.find((x) => x.point === p.id);
    return { id: p.id, kind: p.kind || "other", summary: c ? `${p.summary.replace(/\s*\(changed:.*\)$/, "")} (changed: ${c.text})` : p.summary, changed: Boolean(c) };
  });
  for (const c of changes.filter((x) => !x.point)) out.push({ id: "new", kind: "other", summary: c.text, changed: true });
  const merged = mergeRevision(current.items || [], out, changes);
  const design = { ...current, items: merged.items.map(({ flagged, ...p }) => p), removed: merged.removed, model: "fake", cost_usd: 0, at: new Date().toISOString(),
    reference_md: `${current.reference_md || ""}\n\n**Changes asked for.** ${changes.map((c) => (c.point ? `${c.point}: ${c.text}` : `add: ${c.text}`)).join("; ")}` };
  delete design.revising;
  return design;
}
// The manager's changes from the confirm screen: one agent pass for all of them, the rest of the design kept.
async function revise(id, rawChanges, by) {
  const it = await getIntake(id);
  if (!it || it.status !== "design" || !it.design) throw new Error("there is no design to change right now");
  const current = { ...it.design, items: withIds(it.design.items || []) };
  const changes = cleanChanges(rawChanges, current.items);
  if (!changes.length) throw new Error("say what should be different first");
  await setIntake(id, { status: "thinking", error: null, design: { ...current, revising: { count: changes.length, at: new Date().toISOString() } } });
  (async () => {
    try {
      const design = await generateDesign(it, null, { revise: { current, changes } });
      design.adjustments = current.adjustments || [];
      design.revisions = [...(current.revisions || []), { at: new Date().toISOString(), changes }];
      delete design.revising;
      const cur = await getIntake(id);
      await setIntake(id, { design, status: "design", cost_usd: Number(cur.cost_usd || 0) + Number(design.cost_usd || 0) });
      await logEvent("intake_revised", id, { changes: changes.length, model: design.model, costUsd: design.cost_usd });
      await record("intake_revised", { company: it.company, module: it.slug || null, actor: by || "manager", intake_id: id, feedback_id: it.feedback_id, before: JSON.stringify(current.items.map((p) => p.summary)), after: JSON.stringify(design.items.map((p) => p.summary)), detail: { changes, removed: design.removed || [], model: design.model, cost_usd: design.cost_usd } });
    } catch (e) {
      console.error(`intake ${id} revise failed:`, e);
      await setIntake(id, { status: "design", design: current, error: String(e.message || e).slice(0, 500) });
    }
  })();
  return getIntake(id);
}

// opts.usageKind: what the spend is filed as; false = not filed here (the head-to-head assessment, src/assess.js,
// files its own re-runs as "assess"). The design is returned, never written: think() and adjust() write it.
// opts.revise: { current: the design on screen, changes: [{ point: "p2" | null, text }] }: the manager's changes to
// named points and the things to add (the confirm screen, 2026-10-01). The model re-issues the design; mergeRevision
// keeps every point nobody asked about exactly as it was.
async function generateDesign(it, adjustedText, opts = {}) {
  const cost = { usd: 0 };
  const rev = opts.revise || null;
  if (agent.fakeMode()) {
    const ctx = await contextFor(it);
    await agent.atWall("structured:module_design", { company: it.company, model: it.model, system: ctx.system, prompt: ctx.answersText + (adjustedText ? `\n\n${adjustedText}` : "") + (rev ? `\n\n${revisionText(rev)}` : ""), blocks: ctx.blocks });
    const d = rev ? fakeRevision(rev) : fakeDesign(it, adjustedText);
    return { ...d, ...splitHandoffs(d, it.slug ? await require("./connections").allowedKinds(it.company, it.slug) : []) };
  }
  await agent.assertUnderCap(it.company, { started: true, fairUse: true });   // the credit was checked when the intake began; a paying site's fair-use line is checked at each round (src/selfserve.js)
  const ctx = await contextFor(it);
  const model = await intakeModel(it);
  const outsideOn = it.slug ? await require("./connections").allowedKinds(it.company, it.slug) : [];
  const { data, costUsd } = await agent.runStructured({
    model, company: it.company, blocks: ctx.blocks, schema: rev ? REVISE_SCHEMA : DESIGN_SCHEMA, toolName: "module_design", maxTokens: 12000,
    system: ctx.system,
    prompt: `Write the design summary for this new module, deliberately small: the thing and its stages, one screen per role with its single prominent action, the few rules that must hold, the numbers on the board, the connections it needs, the starting data, and what the first version leaves for later. It will be built as plain screens on top of a list of the thing; nothing here should describe how it is built. The module is called "${it.name}".\n\nThe manager's answers, and any files they attached are above:\n\n${ctx.answersText}\n\n${ctx.modulesText}\n\nWhat the tool can connect to: ${CONNECTION_KINDS}.\n\n${outsideDesignBrief(outsideOn)}\n\n${JUDGMENT_DESIGN}${adjustedText ? `\n\nThe manager edited an earlier version of the reference text. Their edit is the authority; keep every change they made and re-issue the whole design to match it:\n\n${adjustedText}` : ""}${rev ? `\n\n${revisionText(rev)}` : ""}`,
  });
  cost.usd += costUsd || 0;
  const rewrite = await rewriteWith(cost);
  const bluf = await plain.scrub(String(data.bluf || ""), { allow: ctx.allow, rewrite });
  let items = [];
  for (const i of (data.items || []).slice(0, rev ? 12 : 8)) { const s = await plain.scrub(String(i.summary || ""), { allow: ctx.allow, rewrite }); if (s.text.trim()) items.push({ id: rev ? String(i.id || "new") : null, changed: Boolean(i.changed), kind: POINT_KINDS.includes(i.kind) ? i.kind : "other", summary: s.text.trim(), flagged: s.hits }); }
  const merged = rev ? mergeRevision(rev.current.items || [], items, rev.changes) : null;
  if (merged) items = merged.items;
  const ref = await plain.scrub(String(data.reference_md || ""), { allow: ctx.allow, rewrite });
  const flags = [];
  if (bluf.hits.length) flags.push({ where: "the one-line summary", words: bluf.hits });
  for (const [i, s] of items.entries()) if (s.flagged && s.flagged.length) flags.push({ where: `point ${i + 1}`, words: s.flagged });
  if (ref.hits.length) flags.push({ where: "the full reference", words: ref.hits });
  const design = {
    name: it.name, slug: it.slug, bluf: bluf.text.trim(), items: merged ? items.map(({ flagged, changed, ...p }) => p) : withIds(items.map((s) => ({ summary: s.summary, kind: s.kind }))), reference_md: ref.text.trim(),
    ...(merged ? { removed: merged.removed } : {}),
    screens: data.screens || [], ...splitHandoffs({ connections: data.connections || [], handoffs: data.handoffs || [] }, outsideOn), starting_data: data.starting_data || "none", leaves_out: data.leaves_out || [], change_guidance: data.change_guidance || "",
    flags, model, cost_usd: cost.usd, at: new Date().toISOString(),
  };
  design.estimate_usd = estimateUsd(design);
  if (opts.usageKind !== false) await agent.recordUsage(it.company, it.slug, opts.usageKind || "design", model, cost.usd, { intake: it.id, screens: design.screens.length, connections: design.connections.length, adjusted: Boolean(adjustedText) });
  return design;
}

// ---- fake mode ------------------------------------------------------------------------
function fakeRound(roundNo, it) {
  if (roundNo > 2) return { round: roundNo, questions: [], enough: true, why: "Fake mode: enough after one extra round.", model: "fake", cost_usd: 0, at: new Date().toISOString() };
  const thing = (it.answers && it.answers.thing) || "the thing";
  return {
    round: roundNo, enough: false, why: `Fake mode: three questions that would shape the design of ${thing}.`, model: "fake", cost_usd: 0, at: new Date().toISOString(),
    questions: [
      { id: `r${roundNo}q1`, round: roundNo, kind: "choice", required: true, multi: false, other: true, attach: false, text: `Who is allowed to move ${thing} from one stage to the next?`, hint: "This decides which screen carries the move button.", options: [{ id: "o1", label: "Anyone who can see it" }, { id: "o2", label: "Only leads and managers" }, { id: "o3", label: "Only the person it is assigned to" }], multiline: true, max: 1500, min: 1, maxItems: 10 },
      { id: `r${roundNo}q2`, round: roundNo, kind: "choice", required: true, multi: true, other: true, attach: false, text: `What should the first screen show at a glance?`, hint: "The one thing people look at before anything else.", options: [{ id: "o1", label: "Everything that is late" }, { id: "o2", label: "What is at each stage" }, { id: "o3", label: "What is assigned to me" }, { id: "o4", label: "Today's count" }], multiline: true, max: 1500, min: 1, maxItems: 10 },
      { id: `r${roundNo}q3`, round: roundNo, kind: "text", required: true, multi: false, other: true, attach: false, text: `What does "done" mean for ${thing}, and does a done one stay in view?`, hint: "Some things are gone the moment they are done; some need to be seen for a day.", options: [], multiline: true, max: 1500, min: 1, maxItems: 10 },
    ],
  };
}
function fakeDesign(it, adjustedText) {
  const a = it.answers || {};
  const thing = a.thing || "the thing";
  const stages = Array.isArray(a.stages) && a.stages.length ? a.stages : ["new", "in work", "done"];
  const roles = Object.keys(a.who || {});
  const screens = (roles.length ? roles : ["floor"]).map((r) => ({ role: r, title: `${it.name}: ${r} view`, device: ((a.devices || {})[r] || ["phone"])[0], prominent_action: r === "floor" ? `Move ${thing} to the next stage` : "See what is late" }));
  const picks = ((a.works_with || {}).picks || []).filter((p) => p !== "nothing");
  const connections = picks.map((p) => ({ kind: ["scanners", "printer", "erp", "web", "spreadsheet", "machine", "scale"].includes(p) ? p : "other", name: ((a.works_with || {}).names || {})[p] || p, what_for: `Fake mode: ${p} as ticked at intake`, tool_does: "connects what it can", person_does: p === "scanners" ? "nothing" : "a short setup step" }));
  const reference_md = adjustedText || `# Module reference: ${it.name}\n\n**Purpose.** ${a.purpose || "Fake mode purpose."}\n\n**Who uses it and where.** ${roles.join(", ") || "floor"}.\n\n**The thing and its stages.** ${thing}: ${stages.join(" > ")}.\n\n**Screens.** ${screens.map((s) => `${s.title} (${s.device}): ${s.prominent_action}`).join("; ")}.\n\n**Rules.** ${a.never || "none given"}.\n\n**Numbers on the board.** ${Q.describe(Q.FIXED.find((x) => x.id === "numbers"), a.numbers)}.\n\n**Connections.** ${connections.map((c) => c.name).join(", ") || "none"}.\n\n**Starting data.** none.\n\n**What Rev 1 leaves out.** Reports, history beyond a week, anything not in the stages above.\n\n**Change guidance.** Colors, wording and layout are look-and-feel changes; new stages, rules or connections change how it works.\n\n(SOS_FAKE_AGENT=1)`;
  const design = {
    name: it.name, slug: it.slug, bluf: `${it.name} tracks ${thing} through ${stages.length} stages for ${roles.join(", ") || "the floor"}. (fake mode)`,
    items: [
      { id: "p1", kind: "stages", summary: `${thing} moves through: ${stages.join(", ")}.` },
      { id: "p2", kind: "screen", summary: `One screen per role: ${screens.map((s) => s.role).join(", ")}.` },
      { id: "p3", kind: "rule", summary: `Rule: ${String(a.never || "none").slice(0, 120)}` },
      { id: "p4", kind: "connection", summary: `Connections: ${connections.map((c) => c.name).join(", ") || "none"}.` },
      { id: "p5", kind: "later", summary: "Rev 1 leaves out reports and long history; those come through feedback." },
    ],
    reference_md, screens, connections, starting_data: "none", leaves_out: ["reports", "long history"], change_guidance: "Look-and-feel versus how it works.",
    flags: [], model: "fake", cost_usd: 0, at: new Date().toISOString(), adjustments: [],
  };
  design.estimate_usd = estimateUsd(design);
  return design;
}

// ---- board summary --------------------------------------------------------------------
async function boardIntakes(company) {
  const rows = (await q("SELECT * FROM platform.module_intakes WHERE company=$1 AND status <> 'abandoned' ORDER BY id DESC", [company])).rows;
  const out = {};
  for (const it of rows) {
    const questions = await questionsFor(it);
    const st = roundState(questions, it.answers || {});
    const last = (it.rounds || [])[(it.rounds || []).length - 1];
    out[it.id] = {
      id: it.id, feedback_id: it.feedback_id, status: it.status, name: it.name, slug: it.slug, cost_usd: Number(it.cost_usd || 0), error: it.error, via: it.via || null,
      round: st.round, round_answered: st.answered, round_total: st.total, round_done: st.done, rounds_generated: (it.rounds || []).length,
      why: last ? last.why : "", bluf: it.design ? it.design.bluf : null, points: it.design ? (it.design.items || []).length : 0, estimate_usd: it.design ? it.design.estimate_usd : null, flags: it.design ? (it.design.flags || []).length : 0,
      run_id: (it.run_ids || []).slice(-1)[0] || null,
      updated_at: it.updated_at,
    };
  }
  return out;
}

// ---- routes ----------------------------------------------------------------------------
const router = express.Router();
const json = express.json({ limit: "1mb" });
const bigJson = express.json({ limit: `${Math.ceil(attachments.MAX_BYTES * 1.4 / 1048576) + 1}mb` });
const fail = (res, e, code = 400) => res.status(e.missing ? 409 : e.status === 402 ? 402 : code).json({ error: e.message, missing: e.missing, ...(e.code === "credit_out" ? { code: e.code } : {}) });

router.post("/api/c/:slug/intakes", requireManager, json, async (req, res) => {
  try {
    const co = (await q("SELECT slug FROM platform.companies WHERE slug=$1", [req.params.slug])).rows[0];
    if (!co) return res.status(404).json({ error: "unknown company" });
    const who = actor(req);
    const it = await create(co.slug, req.sosRole, { name: who.name || who.account_name || undefined });   // the tile says whose request it is (2026-10-15)
    res.json({ ...(await view(it)), reopened: Boolean(it.reopened) });
  } catch (e) { fail(res, e, 500); }
});
router.get("/api/intakes/:id(\\d{1,9})", requireManager, async (req, res) => {
  const it = await getIntake(Number(req.params.id));
  if (!it) return res.status(404).json({ error: "not found" });
  res.json(await view(it));
});
router.post("/api/intakes/:id(\\d{1,9})/answer", requireManager, json, async (req, res) => {
  try { res.json(await view(await answer(Number(req.params.id), String((req.body || {}).id || ""), (req.body || {}).value, actor(req)))); }
  catch (e) { fail(res, e); }
});
router.post("/api/intakes/:id(\\d{1,9})/next", requireManager, json, async (req, res) => {
  try { res.json(await view(await next(Number(req.params.id)))); }
  catch (e) { fail(res, e); }
});
router.post("/api/intakes/:id(\\d{1,9})/adjust", requireManager, json, async (req, res) => {
  try { res.json(await view(await adjust(Number(req.params.id), (req.body || {}).text, actor(req)))); }
  catch (e) { fail(res, e); }
});
router.post("/api/intakes/:id(\\d{1,9})/revise", requireManager, json, async (req, res) => {
  try { res.json(await view(await revise(Number(req.params.id), (req.body || {}).changes, actor(req)))); } catch (e) { fail(res, e); }
});
router.post("/api/intakes/:id(\\d{1,9})/confirm", requireManager, freshPin, json, async (req, res) => {
  try { res.json(await view(await confirm(Number(req.params.id), actor(req)))); }
  catch (e) { fail(res, e); }
});
// A confirmed design whose build never started (an older confirm, or a build
// that was discarded at the gate): start it now.
router.post("/api/intakes/:id(\\d{1,9})/build", requireManager, freshPin, json, async (req, res) => {
  try {
    const it = await getIntake(Number(req.params.id));
    if (!it) return res.status(404).json({ error: "not found" });
    if (it.status !== "confirmed" || !it.design) return res.status(400).json({ error: `nothing to build while the intake is ${it.status}` });
    if (await slugTaken(it.company, it.slug, it.id, it.name)) return res.status(409).json({ error: `a tool named "${it.name}" now exists; rename this one first` });
    await require("./selfserve").assertCredit(it.company);   // a build that never started is a new start
    await require("./modulebuild").startBuild(it);
    res.json(await view(await getIntake(it.id)));
  } catch (e) { fail(res, e); }
});
router.post("/api/intakes/:id(\\d{1,9})/restart", requireManager, json, async (req, res) => {
  try { res.json(await view(await restart(Number(req.params.id)))); }
  catch (e) { fail(res, e); }
});
router.post("/api/intakes/:id(\\d{1,9})/abandon", requireManager, json, async (req, res) => {
  try { res.json(await view(await abandon(Number(req.params.id), actor(req)))); }
  catch (e) { fail(res, e); }
});
router.post("/api/intakes/:id(\\d{1,9})/attach", requireManager, bigJson, async (req, res) => {
  try {
    const it = await getIntake(Number(req.params.id));
    if (!it) return res.status(404).json({ error: "not found" });
    if (!["answering", "failed"].includes(it.status)) return res.status(400).json({ error: `files cannot be added while the intake is ${it.status}` });
    const b = req.body || {};
    const a = await attachments.add({ company: it.company, intakeId: it.id, questionId: String(b.question_id || ""), filename: b.filename, mime: b.mime, data: b.data });
    await logEvent("intake_attachment", it.id, { question: b.question_id, filename: a.filename, size: a.size, kind: a.kind });
    res.json({ ok: true, attachment: a, view: await view(await getIntake(it.id)) });
  } catch (e) { fail(res, e); }
});
router.delete("/api/intakes/:id(\\d{1,9})/attach/:aid(\\d{1,9})", requireManager, async (req, res) => {
  try { await attachments.remove(Number(req.params.aid), Number(req.params.id)); const it = await getIntake(Number(req.params.id)); res.json(await view(it)); }
  catch (e) { fail(res, e); }
});
// A stored file is shown in the browser only when it is a photo or a pdf; anything else is a download. Whatever it is, it
// runs no script on the app's address: everything but a pdf goes out sandboxed with nothing it may load (the VSM audit,
// 2026-11-03: a file's type is the browser's word when it is kept, so an SVG or a web page could be opened as one).
const INLINE_SAFE = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"]);
router.get("/api/attachments/:id(\\d{1,9})", requireManager, async (req, res) => {
  const a = await attachments.get(Number(req.params.id));
  if (!a) return res.status(404).end();
  const mime = String(a.mime || "application/octet-stream").toLowerCase();
  const inline = INLINE_SAFE.has(mime);
  res.set("Content-Type", inline ? mime : (/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mime) ? mime : "application/octet-stream")).set("X-Content-Type-Options", "nosniff")
    .set("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${encodeURIComponent(a.filename)}"`).set("Cache-Control", "private, max-age=3600");
  if (mime !== "application/pdf") res.set("Content-Security-Policy", "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
  res.send(a.bytes);
});

module.exports = { router, create, openFor, slugTaken, answer, next, think, adjust, revise, mergeRevision, cleanChanges, withIds, POINT_KINDS, confirm, restart, abandon, view, getIntake, boardIntakes, questionsFor, roundState, intakeModel, generateDesign, estimateUsd, splitHandoffs, outsideDesignBrief, blankFor };
