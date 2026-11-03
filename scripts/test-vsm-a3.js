// Unit cases for the agent board's A3: a tool's drafts declaration and a draft's fields (src/vsm-drafts.js), the live
// numbers from stage events and the stage watch (src/vsm-stages.js), the ticket that tells the platform who acts in a
// tool's own process (src/runner.js), and the module gate's check of a declaration. No database, no network.
//   node scripts/test-vsm-a3.js
let pass = 0, fail = 0;
function t(name, cond, detail) { if (cond) { pass++; } else { fail++; console.log(`FAIL  ${name}${detail !== undefined ? "\n      " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : ""}`); } }
const D = require("../src/vsm-drafts"), S = require("../src/vsm-stages");
const fs = require("fs"), path = require("path"), os = require("os");
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return e.status === 400 && (!re || re.test(e.message)); } };

(async () => {
  // ---- a tool's declaration
  const man = JSON.parse(fs.readFileSync(path.join(__dirname, "../modules/paperline/module.json"), "utf8"));
  const ok = D.checkDeclaration(man.drafts);
  t("the reference tool's declaration is clean", ok.errors.length === 0 && ok.kinds.material_request.screen === "/stock" && ok.kinds.material_request.fields.qty.max === 50 && ok.kinds.material_request.fields.item.choices.length === 4, ok);
  t("no declaration, no kinds and no errors", D.checkDeclaration(undefined).errors.length === 0 && Object.keys(D.checkDeclaration(undefined).kinds).length === 0);
  const bad = D.checkDeclaration({ "Bad Kind": { label: "x", fields: { a: { type: "text" } } }, nolabel: { fields: { a: { type: "text" } } }, nofields: { label: "x" }, badtype: { label: "x", fields: { a: { type: "blob" } } },
    badchoice: { label: "x", fields: { n: { type: "integer", choices: ["a"] } } }, badscreen: { label: "x", screen: "javascript:alert(1)", fields: { a: { type: "text" } } } });
  t("a declaration names what is wrong with each kind", bad.errors.length === 6 && bad.errors.some((e) => /lower case/.test(e)) && bad.errors.some((e) => /a label/.test(e)) && bad.errors.some((e) => /fields, at least one/.test(e))
    && bad.errors.some((e) => /has a type/.test(e)) && bad.errors.some((e) => /choices/.test(e)) && bad.errors.some((e) => /screen is the route/.test(e)), bad.errors);
  t("a declaration that is not an object is one error", D.checkDeclaration([1]).errors.length === 1 && D.checkDeclaration("x").errors.length === 1);

  // ---- a draft's fields
  const k = ok.kinds.material_request;
  t("fields as declared are kept, numbers from words too", JSON.stringify(D.checkFields(k, { item: "clip", qty: "3" })) === JSON.stringify({ item: "clip", qty: 3 }));
  t("a field not declared is refused", throws(() => D.checkFields(k, { item: "clip", qty: 3, price: 1 }), /no field "price"/));
  t("a needed field is needed", throws(() => D.checkFields(k, { item: "clip" }), /Quantity is needed/));
  t("a choice is one of the choices", throws(() => D.checkFields(k, { item: "gold", qty: 1 }), /one of paper_white/));
  t("a whole number is whole, and inside its limits", throws(() => D.checkFields(k, { item: "clip", qty: 1.5 }), /whole number/) && throws(() => D.checkFields(k, { item: "clip", qty: 51 }), /at most 50/) && throws(() => D.checkFields(k, { item: "clip", qty: 0 }), /at least 1/));
  const dk = D.checkDeclaration({ mo: { label: "an MO", fields: { due: { type: "date" }, rush: { type: "boolean" }, note: { type: "text", max_length: 5 } } } }).kinds.mo;
  t("a date is a date, yes or no is a boolean, text is cut to its length", throws(() => D.checkFields(dk, { due: "next week" }), /date like/) && throws(() => D.checkFields(dk, { rush: "yes" }), /yes or no/)
    && D.checkFields(dk, { due: "2026-11-30", rush: true, note: "abcdefgh" }).note === "abcde");

  // ---- who acts
  t("who acts is the platform's word for the request", D.whoOf({ sosRole: "manager" }).name === "a manager" && D.whoOf({ sosRole: "floor", sosPerson: "Kai" }).name === "Kai" && D.whoOf({}).role === null && D.whoOf(null).role === null);

  // ---- the ticket: who is behind a request in a tool's own process
  const R = require("../src/runner");
  const tk = R.newTicket({ sosRole: "floor", sosPerson: "Kai", sosPersonId: 7 }, "acme", "live", "paperline");
  const rec = { company: "acme", lane: "live" };
  t("a ticket gives back the person the platform signed in", R.ticketPerson(rec, "paperline", tk).sosRole === "floor" && R.ticketPerson(rec, "paperline", tk).sosPerson === "Kai");
  t("for its own company, tool and lane only", !R.ticketPerson({ company: "other", lane: "live" }, "paperline", tk).sosRole && !R.ticketPerson(rec, "kpis", tk).sosRole && !R.ticketPerson({ company: "acme", lane: "staged" }, "paperline", tk).sosRole);
  t("a made-up ticket is no one", !R.ticketPerson(rec, "paperline", "f".repeat(32)).sosRole && !R.ticketPerson(rec, "paperline", null).sosRole);

  // ---- stage events: what is kept
  t("a preview's or the test floor's events are not kept", (await S.event("acme", "paperline", "staged", null, { step: "x", ref: "y", kind: "start" })).kept === false && (await S.event("acme", "paperline", "test", null, { step: "x", ref: "y", kind: "start" })).kept === false);
  const evErr = async (ev, re) => { try { await S.event("acme", "paperline", "live", null, ev); return false; } catch (e) { return e.status === 400 && re.test(e.message); } };
  t("an event needs a step, a ref and a kind, and a sane quantity", (await evErr({ ref: "J1", kind: "start" }, /needs a step/)) && (await evErr({ step: "Kit", kind: "start" }, /needs a ref/)) && (await evErr({ step: "Kit", ref: "J1", kind: "go" }, /kind is one of/))
    && (await evErr({ step: "Kit", ref: "J1", kind: "finish", qty: 0 }, /qty/)) && (await evErr({ step: "Kit", ref: "J1", kind: "finish", qty: 1.5 }, /qty/)));

  // ---- the live numbers
  const at = (min) => new Date(Date.parse("2026-11-02T12:00:00Z") + min * 60000).toISOString();
  const ev = (step, ref, kind, min, qty) => ({ module: "line", step, ref, kind, at: at(min), qty: qty || 1 });
  const events = [
    ev("Cut", "J1", "wait", 0), ev("Cut", "J1", "start", 10), ev("Cut", "J1", "finish", 20), ev("Weld", "J1", "start", 50), ev("Weld", "J1", "finish", 80),
    ev("Cut", "J2", "start", 5), ev("Cut", "J2", "finish", 35), ev("Weld", "J2", "start", 45), ev("Weld", "J2", "scrap", 60),
    ev("Cut", "J3", "start", 40), ev("Cut", "J3", "finish", 50), ev("Weld", "J3", "wait", 70),
    ev("Cut", "J4", "start", 90),
  ];
  const nodes = [{ key: "cut", steps: [{ module: "line", step: "Cut" }] }, { key: "weld", steps: [{ module: "line", step: "Weld" }] }, { key: "pack", steps: [] }];
  const edges = [{ from_key: "cut", to_key: "weld", kind: "push" }];
  const c = S.compute(events, nodes, edges, 7, Date.parse(at(100)));
  t("cycle time is the median from start (or the queue, if no start) to finish", c.nodes.cut.runs === 3 && c.nodes.cut.cycle_min === 10 && c.nodes.weld.runs === 1 && c.nodes.weld.cycle_min === 30, c.nodes);
  t("the wait in line before work starts", c.nodes.cut.queue_min === 10);
  t("work in process is what started or waits and is not finished, with the oldest", c.nodes.cut.wip === 1 && c.nodes.cut.oldest_open_min === 10 && c.nodes.weld.wip === 1, c.nodes);
  t("first-pass yield and finished a day", c.nodes.weld.finished === 1 && c.nodes.weld.scrapped === 1 && c.nodes.weld.fpy === 50 && c.nodes.cut.per_day === Math.round(3 / 7 * 10) / 10);
  t("the wait between two boxes on the flow: the last finish at one to the next entry at the other", c.waits["cut>weld"].refs === 3 && c.waits["cut>weld"].wait_min === 20, c.waits);
  t("lead time from the first event to the last finish at the last box", c.lead && c.lead.refs === 1 && c.lead.lead_min === 80, c.lead);
  t("a box with no steps has no numbers", !c.nodes.pack);
  t("no events, no runs", S.compute([], nodes, edges, 7).nodes.cut.runs === 0 && S.compute([], nodes, edges, 7).lead === null);
  // round 2 of the VSM audit (2026-11-03): a part scrap, a rework pass, a job that began before the window
  const part = S.compute([ev("Weld", "J9", "start", 0, 10), ev("Weld", "J9", "scrap", 5, 2), ev("Weld", "J9", "finish", 30, 8)], nodes, edges, 7, Date.parse(at(100)));
  t("a part scrap leaves the run open, so the rest finishes with a cycle time", part.nodes.weld.runs === 1 && part.nodes.weld.cycle_min === 30 && part.nodes.weld.scrapped === 2 && part.nodes.weld.finished === 8 && part.nodes.weld.wip === 0 && part.nodes.weld.fpy === 80, part.nodes.weld);
  const half = S.compute([ev("Weld", "J9", "start", 0, 10), ev("Weld", "J9", "scrap", 5, 4)], nodes, edges, 7, Date.parse(at(100)));
  t("and it is still work in process until it finishes", half.nodes.weld.wip === 1 && half.nodes.weld.oldest_open_min === 100, half.nodes.weld);
  const all = S.compute([ev("Weld", "J9", "start", 0, 3), ev("Weld", "J9", "scrap", 5, 3)], nodes, edges, 7, Date.parse(at(100)));
  t("a scrap of all of it ends the run", all.nodes.weld.wip === 0 && all.nodes.weld.runs === 0, all.nodes.weld);
  const rework = S.compute([ev("Cut", "J7", "start", 0), ev("Cut", "J7", "finish", 10), ev("Weld", "J7", "start", 40), ev("Weld", "J7", "finish", 50), ev("Cut", "J7", "start", 60), ev("Cut", "J7", "finish", 70)], nodes, edges, 7, Date.parse(at(100)));
  t("a rework pass back through the first box keeps the wait the job had between the boxes", rework.waits["cut>weld"] && rework.waits["cut>weld"].wait_min === 30 && rework.waits["cut>weld"].refs === 1, rework.waits);
  const back = S.compute([ev("Cut", "J8", "start", 0), ev("Cut", "J8", "finish", 10), ev("Cut", "J8", "start", 20), ev("Cut", "J8", "finish", 30), ev("Weld", "J8", "start", 45)], nodes, edges, 7, Date.parse(at(100)));
  t("a second pass at the first box before the move waits from the later finish", back.waits["cut>weld"].wait_min === 15 && back.waits["cut>weld"].refs === 1, back.waits);
  const late = S.compute([ev("Weld", "J6", "start", 0), ev("Weld", "J6", "finish", 20)], nodes, edges, 7, Date.parse(at(100)), new Map([["J6", Date.parse(at(-600))]]));
  t("lead time counts from when the job was first seen, before the window too", late.lead && late.lead.lead_min === 620, late.lead);
  const op = S.openAt([{ ref: "A", kind: "start", qty: 5, at: at(0) }, { ref: "A", kind: "scrap", qty: 1, at: at(1) }, { ref: "B", kind: "wait", qty: 1, at: at(2) }, { ref: "C", kind: "start", qty: 1, at: at(3) }, { ref: "C", kind: "finish", qty: 1, at: at(4) }]);
  t("what is open at a step: a part-scrapped run and one waiting, not one finished", op.length === 2 && op[0].ref === "A" && op[0].kind === "start" && op[1].ref === "B" && op[1].kind === "wait", op);

  // ---- the stage watch
  const steps = [{ module: "line", step: "Cut" }];
  t("a stage watch is on one of the agent's steps", throws(() => S.checkStageSpec({ module: "line", step: "Weld" }, steps), /one of the agent's steps/) && throws(() => S.checkStageSpec({ module: "line", step: "Cut" }, []), /tie a step/));
  t("open longer than some hours, or more open than a number", S.checkStageSpec({ module: "line", step: "Cut", hours: 4 }, steps).hours === 4 && S.checkStageSpec({ module: "line", step: "Cut", measure: "wip", limit: 3 }, steps).limit === 3
    && throws(() => S.checkStageSpec({ module: "line", step: "Cut", measure: "wip", limit: -1 }, steps)) && throws(() => S.checkStageSpec({ module: "line", step: "Cut", hours: 9000 }, steps)));
  t("set up, an agent drafts one stage watch a step", S.proposeStage(steps).length === 1 && S.proposeStage(steps)[0].spec.measure === "open" && !/\d/.test(S.proposeStage(steps)[0].title));

  // ---- the module gate checks a declaration
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "a3gate-"));
  fs.writeFileSync(path.join(dir, "module.json"), JSON.stringify({ name: "x", entry: "routes.js", drafts: { mo: { label: "an MO", fields: { qty: { type: "blob" } } } } }));
  fs.writeFileSync(path.join(dir, "routes.js"), "module.exports = function (ctx) { return ctx.express.Router(); };\n");
  const g = require("../src/modulegate").checkDir(dir);
  t("the module gate stops a build whose drafts declaration is wrong, and says how to fix it", !g.ok && g.violations.some((v) => v.rule === "layout-drafts" && /has a type/.test(v.what)), g.violations);
  fs.rmSync(dir, { recursive: true, force: true });

  t("no words of A3's code carry an em or en dash", !/[\u2013\u2014]/.test(["src/vsm-drafts.js", "src/vsm-stages.js"].map((f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8")).join("")));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
