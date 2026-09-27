// What a restart leaves behind, and a restart that leaves less (the launch audit 1.13). Every push restarts the product.
//
// sweep(), at boot: work that ran in the old process's memory and has no process behind it any more. Until this, each
// kind stayed "in progress" for ever: a new-tool request on "The agent is reading the answers" with a spinner, a system
// review that blocked the next one, diagrams that never drew, a brand guide "building". Builds and test campaigns had
// their own sweeps already (src/pipeline.js sweepOrphans, src/campaign.js sweep), and so did sample data (src/sample.js).
//   - a new-tool request thinking: failed, with a line the tile shows, and "Open and try again" sends the answers again;
//     one that was redoing a design after an edit goes back to that design, with a line saying the edit was not applied
//   - a system review running: failed, "start it again from Settings"
//   - diagrams drawing: failed (Diagrams on the board draws them again)
//   - a brand guide building: failed (the admin page builds it again)
// The old process can still be up for a moment while this runs (Railway switches over once the new one answers). What
// it finishes in that moment still lands: a design that arrives turns the failed request back into a design to review.
//
// graceful(server), SIGTERM and SIGINT: stop taking new connections, let the requests in flight finish (at most
// SOS_DRAIN_MS, 25 s by default), stop the build agents that are talking (src/pipeline.js shutdown: each is marked as cut
// off by the restart unless the new process took it over already), stop the tool processes, close the database pool,
// exit. Railway gives an old deployment "drainingSeconds" between SIGTERM and SIGKILL, 0 unless set: railway.json sets
// 30 (RAILWAY_DEPLOYMENT_DRAINING_SECONDS on the service would override it), so SOS_DRAIN_MS stays under that.
const { q, pool } = require("./db");

const DRAIN_MS = Number(process.env.SOS_DRAIN_MS || 25000);
const WORDS = {
  intake: "the platform restarted while the AI was reading the answers",
  adjust: "The platform restarted while the AI was redoing the design, so your edit was not applied. Send it again.",
  review: "the platform restarted while this review was running; nothing was filed. Start it again from Settings.",
  brand: "the platform restarted while the brand guide was being made; build it again",
};

async function sweep() {
  const out = {};
  out.intakes_redo = (await q("UPDATE platform.module_intakes SET status='design', error=$1, updated_at=now() WHERE status='thinking' AND design IS NOT NULL RETURNING id", [WORDS.adjust])).rowCount;
  out.intakes = (await q("UPDATE platform.module_intakes SET status='failed', error=$1, updated_at=now() WHERE status='thinking' AND design IS NULL RETURNING id", [WORDS.intake])).rowCount;
  out.reviews = (await q("UPDATE platform.reviews SET status='failed', summary=$1, finished_at=now() WHERE status='running' RETURNING id", [WORDS.review])).rowCount;
  out.diagrams = (await q("UPDATE platform.diagrams SET status='failed', finished_at=now() WHERE status='running' RETURNING id")).rowCount;
  out.brands = (await q(`UPDATE platform.companies SET brand = brand || jsonb_build_object('status','failed','error',$1::text,'failed_at',now()::text)
                         WHERE brand->>'status' = 'building' RETURNING slug`, [WORDS.brand])).rowCount;
  const n = Object.values(out).reduce((a, b) => a + b, 0);
  if (n) console.log(`[restart] left behind by the last process: ${Object.entries(out).filter(([, v]) => v).map(([k, v]) => `${v} ${k.replace("_", " ")}`).join(", ")}; each marked so it can be started again`);
  return out;
}

// ---- stopping ----------------------------------------------------------------------------------------------------------
const state = { draining: false, since: null };
// First in line on the app: while draining, every answer closes its connection, so a browser's kept-alive socket does
// not bring the next request to a process that is going.
function drainingMiddleware(_req, res, next) { if (state.draining) res.set("Connection", "close"); next(); }

function graceful(server, { drainMs = DRAIN_MS, exit = (code) => process.exit(code) } = {}) {
  let done = false;
  const finish = async (why) => {
    if (done) return; done = true;
    console.log(`[shutdown] ${why}; stopping the tool processes and the database pool`);
    try { require("./runner").stopAll(); } catch (e) { /* none running */ }
    await pool.end().catch(() => {});
    exit(0);
  };
  const stop = (sig) => {
    if (state.draining) return;
    state.draining = true; state.since = Date.now();
    console.log(`[shutdown] ${sig}: taking no new requests, letting the ones in flight finish (at most ${Math.round(drainMs / 1000)} s)`);
    let stopped = [];
    try { stopped = require("./pipeline").shutdown(); } catch (e) { console.error("[shutdown] stopping the builds:", e.message); }
    server.close(() => {
      // builds just stopped are still writing their last line: a moment for that, then go
      if (stopped.length) setTimeout(() => finish("every request finished"), 1500).unref();
      else finish("every request finished");
    });
    if (typeof server.closeIdleConnections === "function") server.closeIdleConnections();
    setTimeout(() => finish(`${Math.round(drainMs / 1000)} s passed`), drainMs).unref();
  };
  process.once("SIGTERM", () => stop("SIGTERM"));
  process.once("SIGINT", () => stop("SIGINT"));
  return { stop, state };
}

module.exports = { sweep, graceful, drainingMiddleware, state, WORDS };
