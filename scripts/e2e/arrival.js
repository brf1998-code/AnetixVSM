// End to end: propose on arrival (src/arrival.js, build order item 8 with the clarifying question), and the AI
// credit glide slope (src/credit.js). Runs against a server that is ALREADY UP in fake-agent mode on a fresh
// database (the header of closeout.js has the command; add SOS_AUTO_PROPOSE_PER_HOUR=500 so the hourly guard does
// not get in the way). Three more modes, each on a fresh database:
//   SOS_AUTO_PROPOSE_PER_HOUR=2 node server.js &    then    SOS_E2E_EXPECT=guard node scripts/e2e/arrival.js
//   SOS_FAKE_PROPOSE_MS=2500 node server.js &       then    SOS_E2E_EXPECT=slow node scripts/e2e/arrival.js
//     (it prints IN_FLIGHT=<id> and leaves that request being read: stop the server at once, start it again on the
//      SAME database, then)                                  SOS_E2E_EXPECT=restarted SOS_E2E_ID=<id> node scripts/e2e/arrival.js
const { PW, sleep, runner, login, waitFor, rowsOf, board, fbRow, proposalFor, ship } = require("./lib");
const R = runner(), t = R.t;
const PAGE = "/c/demo/m/paperline/";

(async () => {
  const admin = await login(PW.admin, "");
  const mgr = await login(PW.manager, "demo");
  const ana = await login(PW.floor, "demo");     // Ana's tablet, Ana signed in
  const ben = await login(PW.floor, "demo");     // Ben's tablet, Ben signed in
  const anon = await login(PW.floor, "demo");    // a tablet nobody is signed in on
  const file = async (c, message, more) => (await c.post("/api/feedback", { company: "demo", module: "paperline", page: PAGE, message, ...(more || {}) })).json;
  const read = (id) => waitFor(`request ${id} to be read`, async () => { const x = await fbRow(mgr, id); return x && x.arrival !== "proposing" ? x : null; });
  const rec = async (q) => rowsOf((await mgr.get(`/api/c/demo/record?${q}`)).json);

  if (process.env.SOS_E2E_EXPECT === "guard") {
    const a = await file(anon, "make the clock text bigger"), b = await file(anon, "make the queue text bigger"), c = await file(anon, "make the order text bigger");
    const [ra, rb, rc] = [await read(a.id), await read(b.id), await read(c.id)];
    t("guard: the first two are read on arrival", ra.status === "reviewing" && rb.status === "reviewing", [ra.arrival, rb.arrival]);
    t("guard: past the hourly limit a request waits for the manager's button", rc.status === "new" && /busy hour/.test(rc.arrival || "") && !rc.proposal_id, rc.arrival);
    t("guard: the answer to the sender says it is not being read", c.arrival === null);
    t("guard: and the button still works", (await mgr.post(`/api/feedback/${c.id}/review`)).status === 200 && (await fbRow(mgr, c.id)).status === "reviewing");
    return R.done();
  }

  if (process.env.SOS_E2E_EXPECT === "slow") {
    // the server was started with SOS_FAKE_PROPOSE_MS=2500: a proposal call takes as long as a real one might
    const a = await file(anon, "show the takt time on the board"), b = await file(anon, "DUPE takt time please");
    const ra = await fbRow(mgr, a.id);
    t("slow: while the proposer reads, the card says so and has no proposal", ra.arrival === "proposing" && ra.status === "new" && !ra.proposal_id);
    t("slow: the manager's button waits its turn in plain words", await (async () => { const x = await mgr.post(`/api/feedback/${a.id}/review`); return x.status === 409 && /being drafted right now/.test(x.json.error); })());
    t("slow: the device that sent it is told it is being read", (await anon.get(`/api/c/demo/who/question?id=${a.id}&token=${a.reply_token}`)).json.reading === true);
    const done = await read(a.id);
    t("slow: then the proposal is there, once", done.status === "reviewing" && done.proposal_id && (await rec(`kind=proposal_drafted&feedback_id=${a.id}`)).length === 1);
    const folded = await waitFor("the repeat, read after the first", async () => { const x = await fbRow(mgr, a.id); return x.dupes && x.dupes.length === 1 ? x : null; });
    t("slow: a repeat sent a second later is read after the first and folded into it", folded.dupes[0].id === b.id && folded.asked.times === 2);
    // leave one in flight for the restart check that follows this script
    const c = await file(anon, "show the scrap bin weight");
    console.log(`IN_FLIGHT=${c.id}`);
    return R.done();
  }
  if (process.env.SOS_E2E_EXPECT === "restarted") {
    const id = Number(process.env.SOS_E2E_ID);
    const x = await fbRow(mgr, id);
    t("restart: a request the proposer was reading when the platform stopped gets its button back", x && x.status === "new" && x.arrival == null && !x.proposal_id, x && x.arrival);
    t("restart: and the button works", (await mgr.post(`/api/feedback/${id}/review`)).status === 200 && (await fbRow(mgr, id)).status === "reviewing");
    return R.done();
  }

  const pa = (await mgr.post("/api/c/demo/people", { name: "Ana R", role: "floor" })).json, pb = (await mgr.post("/api/c/demo/people", { name: "Ben T", role: "floor" })).json;
  t("setup: Ana and Ben sign in", (await ana.post("/api/c/demo/who/sign-in", { id: pa.person.id, pin: pa.pin })).status === 200 && (await ben.post("/api/c/demo/who/sign-in", { id: pb.person.id, pin: pb.pin })).status === 200);
  const made = await admin.post("/api/admin/companies", { slug: "acme", name: "Acme" });
  const acmeMgr = await login(made.json.passwords.manager, "acme");

  // ---- 1. the proposal is there before the manager looks
  const f1 = await file(ana, "make the fold count text bigger", { element: { tag: "SPAN", id: "folds", classes: ["num"], text: "  12 \n folds ", label: "Folds this shift", path: "main > div.kpi > span#folds.num", html: "<span id=\"folds\" class=\"num\">12 folds</span>", rect: { x: 40, y: 80, w: 90, h: 30, vw: 1024, vh: 768 }, junk: "x" } });
  t("the sender is told the proposer is reading it", f1.arrival === "proposing" && typeof f1.reply_token === "string" && f1.reply_token.length >= 12);
  const r1 = await read(f1.id);
  t("a draft proposal is on the card with nobody pressing anything", r1.status === "reviewing" && r1.proposal_id && r1.proposal_status === "draft" && r1.arrival === "done", r1);
  t("what Ana pointed at is kept, cleaned", r1.element && r1.element.tag === "span" && r1.element.text === "12 folds" && !("junk" in r1.element));
  t("and it reached the proposer", /Pointed element received: <span id="folds" class="num">/.test(r1.proposal_rationale), r1.proposal_rationale);
  t("the device's token never goes to the board", !("reply_token" in r1));
  t("nor out of any other route that answers with the request", !("reply_token" in (await ben.post(`/api/feedback/${f1.id}/plusone`)).json));
  const d1 = (await rec(`kind=proposal_drafted&feedback_id=${f1.id}`))[0];
  t("the record says it was drafted on arrival, with the pointed element", d1 && d1.detail.on_arrival === true && d1.detail.pointed === true, d1 && d1.detail);
  t("the filing is on the record with what was pointed at", /span 12 folds/.test(((await rec(`kind=feedback_filed&feedback_id=${f1.id}`))[0] || { detail: {} }).detail.pointed || ""));
  t("Ana reads that the manager has a proposal", (await ana.get("/api/c/demo/who/requests")).json.requests.find((x) => x.id === f1.id).state === "proposed");
  const again = await mgr.post(`/api/feedback/${f1.id}/review`);
  const r1b = await fbRow(mgr, f1.id);
  t("asking again gives a new draft and retires the old one: one live draft", again.status === 200 && r1b.proposal_id === again.json.id && again.json.id !== r1.proposal_id);
  const plat = (await ana.post("/api/feedback", { company: "demo", module: "platform", page: "/c/demo/", message: "the board is slow" })).json;
  await sleep(500);
  t("a request about the platform itself is not read by the proposer", plat.arrival === null && (await board(mgr)).feedback.find((x) => x.id === plat.id).arrival == null);

  // ---- 2. a photo
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(400, 7), Buffer.from([0xff, 0xd9])]).toString("base64");
  const f2 = await file(ana, "make the jam warning text bigger", { photo: { mime: "image/jpeg", data: jpeg } });
  const r2 = await read(f2.id);
  t("the photo is kept with the request", r2.photo_id > 0 && f2.photo_note === null, f2);
  t("and it reached the proposer", /Photo received \(1\)/.test(r2.proposal_rationale), r2.proposal_rationale);
  t("the manager can open it, the floor cannot", (await mgr.get(`/api/attachments/${r2.photo_id}`)).status === 200 && (await ben.get(`/api/attachments/${r2.photo_id}`)).status === 403);
  t("another company's manager cannot", [403, 404].includes((await acmeMgr.get(`/api/attachments/${r2.photo_id}`)).status));
  t("a file that is not a photo is left out and the request still goes", await (async () => { const x = await file(ana, "make the scrap label text bigger", { photo: { mime: "application/pdf", data: jpeg } }); const y = await read(x.id); return /jpeg, png or webp/.test(x.photo_note) && !y.photo_id && y.status === "reviewing"; })());
  t("a floor device cannot switch photos off", (await ana.post("/api/c/demo/agents/arrival", { allow_photos: false })).status === 403);
  t("the manager can", (await mgr.post("/api/c/demo/agents/arrival", { allow_photos: false })).json.allow_photos === false && (await ana.get("/api/c/demo/who")).json.photos === false);
  t("then a photo is left out in plain words", await (async () => { const x = await file(ana, "make the bin label text bigger", { photo: { mime: "image/jpeg", data: jpeg } }); const y = await read(x.id); return /switched off/.test(x.photo_note) && !y.photo_id; })());
  t("switching it back on is on the record", (await mgr.post("/api/c/demo/agents/arrival", { allow_photos: true })).json.allow_photos === true && (await rec("kind=arrival_settings")).length === 2);
  t("a body far too large is refused, not swallowed", (await ana.post("/api/feedback", { company: "demo", module: "paperline", page: PAGE, message: "x", photo: { mime: "image/jpeg", data: "A".repeat(7 * 1024 * 1024) } })).status === 413);

  // ---- 3. the same thing twice: folded into one card
  const root = await file(ana, "show the scrap count per shift");
  await read(root.id);
  const dupe = await file(ben, "DUPE we need to see scrap for each shift");
  const rd = await waitFor("the repeat to be folded in", async () => { const all = (await board(mgr)).feedback; const x = all.find((y) => y.id === root.id); return x && x.dupes && x.recurrence === 2 ? { x, all } : null; });   // the link and the count are two writes (src/arrival.js linkDuplicate): wait for both, the full run caught the board between them (2026-10-29)
  t("the repeat is not a card of its own", !rd.all.some((y) => y.id === dupe.id));
  t("the first card says asked 2 times by 2 people, with Ben's own words", rd.x.asked.times === 2 && rd.x.asked.people === 2 && rd.x.recurrence === 2 && rd.x.dupes[0].message === "DUPE we need to see scrap for each shift" && rd.x.dupes[0].name === "Ben T" && /same thing as request/.test(rd.x.dupes[0].note));
  const dupe2 = await file(ana, "DUPE scrap per shift please");
  await waitFor("the second repeat", async () => ((await fbRow(mgr, root.id)).dupes || []).length === 2);
  t("Ana asking again counts the times, not the people", await (async () => { const x = await fbRow(mgr, root.id); return x.asked.times === 3 && x.asked.people === 2; })());
  const benMine = (await ben.get("/api/c/demo/who/requests")).json.requests.find((x) => x.id === dupe.id);
  t("Ben reads that his was added to the first one, and where that one stands", benMine.added_to === root.id && benMine.state === "proposed" && new RegExp(`^The same thing as request #${root.id}, so it was added to it\\.`).test(benMine.line), benMine);
  t("the fold is on the record in both sets of words", await (async () => { const x = (await rec(`kind=duplicate_linked&feedback_id=${dupe.id}`))[0]; return x && x.detail.duplicate_of === root.id && /scrap for each shift/.test(x.before) && /scrap count per shift/.test(x.after); })());
  t("a folded request cannot be proposed on its own", await (async () => { const x = await mgr.post(`/api/feedback/${dupe.id}/review`); return x.status === 500 && /folded into request/.test(x.json.error); })());
  t("with nothing open to repeat, the same words are an ordinary request", await (async () => { const x = (await mgr.post("/api/feedback", { company: "demo", module: "kpis", page: "/c/demo/m/kpis/", message: "DUPE make the chart labels bigger" })).json; const y = await read(x.id); return y.status === "reviewing" && !y.duplicate_of; })());
  // everything that happens to the first request happens to the ones folded into it
  await ship(mgr, [root.id]);
  const dShip = await waitFor("the repeat to go live with it", async () => { const x = (await ben.get("/api/c/demo/who/requests")).json.requests.find((y) => y.id === dupe.id); return x && x.state === "live" ? x : null; });
  t("when the first ships, Ben is asked whether it fixed it too", dShip.can_answer === true && dShip.built && (await ben.get("/api/c/demo/who/requests")).json.to_answer >= 1);
  const newsBen = (await ben.get("/api/c/demo/who/news?module=paperline")).json.changes[0];
  t("what went live names everyone who asked", newsBen.asked_by.includes("Ana R") && newsBen.asked_by.includes("Ben T") && newsBen.items.some((i) => i.id === dupe.id && i.mine));
  t("Ben's answer is his own", (await ben.post(`/api/c/demo/who/requests/${dupe.id}/answer`, { answer: "fixed" })).status === 200 && (await fbRow(mgr, root.id)).floor_answer == null && (await fbRow(mgr, root.id)).dupes.find((x) => x.id === dupe.id).floor_answer === "fixed");
  t("the manager closes out the first card, not a folded one", await (async () => { const x = await mgr.post(`/api/feedback/${dupe2.id}/closeout`, { answer: "done" }); return x.status === 409 && /added to request/.test(x.json.error); })());
  t("Done on the first card thanks everyone who asked", (await mgr.post(`/api/feedback/${root.id}/closeout`, { answer: "done" })).status === 200 && (await ana.get("/api/c/demo/who/requests")).json.requests.filter((x) => [root.id, dupe2.id].includes(x.id)).every((x) => x.state === "thanked"));
  const nq = await ana.post(`/api/c/demo/who/requests/${dupe2.id}/answer`, { answer: "not_quite", what: "show the scrap text in red when it is over ten" });
  const fu = await read(nq.json.follow_up.id);
  t("a not quite on a folded request goes round the loop, and its follow-up is proposed on arrival with the context", nq.status === 200 && fu.status === "reviewing" && new RegExp(`Follow-up context received for request #${dupe2.id}`).test(fu.proposal_rationale), fu.proposal_rationale);
  // declined
  const root2 = await file(ana, "show the glue level"); await read(root2.id);
  const dupe3 = await file(ben, "DUPE glue level on the board"); await waitFor("fold", async () => ((await fbRow(mgr, root2.id)).dupes || []).length === 1);
  await mgr.post(`/api/proposals/${(await fbRow(mgr, root2.id)).proposal_id}/decide`, { decision: "decline", note: "the glue pots are being replaced next month" });
  t("a decline reaches everyone who asked, with the reason", await (async () => { const x = (await ben.get("/api/c/demo/who/requests")).json.requests.find((y) => y.id === dupe3.id); return x.state === "declined" && /glue pots are being replaced/.test(x.line); })());
  // not the same
  const root3 = await file(ana, "show the paper lot number"); await read(root3.id);
  const dupe4 = await file(ben, "DUPE show which operator folded it"); await waitFor("fold", async () => ((await fbRow(mgr, root3.id)).dupes || []).length === 1);
  t("a floor device cannot undo a fold", (await ben.post(`/api/feedback/${dupe4.id}/unlink`)).status === 403);
  t("another company's manager cannot", (await acmeMgr.post(`/api/feedback/${dupe4.id}/unlink`)).status === 403);
  t("the manager says not the same", (await mgr.post(`/api/feedback/${dupe4.id}/unlink`)).json.was_duplicate_of === root3.id);
  const back = await read(dupe4.id);
  t("it is its own card again, proposed on its own, and not folded straight back", back && !back.duplicate_of && back.status === "reviewing" && back.proposal_id && !back.triage);
  t("the first card counts one again", await (async () => { const x = await fbRow(mgr, root3.id); return x.recurrence === 1 && !x.dupes; })());
  t("undoing twice is refused in plain words", await (async () => { const x = await mgr.post(`/api/feedback/${dupe4.id}/unlink`); return x.status === 409 && /not folded/.test(x.json.error); })());
  t("the undo is on the record", (await rec(`kind=duplicate_unlinked&feedback_id=${dupe4.id}`)).length === 1);

  // ---- 4. one question instead of a guess
  const q1 = await file(ana, "ASKME make it bigger");
  const rq = await read(q1.id);
  t("the request waits with a question, no proposal", rq.status === "new" && !rq.proposal_id && rq.question && rq.question.options.length === 2 && !rq.question.answer, rq);
  t("the question is on the record", await (async () => { const x = (await rec(`kind=question_asked&feedback_id=${q1.id}`))[0]; return x && x.after === rq.question.text && x.detail.options.length === 2; })());
  const anaMine = (await ana.get("/api/c/demo/who/requests")).json;
  t("Ana's My requests carries the question and counts it", anaMine.requests.find((x) => x.id === q1.id).state === "question" && anaMine.requests.find((x) => x.id === q1.id).question.options.length === 2 && anaMine.to_answer >= 1);
  t("the feedback button finds it for her", (await ana.get(`/api/c/demo/who/question?id=${q1.id}`)).json.question.text === rq.question.text);
  t("Ben cannot see it, even holding the token, and cannot answer it", (await ben.get(`/api/c/demo/who/question?id=${q1.id}&token=${q1.reply_token}`)).status === 404 && (await ben.post(`/api/c/demo/who/requests/${q1.id}/reply`, { answer: "x", token: q1.reply_token })).status === 403);
  t("an empty answer is refused", (await ana.post(`/api/c/demo/who/requests/${q1.id}/reply`, { answer: "  " })).status === 400);
  t("Ana taps an answer", (await ana.post(`/api/c/demo/who/requests/${q1.id}/reply`, { answer: rq.question.options[1] })).status === 200);
  const rq2 = await waitFor("the proposal with the answer", async () => { const x = await fbRow(mgr, q1.id); return x.status === "reviewing" && x.proposal_id ? x : null; });
  t("the proposal is drafted with her answer", new RegExp(`Answer received: ${rq.question.options[1]}`).test(rq2.proposal_rationale) && rq2.question.answer === rq.question.options[1] && rq2.question.answered_by === "Ana R" && rq2.question.via === "asker", rq2.question);
  t("answering twice is refused kindly", await (async () => { const x = await ana.post(`/api/c/demo/who/requests/${q1.id}/reply`, { answer: "again" }); return x.status === 409 && /already answered/.test(x.json.error); })());
  t("the answer is on the record under her name", await (async () => { const x = (await rec(`kind=question_answered&feedback_id=${q1.id}`))[0]; return x && x.actor_name === "Ana R" && x.detail.via === "asker" && x.after === rq.question.options[1]; })());
  t("one question per request, ever: asking for a proposal again does not ask again", await (async () => { const x = await mgr.post(`/api/feedback/${q1.id}/review`); const y = await fbRow(mgr, q1.id); return x.status === 200 && y.status === "reviewing" && (await rec(`kind=question_asked&feedback_id=${q1.id}`)).length === 1; })());
  // a tablet with nobody signed in
  const q2 = await file(anon, "ASKME make that one clearer");
  await read(q2.id);
  t("a nameless request is answered from the device that sent it", (await anon.get(`/api/c/demo/who/question?id=${q2.id}&token=${q2.reply_token}`)).json.question != null);
  t("not from a device without its token", (await anon.get(`/api/c/demo/who/question?id=${q2.id}&token=wrong`)).status === 404 && (await anon.get(`/api/c/demo/who/question?id=${q2.id}`)).status === 404 && (await ben.post(`/api/c/demo/who/requests/${q2.id}/reply`, { answer: "x", token: "wrong" })).status === 403);
  t("in its own words", (await anon.post(`/api/c/demo/who/requests/${q2.id}/reply`, { answer: "the jam light, it is too dim", token: q2.reply_token })).status === 200);
  const rq3 = await waitFor("the proposal", async () => { const x = await fbRow(mgr, q2.id); return x.status === "reviewing" ? x : null; });
  t("and the words reach the proposer", /Answer received: the jam light, it is too dim/.test(rq3.proposal_rationale) && rq3.question.via === "device");
  t("after that the device is told there is nothing more to ask", await (async () => { const x = (await anon.get(`/api/c/demo/who/question?id=${q2.id}&token=${q2.reply_token}`)).json; return x.question === null && x.proposed === true; })());
  // the manager answers for them
  const q3 = await file(ben, "ASKME move it over");
  await read(q3.id);
  t("a floor device cannot use the manager's answer route", (await ben.post(`/api/feedback/${q3.id}/answer`, { answer: "x" })).status === 403);
  t("nor another company's manager", (await acmeMgr.post(`/api/feedback/${q3.id}/answer`, { answer: "x" })).status === 403);
  t("the manager answers for Ben", (await mgr.post(`/api/feedback/${q3.id}/answer`, { answer: "He means the queue list" })).status === 200);
  const rq4 = await waitFor("the proposal", async () => { const x = await fbRow(mgr, q3.id); return x.status === "reviewing" ? x : null; });
  t("the proposal carries the manager's answer, and the record says who answered", /Answer received: He means the queue list/.test(rq4.proposal_rationale) && rq4.question.via === "manager" && (await rec(`kind=question_answered&feedback_id=${q3.id}`))[0].actor_role === "manager");
  t("Ben is no longer asked", (await ben.get("/api/c/demo/who/requests")).json.requests.find((x) => x.id === q3.id).state === "proposed" && (await ben.post(`/api/c/demo/who/requests/${q3.id}/reply`, { answer: "x" })).status === 409);
  // propose anyway
  const q4 = await file(ben, "ASKME tidy this up");
  await read(q4.id);
  t("the manager can go past a question", (await mgr.post(`/api/feedback/${q4.id}/review`)).status === 200);
  t("then a proposal is there, no second question, and Ben is not asked any more", await (async () => { const x = await fbRow(mgr, q4.id); const m = (await ben.get("/api/c/demo/who/requests")).json.requests.find((y) => y.id === q4.id); return x.status === "reviewing" && x.proposal_id && !x.question.answer && m.state === "proposed" && m.question === null; })());
  // a question that does not read plainly is never shown
  const q5 = await file(ben, "ASKMEBADLY sort this");
  const rq5 = await read(q5.id);
  t("a question in software words is dropped and the proposal stands", rq5.status === "reviewing" && !rq5.question && rq5.proposal_id);

  // ---- 5. not about this tool, a new tool
  const n1 = await file(ana, "NOTTHISTOOL the roof leaks over station 3");
  const rn1 = await read(n1.id);
  t("a request that is not about the tool is flagged with one sentence, not proposed", rn1.status === "new" && rn1.triage === "not_this_tool" && rn1.triage_note.length > 10 && !rn1.proposal_id);
  t("the flag is on the record", (await rec(`kind=request_flagged&feedback_id=${n1.id}`))[0].detail.triage === "not_this_tool");
  t("Ana still reads that it is on the board", (await ana.get("/api/c/demo/who/requests")).json.requests.find((x) => x.id === n1.id).state === "new");
  t("the manager can ask for a proposal anyway, and the flag goes", await (async () => { const x = await mgr.post(`/api/feedback/${n1.id}/review`); const y = await fbRow(mgr, n1.id); return x.status === 200 && y.status === "reviewing" && !y.triage && y.proposal_id; })());
  const n2 = await file(ana, "NEWTOOL we need a tool for the shipping dock");
  const rn2 = await read(n2.id);
  t("a request for a whole new tool is flagged as that", rn2.triage === "new_tool" && rn2.status === "new");
  t("and can be declined with a reason", (await mgr.post(`/api/feedback/${n2.id}/close`, { declined: true, outcome: "start it from + New module" })).status === 200 && (await fbRow(mgr, n2.id)).status === "declined");

  // ---- 6. switched off, it is the old board
  t("the manager switches reading on arrival off", (await mgr.post("/api/c/demo/agents/arrival", { auto_propose: false })).json.auto_propose === false);
  const o1 = await file(ana, "make the takt text bigger");
  await sleep(700);
  const ro1 = await fbRow(mgr, o1.id);
  t("a request then waits for the button", o1.arrival === null && ro1.status === "new" && /switched off/.test(ro1.arrival) && !ro1.proposal_id);
  const o2 = await file(ben, "DUPE takt text is tiny");
  t("the button still sorts: a repeat is folded in when the manager presses it", await (async () => { const x = await mgr.post(`/api/feedback/${o2.id}/review`); const y = await fbRow(mgr, o1.id); return x.status === 200 && x.json.triage === "duplicate" && y.dupes && y.dupes[0].id === o2.id; })());
  t("and proposes", (await mgr.post(`/api/feedback/${o1.id}/review`)).json.id > 0 && (await fbRow(mgr, o1.id)).status === "reviewing");
  t("back on", (await mgr.post("/api/c/demo/agents/arrival", { auto_propose: true })).json.auto_propose === true);

  // ---- 7. a failure leaves the request as it was before any of this existed
  const x1 = await file(ana, "FAILPROPOSE make the footer text bigger");
  const rx1 = await read(x1.id);
  t("a failed call leaves the card on the board with its button", rx1.status === "new" && rx1.arrival === "failed" && !rx1.proposal_id);
  const x2 = await file(ana, "CREDITOUT make the header text bigger");
  const rx2 = await read(x2.id);
  const cr = (await admin.get("/api/admin/credit")).json;
  t("a call refused for credit is marked on the admin page as the service being out", rx2.arrival === "failed" && cr.outage && cr.outage.kind === "credit" && cr.level === "red", cr);
  t("and the manager's button says so in plain words, not the raw message", await (async () => { const x = await mgr.post(`/api/feedback/${x2.id}/review`); return x.status === 500 && /AI service was not available/.test(x.json.error) && !/credit/i.test(x.json.error); })());

  // ---- 8. the glide slope
  t("only an admin sees or sets the balance", (await mgr.get("/api/admin/credit")).status === 403 && (await mgr.post("/api/admin/credit", { balance_usd: 5 })).status === 403);
  t("a balance that is not a number is refused", (await admin.post("/api/admin/credit", { balance_usd: "lots" })).status === 400 && (await admin.post("/api/admin/credit", { balance_usd: -1 })).status === 400);
  const set = (await admin.post("/api/admin/credit", { balance_usd: 120.5, autofill: false, note: "topped up" })).json;
  t("entering the balance gives a projection and clears the outage", set.known === true && set.balance_usd === 120.5 && set.outage === null && /About \$120\.50 left/.test(set.line), set);
  t("with nothing spent (fake mode) it says there is no date to project", set.runout === null && /no runout date/.test(set.line) && set.level === "ok");
  t("autofill is remembered", (await admin.post("/api/admin/credit", { balance_usd: 120.5, autofill: true })).json.anchor.autofill === true);

  // ---- 9. loop health counts it
  const h = (await admin.get("/api/admin/health?days=30")).json;
  const ha = (h.companies.find((c) => c.slug === "demo") || {}).arrival || {};
  t("loop health: proposed on arrival, folded, asked, answered, flagged, undone", ha.proposed >= 8 && ha.duplicates === 4 && ha.questions === 4 && ha.answered === 3 && ha.answered_by_manager === 1 && ha.flagged === 2 && ha.unlinked === 1 && ha.waiting_answer === 0, ha);
  t("a folded request is not an open item of its own", h.companies.find((c) => c.slug === "demo").feedback.open === (await board(mgr)).feedback.filter((f) => ["new", "reviewing", "in_progress"].includes(f.status)).length);

  // ---- 10. a backup carries the new table
  const bk = (await admin.get("/api/admin/backup")).json;
  t("the backup carries the balance entries and the feedback's new columns", (bk.platform.ai_credit || []).length === 2 && bk.platform.feedback.some((f) => f.duplicate_of) && bk.platform.feedback.some((f) => f.question));
  R.done();
})().catch(R.abort);
