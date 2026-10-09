// Alerts to Anetix's own phones (the launch audit, C11, 2026-09-27). What sends one (1.15 and before):
//   a product error or a stray exception (src/errors.js), AI spend climbing fast (src/spendwatch.js), a cap reached
//   (src/agent.js), a signed order and a card declined at Activate (src/golive.js, src/activate.js), billing
//   (src/billing.js), a demo request and a new demo (src/demorequests.js, src/selfserve.js), refused pins
//   (src/selfserve.js), an account locked (src/accounts.js), a demo's build stopped before a preview
//   (src/demostops.js), the AI service refusing or any AI call failing (src/credit.js, reported from src/agent.js and the callers), a request to Anetix (src/feedback.js), a tool process
//   restarted after it kept timing out (src/runner.js), anetix.ai not answering (src/uptime.js). anetix.ai sends its
//   own for a Stripe event it could not apply and for this product not answering (www/notify.js, www/uptime.js). Brendan chose push
// through ntfy: the free ntfy app on his and Taylor's phones, both subscribed to one private topic. Nothing here reaches a
// customer.
//
//   NTFY_TOPIC   the topic both phones subscribe to. A long random name is the only secret: anyone who knows it can read
//                the alerts, so it lives in Railway only. Unset: nothing is sent (the event log still has every event).
//   NTFY_URL     the server, https://ntfy.sh unless set (a self-hosted ntfy works the same way)
//   NTFY_TOKEN   optional: an access token, for a server that wants one
//
// What an alert may carry: a company's name, a site's name, a band and its price, and what happened. Never an email, a
// password, a card, a person's words or anything else from a company's data: the message passes through ntfy's servers
// (the privacy notice lists ntfy for exactly this).
//
// notify() never throws and never holds up the work that called it: it answers at once and sends behind, with a 5 s
// limit. Each alert is also an event (kind "notified"), so the admin page can show what went out.
//
// Routes (admin): POST /api/admin/notify/test   one test alert, to prove both phones get it
//                 GET  /api/admin/notify        whether it is set up, the last few sent, and the spend watch (src/spendwatch.js)
const express = require("express");
const { logEvent } = require("./db");

const TOPIC = () => String(process.env.NTFY_TOPIC || "").trim();
const SERVER = () => String(process.env.NTFY_URL || "https://ntfy.sh").replace(/\/+$/, "");
const clip = (s, n) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);

// The alert as ntfy's JSON publish takes it. Pure.
function payload(title, message, { priority = 3, tags = [], click } = {}) {
  return { topic: TOPIC(), title: clip(title, 120), message: clip(message, 1000), priority: Math.max(1, Math.min(5, Number(priority) || 3)), tags: [].concat(tags || []).map((t) => clip(t, 30)).filter(Boolean).slice(0, 5), ...(click ? { click: String(click) } : {}) };
}
const sent = [];   // the last few, for the admin page and the tests (in memory)
async function send(body) {
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 5000);
  try {
    const res = await fetch(SERVER() + "/", { method: "POST", signal: ctl.signal, headers: { "Content-Type": "application/json", ...(process.env.NTFY_TOKEN ? { Authorization: `Bearer ${process.env.NTFY_TOKEN}` } : {}) }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`ntfy answered ${res.status}`);
    return true;
  } finally { clearTimeout(timer); }
}
function notify(title, message, opts = {}) {
  const body = payload(title, message, opts);
  const on = Boolean(body.topic);
  sent.unshift({ at: new Date().toISOString(), title: body.title, message: body.message, sent: on }); sent.length = Math.min(sent.length, 20);
  logEvent("notified", opts.ref || null, { title: body.title, message: body.message, sent: on }).catch(() => {});
  if (!on) return Promise.resolve(false);
  return send(body).then(() => true, (e) => { console.error(`[notify] "${body.title}" was not sent: ${e.message}`); return false; });
}
const configured = () => Boolean(TOPIC());
// One kind of alert at most once per gap (per key, in this process); the ones held back are counted into the next.
// For the alerts that can come in bursts (the launch audit 1.15): refused pins, locked accounts, requests to Anetix,
// the AI service refusing.
const lastBy = new Map();
function notifyEvery(key, gapMs, title, message, opts = {}) {
  const now = Date.now(), was = lastBy.get(key);
  if (was && now - was.at < gapMs) { was.held++; return Promise.resolve(false); }
  const held = was ? was.held : 0;
  lastBy.set(key, { at: now, held: 0 });
  if (lastBy.size > 2000) for (const [k, v] of lastBy) if (now - v.at > 24 * 3600e3) lastBy.delete(k);
  return notify(title, held ? `${message} (${held} more like it since the last alert.)` : message, opts);
}

const router = express.Router();
router.post("/api/admin/notify/test", (req, res, next) => require("./auth").requireAdmin(req, res, next), async (req, res) => {
  if (!configured()) return res.status(409).json({ error: "NTFY_TOPIC is not set on this instance, so there is nowhere to send an alert." });
  const ok = await notify("Anetix test alert", `Sent from the admin page${req.sosAccount && req.sosAccount.name ? ` by ${req.sosAccount.name}` : ""}. If both phones buzzed, alerts work.`, { tags: ["white_check_mark"] });
  res.status(ok ? 200 : 502).json(ok ? { ok: true } : { error: "ntfy did not take the alert; the deploy log says why" });
});
router.get("/api/admin/notify", (req, res, next) => require("./auth").requireAdmin(req, res, next), async (_req, res) => res.set("Cache-Control", "no-store").json({ configured: configured(), server: SERVER(), recent: sent.slice(0, 10), spend: await require("./spendwatch").view() }));
// the spend watch now, not in ten minutes (src/spendwatch.js): what it sent
router.post("/api/admin/notify/spend-check", (req, res, next) => require("./auth").requireAdmin(req, res, next), async (_req, res) => res.json({ ok: true, sent: await require("./spendwatch").check() }));

module.exports = { notify, notifyEvery, payload, configured, router, _sent: sent, _reset: () => lastBy.clear() };
