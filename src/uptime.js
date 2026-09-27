// Each service watches the other (the launch audit 1.15). anetix.ai asks this product's /health?deep=1 every minute
// (www/uptime.js) and this product asks anetix.ai's /health: a service that is down cannot say so itself, so the other
// one does, to Anetix's phones. Three misses in a row send one alert; the first answer after that sends "answers again"
// with how long it was out. Both run on Railway, so a Railway-wide outage silences both: an outside checker on
// https://app.anetix.ai/health?deep=1 (UptimeRobot or the like, pointed at the same ntfy topic) covers that case.
//
// Runs only where an alert can go (NTFY_TOPIC set) and SOS_UPTIME_WATCH is not 0. SOS_UPTIME_MS: how often (60 s).
const WWW_URL = () => String(process.env.SOS_WWW_URL || "https://anetix.ai").replace(/\/+$/, "");
const EVERY_MS = Number(process.env.SOS_UPTIME_MS || 60000);
const MISSES = 3;

// One watcher, pure but for fetch and the clock: the tests drive it with their own.
function watcher({ name, url, send, fetchFn = fetch, now = () => Date.now(), misses = MISSES, timeoutMs = 10000 }) {
  const st = { fails: 0, down_since: null, alerted: false, last: null };
  async function tick() {
    let ok = false, why = "";
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
    try { const r = await fetchFn(url, { signal: ctl.signal, cache: "no-store" }); ok = r.ok; if (!ok) why = `answered ${r.status}`; }
    catch (e) { why = e.name === "AbortError" ? `no answer in ${Math.round(timeoutMs / 1000)} s` : "could not be reached"; }
    finally { clearTimeout(t); }
    st.last = { at: new Date(now()).toISOString(), ok };
    if (ok) {
      if (st.alerted) {
        const mins = Math.max(1, Math.round((now() - st.down_since) / 60000));
        send(`${name} answers again`, `${name} is back after about ${mins} minute${mins === 1 ? "" : "s"} without answering.`, { priority: 3, tags: ["white_check_mark"] });
      }
      st.fails = 0; st.down_since = null; st.alerted = false;
      return st;
    }
    st.fails++;
    if (st.fails === 1) st.down_since = now();
    if (st.fails >= misses && !st.alerted) {
      st.alerted = true;
      send(`${name} is not answering`, `${url} ${why}, ${st.fails} times in a row (checked every ${Math.round(EVERY_MS / 1000)} s). Railway's dashboard shows whether the service is up.`, { priority: 5, tags: ["rotating_light"] });
    }
    return st;
  }
  return { tick, state: st };
}

let timer = null, w = null;
function start() {
  if (timer || String(process.env.SOS_UPTIME_WATCH || "") === "0" || !require("./notify").configured()) return null;
  w = watcher({ name: "anetix.ai", url: `${WWW_URL()}/health`, send: (title, message, opts) => require("./notify").notify(title, message, opts) });
  timer = setInterval(() => w.tick().catch(() => {}), EVERY_MS); timer.unref();
  return w;
}
const status = () => (w ? { watching: `${WWW_URL()}/health`, ...w.state } : { watching: null });

module.exports = { watcher, start, status };
