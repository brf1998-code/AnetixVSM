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
// tidy: never refuse the whole answer
const td = s.tidy({ tables: JSON.stringify({ sensors: [{ id: 1, code: "A", nope: 2 }, "junk"], ghosts: [{ a: 1 }], notes: [{ code: "n1", body: { x: 1 } }] }), repeat: { sensors: { covers_minutes: 60, back_hours: 24 }, notes: { covers_minutes: 0, back_hours: 5 } } }, cols);
t("tidy reads tables given as JSON text, drops an unknown table and column and a stray value", td.tables.sensors.length === 1 && !("nope" in td.tables.sensors[0]) && !td.tables.ghosts && td.dropped.some((d) => /ghosts/.test(d)) && td.dropped.some((d) => /nope/.test(d)), td);
t("a structured value where a plain one belongs is dropped, the row kept", td.tables.notes.length === 1 && !("body" in td.tables.notes[0]), td.tables.notes);
t("a sensible repeat is kept, a nonsense one dropped", td.repeat.sensors && !td.repeat.notes, td.repeat);
t("no tables at all is an empty answer, not a crash", Object.keys(s.tidy(null, cols).tables).length === 0 && Object.keys(s.tidy({ tables: "not json" }, cols).tables).length === 0);
// expandRepeats: the latest few, copied back with their children
const lc = {
  logs: [{ name: "id", type: "integer", default: "nextval('l')" }, { name: "taken_at", type: "timestamp with time zone" }, { name: "watch", type: "text" }],
  readings: [{ name: "id", type: "integer", default: "nextval('r')" }, { name: "log_id", type: "integer" }, { name: "o2", type: "numeric" }, { name: "space", type: "text" }],
  spaces: [{ name: "id", type: "integer", default: "nextval('s')" }, { name: "name", type: "text" }],
};
const lk = { pk: { logs: ["id"], readings: ["id"], spaces: ["id"] }, fk: {} };
const latest = {
  logs: [{ id: 1, taken_at: "2026-09-26T12:00:00Z", watch: "A" }, { id: 2, taken_at: "2026-09-26T13:00:00Z", watch: "A" }],
  readings: [{ id: 1, log_id: 1, o2: 151.2, space: "ER" }, { id: 2, log_id: 1, o2: 150.8, space: "AMR" }, { id: 3, log_id: 2, o2: 152.0, space: "ER" }],
  spaces: [{ id: 1, name: "ER" }],
};
const ex = s.expandRepeats(latest, { logs: { covers_minutes: 120, back_hours: 24 } }, lc, lk);
t("24 hours back at 2 hours a copy is 12 copies of the logs", ex.logs.length === 2 + 2 * 12, ex.logs.length);
t("each copy's readings come along, pointing at that copy's log", ex.readings.length === 3 + 3 * 12 && ex.readings.filter((r) => r.log_id === "1~3").length === 2 && ex.logs.some((l) => l.id === "1~3"), ex.readings.slice(3, 6));
t("copy 1 is two hours earlier, copy 11 twenty two", ex.logs.find((l) => l.id === "2~1").taken_at === "2026-09-26T11:00:00.000Z" && ex.logs.find((l) => l.id === "1~11").taken_at === "2026-09-25T14:00:00.000Z");
t("the numbers move a little, keep their decimals, and the text stays", ex.readings.filter((r) => r.space === "ER" && r.log_id !== 1 && r.log_id !== 2).every((r) => Math.abs(r.o2 - 151.6) < 6 && /^\d+\.\d$|^\d+$/.test(String(r.o2))));
t("a table outside the family is not copied", ex.spaces.length === 1);
t("the copies stop at the cap", s.expandRepeats(latest, { logs: { covers_minutes: 60, back_hours: 168 } }, lc, lk, { max: 50 }).logs.length + s.expandRepeats(latest, { logs: { covers_minutes: 60, back_hours: 168 } }, lc, lk, { max: 50 }).readings.length <= 50);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
