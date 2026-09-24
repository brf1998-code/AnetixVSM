// Unit cases for src/people.js, the part with no database: names, PINs and the
// signed person cookie. node scripts/test-people.js
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "unit-test-secret";
const p = require("../src/people");
let pass = 0, fail = 0;
function t(name, cond, detail) { if (cond) { pass++; } else { fail++; console.log(`FAIL  ${name}${detail ? "\n      " + detail : ""}`); } }

// names
t("a name is tidied: trimmed, inner spaces collapsed", p.cleanName("  Maria    G \n") === "Maria G");
t("a name is clipped at 60", p.cleanName("x".repeat(200)).length === 60);
t("nothing is an empty name, not a crash", p.cleanName(null) === "" && p.cleanName(undefined) === "");

// PINs
t("a PIN is 4 to 8 digits", p.validPin("1234") && p.validPin("48291375") && p.validPin(4821));
t("shorter, longer, letters, spaces and empty are refused", !p.validPin("123") && !p.validPin("123456789") && !p.validPin("12a4") && !p.validPin("12 34") && !p.validPin("") && !p.validPin(null));
const made = Array.from({ length: 2000 }, () => p.makePin());
t("a made PIN is always four digits", made.every((x) => /^\d{4}$/.test(x)));
t("a made PIN is never one digit four times", !made.some((x) => /^(\d)\1{3}$/.test(x)));
t("a made PIN is never a run up or down", !made.some((x) => "0123456789".includes(x) || "9876543210".includes(x)));
t("made PINs are spread out, not one value", new Set(made).size > 1000);

// the person cookie
const person = { id: 42, company: "demo", generation: 3 };
const tok = p.sign(person);
t("the cookie is p.<id>.<company>.<generation>.<issued>.<refreshed>.<mac>", /^p\.42\.demo\.3\.[0-9a-z]+\.[0-9a-z]+\.[^.]+$/.test(tok), tok);
const v = p.verify(tok);
t("a fresh cookie verifies to the same person, not due a refresh, not the old shape", v && v.id === 42 && v.company === "demo" && v.gen === 3 && v.refresh === false && v.legacy === false && v.issued === v.refreshed, JSON.stringify(v));
const parts = tok.split(".");
const swap = (i, val) => parts.map((x, k) => (k === i ? val : x)).join(".");
t("changing the id breaks it", p.verify(swap(1, "43")) === null);
t("changing the company breaks it", p.verify(swap(2, "acme")) === null);
t("changing the generation breaks it", p.verify(swap(3, "4")) === null);
t("changing either time breaks it", p.verify(swap(4, (Date.now() - 1000).toString(36))) === null && p.verify(swap(5, (Date.now() - 1000).toString(36))) === null);
t("a wrong or short mac is nobody, not a crash", p.verify(swap(6, "AAAA")) === null && p.verify(swap(6, "")) === null);
t("junk is nobody", p.verify("") === null && p.verify(null) === null && p.verify("p.1.2") === null && p.verify("s.42.demo.3.x.y.z") === null && p.verify(tok + ".x") === null);
// sliding windows (2026-09-24): a week idle, 30 days cap, refresh past half the idle window
const auth = require("../src/auth");
const H = 3600e3, D = 24 * H, NOW = Date.now();
t("the windows are 7 days idle and 30 days cap, the approval PIN 12 hours, unless the environment says otherwise", p.WINDOW.idle === 168 && p.WINDOW.cap === 720 && p.APPROVAL_PIN_HOURS === 12, JSON.stringify(p.WINDOW));
const at = (issuedAgo, refreshedAgo) => p.sign(person, { issued: NOW - issuedAgo, refreshed: NOW - refreshedAgo }, NOW);
const see = (tk) => p.verify(tk, NOW);
t("a cookie older than a shift holds now: 13 hours since the PIN, refreshed then", (see(at(13 * H, 13 * H)) || {}).id === 42);
t("refreshed 3 days ago: holds, not due; 4 days: due (half the idle window is 3.5 days)", (see(at(10 * D, 3 * D)) || {}).refresh === false && (see(at(10 * D, 4 * D)) || {}).refresh === true);
t("refreshed 8 days ago is nobody (the idle window)", see(at(10 * D, 8 * D)) === null);
t("the PIN typed 31 days ago is nobody even if refreshed an hour ago (the cap)", see(at(31 * D, H)) === null);
t("the PIN typed 29 days ago, refreshed an hour ago, holds", (see(at(29 * D, H)) || {}).id === 42);
t("a cookie from the future is nobody", see(at(-H, -H)) === null && see(at(H, -H)) === null);
t("a refresh before the PIN was typed is nobody", see(at(H, 2 * H)) === null);
// the old shape: one time, counted as both, accepted inside both windows, always due a refresh
const oldPayload = `p.42.demo.3.${(Date.now() - 13 * 3600e3).toString(36)}`;
const ov = p.verify(`${oldPayload}.${auth.hmac(oldPayload)}`);
t("an old-shape cookie 13 hours old holds (it would have died at 12 under the old rule) and is due a refresh", ov && ov.id === 42 && ov.legacy === true && ov.refresh === true, JSON.stringify(ov));
const veryOld = `p.42.demo.3.${(Date.now() - 8 * D).toString(36)}`;
t("an old-shape cookie 8 days old is nobody", p.verify(`${veryOld}.${auth.hmac(veryOld)}`) === null);
const futurePayload = `p.42.demo.3.${(Date.now() + 3600e3).toString(36)}`;
t("an old-shape cookie from the future is nobody", p.verify(`${futurePayload}.${auth.hmac(futurePayload)}`) === null);
t("Max-Age is the idle window, or what is left of the cap", p.maxAgeFor(NOW, NOW) === 168 * 3600 && p.maxAgeFor(NOW - 29 * D, NOW) === Math.round(D / 1000));
// approvals stay fresh: a PIN typed longer than SOS_APPROVAL_PIN_HOURS ago is asked for again
t("a PIN typed 11 hours ago is fresh enough to approve; 13 hours is not; nobody signed in passes", p.pinFresh(NOW - 11 * H, NOW) && !p.pinFresh(NOW - 13 * H, NOW) && p.pinFresh(null, NOW) && p.pinFresh(undefined, NOW));
const asked = []; const res = { status: (c) => ({ json: (b) => asked.push([c, b]) }) };
let passed = false; p.requireFreshPin({ sosPersonId: 42, sosPerson: "Maria G", sosPersonSince: NOW - 20 * H }, res, () => { passed = true; });
t("requireFreshPin answers 401 pin_again with the person, and does not pass", !passed && asked.length === 1 && asked[0][0] === 401 && asked[0][1].pin_again === true && asked[0][1].person.id === 42 && /Maria G, tap your PIN again/.test(asked[0][1].error), JSON.stringify(asked));
passed = false; p.requireFreshPin({ sosPersonId: 42, sosPerson: "Maria G", sosPersonSince: NOW - H }, res, () => { passed = true; });
t("a fresh PIN passes", passed);
passed = false; p.requireFreshPin({}, res, () => { passed = true; });
t("nobody signed in passes (the device's login decides)", passed);
t("roles are floor, lead, manager", p.ROLES.join(",") === "floor,lead,manager");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
