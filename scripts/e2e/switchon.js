// End to end for 2026-10-13: a company switched on by hand before its payment (src/activate.js switchOn), and the
// notices folded into one line that a manager or an admin clears (src/notices.js).
//   switch on   a by-hand company with a pilot offered and sample data in a tool: Switch on needs the step-up, takes
//               the sample data out, keeps the floor's password, makes the company a site (no trial, no sample data,
//               more managers), keeps the pilot offer standing and the stage where it was. The usual road then takes
//               the payment: the order signed, a card, Activate. Activate keeps the floor's password and clears
//               switched_on. Switch back to a trial undoes a site on by hand, and refuses a paying one.
//   notices     seven notices: an admin closes one, then Clear all closes the rest, and seen_by says who
// Against a server ALREADY UP like pricing.js's (run-all.sh's S5 env), on a fresh database.
const http = require("http");
const { runner, client, login, PW, sleep } = require("./lib");
const { q } = require("../../src/db");
const R = runner(), t = R.t;
const BASE = process.env.SOS_E2E_BASE || "http://127.0.0.1:3999";
const KEY = process.env.SOS_WWW_KEY, IKEY = process.env.WWW_INTERNAL_KEY;
const STUB = new URL(process.env.WWW_INTERNAL_URL || "http://127.0.0.1:4013");
if (!KEY || !IKEY) { console.error("SOS_WWW_KEY and WWW_INTERNAL_KEY must be set in this shell and the server's"); process.exit(2); }
const monthsOn = (sec, n) => { const d = new Date(sec * 1000); d.setUTCMonth(d.getUTCMonth() + n); return Math.floor(d.getTime() / 1000); };
let subN = 0;
const server = http.createServer((req, res) => {
  let raw = ""; req.on("data", (d) => { raw += d; });
  req.on("end", () => {
    const send = (status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
    const body = raw ? JSON.parse(raw) : {};
    if (req.url === "/" && req.method === "POST") return send(200, { id: "ntfy" });
    if (req.headers["x-www-internal-key"] !== IKEY) return send(401, { error: "internal key required" });
    if (req.url === "/internal/ping") return send(200, { ok: true, stripe: "test", tax: false, webhook: true, can: ["pilot", "reprice"] });
    if (req.url === "/internal/activate") {
      const now = Math.floor(Date.now() / 1000);
      return send(200, { ok: true, resumed: false, price_id: "price_x", balance_txn: null,
        subscription: { id: `sub_on_${++subN}`, status: "active", metadata: body.metadata, current_period_start: now, current_period_end: monthsOn(now, 1), cancel_at_period_end: false, cancel_at: body.cancel_after_months ? monthsOn(now, body.cancel_after_months) : null } });
    }
    if (["/internal/detach", "/internal/reverse-balance", "/internal/cancel", "/internal/abandon", "/internal/end", "/internal/pilot-end"].includes(req.url)) return send(200, { ok: true });
    send(404, { error: "not found" });
  });
});
const www = async (p, body, key = KEY) => {
  const r = await fetch(BASE + p, { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", ...(key ? { "X-SOS-WWW-Key": key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
const tokenOf = (url) => new URL(url).searchParams.get("t");
const site = async (slug) => (await q("SELECT * FROM platform.sites WHERE company=$1", [slug])).rows[0];
const waitFor = async (fn, ms = 20000) => { for (let i = 0; i < ms / 200; i++) { const v = await fn(); if (v) return v; await sleep(200); } return null; };

server.listen(Number(STUB.port), "127.0.0.1", async () => {
 try {
  const admin = await login(PW.admin);
  await admin.post("/api/admin/credit", { balance_usd: 100, autofill: true, note: "e2e" });
  const S = "chelsea-test";
  const made = await admin.post("/api/admin/companies", { slug: S, name: "Chelsea Test Clocks" });
  await admin.post(`/api/admin/sites/${S}/track`, {});
  await admin.post(`/api/admin/sites/${S}`, { legal_name: "Chelsea Test Clocks, LLC", site_name: "Chelsea Test Clocks", site_address: { line1: "1 Main St", city: "Chelsea", state: "MA", postal_code: "02150" }, plant_manager: { name: "Arthur Stone", title: "Owner", email: "arthur@clock.test" }, headcount: 22, sqft: 15000 });
  await admin.post(`/api/admin/sites/${S}/offer`, { monthly_usd: 1000, months: 2, lines: [] });
  await admin.post(`/api/admin/companies/${S}/modules`, { module: "paperline" });
  const url = `/api/c/${S}/modules/paperline/sample`;
  await admin.post(url, {});
  const filled = await waitFor(async () => { const x = (await admin.get(url)).json; return x.fill && x.fill.status !== "writing" ? x : null; });
  t("set up: the by-hand company has sample data in a tool and a pilot offered", filled && filled.fill.status === "in" && (await admin.get(`/api/c/${S}/board`)).json.company.trial === true, filled);
  const floorPw = made.json.passwords.floor;
  const floor = await login(floorPw, S);
  const mgr = await login(made.json.passwords.manager, S);
  const kind = require("../../src/kind");
  t("a trial before it is switched on (its managers cannot add managers yet)", (await kind.isSite(S)) === false);

  // ---- switch on, payment to follow
  t("switch on needs the step-up", (await admin.post(`/api/admin/sites/${S}/switch-on`, { note: "x" })).status === 403);
  t("a manager cannot switch on", (await mgr.post(`/api/admin/sites/${S}/switch-on`, { password: PW.admin })).status === 403);
  const on = await admin.post(`/api/admin/sites/${S}/switch-on`, { password: PW.admin, note: "rolling out on the floor", clear_sample: true });
  t("switch on answers ok", on.status === 200 && on.json.switched_on === true && !on.json.rollover_error, on.json);
  const s1 = await site(S);
  t("the site is on by hand, the stage untouched, the plant's data starts now", s1.switched_on && s1.switched_on.note === "rolling out on the floor" && s1.stage !== "subscribed" && Boolean(s1.converted_at) && s1.rollover && s1.rollover.done_at && s1.rollover.floor_kept, s1);
  const fillNow = (await q("SELECT status FROM platform.sample_fills WHERE company=$1 ORDER BY id DESC LIMIT 1", [S])).rows[0];
  t("the sample data came out (the going-live clear is not refused for a site)", fillNow && fillNow.status === "cleared", fillNow);
  t("the floor keeps its password: its session still works and the password still opens it", (await floor.get(`/api/c/${S}/board`)).status === 200 && (await client().post("/login", { password: floorPw, company: S })).status === 200);
  const b1 = (await admin.get(`/api/c/${S}/board`)).json;
  t("the board is a site's: not a trial, no credit line", b1.company.trial === false && !b1.credit, b1.company);
  t("no sample data on it now", (await admin.post(url, {})).status === 404);
  t("the pilot offer still stands, so the payment can follow", b1.golive && b1.golive.pilot === true, b1.golive);
  const row = (await admin.get("/api/admin/sites")).json.rows.find((r) => r.slug === S);
  t("the Sites tab says on, payment to follow", row.switched_on && /^On, payment to follow/.test(row.stage_label), row.stage_label);
  t("switch on twice is refused", (await admin.post(`/api/admin/sites/${S}/switch-on`, { password: PW.admin })).status === 409);
  kind.forget(S);
  t("a site now, by src/kind.js (more managers, Ask Anetix live, no company cap)", (await kind.isSite(S)) === true);
  t("deleting it is refused while it is on", (await admin.post(`/api/admin/companies/${S}/delete`, { password: PW.admin, confirm: S })).status >= 400);

  // ---- back to a trial, and on again
  const off = await admin.post(`/api/admin/sites/${S}/switch-off`, { password: PW.admin });
  const s2 = await site(S);
  kind.forget(S);
  t("switch back to a trial", off.status === 200 && !s2.switched_on && (await admin.get(`/api/c/${S}/board`)).json.company.trial === true && (await kind.isSite(S)) === false, off.json);
  t("switch off twice is refused", (await admin.post(`/api/admin/sites/${S}/switch-off`, { password: PW.admin })).status === 409);
  await admin.post(`/api/admin/sites/${S}/switch-on`, { password: PW.admin, note: "on again" });

  // ---- the payment by the usual road: order from the manager sign-in, signed, card, Activate
  const gl = (await mgr.get(`/api/c/${S}/board`)).json.golive;
  const acc = { slug: S, t: tokenOf(gl.url) };
  const v = await www("/api/www/golive/view", { access: acc });
  const o = (await www("/api/www/golive/save", { access: acc, fields: { ...v.json.prefill, contact: { is_pm: true }, billing: { email: "ap@clock.test", same_as_site: true } } })).json.order;
  const v2 = (await www("/api/www/golive/view", { access: acc })).json;
  const sg = await www("/api/www/golive/sign", { access: acc, version: v2.order.version, sha: v2.order.sha, signer: { name: "Arthur Stone", title: "Owner", email: "arthur@clock.test" }, authority: true, ip: "198.51.100.9", ua: "e2e" });
  await www("/api/www/golive/checkout", { access: acc, stripe_customer: "cus_on1", setup_session: "cs_on1" });
  await www("/api/www/golive/card", { order: o.id, setup_session: "cs_on1", stripe_customer: "cus_on1", payment_method: "pm_on1", card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 } });
  const checks = (await admin.get(`/api/admin/sites/${S}/checks`)).json;
  t("Activate's plan says the floor keeps its password", checks.plan && checks.plan.some((x) => /keeps the password/.test(x)) && !checks.plan.some((x) => /floor gets its own password/.test(x)), checks.plan);
  const act = await admin.post(`/api/admin/sites/${S}/activate`, { password: PW.admin, test_mode_ok: true });
  const s3 = await site(S);
  t("Activate takes the payment on a site on by hand", act.status === 200 && act.json.charged_usd === 1000 && s3.stage === "subscribed" && s3.band.key === "pilot", { act: act.json, sign: sg.json.error });
  t("and clears switched_on, keeping the rollover's marks (paid_at added)", !s3.switched_on && s3.rollover.done_at && s3.rollover.floor_kept && s3.rollover.paid_at, s3.rollover);
  t("the floor's password still opens the floor after the payment", (await client().post("/login", { password: floorPw, company: S })).status === 200);
  t("no welcome panel with a second new password", !((await mgr.get(`/api/c/${S}/board`)).json.welcome || {}).ready);
  t("a paying site cannot be switched back to a trial here", (await admin.post(`/api/admin/sites/${S}/switch-off`, { password: PW.admin })).status === 409);

  // ---- notices
  const N = "demo";
  for (let i = 4; i <= 10; i++) await q("INSERT INTO platform.notices (company, kind, text) VALUES ($1,'tool_changed',$2)", [N, `Anetix put a change live on inventory-management-system (v${i}) to fix an error that stopped the tool working: Adding new BOM`]);
  const nb = (await admin.get(`/api/c/${N}/board`)).json.notices;
  t("seven notices on the board, newest first", nb.length === 7 && /v10/.test(nb[0].text), nb.length);
  t("an admin closes one", (await admin.post(`/api/c/${N}/notices/${nb[0].id}/seen`, {})).status === 200);
  const floorDemo = await login(PW.floor, N);
  t("the floor cannot clear them", (await floorDemo.post(`/api/c/${N}/notices/seen-all`, {})).status === 403);
  const all = await admin.post(`/api/c/${N}/notices/seen-all`, {});
  t("Clear all closes the other six", all.status === 200 && all.json.closed === 6, all.json);
  t("none left on the board", (await admin.get(`/api/c/${N}/board`)).json.notices.length === 0);
  const by = (await q("SELECT DISTINCT seen_by FROM platform.notices WHERE company=$1", [N])).rows.map((r) => r.seen_by);
  t("who closed them is kept", by.length === 1 && by[0] === "admin", by);
  R.done();
 } catch (e) { R.abort(e.stack || e); }
});
