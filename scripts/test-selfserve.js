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

// the balance, shown as a percentage of one demo allowance ($15), never in dollars; it can pass 100%
const b = s.balanceOf({ credit_usd: 30, spent_usd: 12.345, unit_usd: 15 });
t("balance is credit minus spend, to the cent (kept for the admin)", b.balance_usd === 17.65 && b.spent_usd === 12.35 && b.credit_usd === 30, b);
t("the line is the balance over $15 as a percentage, no dollars", b.percent === 118 && b.line === "118% left." && !/\$/.test(b.line), b.line);
t("a fresh demo is 100%", s.balanceOf({ credit_usd: 15, spent_usd: 0, unit_usd: 15 }).percent === 100);
t("5% left plus a $15 refill is 105%, nothing lost at the refill", s.balanceOf({ credit_usd: 30, spent_usd: 14.25, unit_usd: 15 }).percent === 105);
t("the default unit is $10 (2026-09-26, was $15)", s.balanceOf({ credit_usd: 10, spent_usd: 5 }).percent === 50);
t("plenty left is ok", b.level === "ok");
t("under a quarter of $15 is amber", s.balanceOf({ credit_usd: 15, spent_usd: 11.5, unit_usd: 15 }).level === "amber" && s.balanceOf({ credit_usd: 15, spent_usd: 11, unit_usd: 15 }).level === "ok");
const out = s.balanceOf({ credit_usd: 30, spent_usd: 31.2 });
t("used up is red, 0%, the balance goes negative, and the line says nothing runs", out.level === "red" && out.percent === 0 && out.balance_usd === -1.2 && /used up/.test(out.line) && /Nothing new will be proposed or built/.test(out.line) && !/\$/.test(out.line), out);
t("exactly zero is out", s.balanceOf({ credit_usd: 10, spent_usd: 10 }).level === "red");
t("a crumb left is 1%, never 0% while anything runs", s.balanceOf({ credit_usd: 15, spent_usd: 14.99, unit_usd: 15 }).percent === 1);
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

// the top-up link's key and the sign-in's CORS (anetix.ai is a wall since 2026-09-25)
const withEnv = (vars, fn) => { const old = {}; for (const k of Object.keys(vars)) { old[k] = process.env[k]; if (vars[k] == null) delete process.env[k]; else process.env[k] = vars[k]; } try { return fn(); } finally { for (const k of Object.keys(old)) { if (old[k] == null) delete process.env[k]; else process.env[k] = old[k]; } } };
const K = "a-proper-key-of-thirty-two-chars", T0 = Date.UTC(2026, 8, 25, 15, 30);
t("a credit key is <exp>.<32 characters>, exp 31 days out at a day boundary", /^\d{10}\.[A-Za-z0-9_-]{32}$/.test(s.creditToken("acme", T0, K)) && Number(s.creditToken("acme", T0, K).split(".")[0]) === Date.UTC(2026, 9, 26) / 1000);
t("the same key all day, another the next day", s.creditToken("acme", T0, K) === s.creditToken("acme", Date.UTC(2026, 8, 25, 23, 59), K) && s.creditToken("acme", T0, K) !== s.creditToken("acme", Date.UTC(2026, 8, 26, 0, 1), K));
t("a key per company and per secret", s.creditToken("acme", T0, K) !== s.creditToken("acme-2", T0, K) && s.creditToken("acme", T0, K) !== s.creditToken("acme", T0, K + "x"));
t("no key, or a short one, or a bad code: no token", s.creditToken("acme", T0, "") === "" && s.creditToken("acme", T0, "short") === "" && s.creditToken("../x", T0, K) === "");
t("the top-up link carries the key when there is one, and is bare when there is not", withEnv({ SOS_WWW_KEY: K, SOS_WWW_URL: "https://anetix.ai" }, () => /^https:\/\/anetix\.ai\/c\/acme\/credit\?t=\d+\.[A-Za-z0-9_-]{32}$/.test(s.topupUrl("acme"))) && withEnv({ SOS_WWW_KEY: null, SOS_WWW_URL: "https://anetix.ai" }, () => s.topupUrl("acme") === "https://anetix.ai/c/acme/credit"));
t("the sign-in answers CORS for anetix.ai and www.anetix.ai only", withEnv({ SOS_WWW_URL: "https://anetix.ai/" }, () => { const o = s.wwwOrigins(); return o.has("https://anetix.ai") && o.has("https://www.anetix.ai") && o.size === 2; }));
t("a local address gets no www. twin", withEnv({ SOS_WWW_URL: "http://127.0.0.1:4000" }, () => { const o = s.wwwOrigins(); return o.has("http://127.0.0.1:4000") && o.size === 1; }));
const fakeRes = () => { const r = { h: {}, code: 0, ended: false, set(o) { Object.assign(r.h, o); return r; }, status(c) { r.code = c; return r; }, end() { r.ended = true; } }; return r; };
t("a preflight from the wall gets the headers and 204; from elsewhere, 204 and nothing", withEnv({ SOS_WWW_URL: "https://anetix.ai" }, () => {
  const a = fakeRes(); s.loginCors({ method: "OPTIONS", headers: { origin: "https://anetix.ai" } }, a, () => {});
  const b = fakeRes(); s.loginCors({ method: "OPTIONS", headers: { origin: "https://evil.example" } }, b, () => {});
  return a.code === 204 && a.h["Access-Control-Allow-Origin"] === "https://anetix.ai" && a.h["Access-Control-Allow-Credentials"] === "true" && b.code === 204 && !b.h["Access-Control-Allow-Origin"];
}));
t("a POST passes on to the sign-in either way", withEnv({ SOS_WWW_URL: "https://anetix.ai" }, () => { let n = 0; s.loginCors({ method: "POST", headers: { origin: "https://evil.example" } }, fakeRes(), () => n++); s.loginCors({ method: "POST", headers: {} }, fakeRes(), () => n++); return n === 2; }));
t("a preview key is <exp>.<32 characters>, ten minutes out, none without a key", /^\d{10}\.[A-Za-z0-9_-]{32}$/.test(s.previewToken(T0, K)) && Number(s.previewToken(T0, K).split(".")[0]) === Math.floor(T0 / 1000) + 600 && s.previewToken(T0, "short") === "");
t("a preview key is not a credit key", s.previewToken(T0, K).split(".")[1] !== s.creditToken("preview", T0, K).split(".")[1]);
t("a pin made for an email takes it in any case with spaces around it", s.pinEmailProblem({ email: "sam@acme.test" }, " SAM@Acme.test ") === null);
t("another email, or none, is refused", /do not go together/.test(s.pinEmailProblem({ email: "sam@acme.test" }, "sam@acme.tes")) && /do not go together/.test(s.pinEmailProblem({ email: "sam@acme.test" }, "")));
t("a pin from before emails (none on it) takes any", s.pinEmailProblem({ email: null }, "anyone@x.test") === null && s.pinEmailProblem(null, "x") === null);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
