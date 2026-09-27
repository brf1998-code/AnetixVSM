// Unit checks for src/companyview.js: what a manager or the floor reads of the platform's /api/ answers (no model
// names, no AI costs; Phase 2's first item, 2026-09-27).
//   node scripts/test-companyview.js
const c = require("../src/companyview");
let pass = 0, fail = 0;
const t = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log(`FAIL  ${name}${detail !== undefined ? "\n      " + JSON.stringify(detail).slice(0, 400) : ""}`); } };

t("a model's id, in any case, says the AI", c.words("building with claude-opus-5-5 instead; CLAUDE-FABLE-5-1 too") === "building with the AI instead; the AI too");
t("a label as written says the AI, the longest first", c.words("Opus 5.5 and Opus 5, then Haiku 4.5.") === "the AI and the AI, then the AI.");
t("a word typed in lower case stays, and so does a longer number", c.words("my sonnet 5 notes; Opus 5.55") === "my sonnet 5 notes; Opus 5.55");
t("the cost cap line loses its figure", c.words("build stopped: run cost passed the $4.00 cap for this run") === "build stopped: run cost passed the cap for this run");
t("a price someone typed stays", c.words("the part costs $4.00; our budget cap is $500") === "the part costs $4.00; our budget cap is $500");

const s = c.scrub({
  runs: [{ id: 3, model: "claude-opus-5-5", cost_usd: 1.2, evidence: { models_seen: ["claude-opus-5-5"], ab: { arm: "claude-fable-5-1" }, cross_check: { model: "platform checks", verdict: "fail", summary: "Fable 5.1 found" }, estimate_usd: 3 }, log: [{ note: "ok" }] }],
  feedback: [{ id: 1, proposal_model: "claude-fable-5-1", message: "make it bigger", question: { text: "which?", model: "claude-fable-5-1" } }],
  spend: { usd: 3 }, models: { list: [{ id: "claude-fable-5-1", label: "Fable 5.1" }], build: "claude-fable-5-1" }, maxRunUsd: 25, maxBatchUsd: 40,
  credit: { balance_usd: 2, credit_usd: 10, spent_usd: 8, unit_usd: 10, percent: 20, level: "amber", line: "20% left.", topup_url: "u" },
  at: new Date(0),
});
t("the keys that name a model or carry a cost are gone, wherever they sit", !/model|cost_usd|estimate_usd|"spend"|maxRunUsd|maxBatchUsd|"ab"/.test(JSON.stringify(s)), s);
t("the platform's own check keeps that fact", s.runs[0].evidence.cross_check.platform === true && s.runs[0].evidence.cross_check.verdict === "fail" && s.runs[0].evidence.cross_check.summary === "the AI found");
t("everything else stays as it was", s.runs[0].id === 3 && s.runs[0].log[0].note === "ok" && s.feedback[0].message === "make it bigger" && s.feedback[0].question.text === "which?" && s.at instanceof Date);
t("a demo's credit is its percent, level, line, link and whether it is used up", JSON.stringify(s.credit) === JSON.stringify({ percent: 20, level: "amber", line: "20% left.", topup_url: "u", out: false }), s.credit);
t("used up reads out", c.scrub({ credit: { balance_usd: -1.5, percent: 0, level: "red", line: "used up.", topup_url: "u" } }).credit.out === true);

const own = c.scrub({ sample: [{ part: "A-1", model: "Haas VF-2", model_no: "VF2" }], company: { name: "Claude Precision", slug: "claude-precision", monthly_cap_usd: 50, model_build: "claude-opus-5-5" }, evidence: { refunded_usd: 0.42 } });
t("a model column that is a machine's model stays, and so does a company called Claude", own.sample[0].model === "Haas VF-2" && own.sample[0].model_no === "VF2" && own.company.slug === "claude-precision" && own.company.name === "Claude Precision", own);
t("a company's budget and a pinned model are gone; a refund says only that it happened", own.company.monthly_cap_usd === undefined && own.company.model_build === undefined && own.evidence.refunded === true && own.evidence.refunded_usd === undefined, own);
t("the safety budget line loses its figure", c.words("build stopped at the safety budget ($4.00)") === "build stopped at the safety budget");
const req = (role, p) => ({ sosRole: role, path: p });
t("a spreadsheet's rows and a tool's files pass untouched", !c.applies(req("manager", "/api/c/acme/connections/scrap/sheet/upload")) && !c.applies(req("manager", "/api/c/acme/modules/scrap/export")));
t("it applies to a manager and the floor on /api/", c.applies(req("manager", "/api/c/acme/board")) && c.applies(req("floor", "/API/runs/3")));
t("never to an admin, a caller with no session role, or a tool's own routes", !c.applies(req("admin", "/api/c/acme/board")) && !c.applies(req(undefined, "/api/www/companies")) && !c.applies(req("manager", "/c/acme/m/scrap/api/rows")));
let sent = null;
const res = { json: (b) => { sent = b; return res; } };
c.middleware(req("manager", "/api/runs/3"), res, () => {});
res.json({ model: "claude-opus-5-5", id: 3 });
t("the middleware scrubs what the route sends", sent && sent.id === 3 && sent.model === undefined, sent);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
