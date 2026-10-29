// Access control: three roles, and since 2026-09-19 every session belongs to
// one company (tenancy trade study of 2026-09-17, option B).
//
//   floor    sees module pages, sends feedback, works stations   (one company)
//   manager  floor plus review / approve / deploy / rollback      (one company)
//   admin    manager everywhere, plus /admin across companies     (the platform's own people)
//
// Passwords
//   Each company has its own floor and manager passwords, stored as scrypt
//   hashes in platform.company_access and set from the admin page. Nothing in
//   platform.companies carries them, so "SELECT * FROM companies" can never
//   leak one to a page.
//   Admin is a NAMED ACCOUNT since 2026-09-21 (src/accounts.js): a personal
//   login, a password of its own and a code from an authenticator app. The
//   login page sends a name only for those; no name is the company password
//   path below, untouched. SOS_ADMIN_PASSWORD (the manager password when it
//   is unset) is the old shared admin password. It opens admin ONLY while no
//   admin account has a working authenticator, which is how the first
//   accounts get made; every use is on the record (legacy_admin_password).
//   After that it is refused and the variable can leave Railway.
//   The floor PIN (2026-10-29, Chelsea Clock's first weeks on the floor). The floor's shared sign-in is a PIN of 6
//   to 8 digits now, never a password: setPasswords takes nothing else for the floor, and every place that makes one
//   up (a company by hand, a site going live, a site from anetix.ai) makes a PIN. company_access.floor_pin says the
//   floor's hash is a PIN, and a PIN signs in ONLY from the plant: the company's network list (src/safeguards.js) must
//   hold the address, and a company with a PIN and no list refuses every floor sign-in in the same words whether the
//   PIN was right or not. A floor password from before PINs (floor_pin false) works as it always did until the admin
//   makes the company a PIN. Why: on 2026-10-28 a phone at Chelsea typed a person's own PIN (the People page) into the
//   floor's password box six times and was told "That password did not match." The person's PIN only names who is at
//   a device that is already in; the floor's PIN is what lets the device in, and the login page now says so.
//   At the plant the per-address limit below would lock the whole floor out between them (a plant is one address), so
//   a sign-in to a company from its own network is counted per device and per plant instead (loginHandler).
//   SOS_FLOOR_PASSWORD / SOS_MANAGER_PASSWORD are the old instance-wide
//   passwords. They still open a company only while its access row says
//   legacy_login, which is how companies that existed before this change keep
//   working until the admin gives them their own. A company made after it
//   never accepts them.
//
// Session
//   A signed cookie carries role, company, a generation and two times: when it
//   was first issued (the sign-in) and when it was last refreshed. For
//   an admin the company slot is "*<account id>" and the generation is the
//   ACCOUNT's, checked on every request (ten second cache), so one admin can
//   be signed out everywhere without touching a plant; the id 0 is the shared
//   admin password's session, good only while that password still opens
//   admin. An account with no authenticator yet reaches the admin page's setup
//   and nothing else.
//
//   Sliding windows (2026-09-24; before this every cookie died a fixed time
//   after sign-in, 12 hours for an admin, so Brendan typed password and code
//   most mornings). A cookie is good while the generation matches, it was
//   refreshed inside the IDLE window, it was issued inside the CAP, and neither
//   time is in the future. Any request that verifies once more than half the
//   idle window has passed since the last refresh gets the cookie again with
//   refreshed = now and the same issued, under the same attributes. So a
//   session a person keeps using never ends until the cap; one they walk away
//   from ends after the idle window. Hours, so a deployment that has to meet
//   AAL2 on paper (1 hour idle, 24 hour cap) sets 1 and 24 with no code change:
//     admin            SOS_ADMIN_IDLE_HOURS   168 (7 days)    SOS_ADMIN_CAP_HOURS    720 (30 days)
//     manager          SOS_SESSION_IDLE_HOURS 720 (30 days)   SOS_SESSION_CAP_HOURS 4320 (180 days; 0 = no cap)
//     floor            SOS_FLOOR_IDLE_HOURS   168 (7 days)    SOS_FLOOR_CAP_HOURS    720 (30 days; 0 = no cap)
//   (the floor's own pair since 2026-10-29, the same as the person cookie's: a device used every day stays in for a
//   month, one left in a drawer for a week asks for the floor PIN again; 30 and 180 days before, shared with managers)
//   (the person cookie has its own pair in src/people.js). The cookie from
//   before this carried one time; it is accepted while its one time is inside
//   both windows, and re-issued in the new shape on the first request seen, so
//   the deploy signed nobody out. SOS_ADMIN_SESSION_HOURS and SOS_SESSION_DAYS
//   are no longer read (boot says so if they are set).
//   Since 2026-10-13 (the outside audit 1A, findings S1-01 and S1-03) the cookie has a seventh part, a tag: "n"
//   or "e" and a random nonce. The tag names the session: its id (sid) is a hash of role, slot, generation, issued
//   and nonce, the same through every refresh, and /logout writes it to platform.revoked_sessions so a copy of the
//   cookie stops working too. A cookie from before (five or six parts) has an empty nonce and the same kind of id,
//   so logging out ends it and its copies as well, and nobody was signed out by the change. "e" is an
//   ENROLLMENT-ONLY session: what a password gives an account with no second factor yet (a password, a sign-in
//   ticket, an invitation). It reaches the setup pages and nothing else, lives ENROLL_MINUTES from sign-in and never
//   slides, and ends the moment the account has a factor, whichever browser set it up. The browser that proves the
//   factor gets a full session in the same answer (finishEnrollment).
//   For floor and manager the generation is the company's password generation. Changing a company's password raises its generation, which
//   signs everyone at that company out (the reason to change one is usually
//   that somebody who knew it should no longer get in). `companyGuard` is the
//   one place that ties a request to a company: a /c/<slug>/ or /api/c/<slug>/
//   path must match the session's company, and a route addressed by id
//   (a feedback item, a proposal, a run, an intake, an attachment) is looked up
//   and must belong to it. Admin passes everywhere. With no passwords set at
//   all (local dev) every request is admin so the loop stays walkable.
const crypto = require("crypto");
const { q } = require("./db");
const accounts = require("./accounts");
const edge = require("./edge");
const devices = require("./devices");

const FLOOR = process.env.SOS_FLOOR_PASSWORD || "";
const MANAGER = process.env.SOS_MANAGER_PASSWORD || "";
const ADMIN = process.env.SOS_ADMIN_PASSWORD || "";
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(24).toString("hex");
const COOKIE = "sos_session";
// The windows, in hours (see "Sliding windows" above). An idle window below a minute is nonsense and becomes the
// default; a cap of 0 means none (revocation by generation only).
function hoursVar(name, dflt, { zeroOk = false } = {}) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === "") return dflt;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return dflt;
  if (n === 0) return zeroOk ? 0 : dflt;
  return zeroOk ? n : Math.max(n, 1 / 60);
}
const WINDOWS = {
  admin: { idle: hoursVar("SOS_ADMIN_IDLE_HOURS", 168), cap: hoursVar("SOS_ADMIN_CAP_HOURS", 720, { zeroOk: true }) },
  device: { idle: hoursVar("SOS_SESSION_IDLE_HOURS", 720), cap: hoursVar("SOS_SESSION_CAP_HOURS", 4320, { zeroOk: true }) },
  floor: { idle: hoursVar("SOS_FLOOR_IDLE_HOURS", 168), cap: hoursVar("SOS_FLOOR_CAP_HOURS", 720, { zeroOk: true }) },
};
const RETIRED_ENV = ["SOS_ADMIN_SESSION_HOURS", "SOS_SESSION_DAYS"];
for (const name of RETIRED_ENV) if (process.env[name] !== undefined) console.warn(`[auth] ${name} is no longer read (sessions slide since 2026-09-24: SOS_ADMIN_IDLE_HOURS / SOS_ADMIN_CAP_HOURS, SOS_SESSION_IDLE_HOURS / SOS_SESSION_CAP_HOURS). Take it out of Railway.`);
const windowFor = (role) => (role === "admin" ? WINDOWS.admin : role === "floor" ? WINDOWS.floor : WINDOWS.device);
// An enrollment-only session (see the top): long enough to scan a code and save the recovery codes, no longer.
const ENROLL_MINUTES = 60;
const ENROLL_MS = ENROLL_MINUTES * 60e3;
// The seventh part of a cookie: "n" (a full session) or "e" (enrollment-only), then a random nonce.
const newTag = (enroll = false) => `${enroll ? "e" : "n"}${crypto.randomBytes(6).toString("hex")}`;
// The session's id: stable through every refresh (issued, slot and generation never change; the nonce rides along).
const sidOf = (role, slot, gen, issued, nonce) => crypto.createHash("sha256").update(`${role}.${slot}.${Number(gen) || 0}.${issued}.${nonce || ""}`).digest("hex").slice(0, 40);
// failed logins per client IP before /login answers 429 for the rest of the window
const LOGIN_MAX_FAILS = Number(process.env.SOS_LOGIN_MAX_FAILS || 10);
const LOGIN_WINDOW_MS = Number(process.env.SOS_LOGIN_WINDOW_MIN || 15) * 60 * 1000;
// Open (every request an admin, no sign-in) used to be what no password variables at all meant, which made taking the
// old shared passwords out of Railway a trap (the launch audit 2.12, 2026-09-27). It is an explicit switch for local
// work now, SOS_OPEN=1, and a hosted deployment (Railway, or NODE_ENV=production) never honors it: with no password
// variables there, sign-in is by account and each company's own passwords, nothing else.
const HOSTED = Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_SERVICE_ID || process.env.NODE_ENV === "production");
const OPEN = process.env.SOS_OPEN === "1" && !HOSTED;
if (process.env.SOS_OPEN === "1" && HOSTED) console.error("[auth] SOS_OPEN=1 is ignored here: a hosted deployment is never open. Take the variable out.");
else if (OPEN) console.warn("[auth] OPEN (SOS_OPEN=1): every request is an admin with no sign-in. Local work only.");
else if (!FLOOR && !MANAGER && !ADMIN) console.log("[auth] no shared password variables: sign-in is by account and by each company's own passwords");
// token for the platform's own internal requests (smoke checks hit the staged
// mount over HTTP); generated per process unless pinned by env
const INTERNAL = process.env.SOS_INTERNAL_TOKEN || crypto.randomBytes(16).toString("hex");
process.env.SOS_INTERNAL_TOKEN = INTERNAL;

const SLUG = /^[a-z0-9][a-z0-9-]{1,40}$/;
const ALL = "*";   // the company of an admin session

// ---- password hashing (scrypt, no dependency) -------------------------------------
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 32);
  return `s1$${salt.toString("base64")}$${hash.toString("base64")}`;
}
function checkHash(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 3 || parts[0] !== "s1") return false;
  const want = Buffer.from(parts[2], "base64");
  const got = crypto.scryptSync(String(password), Buffer.from(parts[1], "base64"), want.length);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
function same(a, b) {
  const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || ""));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}
// A password a person can read off a card and type on a phone.
function generatePassword() {
  const words = ["amber", "anvil", "birch", "brass", "cedar", "chalk", "cobalt", "copper", "delta", "ember", "flint", "forge", "gauge", "granite", "harbor", "hinge", "iron", "lathe", "maple", "nickel", "oak", "pallet", "quartz", "rivet", "slate", "spindle", "steel", "timber", "torque", "walnut"];
  const pick = () => words[crypto.randomInt(words.length)];
  return `${pick()}-${pick()}-${String(crypto.randomInt(100, 1000))}`;
}

// The floor PIN (see the top): 6 to 8 digits. One made up here is 6, and never a run or a repeat a person would guess
// first (123456, 111111, 654321, 121212).
const FLOOR_PIN_MIN = 6, FLOOR_PIN_MAX = 8;
const validFloorPin = (p) => new RegExp(`^\\d{${FLOOR_PIN_MIN},${FLOOR_PIN_MAX}}$`).test(String(p == null ? "" : p));
function guessable(p) {
  const d = String(p).split("").map(Number);
  const steps = d.slice(1).map((x, i) => x - d[i]);
  if (steps.every((x) => x === steps[0]) && Math.abs(steps[0]) <= 1) return true;   // 111111, 123456, 654321
  if (new Set(d).size <= 2) return true;                                              // 121212, 112112
  return false;
}
function generateFloorPin() {
  for (;;) {
    const p = String(crypto.randomInt(0, 1e6)).padStart(FLOOR_PIN_MIN, "0");
    if (!guessable(p)) return p;
  }
}

// ---- company access rows ---------------------------------------------------------------
async function accessRow(slug) {
  return (await q("SELECT * FROM platform.company_access WHERE company=$1", [slug])).rows[0] || null;
}
// Set one or both passwords. Giving a company its own passwords ends its use of the shared ones.
// floor: the floor PIN (6 to 8 digits; nothing else is taken for the floor since 2026-10-29).
async function setPasswords(slug, { floor, manager }) {
  if (!floor && !manager) throw new Error("give at least one password");
  if (floor && !validFloorPin(floor)) throw new Error(`the floor PIN is ${FLOOR_PIN_MIN} to ${FLOOR_PIN_MAX} digits, numbers only`);
  if (floor && guessable(floor)) throw new Error("that floor PIN is one a person would guess first (a run or a repeat): pick another, or let the platform make one up");
  if (manager && String(manager).length < 8) throw new Error("the manager password needs at least 8 characters");
  if (floor && manager && String(floor) === String(manager)) throw new Error("the floor PIN and the manager password must differ: what is typed is what tells the two apart");
  await q(
    `INSERT INTO platform.company_access (company, floor_hash, manager_hash, legacy_login, floor_pin) VALUES ($1,$2::text,$3::text,false,$2::text IS NOT NULL)
     ON CONFLICT (company) DO UPDATE SET floor_hash=COALESCE($2, platform.company_access.floor_hash),
       floor_pin=CASE WHEN $2::text IS NULL THEN platform.company_access.floor_pin ELSE true END,
       manager_hash=COALESCE($3, platform.company_access.manager_hash), legacy_login=false,
       generation=platform.company_access.generation + 1, updated_at=now()`,
    [slug, floor ? hashPassword(String(floor)) : null, manager ? hashPassword(manager) : null]);
  generations.delete(slug);
  require("./safeguards")._forget(slug);   // it remembers whether the floor signs in with a PIN
}
// A company whose only way in is a named account (a personal demo from anetix.ai, 2026-09-25: one person, one
// manager account with an authenticator, no floor): an access row with no floor or manager password and
// legacy_login off, so neither a company password nor the shared SOS_FLOOR/MANAGER fallback ever opens it.
async function accountsOnly(slug) {
  await q(`INSERT INTO platform.company_access (company, legacy_login) VALUES ($1,false)
           ON CONFLICT (company) DO UPDATE SET floor_hash=NULL, floor_pin=false, manager_hash=NULL, legacy_login=false,
             generation=platform.company_access.generation + 1, updated_at=now()`, [slug]);
  generations.delete(slug);
  require("./safeguards")._forget(slug);
}
// The generation a company's sessions must carry, remembered for a few seconds
// so a page full of requests costs one lookup.
const generations = new Map();   // slug -> { gen, at }
async function generationOf(slug) {
  const hit = generations.get(slug);
  if (hit && Date.now() - hit.at < 10000) return hit.gen;
  const row = await accessRow(slug);
  const gen = row ? Number(row.generation || 1) : 0;   // 0: no access row, so no session for it can be current
  generations.set(slug, { gen, at: Date.now() });
  return gen;
}
// Companies that were here before per-company passwords existed keep the shared
// passwords until the admin sets their own. Runs at boot, after the library
// seeding; a company made from the admin page gets its row at creation and is
// never touched here.
async function ensureAccessRows() {
  const r = await q(
    `INSERT INTO platform.company_access (company, legacy_login)
     SELECT slug, true FROM platform.companies c WHERE NOT EXISTS (SELECT 1 FROM platform.company_access a WHERE a.company=c.slug)
     RETURNING company`);
  for (const row of r.rows) console.log(`[auth] ${row.company}: no passwords of its own yet, the shared floor and manager passwords still open it (set its own on the admin page)`);
  return r.rows.length;
}
function accessPublic(row) {
  return { own_floor: Boolean(row && row.floor_hash), floor_pin: Boolean(row && row.floor_hash && row.floor_pin), own_manager: Boolean(row && row.manager_hash), legacy_login: Boolean(row && row.legacy_login), updated_at: row ? row.updated_at : null,
    networks: (row && row.networks) || [] };   // where the shared sign-ins work from; empty = anywhere (src/safeguards.js)
}
// Take away a company's shared manager password (2026-10-08, src/safeguards.js): from then on a manager signs in by
// name with a second factor and no other way. The floor's password stays. Everyone on a shared sign-in at that
// company signs in again (the generation moves), which is the point for whoever held the manager password.
async function dropManagerPassword(slug) {
  await q("UPDATE platform.company_access SET manager_hash=NULL, generation=generation + 1, updated_at=now() WHERE company=$1", [slug]);
  generations.delete(slug);
}

// ---- the session cookie -------------------------------------------------------------------
// role.company.generation.issued.refreshed.tag.mac (times in base 36 ms). `times` carries a session on: the same
// issued, a new refreshed, the same tag. Without it both are now and the tag is new (a sign-in); times.tag alone
// picks the kind of a new session ("e..." enrollment-only). `now` is for the unit cases only.
function sign(role, company, gen, times, now = Date.now()) {
  const issued = times && Number.isFinite(times.issued) ? times.issued : now;
  const refreshed = times && Number.isFinite(times.refreshed) ? times.refreshed : now;
  const tag = times && typeof times.tag === "string" && /^[ne][0-9a-z]{0,16}$/.test(times.tag) ? times.tag : newTag(false);
  const payload = `${role}.${company}.${Number(gen) || 0}.${issued.toString(36)}.${refreshed.toString(36)}.${tag}`;
  const mac = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

// A session the PLATFORM opens for itself as one role of one company: the acceptance checks and the page load
// (src/acceptance.js, src/pageload.js) call a staged build the way that company's own devices would. Never the
// internal token for those: the pages are agent-written, and that token is an admin of every company.
async function serviceCookie(company, role) {
  return `${COOKIE}=${sign(role === "floor" ? "floor" : "manager", company, await generationOf(company))}`;
}

// Pure: is a session with these times good now, under this role's windows? Both times must be real, neither in
// the future, the refresh not before the issue, the last refresh inside the idle window, the issue inside the cap.
function alive(role, issued, refreshed, now = Date.now()) {
  const w = windowFor(role);
  if (!Number.isFinite(issued) || !Number.isFinite(refreshed)) return false;
  if (issued > now || refreshed > now || refreshed < issued) return false;
  if (now - refreshed > w.idle * 3600e3) return false;
  if (w.cap && now - issued > w.cap * 3600e3) return false;
  return true;
}
// Pure: is it time to hand the cookie back with a new refreshed? Past half the idle window, and always for a
// cookie in the old one-time shape (so it takes the new shape on the first request seen).
const refreshDue = (role, refreshed, legacy, now = Date.now()) => legacy || now - refreshed > (windowFor(role).idle * 3600e3) / 2;
// Max-Age for the cookie: the idle window, or what is left of the cap if that comes first (seconds, never below 60).
function maxAgeFor(role, issued, now = Date.now(), enroll = false) {
  if (enroll) return Math.max(60, Math.round((issued + ENROLL_MS - now) / 1000));
  const w = windowFor(role);
  let s = w.idle * 3600;
  if (w.cap) s = Math.min(s, (issued + w.cap * 3600e3 - now) / 1000);
  return Math.max(60, Math.round(s));
}

// -> { role, company, gen, account?, slot, issued, refreshed, refresh, legacy, tag, sid, enroll } or null
function verify(token, now = Date.now()) {
  if (!token) return null;
  const parts = String(token).split(".");
  // five parts: the shape before sliding windows (one time); six: issued and refreshed; seven: and the tag (2026-10-13).
  // Anything else is nobody (cookies from before sessions carried a company had four).
  if (parts.length < 5 || parts.length > 7) return null;
  const legacy = parts.length === 5;
  const [role, company, gen] = parts;
  const ts1 = parts[3], ts2 = legacy ? parts[3] : parts[4];
  const tag = parts.length === 7 ? parts[5] : "";
  const mac = parts[parts.length - 1];
  const payload = parts.slice(0, -1).join(".");
  const expect = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  if (mac.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
  if (!["admin", "manager", "floor"].includes(role)) return null;
  if (!/^[0-9a-z]{1,12}$/.test(ts1) || !/^[0-9a-z]{1,12}$/.test(ts2)) return null;
  if (tag && !/^[ne][0-9a-z]{0,16}$/.test(tag)) return null;
  const enroll = tag.charAt(0) === "e";
  const issued = parseInt(ts1, 36), refreshed = parseInt(ts2, 36);
  if (enroll) {
    // enrollment-only: from its sign-in, ENROLL_MINUTES, and it never slides
    if (!Number.isFinite(issued) || issued > now || refreshed !== issued || now - issued > ENROLL_MS) return null;
  } else if (!alive(role, issued, refreshed, now)) return null;   // expired, or a forged time
  const times = { slot: company, issued, refreshed, legacy, refresh: !enroll && refreshDue(role, refreshed, legacy, now),
    tag: tag || "n", enroll, sid: sidOf(role, company, gen, issued, tag.slice(1)) };
  if (role !== "admin") {
    if (SLUG.test(company)) return enroll ? null : { role, company, gen: Number(gen) || 0, ...times };   // a shared password never enrolls
    // a manager ACCOUNT (2026-09-25, self-serve companies): "<slug>~<account id>", gen = the account's generation
    const a = role === "manager" ? /^([a-z0-9][a-z0-9-]{1,40})~(\d{1,9})$/.exec(company) : null;
    return a ? { role, company: a[1], gen: Number(gen) || 0, account: Number(a[2]), ...times } : null;
  }
  // admin: "*<account id>". The admin cookie from before named accounts ("*" alone) is no longer accepted: sign in again.
  const m = /^\*(\d{1,9})$/.exec(company);
  if (!m || (enroll && Number(m[1]) === 0)) return null;   // the shared admin password's session is never enrollment-only
  return { role, company: ALL, gen: Number(gen) || 0, account: Number(m[1]), ...times };
}
// The cookie value for an admin session. accountId 0: the shared admin password's session.
function signAdmin(accountId, gen, times, now) { return sign("admin", `${ALL}${Number(accountId) || 0}`, gen, times, now); }
// The cookie value for a manager account's session: the company and the account, under the account's generation.
function signManager(accountId, company, gen, times, now) { return sign("manager", `${company}~${Number(accountId) || 0}`, gen, times, now); }
// The Set-Cookie line for a session, the same attributes at sign-in and at every refresh.
function cookieHeader(req, value, maxAge) {
  const secure = req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}
// The cookie again, with refreshed = now and the same issued, under the same attributes. Appended, so a route
// that sets its own cookies (the person cookie, the device id) keeps them; the logout route replaces the header.
function reissue(req, res, session, now = Date.now()) {
  const value = sign(session.role, session.slot, session.gen, { issued: session.issued, refreshed: now, tag: session.tag }, now);
  res.append("Set-Cookie", cookieHeader(req, value, maxAgeFor(session.role, session.issued, now)));
}

// A MAC under the session secret, for other platform cookies (src/people.js). The secret itself stays in this file.
function hmac(payload) { return crypto.createHmac("sha256", SECRET).update(String(payload)).digest("base64url"); }

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// Which company a login is for: the one named, or the only one there is.
async function resolveCompany(named) {
  const slug = String(named || "").trim().toLowerCase();
  if (slug) return SLUG.test(slug) && (await q("SELECT slug FROM platform.companies WHERE slug=$1", [slug])).rows[0] ? slug : null;
  const all = (await q("SELECT slug FROM platform.companies ORDER BY created_at LIMIT 2")).rows;
  return all.length === 1 ? all[0].slug : null;
}

// -> { role, company } or null
async function sessionFor(password, companyNamed) {
  password = String(password || "");
  if (!password) return null;
  // The shared admin password: only while no admin account has a working authenticator (src/accounts.js legacyOpen).
  // Asked only when the answer matters, so a floor login never waits on (or fails with) the accounts tables.
  let answer = null;
  const sharedOpen = async () => (answer === null ? (answer = await accounts.legacyOpen()) : answer);
  if (ADMIN ? same(password, ADMIN) : same(password, MANAGER)) {
    if (await sharedOpen()) return { role: "admin", company: ALL, shared: true };
    if (ADMIN) return { refused_shared: true };   // without ADMIN set it is the manager password too, and goes on to be one below
  }
  const company = await resolveCompany(companyNamed);
  if (!company) return null;
  const row = await accessRow(company);
  const gen = row ? Number(row.generation || 1) : 0;
  if (row && row.manager_hash && checkHash(password, row.manager_hash)) return { role: "manager", company, gen, via: "shared manager password" };
  if (row && row.floor_hash && checkHash(password, row.floor_hash)) return { role: "floor", company, gen, via: row.floor_pin ? "floor PIN" : "floor password" };
  if (row && row.legacy_login) {
    // (while the manager password doubles as the shared admin password it was taken as admin above, as before)
    if (!row.manager_hash && same(password, MANAGER) && (ADMIN || !(await sharedOpen()))) return { role: "manager", company, gen, via: "instance-wide manager password" };
    if (!row.floor_hash && same(password, FLOOR)) return { role: "floor", company, gen, via: "instance-wide floor password" };
  }
  return null;
}

// Middleware: attaches req.sosRole and req.sosCompany; redirects/401s when not logged in.
function middleware(req, res, next) {
  if (OPEN) { req.sosRole = "admin"; req.sosCompany = ALL; return next(); }
  const p = req.path;
  if (p === "/login" || p === "/health" || p.startsWith("/assets/")) return next();
  if (req.headers["x-sos-internal"] === INTERNAL) { req.sosRole = "admin"; req.sosCompany = ALL; req.sosInternal = true; return next(); }   // the platform's own calls; never the accounts (src/accounts.js)
  const session = verify(parseCookies(req)[COOKIE]);
  if (!session) return toLogin(req, res, 401, "login required");
  // a session someone logged out of is over, for every copy of its cookie (the outside audit 1A, S1-03)
  isRevoked(session.sid).then((gone) => (gone ? toLogin(req, res, 401, "login required") : admit(req, res, next, session, p))).catch(next);
}
function admit(req, res, next, session, p) {
  // the session slides: once it has verified, a cookie past half its idle window (or in the old shape) goes back refreshed
  const accept = () => { req.sosRole = session.role; req.sosCompany = session.company; req.sosSession = { issued: session.issued, refreshed: session.refreshed, sid: session.sid, enroll: session.enroll }; if (session.refresh) reissue(req, res, session); next(); };
  if (session.role === "admin") {
    // the shared admin password's session ends the moment that password stops opening admin
    if (!session.account) return accounts.legacyOpen().then((open) => (open ? accept() : toLogin(req, res, 401, "login required"))).catch(next);
    // a named account: still there, still switched on, and not signed out everywhere since this cookie was made
    return accounts.sessionState(session.account).then((st) => {
      if (!st || st.role !== "admin" || st.status !== "active" || st.generation !== session.gen) return toLogin(req, res, 401, "login required");
      // an enrollment-only session ends once the account has its factor, whoever set it up (S1-01)
      if (session.enroll && (st.enrolled || accounts.twoFaOff())) return toLogin(req, res, 401, "login required");
      req.sosAccount = { id: st.id, login: st.login, name: st.name, role: "admin", enrolled: st.enrolled };
      if ((session.enroll || (!st.enrolled && !accounts.twoFaOff())) && !ENROLL_PATHS.test(p)) {
        if (req.method === "GET" && !/(^|\/)api\//.test(p)) return res.redirect("/admin");
        return res.status(403).json({ error: "set up your authenticator app first", enroll_required: true });
      }
      accept();
    }).catch(next);
  }
  if (session.role === "manager" && session.account) {
    // a manager account: still there, switched on, a manager of this company, not signed out everywhere since
    return accounts.sessionState(session.account).then((st) => {
      if (!st || st.role !== "manager" || st.company !== session.company || st.status !== "active" || st.generation !== session.gen) return toLogin(req, res, 401, "login required");
      if (session.enroll && (st.enrolled || accounts.twoFaOff())) return toLogin(req, res, 401, "login required");
      req.sosAccount = { id: st.id, login: st.login, name: st.name, role: "manager", company: st.company, enrolled: st.enrolled };
      if ((session.enroll || (!st.enrolled && !accounts.twoFaOff())) && !managerEnrollPath(p, session.company)) {
        if (req.method === "GET" && !/(^|\/)api\//.test(p)) return res.redirect(`/c/${session.company}/enroll`);
        return res.status(403).json({ error: "set up your authenticator app first", enroll_required: true, enroll_url: `/c/${session.company}/enroll` });
      }
      accept();
    }).catch(next);
  }
  // a company's password changed since this cookie was signed: sign in again
  generationOf(session.company).then((gen) => (gen && gen === session.gen ? accept() : toLogin(req, res, 401, "login required"))).catch(next);
}

// ---- logged out sessions (the outside audit 1A, S1-03, 2026-10-13) -----------------------------------------------------
// Before this, /logout only told the browser to drop its cookie: a copy of it kept working until its cap (30 days for
// an admin, 180 for a manager or a floor device). Now /logout writes the session's id here, and every request checks
// it. A row is kept as long as a copy of that cookie could otherwise live (its cap; forever when there is none).
// Remembered ten seconds per id like the account state, and at once in the process that wrote it.
const revokedCache = new Map();   // sid -> { gone, at }
async function isRevoked(sid) {
  if (!sid) return false;
  const hit = revokedCache.get(sid);
  if (hit && (hit.gone || Date.now() - hit.at < 10000)) return hit.gone;
  const gone = (await q("SELECT 1 FROM platform.revoked_sessions WHERE sid=$1", [sid])).rows.length > 0;
  if (revokedCache.size > 20000) revokedCache.clear();
  revokedCache.set(sid, { gone, at: Date.now() });
  return gone;
}
async function revoke(session, why = "logout") {
  if (!session || !session.sid) return;
  const w = windowFor(session.role);
  const until = session.enroll ? session.issued + ENROLL_MS : w.cap ? session.issued + w.cap * 3600e3 : null;
  await q("INSERT INTO platform.revoked_sessions (sid, expires_at, why) VALUES ($1, $2, $3) ON CONFLICT (sid) DO NOTHING",
    [session.sid, until ? new Date(until) : null, why]);
  revokedCache.set(session.sid, { gone: true, at: Date.now() });
}

// Who this browser is signed in as, without sending it anywhere: the same checks the middleware makes, answered as data
// (null for nobody). anetix.ai asks it (GET /login/session, server.js) so its front door can say "you are still signed
// in" instead of showing a sign-in box to someone whose session here is alive (2026-10-01: a demo manager left the
// refill page for anetix.ai's front page, met its sign-in and took it for being signed out).
async function currentSession(req) {
  if (OPEN) return { role: "admin", company: null };
  const s = verify(parseCookies(req)[COOKIE]);
  if (!s || (await isRevoked(s.sid))) return null;
  if (s.role === "admin") {
    if (!s.account) return (await accounts.legacyOpen()) ? { role: "admin", company: null } : null;   // the shared admin password, while it still opens admin
    const st = await accounts.sessionState(s.account);
    if (!st || st.role !== "admin" || st.status !== "active" || st.generation !== s.gen) return null;
    if (s.enroll && (st.enrolled || accounts.twoFaOff())) return null;
    return { role: "admin", company: null };
  }
  if (s.role === "manager" && s.account) {
    const st = await accounts.sessionState(s.account);
    if (!st || st.role !== "manager" || st.company !== s.company || st.status !== "active" || st.generation !== s.gen) return null;
    if (s.enroll && (st.enrolled || accounts.twoFaOff())) return null;
    return { role: "manager", company: s.company, enroll: s.enroll || (!st.enrolled && !accounts.twoFaOff()) };
  }
  const gen = await generationOf(s.company);
  return gen && gen === s.gen ? { role: s.role, company: s.company } : null;
}
// All a manager account may reach before its authenticator is set up: its company's enrollment page, who-am-I, the
// two setup calls, and the way out.
// The two passkey calls are here since 2026-09-27 (the launch audit 1.3): a manager may set up a passkey as the first
// factor, and src/passkeys.js hands back the recovery codes when it is the account's first.
function managerEnrollPath(p, company) {
  return p === "/logout" || p === `/c/${company}/enroll` || p === `/api/c/${company}/me` || p === `/api/c/${company}/me/enroll/start` || p === `/api/c/${company}/me/enroll/verify`
    || p === "/api/me/passkeys/options" || p === "/api/me/passkeys";
}
// All an admin account may reach before its authenticator is set up: the admin page (which shows the setup and
// nothing else), who-am-I, and the two setup calls.
const ENROLL_PATHS = /^\/(?:admin|logout|api\/admin\/accounts\/me(?:\/enroll\/(?:start|verify))?)$/;
function toLogin(req, res, status, error) {
  const p = req.path;
  if (req.method === "GET" && !p.startsWith("/api/") && !/\/api\//.test(p)) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  return res.status(status).json({ error });
}

// ---- one company per session ------------------------------------------------------------------
// Routes addressed by id instead of by /c/<slug>/: where the owning company is kept.
// Every pattern here is case-blind, like Express's own routing (found 2026-09-27, the launch audit 0.1): Express
// answers /API/C/<slug>/... with the /api/c/:slug/... route, so a case-sensitive check here let a session of one
// company read another's by typing the path in capitals.
const OWNERS = [
  [/^\/api\/feedback\/(\d+)(?:\/|$)/i, "SELECT company FROM platform.feedback WHERE id=$1"],
  [/^\/api\/proposals\/(\d+)(?:\/|$)/i, "SELECT f.company FROM platform.proposals p JOIN platform.feedback f ON f.id=p.feedback_id WHERE p.id=$1"],
  [/^\/api\/runs\/(\d+)(?:\/|$)/i, "SELECT company FROM platform.build_runs WHERE id=$1"],
  [/^\/api\/intakes\/(\d+)(?:\/|$)/i, "SELECT company FROM platform.module_intakes WHERE id=$1"],
  [/^\/api\/attachments\/(\d+)(?:\/|$)/i, "SELECT company FROM platform.attachments WHERE id=$1"],
];
async function companyGuard(req, res, next) {
  try {
    if (OPEN || req.sosRole === "admin" || !req.sosRole) return next();   // no role = a public path the middleware let through
    const p = req.path;
    const scoped = /^\/(?:api\/)?c\/([^/]+)(?:\/|$)/i.exec(p);
    let owner = scoped ? decodeURIComponent(scoped[1]) : null;
    if (!owner) {
      for (const [re, sql] of OWNERS) {
        const m = re.exec(p);
        if (!m) continue;
        // the routes behind these take one to nine digits only (the launch audit 0.1), so what this checks is exactly
        // what the route will read; an id past the column's range is nobody's
        const id = Number(m[1]);
        if (!Number.isSafeInteger(id) || id > 2147483647) return res.status(404).json({ error: "not found" });
        const row = (await q(sql, [id])).rows[0];
        if (!row) return res.status(404).json({ error: "not found" });
        owner = row.company;
        break;
      }
    }
    if (owner && owner !== req.sosCompany) return toLogin(req, res, 403, "this login is for another company");
    next();
  } catch (e) { next(e); }
}
// For the few routes that name their company in the body instead of the path.
function ownsCompany(req, slug) { return OPEN || req.sosRole === "admin" || (slug && slug === req.sosCompany); }

// Step-up for destructive admin actions (delete a company, restore a backup),
// checked here, never on the client. A named account gives a FRESH code from
// its authenticator: the step is claimed the same way a sign-in claims it, so
// the code that signed the person in a few seconds ago does not count (its
// password instead under SOS_ADMIN_2FA=off). The shared admin password's
// session, which exists only until the first authenticator is set up, types
// that password again, as before. With no passwords set (local dev) anything
// passes. -> { ok, error }
async function checkAdminCode(req, { code, password, passkey } = {}, what) {
  if (OPEN) return { ok: true };
  // a passkey answers for the code (2026-09-27): every caller passes the body's code, so its passkey is read from the body here
  if (passkey === undefined && req.body && typeof req.body === "object") passkey = req.body.passkey;
  if (req.sosAccount && req.sosAccount.id) return accounts.stepUp(req.sosAccount, { code, password, passkey }, edge.clientIp(req), what, req);
  const ok = (await accounts.legacyOpen()) && same(password, ADMIN || MANAGER);
  await accounts.event(ok ? "legacy_admin_password" : "step_up_fail", { ip: edge.clientIp(req), detail: { at: "step_up", what } });
  return ok ? { ok: true } : { ok: false, error: "wrong admin password" };
}

function requireManager(req, res, next) {
  if (req.sosRole === "manager" || req.sosRole === "admin") return next();
  res.status(403).json({ error: "manager login required" });
}
function requireAdmin(req, res, next) {
  if (req.sosRole === "admin") return next();
  res.status(403).json({ error: "admin login required" });
}

// Login rate limit: in-memory, per client IP, failures only. Enough to stop a
// password guesser; resets on a successful login. The address comes from
// src/edge.js, the one place it is read: Cloudflare's header when the request
// provably came through Cloudflare, never the client-supplied X-Forwarded-For.
// A named account has a lock of its own on top of this (src/accounts.js), so
// a guesser who rotates addresses still gets five tries per fifteen minutes.
const loginFails = new Map();  // ip -> { count, first }
const clientIp = edge.clientIp;
function loginBlocked(ip) {
  const rec = loginFails.get(ip);
  if (!rec) return 0;
  if (Date.now() - rec.first > LOGIN_WINDOW_MS) { loginFails.delete(ip); return 0; }
  return rec.count >= LOGIN_MAX_FAILS ? Math.ceil((rec.first + LOGIN_WINDOW_MS - Date.now()) / 1000) : 0;
}
function noteLoginFail(ip) {
  const rec = loginFails.get(ip);
  if (rec && Date.now() - rec.first <= LOGIN_WINDOW_MS) rec.count++;
  else loginFails.set(ip, { count: 1, first: Date.now() });
}
setInterval(() => {
  const cutoff = Date.now() - LOGIN_WINDOW_MS;
  for (const [ip, rec] of loginFails) if (rec.first < cutoff) loginFails.delete(ip);
  for (const [k, rec] of deviceFails) if (rec.first < cutoff && !(rec.until > Date.now())) deviceFails.delete(k);
  for (const [k, rec] of plantFails) if (rec.first < cutoff && !(rec.until > Date.now())) plantFails.delete(k);
}, 60 * 1000).unref();

// ---- the floor PIN at the plant (2026-10-29) -------------------------------------------------------------------------
// A whole plant comes from one address, so the per-address limit above would lock every device on the floor out after
// ten typos between them. A sign-in to a company FROM that company's own network list is counted another way:
//   per device   a cookie of its own (sos_fdev, path /login): SOS_FLOOR_DEVICE_FAILS (5) wrong tries inside the window
//                and that device waits SOS_FLOOR_DEVICE_LOCK_MIN (5) minutes;
//   per plant    SOS_FLOOR_COMPANY_FAILS (40) wrong tries from the plant inside SOS_LOGIN_WINDOW_MIN (15) and the
//                plant's shared sign-in pauses for the rest of the window, with one phone alert to Anetix.
// A guesser who clears the cookie still meets the plant's count, and has to be on the plant's wifi to try at all. A
// device already signed in stays in through a pause. A named account never comes this way (it has its own lock).
const FDEV_COOKIE = "sos_fdev";
const FLOOR_DEVICE_FAILS = Math.max(1, Number(process.env.SOS_FLOOR_DEVICE_FAILS || 5));
const FLOOR_DEVICE_LOCK_MS = Math.max(1, Number(process.env.SOS_FLOOR_DEVICE_LOCK_MIN || 5)) * 60e3;
const FLOOR_COMPANY_FAILS = Math.max(1, Number(process.env.SOS_FLOOR_COMPANY_FAILS || 40));
const deviceFails = new Map();   // device id -> { count, first, until }
const plantFails = new Map();    // company -> { count, first, until, told }
// This browser's id for counting, made and handed back when it has none.
function floorDevice(req, res) {
  let id = parseCookies(req)[FDEV_COOKIE];
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(id || "")) {
    id = crypto.randomBytes(16).toString("base64url");
    const secure = req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
    res.append("Set-Cookie", `${FDEV_COOKIE}=${id}; Path=/login; HttpOnly; SameSite=Lax; Max-Age=${365 * 86400}${secure}`);
  }
  return id;
}
// -> null, or { who: "device" | "plant", wait } in seconds
function plantWait(device, company, now = Date.now()) {
  const d = deviceFails.get(device);
  if (d && d.until > now) return { who: "device", wait: Math.ceil((d.until - now) / 1000) };
  const c = plantFails.get(company);
  if (c && c.until > now) return { who: "plant", wait: Math.ceil((c.until - now) / 1000) };
  return null;
}
function notePlantFail(device, company, now = Date.now()) {
  let d = deviceFails.get(device);
  if (!d || now - d.first > LOGIN_WINDOW_MS || d.until) deviceFails.set(device, d = { count: 0, first: now });
  if (++d.count >= FLOOR_DEVICE_FAILS) d.until = now + FLOOR_DEVICE_LOCK_MS;
  let c = plantFails.get(company);
  if (!c || now - c.first > LOGIN_WINDOW_MS) plantFails.set(company, c = { count: 0, first: now });
  if (++c.count >= FLOOR_COMPANY_FAILS && !c.until) {
    c.until = c.first + LOGIN_WINDOW_MS;
    if (!c.told) {
      c.told = true;
      const back = new Date(c.until).toISOString().slice(11, 16);
      try { require("./notify").notify(`Floor sign-in paused: ${company}`, `${c.count} wrong floor PINs from ${company}'s own network in ${Math.round(LOGIN_WINDOW_MS / 60e3)} minutes. Its floor sign-in is paused until ${back} UTC; devices already in stay in.`, { priority: 4, tags: ["lock"], ref: company }); } catch (e) { /* the alert is a courtesy */ }
      accounts.event("floor_pin_paused", { detail: { company, fails: c.count } }).catch(() => {});
    }
  }
}
// What the floor is told when its sign-in is refused for the plant's sake. The words go on the login page as they are.
const WAIT_WORDS = {
  device: (s) => `Too many wrong tries on this phone or tablet. Wait ${Math.max(1, Math.ceil(s / 60))} minute${s > 60 ? "s" : ""} and try again, or ask your manager for the floor PIN.`,
  plant: (s) => `Too many wrong PINs at this plant in a short time, so the floor's sign-in is paused for ${Math.max(1, Math.ceil(s / 60))} minute${s > 60 ? "s" : ""}. Phones and tablets already signed in keep working.`,
};

async function loginHandler(req, res) {
  const ip = clientIp(req);
  const safeguards = require("./safeguards");
  const { password, company, name, code, remember } = req.body || {};
  const byName = Boolean(String(name || "").trim());
  // where this sign-in is counted: at a company's own plant (its network list holds this address) per device and per
  // plant; anywhere else per address, as before
  const named = byName ? null : await resolveCompany(company);
  const plant = named ? await safeguards.atPlant(req, named) : false;
  const device = plant ? floorDevice(req, res) : null;
  if (plant) {
    const held = plantWait(device, named);
    if (held) {
      res.set("Retry-After", String(held.wait));
      return res.status(429).json({ error: WAIT_WORDS[held.who](held.wait), code: held.who === "device" ? "device_wait" : "plant_wait" });
    }
  } else {
    const wait = loginBlocked(ip);
    if (wait) {
      res.set("Retry-After", String(wait));
      return res.status(429).json({ error: `too many failed logins; try again in ${Math.ceil(wait / 60)} min` });
    }
  }
  const failed = () => (plant ? notePlantFail(device, named) : noteLoginFail(ip));
  try {
    const now = Date.now();
    // A name means a named account: password, then a code from the authenticator. Nothing is kept between the two
    // requests: the page sends name, password and code together the second time. A browser this account trusted
    // (src/devices.js) carries a cookie on this one route and skips the code.
    if (byName) {
      const r = await accounts.signIn({ login: name, password, code, ip, device: parseCookies(req)[devices.COOKIE], remember: Boolean(remember), ua: req.headers["user-agent"] });
      if (r.need_code && !r.error) {
        if (r.clear_device) res.set("Set-Cookie", devices.clearHeader(req));   // an expired row or a moved generation: the cookie is dead weight
        // passkey_first (the launch audit 1.3): a manager whose second step is a passkey, not an app; the page asks for a
        // recovery code instead of the app's, and offers no "remember this computer" for it
        if (r.passkey_first) return res.json({ need_code: true, passkey_first: true });
        return res.json({ need_code: true, remember_days: devices.DAYS });   // the page's "remember this computer" box names the days
      }
      if (!r.ok) {
        noteLoginFail(ip);
        if (r.retry_after) res.set("Retry-After", String(r.retry_after));
        // a PIN typed into the account form (a floor person on the bare address): say where a PIN goes
        const pinShaped = /^\d{4,8}$/.test(String(password || "")) && !r.need_code;
        return res.status(r.status || 401).json({ error: r.error, need_code: Boolean(r.need_code), ...(pinShaped ? { code: "pin_in_account_form" } : {}), ...(r.passkey_first ? { passkey_first: true } : {}) });
      }
      loginFails.delete(ip);
      const extra = r.device ? [devices.cookieHeader(req, `${r.device.id}.${r.device.token}`, devices.DAYS * 86400)] : [];
      const out = startAccountSession(req, res, r.account, { enroll: r.enroll, extraCookies: extra, now });
      return res.json({ ...out, trusted: Boolean(r.trusted), remembered: Boolean(r.device) });
    }
    // A company whose shared sign-ins work only from its own network (src/safeguards.js): a device anywhere else gets
    // the same answer whether the password was right or wrong, and gets it BEFORE any password is hashed, so neither
    // the words nor the time the answer takes says anything about the password. The old shared admin password is the
    // one thing looked at first (a plain comparison, no hash): it is not a company's, and it is held to the list
    // below if it turns out to be only the manager password doing double duty.
    const offNetworkAnswer = async (forCompany) => {
      noteLoginFail(ip);
      await accounts.event("off_network", { ip, detail: { company: forCompany } });
      return res.status(403).json({ error: safeguards.OFF_NETWORK, off_network: true, code: "off_network" });
    };
    if (!(ADMIN ? same(password, ADMIN) : same(password, MANAGER))) {
      if (named && await safeguards.offNetwork(req, named)) return offNetworkAnswer(named);
    }
    let session = await sessionFor(password, company);
    if (session && session.refused_shared) { await accounts.event("legacy_admin_refused", { ip }); session = null; }
    if (session && session.role !== "admin") {
      const where = await safeguards.whereFrom(req, session.company, session.role);
      if (where === "off") return offNetworkAnswer(session.company);
      // a floor PIN with no plant on file: the same answer as a wrong PIN gets below, so it says nothing about the PIN
      if (where === "unset") { failed(); return res.status(403).json({ error: safeguards.NO_NETWORK, code: "floor_no_network" }); }
    }
    if (!session) {
      failed();
      // say when the missing piece is the company, so the page can ask for it
      const needCompany = !String(company || "").trim() && !(await resolveCompany(""));
      const row = named ? await accessRow(named) : null;
      const pinShaped = /^\d{4,8}$/.test(String(password || ""));
      if (row && row.floor_hash && row.floor_pin && pinShaped && (await safeguards.whereFrom(req, named, "floor")) === "unset") {
        return res.status(403).json({ error: safeguards.NO_NETWORK, code: "floor_no_network" });
      }
      // what the page says: a wrong floor PIN, a PIN in a box that wants the floor's password, or a wrong password
      const code = needCompany ? "need_company" : row && row.floor_pin ? (pinShaped ? "wrong_pin" : "wrong_password") : pinShaped ? "pin_in_password_box" : "wrong_password";
      return res.status(401).json({ error: needCompany ? "which company is this login for?" : code === "wrong_pin" ? "wrong PIN" : "wrong password", need_company: needCompany, code });
    }
    if (plant) deviceFails.delete(device); else loginFails.delete(ip);
    if (session.shared) await accounts.event("legacy_admin_password", { ip, detail: { at: "sign_in" } });
    // a shared sign-in (the floor's PIN or password, a shared manager password) is on the sign-in log too since
    // 2026-10-29, so the sign-in map (src/signins.js) can say who still uses one before it is taken away
    else if (session.role === "floor" || session.role === "manager") await accounts.event("shared_sign_in", { ip, detail: { company: session.company, role: session.role, by: session.via || null } }).catch(() => {});
    const value = session.role === "admin" ? signAdmin(0, 0, null, now) : sign(session.role, session.company, session.gen, null, now);
    res.append("Set-Cookie", cookieHeader(req, value, maxAgeFor(session.role, now, now)));
    res.json({ ok: true, role: session.role, company: session.company === ALL ? null : session.company });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// GET /login/ticket?t=<id>.<token>: the one sign-in a new demo's manager gets straight from anetix.ai's set-up form
// (src/tickets.js, the launch audit 3.8). Good: the enrollment-only session a password would give, and on to the
// authenticator setup. Anything else: the sign-in page with the email filled in, where the password works as always.
// The ticket rides in the address, so this answer tells the browser to send no Referer on, and is never cached.
async function ticketHandler(req, res) {
  const ip = clientIp(req);
  res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  const wait = loginBlocked(ip);
  if (wait) return res.redirect(303, "/login");
  try {
    const r = await require("./tickets").redeem(req.query.t);
    if (!r.ok) {
      noteLoginFail(ip);
      await accounts.event("ticket_refused", { login: r.login || null, ip, detail: { why: r.why } });
      return res.redirect(303, `/login${r.login ? `?account=${encodeURIComponent(r.login)}` : ""}`);
    }
    loginFails.delete(ip);
    await accounts.event("signin_ticket", { account_id: r.account.id, login: r.account.login, ip });
    accounts.forget(r.account.id);
    const out = startAccountSession(req, res, r.account, { enroll: true });
    res.redirect(303, out.enroll_url || `/c/${r.account.company}/`);
  } catch (e) { console.error("[ticket]", e.message); res.redirect(303, "/login"); }
}

// The session a named account gets, however it proved who it is (password and code here, a passkey in
// src/passkeys.js): the cookie, and the answer the sign-in pages act on.
// enroll: the account has no second factor yet, so the session is ENROLLMENT-ONLY (see the top; the outside audit 1A,
// S1-01): it reaches the setup and nothing else, for ENROLL_MINUTES, and it never becomes a full session, not even once
// the account is set up. The browser that sets the factor up gets a full one then (finishEnrollment).
function startAccountSession(req, res, account, { enroll = false, extraCookies = [], now = Date.now() } = {}) {
  const manager = account.role === "manager";
  const times = { tag: newTag(Boolean(enroll)) };
  const role = manager ? "manager" : "admin";
  const value = manager ? signManager(account.id, account.company, account.generation, times, now) : signAdmin(account.id, account.generation, times, now);
  res.set("Set-Cookie", [cookieHeader(req, value, maxAgeFor(role, now, now, Boolean(enroll))), ...extraCookies]);
  return { ok: true, role, company: manager ? account.company : null, enroll: Boolean(enroll), enroll_url: manager && enroll ? `/c/${account.company}/enroll` : undefined };
}
// After a factor is set up (the app's first code checked, or a manager's first passkey saved): this browser proved it,
// so its enrollment-only session becomes a full one, in the same answer. Any other enrollment-only session of the
// account ends by itself (the middleware). Then the next factor this browser adds in the following minutes (the
// passkey offered right after the app) needs no second proof: accounts.grantNewFactor.
async function finishEnrollment(req, res) {
  const id = req.sosAccount && req.sosAccount.id;
  if (!id || !req.sosSession || !req.sosSession.enroll) return;
  accounts.forget(id);
  const a = (await q("SELECT * FROM platform.accounts WHERE id=$1", [id])).rows[0];
  const st = a ? await accounts.sessionState(id) : null;
  if (!a || !st || !st.enrolled || a.status !== "active") return;
  const now = Date.now();
  const value = a.role === "manager" ? signManager(a.id, a.company, a.generation, null, now) : signAdmin(a.id, a.generation, null, now);
  res.append("Set-Cookie", cookieHeader(req, value, maxAgeFor(a.role, now, now)));
  await revoke({ ...req.sosSession, role: a.role }, "enrolled");
  accounts.grantNewFactor(verify(value, now).sid, st);
}

// Signing out of a named account (an admin, a demo's manager) lands on the account sign-in, not on the company
// password box, which a demo does not have (Brendan, 2026-09-25: "it takes you to a pin only enter, then it errors").
// The session is revoked on the server too (the outside audit 1A, S1-03): a copy of the cookie stops working with it.
// Only this session: the account's others, and a company's other floor devices, carry on.
async function logoutHandler(req, res) {
  let account = false;
  try {
    const v = verify(parseCookies(req)[COOKIE]);
    account = Boolean(v && v.account);
    if (v) await revoke(v, "logout");
  } catch (e) { console.error("[auth] logout:", e.message); }
  res.set("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; Max-Age=0`);
  res.redirect(account ? "/login?staff=1" : "/login");
}
// How a company's people sign in, for the login page: "account" for a company whose only way in is a named account
// (a personal demo, accountsOnly), so the page opens the account form at once; "pin" for a company whose floor signs
// in with its floor PIN (the page shows a number pad); "password" otherwise, including for a code that is not a
// company (the page then behaves as it always has).
async function loginMode(slug) {
  slug = String(slug || "").toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(slug)) return "password";
  const row = await accessRow(slug);
  if (row && !row.floor_hash && !row.manager_hash && !row.legacy_login) return "account";
  return row && row.floor_hash && row.floor_pin ? "pin" : "password";   // "pin": the floor signs in with its PIN (a number pad)
}

// A company's name for the login page, or null for a code that is not a company.
async function companyName(slug) {
  slug = String(slug || "").toLowerCase();
  if (!SLUG.test(slug)) return null;
  const row = (await q("SELECT name FROM platform.companies WHERE slug=$1", [slug])).rows[0];
  return row ? row.name : null;
}

module.exports = { companyName, startAccountSession, finishEnrollment, isRevoked, revoke, ENROLL_MINUTES, loginBlocked, noteLoginFail,
  middleware, currentSession, companyGuard, ownsCompany, requireManager, requireAdmin, loginHandler, logoutHandler, checkAdminCode,
  setPasswords, accountsOnly, dropManagerPassword, loginMode, generatePassword, generateFloorPin, validFloorPin, guessable, FLOOR_PIN_MIN, FLOOR_PIN_MAX, windowFor,
  plantWait, notePlantFail, FDEV_COOKIE, _resetPlantCounts: () => { deviceFails.clear(); plantFails.clear(); }, serviceCookie, ensureAccessRows, accessRow, accessPublic, hashPassword, checkHash, sign, signAdmin, signManager, verify, OPEN, ALL, hmac, parseCookies, managerEnrollPath,
  clientIp, ENROLL_PATHS, WINDOWS, ticketHandler, alive, refreshDue, maxAgeFor, cookieHeader, reissue, hoursVar, RETIRED_ENV, COOKIE,
};
