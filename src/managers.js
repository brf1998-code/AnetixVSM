// Adding a manager to a company that already exists (2026-10-06). Brendan: "We are also going to largely manage the
// improvement board and modules for him (at least at first) so I will need a company set up, where I am running it,
// then I can add him as a manager later down the road." Until now a manager account was made in one place only, with
// its company, from a pin on anetix.ai, so a second person at a company could not have a sign-in of their own.
//
// HOW. A manager of the company (a named account, once the company is a paying site) or an Anetix admin (any company,
// any time) names the person and their email on Settings. The product makes the manager account with a password
// nobody is ever shown, and a one-time link good for seven days: /join?t=<id>.<token>. Nothing is emailed; the link
// is copied and sent the way the person usually would, like a pin. The person opens it, picks their own password, and
// lands in the same enrollment-only session a new demo's manager gets, on the page that sets up a passkey or an
// authenticator. From then on they sign in like any manager.
//
// The link is the password step, once: a random 32 byte token of which only the sha256 is kept, one use (claimed in
// the same statement that checks it), seven days, and only for an account that has no second factor yet and is
// still switched on. Used, expired or taken back, it shows nothing about the company. A pending invitation can be
// taken back (the account, which nobody ever signed in to, goes with it), and a manager can be switched off by
// another manager or by Anetix, never by themselves, and never the last one by a manager.
//
// Not in the backup (like sign-in tickets): a restore ends pending invitations, and they are made again.
//
// Routes:
//   public (before the sign-in middleware; the token is the key):
//     GET  /join                      the page
//     POST /join/look   { t }         -> { company, name, email } for a link that still works
//     POST /join        { t, password } -> the session, and where to set up the second step
//   manager or admin:
//     GET  /api/c/:slug/managers                     the accounts, pending invitations, and whether this session may add
//     POST /api/c/:slug/managers/invite  { name, email }   -> { link } (shown once)
//     POST /api/c/:slug/managers/:id/take-back       a pending invitation
//     POST /api/c/:slug/managers/:id/off             switch a manager off (signs them out)
const crypto = require("crypto");
const express = require("express");
const { q, logEvent } = require("./db");

const DAYS = 7, MAX = 12;
const SCHEMA = `
CREATE TABLE IF NOT EXISTS platform.manager_invites (
  id          SERIAL PRIMARY KEY,
  account_id  INTEGER NOT NULL REFERENCES platform.accounts(id) ON DELETE CASCADE,
  company     TEXT NOT NULL,
  token_hash  TEXT NOT NULL,
  invited_by  TEXT,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS manager_invites_account ON platform.manager_invites (account_id);
`;
async function init() { await q(SCHEMA); }

const SLUG = /^[a-z0-9][a-z0-9-]{1,40}$/;
const fail = (status, msg, extra) => Object.assign(new Error(msg), { status }, extra || {});
const clean = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const accounts = () => require("./accounts");
const authLib = () => require("./auth");
const hashToken = (token) => crypto.createHash("sha256").update(String(token || "")).digest("hex");
function parse(value) { const m = /^(\d{1,9})\.([A-Za-z0-9_-]{40,60})$/.exec(String(value || "")); return m ? { id: Number(m[1]), token: m[2] } : null; }
function sameHash(a, b) { const x = Buffer.from(String(a || ""), "hex"), y = Buffer.from(String(b || ""), "hex"); return x.length === 32 && y.length === 32 && crypto.timingSafeEqual(x, y); }
// Is this invitation good now? -> "ok" or why not. Pure.
function judge(row, token, account, { enrolled = false, now = Date.now() } = {}) {
  if (!row) return "no_row";
  if (!sameHash(row.token_hash, hashToken(token))) return "bad_token";
  if (row.used_at) return "used";
  if (new Date(row.expires_at).getTime() <= now) return "expired";
  if (!account || account.id !== row.account_id) return "wrong_account";
  if (account.status !== "active" || account.role !== "manager" || account.company !== row.company) return "account_off";
  if (enrolled) return "enrolled";
  return "ok";
}
async function enrolledNow(accountId) {
  const f = (await q("SELECT 1 FROM platform.account_factors WHERE account_id=$1 AND verified_at IS NOT NULL", [accountId])).rows[0];
  const pk = (await q("SELECT 1 FROM platform.account_passkeys WHERE account_id=$1 AND removed_at IS NULL", [accountId])).rows[0];
  return Boolean(f || pk);
}
const who = (req) => (req.sosAccount ? req.sosAccount.name || req.sosAccount.login : req.sosRole === "admin" ? "Anetix" : "manager");

// May this session add or switch off managers here, and if not, why? An Anetix admin always. A manager: a named
// account (the shared manager password is nobody in particular), and once the company is a paying site (a demo is
// one person's account; more people come with going live).
async function mayManage(req, slug) {
  if (req.sosRole === "admin") return { ok: true };
  if (req.sosRole !== "manager" || !req.sosAccount) return { ok: false, why: "Adding a manager takes a manager's own account. Sign in with your email, not the shared password." };
  if (!(await require("./kind").isSite(slug))) return { ok: false, why: "More managers come with going live. Until then Anetix can add one for you: write to brendan@anetix.ai or taylor@anetix.ai." };
  return { ok: true };
}
async function list(req, slug) {
  slug = String(slug || "").toLowerCase();
  const rows = (await q(`SELECT a.id, a.login, a.display_name, a.status, a.created_at,
      EXISTS (SELECT 1 FROM platform.manager_invites i WHERE i.account_id=a.id AND i.used_at IS NOT NULL) AS joined,
      (EXISTS (SELECT 1 FROM platform.account_factors f WHERE f.account_id=a.id AND f.verified_at IS NOT NULL)
        OR EXISTS (SELECT 1 FROM platform.account_passkeys k WHERE k.account_id=a.id AND k.removed_at IS NULL)) AS enrolled,
      (SELECT max(i.expires_at) FROM platform.manager_invites i WHERE i.account_id=a.id AND i.used_at IS NULL) AS invite_until,
      (SELECT i.invited_by FROM platform.manager_invites i WHERE i.account_id=a.id ORDER BY i.id DESC LIMIT 1) AS invited_by
    FROM platform.accounts a WHERE a.role='manager' AND a.company=$1 ORDER BY a.id`, [slug])).rows;
  const may = await mayManage(req, slug);
  return {
    can_add: may.ok, why_not: may.ok ? null : may.why, me: req.sosAccount && req.sosAccount.role === "manager" ? req.sosAccount.id : null, days: DAYS,
    managers: rows.map((r) => ({ id: r.id, name: r.display_name || r.login, email: r.login, status: r.status, enrolled: Boolean(r.enrolled),
      // an account nobody has signed in to yet: its invitation, still good or run out
      pending: !r.enrolled && !r.joined && r.invite_until ? { until: r.invite_until, expired: new Date(r.invite_until).getTime() <= Date.now(), by: r.invited_by || null } : null })),
  };
}
async function mintLink(account, by) {
  const token = crypto.randomBytes(32).toString("base64url");
  await q("UPDATE platform.manager_invites SET expires_at=now() WHERE account_id=$1 AND used_at IS NULL AND expires_at > now()", [account.id]);   // one live link per person
  const row = (await q("INSERT INTO platform.manager_invites (account_id, company, token_hash, invited_by, expires_at) VALUES ($1,$2,$3,$4, now() + make_interval(days => $5)) RETURNING id",
    [account.id, account.company, hashToken(token), clean(by, 120) || null, DAYS])).rows[0];
  return `/join?t=${row.id}.${token}`;
}
async function invite(req, slug, body = {}) {
  slug = String(slug || "").toLowerCase();
  const co = SLUG.test(slug) ? (await q("SELECT slug, name FROM platform.companies WHERE slug=$1", [slug])).rows[0] : null;
  if (!co) throw fail(404, "no such company");
  const may = await mayManage(req, slug); if (!may.ok) throw fail(403, may.why);
  const A = accounts();
  const name = clean(body.name, 80), email = A.cleanLogin(body.email);
  if (name.length < 2) throw fail(400, "Give the person's name.");
  if (!A.validLogin(email)) throw fail(400, "That email address does not look like one.");
  const had = (await q("SELECT * FROM platform.accounts WHERE login=$1", [email])).rows[0];
  let account;
  if (had) {
    // the same person asked again before they ever signed in: a new link, the old one ended
    if (had.role !== "manager" || had.company !== slug) throw fail(409, "That email already has an Anetix account somewhere else. Use another address for this company (name+company@ works with most mail).");
    if (await enrolledNow(had.id)) throw fail(409, `${had.display_name || email} is already a manager here.`);
    if (had.status !== "active") throw fail(409, "That account is switched off. Ask Anetix to switch it back on.");
    account = had;
  } else {
    const n = (await q("SELECT count(*)::int AS n FROM platform.accounts WHERE role='manager' AND company=$1 AND status='active'", [slug])).rows[0].n;
    if (n >= MAX) throw fail(409, `A company has ${MAX} managers at most. Switch one off first, or write to Anetix.`);
    account = (await A.create({ login: email, display_name: name, role: "manager", company: slug, password: "" }, who(req), authLib().clientIp(req))).account;
    account.company = slug;
  }
  const link = await mintLink(account, who(req));
  await logEvent("manager_invited", slug, { account: account.id, by: who(req), again: Boolean(had) });
  await A.event("manager_invited", { account_id: account.id, login: email, ip: authLib().clientIp(req), detail: { by: who(req), company: slug } });
  await require("./record").record("manager_invited", { company: slug, actor: { role: req.sosRole, name: who(req) }, after: `${name} was invited to be a manager.`, detail: { account: account.id } }).catch(() => {});
  require("./notify").notify("A manager was invited", `${co.name}: ${who(req)} invited a new manager.`, { tags: ["bust_in_silhouette"], ref: slug });
  return { ok: true, link, days: DAYS, name, email };
}
async function ofCompany(slug, id) {
  const a = (await q("SELECT * FROM platform.accounts WHERE id=$1 AND role='manager' AND company=$2", [Number(id), String(slug || "").toLowerCase()])).rows[0];
  if (!a) throw fail(404, "no such manager here");
  return a;
}
async function takeBack(req, slug, id) {
  const may = await mayManage(req, slug); if (!may.ok) throw fail(403, may.why);
  const a = await ofCompany(slug, id);
  const inv = (await q("SELECT count(*)::int AS n, count(used_at)::int AS used FROM platform.manager_invites WHERE account_id=$1", [a.id])).rows[0];
  if (!inv.n || inv.used || (await enrolledNow(a.id))) throw fail(409, "This person has signed in already, so there is no invitation to take back. Switch the account off instead.");
  await accounts().setStatus(a.id, "disabled", who(req), authLib().clientIp(req));
  await accounts().remove(a.id, who(req), authLib().clientIp(req));   // nobody ever signed in to it; its invitations go with it
  await logEvent("manager_invite_taken_back", a.company, { account: a.id, by: who(req) });
  return { ok: true };
}
async function switchOff(req, slug, id) {
  const may = await mayManage(req, slug); if (!may.ok) throw fail(403, may.why);
  const a = await ofCompany(slug, id);
  if (req.sosAccount && req.sosAccount.id === a.id) throw fail(400, "You cannot switch off the account you are signed in with.");
  if (req.sosRole !== "admin") {
    const others = (await q("SELECT count(*)::int AS n FROM platform.accounts WHERE role='manager' AND company=$1 AND status='active' AND id <> $2", [a.company, a.id])).rows[0].n;
    if (others < 1) throw fail(409, "A company keeps one manager at least.");
  }
  await accounts().setStatus(a.id, "disabled", who(req), authLib().clientIp(req));
  await logEvent("manager_switched_off", a.company, { account: a.id, by: who(req) });
  await require("./record").record("manager_switched_off", { company: a.company, actor: { role: req.sosRole, name: who(req) }, after: `${a.display_name || a.login} is no longer a manager.`, detail: { account: a.id } }).catch(() => {});
  return { ok: true };
}

// ---- the link ---------------------------------------------------------------------------------------------------------
async function find(value) {
  const p = parse(value);
  if (!p) return { why: "malformed" };
  const row = (await q("SELECT * FROM platform.manager_invites WHERE id=$1", [p.id])).rows[0];
  const account = row ? (await q("SELECT * FROM platform.accounts WHERE id=$1", [row.account_id])).rows[0] : null;
  const why = judge(row, p.token, account, { enrolled: account ? await enrolledNow(account.id) : false });
  return { why, row, account };
}
const GONE = "This link no longer works. It is good for one use and seven days. Ask the person who sent it for a new one.";
async function look(req) {
  const ip = authLib().clientIp(req);
  if (authLib().loginBlocked(ip)) throw fail(429, "Too many tries from here. Wait a few minutes.");
  const f = await find((req.body || {}).t);
  if (f.why !== "ok") { authLib().noteLoginFail(ip); throw fail(410, f.why === "enrolled" || f.why === "used" ? "This invitation was used already. Sign in with your email." : GONE, { code: f.why === "enrolled" || f.why === "used" ? "used" : "gone" }); }
  const co = (await q("SELECT name FROM platform.companies WHERE slug=$1", [f.account.company])).rows[0] || { name: f.account.company };
  return { ok: true, company: co.name, name: f.account.display_name, email: f.account.login, rule: "At least 12 characters." };
}
async function join(req, res) {
  const ip = authLib().clientIp(req);
  if (authLib().loginBlocked(ip)) throw fail(429, "Too many tries from here. Wait a few minutes.");
  const b = req.body || {};
  const f = await find(b.t);
  if (f.why !== "ok") { authLib().noteLoginFail(ip); throw fail(410, f.why === "enrolled" || f.why === "used" ? "This invitation was used already. Sign in with your email." : GONE, { code: "gone" }); }
  const problem = accounts().passwordProblem(String(b.password || ""));
  if (problem) throw fail(400, problem.charAt(0).toUpperCase() + problem.slice(1) + (/[.!?]$/.test(problem) ? "" : "."));
  // claimed in one statement: two tabs, or a link sent on to someone else, cannot both get in
  const claimed = (await q("UPDATE platform.manager_invites SET used_at=now() WHERE id=$1 AND used_at IS NULL AND expires_at > now() RETURNING id", [f.row.id])).rows[0];
  if (!claimed) throw fail(410, GONE, { code: "gone" });
  await accounts().setPassword(f.account.id, String(b.password), "invitation", ip);
  const fresh = (await q("SELECT * FROM platform.accounts WHERE id=$1", [f.account.id])).rows[0];
  await accounts().event("manager_joined", { account_id: fresh.id, login: fresh.login, ip, detail: { company: fresh.company } });
  await logEvent("manager_joined", fresh.company, { account: fresh.id });
  accounts().forget(fresh.id);
  const out = authLib().startAccountSession(req, res, fresh, { enroll: true });
  return { ok: true, next: out.enroll_url || `/c/${fresh.company}/` };
}

// ---- routes -----------------------------------------------------------------------------------------------------------
const json = express.json({ limit: "10kb" });
const guard = (fn) => async (req, res) => {
  try { res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }).json(await fn(req, res)); }
  catch (e) { if (!e.status) console.error("[managers]", e.stack || e.message); res.status(e.status || 500).json({ error: e.status ? e.message : "Something went wrong on the platform. Try again in a minute.", code: e.code }); }
};
// public: mounted BEFORE the sign-in middleware (server.js); the token in the body is the only key, and nothing here reads a cookie
const publicRouter = express.Router();
publicRouter.post("/join/look", json, guard((req) => look(req)));
publicRouter.post("/join", json, guard((req, res) => join(req, res)));
const router = express.Router();
const requireManager = (req, res, next) => authLib().requireManager(req, res, next);
router.get("/api/c/:slug/managers", requireManager, guard((req) => list(req, req.params.slug)));
router.post("/api/c/:slug/managers/invite", requireManager, json, guard((req) => invite(req, req.params.slug, req.body || {})));
router.post("/api/c/:slug/managers/:id(\\d{1,9})/take-back", requireManager, json, guard((req) => takeBack(req, req.params.slug, req.params.id)));
router.post("/api/c/:slug/managers/:id(\\d{1,9})/off", requireManager, json, guard((req) => switchOff(req, req.params.slug, req.params.id)));

module.exports = { init, SCHEMA, DAYS, MAX, parse, judge, hashToken, mayManage, list, invite, takeBack, switchOff, look, join, router, publicRouter };
