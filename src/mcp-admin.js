// The admin MCP: what Anetix's own connected AI app can read (2026-10-05, docs/MCP.md; Brendan chose "operations,
// read only"). Each tool is a thin wrapper over what a tab of /admin already reads, so there is one formula for a
// number wherever it is shown. Nothing in THIS file changes anything.
//
// Since 2026-10-06 the address also carries the new tool request tools of src/mcp-intake.js, four of which write
// (Brendan: write a tooling request in from a call or tour transcript). They are the only tools that change
// anything, they run only on a connection that was allowed to write, and the rules below still hold for every one.
//
// What a tool here never returns, and why:
//   - a row from a company's tool, an upload, a photo, an attachment: this is operations, and what lands in an AI
//     app's conversation is in front of a model (the data wall and the Terms both speak to that);
//   - a tool's code or a diff;
//   - the words of a failed check or a stopped build. A failed check can quote the record it choked on, so why a
//     build stopped is given as its KIND (gate, reviewer, tests, campaign, ai, other) and never the line itself;
//   - a secret of any kind: an access pin, a Stripe id, a card, an address someone signed in from.
// What it does carry: words people typed TO Anetix or into the loop during a demo (a request, an intake's answers),
// the same words the Demos and Requests tabs show. A paying site that did not opt in to learning stops at the day
// it went live, by the rule src/demos.js already keeps.
//
// A tool: { name, title, description, input (a zod shape), run(args, who) -> data }. src/mcp.js turns the data into
// the answer, logs the call and catches what a tool throws. Throw say("...") for the caller's mistake: those words
// go back to the app; anything else is logged and answered with a plain "that did not work".
const { z } = require("zod");
const { q } = require("./db");

const say = (message) => Object.assign(new Error(message), { say: true });
const SLUG = /^[a-z0-9][a-z0-9-]{1,40}$/;
const money = (v) => (v == null ? null : Math.round(Number(v) * 100) / 100);
const slugArg = (v) => { const s = String(v || "").trim().toLowerCase(); if (!SLUG.test(s)) throw say("That is not a company's short name. list_companies gives each company's slug."); return s; };
const pick = (o, keys) => { const out = {}; for (const k of keys) if (o && o[k] !== undefined) out[k] = o[k]; return out; };

const surface = {
  server: "anetix-admin", title: "Anetix admin",
  instructions: "Anetix's own view across every company on this instance: demos, paying sites, loop health, AI spend, requests to Anetix, build runs, and for a review of the last few hours: everything done on the boards (activity_since), the requests on them (list_board_requests) and Ask Anetix conversations (list_assistant_conversations). Read only, with one exception: the new tool request tools (start_tool_request, answer_tool_request, send_tool_request, change_tool_request_design) start and fill in a company's new tool request from a call or a plant walk, when the connection was allowed to write. Fill a request only from what the conversation settled, in the company's own words, and say what is missing instead of making an answer up. Nothing here confirms a design, builds, or puts anything on a floor: a manager does that on the board. It never returns a record from a company's tools. Dollar figures are AI spend unless they say otherwise. Why a build stopped is given as a kind, never the failing line.",
};

// ---- pure: what leaves --------------------------------------------------------------------------------------------
// A demo's summary without its access pin (a pin makes a company; its label is enough to say whose it was).
function demoOut(d) {
  if (!d) return d;
  const { pin, ...rest } = d;
  return { ...rest, pin: pin ? { id: pin.id, label: pin.label } : null };
}
// A build as the Demos tab holds it, with the stop's words replaced by its kind.
function demoRunOut(r, stopKind) {
  const { error, ...rest } = r;
  return { ...rest, stopped: error ? stopKind(error) : null };
}
// A site row: what the Sites tab shows, without Stripe's ids, the card, the billing contact and the street address.
const SITE_KEYS = ["slug", "name", "demo", "stage", "stage_label", "standing", "standing_label", "cancel_at", "site_name", "legal_name", "plant_manager", "headcount", "sqft",
  "price_book", "deal", "note", "order_open", "demo_holder", "demo_since", "tools", "tools_live", "ai_spent_usd", "credit_percent", "credit_level", "last_activity", "updated_at", "updated_by", "fair_use", "attention"];
function siteOut(r) {
  const out = pick(r, SITE_KEYS);
  out.band = r.band || null;
  out.order = r.order ? { ...pick(r.order, ["id", "state", "version", "kind", "band", "price_usd", "signed_at", "card_saved", "note", "created_at", "updated_at"]),
    signer: r.order.signer ? pick(r.order.signer, ["name", "title"]) : null,
    activate: r.order.activate ? { attempts: r.order.activate.attempts, declined: Boolean(r.order.activate.declined), failed: Boolean(r.order.activate.last_error) } : null } : null;
  out.subscription = r.subscription ? pick(r.subscription, ["activated_at", "period_start", "period_end", "learning_opt_in", "tenancy_note", "standing", "cancel_at"]) : null;
  return out;
}
// A build run for list_runs: where it is, what it cost, what it changed in plain words, and each stop as a kind.
function runOut(r, health) {
  const times = health.runTimes(r), ev = r.evidence || {};
  return {
    id: r.id, company: r.company, module: r.module, lane: r.lane, step: r.step, status: r.status, model: r.model, from_version: r.from_version, to_version: r.to_version,
    cost_usd: money(r.cost_usd), created_at: r.created_at, updated_at: r.updated_at, title: ev.title || null, what_changed: ev.what_changed || null,
    ready_at: times.ready, deployed_at: times.deployed, rolled_back_at: times.rolledBack, stops: times.stops,
  };
}


// ---- the audit (2026-10-12, Brendan: "review all changes made across all boards, including any feedback or things to
// change. Audit of chatbot notes and all that stuff ... I need a way to stay very close on what inputs are being made
// and immediately addressing any challenges"). Three tools a scheduled review calls every few hours. The same lines
// hold as above: words people typed into the loop come back, a tool's records, a failed check's words, a tool's code
// and a system review's findings do not. A paying site that did not opt in to learning stops at the day it went live.
const WORDLESS = new Set(["check_verdict", "review_findings", "doc_saved"]);   // the kind and who, never the words
const NEVER = ["chat_question", "chat_answer"];                               // a chat persona can quote a tool's records; Ask Anetix has its own tool below
const RECORD_TOOLS = new Set(["read_records", "summarize_records"]);         // an Ask Anetix answer after one of these can quote records
const cut = (v, n = 1200) => (v == null ? null : String(v).length > n ? String(v).slice(0, n) + " [cut]" : String(v));
function sinceArg(since, hours, fallbackHours) {
  if (since) { const d = new Date(since); if (isNaN(d)) throw say("since is a date and time, like 2026-10-12T15:00:00Z."); return d; }
  return new Date(Date.now() - (hours || fallbackHours) * 3600e3);
}
// a paying site with no learning opt-in: the day it went live, after which its activity is its own
async function untilBySlug() {
  const rows = (await q("SELECT company, converted_at FROM platform.sites WHERE converted_at IS NOT NULL AND NOT COALESCE(learning_opt_in, false)").catch(() => ({ rows: [] }))).rows;
  return new Map(rows.map((r) => [r.company, r.converted_at]));
}
const keep = (until, slug, at) => { const u = until.get(slug); return !u || new Date(at) < new Date(u); };
// A request a company's connected AI app filed that no manager has reviewed yet (feedback.held, src/mcp-company.js):
// the app may read the company's records and could have pasted them in, so its words wait for a manager here too.
const HELD = "(sent from the company's connected AI app; its words show here once a manager has reviewed it on the board)";
async function heldIds(company) {
  return new Set((await q("SELECT id FROM platform.feedback WHERE held AND ($1::text IS NULL OR company=$1)", [company || null])).rows.map((r) => r.id));
}
const DETAIL_KEYS = ["round", "verdict", "by", "decision", "answer", "scope", "lane", "from", "to", "via", "follow_up_id", "asked_by", "kind", "rules"];
function activityOut(r, held = new Set()) {
  if (r.feedback_id && held.has(Number(r.feedback_id))) return { ...activityOut({ ...r, feedback_id: null }), feedback_id: r.feedback_id, before: null, words: HELD };
  const words = !WORDLESS.has(r.kind);
  return {
    id: r.id, at: r.created_at, company: r.company, tool: r.module, kind: r.kind, who: r.actor_name || r.actor_role || null, role: r.actor_role,
    feedback_id: r.feedback_id, proposal_id: r.proposal_id, run_id: r.run_id, intake_id: r.intake_id, version: r.version,
    before: words ? cut(r.before, 600) : null, words: words ? cut(r.after) : null, detail: pick(r.detail || {}, DETAIL_KEYS),
  };
}

// ---- the tools --------------------------------------------------------------------------------------------------------
const tools = [
  {
    name: "list_companies", title: "Companies",
    description: "Every company on the instance, one line each: whether it is a paying site or a trial, its tools and their live versions, open requests, builds, this month's AI spend, when it last did anything, whether its data is walled off from Anetix's AI, and its own connected AI apps (how many, and whether they may read records). Start here to get a company's slug.",
    input: {},
    async run() {
      const kind = require("./kind"), agent = require("./agent");
      const companies = (await q("SELECT slug, name, demo, created_at, ai_reads_data, test_floor, monthly_cap_usd FROM platform.companies ORDER BY created_at")).rows;
      const modules = (await q("SELECT company, name, title, live_version, staged_version FROM platform.modules ORDER BY company, created_at")).rows;
      const fb = (await q("SELECT company, count(*) FILTER (WHERE status='new')::int AS open, count(*)::int AS total FROM platform.feedback GROUP BY company")).rows;
      const runs = (await q("SELECT company, count(*)::int AS builds, count(*) FILTER (WHERE status='deployed')::int AS deployed, count(*) FILTER (WHERE status IN ('running','queued','waiting'))::int AS in_flight FROM platform.build_runs GROUP BY company")).rows;
      const last = (await q("SELECT company, max(created_at) AS at FROM platform.record GROUP BY company")).rows;
      const spend = await agent.spendSince(null);
      const apps = await require("./mcp-company").adminSummary();
      const by = (rows, slug) => rows.find((r) => r.company === slug);
      const out = [];
      for (const c of companies) out.push({
        slug: c.slug, name: c.name, kind: (await kind.isSite(c.slug)) ? "paying site" : "trial", came_in_from_anetix_ai: Boolean(c.demo), created_at: c.created_at,
        walled_off_from_ai: c.ai_reads_data === false, test_floor: Boolean(c.test_floor),
        tools: modules.filter((m) => m.company === c.slug).map((m) => ({ name: m.name, title: m.title, live_version: m.live_version, preview_waiting: m.staged_version != null && m.staged_version !== m.live_version })),
        requests: pick(by(fb, c.slug) || { open: 0, total: 0 }, ["open", "total"]), builds: pick(by(runs, c.slug) || { builds: 0, deployed: 0, in_flight: 0 }, ["builds", "deployed", "in_flight"]),
        ai_spend_this_month_usd: money(spend.by[c.slug] || 0), ai_budget_usd: c.monthly_cap_usd == null ? null : Number(c.monthly_cap_usd), last_activity: (by(last, c.slug) || {}).at || null,
        connected_apps: apps[c.slug] ? { may_connect: apps[c.slug].may_connect, connections: apps[c.slug].connections, reads_records: apps[c.slug].records_on, locked_by_anetix: apps[c.slug].records_locked } : null,
      });
      return { companies: out, ai_spend_this_month_usd: money(spend.total) };
    },
  },
  {
    name: "list_demos", title: "Demos",
    description: "The Demos tab: every company that came in from anetix.ai, with what it paid, what it spent on AI, what it built, where it is stuck, and the use case each new-tool request described. Money here is real dollars paid for credit and AI spend against it.",
    input: {},
    async run() {
      const d = await require("./demos").list();
      return { ...d, demos: (d.demos || []).map(demoOut) };
    },
  },
  {
    name: "get_demo", title: "One demo in detail",
    description: "One company from the Demos tab in full: its new-tool requests with the answers given and the design agreed, every request and what became of it, every build (a stopped build gives the kind of stop, not the failing line), the credit ledger, AI spend by kind, and the most recent lines of its record. For a site that went live without opting in to learning, this stops at the day it went live.",
    input: { company: z.string().describe("The company's slug, from list_companies or list_demos") },
    async run({ company }) {
      const health = require("./health");
      const d = await require("./demos").detail(slugArg(company));
      if (!d) throw say("No demo by that slug. list_demos names the ones there are.");
      const held = await heldIds(d.slug || slugArg(company));
      return {
        ...demoOut(d),
        ...(Array.isArray(d.feedback) ? { feedback: d.feedback.map((f) => (held.has(f.id) ? { ...f, message: HELD } : f)) } : {}),
        runs: (d.runs || []).map((r) => demoRunOut(r, health.stopKind)),
        ledger: (d.ledger || []).map((l) => pick(l, ["id", "kind", "delta_usd", "paid_usd", "note", "made_by", "created_at"])),   // not the Stripe reference
        // what a chat persona was asked and answered can quote a tool's records: those two kinds stay out
        timeline: (d.timeline || []).filter((r) => !/^chat_/.test(r.kind)).slice(0, 150),
      };
    },
  },
  {
    name: "list_sites", title: "Sites pipeline",
    description: "The Sites tab: every company on its way from a demo to a paying site, with its stage, payment standing, band and monthly price, the open order, headcount and floor space, where it stands against the fair-use line, and what needs attention. Also the current price book.",
    input: {},
    async run() {
      const p = await require("./sites").pipeline();
      return { stages: p.stages, stage_labels: p.stage_labels, needs_attention: p.attention, fair_use_alerts: p.alerts, cancelling: p.cancelling, price_book: p.book, sites: (p.rows || []).map(siteOut) };
    },
  },
  {
    name: "loop_health", title: "Loop health",
    description: "The Health tab's numbers for the improvement loop: requests filed and open, what managers approved, declined and edited, builds started, shipped and rolled back, where builds stopped by kind, fix rounds, hours from request to the floor, what the floor and the manager said after a change shipped, and AI spend. For the whole fleet and per company.",
    input: { days: z.union([z.literal(0), z.literal(7), z.literal(30), z.literal(90), z.literal(365)]).optional().describe("The window in days; 0 is all time. Default 30."), company: z.string().optional().describe("A company's slug, to get only that company beside the fleet") },
    async run({ days, company }) {
      const h = await require("./health").forAdmin(days === undefined ? 30 : days);
      if (!company) return h;
      const slug = slugArg(company), one = h.companies.filter((c) => c.slug === slug);
      if (!one.length) throw say("No company by that slug. list_companies names them.");
      return { ...h, companies: one };
    },
  },
  {
    name: "ai_spend", title: "AI spend",
    description: "What the instance is spending on AI right now: the last hour, the last 24 hours and this month, the companies spending most in the last hour, this month by company, the alert thresholds and the most recent alerts sent, and the balance on the AI key with its projected runout.",
    input: {},
    async run() {
      const sw = require("./spendwatch"), agent = require("./agent");
      const [view, snap, month, credit] = await Promise.all([sw.view(), sw.snapshot().catch(() => null), agent.spendSince(null), require("./credit").status().catch(() => null)]);
      return {
        now: view.now, last_hour_by_company: snap ? snap.companies.map((c) => ({ company: c.company, usd: money(c.usd) })) : [],
        this_month_usd: money(month.total), this_month_by_company: Object.entries(month.by).map(([c, usd]) => ({ company: c, usd: money(usd) })).sort((a, b) => b.usd - a.usd),
        alert_thresholds: view.settings, recent_alerts: view.recent, ai_key_credit: credit,
      };
    },
  },
  {
    name: "list_requests_to_anetix", title: "Requests to Anetix",
    description: "The Requests tab: what companies' people asked Anetix about the software itself, with the words they wrote, the screen it came from, the stage Anetix has it at, and any note sent back. Newest first.",
    input: { status: z.enum(["open", "closed", "all"]).optional().describe("Default open"), limit: z.number().int().min(1).max(300).optional().describe("How many, newest first. Default 50.") },
    async run({ status, limit }) {
      const r = await require("./requests").list(status || "open");
      return { open: r.open, untouched: r.untouched, requests: r.requests.slice(0, limit || 50) };
    },
  },
  {
    name: "list_stopped_builds", title: "Stopped demo builds",
    description: "A demo's builds that stopped before a preview and had their AI spend handed back: which company and tool, at which step, the kind of stop (or that the AI service was down), the refund, and what Anetix did about each. Open ones first.",
    input: {},
    async run() {
      const health = require("./health");
      const out = (r) => ({ ...pick(r, ["id", "company", "company_name", "run_id", "module", "lane", "step", "ai_down", "refunded_usd", "created_at", "addressed_at", "addressed_by", "note"]), stopped: r.ai_down ? "ai" : health.stopKind(r.why) });
      const s = await require("./demostops").list();
      return { open: s.open.map(out), addressed: s.addressed.map(out) };
    },
  },
  {
    name: "list_runs", title: "Build runs",
    description: "Recent build runs across the instance or for one company: the tool, where the run is, its status, the model, the versions, the cost, the change in plain words, when it was ready, went live or was rolled back, and each stop as a kind (gate, reviewer, tests, campaign, ai, other). Newest first.",
    input: {
      company: z.string().optional().describe("A company's slug; leave out for every company"),
      status: z.enum(["queued", "running", "waiting", "failed", "cancelled", "deployed", "rolled_back", "stacked"]).optional(),
      days: z.number().int().min(1).max(365).optional().describe("How far back. Default 7."),
      limit: z.number().int().min(1).max(200).optional().describe("How many, newest first. Default 50."),
    },
    async run({ company, status, days, limit }) {
      const health = require("./health");
      const slug = company ? slugArg(company) : null;
      const rows = (await q(`SELECT id, company, module, lane, step, status, model, from_version, to_version, cost_usd, created_at, updated_at, evidence, log
                               FROM platform.build_runs WHERE ($1::text IS NULL OR company=$1) AND ($2::text IS NULL OR status=$2) AND created_at > now() - make_interval(days => $3::int)
                              ORDER BY id DESC LIMIT $4`, [slug, status || null, days || 7, limit || 50])).rows;
      return { runs: rows.map((r) => runOut(r, health)) };
    },
  },
  {
    name: "activity_since", title: "Everything since",
    description: "Every step taken on every company's board since a time, oldest first, from the interaction record: requests filed in the words written, proposals the AI drafted and how managers edited, approved or declined them, requirements, builds finished and summarized, Change it on a preview with the manager's words, checks (verdict only, never the words), what went live or was rolled back, the floor's 'did it fix it' and the manager's close-out, new-tool intakes, questions the AI asked and the answers. Ask Anetix conversations are in list_assistant_conversations. Use it to review what happened in the last few hours.",
    input: {
      since: z.string().optional().describe("A date and time (ISO 8601). Leave out to use hours."),
      hours: z.number().int().min(1).max(168).optional().describe("How far back, when since is left out. Default 6."),
      company: z.string().optional().describe("A company's slug; leave out for every company"),
      limit: z.number().int().min(1).max(2000).optional().describe("The most lines. Default 300; when more is true, ask again with since set to the last line's at."),
    },
    async run({ since, hours, company, limit }) {
      const from = sinceArg(since, hours, 6), slug = company ? slugArg(company) : null, max = limit || 300;
      const until = await untilBySlug();
      const rows = (await q(`SELECT r.*, c.name AS company_name FROM platform.record r LEFT JOIN platform.companies c ON c.slug=r.company
                               WHERE r.created_at >= $1 AND ($2::text IS NULL OR r.company=$2) AND r.kind <> ALL($3::text[]) ORDER BY r.id LIMIT $4`, [from, slug, NEVER, max + 1])).rows
        .filter((r) => keep(until, r.company, r.created_at));
      const more = rows.length > max, lines = rows.slice(0, max);
      const held = await heldIds(slug);
      const byCompany = {};
      for (const r of lines) { const b = byCompany[r.company] || (byCompany[r.company] = { company: r.company, name: r.company_name, lines: 0, kinds: {} }); b.lines++; b.kinds[r.kind] = (b.kinds[r.kind] || 0) + 1; }
      return { since: from, lines: lines.length, more, companies: Object.values(byCompany), activity: lines.map((r) => activityOut(r, held)),
        left_out: "Ask Anetix (list_assistant_conversations); a chat persona's questions and answers; the words of checks, system reviews and saved agent docs; a paying site's activity after it went live without the learning opt-in" };
    },
  },
  {
    name: "list_assistant_conversations", title: "Ask Anetix conversations",
    description: "What people asked Ask Anetix, the assistant on the board, and what it answered, since a time, by conversation: who, which company, the scope (Anetix help, one tool, the whole company), demo or live, every question in the words typed, each answer with the tools it used, the request card it drafted and whether it was sent to Reviewing, thumbs up or down with the reason, failures, and the AI spend. An answer that read a tool's records is withheld (the tools it used still show); read it on the board's admin view if needed.",
    input: {
      since: z.string().optional().describe("A date and time (ISO 8601). Leave out to use hours."),
      hours: z.number().int().min(1).max(168).optional().describe("How far back, when since is left out. Default 6."),
      company: z.string().optional().describe("A company's slug; leave out for every company"),
      limit: z.number().int().min(1).max(200).optional().describe("The most conversations. Default 60."),
    },
    async run({ since, hours, company, limit }) {
      const from = sinceArg(since, hours, 6), slug = company ? slugArg(company) : null;
      const until = await untilBySlug();
      const convs = (await q(`SELECT c.id, c.company, co.name AS company_name, c.owner_name, c.owner_role, c.scope_kind, c.scope_module, c.title, c.demo, c.created_at, c.updated_at, m.title AS tool_title
                                FROM platform.assist_conversations c LEFT JOIN platform.companies co ON co.slug=c.company LEFT JOIN platform.modules m ON m.company=c.company AND m.name=c.scope_module
                               WHERE c.owner_key <> 'eval' AND ($2::text IS NULL OR c.company=$2)
                                 AND EXISTS (SELECT 1 FROM platform.assist_messages x WHERE x.conversation_id=c.id AND x.created_at >= $1)
                               ORDER BY c.updated_at DESC LIMIT $3`, [from, slug, limit || 60]).catch(() => ({ rows: [] }))).rows.filter((c) => keep(until, c.company, c.created_at));
      if (!convs.length) return { since: from, conversations: [], totals: { conversations: 0, questions: 0, thumbs_down: 0, failed: 0, cards_sent: 0 } };
      const ids = convs.map((c) => c.id);
      const msgs = (await q(`SELECT id, conversation_id, role, text, status, card, thumbs, thumbs_reason, scripted, cost_usd, created_at FROM platform.assist_messages
                               WHERE conversation_id = ANY($1::int[]) AND created_at >= $2 ORDER BY id`, [ids, from])).rows;
      const calls = (await q("SELECT message_id, tool, ok FROM platform.assist_calls WHERE conversation_id = ANY($1::int[]) AND at >= $2 ORDER BY id", [ids, from])).rows;
      const used = new Map();
      for (const k of calls) { const l = used.get(k.message_id) || []; l.push(k.ok ? k.tool : `${k.tool} (refused)`); used.set(k.message_id, l); }
      const totals = { conversations: convs.length, questions: 0, thumbs_down: 0, failed: 0, cards_sent: 0, ai_usd: 0 };
      const out = convs.map((c) => ({
        id: c.id, company: c.company, company_name: c.company_name, person: c.owner_name, role: c.owner_role, demo: c.demo,
        scope: c.scope_kind === "tool" ? `tool: ${c.tool_title || c.scope_module}` : c.scope_kind === "help" ? "Anetix help" : "whole company", started: c.created_at,
        messages: msgs.filter((m) => m.conversation_id === c.id).map((m) => {
          if (m.role === "user") { totals.questions++; return { at: m.created_at, asked: cut(m.text, 2000) }; }
          const tools = used.get(m.id) || [], withheld = tools.some((x) => RECORD_TOOLS.has(String(x).split(" ")[0]));
          if (m.thumbs === -1) totals.thumbs_down++;
          if (m.status === "failed") totals.failed++;
          if (m.card && m.card.state === "filed") totals.cards_sent++;
          totals.ai_usd += Number(m.cost_usd || 0);
          return { at: m.created_at, status: m.status, answered: withheld ? null : cut(m.text, 2000), withheld: withheld ? "it read the tool's records" : undefined, set_answer: m.scripted || undefined, tools,
            card: m.card ? { tool: m.card.tool_title || m.card.tool, what: cut(m.card.what, 600), state: m.card.state, feedback_id: m.card.feedback_id || null } : null,
            thumbs: m.thumbs === 1 ? "up" : m.thumbs === -1 ? "down" : null, thumbs_reason: m.thumbs_reason || null, cost_usd: money(m.cost_usd) };
        }),
      }));
      totals.ai_usd = money(totals.ai_usd);
      return { since: from, totals, conversations: out };
    },
  },
  {
    name: "list_board_requests", title: "Requests on the boards",
    description: "The requests on companies' improvement boards (changes to their own tools and new-tool requests, not requests to Anetix): the words written, who sent it and from which screen, where it is (new, reviewing, in progress, done, declined), what came of it, a question the AI is waiting on, a duplicate or follow-up it is tied to, whether the floor said it fixed it and the manager's close-out. Open ones by default, oldest waiting first, so what is stuck shows at the top.",
    input: {
      status: z.enum(["open", "new", "reviewing", "in_progress", "done", "declined", "all"]).optional().describe("Default open (new, reviewing and in progress)"),
      company: z.string().optional().describe("A company's slug; leave out for every company"),
      days: z.number().int().min(1).max(365).optional().describe("Only requests touched in the last N days. Default 30."),
      limit: z.number().int().min(1).max(500).optional().describe("Default 150."),
    },
    async run({ status, company, days, limit }) {
      const slug = company ? slugArg(company) : null, st = status || "open";
      const want = st === "open" ? ["new", "reviewing", "in_progress"] : st === "all" ? null : [st];
      const until = await untilBySlug();
      const rows = (await q(`SELECT f.id, f.company, co.name AS company_name, f.module, m.title AS tool_title, f.screen, f.kind, f.message, f.name, f.status, f.outcome, f.recurrence, f.source, f.held,
                                    f.follow_up_of, f.duplicate_of, f.triage, f.question, f.floor_answer, f.manager_answer, f.shipped_version, f.created_at, f.updated_at
                               FROM platform.feedback f LEFT JOIN platform.companies co ON co.slug=f.company LEFT JOIN platform.modules m ON m.company=f.company AND m.name=f.module
                              WHERE f.module IS DISTINCT FROM 'platform' AND ($1::text[] IS NULL OR f.status = ANY($1::text[])) AND ($2::text IS NULL OR f.company=$2)
                                AND f.updated_at > now() - make_interval(days => $3::int)
                              ORDER BY ${st === "open" ? "f.updated_at ASC" : "f.id DESC"} LIMIT $4`, [want, slug, days || 30, limit || 150])).rows.filter((r) => keep(until, r.company, r.created_at));
      const counts = {};
      for (const r of rows) { const c = counts[r.company] || (counts[r.company] = { company: r.company, name: r.company_name, new: 0, reviewing: 0, in_progress: 0, done: 0, declined: 0 }); if (c[r.status] !== undefined) c[r.status]++; }
      return { status: st, counts: Object.values(counts), requests: rows.map((r) => ({
        id: r.id, company: r.company, tool: r.tool_title || r.module, screen: r.screen, kind: r.kind, words: r.held ? HELD : cut(r.message, 2000), from: r.name || null, via: r.source === "mcp" ? "the company's connected app" : r.source || "board",
        status: r.status, outcome: cut(r.outcome, 600), times_asked: r.recurrence, follow_up_of: r.follow_up_of, duplicate_of: r.duplicate_of, triage: r.triage,
        waiting_on_an_answer: r.question && r.question.text && !r.question.answer ? cut(r.question.text, 400) : null,
        floor_said: r.floor_answer, manager_said: r.manager_answer, shipped_version: r.shipped_version, filed: r.created_at, last_moved: r.updated_at,
      })) };
    },
  },
];

// the new tool request tools: two that read, four that write (src/mcp-intake.js)
tools.push(...require("./mcp-intake").tools);

module.exports = { surface, tools, demoOut, demoRunOut, siteOut, runOut, SITE_KEYS, activityOut, heldIds, WORDLESS, NEVER, RECORD_TOOLS, HELD };
