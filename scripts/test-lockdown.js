// Unit tests for the module mount's response lock (src/registry.js lockDown and locationOk, 2026-09-27): a module's answer
// cannot drop the page policy, and cannot send the browser out of its own mount with a redirect, which a fetch would
// follow with the manager's cookie. No database.   node scripts/test-lockdown.js
const R = require("../src/registry");
let pass = 0, fail = 0;
const t = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log(`FAIL  ${name}${detail !== undefined ? "\n      " + JSON.stringify(detail) : ""}`); } };
function fakeRes() {
  const h = {}; let status = null;
  return { h, get status() { return status; }, setHeader(k, v) { h[k.toLowerCase()] = v; return this; }, removeHeader(k) { delete h[k.toLowerCase()]; }, writeHead(s, o) { status = s; for (const [k, v] of Object.entries(o || {})) h[k.toLowerCase()] = v; return this; } };
}
const req = { params: { company: "acme", module: "scrap" }, originalUrl: "/c/acme/m/scrap/api/list", headers: { host: "app.anetix.test" }, protocol: "https" };
const res = fakeRes(); R.lockDown(req, res);
t("the page policy is set", Boolean(res.h["content-security-policy"] || res.h["content-security-policy-report-only"]));
res.setHeader("Location", "/api/c/acme/billing");
t("a redirect to the manager's own routes is dropped (setHeader, as res.redirect does)", !("location" in res.h));
res.writeHead(307, { Location: "/api/c/acme/export", "Content-Type": "text/plain" });
t("and in writeHead, the rest of the headers kept", !("location" in res.h) && res.h["content-type"] === "text/plain" && res.status === 307);
res.setHeader("Location", "https://evil.test/x"); res.setHeader("location", "//evil.test/x");
t("off the platform: dropped", !("location" in res.h));
res.setHeader("Refresh", "0; url=/api/c/acme/billing");
t("a Refresh header never goes through", !("refresh" in res.h));
res.setHeader("Content-Security-Policy", "default-src *");
t("the policy cannot be widened", res.h["content-security-policy"] !== "default-src *");
const r2 = fakeRes(); R.lockDown(req, r2);
r2.setHeader("Location", "./list?page=2");
t("a redirect inside the module's own mount goes through", r2.h.location === "./list?page=2");
r2.setHeader("Location", "/c/acme/staging/m/scrap/");
t("to its own preview too", r2.h.location === "/c/acme/staging/m/scrap/");
t("not to another module of the same company", !R.locationOk(req, "/c/acme/m/kpis/") && !R.locationOk(req, "/c/acme/m/scrapper/"));
t("not by climbing out", !R.locationOk(req, "/c/acme/m/scrap/../../../api/c/acme/billing") && !R.locationOk(req, "../../settings"));
t("not to another company's copy", !R.locationOk(req, "/c/other/m/scrap/"));
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
