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
t("an admin cookie is admin.*<account>.<generation>.<issued>.<refreshed>.<mac>, six parts like every other", /^admin\.\*7\.3\.[0-9a-z]+\.[0-9a-z]+\.[^.]+$/.test(tok) && tok.split(".").length === 6, tok);
const v = auth.verify(tok);
t("it verifies to the account, its generation, and every company", v && v.role === "admin" && v.account === 7 && v.gen === 3 && v.company === auth.ALL, JSON.stringify(v));
t("a fresh cookie is not due a refresh and is not the old shape", v && v.refresh === false && v.legacy === false && v.issued === v.refreshed);
const shared = auth.verify(auth.signAdmin(0, 0));
t("account 0 is the shared admin password's session", shared && shared.role === "admin" && shared.account === 0 && shared.company === auth.ALL);
t("the admin cookie from before named accounts (company slot '*' alone) is nobody", auth.verify(craft("admin", "*", 0, 1000)) === null);
t("an admin cookie naming a company is nobody", auth.verify(craft("admin", "demo", 1, 1000)) === null);
t("an admin cookie with a made-up account slot is nobody", auth.verify(craft("admin", "*x", 1, 1000)) === null && auth.verify(craft("admin", "*-1", 1, 1000)) === null && auth.verify(craft("admin", "**1", 1, 1000)) === null);
const parts = tok.split("."), swap = (i, val) => parts.map((x, k) => (k === i ? val : x)).join(".");
t("changing the account breaks it", auth.verify(swap(1, "*8")) === null);
t("changing the generation breaks it", auth.verify(swap(2, "4")) === null);
t("changing either time breaks it", auth.verify(swap(3, (Date.now() - 5000).toString(36))) === null && auth.verify(swap(4, (Date.now() - 5000).toString(36))) === null);
t("a floor cookie cannot be turned into an admin one", auth.verify(auth.sign("floor", "demo", 1).replace(/^floor/, "admin")) === null);
t("four parts (before sessions carried a company) and seven parts are nobody", auth.verify(craft("floor", "demo", 1, 1000).split(".").slice(1).join(".")) === null && auth.verify(tok + ".x") === null);

// ---- sliding windows (2026-09-24): idle and cap per role, refresh past half the idle window
const W = auth.WINDOWS, D = 24 * H;
t("the windows are admin 7 days idle / 30 days cap, floor and manager 30 days idle / 180 days cap unless the environment says otherwise", W.admin.idle === 168 && W.admin.cap === 720 && W.device.idle === 720 && W.device.cap === 4320, JSON.stringify(W));
const NOW = Date.now();
const at = (role, slot, gen, issuedAgo, refreshedAgo) => auth.sign(role, slot, gen, { issued: NOW - issuedAgo, refreshed: NOW - refreshedAgo }, NOW);
const see = (tk) => auth.verify(tk, NOW);
t("an admin cookie refreshed 3 days ago holds and is not due a refresh (half the idle window is 3.5 days)", (see(at("admin", "*7", 3, 10 * D, 3 * D)) || {}).refresh === false);
t("an admin cookie refreshed 4 days ago holds and is due a refresh", (see(at("admin", "*7", 3, 10 * D, 4 * D)) || {}).refresh === true);
t("an admin cookie refreshed 8 days ago is nobody (idle window)", see(at("admin", "*7", 3, 10 * D, 8 * D)) === null);
t("an admin cookie issued 31 days ago is nobody even if refreshed an hour ago (cap)", see(at("admin", "*7", 3, 31 * D, H)) === null);
t("an admin cookie issued 29 days ago and refreshed an hour ago holds", (see(at("admin", "*7", 3, 29 * D, H)) || {}).role === "admin");
t("the shared password's session slides the same way", see(at("admin", "*0", 0, 31 * D, H)) === null && (see(at("admin", "*0", 0, 2 * D, 2 * D)) || {}).account === 0);
t("a floor cookie refreshed 29 days ago holds", (see(at("floor", "demo", 2, 100 * D, 29 * D)) || {}).role === "floor");
t("a floor cookie refreshed 31 days ago is nobody", see(at("floor", "demo", 2, 100 * D, 31 * D)) === null);
t("a manager cookie issued 179 days ago and refreshed today holds; 181 days is nobody", (see(at("manager", "demo", 2, 179 * D, 0)) || {}).role === "manager" && see(at("manager", "demo", 2, 181 * D, 0)) === null);
t("a floor cookie refreshed 14 days ago is not due; 16 days is due", (see(at("floor", "demo", 2, 20 * D, 14 * D)) || {}).refresh === false && (see(at("floor", "demo", 2, 20 * D, 16 * D)) || {}).refresh === true);
t("a cookie issued in the future is nobody", see(at("admin", "*7", 3, -H, -H)) === null && see(at("floor", "demo", 2, -H, -H)) === null);
t("a cookie refreshed in the future is nobody", see(at("admin", "*7", 3, H, -H)) === null);
t("a cookie refreshed before it was issued is nobody", see(at("admin", "*7", 3, H, 2 * H)) === null);
t("a time that is not base 36 digits is nobody", auth.verify(swap(3, "zz.zz")) === null && auth.verify(swap(4, "-1")) === null);
// the old one-time shape: accepted while its one time is inside both windows, and always due a refresh
const legacy = craft("admin", "*7", 3, 20 * H);
const lv = auth.verify(legacy);
t("an admin cookie in the old shape, 20 hours old, still holds (it would have died at 12 under the old rule)", lv && lv.account === 7 && lv.legacy === true && lv.issued === lv.refreshed, JSON.stringify(lv));
t("and is due a refresh on the first request seen", lv && lv.refresh === true);
t("an old-shape cookie 8 days old is nobody", auth.verify(craft("admin", "*7", 3, 8 * D)) === null);
t("an old-shape floor cookie 29 days old holds", (auth.verify(craft("floor", "demo", 2, 29 * D)) || {}).role === "floor");
// the re-issue: the same issued, refreshed = now, the same attributes
const headers = [];
const res = { append: (k, val) => headers.push([k, val]) };
auth.reissue({ headers: { "x-forwarded-proto": "https" } }, res, lv, NOW);
const line = headers[0][1], again = auth.verify(line.split(";")[0].slice("sos_session=".length), NOW);
t("the re-issued cookie is the new shape with the same issued and refreshed = now", again && again.legacy === false && again.issued === lv.issued && again.refreshed === NOW && again.account === 7 && again.gen === 3, line);
t("under the same attributes: Path, HttpOnly, SameSite=Lax, Secure behind https, Max-Age the idle window", /; Path=\/; HttpOnly; SameSite=Lax; Max-Age=604800; Secure$/.test(line), line);
t("Max-Age is what is left of the cap when that comes first", auth.maxAgeFor("admin", NOW - 29 * D, NOW) === Math.round(D / 1000) && auth.maxAgeFor("floor", NOW, NOW) === 720 * 3600);
t("no Secure without https", !/Secure/.test(auth.cookieHeader({ headers: {} }, "x", 10)));
t("alive() is the rule: generation is the middleware's business, the cookie only carries it", auth.alive("admin", NOW - H, NOW - H, NOW) && !auth.alive("admin", NOW - 8 * D, NOW - 8 * D, NOW) && !auth.alive("floor", NaN, NOW, NOW));
t("hoursVar: blank or junk is the default, 0 is the default for an idle window and 0 for a cap that allows it", auth.hoursVar("SOS_X_NOT_SET", 5) === 5 && (process.env.SOS_X_JUNK = "abc", auth.hoursVar("SOS_X_JUNK", 5) === 5) && (process.env.SOS_X_ZERO = "0", auth.hoursVar("SOS_X_ZERO", 5) === 5 && auth.hoursVar("SOS_X_ZERO", 5, { zeroOk: true }) === 0) && (process.env.SOS_X_TWO = "2", auth.hoursVar("SOS_X_TWO", 5) === 2));
t("SOS_ADMIN_SESSION_HOURS and SOS_SESSION_DAYS are retired", auth.RETIRED_ENV.join(",") === "SOS_ADMIN_SESSION_HOURS,SOS_SESSION_DAYS");

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
