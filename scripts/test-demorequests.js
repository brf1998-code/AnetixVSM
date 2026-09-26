// Unit checks for src/demorequests.js, the pure part: the form's fields and the message that goes out with a pin.
// No database: node scripts/test-demorequests.js
const d = require("../src/demorequests");
let pass = 0, fail = 0;
const t = (name, ok, detail) => { if (ok) pass++; else { fail++; console.log(`FAIL  ${name}${detail !== undefined ? "\n      " + JSON.stringify(detail) : ""}`); } };
const good = { name: "  Sam   Lee ", email: " Sam.Lee@AcmeWire.test ", company: "Acme Wire", wants: "both", size: "100-499", heard: "linkedin", goal: "Line one\r\nLine two" };
const c = d.check(good);
t("a good request: cleaned, the email lower case, the goal keeps its lines", c.ok && c.row.name === "Sam Lee" && c.row.email === "sam.lee@acmewire.test" && c.row.goal === "Line one\nLine two" && c.row.wants === "both", c);
t("each missing piece is named, in order", d.check({}).field === "name" && d.check({ name: "Sam" }).field === "email" && d.check({ name: "Sam", email: "s@a.test" }).field === "company" && d.check({ name: "Sam", email: "s@a.test", company: "Acme" }).field === "wants");
t("a bad email is refused", d.check({ ...good, email: "sam at acme" }).field === "email");
t("a size or source it does not know is dropped, not refused", (() => { const x = d.check({ ...good, size: "huge", heard: "a bird" }); return x.ok && x.row.size === null && x.row.heard === null; })());
t("long answers are cut to size", d.check({ ...good, name: "x".repeat(500), goal: "y".repeat(5000) }).row.name.length === 100 && d.check({ ...good, goal: "y".repeat(5000) }).row.goal.length === 2000);
let wwwPages = null; try { wwwPages = require("fs").readFileSync(require("path").join(__dirname, "../../www/pages.js"), "utf8"); } catch (e) {}   // the www checkout beside this one, when there is one
if (wwwPages) t("the lists match the form on anetix.ai", (() => { const p = wwwPages; return d.SIZES.every((s) => p.includes(`"${s}"`)) && d.HEARD.every((s) => p.includes(`"${s}"`)) && d.WANTS.every((s) => p.includes(`["${s}"`)); })());
const m = d.messageFor({ name: "Sam Lee", email: "sam@acme.test", pin: "K7RM-4XQP", days: 30, url: "https://anetix.ai" });
t("the message: first name, the pin, the email, the link, how long", /^Hi Sam,/.test(m) && m.includes("K7RM-4XQP") && m.includes("sam@acme.test") && m.includes("https://anetix.ai/pin") && /30 days/.test(m));
t("no dashes and no we in it (it goes out)", !/[–—]/.test(m) && !/ - /.test(m) && !/\b(we|our)\b/i.test(m), m);
t("a pin that never expires says nothing about days", !/days/.test(d.messageFor({ name: "", email: "a@b.co", pin: "X", days: 0, url: "u" })) && /^Hi there,/.test(d.messageFor({ name: "", email: "a@b.co", pin: "X", days: 0, url: "u" })));
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
