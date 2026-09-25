// Propose on arrival. Product review of 2026-09-18, build order item 8, built
// together with the clarifying question left over from item 6 because both
// live in the proposer's one call (Brendan, 2026-09-20).
//
// Until this, feedback sat on the board until a manager pressed "Review with
// AI", the operator could only type (no pointing, no photo), a manager tallied
// duplicates by eye, and ambiguous feedback got a guess. Now, the moment a
// request lands, ONE call to the proposer does four things:
//
//   proposes      the ordinary case: the draft proposal is on the card before
//                 the manager looks
//   links         "the same thing as #12": the request is folded into #12, the
//                 count goes up, the manager sees one card that says "asked 4
//                 times by 3 people", and when #12 ships everyone who asked is
//                 told and asked whether it fixed it (a database trigger keeps a
//                 duplicate's status, outcome and shipped version in step with
//                 the request it was folded into)
//   asks          when the words can be read two ways that lead to different
//                 changes: ONE plain question with two or three answers to tap
//                 and a free-text way out, INSTEAD of a guess. It goes to the
//                 person who asked, right on the screen they are standing at and
//                 in My requests, and to the manager's card; whoever answers
//                 first wins, and the proposal is then drafted with the answer.
//                 One question per request, ever.
//   flags         "not about this tool" and "this is a new tool", each with one
//                 plain sentence; the manager can still ask for a proposal
//
// What the operator points at (an element on the screen) and a photo ride along
// in the same POST /api/feedback and go to the PROPOSER, not onto the manager's
// card (one quiet link there, for the rare time they want it).
//
// Guards. A company can switch it off (Agent settings; the demo runbook's
// "Review with AI" moment wants it off). SOS_AUTO_PROPOSE_PER_HOUR (default 40)
// bounds a runaway tablet: past it, requests wait for the manager's button. The
// company's budget and the instance cap apply as to any proposal. Calls for one
// module run one at a time, so two identical requests a second apart cannot be
// linked to each other. A failure leaves the request exactly as it was before
// this existed: on the board, with the button.
const crypto = require("crypto");
const { q, logEvent } = require("./db");
const { record } = require("./record");

const PER_HOUR = Number(process.env.SOS_AUTO_PROPOSE_PER_HOUR || 40);
const PHOTOS_PER_DAY = Number(process.env.SOS_PHOTOS_PER_DAY || 300);   // per company; past it the words still go through
const OPEN = ["new", "reviewing", "in_progress"];

const SCHEMA = `
ALTER TABLE platform.feedback ADD COLUMN IF NOT EXISTS duplicate_of INTEGER;
ALTER TABLE platform.feedback ADD COLUMN IF NOT EXISTS triage TEXT;            -- change | duplicate | not_this_tool | new_tool
ALTER TABLE platform.feedback ADD COLUMN IF NOT EXISTS triage_note TEXT;
ALTER TABLE platform.feedback ADD COLUMN IF NOT EXISTS element JSONB;          -- what the person pointed at, for the proposer
ALTER TABLE platform.feedback ADD COLUMN IF NOT EXISTS question JSONB;         -- { text, options, asked_at, model, answer, answered_at, answered_by, answered_role, answered_person }
ALTER TABLE platform.feedback ADD COLUMN IF NOT EXISTS reply_token TEXT;       -- lets the device that sent a nameless request answer its question
ALTER TABLE platform.feedback ADD COLUMN IF NOT EXISTS arrival TEXT;           -- proposing | done | failed | skipped: why
ALTER TABLE platform.companies ADD COLUMN IF NOT EXISTS auto_propose BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE platform.companies ADD COLUMN IF NOT EXISTS allow_photos BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE platform.attachments ADD COLUMN IF NOT EXISTS feedback_id INTEGER;
CREATE INDEX IF NOT EXISTS feedback_duplicate_of ON platform.feedback (duplicate_of) WHERE duplicate_of IS NOT NULL;
CREATE INDEX IF NOT EXISTS attachments_feedback ON platform.attachments (feedback_id) WHERE feedback_id IS NOT NULL;
CREATE OR REPLACE FUNCTION platform.feedback_dupes_follow() RETURNS trigger AS $$
BEGIN
  IF (NEW.status, NEW.outcome, NEW.shipped_version, NEW.shipped_at, NEW.manager_answer, NEW.manager_answer_at)
     IS DISTINCT FROM (OLD.status, OLD.outcome, OLD.shipped_version, OLD.shipped_at, OLD.manager_answer, OLD.manager_answer_at) THEN
    UPDATE platform.feedback
       SET status=NEW.status, outcome=NEW.outcome, shipped_version=NEW.shipped_version, shipped_at=NEW.shipped_at,
           manager_answer=NEW.manager_answer, manager_answer_at=NEW.manager_answer_at, manager_answer_by=NEW.manager_answer_by, manager_answer_person=NEW.manager_answer_person,
           updated_at=now()
     WHERE duplicate_of = NEW.id;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS feedback_dupes ON platform.feedback;
CREATE TRIGGER feedback_dupes AFTER UPDATE ON platform.feedback FOR EACH ROW EXECUTE FUNCTION platform.feedback_dupes_follow();
`;
async function init() {
  await q(SCHEMA);
  // a call that was in flight when the platform restarted never finished: the card gets its button back
  await q("UPDATE platform.feedback SET arrival=NULL WHERE arrival='proposing'");
}

// ---- pure ------------------------------------------------------------------------------------------
const clip = (s, n) => { const t = String(s == null ? "" : s).replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t; };
// What the widget sends about the element the person tapped, cut down to what a proposer can use. null = nothing usable.
function cleanElement(e) {
  if (!e || typeof e !== "object" || Array.isArray(e)) return null;
  const out = {
    tag: clip(e.tag, 20).toLowerCase().replace(/[^a-z0-9-]/g, "") || null,
    id: clip(e.id, 80) || null,
    classes: Array.isArray(e.classes) ? e.classes.map((c) => clip(c, 40)).filter(Boolean).slice(0, 6) : [],
    text: clip(e.text, 160) || null,
    label: clip(e.label, 120) || null,
    path: clip(e.path, 300) || null,
    html: e.html ? String(e.html).slice(0, 400) : null,
  };
  if (e.rect && typeof e.rect === "object") { const n = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : null); out.rect = { x: n(e.rect.x), y: n(e.rect.y), w: n(e.rect.w), h: n(e.rect.h), vw: n(e.rect.vw), vh: n(e.rect.vh) }; }
  return out.tag || out.text || out.id ? out : null;
}
// One line for the proposer.
function elementLine(el) {
  if (!el) return "";
  const name = `<${el.tag || "element"}${el.id ? ` id="${el.id}"` : ""}${el.classes && el.classes.length ? ` class="${el.classes.join(" ")}"` : ""}>`;
  const where = el.rect && el.rect.vw ? `, ${el.rect.y < el.rect.vh / 3 ? "near the top" : el.rect.y > (2 * el.rect.vh) / 3 ? "near the bottom" : "in the middle"} of a ${el.rect.vw} by ${el.rect.vh} screen` : "";
  return `\nThe person POINTED at one thing on the screen while writing this: ${name}${el.text ? ` showing "${el.text}"` : ""}${el.label ? ` (labelled "${el.label}")` : ""}${where}.${el.path ? ` Where it sits in the page: ${el.path}.` : ""}${el.html ? `\nIts markup starts: ${el.html}` : ""}\nThe feedback is about that element unless the words plainly say otherwise.`;
}
// The open requests a new one might repeat, as the proposer reads them.
function candidatesBlock(rows) {
  if (!rows || !rows.length) return "";
  return `\n\nOpen requests on this tool (a new request that asks for the same thing as one of these is a duplicate of it):\n${rows.map((r) => `#${r.id} [${r.status === "new" ? "waiting" : r.status === "reviewing" ? "proposal drafted" : "being built"}]${r.screen ? ` on ${r.screen}` : ""}: "${clip(r.message, 240)}"${r.proposal_body ? ` (proposal: ${clip(r.proposal_body, 160)})` : ""}`).join("\n")}`;
}
// A question worth showing: plain text, two or three short options, none of the words a floor never reads.
function cleanQuestion(qn, bannedHits) {
  if (!qn || typeof qn !== "object") return null;
  const text = clip(qn.text, 240);
  const options = (Array.isArray(qn.options) ? qn.options : []).map((o) => clip(o, 80)).filter(Boolean).slice(0, 3);
  if (text.length < 8 || options.length < 2 || new Set(options.map((o) => o.toLowerCase())).size !== options.length) return null;
  if (bannedHits && bannedHits([text, ...options].join(" \n ")).length) return null;
  return { text, options };
}
// "asked 4 times by 3 people": the request itself plus everything folded into it.
function tally(root, dupes) {
  const all = [root, ...(dupes || [])];
  const who = new Set(all.map((r) => (r.person_id ? `p${r.person_id}` : r.name ? `n${String(r.name).toLowerCase().trim()}` : `a${r.id}`)));
  return { times: all.length, people: who.size };
}

// ---- reads ------------------------------------------------------------------------------------------
async function candidates(fb) {
  return (await q(
    `SELECT f.id, f.status, f.screen, f.message, p.body AS proposal_body
       FROM platform.feedback f
       LEFT JOIN LATERAL (SELECT body FROM platform.proposals WHERE feedback_id=f.id AND status <> 'superseded' ORDER BY id DESC LIMIT 1) p ON true
      WHERE f.company=$1 AND f.module=$2 AND f.kind='feedback' AND f.duplicate_of IS NULL AND f.id < $3 AND f.status = ANY($4::text[])
      ORDER BY f.id DESC LIMIT 40`, [fb.company, fb.module, fb.id, OPEN])).rows;
}
async function photoBlocks(feedbackId) {
  const rows = (await q("SELECT mime, bytes FROM platform.attachments WHERE feedback_id=$1 AND mime LIKE 'image/%' ORDER BY id LIMIT 2", [feedbackId])).rows;
  const blocks = [];
  for (const a of rows) { blocks.push({ type: "text", text: "A photo the person took with this request:" }); blocks.push({ type: "image", source: { type: "base64", media_type: a.mime, data: a.bytes.toString("base64") } }); }
  return blocks;
}
// photos are off while the company's data is walled off from the AI (src/datawall.js): a photo is a picture of the data
async function settings(company) {
  const r = (await q("SELECT auto_propose, allow_photos, ai_reads_data FROM platform.companies WHERE slug=$1", [company])).rows[0];
  const walled = Boolean(r && r.ai_reads_data === false);
  return { auto_propose: !r || r.auto_propose !== false, allow_photos: (!r || r.allow_photos !== false) && !walled, walled };
}

// ---- writes -----------------------------------------------------------------------------------------
const fail = (status, msg) => Object.assign(new Error(msg), { status });
const newToken = () => crypto.randomBytes(12).toString("base64url");

// Fold a request into the one it repeats. root: a feedback row that is open and not itself a duplicate.
async function linkDuplicate(fb, rootId, note, by) {
  const n = Number(String(rootId == null ? "" : rootId).replace(/[^0-9]/g, "")) || 0;   // a model may hand back "#12"
  const root = (await q("SELECT * FROM platform.feedback WHERE id=$1 AND company=$2 AND module=$3 AND kind='feedback'", [n, fb.company, fb.module])).rows[0];
  if (!root || root.id >= fb.id || root.duplicate_of || !OPEN.includes(root.status)) return null;
  await q("UPDATE platform.feedback SET duplicate_of=$2, triage='duplicate', triage_note=$3, status=$4, outcome=$5, batch_id=NULL, updated_at=now() WHERE id=$1", [fb.id, root.id, clip(note, 300) || null, root.status, root.outcome]);
  await recount(root.id);
  await record("duplicate_linked", { company: fb.company, module: fb.module, actor: by || "agent", feedback_id: fb.id, before: clip(fb.message, 2000), after: clip(root.message, 2000), detail: { duplicate_of: root.id, note: clip(note, 300) || null } });
  await logEvent("duplicate_linked", fb.id, { company: fb.company, module: fb.module, duplicate_of: root.id });
  return root;
}
async function recount(rootId) {
  await q("UPDATE platform.feedback SET recurrence = 1 + (SELECT count(*) FROM platform.feedback d WHERE d.duplicate_of=$1), updated_at=now() WHERE id=$1", [rootId]);
}
// The manager says it is not the same thing after all: the request stands on its own again.
async function unlink({ feedbackId, company, actor }) {
  const fb = (await q("SELECT * FROM platform.feedback WHERE id=$1 AND company=$2", [Number(feedbackId), company])).rows[0];
  if (!fb) throw fail(404, "no such request");
  if (!fb.duplicate_of) throw fail(409, "this request is not folded into another one");
  if (fb.status === "done" || fb.status === "declined") throw fail(409, "that one is already closed; file it again if it is still needed");
  const rootId = fb.duplicate_of;
  await q("UPDATE platform.feedback SET duplicate_of=NULL, triage=NULL, triage_note=NULL, status='new', outcome=NULL, shipped_version=NULL, shipped_at=NULL, arrival=NULL, updated_at=now() WHERE id=$1", [fb.id]);
  await recount(rootId);
  await record("duplicate_unlinked", { company, module: fb.module, actor, feedback_id: fb.id, after: clip(fb.message, 2000), detail: { was_duplicate_of: rootId } });
  return { id: fb.id, was_duplicate_of: rootId };
}

// One call at a time per module, so two requests a second apart are read in order.
const chains = new Map();
function inOrder(key, fn) {
  const prev = chains.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  chains.set(key, next.finally(() => { if (chains.get(key) === next) chains.delete(key); }));
  return next;
}

// The moment a request is filed. Two halves, on purpose: claim() is awaited by whoever filed it, so by the time
// they get their answer the request is either marked "proposing" or marked with why it was passed over, and a
// manager's button pressed in the same instant cannot start a second call; work() runs behind the response.
// Neither throws.
async function claim(feedbackId) {
  try {
    const fb = (await q("SELECT * FROM platform.feedback WHERE id=$1", [Number(feedbackId)])).rows[0];
    if (!fb || fb.kind !== "feedback" || !fb.module || fb.module === "platform" || fb.status !== "new" || fb.review_id || fb.duplicate_of || fb.arrival) return null;
    const agent = require("./agent");
    const skip = async (why) => { await q("UPDATE platform.feedback SET arrival=$2 WHERE id=$1", [fb.id, `skipped: ${why}`]); return null; };
    if (!(await settings(fb.company)).auto_propose) return skip("switched off for this company");
    if (!agent.haveKey()) return skip("no AI on this instance");
    const live = (await q("SELECT live_version FROM platform.modules WHERE company=$1 AND name=$2", [fb.company, fb.module])).rows[0];
    if (!live || !live.live_version) return skip("the tool is not live yet");
    const lastHour = Number((await q("SELECT count(*) FROM platform.feedback WHERE company=$1 AND (arrival IN ('proposing','done','failed')) AND created_at > now() - interval '1 hour'", [fb.company])).rows[0].count);
    if (lastHour >= PER_HOUR) { console.error(`[arrival] ${fb.company}: ${lastHour} requests read in the last hour, the limit is ${PER_HOUR}; #${fb.id} waits for the manager's button`); return skip("a busy hour"); }
    const got = (await q("UPDATE platform.feedback SET arrival='proposing' WHERE id=$1 AND arrival IS NULL RETURNING *", [fb.id])).rows[0];
    return got || null;
  } catch (e) { console.error(`[arrival] #${feedbackId}:`, e.message); return null; }
}
function work(fb, opts = {}) {
  return inOrder(`${fb.company}/${fb.module}`, async () => {
    try {
      const out = await require("./proposals").generateProposal(fb.id, { arrival: true, alone: Boolean(opts.alone) });
      await q("UPDATE platform.feedback SET arrival='done' WHERE id=$1", [fb.id]);
      return out;
    } catch (e) {
      await q("UPDATE platform.feedback SET arrival='failed' WHERE id=$1", [fb.id]).catch(() => {});
      await require("./credit").noteFailure(e.message, `the proposal for request #${fb.id}`);
      console.error(`[arrival] #${fb.id}: ${e.message}`);
      return { failed: e.message };
    }
  });
}
// claim now, work behind the caller. Resolves to true when the proposer is reading it.
async function start(feedbackId, opts) {
  const fb = await claim(feedbackId);
  if (fb) setImmediate(() => work(fb, opts).catch(() => {}));
  return Boolean(fb);
}
// both halves in one, for callers with nothing to answer first
async function onArrival(feedbackId, opts) { const fb = await claim(feedbackId); return fb ? work(fb, opts) : { skipped: true }; }

// The proposer asked instead of guessing. One question per request.
async function ask(fb, qn, model) {
  const question = { text: qn.text, options: qn.options, asked_at: new Date().toISOString(), model: model || null };
  await q("UPDATE platform.feedback SET question=$2, updated_at=now() WHERE id=$1", [fb.id, JSON.stringify(question)]);
  await record("question_asked", { company: fb.company, module: fb.module, actor: "agent", feedback_id: fb.id, after: qn.text, detail: { options: qn.options, model: model || null } });
  return question;
}
// who: { role, name, person }; via: asker | device | manager.
async function answerQuestion({ company, feedbackId, answer, who, via }) {
  const text = clip(answer, 500);
  if (text.length < 1) throw fail(400, "pick an answer, or say it in your own words");
  const upd = (await q(
    `UPDATE platform.feedback SET question = question || $3::jsonb, updated_at=now()
      WHERE id=$1 AND company=$2 AND question IS NOT NULL AND NOT (question ? 'answer') AND status='new' AND duplicate_of IS NULL RETURNING *`,
    [Number(feedbackId), company, JSON.stringify({ answer: text, answered_at: new Date().toISOString(), answered_by: (who && who.name) || (via === "manager" ? "The manager" : null), answered_role: (who && who.role) || null, answered_person: (who && who.person) || null, via })])).rows[0];
  if (!upd) {
    const fb = (await q("SELECT question, status FROM platform.feedback WHERE id=$1 AND company=$2", [Number(feedbackId), company])).rows[0];
    if (!fb) throw fail(404, "no such request");
    throw fail(409, fb.question && fb.question.answer ? "that one is already answered, thank you" : "there is no question waiting on this one");
  }
  await record("question_answered", { company, module: upd.module, actor: { role: (who && who.role) || (via === "manager" ? "manager" : "floor"), name: (who && who.name) || null, person: (who && who.person) || null }, feedback_id: upd.id, before: upd.question.text, after: text, detail: { via, options: upd.question.options } });
  // draft the proposal with the answer, behind the response
  setImmediate(() => inOrder(`${upd.company}/${upd.module}`, async () => {
    await q("UPDATE platform.feedback SET arrival='proposing' WHERE id=$1", [upd.id]);
    try { await require("./proposals").generateProposal(upd.id, { answered: true }); await q("UPDATE platform.feedback SET arrival='done' WHERE id=$1", [upd.id]); }
    catch (e) { await q("UPDATE platform.feedback SET arrival='failed' WHERE id=$1", [upd.id]); await require("./credit").noteFailure(e.message, `the proposal for request #${upd.id}`); console.error(`[arrival] #${upd.id} after its answer: ${e.message}`); }
  }));
  return { request: upd.id, answer: text };
}
// May this caller see and answer the question on this request? person: the signed-in person or null; token: what the sending device holds.
function mayReply(fb, person, token) {
  if (!fb || !fb.question || fb.question.answer || fb.status !== "new" || fb.duplicate_of) return false;
  if (fb.person_id) return Boolean(person && Number(person.id) === Number(fb.person_id));
  return Boolean(token && fb.reply_token && token === fb.reply_token);
}

module.exports = { init, SCHEMA, PER_HOUR, PHOTOS_PER_DAY, OPEN, clip, cleanElement, elementLine, candidatesBlock, cleanQuestion, tally, candidates, photoBlocks, settings, newToken, linkDuplicate, recount, unlink, claim, work, start, onArrival, ask, answerQuestion, mayReply };
