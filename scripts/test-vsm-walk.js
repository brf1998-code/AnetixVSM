// Unit cases for the mapping walk's pure parts (src/vsm-walk.js): what the read's answer is brought to, and how the
// draft is drawn. No database, no network.
//   node scripts/test-vsm-walk.js
let pass = 0, fail = 0;
function t(name, cond, detail) { if (cond) { pass++; } else { fail++; console.log(`FAIL  ${name}${detail !== undefined ? "\n      " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : ""}`); } }
const W = require("../src/vsm-walk");

(async () => {
  // ---- the read, brought to shape
  const ctx = { tools: [{ name: "mo-board", title: "MO Board", live: true }], stages: [{ ref: "03", name: "Kitting" }], sources: [{ title: "Walk-through" }, { title: "Arthur's PDF" }] };
  const raw = {
    plant: { makes: "Clocks", orders: "Shopify" },
    families: [{ key: "Mech!", name: "Mechanical" }, { key: "q", name: "Quartz" }, { key: "x", name: "" }],
    customer: { who: "Retail", demand: "", ships: "weekly", quote: "We ship Fridays", source: 1 },
    systems: [{ name: "Fishbowl", used_for: "orders" }, { name: "fishbowl", used_for: "dup" }],
    control: [{ key: "oe", name: "Order entry", how: "system", system: "Fishbowl", record_kind: "other", tools: [] }, { key: "mo", name: "Make the MO", how: "carrier pigeon", record_kind: "anetix", tools: ["MO Board"] }],
    steps: [
      { key: "kit", families: ["Mech!"], name: "Kit", trigger: { from: "mo", how: "system", text: "the MO" }, record_kind: "anetix", tools: ["mo-board", "no-such-tool"], stages: ["03", "99"], numbers: [{ label: "C/T", value: "" }], what: "We sync the parts list.", quote: "we sync it by hand", source: 2, confidence: "seen" },
      { key: "ship", families: ["Mech!", "q"], name: "Ship", trigger: { from: "nowhere" }, record_kind: "anetix", tools: ["no-such-tool"], record_system: "Fishbowl", confidence: "maybe" },
      { key: "noname", name: "" },
    ],
    supplier: { name: "Swiss parts", record_kind: "bogus" },
    questions: [{ step: "kit", claim: "Kit is one step", why: "said once" }, { step: "", claim: "" }],
  };
  const ex = await W.cleanExtraction(raw, ctx, null);
  t("families get keys of their own, and one with no name is dropped", ex.families.map((f) => f.key).join() === "mech,q", ex.families);
  t("steps and control steps are keyed s1, c1 in order, a step with no name dropped", ex.steps.map((s) => s.key).join() === "s1,s2" && ex.control.map((c) => c.key).join() === "c1,c2");
  t("a step's families and its trigger point at the new keys", ex.steps[0].families.join() === "mech" && ex.steps[1].families.join() === "mech,q" && ex.steps[0].trigger.from === "c2" && ex.steps[1].trigger.from === "arrival");
  t("only the company's own tools and stages stay", ex.steps[0].tools.join() === "mo-board" && ex.steps[0].stages.join() === "03");
  t("an Anetix record with no real tool becomes another system or nothing", ex.steps[1].record_kind === "other" && ex.steps[0].record_kind === "anetix");
  t("a control step's way of passing on is one of three", ex.control[1].how === "word" && ex.control[1].record_kind === "anetix" && ex.control[1].tools.join() === "mo-board");
  t("a generated line that cannot be said plainly is dropped; the person's own words are kept as said", ex.steps[0].what === "" && ex.steps[0].quote === "we sync it by hand" && ex.steps[0].quote_by === "Arthur's PDF");
  t("a number nobody said is ?, and so is a wait", ex.steps[0].numbers[0].value === "?" && ex.steps[0].waits_before === "?" && ex.customer.demand === "?");
  t("a confidence that is not one of the three is assumed", ex.steps[1].confidence === "assumed" && ex.steps[0].confidence === "seen");
  t("systems are named once", ex.systems.length === 1);
  t("a question points at its step; one with no words is dropped", ex.questions.length === 1 && ex.questions[0].about === "s1");
  t("a supplier's record is one of the kinds", ex.supplier.record_kind === "none");
  const many = await W.cleanExtraction({ steps: Array.from({ length: 40 }, (_, i) => ({ name: `Step ${i}` })), control: Array.from({ length: 9 }, (_, i) => ({ name: `C ${i}` })) }, ctx, null);
  t("at most 24 steps and 6 control steps are kept", many.steps.length === 24 && many.control.length === 6);
  t("nothing at all is still a shape", (await W.cleanExtraction(null, ctx, null)).steps.length === 0);

  // ---- the draft
  const step = (key, name, extra = {}) => ({ key, name, who: "", where: "", what: "", trigger: { from: "arrival", how: "word", text: "" }, record_kind: "none", record_system: "", tools: [], stages: [], waits_before: "?", numbers: [], confirmed: true, ...extra });
  const walk = {
    frame: { family_name: "Mechanical", customer: { who: "Retail", demand: "20 a day", ships: "daily" }, systems: ["Fishbowl"] },
    chain: ["s3", "s2", "s1"],   // from shipping upstream
    steps: { s1: step("s1", "Kit", { trigger: { from: "c2", how: "system", text: "the MO" }, record_kind: "anetix", tools: ["mo-board"], numbers: [{ label: "C/T", value: "5 min" }], waits_before: "3 days" }), s2: step("s2", "Build", { unsure: true, note: "two people?" }), s3: step("s3", "Ship", { numbers: [{ label: "C/T", value: "2 min" }], waits_before: "a cart" }) },
    walk: { supplier: { name: "Swiss parts", record_kind: "paper" }, control: [{ key: "c1", name: "Order in", how: "system", system: "Shopify", record_kind: "other", tools: [] }, { key: "c2", name: "MO", how: "word", system: "", record_kind: "anetix", tools: ["mo-board"] }] },
    extraction: { steps: [], questions: [{ about: null, claim: "Ships daily", why: "said once", ask: "Bob" }] },
  };
  const d = W.buildDraft(walk, ctx.tools);
  const procs = d.nodes.filter((n) => n.kind === "process");
  t("the process row runs in flow order, left to right, a step apart", procs.map((n) => n.label).join() === "Kit,Build,Ship" && procs.every((n, i) => n.x === 288 + 200 * i && n.y === 400));
  const ctl = d.nodes.filter((n) => n.kind === "control");
  t("production control runs right to left across its band, the order in first", ctl[0].label === "Order in" && ctl[0].x > ctl[1].x && d.layout.bands.length === 1 && ctl.every((n) => n.x >= d.layout.bands[0].x && n.x + n.w <= d.layout.bands[0].x + d.layout.bands[0].w));
  t("the customer wears where its orders are kept", d.nodes.find((n) => n.key === "cus").record_kind === "other" && d.nodes.find((n) => n.key === "cus").sub === "20 a day");
  const e = (a, b) => d.edges.find((x) => x.from === a && x.to === b);
  t("supply, push and ship flows join the row; each push carries what waits before the next step", e("sup", "p-s1").kind === "supply" && e("sup", "p-s1").inventory.label === "3 days" && e("p-s1", "p-s2").kind === "push" && e("p-s2", "p-s3").inventory.label === "a cart" && e("p-s3", "cus").kind === "ship");
  t("information flows: the customer to the order, control to control, control to the step it starts", e("cus", "c-c1").kind === "info_system" && e("c-c1", "c-c2").kind === "info_word" && e("c-c2", "p-s1").kind === "info_system" && !d.edges.some((x) => x.to === "p-s2" && x.kind.startsWith("info")));
  t("a box kept in a tool names it", procs[0].modules.join() === "mo-board" && /MO Board/.test(procs[0].detail.anetix));
  t("an unsure step is drawn as assumed", procs[1].confidence === "assumed" && procs[1].detail.notes === "two people?");
  const claims = d.questions.map((x) => x.claim);
  t("questions: every unknown, every unsure step, the reader's own; none where everything was said", claims.includes("Build: C/T, what waits before it not known yet.") && claims.includes("Is Build drawn right?") && claims.includes("Ships daily") && !claims.some((c) => /^Kit:|^Ship:/.test(c)), claims);
  const crowded = JSON.parse(JSON.stringify(walk));
  crowded.chain = ["s1"]; crowded.walk.control = Array.from({ length: 6 }, (_, i) => ({ key: `c${i + 1}`, name: `C${i}`, how: "word", system: "", record_kind: "none", tools: [] }));
  const d2 = W.buildDraft(crowded, []);
  const c2 = d2.nodes.filter((n) => n.kind === "control").sort((a, b) => a.x - b.x);
  t("six control steps over one process step: the band widens so no two boxes touch", c2.every((n, i) => i === 0 || n.x - c2[i - 1].x >= 168) && d2.nodes.find((n) => n.key === "cus").x >= d2.layout.bands[0].x + d2.layout.bands[0].w);
  let threw = null; try { W.buildDraft({ ...walk, chain: [] }, []); } catch (x) { threw = x; }
  t("no step walked, no map", threw && threw.status === 400);

  // ---- files and names
  t("a file's kind: pdf, photo, sheet, text, or nothing", W.fileKind("application/pdf", "a.bin") === "pdf" && W.fileKind("", "board.JPG") === "image" && W.fileKind("", "export.xlsx") === "sheet" && W.fileKind("text/plain", "x") === "text" && W.fileKind("", "notes.vtt") === "text" && W.fileKind("application/msword", "spec.docx") === null);
  t("a family on the map and in the sources is the same family by name", W.sameName("Mechanical · 12E movement", "Mechanical") && W.sameName("Quartz B2B", "quartz") && !W.sameName("Quartz", "Mechanical") && !W.sameName("", "x"));
  t("no words of the walk carry an em or en dash", !/[–—]/.test(require("fs").readFileSync(require("path").join(__dirname, "../src/vsm-walk.js"), "utf8") + require("fs").readFileSync(require("path").join(__dirname, "../src/mcp-vsm.js"), "utf8")));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
