// The test campaign: a step of every build, between the platform's checks and the deploy gate, for a company whose
// test floor is on (docs/TEST-ENVIRONMENT.md, Brendan 2026-09-24). Proposed by the AI, approved by the manager, run
// by the platform on the test floor (src/testfloor.js), and partly done by a person there with the platform
// watching. Semi-automated on purpose: the point is the manager and the floor seeing the tools interact.
//
// Lifecycle (platform.test_campaigns.status):
//   proposing   the design model reads the new version, what changed, the tools that read it and the ones it
//               reads, its connections and its checks, and proposes title, summary, a data set and 3 to 12 cases
//   proposed    waiting on the manager: keep or drop cases, add one in their own words, pick the data, Run or Skip
//   preparing   the tool under test goes on the test floor at the build's version; every tool's test tables are
//               rebuilt from the chosen data
//   running     the auto cases run, in order, against the test mounts only (src/acceptance.js runCheck with bases)
//   walking     the guided cases wait on a person: each "do" step is shown on the test page it names; the platform
//               asks its "then" every few seconds and marks the step seen; Done and Not right close a step by hand
//   passed | failed | waived | skipped | cancelled
// A case is a check (GUARDRAILS "Checks") with three additions: "module" on a step (a sibling tool: an "across"
// case), "do" steps for guided cases ({ do, on, module?, then?, within? }), and nothing in it is a promise: cases
// live here, never in checks/, so no agent can write, edit or retire one.
//
// The run: step "campaign", status running while the platform works and waiting while a person is asked for
// something; a failed campaign fails the run at that step (fix, retry, deploy anyway, cancel apply). A fix round
// runs the same campaign again on its own once the checks pass again (attempt + 1; the manager does not approve
// the cases twice; guided steps are done again).
//
// Routes (id-addressed under /api/runs/:id, so auth.companyGuard scopes them):
//   GET  /api/runs/:id/campaign                                   the campaign as the card draws it
//   POST /api/runs/:id/campaign/approve  { cases, data, added }   manager, fresh PIN: Run the campaign
//   POST /api/runs/:id/campaign/skip     { reason }               manager: no campaign this time (a waiver)
//   POST /api/runs/:id/campaign/waive    { reason }               manager, fresh PIN: deploy anyway after a fail
//   POST /api/runs/:id/campaign/steps/:case/:n  { answer, what }  manager: done | not_right on a guided step
//   GET  /api/c/:slug/who/campaign?module=&page=                   any device of the company (a module page's policy
//                                                                 opens /who): the guided steps for that screen
//   POST /api/c/:slug/who/campaign/steps/:campaign/:case/:n       the same answer from the test page itself
// Record kinds: campaign_proposed, campaign_approved, campaign_skipped, campaign_started, campaign_case,
// campaign_step, campaign_passed, campaign_failed, campaign_waived.
const express = require("express");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { q, logEvent } = require("./db");
const { record, actor } = require("./record");
const agent = require("./agent");
const acceptance = require("./acceptance");
const registry = require("./registry");
const testfloor = require("./testfloor");
const plain = require("./plainwords");
const modulesource = require("./modulesource");
const auth = require("./auth");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS platform.test_campaigns (
  id           SERIAL PRIMARY KEY,
  company      TEXT NOT NULL,
  module       TEXT NOT NULL,
  run_id       INTEGER,
  version      INTEGER,
  status       TEXT NOT NULL DEFAULT 'proposing',
  attempt      INTEGER NOT NULL DEFAULT 1,
  title        TEXT,
  summary      TEXT,
  proposed     JSONB,
  cases        JSONB,
  data_choice  TEXT,
  results      JSONB,
  verdict_line TEXT,
  waived       JSONB,
  model        TEXT,
  cost_usd     NUMERIC(10,4) NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS test_campaigns_run ON platform.test_campaigns (run_id, id DESC);
CREATE INDEX IF NOT EXISTS test_campaigns_module ON platform.test_campaigns (company, module, id DESC);`;
async function init() { await q(SCHEMA); }

const MAX_CASES = 12, MAX_GUIDED = 4, MAX_DO = 6, WITHIN_DEFAULT = 600, WITHIN_MAX = 3600, WITHIN_MIN = 30;
const AREAS = ["inside", "across", "connection", "role"];
const OPEN = ["proposing", "proposed", "preparing", "running", "walking"];
const fail = (status, msg) => Object.assign(new Error(msg), { status });
const clip = (s, n) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);
const DASH = /[–—]/;
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const pipe = () => require("./pipeline");

// ---- the format (pure) --------------------------------------------------------------------------------------
// proposed: the model's answer (or the manager's addition). modules: the tools that are on the test floor (the
// tool under test included). -> { cases, data, problems, dropped: [{ id, why }] }. A case with a problem is
// dropped with the reason, never kept half right; the campaign goes on with the rest.
function parse(proposed, { modules = [], self } = {}) {
  const out = { cases: [], data: { source: "floor", why: "", made: null }, problems: [], dropped: [] };
  if (!isObj(proposed)) { out.problems.push("the proposal is an object with title, summary, data and cases"); return out; }
  const d = isObj(proposed.data) ? proposed.data : {};
  out.data.source = d.source === "made" && isObj(d.made) && Object.keys(d.made).length ? "made" : "floor";
  out.data.why = clip(d.why, 300);
  if (out.data.source === "made") {
    const made = {};
    for (const [mod, tables] of Object.entries(d.made)) {
      if (!modules.includes(mod)) { out.problems.push(`the data set names "${mod}", which is not on the test floor; that part was left out`); continue; }
      if (isObj(tables) && Object.keys(tables).length) made[mod] = tables;
    }
    if (!Object.keys(made).length) out.data.source = "floor"; else out.data.made = made;
  }
  const list = Array.isArray(proposed.cases) ? proposed.cases.slice(0, MAX_CASES) : [];
  if (!list.length) out.problems.push("no cases");
  let guided = 0, n = 0;
  for (const c of list) {
    n++;
    const id = typeof c.id === "string" && /^[a-z0-9_-]{1,16}$/i.test(c.id) ? c.id : `c${n}`;
    const why = [];
    if (!isObj(c)) { out.dropped.push({ id, why: "not a case" }); continue; }
    const title = clip(c.title, 160);
    if (title.length < 8) why.push("the title is one plain sentence of at least 8 characters");
    if (DASH.test(title)) why.push("no long dashes in a title");
    const area = AREAS.includes(c.area) ? c.area : null;
    const kind = c.kind === "guided" ? "guided" : "auto";
    const steps = Array.isArray(c.steps) ? c.steps : [];
    if (!steps.length) why.push("no steps");
    const kept = [];
    if (kind === "auto") {
      for (const s of steps) if (isObj(s) && s.do != null) why.push("an auto case has no \"do\" step; make it a guided case");
      const p = acceptance.parse("checks/001-campaign-case.json", { title: title.padEnd(8, "."), steps }, { allowModule: true });
      for (const pr of p.problems) if (!/^the name is/.test(pr)) why.push(pr);
      for (const s of steps) if (isObj(s) && s.module != null && !modules.includes(String(s.module))) why.push(`the tool "${s.module}" is not on the test floor`);
      kept.push(...steps);
    } else {
      if (steps.length > MAX_DO) why.push(`a guided case has at most ${MAX_DO} steps`);
      steps.forEach((s, i) => {
        const at = `step ${i + 1}`;
        if (!isObj(s) || typeof s.do !== "string") { why.push(`${at}: a guided step says what to do ("do")`); return; }
        const doText = clip(s.do, 300);
        if (doText.length < 8) why.push(`${at}: "do" is one plain sentence of at least 8 characters`);
        if (DASH.test(doText)) why.push(`${at}: no long dashes`);
        const on = typeof s.on === "string" ? s.on : "/";
        const pp = acceptance.pathProblem(on); if (pp) why.push(`${at}: the screen path ${pp}`);
        if (s.module != null && !modules.includes(String(s.module))) why.push(`${at}: the tool "${s.module}" is not on the test floor`);
        let then = null;
        if (s.then != null) {
          if (!isObj(s.then) || s.then.call == null) why.push(`${at}: "then" is one call step (call, expect)`);
          else {
            const tp = acceptance.parse("checks/001-campaign-case.json", { title: "watch....", steps: [s.then] }, { allowModule: true });
            for (const pr of tp.problems) if (!/^the name is/.test(pr)) why.push(`${at}, then: ${pr}`);
            if (s.then.module != null && !modules.includes(String(s.then.module))) why.push(`${at}, then: the tool "${s.then.module}" is not on the test floor`);
            then = s.then;
          }
        }
        let within = Number(s.within);
        if (!Number.isFinite(within)) within = WITHIN_DEFAULT;
        within = Math.min(WITHIN_MAX, Math.max(WITHIN_MIN, Math.round(within)));
        kept.push({ do: doText, on, ...(s.module ? { module: String(s.module) } : {}), ...(then ? { then } : {}), within });
      });
      guided++;
      if (guided > MAX_GUIDED) why.push(`at most ${MAX_GUIDED} guided cases`);
    }
    if (why.length) { out.dropped.push({ id, title, why: why.slice(0, 4).join("; ") }); if (kind === "guided") guided--; continue; }
    out.cases.push({ id, title, why: clip(c.why, 300) || null, area: area || (kind === "guided" ? "inside" : kept.some((s) => s.module && s.module !== self) ? "across" : "inside"), kind, steps: kept });
  }
  const ids = new Set();
  out.cases = out.cases.filter((c) => { if (ids.has(c.id)) return false; ids.add(c.id); return true; });
  return out;
}
// What a person reads on the card: counts.
function counts(cases) {
  const list = Array.isArray(cases) ? cases : [];
  return { total: list.length, guided: list.filter((c) => c.kind === "guided").length, across: list.filter((c) => c.area === "across").length };
}
// The verdict from the results (pure): every auto case ok, every guided step closed (seen, done or not right), no
// case failed. -> { done, ok, failed: [...] }
function verdictOf(cases, results) {
  const by = new Map(((results && results.cases) || []).map((r) => [r.id, r]));
  const failed = [];
  let done = true;
  for (const c of cases || []) {
    const r = by.get(c.id);
    if (!r) { done = false; continue; }
    if (c.kind === "auto") { if (r.ok === false) failed.push(c.id); if (r.ok == null) done = false; continue; }
    for (const st of r.steps || []) {
      if (st.state === "not_right") failed.push(c.id);
      else if (!["seen", "done"].includes(st.state)) done = false;
    }
    if ((r.steps || []).length < c.steps.length) done = false;
  }
  // a failed case does not end the campaign early: the person still does their steps and sees the rest, and the
  // verdict comes once everything is closed (the manager may deploy anyway over one bad case)
  return { done, ok: done && !failed.length, failed: [...new Set(failed)] };
}

// ---- reads ----------------------------------------------------------------------------------------------------
async function get(id) { return (await q("SELECT * FROM platform.test_campaigns WHERE id=$1", [id])).rows[0] || null; }
async function forRun(runId) { return (await q("SELECT * FROM platform.test_campaigns WHERE run_id=$1 ORDER BY id DESC LIMIT 1", [runId])).rows[0] || null; }
async function lastOnModule(company, mod, notId) {
  return (await q("SELECT * FROM platform.test_campaigns WHERE company=$1 AND module=$2 AND status IN ('passed','failed','waived') AND id <> $3 ORDER BY id DESC LIMIT 1", [company, mod, notId || 0])).rows[0] || null;
}
async function set(id, fields) {
  const keys = Object.keys(fields);
  await q(`UPDATE platform.test_campaigns SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(", ")}, updated_at=now() WHERE id=$1`,
    [id, ...keys.map((k) => (fields[k] !== null && typeof fields[k] === "object" ? JSON.stringify(fields[k]) : fields[k]))]);
}
// The shape the board and the checks page draw. Never the model's raw answer.
function publicView(c) {
  if (!c) return null;
  const cases = c.cases || (c.status === "proposed" && c.proposed ? c.proposed.cases : []) || [], results = c.results || { cases: [] };
  const by = new Map((results.cases || []).map((r) => [r.id, r]));
  return {
    id: c.id, run_id: c.run_id, module: c.module, version: c.version, status: c.status, attempt: c.attempt, title: c.title, summary: c.summary,
    data_choice: c.data_choice, data: c.proposed && c.proposed.data ? { source: c.proposed.data.source, why: c.proposed.data.why, tables: c.proposed.data.made ? Object.fromEntries(Object.entries(c.proposed.data.made).map(([m, t]) => [m, Object.fromEntries(Object.entries(t).map(([tb, rows]) => [tb, rows.length]))])) : null } : null,
    counts: counts(cases), dropped: (c.proposed && c.proposed.dropped) || [],
    cases: c.cases ? cases.map((k) => ({ ...k, result: by.get(k.id) || null })) : [],
    proposed_cases: c.status === "proposed" && c.proposed ? c.proposed.cases : undefined,
    verdict_line: c.verdict_line, waived: c.waived, started_at: results.started_at || null, ended_at: results.ended_at || null, cost_usd: Number(c.cost_usd || 0),
  };
}
// per run id, for the board payload
async function forBoard(company) {
  const rows = (await q("SELECT DISTINCT ON (run_id) * FROM platform.test_campaigns WHERE company=$1 AND run_id IS NOT NULL ORDER BY run_id, id DESC", [company])).rows;
  const out = {};
  for (const r of rows) out[r.run_id] = publicView(r);
  return out;
}
async function listForModule(company, mod, limit = 20) {
  return (await q("SELECT * FROM platform.test_campaigns WHERE company=$1 AND module=$2 ORDER BY id DESC LIMIT $3", [company, mod, limit])).rows.map(publicView);
}

// ---- the proposal ------------------------------------------------------------------------------------------
const SCHEMA_OUT = {
  type: "object",
  properties: {
    title: { type: "string", description: "At most 12 words: what this campaign proves. Plain words." },
    summary: { type: "string", description: "Two to four sentences for the manager: what will be tried, which other tools are involved, what a person will do on the test floor." },
    data: {
      type: "object",
      properties: {
        source: { type: "string", enum: ["floor", "made"], description: "floor = a fresh copy of the floor's rows (the default); made = the rows below, when the change needs a state the floor may not have (an empty list, a busy shift, an edge case)." },
        why: { type: "string", description: "One sentence: why this data." },
        made: { type: "object", description: "Only with source made: { \"<tool>\": { \"<table>\": [ { column: value, ... } ] } }. Columns exactly as the tool's migrations name them; plain values; at most 200 rows a table. Leave a table out to keep its seed rows.", additionalProperties: true },
      },
      required: ["source", "why"],
    },
    cases: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "c1, c2, ..." },
          title: { type: "string", description: "One plain sentence: what this case proves. A manager reads it." },
          why: { type: "string", description: "One sentence: why it matters for this change." },
          area: { type: "string", enum: ["inside", "across", "connection", "role"], description: "inside = the tool itself; across = what another tool sees or what this one reads from another; connection = a printer, a spreadsheet, the ERP; role = what the floor may and may not do." },
          kind: { type: "string", enum: ["auto", "guided"], description: "auto = the platform runs it (calls and pages); guided = a person does it on the test floor and the platform watches." },
          steps: { type: "array", items: { type: "object", additionalProperties: true }, description: "auto: check steps (call or page, as, body, expect, save, module). guided: { do, on, module, then, within } steps." },
        },
        required: ["id", "title", "area", "kind", "steps"],
      },
    },
  },
  required: ["title", "summary", "data", "cases"],
};
function formatBrief(self, modules) {
  return `THE CASE FORMAT. A case is a check in the format below, with three additions.
1. Any step may carry "module": "<tool>" to be made against another tool that is on the test floor (${modules.join(", ")}); without it the step goes to "${self}", the tool under test. A step against another tool is what makes a case "across".
2. A guided case ("kind": "guided") has "do" steps instead: { "do": "<one plain sentence saying what the person does and on which screen>", "on": "<the screen's path inside the tool, like /station/1>", "module": "<tool, optional>", "then": { "call": "GET /api/...", "module": "<tool, optional>", "as": "manager", "expect": { ... } }, "within": 300 }. The person does it; the platform asks "then" every few seconds for up to "within" seconds and marks the step seen when it matches. A "do" with no "then" is a plain tick. Every "do" step should have a "then" where anything at all can be watched: a row that appears, a count that moves, a label job that was queued. At most 4 guided cases, at most 6 steps each.
3. Nothing here is a promise. Cases do not go into checks/. A case may write rows: it runs on the test floor, whose data is thrown away.

Check steps: { "call": "METHOD /path" } or { "page": "/path" }, "as": "manager" (default) or "floor", "body": JSON for a POST, "expect": { "status", "json" (matched as a SUBSET with $type $gte $lte $gt $lt $in $regex $exists $length $minLength $contains $every $not), "contains", "lacks"; on a page also "visible", "selector" }, "save": { "name": "path.into.answer" } then {name} later. 1 to 12 steps; the first that fails stops the case. Paths are inside the tool, exactly as its pages call them after the base. Never an address, never "..".

Cover, in this order, and only what this change makes worth proving: the change itself in the order a shift would meet it; what each tool that reads this one sees afterwards (their peer reads); what this tool reads from the others; each connection it has (a lookup answers, a status reads, a label job queues; never a real print in an auto case, a guided case may print one and say a label will come out); what the floor may and may not do ("as": "floor"); one guided case per screen the change touched, with a watch. Do not repeat what the tool's own checks already prove; add what they do not. Titles and every "do" sentence in plain words a manager reads: no API, database, table, column, endpoint, JSON, migration, deploy, server, token, prompt. Use the company's own names for its systems.`;
}
async function siblingsBrief(company, self) {
  const mods = (await q("SELECT name, title, live_version FROM platform.modules WHERE company=$1 AND name <> $2 AND live_version IS NOT NULL ORDER BY name", [company, self])).rows;
  const parts = [];
  for (const m of mods) {
    const files = (await registry.versionFiles(company, m.name, m.live_version)) || {};
    let manifest = {}; try { manifest = JSON.parse(files["module.json"] || "{}"); } catch (e) { /* unreadable */ }
    const routes = String(files["routes.js"] || "");
    const peerLines = routes.split("\n").filter((l) => /peer\s*\(/.test(l)).map((l) => l.trim().slice(0, 200)).slice(0, 12);
    const reads = /peer\s*\(\s*["'`]([^"'`]+)["'`]/g; const targets = new Set(); let mm; while ((mm = reads.exec(routes))) targets.add(mm[1]);
    const doc = (await q("SELECT content FROM platform.agent_docs WHERE company=$1 AND module=$2 AND name='reference.md'", [company, m.name])).rows[0];
    const apis = [...routes.matchAll(/router\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g)].map((x) => `${x[1].toUpperCase()} ${x[2]}`).slice(0, 40);
    parts.push(`### ${m.title} ("${m.name}", version ${m.live_version})${targets.has(self) ? ` READS "${self}" through peer` : ""}\nScreens: ${Object.entries(manifest.pages || {}).map(([r, v]) => `${r} (${typeof v === "string" ? v : v.label || v.file})`).join(", ") || "none"}\nCalls: ${apis.join(", ") || "none listed"}\nSmoke paths: ${(manifest.smoke || []).join(", ") || "none"}\n${peerLines.length ? `Lines that read another tool:\n${peerLines.join("\n")}\n` : ""}${doc ? `Reference:\n${String(doc.content).slice(0, 2500)}` : ""}`);
  }
  return { text: parts.join("\n\n") || "This company has no other tool on the floor.", names: mods.map((m) => m.name) };
}
async function diffText(run) {
  const to = registry.versionDir(run.company, run.module, run.to_version);
  if (!run.from_version) return require("./modulebuild").listingAsDiff(to).slice(0, 60000);   // a walled company's new module seeds no rows (modulebuild.skeleton)
  const from = registry.versionDir(run.company, run.module, run.from_version);
  try { return execFileSync("diff", ["-ruN", from, to], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }).slice(0, 60000); }
  catch (e) { return String(e.stdout || "").slice(0, 60000); }
}
function fakeProposal(run, manifest, siblings, attempt, words) {
  const smoke = (manifest.smoke || []).filter((p) => /^\/api\//.test(p));
  const first = smoke[0] || "/";
  const failing = /CAMPAIGNFAIL/.test(words) && attempt === 1;
  const cases = [
    { id: "c1", title: "The first screen opens and every call the tool lists answers", area: "inside", kind: "auto", steps: [{ page: "/", expect: { status: 200 } }, ...smoke.map((p) => ({ call: `GET ${p}`, expect: { status: 200 } }))] },
    { id: "c2", title: failing ? "A made-up rule that cannot hold (fake mode, first attempt only)" : "A floor device can read the tool's first list", area: "role", kind: "auto", steps: [{ call: `GET ${first}`, as: "floor", expect: { status: failing ? 599 : 200 } }] },
  ];
  if (siblings.length) cases.push({ id: "c3", title: `The ${siblings[0]} tool still answers beside this one on the test floor`, area: "across", kind: "auto", steps: [{ page: "/", module: siblings[0], expect: { status: 200 } }] });
  cases.push({ id: "c4", title: "Open the first screen on the test floor and look at it", why: "Fake mode: a guided case with a watch the platform sees at once.", area: "inside", kind: "guided",
    steps: [{ do: "Open the first screen of this tool on the test floor and look at it", on: "/", ...(/CAMPAIGNNOWATCH/.test(words) ? {} : { then: { call: `GET ${first}`, expect: { status: 200 } } }), within: 120 }] });
  const made = /CAMPAIGNMADE/.test(words) && run.module === "paperline" ? { source: "made", why: "Fake mode: two open requests to start from.", made: { paperline: { material_requests: [{ item: "paper_white", qty: 1, requested_by: "Made up" }, { item: "paper_white", qty: 1, requested_by: "Made up" }] } } } : { source: "floor", why: "Fake mode: a copy of the floor's rows." };
  return { data: { title: `Fake campaign for ${run.module} v${run.to_version}`, summary: `Fake-mode test campaign: ${cases.length} cases, one you do yourself. (SOS_FAKE_AGENT=1)`, data: made, cases }, costUsd: 0 };
}
async function requestWords(run) {
  const ids = run.proposal_ids || [run.proposal_id];
  const rows = (await q("SELECT f.message FROM platform.proposals p JOIN platform.feedback f ON f.id=p.feedback_id WHERE p.id = ANY($1::int[])", [ids])).rows;
  return rows.map((r) => r.message || "").join(" ");
}
async function propose(run, camp) {
  const { company, module: mod } = run;
  const walled = await require("./datawall").isWalled(company);
  const files = require("./datawall").filesForModel((await registry.versionFiles(company, mod, run.to_version)) || {}, walled);
  let manifest = {}; try { manifest = JSON.parse(files["module.json"] || "{}"); } catch (e) { /* unreadable */ }
  const sib = await siblingsBrief(company, mod);
  const modules = [mod, ...sib.names];
  const model = await pipe().modelForRun(run, "design");
  const words = await requestWords(run);
  let data, costUsd;
  if (agent.fakeMode()) {
    // the files a real call would read are logged (the data wall's canary test reads the log); the campaign is canned
    await agent.atWall("structured:campaign", { company, model, prompt: `${clip(words, 2000)}\n\n${await diffText(run)}\n\n${modulesource.sourceText(files, { first: [] }).text}\n\n${sib.text}` });
    ({ data, costUsd } = fakeProposal(run, manifest, sib.names, camp.attempt, words));
  } else {
    const src = modulesource.sourceText(files, { first: [] });
    const { checks } = acceptance.collect(files);
    const last = await lastOnModule(company, mod, camp.id);
    const conns = Object.entries(manifest.connections || {}).map(([n, c]) => `${n} (${c.kind}${c.label ? `: ${c.label}` : ""})`).join(", ") || "none";
    const ev = run.evidence || {};
    const prompt = `Tool under test: "${manifest.title || mod}" ("${mod}"), version ${run.to_version}${run.from_version ? ` replacing version ${run.from_version} on the floor` : ", a brand-new tool"}. Lane: ${run.lane}.

WHAT WAS ASKED, in the floor's words:
${clip(words, 2000) || "(no request words)"}

THE REQUIREMENT the build was held to:
${clip(run.requirement || (ev.design_bluf || ""), 6000) || "(a look-and-feel change: the request above is the requirement)"}

WHAT THE BUILD SAYS IT CHANGED:
${clip(ev.what_changed || ev.build_summary, 1500) || "(no summary)"}

THE DIFF against the floor's version:
${await diffText(run)}

THE TOOL'S FILES, whole (version ${run.to_version}):
${src.text}

CHECKS THE TOOL ALREADY CARRIES (promises the platform runs on every build; do not repeat them):
${checks.map((c) => `- ${c.file}: ${c.title}`).join("\n") || "none"}

CONNECTIONS DECLARED: ${conns}

THE OTHER TOOLS ON THIS COMPANY'S TEST FLOOR:
${sib.text}

${last ? `THE LAST CAMPAIGN ON THIS TOOL: "${last.title}" ${last.status} (${last.verdict_line || ""}). Do not repeat what held; go after what this change touches.\n\n` : ""}Return the campaign.`;
    const out = await agent.runStructured({
      model, company,
      system: `${walled ? require("./datawall").PROMPT_NOTE + "\n\n" : ""}You design a test campaign for a change to one tool of a factory operating system, to be run on the company's TEST FLOOR: every tool the company has, mounted together on a copy of data that is not the floor's, in one world, so what one tool reads from another is real there. The campaign has cases the platform runs itself and cases a person does on the test floor while the platform watches. The reader of every title and every "do" sentence is a production manager with no technical background, and the person doing a guided step may be on the floor with a tablet.\n\n${formatBrief(mod, modules)}\n\nPLAIN WORDS:\n${plain.rules()}`,
      prompt, schema: SCHEMA_OUT, toolName: "campaign", maxTokens: 16000,
    });
    data = out.data; costUsd = out.costUsd || 0;
  }
  const parsed = parse(data, { modules, self: mod });
  // plain words on what a person reads; a line that still fails is dropped
  const costBox = { usd: 0 };
  const rewrite = agent.fakeMode() ? null : await (async () => { const m = await agent.summaryModel(); return async (text, instructions) => { const r = await agent.runChat({ model: m, company, system: instructions, messages: [{ role: "user", content: text }], maxTokens: 2000 }); costBox.usd += r.costUsd || 0; return r.text; }; })();
  const allow = [];
  const clean = async (text) => { const r = await plain.scrub(text, { allow, rewrite }); return r.hits.length ? null : r.text; };
  const kept = [];
  for (const c of parsed.cases) {
    const title = await clean(c.title);
    if (!title) { parsed.dropped.push({ id: c.id, title: c.title, why: "the title did not pass the plain-words rules" }); continue; }
    c.title = title;
    if (c.kind === "guided") {
      let bad = false;
      for (const s of c.steps) { const d = await clean(s.do); if (!d) { bad = true; break; } s.do = d; }
      if (bad) { parsed.dropped.push({ id: c.id, title: c.title, why: "a step's wording did not pass the plain-words rules" }); continue; }
    }
    kept.push(c);
  }
  return { model, costUsd: costUsd + costBox.usd, title: clip(data && data.title, 120) || `Test campaign for ${mod} v${run.to_version}`, summary: clip(data && data.summary, 1200), data: parsed.data, cases: kept, dropped: parsed.dropped, problems: parsed.problems, modules };
}

// ---- the step in a build --------------------------------------------------------------------------------------
// Called by the pipeline after the platform's checks pass. On (the switch): the run goes to step "campaign" and a
// campaign is proposed (or the last approved one is run again after a fix round). Off: nothing, the caller goes on
// to the deploy gate. Returns true when the campaign step was taken.
async function begin(runId) {
  const P = pipe();
  const run = await P.getRun(runId);
  if (!run || !(await testfloor.isOn(run.company))) return false;
  const prev = await forRun(runId);
  await P.setRun(runId, { step: "campaign", status: "running" });
  if (prev && prev.cases && ["failed", "cancelled"].includes(prev.status) && prev.data_choice) {
    // the same campaign again, after a fix round: no second approval
    const camp = (await q(`INSERT INTO platform.test_campaigns (company, module, run_id, version, status, attempt, title, summary, proposed, cases, data_choice, model) VALUES ($1,$2,$3,$4,'preparing',$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [run.company, run.module, runId, run.to_version, prev.attempt + 1, prev.title, prev.summary, JSON.stringify(prev.proposed), JSON.stringify(prev.cases), prev.data_choice, prev.model])).rows[0];
    await P.setRun(runId, { evidence: { ...run.evidence, campaign_id: camp.id, campaign: undefined } });
    await P.log(runId, { step: "campaign", note: `the test campaign runs again after the fix (attempt ${camp.attempt}); the guided steps are done again` });
    execute(camp.id).catch((e) => console.error(`[campaign] #${camp.id}:`, e.message));
    return true;
  }
  const camp = (await q("INSERT INTO platform.test_campaigns (company, module, run_id, version, status, attempt) VALUES ($1,$2,$3,$4,'proposing',$5) RETURNING *",
    [run.company, run.module, runId, run.to_version, prev ? prev.attempt + 1 : 1])).rows[0];
  await P.setRun(runId, { evidence: { ...run.evidence, campaign_id: camp.id } });
  await P.log(runId, { step: "campaign", note: "the test floor is on: proposing a test campaign for this build" });
  let p;
  try { p = await propose(run, camp); }
  catch (e) { await set(camp.id, { status: "failed", verdict_line: `the campaign could not be proposed: ${clip(e.message, 300)}` }); throw Object.assign(new Error(`the test campaign could not be proposed: ${e.message}`), { costUsd: e.costUsd }); }
  await P.addCost(runId, p.costUsd);
  await agent.recordUsage(run.company, run.module, "campaign", p.model, p.costUsd, { run_id: runId, campaign_id: camp.id, cases: p.cases.length });
  if (!p.cases.length) {
    await set(camp.id, { status: "skipped", title: p.title, summary: p.summary, proposed: { data: p.data, cases: [], dropped: p.dropped, problems: p.problems }, model: p.model, cost_usd: p.costUsd, verdict_line: "no case could be proposed; the campaign was skipped" });
    await P.log(runId, { step: "campaign", note: `no usable case was proposed (${p.dropped.map((d) => d.why).slice(0, 3).join("; ") || p.problems.join("; ")}); on to the deploy gate` });
    await P.setRun(runId, { step: "await_deploy", status: "waiting", evidence: { ...(await P.getRun(runId)).evidence, campaign: { id: camp.id, status: "skipped", reason: "nothing to run" } } });
    return true;
  }
  await set(camp.id, { status: "proposed", title: p.title, summary: p.summary, proposed: { data: p.data, cases: p.cases, dropped: p.dropped, problems: p.problems, modules: p.modules }, model: p.model, cost_usd: p.costUsd });
  await P.setRun(runId, { status: "waiting" });
  const k = counts(p.cases);
  await P.log(runId, { step: "campaign", note: `test campaign proposed: ${k.total} case${k.total === 1 ? "" : "s"}${k.guided ? `, ${k.guided} for a person on the test floor` : ""}${k.across ? `, ${k.across} across tools` : ""}; waiting on the manager` });
  await record("campaign_proposed", { company: run.company, module: run.module, actor: "agent", run_id: runId, version: run.to_version, after: p.summary, detail: { campaign_id: camp.id, title: p.title, cases: p.cases.map((c) => ({ id: c.id, title: c.title, kind: c.kind, area: c.area })), dropped: p.dropped, data: p.data.source, model: p.model, cost_usd: p.costUsd } });
  return true;
}

// ---- the manager's answer ----------------------------------------------------------------------------------
async function approve(runId, { cases, data, added } = {}, who) {
  const P = pipe();
  const run = await P.getRun(runId);
  const camp = await forRun(runId);
  if (!run || !camp || run.step !== "campaign" || camp.status !== "proposed") throw fail(409, "this build is not waiting on a test campaign");
  const proposed = camp.proposed || { cases: [] };
  const keep = Array.isArray(cases) ? new Set(cases.map(String)) : null;
  const list = (proposed.cases || []).filter((c) => !keep || keep.has(c.id));
  const own = [];
  for (const a of Array.isArray(added) ? added.slice(0, 4) : []) {
    const doText = clip(a && a.do, 300), title = clip(a && a.title, 160) || doText.slice(0, 120);
    if (doText.length < 8) continue;
    const on = typeof (a && a.on) === "string" && !acceptance.pathProblem(a.on) ? a.on : "/";
    own.push({ id: `m${own.length + 1}`, title, why: "added by the manager", area: "inside", kind: "guided", steps: [{ do: doText, on, within: WITHIN_DEFAULT }] });
  }
  const all = list.concat(own);
  if (!all.length) throw fail(400, "keep at least one case, or skip the campaign");
  const choice = data === "made" && proposed.data && proposed.data.source === "made" ? "made" : "floor";
  await set(camp.id, { status: "preparing", cases: all, data_choice: choice, results: { cases: [], started_at: new Date().toISOString() } });
  await P.setRun(runId, { status: "running" });
  const k = counts(all);
  await P.log(runId, { step: "campaign", note: `${(who && who.name) || "the manager"} approved the campaign: ${k.total} case${k.total === 1 ? "" : "s"} (${(proposed.cases || []).length - list.length} dropped, ${own.length} added), ${choice === "made" ? "the made-up data" : "a copy of the floor's data"}` });
  await record("campaign_approved", { company: run.company, module: run.module, actor: who, run_id: runId, version: run.to_version, before: JSON.stringify((proposed.cases || []).map((c) => c.id)), after: JSON.stringify(all.map((c) => c.id)), detail: { campaign_id: camp.id, data: choice, added: own.map((c) => c.title) } });
  execute(camp.id).catch((e) => console.error(`[campaign] #${camp.id}:`, e.message));
  return publicView(await get(camp.id));
}
async function skip(runId, reason, who) {
  const P = pipe();
  const run = await P.getRun(runId);
  const camp = await forRun(runId);
  if (!run || !camp || run.step !== "campaign" || camp.status !== "proposed") throw fail(409, "this build is not waiting on a test campaign");
  const why = clip(reason, 500);
  if (!why) throw fail(400, "say why in a few words; it goes on the record");
  const waived = { kind: "skipped", reason: why, by: (who && who.name) || (who && who.role === "admin" ? "Anetix" : "The manager"), person: (who && who.person) || null, at: new Date().toISOString() };
  await set(camp.id, { status: "skipped", waived, verdict_line: `skipped by the manager: ${why}` });
  await P.setRun(runId, { step: "await_deploy", status: "waiting", evidence: { ...run.evidence, campaign: { id: camp.id, status: "skipped", waived } } });
  await P.log(runId, { step: "campaign", note: `campaign skipped by ${waived.by}: ${why}; on to the deploy gate` });
  await record("campaign_skipped", { company: run.company, module: run.module, actor: who, run_id: runId, version: run.to_version, after: why, detail: { campaign_id: camp.id } });
  return publicView(await get(camp.id));
}
// Deploy anyway, after a failed campaign: a waiver on the record, then the deploy gate.
async function waive(runId, reason, who) {
  const P = pipe();
  const run = await P.getRun(runId);
  const camp = await forRun(runId);
  if (!run || !camp || run.step !== "campaign" || run.status !== "failed" || camp.status !== "failed") throw fail(409, "only a build stopped by a failed test campaign can be deployed anyway");
  const why = clip(reason, 500);
  if (!why) throw fail(400, "say why in a few words; it goes on the record and on the shipped tile");
  const waived = { kind: "waived", reason: why, by: (who && who.name) || (who && who.role === "admin" ? "Anetix" : "The manager"), person: (who && who.person) || null, at: new Date().toISOString(), failed: (camp.results && camp.results.failed) || [] };
  await set(camp.id, { status: "waived", waived, verdict_line: `deployed anyway by the manager: ${why}` });
  await P.setRun(runId, { step: "await_deploy", status: "waiting", evidence: { ...run.evidence, campaign: { ...(run.evidence.campaign || {}), status: "waived", waived } } });
  await P.log(runId, { step: "campaign", note: `${waived.by} chose to deploy over the failed campaign: ${why}` });
  await record("campaign_waived", { company: run.company, module: run.module, actor: who, run_id: runId, version: run.to_version, after: why, detail: { campaign_id: camp.id, failed: waived.failed } });
  return publicView(await get(camp.id));
}

// ---- running it ---------------------------------------------------------------------------------------------
function bases(company, modules) {
  const origin = `http://127.0.0.1:${process.env.PORT || 3000}`;
  const out = {};
  for (const m of modules) out[m] = `${origin}/c/${company}/test/m/${m}`;
  return out;
}
async function cookiesFor(company) { return { manager: await auth.serviceCookie(company, "manager"), floor: await auth.serviceCookie(company, "floor") }; }
async function execute(campId) {
  const P = pipe();
  let camp = await get(campId);
  if (!camp || camp.status !== "preparing") return;
  const run = await P.getRun(camp.run_id);
  const { company, module: mod } = camp;
  const results = camp.results || { cases: [] };
  try {
    // the tool under test goes on the test floor at this version; every tool's data is rebuilt from the choice
    const made = camp.data_choice === "made" && camp.proposed && camp.proposed.data ? camp.proposed.data.made : null;
    await testfloor.setUnderTest(company, mod, camp.version, { rebuild: false });
    await testfloor.reset(company, { role: "platform", name: "the test campaign" }, made ? { source: "made", rows: made, note: (camp.proposed.data.why || camp.title || "").slice(0, 200), campaign_id: campId } : { source: "floor", campaign_id: campId });
    await P.log(run.id, { step: "campaign", note: `the test floor holds version ${camp.version} of ${mod} and ${camp.data_choice === "made" ? "the made-up data" : "a fresh copy of the floor's data"}; running the cases` });
    await record("campaign_started", { company, module: mod, actor: "platform", run_id: run.id, version: camp.version, detail: { campaign_id: campId, attempt: camp.attempt, data: camp.data_choice } });
    await set(campId, { status: "running" });
    const status = await testfloor.status(company);
    const up = status.modules.filter((m) => m.up).map((m) => m.name);
    const B = bases(company, up), C = await cookiesFor(company);
    const hideValues = await require("./datawall").isWalled(company);   // a failed case names paths and types, never what the answer held
    let browser = null;
    try { browser = await require("./pageload").session(`http://127.0.0.1:${process.env.PORT || 3000}`); } catch (e) { /* no browser: page steps skip visible/selector */ }
    try {
      for (const c of camp.cases) {
        if (c.kind !== "auto") continue;
        const r = await acceptance.runCheck({ file: c.id, title: c.title, steps: c.steps }, { base: B[mod], bases: B, cookies: C, browser, hideValues });
        // fake mode: the CAMPAIGNFAIL case stands in for a build a fix round put right; it passes from attempt 2
        if (agent.fakeMode() && camp.attempt > 1 && /first attempt only/.test(c.title)) { r.ok = true; r.steps = r.steps.map((x) => ({ ...x, ok: true, problems: [], note: "fake mode: passes from attempt 2" })); }
        results.cases.push({ id: c.id, kind: "auto", ok: r.ok, steps: r.steps, at: new Date().toISOString() });
        await set(campId, { results });
        await record("campaign_case", { company, module: mod, actor: "platform", run_id: run.id, version: camp.version, after: `${r.ok ? "passed" : "failed"}: ${c.title}`, detail: { campaign_id: campId, case: c.id, ok: r.ok, steps: r.steps } });
        // a fresh campaign is still one campaign: a stop here would hide the guided steps; the verdict waits for all
      }
    } finally { if (browser) await browser.close().catch(() => {}); }
    for (const c of camp.cases) if (c.kind === "guided") results.cases.push({ id: c.id, kind: "guided", steps: c.steps.map((s, i) => ({ n: i + 1, state: "waiting", since: new Date().toISOString() })) });
    await set(campId, { results });
    const v = verdictOf(camp.cases, results);
    if (v.done) return finish(campId);
    await set(campId, { status: "walking" });
    await P.setRun(run.id, { status: "waiting" });
    const g = camp.cases.filter((c) => c.kind === "guided").length;
    await P.log(run.id, { step: "campaign", note: `the platform's cases are done; ${g} guided case${g === 1 ? "" : "s"} wait${g === 1 ? "s" : ""} on a person on the test floor` });
    await tick(campId);
  } catch (e) {
    await set(campId, { status: "failed", verdict_line: `the campaign could not run: ${clip(e.message, 300)}`, results });
    await P.setRun(run.id, { evidence: { ...(await P.getRun(run.id)).evidence, campaign: { id: campId, status: "failed", error: clip(e.message, 300), failed: [] } } });
    await P.failRun(run.id, new Error(`test campaign failed: it could not run (${e.message})`));
  }
}
// One look at every open watch of a walking campaign. Called by the interval below and by the reads.
async function tick(campId) {
  const camp = await get(campId);
  if (!camp || camp.status !== "walking") return camp;
  const results = camp.results || { cases: [] };
  const status = await testfloor.status(camp.company);
  const B = bases(camp.company, status.modules.filter((m) => m.up).map((m) => m.name)), C = await cookiesFor(camp.company);
  let changed = false;
  for (const c of camp.cases) {
    if (c.kind !== "guided") continue;
    const r = results.cases.find((x) => x.id === c.id);
    if (!r) continue;
    for (const [i, s] of c.steps.entries()) {
      const st = r.steps[i];
      if (!st || st.state !== "waiting" || !s.then) continue;
      const started = new Date(st.since).getTime();
      if (Date.now() - started > s.within * 1000) { st.timed_out = true; continue; }   // the person's Done still closes it; the platform stops looking
      const look = await acceptance.runCheck({ file: `${c.id}-${i + 1}`, title: "watch", steps: [s.then] }, { base: B[s.module || camp.module], bases: B, cookies: C, browser: null });
      if (look.ok) {
        st.state = "seen"; st.at = new Date().toISOString(); st.saw = `${look.steps[0].step} answered ${look.steps[0].status}`; changed = true;
        await record("campaign_step", { company: camp.company, module: camp.module, actor: "platform", run_id: camp.run_id, version: camp.version, after: `seen: ${s.do}`, detail: { campaign_id: campId, case: c.id, n: i + 1, state: "seen", saw: st.saw } });
      }
    }
  }
  if (changed) await set(campId, { results });
  const v = verdictOf(camp.cases, results);
  if (v.done) return finish(campId);
  return camp;
}
async function answerStep(campId, caseId, n, { answer, what }, who) {
  const camp = await get(campId);
  if (!camp || camp.status !== "walking") throw fail(409, "this campaign is not waiting on anyone");
  const c = (camp.cases || []).find((x) => x.id === caseId && x.kind === "guided");
  const results = camp.results || { cases: [] };
  const r = results.cases.find((x) => x.id === caseId);
  const st = c && r && r.steps[Number(n) - 1];
  if (!c || !st) throw fail(404, "no such step");
  if (!["waiting", "seen"].includes(st.state)) throw fail(409, "that step is already closed");
  const by = (who && who.name) || (who && who.role === "manager" ? "The manager" : who && who.role === "admin" ? "Anetix" : "Someone on the floor");
  if (answer === "done") {
    if (st.state === "waiting") { st.state = "done"; st.at = new Date().toISOString(); }
    st.by = by; st.person = (who && who.person) || null;
  } else if (answer === "not_right") {
    const words = clip(what, 600);
    if (!words) throw fail(400, "say what you saw, in a few words");
    st.state = "not_right"; st.at = new Date().toISOString(); st.by = by; st.person = (who && who.person) || null; st.words = words;
  } else throw fail(400, "answer is done or not_right");
  await set(campId, { results });
  await record("campaign_step", { company: camp.company, module: camp.module, actor: who, run_id: camp.run_id, version: camp.version, after: `${st.state}: ${c.steps[Number(n) - 1].do}`, detail: { campaign_id: campId, case: caseId, n: Number(n), state: st.state, words: st.words || null } });
  const v = verdictOf(camp.cases, results);
  if (v.done) await finish(campId);
  return publicView(await get(campId));
}
async function finish(campId) {
  const P = pipe();
  const camp = await get(campId);
  if (!camp || !["running", "walking", "preparing"].includes(camp.status)) return camp;
  const results = camp.results || { cases: [] };
  results.ended_at = new Date().toISOString();
  const v = verdictOf(camp.cases, results);
  const byHand = results.cases.filter((r) => r.kind === "guided").reduce((a, r) => a + r.steps.filter((s) => s.state === "done").length, 0);
  const seen = results.cases.filter((r) => r.kind === "guided").reduce((a, r) => a + r.steps.filter((s) => s.state === "seen").length, 0);
  const names = [...new Set(results.cases.filter((r) => r.kind === "guided").flatMap((r) => r.steps.map((s) => s.by).filter(Boolean)))];
  const k = counts(camp.cases);
  const run = await P.getRun(camp.run_id);
  if (v.ok) {
    const line = `passed: ${k.total} case${k.total === 1 ? "" : "s"}${k.guided ? `, ${seen} step${seen === 1 ? "" : "s"} seen by the platform${byHand ? ` and ${byHand} done by hand` : ""}${names.length ? ` (${names.join(", ")})` : ""}` : ""}`;
    results.failed = [];
    await set(campId, { status: "passed", results, verdict_line: line });
    await P.setRun(run.id, { step: "await_deploy", status: "waiting", evidence: { ...run.evidence, campaign: { id: campId, status: "passed", line, attempt: camp.attempt, counts: k, by_hand: byHand, seen } } });
    await P.log(run.id, { step: "campaign", note: `test campaign ${line}; ready for the deploy gate` });
    await record("campaign_passed", { company: camp.company, module: camp.module, actor: "platform", run_id: run.id, version: camp.version, after: line, detail: { campaign_id: campId, attempt: camp.attempt, counts: k, by: names } });
    await testfloor.hooks.afterCampaign(camp.company).catch(() => {});
    return get(campId);
  }
  const failed = v.failed.map((id) => {
    const c = camp.cases.find((x) => x.id === id), r = results.cases.find((x) => x.id === id);
    if (c.kind === "auto") { const s = (r.steps || []).find((x) => !x.ok); return { id, title: c.title, kind: "auto", step: s ? `${s.step}${s.module ? ` (${s.module})` : ""}: ${s.problems.join("; ")}` : "did not pass" }; }
    const s = (r.steps || []).find((x) => x.state === "not_right"); const i = s ? r.steps.indexOf(s) : 0;
    return { id, title: c.title, kind: "guided", do: c.steps[i] && c.steps[i].do, words: s && s.words, by: s && s.by };
  });
  results.failed = failed;
  const line = `failed: ${failed.length} of ${k.total} case${k.total === 1 ? "" : "s"} did not pass${failed.some((f) => f.kind === "guided") ? " (a person said not right)" : ""}`;
  await set(campId, { status: "failed", results, verdict_line: line });
  await P.setRun(run.id, { evidence: { ...run.evidence, campaign: { id: campId, status: "failed", line, attempt: camp.attempt, counts: k, failed } } });
  await record("campaign_failed", { company: camp.company, module: camp.module, actor: "platform", run_id: run.id, version: camp.version, after: line, detail: { campaign_id: campId, attempt: camp.attempt, failed } });
  await P.failRun(run.id, new Error(`test campaign failed: ${failed.map((f) => `"${f.title}"`).join(", ")}`));
  return get(campId);
}
// What a fix round tells the agent (a new session: it sees only this). Worded as the platform, with a person's
// words verbatim.
function forAgent(camp) {
  const failed = (camp && camp.results && camp.results.failed) || [];
  if (!failed.length) return "";
  return failed.map((f) => (f.kind === "auto"
    ? `- The test campaign case "${f.title}" did not pass against your build on the test floor. ${f.step}. Work out which is wrong, the change or what the case expects, and fix the change; the case is the manager's and cannot be edited.`
    : `- A person doing the guided step "${f.do}" on the test floor said it was not right${f.by ? ` (${f.by})` : ""}. Their words: "${f.words}". Fix what they saw.`)).join("\n");
}
// The run was cancelled or deployed: the tool under test leaves the test floor's "under test" state.
async function afterRunEnds(run, how) {
  const camp = await forRun(run.id);
  if (camp && OPEN.includes(camp.status)) await set(camp.id, { status: "cancelled", verdict_line: `the build was ${how} while the campaign was ${camp.status}` });
  if (!(await testfloor.isOn(run.company))) return;
  const m = (await q("SELECT test_version FROM platform.modules WHERE company=$1 AND name=$2", [run.company, run.module])).rows[0];
  if (m && m.test_version != null && Number(m.test_version) === Number(run.to_version)) {
    await testfloor.setUnderTest(run.company, run.module, null, { rebuild: false }).catch((e) => console.error(`[campaign] ${run.company}/${run.module} back to the floor's version: ${e.message}`));
  }
}
// The switch going off: how many campaigns are running, and the builds waiting at the step go on to the gate.
async function runningOn(company) {
  return (await q("SELECT count(*)::int AS n FROM platform.test_campaigns WHERE company=$1 AND status IN ('proposing','preparing','running','walking')", [company])).rows[0].n;
}
async function releaseWaiting(company) {
  const P = pipe();
  const rows = (await q("SELECT * FROM platform.build_runs WHERE company=$1 AND step='campaign' AND status IN ('waiting','running')", [company])).rows;
  for (const run of rows) {
    const camp = await forRun(run.id);
    if (camp && OPEN.includes(camp.status)) await set(camp.id, { status: "skipped", verdict_line: "the test floor was switched off during this build; the campaign did not run" });
    await P.setRun(run.id, { step: "await_deploy", status: "waiting", evidence: { ...run.evidence, campaign: { id: camp ? camp.id : null, status: "skipped", reason: "the test floor was switched off" } } });
    await P.log(run.id, { step: "campaign", note: "the test floor was switched off during this build; the campaign did not run. On to the deploy gate" });
    await record("campaign_skipped", { company, module: run.module, actor: "platform", run_id: run.id, version: run.to_version, after: "the test floor was switched off", detail: { campaign_id: camp ? camp.id : null } });
  }
  return rows.length;
}
testfloor.hooks.running = runningOn;
testfloor.hooks.releaseWaiting = releaseWaiting;
testfloor.hooks.afterCampaign = async () => {};

// Watches: every walking campaign gets a look every WATCH_MS, whoever has a page open.
const WATCH_MS = Number(process.env.SOS_CAMPAIGN_WATCH_MS || 5000);
let ticking = false;
async function tickAll() {
  if (ticking) return;
  ticking = true;
  try {
    const rows = (await q("SELECT id FROM platform.test_campaigns WHERE status='walking'")).rows;
    for (const r of rows) await tick(r.id).catch((e) => console.error(`[campaign] watch #${r.id}: ${e.message}`));
  } finally { ticking = false; }
}
function startWatching() { setInterval(() => tickAll().catch(() => {}), WATCH_MS).unref(); }
// Boot: a campaign that was preparing or running when the platform restarted has no process behind it.
async function sweep() {
  const rows = (await q("SELECT id, run_id FROM platform.test_campaigns WHERE status IN ('proposing','preparing','running')")).rows;
  for (const r of rows) await set(r.id, { status: "failed", verdict_line: "the platform restarted while the campaign was running" });
  return rows.length;
}

// ---- the floor's view: the steps for the screen a person is on ------------------------------------------------
function stepsForScreen(camp, mod, page) {
  const rel = String(page || "/").replace(/^\/c\/[^/]+\/(?:staging\/|test\/)?m\/[^/]+/, "") || "/";
  const same = (a, b) => (a.replace(/\/$/, "") || "/") === (b.replace(/\/$/, "") || "/");
  const out = [];
  for (const c of camp.cases || []) {
    if (c.kind !== "guided") continue;
    const r = (camp.results && camp.results.cases || []).find((x) => x.id === c.id);
    c.steps.forEach((s, i) => {
      if ((s.module || camp.module) !== mod || !same(s.on, rel)) return;
      const st = (r && r.steps[i]) || { state: "waiting" };
      out.push({ campaign_id: camp.id, case: c.id, n: i + 1, title: c.title, do: s.do, watched: Boolean(s.then), state: st.state, saw: st.saw || null, by: st.by || null, timed_out: Boolean(st.timed_out) });
    });
  }
  return out;
}

// ---- routes ------------------------------------------------------------------------------------------------
const router = express.Router();
const json = express.json({ limit: "200kb" });
const requireManager = (req, res, next) => auth.requireManager(req, res, next);
const freshPin = (req, res, next) => require("./people").requireFreshPin(req, res, next);
const guard = (fn) => async (req, res) => { try { await fn(req, res); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
const who = (req) => actor(req, req.sosAccount && req.sosAccount.name ? req.sosAccount.name : null);

router.get("/api/runs/:id(\\d+)/campaign", guard(async (req, res) => {
  const camp = await forRun(Number(req.params.id));
  if (!camp) return res.status(404).json({ error: "no test campaign on this build" });
  res.set("Cache-Control", "no-store").json(publicView(camp.status === "walking" ? await tick(camp.id) : camp));
}));
router.post("/api/runs/:id(\\d+)/campaign/approve", requireManager, freshPin, json, guard(async (req, res) => res.json(await approve(Number(req.params.id), req.body || {}, who(req)))));
router.post("/api/runs/:id(\\d+)/campaign/skip", requireManager, json, guard(async (req, res) => res.json(await skip(Number(req.params.id), (req.body || {}).reason, who(req)))));
router.post("/api/runs/:id(\\d+)/campaign/waive", requireManager, freshPin, json, guard(async (req, res) => res.json(await waive(Number(req.params.id), (req.body || {}).reason, who(req)))));
router.post("/api/runs/:id(\\d+)/campaign/steps/:case/:n(\\d+)", requireManager, json, guard(async (req, res) => {
  const camp = await forRun(Number(req.params.id));
  if (!camp) throw fail(404, "no test campaign on this build");
  res.json(await answerStep(camp.id, req.params.case, req.params.n, req.body || {}, who(req)));
}));
// the test page's own view and answer (any device of the company; a person's name when one is signed in)
router.get("/api/c/:slug/who/campaign", guard(async (req, res) => {
  const mod = String(req.query.module || "");
  const rows = (await q("SELECT * FROM platform.test_campaigns WHERE company=$1 AND status='walking' ORDER BY id DESC", [req.params.slug])).rows;
  let steps = [];
  for (const camp of rows) steps = steps.concat(stepsForScreen(camp, mod, req.query.page));
  res.set("Cache-Control", "no-store").json({ steps, campaign: rows[0] ? { id: rows[0].id, title: rows[0].title, module: rows[0].module, version: rows[0].version } : null });
}));
router.post("/api/c/:slug/who/campaign/steps/:campaign(\\d+)/:case/:n(\\d+)", json, guard(async (req, res) => {
  const camp = await get(Number(req.params.campaign));
  if (!camp || camp.company !== req.params.slug) throw fail(404, "no such campaign");
  res.json(await answerStep(camp.id, req.params.case, req.params.n, req.body || {}, who(req)));
}));
// the checks page and the Versions panel
router.get("/api/c/:slug/modules/:name/campaigns", requireManager, guard(async (req, res) => res.json({ campaigns: await listForModule(req.params.slug, req.params.name) })));

module.exports = { init, router, parse, counts, verdictOf, publicView, forRun, forBoard, listForModule, begin, approve, skip, waive, answerStep, tick, finish, forAgent, afterRunEnds, releaseWaiting, runningOn, startWatching, sweep, stepsForScreen, fakeProposal, formatBrief, OPEN, MAX_CASES, MAX_GUIDED };
