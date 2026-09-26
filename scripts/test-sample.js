// Unit checks for src/sample.js: the pure parts (order, keys, pointers, JSON values, the fit check).
const s = require("../src/sample");
let pass = 0, fail = 0;
const t = (name, ok, detail) => { if (ok) pass++; else { fail++; console.log(`FAIL  ${name}${detail !== undefined ? "\n      " + JSON.stringify(detail) : ""}`); } };
const cols = {
  sensors: [{ name: "id", type: "integer", default: "nextval('x')" }, { name: "code", type: "text" }],
  readings: [{ name: "id", type: "uuid", default: "gen_random_uuid()" }, { name: "sensor_id", type: "integer" }, { name: "extra", type: "jsonb" }],
  notes: [{ name: "code", type: "text" }, { name: "body", type: "text" }],
};
const keys = { pk: { sensors: ["id"], readings: ["id"], notes: ["code"] }, fk: {} };
t("a counter key is made by the database", s.madeKey("sensors", cols, keys.pk) === "id");
t("so is a key with any default (a uuid)", s.madeKey("readings", cols, keys.pk) === "id");
t("a text key with no default is the AI's", s.madeKey("notes", cols, keys.pk) === null);
const made = { sensors: "id", readings: "id", notes: null };
t("sensor_id points at sensors with no constraint", s.pointers("readings", cols, keys, made).sensor_id === "sensors");
const o = s.fkOrder(["readings", "notes", "sensors"], {}, { readings: ["sensors"] });
t("parents first, by constraints and by <thing>_id", o.indexOf("sensors") < o.indexOf("readings") && o.length === 3, o);
const j = s.jsonReady({ extra: "hello", other: "x" }, cols.readings);
t("a plain string for a JSON column goes in as a JSON string", j.extra === '"hello"' && j.other === "x", j);
t("JSON text stays as it is", s.jsonReady({ extra: '{"a":1}' }, cols.readings).extra === '{"a":1}');
t("an object or a list goes in as JSON", s.jsonReady({ extra: { a: [1, 2] } }, cols.readings).extra === '{"a":[1,2]}' && s.jsonReady({ extra: [1] }, cols.readings).extra === "[1]");
t("the fit check takes an object in a JSON column", s.fitProblems({ readings: [{ sensor_id: 1, extra: { a: 1 } }] }, cols).length === 0);
t("and still refuses one anywhere else, or an unknown column", s.fitProblems({ notes: [{ code: "a", body: { no: 1 } }] }, cols).length === 1 && /no column named/.test(s.fitProblems({ notes: [{ nope: 1 }] }, cols)[0]));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
