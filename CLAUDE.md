# Symbiotic OS: Workspace Guide (current as of 2026-10-13)

**This file is the single source of truth for how this repo and the live
instance are worked on.** Repo: `brf1998-code/SymbioticOS` (private). Live:
https://app.anetix.ai (and still https://sos.finnoperations.com; Railway
project `symbiotic-os`, service `SymbioticOS` + `Postgres`). The public front
door, anetix.ai, is a SEPARATE small service (the `www/` folder beside `sos/`,
its own repo and Railway service; see "Self-serve companies from anetix.ai" in `docs/FEATURES.md`).

## Shape of the instance (since 2026-09-11)

**The feature history is `docs/FEATURES.md`**: one bullet per piece (what it does, why, the decisions, the tests,
the known limits), moved there on 2026-09-28. A title in quotes in this file ("Named admin accounts") is a bullet
there. Read the bullet for anything you are about to change; add a bullet for anything new, and its title to the
index at the end of this section.

One instance hosts many **companies**. Everything is scoped by company slug:
- `/c/<slug>/` improvement board, `/c/<slug>/settings` the manager's one
  settings page (people, printers and spreadsheets, the wall sign, what
  happens when a request arrives), `/c/<slug>/agents` model choices and agent
  docs (reached from the admin page since 2026-09-20, not the board),
  `/c/<slug>/m/<module>/` live module pages,
  `/c/<slug>/staging/m/<module>/` the preview of a build (amber bar on every
  staged page, reloads/leaves when the staged version changes).
- `/admin` (admin role: a named account with an authenticator app since
  2026-09-21, see "Named admin accounts"; `SOS_ADMIN_PASSWORD` opens it only
  until the first authenticator is set up) lists companies, their modules,
  docs, spend, and adds companies or library modules to them. Its tabs since
  2026-09-28: Demos (the default), Pins, Sites, Requests, Health, Companies,
  Accounts, Instance, and More (Library, Models); a header pill shows only when
  something wants a look (see "The launch audit's Phase 2").
- Module schemas are `mod_<company>_<module>` / `stg_...` / `snap_...`. The
  first boot after this change renamed the old `mod_paperline` schema and
  moved everything under company `demo` (`src/db.js upgradeSingleTenant`).
- Feedback records the **screen** it came from (label + file, resolved from
  the module manifest's `pages` map, which now carries labels). Proposals
  carry `target_file`; the build prompt pins the change to that file; the
  cross-check fails a diff that lands on another screen. The manager can
  change the target in the Adjust form.
- Model jobs: propose / build / review / design; a company can pin the first
  three on its Agent settings page, everything else follows the instance
  (see "Two models, one baseline", 2026-09-22). The board names no model and no cost anywhere since
  2026-09-20 (the per-run override in Adjust, the batch bar's model select
  and the system review's model select are gone; the API still accepts
  `model` and falls back to the company's build model). `src/agent.js
  MODELS` is the two models on offer and `PRICE_ONLY` prices the short text
  models and Opus 5; keep both current with
  platform.claude.com/docs/en/models/overview.
- Agent docs: repo `principles/*.md` are platform-wide and read-only in the
  app; each company has editable docs in `platform.agent_docs` (COMPANY.md
  seeded, module `reference.md` seeded from `principles/module-formats/`).
  Every run records which docs it was guided by (`evidence.docs`).
- Old URLs `/m/<module>` redirect to `/c/demo/m/<module>`.
- `/api/c/<slug>/assist*` is Ask Anetix, the assistant on the board (managers only; design and research in
  `docs/ASSISTANT.md`, the bullet "Ask Anetix: the assistant on the board"). Its tools are `src/assist-tools.js`,
  the one registry the company MCP serves too; its product knowledge is `principles/HELP.md`.
- `/mcp/admin` is the admin MCP address (a connected AI app's calls, bearer token only) and `/oauth/*` the sign-in
  an app goes through to reach it, both mounted BEFORE the sign-in middleware and both a 404 until `SOS_PUBLIC_URL`
  is set (see "Connector sign-in and the admin MCP"; the design is `docs/MCP.md`). Since 2026-10-06 a connection that
  was ticked to write can start and fill in a company's new tool request and send it to the agent (`src/mcp-intake.js`,
  "The admin MCP writes new tool requests"). Since 2026-10-13 `/mcp` is the company MCP (`src/mcp-company.js`, "The
  company MCP"): a manager of a paying site (or a trial on `SOS_MCP_TRIALS`) connects their own AI app to their own
  company; it reads the tools, the board and, with the manager's records switch on, the records, and files a request
  that waits for a manager (`feedback.held`). Settings has its card, Connected AI apps; /admin has Anetix's lock.

Index of `docs/FEATURES.md`, in its order:

- The admin page is seven tabs, one job each
- System review
- Diagrams
- Version jumps
- Structured calls
- Batch tiles
- Plain summaries
- Build-agent models, Agent SDK 0.3.x (2026-09-17)
- Two models, one baseline (2026-09-22)
- Boot id
- Failed checks
- Automatic fix rounds (2026-09-25)
- Cost caps are off by default (2026-09-17)
- Pending feedback on the board
- Run diagnostics
- Module library and tours
- Repo imports no longer supersede agent work
- Reviews on the board
- Module build from a confirmed design (2026-09-17)
- Checks campaign (2026-09-17)
- Checks campaign, first export (2026-09-17)
- Cross-check calibrated (2026-09-17)
- Module gate (2026-09-18)
- Module pages are locked to their own module in the browser (2026-09-19)
- A never-approved draft cannot be switched onto the floor (2026-09-19)
- One company per session, per-company passwords (2026-09-19)
- Named admin accounts with an authenticator app (2026-09-21)
- Requests must come through Cloudflare (2026-09-21)
- Sliding sessions and trusted admin devices (2026-09-24)
- Requests to Anetix (2026-09-24)
- The test floor (2026-09-24)
- The test campaign (2026-09-24)
- The data wall (2026-09-24)
- Self-serve companies from anetix.ai: pins, credit, manager accounts with 2FA, and the www service (2026-09-25)
- anetix.ai is a wall (2026-09-25)
- The demo workflow (2026-09-25)
- Demo sign-in and the credit as a percentage (2026-09-25)
- $10 demo credit; a started build finishes (2026-09-26)
- Sample data for a demo's tools (2026-09-26)
- The AI spend meter (2026-09-26)
- Passkeys (2026-09-26)
- Demo requests (2026-09-26)
- Rebranded to Anetix (2026-09-25)
- The Demos tab: what Anetix learns from the demos (2026-09-25)
- Paid sites, stage 1: the price book and the Sites tab (2026-09-26)
- Paid sites, stage 2: Go live, as far as Signed (2026-09-26)
- Paid sites, stage 3: Activate, the rollover, the Terms (2026-09-26)
- The launch audit's C items (2026-09-27)
- The launch audit's Phase 0 (2026-09-27)
- The launch audit's Phase 1 (2026-09-27)
- Phase 2's first item: no model names and no AI costs in what a company reads (2026-09-27)
- The outside check (2026-09-27)
- anetix.ai's front page crash, and its own error guard (2026-09-27)
- The launch audit's Phase 2: cleanup, admin and the guide (2026-09-28)
- The Anetix mark (2026-09-25)
- Per-company AI budget (2026-09-19)
- Backup keeps up with the schema (2026-09-19)
- The interaction record (2026-09-19)
- Operator identity: a name and a PIN (2026-09-19)
- Close the loop, floor side (2026-09-19)
- The manager's close-out on a shipped tile (2026-09-19)
- Checks that accumulate, and a page load for every build (2026-09-19)
- Propose on arrival, with one question instead of a guess (2026-09-20)
- The AI credit glide slope, and "the AI service is out" told apart from "the build is wrong" (2026-09-20)
- Module code runs in a process of its own, with a database login of its own (2026-09-20)
- Staging is a copy of the floor's data, on purpose
- A model reads a module's files whole (2026-09-19)
- Connections, first push: spreadsheets and label printers (2026-09-19)
- Connections, second push: the ERP kind (2026-09-19)
- The ERP is admin side; the data check at review (2026-09-19)
- ERP field catalog, paging, lookup drafts (2026-09-19)
- Loop health (2026-09-19)
- Board simplified (2026-09-20)
- No model names in the module creation flow (2026-09-26)
- Phone layout of the board (2026-09-26)
- System review lives on the settings page (2026-09-26)
- A named account's requests carry its name (2026-09-26)
- Board band (2026-09-19)
- Board tiles fold (2026-09-17)
- Module creation intake (2026-09-17)
- Talk instead of typing (2026-09-24)
- Module filter (2026-09-17)
- Board layout
- Batches are server state
- Requirement gate
- Abort and orphans
- Preview highlights
- Rollback asks first
- Company brand
- Company delete
- Backup and restore
- Agent doc duplicates fixed
- Schema names
- What the platform lends a module
- Plant KPIs module
- 2026-09-27: five fixes from Brendan before the next phase of the audit (its own section at the end)
- Built with Railpack (2026-09-28)
- anetix.ai: the account first, and the principle only (2026-09-28, www repo)
- The launch audit's Phase 3, first pass: the sign-in from setup, refills checked with Stripe, the quick fixes (2026-09-28)
- The pin message is two short lists (2026-09-28)
- Changes join the preview (2026-09-28)
- Outside connections are off until Anetix turns them on, one tool at a time; integration requests (2026-09-28)
- Migrations run exactly what was checked (2026-09-28)
- Every company is the same, and a boot brings it up to date (2026-09-29)
- The first-time user round (2026-10-01)
- Connector sign-in and the admin MCP (2026-10-05)
- Price book 2 (by the tool live on the floor), the pilot offer, and the board link on every page (2026-10-05)
- Adding a manager to a company that already exists; a company added by hand on the Sites tab (2026-10-06)
- The admin MCP writes new tool requests (2026-10-06, shipped 2026-10-12)
- Safeguards for a company that keeps contract information here, and the upload scanner (2026-10-08)
- Every AI failure reaches the phones (2026-10-08)
- Ask Anetix: the assistant on the board (2026-10-08)
- Change it at the gate, Ask Anetix in demos, and the audit tools (2026-10-12)
- Notices fold into one line; switch a site on by hand, payment to follow (2026-10-13)
- The company MCP (2026-10-13)
- The outside audit 1A: sign-in fixes (2026-10-13)
- The web connection (2026-10-13)

## What this is

The product version of Brendan's operations methodology: one app per factory
that hosts an improvement board, every module (live and staged versions), and an
agent build service that turns approved floor feedback into deployed changes.
See `docs/ROADMAP.md` for the vision and `README.md` for the run-it map.

First module: **Paper Airplane Line** (`modules/paperline/`). A five-station
line making paper airplanes in 2-minute shifts. It is deliberately a working but
imperfect v1 so participants feel the improvement loop. `docs/DEMO-RUNBOOK.md`
is the facilitator script. Second module: **Plant KPIs** (`modules/kpis/`),
the manager's view of the same line over eight weeks, with Jonah.

## Two revision paths, and which one to use

1. **In-app loop (costs API money, runs on the live instance).** Floor feedback
   on a module page → the proposer reads it on arrival (or, with that
   switched off, the manager clicks Review with AI) → proposal → approve →
   agent builds a new module version into staging → manager deploys (a functionality change writes its
   requirement on the way and builds to it, with no second stop unless `SOS_REQUIREMENT_GATE=on`). This is
   what participants exercise. It only touches module files stored in the
   database (`platform.module_versions.files`). Several proposals can be
   batched into one run (`POST /api/runs/batch`); one run is active per module
   and the rest queue (`build_runs.status = queued`, kicked by `kickQueue`).
   A change approved while a preview waits at the gate is built on top of that
   preview instead (status `stacked` for the run below; see "Changes join the
   preview").
   The agent runs with `permissionMode: acceptEdits` and `IS_SANDBOX=1`
   because Railway containers run as root and Claude Code refuses
   `--dangerously-skip-permissions` as root. Its environment is an explicit
   allow-list (`agentEnv()` in src/agent.js): API key, PATH/HOME, and
   `ANTHROPIC_*`/`CLAUDE_*` only. Never spread `process.env` into it; the
   agent reads floor-typed feedback, so it must not see `DATABASE_URL`,
   `SESSION_SECRET`, passwords, or `SOS_INTERNAL_TOKEN`.
2. **Cowork revisions (free).** Brendan asks Claude here; Claude edits the repo
   and pushes; Railway redeploys. This is for platform changes (anything under
   `src/`, `public/`, `server.js`, `principles/`) and for deliberate module
   revisions. Feedback filed about the platform itself lands on the Requests
   tab of `/admin` (every company; `GET /api/admin/requests`), in the
   "Requests to Anetix" strip of the board, and under My requests of whoever
   sent it. Move it along there (Looking at it, Working on it, a word back)
   and close it with Fixed (what changed, in the floor's words) or Not doing
   this after shipping: `POST /api/admin/requests/:id/close`. The older
   `GET /api/c/<slug>/feedback/platform` (manager session) and
   `POST /api/feedback/:id/close` still work.

Local smoke test of the whole loop, in the sandbox: `SOS_OPEN=1 SOS_FAKE_AGENT=1
SOS_FAKE_DELAY_MS=4000 PORT=3999 node server.js` (the delay gives an abort
something to interrupt; the fake agent stamps a visible
`data-changed="vN"` line on the page so the preview highlight shows).

### How module versions work (read before touching `modules/`)

- The **database is the source of truth** for module versions. Version
  directories on disk (`data/modules/...`) are a cache rebuilt at boot. Railway's
  container disk is ephemeral and that is fine.
- `modules/<name>/` in the repo is the **seed source**. At boot the platform
  hashes it; a new module is imported as v1, and a changed hash is imported as
  the next version and deployed (snapshot first, migrations applied).
- So: to revise a module from Cowork, edit `modules/<name>/`, push, done. But
  if the in-app agent has built versions since the last import, the repo copy
  is behind. **Export the live version first** and edit that:
  `GET https://app.anetix.ai/api/c/demo/modules/paperline/export`
  (an admin session; admin only since 2026-09-27) returns `{files}`; write them over `modules/paperline/`,
  then make the change. Otherwise the agent's changes get superseded (they
  remain in the DB and are still rollback-able, but not live).
- **Never edit an existing migration file.** Migrations are applied once per
  schema by filename; edits to `001.sql` do nothing on the live database. Add
  `002.sql` etc. Additive only (CREATE TABLE / ADD COLUMN / CREATE INDEX /
  `INSERT INTO t (cols) VALUES (...)`). The validator (`src/migrationsql.js`)
  splits on every `;` outside quoted text and comments, rejects
  DROP/UPDATE/DELETE/SELECT/SET/ROLE/etc. as whole words outside string
  literals, and `applyMigrations` runs only the statements it validated, one
  at a time through the extended protocol (see "Migrations run exactly what
  was checked"). Never run a migration file, or text taken from one, any
  other way.
- Migration seed values (starting inventory, settings) only apply to a fresh
  database. To change them on the live instance use the module's API or SQL.

## Deploying

The Cowork sandbox cannot push to this repo (its git proxy only injects
credentials for repos attached to the session, and the SymbioticOS repo is
not), and the Mac-side Cowork VM has no network. So the push is one command
in Brendan's Terminal:

1. Claude edits files in the mounted folder `sos/` (device_bash / commit_files)
   and says what changed. Trap found 2026-09-17: `device_commit_files` with a
   `stagedPath` that was only `cp`'d into the outputs folder can write a STALE
   earlier copy of that path (the board page landed as the previous version
   while the docs beside it were current). Reliable path: `SendUserFile` on
   the file, then commit by `fileUuid`, then `md5sum` on the mount against
   the sandbox copy before telling Brendan to push.
2. Brendan runs, in Terminal:
   `cd ~/Documents/Claude/Projects/Symbiotic\ Operating\ System/sos && ./scripts/push.sh "what changed"`
   The script reads the PAT from `../pat.md` (gitignored, bare token or
   `SymbioticOS: <token>`), initializes git on first run, refuses to commit
   `pat.md`/`node_modules`, pushes `main`. Railway auto-deploys.
3. Claude watches the deploy with the Railway MCP (`list-deployments`,
   `get-logs`). Boot log shows `[registry] ...` lines for module imports.

Railway builds both repos with **Railpack** (railway.json `"builder": "RAILPACK"`,
since 2026-09-28; Nixpacks before). `railpack.json` pins Node 24 and, in sos,
installs Debian's Chromium for the page check (`deploy.aptPackages`). A system
package the product needs goes there, never in a Nixpacks file.

If a future session does have the repo attached as a source, pushing from the
sandbox works the same way (`git push` from a clone) and the Terminal step
goes away.

The cloud sandbox has npm registry access (through its proxy) and Postgres 16
(`pg_ctlcluster 16 main start`, then create user/db `sos`/`sos`), so the app
runs there from a plain `npm install`: tar the repo without `node_modules`
and `.git` in the mounted folder, stage the tarball, untar, install, boot with
`SOS_FAKE_AGENT=1`. End to end and browser suites belong in `scripts/e2e/`
IN THE REPO (since 2026-09-19; the earlier ones lived only in a session's
sandbox and the next session could not rerun them); `bash
scripts/e2e/run-all.sh` runs every suite on the database and server it asks
for and prints one line each (2026-09-24; `quick` skips the browser suites). That is also where `package-lock.json` is regenerated
after a dependency change. The `node_modules` in the mounted folder is a stale
local install from before the SDK upgrade; Railway never sees it. The
sandbox can reach api.anthropic.com but has no key, so a real agent run is
tested on the live instance; a launch test with a bogus key (init message,
tool list, 401 from the API) proves the CLI itself starts.

## Live instance env vars (Railway service `SymbioticOS`)

- `WWW_INTERNAL_URL` (http://anetix-www.railway.internal:4001) and
  `WWW_INTERNAL_KEY` (the same long random string as on anetix-www): the private
  channel Activate uses (stage 3). Unset, Activate says the channel is not set up
  and charges nothing.
- `NTFY_TOPIC` (the private ntfy topic both founders' phones subscribe to; set
  2026-09-27), `NTFY_URL` (default https://ntfy.sh), `NTFY_TOKEN` (optional):
  phone alerts (`src/notify.js`). Unset topic: nothing is sent.
  `SOS_ALERT_HOUR_USD` (15), `SOS_ALERT_COMPANY_HOUR_USD` (8), `SOS_ALERT_DAY_USD`
  (60), `SOS_ALERT_PACE_X` (3), `SOS_ALERT_PACE_MIN_USD` (15),
  `SOS_ALERT_MONTH_STEP_USD` (250): the spend alerts (`src/spendwatch.js`), 0 = off;
  alerts only, never a limit. `SOS_ERROR_ALERT_GAP_MS` (15 minutes): the gap
  between two "Product error" alerts (`src/errors.js`). `SOS_UPTIME_WATCH` (0 turns
  off watching anetix.ai, `src/uptime.js`), `SOS_UPTIME_MS` (60 s). The same
  `NTFY_TOPIC` on anetix-www sends its alerts (`www/notify.js`) and its watch of
  this product (`UPTIME_WATCH`, `UPTIME_MS` there).
- `SOS_REPRICE_DELAY_MS` (1500): how long after a tool goes live the site's fee is looked at again (`src/modprice.js`).
- `SOS_DRAIN_MS` (25000): how long SIGTERM waits for requests in flight
  (`src/restart.js`; railway.json gives 30 s). `SOS_LATE_SWEEP_MS` (180000): the
  second orphaned-build sweep after boot. `SOS_MODULE_HANG_LIMIT` (3): timeouts
  that restart a tool process (`src/runner.js`). Never set `SOS_BOOT_ID`: the
  build fence (`src/pipeline.js`) needs it to be the boot's start time.
  `SOS_EXPORT_ATTACH_MAX` / `SOS_EXPORT_ATTACH_TOTAL`: the export's file limits.
- `STRIPE_READ_KEY` (2026-09-28, the launch audit 3.7): a Stripe RESTRICTED key with one permission, Checkout
  Sessions: Read (`rk_live_...` here). With it, a refill is added only when Stripe itself backs the session
  (`src/stripecheck.js`); without it, on anetix.ai's word as before, and the Sites tab says "Refills checked with
  Stripe: no". It can charge no one; never put the anetix-www secret key here. `STRIPE_API_BASE` points it at a fake
  Stripe in tests only; never set it on Railway. `SOS_SIGNIN_TICKET_MIN` (60): how long a new demo's one sign-in
  from setup is good (`src/tickets.js`, 3.8).
- `SOS_WWW_KEY`: the shared key the anetix.ai service (`www/`) sends in
  `X-SOS-WWW-Key` on `/api/www/*` (any long random string, the same value on
  both services; unset = those routes answer 401). `SOS_WWW_URL`: the front
  door's address (default https://anetix.ai), used in the top-up link.
- `SOS_PUBLIC_URL` (https://app.anetix.ai): the instance's own address, and the switch for the MCP addresses and
  the connector sign-in (`src/mcpauth.js`). Unset, or anything but an https address with no path: every `/mcp*`,
  `/oauth/*` and `/.well-known/oauth-*` path is a 404. `SOS_MCP_REDIRECTS` (comma separated; default
  `https://claude.ai/api/mcp/auth_callback,loopback`): where a sign-in answer may be sent; `loopback` is an app on
  the person's own computer (Claude Code). An address an app asks for that is not on the list is left out (an app
  with none left is refused) and named in the log. `SOS_MCP_ACCESS_MIN` (60), `SOS_MCP_MAX_CHARS` (120000: the most text one tool answer carries),
  `SOS_MCP_CALL_DAYS` (400: how long the call log is kept), `SOS_MCP_AI_STARTS_PER_HOUR` (30: how many times an hour
  one account's connected apps may send a new tool request to the agent or ask for a design change; 0 = no limit). A connection's idle and cap windows are the admin
  cookie's (`SOS_ADMIN_IDLE_HOURS`, `SOS_ADMIN_CAP_HOURS`), a manager's connection to the company address too.
  `SOS_MCP_TRIALS` (comma separated slugs, empty by default): trials whose managers may connect an app to the company
  address anyway (a paying site always may); `anetix` first, Anetix's own company. Never a wildcard. `SOS_MCP_FILES_DAY`
  (20: requests one company's connected apps may file in a day; 0 = none).
- `SOS_SCAN_HOST` (clamav.railway.internal: the upload scanner's private address, `src/scan.js`; the service is
  `clamav` in the same project, image `clamav/clamav:stable`, a volume at `/var/lib/clamav`, `FRESHCLAM_CHECKS=4`,
  no public domain; `docs/SAFEGUARDS.md` has the setup). Unset: files are kept unscanned as before, the Instance tab
  says so in amber, and a company with "Uploads must be scanned" on gets every upload refused. `SOS_SCAN_PORT`
  (3310), `SOS_SCAN_TIMEOUT_MS` (20000), `SOS_SCAN_SWEEP_MIN` (60; 0 = no look-behind), `SOS_SCAN_RESCAN_DAYS` (7),
  `SOS_SCAN_STALE_DAYS` (3: signatures older than this are a fault). `SOS_LABELARY_URL` (the public label renderer;
  a stand-in in the tests only).
- The web connection (`src/connections.js`, "The web connection"): `SOS_WEB_SEARCHES` (8) and `SOS_WEB_FETCHES` (8),
  the most searches and pages one look-up may do; `SOS_WEB_MAX_TOKENS` (4000); `SOS_WEB_SEARCH_USD` (0.01, the search
  fee on the meter); `SOS_WEB_SEARCH_TOOL` / `SOS_WEB_FETCH_TOOL` (the server tool versions, `web_search_20250305` and
  `web_fetch_20250910`). None needs setting.
- Ask Anetix (`src/assist.js`): `SOS_ASSIST_STEPS` (8: model calls in one answer), `SOS_ASSIST_MAX_TOKENS` (1500 a
  call), `SOS_ASSIST_HISTORY` (20: earlier messages the model sees), `SOS_ASSIST_TURNS_DAY` (120 questions a person a
  day, a loop guard), `SOS_ASSIST_FILES_DAY` (20 requests sent to Reviewing a person a day), `SOS_ASSIST_TOOL_CHARS`
  (30000: the most text one tool answer carries), `SOS_ASSIST_DEMO` (`live` by default since 2026-10-12, a demo's
  answers come out of its credit; `scripted` brings back the set answers). It uses the company's propose model and the
  instance's key. `SOS_MAX_REWORKS` (5): how many times Change it may rework one build at the gate.
- `SOS_CONNECTION_KEY` (REQUIRED; any long random string, `openssl rand -hex
  32`): the key every admin's and manager's authenticator secret, every ERP
  login, every company's welcome handout and the per-company database passwords
  are under. An authenticator cannot be set up without it. Set it once and
  NEVER change it: a new value makes every authenticator unreadable (everyone
  falls back to recovery codes or an admin's reset), every stored ERP login
  must be typed again, and the tool processes' database logins are set again at
  the next boot.

`DATABASE_URL` (reference to Postgres), `ANTHROPIC_API_KEY`,
`SOS_FLOOR_PASSWORD`, `SOS_MANAGER_PASSWORD` (both only a fallback, below),
`SESSION_SECRET`, `SOS_MODEL_BASELINE` (optional: the first baseline,
`claude-fable-5-1` by default, until one is saved on `/admin#models`;
`SOS_MODEL_PROPOSE` / `SOS_MODEL_BUILD` / `SOS_MODEL_REVIEW` / `SOS_MODEL` /
`SOS_MODEL_INTAKE` are no longer read since 2026-09-22 and the admin page
names any still set), `SOS_MODEL_SUMMARY` (optional: the first model for the
short text jobs, Sonnet 5 by default, until one is saved on `/admin#models`), `SOS_ASSESS_RESUME_MS` (15000: how long after boot a head-to-head
that was running picks up again), `SOS_MAX_RUN_USD` (per
build run), `SOS_MAX_BATCH_USD` (per batch run) and `SOS_MONTHLY_CAP_USD` (the
instance's month): unset or 0 means NO cap, the default since 2026-09-17 (see
"Cost caps are off by default"; the spend alerts below stand in for a limit),
`SOS_FAKE_AGENT` (0/1). `SOS_FLOOR_PASSWORD` and `SOS_MANAGER_PASSWORD` are
only the fallback for companies created before 2026-09-19 that have not been
given their own passwords (`legacy_login`; the company list says "still on the
shared passwords"); once no company says that, both can come out of Railway.
`SOS_ADMIN_PASSWORD` opens admin only until the first admin account has an
authenticator and is refused after; it is out of Railway since 2026-09-27.
`SOS_OPEN=1` (local work only): every request an admin with no sign-in; a hosted
instance (Railway, or `NODE_ENV=production`) ignores it and says so at boot.
Since 2026-09-28 no password variables at all is NOT open (it was, until then).
A company's own AI budget is set on the admin page and lives in
`platform.companies.monthly_cap_usd`. `SOS_PAGE_LOCK` (default
`on`) is the browser policy on module pages: `report` sends it report-only
(violations show in the browser console, nothing breaks), `off` sends none;
the escape hatch if module pages ever stop after a deploy. Optional: `SOS_AGENT_EFFORT` (build agent reasoning
effort, default `high`), `SOS_PERSON_IDLE_HOURS` (168) and
`SOS_PERSON_CAP_HOURS` (720): how long a name and PIN sign-in stays on a
device (it slides, see "Sliding sessions"; `SOS_PERSON_HOURS` is no longer
read), `SOS_APPROVAL_PIN_HOURS` (12; 0 off: an approval with a name whose PIN
is older than this asks for the PIN again), `SOS_BROWSER` (default `auto`; `off` makes
every build's page load go without a browser), `SOS_CHROMIUM_PATH` (where
Chromium is, when it is not on the PATH as `chromium`), `SOS_PAGE_SETTLE_MS`
(default 1500: how long a screen is given to load its data before it is
judged), `SOS_CHECK_TIMEOUT_MS` (default 10000, per check step),
`SOS_AUTO_PROPOSE_PER_HOUR` (default 40: how many requests a company's
proposer reads on arrival in an hour; past it they wait for the manager's
button),
`SOS_REQUIREMENT_GATE` (default off since 2026-10-01: a functionality change writes its requirement and builds
straight on, the approval being the confirmation; `on` brings back the stop where the manager confirms the
requirement first, see "The first-time user round"),
`SOS_MODULE_RUNNER` (default `auto`; `process` = module code in its own
process or not mounted; `inline` = the old in-platform way),
`SOS_MODULE_TIMEOUT_MS` (30000, one module request),
`SOS_MODULE_LOAD_TIMEOUT_MS` (10000, routes.js load), `SOS_ROLE_CONNECTIONS`
(12, database connections per company role), `SOS_ROLE_STATEMENT_TIMEOUT`
(30s); `SOS_CONNECTION_KEY` now also keys the per-company database passwords,
`SOS_CONTEXT_CHARS` (default 400000: the most
module source a proposal, system review or diagram call is given; files are
whole below it, see "A model reads a module's files whole"),
`SOS_SESSION_IDLE_HOURS` (720) and `SOS_SESSION_CAP_HOURS` (4320; 0 = no cap):
the floor and manager cookie's windows, server-side, not just cookie Max-Age
(`SOS_SESSION_DAYS` is no longer read), `SOS_LOGIN_MAX_FAILS`
(default 10) and `SOS_LOGIN_WINDOW_MIN` (default 15) for the per-IP login
limiter (in-memory, address from `edge.clientIp`). Admin accounts:
`SOS_ADMIN_IDLE_HOURS` (168) and `SOS_ADMIN_CAP_HOURS` (720) for the admin
cookie (`SOS_ADMIN_SESSION_HOURS` is no longer read; take it out if it is
there), `SOS_CAMPAIGN_WATCH_MS` (5000: how often a walking test campaign's watches
are asked), `SOS_CAMPAIGN_MAX_ROWS` (200: the most rows a made-up test data set may
carry per table), `SOS_PROMPT_LOG` (a file every prompt is appended to as a JSON
line, data included: the data wall's canary test only, NEVER on the live
instance), `SOS_TRUSTED_DEVICE_DAYS` (30: how long "remember this computer"
skips the code), `SOS_ACCOUNT_MAX_FAILS` (5),
`SOS_ACCOUNT_LOCK_MIN` (15), `SOS_AUTH_EVENT_DAYS` (400), `SOS_ADMIN_2FA=off`
(break glass only), and `SOS_CONNECTION_KEY` is now REQUIRED before an
authenticator can be set up. Edge: `SOS_EDGE_SECRET` (the value the Cloudflare
Transform Rule puts in `X-SOS-Edge`), `SOS_EDGE_MODE=report` while proving the
rule, `SOS_CF_RANGES` if Cloudflare's ranges move.
Passwords live only in Railway; never commit them.

## Hard rules

- Repo is private but treat it as clean-room: no Langmuir code, data, names,
  or branding. Nothing from the Finn Operations folder either.
- No em or en dashes in anything a participant reads (pages, proposals copy,
  runbook). Hyphens in compound words are fine.
- Module pages compute `base` from `location.pathname`; never hard-code
  `/m/paperline`, the same files serve at `/staging/m/paperline`.
- The manager gate is structural: nothing reaches a live module without a
  human approval. Do not add auto-deploy paths.
- Nothing a company's people read names a model, a vendor or an AI cost: pages,
  copy, and the JSON behind them (`src/companyview.js` scrubs every `/api/`
  answer to a manager or floor session; a new cost or model key goes in its
  lists). Model names and dollars stay on the admin pages. A demo's credit is a
  percentage. A tool's code is Anetix's: its download is admin only.
- An instance is never open by accident: no sign-in at all is `SOS_OPEN=1`,
  local only, and a hosted deployment ignores it. Never make a missing variable
  mean open.
- A module's pages run under a Content-Security-Policy the platform sets
  (`registry.modulePagePolicy`), so a screen may only talk to its own module
  plus the feedback endpoint. When a module legitimately needs to reach
  something else, widen the policy there and add it to the gate's page rules;
  never let module code set its own security headers.
  Anything the policy opens is reachable by agent-written code with the
  session of whoever has the page open, a manager included. So a platform
  feature the widget needs on module pages gets routes of its own that are
  safe for any device of the company (`/who`), and its manager routes live on
  a path the policy does not open (`/people`). Never widen the policy to a
  prefix that also holds manager or admin routes.
- Every request below `auth.companyGuard` belongs to one company. A new route
  under `/c/:slug/` is scoped for free; a new route addressed by an id must be
  added to the `OWNERS` table in `src/auth.js` (its owning-company lookup) or
  it will be reachable across companies. A new route that names its company in
  the body scopes itself with `auth.ownsCompany(req, slug)`. Every id parameter
  is `:id(\\d{1,9})` (the guard reads the digits, `Number()` would read `0x10`),
  and every path test in the guard is case-blind like Express's routing (both
  holes were live until 2026-09-27; `scripts/e2e/badids.js` walks every route).
- A route never needs its own try/catch to keep the process up: `src/errors.js`
  catches a rejected async route and every stray rejection. Throw an error with
  a `status` (and words a person can read) for a caller's mistake; anything else
  becomes a 500 that names nothing inside.
- A new platform table that belongs to a company goes in `backup.js`
  `PLATFORM_TABLES` and, if it holds secrets, stays out of `platform.companies`.
- A secret, a one-time code, a recovery code or a device token is never
  logged and never returned, apart from the one enrollment answer that shows
  a person their own (and the one Set-Cookie that hands a browser its device
  token, and the one `POST /api/www/companies` answer that hands anetix.ai a new
  demo's sign-in ticket, `src/tickets.js`; a ticket opens only an account with no
  second factor, once, into the enrollment-only session). A new destructive admin action takes `auth.checkAdminCode`, and a
  trusted device never stands in for that code. A new route that moves a
  change toward the floor takes `people.requireFreshPin` after
  `requireManager`. A new admin
  route that an account with no authenticator must reach goes in
  `auth.ENROLL_PATHS`, and that list stays as short as it is. A session made from a password alone is enrollment-only
  (`startAccountSession({ enroll: true })`) and never becomes a full one; a new way to set up a first factor ends with
  `auth.finishEnrollment`, and a new way to add a further factor starts with `accounts.proveForNewFactor`. A new
  place that reads the session cookie itself checks `auth.isRevoked(sid)` and refuses `enroll`. Anything that
  throttles, locks or logs by address reads it through `edge.clientIp`.
- Module code reaches nothing but `ctx`. The module gate holds agent builds
  and repo imports to the same rule. If a library module needs something new
  (hashing, a clock, an outside system), lend it on `ctx` in
  `registry.moduleServices`; never `require` it inside the module. Run
  `node scripts/test-modulegate.js` before pushing a change to `modules/` or
  to the gate.
- A file in `checks/` is a promise to the floor. No build, repo edit or agent
  ever edits or removes one that has shipped; a change adds the next number.
  The only way a promise ends is a manager retiring it on the board
  (`platform.check_retirements`). The platform's own checks of a staged build
  run as that company's manager (`auth.serviceCookie`), never with the
  internal token: the pages and the smoke list are agent-written.
- Reading a request on arrival never moves anything toward the floor: it
  drafts, folds, asks or flags, and the manager's gate is where it always
  was. A question goes only to the person who asked (or the device that sent
  a nameless request, by its token) and to the manager; `reply_token` never
  leaves `POST /api/feedback`'s own answer. The floor's side of it lives under
  `/who/`; the manager's answer, the unlink, the switches and the credit
  routes live on paths the module page policy does not open.
- Module server code runs in a process of its own per company (option C,
  `src/runner.js`); `SOS_MODULE_RUNNER=auto` falls back to running it inline
  when the instance cannot isolate it and says so on /admin. Do not undo the
  boundary: the child's environment is one variable it deletes on read (never
  add a second), its database login is `src/dbroles.js` (a new schema or table
  the platform makes needs `dbroles.grant` called again, which mountLive /
  mountStaged / restore already do), and a request reaches it WITHOUT the
  visitor's cookies. A platform feature a module needs is lent on `ctx` over
  the fork's private channel (add it to both `registry.moduleServices` and the
  child's `services()`), never by widening what the child can reach directly.
- Outside systems are connections (`src/connections.js`): declared in
  module.json, set up on the connections page, lent as
  `ctx.connections.<name>`. A new kind gets a surface there, its settings and
  secrets in `platform.connections` (secrets encrypted), a page policy
  addition only if a device-side program must be reached, and gate rules for
  its declaration. Never let module code hold a credential, a printer address
  or a file the platform did not hand it. A connection that reaches outside
  (`connections.OUTSIDE`: erp, printer, web) is declared only once an admin has
  turned that kind on for that tool (`platform.connection_allowances`); the
  builder is told and the module gate refuses a new one that is not on. Never
  let a missing switch mean on, and a request to connect one goes to the
  integration team (`requests.handoff`), not the build loop.
- The MCP addresses and `/oauth/*` sit before the sign-in middleware, so nothing mounted there may trust a cookie,
  apart from the consent page's two calls, which check the account themselves (`mcpauth.accountOf`) and take a fresh
  passkey or code before anything is allowed. An MCP address reads a bearer token and nothing else, and never sets a
  cookie. A connector is never on by a missing variable. An admin MCP tool never returns a row
  from a company's tool, an upload, a diff, a tool's code, a secret (a pin, a Stripe id, a card, a token), or the
  words of a failed check (its kind only): a new tool gets its case in `scripts/test-mcp.js` and its call in
  `scripts/e2e/mcp.js`, where a canary row and a canary failure line must be in no answer. An admin MCP tool is read
  only unless it is marked `readOnly: false`, and the only ones that are start and fill in a new tool request
  (`src/mcp-intake.js`). A write tool runs only on a connection whose person ticked writing on the consent page
  (`who.writes`), goes through the same function the board's own route calls, writes under the account's name on the
  record, and never moves anything toward the floor: no tool confirms a design, builds, deploys, withdraws or
  deletes. An app writes only to a request Anetix started (`module_intakes.via`), and a paying site's own request is
  neither read nor taken over. What an app sends is checked for shape before it is saved. A new table that points
  at `platform.accounts` goes in `backup.js` restore's TRUNCATE list, or a restore fails.
- The company MCP (`/mcp`, `src/mcp-company.js`) is a company's own AI app: its company comes from the token, never an
  argument, and is checked again at every call (a manager of that company, the company a paying site or on
  `SOS_MCP_TRIALS`). It serves the tools of `src/assist-tools.js` with `ctx.via = "mcp"`, where `ctx.walled` means the
  manager's records switch or Anetix's lock (`mcp_reads_records`, `mcp_records_locked`), not the data wall; records
  are read through the company's read role only. It edits no row. Its one write, `file_request`, puts a request on the
  board with `held` true: no AI reads a held request's words until a manager's tap (`proposals.generateProposal`
  clears it). Anything new that hands request words to a model (a prompt, Ask Anetix, the admin MCP) leaves a held
  request's words out, and gets a case in `scripts/e2e/mcp-company.js`, where the prompt log must not carry them.
- Free text (a company's name, a person's name, an email) never goes into a quoted argument of an inline `onclick`
  with `esc()` alone: an apostrophe ends the argument and the rest runs as script. On `/admin` it goes through
  `jss()`; better still, pass an id or a slug and look the words up in what the page already holds.
- A file from outside is never kept before `scan.check` has seen it (`src/scan.js`): a new way for a file to come
  in (a photo, an attachment, a sheet, anything fetched from an address a person gave) calls it with the bytes and
  stores what it answers beside the file, or keeps nothing. Never catch its refusal and keep the file anyway.
  Nothing a company reads names the scanner. A new connection that sends a company's information outside the
  instance gets a row in the table of `docs/SAFEGUARDS.md` and, where it is a choice, a switch in
  `src/safeguards.js` that Anetix sets per company. Anything that holds a request to the plant's network reads the address through
  `edge.clientIp` and lets a named account and the platform's own loopback calls pass (`safeguards.networkGate`).
- Ask Anetix sees only what the manager could see, and the scope comes from the session: a new tool in
  `src/assist-tools.js` takes no argument that names a company, a role or a person, pins itself to the conversation's
  tool in a one-tool conversation, reads records only through `readOnly` (the company's `sos_<company>_read` role,
  READ ONLY, names checked against the tool's own tables, no free SQL), is left out by `toolsFor` when it reads records
  and the wall is up, returns typed text under `words` or `records`, and gets its case in `scripts/test-assist.js` and
  its call in `scripts/e2e/assist.js`. The assistant writes nothing but a request card; only the manager's tap files
  it, and the manager's approval in Reviewing stays the gate. Its routes stay under `/api/c/:slug/assist`, a path the
  tool page policy does not open, and it is never put on a tool's own pages. When a feature on the board changes,
  change its paragraph in `principles/HELP.md` in the same push, and run the golden questions (/admin, Health) after
  any change to the prompt, a tool's description, HELP.md or the baseline model.
- Every company gets every feature its kind gets, whenever it was made. A feature gate reads what a company is NOW
  (`src/kind.js`: a paid site or a trial), never a column fixed on the day the company was made; `companies.demo`
  means only "came in from anetix.ai with credit". Anything the platform keeps per company (a flag, a seeded row, a
  doc) that a new design changes is brought to the rule for the companies that already exist, at boot, in
  `kind.standardize()` or a step beside it, idempotent and logged. A platform update that only reaches new
  companies is not done.
