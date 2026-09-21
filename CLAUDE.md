# Symbiotic OS: Workspace Guide (current as of 2026-09-21)

**This file is the single source of truth for how this repo and the live
instance are worked on.** Repo: `brf1998-code/SymbioticOS` (private). Live:
https://sos.finnoperations.com (Railway project `symbiotic-os`, service
`SymbioticOS` + `Postgres`).

## Shape of the instance (since 2026-09-11)

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
  docs, spend, and adds companies or library modules to them.
- **The admin page is five tabs, one job each** (2026-09-21, `public/admin.html`
  plus the standard header `public/assets/admin-shell.js` and
  `admin-shell.css`; Brendan: the page had become fix stacked on fix and he got
  lost in it). The header is on every tab: the navy band, who is signed in,
  sign out, a row of status pills (AI credit, AI spend against the instance
  cap, Waiting on us = open data requests, Isolation, Edge, Sign-in; each is a
  link to the tab that holds the detail, amber or red when it wants a look) and
  the tab row, where a tab carries a count (Companies, Library) or a dot when
  something on it wants looking at. The tab in view is the address's hash, so it
  can be linked, reloaded and reached with the back button: `/admin#health`
  (the default), `#companies/<slug>`, `#companies/new`, `#library`,
  `#accounts`, `#instance`. **Health**: data requests first when there are any
  ("waiting on us"), then the fleet tiles and the per-company table; the long
  "how to read these numbers" text is folded. **Companies**: a list on the left
  (open feedback, modules, spend this month, a red line when sign-in needs
  setting) and ONE company open on the right, in sections: Go to (the links
  that left the board), Modules (open, tour, add from the library, New module),
  Sign-in, AI budget and models, Brand, Agent docs, Danger zone. Add a company
  is the last entry of the list and opens in the same pane. **Library**: see
  "Module library and tours". **Accounts**: the admin accounts, My account, Add
  an account, the sign-in log. **Instance**: AI credit and the glide slope,
  spend and default models (with each company's spend and own cap), module
  isolation, the edge check, backup and restore. Older bullets below that say
  "the top card on /admin" or "the accounts card says whether this request
  carried the header" mean these tabs: loop health is Health, AI credit and
  isolation and the edge check are Instance. No API changed apart from the
  library in `/api/admin/overview`. Every loader drops what it learned into `P`
  and calls `drawPills()`; a new instance-wide warning belongs there as a pill,
  not as another card on top of a tab. The ids the e2e suites hold on to are
  unchanged (`#health-card`, `#h-table`, `#credit`, `#credit-line`,
  `#companies .card .links`, `#accounts-card`, `#acc-list`, `#acc-events`,
  `#enroll-card`, `#edge-line`); a suite that needs a tab goes to its hash.
  An account with no authenticator still sees the setup and nothing else: the
  band without pills or tabs, `#enroll-card` outside `<main>`, and everything
  in `<main>` hidden. The shell is its own two files so the other admin-side
  pages can take the same header later (decided: /admin only for now); /assets
  is served before the login, so nothing secret goes in them.
- Module schemas are `mod_<company>_<module>` / `stg_...` / `snap_...`. The
  first boot after this change renamed the old `mod_paperline` schema and
  moved everything under company `demo` (`src/db.js upgradeSingleTenant`).
- Feedback records the **screen** it came from (label + file, resolved from
  the module manifest's `pages` map, which now carries labels). Proposals
  carry `target_file`; the build prompt pins the change to that file; the
  cross-check fails a diff that lands on another screen. The manager can
  change the target in the Adjust form.
- Three model roles per company (propose / build / review), chosen on the
  Agent settings page. The board names no model and no cost anywhere since
  2026-09-20 (the per-run override in Adjust, the batch bar's model select
  and the system review's model select are gone; the API still accepts
  `model` and falls back to the company's build model). `src/agent.js
  MODELS` is the price table; keep it current with
  platform.claude.com/docs/en/models/overview.
- Agent docs: repo `principles/*.md` are platform-wide and read-only in the
  app; each company has editable docs in `platform.agent_docs` (COMPANY.md
  seeded, module `reference.md` seeded from `principles/module-formats/`).
  Every run records which docs it was guided by (`evidence.docs`).
- Old URLs `/m/<module>` redirect to `/c/demo/m/<module>`.
- **System review** (`src/review.js`, `platform.reviews`): a whole-module
  re-baseline by a chosen model (Fable by default). Input: guidance docs, all
  live files, feedback and build history, a live-data snapshot from the
  manifest's `/api/...` smoke endpoints. Output: 3 to 12 findings, each filed
  as a held feedback item (`review_id`, status reviewing) with a draft
  proposal (class, target_file, priority in rationale). Building the approved
  set is the normal batch run. One review per module at a time.
- **Diagrams** (`src/diagrams.js`, `platform.diagrams`): after every deploy
  (`registry.hooks.deployed`) the propose model draws two Mermaid sets for the
  new version, data flows and one workflow per role, following
  `principles/DIAGRAMS.md` (the adjustable conventions file; edit it when the
  drawings are not landing). Shown at `/c/<slug>/diagrams/<module>` with a
  version selector and a manager-only Redraw button (`POST
  /api/c/<slug>/diagrams/<module>/regenerate`). Rendered client-side by
  mermaid from cdnjs; if the CDN is unreachable the page shows the source.
  Boot draws diagrams for any module version that has none.
- **Version jumps** (`registry.goToVersion`, board "Versions" panel per
  module, `GET/POST /api/c/<slug>/modules/<m>/versions|goto`): any version,
  back or forward. Switch keeps today's data (additive migrations make older
  code safe on a newer schema; newer code re-applies missing migrations).
  Restore also puts back the data snapshot taken when that version was last
  live. Every jump snapshots the current state first, so jumps are reversible.
  Snapshot retention `SOS_KEEP_SNAPSHOTS` (default 10). The Done card's Roll
  back is one restore step to the nearest older snapshot.
- **Structured calls** (`agent.runStructured`): forced `tool_choice` is
  rejected by Fable 5.1; the runner falls back to `auto` plus an instruction
  and remembers which models refuse. Review and diagram calls use a 16k
  output budget.
- **Batch tiles**: a run with several proposals renders as ONE card on the
  board (in progress and done), with the changes collapsed under "See the N
  changes", the requirement in full at the confirm step, and one "We did"
  line when deployed. The feedback items in it are folded into the tile
  while the run exists (cancel puts them back as their own cards).
- **Plain summaries** (`pipeline.plainSummary`, Haiku, ~a cent): after every
  build, a title (<= 8 words) and a one-to-three sentence "what changed" go
  into `evidence.title` / `evidence.what_changed`; the title becomes the
  version's `notes` (shown in the Versions panel) and what_changed is the
  feedback outcome and the Done card text. `SOS_MODEL_SUMMARY` overrides.
- **Build-agent models, Agent SDK 0.3.x (2026-09-17)**: every model in
  `MODELS` can be the builder, Fable 5.1 included. The old "Fable exits 1
  after its first reply" was the Agent SDK pinned at 0.1.77 (January 2026,
  before Fable existed); `package.json` now pins `^0.3.274`, which bundles
  Claude Code 2.1.274 as a native binary per platform (optional dependency
  `@anthropic-ai/claude-agent-sdk-linux-x64` on Railway) and needs
  `@anthropic-ai/sdk` >= 0.93, `zod` 4 and `@modelcontextprotocol/sdk` as
  dependencies. `package-lock.json` must be regenerated in the cloud sandbox
  (the Mac VM has no network) whenever dependencies change. `runAgent` now
  passes `tools` (the whole tool list: Read, Write, Edit, Glob, Grep and
  nothing else; the init message confirms it), `effort` (`SOS_AGENT_EFFORT`,
  default `high`, decided 2026-09-17: high everywhere) and `maxBudgetUsd` at
  three times the run cap as a far safety rail (our own estimate still stops
  the run at the cap). `agentEnv()` sets `CLAUDE_CODE_NO_MODEL_FALLBACK=1` so
  the CLI can never swap models silently, and the run records every model id
  the agent reported (`evidence.models_seen`, plus `evidence.effort`); the
  board shows a check mark after the model name when it matches and a red
  "ran on X" when it does not. A turn that ends on an API error comes back
  from this SDK as subtype `success` with `is_error`; the runner throws on it
  instead of storing the error text as the build summary. `MODELS[].agent
  === false` still works to keep a model out of builds; nothing uses it now.
  Structured calls keep the `tool_choice` fallback (Fable still rejects a
  forced tool).
- **Boot id**: `SOS_BOOT_ID` is set at process start and returned by the
  board API; the board reloads itself when it changes, so an open tab picks
  up a redeploy instead of running old page code against new data.
- **Failed checks**: a build that fails the cross-check, the tests, or the
  visual check keeps its draft staged (preview still opens). The manager can
  `POST /api/runs/:id/fix` (agent revises the SAME draft version with the
  findings; `evidence.fix_round`, max `SOS_MAX_FIX_ROUNDS` = 2),
  `POST /api/runs/:id/override` (cross-check only; runs the tests, then the
  deploy gate; `cross_check.overridden` recorded), retry from scratch, or
  cancel (which now unstages the draft).
- **Cost caps are off by default** (2026-09-17, Brendan: development mode,
  spend what the work needs). `SOS_MAX_RUN_USD`, `SOS_MAX_BATCH_USD` and
  `SOS_MONTHLY_CAP_USD` unset or 0 mean no cap; set them to bring caps back
  (per change, per batch run, per month). With no cap the runner passes no
  `maxBudgetUsd` to the SDK either; `maxTurns` (40 for a change,
  `SOS_MODULE_MAX_TURNS` 150 for a module build) is the only bound. (The KPI
  tile and the batch bars that said "no caps set" and "stops itself past"
  left the board on 2026-09-20; the admin page carries the spend.) The live instance had SOS_MAX_RUN_USD=1.50 and SOS_MONTHLY_CAP_USD=25
  as Railway variables; they must be removed or set to 0 AFTER this code is
  deployed (the old code read 0 as a zero-dollar cap).
- **Pending feedback on the board**: `act()` marks the card (greyed, spinner
  line naming the action) and a header pill until the server answers, then
  reloads. Runs in flight show the pulsing step as before.
- **Run diagnostics**: when the agent process dies, the run log gets a `diag`
  entry (model, message count, whether init was seen, stderr tail, prompt
  sizes) and the error says at what stage it died.
- **Module library and tours** (the Library tab of `/admin`,
  `registry.libraryModules`, `libraryView` in `src/feedback.js`,
  `registry.tourFor`, `GET /api/c/<slug>/modules/<m>/tour`): every SEPARATE
  module once, then the instances of it (Brendan, 2026-09-21). Two kinds of
  entry in `overview.library`. `origin: "repo"`: the repo's `modules/*` with
  description (module.json `description`), screens, migrations, smoke checks,
  tour; its `instances` are the companies that have it (live version, staged
  version, how many versions and how many built there, last change, Open and
  Start tour links), and the card can add it to a company that lacks it (the
  same `POST /api/admin/companies/<slug>/modules` as the company's own Modules
  section). `origin: "company"`: a module a company made through module
  creation; it has no repo copy, so it is an entry of its own (`key`
  `<company>/<name>`, `made_at`), what it is comes from the module.json and
  tour.json of the version on the floor (else the staged one, else v1), and it
  has one instance. Two companies that each made a module with the same slug
  are two entries, never merged; a name that is in the repo library always
  belongs to the repo entry. There is no way yet to copy a company-made module
  to another company or to promote it into the repo library; the card only
  shows it. `deployed` is kept on each entry for older callers. Start tour link
  (`/c/<slug>/m/<m>/?tour=1`). The tour engine lives in
  `public/assets/feedback-widget.js`: steps from the module's `tour.json`
  (the live version's copy if it has one, else the library copy), state in
  sessionStorage so it follows across the module's pages, spotlight ring on
  the target selector, centered card when the target is not on screen.
  PRINCIPLES.md rule 8 tells agents to keep tour.json current.
- **Repo imports no longer supersede agent work**: a changed repo module is
  imported as a new version but deploys automatically only if the live
  version is itself repo-sourced. Otherwise it is held (`module_import_held`
  event, "FROM REPO, NOT LIVE" tag in the Versions panel) and the manager
  can Switch to it. The old "export live first" advice still applies when
  the intent is to carry agent changes into the repo copy.
- **Reviews on the board**: only reviews with held items (or running, or
  failed within the hour) stay above the columns; past ones sit under "Past
  system reviews" in the Versions panel. "Build by screen" starts one queued
  run per target file for a review's held items (`buildReviewByScreen`).
- **Module build from a confirmed design** (2026-09-17, `src/modulebuild.js`,
  lane `module` in `build_runs`): Approve build on the design gate calls
  `modulebuild.startBuild(intake)`: a `platform.modules` row with no live
  version, v1 written from a **skeleton** the platform generates from the
  design (`skeleton()`: one `items` table with the thing's stages, seed rows
  from the first attached spreadsheet, a board screen with a move button per
  item, `/api/items` and `/api/stats`, a four-step tour), the design's
  `reference_md` as the module's `reference.md` doc, an approved proposal on
  the request feedback, and a run (`from_version` NULL, `to_version` 1,
  `requirement` = the reference, `evidence.intake_id`). `pipeline.advance`
  delegates the module lane here; deploy, cancel, retry, fix and override
  are the pipeline's own with two hooks (`afterDeploy`: intake and card
  done; `afterCancel`: a module that never went live is deleted again and
  the intake goes back to `confirmed`, where the card offers "Build it now",
  `POST /api/intakes/:id/build`). Build step: the agent (the intake model,
  Fable) works on the skeleton with `principles/MODULE-CONTRACT.md` (the
  files, manifest, routes signature and ctx services, migration rules and
  their two traps, base computed from location.pathname, tour shape) and
  PLAIN-WORDS.md in the system prompt, the design and the manager's own
  answers and starting rows in the user prompt (`NEW MODULE BUILD` header;
  fake mode leaves the skeleton and stamps the page). Then platform checks
  with no tokens (`validateModule`: manifest name and pages, migrations
  through the validator, routes.js loads and returns a router, tour.json,
  no hard-coded module address, no dashes); a failure is filed as a failed
  cross-check by "platform checks" so fix / retry / cancel apply. Then
  stage, cross-check (Fable, the design as the requirement, the file listing
  in diff shape from `listingAsDiff`), smoke, deploy gate ("Put it on the
  floor" on the request card, which shows `runBlock` like any card). Retry
  rewrites the skeleton; fix keeps the files. The strip shows a module with
  no live version as "being built" with only its Preview link.
- **Checks campaign** (2026-09-17 evening, docs/CHECKS-CAMPAIGN.md): Brendan
  reported functionality changes still stopped almost every time after the
  brief rewrite. Two findings and one tool. (1) The migration validator's
  forbidden-word check was a SUBSTRING match, so `updated_at`, `deleted_at`,
  `owner_name`, `granted_at`, `reset_count`, `rule_text`, `trigger_level`,
  `copy_count` and any seed text with "do" or "update" in it killed the build
  at the build step ("migration rejected"), which is what most functionality
  changes carry. Now whole words with string literals blanked out, and a word
  followed by a column type is a column (`src/migrate.js`, test cases in the
  commit). The `last_at` workaround in the kpis module is no longer needed.
  (2) Stops have five different causes and the board showed them all the
  same; `src/checks.js reasonFor` names them. (3) The checks log at
  `/c/<slug>/checks` (manager; "Checks log" on the admin company card since
  2026-09-20, before that in the board header): every run
  with its reason, the reviewer's findings and quoted evidence, and Right /
  Wrong / Unsure labels with a note in `platform.check_labels`; "Download
  the checks log" exports cases with before/after files
  (`GET /api/c/<slug>/checks/export[?labeled=1]`), and
  `scripts/replay-crosscheck.js` rebuilds each diff and runs the CURRENT
  brief (`pipeline.crossCheckCall`, a pure function now) through the API,
  printing old verdict, new verdict and agreement with the label. Tune the
  brief against labeled cases offline, not against live builds. Exit bar for
  a pilot is in the campaign doc.
- **Checks campaign, first export** (2026-09-17, docs/CHECKS-CAMPAIGN.md
  "First export"): five reviewer stops on the demo company, all Opus 5 on
  functionality changes; two right, three wrong or half wrong. Fixes: the
  build diff is `diff -ruN` (a NEW file's whole body shows; `-u` alone
  printed "Only in ...: 002.sql" and the reviewer failed the migration as
  unverifiable, run #28); the reviewer's brief carries GUARDRAILS.md only
  (PRINCIPLES.md made it fail builds for rule 9, run #31); `demote()` in
  pipeline.js turns blocking findings that are guesses ("if the underlying",
  "cannot confirm", "presumably"), housekeeping (data-changed, tour.json,
  reference.md) or cosmetic into minor with `demoted` recorded; an empty
  diff is a plain "the agent changed nothing" stop before the reviewer (run
  #32). Replay from the checks page: `POST /api/runs/:id/replay {model}`
  (`checks.replayRun`, diff rebuilt from stored versions by `diffForRun`,
  result in `platform.check_replays`, spend as ai_usage kind `replay`);
  the page shows each replay under the run with match/disagree against the
  label and "Replay every labeled case". `reasonFor` now says "deployed over
  a reviewer stop" / "cancelled after a reviewer stop" so overridden stops
  still count (`reviewer_failed`). Instance default review model set to
  Fable on Railway (`SOS_MODEL_REVIEW`); companies can still override on
  their Agent settings page.
- **Cross-check calibrated** (2026-09-17, `crossCheckSystem` in pipeline.js):
  the old brief ("fail anything beyond the requirement") never told the
  reviewer what a functionality change legitimately touches, so routes.js
  edits, new migrations and tour.json upkeep were read as violations and
  almost every functionality change failed. The brief now lists the five
  blocking conditions (requirement not met or on the wrong screen; a change
  the floor would notice beyond the ask; an existing migration edited or
  forbidden SQL; something plainly broken; a guardrail broken) and says what
  is never a violation (supporting code, new additive migrations, tour and
  reference upkeep, data-changed marks, tidy-ups, "what stays the same" is
  about behavior not files, anything unverifiable from a diff). The schema
  returns `findings` with severity and quoted evidence; the verdict is
  computed from the findings (fail only on a blocking one), never taken from
  the model's mood. The reviewer sees the lane, the target files and the
  files touched; the diff limit is `SOS_CROSS_CHECK_DIFF_CHARS` (90000) and
  a cut diff is declared as such. PRINCIPLES.md and GUARDRAILS.md ride along.
- **Module gate** (2026-09-18, `src/modulegate.js`, item 1 of the product
  review's build order). Found in the review: `registry.buildRouter` and
  `modulebuild.validateModule` load a module's routes.js into the platform's
  own process, so agent-written code ran with `process.env`, the disk, the
  network and every schema in reach (a probe module passed the platform
  checks while writing DATABASE_URL, SESSION_SECRET and the API key to a
  file), and the UI lane's "do not touch routes.js" was a line in a prompt
  with no reviewer behind it. The gate is a no-token check of a version's
  FILES that runs before anything loads them. Server files (every `.js` in
  the module, read by a small scanner that blanks comments, strings,
  templates and regex literals): only `require("./own-file.js")`; no
  `process`, `global`, `globalThis`, `eval`, `Function`, `import`, `fetch`
  and friends; no `sendFile` / `static` / `download` / `render`; no
  `.constructor` / `__proto__`; no SQL naming `platform.`, another module's
  schema, `information_schema`, `pg_` server functions, `search_path`,
  `SET ROLE`, `COPY`, `GRANT`, or CREATE / ALTER / DROP / TRUNCATE at run
  time. Layout: no package.json, node_modules, native or wasm files, links;
  `entry` stays a .js file inside the module. Lane: in a UI build only
  `pages/`, `tour.json`, `reference.md` and the labels, title and description
  of module.json may differ from the version the build started from; in any
  lane an existing migration is never edited or removed. A finding already
  present word for word in the from-version is "inherited" and does not stop
  the build (`evidence.gate.inherited`). Where it runs: `pipeline.advance`
  right after the agent finishes and BEFORE `stageVersion` (staging executes
  the code); `modulebuild.advance` before `validateModule`, and inside
  `validateModule` itself; and as a backstop in `registry.stageVersion`,
  `deployVersion` and `goToVersion` (`assertGate`), because the Versions
  panel can switch to any stored version, including a refused draft that a
  retry left behind. A version that was ever live (events
  `version_deployed` / `version_switched` / `module_imported`) is let
  through, so a rollback is never refused, and boot never refuses what is on
  the floor: it logs `[gate] ... is on the floor with code a new build would
  be refused for` instead. A stop is filed like the other platform checks
  (`step cross_check`, `cross_check.model = "platform checks"`, plus
  `evidence.gate`), the draft's text is persisted but never staged, the
  board says "The platform's own checks stopped it" with fix, retry and
  cancel and NO override or preview link (`pipeline.override` refuses
  platform checks), and the checks log counts it as "module gate". Fix
  round: the platform itself puts back the files a lane rule protects
  (`gate.restoreLaneFiles`, logged as "the platform put back: ..."), since a
  new agent session cannot know what they looked like, and the agent gets
  `gate.forAgent` wording instead of the reviewer wrapper. GUARDRAILS.md,
  MODULE-CONTRACT.md and the UI build prompt state the rules so builders do
  not trip them. Fake mode: GATECHECK in the feedback (or in a new module's
  name) makes the first attempt trip the gate and the fix round clear it.
  Tests: `node scripts/test-modulegate.js` (no database; also proves the
  library modules and the skeleton pass) and TEST-CAMPAIGN S0-74 to S0-80,
  S3-03a. **It is not a security boundary**: any text check can be got
  around. It stops the careless build and the lazily steered one; the wall is
  the process and database boundary (option C, built 2026-09-20, see "Module
  code runs in a process of its own"). The gate still runs first, so a build
  that trips a rule is refused before it is ever loaded, in either world. Still open from the
  same review, NOT covered by the gate: agent-written PAGES run in the
  manager's browser with the manager's session, so a staged preview could
  call the platform's own APIs (approve, deploy) as the manager; the fix is
  a Content-Security-Policy on module pages (`connect-src` and `form-action`
  limited to the module's own base path and the widget's endpoints). **Built
  2026-09-19, see the next bullet.**
- **Module pages are locked to their own module in the browser** (2026-09-19,
  `registry.lockDown` / `modulePagePolicy`, the page half of the 2026-09-18
  review's item 1). A module's pages are agent-written and open in the
  manager's browser with the manager's session, same origin as the board, so a
  staged preview could call the platform's own controls (approve, deploy) as
  the manager and walk around the structural gate. Everything served under a
  module mount now carries a Content-Security-Policy: `connect-src` and
  `form-action` limited to the module's own live and staged paths plus
  `/api/feedback`, `/api/c/<company>/modules/<module>/` and
  `/api/c/<company>/who` (the widget's endpoints: feedback, tours, the name
  picker); `frame-src`/`worker-src`/`object-src` none; no popups usable as a
  scriptable same-origin window. It is set on BOTH the pages the platform
  serves and whatever the module's routes answer: `lockDown` wraps the
  response so module code cannot drop or widen `Content-Security-Policy` /
  `Service-Worker-Allowed` (and the gate refuses code that tries, rules
  `header-policy`, `call-removeHeader`). The module gate also has page rules
  now (`checkPageFile`, `PAGE_RULES`): a screen naming `/api/admin`,
  `/api/proposals`, `/api/intakes` or `/api/c/`, opening a popup, framing
  another page, installing a worker, or loading anything from off the platform
  is stopped at build time with a plain reason. Proven in a real headless
  browser (`scripts/../browser-csp*.js` in the test run): the paperline and
  kpis pages, their charts, the chat and the staged amber bar all run clean,
  while a page trying to fetch the board, a deploy API, an admin API or a
  service worker is blocked by the browser. Not a wall on its own (a link off
  the page still navigates); the origin-per-module split is the real fix.
- **A never-approved draft cannot be switched onto the floor** (2026-09-19,
  `registry.goToVersion` + `wasEverLive`, the Versions panel). A build draft
  the agent wrote that never reached the floor (a check stopped it, or it was
  cancelled at the gate) can only go live through its own build's deploy gate;
  the panel marks it "NEVER APPROVED" and disables Switch, and `goToVersion`
  refuses it server-side. A version that was ever live (deploy, switch, import
  event, a deployed run, or a data snapshot) is always switchable, so rollback
  is never blocked. This closes the one path left open when the module gate
  went in: the gate stopped switching to a gate-refused draft; this stops
  switching to a reviewer-refused one too.
- **One company per session, per-company passwords** (2026-09-19, `src/auth.js`
  rewrite, trade study option B). Found in the review: the login cookie carried
  a role and no company, so any authenticated login reached every `/c/<slug>/`.
  Now the signed cookie carries role, company, a password generation and the
  issue time. `auth.companyGuard` (mounted in server.js right after
  `auth.middleware`) is the one gate: a `/c/<slug>/` or `/api/c/<slug>/` path
  must match the session's company, and an id-addressed route (`/api/feedback/:id`,
  `/api/proposals/:id`, `/api/runs/:id`, `/api/intakes/:id`,
  `/api/attachments/:id`) is looked up and must belong to it; admin passes
  everywhere; a floor or manager landing on `/` goes to its own board. The two
  body-addressed routes (`/api/feedback`, `/api/runs/batch`) scope themselves.
  Passwords: each company has its own floor and manager passwords, scrypt
  hashes in `platform.company_access` (never in `platform.companies`, which is
  read with SELECT * and handed to pages), set on the admin page (typed, or
  the platform makes up word-word-number ones and shows them once). A company
  made from the admin page gets its own at birth. `SOS_FLOOR_PASSWORD` /
  `SOS_MANAGER_PASSWORD` are now only a fallback: they open a company solely
  while its access row is `legacy_login=true`, which `ensureAccessRows()` sets
  at boot for companies that predate this change, until the admin gives them
  their own. Changing a password raises the company's `generation` and signs
  its people out. `SOS_ADMIN_PASSWORD` is unchanged (manager password doubles
  as admin when unset). Cookies from before this change (no company) are
  rejected, so everyone signs in once after the deploy.
- **Named admin accounts with an authenticator app** (2026-09-21,
  `src/accounts.js`, `src/totp.js`, the admin half of `src/auth.js`; scoped in
  the project file `claude/auth-2fa-and-network-access.md`). Until this, admin
  was one shared password, its cookie carried no generation and was never
  re-checked (an admin session could not be ended without rotating
  `SESSION_SECRET`, which signs out every plant), and the second gate on
  delete and restore was the same password typed again. Now admin is a personal
  login: `platform.accounts` (login = an email address, scrypt hash,
  `generation`, `status`, `failed_count`, `locked_until`; `role` is only
  `admin` for now and `company` is NULL, the shape managers inherit later),
  `platform.account_factors` (the TOTP secret, AES-256-GCM under
  `SOS_CONNECTION_KEY` through `connections.encrypt`, `verified_at`,
  `last_step`), `platform.account_recovery_codes` (ten, single use, sha256
  of an 80 bit code, shown once), `platform.auth_events` (who tried what from
  where; kept `SOS_AUTH_EVENT_DAYS` = 400 days, shown on /admin under
  "Sign-in log"). The tables are made by `accounts.init()` like every other
  platform table (NOT `src/migrate.js`, which is module migrations only).
  **Login**: the login page has a quiet "Anetix staff sign in" link (it opens
  by itself when the link that brought you was /admin) that shows a name box.
  A name means the account path, no name means the company password path,
  which is untouched. `POST /login {name, password}` answers `{need_code:
  true}` with no cookie when the account has an authenticator; the page shows
  the 6 digit box and sends name, password and code together (no server-side
  pending state). `src/totp.js`: RFC 6238, HMAC-SHA1, 30 s, 6 digits, steps
  -1/0/+1, constant time, vectors runnable with `node src/totp.js`. A code is
  CLAIMED with one `UPDATE ... SET last_step=$2 WHERE last_step < $2`; zero
  rows is a replay and is refused, so the same code never works twice and the
  code that signed you in does not count as a step-up. A recovery code is
  taken in place of the app's code. Five wrong passwords or codes lock the
  account for fifteen minutes (`SOS_ACCOUNT_MAX_FAILS`, `SOS_ACCOUNT_LOCK_MIN`),
  on top of the per-address throttle; an unknown name gets the same words, the
  same scrypt work and the same lock (in memory), so neither the answer nor
  the lock says which names exist. **Session**: still five parts so plant
  cookies survived the deploy; an admin cookie is `admin.*<account
  id>.<account generation>.<time>.<mac>` (`auth.signAdmin`), `verify` parses
  the id and still answers company `*`, the middleware sets `req.sosAccount =
  { id, login, name, enrolled }` and checks the account's generation and
  status on every request (ten second cache, `accounts.sessionState`), which is
  the revocation admin never had. `SOS_ADMIN_SESSION_HOURS` (12) for admin;
  floor and manager stay at 30 days. The old admin cookie (`admin.*.0...`) no
  longer verifies. An account with NO authenticator signs in with its password
  and reaches `auth.ENROLL_PATHS` only (the admin page, which shows the setup
  and nothing else, who-am-I and the two enroll calls); everything else is 403
  `enroll_required` or a redirect to /admin. **Enrollment** on /admin: a 20
  byte secret, `otpauth://totp/Anetix%20SOS:<login>?secret=..&issuer=..` drawn
  by `src/qrcode.js` plus the base32 text, one good code before `verified_at`
  is set, then the ten recovery codes once (copy, download). Refused while
  `SOS_CONNECTION_KEY` is unset (the fallback key is `SESSION_SECRET`, and
  rotating that would make every secret unreadable). **The accounts card** on
  /admin: add (the platform makes up a first password, shown once; the person
  changes it with "Change my password", which signs them out everywhere),
  switch off / on, sign out everywhere (generation + 1), reset authenticator,
  new password. Making an account, switching one on, and resetting a factor or
  a password need a fresh code from the person doing it; switching off and
  signing out do not (they are what you press when something is wrong). An
  account cannot switch itself off. Routes: `/api/admin/accounts*`
  (`accounts.router`, mounted before the platform router; the platform's
  internal token is refused there). **Step-up**: `auth.checkAdminCode(req,
  { code, password }, what)` replaced `checkAdminPassword` at company delete
  and restore; admin.html asks for the code. **The shared admin password**
  (`SOS_ADMIN_PASSWORD`, else the manager password) opens admin ONLY while no
  active admin account has an authenticator that decrypts
  (`accounts.legacyOpen`): that is how the first accounts are made, every use
  is logged `legacy_admin_password`, its session is account 0 and dies within
  ten seconds of the first enrollment, and after that it is refused with the
  ordinary "wrong password" (logged `legacy_admin_refused`). Then take the
  variable out of Railway; with it gone the shared MANAGER password goes back
  to being a manager of a `legacy_login` company (e2e mode `noadminvar`). A
  factor that cannot be decrypted (a backup restored under another key) does
  not count, so a restore to a fresh instance does not lock everyone out.
  **Break glass**: `SOS_ADMIN_2FA=off` lets an account in with its password
  alone (and a step-up takes that password), logged `break_glass` every time,
  shouted at boot and on /admin. It needs Railway, which is behind 2FA.
  **Backup**: `accounts`, `account_factors` and `account_recovery_codes`
  travel in the file (hashes and encrypted secrets; the recovery codes had to
  come too or a restore would leave one account's codes under another's id);
  `auth_events` never does. A restore leaves every generation above both the
  file's and the instance's, so a session signed out after the backup stays
  dead and every admin signs in again; a file from before accounts leaves the
  instance's accounts alone. **Module code's database logins** have no rights
  on the platform schema, so none on these tables (checked in the e2e).
  Units: `node src/totp.js`, `scripts/test-accounts.js`. End to end:
  `scripts/e2e/accounts.js` (90; plus modes `restore` 11, `breakglass` 9,
  `noadminvar` 6, commands in its header) and `accounts-browser.js` (26,
  playwright; the QR was also decoded from a screenshot and matched the key).
  Known limits: a per-account lock lets anyone who knows an admin's email keep
  that account locked (the named fix is the edge check below plus Cloudflare
  rate limiting; the lock clears itself in fifteen minutes and "Switch on"
  clears it at once); TOTP is not phishing resistant (passkeys later, and a
  passkey is bound to the domain it was made on); `OPEN` (no password
  variables at all) still makes every request admin, so never take ALL of
  `SOS_FLOOR_PASSWORD`, `SOS_MANAGER_PASSWORD` and `SOS_ADMIN_PASSWORD` out of
  Railway at once. Admin actions in the interaction record still say "Anetix",
  not the account's name (a floor-facing wording choice, left for Brendan).
- **Requests must come through Cloudflare** (2026-09-21, `src/edge.js`,
  first middleware in server.js). Railway's edge routes by host name, so a
  request sent straight to it with `Host: sos.finnoperations.com` skipped
  Cloudflare and could carry any `CF-Connecting-IP`, which is what the login
  throttle keyed on. (1) `SOS_EDGE_SECRET`: a Cloudflare request-header
  Transform Rule adds `X-SOS-Edge: <the same value>`; with the variable set,
  anything without it gets 403, apart from `/health` (Railway's health check)
  and loopback (the platform's own calls to a staged build). `SOS_EDGE_MODE=
  report` refuses nothing and counts, and the accounts card on /admin says
  whether THIS request carried the header, so the rule is proven before it can
  lock every plant out. Unset: no check. (2) `edge.clientIp(req)` is the one
  place an address is read (`auth.clientIp` is it): a request that carried the
  secret believes `CF-Connecting-IP`; otherwise `X-Real-IP` (set by Railway's
  edge) is the client unless it is one of Cloudflare's published ranges
  (`net.BlockList`, the 15 + 7 ranges checked 2026-09-21, `SOS_CF_RANGES`
  overrides); with no Railway edge in front it reads as before. Never
  `X-Forwarded-For`. Unit: `scripts/test-edge.js`. **Live since 2026-09-21,
  enforced**: the side door was real (a curl straight at the Railway edge
  answered 200 from `railway-hikari` with no `cf-ray`), the Cloudflare rule is
  "Request Header Transform Rule", hostname equals `sos.finnoperations.com`,
  Set static `X-SOS-Edge`; it was proven in report mode first (the 11 requests
  without the header were one page load in the seconds before the rule
  reached Cloudflare's edge), then `SOS_EDGE_MODE` came out and the same curl
  against `/login` answers 403 (`[edge] refused` in the deploy log). Test the
  gate against `/login`, never `/health`, which is exempt and answers 200
  forever. A variable change on Railway takes about two minutes to serve: the
  old container answers until the new one passes its health check. Seen the
  same day: Railway fills `X-Real-IP` with the VISITOR's address for requests
  that came through Cloudflare, so the range check never matches there and
  the secret is the whole gate; rotating it means changing the Cloudflare rule
  and `SOS_EDGE_SECRET` together, with `SOS_EDGE_MODE=report` set while the
  two disagree.
- **Per-company AI budget** (2026-09-19). `assertUnderCap(company)` now checks
  the company's own monthly cap (`platform.companies.monthly_cap_usd`, set on
  the admin page) against that company's own spend AND the instance cap, so one
  company running out never blocks another. Before this, `assertUnderCap` read
  `monthlySpend(null)` (the whole instance), so any company hitting
  `SOS_MONTHLY_CAP_USD` froze builds for all of them. `monthlySpend(company)`
  returns `capKind` ("company"/"instance"/null) and the board KPI shows the
  company's own budget.
- **Backup keeps up with the schema** (2026-09-19, `src/backup.js`
  `PLATFORM_TABLES`). The dump always took every table; the restore list had
  fallen behind it and skipped module intakes, attachments and the checks-log
  labels and replays. It now restores all of them, decodes bytea columns
  (attachment bytes), and includes `company_access`; an older backup with no
  `company_access` brings its companies back on the shared passwords rather
  than locking anyone out. Round-tripped in the test run.
- **The interaction record** (2026-09-19, `src/record.js`, `platform.record`,
  build order item 3). What everyone said and decided, word for word, tied to
  the build it led to and how it turned out. One insert-only table (a trigger,
  `platform.record_guard`, refuses UPDATE and DELETE; the one sanctioned delete
  is a company's own, through `record.deleteCompany`, which sets a
  transaction-local flag the trigger honours). Each row: company, module,
  kind, actor_role (floor / manager / admin / agent / platform / person),
  actor_name (the name typed with feedback; a person once operators have an
  identity), the ids it ties to (feedback, proposal, run, intake, version),
  `before`, `after`, detail JSONB. Kinds: feedback_filed, feedback_closed,
  proposal_drafted (the AI's text), proposal_edited (the AI's text BEFORE,
  the manager's AFTER: until this the edit overwrote the AI's words in place),
  proposal_approved, proposal_declined (until this a decline logged nothing),
  requirement_drafted, requirement_confirmed (before/after, edited flag),
  build_finished, build_summarized, check_verdict (the gate, the tests, or the
  reviewer, with findings), run_fixed, run_overridden, run_retried,
  run_cancelled, deployed, rolled_back, version_switched, review_started,
  review_findings, intake_answered (each answer, before/after), intake_round,
  intake_design, intake_adjusted (before/after plus what was asked),
  intake_confirmed, intake_abandoned, doc_saved (before/after), doc_deleted,
  models_changed, label_set, chat_question, chat_answer. `record()` never
  throws: a failed write logs `[record]` and the loop goes on. Read back:
  `GET /api/c/<slug>/record?kind=&feedback_id=&run_id=&limit=&before_id=`
  (manager) and `GET /api/c/<slug>/record/export` (a JSON download, linked
  as "Download the record" on the admin card; until 2026-09-20 also as
  "record" in the board header). In `backup.js PLATFORM_TABLES`, so a backup carries it and a restore
  brings it back. Data terms decided 2026-09-18: the plant owns its record,
  Anetix uses it to improve that plant, anonymized cross-plant use is an
  opt-in clause; the cross-plant copy does not exist yet, and defense tenants
  stay out of it. Which person acted is recorded since operator identity
  (`actor_person`, next bullet). Not recorded yet: a proposal's rationale edits. What it feeds next:
  per-plant memory (lessons from adjusted and declined proposals), prompt and
  brief regression, a failure taxonomy, intake tuning, the pattern library.
- **Operator identity: a name and a PIN** (2026-09-19, `src/people.js`,
  `platform.people`, build order item 2b; Brendan: build it before "my
  requests", so a request follows the person across devices from day one).
  Two layers, on purpose. The DEVICE stays signed in with the company's floor
  or manager password (`src/auth.js`) and that alone decides what the device
  may do. The PERSON is who is standing at it: picked from the company's
  names on the feedback button, proven with a PIN (4 to 8 digits, scrypt
  hash, the platform makes a 4 digit one that is never 1111 or a run), kept in
  a second signed cookie `sos_person` = `p.<id>.<company>.<generation>.<time>.
  <mac>` (HttpOnly, 12 h, `SOS_PERSON_HOURS`). `people.attach` (after
  `companyGuard`) sets `req.sosPerson`, `req.sosPersonId`,
  `req.sosPersonRole`, only when the person is active, the generation
  matches and the person's company is the session's company. Nothing requires
  a person: a device with nobody signed in works as before. The role on a
  person (floor / lead / manager) is a label for now; it grants nothing.
  Five wrong tries lock a name for five minutes; a new PIN or a switch-off
  bumps the generation and signs the person out everywhere within ten
  seconds (a small in-memory cache). What it changes: feedback is filed with
  `person_id` and the person's name whatever was typed; `record.actor(req)`
  carries the person, so every manager and floor action in the interaction
  record says who (`actor_name`, `actor_person`). Routes, split on purpose:
  `/api/c/<slug>/who` (GET names + me, POST `/who/sign-in`, `/who/sign-out`)
  is the picker, open to any device of the company; `/api/c/<slug>/people`
  (GET the full list, POST add, `/:id/pin`, `/:id/active`) is the manager's
  list (`requireManager`). A module page's browser policy opens `/who` only,
  so agent-written code running in a manager's browser cannot add a person or
  reset a PIN (proven in a headless browser). Pages: `/c/<slug>/people`
  (manager; a PIN is shown once), the picker inside
  `public/assets/feedback-widget.js` (`window.sosPerson = { me, people, open,
  refresh, onChange }`, a digit pad that works on a tablet; its keyboard
  listener exists only while the pad is open and never touches the page's own
  handlers), the person chip in the board header. Record kinds: person_added,
  person_pin_reset, person_switched_on, person_switched_off,
  person_signed_in. `people` is in `backup.js PLATFORM_TABLES` and in company
  delete. Unit: `node scripts/test-people.js`. Not yet: "my requests", asking
  the reporter a question, fixed it / not quite (the next push, which this is
  the ground for; shipped in the next bullet); handing the person to module
  code on `ctx` (the paperline station still has its own operator box);
  per-person rights.
- **Close the loop, floor side** (2026-09-19, `src/closeloop.js`, build order
  item 6, first half; Brendan: floor side first, and "not quite" asks what is
  still off and files it linked). Until this a request left the floor and
  nothing came back, and the platform never learned whether a change fixed
  anything. Three pieces, all on the feedback button. (1) My requests: the
  signed-in person's own requests, each with one plain line from
  `closeloop.stateOf` (on the board / the manager has a proposal / waiting on
  data from the office / approved, being built / built, the manager is
  checking it / live, did it fix it? / fixed / not quite / declined with the
  manager's reason / taken back off). A stopped build is "being built" to the
  floor; ERP words never appear. (2) What went live: `pipeline.deploy` stamps
  `feedback.shipped_version` and `shipped_at` (`rollbackRun` clears them);
  `GET /api/c/<slug>/who/news?module=` lists the last 14 days of shipped
  requests by version with the plain summary and who asked. The widget turns
  the reload after a deploy into "New here: <summary>. Maria G asked for
  this." (once per device per version, `localStorage sos.seen.<co>.<mod>`; a
  device that was never there is not told old news; a deploy with no request
  behind it keeps the plain "updated" banner). The person who asked gets a
  card instead: their words, what was built, "Did it fix it?" with Fixed it /
  Not quite / Later. The card opens once per sitting; after that, or after
  Later, it is a small amber pill beside the feedback button, so it never
  sits on top of the work, and My requests carries a "1 to check" badge
  until they answer. (3) The answer:
  `POST /api/c/<slug>/who/requests/<id>/answer` `{ answer: fixed | not_quite,
  what }`. Only the person who asked may answer; a request filed with nobody
  signed in may be answered by any signed-in person (the record says who).
  Fixed may later become not quite, once; not quite is final. Not quite needs
  words and files them as a NEW feedback row (`follow_up_of` = the original,
  same module, page, screen, the person's name and id), so it goes round the
  same loop with the manager's gate intact; the original stays shipped with
  `floor_answer`, `floor_answer_at`, `floor_answer_person`, `floor_answer_by`.
  The proposer is told (`closeloop.followUpContext`, added to the prompt in
  `generateProposal`): which request this follows, the first words, what was
  built and is live, and to close the gap without starting over. The board:
  a follow-up card carries an amber "Follow-up to #N: not quite" line with
  the first words; a shipped card says "<name> says: fixed it" / "not quite.
  The follow-up is #N" / "has not said yet" (single cards and inside a batch
  tile). Record kinds: floor_fixed, floor_not_quite (before = "fixed" on a
  change of mind, after = the words, detail.follow_up_id), and the
  follow-up's own feedback_filed carries detail.follow_up_of. Loop health:
  `answers` = fixed, not_quite, went_live, unanswered, unanswered_named,
  fixed_share, follow_ups_open; a tile ("fixed it, says the floor") and a
  line in the Shipped cell on /admin. A not quite is the miss signal; with
  the quiet stretch it is what says a cheaper build model is or is not good
  enough. All three routes sit under `/who/` because the widget calls them
  from module pages; they do no more than `/api/feedback` already lets a page
  do (read the signed-in person's own requests, file a request under their
  name), and nothing they file reaches the floor without the manager. Fake
  mode: the fake proposer's rationale says "Follow-up context received for
  request #N." when the context arrived. Units: `scripts/test-closeloop.js`,
  the `answers` cases in `scripts/test-health.js`. Not yet at the time (manager side of
  item 6): a clarifying question to the reporter, and nothing proposed a
  follow-up on arrival; both built 2026-09-20, see "Propose on arrival". The
  manager's own answer is the next bullet;
  emails to the manager are OFF the plan (Brendan, 2026-09-19).
- **The manager's close-out on a shipped tile** (2026-09-19, `src/closeloop.js`
  `managerAnswer` / `mayCloseOut`, the manager side of item 6 as Brendan
  redirected it: no emails for every change, "they will get so annoyed"; keep
  the floor's card; give the manager one small button on the tile). A shipped
  tile (status done, `shipped_version` set, not rolled back, a module's own
  request) shows a manager, while NOBODY has said anything about it, a small
  green "Done" button and a quiet "a little left" link, and nothing else asks
  the manager anything. Done (`POST /api/feedback/:id/closeout {answer:
  "done"}`, `requireManager`): `feedback.manager_answer` = done with
  `manager_answer_at`, `_person`, `_by` (the signed-in person's name, else
  "The manager", "Anetix" for an admin); the tile shows a check mark and
  "Done. Thank you, <asker>."; the asker's My requests line is state
  `thanked`: a check mark and "<who> marked it done. Thank you for sending it
  in.", with a quiet green "N done" badge on the My requests link until that
  device has opened the list once (`localStorage sos.thanked.<co>`; never a
  pop-up). Done stops the "Did it fix it?" card and pill from coming back for
  that request (the news items carry `manager_answer`, `to_answer` leaves it
  out) but the asker keeps a quiet "Actually, not quite": the manager can
  close a request, not speak for the floor. A little left (`{answer:
  "little_left", what}`, words required): files the words as a NEW feedback
  row tied to the original (`follow_up_of`), same module, page, screen and
  target, under the manager's name; the original stays shipped and says
  "<who> says: a little left. The follow-up is #N."; the floor is no longer
  asked about the original (`mayAnswer` false; a second follow-up would be a
  duplicate); the follow-up's card says "Follow-up to #N: a little left" (the
  board query sends `follow_up_origin`, the original's `manager_answer`) and
  the proposer is told the manager said it (`followUpContext`, same marker
  sentence). Refused in plain words: not live through a build, rolled back,
  the floor already answered (the tile already says so), answered twice. On a
  batch tile each request in "See the N changes" has the pair, the list now
  stays open across the 4 s redraw (`OPEN_BATCH`), and with two or more open
  requests the tile has one "Done, all N" (`closeOutAll`, one call per
  request). The inline "What is left?" box pauses the reload (`EDITING =
  "left:<id>"`). The route is id-addressed (covered by `OWNERS` in auth.js)
  and sits under `/api/feedback/<id>/`, which the module page policy does NOT
  open (it opens `/api/feedback` exactly), so agent-written code on a module
  page in a manager's browser cannot close a request out (proven in a
  headless browser). Record kinds: manager_done, manager_little_left (after =
  the words, detail.follow_up_id), and the follow-up's feedback_filed carries
  detail.by_manager. Loop health `answers`: manager_done,
  manager_little_left, `unanswered` now means nobody has spoken (floor or
  manager), and met / missed / met_share count each request once (a miss is
  the floor's not quite or the manager's a little left); the floor's own
  `fixed_share` is untouched. Units: `scripts/test-closeloop.js`,
  `scripts/test-health.js`. End to end, IN THE REPO this time:
  `scripts/e2e/closeout.js` (API, 50 checks) and
  `scripts/e2e/closeout-browser.js` (playwright, 26 checks), both against a
  server already up in fake mode on a fresh database (header of closeout.js
  has the one command; `scripts/e2e/lib.js` is the cookie-keeping client,
  `person()` and `ship()`).
- **Checks that accumulate, and a page load for every build** (2026-09-19,
  `src/acceptance.js`, `src/pageload.js`, `pipeline.runChecks`, build order
  item 7; Brendan: a real browser with a fallback; the manager may retire a
  promise, with a confirm). Found in the review: `test_run` and `visual_check`
  were "the page answers below 500", so a 404 passed, the UI lane had no check
  past the module gate, and nothing a build promised was ever checked again.
  Now both steps (and the module lane's test step) are `runChecks`:
  (1) `smokeCheck`: `/` and module.json's `smoke` paths answer BELOW 400,
  asked as that company's own manager (`auth.serviceCookie`), never with the
  internal token (the list is in module.json, which a build may have written;
  the paths go through `acceptance.pathProblem`). A path the floor's version
  ALSO lists and answers the same way is not held against the build; a path
  the build added has to answer. A redirect to /login is a loud platform
  fault, never a pass. (2) Acceptance checks: `checks/NNN-short-name.json` in
  the module's own files, "call this, expect that" (GUARDRAILS.md "Checks" is
  the format and the builder's rules: 1 to 12 steps, `call` or `page`, `as`
  manager or floor, `expect` status / json as a SUBSET with `$type $gte $lte
  $gt $lt $in $regex $exists $length $minLength $contains $every $not` /
  contains / lacks, on a page also visible / selector, `save` and `{name}`).
  A functionality build is told to leave ONE new check built from "how we
  will know it works"; a UI build adds none; a new module's skeleton carries
  `checks/001-the-list-answers.json`. EVERY check of the staged version runs
  against the staged mount on every build of every lane. A check is a promise:
  the module gate refuses a build that edits or removes an existing one
  (`lane-check-edited`, put back by the platform in a fix round, like
  migrations) and refuses an unreadable one (`check-format`). The check that
  came with THIS change failing (`kind: own_check`) goes back to the agent,
  which may edit it; one an EARLIER change left behind failing (`kind:
  promise`) is the manager's call: send it back (the agent is told never to
  touch that file) or retire it, `POST /api/runs/:id/retire-check { file,
  reason }` (`pipeline.retirePromise`: only a promise this build broke, only
  while this build still has the preview; row in `platform.check_retirements`,
  never in the file, so an agent cannot retire anything; record kind
  `promise_retired`; the same build is checked again at once). A retired check
  is skipped for that company's module from then on. `acceptance.originOf`
  finds the request a promise came with (first version carrying the file, the
  run that built it). Checks may write rows: they run on the staging copy and
  `registry.resetStagedData` puts the preview back to a fresh copy of the
  floor's data afterwards, pass or fail. (3) The page load: every screen in
  the manifest (a `:param` takes its value from a smoke path that fits, else
  1) is opened in headless Chromium through `puppeteer-core` with a MANAGER
  session for that one company, requests to anything but this instance
  refused. Stops: the screen answers 400 or more, an uncaught script error or
  unhandled rejection, one of the module's own calls answering 500 or more.
  Notes only: a 4xx on a call, console.error, an error thrown from the
  platform's own `/assets/` scripts. When a staged screen shows a problem the
  same screen is opened on the LIVE version and a problem already on the floor
  word for word (mount, line numbers, versions and timestamps taken out) is
  not held against the build. No browser (`SOS_BROWSER=off`, none found, will
  not start, dies halfway, or is sent to /login): the static look instead
  (every inline script parsed with `vm.Script`, every screen asked for); the
  run log and the gate line say which way it looked. Boot logs one
  `[pageload]` line saying whether the browser starts. Chromium comes from
  `nixpacks.toml` (`nixPkgs = ["...", "chromium"]`; Railway builds this repo
  with Nixpacks because railway.json says so, whatever the service settings
  show); found on the PATH or at `SOS_CHROMIUM_PATH`; it runs `--no-sandbox`
  because the container is root (agent-written page code in an unsandboxed
  renderer; the browser here is the platform's own check, not a place module
  code runs, and module code itself is now isolated, see option C). Evidence: `evidence.checks = { ok, kind, detail, smoke,
  acceptance: { total, passed, added, retired, wrote, failed: [{ file, title,
  new, steps, origin }] }, pages: { mode, screens, problems, inherited, notes,
  fell_back } }`; `test_run` / `visual_check` keep `{ ok, checked }`. Errors
  keep their prefixes ("internal tests failed:", "visual check failed:") so
  health counts them as tests; `health.testStopKind` and `checks.reasonFor`
  tell them apart (broke an earlier promise / its own check failed / a screen
  broke on opening / an endpoint did not answer). Fix rounds: `fix()` builds
  the agent's findings from the checks (`checksForAgent`,
  `evidence.findings_from = "checks"`, worded as the platform, not as a
  reviewer); override stays for a reviewer's opinion only. Board: a stopped
  build leads with the promises in their own words and the request each came
  with, a Retire button per promise (confirm, then a reason), everything else
  folded under "and N more things the checks found" and the detail under
  "what the check saw" (do not overload the manager); the gate shows one line,
  "checks passed: N endpoints answer · N promises kept (N new) · N screens
  opened"; the Versions panel has "What this tool promises"
  (`GET /api/c/<slug>/modules/<m>/checks`, manager). A functionality build
  that leaves no check is NOT stopped; the run log says so. Record kinds:
  check_added, promise_retired, check_verdict with `detail.kind`. Loop health:
  `builds.test_stops`, `checks_added`, `promises_retired`. `check_retirements`
  is in the backup and in company delete. The library modules carry their own
  checks (paperline 3, kpis 2), so their repo hash changed: a company whose
  live version is repo-sourced gets them at boot, one whose live version is
  agent-built sees "FROM REPO, NOT LIVE" in Versions (existing behavior).
  Fake mode markers, first attempt only, cleared by a fix round: BREAKPAGE,
  BREAKSYNTAX, BREAKPROMISE, BADCHECK, BADSMOKE, EDITCHECK, NOCHECK. Units:
  `scripts/test-acceptance.js`, `test-pageload.js`, gate and health cases.
  End to end in `scripts/e2e/`: `checks.js` (48), `checks-browser.js` (18,
  playwright), `checks-nobrowser.js` (7, run twice: browser off, browser that
  will not start). Known limits: a check is as good as the agent that wrote
  it (read the first live ones, S1-14); staging sequences are the floor's
  (`LIKE ... INCLUDING ALL`), so a check that inserts rows leaves gaps in the
  floor's ids; a check must not call a route that prints or asks an AI
  persona (guidance only, nothing enforces it); UI builds cannot add checks;
  with no browser an error that only happens when a script runs gets through.
- **Propose on arrival, with one question instead of a guess** (2026-09-20,
  `src/arrival.js`, `proposals.generateProposal(id, opts)`, build order item 8
  built together with the clarifying question left over from item 6, because
  both live in the proposer's one call). Until this a request sat under
  Feedback until a manager pressed "Review with AI", the operator could only
  type, a manager tallied repeats by eye, and ambiguous words got a guess. Now
  `POST /api/feedback` ends with `arrival.start(id)`: `claim()` is awaited (so
  the answer already says `arrival: "proposing"` and a button pressed in the
  same instant gets 409 "being drafted right now"), `work()` runs behind the
  response, one call at a time per company and module (`inOrder`), so a repeat
  sent a second later is read after the first. The ONE proposer call may now
  come back four ways (schema fields `triage`, `duplicate_of`, `triage_note`,
  `question`, present only when that outcome is allowed): **a proposal** (the
  ordinary case: the draft is on the card before the manager looks; an earlier
  undecided draft of the same request becomes `superseded`); **a duplicate**
  of an open request of the same tool (`arrival.candidates`: open, not itself
  folded, lower id, at most 40, each with its words and any drafted proposal):
  `linkDuplicate` sets `feedback.duplicate_of`, the root's `recurrence` is
  recounted, the board folds the row into the root's card ("Asked 4 times by 3
  people", `arrival.tally`, the other wordings under it, a manager-only "not
  the same" = `POST /api/feedback/:id/unlink`, after which it is proposed
  ALONE so it cannot be folded straight back), and a database trigger
  (`platform.feedback_dupes_follow`) keeps a folded row's status, outcome,
  shipped version and the manager's close-out in step with its root, so when
  the root ships everyone who asked gets "Did it fix it?" and answers for
  themselves, a decline reaches everyone with the reason, and Done thanks
  everyone (close-out on a folded row is refused; `closeloop`'s reads join
  proposals and runs through `COALESCE(duplicate_of, id)` and My requests says
  "The same thing as request #N, so it was added to it."); **a question**:
  only when the words can be read two ways that lead to different changes and
  the source does not settle it, one plain question with two or three answers
  to tap (`arrival.cleanQuestion`: two to three distinct short options, and
  the text must pass `plainwords.check`, else it is dropped with a log line
  and the proposal stands), stored in `feedback.question`, NO proposal yet.
  It goes to the person who asked, on the screen they are standing at (the
  widget looks every 3 s while the proposer is reading what this device sent,
  two minutes at most, and on every page load) and in My
  requests (state `question`, counted in the "to check" badge), and to the
  manager's card (answer buttons, "answer in my own words", "Propose anyway").
  Whoever answers first wins (`arrival.answerQuestion`, one conditional
  UPDATE), the proposal is then drafted with the answer in the prompt, and
  there is one question per request, ever. Who may see or answer:
  `arrival.mayReply`: the signed-in person who asked; for a request sent with
  nobody signed in, the device that sent it, by the request's `reply_token`
  (returned once to the sender, kept in `localStorage sos.ask.<co>` for 48 h,
  never sent to the board or any other page). **A flag**: `not_this_tool` or
  `new_tool` with one sentence for the manager, who can "Propose anyway" or
  decline. What the person points at and a photo ride along in the same POST
  and go to the PROPOSER: "Point at it" puts a glass pane over the page (the
  page itself is never pressed; `elementFromPoint` under the pane), and sends
  tag, id, classes, text, label, a short path, the first 400 characters of
  markup and the box (`arrival.cleanElement` cuts it down again server side,
  `elementLine` words it for the model); "Add a photo" scales to 1600 px JPEG
  on the device, the body limit is 6 MB for exactly `POST /api/feedback`, the
  server takes jpeg, png or webp up to 4 MB into `platform.attachments`
  (`feedback_id`; `SOS_PHOTOS_PER_DAY`, default 300 a company, past it the
  words still go through), and it goes to the model as an image block
  (`arrival.photoBlocks`). The manager's card keeps ONE quiet line ("pointed
  at ... · photo"). Guards: per-company switches on the Agent settings page
  (`companies.auto_propose`, `allow_photos`, `POST
  /api/c/<slug>/agents/arrival`; off = the old board, and the button still
  sorts and folds); `SOS_AUTO_PROPOSE_PER_HOUR` (default 40 requests a company
  an hour, past it requests wait for the button and the log says so); the
  company budget and instance cap as for any proposal; a failure of any kind
  leaves the request exactly as before this existed (`arrival: failed`, the
  button works); a call in flight at a restart is reset at boot. The button
  ("Review with AI" / "Propose anyway") passes `force` when the proposer has
  already read the request, and `datacheck.reproposeFeedback` always does: no
  sorting, no question, a proposal. Spend for a call that did not end in a
  proposal goes to `ai_usage` kind `triage`. Routes, split like `/who` and
  `/people`: `GET /api/c/<slug>/who/question?id=&token=` and `POST
  /api/c/<slug>/who/requests/<id>/reply` are open to module pages and answer
  only the asker (404 / 403 for anyone else, token or not); the manager's
  `POST /api/feedback/<id>/answer` and `/unlink` sit under the id-addressed
  path the page policy does NOT open (proven in a headless browser, with the
  switches and the credit routes). Record kinds: duplicate_linked,
  duplicate_unlinked, question_asked, question_answered (detail.via = asker |
  device | manager), request_flagged, arrival_settings; proposal_drafted
  carries on_arrival, with_answer, pointed, photos. Loop health: `arrival` =
  proposed, duplicates, questions, answered, answered_by_manager,
  waiting_answer, flagged, unlinked (the Filed cell on /admin); a folded
  request is not an open item of its own. Fake mode markers in the feedback:
  DUPE (the first open request listed), ASKME, ASKMEBADLY (a question that
  fails the plain-words check), NOTTHISTOOL, NEWTOOL, FAILPROPOSE, CREDITOUT;
  `SOS_FAKE_PROPOSE_MS` makes a fake proposal call take that long. Units:
  `scripts/test-arrival.js`. End to end: `scripts/e2e/arrival.js` (89, plus
  the guard, slow and restarted modes in its header) and
  `arrival-browser.js` (38); the older suites take the draft left on arrival
  through `proposalFor` in `scripts/e2e/lib.js`. Known limits: whether the
  REAL proposer folds, asks and flags well is unread (S1-15: read them, and
  keep wrongly folded wordings for the brief); every request now costs a
  proposal call; the question reaches a nameless sender only on the device
  that sent it; a photo is kept in the company's database with no retention
  rule yet; the element's markup can carry whatever text was on the screen.
- **The AI credit glide slope, and "the AI service is out" told apart from
  "the build is wrong"** (2026-09-20, `src/credit.js`, the top of the Loop
  health card on /admin). Why: live run 38 died after 170 messages with
  "Credit balance is too low", nothing had warned of it, and the manager's
  card showed the raw API message as if the build were at fault. Anthropic
  does not hand a key its balance, so the ADMIN enters it (`platform.ai_credit`,
  `POST /api/admin/credit { balance_usd, autofill, note }`); from there the
  platform subtracts its own spend since (the same five sources as
  `monthlySpend`), takes the burn from the trailing seven days (fewer when the
  instance is younger) and projects the day the balance reaches zero:
  "About $36.30 left, burning $4.74 a day (5 day average): runs out around
  Sep 28, 7.6 days from now", with the slope drawn under it (solid from the
  entered balance to today, dashed to zero; `slopeOf`). Amber under 7 days,
  red under 3, never an alarm for a low balance once "autofill is set up" is
  ticked (Brendan: autofill when live). Spend by anything else on the same key
  is invisible here, so the line says "about" and a fresh number re-anchors it.
  `credit.classify(message)` tells credit / key / busy from everything else;
  `pipeline.failRun`, the proposer on arrival and the Review button call
  `credit.noteFailure` (event `ai_unavailable`, shown red on /admin "and
  nothing has worked since" until any AI call succeeds or a balance is
  entered), the run gets `evidence.ai_unavailable`, the manager's card and the
  button read `credit.plain(kind)` ("The AI service was not available ...
  Nothing is wrong with your request and nothing reached the floor"), the
  checks log says "AI service unavailable" and loop health counts it as stop
  kind `ai`, NOT as a gate, reviewer or test stop (so it never resets the
  quiet stretch that decides on a cheaper build model). `project()` and
  `slopeOf()` are pure: `scripts/test-credit.js`. `ai_credit` is in the backup.
- **Module code runs in a process of its own, with a database login of its
  own** (2026-09-20, `src/runner.js`, `src/runner-child.js`,
  `src/runner-probe.js`, `src/dbroles.js`; tenancy trade study option C, build
  order item 9). The review's largest finding: `routes.js` is written by a
  build agent from words typed on a floor, and the platform `require`d it into
  ITS OWN process, where `DATABASE_URL`, `SESSION_SECRET`, the API key and
  every company's schema and files were one expression away. The module gate
  (a text check) narrows a careless or steered build; it is not a wall. This
  is the wall. Each company gets two child processes, `live` (the code a
  manager approved) and `staged` (a preview nobody has approved yet, up only
  while a preview exists), each started (a) as an unprivileged user of its own
  when the platform runs as root, one per company and lane, the two of a
  company sharing a group and the company's module folder closed to every
  other group; (b) with an environment of ONE variable (`SOS_RUNNER_BOOT`),
  which the child reads and deletes at once, so module code that looks at
  `process.env` finds nothing of the platform's; (c) under Node's permission
  flags where this Node has them (files readable only under the company's
  module folder and the app's `node_modules`, no child processes, no workers,
  no native add-ons); (d) with a database login of its own (`src/dbroles.js`):
  the live role reads and writes only its company's `mod_<company>_*` tables,
  the staged role reads the floor and writes only `stg_<company>_*`, so
  UNAPPROVED code cannot change a row on the floor. No CREATE/ALTER/DROP/
  TRUNCATE, no other schema, no `platform.*`, no another company, no files,
  no `SET ROLE`. Passwords are never stored: an HMAC of the role name under
  `SOS_CONNECTION_KEY` (else `SESSION_SECRET`), set again at every boot, so a
  rotated secret heals. The platform keeps everything else in its own process
  and stays the owner of every schema and the only one that migrates, clones,
  snapshots and restores (it calls `dbroles.grant` again after each, because a
  new table carries no rights). A request under a module mount is checked by
  sign-in, the company guard and the page policy FIRST (`registry.attach`),
  then handed to the child over a unix socket in a folder only that child's
  user can enter, WITHOUT the visitor's cookies (the child gets role, person,
  device as headers, never the session), guarded by a per-process token; the
  child's answer returns under the platform's headers minus any Set-Cookie (a
  tool cannot set a cookie or a CSP on the platform's address). What the
  platform lends (`ctx.connections`, `ctx.ai`, `ctx.agentDoc`, `ctx.peer`) is
  asked for over the fork's private channel and answered for the company that
  channel belongs to, whatever the child claims; `ctx.peer` reaches only the
  company's own sibling tools. Also gained: a module that throws, leaks or
  loops takes down one company's lane, not the instance (`request timeout` =
  504 then a liveness ping ends a stuck process, which restarts on its own; a
  crash restarts, with a 30 s back-off after five crashes in a minute); the
  "does routes.js load" check of a new module runs in a THROWAWAY process
  (`runner-probe.js`) with an empty environment and a time limit
  (`modulebuild.validateModule`), so a build whose `routes.js` loops at load
  no longer hangs the platform. `SOS_MODULE_RUNNER`: `auto` (default: a
  process of its own when the instance can do it, `selfTest()` finds out at
  boot and says so in the log and on `/admin`, else the OLD way inline and
  `/admin` says THAT in red, so the floor never goes dark because of this
  file), `process` (own process or the module is not mounted, for an instance
  holding a second company's real data), `inline` (the old way on purpose, for
  local work without root or Postgres role rights). Deploy-day safety net
  (`auto` only, `registry.bootNet`): a tool on the floor that answers 500 from
  its own process on one of its own smoke paths goes back inside the platform,
  loudly (`module_kept_inline`, listed on `/admin`), until someone looks. The
  unit of isolation is company and lane on purpose: two tools of one company
  already read each other through `ctx.peer` and one manager approves both.
  Env: `SOS_MODULE_TIMEOUT_MS` (30000, per request), `SOS_MODULE_LOAD_TIMEOUT_MS`
  (10000, routes.js load), `SOS_ROLE_CONNECTIONS` (12, per role),
  `SOS_ROLE_STATEMENT_TIMEOUT` (30s). Tables: `platform.runner_ids` (the user
  id per company; in `backup.js`? no, it is instance-local, so it is NOT
  backed up and is remade at need). Boot logs one `[runner]` line; company
  delete drops the processes, both roles and the ids (`runner.deleteCompany`).
  What only the live instance can settle, and the boot log now reports: whether
  Railway's Postgres user may make roles, whether the container lets a child
  run as another user, whether the app folder is readable to that user.
  Sandbox spike and full suites proved the three locally. Units:
  `scripts/test-runner.js` (role names, grants, header stripping, permission
  flags). Boundary: `scripts/e2e/runner-hostile.js` (37, needs Postgres and
  root): hostile `routes.js` loaded straight into a company's process, then
  every reach tried, the environment, another company's tables and files, the
  platform's tables, a Pool it builds by hand, the visitor's cookie, another
  tool's channel, a crash and an endless loop. Every e2e suite reruns green in
  process mode; `inline` reruns green too. Known limits: the wall is only as
  good as the container and the Postgres user (all three checks must read
  green on Railway, S1-17); the roles share one database, so a role that could
  exhaust connections is bounded by `CONNECTION LIMIT`, not partitioned; a
  company's two tools still share a login and a process by design; the API key
  is still one for the instance (per-company keys were cancelled 2026-09-20,
  billing is per iteration now).
- **Staging is a copy of the floor's data, on purpose** (decided 2026-09-19,
  closing the 2026-09-18 review finding "previews show real rows").
  `migrate.cloneSchema` copies structure AND rows from the live schema into
  `stg_<company>_<module>` for every build. Kept because: the copy never
  leaves the company's own database; the build agent has no database access
  (its tools are Read, Write, Edit, Glob, Grep on files); a preview with real
  rows is what lets a manager judge a change; and the acceptance checks run
  against realistic data. What does leave the instance is separate and
  smaller: a system review sends a snapshot of the smoke endpoints' answers
  to the model (`review.js`). Revisit for a tenant whose contract forbids
  even that, not before.
- **A model reads a module's files whole** (2026-09-19, `src/modulesource.js`
  `sourceText`, used by `proposals.moduleContext` and so by the proposer AND
  the system review, and by `diagrams.js`). Found in the verification pass
  against the 2026-09-18 review: every one of those readers got pages cut at
  14,000 characters and every other file at 8,000 (10,000 for diagrams) in
  silence, which on the library modules was 8,000 of 21,603 characters of
  kpis/routes.js and 8,000 of 19,793 of paperline/routes.js: functionality
  proposals, whole-module reviews and data-flow drawings written from under
  half of the server file. Now every file is whole. One overall budget
  (`SOS_CONTEXT_CHARS`, default 400,000 characters) guards the model's
  window; over it, files are kept in order of need (the screen the feedback
  came from, module.json, routes.js, other .js, pages, reference.md,
  migrations, other docs, tour.json, the rest), the overflow is cut at the END
  of that order, each cut is marked in the text where it happens, a NOTE at
  the top names the cut files and tells the model not to assume what it
  cannot see, `[context]` goes to the log, event `proposal_context_cut`, and
  `proposal_drafted` carries `detail.context_chars` (and `context_cut` when
  anything was). Cost: about 3 to 7 cents more per Fable proposal on the
  library modules (15k tokens in against 8k to 12k); the review estimate
  follows on its own. RULE: never slice a file going into a prompt without
  saying so in the prompt and on the record. Unit:
  `node scripts/test-modulesource.js` (the library modules arrive whole).
- **Connections, first push: spreadsheets and label printers** (2026-09-19,
  `src/connections.js`, `public/connections.html` at `/c/<slug>/connections`
  (manager), `public/assets/print-helper.js`, build order item 5, designed in
  docs/MODULE-CREATION.md "Connections: the outside world"). The rule: the
  platform owns every connection, the module only uses it. A module declares
  what it needs in module.json `connections: { name: { kind, label, ... } }`
  (the gate and `validateModule` refuse a kind the platform does not have, a
  files connection without `table` and `key`, a printer whose
  `labels/<name>.zpl` is missing); the platform keeps one row per declared
  connection in `platform.connections` (settings, status, detail, an
  encrypted `secrets` column ready for the ERP kind, key `SOS_CONNECTION_KEY`
  else derived from SESSION_SECRET, never in the agent env), created at mount;
  the module gets `ctx.connections.<name>` with a small fixed surface. `files`:
  the manager uploads a csv or xlsx on the connections page, the platform
  parses it (attachments.js parsers, every row), matches headers to the
  module table's columns (loosely, plus the module's aliases), previews with
  typed sample rows and problems, then loads in ONE transaction on the live
  schema (delete the matching keys, insert every row; any unreadable cell
  stops the whole load); `platform.connection_uploads` keeps the parsed rows
  until loaded. Surface: `status()`. `printer`: Zebra Browser Print on the
  device. The module keeps `labels/<name>.zpl` with `{{field}}` placeholders
  and calls `print(req, name, data)`; the platform renders (ZPL control
  characters stripped from data), queues a row in `platform.print_jobs` for
  the DEVICE that asked (`sos_device` cookie, minted by
  `connections.deviceCookie` on module pages, the connections page and the
  print API), and the print helper the platform injects into the pages of a
  module with a printer connection polls `GET /api/c/<slug>/print/next`
  every 2 s while visible, asks once which printer this device uses
  (localStorage), POSTs the ZPL to Browser Print on localhost:9100 (9101
  https), reports `.../print/jobs/<id>/done|failed`. Unclaimed jobs expire
  after 10 min; jobs a device took and never reported fail. The page policy
  of such a module adds `localhost:9100/9101` and `/api/c/<slug>/print/` to
  connect-src and nothing else. `preview(name, data)` renders a PNG through
  Labelary (`SOS_LABELARY_URL`, https://api.labelary.com; null when
  unreachable, as in the sandbox); the connections page shows the test label
  and the module can show its own. Test label and printer settings (size and
  dpi, preview only) live on the connections page; the manager pairs each
  printing device there or on the first label. Record kinds:
  connection_loaded, connection_settings, connection_tested, label_printed,
  label_failed. `paperline` declares `stock` (files into `inventory`, key
  item+location) and `labels` (printer, `labels/traveler.zpl`, printed from
  station 1). Backup carries the three tables; company delete removes them.
  Unit: `node scripts/test-connections.js`. Not yet: the generated setup
  walkthrough (the page carries a fixed text per kind for now), uploads from
  a module page (the module links to the connections page instead), the
  scanner kind (needs nothing).
- **Connections, second push: the ERP kind** (2026-09-19, `src/connections.js`
  erp section, the connections page's ERP card with an admin-only setup form,
  `modules/paperline` "erp"). Read only, through named queries. The module
  declares each query it needs (`queries: { name: { params, fields, about } }`);
  the gate refuses a module that carries `base_url`, `url`, `user`,
  `password`, `path` or `host` (the platform holds those). The ADMIN (Brendan,
  during pilots: decided 2026-09-19) enters on the connections page: flavor
  (`sap_odata`: SAP Gateway / S/4HANA OData v2 or v4, `epicor_baq`: Kinetic
  BAQ REST, `json`: any read-only JSON endpoint), base URL, transport
  (`direct`; `bridge` is designed in and answers "not available yet"), answer
  freshness, SAP client, certificate check (off for a self-signed on-prem
  certificate), the login (user and password or an API key, encrypted with
  AES-256-GCM under `SOS_CONNECTION_KEY`, else SESSION_SECRET; SET
  SOS_CONNECTION_KEY ON RAILWAY so a session secret rotation does not lose the
  logins; a login that cannot be decrypted says so and asks for it again), and
  per query: the path after the base URL with `{param}` placeholders (URL
  encoded, OData quotes doubled), the system's field behind each module field
  (dotted paths), test values. `POST /api/admin/connections/:slug/:mod/:name/erp`
  saves it and clears the cache; the login never comes back out of any
  endpoint. The manager's Test button (`.../test`, shared with the printer
  kind) runs every query with its test values and reports rows, a mapped
  sample and fields that came back empty (a wrong field name), plus a path
  that uses a `{param}` the query does not declare. The module's
  `query(name, params)` reads `platform.erp_cache` when fresh, else calls the
  ERP (`httpGet` over http/https with a 15 s timeout, 20 MB cap, plain-words
  errors for refused, not found, certificate, 401/403/404), maps the fields,
  stores the rows, and on failure returns the cached rows with `fresh: false`
  (the connection stays connected with `last_error` set) or throws with the
  reason when nothing is cached. The IT note (`.../it-note.txt`, and on the
  card) is templated in plain words from the declaration and the settings:
  what read-only access, which lookups and fields, where the calls come from,
  how the login is kept, what we need back. A stand-in ERP for the showroom
  answers at `/erp-demo/parts` and `/erp-demo/orders` (public, static rows,
  SAP OData v2 shape, `$filter=Field eq 'x'` and `$top` honoured), so a demo
  company's erp connection can be set up with base URL `<host>/erp-demo/`.
  `paperline` declares `erp` with one query `parts` (fields item, description,
  on_hand, reorder_at) and the stockroom page shows an "ERP says" column with
  "below reorder point" and an as-of line. Backup carries `erp_cache`. Not
  yet: the bridge transport itself, a generated (not templated) walkthrough,
  SAP CSRF-protected writes (never).
- **The ERP is admin side; the data check at review** (2026-09-19, Brendan:
  the manager's view must not carry lookups, fields or BAQs, "otherwise it
  gets much too complicated"; "there should just be a check the agent does
  during reviewing to see if it has access to the data"). `src/datacheck.js`,
  `platform.data_requests`, `proposals.data_check`. (1) Admin only: the ERP
  card on the connections page (`connections.companyView(company, { admin })`
  strips it server side to label + status + `managed: true` for anyone else:
  no settings, address, lookups, columns, samples, audit, drafts or IT note),
  the ERP Test (the shared `.../test` route answers 403 to a manager for an
  erp connection), the IT note, setup, drafts, and platform-written agent docs
  (`source='platform'`, i.e. `ERP-FIELDS.md`, are left out of
  `GET /api/c/:slug/agents` unless the role is admin). Managers keep printers
  and spreadsheets. (2) The check: for a module with an ERP connection,
  `generateProposal` adds `erp_data` to the proposal schema (what, in the
  manager's words; the lookup; the published field that covers it or empty)
  and tells the model to write the proposal as it will work once the data is
  there, never naming lookups or fields to the manager. `datacheck.verify`
  checks each named field against `connections.fieldAudit` (catalog plus
  declared fields that resolve); THE PLATFORM DECIDES, the model's opinion of
  availability is never used. `data_check.status`: none (needs nothing), ok,
  waiting (something missing: a row per missing need in
  `platform.data_requests`), unavailable (the admin dismissed the last open
  request with a reason). The board query sends the manager only
  `proposal_data = { status, reason, missing: [plain words] }`. waiting: one
  amber sentence, no Approve, Decline stays; the decide route, the batch
  build and `/api/runs/batch` all answer 409 in plain words. unavailable: the
  admin's sentence in red; approve only together with an edited proposal
  (the manager changed the ask). (3) Admin: the "Data requests" card on
  /admin (`GET /api/admin/data-requests`, `.../:id/resolve` = "it is there
  now: propose again", `.../:id/dismiss` with a sentence the manager reads).
  A catalog change in `setErp` (the set of published names differs) calls
  `datacheck.catalogChanged`, which proposes the module's waiting items again
  behind the response (old draft -> `superseded`, its requests closed by the
  new proposal's `apply`). Record kinds: data_check, data_request_resolved,
  data_request_dismissed; event data_request_opened. Loop health:
  `decisions.waiting_data` and its oldest age ("waiting on us"), kept apart
  from what waits on a manager. Fake mode: `ERPNEED:<field>` in the feedback
  makes the fake proposer need that field (empty = nothing covers it).
  Same push, from the cross-check: the ERP cache key now includes the
  module's declared fields (a version that reads one more field never gets
  rows cached without it); an answer under an hour stale is served at once
  with `fresh: false, refreshing: true` and refreshed behind it
  (`erpQuery(..., { refresh: true })`), so a floor page only ever waits on the
  ERP for a lookup it has never made; the Test flags a lookup that hit the
  5000-row cap; `erp_cache` and `data_requests` are in the backup.
- **ERP field catalog, paging, lookup drafts** (2026-09-19, third connections
  push; the workflow is docs/ERP-ONBOARDING.md). Why: the ERP hookup is the
  most engineer-heavy thing we do, so a lookup must cost us time ONCE. The
  lookup is built WIDE in the ERP; Test records every column it returns
  (`columnsOf`: name, type, one sample, kept in `connections.detail.columns`,
  bookkeeping columns dropped); "Publish every column" (`setErp` with
  `publish`) gives each a plain name (`autoNames`: `JobHead_JobNum` ->
  `job_num`, the prefix kept on a collision) into
  `settings.queries.<q>.catalog`, where the admin may rename and annotate. A
  declared field resolves through `resolveFields`: the hand map, then the
  catalog, then a unique loose match on the column's own name, else null; the
  Test says how each resolved. `writeFieldsDoc` keeps the module agent doc
  `ERP-FIELDS.md` current (names, types, notes, never values; written at
  mount, on setup and on test), and `agent.guidanceFor` already hands every
  module doc to the proposer, the builder and the reviewer, so a request for
  one more ERP field is an ordinary functionality change that needs nobody
  from Anetix or IT. `fieldAudit` and `auditLine` put one line in the run log
  of every build of a module with an ERP connection ("ERP fields: every field
  the module reads is available" or which are not yet) and the same on the
  card. Paging: Epicor and plain JSON are paged with `$top=500&$skip=n` until
  a page is empty or partial (a page at a round hundred is followed by
  another request, because a server may cap pages at 100; a repeated first
  row stops an endpoint that ignores `$skip`; a path with its own `$top` is
  left alone); SAP follows `d.__next` or `@odata.nextLink`; 5000 rows at most.
  A 401 that mentions an API key says "it wants an API key as well" (Epicor
  REST v2 wants the user, its password AND a key; the form says so now).
  `draftLookups` (`POST /api/admin/connections/:slug/:mod/:name/draft`, admin,
  the company's propose model, spend recorded as `erp_draft`, record kind
  `connection_drafted`) has the model write what IT needs to build each
  lookup, wide on purpose, with a suggested ERP object name (`SOS_...`), the
  path, a field map, the extra fields it included and why, and what it could
  not know about this installation; for Epicor the definition is one
  read-only SELECT for BAQ Designer's SQL import (Kinetic 2024.2 and later; no
  CROSS APPLY, no OPENJSON). Nothing touches the ERP: a person there builds
  it and the Test proves it. "Use its path and field map" fills the form.
  A second stand-in ERP, Epicor shaped, answers at
  `/erp-demo/epicor/BaqSvc/SOS_<anything>/Data` (1230 jobs, `Table_Field`
  columns, 100 rows a page at most, wants `x-api-key` and Basic auth, BAQ
  parameter `JobNum`). Units in `scripts/test-connections.js`.
- **Loop health** (2026-09-19, `src/health.js`, `GET /api/admin/health?days=`,
  the top card on /admin, build order item 4). The platform's own numbers,
  per company and across the fleet, for Brendan (the manager's board shows
  none of this, by design). A window (7, 30, 90, 365 days, or 0 for all
  time; default 30) over: feedback filed; proposals approved (and how many
  the manager edited first), declined, waiting; builds started, shipped,
  rolled back, cancelled; stops by kind (gate = the platform's own checks,
  reviewer = the cross-check, tests = smoke and visual, other), fix rounds,
  overrides; time to floor (feedback filed to deployed, the oldest item of a
  batch; median, p90, and the same-shift share, within 8 hours); manager
  wait (proposal drafted to decided; then ready to deployed); AI spend in
  the window, per shipped change, this month against the cap; build models;
  intakes. As of now, not windowed: open feedback and its oldest, what is
  waiting on a manager (decisions, requirement confirmations, deploys), in
  flight, and the quiet stretch (days since the last reviewer or test stop,
  gate stop, rollback; a long one is the signal to try a cheaper build
  model, per the 2026-09-18 decision). Sources: the primary tables and the
  run log's timestamped lines (`deploy`, `rollback`, `error`, the ready line
  of each lane), so the whole history counts; the record adds decision times
  and edits, and a decision before the record uses the run's start.
  `compute()` is pure and unit tested (`scripts/test-health.js`, synthetic
  rows, fixed clock); `forAdmin()` is the one call the page makes.
- **Board simplified** (2026-09-20, Brendan: "so intuitive", "keep it a
  little black box like"; `public/index.html`, `public/settings.html`,
  `scripts/e2e/board-browser.js` 22 checks). What left the board: every
  model name and every dollar figure (run lines, review bars, the cross-check
  line, "proposed by", "Approve build (model)", the Adjust form's "Build
  with", the batch bar's model select, the system review's model select and
  estimate, the intake popout's estimate, the "guided by: docs" line); the
  KPI strip; the header links (people, agent settings, checks log,
  connections, record, wall sign); "Add to batch" on every card and the two
  batch panels; the wall-sign modal. What the board has now: top right is
  "signed in as <role> · <person chip> · Settings · sign out" (admin also
  "admin"); the module strip as before (Open live, Preview, Diagrams,
  Versions, + New module); the system review toolbar with the module picker
  and the button only; one panel at the top of Reviewing per module with two
  or more proposals waiting, "Build these N together" (`renderTogether`,
  `POST /api/runs/batch` with the proposal ids, so the same run a batch made;
  the server-side batch routes stay for the API and are unused by the board);
  on every card ONE big button for what it waits on and the rest under a
  small "more" (`actions(key, primary, [rest])`, a `<details class="more">`
  drawn as a dropdown, `OPEN_MORE` keeps it open across the 4 s reload, a tap
  elsewhere or on one of its buttons closes it): new = Review with AI (or
  Propose anyway, quiet, when a question or a flag is what the card waits on)
  + more(Decline); reviewing = Approve build + more(Adjust, Decline), or
  Adjust as the primary when the ERP cannot provide the data; requirement
  gate = Confirm + more(Adjust the requirement, Cancel); running =
  more(Abort build); deploy gate = Deploy / Put it on the floor +
  more(Discard); stopped = the reason first, then Send findings back (else
  Retry from scratch) + more(Override where allowed, Retry, Cancel), the
  retire buttons stay inside their findings; shipped = the close-out Done as
  before + more(Roll back); module request = the one step it is on +
  more(Withdraw, the design). Every gate is unchanged; nothing was removed
  from the API. `/c/<slug>/settings` (manager, `settings.html`): People
  (link), Printers and spreadsheets (link), the wall sign (QR inline, Print
  the sign prints just the sign, Copy link), and the two arrival switches
  (moved off the agents page, same `/api/c/<slug>/agents/arrival`). The
  admin company card links Settings, Agent settings and docs, Checks log,
  People, Connections and the record. Left as is on purpose: "Fable" in the
  module request card and popout (the designer's name in the intake flow),
  to be renamed only if Brendan wants it.
- **Board band** (2026-09-19): one title row and one quiet module line
  (`.band`, `.modstrip`, `.modcard`), 70px on a desktop against roughly a
  third of the screen before. Module names are the filter toggles, versions
  and links are small text, the printable QR moved from a permanent tile to a
  "wall sign" link that opens the same card, the filter hint sits at the end
  of the module line only while a filter is in force. Chips wrap on phones.
- **Board tiles fold** (2026-09-17): each of the four columns shows
  `TILES_PER_COLUMN` (3) tiles and a "Show the other N" button; `EXPANDED`
  keeps opened columns across the 4s reload. The header count is the total.
- **Module creation intake** (2026-09-17, push 3 of docs/MODULE-CREATION.md;
  the build from a confirmed design is the bullet above). A manager presses "+ New
  module" on the board strip (or "New module" on an admin company card, which
  lands on the board with `?intake=<id>`). That creates a feedback row of
  `kind='module_request'` (new column; `intake_id` too) and a
  `platform.module_intakes` row; the tile on the board is the status and the
  way in, the popout (`public/assets/intake.js`, one file, its own CSS) is
  where the answering happens. Fixed questions live in
  `src/intake-questions.js` (13, the last one only when the company has other
  modules; answer shapes documented at the top of that file). Answers save
  one at a time (`POST /api/intakes/:id/answer`); `next` checks the open
  round is complete (409 with the missing ids), sets status `thinking` and
  runs `intake.think` in the background: Fable (`SOS_MODEL_INTAKE`, default
  claude-fable-5-1) returns either a round of up to 6 questions (ids
  `r2q1`..., at most two generated rounds, or `enough`) or the design
  (`DESIGN_SCHEMA`: bluf, check items, reference_md in the module-formats
  shape, screens, connections, starting data, leaves_out, change guidance,
  plus `estimate_usd` from `estimateUsd`). Every generated string passes the
  plain-words guard (`src/plainwords.js` over `principles/PLAIN-WORDS.md`: a
  word check, one Haiku rewrite, the check again; a question that still fails
  is dropped, a design line is flagged in `design.flags`; the company's own
  system names from the works_with answer are allowed). Attachments
  (`src/attachments.js`, `platform.attachments`, bytea, 15 MB and 10 per
  intake): photos and pdfs go to Fable as image and document blocks
  (`runStructured` now takes `blocks`), csv and xlsx are parsed to rows with a
  dependency-free reader (xlsx is a zip of xml; unusual files fall back to
  "save it as csv"). Design gate in the popout (a deliberate exception to
  gates-on-the-tile): tick every item, Adjust the text (Fable re-issues the
  design with the edit as the authority, `adjust`), Start over (keeps the
  fixed answers), Approve build (`confirm`, status `confirmed`, then
  `modulebuild.startBuild` at once: status `building`, then `done`). Text
  boxes show "N characters left" from 80% of their limit and say plainly
  when full. Withdraw on the tile (`abandon`, feedback declined). Fake
  mode returns a canned round 2 and a canned design. Module requests are kept
  out of batches and the proposal engine (`kind='feedback'` checks). The
  intake router is mounted before the platform router because the attach
  route parses a bigger JSON body. Spend goes to `ai_usage` as kinds `intake`
  and `design`.
- **Module filter** (2026-09-17, `public/index.html`): with more than one
  module, each module card's title in the strip is a toggle and an "All
  modules" chip sits in front. `SEL` (a Set of module names, null = all) is
  read from `?m=a,b` first, else `localStorage["sos.modules.<slug>"]`, is
  normalized against the company's modules (unknown names dropped, empty or
  every module = all) and always written back to both, so the URL shows the
  pick in force and can be linked. Clicking a title from "all" shows only
  that module; clicking again adds or removes. `visible(module)` gates the
  four columns, batch tiles, the "Build these N together" panels, the review
  bars and the system review default (first visible module); the Platform
  requests strip ignores it. `load()` fetches and
  `render()` draws from `DATA`, so a toggle redraws without a fetch.
- **Board layout** (`public/index.html`; the KPI strip, the QR tile and the
  batch panels below are history since 2026-09-20, see "Board simplified"):
  header band, module strip (Open live / Preview vN / Diagrams per module),
  KPI strip, system review toolbar, four columns. The band's top right holds the company's **board QR code**
  (`GET /api/c/<slug>/qr.svg?px=N`, drawn by `src/qrcode.js`, a dependency-free
  byte-mode encoder at error correction M, versions 1 to 10). It encodes
  `<proto>://<host>/c/<slug>/` from the request headers, so each company's code
  opens that company's board (login first if the scanner has no session).
  Clicking the tile opens a card with a large code, the link, Copy link and
  Print; the print stylesheet prints just that card as a wall sign. The band
  is two columns (title + module strip on the left, the 112px QR tile
  spanning both on the right). Platform feedback (about the tool itself,
  shipped from Cowork) sits in a collapsed "Platform requests" strip under
  the columns, not a column of its own.
- **Batches are server state** (the board stopped using them on 2026-09-20,
  "Build these N together" posts to `/api/runs/batch`; the routes remain)
  (`platform.batches`, `feedback.batch_id`,
  routes `POST /api/c/<slug>/batch/add|remove` with `feedback_ids`,
  `POST /api/c/<slug>/batch/<id>/clear|build`): one open batch per module
  (`run_id IS NULL`). Cards join or leave at the New or Reviewing station
  ("Add to batch" greys to "In batch" plus a Remove link; Approve build and
  Review with AI grey out while the item is in a batch). The panels at the
  top of the Feedback and Reviewing columns carry the actions: "Review the N
  new with AI" (one proposal call per item), "Build the N together" (only
  reviewed items go in; the rest leave the batch), Clear. Build sets
  `batches.run_id`; cancel and deploy clear `batch_id`. The old client-side
  checkbox selection and sticky batch bar are gone. "+1 seen again" is gone
  from cards; new feedback has Decline (`/api/feedback/:id/close`).
- **Requirement gate** (functionality lane): the propose model now returns
  `bluf` (one sentence), `items` (one sentence per change) and the full
  `requirement`; stored in `evidence.req_bluf` / `evidence.req_items`. The
  card shows the BLUF, one check box per change, the full text under "See
  the full requirement", and Confirm stays disabled until every box is
  ticked (ticks live in the page's `CHECKED` set so the 4s reload keeps
  them). "Adjust the requirement" opens the full text for editing before
  confirming (`POST /api/runs/:id/confirm {requirement}`).
- **Abort and orphans**: `POST /api/runs/:id/cancel` now also works on a
  `running` run: the build agent's AbortController (`pipeline.ACTIVE`) is
  fired, the run is marked cancelled before the agent error lands
  (`failRun` leaves a cancelled run alone), a never-staged draft version is
  dropped (`registry.dropDraftVersion`), proposals go back to reviewing.
  Board: "Abort build" on running cards. At boot `pipeline.sweepOrphans`
  marks every `running` row failed ("the platform restarted while this build
  was running") and kicks the queues; that is what a build "paused with no
  way forward" after a redeploy was.
- **Preview highlights**: the build prompt asks the agent to put
  `data-changed="vN"` on every element it adds or visibly changes
  (PRINCIPLES.md rule 9; the cross-check prompt says this is expected). The
  staged bar (`feedback-widget.js`) outlines those elements with a NEW tag,
  and "what changed?" opens a panel with the run's plain summary and the
  screens whose files differ from the floor version, as links
  (`GET /api/c/<slug>/modules/<m>/staged-changes`, a text compare of the two
  versions, no tokens).
- **Rollback asks first** (confirm dialog on every Roll back button;
  Switch/Restore in the Versions panel already did).
- **Company brand** (`src/brand.js`, `companies.brand` JSONB): the admin
  gives a website when creating a company (or later, "Build the brand
  guide" / "Rebuild" on the company card, `POST
  /api/admin/companies/<slug>/brand {url, model}`). The server fetches the
  page plus up to 5 stylesheets (browser UA; the build agent has no
  network), extracts title, meta, icons, logo imgs, hex/rgb colors by
  frequency, CSS custom properties, font stacks, visible text, and asks the
  chosen model (Fable by default) to REWRITE the platform `principles/STYLE.md`
  for the brand (same sections, same specificity) plus structured fields
  (primary/accent/background/ink, font, company_name, tone). The result is
  the company-wide agent doc `STYLE.md` (editable on the Agent settings
  page). `agent.guidanceFor` drops the platform STYLE.md whenever a company
  STYLE.md exists, so an agent never sees two style files (with both in the
  prompt it kept the platform defaults; found 2026-09-14 with a Stanley
  Black and Decker test). Boot renames any leftover BRAND.md to STYLE.md.
  Site fetch: two tries at 30s for the page; when it still fails (bot
  protection: SBD hangs, langmuirsystems.com answers 403) the guide is built
  anyway from the model's knowledge of the brand, `brand.site_read=false`
  and the admin card says so; icons fall back to the DuckDuckGo/Google
  favicon services. The restyle proposal names the default hex values to replace; the icon (largest apple-touch-icon, else favicon, as a
  data URL) is served at `GET /api/c/<slug>/icon` (default SVG mark when
  none) and linked as favicon + apple-touch-icon on the board and on every
  module page (`registry.widgetInject`). The board band takes the primary
  color and the accent (CSS variables `--navy`/`--amber`), shows the icon
  next to the title. Status building/done/failed on the admin card (polls
  while building); cost counts toward monthly spend. **Restyle** (`POST
  /api/admin/companies/<slug>/modules/<m>/restyle`, and automatically when a
  module is added to a company whose guide is done): one approved UI
  proposal per screen (feedback items by "Brand"), built as one batch run
  that waits at the deploy gate, so the manager previews the branded module
  before it goes live. Fake mode returns a canned guide.
- **Company delete** (`POST /api/admin/companies/<slug>/delete
  {confirm_slug, password}`): admin role plus the slug typed back plus the
  admin password checked server-side (`auth.checkAdminPassword`); refused
  while the company has running/queued/waiting runs. Drops the company's
  live and staging schemas and its snapshots, deletes runs, proposals,
  feedback, batches, docs, reviews, diagrams, versions, modules, the row,
  the mounts and the materialized files; logs `company_deleted`. Modal on
  the admin page. Pilot-stage hardening (a second factor) is still to do.
- **Backup and restore** (`src/backup.js`): `GET /api/admin/backup` streams
  one JSON file (`format: sos-backup-1`) with every platform table and every
  `mod_*` schema's rows plus DDL (columns, sequences, constraints, indexes).
  `POST /api/admin/restore {password, backup}` (admin password; refused
  while a build runs; own 300mb body parser) rebuilds the module schemas
  from the DDL, refills the platform tables, resets sequences, then exits
  the process (Railway restarts it; boot re-materializes versions and
  mounts). Admin page: Download backup / Restore from a backup file. Railway's
  own Postgres backups (Backups tab on the Postgres service) are the other
  half; the MCP cannot switch them on.
- **Agent doc duplicates fixed**: `UNIQUE (company, module, name)` never
  fired for company-wide docs (module NULL), so every boot seeded another
  COMPANY.md and every save added a row, and guidance carried them all.
  `db.dedupeCompanyDocs` cleans up at boot and adds a partial unique index;
  all writes go through `db.upsertDoc`.
- **Schema names** are sanitized (`migrate.ident`): a slug with a dash gets
  `_` in `mod_`/`stg_`/`snap_` names, so dashed slugs work.
- **What the platform lends a module** (`registry.moduleServices`, on the
  ctx handed to `routes.js`): `peer(name)` is a READ ONLY query function on
  a sibling module's live tables (null if that module is not live for the
  company), `agentDoc(name)` returns the company's editable copy of a module
  doc, `ai.chat({model, system, messages, maxTokens, kind})` is a plain chat
  call through `agent.runChat` under the monthly cap with the cost written
  to `platform.ai_usage` (counted in `monthlySpend`), `ai.models`,
  `ai.modelFor(role)`, `manifest`. A module declares chat personas in
  module.json `agents: { id: { doc, label } }`; the doc file ships in the
  module, is seeded as an editable module doc (`seedModuleDocs`), and
  `guidanceFor` leaves it out of build prompts.
- **Plant KPIs module** (`modules/kpis/`, company demo by default): the
  manager's eight-week view plus **Jonah**, a chat agent for managers
  (`JONAH.md`, TPS and Theory of Constraints voice: what the data says, what
  it means, where to stand on the floor, one experiment). History is
  seeded deterministically on first request (`routes.js buildSeed`, 40
  working days ending yesterday) with the lean patterns baked in: flat
  demand, lumpy orders, lumpier production orders (bullwhip), Friday push
  and Monday idle, Body Fold as the constraint carrying the WIP and half
  the defects, defects rising on push days, paper bought in 2400 lots, four
  clip stockout days, lead time following WIP, on-time delivery sliding.
  `GET /api/kpis` returns everything the page draws plus computed `flags`
  and `live` (today's real paperline shifts and WIP through `peer`). Chat:
  `GET/POST /api/chats`, manager only; system prompt is JONAH.md plus
  `digest()` (a few thousand characters), default model the company's
  propose model, dropdown to switch; each answer shows its cost. Page is
  plain HTML with inline SVG helpers (line, bar, stacked area, h-bars);
  chart ids `c-bullwhip c-output c-wip c-lead c-quality c-inventory` are
  targets for the tour and the "Ask Jonah about this chart" buttons.
  `POST /api/reseed` (manager) regenerates the eight weeks ending yesterday
  before a demo. (The chats table uses `last_at` from the days when the
  validator rejected `updated_at` as a substring of UPDATE; fixed 2026-09-17.)

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
   agent builds a new module version into staging → manager deploys. This is
   what participants exercise. It only touches module files stored in the
   database (`platform.module_versions.files`). Several proposals can be
   batched into one run (`POST /api/runs/batch`); one run is active per module
   and the rest queue (`build_runs.status = queued`, kicked by `kickQueue`).
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
   revisions. Feedback filed about the platform itself lands in the
   "Platform requests" strip of the board and is readable from here:
   `GET /api/c/<slug>/feedback/platform` (manager session) or the
   `platform.feedback` table where `module='platform'`. Close them with
   `POST /api/feedback/:id/close {outcome}` after shipping.

Local smoke test of the whole loop, in the sandbox: `SOS_FAKE_AGENT=1
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
  `GET https://sos.finnoperations.com/api/c/demo/modules/paperline/export`
  (manager cookie) returns `{files}`; write them over `modules/paperline/`,
  then make the change. Otherwise the agent's changes get superseded (they
  remain in the DB and are still rollback-able, but not live).
- **Never edit an existing migration file.** Migrations are applied once per
  schema by filename; edits to `001.sql` do nothing on the live database. Add
  `002.sql` etc. Additive only (CREATE TABLE / ADD COLUMN / CREATE INDEX /
  INSERT). The validator rejects DROP/UPDATE/DELETE/etc. and even the bare
  word `do` anywhere in a statement, so mind seed text.
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

If a future session does have the repo attached as a source, pushing from the
sandbox works the same way (`git push` from a clone) and the Terminal step
goes away.

The cloud sandbox has npm registry access (through its proxy) and Postgres 16
(`pg_ctlcluster 16 main start`, then create user/db `sos`/`sos`), so the app
runs there from a plain `npm install`: tar the repo without `node_modules`
and `.git` in the mounted folder, stage the tarball, untar, install, boot with
`SOS_FAKE_AGENT=1`. End to end and browser suites belong in `scripts/e2e/`
IN THE REPO (since 2026-09-19; the earlier ones lived only in a session's
sandbox and the next session could not rerun them). That is also where `package-lock.json` is regenerated
after a dependency change. The `node_modules` in the mounted folder is a stale
local install from before the SDK upgrade; Railway never sees it. The
sandbox can reach api.anthropic.com but has no key, so a real agent run is
tested on the live instance; a launch test with a bogus key (init message,
tool list, 401 from the API) proves the CLI itself starts.

## Live instance env vars (Railway service `SymbioticOS`)

- `SOS_CONNECTION_KEY`: the key the ERP logins are encrypted under (any long
  random string; `openssl rand -hex 32`). Optional: without it the platform
  derives a key from SESSION_SECRET, so rotating that secret would make every
  stored login unreadable. Set it once and never change it without re-entering
  the logins.

`DATABASE_URL` (reference to Postgres), `ANTHROPIC_API_KEY`,
`SOS_FLOOR_PASSWORD`, `SOS_MANAGER_PASSWORD`, `SOS_ADMIN_PASSWORD`,
`SESSION_SECRET`, `SOS_MODEL_PROPOSE` / `SOS_MODEL_BUILD` / `SOS_MODEL_REVIEW`
(instance defaults: claude-sonnet-5 / claude-sonnet-5 / claude-opus-5;
companies override on their Agent settings page), `SOS_MAX_RUN_USD` (per
build run, default 1.50), `SOS_MONTHLY_CAP_USD` (default 25),
`SOS_FAKE_AGENT` (0/1). `SOS_FLOOR_PASSWORD` and `SOS_MANAGER_PASSWORD` are
now only the fallback for companies created before 2026-09-19 that have not
been given their own passwords (see the "one company per session" bullet);
`SOS_ADMIN_PASSWORD` is still the admin password. `SOS_MONTHLY_CAP_USD` is now
the instance-wide ceiling only; a company's own budget is set on the admin page
and lives in `platform.companies.monthly_cap_usd`. `SOS_PAGE_LOCK` (default
`on`) is the browser policy on module pages: `report` sends it report-only
(violations show in the browser console, nothing breaks), `off` sends none;
the escape hatch if module pages ever stop after a deploy. Optional: `SOS_AGENT_EFFORT` (build agent reasoning
effort, default `high`), `SOS_PERSON_HOURS` (default 12: how long a name and
PIN sign-in lasts on a device), `SOS_BROWSER` (default `auto`; `off` makes
every build's page load go without a browser), `SOS_CHROMIUM_PATH` (where
Chromium is, when it is not on the PATH as `chromium`), `SOS_PAGE_SETTLE_MS`
(default 1500: how long a screen is given to load its data before it is
judged), `SOS_CHECK_TIMEOUT_MS` (default 10000, per check step),
`SOS_AUTO_PROPOSE_PER_HOUR` (default 40: how many requests a company's
proposer reads on arrival in an hour; past it they wait for the manager's
button),
`SOS_MODULE_RUNNER` (default `auto`; `process` = module code in its own
process or not mounted; `inline` = the old in-platform way),
`SOS_MODULE_TIMEOUT_MS` (30000, one module request),
`SOS_MODULE_LOAD_TIMEOUT_MS` (10000, routes.js load), `SOS_ROLE_CONNECTIONS`
(12, database connections per company role), `SOS_ROLE_STATEMENT_TIMEOUT`
(30s); `SOS_CONNECTION_KEY` now also keys the per-company database passwords,
`SOS_CONTEXT_CHARS` (default 400000: the most
module source a proposal, system review or diagram call is given; files are
whole below it, see "A model reads a module's files whole"), `SOS_SESSION_DAYS` (default 30; sessions
expire server-side, not just via cookie Max-Age), `SOS_LOGIN_MAX_FAILS`
(default 10) and `SOS_LOGIN_WINDOW_MIN` (default 15) for the per-IP login
limiter (in-memory, address from `edge.clientIp`). Admin accounts:
`SOS_ADMIN_SESSION_HOURS` (12), `SOS_ACCOUNT_MAX_FAILS` (5),
`SOS_ACCOUNT_LOCK_MIN` (15), `SOS_AUTH_EVENT_DAYS` (400), `SOS_ADMIN_2FA=off`
(break glass only), and `SOS_CONNECTION_KEY` is now REQUIRED before an
authenticator can be set up. Edge: `SOS_EDGE_SECRET` (the value the Cloudflare
Transform Rule puts in `X-SOS-Edge`), `SOS_EDGE_MODE=report` while proving the
rule, `SOS_CF_RANGES` if Cloudflare's ranges move. `SOS_ADMIN_PASSWORD` comes
OUT once the first authenticator is set up (never together with both of the
other two password variables: see `OPEN` under "Named admin accounts").
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
  the body scopes itself with `auth.ownsCompany(req, slug)`.
- A new platform table that belongs to a company goes in `backup.js`
  `PLATFORM_TABLES` and, if it holds secrets, stays out of `platform.companies`.
- A secret, a one-time code or a recovery code is never logged and never
  returned, apart from the one enrollment answer that shows a person their
  own. A new destructive admin action takes `auth.checkAdminCode`. A new admin
  route that an account with no authenticator must reach goes in
  `auth.ENROLL_PATHS`, and that list stays as short as it is. Anything that
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
  or a file the platform did not hand it.
