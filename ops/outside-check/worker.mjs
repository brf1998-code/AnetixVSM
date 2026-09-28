// Anetix outside check (the launch audit 1.15's optional outside checker, 2026-09-27). A Cloudflare Worker that runs
// every minute on Cloudflare, outside Railway, so it still speaks when Railway itself is down (the two services watch
// each other, src/uptime.js and www/uptime.js, but both go quiet together if Railway does). It sends to the same ntfy
// topic as every other alert, so both phones get it.
//
// Every minute it asks four things:
//   app.anetix.ai/health?deep=1   the product is up and its database answers; also which version and which boot
//   app.anetix.ai/login           the sign-in page comes through Cloudflare (the edge check refuses it without the
//                                 Cloudflare rule's secret, while /health is exempt, so this is the path people take)
//   anetix.ai/health              the front door is up; its version and boot
//   anetix.ai/                    the wall page renders
// A thing that fails is asked twice more, 15 s apart, before it counts: one miss that answers on the retry is a
// "short miss", counted for the morning line and never sent.
//
// What it sends:
//   - the first run: that it is running, with what it saw (so setting it up proves itself);
//   - something not answering (all three tries): one alert naming everything down, then a reminder every hour;
//   - answers again: how long it was out;
//   - a new version on app.anetix.ai or anetix.ai (the commit Railway deployed): "is on <sha> now", so a push is
//     confirmed from outside;
//   - a restart with no new version (a variable change, a redeploy, or a crash);
//   - once a day (SUMMARY_HOUR_UTC, 12 = 8am in Boston in summer, 7am in winter): the last day in one line, quietly. If
//     that line does not come one morning, the checker itself has stopped.
//
// Setup is in README.md beside this file. Bindings and variables:
//   STATE             a KV namespace (required): the one key "state"
//   NTFY_TOPIC        a secret: the same topic as NTFY_TOPIC on Railway
//   NTFY_URL          optional, https://ntfy.sh unless set;  NTFY_TOKEN  optional
//   PRODUCT_URL       optional, https://app.anetix.ai;       WWW_URL     optional, https://anetix.ai
//   SUMMARY_HOUR_UTC  optional, 12; "off" sends no morning line
//   REMIND_MIN        optional, 60: how often a thing still down is said again
// It writes to KV only when something changed (Workers KV on the free plan takes 1,000 writes a day), and KV can be a
// minute behind between Cloudflare's locations, so on a rare day a transition may be said twice.

const DEFAULTS = { PRODUCT_URL: "https://app.anetix.ai", WWW_URL: "https://anetix.ai", NTFY_URL: "https://ntfy.sh", SUMMARY_HOUR_UTC: "12", REMIND_MIN: "60", RETRY_MS: "15000", TIMEOUT_MS: "8000" };
const opt = (env, k) => String(env[k] == null || env[k] === "" ? DEFAULTS[k] : env[k]).replace(/\/+$/, "");

function targets(env) {
  const P = opt(env, "PRODUCT_URL"), W = opt(env, "WWW_URL");
  return [
    { key: "product", name: "app.anetix.ai", url: `${P}/health?deep=1`, json: true, versioned: true,
      ok: (r, j) => r.status === 200 && j && j.ok === true && j.db === true,
      why: (r, j) => (r.status === 503 && j && j.db === false ? "answered 503: its database did not answer" : `answered ${r.status}`) },
    { key: "signin", name: "the sign-in page on app.anetix.ai", url: `${P}/login`,
      ok: (r, t) => r.status === 200 && /Anetix/.test(t),
      why: (r) => (r.status === 403 ? "was refused (403): the Cloudflare rule that carries the edge secret may be off or out of step with SOS_EDGE_SECRET" : `answered ${r.status}`) },
    { key: "www", name: "anetix.ai", url: `${W}/health`, json: true, versioned: true,
      ok: (r, j) => r.status === 200 && j && j.ok === true, why: (r) => `answered ${r.status}` },
    { key: "wall", name: "the anetix.ai front page", url: `${W}/`,
      ok: (r, t) => r.status === 200 && /Anetix/.test(t), why: (r) => `answered ${r.status}` },
  ];
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
async function ask(env, tg, now) {
  const url = tg.url + (tg.url.includes("?") ? "&" : "?") + "t=" + now;   // never a cached answer
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(Number(opt(env, "TIMEOUT_MS"))), headers: { "User-Agent": "anetix-outside-check" } });
    const text = await r.text();
    let body = text;
    if (tg.json) { try { body = JSON.parse(text); } catch (e) { body = null; } }
    const ok = tg.ok(r, body);
    return { ok, why: ok ? "" : tg.why(r, body), v: tg.versioned && body ? body.v || null : null, boot: tg.versioned && body && body.boot != null ? String(body.boot) : null };
  } catch (e) {
    return { ok: false, why: e && (e.name === "TimeoutError" || e.name === "AbortError") ? `did not answer in ${Math.round(Number(opt(env, "TIMEOUT_MS")) / 1000)} s` : "could not be reached" };
  }
}
// Each thing once; what failed, twice more RETRY_MS apart. A thing that answers on a retry is a short miss.
async function checkAll(env, now) {
  const list = targets(env), out = {};
  let left = list;
  for (let attempt = 0; attempt < 3 && left.length; attempt++) {
    if (attempt) await sleep(Number(opt(env, "RETRY_MS")));
    const got = await Promise.all(left.map((tg) => ask(env, tg, now + attempt)));
    left.forEach((tg, i) => { out[tg.key] = { ...got[i], tries: attempt + 1 }; });
    left = left.filter((tg) => !out[tg.key].ok);
  }
  return { list, out };
}

async function send(env, title, message, { priority = 3, tags = [] } = {}) {
  const topic = String(env.NTFY_TOPIC || "").trim();
  if (!topic) { console.log(`[outside-check] no NTFY_TOPIC: ${title}: ${message}`); return false; }
  try {
    const r = await fetch(opt(env, "NTFY_URL") + "/", { method: "POST", signal: AbortSignal.timeout(8000),
      headers: { "Content-Type": "application/json", ...(env.NTFY_TOKEN ? { Authorization: `Bearer ${env.NTFY_TOKEN}` } : {}) },
      body: JSON.stringify({ topic, title: title.slice(0, 120), message: message.slice(0, 1000), priority, tags }) });
    if (!r.ok) console.log(`[outside-check] ntfy answered ${r.status} for "${title}"`);
    return r.ok;
  } catch (e) { console.log(`[outside-check] ntfy not reached for "${title}": ${e && e.message}`); return false; }
}

const mins = (a, b) => Math.max(1, Math.round((b - a) / 60000));
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const hhmm = (ms) => new Date(ms).toISOString().slice(11, 16) + " UTC";
const joinAnd = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const freshDay = (now) => ({ from: now, short: {}, outages: [], deploys: [], restarts: [] });

// One run: ask, compare with what was seen before, say what changed, keep the new state. `now` is the schedule's time,
// so the tests drive it with their own clock.
async function run(env, now) {
  if (!env.STATE) { console.log("[outside-check] no STATE binding: add the KV namespace (README.md, step 3)"); return; }
  const before = (await env.STATE.get("state", "json")) || null;
  const st = before ? JSON.parse(JSON.stringify(before)) : { started: now, targets: {}, day: freshDay(now), summary_date: null };
  const { list, out } = await checkAll(env, now);
  const name = Object.fromEntries(list.map((t) => [t.key, t.name]));

  if (!before) {   // the first run: say it is running and what it saw
    const lines = list.map((tg) => {
      const o = out[tg.key];
      st.targets[tg.key] = { up: o.ok, since: now, v: o.v || null, boot: o.boot || null, alerted: o.ok ? null : now, reminded: null };
      return o.ok ? `${tg.name} answers${o.v ? ` (version ${o.v})` : ""}` : `${tg.name} ${o.why}`;
    });
    const hour = opt(env, "SUMMARY_HOUR_UTC");
    const ok = await send(env, "Outside check is running", `Checked from Cloudflare, outside Railway, every minute: ${lines.join("; ")}.${hour === "off" ? "" : ` A quiet line comes each day at ${hour}:00 UTC; if it does not, the checker itself has stopped.`}`,
      { priority: 3, tags: ["white_check_mark"] });
    if (ok) await env.STATE.put("state", JSON.stringify(st));
    return;
  }

  const down = [], back = [], news = [];
  for (const tg of list) {
    const o = out[tg.key], was = st.targets[tg.key] || { up: true, since: now, v: null, boot: null, alerted: null, reminded: null };
    st.targets[tg.key] = was;
    if (o.ok && o.tries > 1) st.day.short[tg.key] = (st.day.short[tg.key] || 0) + 1;
    if (!o.ok) {
      if (was.up) { was.up = false; was.since = now; was.alerted = null; was.reminded = null; }
      if (!was.alerted) down.push({ tg, o, was, first: true });
      else if (now - (was.reminded || was.alerted) >= Number(opt(env, "REMIND_MIN")) * 60000) down.push({ tg, o, was, first: false });
      continue;
    }
    if (!was.up) {
      if (was.alerted) back.push({ tg, since: was.since });
      st.day.outages.push({ key: tg.key, from: was.since, to: now });
      was.up = true; was.since = now; was.alerted = null; was.reminded = null;
    }
    if (tg.versioned && o.v && was.v && o.v !== was.v) { news.push(`${tg.name} is on ${o.v} now (it was on ${was.v}), and answers`); st.day.deploys.push({ key: tg.key, v: o.v, at: now }); }
    else if (tg.versioned && o.boot && was.boot && o.boot !== was.boot) { news.push(`${tg.name} restarted without a new version (still ${o.v || was.v || "the same"}): a variable change or a redeploy does this; if neither, it may have crashed, and Railway's deploy log says which`); st.day.restarts.push({ key: tg.key, at: now }); }
    if (o.v) was.v = o.v;
    if (o.boot) was.boot = o.boot;
  }

  if (down.length) {
    const first = down.filter((d) => d.first), again = down.filter((d) => !d.first);
    const parts = [];
    if (first.length) parts.push(first.map((d) => `${d.tg.name} ${d.o.why}`).join("; ") + " (three tries over 30 seconds)");
    if (again.length) parts.push(again.map((d) => `${d.tg.name} is still not answering after ${plural(mins(d.was.since, now), "minute")}`).join("; "));
    const title = first.length ? `Outside check: ${joinAnd(first.map((d) => d.tg.name))} not answering` : "Outside check: still not answering";
    const ok = await send(env, title, `${parts.join(". ")}. Seen from Cloudflare, outside Railway. Railway's dashboard shows whether the service is up.`, { priority: first.length ? 5 : 4, tags: ["rotating_light"] });
    if (ok) for (const d of down) { if (d.first) d.was.alerted = now; else d.was.reminded = now; }
  }
  if (back.length) {
    await send(env, `Outside check: ${joinAnd(back.map((b) => b.tg.name))} answering again`,
      back.map((b) => `${b.tg.name} is back after about ${plural(mins(b.since, now), "minute")}`).join("; ") + ".", { priority: 3, tags: ["white_check_mark"] });
  }
  if (news.length) await send(env, "Outside check: " + (news.some((n) => / is on /.test(n)) ? "a new version is live" : "a restart"), news.join(". ") + ".", { priority: 3, tags: ["package"] });

  // the morning line, once a day at the hour
  const hour = opt(env, "SUMMARY_HOUR_UTC"), today = new Date(now).toISOString().slice(0, 10);
  if (hour !== "off" && new Date(now).getUTCHours() === Number(hour) && st.summary_date !== today) {
    const d = st.day, lines = [];
    const downNow = list.filter((tg) => !st.targets[tg.key].up).map((tg) => tg.name);
    if (d.outages.length) lines.push(`${plural(d.outages.length, "outage")}: ${d.outages.map((o) => `${name[o.key] || o.key} ${plural(mins(o.from, o.to), "minute")} from ${hhmm(o.from)}`).join(", ")}`);
    if (downNow.length) lines.push(`not answering now: ${joinAnd(downNow)}`);
    const shorts = Object.entries(d.short).filter(([, n]) => n > 0);
    if (shorts.length) lines.push(`short misses that answered on the retry: ${shorts.map(([k, n]) => `${name[k] || k} ${n}`).join(", ")}`);
    if (d.deploys.length) lines.push(`new versions: ${d.deploys.map((x) => `${name[x.key] || x.key} ${x.v} at ${hhmm(x.at)}`).join(", ")}`);
    if (d.restarts.length) lines.push(`restarts without a new version: ${d.restarts.map((x) => `${name[x.key] || x.key} at ${hhmm(x.at)}`).join(", ")}`);
    const on = list.filter((tg) => tg.versioned && st.targets[tg.key].v).map((tg) => `${tg.name} on ${st.targets[tg.key].v}`);
    const quiet = !d.outages.length && !downNow.length;
    const ok = await send(env, quiet ? "Outside check: all good" : "Outside check: the last day",
      `The last ${plural(Math.max(1, Math.round((now - d.from) / 3600000)), "hour")}: ${lines.length ? lines.join(". ") : "every check answered, nothing restarted"}.${on.length ? ` Now: ${on.join(", ")}.` : ""}`,
      { priority: quiet ? 2 : 3, tags: [quiet ? "white_check_mark" : "warning"] });
    if (ok) { st.summary_date = today; st.day = freshDay(now); }
  }

  if (JSON.stringify(st) !== JSON.stringify(before)) await env.STATE.put("state", JSON.stringify(st));
}

export default {
  async scheduled(controller, env, ctx) { ctx.waitUntil(run(env, controller && controller.scheduledTime ? Number(controller.scheduledTime) : Date.now())); },
  // nothing to see at the Worker's own address
  async fetch() { return new Response("Not found", { status: 404 }); },
};
