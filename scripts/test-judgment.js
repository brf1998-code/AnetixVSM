// Unit tests for steps that need judgment (2026-10-20): the proposer's approach (src/proposals.js), what the build is
// told (src/pipeline.js), the tool's judgment call's argument check (src/registry.js judgeArgs), fake mode's answer in
// the shape asked (src/agent.js fakeFromSchema), and the plain-words guard. No database.
//   node scripts/test-judgment.js
process.env.SOS_FAKE_AGENT = "1";
const P = require("../src/proposals");
const pipeline = require("../src/pipeline");
const registry = require("../src/registry");
const agent = require("../src/agent");
const plain = require("../src/plainwords");
let pass = 0, fail = 0;
const t = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log(`FAIL  ${name}${detail !== undefined ? "\n      " + JSON.stringify(detail).slice(0, 500) : ""}`); } };
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message) && e.status === 400; } };

// ---- cleanApproach
{
  t("an unknown how is no approach", P.cleanApproach({ how: "magic", step: "x", why: "y" }) === null);
  t("nothing is no approach", P.cleanApproach(null) === null && P.cleanApproach(undefined) === null);
  const r = P.cleanApproach({ how: "rules", step: "should go", why: "  every case\n is known " });
  t("rules carries no step, and the words are tidied", r.how === "rules" && r.step === "" && r.why === "every case is known", r);
  const m = P.cleanApproach({ how: "match_once", step: "x".repeat(900), why: "the template comes back" });
  t("a long step is cut", m.how === "match_once" && m.step.length === 300);
  t("the three ways", JSON.stringify(P.APPROACHES) === JSON.stringify(["rules", "judgment", "match_once"]));
}
// ---- what the build is told
{
  t("no approach, no line", pipeline.approachLine(null) === "" && pipeline.approachLine({}) === "");
  t("rules says fixed rules", /fixed rules/.test(pipeline.approachLine({ how: "rules" })));
  const j = pipeline.approachLine({ how: "judgment", step: "read the notes" });
  t("judgment names the call and the step", /ctx\.ai\.judge/.test(j) && /read the notes/.test(j), j);
  const m = pipeline.approachLine({ how: "match_once", step: "line up the headings" });
  t("match once says check, save, reuse", /check or fix/.test(m) && /saves it/.test(m) && /reuses/.test(m), m);
  t("needsJudgment is false for rules or nothing", !pipeline.needsJudgment([{ approach: { how: "rules" } }, { approach: null }, {}]));
  t("needsJudgment is true when one change needs it", pipeline.needsJudgment([{ approach: { how: "rules" } }, { approach: { how: "match_once" } }]));
  const base = { mod: "crm", isBatch: false, batch: "Approved proposal (functionality)", req: "", lane: "functionality", version: 13 };
  const without = pipeline.buildPrompt(base), withJ = pipeline.buildPrompt({ ...base, judgment: true }), walled = pipeline.buildPrompt({ ...base, judgment: true, walled: true });
  t("a build with no judgment step is told nothing new", !/ctx\.ai\.judge/.test(without));
  t("a build with one is told the call, the shape and the fallback", /ctx\.ai\.judge\(\{ task, input, answer \}\)/.test(withJ) && /never one per row/.test(withJ) && /by hand/.test(withJ) && /fixed list of other names/.test(withJ), withJ.slice(0, 300));
  t("a walled company's build is told the by-hand path is the one that works today", /walled off/.test(walled) && !/walled off/.test(withJ));
}
// ---- the proposal schema asks for the approach
{
  const fs = require("fs");
  const src = fs.readFileSync(require.resolve("../src/proposals"), "utf8");
  t("approach is required on every proposal", /required: \[\.\.\.\(triage \? \["triage"\] : \[\]\), "proposal", "approach"/.test(src));
  t("the brief is in every proposal prompt", /\$\{APPROACH_BRIEF\}/.test(src));
  t("the ask brief forbids asking how to build", /Never ask the person to choose between ways of building/.test(src));
}
// ---- judgeArgs
{
  const ok = registry.judgeArgs({ task: "match these", input: { headings: ["Client"] }, answer: { type: "object", properties: {} } });
  t("good arguments pass, input written out", ok.task === "match these" && ok.input === '{"headings":["Client"]}' && ok.kind === "judgment");
  t("text input stays text", registry.judgeArgs({ task: "x", input: "Client, Revenue", answer: { type: "string" } }).input === "Client, Revenue");
  t("no task is refused", throws(() => registry.judgeArgs({ input: "x", answer: { type: "object" } }), /needs a task/));
  t("no answer schema is refused", throws(() => registry.judgeArgs({ task: "x", input: "y" }), /needs answer/));
  t("a list as the schema is refused", throws(() => registry.judgeArgs({ task: "x", input: "y", answer: [] }), /needs answer/));
  t("a long task is refused", throws(() => registry.judgeArgs({ task: "x".repeat(4001), answer: { type: "object" } }), /4,000/));
  t("a whole file is refused with a plain reason", throws(() => registry.judgeArgs({ task: "x", input: "y".repeat(60001), answer: { type: "object" } }), /headings and a few sample rows/));
  t("a big schema is refused", throws(() => registry.judgeArgs({ task: "x", input: "y", answer: { type: "object", description: "z".repeat(8001) } }), /8,000/));
}
// ---- fake mode answers in the shape asked
{
  const schema = { type: "object", properties: { answer: { type: "object", properties: {
    matches: { type: "array", items: { type: "object" } }, field: { type: "string", enum: ["company", "owner"] }, n: { type: "integer" }, ok: { type: "boolean" }, note: { type: ["string", "null"] } },
    required: ["matches", "field", "n", "ok", "note"] } }, required: ["answer"] };
  const v = agent.fakeFromSchema(schema);
  t("the fake answer has the shape", v && v.answer && Array.isArray(v.answer.matches) && v.answer.field === "company" && v.answer.n === 0 && v.answer.ok === false && v.answer.note === "", v);
}
// ---- the manager never reads how it is built
{
  t("deterministic is not a plain word", plain.check("Should the tool be deterministic?").includes("deterministic"));
  t("agentic is not a plain word", plain.check("an agentic approach").includes("agentic"));
  t("plain behavior is", plain.check("The tool matches your headings itself and shows you the match to check once.").length === 0);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
