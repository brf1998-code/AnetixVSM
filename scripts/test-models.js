// Unit cases for the two-model tier (src/agent.js), the head-to-head scorecard and its reading (src/assess.js)
// and the live A/B split (src/health.js abSplit). No database, no tokens: node scripts/test-models.js
const agent = require("../src/agent");
const assess = require("../src/assess");
const health = require("../src/health");

let pass = 0, fail = 0;
function t(name, cond, detail) { if (cond) pass++; else { fail++; console.log(`FAIL  ${name}${detail !== undefined ? "\n      " + JSON.stringify(detail).slice(0, 500) : ""}`); } }
const F = "claude-fable-5-1", O = "claude-opus-5-5";

// ---- the tier
t("two models, Fable 5.1 and Opus 5.5", agent.MODELS.map((m) => m.id).join() === `${F},${O}`);
t("Opus 5.5 is priced $4 / $20", agent.modelInfo(O).in === 4 && agent.modelInfo(O).out === 20);
t("Haiku still prices the plain summaries", agent.modelInfo("claude-haiku-4-5-20251001").in === 1 && !agent.inTier("claude-haiku-4-5-20251001"));
t("Sonnet 5 and Opus 5 are priced but run no main job", agent.modelInfo("claude-sonnet-5").in === 2 && agent.modelInfo("claude-opus-5").out === 25 && !agent.inTier("claude-sonnet-5") && !agent.inTier("claude-opus-5"));
t("the short text jobs may run on Sonnet 5, Haiku 4.5 or either main model, never Opus 5", agent.SUMMARY_CHOICES.join() === "claude-sonnet-5,claude-haiku-4-5-20251001,claude-fable-5-1,claude-opus-5-5");
t("both refuse a forced tool_choice", agent.MODELS.every((m) => m.forcedTool === false));
{
  const s = agent.cleanSettings("");
  t("nothing saved: Fable is the baseline, no job of its own, A/B off", s.baseline === F && !Object.keys(s.jobs).length && s.ab.on === false, s);
  const s2 = agent.cleanSettings(JSON.stringify({ baseline: O, jobs: { build: F, review: "claude-sonnet-5", nonsense: O }, ab: { on: true, jobs: ["build", "review", "propose"] } }));
  t("a saved baseline and a job of its own are kept; a retired model or an unknown job is not", s2.baseline === O && s2.jobs.build === F && !("review" in s2.jobs) && !("nonsense" in s2.jobs), s2);
  t("the A/B keeps only the jobs it can split (a review follows its build)", s2.ab.on && s2.ab.jobs.join() === "build,propose" && s2.ab.since, s2.ab);
  t("a baseline outside the tier falls back to Fable", agent.cleanSettings({ baseline: "claude-sonnet-5" }).baseline === F);
  process.env.SOS_MODEL_BASELINE = O;
  t("SOS_MODEL_BASELINE is the first baseline until one is saved", agent.cleanSettings("").baseline === O && agent.cleanSettings({ baseline: F }).baseline === F);
  delete process.env.SOS_MODEL_BASELINE;
  t("garbage in the setting reads as nothing saved", agent.cleanSettings("{not json").baseline === F);
  t("nothing saved: the short text jobs run on Sonnet 5", agent.cleanSettings("").summary === "claude-sonnet-5");
  t("a saved short text model is kept, one of the main two included", agent.cleanSettings({ summary: O }).summary === O && agent.cleanSettings({ summary: "claude-haiku-4-5-20251001" }).summary === "claude-haiku-4-5-20251001");
  t("a retired or unknown one falls back to Sonnet 5", agent.cleanSettings({ summary: "claude-opus-5" }).summary === "claude-sonnet-5" && agent.cleanSettings({ summary: "nope" }).summary === "claude-sonnet-5");
  process.env.SOS_MODEL_SUMMARY = "claude-haiku-4-5-20251001";
  t("SOS_MODEL_SUMMARY is the first short text model until one is saved", agent.cleanSettings("").summary === "claude-haiku-4-5-20251001" && agent.cleanSettings({ summary: F }).summary === F);
  delete process.env.SOS_MODEL_SUMMARY;
}
{
  const had = process.env.SOS_MODEL_PROPOSE; process.env.SOS_MODEL_PROPOSE = "claude-sonnet-5";
  t("the old per-job variables are named as retired when set", agent.retiredEnvSet().includes("SOS_MODEL_PROPOSE"));
  if (had == null) delete process.env.SOS_MODEL_PROPOSE; else process.env.SOS_MODEL_PROPOSE = had;
}

// ---- the scorecard and its reading
let tid = 1;
const trial = (kind, source_id, model, score, extra = {}) => ({ id: tid++, kind, source_id, model, status: "done", score, cost_usd: model === F ? 0.25 : 0.1, ms: model === F ? 20000 : 12000, ...extra });
const pk = (kind, source_id, winner, pick = winner ? "left" : "same") => ({ kind, source_id, winner, pick });
{
  const trials = [], picks = [];
  for (let i = 1; i <= 6; i++) { trials.push(trial("proposal", i, F, { class_match: true, target_match: true })); trials.push(trial("proposal", i, O, { class_match: i !== 6, target_match: true })); }
  picks.push(pk("proposal", 1, O), pk("proposal", 2, F), pk("proposal", 3, null), pk("proposal", 4, O), pk("proposal", 5, null), pk("proposal", 6, F));
  const card = assess.scorecard(trials, picks, [F, O], F);
  const p = card.kinds.proposal;
  t("per kind and model: done, cost, time, class and screen agreement", p.models[F].done === 6 && p.models[O].class.n === 5 && p.models[O].class.of === 6 && p.models[F].secs_avg === 20 && p.models[O].cost_avg === 0.1, p);
  t("blind picks counted per model, same and neither apart", p.picked === 6 && p.models[O].wins === 2 && p.models[O].losses === 2 && p.same === 2, p);
  t("even picks, 17 points apart on class: worse by the points rule", card.reading.verdict.startsWith("Keep Fable 5.1") && /worse/.test(card.reading.lines[0]), card.reading);
  const picks2 = picks.map((x) => (x.source_id === 6 ? pk("proposal", 6, null) : x));
  const trials2 = trials.map((x) => (x.kind === "proposal" && x.model === O ? { ...x, score: { class_match: true, target_match: true } } : x));
  const c2 = assess.scorecard(trials2, picks2, [F, O], F);
  t("no kind worse and cheaper: suggests the other model", c2.reading.suggest === O && /held up/.test(c2.reading.verdict) && /40% of the cost/.test(c2.reading.verdict), c2.reading);
  const c3 = assess.scorecard(trials2.slice(0, 6), [], [F, O], F);
  t("too few cases: says so, suggests nothing", c3.reading.suggest === null && /Too few/.test(c3.reading.verdict), c3.reading);
  const c4 = assess.scorecard(trials2, picks2, [F, O], O);
  t("the reading is always about the model that is NOT the baseline", c4.reading.challenger === F && c4.reading.suggest === null, c4.reading);
}
{
  const trials = [];
  for (let i = 1; i <= 5; i++) { trials.push(trial("crosscheck", i, F, { expected: "pass", matches: true })); trials.push(trial("crosscheck", i, O, { expected: "pass", matches: i <= 4 })); }
  const card = assess.scorecard(trials, [], [F, O], F);
  t("a cross-check kind speaks with no picks (label agreement only)", card.kinds.crosscheck.blind === false && card.reading.speaking === 1 && card.kinds.crosscheck.models[O].label.n === 4, card.reading);
  t("80% against 100%: 20 points under, worse", /worse/.test(card.reading.lines[0]) && card.reading.suggest === null, card.reading);
}
{
  const trials = [];
  for (let i = 1; i <= 5; i++) { trials.push(trial("build", i, F, { changed: true, gate_ok: true, self_pass: true, other_pass: true, files: 2 })); trials.push(trial("build", i, O, { changed: i !== 5, gate_ok: true, self_pass: true, other_pass: i !== 5, files: 1 })); }
  const picks = [1, 2, 3, 4, 5].map((i) => pk("build", i, i <= 3 ? O : F));
  const card = assess.scorecard(trials, picks, [F, O], F);
  const b = card.kinds.build.models[O];
  t("builds: gate, own check, the other model's check, files, changed nothing", b.gate.n === 5 && b.other.n === 4 && b.unchanged === 1 && b.files_avg === 1, b);
  t("won 3 lost 2, but 20 points under on the other model's check: the points rule still says worse", /worse/.test(card.reading.lines[0]) && card.reading.suggest === null, card.reading);
  const even = assess.scorecard(trials.map((x) => (x.model === O ? { ...x, score: { ...x.score, other_pass: true } } : x)), picks, [F, O], F);
  t("the same picks with the check level: no clear difference, and cheaper, so it suggests the switch", /no clear difference/.test(even.reading.lines[0]) && even.reading.suggest === O, even.reading);
  t("totals add up per model", card.totals[F].cost_usd === 1.25 && card.totals[O].done === 5, card.totals);
}
{
  const s = { models: [F, O], id: 7 };
  const a = assess.sides(s, "proposal", 3), b = assess.sides(s, "proposal", 3);
  t("the blind side is a fixed coin per case", a.left === b.left && a.left !== a.right && [F, O].includes(a.left));
  let flips = 0; for (let i = 1; i <= 40; i++) if (assess.sides(s, "build", i).left === F) flips++;
  t("and both models land on the left across cases", flips > 5 && flips < 35, flips);
}
t("a build case costs more than a cross-check, Fable more than Opus 5.5", assess.estimateCase("build", F) > assess.estimateCase("crosscheck", F) && assess.estimateCase("proposal", F) > assess.estimateCase("proposal", O));

// ---- the live A/B split
{
  const NOW = new Date("2026-10-10T12:00:00Z"), since = "2026-10-01T00:00:00Z";
  const ago = (h) => new Date(NOW.getTime() - h * 3600e3).toISOString();
  const fb = (id, extra = {}) => ({ id, company: "demo", status: "done", created_at: ago(100), ...extra });
  const prop = (id, feedback_id, model, status = "approved") => ({ id, feedback_id, company: "demo", status, created_at: ago(99), model, cost_usd: model === F ? 0.2 : 0.08 });
  const run = (id, pid, arm, { deployed = 90, rolledBack, stops = [], ready = 91, cost = 1 } = {}) => ({
    id, company: "demo", module: "paperline", lane: "ui", status: "deployed", step: "deploy", model: arm, proposal_id: pid, proposal_ids: null, created_at: ago(95), cost_usd: cost,
    evidence: arm ? { ab: { arm, since } } : {},
    log: [...stops.map((n) => ({ t: ago(94), step: "error", note: n })), { t: ago(ready), step: "visual_check", note: "checks passed; ready for manager review" }, deployed != null ? { t: ago(deployed), step: "deploy", note: "live" } : null, rolledBack != null ? { t: ago(rolledBack), step: "rollback", note: "back" } : null].filter(Boolean),
  });
  const feedback = [fb(1, { floor_answer: "fixed", floor_answer_at: ago(80), shipped_at: ago(90) }), fb(2, { floor_answer: "not_quite", floor_answer_at: ago(80), shipped_at: ago(90) }), fb(3, { manager_answer: "done", manager_answer_at: ago(80), shipped_at: ago(90) }), fb(4), fb(5)];
  const proposals = [prop(11, 1, F), prop(12, 2, O), prop(13, 3, O), prop(14, 4, O, "declined"), prop(15, 5, F)];
  const runs = [run(21, 11, F, { cost: 2 }), run(22, 12, O, { stops: ["cross-check failed: x"], rolledBack: 85 }), run(23, 13, O), run(24, 15, null)];
  const arms = [{ job: "propose", ref: "feedback:1", model: F, created_at: ago(100) }, { job: "propose", ref: "feedback:2", model: O, created_at: ago(100) }, { job: "propose", ref: "feedback:3", model: O, created_at: ago(100) }, { job: "propose", ref: "feedback:4", model: O, created_at: ago(100) }, { job: "design", ref: "intake:1", model: O, created_at: ago(100) }];
  const record = [{ kind: "proposal_edited", proposal_id: 12, company: "demo", created_at: ago(98) }];
  const intakes = [{ id: 1, company: "demo", status: "done", created_at: ago(100), model: O, cost_usd: 3 }];
  const out = health.abSplit({ feedback, proposals, runs, record, intakes, arms }, { since, models: [F, O], now: NOW });
  t("only runs the A/B put on an arm count (a run with no arm is left out)", out[F].builds.started === 1 && out[O].builds.started === 2, { f: out[F].builds, o: out[O].builds });
  t("shipped, rolled back and the reviewer's stop land on the right arm", out[O].builds.shipped === 2 && out[O].builds.rolled_back === 1 && out[O].builds.stops.reviewer === 1 && out[F].builds.stops.reviewer === 0);
  t("what the floor and manager said, per arm", out[F].answers.met === 1 && out[O].answers.missed === 1 && out[O].answers.met === 1, { f: out[F].answers, o: out[O].answers });
  t("build spend per arm", out[F].builds.cost_usd === 2 && out[O].builds.cost_per_run === 1);
  t("proposals drafted on each arm, approved, edited, declined", out[O].proposals.drafted === 3 && out[O].proposals.edited === 1 && out[O].proposals.declined === 1 && out[F].proposals.drafted === 1, out[O].proposals);
  t("new modules per arm", out[O].intakes.started === 1 && out[O].intakes.done === 1 && out[F].intakes.started === 0);
  t("minutes from start to the deploy gate", out[F].builds.to_gate_median_minutes === 240, out[F].builds);
  const ended = health.abSplit({ feedback, proposals, runs, record, intakes, arms }, { since, until: ago(200), models: [F, O], now: NOW });
  t("a test that ended counts nothing after its end", ended[O].builds.started === 0 && ended[O].proposals.drafted === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
