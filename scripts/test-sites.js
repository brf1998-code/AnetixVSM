// Unit cases for src/sites.js, the pure part: the price book, sizing a site (every band edge, floor space moving a
// site up one band and no further), the flags, the fair-use line, every stage a site moves through and every move
// that must be refused, the order form's text and hash, the credit a demo gets back, and the pipeline fields.
// No database: node scripts/test-sites.js
const S = require("../src/sites");
let pass = 0, fail = 0;
function t(name, cond, detail) { if (cond) pass++; else { fail++; console.log(`FAIL  ${name}${detail !== undefined ? "\n      " + JSON.stringify(detail) : ""}`); } }

// ---- the price book
const B = S.BOOK_V1;
t("the book in the code has no problems", S.bookProblems(B).length === 0, S.bookProblems(B));
t("five bands, the prices Brendan set: $1,000, $1,750, $2,500, $3,500, $5,000", B.bands.map((b) => b.monthly_usd).join(",") === "1000,1750,2500,3500,5000");
t("the ranges touch without overlapping: 1-49, 50-99, 100-199, 200-499, 500 and up", B.bands.map((b) => `${b.min}-${b.max}`).join(",") === "1-49,50-99,100-199,200-499,500-null");
t("floor space thresholds are 1,500 square feet a person at each edge", B.bands.map((b) => b.sqft_min).join(",") === ",75000,150000,300000,750000");
t("Large and Very large are still proposed, the rest decided", B.bands.filter((b) => b.proposed).map((b) => b.key).join(",") === "large,very_large");
const bad = (patch, idx) => { const b = JSON.parse(JSON.stringify(B)); if (idx == null) Object.assign(b, patch); else Object.assign(b.bands[idx], patch); return S.bookProblems(b); };
t("a gap between bands is a problem", bad({ min: 51 }, 1).some((p) => /starts right after/.test(p)));
t("a band that costs less than the one below is a problem", bad({ monthly_usd: 900 }, 1).some((p) => /costs more than/.test(p)));
t("a closed last band is a problem", bad({ max: 999 }, 4).some((p) => /open-ended/.test(p)));
t("floor-space thresholds that fall are a problem", bad({ sqft_min: 100000 }, 3).some((p) => /threshold is above/.test(p)));
t("a fair-use share over 1 is a problem", bad({ fair_use_share: 1.2 }).some((p) => /fair-use share/.test(p)));
t("an alert after the fair-use line is a problem", bad({ alert_share: 0.9 }).some((p) => /alert/.test(p)));
const V = S.bookView(B);
t("the view carries annual, fair-use line and alert per band", V.bands[2].annual_usd === 30000 && V.bands[2].fair_use_usd === 2000 && V.bands[2].alert_usd === 1250 && V.bands[0].fair_use_usd === 800 && V.bands[1].fair_use_usd === 1400);

// ---- sizing: every edge
const band = (h, s) => { const x = S.bandOf({ headcount: h, sqft: s }); return x && x.key; };
t("1 and 49 people are Small", band(1) === "small" && band(49) === "small");
t("50 and 99 are Mid", band(50) === "mid" && band(99) === "mid");
t("100 and 199 are Core", band(100) === "core" && band(199) === "core");
t("200 and 499 are Large", band(200) === "large" && band(499) === "large");
t("500 and 100,000 are Very large", band(500) === "very_large" && band(100000) === "very_large");
t("no headcount, zero, negative, a fraction or words: no band", [null, undefined, 0, -3, 12.5, "abc", ""].every((h) => S.bandOf({ headcount: h }) === null));
t("a headcount sent as text still sizes", band("150") === "core");
t("40 people and 74,999 square feet stay Small", band(40, 74999) === "small");
const up = S.bandOf({ headcount: 40, sqft: 75000 });
t("40 people and 75,000 square feet move up to Mid, and it says why", up.key === "mid" && up.moved_up === true && up.by_headcount === "small" && /moves it up one band/.test(up.why), up);
t("floor space moves a site up ONE band, never more: 40 people and 900,000 square feet is Mid", band(40, 900000) === "mid");
t("150 people: under 300,000 stays Core, at 300,000 moves to Large", band(150, 299999) === "core" && band(150, 300000) === "large");
t("Very large has nowhere to move", (() => { const x = S.bandOf({ headcount: 600, sqft: 10000000 }); return x.key === "very_large" && x.moved_up === false; })());
t("no floor space given: headcount alone decides", S.bandOf({ headcount: 40 }).moved_up === false && S.bandOf({ headcount: 40, sqft: "" }).key === "small");
const core = S.bandOf({ headcount: 150 });
t("Core's figures: $2,500 a month, $30,000 a year, the line at $2,000, the alert at $1,250", core.monthly_usd === 2500 && core.annual_usd === 30000 && core.fair_use_usd === 2000 && core.alert_usd === 1250 && core.proposed === false && core.book === 1, core);
t("a Large site says its price is still proposed", S.bandOf({ headcount: 300 }).proposed === true);
t("the doc's worked examples: 22 people and 15,000 sq ft is $1,000; 40 and 110,000 is $1,750; 150 and 215,000 is $2,500",
  S.bandOf({ headcount: 22, sqft: 15000 }).monthly_usd === 1000 && S.bandOf({ headcount: 40, sqft: 110000 }).monthly_usd === 1750 && S.bandOf({ headcount: 150, sqft: 215000 }).monthly_usd === 2500);

// ---- flags
const kinds = (h, s) => S.flagsOf({ headcount: h, sqft: s }).map((f) => f.kind).join(",");
t("45 to 49 people are flagged as within five of Mid", [45, 46, 47, 48, 49].every((h) => kinds(h) === "edge") && /within five of Mid/.test(S.flagsOf({ headcount: 47 })[0].text));
t("44 and 50 are not flagged", kinds(44) === "" && kinds(50) === "");
t("95, 195 and 495 are flagged for Core, Large and Very large", /Core/.test(S.flagsOf({ headcount: 95 })[0].text) && /Large/.test(S.flagsOf({ headcount: 195 })[0].text) && /Very large/.test(S.flagsOf({ headcount: 495 })[0].text));
t("100 square feet a person looks low for a plant", kinds(100, 10000) === "space" && /looks low/.test(S.flagsOf({ headcount: 100, sqft: 10000 })[0].text));
t("6,000 square feet a person looks high", kinds(10, 60000) === "space" && /6,000 square feet a person looks high/.test(S.flagsOf({ headcount: 10, sqft: 60000 })[0].text));
t("600 square feet a person is a plant: no flag", kinds(100, 60000) === "");
t("the flags ride along on the band", S.bandOf({ headcount: 48 }).flags.length === 1);

// ---- the fair-use line
const f = (spend, fee, lifted) => S.fairUse({ spend_usd: spend, fee_usd: fee, lifted });
t("a steady Core month ($99 of AI) is 5% of the line, no alert", (() => { const x = f(99, 2500); return x.line_usd === 2000 && x.share_of_line === 0.05 && !x.alert && !x.over; })());
t("half the fee raises the alert for Brendan, still under the line", (() => { const x = f(1250, 2500); return x.alert && !x.over; })());
t("at the line new AI work stops", f(2000, 2500).over === true && f(1999.99, 2500).over === false);
t("a Small site's line is $800", f(800, 1000).over === true && f(799, 1000).over === false && f(0, 1000).line_usd === 800);
t("a lift for the period lets it through", (() => { const x = f(2600, 2500, true); return x.over === false && x.lifted === true && x.alert === true; })());
t("no fee, no line, never over", (() => { const x = f(50, 0); return x.line_usd === 0 && !x.over && !x.alert; })());

// ---- the stages
const go = (state, ...events) => { let s = state; const effects = []; for (const e of events) { const r = S.next(s, e); if (!r.ok) return { refused: r.why, at: e.type, state: s, effects }; s = r.state; effects.push(...r.effects); } return { state: s, effects }; };
const happy = go({ stage: "demo" }, { type: "start_order" }, { type: "card_saved", order_signed: true }, { type: "activate" }, { type: "activated" });
t("the whole way: demo, ordering, signed, activating, subscribed and paid up", !happy.refused && happy.state.stage === "subscribed" && happy.state.standing === "good" && happy.effects.join(",") === "tell_admin,subscribe,rollover", happy);
t("a card without a signed order is refused", S.next({ stage: "ordering" }, { type: "card_saved" }).ok === false);
t("Activate needs a signed order, and cannot be pressed twice", S.next({ stage: "ordering" }, { type: "activate" }).ok === false && /already/.test(S.next({ stage: "activating" }, { type: "activate" }).why));
const declined = S.next({ stage: "activating" }, { type: "card_declined" });
t("a declined card goes back to Ordering (the card is removed, so the order waits for another) and the balance credit is reversed", declined.ok && declined.state.stage === "ordering" && declined.effects.includes("reverse_balance_credit") && declined.effects.includes("detach_card"));
const again = S.next(declined.state, { type: "card_saved", order_signed: true });
t("after a decline, another card moves the site back to Signed, ready for Activate", again.ok && again.state.stage === "signed");
const twice = S.next({ stage: "subscribed", standing: "good" }, { type: "activated" });
t("the rollover's second trigger (the other of Activate and the first invoice.paid) does nothing", twice.ok && twice.effects.length === 0 && twice.state.stage === "subscribed");
t("the rollover from anywhere but switching on is refused", S.next({ stage: "signed" }, { type: "activated" }).ok === false);
const sent = S.next({ stage: "signed" }, { type: "send_back" });
t("Send back: to Ordering, the order voided, the manager told", sent.ok && sent.state.stage === "ordering" && sent.effects.join(",") === "void_order,tell_manager");
const dec = S.next({ stage: "signed" }, { type: "decline" });
t("Decline: back to Demo, so Go live works again; the card is detached", dec.ok && dec.state.stage === "demo" && dec.effects.includes("detach_card") && S.next(dec.state, { type: "start_order" }).ok);
t("Decline is for a signed order only", S.next({ stage: "ordering" }, { type: "decline" }).ok === false && S.next({ stage: "subscribed" }, { type: "decline" }).ok === false);
const sub = { stage: "subscribed", standing: "good", cancel_at: null };
t("Stripe's past_due, unpaid and active set the standing", S.next(sub, { type: "stripe_status", status: "past_due" }).state.standing === "past_due" && S.next(sub, { type: "stripe_status", status: "unpaid" }).state.standing === "unpaid" && S.next({ ...sub, standing: "unpaid" }, { type: "stripe_status", status: "active" }).state.standing === "good");
const canc = S.next(sub, { type: "stripe_status", status: "active", cancel_at: "2026-11-01T00:00:00Z" });
t("a cancel on a paid month waits for the end of it", canc.ok && canc.state.cancel_at === "2026-11-01T00:00:00Z" && canc.state.stage === "subscribed" && canc.effects.length === 0);
const cancPD = S.next({ ...sub, standing: "past_due" }, { type: "stripe_status", status: "past_due", cancel_at: "2026-11-01T00:00:00Z" });
t("a cancel on a month nobody paid for ends it now", cancPD.ok && cancPD.effects.join(",") === "end_now");
t("keeping the subscription clears the cancel date", S.next({ ...sub, cancel_at: "2026-11-01T00:00:00Z" }, { type: "stripe_status", status: "active", cancel_at: null }).state.cancel_at === null);
t("Stripe's canceled, or the subscription deleted, returns the site to a demo", S.next(sub, { type: "stripe_status", status: "canceled" }).state.stage === "back_to_demo" && S.next(sub, { type: "ended" }).state.stage === "back_to_demo" && S.next(sub, { type: "ended" }).effects.join(",") === "return_to_demo");
t("an unknown Stripe status is refused", S.next(sub, { type: "stripe_status", status: "paused" }).ok === false);
t("a Stripe status for a site that is not subscribed is refused", S.next({ stage: "demo" }, { type: "stripe_status", status: "active" }).ok === false && S.next({ stage: "back_to_demo" }, { type: "ended" }).ok === false);
t("End on a paid-up site is refused: the customer cancels in the portal", /billing portal/.test(S.next(sub, { type: "end" }).why));
t("End on an unpaid site ends it now", S.next({ ...sub, standing: "unpaid" }, { type: "end" }).effects.join(",") === "end_now");
const disp = S.next(sub, { type: "attention", kind: "dispute" });
t("a dispute or a refund flags the site for Brendan and changes nothing else", disp.ok && disp.state.attention === "dispute" && disp.state.stage === "subscribed" && disp.state.standing === "good" && disp.effects.join(",") === "tell_admin" && S.next(sub, { type: "attention", kind: "other" }).ok === false);
t("a subscribed site cannot start another order", S.next(sub, { type: "start_order" }).ok === false);
t("a site back to a demo can go live again", S.next({ stage: "back_to_demo" }, { type: "start_order" }).state.stage === "ordering");
t("an event with no type is refused", S.next(sub, {}).ok === false && S.next(sub, null).ok === false);
t("subscribed is the test, whatever the standing", S.subscribed({ stage: "subscribed", standing: "unpaid" }) && S.subscribed({ stage: "subscribed", standing: "past_due" }) && !S.subscribed({ stage: "activating" }) && !S.subscribed(null));
t("every stage the machine can reach is a known stage", [happy.state, sent.state, dec.state, declined.state, S.next(sub, { type: "ended" }).state].every((s) => S.STAGES.includes(s.stage)));

// ---- the order form
const facts = { legal_name: "Keystone Fab LLC", site_name: "Keystone Fab, Allentown", site_address: { line1: "12 Mill Road", city: "Allentown", state: "PA", postal_code: "18101" }, plant_manager: { name: "Omar Reyes" }, headcount: 150, sqft: 90000 };
const text = S.orderText({ facts });
t("the order form carries every figure: who, where, size, band, fee", /Customer: Keystone Fab LLC\./.test(text) && /Site: Keystone Fab, Allentown, 12 Mill Road, Allentown, PA 18101\./.test(text) && /Plant manager: Omar Reyes\./.test(text) && /150 people across all shifts; 90,000 square feet/.test(text) && /Band: Core\./.test(text) && /\$2,500 a month/.test(text), text);
t("and the terms: month to month, the 80% line, the price lock, the data, after a cancellation", /month to month/.test(text) && /passes 80% of that month's fee/.test(text) && /will not raise the Site's price/.test(text) && /owns the data/.test(text) && /becomes a demo account/.test(text));
t("it names the terms version and the price book", new RegExp(`Terms version: ${require("../src/terms").TERMS_VERSION}\\. Price book: version 1\\.`).test(text));
t("Brendan's order-form changes (his notes for counsel): the refunds the Terms provide, the fair-use pause wording", /partial months are not refunded, except as the Terms provide\./.test(text) && /A fair-use pause does not stop the Site's tools\./.test(text) && !/The Site's tools keep working/.test(text));
t("no em or en dashes on the page a customer signs", !/[–—]/.test(text));
t("floor space moving the band says so on the form", /moved up one band for floor space/.test(S.orderText({ facts: { ...facts, headcount: 40, sqft: 110000 } })));
t("no headcount, no order form", (() => { try { S.orderText({ facts: { legal_name: "x" } }); return false; } catch (e) { return /people at the site/.test(e.message); } })());
const h1 = S.textHash(text), h2 = S.textHash(S.orderText({ facts }));
t("the hash is the same for the same page and 64 hex characters", h1 === h2 && /^[0-9a-f]{64}$/.test(h1));
t("a different headcount is a different page", S.textHash(S.orderText({ facts: { ...facts, headcount: 151 } })) !== h1 && S.textHash(S.orderText({ facts: { ...facts, headcount: 250 } })) !== h1);
t("an address written as one line works too", S.addressLine("1 Main St, Boston, MA") === "1 Main St, Boston, MA" && S.addressLine(null) === "");

// ---- the credit a demo gets back
const r = (ledger, spent) => S.refundableCredit(ledger, spent);
const grant = (x) => ({ kind: "grant", delta_usd: String(x), paid_usd: null });
const buy = (credit, paid) => ({ kind: "purchase", delta_usd: String(credit), paid_usd: String(paid) });
t("the doc's example: $10 given, a $20 refill for $10, $13 spent: $7 of bought credit left, $14 back", JSON.stringify(r([grant(10), buy(10, 20)], 13)) === JSON.stringify({ credit_usd: 7, refund_usd: 14, balance_usd: 7 }), r([grant(10), buy(10, 20)], 13));
t("free credit is spent first: $4 spent leaves the whole refill, $20 back", r([grant(10), buy(10, 20)], 4).refund_usd === 20 && r([grant(10), buy(10, 20)], 4).credit_usd === 10);
t("nothing bought, nothing back", r([grant(10)], 3).refund_usd === 0 && r([grant(10)], 3).credit_usd === 0);
t("overspent (a build that finished past zero): nothing back", r([grant(10), buy(10, 20)], 25).refund_usd === 0 && r([grant(10), buy(10, 20)], 25).balance_usd === -5);
const two = r([grant(15), buy(15, 30), buy(10, 15)], 20);
t("two refills at different rates: the older is used first, each comes back at its own rate", two.credit_usd === 20 && two.refund_usd === 35 && two.balance_usd === 20, two);
const taken = r([grant(10), { kind: "adjust", delta_usd: "-15.00", paid_usd: null }, buy(10, 20)], 0);
t("credit the admin took back caps what comes back at the balance", taken.credit_usd === 5 && taken.refund_usd === 10 && taken.balance_usd === 5, taken);
t("a written-off overrun counts as free credit", r([grant(10), { kind: "adjust", delta_usd: "3.00", paid_usd: null }, buy(10, 20)], 13).refund_usd === 20);
t("an empty ledger is all zeros", JSON.stringify(r([], 0)) === JSON.stringify({ credit_usd: 0, refund_usd: 0, balance_usd: 0 }));

// ---- the pipeline fields
const c = (body) => S.cleanFields(body);
t("only the keys sent come back", Object.keys(c({ headcount: 12 }).fields).join(",") === "headcount" && Object.keys(c({}).fields).length === 0);
t("a headcount with a comma is read, a blank one clears it", c({ headcount: "1,200" }).fields.headcount === 1200 && c({ headcount: "" }).fields.headcount === null);
t("a headcount in words, a fraction or zero is refused in plain words", ["abc", 12.5, 0, -4].every((h) => /whole number/.test(c({ headcount: h }).problems.join(" "))));
t("floor space is a whole number of square feet", c({ sqft: "215,000" }).fields.sqft === 215000 && c({ sqft: "lots" }).problems.length === 1);
const addr = c({ site_address: { line1: " 9 Mohawk Drive ", city: "Leominster", state: "ma", postal_code: "01453" } }).fields.site_address;
t("an address is tidied: the state in capitals, the country US", addr.line1 === "9 Mohawk Drive" && addr.state === "MA" && addr.country === "US" && addr.postal_code === "01453", addr);
t("a US postal code and state are checked", c({ site_address: { postal_code: "0145" } }).problems.length === 1 && c({ site_address: { state: "Mass" } }).problems.length === 1);
t("an empty address clears it", c({ site_address: { line1: "", city: "" } }).fields.site_address === null);
t("the plant manager's email is checked and lowercased", c({ plant_manager: { name: "Omar", email: "Omar@Keystone.test" } }).fields.plant_manager.email === "omar@keystone.test" && c({ plant_manager: { email: "not an email" } }).problems.length === 1);
const deal = c({ deal: { integrations: "SAP", hardware: "4 tablets, a label printer", approval_limit_usd: "$25,000", master_agreement: { yes: true, signed_at: "2026-10-01" } } }).fields.deal;
t("the deal: what they asked for, the approval limit read from dollars, the master agreement and its date", deal.integrations === "SAP" && deal.hardware === "4 tablets, a label printer" && deal.approval_limit_usd === 25000 && deal.master_agreement.yes === true && deal.master_agreement.signed_at === "2026-10-01", deal);
t("no master agreement means no date", c({ deal: { master_agreement: { yes: false, signed_at: "2026-10-01" } } }).fields.deal.master_agreement.signed_at === null);
t("a bad date or a bad limit is refused", c({ deal: { master_agreement: { yes: true, signed_at: "Oct 1" } } }).problems.length === 1 && c({ deal: { approval_limit_usd: "some" } }).problems.length === 1);
t("a deal field left out is not touched", Object.keys(c({ deal: { integrations: "Epicor" } }).fields.deal).join(",") === "integrations");
t("the note keeps its lines and stops at 2,000 characters", c({ note: "a\nb" }).fields.note === "a\nb" && c({ note: "x".repeat(3000) }).fields.note.length === 2000);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
