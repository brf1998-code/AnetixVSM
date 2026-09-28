// End to end for Phase 2's first item (2026-09-27, src/companyview.js): nothing a manager or the floor reads from the
// platform's /api/ names a model or carries an AI cost. Against a server ALREADY UP in fake-agent mode on a FRESH
// database (run-all.sh does it). It makes the things that carry models and costs (proposals, a build that ships, one
// that stops, a system review, a new-tool request, a run log line naming a model and a cost cap), then calls every GET
// route in the product that takes a parameter (found by walking the routers, as badids.js does) as a manager and as the
// floor, and reads every JSON answer for a model's id or label and for the keys that carry one or a cost. An admin's
// copy of the board still has them (the figures are Anetix's, not gone).
//   node scripts/e2e/leaks.js
const path = require("path");
const { runner, login, PW, waitFor, board, proposalFor, ship } = require("./lib");
const { q } = require("../../src/db");
const R = runner(), t = R.t;
const PAGE = "/c/demo/m/paperline/";
const LABELS = require("../../src/agent").ALL_MODELS.map((m) => m.label);
const { namesModel } = require("../../src/companyview");
const COST = [...require("../../src/companyview").COST], MODEL = [...require("../../src/companyview").MODEL];
const USD_OK = ["price_usd", "paid_usd"];   // a site's price and what a payment was: the customer's own money, shown on purpose

// every GET route with a parameter, from the routers the product mounts
function getRoutes() {
  const out = new Set(), src = path.join(__dirname, "../../src");
  for (const f of require("fs").readdirSync(src).filter((x) => x.endsWith(".js"))) {
    if (/^(runner-child|runner-probe|modulebuild)\.js$/.test(f)) continue;
    let m; try { m = require(path.join(src, f)); } catch (_) { continue; }
    for (const r of [m, ...(m && typeof m === "object" ? Object.values(m) : [])]) {
      if (!r || typeof r !== "function" || !Array.isArray(r.stack)) continue;
      for (const layer of r.stack) if (layer.route && layer.route.methods.get && /^\/api\//.test(layer.route.path) && layer.route.path.includes(":")) out.add(layer.route.path);
    }
  }
  return [...out];
}
// what a leak looks like in an answer: a key that carries a model or a cost, or a string that names a model
function leaks(v, at = "", found = []) {
  if (found.length > 5 || v == null) return found;
  if (typeof v === "string") {
    if (/claude-[a-z0-9]/i.test(v) || LABELS.some((l) => new RegExp(`\\b${l.replace(/\./g, "\\.")}(?!\\w|\\.\\d)`).test(v))) found.push(`${at}: "${v.slice(0, 80)}"`);
    else if (/\$\d/.test(v)) found.push(`${at}: a dollar figure "${v.slice(0, 80)}"`);   // no request in this test types a price
    return found;
  }
  if (Array.isArray(v)) { v.forEach((x, i) => leaks(x, `${at}[${i}]`, found)); return found; }
  if (typeof v === "object") for (const [k, x] of Object.entries(v)) {
    // a key that carries a cost, any dollar field but a price a demo is shown on purpose, or a model key naming a model
    if ((COST.includes(k) || (/_usd$/.test(k) && !USD_OK.includes(k))) && x != null) found.push(`${at}.${k}`);
    else if (MODEL.includes(k) && namesModel(x)) found.push(`${at}.${k}`);
    else leaks(x, `${at}.${k}`, found);
  }
  return found;
}

(async () => {
  const admin = await login(PW.admin, ""), mgr = await login(PW.manager, "demo"), floor = await login(PW.floor, "demo");
  const file = async (message) => (await floor.post("/api/feedback", { company: "demo", module: "paperline", page: PAGE, message })).json.id;

  // ---- things that carry a model or a cost
  const f1 = await file("SIMPLE make the station name text bigger");
  const shipped = await ship(mgr, [f1]);
  const f2 = await file("count the scrapped sheets per shift FAILBUILD");
  const p2 = await proposalFor(mgr, f2);
  const d2 = (await mgr.post(`/api/proposals/${p2.id}/decide`, { decision: "approve" })).json;
  t("the manager's answer to an approve has the run and no model", d2.run && d2.run.id && d2.run.model === undefined && !leaks(d2).length, leaks(d2));
  const r2 = d2.run.id;
  await waitFor("the stopped build", async () => {
    const x = (await board(admin)).runs.find((r) => r.id === r2);
    if (x && x.step === "confirm_requirement" && x.status === "waiting") { await mgr.post(`/api/runs/${r2}/confirm`, {}); return null; }
    return x && x.status === "failed";
  }, 60000);
  await q(`UPDATE platform.build_runs SET log = log || $2::jsonb WHERE id=$1`, [r2, JSON.stringify([{ t: new Date().toISOString(), step: "build", note: "claude-fable-5-1 cannot run as the build agent; building with claude-opus-5-5 instead" }, { t: new Date().toISOString(), step: "error", note: "build stopped: run cost passed the $4.00 cap for this run" }])]);
  const rv = (await mgr.post("/api/c/demo/reviews", { module: "paperline" })).json;
  t("starting a system review answers the manager without the model", rv.id && !leaks(rv).length, leaks(rv));
  await waitFor("the review", async () => ((await admin.get("/api/c/demo/reviews")).json.find((x) => x.id === rv.id) || {}).status !== "running", 60000);
  const it = (await mgr.post("/api/c/demo/intakes", {})).json;
  t("a new-tool request answers the manager without the model", it.id && !leaks(it).length, leaks(it));
  await mgr.post(`/api/intakes/${it.id}/answer`, { id: "name", value: "Scrap Tally" });

  // ---- the admin's copies still carry them (so the checks below are not passing on empty data)
  const ab = await board(admin);
  t("an admin's board still names the models and the costs", leaks(ab).length > 0 && ab.runs.some((r) => r.model) && ab.feedback.some((f) => f.proposal_model), leaks(ab).slice(0, 3));
  t("and an admin's run keeps the log line as written", ((await admin.get(`/api/runs/${r2}`)).json.log || []).some((l) => /claude-opus-5-5/.test(l.note)));

  // ---- the manager's and the floor's
  const mb = await board(mgr);
  t("the manager's board names no model and carries no cost", !leaks(mb).length, leaks(mb));
  t("its run log says the AI, and the cost cap line has no figure", (mb.runs.find((r) => r.id === r2).log || []).some((l) => /building with the AI instead/.test(l.note)) && (mb.runs.find((r) => r.id === r2).log || []).some((l) => l.note === "build stopped: run cost passed the cap for this run"), mb.runs.find((r) => r.id === r2).log.slice(-3));
  t("a demo's credit on it, when there is one, is a percent (checked in selfserve.js); the board's own numbers are gone", mb.spend === undefined && mb.models === undefined && mb.maxRunUsd === undefined);
  const fb = await board(floor);
  t("the floor's board names no model and carries no cost", !leaks(fb).length, leaks(fb));
  t("the checks log is Anetix's", (await mgr.get("/api/c/demo/checks")).status === 403 && (await mgr.get("/api/c/demo/checks/export")).status === 403 && (await mgr.post(`/api/runs/${r2}/label`, { label: "right" })).status === 403);
  t("and so is a review's cost estimate", (await mgr.get("/api/c/demo/reviews/estimate?module=paperline")).status === 403);
  // a tool's code is Anetix's (Brendan, 2026-09-27): the export of its files is admin only; the company's data is not
  const codeMgr = await mgr.get("/api/c/demo/modules/paperline/export"), codeFloor = await floor.get("/api/c/demo/modules/paperline/export");
  const codeAdmin = await admin.get("/api/c/demo/modules/paperline/export");
  t("a tool's code is not handed to a manager or the floor", codeMgr.status === 403 && codeFloor.status === 403 && !/routes\.js/.test(codeMgr.text || "") && !/routes\.js/.test(codeFloor.text || ""), [codeMgr.status, codeFloor.status]);
  t("an admin still gets it", codeAdmin.status === 200 && codeAdmin.json.files && typeof codeAdmin.json.files["routes.js"] === "string", codeAdmin.status);
  const data = await mgr.get("/api/c/demo/export");
  t("and the manager still downloads the company's data, with no code in it", data.status === 200 && !/router\.get\(|module\.exports/.test(data.text || JSON.stringify(data.json || "")), data.status);

  const ids = { id: String(r2), slug: "demo", company: "demo", name: "paperline", module: "paperline", mod: "paperline" };
  const fillFor = (p, over) => p.replace(/:(\w+)(\([^)]*\))?/g, (_m, n) => encodeURIComponent((over && over[n]) || ids[n] || "1"));
  const tries = [];
  for (const p of getRoutes()) {
    const variants = [fillFor(p)];
    if (/intakes\/:id/.test(p)) variants.push(fillFor(p, { id: String(it.id) }));
    if (/reviews\/:id|review/.test(p)) variants.push(fillFor(p, { id: String(rv.id) }));
    if (/runs\/:id/.test(p)) variants.push(fillFor(p, { id: String(shipped.runId) }));
    // a spreadsheet's rows are the company's own and pass untouched by design (companyview.OWN)
    if (!require("../../src/companyview").applies({ sosRole: "manager", path: fillFor(p) })) continue;
    for (const url of variants) for (const [who, c] of [["manager", mgr], ["floor", floor]]) {
      const r = await c.get(url);
      if (r.status !== 200 || !r.json) continue;
      tries.push(url);
      const l = leaks(r.json);
      if (l.length) t(`GET ${url} as ${who} names no model and carries no cost`, false, l);
    }
  }
  for (const url of ["/api/c/demo/record/export", "/api/me/passkeys", `/api/c/demo/record?run_id=${r2}`]) {
    const r = await mgr.get(url);
    if (r.status === 200 && r.json) { tries.push(url); const l = leaks(r.json); if (l.length) t(`GET ${url} as manager names no model and carries no cost`, false, l); }
  }
  t(`every GET route a manager or the floor could read was checked (${tries.length} answers)`, tries.length >= 25, tries.length);

  // ---- a tool's own AI (ctx.ai, src/registry.js): the Plant KPIs tool's Jonah, as a manager uses it
  const chats = await mgr.get("/c/demo/m/kpis/api/chats");
  t("a tool is lent one AI choice with no name and no price", chats.status === 200 && JSON.stringify(chats.json.models) === JSON.stringify([{ id: "standard", label: "Standard" }]) && chats.json.defaultModel === "standard", chats.json && chats.json.models);
  const ask = await mgr.post("/c/demo/m/kpis/api/chats", { message: "what is the constraint this week?", model: "claude-fable-5-1" });
  t("and its answer names no model and carries no cost", ask.status === 200 && ask.json.model === "standard" && ask.json.cost_usd === 0 && !leaks({ reply: ask.json.reply }).length, ask.json && { model: ask.json.model, cost: ask.json.cost_usd });
  const usage = (await q("SELECT model FROM platform.ai_usage WHERE company='demo' AND module='kpis' ORDER BY id DESC LIMIT 1")).rows[0];
  t("the platform still files which model answered, for Anetix", usage && /^claude-/.test(usage.model || ""), usage);
  t("the record still says what happened, without the model", ((await mgr.get(`/api/c/demo/record?run_id=${shipped.runId}`)).json.rows || []).length > 0);
  R.done();
})().catch(R.abort);
