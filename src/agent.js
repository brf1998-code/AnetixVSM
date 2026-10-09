// Claude agent runner — the only place AI touches code.
//
// Uses the Claude Agent SDK (the Claude Code harness, headless) with:
//   - cwd  = the draft version directory (the agent's entire write surface)
//   - guidance docs (repo principles + the company's editable docs + the
//     module reference) as system prompt
//   - file tools only; no Bash, no network
//
// Every model call runs on one of two models, Fable 5.1 or Opus 5.5
// (Brendan, 2026-09-22), apart from the short text jobs (the plain summary
// after a build, the plain-words rewrites), which have a model of their own,
// Sonnet 5 by default. Which of the two is the baseline is decided by the assessment on
// /admin#models (src/assess.js). Four jobs:
//   propose  reading a request and drafting the proposal; also the requirement
//            restatement, diagrams, ERP lookups and a module's chat agent
//   build    the agentic multi-turn run that edits files (most of the spend)
//   review   one structured call that reviews the diff independently
//   design   a new module (the intake's questions and design, its first build
//            and that build's check), system reviews, brand guides
// A company can pin propose, build and review on its Agent settings page;
// otherwise a job runs on the instance's model for it (the baseline unless
// /admin#models gives the job its own), or on its arm of the live A/B.
//
// Cost controls (all optional; unset or 0 = no cap):
//   SOS_MAX_RUN_USD      per build run; the run is aborted past this
//   SOS_MAX_BATCH_USD    ceiling for a batch run
//   SOS_MONTHLY_CAP_USD  no new proposals or runs once this month's total crosses it
//
// Reasoning effort for the build agent: SOS_AGENT_EFFORT (default "high";
// low / medium / high / xhigh / max). Decided 2026-09-17: high everywhere.
const fs = require("fs");
const path = require("path");
const { q, getSetting, setSetting } = require("./db");

const PRINCIPLES_DIR = process.env.PRINCIPLES_DIR || path.join(__dirname, "..", "principles");
// Caps are off unless set (Brendan, 2026-09-17: development mode, spend what
// the work needs). A value of 0 or unset means no cap. Set SOS_MAX_RUN_USD,
// SOS_MAX_BATCH_USD and SOS_MONTHLY_CAP_USD to bring them back.
const capEnv = (name) => { const v = Number(process.env[name] || 0); return Number.isFinite(v) && v > 0 ? v : 0; };
const MAX_RUN_USD = capEnv("SOS_MAX_RUN_USD");
// A batch gets MAX_RUN_USD per change, never more than MAX_BATCH_USD in one run.
const MAX_BATCH_USD = capEnv("SOS_MAX_BATCH_USD");
const runCapUsd = (changes) => {
  if (!MAX_RUN_USD) return 0;
  const usd = MAX_RUN_USD * Math.max(1, changes || 1);
  return MAX_BATCH_USD ? Math.min(usd, MAX_BATCH_USD) : usd;
};
const MONTHLY_CAP_USD = capEnv("SOS_MONTHLY_CAP_USD");

// The two models (platform.claude.com/docs/en/models/overview, Sept 2026).
// Prices are USD per million tokens, in / out. Both refuse a forced
// tool_choice (runStructured asks with auto from the first call).
const MODELS = [
  { id: "claude-fable-5-1", label: "Fable 5.1", in: 10, out: 50, forcedTool: false, note: "the most capable; the first baseline, until the assessment says otherwise" },
  { id: "claude-opus-5-5", label: "Opus 5.5", in: 4, out: 20, forcedTool: false, note: "40% of Fable's price; ahead of Fable 5.1 on Anthropic's agentic coding benchmarks (released 2026-09-22)" },
];
// The short text jobs: the plain summary after every build (the title and the
// "what changed" the floor reads on the Done card and in "New here", and the
// version's note) and the plain-words rewrite of a line an intake model wrote
// in software words. One model for both, set on /admin#models (settings
// "summary"). Sonnet 5 by default since 2026-09-22 (Brendan: a better model
// at a fraction of a cent more beats Haiku while the loop has to work very
// well); Haiku 4.5 ran them before. Either of the two main models may run
// them too.
const SUMMARY_MODELS = [
  { id: "claude-sonnet-5", label: "Sonnet 5", in: 2, out: 10, utility: true, note: "the short text jobs' default since 2026-09-22" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5", in: 1, out: 5, utility: true, note: "the cheapest; ran the short text jobs until 2026-09-22" },
];
// Priced, never offered as a choice: the short text models above (offered for
// that one setting only), and Opus 5, which ran jobs before 2026-09-22 and
// stays here only so old rows price and label right.
const PRICE_ONLY = [
  ...SUMMARY_MODELS,
  { id: "claude-opus-5", label: "Opus 5", in: 5, out: 25, retired: true, note: "no longer runs any job (2026-09-22)" },
];
const FIRST_SUMMARY = "claude-sonnet-5";
const JOBS = ["propose", "build", "review", "design"];
const COMPANY_JOBS = ["propose", "build", "review"];   // the ones a company can pin on its Agent settings page
const AB_JOBS = ["propose", "build", "design"];        // the ones the live A/B splits; a build's review follows the build's arm
const FIRST_BASELINE = "claude-fable-5-1";
const inTier = (id) => MODELS.some((m) => m.id === id);
const SUMMARY_CHOICES = [...SUMMARY_MODELS.map((m) => m.id), ...MODELS.map((m) => m.id)];
// Before 2026-09-22 these environment variables picked the instance's models.
// They are read no more: the baseline and a job's own model are set on
// /admin#models. The admin page lists any still set, so they can be deleted.
const RETIRED_ENV = ["SOS_MODEL_PROPOSE", "SOS_MODEL_BUILD", "SOS_MODEL_REVIEW", "SOS_MODEL", "SOS_MODEL_INTAKE"];
const retiredEnvSet = () => RETIRED_ENV.filter((k) => process.env[k]);

// Models the build agent (Claude Code) can run: both, on Agent SDK 0.3.280
// (2026-09-22: 0.3.274 bundled a CLI that predates Opus 5.5, the same trap
// 0.1.77 was for Fable). `agent: false` on a MODELS row would keep a model out
// of builds, should that ever be needed.
const canBuild = (id) => { const m = MODELS.find((x) => x.id === id); return !m || m.agent !== false; };
// Pick the model for the build agent: the requested one if it can build,
// otherwise the company's build model. Returns { model, substituted }.
async function buildModelFor(company, requested) {
  if (requested && inTier(requested) && canBuild(requested)) return { model: requested, substituted: null };
  let fallback = await modelFor(company, "build");
  if (!canBuild(fallback)) fallback = MODELS.find((m) => canBuild(m.id)).id;
  return { model: fallback, substituted: requested || null };
}

// The instance's model settings, in platform.settings under "models":
//   { baseline, jobs: { <job>: id }, summary, ab: { on, jobs: [...], since, by, ended } }
// baseline: what every job runs on unless the job has its own or a company
// pins it. summary: the short text jobs' model. SOS_MODEL_BASELINE and
// SOS_MODEL_SUMMARY only matter until the first save on the page.
function cleanSettings(raw) {
  let s = {};
  try { s = typeof raw === "string" ? (raw ? JSON.parse(raw) : {}) : (raw || {}); } catch (e) { s = {}; }
  const first = inTier(process.env.SOS_MODEL_BASELINE) ? process.env.SOS_MODEL_BASELINE : FIRST_BASELINE;
  const baseline = inTier(s.baseline) ? s.baseline : first;
  const firstSummary = SUMMARY_CHOICES.includes(process.env.SOS_MODEL_SUMMARY) ? process.env.SOS_MODEL_SUMMARY : FIRST_SUMMARY;
  const summary = SUMMARY_CHOICES.includes(s.summary) ? s.summary : firstSummary;
  const jobs = {};
  for (const j of JOBS) if (s.jobs && inTier(s.jobs[j])) jobs[j] = s.jobs[j];
  const a = s.ab || {};
  const ab = a.on
    ? { on: true, jobs: (Array.isArray(a.jobs) ? a.jobs : AB_JOBS).filter((j) => AB_JOBS.includes(j)), since: a.since || new Date().toISOString(), by: a.by || null, ended: null }
    : { on: false, jobs: [], since: a.since || null, by: a.by || null, ended: a.ended || null };
  return { baseline, jobs, summary, ab, set_at: s.set_at || null, set_by: s.set_by || null };
}
async function instanceModels() { return cleanSettings(await getSetting("models", "")); }
// The model for the short text jobs (pipeline.plainSummary, the intake's plain-words rewrites).
async function summaryModel() { return (await instanceModels()).summary; }
async function setInstanceModels(next, by) {
  const s = cleanSettings({ ...next, set_at: new Date().toISOString(), set_by: by || null });
  await setSetting("models", JSON.stringify(s));
  return s;
}
// What each job runs on when no company pins it and no A/B arm applies.
async function defaultModels(settings) {
  const s = settings || await instanceModels();
  const out = {};
  for (const j of JOBS) out[j] = s.jobs[j] || s.baseline;
  return out;
}
// A company's own pins (null = follows the instance).
async function companyPins(company) {
  const row = company ? (await q("SELECT model_propose, model_build, model_review FROM platform.companies WHERE slug=$1", [company])).rows[0] : null;
  const out = {};
  for (const j of COMPANY_JOBS) out[j] = row && inTier(row[`model_${j}`]) ? row[`model_${j}`] : null;
  return out;
}

// Effective model for a job: the company's pin, then the instance's model for
// the job, then the baseline. Unknown roles count as propose.
async function modelFor(company, role) {
  const job = JOBS.includes(role) ? role : "propose";
  if (COMPANY_JOBS.includes(job)) { const pin = (await companyPins(company))[job]; if (pin) return pin; }
  return (await defaultModels())[job];
}

// The live A/B (/admin#models). A job in the test that the company has not
// pinned gets the model that has had fewer of that job since the test began
// (a coin decides a tie). The pick is kept in platform.model_arms under a
// reference ("run:12", "feedback:40", "intake:3"), so asking again for the
// same thing while the test runs gives the same model. Returns
// { model, arm } where arm is true when the A/B chose it.
async function pickModel(company, job, ref) {
  if (COMPANY_JOBS.includes(job)) { const pin = (await companyPins(company))[job]; if (pin) return { model: pin, arm: false }; }
  const s = await instanceModels();
  if (!s.ab.on || !s.ab.jobs.includes(job)) return { model: s.jobs[job] || s.baseline, arm: false };
  if (ref) {
    const had = (await q("SELECT model FROM platform.model_arms WHERE job=$1 AND ref=$2 AND created_at >= $3", [job, ref, s.ab.since])).rows[0];
    if (had && inTier(had.model)) return { model: had.model, arm: true, since: s.ab.since };
  }
  const counts = (await q("SELECT model, count(*)::int AS n FROM platform.model_arms WHERE job=$1 AND created_at >= $2 GROUP BY model", [job, s.ab.since])).rows;
  const n = (id) => (counts.find((c) => c.model === id) || {}).n || 0;
  const least = Math.min(...MODELS.map((m) => n(m.id)));
  const pool = MODELS.map((m) => m.id).filter((id) => n(id) === least);
  const model = pool[Math.floor(Math.random() * pool.length)];
  if (ref) await keepArm(job, company, ref, model);
  return { model, arm: true, since: s.ab.since };
}
// Record an arm once the thing it belongs to has an id (a run is inserted with its model already chosen).
async function keepArm(job, company, ref, model) {
  await q("INSERT INTO platform.model_arms (job, company, ref, model) VALUES ($1,$2,$3,$4) ON CONFLICT (job, ref) DO UPDATE SET model=EXCLUDED.model, created_at=now()", [job, company || null, ref, model]);
}

const ALL_MODELS = [...MODELS, ...PRICE_ONLY];
function modelInfo(id) { return ALL_MODELS.find((m) => m.id === id) || { id, label: id, in: 10, out: 50, note: "" }; }
function priceOf(id) { const m = modelInfo(id); return { inTok: m.in / 1e6, outTok: m.out / 1e6 }; }

function readIfExists(p) {
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}

// Platform-wide principles shipped in the repo (read-only in the app).
function platformDocs() {
  return ["PRINCIPLES.md", "GUARDRAILS.md", "STYLE.md"]
    .map((name) => ({ name, content: readIfExists(path.join(PRINCIPLES_DIR, name)) }))
    .filter((d) => d.content);
}

// Everything an agent run is guided by, in order, plus the list of names so a
// run can record which docs shaped it.
// The platform STYLE.md is the default look. A company with its own STYLE.md
// (written by the brand step, or by hand) replaces it: the two never sit in
// the same prompt, because an agent given both keeps the platform one.
async function guidanceFor(company, moduleName) {
  const rows = (await q(
    `SELECT module, name, content FROM platform.agent_docs
      WHERE company=$1 AND (module IS NULL OR module=$2) AND content <> ''
      ORDER BY module NULLS FIRST, name`, [company, moduleName])).rows;
  const companyStyle = rows.some((r) => !r.module && r.name === "STYLE.md");
  const docs = platformDocs().filter((d) => !(companyStyle && d.name === "STYLE.md")).map((d) => ({ scope: "platform", ...d }));
  // a module's chat personas (module.json "agents") are not build guidance
  const personas = new Set();
  try {
    const registry = require("./registry");
    const row = await registry.getModule(company, moduleName);
    if (row && row.live_version) for (const a of Object.values(registry.readManifest(company, moduleName, row.live_version).agents || {})) if (a && a.doc) personas.add(a.doc);
  } catch (e) { /* no manifest, nothing to exclude */ }
  for (const r of rows) if (!(r.module && personas.has(r.name))) docs.push({ scope: r.module ? `module ${r.module}` : "company", name: r.name, content: r.content });
  const text = docs.map((d) => `<!-- ${d.scope}: ${d.name} -->\n${d.content}`).join("\n\n---\n\n");
  return { text, names: docs.map((d) => `${d.scope}: ${d.name}`) };
}

// SOS_FAKE_AGENT=1 runs the entire pipeline with a deterministic scripted
// "agent" — no API calls, zero cost. Exists to test the platform machinery and
// to dry-run the loop without a key. Clearly not the real product behavior.
function fakeMode() { return process.env.SOS_FAKE_AGENT === "1"; }
function haveKey() { return Boolean(process.env.ANTHROPIC_API_KEY) || fakeMode(); }

// GATECHECK in the feedback (or in a new module's name) makes the fake agent's
// first attempt trip the module gate (src/modulegate.js): a line that reads the
// server's settings in a functionality or module build, a harmless line in
// routes.js in a UI build (which may not touch that file at all). The fix
// round takes the line out again, so the whole branch walks at zero spend.
function fakeGateLine(dir, prompt, leak) {
  const routesPath = path.join(dir, "routes.js");
  if (!fs.existsSync(routesPath)) return;
  const before = fs.readFileSync(routesPath, "utf8");
  let routes = before.replace(/\n\/\/ FAKE-GATE\n[^\n]*\n/g, "");   // back to the file exactly as it was
  if (/GATECHECK/.test(prompt) && !/independent reviewer looked at your previous attempt|own checks refused the previous attempt/.test(prompt)) {
    routes += leak ? "\n// FAKE-GATE\nconst fakeGateLeak = process.env.DATABASE_URL;\n" : "\n// FAKE-GATE\nconst fakeGateTouched = true;\n";
  }
  if (routes !== before) fs.writeFileSync(routesPath, routes);
}

// ADDERP in the feedback makes a functionality build declare an ERP connection ("epicor") on its first attempt, the
// way a real agent reaches for Epicor when a request names it; the fix round takes it out again, ADDERPALWAYS keeps
// it. A new module whose design lists an erp connection declares one too. The module gate holds both to what is
// turned on for the tool (src/connections.js, rule connection-not-on).
function fakeErp(dir, add) {
  const mf = path.join(dir, "module.json");
  let m; try { m = JSON.parse(fs.readFileSync(mf, "utf8")); } catch (e) { return; }
  const had = Boolean(m.connections && m.connections.epicor);
  if (add && !had) m.connections = { ...(m.connections || {}), epicor: { kind: "erp", label: "Epicor", queries: { late_jobs: { params: [], fields: ["job", "due"], about: "late jobs" } } } };
  else if (!add && had) { delete m.connections.epicor; if (!Object.keys(m.connections).length) delete m.connections; }
  else return;
  fs.writeFileSync(mf, JSON.stringify(m, null, 2) + "\n");
}

function fakeRunAgent({ dir, prompt }) {
  if (/^NEW MODULE BUILD/m.test(prompt)) {
    fakeGateLine(dir, prompt, true);
    if (/^- Connections: .*\(erp\)/m.test(prompt)) fakeErp(dir, !/own checks refused the previous attempt/.test(prompt));
    // the skeleton the platform wrote is already a working module; the fake
    // agent only proves the loop by stamping the first page
    const pages = path.join(dir, "pages");
    for (const f of fs.existsSync(pages) ? fs.readdirSync(pages) : []) {
      const p = path.join(pages, f);
      fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace("</body>", `<p data-changed="v1" style="font-size:12px;color:#51606f;margin:8px 0">Built by the fake agent from the design (SOS_FAKE_AGENT=1).</p>\n</body>`));
    }
    return { text: "- Built the first version from the design: one list of the thing, its stages, a move button per item\n- No real AI was involved (SOS_FAKE_AGENT=1)", costUsd: 0 };
  }
  const target = (/Target file: (\S+)/.exec(prompt) || [])[1];
  const pages = path.join(dir, "pages");
  const files = target && fs.existsSync(path.join(dir, target)) ? [path.join(dir, target)]
    : fs.existsSync(pages) ? fs.readdirSync(pages).map((f) => path.join(pages, f)) : [];
  // FAILCHECK in the feedback makes the first attempt fail the fake cross-check; a fix round clears it
  const fixRound = /independent reviewer looked at your previous attempt|own checks refused the previous attempt|platform ran its checks against your previous attempt/.test(prompt);
  const bad = /FAILCHECK/.test(prompt) && !fixRound;
  fakeGateLine(dir, prompt, /functionality-class/i.test(prompt));
  const ver = (/data-changed="(v\d+)"/.exec(prompt) || [])[1] || "v0";
  for (const p of files) {
    let html = fs.readFileSync(p, "utf8").replace(/\n<!-- FAKE-BAD -->\n/g, "");
    const mark = `<p data-changed="${ver}" style="font-size:12px;color:#51606f;margin:8px 0">Revised by the fake agent (${ver}).</p>`;
    html = html.includes("</body>") ? html.replace("</body>", `${mark}\n</body>`) : html + mark;
    fs.writeFileSync(p, html + `\n<!-- revised by fake agent ${new Date().toISOString()} -->\n${bad ? "<!-- FAKE-BAD -->\n" : ""}`);
  }
  // The checks of build order item 7, exercised without a key. Each marker breaks the FIRST attempt one way and
  // a fix round clears it:
  //   BREAKPAGE     a script on the target page throws when the page opens          (the page load stops it)
  //   BREAKSYNTAX   a script on the target page does not parse                       (caught with or without a browser)
  //   BREAKPROMISE  the first /api/ path of the smoke list answers a list, not an     (checks earlier changes
  //                 object: it still answers, so only what was promised about it breaks  left behind stop it)
  //   BADCHECK      the check left behind by this change expects the impossible      (its own check stops it)
  //   BADCHECKALWAYS the same, and no fix round clears it                             (the automatic rounds run out)
  //   BADSMOKE      module.json lists a path to check that is not there               (the endpoints stop it)
  //   EDITCHECK     the build rewrites a check an earlier change left behind           (the module gate stops it)
  //   NOCHECK       a functionality change that leaves no check behind                (passes; the run log says so)
  for (const p of files) {
    let html = fs.readFileSync(p, "utf8").replace(/\n<script data-fake-break>[\s\S]*?<\/script>\n/g, "");
    if (/BREAKPAGE/.test(prompt) && !fixRound) html = html.replace("</body>", `\n<script data-fake-break>fakeAgentCalledSomethingThatIsNotThere();</script>\n</body>`);
    if (/BREAKSYNTAX/.test(prompt) && !fixRound) html = html.replace("</body>", `\n<script data-fake-break>function fakeAgentLeftABraceOpen( {</script>\n</body>`);
    fs.writeFileSync(p, html);
  }
  const manifestFile = path.join(dir, "module.json");
  let manifest = {}; try { manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8")); } catch (e) { /* no manifest, no api path */ }
  const apiPath = (manifest.smoke || []).find((x) => /^\/api\//.test(x) && !/fake-not-there/.test(x)) || null;
  const routesFile = path.join(dir, "routes.js");
  const FUNC = /functionality-class/i.test(prompt);
  if (FUNC && apiPath && fs.existsSync(routesFile)) {
    const brokenLine = `  router.get("${apiPath}", (req, res) => res.json(["fake broken promise"]));   // FAKE-BREAKPROMISE\n`;
    let js = fs.readFileSync(routesFile, "utf8").split(brokenLine).join("");
    if (/BREAKPROMISE/.test(prompt) && !fixRound) js = js.replace(/(const router = express\.Router\(\);\n)/, `$1${brokenLine}`);
    fs.writeFileSync(routesFile, js);
  }
  if (FUNC && /ADDERP/.test(prompt)) { fakeErp(dir, !fixRound || /ADDERPALWAYS/.test(prompt)); try { manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8")); } catch (e) { /* as it was */ } }
  if (FUNC && Array.isArray(manifest.smoke)) {
    manifest.smoke = manifest.smoke.filter((x) => x !== "/api/fake-not-there");
    if (/BADSMOKE/.test(prompt) && !fixRound) manifest.smoke.push("/api/fake-not-there");
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + "\n");
  }
  if (FUNC) {
    const migDir = path.join(dir, "migrations");
    fs.mkdirSync(migDir, { recursive: true });
    const next = String(fs.readdirSync(migDir).filter((f) => f.endsWith(".sql")).length + 1).padStart(3, "0");
    fs.writeFileSync(path.join(migDir, `${next}.sql`), "ALTER TABLE stations ADD COLUMN IF NOT EXISTS fake_note TEXT;\n");
    const chkDir = path.join(dir, "checks");
    const existing = fs.existsSync(chkDir) ? fs.readdirSync(chkDir).filter((f) => f.endsWith(".json")).sort() : [];
    if (/EDITCHECK/.test(prompt) && !fixRound && existing.length) fs.writeFileSync(path.join(chkDir, existing[0]), JSON.stringify({ title: "The fake agent rewrote a promise it did not make", steps: [{ call: "GET /" }] }, null, 2) + "\n");
    if (!/NOCHECK/.test(prompt) && apiPath) {
      fs.mkdirSync(chkDir, { recursive: true });
      const mine = existing.find((f) => f.endsWith(`-fake-change-${ver}.json`));
      const name = mine || `${String(existing.length + 1).padStart(3, "0")}-fake-change-${ver}.json`;
      fs.writeFileSync(path.join(chkDir, name), JSON.stringify({ title: `The fake change of ${ver} keeps ${apiPath} answering with an object`, steps: [{ call: `GET ${apiPath}`, expect: { status: /BADCHECKALWAYS/.test(prompt) || (/BADCHECK/.test(prompt) && !fixRound) ? 418 : 200, json: { $type: "object" } } }] }, null, 2) + "\n");
    }
  }
  return { text: `- Fake agent applied a marker change to ${target || "every page"}\n- Added one additive migration and one check (functionality lane only)\n- No real AI was involved (SOS_FAKE_AGENT=1)`, costUsd: 0 };
}

// Propose on arrival in fake mode (src/arrival.js), steered by a word in the feedback: DUPE = the same thing as the
// first open request listed, ASKME = one question instead of a guess (a proposal once the answer is in the prompt),
// NOTTHISTOOL and NEWTOOL = the two flags, FAILPROPOSE = the call itself fails, CREDITOUT = it fails the way an
// empty credit balance does. Each only when the prompt allowed it (the sorting brief, the asking brief).
function fakeTriage(quoted, prompt, blocks) {
  const out = {}, notes = [];
  const maySort = /First decide what this request is \(triage\)/.test(prompt), mayAsk = /You may ask ONE question instead of guessing/.test(prompt);
  if (maySort) {
    out.triage = "change"; out.duplicate_of = 0; out.triage_note = "";
    const first = (/\n#(\d+) \[(?:waiting|proposal drafted|being built)\]/.exec(prompt) || [])[1];
    if (/DUPE/.test(quoted) && first) { out.triage = "duplicate"; out.duplicate_of = Number(first); out.triage_note = `Fake mode: this asks for the same thing as request #${first}.`; }
    else if (/NOTTHISTOOL/.test(quoted)) { out.triage = "not_this_tool"; out.triage_note = "Fake mode: this is about the building, not about this tool."; }
    else if (/NEWTOOL/.test(quoted)) { out.triage = "new_tool"; out.triage_note = "Fake mode: this asks for a whole new tool, not a change to this one."; }
    else if (/INTEGRATION/.test(quoted) && /- integration: /.test(prompt)) { out.triage = "integration"; out.triage_note = "Fake mode: this asks to connect the tool to Epicor, which Anetix's integration team sets up."; out.integration = { kind: "erp", system: "Epicor", would_give: "The late jobs would come from Epicor instead of being typed in." }; }
  }
  if (mayAsk) out.question = /ASKME/.test(quoted) ? (/ASKMEBADLY/.test(quoted) ? { text: "Which API endpoint should the frontend call?", options: ["The database", "The backend"] } : { text: "Which one do you mean?", options: ["The count on the left", "The list on the right"] }) : { text: "", options: [] };
  const ans = /The answer(?:, from [^:]+)?: "([^"]*)"/.exec(prompt);
  if (ans) notes.push(`Answer received: ${ans[1]}.`);
  const el = /The person POINTED at one thing on the screen while writing this: (<[^>]*>)/.exec(prompt);
  if (el) notes.push(`Pointed element received: ${el[1]}.`);
  const photos = (blocks || []).filter((b) => b && b.type === "image").length;
  if (photos) notes.push(`Photo received (${photos}).`);
  return { out, notes: notes.length ? " " + notes.join(" ") : "" };
}

function fakeStructured(toolName, prompt, blocks) {
  const quoted = (/\n\n"([^"]{1,500})"\n\n/.exec(prompt) || [])[1] || prompt.slice(0, 200);
  const screenLine = (prompt.split("\n").find((l) => l.startsWith("Screen:")) || "");
  const target = (/\(([^()]+)\)\s*$/.exec(screenLine) || [])[1] || null;
  if (toolName === "proposal" && /CREDITOUT/.test(quoted)) throw new Error("400 {\"type\":\"error\",\"error\":{\"type\":\"invalid_request_error\",\"message\":\"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.\"}}");
  if (toolName === "proposal" && /FAILPROPOSE/.test(quoted)) throw new Error("fake mode: the proposal call failed (FAILPROPOSE)");
  const sorted = toolName === "proposal" ? fakeTriage(quoted, prompt, blocks) : { out: {}, notes: "" };
  const canned = {
    proposal: { ...sorted.out, erp_data: (() => { const need = /ERPNEED:([a-z_0-9]*)/.exec(quoted); const lk = ((/ERP lookups available to this module: ([^\n]+)/.exec(prompt) || [])[1] || "").split(",")[0].trim(); return need && lk ? [{ what: `fake need: ${need[1] || "something the ERP does not give"}`, lookup: lk, field: need[1] }] : []; })(), proposal: "Fake-mode proposal: apply the requested change as described in the feedback. (SOS_FAKE_AGENT=1)", class: /color|copy|text|label|layout|style|bigger|smaller|show|display|legend|see/i.test(quoted) ? "ui" : "functionality", target_file: target, rationale: "Deterministic fake classification for machinery testing." + ((/This is a follow-up to request #(\d+)\./.exec(prompt) || [])[1] ? ` Follow-up context received for request #${/This is a follow-up to request #(\d+)\./.exec(prompt)[1]}.` : "") + sorted.notes },
    requirement: {
      bluf: "Fake-mode requirement: the change in the feedback is applied and nothing else moves.",
      items: (prompt.match(/^Change \d+ of \d+/gm) || ["Approved proposal"]).map((h, i) => ({ change: i + 1, summary: `Fake-mode item ${i + 1}: apply that change on its screen, nothing else.` })),
      requirement: "Fake-mode requirement: (1) the change in the feedback will be applied, (2) everything else stays the same, (3) verified by smoke checks on staging. (SOS_FAKE_AGENT=1)",
    },
    brand: { guide_md: "# Visual style: Fake Co (fake mode)\n\nPrimary color #1f3a5f, accent #c2620a, system font. (SOS_FAKE_AGENT=1)", primary: "#1f3a5f", accent: "#c2620a", background: "#f2f4f7", ink: "#1c242e", font_stack: "system-ui, sans-serif", company_name: "Fake Co", tone: "plain" },
    verdict: /FAKE-BAD/.test(prompt)
      ? { verdict: "fail", summary: "Fake-mode cross-check: the diff carries a FAKE-BAD marker, which stands in for a change that does not meet the requirement. (SOS_FAKE_AGENT=1)", findings: [{ severity: "blocking", where: "the page", what: "carries the FAKE-BAD marker", evidence: "<!-- FAKE-BAD -->" }] }
      : { verdict: "pass", summary: "Fake-mode cross-check: diff reviewed, no violations. (SOS_FAKE_AGENT=1)", findings: [] },
    summary: { title: `Fake change to ${target || "the module"}`, what_changed: "Fake-mode summary: a marker was stamped on the page named in the feedback. Nothing else changed. (SOS_FAKE_AGENT=1)" },
  };
  return { data: canned[toolName] || {}, costUsd: 0 };
}

// Environment handed to the Claude Code subprocess. An explicit allow-list, not
// a spread of process.env: the agent reads feedback text typed by floor users,
// so it must never see DATABASE_URL, SESSION_SECRET, the login passwords, or
// the internal token. It only needs the API key, a PATH and HOME, and the
// ANTHROPIC_*/CLAUDE_* knobs (base URL, model overrides).
function agentEnv() {
  const out = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v == null) continue;
    if (["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "TZ", "NODE_OPTIONS", "NODE_EXTRA_CA_CERTS"].includes(k)) out[k] = v;
    else if (/^(ANTHROPIC_|CLAUDE_)/.test(k)) out[k] = v;
  }
  out.IS_SANDBOX = "1";
  out.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
  // The CLI can swap in a fallback model when the chosen one is unavailable.
  // A build must run on the model the manager picked or not at all, so that
  // "built on Fable" (evidence.models_seen) is provable.
  out.CLAUDE_CODE_NO_MODEL_FALLBACK = "1";
  return out;
}

const AGENT_EFFORT = process.env.SOS_AGENT_EFFORT || "high";

// Run an agent turn inside a version directory.
// Returns { text, costUsd, modelsSeen }: modelsSeen is every model id the
// run reported (the init message and each assistant message); a run built on
// the requested model reports exactly one.
// ---- the data wall's choke point (src/datawall.js) ------------------------------------------------------------
// Every model call passes here. `company` names whose call it is; a walled company never sends image or document
// blocks, whatever the caller assembled. SOS_PROMPT_LOG=<file> appends every prompt sent (fake mode too), which is
// how scripts/e2e/datawall.js proves that a marker seeded into every kind of data reaches no prompt.
async function atWall(kind, { company, model, system, prompt, messages, blocks, dir }) {
  let out = blocks;
  let walled = false;
  if (company) {
    walled = await require("./datawall").isWalled(company);
    if (walled && blocks && blocks.some((b) => b && (b.type === "image" || b.type === "document"))) {
      console.warn(`[datawall] ${company}: ${blocks.filter((b) => b && (b.type === "image" || b.type === "document")).length} image or document block(s) dropped from a ${kind} call`);
      out = blocks.filter((b) => b && b.type === "text");
    }
  }
  if (process.env.SOS_PROMPT_LOG) {
    try { fs.appendFileSync(process.env.SOS_PROMPT_LOG, JSON.stringify({ t: new Date().toISOString(), kind, company: company || null, walled, model, system, prompt, messages, blocks: (out || []).map((b) => (b.type === "text" ? b.text : `<${b.type}>`)), dir: dir || null }) + "\n"); } catch (e) { /* the log is best effort */ }
  }
  return { blocks: out, walled };
}

async function runAgent({ model, system, dir, prompt, readOnly = false, capUsd, signal, maxTurns, company }) {
  const cap = capUsd || MAX_RUN_USD;   // 0 = no cap
  await atWall("agent", { company, model, system, prompt, dir });
  if (fakeMode()) {
    // fake builds take a moment so an abort can be exercised without a key
    await new Promise((r) => setTimeout(r, Number(process.env.SOS_FAKE_DELAY_MS || 1500)));
    if (signal && signal.aborted) { const e = new Error("build aborted by the manager"); e.aborted = true; throw e; }
    // FAILBUILD in the request: the agent stops partway with some spend on it (a build that never reaches a preview)
    if (/FAILBUILD/.test(prompt || "")) { const e = new Error("fake mode: the build agent stopped partway (FAILBUILD)"); e.costUsd = 0.42; throw e; }
    return { ...fakeRunAgent({ dir, prompt }), modelsSeen: [model] };
  }
  if (!haveKey()) throw new Error("ANTHROPIC_API_KEY not configured on this instance");
  const { query } = require("@anthropic-ai/claude-agent-sdk");
  const tools = readOnly ? ["Read", "Glob", "Grep"] : ["Read", "Write", "Edit", "Glob", "Grep"];
  const price = priceOf(model);
  const abort = new AbortController();
  let text = "";
  let costUsd = 0;
  let estimate = 0;
  let aborted = false;
  let stderrTail = "";
  let seen = 0, initSeen = false;
  const modelsSeen = new Set();
  // manager abort (the run's Abort button) kills the agent process the same way the cost cap does
  let killed = false;
  const onKill = () => { killed = true; abort.abort(); };
  if (signal) { if (signal.aborted) onKill(); else signal.addEventListener("abort", onKill, { once: true }); }
  const it = query({
    prompt,
    options: {
      cwd: dir,
      model,
      systemPrompt: system,
      // `tools` is the whole tool list the model gets (no Bash, no web, no
      // subagents); `allowedTools` pre-approves them so acceptEdits never
      // has to ask. Verified 2026-09-17: the init message lists only these.
      tools,
      allowedTools: tools,
      // acceptEdits auto-approves file edits inside cwd. We avoid
      // bypassPermissions: the bundled CLI refuses it as root, which is how
      // Railway runs. (Checked again on SDK 0.3.274: acceptEdits as root is fine.)
      permissionMode: "acceptEdits",
      effort: AGENT_EFFORT,
      maxTurns: maxTurns || Number(process.env.SOS_AGENT_MAX_TURNS || 40),
      // Far safety rail only, and only when a cap is set. The working limit is
      // our own estimate below, which aborts at `cap`; this catches a run whose
      // usage messages never arrived. Decided 2026-09-17: no hard kill at the
      // working limit, and no caps at all in development mode.
      ...(cap ? { maxBudgetUsd: cap * 3 } : {}),
      abortController: abort,
      env: agentEnv(),
      stderr: (data) => { stderrTail = (stderrTail + String(data)).slice(-4000); },
    },
  });
  try {
    for await (const msg of it) {
      seen++;
      if (msg.type === "system" && msg.subtype === "init") { initSeen = true; if (msg.model) modelsSeen.add(msg.model); }
      if (msg.type === "assistant" && msg.message && Array.isArray(msg.message.content)) {
        if (msg.message.model) modelsSeen.add(msg.message.model);
        for (const block of msg.message.content) if (block.type === "text") text += block.text;
        const u = msg.message.usage || {};
        estimate += (u.input_tokens || 0) * price.inTok + (u.output_tokens || 0) * price.outTok
          + (u.cache_read_input_tokens || 0) * price.inTok * 0.1 + (u.cache_creation_input_tokens || 0) * price.inTok * 1.25;
        if (cap && estimate > cap && !aborted && !killed) { aborted = true; abort.abort(); }
      }
      if (msg.type === "result") {
        if (typeof msg.total_cost_usd === "number") costUsd = msg.total_cost_usd;
        // On this SDK a turn that ended on an API error still comes back as
        // subtype "success" with is_error set and the error text in result.
        if (msg.is_error && !aborted && !killed) throw new Error(`the model's API answered with an error: ${String(msg.result || "").slice(0, 300)}`);
        if (msg.result) text = msg.result;
        if (msg.subtype === "error_max_budget_usd" && !aborted && !killed) throw new Error(`build stopped at the safety budget ($${(cap * 3).toFixed(2)})`);
        if (msg.subtype && msg.subtype !== "success" && !aborted) throw new Error(`agent run ended: ${msg.subtype}`);
      }
    }
  } catch (e) {
    if (signal) signal.removeEventListener("abort", onKill);
    if (killed || !aborted) await meter({ company, kind: "agent", model, costUsd: Math.max(costUsd || 0, estimate), sdkCostUsd: costUsd || null, ok: false });
    if (killed) { const err = new Error("build aborted by the manager"); err.aborted = true; err.costUsd = Math.max(costUsd || 0, estimate); throw err; }
    if (!aborted) {
      const lines = stderrTail.trim().split("\n").filter(Boolean);
      const detail = lines.slice(-3).join(" | ");
      const stage = !initSeen ? "the agent process died before it started" : seen < 3 ? "the agent process died right after starting" : `after ${seen} messages`;
      const said = text.trim() ? `; the model's last words: "${text.trim().slice(-200)}"` : "";
      const err = new Error(`build agent failed: ${e.message} (${stage}; model ${model}${detail ? `; ${detail}` : "; nothing on stderr"}${said})`);
      err.costUsd = Math.max(costUsd || 0, estimate);
      err.diag = { model, modelsSeen: [...modelsSeen], effort: AGENT_EFFORT, messages: seen, initSeen, stderr: stderrTail.slice(-4000), lastText: text.slice(-600), promptChars: prompt.length, systemChars: (system || "").length };
      throw err;
    }
  }
  if (signal) signal.removeEventListener("abort", onKill);
  const spent = Math.max(costUsd || 0, estimate);
  await meter({ company, kind: "agent", model, costUsd: spent, sdkCostUsd: costUsd || null, ok: !killed && !aborted });
  if (killed) { const e = new Error("build aborted by the manager"); e.aborted = true; e.costUsd = spent; throw e; }
  if (aborted) {
    const e = new Error(`build stopped: run cost passed the $${cap.toFixed(2)} cap for this run`);
    e.costUsd = spent;
    throw e;
  }
  // our own count is kept beside the SDK's: when its price list is behind on a new model it reports too little
  if (costUsd && estimate > costUsd * 1.2) console.error(`[meter] agent run on ${model}: the SDK reported $${costUsd.toFixed(4)}, our own count $${estimate.toFixed(4)}; the larger is filed`);
  return { text: text.trim(), costUsd: spent, modelsSeen: [...modelsSeen] };
}

// One-shot structured call (no file tools) for proposals/classification/verdicts.
// Fable 5.1 and Opus 5.5 both reject a forced tool_choice ("type tool and
// any are not supported for this model"). For those we ask with tool_choice
// auto plus an explicit instruction, and accept a JSON body in plain text as a
// last resort. MODELS rows marked forcedTool: false start in the set; any
// other model that refuses is added for the life of the process, so the
// second call does not pay for the 400.
const noForcedTool = new Set(MODELS.filter((m) => m.forcedTool === false).map((m) => m.id));
// `blocks`: optional content blocks (images, pdf documents, extra text) that
// go in front of the prompt text, for callers that hand the model attachments.
async function runStructured({ model, system, prompt, schema, toolName, maxTokens, blocks, company }) {
  ({ blocks } = await atWall(`structured:${toolName}`, { company, model, system, prompt, blocks }));
  if (fakeMode()) {
    // SOS_FAKE_PROPOSE_MS: how long a fake proposal call takes, so "the proposer is reading this" can be seen and tested
    const wait = toolName === "proposal" ? Number(process.env.SOS_FAKE_PROPOSE_MS || 0) : 0;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    return fakeStructured(toolName, prompt, blocks);
  }
  if (!haveKey()) throw new Error("ANTHROPIC_API_KEY not configured on this instance");
  const Anthropic = require("@anthropic-ai/sdk");
  const client = new Anthropic();
  const tools = [{ name: toolName, description: `Return the ${toolName}.`, input_schema: schema }];
  const content = (text) => (blocks && blocks.length ? [...blocks, { type: "text", text }] : text);
  const call = (forced) => client.messages.create({
    model,
    max_tokens: maxTokens || 4000,
    system,
    messages: [{ role: "user", content: content(forced ? prompt : `${prompt}\n\nRespond only by calling the ${toolName} tool with the complete result. No prose.`) }],
    tools,
    tool_choice: forced ? { type: "tool", name: toolName } : { type: "auto" },
  });
  let resp;
  try {
    if (noForcedTool.has(model)) resp = await call(false);
    else {
      try { resp = await call(true); }
      catch (e) {
        const msg = String(e && e.message || e);
        if (e && e.status === 400 && /tool_choice/i.test(msg)) { noForcedTool.add(model); resp = await call(false); }
        else throw e;
      }
    }
  } catch (e) { throw noteApi(e, toolName, company); }
  await meter({ company, kind: `structured:${toolName}`, model, usage: resp.usage, costUsd: costOf(model, resp.usage || {}), ok: resp.stop_reason !== "max_tokens" });
  let data;
  const use = resp.content.find((b) => b.type === "tool_use");
  if (use) data = use.input;
  else {
    const text = resp.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
    const m = text.match(/\{[\s\S]*\}/);
    if (m) { try { data = JSON.parse(m[0]); } catch { /* fall through */ } }
    if (!data) throw new Error(`model did not return structured output (stop_reason ${resp.stop_reason})`);
  }
  const costUsd = costOf(model, resp.usage || {});
  return { data, costUsd, stopReason: resp.stop_reason };
}

// Every failed call to the API, from either call below, goes to src/credit.js's noteFailure here, so the phones hear of it
// whichever of the 27 callers made it (2026-10-08: the arrival path reported its failure, but chat, the assistant, reviews,
// diagrams and the brand guide reported none). A connection or timeout error carries no API body, so it is named for
// classify. Returns the error for the caller to throw.
function noteApi(e, kind, company) {
  const name = (e && e.constructor && e.constructor.name) || "";
  const msg = e && e.status == null && /Connection|Timeout/.test(name) ? `anthropic_connection_error: ${e.message}` : String((e && e.message) || e);
  require("./credit").noteFailure(msg, `an AI call (${kind}${company ? `, ${company}` : ""})`).catch(() => {});
  return e;
}

// Plain chat call (no tools): a module's conversational agent. Returns
// { text, costUsd }. Fake mode answers with a canned line.
async function runChat({ model, system, messages, maxTokens, company }) {
  await atWall("chat", { company, model, system, messages });
  if (fakeMode()) {
    const last = [...messages].reverse().find((m) => m.role === "user");
    return { text: `Fake-mode answer to "${String(last && last.content || "").slice(0, 80)}": the data digest was read; nothing else happened. (SOS_FAKE_AGENT=1)`, costUsd: 0 };
  }
  if (!haveKey()) throw new Error("ANTHROPIC_API_KEY not configured on this instance");
  const Anthropic = require("@anthropic-ai/sdk");
  const client = new Anthropic();
  let resp;
  try { resp = await client.messages.create({ model, max_tokens: maxTokens || 1500, system, messages }); }
  catch (e) { throw noteApi(e, "chat", company); }
  await meter({ company, kind: "chat", model, usage: resp.usage, costUsd: costOf(model, resp.usage || {}) });
  const text = resp.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  return { text, costUsd: costOf(model, resp.usage || {}) };
}

// ---- the meter (2026-09-26) --------------------------------------------------------------------------------------------
// Every answer the Anthropic API sends back is written here the moment it arrives, whatever the feature does with it
// afterwards (a parse that fails, a run that throws, a caller that forgets to file its spend). The features' own tables
// stay the record of what each thing cost; this is the check on them. Why: the key ran out on 2026-09-26 while the
// glide slope still showed about $14, because the diagrams drawn after every deploy ($19.85 since the 9/20 anchor)
// were filed in platform.diagrams, which no spend total read. src/credit.js counts the larger of the two.
const METER_SCHEMA = `
CREATE TABLE IF NOT EXISTS platform.ai_calls (
  id          BIGSERIAL PRIMARY KEY,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  company     TEXT,
  kind        TEXT NOT NULL,             -- structured:<tool> | chat | agent
  model       TEXT,
  input_tokens  INTEGER, output_tokens INTEGER, cache_read INTEGER, cache_write INTEGER,
  cost_usd    NUMERIC(12,6) NOT NULL DEFAULT 0,
  sdk_cost_usd NUMERIC(12,6),            -- agent runs: what the agent SDK reported, beside our own count
  ok          BOOLEAN NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS ai_calls_at ON platform.ai_calls (at);`;
async function initMeter() { await q(METER_SCHEMA); }
function costOf(model, u = {}) {
  const p = priceOf(model);
  return (u.input_tokens || 0) * p.inTok + (u.output_tokens || 0) * p.outTok + (u.cache_read_input_tokens || 0) * p.inTok * 0.1 + (u.cache_creation_input_tokens || 0) * p.inTok * 1.25;
}
// Work done inside withMeterTag(tag, fn) is filed on the meter as "<tag>:<kind>": Anetix's own model trials (src/assess.js)
// run on a company's stored work under that company's name, and a site's fair-use line leaves "assess:" out (the launch
// audit 1.17).
const meterTag = new (require("async_hooks").AsyncLocalStorage)();
const withMeterTag = (tag, fn) => meterTag.run(tag, fn);
async function meter({ company, kind, model, usage, costUsd, sdkCostUsd, ok = true }) {
  if (fakeMode()) return;
  const u = usage || {};
  const tag = meterTag.getStore(); if (tag) kind = `${tag}:${kind}`;
  await q(`INSERT INTO platform.ai_calls (company, kind, model, input_tokens, output_tokens, cache_read, cache_write, cost_usd, sdk_cost_usd, ok) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [company || null, kind, model || null, u.input_tokens || null, u.output_tokens || null, u.cache_read_input_tokens || null, u.cache_creation_input_tokens || null, Number(costUsd || 0), sdkCostUsd == null ? null : Number(sdkCostUsd), ok])
    .catch((e) => console.error("[meter]", e.message));
}

// Spend that is not a build run, proposal, review or brand build (chat agents).
async function recordUsage(company, moduleName, kind, model, costUsd, detail) {
  await q("INSERT INTO platform.ai_usage (company, module, kind, model, cost_usd, detail) VALUES ($1,$2,$3,$4,$5,$6)",
    [company, moduleName || null, kind, model || null, Number(costUsd || 0), JSON.stringify(detail || {})]);
}

// Month-to-date AI spend (runs + proposals), optionally per company.
// AI spend, one formula everywhere (the launch audit 2.2, 2026-09-27: the header, the company list and card and loop
// health each summed a different set of sources, and the list and card left out new-tool design, sample data and
// diagrams). The six places a cost is filed: builds, proposals, system reviews, brand guides, ai_usage (every other
// kind) and diagrams. A company's figure leaves out the model trials (ai_usage kind assess, Anetix's own since 1.17);
// the instance's total carries everything on the key.
const SPEND_SOURCES = `
  SELECT company, cost_usd AS usd, created_at AS at, NULL::text AS kind FROM platform.build_runs
  UNION ALL SELECT f.company, p.cost_usd, p.created_at, NULL FROM platform.proposals p JOIN platform.feedback f ON f.id=p.feedback_id
  UNION ALL SELECT company, cost_usd, created_at, NULL FROM platform.reviews
  UNION ALL SELECT slug, (brand->>'cost_usd')::numeric, (brand->>'built_at')::timestamptz, NULL FROM platform.companies WHERE brand IS NOT NULL AND brand->>'built_at' IS NOT NULL
  UNION ALL SELECT company, cost_usd, created_at, kind FROM platform.ai_usage
  UNION ALL SELECT company, cost_usd, created_at, NULL FROM platform.diagrams`;
// -> { by: { slug: usd }, total } since `since` (a Date or ISO string; null = this calendar month)
async function spendSince(since = null) {
  const rows = (await q(`SELECT company, SUM(usd) FILTER (WHERE kind IS DISTINCT FROM 'assess')::numeric AS usd, SUM(usd)::numeric AS all_usd
                           FROM (${SPEND_SOURCES}) s WHERE at >= COALESCE($1::timestamptz, date_trunc('month', now())) GROUP BY company`, [since])).rows;
  const by = {}; let total = 0;
  for (const r of rows) { if (r.company) by[r.company] = Number(r.usd || 0); total += Number(r.all_usd || 0); }
  return { by, total };
}
async function monthlySpend(company) {
  const r = (await q(`SELECT COALESCE(SUM(usd) FILTER (WHERE $1::text IS NULL OR (company=$1 AND kind IS DISTINCT FROM 'assess')), 0) AS usd
                        FROM (${SPEND_SOURCES}) s WHERE at >= date_trunc('month', now()) AND ($1::text IS NULL OR company=$1)`, [company || null])).rows[0];
  const usd = Number(r.usd || 0);
  // For one company the cap that counts is its own (set on the admin page);
  // the instance-wide cap is only shown when the company has none.
  const own = company ? await companyCap(company) : 0;
  const cap = own || MONTHLY_CAP_USD;
  return { usd, cap, capKind: own ? "company" : MONTHLY_CAP_USD ? "instance" : null, capped: own ? usd >= own : (!company && MONTHLY_CAP_USD > 0 && usd >= MONTHLY_CAP_USD) };
}

// "Subscribed is the test" wherever the code asks whether a site pays (docs/PAID-SITES.md).
async function subscribedSite(company) {
  if (!company) return false;
  return ((await q("SELECT stage FROM platform.sites WHERE company=$1", [company]).catch(() => ({ rows: [] }))).rows[0] || {}).stage === "subscribed";
}
// A company's own monthly AI budget (platform.companies.monthly_cap_usd); 0 = none.
async function companyCap(company) {
  if (!company) return 0;
  if (await subscribedSite(company)) return 0;   // a paying site's limit is its fair-use line (src/fairuse.js), not a cap (stage 3)
  const row = (await q("SELECT monthly_cap_usd FROM platform.companies WHERE slug=$1", [company])).rows[0];
  const v = row ? Number(row.monthly_cap_usd) : 0;
  return Number.isFinite(v) && v > 0 ? v : 0;
}

// Two budgets, checked separately: the company's own, against the company's
// own spend, so one company running out never stops another (until
// 2026-09-19 the only cap was instance-wide and did exactly that); and the
// instance-wide one from the environment, when it is set at all.
// opts.started: the call belongs to work that already passed this gate when it began (a build run past its start, a
// module creation past its first screen): the credit check lets it through so it finishes (src/selfserve.js
// assertCredit). The budgets below still apply.
async function assertUnderCap(company, opts = {}) {
  // a self-serve company (one that came in from anetix.ai) runs on credit it bought: nothing left, nothing new starts (src/selfserve.js)
  await require("./selfserve").assertCredit(company, opts);
  const own = await companyCap(company);
  if (own) {
    const mine = await monthlySpend(company);
    if (mine.usd >= own) { capReached(`${company}'s own budget`, mine.usd, own); throw Object.assign(new Error(CAP_WORDS.company), { status: 429, code: "cap" }); }
  }
  // the instance cap still counts everything, but it refuses demos only: a paying site's limit is its fair-use line
  if (MONTHLY_CAP_USD > 0 && !(await subscribedSite(company))) {
    const all = await monthlySpend(null);
    if (all.usd >= MONTHLY_CAP_USD) { capReached("the instance cap (SOS_MONTHLY_CAP_USD)", all.usd, MONTHLY_CAP_USD); throw Object.assign(new Error(CAP_WORDS.instance), { status: 429, code: "cap" }); }
  }
}
// What a company's people read at a cap (the launch audit 0.5, 2026-09-27): no dollars, no variable names, what still
// works and who to write to. The figures go to the log and, once a month per cap, to Anetix's phones. "monthly AI cap"
// and "AI budget" stay in the words: src/checks.js, src/pipeline.js and src/assess.js tell a cap stop by them.
const CAP_WORDS = {
  instance: "AI work is paused for now: the monthly AI cap for demos on Anetix is reached. Everything you built stays and keeps working; new requests wait until it is lifted. Write to brendan@anetix.ai or taylor@anetix.ai.",
  company: "This company's AI budget for the month is used up. Everything you built stays and keeps working; new requests wait until Anetix raises it or the month turns. Write to brendan@anetix.ai or taylor@anetix.ai.",
};
const capTold = new Set();   // "<cap> <month>": one alert a month per cap (in memory; a restart may send one more)
function capReached(which, usd, cap) {
  console.warn(`[cap] ${which} reached: $${usd.toFixed(2)} of $${cap.toFixed(2)} this month; new AI work is refused`);
  const key = `${which} ${new Date().toISOString().slice(0, 7)}`;
  if (capTold.has(key)) return;
  capTold.add(key);
  try { require("./notify").notify("AI cap reached", `${which} is reached for this month ($${usd.toFixed(2)} of $${cap.toFixed(2)}). New AI work is refused until it is raised; paying sites are not affected.`, { priority: 4, tags: ["money_with_wings"] }); } catch (_) { /* never */ }
}

module.exports = {
  withMeterTag,
  atWall,   // the data wall's choke point and the prompt log (src/datawall.js)
  noteApi,  // a failed call to the API, to the phones (src/credit.js); for a caller with its own call, as src/assist.js
  runAgent, runStructured, runChat, recordUsage, haveKey, fakeMode, guidanceFor, platformDocs, modelFor, modelInfo, buildModelFor, canBuild,
  MODELS, PRICE_ONLY, ALL_MODELS, JOBS, COMPANY_JOBS, AB_JOBS, inTier, cleanSettings, instanceModels, setInstanceModels, defaultModels, companyPins, pickModel, keepArm,
  SUMMARY_MODELS, SUMMARY_CHOICES, summaryModel,
  initMeter, meter, costOf, RETIRED_ENV, retiredEnvSet, MAX_RUN_USD, MAX_BATCH_USD, runCapUsd, MONTHLY_CAP_USD, monthlySpend, spendSince, assertUnderCap, companyCap, AGENT_EFFORT, CAP_WORDS,
};
