// End to end for adding a manager to a company that already exists (src/managers.js, 2026-10-06), and for a company
// added by hand going onto the Sites tab: an Anetix admin makes a company it will run for the customer, puts it on the
// Sites tab, invites the owner as a manager; the link opens with no sign-in, the person picks a password and lands in
// the enrollment-only session, sets up an authenticator and is a manager; the link works once; who may invite (an
// admin always, a named manager once the company is a paying site, never the shared password, never the floor, never
// another company's manager); taking an invitation back; switching a manager off.
// Against a server ALREADY UP in fake-agent mode on a fresh database, SOS_WWW_KEY set in both shells (run-all.sh).
const { runner, client, login, PW, sleep } = require("./lib");
const { q } = require("../../src/db");
const totp = require("../../src/totp");
const R = runner(), t = R.t;
const BASE = process.env.SOS_E2E_BASE || "http://127.0.0.1:3999";
const KEY = process.env.SOS_WWW_KEY;
const www = async (p, body) => { const r = await fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json", "X-SOS-WWW-Key": KEY }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => ({})) }; };
async function codeFor(secretText) {
  const into = (Date.now() / 1000) % 30;
  if (into > 27.5) await sleep((30 - into) * 1000 + 300);
  return totp.hotp(totp.base32Decode(secretText), totp.stepAt());
}
const tokenOf = (link) => new URL(link, BASE).searchParams.get("t");

(async () => {
  const admin = await login(PW.admin);
  // ---- a company added by hand, run by Anetix
  const made = await admin.post("/api/admin/companies", { slug: "clockworks", name: "Clockworks" });
  t("the admin adds a company by hand, with its own passwords", made.status === 200 && made.json.passwords.manager && made.json.passwords.floor);
  t("it is not on the Sites tab yet", !(await admin.get("/api/admin/sites")).json.rows.some((r) => r.slug === "clockworks"));
  const tr = await admin.post("/api/admin/sites/clockworks/track", {});
  const row = (await admin.get("/api/admin/sites")).json.rows.find((r) => r.slug === "clockworks");
  t("Set up billing puts it on the Sites tab as a site not ordered yet", tr.status === 200 && row && row.stage === "demo" && row.stage_label === "Not ordered yet" && /^[0-9a-f-]{36}$/.test(row.site_id), row && row.stage_label);
  t("twice makes one row", (await admin.post("/api/admin/sites/clockworks/track", {})).status === 200 && (await q("SELECT count(*)::int AS n FROM platform.sites WHERE company='clockworks'")).rows[0].n === 1);
  t("a company that does not exist is refused, and a manager cannot do it", (await admin.post("/api/admin/sites/nope-co/track", {})).status === 404 && (await (await login(made.json.passwords.manager, "clockworks")).post("/api/admin/sites/clockworks/track", {})).status >= 401);
  const offer = await admin.post("/api/admin/sites/clockworks/offer", { monthly_usd: 1000, months: 2, lines: [] });
  const shared = await login(made.json.passwords.manager, "clockworks");
  const gl = (await shared.get("/api/c/clockworks/board")).json.golive;
  t("a pilot offered to it shows as Review your pilot to its manager sign-in, with a customer's link (not a preview)", offer.status === 200 && gl && gl.pilot === true && gl.action === "Review your pilot" && gl.preview === false && /go-live\?t=[0-9a-f-]{36}\.\d+\.m\./.test(gl.url), gl);

  // ---- who may invite
  const m0 = (await admin.get("/api/c/clockworks/managers")).json;
  t("the admin sees nobody with a sign-in of their own yet, and may add one", m0.managers.length === 0 && m0.can_add === true);
  const sharedList = (await shared.get("/api/c/clockworks/managers")).json;
  t("the shared manager password may look but not add, and is told why", sharedList.can_add === false && /own account/.test(sharedList.why_not) && (await shared.post("/api/c/clockworks/managers/invite", { name: "Mal Lory", email: "mal@evil.test" })).status === 403);
  const floor = await login(made.json.passwords.floor, "clockworks");
  t("the floor gets nothing", (await floor.get("/api/c/clockworks/managers")).status === 403 && (await floor.post("/api/c/clockworks/managers/invite", { name: "Flo Or", email: "flo@x.test" })).status === 403);
  t("a name and a real email are needed", (await admin.post("/api/c/clockworks/managers/invite", { name: "", email: "art@clockworks.test" })).status === 400 && (await admin.post("/api/c/clockworks/managers/invite", { name: "Art Stone", email: "not-an-email" })).status === 400);

  // ---- the invitation
  const inv = await admin.post("/api/c/clockworks/managers/invite", { name: "Art Stone", email: "Art@Clockworks.test" });
  t("the admin invites the owner: a one-time link, 7 days, shown once", inv.status === 200 && /^\/join\?t=\d+\.[A-Za-z0-9_-]{43}$/.test(inv.json.link) && inv.json.days === 7 && inv.json.email === "art@clockworks.test", inv.json);
  const acct = (await q("SELECT * FROM platform.accounts WHERE login='art@clockworks.test'")).rows[0];
  const irow = (await q("SELECT * FROM platform.manager_invites WHERE account_id=$1", [acct.id])).rows[0];
  t("a manager account of that company, and only the token's hash kept", acct.role === "manager" && acct.company === "clockworks" && /^[0-9a-f]{64}$/.test(irow.token_hash) && !inv.json.link.includes(irow.token_hash) && irow.used_at === null);
  const m1 = (await admin.get("/api/c/clockworks/managers")).json.managers[0];
  t("the list shows them as invited, with when the link runs out", m1.name === "Art Stone" && m1.pending && m1.pending.expired === false && m1.enrolled === false, m1);
  t("nobody can sign in to it with a password nobody was shown", (await client().post("/login", { name: "art@clockworks.test", password: "anything-at-all-123" })).status !== 200);
  const T1 = tokenOf(inv.json.link);
  const fresh = client();
  t("the page opens with no sign-in and sends no referrer on", await (async () => { const r = await fetch(`${BASE}/join?t=${T1}`, { redirect: "manual" }); return r.status === 200 && r.headers.get("referrer-policy") === "no-referrer" && /Join your company/.test(await r.text()); })());
  const look = await fresh.post("/join/look", { t: T1 });
  t("the link says whose it is and for which company, nothing more", look.status === 200 && look.json.company === "Clockworks" && look.json.name === "Art Stone" && look.json.email === "art@clockworks.test" && Object.keys(look.json).sort().join(",") === "company,email,name,ok,rule", look.json);
  t("a made-up or altered link learns nothing", (await client().post("/join/look", { t: T1.slice(0, -4) + "AAAA" })).status === 410 && (await client().post("/join/look", { t: "999999." + "A".repeat(43) })).status === 410 && (await client().post("/join/look", { t: "nonsense" })).status === 410);
  t("a short password is refused and the link is still good", (await fresh.post("/join", { t: T1, password: "short" })).status === 400 && (await fresh.post("/join/look", { t: T1 })).status === 200);
  // asked again before it was used: a new link, the old one dead
  const inv2 = await admin.post("/api/c/clockworks/managers/invite", { name: "Art Stone", email: "art@clockworks.test" });
  const T2 = tokenOf(inv2.json.link);
  t("a new link for the same person ends the old one, and makes no second account", inv2.status === 200 && T2 !== T1 && (await client().post("/join/look", { t: T1 })).status === 410 && (await q("SELECT count(*)::int AS n FROM platform.accounts WHERE company='clockworks'")).rows[0].n === 1);
  const joined = await fresh.post("/join", { t: T2, password: "brass-gear-4471-chime" });
  t("they pick a password and are sent to set up the second step", joined.status === 200 && joined.json.next === "/c/clockworks/enroll", joined.json);
  t("the session is the enrollment-only one: the board waits for the second step", (await fresh.get("/api/c/clockworks/board")).status === 403 && (await fresh.get("/api/c/clockworks/me")).status === 200);
  t("the link is used: a second person with it gets nothing", (await client().post("/join", { t: T2, password: "another-long-password-1" })).status === 410 && (await client().post("/join/look", { t: T2 })).status === 410);
  const es = await fresh.post("/api/c/clockworks/me/enroll/start", {});
  const ev = await fresh.post("/api/c/clockworks/me/enroll/verify", { code: await codeFor(es.json.secret.replace(/\s/g, "")) });
  const b = await fresh.get("/api/c/clockworks/board");
  t("with an authenticator set up they are a manager of the company", ev.status === 200 && b.status === 200 && b.json.role === "manager" && b.json.company.slug === "clockworks", { ev: ev.status, b: b.status });
  t("and see the pilot waiting for them, as the owner", b.json.golive && b.json.golive.action === "Review your pilot");
  t("the password they picked signs in (with the code asked for next)", await (async () => { const r = await client().post("/login", { name: "art@clockworks.test", password: "brass-gear-4471-chime" }); return r.status === 401 && r.json && (r.json.code_required || /code/i.test(r.json.error || "")) || r.status === 200; })());
  const m2 = (await admin.get("/api/c/clockworks/managers")).json.managers[0];
  t("the list shows them as a manager, no longer invited", m2.enrolled === true && m2.pending === null);
  t("inviting them again says they are a manager already", (await admin.post("/api/c/clockworks/managers/invite", { name: "Art Stone", email: "art@clockworks.test" })).status === 409);
  t("it is on the company's record and the sign-in log", (await q("SELECT 1 FROM platform.record WHERE company='clockworks' AND kind='manager_invited'")).rows.length === 2 && (await q("SELECT event FROM platform.auth_events WHERE login='art@clockworks.test' ORDER BY id")).rows.map((r) => r.event).filter((e) => /manager_/.test(e)).join(",") === "manager_invited,manager_invited,manager_joined");

  // ---- a manager adding managers: once the company is a paying site
  const notYet = await fresh.post("/api/c/clockworks/managers/invite", { name: "Shan Flint", email: "shan@clockworks.test" });
  t("before going live a manager cannot add another, and is told Anetix can", notYet.status === 403 && /come with going live/.test(notYet.json.error) && (await fresh.get("/api/c/clockworks/managers")).json.can_add === false, notYet.json);
  await q("UPDATE platform.sites SET stage='subscribed', standing='good' WHERE company='clockworks'"); require("../../src/kind").forget("clockworks");
  await sleep(15500);   // the server remembers what a company is for 15 seconds
  const byMgr = await fresh.post("/api/c/clockworks/managers/invite", { name: "Shan Flint", email: "shan@clockworks.test" });
  t("once it is a paying site a manager adds one", byMgr.status === 200 && Boolean(byMgr.json.link) && (await fresh.get("/api/c/clockworks/managers")).json.can_add === true, byMgr.json);
  const shan = (await q("SELECT id FROM platform.accounts WHERE login='shan@clockworks.test'")).rows[0];
  // another company's manager
  const other = await admin.post("/api/admin/companies", { slug: "otherco", name: "Other Co" });
  const oInv = await admin.post("/api/c/otherco/managers/invite", { name: "Olive Other", email: "olive@other.test" });
  const olive = client(); await olive.post("/join", { t: tokenOf(oInv.json.link), password: "olive-branch-9912-stone" });
  const oes = await olive.post("/api/c/otherco/me/enroll/start", {}); await olive.post("/api/c/otherco/me/enroll/verify", { code: await codeFor(oes.json.secret.replace(/\s/g, "")) });
  t("another company's manager reaches nothing here: not the list, an invitation, a take-back or a switch-off", (await olive.get("/api/c/clockworks/managers")).status === 403 && (await olive.post("/api/c/clockworks/managers/invite", { name: "X Y", email: "x@y.test" })).status === 403 && (await olive.post(`/api/c/clockworks/managers/${shan.id}/take-back`, {})).status === 403 && (await olive.post(`/api/c/clockworks/managers/${acct.id}/off`, {})).status === 403);
  t("nor can an id from another company be used through their own", [403, 404].includes((await olive.post(`/api/c/otherco/managers/${acct.id}/off`, {})).status) && (await admin.post(`/api/c/otherco/managers/${acct.id}/off`, {})).status === 404 && (await q("SELECT status FROM platform.accounts WHERE id=$1", [acct.id])).rows[0].status === "active");
  t("an email that has an account at another company is refused, with a way round", await (async () => { const r = await admin.post("/api/c/otherco/managers/invite", { name: "Art Stone", email: "art@clockworks.test" }); return r.status === 409 && /another address/.test(r.json.error); })());
  // take back
  const tb = await fresh.post(`/api/c/clockworks/managers/${shan.id}/take-back`, {});
  t("an invitation nobody used is taken back: the account goes, and its link is dead", tb.status === 200 && (await q("SELECT 1 FROM platform.accounts WHERE id=$1", [shan.id])).rows.length === 0 && (await client().post("/join/look", { t: tokenOf(byMgr.json.link) })).status === 410, tb.json);
  t("a manager who has joined cannot be taken back, only switched off", (await admin.post(`/api/c/clockworks/managers/${acct.id}/take-back`, {})).status === 409);
  // switch off
  t("a manager cannot switch themselves off", (await fresh.post(`/api/c/clockworks/managers/${acct.id}/off`, {})).status === 400);
  const inv3 = await fresh.post("/api/c/clockworks/managers/invite", { name: "Jack Son", email: "jack@clockworks.test" });
  const jack = client(); await jack.post("/join", { t: tokenOf(inv3.json.link), password: "jack-plane-3307-walnut" });
  const jes = await jack.post("/api/c/clockworks/me/enroll/start", {}); await jack.post("/api/c/clockworks/me/enroll/verify", { code: await codeFor(jes.json.secret.replace(/\s/g, "")) });
  const jid = (await q("SELECT id FROM platform.accounts WHERE login='jack@clockworks.test'")).rows[0].id;
  const off = await fresh.post(`/api/c/clockworks/managers/${jid}/off`, {});
  t("one manager switches another off: signed out at once, and listed as switched off", off.status === 200 && (await jack.get("/api/c/clockworks/board")).status === 401 && (await fresh.get("/api/c/clockworks/managers")).json.managers.find((m) => m.id === jid).status === "disabled", off.json);
  t("an expired link stops working", await (async () => { const i = await fresh.post("/api/c/clockworks/managers/invite", { name: "Late Comer", email: "late@clockworks.test" }); await q("UPDATE platform.manager_invites SET expires_at = now() - interval '1 minute' WHERE account_id=(SELECT id FROM platform.accounts WHERE login='late@clockworks.test')"); const l = (await fresh.get("/api/c/clockworks/managers")).json.managers.find((m) => m.email === "late@clockworks.test"); return (await client().post("/join/look", { t: tokenOf(i.json.link) })).status === 410 && (await client().post("/join", { t: tokenOf(i.json.link), password: "late-but-long-enough-1" })).status === 410 && l.pending.expired === true; })());
  t("a company has twelve managers at most", await (async () => { await q("INSERT INTO platform.accounts (login, display_name, role, company, password_hash) SELECT 'fill' || g || '@clockworks.test', 'Fill', 'manager', 'clockworks', 'x' FROM generate_series(1, 12) g"); const r = await admin.post("/api/c/clockworks/managers/invite", { name: "One Too Many", email: "many@clockworks.test" }); return r.status === 409 && /12 managers at most/.test(r.json.error); })());
  t("invitations are never in a backup file", await (async () => { const bk = await admin.get("/api/admin/backup"); return bk.status === 200 && !Object.keys(bk.json.platform || {}).includes("manager_invites") && Object.keys(bk.json.platform || {}).includes("sites"); })());
  R.done();
})().catch(R.abort);
