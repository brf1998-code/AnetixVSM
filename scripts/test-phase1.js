// Unit checks for the launch audit's Phase 1 pieces that need no database: the uptime watcher (src/uptime.js), the
// graceful stop (src/restart.js), a fenced write's answer (src/errors.js), which stops count as "before a preview"
// (src/demostops.js).
//   node scripts/test-phase1.js
let pass = 0, fail = 0;
const t = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log(`FAIL  ${name}${detail !== undefined ? "\n      " + JSON.stringify(detail).slice(0, 400) : ""}`); } };

(async () => {
  // ---- the uptime watcher ----
  const { watcher } = require("../src/uptime");
  let clock = 0, up = true, sent = [];
  const w = watcher({ name: "anetix.ai", url: "https://x.test/health", send: (title, message) => sent.push({ title, message }), now: () => clock,
    fetchFn: async () => { if (up === "throw") throw new Error("ECONNREFUSED"); return { ok: up, status: up ? 200 : 502 }; } });
  await w.tick();
  t("up: nothing sent", sent.length === 0 && w.state.fails === 0);
  up = false; clock = 60e3; await w.tick(); clock = 120e3; await w.tick();
  t("two misses: nothing yet", sent.length === 0 && w.state.fails === 2);
  up = "throw"; clock = 180e3; await w.tick();
  t("the third miss sends one alert, saying why", sent.length === 1 && /is not answering/.test(sent[0].title) && /could not be reached, 3 times in a row/.test(sent[0].message), sent);
  clock = 240e3; await w.tick();
  t("a fourth miss sends nothing more", sent.length === 1);
  up = true; clock = 60e3 + 5 * 60e3; await w.tick();
  t("back up: one 'answers again' with how long", sent.length === 2 && /answers again/.test(sent[1].title) && /about 5 minutes/.test(sent[1].message), sent[1]);
  up = false; clock += 60e3; await w.tick(); up = true; await w.tick();
  t("one miss and back: nothing sent", sent.length === 2);
  const slow = watcher({ name: "x", url: "u", send: () => {}, timeoutMs: 50, fetchFn: (u, o) => new Promise((_, rej) => o.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })))) });
  await slow.tick(); await slow.tick(); let said = null; const slow2 = watcher({ name: "x", url: "u", misses: 1, timeoutMs: 50, send: (a, m) => { said = m; }, fetchFn: (u, o) => new Promise((_, rej) => o.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })))) });
  await slow2.tick();
  t("a service that hangs counts as a miss, said as no answer in time", slow.state.fails === 2 && /no answer in 0 s|no answer in/.test(said || ""), said);

  // ---- a fenced write answers as a restart ----
  const errors = require("../src/errors");
  const c = errors.classify(Object.assign(new Error("run #3 was taken over by a newer process"), { fenced: true }));
  t("a fenced write is a 503 in restart words, not a product error", c.status === 503 && /restarting/.test(c.error), c);

  // ---- which stops are before a preview ----
  const { hadPreview } = require("../src/demostops");
  t("stopped while building: no preview (a draft version exists already)", hadPreview({ step: "build", to_version: 4 }) === false);
  t("stopped writing the requirement: no preview", hadPreview({ step: "confirm_requirement", to_version: null }) === false);
  t("stopped at the second review: a preview", hadPreview({ step: "cross_check", to_version: 4, evidence: { cross_check: { verdict: "fail", model: "x" } } }) === true);
  t("stopped by the platform's own gate: no preview", hadPreview({ step: "cross_check", to_version: 4, evidence: { cross_check: { verdict: "fail", model: "platform checks" } } }) === false);
  t("stopped in the tests or on the test floor: a preview", hadPreview({ step: "test_run", to_version: 4 }) && hadPreview({ step: "campaign", to_version: 4 }));

  // ---- the graceful stop ----
  const restart = require("../src/restart");
  let closed = false, idle = false, exited = null;
  const server = { close: (cb) => { closed = true; setTimeout(cb, 20); }, closeIdleConnections: () => { idle = true; } };
  const g = restart.graceful(server, { drainMs: 2000, exit: (code) => { exited = code; } });
  const res = { headers: {}, set(k, v) { this.headers[k] = v; } };
  restart.drainingMiddleware({}, res, () => {});
  t("before a stop, answers keep their connection", !res.headers.Connection);
  g.stop("SIGTERM");
  t("a stop closes the listener and the idle connections at once", closed && idle && restart.state.draining);
  restart.drainingMiddleware({}, res, () => {});
  t("while draining, every answer closes its connection", res.headers.Connection === "close");
  await new Promise((r) => setTimeout(r, 300));
  t("with no build to stop, it exits as soon as the requests are done", exited === 0, exited);
  g.stop("SIGTERM");
  t("a second signal changes nothing", exited === 0);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); console.log(`\n${pass} passed, ${fail + 1} failed`); process.exit(1); });
