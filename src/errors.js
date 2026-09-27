// One bad request must never stop the product (the launch audit, 0.1, 2026-09-27). Found on 9/26: any signed-in
// session that opened /api/runs/abc ended the whole process. Express 4 does not catch a promise an async handler
// rejects, the database refused NaN as an id, and Node ends the process on an unhandled rejection. Railway restarted it,
// and each restart cut off every build and new-tool request running at the time.
//
// Three layers, installed by server.js:
//   asyncRoutes()  a route's rejected promise goes to next(err), the way a thrown error already did. Express 5 does this
//                  itself; this is the same few lines for Express 4, on the Layer every router shares (so module routers
//                  mounted in this process get it too). src/runner-child.js carries its own copy.
//   handler        the last middleware. Logs the method, the path and the stack (never the query or the body). Answers
//                  JSON under /api/ and a short page elsewhere. A malformed value or a body the parser refused is the
//                  caller's mistake (400, 404, 413); anything else is a 500 that says nothing about the inside.
//   guards()       an unhandled rejection or an uncaught exception is logged and the process keeps going. A process
//                  with more than CRASH_LOOP uncaught exceptions in a minute exits anyway (Railway restarts it): that
//                  is a loop, and a throw can leave state half changed. Rejections never count toward it.
// Every 500 and every guard catch sends one ntfy alert (src/notify.js), at most one per ALERT_GAP with a count of the
// rest. An alert names the route's shape (ids blanked) and the error's class and code, never its message: a database
// error's message can quote what a person typed.
const Layer = require("express/lib/router/layer");

const ALERT_GAP = Number(process.env.SOS_ERROR_ALERT_GAP_MS || 15 * 60 * 1000);
const CRASH_LOOP = 30;
const CONTACT = "brendan@anetix.ai or taylor@anetix.ai";
// Postgres codes that mean "the value handed in was malformed": a caller's mistake, not the product's
const BAD_VALUE = new Set(["22P02", "22003", "22007", "22008", "22023", "2201W", "2201X"]);

let patched = false;
function asyncRoutes() {
  if (patched) return;
  patched = true;
  Layer.prototype.handle_request = function handle(req, res, next) {
    const fn = this.handle;
    if (fn.length > 3) return next();   // an error handler: not for a plain request (as Express 4 does)
    try {
      const out = fn(req, res, next);
      if (out && typeof out.then === "function") out.then(null, (err) => next(err || new Error("a route's promise was rejected with nothing")));
    } catch (err) { next(err); }
  };
}

// What an alert and a log line may say about where it happened: the path with every number blanked, no query.
function shape(req) {
  const p = String((req && (req.originalUrl || req.url)) || "").split("?")[0];
  return p.replace(/\/\d+(?=\/|$)/g, "/:n").slice(0, 120);
}
function kind(err) {
  if (!err || typeof err !== "object") return typeof err;
  return [err.name || (err.constructor && err.constructor.name) || "Error", err.code ? `code ${err.code}` : ""].filter(Boolean).join(", ");
}

// ---- alerts, throttled -----------------------------------------------------------------------------------------------
let lastAlert = 0, held = 0;
const alerts = [];   // what was sent, for the tests (in memory)
function alert(what) {
  const now = Date.now();
  if (now - lastAlert < ALERT_GAP) { held++; return false; }
  const more = held; held = 0; lastAlert = now;
  const message = `${what} The product kept running; the Railway log has the details.${more ? ` ${more} more since the last alert.` : ""}`;
  alerts.unshift({ at: new Date(now).toISOString(), message }); alerts.length = Math.min(alerts.length, 20);
  try { require("./notify").notify("Product error", message, { priority: 4, tags: ["warning"] }); } catch (_) { /* never */ }
  return true;
}

// The status and the words for an error. Pure.
function classify(err) {
  const status = Number(err && (err.status || err.statusCode)) || 0;
  if (err && err.type === "entity.parse.failed") return { status: 400, error: "That request's body is not valid JSON." };
  if (err instanceof URIError) return { status: 400, error: "That address has a broken % code in it." };
  if (err && err.type === "entity.too.large") return { status: 413, error: "That is too large to send in one go." };
  if (status >= 400 && status < 500) return { status, error: err.expose !== false && err.message ? String(err.message).slice(0, 300) : "That request was not right." };
  if (err && BAD_VALUE.has(err.code)) return { status: 400, error: "Something in that request is not a valid value (an id that is not a number, say)." };
  return { status: 500, error: `Something went wrong on our side. Try again, and if it keeps happening write to ${CONTACT}.` };
}

function handler(err, req, res, next) {
  const c = classify(err);
  const where = `${req.method} ${shape(req)}`;
  if (c.status >= 500) {
    console.error(`[error] ${where} -> 500: ${err && err.stack ? err.stack.split("\n").slice(0, 4).join(" | ") : String(err)}`);
    alert(`${where} answered 500 (${kind(err)}).`);
  } else {
    console.warn(`[error] ${where} -> ${c.status}: ${kind(err)}`);
  }
  // the answer already went in full (a route that answered, then failed at something after): nothing to add, and
  // handing it on would have Express cut a connection whose last bytes may still be on their way
  if (res.writableEnded) return;
  if (res.headersSent) return next(err);   // half an answer went: Express closes the connection
  // a page only for a browser opening an address; everything else (an /api/ call, a form or fetch posting JSON) gets JSON
  const page = (req.method === "GET" || req.method === "HEAD") && !/(^|\/)api\//i.test(String(req.originalUrl || req.url).split("?")[0]) && !/json/.test(String(req.headers.accept || ""));
  if (!page) return res.status(c.status).json({ error: c.error });
  res.status(c.status).type("html").send(`<!DOCTYPE html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Anetix</title>
<body style="font-family:system-ui,sans-serif;background:#f2f4f7;color:#1c242e;padding:24px;max-width:560px"><h1 style="font-size:20px">${c.status >= 500 ? "Something went wrong" : "That did not work"}</h1><p>${c.error.replace(/[<>&]/g, "")}</p><p><a href="/" style="color:#1f3a5f">Back to the start</a></p></body>`);
}

// An /api/ path nothing answered: JSON, like every other /api/ answer, instead of Express's HTML page.
function apiNotFound(req, res) { res.status(404).json({ error: "not found" }); }

let guarded = false;
const recent = [];   // times of the last guard catches, for the loop check
function caught(label, e, counts) {
  const now = Date.now();
  if (counts) { recent.push(now); while (recent.length && recent[0] < now - 60000) recent.shift(); }
  console.error(`[guard] ${label}: ${e && e.stack ? e.stack.split("\n").slice(0, 5).join(" | ") : String(e)}`);
  alert(`An ${label} (${kind(e)}).`);
  if (recent.length > CRASH_LOOP) { console.error(`[guard] ${recent.length} in a minute: exiting so Railway restarts a clean process`); process.exit(1); }
}
function guards() {
  if (guarded) return;
  guarded = true;
  process.on("unhandledRejection", (e) => caught("unhandled rejection", e, false));
  process.on("uncaughtException", (e) => caught("uncaught exception", e, true));
}

module.exports = { asyncRoutes, handler, apiNotFound, guards, classify, shape, kind, alert, _alerts: alerts, _reset: () => { lastAlert = 0; held = 0; alerts.length = 0; recent.length = 0; } };
