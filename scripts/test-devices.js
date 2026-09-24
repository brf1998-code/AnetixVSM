// Unit cases for trusted admin devices (src/devices.js), the part with no database: the cookie's shape, the
// constant-time hash compare, expiry, generation, removed, the account switched off, the cap of ten, the label.
// With a database: the trusted-device cases in scripts/e2e/accounts.js.
//   node scripts/test-devices.js
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "unit-test-secret";
const d = require("../src/devices");
let pass = 0, fail = 0;
function t(name, cond, detail) { if (cond) { pass++; } else { fail++; console.log(`FAIL  ${name}${detail ? "\n      " + detail : ""}`); } }
const NOW = Date.now(), D = 86400e3;
const token = "a".repeat(43);
const acct = { id: 7, status: "active", generation: 3 };
const row = (over = {}) => ({ id: 12, account_id: 7, token_hash: d.hashToken(token), issued_at: new Date(NOW - 5 * D), expires_at: new Date(NOW + 25 * D), generation: 3, removed_at: null, ...over });

// the cookie
t("the cookie is <id>.<token>, and parses back", JSON.stringify(d.parseCookie(`12.${token}`)) === JSON.stringify({ id: 12, token }));
t("junk, a missing part, a short token, a token with odd characters are not a cookie", [null, "", "12", `x.${token}`, "12.short", `12.${token}.more`, `12.${"a".repeat(30)}`, `12.${"a".repeat(43)}!`, `-1.${token}`].every((v) => d.parseCookie(v) === null));
t("the hash is sha256 hex and not the token", /^[0-9a-f]{64}$/.test(d.hashToken(token)) && !d.hashToken(token).includes(token.slice(0, 20)));
t("its cookie header is limited to the sign-in route: Path=/login, HttpOnly, SameSite=Lax, 30 days, Secure behind https", /^sos_admin_device=12\.a+; Path=\/login; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure$/.test(d.cookieHeader({ headers: { "x-forwarded-proto": "https" } }, `12.${token}`, d.DAYS * 86400)), d.cookieHeader({ headers: { "x-forwarded-proto": "https" } }, `12.${token}`, d.DAYS * 86400));
t("no Secure without https, and the clearing header is Max-Age=0 on the same path", !/Secure/.test(d.cookieHeader({ headers: {} }, "x", 1)) && /^sos_admin_device=; Path=\/login; HttpOnly; SameSite=Lax; Max-Age=0$/.test(d.clearHeader({ headers: {} })));
t("30 days and ten per account unless the environment says otherwise", d.DAYS === 30 && d.MAX_PER_ACCOUNT === 10);

// the judgement: everything true, or the code step
t("a live row, the right token, the account on and at the same generation: ok", d.judge(row(), token, acct, NOW) === "ok");
t("no row: no_row", d.judge(null, token, acct, NOW) === "no_row");
t("a wrong token (one character off): bad_token", d.judge(row(), token.slice(0, -1) + "b", acct, NOW) === "bad_token");
t("a token of the wrong length, or empty: bad_token, not a crash", d.judge(row(), "", acct, NOW) === "bad_token" && d.judge(row(), token + "a", acct, NOW) === "bad_token" && d.judge(row({ token_hash: "zz" }), token, acct, NOW) === "bad_token");
t("a removed row: removed", d.judge(row({ removed_at: new Date(NOW - D) }), token, acct, NOW) === "removed");
t("an expired row: expired (the expiry is absolute, use does not extend it)", d.judge(row({ expires_at: new Date(NOW - 1000) }), token, acct, NOW) === "expired" && d.judge(row({ expires_at: new Date(NOW - 1000), last_used_at: new Date(NOW - 500) }), token, acct, NOW) === "expired");
t("the account's generation moved (sign out everywhere, new password): generation", d.judge(row(), token, { ...acct, generation: 4 }, NOW) === "generation" && d.judge(row({ generation: 2 }), token, acct, NOW) === "generation");
t("the account switched off: account_off", d.judge(row(), token, { ...acct, status: "disabled" }, NOW) === "account_off");
t("a row of another account: wrong_account", d.judge(row({ account_id: 8 }), token, acct, NOW) === "wrong_account" && d.judge(row(), token, null, NOW) === "wrong_account");
t("the token is checked before the rest, so a removed row with a wrong token says bad_token, never which rows exist", d.judge(row({ removed_at: new Date() }), "b".repeat(43), acct, NOW) === "bad_token");
t("at the very second it expires it is expired", d.judge(row({ expires_at: new Date(NOW) }), token, acct, NOW) === "expired" && d.judge(row({ expires_at: new Date(NOW + 1) }), token, acct, NOW) === "ok");

// the cap of ten: the oldest go
const rows = Array.from({ length: 10 }, (_, i) => ({ id: 100 + i, issued_at: new Date(NOW - (20 - i) * D) }));
t("ten live rows and one more coming: the oldest one goes", JSON.stringify(d.overflow(rows)) === "[100]");
t("nine live rows: nothing goes", d.overflow(rows.slice(1)).length === 0);
t("twelve live rows (a cap lowered) and one more: the three oldest go, by issue time not id", JSON.stringify(d.overflow(rows.concat([{ id: 5, issued_at: new Date(NOW - 30 * D) }, { id: 6, issued_at: new Date(NOW - D) }]))) === "[5,100,101]");
t("the same issue time falls back on the id", JSON.stringify(d.overflow(Array.from({ length: 10 }, (_, i) => ({ id: 50 - i, issued_at: new Date(NOW) })))) === "[41]");

// the label
t("Safari on macOS", d.labelFor("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15") === "Safari on macOS");
t("Chrome on macOS (Chrome says Safari too, Chrome wins)", d.labelFor("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36") === "Chrome on macOS");
t("Edge on Windows, Firefox on Linux, Safari on iPhone, Chrome on Android", d.labelFor("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0") === "Edge on Windows" && d.labelFor("Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0") === "Firefox on Linux" && d.labelFor("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1") === "Safari on iPhone" && d.labelFor("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36") === "Chrome on Android");
t("nothing known is 'a browser', never a crash", d.labelFor("") === "a browser" && d.labelFor(null) === "a browser" && d.labelFor("curl/8.4") === "a browser");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
