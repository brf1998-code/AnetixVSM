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
const errors = require("./src/errors");
// one bad request never stops the product (src/errors.js, the launch audit 0.1): an async route's rejection reaches the
// error handler at the bottom, and a stray rejection or throw anywhere is logged instead of ending the process
errors.asyncRoutes();
errors.guards();

const PORT = process.env.PORT || 3000;
const page = (name) => path.join(__dirname, "public", name);

async function main() {
  await initPlatformSchema();
  await accounts.init();      // named admin accounts, their authenticators and recovery codes, the sign-in log (src/accounts.js)
  await require("./src/passkeys").init();   // passkeys: sign in with an email and Face ID, a fingerprint or the device PIN (src/passkeys.js); after accounts, whose table it points at
  await require("./src/devices").init();   // trusted admin devices: "remember this computer", the code skipped at sign-in for 30 days (src/devices.js)
  await require("./src/tickets").init();   // one sign-in straight from demo setup on anetix.ai, before any second factor exists (src/tickets.js, 3.8)
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
  require("./src/stripecheck").bootLine();   // whether a refill is checked with Stripe before it is added (src/stripecheck.js, 3.7)
  await require("./src/demorequests").init();   // demo requests from anetix.ai's form, on the Pins tab (src/demorequests.js)
  await require("./src/sample").init();      // sample data for a demo's tools: the AI fills a tool with a made-up week, and clears exactly those rows (src/sample.js)
  await require("./src/sites").init();       // paid sites: the price book and the pipeline on the Sites tab of /admin (src/sites.js, docs/PAID-SITES.md)
  await require("./src/golive").init();      // paid sites, stage 2: the orders a demo signs on anetix.ai (src/golive.js)
  await require("./src/agreements").init();  // the Terms of Service: every acceptance (order, demo set-up, top-up, board) and the switch (src/agreements.js)
  await require("./src/notices").init();     // notices for a company's managers: a tool Anetix changed, a declined card, an order sent back (src/notices.js)
  await require("./src/activate").init();    // paid sites, stage 3: Activate, the rollover, Stripe's events, the sweep (src/activate.js; after golive and sites)
  await require("./src/billing").init();     // paid sites, stage 4: Manage billing, the standings acted on, back to a demo (src/billing.js; after selfserve and sites)
  await require("./src/demostops").init();   // a demo's build that stopped before a preview: its spend handed back, listed on /admin until addressed (the launch audit 1.20)
  await require("./src/mcpauth").init();     // connector sign-in: the apps, connections and tokens behind an MCP address (src/mcpauth.js, docs/MCP.md)
  await require("./src/mcp").init();         // the MCP addresses' call log (src/mcp.js)

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", true);
  app.use(require("./src/restart").drainingMiddleware);   // while the process is going, every answer closes its connection (src/restart.js)
  // Nothing is answered that did not come through Cloudflare, once SOS_EDGE_SECRET is set (src/edge.js). First in
  // line on purpose: before the static files, before the login route. /health and the platform's own calls pass.
  app.use(edge.gate);

  // no-cache on HTML so deploys are visible immediately (playbook lesson)
  app.use((req, res, next) => {
    if (!req.path.startsWith("/assets")) res.set("Cache-Control", "no-cache");
    next();
  });

  app.use("/assets", express.static(path.join(__dirname, "public", "assets")));
  // the Anetix mark for a tab and a phone's home screen (2026-09-27): /favicon.ico, which a browser asks for on its own,
  // /apple-touch-icon.png, which iOS asks for when a page names none, and the manifest Android reads; public like /assets
  const ICON = (f, type) => (_req, res) => res.set("Cache-Control", "public, max-age=86400").type(type).sendFile(path.join(__dirname, "public", "assets", f));
  app.get("/favicon.ico", ICON("favicon.ico", "image/x-icon"));
  app.get("/apple-touch-icon.png", ICON("anetix-touch-180.png", "image/png"));
  const MANIFEST = JSON.stringify({ name: "Anetix", short_name: "Anetix", start_url: "/", display: "browser", background_color: "#14171c", theme_color: "#14171c",
    icons: [{ src: "/assets/anetix-192.png", sizes: "192x192", type: "image/png" }, { src: "/assets/anetix-512.png", sizes: "512x512", type: "image/png" }, { src: "/assets/anetix-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }] });
  app.get("/manifest.webmanifest", (_req, res) => res.set("Cache-Control", "public, max-age=86400").type("application/manifest+json").send(MANIFEST));
  // Railway's deploy check (fast, says nothing about what is behind it); ?deep=1 also asks the database, for the
  // outside watch (anetix.ai's, www/uptime.js; the launch audit 1.15)
  // v: the commit Railway deployed (its first 7 characters), so the outside check (ops/outside-check) can say from outside
  // that a push went live; boot changes on every start, so it can tell a restart with no new version
  const V = String(process.env.RAILWAY_GIT_COMMIT_SHA || "").slice(0, 7) || null;
  app.get("/health", async (req, res) => {
    if (!req.query.deep) return res.json({ ok: true, v: V, boot: process.env.SOS_BOOT_ID });
    try { await q("SELECT 1"); res.set("Cache-Control", "no-store").json({ ok: true, db: true, v: V, boot: process.env.SOS_BOOT_ID, draining: require("./src/restart").state.draining }); }
    catch (e) { res.status(503).json({ ok: false, db: false }); }
  });
  app.get("/login", (_req, res) => res.sendFile(page("login.html")));
  // which form the login page opens for the company it was sent to: "account" for a personal demo (no company password)
  app.get("/login/mode", async (req, res) => { try { res.set("Cache-Control", "no-store").json({ mode: await auth.loginMode(req.query.c) }); } catch (e) { res.json({ mode: "password" }); } });
  // anetix.ai is a wall (2026-09-25): its only public page is a sign-in, and that form posts HERE across the origin
  // (same site, so the session cookie this answer sets lands on this host). CORS for the www service's own
  // addresses and nothing else; any other origin gets no CORS headers and the browser refuses to read the answer.
  app.options("/login", selfserve.loginCors);
  app.post("/login", selfserve.loginCors, express.json(), auth.loginHandler);
  // Is this browser still signed in here? anetix.ai's pages ask it (src/auth.js currentSession), so a person who wanders
  // back to the front door is offered their board, not a sign-in box. Same site, so the cookie rides along; the same
  // CORS as /login, so only anetix.ai can read the answer. Says the company's name and where the board is, nothing else.
  app.options("/login/session", selfserve.loginCors);
  app.get("/login/session", selfserve.loginCors, async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const s = await auth.currentSession(req);
      if (!s) return res.json({ signed_in: false });
      if (s.role === "admin") return res.json({ signed_in: true, role: "admin", board: "/admin", name: "Anetix admin" });
      const co = (await q("SELECT name FROM platform.companies WHERE slug=$1", [s.company])).rows[0];
      if (!co) return res.json({ signed_in: false });
      res.json({ signed_in: true, role: s.role, board: s.enroll ? `/c/${s.company}/enroll` : `/c/${s.company}/`, name: co.name });
    } catch (e) { res.json({ signed_in: false }); }
  });
  // a new demo's one sign-in straight from anetix.ai's set-up form, on to the authenticator setup (src/tickets.js, 3.8)
  app.get("/login/ticket", auth.ticketHandler);
  // a passkey sign-in (src/passkeys.js): the same CORS as /login, since anetix.ai's wall offers it too
  app.options(["/login/passkey/options", "/login/passkey"], selfserve.loginCors);
  app.post("/login/passkey/options", selfserve.loginCors, express.json(), require("./src/passkeys").beginSignIn);
  app.post("/login/passkey", selfserve.loginCors, express.json({ limit: "64kb" }), require("./src/passkeys").finishSignIn);
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
  app.use(require("./src/demorequests").wwwRouter);   // POST /api/www/demo-requests: anetix.ai's request form, the shared key
  app.use(require("./src/golive").wwwRouter);         // /api/www/golive/*: the go-live screens on anetix.ai, the shared key (src/golive.js)
  app.use(require("./src/agreements").wwwRouter);     // /api/www/terms/*: the Terms' switch and a top-up's tick box, the shared key (src/agreements.js)
  app.use(require("./src/activate").wwwRouter);       // POST /api/www/billing-events: a Stripe event anetix.ai re-read, the shared key (src/activate.js)
  app.use(require("./src/billing").wwwRouter);        // POST /api/www/billing/portal: whose Stripe Customer a Manage billing link is for, the shared key (src/billing.js)

  // The MCP addresses and the sign-in an AI app goes through to reach one (src/mcp.js, src/mcpauth.js, docs/MCP.md).
  // Here on purpose: after the edge check, before the sign-in middleware. An app's calls carry a token, never a
  // cookie; the consent page's two calls check the account themselves. Off (every path a 404) until SOS_PUBLIC_URL
  // names this instance's own address.
  require("./src/mcp").mount(app, { admin: require("./src/mcp-admin") });

  app.use(auth.middleware);    // everything below needs a floor, manager, or admin session
  app.use(auth.companyGuard);  // and a floor or manager session reaches its own company only
  app.use(require("./src/companyview").middleware);   // what a manager or floor reads of /api/: no model names, no AI costs (src/companyview.js)
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
  app.get("/c/:slug/agents", auth.requireAdmin, (_req, res) => res.sendFile(page("agents.html")));   // Anetix's side of a company (the launch audit 1.18)
  app.get("/c/:slug/diagrams/:module", (_req, res) => res.sendFile(page("diagrams.html")));
  app.get("/c/:slug/checks", auth.requireAdmin, (_req, res) => res.sendFile(page("checks.html")));   // Anetix's: it names models and replays on them (Phase 2, 2026-09-27)
  app.get("/c/:slug/connections", auth.requireManager, (_req, res) => res.sendFile(page("connections.html")));
  app.get("/c/:slug/people", auth.requireManager, (_req, res) => res.sendFile(page("people.html")));
  app.get("/c/:slug/settings", auth.requireManager, (_req, res) => res.sendFile(page("settings.html")));
  app.get("/c/:slug/enroll", auth.requireManager, (_req, res) => res.sendFile(page("enroll.html")));   // a manager account's authenticator setup, its first stop (src/accounts.js)   // the manager's one settings page: people, printers and spreadsheets, the wall sign, what happens when a request arrives
  app.get("/admin", auth.requireAdmin, (_req, res) => res.sendFile(page("admin.html")));

  app.use(accounts.router);  // /api/admin/accounts*: the admin accounts, authenticator setup, sign out everywhere
  app.use(require("./src/mcpauth").router);   // /api/admin/mcp*: the connected apps on the Accounts tab, Disconnect (src/mcpauth.js)
  app.use(require("./src/passkeys").router);   // /api/me/passkeys*: a named account's own passkeys (src/passkeys.js)
  app.use(intake.router);    // /api/c/:slug/intakes, /api/intakes/*, /api/attachments/* (before platformApi: the attach route parses a bigger body)
  app.use(checks.router);    // /api/c/:slug/checks, /api/runs/:id/label
  app.use(require("./src/assess").router);   // /api/admin/models*, /api/admin/assess*: the baseline, the live A/B, the head-to-head
  app.use(require("./src/requests").router); // /api/admin/requests*: requests to Anetix, moved along from the Requests tab of /admin
  app.use(require("./src/demostops").router);    // /api/admin/demo-stops*: a demo's builds that stopped before a preview (the launch audit 1.20)
  app.use(require("./src/demos").router);        // /api/admin/demos*: the Demos tab of /admin (what each self-serve company paid, spent, built, and how)
  app.use(require("./src/sites").router);        // /api/admin/sites*: the Sites tab of /admin (the price book, the pipeline from a demo to a paying site)
  app.use(require("./src/golive").router);       // /api/admin/golive, /api/admin/sites/:slug/golive-link|orders, /api/c/:slug/golive: Go live (stage 2)
  app.use(require("./src/activate").router);     // /api/admin/sites/:slug/checks|activate|decline|send-back|lift, /api/admin/stripe-sweep, /api/c/:slug/welcome (stage 3)
  app.use(require("./src/agreements").router);   // /api/admin/terms (the switch), /api/c/:slug/terms/accept (the board's box)
  app.use(require("./src/notices").router);      // /api/c/:slug/notices/:id/seen
  app.use(require("./src/dataexport").router);   // /api/c/:slug/export: the company's own data as one JSON file (the Terms, 10.6)
  app.use(require("./src/billing").router);      // /api/c/:slug/billing (the portal link), /api/admin/sites/:slug/end (src/billing.js)
  app.use(require("./src/notify").router);       // /api/admin/notify*: alerts to Anetix's phones through ntfy (src/notify.js)
  app.use(require("./src/selfserve").adminRouter);   // /api/admin/pins*, /api/admin/companies/:slug/credit: the Pins tab of /admin and the credit on a company's card
  app.use(require("./src/demorequests").router);     // /api/admin/demo-requests*: the requests on the Pins tab
  app.use(require("./src/testfloor").router); // the test floor's switch (admin), status and reset
  app.use(require("./src/sample").router);    // /api/c/:slug/modules/:mod/sample*: a demo's sample data (demo companies only)
  app.use(require("./src/campaign").router);  // /api/runs/:id/campaign*, /api/c/:slug/who/campaign*: the test campaign on a build
  app.use(platformApi);      // /api/*
  registry.attach(app);      // /c/:slug/m/:module, /c/:slug/staging/m/:module and /c/:slug/test/m/:module
  app.use("/api", errors.apiNotFound);   // an /api/ path nothing answered: JSON, not Express's HTML page
  app.use(errors.handler);                // last: every error lands here and gets an answer (src/errors.js)

  // every deploy redraws the module's diagrams for the new version, and a tool on the test floor follows the floor
  registry.hooks.deployed = async (company, mod, version) => {
    await require("./src/testfloor").afterDeploy(company, mod, version).catch((e) => console.error(`[testfloor] ${company}/${mod}:`, e.message));
    await require("./src/sample").afterDeploy(company, mod).catch((e) => console.error(`[sample] ${company}/${mod}:`, e.message));   // sample rows that were only in the preview go live with the build
    // a trial's diagrams are drawn when its manager asks (the Diagrams page), not after every deploy: they were most of
    // what a demo spent on its own ($19.85 in six days, 2026-09-26) and few demos open them (the launch audit 1.19).
    // Every company that is not a paid site is a trial here, however it was made (src/kind.js, 2026-09-29).
    if (await require("./src/kind").isTrial(company)) return { skipped: true, reason: "a trial draws its diagrams when asked" };
    return diagrams.generate(company, mod, version);
  };
  // can this instance run module code in a process of its own, with a database login of its own? find out before anything is mounted
  await require("./src/runner").selfTest().catch((e) => console.error("[runner] self test:", e.message));
  await registry.loadAll();
  // the migration rule got stricter (2026-09-28): which stored migration files it would refuse, in the log, never blocking
  require("./src/migrate").auditStored().catch((e) => console.error("[migrate] audit:", e.message));
  // which database role the platform itself runs as (migrations run on it): the name and its powers, never a secret
  q("SELECT current_user AS who, r.rolsuper, r.rolcreaterole, r.rolcreatedb, r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user")
    .then((x) => { const r = x.rows[0] || {}; console.log(`[db] the platform connects as ${r.who}: superuser ${r.rolsuper ? "yes" : "no"}, create roles ${r.rolcreaterole ? "yes" : "no"}, create databases ${r.rolcreatedb ? "yes" : "no"}, bypass row security ${r.rolbypassrls ? "yes" : "no"}`); })
    .catch((e) => console.error("[db] role check:", e.message));
  await require("./src/testfloor").boot();   // every company whose switch is on gets its test floor back
  // companies from before per-company passwords keep the shared ones until the admin sets their own
  await auth.ensureAccessRows();
  // a platform update reaches the companies that already exist: what the platform keeps per company, brought to the
  // rule as it is now (src/kind.js; after every module's init, so every table it reads is there)
  await require("./src/kind").standardize().catch((e) => console.error("[standardize]", e.message));
  // builds that were running when the previous process died get a failed
  // status (retry/cancel on the board) instead of a spinner forever
  const orphaned = await pipeline.sweepOrphans();
  if (orphaned) console.log(`[pipeline] ${orphaned} orphaned run(s) marked failed`);
  // the old process can still start a build in the moment between this sweep and its own stop (Railway stops it once
  // this one answers, then gives it RAILWAY_DEPLOYMENT_DRAINING_SECONDS): a second look once it is surely gone
  setTimeout(() => pipeline.sweepOrphans().then((n) => { if (n) console.log(`[pipeline] ${n} run(s) the previous process left running marked failed`); }).catch((e) => console.error("[pipeline] late sweep:", e.message)),
    Number(process.env.SOS_LATE_SWEEP_MS || 180000)).unref();
  const swept = await require("./src/campaign").sweep();   // a campaign that was running at the restart has no process behind it
  if (swept) console.log(`[campaign] ${swept} campaign(s) that were running at the restart marked failed`);
  await require("./src/restart").sweep().catch((e) => console.error("[restart] sweep:", e.message));   // new-tool requests, reviews, diagrams, brand guides the old process was in the middle of (the launch audit 1.13)
  require("./src/campaign").startWatching();
  require("./src/spendwatch").start();       // phone alerts when AI spend climbs fast; never refuses anything (src/spendwatch.js, the launch audit 0.5)
  require("./src/uptime").start();           // anetix.ai not answering: an alert (src/uptime.js; anetix.ai watches this product the same way)
  require("./src/dataexport").startSweeps();   // demo requests past 12 months go (the privacy notice)   // the guided steps' watches, every few seconds while any campaign is walking
  // modules with no diagrams yet (first boot after this feature) get them now
  // (only ones never attempted: a failed drawing is not paid for again on every restart; Diagrams on the board redraws on demand)
  for (const m of (await q("SELECT company, name, live_version FROM platform.modules m WHERE live_version IS NOT NULL AND NOT EXISTS (SELECT 1 FROM platform.diagrams d WHERE d.company=m.company AND d.module=m.name AND d.version=m.live_version) AND EXISTS (SELECT 1 FROM platform.sites s WHERE s.company=m.company AND s.stage='subscribed')")).rows) {   // paid sites only; a trial draws when asked
    diagrams.generate(m.company, m.name, m.live_version).catch((e) => console.error(`diagrams ${m.company}/${m.name}:`, e.message));
  }

  const server = app.listen(PORT, () => console.log(`Anetix instance on :${PORT} (auth ${auth.OPEN ? "OPEN: no passwords set" : "on"})`));
  // a process that cannot listen must end (Railway restarts it): the guards in src/errors.js would otherwise keep it alive serving nothing
  server.on("error", (e) => { console.error(`[boot] could not listen on :${PORT}: ${e.message}`); process.exit(1); });
  require("./src/restart").graceful(server);   // SIGTERM: finish what is in flight, then go (src/restart.js)
  // does this instance have a browser for the page load every build gets (src/pageload.js)? say so in the deploy log
  require("./src/pageload").selfTest().catch((e) => console.error("[pageload] self test:", e.message));
}

main().catch((e) => { console.error(e); process.exit(1); });
