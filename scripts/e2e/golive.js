// End to end for paid sites, stage 2 (src/golive.js): going live as far as Signed, driven the way anetix.ai drives it
// (the /api/www/golive/* routes with the shared key), plus the board, Settings and the Sites tab. Against a server
// ALREADY UP in fake-agent mode with SOS_WWW_KEY and SOS_WWW_URL set, on a fresh database (run-all.sh does it):
//   SOS_WWW_KEY=... SOS_WWW_URL=https://anetix.test node scripts/e2e/golive.js
// What it proves: Go live is dark until switched on (no link on the board, a customer's link refused, an admin's link
// working); the first answers start the order and move the site to Ordering; a save that changes nothing keeps the
// version; the band is the product's; the Sites tab's facts lock while the order is open; a signature needs the box
// ticked, the current version and the hash of the text shown, and two signers at once make one signature; the
// approver's link edits and signs the same order, dies when replaced and when the order is started over; the Stripe
// Customer is one per site; the first card wins and any other is answered detach; a signed order with no card can be
// started over, one with its card cannot; the board says the order is in; a deleted company's link dies even when
// its slug goes to the next company; switching Go live off closes the customers' links again.
const { runner, client, login, PW, sleep } = require("./lib");
const { q } = require("../../src/db");
const totp = require("../../src/totp");
const G = require("../../src/golive");
const T = require("../../src/terms");
const R = runner(), t = R.t;
const BASE = process.env.SOS_E2E_BASE || "http://127.0.0.1:3999";
const KEY = process.env.SOS_WWW_KEY;
const WWW = String(process.env.SOS_WWW_URL || "https://anetix.ai").replace(/\/+$/, "");
if (!KEY) { console.error("SOS_WWW_KEY must be set in this shell and the server's"); process.exit(2); }
const www = async (p, body, key = KEY) => {
  const r = await fetch(BASE + p, { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", ...(key ? { "X-SOS-WWW-Key": key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
async function codeFor(secretText) {
  const into = (Date.now() / 1000) % 30;
  if (into > 27.5) await sleep((30 - into) * 1000 + 300);
  return totp.hotp(totp.base32Decode(secretText), totp.stepAt());
}
// a personal demo made the way anetix.ai makes one, and its manager signed in with the authenticator set up
async function makeDemo(admin, name, email) {
  const pin = (await admin.post("/api/admin/pins", { label: `${name} pin`, email, max_uses: 1, days: 30 })).json.pin.shown;
  const password = "copper-oak-2201-press";
  const made = await www("/api/www/companies", { pin, email, name, contact: "Sam Ortiz", ref: `golive:${pin}`, paid_usd: 0, credit_usd: 10, password, demo: true, collect: true });
  const slug = made.json.company.slug;
  const mgr = client();
  await mgr.post("/login", { name: email, password });
  const es = await mgr.post(`/api/c/${slug}/me/enroll/start`, {});
  await mgr.post(`/api/c/${slug}/me/enroll/verify`, { code: await codeFor(es.json.secret.replace(/\s/g, "")) });
  return { slug, mgr, email };
}
const tokenOf = (url) => new URL(url).searchParams.get("t");
const FACTS = {
  legal_name: "Acme Wire & Cable, Inc.", site_name: "Acme Wire, Worcester",
  site_address: { line1: "40 Foundry Street", city: "Worcester", state: "MA", postal_code: "01608" },
  headcount: 140, sqft: 120000,
  plant_manager: { name: "Sam Ortiz", title: "Plant manager", email: "sam@acmewire.test" },
  contact: { is_pm: true }, billing: { email: "ap@acmewire.test", same_as_site: true }, integrations: "Epicor Kinetic", hardware: null, learning: true,
};

(async () => {
  const admin = await login(PW.admin);
  const A = await makeDemo(admin, `Acme Wire ${Date.now().toString(36).slice(-4)}`, `sam${Date.now().toString(36).slice(-5)}@acmewire.test`);

  // ---- dark until switched on
  const st0 = await admin.get("/api/admin/golive");
  t("Go live starts switched off, with the terms in effect and the key set", st0.status === 200 && st0.json.open === false && st0.json.terms_version === T.TERMS_VERSION && st0.json.terms_draft === false && st0.json.key_set === true, st0.json);
  const b0 = (await A.mgr.get(`/api/c/${A.slug}/board`)).json;
  t("while it is off the manager's board has no Go live link, and Settings' card has none", b0.golive === null && (await A.mgr.get(`/api/c/${A.slug}/golive`)).json.golive === null, b0.golive);
  const ab = (await admin.get(`/api/c/${A.slug}/board`)).json.golive;
  t("an admin looking at the demo's board gets an admin's link, marked preview", ab && ab.preview === true && ab.action === "Go live" && /\.a\.[A-Za-z0-9_-]{32}$/.test(tokenOf(ab.url)) && ab.url.startsWith(`${WWW}/c/${A.slug}/go-live?t=`), ab);
  const link = (await admin.get(`/api/admin/sites/${A.slug}/golive-link`)).json;
  t("the Sites tab hands out an admin's link, 24 hours", /\/go-live\?t=/.test(link.url || "") && link.expires_in_hours === 24, link);
  const siteId = tokenOf(link.url).split(".")[0];
  const aAdmin = { slug: A.slug, t: tokenOf(link.url) };
  const v0 = await www("/api/www/golive/view", { access: aAdmin });
  t("the admin's link opens the go-live view while it is off: the demo, the stage, what the form starts from", v0.status === 200 && v0.json.who === "manager" && v0.json.preview === true && v0.json.site.stage === "demo" && v0.json.order === null && v0.json.prefill && v0.json.prefill.site_name === v0.json.company.name && v0.json.prefill.billing.email === A.email && v0.json.prefill.contact.name === "Sam Ortiz", v0.json);
  t("and says which terms, where", v0.json.terms.version === T.TERMS_VERSION && v0.json.terms.url === `${WWW}/terms` && v0.json.terms.draft === false);
  const custTok = G.goliveToken(A.slug, siteId, { kind: "m" });
  t("a customer's link is refused while Go live is off", (await www("/api/www/golive/view", { access: { slug: A.slug, t: custTok } })).status === 404);
  t("nothing opens without the shared key", (await www("/api/www/golive/view", { access: aAdmin }, "wrong-key-0123456789abcdef")).status === 401 && (await www("/api/www/golive/view", { access: aAdmin }, "")).status === 401);
  t("a made-up link learns nothing", (await www("/api/www/golive/view", { access: { slug: A.slug, t: `${siteId}.4102444800.m.${"A".repeat(32)}` } })).status === 404 && (await www("/api/www/golive/view", { access: { slug: "no-such-co", t: custTok } })).status === 404);

  // ---- switched on
  const on = await admin.post("/api/admin/golive", { open: true });
  t("the admin switches it on", on.status === 200 && on.json.open === true, on.json);
  const b1 = (await A.mgr.get(`/api/c/${A.slug}/board`)).json.golive;
  t("beside it, what a site costs, from the price book, before any form (C7)", b1 && b1.from && b1.from.line === "A site is $300 a month for each tool live on the floor, and never more than its cap: $1,000 a month for under 50 people." && b1.from.short === "$300 a month a tool", b1 && b1.from);
  t("the manager's board now carries a customer's Go live link", b1 && b1.preview === false && b1.action === "Go live" && b1.stage === "demo" && /\.m\.[A-Za-z0-9_-]{32}$/.test(tokenOf(b1.url)) && tokenOf(b1.url).startsWith(siteId), b1);
  t("Settings' card carries the same", (await A.mgr.get(`/api/c/${A.slug}/golive`)).json.golive.url === b1.url);
  const showroom = (await (await login(PW.manager, "demo")).get("/api/c/demo/board")).json;
  t("a company that is not a demo gets no Go live link", showroom.golive === null);
  const M = { slug: A.slug, t: tokenOf(b1.url) };
  t("the customer's link opens the view now", (await www("/api/www/golive/view", { access: M })).json.preview === false);

  // ---- screen 1
  const bad = await www("/api/www/golive/save", { access: M, fields: { plant_manager: { name: "Sam", email: "not an email" } } });
  t("a bad email is refused and says why, and nothing is started", bad.status === 400 && /email does not look like one/.test(bad.json.error) && (await www("/api/www/golive/view", { access: M })).json.order === null, bad.json);
  const s1 = await www("/api/www/golive/save", { access: M, fields: { legal_name: FACTS.legal_name, headcount: 140 } });
  t("the first answers start the order: a draft, version 1, what it still needs", s1.status === 200 && s1.json.order && s1.json.order.state === "draft" && s1.json.order.version === 1 && s1.json.order.complete === false && s1.json.order.missing.some((m) => m.key === "sqft") && s1.json.order.text === null, s1.json.order);
  t("the site moves to Ordering", s1.json.site.stage === "ordering");
  t("the band is worked out by the product from the headcount", s1.json.order.band && s1.json.order.band.key === "core" && s1.json.order.band.monthly_usd === 2500 && s1.json.order.band.per_tool_usd === 300 && s1.json.order.price_usd === 300 && !("flags" in s1.json.order.band), s1.json.order.band);
  const s2 = await www("/api/www/golive/save", { access: M, fields: FACTS });
  t("all the answers: version 2, complete, the order form's text and its hash", s2.status === 200 && s2.json.order.version === 2 && s2.json.order.complete === true && /Customer: Acme Wire & Cable, Inc\./.test(s2.json.order.text) && /^[0-9a-f]{64}$/.test(s2.json.order.sha), s2.json.order);
  t("the text names the terms at anetix.ai and the credit back", s2.json.order.text.includes(`Anetix Terms of Service, version ${T.TERMS_VERSION}, at ${WWW}/terms, as updated under section 19.`) && /Unused demo credit/.test(s2.json.order.text));
  t("the text carries the billing email and the learning choice (the terms lean on both)", /Billing email: ap@acmewire\.test\./.test(s2.json.order.text) && /Learning: Customer opts in\./.test(s2.json.order.text));
  t("That's me: the plant manager's name and title are copied as the person going live", s2.json.order.facts.contact.is_pm === true && s2.json.order.facts.contact.name === "Sam Ortiz" && s2.json.order.facts.contact.title === "Plant manager");
  const s3 = await www("/api/www/golive/save", { access: M, fields: FACTS });
  // "That's me" ticked with the plant manager's boxes left empty (the launch audit, C8): filled from the account
  const BW = await makeDemo(admin, `Bolt Works ${Date.now().toString(36).slice(-4)}`, `pat${Date.now().toString(36).slice(-5)}@boltworks.test`);
  const bwl = (await BW.mgr.get(`/api/c/${BW.slug}/board`)).json.golive;
  const bws = await www("/api/www/golive/save", { access: { slug: BW.slug, t: tokenOf(bwl.url) }, fields: { ...FACTS, legal_name: "Bolt Works LLC", plant_manager: { name: "", title: "", email: "" }, contact: { is_pm: true } } });
  t("That's me with the boxes empty: the plant manager is the account going live, and nothing is left missing", bws.status === 200 && bws.json.order.facts.plant_manager.email === BW.email && bws.json.order.facts.plant_manager.name === "Sam Ortiz" && bws.json.order.complete === true && !bws.json.order.missing.some((m) => /plant manager/.test(m.text)), bws.json.order && { pm: bws.json.order.facts.plant_manager, missing: bws.json.order.missing });
  t("the same answers again keep the version (nobody is asked to look again for nothing)", s3.json.order.version === 2 && s3.json.order.sha === s2.json.order.sha);
  const row = (await admin.get("/api/admin/sites")).json.rows.find((r) => r.slug === A.slug);
  t("the Sites tab shows what the customer typed, and the open draft", row.stage === "ordering" && row.headcount === 140 && row.site_name === FACTS.site_name && row.plant_manager.email === FACTS.plant_manager.email && row.deal.integrations === "Epicor Kinetic" && row.billing.email === "ap@acmewire.test" && row.order && row.order.state === "draft" && row.order.version === 2 && row.order_open === true, row);
  const lockA = await admin.post(`/api/admin/sites/${A.slug}`, { headcount: 150 });
  t("while the order is open its facts cannot be changed from the Sites tab", lockA.status === 409 && /being filled in on anetix\.ai/.test(lockA.json.error), lockA.json);
  const noteA = await admin.post(`/api/admin/sites/${A.slug}`, { note: "Called Sam on Friday", deal: { approval_limit_usd: "5000" } });
  t("the note and the approval limit still can", noteA.status === 200 && noteA.json.site.note === "Called Sam on Friday" && noteA.json.site.deal.approval_limit_usd === 5000 && noteA.json.site.deal.integrations === "Epicor Kinetic", noteA.json);
  const wholeForm = await admin.post(`/api/admin/sites/${A.slug}`, { site_name: FACTS.site_name, headcount: "140", sqft: "120,000", site_address: FACTS.site_address, deal: { integrations: "Epicor Kinetic", hardware: "" }, note: "Called Sam on Friday. Sending the order." });
  t("and the whole form saved with the facts unchanged goes through", wholeForm.status === 200 && wholeForm.json.site.note === "Called Sam on Friday. Sending the order.", wholeForm.json);
  t("the version did not move for Brendan's note", (await www("/api/www/golive/view", { access: M })).json.order.version === 2);

  // ---- the approver
  const ap0 = await www("/api/www/golive/approver", { access: M, approver: { name: "D", email: "nope" } });
  t("naming an approver needs their name and email", ap0.status === 400 && /their name and their email/.test(ap0.json.error), ap0.json);
  const ap1 = await www("/api/www/golive/approver", { access: M, approver: { name: "Dana Lee", title: "CFO", email: "Dana@AcmeWire.test" } });
  const apUrl = ap1.json.order && ap1.json.order.approver && ap1.json.order.approver.url;
  t("someone else approves: a link for them, 14 days, only in the manager's view", ap1.status === 200 && ap1.json.order.approver.name === "Dana Lee" && ap1.json.order.approver.email === "dana@acmewire.test" && apUrl && apUrl.startsWith(`${WWW}/order/${ap1.json.order.id}?t=`) && Math.abs(new Date(ap1.json.order.approver.expires_at) - Date.now() - 14 * 86400e3) < 120e3, ap1.json.order.approver);
  const P = { order: ap1.json.order.id, t: tokenOf(apUrl) };
  const pv = await www("/api/www/golive/view", { access: P });
  t("the approver's link opens the same order with the answers in, and no link of its own", pv.status === 200 && pv.json.who === "approver" && pv.json.order.id === ap1.json.order.id && pv.json.order.facts.legal_name === FACTS.legal_name && pv.json.order.approver.url === null && pv.json.prefill === null && pv.json.me === null, pv.json);
  t("the board says who it waits on", (await A.mgr.get(`/api/c/${A.slug}/board`)).json.golive.waiting_on === "Dana Lee");
  t("the approver cannot name someone else or start it over", (await www("/api/www/golive/approver", { access: P, clear: true })).status === 403 && (await www("/api/www/golive/start-over", { access: P })).status === 403);
  const pedit = await www("/api/www/golive/save", { access: P, fields: { headcount: 160, contact: { is_pm: false, name: "Dana Lee" } } });
  t("the approver changes the headcount: version 3, and who is going live stays the manager's", pedit.status === 200 && pedit.json.order.version === 3 && pedit.json.order.facts.headcount === 160 && pedit.json.order.facts.contact.is_pm === true, pedit.json.order);
  const pmEdit = await www("/api/www/golive/save", { access: P, fields: { plant_manager: { name: "Dana Lee", title: "CFO", email: "dana@acmewire.test" } } });
  t("the approver renaming the plant manager does not rename the person going live", pmEdit.json.order.facts.plant_manager.name === "Dana Lee" && pmEdit.json.order.facts.contact.name === "Sam Ortiz" && pmEdit.json.order.version === 4, pmEdit.json.order.facts);
  await www("/api/www/golive/save", { access: P, fields: { plant_manager: FACTS.plant_manager } });
  const signer = { name: "Sam Ortiz", title: "Plant manager", email: "sam@acmewire.test" };
  const stale = await www("/api/www/golive/sign", { access: M, version: 2, sha: s2.json.order.sha, signer, authority: true, ip: "203.0.113.9", ua: "Test browser" });
  t("the manager's page from before the change cannot sign: look again", stale.status === 409 && stale.json.code === "changed" && /Look it over again/.test(stale.json.error), stale.json);
  const v3 = (await www("/api/www/golive/view", { access: M })).json.order;
  const wrongSha = await www("/api/www/golive/sign", { access: M, version: v3.version, sha: s2.json.order.sha, signer, authority: true });
  t("the right version with the hash of another text cannot sign either", wrongSha.status === 409 && wrongSha.json.code === "changed", wrongSha.json);
  const noTick = await www("/api/www/golive/sign", { access: M, version: v3.version, sha: v3.sha, signer, authority: false });
  t("without the box ticked there is no signature", noTick.status === 400 && /Tick the box/.test(noTick.json.error) && noTick.json.fields.includes("authority"), noTick.json);
  const noName = await www("/api/www/golive/sign", { access: M, version: v3.version, sha: v3.sha, signer: { name: "", title: "", email: "x" }, authority: true });
  t("nor without a name, a title and an email", noName.status === 400 && /your full name, your title and your email/.test(noName.json.error), noName.json);
  // two signers at once: the manager and the approver press Sign together
  const [x, y] = await Promise.all([
    www("/api/www/golive/sign", { access: M, version: v3.version, sha: v3.sha, signer, authority: true, ip: "203.0.113.9", net: { cf: "203.0.113.9", xff: "6.6.6.6, 203.0.113.9", peer: "10.0.0.2" }, ua: "Manager browser" }),
    www("/api/www/golive/sign", { access: P, version: v3.version, sha: v3.sha, signer: { name: "Dana Lee", title: "CFO", email: "dana@acmewire.test" }, authority: true, ip: "198.51.100.4", net: { real: "198.51.100.4" }, ua: "Approver browser" }),
  ]);
  t("two signers at once make one signature; the other is told it is signed", [x.status, y.status].sort().join(",") === "200,409" && [x, y].find((r) => r.status === 409).json.code === "signed", [x.status, y.status, x.json.error || "", y.json.error || ""]);
  const won = x.status === 200 ? { r: x, who: "manager", ip: "203.0.113.9", ua: "Manager browser" } : { r: y, who: "approver", ip: "198.51.100.4", ua: "Approver browser" };
  const so = (await q("SELECT * FROM platform.orders WHERE id=$1", [v3.id])).rows[0];
  t("the signed order keeps the text shown, its hash, the terms and their hash, the signer, the address and browser", so.state === "signed" && so.text === v3.text && so.text_sha256 === v3.sha && so.terms_version === T.TERMS_VERSION && so.terms_sha256 === T.termsHash() && so.signer.via === won.who && so.signed_ip === won.ip && so.signed_ua === won.ua && so.signed_at && Number(so.price_usd) === 300 && so.band.key === "core" && so.band.monthly_usd === 2500 && so.price_book === 2, so);
  t("the learning choice is the one in the signed words, and the evidence for the address is kept", so.learning_opt_in === true && so.signed_net && (won.who === "manager" ? so.signed_net.xff === "6.6.6.6, 203.0.113.9" : so.signed_net.real === "198.51.100.4"), so.signed_net);
  const tv = (await q("SELECT sha256, doc FROM platform.terms_versions WHERE version=$1", [T.TERMS_VERSION])).rows[0];
  t("the first signature keeps the words of its terms version", tv && tv.sha256 === T.termsHash() && tv.doc.version === T.TERMS_VERSION && tv.doc.sections.length === 21, tv && tv.sha256);
  // the price book it was signed under is frozen now: the boot's seed no longer rewrites version 2
  await q("UPDATE platform.price_books SET note='tampered by the test' WHERE version=2");
  await require("../../src/sites").init();
  t("signed under price book 2, the book is frozen: a boot does not rewrite it", (await q("SELECT note FROM platform.price_books WHERE version=2")).rows[0].note === "tampered by the test");
  await q("UPDATE platform.price_books SET note=$1 WHERE version=2", [require("../../src/sites").BOOK_V2.note]);
  t("signed but no card: the site is still Ordering, and the view has what the Stripe Customer needs", won.r.json.site.stage === "ordering" && won.r.json.order.state === "signed" && won.r.json.order.card_saved === false && won.r.json.order.customer && won.r.json.order.customer.name === FACTS.legal_name && won.r.json.order.customer.metadata.site === siteId && won.r.json.order.customer.existing === null, won.r.json.order.customer);
  t("the answers cannot change once signed", (await www("/api/www/golive/save", { access: M, fields: { headcount: 170 } })).status === 409 && (await www("/api/www/golive/save", { access: P, fields: { headcount: 170 } })).status === 409);
  t("nor can it be signed twice", (await www("/api/www/golive/sign", { access: M, version: so.version, sha: so.text_sha256, signer, authority: true })).json.code === "signed");

  // ---- the card
  t("the card step needs real-looking Stripe ids", (await www("/api/www/golive/checkout", { access: M, stripe_customer: "x", setup_session: "y" })).status === 400);
  const ck1 = await www("/api/www/golive/checkout", { access: M, stripe_customer: "cus_TestAcme1", setup_session: "cs_test_first" });
  t("the site's Stripe Customer and the setup session are kept", ck1.status === 200 && (await q("SELECT stripe_customer FROM platform.sites WHERE id=$1", [siteId])).rows[0].stripe_customer === "cus_TestAcme1" && ck1.json.order.setup_session === "cs_test_first" && ck1.json.previous_session === null, ck1.json.order);
  const ck2 = await www("/api/www/golive/checkout", { access: P, stripe_customer: "cus_TestAcme1", setup_session: "cs_test_second" });
  t("a second setup session replaces the first, which comes back to be expired", ck2.status === 200 && ck2.json.previous_session === "cs_test_first" && ck2.json.order.setup_session === "cs_test_second", ck2.json);
  t("the site keeps its one Stripe Customer", (await www("/api/www/golive/checkout", { access: M, stripe_customer: "cus_SomeoneElse", setup_session: "cs_test_third" })).status === 409);
  const card = (pm, cs = "cs_test_second", cus = "cus_TestAcme1", order = v3.id) => www("/api/www/golive/card", { order, setup_session: cs, stripe_customer: cus, payment_method: pm, card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 } });
  const [c1, c2] = await Promise.all([card("pm_first"), card("pm_first")]);
  const applied = [c1, c2].filter((r) => r.json.applied).length, already = [c1, c2].filter((r) => r.json.already).length;
  t("the webhook and the way back from Stripe land the same card once", c1.status === 200 && c2.status === 200 && applied === 1 && already === 1, [c1.json, c2.json]);
  t("the card is saved: the site is Signed", (await q("SELECT stage FROM platform.sites WHERE id=$1", [siteId])).rows[0].stage === "signed");
  const c3 = await card("pm_second", "cs_test_first");
  t("a second card for the same order (the other tab) is answered detach", c3.status === 200 && c3.json.applied === false && c3.json.detach === true && /has its card already/.test(c3.json.why), c3.json);
  const vo = await www("/api/www/golive/view", { access: M });
  t("the view: Signed, the card's brand and last four", vo.json.site.stage === "signed" && vo.json.order.card_saved === true && vo.json.order.card.last4 === "4242" && vo.json.order.customer === undefined, vo.json.order);
  t("the approver's link still shows the order, now in", (await www("/api/www/golive/view", { access: P })).json.site.stage === "signed");
  t("an order with its card cannot be started over here", (await www("/api/www/golive/start-over", { access: M })).json.code === "in");
  const b2 = (await A.mgr.get(`/api/c/${A.slug}/board`)).json.golive;
  t("the board says the order is in, and that Anetix aims to switch it on within 24 hours (the Terms, 5.4)", b2 && b2.stage === "signed" && b2.action === "See your order" && /Your order is in\. Anetix aims to switch this site on within 24 hours/.test(b2.line), b2);
  const L = (await admin.get("/api/admin/sites")).json;
  const lr = L.rows.find((r) => r.slug === A.slug);
  t("the Sites tab counts it as Signed, waiting on Brendan, with the signer and the card", L.stages.signed === 1 && lr.stage === "signed" && lr.order.state === "signed" && lr.order.card_saved && lr.order.card.last4 === "4242" && lr.order.signer.name && lr.order_open === true && L.golive.open === true, lr.order);
  const locked = await admin.post(`/api/admin/sites/${A.slug}`, { headcount: 180 });
  t("a signed site's facts are the signed ones", locked.status === 409 && /signed order/.test(locked.json.error));
  t("its note can still change", (await admin.post(`/api/admin/sites/${A.slug}`, { note: "Signed. Activate Monday." })).status === 200);

  // ---- a preview on a real demo: kept apart from the customer's order, voided when the customer starts
  const Pd = await makeDemo(admin, `Preview Target ${Date.now().toString(36).slice(-4)}`, `pat${Date.now().toString(36).slice(-5)}@target.test`);
  const pLink = (await admin.get(`/api/admin/sites/${Pd.slug}/golive-link`)).json.url;
  const PA = { slug: Pd.slug, t: tokenOf(pLink) };
  const pSite = tokenOf(pLink).split(".")[0];
  const ps = await www("/api/www/golive/save", { access: PA, fields: { ...FACTS, legal_name: "Brendan's Test Co", site_name: "Test line" } });
  t("an admin's link starts a preview: kind preview, the site stays a Demo, the Sites tab's facts untouched", ps.status === 200 && ps.json.order.kind === "preview" && ps.json.site.stage === "ordering" && (await q("SELECT stage, site_name FROM platform.sites WHERE id=$1", [pSite])).rows[0].stage === "demo" && (await q("SELECT site_name FROM platform.sites WHERE id=$1", [pSite])).rows[0].site_name === null, ps.json.site);
  const prv = ps.json.order;
  const psig = await www("/api/www/golive/sign", { access: PA, version: prv.version, sha: prv.sha, signer: { name: "Brendan Finn", title: "Founder", email: "brendan@anetix.test" }, authority: true });
  t("a preview is signed by the admin, and says so", psig.status === 200 && psig.json.order.signer.via === "admin" && psig.json.order.customer && psig.json.order.customer.existing === null && psig.json.order.customer.metadata.preview === "yes", psig.json.order && psig.json.order.signer);
  t("a preview cannot take a site's Stripe Customer", (await www("/api/www/golive/checkout", { access: PA, stripe_customer: "cus_TestAcme1", setup_session: "cs_test_prev0" })).status === 409);
  await www("/api/www/golive/checkout", { access: PA, stripe_customer: "cus_PreviewOwn", setup_session: "cs_test_prev1" });
  const pc = await card("pm_preview", "cs_test_prev1", "cus_PreviewOwn", prv.id);
  t("its card is saved to its own Customer; the site stays a Demo with no Stripe Customer", pc.json.applied === true && pc.json.preview === true && (await q("SELECT stage, stripe_customer FROM platform.sites WHERE id=$1", [pSite])).rows[0].stage === "demo" && (await q("SELECT stripe_customer FROM platform.sites WHERE id=$1", [pSite])).rows[0].stripe_customer === null, pc.json);
  t("the preview's own view says its order is in", (await www("/api/www/golive/view", { access: PA })).json.site.stage === "signed");
  const pb = (await Pd.mgr.get(`/api/c/${Pd.slug}/board`)).json.golive;
  t("the customer's board knows nothing of it: Go live, a Demo", pb && pb.stage === "demo" && pb.action === "Go live" && pb.line === null, pb);
  const PM = { slug: Pd.slug, t: tokenOf(pb.url) };
  const pmv = await www("/api/www/golive/view", { access: PM });
  t("nor does the customer's go-live page: no order, the answers start from the Sites tab, not the preview", pmv.json.order === null && pmv.json.prefill.legal_name === null && pmv.json.site.stage === "demo", pmv.json);
  const pRow = (await admin.get("/api/admin/sites")).json.rows.find((r) => r.slug === Pd.slug);
  t("the Sites tab shows it as a Demo with your preview on it", pRow.stage === "demo" && pRow.order && pRow.order.kind === "preview" && pRow.order.card_saved, pRow.order);
  const pcs = await www("/api/www/golive/save", { access: PM, fields: { legal_name: "Target Metals Inc." } });
  t("the customer's first answer voids the preview and hands its card back to be removed", pcs.status === 200 && pcs.json.order.kind === "customer" && pcs.json.order.version === 1 && pcs.json.order.facts.legal_name === "Target Metals Inc." && pcs.json.order.facts.site_name !== "Test line" && JSON.stringify(pcs.json.detach_cards) === JSON.stringify(["pm_preview"]) && pcs.json.site.stage === "ordering", pcs.json);
  t("the preview is kept, voided, replaced by the customer's", /replaced by the customer's own order/.test((await q("SELECT state, note FROM platform.orders WHERE id=$1", [prv.id])).rows[0].note));
  const ro = await www("/api/www/golive/view", { access: PA });
  t("the admin's link now shows the customer's order, read only", ro.json.order && ro.json.order.kind === "customer" && ro.json.order.readonly === true && ro.json.order.approver === null, ro.json.order && ro.json.order.readonly);
  const roSave = await www("/api/www/golive/save", { access: PA, fields: { legal_name: "Changed by admin" } });
  t("and cannot change it", roSave.status === 409 && roSave.json.code === "readonly" && (await www("/api/www/golive/approver", { access: PA, clear: true })).json.code === "readonly", roSave.json);

  // ---- a second demo: signed, no card, started over
  const B = await makeDemo(admin, `Northside Stamping ${Date.now().toString(36).slice(-4)}`, `maria${Date.now().toString(36).slice(-5)}@northside.test`);
  const Bl = (await B.mgr.get(`/api/c/${B.slug}/board`)).json.golive;
  const BM = { slug: B.slug, t: tokenOf(Bl.url) };
  const bSite = tokenOf(Bl.url).split(".")[0];
  t("another demo's link does not open the first", (await www("/api/www/golive/view", { access: { slug: A.slug, t: BM.t } })).status === 404);
  const bs = await www("/api/www/golive/save", { access: BM, fields: { ...FACTS, legal_name: "Northside Stamping LLC", site_name: "Northside, Lowell", headcount: 48, sqft: 30000, billing: { email: "billing@northside.test", same_as_site: false, address: { line1: "1 Ledger Way", city: "Boston", state: "MA", postal_code: "02110" } } } });
  t("48 people is Small: a $1,000 cap, $300 today with no tool live", bs.json.order.band.key === "small" && bs.json.order.band.monthly_usd === 1000 && bs.json.order.price_usd === 300, bs.json.order.band);
  const bap = await www("/api/www/golive/approver", { access: BM, approver: { name: "Lee Park", email: "lee@northside.test" } });
  const BP = { order: bap.json.order.id, t: tokenOf(bap.json.order.approver.url) };
  const bap2 = await www("/api/www/golive/approver", { access: BM, approver: { name: "Kim Park", email: "kim@northside.test" } });
  t("naming someone else kills the first approver's link", (await www("/api/www/golive/view", { access: BP })).status === 404 && (await www("/api/www/golive/view", { access: { order: bap2.json.order.id, t: tokenOf(bap2.json.order.approver.url) } })).status === 200);
  const bcl = await www("/api/www/golive/approver", { access: BM, clear: true });
  t("I'll sign: no approver, and the second link dies too", bcl.json.order.approver === null && (await www("/api/www/golive/view", { access: { order: bap2.json.order.id, t: tokenOf(bap2.json.order.approver.url) } })).status === 404);
  const bap3 = await www("/api/www/golive/approver", { access: BM, approver: { name: "Kim Park", email: "kim@northside.test" } });
  const BP3 = { order: bap3.json.order.id, t: tokenOf(bap3.json.order.approver.url) };
  const bv = bap3.json.order;
  const bsig = await www("/api/www/golive/sign", { access: BM, version: bv.version, sha: bv.sha, signer: { name: "Maria Gomez", title: "Operations manager", email: "maria@northside.test" }, authority: true });
  t("the manager can sign even with an approver named", bsig.status === 200 && bsig.json.order.signer.via === "manager", bsig.json);
  t("the customer is billed at its own billing address; the site is the shipping address", bsig.json.order.customer.address.line1 === "1 Ledger Way" && bsig.json.order.customer.shipping.address.line1 === "40 Foundry Street");
  await www("/api/www/golive/checkout", { access: BM, stripe_customer: "cus_TestNorth", setup_session: "cs_test_north1" });
  t("another site cannot take the first site's Stripe Customer", (await www("/api/www/golive/checkout", { access: BM, stripe_customer: "cus_TestAcme1", setup_session: "cs_test_north2", replaces: "cus_TestNorth" })).status === 409);
  const so2 = await www("/api/www/golive/start-over", { access: BM });
  t("a signed order with no card starts over: a new draft with the same answers, the old session to expire", so2.status === 200 && so2.json.order.state === "draft" && so2.json.order.version === 1 && so2.json.order.id !== bv.id && so2.json.order.facts.legal_name === "Northside Stamping LLC" && so2.json.expire_session === "cs_test_north1" && so2.json.site.stage === "ordering", so2.json);
  const voided = (await q("SELECT state, note, text FROM platform.orders WHERE id=$1", [bv.id])).rows[0];
  t("the old order is kept, voided, with its signed text", voided.state === "void" && /started over/.test(voided.note) && /Northside Stamping LLC/.test(voided.text), voided);
  const gone = await www("/api/www/golive/view", { access: BP3 });
  t("the approver's link for the voided order says it no longer works", gone.status === 410 && gone.json.code === "gone" && /no longer works/.test(gone.json.error), gone.json);
  const late = await card("pm_late", "cs_test_north1", "cus_TestNorth", bv.id);
  t("a card that completes for the voided order is answered detach", late.json.detach === true && late.json.applied === false, late.json);
  const ords = (await admin.get(`/api/admin/sites/${B.slug}/orders`)).json;
  t("the admin sees every order of a site, the signed text with it", ords.orders.length === 2 && ords.orders.some((o) => o.state === "void" && o.text && o.text_sha256 && o.signer && o.signer.name === "Maria Gomez") && ords.orders.some((o) => o.state === "draft") && ords.site.stripe_customer === "cus_TestNorth", ords);
  t("starting over a draft changes nothing", (await www("/api/www/golive/start-over", { access: BM })).json.order.id === so2.json.order.id);

  // ---- a deleted company's link dies, even when its slug goes to the next company
  const del = await admin.post(`/api/admin/companies/${B.slug}/delete`, { confirm_slug: B.slug, password: PW.admin });
  t("the demo is deleted; its open order is voided and kept", del.status === 200 && (await q("SELECT state, note FROM platform.orders WHERE site_id=$1 ORDER BY created_at DESC LIMIT 1", [bSite])).rows[0].note === "the company was deleted", del.json);
  const pin2 = (await admin.post("/api/admin/pins", { label: "Again", email: "again@northside.test", max_uses: 1, days: 30 })).json.pin.shown;
  const again = await www("/api/www/companies", { pin: pin2, email: "again@northside.test", name: B.slug.replace(/-/g, " "), contact: "Again", ref: `golive-again:${pin2}`, paid_usd: 0, credit_usd: 10, password: "copper-oak-2201-press", demo: true, collect: true });
  t("a new company gets the freed slug", again.json.company && again.json.company.slug === B.slug, again.json);
  t("the old company's link does not open the new one", (await www("/api/www/golive/view", { access: BM })).status === 404);
  const afterDel = await card("pm_after_delete", "cs_test_north3", "cus_TestNorth", so2.json.order.id);
  t("a card that arrives for a deleted company's order is answered detach", afterDel.status === 200 && afterDel.json.detach === true && /site is gone/.test(afterDel.json.why), afterDel.json);

  // ---- Brendan withdraws A's signed order
  t("withdrawing a customer's order needs a reason the manager is shown", (await admin.post(`/api/admin/sites/${A.slug}/void-order`, { note: "" })).status === 400);
  const vd = await admin.post(`/api/admin/sites/${A.slug}/void-order`, { note: "Headcount looks off; call me first" });
  t("withdrawn: the order is void, the site is a Demo again, its card listed for removal at Stripe", vd.status === 200 && vd.json.card === true && (await q("SELECT stage FROM platform.sites WHERE id=$1", [siteId])).rows[0].stage === "demo" && (await admin.get("/api/admin/golive")).json.cards_to_remove.some((c) => c.order === v3.id && c.payment_method === "pm_first"), vd.json);
  const wv = await www("/api/www/golive/view", { access: M });
  t("the manager's go-live page says why, and starts again from the answers", wv.json.order === null && wv.json.withdrawn && /Headcount looks off/.test(wv.json.withdrawn.note) && wv.json.prefill.legal_name === FACTS.legal_name, wv.json.withdrawn);
  t("the board offers Go live again", (await A.mgr.get(`/api/c/${A.slug}/board`)).json.golive.action === "Go live");
  t("a site with no open order has nothing to withdraw", (await admin.post(`/api/admin/sites/${A.slug}/void-order`, { note: "again" })).status === 409);

  // ---- switched off again
  await admin.post("/api/admin/golive", { open: false });
  t("switched off, a customer's link is refused again and the board's link is gone", (await www("/api/www/golive/view", { access: M })).status === 404 && (await A.mgr.get(`/api/c/${A.slug}/board`)).json.golive === null);
  t("an admin's link still works", (await www("/api/www/golive/view", { access: aAdmin })).status === 200);

  // ---- the terms, and the backup
  const tr = await www("/api/www/golive/terms");
  t("anetix.ai reads the terms from here, with the hash signatures keep", tr.status === 200 && tr.json.version === T.TERMS_VERSION && tr.json.sha256 === T.termsHash() && tr.json.sections.length === 21, tr.json.version);
  const bk = await admin.get("/api/admin/backup");
  const bo = bk.json && bk.json.platform && bk.json.platform.orders;
  t("orders are in the backup", Boolean(bo) && (Array.isArray(bo) ? bo : bo.rows || []).length >= 3, bo && Object.keys(bo));
  R.done();
})().catch(R.abort);
