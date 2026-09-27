// src/errors.js (the launch audit 0.1): an async route's rejection gets an answer, the answer's status and words, the
// alert's throttle and what it may say, and a stray rejection or throw that no longer ends the process. No database.
//   node scripts/test-errors.js
process.env.SOS_ERROR_ALERT_GAP_MS = "300";
const assert = require("assert");
const { spawnSync } = require("child_process");
const express = require("express");
const E = require("../src/errors");
const notify = require("../src/notify");
let pass = 0, fail = 0;
const t = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log(`FAIL  ${name}${detail !== undefined ? "\n      " + JSON.stringify(detail).slice(0, 400) : ""}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // ---- classify (pure)
  const pg = (code) => Object.assign(new Error(`invalid input syntax for type integer: "secret words"`), { code });
  t("a malformed id from the database is the caller's mistake, 400", E.classify(pg("22P02")).status === 400);
  t("an id past the column's range is 400 too", E.classify(pg("22003")).status === 400);
  t("the 400 does not repeat the database's words (they can quote what was typed)", !/secret words/.test(E.classify(pg("22P02")).error));
  t("a body that is not JSON is 400 with plain words", E.classify({ type: "entity.parse.failed", status: 400 }).status === 400 && /not valid JSON/.test(E.classify({ type: "entity.parse.failed" }).error));
  t("a body too large is 413", E.classify({ type: "entity.too.large", status: 413 }).status === 413);
  t("a broken % code in the address is 400", E.classify(new URIError("URI malformed")).status === 400);
  t("our own 404 keeps its words", (() => { const c = E.classify(Object.assign(new Error("no such company"), { status: 404 })); return c.status === 404 && c.error === "no such company"; })());
  const five = E.classify(new TypeError("Cannot read properties of undefined (reading 'rows')"));
  t("anything else is a 500 that says nothing about the inside and says who to write to", five.status === 500 && !/rows|undefined/.test(five.error) && /brendan@anetix\.ai or taylor@anetix\.ai/.test(five.error));
  t("no dashes in the words a person reads", ![five.error, E.classify(pg("22P02")).error, E.classify({ type: "entity.parse.failed" }).error].some((s) => /[–—]/.test(s)));

  // ---- shape: the path an alert may name
  t("numbers are blanked and the query is dropped", E.shape({ originalUrl: "/api/runs/1234/label?x=secret" }) === "/api/runs/:n/label");
  t("a company's slug stays (a company name is allowed in an alert)", E.shape({ originalUrl: "/api/c/acme-north/export" }) === "/api/c/acme-north/export");
  t("kind names the class and the code, never the message", E.kind(pg("22P02")) === "Error, code 22P02" && !/secret/.test(E.kind(pg("22P02"))));

  // ---- the routes: an app with the three layers
  E.asyncRoutes();
  const app = express();
  app.use(express.json());
  app.get("/api/reject", async () => { throw new Error("database said no"); });
  app.get("/api/badid", async () => { throw pg("22P02"); });
  app.get("/api/throw", () => { throw new Error("sync throw"); });
  app.get("/api/answered-then-failed", async (_req, res) => { res.json({ ok: true, long: "x".repeat(200000) }); throw new Error("after the answer"); });
  app.get("/api/fine", async (_req, res) => res.json({ ok: true }));
  app.get("/page", async () => { throw new Error("page broke"); });
  app.post("/api/body", (req, res) => res.json(req.body));
  app.use("/api", E.apiNotFound);
  app.use(E.handler);
  const srv = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const base = `http://127.0.0.1:${srv.address().port}`;
  const get = async (p, opts) => { const r = await fetch(base + p, opts); const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (_) {} return { status: r.status, json, text, type: r.headers.get("content-type") || "" }; };

  E._reset(); notify._sent.length = 0;
  const logs = []; const origErr = console.error, origWarn = console.warn;
  console.error = (...a) => logs.push(a.join(" ")); console.warn = (...a) => logs.push(a.join(" "));
  const rej = await get("/api/reject");
  t("an async route's rejection is answered 500 JSON (it used to end the process)", rej.status === 500 && rej.json && /went wrong on our side/.test(rej.json.error), rej);
  t("the 500's words never carry the error's message", !/database said no/.test(rej.text));
  t("the log line has the method, the path and the stack", logs.some((l) => /\[error\] GET \/api\/reject -> 500: Error: database said no/.test(l)), logs);
  t("a 500 sends one alert, naming the route and the class", E._alerts.length === 1 && /GET \/api\/reject answered 500 \(Error\)/.test(E._alerts[0].message) && !/database said no/.test(E._alerts[0].message), E._alerts);
  t("the alert went through notify (logged even with no topic set)", notify._sent.some((s) => s.title === "Product error"));
  const bad = await get("/api/badid");
  t("a malformed id is 400, and no alert for a caller's mistake", bad.status === 400 && E._alerts.length === 1, [bad.status, E._alerts.length]);
  t("a synchronous throw is answered too", (await get("/api/throw")).status === 500);
  t("an alert inside the gap is held, not sent", E._alerts.length === 1);
  await sleep(350);
  await get("/api/reject");
  t("the next alert after the gap counts what was held", E._alerts.length === 2 && /1 more since the last alert/.test(E._alerts[0].message), E._alerts);
  const done = await get("/api/answered-then-failed");
  t("a route that answered in full and failed after keeps its answer whole", done.status === 200 && done.json && done.json.long.length === 200000);
  t("an /api/ path nothing answers is JSON 404", (await get("/api/nothing/here")).status === 404 && (await get("/api/nothing/here")).json.error === "not found");
  const page = await get("/page");
  t("a page that fails gets a short page, not a stack", page.status === 500 && /text\/html/.test(page.type) && /Something went wrong/.test(page.text) && !/page broke|at /.test(page.text.replace(/Back to the start/, "")), page.text.slice(0, 300));
  const body = await fetch(base + "/api/body", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{not json" });
  t("a body that is not JSON is 400 JSON", body.status === 400 && /not valid JSON/.test((await body.json()).error));
  t("a good route is untouched", (await get("/api/fine")).json.ok === true);
  console.error = origErr; console.warn = origWarn;
  srv.close();

  // ---- the guards, in a process of their own: a stray rejection and a stray throw no longer end it
  const child = spawnSync(process.execPath, ["-e", `
    const E = require(${JSON.stringify(require.resolve("../src/errors"))});
    E.guards();
    Promise.reject(new Error("stray rejection"));
    setTimeout(() => { throw new Error("stray throw"); }, 20);
    setTimeout(() => { console.log("STILL HERE"); process.exit(0); }, 200);
  `], { encoding: "utf8", timeout: 10000 });
  t("an unhandled rejection is logged and the process goes on", /\[guard\] unhandled rejection: Error: stray rejection/.test(child.stderr), child.stderr);
  t("an uncaught exception is logged and the process goes on", /\[guard\] uncaught exception: Error: stray throw/.test(child.stderr) && /STILL HERE/.test(child.stdout) && child.status === 0, { out: child.stdout, err: child.stderr, status: child.status });
  const loop = spawnSync(process.execPath, ["-e", `
    const E = require(${JSON.stringify(require.resolve("../src/errors"))});
    E.guards();
    let n = 0; const i = setInterval(() => { n++; setImmediate(() => { throw new Error("loop " + n); }); }, 2);
    setTimeout(() => { console.log("NEVER"); process.exit(0); }, 3000);
  `], { encoding: "utf8", timeout: 10000 });
  t("a process throwing in a loop (over 30 a minute) exits so Railway restarts it clean", loop.status === 1 && !/NEVER/.test(loop.stdout) && /exiting so Railway restarts/.test(loop.stderr), { status: loop.status });
  const rejections = spawnSync(process.execPath, ["-e", `
    const E = require(${JSON.stringify(require.resolve("../src/errors"))});
    E.guards();
    let n = 0; const i = setInterval(() => { n++; Promise.reject(new Error("r" + n)); }, 2);
    setTimeout(() => { console.log("STILL HERE after " + n); process.exit(0); }, 1500);
  `], { encoding: "utf8", timeout: 10000 });
  t("rejections never count toward the loop: hundreds in a second and the process stays", rejections.status === 0 && /STILL HERE/.test(rejections.stdout), { status: rejections.status, out: rejections.stdout });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("ABORTED:", e); process.exit(1); });
