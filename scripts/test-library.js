// Unit cases for src/library.js, the pure part: what the check finds that is a company's own, and how a copy's
// addresses are rewritten. No database: node scripts/test-library.js
const lib = require("../src/library");
let pass = 0, fail = 0;
function t(name, cond, detail) { if (cond) pass++; else { fail++; console.log(`FAIL  ${name}${detail !== undefined ? "\n      " + JSON.stringify(detail) : ""}`); } }

const co = { slug: "chelsea-clock", name: "Chelsea Clock" };
const files = {
  "module.json": JSON.stringify({ name: "bom", title: "BOM", company: "demo", pages: { "/": "pages/board.html" } }),
  "pages/board.html": `<h1>Chelsea Clock parts</h1><a href="/c/chelsea-clock/m/bom/parts">parts</a> Call Joe at 617-555-0142 or joe@chelseaclock.com. <a href="/c/chelsea-clock/m/bom">home</a>`,
  "routes.js": `module.exports = (ctx) => { const inv = ctx.peer("inventory-management-system"); const me = ctx.peer('bom'); return ctx.express.Router(); };`,
  "migrations/001.sql": "CREATE TABLE parts (id serial primary key, name text);\nINSERT INTO parts (name) VALUES ('Ship clock bezel');",
  "pages/other.html": "<p>A demo of the test station for the company</p>",
};
const f = lib.check(files, co, "bom");
const kinds = f.map((x) => x.kind);
t("finds the company's name, whole and by its long word", f.some((x) => x.kind === "name" && /Chelsea Clock/.test(x.label)) && f.some((x) => x.kind === "name" && /"Chelsea"/.test(x.label)), f);
t("finds an email address and a phone number", f.some((x) => x.kind === "contact" && /email/.test(x.label) && /chelseaclock\.com/.test(x.sample)) && f.some((x) => x.kind === "contact" && /phone/.test(x.label)), f);
t("finds rows a migration would insert", f.some((x) => x.kind === "rows" && x.file === "migrations/001.sql" && /INSERT/i.test(x.sample)), f);
t("finds another tool it reads, never itself", f.some((x) => x.kind === "peer" && /inventory-management-system/.test(x.label) && !/\bbom\b/.test(x.label.replace(/^reads another tool: [^ ]+/, ""))), f);
t("reports the company's addresses as rewritten", f.some((x) => x.kind === "path" && x.count === 2), f);
t("most serious first", kinds.indexOf("name") < kinds.indexOf("rows") && kinds.indexOf("rows") < kinds.indexOf("path"), kinds);
t("generic words are never a company's name", lib.check({ "a.html": "the demo of a test company" }, { slug: "demo", name: "Demo" }, "x").length === 0, lib.check({ "a.html": "the demo of a test company" }, { slug: "demo", name: "Demo" }, "x"));
t("example.com and anetix.ai addresses are not a company's", lib.check({ "a.html": "help@anetix.ai or you@example.com" }, co, "x").length === 0);
t("nothing found in a clean tool", lib.check({ "module.json": "{}", "pages/a.html": "<p>Parts on order</p>" }, co, "bom").length === 0);

const r = lib.rewrite(files, { fromCompany: "chelsea-clock", fromName: "bom", toCompany: "prospect-demo", toName: "bom-2", title: "Bill of materials" });
t("the company's addresses point at the new company", !/\/c\/chelsea-clock\//.test(r["pages/board.html"]) && /\/c\/prospect-demo\/m\/bom-2\/parts/.test(r["pages/board.html"]), r["pages/board.html"]);
t("a tool's own address without a slash after it is rewritten too", /\/c\/prospect-demo\/m\/bom-2"/.test(r["pages/board.html"]), r["pages/board.html"]);
t("the manifest takes the title and drops the repo's company", JSON.parse(r["module.json"]).title === "Bill of materials" && !("company" in JSON.parse(r["module.json"])), r["module.json"]);
t("names, contact details and rows are left as they are (the check reports them)", /Chelsea Clock parts/.test(r["pages/board.html"]) && /INSERT/.test(r["migrations/001.sql"]));
t("another tool's address is left alone", lib.rewrite({ "a.html": "/m/bom-extra/ and /m/bom/" }, { fromName: "bom", toName: "bom-2" })["a.html"] === "/m/bom-extra/ and /m/bom-2/");
t("a manifest that does not parse is left as it is", lib.rewrite({ "module.json": "{nope" }, { title: "X" })["module.json"] === "{nope");

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
