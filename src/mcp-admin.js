// The admin MCP: what Anetix's own connected AI app can read (2026-10-05, docs/MCP.md; Brendan chose "operations,
// read only"). Each tool is a thin wrapper over what a tab of /admin already reads, so there is one formula for a
// number wherever it is shown. Nothing here changes anything.
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
  instructions: "Anetix's own view across every company on this instance: demos, paying sites, loop health, AI spend, requests to Anetix and build runs. Read only: nothing here changes anything. It never returns a record from a company's tools. Dollar figures are AI spend unless they say otherwise. Why a build stopped is given as a kind, never the failing line.",
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

// ---- the tools --------------------------------------------------------------------------------------------------------
const tools = [
  {
    name: "list_companies", title: "Companies",
    description: "Every company on the instance, one line each: whether it is a paying site or a trial, its tools and their live versions, open requests, builds, this month's AI spend, when it last did anything, and whether its data is walled off from Anetix's AI. Start here to get a company's slug.",
    input: {},
    async run() {
      const kind = require("./kind"), agent = require("./agent");
      const companies = (await q("SELECT slug, name, demo, created_at, ai_reads_data, test_floor, monthly_cap_usd FROM platform.companies ORDER BY created_at")).rows;
      const modules = (await q("SELECT company, name, title, live_version, staged_version FROM platform.modules ORDER BY company, created_at")).rows;
      const fb = (await q("SELECT company, count(*) FILTER (WHERE status='new')::int AS open, count(*)::int AS total FROM platform.feedback GROUP BY company")).rows;
      const runs = (await q("SELECT company, count(*)::int AS builds, count(*) FILTER (WHERE status='deployed')::int AS deployed, count(*) FILTER (WHERE status IN ('running','queued','waiting'))::int AS in_flight FROM platform.build_runs GROUP BY company")).rows;
      const last = (await q("SELECT company, max(created_at) AS at FROM platform.record GROUP BY company")).rows;
      const spend = await agent.spendSince(null);
      const by = (rows, slug) => rows.find((r) => r.company === slug);
      const out = [];
      for (const c of companies) out.push({
        slug: c.slug, name: c.name, kind: (await kind.isSite(c.slug)) ? "paying site" : "trial", came_in_from_anetix_ai: Boolean(c.demo), created_at: c.created_at,
        walled_off_from_ai: c.ai_reads_data === false, test_floor: Boolean(c.test_floor),
        tools: modules.filter((m) => m.company === c.slug).map((m) => ({ name: m.name, title: m.title, live_version: m.live_version, preview_waiting: m.staged_version != null && m.staged_version !== m.live_version })),
        requests: pick(by(fb, c.slug) || { open: 0, total: 0 }, ["open", "total"]), builds: pick(by(runs, c.slug) || { builds: 0, deployed: 0, in_flight: 0 }, ["builds", "deployed", "in_flight"]),
        ai_spend_this_month_usd: money(spend.by[c.slug] || 0), ai_budget_usd: c.monthly_cap_usd == null ? null : Number(c.monthly_cap_usd), last_activity: (by(last, c.slug) || {}).at || null,
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
      return {
        ...demoOut(d),
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
];

module.exports = { surface, tools, demoOut, demoRunOut, siteOut, runOut, SITE_KEYS };
