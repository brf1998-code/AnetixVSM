// Safeguards: what Anetix switches for a company that keeps government contract information here (2026-10-08).
//
// Why. Brendan, 2026-10-08: "offering to some of the defense base". A defense supplier answers for fifteen basic
// safeguards (CMMC Level 1, FAR 52.204-21) on every system its contract information touches, and this product is one
// of them once the plant's tools hold that information. The gap audit of the same day found four places where the
// product could not yet give the plant a plain yes. Each is a switch here, per company, set by Anetix on the company's
// card on /admin (More, Safeguards), on the record, and off or open by default so no other company changes:
//
//   talk               the mic button under a text box (public/assets/dictate.js). The browser turns speech into words
//                      by sending the audio to Google (Chrome, Edge) or Apple (Safari). Off: no button, the page asks
//                      before it ever starts listening, and the browser is told the microphone is not for these pages.
//   label_preview      a label's picture, drawn by a public renderer the platform sends the label's contents to
//                      (src/connections.js previewPng). Off: nothing is sent; the tool shows the label's text, as it
//                      already does when the renderer cannot be reached.
//   require_scan       uploads must be scanned for malware (src/scan.js). Off: a file the scanner could not take is
//                      kept and scanned later. On: it is refused.
//   networks           the addresses the SHARED sign-ins work from (the floor's password, and a shared manager password
//                      while one exists). Empty: anywhere. Set: a device has to be on the plant's own network, at
//                      sign-in and on every request after (a phone that leaves the wifi is refused until it is back,
//                      and is not signed out). A named account (an admin, a manager with a code or a passkey) works from
//                      anywhere: its second factor is what stands in for the network.
//
// And one action beside them: take away a company's shared manager password, so a manager signs in by name with a
// second factor and no other way (auth.dropManagerPassword; only once the company has a manager account that works).
//
// What these are not. They narrow where a plant's information goes and who reaches it; they do not make the product a
// place for CUI (the Terms, 7.4, keep that out), and the network list is not a second factor: a guest on the plant's
// wifi shares its address. docs/SAFEGUARDS.md says what each answers for and what stays the plant's.
//
// Routes (admin):
//   GET  /api/admin/companies/:slug/safeguards                         the switches, the address this request came from
//   POST /api/admin/companies/:slug/safeguards  { talk?, label_preview?, require_scan?, networks? }
//   POST /api/admin/companies/:slug/safeguards/drop-manager-password
//   GET  /api/admin/scan                                               the scanner, and how the stored files stand
//   POST /api/admin/scan/sweep                                         run the look-behind now
const net = require("net");
const express = require("express");
const { q, logEvent } = require("./db");
const edge = require("./edge");

const SCHEMA = `
ALTER TABLE platform.companies ADD COLUMN IF NOT EXISTS allow_talk BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE platform.companies ADD COLUMN IF NOT EXISTS allow_label_preview BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE platform.companies ADD COLUMN IF NOT EXISTS require_scan BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE platform.companies ADD COLUMN IF NOT EXISTS allow_assistant BOOLEAN NOT NULL DEFAULT true;   -- Ask Anetix on the board (src/assist.js)
ALTER TABLE platform.company_access ADD COLUMN IF NOT EXISTS networks TEXT[];
`;
async function init() { await q(SCHEMA); }

// ---- the network list (pure) ----------------------------------------------------------------------------------------
const MAX_NETWORKS = 20;
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
// One entry as typed: an address, or an address and a prefix length. -> "203.0.113.7/32", lower case. Throws with words.
function cleanNetwork(entry) {
  const s = String(entry || "").trim().toLowerCase();
  const [addr, bits, more] = s.split("/");
  const fam = net.isIP(addr);
  if (!fam || more !== undefined) throw bad(`"${String(entry).trim().slice(0, 60)}" is not an address: write it like 203.0.113.7, or a range like 203.0.113.0/24`);
  const max = fam === 4 ? 32 : 128, min = fam === 4 ? 8 : 16;
  if (bits === undefined) return `${addr}/${max}`;
  if (!/^\d{1,3}$/.test(bits) || Number(bits) > max) throw bad(`"${s.slice(0, 60)}" has a range size that is not one: after the slash goes a number up to ${max}`);
  if (Number(bits) < min) throw bad(`"${s.slice(0, 60)}" is too wide to mean one plant's network (the smallest number after the slash is ${min}). To let the sign-in work from anywhere, clear the list.`);
  return `${addr}/${Number(bits)}`;
}
// A list as typed (lines, commas or spaces) or as an array. -> the cleaned list, no repeats.
function cleanNetworks(input) {
  const parts = (Array.isArray(input) ? input : String(input == null ? "" : input).split(/[\s,;]+/)).map((x) => String(x || "").trim()).filter(Boolean);
  if (parts.length > MAX_NETWORKS) throw bad(`that is ${parts.length} entries; ${MAX_NETWORKS} is the most. A range (203.0.113.0/24) covers many addresses in one line.`);
  return [...new Set(parts.map(cleanNetwork))];
}
function blockList(list) {
  const b = new net.BlockList();
  for (const n of list || []) { const [addr, bits] = n.split("/"); b.addSubnet(addr, Number(bits), net.isIPv6(addr) ? "ipv6" : "ipv4"); }
  return b;
}
const bare = (ip) => String(ip || "").trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, "");
function inNetworks(list, ip) {
  const a = bare(ip), fam = net.isIP(a);
  if (!fam || !list || !list.length) return false;
  return blockList(list).check(a, fam === 6 ? "ipv6" : "ipv4");
}
// What "the network I am on" means for an address: the one IPv4 address a plant's router shows the world, or the /64
// an IPv6 device's rotating address sits in. null for something that is not an address.
function networkOf(ip) {
  const a = bare(ip), fam = net.isIP(a);
  if (fam === 4) return `${a}/32`;
  if (fam !== 6) return null;
  // the first four groups of the address, written out in full
  const [head, tail = ""] = a.split("::");
  const h = head ? head.split(":") : [], t = tail ? tail.split(":") : [];
  const groups = a.includes("::") ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : h;
  return groups.length === 8 ? `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64` : null;
}

// ---- a company's switches -------------------------------------------------------------------------------------------
const cache = new Map();   // company -> { at, v }
const TTL = 10000;
// A read that began before a change was saved must not be remembered after it (found by the browser suite, 2026-10-08:
// a page loaded in the same instant as the switch kept the old answer for ten seconds). Every change moves the
// count; a read remembers its answer only if the count has not moved since it asked.
let changes = 0;
const DEFAULTS = Object.freeze({ talk: true, label_preview: true, require_scan: false, assistant: true, networks: [] });
async function get(company) {
  if (!company) return DEFAULTS;
  const c = cache.get(company);
  if (c && Date.now() - c.at < TTL) return c.v;
  const asked = changes;
  const r = (await q(`SELECT c.allow_talk, c.allow_label_preview, c.require_scan, c.allow_assistant, a.networks
                        FROM platform.companies c LEFT JOIN platform.company_access a ON a.company=c.slug WHERE c.slug=$1`, [company])).rows[0];
  const v = r ? { talk: r.allow_talk !== false, label_preview: r.allow_label_preview !== false, require_scan: r.require_scan === true, assistant: r.allow_assistant !== false, networks: r.networks || [] } : DEFAULTS;
  if (asked === changes) cache.set(company, { at: Date.now(), v });
  return v;
}
const mustScan = async (company) => (await get(company)).require_scan;
// who: { role, name } from the request. patch: any of talk, label_preview, require_scan (booleans) and networks.
async function set(company, patch, who) {
  const co = (await q("SELECT slug FROM platform.companies WHERE slug=$1", [company])).rows[0];
  if (!co) throw Object.assign(new Error("unknown company"), { status: 404 });
  cache.delete(company);
  const was = await get(company), now = { ...was };
  for (const k of ["talk", "label_preview", "require_scan", "assistant"]) if (patch[k] !== undefined) now[k] = Boolean(patch[k]);
  if (patch.networks !== undefined) now.networks = cleanNetworks(patch.networks);
  // the list first: it is the one part that can be refused, and nothing else is saved when it is
  if (patch.networks !== undefined) {
    if (now.networks.length && !mayHoldToNetwork()) throw Object.assign(new Error("the edge check is not enforced on this instance (the Instance tab), so the address a request claims is not proven and a list would hold nobody out. Enforce the edge check first."), { status: 409 });
    // it sits on the company's sign-in row, beside the passwords it narrows; a company with no such row has no shared sign-in to narrow
    const up = await q("UPDATE platform.company_access SET networks=$2 WHERE company=$1", [company, now.networks.length ? now.networks : null]);
    if (!up.rowCount && now.networks.length) throw Object.assign(new Error("this company has no sign-in of its own yet: set its passwords first"), { status: 409 });
  }
  await q("UPDATE platform.companies SET allow_talk=$2, allow_label_preview=$3, require_scan=$4, allow_assistant=$5 WHERE slug=$1", [company, now.talk, now.label_preview, now.require_scan, now.assistant]);
  changes++; cache.delete(company);
  const changed = Object.keys(now).filter((k) => JSON.stringify(now[k]) !== JSON.stringify(was[k]));
  if (changed.length) {
    await logEvent("safeguards_changed", company, { changed, now, by: who && who.name });
    await require("./record").record("safeguards_changed", { company, actor: who, before: JSON.stringify(was), after: JSON.stringify(now), detail: { changed } });
  }
  return now;
}

// ---- the plant's network: the shared sign-ins work only from it -------------------------------------------------------
// The list is only as good as the address a request is believed to come from (edge.clientIp), and that address is
// proven only while the edge check is ENFORCED (src/edge.js: every request then came through Cloudflare, which sets
// the visitor's address itself). With the check off or in report mode the address is whatever the sender typed. So
// on a hosted instance a list is not accepted unless the check is enforced, the card says so, and boot says so if a
// list is standing while it is not. Local work and the tests have no edge in front and may set one.
const HOSTED = () => Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_SERVICE_ID || process.env.NODE_ENV === "production");
const addressProven = () => edge.mode() === "enforce";
// Pure but for the two readings: may a list be set here, now?
const mayHoldToNetwork = (hosted = HOSTED(), proven = addressProven()) => !hosted || proven;
async function bootCheck() {
  if (addressProven()) return;
  const held = (await q("SELECT company FROM platform.company_access WHERE networks IS NOT NULL AND array_length(networks, 1) > 0")).rows.map((r) => r.company);
  if (held.length) console.error(`[safeguards] ${held.join(", ")}: shared sign-ins are held to a network list, but the edge check is ${edge.mode() === "report" ? "in report mode" : "off"}, so the address a request claims is not proven. Enforce the edge check (SOS_EDGE_SECRET, no SOS_EDGE_MODE).`);
}
const OFF_NETWORK = "This sign-in works only on the company's own network. Join the plant's wifi and try again. A manager with an account of their own can sign in from anywhere.";
// The platform's own calls to itself (the checks and the page load of a staged build, src/pipeline.js) arrive over
// loopback as that company's manager and carry no forwarded address; nothing from outside can look like that.
const ownCall = (req) => edge.isLoopback(req.socket && req.socket.remoteAddress) && !req.headers["x-real-ip"] && !req.headers["cf-connecting-ip"];
// Is this request outside the company's list? false when the company has no list.
async function offNetwork(req, company) {
  const list = (await get(company)).networks;
  if (!list.length || ownCall(req)) return false;
  return !inNetworks(list, edge.clientIp(req));
}
const refusalPage = () => `<!DOCTYPE html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Not on the plant's network</title>
<body style="font-family:system-ui,sans-serif;background:#f2f4f7;color:#1c242e;margin:0;padding:24px"><div style="max-width:440px;margin:8vh auto;background:#fff;border:1px solid #d9dee5;border-radius:10px;padding:22px">
<h1 style="font-size:20px;margin:0 0 10px">This device is not on the plant's network</h1>
<p style="font-size:16px;line-height:1.5;margin:0 0 14px">The sign-in on this device works only on the company's own network. Join the plant's wifi, then try again. You are still signed in.</p>
<p style="margin:0 0 10px"><a href="" style="display:inline-block;background:#1f3a5f;color:#fff;text-decoration:none;border-radius:8px;padding:11px 16px;font-size:16px">Try again</a></p>
<p style="font-size:14px;color:#5b6675;margin:0">A manager with an account of their own can <a href="/login?staff=1" style="color:#1f3a5f">sign in from anywhere</a>.</p></div></body></html>`;
// After auth.middleware. Only a shared-password session is held to the list: an admin, a named manager account and
// the platform's own calls pass.
function networkGate(req, res, next) {
  if (!req.sosRole || req.sosRole === "admin" || req.sosAccount || req.sosInternal) return next();
  offNetwork(req, req.sosCompany).then((off) => {
    if (!off) return next();
    const p = req.path;
    res.set("Cache-Control", "no-store");
    if (req.method === "GET" && !p.startsWith("/api/") && !/\/api\//.test(p)) return res.status(403).type("html").send(refusalPage());
    res.status(403).json({ error: OFF_NETWORK, off_network: true });
  }).catch(next);
}

// ---- the microphone: pages of a company with talk off say so to the browser ---------------------------------------------
// Chrome and Edge take the microphone away from a page whose policy says so; Safari does not read this header, which
// is why dictate.js also asks /who before it listens. Every answer under /c/<slug>/ carries it (a module's own pages
// included: registry.lockDown does not take it away). With talking ON the header is sent too, saying what a browser
// assumes anyway (this site only): a page a browser already holds is asked about again with "not changed" as the
// answer, and a header that is simply missing from that answer leaves the old one standing, so a company switched
// back on would have stayed without its microphone on every device that had the page (found by the browser suite).
const MIC_OFF = "microphone=()", MIC_ON = "microphone=(self)";
function pageHeaders(req, res, next) {
  const m = /^\/c\/([a-z0-9][a-z0-9-]{1,40})(?:\/|$)/i.exec(req.path);
  if (!m || req.method !== "GET") return next();
  get(m[1].toLowerCase()).then((s) => { res.setHeader("Permissions-Policy", s.talk ? MIC_ON : MIC_OFF); next(); }).catch(() => next());
}

// ---- routes -------------------------------------------------------------------------------------------------------
const router = express.Router();
const requireAdmin = (req, res, next) => (req.sosRole === "admin" ? next() : res.status(403).json({ error: "admin login required" }));
const json = express.json({ limit: "32kb" });
const actorOf = (req) => ({ role: req.sosRole || null, name: (req.sosAccount && (req.sosAccount.name || req.sosAccount.login)) || req.sosPerson || null });
async function view(req, slug) {
  const s = await get(slug);
  const auth = require("./auth");
  const row = await auth.accessRow(slug);
  const managers = (await require("./selfserve").managers(slug)).filter((m) => m.status === "active" && m.enrolled).length;
  const ip = edge.clientIp(req);
  const sc = await require("./scan").health().catch(() => ({ configured: false, reachable: false }));
  return { ...s, your_address: ip, your_network: networkOf(ip), your_address_listed: inNetworks(s.networks, ip), address_proven: addressProven(), may_hold_to_network: mayHoldToNetwork(),
    shared_manager_password: Boolean(row && row.manager_hash), shared_floor_password: Boolean(row && row.floor_hash), legacy_login: Boolean(row && row.legacy_login), manager_accounts: managers,
    scanner: { configured: Boolean(sc.configured), reachable: Boolean(sc.reachable) } };
}
router.get("/api/admin/companies/:slug/safeguards", requireAdmin, async (req, res) => {
  const co = (await q("SELECT slug FROM platform.companies WHERE slug=$1", [req.params.slug])).rows[0];
  if (!co) return res.status(404).json({ error: "unknown company" });
  res.set("Cache-Control", "no-store").json(await view(req, co.slug));
});
router.post("/api/admin/companies/:slug/safeguards", requireAdmin, json, async (req, res) => {
  const b = req.body || {};
  await set(req.params.slug, { talk: b.talk, label_preview: b.label_preview, require_scan: b.require_scan, assistant: b.assistant, networks: b.networks }, actorOf(req));
  res.json({ ok: true, ...(await view(req, req.params.slug)) });
});
// A manager signs in by name with a second factor and no other way. Refused until the company has a manager account
// that works, or nobody at the company could approve anything.
router.post("/api/admin/companies/:slug/safeguards/drop-manager-password", requireAdmin, json, async (req, res) => {
  if (!(await q("SELECT 1 FROM platform.companies WHERE slug=$1", [req.params.slug])).rows[0]) return res.status(404).json({ error: "unknown company" });
  const v = await view(req, req.params.slug);
  if (v.legacy_login) return res.status(409).json({ error: "this company is still on the old shared passwords: give it its own floor password first (Set passwords)" });
  if (!v.shared_manager_password) return res.json({ ok: true, already: true, ...v });
  if (!v.manager_accounts) return res.status(409).json({ error: "no manager at this company has an account with a second factor set up yet. Add a manager first (Settings, Managers), and take the shared password away once they have signed in." });
  await require("./auth").dropManagerPassword(req.params.slug);
  await logEvent("manager_password_dropped", req.params.slug, { by: actorOf(req).name });
  await require("./record").record("manager_password_dropped", { company: req.params.slug, actor: actorOf(req), after: "the shared manager password was taken away: a manager signs in with an account of their own" });
  res.json({ ok: true, ...(await view(req, req.params.slug)) });
});
router.get("/api/admin/scan", requireAdmin, async (_req, res) => { res.set("Cache-Control", "no-store").json(await require("./scan").status()); });
router.post("/api/admin/scan/sweep", requireAdmin, json, async (_req, res) => { res.json({ ok: true, sweep: await require("./scan").sweep(), ...(await require("./scan").status()) }); });

module.exports = { init, SCHEMA, router, get, set, mustScan, mayHoldToNetwork, addressProven, bootCheck, cleanNetwork, cleanNetworks, inNetworks, networkOf, offNetwork, networkGate, pageHeaders, OFF_NETWORK, DEFAULTS, MAX_NETWORKS, _forget: (c) => { changes++; return c ? cache.delete(c) : cache.clear(); } };
