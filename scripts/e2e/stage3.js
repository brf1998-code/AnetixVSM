// End to end for paid sites, stage 3 (src/activate.js, src/agreements.js, src/fairuse.js, src/notices.js): the Terms'
// switch and every acceptance, Activate and the rollover, a declined card, Decline, Send back, the customer's
// Withdraw, a lost answer finished by the first invoice.paid, a preview in test mode, the fair-use line and its lift,
// the learning switch, the Demos tab's bound, a refill refused for a paying site, the sweep, the 9.1 hold on library
// tools. anetix.ai's private channel is played by a stub in this process, so every answer Stripe could give (a success,
// a decline, a failure, test or live mode) is the test's to choose. Against a server ALREADY UP in fake-agent mode, on
// a fresh database, with SOS_WWW_KEY, SOS_WWW_URL, WWW_INTERNAL_URL (the stub's address) and WWW_INTERNAL_KEY set in
// both this shell and the server's (run-all.sh does it).
const http = require("http");
const { runner, client, login, PW, sleep } = require("./lib");
const { q } = require("../../src/db");
const totp = require("../../src/totp");
const G = require("../../src/golive");
const T = require("../../src/terms");
const R = runner(), t = R.t;
const BASE = process.env.SOS_E2E_BASE || "http://127.0.0.1:3999";
const KEY = process.env.SOS_WWW_KEY, IKEY = process.env.WWW_INTERNAL_KEY;
const STUB = new URL(process.env.WWW_INTERNAL_URL || "http://127.0.0.1:4011");
if (!KEY || !IKEY) { console.error("SOS_WWW_KEY and WWW_INTERNAL_KEY must be set in this shell and the server's"); process.exit(2); }

// ---- the stub of anetix.ai's private channel -------------------------------------------------------------------------
const stub = { mode: "test", tax: false, calls: [], next: [], abandon: [], n: 0 };
const server = http.createServer((req, res) => {
  let raw = ""; req.on("data", (d) => { raw += d; });
  req.on("end", () => {
    const send = (status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
    if (req.headers["x-www-internal-key"] !== IKEY) return send(401, { error: "internal key required" });
    const body = raw ? JSON.parse(raw) : {};
    stub.calls.push({ path: req.url, body });
    if (req.url === "/internal/ping") return send(200, { ok: true, stripe: stub.mode, tax: stub.tax, webhook: true });
    if (req.url === "/internal/abandon") return send(200, stub.abandon.shift() || { ok: true, subscription: null, balance_reversed: false, detached: true });
    if (req.url === "/internal/activate") {
      const scripted = stub.next.shift();
      if (scripted) return send(scripted.status, scripted.body);
      const n = ++stub.n, now = Math.floor(Date.now() / 1000);
      const sub = { id: `sub_stub_${n}`, status: "active", metadata: body.metadata, current_period_start: now, current_period_end: now + 30 * 86400 };
      return send(200, { ok: true, resumed: false, subscription: sub, price_id: `price_${body.price.lookup_key}`, balance_txn: body.balance && body.balance.cents ? `cbtxn_stub_${n}` : null,
        ...(body.preview ? { canceled: true, balance_reversed: true, detached: true } : {}) });
    }
    if (["/internal/detach", "/internal/reverse-balance", "/internal/cancel"].includes(req.url)) return send(200, { ok: true });
    send(404, { error: "not found" });
  });
});
const callsTo = (p) => stub.calls.filter((c) => c.path === p);

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
async function makeDemo(admin, name, { terms } = {}) {
  const email = `m${Date.now().toString(36)}${++demoN}@stage3.test`;
  const pin = (await admin.post("/api/admin/pins", { label: `${name} pin`, email, max_uses: 1, days: 30 })).json.pin.shown;
  const password = "copper-oak-2201-press";
  const made = await www("/api/www/companies", { pin, email, name, contact: "Sam Ortiz", ref: `stage3:${pin}`, paid_usd: 0, credit_usd: 10, password, demo: true, collect: true, ...(terms ? { terms, ip: "203.0.113.7" } : {}) });
  if (made.status !== 200) return { made };
  const slug = made.json.company.slug;
  const mgr = client();
  await mgr.post("/login", { name: email, password });
  const es = await mgr.post(`/api/c/${slug}/me/enroll/start`, {});
  await mgr.post(`/api/c/${slug}/me/enroll/verify`, { code: await codeFor(es.json.secret.replace(/\s/g, "")) });
  return { slug, mgr, email, made };
}
const tokenOf = (url) => new URL(url).searchParams.get("t");
const FACTS = {
  legal_name: "Keystone Fab LLC", site_name: "Keystone Fab, Allentown",
  site_address: { line1: "12 Mill Road", city: "Allentown", state: "PA", postal_code: "18101" },
  headcount: 140, sqft: 90000,
  plant_manager: { name: "Omar Reyes", title: "Plant manager", email: "omar@keystone.test" },
  contact: { is_pm: true }, billing: { email: "ap@keystone.test", same_as_site: true }, integrations: null, hardware: null, learning: false,
};
// From a demo to Signed with its card, the way anetix.ai drives it. -> { access, order, pm }
let cardN = 0;
async function toSigned(D, { kind = "m", facts = FACTS } = {}) {
  const link = kind === "a" ? (await (await login(PW.admin)).get(`/api/admin/sites/${D.slug}/golive-link`)).json.url : (await D.mgr.get(`/api/c/${D.slug}/board`)).json.golive.url;
  const access = { slug: D.slug, t: tokenOf(link) };
  const saved = await www("/api/www/golive/save", { access, fields: facts });
  const o = saved.json.order;
  const signed = await www("/api/www/golive/sign", { access, version: o.version, sha: o.sha, signer: { name: "Omar Reyes", title: "Plant manager", email: "omar@keystone.test" }, authority: true, ip: "198.51.100.4", ua: "e2e" });
  const n = ++cardN, cus = kind === "a" ? `cus_prev${n}` : ((await q("SELECT stripe_customer FROM platform.sites WHERE company=$1", [D.slug])).rows[0] || {}).stripe_customer || `cus_stub${n}`;
  await www("/api/www/golive/checkout", { access, stripe_customer: cus, setup_session: `cs_stub${n}` });
  const pm = `pm_stub${n}`;
  const card = await www("/api/www/golive/card", { order: o.id, setup_session: `cs_stub${n}`, stripe_customer: cus, payment_method: pm, card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 } });
  return { access, order: o.id, pm, signed, card };
}
const site = async (slug) => (await q("SELECT * FROM platform.sites WHERE company=$1", [slug])).rows[0];
const order = async (id) => (await q("SELECT * FROM platform.orders WHERE id=$1", [id])).rows[0];

server.listen(Number(STUB.port), "127.0.0.1", async () => {
 try {
  const admin = await login(PW.admin);
  const A = await makeDemo(admin, "Keystone Fab");   // made before the Terms are switched on

  // ---- the Terms: off, then on ---------------------------------------------------------------------------------------
  const ts0 = (await admin.get("/api/admin/terms")).json;
  t("the Terms start switched off, Brendan's draft, with counsel's brackets listed", ts0.live === false && ts0.version === T.TERMS_VERSION && ts0.draft === true && ts0.placeholders.includes("[LEGAL EMAIL]") && ts0.demos_waiting >= 1, ts0);
  t("off: a demo's board asks nothing", (await A.mgr.get(`/api/c/${A.slug}/board`)).json.terms === null);
  const st0 = await www("/api/www/terms/state");
  t("anetix.ai reads the switch, the version and hash to send back, and the words for each box", st0.status === 200 && st0.json.live === false && st0.json.sha === T.termsHash() && st0.json.words.demo === T.WORDS.demo() && st0.json.words.topup === T.WORDS.topup(), st0.json);
  t("and nothing opens without the shared key", (await www("/api/www/terms/state", undefined, "wrong-key-0123456789abcdef")).status === 401);
  const on = await admin.post("/api/admin/terms", { live: true });
  t("the admin switches the Terms on", on.status === 200 && on.json.live === true, on.json);
  const noTick = await makeDemo(admin, "Tickless Co");
  t("on: a demo set up without the box is refused, and says so", noTick.made.status === 400 && noTick.made.json.code === "terms_needed", noTick.made.json);
  const stale = await makeDemo(admin, "Stale Page Co", { terms: { agreed: true, version: T.TERMS_VERSION, sha: "0".repeat(64) } });
  t("a page open across new words is asked to look again", stale.made.status === 409 && stale.made.json.code === "terms_changed", stale.made.json);
  const B = await makeDemo(admin, "Brightline Tool", { terms: { agreed: true, version: T.TERMS_VERSION, sha: T.termsHash() } });
  const accB = (await q("SELECT * FROM platform.acceptances WHERE company=$1", [B.slug])).rows;
  t("with the box ticked the demo is made, and the acceptance kept: the words, the version, the hash, the address", B.slug && accB.length === 1 && accB[0].kind === "demo_setup" && accB[0].words === T.WORDS.demo() && accB[0].terms_version === T.TERMS_VERSION && accB[0].terms_sha256 === T.termsHash() && accB[0].ip === "203.0.113.7" && accB[0].who.name === "Sam Ortiz", accB);
  t("the version's words are kept at its first acceptance", (await q("SELECT sha256, doc->>'format' AS f FROM platform.terms_versions WHERE version=$1", [T.TERMS_VERSION])).rows[0].sha256 === T.termsHash());
  const bA = (await A.mgr.get(`/api/c/${A.slug}/board`)).json.terms;
  t("the demo made before the switch sees the box on its board, naming the company, with a link that opens without a pin", bA && bA.needed === true && bA.admin === false && bA.words === T.WORDS.board((await q("SELECT name FROM platform.companies WHERE slug=$1", [A.slug])).rows[0].name) && /\/terms\?k=\d+\.[A-Za-z0-9_-]{32}$/.test(bA.url), bA);
  t("an admin looking sees that it waits", (await admin.get(`/api/c/${A.slug}/board`)).json.terms.admin === true);
  t("the demo that ticked at set-up is not asked again", (await B.mgr.get(`/api/c/${B.slug}/board`)).json.terms === null);
  const blocked = await A.mgr.post(`/api/c/${A.slug}/intakes`, {});
  t("until the manager agrees, new AI work waits, and the message says what to do", blocked.status >= 400 && /Terms of Service need the manager's agreement/.test(blocked.json.error), blocked.json);
  t("an admin cannot agree for them", (await admin.post(`/api/c/${A.slug}/terms/accept`, { agreed: true, version: bA.version, sha: bA.sha })).status === 403);
  t("the box must be ticked", (await A.mgr.post(`/api/c/${A.slug}/terms/accept`, { agreed: false, version: bA.version, sha: bA.sha })).status === 400);
  const okA = await A.mgr.post(`/api/c/${A.slug}/terms/accept`, { agreed: true, version: bA.version, sha: bA.sha });
  const accA = (await q("SELECT * FROM platform.acceptances WHERE company=$1", [A.slug])).rows;
  t("the manager ticks it: kept with their account, and the box is gone", okA.status === 200 && accA.length === 1 && accA[0].kind === "board" && accA[0].who.email === A.email && accA[0].who.account && (await A.mgr.get(`/api/c/${A.slug}/board`)).json.terms === null, accA);
  t("and new AI work starts again", (await A.mgr.post(`/api/c/${A.slug}/intakes`, {})).status === 200);
  const tu = await www("/api/www/terms/accept", { slug: A.slug, kind: "topup", version: T.TERMS_VERSION, sha: T.termsHash(), ip: "192.0.2.9", ua: "e2e" });
  t("a refill's box on anetix.ai is kept too, before Stripe opens", tu.status === 200 && (await q("SELECT kind, words, ip FROM platform.acceptances WHERE company=$1 AND kind='topup'", [A.slug])).rows[0].words === T.WORDS.topup(), tu.json);
  t("a refill's box for a company that does not exist is refused", (await www("/api/www/terms/accept", { slug: "no-such-co", kind: "topup", version: T.TERMS_VERSION, sha: T.termsHash() })).status === 404);

  // ---- Go live to Signed: the order's acceptance -------------------------------------------------------------------------
  await admin.post("/api/admin/golive", { open: true });
  const view0 = await www("/api/www/golive/view", { access: { slug: A.slug, t: tokenOf((await A.mgr.get(`/api/c/${A.slug}/board`)).json.golive.url) } });
  t("the go-live view carries Before you sign and the tick's words for the page", view0.json.terms.notice === T.WORDS.notice && /^I agree to this order form and the Anetix Terms of Service/.test(view0.json.terms.tick), view0.json.terms);
  const SA = await toSigned(A);
  const oA = await order(SA.order);
  t("signed and the card saved: the site waits on Brendan", (await site(A.slug)).stage === "signed" && oA.state === "signed" && oA.payment_method === SA.pm, { stage: (await site(A.slug)).stage, state: oA.state });
  t("the order keeps the words beside the signature: the box above it and the tick naming the company", oA.assent && oA.assent.notice === T.WORDS.notice && oA.assent.tick === T.WORDS.order(FACTS.legal_name), oA.assent);
  const accOrder = (await q("SELECT * FROM platform.acceptances WHERE company=$1 AND kind='order'", [A.slug])).rows;
  t("the signature is an acceptance of the Terms: the signer, the order, the address", accOrder.length === 1 && accOrder[0].ref === SA.order && accOrder[0].who.name === "Omar Reyes" && accOrder[0].ip === "198.51.100.4" && accOrder[0].site_id === (await site(A.slug)).id, accOrder);
  t("the order form says the Terms as updated under section 19, and Brendan's two changes", /as updated under section 19\./.test(oA.text) && /except as the Terms provide\./.test(oA.text) && /A fair-use pause does not stop the Site's tools\./.test(oA.text));
  const vW = await www("/api/www/golive/view", { access: SA.access });
  t("until it is switched on, the manager may withdraw it (the Terms, 5.4)", vW.json.can_withdraw === true);

  // ---- Activate ------------------------------------------------------------------------------------------------------------
  const demoFb = (await q("INSERT INTO platform.feedback (company, message, name, status, outcome) VALUES ($1, 'in the demo: make the labels bigger', 'floor', 'new', NULL) RETURNING id", [A.slug])).rows[0].id;
  const ck = await admin.get(`/api/admin/sites/${A.slug}/checks`);
  t("the checks: ready, the channel up in test mode, the AI key not noted as on, no other paying site, what the rollover does", ck.status === 200 && ck.json.ready === true && ck.json.channel.ok === true && ck.json.channel.stripe === "test" && ck.json.ai_key.autofill === false && ck.json.tenancy.others === 0 && ck.json.plan.some((x) => /floor gets its own password/.test(x)), ck.json);
  t("and they say Stripe is in test mode for a customer's order (Activate asks for the tick), with no Tax warning outside live mode", ck.json.test_mode === true && ck.json.tax_off === false, ck.json);
  const noCode = await admin.post(`/api/admin/sites/${A.slug}/activate`, {});
  t("Activate needs the step-up (the admin password again, for the shared admin session)", noCode.status === 403 && noCode.json.code === "step_up", noCode.json);
  const noTestTick = await admin.post(`/api/admin/sites/${A.slug}/activate`, { password: PW.admin });
  t("a customer's order while Stripe is in test mode is refused without the tick: it would switch a real company on with no real charge", noTestTick.status === 409 && noTestTick.json.code === "test_mode" && (await site(A.slug)).stage === "signed", noTestTick.json);
  const noKey = await admin.post(`/api/admin/sites/${A.slug}/activate`, { password: PW.admin, test_mode_ok: true });
  t("and refuses while the AI key's auto reload is not noted as on", noKey.status === 409 && noKey.json.code === "ai_key", noKey.json);
  await admin.post("/api/admin/credit", { balance_usd: 100, autofill: true, note: "e2e" });
  stub.next.push({ status: 502, body: { error: "Stripe answered 500" } });
  const stop = await admin.post(`/api/admin/sites/${A.slug}/activate`, { password: PW.admin, test_mode_ok: true });
  const oStop = await order(SA.order);
  t("Stripe failing is not a decline: the order stays switching on with the error, nothing lost", stop.status === 502 && stop.json.code === "stopped" && oStop.state === "activating" && oStop.stripe.last_error && /Stripe answered 500/.test(oStop.stripe.last_error.message) && (await site(A.slug)).stage === "activating", { stop: stop.json, o: oStop.state });
  const call1 = callsTo("/internal/activate")[0].body;
  t("what the product asks anetix.ai for: the site's Customer, the card, the band's monthly price by lookup key, the order in the metadata", call1.customer === (await site(A.slug)).stripe_customer && call1.payment_method === SA.pm && call1.price.lookup_key === "anetix_site_core_v1_250000" && call1.price.unit_amount === 250000 && call1.metadata.order === SA.order && call1.metadata.site === (await site(A.slug)).id && call1.balance.cents === 0, call1);
  const rStop = (await admin.get("/api/admin/sites")).json.rows.find((r) => r.slug === A.slug);
  t("the Sites tab says it stopped and why", rStop.stage === "activating" && rStop.order.activate && rStop.order.activate.last_error.message === "Stripe answered 500" && rStop.order.activate.attempts === 1, rStop.order);
  const withdrawNow = await www("/api/www/golive/withdraw", { access: SA.access });
  t("while it is switching on the customer cannot withdraw it here", withdrawNow.status === 409 && withdrawNow.json.code === "activating", withdrawNow.json);
  const act = await admin.post(`/api/admin/sites/${A.slug}/activate`, { password: PW.admin, test_mode_ok: true });
  const sA = await site(A.slug), oA2 = await order(SA.order), coA = (await q("SELECT * FROM platform.companies WHERE slug=$1", [A.slug])).rows[0];
  t("Activate again carries on: subscribed, the same amounts sent again", act.status === 200 && act.json.activated === true && sA.stage === "subscribed" && sA.standing === "good" && oA2.state === "activated" && callsTo("/internal/activate")[1].body.balance.cents === call1.balance.cents, act.json);
  t("the site keeps what it signed: its subscription, the period, the band and price, the learning choice, when it converted", sA.stripe_subscription && oA2.stripe.subscription === sA.stripe_subscription && sA.period_end && Number(sA.price_usd) === 2500 && sA.band.key === "core" && sA.learning_opt_in === false && sA.converted_at && sA.order_id === SA.order);
  t("the rollover: the DEMO strip off, the company named for the site, every step marked done", coA.demo === false && coA.name === FACTS.site_name && sA.rollover && sA.rollover.done_at && sA.rollover.floor_at && sA.rollover.sample_at);
  const access = (await q("SELECT floor_hash, manager_hash FROM platform.company_access WHERE company=$1", [A.slug])).rows[0];
  t("the floor has a password of its own now, and the manager still no shared one", access.floor_hash && !access.manager_hash);
  t("a second press finds nothing to switch on", (await admin.post(`/api/admin/sites/${A.slug}/activate`, { password: PW.admin, test_mode_ok: true })).status === 409);
  const bmA = (await A.mgr.get(`/api/c/${A.slug}/board`)).json;
  t("the manager's board: no credit line, not a demo, the welcome waiting", bmA.credit === null && bmA.company.demo === false && bmA.welcome && bmA.welcome.ready === true && !bmA.welcome.admin && bmA.golive === null, { credit: bmA.credit, welcome: bmA.welcome });
  t("an admin sees the welcome waits and cannot take it", (await admin.get(`/api/c/${A.slug}/board`)).json.welcome.admin === true && (await admin.post(`/api/c/${A.slug}/welcome`, {})).status === 403);
  const wA = await A.mgr.post(`/api/c/${A.slug}/welcome`, {});
  t("the manager collects the floor's password once", wA.status === 200 && /^[a-z]+-[a-z]+-\d{3}$/.test(wA.json.floor) && wA.json.board === `/c/${A.slug}/`, wA.json);
  t("and never again", (await A.mgr.post(`/api/c/${A.slug}/welcome`, {})).status === 404 && !(await A.mgr.get(`/api/c/${A.slug}/board`)).json.welcome);
  const floorA = client(); const fl = await floorA.post("/login", { password: wA.json.floor, company: A.slug });
  t("the floor signs in with it", fl.status === 200 && (await floorA.get(`/api/c/${A.slug}/board`)).status === 200, fl.json);
  t("the floor cannot collect anything or change the learning choice", (await floorA.post(`/api/c/${A.slug}/welcome`, {})).status === 403 && (await floorA.post(`/api/c/${A.slug}/learning`, { on: true })).status === 403);

  // ---- a paying site: no credit, the fair-use line ---------------------------------------------------------------------------
  await q("INSERT INTO platform.credit_ledger (company, delta_usd, kind, note) VALUES ($1, -500, 'adjust', 'e2e: nothing left')", [A.slug]);
  t("no credit gate for a paying site: new AI work starts with the ledger far below zero", (await A.mgr.post(`/api/c/${A.slug}/intakes`, {})).status === 200);
  const refill = await www("/api/www/credit", { slug: A.slug, ref: "cs_after_subscribed", paid_usd: 20, credit_usd: 10 });
  t("a refill for a paying site is answered subscribed (anetix.ai refunds it)", refill.status === 409 && refill.json.code === "subscribed", refill.json);
  await q("INSERT INTO platform.credit_ledger (company, delta_usd, kind, ref, paid_usd, note) VALUES ($1, 10, 'purchase', 'cs_demo_topup_A', 20, 'e2e: a refill bought during the demo')", [A.slug]);
  const oldTopup = await www("/api/www/credit", { slug: A.slug, ref: "cs_demo_topup_A", paid_usd: 20, credit_usd: 10 });
  t("but a payment credited during the demo, its success page reopened now, is answered already done, never subscribed (so never refunded)", oldTopup.status === 200 && oldTopup.json.added === false, oldTopup.json);
  const coInfo = await www(`/api/www/companies/${A.slug}`);
  t("the top-up page learns it is subscribed, with no credit to show", coInfo.json.subscribed === true && coInfo.json.credit === null, coInfo.json);
  await q("INSERT INTO platform.ai_usage (company, kind, cost_usd, detail) VALUES ($1, 'chat', 2100, '{}')", [A.slug]);
  const over = await A.mgr.post(`/api/c/${A.slug}/intakes`, {});
  const over2 = await A.mgr.post(`/api/c/${A.slug}/intakes`, {});
  t("past the fair-use line (80% of $2,500), new AI work is paused with the words from the spec", over.status >= 400 && /New AI work here is paused until .+ This month passed the fair-use line in your agreement, which normal use does not reach, and Anetix has been told\. Your tools keep working\./.test(over.json.error) && over2.status >= 400, over.json);
  t("Anetix is told once a period, not at every refused start", (await q("SELECT count(*)::int AS n FROM platform.events WHERE kind='fair_use_reached' AND ref=$1", [A.slug])).rows[0].n === 1);
  const bOver = (await A.mgr.get(`/api/c/${A.slug}/board`)).json;
  t("the manager's board says it once", bOver.fair_use && bOver.fair_use.over === true && /paused until/.test(bOver.fair_use.message));
  const pipe = (await admin.get("/api/admin/sites")).json, rA = pipe.rows.find((r) => r.slug === A.slug);
  t("the Sites tab: needs attention, the share of the line, the band and price as signed", pipe.attention >= 1 && rA.fair_use.over === true && rA.fair_use.line_usd === 2000 && rA.band.monthly_usd === 2500 && rA.band.signed === true && rA.band.fair_use_usd === 2000 && rA.subscription.id === sA.stripe_subscription, { attention: pipe.attention, f: rA.fair_use });
  t("a lift needs a reason", (await admin.post(`/api/admin/sites/${A.slug}/lift`, { note: "" })).status === 400);
  const lift = await admin.post(`/api/admin/sites/${A.slug}/lift`, { note: "a big first month of new tools" });
  t("Brendan lifts the line for the rest of the period, and new AI work starts again", lift.status === 200 && lift.json.lifted === true && lift.json.over === false && (await A.mgr.post(`/api/c/${A.slug}/intakes`, {})).status === 200, lift.json);

  // ---- Settings: the learning choice; the Demos tab's bound ---------------------------------------------------------------
  const st = (await A.mgr.get(`/api/c/${A.slug}/site`)).json;
  t("Settings: the band, the price and the learning choice from the order form", st.subscribed === true && st.band === "Core" && st.price_usd === 2500 && st.learning_opt_in === false && /\/terms\?k=/.test(st.terms_link), st);
  const lon = await A.mgr.post(`/api/c/${A.slug}/learning`, { on: true });
  t("the manager opts in later (the Terms, 10.2), and it is on the record", lon.json.learning_opt_in === true && (await site(A.slug)).learning_opt_in === true && (await q("SELECT 1 FROM platform.record WHERE company=$1 AND kind='learning_changed'", [A.slug])).rows.length === 1);
  t("an admin cannot make the choice for them", (await admin.post(`/api/c/${A.slug}/learning`, { on: false })).status === 403);
  await A.mgr.post(`/api/c/${A.slug}/learning`, { on: false });
  await q("INSERT INTO platform.feedback (company, message, name, status) VALUES ($1, 'after going live: the plant''s own words', 'floor', 'new')", [A.slug]);
  await q("UPDATE platform.feedback SET status='done', outcome='built after going live: bigger labels on station 3', updated_at=now() WHERE id=$1", [demoFb]);
  const dA = (await admin.get(`/api/admin/demos/${A.slug}`)).json;
  t("the Demos tab keeps the demo period only for a paying site without the opt-in", dA.subscribed && dA.subscribed.demo_period_only === true && !dA.feedback.some((f) => /after going live/.test(f.message)), { sub: dA.subscribed, n: dA.feedback.length });
  const fbKept = dA.feedback.find((f) => f.id === demoFb);
  t("a request made in the demo and worked on after going live keeps its words and loses what happened since", fbKept && fbKept.after_going_live === true && /make the labels bigger/.test(fbKept.message) && fbKept.outcome === null && fbKept.status === "changed after going live", fbKept);
  await A.mgr.post(`/api/c/${A.slug}/learning`, { on: true });
  t("with the opt-in it shows everything", (await admin.get(`/api/admin/demos/${A.slug}`)).json.feedback.some((f) => /after going live/.test(f.message)));
  const del = await admin.post(`/api/admin/companies/${A.slug}/delete`, { confirm_slug: A.slug, password: PW.admin });
  t("a paying site cannot be deleted before its subscription ends", del.status === 409 && /paying site/.test(del.json.error), del.json);

  // ---- billing events: a replay changes nothing, the period moves ------------------------------------------------------
  const later = Math.floor(Date.now() / 1000) + 30 * 86400;
  const ev1 = await www("/api/www/billing-events", { event: { id: "evt_stage3_renew", type: "customer.subscription.updated" }, subscription: { id: sA.stripe_subscription, status: "active", metadata: { site: sA.id, order: SA.order }, current_period_start: later, current_period_end: later + 30 * 86400 } });
  t("a renewal moves the fair-use window", ev1.status === 200 && ev1.json.applied.period && new Date((await site(A.slug)).period_end).getTime() === (later + 30 * 86400) * 1000, ev1.json);
  const ev2 = await www("/api/www/billing-events", { event: { id: "evt_stage3_renew", type: "customer.subscription.updated" }, subscription: { id: sA.stripe_subscription, status: "active", metadata: { site: sA.id } } });
  t("the same event again is a replay and changes nothing", ev2.json.replay === true);
  t("an event for another subscription does not touch the site", (await www("/api/www/billing-events", { event: { id: "evt_stage3_other", type: "customer.subscription.updated" }, subscription: { id: "sub_other", status: "active", metadata: { site: sA.id }, current_period_start: later * 2, current_period_end: later * 2 + 10 } })).json.applied.period === undefined);

  // ---- a declined card ----------------------------------------------------------------------------------------------------
  const C = await makeDemo(admin, "Cobalt Works", { terms: { agreed: true, version: T.TERMS_VERSION, sha: T.termsHash() } });
  const SC = await toSigned(C);
  stub.next.push({ status: 402, body: { error: "the card was declined: Your card was declined.", declined: true, message: "Your card was declined.", code: "card_declined", balance_reversed: true, detached: true } });
  const dec = await admin.post(`/api/admin/sites/${C.slug}/activate`, { password: PW.admin, test_mode_ok: true, tenancy_note: "one runtime while there are two small sites; per customer at the third" });
  const oC = await order(SC.order), sC = await site(C.slug);
  t("the second paying site needed the tenancy reason, and it is kept", sC.tenancy_note && /per customer at the third/.test(sC.tenancy_note));
  t("a declined card: nothing charged, the order back to waiting for a card, the site back to Ordering", dec.status === 200 && dec.json.declined === true && oC.state === "signed" && oC.payment_method === null && oC.stripe.declined.length === 1 && oC.stripe.declined[0].message === "Your card was declined." && sC.stage === "ordering", { dec: dec.json, stage: sC.stage });
  const bC = (await C.mgr.get(`/api/c/${C.slug}/board`)).json;
  t("the manager is told to use another card, on the board and in Go live's line", bC.notices.some((n) => n.kind === "card_declined" && /Use another card/.test(n.text)) && bC.golive.declined === true && bC.golive.action === "Add another card" && /card was declined/.test(bC.golive.line), bC.golive);
  const pm2 = "pm_stubC2";
  await www("/api/www/golive/checkout", { access: SC.access, stripe_customer: sC.stripe_customer, setup_session: "cs_stubC2" });
  const c2 = await www("/api/www/golive/card", { order: SC.order, setup_session: "cs_stubC2", stripe_customer: sC.stripe_customer, payment_method: pm2, card: { brand: "mastercard", last4: "4444", exp_month: 1, exp_year: 2031 } });
  t("another card moves it back to Signed, ready for Activate", c2.json.applied === true && (await site(C.slug)).stage === "signed" && (await order(SC.order)).payment_method === pm2, c2.json);
  const nC = bC.notices.find((n) => n.kind === "card_declined");
  t("an admin cannot close the manager's notice; the manager can", (await admin.post(`/api/c/${C.slug}/notices/${nC.id}/seen`, {})).status === 403 && (await C.mgr.post(`/api/c/${C.slug}/notices/${nC.id}/seen`, {})).status === 200 && !(await C.mgr.get(`/api/c/${C.slug}/board`)).json.notices.some((n) => n.id === nC.id));
  t("another company's notice cannot be closed from here", (await C.mgr.post(`/api/c/${C.slug}/notices/999999/seen`, {})).status === 404);

  // ---- Send back, Decline, the sweep ----------------------------------------------------------------------------------------
  t("Send back needs a note", (await admin.post(`/api/admin/sites/${C.slug}/send-back`, { note: "" })).status === 400);
  const sb = await admin.post(`/api/admin/sites/${C.slug}/send-back`, { note: "the headcount looks like one shift, not all of them" });
  const oSb = await order(SC.order), draft = await order(sb.json.draft);
  t("Send back: the order voided with the note, a new draft with the same answers, the site back to Ordering, the card to remove", sb.status === 200 && oSb.state === "void" && /Anetix sent this order back: the headcount/.test(oSb.note) && (oSb.stripe.detach_list || []).includes(pm2) && draft.state === "draft" && draft.facts.legal_name === FACTS.legal_name && (await site(C.slug)).stage === "ordering", sb.json);
  t("the manager sees the note on the board", (await C.mgr.get(`/api/c/${C.slug}/board`)).json.notices.some((n) => n.kind === "sent_back" && /headcount looks like one shift/.test(n.text)));
  await sleep(300);
  const sw = await admin.post("/api/admin/stripe-sweep", {});
  const detachCalls = callsTo("/internal/detach").map((c) => c.body.payment_method);
  t("the sweep removes the card over the channel and marks it removed", detachCalls.includes(pm2) && ((await order(SC.order)).stripe.detached_list || []).includes(pm2), { sw: sw.json, detachCalls });
  const sw2 = await admin.post("/api/admin/stripe-sweep", {});
  t("a second sweep finds nothing left to remove there", callsTo("/internal/detach").filter((c) => c.body.payment_method === pm2).length === 1, sw2.json);
  // sign the new draft, card, then Decline
  const vC = (await www("/api/www/golive/view", { access: SC.access })).json.order;
  await www("/api/www/golive/sign", { access: SC.access, version: vC.version, sha: vC.sha, signer: { name: "Omar Reyes", title: "Plant manager", email: "omar@keystone.test" }, authority: true, ip: "198.51.100.4" });
  await www("/api/www/golive/checkout", { access: SC.access, stripe_customer: sC.stripe_customer, setup_session: "cs_stubC3" });
  await www("/api/www/golive/card", { order: vC.id, setup_session: "cs_stubC3", stripe_customer: sC.stripe_customer, payment_method: "pm_stubC3", card: { brand: "visa", last4: "4242" } });
  t("Decline needs a reason", (await admin.post(`/api/admin/sites/${C.slug}/decline`, { reason: "" })).status === 400);
  const dl = await admin.post(`/api/admin/sites/${C.slug}/decline`, { reason: "we are not taking sites in this state yet" });
  const oDl = await order(vC.id);
  t("Decline: the order declined with the reason, the site back to a demo, the card to remove, the manager told", dl.status === 200 && oDl.state === "declined" && (oDl.stripe.detach_list || []).includes("pm_stubC3") && (await site(C.slug)).stage === "demo" && (await C.mgr.get(`/api/c/${C.slug}/board`)).json.notices.some((n) => n.kind === "declined" && /not taking sites in this state/.test(n.text)), dl.json);

  // ---- the Terms, 4.2: a demo Anetix ends refunds the unused credit it bought (shown on the delete confirm) ---------------------
  const bought = await www("/api/www/credit", { slug: C.slug, ref: "cs_c_refill", paid_usd: 20, credit_usd: 10 });
  const due = await admin.get(`/api/admin/companies/${C.slug}/refund-due`);
  t("the delete confirm shows the refund due: the bought credit unused, at the price paid, with the payment to refund", bought.status === 200 && due.status === 200 && due.json.refund_usd === 20 && due.json.purchases.length === 1 && due.json.purchases[0].ref === "cs_c_refill", due.json);
  t("and a manager cannot read it", (await C.mgr.get(`/api/admin/companies/${C.slug}/refund-due`)).status === 403);

  // ---- the customer's Withdraw ------------------------------------------------------------------------------------------------
  const W = await makeDemo(admin, "Wharf Street Metal", { terms: { agreed: true, version: T.TERMS_VERSION, sha: T.termsHash() } });
  const wLink = (await W.mgr.get(`/api/c/${W.slug}/board`)).json.golive.url, wAcc = { slug: W.slug, t: tokenOf(wLink) };
  await www("/api/www/golive/save", { access: wAcc, fields: FACTS });
  const wDraft = await www("/api/www/golive/withdraw", { access: wAcc });
  t("a draft has nothing to withdraw", wDraft.status === 409 && wDraft.json.code === "draft", wDraft.json);
  const SW = await toSigned(W);
  t("an approver cannot withdraw it", (await www("/api/www/golive/withdraw", { access: { order: SW.order, t: "1.x.y" } })).status === 404);
  const wd = await www("/api/www/golive/withdraw", { access: SW.access });
  const oW = await order(SW.order);
  t("the manager withdraws a signed order before Activate: voided, the card handed back to remove, the site a demo again", wd.status === 200 && oW.state === "void" && /withdrawn by the customer/.test(oW.note) && JSON.stringify(wd.json.detach_cards) === JSON.stringify([SW.pm]) && (oW.stripe.detach_list || []).includes(SW.pm) && (await site(W.slug)).stage === "demo" && wd.json.can_withdraw === false, wd.json);

  // ---- a lost answer, finished by the first invoice.paid ------------------------------------------------------------------------
  const L = await makeDemo(admin, "Lakeside Plastics", { terms: { agreed: true, version: T.TERMS_VERSION, sha: T.termsHash() } });
  const SL = await toSigned(L);
  stub.next.push({ status: 504, body: { error: "anetix.ai did not answer in time" } });
  const lost = await admin.post(`/api/admin/sites/${L.slug}/activate`, { password: PW.admin, test_mode_ok: true, tenancy_note: "e2e: a third small site on one runtime" });
  t("the answer lost on the way: the order waits, switching on", lost.status === 502 && (await order(SL.order)).state === "activating", lost.json);
  const sL = await site(L.slug), nowS = Math.floor(Date.now() / 1000);
  const paid = await www("/api/www/billing-events", { event: { id: "evt_stage3_paid_L", type: "invoice.paid" }, subscription: { id: "sub_stub_lostL", status: "active", metadata: { site: sL.id, order: SL.order }, current_period_start: nowS, current_period_end: nowS + 30 * 86400 } });
  const sL2 = await site(L.slug);
  t("the first invoice.paid finishes it: subscribed, the rollover done", paid.status === 200 && paid.json.applied.activated === true && sL2.stage === "subscribed" && sL2.stripe_subscription === "sub_stub_lostL" && sL2.rollover.done_at && (await order(SL.order)).state === "activated", paid.json);
  t("and a replay of that event does nothing", (await www("/api/www/billing-events", { event: { id: "evt_stage3_paid_L", type: "invoice.paid" }, subscription: { id: "sub_stub_lostL", status: "active", metadata: { site: sL.id, order: SL.order } } })).json.replay === true);

  // ---- the welcome: a floor password changed another way is never shown as if it opened the floor ----------------------------
  const encL = (await site(L.slug)).welcome_enc;
  t("the rollover left L's welcome waiting", Boolean(encL) && (await L.mgr.get(`/api/c/${L.slug}/board`)).json.welcome.ready === true);
  await admin.post(`/api/admin/companies/${L.slug}/access`, { floor_password: "tin-crane-448" });
  t("a new floor password from the company card takes the welcome away", !(await site(L.slug)).welcome_enc && !(await L.mgr.get(`/api/c/${L.slug}/board`)).json.welcome);
  await q("UPDATE platform.sites SET welcome_enc=$2 WHERE company=$1", [L.slug, encL]);   // an old welcome back, as a restore could bring it
  const staleW = await L.mgr.post(`/api/c/${L.slug}/welcome`, {});
  t("an old welcome whose password no longer opens the floor says so and shows nothing", staleW.status === 410 && staleW.json.code === "stale" && !staleW.json.floor && !(await site(L.slug)).welcome_enc, staleW.json);

  // ---- standings from Stripe: past due, good again, cancelled at Stripe ---------------------------------------------------------
  const ev = (id, type, status) => www("/api/www/billing-events", { event: { id, type }, subscription: { id: "sub_stub_lostL", status, metadata: { site: sL.id, order: SL.order } } });
  const pd = await ev("evt_stage3_L_failed", "invoice.payment_failed", "past_due");
  t("a failed charge: the site's standing is past due, nothing else changes yet (stage 4)", pd.json.applied.standing === "past_due" && (await site(L.slug)).standing === "past_due" && (await site(L.slug)).stage === "subscribed", pd.json);
  const good = await ev("evt_stage3_L_paid2", "invoice.paid", "active");
  t("paid again: good", good.json.applied.standing === "good" && (await site(L.slug)).standing === "good");
  const gone = await ev("evt_stage3_L_deleted", "customer.subscription.deleted", "canceled");
  const sLg = await site(L.slug), rowL = (await admin.get("/api/admin/sites")).json.rows.find((r) => r.slug === L.slug);
  t("cancelled at Stripe: flagged for Brendan on the Sites tab, the site itself untouched until stage 4", gone.json.applied.attention === "canceled_at_stripe" && sLg.standing === "canceled_at_stripe" && sLg.attention.kind === "canceled_at_stripe" && sLg.stage === "subscribed" && rowL && rowL.attention && rowL.attention.kind === "canceled_at_stripe", { applied: gone.json.applied, attention: rowL && rowL.attention });

  // ---- Stop switching on: an order stuck at activating ------------------------------------------------------------------------
  const S = await makeDemo(admin, "Stuck Press Co", { terms: { agreed: true, version: T.TERMS_VERSION, sha: T.termsHash() } });
  const SS = await toSigned(S);
  stub.next.push({ status: 504, body: { error: "anetix.ai did not answer in time" } });
  await admin.post(`/api/admin/sites/${S.slug}/activate`, { password: PW.admin, test_mode_ok: true, tenancy_note: "e2e: stuck" });
  t("an answer lost on the way leaves the order switching on", (await order(SS.order)).state === "activating" && (await site(S.slug)).stage === "activating");
  t("Stop switching on needs the step-up", (await admin.post(`/api/admin/sites/${S.slug}/stop-activating`, {})).status === 403);
  const ckS = (await admin.get(`/api/admin/sites/${S.slug}/checks`)).json;
  t("the checks say it is switching on", ckS.order && ckS.order.state === "activating" && ckS.ready === true, ckS.order);
  stub.abandon.push({ ok: true, subscription: null, balance_reversed: false, detached: false });
  const stp = await admin.post(`/api/admin/sites/${S.slug}/stop-activating`, { password: PW.admin });
  const oS = await order(SS.order), abandonCall = callsTo("/internal/abandon").slice(-1)[0];
  t("Stripe holds no subscription: the order back to waiting for a card, the site back to Ordering, the card on the list to remove", stp.status === 200 && oS.state === "signed" && oS.payment_method === null && (oS.stripe.stopped || []).length === 1 && (oS.stripe.detach_list || []).includes(SS.pm) && (await site(S.slug)).stage === "ordering", { stp: stp.json, state: oS.state });
  t("what the product asked anetix.ai: the order, the site's Customer and the card", abandonCall && abandonCall.body.order === SS.order && abandonCall.body.payment_method === SS.pm && abandonCall.body.customer === (await site(S.slug)).stripe_customer, abandonCall && abandonCall.body);
  t("the manager is told to add a card again", (await S.mgr.get(`/api/c/${S.slug}/board`)).json.notices.some((n) => n.kind === "card_declined" && /could not finish switching the site on/.test(n.text)));
  t("and a second press finds nothing switching on", (await admin.post(`/api/admin/sites/${S.slug}/stop-activating`, { password: PW.admin })).status === 409);
  const F = await makeDemo(admin, "Found Late Ltd", { terms: { agreed: true, version: T.TERMS_VERSION, sha: T.termsHash() } });
  const SF = await toSigned(F);
  stub.next.push({ status: 504, body: { error: "anetix.ai did not answer in time" } });
  await admin.post(`/api/admin/sites/${F.slug}/activate`, { password: PW.admin, test_mode_ok: true, tenancy_note: "e2e: found" });
  const sF0 = await site(F.slug), nowF = Math.floor(Date.now() / 1000);
  stub.abandon.push({ ok: true, subscription: { id: "sub_found_F", status: "active", metadata: { site: sF0.id, order: SF.order }, current_period_start: nowF, current_period_end: nowF + 30 * 86400 } });
  const fnd = await admin.post(`/api/admin/sites/${F.slug}/stop-activating`, { password: PW.admin });
  t("Stripe had the subscription after all: Stop finishes the rollover instead of undoing it", fnd.status === 200 && fnd.json.activated === true && (await site(F.slug)).stage === "subscribed" && (await site(F.slug)).stripe_subscription === "sub_found_F" && (await order(SF.order)).state === "activated", fnd.json);

  // ---- a preview: test mode only, the company untouched ---------------------------------------------------------------------
  const P = await makeDemo(admin, "Preview Row Co", { terms: { agreed: true, version: T.TERMS_VERSION, sha: T.termsHash() } });
  const SP = await toSigned(P, { kind: "a" });
  t("an admin's preview reaches Signed with its own card, the site untouched", (await order(SP.order)).kind === "preview" && (await order(SP.order)).payment_method === SP.pm && (await site(P.slug)).stage === "demo");
  stub.mode = "live";   // Activate asks the channel fresh every time
  const pLive = await admin.post(`/api/admin/sites/${P.slug}/activate`, { password: PW.admin });
  t("in live mode a preview is refused: it would charge a real card", pLive.status === 409 && pLive.json.code === "live", pLive.json);
  const ckLive = (await admin.get(`/api/admin/sites/${P.slug}/checks`)).json;   // the channel as Activate just saw it
  t("live with Stripe Tax off: the checks warn, and ask no test-mode tick", ckLive.tax_off === true && ckLive.test_mode === false, { tax_off: ckLive.tax_off, test_mode: ckLive.test_mode });
  stub.mode = "test";
  const pv = await admin.post(`/api/admin/sites/${P.slug}/activate`, { password: PW.admin });
  const oP = await order(SP.order), coP = (await q("SELECT demo FROM platform.companies WHERE slug=$1", [P.slug])).rows[0];
  t("in test mode it runs the real calls on its own Customer, is cancelled at once, and shows what the rollover would do", pv.status === 200 && pv.json.preview === true && pv.json.canceled === true && Array.isArray(pv.json.plan) && pv.json.plan.length >= 5 && oP.state === "void" && oP.stripe.preview_run && (await site(P.slug)).stage === "demo" && coP.demo === true, pv.json);
  t("the preview's call was marked a preview, on its own Customer", callsTo("/internal/activate").some((c) => c.body.preview === true && /^cus_prev/.test(c.body.customer)));

  // ---- the Terms, 9.1: a customer's live tool ------------------------------------------------------------------------------------
  const noWhy = await admin.post(`/api/c/${A.slug}/modules/kpis/goto`, { version: 1 });
  t("an admin switching a customer's tool without saying why is refused", noWhy.status === 400 && noWhy.json.code === "admin_reason", noWhy.json);
  const addK = await admin.post(`/api/admin/companies/${A.slug}/modules`, { module: "kpis" });
  t("a library tool added to the customer goes live as version 1", addK.status === 200 && (await q("SELECT live_version FROM platform.modules WHERE company=$1 AND name='kpis'", [A.slug])).rows[0].live_version === 1, addK.json);
  await q("UPDATE platform.modules SET repo_hash='changed-since' WHERE company=$1 AND name='kpis'", [A.slug]);
  await admin.post(`/api/admin/companies/${A.slug}/modules`, { module: "kpis" });
  const kpis = (await q("SELECT live_version FROM platform.modules WHERE company=$1 AND name='kpis'", [A.slug])).rows[0];
  const held = (await q("SELECT detail FROM platform.events WHERE kind='module_import_held' AND ref=$1 ORDER BY id DESC LIMIT 1", [`${A.slug}/kpis`])).rows[0];
  t("a change to that library tool waits for the customer's manager to switch to it (the Terms, 9.1)", kpis.live_version === 1 && held && held.detail.why === "customer" && (await q("SELECT count(*)::int AS n FROM platform.module_versions WHERE company=$1 AND module='kpis'", [A.slug])).rows[0].n === 2, { kpis, held });

  // ---- the backup carries the new tables ---------------------------------------------------------------------------------------
  const bk = (await admin.get("/api/admin/backup")).json;
  t("the backup carries the acceptances, the notices and Stripe's events", Array.isArray(bk.platform.acceptances) && bk.platform.acceptances.length >= 5 && Array.isArray(bk.platform.notices) && Array.isArray(bk.platform.billing_events) && bk.platform.billing_events.length >= 2);
  const lateAcc = await www("/api/www/terms/accept", { slug: W.slug, kind: "topup", version: T.TERMS_VERSION, sha: T.termsHash(), ip: "192.0.2.77", ua: "e2e late" });
  const lateEv = await www("/api/www/billing-events", { event: { id: "evt_stage3_after_backup", type: "invoice.upcoming" }, subscription: { id: sA.stripe_subscription, status: "active", metadata: { site: sA.id } } });
  t("an acceptance and a Stripe event after the backup was taken", lateAcc.status === 200 && lateEv.status === 200);
  t("and the Terms' switch goes back off", (await admin.post("/api/admin/terms", { live: false })).json.live === false);

  // ---- a restore keeps the evidence and tells the paying sites (the Terms, 10.7 and 9.1). The server exits after it, so last ---
  const count = async (tb) => (await q(`SELECT count(*)::int AS n FROM platform.${tb}`)).rows[0].n;
  const nAcc = await count("acceptances"), nEv = await count("billing_events"), nTv = await count("terms_versions");
  const noWhyR = await admin.post("/api/admin/restore", { password: PW.admin, backup: bk });
  t("with paying sites a restore asks why first (the Terms, 9.1)", noWhyR.status === 400 && noWhyR.json.code === "admin_reason", noWhyR.json);
  const older = JSON.parse(JSON.stringify(bk));
  older.platform.sites = older.platform.sites.map((x) => (x.company === A.slug ? { ...x, stage: "demo" } : x));
  const behindR = await admin.post("/api/admin/restore", { password: PW.admin, backup: older, admin_reason: "broken", admin_note: "e2e: a bad deploy" });
  t("a file from before a site was switched on is refused unless the admin says restore anyway: Stripe would keep billing a demo", behindR.status === 409 && behindR.json.code === "sites_behind" && behindR.json.sites.includes(A.slug), behindR.json);
  const rs = await admin.post("/api/admin/restore", { password: PW.admin, backup: bk, admin_reason: "broken", admin_note: "e2e: a bad deploy" });
  t("the restore goes through", rs.status === 200 && rs.json.restarting === true, rs.json);
  t("the acceptances, Stripe's events and the terms versions are kept, none taken away and none doubled", (await count("acceptances")) === nAcc && (await count("billing_events")) === nEv && (await count("terms_versions")) === nTv
    && (await q("SELECT 1 FROM platform.acceptances WHERE ip='192.0.2.77'")).rows.length === 1 && (await q("SELECT 1 FROM platform.billing_events WHERE stripe_event='evt_stage3_after_backup'")).rows.length === 1, { nAcc, nEv, nTv });
  const told = (await q("SELECT company, text FROM platform.notices WHERE detail->>'restore' = 'true'")).rows;
  t("every paying site's manager is told on the board why, and no demo is", [A.slug, L.slug, F.slug].every((x) => told.some((n) => n.company === x)) && !told.some((n) => n.company === W.slug)
    && told.every((n) => /^Anetix put the platform back to a backup from \d{4}-\d{2}-\d{2} to fix an error that stopped the tool working: e2e: a bad deploy\. Your tools and their data are as they were then/.test(n.text)), told);
 } catch (e) { R.abort(e.stack || e); }
  server.close();
  R.done();
});
