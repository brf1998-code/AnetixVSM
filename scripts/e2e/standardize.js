// End to end: every company that is not a paid site gets the same trial features, however and whenever it was made,
// and a boot brings the companies that already exist up to the rule (src/kind.js, 2026-09-29).
//
// Runs against a server that is ALREADY UP in fake-agent mode on a fresh database (see closeout.js for the command):
//   node scripts/e2e/standardize.js
const crypto = require("crypto");
const { PW, runner, login } = require("./lib");
const { q, pool } = require("../../src/db");
const kind = require("../../src/kind");
const R = runner(), t = R.t;

(async () => {
  const admin = await login(PW.admin, "");
  const floor = await login(PW.floor, "demo");

  // ---- 1. the Demo Company was added by hand long ago (demo=false): it gets every trial feature now
  const board = (await admin.get("/api/c/demo/board")).json;
  t("setup: the Demo Company is not an anetix.ai demo", board.company.demo === false);
  t("but it is a trial: not a paid site", board.company.trial === true);
  const s = await admin.get("/api/c/demo/modules/paperline/sample");
  t("it has sample data like every demo", s.status === 200 && s.json.can_fill !== undefined, s.status);
  const page = await floor.get("/c/demo/m/paperline/");
  t("its tool pages carry the link back to the improvement board", page.status === 200 && /data-board="1"/.test(page.text));
  const dg = (await admin.get("/api/c/demo/diagrams/paperline")).json;
  t("its diagrams are drawn when asked, like a demo's", dg.trial === true);
  const sv = (await login(PW.manager, "demo")).get("/api/c/demo/settings-view");
  t("its Settings keep the floor's cards (it has a floor password; it is not an anetix.ai demo)", (await sv).json.company.demo === false && (await sv).json.company.trial === true);

  // ---- 2. a paid site gets none of them
  const made = await admin.post("/api/admin/companies", { slug: "paid-site", name: "Paid Site" });
  await q("INSERT INTO platform.sites (id, company, stage, standing) VALUES ($1,'paid-site','subscribed','good')", [crypto.randomUUID()]);
  await admin.post("/api/admin/companies/paid-site/modules", { module: "paperline" });
  const pb = (await admin.get("/api/c/paid-site/board")).json;
  t("a paid site is not a trial", pb.company.trial === false);
  t("it has no sample data", (await admin.get("/api/c/paid-site/modules/paperline/sample")).status === 404);
  const pfloor = await login(made.json.passwords.floor, "paid-site");
  const pp = await pfloor.get("/c/paid-site/m/paperline/");
  t("its tool pages carry the link back to the board too (every page, since 2026-10-05)", pp.status === 200 && /data-board="1"/.test(pp.text));
  const widget = (await pfloor.get("/assets/feedback-widget.js")).text;
  t("the widget draws the board link on every page and in the preview's bar", /sos-board-link/.test(widget) && /sos-bar-board/.test(widget) && !/data-demo/.test(widget));

  // ---- 3. a boot brings existing companies to the rule
  const mk = async (slug, stage) => {
    await q("INSERT INTO platform.companies (slug, name, demo) VALUES ($1,$1,false)", [slug]);
    await q("INSERT INTO platform.self_serve (company, email) VALUES ($1,$2)", [slug, `${slug}@x.test`]);
    if (stage) await q("INSERT INTO platform.sites (id, company, stage) VALUES ($1,$2,$3)", [crypto.randomUUID(), slug, stage]);
  };
  await mk("early-demo", null);
  await mk("early-ordering", "ordering");
  await mk("early-activating", "activating");
  await mk("early-site", "subscribed");
  await q("INSERT INTO platform.companies (slug, name) VALUES ('old-login','Old Login')");
  await q("INSERT INTO platform.company_access (company, legacy_login) VALUES ('old-login', true) ON CONFLICT (company) DO UPDATE SET legacy_login=true");
  const out = await kind.standardize();
  const demoOf = async (slug) => (await q("SELECT demo FROM platform.companies WHERE slug=$1", [slug])).rows[0].demo;
  t("an anetix.ai company made before demos were marked is a demo now", out.demos.includes("early-demo") && await demoOf("early-demo") === true);
  t("so is one still ordering", out.demos.includes("early-ordering") && await demoOf("early-ordering") === true);
  t("one being switched on is left alone", !out.demos.includes("early-activating") && await demoOf("early-activating") === false);
  t("a paid site is left alone", !out.demos.includes("early-site") && await demoOf("early-site") === false);
  t("a company added by hand is not turned into an anetix.ai demo", await demoOf("demo") === false && !out.demos.includes("demo"));
  t("a company with no sign-in of its own is named", out.no_sign_in.includes("old-login"));
  t("a second run finds nothing more to change", (await kind.standardize()).demos.length === 0);
  const ev = (await q("SELECT detail FROM platform.events WHERE kind='companies_standardized' ORDER BY id DESC LIMIT 1")).rows[0];
  t("the change is on the event log", ev && ev.detail.demos.includes("early-demo"));
  const eb = (await admin.get("/api/c/early-demo/board")).json.company;
  t("the early company's board now reads as a demo and a trial", eb.demo === true && eb.trial === true);

  await pool.end().catch(() => {});
  R.done();
})().catch(R.abort);
