// End to end: steps that need judgment (2026-10-20). A request that has the tool read a file from outside (a template
// someone uploads) is proposed as "match once" and its build is told about ctx.ai.judge; an ordinary request is
// proposed as fixed rules and its build is told nothing new; the manager's words never name how it is built; and the
// tool's judgment call answers in the shape asked, goes on the record, and is refused while the company is walled
// off. Runs against a server that is ALREADY UP in fake-agent mode on a fresh database with the prompt log on:
//   SOS_PROMPT_LOG=/tmp/sos-judgment.jsonl node server.js ...;  SOS_PROMPT_LOG=/tmp/sos-judgment.jsonl node scripts/e2e/judgment.js
// (run-all.sh does both). The script also requires the platform's own modules on the same database for the call
// itself, the way a tool's process reaches it (registry.moduleServices).
const fs = require("fs");
const { PW, runner, login, rowsOf, proposalFor, ship } = require("./lib");
const R = runner(), t = R.t;
const PAGE = "/c/demo/m/paperline/";
const LOG = process.env.SOS_PROMPT_LOG || "/tmp/sos-judgment.jsonl";
const prompts = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

(async () => {
  const admin = await login(PW.admin, "");
  const mgr = await login(PW.manager, "demo");
  const floor = await login(PW.floor, "demo");
  const file = async (message) => (await floor.post("/api/feedback", { company: "demo", module: "paperline", page: PAGE, message })).json;
  const rec = async (q) => rowsOf((await mgr.get(`/api/c/demo/record?${q}`)).json);

  // a request that reads a file from outside: match once, a functionality change
  const a = await file("I want to upload our sales report template in excel and have the tool fill it in");
  const pa = await proposalFor(mgr, a.id);
  const da = (await rec(`kind=proposal_drafted&feedback_id=${a.id}`))[0];
  t("a template upload is proposed as match once, with the step named", da && da.detail && da.detail.approach === "match_once" && /headings/.test(da.detail.approach_step || ""), da && da.detail);
  t("and it is a functionality change", pa.class === "functionality", pa.class);
  t("the manager's card names no way of building", !/match_once|judgment|deterministic|agentic|ctx\./i.test(pa.body), pa.body);

  // an ordinary request: fixed rules, look and feel stays look and feel
  const b = await file("make the clock text bigger");
  const pb = await proposalFor(mgr, b.id);
  const db = (await rec(`kind=proposal_drafted&feedback_id=${b.id}`))[0];
  t("an ordinary request is proposed as fixed rules", db && db.detail && db.detail.approach === "rules" && !db.detail.approach_step, db && db.detail);
  t("and a look-and-feel change stays one", pb.class === "ui", pb.class);

  // the proposer was told to decide, and never to ask the person how to build
  const pp = prompts().filter((p) => p.kind === "structured:proposal");
  t("every proposal prompt carries the approach brief", pp.length >= 2 && pp.every((p) => /Decide how the changed tool will decide/.test(p.prompt)), pp.length);
  t("the ask brief says not to ask how to build", pp.some((p) => /Never ask the person to choose between ways of building/.test(p.prompt)));

  // the builds: the template one is told about the judgment call, the clock one is not
  await ship(mgr, [b.id]);
  await ship(mgr, [a.id]);
  const builds = prompts().filter((p) => p.kind === "agent" && p.company === "demo");
  const bClock = builds.find((p) => /clock text bigger/.test(p.prompt)), bTemplate = builds.find((p) => /sales report template/.test(p.prompt));
  t("the template build is told the step and the call", bTemplate && /How it decides: match once/.test(bTemplate.prompt) && /ctx\.ai\.judge\(\{ task, input, answer \}\)/.test(bTemplate.prompt) && /by hand/.test(bTemplate.prompt), bTemplate && bTemplate.prompt.slice(0, 400));
  t("the clock build is told fixed rules and nothing about the call", bClock && /How it decides: fixed rules/.test(bClock.prompt) && !/ctx\.ai\.judge/.test(bClock.prompt), bClock && bClock.prompt.slice(0, 400));
  const req = prompts().filter((p) => p.kind === "structured:requirement" && /sales report template/.test(p.prompt));
  t("the requirement for the template change is written knowing it is match once", req.length && /How it decides: match once/.test(req[req.length - 1].prompt), req.length);

  // the tool's own judgment call, on the same database the server uses
  const registry = require("../../src/registry");
  const svc = registry.moduleServices("demo", "paperline", {}, 1, "live");
  const answer = { type: "object", properties: { matches: { type: "array", items: { type: "object", properties: { heading: { type: "string" }, field: { type: "string", enum: ["company", "owner", ""] } }, required: ["heading", "field"] } }, note: { type: "string" } }, required: ["matches", "note"] };
  const out = await svc.ai.judge({ task: "Match each heading to a field", input: { headings: ["Client", "Rep"], fields: ["company", "owner"] }, answer, kind: "template_match" });
  t("a judgment answers in the shape asked", out && out.data && Array.isArray(out.data.matches) && out.data.note === "", out);
  const jr = (await rec("kind=judgment"))[0];
  t("it is on the record with what was asked", jr && /Match each heading/.test(jr.before || "") && jr.detail && jr.detail.kind === "template_match", jr);
  let bad = null; try { await svc.ai.judge({ task: "", answer }); } catch (e) { bad = e; }
  t("a judgment with no task is a plain 400", bad && bad.status === 400 && /needs a task/.test(bad.message), bad && bad.message);

  // walled off: refused in a plain sentence the tool can show
  t("setup: the admin walls the company off", (await admin.post("/api/admin/companies/demo/data-wall", { walled: true })).status === 200);
  await new Promise((r) => setTimeout(r, 10500));   // this process's own wall cache (src/datawall.js, 10 s); the server's is cleared by the switch
  let w = null; try { await svc.ai.judge({ task: "Match each heading to a field", input: "Client", answer }); } catch (e) { w = e; }
  t("while walled the judgment is refused with a 409 and plain words", w && w.status === 409 && /switched off/.test(w.message), w && w.message);
  t("and nothing reached a prompt for it", !prompts().some((p) => p.kind === "structured:judgment" && p.walled));
  await admin.post("/api/admin/companies/demo/data-wall", { walled: false });

  R.done();
})().catch((e) => { console.error(e); process.exit(1); });
