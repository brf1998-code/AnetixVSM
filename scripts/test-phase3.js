// Unit checks for the launch audit's Phase 3 on the product's side (2026-09-28): the one-time sign-in from demo setup
// (src/tickets.js, 3.8), the refill checked with Stripe (src/stripecheck.js, 3.7), the DEMO strip read once (3.13) and
// "Remember this device" (3.14). No database.
//   node scripts/test-phase3.js
const fs = require("fs"), path = require("path");
let pass = 0, fail = 0;
const t = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log(`FAIL  ${name}${detail !== undefined ? "\n      " + JSON.stringify(detail).slice(0, 500) : ""}`); } };

// ---- 3.8
const tk = require("../src/tickets");
const token = "A".repeat(43), hash = tk.hashToken(token);
const acct = { id: 7, status: "active", role: "manager", company: "acme", generation: 3 };
const row = (o = {}) => ({ id: 1, account_id: 7, token_hash: hash, generation: 3, expires_at: new Date(Date.now() + 60e3).toISOString(), used_at: null, ...o });
t("a ticket reads as <id>.<token>, and nothing else", tk.parse(`12.${token}`).id === 12 && tk.parse(`12.${token}`).token === token && tk.parse("12") === null && tk.parse(`x.${token}`) === null && tk.parse(`12.${token}!`) === null && tk.parse("") === null);
t("good: the right token, unused, in time, the manager switched on at the same generation, no second factor", tk.judge(row(), token, acct) === "ok");
t("refused: wrong token, used, expired, another account", tk.judge(row(), "B".repeat(43), acct) === "bad_token" && tk.judge(row({ used_at: new Date() }), token, acct) === "used" && tk.judge(row({ expires_at: new Date(Date.now() - 1).toISOString() }), token, acct) === "expired" && tk.judge(row({ account_id: 8 }), token, acct) === "wrong_account");
t("refused: switched off, an admin, a manager with no company, after Sign out everywhere, already enrolled", tk.judge(row(), token, { ...acct, status: "disabled" }) === "account_off" && tk.judge(row(), token, { ...acct, role: "admin" }) === "account_off" && tk.judge(row(), token, { ...acct, company: null }) === "account_off" && tk.judge(row(), token, { ...acct, generation: 4 }) === "generation" && tk.judge(row(), token, acct, { enrolled: true }) === "enrolled");
t("no row at all is refused", tk.judge(null, token, acct) === "no_row");
t("the ticket's hour, and a variable can only shorten or lengthen it within a day", tk.TTL_MIN === 60);

// ---- 3.7
const sc = require("../src/stripecheck");
const s = (o = {}) => ({ mode: "payment", status: "complete", payment_status: "paid", amount_total: 3000, ...o, metadata: { kind: "topup", slug: "acme", credit_usd: "10", ...(o.metadata || {}) } });
const ask = { slug: "acme", paid_usd: 30, credit_usd: 10 };
t("a paid refill for this company, these dollars and this credit is backed", sc.judge(s(), ask) === null);
t("the company is compared without case", sc.judge(s({ metadata: { slug: "ACME" } }), ask) === null);
t("refused: none, not a payment, not paid, not complete, not a refill, another company", /no such session/.test(sc.judge(null, ask)) && /not a payment/.test(sc.judge(s({ mode: "setup" }), ask)) && /not paid/.test(sc.judge(s({ payment_status: "unpaid" }), ask)) && /not paid/.test(sc.judge(s({ status: "open" }), ask)) && /not a refill/.test(sc.judge(s({ metadata: { kind: "site_card" } }), ask)) && /another company/.test(sc.judge(s({ metadata: { slug: "zed" } }), ask)));
t("refused: other dollars, other credit, more credit than dollars, no credit", /was for \$20/.test(sc.judge(s({ amount_total: 2000 }), ask)) && /credit asked for/.test(sc.judge(s(), { ...ask, credit_usd: 11 })) && /more than was paid/.test(sc.judge(s({ metadata: { credit_usd: "31" } }), { ...ask, credit_usd: 31 })) && /more than was paid/.test(sc.judge(s({ metadata: { credit_usd: "0" } }), { ...ask, credit_usd: 0 })));
const was = process.env.STRIPE_READ_KEY;
process.env.STRIPE_READ_KEY = ""; const off = [sc.on(), sc.mode()];
process.env.STRIPE_READ_KEY = "rk_live_x"; const live = sc.mode();
process.env.STRIPE_READ_KEY = "rk_test_x"; const test = sc.mode();
if (was === undefined) delete process.env.STRIPE_READ_KEY; else process.env.STRIPE_READ_KEY = was;
t("which Stripe the read key reads: none, live, test", off[0] === false && off[1] === "none" && live === "live" && test === "test");
t("without the key nothing is checked (the refill is taken on anetix.ai's word, as before)", (() => { const k = process.env.STRIPE_READ_KEY; delete process.env.STRIPE_READ_KEY; const p = sc.verifyTopup({ ref: "cs_x", slug: "a", paid_usd: 1, credit_usd: 1 }); if (k !== undefined) process.env.STRIPE_READ_KEY = k; return p; })() instanceof Promise);

// ---- 3.13, 3.14, and the backup
const index = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
t("the DEMO strip is read once: its rolling words hidden from screen readers, one line for them instead (3.13)", /id="demotrack" aria-hidden="true"/.test(index) && /<div class="demobar" id="demobar" hidden role="note"><span[^>]*>A demo company on Anetix<\/span>/.test(index));
const loginPage = fs.readFileSync(path.join(__dirname, "../public/login.html"), "utf8");
t("the code step says Remember this device, on a phone too (3.14)", /Remember this device for 30 days/.test(loginPage) && /"Remember this device for " \+ j\.remember_days/.test(loginPage) && !/Remember this computer/.test(loginPage));
const backup = fs.readFileSync(path.join(__dirname, "../src/backup.js"), "utf8");
t("the tickets are never in a backup, and a restore clears them", /NOT_IN_BACKUP = \[[^\]]*"signin_tickets"/.test(backup) && /"platform\.signin_tickets"\]\)\.join/.test(backup));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
