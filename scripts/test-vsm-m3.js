// Unit cases for VSM M3 (src/vsm-kaizen.js: a new tool request pre-filled from a box, the future state checked against
// the map and drawn) and the floor's side (src/vsm-floor.js: a page's screen, who a screen is for). No database, no network.
//   node scripts/test-vsm-m3.js
let pass = 0, fail = 0;
function t(name, cond, detail) { if (cond) { pass++; } else { fail++; console.log(`FAIL  ${name}${detail !== undefined ? "\n      " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : ""}`); } }
const K = require("../src/vsm-kaizen"), F = require("../src/vsm-floor");
const fs = require("fs"), path = require("path");
const Q = require("../src/intake-questions");

// ---- a new tool request from a box
const stages = [{ ref: "03", name: "Kit the order" }, { ref: "04", name: "Check the kit" }];
const kit = { key: "kit", kind: "process", label: "Kitting", record_kind: "paper", record_system: "a clipboard", stage_refs: ["03", "04"], detail: { what: "Pulls parts for each MO", missing: "Which kit is short" } };
const a = K.prefillFromBox(kit, stages, "Track kits so nobody walks the floor asking");
t("the request's words and the box's own words become the purpose", /Track kits/.test(a.purpose) && /On the map: Kitting, where pulls parts/.test(a.purpose) && /Not recorded today: Which kit is short/.test(a.purpose), a.purpose);
t("a process box is the floor's, a box on paper is kept on paper", JSON.stringify(a.who) === JSON.stringify({ floor: "" }) && JSON.stringify(a.today) === JSON.stringify({ picks: ["paper"] }));
t("two or more of the plant's stages become its stages, in order", JSON.stringify(a.stages) === JSON.stringify(["Kit the order", "Check the kit"]));
const fixed = Object.fromEntries(Q.FIXED.map((x) => [x.id, x]));
t("every pre-filled answer counts as answered for its question", Object.entries(a).every(([k, v]) => fixed[k] && Q.answered(fixed[k], v)), Object.keys(a));
const ctl = K.prefillFromBox({ key: "plan", kind: "control", label: "Plan", record_kind: "other", record_system: "Fishbowl" }, stages, "x");
t("a production control box is the office's; another system is named, and is what it works with", JSON.stringify(ctl.who) === JSON.stringify({ office: "" }) && ctl.today.picks[0] === "program" && ctl.today.names.program === "Fishbowl" && ctl.works_with.names.program === "Fishbowl", ctl);
t("a spreadsheet is a spreadsheet; nothing kept is nothing", K.prefillFromBox({ kind: "process", record_kind: "other", record_system: "Excel sheet" }, [], "x").today.picks[0] === "spreadsheet" && K.prefillFromBox({ kind: "process", record_kind: "none" }, [], "x").today.picks[0] === "none");
t("one stage is not a list of stages; a supplier box says nothing of who", !K.prefillFromBox({ ...kit, stage_refs: ["03"] }, stages, "x").stages && !K.prefillFromBox({ kind: "supplier", label: "Acme" }, [], "x").who);

// ---- the future state: checked against the map
const nodes = [
  { key: "plan", kind: "control", label: "Plan", x: 400, y: 40, w: 144, h: 64, record_kind: "other", record_system: "Fishbowl", modules: [], data: [], detail: {} },
  { key: "kit", kind: "process", label: "Kitting", x: 100, y: 300, w: 144, h: 64, record_kind: "paper", modules: [], data: [{ label: "C/T", value: "?" }], detail: { quote: "We walk the floor looking for parts every morning", quote_by: "Bob", steps: [{ module: "x", step: "y" }], screen: { module: "x", route: "/" } } },
  { key: "asm", kind: "process", label: "Assembly", x: 400, y: 300, w: 144, h: 64, record_kind: "anetix", modules: ["mo-board"], data: [{ label: "C/T", value: "30 min" }], detail: {} },
  { key: "ship", kind: "process", label: "Ship", x: 700, y: 300, w: 144, h: 64, record_kind: "none", modules: [], data: [], detail: {} },
];
const edges = [
  { from_key: "plan", to_key: "kit", kind: "info_word", label: "Dorothy tells them", from_side: "bottom", to_side: "top", from_at: 0.5, to_at: 0.5, inventory: null, sort: 0 },
  { from_key: "kit", to_key: "asm", kind: "push", label: "", from_side: "right", to_side: "left", from_at: 0.5, to_at: 0.5, inventory: { label: "3 days" }, sort: 1 },
  { from_key: "asm", to_key: "ship", kind: "push", label: "", from_side: "right", to_side: "left", from_at: 0.5, to_at: 0.5, inventory: null, sort: 2 },
];
const ctx = { map: { key: "mech", family: "Mechanical" }, nodes, edges, kaizen: [], questions: [], live: null, walled: false, tools: [{ name: "mo-board", title: "MO Board" }], company_name: "Acme" };
const raw = {
  summary: "Pull kits into assembly from a supermarket.",
  bursts: [
    { node: "kit", title: "A kit supermarket", why: "Bob walks the floor.", becomes: "change", evidence: { kind: "quote", text: "walk the floor looking for parts" } },
    { node: "kit", title: "Made-up quote", why: "x", becomes: "plant", evidence: { kind: "quote", text: "nobody ever said this sentence" } },
    { node: "asm", title: "Wait before assembly", why: "Three days of kits wait.", becomes: "change", evidence: { kind: "wait", text: "3 days" } },
    { node: "plan", title: "Put the dispatch in a system", why: "Told in person.", becomes: "new_tool", evidence: { kind: "word", text: "Dorothy tells them" } },
    { node: "ship", title: "Record shipping", why: "Nothing kept.", becomes: "new_tool", evidence: { kind: "no_record", text: "Ship" } },
    { node: "asm", title: "Know the cycle", why: "x", becomes: "plant", evidence: { kind: "unknown", text: "C/T" } },
    { node: "nowhere", title: "Off the map", why: "x", becomes: "plant", evidence: { kind: "quote", text: "anything at all here" } },
  ],
  flows: [{ from: "kit", to: "asm", kind: "supermarket", label: "kit market" }, { from: "asm", to: "ship", kind: "push" }, { from: "plan", to: "asm", kind: "info_system", label: "MO Board" }, { from: "kit", to: "gone", kind: "pull" }],
  records: [{ node: "ship", record_kind: "anetix", note: "Kept in a shipping tool" }, { node: "asm", record_kind: "anetix" }, { node: "zzz", record_kind: "paper" }],
};
const c = K.checkFuture(ctx, raw);
t("a burst stands on a quote that is on the box, a wait before it, a word-of-mouth flow, a step with no record", ["A kit supermarket", "Wait before assembly", "Put the dispatch in a system", "Record shipping"].every((x) => c.bursts.some((b) => b.title === x)), c.bursts.map((b) => b.title));
t("a quote nobody said, a ? the box does not have, and a box not on the map are left out, and said so", !c.bursts.some((b) => /Made-up|Know the cycle|Off the map/.test(b.title)) && c.left_out.filter((l) => /^"/.test(l)).length === 3 && c.left_out.some((l) => /its box is not on the map/.test(l)), c.left_out);
t("a change on a box with no Anetix tool is a new tool", c.bursts.find((b) => b.title === "A kit supermarket").becomes === "new_tool" && c.bursts.find((b) => b.title === "Wait before assembly").becomes === "change");
t("a flow change on boxes that are there; the same kind is no change; a box not there is left out", c.flows.length === 2 && c.flows[0].was === "push" && c.flows[1].kind === "info_system" && c.flows[1].was === null && c.left_out.some((l) => /kit to gone/.test(l)), c.flows);
t("a record change only where it changes", c.records.length === 1 && c.records[0].node === "ship" && c.records[0].was === "none", c.records);
t("at most eight bursts", K.checkFuture(ctx, { bursts: Array.from({ length: 12 }, (_, i) => ({ node: "ship", title: `B${i}`, why: "", becomes: "plant", evidence: { kind: "no_record", text: "" } })) }).bursts.length === K.MAX_BURSTS);
t("nothing at all is nothing", K.checkFuture(ctx, null).bursts.length === 0 && K.checkFuture(ctx, "x").flows.length === 0);

// ---- the future state: drawn
const d = K.drawFuture(ctx, c);
t("the same boxes, in the same places", d.nodes.length === 4 && d.nodes.every((n, i) => n.key === nodes[i].key && n.x === nodes[i].x));
t("a box's record changes where the draft says, with its note, as a guess", d.nodes.find((n) => n.key === "ship").record_kind === "anetix" && d.nodes.find((n) => n.key === "ship").detail.future === "Kept in a shipping tool" && d.nodes.find((n) => n.key === "ship").confidence === "assumed");
t("a future box is not where today's work is reported or shown", !d.nodes.find((n) => n.key === "kit").detail.steps && !d.nodes.find((n) => n.key === "kit").detail.screen && d.nodes.find((n) => n.key === "kit").detail.quote);
t("a flow's kind changes; a new information flow runs from production control down", d.edges.find((e) => e.from_key === "kit" && e.to_key === "asm").kind === "supermarket" && d.edges.find((e) => e.from_key === "kit" && e.to_key === "asm").inventory.label === "3 days"
  && d.edges.some((e) => e.from_key === "plan" && e.to_key === "asm" && e.kind === "info_system" && e.from_side === "bottom" && e.to_side === "top"));
t("the bursts are numbered from one, with their evidence", d.kaizen.map((z) => z.n).join() === "1,2,3,4" && d.kaizen[0].evidence.kind === "quote");
t("the current map is not changed by drawing", nodes[3].record_kind === "none" && edges[1].kind === "push" && nodes[1].detail.steps.length === 1);

// ---- fake mode's draft passes its own check, but for the one burst meant to be left out
const fc = K.checkFuture(ctx, K.fakeFuture(ctx));
t("the canned draft of fake mode is mostly kept, one burst left out", fc.bursts.length >= 2 && fc.left_out.length === 1 && fc.flows.length === 1, { b: fc.bursts, l: fc.left_out });

// ---- the floor: a page's screen
const routes = ["/", "/station", "/station/:seq", "/stock"];
t("a page is on the most specific screen that fits it", F.routeOf(routes, "/station/3") === "/station/:seq" && F.routeOf(routes, "/station") === "/station" && F.routeOf(routes, "/station/") === "/station" && F.routeOf(routes, "/") === "/" && F.routeOf(routes, "/stock?x=1") === "/stock");
t("a page on no screen is on none", F.routeOf(routes, "/nope") === null && F.routeOf(routes, "/station/3/4") === null);
t("only a live screen of the tool, never a preview or the test floor", F.liveRel("acme", "line", "/c/acme/m/line/station/2") === "/station/2" && F.liveRel("acme", "line", "/c/acme/m/line") === "/" && F.liveRel("acme", "line", "/c/acme/staging/m/line/station/2") === null
  && F.liveRel("acme", "line", "/c/acme/test/m/line/") === null && F.liveRel("acme", "line", "/c/other/m/line/") === null && F.liveRel("acme", "line", "/c/acme/m/lines/") === null);
const tagged = F.applyTags([{ route: "/", for: "office" }, { route: "/station/:seq", for: null }, { route: "/stock", for: "floor" }], { "/station/:seq": "floor", "/stock": "office" });
t("a manager's tag fills an untagged screen and wins over the tool's own word", tagged[1].for === "floor" && tagged[1].tag_by_manager && tagged[2].for === "office" && tagged[0].for === "office" && !tagged[0].tag_by_manager);

t("no words of M3's code carry an em or en dash", !/[\u2013\u2014]/.test(["src/vsm-kaizen.js", "src/vsm-floor.js"].map((f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8")).join("")));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
