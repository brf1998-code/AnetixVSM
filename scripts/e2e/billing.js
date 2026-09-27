// End to end for paid sites, stage 4 as the launch audit's C6 and C11 built it (src/billing.js, src/notify.js): Manage
// billing's link and whose Customer it opens; what Stripe's events now do (past due, unpaid pausing new AI work, a cancel
// date, a cancel on an unpaid month ending it now, a subscription the customer ended, one Stripe ended for a payment);
// back to a demo (the strip, the floor signed out, credit from 0%, Go live again, a notice); End; and the phone alerts
// for a signed order, a declined card and billing trouble. anetix.ai's private channel AND the ntfy server are played by
// one stub in this process. Against a server ALREADY UP in fake-agent mode, on a fresh database, with SOS_WWW_KEY,
// SOS_WWW_URL, WWW_INTERNAL_URL and WWW_INTERNAL_KEY set in both shells, and NTFY_URL (the stub) and NTFY_TOPIC on the
// server (run-all.sh does it).
const http = require("http");
const { runner, client, login, PW, sleep } = require("./lib");
const { q } = require("../../src/db");
const totp = require("../../src/totp");
const B = require("../../src/billing");
const R = runner(), t = R.t;
const BASE = process.env.SOS_E2E_BASE || "http://127.0.0.1:3999";
const KEY = process.env.SOS_WWW_KEY, IKEY = process.env.WWW_INTERNAL_KEY;
const STUB = new URL(process.env.WWW_INTERNAL_URL || "http://127.0.0.1:4012");
if (!KEY || !IKEY) { console.error("SOS_WWW_KEY and WWW_INTERNAL_KEY must be set in this shell and the server's"); process.exit(2); }

const stub = { calls: [], alerts: [], next: [], n: 0 };
const server = http.createServer((req, res) => {
  let raw = ""; req.on("data", (d) => { raw += d; });
  req.on("end", () => {
    const send = (status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
    const body = raw ? JSON.parse(raw) : {};
    if (req.url === "/" && req.method === "POST") { stub.alerts.push(body); return send(200, { id: "ntfy" }); }   // ntfy
    if (req.headers["x-www-internal-key"] !== IKEY) return send(401, { error: "internal key required" });
    stub.calls.push({ path: req.url, body });
    if (req.url === "/internal/ping") return send(200, { ok: true, stripe: "test", tax: false, webhook: true });
    if (req.url === "/internal/activate") {
      const scripted = stub.next.shift(); if (scripted) return send(scripted.status, scripted.body);
      const n = ++stub.n, now = Math.floor(Date.now() / 1000);
      return send(200, { ok: true, resumed: false, subscription: { id: `sub_bill_${n}`, status: "active", metadata: body.metadata, current_period_start: now, current_period_end: now + 30 * 86400 }, price_id: `price_${body.price.lookup_key}`, balance_txn: null });
    }
    if (req.url === "/internal/end") return send(200, { ok: true, subscription: { id: body.subscription, status: "canceled" }, voided: ["in_open_1"] });
    if (["/internal/detach", "/internal/reverse-balance", "/internal/cancel", "/internal/abandon"].includes(req.url)) return send(200, { ok: true });
    send(404, { error: "not found" });
  });
});
const callsTo = (p) => stub.calls.filter((c) => c.path === p);
const alertLike = (rx) => stub.alerts.find((a) => rx.test(`${a.title} ${a.message}`));
const waitAlert = async (rx) => { for (let i = 0; i < 40; i++) { const a = alertLike(rx); if (a) return a; await sleep(100); } return null; };

const www = async (p, body, key = KEY) => {
  const r = await fetch(BASE + p, { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", ...(key ? { "X-SOS-WWW-Key": key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
async function codeFor(secretText) {
  const into = (Date.now() / 1000) % 30;
  if (into > 27.5) await sleep((30 - into) * 1000 + 300);
  return totp.hotp(totp.base32Decode(secretText), totp.stepAt());
}
let demoN = 0;
async function makeDemo(admin, name) {
  const email = `b${Date.now().toString(36)}${++demoN}@billing.test`;
  const pin = (await admin.post("/api/admin/pins", { label: `${name} pin`, email, max_uses: 1, days: 30 })).json.pin.shown;
  const password = "copper-oak-2201-press";
  const made = await www("/api/www/companies", { pin, email, name, contact: "Sam Ortiz", ref: `billing:${pin}`, paid_usd: 0, credit_usd: 10, password, demo: true, collect: true });
  const slug = made.json.company.slug;
  const mgr = client();
  await mgr.post("/login", { name: email, password });
  const es = await mgr.post(`/api/c/${slug}/me/enroll/start`, {});
  await mgr.post(`/api/c/${slug}/me/enroll/verify`, { code: await codeFor(es.json.secret.replace(/\s/g, "")) });
  return { slug, mgr, email, name };
}
const tokenOf = (url) => new URL(url).searchParams.get("t");
const FACTS = {
  legal_name: "Harbor Gear Co.", site_name: "Harbor Gear, Lowell",
  site_address: { line1: "3 Canal St", city: "Lowell", state: "MA", postal_code: "01852" },
  headcount: 30, sqft: 20000,
  plant_manager: { name: "Omar Reyes", title: "Plant manager", email: "omar@harbor.test" },
  contact: { is_pm: true }, billing: { email: "ap@harbor.test", same_as_site: true }, integrations: null, hardware: null, learning: false,
};
let cardN = 0;
async function toSubscribed(admin, D) {
  const link = (await D.mgr.get(`/api/c/${D.slug}/board`)).json.golive.url;
  const access = { slug: D.slug, t: tokenOf(link) };
  const o = (await www("/api/www/golive/save", { access, fields: FACTS })).json.order;
  await www("/api/www/golive/sign", { access, version: o.version, sha: o.sha, signer: { name: "Omar Reyes", title: "Plant manager", email: "omar@harbor.test" }, authority: true, ip: "198.51.100.4", ua: "e2e" });
  const n = ++cardN, cus = `cus_bill${n}`;
  await www("/api/www/golive/checkout", { access, stripe_customer: cus, setup_session: `cs_bill${n}` });
  await www("/api/www/golive/card", { order: o.id, setup_session: `cs_bill${n}`, stripe_customer: cus, payment_method: `pm_bill${n}`, card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 } });
  const act = await admin.post(`/api/admin/sites/${D.slug}/activate`, { password: PW.admin, test_mode_ok: true });
  const s = await site(D.slug);
  return { ...D, order: o.id, act, site: s, sub: s.stripe_subscription, customer: s.stripe_customer };
}
const site = async (slug) => (await q("SELECT * FROM platform.sites WHERE company=$1", [slug])).rows[0];
let evN = 0;
const event = (S, type, sub) => www("/api/www/billing-events", { event: { id: `evt_bill_${++evN}_${Date.now().toString(36)}`, type }, subscription: { id: S.sub, metadata: { site: S.site.id, order: S.order }, current_period_start: Math.floor(Date.now() / 1000), current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400, cancel_at_period_end: false, cancel_at: null, ...sub } });

server.listen(Number(STUB.port), "127.0.0.1", async () => {
 try {
  const admin = await login(PW.admin);
  await admin.post("/api/admin/golive", { open: true });
  await admin.post("/api/admin/credit", { balance_usd: 100, autofill: true, note: "e2e" });
  const nt = (await admin.get("/api/admin/notify")).json;
  t("phone alerts are on (NTFY_TOPIC set on the server)", nt.configured === true, nt);
  const test = await admin.post("/api/admin/notify/test", {});
  t("Send a test alert reaches the ntfy server, on the topic, with a title", test.status === 200 && Boolean(await waitAlert(/Anetix test alert/)) && stub.alerts[0].topic === process.env.NTFY_TOPIC, stub.alerts[0]);

  // ---- a signed order reaches the phone (C11), then Activate ----------------------------------------------------------
  const A = await makeDemo(admin, "Harbor Gear");
  const SA = await toSubscribed(admin, A);
  const signedAlert = await waitAlert(/Signed order/);
  t("a signed order with its card: an alert with the company, the band and the price, nothing personal", signedAlert && /Harbor Gear/.test(signedAlert.message) && /\$1,000 a month/.test(signedAlert.message) && !/@/.test(signedAlert.message) && signedAlert.priority === 5, signedAlert);
  t("Activate switched it on", SA.act.status === 200 && SA.site.stage === "subscribed" && SA.sub, SA.act.json);

  // ---- Manage billing -----------------------------------------------------------------------------------------------
  const L = await A.mgr.post(`/api/c/${A.slug}/billing`, {});
  const bt = L.json.url ? tokenOf(L.json.url) : null;
  t("the manager gets a ten-minute link to anetix.ai's billing page for the site", L.status === 200 && L.json.url.startsWith(`${process.env.SOS_WWW_URL}/c/${A.slug}/billing?t=`) && B.billingTokenOk(A.slug, SA.site.id, bt), L.json);
  const P = await www("/api/www/billing/portal", { slug: A.slug, t: bt });
  t("anetix.ai asks whose Customer it is: the site's own, and the way back to Settings", P.status === 200 && P.json.customer === SA.customer && P.json.return_path === `/c/${A.slug}/settings`, P.json);
  t("a made-up link learns nothing", (await www("/api/www/billing/portal", { slug: A.slug, t: `${bt.split(".")[0]}.${"A".repeat(32)}` })).status === 404);
  t("a link for another site's id does not open this one", (await www("/api/www/billing/portal", { slug: A.slug, t: B.billingToken(A.slug, "00000000-0000-4000-8000-000000000000") })).status === 404);
  t("nothing opens without the shared key", (await www("/api/www/billing/portal", { slug: A.slug, t: bt }, "wrong-key-0123456789abcdef")).status === 401);
  t("an admin cannot open a customer's billing (the manager's alone)", (await admin.post(`/api/c/${A.slug}/billing`, {})).status === 403);
  const X = await makeDemo(admin, "Not Live Yet");
  t("a demo that has not gone live has no billing", (await X.mgr.post(`/api/c/${X.slug}/billing`, {})).status === 409);
  const set0 = (await A.mgr.get(`/api/c/${A.slug}/site`)).json;
  t("Settings: the price, the next bill, Manage billing, no line while all is well", set0.subscribed && set0.billing === true && set0.next_bill && set0.line === null && set0.standing === "good", set0);

  // ---- past due, unpaid, good again ------------------------------------------------------------------------------------
  const pd = await event(SA, "invoice.payment_failed", { status: "past_due" });
  t("a failed payment: past due, and the board and Settings say to update the card, nothing stops", pd.status === 200 && (await site(A.slug)).standing === "past_due" && /did not go through/.test(((await A.mgr.get(`/api/c/${A.slug}/board`)).json.billing || {}).text || "") && /Manage billing/.test(((await A.mgr.get(`/api/c/${A.slug}/site`)).json.line || {}).text || ""), pd.json);
  t("and the phone hears it", Boolean(await waitAlert(/payment failed/)));
  t("past due does not pause AI work", (await A.mgr.post(`/api/c/${A.slug}/intakes`, {})).status === 200);
  await event(SA, "customer.subscription.updated", { status: "unpaid" });
  const up = await A.mgr.post(`/api/c/${A.slug}/intakes`, {});
  t("unpaid: new AI work is paused with plain words, and the line is red", up.status >= 400 && /overdue, so new AI work is paused/.test(up.json.error || "") && ((await A.mgr.get(`/api/c/${A.slug}/board`)).json.billing || {}).level === "red", up.json);
  t("unpaid reaches the phone as urgent", ((await waitAlert(/is unpaid/)) || {}).priority === 5);
  await event(SA, "invoice.paid", { status: "active" });
  t("paid again: good standing, the line gone, AI works again", (await site(A.slug)).standing === "good" && (await A.mgr.get(`/api/c/${A.slug}/board`)).json.billing === null && (await A.mgr.post(`/api/c/${A.slug}/intakes`, {})).status === 200);
  t("and the phone hears that too", Boolean(await waitAlert(/A site paid/)));

  // ---- a cancel date, taken back ----------------------------------------------------------------------------------------
  const end30 = Math.floor(Date.now() / 1000) + 30 * 86400;
  await event(SA, "customer.subscription.updated", { status: "active", cancel_at_period_end: true, cancel_at: end30 });
  const sc = await site(A.slug);
  t("cancelled in the portal: the date is kept, the site still runs, the board says when it ends and how to keep it", sc.stage === "subscribed" && sc.cancel_at && Math.abs(new Date(sc.cancel_at).getTime() / 1000 - end30) < 2 && /ends on/.test(((await A.mgr.get(`/api/c/${A.slug}/board`)).json.billing || {}).text || ""));
  t("Settings shows the end date instead of a next bill", (await A.mgr.get(`/api/c/${A.slug}/site`)).json.ends_on && !(await A.mgr.get(`/api/c/${A.slug}/site`)).json.next_bill);
  t("the phone hears the cancellation", Boolean(await waitAlert(/cancelled\. It ends/)));
  await event(SA, "customer.subscription.updated", { status: "active", cancel_at_period_end: false });
  t("renewed in the portal: the date goes, and the phone hears it", !(await site(A.slug)).cancel_at && Boolean(await waitAlert(/took back its cancellation/)));

  // ---- a cancel on a month nobody paid for ends it now -----------------------------------------------------------------
  await event(SA, "invoice.payment_failed", { status: "past_due" });
  const floorBefore = (await q("SELECT floor_hash FROM platform.company_access WHERE company=$1", [A.slug])).rows[0];
  const ce = await event(SA, "customer.subscription.updated", { status: "past_due", cancel_at_period_end: true, cancel_at: end30 });
  const sA2 = await site(A.slug);
  t("a cancel while past due ends it now: anetix.ai cancels the subscription and voids what is open", ce.status === 200 && ce.json.applied.ended_now === true && callsTo("/internal/end").some((c) => c.body.subscription === SA.sub), ce.json);
  t("and it never announced an end date it was not going to keep", stub.alerts.filter((a) => /cancelled\. It ends/.test(a.message)).length === 1);
  t("back to a demo: the stage, returned_at, no subscription on the site, the DEMO strip back", sA2.stage === "back_to_demo" && sA2.returned_at && !sA2.stripe_subscription && (await q("SELECT demo FROM platform.companies WHERE slug=$1", [A.slug])).rows[0].demo === true);
  t("the floor's password is gone, so the floor is signed out", floorBefore && floorBefore.floor_hash && !(await q("SELECT floor_hash FROM platform.company_access WHERE company=$1", [A.slug])).rows[0].floor_hash);
  const bA = (await A.mgr.get(`/api/c/${A.slug}/board`)).json;
  t("the manager's board: a notice, the credit at 0% (the old demo's spend never comes back as credit), Go live again", bA.notices.some((n) => n.kind === "back_to_demo") && bA.credit && bA.credit.percent === 0 && bA.golive && bA.golive.action === "Go live", { credit: bA.credit, golive: bA.golive });
  t("a new AI start asks for credit, like any demo", /credit is used up/.test((await A.mgr.post(`/api/c/${A.slug}/intakes`, {})).json.error || ""));
  const refill = await www("/api/www/credit", { slug: A.slug, ref: `cs_refill_${Date.now()}`, paid_usd: 20, credit_usd: 10 });
  t("a refill counts from the return: 100%", refill.status === 200 && (await A.mgr.get(`/api/c/${A.slug}/board`)).json.credit.percent === 100, refill.json);
  t("the phone hears the return", Boolean(await waitAlert(/demo again/)));
  const late = await event(SA, "customer.subscription.deleted", { status: "canceled", cancellation_reason: "cancellation_requested" });
  t("the old subscription's late deleted event is kept and changes nothing", late.status === 200 && Object.keys(late.json.applied).length === 0 && (await site(A.slug)).stage === "back_to_demo", late.json);
  const setA = (await A.mgr.get(`/api/c/${A.slug}/site`)).json;
  t("Settings keeps Manage billing for the old invoices", setA.subscribed === false && setA.billing === true, setA);
  const L2 = await A.mgr.post(`/api/c/${A.slug}/billing`, {});
  t("and the link still opens the site's own Customer", L2.status === 200 && (await www("/api/www/billing/portal", { slug: A.slug, t: tokenOf(L2.json.url) })).json.customer === SA.customer);

  // ---- the customer's cancellation arrives at the period's end ---------------------------------------------------------
  const Bd = await makeDemo(admin, "Beacon Works");
  const SB = await toSubscribed(admin, Bd);
  const del = await event(SB, "customer.subscription.deleted", { status: "canceled", cancellation_reason: "cancellation_requested" });
  t("the paid month ended after a cancel: back to a demo, with no call to anetix.ai (Stripe ended it)", del.json.applied.returned === true && (await site(Bd.slug)).stage === "back_to_demo" && !callsTo("/internal/end").some((c) => c.body.subscription === SB.sub), del.json);

  // ---- Stripe ended one for a payment: flagged, and End ---------------------------------------------------------------
  const Cd = await makeDemo(admin, "Copperline");
  const SC = await toSubscribed(admin, Cd);
  const byStripe = await event(SC, "customer.subscription.deleted", { status: "canceled", cancellation_reason: "payment_failed" });
  const sC = await site(Cd.slug);
  t("Stripe ended it for a failed payment: billing never takes a floor down by itself, so it is flagged and still subscribed", byStripe.json.applied.attention === "canceled_at_stripe" && sC.stage === "subscribed" && sC.standing === "canceled_at_stripe");
  t("the phone hears it", Boolean(await waitAlert(/Stripe cancelled a site/)));
  const lapsed = await Cd.mgr.post(`/api/c/${Cd.slug}/intakes`, {});
  t("a lapsed site pauses new AI work like an unpaid one, and the board says so in red", lapsed.status >= 400 && /lapsed after its payments failed/.test(lapsed.json.error || "") && ((await Cd.mgr.get(`/api/c/${Cd.slug}/board`)).json.billing || {}).level === "red", lapsed.json);
  t("End needs a reason", (await admin.post(`/api/admin/sites/${Cd.slug}/end`, { password: PW.admin })).status === 400);
  t("End needs the step-up", (await admin.post(`/api/admin/sites/${Cd.slug}/end`, { note: "Stripe gave up on the card" })).status === 403);
  const endC = await admin.post(`/api/admin/sites/${Cd.slug}/end`, { password: PW.admin, note: "Stripe gave up on the card" });
  t("End: back to a demo, and anetix.ai is still asked, to void whatever the lapsed subscription left open", endC.status === 200 && endC.json.returned === true && (await site(Cd.slug)).stage === "back_to_demo" && callsTo("/internal/end").some((c) => c.body.subscription === SC.sub), endC.json);
  t("the manager's notice carries Anetix's reason", ((await Cd.mgr.get(`/api/c/${Cd.slug}/board`)).json.notices || []).some((n) => n.kind === "back_to_demo" && /Stripe gave up on the card/.test(n.text)));

  // ---- unpaid, then End --------------------------------------------------------------------------------------------------
  const Dd = await makeDemo(admin, "Delta Stamping");
  const SD = await toSubscribed(admin, Dd);
  t("End is refused for a site in good standing (a customer cancels in Manage billing)", (await admin.post(`/api/admin/sites/${Dd.slug}/end`, { password: PW.admin, note: "trying it on a good site" })).status === 409);
  await event(SD, "invoice.payment_failed", { status: "past_due" });
  await event(SD, "customer.subscription.updated", { status: "unpaid" });
  const soon = await admin.post(`/api/admin/sites/${Dd.slug}/end`, { password: PW.admin, note: "30 days unpaid, notice sent" });
  t("End waits until the fees are 30 days overdue (the Terms, 5.8), and says when it opens", soon.status === 409 && soon.json.code === "too_soon" && /30 days overdue/.test(soon.json.error), soon.json);
  await q("UPDATE platform.events SET created_at = created_at - interval '31 days' WHERE kind='site_standing' AND ref=$1", [Dd.slug]);
  const endD = await admin.post(`/api/admin/sites/${Dd.slug}/end`, { password: PW.admin, note: "30 days unpaid, notice sent" });
  t("End on an unpaid site: anetix.ai cancels it now and voids the open invoices, and the site is a demo again", endD.status === 200 && callsTo("/internal/end").some((c) => c.body.subscription === SD.sub) && (await site(Dd.slug)).stage === "back_to_demo", endD.json);
  t("the record says why", /ended by Anetix: 30 days unpaid/.test((await q("SELECT after FROM platform.record WHERE company=$1 AND kind='site_back_to_demo'", [Dd.slug])).rows[0].after));
  const again = await admin.post(`/api/admin/sites/${Dd.slug}/end`, { password: PW.admin, note: "again" });
  t("End twice: the second finds nothing to end", again.status === 409);

  // ---- an invoice that could not be finalized, and a declined card at Activate --------------------------------------
  const Ed = await makeDemo(admin, "Eastgate Fab");
  const SE = await toSubscribed(admin, Ed);
  const fin = await event(SE, "invoice.finalization_failed", { status: "active" });
  t("an invoice that could not be finalized: flagged for Brendan and the phone", fin.json.applied.attention === "invoice_not_finalized" && Boolean(await waitAlert(/could not be finalized/)), fin.json);
  const Fd = await makeDemo(admin, "Foundry Nine");
  stub.next.push({ status: 402, body: { error: "the card was declined: Your card was declined.", declined: true, message: "Your card was declined.", code: "card_declined", balance_reversed: true, detached: true } });
  const SF = await toSubscribed(admin, Fd);
  t("a card declined at Activate reaches the phone", SF.site.stage === "ordering" && Boolean(await waitAlert(/declined at Activate/)));
  t("no alert ever carried an email address", stub.alerts.every((a) => !/@/.test(`${a.title} ${a.message}`)), stub.alerts.map((a) => a.message));

  server.close(); R.done();
 } catch (e) { server.close(); R.abort(e); }
});
