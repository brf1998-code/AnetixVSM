// The sign-in map (2026-10-29): how every company's people, and Anetix's own, sign in. What is set up (a floor PIN or an
// old floor password, a shared manager password, named accounts and their second factors) beside what was actually used
// in the window (the sign-in log for named accounts; the interaction record for the shared ways in, which log no sign-in
// of their own until now). Why: Brendan, before taking the shared passwords out, "I also want to have mapped out how
// everyone is logging in so I do not bulldoze something I should not". Read only. Never a hash, a code, a token, a
// network or an address anyone signed in from.
//
// What "used" can say:
//   floor          record lines written by a floor session (a request filed, a "did it fix it", a person signed in on
//                  the device), split by whether a person's name was on them. A floor session comes from the floor's
//                  shared sign-in, whichever it is (PIN or old password); which one is said by what is set up, and by
//                  the shared_sign_ins events from 2026-10-29 on.
//   shared manager record lines written by a manager session with no account behind it. The record names the account
//                  only since 2026-10-15 ("The record says which account acted"), so this counts from then at the
//                  earliest; before that a manager line could be either.
//   accounts       the sign-in log (platform.auth_events), by way: password and the app's code, a remembered device, a
//                  passkey, a recovery code, Google or Microsoft, the one sign-in link from anetix.ai.
const { q } = require("./db");

const RECORD_NAMES_ACCOUNT_SINCE = new Date("2026-10-15T00:00:00Z");
// the sign-in log's events that are a sign-in, and the words for each way
const WAYS = {
  login_ok: "password and code",
  signin_trusted_device: "password on a remembered device",
  login_passkey: "passkey",
  recovery_used: "recovery code",
  break_glass: "break glass",
  signin_ticket: "sign-in link from anetix.ai",
  login_oidc: "Google or Microsoft",
};
const SIGN_IN_EVENTS = Object.keys(WAYS);

async function map({ days = 30 } = {}) {
  days = Math.min(400, Math.max(1, Math.round(Number(days) || 30)));
  const since = new Date(Date.now() - days * 86400e3);
  const sharedSince = since > RECORD_NAMES_ACCOUNT_SINCE ? since : RECORD_NAMES_ACCOUNT_SINCE;
  const kind = require("./kind");
  const companies = (await q("SELECT slug, name, demo, created_at FROM platform.companies ORDER BY created_at")).rows;
  const access = (await q(`SELECT company, floor_hash IS NOT NULL AS has_floor, COALESCE(floor_pin, false) AS floor_pin, manager_hash IS NOT NULL AS has_manager,
                                  COALESCE(legacy_login, false) AS legacy_login, COALESCE(array_length(networks, 1), 0)::int AS networks, updated_at
                             FROM platform.company_access`)).rows;
  const accounts = (await q(`SELECT a.id, a.login, a.display_name, a.role, a.company, a.status, a.created_at,
                                    EXISTS (SELECT 1 FROM platform.account_factors f WHERE f.account_id=a.id AND f.verified_at IS NOT NULL) AS app,
                                    (SELECT count(*)::int FROM platform.account_passkeys k WHERE k.account_id=a.id AND k.removed_at IS NULL) AS passkeys
                               FROM platform.accounts a ORDER BY a.role, a.company NULLS FIRST, a.id`)).rows;
  const identities = (await q("SELECT account_id, provider FROM platform.account_identities").catch(() => ({ rows: [] }))).rows;
  const events = (await q(`SELECT account_id, event, COALESCE(detail->>'provider', '') AS provider, count(*)::int AS n, max(at) AS last
                             FROM platform.auth_events WHERE account_id IS NOT NULL AND event = ANY($2::text[]) AND at >= $1
                            GROUP BY account_id, event, provider`, [since, SIGN_IN_EVENTS])).rows;
  const lastEver = (await q(`SELECT account_id, max(at) AS last FROM platform.auth_events WHERE account_id IS NOT NULL AND event = ANY($1::text[]) GROUP BY account_id`, [SIGN_IN_EVENTS])).rows;
  const sharedAdmin = (await q(`SELECT count(*)::int AS n, max(at) AS last FROM platform.auth_events WHERE event='legacy_admin_password' AND at >= $1`, [since])).rows[0];
  const sharedLog = (await q(`SELECT detail->>'company' AS company, detail->>'role' AS role, detail->>'by' AS by, count(*)::int AS n, max(at) AS last
                                FROM platform.auth_events WHERE event='shared_sign_in' AND at >= $1 GROUP BY 1, 2, 3`, [since])).rows;
  const floorUse = (await q(`SELECT company, (actor_name IS NOT NULL AND actor_name <> '' AND actor_name <> 'floor') AS named, count(*)::int AS n, max(created_at) AS last,
                                    count(DISTINCT actor_name)::int AS names
                               FROM platform.record WHERE actor_role='floor' AND created_at >= $1 GROUP BY company, named`, [since])).rows;
  const managerShared = (await q(`SELECT company, count(*)::int AS n, max(created_at) AS last FROM platform.record
                                   WHERE actor_role='manager' AND actor_account IS NULL AND created_at >= $1 GROUP BY company`, [sharedSince])).rows;
  const people = (await q("SELECT company, count(*) FILTER (WHERE active AND pin_hash IS NOT NULL)::int AS with_pin, max(last_seen_at) AS last_seen FROM platform.people GROUP BY company").catch(() => ({ rows: [] }))).rows;

  const at = (d) => (d ? new Date(d).toISOString() : null);
  const accountOut = (a) => {
    const mine = events.filter((e) => e.account_id === a.id);
    const used = {};
    for (const e of mine) {
      const way = e.event === "login_oidc" ? (e.provider === "microsoft" ? "Microsoft" : e.provider === "google" ? "Google" : WAYS.login_oidc) : WAYS[e.event];
      used[way] = (used[way] || 0) + e.n;
    }
    const factors = [];
    if (a.app) factors.push("authenticator app");
    if (a.passkeys) factors.push(`${a.passkeys} passkey${a.passkeys > 1 ? "s" : ""}`);
    for (const i of identities.filter((x) => x.account_id === a.id)) factors.push(i.provider === "google" ? "Google" : "Microsoft");
    return {
      name: a.display_name || a.login, login: a.login, status: a.status, created_at: at(a.created_at),
      ways_in: factors.length ? factors : ["password only: no second factor set up yet"],
      last_sign_in: at((lastEver.find((x) => x.account_id === a.id) || {}).last),
      sign_ins_in_window: used,
    };
  };

  const out = [];
  for (const c of companies) {
    const a = access.find((x) => x.company === c.slug) || {};
    const fl = floorUse.filter((x) => x.company === c.slug);
    const flAll = fl.reduce((s, x) => s + x.n, 0), flLast = fl.map((x) => x.last).sort().pop() || null;
    const ms = managerShared.find((x) => x.company === c.slug);
    const ppl = people.find((x) => x.company === c.slug) || {};
    const log = sharedLog.filter((x) => x.company === c.slug);
    const floorSignIn = a.legacy_login && !a.has_floor ? "the old instance-wide floor password (legacy)"
      : !a.has_floor ? "none" : a.floor_pin ? "floor PIN" : "floor password from before PINs";
    const managersOf = accounts.filter((x) => x.role === "manager" && x.company === c.slug);
    out.push({
      slug: c.slug, name: c.name, kind: (await kind.isSite(c.slug)) ? "paying site" : "trial", came_in_from_anetix_ai: Boolean(c.demo), created_at: at(c.created_at),
      floor: {
        sign_in: floorSignIn,
        plant_network_set: a.networks > 0,
        used_in_window: { record_lines: flAll, last: at(flLast), lines_with_a_persons_name: (fl.find((x) => x.named) || {}).n || 0 },
        shared_sign_ins_logged: log.filter((x) => x.role === "floor").reduce((s, x) => s + x.n, 0),
        people_with_their_own_pin: ppl.with_pin || 0, people_last_seen: at(ppl.last_seen),
      },
      managers: {
        shared_password: Boolean(a.has_manager) || Boolean(a.legacy_login && !a.has_manager),
        shared_password_kind: a.has_manager ? "this company's own shared manager password" : a.legacy_login ? "the old instance-wide manager password (legacy)" : null,
        shared_password_used: { counted_from: at(sharedSince), record_lines: ms ? ms.n : 0, last: at(ms && ms.last), shared_sign_ins_logged: log.filter((x) => x.role === "manager").reduce((s, x) => s + x.n, 0) },
        accounts: managersOf.map(accountOut),
      },
    });
  }
  return {
    window_days: days, since: at(since),
    notes: [
      "A floor session is the floor's shared sign-in (its PIN, or a floor password from before PINs). Its record lines are what the floor did while signed in that way.",
      `A shared manager password's use is counted from ${at(sharedSince).slice(0, 10)}: the record names the account behind a manager's action only since 2026-10-15.`,
      "From 2026-10-29 every sign-in with a shared password or PIN is in the sign-in log too (shared_sign_ins_logged).",
    ],
    companies: out,
    admins: { accounts: accounts.filter((x) => x.role === "admin").map(accountOut), shared_admin_password_used_in_window: sharedAdmin.n, shared_admin_password_last: at(sharedAdmin.last) },
    instance_shared_password_variables: { floor: Boolean(process.env.SOS_FLOOR_PASSWORD), manager: Boolean(process.env.SOS_MANAGER_PASSWORD), admin: Boolean(process.env.SOS_ADMIN_PASSWORD) },
  };
}

module.exports = { map, WAYS };
