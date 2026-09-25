// Unit cases for src/selfserve.js, the pure part: the pin's shape and the reasons one is refused, the company code
// from a name, the credit balance and its line, the www key check. No database: node scripts/test-selfserve.js
const s = require("../src/selfserve");
let pass = 0, fail = 0;
function t(name, cond, detail) { if (cond) { pass++; } else { fail++; console.log(`FAIL  ${name}${detail !== undefined ? "\n      " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : ""}`); } }

// pins
const pins = new Set(); for (let i = 0; i < 200; i++) pins.add(s.makePin());
t("a pin is eight characters from the unambiguous alphabet", [...pins].every((p) => /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/.test(p)), [...pins].slice(0, 3));
t("two hundred pins, two hundred different ones", pins.size === 200);
t("a pin is shown with a dash in the middle", s.showPin("K7RM4XQP") === "K7RM-4XQP");
t("typed lower case with a dash or spaces, it normalizes to the stored form", s.normalizePin(" k7rm-4xqp ") === "K7RM4XQP" && s.normalizePin("k7rm 4xqp") === "K7RM4XQP");
const NOW = new Date("2026-09-25T12:00:00Z");
const good = { pin: "K7RM4XQP", label: "Sam", max_uses: 1, uses: 0, expires_at: "2026-10-25T00:00:00Z", revoked_at: null };
t("a live pin has no problem", s.pinProblem(good, NOW) === null);
t("no such pin", /not one we gave out/.test(s.pinProblem(null, NOW)));
t("a cancelled pin says so", /cancelled/.test(s.pinProblem({ ...good, revoked_at: NOW }, NOW)));
t("an expired pin says so", /expired/.test(s.pinProblem({ ...good, expires_at: "2026-09-25T11:59:00Z" }, NOW)));
t("a pin with no expiry does not expire", s.pinProblem({ ...good, expires_at: null }, new Date("2030-01-01")) === null);
t("a used-up pin says so", /already been used/.test(s.pinProblem({ ...good, uses: 1 }, NOW)));
t("a pin good for three companies still works after two", s.pinProblem({ ...good, max_uses: 3, uses: 2 }, NOW) === null);
t("cancelled wins over used (the admin's word is the one that shows)", /cancelled/.test(s.pinProblem({ ...good, uses: 1, revoked_at: NOW }, NOW)));

// the company code
t("a name becomes a code: lower case, dashes, nothing else", s.slugFrom("Acme Wire & Cable, Inc.") === "acme-wire-cable-inc");
t("accents and odd characters go", s.slugFrom("Établissements Müller GmbH") === "etablissements-muller-gmbh");
t("a long name is cut to thirty characters without a trailing dash", (() => { const x = s.slugFrom("The Very Long Manufacturing Company Name Of Ohio Limited"); return x.length <= 30 && !/-$/.test(x) && /^[a-z0-9][a-z0-9-]+$/.test(x); })(), s.slugFrom("The Very Long Manufacturing Company Name Of Ohio Limited"));
t("a one-letter name still makes a legal code", /^co-/.test(s.slugFrom("X")) && s.slugFrom("") === "co-");
t("a name that is all punctuation makes a legal code", /^co-/.test(s.slugFrom("!!!")));

// the balance
const b = s.balanceOf({ credit_usd: 30, spent_usd: 12.345 });
t("balance is credit minus spend, to the cent", b.balance_usd === 17.65 && b.spent_usd === 12.35 && b.credit_usd === 30, b);
t("the line says what is left and what was used", /^\$17\.65 of AI credit left \(\$12\.35 of \$30\.00 used\)\.$/.test(b.line), b.line);
t("plenty left is ok", b.level === "ok");
t("under five dollars is amber", s.balanceOf({ credit_usd: 30, spent_usd: 26 }).level === "amber");
const out = s.balanceOf({ credit_usd: 30, spent_usd: 31.2 });
t("used up is red, the balance goes negative, and the line says nothing runs", out.level === "red" && out.balance_usd === -1.2 && /Out of AI credit/.test(out.line) && /Nothing will be proposed or built/.test(out.line), out);
t("exactly zero is out", s.balanceOf({ credit_usd: 10, spent_usd: 10 }).level === "red");
t("nothing bought, nothing spent: out (a self-serve row with an empty ledger buys nothing)", s.balanceOf({}).level === "red");

// the www key
const req = (k) => ({ headers: k == null ? {} : { "x-sos-www-key": k } });
const saved = process.env.SOS_WWW_KEY;
delete process.env.SOS_WWW_KEY;
t("no key set on the instance: the door is closed whatever is sent", !s.keyOk(req("")) && !s.keyOk(req("anything")));
process.env.SOS_WWW_KEY = "short";
t("a key under sixteen characters is treated as unset", !s.keyOk(req("short")));
process.env.SOS_WWW_KEY = "a-proper-key-of-thirty-two-chars";
t("the right key opens it", s.keyOk(req("a-proper-key-of-thirty-two-chars")));
t("a wrong key, a prefix, or no header does not", !s.keyOk(req("a-proper-key-of-thirty-two-char")) && !s.keyOk(req("A-PROPER-KEY-OF-THIRTY-TWO-CHARS")) && !s.keyOk(req(null)));
if (saved == null) delete process.env.SOS_WWW_KEY; else process.env.SOS_WWW_KEY = saved;

t("the www address has no trailing slash", (() => { const w = process.env.SOS_WWW_URL; process.env.SOS_WWW_URL = "https://anetix.ai/"; const ok = s.WWW_URL() === "https://anetix.ai"; if (w == null) delete process.env.SOS_WWW_URL; else process.env.SOS_WWW_URL = w; return ok; })());

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
