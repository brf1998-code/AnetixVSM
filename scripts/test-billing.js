// Unit tests for stage 4's pure parts (src/billing.js) and the alert's shape (src/notify.js). No database.
//   node scripts/test-billing.js
const B = require("../src/billing");
const N = require("../src/notify");
let pass = 0, fail = 0;
const t = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log(`FAIL  ${name}${detail !== undefined ? "\n      " + JSON.stringify(detail) : ""}`); } };
const KEY = "unit-www-key-0123456789abcdef", SITE = "11111111-2222-4333-8444-555555555555", now = 1790000000000;

// ---- the Manage billing link
const tok = B.billingToken("acme", SITE, now, KEY);
t("a link: ten minutes out, 32 characters of mac", /^\d{10}\.[A-Za-z0-9_-]{32}$/.test(tok) && Number(tok.split(".")[0]) === Math.floor(now / 1000) + 600, tok);
t("it holds for its site", B.billingTokenOk("acme", SITE, tok, now, KEY));
t("not for another slug (a freed slug's next company)", !B.billingTokenOk("acme-2", SITE, tok, now, KEY));
t("not for another site id", !B.billingTokenOk("acme", "00000000-0000-4000-8000-000000000000", tok, now, KEY));
t("not after ten minutes", !B.billingTokenOk("acme", SITE, tok, now + 601e3, KEY));
t("not under another key", !B.billingTokenOk("acme", SITE, tok, now, "another-key-0123456789abcdef"));
t("no key, or a short one: no link, and nothing holds", B.billingToken("acme", SITE, now, "") === "" && B.billingToken("acme", SITE, now, "short") === "" && !B.billingTokenOk("acme", SITE, tok, now, ""));
t("a far-future expiry is refused (a link lives ten minutes)", !B.billingTokenOk("acme", SITE, `${Math.floor(now / 1000) + 3600}.${"A".repeat(32)}`, now, KEY));
t("junk is refused", !B.billingTokenOk("acme", SITE, "abc", now, KEY) && !B.billingTokenOk("acme", SITE, "", now, KEY));

// ---- the line a manager reads
t("good standing, no cancel date: no line", B.lineFor({ stage: "subscribed", standing: "good" }) === null);
t("a demo: no line", B.lineFor({ stage: "demo", standing: "unpaid" }) === null);
const pd = B.lineFor({ stage: "subscribed", standing: "past_due" });
t("past due: amber, update the card, nothing stops", pd.level === "amber" && /did not go through/.test(pd.text) && /Nothing stops/.test(pd.text));
const up = B.lineFor({ stage: "subscribed", standing: "unpaid" });
t("unpaid: red, AI paused, tools running, a way to reach Anetix", up.level === "red" && /new AI work is paused/.test(up.text) && /tools keep running/.test(up.text) && /brendan@anetix\.ai/.test(up.text));
const ca = B.lineFor({ stage: "subscribed", standing: "good", cancel_at: "2026-10-27T12:00:00Z" });
t("a cancel date: when it ends, what happens after, how to keep it", ca.level === "amber" && /ends on October 27, 2026/.test(ca.text) && /back to a demo/.test(ca.text) && /Manage billing/.test(ca.text), ca);
t("unpaid wins over a cancel date (it ends now anyway)", B.lineFor({ stage: "subscribed", standing: "unpaid", cancel_at: "2026-10-27T12:00:00Z" }).level === "red");
t("no dashes in any line", ![pd, up, ca].some((l) => /[–—]/.test(l.text)));

// ---- the alert
process.env.NTFY_TOPIC = "unit-topic";
const p = N.payload("A site cancelled", "Acme  cancelled.\n It ends soon.", { priority: 9, tags: ["wave", "", "x"] });
t("an alert: the topic, the words tidied, priority kept to ntfy's 1 to 5, empty tags dropped", p.topic === "unit-topic" && p.title === "A site cancelled" && p.message === "Acme cancelled. It ends soon." && p.priority === 5 && JSON.stringify(p.tags) === JSON.stringify(["wave", "x"]), p);
t("a long message is cut at 1000 characters", N.payload("t", "x".repeat(2000)).message.length === 1000);
delete process.env.NTFY_TOPIC;
t("no topic: not configured", N.configured() === false);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
