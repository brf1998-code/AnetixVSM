// End to end: self-serve companies from anetix.ai (src/selfserve.js). Runs against a server that is ALREADY UP in
// fake-agent mode on a FRESH database, with SOS_WWW_KEY set in both shells:
//
//   export DATABASE_URL=postgres://sos:sos@127.0.0.1:5432/sos_e2e SESSION_SECRET=e2e SOS_CONNECTION_KEY=e2e-connection-key-32chars-xx \
//     SOS_FLOOR_PASSWORD=floorpw SOS_MANAGER_PASSWORD=mgrpw SOS_ADMIN_PASSWORD=adminpw SOS_WWW_KEY=e2e-www-key-0123456789abcdef SOS_WWW_URL=https://anetix.test
//   SOS_FAKE_AGENT=1 PORT=3999 node server.js &
//   node scripts/e2e/selfserve.js
//
// What it proves: the www routes are closed without the key; a pin made on /admin is good once, then used, and a
// cancelled one is refused; a payment makes a company with its own passwords, the pin's use spent and the credit on
// the ledger, and the same payment landing twice makes one company; the board carries the credit; a company with
// no credit left cannot start a proposal or a build (and the error names the top-up page) while another company is
// untouched; a top-up (idempotent) and an admin grant put it back; company delete takes the ledger with it; the
// backup carries the three tables.
const { runner, client, login, PW, waitFor, sleep } = require("./lib");
const { q } = require("../../src/db");
const totp = require("../../src/totp");
// the code the manager's app would show, delta steps from now; never computed within two seconds of a step rolling over
async function codeFor(secretText, delta = 0) {
  const into = (Date.now() / 1000) % 30;
  if (into > 27.5) await sleep((30 - into) * 1000 + 300);
  return totp.hotp(totp.base32Decode(secretText), totp.stepAt() + delta);
}
const R = runner(), t = R.t;
const BASE = process.env.SOS_BASE || `http://127.0.0.1:${process.env.PORT || 3999}`;
const KEY = process.env.SOS_WWW_KEY;
const WWW = String(process.env.SOS_WWW_URL || "https://anetix.ai").replace(/\/+$/, "");   // the same value the server was started with
const rx = (x) => x.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
if (!KEY) { console.error("SOS_WWW_KEY must be set in this shell and the server's"); process.exit(2); }

async function www(method, path, body, key = KEY) {
  const res = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(key == null ? {} : { "X-SOS-WWW-Key": key }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch (e) {}
  return { status: res.status, json, text };
}

(async () => {
  const admin = await login(PW.admin);

  // ---- the door
  t("no key: closed", (await www("POST", "/api/www/pin", { pin: "AAAA" }, null)).status === 401);
  t("wrong key: closed", (await www("POST", "/api/www/pin", { pin: "AAAA" }, "not-the-key-but-long-enough-x")).status === 401);
  const nope = await www("POST", "/api/www/pin", { pin: "ZZZZ-ZZZZ", email: "sam@acme.test" });
  t("a pin nobody made is refused with the reason", nope.status === 403 && /not one we gave out/.test(nope.json.error), nope.json);

  // ---- a pin from the admin page
  const bad = await admin.post("/api/admin/pins", { label: "" });
  t("a pin needs a label", bad.status === 400);
  t("and the email of the person it is for", (await admin.post("/api/admin/pins", { label: "Sam at Acme Wire", max_uses: 1, days: 30 })).status === 400 && (await admin.post("/api/admin/pins", { label: "Sam at Acme Wire", email: "not-an-email" })).status === 400);
  const made = await admin.post("/api/admin/pins", { label: "Sam at Acme Wire", email: " Sam@Acme.TEST ", max_uses: 1, days: 30 });
  t("the admin makes a pin: eight characters, shown with a dash, one use, expires in 30 days", made.status === 200 && /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(made.json.pin.shown) && made.json.pin.max_uses === 1 && made.json.pin.expires_at, made.json);
  const PIN = made.json.pin.shown;
  t("the pin keeps its email, cleaned", made.json.pin.email === "sam@acme.test", made.json.pin);
  const wrong = await www("POST", "/api/www/pin", { pin: PIN, email: "someone@else.test" });
  t("the pin with another email is refused", wrong.status === 403 && /do not go together/.test(wrong.json.error), wrong.json);
  t("and with no email at all", (await www("POST", "/api/www/pin", { pin: PIN })).status === 403);
  t("the pre-checkout check refuses another email too", (await www("POST", "/api/www/check", { pin: PIN, email: "someone@else.test" })).status === 403);
  t("a company is never made for another email", (await www("POST", "/api/www/companies", { pin: PIN, name: "Wrong Email Co", email: "someone@else.test", ref: "cs_wrong", paid_usd: 30, credit_usd: 30 })).status === 403);
  const ok = await www("POST", "/api/www/pin", { pin: PIN.toLowerCase(), email: "SAM@acme.test" });
  t("the www service checks it (lower case, with the dash): good, one use left", ok.status === 200 && ok.json.ok && ok.json.label === "Sam at Acme Wire" && ok.json.uses_left === 1, ok.json);
  const list0 = await admin.get("/api/admin/pins");
  t("the Pins view lists it live with no company yet", list0.json.pins.some((p) => p.shown === PIN && !p.problem && !p.companies) && list0.json.companies.length === 0 && list0.json.www_url === WWW, list0.json);

  // ---- a payment makes a company
  const short = await www("POST", "/api/www/companies", { pin: PIN, name: "A", email: "sam@acme.test", ref: "cs_test_1", paid_usd: 30, credit_usd: 30 });
  t("a company needs a name of two letters or more", short.status === 400, short.json);
  const noRef = await www("POST", "/api/www/companies", { pin: PIN, name: "Acme Wire", email: "sam@acme.test", credit_usd: 30 });
  t("a company needs the payment's ref", noRef.status === 400 && /ref/.test(noRef.json.error), noRef.json);
  const c1 = await www("POST", "/api/www/companies", { pin: PIN, name: "Acme Wire & Cable, Inc.", contact: "Sam Jones", email: "sam@acme.test", ref: "cs_test_1", paid_usd: 30, credit_usd: 30, collect: true });
  t("the company is made: slug from the name, the floor password and the manager account shown once, $30 of credit, the login link", c1.status === 200 && c1.json.created && c1.json.company.slug === "acme-wire-cable-inc" && c1.json.passwords && c1.json.passwords.floor && !c1.json.passwords.manager
    && c1.json.manager && c1.json.manager.login === "sam@acme.test" && c1.json.manager.password && c1.json.manager.password !== c1.json.passwords.floor
    && c1.json.managers.length === 1 && c1.json.managers[0].login === "sam@acme.test" && c1.json.managers[0].enrolled === false && c1.json.managers[0].name === "Sam Jones"
    && c1.json.credit.balance_usd === 30 && c1.json.credit.credit_usd === 30 && c1.json.credit.spent_usd === 0 && new RegExp(`^${rx(WWW)}/c/acme-wire-cable-inc/credit\\?t=\\d+\\.[A-Za-z0-9_-]{32}$`).test(c1.json.credit.topup_url) && c1.json.login_url === "/login?next=%2Fc%2Facme-wire-cable-inc%2F&account=sam%40acme.test", c1.json);
  const SLUG = c1.json.company.slug, FLOOR = c1.json.passwords.floor, MGRLOGIN = c1.json.manager.login, MGRPW = c1.json.manager.password;
  t("no shared manager password exists for the company", (await q("SELECT manager_hash FROM platform.company_access WHERE company=$1", [SLUG])).rows[0].manager_hash === null);
  t("the manager account is not on the Accounts tab's list (admins only)", !(await admin.get("/api/admin/accounts")).json.accounts.some((a) => a.login === MGRLOGIN));
  const again = await www("POST", "/api/www/companies", { pin: PIN, name: "Acme Wire & Cable, Inc.", email: "sam@acme.test", ref: "cs_test_1", paid_usd: 30, credit_usd: 30 });
  t("the same payment landing again returns the same company, no passwords, nothing added, the manager's login still named", again.status === 200 && !again.json.created && again.json.company.slug === SLUG && again.json.passwords === null && !again.json.manager && again.json.managers[0].login === MGRLOGIN && again.json.credit.credit_usd === 30 && /account=sam%40acme.test/.test(again.json.login_url), again.json);
  const again2 = await www("POST", "/api/www/companies", { pin: PIN, name: "x", email: "sam@acme.test", ref: "cs_test_1", credit_usd: 30, collect: true });
  t("collected once, the passwords never come back", again2.status === 200 && !again2.json.created && again2.json.passwords === null && !again2.json.manager, again2.json);
  const chk = await www("POST", "/api/www/check", { pin: PIN, email: "sam@acme.test" });
  t("the pre-checkout check: a used pin is refused there too", chk.status === 403, chk.json);
  t("one company, one ledger row", (await q("SELECT count(*)::int AS n FROM platform.companies WHERE slug LIKE 'acme-wire%'")).rows[0].n === 1 && (await q("SELECT count(*)::int AS n FROM platform.credit_ledger WHERE company=$1", [SLUG])).rows[0].n === 1);
  const used = await www("POST", "/api/www/pin", { pin: PIN, email: "sam@acme.test" });
  t("the pin is used up now", used.status === 403 && /already been used/.test(used.json.error), used.json);
  const c2 = await www("POST", "/api/www/companies", { pin: PIN, name: "Second Try", email: "x@y.test", ref: "cs_test_2", paid_usd: 30, credit_usd: 30 });
  t("and makes no second company", c2.status === 403, c2.json);
  const list1 = await admin.get("/api/admin/pins");
  t("the Pins view shows the pin used, the company it made, and the company with its balance and contact", (() => { const p = list1.json.pins.find((x) => x.shown === PIN); const c = list1.json.companies.find((x) => x.slug === SLUG); return p && /used/.test(p.problem) && p.companies === SLUG && c && c.balance_usd === 30 && c.email === "sam@acme.test" && c.contact === "Sam Jones"; })(), list1.json);

  // ---- the manager signs in with the account: password, then the authenticator set up on the first sign-in
  const wrongCo = await client().post("/login", { password: MGRPW, company: SLUG });
  t("the manager's password does not work as a company password (there is no shared manager password)", wrongCo.status === 401, wrongCo.json);
  const mgr = client();
  const first = await mgr.post("/login", { name: MGRLOGIN, password: MGRPW });
  t("the account signs in: a manager of this company, straight to enrollment", first.status === 200 && first.json.role === "manager" && first.json.company === SLUG && first.json.enroll === true && first.json.enroll_url === `/c/${SLUG}/enroll`, first.json);
  const gated = await mgr.get(`/api/c/${SLUG}/board`);
  t("until the authenticator is set up the board is refused (enroll_required)", gated.status === 403 && gated.json.enroll_required && gated.json.enroll_url === `/c/${SLUG}/enroll`, gated.json);
  const page = await mgr.get(`/c/${SLUG}/`);
  t("and the board page redirects to the enrollment page", page.status === 302 && /\/enroll$/.test(page.headers.get("location") || ""), page.headers.get("location"));
  t("the enrollment page itself is served", (await mgr.get(`/c/${SLUG}/enroll`)).status === 200);
  const me = await mgr.get(`/api/c/${SLUG}/me`);
  t("who-am-I says a manager account of this company, enrollment required", me.status === 200 && me.json.me && me.json.me.role === "manager" && me.json.me.company === SLUG && me.json.enroll_required === true, me.json);
  t("another company's enrollment routes are closed to it", (await mgr.get("/api/c/demo/me")).status === 403);
  const es = await mgr.post(`/api/c/${SLUG}/me/enroll/start`, {});
  t("enrollment starts: a secret and a QR", es.status === 200 && es.json.secret && /<svg/.test(es.json.qr_svg), es.json && es.json.secret);
  const badCode = await mgr.post(`/api/c/${SLUG}/me/enroll/verify`, { code: "000000" });
  t("a wrong code is refused", badCode.status === 401, badCode.json);
  const ev = await mgr.post(`/api/c/${SLUG}/me/enroll/verify`, { code: await codeFor(es.json.secret.replace(/\s/g, "")) });
  t("the right code enrolls and hands over ten recovery codes", ev.status === 200 && ev.json.recovery_codes && ev.json.recovery_codes.length === 10, ev.json);
  const board = await mgr.get(`/api/c/${SLUG}/board`);
  t("enrolled, the manager reaches the board, which carries the credit line", board.status === 200 && board.json.role === "manager" && board.json.credit && board.json.credit.balance_usd === 30 && board.json.credit.line === "300% left." && board.json.credit.percent === 300 && board.json.credit.level === "ok", board.json.credit);
  // a second sign-in now needs the code
  const m2 = client();
  const need = await m2.post("/login", { name: MGRLOGIN, password: MGRPW });
  t("the next sign-in asks for the code", need.status === 200 && need.json.need_code === true, need.json);
  const stillOut = await m2.get(`/api/c/${SLUG}/board`);
  t("and hands out no session until it is given", stillOut.status === 401);
  const bad2 = await m2.post("/login", { name: MGRLOGIN, password: MGRPW, code: "123456" });
  t("a wrong code is refused at sign-in", bad2.status === 401 && bad2.json.need_code, bad2.json);
  const good = await m2.post("/login", { name: MGRLOGIN, password: MGRPW, code: await codeFor(es.json.secret.replace(/\s/g, ""), 1) });
  t("password and code: signed in as the manager of the company", good.status === 200 && good.json.role === "manager" && good.json.company === SLUG && !good.json.enroll, good.json);
  t("the second session reaches the board too", (await m2.get(`/api/c/${SLUG}/board`)).status === 200);
  t("and not another company's", (await m2.get("/api/c/demo/board")).status === 403);
  const floor = await login(FLOOR, SLUG);
  t("the floor password works as before", (await floor.get(`/api/c/${SLUG}/board`)).status === 200);
  t("the floor cannot reach the manager's enrollment routes", (await floor.post(`/api/c/${SLUG}/me/enroll/start`, {})).status === 403);
  t("the demo company carries no credit line", (await (await login(PW.manager, "demo")).get("/api/c/demo/board")).json.credit === null);
  const ov = await admin.get("/api/admin/overview");
  t("the admin overview carries the credit and the manager account (enrolled) on the company", (() => { const c = ov.json.companies.find((x) => x.slug === SLUG); return c && c.credit && c.credit.balance_usd === 30 && c.managers.length === 1 && c.managers[0].login === MGRLOGIN && c.managers[0].enrolled === true; })());
  // the admin resets the manager's authenticator (support): the manager is signed out and enrolls again next time
  const rf = await admin.post(`/api/admin/accounts/${ov.json.companies.find((x) => x.slug === SLUG).managers[0].id}/reset-factor`, { password: PW.admin });
  t("the admin can reset a manager's authenticator from the accounts routes", rf.status === 200, rf.json);
  await sleep(200);
  t("which signs the manager out everywhere", (await mgr.get(`/api/c/${SLUG}/board`)).status === 401 && (await m2.get(`/api/c/${SLUG}/board`)).status === 401);
  const m3 = client();
  const back = await m3.post("/login", { name: MGRLOGIN, password: MGRPW });
  t("and the next sign-in goes to enrollment again", back.status === 200 && back.json.enroll === true, back.json);
  const es2 = await m3.post(`/api/c/${SLUG}/me/enroll/start`, {});
  const ev2 = await m3.post(`/api/c/${SLUG}/me/enroll/verify`, { code: await codeFor(es2.json.secret.replace(/\s/g, "")) });
  t("enrolled again", ev2.status === 200 && ev2.json.recovery_codes.length === 10, ev2.json);
  Object.assign(mgr, m3);   // the rest of the suite acts as the manager through this fresh session

  // ---- spend runs the credit down; at zero nothing runs, and it says where to add credit
  const lib = ov.json.library.find((l) => l.name === "paperline");
  t("the library has paperline to add", Boolean(lib));
  const add = await admin.post(`/api/admin/companies/${SLUG}/modules`, { module: "paperline" });
  t("paperline added to the new company", add.status === 200, add.json);
  await q("INSERT INTO platform.ai_usage (company, module, kind, model, cost_usd, detail) VALUES ($1,'paperline','test','x',28,'{}')", [SLUG]);
  const low = await mgr.get(`/api/c/${SLUG}/board`);
  t("$28 spent: $2 left, 20% of the $10 unit, amber", low.json.credit.balance_usd === 2 && low.json.credit.percent === 20 && low.json.credit.level === "amber", low.json.credit);
  await q("INSERT INTO platform.ai_usage (company, module, kind, model, cost_usd, detail) VALUES ($1,'paperline','test','x',2,'{}')", [SLUG]);
  const out = await mgr.get(`/api/c/${SLUG}/board`);
  t("$30 spent: out, red, the line says nothing runs", out.json.credit.balance_usd === 0 && out.json.credit.level === "red" && /used up/.test(out.json.credit.line) && out.json.credit.percent === 0 && !/\$/.test(out.json.credit.line), out.json.credit);
  const fb = await floor.post("/api/feedback", { company: SLUG, module: "paperline", page: "/", message: "the timer should count down", name: "Sam" });
  t("feedback still lands", fb.status === 200 || fb.status === 201, fb.json);
  await sleep(1500);   // the proposer on arrival tries and is refused by the credit gate
  const row = (await q("SELECT arrival, status FROM platform.feedback WHERE id=$1", [fb.json.id])).rows[0];
  t("the proposal on arrival was refused (no draft, the request stays as it was)", row && row.status === "new" && row.arrival !== "proposing" && !(await q("SELECT 1 FROM platform.proposals WHERE feedback_id=$1", [fb.json.id])).rows[0], row);
  const rv = await mgr.post(`/api/feedback/${fb.json.id}/review`, {});
  t("Review with AI is refused with the top-up page named", rv.status >= 400 && /credit is used up/.test(rv.json.error) && new RegExp(rx(`${WWW}/c/acme-wire-cable-inc/credit`)).test(rv.json.error), rv.json);
  const demoMgr = await login(PW.manager, "demo");
  const dfb = await demoMgr.post("/api/feedback", { company: "demo", module: "paperline", page: "/", message: "demo is fine", name: "D" });
  const drv = await demoMgr.post(`/api/feedback/${dfb.json.id}/review`, {});
  t("the demo company (no credit gate) still proposes", drv.status === 200 || drv.status === 409, drv.json);

  // ---- a build that already started finishes (Brendan, 2026-09-26): its later steps pass the gate, a new start does not
  const ssv = require("../../src/selfserve");
  t("out of credit, a new start is refused", await ssv.assertCredit(SLUG).then(() => false, (e) => /credit is used up/.test(e.message)));
  t("out of credit, a step of work already started goes through", await ssv.assertCredit(SLUG, { started: true }).then(() => true, () => false));
  t("and so does the whole gate for it", await require("../../src/agent").assertUnderCap(SLUG, { started: true }).then(() => true, (e) => e.message));
  await q("INSERT INTO platform.ai_usage (company, module, kind, model, cost_usd, detail) VALUES ($1,'paperline','test','x',1.5,'{}')", [SLUG]);
  const over = await mgr.get(`/api/c/${SLUG}/board`);
  t("the build that ran past zero: 0% shown, never a negative", over.json.credit.balance_usd === -1.5 && over.json.credit.percent === 0 && over.json.credit.level === "red", over.json.credit);

  // ---- a top-up, idempotent; an admin grant
  const top = await www("POST", "/api/www/credit", { slug: SLUG, ref: "cs_test_topup_1", paid_usd: 20, credit_usd: 10 });
  t("a top-up adds credit: $10 for $20, the $1.50 overrun written off so it reads a full 100%", top.status === 200 && top.json.added && top.json.credit.balance_usd === 10 && top.json.credit.credit_usd === 41.5 && top.json.credit.percent === 100 && top.json.credit.line === "100% left.", top.json);
  const wo = (await q("SELECT delta_usd, made_by, note FROM platform.credit_ledger WHERE company=$1 AND kind='adjust'", [SLUG])).rows;
  t("the write-off is its own ledger row, by the platform", wo.length === 1 && Number(wo[0].delta_usd) === 1.5 && wo[0].made_by === "platform" && /overrun/.test(wo[0].note), wo);
  const top2 = await www("POST", "/api/www/credit", { slug: SLUG, ref: "cs_test_topup_1", paid_usd: 20, credit_usd: 10 });
  t("the same top-up again adds nothing", top2.status === 200 && !top2.json.added && top2.json.credit.credit_usd === 41.5, top2.json);
  t("a top-up for a company that does not exist is refused", (await www("POST", "/api/www/credit", { slug: "nobody", ref: "cs_x", paid_usd: 2, credit_usd: 1 })).status === 404);
  const rv2 = await mgr.post(`/api/feedback/${fb.json.id}/review`, {});
  t("with credit back, Review with AI runs", rv2.status === 200 || rv2.status === 409, rv2.json);
  const grant = await admin.post(`/api/admin/companies/${SLUG}/credit`, { usd: 5, note: "pilot allowance" });
  t("an admin grant adds credit with a note", grant.status === 200 && grant.json.credit.credit_usd === 46.5, grant.json);
  const take = await admin.post(`/api/admin/companies/${SLUG}/credit`, { usd: -3 });
  t("a negative grant takes it back", take.status === 200 && take.json.credit.credit_usd === 43.5, take.json);
  const led = await admin.get(`/api/admin/companies/${SLUG}/credit`);
  t("the ledger lists purchase, top-up, grant and adjust with who", led.json.ledger.length === 5 && led.json.ledger.map((l) => l.kind).sort().join() === "adjust,adjust,grant,purchase,purchase" && led.json.ledger.find((l) => l.kind === "grant").note === "pilot allowance" && led.json.ledger.find((l) => l.kind === "grant").made_by, led.json.ledger);
  const gDemo = await admin.post("/api/admin/companies/demo/credit", { usd: 12 });
  t("a grant to a company made here makes it self-serve from now", gDemo.status === 200 && gDemo.json.credit.credit_usd === 12 && gDemo.json.credit.balance_usd === 12, gDemo.json);
  const info = await www("GET", `/api/www/companies/${SLUG}`);
  t("the www service reads a company's name and balance for the top-up page", info.status === 200 && info.json.company.name === "Acme Wire & Cable, Inc." && info.json.credit.balance_usd === 12, info.json);
  t("and 404 for one that does not exist", (await www("GET", "/api/www/companies/nobody")).status === 404);

  // ---- a cancelled pin
  const p2 = await admin.post("/api/admin/pins", { label: "Two uses", email: "two@uses.test", max_uses: 2, days: 0 });
  t("a pin with two uses and no expiry", p2.json.pin.max_uses === 2 && p2.json.pin.expires_at === null, p2.json);
  const rv3 = await admin.post(`/api/admin/pins/${p2.json.pin.id}/revoke`, {});
  t("cancelled", rv3.status === 200 && rv3.json.pin.revoked_at);
  const gone = await www("POST", "/api/www/pin", { pin: p2.json.pin.shown, email: "two@uses.test" });
  t("a cancelled pin is refused as cancelled", gone.status === 403 && /cancelled/.test(gone.json.error), gone.json);
  t("cancelling it again is a 404", (await admin.post(`/api/admin/pins/${p2.json.pin.id}/revoke`, {})).status === 404);

  // ---- the backup carries the tables; delete takes the ledger with the company
  const bk = await admin.get("/api/admin/backup");
  t("the backup carries access_pins, self_serve and credit_ledger", bk.status === 200 && bk.json.platform && ["access_pins", "self_serve", "credit_ledger"].every((k) => Array.isArray((bk.json.platform[k] || {}).rows || bk.json.platform[k])), Object.keys(bk.json.platform || {}).filter((k) => /pin|serve|ledger/.test(k)));
  const del = await admin.post(`/api/admin/companies/${SLUG}/delete`, { confirm_slug: SLUG, password: PW.admin });
  t("company delete goes through", del.status === 200, del.json);
  t("its ledger, self_serve row and manager account are gone, the pin keeps its count", (await q("SELECT count(*)::int AS n FROM platform.credit_ledger WHERE company=$1", [SLUG])).rows[0].n === 0 && (await q("SELECT count(*)::int AS n FROM platform.self_serve WHERE company=$1", [SLUG])).rows[0].n === 0 && (await q("SELECT count(*)::int AS n FROM platform.accounts WHERE company=$1", [SLUG])).rows[0].n === 0 && (await q("SELECT uses FROM platform.access_pins WHERE id=$1", [made.json.pin.id])).rows[0].uses === 1);
  // a second company on the same email gets a login of its own
  const p3 = await admin.post("/api/admin/pins", { label: "Sam again", email: "sam@acme.test", max_uses: 1, days: 30 });
  const c3 = await www("POST", "/api/www/companies", { pin: p3.json.pin.shown, name: "Acme Second Plant", contact: "Sam Jones", email: "sam@acme.test", ref: "cs_test_3", paid_usd: 30, credit_usd: 30, collect: true });
  t("an email that already has an account (demo's grant made none, but a leftover admin might) still gets a company", c3.status === 200 && c3.json.created && c3.json.manager.login, c3.json);
  const c4pin = await admin.post("/api/admin/pins", { label: "Sam third", email: "sam@acme.test", max_uses: 1, days: 30 });
  const c4 = await www("POST", "/api/www/companies", { pin: c4pin.json.pin.shown, name: "Acme Third Plant", contact: "Sam Jones", email: "sam@acme.test", ref: "cs_test_4", paid_usd: 30, credit_usd: 30, collect: true });
  t("a second company on the same email gets the login with the company code in it", c4.status === 200 && c4.json.created && c4.json.manager.login === "sam+acme-third-plant@acme.test", c4.json);
  // the webhook lands first (no collect): the passwords wait for the person's browser
  const p5 = await admin.post("/api/admin/pins", { label: "Webhook first", email: "lee@late.test", max_uses: 1, days: 30 });
  const c5 = await www("POST", "/api/www/companies", { pin: p5.json.pin.shown, name: "Late Browser Co", contact: "Lee", email: "lee@late.test", ref: "cs_test_5", paid_usd: 30, credit_usd: 30 });
  t("made by the webhook: created, but the passwords are kept, not handed to it", c5.status === 200 && c5.json.created && c5.json.kept && c5.json.passwords === null && !c5.json.manager, c5.json);
  const c5b = await www("POST", "/api/www/companies", { pin: p5.json.pin.shown, name: "Late Browser Co", email: "lee@late.test", ref: "cs_test_5", credit_usd: 30, collect: true });
  t("then the person's browser collects them once", c5b.status === 200 && !c5b.json.created && c5b.json.collected && c5b.json.passwords.floor && c5b.json.manager.login === "lee@late.test" && c5b.json.manager.password, c5b.json);
  const c5c = await www("POST", "/api/www/companies", { pin: p5.json.pin.shown, name: "Late Browser Co", email: "lee@late.test", ref: "cs_test_5", credit_usd: 30, collect: true });
  t("and never again", c5c.json.passwords === null && !c5c.json.manager && (await q("SELECT handout_enc FROM platform.self_serve WHERE company='late-browser-co'")).rows[0].handout_enc === null, c5c.json);
  const lee = client();
  t("the collected manager password signs in", (await lee.post("/login", { name: "lee@late.test", password: c5b.json.manager.password })).status === 200);


  // ---- the demo workflow (2026-09-25 evening): no payment, $15 from us, the password the person picked, the DEMO flag
  const pd = await admin.post("/api/admin/pins", { label: "Dana at Riverside", email: "dana@riverside.test", max_uses: 1, days: 30 });
  const DPIN = pd.json.pin.shown;
  t("a password under twelve characters is refused and nothing is made", (await www("POST", "/api/www/companies", { pin: DPIN, name: "Riverside Wire", contact: "Dana", email: "dana@riverside.test", ref: "demo:x", paid_usd: 0, credit_usd: 15, password: "short", demo: true, collect: true })).status === 400 && (await q("SELECT uses FROM platform.access_pins WHERE id=$1", [pd.json.pin.id])).rows[0].uses === 0);
  const dm = await www("POST", "/api/www/companies", { pin: DPIN, name: "Riverside Wire", contact: "Dana", email: "dana@riverside.test", ref: `demo:${DPIN}:riverside-wire`, paid_usd: 0, credit_usd: 15, password: "copper-oak-2201-press", demo: true, collect: true });
  t("a demo is made with $15 and hands out no password at all (the manager picked theirs; there is no floor)", dm.status === 200 && dm.json.created && dm.json.passwords === null && dm.json.manager.login === "dana@riverside.test" && !dm.json.manager.password && dm.json.credit.credit_usd === 15, dm.json);
  const DSLUG = dm.json.company.slug;
  const acc = (await q("SELECT floor_hash, manager_hash, legacy_login FROM platform.company_access WHERE company=$1", [DSLUG])).rows[0];
  t("its only way in is the manager account: no floor or manager password, no shared fallback", acc && acc.floor_hash === null && acc.manager_hash === null && acc.legacy_login === false, acc);
  t("nothing waits in the handout", (await q("SELECT handout_enc FROM platform.self_serve WHERE company=$1", [DSLUG])).rows[0].handout_enc === null);
  t("the shared floor and manager passwords do not open it", (await client().post("/login", { password: PW.floor, company: DSLUG })).status === 401 && (await client().post("/login", { password: "mgrpw", company: DSLUG })).status === 401);
  t("its first credit is a grant from us, not a purchase", (await q("SELECT kind, paid_usd, made_by FROM platform.credit_ledger WHERE company=$1", [DSLUG])).rows.every((r) => r.kind === "grant" && r.paid_usd === null && r.made_by === "anetix.ai"));
  t("the company is marked a demo", (await q("SELECT demo FROM platform.companies WHERE slug=$1", [DSLUG])).rows[0].demo === true);
  const dana = client();
  const ds = await dana.post("/login", { name: "dana@riverside.test", password: "copper-oak-2201-press" });
  t("the manager signs in with the password they picked and goes to the authenticator setup", ds.status === 200 && ds.json.enroll === true && ds.json.enroll_url === `/c/${DSLUG}/enroll`, ds.json);
  const des = await dana.post(`/api/c/${DSLUG}/me/enroll/start`, {});
  t("the demo manager sets up the authenticator", (await dana.post(`/api/c/${DSLUG}/me/enroll/verify`, { code: await codeFor(des.json.secret.replace(/\s/g, "")) })).status === 200);
  const dboard = await dana.get(`/api/c/${DSLUG}/board`);
  t("and reaches the board as its manager, the demo flag and $15 on it", dboard.status === 200 && dboard.json.role === "manager" && dboard.json.company.demo === true && dboard.json.credit.balance_usd === 15, dboard.json && { role: dboard.json.role, demo: dboard.json.company && dboard.json.company.demo });
  // the login page opens the account form for a demo (no company password to type), the password box for anyone else
  const mode = async (c) => (await client().get(`/login/mode?c=${encodeURIComponent(c)}`)).json.mode;
  t("the login page is told a demo signs in by account", await mode(DSLUG) === "account");
  t("and a company with a floor password, the old demo, an unknown code and junk all get the password box", await mode("late-browser-co") === "password" && await mode("demo") === "password" && await mode("nobody-here") === "password" && await mode("../x") === "password");
  const lo = await dana.get("/logout");
  t("signing out of the demo's account lands on the account sign-in", lo.status === 302 && lo.headers.get("location") === "/login?staff=1", lo.headers.get("location"));
  const fl = await client().post("/login", { password: PW.floor, company: "demo" });
  const flc = client(); await flc.post("/login", { password: PW.floor, company: "demo" });
  const flo = await flc.get("/logout");
  t("signing out of a floor login lands on the plain sign-in, as before", fl.status === 200 && flo.headers.get("location") === "/login", flo.headers.get("location"));
  const db = await admin.get(`/api/c/${DSLUG}/board`);
  t("the board says demo and carries the $15", db.status === 200 && db.json.company.demo === true && db.json.credit.balance_usd === 15, db.json && db.json.company);
  t("a company made the old way is not a demo", (await admin.get(`/api/c/late-browser-co/board`)).json.company.demo === false);

  R.done();
})().catch(R.abort);
