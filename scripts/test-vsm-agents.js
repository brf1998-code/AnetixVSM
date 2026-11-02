// Unit cases for the agent board's pure parts (src/vsm-agents.js): the watches drafted from a tool's tables, a watch's
// spec checked for shape, its query, who a flag goes to on the map, and the push. No database, no network.
//   node scripts/test-vsm-agents.js
let pass = 0, fail = 0;
function t(name, cond, detail) { if (cond) { pass++; } else { fail++; console.log(`FAIL  ${name}${detail !== undefined ? "\n      " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : ""}`); } }
const V = require("../src/vsm-agents");
const col = (name, type) => ({ name, type });
const T = "text", TS = "timestamp with time zone", N = "integer", NUMERIC = "numeric", B = "boolean", D = "date";

(async () => {
  // ---- drafted from the tables (Chelsea's tools, as their migrations make them)
  const mo = new Map([
    ["mos", [col("id", N), col("part_no", T), col("stage", T), col("qty", N), col("ship_date", D), col("is_short", B), col("setup_at", TS), col("running_at", TS), col("done_at", TS), col("updated_at", TS)]],
    ["events", [col("id", N), col("mo_id", N), col("kind", T), col("at", TS)]],
    ["machines", [col("id", N), col("name", T), col("sort", N), col("created_at", TS)]],
  ]);
  const values = { "mos.stage": [{ v: "setup", n: 4 }, { v: "running", n: 6 }, { v: "done", n: 30 }, { v: "finishing", n: 2 }] };
  const valuesOf = async (table, c) => values[`${table}.${c}`] || [];
  const moW = await V.proposeFor("mo-board", "MO Board", mo, valuesOf);
  const stuck = moW.find((w) => w.shape === "stuck");
  t("MO Board: stuck at one stage, the open stages only, not done, measured from the last change", stuck && stuck.spec.state_column === "stage" && stuck.spec.states.join() === "setup,running,finishing" && stuck.spec.since_column === "updated_at"
    && stuck.spec.where.some((w) => w.column === "done_at" && w.op === "is empty") && stuck.spec.label_column === "part_no", stuck);
  t("MO Board: coming due by the ship date and not done, as act", moW.some((w) => w.shape === "due" && w.spec.date_column === "ship_date" && w.severity === "act"));
  t("MO Board: marked short", moW.some((w) => w.shape === "waiting" && w.spec.where.some((x) => x.column === "is_short" && x.value === true)));
  t("a log table and a list of machines draft nothing", !moW.some((w) => ["events", "machines"].includes(w.spec.table)));
  t("every tool gets a quiet watch", moW.some((w) => w.shape === "quiet"));
  t("no title carries a number the manager may change", moW.every((w) => !/\d/.test(w.title)), moW.map((w) => w.title));
  const inv = new Map([["parts", [col("id", N), col("part_no", T), col("name", T), col("qty", NUMERIC), col("on_order", NUMERIC), col("low_level", NUMERIC), col("order_level", NUMERIC), col("recount", B), col("updated_at", TS)]]]);
  const invW = await V.proposeFor("inventory-management-system", "Inventory", inv, valuesOf);
  t("Inventory: under the order level with nothing on order, and under the low level", invW.filter((w) => w.shape === "level").map((w) => w.spec.limit_column).sort().join() === "low_level,order_level"
    && invW.find((w) => w.spec.limit_column === "order_level").spec.where.some((x) => x.column === "on_order" && x.op === "<=" && x.value === 0));
  t("Inventory: marked for a recount", invW.some((w) => w.spec.where && w.spec.where.some((x) => x.column === "recount")));
  const ord = new Map([["orders", [col("id", N), col("wo_number", T), col("stage", T), col("sched_finish", D), col("mismatch_note", T), col("created_at", TS), col("closed_at", TS)]]]);
  const ordW = await V.proposeFor("manufacturing-order-board", "Manufacturing Order Board", ord, async () => []);
  t("Manufacturing Order Board: a stage with no rows yet falls back to still open; due by the finish; a mismatch note", ordW.some((w) => w.shape === "waiting" && /still open/.test(w.title)) && ordW.some((w) => w.shape === "due" && w.spec.date_column === "sched_finish")
    && ordW.some((w) => w.spec.where && w.spec.where.some((x) => x.column === "mismatch_note" && x.op === "is not empty") && w.spec.hours === 0) && ordW.every((w) => w.spec.label_column === undefined || w.spec.label_column === "wo_number"), ordW);
  t("every draft passes the shape check", [...moW.map((w) => [w, mo]), ...invW.map((w) => [w, inv]), ...ordW.map((w) => [w, ord])].every(([w, tb]) => { try { V.checkSpec(w.shape, w.spec, tb); return true; } catch (e) { console.log(e.message, w); return false; } }));

  // ---- the shape check
  const bad = (shape, spec, tb = mo) => { try { V.checkSpec(shape, spec, tb); return false; } catch (e) { return e.status === 400; } };
  t("a shape that is not one of the five is refused", bad("delete", {}));
  t("a table the tool does not keep", bad("waiting", { table: "users", since_column: "x", hours: 1 }));
  t("a column that is not there, and a time that is not a time", bad("waiting", { table: "mos", since_column: "nope", hours: 1 }) && bad("waiting", { table: "mos", since_column: "part_no", hours: 1 }));
  t("hours out of range", bad("waiting", { table: "mos", since_column: "updated_at", hours: -1 }) && bad("waiting", { table: "mos", since_column: "updated_at", hours: 99999 }));
  t("a stuck watch needs its open states", bad("stuck", { table: "mos", state_column: "stage", since_column: "updated_at", hours: 1, states: [] }));
  t("a level needs a number column and a limit", bad("level", { table: "mos", column: "part_no", limit: 1 }) && bad("level", { table: "mos", column: "qty" }));
  t("a condition's comparison is from the list, its column real, and it carries a value", bad("waiting", { table: "mos", since_column: "updated_at", hours: 1, where: [{ column: "stage", op: "LIKE", value: "x" }] })
    && bad("waiting", { table: "mos", since_column: "updated_at", hours: 1, where: [{ column: "nope", op: "=", value: "x" }] }) && bad("waiting", { table: "mos", since_column: "updated_at", hours: 1, where: [{ column: "stage", op: "=" }] })
    && bad("waiting", { table: "mos", since_column: "updated_at", hours: 1, where: [{ column: "stage", op: "=", value: { $gt: 1 } }] }));
  t("quiet takes 1 to 60 days", bad("quiet", { days: 0 }) && bad("quiet", { days: 61 }) && V.checkSpec("quiet", { days: 3 }, new Map()).days === 3);

  // ---- the query: names quoted, values as parameters
  const sp = V.checkSpec("stuck", { table: "mos", state_column: "stage", states: ["setup", "x'); DROP TABLE mos; --"], since_column: "updated_at", hours: 72, where: [{ column: "done_at", op: "is empty" }, { column: "part_no", op: "contains", value: "50%" }] }, mo);
  const wq = V.watchQuery("mod_chelsea_clock_mo_board", mo.get("mos"), "stuck", sp);
  t("the query reads only the tool's own schema and table, names quoted", /FROM "mod_chelsea_clock_mo_board"\."mos"/.test(wq.sql) && /"stage"::text = ANY\(\$\d+::text\[\]\)/.test(wq.sql) && /"done_at" IS NULL/.test(wq.sql));
  t("every value is a parameter, none in the text", !/DROP|setup|50/.test(wq.sql) && wq.params.some((p) => Array.isArray(p) && p.includes("x'); DROP TABLE mos; --")) && wq.params.includes(72), wq);
  t("at most ten rows, each with the total", /count\(\*\) OVER \(\) AS total/.test(wq.sql) && /LIMIT 10$/.test(wq.sql));
  const lq = V.watchQuery("s", inv.get("parts"), "level", V.checkSpec("level", { table: "parts", column: "qty", op: "under", limit_column: "order_level" }, inv));
  t("a level against another column leaves out rows with no limit", /"qty" < "order_level"/.test(lq.sql) && /"order_level" IS NOT NULL/.test(lq.sql));
  const dq = V.watchQuery("s", mo.get("mos"), "due", V.checkSpec("due", { table: "mos", date_column: "ship_date", within_hours: 48 }, mo));
  t("due: the date within the hours", /"ship_date" <= now\(\) \+ \(\$\d+::numeric \* interval '1 hour'\)/.test(dq.sql) && dq.params.includes(48));

  // ---- who hears about a flag: the map
  const nodes = [
    { map_id: 1, map_key: "mech", key: "mo", kind: "control", label: "MO cut", who: "Shannon", agent_name: "MO agent", modules: ["mo-board"] },
    { map_id: 1, map_key: "mech", key: "dl", kind: "control", label: "Floor dispatch", who: "Dorothy", agent_name: "", modules: [] },
    { map_id: 1, map_key: "mech", key: "m1", kind: "process", label: "Parts", who: "Bob", agent_name: "Floor agent", modules: ["mo-board"] },
    { map_id: 1, map_key: "mech", key: "m2", kind: "process", label: "Kit", who: "Bruce", agent_name: "Inventory agent", modules: ["inventory"] },
    { map_id: 1, map_key: "mech", key: "m3", kind: "process", label: "Assembly", who: "Arthur", agent_name: "Assembly agent", modules: [] },
    { map_id: 1, map_key: "mech", key: "m4", kind: "process", label: "Bench test", who: "Ann", agent_name: "", modules: [] },
    { map_id: 1, map_key: "mech", key: "sup", kind: "supplier", label: "Suppliers", who: "", agent_name: "Purchasing agent", modules: [] },
  ];
  const edges = [
    { map_id: 1, from_key: "sup", to_key: "m1", kind: "supply" }, { map_id: 1, from_key: "m1", to_key: "m2", kind: "push" }, { map_id: 1, from_key: "m2", to_key: "m3", kind: "push" }, { map_id: 1, from_key: "m3", to_key: "m4", kind: "push" },
    { map_id: 1, from_key: "mo", to_key: "m2", kind: "info_system" }, { map_id: 1, from_key: "dl", to_key: "m1", kind: "info_word" }, { map_id: 1, from_key: "m2", to_key: "mo", kind: "info_system" },
  ];
  const agents = new Map(V.agentsFrom(nodes, [{ id: 1, key: "mo-agent", name: "MO agent", status: "on" }, { id: 2, key: "floor-agent", name: "Floor agent", status: "on" }, { id: 3, key: "inventory-agent", name: "Inventory agent", status: "paused" }], [{ name: "mo-board" }, { name: "inventory" }]).map((a) => [a.key, a]));
  t("agents from the map: the names on its boxes, their tools, and which are set up", agents.get("assembly-agent").status === "not_set_up" && agents.get("assembly-agent").can_set_up === false && agents.get("mo-agent").tools.join() === "mo-board" && agents.get("inventory-agent").status === "paused");
  const fromKit = V.partiesOf(new Set(["mech/m2"]), nodes, edges, agents, "inventory-agent");
  t("a flag at Kit goes to the step before (its agent), the step after (no agent set up: its people) and production control (its agent)", fromKit.some((p) => p.kind === "agent" && p.key === "floor-agent") && fromKit.some((p) => p.kind === "box" && p.key === "mech/m3" && p.people === "Arthur") && fromKit.some((p) => p.kind === "agent" && p.key === "mo-agent") && fromKit.length === 3, fromKit);
  const fromParts = V.partiesOf(new Set(["mech/m1"]), nodes, edges, agents, "floor-agent");
  t("a supplier is not a party; a dispatch box with no agent is, for its people", !fromParts.some((p) => /sup/.test(p.key)) && fromParts.some((p) => p.kind === "box" && p.key === "mech/dl" && p.people === "Dorothy"), fromParts);
  t("a paused agent's area gets a mention for its people instead", V.partiesOf(new Set(["mech/m1"]), nodes, edges, agents, "floor-agent").some((p) => p.kind === "box" && p.key === "mech/m2" && p.people === "Bruce"));
  t("a box two steps away is not a party", !fromParts.some((p) => p.key === "mech/m3" || p.key === "mech/m4"));
  t("an agent never sends to itself", !V.partiesOf(new Set(["mech/m2", "mech/mo"]), nodes, edges, new Map([...agents, ["inventory-agent", { ...agents.get("inventory-agent"), status: "on" }]]), "inventory-agent").some((p) => p.key === "inventory-agent"));

  // ---- the push and the limit words
  const p = V.pushOf("Chelsea Clock", "Inventory agent", "level", 3);
  t("the push: the company, the agent, the kind of flag and the count, nothing else", p.title === "A flag climbed" && /Chelsea Clock: Inventory agent/.test(p.message) && /past its limit, 3 found/.test(p.message) && !/[–—]/.test(p.message + p.title));
  t("the limit in words", V.limitWords("waiting", { hours: 72 }) === "over 3 days" && V.limitWords("waiting", { hours: 0 }) === "" && V.limitWords("due", { within_hours: 5 }) === "within 5 hours" && V.limitWords("level", { op: "under", limit: 10 }) === "under 10");
  t("no words of the board's code carry an em or en dash", !/[–—]/.test(require("fs").readFileSync(require("path").join(__dirname, "../src/vsm-agents.js"), "utf8") + require("fs").readFileSync(require("path").join(__dirname, "../public/agent-board.html"), "utf8")));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
