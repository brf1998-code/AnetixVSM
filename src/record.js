// The interaction record: what everyone said and decided, word for word,
// tied to the build it led to and how it turned out. Product review of
// 2026-09-18, build order item 3.
//
// Why it exists. The most useful data this product makes is "the AI wrote X,
// the manager changed it to Y, the floor said it worked". Until this file the
// manager's edit overwrote the AI's proposal in place, a decline logged no
// event, and nothing said who acted. This table keeps every step as a new
// row: the text before, the text after, who, when, and the ids that tie it to
// the feedback item, proposal, run, version or intake.
//
// Rules.
//   Insert only. A trigger refuses UPDATE and DELETE (platform.record_guard);
//   a correction is a new row. The one way to remove rows is deleting the
//   company, which sets a transaction-local flag the trigger honours, because
//   the plant owns its record and a deleted plant takes it along.
//   Best effort. record() never throws: a failure to write the record must
//   never stop the loop. It logs and moves on.
//   Per company. Every row carries the company; cross-plant use is a
//   separate, opt-in, anonymized copy that does not exist yet.
//
// Kinds (actor_role says who: floor, manager, admin, agent, platform):
//   feedback_filed, feedback_closed
//   proposal_drafted (agent), proposal_edited (before/after), proposal_approved, proposal_declined
//   requirement_drafted (agent), requirement_confirmed (before = drafted, after = confirmed)
//   review_all (the manager sent every waiting request to the proposer: detail.asked, detail.started)
//   build_finished (agent summary), build_summarized (platform plain summary), check_verdict (gate or reviewer)
//   run_fixed, run_overridden, run_retried, run_cancelled, run_reworked (Change it at the gate: before = what the preview
//   did, after = the manager's words)
//   deployed, rolled_back, version_switched
//   review_started, review_findings (a system review)
//   intake_answered, intake_round, intake_design, intake_adjusted (before/after), intake_revised (the points before/after,
//   the changes asked for in detail), intake_confirmed, intake_abandoned
//   intake_sent, intake_taken_over (Anetix through a connected app, src/mcp-intake.js: a round sent to the agent; a
//   manager's unfinished request taken over). An answer written that way is an intake_answered row with actor_role
//   admin and the account's name.
//   mcp_connected, mcp_disconnected, mcp_records_on, mcp_records_off (the manager's switch), mcp_records_locked,
//   mcp_records_unlocked (Anetix's lock), mcp_request_released (a manager's tap let the AI read a request a connected
//   app filed; that filing is a feedback_filed row with detail.via "mcp"), src/mcp-company.js
//   doc_saved (before/after an agent doc), doc_deleted, models_changed
//   label_set (the checks log), chat_question, chat_answer (a module's chat persona)
//   map_changed (a box of the value stream map: before/after the fields changed), stage_changed (a stage on the map's
//   coverage list), map_question_answered (before = the claim, after = the answer), map_imported (src/vsm.js);
//   the mapping walk (src/vsm-walk.js): map_walk_started, map_source_added / map_source_removed (the title),
//   map_walk_reading, map_walk_read, map_walk_answered, map_walk_step (before/after: a step's card), map_drafted,
//   map_walk_reopened, map_walk_back_to_sources, map_walk_used, map_walk_abandoned;
//   the agent board (src/vsm-agents.js): agent_set_up, agent_changed, agent_watch_added, agent_watch_changed, agent_flag,
//   agent_flag_cleared, agent_flag_climbed, agent_flag_seen / _on_it / _resolved / _not_a_problem / _reopen,
//   agent_board_message; its reviews (src/vsm-review.js, A2): agent_review (detail: what it posted, the model, the
//   cost), agent_review_failed, agent_review_asked, agent_brief_drafted, agent_settings_changed (the shift times),
//   agent_draft_dismissed (a draft sent is feedback_filed, via agent_board); drafts across tools (src/vsm-drafts.js,
//   A3): agent_record_drafted, agent_draft_taken, agent_draft_declined (actor: the person on the tool's screen),
//   agent_draft_withdrawn, agent_drafts_floor (the floor switch per tool). A box's steps change with map_changed.
//
// Who (2026-10-15). actor_role is the session's role. actor_name is the person signed in on the device, else a name the
// caller passed, else the named account behind the session. actor_account is that account's id whenever the session
// has one. Until this date only a filed request carried the account's name (2026-09-26), so an approval, a deploy, a
// close-out or a new tool request's answers made from a named manager or admin account went on the record with no name,
// and a Chelsea Clock record of 718 rows could not say which manager had done what. A row with a human role and no
// actor_account came from a shared password (or from before this date).
const { q, pool } = require("./db");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS platform.record (
  id          BIGSERIAL PRIMARY KEY,
  company     TEXT NOT NULL,
  module      TEXT,
  kind        TEXT NOT NULL,
  actor_role  TEXT,
  actor_name  TEXT,
  feedback_id INTEGER,
  proposal_id INTEGER,
  run_id      INTEGER,
  intake_id   INTEGER,
  version     INTEGER,
  before      TEXT,
  after       TEXT,
  detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE platform.record ADD COLUMN IF NOT EXISTS actor_person INTEGER;
ALTER TABLE platform.record ADD COLUMN IF NOT EXISTS actor_account INTEGER;
CREATE INDEX IF NOT EXISTS record_company_time ON platform.record (company, created_at);
CREATE INDEX IF NOT EXISTS record_feedback ON platform.record (feedback_id) WHERE feedback_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS record_run ON platform.record (run_id) WHERE run_id IS NOT NULL;
CREATE OR REPLACE FUNCTION platform.record_guard() RETURNS trigger AS $$
BEGIN
  IF current_setting('sos.record_delete', true) = 'company' AND TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'platform.record is insert-only; a correction is a new row';
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS record_no_change ON platform.record;
CREATE TRIGGER record_no_change BEFORE UPDATE OR DELETE ON platform.record FOR EACH ROW EXECUTE FUNCTION platform.record_guard();
`;

async function init() { await q(SCHEMA); }

const clip = (s, n = 20000) => (s == null ? null : String(s).slice(0, n));

// The one write. `actor` is { role, name, person, account, account_name } (from a request: actor(req)), or a
// string role for the agent and the platform. Never throws.
async function record(kind, fields = {}) {
  try {
    const actor = typeof fields.actor === "string" ? { role: fields.actor } : fields.actor || {};
    await q(
      `INSERT INTO platform.record (company, module, kind, actor_role, actor_name, feedback_id, proposal_id, run_id, intake_id, version, before, after, detail, actor_person, actor_account)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [fields.company, fields.module || null, kind, actor.role || null, clip(actor.name || actor.account_name, 120),
       fields.feedback_id || null, fields.proposal_id || null, fields.run_id || null, fields.intake_id || null, fields.version || null,
       clip(fields.before), clip(fields.after), JSON.stringify(fields.detail || {}), actor.person || null, actor.account || null]);
  } catch (e) {
    console.error(`[record] could not write ${kind} for ${fields.company}:`, e.message);
  }
}

// Who is acting, from a request: the role in the session, and a name when the
// request carries one (the name typed with feedback; a person, once operators
// have an identity).
// A person signed in on the device (src/people.js: name and PIN) wins over a
// name typed into a box.
// account / account_name (2026-10-15, see "Who" at the top of this file): the
// named account behind the session (src/auth.js req.sosAccount), for the record
// only. `name` is left as it was because callers show it to the company (a
// close-out's "by" reads "The manager" or "Anetix" when it is empty).
function actor(req, name) {
  const acct = (req && req.sosAccount) || null;
  return {
    role: (req && req.sosRole) || null,
    name: (req && req.sosPerson) || name || null,
    person: (req && req.sosPersonId) || null,
    account: (acct && acct.id) || null,
    account_name: (acct && (acct.name || acct.login)) || null,
  };
}

// Read back: a company's record, newest first, optionally one kind or one
// feedback item's thread. The plant owns this; a manager can export it.
async function list(company, { kind, feedback_id, run_id, limit = 500, before_id } = {}) {
  const where = ["company=$1"]; const vals = [company];
  if (kind) { vals.push(kind); where.push(`kind=$${vals.length}`); }
  if (feedback_id) { vals.push(Number(feedback_id)); where.push(`feedback_id=$${vals.length}`); }
  if (run_id) { vals.push(Number(run_id)); where.push(`run_id=$${vals.length}`); }
  if (before_id) { vals.push(Number(before_id)); where.push(`id<$${vals.length}`); }
  vals.push(Math.min(5000, Math.max(1, Number(limit) || 500)));
  return (await q(`SELECT * FROM platform.record WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT $${vals.length}`, vals)).rows;
}

// Deleting a company takes its record with it (the one sanctioned delete).
// The flag the trigger honours is transaction-local, so this runs on one
// connection inside its own transaction.
async function deleteCompany(company) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL sos.record_delete = 'company'");
    const r = await client.query("DELETE FROM platform.record WHERE company=$1", [company]);
    await client.query("COMMIT");
    return r.rowCount;
  } catch (e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
}

module.exports = { init, record, actor, list, deleteCompany, SCHEMA };
