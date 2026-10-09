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
//     floor, manager   SOS_SESSION_IDLE_HOURS 720 (30 days)   SOS_SESSION_CAP_HOURS 4320 (180 days; 0 = no cap)
//   (the person cookie has its own pair in src/people.js). The cookie from
//   before this carried one time; it is accepted while its one time is inside
//   both windows, and re-issued in the new shape on the first request seen, so
//   the deploy signed nobody out. SOS_ADMIN_SESSION_HOURS and SOS_SESSION_DAYS
//   are no longer read (boot says so if they are set).
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
};
const RETIRED_ENV = ["SOS_ADMIN_SESSION_HOURS", "SOS_SESSION_DAYS"];
for (const name of RETIRED_ENV) if (process.env[name] !== undefined) console.warn(`[auth] ${name} is no longer read (sessions slide since 2026-09-24: SOS_ADMIN_IDLE_HOURS / SOS_ADMIN_CAP_HOURS, SOS_SESSION_IDLE_HOURS / SOS_SESSION_CAP_HOURS). Take it out of Railway.`);
const windowFor = (role) => (role === "admin" ? WINDOWS.admin : WINDOWS.device);
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

// ---- company access rows ---------------------------------------------------------------
async function accessRow(slug) {
  return (await q("SELECT * FROM platform.company_access WHERE company=$1", [slug])).rows[0] || null;
}
// Set one or both passwords. Giving a company its own passwords ends its use of the shared ones.
async function setPasswords(slug, { floor, manager }) {
  if (!floor && !manager) throw new Error("give at least one password");
  for (const [label, p] of [["floor", floor], ["manager", manager]]) if (p && String(p).length < 8) throw new Error(`the ${label} password needs at least 8 characters`);
  if (floor && manager && String(floor) === String(manager)) throw new Error("the floor and manager passwords must differ: the password is what tells the two apart");
  await q(
    `INSERT INTO platform.company_access (company, floor_hash, manager_hash, legacy_login) VALUES ($1,$2,$3,false)
     ON CONFLICT (company) DO UPDATE SET floor_hash=COALESCE($2, platform.company_access.floor_hash),
       manager_hash=COALESCE($3, platform.company_access.manager_hash), legacy_login=false,
       generation=platform.company_access.generation + 1, updated_at=now()`,
    [slug, floor ? hashPassword(floor) : null, manager ? hashPassword(manager) : null]);
  generations.delete(slug);
}
// A company whose only way in is a named account (a personal demo from anetix.ai, 2026-09-25: one person, one
// manager account with an authenticator, no floor): an access row with no floor or manager password and
// legacy_login off, so neither a company password nor the shared SOS_FLOOR/MANAGER fallback ever opens it.
async function accountsOnly(slug) {
  await q(`INSERT INTO platform.company_access (company, legacy_login) VALUES ($1,false)
           ON CONFLICT (company) DO UPDATE SET floor_hash=NULL, manager_hash=NULL, legacy_login=false,
             generation=platform.company_access.generation + 1, updated_at=now()`, [slug]);
  generations.delete(slug);
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
  return { own_floor: Boolean(row && row.floor_hash), own_manager: Boolean(row && row.manager_hash), legacy_login: Boolean(row && row.legacy_login), updated_at: row ? row.updated_at : null,
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
// role.company.generation.issued.refreshed.mac (times in base 36 ms). `times` carries a session on: the same
// issued, a new refreshed. Without it both are now (a sign-in). `now` is for the unit cases only.
function sign(role, company, gen, times, now = Date.now()) {
  const issued = times && Number.isFinite(times.issued) ? times.issued : now;
  const refreshed = times && Number.isFinite(times.refreshed) ? times.refreshed : now;
  const payload = `${role}.${company}.${Number(gen) || 0}.${issued.toString(36)}.${refreshed.toString(36)}`;
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
function maxAgeFor(role, issued, now = Date.now()) {
  const w = windowFor(role);
  let s = w.idle * 3600;
  if (w.cap) s = Math.min(s, (issued + w.cap * 3600e3 - now) / 1000);
  return Math.max(60, Math.round(s));
}

// -> { role, company, gen, account?, slot, issued, refreshed, refresh, legacy } or null
function verify(token, now = Date.now()) {
  if (!token) return null;
  const parts = token.split(".");
  // five parts: the shape before sliding windows (one time); six: issued and refreshed. Anything else is nobody
  // (cookies from before sessions carried a company had four).
  if (parts.length !== 5 && parts.length !== 6) return null;
  const legacy = parts.length === 5;
  const [role, company, gen, ts1, ts2] = legacy ? [parts[0], parts[1], parts[2], parts[3], parts[3]] : parts;
  const mac = parts[parts.length - 1];
  const payload = legacy ? `${role}.${company}.${gen}.${ts1}` : `${role}.${company}.${gen}.${ts1}.${ts2}`;
  const expect = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  if (mac.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
  if (!["admin", "manager", "floor"].includes(role)) return null;
  if (!/^[0-9a-z]{1,12}$/.test(ts1) || !/^[0-9a-z]{1,12}$/.test(ts2)) return null;
  const issued = parseInt(ts1, 36), refreshed = parseInt(ts2, 36);
  if (!alive(role, issued, refreshed, now)) return null;   // expired, or a forged time
  const times = { slot: company, issued, refreshed, legacy, refresh: refreshDue(role, refreshed, legacy, now) };
  if (role !== "admin") {
    if (SLUG.test(company)) return { role, company, gen: Number(gen) || 0, ...times };
    // a manager ACCOUNT (2026-09-25, self-serve companies): "<slug>~<account id>", gen = the account's generation
    const a = role === "manager" ? /^([a-z0-9][a-z0-9-]{1,40})~(\d{1,9})$/.exec(company) : null;
    return a ? { role, company: a[1], gen: Number(gen) || 0, account: Number(a[2]), ...times } : null;
  }
  // admin: "*<account id>". The admin cookie from before named accounts ("*" alone) is no longer accepted: sign in again.
  const m = /^\*(\d{1,9})$/.exec(company);
  return m ? { role, company: ALL, gen: Number(gen) || 0, account: Number(m[1]), ...times } : null;
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
  const value = sign(session.role, session.slot, session.gen, { issued: session.issued, refreshed: now }, now);
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
  if (row && row.manager_hash && checkHash(password, row.manager_hash)) return { role: "manager", company, gen };
  if (row && row.floor_hash && checkHash(password, row.floor_hash)) return { role: "floor", company, gen };
  if (row && row.legacy_login) {
    // (while the manager password doubles as the shared admin password it was taken as admin above, as before)
    if (!row.manager_hash && same(password, MANAGER) && (ADMIN || !(await sharedOpen()))) return { role: "manager", company, gen };
    if (!row.floor_hash && same(password, FLOOR)) return { role: "floor", company, gen };
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
  // the session slides: once it has verified, a cookie past half its idle window (or in the old shape) goes back refreshed
  const accept = () => { req.sosRole = session.role; req.sosCompany = session.company; req.sosSession = { issued: session.issued, refreshed: session.refreshed }; if (session.refresh) reissue(req, res, session); next(); };
  if (session.role === "admin") {
    // the shared admin password's session ends the moment that password stops opening admin
    if (!session.account) return accounts.legacyOpen().then((open) => (open ? accept() : toLogin(req, res, 401, "login required"))).catch(next);
    // a named account: still there, still switched on, and not signed out everywhere since this cookie was made
    return accounts.sessionState(session.account).then((st) => {
      if (!st || st.role !== "admin" || st.status !== "active" || st.generation !== session.gen) return toLogin(req, res, 401, "login required");
      req.sosAccount = { id: st.id, login: st.login, name: st.name, role: "admin", enrolled: st.enrolled };
      if (!st.enrolled && !accounts.twoFaOff() && !ENROLL_PATHS.test(p)) {
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
      req.sosAccount = { id: st.id, login: st.login, name: st.name, role: "manager", company: st.company, enrolled: st.enrolled };
      if (!st.enrolled && !accounts.twoFaOff() && !managerEnrollPath(p, session.company)) {
        if (req.method === "GET" && !/(^|\/)api\//.test(p)) return res.redirect(`/c/${session.company}/enroll`);
        return res.status(403).json({ error: "set up your authenticator app first", enroll_required: true, enroll_url: `/c/${session.company}/enroll` });
      }
      accept();
    }).catch(next);
  }
  // a company's password changed since this cookie was signed: sign in again
  generationOf(session.company).then((gen) => (gen && gen === session.gen ? accept() : toLogin(req, res, 401, "login required"))).catch(next);
}
// Who this browser is signed in as, without sending it anywhere: the same checks the middleware makes, answered as data
// (null for nobody). anetix.ai asks it (GET /login/session, server.js) so its front door can say "you are still signed
// in" instead of showing a sign-in box to someone whose session here is alive (2026-10-01: a demo manager left the
// refill page for anetix.ai's front page, met its sign-in and took it for being signed out).
async function currentSession(req) {
  if (OPEN) return { role: "admin", company: null };
  const s = verify(parseCookies(req)[COOKIE]);
  if (!s) return null;
  if (s.role === "admin") {
    if (!s.account) return (await accounts.legacyOpen()) ? { role: "admin", company: null } : null;   // the shared admin password, while it still opens admin
    const st = await accounts.sessionState(s.account);
    return st && st.role === "admin" && st.status === "active" && st.generation === s.gen ? { role: "admin", company: null } : null;
  }
  if (s.role === "manager" && s.account) {
    const st = await accounts.sessionState(s.account);
    if (!st || st.role !== "manager" || st.company !== s.company || st.status !== "active" || st.generation !== s.gen) return null;
    return { role: "manager", company: s.company, enroll: !st.enrolled && !accounts.twoFaOff() };
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
}, 60 * 1000).unref();

async function loginHandler(req, res) {
  const ip = clientIp(req);
  const wait = loginBlocked(ip);
  if (wait) {
    res.set("Retry-After", String(wait));
    return res.status(429).json({ error: `too many failed logins; try again in ${Math.ceil(wait / 60)} min` });
  }
  try {
    const { password, company, name, code, remember } = req.body || {};
    const now = Date.now();
    // A name means a named account: password, then a code from the authenticator. Nothing is kept between the two
    // requests: the page sends name, password and code together the second time. A browser this account trusted
    // (src/devices.js) carries a cookie on this one route and skips the code.
    if (String(name || "").trim()) {
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
        return res.status(r.status || 401).json({ error: r.error, need_code: Boolean(r.need_code), ...(r.passkey_first ? { passkey_first: true } : {}) });
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
      return res.status(403).json({ error: require("./safeguards").OFF_NETWORK, off_network: true });
    };
    if (!(ADMIN ? same(password, ADMIN) : same(password, MANAGER))) {
      const named = await resolveCompany(company);
      if (named && await require("./safeguards").offNetwork(req, named)) return offNetworkAnswer(named);
    }
    let session = await sessionFor(password, company);
    if (session && session.refused_shared) { await accounts.event("legacy_admin_refused", { ip }); session = null; }
    if (session && session.role !== "admin" && await require("./safeguards").offNetwork(req, session.company)) return offNetworkAnswer(session.company);
    if (!session) {
      noteLoginFail(ip);
      // say when the missing piece is the company, so the page can ask for it
      const needCompany = !String(company || "").trim() && !(await resolveCompany(""));
      return res.status(401).json({ error: needCompany ? "which company is this login for?" : "wrong password", need_company: needCompany });
    }
    loginFails.delete(ip);
    if (session.shared) await accounts.event("legacy_admin_password", { ip, detail: { at: "sign_in" } });
    const value = session.role === "admin" ? signAdmin(0, 0, null, now) : sign(session.role, session.company, session.gen, null, now);
    res.set("Set-Cookie", cookieHeader(req, value, maxAgeFor(session.role, now, now)));
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
function startAccountSession(req, res, account, { enroll = false, extraCookies = [], now = Date.now() } = {}) {
  const manager = account.role === "manager";
  const set = [manager
    ? cookieHeader(req, signManager(account.id, account.company, account.generation, null, now), maxAgeFor("manager", now, now))
    : cookieHeader(req, signAdmin(account.id, account.generation, null, now), maxAgeFor("admin", now, now)), ...extraCookies];
  res.set("Set-Cookie", set);
  return { ok: true, role: manager ? "manager" : "admin", company: manager ? account.company : null, enroll: Boolean(enroll), enroll_url: manager && enroll ? `/c/${account.company}/enroll` : undefined };
}

// Signing out of a named account (an admin, a demo's manager) lands on the account sign-in, not on the company
// password box, which a demo does not have (Brendan, 2026-09-25: "it takes you to a pin only enter, then it errors").
function logoutHandler(req, res) {
  let account = false;
  try { const v = verify(parseCookies(req)[COOKIE]); account = Boolean(v && v.account); } catch (e) {}
  res.set("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; Max-Age=0`);
  res.redirect(account ? "/login?staff=1" : "/login");
}
// How a company's people sign in, for the login page: "account" for a company whose only way in is a named account
// (a personal demo, accountsOnly), so the page opens the account form at once; "password" otherwise, including for a
// code that is not a company (the page then behaves as it always has).
async function loginMode(slug) {
  slug = String(slug || "").toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(slug)) return "password";
  const row = await accessRow(slug);
  return row && !row.floor_hash && !row.manager_hash && !row.legacy_login ? "account" : "password";
}

module.exports = { startAccountSession, loginBlocked, noteLoginFail,
  middleware, currentSession, companyGuard, ownsCompany, requireManager, requireAdmin, loginHandler, logoutHandler, checkAdminCode,
  setPasswords, accountsOnly, dropManagerPassword, loginMode, generatePassword, serviceCookie, ensureAccessRows, accessRow, accessPublic, hashPassword, checkHash, sign, signAdmin, signManager, verify, OPEN, ALL, hmac, parseCookies, managerEnrollPath,
  clientIp, ENROLL_PATHS, WINDOWS, ticketHandler, alive, refreshDue, maxAgeFor, cookieHeader, reissue, hoursVar, RETIRED_ENV, COOKIE,
};
