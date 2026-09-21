// Unit cases for named admin accounts, the part with no database: the session cookie's shapes and lifetimes
// (src/auth.js), names, passwords and recovery codes (src/accounts.js). The one-time codes themselves have their
// own cases in the file: node src/totp.js. With a database: scripts/e2e/accounts.js.
//   node scripts/test-accounts.js
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "unit-test-secret";
process.env.SOS_ADMIN_PASSWORD = process.env.SOS_ADMIN_PASSWORD || "unit-admin-password";
const auth = require("../src/auth");
const accounts = require("../src/accounts");
let pass = 0, fail = 0;
function t(name, cond, detail) { if (cond) { pass++; } else { fail++; console.log(`FAIL  ${name}${detail ? "\n      " + detail : ""}`); } }
const H = 3600e3;
const craft = (role, company, gen, ageMs) => { const p = `${role}.${company}.${gen}.${(Date.now() - ageMs).toString(36)}`; return `${p}.${auth.hmac(p)}`; };

// ---- the admin cookie
const tok = auth.signAdmin(7, 3);
t("an admin cookie is admin.*<account>.<generation>.<time>.<mac>, five parts like every other", /^admin\.\*7\.3\.[0-9a-z]+\.[^.]+$/.test(tok) && tok.split(".").length === 5, tok);
const v = auth.verify(tok);
t("it verifies to the account, its generation, and every company", v && v.role === "admin" && v.account === 7 && v.gen === 3 && v.company === auth.ALL, JSON.stringify(v));
const shared = auth.verify(auth.signAdmin(0, 0));
t("account 0 is the shared admin password's session", shared && shared.role === "admin" && shared.account === 0 && shared.company === auth.ALL);
t("the admin cookie from before named accounts (company slot '*' alone) is nobody", auth.verify(craft("admin", "*", 0, 1000)) === null);
t("an admin cookie naming a company is nobody", auth.verify(craft("admin", "demo", 1, 1000)) === null);
t("an admin cookie with a made-up account slot is nobody", auth.verify(craft("admin", "*x", 1, 1000)) === null && auth.verify(craft("admin", "*-1", 1, 1000)) === null && auth.verify(craft("admin", "**1", 1, 1000)) === null);
const parts = tok.split("."), swap = (i, val) => parts.map((x, k) => (k === i ? val : x)).join(".");
t("changing the account breaks it", auth.verify(swap(1, "*8")) === null);
t("changing the generation breaks it", auth.verify(swap(2, "4")) === null);
t("a floor cookie cannot be turned into an admin one", auth.verify(auth.sign("floor", "demo", 1).replace(/^floor/, "admin")) === null);

// ---- lifetimes: admin 12 hours, floor and manager 30 days
t("an admin cookie 11 hours old still holds", auth.verify(craft("admin", "*7", 3, 11 * H)) !== null);
t("an admin cookie 13 hours old is nobody", auth.verify(craft("admin", "*7", 3, 13 * H)) === null);
t("the shared password's session ends at 12 hours too", auth.verify(craft("admin", "*0", 0, 13 * H)) === null);
t("a floor cookie 13 hours old holds", (auth.verify(craft("floor", "demo", 2, 13 * H)) || {}).role === "floor");
t("a manager cookie 29 days old holds", (auth.verify(craft("manager", "demo", 2, 29 * 24 * H)) || {}).role === "manager");
t("a manager cookie 31 days old is nobody", auth.verify(craft("manager", "demo", 2, 31 * 24 * H)) === null);
t("a cookie from the future is nobody", auth.verify(craft("admin", "*7", 3, -H)) === null && auth.verify(craft("floor", "demo", 2, -H)) === null);
const fl = auth.verify(auth.sign("floor", "demo", 4));
t("floor and manager cookies are what they were: role, company, generation, no account", fl && fl.role === "floor" && fl.company === "demo" && fl.gen === 4 && fl.account === undefined, JSON.stringify(fl));
t("the lifetimes are 12 hours and 30 days unless the environment says otherwise", auth.ADMIN_SESSION_SECONDS === 12 * 3600 && auth.SESSION_SECONDS === 30 * 24 * 3600);

// ---- what an account without an authenticator may reach
const E = auth.ENROLL_PATHS;
t("before the authenticator is set up: the admin page, who-am-I and the two setup calls", ["/admin", "/api/admin/accounts/me", "/api/admin/accounts/me/enroll/start", "/api/admin/accounts/me/enroll/verify"].every((p) => E.test(p)));
t("and nothing else", ["/", "/api/admin/accounts", "/api/admin/overview", "/api/admin/backup", "/api/admin/accounts/me/password", "/api/admin/accounts/2/reset-factor", "/admin/", "/adminx", "/c/demo/", "/api/admin/accounts/me/enroll/verify/x"].every((p) => !E.test(p)));

// ---- names, passwords, recovery codes
t("a name is an email address, lower case", accounts.cleanLogin("  BRF1998@Gmail.com ") === "brf1998@gmail.com" && accounts.validLogin("taylor.pearlman@gmail.com") && accounts.validLogin("a+b@anetix.co"));
t("what is not an email address is refused", ["brendan", "a@b", "@gmail.com", "a b@gmail.com", "a@b.c", "", "a'@b.com", 'a"@b.com', "a<@b.com"].every((x) => !accounts.validLogin(accounts.cleanLogin(x))));
t("a password needs 12 characters", accounts.passwordProblem("elevenchars") !== null && accounts.passwordProblem("twelve-chars") === null && accounts.passwordProblem("") !== null && accounts.passwordProblem("x".repeat(201)) !== null);
const codes = accounts.makeRecoveryCodes();
t("ten recovery codes, xxxx-xxxx-xxxx-xxxx, none alike", codes.length === 10 && new Set(codes).size === 10 && codes.every((c) => /^[a-hj-km-np-z2-9]{4}(-[a-hj-km-np-z2-9]{4}){3}$/.test(c)), codes[0]);
t("no letter or digit in one that reads as another (0 o 1 l i)", codes.every((c) => !/[01oli]/.test(c)));
t("a recovery code is matched whatever the case, spaces or dashes", accounts.recoveryHash("ABCD-efgh 2345 jkmn") === accounts.recoveryHash("abcdefgh2345jkmn") && accounts.recoveryHash("abcd") !== accounts.recoveryHash("abce"));
t("the hash is not the code", !accounts.recoveryHash(codes[0]).includes(codes[0].replace(/-/g, "")) && /^[0-9a-f]{64}$/.test(accounts.recoveryHash(codes[0])));
t("the lock is five tries and fifteen minutes unless the environment says otherwise", accounts.MAX_FAILS === 5 && accounts.LOCK_MINUTES === 15);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
