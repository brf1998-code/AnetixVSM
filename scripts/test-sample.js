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
const td = s.tidy({ rows: JSON.stringify({ sensors: [{ id: 1, code: "A", nope: 2 }, "junk"], ghosts: [{ a: 1 }], notes: [{ code: "n1", body: { x: 1 } }] }), series: { sensors: { every_minutes: 60, back_hours: 999, time_column: "code", columns: {} }, readings: { for_each: { table: "sensors", column: "sensor_id" }, columns: { extra: { a: { around: 5, spread: 1 } }, nope: 1 } } } }, cols);
t("tidy reads rows given as JSON text, drops an unknown table and column and a stray value", td.tables.sensors.length === 1 && !("nope" in td.tables.sensors[0]) && !td.tables.ghosts && td.dropped.some((d) => /ghosts/.test(d)) && td.dropped.some((d) => /nope/.test(d)), td);
t("a structured value where a plain one belongs is dropped, the row kept", td.tables.notes.length === 1 && !("body" in td.tables.notes[0]), td.tables.notes);
t("a timed recipe needs a timestamp column; a for_each recipe is kept with its good columns", !td.series.sensors && td.series.readings && td.series.readings.for_each.table === "sensors" && td.series.readings.columns.extra && !("nope" in td.series.readings.columns), td.series);
t("no answer at all is empty, not a crash", Object.keys(s.tidy(null, cols).tables).length === 0 && Object.keys(s.tidy({ rows: "not json", series: "x" }, cols).series).length === 0);
t("the old shape (tables) is still read", s.tidy({ tables: { notes: [{ code: "a" }] } }, cols).tables.notes.length === 1);
// generateSeries, shaped like Atmosphere Logs: an hourly log with twenty readings in one JSON column, a week back
const ac = {
  logs: [{ name: "id", type: "integer", default: "nextval('l')" }, { name: "slot_start", type: "timestamp with time zone" }, { name: "stage", type: "text" }, { name: "readings", type: "jsonb" }, { name: "taken_by", type: "text" }, { name: "taken_at", type: "timestamp with time zone", default: "now()" }],
  missed: [{ name: "id", type: "integer", default: "nextval('m')" }, { name: "slot_start", type: "timestamp with time zone" }, { name: "explanation", type: "text" }],
  lines: [{ name: "id", type: "integer", default: "nextval('x')" }, { name: "log_id", type: "integer" }, { name: "space", type: "text" }, { name: "gas", type: "text" }, { name: "value", type: "numeric" }],
};
const ak = { pk: { logs: ["id"], missed: ["id"], lines: ["id"] }, fk: {} };
const NOW = Date.UTC(2026, 8, 26, 14, 20);
const gas = { o2: { around: 150, spread: 3, decimals: 1 }, co2: { around: 2.1, spread: 0.3, decimals: 2 } };
const answer = {
  rows: { missed: [{ id: 1, slot_start: "2026-09-26T13:00:00Z", explanation: "relief changeover" }], logs: [{ id: 1, slot_start: "2026-09-26T14:00:00Z", stage: "Steady state", readings: { eng: { o2: 151.2, co2: 2.0 } }, taken_by: "Rios" }] },
  series: {
    logs: { every_minutes: 60, back_hours: 168, time_column: "slot_start", times: { taken_at: [1, 12] }, columns: { stage: { pick: ["Steady state", "Startup"], weights: [9, 1] }, readings: { eng: gas, amr: gas }, taken_by: { pick: ["Rios", "Chen", "Park"] } } },
    lines: { for_each: { table: "logs", column: "log_id" }, combine: { space: ["eng", "amr"], gas: ["o2", "co2"] }, columns: { value: { by: "gas", values: gas } } },
  },
};
const tdy = s.tidy(answer, ac);
const g = s.generateSeries(tdy.tables, tdy.series, ac, ak, { now: NOW });
const gl = g.tables.logs;
t("a week of hourly logs: 169 slots less the two the specific rows hold", g.counts.logs === 167 && gl.length === 168, { gen: g.counts.logs, all: gl.length });
t("the missed hour and the specifically written hour are not logged again", gl.filter((l) => Date.parse(l.slot_start) === Date.parse("2026-09-26T13:00:00Z")).length === 0 && gl.filter((l) => Date.parse(l.slot_start) === Date.parse("2026-09-26T14:00:00Z")).length === 1);
t("the oldest is 168 hours back on the hour", gl.map((l) => Date.parse(l.slot_start)).reduce((a, b) => Math.min(a, b)) === Date.UTC(2026, 8, 19, 14, 0));
const o2 = gl.slice(1).map((l) => l.readings.eng.o2);
t("O2 varies naturally around 150 and stays near it", Math.min(...o2) >= 144 && Math.max(...o2) <= 156 && new Set(o2).size > 20 && Math.abs(o2.reduce((a, b) => a + b) / o2.length - 150) < 1, { min: Math.min(...o2), max: Math.max(...o2) });
t("the JSON column keeps its shape: both spaces, both gases, numbers", gl.slice(1).every((l) => typeof l.readings.amr.co2 === "number" && typeof l.readings.eng.o2 === "number"));
t("taken_at lands 1 to 12 minutes after the slot, never in the future", gl.slice(1).every((l) => { const d = Date.parse(l.taken_at) - Date.parse(l.slot_start); return d >= 60e3 && d <= 12 * 60e3 && Date.parse(l.taken_at) <= NOW; }));
t("the weights hold: mostly steady state", gl.filter((l) => l.stage === "Steady state").length > 130);
t("each log gets one line per space and gas, pointing at it, the value by gas", g.counts.lines === 168 * 4 && g.tables.lines.filter((x) => x.log_id === gl[5].id).length === 4 && g.tables.lines.filter((x) => x.gas === "co2").every((x) => x.value < 3) && g.links.lines.log_id === "logs", { lines: g.counts.lines });
t("the same answer makes the same rows", JSON.stringify(s.generateSeries(tdy.tables, tdy.series, ac, ak, { now: NOW }).tables.logs[10]) === JSON.stringify(gl[10]));
t("the cap holds", Object.values(s.generateSeries(tdy.tables, tdy.series, ac, ak, { now: NOW, max: 100 }).tables).reduce((n, r) => n + r.length, 0) <= 100);
const gh = s.generateSeries(tdy.tables, tdy.series, ac, ak, { now: NOW, held: { slot_start: [Date.UTC(2026, 8, 26, 9, 0)] } });
t("an hour the tool already holds (a log taken by hand) is left free", gh.counts.logs === 166 && !gh.tables.logs.some((l) => Date.parse(l.slot_start) === Date.UTC(2026, 8, 26, 9, 0)));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
