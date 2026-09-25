// Unit cases for src/demos.js, the pure part: the money from a ledger, a new-tool request as a use case, the answers
// in order. No database: node scripts/test-demos.js
const d = require("../src/demos");
let pass = 0, fail = 0;
function t(name, cond, detail) { if (cond) pass++; else { fail++; console.log(`FAIL  ${name}${detail !== undefined ? "\n      " + JSON.stringify(detail) : ""}`); } }

const ledger = [
  { kind: "grant", delta_usd: "15.00", paid_usd: null },
  { kind: "purchase", delta_usd: "15.00", paid_usd: "30.00" },
  { kind: "purchase", delta_usd: "15.00", paid_usd: "30.00" },
  { kind: "adjust", delta_usd: "-5.00", paid_usd: null },
];
const m = d.moneyOf(ledger);
t("paid is what Stripe took, refills counted", m.paid_usd === 60 && m.purchases === 2, m);
t("credit bought, given and taken back are kept apart", m.bought_credit_usd === 30 && m.granted_usd === 15 && m.adjusted_usd === -5, m);
t("an empty ledger is all zeros", JSON.stringify(d.moneyOf([])) === JSON.stringify({ paid_usd: 0, purchases: 0, bought_credit_usd: 0, granted_usd: 0, adjusted_usd: 0 }));

const intake = { id: 7, status: "done", name: "weld-cell", created_at: "2026-09-25T12:00:00Z",
  answers: { name: "Weld cell tracker", purpose: "Track weld jobs waiting for inspection.", thing: "A welded frame", today: { picks: ["whiteboard", "spreadsheet"], other: "" }, r2q1: "Two inspectors" },
  rounds: [{ round: 2, questions: [{ id: "r2q1", kind: "text", text: "Who signs off?" }] }],
  design: { bluf: "A board of frames by stage with a sign-off button." } };
const uc = d.useCaseOf(intake, { company: "keystone", company_name: "Keystone Fab", live: true });
t("a use case carries the name, what it is for, what it tracks, how it is done today and the design", uc.name === "Weld cell tracker" && /inspection/.test(uc.purpose) && uc.thing === "A welded frame" && /whiteboard/i.test(uc.today) && /spreadsheet/i.test(uc.today) && /sign-off/.test(uc.bluf), uc);
t("and whether it is live, and the company", uc.live === true && uc.company === "keystone" && uc.company_name === "Keystone Fab" && uc.status === "done");
t("an intake with nothing answered is still a use case, with blanks", (() => { const x = d.useCaseOf({ id: 1, status: "answering", answers: {} }, {}); return x.name === null && x.purpose === null && x.bluf === null && x.live === false; })());
const qa = d.answersOf(intake);
t("the answers come fixed questions first, in order, then the generated round", qa.map((a) => a.id).join(",") === "name,purpose,thing,today,r2q1" && qa[0].question === "What should we call it?" && qa[4].question === "Who signs off?" && qa[4].answer === "Two inspectors" && qa[4].round === 2, qa);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
