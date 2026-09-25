// Unit tests for the data wall's pure parts (src/datawall.js): migrations withheld and restored, the files a model
// reads, the element cut to its place, and the value-free check wording (src/acceptance.js). No database.
//   node scripts/test-datawall.js
const fs = require("fs"), os = require("os"), path = require("path");
const W = require("../src/datawall");
const A = require("../src/acceptance");
let pass = 0, fail = 0;
const t = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log(`FAIL  ${name}${detail !== undefined ? "\n      " + JSON.stringify(detail).slice(0, 500) : ""}`); } };

const MIG = `CREATE TABLE IF NOT EXISTS items (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'new'
);
CREATE INDEX IF NOT EXISTS items_stage ON items (stage);
INSERT INTO items (name) VALUES
  ('CANARY-7731 bracket'),
  ('Acme housing');
ALTER TABLE items ADD COLUMN IF NOT EXISTS note TEXT;
INSERT INTO items (name, note) VALUES ('Widget 9', 'CANARY-7731 again');
`;
// ---- withheldMigration
{
  const w = W.withheldMigration(MIG);
  t("every INSERT goes, CREATE, INDEX and ALTER stay", w.withheld === 2 && !/CANARY/.test(w.text) && !/INSERT/i.test(w.text) && /CREATE TABLE/.test(w.text) && /CREATE INDEX/.test(w.text) && /ALTER TABLE items ADD COLUMN/.test(w.text), w.text);
  t("the note says why", (w.text.match(/starting rows withheld/g) || []).length === 2);
  const none = W.withheldMigration("CREATE TABLE t (id SERIAL PRIMARY KEY);\n");
  t("a migration with no rows is returned as it was", none.withheld === 0 && none.text === "CREATE TABLE t (id SERIAL PRIMARY KEY);\n");
  const commented = W.withheldMigration("-- the starting list\nINSERT INTO t (x) VALUES ('CANARY');\n");
  t("an INSERT behind a comment line goes too", commented.withheld === 1 && !/CANARY/.test(commented.text));
  t("empty in, empty out", W.withheldMigration("").withheld === 0);
}
// ---- filesForModel
{
  const files = { "module.json": "{}", "routes.js": "const x = 'CANARY-7731';", "migrations/001.sql": MIG, "migrations/002.sql": "INSERT INTO items (name) VALUES ('CANARY-7731');\n", "pages/board.html": "<p>CANARY-7731</p>", "checks/001-x.json": "{}" };
  const open = W.filesForModel(files, false);
  t("with the wall down the files are the same object", open === files);
  const walled = W.filesForModel(files, true);
  t("with the wall up every migration is withheld and nothing else changes", !/CANARY/.test(walled["migrations/001.sql"]) && !/CANARY/.test(walled["migrations/002.sql"]) && walled["routes.js"] === files["routes.js"] && walled["pages/board.html"] === files["pages/board.html"] && Object.keys(walled).length === Object.keys(files).length, walled);
  t("the original is untouched", /CANARY/.test(files["migrations/001.sql"]));
  t("no files, no crash", W.filesForModel(null, true) === null);
}
// ---- withhold and restore on a folder
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sos-wall-"));
  const from = { "migrations/001.sql": MIG, "migrations/002.sql": "CREATE TABLE t2 (id INT);\n", "routes.js": "x" };
  for (const [f, c] of Object.entries(from)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), c); }
  fs.writeFileSync(path.join(dir, "migrations", "003.sql"), "INSERT INTO t2 (id) VALUES (1);\n");   // written after (not in from): left alone
  const withheld = W.withhold(dir, from);
  t("only migrations that existed before and carry rows are withheld", withheld.join() === "migrations/001.sql", withheld);
  t("the folder's copy carries no rows while withheld", !/CANARY/.test(fs.readFileSync(path.join(dir, "migrations/001.sql"), "utf8")) && /CANARY|INSERT/.test(fs.readFileSync(path.join(dir, "migrations/003.sql"), "utf8")) === true);
  t("002 with no rows is untouched", fs.readFileSync(path.join(dir, "migrations/002.sql"), "utf8") === from["migrations/002.sql"]);
  W.restore(dir, from, withheld);
  t("restore puts the original back byte for byte", fs.readFileSync(path.join(dir, "migrations/001.sql"), "utf8") === MIG);
  t("withhold on a folder missing the file is harmless", W.withhold(dir, { "migrations/009.sql": MIG }).length === 0);
  fs.rmSync(dir, { recursive: true, force: true });
}
// ---- the element
{
  const el = { tag: "td", id: "cell-3", classes: ["qty"], text: "CANARY-7731", label: "CANARY label", html: "<td>CANARY-7731</td>", path: "table > tr > td", rect: { x: 1, y: 2, w: 3, h: 4, vw: 100, vh: 100 } };
  const cut = W.element(el);
  t("the element keeps its place and loses what it showed", cut.tag === "td" && cut.id === "cell-3" && cut.path && cut.rect && cut.text === undefined && cut.label === undefined && cut.html === undefined, cut);
  t("nothing in, nothing out", W.element(null) === null);
}
// ---- value-free check wording
{
  const hid = A.match({ requests: [{ requested_by: "CANARY-7731", qty: 2 }], total: 7 }, { requests: { $contains: { requested_by: "Ann" } }, total: 9, name: "x" }, "the answer", true);
  t("with values hidden no answer value is quoted, expected values still are", !hid.join(" ").includes("CANARY") && !hid.join(" ").includes("7") && /expected 9/.test(hid.join(" ")) && /Ann/.test(hid.join(" ")), hid);
  const shown = A.match({ total: 7 }, { total: 9 }, "the answer", false);
  t("with the wall down the value is quoted as before", /is 7, expected 9/.test(shown.join(" ")), shown);
  const typed = A.match({ n: "CANARY" }, { n: { $type: "number" } }, "the answer", true);
  t("a type mismatch names the type, not the value", /is a string \(a string\), expected number/.test(typed.join(" ")) && !/CANARY/.test(typed.join(" ")), typed);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
