// Unit cases for propose on arrival (src/arrival.js), the pure parts: what the widget's "point at it" is cut down
// to and how the proposer reads it, the list of open requests a new one might repeat, which questions are fit to
// show a person on the floor, "asked N times by M people", who may answer a question; the schema and the fake
// proposer's markers; and what the floor reads in My requests (src/closeloop.js). No database:
//   node scripts/test-arrival.js
process.env.SOS_FAKE_AGENT = "1";
const a = require("../src/arrival");
const c = require("../src/closeloop");
const plain = require("../src/plainwords");
let pass = 0, fail = 0;
function t(name, cond, detail) { if (cond) { pass++; } else { fail++; console.log(`FAIL  ${name}${detail ? "\n      " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : ""}`); } }
const DASH = new RegExp("[" + String.fromCharCode(8211) + String.fromCharCode(8212) + "]");

// ---- what the person pointed at
const el = a.cleanElement({ tag: "BUTTON", id: "start", classes: ["big", "go", 3, "", "x".repeat(90)], text: "  Start\n shift  ", label: "Starts the two minute shift", path: "main > div.station > button#start", html: "<button id=\"start\">Start shift</button>" + "y".repeat(900), rect: { x: 10.4, y: 590, w: 120, h: 48, vw: 800, vh: 640 }, evil: "<script>" });
t("the tag is lower case and the text is one line", el.tag === "button" && el.text === "Start shift");
t("classes are capped and cleaned", el.classes.length <= 6 && el.classes.every((x) => x.length <= 40));
t("the markup is cut at 400 characters", el.html.length === 400);
t("the box is whole numbers", el.rect.x === 10 && el.rect.vh === 640);
t("anything the widget did not mean to send is dropped", !("evil" in el));
t("nothing usable is nothing", a.cleanElement(null) === null && a.cleanElement("button") === null && a.cleanElement([]) === null && a.cleanElement({ rect: { x: 1 } }) === null);
t("a tag that is not a tag is refused", a.cleanElement({ tag: "<img onerror=x>", text: "" }) === null || /^[a-z0-9-]*$/.test(a.cleanElement({ tag: "<img onerror=x>", text: "x" }).tag));
const line = a.elementLine(el);
t("the proposer is told what was pointed at, in words", /POINTED at one thing/.test(line) && /<button id="start" class="big go/.test(line) && /showing "Start shift"/.test(line) && /labelled "Starts the two minute shift"/.test(line));
t("and roughly where on the screen", /near the bottom of a 800 by 640 screen/.test(line));
t("and that the words win when they plainly say otherwise", /unless the words plainly say otherwise/.test(line));
t("nothing pointed at adds nothing", a.elementLine(null) === "");

// ---- the open requests a new one might repeat
const block = a.candidatesBlock([{ id: 12, status: "reviewing", screen: "Station 2", message: "the fold count is too small to read from where I stand", proposal_body: "Make the count larger" }, { id: 9, status: "new", screen: null, message: "x".repeat(400) }, { id: 4, status: "in_progress", message: "show scrap" }]);
t("each open request is one line with its number and where it stands", /#12 \[proposal drafted\] on Station 2: "the fold count/.test(block) && /#9 \[waiting\]/.test(block) && /#4 \[being built\]/.test(block));
t("a drafted proposal rides along, long words are cut", /\(proposal: Make the count larger\)/.test(block) && !/x{300}/.test(block));
t("no open requests adds nothing", a.candidatesBlock([]) === "" && a.candidatesBlock(null) === "");

// ---- a question worth showing
const hits = (text) => plain.check(text);
t("a plain question with two answers is kept", JSON.stringify(a.cleanQuestion({ text: "Which number is too small?", options: ["The fold count", "The timer"] }, hits)) === JSON.stringify({ text: "Which number is too small?", options: ["The fold count", "The timer"] }));
t("at most three answers", a.cleanQuestion({ text: "Which number is too small?", options: ["a1", "b2", "c3", "d4"] }, hits).options.length === 3);
t("one answer is not a choice", a.cleanQuestion({ text: "Which number is too small?", options: ["The fold count"] }, hits) === null);
t("the same answer twice is not a choice", a.cleanQuestion({ text: "Which number is too small?", options: ["Yes", "yes"] }, hits) === null);
t("no question text is no question", a.cleanQuestion({ text: "", options: ["a", "b"] }, hits) === null && a.cleanQuestion(null, hits) === null);
t("a question in software words is dropped, not shown", a.cleanQuestion({ text: "Which API endpoint should the frontend call?", options: ["The database", "The backend"] }, hits) === null);

// ---- asked N times by M people
t("the request itself counts", JSON.stringify(a.tally({ id: 1, person_id: 7 }, [])) === JSON.stringify({ times: 1, people: 1 }));
t("the same person twice is one person", JSON.stringify(a.tally({ id: 1, person_id: 7 }, [{ id: 2, person_id: 7 }, { id: 3, person_id: 8 }])) === JSON.stringify({ times: 3, people: 2 }));
t("typed names count by name, whatever the case", a.tally({ id: 1, name: "Ana" }, [{ id: 2, name: "ana " }, { id: 3, name: "Ben" }]).people === 2);
t("nameless requests are each their own", a.tally({ id: 1 }, [{ id: 2 }, { id: 3 }]).people === 3);

// ---- who may answer the question
const asked = { id: 5, status: "new", person_id: 7, reply_token: "tok", question: { text: "Which?", options: ["a", "b"] } };
t("the person who asked may", a.mayReply(asked, { id: 7 }, "") === true && a.mayReply(asked, { id: "7" }, "") === true);
t("someone else may not, even with the token", a.mayReply(asked, { id: 8 }, "tok") === false && a.mayReply(asked, null, "tok") === false);
t("a nameless request is answered by the device that holds its token", a.mayReply({ ...asked, person_id: null }, null, "tok") === true && a.mayReply({ ...asked, person_id: null }, { id: 8 }, "tok") === true);
t("and by nobody without it", a.mayReply({ ...asked, person_id: null }, { id: 8 }, "") === false && a.mayReply({ ...asked, person_id: null }, null, "nope") === false && a.mayReply({ ...asked, person_id: null, reply_token: null }, null, "") === false);
t("answered, proposed, folded in, or never asked: nothing to answer", !a.mayReply({ ...asked, question: { ...asked.question, answer: "a" } }, { id: 7 }) && !a.mayReply({ ...asked, status: "reviewing" }, { id: 7 }) && !a.mayReply({ ...asked, duplicate_of: 2 }, { id: 7 }) && !a.mayReply({ ...asked, question: null }, { id: 7 }));

// ---- what the floor reads in My requests
const st = (r) => c.stateOf(r);
t("a waiting question is its own state", st({ status: "new", question: { text: "Which?", options: ["a", "b"] } }).state === "question");
t("once answered it is back on the board, with thanks", st({ status: "new", question: { text: "Which?", answer: "a" } }).state === "new" && /Thank you for the answer/.test(st({ status: "new", question: { text: "Which?", answer: "a" } }).line));
t("a question the manager went past no longer asks", st({ status: "reviewing", proposal_status: "draft", question: { text: "Which?" } }).state === "proposed");
t("a folded request never asks", st({ status: "new", duplicate_of: 3, question: { text: "Which?" } }).state === "new");
const folded = c.withDuplicate({ duplicate_of: 12 }, st({ status: "reviewing", proposal_status: "draft", duplicate_of: 12 }));
t("a folded request says which one it was added to, then where that one stands", /^The same thing as request #12, so it was added to it\. The manager has a proposal/.test(folded.line) && folded.state === "proposed");
t("once live it reads like any live request", c.withDuplicate({ duplicate_of: 12 }, st({ status: "done", duplicate_of: 12 })).line === "Live. Did it fix it?");
t("a folded request's asker is still asked whether it fixed it", c.mayAnswer({ status: "done", outcome: "Deployed v4: x", person_id: 7, duplicate_of: 12 }, 7) === true);
t("no line carries a dash", !DASH.test(folded.line) && !DASH.test(st({ status: "new", question: { text: "Which?" } }).line));

// ---- the schema the proposer fills, and the fake proposer's markers
const { runStructured } = require("../src/agent");
const prompt = (msg, { sort = true, ask = true, open = "\n\nOpen requests on this tool (a new request that asks for the same thing as one of these is a duplicate of it):\n#12 [waiting] on Station 2: \"the count is small\"", extra = "" } = {}) =>
  `Floor feedback (reported by Ana, reported 1 time(s))\nScreen: Station 2 (pages/station.html)\n\n"${msg}"${extra ? "\n\n" + extra : ""}${open}${sort ? "\n\nFirst decide what this request is (triage):\n- change" : ""}${ask ? "\n\nYou may ask ONE question instead of guessing." : ""}\n\nCurrent module for context:\n...`;
(async () => {
  const fake = async (msg, o, blocks) => (await runStructured({ toolName: "proposal", prompt: prompt(msg, o), blocks })).data;
  let d = await fake("make the count bigger");
  t("fake: an ordinary request is a change with no question", d.triage === "change" && d.question.text === "" && d.class === "ui" && d.target_file === "pages/station.html");
  d = await fake("DUPE the count is tiny");
  t("fake: DUPE names the first open request", d.triage === "duplicate" && d.duplicate_of === 12 && /#12/.test(d.triage_note));
  d = await fake("DUPE the count is tiny", { open: "" });
  t("fake: DUPE with nothing open is a change", d.triage === "change");
  d = await fake("ASKME make it bigger");
  t("fake: ASKME asks one question with two answers", d.question.text.length > 5 && d.question.options.length === 2);
  d = await fake("ASKME make it bigger", { ask: false });
  t("fake: no question when asking is not allowed", d.question === undefined);
  d = await fake("DUPE NOTTHISTOOL", { sort: false, ask: false });
  t("fake: no sorting when sorting is not allowed", d.triage === undefined);
  d = await fake("NOTTHISTOOL the roof leaks");
  t("fake: NOTTHISTOOL flags it with a sentence", d.triage === "not_this_tool" && d.triage_note.length > 10);
  d = await fake("NEWTOOL we need a tool for shipping");
  t("fake: NEWTOOL flags it", d.triage === "new_tool");
  d = await fake("ASKME make it bigger", { sort: false, ask: false, extra: "Before drafting, the person was asked: \"Which one do you mean?\" (the choices: a / b). The answer, from Ana: \"The list on the right\". Read the answer as part of the request." });
  t("fake: the answer reaches the proposer", /Answer received: The list on the right\./.test(d.rationale));
  d = await fake("make it bigger", { extra: a.elementLine(el).trim() });
  t("fake: the pointed element reaches the proposer", /Pointed element received: <button id="start"/.test(d.rationale), d.rationale);
  d = await fake("make it bigger", {}, [{ type: "text", text: "A photo" }, { type: "image", source: {} }]);
  t("fake: a photo reaches the proposer", /Photo received \(1\)/.test(d.rationale));
  let threw = null; try { await fake("CREDITOUT"); } catch (e) { threw = e.message; }
  t("fake: CREDITOUT fails the way an empty balance does", /credit balance is too low/i.test(threw || "") && require("../src/credit").classify(threw) === "credit");
  threw = null; try { await fake("FAILPROPOSE"); } catch (e) { threw = e.message; }
  t("fake: FAILPROPOSE fails the call", /FAILPROPOSE/.test(threw || "") && require("../src/credit").classify(threw) === null);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
