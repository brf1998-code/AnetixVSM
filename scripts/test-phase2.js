// Unit checks for the launch audit's Phase 2 (2026-09-28): who is stuck (src/demos.js stuckOf), the open switch
// (src/auth.js, 2.12), one pin message (src/selfserve.js pinMessage, 2.8). No database: auth is loaded in child
// processes with the environment each case needs.
//   node scripts/test-phase2.js
const { execFileSync } = require("child_process");
const path = require("path");
let pass = 0, fail = 0;
const t = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log(`FAIL  ${name}${detail !== undefined ? "\n      " + JSON.stringify(detail).slice(0, 500) : ""}`); } };

// ---- 2.9: who is stuck
const { stuckOf } = require("../src/demos");
const now = Date.parse("2026-09-28T12:00:00Z"), H = 3600e3, D = 24 * H;
const base = (over) => ({ slug: "a", name: "A", since: new Date(now - 3 * D).toISOString(), manager: { enrolled: true, locked: false }, counts: { intakes: 1, requests: 2, stopped_now: 0 }, modules: [{ name: "x" }], money: { balance_usd: 4 }, seen: false, ...over });
const kinds = (x) => stuckOf({ demos: [x], now }).map((s) => s.kind);
t("a demo going well is not stuck", kinds(base()).length === 0);
t("locked", kinds(base({ manager: { enrolled: true, locked: true } })).includes("locked"));
t("a build stopped and not started again", kinds(base({ counts: { intakes: 1, requests: 2, stopped_now: 1 } })).includes("stopped"));
t("out of credit, and whether it was seen", stuckOf({ demos: [base({ money: { balance_usd: -0.2 }, seen: true })], now })[0].seen === true && /marked seen/.test(stuckOf({ demos: [base({ money: { balance_usd: 0 }, seen: true })], now })[0].text));
t("the sign-in not set up after an hour, not before", kinds(base({ manager: { enrolled: false }, since: new Date(now - 2 * H).toISOString() })).includes("no_2fa") && !kinds(base({ manager: { enrolled: false }, since: new Date(now - 20 * 60e3).toISOString() })).length);
t("signed in and nothing started after a day", kinds(base({ counts: { intakes: 0, requests: 0, stopped_now: 0 }, modules: [] })).includes("idle") && !kinds(base({ counts: { intakes: 0, requests: 0 }, modules: [], since: new Date(now - 5 * H).toISOString() })).length);
t("a paying site is the Sites tab's, not here", kinds(base({ subscribed: { since: "x" }, manager: { enrolled: true, locked: true } })).length === 0);
const pins = [{ id: 1, label: "Kim", email: "kim@x.test", uses: 0, created_at: new Date(now - 3 * D).toISOString(), problem: null },
  { id: 2, label: "Used", uses: 1, created_at: new Date(now - 9 * D).toISOString(), problem: null },
  { id: 3, label: "Cancelled", uses: 0, created_at: new Date(now - 9 * D).toISOString(), problem: "cancelled" },
  { id: 4, label: "New", uses: 0, created_at: new Date(now - 5 * H).toISOString(), problem: null }];
const ps = stuckOf({ pins, now });
t("a live pin unused for two days, and only that one", ps.length === 1 && ps[0].kind === "pin" && ps[0].pin_id === 1 && /Kim \(kim@x\.test\)/.test(ps[0].text) && /3 days/.test(ps[0].text), ps);
const order = stuckOf({ demos: [base({ slug: "p", manager: { enrolled: false }, since: new Date(now - 5 * H).toISOString() }), base({ slug: "q", manager: { enrolled: true, locked: true } })], pins, now }).map((s) => s.kind);
t("the ones to act on first come first", order[0] === "locked" && order[order.length - 1] === "pin", order);

// ---- 2.12: open only when asked for, and never hosted
const openWith = (env) => execFileSync(process.execPath, ["-e", "console.log(require('./src/auth').OPEN)"], { cwd: path.join(__dirname, ".."), env: { PATH: process.env.PATH, DATABASE_URL: "postgres://x@127.0.0.1:1/x", SESSION_SECRET: "t", ...env }, stdio: ["ignore", "pipe", "ignore"] }).toString().trim().split("\n").pop();
t("no password variables no longer means open", openWith({}) === "false");
t("SOS_OPEN=1 opens a local instance", openWith({ SOS_OPEN: "1" }) === "true");
t("but never one on Railway", openWith({ SOS_OPEN: "1", RAILWAY_ENVIRONMENT: "production" }) === "false" && openWith({ SOS_OPEN: "1", RAILWAY_PROJECT_ID: "p" }) === "false");
t("or one with NODE_ENV=production", openWith({ SOS_OPEN: "1", NODE_ENV: "production" }) === "false");
t("and a password variable set does not open anything", openWith({ SOS_FLOOR_PASSWORD: "x" }) === "false");

// ---- 2.8: the pin message
const { pinMessage } = require("../src/selfserve");
const m = pinMessage({ name: "Sam at Acme Wire", email: "sam@acme.test", pin: "K7RM-4XQP", days: 30, url: "https://anetix.ai/" });
t("the first name, the pin, the email, the pin link and how long", /^Hi Sam,/.test(m) && m.includes("K7RM-4XQP") && m.includes("sam@acme.test") && m.includes("https://anetix.ai/pin") && /30 days/.test(m));
t("what to have ready, how to come back, where to get help", /Face ID or a fingerprint/.test(m) && /authenticator app/.test(m) && /To come back later, go to https:\/\/anetix\.ai and choose Sign in/.test(m) && /brendan@anetix\.ai or taylor@anetix\.ai/.test(m));
t("no dashes, no we", !/[–—]/.test(m) && !/ - /.test(m) && !/\b(we|our)\b/i.test(m), m);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
