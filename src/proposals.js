// Proposal engine: feedback item -> AI proposal + UI/functionality classification
// + the file the change lands in (pinned to the screen the feedback came from).
const { q, logEvent } = require("./db");
const { runStructured, haveKey, assertUnderCap, pickModel, guidanceFor, recordUsage } = require("./agent");
const registry = require("./registry");
const { record } = require("./record");
const datacheck = require("./datacheck");
const { sourceText } = require("./modulesource");

// erpLookups: the module's ERP lookup names, when it has an ERP connection.
// Only then is the model asked what ERP data the change needs (src/datacheck.js).
function proposalSchema(files, erpLookups, { triage = false, ask = false } = {}) {
  return {
    type: "object",
    properties: {
      ...(triage ? {
        triage: { type: "string", enum: ["change", "duplicate", "not_this_tool", "new_tool"], description: "What this request is. change = a change to this tool (the ordinary case). duplicate = it asks for the same thing as ONE of the open requests listed, so the same change would satisfy both. not_this_tool = it is not about this tool at all. new_tool = it asks for a whole new tool, not a change to this one. When unsure, choose change." },
        duplicate_of: { type: "integer", description: "When triage is duplicate: the number of the open request this one repeats. Otherwise 0." },
        triage_note: { type: "string", description: "For duplicate, not_this_tool and new_tool: one plain sentence telling the manager why. Empty for change." },
      } : {}),
      ...(ask ? {
        question: {
          type: "object",
          description: "ONE question for the person who sent this, INSTEAD of a guess. Only when the words can be read two ways that lead to different changes and the source does not settle which. Leave text empty when there is nothing to ask, which is most of the time.",
          properties: {
            text: { type: "string", description: "The question, in plain words a person on the floor answers in one tap. No software words. Empty when there is nothing to ask." },
            options: { type: "array", items: { type: "string" }, description: "Two or three short answers, each a different reading of the request. The person can also answer in their own words, so leave out 'other'." },
          },
          required: ["text", "options"],
        },
      } : {}),
      ...(erpLookups && erpLookups.length ? { erp_data: datacheck.schemaFor(erpLookups) } : {}),
      proposal: { type: "string", description: "Plain-language description of the change: what will change, on which screen, and what it will look like. Written for a production manager, not a developer. 2 to 5 sentences." },
      class: { type: "string", enum: ["ui", "functionality"], description: "ui = layout, styling, copy, view arrangement, or displaying a field that the page already receives. functionality = any logic, data, calculation, workflow state, or integration change. When uncertain, choose functionality." },
      target_file: { type: "string", enum: files, description: "The one file the change lands in. Default to the file behind the screen the feedback came from; pick another only when the feedback clearly talks about a different screen." },
      rationale: { type: "string", description: "One or two sentences on why this class, this file, and this approach." },
    },
    required: [...(triage ? ["triage"] : []), "proposal", "class", "target_file", "rationale", ...(erpLookups && erpLookups.length ? ["erp_data"] : [])],
  };
}

// The live module as a model reads it: every file WHOLE (src/modulesource.js). Until 2026-09-19 this cut
// pages at 14,000 characters and everything else at 8,000 in silence, so proposals and system reviews were
// written from under half of routes.js. `first` names the files this reader needs most (the screen the
// feedback came from); it only matters when a module is over the overall budget, and then `cut` says what
// was cut so the caller can put it on the record.
// `version`: read that version instead of the live one (the head-to-head assessment, src/assess.js, re-drafts an
// old request against the module as it was when the request came in).
async function moduleContext(company, mod, { first = [], version = null } = {}) {
  const row = await registry.getModule(company, mod);
  if (!row) return { text: "(unknown module)", files: [], screens: [], cut: [] };
  const v = version || row.live_version;
  const files = (await registry.versionFiles(company, mod, v)) || {};
  const manifest = JSON.parse(files["module.json"] || "{}");
  const screens = registry.pageEntries(manifest);
  const src = sourceText(files, { first: first.filter(Boolean) });
  const screenList = screens.map((s) => `- ${s.label}: ${s.file} (route ${s.route})`).join("\n");
  return {
    text: `Module "${row.title}" (${mod}), ${v === row.live_version ? "live version" : "version"} ${v}.\nScreens in this module:\n${screenList}\n- server logic: routes.js\nSource:\n${src.text}`,
    files: Object.keys(files).filter((f) => f.startsWith("pages/") || f === "routes.js"),
    screens, cut: src.cut, chars: src.chars,
  };
}

// What the proposer is told when it may sort the request before proposing (src/arrival.js).
const TRIAGE_BRIEF = `

First decide what this request is (triage):
- change: a change to this tool. The ordinary case. Draft the proposal.
- duplicate: it asks for the same thing as ONE of the open requests listed above, so the same change would satisfy both. Give that request's number in duplicate_of. A request about the same screen that wants something different is NOT a duplicate. When unsure, it is a change.
- not_this_tool: it is not about this tool at all (the building, a machine, a person, another system).
- new_tool: it asks for a whole new tool, not a change to this one.
For anything but change, write one plain sentence in triage_note for the manager, and keep proposal and rationale to one short sentence each (they are not shown).`;
const ASK_BRIEF = `

You may ask ONE question instead of guessing. Ask only when the words can be read two ways that lead to DIFFERENT changes and the source below does not settle which. Then fill question with one plain question and two or three short answers, each a different reading; the person taps one or answers in their own words. Never ask what the source already answers, never ask how to build it, never ask two things. Most requests need no question: leave question.text empty and draft the proposal. When you do ask, keep proposal and rationale to one short sentence each (they are not shown).`;

// Everything the proposer is handed for one request: the system brief, the prompt, the schema and the attached
// photo. A function of its own so the head-to-head assessment (src/assess.js) asks both models exactly what a
// real proposal asks. opts carries what generateProposal already worked out (mayTriage, mayAsk, answered, ctx,
// screenLine); the assessment passes { force: true } and a version and lets the rest be worked out here.
async function proposalRequest(fb, opts = {}) {
  const arrival = require("./arrival");
  const answered = opts.answered != null ? opts.answered : Boolean(fb.question && fb.question.answer);
  const mayTriage = opts.mayTriage != null ? opts.mayTriage : !opts.force && !opts.answered && !answered && !fb.triage;
  const mayAsk = opts.mayAsk != null ? opts.mayAsk : mayTriage && !fb.question;
  const ctx = opts.ctx || await moduleContext(fb.company, fb.module, { first: [fb.target_file], version: opts.version || null });
  const screenLine = opts.screenLine || (fb.screen ? `Screen: ${fb.screen} (${fb.target_file})` : `Screen: unknown (page ${fb.page || "?"})`);
  const guidance = await guidanceFor(fb.company, fb.module);
  // the data check: a module with an ERP connection is asked what ERP data the change needs
  const erpLookups = Object.keys(await datacheck.erpState(fb.company, fb.module).catch(() => ({})));
  const erpAsk = erpLookups.length ? `\n\nThis module can read the company's ERP through these lookups: ${erpLookups.join(", ")}. ERP-FIELDS.md above lists every field each one can give. List under erp_data every piece of ERP data this change needs, naming the listed field that covers it; when no listed field covers it, leave its field empty and still write the proposal as it will work once the data is there. Do not tell the manager about lookups or fields.\nERP lookups available to this module: ${erpLookups.join(", ")}` : "";
  // a follow-up ("not quite" on something that shipped): the proposer is told what was built before and that this is what is still off
  const closeloop = require("./closeloop");
  const followUp = closeloop.followUpContext(await closeloop.originalOf(fb).catch(() => null));
  // what the person pointed at, a photo they took, the answer to the one question, and the open requests this might repeat
  const pointed = arrival.elementLine(fb.element);
  const blocks = await arrival.photoBlocks(fb.id).catch((e) => { console.error("[arrival] photo:", e.message); return []; });
  const qa = answered ? `\nBefore drafting, the person was asked: "${fb.question.text}" (the choices: ${(fb.question.options || []).join(" / ")}). The answer${fb.question.answered_by ? `, from ${fb.question.answered_by}` : ""}: "${fb.question.answer}". Read the answer as part of the request.` : "";
  const open = mayTriage && !opts.alone ? await arrival.candidates(fb).catch(() => []) : [];   // alone: the manager said "not the same", so nothing to repeat
  const extras = [followUp, pointed, blocks.length ? "\nThe person also took a photo; it is attached above." : "", qa].map((x) => String(x || "").trim()).filter(Boolean).join("\n");
  return {
    system: "You draft improvement proposals for a factory operations platform. The reader is a production manager with no software background. Be concrete and short. Never mention code internals in the proposal text. Prefer the smallest change that removes the reported friction. The feedback was filed from a specific screen; the change belongs on that screen unless the feedback clearly says otherwise.\n\n" + guidance.text,
    prompt: `Floor feedback (reported by ${fb.name || "anonymous"}, reported ${fb.recurrence} time(s))\n${screenLine}\n\n"${fb.message}"${extras ? `\n\n${extras}` : ""}${arrival.candidatesBlock(open)}${mayTriage ? TRIAGE_BRIEF : ""}${mayAsk ? ASK_BRIEF : ""}\n\nCurrent module for context:\n${ctx.text}\n\nDraft the proposal, classify it, and name the target file.${erpAsk}`,
    schema: proposalSchema(ctx.files.length ? ctx.files : ["routes.js"], erpLookups, { triage: mayTriage, ask: mayAsk }),
    blocks, erpLookups, ctx, mayTriage, mayAsk,
  };
}

// opts.arrival: the call made the moment a request lands (src/arrival.js). opts.answered: the person answered
// the question, draft with the answer. opts.force: the manager asked for a proposal on something the proposer
// flagged or asked about, or the platform is proposing again: no sorting, no question, a proposal.
async function generateProposal(feedbackId, opts = {}) {
  const fb = (await q("SELECT * FROM platform.feedback WHERE id=$1", [feedbackId])).rows[0];
  if (!fb) throw new Error("feedback not found");
  if (!fb.module || fb.module === "platform") throw new Error("platform feedback is handled outside the AI loop");
  if (fb.kind === "module_request") throw new Error("a module request is answered in its own popout, not reviewed as feedback");
  if (fb.duplicate_of) throw new Error(`this one is folded into request #${fb.duplicate_of}; press "not the same" on it first`);
  const arrival = require("./arrival");
  const answered = Boolean(fb.question && fb.question.answer);
  const mayTriage = !opts.force && !opts.answered && !answered && !fb.triage;
  const mayAsk = mayTriage && !fb.question;

  const ctx = await moduleContext(fb.company, fb.module, { first: [fb.target_file] });
  const screenLine = fb.screen ? `Screen: ${fb.screen} (${fb.target_file})` : `Screen: unknown (page ${fb.page || "?"})`;

  if (!haveKey()) {
    // graceful degradation so the loop is walkable without a key
    const r = await q(
      `INSERT INTO platform.proposals (feedback_id, body, class, target_file, rationale, status)
       VALUES ($1,$2,'functionality',$3,'AI is not configured on this instance; placeholder proposal.','draft') RETURNING *`,
      [feedbackId, `[AI not configured] Manual proposal needed for: "${fb.message}"`, fb.target_file || null]);
    await q("UPDATE platform.feedback SET status='reviewing', updated_at=now() WHERE id=$1", [feedbackId]);
    return r.rows[0];
  }
  await assertUnderCap(fb.company);

  // the propose model: the company's, the instance's, or this request's arm of the live A/B (src/agent.js)
  const { model } = await pickModel(fb.company, "propose", `feedback:${fb.id}`);
  const req = await proposalRequest(fb, { ...opts, mayTriage, mayAsk, answered, ctx, screenLine });
  const { erpLookups, blocks } = req;
  const { data, costUsd } = await runStructured({ model, system: req.system, prompt: req.prompt, schema: req.schema, toolName: "proposal", blocks: req.blocks });
  const spent = (outcome) => recordUsage(fb.company, fb.module, "triage", model, costUsd || 0, { feedback_id: fb.id, outcome }).catch((e) => console.error("[arrival] usage:", e.message));

  // the same thing as an open request: fold it in, no proposal of its own
  if (mayTriage && !opts.alone && data.triage === "duplicate") {
    const root = await arrival.linkDuplicate(fb, data.duplicate_of, data.triage_note, "agent");
    if (root) { await spent("duplicate"); return { feedback_id: fb.id, triage: "duplicate", duplicate_of: root.id, note: data.triage_note || null }; }
    console.error(`[arrival] #${fb.id}: the proposer called it a duplicate of #${data.duplicate_of}, which is not an open request of this tool; proposing instead`);
  }
  // not a change to this tool: a flag and one sentence for the manager, who can still ask for a proposal
  if (mayTriage && (data.triage === "not_this_tool" || data.triage === "new_tool")) {
    const note = arrival.clip(data.triage_note, 300) || null;
    await q("UPDATE platform.feedback SET triage=$2, triage_note=$3, updated_at=now() WHERE id=$1", [fb.id, data.triage, note]);
    await record("request_flagged", { company: fb.company, module: fb.module, actor: "agent", feedback_id: fb.id, before: arrival.clip(fb.message, 2000), after: note, detail: { triage: data.triage, model } });
    await logEvent("request_flagged", fb.id, { company: fb.company, module: fb.module, triage: data.triage });
    await spent(data.triage);
    return { feedback_id: fb.id, triage: data.triage, note };
  }
  // one question instead of a guess (only a question that reads plainly is asked; otherwise the proposal stands)
  if (mayAsk && data.question && String(data.question.text || "").trim()) {
    const qn = arrival.cleanQuestion(data.question, (t) => require("./plainwords").check(t));
    if (qn) { const asked = await arrival.ask(fb, qn, model); await spent("question"); return { feedback_id: fb.id, question: asked }; }
    console.error(`[arrival] #${fb.id}: the proposer's question did not read plainly and was dropped: ${JSON.stringify(data.question).slice(0, 200)}`);
  }

  // one live draft per request: an earlier draft nobody decided on gives way to this one
  await q("UPDATE platform.proposals SET status='superseded' WHERE feedback_id=$1 AND status='draft'", [feedbackId]);
  const r = await q(
    `INSERT INTO platform.proposals (feedback_id, body, class, target_file, rationale, model, cost_usd) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [feedbackId, data.proposal, data.class, data.target_file || fb.target_file || null, data.rationale, model, costUsd || 0]);
  // a proposal ends a flag (the manager asked for one anyway) and takes an unanswered question off the asker's screen
  await q("UPDATE platform.feedback SET status='reviewing', triage=NULL, triage_note=NULL, updated_at=now() WHERE id=$1", [feedbackId]);
  await logEvent("proposal_generated", feedbackId, { class: data.class, target: data.target_file, model, costUsd, arrival: Boolean(opts.arrival) });
  if (ctx.cut && ctx.cut.length) { console.error(`[context] ${fb.company}/${fb.module} is over the context budget; cut: ${ctx.cut.map((c) => `${c.name} ${c.shown}/${c.of}`).join(", ")}`); await logEvent("proposal_context_cut", feedbackId, { company: fb.company, module: fb.module, cut: ctx.cut }); }
  await record("proposal_drafted", { company: fb.company, module: fb.module, actor: "agent", feedback_id: feedbackId, proposal_id: r.rows[0].id, after: data.proposal, detail: { class: data.class, target: data.target_file || fb.target_file || null, rationale: data.rationale, model, cost_usd: costUsd || 0, context_chars: ctx.chars || null, ...(ctx.cut && ctx.cut.length ? { context_cut: ctx.cut } : {}), ...(opts.arrival ? { on_arrival: true } : {}), ...(answered ? { with_answer: true } : {}), ...(fb.element ? { pointed: true } : {}), ...(blocks.length ? { photos: blocks.length / 2 } : {}) } });
  // can the ERP connection give what this change needs? the platform checks, not the model
  const check = erpLookups.length ? await datacheck.apply(r.rows[0], fb, data.erp_data).catch((e) => { console.error("[datacheck]", e.message); return null; }) : null;
  return { ...r.rows[0], data_check: check };
}

module.exports = { generateProposal, moduleContext, proposalRequest };
