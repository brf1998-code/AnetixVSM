// End to end for the 2026-10-05 pricing (src/sites.js BOOK_V2, src/modprice.js, src/pilot.js):
//   by the tool   a demo goes live at $300 a month for each tool live on its floor, the first month for the tools live
//                 that day; a tool made live moves the subscription to the next amount from the next bill (no
//                 proration), the manager and the phone are told; the cap holds; the Sites tab and Settings say it
//   a pilot       Anetix offers one company a pilot from the Sites tab; its manager sees Start your pilot with Go live
//                 switched OFF for everyone else; the order form and the price screen are the pilot's; Activate asks
//                 for a subscription that ends on its own; the end date is not a cancellation; Renew in the portal
//                 puts the end date back; a cancel a month early is a cancel; the end returns the site to a demo
// anetix.ai's private channel and the ntfy server are one stub in this process. Against a server ALREADY UP in
// fake-agent mode, on a fresh database, with SOS_WWW_KEY, SOS_WWW_URL, WWW_INTERNAL_URL, WWW_INTERNAL_KEY, NTFY_URL
// (the stub), NTFY_TOPIC and SOS_REPRICE_DELAY_MS=50 on the server (run-all.sh does it).
const http = require("http");
const { runner, client, login, PW, sleep } = require("./lib");
const { q } = require("../../src/db");
const totp = require("../../src/totp");
const R = runner(), t = R.t;
const BASE = process.env.SOS_E2E_BASE || "http://127.0.0.1:3999";
const KEY = process.env.SOS_WWW_KEY, IKEY = process.env.WWW_INTERNAL_KEY;
const STUB = new URL(process.env.WWW_INTERNAL_URL || "http://127.0.0.1:4013");
if (!KEY || !IKEY) { console.error("SOS_WWW_KEY and WWW_INTERNAL_KEY must be set in this shell and the server's"); process.exit(2); }

const stub = { calls: [], alerts: [], next: [], n: 0, repriceFail: 0, can: ["pilot", "reprice"], ends: new Map(), endFail: 0, repriceSame: true, held: new Map() };
const monthsOn = (sec, n) => { const d = new Date(sec * 1000); d.setUTCMonth(d.getUTCMonth() + n); return Math.floor(d.getTime() / 1000); };
const server = http.createServer((req, res) => {
  let raw = ""; req.on("data", (d) => { raw += d; });
  req.on("end", () => {
    const send = (status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
    const body = raw ? JSON.parse(raw) : {};
    if (req.url === "/" && req.method === "POST") { stub.alerts.push(body); return send(200, { id: "ntfy" }); }
    if (req.headers["x-www-internal-key"] !== IKEY) return send(401, { error: "internal key required" });
    stub.calls.push({ path: req.url, body });
    if (req.url === "/internal/ping") return send(200, { ok: true, stripe: "test", tax: false, webhook: true, can: stub.can });
    if (req.url === "/internal/activate") {
      const scripted = stub.next.shift(); if (scripted) return send(scripted.status, scripted.body);
      const n = ++stub.n, now = Math.floor(Date.now() / 1000);
      if (body.cancel_after_months) stub.ends.set(`sub_price_${n}`, monthsOn(now, body.cancel_after_months));
      stub.held.set(`sub_price_${n}`, body.price.unit_amount);
      return send(200, { ok: true, resumed: false, price_id: `price_${body.price.lookup_key}`, balance_txn: null,
        subscription: { id: `sub_price_${n}`, status: "active", metadata: body.metadata, current_period_start: now, current_period_end: monthsOn(now, 1), cancel_at_period_end: false, cancel_at: body.cancel_after_months ? monthsOn(now, body.cancel_after_months) : null } });
    }
    if (req.url === "/internal/reprice") {
      if (stub.repriceFail > 0) { stub.repriceFail--; return send(502, { error: "Stripe is down" }); }
      const same = stub.held.get(body.subscription) === body.price.unit_amount;   // what "Stripe" holds, like anetix.ai's own answer
      stub.held.set(body.subscription, body.price.unit_amount);
      return send(200, { ok: true, same, price_id: `price_${body.price.lookup_key}`, subscription: { id: body.subscription, status: "active" } });
    }
    if (req.url === "/internal/pilot-end") {   // anetix.ai works the date out itself, from the subscription
      if (stub.endFail > 0) { stub.endFail--; return send(502, { error: "Stripe is down" }); }
      if (!stub.ends.has(body.subscription)) return send(409, { error: "that subscription is not a pilot" });
      return send(200, { ok: true, same: false, subscription: { id: body.subscription, status: "active", cancel_at: stub.ends.get(body.subscription) } });
    }
    if (req.url === "/internal/end") return send(200, { ok: true, subscription: { id: body.subscription, status: "canceled" }, voided: [] });
    if (["/internal/detach", "/internal/reverse-balance", "/internal/cancel", "/internal/abandon"].includes(req.url)) return send(200, { ok: true });
    send(404, { error: "not found" });
  });
});
const callsTo = (p) => stub.calls.filter((c) => c.path === p);
const waitFor = async (fn, ms = 6000) => { for (let i = 0; i < ms / 100; i++) { const v = await fn(); if (v) return v; await sleep(100); } return null; };
const waitAlert = (rx) => waitFor(() => stub.alerts.find((a) => rx.test(`${a.title} ${a.message}`)));

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
  const email = `p${Date.now().toString(36)}${++demoN}@pricing.test`;
  const pin = (await admin.post("/api/admin/pins", { label: `${name} pin`, email, max_uses: 1, days: 30 })).json.pin.shown;
  const password = "copper-oak-2201-press";
  const made = await www("/api/www/companies", { pin, email, name, contact: "Arthur Stone", ref: `pricing:${pin}`, paid_usd: 0, credit_usd: 10, password, demo: true, collect: true });
  const slug = made.json.company.slug;
  const mgr = client();
  await mgr.post("/login", { name: email, password });
  const es = await mgr.post(`/api/c/${slug}/me/enroll/start`, {});
  await mgr.post(`/api/c/${slug}/me/enroll/verify`, { code: await codeFor(es.json.secret.replace(/\s/g, "")) });
  return { slug, mgr, email, name };
}
const tokenOf = (url) => new URL(url).searchParams.get("t");
const FACTS = {
  legal_name: "Chelsea Dial Works, LLC", site_name: "Chelsea Dial Works",
  site_address: { line1: "101 Second St", city: "Chelsea", state: "MA", postal_code: "02150" },
  headcount: 22, sqft: 15000,
  plant_manager: { name: "Arthur Stone", title: "Owner", email: "arthur@dial.test" },
  contact: { is_pm: true }, billing: { email: "ap@dial.test", same_as_site: true }, integrations: null, hardware: null, learning: false,
};
let cardN = 0;
const SIGNER = { name: "Arthur Stone", title: "Owner", email: "arthur@dial.test" };
async function cardFor(access, orderId, slug) {
  const n = ++cardN, cus = ((await q("SELECT stripe_customer FROM platform.sites WHERE company=$1", [slug])).rows[0] || {}).stripe_customer || `cus_price${n}`;
  await www("/api/www/golive/checkout", { access, stripe_customer: cus, setup_session: `cs_price${n}` });
  return www("/api/www/golive/card", { order: orderId, setup_session: `cs_price${n}`, stripe_customer: cus, payment_method: `pm_price${n}`, card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 } });
}
const site = async (slug) => (await q("SELECT * FROM platform.sites WHERE company=$1", [slug])).rows[0];
const order = async (id) => (await q("SELECT * FROM platform.orders WHERE id=$1", [id])).rows[0];
const row = async (admin, slug) => (await admin.get("/api/admin/sites")).json.rows.find((r) => r.slug === slug);
let evN = 0;
const event = (S, type, sub) => www("/api/www/billing-events", { event: { id: `evt_price_${++evN}_${Date.now().toString(36)}`, type }, subscription: { id: S.stripe_subscription, metadata: { site: S.id, order: S.order_id }, status: "active", current_period_start: Math.floor(new Date(S.period_start).getTime() / 1000), current_period_end: Math.floor(new Date(S.period_end).getTime() / 1000), cancel_at_period_end: false, cancel_at: null, ...sub } });

server.listen(Number(STUB.port), "127.0.0.1", async () => {
 try {
  const admin = await login(PW.admin);
  await admin.post("/api/admin/credit", { balance_usd: 100, autofill: true, note: "e2e" });

  // ======== the price book ================================================================================================
  const tab = (await admin.get("/api/admin/sites")).json;
  t("the Sites tab is on price book 2: $300 a tool, one at least, the caps and the tools that reach them", tab.book.version === 2 && tab.book.per_tool_usd === 300 && tab.book.min_tools === 1 && tab.book.bands.map((b) => `${b.monthly_usd}:${b.tools_at_cap}`).join(",") === "1000:4,1750:6,2500:9,3500:12,5000:17", tab.book);
  const books = (await q("SELECT version FROM platform.price_books ORDER BY version")).rows.map((r) => r.version);
  t("both versions are kept, so an order signed under version 1 still reads its own", books.join(",") === "1,2", books);
  const qt = (await admin.post("/api/admin/sites/quote", { headcount: 22, sqft: 15000 })).json.band;
  t("the quick quote says the price of a tool and the cap", qt.per_tool_usd === 300 && qt.monthly_usd === 1000 && qt.key === "small", qt);

  // ======== a pilot, with Go live switched OFF for customers ==============================================================
  const C = await makeDemo(admin, "Chelsea Dial Works");
  const other = await makeDemo(admin, "No Offer Co");
  t("Go live is off: a demo with no offer sees nothing", (await C.mgr.get(`/api/c/${C.slug}/board`)).json.golive === null && (await other.mgr.get(`/api/c/${other.slug}/board`)).json.golive === null);
  const of0 = (await admin.get(`/api/admin/sites/${C.slug}/offer`)).json;
  t("the Sites tab starts an offer at $1,000 a month for 2 months with the pilot's usual lines", of0.offer === null && of0.defaults.monthly_usd === 1000 && of0.defaults.months === 2 && of0.defaults.lines.length >= 4, of0);
  t("a manager cannot make itself an offer, nor read one", (await C.mgr.post(`/api/admin/sites/${C.slug}/offer`, { monthly_usd: 1, months: 1 })).status >= 401 && (await C.mgr.get(`/api/admin/sites/${C.slug}/offer`)).status >= 401);
  t("a bad offer is refused in words", (await admin.post(`/api/admin/sites/${C.slug}/offer`, { monthly_usd: 0, months: 2 })).status === 400 && (await admin.post(`/api/admin/sites/${C.slug}/offer`, { monthly_usd: 1000, months: 2, lines: [{ label: "Fee", text: "free forever" }] })).status === 400);
  const LINES = [{ label: "On site", text: "Anetix will be at the Site as much as needed to get the pilot running, then about 4 hours a week." }, { label: "Integrations", text: "Anetix will work on connecting QuickBooks, Fishbowl and HubSpot at no additional charge" }, { label: "Case study", text: "Nothing is published without Customer's approval." }];
  await admin.post(`/api/admin/sites/${C.slug}`, { legal_name: FACTS.legal_name, site_name: FACTS.site_name, site_address: FACTS.site_address, plant_manager: FACTS.plant_manager, headcount: 22, sqft: 15000 });
  const made = await admin.post(`/api/admin/sites/${C.slug}/offer`, { monthly_usd: "1,000", months: 2, lines: LINES });
  t("Brendan offers the pilot: kept on the site, with the order form it will make", made.status === 200 && made.json.offer.monthly_usd === 1000 && made.json.offer.months === 2 && /^ANETIX PILOT ORDER FORM/.test(made.json.preview) && /QuickBooks, Fishbowl and HubSpot at no additional charge\./.test(made.json.preview) && /Customer: Chelsea Dial Works, LLC\./.test(made.json.preview), made.json);
  const rowC = await row(admin, C.slug);
  t("the Sites tab's row says a pilot is offered", rowC.offer && rowC.offer.line === "$1,000 a month for 2 months, $2,000 in all" && rowC.pilot === null, rowC.offer);
  const bC = (await C.mgr.get(`/api/c/${C.slug}/board`)).json.golive;
  t("its manager sees Start your pilot on the board, with the fee and that it ends on its own, though Go live is off", bC && bC.pilot === true && bC.action === "Start your pilot" && /Anetix has a pilot ready for you to sign: \$1,000 a month for 2 months, \$2,000 in all\. It ends on its own\./.test(bC.line) && /\/c\/[^/]+\/go-live\?t=/.test(bC.url), bC);
  t("Settings' card says the same", /Anetix has offered this site a pilot: \$1,000 a month for 2 months/.test((await C.mgr.get(`/api/c/${C.slug}/golive`)).json.golive.pitch));
  t("the demo with no offer still sees nothing", (await other.mgr.get(`/api/c/${other.slug}/board`)).json.golive === null);
  const access = { slug: C.slug, t: tokenOf(bC.url) };
  const v0 = await www("/api/www/golive/view", { access });
  t("anetix.ai opens for it: a pilot, with what Brendan knows filled in", v0.status === 200 && v0.json.pilot === true && v0.json.offer.line === rowC.offer.line && v0.json.words.kicker === "Your pilot" && v0.json.prefill.legal_name === FACTS.legal_name && v0.json.prefill.headcount === 22, v0.json);
  const otherLink = require("../../src/golive").goliveToken(other.slug, (await q("INSERT INTO platform.sites (id, company) VALUES (gen_random_uuid(), $1) ON CONFLICT (company) DO UPDATE SET company=EXCLUDED.company RETURNING id", [other.slug])).rows[0].id);
  t("a customer's link for a company with no offer is still refused while Go live is off", (await www("/api/www/golive/view", { access: { slug: other.slug, t: otherLink } })).status === 404);
  const saved = await www("/api/www/golive/save", { access, fields: FACTS });
  const o = saved.json.order;
  t("the draft is priced by the offer, not the price book", saved.status === 200 && o.pilot === true && o.price_usd === 1000 && o.band.key === "pilot" && o.band.pilot.months === 2 && o.pricing.kind === "pilot" && o.pricing.big === "$1,000" && /It ends on its own/.test(o.pricing.big_note) && o.pricing.how.length === 3, o);
  t("the order form is the pilot's, with the site's facts and the offer's lines", /^ANETIX PILOT ORDER FORM/.test(o.text) && /\$1,000 a month for 2 months, \$2,000 in all/.test(o.text) && /\$1,000 on the day Anetix switches the Site on and \$1,000 one month later/.test(o.text) && /not a software license or subscription fee/.test(o.text) && /On site: Anetix will be at the Site/.test(o.text) && /Site: Chelsea Dial Works, 101 Second St, Chelsea, MA 02150\./.test(o.text), o.text);
  t("the board says the pilot is waiting to be finished", /Continue with your pilot/.test((await C.mgr.get(`/api/c/${C.slug}/board`)).json.golive.action));
  // Brendan changes the offer while the draft is open: the page's version and hash no longer sign
  const changed = await admin.post(`/api/admin/sites/${C.slug}/offer`, { monthly_usd: 1000, months: 2, lines: [...LINES, { label: "Hardware", text: "The pilot runs on equipment Customer already has" }] });
  const staleSign = await www("/api/www/golive/sign", { access, version: o.version, sha: o.sha, signer: SIGNER, authority: true, ip: "198.51.100.4", ua: "e2e" });
  t("an offer changed while the order is open: the old page cannot sign, and is asked to look again", changed.status === 200 && staleSign.status === 409 && staleSign.json.code === "changed", staleSign.json);
  const o2 = (await www("/api/www/golive/view", { access })).json.order;
  t("the order read again carries the new line", /Hardware: The pilot runs on equipment Customer already has\./.test(o2.text) && o2.version > o.version);
  const signed = await www("/api/www/golive/sign", { access, version: o2.version, sha: o2.sha, signer: SIGNER, authority: true, ip: "198.51.100.4", ua: "e2e" });
  t("the manager signs the pilot", signed.status === 200 && signed.json.order.state === "signed" && signed.json.order.pricing.kind === "pilot", signed.json);
  t("a signed order's offer cannot change under it", (await admin.post(`/api/admin/sites/${C.slug}/offer`, { monthly_usd: 5000, months: 12 })).status === 409 && (await admin.post(`/api/admin/sites/${C.slug}/offer`, { clear: true })).status === 409);
  const card = await cardFor(access, o.id, C.slug);
  const oC = await order(o.id);
  t("signed with its card: the order keeps the offer as signed, and the phone hears a pilot", card.json.applied === true && (await site(C.slug)).stage === "signed" && oC.band.key === "pilot" && oC.band.pilot.lines.length === 4 && Number(oC.price_usd) === 1000 && Boolean(await waitAlert(/Signed order/)) && /a pilot, \$1,000 a month for 2 months/.test((await waitAlert(/Signed order/)).message), (await waitAlert(/Signed order/)));
  t("the board says the pilot order is in", /Your pilot order is in/.test((await C.mgr.get(`/api/c/${C.slug}/board`)).json.golive.line));
  const chk = (await admin.get(`/api/admin/sites/${C.slug}/checks`)).json;
  t("Activate's panel says what is charged and that it ends on its own", chk.ready === true && chk.charge.usd === 1000 && chk.charge.plan === "pilot" && chk.plan.some((x) => /A pilot: \$1,000 a month for 2 months, \$2,000 in all\. \$1,000 is charged now, and \$1,000 on the same day of next month\. Stripe ends it on its own 2 months from today and nothing is charged after that\./.test(x)) && chk.plan.some((x) => /fair-use line is \$800 a month/.test(x)), chk.plan);
  // a tool goes live in the demo first: a pilot's fee does not follow tools
  await admin.post(`/api/admin/companies/${C.slug}/modules`, { module: "paperline" });
  stub.can = [];   // an anetix.ai from before today: it would take the fee on a subscription with no end
  const old = await admin.post(`/api/admin/sites/${C.slug}/activate`, { password: PW.admin, test_mode_ok: true });
  t("an older anetix.ai cannot end a pilot on its own: Activate refuses, nothing is sent, the order still waits", old.status === 409 && old.json.code === "www_old" && callsTo("/internal/activate").length === 0 && (await site(C.slug)).stage === "signed", old.json);
  stub.can = ["pilot", "reprice"];
  const act = await admin.post(`/api/admin/sites/${C.slug}/activate`, { password: PW.admin, test_mode_ok: true });
  const sent = callsTo("/internal/activate").pop().body;
  t("Activate asks anetix.ai for $1,000 on the pilot's own Price, ending on its own after 2 months", act.status === 200 && act.json.activated === true && sent.price.unit_amount === 100000 && sent.price.lookup_key === "anetix_pilot_100000" && sent.price.name === "Anetix pilot" && sent.cancel_after_months === 2 && sent.metadata.plan === "pilot" && sent.metadata.pilot_months === "2", { act: act.json, sent });
  const sC = await site(C.slug);
  const twoMonths = Math.abs(new Date(sC.cancel_at).getTime() - new Date(sC.period_start).getTime() - 61 * 86400e3) < 2 * 86400e3;
  t("the site is a paying site on a pilot: $1,000, its end date kept from the start, the offer cleared", sC.stage === "subscribed" && Number(sC.price_usd) === 1000 && sC.band.key === "pilot" && sC.band.pilot.ends_at && twoMonths && sC.offer === null && act.json.charged_usd === 1000 && Boolean(act.json.ends_at), { cancel_at: sC.cancel_at, band: sC.band });
  const rC = await row(admin, C.slug);
  t("the Sites tab: a pilot with its end date, not a cancellation, and no offer left", rC.pilot && rC.pilot.line === "$1,000 a month for 2 months, $2,000 in all" && Boolean(rC.pilot.ends_at) && rC.offer === null && (await admin.get("/api/admin/sites")).json.cancelling === 0, rC.pilot);
  const setC = (await C.mgr.get(`/api/c/${C.slug}/site`)).json;
  t("Settings: a pilot, the next payment and the day it ends", setC.pilot === true && /^A pilot: \$1,000 a month for 2 months, \$2,000 in all\. The next payment, \$1,000, is on .*It ends on its own on .*nothing is charged after that unless you and Anetix agree new terms\.$/.test(setC.summary), setC.summary);
  const bC2 = (await C.mgr.get(`/api/c/${C.slug}/board`)).json;
  t("the board: no Go live, no cancellation line, the floor's password waiting (it is a real site)", bC2.golive === null && bC2.billing === null && bC2.welcome && bC2.welcome.ready === true && bC2.company.demo === false, { billing: bC2.billing });
  await sleep(400);
  t("a pilot is never repriced by its tools (one is live)", callsTo("/internal/reprice").length === 0 && Number((await site(C.slug)).price_usd) === 1000);
  const endSec = Math.floor(new Date(sC.cancel_at).getTime() / 1000);
  const e1 = await event(sC, "customer.subscription.updated", { cancel_at: endSec });
  t("Stripe's event with the planned end date: nobody is told the site cancelled", e1.status === 200 && !e1.json.applied.ended_now && !stub.alerts.some((a) => /A site cancelled/.test(a.title)) && (await q("SELECT 1 FROM platform.events WHERE kind='site_cancel_set' AND ref=$1", [C.slug])).rows.length === 0, e1.json);
  const late = await event(sC, "invoice.payment_failed", { status: "past_due", cancel_at: endSec });
  t("a late second payment is retried like any other: the pilot is not ended at once", late.json.applied.standing === "past_due" && !late.json.applied.ended_now && (await site(C.slug)).stage === "subscribed" && callsTo("/internal/end").length === 0, late.json);
  await event(sC, "invoice.paid", { status: "active", cancel_at: endSec });
  // Renew pressed in the billing portal clears the end date at Stripe
  stub.endFail = 1;
  const renewFail = await www("/api/www/billing-events", { event: { id: "evt_price_renew_1", type: "customer.subscription.updated" }, subscription: { id: sC.stripe_subscription, metadata: { site: sC.id, order: sC.order_id }, status: "active", current_period_start: Math.floor(new Date(sC.period_start).getTime() / 1000), current_period_end: Math.floor(new Date(sC.period_end).getTime() / 1000), cancel_at_period_end: false, cancel_at: null } });
  t("the end date cleared at Stripe and anetix.ai down: the event is NOT taken as handled, so Stripe sends it again, and the phone rings", renewFail.status === 503 && (await q("SELECT 1 FROM platform.billing_events WHERE stripe_event='evt_price_renew_1'")).rows.length === 0 && Boolean(await waitAlert(/no end date at Stripe/)), renewFail);
  const renew = await www("/api/www/billing-events", { event: { id: "evt_price_renew_1", type: "customer.subscription.updated" }, subscription: { id: sC.stripe_subscription, metadata: { site: sC.id, order: sC.order_id }, status: "active", current_period_start: Math.floor(new Date(sC.period_start).getTime() / 1000), current_period_end: Math.floor(new Date(sC.period_end).getTime() / 1000), cancel_at_period_end: false, cancel_at: null } });
  const put = callsTo("/internal/pilot-end").pop();
  t("delivered again (Renew in the portal): the end date goes back on, worked out by anetix.ai, and Anetix is told", renew.json.applied.pilot_end_kept === true && put && put.body.cancel_at === undefined && put.body.subscription === sC.stripe_subscription && put.body.site === sC.id && Boolean(await waitAlert(/end date was put back/)) && new Date((await site(C.slug)).cancel_at).getTime() === new Date(sC.cancel_at).getTime(), { renew: renew.json, put });
  // the sweep keeps the date too, whatever happened to the event: asked every pass, and the site takes the exact date
  const M0 = require("../../src/modprice");
  await q("UPDATE platform.sites SET cancel_at = cancel_at - interval '3 seconds', band = jsonb_set(band, '{pilot,ends_at}', to_jsonb((cancel_at - interval '3 seconds')::text)) WHERE id=$1", [sC.id]);
  const kept = await M0.pilotKeep(C.slug);
  t("the sweep asks anetix.ai to keep the pilot's end date, and the site takes the exact one it answers", kept.ends_at && new Date((await site(C.slug)).cancel_at).getTime() === endSec * 1000 && new Date((await site(C.slug)).band.pilot.ends_at).getTime() === endSec * 1000, kept);
  // the last week
  await q("UPDATE platform.sites SET cancel_at = now() + interval '5 days', band = jsonb_set(band, '{pilot,ends_at}', to_jsonb((now() + interval '5 days')::text)) WHERE id=$1", [sC.id]);
  const M = require("../../src/modprice");
  const told1 = await M.pilotHeadsUp(await site(C.slug)), told2 = await M.pilotHeadsUp(await site(C.slug));
  t("a week before the pilot ends Anetix is told, once", told1 === true && told2 === false && (await q("SELECT count(*)::int AS n FROM platform.events WHERE kind='pilot_ending_told' AND ref=$1", [C.slug])).rows[0].n === 1);
  const bC3 = (await C.mgr.get(`/api/c/${C.slug}/board`)).json.billing;
  t("in its last two weeks the manager's board says when it ends and that nothing is charged after", bC3 && bC3.level === "note" && /on a pilot until/.test(bC3.text) && /nothing is charged after it/.test(bC3.text), bC3);
  // the end date comes: Stripe ends it
  await q("UPDATE platform.sites SET cancel_at = now() - interval '1 minute', band = jsonb_set(band, '{pilot,ends_at}', to_jsonb((now() - interval '1 minute')::text)) WHERE id=$1", [sC.id]);
  const over = await event(await site(C.slug), "customer.subscription.deleted", { status: "canceled", cancellation_reason: "cancellation_requested" });
  const sEnd = await site(C.slug);
  const notice = (await q("SELECT text FROM platform.notices WHERE company=$1 AND kind='back_to_demo' ORDER BY id DESC LIMIT 1", [C.slug])).rows[0];
  t("the pilot ends on its date: back to a demo, tools kept, and the notice says the pilot reached its end date", over.json.applied.returned === true && sEnd.stage === "back_to_demo" && sEnd.stripe_subscription === null && notice && /This site's pilot has ended \(the pilot reached its end date\)/.test(notice.text) && (await q("SELECT live_version FROM platform.modules WHERE company=$1", [C.slug])).rows.length === 1, { applied: over.json, notice });
  const after = (await C.mgr.get(`/api/c/${C.slug}/board`)).json;
  t("after it: a demo again, and no pilot offer comes back by itself", after.company.demo === true && after.golive === null);

  // a pilot still running at Stripe an hour past its end (its end date lost for good): the sweep ends it
  const X = await makeDemo(admin, "Overrun Co");
  await admin.post(`/api/admin/sites/${X.slug}/offer`, { monthly_usd: 1000, months: 1, lines: [] });
  const accX = { slug: X.slug, t: tokenOf((await X.mgr.get(`/api/c/${X.slug}/board`)).json.golive.url) };
  const oX = (await www("/api/www/golive/save", { access: accX, fields: { ...FACTS, legal_name: "Overrun Co.", site_name: "Overrun" } })).json.order;
  await www("/api/www/golive/sign", { access: accX, version: oX.version, sha: oX.sha, signer: SIGNER, authority: true, ip: "198.51.100.4", ua: "e2e" });
  await cardFor(accX, oX.id, X.slug);
  await admin.post(`/api/admin/sites/${X.slug}/activate`, { password: PW.admin, test_mode_ok: true });
  await q("UPDATE platform.sites SET cancel_at = NULL, band = jsonb_set(band, '{pilot,ends_at}', to_jsonb((now() - interval '2 hours')::text)) WHERE company=$1", [X.slug]);
  const overrun = await M0.pilotKeep(X.slug);
  t("a pilot still subscribed past its end date is ended now: cancelled at Stripe, a demo again, and the phone rings", overrun.ended === true && callsTo("/internal/end").some((c) => c.body.site === (oX && (callsTo("/internal/activate").pop().body.site))) && (await site(X.slug)).stage === "back_to_demo" && Boolean(await waitAlert(/ended past its date/)), overrun);

  // a pilot cancelled early by the customer is a cancellation
  const E = await makeDemo(admin, "Early Out Co");
  await admin.post(`/api/admin/sites/${E.slug}/offer`, { monthly_usd: 750, months: 3, lines: [] });
  const accE = { slug: E.slug, t: tokenOf((await E.mgr.get(`/api/c/${E.slug}/board`)).json.golive.url) };
  const oE = (await www("/api/www/golive/save", { access: accE, fields: { ...FACTS, legal_name: "Early Out Co.", site_name: "Early Out" } })).json.order;
  t("three months at $750 reads its own dates", /\$750 a month for 3 months, \$2,250 in all/.test(oE.text) && /\$750 on the same day of each of the next 2 months/.test(oE.text));
  await www("/api/www/golive/sign", { access: accE, version: oE.version, sha: oE.sha, signer: SIGNER, authority: true, ip: "198.51.100.4", ua: "e2e" });
  await cardFor(accE, oE.id, E.slug);
  await admin.post(`/api/admin/sites/${E.slug}/activate`, { password: PW.admin, test_mode_ok: true });
  const sE = await site(E.slug);
  const early = await event(sE, "customer.subscription.updated", { cancel_at_period_end: true, cancel_at: Math.floor(new Date(sE.period_end).getTime() / 1000) });
  t("a pilot cancelled in the portal a month in: a cancel date like any other, and the phone hears it", sE.stage === "subscribed" && early.json.applied.cancel_at && Boolean(await waitAlert(/Early Out.* cancelled/)) && /subscription ends on/.test((await E.mgr.get(`/api/c/${E.slug}/board`)).json.billing.text), early.json);
  const gone = await event(await site(E.slug), "customer.subscription.deleted", { status: "canceled", cancellation_reason: "cancellation_requested" });
  t("and it ends then: back to a demo because the customer cancelled", gone.json.applied.returned === true && /the customer cancelled/.test((await q("SELECT text FROM platform.notices WHERE company=$1 AND kind='back_to_demo'", [E.slug])).rows[0].text));
  // an offer withdrawn before anything is signed
  const W = await makeDemo(admin, "Withdrawn Offer Co");
  await admin.post(`/api/admin/sites/${W.slug}/offer`, { monthly_usd: 1000, months: 2, lines: [] });
  const wUrl = (await W.mgr.get(`/api/c/${W.slug}/board`)).json.golive.url;
  const wDraft = (await www("/api/www/golive/save", { access: { slug: W.slug, t: tokenOf(wUrl) }, fields: FACTS })).json.order;   // they had started
  const wd = await admin.post(`/api/admin/sites/${W.slug}/offer`, { clear: true });
  const wOrder = await order(wDraft.id);
  t("an offer withdrawn with a draft open: the draft is priced by the book again, the board stops showing a pilot and its link stops opening (Go live is off)", wd.status === 200 && wd.json.offer === null && wDraft.band.key === "pilot" && wOrder.band.key === "small" && Number(wOrder.price_usd) === 300 && (await W.mgr.get(`/api/c/${W.slug}/board`)).json.golive === null && (await www("/api/www/golive/view", { access: { slug: W.slug, t: tokenOf(wUrl) } })).status === 404, wOrder.band);

  // ---- Anetix runs the company and the customer only signs: the manager (Anetix's own account on it) starts the pilot and
  // asks the owner to approve; the owner's link opens with no account and with Go live off, signs and takes the card
  const R2 = await makeDemo(admin, "Run For Them Co");
  await admin.post(`/api/admin/sites/${R2.slug}/offer`, { monthly_usd: 1000, months: 2, lines: [] });
  const accR = { slug: R2.slug, t: tokenOf((await R2.mgr.get(`/api/c/${R2.slug}/board`)).json.golive.url) };
  const oR = (await www("/api/www/golive/save", { access: accR, fields: { ...FACTS, legal_name: "Run For Them Co.", site_name: "Run For Them", contact: { is_pm: false, name: "Brendan Finn", title: "Anetix" }, billing: { email: "owner@runforthem.test", same_as_site: true } } })).json.order;
  const asked = await www("/api/www/golive/approver", { access: accR, approver: { name: "Arthur Stone", title: "Owner", email: "owner@runforthem.test" } });
  const apUrl = new URL(asked.json.order.approver.url);
  const accAp = { order: apUrl.pathname.split("/").pop(), t: apUrl.searchParams.get("t") };
  const apView = await www("/api/www/golive/view", { access: accAp });
  t("the owner's link opens the pilot with no account, though Go live is off for customers", asked.status === 200 && apView.status === 200 && apView.json.who === "approver" && apView.json.pilot === true && apView.json.order.pricing.kind === "pilot" && /^ANETIX PILOT ORDER FORM/.test(apView.json.order.text), { asked: asked.status, view: apView.status, err: apView.json.error });
  const apSign = await www("/api/www/golive/sign", { access: accAp, version: apView.json.order.version, sha: apView.json.order.sha, signer: { name: "Arthur Stone", title: "Owner", email: "owner@runforthem.test" }, authority: true, ip: "198.51.100.9", ua: "e2e" });
  const nR = ++cardN;
  const ckR = await www("/api/www/golive/checkout", { access: accAp, stripe_customer: `cus_price${nR}`, setup_session: `cs_price${nR}` });
  const cdR = await www("/api/www/golive/card", { order: oR.id, setup_session: `cs_price${nR}`, stripe_customer: `cus_price${nR}`, payment_method: `pm_price${nR}`, card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 } });
  const ordR = await order(oR.id);
  t("the owner signs and saves the card from that link: signed by the approver, waiting on Activate", apSign.status === 200 && ckR.status === 200 && cdR.json.applied === true && ordR.state === "signed" && ordR.signer.via === "approver" && ordR.signer.name === "Arthur Stone" && (await site(R2.slug)).stage === "signed", { sign: apSign.json.error, ck: ckR.json.error, card: cdR.json });
  t("after signing the owner's link still opens (the order is in), Go live still off", (await www("/api/www/golive/view", { access: accAp })).status === 200);
  const actR = await admin.post(`/api/admin/sites/${R2.slug}/activate`, { password: PW.admin, test_mode_ok: true });
  t("and Activate charges the pilot", actR.status === 200 && actR.json.charged_usd === 1000 && Boolean(actR.json.ends_at), actR.json);

  // ---- a company added by hand on /admin that Anetix runs for the customer (2026-10-06): onto the Sites tab, a pilot
  // offered, the order started from the company's own manager sign-in, the owner signs from the link, Activate
  const hand = await admin.post("/api/admin/companies", { slug: "hand-made", name: "Hand Made Clocks" });
  await admin.post("/api/admin/sites/hand-made/track", {});
  await admin.post("/api/admin/sites/hand-made", { legal_name: "Hand Made Clocks, LLC", site_name: "Hand Made Clocks", site_address: FACTS.site_address, plant_manager: FACTS.plant_manager, headcount: 22, sqft: 15000 });
  await admin.post("/api/admin/sites/hand-made/offer", { monthly_usd: 1000, months: 2, lines: [] });
  t("an admin looking at its board gets a preview link, never the customer's order", (await admin.get("/api/c/hand-made/board")).json.golive.preview === true);
  const hm = await login(hand.json.passwords.manager, "hand-made");
  const hgl = (await hm.get("/api/c/hand-made/board")).json.golive;
  const accH = { slug: "hand-made", t: tokenOf(hgl.url) };
  const hv = await www("/api/www/golive/view", { access: accH });
  t("its manager sign-in starts the real order, with what the Sites tab holds filled in", hgl.pilot === true && hgl.preview === false && hv.status === 200 && hv.json.preview === false && hv.json.prefill.legal_name === "Hand Made Clocks, LLC" && hv.json.company.demo === false, hv.json.error || hv.json.prefill);
  const oH = (await www("/api/www/golive/save", { access: accH, fields: { ...hv.json.prefill, contact: { is_pm: false, name: "Brendan Finn", title: "Anetix" }, billing: { email: "owner@handmade.test", same_as_site: true } } })).json.order;
  const askH = await www("/api/www/golive/approver", { access: accH, approver: { name: "Arthur Stone", title: "Owner", email: "owner@handmade.test" } });
  const apH = new URL(askH.json.order.approver.url), accApH = { order: apH.pathname.split("/").pop(), t: apH.searchParams.get("t") };
  const apvH = (await www("/api/www/golive/view", { access: accApH })).json;
  await www("/api/www/golive/sign", { access: accApH, version: apvH.order.version, sha: apvH.order.sha, signer: { name: "Arthur Stone", title: "Owner", email: "owner@handmade.test" }, authority: true, ip: "198.51.100.9", ua: "e2e" });
  const nH = ++cardN;
  await www("/api/www/golive/checkout", { access: accApH, stripe_customer: `cus_price${nH}`, setup_session: `cs_price${nH}` });
  await www("/api/www/golive/card", { order: oH.id, setup_session: `cs_price${nH}`, stripe_customer: `cus_price${nH}`, payment_method: `pm_price${nH}`, card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 } });
  const actH = await admin.post("/api/admin/sites/hand-made/activate", { password: PW.admin, test_mode_ok: true });
  const sH = await site("hand-made");
  // the floor's new password signs every shared-password session out, the manager's too: it signs in again
  const signedOut = (await hm.get("/api/c/hand-made/board")).status === 401;
  const hm2 = await login(hand.json.passwords.manager, "hand-made");
  const bH = (await hm2.get("/api/c/hand-made/board")).json;
  t("the owner signs from the link and Activate switches the by-hand company on as a pilot", actH.status === 200 && actH.json.charged_usd === 1000 && sH.stage === "subscribed" && sH.band.key === "pilot" && Boolean(sH.cancel_at) && signedOut && bH.welcome && bH.welcome.ready === true && bH.golive === null, { act: actH.json, stage: sH.stage, signedOut });
  const wH = await hm2.post("/api/c/hand-made/welcome", {});
  t("the floor's new password is handed to the manager sign-in once, and opens the floor", wH.status === 200 && Boolean(wH.json.floor) && (await client().post("/login", { password: wH.json.floor, company: "hand-made" })).status === 200, wH.json.error);

  // ======== by the tool ==================================================================================================
  await admin.post("/api/admin/golive", { open: true });
  const K = await makeDemo(admin, "Keystone Fab");
  const bK = (await K.mgr.get(`/api/c/${K.slug}/board`)).json.golive;
  t("Go live on a demo's board says $300 a tool and the first cap", bK.action === "Go live" && /\$300 a month for each tool live on the floor/.test(bK.from.line) && bK.from.short === "$300 a month a tool" && !bK.pilot, bK);
  t("Settings' card says it too", /\$300 a month for each tool live on your floor/.test((await K.mgr.get(`/api/c/${K.slug}/golive`)).json.golive.pitch));
  const accK = { slug: K.slug, t: tokenOf(bK.url) };
  const KF = { ...FACTS, legal_name: "Keystone Fab LLC", site_name: "Keystone Fab" };
  const oK = (await www("/api/www/golive/save", { access: accK, fields: KF })).json.order;
  t("no tool live: the draft is $300 (a site pays for one at least), a Small cap of $1,000", oK.price_usd === 300 && oK.band.key === "small" && oK.band.per_tool_usd === 300 && oK.band.monthly_usd === 1000 && oK.pricing.kind === "tools" && oK.pricing.big === "$300" && /0 tools live today, which is \$300 a month/.test(oK.text), oK);
  // a tool goes live before they sign: the page they have open is asked to look again
  await admin.post(`/api/admin/companies/${K.slug}/modules`, { module: "paperline" });
  await admin.post(`/api/admin/companies/${K.slug}/modules`, { module: "kpis" });
  const staleK = await www("/api/www/golive/sign", { access: accK, version: oK.version, sha: oK.sha, signer: SIGNER, authority: true, ip: "198.51.100.4", ua: "e2e" });
  t("two tools went live since the page was opened: the figure changed, so the old page cannot sign", staleK.status === 409 && staleK.json.code === "changed", staleK.json);
  const oK2 = (await www("/api/www/golive/view", { access: accK })).json.order;
  t("read again: 2 tools live, $600 a month", oK2.price_usd === 600 && /The Site has 2 tools live today, which is \$600 a month\./.test(oK2.text) && oK2.pricing.big === "$600", oK2.text);
  const sgK = await www("/api/www/golive/sign", { access: accK, version: oK2.version, sha: oK2.sha, signer: SIGNER, authority: true, ip: "198.51.100.4", ua: "e2e" });
  await cardFor(accK, oK.id, K.slug);
  const ordK = await order(oK.id);
  t("signed under price book 2 with the plan on the order", sgK.status === 200 && ordK.price_book === 2 && ordK.band.per_tool_usd === 300 && ordK.band.min_tools === 1 && Number(ordK.price_usd) === 600 && ordK.stripe.signed_tools === 2, ordK.band);
  t("the phone hears the fee today, the price of a tool and the cap", /Small site at \$600 a month today \(\$300 a tool, cap \$1,000\)/.test((await waitAlert(/Signed order[\s\S]*Keystone/)).message));
  const chkK = (await admin.get(`/api/admin/sites/${K.slug}/checks`)).json;
  t("Activate's panel: 2 live today, $600 charged now, the fair-use line at 80% of it", chkK.charge.usd === 600 && chkK.charge.tools === 2 && chkK.plan.some((x) => /\$300 a tool, 2 live today, so \$600 is charged now/.test(x)) && chkK.plan.some((x) => /fair-use line is \$480 a month/.test(x)), chkK.plan);
  const actK = await admin.post(`/api/admin/sites/${K.slug}/activate`, { password: PW.admin, test_mode_ok: true });
  const sentK = callsTo("/internal/activate").pop().body;
  t("Activate charges the tools live that day: $600, on the Price for that amount, with no end date", actK.status === 200 && sentK.price.unit_amount === 60000 && sentK.price.lookup_key === "anetix_tools_v2_60000" && sentK.cancel_after_months === undefined && sentK.metadata.plan === "tools" && sentK.metadata.tools === "2" && actK.json.charged_usd === 600 && actK.json.ends_at === null, sentK);
  let sK = await site(K.slug);
  t("the site pays $600, with the plan it signed", sK.stage === "subscribed" && Number(sK.price_usd) === 600 && sK.band.per_tool_usd === 300 && Number(sK.band.monthly_usd) === 1000 && sK.cancel_at === null && sK.price_book === 2);
  const fK = (await row(admin, K.slug));
  t("the Sites tab: $600 a month, 2 live, the fair-use line at $480", fK.fee.usd === 600 && fK.tools_live === 2 && fK.fair_use.line_usd === 480 && fK.band.per_tool_usd === 300, { fee: fK.fee, fair: fK.fair_use });
  t("Settings says the fee in the product's words", /^\$600 a month: \$300 for each tool live on your floor \(2 tools now\), never more than \$1,000\./.test((await K.mgr.get(`/api/c/${K.slug}/site`)).json.summary));
  await sleep(400);
  t("nothing to move yet: no call to anetix.ai", callsTo("/internal/reprice").length === 0);
  // a third tool: made in the product the way a built tool is, then made live
  const third = async (name) => {
    await q("INSERT INTO platform.modules (company, name, title, live_version) VALUES ($1,$2,$2,1)", [K.slug, name]);
    return require("../../src/modprice").sync(K.slug);
  };
  stub.repriceFail = 1;
  const failed = await third("mo-board");
  t("anetix.ai down when the third tool goes live: nothing changes yet, and it says so", failed.error && Number((await site(K.slug)).price_usd) === 600 && (await row(admin, K.slug)).fee.due_usd === 900, failed);
  const moved = await require("../../src/modprice").sync(K.slug);
  const rp = callsTo("/internal/reprice").pop().body;
  sK = await site(K.slug);
  t("the next look catches up: the subscription moves to $900 from the next bill", moved.moved === true && moved.from_usd === 600 && moved.to_usd === 900 && rp.subscription === sK.stripe_subscription && rp.site === sK.id && rp.price.unit_amount === 90000 && rp.price.lookup_key === "anetix_tools_v2_90000" && rp.metadata.tools === "3" && Number(sK.price_usd) === 900, { moved, rp });
  const nK = (await q("SELECT text FROM platform.notices WHERE company=$1 AND kind='repriced' ORDER BY id DESC LIMIT 1", [K.slug])).rows[0];
  t("the manager is told on the board: the count, the amount, the date, nothing charged before", nK && /^3 tools are live on your floor now\. From your next bill on .* this site is \$900 a month, up from \$600\. \(\$300 a tool, never more than \$1,000\)\. Nothing is charged before then\.$/.test(nK.text) && (await K.mgr.get(`/api/c/${K.slug}/board`)).json.notices.some((n) => /3 tools are live/.test(n.text)), nK);
  t("and the phone, and the record", Boolean(await waitAlert(/bill went up[\s\S]*3 tools live, so \$900 a month/)) && (await q("SELECT 1 FROM platform.record WHERE company=$1 AND kind='site_repriced'", [K.slug])).rows.length === 1 && (await q("SELECT detail FROM platform.events WHERE kind='site_repriced' AND ref=$1", [K.slug])).rows[0].detail.to_usd === 900);
  t("the fair-use line follows the fee: $720", (await row(admin, K.slug)).fair_use.line_usd === 720);
  const before = callsTo("/internal/reprice").length;
  const same = await require("../../src/modprice").sync(K.slug);
  t("looking again changes nothing and calls nobody", same.same === true && callsTo("/internal/reprice").length === before);
  const cap = await third("ncr-log");
  t("the fourth tool reaches the cap: $1,000, and the notice says every tool past it is included", cap.moved && cap.to_usd === 1000 && /That is this site's cap: every tool past it is included\./.test((await q("SELECT text FROM platform.notices WHERE company=$1 AND kind='repriced' ORDER BY id DESC LIMIT 1", [K.slug])).rows[0].text), cap);
  const fifth = await third("shift-notes");
  t("a fifth tool costs nothing more: no call, no notice", fifth.same === true && fifth.usd === 1000 && Number((await site(K.slug)).price_usd) === 1000 && (await q("SELECT count(*)::int AS n FROM platform.notices WHERE company=$1 AND kind='repriced'", [K.slug])).rows[0].n === 2);
  await q("DELETE FROM platform.modules WHERE company=$1 AND name IN ('ncr-log','shift-notes','mo-board')", [K.slug]);
  const down = await require("../../src/modprice").sync(K.slug);
  t("tools taken off the floor bring it down from the next bill", down.moved && down.from_usd === 1000 && down.to_usd === 600 && /down from \$1,000/.test((await q("SELECT text FROM platform.notices WHERE company=$1 AND kind='repriced' ORDER BY id DESC LIMIT 1", [K.slug])).rows[0].text));
  // every Stripe event for the site is a chance to catch up
  await q("INSERT INTO platform.modules (company, name, title, live_version) VALUES ($1,'andon','andon',1)", [K.slug]);
  const n0 = callsTo("/internal/reprice").length;
  await event(await site(K.slug), "invoice.paid", { status: "active" });
  t("a Stripe event catches the bill up with the tools", Boolean(await waitFor(async () => callsTo("/internal/reprice").length > n0 && Number((await site(K.slug)).price_usd) === 900)));
  t("the sweep finds nothing left to move", (await require("../../src/modprice").sweep()).moved === 0);
  // a request that timed out here and landed at Stripe late: this table says $900 and so do the tools, Stripe holds another amount
  stub.held.set((await site(K.slug)).stripe_subscription, 120000);
  const n1 = callsTo("/internal/reprice").length;
  const swept = await require("../../src/modprice").sweep();
  const fix = callsTo("/internal/reprice").slice(n1).find((c) => c.body.site === (sK.id));
  t("the sweep checks Stripe itself, not this table: an amount that drifted there is put right, with nothing told to the manager", swept.corrected === 1 && fix && fix.body.price.unit_amount === 90000 && stub.held.get(sK.stripe_subscription) === 90000 && (await q("SELECT 1 FROM platform.events WHERE kind='site_reprice_corrected' AND ref=$1", [K.slug])).rows.length === 1, swept);
  // a tool made live through the board's own deploy path asks on its own (registry.deployVersion): covered by the
  // library add above, which goes through the same hook

  // ======== an order signed under price book 1 keeps its flat price =======================================================
  const O = await makeDemo(admin, "Old Book Co");
  const accO = { slug: O.slug, t: tokenOf((await O.mgr.get(`/api/c/${O.slug}/board`)).json.golive.url) };
  const oO = (await www("/api/www/golive/save", { access: accO, fields: { ...FACTS, legal_name: "Old Book Co.", site_name: "Old Book" } })).json.order;
  await www("/api/www/golive/sign", { access: accO, version: oO.version, sha: oO.sha, signer: SIGNER, authority: true, ip: "198.51.100.4", ua: "e2e" });
  await cardFor(accO, oO.id, O.slug);
  // as if it had been signed before today: the band a version 1 order kept, at its flat price
  await q("UPDATE platform.orders SET price_book=1, price_usd=1000, band='{\"key\":\"small\",\"name\":\"Small\",\"min\":1,\"max\":49,\"monthly_usd\":1000,\"book\":1}'::jsonb WHERE id=$1", [oO.id]);
  const actO = await admin.post(`/api/admin/sites/${O.slug}/activate`, { password: PW.admin, test_mode_ok: true });
  const sentO = callsTo("/internal/activate").pop().body;
  t("an order signed under price book 1 is charged its band's flat price on its own Price", actO.status === 200 && sentO.price.unit_amount === 100000 && sentO.price.lookup_key === "anetix_site_small_v1_100000" && sentO.metadata.plan === "flat" && Number((await site(O.slug)).price_usd) === 1000, sentO);
  await q("INSERT INTO platform.modules (company, name, title, live_version) VALUES ($1,'andon','andon',1)", [O.slug]);
  t("and tools never move it", (await require("../../src/modprice").sync(O.slug)).skipped === true);

  t("no alert carried an email address", stub.alerts.every((a) => !/@/.test(`${a.title} ${a.message}`)), stub.alerts.map((a) => a.message));
  t("nothing a manager read named a payment vendor's internals or a model", !(await q("SELECT text FROM platform.notices")).rows.some((r) => /price_|sub_|Claude|Anthropic/.test(r.text)));

  server.close(); R.done();
 } catch (e) { server.close(); R.abort(e); }
});
