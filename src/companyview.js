// What a company's own people read of the platform's answers (CLAUDE.md hard rule: no model names and no AI costs
// shown to companies; the launch audit, Phase 2's first item, 2026-09-27). The pages never showed them, but the JSON
// behind the board, the new-tool popout, the record, a run and the reviews carried which model did what and what it
// cost, and a run's log could say "building with claude-... instead" or "run cost passed the $4.00 cap".
//
// One scrub on every /api/ answer to a manager or floor session (middleware, mounted after sign-in in server.js); an
// admin, anetix.ai's key and a module's own routes (/c/<slug>/m/...) are never touched. What it does:
//   - drops the keys that name a model or carry an AI cost (DROP below) wherever they sit;
//   - a second review's verdict by the platform's own checks keeps that fact as { platform: true } (the board reads it
//     to say nothing was staged) instead of its "model";
//   - a demo's credit keeps its percent, level, line, top-up link and whether it is used up, never the dollars;
//   - any string naming a model (its id or its label) says "the AI" instead, and a line about a cost cap loses the
//     dollar amount.
// Admin pages that need the figures read the same routes as an admin.
// Keys that carry an AI cost: dropped wherever they sit. refunded_usd (a demo's stopped build, src/demostops.js) becomes
// refunded: true.
const COST = new Set(["cost_usd", "costUsd", "sdk_cost_usd", "estimate_usd", "spend", "maxRunUsd", "maxBatchUsd", "cap_usd", "monthly_cap_usd", "refunded_usd"]);
// Keys that name a model: dropped when what they hold names one (a model's id or label, or a list or record holding
// one), so a tool's own "model" column (a machine's model) is never touched.
const MODEL = new Set(["model", "models", "proposal_model", "models_seen", "review_model", "arm", "ab", "model_propose", "model_build", "model_review"]);
const DROP = new Set([...COST, ...MODEL]);
let names = null;   // model ids and labels, longest first so "Opus 5.5" goes before "Opus 5"
function modelNames() {
  if (names) return names;
  const all = require("./agent").ALL_MODELS || [];
  names = [...new Set(all.flatMap((m) => [m.id, m.label]).filter(Boolean))].sort((a, b) => b.length - a.length);
  return names;
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
let idRe = null, labelRe = null;
function words(s) {
  // an id in any case ("claude-opus-5-5"); a label as written ("Opus 5.5"), so a word someone typed in lower case stays
  if (!idRe) {
    const all = modelNames();
    // only a model's id (claude-<family>-...): a company, a slug or a person called Claude-something is theirs
    idRe = /\bclaude-(?:opus|sonnet|haiku|fable|instant)(?:-[0-9a-z]+)*\b/gi;
    labelRe = new RegExp(`\\b(?:${all.filter((n) => !/^claude-/i.test(n)).map(esc).join("|")})(?!\\w|\\.\\d)`, "g");
  }
  let out = s.replace(idRe, "the AI").replace(labelRe, "the AI");
  // the safety budget line ("build stopped at the safety budget ($X)") loses its figure the same way
  if (/safety budget \(\$/.test(out)) out = out.replace(/ \(\$\d[\d,]*(?:\.\d+)?\)/g, "");
  // the platform's cost cap line ("build stopped: run cost passed the $4.00 cap for this run") keeps its point and loses
  // the figure; a dollar amount anyone typed (a part's price in a request) is theirs and stays
  if (/run cost passed the \$/.test(out)) out = out.replace(/run cost passed the \$\d[\d,]*(?:\.\d+)? cap/g, "run cost passed the cap");
  return out;
}
function credit(c) {
  const out = { percent: c.percent, level: c.level, line: c.line, topup_url: c.topup_url, out: Number(c.balance_usd) <= 0 };
  if (c.since !== undefined) out.since = c.since;
  return out;
}
// does this value name a model (a string, or anything holding one)?
function namesModel(x) {
  if (x == null) return false;
  if (typeof x === "string") return x === "platform checks" || words(x) !== x || modelNames().includes(x);
  if (typeof x === "object") { try { const j = JSON.stringify(x); return words(j) !== j; } catch (e) { return true; } }
  return false;
}
function scrub(v, depth = 0) {
  if (depth > 40 || v == null) return v;
  if (typeof v === "string") return words(v);
  if (Array.isArray(v)) return v.map((x) => scrub(x, depth + 1));
  if (typeof v !== "object" || v instanceof Date || Buffer.isBuffer(v)) return v;
  if ("balance_usd" in v && "line" in v && "level" in v) return credit(v);
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    if (COST.has(k)) { if (k === "refunded_usd") out.refunded = Number(x) > 0; continue; }
    if (MODEL.has(k) && namesModel(x)) { if (k === "model" && x === "platform checks") out.platform = true; continue; }
    out[k] = scrub(x, depth + 1);
  }
  return out;
}
// Who gets the scrub: a signed-in manager or floor session, on the platform's own /api/ routes.
// Two kinds of answer are the company's own and pass untouched: a spreadsheet's rows on the connections routes (a
// column may be called model or cost_usd) and a tool's files (code, /modules/<name>/export).
const OWN = [/^\/api\/c\/[^/]+\/connections(?:\/|$)/i, /^\/api\/c\/[^/]+\/modules\/[^/]+\/export$/i];
function applies(req) {
  const role = req.sosRole;
  if (!role || role === "admin") return false;
  const p = String(req.path || "");
  return /^\/api\//i.test(p) && !OWN.some((re) => re.test(p));
}
function middleware(req, res, next) {
  if (!applies(req)) return next();
  const json = res.json.bind(res);
  res.json = (body) => json(scrub(body));
  next();
}

module.exports = { scrub, middleware, applies, words, namesModel, DROP, COST, MODEL };
