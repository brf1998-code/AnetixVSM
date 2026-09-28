// Checks for the outside check (ops/outside-check/worker.mjs, the Cloudflare Worker that watches app.anetix.ai and
// anetix.ai from outside Railway). No network: fetch, KV and the clock are stand-ins.
//   node scripts/test-outside-check.js
const path = require("path");
let pass = 0, fail = 0;
const t = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log(`FAIL  ${name}${detail !== undefined ? "\n      " + JSON.stringify(detail).slice(0, 600) : ""}`); } };

// the world the worker sees: what each address answers, and what reached ntfy
const world = { product: { status: 200, body: { ok: true, db: true, v: "c6cdc40", boot: "1790000000000" } }, signin: { status: 200, body: "<title>Anetix · Sign in</title>" },
  www: { status: 200, body: { ok: true, v: "6998d6f", boot: "1790000000001" } }, wall: { status: 200, body: "<title>Anetix</title>" } };
const flaky = {};   // key -> how many more answers fail before it answers again
let sent = [], ntfyUp = true, hang = null;
const which = (url) => (url.includes("app.test/health") ? "product" : url.includes("app.test/login") ? "signin" : url.includes("www.test/health") ? "www" : url.includes("www.test/?") ? "wall" : null);
global.fetch = async (url, init = {}) => {
  if (String(url).startsWith("https://ntfy.test")) {
    if (!ntfyUp) return { ok: false, status: 500, text: async () => "" };
    sent.push(JSON.parse(init.body)); return { ok: true, status: 200, text: async () => "{}" };
  }
  const k = which(String(url));
  if (!k) throw new Error("unexpected url " + url);
  if (hang === k) return new Promise((_res, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("timed out"), { name: "TimeoutError" }))));
  if (flaky[k] > 0) { flaky[k]--; return { ok: false, status: 502, text: async () => "bad gateway" }; }
  const w = world[k];
  return { ok: w.status < 400, status: w.status, text: async () => (typeof w.body === "string" ? w.body : JSON.stringify(w.body)) };
};
const kv = new Map(); let writes = 0;
const STATE = { get: async (k, type) => (kv.has(k) ? (type === "json" ? JSON.parse(kv.get(k)) : kv.get(k)) : null), put: async (k, v) => { writes++; kv.set(k, v); } };
const env = { STATE, NTFY_TOPIC: "anetix-test", NTFY_URL: "https://ntfy.test", PRODUCT_URL: "https://app.test", WWW_URL: "https://www.test", RETRY_MS: "1", TIMEOUT_MS: "50", SUMMARY_HOUR_UTC: "12", REMIND_MIN: "60" };
const MIN = 60000;
let clock = Date.parse("2026-09-28T02:00:00Z");

const keep = setInterval(() => {}, 1000);   // AbortSignal.timeout's timer does not hold Node open; the Worker has no such issue
(async () => {
  const worker = (await import(path.join(__dirname, "../ops/outside-check/worker.mjs"))).default;
  const tick = async (e = env) => { const waits = []; await worker.scheduled({ scheduledTime: clock }, e, { waitUntil: (p) => waits.push(p) }); await Promise.all(waits); clock += MIN; };
  const last = () => sent[sent.length - 1];
  const state = () => JSON.parse(kv.get("state"));

  // the first run says it is running and what it saw
  await tick();
  t("the first run says it is running, with the versions it saw", sent.length === 1 && last().title === "Outside check is running" && /app\.anetix\.ai answers \(version c6cdc40\)/.test(last().message) && /anetix\.ai answers \(version 6998d6f\)/.test(last().message) && /12:00 UTC/.test(last().message), sent);
  t("to the topic it was given, and it kept what it saw", last().topic === "anetix-test" && state().targets.product.v === "c6cdc40" && state().targets.www.boot === "1790000000001");
  // quiet while nothing changes, and no write to KV
  const w0 = writes; sent = [];
  await tick(); await tick();
  t("nothing changed: nothing sent and nothing written", sent.length === 0 && writes === w0, { sent, writes: writes - w0 });

  // one miss that answers on the retry is a short miss: counted, never sent
  flaky.product = 1;
  await tick();
  t("a miss that answers on the retry is not an alert", sent.length === 0 && state().day.short.product === 1, state().day);

  // the product down on all three tries, the sign-in page with it: one alert naming both
  world.product = { status: 503, body: { ok: false, db: false } }; world.signin = { status: 502, body: "bad gateway" };
  await tick();
  t("down on three tries: one alert naming both, at the top priority", sent.length === 1 && /app\.anetix\.ai and the sign-in page on app\.anetix\.ai not answering/.test(last().title) && /database did not answer/.test(last().message) && last().priority === 5, sent);
  sent = [];
  await tick();
  t("still down a minute later: nothing more", sent.length === 0);
  clock += 58 * MIN; await tick();
  t("still down after an hour: one reminder", sent.length === 1 && /still not answering after 6\d minutes/.test(last().message) && last().priority === 4, sent);
  sent = []; await tick();
  t("and not again the next minute", sent.length === 0);

  // back: how long it was out
  world.product = { status: 200, body: { ok: true, db: true, v: "c6cdc40", boot: "1790000000000" } }; world.signin = { status: 200, body: "<title>Anetix · Sign in</title>" };
  await tick();
  t("answering again, with how long it was out", sent.length === 1 && /answering again/.test(last().title) && /back after about 6\d minutes/.test(last().message), sent);
  t("the outage is kept for the morning line", state().day.outages.length === 2 && state().targets.product.up === true, state().day.outages);

  // a push: a new version on the product
  sent = []; world.product = { status: 200, body: { ok: true, db: true, v: "abc1234", boot: "1790000999999" } };
  await tick();
  t("a new version is confirmed from outside", sent.length === 1 && /a new version is live/.test(last().title) && /app\.anetix\.ai is on abc1234 now \(it was on c6cdc40\)/.test(last().message), sent);
  // a restart with no new version
  sent = []; world.product = { status: 200, body: { ok: true, db: true, v: "abc1234", boot: "1791111111111" } };
  await tick();
  t("a restart with no new version is said too", sent.length === 1 && /restarted without a new version \(still abc1234\)/.test(last().message), sent);

  // the edge refusing the sign-in page while the product answers
  sent = []; world.signin = { status: 403, body: "refused" };
  await tick();
  t("the sign-in page refused while /health answers names the Cloudflare rule", sent.length === 1 && /sign-in page on app\.anetix\.ai was refused \(403\)/.test(last().message) && /edge secret/.test(last().message) && !/app\.anetix\.ai and/.test(last().title), sent);
  world.signin = { status: 200, body: "<title>Anetix · Sign in</title>" }; await tick(); sent = [];

  // no answer at all: a timeout
  hang = "www"; await tick(); hang = null;
  t("a service that never answers is timed out and reported", sent.length === 1 && /anetix\.ai did not answer in 0 s/.test(last().message), sent);
  await tick(); sent = [];

  // ntfy down: the alert is tried again next run, not lost
  world.wall = { status: 500, body: "x" }; ntfyUp = false;
  await tick();
  t("an alert ntfy did not take is not marked sent", state().targets.wall.alerted === null);
  ntfyUp = true; await tick();
  t("so the next run sends it", sent.length === 1 && /front page/.test(last().title), sent);
  world.wall = { status: 200, body: "<title>Anetix</title>" }; await tick(); sent = [];

  // the morning line at 12:00 UTC, once
  clock = Date.parse("2026-09-28T12:00:00Z");
  await tick();
  const m = last();
  t("the morning line comes at the hour with the day in it", sent.length === 1 && m.title === "Outside check: the last day" && /outages?:/.test(m.message) && /short misses that answered on the retry: app\.anetix\.ai 1/.test(m.message) && /new versions: app\.anetix\.ai abc1234/.test(m.message) && /restarts without a new version/.test(m.message) && /Now: app\.anetix\.ai on abc1234, anetix\.ai on 6998d6f/.test(m.message), m);
  await tick();
  t("once a day only", sent.length === 1);
  t("and the day starts over", state().day.outages.length === 0 && state().summary_date === "2026-09-28");
  clock = Date.parse("2026-09-29T12:01:00Z"); sent = [];
  await tick();
  t("a quiet day says all good, without buzzing", sent.length === 1 && last().title === "Outside check: all good" && /every check answered, nothing restarted/.test(last().message) && last().priority === 2, sent);
  sent = []; clock = Date.parse("2026-09-30T12:00:00Z");
  await tick({ ...env, SUMMARY_HOUR_UTC: "off" });
  t("SUMMARY_HOUR_UTC=off sends no morning line", sent.length === 0);

  // without the KV binding it says so in the log and sends nothing
  const before = sent.length; const log = console.log; let said = ""; console.log = (x) => { said += x; };
  await tick({ ...env, STATE: undefined }); console.log = log;
  t("no KV binding: nothing sent, and the log says which step is missing", sent.length === before && /STATE binding/.test(said));
  t("its own address shows nothing", (await worker.fetch()).status === 404);
  t("no dashes in anything it sends", !/[–—]/.test(require("fs").readFileSync(path.join(__dirname, "../ops/outside-check/worker.mjs"), "utf8")));

  clearInterval(keep);
  process.stdout.write(`\n${pass} passed, ${fail} failed\n`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });
