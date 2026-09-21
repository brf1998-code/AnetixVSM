// Unit cases for src/edge.js: where a request really came from. No database, no network.
//   node scripts/test-edge.js
const path = require("path");
let pass = 0, fail = 0;
function t(name, cond, detail) { if (cond) { pass++; } else { fail++; console.log(`FAIL  ${name}${detail ? "\n      " + detail : ""}`); } }
// the module reads the environment when it is asked, apart from the range list; load it fresh per setting
function load(env) {
  for (const k of ["SOS_EDGE_SECRET", "SOS_EDGE_MODE", "SOS_CF_RANGES"]) delete process.env[k];
  Object.assign(process.env, env || {});
  delete require.cache[path.resolve(__dirname, "../src/edge.js")];
  return require("../src/edge");
}
const req = (headers, remote = "10.0.0.9", p = "/login", ip) => ({ headers: headers || {}, socket: { remoteAddress: remote }, path: p, method: "GET", ip });
function run(edge, r) {
  const out = { next: false, status: null, body: null };
  const res = { status(s) { out.status = s; return res; }, type() { return res; }, send(b) { out.body = b; return res; } };
  edge.gate(r, res, () => { out.next = true; });
  return out;
}
const quiet = (fn) => { const w = console.warn; console.warn = () => {}; try { return fn(); } finally { console.warn = w; } };
const CF = "104.16.5.5", CF6 = "2606:4700::6810:505", NOT_CF = "203.0.113.7";

// ---- Cloudflare's ranges
let edge = load();
t("Cloudflare's v4 and v6 addresses are recognized", edge.isCloudflare(CF) && edge.isCloudflare("172.64.0.1") && edge.isCloudflare("162.159.255.255") && edge.isCloudflare(CF6) && edge.isCloudflare("2a06:98c7::1"));
t("others are not", !edge.isCloudflare(NOT_CF) && !edge.isCloudflare("104.32.0.1") && !edge.isCloudflare("172.72.0.1") && !edge.isCloudflare("2a06:98c8::1") && !edge.isCloudflare("::1"));
t("a v4 address written as v6 is read as v4", edge.isCloudflare(`::ffff:${CF}`) && !edge.isCloudflare(`::ffff:${NOT_CF}`));
t("junk is not an address, not a crash", [null, undefined, "", "cloudflare", "104.16.5", "104.16.5.5.5", "1e3", {}].every((x) => edge.isCloudflare(x) === false));
t("the list is Cloudflare's 15 v4 and 7 v6 ranges", edge.CLOUDFLARE.filter((r) => r.includes(".")).length === 15 && edge.CLOUDFLARE.filter((r) => r.includes(":")).length === 7);

// ---- the client address
t("through Cloudflare (the hop is theirs): CF-Connecting-IP is believed", edge.clientIp(req({ "x-real-ip": CF, "cf-connecting-ip": "198.51.100.4" })) === "198.51.100.4");
t("round the side (the hop is not theirs): a forged CF-Connecting-IP is ignored, the hop is the client", edge.clientIp(req({ "x-real-ip": NOT_CF, "cf-connecting-ip": "1.2.3.4" })) === NOT_CF);
t("a forged X-Forwarded-For is never read", edge.clientIp(req({ "x-real-ip": NOT_CF, "x-forwarded-for": "9.9.9.9" }, "10.0.0.9", "/login", "9.9.9.9")) === NOT_CF);
t("the platform calling itself is loopback, whatever headers it sends", edge.clientIp(req({ "cf-connecting-ip": "1.2.3.4" }, "127.0.0.1")) === "127.0.0.1" && edge.clientIp(req({}, "::ffff:127.0.0.1")) === "127.0.0.1" && edge.clientIp(req({}, "::1")) === "::1");
t("no Railway edge in front (no X-Real-IP): as before, Cloudflare's header, then the framework's address", edge.clientIp(req({ "cf-connecting-ip": "198.51.100.4" })) === "198.51.100.4" && edge.clientIp(req({}, "10.0.0.9", "/login", "10.1.1.1")) === "10.1.1.1");
t("a request proven to come through Cloudflare is believed even if the hop's address is unknown", edge.clientIp({ ...req({ "x-real-ip": NOT_CF, "cf-connecting-ip": "198.51.100.4" }), sosViaEdge: true }) === "198.51.100.4");
t("nothing to go on is 'unknown', not a crash", edge.clientIp({ headers: {} }) === "unknown");

// ---- the gate
t("no secret set: no check at all (local dev)", edge.mode() === "off" && run(edge, req({})).next === true);
edge = load({ SOS_EDGE_SECRET: "s3cret-edge-value" });
t("secret set: enforced", edge.mode() === "enforce");
const good = req({ "x-sos-edge": "s3cret-edge-value" });
t("a request carrying the secret passes, and is marked as through the edge", run(edge, good).next === true && good.sosViaEdge === true);
const bad = quiet(() => run(edge, req({ "cf-connecting-ip": "1.2.3.4" })));
t("a request without it is refused with 403 and goes no further", bad.next === false && bad.status === 403);
t("a wrong secret, a prefix of it, and an empty one are refused", quiet(() => ["wrong", "s3cret-edge-valu", "s3cret-edge-value ", "", "S3CRET-EDGE-VALUE"].every((x) => run(edge, req({ "x-sos-edge": x })).status === 403)));
t("/health passes without it (Railway's own health check comes from inside)", run(edge, req({}, "10.0.0.9", "/health")).next === true);
t("but only /health exactly", quiet(() => run(edge, req({}, "10.0.0.9", "/health/x")).status === 403 && run(edge, req({}, "10.0.0.9", "/healthz")).status === 403));
t("the platform's own calls over loopback pass without it", run(edge, req({}, "127.0.0.1", "/c/demo/staging/m/paperline/")).next === true && run(edge, req({}, "::1")).next === true);
t("a request that only CLAIMS loopback in a header does not", quiet(() => run(edge, req({ "x-real-ip": "127.0.0.1", "x-forwarded-for": "127.0.0.1" }, "10.0.0.9", "/login", "127.0.0.1")).status === 403));
const st = edge.status(good);
t("the admin page is told what is happening", st.mode === "enforce" && st.this_request_carried_it === true && st.with_secret >= 1 && st.refused >= 1 && st.last_without && st.last_without.path === "/login", JSON.stringify(st));
t("the secret itself is never in what the admin page is told", !JSON.stringify(st).includes("s3cret"));
edge = load({ SOS_EDGE_SECRET: "s3cret-edge-value", SOS_EDGE_MODE: "report" });
const rep = quiet(() => run(edge, req({})));
t("report mode refuses nothing and counts", edge.mode() === "report" && rep.next === true && edge.status(req({})).without_secret === 1 && edge.status(req({})).refused === 0);
edge = load({ SOS_CF_RANGES: "203.0.113.0/24, 2001:db8::/32" });
t("SOS_CF_RANGES replaces the list", edge.isCloudflare(NOT_CF) && edge.isCloudflare("2001:db8::1") && !edge.isCloudflare(CF));
load();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
