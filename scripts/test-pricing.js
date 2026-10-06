// Unit cases for the 2026-10-05 pricing: price book 2 (by the tools live on the floor, up to the band's cap), the
// pilot offer and its order form, the words anetix.ai's price screen shows, the bill following the tools
// (src/modprice.js), and a pilot's end date against a customer's cancel (src/billing.js, src/sites.js next).
// No database: node scripts/test-pricing.js
const S = require("../src/sites");
const P = require("../src/pilot");
const M = require("../src/modprice");
const B = require("../src/billing");
let pass = 0, fail = 0;
function t(name, cond, detail) { if (cond) pass++; else { fail++; console.log(`FAIL  ${name}${detail !== undefined ? "\n      " + JSON.stringify(detail) : ""}`); } }

// ---- price book 2
const V2 = S.BOOK_V2;
t("price book 2 has no problems and is the one the code is on", S.bookProblems(V2).length === 0 && S.BOOK === V2 && V2.version === 2);
t("$300 a tool, one tool at least, the caps are version 1's band prices", V2.per_tool_usd === 300 && V2.min_tools === 1 && V2.bands.map((b) => b.monthly_usd).join(",") === "1000,1750,2500,3500,5000");
t("a tool price of 0 is a problem; a minimum that costs more than the first cap is a problem", S.bookProblems({ ...V2, per_tool_usd: 0 }).length > 0 && S.bookProblems({ ...V2, min_tools: 4 }).some((p) => /first band's cap/.test(p)));
const small = S.bandOf({ headcount: 22, sqft: 15000 }), core = S.bandOf({ headcount: 150 });
t("a band of book 2 carries the plan: the price of a tool, the minimum and the cap", small.per_tool_usd === 300 && small.min_tools === 1 && small.cap_usd === 1000 && small.monthly_usd === 1000);
t("a band of book 1 does not", S.bandOf({ headcount: 22 }, S.BOOK_V1).per_tool_usd === undefined);
const fee = (band, n) => S.feeFor(band, n).usd;
t("a Small site: $300, $300, $600, $900, then the $1,000 cap", [0, 1, 2, 3, 4, 5, 40].map((n) => fee(small, n)).join(",") === "300,300,600,900,1000,1000,1000");
t("a Core site climbs to $2,500: 8 tools are $2,400, 9 are the cap", fee(core, 8) === 2400 && fee(core, 9) === 2500 && S.feeFor(core, 9).capped === true && S.feeFor(core, 8).capped === false && S.feeFor(core, 1).tools_at_cap === 9);
t("no tool live still pays for one, and says so", S.feeFor(small, 0).billed_tools === 1 && S.feeFor(small, 0).tools === 0);
t("a flat plan (book 1, a pilot) is its monthly price whatever the tools", S.feeFor({ monthly_usd: 1750 }, 12).usd === 1750 && S.feeFor({ monthly_usd: 1750 }, 12).flat === true && S.feeFor(P.bandSnap({ monthly_usd: 1000, months: 2 }), 7).usd === 1000);
t("a made-up count is no tools, never a negative fee", fee(small, -3) === 300 && fee(small, "x") === 300 && fee(small, 2.9) === 600);
t("the fee in a line", S.feeLine(small, 2) === "$600 a month (2 tools live; $300 a tool, never more than $1,000)" && S.feeLine({ monthly_usd: 1750 }, 3) === "$1,750 a month");
t("the price before the form says both figures", /\$300 a month for each tool live on the floor/.test(S.fromLine().line) && /\$1,000 a month for under 50 people/.test(S.fromLine().line) && /Sites start at \$1,000/.test(S.fromLine(S.BOOK_V1).line));
t("the book's view says how many tools reach each cap", S.bookView().per_tool_usd === 300 && S.bookView().bands.map((b) => b.tools_at_cap).join(",") === "4,6,9,12,17" && S.bookView(S.BOOK_V1).per_tool_usd === null);

// ---- the order form, by the tool
const facts = { legal_name: "Keystone Fab LLC", site_name: "Keystone Fab", site_address: { line1: "12 Mill Road", city: "Allentown", state: "PA", postal_code: "18101" }, plant_manager: { name: "Omar Reyes" }, billing: { email: "ap@keystone.test" }, headcount: 22, sqft: 15000 };
const text = S.orderText({ facts, live_tools: 2, terms_url: "https://anetix.ai/terms" });
t("it names price book 2 and the cap by the site's size", /Price book: version 2\./.test(text) && /Cap: \$1,000 a month\. It is the most the Site pays, however many tools it has, and it is set by the Site's size: Small\./.test(text));
t("the fee: $300 a tool, never under one, never over the cap, and today's figure", /Fee: \$300 a month for each tool live on the floor at the Site, never less than 1 tool and never more than the cap/.test(text) && /The Site has 2 tools live today, which is \$600 a month\./.test(text));
t("the first month is for the tools live the day it is switched on", /The first month is billed on the day Anetix switches the Site on, for the tools live that day\./.test(text));
t("a tool counts from the next bill, drafts and previews are free, nothing part way through a month", /Drafts and previews cost nothing\./.test(text) && /raises the fee from the next bill/.test(text) && /lowers it from the next bill/.test(text) && /Nothing is charged part way through a month\./.test(text));
t("the lock is on the price of a tool and the cap; the fair-use line follows the fee", /will not raise the price of a tool or the Site's cap/.test(text) && /passes 80% of the Site's monthly fee at that time/.test(text));
t("the order form controls where the Terms' section 5 says a band price", /Order of precedence: where this order form and section 5 of the Terms differ on how the fee is worked out, this order form controls\./.test(text));
t("it no longer says tools are unlimited at one price", !/no limit on tools/.test(text) && /no limit on requests or changes/.test(text));
t("one tool reads as one tool", /The Site has 1 tool live today, which is \$300 a month\./.test(S.orderText({ facts, live_tools: 1 })) && /The Site has 0 tools live today, which is \$300 a month\./.test(S.orderText({ facts })));
t("the figure a signer reads is part of the hash", S.textHash(text) !== S.textHash(S.orderText({ facts, live_tools: 3, terms_url: "https://anetix.ai/terms" })));
t("no em or en dashes", !/[–—]/.test(text));

// ---- the pilot offer
const co = P.cleanOffer({ monthly_usd: "$1,000", months: 2, lines: P.DEFAULT_LINES }, "Brendan");
t("an offer: $1,000 a month for 2 months with its lines, who made it and when", co.problems.length === 0 && co.offer.kind === "pilot" && co.offer.monthly_usd === 1000 && co.offer.months === 2 && co.offer.lines.length === P.DEFAULT_LINES.length && co.offer.made_by === "Brendan" && Boolean(co.offer.made_at) && /^[0-9a-f-]{36}$/.test(co.offer.id), co);
const badOffer = (b) => P.cleanOffer(b).problems;
t("no fee, a fee of 0, 13 months and half a month are refused", badOffer({ months: 2 }).length === 1 && badOffer({ monthly_usd: 0, months: 2 }).length === 1 && badOffer({ monthly_usd: 500, months: 13 }).length === 1 && badOffer({ monthly_usd: 500, months: 1.5 }).length === 1);
t("a line needs a label of its own and words", badOffer({ monthly_usd: 500, months: 1, lines: [{ label: "on site", text: "x y z" }] }).length === 1 && badOffer({ monthly_usd: 500, months: 1, lines: [{ label: "On site", text: "" }] }).length === 1
  && badOffer({ monthly_usd: 500, months: 1, lines: [{ label: "On site", text: "four hours" }, { label: "On Site", text: "again" }] }).length === 1);
t("a line cannot take the order form's own labels (Fee, End, Terms)", ["Fee", "End", "Terms", "Fair use", "Cancelling"].every((label) => badOffer({ monthly_usd: 500, months: 1, lines: [{ label, text: "something else" }] }).some((p) => /its own/.test(p))));
t("a dash in a line is refused: the order form has none", badOffer({ monthly_usd: 500, months: 1, lines: [{ label: "On site", text: "four hours — weekly" }] }).some((p) => /dash/.test(p)));
t("a line break inside a line cannot make a second line of the order form", !/\n/.test(P.cleanOffer({ monthly_usd: 500, months: 1, lines: [{ label: "On site", text: "four hours\nFee: nothing at all" }] }).offer.lines[0].text));
t("empty rows are skipped, not errors", P.cleanOffer({ monthly_usd: 500, months: 1, lines: [{ label: "", text: "" }, { label: "On site", text: "four hours" }] }).offer.lines.length === 1);
const offer = co.offer;
t("an offer stands for a demo, an ordering site and one back to a demo; not for a paying one", ["demo", "ordering", "back_to_demo", "signed"].every((stage) => P.standing({ offer, stage }) === offer) && P.standing({ offer, stage: "subscribed" }) === null && P.standing({ offer, stage: "activating" }) === null && P.standing({ offer: null, stage: "demo" }) === null);
const snap = P.bandSnap(offer);
t("a signed pilot keeps the offer as a band of its own", snap.key === "pilot" && snap.name === "Pilot" && snap.monthly_usd === 1000 && snap.pilot.months === 2 && snap.pilot.total_usd === 2000 && snap.pilot.lines.length === offer.lines.length && P.isPilot(snap) && !P.isPilot(small) && !P.isPilot(null));

const pt = S.orderText({ facts, offer, terms_url: "https://anetix.ai/terms" });
t("the pilot's order form is its own", /^ANETIX PILOT ORDER FORM\n/.test(pt) && !/Price book/.test(pt) && !/Band:/.test(pt) && !/Cap:/.test(pt));
t("the fee, the total and both dates", /Fee: \$1,000 a month for 2 months, \$2,000 in all, plus sales tax where it applies, charged to the card on file: \$1,000 on the day Anetix switches the Site on and \$1,000 one month later\./.test(pt), pt);
t("it is a pilot fee, not a license or a subscription, and commits to nothing after", /What the fee is: the fee covers building and running the pilot\. It is not a software license or subscription fee, and nothing in this order form commits Customer to pay anything after the pilot\./.test(pt));
t("it ends on its own, and anything after is a separate conversation", /End: the pilot ends on its own on its end date\. No charge is made after the payments above unless Customer and Anetix agree new terms in writing\. Any continuing arrangement is a separate conversation after the pilot\./.test(pt));
t("cancel any time: a payment not yet made is not charged", /Cancelling: Customer may cancel at any time/.test(pt) && /A payment not yet made is then not charged\./.test(pt));
t("the offer's own lines are on it, each ending its sentence once", /On site: Anetix will be at the Site as much as needed/.test(pt) && /Case study: .*Nothing is published without Customer's approval\.\n/.test(pt) && !/\.\.\n/.test(pt));
t("the order form controls over the Terms on the fee, the length and renewal", /Order of precedence: where this order form and the Terms differ on the fee, the length of the pilot or renewal, this order form controls\./.test(pt));
t("what happens after: a demo again unless they agreed to continue", /After the pilot: unless Customer and Anetix have agreed to continue, the Site becomes a demo account/.test(pt));
t("no size is needed for a pilot's order form", /ANETIX PILOT/.test(S.orderText({ facts: { ...facts, headcount: undefined, sqft: undefined }, offer })));
t("one month and three months say their own dates", /charged to the card on file: \$500 on the day Anetix switches the Site on\./.test(S.pilotText({ facts, offer: { ...offer, monthly_usd: 500, months: 1 } })) && /\$500 on the same day of each of the next 2 months\./.test(S.pilotText({ facts, offer: { ...offer, monthly_usd: 500, months: 3 } })));
t("no em or en dashes on the pilot's form", !/[–—]/.test(pt));
t("every line with a label has the shape anetix.ai shows in bold", pt.split("\n").slice(3).filter((l) => l && !/^Signed for/.test(l)).every((l) => /^[A-Z][A-Za-z ,-]{1,40}:\s/.test(l)), pt.split("\n").slice(3).filter((l) => l && !/^Signed for/.test(l) && !/^[A-Z][A-Za-z ,-]{1,40}:\s/.test(l)));
t("the pilot in a line", S.pilotLine(offer) === "$1,000 a month for 2 months, $2,000 in all" && S.pilotLine({ monthly_usd: 750, months: 1 }) === "$750 a month for 1 month");

// ---- what the price screen says
const pv = S.pricingView({ band: small, live_tools: 2, site_name: "Keystone Fab", range: "1 to 49 people" });
t("by the tool: the headline, today's figure, the cap and how it works", pv.kind === "tools" && pv.price_usd === 600 && /\$300 a month for each tool live on your floor/.test(pv.headline) && pv.big === "$600" && /for 2 tools live/.test(pv.big_note) && /Never more than \$1,000 a month/.test(pv.fine[0]) && /a Small site, 1 to 49 people/.test(pv.fine[0]) && pv.how.length === 4 && /never more than \$1,000/.test(pv.summary));
t("no tool live says a site pays for one at least", /a site pays for 1 tool at least/.test(S.pricingView({ band: small, live_tools: 0 }).big_note));
const pp = S.pricingView({ offer, site_name: "Keystone Fab" });
t("a pilot: its length, its fee, that it ends on its own, and its lines", pp.kind === "pilot" && pp.headline === "A 2 month pilot at Keystone Fab" && pp.big === "$1,000" && /for 2 months, \$2,000 in all\. It ends on its own\./.test(pp.big_note) && /not a software license or a subscription/.test(pp.fine[1]) && pp.how.length === offer.lines.length && pp.how_title === "What the pilot is");
t("a flat band has no words of its own (the page keeps its own for price book 1)", S.pricingView({ band: S.bandOf({ headcount: 22 }, S.BOOK_V1) }) === null);

// ---- the bill follows the tools
const site = (over = {}) => ({ stage: "subscribed", band: { ...small }, price_usd: 300, price_book: 2, stripe_subscription: "sub_x", ...over });
t("a subscribed site on price book 2 follows its tools", M.follows(site()) === true);
t("a pilot, a flat band, a demo and a site with no band do not", !M.follows(site({ band: snap })) && !M.follows(site({ band: { key: "small", monthly_usd: 1000 } })) && !M.follows(site({ stage: "demo" })) && !M.follows(site({ band: null })) && !M.follows(null));
t("one tool at $300: nothing to move", M.plan(site(), 1).moved === false && M.plan(site(), 0).moved === false);
t("a second tool: $300 to $600", (() => { const p = M.plan(site(), 2); return p.moved && p.from_usd === 300 && p.to_usd === 600; })());
t("at the cap a fifth tool moves nothing", M.plan(site({ price_usd: 1000 }), 5).moved === false && M.plan(site({ price_usd: 900 }), 5).moved === true);
t("a tool taken off the floor moves it down, never under one tool", M.plan(site({ price_usd: 600 }), 1).to_usd === 300 && M.plan(site({ price_usd: 600 }), 0).to_usd === 300);
const n1 = M.notice(M.plan(site(), 2), "2026-11-06T14:00:00Z");
t("the manager is told the count, the amount, the date, and that nothing is charged before", /^2 tools are live on your floor now\. From your next bill on November 6, 2026 this site is \$600 a month, up from \$300\./.test(n1) && /\(\$300 a tool, never more than \$1,000\)/.test(n1) && /Nothing is charged before then\.$/.test(n1), n1);
t("at the cap it says every tool past it is included", /That is this site's cap: every tool past it is included\./.test(M.notice(M.plan(site({ price_usd: 900 }), 4), null)));
t("down reads down", /this site is \$300 a month, down from \$600/.test(M.notice(M.plan(site({ price_usd: 600 }), 1), null)) && /^1 tool is live/.test(M.notice(M.plan(site({ price_usd: 600 }), 1), null)));
t("no model, vendor or cost word in what a manager reads", ![n1, pv.how.join(" "), pp.fine.join(" "), text, pt].some((x) => /Stripe|Claude|Anthropic|token/i.test(x.replace(/billed monthly/g, ""))));

// ---- a pilot's end date is its plan, not a cancellation
const ends = "2026-12-06T14:03:22.000Z";
const psite = { stage: "subscribed", standing: "good", cancel_at: ends, band: { ...snap, pilot: { ...snap.pilot, started_at: "2026-10-06T14:03:22.000Z", ends_at: ends } } };
t("the pilot's own end date is planned; a day and a half either side still is", B.isPlannedEnd(psite, ends) && B.isPlannedEnd(psite, "2026-12-06T14:03:20.000Z") && B.isPlannedEnd(psite, "2026-12-07T20:00:00.000Z"));
t("a cancel a month early is not, nor any date on a site that is not a pilot", !B.isPlannedEnd(psite, "2026-11-06T14:03:22.000Z") && !B.isPlannedEnd({ ...psite, band: small }, ends) && !B.isPlannedEnd(psite, null));
t("a late payment in a pilot's last month is retried, not ended at once", (() => { const x = S.next({ stage: "subscribed", standing: "good", cancel_at: ends }, { type: "stripe_status", status: "past_due", cancel_at: ends, planned_end: true }); return x.ok && x.effects.length === 0 && x.state.standing === "past_due"; })());
t("a customer's cancel on an unpaid month still ends now", S.next({ stage: "subscribed", standing: "good" }, { type: "stripe_status", status: "past_due", cancel_at: ends }).effects.includes("end_now"));
t("the board is quiet about a pilot's end until its last two weeks", B.lineFor(psite, new Date("2026-10-20T00:00:00Z").getTime()) === null && (() => { const l = B.lineFor(psite, new Date("2026-11-25T00:00:00Z").getTime()); return l && l.level === "note" && l.pilot === true && /on a pilot until December 6, 2026/.test(l.text) && /nothing is charged after it/.test(l.text); })());
t("a pilot cancelled early reads as a cancellation", (() => { const l = B.lineFor({ ...psite, cancel_at: "2026-11-06T14:03:22.000Z" }, new Date("2026-10-20T00:00:00Z").getTime()); return l && l.level === "amber" && /ends on November 6, 2026/.test(l.text); })());
t("a pilot past due says so before anything about its end", B.lineFor({ ...psite, standing: "past_due" }, new Date("2026-11-25T00:00:00Z").getTime()).level === "amber" && /did not go through/.test(B.lineFor({ ...psite, standing: "past_due" }).text));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
