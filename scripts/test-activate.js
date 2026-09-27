// Unit tests for stage 3's pure parts (src/fairuse.js, src/sites.js next and fairUse, src/agreements.js termsToken):
// the billing period a moment falls in, a month on the way a subscription's anchor day works, the line itself, and the
// link that opens the Terms without a pin. No database.
//   node scripts/test-activate.js
const crypto = require("crypto");
const F = require("../src/fairuse");
const S = require("../src/sites");
const A = require("../src/agreements");
let pass = 0, fail = 0;
const t = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log(`FAIL  ${name}${detail !== undefined ? "\n      " + JSON.stringify(detail) : ""}`); } };
const iso = (d) => new Date(d).toISOString().slice(0, 10);

// ---- a month on, the anchor day's way
t("the same day next month", iso(F.addMonths("2026-03-15T10:00:00Z", 1)) === "2026-04-15");
t("the 31st into a 30-day month is the 30th", iso(F.addMonths("2026-03-31T10:00:00Z", 1)) === "2026-04-30");
t("the 31st of January is the last of February (28, or 29 in a leap year)", iso(F.addMonths("2026-01-31T00:00:00Z", 1)) === "2026-02-28" && iso(F.addMonths("2028-01-31T00:00:00Z", 1)) === "2028-02-29");
t("counted from the anchor, never from the clamped day (the 31st comes back in March)", iso(F.addMonths("2026-01-31T00:00:00Z", 2)) === "2026-03-31");
t("across a year", iso(F.addMonths("2026-12-05T00:00:00Z", 1)) === "2027-01-05");

// ---- the window
const P = { period_start: "2026-09-26T12:00:00Z", period_end: "2026-10-26T12:00:00Z" };
const w1 = F.windowOf(P, new Date("2026-10-01T00:00:00Z"));
t("inside the stored period: that period", w1.from.toISOString() === "2026-09-26T12:00:00.000Z" && w1.to.toISOString() === "2026-10-26T12:00:00.000Z" && w1.rolled === false);
const w2 = F.windowOf(P, new Date("2026-11-03T00:00:00Z"));
t("the stored period over and no event since: rolled forward a month from the anchor", w2.from.toISOString() === "2026-10-26T12:00:00.000Z" && w2.to.toISOString() === "2026-11-26T12:00:00.000Z" && w2.rolled === true);
const w3 = F.windowOf(P, new Date("2027-03-01T00:00:00Z"));
t("months later still: the month that holds now", w3.from.toISOString() === "2027-02-26T12:00:00.000Z" && w3.to.toISOString() === "2027-03-26T12:00:00.000Z");
t("the end of a period belongs to the next one", F.windowOf(P, new Date("2026-10-26T12:00:00Z")).from.toISOString() === "2026-10-26T12:00:00.000Z");
t("no period stored: no window", F.windowOf({}, new Date()) === null);
t("a start without an end: a month from the start", iso(F.windowOf({ period_start: "2026-09-26T12:00:00Z" }, new Date("2026-10-01T00:00:00Z")).to) === "2026-10-26");

// ---- the line (80% of the fee), the alert (50%), a lift
const core = { fee_usd: 2500, share: 0.8, alert_share: 0.5 };
t("a Core site's line is $2,000", S.fairUse({ ...core, spend_usd: 0 }).line_usd === 2000);
t("under the line: not over; past half the fee: the alert", !S.fairUse({ ...core, spend_usd: 1999.99 }).over && S.fairUse({ ...core, spend_usd: 1250 }).alert && !S.fairUse({ ...core, spend_usd: 1249.99 }).alert);
t("at the line: over", S.fairUse({ ...core, spend_usd: 2000 }).over === true && S.fairUse({ ...core, spend_usd: 2000 }).share_of_line === 1);
t("lifted: never over, and says so", S.fairUse({ ...core, spend_usd: 5000, lifted: true }).over === false && S.fairUse({ ...core, spend_usd: 5000, lifted: true }).lifted === true);
const msg = F.message({ to: "2026-10-26T12:00:00.000Z" });
t("the words at the line are the spec's, with the day it lifts", msg === "New AI work here is paused until October 26. This month passed the fair-use line in your agreement, which normal use does not reach, and Anetix has been told. Your tools keep working.", msg);
t("no em or en dashes in them", !/[–—]/.test(msg));

// ---- the stages stage 3 drives
const act = S.next({ stage: "signed" }, { type: "activate" });
t("Activate: signed to activating, and the subscription is asked for", act.ok && act.state.stage === "activating" && act.effects.includes("subscribe"));
t("the rollover: activating to subscribed, paid up", S.next({ stage: "activating" }, { type: "activated" }).state.stage === "subscribed" && S.next({ stage: "activating" }, { type: "activated" }).state.standing === "good");
t("Decline and Send back only from a signed order", S.next({ stage: "ordering" }, { type: "decline" }).ok === false && S.next({ stage: "activating" }, { type: "send_back" }).ok === false);

// ---- the Terms' link from the product: anetix.ai checks the same few lines
const key = "e2e-www-key-0123456789abcdef", now = Date.UTC(2026, 8, 26, 15);
const tok = A.termsToken(now, key);
const [exp, mac] = tok.split(".");
t("the Terms' link: 31 days out, rounded to the day, 32 characters of HMAC over terms:<exp>", Number(exp) === (Math.floor(now / 86400e3) + 31) * 86400 && mac === crypto.createHmac("sha256", key).update(`terms:${exp}`).digest("base64url").slice(0, 32));
t("the same all day, so the board's link does not change on every refresh", A.termsToken(now + 3600e3, key) === tok);
t("no key, no link", A.termsToken(now, "short") === "");
t("a page's version and hash against the Terms in force: only an exact match", A.sameTerms(require("../src/terms").TERMS_VERSION, require("../src/terms").termsHash()) && !A.sameTerms("draft-1", require("../src/terms").termsHash()) && !A.sameTerms(require("../src/terms").TERMS_VERSION, "0".repeat(64)) && !A.sameTerms(require("../src/terms").TERMS_VERSION, ""));

// ---- the review's last items: a restore keeps the evidence; the builder is told the Terms' estimate line
const B = require("../src/backup");
t("a restore adds to what the Terms keep and never takes any away: acceptances, Stripe's events, the terms versions", ["acceptances", "billing_events", "terms_versions"].every((x) => B.MERGED[x] && B.MERGED[x].key.length >= 1) && B.MERGED.acceptances.newId === true);
const principles = require("fs").readFileSync(require("path").join(__dirname, "../principles/PRINCIPLES.md"), "utf8");
t("the builder's principles carry the Terms' estimate line word for word", principles.includes('"Estimate. Check it before you promise it to a customer."') && !/[–—]/.test(principles));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
