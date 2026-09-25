// Symbiotic OS — instance server.
// One process serves every company's improvement board, the platform APIs,
// every module's live and staged versions, the agent settings pages, and the
// admin view across companies.
const fs = require("fs");
const path = require("path");
const express = require("express");
process.env.SOS_BOOT_ID = process.env.SOS_BOOT_ID || String(Date.now()); // pages reload themselves when this changes (a redeploy)
const { initPlatformSchema, q } = require("./src/db");
const registry = require("./src/registry");
const platformApi = require("./src/feedback");
const auth = require("./src/auth");
const diagrams = require("./src/diagrams");
const pipeline = require("./src/pipeline");
const intake = require("./src/intake");
const checks = require("./src/checks");
const record = require("./src/record");
const connections = require("./src/connections");
const people = require("./src/people");
const accounts = require("./src/accounts");
const edge = require("./src/edge");
const selfserve = require("./src/selfserve");

const PORT = process.env.PORT || 3000;
const page = (name) => path.join(__dirname, "public", name);

async function main() {
  await initPlatformSchema();
  await accounts.init();      // named admin accounts, their authenticators and recovery codes, the sign-in log (src/accounts.js)
  await require("./src/devices").init();   // trusted admin devices: "remember this computer", the code skipped at sign-in for 30 days (src/devices.js)
  await record.init();   // the interaction record: insert-only, what everyone said and decided
  await people.init();        // operator identity: names and PINs per company
  await require("./src/closeloop").init();   // close the loop: my requests, what went live, fixed it / not quite
  await require("./src/arrival").init();     // propose on arrival: duplicates folded in, one question instead of a guess, what the person pointed at (after closeloop: its trigger names closeloop's columns)
  await require("./src/credit").init();       // the AI credit glide slope on /admin (the balance the admin enters, projected from the platform's own spend)
  await require("./src/acceptance").init();   // acceptance checks that accumulate: the promises a manager retired (the checks themselves live in the module's files)
  await require("./src/runner").init();      // module code in a process of its own per company (tenancy option C): the user ids
  await connections.init();   // what modules reach outside through: spreadsheets, label printers (src/connections.js)
  await require("./src/datacheck").init();   // the review-time check that a change's ERP data is available, and the admin's data requests
  await require("./src/assess").init();      // which model is the baseline: the head-to-head assessment and the live A/B arms (/admin#models)
  await require("./src/requests").init();    // requests to Anetix: feedback about the software itself, and the way back to whoever sent it
  await require("./src/testfloor").init();   // the test floor: a third lane per company, switched on by the admin (docs/TEST-ENVIRONMENT.md)
  await require("./src/campaign").init();    // the test campaign: proposed by the AI, approved by the manager, run on the test floor, a step before the deploy gate
  await require("./src/datawall").init();    // the data wall: whether the AI may read a company's data, a switch per company on /admin (src/datawall.js)
  await require("./src/selfserve").init();   // self-serve companies from anetix.ai: access pins, the credit ledger, the credit gate (src/selfserve.js)

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", true);
  // Nothing is answered that did not come through Cloudflare, once SOS_EDGE_SECRET is set (src/edge.js). First in
  // line on purpose: before the static files, before the login route. /health and the platform's own calls pass.
  app.use(edge.gate);

  // no-cache on HTML so deploys are visible immediately (playbook lesson)
  app.use((req, res, next) => {
    if (!req.path.startsWith("/assets")) res.set("Cache-Control", "no-cache");
    next();
  });

  app.use("/assets", express.static(path.join(__dirname, "public", "assets")));
  app.get("/health", (_req, res) => res.json({ ok: true, boot: process.env.SOS_BOOT_ID }));
  app.get("/login", (_req, res) => res.sendFile(page("login.html")));
  // which form the login page opens for the company it was sent to: "account" for a personal demo (no company password)
  app.get("/login/mode", async (req, res) => { try { res.set("Cache-Control", "no-store").json({ mode: await auth.loginMode(req.query.c) }); } catch (e) { res.json({ mode: "password" }); } });
  // anetix.ai is a wall (2026-09-25): its only public page is a sign-in, and that form posts HERE across the origin
  // (same site, so the session cookie this answer sets lands on this host). CORS for the www service's own
  // addresses and nothing else; any other origin gets no CORS headers and the browser refuses to read the answer.
  app.options("/login", selfserve.loginCors);
  app.post("/login", selfserve.loginCors, express.json(), auth.loginHandler);
  app.get("/logout", auth.logoutHandler);
  // A stand-in ERP for the showroom: SAP-shaped OData answers about the paper
  // line's stock, so a demo company's erp connection has something to talk
  // to (base URL <this host>/erp-demo/). Static rows, read only, no login.
  app.get("/erp-demo/epicor/BaqSvc/:baq/Data", connections.demoEpicor);   // the same, Epicor Kinetic REST v2 shaped
  app.get("/erp-demo/:entity", connections.demoErp);
  // The www service (anetix.ai) checks pins, makes companies and adds credit through /api/www/*, opened by the
  // shared key SOS_WWW_KEY rather than a session (src/selfserve.js). It calls the public address, so the edge check
  // above still applies to it.
  app.use(require("./src/selfserve").wwwRouter);

  app.use(auth.middleware);    // everything below needs a floor, manager, or admin session
  app.use(auth.companyGuard);  // and a floor or manager session reaches its own company only
  app.use(people.attach);      // who is standing at this device, if anyone (a name and a PIN, src/people.js)
  app.use(connections.deviceCookie);   // a random device id per browser, so a print job goes back to the screen that asked

  // Landing: admins go to the admin view; everyone else to their company board
  // (the only company, or a chooser when there are several).
  app.get("/", async (req, res) => {
    const companies = (await q("SELECT slug, name FROM platform.companies ORDER BY created_at")).rows;
    if (req.sosRole !== "admin") return res.redirect(`/c/${req.sosCompany}/`);   // a floor or manager login belongs to one company
    if (companies.length !== 1) return res.redirect("/admin");
    if (companies.length === 1) return res.redirect(`/c/${companies[0].slug}/`);
    res.type("html").send(`<!DOCTYPE html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Anetix</title>
      <body style="font-family:system-ui,sans-serif;background:#f2f4f7;color:#1c242e;padding:24px"><h1 style="font-size:20px">Pick a company</h1>
      ${companies.map((c) => `<p><a style="font-size:18px;color:#1f3a5f" href="/c/${c.slug}/">${c.name}</a></p>`).join("")}</body>`);
  });
  // The board's icon links name the company in the HTML itself (not only from the script that runs later): a
  // browser reads <link rel="icon"> at parse time and Safari keeps that first icon for the page, which is how every
  // board showed one company's mark (found 2026-09-24: the file said /api/c/demo/icon).
  app.get("/c/:slug/", (req, res) => {
    const slug = /^[a-z0-9][a-z0-9-]{1,40}$/.test(req.params.slug) ? req.params.slug : "demo";
    res.type("html").send(fs.readFileSync(page("index.html"), "utf8").split("/api/c/__company__/icon").join(`/api/c/${slug}/icon`));
  });
  app.get("/c/:slug", (req, res) => res.redirect(`/c/${req.params.slug}/`));
  app.get("/c/:slug/agents", (_req, res) => res.sendFile(page("agents.html")));
  app.get("/c/:slug/diagrams/:module", (_req, res) => res.sendFile(page("diagrams.html")));
  app.get("/c/:slug/checks", auth.requireManager, (_req, res) => res.sendFile(page("checks.html")));
  app.get("/c/:slug/connections", auth.requireManager, (_req, res) => res.sendFile(page("connections.html")));
  app.get("/c/:slug/people", auth.requireManager, (_req, res) => res.sendFile(page("people.html")));
  app.get("/c/:slug/settings", auth.requireManager, (_req, res) => res.sendFile(page("settings.html")));
  app.get("/c/:slug/enroll", auth.requireManager, (_req, res) => res.sendFile(page("enroll.html")));   // a manager account's authenticator setup, its first stop (src/accounts.js)   // the manager's one settings page: people, printers and spreadsheets, the wall sign, what happens when a request arrives
  app.get("/admin", auth.requireAdmin, (_req, res) => res.sendFile(page("admin.html")));

  app.use(accounts.router);  // /api/admin/accounts*: the admin accounts, authenticator setup, sign out everywhere
  app.use(intake.router);    // /api/c/:slug/intakes, /api/intakes/*, /api/attachments/* (before platformApi: the attach route parses a bigger body)
  app.use(checks.router);    // /api/c/:slug/checks, /api/runs/:id/label
  app.use(require("./src/assess").router);   // /api/admin/models*, /api/admin/assess*: the baseline, the live A/B, the head-to-head
  app.use(require("./src/requests").router); // /api/admin/requests*: requests to Anetix, moved along from the Requests tab of /admin
  app.use(require("./src/demos").router);        // /api/admin/demos*: the Demos tab of /admin (what each self-serve company paid, spent, built, and how)
  app.use(require("./src/selfserve").adminRouter);   // /api/admin/pins*, /api/admin/companies/:slug/credit: the Pins tab of /admin and the credit on a company's card
  app.use(require("./src/testfloor").router); // the test floor's switch (admin), status and reset
  app.use(require("./src/campaign").router);  // /api/runs/:id/campaign*, /api/c/:slug/who/campaign*: the test campaign on a build
  app.use(platformApi);      // /api/*
  registry.attach(app);      // /c/:slug/m/:module, /c/:slug/staging/m/:module and /c/:slug/test/m/:module

  // every deploy redraws the module's diagrams for the new version, and a tool on the test floor follows the floor
  registry.hooks.deployed = async (company, mod, version) => {
    await require("./src/testfloor").afterDeploy(company, mod, version).catch((e) => console.error(`[testfloor] ${company}/${mod}:`, e.message));
    return diagrams.generate(company, mod, version);
  };
  // can this instance run module code in a process of its own, with a database login of its own? find out before anything is mounted
  await require("./src/runner").selfTest().catch((e) => console.error("[runner] self test:", e.message));
  await registry.loadAll();
  await require("./src/testfloor").boot();   // every company whose switch is on gets its test floor back
  // companies from before per-company passwords keep the shared ones until the admin sets their own
  await auth.ensureAccessRows();
  // builds that were running when the previous process died get a failed
  // status (retry/cancel on the board) instead of a spinner forever
  const orphaned = await pipeline.sweepOrphans();
  if (orphaned) console.log(`[pipeline] ${orphaned} orphaned run(s) marked failed`);
  const swept = await require("./src/campaign").sweep();   // a campaign that was running at the restart has no process behind it
  if (swept) console.log(`[campaign] ${swept} campaign(s) that were running at the restart marked failed`);
  require("./src/campaign").startWatching();   // the guided steps' watches, every few seconds while any campaign is walking
  // modules with no diagrams yet (first boot after this feature) get them now
  for (const m of (await q("SELECT company, name, live_version FROM platform.modules WHERE live_version IS NOT NULL")).rows) {
    diagrams.generate(m.company, m.name, m.live_version).catch((e) => console.error(`diagrams ${m.company}/${m.name}:`, e.message));
  }

  app.listen(PORT, () => console.log(`Anetix instance on :${PORT} (auth ${auth.OPEN ? "OPEN: no passwords set" : "on"})`));
  // does this instance have a browser for the page load every build gets (src/pageload.js)? say so in the deploy log
  require("./src/pageload").selfTest().catch((e) => console.error("[pageload] self test:", e.message));
}

main().catch((e) => { console.error(e); process.exit(1); });
