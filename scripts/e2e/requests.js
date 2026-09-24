// End to end: requests to Anetix (src/requests.js). Feedback about the software itself, filed from the board by a
// signed-in person, lands on the Requests tab of /admin; Anetix moves it along and the person reads where it is
// under My requests, with a badge; the manager reads the same on the board strip. Runs against a server that is
// ALREADY UP in fake-agent mode on a fresh database:
//
//   export DATABASE_URL=postgres://sos:sos@127.0.0.1:5432/sos_e2e SESSION_SECRET=e2e SOS_CONNECTION_KEY=e2e-connection-key \
//     SOS_FLOOR_PASSWORD=floorpw SOS_MANAGER_PASSWORD=mgrpw SOS_ADMIN_PASSWORD=adminpw
//   SOS_FAKE_AGENT=1 PORT=3999 node server.js &
//   node scripts/e2e/requests.js
const { PW, runner, client, login, person, board } = require("./lib");
const R = runner(), t = R.t;

(async () => {
  const mgr = await login(PW.manager, "demo");
  const admin = await login(PW.admin);
  const floor = await login(PW.floor, "demo");
  const maria = await person(mgr, "demo", "Maria Requests", "floor");
  const who = await floor.post("/api/c/demo/who/sign-in", { id: maria.id, pin: maria.pin });
  t("Maria signs in on the floor device", who.status === 200, who.text);

  // 1. file it from the board (module platform), as Maria
  const sent = await floor.post("/api/feedback", { company: "demo", module: "platform", page: "/c/demo/", message: "The full requirement folds itself shut before I can read it." });
  t("a request about the software itself is filed", sent.status === 200 && sent.json.module === "platform" && sent.json.name === "Maria Requests", sent.text);
  t("it is not sent to the proposer", sent.json.arrival === null || sent.json.arrival === undefined, sent.json.arrival);
  const id = sent.json.id;

  // 2. the person sees it under My requests as received, nothing answered yet
  let mine = (await floor.get("/api/c/demo/who/requests")).json;
  let row = mine.requests.find((r) => r.id === id);
  t("My requests lists it as sent to Anetix, nobody has looked", row && row.to_anetix === true && row.state === "anetix_received" && /Sent to Anetix/.test(row.line) && !row.answered_at, row);
  t("it is not counted as something to answer", mine.to_answer === 0, mine.to_answer);

  // 3. the board strip carries it with the same line
  let fb = (await board(mgr)).feedback.find((f) => f.id === id);
  t("the board row carries no Anetix stage yet", fb && fb.module === "platform" && !fb.anetix_stage && !fb.anetix_at, fb);

  // 4. admin: the list, untouched counted
  let list = (await admin.get("/api/admin/requests")).json;
  let item = list.requests.find((r) => r.id === id);
  t("the admin list has it, from demo, by Maria, stage received", item && item.company === "demo" && item.company_name && item.name === "Maria Requests" && item.stage === "received" && item.state === "anetix_received", item);
  t("open and untouched counts include it", list.open >= 1 && list.untouched >= 1, { open: list.open, untouched: list.untouched });
  t("a manager cannot read the admin list", (await mgr.get("/api/admin/requests")).status === 403);
  t("a floor device cannot move it along", (await floor.post(`/api/admin/requests/${id}`, { stage: "looking" })).status === 403);

  // 5. looking at it, with a word back
  let r = await admin.post(`/api/admin/requests/${id}`, { stage: "looking", note: "Good catch, I see it too." });
  t("Anetix marks it looking with a word back", r.status === 200 && r.json.anetix_stage === "looking" && r.json.anetix_note === "Good catch, I see it too." && r.json.anetix_at && /looking at it/.test(r.json.line), r.text);
  t("the stage carries who did it", r.json.anetix_by === "the shared admin password" || typeof r.json.anetix_by === "string", r.json.anetix_by);
  list = (await admin.get("/api/admin/requests")).json;
  t("untouched count drops", list.requests.find((x) => x.id === id).stage === "looking" && list.untouched === 0, list.untouched);
  mine = (await floor.get("/api/c/demo/who/requests")).json; row = mine.requests.find((x) => x.id === id);
  t("Maria reads: Anetix is looking at it, with the word back", row.state === "anetix_looking" && /looking at it/.test(row.line) && /Good catch/.test(row.line) && row.note === "Good catch, I see it too." && row.answered_at, row);
  const firstAt = row.answered_at;
  fb = (await board(mgr)).feedback.find((f) => f.id === id);
  t("the board row carries the stage and the note", fb.anetix_stage === "looking" && fb.anetix_note === "Good catch, I see it too.", fb);

  // 6. working on it (the note stays unless replaced)
  r = await admin.post(`/api/admin/requests/${id}`, { stage: "working" });
  t("working on it keeps the last word back", r.status === 200 && r.json.anetix_stage === "working" && r.json.anetix_note === "Good catch, I see it too.", r.text);
  r = await admin.post(`/api/admin/requests/${id}`, { stage: "nowhere" });
  t("an unknown stage is refused", r.status === 400, r.text);
  r = await admin.post(`/api/admin/requests/${id}`, { note: "x" });
  t("a one-letter word back is refused", r.status === 400, r.text);

  // 7. fixed, with what changed
  r = await admin.post(`/api/admin/requests/${id}/close`, { answer: "fixed", what: "" });
  t("fixed needs words", r.status === 400, r.text);
  r = await admin.post(`/api/admin/requests/${id}/close`, { answer: "fixed", what: "The fold stays open until you close it." });
  t("fixed closes it with what changed", r.status === 200 && r.json.status === "done" && r.json.outcome === "The fold stays open until you close it." && r.json.state === "anetix_fixed", r.text);
  mine = (await floor.get("/api/c/demo/who/requests")).json; row = mine.requests.find((x) => x.id === id);
  t("Maria reads: fixed by Anetix, what changed", row.state === "anetix_fixed" && /Fixed by Anetix\. The fold stays open/.test(row.line) && row.built === null && row.answered_at !== firstAt, row);
  t("it is not something the floor answers fixed it / not quite on", row.can_answer === false, row);
  list = (await admin.get("/api/admin/requests?status=closed")).json;
  t("the closed list has it", list.requests.some((x) => x.id === id && x.status === "done"), list.requests.map((x) => x.id));
  t("the open list does not", !(await admin.get("/api/admin/requests")).json.requests.some((x) => x.id === id));
  const rec = (await mgr.get(`/api/c/demo/record?feedback_id=${id}`)).json;
  const kinds = (rec.rows || rec.record || rec).map((x) => x.kind);
  t("the record has the stages and the close", kinds.includes("anetix_stage") && kinds.includes("feedback_closed") && kinds.includes("feedback_filed"), kinds);

  // 8. a second one: not doing this; and the manager's own decline stays what it was
  const two = (await floor.post("/api/feedback", { company: "demo", module: "platform", page: "/c/demo/settings", message: "Make the board pink." })).json;
  r = await admin.post(`/api/admin/requests/${two.id}/close`, { answer: "not_doing", what: "The colors come from your company's own brand guide." });
  t("not doing this closes it as declined with why", r.status === 200 && r.json.status === "declined" && r.json.state === "anetix_not_doing" && /not doing this one\. The colors/.test(r.json.line), r.text);
  mine = (await floor.get("/api/c/demo/who/requests")).json; row = mine.requests.find((x) => x.id === two.id);
  t("Maria reads why", row.state === "anetix_not_doing" && /brand guide/.test(row.line), row);
  r = await admin.post(`/api/admin/requests/${two.id}`, { stage: "looking" });
  t("reopen: a stage on a closed one opens it again", r.status === 200 && r.json.status === "new" && r.json.outcome === null && r.json.anetix_stage === "looking", r.text);
  const three = (await floor.post("/api/feedback", { company: "demo", module: "platform", page: "/c/demo/", message: "Nothing, sorry." })).json;
  await mgr.post(`/api/feedback/${three.id}/close`, { declined: true, outcome: "Sent by mistake." });
  mine = (await floor.get("/api/c/demo/who/requests")).json; row = mine.requests.find((x) => x.id === three.id);
  t("the manager's own decline reads as the manager's", row.state === "declined" && /Declined by the manager\. Sent by mistake/.test(row.line) && !row.answered_at, row);
  t("a module request is untouched by any of this", (await admin.post(`/api/admin/requests/999999/close`, { answer: "fixed", what: "nope nope" })).status === 404);
  const modFb = (await floor.post("/api/feedback", { company: "demo", module: "paperline", page: "/c/demo/m/paperline/", message: "a module request, not Anetix's" })).json;
  t("a request about a module is not in the admin list", !(await admin.get("/api/admin/requests?status=all")).json.requests.some((x) => x.id === modFb.id));
  t("and cannot be closed as one", (await admin.post(`/api/admin/requests/${modFb.id}/close`, { answer: "fixed", what: "nope nope" })).status === 404);

  R.done();
})().catch(R.abort);
