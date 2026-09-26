// Unit cases for src/golive.js and src/terms.js, the pure parts: the manager's and the approver's links, screen 1's
// answers and what an order still needs, who the Stripe Customer is, the terms and their hash, and the order form's
// new lines. No database: node scripts/test-golive.js
process.env.SOS_WWW_KEY = process.env.SOS_WWW_KEY || "unit-www-key-0123456789abcdef";
const G = require("../src/golive");
const S = require("../src/sites");
const T = require("../src/terms");
let pass = 0, fail = 0;
function t(name, cond, detail) { if (cond) pass++; else { fail++; console.log(`FAIL  ${name}${detail !== undefined ? "\n      " + (typeof detail === "string" ? detail : JSON.stringify(detail)).slice(0, 600) : ""}`); } }

const KEY = process.env.SOS_WWW_KEY, NOW = Date.UTC(2026, 8, 26, 15);
const SITE = "3f1c2a4e-9b7d-4c1e-8a2f-0d5e6b7c8a90", OTHER = "0b9a8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d";
const ORDER = "7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d";

// ---- the manager's link
const tok = G.goliveToken("acme-wire", SITE, { now: NOW, key: KEY });
t("a manager's link names the site, the day it runs out and its kind", /^[0-9a-f-]{36}\.\d{10}\.m\.[A-Za-z0-9_-]{32}$/.test(tok) && tok.startsWith(SITE), tok);
const read = G.readGoliveToken("acme-wire", tok, { now: NOW, key: KEY });
t("it reads back to the site, a customer's kind", read && read.site === SITE && read.kind === "m", read);
t("31 days out, rounded to the day, so the board's link is the same all day", read.exp === (Math.floor(NOW / 86400e3) + 31) * 86400 && G.goliveToken("acme-wire", SITE, { now: NOW + 3600e3, key: KEY }) === tok);
t("not for another company's slug", G.readGoliveToken("acme-wire-2", tok, { now: NOW, key: KEY }) === null);
t("not with the site id changed", G.readGoliveToken("acme-wire", tok.replace(SITE, OTHER), { now: NOW, key: KEY }) === null);
t("not once it has run out", G.readGoliveToken("acme-wire", tok, { now: read.exp * 1000 + 1, key: KEY }) === null);
t("not made with another key, nor read on a service with a short key", G.readGoliveToken("acme-wire", G.goliveToken("acme-wire", SITE, { now: NOW, key: "another-key-0123456789abcdef" }), { now: NOW, key: KEY }) === null && G.readGoliveToken("acme-wire", tok, { now: NOW, key: "short" }) === null);
t("a customer's link cannot be turned into an admin's by changing the letter", G.readGoliveToken("acme-wire", tok.replace(".m.", ".a."), { now: NOW, key: KEY }) === null);
const adm = G.goliveToken("acme-wire", SITE, { kind: "a", now: NOW, key: KEY }), ar = G.readGoliveToken("acme-wire", adm, { now: NOW, key: KEY });
t("an admin's link is kind a and lives 24 hours", ar && ar.kind === "a" && ar.exp === Math.floor(NOW / 1000) + 86400 && G.readGoliveToken("acme-wire", adm, { now: NOW + 86401e3, key: KEY }) === null);
t("no link without a key, a good slug and a site id", G.goliveToken("acme-wire", SITE, { now: NOW, key: "" }) === "" && G.goliveToken("Acme Wire", SITE, { now: NOW, key: KEY }) === "" && G.goliveToken("acme-wire", "not-a-uuid", { now: NOW, key: KEY }) === "" && G.goliveToken("acme-wire", SITE, { kind: "x", now: NOW, key: KEY }) === "");
t("junk is refused", [null, "", "x", `${SITE}.1.m.x`, `${SITE}.${read.exp}.m.${"A".repeat(32)}`].every((x) => G.readGoliveToken("acme-wire", x, { now: NOW, key: KEY }) === null));

// ---- the approver's link
const EXP = Math.floor(NOW / 1000) + 14 * 86400, NONCE = "AbCdEfGhIjK";
const at = G.approverToken(ORDER, NONCE, EXP, KEY);
t("an approver's link carries its run-out time and the nonce kept on the order", at === `${EXP}.${NONCE}.${at.split(".")[2]}` && /^[A-Za-z0-9_-]{32}$/.test(at.split(".")[2]), at);
const aread = G.readApproverToken(ORDER, at, { now: NOW, key: KEY });
t("it reads back for that order", aread && aread.exp === EXP && aread.nonce === NONCE, aread);
t("not for another order", G.readApproverToken(SITE, at, { now: NOW, key: KEY }) === null);
t("not with another nonce (a new approver kills the old link)", G.readApproverToken(ORDER, at.replace(NONCE, "ZZZZZZZZZZZ"), { now: NOW, key: KEY }) === null);
t("not after 14 days", G.readApproverToken(ORDER, at, { now: EXP * 1000 + 1, key: KEY }) === null);
t("not with a later date written in", G.readApproverToken(ORDER, at.replace(String(EXP), String(EXP + 86400)), { now: NOW, key: KEY }) === null);

// ---- screen 1's answers
const good = {
  legal_name: "Acme Wire & Cable, Inc.", site_name: "Acme Wire, Worcester", site_address: { line1: "40 Foundry Street", city: "Worcester", state: "ma", postal_code: "01608" },
  headcount: "140", sqft: "120,000", plant_manager: { name: "Sam Ortiz", title: "Plant manager", email: "Sam@AcmeWire.test" },
  contact: { is_pm: true, name: "ignored", title: "ignored" }, billing: { email: "ap@acmewire.test", same_as_site: true, address: { line1: "ignored" } },
  integrations: "  Epicor  Kinetic ", hardware: "",
};
const cf = G.cleanFacts(good);
t("the answers are cleaned: the state upper case, the numbers whole, the email lower case", cf.problems.length === 0 && cf.facts.site_address.state === "MA" && cf.facts.headcount === 140 && cf.facts.sqft === 120000 && cf.facts.plant_manager.email === "sam@acmewire.test", cf);
t("That's me: the person going live is the plant manager, nothing else kept", JSON.stringify(cf.facts.contact) === JSON.stringify({ is_pm: true, name: "", title: "" }));
t("billing the same as the site keeps no second address; what they asked for is trimmed, blank is none", cf.facts.billing.same_as_site === true && cf.facts.billing.address === null && cf.facts.integrations === "Epicor Kinetic" && cf.facts.hardware === null);
t("a complete set of answers is missing nothing", G.missingFacts(cf.facts).length === 0, G.missingFacts(cf.facts));
const partial = G.cleanFacts({ legal_name: "Acme", headcount: "" }).facts;
t("only the keys sent come back", Object.keys(partial).join(",") === "legal_name,headcount" && partial.headcount === null);
const missing = G.missingFacts({ legal_name: "Acme" }).map((m) => m[0]);
t("what an order still needs, by field", ["site_name", "site_address", "headcount", "sqft", "pm_name", "pm_email", "me_name", "billing_email"].every((k) => missing.includes(k)) && !missing.includes("legal_name") && !missing.includes("billing_address"), missing);
t("someone else going live needs their own name", G.missingFacts({ ...cf.facts, contact: { is_pm: false, name: "", title: "" } }).map((m) => m[0]).join(",") === "me_name");
const other = G.cleanFacts({ billing: { email: "not an email", same_as_site: false, address: { line1: "1 Main St", city: "Boston", state: "Massachusetts", postal_code: "2108" } } });
t("a billing address of its own is checked like the site's, and says where", other.problems.length === 3 && other.problems.every((p) => /billing/.test(p)) && other.facts.billing.same_as_site === false, other.problems);
t("a separate billing address missing its city is still needed", G.missingFacts({ ...cf.facts, billing: { email: "a@b.co", same_as_site: false, address: { line1: "1 Main St", state: "MA", postal_code: "02108" } } }).map((m) => m[0]).join(",") === "billing_address");
t("the learning opt-in is a yes only when it is true", G.cleanFacts({ learning: true }).facts.learning === true && G.cleanFacts({ learning: "yes" }).facts.learning === false && !("learning" in G.cleanFacts({}).facts));
t("where the signer's request came from: the four pieces of evidence, trimmed, nothing else", JSON.stringify(G.cleanNet({ cf: "203.0.113.9", real: "203.0.113.9", xff: "6.6.6.6, 203.0.113.9", peer: "10.0.0.2", evil: "x" })) === JSON.stringify({ cf: "203.0.113.9", real: "203.0.113.9", xff: "6.6.6.6, 203.0.113.9", peer: "10.0.0.2" }) && G.cleanNet({}) === null && G.cleanNet("x") === null);
t("a preview's stage comes from the preview: a draft or a signature without a card is ordering, with its card signed", G.previewStage({ state: "draft" }) === "ordering" && G.previewStage({ state: "signed" }) === "ordering" && G.previewStage({ state: "signed", payment_method: "pm_1" }) === "signed");
t("a floor space or headcount that is not a number says why", G.cleanFacts({ headcount: "lots" }).problems.length === 1 && G.cleanFacts({ sqft: "big" }).problems.length === 1);

// ---- who the Stripe Customer is
const cu = G.customerFor({ id: SITE, stripe_customer: null }, { slug: "acme-wire", name: "Acme Wire" }, cf.facts);
t("the Customer: the legal name, the billing email, the site's address for billing when it is the same, and as shipping", cu.name === "Acme Wire & Cable, Inc." && cu.email === "ap@acmewire.test" && cu.address.line1 === "40 Foundry Street" && cu.shipping.name === "Acme Wire, Worcester" && cu.shipping.address.postal_code === "01608" && cu.address.country === "US", cu);
t("its metadata is the site's permanent id and the company, and a site with one reuses it", cu.metadata.site === SITE && cu.metadata.company === "acme-wire" && cu.existing === null && G.customerFor({ id: SITE, stripe_customer: "cus_123" }, { slug: "a", name: "A" }, cf.facts).existing === "cus_123");
const billOwn = G.customerFor({ id: SITE }, { slug: "a", name: "A" }, { ...cf.facts, billing: { email: "ap@x.test", same_as_site: false, address: { line1: "9 Bill Rd", city: "Boston", state: "MA", postal_code: "02108" } } });
t("a billing address of its own is the Customer's address; the site stays the shipping address", billOwn.address.line1 === "9 Bill Rd" && billOwn.shipping.address.line1 === "40 Foundry Street");
const pc = G.customerFor({ id: SITE, stripe_customer: "cus_site" }, { slug: "acme-wire", name: "Acme Wire" }, cf.facts, { id: ORDER, kind: "preview", stripe: {} });
t("a preview's Customer is never the site's: none to reuse, marked a preview, named as one", pc.existing === null && pc.metadata.preview === "yes" && pc.metadata.order === ORDER && /^Anetix preview \(not a customer\)/.test(pc.description) && G.customerFor({ id: SITE, stripe_customer: "cus_site" }, { slug: "a", name: "A" }, cf.facts, { id: ORDER, kind: "preview", stripe: { customer: "cus_prev" } }).existing === "cus_prev");
t("an empty second address line goes as empty, so an update clears an old one", cu.address.line2 === "" && cu.shipping.address.line2 === "");
t("a card's summary keeps only the brand, the last four and the date", JSON.stringify(G.cleanCard({ brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030, number: "4242424242424242" })) === JSON.stringify({ brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 }) && G.cleanCard({ last4: "42x2" }).last4 === null && G.cleanCard(null) === null);

// ---- the terms
const doc = T.termsDoc(), words = T.termsText();
t("the terms are a cover page on Common Paper's Standard Terms 2.1, and say they are a draft", /Common Paper Cloud Service Agreement Standard Terms, Version 2\.1/.test(words) && words.includes(T.STANDARD_TERMS_URL) && doc.draft === true && /draft for counsel/.test(words));
t("they fill the Key Terms Common Paper asks for, counsel's in brackets", ["Governing Law", "Chosen Courts", "General Cap Amount", "Notice Address", "Effective Date"].every((k) => doc.sections[0].items.some(([x]) => x === k)) && /\[GOVERNING LAW\]/.test(words) && /\[GENERAL CAP AMOUNT\]/.test(words));
t("month to month: a one-month Subscription Period and notice any time before it ends", /Subscription Period: one month/.test(words) && /Non-Renewal Notice Date: any time before the current Subscription Period ends/.test(words));
t("and what Anetix does differently: fair use, no suspension for a late payment, a demo after, the price, learning, the credit back", ["Fair use.", "Late payment.", "After the subscription ends.", "Price.", "Learning.", "Unused demo credit."].every((k) => words.includes(k)));
t("they credit Common Paper under CC BY 4.0", /CC BY 4\.0/.test(words) && words.includes(T.LICENSE_URL));
t("the hash is of these exact words, 64 hex characters, the same every time", /^[0-9a-f]{64}$/.test(T.termsHash()) && T.termsHash() === T.termsHash());
t("no em or en dashes in the terms", !/[–—]/.test(words));
t("the order form names the same version the terms carry", S.TERMS_VERSION === T.TERMS_VERSION);

// ---- the order form's new lines
const text = S.orderText({ facts: cf.facts, terms_url: "https://anetix.ai/terms" });
t("the order form points at the terms by version and address", /Terms: this order form is an Order Form under the Anetix Terms of Service, version draft-1, at https:\/\/anetix\.ai\/terms\./.test(text), text);
t("and says unused demo credit comes off the first bill", /Unused demo credit: credit Customer bought for its demo and has not used by the day the Site is switched on comes off the first bill/.test(text));
t("the terms address is part of what is signed", S.textHash(text) !== S.textHash(S.orderText({ facts: cf.facts, terms_url: "https://other.test/terms" })));
t("140 people on 120,000 square feet is Core at $2,500", /Band: Core\./.test(text) && /\$2,500 a month/.test(text));
t("the billing email is on the order form (the terms send notices there)", /Billing email: ap@acmewire\.test\./.test(text));
t("the learning choice is in the signed words, either way", /Learning: Customer does not opt in\./.test(text) && /Learning: Customer opts in\./.test(S.orderText({ facts: { ...cf.facts, learning: true } })) && S.textHash(text) !== S.textHash(S.orderText({ facts: { ...cf.facts, learning: true }, terms_url: "https://anetix.ai/terms" })));
t("a legal name that ends in a period ends its own sentence (no Inc..)", /Customer: Acme Wire & Cable, Inc\.\n/.test(text) && !/Inc\.\./.test(text) && /Plant manager: Sam Ortiz\.\n/.test(text));
const snap = G.bandSnap(S.bandOf({ headcount: 48, sqft: 20000 }));
t("the band an order keeps leaves Brendan's flags off (the customer never sees them)", snap && snap.key === "small" && !("flags" in snap) && snap.monthly_usd === 1000);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
