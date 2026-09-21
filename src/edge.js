// Where a request really came from (2026-09-21).
//
// Cloudflare fronts the instance and the app keys its login throttle on
// CF-Connecting-IP. That header is only worth anything if a request cannot
// reach the app any other way, and it could: Railway's edge routes by host
// name, so a request sent straight to the Railway edge with
// "Host: sos.finnoperations.com" skipped Cloudflare and could carry any
// CF-Connecting-IP it liked, a new one per try. Two checks, and one helper
// that everything reads the client address through:
//
// 1. The edge secret. A Cloudflare request-header Transform Rule adds
//    "X-SOS-Edge: <random>" to every request it proxies; SOS_EDGE_SECRET holds
//    the same value here. With it set, anything that arrives without it is
//    refused (403), apart from /health (Railway's own health check comes from
//    inside) and the platform's calls to itself over loopback (the acceptance
//    checks and the page load, src/pipeline.js). SOS_EDGE_MODE=report refuses
//    nothing and only counts and logs, which is how to find out the rule works
//    BEFORE it can lock every plant out: set the secret with report, look at
//    /admin, then take report away. Unset secret: no check at all (local dev).
// 2. The hop. Railway's edge sets X-Real-IP to whoever connected to it. When
//    that address is one of Cloudflare's, CF-Connecting-IP is believed;
//    otherwise the request came round the side and X-Real-IP itself is the
//    client. This is the second line: it matters in report mode and for
//    /health, and it is only as good as Railway overwriting a forged
//    X-Real-IP, which is why the secret is the gate and this is not.
//
// No dependency: net.BlockList takes CIDR ranges for v4 and v6.
const net = require("net");
const crypto = require("crypto");

// https://www.cloudflare.com/ips/ (checked 2026-09-21). SOS_CF_RANGES, comma separated, replaces the list if it moves.
const CLOUDFLARE = [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18", "108.162.192.0/18",
  "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
  "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
  "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32",
];
function blockList(ranges) {
  const list = new net.BlockList();
  for (const r of ranges) {
    const [addr, bits] = String(r).trim().split("/");
    const family = net.isIPv6(addr) ? "ipv6" : net.isIPv4(addr) ? "ipv4" : null;
    if (!family || !bits) continue;
    list.addSubnet(addr, Number(bits), family);
  }
  return list;
}
const cfList = blockList(process.env.SOS_CF_RANGES ? process.env.SOS_CF_RANGES.split(",") : CLOUDFLARE);
// "::ffff:1.2.3.4" is 1.2.3.4
const bare = (ip) => String(ip || "").trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, "");
function isCloudflare(ip) {
  const a = bare(ip);
  return net.isIPv4(a) ? cfList.check(a, "ipv4") : net.isIPv6(a) ? cfList.check(a, "ipv6") : false;
}
function isLoopback(ip) { const a = bare(ip); return a === "127.0.0.1" || a === "::1"; }

const secret = () => process.env.SOS_EDGE_SECRET || "";
const mode = () => (!secret() ? "off" : String(process.env.SOS_EDGE_MODE || "").toLowerCase() === "report" ? "report" : "enforce");
function carriesSecret(req) {
  const want = Buffer.from(secret()), got = Buffer.from(String(req.headers["x-sos-edge"] || ""));
  return want.length > 0 && got.length === want.length && crypto.timingSafeEqual(got, want);
}

// The one place the client's address is read. Everything that throttles, locks or logs by address calls this.
function clientIp(req) {
  const h = req.headers || {}, socket = bare(req.socket && req.socket.remoteAddress);
  const cf = bare(h["cf-connecting-ip"]), real = bare(h["x-real-ip"]);
  if (req.sosViaEdge) return cf || real || socket || "unknown";       // proven to have come through Cloudflare
  if (real) return isCloudflare(real) && cf ? cf : real;                // Railway's edge says who connected to it
  if (isLoopback(socket)) return socket;                                // the platform calling itself
  return cf || bare(req.ip) || socket || "unknown";                     // nothing better to go on (no Railway edge in front): as before
}

// What /admin shows, so the rule can be checked before it is enforced.
const seen = { since: new Date().toISOString(), with_secret: 0, without_secret: 0, refused: 0, last_without: null };
function status(req) {
  return {
    mode: mode(), this_request_carried_it: Boolean(req && req.sosViaEdge), this_request_hop_is_cloudflare: Boolean(req && isCloudflare(req.headers["x-real-ip"])),
    x_real_ip_seen: Boolean(req && req.headers["x-real-ip"]), client_ip: req ? clientIp(req) : null, ...seen,
  };
}

function gate(req, res, next) {
  const m = mode();
  if (m === "off") return next();
  if (carriesSecret(req)) { req.sosViaEdge = true; seen.with_secret++; return next(); }
  if (req.path === "/health" || isLoopback(req.socket && req.socket.remoteAddress)) return next();
  // it did not come through Cloudflare, so Cloudflare's header on it is whatever the sender typed: name the hop instead
  const hop = bare(req.headers["x-real-ip"]) || bare(req.socket && req.socket.remoteAddress) || "unknown";
  seen.without_secret++;
  seen.last_without = { at: new Date().toISOString(), ip: hop, path: req.path.slice(0, 80) };
  if (m === "report") { if (seen.without_secret <= 20 || seen.without_secret % 100 === 0) console.warn(`[edge] report only: ${req.method} ${req.path.slice(0, 80)} from ${hop} arrived without the edge header`); return next(); }
  seen.refused++;
  if (seen.refused <= 20 || seen.refused % 100 === 0) console.warn(`[edge] refused ${req.method} ${req.path.slice(0, 80)} from ${hop}: it did not come through Cloudflare`);
  res.status(403).type("text/plain").send("Forbidden");
}

module.exports = { gate, clientIp, isCloudflare, isLoopback, status, mode, CLOUDFLARE };
