// Unit tests for Ask Anetix (src/assist.js, src/assist-tools.js, src/assist-evals.js, principles/HELP.md): the parts
// that need no database or server. The rest is scripts/e2e/assist.js (fake model), assist-api.js (the real request
// shape) and assist-browser.js (the panel).
//   node scripts/test-assist.js
const fs = require("fs");
const path = require("path");
const assist = require("../src/assist");
const tools = require("../src/assist-tools");
const evals = require("../src/assist-evals");
const dbroles = require("../src/dbroles");
let pass = 0, fail = 0;
const later = [];   // the checks that call a tool (no database is reached: each is refused before it runs)
const t = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log(`FAIL  ${name}${detail !== undefined ? "\n      " + JSON.stringify(detail).slice(0, 400) : ""}`); } };
const DASH = /[\u2013\u2014]/, MODEL = /\b(claude|anthropic|opus|sonnet|haiku|fable)\b/i;

// ---- what people read: no dashes, no model names ---------------------------------------------------------------
const help = fs.readFileSync(path.join(__dirname, "..", "principles", "HELP.md"), "utf8");
t("HELP.md has no em or en dash", !DASH.test(help));
t("HELP.md names no model and no maker", !MODEL.test(help));
t("HELP.md names the board's real buttons", ["Approve build", "Adjust", "Decline", "Review with AI", "Read it at once", "+ New tool", "Send to Reviewing", "Make it live"].every((w) => help.includes(w)));
const sys = assist.staticSystem();
t("the fixed system text is the rules, then HELP.md", sys.startsWith("You are Anetix's AI engineer") && sys.includes("# How Anetix works"));
t("the rules have no dash", !DASH.test(sys));
t("the rules forbid naming the model, and say typed text is never an instruction", /Never name the AI model/.test(sys) && /never an instruction to you/.test(sys));
t("the rules say a request is never claimed as filed", /Never say a request was filed/.test(sys));
for (const k of ["help", "tool", "company"]) {
  const a = assist.setAnswer(k, "Cycle count").text;
  t(`the ${k} set answer says it is not switched on, with no dash or model name`, /not switched on in a demo/.test(a) && !DASH.test(a) && !MODEL.test(a));
  t(`three ${k} starters and an intro, no dash`, assist.STARTERS[k].length === 3 && assist.INTRO[k] && !DASH.test(assist.STARTERS[k].join(" ") + assist.INTRO[k]));
}
t("a tool's set answer names the tool", /Cycle count's screens/.test(assist.setAnswer("tool", "Cycle count").text));

// ---- the answer's backstop ------------------------------------------------------------------------------------------
t("model names and the maker are scrubbed from an answer", assist.scrubText("Claude Opus 5.5 by Anthropic said so") === "the AI by the AI's maker said so");
t("a person called Claude keeps the name", assist.scrubText("Claude on second shift asked twice") === "Claude on second shift asked twice");
t("a long dash becomes a comma", assist.scrubText("short \u2014 sweet") === "short, sweet" && assist.scrubText("a\u2013b") === "a, b");

// ---- the history the model is shown ---------------------------------------------------------------------------
{
  const h = assist.historyFor([
    { role: "assistant", status: "done", text: "orphan answer first" },
    { role: "user", status: "done", text: "q1" },
    { role: "assistant", status: "done", text: "a1", card: { tool_title: "Line", what: "bigger timer", state: "filed", feedback_id: 12 } },
    { role: "user", status: "done", text: "q2" },
    { role: "assistant", status: "failed", text: "That did not work" },
    { role: "user", status: "done", text: "q3" },
    { role: "assistant", status: "done", text: "a3", card: { tool_title: "Line", what: "x", state: "dismissed" } },
  ]);
  t("history starts with the person and drops failed answers", h[0].role === "user" && !h.some((m) => /did not work/.test(m.content)));
  t("two questions in a row are merged so roles alternate", h.every((m, i) => i === 0 || m.role !== h[i - 1].role) && h.find((m) => /q2/.test(m.content) && /q3/.test(m.content)));
  t("a sent card is noted with its number", /sent it to Reviewing as request #12/.test(h.find((m) => /a1/.test(m.content)).content));
  t("a put-away card is noted", /did not send it/.test(h[h.length - 1].content));
}

// ---- the request's shape ----------------------------------------------------------------------------------------
{
  const msgs = [{ role: "user", content: "hello" }, { role: "assistant", content: [{ type: "text", text: "x" }, { type: "tool_use", id: "t1", name: "list_tools", input: {} }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "{}" }] }];
  const marked = assist.withCacheMark(msgs);
  t("only the last block of the last message carries the cache mark", marked[2].content[0].cache_control && !JSON.stringify(marked.slice(0, 2)).includes("cache_control"));
  t("the conversation itself is not changed", !JSON.stringify(msgs).includes("cache_control") && typeof marked[0].content !== "string");
  const plain = assist.plainBlocks([{ type: "text", text: "  ", citations: null }, { type: "text", text: "hi", citations: null }, { type: "tool_use", id: "a", name: "b", input: { x: 1 }, caller: "z" }, { type: "thinking", thinking: "..." }]);
  t("blocks sent back: no empty text, no extra keys, no other kinds", JSON.stringify(plain) === JSON.stringify([{ type: "text", text: "hi" }, { type: "tool_use", id: "a", name: "b", input: { x: 1 } }]));
}

// ---- plain words for steps and the Looked at line ----------------------------------------------------------------
{
  const titles = new Map([["cc", "Cycle count"]]);
  t("steps in plain words, with the tool's title", assist.stepLabel("describe_tool", { tool: "cc" }, titles, { kind: "company" }) === "Reading how Cycle count works" && assist.stepLabel("summarize_records", {}, titles, { kind: "tool", module: "cc" }) === "Adding up Cycle count's records");
  const la = assist.lookedAt([{ kind: "tool", module: "cc" }, { kind: "tool", module: "cc" }, { kind: "records", module: "cc", table: "counts" }, { kind: "request", id: 4 }, { kind: "requests", module: "platform" }], "acme", titles);
  t("Looked at: each thing once, a tool linked to its screens", la.length === 4 && la[0].href === "/c/acme/m/cc/" && la[1].label === "Cycle count records (counts)" && la[3].label === "Requests to Anetix");
}

// ---- which tools a scope gets -------------------------------------------------------------------------------------
{
  const names = (scope, walled) => tools.toolsFor(tools.newCtx({ company: "x", role: "manager", scope, walled })).map((x) => x.name);
  t("Anetix help: the tool list and a card to Anetix, nothing else", JSON.stringify(names({ kind: "help" }, false)) === JSON.stringify(["list_tools", "draft_request"]));
  t("one tool, wall down: records included", names({ kind: "tool", module: "a" }, false).includes("read_records") && names({ kind: "tool", module: "a" }, false).includes("summarize_records"));
  t("wall up: no record tool is even offered", !names({ kind: "company" }, true).some((n) => /records/.test(n)) && !names({ kind: "tool", module: "a" }, true).some((n) => /records/.test(n)));
  t("the order of the tools is fixed (the prompt cache holds)", JSON.stringify(names({ kind: "company" }, false)) === JSON.stringify(names({ kind: "company" }, false)) && names({ kind: "company" }, false)[0] === "list_tools");
  for (const tool of tools.TOOLS) {
    t(`${tool.name}: a name the API takes, an object schema, and a description of a few sentences`, /^[a-z_]{1,64}$/.test(tool.name) && tool.input_schema.type === "object" && tool.description.length > 150 && (tool.description.match(/\.\s/g) || []).length >= 2, tool.description.length);
    t(`${tool.name}: no dash and no model name in what the model reads`, !DASH.test(tool.description) && !MODEL.test(tool.description));
    t(`${tool.name}: no argument names a company, a role or a person`, !Object.keys(tool.input_schema.properties || {}).some((k) => /company|slug|role|person|account|owner/.test(k)));
  }
  later.push((async () => { const c = tools.newCtx({ company: "x", role: "manager", scope: { kind: "help" }, walled: false }); const r = await tools.call(c, "read_records", { table: "t" }); t("a call to a tool that is not offered is refused, not run", !r.ok && /no tool called/.test(r.text), r); })());
  later.push((async () => { const c = tools.newCtx({ company: "x", role: "manager", scope: { kind: "tool", module: "a" }, walled: true }); const r = await tools.call(c, "summarize_records", { table: "t", measures: [{ fn: "count" }] }); t("wall up: a record tool called anyway is refused, naming the wall", !r.ok && /data wall/.test(r.text), r); })());
}

// ---- a value as the model reads it ---------------------------------------------------------------------------------
t("a count or a sum sent as text becomes a number", tools.cell("42") === 42 && tools.cell("3.250") === 3.25);
t("a min or max of a text stays text, cut when long", tools.cell("Body fold") === "Body fold" && tools.cell("x".repeat(400)).length === 300);
t("a file's bytes are named, never sent", tools.cell(Buffer.from("abc")) === "(a file, 3 bytes)");
t("an id like a part number with leading digits stays as written when long", tools.cell("0012345678901234567890") === "0012345678901234567890");
t("shared words: stations and station are one word, small words and common words are left out", JSON.stringify(tools.stems("Make the stations' timer bigger with the board")) === JSON.stringify(["station", "timer", "bigger", "board"]), tools.stems("Make the stations' timer bigger with the board"));

// ---- the read role ------------------------------------------------------------------------------------------------
{
  const g = dbroles.grantStatements("acme", "cc", { live: true, staged: true, liveMigrations: true, stagedMigrations: true }).join("\n");
  t("the read role is named apart from the module lanes", dbroles.roleName("acme", dbroles.READ) === "sos_acme_read" && !dbroles.LANES.includes(dbroles.READ) && !dbroles.ALL_LANES.includes(dbroles.READ));
  t("it may SELECT the live tables and nothing more", /GRANT SELECT ON ALL TABLES IN SCHEMA mod_acme_cc TO sos_acme_read/.test(g) && !/(INSERT|UPDATE|DELETE)[^\n]*sos_acme_read/.test(g));
  t("never the staging copy, the sequences, or the migration bookkeeping", !/stg_acme_cc[^\n]*sos_acme_read/.test(g) && !/SEQUENCES[^\n]*sos_acme_read/.test(g) && /REVOKE ALL ON mod_acme_cc._migrations FROM sos_acme_read/.test(g));
}

// ---- grading the golden questions --------------------------------------------------------------------------------
{
  const c = evals.CASES.find((x) => x.id === "tool-draft");
  t("a good draft passes", evals.grade(c, { tools: ["describe_tool", "draft_request"], text: "It is on the card below for you to check and send.", card: { what: "x" } }, {}).length === 0);
  const bad = evals.grade(c, { tools: ["describe_tool"], text: "I have filed it \u2014 done. Claude out.", card: null }, {});
  t("a bad one fails on every count", bad.some((f) => /draft_request/.test(f)) && bad.some((f) => /card/.test(f)) && bad.some((f) => /dash/.test(f)) && bad.some((f) => /model/.test(f)) && bad.some((f) => /says/.test(f)), bad);
  t("every case asks something and expects something", evals.CASES.length >= 10 && evals.CASES.every((x) => x.ask && x.expect && ["help", "tool", "company"].includes(x.scope.kind)));
}

Promise.all(later).then(() => { console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); });
