// End to end for the launch audit's 0.1 (src/errors.js, the ids on the routes, auth.companyGuard): a bad address never
// stops the product, and no spelling of an address reaches another company. Against a server ALREADY UP in fake-agent
// mode on a fresh database, started WITHOUT a restart loop, so a crash shows as a dead server (run-all.sh does it):
//   node scripts/e2e/badids.js
// What it does: (1) the 9/26 repro, GET /api/runs/abc as a demo manager; (2) every route in the product that takes a
// parameter, found by walking the routers, called with bad values in each parameter as a manager, the floor and an admin,
// with the server's health and boot id checked after each batch; (3) another company's request reached by capitals, by
// a number spelled another way (0x, 1e, a decimal) and by an id past the column's range, all refused.
const path = require("path");
const { runner, client, login, PW, BASE } = require("./lib");
const R = runner(), t = R.t;

// every route with a parameter, from the routers server.js mounts (walking each router's stack)
function routes() {
  const out = [], seen = new Set();
  const src = path.join(__dirname, "../../src");
  for (const f of require("fs").readdirSync(src).filter((x) => x.endsWith(".js"))) {
    if (/^(runner-child|runner-probe|modulebuild)\.js$/.test(f)) continue;   // a module process's own files, and the module template
    let m; try { m = require(path.join(src, f)); } catch (_) { continue; }
    const cands = [m, ...(m && typeof m === "object" ? Object.values(m) : [])];
    for (const r of cands) {
      if (!r || typeof r !== "function" || !Array.isArray(r.stack)) continue;
      for (const layer of r.stack) {
        if (!layer.route || typeof layer.route.path !== "string" || !layer.route.path.includes(":")) continue;
        for (const method of Object.keys(layer.route.methods)) {
          const key = `${method} ${layer.route.path}`;
          if (seen.has(key)) continue;
          seen.add(key); out.push({ method: method.toUpperCase(), path: layer.route.path, file: f });
        }
      }
    }
  }
  return out;
}
// a route's path with each parameter filled: the one under test gets the bad value, the rest a plausible one
const PARAM = /:(\w+)(\([^)]*\))?/g;
function fill(p, bad, value, company) {
  return p.replace(PARAM, (_m, name) => encodeURIComponentKeepPct(name === bad ? value : name === "slug" || name === "company" ? company : /^(id|tid|aid|n|campaign|seq)$/.test(name) ? "1" : "paperline"));
}
function encodeURIComponentKeepPct(v) { return /%/.test(v) ? v : encodeURIComponent(v); }
const BAD = ["abc", "1.5", "-1", "0x10", "1e3", "99999999999999999999", "%E0%A4%A", "null", "%20"];

async function alive(label) {
  const r = await fetch(BASE + "/health").then((x) => x.json()).catch(() => null);
  return r && r.ok ? r.boot : null;
}

(async () => {
  const boot = await alive();
  t("the server is up", Boolean(boot));
  const admin = await login(PW.admin);
  const mgr = await login(PW.manager, "demo");
  const floor = await login(PW.floor, "demo");

  // ---- (1) the repro from 9/26
  const repro = await mgr.get("/api/runs/abc");
  t("GET /api/runs/abc as a demo manager is a plain 404, not the end of the process", repro.status === 404 && repro.json && repro.json.error === "not found", repro);
  t("and the server is the same process after it", (await alive()) === boot);
  for (const p of ["/api/runs/abc/label", "/api/intakes/abc", "/api/attachments/abc", "/api/feedback/abc/close"]) {
    const r = p.includes("label") || p.includes("close") ? await mgr.post(p, {}) : await mgr.get(p);
    t(`${p} is a 404`, r.status === 404, r.status);
  }
  const big = await mgr.get("/api/runs/99999999999999999999");
  t("an id past the column's range is 404, not a database error", big.status === 404, big);
  const broken = await fetch(BASE + "/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{not json" });
  const bj = await broken.json().catch(() => ({}));
  t("a body that is not JSON is a 400 with plain words", broken.status === 400 && /not valid JSON/.test(bj.error || ""), { status: broken.status, bj });
  const junk = await fetch(BASE + "/api/feedback", { method: "POST", headers: { "Content-Type": "application/json", Cookie: "" }, body: "{" });
  t("a malformed body before sign-in gets an answer too", junk.status >= 400 && junk.status < 500, junk.status);
  t("an /api/ path nothing answers is JSON", (await mgr.get("/api/no/such/thing")).json.error === "not found");

  // ---- (2) every route with a parameter, bad values in each
  const list = routes();
  t("the walk found the product's routes", list.length > 80, list.length);
  const who = { manager: mgr, floor, admin };
  const fives = [];
  let calls = 0;
  for (const r of list) {
    const names = [...r.path.matchAll(PARAM)].map((m) => m[1]);
    for (const bad of names) {
      for (const value of BAD) {
        const p = fill(r.path, bad, value, "demo");
        for (const [role, c] of Object.entries(who)) {
          const res = r.method === "GET" ? await c.get(p) : await (async () => {
            const x = await fetch(BASE + p, { method: r.method, headers: { "Content-Type": "application/json", Cookie: c.cookies().map((k) => `${k.name}=${k.value}`).join("; ") }, body: "{}", redirect: "manual" });
            return { status: x.status, text: await x.text() };
          })();
          calls++;
          if (res.status >= 500) fives.push(`${role} ${r.method} ${p} (${r.file}) -> ${res.status} ${String(res.text || "").slice(0, 120)}`);
        }
      }
    }
    if (!(await alive())) { t(`the server died on ${r.method} ${r.path}`, false); break; }
  }
  const now = await alive();
  t(`${calls} calls with bad values and the server never went down`, now === boot, { boot, now });
  // an id-shaped parameter is digits only now, so none of these reaches a query; a 500 anywhere is a route that still
  // passes an unchecked value through (listed so it can be fixed)
  if (fives.length) console.log(fives.map((x) => "  500: " + x).join("\n"));
  t("no bad value gets a 500 from any route", fives.length === 0, `${fives.length}, listed above`);

  // ---- (3) another company, by every spelling
  const made = await admin.post("/api/admin/companies", { slug: "otherco", name: "Other Co" });
  t("a second company", made.status === 200 && made.json.passwords, made.json);
  const other = await login(made.json.passwords.manager, "otherco");
  const fb = await other.post("/api/feedback", { company: "otherco", module: "platform", message: "Other Co's private words about the press", page: "/c/otherco/" });
  const fid = fb.json && fb.json.id;
  t("the other company files a request", Boolean(fid), fb.json);
  const before = (await admin.get(`/api/c/otherco/feedback/platform?status=all`)).json.find((x) => x.id === fid).recurrence;
  const tries = [
    ["POST", `/API/FEEDBACK/${fid}/plusone`],
    ["POST", `/Api/Feedback/${fid}/plusone`],
    ["POST", `/api/feedback/0x${fid.toString(16)}/plusone`],
    ["POST", `/api/feedback/${fid}.0/plusone`],
    ["POST", `/api/feedback/${fid}e0/plusone`],
    ["POST", `/api/feedback/%20${fid}/plusone`],
    ["POST", `/api/feedback/0${fid}/plusone`],
    ["GET", "/API/C/otherco/export"],
    ["GET", "/Api/c/otherco/board"],
    ["GET", "/api/C/otherco/feedback/platform?status=all"],
    ["GET", "/api/c/OTHERCO/board"],
    ["GET", "/C/otherco/settings"],
    ["GET", "/api/c/%6ftherco/board"],
  ];
  for (const [method, p] of tries) {
    const r = method === "GET" ? await mgr.get(p) : await mgr.post(p, {});
    const leaked = /private words/.test(r.text || "");
    t(`demo's manager, ${method} ${p}: refused, nothing of Other Co's comes back`, [302, 401, 403, 404].includes(r.status) && !leaked, { status: r.status, body: String(r.text || "").slice(0, 200) });
  }
  const after = (await admin.get(`/api/c/otherco/feedback/platform?status=all`)).json.find((x) => x.id === fid).recurrence;
  t("Other Co's request was not touched by any of them", after === before, { before, after });
  const own = await other.post(`/api/feedback/${fid}/plusone`, {});
  t("Other Co's own manager still reaches it the ordinary way", own.status === 200 && own.json.id === fid);
  t("and demo's manager still reaches demo's own board", (await mgr.get("/api/c/demo/board")).status === 200);
  t("the server is still the same process at the end", (await alive()) === boot);
  R.done();
})().catch(R.abort);
