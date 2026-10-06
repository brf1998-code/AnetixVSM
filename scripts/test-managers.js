// Unit cases for src/managers.js, the pure part: reading a link, and whether an invitation is good now.
// No database: node scripts/test-managers.js
const M = require("../src/managers");
let pass = 0, fail = 0;
function t(name, cond, detail) { if (cond) pass++; else { fail++; console.log(`FAIL  ${name}${detail !== undefined ? "\n      " + JSON.stringify(detail) : ""}`); } }
const tok = "A".repeat(43), NOW = Date.UTC(2026, 9, 6, 12);
const row = (o = {}) => ({ id: 7, account_id: 3, company: "acme", token_hash: M.hashToken(tok), expires_at: new Date(NOW + 86400e3), used_at: null, ...o });
const acct = (o = {}) => ({ id: 3, role: "manager", company: "acme", status: "active", ...o });
t("a link is <id>.<token>", M.parse(`7.${tok}`).id === 7 && M.parse(`7.${tok}`).token === tok);
t("anything else is not a link", [null, "", "7", `x.${tok}`, `7.short`, `7.${tok}!`, `7.${"A".repeat(80)}`, `-1.${tok}`].every((v) => M.parse(v) === null));
t("a good invitation is ok", M.judge(row(), tok, acct(), { now: NOW }) === "ok");
t("no row, a wrong token, used, expired", M.judge(null, tok, acct(), { now: NOW }) === "no_row" && M.judge(row(), "B".repeat(43), acct(), { now: NOW }) === "bad_token" && M.judge(row({ used_at: new Date(NOW) }), tok, acct(), { now: NOW }) === "used" && M.judge(row({ expires_at: new Date(NOW - 1) }), tok, acct(), { now: NOW }) === "expired");
t("a wrong token is told nothing else, even when the link is also used and expired", M.judge(row({ used_at: new Date(NOW), expires_at: new Date(NOW - 1) }), "B".repeat(43), acct(), { now: NOW }) === "bad_token");
t("another account, a switched off one, an admin, or a manager of another company", M.judge(row(), tok, acct({ id: 4 }), { now: NOW }) === "wrong_account" && M.judge(row(), tok, acct({ status: "disabled" }), { now: NOW }) === "account_off" && M.judge(row(), tok, acct({ role: "admin" }), { now: NOW }) === "account_off" && M.judge(row(), tok, acct({ company: "other" }), { now: NOW }) === "account_off");
t("an account that already has a second step cannot be opened by a link", M.judge(row(), tok, acct(), { enrolled: true, now: NOW }) === "enrolled");
t("only the hash of a token is ever kept: 64 hex characters, not the token", /^[0-9a-f]{64}$/.test(M.hashToken(tok)) && M.hashToken(tok) !== tok);
t("seven days, twelve managers", M.DAYS === 7 && M.MAX === 12);
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
